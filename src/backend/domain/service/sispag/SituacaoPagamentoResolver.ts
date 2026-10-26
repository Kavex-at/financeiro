import { injectable } from 'tsyringe';
import { PAGO_POR_CONEXOS, PagoPorConexosRotulo } from '../../interface/sispag/PagoPorConexos.js';
import {
    DUPLICATE_HOLD_ORIGIN,
    type DuplicateHoldOrigin,
    type TituloAPagar,
} from '../../interface/sispag/SispagInterface.js';
import {
    ACAO_PAGAMENTO,
    type AcaoPagamento,
    DONO_PAGAMENTO,
    type DonoPagamento,
    ESTADO_PAGAMENTO,
    MOTIVO_PAGAMENTO,
    MOTIVOS_PAGAMENTO_ORDEM,
    type MotivoPagamento,
    type ResumoSituacao,
    SUGESTAO_BOLETO_SEM_DDA,
    type SituacaoPagamento,
    type SugestaoBoletoSemDda,
    type TotalSituacao,
} from '../../interface/sispag/SituacaoPagamento.js';
import {
    SITUACAO_SUGESTAO_TITULO,
    type SituacaoSugestaoTitulo,
} from '../../interface/sispag/SugestaoBoleto.js';
import { ETAPA_AJUSTE, type EtapaAjuste } from '../../libs/boleto/EtapaAjusteCentavos.js';
import { MODO_VINCULO, type ModoVinculo } from '../../libs/boleto/ModoVinculoCodigoBarras.js';

/**
 * Formas de pagamento do Conexos (`titVldPagopor`) que o SISPAG NÃO paga: cheque, extra-caixa,
 * cartão de crédito e caixa (decisão D14, confirmada pela analista em 20/10/2026). O código de
 * TED não está confirmado e NÃO é deduzido; as demais formas e a forma ausente não bloqueiam.
 */
export const FORMAS_NAO_SISPAG: ReadonlySet<number> = new Set([
    PAGO_POR_CONEXOS.CHEQUE,
    PAGO_POR_CONEXOS.EXTRA_CAIXA,
    PAGO_POR_CONEXOS.CARTAO_DE_CREDITO,
    PAGO_POR_CONEXOS.CAIXA,
]);

/** Etapas do ledger de ajuste de centavos que NÃO pedem ação de ninguém (ADR-0074). */
const AJUSTE_SEM_PENDENCIA: ReadonlySet<EtapaAjuste> = new Set<EtapaAjuste>([
    ETAPA_AJUSTE.CONCLUIDO,
    ETAPA_AJUSTE.CONCLUIDO_SEM_DECISAO,
    ETAPA_AJUSTE.CANCELADO,
    ETAPA_AJUSTE.RECUSADO,
    ETAPA_AJUSTE.SIMULADO,
]);

/**
 * Tudo o que o cálculo precisa além do título. Montado pelo `SituacaoPagamentoService` (que faz
 * as leituras) e passado pronto: o resolver não faz I/O.
 *
 * Cada fonte opcional diz "não sei" por `undefined`. Fonte desconhecida NÃO aplica os motivos
 * dela (o serviço registra em `fontesIndisponiveis`); os guardas existentes na inclusão e na
 * remessa continuam valendo.
 */
export interface ContextoSituacaoPagamento {
    /** Bloqueios por duplicidade/retenção ATIVOS, por `filCod:docCod:titCod`. */
    bloqueios?: ReadonlyMap<string, { origem: DuplicateHoldOrigin }>;
    /** Etapa do último ledger de ajuste de centavos, por título de ORIGEM. */
    ajustes?: ReadonlyMap<string, EtapaAjuste>;
    /** Situação do desfecho de boleto do título (ADR-0072), por chave. */
    desfechos?: ReadonlyMap<string, SituacaoSugestaoTitulo>;
    /** Modo do vínculo do código de barras na filial (ADR-0071). */
    modoVinculo: (filCod: number) => ModoVinculo;
}

interface PerfilMotivo {
    rotulo: string;
    dono: DonoPagamento;
    acao: { codigo: AcaoPagamento; rotulo: string };
}

/** Rótulo, dono e ação de cada motivo — a única tabela; a tela não repete estas regras. */
const PERFIL: Readonly<Record<MotivoPagamento, PerfilMotivo>> = {
    [MOTIVO_PAGAMENTO.ALCADA]: {
        rotulo: 'Aguardando aprovação',
        dono: DONO_PAGAMENTO.APROVADOR,
        acao: { codigo: ACAO_PAGAMENTO.ABRIR_NO_CONEXOS, rotulo: 'Abrir no Conexos' },
    },
    [MOTIVO_PAGAMENTO.TIPO_PERMUTA]: {
        rotulo: 'Título de permuta',
        dono: DONO_PAGAMENTO.PERMUTAS,
        acao: { codigo: ACAO_PAGAMENTO.ABRIR_EM_PERMUTAS, rotulo: 'Abrir em Permutas' },
    },
    [MOTIVO_PAGAMENTO.VENCIDO]: {
        rotulo: 'Vencido',
        dono: DONO_PAGAMENTO.CONTAS_A_PAGAR,
        acao: { codigo: ACAO_PAGAMENTO.RENEGOCIAR_NO_CONEXOS, rotulo: 'Renegociar no Conexos' },
    },
    [MOTIVO_PAGAMENTO.FORMA_NAO_SISPAG]: {
        rotulo: 'Forma de pagamento fora do SISPAG',
        dono: DONO_PAGAMENTO.VOCE,
        acao: {
            codigo: ACAO_PAGAMENTO.CORRIGIR_FORMA_NO_CONEXOS,
            rotulo: 'Corrigir a forma no Conexos',
        },
    },
    [MOTIVO_PAGAMENTO.DUPLICIDADE]: {
        rotulo: 'Possível duplicidade',
        dono: DONO_PAGAMENTO.VOCE,
        acao: { codigo: ACAO_PAGAMENTO.TRATAR_DUPLICIDADE, rotulo: 'Tratar duplicidade' },
    },
    [MOTIVO_PAGAMENTO.RETIDO_CODBAR]: {
        rotulo: 'Retido por código de barras',
        dono: DONO_PAGAMENTO.VOCE,
        acao: { codigo: ACAO_PAGAMENTO.DESFAZER_RETENCAO, rotulo: 'Desfazer retenção' },
    },
    [MOTIVO_PAGAMENTO.AJUSTE_CENTAVOS_PENDENTE]: {
        rotulo: 'Ajuste de centavos pendente',
        dono: DONO_PAGAMENTO.VOCE,
        acao: { codigo: ACAO_PAGAMENTO.TENTAR_AJUSTE, rotulo: 'Tentar de novo o ajuste' },
    },
    [MOTIVO_PAGAMENTO.CONFIRMACAO_A_REVISAR]: {
        rotulo: 'Confirmação de boleto a revisar',
        dono: DONO_PAGAMENTO.VOCE,
        acao: { codigo: ACAO_PAGAMENTO.VER_BOLETO, rotulo: 'Ver boleto' },
    },
    [MOTIVO_PAGAMENTO.BOLETO_SEM_DDA]: {
        rotulo: 'Boleto sem DDA',
        dono: DONO_PAGAMENTO.VOCE,
        acao: { codigo: ACAO_PAGAMENTO.VER_BOLETO, rotulo: 'Ver boleto' },
    },
};

const DETALHE_DESFECHO: Readonly<Partial<Record<SituacaoSugestaoTitulo, string>>> = {
    [SITUACAO_SUGESTAO_TITULO.UNICA_SEGURA]: 'há um boleto sugerido para confirmar',
    [SITUACAO_SUGESTAO_TITULO.AMBIGUA]: 'mais de um boleto possível',
    [SITUACAO_SUGESTAO_TITULO.SO_ATENCAO]: 'há um boleto sugerido, mas pede atenção',
    [SITUACAO_SUGESTAO_TITULO.SO_FRACA]: 'só há candidato fraco, sem confirmação',
    [SITUACAO_SUGESTAO_TITULO.SO_VENCIDA]: 'o único boleto candidato está vencido',
    [SITUACAO_SUGESTAO_TITULO.DISPUTADA]: 'o boleto candidato está reservado a outro título',
    [SITUACAO_SUGESTAO_TITULO.SEM_CANDIDATO]: 'nenhum boleto no pool de DDA',
};

/** Em que pé está a sugestão de boleto (I19r). `CONFIRMADA` e `ORFA` são tratadas à parte. */
const SUGESTAO_DO_DESFECHO: Readonly<
    Partial<Record<SituacaoSugestaoTitulo, SugestaoBoletoSemDda>>
> = {
    [SITUACAO_SUGESTAO_TITULO.UNICA_SEGURA]: SUGESTAO_BOLETO_SEM_DDA.PARA_CONFIRMAR,
    [SITUACAO_SUGESTAO_TITULO.SO_ATENCAO]: SUGESTAO_BOLETO_SEM_DDA.PARA_CONFIRMAR,
    [SITUACAO_SUGESTAO_TITULO.AMBIGUA]: SUGESTAO_BOLETO_SEM_DDA.A_ESCOLHER,
    [SITUACAO_SUGESTAO_TITULO.DISPUTADA]: SUGESTAO_BOLETO_SEM_DDA.A_ESCOLHER,
    [SITUACAO_SUGESTAO_TITULO.SO_FRACA]: SUGESTAO_BOLETO_SEM_DDA.CANDIDATO_FRACO,
    [SITUACAO_SUGESTAO_TITULO.SO_VENCIDA]: SUGESTAO_BOLETO_SEM_DDA.CANDIDATO_FRACO,
    [SITUACAO_SUGESTAO_TITULO.SEM_CANDIDATO]: SUGESTAO_BOLETO_SEM_DDA.SEM_CANDIDATO,
};

/** O botão de `BOLETO_SEM_DDA` diz o que a analista vai fazer no painel do boleto. */
const ROTULO_ACAO_SUGESTAO: Readonly<Record<SugestaoBoletoSemDda, string>> = {
    [SUGESTAO_BOLETO_SEM_DDA.PARA_CONFIRMAR]: 'Confirmar boleto sugerido',
    [SUGESTAO_BOLETO_SEM_DDA.A_ESCOLHER]: 'Escolher o boleto',
    [SUGESTAO_BOLETO_SEM_DDA.CANDIDATO_FRACO]: 'Ver candidatos',
    [SUGESTAO_BOLETO_SEM_DDA.SEM_CANDIDATO]: 'Ver boleto',
    [SUGESTAO_BOLETO_SEM_DDA.AGUARDANDO_VINCULO]: 'Ver boleto',
};

const semAcento = (s: string): string =>
    s
        .normalize('NFD')
        .replace(/\p{Diacritic}/gu, '')
        .toUpperCase();

const chaveDe = (t: { filCod: number; docCod: string; titCod: string }): string =>
    `${t.filCod}:${t.docCod}:${t.titCod}`;

const zero = (): TotalSituacao => ({ qtd: 0, valor: 0 });

/** Resultado de uma regra: `undefined` = não se aplica; objeto = se aplica, com detalhe opcional. */
type Achado = { detalhe?: string; sugestaoBoleto?: SugestaoBoletoSemDda };
type Regra = (t: TituloAPagar, ctx: ContextoSituacaoPagamento) => Achado | undefined;

const somar = (total: TotalSituacao, valor: number): void => {
    total.qtd += 1;
    total.valor += valor;
};

/** Soma no balde da chave, criando-o na primeira vez. */
const acumular = <K extends string>(
    baldes: Partial<Record<K, TotalSituacao>>,
    chave: K,
    valor: number,
): void => {
    const balde = baldes[chave] ?? zero();
    somar(balde, valor);
    baldes[chave] = balde;
};

/**
 * SituacaoPagamentoResolver (ADR-0075): decide se um título pode ser pago AGORA e, se não, por quê,
 * quem resolve e qual o próximo passo. PURO: sem I/O, sem relógio (usa `diasAteVencimento`, já em
 * dia civil de Brasília, ADR-0070). É a única origem da regra: a tela, a inclusão manual no lote, a
 * formação automática e a criação por filial leem daqui, então nunca divergem.
 */
@injectable()
export default class SituacaoPagamentoResolver {
    private regraAlcada: Regra = (t) => (t.liberado ? undefined : {});

    private regraTipoPermuta: Regra = (t) =>
        t.tpdDesNome !== undefined && semAcento(t.tpdDesNome).includes('PERMUTA')
            ? {
                  detalhe: `${t.tpdDesNome}: pode já ter permuta parcial, confira o saldo em Permutas`,
              }
            : undefined;

    private regraVencido: Regra = (t) => {
        if (t.diasAteVencimento === undefined || t.diasAteVencimento >= 0) return undefined;
        const dias = Math.abs(t.diasAteVencimento);
        return { detalhe: dias === 1 ? 'venceu ontem' : `venceu há ${dias} dias` };
    };

    private regraFormaNaoSispag: Regra = (t) =>
        t.formaPagamentoConexos !== undefined && FORMAS_NAO_SISPAG.has(t.formaPagamentoConexos)
            ? {
                  detalhe: `forma no Conexos: ${PagoPorConexosRotulo.exibir(t.formaPagamentoConexos)}`,
              }
            : undefined;

    private regraDuplicidade: Regra = (t, ctx) =>
        ctx.bloqueios?.get(chaveDe(t))?.origem === DUPLICATE_HOLD_ORIGIN.DUPLICIDADE_TITULO
            ? { detalhe: 'marcado como duplicado: cancele o documento repetido no Conexos' }
            : undefined;

    private regraRetidoCodbar: Regra = (t, ctx) => {
        const origem = ctx.bloqueios?.get(chaveDe(t))?.origem;
        if (origem === undefined || origem === DUPLICATE_HOLD_ORIGIN.DUPLICIDADE_TITULO) {
            return undefined;
        }
        return { detalhe: 'o sistema o retirou de um lote por causa do código de barras' };
    };

    private regraAjusteCentavos: Regra = (t, ctx) => {
        const etapa = ctx.ajustes?.get(chaveDe(t));
        if (etapa === undefined || AJUSTE_SEM_PENDENCIA.has(etapa)) return undefined;
        return {
            detalhe:
                etapa === ETAPA_AJUSTE.AGUARDANDO_APROVACAO_MANUAL
                    ? 'o ajuste espera aprovação no Conexos'
                    : 'o ajuste não terminou: confira o título no Conexos',
        };
    };

    private regraConfirmacaoARevisar: Regra = (t, ctx) =>
        ctx.desfechos?.get(chaveDe(t)) === SITUACAO_SUGESTAO_TITULO.ORFA
            ? { detalhe: 'o Conexos mudou o título depois da confirmação do boleto' }
            : undefined;

    /**
     * Boleto sem DDA associado no Conexos. Sem a fonte de desfechos (`undefined`) não dá para saber
     * se há confirmação, então o motivo não é aplicado (a remessa ainda barra boleto sem código).
     */
    private regraBoletoSemDda: Regra = (t, ctx) => {
        if (
            ctx.desfechos === undefined ||
            t.formaPagamentoConexos !== PAGO_POR_CONEXOS.BOLETO ||
            t.temBoleto === true
        ) {
            return undefined;
        }
        const desfecho = ctx.desfechos.get(chaveDe(t));
        // Título de grupo confirmado (ADR-0077): o boleto do GRUPO paga os N títulos e a barra vai
        // ao item do borderô, sem depender do vínculo por título (P0-5). A remessa confere o
        // grupo (borderô, barra == pagamento == Σ); aqui não é "boleto sem DDA".
        if (desfecho === SITUACAO_SUGESTAO_TITULO.EM_GRUPO) return undefined;
        if (desfecho === SITUACAO_SUGESTAO_TITULO.CONFIRMADA) {
            // Confirmado com o vínculo LIGADO na filial sai com o código ligado na remessa
            // (ADR-0071): é pronto. Com o vínculo desligado, a confirmação não basta.
            return ctx.modoVinculo(t.filCod) === MODO_VINCULO.ON
                ? undefined
                : {
                      detalhe: 'boleto confirmado, aguardando o vínculo no Conexos',
                      sugestaoBoleto: SUGESTAO_BOLETO_SEM_DDA.AGUARDANDO_VINCULO,
                  };
        }
        return {
            detalhe:
                (desfecho !== undefined ? DETALHE_DESFECHO[desfecho] : undefined) ??
                'sem boleto DDA associado',
            sugestaoBoleto:
                (desfecho !== undefined ? SUGESTAO_DO_DESFECHO[desfecho] : undefined) ??
                SUGESTAO_BOLETO_SEM_DDA.SEM_CANDIDATO,
        };
    };

    /** Uma regra por motivo; a ORDEM de avaliação é a do contrato (`MOTIVOS_PAGAMENTO_ORDEM`). */
    private regras: Readonly<Record<MotivoPagamento, Regra>> = {
        [MOTIVO_PAGAMENTO.ALCADA]: this.regraAlcada,
        [MOTIVO_PAGAMENTO.TIPO_PERMUTA]: this.regraTipoPermuta,
        [MOTIVO_PAGAMENTO.VENCIDO]: this.regraVencido,
        [MOTIVO_PAGAMENTO.FORMA_NAO_SISPAG]: this.regraFormaNaoSispag,
        [MOTIVO_PAGAMENTO.DUPLICIDADE]: this.regraDuplicidade,
        [MOTIVO_PAGAMENTO.RETIDO_CODBAR]: this.regraRetidoCodbar,
        [MOTIVO_PAGAMENTO.AJUSTE_CENTAVOS_PENDENTE]: this.regraAjusteCentavos,
        [MOTIVO_PAGAMENTO.CONFIRMACAO_A_REVISAR]: this.regraConfirmacaoARevisar,
        [MOTIVO_PAGAMENTO.BOLETO_SEM_DDA]: this.regraBoletoSemDda,
    };

    /** Todos os motivos que se aplicam, em ordem de prioridade, com o detalhe de cada um. */
    private motivosDe = (
        t: TituloAPagar,
        ctx: ContextoSituacaoPagamento,
    ): Array<{ motivo: MotivoPagamento } & Achado> =>
        MOTIVOS_PAGAMENTO_ORDEM.flatMap((motivo) => {
            const achado = this.regras[motivo](t, ctx);
            return achado ? [{ motivo, ...achado }] : [];
        });

    public avaliar = (t: TituloAPagar, ctx: ContextoSituacaoPagamento): SituacaoPagamento => {
        const motivos = this.motivosDe(t, ctx);
        const primeiro = motivos[0];
        if (!primeiro) return { estado: ESTADO_PAGAMENTO.PRONTO, motivos: [] };
        const perfil = PERFIL[primeiro.motivo];
        const { sugestaoBoleto } = primeiro;
        return {
            estado: ESTADO_PAGAMENTO.BLOQUEADO,
            motivos: motivos.map((m) => m.motivo),
            principal: primeiro.motivo,
            rotulo: perfil.rotulo,
            dono: perfil.dono,
            acao:
                sugestaoBoleto !== undefined
                    ? { ...perfil.acao, rotulo: ROTULO_ACAO_SUGESTAO[sugestaoBoleto] }
                    : perfil.acao,
            ...(primeiro.detalhe !== undefined ? { detalhe: primeiro.detalhe } : {}),
            ...(sugestaoBoleto !== undefined ? { sugestaoBoleto } : {}),
        };
    };

    /** Rótulo de um motivo (mensagem de recusa na inclusão, legenda). */
    public rotuloDo = (motivo: MotivoPagamento): string => PERFIL[motivo].rotulo;

    /**
     * Contagens e valores por estado, motivo principal e dono, sobre os títulos recebidos (a
     * carteira inteira, não o corte de payload). `porMotivo` soma `porEstado.BLOQUEADO`.
     */
    public resumir = (
        titulos: ReadonlyArray<Pick<TituloAPagar, 'valor' | 'situacaoPagamento'>>,
    ): Omit<ResumoSituacao, 'fontesIndisponiveis'> => {
        const porEstado = {
            [ESTADO_PAGAMENTO.PRONTO]: zero(),
            [ESTADO_PAGAMENTO.BLOQUEADO]: zero(),
        };
        const porMotivo: ResumoSituacao['porMotivo'] = {};
        const porDono: ResumoSituacao['porDono'] = {};
        for (const t of titulos) {
            const s = t.situacaoPagamento;
            if (!s) continue;
            somar(porEstado[s.estado], t.valor);
            if (s.principal) acumular(porMotivo, s.principal, t.valor);
            if (s.dono) acumular(porDono, s.dono, t.valor);
        }
        return { porEstado, porMotivo, porDono };
    };
}
