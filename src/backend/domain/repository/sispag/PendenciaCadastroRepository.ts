import { randomUUID } from 'node:crypto';
import { inject, injectable } from 'tsyringe';
import PostgreeDatabaseClient, {
    type TransactionClient,
} from '../../client/database/PostgreeDatabaseClient.js';
import {
    type ChaveTitulo,
    type DestinoManualTipo,
    PAYEE_ISSUE_STATE,
    type PayeeIssueOutcome,
    type PayeeIssueState,
    type PendenciaCadastro,
    type PendenciaCadastroOrigem,
    SISPAG_SYSTEM_ACTOR,
    VERIFICATION_EVENT,
} from '../../interface/sispag/SispagInterface.js';
import VerificacaoEventoRepository from './VerificacaoEventoRepository.js';

interface PendenciaRow {
    id: string;
    pes_cod: string;
    fil_cod: number;
    credor: string | null;
    tipo: string;
    estado: string;
    aberta_por: string;
    aberta_em: Date;
    resolvida_por: string | null;
    resolvida_em: Date | null;
    ultima_conferencia_em: Date | null;
}

interface OrigemRow {
    pendencia_id: string;
    lote_id: string;
    fil_cod: number;
    doc_cod: string;
    tit_cod: string;
    desfecho: string;
    registrada_em: Date;
}

const COLUNAS = `id, pes_cod, fil_cod, credor, tipo, estado, aberta_por, aberta_em, resolvida_por,
    resolvida_em, ultima_conferencia_em`;

export interface OcorrenciaPendencia {
    pesCod: string;
    filCod: number;
    credor?: string;
    tipo: DestinoManualTipo;
    loteId: string;
    chave: ChaveTitulo;
    desfecho: PayeeIssueOutcome;
}

/**
 * PendenciaCadastroRepository — `pendencia_cadastro` + `pendencia_cadastro_origem` (ADR-0063,
 * I13j/I13k). Nenhuma coluna guarda conta ou chave (a pendência é a ausência do dado). Toda mutação
 * grava o evento na trilha na MESMA transação (I13m). Não existe resolução manual: `resolver` é
 * chamado só pelo sistema, quando o cadastro passou a ter o dado.
 */
@injectable()
export default class PendenciaCadastroRepository {
    public constructor(
        @inject(PostgreeDatabaseClient) private readonly databaseClient: PostgreeDatabaseClient,
        @inject(VerificacaoEventoRepository) private readonly eventos: VerificacaoEventoRepository,
    ) {}

    private naTransacao = <T>(
        tx: TransactionClient | undefined,
        fn: (t: TransactionClient) => Promise<T>,
    ): Promise<T> => (tx ? fn(tx) : this.databaseClient.withTransaction(fn));

    private map = (r: PendenciaRow, origens: PendenciaCadastroOrigem[]): PendenciaCadastro => ({
        id: r.id,
        pesCod: r.pes_cod,
        filCod: r.fil_cod,
        ...(r.credor != null ? { credor: r.credor } : {}),
        tipo: r.tipo as DestinoManualTipo,
        estado: r.estado as PayeeIssueState,
        abertaPor: r.aberta_por,
        abertaEm: new Date(r.aberta_em).toISOString(),
        ...(r.resolvida_por != null ? { resolvidaPor: r.resolvida_por } : {}),
        ...(r.resolvida_em != null ? { resolvidaEm: new Date(r.resolvida_em).toISOString() } : {}),
        ...(r.ultima_conferencia_em != null
            ? { ultimaConferenciaEm: new Date(r.ultima_conferencia_em).toISOString() }
            : {}),
        origens,
    });

    private mapOrigem = (o: OrigemRow): PendenciaCadastroOrigem => ({
        loteId: o.lote_id,
        filCod: o.fil_cod,
        docCod: o.doc_cod,
        titCod: o.tit_cod,
        desfecho: o.desfecho as PayeeIssueOutcome,
        registradaEm: new Date(o.registrada_em).toISOString(),
    });

    /**
     * I13k — abre a pendência do (favorecido, tipo) ou, se já há uma ABERTA, só ACRESCENTA a origem
     * (o título e o lote). Repetir a mesma origem não duplica nada nem gera evento. Ator `sistema`.
     */
    public abrirOuAcrescentar = async (
        o: OcorrenciaPendencia,
        tx?: TransactionClient,
    ): Promise<{ pendenciaId: string; aberta: boolean }> =>
        this.naTransacao(tx, async (t) => {
            const novaId = randomUUID();
            const inseridas = await t.insert(
                `INSERT INTO pendencia_cadastro (id, pes_cod, fil_cod, credor, tipo, estado, aberta_por)
                 VALUES ($id, $pesCod, $filCod, $credor, $tipo, $aberta, $ator)
                 ON CONFLICT (pes_cod, tipo) WHERE estado = 'ABERTA' DO NOTHING`,
                {
                    id: novaId,
                    pesCod: o.pesCod,
                    filCod: o.filCod,
                    credor: o.credor ?? null,
                    tipo: o.tipo,
                    aberta: PAYEE_ISSUE_STATE.ABERTA,
                    ator: SISPAG_SYSTEM_ACTOR,
                },
            );
            const aberta = inseridas > 0;
            const pendenciaId = aberta
                ? novaId
                : (
                      await t.selectFirst<{ id: string }>(
                          `SELECT id FROM pendencia_cadastro
                           WHERE pes_cod = $pesCod AND tipo = $tipo AND estado = $aberta`,
                          { pesCod: o.pesCod, tipo: o.tipo, aberta: PAYEE_ISSUE_STATE.ABERTA },
                      )
                  )?.id;
            if (!pendenciaId)
                throw new Error('pendencia_cadastro ABERTA não encontrada após o upsert');
            const origemNova = await t.insert(
                `INSERT INTO pendencia_cadastro_origem
                    (id, pendencia_id, lote_id, fil_cod, doc_cod, tit_cod, desfecho)
                 VALUES ($id, $pendenciaId, $loteId, $filCod, $docCod, $titCod, $desfecho)
                 ON CONFLICT ON CONSTRAINT pendencia_cadastro_origem_unica DO NOTHING`,
                {
                    id: randomUUID(),
                    pendenciaId,
                    loteId: o.loteId,
                    ...o.chave,
                    desfecho: o.desfecho,
                },
            );
            if (aberta || origemNova > 0) {
                await this.eventos.registrar(
                    {
                        evento: aberta
                            ? VERIFICATION_EVENT.PENDENCIA_ABERTA
                            : VERIFICATION_EVENT.PENDENCIA_ORIGEM_ACRESCENTADA,
                        ator: SISPAG_SYSTEM_ACTOR,
                        loteId: o.loteId,
                        ...o.chave,
                        pendenciaId,
                        dados: { pesCod: o.pesCod, tipo: o.tipo, desfecho: o.desfecho },
                    },
                    t,
                );
            }
            return { pendenciaId, aberta };
        });

    /**
     * ABERTA → RESOLVIDA pelo SISTEMA (I13k): o cadastro passou a ter o dado. Por (favorecido,
     * tipo). Devolve quantas resolveu (0 ou 1).
     */
    public resolverDoFavorecido = async (
        pesCod: string,
        tipo: DestinoManualTipo,
        tx?: TransactionClient,
    ): Promise<number> =>
        this.naTransacao(tx, async (t) => {
            const row = await t.selectFirst<{ id: string }>(
                `UPDATE pendencia_cadastro
                 SET estado = $resolvida, resolvida_por = $ator, resolvida_em = now(),
                     ultima_conferencia_em = now()
                 WHERE pes_cod = $pesCod AND tipo = $tipo AND estado = $aberta
                 RETURNING id`,
                {
                    pesCod,
                    tipo,
                    resolvida: PAYEE_ISSUE_STATE.RESOLVIDA,
                    aberta: PAYEE_ISSUE_STATE.ABERTA,
                    ator: SISPAG_SYSTEM_ACTOR,
                },
            );
            if (!row) return 0;
            await this.eventos.registrar(
                {
                    evento: VERIFICATION_EVENT.PENDENCIA_RESOLVIDA,
                    ator: SISPAG_SYSTEM_ACTOR,
                    pendenciaId: row.id,
                    dados: { pesCod, tipo },
                },
                t,
            );
            return 1;
        });

    /** Leitura bem-sucedida do cadastro que ainda NÃO tem o dado: só registra o instante. */
    public tocarConferencia = async (id: string): Promise<void> => {
        await this.databaseClient.update(
            `UPDATE pendencia_cadastro SET ultima_conferencia_em = now()
             WHERE id = $id AND estado = $aberta`,
            { id, aberta: PAYEE_ISSUE_STATE.ABERTA },
        );
    };

    /** Pendências ABERTAS com as origens — a fila "Pendências de cadastro". */
    public listAbertas = async (): Promise<PendenciaCadastro[]> => {
        const rows = (await this.databaseClient.selectMany(
            `SELECT ${COLUNAS} FROM pendencia_cadastro WHERE estado = $aberta
             ORDER BY aberta_em ASC, id ASC`,
            { aberta: PAYEE_ISSUE_STATE.ABERTA },
        )) as PendenciaRow[];
        if (rows.length === 0) return [];
        const origens = (await this.databaseClient.selectMany(
            `SELECT pendencia_id, lote_id, fil_cod, doc_cod, tit_cod, desfecho, registrada_em
             FROM pendencia_cadastro_origem WHERE pendencia_id = ANY($ids)
             ORDER BY registrada_em ASC, id ASC`,
            { ids: rows.map((r) => r.id) },
        )) as OrigemRow[];
        const porPendencia = new Map<string, PendenciaCadastroOrigem[]>();
        for (const o of origens) {
            const lista = porPendencia.get(o.pendencia_id) ?? [];
            lista.push(this.mapOrigem(o));
            porPendencia.set(o.pendencia_id, lista);
        }
        return rows.map((r) => this.map(r, porPendencia.get(r.id) ?? []));
    };
}
