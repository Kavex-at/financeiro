import 'reflect-metadata';
import type { LancamentoExtrato } from '../../client/ConexosExtratoClient.js';
import {
    buildCorrelationId,
    buildNaturalKey,
    buildTransacaoId,
    ehTransferenciaInterna,
    extrairContraparte,
    extrairRemetente,
    normalizarLancamento,
} from './normalizarLancamento.js';

const lancamento = (over: Partial<LancamentoExtrato> = {}): LancamentoExtrato => ({
    extCod: '137',
    exiCodSeq: '128',
    gerNum: 38,
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
        expect(buildNaturalKey(lancamento())).toBe('fin095:38:137:128');
    });

    it('MUDA quando a identidade do lançamento muda', () => {
        const base = buildNaturalKey(lancamento());
        expect(buildNaturalKey(lancamento({ exiCodSeq: '129' }))).not.toBe(base);
        expect(buildNaturalKey(lancamento({ extCod: '138' }))).not.toBe(base);
        expect(buildNaturalKey(lancamento({ gerNum: 212 }))).not.toBe(base);
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
        const id = buildTransacaoId('fin095:38:137:128');
        expect(id).toBe(buildTransacaoId('fin095:38:137:128'));
        expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
        expect(id).not.toContain(':');
    });

    it('correlationId é determinístico e distinto do id da transação', () => {
        const nk = 'fin095:38:137:128';
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

    // Regressão do report do analista (2026-08-10): a tela mostrava "RECEBIDO" na
    // coluna Contraparte, que o analista lê como se fosse o pagador.
    it.each([
        'PIX RECEBIDO',
        'PIX - RECEBIDO',
        'TED RECEBIDA',
        'TED-CRED CONTA',
        'DOC ENVIADO',
    ])('não devolve o status do lançamento como contraparte (%s)', (historico) => {
        expect(extrairContraparte(historico)).toBeUndefined();
    });
});

describe('extrairRemetente', () => {
    it('extrai o remetente do nrdocto e descarta a cauda de data truncada', () => {
        // Linha real da conta 213 (Bradesco ag 2372), 07/08/2026.
        expect(extrairRemetente('1224537REM: COLUMBIA TRADING S/A  07/0')).toBe(
            'COLUMBIA TRADING S/A',
        );
    });

    it('devolve undefined quando o nrdocto é só número de documento', () => {
        expect(extrairRemetente('000000100463942')).toBeUndefined();
        expect(extrairRemetente(undefined)).toBeUndefined();
        expect(extrairRemetente('1224537REM:   ')).toBeUndefined();
    });
});

describe('ehTransferenciaInterna', () => {
    const titulares = ['COLUMBIA TRADING'];

    it('marca crédito 209 cujo remetente é a própria casa', () => {
        expect(ehTransferenciaInterna('209', 'COLUMBIA TRADING S/A', titulares)).toBe(true);
    });

    it('ignora acento e caixa ao comparar o titular', () => {
        expect(ehTransferenciaInterna('209', 'colúmbia trading s/a', titulares)).toBe(true);
    });

    it('NÃO marca PIX/TED de cliente — 209 sozinha não é ruído', () => {
        expect(ehTransferenciaInterna('209', 'ACME LTDA', titulares)).toBe(false);
    });

    it('NÃO marca quando o remetente não é identificável', () => {
        // `TED-CRED CONTA` não diz quem enviou. Esconder às cegas esconderia recebível.
        expect(ehTransferenciaInterna('209', undefined, titulares)).toBe(false);
    });

    it('NÃO marca fora da categoria 209', () => {
        expect(ehTransferenciaInterna('299', 'COLUMBIA TRADING S/A', titulares)).toBe(false);
        expect(ehTransferenciaInterna(undefined, 'COLUMBIA TRADING S/A', titulares)).toBe(false);
    });

    it('lista de titulares vazia desliga a detecção', () => {
        expect(ehTransferenciaInterna('209', 'COLUMBIA TRADING S/A', [])).toBe(false);
    });
});

describe('normalizarLancamento', () => {
    it('mapeia um crédito real para TransacaoBancaria', () => {
        const t = normalizarLancamento(lancamento(), ctx);
        expect(t).toMatchObject({
            tipo: 'CREDITO',
            valor: 791824.74,
            moeda: 'BRL',
            contraparte: 'BELLIZ INDUSTRIA',
            referenciaBancaria: '20260115128',
            naturalKey: 'fin095:38:137:128',
            status: 'importada',
            importRunId: 'run-1',
            gerNum: 38,
            categoria: '299',
        });
        expect(t.id).toBe(buildTransacaoId(t.naturalKey));
    });

    it('nasce CORPORATIVA — sem filCod (ADR-0032)', () => {
        // Regressão do bug que duplicou a carteira 7×: o `fin095` devolve o mesmo
        // extrato para qualquer filial do header, então carimbar a filial da LEITURA
        // na transação (e na chave natural) gravava uma cópia por filial.
        expect(normalizarLancamento(lancamento(), ctx).filCod).toBeUndefined();
    });

    it('a MESMA linha em runs diferentes converge para a mesma identidade', () => {
        // O cenário real do cron horário: cada execução tem `runId`/`importadoEm`
        // novos. Se a identidade dependesse deles, o `ON CONFLICT (natural_key)`
        // não bateria e a carteira duplicaria a cada hora — 24 cópias por dia.
        const run1 = normalizarLancamento(lancamento(), {
            runId: 'run-1',
            importadoEm: new Date('2026-08-04T10:00:00Z'),
        });
        const run2 = normalizarLancamento(lancamento(), {
            runId: 'run-2',
            importadoEm: new Date('2026-08-04T11:00:00Z'),
        });

        expect(run2.naturalKey).toBe(run1.naturalKey);
        expect(run2.id).toBe(run1.id);
        expect(run2.correlationId).toBe(run1.correlationId);
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

describe('normalizarLancamento — transferência entre contas da casa', () => {
    // Linha REAL do fin095 (conta 213, Bradesco ag 2372, 07/08/2026, R$ 368.000,00)
    // que o analista reportou como "paguei, mas aparece como recebido".
    const interno = (): LancamentoExtrato =>
        lancamento({
            gerNum: 213,
            historico: 'PIX RECEBIDO',
            numeroDocumento: '1224537REM: COLUMBIA TRADING S/A  07/0',
            valor: 368000,
            categoria: '209',
            categoriaDesc: 'TRANSFERÊNCIA INTERBANCÁRIA (DOC, TED)',
        });
    const ctxInterno = { ...ctx, titularesInternos: ['COLUMBIA TRADING'] };

    it('marca a transação como transferência interna', () => {
        expect(normalizarLancamento(interno(), ctxInterno).transferenciaInterna).toBe(true);
    });

    it('usa o remetente como contraparte em vez do resto do histórico', () => {
        // Antes: "PIX RECEBIDO" virava a contraparte "RECEBIDO".
        expect(normalizarLancamento(interno(), ctxInterno).contraparte).toBe(
            'COLUMBIA TRADING S/A',
        );
    });

    it('sem titulares configurados, nada é marcado como interno', () => {
        expect(normalizarLancamento(interno(), ctx).transferenciaInterna).toBe(false);
    });

    it('crédito de cliente na mesma categoria continua na carteira', () => {
        const cliente = lancamento({
            historico: 'PIX RECEBIDO',
            numeroDocumento: '0512345REM: ACME LTDA  07/0',
            categoria: '209',
        });
        const t = normalizarLancamento(cliente, ctxInterno);
        expect(t.transferenciaInterna).toBe(false);
        expect(t.contraparte).toBe('ACME LTDA');
    });

    it('guarda a descrição da conta para a coluna Conta do painel', () => {
        const t = normalizarLancamento(interno(), {
            ...ctxInterno,
            contaDescricao: 'BANCO BRADESCO - AG. 2372 CONTA 92.830-5',
        });
        expect(t.contaDescricao).toBe('BANCO BRADESCO - AG. 2372 CONTA 92.830-5');
    });
});
