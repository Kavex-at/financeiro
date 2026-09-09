import 'reflect-metadata';
import ElegibilidadeService from './ElegibilidadeService.js';
import CasamentoInvoiceService from './CasamentoInvoiceService.js';
import {
    ESTADO_ELEGIBILIDADE,
    MOTIVO_BLOQUEIO,
} from '../../interface/permutas/EstadoElegibilidade.js';
import { GATE } from '../../interface/permutas/PermutaCandidata.js';
import type Adiantamento from '../../interface/permutas/Adiantamento.js';
import type Invoice from '../../interface/permutas/Invoice.js';
import type { DeclaracaoEntry } from '../../client/ConexosCadastroClient.js';

const buildAdiantamento = (overrides: Partial<Adiantamento> = {}): Adiantamento => ({
    docCod: 'A1',
    priCod: '2048',
    filCod: 2,
    dataEmissao: new Date('2026-03-01'),
    valor: 1000,
    moeda: 'USD',
    pago: true,
    valorPermutar: 1000,
    ...overrides,
});

const buildInvoice = (overrides: Partial<Invoice> = {}): Invoice => ({
    docCod: 'I1',
    priCod: '2048',
    dataEmissao: new Date('2026-04-01'),
    valor: 1000,
    moeda: 'USD',
    pago: false,
    ...overrides,
});

const di: DeclaracaoEntry = { variante: 'DI', priCod: '2048' };
const duimp: DeclaracaoEntry = { variante: 'DUIMP', priCod: '2048' };

describe('ElegibilidadeService.avaliarElegibilidade (I3: 4 gates + INVOICE casada)', () => {
    const service = new ElegibilidadeService(new CasamentoInvoiceService());

    it('1 adiantamento + 1 invoice + D.I, 4 gates green → ELEGIVEL', () => {
        const result = service.avaliarElegibilidade({
            adiantamento: buildAdiantamento(),
            declaracoes: [di],
            invoices: [buildInvoice()],
        });
        expect(result.estadoElegibilidade).toBe(ESTADO_ELEGIBILIDADE.ELEGIVEL);
        expect(result.motivoBloqueio).toBeUndefined();
        expect(result.invoiceCasada?.docCod).toBe('I1');
        expect(result.declaracaoImportacao?.variante).toBe('DI');
        // gatesAvaliados records all 4 gates as passed (audit I5).
        expect(result.gatesAvaliados).toHaveLength(4);
        expect(result.gatesAvaliados.every((g) => g.passed)).toBe(true);
    });

    it('same candidate without invoice → BLOQUEADA(sem-invoice)', () => {
        const result = service.avaliarElegibilidade({
            adiantamento: buildAdiantamento(),
            declaracoes: [di],
            invoices: [],
        });
        expect(result.estadoElegibilidade).toBe(ESTADO_ELEGIBILIDADE.BLOQUEADA);
        expect(result.motivoBloqueio).toBe(MOTIVO_BLOQUEIO.SEM_INVOICE);
    });

    it('multiple invoices (N:M) → CASAMENTO_MANUAL, gates all passed (ADR-0005)', () => {
        const result = service.avaliarElegibilidade({
            adiantamento: buildAdiantamento(),
            declaracoes: [di],
            invoices: [buildInvoice({ docCod: 'I1' }), buildInvoice({ docCod: 'I2' })],
        });
        // N:M deixou de ser bloqueada: passou os 4 gates, falta o analista
        // escolher a invoice. Motivo segue informativo (qual sabor de N:M).
        expect(result.estadoElegibilidade).toBe(ESTADO_ELEGIBILIDADE.CASAMENTO_MANUAL);
        expect(result.motivoBloqueio).toBe(MOTIVO_BLOQUEIO.COMPOSTO_NM);
        expect(result.gatesAvaliados).toHaveLength(4);
        expect(result.gatesAvaliados.every((g) => g.passed)).toBe(true);
        // N:M carrega as invoices candidatas p/ persistir e o analista escolher (ADR-0005).
        expect(result.invoicesCandidatas?.map((i) => i.docCod)).toEqual(['I1', 'I2']);
    });

    it('valorPermutar = 0 (pago) sem valorPermutado → BLOQUEADA(sem-saldo-permutar) (Gate 2)', () => {
        const result = service.avaliarElegibilidade({
            // pago, saldo zerado E nunca permutado (valorPermutado ausente) →
            // genuinamente sem saldo a permutar.
            adiantamento: buildAdiantamento({ valorPermutar: 0 }),
            declaracoes: [di],
            invoices: [buildInvoice()],
        });
        expect(result.estadoElegibilidade).toBe(ESTADO_ELEGIBILIDADE.BLOQUEADA);
        expect(result.motivoBloqueio).toBe(MOTIVO_BLOQUEIO.SEM_SALDO_PERMUTAR);
        const gate2 = result.gatesAvaliados.find((g) => g.gate === GATE.VALOR_PERMUTAR);
        expect(gate2?.passed).toBe(false);
    });

    it('valorPermutar = 0 explícito (valorPermutado=0) → sem-saldo-permutar', () => {
        const result = service.avaliarElegibilidade({
            adiantamento: buildAdiantamento({ valorPermutar: 0, valorPermutado: 0 }),
            declaracoes: [di],
            invoices: [buildInvoice()],
        });
        expect(result.estadoElegibilidade).toBe(ESTADO_ELEGIBILIDADE.BLOQUEADA);
        expect(result.motivoBloqueio).toBe(MOTIVO_BLOQUEIO.SEM_SALDO_PERMUTAR);
    });

    // T6 (ADR-0043) — pago + Gate 2 reprovado + `valorPermutado > 0` deixa de ser
    // BLOQUEADA e passa ao estado CONCLUÍDO `JA_PERMUTADO`. O motivo permanece,
    // informativo, no mesmo padrão de `composto-nm`/CASAMENTO_MANUAL.
    it('T6: valorPermutar = 0 (pago) MAS valorPermutado > 0 → JA_PERMUTADO (doc 8266)', () => {
        const result = service.avaliarElegibilidade({
            // Print real Conexos doc 8266: pago E saldo já 100% consumido numa
            // permuta (valorPermutado = mnyTitPermuta = 378636.28) → estado
            // concluído, não reprovação de mérito.
            adiantamento: buildAdiantamento({ valorPermutar: 0, valorPermutado: 378636.28 }),
            declaracoes: [di],
            invoices: [buildInvoice()],
        });
        expect(result.estadoElegibilidade).toBe(ESTADO_ELEGIBILIDADE.JA_PERMUTADO);
        // O motivo NÃO é removido — vira motivo informativo do estado novo.
        expect(result.motivoBloqueio).toBe(MOTIVO_BLOQUEIO.JA_PERMUTADO);
        const gate2 = result.gatesAvaliados.find((g) => g.gate === GATE.VALOR_PERMUTAR);
        expect(gate2?.passed).toBe(false);
    });

    it('T6 só dispara em adto PAGO: nao-pago (gate 3) vence, segue BLOQUEADA', () => {
        const result = service.avaliarElegibilidade({
            adiantamento: buildAdiantamento({
                pago: false,
                valorPermutar: 0,
                valorPermutado: 500,
            }),
            declaracoes: [di],
            invoices: [buildInvoice()],
        });
        // Prioridade de causa-raiz preservada: gate 3 antes do gate 2.
        expect(result.estadoElegibilidade).toBe(ESTADO_ELEGIBILIDADE.BLOQUEADA);
        expect(result.motivoBloqueio).toBe(MOTIVO_BLOQUEIO.NAO_PAGO);
    });

    it('fronteira: pago, gate 2 reprovado, valorPermutado = 0 → BLOQUEADA(sem-saldo-permutar)', () => {
        const result = service.avaliarElegibilidade({
            adiantamento: buildAdiantamento({ valorPermutar: 0, valorPermutado: 0 }),
            declaracoes: [di],
            invoices: [buildInvoice()],
        });
        expect(result.estadoElegibilidade).toBe(ESTADO_ELEGIBILIDADE.BLOQUEADA);
        expect(result.motivoBloqueio).toBe(MOTIVO_BLOQUEIO.SEM_SALDO_PERMUTAR);
    });

    it('fronteira: pago, gate 2 reprovado, valorPermutado ausente → BLOQUEADA(sem-saldo-permutar)', () => {
        const result = service.avaliarElegibilidade({
            adiantamento: buildAdiantamento({ valorPermutar: 0 }),
            declaracoes: [di],
            invoices: [buildInvoice()],
        });
        expect(result.estadoElegibilidade).toBe(ESTADO_ELEGIBILIDADE.BLOQUEADA);
        expect(result.motivoBloqueio).toBe(MOTIVO_BLOQUEIO.SEM_SALDO_PERMUTAR);
    });

    it('not fully paid → BLOQUEADA(nao-pago) (Gate 3, raiz antes do Gate 2)', () => {
        const result = service.avaliarElegibilidade({
            // não pago zera o saldo (gate 2 também falha) → mostra a causa-raiz.
            adiantamento: buildAdiantamento({ pago: false, valorPermutar: 0 }),
            declaracoes: [di],
            invoices: [buildInvoice()],
        });
        expect(result.estadoElegibilidade).toBe(ESTADO_ELEGIBILIDADE.BLOQUEADA);
        expect(result.motivoBloqueio).toBe(MOTIVO_BLOQUEIO.NAO_PAGO);
        const gate3 = result.gatesAvaliados.find((g) => g.gate === GATE.TOTALMENTE_PAGO);
        expect(gate3?.passed).toBe(false);
    });
});

describe('ElegibilidadeService — Gate 4 D.I XOR DUIMP (I2)', () => {
    const service = new ElegibilidadeService(new CasamentoInvoiceService());

    it('only D.I → Gate 4 passes (valid)', () => {
        const result = service.avaliarElegibilidade({
            adiantamento: buildAdiantamento(),
            declaracoes: [di],
            invoices: [buildInvoice()],
        });
        const gate4 = result.gatesAvaliados.find((g) => g.gate === GATE.DI_XOR_DUIMP);
        expect(gate4?.passed).toBe(true);
        expect(result.estadoElegibilidade).toBe(ESTADO_ELEGIBILIDADE.ELEGIVEL);
    });

    it('only DUIMP → Gate 4 passes (valid)', () => {
        const result = service.avaliarElegibilidade({
            adiantamento: buildAdiantamento(),
            declaracoes: [duimp],
            invoices: [buildInvoice()],
        });
        const gate4 = result.gatesAvaliados.find((g) => g.gate === GATE.DI_XOR_DUIMP);
        expect(gate4?.passed).toBe(true);
        expect(result.declaracaoImportacao?.variante).toBe('DUIMP');
        expect(result.estadoElegibilidade).toBe(ESTADO_ELEGIBILIDADE.ELEGIVEL);
    });

    it('both D.I and DUIMP → BLOQUEADA(di-duimp-ambos) (XOR anomaly)', () => {
        const result = service.avaliarElegibilidade({
            adiantamento: buildAdiantamento(),
            declaracoes: [di, duimp],
            invoices: [buildInvoice()],
        });
        expect(result.estadoElegibilidade).toBe(ESTADO_ELEGIBILIDADE.BLOQUEADA);
        expect(result.motivoBloqueio).toBe(MOTIVO_BLOQUEIO.DI_DUIMP_AMBOS);
    });

    it('neither D.I nor DUIMP → BLOQUEADA(data-base-indisponivel)', () => {
        const result = service.avaliarElegibilidade({
            adiantamento: buildAdiantamento(),
            declaracoes: [],
            invoices: [buildInvoice()],
        });
        expect(result.estadoElegibilidade).toBe(ESTADO_ELEGIBILIDADE.BLOQUEADA);
        expect(result.motivoBloqueio).toBe(MOTIVO_BLOQUEIO.DATA_BASE_INDISPONIVEL);
    });
});
