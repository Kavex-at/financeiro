import BankingCalendar, { type CivilDate } from '../calendar/BankingCalendar.js';
import PrazoFinalBoleto from './PrazoFinalBoleto.js';

export const MOTIVO_SEM_DATA_CANDIDATA = {
    /** O prazo final da barra é anterior a hoje (I15h): o par segue informativo. */
    BARRA_VENCIDA: 'BARRA_VENCIDA',
    /** Não há dia útil bancário entre hoje e a candidata (I8a). */
    SEM_DIA_UTIL: 'SEM_DIA_UTIL',
    DATA_INVALIDA: 'DATA_INVALIDA',
} as const;
export type MotivoSemDataCandidata =
    (typeof MOTIVO_SEM_DATA_CANDIDATA)[keyof typeof MOTIVO_SEM_DATA_CANDIDATA];

export type DataCandidata =
    | { possivel: true; candidata: CivilDate }
    | { possivel: false; motivo: MotivoSemDataCandidata };

export interface EntradaDataCandidata {
    /** Vencimento do título, dia civil (sem rolagem, ADR-0070). */
    vencimentoTitulo: CivilDate;
    /** Vencimento da barra (dia civil, ainda sem rolagem). */
    vencimentoBarra: CivilDate;
    /** `todayBrt` — entra por argumento; esta função não lê o relógio. */
    hoje: CivilDate;
}

const CALENDARIO = new BankingCalendar();

/**
 * Data candidata do item de data divergente (I8c, ADR-0078 P0-4): `min(vencimentoTitulo, prazo
 * final da barra)`, só possível se há dia útil bancário entre `hoje` e ela (I8a). Pura. O item entra
 * no lote cuja `dataDebito` é a sua data efetiva; `Δ < 0` não puxa os demais itens do lote.
 */
export default class DataCandidataItem {
    public static calcular = (entrada: EntradaDataCandidata): DataCandidata => {
        const { vencimentoTitulo, vencimentoBarra, hoje } = entrada;
        const prazoBarra = PrazoFinalBoleto.calcular(vencimentoBarra);
        if (
            prazoBarra === undefined ||
            !CALENDARIO.isValidCivilDate(vencimentoTitulo) ||
            !CALENDARIO.isValidCivilDate(hoje)
        ) {
            return { possivel: false, motivo: MOTIVO_SEM_DATA_CANDIDATA.DATA_INVALIDA };
        }
        if (prazoBarra < hoje) {
            return { possivel: false, motivo: MOTIVO_SEM_DATA_CANDIDATA.BARRA_VENCIDA };
        }
        const candidata = prazoBarra < vencimentoTitulo ? prazoBarra : vencimentoTitulo;
        if (candidata < hoje) {
            return { possivel: false, motivo: MOTIVO_SEM_DATA_CANDIDATA.BARRA_VENCIDA };
        }
        // Primeiro dia útil a partir de hoje; precisa caber até a candidata.
        const primeiroUtil = CALENDARIO.isBusinessDay(hoje)
            ? hoje
            : CALENDARIO.nextBusinessDay(hoje);
        if (primeiroUtil > candidata) {
            return { possivel: false, motivo: MOTIVO_SEM_DATA_CANDIDATA.SEM_DIA_UTIL };
        }
        return { possivel: true, candidata };
    };
}
