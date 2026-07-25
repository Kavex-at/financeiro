import { creditoClienteSchema } from './CreditoCliente.js';
import { documentoAReceberSchema } from './DocumentoAReceber.js';
import { notaDebitoEletronicaSchema } from './NotaDebitoEletronica.js';
import { rateioRecebimentoSchema } from './RateioRecebimento.js';
import { recebimentoSchema } from './Recebimento.js';
import { regraRecebimentoSchema } from './RegraRecebimento.js';
import { transacaoBancariaSchema } from './TransacaoBancaria.js';
import { NDE_STATUS_EMISSAO, CREDITO_CLIENTE_STATUS, REGRA_TIPO } from './constants.js';
import { documentoAReceberFixture } from './__fixtures__/documentoAReceber.fixture.js';
import {
    rateioRecebimentoFixture,
    recebimentoFixture,
} from './__fixtures__/recebimento.fixture.js';
import { transacaoBancariaFixture } from './__fixtures__/transacaoBancaria.fixture.js';

describe('Frente IV Zod schemas — the fixtures parse', () => {
    it('transacaoBancariaSchema validates the fixture', () => {
        expect(transacaoBancariaSchema.parse(transacaoBancariaFixture)).toBeTruthy();
    });

    it('documentoAReceberSchema validates the fixture', () => {
        expect(documentoAReceberSchema.parse(documentoAReceberFixture)).toBeTruthy();
    });

    it('rateioRecebimentoSchema validates the fixture', () => {
        expect(rateioRecebimentoSchema.parse(rateioRecebimentoFixture)).toBeTruthy();
    });

    it('recebimentoSchema validates the aggregate fixture', () => {
        expect(recebimentoSchema.parse(recebimentoFixture)).toBeTruthy();
    });

    it('creditoClienteSchema validates a sample', () => {
        const parsed = creditoClienteSchema.parse({
            id: 'cc-1',
            filCod: 4,
            valorOriginal: 5000,
            valorDisponivel: 5000,
            moeda: 'BRL',
            status: CREDITO_CLIENTE_STATUS.DISPONIVEL,
            criadoEm: new Date(),
        });
        expect(parsed.status).toBe(CREDITO_CLIENTE_STATUS.DISPONIVEL);
    });

    it('regraRecebimentoSchema validates a sample', () => {
        const parsed = regraRecebimentoSchema.parse({
            id: 'regra-1',
            tipo: REGRA_TIPO.ENCOMENDA,
            versao: 1,
            vigenteDe: new Date(),
            parametros: { percentual: 0.001 },
            explicacao: 'encomenda 0,1%',
            ativo: true,
        });
        expect(parsed.tipo).toBe(REGRA_TIPO.ENCOMENDA);
    });

    it('notaDebitoEletronicaSchema validates a sample', () => {
        const parsed = notaDebitoEletronicaSchema.parse({
            id: 'nde-1',
            recebimentoId: 'rec-0001',
            filCod: 4,
            correlationId: 'corr-0001',
            valor: 15000,
            moeda: 'BRL',
            statusEmissao: NDE_STATUS_EMISSAO.PENDENTE,
            idempotencyKey: 'nde:rec-0001',
        });
        expect(parsed.statusEmissao).toBe(NDE_STATUS_EMISSAO.PENDENTE);
    });
});

describe('Frente IV Zod schemas — malformed inputs are rejected', () => {
    it('rejects filCod: null (multi-filial invariant)', () => {
        const result = transacaoBancariaSchema.safeParse({
            ...transacaoBancariaFixture,
            filCod: null,
        });
        expect(result.success).toBe(false);
    });

    it('rejects a bad status enum', () => {
        const result = recebimentoSchema.safeParse({ ...recebimentoFixture, status: 'invalido' });
        expect(result.success).toBe(false);
    });

    it('rejects a non-positive filCod on the recebível read-model', () => {
        const result = documentoAReceberSchema.safeParse({
            ...documentoAReceberFixture,
            filCod: 0,
        });
        expect(result.success).toBe(false);
    });
});
