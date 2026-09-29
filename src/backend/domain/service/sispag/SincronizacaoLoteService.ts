import { inject, injectable } from 'tsyringe';
import ConexosSispagClient from '../../client/ConexosSispagClient.js';
import ConexosSispagRetornoClient from '../../client/ConexosSispagRetornoClient.js';
import ConexosTitulosClient from '../../client/ConexosTitulosClient.js';
import LoteEstadoInvalidoError from '../../errors/LoteEstadoInvalidoError.js';
import LoteVersaoConflitoError from '../../errors/LoteVersaoConflitoError.js';
import { LOG_TYPE } from '../../interface/log/LogInterface.js';
import { ALERTA_SEVERIDADE } from '../../interface/operacao/Alerta.js';
import type {
    ArquivoRetorno,
    ArquivoRetornoDetalhe,
} from '../../interface/sispag/Fin052Retorno.js';
import type {
    AlertaDecidido,
    EntradaItemDecisao,
    EventoRetornoItem,
    ResultadoDecisaoLote,
} from '../../interface/sispag/SincronizacaoLote.js';
import {
    type ItemLote,
    type LeituraBaixas,
    LOTE_STATUS,
    type LotePagamento,
    type LotePagamentoStatus,
    ORIGEM_BAIXA,
} from '../../interface/sispag/SispagInterface.js';
import BoundedConcurrency from '../../libs/concurrency/BoundedConcurrency.js';
import LotePagamentoRepository, {
    RESULTADO_APLICAR_SINCRONIZACAO,
} from '../../repository/sispag/LotePagamentoRepository.js';
import LogService from '../LogService.js';
import NotificacaoService from '../operacao/NotificacaoService.js';
import DecisaoStatusLote from './DecisaoStatusLote.js';

/**
 * Concorrência das leituras no Conexos. O gargalo não é CPU, é o pool de sessões do robô
 * (`LOGIN_ERROR_MAX_SESSIONS` acima disso) — mesmo valor do painel e da conciliação.
 */
const CONEXOS_FANOUT_LIMIT = 4;

/**
 * Por quanto tempo um lote `BAIXADO` continua sendo relido para notar estorno (I11f). Cadência é
 * configuração operacional, não regra (ADR-0055): sem janela, cada lote já baixado custaria uma
 * leitura do fin064 por item a cada hora, para sempre.
 */
export const JANELA_ESTORNO_DIAS = 30;

/** Folga entre a geração da remessa e o arquivo de retorno (relógios do ERP e nosso). */
const FOLGA_RETORNO_MS = 24 * 60 * 60 * 1000;

/** Estados de onde L11 parte (mais `BAIXADO`, só para checar estorno). */
const SINCRONIZAVEIS: readonly LotePagamentoStatus[] = [
    LOTE_STATUS.REMESSA_GERADA,
    LOTE_STATUS.RETORNADO,
    LOTE_STATUS.BAIXADO,
];

/** Códigos que decidem a situação (I11d). "Outro" não muda nada e não vale a leitura. */
const EVENTOS_QUE_DECIDEM = new Set(['00', 'BD']);

export const RESULTADO_SINCRONIZACAO = {
    /** O lote mudou de status. */
    TRANSICIONOU: 'TRANSICIONOU',
    /** Algum item mudou de situação/trilha, o lote ficou onde estava. */
    ATUALIZOU: 'ATUALIZOU',
    /** Nada mudou (I11h): só o carimbo `sincronizado_em` andou. */
    SEM_MUDANCA: 'SEM_MUDANCA',
    /** Conflito de versão: outra escrita no meio — o lote volta na próxima passada (I6). */
    PULADO: 'PULADO',
    /** Nenhum título do lote pôde ser lido no fin064 (I11c). */
    FALHA_LEITURA: 'FALHA_LEITURA',
} as const;

export type ResultadoSincronizacao =
    (typeof RESULTADO_SINCRONIZACAO)[keyof typeof RESULTADO_SINCRONIZACAO];

export interface ResultadoSincronizacaoLote {
    loteId: string;
    filCod: number;
    resultado: ResultadoSincronizacao;
    statusAntes: LotePagamentoStatus;
    statusDepois: LotePagamentoStatus;
    itens: number;
    itensIlegiveis: number;
    divergenciasNovas: number;
}

export interface ResumoSincronizacao {
    lotes: number;
    transicionados: number;
    atualizados: number;
    semMudanca: number;
    pulados: number;
    falhasLeitura: number;
    /** Leituras de detalhe do fin052 que falharam — o que não foi lido não decide nada. */
    eventosNaoLidos: number;
    resultados: ResultadoSincronizacaoLote[];
}

/** Um código do cadastro de eventos do banco (`fin050`). */
type EventoBancario = { cod: string; descricao?: string; tipo: number; tipoRetorno?: number };

/** Eventos do fin052 por lote → por item (`docCod:titCod`). */
type EventosPorLote = Map<string, Map<string, EventoRetornoItem[]>>;

/**
 * SincronizacaoLoteService — L11 `sincronizarStatus` (ADR-0055, regra I11).
 *
 * O status do lote segue a BAIXA DO TÍTULO no ERP, de qualquer origem. Por lote: lê o título de
 * cada item no fin064 (prova de pagamento), casa os eventos do fin052 pela chave composta com o
 * `filCod` DA LINHA (um `.RET` mistura filiais), lê as baixas do título no PSQ_018 quando pago
 * (trilha), e delega a decisão a `DecisaoStatusLote` — a mesma que a conciliação usa.
 *
 * **Read-only no ERP (I11a).** Nunca `carregar`, `processar` nem baixar. As gravações locais não
 * passam por flag de escrita no ERP (I11g): observar não é escrever lá.
 *
 * **Idempotente (I11h).** Passada sem mudança não mexe em `versao` nem emite alerta; só carimba
 * `sincronizado_em`. Com mudança, itens + transição vão numa transação sob optimistic lock (I6);
 * conflito pula o lote nesta passada.
 */
@injectable()
export default class SincronizacaoLoteService {
    public constructor(
        @inject(LotePagamentoRepository) private readonly loteRepo: LotePagamentoRepository,
        @inject(ConexosSispagClient) private readonly sispag: ConexosSispagClient,
        @inject(ConexosTitulosClient) private readonly titulos: ConexosTitulosClient,
        @inject(ConexosSispagRetornoClient) private readonly retorno: ConexosSispagRetornoClient,
        @inject(DecisaoStatusLote) private readonly decisao: DecisaoStatusLote,
        @inject(NotificacaoService) private readonly notificacao: NotificacaoService,
        @inject(LogService) private readonly logService: LogService,
        @inject(BoundedConcurrency) private readonly bounded: BoundedConcurrency,
    ) {}

    /** Passada do cron: todos os lotes sincronizáveis, um de cada vez. */
    public sincronizarTodos = async (agora: Date = new Date()): Promise<ResumoSincronizacao> => {
        const ids = await this.loteRepo.listLotesSincronizaveis(JANELA_ESTORNO_DIAS);
        const lotes: LotePagamento[] = [];
        for (const id of ids) {
            const lote = await this.loteRepo.getLoteComItens(id);
            if (lote) lotes.push(lote);
        }
        const { porLote, eventosNaoLidos } = await this.lerEventosRetorno(lotes);
        const resultados: ResultadoSincronizacaoLote[] = [];
        for (const lote of lotes) {
            resultados.push(await this.processarLote(lote, porLote.get(lote.id), agora));
        }
        return this.resumir(resultados, eventosNaoLidos);
    };

    /**
     * "Sincronizar agora" (manual). `null` quando o lote não existe. Estado não sincronizável →
     * `LoteEstadoInvalidoError`; conflito de versão → `LoteVersaoConflitoError` (a tela recarrega).
     */
    public sincronizarLote = async (
        loteId: string,
        agora: Date = new Date(),
    ): Promise<{ lote: LotePagamento; resultado: ResultadoSincronizacaoLote } | null> => {
        const lote = await this.loteRepo.getLoteComItens(loteId);
        if (!lote) return null;
        this.exigirSincronizavel(lote);
        const { porLote } = await this.lerEventosRetorno([lote]);
        const resultado = await this.processarLote(lote, porLote.get(lote.id), agora);
        if (resultado.resultado === RESULTADO_SINCRONIZACAO.PULADO) {
            throw new LoteVersaoConflitoError({ loteId, versaoEsperada: lote.versao });
        }
        const atualizado = (await this.loteRepo.getLoteComItens(loteId)) ?? lote;
        return { lote: atualizado, resultado };
    };

    /**
     * Fechamento pela conciliação administrativa (L9/L10): os eventos já foram lidos do arquivo
     * que ela acabou de processar, então não se varre o fin052 de novo. O resto é L11.
     */
    public aplicarEventosRetorno = async (
        loteId: string,
        eventos: Map<string, EventoRetornoItem[]>,
        agora: Date = new Date(),
    ): Promise<ResultadoSincronizacaoLote | null> => {
        const lote = await this.loteRepo.getLoteComItens(loteId);
        if (!lote || !SINCRONIZAVEIS.includes(lote.status)) return null;
        return this.processarLote(lote, eventos, agora);
    };

    // ---------------------------------------------------------------- por lote

    private processarLote = async (
        lote: LotePagamento,
        eventos: Map<string, EventoRetornoItem[]> | undefined,
        agora: Date,
    ): Promise<ResultadoSincronizacaoLote> => {
        await this.logService.info({
            type: LOG_TYPE.BUSINESS_INFO,
            message: 'sincronização do lote iniciada',
            data: { loteId: lote.id, filCod: lote.filCod, status: lote.status },
        });
        const entradas = await this.lerItens(lote, eventos);
        const decisao = this.decisao.decidir({
            loteId: lote.id,
            status: lote.status,
            itens: entradas,
            agora,
        });
        const base = {
            loteId: lote.id,
            filCod: lote.filCod,
            statusAntes: lote.status,
            itens: lote.itens.length,
            itensIlegiveis: decisao.itens.filter((i) => !i.tituloLido).length,
            divergenciasNovas: decisao.divergencias.length,
        };

        if (lote.itens.length > 0 && decisao.itens.every((i) => !i.tituloLido)) {
            return {
                ...base,
                resultado: RESULTADO_SINCRONIZACAO.FALHA_LEITURA,
                statusDepois: lote.status,
            };
        }

        if (!decisao.mudou) {
            await this.loteRepo.tocarSincronizacao({
                loteId: lote.id,
                itens: decisao.itens
                    .filter((i) => i.tituloLido)
                    .map((i) => ({ filCod: i.filCod, docCod: i.docCod, titCod: i.titCod })),
                em: agora.toISOString(),
            });
            return {
                ...base,
                resultado: RESULTADO_SINCRONIZACAO.SEM_MUDANCA,
                statusDepois: lote.status,
            };
        }

        const aplicado = await this.loteRepo.aplicarSincronizacao({
            loteId: lote.id,
            versaoEsperada: lote.versao,
            statusAtual: lote.status,
            ...(decisao.destino !== undefined ? { para: decisao.destino } : {}),
            itens: decisao.itens.map(({ mudou: _m, tituloLido: _t, ...estado }) => estado),
        });
        if (aplicado === RESULTADO_APLICAR_SINCRONIZACAO.CONFLITO) {
            await this.logService.warn({
                type: LOG_TYPE.BUSINESS_WARN,
                message: 'conflito de versão — lote pulado nesta passada',
                data: { loteId: lote.id, filCod: lote.filCod, versaoEsperada: lote.versao },
            });
            return {
                ...base,
                resultado: RESULTADO_SINCRONIZACAO.PULADO,
                statusDepois: lote.status,
            };
        }

        await this.registrarDesfecho(lote, decisao);
        await this.emitirAlertas(decisao.alertas, agora);
        return {
            ...base,
            resultado:
                decisao.destino !== undefined
                    ? RESULTADO_SINCRONIZACAO.TRANSICIONOU
                    : RESULTADO_SINCRONIZACAO.ATUALIZOU,
            statusDepois: decisao.destino ?? lote.status,
        };
    };

    private registrarDesfecho = async (
        lote: LotePagamento,
        decisao: ResultadoDecisaoLote,
    ): Promise<void> => {
        if (decisao.destino !== undefined) {
            await this.logService.info({
                type: LOG_TYPE.BUSINESS_INFO,
                message: 'lote transicionado',
                data: {
                    loteId: lote.id,
                    filCod: lote.filCod,
                    de: lote.status,
                    para: decisao.destino,
                },
            });
        }
        for (const d of decisao.divergencias) {
            await this.logService.warn({
                type: LOG_TYPE.BUSINESS_WARN,
                message: 'divergência na baixa do item',
                data: { loteId: lote.id, ...d.chave, detalhe: d.detalhe },
            });
        }
    };

    /** Lê o fin064 de cada item e, se pago e ainda sem trilha, as baixas (PSQ_018). */
    private lerItens = async (
        lote: LotePagamento,
        eventos: Map<string, EventoRetornoItem[]> | undefined,
    ): Promise<EntradaItemDecisao[]> => {
        const leituras = await this.bounded.run(
            lote.itens,
            async (item) => {
                const titulo = await this.sispag.lerSituacaoTitulo(
                    item.filCod,
                    item.docCod,
                    item.titCod,
                );
                const pago = titulo.legivel && titulo.vldPago && titulo.aberto === 0;
                const baixas =
                    pago && this.precisaDeTrilha(lote, item)
                        ? await this.titulos.lerBaixasTitulo({
                              docCod: item.docCod,
                              titCod: item.titCod,
                              filCod: item.filCod,
                          })
                        : undefined;
                return { titulo, baixas };
            },
            CONEXOS_FANOUT_LIMIT,
        );
        const entradas: EntradaItemDecisao[] = [];
        for (const [i, item] of lote.itens.entries()) {
            const lida = leituras[i];
            const { titulo, baixas } =
                lida?.status === 'fulfilled'
                    ? lida.value
                    : {
                          titulo: { legivel: false as const, motivo: this.motivo(lida?.reason) },
                          baixas: undefined,
                      };
            if (!titulo.legivel) {
                await this.logService.warn({
                    type: LOG_TYPE.CONEXOS_ERROR,
                    message: 'leitura do fin064 falhou',
                    data: {
                        loteId: lote.id,
                        filCod: item.filCod,
                        docCod: item.docCod,
                        titCod: item.titCod,
                        motivo: titulo.motivo,
                    },
                });
            }
            await this.avisarBaixasIlegiveis(lote, item, baixas);
            entradas.push({
                atual: item,
                titulo,
                eventos: eventos?.get(this.chaveItem(item.docCod, item.titCod)) ?? [],
                ...(baixas !== undefined ? { baixas } : {}),
            });
        }
        return entradas;
    };

    private avisarBaixasIlegiveis = async (
        lote: LotePagamento,
        item: ItemLote,
        baixas: LeituraBaixas | undefined,
    ): Promise<void> => {
        if (baixas === undefined || baixas.legivel) return;
        await this.logService.warn({
            type: LOG_TYPE.BUSINESS_WARN,
            message: 'baixas do título ilegíveis (PSQ_018) — origem da baixa não identificada',
            data: {
                loteId: lote.id,
                filCod: item.filCod,
                docCod: item.docCod,
                titCod: item.titCod,
                status: baixas.status,
            },
        });
    };

    /** Lote terminal ou item com a trilha já identificada: o PSQ_018 não acrescenta nada. */
    private precisaDeTrilha = (lote: LotePagamento, item: ItemLote): boolean =>
        lote.status !== LOTE_STATUS.BAIXADO &&
        item.origemBaixa !== ORIGEM_BAIXA.REMESSA &&
        item.origemBaixa !== ORIGEM_BAIXA.FORA_DO_RETORNO;

    /** Alerta é best-effort: a sincronização já foi gravada e não pode cair por causa dele. */
    private emitirAlertas = async (alertas: AlertaDecidido[], agora: Date): Promise<void> => {
        for (const alerta of alertas) {
            try {
                await this.notificacao.emitir({
                    tipo: alerta.tipo,
                    alvo: alerta.alvo,
                    severidade: ALERTA_SEVERIDADE.ERRO,
                    janelaInicio: agora,
                    detalhe: alerta.detalhe,
                });
            } catch (err) {
                await this.logService.error({
                    type: LOG_TYPE.BUSINESS_WARN,
                    message: 'falha ao emitir alerta da sincronização',
                    data: { tipo: alerta.tipo, alvo: alerta.alvo, motivo: this.motivo(err) },
                });
            }
        }
    };

    // ---------------------------------------------------------------- fin052

    /**
     * Eventos do fin052 dos lotes não terminais. Só arquivos PROCESSADOS têm detalhe; só os
     * códigos que decidem (rejeição, `00`, `BD`) são lidos — o ERP exige o código exato como
     * filtro, e varrer o cadastro inteiro (153 códigos no Bradesco) a cada hora seria o custo
     * errado. Cada linha casa com o lote pela chave composta com o `filCod` DA LINHA.
     *
     * Falha de leitura é contada e logada, nunca vira evento: o que não foi lido não decide nada
     * (I11c) — e com o título pago, não impede `BAIXADO` (I11b).
     */
    private lerEventosRetorno = async (
        lotes: LotePagamento[],
    ): Promise<{ porLote: EventosPorLote; eventosNaoLidos: number }> => {
        const porLote: EventosPorLote = new Map();
        const alvos = lotes.filter(
            (l) =>
                l.status !== LOTE_STATUS.BAIXADO &&
                l.nativeFilCod !== undefined &&
                l.nativeBncCod !== undefined &&
                l.nativeFlpCod !== undefined,
        );
        if (alvos.length === 0) return { porLote, eventosNaoLidos: 0 };

        const arquivos = await this.arquivosProcessados(alvos);
        const codigosPorBanco = await this.codigosQueDecidem(arquivos);
        const leituras = arquivos.flatMap((arquivo) =>
            (codigosPorBanco.get(`${arquivo.filCod}:${arquivo.bncCod}`) ?? []).map((ev) => ({
                arquivo,
                ev,
            })),
        );
        const detalhes = await this.bounded.run(
            leituras,
            ({ arquivo, ev }) =>
                this.retorno.listDetalhe({
                    filCod: arquivo.filCod,
                    bncCod: arquivo.bncCod,
                    gtbCodSeq: arquivo.gtbCodSeq,
                    garCodSeq: arquivo.garCodSeq,
                    eventoCod: ev.cod,
                    eventoTipo: ev.tipo,
                    pageSize: 200,
                }),
            CONEXOS_FANOUT_LIMIT,
        );

        const loteDaChave = new Map(
            alvos.map((l) => [`${l.nativeFilCod}:${l.nativeBncCod}:${l.nativeFlpCod}`, l]),
        );
        let eventosNaoLidos = 0;
        for (const [i, lido] of detalhes.entries()) {
            const leitura = leituras[i];
            if (leitura === undefined) continue;
            if (lido.status === 'rejected') {
                eventosNaoLidos += 1;
                await this.logService.warn({
                    type: LOG_TYPE.CONEXOS_ERROR,
                    message: 'falha ao ler detalhe de evento do retorno — evento não lido',
                    data: {
                        filCod: leitura.arquivo.filCod,
                        garCodSeq: leitura.arquivo.garCodSeq,
                        evento: leitura.ev.cod,
                        motivo: this.motivo(lido.reason),
                    },
                });
                continue;
            }
            this.acumularLinhas(porLote, lido.value, leitura, loteDaChave);
        }
        return { porLote, eventosNaoLidos };
    };

    /** Casa cada linha com o lote pela chave composta com o `filCod` DA LINHA (ADR-0055). */
    private acumularLinhas = (
        porLote: EventosPorLote,
        linhas: ArquivoRetornoDetalhe[],
        leitura: { arquivo: ArquivoRetorno; ev: EventoBancario },
        loteDaChave: Map<string, LotePagamento>,
    ): void => {
        for (const linha of linhas) {
            if (linha.flpCod === undefined || linha.docCod === undefined) continue;
            const lote = loteDaChave.get(`${linha.filCod}:${linha.bncCod}:${linha.flpCod}`);
            if (!lote || !this.arquivoPosteriorARemessa(leitura.arquivo, lote)) continue;
            const itens = porLote.get(lote.id) ?? new Map<string, EventoRetornoItem[]>();
            const chave = this.chaveItem(linha.docCod, linha.titCod ?? '1');
            itens.set(chave, [...(itens.get(chave) ?? []), this.eventoDaLinha(linha, leitura.ev)]);
            porLote.set(lote.id, itens);
        }
    };

    private eventoDaLinha = (
        linha: ArquivoRetornoDetalhe,
        ev: EventoBancario,
    ): EventoRetornoItem => {
        const descricao = linha.eventoDescricao ?? ev.descricao;
        return {
            eventoCod: linha.eventoCod ?? ev.cod,
            ...(descricao !== undefined ? { descricao } : {}),
            // `fbeVldTpret = 2` no cadastro do banco = rejeição.
            rejeitado: ev.tipoRetorno === 2,
            ...(linha.borCod !== undefined ? { borCod: linha.borCod } : {}),
            ...(linha.bxaCodSeq !== undefined ? { bxaCodSeq: linha.bxaCodSeq } : {}),
        };
    };

    /** Arquivos de retorno PROCESSADOS dos bancos/filiais dos lotes, sem repetição. */
    private arquivosProcessados = async (lotes: LotePagamento[]): Promise<ArquivoRetorno[]> => {
        const pares = [
            ...new Map(
                lotes.map((l) => [
                    `${l.nativeFilCod}:${l.nativeBncCod}`,
                    { filCod: l.nativeFilCod as number, bncCod: l.nativeBncCod as number },
                ]),
            ).values(),
        ];
        const configs = await this.bounded.run(
            pares,
            async (par) =>
                (await this.retorno.listConfigsRetorno(par)).map((c) => ({
                    filCod: par.filCod,
                    bncCod: c.bncCod,
                    gtbCodSeq: c.gtbCodSeq,
                })),
            CONEXOS_FANOUT_LIMIT,
        );
        const alvos = configs.flatMap((c) => (c.status === 'fulfilled' ? c.value : []));
        const listas = await this.bounded.run(
            alvos,
            (alvo) => this.retorno.listArquivosRetorno(alvo),
            CONEXOS_FANOUT_LIMIT,
        );
        const unicos = new Map<string, ArquivoRetorno>();
        for (const [i, lista] of listas.entries()) {
            if (lista.status === 'rejected') {
                await this.logService.warn({
                    type: LOG_TYPE.CONEXOS_ERROR,
                    message: 'falha ao listar arquivos de retorno (fin052)',
                    data: { alvo: alvos[i], motivo: this.motivo(lista.reason) },
                });
                continue;
            }
            for (const a of lista.value) {
                if (a.processadoEm === undefined) continue;
                unicos.set(`${a.filCod}:${a.bncCod}:${a.gtbCodSeq}:${a.garCodSeq}`, a);
            }
        }
        return [...unicos.values()];
    };

    /** Códigos de rejeição + `00` + `BD` do cadastro de eventos de cada (filial, banco). */
    private codigosQueDecidem = async (
        arquivos: ArquivoRetorno[],
    ): Promise<Map<string, EventoBancario[]>> => {
        const pares = [
            ...new Map(
                arquivos.map((a) => [
                    `${a.filCod}:${a.bncCod}`,
                    { filCod: a.filCod, bncCod: a.bncCod },
                ]),
            ).values(),
        ];
        const lidos = await this.bounded.run(
            pares,
            (par) => this.retorno.listEventosBancarios(par),
            CONEXOS_FANOUT_LIMIT,
        );
        const porPar = new Map<string, EventoBancario[]>();
        for (const [i, lido] of lidos.entries()) {
            const par = pares[i];
            if (par === undefined || lido.status === 'rejected') continue;
            porPar.set(
                `${par.filCod}:${par.bncCod}`,
                lido.value.filter((e) => e.tipoRetorno === 2 || EVENTOS_QUE_DECIDEM.has(e.cod)),
            );
        }
        return porPar;
    };

    /** O ERP recicla `flpCod`: arquivo anterior à remessa deste lote é de outro lote. */
    private arquivoPosteriorARemessa = (arquivo: ArquivoRetorno, lote: LotePagamento): boolean => {
        if (arquivo.cadastradoEm === undefined || lote.remessaGeradaEm === undefined) return true;
        const remessa = Date.parse(lote.remessaGeradaEm);
        if (Number.isNaN(remessa)) return true;
        return arquivo.cadastradoEm >= remessa - FOLGA_RETORNO_MS;
    };

    // ---------------------------------------------------------------- apoio

    private exigirSincronizavel = (lote: LotePagamento): void => {
        const semChave =
            lote.nativeFilCod === undefined ||
            lote.nativeBncCod === undefined ||
            lote.nativeFlpCod === undefined;
        if (!SINCRONIZAVEIS.includes(lote.status) || semChave) {
            throw new LoteEstadoInvalidoError({
                loteId: lote.id,
                statusAtual: lote.status,
                acao: 'sincronizar',
                motivo: semChave
                    ? 'Não é possível sincronizar: o lote ainda não tem remessa gerada no Conexos.'
                    : `Não é possível sincronizar: o lote está em ${lote.status}. A sincronização vale depois da remessa gerada.`,
            });
        }
    };

    private chaveItem = (docCod: string, titCod: string): string => `${docCod}:${titCod}`;

    private motivo = (err: unknown): string =>
        err instanceof Error ? err.message : String(err ?? 'desconhecido');

    private resumir = (
        resultados: ResultadoSincronizacaoLote[],
        eventosNaoLidos: number,
    ): ResumoSincronizacao => {
        const contar = (r: ResultadoSincronizacao): number =>
            resultados.filter((x) => x.resultado === r).length;
        return {
            lotes: resultados.length,
            transicionados: contar(RESULTADO_SINCRONIZACAO.TRANSICIONOU),
            atualizados: contar(RESULTADO_SINCRONIZACAO.ATUALIZOU),
            semMudanca: contar(RESULTADO_SINCRONIZACAO.SEM_MUDANCA),
            pulados: contar(RESULTADO_SINCRONIZACAO.PULADO),
            falhasLeitura: contar(RESULTADO_SINCRONIZACAO.FALHA_LEITURA),
            eventosNaoLidos,
            resultados,
        };
    };
}
