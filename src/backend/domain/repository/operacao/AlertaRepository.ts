import { inject, injectable } from 'tsyringe';
import PostgreeDatabaseClient from '../../client/database/PostgreeDatabaseClient.js';
import {
    type Alerta,
    type AlertaNovo,
    type AlertaSeveridade,
    type AlertaTipo,
    dedupKeyDe,
    type SinkResultado,
} from '../../interface/operacao/Alerta.js';

interface AlertaRow {
    id: string | number;
    tipo: AlertaTipo;
    alvo: string;
    severidade: AlertaSeveridade;
    dedup_key: string;
    janela_inicio: Date;
    detalhe: Record<string, unknown> | null;
    sink_resultados: SinkResultado[] | null;
    criado_em: Date;
    notificado_em: Date | null;
    reconhecido_em: Date | null;
    reconhecido_por: string | null;
}

const COLUNAS = `id, tipo, alvo, severidade, dedup_key, janela_inicio, detalhe,
                 sink_resultados, criado_em, notificado_em, reconhecido_em, reconhecido_por`;

/**
 * AlertaRepository — persistência dos alertas operacionais (ADR-0042).
 *
 * SQL sempre parametrizado. **Não toca o ERP.**
 */
@injectable()
export default class AlertaRepository {
    constructor(
        @inject(PostgreeDatabaseClient)
        private readonly databaseClient: PostgreeDatabaseClient,
    ) {}

    private map = (r: AlertaRow): Alerta => ({
        id: Number(r.id),
        tipo: r.tipo,
        alvo: r.alvo,
        severidade: r.severidade,
        dedupKey: r.dedup_key,
        janelaInicio: r.janela_inicio,
        detalhe: r.detalhe ?? {},
        sinkResultados: r.sink_resultados ?? [],
        criadoEm: r.criado_em.toISOString(),
        ...(r.notificado_em ? { notificadoEm: r.notificado_em.toISOString() } : {}),
        ...(r.reconhecido_em ? { reconhecidoEm: r.reconhecido_em.toISOString() } : {}),
        ...(r.reconhecido_por !== null ? { reconhecidoPor: r.reconhecido_por } : {}),
    });

    /**
     * Cria o alerta, ou devolve `null` se ele já existe na mesma janela.
     *
     * A trava é do BANCO (`ux_alerta_dedup`), não da aplicação: dois detectores concorrentes — um
     * cron atrasado sobrepondo o seguinte — não podem gerar dois alertas do mesmo incidente.
     * `ON CONFLICT DO NOTHING` + `RETURNING` devolve zero linhas exatamente no caso já-existe.
     */
    public criarSeNovo = async (novo: AlertaNovo): Promise<Alerta | null> => {
        const row = await this.databaseClient.selectFirst<AlertaRow>(
            `INSERT INTO alerta (tipo, alvo, severidade, dedup_key, janela_inicio, detalhe)
             VALUES ($tipo, $alvo, $severidade, $dedupKey, $janelaInicio, $detalhe)
             ON CONFLICT (dedup_key) DO NOTHING
             RETURNING ${COLUNAS}`,
            {
                tipo: novo.tipo,
                alvo: novo.alvo,
                severidade: novo.severidade,
                dedupKey: dedupKeyDe(novo),
                janelaInicio: novo.janelaInicio,
                detalhe: JSON.stringify(novo.detalhe),
            },
        );
        return row ? this.map(row) : null;
    };

    /** Grava o desfecho de cada sink e carimba `notificado_em`. */
    public registrarEntrega = async (id: number, resultados: SinkResultado[]): Promise<void> => {
        await this.databaseClient.update(
            `UPDATE alerta
                SET sink_resultados = $resultados, notificado_em = now()
              WHERE id = $id`,
            { id, resultados: JSON.stringify(resultados) },
        );
    };

    /** Alertas ainda não reconhecidos — a lista quente do painel. */
    public listarAbertos = async (limit: number): Promise<Alerta[]> => {
        const rows: AlertaRow[] = await this.databaseClient.selectMany(
            `SELECT ${COLUNAS} FROM alerta
              WHERE reconhecido_em IS NULL
              ORDER BY criado_em DESC
              LIMIT $limit`,
            { limit },
        );
        return rows.map((r) => this.map(r));
    };

    public reconhecer = async (id: number, por: string): Promise<void> => {
        await this.databaseClient.update(
            `UPDATE alerta
                SET reconhecido_em = now(), reconhecido_por = $por
              WHERE id = $id AND reconhecido_em IS NULL`,
            { id, por },
        );
    };
}
