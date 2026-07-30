import 'reflect-metadata';
import type { LancamentoExtrato } from '../../client/ConexosExtratoClient.js';
import {
    buildCorrelationId,
    buildNaturalKey,
    buildTransacaoId,
    extrairContraparte,
    normalizarLancamento,
} from './normalizarLancamento.js';

const lancamento = (over: Partial<LancamentoExtrato> = {}): LancamentoExtrato => ({
    extCod: '137',
    exiCodSeq: '128',
    gerNum: 38,
    filCod: 1,
    dataLancamento: new Date('2026-01-15T15:00:00Z'),
    tipo: 'CREDITO',
    valor: 791824.74,
    historico: 'SISPAG  BELLIZ INDUSTRIA',
    numeroDocumento: '20260115128',
    categoria: '299',
    categoriaDesc: 'CRÉDITO DESCONHECIDO',
    conciliadoNoErp: false,
    raw: { extCod: 137, exiCodSeq: 128 },
    ...over,
});

const ctx = { runId: 'run-1', importadoEm: new Date('2026-07-30T12:00:00Z') };

describe('buildNaturalKey', () => {
    it('é estável entre chamadas', () => {
        expect(buildNaturalKey(lancamento())).toBe(buildNaturalKey(lancamento()));
        expect(buildNaturalKey(lancamento())).toBe('fin095:1:38:137:128');
    });

    it('MUDA quando a identidade do lançamento muda', () => {
        const base = buildNaturalKey(lancamento());
        expect(buildNaturalKey(lancamento({ exiCodSeq: '129' }))).not.toBe(base);
        expect(buildNaturalKey(lancamento({ extCod: '138' }))).not.toBe(base);
        expect(buildNaturalKey(lancamento({ gerNum: 212 }))).not.toBe(base);
        expect(buildNaturalKey(lancamento({ filCod: 2 }))).not.toBe(base);
    });

    it('NÃO muda quando o ERP concilia ou o valor é corrigido', () => {
        // Se a chave dependesse de campo mutável, a mesma linha reingeriria como
        // transação nova e duplicaria a carteira do analista.
        const base = buildNaturalKey(lancamento());
        expect(buildNaturalKey(lancamento({ conciliadoNoErp: true }))).toBe(base);
        expect(buildNaturalKey(lancamento({ valor: 999 }))).toBe(base);
        expect(buildNaturalKey(lancamento({ historico: 'outro' }))).toBe(base);
    });
});

describe('buildTransacaoId / buildCorrelationId', () => {
    it('id é determinístico e no formato UUID (sobrevive a path param)', () => {
        const id = buildTransacaoId('fin095:1:38:137:128');
        expect(id).toBe(buildTransacaoId('fin095:1:38:137:128'));
        expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
        expect(id).not.toContain(':');
    });

    it('correlationId é determinístico e distinto do id da transação', () => {
        const nk = 'fin095:1:38:137:128';
        expect(buildCorrelationId(nk)).toBe(buildCorrelationId(nk));
        expect(buildCorrelationId(nk)).not.toBe(buildTransacaoId(nk));
    });

    it('chaves diferentes geram ids diferentes', () => {
        expect(buildTransacaoId('a')).not.toBe(buildTransacaoId('b'));
    });
});

describe('extrairContraparte', () => {
    it.each([
        ['SISPAG  BELLIZ INDUSTRIA', 'BELLIZ INDUSTRIA'],
        ['SISPAG INOX-TECH', 'INOX-TECH'],
        ['TED 745.0001.BROWN-FORMA', 'BROWN-FORMA'],
        ['TED 755.1306.SKYJACK', 'SKYJACK'],
        ['TED 033.3409.SOVENA', 'SOVENA'],
        ['PIX TRANSF  ACME LTDA', 'ACME LTDA'],
    ])('extrai o nome de %s', (historico, esperado) => {
        expect(extrairContraparte(historico)).toBe(esperado);
    });

    it('devolve undefined para histórico ausente ou só espaços', () => {
        expect(extrairContraparte(undefined)).toBeUndefined();
        expect(extrairContraparte('   ')).toBeUndefined();
    });

    it('preserva históricos que não são de cliente em vez de inventar nome', () => {
        // Ruído de tesouraria: não há contraparte, e forjar uma seria pior que nada.
        expect(extrairContraparte('RESGATE COMPROMISSADA')).toBe('RESGATE COMPROMISSADA');
        expect(extrairContraparte('OPERACAO NDF')).toBe('OPERACAO NDF');
        expect(extrairContraparte('ESTORNO CAMBIO')).toBe('ESTORNO CAMBIO');
    });
});

describe('normalizarLancamento', () => {
    it('mapeia um crédito real para TransacaoBancaria', () => {
        const t = normalizarLancamento(lancamento(), ctx);
        expect(t).toMatchObject({
            filCod: 1,
            tipo: 'CREDITO',
            valor: 791824.74,
            moeda: 'BRL',
            contraparte: 'BELLIZ INDUSTRIA',
            referenciaBancaria: '20260115128',
            naturalKey: 'fin095:1:38:137:128',
            status: 'importada',
            importRunId: 'run-1',
            gerNum: 38,
            categoria: '299',
        });
        expect(t.id).toBe(buildTransacaoId(t.naturalKey));
    });

    it('status é SEMPRE importada, mesmo quando o ERP já conciliou', () => {
        // A conciliação do fin095 é banco × sistema do ERP; a nossa é crédito ×
        // processo do cliente. Mapear uma na outra faria o painel declarar
        // resolvido o que ninguém alocou.
        const t = normalizarLancamento(lancamento({ conciliadoNoErp: true }), ctx);
        expect(t.status).toBe('importada');
        expect((t.normalized as { conciliadoNoErp: boolean }).conciliadoNoErp).toBe(true);
    });

    it('mapeia débito e nunca inventa TARIFA/JUROS a partir da categoria', () => {
        const t = normalizarLancamento(
            lancamento({ tipo: 'DEBITO', categoria: '199', categoriaDesc: 'DÉBITO DESCONHECIDO' }),
            ctx,
        );
        expect(t.tipo).toBe('DEBITO');
    });

    it('preserva o histórico BRUTO e a linha crua em normalized', () => {
        const t = normalizarLancamento(lancamento(), ctx);
        expect(t.normalized).toMatchObject({
            fonte: 'conexos/fin095',
            gerNum: 38,
            extCod: '137',
            exiCodSeq: '128',
            historicoBruto: 'SISPAG  BELLIZ INDUSTRIA',
            categoria: '299',
        });
        expect(t.rawPayload).toEqual({ extCod: 137, exiCodSeq: 128 });
    });

    it('omite contraparte e referência quando o extrato não traz', () => {
        const t = normalizarLancamento(
            lancamento({ historico: undefined, numeroDocumento: undefined }),
            ctx,
        );
        expect(t.contraparte).toBeUndefined();
        expect(t.referenciaBancaria).toBeUndefined();
    });

    it('duas normalizações do mesmo lançamento produzem o mesmo id (reingestão idempotente)', () => {
        const a = normalizarLancamento(lancamento(), ctx);
        const b = normalizarLancamento(lancamento(), { runId: 'run-2', importadoEm: new Date() });
        expect(b.id).toBe(a.id);
        expect(b.correlationId).toBe(a.correlationId);
    });
});
