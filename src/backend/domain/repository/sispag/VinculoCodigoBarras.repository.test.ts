import 'reflect-metadata';
import type PostgreeDatabaseClient from '../../client/database/PostgreeDatabaseClient.js';
import BloqueioDuplicidadeRepository from './BloqueioDuplicidadeRepository.js';
import LotePagamentoRepository from './LotePagamentoRepository.js';
import SugestaoBoletoRepository from './SugestaoBoletoRepository.js';
import VerificacaoEventoRepository from './VerificacaoEventoRepository.js';

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

const makeLote = (db: DbMock) => {
    const pg = db as unknown as PostgreeDatabaseClient;
    const eventos = new VerificacaoEventoRepository(pg);
    return new LotePagamentoRepository(pg, eventos, new BloqueioDuplicidadeRepository(pg, eventos));
};
const makeSugestao = (db: DbMock) =>
    new SugestaoBoletoRepository(db as unknown as PostgreeDatabaseClient);

const MASCARA = '34191…9000';
const DECISAO = '11111111-1111-1111-1111-111111111111';
const LOTE = '00000000-0000-0000-0000-000000000001';

const header = {
    id: 'L1',
    fil_cod: 2,
    status: 'FINALIZADO',
    criado_por: 'u1',
    versao: 3,
    criado_em: new Date('2026-10-14T00:00:00Z'),
};
const itemRow = (over: Record<string, unknown> = {}) => ({
    lote_id: 'L1',
    fil_cod: 2,
    doc_cod: '636',
    tit_cod: '1',
    incluido_por: 'u1',
    ...over,
});

describe('LotePagamentoRepository — vínculo do código ao item (ADR-0071)', () => {
    describe('leitura', () => {
        it('item legado (colunas nulas) não expõe a chave `vinculoCodigoBarras`', async () => {
            const db = buildDb();
            db.selectFirst.mockResolvedValue(header);
            db.selectMany.mockResolvedValue([itemRow()]);
            const lote = await makeLote(db).getLoteComItens('L1');
            expect(lote?.itens[0]).not.toHaveProperty('vinculoCodigoBarras');
        });

        it('item vinculado devolve origem, decisão, máscara, quando e o lote nativo', async () => {
            const db = buildDb();
            db.selectFirst.mockResolvedValue(header);
            db.selectMany.mockResolvedValue([
                itemRow({
                    vinculo_origem: 'DECISAO_HUMANA',
                    vinculo_decisao_id: DECISAO,
                    vinculo_codigo_mascarado: MASCARA,
                    vinculo_aplicado_em: new Date('2026-10-14T12:00:00Z'),
                    vinculo_flp_cod: 36,
                }),
            ]);
            const lote = await makeLote(db).getLoteComItens('L1');
            expect(lote?.itens[0]?.vinculoCodigoBarras).toEqual({
                origem: 'DECISAO_HUMANA',
                decisaoId: DECISAO,
                codigoMascarado: MASCARA,
                aplicadoEm: '2026-10-14T12:00:00.000Z',
                flpCod: 36,
            });
            const [sql] = db.selectMany.mock.calls[0];
            expect(String(sql)).toContain('i.vinculo_origem');
        });
    });

    describe('caminho do vínculo (ADR-0078, 0091)', () => {
        it('vínculo antigo (sem caminho) não expõe caminho, Δ nem reconhecimento', async () => {
            const db = buildDb();
            db.selectFirst.mockResolvedValue(header);
            db.selectMany.mockResolvedValue([
                itemRow({
                    vinculo_origem: 'DECISAO_HUMANA',
                    vinculo_decisao_id: DECISAO,
                    vinculo_codigo_mascarado: MASCARA,
                    vinculo_aplicado_em: new Date('2026-10-14T12:00:00Z'),
                    vinculo_flp_cod: 36,
                }),
            ]);
            const lote = await makeLote(db).getLoteComItens('L1');
            const v = lote?.itens[0]?.vinculoCodigoBarras;
            expect(v).not.toHaveProperty('caminho');
            expect(v).not.toHaveProperty('deltaDias');
            expect(v).not.toHaveProperty('reconhecimentoId');
        });

        it('lê caminho, deltaDias e reconhecimentoId e seleciona as colunas novas', async () => {
            const db = buildDb();
            db.selectFirst.mockResolvedValue(header);
            db.selectMany.mockResolvedValue([
                itemRow({
                    vinculo_origem: 'DECISAO_HUMANA',
                    vinculo_decisao_id: DECISAO,
                    vinculo_codigo_mascarado: MASCARA,
                    vinculo_aplicado_em: new Date('2026-10-14T12:00:00Z'),
                    vinculo_flp_cod: 36,
                    vinculo_caminho: 'DATA_DIVERGENTE',
                    vinculo_delta_dias: -3,
                    vinculo_reconhecimento_id: DECISAO,
                }),
            ]);
            const lote = await makeLote(db).getLoteComItens('L1');
            expect(lote?.itens[0]?.vinculoCodigoBarras).toMatchObject({
                caminho: 'DATA_DIVERGENTE',
                deltaDias: -3,
                reconhecimentoId: DECISAO,
            });
            const [sql] = db.selectMany.mock.calls[0];
            expect(String(sql)).toContain('i.vinculo_caminho');
            expect(String(sql)).toContain('i.vinculo_reconhecimento_id');
        });

        it('grava caminho, Δ e reconhecimento parametrizados; sem eles grava nulos', async () => {
            const db = buildDb();
            const base = {
                loteId: LOTE,
                filCod: 2,
                docCod: '636',
                titCod: '1',
                origem: 'DECISAO_HUMANA' as const,
                decisaoId: DECISAO,
                codigoMascarado: MASCARA,
                flpCod: 36,
            };
            await makeLote(db).gravarVinculoCodigoBarras({
                ...base,
                caminho: 'DATA_DIVERGENTE',
                deltaDias: 7,
                reconhecimentoId: DECISAO,
            });
            await makeLote(db).gravarVinculoCodigoBarras(base);
            expect(String(db.update.mock.calls[0][0])).toMatch(/vinculo_caminho = \$caminho/);
            expect(db.update.mock.calls[0][1]).toMatchObject({
                caminho: 'DATA_DIVERGENTE',
                deltaDias: 7,
                reconhecimentoId: DECISAO,
            });
            expect(
                db.update.mock.calls.filter(([q]) => /vinculo_caminho/.test(String(q)))[1][1],
            ).toMatchObject({
                caminho: null,
                deltaDias: null,
                reconhecimentoId: null,
            });
        });
    });

    describe('gravarVinculoCodigoBarras', () => {
        const params = {
            loteId: LOTE,
            filCod: 2,
            docCod: '636',
            titCod: '1',
            origem: 'DECISAO_HUMANA' as const,
            decisaoId: DECISAO,
            codigoMascarado: MASCARA,
            flpCod: 36,
        };

        it('grava as cinco colunas, parametrizado, e bumpa a versão do lote', async () => {
            const db = buildDb();
            const ok = await makeLote(db).gravarVinculoCodigoBarras(params);
            expect(ok).toBe(true);
            const [sql, p] = db.update.mock.calls[0];
            expect(String(sql)).toMatch(/UPDATE lote_pagamento_item/);
            expect(String(sql)).not.toContain(MASCARA);
            expect(p).toMatchObject({
                origem: 'DECISAO_HUMANA',
                decisaoId: DECISAO,
                codigoMascarado: MASCARA,
                flpCod: 36,
            });
            const versao = db.update.mock.calls.find(([q]) =>
                /versao = versao \+ 1/.test(String(q)),
            );
            expect(versao).toBeDefined();
        });

        it('item fora do lote local ⇒ false e a versão NÃO é tocada', async () => {
            const db = buildDb();
            db.update.mockResolvedValueOnce(0);
            expect(await makeLote(db).gravarVinculoCodigoBarras(params)).toBe(false);
            expect(db.update).toHaveBeenCalledTimes(1);
        });

        it.each([
            ['44 dígitos', '3'.repeat(44)],
            ['47 dígitos', '3'.repeat(47)],
            ['sem reticências', '341919000'],
            ['vazia', ''],
        ])('recusa máscara fora de 5+4 antes de tocar o banco: %s', async (_n, mascara) => {
            const db = buildDb();
            await expect(
                makeLote(db).gravarVinculoCodigoBarras({ ...params, codigoMascarado: mascara }),
            ).rejects.toThrow(/mascarado/);
            expect(db.update).not.toHaveBeenCalled();
        });
    });

    describe('retirada por vínculo falho', () => {
        it('aceita o motivo novo e grava a marca com a origem nova', async () => {
            const db = buildDb();
            db.selectFirst.mockResolvedValueOnce({
                valor: '1028.8',
                vencimento: null,
                credor: 'X',
            });
            const tx = db as unknown as Parameters<
                LotePagamentoRepository['retirarItemPorCodigoDeBarras']
            >[1];
            const r = await makeLote(db).retirarItemPorCodigoDeBarras(
                {
                    loteId: LOTE,
                    filCod: 2,
                    docCod: '636',
                    titCod: '1',
                    motivo: 'VINCULO_CODIGO_BARRAS_FALHOU',
                    codigoMascarado: MASCARA,
                },
                tx,
            );
            expect(r.removido).toBe(true);
            const marca = db.insert.mock.calls.find(([q]) =>
                String(q).includes('INSERT INTO titulo_bloqueio_duplicidade'),
            );
            expect(marca?.[1]).toMatchObject({
                origem: 'VINCULO_CODIGO_BARRAS_FALHOU',
                codigoMascarado: MASCARA,
            });
        });
    });
});

describe('SugestaoBoletoRepository — eventos de vínculo (ADR-0071)', () => {
    it('VINCULO_APLICADO: ON CONFLICT DO NOTHING, lote e decisão em colunas, sem código', async () => {
        const db = buildDb();
        const r = await makeSugestao(db).registrarEventoVinculo({
            tipo: 'VINCULO_APLICADO',
            ator: 'sistema',
            loteId: LOTE,
            decisaoId: DECISAO,
            filCod: 2,
            docCod: '636',
            titCod: '1',
            detalhe: { codigoMascarado: MASCARA, flpCod: 36 },
        });
        expect(r).toEqual({ inserido: true });
        const [sql, p] = db.update.mock.calls[0];
        expect(String(sql)).toMatch(/ON CONFLICT DO NOTHING/);
        expect(p).toMatchObject({ tipo: 'VINCULO_APLICADO', loteId: LOTE, decisaoId: DECISAO });
        expect(String(p.detalhe)).toContain(MASCARA);
    });

    it('segundo evento do mesmo (lote, título, decisão) não entra: inserido=false', async () => {
        const db = buildDb();
        db.update.mockResolvedValueOnce(0);
        const r = await makeSugestao(db).registrarEventoVinculo({
            tipo: 'VINCULO_APLICADO',
            ator: 'sistema',
            loteId: LOTE,
            decisaoId: DECISAO,
        });
        expect(r.inserido).toBe(false);
    });

    it('recusa detalhe com dígitos longos (nunca o código)', async () => {
        const db = buildDb();
        await expect(
            makeSugestao(db).registrarEventoVinculo({
                tipo: 'VINCULO_FALHOU',
                ator: 'sistema',
                loteId: LOTE,
                detalhe: { codigo: '3'.repeat(44) },
            }),
        ).rejects.toThrow(/dígitos longos/);
        expect(db.update).not.toHaveBeenCalled();
    });

    it('existeVinculoAplicado consulta por (lote, título, decisão)', async () => {
        const db = buildDb();
        db.selectFirst.mockResolvedValueOnce({ n: 1 });
        const ok = await makeSugestao(db).existeVinculoAplicado({
            loteId: LOTE,
            filCod: 2,
            docCod: '636',
            titCod: '1',
            decisaoId: DECISAO,
        });
        expect(ok).toBe(true);
        const [sql] = db.selectFirst.mock.calls[0];
        expect(String(sql)).toMatch(/tipo = 'VINCULO_APLICADO'/);
    });
});
