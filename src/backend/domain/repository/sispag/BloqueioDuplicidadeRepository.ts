import { randomUUID } from 'node:crypto';
import { inject, injectable } from 'tsyringe';
import PostgreeDatabaseClient, {
    type TransactionClient,
} from '../../client/database/PostgreeDatabaseClient.js';
import {
    type BloqueioDuplicidade,
    type ChaveTitulo,
    DUPLICATE_HOLD_STATE,
    type DuplicateHoldState,
    SISPAG_SYSTEM_ACTOR,
    VERIFICATION_EVENT,
} from '../../interface/sispag/SispagInterface.js';
import VerificacaoEventoRepository from './VerificacaoEventoRepository.js';

interface BloqueioRow {
    id: string;
    fil_cod: number;
    doc_cod: string;
    tit_cod: string;
    pes_cod: string | null;
    alerta_id: string | null;
    lote_id_origem: string | null;
    motivo: string;
    estado: string;
    marcado_por: string;
    marcado_em: Date;
    encerrado_em: Date | null;
    desfeito_por: string | null;
    desfeito_em: Date | null;
    motivo_desfazer: string | null;
}

const COLUNAS = `id, fil_cod, doc_cod, tit_cod, pes_cod, alerta_id, lote_id_origem, motivo, estado,
    marcado_por, marcado_em, encerrado_em, desfeito_por, desfeito_em, motivo_desfazer`;

const iso = (d: Date | null): string | undefined => (d ? new Date(d).toISOString() : undefined);

/**
 * BloqueioDuplicidadeRepository — `titulo_bloqueio_duplicidade` (ADR-0063, I13g). Marca LOCAL; nada
 * é escrito no Conexos. Toda mutação grava o evento na trilha na MESMA transação (I13m).
 */
@injectable()
export default class BloqueioDuplicidadeRepository {
    public constructor(
        @inject(PostgreeDatabaseClient) private readonly databaseClient: PostgreeDatabaseClient,
        @inject(VerificacaoEventoRepository) private readonly eventos: VerificacaoEventoRepository,
    ) {}

    private naTransacao = <T>(
        tx: TransactionClient | undefined,
        fn: (t: TransactionClient) => Promise<T>,
    ): Promise<T> => (tx ? fn(tx) : this.databaseClient.withTransaction(fn));

    private map = (r: BloqueioRow): BloqueioDuplicidade => ({
        id: r.id,
        filCod: r.fil_cod,
        docCod: r.doc_cod,
        titCod: r.tit_cod,
        ...(r.pes_cod != null ? { pesCod: r.pes_cod } : {}),
        ...(r.alerta_id != null ? { alertaId: r.alerta_id } : {}),
        ...(r.lote_id_origem != null ? { loteIdOrigem: r.lote_id_origem } : {}),
        motivo: r.motivo,
        estado: r.estado as DuplicateHoldState,
        marcadoPor: r.marcado_por,
        marcadoEm: new Date(r.marcado_em).toISOString(),
        ...(r.encerrado_em != null ? { encerradoEm: iso(r.encerrado_em) } : {}),
        ...(r.desfeito_por != null ? { desfeitoPor: r.desfeito_por } : {}),
        ...(r.desfeito_em != null ? { desfeitoEm: iso(r.desfeito_em) } : {}),
        ...(r.motivo_desfazer != null ? { motivoDesfazer: r.motivo_desfazer } : {}),
    });

    /** O bloqueio ATIVO do título, se houver (I13g: no máximo um). */
    public findAtivo = async (
        chave: ChaveTitulo,
        tx?: TransactionClient,
    ): Promise<BloqueioDuplicidade | null> => {
        const row = await (tx ?? this.databaseClient).selectFirst<BloqueioRow>(
            `SELECT ${COLUNAS} FROM titulo_bloqueio_duplicidade
             WHERE fil_cod = $filCod AND doc_cod = $docCod AND tit_cod = $titCod
               AND estado = $ativo`,
            { ...chave, ativo: DUPLICATE_HOLD_STATE.ATIVO },
        );
        return row ? this.map(row) : null;
    };

    /** Bloqueios ATIVOS (para a tela marcar os títulos). */
    public listAtivos = async (): Promise<BloqueioDuplicidade[]> => {
        const rows = (await this.databaseClient.selectMany(
            `SELECT ${COLUNAS} FROM titulo_bloqueio_duplicidade WHERE estado = $ativo
             ORDER BY marcado_em DESC`,
            { ativo: DUPLICATE_HOLD_STATE.ATIVO },
        )) as BloqueioRow[];
        return rows.map(this.map);
    };

    /** Cria o bloqueio ATIVO (resolução RETIRAR) + evento BLOQUEIO_CRIADO, na transação dada. */
    public criar = async (
        input: {
            chave: ChaveTitulo;
            pesCod?: string;
            alertaId: string;
            loteIdOrigem: string;
            motivo: string;
            ator: string;
        },
        tx: TransactionClient,
    ): Promise<string> => {
        const id = randomUUID();
        const inseridas = await tx.insert(
            `INSERT INTO titulo_bloqueio_duplicidade
                (id, fil_cod, doc_cod, tit_cod, pes_cod, alerta_id, lote_id_origem, motivo, estado,
                 marcado_por)
             VALUES ($id, $filCod, $docCod, $titCod, $pesCod, $alertaId, $loteIdOrigem, $motivo,
                     $ativo, $ator)
             ON CONFLICT (fil_cod, doc_cod, tit_cod) WHERE estado = 'ATIVO' DO NOTHING`,
            {
                id,
                ...input.chave,
                pesCod: input.pesCod ?? null,
                alertaId: input.alertaId,
                loteIdOrigem: input.loteIdOrigem,
                motivo: input.motivo,
                ativo: DUPLICATE_HOLD_STATE.ATIVO,
                ator: input.ator,
            },
        );
        // Título já bloqueado (outra alerta, mesmo título): o bloqueio ATIVO existente vale.
        if (inseridas === 0) return (await this.findAtivo(input.chave, tx))?.id ?? id;
        await this.eventos.registrar(
            {
                evento: VERIFICATION_EVENT.BLOQUEIO_CRIADO,
                ator: input.ator,
                loteId: input.loteIdOrigem,
                ...input.chave,
                alertaId: input.alertaId,
                bloqueioId: id,
                dados: { motivo: input.motivo },
            },
            tx,
        );
        return id;
    };

    /**
     * I13g — encerra os bloqueios ATIVOS cujo título a ingestão marcou inativo (sumiu do fin064:
     * pago, cancelado ou fora da carteira). Ator `sistema`, um evento por bloqueio, tudo numa
     * transação. Devolve quantos encerrou.
     */
    public encerrarDeTitulosInativos = async (): Promise<number> =>
        this.databaseClient.withTransaction(async (tx) => {
            const encerrados = (await tx.selectMany(
                `UPDATE titulo_bloqueio_duplicidade b
                 SET estado = $encerrado, encerrado_em = now()
                 FROM titulo_a_pagar t
                 WHERE b.estado = $ativo
                   AND t.fil_cod = b.fil_cod AND t.doc_cod = b.doc_cod AND t.tit_cod = b.tit_cod
                   AND t.ativo = FALSE
                 RETURNING b.id, b.fil_cod, b.doc_cod, b.tit_cod`,
                { encerrado: DUPLICATE_HOLD_STATE.ENCERRADO, ativo: DUPLICATE_HOLD_STATE.ATIVO },
            )) as Array<{ id: string; fil_cod: number; doc_cod: string; tit_cod: string }>;
            for (const b of encerrados) {
                await this.eventos.registrar(
                    {
                        evento: VERIFICATION_EVENT.BLOQUEIO_ENCERRADO,
                        ator: SISPAG_SYSTEM_ACTOR,
                        filCod: b.fil_cod,
                        docCod: b.doc_cod,
                        titCod: b.tit_cod,
                        bloqueioId: b.id,
                        dados: { motivo: 'título inativo na ingestão' },
                    },
                    tx,
                );
            }
            return encerrados.length;
        });

    /**
     * A analista desfaz o bloqueio ATIVO do título, com motivo (I13g). Evento BLOQUEIO_DESFEITO na
     * mesma transação. `null` = não havia bloqueio ATIVO (nada gravado).
     */
    public desfazer = async (input: {
        chave: ChaveTitulo;
        motivo: string;
        ator: string;
    }): Promise<BloqueioDuplicidade | null> =>
        this.databaseClient.withTransaction(async (tx) => {
            const row = await tx.selectFirst<BloqueioRow>(
                `UPDATE titulo_bloqueio_duplicidade
                 SET estado = $desfeito, desfeito_por = $ator, desfeito_em = now(),
                     motivo_desfazer = $motivo
                 WHERE fil_cod = $filCod AND doc_cod = $docCod AND tit_cod = $titCod
                   AND estado = $ativo
                 RETURNING ${COLUNAS}`,
                {
                    ...input.chave,
                    desfeito: DUPLICATE_HOLD_STATE.DESFEITO,
                    ativo: DUPLICATE_HOLD_STATE.ATIVO,
                    ator: input.ator,
                    motivo: input.motivo,
                },
            );
            if (!row) return null;
            await this.eventos.registrar(
                {
                    evento: VERIFICATION_EVENT.BLOQUEIO_DESFEITO,
                    ator: input.ator,
                    ...input.chave,
                    bloqueioId: row.id,
                    dados: { motivo: input.motivo },
                },
                tx,
            );
            return this.map(row);
        });
}
