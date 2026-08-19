import { inject, injectable } from 'tsyringe';
import type { EtapaStatus } from '../../interface/aprovacoes/constants.js';
import type { EtapaAprovacao } from '../../interface/aprovacoes/EtapaAprovacao.js';
import type { EtapaAprovacaoRepositoryInterface } from '../../interface/aprovacoes/ports.js';
import PostgreeDatabaseClient from '../../client/database/PostgreeDatabaseClient.js';

const COLUNAS = `fil_cod, doc_cod, tit_cod, fbl_cod, ftb_cod, nome, alcada, acao,
                 responsavel_nome, responsavel_cod, status_erp, status,
                 recebido_em, agido_em, duracao_segundos, observacao,
                 ativo, ingestao_run_id, observado_em`;

/**
 * EtapaAprovacaoRepository — CRUD sobre `aprovacao_etapa` (migration 0049).
 * SQL 100% parametrizado com parâmetros NOMEADOS (`$filCod`), como exige o `PostgreeDatabaseClient`.
 */
@injectable()
export default class EtapaAprovacaoRepository implements EtapaAprovacaoRepositoryInterface {
    public constructor(
        @inject(PostgreeDatabaseClient)
        private databaseClient: PostgreeDatabaseClient,
    ) {}

    /**
     * Substitui a trilha de UM título, atomicamente: UPSERT das etapas lidas do ERP e
     * `ativo = false` nas que sumiram **daquele título**.
     *
     * ⚠️ O escopo por título é a decisão central deste método. A Frente II marca inativo tudo que
     * ficou fora da run (`marcarInativosForaDaRun`); **replicar isso aqui seria destrutivo**. O
     * backfill da Frente V é parcial por natureza — processa uma janela, pode ser interrompido,
     * cobre uma filial por vez — e um anti-fantasma global marcaria como fantasma todo o histórico
     * que apenas não foi revisitado nesta passada.
     *
     * Sobre o título que acabamos de reler, sabemos a verdade completa. Sobre os demais, não
     * afirmamos nada. Ver `ontology/business-rules/idempotencia-ingestao-aprovacao.md`.
     */
    public sincronizarTrilha = async (
        chave: { filCod: number; docCod: number; titCod: number },
        etapas: EtapaAprovacao[],
    ): Promise<void> => {
        await this.databaseClient.withTransaction(async (tx) => {
            for (const e of etapas) {
                await tx.update(
                    `INSERT INTO aprovacao_etapa (${COLUNAS}) VALUES (
                        $filCod, $docCod, $titCod, $fblCod, $ftbCod, $nome, $alcada, $acao,
                        $responsavelNome, $responsavelCod, $statusErp, $status,
                        $recebidoEm, $agidoEm, $duracaoSegundos, $observacao,
                        TRUE, $ingestaoRunId, $observadoEm
                     )
                     ON CONFLICT (fil_cod, doc_cod, tit_cod, fbl_cod, ftb_cod) DO UPDATE SET
                        nome = EXCLUDED.nome,
                        alcada = EXCLUDED.alcada,
                        acao = EXCLUDED.acao,
                        responsavel_nome = EXCLUDED.responsavel_nome,
                        responsavel_cod = EXCLUDED.responsavel_cod,
                        status_erp = EXCLUDED.status_erp,
                        status = EXCLUDED.status,
                        recebido_em = EXCLUDED.recebido_em,
                        agido_em = EXCLUDED.agido_em,
                        duracao_segundos = EXCLUDED.duracao_segundos,
                        observacao = EXCLUDED.observacao,
                        ativo = TRUE,
                        ingestao_run_id = EXCLUDED.ingestao_run_id,
                        observado_em = EXCLUDED.observado_em`,
                    {
                        filCod: e.filCod,
                        docCod: e.docCod,
                        titCod: e.titCod,
                        fblCod: e.fblCod,
                        ftbCod: e.ftbCod,
                        nome: e.nome ?? null,
                        alcada: e.alcada ?? null,
                        acao: e.acao ?? null,
                        responsavelNome: e.responsavelNome ?? null,
                        responsavelCod: e.responsavelCod ?? null,
                        statusErp: e.statusErp ?? null,
                        status: e.status,
                        recebidoEm: e.recebidoEm ?? null,
                        agidoEm: e.agidoEm ?? null,
                        duracaoSegundos: e.duracaoSegundos ?? null,
                        observacao: e.observacao ?? null,
                        ingestaoRunId: e.ingestaoRunId ?? null,
                        observadoEm: e.observadoEm,
                    },
                );
            }

            // Etapas que não vieram nesta leitura do título: inativadas, nunca apagadas (I6).
            // Uma lista vazia significa "o título não tem mais etapa nenhuma" — e o `NOT IN` com
            // conjunto vazio precisa continuar valendo, por isso o guard explícito abaixo.
            const chaves = etapas.map((e) => `${e.fblCod}:${e.ftbCod}`);
            await tx.update(
                `UPDATE aprovacao_etapa
                    SET ativo = FALSE
                  WHERE fil_cod = $filCod AND doc_cod = $docCod AND tit_cod = $titCod
                    AND ativo = TRUE
                    AND (fbl_cod || ':' || ftb_cod) <> ALL($chaves::text[])`,
                {
                    filCod: chave.filCod,
                    docCod: chave.docCod,
                    titCod: chave.titCod,
                    chaves,
                },
            );
        });
    };

    public listByTitulo = async (
        filCod: number,
        docCod: number,
        titCod: number,
    ): Promise<EtapaAprovacao[]> => {
        const rows = await this.databaseClient.selectMany(
            `SELECT ${COLUNAS} FROM aprovacao_etapa
              WHERE fil_cod = $filCod AND doc_cod = $docCod AND tit_cod = $titCod
                AND ativo = TRUE
              ORDER BY recebido_em ASC NULLS LAST, fbl_cod ASC, ftb_cod ASC`,
            { filCod, docCod, titCod },
        );
        return rows.map(this.mapRow);
    };

    private mapRow = (r: Record<string, unknown>): EtapaAprovacao => ({
        filCod: Number(r.fil_cod),
        docCod: Number(r.doc_cod),
        titCod: Number(r.tit_cod),
        fblCod: Number(r.fbl_cod),
        ftbCod: Number(r.ftb_cod),
        nome: (r.nome as string) ?? undefined,
        alcada: (r.alcada as string) ?? undefined,
        acao: (r.acao as string) ?? undefined,
        responsavelNome: (r.responsavel_nome as string) ?? undefined,
        responsavelCod: r.responsavel_cod === null ? undefined : Number(r.responsavel_cod),
        statusErp: r.status_erp === null ? undefined : Number(r.status_erp),
        status: r.status as EtapaStatus,
        recebidoEm: r.recebido_em ? new Date(r.recebido_em as string) : undefined,
        agidoEm: r.agido_em ? new Date(r.agido_em as string) : undefined,
        duracaoSegundos: r.duracao_segundos === null ? undefined : Number(r.duracao_segundos),
        observacao: (r.observacao as string) ?? undefined,
        ativo: Boolean(r.ativo),
        ingestaoRunId: (r.ingestao_run_id as string) ?? undefined,
        observadoEm: new Date(r.observado_em as string),
    });
}
