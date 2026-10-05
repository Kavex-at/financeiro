import { inject, injectable } from 'tsyringe';
import ConexosSispagClient from '../../client/ConexosSispagClient.js';
import DocumentoFavorecidoIndisponivelError from '../../errors/DocumentoFavorecidoIndisponivelError.js';
import ExcecaoDesabilitadaError from '../../errors/ExcecaoDesabilitadaError.js';
import ExcecaoMotivoObrigatorioError from '../../errors/ExcecaoMotivoObrigatorioError.js';
import ExcecaoNaoEncontradaError from '../../errors/ExcecaoNaoEncontradaError.js';
import { PERMISSION } from '../../interface/auth/Permission.js';
import { LOG_TYPE } from '../../interface/log/LogInterface.js';
import {
    DESTINO_MANUAL_TIPO,
    EXCECAO_ESTADO,
    EXCECAO_EVENTO,
    EXCECAO_ORIGEM,
    type ExcecaoDestino,
    type ExcecaoDestinoEvento,
    type ExcecaoDestinoResumo,
    MODALIDADE,
} from '../../interface/sispag/SispagInterface.js';
import EnvironmentProvider from '../../libs/environment/EnvironmentProvider.js';
import DestinoManualValidator from '../../libs/sispag/DestinoManualValidator.js';
import ExcecaoDestinoRule, { EXCECAO_ACAO } from '../../libs/sispag/ExcecaoDestinoRule.js';
import MaskDestino from '../../libs/sispag/MaskDestino.js';
import ExcecaoDestinoRepository, {
    type FiltroExcecoes,
} from '../../repository/sispag/ExcecaoDestinoRepository.js';
import { redactErrorMessage } from '../../libs/redact/redactErrorMessage.js';
import LogService from '../LogService.js';
import DestinoPagamentoResolver, { DESTINO_ORIGEM } from './DestinoPagamentoResolver.js';

/** Quem pede: o id do usuário AUTENTICADO (nunca o do body) e as permissões efetivas dele. */
export interface AtorExcecao {
    id: string;
    permissoes: ReadonlySet<string>;
}

export interface RegistrarExcecaoInput {
    ator: AtorExcecao;
    /** Filial usada para ler o cadastro (e o título, quando o favorecido vem dele). */
    filCod: number;
    /** O favorecido: direto (`pesCod`) ou pelo título (`docCod`/`titCod`), lido ao vivo. */
    pesCod?: string;
    docCod?: string;
    titCod?: string;
    /** Cru: a forma e o conteúdo são do `DestinoManualValidator`. */
    destino: unknown;
    justificativa: string;
}

export interface ResultadoAposentadoria {
    inspecionadas: number;
    aposentadas: number;
    falhas: number;
}

/**
 * ExcecaoDestinoService — o ciclo de vida da exceção de destino (ADR-0060): registrar, aprovar,
 * rejeitar, revogar, listar e aposentar as substituídas pelo cadastro.
 *
 * - **I12b no serviço, não só na UI:** aprovar passa por `ExcecaoDestinoRule.decidir`, que nega o
 *   próprio cadastrante e falha fechado com id ausente. A permissão `sispag:excecao` é conferida
 *   aqui de novo (a rota já tem o guard): um chamador fora da rota não a contorna.
 * - **I10i/I12i:** a titularidade é lida AO VIVO no cadastro (`pdcDocFederal`) ao cadastrar e de
 *   novo ao aprovar; documento indisponível = falha fechada. PIX só com chave CPF/CNPJ.
 * - **Nunca escreve no `cmn025`** e nunca cria `APROVADA` direto: o cadastro nasce `PENDENTE`.
 * - **I10h:** conta/chave só mascarada em resposta, log e erro. O log leva id da exceção,
 *   favorecido (`pesCod`), tipo e ator.
 * - Rejeitar e revogar valem mesmo com a flag desligada (reduzem risco); cadastrar e aprovar não.
 */
@injectable()
export default class ExcecaoDestinoService {
    public constructor(
        @inject(ExcecaoDestinoRepository) private readonly repo: ExcecaoDestinoRepository,
        @inject(ExcecaoDestinoRule) private readonly rule: ExcecaoDestinoRule,
        @inject(DestinoManualValidator) private readonly validator: DestinoManualValidator,
        @inject(ConexosSispagClient) private readonly sispag: ConexosSispagClient,
        @inject(EnvironmentProvider) private readonly environmentProvider: EnvironmentProvider,
        @inject(LogService) private readonly logService: LogService,
        @inject(MaskDestino) private readonly mask: MaskDestino,
        @inject(DestinoPagamentoResolver) private readonly resolver: DestinoPagamentoResolver,
    ) {}

    public registrar = async (input: RegistrarExcecaoInput): Promise<ExcecaoDestinoResumo> => {
        await this.negacoes('registrar', input.ator.id, undefined, async () => {
            await this.exigirHabilitada();
            this.rule.exigirPermissao(this.temPermissao(input.ator));
        });
        const justificativa = input.justificativa.trim();
        if (justificativa === '')
            throw new ExcecaoMotivoObrigatorioError({ campo: 'justificativa' });
        const destino = this.validator.validar(input.destino);
        const pesCod = await this.favorecidoDe(input);
        const documento = await this.sispag.getDocumentoFavorecido(pesCod, input.filCod);
        await this.negacoes('registrar', input.ator.id, pesCod, async () =>
            this.rule.conferirTitularidade(destino, documento),
        );
        const criada = await this.repo.insert({
            pesCod,
            filCod: input.filCod,
            destino,
            origem: EXCECAO_ORIGEM.MANUAL,
            justificativa,
            cadastradoPor: input.ator.id,
        });
        await this.registrarLog('exceção de destino cadastrada (PENDENTE)', criada, input.ator.id);
        return this.resumo(criada);
    };

    public aprovar = async (params: {
        id: string;
        ator: AtorExcecao;
    }): Promise<ExcecaoDestinoResumo> => {
        await this.negacoes('aprovar', params.ator.id, params.id, async () => {
            await this.exigirHabilitada();
            this.rule.exigirPermissao(this.temPermissao(params.ator));
        });
        const atual = await this.exigir(params.id);
        await this.negacoes('aprovar', params.ator.id, atual.id, async () =>
            this.rule.decidir(EXCECAO_ACAO.APROVAR, {
                estado: atual.estado,
                cadastradoPor: atual.cadastradoPor,
                ator: params.ator.id,
                excecaoId: atual.id,
            }),
        );
        // I10i de novo: o documento do favorecido pode ter mudado desde o cadastro.
        const documento = await this.sispag.getDocumentoFavorecido(atual.pesCod, atual.filCod);
        await this.negacoes('aprovar', params.ator.id, atual.id, async () =>
            this.rule.conferirTitularidade(atual.destino, documento),
        );
        const aprovada = await this.repo.aprovar({ id: atual.id, ator: params.ator.id });
        await this.registrarLog('exceção de destino aprovada', aprovada, params.ator.id);
        return this.resumo(aprovada);
    };

    public rejeitar = (params: {
        id: string;
        ator: AtorExcecao;
        motivo: string;
    }): Promise<ExcecaoDestinoResumo> =>
        this.decidirComMotivo(params, EXCECAO_ACAO.REJEITAR, {
            evento: EXCECAO_EVENTO.REJEICAO,
            log: 'exceção de destino rejeitada',
        });

    public revogar = (params: {
        id: string;
        ator: AtorExcecao;
        motivo: string;
    }): Promise<ExcecaoDestinoResumo> =>
        this.decidirComMotivo(params, EXCECAO_ACAO.REVOGAR, {
            evento: EXCECAO_EVENTO.REVOGACAO,
            log: 'exceção de destino revogada',
        });

    public listar = async (filtro: FiltroExcecoes = {}): Promise<ExcecaoDestinoResumo[]> =>
        (await this.repo.list(filtro)).map(this.resumo);

    public obter = async (id: string): Promise<ExcecaoDestinoResumo> =>
        this.resumo(await this.exigir(id));

    public eventos = async (id: string): Promise<ExcecaoDestinoEvento[]> => {
        await this.exigir(id);
        return this.repo.listEventos(id);
    };

    /**
     * Varredura de aposentadoria (I12c, gap Q3): para cada `APROVADA`, lê o cadastro AO VIVO com
     * a MESMA função do resolver (a da oferta e do envio) e, se há destino válido, a exceção vai a
     * `SUBSTITUIDA` (com divergência e alerta quando o valor difere). Idempotente. Uma leitura que
     * falha conta como falha e a varredura segue: o resto não depende dela.
     *
     * As flags TED/PIX são forçadas: "cadastro válido" não depende do go-live das modalidades.
     */
    public aposentarSubstituidas = async (): Promise<ResultadoAposentadoria> => {
        const aprovadas = await this.repo.listAprovadas();
        const cache = this.resolver.novoCache();
        let aposentadas = 0;
        let falhas = 0;
        for (const e of aprovadas) {
            try {
                const r = await this.resolver.resolve(
                    {
                        modalidade:
                            e.destino.tipo === DESTINO_MANUAL_TIPO.CONTA
                                ? MODALIDADE.TED
                                : MODALIDADE.PIX,
                    },
                    {
                        flags: { ted: true, pix: true, excecao: true },
                        filCod: e.filCod,
                        pesCod: e.pesCod,
                        cache,
                        aposentarExcecao: true,
                    },
                );
                if (r.origem !== DESTINO_ORIGEM.CADASTRO) continue;
                const depois = await this.repo.getById(e.id);
                if (depois?.estado === EXCECAO_ESTADO.SUBSTITUIDA) aposentadas += 1;
            } catch (error) {
                falhas += 1;
                await this.logService
                    .warn({
                        type: LOG_TYPE.BUSINESS_WARN,
                        message: 'falha ao conferir o cadastro de uma exceção de destino aprovada',
                        data: {
                            excecaoId: e.id,
                            pesCod: e.pesCod,
                            erro: redactErrorMessage(
                                error instanceof Error ? error.message : String(error),
                            ),
                        },
                    })
                    .catch(() => undefined);
            }
        }
        await this.logService.info({
            type: LOG_TYPE.BUSINESS_INFO,
            message: 'varredura de exceções de destino concluída',
            data: { inspecionadas: aprovadas.length, aposentadas, falhas },
        });
        return { inspecionadas: aprovadas.length, aposentadas, falhas };
    };

    /** Projeção SEGURA (I10h): só a máscara, nunca conta, chave ou documento. */
    public resumo = (e: ExcecaoDestino): ExcecaoDestinoResumo => ({
        id: e.id,
        pesCod: e.pesCod,
        filCod: e.filCod,
        tipo: e.destino.tipo,
        destinoMascarado: this.mask.destinoManual(e.destino),
        titularDocumentoMascarado: this.mask.documento(e.destino.titularDocumento),
        estado: e.estado,
        origem: e.origem,
        justificativa: e.justificativa,
        cadastradoPor: e.cadastradoPor,
        cadastradoEm: e.cadastradoEm,
        ...(e.aprovadoPor ? { aprovadoPor: e.aprovadoPor } : {}),
        ...(e.aprovadoEm ? { aprovadoEm: e.aprovadoEm } : {}),
        ...(e.decididoPor ? { decididoPor: e.decididoPor } : {}),
        ...(e.decididoEm ? { decididoEm: e.decididoEm } : {}),
        ...(e.motivoDecisao ? { motivoDecisao: e.motivoDecisao } : {}),
        ...(e.substituidaEm ? { substituidaEm: e.substituidaEm } : {}),
        ...(e.divergiu ? { divergiu: true } : {}),
        versao: e.versao,
    });

    private decidirComMotivo = async (
        params: { id: string; ator: AtorExcecao; motivo: string },
        acao: typeof EXCECAO_ACAO.REJEITAR | typeof EXCECAO_ACAO.REVOGAR,
        t: {
            evento: typeof EXCECAO_EVENTO.REJEICAO | typeof EXCECAO_EVENTO.REVOGACAO;
            log: string;
        },
    ): Promise<ExcecaoDestinoResumo> => {
        await this.negacoes(acao, params.ator.id, params.id, async () =>
            this.rule.exigirPermissao(this.temPermissao(params.ator)),
        );
        const motivo = params.motivo.trim();
        if (motivo === '') throw new ExcecaoMotivoObrigatorioError({ campo: 'motivo' });
        const atual = await this.exigir(params.id);
        const para = await this.negacoes(acao, params.ator.id, atual.id, async () =>
            this.rule.decidir(acao, {
                estado: atual.estado,
                cadastradoPor: atual.cadastradoPor,
                ator: params.ator.id,
                excecaoId: atual.id,
            }),
        );
        const nova = await this.repo.transition({
            id: atual.id,
            de: atual.estado,
            para,
            evento: t.evento,
            ator: params.ator.id,
            motivo,
        });
        await this.registrarLog(t.log, nova, params.ator.id);
        return this.resumo(nova);
    };

    /**
     * Roda uma guarda e, se ela NEGAR (flag, permissão, auto-aprovação, estado, titularidade),
     * registra o aviso — a negação de auto-aprovação é o sinal de segurança mais valioso da
     * feature — e relança. Sem conta, chave ou documento: só ação, ator, id e o código do erro.
     */
    private negacoes = async <T>(
        acao: string,
        ator: string,
        alvo: string | undefined,
        guarda: () => Promise<T>,
    ): Promise<T> => {
        try {
            return await guarda();
        } catch (error) {
            await this.logService
                .warn({
                    type: LOG_TYPE.BUSINESS_WARN,
                    message: `exceção de destino: ${acao} negado`,
                    data: {
                        acao,
                        ator,
                        ...(alvo ? { alvo } : {}),
                        codigo: (error as { code?: string }).code ?? 'ERRO',
                    },
                })
                .catch(() => undefined);
            throw error;
        }
    };

    private exigir = async (id: string): Promise<ExcecaoDestino> => {
        const e = await this.repo.getById(id);
        if (!e) throw new ExcecaoNaoEncontradaError({ excecaoId: id });
        return e;
    };

    private exigirHabilitada = async (): Promise<void> => {
        const env = await this.environmentProvider.getEnvironmentVars();
        if (env.sispagExcecaoDestinoEnabled !== true) throw new ExcecaoDesabilitadaError();
    };

    private temPermissao = (ator: AtorExcecao): boolean =>
        ator.permissoes.has(PERMISSION.SISPAG_EXCECAO);

    /** O favorecido: `pesCod` direto, ou o do título lido ao vivo. Sem nenhum = falha fechada. */
    private favorecidoDe = async (input: RegistrarExcecaoInput): Promise<string> => {
        if (input.pesCod) return input.pesCod;
        if (input.docCod && input.titCod) {
            const titulo = await this.sispag.getTituloAPagar(
                input.filCod,
                input.docCod,
                input.titCod,
            );
            if (titulo?.pesCod) return String(titulo.pesCod);
        }
        throw new DocumentoFavorecidoIndisponivelError(
            input.docCod && input.titCod ? { titulo: `${input.docCod}/${input.titCod}` } : {},
        );
    };

    /** I10h: id da exceção, favorecido, tipo e ator — nunca conta, chave ou documento. */
    private registrarLog = (message: string, e: ExcecaoDestino, ator: string): Promise<void> =>
        this.logService.info({
            type: LOG_TYPE.BUSINESS_INFO,
            message,
            data: {
                excecaoId: e.id,
                pesCod: e.pesCod,
                tipo: e.destino.tipo,
                estado: e.estado,
                ator,
            },
        });
}
