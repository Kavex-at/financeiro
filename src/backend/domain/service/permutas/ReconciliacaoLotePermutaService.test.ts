import 'reflect-metadata';
import type { GestaoPermutasResponse } from '../../interface/permutas/Gestao.js';
import type GestaoPermutasService from './GestaoPermutasService.js';
import type ReconciliacaoPermutaService from './ReconciliacaoPermutaService.js';
import type { ReconciliarResult } from './ReconciliacaoPermutaService.js';
import type LogService from '../LogService.js';
import ReconciliacaoLotePermutaService, { LOTE_MAX } from './ReconciliacaoLotePermutaService.js';

const buildLog = () => ({ info: jest.fn().mockResolvedValue(undefined) }) as unknown as LogService;

/** Esqueleto de gestão só com os campos que o lote consome (casamentos). */
const gestaoComCasamentos = (
    casamentos: GestaoPermutasResponse['casamentos'],
): GestaoPermutasResponse => ({
    fonte: 'banco',
    pendentes: [],
    invoicesEmAberto: [],
    casamentos,
    totais: {
        pendentes: 0,
        invoicesEmAberto: 0,
        elegiveis: 0,
        bloqueadas: 0,
        casamentoManual: 0,
        permutaManual: 0,
        jaPermutado: 0,
    },
});

const invoiceStub = (docCod: string): GestaoPermutasResponse['invoicesEmAberto'][number] => ({
    docCod,
    filCod: 2,
    referencia: docCod,
    exportador: 'X',
    valorMoedaNegociada: 0,
    valorBrl: null,
    moeda: 'USD',
});

/** Casamentos da imagem: 491→9026, 256→11821, 255→[19019, 20149(processado)] + dup de 9026. */
const casamentos: GestaoPermutasResponse['casamentos'] = [
    {
        priCod: '491',
        invoice: invoiceStub('I491'),
        adiantamentos: [
            { docCod: '9026', referencia: 'CT/9026', valorASerUsado: 1100, moeda: 'USD' },
        ],
    },
    {
        priCod: '256',
        invoice: invoiceStub('I256'),
        adiantamentos: [
            { docCod: '11821', referencia: 'CT/11821', valorASerUsado: 29867, moeda: 'USD' },
        ],
    },
    {
        priCod: '255',
        invoice: invoiceStub('I255'),
        adiantamentos: [
            { docCod: '19019', referencia: 'CT/19019', valorASerUsado: 16512, moeda: 'USD' },
            // Já processado → deve ser ignorado pelo lote.
            {
                docCod: '20149',
                referencia: 'CT/20149',
                valorASerUsado: 5502,
                moeda: 'USD',
                processamentoStatus: 'processado',
            },
        ],
    },
    {
        // Mesmo adto 9026 reaparece em outro casamento → dedup (1 adto = 1 borderô).
        priCod: '491b',
        invoice: invoiceStub('I491b'),
        adiantamentos: [
            { docCod: '9026', referencia: 'CT/9026', valorASerUsado: 1100, moeda: 'USD' },
        ],
    },
];

const resultSettled = (docCod: string, borCod: number): ReconciliarResult => ({
    adiantamentoDocCod: docCod,
    dryRun: false,
    writeEnabled: true,
    borCod,
    resultados: [{ invoiceDocCod: `I${docCod}`, status: 'settled', dryRun: false, borCod }],
});

const buildService = (
    reconciliarImpl: (docCod: string) => Promise<ReconciliarResult>,
    gestao: GestaoPermutasResponse = gestaoComCasamentos(casamentos),
) => {
    const exporGestao = jest.fn().mockResolvedValue(gestao);
    const reconciliar = jest.fn((input: { adiantamentoDocCod: string }) =>
        reconciliarImpl(input.adiantamentoDocCod),
    );
    const service = new ReconciliacaoLotePermutaService(
        { exporGestao } as unknown as GestaoPermutasService,
        { reconciliar } as unknown as ReconciliacaoPermutaService,
        buildLog(),
    );
    return { service, exporGestao, reconciliar };
};

describe('ReconciliacaoLotePermutaService.reconciliarLote', () => {
    /**
     * C-5 / ADR-0044 — um par `parcial` de EXECUÇÃO não é sucesso nem erro: o dinheiro se moveu,
     * mas sobrou resíduo a re-alocar. Somá-lo a `totalSettled` recriaria, um nível acima, o mesmo
     * silêncio que a ADR existe para acabar; contá-lo como erro mandaria a analista procurar uma
     * falha que não houve.
     */
    it('par `parcial` conta em totalParciais — nem settled, nem erro — e o adto vira `com-residuo`', async () => {
        const { service } = buildService(async (docCod) => {
            if (docCod === '9026') {
                return {
                    adiantamentoDocCod: '9026',
                    dryRun: false,
                    writeEnabled: true,
                    borCod: 100,
                    resultados: [
                        {
                            invoiceDocCod: 'I9026',
                            status: 'parcial',
                            dryRun: false,
                            borCod: 100,
                            valorBaixado: 4990,
                            valorResidualUsd: 2,
                        },
                    ],
                } satisfies ReconciliarResult;
            }
            return resultSettled(docCod, 100);
        });

        const out = await service.reconciliarLote({
            executadoPor: 'user-abc',
            dataMovto: 1_700_000_000_000,
            requestId: 'req-parcial',
        });

        expect(out.totalParciais).toBe(1);
        expect(out.totalSettled).toBe(2); // 11821 + 19019 — o 9026 NÃO entra aqui
        expect(out.totalErros).toBe(0);
        const item = out.resultados.find((r) => r.adiantamentoDocCod === '9026');
        expect(item?.status).toBe('com-residuo');
    });

    /**
     * A distinção que C-5 obriga a manter: `'parcial'` do LOTE (erro + sucesso no mesmo adto) e
     * `'com-residuo'` (resíduo de execução, sem erro nenhum) são desfechos diferentes. Se um dia
     * alguém unificar os dois, este teste cai — e é para cair.
     */
    it('erro + parcial no mesmo adto ⇒ `parcial` do LOTE (o erro domina), não `com-residuo`', async () => {
        const { service } = buildService(async (docCod) => {
            if (docCod === '9026') {
                return {
                    adiantamentoDocCod: '9026',
                    dryRun: false,
                    writeEnabled: true,
                    borCod: 100,
                    resultados: [
                        {
                            invoiceDocCod: 'I1',
                            status: 'parcial',
                            dryRun: false,
                            borCod: 100,
                            valorResidualUsd: 2,
                        },
                        {
                            invoiceDocCod: 'I2',
                            status: 'error',
                            dryRun: false,
                            erro: 'ERP recusou',
                        },
                    ],
                } satisfies ReconciliarResult;
            }
            return resultSettled(docCod, 100);
        });

        const out = await service.reconciliarLote({
            executadoPor: 'user-abc',
            dataMovto: 1_700_000_000_000,
            requestId: 'req-misto',
        });

        const item = out.resultados.find((r) => r.adiantamentoDocCod === '9026');
        expect(item?.status).toBe('parcial');
        expect(out.totalParciais).toBe(1);
        expect(out.totalErros).toBe(1);
    });

    it('coleta as automáticas não-processadas (dedup, ignora processado) e agrega', async () => {
        const { service, reconciliar } = buildService(async (docCod) => {
            if (docCod === '11821')
                throw new Error('adiantamento 11821 has no alocacoes to reconcile');
            if (docCod === '19019') {
                return {
                    adiantamentoDocCod: '19019',
                    dryRun: false,
                    writeEnabled: true,
                    borCod: 101,
                    resultados: [
                        { invoiceDocCod: 'I1', status: 'settled', dryRun: false, borCod: 101 },
                        {
                            invoiceDocCod: 'I2',
                            status: 'error',
                            dryRun: false,
                            erro: 'ERP recusou',
                        },
                    ],
                } satisfies ReconciliarResult;
            }
            return resultSettled(docCod, 100);
        });

        const out = await service.reconciliarLote({
            executadoPor: 'user-abc',
            dataMovto: 1_700_000_000_000,
            requestId: 'req-1',
        });

        // 20149 processado é pulado; 9026 dedup → 3 casos: 9026, 11821, 19019.
        expect(reconciliar).toHaveBeenCalledTimes(3);
        expect(out.totalCasos).toBe(3);
        expect(out.totalSettled).toBe(2); // 9026 + 19019
        expect(out.totalErros).toBe(2); // throw de 11821 + erro de 19019
        expect(out.borderos.sort()).toEqual([100, 101]);
        expect(out.dryRun).toBe(false);
        expect(out.writeEnabled).toBe(true);

        const byDoc = Object.fromEntries(out.resultados.map((r) => [r.adiantamentoDocCod, r]));
        expect(byDoc['9026']).toMatchObject({ status: 'settled', borCod: 100, priCod: '491' });
        expect(byDoc['11821']).toMatchObject({
            status: 'error',
            erro: expect.stringContaining('alocacoes'),
        });
        expect(byDoc['19019']).toMatchObject({
            status: 'parcial',
            borCod: 101,
            erro: 'ERP recusou',
        });
    });

    it('um adto que lança NÃO interrompe os demais (continue-on-error)', async () => {
        const chamados: string[] = [];
        const { service } = buildService(async (docCod) => {
            chamados.push(docCod);
            if (docCod === '9026') throw new Error('boom');
            return resultSettled(docCod, 200);
        });
        const out = await service.reconciliarLote({
            executadoPor: 'u',
            dataMovto: 1,
            requestId: 'r',
        });
        // 9026 é o primeiro e falha; 11821 e 19019 ainda rodam.
        expect(chamados).toEqual(['9026', '11821', '19019']);
        expect(out.totalErros).toBeGreaterThanOrEqual(1);
        expect(out.totalSettled).toBe(2);
    });

    it('dry-run propaga (status dry-run, nenhuma baixa contada)', async () => {
        const { service } = buildService(async (docCod) => ({
            adiantamentoDocCod: docCod,
            dryRun: true,
            writeEnabled: false,
            resultados: [{ invoiceDocCod: `I${docCod}`, status: 'dry-run', dryRun: true }],
        }));
        const out = await service.reconciliarLote({
            executadoPor: 'u',
            dataMovto: 1,
            requestId: 'r',
        });
        expect(out.dryRun).toBe(true);
        expect(out.writeEnabled).toBe(false);
        expect(out.totalSettled).toBe(0);
        expect(out.resultados.every((r) => r.status === 'dry-run')).toBe(true);
    });

    it('sem casamentos → lote vazio (0 casos, nenhuma reconciliação)', async () => {
        const { service, reconciliar } = buildService(
            async (docCod) => resultSettled(docCod, 1),
            gestaoComCasamentos([]),
        );
        const out = await service.reconciliarLote({
            executadoPor: 'u',
            dataMovto: 1,
            requestId: 'r',
        });
        expect(reconciliar).not.toHaveBeenCalled();
        expect(out.totalCasos).toBe(0);
        expect(out.resultados).toEqual([]);
        expect(out.borderos).toEqual([]);
    });

    it('adto sem settled e sem erro → skipped (idempotência)', async () => {
        const { service } = buildService(async (docCod) => ({
            adiantamentoDocCod: docCod,
            dryRun: false,
            writeEnabled: true,
            resultados: [{ invoiceDocCod: `I${docCod}`, status: 'skipped', dryRun: false }],
        }));
        const out = await service.reconciliarLote({
            executadoPor: 'u',
            dataMovto: 1,
            requestId: 'r',
        });
        expect(out.totalSettled).toBe(0);
        expect(out.totalErros).toBe(0);
        expect(out.resultados.every((r) => r.status === 'skipped')).toBe(true);
    });

    it(`capa o lote em LOTE_MAX (${LOTE_MAX}) por requisição`, async () => {
        // 12 automáticas (1 adto cada) → só as primeiras LOTE_MAX são reconciliadas.
        const muitos = Array.from({ length: 12 }, (_, i) => ({
            priCod: `p${i}`,
            invoice: invoiceStub(`I${i}`),
            adiantamentos: [
                { docCod: `D${i}`, referencia: `CT/${i}`, valorASerUsado: 100, moeda: 'USD' },
            ],
        }));
        const { service, reconciliar } = buildService(
            async (docCod) => resultSettled(docCod, 1),
            gestaoComCasamentos(muitos),
        );
        const out = await service.reconciliarLote({
            executadoPor: 'u',
            dataMovto: 1,
            requestId: 'r',
        });
        expect(reconciliar).toHaveBeenCalledTimes(LOTE_MAX);
        expect(out.totalCasos).toBe(LOTE_MAX);
        // Roda os primeiros da ordem (D0..D9), não D10/D11.
        expect(out.resultados.map((r) => r.adiantamentoDocCod)).toEqual(
            Array.from({ length: LOTE_MAX }, (_, i) => `D${i}`),
        );
    });

    it('adiantamentoDocCods: executa só o subconjunto, interseccionado com as automáticas', async () => {
        const chamados: string[] = [];
        const { service } = buildService(async (docCod) => {
            chamados.push(docCod);
            return resultSettled(docCod, 1);
        });
        // Pede 19019 + 9026 + um docCod que NÃO é automática (XXX, ignorado).
        const out = await service.reconciliarLote({
            executadoPor: 'u',
            dataMovto: 1,
            requestId: 'r',
            adiantamentoDocCods: ['19019', '9026', 'XXX-nao-automatica'],
        });
        // Só os que são de fato automáticas rodam; XXX é descartado. 11821 não foi pedido.
        expect(chamados.sort()).toEqual(['19019', '9026']);
        expect(out.totalCasos).toBe(2);
    });
});
