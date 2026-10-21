import { randomUUID } from 'node:crypto';
import { inject, injectable } from 'tsyringe';
import PostgreeDatabaseClient, {
    type TransactionClient,
} from '../../client/database/PostgreeDatabaseClient.js';
import EtapaBorderoGrupo, {
    ETAPA_BORDERO_GRUPO,
    type EtapaBordero,
} from '../../libs/boleto/EtapaBorderoGrupo.js';

type QueryRunner = Pick<PostgreeDatabaseClient, 'selectMany' | 'selectFirst' | 'insert' | 'update'>;

/** Uma baixa gravada no borderô do grupo (uma por título, I21l(3)). */
export interface BaixaDoGrupo {
    docCod: string;
    titCod: string;
    bxaCodSeq: number;
    valorCentavos: number;
}

/** Linha do ledger `sispag_grupo_boleto_execucao` (ADR-0077, I21l/I21s; migration 0090). */
export interface GrupoBoletoExecucao {
    id: string;
    grupoId: string;
    remessaExecucaoId?: number;
    loteId: string;
    filCod: number;
    bncCod?: number;
    flpCod?: number;
    gerNum?: number;
    /** Data civil `YYYY-MM-DD` do movimento do borderô (= data de débito do lote). */
    borDtaMvto?: string;
    /** `t0`: gravado ANTES do `POST fin010`. */
    escritaIniciadaEm?: Date;
    /** `t1`: gravado depois; ausente se o processo morreu no meio (janela usa `agora`). */
    escritaConcluidaEm?: Date;
    /** Identidade do borderô: `filCod + borCod + borTimCad` (epoch ms do ERP). */
    borCod?: number;
    borTimCad?: number;
    usnCodCad?: number;
    borCodReaproveitadoDe?: string;
    baixas: BaixaDoGrupo[];
    itsCodSeq?: number;
    etapa: EtapaBordero;
    motivo?: string;
    jRejeitadoEm?: Date;
    conexosUsername?: string;
    conexosUsnCod?: string;
    tentativas: number;
    criadoEm: Date;
    atualizadoEm: Date;
}

interface ExecucaoRow {
    id: string;
    grupo_id: string;
    remessa_execucao_id: string | number | null;
    lote_id: string;
    fil_cod: number;
    bnc_cod: number | null;
    flp_cod: number | null;
    ger_num: number | null;
    bor_dta_mvto: string | null;
    escrita_iniciada_em: Date | null;
    escrita_concluida_em: Date | null;
    bor_cod: number | null;
    bor_tim_cad: string | number | null;
    usn_cod_cad: number | null;
    bor_cod_reaproveitado_de: string | null;
    baixas: unknown;
    its_cod_seq: number | null;
    etapa: string;
    motivo: string | null;
    j_rejeitado_em: Date | null;
    conexos_username: string | null;
    conexos_usn_cod: string | null;
    tentativas: number;
    criado_em: Date;
    atualizado_em: Date;
}

const COLUNAS = `id, grupo_id, remessa_execucao_id, lote_id, fil_cod, bnc_cod, flp_cod, ger_num,
    to_char(bor_dta_mvto, 'YYYY-MM-DD') AS bor_dta_mvto, escrita_iniciada_em, escrita_concluida_em,
    bor_cod, bor_tim_cad, usn_cod_cad, bor_cod_reaproveitado_de, baixas, its_cod_seq, etapa, motivo,
    j_rejeitado_em, conexos_username, conexos_usn_cod, tentativas, criado_em, atualizado_em`;

/** Terminais da máquina (fonte única: `EtapaBorderoGrupo`), como lista SQL parametrizada. */
const TERMINAIS: readonly EtapaBordero[] = EtapaBorderoGrupo.todas().filter((e) =>
    EtapaBorderoGrupo.ehTerminal(e),
);

/** Nenhum código de barras entra no motivo (I17j; a 0090 também recusa). */
const DIGITOS_LONGOS = /\d{20,}/;

/** Entrada do write-ahead (`abrir`). */
export interface NovaExecucaoGrupo {
    grupoId: string;
    loteId: string;
    filCod: number;
    remessaExecucaoId?: number;
    bncCod?: number;
    flpCod?: number;
    gerNum?: number;
    /** `YYYY-MM-DD`. */
    borDtaMvto?: string;
    /** `t0` — o relógio do servidor no momento em que a escrita vai começar. */
    escritaIniciadaEm?: Date;
    /** Reaproveitamento (I21s): a execução anterior cujo borderô esta adota. */
    borCodReaproveitadoDe?: string;
    conexosUsername?: string;
    conexosUsnCod?: string;
    /** Inicial: `intencao_gravada` (padrão) ou `simulado` (dry-run, registro direto). */
    etapa?: EtapaBordero;
}

/** Campos que uma etapa grava junto com a transição. */
export interface CamposEtapaGrupo {
    motivo?: string;
    itsCodSeq?: number;
    conexosUsername?: string;
    conexosUsnCod?: string;
}

/**
 * GrupoBoletoExecucaoRepository — ledger write-ahead do borderô de cada grupo numa remessa
 * (ADR-0077, I21l–q, I21s; migration 0090). SQL 100% parametrizado.
 *
 * - `abrir` grava a intenção (`t0`) ANTES de qualquer `POST`; no máximo UMA execução não
 *   terminal por grupo (índice parcial) — conflito devolve a existente.
 * - `registrarBordero` grava `t1` e a identidade `borCod + borTimCad` e NUNCA troca uma
 *   identidade já gravada por outra (o ERP reusa `borCod`; trocar adotaria o borderô alheio).
 * - Toda transição passa pela máquina pura (`EtapaBorderoGrupo`) e é condicionada à etapa lida
 *   (lock otimista): duas retomadas concorrentes nunca avançam a mesma execução.
 */
@injectable()
export default class GrupoBoletoExecucaoRepository {
    public constructor(
        @inject(PostgreeDatabaseClient) private readonly databaseClient: PostgreeDatabaseClient,
    ) {}

    private db = (tx?: TransactionClient): QueryRunner => tx ?? this.databaseClient;

    private map = (r: ExecucaoRow): GrupoBoletoExecucao => ({
        id: r.id,
        grupoId: r.grupo_id,
        loteId: r.lote_id,
        filCod: Number(r.fil_cod),
        ...this.mapDestino(r),
        ...this.mapBordero(r),
        baixas: GrupoBoletoExecucaoRepository.baixasDe(r.baixas),
        etapa: r.etapa as EtapaBordero,
        ...(r.motivo != null ? { motivo: r.motivo } : {}),
        ...(r.j_rejeitado_em != null ? { jRejeitadoEm: new Date(r.j_rejeitado_em) } : {}),
        ...(r.conexos_username != null ? { conexosUsername: r.conexos_username } : {}),
        ...(r.conexos_usn_cod != null ? { conexosUsnCod: r.conexos_usn_cod } : {}),
        tentativas: Number(r.tentativas),
        criadoEm: new Date(r.criado_em),
        atualizadoEm: new Date(r.atualizado_em),
    });

    /** Remessa, lote nativo, conta e data do movimento. */
    private mapDestino = (
        r: ExecucaoRow,
    ): Pick<
        GrupoBoletoExecucao,
        'remessaExecucaoId' | 'bncCod' | 'flpCod' | 'gerNum' | 'borDtaMvto' | 'itsCodSeq'
    > => ({
        ...(r.remessa_execucao_id != null
            ? { remessaExecucaoId: Number(r.remessa_execucao_id) }
            : {}),
        ...(r.bnc_cod != null ? { bncCod: Number(r.bnc_cod) } : {}),
        ...(r.flp_cod != null ? { flpCod: Number(r.flp_cod) } : {}),
        ...(r.ger_num != null ? { gerNum: Number(r.ger_num) } : {}),
        ...(r.bor_dta_mvto != null ? { borDtaMvto: r.bor_dta_mvto } : {}),
        ...(r.its_cod_seq != null ? { itsCodSeq: Number(r.its_cod_seq) } : {}),
    });

    /** Write-ahead (`t0`/`t1`) e identidade do borderô (`borCod + borTimCad`). */
    private mapBordero = (
        r: ExecucaoRow,
    ): Pick<
        GrupoBoletoExecucao,
        | 'escritaIniciadaEm'
        | 'escritaConcluidaEm'
        | 'borCod'
        | 'borTimCad'
        | 'usnCodCad'
        | 'borCodReaproveitadoDe'
    > => ({
        ...(r.escrita_iniciada_em != null
            ? { escritaIniciadaEm: new Date(r.escrita_iniciada_em) }
            : {}),
        ...(r.escrita_concluida_em != null
            ? { escritaConcluidaEm: new Date(r.escrita_concluida_em) }
            : {}),
        ...(r.bor_cod != null ? { borCod: Number(r.bor_cod) } : {}),
        ...(r.bor_tim_cad != null ? { borTimCad: Number(r.bor_tim_cad) } : {}),
        ...(r.usn_cod_cad != null ? { usnCodCad: Number(r.usn_cod_cad) } : {}),
        ...(r.bor_cod_reaproveitado_de != null
            ? { borCodReaproveitadoDe: r.bor_cod_reaproveitado_de }
            : {}),
    });

    /** `baixas JSONB` → lista tipada; entrada malformada é descartada (nunca vira chave falsa). */
    private static baixasDe = (bruto: unknown): BaixaDoGrupo[] =>
        (Array.isArray(bruto) ? bruto : [])
            .map((b) => b as Record<string, unknown>)
            .filter(
                (b) =>
                    typeof b.docCod === 'string' &&
                    typeof b.titCod === 'string' &&
                    Number.isInteger(b.bxaCodSeq) &&
                    Number.isInteger(b.valorCentavos),
            )
            .map((b) => ({
                docCod: b.docCod as string,
                titCod: b.titCod as string,
                bxaCodSeq: b.bxaCodSeq as number,
                valorCentavos: b.valorCentavos as number,
            }));

    private terminaisParams = (): { sql: string; params: Record<string, unknown> } => {
        const params: Record<string, unknown> = {};
        const sql = TERMINAIS.map((e, i) => {
            params[`term${i}`] = e;
            return `$term${i}`;
        }).join(', ');
        return { sql: `(${sql})`, params };
    };

    private checarMotivo = (motivo?: string): void => {
        if (motivo !== undefined && DIGITOS_LONGOS.test(motivo)) {
            throw new Error('motivo da execução do borderô não aceita sequência longa de dígitos');
        }
    };

    /**
     * Write-ahead (I21l(1)): abre a execução ANTES de qualquer escrita no ERP, com `t0` e a
     * identidade Conexos (I-2). Já há uma NÃO terminal para o grupo ⇒ devolve essa
     * (`criado: false`): a retomada continua a mesma execução, nunca abre outra.
     */
    public abrir = async (
        input: NovaExecucaoGrupo,
        tx?: TransactionClient,
    ): Promise<{ criado: boolean; execucao: GrupoBoletoExecucao }> => {
        const etapa = input.etapa ?? ETAPA_BORDERO_GRUPO.INTENCAO_GRAVADA;
        if (
            etapa !== ETAPA_BORDERO_GRUPO.INTENCAO_GRAVADA &&
            etapa !== ETAPA_BORDERO_GRUPO.SIMULADO
        ) {
            throw new Error(`execução do borderô não nasce em ${etapa}`);
        }
        const inserida = await this.db(tx).selectFirst<ExecucaoRow>(
            `INSERT INTO sispag_grupo_boleto_execucao
                (id, grupo_id, remessa_execucao_id, lote_id, fil_cod, bnc_cod, flp_cod, ger_num,
                 bor_dta_mvto, escrita_iniciada_em, bor_cod_reaproveitado_de, etapa,
                 conexos_username, conexos_usn_cod, tentativas)
             VALUES ($id::uuid, $grupoId::uuid, $remessaExecucaoId, $loteId::uuid, $filCod,
                     $bncCod, $flpCod, $gerNum, $borDtaMvto::date, $t0,
                     $reaproveitadoDe::uuid, $etapa, $conexosUsername, $conexosUsnCod, 1)
             ON CONFLICT DO NOTHING
             RETURNING ${COLUNAS}`,
            {
                id: randomUUID(),
                grupoId: input.grupoId,
                remessaExecucaoId: input.remessaExecucaoId ?? null,
                loteId: input.loteId,
                filCod: input.filCod,
                bncCod: input.bncCod ?? null,
                flpCod: input.flpCod ?? null,
                gerNum: input.gerNum ?? null,
                borDtaMvto: input.borDtaMvto ?? null,
                t0: input.escritaIniciadaEm ?? null,
                reaproveitadoDe: input.borCodReaproveitadoDe ?? null,
                etapa,
                conexosUsername: input.conexosUsername ?? null,
                conexosUsnCod: input.conexosUsnCod ?? null,
            },
        );
        if (inserida) return { criado: true, execucao: this.map(inserida) };
        const t = this.terminaisParams();
        const existente = await this.db(tx).selectFirst<ExecucaoRow>(
            `SELECT ${COLUNAS} FROM sispag_grupo_boleto_execucao
              WHERE grupo_id = $grupoId::uuid AND etapa NOT IN ${t.sql}
              LIMIT 1`,
            { grupoId: input.grupoId, ...t.params },
        );
        if (!existente) throw new Error('execução do borderô não encontrada após conflito');
        return { criado: false, execucao: this.map(existente) };
    };

    /** `t0` de uma nova tentativa de escrita (retomada que vai criar o borderô agora). */
    public registrarInicioEscrita = async (
        id: string,
        t0: Date,
        tx?: TransactionClient,
    ): Promise<void> => {
        await this.db(tx).update(
            `UPDATE sispag_grupo_boleto_execucao
                SET escrita_iniciada_em = $t0, escrita_concluida_em = NULL, atualizado_em = now()
              WHERE id = $id::uuid AND bor_cod IS NULL`,
            { id, t0 },
        );
    };

    /**
     * Borderô observado (I21l(2)): `t1` (quando conhecido), `borCod`, `borTimCad` e o usuário que
     * o ERP gravou. Só grava se a execução não tem identidade ou já tem ESTA (idempotente);
     * outra identidade ⇒ `false`, nada muda (o chamador vai a `indeterminado`).
     */
    public registrarBordero = async (
        id: string,
        bordero: {
            borCod: number;
            borTimCad: number;
            usnCodCad?: number;
            escritaConcluidaEm?: Date;
        },
        tx?: TransactionClient,
    ): Promise<boolean> => {
        const n = await this.db(tx).update(
            `UPDATE sispag_grupo_boleto_execucao
                SET bor_cod = $borCod, bor_tim_cad = $borTimCad,
                    usn_cod_cad = COALESCE($usnCodCad, usn_cod_cad),
                    escrita_concluida_em = COALESCE($t1, escrita_concluida_em),
                    atualizado_em = now()
              WHERE id = $id::uuid
                AND (bor_cod IS NULL OR (bor_cod = $borCod AND bor_tim_cad = $borTimCad))`,
            {
                id,
                borCod: bordero.borCod,
                borTimCad: bordero.borTimCad,
                usnCodCad: bordero.usnCodCad ?? null,
                t1: bordero.escritaConcluidaEm ?? null,
            },
        );
        return n > 0;
    };

    /** Uma baixa gravada (I21l(3)); a mesma (doc, tit) registrada de novo substitui a anterior. */
    public registrarBaixa = async (
        id: string,
        baixa: BaixaDoGrupo,
        tx?: TransactionClient,
    ): Promise<void> => {
        await this.db(tx).update(
            `UPDATE sispag_grupo_boleto_execucao
                SET baixas = COALESCE((
                        SELECT jsonb_agg(e) FROM jsonb_array_elements(baixas) e
                         WHERE NOT (e->>'docCod' = $docCod AND e->>'titCod' = $titCod)
                    ), '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
                        'docCod', $docCod::text, 'titCod', $titCod::text,
                        'bxaCodSeq', $bxaCodSeq::int, 'valorCentavos', $valorCentavos::bigint)),
                    atualizado_em = now()
              WHERE id = $id::uuid`,
            {
                id,
                docCod: baixa.docCod,
                titCod: baixa.titCod,
                bxaCodSeq: baixa.bxaCodSeq,
                valorCentavos: baixa.valorCentavos,
            },
        );
    };

    /**
     * Transição validada pela máquina e CONDICIONADA à etapa de origem (lock otimista).
     * `false` = outro processo avançou a execução antes (nada gravado).
     */
    public registrarEtapa = async (
        id: string,
        de: EtapaBordero,
        para: EtapaBordero,
        campos: CamposEtapaGrupo = {},
        tx?: TransactionClient,
    ): Promise<boolean> => {
        EtapaBorderoGrupo.transicionar(de, para);
        this.checarMotivo(campos.motivo);
        const n = await this.db(tx).update(
            `UPDATE sispag_grupo_boleto_execucao
                SET etapa = $para, atualizado_em = now(),
                    motivo = COALESCE($motivo, motivo),
                    its_cod_seq = COALESCE($itsCodSeq, its_cod_seq),
                    conexos_username = COALESCE($conexosUsername, conexos_username),
                    conexos_usn_cod = COALESCE($conexosUsnCod, conexos_usn_cod)
              WHERE id = $id::uuid AND etapa = $de`,
            {
                id,
                de,
                para,
                motivo: campos.motivo ?? null,
                itsCodSeq: campos.itsCodSeq ?? null,
                conexosUsername: campos.conexosUsername ?? null,
                conexosUsnCod: campos.conexosUsnCod ?? null,
            },
        );
        return n > 0;
    };

    /** Nova tentativa sobre a mesma execução (retomada), com a identidade Conexos da vez. */
    public registrarTentativa = async (
        id: string,
        identidade: { conexosUsername?: string; conexosUsnCod?: string },
        tx?: TransactionClient,
    ): Promise<void> => {
        await this.db(tx).update(
            `UPDATE sispag_grupo_boleto_execucao
                SET tentativas = tentativas + 1, atualizado_em = now(),
                    conexos_username = COALESCE($conexosUsername, conexos_username),
                    conexos_usn_cod = COALESCE($conexosUsnCod, conexos_usn_cod)
              WHERE id = $id::uuid`,
            {
                id,
                conexosUsername: identidade.conexosUsername ?? null,
                conexosUsnCod: identidade.conexosUsnCod ?? null,
            },
        );
    };

    /** I21r: o J desta execução foi rejeitado no retorno. Idempotente (guarda o primeiro). */
    public marcarJRejeitado = async (
        id: string,
        em: Date,
        tx?: TransactionClient,
    ): Promise<void> => {
        await this.db(tx).update(
            `UPDATE sispag_grupo_boleto_execucao
                SET j_rejeitado_em = COALESCE(j_rejeitado_em, $em), atualizado_em = now()
              WHERE id = $id::uuid`,
            { id, em },
        );
    };

    public buscarPorId = async (
        id: string,
        tx?: TransactionClient,
    ): Promise<GrupoBoletoExecucao | null> => {
        const row = await this.db(tx).selectFirst<ExecucaoRow>(
            `SELECT ${COLUNAS} FROM sispag_grupo_boleto_execucao WHERE id = $id::uuid`,
            { id },
        );
        return row ? this.map(row) : null;
    };

    /** Todas as execuções do grupo, mais antigas primeiro (situação derivada, I21r). */
    public listarPorGrupo = async (
        grupoId: string,
        tx?: TransactionClient,
    ): Promise<GrupoBoletoExecucao[]> => {
        const rows = (await this.db(tx).selectMany(
            `SELECT ${COLUNAS} FROM sispag_grupo_boleto_execucao
              WHERE grupo_id = $grupoId::uuid
              ORDER BY criado_em, id`,
            { grupoId },
        )) as ExecucaoRow[];
        return rows.map(this.map);
    };

    /** A execução mais recente do grupo, se houver. */
    public ultimaPorGrupo = async (
        grupoId: string,
        tx?: TransactionClient,
    ): Promise<GrupoBoletoExecucao | null> => {
        const row = await this.db(tx).selectFirst<ExecucaoRow>(
            `SELECT ${COLUNAS} FROM sispag_grupo_boleto_execucao
              WHERE grupo_id = $grupoId::uuid
              ORDER BY criado_em DESC, id DESC
              LIMIT 1`,
            { grupoId },
        );
        return row ? this.map(row) : null;
    };

    /** A execução mais recente com J rejeitado (o borderô antigo da I21s), se houver. */
    public ultimaRejeitadaPorGrupo = async (
        grupoId: string,
        tx?: TransactionClient,
    ): Promise<GrupoBoletoExecucao | null> => {
        const row = await this.db(tx).selectFirst<ExecucaoRow>(
            `SELECT ${COLUNAS} FROM sispag_grupo_boleto_execucao
              WHERE grupo_id = $grupoId::uuid AND j_rejeitado_em IS NOT NULL
              ORDER BY criado_em DESC, id DESC
              LIMIT 1`,
            { grupoId },
        );
        return row ? this.map(row) : null;
    };

    /** Execuções de uma remessa (L8: `nossas` da retomada, I16h). */
    public listarPorRemessa = async (
        remessaExecucaoId: number,
        tx?: TransactionClient,
    ): Promise<GrupoBoletoExecucao[]> => {
        const rows = (await this.db(tx).selectMany(
            `SELECT ${COLUNAS} FROM sispag_grupo_boleto_execucao
              WHERE remessa_execucao_id = $remessaExecucaoId
              ORDER BY criado_em, id`,
            { remessaExecucaoId },
        )) as ExecucaoRow[];
        return rows.map(this.map);
    };

    /** Execuções de um lote local (retorno/sincronização casam o J pelo `borCod`, I21r). */
    public listarPorLote = async (
        loteId: string,
        tx?: TransactionClient,
    ): Promise<GrupoBoletoExecucao[]> => {
        const rows = (await this.db(tx).selectMany(
            `SELECT ${COLUNAS} FROM sispag_grupo_boleto_execucao
              WHERE lote_id = $loteId::uuid
              ORDER BY criado_em, id`,
            { loteId },
        )) as ExecucaoRow[];
        return rows.map(this.map);
    };
}
