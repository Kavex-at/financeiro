import { inject, injectable } from 'tsyringe';
import PostgreeDatabaseClient from '../../client/database/PostgreeDatabaseClient.js';
import type { AprovacaoIngestaoRunRepositoryInterface } from '../../interface/aprovacoes/ports.js';
import type { AprovacaoIngestaoRun } from '../../interface/aprovacoes/TituloAprovacao.js';

/**
 * AprovacaoIngestaoRunRepository — auditoria e **cursor de retomada** da ingestão.
 *
 * O cursor é o que separa um backfill viável de um que nunca termina: sem acesso à tela `fin103`
 * (PV-07), a trilha custa uma chamada ao ERP por título — 23.632 só na filial 2 em 12 meses. Cair
 * no título 12.000 e recomeçar do zero desperdiçaria horas.
 */
@injectable()
export default class AprovacaoIngestaoRunRepository
    implements AprovacaoIngestaoRunRepositoryInterface
{
    public constructor(
        @inject(PostgreeDatabaseClient)
        private databaseClient: PostgreeDatabaseClient,
    ) {}

    public iniciar = async (run: AprovacaoIngestaoRun): Promise<void> => {
        await this.databaseClient.insert(
            `INSERT INTO aprovacao_ingestao_run
                (id, triggered_by, status, fil_cods, emissao_desde,
                 total_titulos, total_etapas, started_at)
             VALUES
                ($id, $triggeredBy, 'running', $filCods::jsonb, $emissaoDesde, 0, 0, $startedAt)`,
            {
                id: run.id,
                triggeredBy: run.triggeredBy,
                filCods: JSON.stringify(run.filCods ?? []),
                emissaoDesde: run.emissaoDesde ?? null,
                startedAt: run.startedAt,
            },
        );
    };

    /**
     * Grava o cursor **depois** de o título ter sido persistido com sucesso.
     *
     * A ordem importa: se a run cair no meio de um título, ele é reprocessado na retomada — e o
     * UPSERT torna isso inofensivo. Gravar o cursor antes abriria a janela oposta, em que um título
     * é pulado por ter sido "anunciado" e nunca escrito.
     */
    public salvarCursor = async (
        id: string,
        cursor: { filCod: number; pagina: number; docCod: number },
        totais: { titulos: number; etapas: number },
    ): Promise<void> => {
        await this.databaseClient.update(
            `UPDATE aprovacao_ingestao_run
                SET cursor_fil_cod = $filCod,
                    cursor_pagina  = $pagina,
                    cursor_doc_cod = $docCod,
                    total_titulos  = $titulos,
                    total_etapas   = $etapas
              WHERE id = $id`,
            {
                id,
                filCod: cursor.filCod,
                pagina: cursor.pagina,
                docCod: cursor.docCod,
                titulos: totais.titulos,
                etapas: totais.etapas,
            },
        );
    };

    public finalizar = async (
        id: string,
        status: 'success' | 'error',
        errorMessage?: string,
    ): Promise<void> => {
        await this.databaseClient.update(
            `UPDATE aprovacao_ingestao_run
                SET status = $status,
                    error_message = $errorMessage,
                    finished_at = now()
              WHERE id = $id`,
            { id, status, errorMessage: errorMessage ?? null },
        );
    };

    /**
     * A run interrompida mais recente — a que ficou em `running` sem `finished_at`.
     *
     * Uma run em `running` só existe se o processo morreu antes de finalizar (o caminho normal
     * sempre grava `success` ou `error`). É exatamente essa que se quer retomar.
     */
    public ultimaRunRetomavel = async (): Promise<AprovacaoIngestaoRun | null> => {
        const row = await this.databaseClient.selectFirst<Record<string, unknown>>(
            `SELECT id, triggered_by, status, fil_cods, emissao_desde,
                    total_titulos, total_etapas,
                    cursor_fil_cod, cursor_pagina, cursor_doc_cod,
                    error_message, started_at, finished_at
               FROM aprovacao_ingestao_run
              WHERE status = 'running' AND finished_at IS NULL
              ORDER BY started_at DESC
              LIMIT 1`,
        );
        if (!row) return null;

        return {
            id: String(row.id),
            triggeredBy: String(row.triggered_by),
            status: row.status as AprovacaoIngestaoRun['status'],
            filCods: (row.fil_cods as number[]) ?? [],
            emissaoDesde: row.emissao_desde ? new Date(row.emissao_desde as string) : undefined,
            totalTitulos: Number(row.total_titulos ?? 0),
            totalEtapas: Number(row.total_etapas ?? 0),
            cursorFilCod: row.cursor_fil_cod === null ? undefined : Number(row.cursor_fil_cod),
            cursorPagina: row.cursor_pagina === null ? undefined : Number(row.cursor_pagina),
            cursorDocCod: row.cursor_doc_cod === null ? undefined : Number(row.cursor_doc_cod),
            errorMessage: (row.error_message as string) ?? undefined,
            startedAt: new Date(row.started_at as string),
            finishedAt: row.finished_at ? new Date(row.finished_at as string) : undefined,
        };
    };
}
