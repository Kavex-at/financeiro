import { inject, injectable } from 'tsyringe';
import {
    DECISAO_SUGESTAO_BOLETO,
    type DecisaoSugestaoBoletoTipo,
} from '../../interface/sispag/ConfirmacaoEmissorBoleto.js';
import RegraSugestaoBoleto, {
    LIMITE_VALOR_MESMO_DIA,
} from '../../service/sispag/RegraSugestaoBoleto.js';
import AnaliseCodigoBarrasRepetido from './AnaliseCodigoBarrasRepetido.js';
import CodigoBarrasBoleto from './CodigoBarrasBoleto.js';
import { MODO_AJUSTE, type ModoAjuste } from './ModoAjusteCentavos.js';
import ValorAbertoLiquido, { type ValoresAbertoTitulo } from './ValorAbertoLiquido.js';

/** `frnVldTpop` do `fin070` (HML 2026-10-19): 0 sem ajuste (recusa valor), 1 acréscimo, 2 desconto. */
export const FRN_VLD_TPOP = { SEM_AJUSTE: 0, ACRESCIMO: 1, DESCONTO: 2 } as const;

export const MOTIVO_INELEGIVEL_AJUSTE = {
    SEM_DECISAO_CONFIRMADA: 'SEM_DECISAO_CONFIRMADA',
    PAR_NAO_VIGENTE: 'PAR_NAO_VIGENTE',
    NUMERO_DIFERENTE: 'NUMERO_DIFERENTE',
    BOLETO_INDISPONIVEL: 'BOLETO_INDISPONIVEL',
    VENCIMENTO_DIFERENTE: 'VENCIMENTO_DIFERENTE',
    TITULO_NAO_APROVADO: 'TITULO_NAO_APROVADO',
    TITULO_PAGO_OU_PARCIAL: 'TITULO_PAGO_OU_PARCIAL',
    JUROS_OU_DESCONTO_PREVIO: 'JUROS_OU_DESCONTO_PREVIO',
    VALOR_ABERTO_INDISPONIVEL: 'VALOR_ABERTO_INDISPONIVEL',
    DELTA_ZERO: 'DELTA_ZERO',
    DELTA_ACIMA_LIMITE: 'DELTA_ACIMA_LIMITE',
    JA_AJUSTADO_NA_LINHAGEM: 'JA_AJUSTADO_NA_LINHAGEM',
    TITULO_EM_LOTE_FINALIZADO: 'TITULO_EM_LOTE_FINALIZADO',
    TITULO_EM_RASCUNHO_NATIVO: 'TITULO_EM_RASCUNHO_NATIVO',
    MODO_NAO_ON: 'MODO_NAO_ON',
} as const;
export type MotivoInelegivelAjuste =
    (typeof MOTIVO_INELEGIVEL_AJUSTE)[keyof typeof MOTIVO_INELEGIVEL_AJUSTE];

export interface EntradaElegibilidadeAjuste {
    modo: ModoAjuste;
    decisao?: {
        id: string;
        decisao: DecisaoSugestaoBoletoTipo;
        orfa: boolean;
        parVigente: boolean;
    };
    numeroTitulo?: string;
    numeroBoleto?: string;
    /** Linha digitável (47) ou barras (44). SÓ em memória. */
    codigo?: string;
    /** Vencimento do título, data civil `YYYY-MM-DD`. */
    vencimentoTitulo: string;
    /** Régua líquida do `fin064` ao vivo. */
    aberto?: ValoresAbertoTitulo;
    aprovadoNoErp: boolean;
    aprovadoNaCarteira: boolean;
    pago: boolean;
    jaAjustadoNaLinhagem: boolean;
    emLoteFinalizado: boolean;
    emRascunhoNativo: boolean;
}

export interface AjusteFin070 {
    frnVldTpop: 1 | 2;
    frnMnyValor: number;
}

export interface ResultadoElegibilidadeAjuste {
    elegivel: boolean;
    candidato: boolean;
    motivo?: MotivoInelegivelAjuste;
    decisaoId?: string;
    deltaCentavos?: number;
    valorBoletoCentavos?: number;
    abertoLiquidoCentavos?: number;
    ajuste?: AjusteFin070;
    codigoMascarado?: string;
}

/** Limite da I15c em centavos — a MESMA constante (I18a(3)); nenhuma paralela. */
const LIMITE_CENTAVOS = Math.round(LIMITE_VALOR_MESMO_DIA * 100);

/** Data civil `YYYY-MM-DD` de um ISO/data (o ERP grava 00:00Z ou 15:00Z do dia). */
const diaCivil = (v: string): string =>
    /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : new Date(Date.parse(v)).toISOString().slice(0, 10);

/**
 * Elegibilidade PURA do ajuste de centavos do título (I18a/I18b/I18m, ADR-0074). Sem I/O, sem log,
 * sem relógio: tudo que decide entra como argumento, lido AO VIVO por quem chama. É a mesma
 * função do `shadow`, do executor (no início e antes do `finalizar`) e do "tentar de novo".
 *
 * `candidato` = todas as condições menos o modo (é o que o `shadow` lista); `elegivel` exige
 * também modo `on`. A saída carrega só a máscara 5+4 (I17j).
 */
@injectable()
export default class ElegibilidadeAjusteCentavos {
    public constructor(
        @inject(CodigoBarrasBoleto) private readonly codigoBarras: CodigoBarrasBoleto,
    ) {}

    public avaliar = (e: EntradaElegibilidadeAjuste): ResultadoElegibilidadeAjuste => {
        const nega = (
            motivo: MotivoInelegivelAjuste,
            extra: Partial<ResultadoElegibilidadeAjuste> = {},
        ): ResultadoElegibilidadeAjuste => ({
            elegivel: false,
            candidato: false,
            motivo,
            ...(e.decisao ? { decisaoId: e.decisao.id } : {}),
            ...extra,
        });

        // (1) decisão humana CONFIRMADA não órfã, com par de emissor VIGENTE.
        const d = e.decisao;
        if (!d || d.decisao !== DECISAO_SUGESTAO_BOLETO.CONFIRMADA || d.orfa) {
            return nega(MOTIVO_INELEGIVEL_AJUSTE.SEM_DECISAO_CONFIRMADA);
        }
        if (!d.parVigente) return nega(MOTIVO_INELEGIVEL_AJUSTE.PAR_NAO_VIGENTE);
        // (2) número igual por dígitos estritos (I15f).
        if (!RegraSugestaoBoleto.numerosIguais(e.numeroTitulo, e.numeroBoleto)) {
            return nega(MOTIVO_INELEGIVEL_AJUSTE.NUMERO_DIFERENTE);
        }
        // O valor do boleto é o da NOSSA decodificação da barra (nunca o campo do DDA).
        const vencimentoTitulo = diaCivil(e.vencimentoTitulo);
        const dec = this.codigoBarras.decodificar(e.codigo, vencimentoTitulo);
        if (!dec) return nega(MOTIVO_INELEGIVEL_AJUSTE.BOLETO_INDISPONIVEL);
        const comCodigo = {
            codigoMascarado: AnaliseCodigoBarrasRepetido.mascarar(dec.barras),
            valorBoletoCentavos: dec.valorCentavos,
        };
        // (4) mesmo vencimento (data civil).
        if (dec.vencimento !== vencimentoTitulo) {
            return nega(MOTIVO_INELEGIVEL_AJUSTE.VENCIMENTO_DIFERENTE, comCodigo);
        }
        const motivoTitulo = this.motivoDoTitulo(e);
        if (motivoTitulo) return nega(motivoTitulo, comCodigo);
        // (3) Δ pela régua líquida da I17b (mesma função), 0 < |Δ| ≤ limite da I15c.
        const liquido = ValorAbertoLiquido.calcularCentavos(e.aberto);
        if (liquido === undefined) {
            return nega(MOTIVO_INELEGIVEL_AJUSTE.VALOR_ABERTO_INDISPONIVEL, comCodigo);
        }
        const deltaCentavos = dec.valorCentavos - liquido;
        const dados = { ...comCodigo, abertoLiquidoCentavos: liquido, deltaCentavos };
        if (deltaCentavos === 0) return nega(MOTIVO_INELEGIVEL_AJUSTE.DELTA_ZERO, dados);
        if (Math.abs(deltaCentavos) > LIMITE_CENTAVOS) {
            return nega(MOTIVO_INELEGIVEL_AJUSTE.DELTA_ACIMA_LIMITE, dados);
        }
        // (7)/(8) linhagem e lote.
        const motivoLote = this.motivoDeLinhagemELote(e);
        if (motivoLote) return nega(motivoLote, dados);

        const candidato = {
            candidato: true,
            decisaoId: d.id,
            ...dados,
            ajuste: ElegibilidadeAjusteCentavos.sentido(deltaCentavos),
        };
        // (9) modo da filial (I18l): só `on` executa; `shadow` lista o candidato.
        if (e.modo !== MODO_AJUSTE.ON) {
            return { elegivel: false, motivo: MOTIVO_INELEGIVEL_AJUSTE.MODO_NAO_ON, ...candidato };
        }
        return { elegivel: true, ...candidato };
    };

    /**
     * I18b: boleto acima ⇒ acréscimo (juros, `frnVldTpop 1`); abaixo ⇒ desconto (`2`).
     * `frnMnyValor = |Δ|`. Δ = 0 não tem ajuste (o `frnVldTpop 0` recusa valor).
     */
    public static sentido = (deltaCentavos: number): AjusteFin070 => ({
        frnVldTpop: deltaCentavos > 0 ? FRN_VLD_TPOP.ACRESCIMO : FRN_VLD_TPOP.DESCONTO,
        frnMnyValor: Math.abs(deltaCentavos) / 100,
    });

    /** (5) aprovado no ERP e na carteira; (6) não pago, sem parcial, sem juros/desconto prévios. */
    private motivoDoTitulo = (
        e: EntradaElegibilidadeAjuste,
    ): MotivoInelegivelAjuste | undefined => {
        if (!e.aprovadoNoErp || !e.aprovadoNaCarteira) {
            return MOTIVO_INELEGIVEL_AJUSTE.TITULO_NAO_APROVADO;
        }
        if (e.pago || (e.aberto?.totalPago !== undefined && e.aberto.totalPago !== 0)) {
            return MOTIVO_INELEGIVEL_AJUSTE.TITULO_PAGO_OU_PARCIAL;
        }
        const juros = e.aberto?.titMnyJuros ?? 0;
        const desconto = e.aberto?.titMnyDesconto ?? 0;
        if (juros !== 0 || desconto !== 0) return MOTIVO_INELEGIVEL_AJUSTE.JUROS_OU_DESCONTO_PREVIO;
        return undefined;
    };

    private motivoDeLinhagemELote = (
        e: EntradaElegibilidadeAjuste,
    ): MotivoInelegivelAjuste | undefined => {
        if (e.jaAjustadoNaLinhagem) return MOTIVO_INELEGIVEL_AJUSTE.JA_AJUSTADO_NA_LINHAGEM;
        if (e.emLoteFinalizado) return MOTIVO_INELEGIVEL_AJUSTE.TITULO_EM_LOTE_FINALIZADO;
        if (e.emRascunhoNativo) return MOTIVO_INELEGIVEL_AJUSTE.TITULO_EM_RASCUNHO_NATIVO;
        return undefined;
    };
}
