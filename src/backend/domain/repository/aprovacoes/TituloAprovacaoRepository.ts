import { inject, injectable } from 'tsyringe';
import PostgreeDatabaseClient from '../../client/database/PostgreeDatabaseClient.js';
import type { Lacuna, StatusWorkflow } from '../../interface/aprovacoes/constants.js';
import type {
    ListaAprovacoesFiltro,
    TituloAprovacaoRepositoryInterface,
} from '../../interface/aprovacoes/ports.js';
import type {
    TituloAprovacao,
    TituloAprovacaoComTrilha,
} from '../../interface/aprovacoes/TituloAprovacao.js';
import EtapaAprovacaoRepository from './EtapaAprovacaoRepository.js';

const COLUNAS = `fil_cod, doc_cod, tit_cod, documento_numero, titulo_numero,
                 fornecedor_cod, fornecedor_nome, valor, moeda,
                 data_emissao, data_vencimento, data_finalizacao,
                 status_workflow, etapas_concluidas, etapas_totais,
                 primeira_etapa_em, ultima_acao_em, tempo_total_segundos,
                 lacunas, ativo, ingestao_run_id, observado_em`;

/**
 * TituloAprovacaoRepository — CRUD sobre `aprovacao_titulo` (migration 0049).
 * SQL parametrizado com parâmetros NOMEADOS, como exige o `PostgreeDatabaseClient`.
 */
@injectable()
export default class TituloAprovacaoRepository implements TituloAprovacaoRepositoryInterface {
    public constructor(
        @inject(PostgreeDatabaseClient)
        private databaseClient: PostgreeDatabaseClient,
        @inject(EtapaAprovacaoRepository)
        private etapaRepository: EtapaAprovacaoRepository,
    ) {}

    /** UPSERT por chave natural — reprocessar o mesmo título nunca duplica linha (I2). */
    public upsert = async (t: TituloAprovacao): Promise<void> => {
        await this.databaseClient.update(
            `INSERT INTO aprovacao_titulo (${COLUNAS}) VALUES (
                $filCod, $docCod, $titCod, $documentoNumero, $tituloNumero,
                $fornecedorCod, $fornecedorNome, $valor, $moeda,
                $dataEmissao, $dataVencimento, $dataFinalizacao,
                $statusWorkflow, $etapasConcluidas, $etapasTotais,
                $primeiraEtapaEm, $ultimaAcaoEm, $tempoTotalSegundos,
                $lacunas::jsonb, TRUE, $ingestaoRunId, $observadoEm
             )
             ON CONFLICT (fil_cod, doc_cod, tit_cod) DO UPDATE SET
                documento_numero = EXCLUDED.documento_numero,
                titulo_numero = EXCLUDED.titulo_numero,
                fornecedor_cod = EXCLUDED.fornecedor_cod,
                fornecedor_nome = EXCLUDED.fornecedor_nome,
                valor = EXCLUDED.valor,
                moeda = EXCLUDED.moeda,
                data_emissao = EXCLUDED.data_emissao,
                data_vencimento = EXCLUDED.data_vencimento,
                data_finalizacao = EXCLUDED.data_finalizacao,
                status_workflow = EXCLUDED.status_workflow,
                etapas_concluidas = EXCLUDED.etapas_concluidas,
                etapas_totais = EXCLUDED.etapas_totais,
                primeira_etapa_em = EXCLUDED.primeira_etapa_em,
                ultima_acao_em = EXCLUDED.ultima_acao_em,
                tempo_total_segundos = EXCLUDED.tempo_total_segundos,
                lacunas = EXCLUDED.lacunas,
                ativo = TRUE,
                ingestao_run_id = EXCLUDED.ingestao_run_id,
                observado_em = EXCLUDED.observado_em`,
            {
                filCod: t.filCod,
                docCod: t.docCod,
                titCod: t.titCod,
                documentoNumero: t.documentoNumero ?? null,
                tituloNumero: t.tituloNumero ?? null,
                fornecedorCod: t.fornecedorCod ?? null,
                fornecedorNome: t.fornecedorNome ?? null,
                valor: t.valor ?? null,
                moeda: t.moeda ?? null,
                dataEmissao: t.dataEmissao ?? null,
                dataVencimento: t.dataVencimento ?? null,
                dataFinalizacao: t.dataFinalizacao ?? null,
                statusWorkflow: t.statusWorkflow,
                etapasConcluidas: t.etapasConcluidas,
                etapasTotais: t.etapasTotais,
                primeiraEtapaEm: t.primeiraEtapaEm ?? null,
                ultimaAcaoEm: t.ultimaAcaoEm ?? null,
                tempoTotalSegundos: t.tempoTotalSegundos ?? null,
                lacunas: JSON.stringify(t.lacunas ?? []),
                ingestaoRunId: t.ingestaoRunId ?? null,
                observadoEm: t.observadoEm,
            },
        );
    };

    public findById = async (
        filCod: number,
        docCod: number,
        titCod: number,
    ): Promise<TituloAprovacaoComTrilha | null> => {
        const row = await this.databaseClient.selectFirst<Record<string, unknown>>(
            `SELECT ${COLUNAS} FROM aprovacao_titulo
              WHERE fil_cod = $filCod AND doc_cod = $docCod AND tit_cod = $titCod`,
            { filCod, docCod, titCod },
        );
        if (!row) return null;

        const etapas = await this.etapaRepository.listByTitulo(filCod, docCod, titCod);
        return { ...this.mapRow(row), etapas };
    };

    /**
     * Lista paginada do painel. Todos os filtros são aplicados em SQL — a paginação tem de ser
     * confiável, e filtrar em memória depois de paginar devolveria páginas com buracos.
     *
     * `filCods` nunca é opcional: é a allow-list de filiais do usuário, resolvida na rota. Uma
     * lista vazia devolve zero linhas em vez de "todas" — negar por omissão, não permitir.
     */
    public list = async (
        filtro: ListaAprovacoesFiltro,
    ): Promise<{ items: TituloAprovacao[]; total: number }> => {
        if (filtro.filCods.length === 0) return { items: [], total: 0 };

        const condicoes = ['ativo = TRUE', 'fil_cod = ANY($filCods::int[])'];
        const params: Record<string, unknown> = {
            filCods: filtro.filCods,
            limit: filtro.pageSize,
            offset: (filtro.page - 1) * filtro.pageSize,
        };

        if (filtro.status) {
            condicoes.push('status_workflow = $status');
            params.status = filtro.status;
        }
        if (filtro.fornecedorCod !== undefined) {
            condicoes.push('fornecedor_cod = $fornecedorCod');
            params.fornecedorCod = filtro.fornecedorCod;
        }
        if (filtro.emissaoDe) {
            condicoes.push('data_emissao >= $emissaoDe');
            params.emissaoDe = filtro.emissaoDe;
        }
        if (filtro.emissaoAte) {
            condicoes.push('data_emissao <= $emissaoAte');
            params.emissaoAte = filtro.emissaoAte;
        }
        if (filtro.busca) {
            condicoes.push(
                '(documento_numero ILIKE $busca OR titulo_numero ILIKE $busca OR fornecedor_nome ILIKE $busca)',
            );
            params.busca = `%${filtro.busca}%`;
        }
        // Filtrar por responsável exige olhar a trilha, não o cabeçalho.
        if (filtro.responsavel) {
            condicoes.push(`EXISTS (
                SELECT 1 FROM aprovacao_etapa e
                 WHERE e.fil_cod = aprovacao_titulo.fil_cod
                   AND e.doc_cod = aprovacao_titulo.doc_cod
                   AND e.tit_cod = aprovacao_titulo.tit_cod
                   AND e.ativo = TRUE
                   AND e.responsavel_nome ILIKE $responsavel)`);
            params.responsavel = `%${filtro.responsavel}%`;
        }

        const where = condicoes.join(' AND ');

        const totalRow = await this.databaseClient.selectFirst<{ total: string }>(
            `SELECT COUNT(*)::text AS total FROM aprovacao_titulo WHERE ${where}`,
            params,
        );

        const rows = await this.databaseClient.selectMany(
            `SELECT ${COLUNAS} FROM aprovacao_titulo
              WHERE ${where}
              ORDER BY data_emissao DESC NULLS LAST, doc_cod DESC
              LIMIT $limit OFFSET $offset`,
            params,
        );

        return { items: rows.map(this.mapRow), total: Number(totalRow?.total ?? 0) };
    };

    /**
     * Instante da observação mais recente DAS FILIAIS CONSULTADAS (invariante I7).
     *
     * Escopado de propósito: um `MAX` global afirmaria o frescor da filial mais recente para quem
     * está olhando outra. Lista vazia devolve `null` — sem filial, não há o que afirmar.
     */
    public ultimoSnapshot = async (filCods: number[]): Promise<Date | null> => {
        if (filCods.length === 0) return null;

        const row = await this.databaseClient.selectFirst<{ observado_em: string | null }>(
            `SELECT MAX(observado_em) AS observado_em
               FROM aprovacao_titulo
              WHERE fil_cod = ANY($filCods::int[])`,
            { filCods },
        );
        return row?.observado_em ? new Date(row.observado_em) : null;
    };

    private mapRow = (r: Record<string, unknown>): TituloAprovacao => ({
        filCod: Number(r.fil_cod),
        docCod: Number(r.doc_cod),
        titCod: Number(r.tit_cod),
        documentoNumero: (r.documento_numero as string) ?? undefined,
        tituloNumero: (r.titulo_numero as string) ?? undefined,
        fornecedorCod: r.fornecedor_cod === null ? undefined : Number(r.fornecedor_cod),
        fornecedorNome: (r.fornecedor_nome as string) ?? undefined,
        valor: r.valor === null ? undefined : Number(r.valor),
        moeda: (r.moeda as string) ?? undefined,
        dataEmissao: r.data_emissao ? new Date(r.data_emissao as string) : undefined,
        dataVencimento: r.data_vencimento ? new Date(r.data_vencimento as string) : undefined,
        dataFinalizacao: r.data_finalizacao ? new Date(r.data_finalizacao as string) : undefined,
        statusWorkflow: r.status_workflow as StatusWorkflow,
        etapasConcluidas: Number(r.etapas_concluidas ?? 0),
        etapasTotais: Number(r.etapas_totais ?? 0),
        primeiraEtapaEm: r.primeira_etapa_em ? new Date(r.primeira_etapa_em as string) : undefined,
        ultimaAcaoEm: r.ultima_acao_em ? new Date(r.ultima_acao_em as string) : undefined,
        tempoTotalSegundos:
            r.tempo_total_segundos === null ? undefined : Number(r.tempo_total_segundos),
        lacunas: (r.lacunas as Lacuna[]) ?? [],
        ativo: Boolean(r.ativo),
        ingestaoRunId: (r.ingestao_run_id as string) ?? undefined,
        observadoEm: new Date(r.observado_em as string),
    });
}
