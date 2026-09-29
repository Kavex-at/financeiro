import 'reflect-metadata';
import ConexosError from '../errors/ConexosError.js';
import type ConexosBaseClient from './ConexosBaseClient.js';
import ConexosTitulosClient from './ConexosTitulosClient.js';

/**
 * `lerBaixasTitulo` — baixas do título (PSQ_018, `com308/financeiroAPagar/baixas/list`) para o
 * ENRIQUECIMENTO da sincronização do lote SISPAG (ADR-0055). Nunca decide status; falha é
 * "ausente", não "sem baixa" (I11c).
 */

/** Mesmo comportamento do `ConexosBaseClient.parseDate` real (número → meio-dia BRT). */
const parseDate = (raw: unknown): Date =>
    typeof raw === 'number' ? new Date(raw + 15 * 60 * 60 * 1000) : new Date(String(raw));

const buildBase = () => ({
    paginate: jest.fn(),
    parseDate: jest.fn(parseDate),
    postGeneric: jest.fn(),
    postGenericOnce: jest.fn(),
    putGenericOnce: jest.fn(),
    deleteGeneric: jest.fn(),
});
const make = (base: ReturnType<typeof buildBase>) =>
    new ConexosTitulosClient(base as unknown as ConexosBaseClient);

const httpError = (status: number) => ({ response: { status, data: { message: 'x' } } });
const embrulhado = (status: number) =>
    new ConexosError({ endpoint: 'com308/financeiroAPagar/baixas/list', cause: httpError(status) });

describe('ConexosTitulosClient.lerBaixasTitulo (PSQ_018, ADR-0055)', () => {
    it('mapeia borCod, bxaCodSeq, data, usuário e valor via Zod', async () => {
        const base = buildBase();
        base.paginate.mockResolvedValue([
            {
                borCod: 22320,
                bxaCodSeq: '1',
                borDtaMvto: '2026-09-24T00:00:00.000Z',
                usnDesNomeFin: 'ERICA_VIANA',
                bxaMnyLiquido: 275,
                bxaMnyValor: 275,
            },
        ]);
        const r = await make(base).lerBaixasTitulo({ docCod: '38682', titCod: '1', filCod: 2 });
        expect(r).toEqual({
            legivel: true,
            baixas: [
                {
                    borCod: 22320,
                    bxaCodSeq: 1,
                    data: '2026-09-24T00:00:00.000Z',
                    usuario: 'ERICA_VIANA',
                    valor: 275,
                },
            ],
        });
        const { endpoint, bodyBase, opts } = base.paginate.mock.calls[0][0];
        expect(endpoint).toBe('com308/financeiroAPagar/baixas/list/38682/1/0');
        expect(bodyBase.filterList).toEqual({ 'borVldFinalizado#IN': [1] });
        expect(opts).toEqual({ filCod: 2 });
    });

    it('campos nulos não quebram (nullable-safe); linha sem borCod é descartada', async () => {
        const base = buildBase();
        base.paginate.mockResolvedValue([
            { borCod: 22320, bxaCodSeq: null, borDtaMvto: null, usnDesNomeFin: null },
            { borCod: null, bxaCodSeq: 9 },
        ]);
        const r = await make(base).lerBaixasTitulo({ docCod: '38682', titCod: '1', filCod: 2 });
        expect(r).toEqual({ legivel: true, baixas: [{ borCod: 22320 }] });
    });

    it('data numérica (epoch do ERP) sai em ISO no dia civil certo', async () => {
        const base = buildBase();
        // 2026-09-24 00:00 UTC — o ERP manda "meia-noite UTC do dia civil no BR".
        base.paginate.mockResolvedValue([{ borCod: 1, borDtaMvto: 1_790_208_000_000 }]);
        const r = await make(base).lerBaixasTitulo({ docCod: '1', titCod: '1', filCod: 2 });
        expect(r.legivel && r.baixas[0]?.data?.slice(0, 10)).toBe('2026-09-24');
    });

    it('403 (permissão do robô) → ausente com status, sem lançar', async () => {
        const base = buildBase();
        base.paginate.mockRejectedValue(embrulhado(403));
        const r = await make(base).lerBaixasTitulo({ docCod: '38682', titCod: '1', filCod: 2 });
        expect(r).toEqual({ legivel: false, motivo: expect.any(String), status: 403 });
    });

    it.each([
        ['5xx', embrulhado(502)],
        ['rede', new Error('ECONNRESET')],
    ])('%s → também ausente, sem derrubar a sincronização', async (_n, erro) => {
        const base = buildBase();
        base.paginate.mockRejectedValue(erro);
        const r = await make(base).lerBaixasTitulo({ docCod: '1', titCod: '1', filCod: 2 });
        expect(r.legivel).toBe(false);
    });

    it('nenhum caminho de escrita no ERP é tocado', async () => {
        const base = buildBase();
        base.paginate.mockResolvedValue([]);
        await make(base).lerBaixasTitulo({ docCod: '1', titCod: '1', filCod: 2 });
        expect(base.postGeneric).not.toHaveBeenCalled();
        expect(base.postGenericOnce).not.toHaveBeenCalled();
        expect(base.putGenericOnce).not.toHaveBeenCalled();
        expect(base.deleteGeneric).not.toHaveBeenCalled();
    });
});
