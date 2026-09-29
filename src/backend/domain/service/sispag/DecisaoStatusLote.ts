import { injectable } from 'tsyringe';
import { ALERTA_TIPO } from '../../interface/operacao/Alerta.js';
import type {
    AlertaDecidido,
    DivergenciaItem,
    EntradaDecisaoLote,
    EntradaItemDecisao,
    EstadoSincronizacaoItem,
    EventoRetornoItem,
    ItemDecidido,
    ResultadoDecisaoLote,
} from '../../interface/sispag/SincronizacaoLote.js';
import {
    BAIXA_FONTE,
    type BaixaDoTitulo,
    ITEM_SITUACAO,
    type ItemLote,
    type ItemSituacao,
    LOTE_STATUS,
    type LotePagamentoStatus,
    ORIGEM_BAIXA,
} from '../../interface/sispag/SispagInterface.js';

/** Códigos que registram o item como aceito pelo banco (I11d). */
const EVENTO_EFETUADO = '00';
const EVENTO_AGENDADO = 'BD';

export const DETALHE_ESTORNO = 'título pago voltou a aberto no fin064 (estorno?)';
export const DETALHE_REJEITADO_PAGO =
    'item rejeitado no retorno com o título pago no fin064 (pago fora da remessa?)';

/** Campos que contam como "mudou" (I11h). `sincronizadoEm` fica de fora de propósito. */
const CAMPOS_MATERIAIS: ReadonlyArray<keyof EstadoSincronizacaoItem> = [
    'situacao',
    'retornoEvento',
    'retornoDescricao',
    'rejeitado',
    'borCod',
    'bxaCodSeq',
    'baixaFonte',
    'origemBaixa',
    'pagoEm',
    'valorPago',
    'pagoObservadoEm',
    'divergencia',
    'divergenciaDetalhe',
];

/**
 * DecisaoStatusLote — o fechamento ÚNICO de L9/L10/L11 (ADR-0055, regra I11).
 *
 * Função pura: recebe o estado atual do lote e dos itens e as leituras de uma passada (fin064
 * tri-estado, eventos do fin052 casados com o item, baixas do PSQ_018 se lidas) e devolve a
 * situação de cada item, o destino do lote, as divergências novas e os alertas. Sem I/O, sem env,
 * sem relógio (a data chega na entrada).
 *
 * O princípio: **o pagamento é um fato do título, não do arquivo de retorno**. O fin064 prova o
 * pagamento (de qualquer origem); o fin052 só registra agenda e VETA por rejeição lida; o PSQ_018
 * só enriquece. O que não foi lido não decide nada.
 */
@injectable()
export default class DecisaoStatusLote {
    public decidir = (entrada: EntradaDecisaoLote): ResultadoDecisaoLote => {
        const terminal = entrada.status === LOTE_STATUS.BAIXADO;
        const agoraIso = entrada.agora.toISOString();
        const divergencias: DivergenciaItem[] = [];

        const itens = entrada.itens.map((e) => {
            const decidido = terminal
                ? this.decidirItemTerminal(e, agoraIso)
                : this.decidirItem(e, agoraIso);
            const nova = this.divergenciaNova(e.atual, decidido);
            if (nova) divergencias.push(nova);
            return decidido;
        });

        const leituraCompleta = itens.every((i) => i.tituloLido);
        const destino = terminal
            ? undefined
            : this.destinoDoLote(entrada.status, itens, leituraCompleta);

        const alertas: AlertaDecidido[] = [];
        if (destino === LOTE_STATUS.RETORNADO) {
            alertas.push({
                tipo: ALERTA_TIPO.SISPAG_LOTE_RETORNADO,
                alvo: entrada.loteId,
                detalhe: {
                    loteId: entrada.loteId,
                    rejeitados: itens
                        .filter((i) => i.situacao === ITEM_SITUACAO.REJEITADO)
                        .map((i) => ({
                            filCod: i.filCod,
                            docCod: i.docCod,
                            titCod: i.titCod,
                            evento: i.retornoEvento,
                            descricao: i.retornoDescricao,
                        })),
                },
            });
        }
        if (divergencias.length > 0) {
            alertas.push({
                tipo: ALERTA_TIPO.SISPAG_BAIXA_DIVERGENTE,
                alvo: entrada.loteId,
                detalhe: {
                    loteId: entrada.loteId,
                    divergencias: divergencias.map((d) => ({ ...d.chave, detalhe: d.detalhe })),
                },
            });
        }

        return {
            itens,
            ...(destino !== undefined ? { destino } : {}),
            leituraCompleta,
            divergencias,
            alertas,
            mudou: destino !== undefined || itens.some((i) => i.mudou),
        };
    };

    /** I11e: rejeição → RETORNADO; todos pagos → BAIXADO; o resto permanece. I11c antes de tudo. */
    private destinoDoLote = (
        status: LotePagamentoStatus,
        itens: ItemDecidido[],
        leituraCompleta: boolean,
    ): LotePagamentoStatus | undefined => {
        if (!leituraCompleta || itens.length === 0) return undefined;
        if (itens.some((i) => i.situacao === ITEM_SITUACAO.REJEITADO)) {
            return status === LOTE_STATUS.RETORNADO ? undefined : LOTE_STATUS.RETORNADO;
        }
        if (itens.every((i) => i.situacao === ITEM_SITUACAO.PAGO)) return LOTE_STATUS.BAIXADO;
        return undefined;
    };

    private decidirItem = (e: EntradaItemDecisao, agoraIso: string): ItemDecidido => {
        const { atual, titulo } = e;
        const candidatos = this.eventosCandidatos(e);
        const vencedor = this.eventoDePrecedencia(candidatos);
        const rejeitado = vencedor?.rejeitado === true;
        const tituloPago = titulo.legivel && titulo.vldPago && titulo.aberto === 0;

        const situacao = this.situacaoDerivada(e, vencedor, tituloPago);

        let detalheNovo: string | undefined;
        if (rejeitado && tituloPago) detalheNovo = DETALHE_REJEITADO_PAGO;
        else if (titulo.legivel && !tituloPago && atual.pagoObservadoEm !== undefined) {
            detalheNovo = DETALHE_ESTORNO;
        }

        const enriquecimento = tituloPago
            ? this.enriquecer(e, candidatos)
            : this.enriquecimentoAtual(atual, candidatos);

        const novo: EstadoSincronizacaoItem = {
            filCod: atual.filCod,
            docCod: atual.docCod,
            titCod: atual.titCod,
            ...(situacao !== undefined ? { situacao } : {}),
            ...(vencedor !== undefined ? { retornoEvento: vencedor.eventoCod } : {}),
            ...(vencedor?.descricao !== undefined ? { retornoDescricao: vencedor.descricao } : {}),
            rejeitado,
            ...enriquecimento,
            ...this.pagoObservado(atual, tituloPago, agoraIso),
            ...this.divergencia(atual, detalheNovo),
            ...this.carimboLeitura(e, agoraIso),
        };
        return { ...novo, mudou: this.mudou(atual, novo), tituloLido: titulo.legivel };
    };

    /** I11d, de cima para baixo. Título ilegível mantém a situação anterior (I11c). */
    private situacaoDerivada = (
        e: EntradaItemDecisao,
        vencedor: EventoRetornoItem | undefined,
        tituloPago: boolean,
    ): ItemSituacao | undefined => {
        if (vencedor?.rejeitado === true) return ITEM_SITUACAO.REJEITADO;
        if (!e.titulo.legivel) return e.atual.situacao;
        if (tituloPago) return ITEM_SITUACAO.PAGO;
        if (vencedor?.eventoCod === EVENTO_EFETUADO || vencedor?.eventoCod === EVENTO_AGENDADO) {
            return ITEM_SITUACAO.AGENDADO;
        }
        return ITEM_SITUACAO.SEM_RETORNO;
    };

    /** Primeira observação do pagamento — depois disso não se move. */
    private pagoObservado = (
        atual: ItemLote,
        tituloPago: boolean,
        agoraIso: string,
    ): Pick<EstadoSincronizacaoItem, 'pagoObservadoEm'> => {
        if (atual.pagoObservadoEm !== undefined) return { pagoObservadoEm: atual.pagoObservadoEm };
        return tituloPago ? { pagoObservadoEm: agoraIso } : {};
    };

    /** `sincronizadoEm` = última leitura BEM-SUCEDIDA do título. */
    private carimboLeitura = (
        e: EntradaItemDecisao,
        agoraIso: string,
    ): Pick<EstadoSincronizacaoItem, 'sincronizadoEm'> => {
        if (e.titulo.legivel) return { sincronizadoEm: agoraIso };
        return e.atual.sincronizadoEm !== undefined
            ? { sincronizadoEm: e.atual.sincronizadoEm }
            : {};
    };

    /**
     * Lote BAIXADO é terminal (I11f): nada do item muda de situação. A leitura só serve para
     * notar o estorno — que vira divergência, nunca transição.
     */
    private decidirItemTerminal = (e: EntradaItemDecisao, agoraIso: string): ItemDecidido => {
        const { atual, titulo } = e;
        const tituloPago = titulo.legivel && titulo.vldPago && titulo.aberto === 0;
        const estorno = titulo.legivel && !tituloPago && atual.situacao === ITEM_SITUACAO.PAGO;
        const novo: EstadoSincronizacaoItem = {
            ...this.estadoDe(atual),
            ...this.divergencia(atual, estorno ? DETALHE_ESTORNO : undefined),
            ...this.carimboLeitura(e, agoraIso),
        };
        return { ...novo, mudou: this.mudou(atual, novo), tituloLido: titulo.legivel };
    };

    /**
     * Candidatos à precedência: o que foi lido nesta passada MAIS o evento já registrado no item.
     * O registrado entra porque rejeição lida uma vez continua lida — uma passada em que o fin052
     * não foi relido (ou falhou) não pode apagá-la.
     */
    private eventosCandidatos = (e: EntradaItemDecisao): EventoRetornoItem[] => {
        const { atual } = e;
        if (atual.retornoEvento === undefined) return [...e.eventos];
        const doRetorno =
            atual.baixaFonte === BAIXA_FONTE.RETORNO ||
            (atual.baixaFonte === undefined && atual.bxaCodSeq !== undefined);
        const registrado: EventoRetornoItem = {
            eventoCod: atual.retornoEvento,
            ...(atual.retornoDescricao !== undefined ? { descricao: atual.retornoDescricao } : {}),
            rejeitado: atual.rejeitado === true,
            ...(doRetorno && atual.borCod !== undefined ? { borCod: atual.borCod } : {}),
            ...(doRetorno && atual.bxaCodSeq !== undefined ? { bxaCodSeq: atual.bxaCodSeq } : {}),
        };
        return [...e.eventos, registrado];
    };

    /**
     * I11d: `REJEITADO > 00 > BD > outro`, nunca a última linha lida. Empate resolvido por uma
     * ordem TOTAL (com vínculo de baixa primeiro, depois o código), para que a ordem de leitura —
     * um fan-out não determinístico — nunca mude o resultado.
     */
    private eventoDePrecedencia = (eventos: EventoRetornoItem[]): EventoRetornoItem | undefined =>
        [...eventos].sort((a, b) => {
            const porRank = this.rank(b) - this.rank(a);
            if (porRank !== 0) return porRank;
            const porVinculo = Number(this.temVinculo(b)) - Number(this.temVinculo(a));
            if (porVinculo !== 0) return porVinculo;
            return a.eventoCod.localeCompare(b.eventoCod);
        })[0];

    private rank = (e: EventoRetornoItem): number => {
        if (e.rejeitado) return 3;
        if (e.eventoCod === EVENTO_EFETUADO) return 2;
        if (e.eventoCod === EVENTO_AGENDADO) return 1;
        return 0;
    };

    private temVinculo = (e: EventoRetornoItem): boolean =>
        e.borCod !== undefined || e.bxaCodSeq !== undefined;

    /**
     * Enriquecimento de um item pago (nível 4 — nunca decide status):
     * - linha do retorno com borderô/baixa → `REMESSA`, fonte `RETORNO`;
     * - senão, baixa lida no PSQ_018 → `FORA_DO_RETORNO`, fonte `TITULO`;
     * - PSQ_018 ilegível (403 do robô) → mantém o que uma passada anterior leu; sem isso,
     *   `NAO_IDENTIFICADA` com os campos nulos.
     */
    private enriquecer = (
        e: EntradaItemDecisao,
        candidatos: EventoRetornoItem[],
    ): Partial<EstadoSincronizacaoItem> => {
        const vinculo = [...candidatos]
            .filter(this.temVinculo)
            .sort((a, b) => a.eventoCod.localeCompare(b.eventoCod))[0];
        const baixas = e.baixas?.legivel === true ? e.baixas.baixas : undefined;

        if (vinculo) {
            const casada = baixas?.find(
                (b) =>
                    b.borCod === vinculo.borCod &&
                    (vinculo.bxaCodSeq === undefined ||
                        b.bxaCodSeq === undefined ||
                        b.bxaCodSeq === vinculo.bxaCodSeq),
            );
            const bxaCodSeq = vinculo.bxaCodSeq ?? casada?.bxaCodSeq;
            return {
                ...(vinculo.borCod !== undefined ? { borCod: vinculo.borCod } : {}),
                ...(bxaCodSeq !== undefined ? { bxaCodSeq } : {}),
                baixaFonte: BAIXA_FONTE.RETORNO,
                origemBaixa: ORIGEM_BAIXA.REMESSA,
                ...this.dataValor(casada),
            };
        }

        if (baixas !== undefined && baixas.length > 0) {
            const ultima = this.baixaMaisRecente(baixas);
            return {
                borCod: ultima.borCod,
                ...(ultima.bxaCodSeq !== undefined ? { bxaCodSeq: ultima.bxaCodSeq } : {}),
                baixaFonte: BAIXA_FONTE.TITULO,
                origemBaixa: ORIGEM_BAIXA.FORA_DO_RETORNO,
                ...this.dataValor(ultima),
            };
        }

        const { atual } = e;
        const jaIdentificada =
            atual.origemBaixa === ORIGEM_BAIXA.REMESSA ||
            atual.origemBaixa === ORIGEM_BAIXA.FORA_DO_RETORNO;
        if (baixas === undefined && jaIdentificada) return this.enriquecimentoDe(atual);
        return { origemBaixa: ORIGEM_BAIXA.NAO_IDENTIFICADA };
    };

    /** Item não pago: nada de enriquecimento novo, salvo o vínculo que o próprio retorno trouxe. */
    private enriquecimentoAtual = (
        atual: ItemLote,
        candidatos: EventoRetornoItem[],
    ): Partial<EstadoSincronizacaoItem> => {
        const vinculo = candidatos.find(this.temVinculo);
        if (vinculo && atual.borCod === undefined && atual.bxaCodSeq === undefined) {
            return {
                ...(vinculo.borCod !== undefined ? { borCod: vinculo.borCod } : {}),
                ...(vinculo.bxaCodSeq !== undefined ? { bxaCodSeq: vinculo.bxaCodSeq } : {}),
                baixaFonte: BAIXA_FONTE.RETORNO,
            };
        }
        return this.enriquecimentoDe(atual);
    };

    private enriquecimentoDe = (atual: ItemLote): Partial<EstadoSincronizacaoItem> => ({
        ...(atual.borCod !== undefined ? { borCod: atual.borCod } : {}),
        ...(atual.bxaCodSeq !== undefined ? { bxaCodSeq: atual.bxaCodSeq } : {}),
        ...(atual.baixaFonte !== undefined ? { baixaFonte: atual.baixaFonte } : {}),
        ...(atual.origemBaixa !== undefined ? { origemBaixa: atual.origemBaixa } : {}),
        ...(atual.pagoEm !== undefined ? { pagoEm: atual.pagoEm } : {}),
        ...(atual.valorPago !== undefined ? { valorPago: atual.valorPago } : {}),
    });

    private dataValor = (b?: BaixaDoTitulo): Partial<EstadoSincronizacaoItem> => ({
        ...(b?.data !== undefined ? { pagoEm: b.data } : {}),
        ...(b?.valor !== undefined ? { valorPago: b.valor } : {}),
    });

    private baixaMaisRecente = (baixas: BaixaDoTitulo[]): BaixaDoTitulo =>
        [...baixas].sort((a, b) => {
            const porData = (b.data ?? '').localeCompare(a.data ?? '');
            if (porData !== 0) return porData;
            return b.borCod - a.borCod;
        })[0] as BaixaDoTitulo;

    /** Divergência é pegajosa: só um humano a resolve (I11f). */
    private divergencia = (
        atual: ItemLote,
        detalheNovo: string | undefined,
    ): Pick<EstadoSincronizacaoItem, 'divergencia' | 'divergenciaDetalhe'> => {
        if (detalheNovo !== undefined)
            return { divergencia: true, divergenciaDetalhe: detalheNovo };
        return {
            divergencia: atual.divergencia,
            ...(atual.divergenciaDetalhe !== undefined
                ? { divergenciaDetalhe: atual.divergenciaDetalhe }
                : {}),
        };
    };

    private divergenciaNova = (
        atual: ItemLote,
        novo: EstadoSincronizacaoItem,
    ): DivergenciaItem | undefined => {
        if (!novo.divergencia || novo.divergenciaDetalhe === undefined) return undefined;
        if (atual.divergencia && atual.divergenciaDetalhe === novo.divergenciaDetalhe) {
            return undefined;
        }
        return {
            chave: { filCod: novo.filCod, docCod: novo.docCod, titCod: novo.titCod },
            detalhe: novo.divergenciaDetalhe,
        };
    };

    private estadoDe = (atual: ItemLote): EstadoSincronizacaoItem => ({
        filCod: atual.filCod,
        docCod: atual.docCod,
        titCod: atual.titCod,
        ...(atual.situacao !== undefined ? { situacao: atual.situacao } : {}),
        ...(atual.retornoEvento !== undefined ? { retornoEvento: atual.retornoEvento } : {}),
        ...(atual.retornoDescricao !== undefined
            ? { retornoDescricao: atual.retornoDescricao }
            : {}),
        rejeitado: atual.rejeitado === true,
        ...this.enriquecimentoDe(atual),
        ...(atual.pagoObservadoEm !== undefined ? { pagoObservadoEm: atual.pagoObservadoEm } : {}),
        divergencia: atual.divergencia,
        ...(atual.divergenciaDetalhe !== undefined
            ? { divergenciaDetalhe: atual.divergenciaDetalhe }
            : {}),
    });

    private mudou = (atual: ItemLote, novo: EstadoSincronizacaoItem): boolean => {
        const antes = this.estadoDe(atual);
        return CAMPOS_MATERIAIS.some((campo) => antes[campo] !== novo[campo]);
    };
}
