import { inject, injectable } from 'tsyringe';
import PerfilQueryInvalidError from '../../errors/PerfilQueryInvalidError.js';
import {
    TIPO_PERIODO,
    type TipoPeriodo,
} from '../../interface/perfil/AtividadeUsuarioInterface.js';
import Clock from '../../libs/clock/Clock.js';
import ExhaustivenessGuard from '../../libs/exhaustiveness/ExhaustivenessGuard.js';

export { TIPO_PERIODO, type TipoPeriodo };

/** O que a rota pede: o tipo e, no personalizado, datas locais SP `YYYY-MM-DD` (fim inclusivo). */
export interface PeriodoPedido {
    tipo: TipoPeriodo;
    inicio?: string;
    fim?: string;
}

/** Intervalo semiaberto `[inicio, fim)`. */
export interface Intervalo {
    inicio: Date;
    fim: Date;
}

export interface Periodo extends Intervalo {
    tipo: TipoPeriodo;
}

const HORA_MS = 3_600_000;
const DIA_MS = 24 * HORA_MS;
const SEMANA_MS = 7 * DIA_MS;

/**
 * Offset de São Paulo. O Brasil não tem horário de verão desde 2019, então o offset é FIXO em
 * UTC−3 e a conversão local ↔ UTC é monotônica — é o que torna estes limites `timestamptz`
 * equivalentes aos limites `timestamp` local que `metricas.metricas_ciclo()` compara.
 */
const OFFSET_SP_MS = -3 * HORA_MS;

/**
 * Âncora da grade semanal = `metricas.serie_inicio()` (`2026-09-11 18:00` SP, sexta). Toda semana
 * do perfil é âncora + k·7 dias, a MESMA grade de `/metricas` (I7 da AtividadeUsuario).
 */
export const ANCORA_SEMANA_UTC_MS = Date.UTC(2026, 8, 11, 21, 0, 0);

/** Teto do intervalo personalizado (e da janela do histórico). */
export const MAXIMO_DIAS = 366;

/** Janela default do histórico. */
export const HISTORICO_DIAS_PADRAO = 30;

const DATA_LOCAL = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * PeriodoPerfil — os limites de "hoje", "esta semana", "este mês" e "personalizado" em horário de
 * São Paulo, e o período anterior para a comparação ↑/↓. Puro sobre o relógio injetado.
 */
@injectable()
export default class PeriodoPerfil {
    public constructor(
        @inject(Clock)
        private readonly clock: Clock,
    ) {}

    public calcular = (pedido: PeriodoPedido): Periodo => {
        const agora = this.clock.now();
        const fim = new Date(agora);
        switch (pedido.tipo) {
            case TIPO_PERIODO.HOJE:
                return { tipo: pedido.tipo, inicio: this.inicioDoDiaSp(agora), fim };
            case TIPO_PERIODO.SEMANA: {
                const k = Math.floor((agora - ANCORA_SEMANA_UTC_MS) / SEMANA_MS);
                return {
                    tipo: pedido.tipo,
                    inicio: new Date(ANCORA_SEMANA_UTC_MS + k * SEMANA_MS),
                    fim,
                };
            }
            case TIPO_PERIODO.MES: {
                const local = new Date(agora + OFFSET_SP_MS);
                const inicio = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), 1);
                return { tipo: pedido.tipo, inicio: new Date(inicio - OFFSET_SP_MS), fim };
            }
            case TIPO_PERIODO.PERSONALIZADO: {
                if (!pedido.inicio || !pedido.fim) {
                    throw new PerfilQueryInvalidError(
                        'O período personalizado precisa de data de início e de fim.',
                    );
                }
                const intervalo = this.intervaloLocal(pedido.inicio, pedido.fim);
                return { tipo: pedido.tipo, ...intervalo };
            }
            default:
                return ExhaustivenessGuard.assertNever(pedido.tipo, 'PeriodoPerfil.calcular');
        }
    };

    /** `[inicio − (fim − inicio), inicio)`. */
    public anterior = (intervalo: Intervalo): Intervalo => {
        const duracao = intervalo.fim.getTime() - intervalo.inicio.getTime();
        return {
            inicio: new Date(intervalo.inicio.getTime() - duracao),
            fim: new Date(intervalo.inicio.getTime()),
        };
    };

    /**
     * Janela do histórico. Sem datas: os últimos 30 dias até agora. Com datas locais SP, `fim`
     * inclusivo (vira o dia seguinte 00:00 SP); só `inicio` vai até agora; só `fim` recua 30 dias.
     */
    public janelaHistorico = (datas: { inicio?: string; fim?: string }): Intervalo => {
        const agora = this.clock.now();
        if (datas.inicio && datas.fim) return this.intervaloLocal(datas.inicio, datas.fim);
        if (datas.inicio) {
            return this.validar({ inicio: this.diaLocal(datas.inicio), fim: new Date(agora) });
        }
        const fim = datas.fim
            ? new Date(this.diaLocal(datas.fim).getTime() + DIA_MS)
            : new Date(agora);
        return { inicio: new Date(fim.getTime() - HISTORICO_DIAS_PADRAO * DIA_MS), fim };
    };

    private inicioDoDiaSp = (instante: number): Date => {
        const local = new Date(instante + OFFSET_SP_MS);
        const meiaNoite = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate());
        return new Date(meiaNoite - OFFSET_SP_MS);
    };

    /** Datas locais SP, `fim` inclusivo → `[inicio 00:00 SP, fim+1 00:00 SP)`. */
    private intervaloLocal = (inicio: string, fim: string): Intervalo =>
        this.validar({
            inicio: this.diaLocal(inicio),
            fim: new Date(this.diaLocal(fim).getTime() + DIA_MS),
        });

    private validar = (intervalo: Intervalo): Intervalo => {
        const duracao = intervalo.fim.getTime() - intervalo.inicio.getTime();
        if (duracao <= 0) {
            throw new PerfilQueryInvalidError('O início do período precisa ser antes do fim.');
        }
        if (duracao > MAXIMO_DIAS * DIA_MS) {
            throw new PerfilQueryInvalidError(`O período pode ter no máximo ${MAXIMO_DIAS} dias.`);
        }
        return intervalo;
    };

    /** `YYYY-MM-DD` (SP) → instante da meia-noite SP. Data impossível (30/02) é recusada. */
    private diaLocal = (data: string): Date => {
        const m = DATA_LOCAL.exec(data);
        if (!m) throw new PerfilQueryInvalidError(`Data inválida: use AAAA-MM-DD (${data}).`);
        const [ano, mes, dia] = [Number(m[1]), Number(m[2]), Number(m[3])];
        const utc = new Date(Date.UTC(ano, mes - 1, dia));
        if (
            utc.getUTCFullYear() !== ano ||
            utc.getUTCMonth() !== mes - 1 ||
            utc.getUTCDate() !== dia
        ) {
            throw new PerfilQueryInvalidError(`Data inexistente: ${data}.`);
        }
        return new Date(utc.getTime() - OFFSET_SP_MS);
    };
}
