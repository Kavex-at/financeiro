import { inject, injectable } from 'tsyringe';
import {
    DECISAO_SUGESTAO_BOLETO,
    type DecisaoSugestaoBoletoTipo,
} from '../../interface/sispag/ConfirmacaoEmissorBoleto.js';
import { MODALIDADE } from '../../interface/sispag/SispagInterface.js';
import {
    RESULTADO_SUGESTAO,
    type ResultadoSugestao,
} from '../../interface/sispag/SugestaoBoleto.js';
import { DIAS_DEPOIS_MAX } from '../../service/sispag/RegraSugestaoBoleto.js';
import AnaliseCodigoBarrasRepetido from './AnaliseCodigoBarrasRepetido.js';
import CodigoBarrasBoleto from './CodigoBarrasBoleto.js';
import ValorAbertoLiquido, { type ValoresAbertoTitulo } from './ValorAbertoLiquido.js';

export const MOTIVO_INELEGIVEL_VINCULO = {
    MODALIDADE_NAO_BOLETO: 'MODALIDADE_NAO_BOLETO',
    FORA_DO_RASCUNHO: 'FORA_DO_RASCUNHO',
    DDA_ASSOCIADO_PELO_ERP: 'DDA_ASSOCIADO_PELO_ERP',
    SEM_DECISAO: 'SEM_DECISAO',
    DECISAO_NAO_CONFIRMADA: 'DECISAO_NAO_CONFIRMADA',
    DECISAO_ORFA: 'DECISAO_ORFA',
    PAR_NAO_VIGENTE: 'PAR_NAO_VIGENTE',
    BOLETO_INDISPONIVEL: 'BOLETO_INDISPONIVEL',
    BOLETO_INCONSISTENTE: 'BOLETO_INCONSISTENTE',
    CODIGO_INVALIDO: 'CODIGO_INVALIDO',
    CODIGO_ARRECADACAO: 'CODIGO_ARRECADACAO',
    TIER_INSUFICIENTE: 'TIER_INSUFICIENTE',
    VALOR_ABERTO_INDISPONIVEL: 'VALOR_ABERTO_INDISPONIVEL',
    VALOR_DIFERENTE: 'VALOR_DIFERENTE',
    DATA_INDISPONIVEL: 'DATA_INDISPONIVEL',
    DATA_ANTES_DO_TITULO: 'DATA_ANTES_DO_TITULO',
    DATA_FORA_DA_JANELA: 'DATA_FORA_DA_JANELA',
    BARRA_VENCIDA: 'BARRA_VENCIDA',
    /** Item de borderô (ADR-0077, I21o): o grupo não está confirmado ou perdeu o boleto. */
    GRUPO_NAO_CONFIRMADO: 'GRUPO_NAO_CONFIRMADO',
    GRUPO_ORFAO: 'GRUPO_ORFAO',
    /** 7º check de I17d (ADR-0078): o fator de vencimento da barra contradiz a data do DDA. */
    FATOR_VENCIMENTO_DIVERGE: 'FATOR_VENCIMENTO_DIVERGE',
    /** Fator `0000` no caminho `DATA_DIVERGENTE` (ADR-0078): sem data na barra não há como cruzar. */
    FATOR_SEM_VENCIMENTO: 'FATOR_SEM_VENCIMENTO',
} as const;
export type MotivoInelegivelVinculo =
    (typeof MOTIVO_INELEGIVEL_VINCULO)[keyof typeof MOTIVO_INELEGIVEL_VINCULO];

export interface EntradaElegibilidadeVinculo {
    modalidade?: string;
    /** O ERP associou o boleto DDA ao título (`titVldReflexoDdaAssoc = 1`). */
    temBoletoDda: boolean;
    /** O item está no rascunho nativo (nunca em lote finalizado, I17i). */
    noRascunho: boolean;
    decisao?: {
        id: string;
        decisao: DecisaoSugestaoBoletoTipo;
        orfa: boolean;
        parVigente: boolean;
    };
    /** Linha digitável (47) ou barras (44) do pool. SÓ em memória. */
    codigo?: string;
    /** Valor/vencimento do boleto no pool — conferidos contra o que o código decodifica. */
    poolValor?: number;
    poolVencimento?: string;
    /** Tier recalculado AGORA pela `RegraSugestaoBoleto`. */
    tier?: ResultadoSugestao;
    /**
     * Valores do `fin064` lidos ao vivo (reais) que formam o LÍQUIDO aberto (I17b emendada,
     * ADR-0074). Ausente, incompleto ou com as duas fórmulas divergentes = fail-closed.
     */
    aberto?: ValoresAbertoTitulo;
    /** Snapshot de inclusão. Ignorado de propósito (I17b). */
    valorItem?: number;
    /** Vencimento do título, data civil `YYYY-MM-DD`. */
    vencimentoTitulo: string;
    /** Data de débito do lote, data civil `YYYY-MM-DD`. */
    dataDebito: string;
}

export interface ResultadoElegibilidadeVinculo {
    elegivel: boolean;
    motivo?: MotivoInelegivelVinculo;
    /** Vencimento da barra − vencimento do título, em dias. */
    deltaDias?: number;
    /** Valor da barra − líquido aberto, em centavos. */
    deltaCentavos?: number;
    /** Máscara 5+4. Nunca o código. */
    codigoMascarado?: string;
    decisaoId?: string;
    /** Banco emissor (3 dígitos, FEBRABAN). */
    banco?: string;
}

/**
 * Entrada da variante "item de borderô" (ADR-0077, I21o/I17o): o item nativo com `borCod` de um
 * grupo de boleto. Sem decisão por título e sem líquido do título: o valor que vale é o do boleto
 * do grupo (I21b, conferido na confirmação e ao vivo na remessa) e o do próprio item do borderô.
 */
export interface EntradaElegibilidadeItemDeBordero {
    /** O item de borderô está no rascunho nativo (nunca em lote finalizado, I17i). */
    noRascunho: boolean;
    grupo: {
        estado: string;
        /** Boleto fora do pool ou com vínculo do ERP (I21u). */
        orfao: boolean;
        /** O par credor × emissor continua vigente. */
        parVigente: boolean;
        valorBoletoCentavos: number;
        /** Vencimento do boleto, data civil `YYYY-MM-DD`. */
        vencimentoBoleto: string;
    };
    /** Linha digitável (47) ou barras (44) do pool. SÓ em memória. */
    codigo?: string;
    poolValor?: number;
    poolVencimento?: string;
    /** `itsMnyValor` do item do borderô, em centavos; ausente = ilegível. */
    itsMnyValorCentavos?: number;
    /** Data de débito do lote, data civil `YYYY-MM-DD`. */
    dataDebito: string;
}

const DIA_MS = 24 * 60 * 60 * 1000;

/**
 * Piso da janela de data do vínculo (I17c). Próprio desta regra: a `RegraSugestaoBoleto` tem
 * `DIAS_DEPOIS_MIN = 1` (o `Δ = 0` entra nela pela faixa "mesmo dia, |Δvalor| ≤ R$ 0,05") e
 * mexer nele mudaria o tier da sugestão. Aqui o vencimento IGUAL ao do título é elegível.
 */
export const VINCULO_DIAS_MIN = 0;

const diasEntre = (de: string, ate: string): number =>
    Math.round((Date.parse(`${ate}T00:00:00Z`) - Date.parse(`${de}T00:00:00Z`)) / DIA_MS);

const TIERS_ELEGIVEIS: ReadonlySet<ResultadoSugestao> = new Set<ResultadoSugestao>([
    RESULTADO_SUGESTAO.CONHECIDO,
    RESULTADO_SUGESTAO.FORTE,
]);

/**
 * Elegibilidade PURA do vínculo do código de barras ao item (ADR-0071, I17a–d). Sem I/O, sem
 * ledger, sem log e sem relógio: tudo que decide entra como argumento (a decisão e o boleto
 * relidos do banco, o aberto lido ao vivo, o tier recalculado). É a mesma função do `shadow`, do
 * endpoint `vinculos-previstos` e do executor.
 *
 * A saída carrega só a máscara 5+4 (I17j): o código completo vive na entrada e morre aqui.
 */
@injectable()
export default class ElegibilidadeVinculoCodigoBarras {
    public constructor(
        @inject(CodigoBarrasBoleto) private readonly codigoBarras: CodigoBarrasBoleto,
    ) {}

    public avaliar = (entrada: EntradaElegibilidadeVinculo): ResultadoElegibilidadeVinculo => {
        const nega = (
            motivo: MotivoInelegivelVinculo,
            extra: Partial<ResultadoElegibilidadeVinculo> = {},
        ): ResultadoElegibilidadeVinculo => ({
            elegivel: false,
            motivo,
            ...(entrada.decisao ? { decisaoId: entrada.decisao.id } : {}),
            ...extra,
        });

        const foraDeEscopo = this.motivoDeEscopo(entrada);
        if (foraDeEscopo) return nega(foraDeEscopo);
        const decisao = entrada.decisao;
        if (!decisao) return nega(MOTIVO_INELEGIVEL_VINCULO.SEM_DECISAO);

        // ── I17d(1,2): o código ──
        const lido = this.lerCodigo(entrada);
        if ('motivo' in lido) return nega(lido.motivo, lido.extra);
        const { decodificado, comCodigo } = lido;

        // ── I17b: valor igual, em centavos, contra o LÍQUIDO aberto AO VIVO (ADR-0074) ──
        const liquidoCentavos = ValorAbertoLiquido.calcularCentavos(entrada.aberto);
        if (liquidoCentavos === undefined) {
            return nega(MOTIVO_INELEGIVEL_VINCULO.VALOR_ABERTO_INDISPONIVEL, comCodigo);
        }
        const deltaCentavos = decodificado.valorCentavos - liquidoCentavos;
        if (deltaCentavos !== 0) {
            return nega(MOTIVO_INELEGIVEL_VINCULO.VALOR_DIFERENTE, { ...comCodigo, deltaCentavos });
        }

        // ── I17c: data (civil, UTC meia-noite) ──
        if (decodificado.vencimento === undefined) {
            return nega(MOTIVO_INELEGIVEL_VINCULO.DATA_INDISPONIVEL, {
                ...comCodigo,
                deltaCentavos,
            });
        }
        const deltaDias = diasEntre(entrada.vencimentoTitulo, decodificado.vencimento);
        const dados = { ...comCodigo, deltaCentavos, deltaDias };
        const motivoData = this.motivoDeData(entrada, decodificado.vencimento, deltaDias);
        if (motivoData) return nega(motivoData, dados);

        // ── I15d: o tier é recalculado agora; só CONHECIDO/FORTE. Vem POR ÚLTIMO de propósito:
        // um valor ou uma data fora devolvem o motivo específico, não "tier insuficiente". ──
        if (entrada.tier === undefined || !TIERS_ELEGIVEIS.has(entrada.tier)) {
            return nega(MOTIVO_INELEGIVEL_VINCULO.TIER_INSUFICIENTE, dados);
        }

        return { elegivel: true, decisaoId: decisao.id, ...dados };
    };

    /**
     * Elegibilidade do item de borderô (I21o): grupo `CONFIRMADO`, não órfão, par vigente; valor
     * da barra == boleto do grupo (I21b) == item do borderô (H6); vencimento da barra == o do
     * boleto e não anterior à data de débito (I21g/h). Pura, como `avaliar`.
     */
    public avaliarItemDeBordero = (
        entrada: EntradaElegibilidadeItemDeBordero,
    ): ResultadoElegibilidadeVinculo => {
        const nega = (
            motivo: MotivoInelegivelVinculo,
            extra: Partial<ResultadoElegibilidadeVinculo> = {},
        ): ResultadoElegibilidadeVinculo => ({ elegivel: false, motivo, ...extra });
        const { grupo } = entrada;
        if (!entrada.noRascunho) return nega(MOTIVO_INELEGIVEL_VINCULO.FORA_DO_RASCUNHO);
        if (grupo.estado !== 'CONFIRMADO') {
            return nega(MOTIVO_INELEGIVEL_VINCULO.GRUPO_NAO_CONFIRMADO);
        }
        if (grupo.orfao) return nega(MOTIVO_INELEGIVEL_VINCULO.GRUPO_ORFAO);
        if (!grupo.parVigente) return nega(MOTIVO_INELEGIVEL_VINCULO.PAR_NAO_VIGENTE);

        const lido = this.lerCodigo({
            codigo: entrada.codigo,
            poolValor: entrada.poolValor,
            poolVencimento: entrada.poolVencimento,
            vencimentoTitulo: grupo.vencimentoBoleto,
        } as EntradaElegibilidadeVinculo);
        if ('motivo' in lido) return nega(lido.motivo, lido.extra);
        const { decodificado, comCodigo } = lido;

        const deltaCentavos = decodificado.valorCentavos - grupo.valorBoletoCentavos;
        if (deltaCentavos !== 0) {
            return nega(MOTIVO_INELEGIVEL_VINCULO.VALOR_DIFERENTE, { ...comCodigo, deltaCentavos });
        }
        if (entrada.itsMnyValorCentavos === undefined) {
            return nega(MOTIVO_INELEGIVEL_VINCULO.VALOR_ABERTO_INDISPONIVEL, comCodigo);
        }
        const deltaItem = decodificado.valorCentavos - entrada.itsMnyValorCentavos;
        if (deltaItem !== 0) {
            return nega(MOTIVO_INELEGIVEL_VINCULO.VALOR_DIFERENTE, {
                ...comCodigo,
                deltaCentavos: deltaItem,
            });
        }
        if (decodificado.vencimento === undefined) {
            return nega(MOTIVO_INELEGIVEL_VINCULO.DATA_INDISPONIVEL, comCodigo);
        }
        if (decodificado.vencimento !== grupo.vencimentoBoleto) {
            return nega(MOTIVO_INELEGIVEL_VINCULO.BOLETO_INCONSISTENTE, comCodigo);
        }
        if (diasEntre(entrada.dataDebito, decodificado.vencimento) < 0) {
            return nega(MOTIVO_INELEGIVEL_VINCULO.BARRA_VENCIDA, comCodigo);
        }
        return { elegivel: true, deltaCentavos: 0, deltaDias: 0, ...comCodigo };
    };

    /** I17a: modalidade, rascunho, DDA do ERP e a decisão humana vigente. */
    private motivoDeEscopo = (
        e: EntradaElegibilidadeVinculo,
    ): MotivoInelegivelVinculo | undefined => {
        if (e.modalidade !== MODALIDADE.BOLETO)
            return MOTIVO_INELEGIVEL_VINCULO.MODALIDADE_NAO_BOLETO;
        if (!e.noRascunho) return MOTIVO_INELEGIVEL_VINCULO.FORA_DO_RASCUNHO;
        if (e.temBoletoDda) return MOTIVO_INELEGIVEL_VINCULO.DDA_ASSOCIADO_PELO_ERP;
        if (!e.decisao) return MOTIVO_INELEGIVEL_VINCULO.SEM_DECISAO;
        if (e.decisao.decisao !== DECISAO_SUGESTAO_BOLETO.CONFIRMADA) {
            return MOTIVO_INELEGIVEL_VINCULO.DECISAO_NAO_CONFIRMADA;
        }
        if (e.decisao.orfa) return MOTIVO_INELEGIVEL_VINCULO.DECISAO_ORFA;
        if (!e.decisao.parVigente) return MOTIVO_INELEGIVEL_VINCULO.PAR_NAO_VIGENTE;
        return undefined;
    };

    private lerCodigo = (
        e: EntradaElegibilidadeVinculo,
    ):
        | {
              decodificado: NonNullable<ReturnType<CodigoBarrasBoleto['decodificar']>>;
              comCodigo: { codigoMascarado: string; banco: string };
          }
        | { motivo: MotivoInelegivelVinculo; extra?: Partial<ResultadoElegibilidadeVinculo> } => {
        if (e.codigo === undefined || e.codigo.trim() === '') {
            return { motivo: MOTIVO_INELEGIVEL_VINCULO.BOLETO_INDISPONIVEL };
        }
        const limpo = e.codigo.replace(/[\s.]/g, '');
        if (limpo.startsWith('8')) return { motivo: MOTIVO_INELEGIVEL_VINCULO.CODIGO_ARRECADACAO };
        // 7º check de I17d: o ciclo do fator é escolhido pela data do DDA (não pela do título).
        const decodificado = this.codigoBarras.decodificar(
            limpo,
            e.poolVencimento ?? e.vencimentoTitulo,
        );
        if (!decodificado) return { motivo: MOTIVO_INELEGIVEL_VINCULO.CODIGO_INVALIDO };
        const comCodigo = {
            codigoMascarado: AnaliseCodigoBarrasRepetido.mascarar(decodificado.barras),
            banco: decodificado.banco,
        };
        const valorDiverge =
            e.poolValor !== undefined &&
            Math.round(e.poolValor * 100) !== decodificado.valorCentavos;
        if (valorDiverge) {
            return { motivo: MOTIVO_INELEGIVEL_VINCULO.BOLETO_INCONSISTENTE, extra: comCodigo };
        }
        // Fator `0000` não cruza (a janela padrão segue como hoje: `DATA_INDISPONIVEL`).
        const fatorDiverge =
            e.poolVencimento !== undefined &&
            decodificado.semVencimento !== true &&
            decodificado.vencimento !== e.poolVencimento;
        if (fatorDiverge) {
            return { motivo: MOTIVO_INELEGIVEL_VINCULO.FATOR_VENCIMENTO_DIVERGE, extra: comCodigo };
        }
        return { decodificado, comCodigo };
    };

    private motivoDeData = (
        e: EntradaElegibilidadeVinculo,
        vencimentoBarra: string,
        deltaDias: number,
    ): MotivoInelegivelVinculo | undefined => {
        if (deltaDias < VINCULO_DIAS_MIN) return MOTIVO_INELEGIVEL_VINCULO.DATA_ANTES_DO_TITULO;
        if (deltaDias > DIAS_DEPOIS_MAX) return MOTIVO_INELEGIVEL_VINCULO.DATA_FORA_DA_JANELA;
        if (diasEntre(e.dataDebito, vencimentoBarra) < 0) {
            return MOTIVO_INELEGIVEL_VINCULO.BARRA_VENCIDA;
        }
        return undefined;
    };
}
