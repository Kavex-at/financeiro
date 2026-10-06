import { inject, injectable } from 'tsyringe';
import ConexosSispagClient from '../../client/ConexosSispagClient.js';
import PostgreeDatabaseClient, {
    type TransactionClient,
} from '../../client/database/PostgreeDatabaseClient.js';
import { LOG_TYPE } from '../../interface/log/LogInterface.js';
import {
    CHANNEL_CONFIDENCE,
    CHANNEL_GROUP,
    type ChannelProfile,
    type ChaveTitulo,
    DESTINO_MANUAL_TIPO,
    type DuplicateCandidate,
    type DuplicateMatch,
    ITEM_ALERT_STATE,
    ITEM_ALERT_TYPE,
    type ItemLote,
    LOTE_STATUS,
    MODALIDADE,
    PAYEE_ISSUE_OUTCOME,
    PAYMENT_CHECK_STATE,
    SISPAG_SYSTEM_ACTOR,
} from '../../interface/sispag/SispagInterface.js';
import EnvironmentProvider from '../../libs/environment/EnvironmentProvider.js';
import type { SispagVerificacaoConfig } from '../../libs/environment/model/EnvironmentVars.js';
import AlertaItemLoteRepository from '../../repository/sispag/AlertaItemLoteRepository.js';
import LotePagamentoRepository from '../../repository/sispag/LotePagamentoRepository.js';
import PendenciaCadastroRepository from '../../repository/sispag/PendenciaCadastroRepository.js';
import PerfilCanalFornecedorRepository from '../../repository/sispag/PerfilCanalFornecedorRepository.js';
import LogService from '../LogService.js';
import DestinoPagamentoResolver, {
    type CacheCadastroDestino,
    DESTINO_ORIGEM,
    type DestinoResolvido,
    type FlagsDestino,
} from './DestinoPagamentoResolver.js';
import DuplicateDetector from './DuplicateDetector.js';

/** Um item citado no resultado — o título, o credor e a forma de pagamento (nunca o destino). */
export interface ItemVerificado {
    filCod: number;
    docCod: string;
    titCod: string;
    credor?: string;
    modalidade?: string;
}

export interface ResultadoVerificacao {
    /** Itens TED/PIX verificados com sucesso (estado OK). */
    verificados: ItemVerificado[];
    /** Itens que ficaram PENDENTE (leitura do Conexos falhou — I13b). */
    pendentes: ItemVerificado[];
    /** Itens retirados do lote pelo sistema por falta de dado de pagamento (I13j-1). */
    retirados: ItemVerificado[];
}

export interface OpcoesVerificacao {
    /** Só estes itens (edição de modalidade); ausente = todos os TED/PIX do lote (finalizar). */
    itens?: ChaveTitulo[];
    /** Só o finalizar liga (ADR-0061 I12c): aposenta a exceção que o cadastro tornou desnecessária. */
    aposentarExcecao?: boolean;
}

/** Leitura do fin064 da filial nesta rodada: os candidatos, ou a falha (→ PENDENTE). */
type LeituraFilial = { ok: true; titulos: DuplicateCandidate[] } | { ok: false };

const MODALIDADES_VERIFICADAS: ReadonlySet<string> = new Set([MODALIDADE.TED, MODALIDADE.PIX]);

/** Chave de estabilidade da alerta (I13h): tipo + contraparte (filial, documento). */
const chaveAlerta = (tipo: string, filCod?: number, docCod?: string): string =>
    `${tipo}|${filCod ?? ''}|${docCod ?? ''}`;

/**
 * VerificacaoTedPixService — `verificarItensTedPix` (ADR-0063, I13a–k). Só itens TED/PIX; BOLETO,
 * "a definir" e CRÉDITO EM CONTA legado nunca. NADA é escrito no Conexos: lê o `fin064` (duplicidade)
 * e o `cmn025` (via `DestinoPagamentoResolver`, a mesma função da oferta e do envio, I10b), e grava
 * só no Postgres.
 *
 * Ordem por item (ver `actions/sispag/verificar-itens-ted-pix.md`):
 *   1. dados de pagamento (I13j) — com a flag da modalidade ligada; sem dado e sem exceção APROVADA
 *      o item SAI do lote (ator `sistema`) e abre `PendenciaCadastro`; com exceção, fica e abre;
 *      com cadastro, resolve a pendência ABERTA do par (I13k). Item retirado não segue.
 *   2. duplicidade (I13c–e, I13h) — `DuplicateDetector` sobre o fin064 da filial.
 *   3. canal habitual (I13i) — `PerfilCanalFornecedor` local, só ALTA divergente de TED_PIX.
 *
 * FALHA FECHADA (I13b): leitura do Conexos que falha nos passos 1–2 deixa o item `PENDENTE` e não
 * cria, não fecha, não retira e não abre pendência.
 */
@injectable()
export default class VerificacaoTedPixService {
    public constructor(
        @inject(LotePagamentoRepository) private readonly loteRepo: LotePagamentoRepository,
        @inject(AlertaItemLoteRepository) private readonly alertaRepo: AlertaItemLoteRepository,
        @inject(PendenciaCadastroRepository)
        private readonly pendenciaRepo: PendenciaCadastroRepository,
        @inject(PerfilCanalFornecedorRepository)
        private readonly perfilRepo: PerfilCanalFornecedorRepository,
        @inject(ConexosSispagClient) private readonly sispag: ConexosSispagClient,
        @inject(DestinoPagamentoResolver) private readonly resolver: DestinoPagamentoResolver,
        @inject(DuplicateDetector) private readonly detector: DuplicateDetector,
        @inject(EnvironmentProvider) private readonly environmentProvider: EnvironmentProvider,
        @inject(PostgreeDatabaseClient) private readonly db: PostgreeDatabaseClient,
        @inject(LogService) private readonly logService: LogService,
    ) {}

    /** `true` quando o item é alvo da verificação (TED ou PIX). */
    public ehVerificavel = (item: Pick<ItemLote, 'modalidade'>): boolean =>
        item.modalidade !== undefined && MODALIDADES_VERIFICADAS.has(item.modalidade);

    public verificarItens = async (
        loteId: string,
        opcoes: OpcoesVerificacao = {},
    ): Promise<ResultadoVerificacao> => {
        const resultado: ResultadoVerificacao = { verificados: [], pendentes: [], retirados: [] };
        const lote = await this.loteRepo.getLoteComItens(loteId);
        if (!lote || lote.status !== LOTE_STATUS.RASCUNHO) return resultado;
        const filtro = opcoes.itens?.map((c) => `${c.filCod}:${c.docCod}:${c.titCod}`);
        const alvo = lote.itens.filter(
            (i) =>
                this.ehVerificavel(i) &&
                (!filtro || filtro.includes(`${i.filCod}:${i.docCod}:${i.titCod}`)),
        );
        if (alvo.length === 0) return resultado;

        const env = await this.environmentProvider.getEnvironmentVars();
        const config = env.sispagVerificacao;
        const flags: FlagsDestino = {
            ted: env.sispagTedEnabled === true,
            pix: env.sispagPixEnabled === true,
            excecao: env.sispagExcecaoDestinoEnabled === true,
        };
        const leituras = new Map<number, LeituraFilial>();
        const cache = this.resolver.novoCache();

        for (const item of alvo) {
            const leitura = await this.lerFilial(leituras, item.filCod, config, loteId);
            const ref = this.ref(item);
            const desfecho = await this.verificarItem({
                loteId,
                item,
                leitura,
                flags,
                config,
                cache,
                aposentarExcecao: opcoes.aposentarExcecao === true,
            });
            resultado[desfecho].push(ref);
        }

        const registrar =
            resultado.pendentes.length > 0 || resultado.retirados.length > 0
                ? this.logService.warn
                : this.logService.info;
        await registrar({
            type:
                resultado.pendentes.length > 0 || resultado.retirados.length > 0
                    ? LOG_TYPE.BUSINESS_WARN
                    : LOG_TYPE.BUSINESS_INFO,
            message: 'verificação TED/PIX concluída',
            data: {
                loteId,
                filCod: lote.filCod,
                itens: alvo.length,
                verificados: resultado.verificados.length,
                pendentes: resultado.pendentes.length,
                retirados: resultado.retirados.length,
            },
        });
        return resultado;
    };

    /**
     * I13a — o item deixou de ser TED/PIX (BOLETO ou "a definir"): as alertas vivas dele são
     * DESCARTADAS (evento na trilha) e o estado da verificação some.
     */
    public descartarVerificacao = async (
        loteId: string,
        chave: ChaveTitulo,
        ator: string,
    ): Promise<number> =>
        this.db.withTransaction(async (tx) => {
            const n = await this.alertaRepo.descartarDoItem(loteId, chave, ator, tx);
            await this.loteRepo.limparVerificacaoItem({ loteId, ...chave }, tx);
            return n;
        });

    // ------------------------------------------------------------------ internals

    private ref = (item: ItemLote): ItemVerificado => ({
        filCod: item.filCod,
        docCod: item.docCod,
        titCod: item.titCod,
        ...(item.credor ? { credor: item.credor } : {}),
        ...(item.modalidade ? { modalidade: item.modalidade } : {}),
    });

    /** fin064 da filial, uma vez por rodada. Falha vira `{ ok: false }` (→ PENDENTE), nunca "vazio". */
    private lerFilial = async (
        leituras: Map<number, LeituraFilial>,
        filCod: number,
        config: SispagVerificacaoConfig,
        loteId: string,
    ): Promise<LeituraFilial> => {
        const existente = leituras.get(filCod);
        if (existente) return existente;
        let leitura: LeituraFilial;
        try {
            leitura = {
                ok: true,
                titulos: await this.sispag.listTitulosParaDuplicidade(
                    filCod,
                    config.duplicidadeDesde,
                ),
            };
        } catch (error) {
            await this.logService.warn({
                type: LOG_TYPE.BUSINESS_WARN,
                message: 'verificação TED/PIX: leitura do fin064 falhou — itens ficam pendentes',
                data: { loteId, filCod, erro: this.motivo(error) },
            });
            leitura = { ok: false };
        }
        leituras.set(filCod, leitura);
        return leitura;
    };

    private verificarItem = async (ctx: {
        loteId: string;
        item: ItemLote;
        leitura: LeituraFilial;
        flags: FlagsDestino;
        config: SispagVerificacaoConfig;
        cache: CacheCadastroDestino;
        aposentarExcecao: boolean;
    }): Promise<keyof ResultadoVerificacao> => {
        const { loteId, item, leitura } = ctx;
        const chave: ChaveTitulo = {
            filCod: item.filCod,
            docCod: item.docCod,
            titCod: item.titCod,
        };
        if (!leitura.ok) return this.pendente(loteId, chave, 'fin064 indisponível');
        const proprio = leitura.titulos.find(
            (t) => t.docCod === item.docCod && t.titCod === item.titCod,
        );
        const pesCod = proprio?.favorecido;
        if (!proprio || !pesCod) {
            return this.pendente(
                loteId,
                chave,
                proprio ? 'favorecido ausente no fin064' : 'título não encontrado no fin064',
            );
        }

        // 1. Dados de pagamento (I13j) — só com a flag da modalidade ligada (com ela desligada o
        //    TED/PIX segue a regra de antes e o envio continua sendo a autoridade).
        let destino: DestinoResolvido | undefined;
        if (this.flagDaModalidade(item, ctx.flags)) {
            try {
                destino = await this.resolver.resolve(
                    { modalidade: item.modalidade },
                    {
                        flags: ctx.flags,
                        filCod: item.filCod,
                        pesCod,
                        cache: ctx.cache,
                        ...(ctx.aposentarExcecao ? { aposentarExcecao: true } : {}),
                    },
                );
            } catch (error) {
                return this.pendente(loteId, chave, `cadastro indisponível: ${this.motivo(error)}`);
            }
            if (destino.origem === DESTINO_ORIGEM.NENHUM) {
                await this.retirarSemDado(loteId, item, pesCod, proprio.credor);
                return 'retirados';
            }
        }

        // 2. Duplicidade (I13c–e) e 3. canal habitual (I13i).
        const achados = this.detector.detectar(proprio, leitura.titulos, {
            janelaFracaDias: ctx.config.duplicidadeJanelaDias,
        });
        const perfil = await this.perfilRepo.findByPesCod(pesCod);
        await this.db.withTransaction(async (tx) => {
            if (destino) await this.registrarPendencia(loteId, item, pesCod, destino, tx);
            await this.reconciliarAlertas(loteId, chave, achados, perfil, tx);
            await this.loteRepo.marcarVerificacaoItem(
                {
                    loteId,
                    ...chave,
                    estado: PAYMENT_CHECK_STATE.OK,
                    ...(destino
                        ? {
                              destinoOrigem: destino.origem,
                              ...this.mascara(destino),
                          }
                        : {}),
                },
                tx,
            );
        });
        return 'verificados';
    };

    private flagDaModalidade = (item: ItemLote, flags: FlagsDestino): boolean =>
        (item.modalidade === MODALIDADE.TED && flags.ted) ||
        (item.modalidade === MODALIDADE.PIX && flags.pix);

    private tipoPendencia = (item: ItemLote) =>
        item.modalidade === MODALIDADE.PIX
            ? DESTINO_MANUAL_TIPO.CHAVE_PIX
            : DESTINO_MANUAL_TIPO.CONTA;

    private mascara = (destino: DestinoResolvido): { destinoMascarado?: string } => {
        const m = this.resolver.mascarar(destino);
        return m !== undefined ? { destinoMascarado: m } : {};
    };

    /** I13b — item PENDENTE: nada mais muda (sem alerta nova, sem fechar, sem retirar). */
    private pendente = async (
        loteId: string,
        chave: ChaveTitulo,
        motivo: string,
    ): Promise<'pendentes'> => {
        await this.loteRepo.marcarVerificacaoItem({
            loteId,
            ...chave,
            estado: PAYMENT_CHECK_STATE.PENDENTE,
        });
        await this.logService.warn({
            type: LOG_TYPE.BUSINESS_WARN,
            message: 'verificação TED/PIX pendente: item não verificável agora',
            data: { loteId, ...chave, motivo },
        });
        return 'pendentes';
    };

    /**
     * I13j-1 — sem dado no cadastro e sem exceção APROVADA: o item SAI do lote (ator `sistema`,
     * motivo `SEM_DADO_PAGAMENTO`), as alertas dele são descartadas e abre-se a pendência do
     * favorecido — tudo numa transação. Não mexe em `automatico` (gap Q11).
     */
    private retirarSemDado = async (
        loteId: string,
        item: ItemLote,
        pesCod: string,
        credor: string | undefined,
    ): Promise<void> => {
        const chave = { filCod: item.filCod, docCod: item.docCod, titCod: item.titCod };
        await this.db.withTransaction(async (tx) => {
            await this.alertaRepo.descartarDoItem(loteId, chave, SISPAG_SYSTEM_ACTOR, tx);
            await this.loteRepo.removerItemPeloSistema({ loteId, ...chave }, tx);
            await this.pendenciaRepo.abrirOuAcrescentar(
                {
                    pesCod,
                    filCod: item.filCod,
                    ...((credor ?? item.credor) ? { credor: credor ?? item.credor } : {}),
                    tipo: this.tipoPendencia(item),
                    loteId,
                    chave,
                    desfecho: PAYEE_ISSUE_OUTCOME.RETIRADO,
                },
                tx,
            );
        });
        await this.logService.warn({
            type: LOG_TYPE.BUSINESS_WARN,
            message: 'verificação TED/PIX retirou item sem dado de pagamento no cadastro',
            data: { loteId, ...chave, pesCod, modalidade: item.modalidade },
        });
    };

    /**
     * I13j-2/3 e I13k: com exceção APROVADA o item fica, mas a pendência abre do mesmo jeito; com o
     * dado no cadastro, a pendência ABERTA do (favorecido, tipo) é resolvida pelo sistema.
     */
    private registrarPendencia = async (
        loteId: string,
        item: ItemLote,
        pesCod: string,
        destino: DestinoResolvido,
        tx: TransactionClient,
    ): Promise<void> => {
        const tipo = this.tipoPendencia(item);
        if (destino.origem === DESTINO_ORIGEM.EXCECAO) {
            await this.pendenciaRepo.abrirOuAcrescentar(
                {
                    pesCod,
                    filCod: item.filCod,
                    ...(item.credor ? { credor: item.credor } : {}),
                    tipo,
                    loteId,
                    chave: { filCod: item.filCod, docCod: item.docCod, titCod: item.titCod },
                    desfecho: PAYEE_ISSUE_OUTCOME.MANTIDO_POR_EXCECAO,
                },
                tx,
            );
        } else if (destino.origem === DESTINO_ORIGEM.CADASTRO) {
            await this.pendenciaRepo.resolverDoFavorecido(pesCod, tipo, tx);
        }
    };

    /**
     * I13h — compara os achados com as alertas vivas do item NESTE lote:
     *   mesma contraparte + mesmo tipo → mantém (e a resolução dela);
     *   contraparte nova → alerta nova ABERTA;
     *   viva que não casou mais → OBSOLETA.
     * Canal: perfil ALTA com grupo dominante ≠ TED_PIX → alerta CANAL_HABITUAL (informativa).
     */
    private reconciliarAlertas = async (
        loteId: string,
        chave: ChaveTitulo,
        achados: DuplicateMatch[],
        perfil: ChannelProfile | null,
        tx: TransactionClient,
    ): Promise<void> => {
        const vivas = await this.alertaRepo.listVivasDoItem(loteId, chave, tx);
        const porChave = new Map(
            vivas.map((a) => [chaveAlerta(a.tipo, a.contraparteFilCod, a.contraparteDocCod), a]),
        );
        const vistas = new Set<string>();

        for (const achado of achados) {
            const k = chaveAlerta(achado.tipo, achado.contraparteFilCod, achado.contraparteDocCod);
            vistas.add(k);
            const existente = porChave.get(k);
            if (existente) {
                await this.alertaRepo.confirmar(
                    existente.id,
                    { contraparteTitulos: achado.contraparteTitulos, evidencia: achado.evidencia },
                    tx,
                );
            } else {
                await this.alertaRepo.criar(
                    {
                        loteId,
                        chave,
                        tipo: achado.tipo,
                        contraparteFilCod: achado.contraparteFilCod,
                        contraparteDocCod: achado.contraparteDocCod,
                        contraparteTitulos: achado.contraparteTitulos,
                        evidencia: achado.evidencia,
                    },
                    SISPAG_SYSTEM_ACTOR,
                    tx,
                );
            }
        }

        const canalDiverge =
            perfil !== null &&
            perfil.confianca === CHANNEL_CONFIDENCE.ALTA &&
            perfil.grupoDominante !== CHANNEL_GROUP.TED_PIX;
        const kCanal = chaveAlerta(ITEM_ALERT_TYPE.CANAL_HABITUAL);
        if (canalDiverge && perfil) {
            vistas.add(kCanal);
            const evidencia = {
                grupoDominante: perfil.grupoDominante,
                participacao: perfil.participacao,
                pagamentosUnicos: perfil.pagamentosUnicos,
                mesesDistintos: perfil.mesesDistintos,
                ...(perfil.calculadoEm ? { calculadoEm: perfil.calculadoEm } : {}),
            };
            const existente = porChave.get(kCanal);
            if (existente) await this.alertaRepo.confirmar(existente.id, { evidencia }, tx);
            else {
                await this.alertaRepo.criar(
                    { loteId, chave, tipo: ITEM_ALERT_TYPE.CANAL_HABITUAL, evidencia },
                    SISPAG_SYSTEM_ACTOR,
                    tx,
                );
            }
        }

        for (const [k, viva] of porChave) {
            if (vistas.has(k)) continue;
            await this.alertaRepo.fechar(viva, ITEM_ALERT_STATE.OBSOLETA, SISPAG_SYSTEM_ACTOR, tx);
        }
    };

    /**
     * Motivo de uma falha de leitura para o log: só o status HTTP ou o tipo do erro. A MENSAGEM não
     * entra — uma falha do cmn025 pode citar a conta/chave do favorecido (I10h).
     */
    private motivo = (error: unknown): string => {
        const status = (error as { response?: { status?: number } } | undefined)?.response?.status;
        if (status !== undefined) return `HTTP ${status}`;
        return error instanceof Error ? error.name : 'erro desconhecido';
    };
}
