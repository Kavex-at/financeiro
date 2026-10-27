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

/**
 * Veredito do caminho da 2ª remessa na V7: só vale REAPROVEITADO ou RETIRADO. Erro na 2ª remessa
 * ou caminho indefinido NÃO é prova (HML 2026-10-27: o check passava com `status: 'erro'`).
 */
export const avaliarCaminhoV7 = (r: {
    reaproveitou: boolean;
    retirou: boolean;
    status: string;
}): { ok: boolean; caminho: 'REAPROVEITADO' | 'RETIRADO' | 'indefinido' } => {
    const caminho = r.reaproveitou ? 'REAPROVEITADO' : r.retirou ? 'RETIRADO' : 'indefinido';
    return { ok: caminho !== 'indefinido' && r.status !== 'erro', caminho };
};

export interface EventoBancarioE2e {
    cod: string;
    descricao?: string;
    tipo: number;
    tipoRetorno?: number;
}

export type EscolhaOcorrencia =
    | { ok: true; cod: string; descricao: string }
    | { ok: false; motivo: string };

/**
 * Código de ocorrência da rejeição sintética (V7). Só serve o que o ERP marca como rejeição
 * (`fbeVldTipo 2` + `fbeVldTpret 2`): `AE` ("DATA DE PAGAMENTO ALTERADA", medido em HML
 * 2026-10-27) é informativo e o retorno passa como não rejeitado. Pura: sem rede, sem env.
 */
export const escolherOcorrenciaRejeicao = (
    eventos: readonly EventoBancarioE2e[],
    pedido?: string,
): EscolhaOcorrencia => {
    const rejeicoes = eventos.filter((e) => e.tipo === 2 && e.tipoRetorno === 2);
    const descrever = (e: EventoBancarioE2e): string => e.descricao ?? '';
    if (pedido !== undefined && pedido !== '') {
        const achado = rejeicoes.find((e) => e.cod === pedido);
        if (!achado) {
            const existe = eventos.find((e) => e.cod === pedido);
            return {
                ok: false,
                motivo: existe
                    ? `OCORRENCIA_REJEICAO=${pedido} (${descrever(existe)}) não é rejeição no ERP (tipo ${existe.tipo}, tpret ${existe.tipoRetorno ?? 'ausente'}).`
                    : `OCORRENCIA_REJEICAO=${pedido} não existe na tabela de eventos do banco.`,
            };
        }
        return { ok: true, cod: achado.cod, descricao: descrever(achado) };
    }
    const [primeiro] = [...rejeicoes].sort((a, b) => a.cod.localeCompare(b.cod));
    if (!primeiro) {
        return { ok: false, motivo: 'a tabela de eventos do banco não tem código de rejeição.' };
    }
    return { ok: true, cod: primeiro.cod, descricao: descrever(primeiro) };
};

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

export interface ProvaV7Bloqueada {
    status: string;
    motivo: string;
    freshGuardWithdrawal: boolean;
    oldContext: 'presente' | 'ausente' | 'ambiguo';
    oldItemBefore: string;
    oldItemAfter: string;
    oldBorderoBefore: string;
    oldBorderoAfter: string;
    oldBaixasBefore: string;
    oldBaixasAfter: string;
    remainingGroupItems: number;
    newNativeGroupItems: number;
    rejectionAlertIds: readonly string[];
    newAlerts: readonly { id: string; alvo: string; acao: string; situacao: string }[];
    rejectionTarget: string;
    expectedGuardTarget: string;
    expectedGuardContext: readonly string[];
    groupSignature: string;
    controlSignature: string;
    controlCents: number;
    js: readonly {
        mascara: string;
        signature: string;
        barraCentavos: number;
        pagCentavos: number;
    }[];
}

export const avaliarProvaV7Bloqueada = (e: ProvaV7Bloqueada): { ok: boolean; falhas: string[] } => {
    const falhas: string[] = [];
    if (e.status !== 'gerada' || e.motivo !== 'BORDERO_ANTERIOR_NAO_RESOLVIDO')
        falhas.push('a guarda não retirou o grupo com remessa gerada');
    if (!e.freshGuardWithdrawal) falhas.push('a nova execução importou ou adotou o borderô');
    if (e.oldContext !== 'presente') falhas.push('contexto antigo ausente ou ambíguo');
    falhas.push(
        ...[
            ['item antigo', e.oldItemBefore, e.oldItemAfter],
            ['borderô antigo', e.oldBorderoBefore, e.oldBorderoAfter],
            ['baixas antigas', e.oldBaixasBefore, e.oldBaixasAfter],
        ]
            .filter(([, antes, depois]) => !antes || antes !== depois)
            .map(([nome]) => `${nome} ausente ou alterado`),
    );
    if (e.remainingGroupItems !== 0) falhas.push('membros do grupo permaneceram no lote local');
    if (e.newNativeGroupItems !== 0) falhas.push('grupo importado no novo lote nativo');
    if (
        e.groupSignature === e.controlSignature ||
        e.js.some((j) => j.signature === e.groupSignature)
    )
        falhas.push('grupo presente na nova remessa');
    if (
        e.js.length !== 1 ||
        !e.js.some(
            (j) =>
                j.signature === e.controlSignature &&
                j.barraCentavos === e.controlCents &&
                j.pagCentavos === e.controlCents,
        )
    )
        falhas.push('o J do controle não tem a barra e o valor esperados');
    if (
        e.expectedGuardTarget === e.rejectionTarget ||
        !e.newAlerts.some(
            (a) =>
                !e.rejectionAlertIds.includes(a.id) &&
                a.alvo === e.expectedGuardTarget &&
                a.acao.trim() &&
                e.expectedGuardContext.every((part) => a.situacao.includes(part)),
        )
    )
        falhas.push('alerta novo e acionável da guarda ausente');
    return { ok: falhas.length === 0, falhas };
};
