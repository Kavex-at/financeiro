import 'reflect-metadata';
import {
    ALERTA_SEVERIDADE,
    ALERTA_TIPO,
    type AlertaNovo,
} from '../../interface/operacao/Alerta.js';
import AlertaRepository from './AlertaRepository.js';

const novo = (over: Partial<AlertaNovo> = {}): AlertaNovo => ({
    tipo: ALERTA_TIPO.JOB_PARADO,
    alvo: 'sispag-pagamentos',
    severidade: ALERTA_SEVERIDADE.ERRO,
    janelaInicio: new Date('2026-09-01T12:00:00.000Z'),
    detalhe: { idadeMs: 999 },
    ...over,
});

const row = (over: Record<string, unknown> = {}) => ({
    id: '7',
    tipo: ALERTA_TIPO.JOB_PARADO,
    alvo: 'sispag-pagamentos',
    severidade: ALERTA_SEVERIDADE.ERRO,
    dedup_key: 'job-parado:sispag-pagamentos:2026-09-01T12:00:00.000Z',
    janela_inicio: new Date('2026-09-01T12:00:00.000Z'),
    detalhe: { idadeMs: 999 },
    sink_resultados: [{ sink: 'painel', ok: true }],
    criado_em: new Date('2026-09-01T12:00:01.000Z'),
    notificado_em: null,
    reconhecido_em: null,
    reconhecido_por: null,
    ...over,
});

describe('AlertaRepository.criarSeNovo', () => {
    it('devolve null quando o banco recusa por dedup (ON CONFLICT DO NOTHING → 0 linhas)', async () => {
        const db = { selectFirst: jest.fn().mockResolvedValue(null) };
        await expect(new AlertaRepository(db as never).criarSeNovo(novo())).resolves.toBeNull();
    });

    it('serializa o detalhe como JSON e deriva a dedupKey no parâmetro', async () => {
        const db = { selectFirst: jest.fn().mockResolvedValue(row()) };
        await new AlertaRepository(db as never).criarSeNovo(novo());

        const [sql, params] = db.selectFirst.mock.calls[0];
        expect(sql).toContain('ON CONFLICT (dedup_key) DO NOTHING');
        expect(params.dedupKey).toBe('job-parado:sispag-pagamentos:2026-09-01T12:00:00.000Z');
        expect(JSON.parse(params.detalhe)).toEqual({ idadeMs: 999 });
    });

    it('mapeia a linha, normalizando id numérico e datas para ISO', async () => {
        const db = { selectFirst: jest.fn().mockResolvedValue(row()) };
        const alerta = await new AlertaRepository(db as never).criarSeNovo(novo());

        expect(alerta).toMatchObject({
            id: 7,
            tipo: ALERTA_TIPO.JOB_PARADO,
            criadoEm: '2026-09-01T12:00:01.000Z',
        });
        expect(alerta?.notificadoEm).toBeUndefined();
        expect(alerta?.reconhecidoEm).toBeUndefined();
    });

    it('tolera detalhe/sink_resultados nulos vindos do banco', async () => {
        const db = {
            selectFirst: jest.fn().mockResolvedValue(row({ detalhe: null, sink_resultados: null })),
        };
        const alerta = await new AlertaRepository(db as never).criarSeNovo(novo());
        expect(alerta?.detalhe).toEqual({});
        expect(alerta?.sinkResultados).toEqual([]);
    });
});

describe('AlertaRepository — leitura e reconhecimento', () => {
    it('listarAbertos filtra por reconhecido_em IS NULL e respeita o limit', async () => {
        const db = { selectMany: jest.fn().mockResolvedValue([row()]) };
        const alertas = await new AlertaRepository(db as never).listarAbertos(20);

        const [sql, params] = db.selectMany.mock.calls[0];
        expect(sql).toContain('reconhecido_em IS NULL');
        expect(params).toEqual({ limit: 20 });
        expect(alertas).toHaveLength(1);
    });

    it('reconhecer não re-reconhece um alerta já reconhecido', async () => {
        const db = { update: jest.fn().mockResolvedValue(1) };
        await new AlertaRepository(db as never).reconhecer(7, 'yuri');

        const [sql, params] = db.update.mock.calls[0];
        expect(sql).toContain('AND reconhecido_em IS NULL');
        expect(params).toEqual({ id: 7, por: 'yuri' });
    });

    it('registrarEntrega serializa os resultados e carimba notificado_em', async () => {
        const db = { update: jest.fn().mockResolvedValue(1) };
        await new AlertaRepository(db as never).registrarEntrega(7, [{ sink: 'painel', ok: true }]);

        const [sql, params] = db.update.mock.calls[0];
        expect(sql).toContain('notificado_em = now()');
        expect(JSON.parse(params.resultados)).toEqual([{ sink: 'painel', ok: true }]);
    });
});
