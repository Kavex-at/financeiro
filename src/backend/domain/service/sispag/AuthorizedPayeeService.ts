import { inject, injectable } from 'tsyringe';
import PostgreeDatabaseClient from '../../client/database/PostgreeDatabaseClient.js';
import AuthorizedPayeeNotFoundError from '../../errors/AuthorizedPayeeNotFoundError.js';
import AuthorizedPayeeVersionConflictError from '../../errors/AuthorizedPayeeVersionConflictError.js';
import PayeeDestinationChangedSinceShownError from '../../errors/PayeeDestinationChangedSinceShownError.js';
import PayeeWithoutPaymentDataError from '../../errors/PayeeWithoutPaymentDataError.js';
import { LOG_TYPE } from '../../interface/log/LogInterface.js';
import { ALERTA_SEVERIDADE, ALERTA_TIPO } from '../../interface/operacao/Alerta.js';
import {
    AUTHORIZED_PAYEE_EVENT,
    AUTHORIZED_PAYEE_MODALITY,
    AUTHORIZED_PAYEE_STATE,
    type AuthorizedPayee,
    type AuthorizedPayeeEventRecord,
    type AuthorizedPayeeModality,
    PAYEE_CHECK_RESULT,
    PAYEE_RECHECK_RESULT,
    PAYEE_SYSTEM_ACTOR,
    PAYEE_WARNING,
    type PayeeCheckResult,
    type PayeeDestination,
    type PayeeDestinationReading,
    type PayeeRecheckResult,
    type PayeeRequestOrigin,
    type PayeeWarning,
} from '../../interface/sispag/AuthorizedPayeeInterface.js';
import EnvironmentProvider from '../../libs/environment/EnvironmentProvider.js';
import AuthorizedPayeeRule from '../../libs/sispag/AuthorizedPayeeRule.js';
import PayeeFingerprint from '../../libs/sispag/PayeeFingerprint.js';
import AuthorizedPayeeRepository, {
    type FiltroAutorizacoes,
} from '../../repository/sispag/AuthorizedPayeeRepository.js';
import LogService from '../LogService.js';
import NotificacaoService from '../operacao/NotificacaoService.js';
import DestinoPagamentoResolver, {
    type CacheCadastroDestino,
    DESTINO_CADASTRO_TIPO,
    DESTINO_ORIGEM,
} from './DestinoPagamentoResolver.js';

/** Um (favorecido, modalidade) a verificar, com a filial usada para LER o cadastro. */
export interface PayeeCheckItem {
    pesCod: string;
    modalidade: AuthorizedPayeeModality;
    filCod: number;
}

/** Resultado da verificação de um par (I14d). Só a máscara, nunca o valor. */
export interface PayeeCheckOutcome {
    resultado: PayeeCheckResult;
    autorizacaoId?: string;
    destinoMascarado?: string;
}

/** O que o cadastro resolve AGORA para o par, sem o valor (a tela de decisão e o selo). */
export interface DestinoAtual {
    resultado: 'OK' | 'SEM_DADO' | 'FALHA_LEITURA';
    destinoMascarado?: string;
    /** A impressão que a tela devolve no `aprovar` (anti-TOCTOU, I14c). Não é reversível. */
    fingerprint?: string;
    avisos: PayeeWarning[];
}

/** Leitura completa do cadastro — USO INTERNO deste serviço (o destino nunca sai daqui, salvo revelar). */
interface LeituraCadastro {
    leitura: PayeeDestinationReading;
    destino?: PayeeDestination;
    destinoMascarado?: string;
    avisos: PayeeWarning[];
}

/** Chave do mapa de resultados. */
export const chaveDoPar = (pesCod: string, modalidade: string): string => `${pesCod}:${modalidade}`;

/**
 * AuthorizedPayeeService — favorecido autorizado (ADR-0065, I14): pedir/confirmar (F1/F5), aprovar
 * (F2/F6), rejeitar (F3), revogar (F7), a verificação única `verificarDestinoAutorizado` (I14d, que
 * dispara F4), reconferir e revelar auditado.
 *
 * O destino é SEMPRE o que o `DestinoPagamentoResolver` resolve do cadastro do Conexos, ao vivo
 * (regra do cadastro: conta default para TED, ordem I10k para PIX). O que se guarda e compara é a
 * impressão HMAC (`PayeeFingerprint`). O valor completo nunca vai para log, trilha ou erro (I14j):
 * só o `revelar` o devolve, na resposta, e grava que revelou.
 *
 * Toda mudança de estado vai com o evento na MESMA transação e com lock otimista por `versao`.
 * Com a guarda desligada no tenant, ou a flag da modalidade desligada (I14k), a verificação responde
 * FAVORECIDO_NAO_AUTORIZADO para o par sem ler o Conexos: TED/PIX nunca passam sem a guarda.
 */
@injectable()
export default class AuthorizedPayeeService {
    public constructor(
        @inject(AuthorizedPayeeRepository) private readonly repo: AuthorizedPayeeRepository,
        @inject(AuthorizedPayeeRule) private readonly rule: AuthorizedPayeeRule,
        @inject(DestinoPagamentoResolver) private readonly resolver: DestinoPagamentoResolver,
        @inject(PayeeFingerprint) private readonly fingerprint: PayeeFingerprint,
        @inject(NotificacaoService) private readonly notificacao: NotificacaoService,
        @inject(EnvironmentProvider) private readonly environmentProvider: EnvironmentProvider,
        @inject(PostgreeDatabaseClient) private readonly db: PostgreeDatabaseClient,
        @inject(LogService) private readonly logService: LogService,
    ) {}

    public listar = (filtro: FiltroAutorizacoes = {}): Promise<AuthorizedPayee[]> =>
        this.repo.listar(filtro);

    public eventos = async (id: string): Promise<AuthorizedPayeeEventRecord[]> => {
        await this.exigir(id);
        return this.repo.listarEventos(id);
    };

    /**
     * F1/F5 — `sispag:executar`. Sem vigente: cria PENDENTE (nunca AUTORIZADO). Reaprovação aberta
     * pelo sistema: o pedido a CONFIRMA (grava quem pediu, que fica impedido de aprovar).
     */
    public solicitar = async (input: {
        pesCod: string;
        credor?: string;
        modalidade: AuthorizedPayeeModality;
        origem: PayeeRequestOrigin;
        /** Filial só para ler o cadastro; ausente, a do tenant (`sispagCadastroFilCod`). */
        filCod?: number;
        ator: string;
    }): Promise<AuthorizedPayee> => {
        const filCodLeitura =
            input.filCod ??
            (await this.environmentProvider.getEnvironmentVars()).sispagCadastroFilCod;
        const vigente = await this.repo.buscarVigente(input.pesCod, input.modalidade);
        const acao = this.rule.solicitar(vigente);
        let id: string;
        if (acao === 'CONFIRMAR' && vigente) {
            id = vigente.id;
            await this.db.withTransaction(async (tx) => {
                const n = await this.repo.atualizarComVersao(
                    vigente.id,
                    vigente.versao,
                    { solicitadoPor: input.ator, solicitadoEm: new Date() },
                    tx,
                );
                if (n === 0) this.conflito(vigente);
                await this.repo.registrarEvento(
                    {
                        autorizacaoId: vigente.id,
                        evento: AUTHORIZED_PAYEE_EVENT.CONFIRMADO,
                        ator: input.ator,
                        dados: { origem: input.origem },
                    },
                    tx,
                );
            });
        } else {
            id = await this.db.withTransaction(async (tx) => {
                const novo = await this.repo.inserir(
                    {
                        pesCod: input.pesCod,
                        ...(input.credor ? { credor: input.credor } : {}),
                        modalidade: input.modalidade,
                        origemSolicitacao: input.origem,
                        filCodLeitura,
                        solicitadoPor: input.ator,
                    },
                    tx,
                );
                await this.repo.registrarEvento(
                    {
                        autorizacaoId: novo,
                        evento: AUTHORIZED_PAYEE_EVENT.SOLICITADO,
                        ator: input.ator,
                        dados: { origem: input.origem },
                    },
                    tx,
                );
                return novo;
            });
        }
        await this.logService.info({
            type: LOG_TYPE.BUSINESS_INFO,
            message:
                acao === 'CONFIRMAR'
                    ? 'favorecido autorizado: reaprovação confirmada'
                    : 'favorecido autorizado: autorização pedida',
            data: { id, pesCod: input.pesCod, modalidade: input.modalidade, ator: input.ator },
        });
        return this.exigir(id);
    };

    /**
     * F2/F6 — `sispag:autorizar_favorecido`. Lê o `cmn025` ao vivo e só aprova se o destino de
     * agora tem a MESMA impressão que a tela mostrou (anti-TOCTOU); aprovador ≠ solicitante.
     */
    public aprovar = async (input: {
        id: string;
        fingerprintMostrado: string;
        versao: number;
        ator: string;
    }): Promise<AuthorizedPayee> => {
        const atual = await this.exigirVersao(input.id, input.versao);
        const lido = await this.lerCadastro(atual.pesCod, atual.modalidade, atual.filCodLeitura);
        this.rule.aprovar(atual, {
            ator: input.ator,
            leitura: lido.leitura,
            fingerprintMostrado: input.fingerprintMostrado,
        });
        if (lido.leitura.status !== 'OK') {
            // Inalcançável: `rule.aprovar` já recusou leitura sem dado ou com falha.
            throw new PayeeDestinationChangedSinceShownError({ id: atual.id });
        }
        const agora = new Date();
        await this.db.withTransaction(async (tx) => {
            const n = await this.repo.atualizarComVersao(
                atual.id,
                atual.versao,
                {
                    estado: AUTHORIZED_PAYEE_STATE.AUTORIZADO,
                    fingerprint: lido.leitura.status === 'OK' ? lido.leitura.fingerprint : null,
                    fingerprintChaveId: lido.leitura.status === 'OK' ? lido.leitura.keyId : null,
                    destinoMascarado: lido.destinoMascarado ?? null,
                    avisos: lido.avisos,
                    fingerprintObservado: null,
                    destinoObservadoMascarado: null,
                    decididoPor: input.ator,
                    decididoEm: agora,
                    motivoDecisao: null,
                    ultimaConferenciaEm: agora,
                    ultimaConferenciaResultado: PAYEE_RECHECK_RESULT.IGUAL,
                },
                tx,
            );
            if (n === 0) this.conflito(atual);
            await this.repo.registrarEvento(
                {
                    autorizacaoId: atual.id,
                    evento: AUTHORIZED_PAYEE_EVENT.APROVADO,
                    ator: input.ator,
                    dados: {
                        de: atual.estado,
                        destinoMascarado: lido.destinoMascarado,
                        ...(atual.destinoMascarado
                            ? { destinoAnteriorMascarado: atual.destinoMascarado }
                            : {}),
                        avisos: lido.avisos,
                    },
                },
                tx,
            );
        });
        await this.logService.info({
            type: LOG_TYPE.BUSINESS_INFO,
            message: 'favorecido autorizado: aprovado',
            data: {
                id: atual.id,
                pesCod: atual.pesCod,
                modalidade: atual.modalidade,
                ator: input.ator,
            },
        });
        return this.exigir(atual.id);
    };

    /** F3 — `sispag:autorizar_favorecido`; motivo obrigatório. */
    public rejeitar = (input: {
        id: string;
        motivo: string;
        versao: number;
        ator: string;
    }): Promise<AuthorizedPayee> =>
        this.decidir(input, AUTHORIZED_PAYEE_EVENT.REJEITADO, (atual) =>
            this.rule.rejeitar(atual, input.motivo),
        );

    /** F7 — `sispag:autorizar_favorecido`; motivo obrigatório. Pedido novo = outro registro. */
    public revogar = (input: {
        id: string;
        motivo: string;
        versao: number;
        ator: string;
    }): Promise<AuthorizedPayee> =>
        this.decidir(input, AUTHORIZED_PAYEE_EVENT.REVOGADO, (atual) =>
            this.rule.revogar(atual, input.motivo),
        );

    /**
     * I14d — a função ÚNICA de verificação. Um resultado por (favorecido, modalidade); uma leitura
     * do cadastro por par (cache do resolver) e UMA consulta de autorizações para todos.
     * `DESTINO_ALTERADO` sobre uma AUTORIZADO abre a reaprovação (F4) e emite o alerta. Falha de
     * leitura não muda nada (I14f).
     */
    public verificarDestinoAutorizado = async (
        itens: readonly PayeeCheckItem[],
        opcoes: { cache?: CacheCadastroDestino } = {},
    ): Promise<Map<string, PayeeCheckOutcome>> => {
        const resultado = new Map<string, PayeeCheckOutcome>();
        const pares = this.paresDistintos(itens);
        if (pares.size === 0) return resultado;

        // I14k: guarda desligada no tenant, ou modalidade desligada, = nenhum TED/PIX passa. A flag
        // da modalidade entra porque, com ela desligada, o envio usa a regra antiga (conta no
        // banco do lote) — um destino que a impressão aprovada (conta default) não cobre.
        const env = await this.environmentProvider.getEnvironmentVars();
        const habilitada = (m: AuthorizedPayeeModality): boolean =>
            env.sispagFavorecidoAutorizadoEnabled === true &&
            (m === AUTHORIZED_PAYEE_MODALITY.TED
                ? env.sispagTedEnabled === true
                : env.sispagPixEnabled === true);
        for (const [k, par] of pares) {
            if (habilitada(par.modalidade)) continue;
            resultado.set(k, { resultado: PAYEE_CHECK_RESULT.FAVORECIDO_NAO_AUTORIZADO });
            pares.delete(k);
        }
        if (pares.size === 0) return resultado;

        const vigentes = await this.repo.listarVigentesPorPesCods(
            [...pares.values()].map((p) => p.pesCod),
        );
        const porPar = new Map(vigentes.map((v) => [chaveDoPar(v.pesCod, v.modalidade), v]));
        const cache = opcoes.cache ?? this.resolver.novoCache();
        for (const [k, par] of pares) {
            resultado.set(k, await this.verificarPar(par, porPar.get(k) ?? null, cache));
        }
        await this.registrarVerificacao(resultado);
        return resultado;
    };

    /**
     * "Reconferir com o Conexos" (selo, I14l) — `sispag:ver`. Atualiza `ultimaConferencia*`, grava
     * CONFERIDO e pode abrir a reaprovação (F4). Devolve também o destino ATUAL mascarado e a
     * impressão que a tela de decisão envia no `aprovar`.
     */
    public reconferir = async (
        id: string,
        ator: string,
    ): Promise<{ autorizacao: AuthorizedPayee; atual: DestinoAtual }> => {
        const atual = await this.exigir(id);
        const lido = await this.lerCadastro(atual.pesCod, atual.modalidade, atual.filCodLeitura);
        const destinoAtual: DestinoAtual = {
            resultado: lido.leitura.status,
            ...(lido.destinoMascarado ? { destinoMascarado: lido.destinoMascarado } : {}),
            ...(lido.leitura.status === 'OK' ? { fingerprint: lido.leitura.fingerprint } : {}),
            avisos: lido.avisos,
        };
        if (this.rule.abreReaprovacao(atual, lido.leitura)) {
            await this.abrirReaprovacao(atual, lido, ator);
            return { autorizacao: await this.exigir(id), atual: destinoAtual };
        }
        const conferencia = this.resultadoDaConferencia(atual, lido.leitura);
        await this.db.withTransaction(async (tx) => {
            const n = await this.repo.atualizarComVersao(
                atual.id,
                atual.versao,
                {
                    ultimaConferenciaEm: new Date(),
                    ...(conferencia ? { ultimaConferenciaResultado: conferencia } : {}),
                },
                tx,
            );
            if (n === 0) this.conflito(atual);
            await this.repo.registrarEvento(
                {
                    autorizacaoId: atual.id,
                    evento: AUTHORIZED_PAYEE_EVENT.CONFERIDO,
                    ator,
                    dados: {
                        resultado: conferencia ?? 'SEM_APROVACAO',
                        ...(lido.destinoMascarado
                            ? { destinoMascarado: lido.destinoMascarado }
                            : {}),
                    },
                },
                tx,
            );
        });
        return { autorizacao: await this.exigir(id), atual: destinoAtual };
    };

    /**
     * Prévia do pedido (`buscarFavorecidoConexos`) — `sispag:executar`. O que o cadastro resolve
     * AGORA para (favorecido, modalidade), mascarado (I14l), lido na filial do tenant, a mesma do
     * pedido. Sem impressão (só a tela de decisão a recebe) e sem escrita: não há registro ainda.
     */
    public destinoAtual = async (
        pesCod: string,
        modalidade: AuthorizedPayeeModality,
    ): Promise<Omit<DestinoAtual, 'fingerprint'>> => {
        const filCod = (await this.environmentProvider.getEnvironmentVars()).sispagCadastroFilCod;
        const lido = await this.lerCadastro(pesCod, modalidade, filCod);
        return {
            resultado: lido.leitura.status,
            ...(lido.destinoMascarado ? { destinoMascarado: lido.destinoMascarado } : {}),
            avisos: lido.avisos,
        };
    };

    /**
     * Revelar o destino completo (I14l) — `sispag:autorizar_favorecido`. Lido AO VIVO do `cmn025`,
     * devolvido SÓ na resposta. A trilha grava que revelou (com a máscara), nunca o valor.
     */
    public revelar = async (
        id: string,
        ator: string,
    ): Promise<{ destino: PayeeDestination; destinoMascarado: string }> => {
        const atual = await this.exigir(id);
        const lido = await this.lerCadastro(atual.pesCod, atual.modalidade, atual.filCodLeitura);
        if (lido.leitura.status === 'FALHA_LEITURA') {
            throw new PayeeDestinationChangedSinceShownError({ id: atual.id });
        }
        if (!lido.destino || !lido.destinoMascarado) {
            throw new PayeeWithoutPaymentDataError({ id: atual.id, modalidade: atual.modalidade });
        }
        await this.repo.registrarEvento({
            autorizacaoId: atual.id,
            evento: AUTHORIZED_PAYEE_EVENT.DESTINO_REVELADO,
            ator,
            dados: { destinoMascarado: lido.destinoMascarado },
        });
        await this.logService.info({
            type: LOG_TYPE.BUSINESS_INFO,
            message: 'favorecido autorizado: destino revelado',
            data: { id: atual.id, pesCod: atual.pesCod, modalidade: atual.modalidade, ator },
        });
        return { destino: lido.destino, destinoMascarado: lido.destinoMascarado };
    };

    // ------------------------------------------------------------------ internals

    private paresDistintos = (itens: readonly PayeeCheckItem[]): Map<string, PayeeCheckItem> => {
        const pares = new Map<string, PayeeCheckItem>();
        for (const i of itens) {
            const k = chaveDoPar(i.pesCod, i.modalidade);
            if (!pares.has(k)) pares.set(k, i);
        }
        return pares;
    };

    /** Um par: lê o cadastro, classifica (I14d) e, se for o caso, abre a reaprovação (F4). */
    private verificarPar = async (
        par: PayeeCheckItem,
        vigente: AuthorizedPayee | null,
        cache: CacheCadastroDestino,
    ): Promise<PayeeCheckOutcome> => {
        const lido = await this.lerCadastro(par.pesCod, par.modalidade, par.filCod, cache);
        const resultado = this.rule.classificar(vigente, lido.leitura);
        if (vigente && this.rule.abreReaprovacao(vigente, lido.leitura)) {
            await this.abrirReaprovacao(vigente, lido);
        }
        return {
            resultado,
            ...(vigente ? { autorizacaoId: vigente.id } : {}),
            ...(lido.destinoMascarado ? { destinoMascarado: lido.destinoMascarado } : {}),
        };
    };

    private registrarVerificacao = async (
        resultado: ReadonlyMap<string, PayeeCheckOutcome>,
    ): Promise<void> => {
        const naoOk = [...resultado.values()].filter((o) => o.resultado !== PAYEE_CHECK_RESULT.OK);
        await (naoOk.length > 0 ? this.logService.warn : this.logService.info)({
            type: naoOk.length > 0 ? LOG_TYPE.BUSINESS_WARN : LOG_TYPE.BUSINESS_INFO,
            message: 'favorecido autorizado: verificação concluída',
            data: {
                pares: resultado.size,
                naoOk: naoOk.length,
                resultados: [...resultado.entries()].map(([par, o]) => `${par}=${o.resultado}`),
            },
        });
    };

    private decidir = async (
        input: { id: string; motivo: string; versao: number; ator: string },
        evento: typeof AUTHORIZED_PAYEE_EVENT.REJEITADO | typeof AUTHORIZED_PAYEE_EVENT.REVOGADO,
        transicao: (atual: AuthorizedPayee) => AuthorizedPayee['estado'],
    ): Promise<AuthorizedPayee> => {
        const atual = await this.exigirVersao(input.id, input.versao);
        const para = transicao(atual);
        const motivo = input.motivo.trim();
        await this.db.withTransaction(async (tx) => {
            const n = await this.repo.atualizarComVersao(
                atual.id,
                atual.versao,
                {
                    estado: para,
                    decididoPor: input.ator,
                    decididoEm: new Date(),
                    motivoDecisao: motivo,
                },
                tx,
            );
            if (n === 0) this.conflito(atual);
            await this.repo.registrarEvento(
                {
                    autorizacaoId: atual.id,
                    evento,
                    ator: input.ator,
                    dados: { de: atual.estado, motivo },
                },
                tx,
            );
        });
        await this.logService.info({
            type: LOG_TYPE.BUSINESS_INFO,
            message: `favorecido autorizado: ${para === AUTHORIZED_PAYEE_STATE.REJEITADO ? 'rejeitado' : 'revogado'}`,
            data: {
                id: atual.id,
                pesCod: atual.pesCod,
                modalidade: atual.modalidade,
                ator: input.ator,
            },
        });
        return this.exigir(atual.id);
    };

    /**
     * F4 (sistema): AUTORIZADO → REAPROVACAO_PENDENTE, guarda a impressão e a máscara observadas,
     * LIMPA o solicitante (o sistema não conta como solicitante) e emite o alerta com dedup por
     * favorecido + modalidade. Se outra verificação já abriu (versão mudou), não faz nada.
     */
    private abrirReaprovacao = async (
        vigente: AuthorizedPayee,
        lido: LeituraCadastro,
        ator: string = PAYEE_SYSTEM_ACTOR,
    ): Promise<void> => {
        if (lido.leitura.status !== 'OK') return;
        const observado = lido.leitura.fingerprint;
        const aplicado = await this.db.withTransaction(async (tx) => {
            const n = await this.repo.atualizarComVersao(
                vigente.id,
                vigente.versao,
                {
                    estado: AUTHORIZED_PAYEE_STATE.REAPROVACAO_PENDENTE,
                    fingerprintObservado: observado,
                    destinoObservadoMascarado: lido.destinoMascarado ?? null,
                    solicitadoPor: null,
                    solicitadoEm: null,
                    ultimaConferenciaEm: new Date(),
                    ultimaConferenciaResultado: PAYEE_RECHECK_RESULT.DIFERENTE,
                },
                tx,
            );
            if (n === 0) return false;
            await this.repo.registrarEvento(
                {
                    autorizacaoId: vigente.id,
                    evento: AUTHORIZED_PAYEE_EVENT.REAPROVACAO_ABERTA,
                    ator: PAYEE_SYSTEM_ACTOR,
                    dados: {
                        antes: vigente.destinoMascarado,
                        agora: lido.destinoMascarado,
                        ...(ator !== PAYEE_SYSTEM_ACTOR ? { conferidoPor: ator } : {}),
                    },
                },
                tx,
            );
            return true;
        });
        if (!aplicado) return;
        await this.logService.warn({
            type: LOG_TYPE.BUSINESS_WARN,
            message: 'favorecido autorizado: destino mudou no cadastro — reaprovação aberta',
            data: { id: vigente.id, pesCod: vigente.pesCod, modalidade: vigente.modalidade },
        });
        try {
            await this.notificacao.emitir({
                tipo: ALERTA_TIPO.SISPAG_DESTINO_ALTERADO,
                alvo: `favorecido:${vigente.pesCod}:${vigente.modalidade}`,
                severidade: ALERTA_SEVERIDADE.AVISO,
                janelaInicio: new Date(vigente.decididoEm ?? vigente.solicitadoEm ?? Date.now()),
                detalhe: {
                    autorizacaoId: vigente.id,
                    pesCod: vigente.pesCod,
                    ...(vigente.credor ? { credor: vigente.credor } : {}),
                    modalidade: vigente.modalidade,
                    antes: vigente.destinoMascarado,
                    agora: lido.destinoMascarado,
                },
            });
        } catch (error) {
            // A reaprovação já está gravada (e a guarda já barra o pagamento): perder o alerta não
            // pode desfazer nada. Fica registrado.
            await this.logService
                .warn({
                    type: LOG_TYPE.BUSINESS_WARN,
                    message: 'favorecido autorizado: alerta de destino alterado não foi emitido',
                    data: { id: vigente.id, erro: this.motivo(error) },
                })
                .catch(() => undefined);
        }
    };

    /**
     * Lê o cadastro (`cmn025`) pela regra do cadastro (TED default, PIX I10k) e reduz ao que a
     * regra precisa: impressão + máscara + avisos. Falha de leitura vira `FALHA_LEITURA` (nunca
     * "sem dado") e é logada só com o status HTTP (a mensagem pode citar a conta, I10h).
     */
    private lerCadastro = async (
        pesCod: string,
        modalidade: AuthorizedPayeeModality,
        filCod: number,
        cache?: CacheCadastroDestino,
    ): Promise<LeituraCadastro> => {
        try {
            const resolvido = await this.resolver.resolve(
                { modalidade },
                {
                    flags: { ted: true, pix: true },
                    filCod,
                    pesCod,
                    ...(cache ? { cache } : {}),
                },
            );
            if (resolvido.origem !== DESTINO_ORIGEM.CADASTRO) {
                return { leitura: { status: 'SEM_DADO' }, avisos: [] };
            }
            const destino = this.resolver.destinoFavorecido(resolvido);
            if (!destino) return { leitura: { status: 'SEM_DADO' }, avisos: [] };
            const fp = await this.fingerprint.calcular(destino);
            const avisos: PayeeWarning[] =
                modalidade === AUTHORIZED_PAYEE_MODALITY.PIX &&
                resolvido.tipo === DESTINO_CADASTRO_TIPO.CHAVE_PIX &&
                resolvido.chaveDoDocumentoDoFavorecido !== true
                    ? [PAYEE_WARNING.PIX_CHAVE_NAO_E_DOCUMENTO_DO_FAVORECIDO]
                    : [];
            const destinoMascarado = this.resolver.mascarar(resolvido);
            return {
                leitura: { status: 'OK', fingerprint: fp.fingerprint, keyId: fp.keyId },
                destino,
                ...(destinoMascarado ? { destinoMascarado } : {}),
                avisos,
            };
        } catch (error) {
            await this.logService.warn({
                type: LOG_TYPE.BUSINESS_WARN,
                message: 'favorecido autorizado: leitura do cadastro do Conexos falhou',
                data: { pesCod, modalidade, filCod, erro: this.motivo(error) },
            });
            return { leitura: { status: 'FALHA_LEITURA' }, avisos: [] };
        }
    };

    /** Selo da reconferência. Sem impressão aprovada (PENDENTE) só SEM_DADO/FALHA são informação. */
    private resultadoDaConferencia = (
        atual: AuthorizedPayee,
        leitura: PayeeDestinationReading,
    ): PayeeRecheckResult | undefined => {
        if (leitura.status === 'FALHA_LEITURA') return PAYEE_RECHECK_RESULT.FALHA_LEITURA;
        if (leitura.status === 'SEM_DADO') return PAYEE_RECHECK_RESULT.SEM_DADO;
        if (!atual.fingerprint) return undefined;
        return atual.fingerprint === leitura.fingerprint &&
            atual.fingerprintChaveId === leitura.keyId
            ? PAYEE_RECHECK_RESULT.IGUAL
            : PAYEE_RECHECK_RESULT.DIFERENTE;
    };

    private exigir = async (id: string): Promise<AuthorizedPayee> => {
        const r = await this.repo.buscarPorId(id);
        if (!r) throw new AuthorizedPayeeNotFoundError({ id });
        return r;
    };

    private exigirVersao = async (id: string, versao: number): Promise<AuthorizedPayee> => {
        const r = await this.exigir(id);
        if (r.versao !== versao) {
            throw new AuthorizedPayeeVersionConflictError({ id, versaoEsperada: versao });
        }
        return r;
    };

    private conflito = (atual: AuthorizedPayee): never => {
        throw new AuthorizedPayeeVersionConflictError({
            id: atual.id,
            versaoEsperada: atual.versao,
        });
    };

    /** Só o status HTTP ou o tipo do erro — a mensagem pode citar conta/chave (I10h). */
    private motivo = (error: unknown): string => {
        const status = (error as { response?: { status?: number } } | undefined)?.response?.status;
        if (status !== undefined) return `HTTP ${status}`;
        return error instanceof Error ? error.name : 'erro desconhecido';
    };
}
