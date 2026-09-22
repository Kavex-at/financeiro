import { injectable, singleton } from 'tsyringe';

/** Data civil `'YYYY-MM-DD'` — sem hora e sem fuso. */
export type CivilDate = string;

const CIVIL_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Fuso do sistema de pagamentos brasileiro (SPB). É domínio, não tenant (ADR-0049 D5). */
const BRT_TIME_ZONE = 'America/Sao_Paulo';

/** Feriados bancários nacionais de data fixa (`MM-DD`). */
const FIXED_HOLIDAYS = ['01-01', '04-21', '05-01', '09-07', '10-12', '11-02', '11-15', '12-25'];

/** 20/11 (Consciência Negra) passou a ser feriado nacional em 2024 (Lei 14.759/2023). */
const BLACK_CONSCIOUSNESS_DAY_SINCE = 2024;

/**
 * Deslocamentos, em dias a partir da Páscoa, dos feriados móveis sem expediente bancário:
 * Carnaval segunda (−48) e terça (−47), Sexta-feira Santa (−2), Corpus Christi (+60).
 * A Quarta-feira de Cinzas (−46) é dia útil — expediente a partir do meio-dia.
 */
const EASTER_OFFSETS = [-48, -47, -2, 60];

const pad = (n: number, width = 2): string => String(n).padStart(width, '0');

/**
 * BankingCalendar — dia útil bancário nacional e "hoje" em Brasília (regra
 * `data-debito-remessa-sispag`, I8; ADR-0049 D4/D5).
 *
 * Calculado em código: sem tabela, sem rede, sem dependência nova. O backend é a fonte única;
 * o frontend recebe a janela já recortada e não reimplementa nada disto.
 *
 * Datas civis são strings `'YYYY-MM-DD'`. Toda aritmética usa `Date.UTC`, então não há hora
 * local nem horário de verão no caminho.
 *
 * Fora de escopo (gap P1): feriados municipais/estaduais e 31/12 — são valor de praça.
 */
@singleton()
@injectable()
export default class BankingCalendar {
    private clock: () => Date = () => new Date();

    /** Instância com relógio fixo — para testes e para jobs que simulam uma data. */
    public static withClock = (clock: () => Date): BankingCalendar => {
        const calendar = new BankingCalendar();
        calendar.clock = clock;
        return calendar;
    };

    public isValidCivilDate = (civil: string): boolean => {
        const m = CIVIL_DATE.exec(civil);
        if (!m) return false;
        const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
        const date = new Date(Date.UTC(y, mo - 1, d));
        return (
            date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d
        );
    };

    /** Páscoa pelo algoritmo anônimo gregoriano (Meeus/Jones/Butcher). */
    public easter = (year: number): CivilDate => {
        const a = year % 19;
        const b = Math.floor(year / 100);
        const c = year % 100;
        const d = Math.floor(b / 4);
        const e = b % 4;
        const f = Math.floor((b + 8) / 25);
        const g = Math.floor((b - f + 1) / 3);
        const h = (19 * a + b - d - g + 15) % 30;
        const i = Math.floor(c / 4);
        const k = c % 4;
        const l = (32 + 2 * e + 2 * i - h - k) % 7;
        const m = Math.floor((a + 11 * h + 22 * l) / 451);
        const month = Math.floor((h + l - 7 * m + 114) / 31);
        const day = ((h + l - 7 * m + 114) % 31) + 1;
        return `${pad(year, 4)}-${pad(month)}-${pad(day)}`;
    };

    /** Feriados bancários nacionais do ano, ordenados. */
    public holidays = (year: number): CivilDate[] => {
        const fixed = FIXED_HOLIDAYS.map((md) => `${pad(year, 4)}-${md}`);
        if (year >= BLACK_CONSCIOUSNESS_DAY_SINCE) fixed.push(`${pad(year, 4)}-11-20`);
        const easter = this.easter(year);
        const movable = EASTER_OFFSETS.map((offset) => this.addDays(easter, offset));
        return [...fixed, ...movable].sort();
    };

    public isBusinessDay = (civil: CivilDate): boolean => {
        const date = this.parse(civil);
        const weekday = date.getUTCDay();
        if (weekday === 0 || weekday === 6) return false;
        return !this.holidays(date.getUTCFullYear()).includes(civil);
    };

    /** Próximo dia útil ESTRITAMENTE depois de `civil`. */
    public nextBusinessDay = (civil: CivilDate): CivilDate => {
        let next = this.addDays(civil, 1);
        while (!this.isBusinessDay(next)) next = this.addDays(next, 1);
        return next;
    };

    public addDays = (civil: CivilDate, days: number): CivilDate => {
        const date = this.parse(civil);
        date.setUTCDate(date.getUTCDate() + days);
        return this.format(date);
    };

    /**
     * "Hoje" = data civil em `America/Sao_Paulo`. Nunca meia-noite UTC: das 21h às 24h de
     * Brasília o dia UTC já é o seguinte (o bug do antigo `hojeUtc()`).
     */
    public todayBrt = (): CivilDate =>
        // `en-CA` formata como `YYYY-MM-DD`.
        this.clock().toLocaleDateString('en-CA', { timeZone: BRT_TIME_ZONE });

    /**
     * Codificação de data do Conexos para `flpDtaCredito`: meia-noite UTC do dia civil —
     * exatamente o que `hojeUtc()` mandava, para a marca d'água seguir casando.
     */
    public toErpEpoch = (civil: CivilDate): number => this.parse(civil).getTime();

    /**
     * Dia civil de um epoch do Conexos pelo relógio UTC (semântica do `brDayKey`): o ERP grava
     * 00:00Z ou 15:00Z do dia pretendido, e converter para BRT recuaria um dia.
     */
    public fromErpEpoch = (epoch: number): CivilDate => this.format(new Date(epoch));

    private parse = (civil: CivilDate): Date => {
        if (!this.isValidCivilDate(civil)) {
            throw new Error(`data civil inválida: "${civil}" (esperado AAAA-MM-DD)`);
        }
        const [y, m, d] = civil.split('-').map(Number) as [number, number, number];
        return new Date(Date.UTC(y, m - 1, d));
    };

    private format = (date: Date): CivilDate =>
        `${pad(date.getUTCFullYear(), 4)}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}
