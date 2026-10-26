import 'reflect-metadata';
import type PostgreeDatabaseClient from '../../client/database/PostgreeDatabaseClient.js';
import BloqueioDuplicidadeRepository from './BloqueioDuplicidadeRepository.js';
import LotePagamentoRepository from './LotePagamentoRepository.js';
import VerificacaoEventoRepository from './VerificacaoEventoRepository.js';

/**
 * `retirarGrupoPeloSistema` (ADR-0077, I21p(3)): a retirada do boleto agrupado inteiro numa
 * transação do chamador — N itens, UMA `versao`, N marcas `GRUPO_BOLETO`, N eventos
 * `ITEM_REMOVIDO_SISTEMA` com o motivo do grupo. Unitário (Postgres falso); o SQL real roda no
 * `test:sql`.
 */

interface DbMock {
    selectMany: jest.Mock;
    selectFirst: jest.Mock;
    insert: jest.Mock;
    update: jest.Mock;
}

const buildDb = (): DbMock => ({
    selectMany: jest.fn().mockResolvedValue([]),
    selectFirst: jest.fn().mockResolvedValue(null),
    insert: jest.fn().mockResolvedValue(1),
    update: jest.fn().mockResolvedValue(1),
});

const make = (db: DbMock) => {
    const pg = db as unknown as PostgreeDatabaseClient;
    const eventos = new VerificacaoEventoRepository(pg);
    return new LotePagamentoRepository(pg, eventos, new BloqueioDuplicidadeRepository(pg, eventos));
};

const LOTE = '00000000-0000-0000-0000-000000000001';
const GRUPO = '00000000-0000-0000-0000-0000000000a1';
const MASCARA = '34191…7500';
const TITULOS = ['901', '902', '903'].map((docCod) => ({ filCod: 2, docCod, titCod: '1' }));
const linha = { valor: '525', vencimento: new Date('2026-10-21T00:00:00Z'), credor: 'PEDRONI' };

const params = (over: Record<string, unknown> = {}) => ({
    loteId: LOTE,
    grupoId: GRUPO,
    motivo: 'GRUPO_BOLETO_FALHOU' as const,
    titulos: TITULOS,
    codigoMascarado: MASCARA,
    ...over,
});

const sqls = (m: jest.Mock, tabela: RegExp): unknown[][] =>
    m.mock.calls.filter(([sql]) => tabela.test(String(sql)));

/** Os eventos de retirada do item (as marcas gravam os seus próprios `BLOQUEIO_CRIADO`). */
const retiradas = (m: jest.Mock): unknown[][] =>
    sqls(m, /INSERT INTO sispag_verificacao_evento/).filter(
        ([, p]) => (p as { evento: string }).evento === 'ITEM_REMOVIDO_SISTEMA',
    );

describe('LotePagamentoRepository.retirarGrupoPeloSistema (ADR-0077)', () => {
    it('remove os N itens, bumpa a versão UMA vez, cria N marcas GRUPO_BOLETO e N eventos com o motivo do grupo', async () => {
        const db = buildDb();
        db.selectFirst.mockResolvedValue(linha);
        const r = await make(db).retirarGrupoPeloSistema(
            params(),
            db as unknown as Parameters<LotePagamentoRepository['retirarGrupoPeloSistema']>[1],
        );
        expect(r.removidos).toBe(3);
        expect(sqls(db.selectFirst, /DELETE FROM lote_pagamento_item/)).toHaveLength(3);
        expect(sqls(db.update, /UPDATE lote_pagamento\b/)).toHaveLength(1);
        const marcas = sqls(db.insert, /INSERT INTO titulo_bloqueio_duplicidade/);
        expect(marcas).toHaveLength(3);
        expect(marcas.every(([, p]) => (p as { origem: string }).origem === 'GRUPO_BOLETO')).toBe(
            true,
        );
        const eventos = retiradas(db.insert);
        expect(eventos).toHaveLength(3);
        for (const [, p] of eventos) {
            const e = p as { evento: string; ator: string; dados: string };
            expect(e.evento).toBe('ITEM_REMOVIDO_SISTEMA');
            expect(e.ator).toBe('sistema');
            expect(JSON.parse(e.dados)).toMatchObject({
                motivo: 'GRUPO_BOLETO_FALHOU',
                codigoMascarado: MASCARA,
            });
        }
    });

    it('só retira de lote FINALIZADO: sem linha apagada nada é gravado (removidos 0, sem marca, evento nem versão)', async () => {
        const db = buildDb();
        const r = await make(db).retirarGrupoPeloSistema(
            params(),
            db as unknown as Parameters<LotePagamentoRepository['retirarGrupoPeloSistema']>[1],
        );
        expect(r.removidos).toBe(0);
        expect(db.insert).not.toHaveBeenCalled();
        expect(db.update).not.toHaveBeenCalled();
    });

    it('idempotente: item que já saiu não gera marca nem evento; os demais saem', async () => {
        const db = buildDb();
        db.selectFirst
            .mockResolvedValueOnce(linha)
            .mockResolvedValueOnce(null)
            .mockResolvedValueOnce(linha);
        const r = await make(db).retirarGrupoPeloSistema(
            params(),
            db as unknown as Parameters<LotePagamentoRepository['retirarGrupoPeloSistema']>[1],
        );
        expect(r.removidos).toBe(2);
        expect(sqls(db.insert, /INSERT INTO titulo_bloqueio_duplicidade/)).toHaveLength(2);
        expect(retiradas(db.insert)).toHaveLength(2);
        expect(db.update).toHaveBeenCalledTimes(1);
    });

    it('BORDERO_ANTERIOR_NAO_RESOLVIDO é aceito como motivo do evento', async () => {
        const db = buildDb();
        db.selectFirst.mockResolvedValue(linha);
        await make(db).retirarGrupoPeloSistema(
            params({ motivo: 'BORDERO_ANTERIOR_NAO_RESOLVIDO' }),
            db as unknown as Parameters<LotePagamentoRepository['retirarGrupoPeloSistema']>[1],
        );
        const [, p] = retiradas(db.insert)[0] as [string, { dados: string }];
        expect(JSON.parse(p.dados).motivo).toBe('BORDERO_ANTERIOR_NAO_RESOLVIDO');
    });

    it('código fora da máscara 5+4 é recusado ANTES de tocar o banco (I16e)', async () => {
        const db = buildDb();
        await expect(
            make(db).retirarGrupoPeloSistema(
                params({ codigoMascarado: '34191123456789012345678901234567890123456789' }),
                db as unknown as Parameters<LotePagamentoRepository['retirarGrupoPeloSistema']>[1],
            ),
        ).rejects.toThrow(/mascarado/);
        expect(db.selectFirst).not.toHaveBeenCalled();
    });
});
