import { inject, injectable } from 'tsyringe';
import type { DecisaoSugestaoBoletoTipo } from '../../interface/sispag/ConfirmacaoEmissorBoleto.js';
import CodigoBarrasBoleto from './CodigoBarrasBoleto.js';
import type { ModoAjuste } from './ModoAjusteCentavos.js';
import type { ValoresAbertoTitulo } from './ValorAbertoLiquido.js';

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

/** Contrato (Task 4): implementado na Task 5. */
@injectable()
export default class ElegibilidadeAjusteCentavos {
    public constructor(
        @inject(CodigoBarrasBoleto) private readonly codigoBarras: CodigoBarrasBoleto,
    ) {}

    public avaliar = (_entrada: EntradaElegibilidadeAjuste): ResultadoElegibilidadeAjuste => {
        void this.codigoBarras;
        throw new Error('não implementado');
    };
}
