import 'reflect-metadata';
import type PostgreeDatabaseClient from '../../client/database/PostgreeDatabaseClient.js';
import { REGRA_TIPO } from '../../interface/recebimentos/constants.js';
import type { RegraRecebimento } from '../../interface/recebimentos/RegraRecebimento.js';
import RegraRecebimentoRepository from './RegraRecebimentoRepository.js';

const buildDb = () =>
    ({
        insert: jest.fn().mockResolvedValue(1),
        update: jest.fn().mockResolvedValue(1),
        selectMany: jest.fn().mockResolvedValue([]),
        selectFirst: jest.fn().mockResolvedValue(null),
    }) as unknown as jest.Mocked<PostgreeDatabaseClient>;

const buildRegra = (o: Partial<RegraRecebimento> = {}): RegraRecebimento => ({
    id: 'regra-1',
    tipo: REGRA_TIPO.ENCOMENDA,
    versao: 1,
    vigenteDe: new Date('2026-01-01T00:00:00Z'),
    parametros: { pct: 10 },
    explicacao: 'encomenda',
    ativo: true,
    ...o,
});

describe('RegraRecebimentoRepository', () => {
    it('save: UPSERT por (tipo, versao), jsonb, parametrizado', async () => {
        const db = buildDb();
        await new RegraRecebimentoRepository(db).save(buildRegra());
        const [sql, params] = (db.update as jest.Mock).mock.calls[0];
        expect(sql).toContain('INSERT INTO regra_recebimento');
        expect(sql).toContain('ON CONFLICT (tipo, versao) DO UPDATE');
        expect(sql).toContain('$parametros::jsonb');
        expect(sql).not.toMatch(/'\s*\+|\$\{/);
        expect(params).toMatchObject({ id: 'regra-1', tipo: REGRA_TIPO.ENCOMENDA, versao: 1 });
        expect(params.parametros).toBe(JSON.stringify({ pct: 10 }));
    });

    it('listAtivas: filtra ativo=true, ordena por tipo/versao desc, mapeia', async () => {
        const db = buildDb();
        (db.selectMany as jest.Mock).mockResolvedValue([
            {
                id: 'regra-1',
                tipo: 'ENCOMENDA',
                versao: 2,
                vigente_de: '2026-01-01T00:00:00Z',
                parametros: { pct: 10 },
                explicacao: 'encomenda',
                ativo: true,
            },
        ]);
        const rows = await new RegraRecebimentoRepository(db).listAtivas();
        const sql = (db.selectMany as jest.Mock).mock.calls[0][0] as string;
        expect(sql).toContain('WHERE ativo = true');
        expect(sql).toContain('ORDER BY tipo, versao DESC');
        expect(rows[0]).toMatchObject({ id: 'regra-1', versao: 2, ativo: true });
    });
});
