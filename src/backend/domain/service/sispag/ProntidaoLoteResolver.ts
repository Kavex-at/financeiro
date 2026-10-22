import { injectable } from 'tsyringe';
import { PAYEE_CHECK_RESULT } from '../../interface/sispag/AuthorizedPayeeInterface.js';
import {
    type ChaveTitulo,
    DUPLICATE_ALERT_TYPES,
    ITEM_ALERT_STATE,
    type ItemLote,
    type LotePagamento,
    MODALIDADE,
    PAYMENT_CHECK_STATE,
} from '../../interface/sispag/SispagInterface.js';
import {
    ACAO_PAGAMENTO,
    ACAO_PENDENCIA_LOTE,
    DONO_PAGAMENTO,
    EFEITO_PENDENCIA,
    ESTADO_PAGAMENTO,
    ESTADO_PRONTIDAO,
    type FonteSituacao,
    MOTIVO_PAGAMENTO,
    PENDENCIA_LOTE,
    type PendenciaLote,
    type PendenciaLoteCodigo,
    type ProntidaoLote,
    type SituacaoPagamento,
} from '../../interface/sispag/SituacaoPagamento.js';

const chaveDe = (t: { filCod: number; docCod: string; titCod: string }): string =>
    `${t.filCod}:${t.docCod}:${t.titCod}`;

/** Contexto já carregado; o resolver não faz I/O. */
export interface ContextoProntidao {
    /** Situação de pagamento por `filCod:docCod:titCod`; ausente = título fora da carteira. */
    situacoes: ReadonlyMap<string, SituacaoPagamento>;
    /** Fontes da situação que falharam: a situação de TODO item fica "não conferida" (I19s). */
    fontesIndisponiveis: readonly FonteSituacao[];
    /** Chaves com ajuste de centavos em etapa não terminal (I18k, a guarda do finalizar). */
    emAjuste: ReadonlySet<string>;
}

type Perfil = Omit<PendenciaLote, 'chave' | 'motivo' | 'detalhe'> & { detalhe?: string };

const NOME_FONTE: Readonly<Record<FonteSituacao, string>> = {
    DUPLICIDADE: 'duplicidade',
    AJUSTE_CENTAVOS: 'ajuste de centavos',
    BOLETO: 'sugestão de boleto',
};

/** Rótulo, efeito, dono e ação de cada pendência própria do lote — a única tabela. */
const PERFIL: Readonly<Record<Exclude<PendenciaLoteCodigo, 'SITUACAO_BLOQUEADA'>, Perfil>> = {
    [PENDENCIA_LOTE.LOTE_VAZIO]: {
        efeito: EFEITO_PENDENCIA.BARRA,
        codigo: PENDENCIA_LOTE.LOTE_VAZIO,
        rotulo: 'Lote sem títulos',
        detalhe: 'inclua ao menos um título',
        dono: DONO_PAGAMENTO.VOCE,
    },
    [PENDENCIA_LOTE.SEM_CONTA]: {
        efeito: EFEITO_PENDENCIA.BARRA,
        codigo: PENDENCIA_LOTE.SEM_CONTA,
        rotulo: 'Sem conta pagadora',
        detalhe: 'defina a conta do lote',
        dono: DONO_PAGAMENTO.VOCE,
    },
    [PENDENCIA_LOTE.SITUACAO_NAO_CONFERIDA]: {
        efeito: EFEITO_PENDENCIA.BARRA,
        codigo: PENDENCIA_LOTE.SITUACAO_NAO_CONFERIDA,
        rotulo: 'Situação de pagamento não conferida',
        dono: DONO_PAGAMENTO.VOCE,
    },
    [PENDENCIA_LOTE.DUPLICIDADE_ABERTA]: {
        efeito: EFEITO_PENDENCIA.BARRA,
        codigo: PENDENCIA_LOTE.DUPLICIDADE_ABERTA,
        rotulo: 'Possível duplicidade',
        detalhe: 'justifique ou retire o item',
        dono: DONO_PAGAMENTO.VOCE,
        acao: { codigo: ACAO_PAGAMENTO.TRATAR_DUPLICIDADE, rotulo: 'Tratar alerta' },
    },
    [PENDENCIA_LOTE.AJUSTE_EM_ANDAMENTO]: {
        efeito: EFEITO_PENDENCIA.BARRA,
        codigo: PENDENCIA_LOTE.AJUSTE_EM_ANDAMENTO,
        rotulo: 'Ajuste de centavos em andamento',
        detalhe: 'espere o ajuste terminar ou confira o título no Conexos',
        dono: DONO_PAGAMENTO.VOCE,
        acao: { codigo: ACAO_PAGAMENTO.ABRIR_NO_CONEXOS, rotulo: 'Abrir no Conexos' },
    },
    [PENDENCIA_LOTE.SEM_FORMA]: {
        efeito: EFEITO_PENDENCIA.BARRA,
        codigo: PENDENCIA_LOTE.SEM_FORMA,
        rotulo: 'Sem forma de pagamento',
        detalhe: 'escolha a forma na tabela de itens',
        dono: DONO_PAGAMENTO.VOCE,
    },
    [PENDENCIA_LOTE.VERIFICACAO_PENDENTE]: {
        efeito: EFEITO_PENDENCIA.BARRA,
        codigo: PENDENCIA_LOTE.VERIFICACAO_PENDENTE,
        rotulo: 'Favorecido não verificado',
        detalhe: 'o Conexos não respondeu; a finalização tenta de novo',
        dono: DONO_PAGAMENTO.VOCE,
    },
    [PENDENCIA_LOTE.SEM_DADO_PAGAMENTO]: {
        efeito: EFEITO_PENDENCIA.SAI,
        codigo: PENDENCIA_LOTE.SEM_DADO_PAGAMENTO,
        rotulo: 'Sem conta nem chave PIX no cadastro',
        detalhe: 'na última verificação',
        dono: DONO_PAGAMENTO.CADASTRO,
        acao: {
            codigo: ACAO_PENDENCIA_LOTE.ABRIR_CADASTRO_NO_CONEXOS,
            rotulo: 'Abrir cadastro no Conexos',
        },
    },
    [PENDENCIA_LOTE.FAVORECIDO_NAO_AUTORIZADO]: {
        efeito: EFEITO_PENDENCIA.SAI,
        codigo: PENDENCIA_LOTE.FAVORECIDO_NAO_AUTORIZADO,
        rotulo: 'Favorecido não autorizado',
        detalhe: 'na última verificação',
        dono: DONO_PAGAMENTO.APROVADOR,
        acao: { codigo: ACAO_PENDENCIA_LOTE.PEDIR_AUTORIZACAO, rotulo: 'Pedir autorização' },
    },
    [PENDENCIA_LOTE.DESTINO_ALTERADO]: {
        efeito: EFEITO_PENDENCIA.SAI,
        codigo: PENDENCIA_LOTE.DESTINO_ALTERADO,
        rotulo: 'Destino alterado desde a autorização',
        detalhe: 'na última verificação',
        dono: DONO_PAGAMENTO.APROVADOR,
        acao: { codigo: ACAO_PENDENCIA_LOTE.PEDIR_AUTORIZACAO, rotulo: 'Pedir autorização' },
    },
};

const ORDEM_EFEITO = { [EFEITO_PENDENCIA.BARRA]: 0, [EFEITO_PENDENCIA.SAI]: 1 } as const;

/**
 * ProntidaoLoteResolver (ADR-0076, regra `prontidao-lote`): diz, para um lote em RASCUNHO, o que
 * barra a finalização e o que sai do lote ao finalizar. Puro: o contexto chega carregado. As
 * pendências que barram são as guardas que `finalizarLote` já aplica (I20c) mais a situação de
 * pagamento do título (I20d); as que saem são o último aviso de autorização do item (I20e).
 */
@injectable()
export default class ProntidaoLoteResolver {
    public avaliar = (lote: LotePagamento, ctx: ContextoProntidao): ProntidaoLote => {
        const doLote: PendenciaLote[] = [];
        if (lote.itens.length === 0) doLote.push(this.pendencia(PENDENCIA_LOTE.LOTE_VAZIO));
        if (!lote.conta) doLote.push(this.pendencia(PENDENCIA_LOTE.SEM_CONTA));

        const porItem = lote.itens
            .map((item) => ({ item, pendencias: this.doItem(item, ctx) }))
            .sort((a, b) => (b.item.valor ?? 0) - (a.item.valor ?? 0));
        const barra = (ps: PendenciaLote[]) => ps.some((p) => p.efeito === EFEITO_PENDENCIA.BARRA);
        const barram = porItem.filter((i) => barra(i.pendencias)).length;
        const saem = porItem.filter((i) => i.pendencias.length > 0 && !barra(i.pendencias)).length;
        const pendencias = [...doLote, ...porItem.flatMap((i) => i.pendencias)].sort(
            (a, b) => ORDEM_EFEITO[a.efeito] - ORDEM_EFEITO[b.efeito],
        );
        return {
            estado:
                pendencias.length === 0 ? ESTADO_PRONTIDAO.PRONTO : ESTADO_PRONTIDAO.COM_PENDENCIA,
            itensQueVao: lote.itens.length - saem,
            barram,
            saem,
            pendencias,
            fontesIndisponiveis: [...ctx.fontesIndisponiveis],
        };
    };

    private pendencia = (
        codigo: Exclude<PendenciaLoteCodigo, 'SITUACAO_BLOQUEADA'>,
        extra: Partial<PendenciaLote> = {},
    ): PendenciaLote => ({ ...PERFIL[codigo], ...extra });

    private doItem = (item: ItemLote, ctx: ContextoProntidao): PendenciaLote[] => {
        const chave = { filCod: item.filCod, docCod: item.docCod, titCod: item.titCod };
        const k = chaveDe(item);
        const situacao = this.situacaoDoItem(k, ctx);
        const duplicidadeAberta = (item.alertas ?? []).some(
            (a) => a.estado === ITEM_ALERT_STATE.ABERTA && DUPLICATE_ALERT_TYPES.includes(a.tipo),
        );
        // A situação já diz "ajuste de centavos pendente" quando é o motivo principal; não repete.
        const ajusteNaSituacao =
            situacao.tipo === 'bloqueada' &&
            situacao.situacao.principal === MOTIVO_PAGAMENTO.AJUSTE_CENTAVOS_PENDENTE;
        const doLoteDoItem: Array<PendenciaLoteCodigo | false> = [
            duplicidadeAberta && PENDENCIA_LOTE.DUPLICIDADE_ABERTA,
            ctx.emAjuste.has(k) && !ajusteNaSituacao && PENDENCIA_LOTE.AJUSTE_EM_ANDAMENTO,
            item.modalidade === undefined && PENDENCIA_LOTE.SEM_FORMA,
        ];
        return [
            ...this.pendenciaDaSituacao(situacao, chave),
            ...doLoteDoItem.flatMap((c) =>
                c && c !== PENDENCIA_LOTE.SITUACAO_BLOQUEADA ? [this.pendencia(c, { chave })] : [],
            ),
            ...this.pendenciaDaAutorizacao(item, chave),
        ];
    };

    private pendenciaDaSituacao = (
        situacao: ReturnType<ProntidaoLoteResolver['situacaoDoItem']>,
        chave: ChaveTitulo,
    ): PendenciaLote[] => {
        if (situacao.tipo === 'nao-conferida') {
            return [
                this.pendencia(PENDENCIA_LOTE.SITUACAO_NAO_CONFERIDA, {
                    detalhe: situacao.detalhe,
                    chave,
                }),
            ];
        }
        if (situacao.tipo !== 'bloqueada') return [];
        const s = situacao.situacao;
        return [
            {
                efeito: EFEITO_PENDENCIA.BARRA,
                codigo: PENDENCIA_LOTE.SITUACAO_BLOQUEADA,
                rotulo: s.rotulo ?? 'Bloqueado para pagamento',
                ...(s.detalhe ? { detalhe: s.detalhe } : {}),
                dono: s.dono ?? DONO_PAGAMENTO.VOCE,
                ...(s.acao ? { acao: s.acao } : {}),
                chave,
                ...(s.principal ? { motivo: s.principal } : {}),
            },
        ];
    };

    /** TED/PIX: verificação que não leu barra; o último aviso gravado sai (I20e). */
    private pendenciaDaAutorizacao = (item: ItemLote, chave: ChaveTitulo): PendenciaLote[] => {
        if (item.modalidade !== MODALIDADE.TED && item.modalidade !== MODALIDADE.PIX) return [];
        if (item.verificacaoEstado === PAYMENT_CHECK_STATE.PENDENTE) {
            return [this.pendencia(PENDENCIA_LOTE.VERIFICACAO_PENDENTE, { chave })];
        }
        const aviso = item.autorizacaoAviso;
        if (aviso === undefined || aviso === PAYEE_CHECK_RESULT.OK) return [];
        return [this.pendencia(aviso, { chave })];
    };

    private situacaoDoItem = (
        k: string,
        ctx: ContextoProntidao,
    ):
        | { tipo: 'pronta' }
        | { tipo: 'bloqueada'; situacao: SituacaoPagamento }
        | { tipo: 'nao-conferida'; detalhe: string } => {
        const situacao = ctx.situacoes.get(k);
        if (situacao === undefined) {
            return {
                tipo: 'nao-conferida',
                detalhe: 'o título não está na carteira do SISPAG; recarregue o painel',
            };
        }
        // Bloqueio já conhecido vem primeiro, mesmo com fonte caída (como na inclusão, I19s).
        if (situacao.estado === ESTADO_PAGAMENTO.BLOQUEADO) return { tipo: 'bloqueada', situacao };
        if (ctx.fontesIndisponiveis.length > 0) {
            const quais = ctx.fontesIndisponiveis.map((f) => NOME_FONTE[f]).join(', ');
            return {
                tipo: 'nao-conferida',
                detalhe: `sem a consulta de ${quais}; tente de novo em instantes`,
            };
        }
        return { tipo: 'pronta' };
    };
}
