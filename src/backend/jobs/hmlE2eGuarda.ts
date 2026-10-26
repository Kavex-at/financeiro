/**
 * Guarda da prova HML ponta a ponta do boleto agrupado (ADR-0077, Task 21).
 *
 * O job `probe-hml-boleto-agrupado-e2e.ts` ESCREVE em HML (lote nativo, borderô, baixas, retorno
 * sintético) e roda o código de PRODUÇÃO (`GrupoBoletoService`, `RemessaService`), que grava no
 * Postgres. Esta classe é pura (sem rede, sem env): recebe o que o job leu do ambiente e devolve
 * se pode seguir. Fica separada do job para ser testada sem executar nada.
 */

/** As fases da prova, na ordem em que fazem sentido. */
export const FASES_E2E = [
    'plano',
    'canonico',
    'falha',
    'retomada',
    'retomada-varredura',
    'v7',
    'estado',
] as const;
export type FaseE2e = (typeof FASES_E2E)[number];

/** As que ESCREVEM em HML: exigem a autorização datada de hoje. */
export const FASES_QUE_ESCREVEM: readonly FaseE2e[] = [
    'canonico',
    'falha',
    'retomada',
    'retomada-varredura',
    'v7',
];

export interface EntradaGuardaE2e {
    conexosBaseUrl?: string;
    hmlEnvFile?: string;
    databaseConnectionString?: string;
    /** `HML_AUTORIZO_ESCRITA`: a data (`AAAA-MM-DD`) em que a pessoa responsável autorizou. */
    autorizaEscrita?: string;
    fase: string;
    /** Hoje, `AAAA-MM-DD` (o job injeta; o teste fixa). */
    hoje: string;
}

export interface ResultadoGuardaE2e {
    permitido: boolean;
    /** Todos os motivos de recusa, para o operador consertar tudo numa rodada só. */
    motivos: string[];
}

const HOSTS_LOCAIS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

export default class GuardaHmlE2e {
    public static avaliar = (e: EntradaGuardaE2e): ResultadoGuardaE2e => {
        const motivos: string[] = [];

        // 1. Conexos: só HML. O `-hml` tem de estar no HOST (a produção não o tem).
        const host = GuardaHmlE2e.hostDe(e.conexosBaseUrl);
        if (host === undefined || !/(^|[.-])hml([.-]|$)/.test(host.split('.')[0] ?? '')) {
            motivos.push(
                `URL do Conexos não é HML (host "${host ?? 'ausente'}"): este job só roda em HML.`,
            );
        }
        if (!e.hmlEnvFile) {
            motivos.push('HML_ENV_FILE ausente: a credencial de HML vem de um arquivo privado.');
        }

        // 2. Postgres: local e descartável. O serviço de produção grava nele.
        const banco = GuardaHmlE2e.hostDoBanco(e.databaseConnectionString);
        if (banco === undefined || !HOSTS_LOCAIS.has(banco)) {
            motivos.push(
                'databaseConnectionString precisa ser um Postgres LOCAL e descartável (localhost, 127.0.0.1 ou ::1); ' +
                    'os serviços de produção gravam nele, nunca no banco de produção.',
            );
        }

        // 3. Fase conhecida; as que escrevem pedem a autorização datada de hoje.
        const fase = FASES_E2E.find((f) => f === e.fase);
        if (fase === undefined) {
            motivos.push(`fase desconhecida "${e.fase}" (válidas: ${FASES_E2E.join(', ')}).`);
        } else if (FASES_QUE_ESCREVEM.includes(fase) && e.autorizaEscrita !== e.hoje) {
            motivos.push(
                `a fase "${fase}" ESCREVE em HML: exige HML_AUTORIZO_ESCRITA=${e.hoje} (autorização de hoje, dada pela pessoa responsável).`,
            );
        }

        return { permitido: motivos.length === 0, motivos };
    };

    /** Host da URL do Conexos; `undefined` se não for uma URL. */
    private static hostDe = (url: string | undefined): string | undefined => {
        if (!url) return undefined;
        try {
            return new URL(url).hostname;
        } catch {
            return undefined;
        }
    };

    /** Host do banco: o do `@host` da URL, nunca um texto no usuário ou na senha. */
    private static hostDoBanco = (dsn: string | undefined): string | undefined => {
        if (!dsn) return undefined;
        try {
            const host = new URL(dsn).hostname;
            return host === '' ? undefined : host;
        } catch {
            return undefined;
        }
    };
}
