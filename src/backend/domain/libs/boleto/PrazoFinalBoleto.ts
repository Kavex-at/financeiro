import BankingCalendar, { type CivilDate } from '../calendar/BankingCalendar.js';

/** Memo por data civil: o motor avalia ~10⁵ pares sobre poucas datas distintas. */
const MEMO = new Map<string, CivilDate | null>();
const LIMITE_MEMO = 20_000;

// O calendário só é usado para dia útil/feriado (puro); o relógio dele nunca é lido aqui.
const CALENDARIO = new BankingCalendar();

/**
 * Prazo final de pagamento do boleto (I15h, ADR-0078 P0-3): o vencimento da BARRA rolado ao próximo
 * dia útil bancário nacional (`BankingCalendar`). Barra de sábado, domingo ou feriado vence, para
 * este fim, no próximo dia útil. O vencimento do TÍTULO continua dia civil, sem rolagem (ADR-0070).
 * Pura: sem relógio e sem I/O.
 */
export default class PrazoFinalBoleto {
    /** `undefined` se a data civil for inválida. */
    public static calcular = (vencimentoBarra: CivilDate): CivilDate | undefined => {
        const memo = MEMO.get(vencimentoBarra);
        if (memo !== undefined) return memo ?? undefined;
        let prazo: CivilDate | undefined;
        if (CALENDARIO.isValidCivilDate(vencimentoBarra)) {
            prazo = CALENDARIO.isBusinessDay(vencimentoBarra)
                ? vencimentoBarra
                : CALENDARIO.nextBusinessDay(vencimentoBarra);
        }
        if (MEMO.size >= LIMITE_MEMO) MEMO.clear();
        MEMO.set(vencimentoBarra, prazo ?? null);
        return prazo;
    };
}
