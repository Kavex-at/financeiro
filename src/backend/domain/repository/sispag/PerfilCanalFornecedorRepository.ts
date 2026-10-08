import { inject, injectable } from 'tsyringe';
import { chunked } from '../../client/ConexosBaseClient.js';
import PostgreeDatabaseClient from '../../client/database/PostgreeDatabaseClient.js';
import type {
    ChannelConfidence,
    ChannelGroup,
    ChannelProfile,
} from '../../interface/sispag/SispagInterface.js';

interface PerfilRow {
    pes_cod: string;
    credor: string | null;
    contagens: Record<ChannelGroup, number>;
    pagamentos_unicos: number;
    meses_distintos: number;
    grupo_dominante: string;
    participacao: string | number;
    confianca: string;
    janela_inicio: Date;
    janela_fim: Date;
    calculado_em: Date;
    job_run_id: string;
}

/** Linhas por INSERT multi-linha (parâmetros por linha × lote fica bem abaixo do limite do pg). */
const LOTE_UPSERT = 200;

/**
 * PerfilCanalFornecedorRepository — `perfil_canal_fornecedor` (ADR-0063, I13i). Read model: um
 * perfil por `pes_cod`. A rodada do job grava numa ÚNICA transação: se falhar no meio, nada muda e
 * os perfis anteriores continuam valendo.
 */
@injectable()
export default class PerfilCanalFornecedorRepository {
    public constructor(
        @inject(PostgreeDatabaseClient) private readonly databaseClient: PostgreeDatabaseClient,
    ) {}

    private map = (r: PerfilRow): ChannelProfile => ({
        pesCod: r.pes_cod,
        ...(r.credor != null ? { credor: r.credor } : {}),
        contagens: r.contagens,
        pagamentosUnicos: Number(r.pagamentos_unicos),
        mesesDistintos: Number(r.meses_distintos),
        grupoDominante: r.grupo_dominante as ChannelGroup,
        participacao: Number(r.participacao),
        confianca: r.confianca as ChannelConfidence,
        janelaInicio: new Date(r.janela_inicio).getTime(),
        janelaFim: new Date(r.janela_fim).getTime(),
        calculadoEm: new Date(r.calculado_em).toISOString(),
        jobRunId: r.job_run_id,
    });

    public findByPesCod = async (pesCod: string): Promise<ChannelProfile | null> => {
        const row = await this.databaseClient.selectFirst<PerfilRow>(
            `SELECT pes_cod, credor, contagens, pagamentos_unicos, meses_distintos, grupo_dominante,
                    participacao, confianca, janela_inicio, janela_fim, calculado_em, job_run_id
             FROM perfil_canal_fornecedor WHERE pes_cod = $pesCod`,
            { pesCod },
        );
        return row ? this.map(row) : null;
    };

    /**
     * Candidatos do relatório de autorização (ADR-0065, `listarCandidatosAutorizacao`): favorecidos
     * pagos por TED/PIX no histórico ou com grupo dominante TED_PIX. Paginado (o relatório lê o
     * `cmn025` só da página). Ordem: mais pagamentos TED/PIX primeiro.
     */
    public listarCandidatos = async (params: {
        limite: number;
        deslocamento: number;
    }): Promise<{ perfis: ChannelProfile[]; total: number }> => {
        const filtro = `grupo_dominante = 'TED_PIX' OR COALESCE((contagens->>'TED_PIX')::int, 0) > 0`;
        const [rows, contagem] = await Promise.all([
            this.databaseClient.selectMany(
                `SELECT pes_cod, credor, contagens, pagamentos_unicos, meses_distintos,
                        grupo_dominante, participacao, confianca, janela_inicio, janela_fim,
                        calculado_em, job_run_id
                 FROM perfil_canal_fornecedor
                 WHERE ${filtro}
                 ORDER BY COALESCE((contagens->>'TED_PIX')::int, 0) DESC, pes_cod
                 LIMIT $limite OFFSET $deslocamento`,
                { limite: params.limite, deslocamento: params.deslocamento },
            ),
            this.databaseClient.selectFirst<{ n: number }>(
                `SELECT count(*)::int AS n FROM perfil_canal_fornecedor WHERE ${filtro}`,
            ),
        ]);
        return {
            perfis: (rows as PerfilRow[]).map(this.map),
            total: Number(contagem?.n ?? 0),
        };
    };

    /**
     * Grava os perfis da rodada (UPSERT por `pes_cod`) numa transação. Favorecido que não aparece
     * na rodada mantém o perfil anterior (com o `calculado_em` dele): a tela mostra a idade.
     */
    public upsertRodada = async (perfis: ChannelProfile[], jobRunId: string): Promise<number> => {
        if (perfis.length === 0) return 0;
        return this.databaseClient.withTransaction(async (tx) => {
            let gravados = 0;
            for (const fatia of chunked(perfis, LOTE_UPSERT)) {
                const tuplas: string[] = [];
                const params: Record<string, unknown> = { jobRunId };
                fatia.forEach((p, i) => {
                    tuplas.push(
                        `($p${i}, $c${i}, $ct${i}::jsonb, $n${i}, $m${i}, $g${i}, $pa${i}, $cf${i}, $ji${i}, $jf${i}, now(), $jobRunId)`,
                    );
                    params[`p${i}`] = p.pesCod;
                    params[`c${i}`] = p.credor ?? null;
                    params[`ct${i}`] = JSON.stringify(p.contagens);
                    params[`n${i}`] = p.pagamentosUnicos;
                    params[`m${i}`] = p.mesesDistintos;
                    params[`g${i}`] = p.grupoDominante;
                    params[`pa${i}`] = p.participacao;
                    params[`cf${i}`] = p.confianca;
                    params[`ji${i}`] = new Date(p.janelaInicio);
                    params[`jf${i}`] = new Date(p.janelaFim);
                });
                gravados += await tx.insert(
                    `INSERT INTO perfil_canal_fornecedor
                        (pes_cod, credor, contagens, pagamentos_unicos, meses_distintos,
                         grupo_dominante, participacao, confianca, janela_inicio, janela_fim,
                         calculado_em, job_run_id)
                     VALUES ${tuplas.join(', ')}
                     ON CONFLICT (pes_cod) DO UPDATE SET
                        credor = COALESCE(EXCLUDED.credor, perfil_canal_fornecedor.credor),
                        contagens = EXCLUDED.contagens,
                        pagamentos_unicos = EXCLUDED.pagamentos_unicos,
                        meses_distintos = EXCLUDED.meses_distintos,
                        grupo_dominante = EXCLUDED.grupo_dominante,
                        participacao = EXCLUDED.participacao,
                        confianca = EXCLUDED.confianca,
                        janela_inicio = EXCLUDED.janela_inicio,
                        janela_fim = EXCLUDED.janela_fim,
                        calculado_em = EXCLUDED.calculado_em,
                        job_run_id = EXCLUDED.job_run_id`,
                    params,
                );
            }
            return gravados;
        });
    };
}
