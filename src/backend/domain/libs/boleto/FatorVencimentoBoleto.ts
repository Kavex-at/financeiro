import { injectable } from 'tsyringe';
import type { CivilDate } from '../calendar/BankingCalendar.js';

export type FatorDecodificado = { semVencimento: true } | { vencimento: CivilDate };

const DIA_MS = 24 * 60 * 60 * 1000;
/** Origem FEBRABAN do fator: 07/10/1997 (fator 1000 original = 03/07/2000). */
const ORIGEM = Date.UTC(1997, 9, 7);
/** O fator tem 4 dígitos e recomeça: ciclos de 9.000 dias (o fator 1000 de 22/02/2025 abre o atual). */
const CICLO_DIAS = 9000;
const CICLOS_CONSIDERADOS = 6;
/** Meio ciclo: acima disso a referência não escolhe um ciclo de forma plausível. */
const TOLERANCIA_DIAS = CICLO_DIAS / 2;
const FATOR_MAX = 9999;
const CIVIL = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Decodificador ÚNICO do fator de vencimento do boleto (ADR-0078, I17d(7)). Puro: não consulta o
 * relógio — o ciclo é escolhido pelo mais próximo da `referencia` (data civil `YYYY-MM-DD`).
 *
 * - `0000` ⇒ `{ semVencimento: true }`;
 * - empate entre ciclos, referência inválida ou fora de qualquer ciclo plausível ⇒ `undefined`.
 */
@injectable()
export default class FatorVencimentoBoleto {
    public decodificar = (
        fator: number | string,
        referencia: CivilDate,
    ): FatorDecodificado | undefined => {
        const valor = this.normalizar(fator);
        if (valor === undefined) return undefined;
        if (valor === 0) return { semVencimento: true };
        if (!CIVIL.test(referencia)) return undefined;
        const ref = Date.parse(`${referencia}T00:00:00Z`);
        if (Number.isNaN(ref)) return undefined;

        let melhor: number | undefined;
        let distanciaMelhor = Number.POSITIVE_INFINITY;
        let empate = false;
        for (let ciclo = 0; ciclo < CICLOS_CONSIDERADOS; ciclo += 1) {
            const candidato = ORIGEM + (valor + CICLO_DIAS * ciclo) * DIA_MS;
            const distancia = Math.abs(candidato - ref);
            if (distancia < distanciaMelhor) {
                melhor = candidato;
                distanciaMelhor = distancia;
                empate = false;
            } else if (distancia === distanciaMelhor) {
                empate = true;
            }
        }
        if (melhor === undefined || empate) return undefined;
        if (distanciaMelhor > TOLERANCIA_DIAS * DIA_MS) return undefined;
        return { vencimento: new Date(melhor).toISOString().slice(0, 10) };
    };

    private normalizar = (fator: number | string): number | undefined => {
        if (typeof fator === 'string') {
            return /^\d{4}$/.test(fator) ? Number(fator) : undefined;
        }
        return Number.isInteger(fator) && fator >= 0 && fator <= FATOR_MAX ? fator : undefined;
    };
}
