import 'reflect-metadata';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import ConexosError from '../errors/ConexosError.js';
import ConexosWriteDisabledError from '../errors/ConexosWriteDisabledError.js';
import type EnvironmentProvider from '../libs/environment/EnvironmentProvider.js';
import ConexosBaixaClient, { IDENTIDADE_BORDERO } from './ConexosBaixaClient.js';
import type ConexosBaseClient from './ConexosBaseClient.js';

/**
 * `ConexosBaixaClient` — borderô do boleto agrupado (ADR-0077, Task 7). Fixtures com a forma dos
 * payloads medidos em HML em 2026-10-20/21 (`sispag-boleto-agrupado-hml-achados.md`, T1–T8):
 * borderô 253 (`POST fin010`), baixa 566/1 (`POST fin010/baixas`), cabeçalho do 252 (40 chaves).
 */

const buildBase = () => ({
    ensureSid: jest.fn().mockResolvedValue(undefined),
    postGeneric: jest.fn().mockResolvedValue({}),
    postGenericOnce: jest.fn().mockResolvedValue({}),
    getGeneric: jest.fn(),
    deleteGeneric: jest.fn().mockResolvedValue(undefined),
    listGenericPaginated: jest.fn().mockResolvedValue({ count: 0, rows: [] }),
    runWithRetry: jest.fn(<T>(fn: () => Promise<T>) => fn()),
});

const env = (over: Record<string, unknown> = {}) =>
    ({
        getEnvironmentVars: jest.fn(async () => ({ conexosWriteEnabled: true, ...over })),
    }) as unknown as EnvironmentProvider;

const make = (base = buildBase(), ...e: [EnvironmentProvider?]) => ({
    base,
    client: new ConexosBaixaClient(
        base as unknown as ConexosBaseClient,
        e.length > 0 ? e[0] : env(),
    ),
});

const DEBITO = 1792627200000; // 22/10/2026 00:00Z
const T_253 = 1792523939000; // borTimCad do borderô 253 (GB-TDD-1020-A)

/** Resposta real do `POST fin010` (HML, borderô 253), sem o marcador que não escrevemos mais. */
const BORDERO_253 = {
    filCod: 2,
    borVldTipo: 2,
    borCod: 253,
    borDtaMvto: DEBITO,
    gerNum: 38,
    borEspNrbanco: null,
    borCodCheque: null,
    usnCodCad: 97,
    borTimCad: T_253,
    gerDes: 'BANCO ITAÚ - AG. 0641 CONTA 55.795-4',
    borVldFinalizado: 0,
    usnDesNomeCad: 'MPS_FRANCINEI',
    vldHasBaixa: 0,
    vldHasRemessaPgto: 0,
    vlrTotalLiquido: null,
};

/** `responseData` da `validacao/tituloBaixa` do 566/1 (campos que o ERP devolve). */
const VALIDACAO_566 = {
    bxaMnyValor: 341,
    bxaCodGerJuros: null,
    bxaCodGerDesconto: null,
    bxaCodGerMulta: null,
    docEspNumero: '966484',
};

/** Resposta real do `POST fin010/baixas` (HML, 566/1 no borderô 253). */
const BAIXA_566 = {
    filCod: 2,
    borVldTipo: 2,
    borCod: 253,
    gerNum: 38,
    bxaCodSeq: 1,
    usnCod: 97,
    bxaMnyValor: 341,
    bxaMnyJuros: 0,
    bxaMnyMulta: 0,
    bxaMnyDesconto: 0,
    bxaMnyLiquido: 341,
    docTip: 2,
    docCod: 566,
    titCod: 1,
    bxaVldCcorrente: 0,
    bxaVldCorrenteDc: 1,
};

/** Linha do `fin010/list` / `GET fin010/2/252` (cabeçalho com 40 chaves, recortado). */
const CABECALHO_252 = {
    filCod: 2,
    borVldTipo: 2,
    borCod: 252,
    borDtaMvto: 1792454400000,
    gerNum: 38,
    borEspNrbanco: null,
    usnCodCad: 97,
    borTimCad: 1792431474000,
    borVldFinalizado: 1,
    borCodEstornado: null,
    borDtaFinalizado: 1792431647000,
    usnDesNomeCad: 'MPS_FRANCINEI',
    usnDesNomeFin: 'MPS_FRANCINEI',
    vldHasBaixa: 1,
    vldHasRemessaPgto: 1,
    vlrTotalLiquido: 2346.94,
};

const recusa = (key: string) =>
    Object.assign(new Error('Request failed with status code 400'), {
        response: { status: 400, data: { type: 'VALIDATION', messages: [{ message: key }] } },
    });

describe('ConexosBaixaClient — Permutas inalterado', () => {
    it('criarBordero sem gerNum envia EXATAMENTE o corpo de Permutas (snapshot)', async () => {
        const { base, client } = make();
        base.postGeneric.mockResolvedValue({ borCod: 9, filCod: 2, borVldTipo: 2, borDtaMvto: 1 });
        await client.criarBordero({ filCod: 2, dataMovto: DEBITO });
        expect(base.postGeneric).toHaveBeenCalledWith(
            'fin010',
            {
                filCod: 2,
                borVldTipo: 2,
                borVldFinalizado: 0,
                frontModelName: 'bordero',
                borDtaMvto: DEBITO,
            },
            { filCod: 2 },
        );
        expect(base.postGenericOnce).not.toHaveBeenCalled();
    });

    it('criarBordero com gerNum acrescenta só o gerNum', async () => {
        const { base, client } = make();
        base.postGeneric.mockResolvedValue({ borCod: 9 });
        await client.criarBordero({ filCod: 2, dataMovto: DEBITO, gerNum: 38 });
        expect(base.postGeneric.mock.calls[0][1]).toEqual({
            filCod: 2,
            borVldTipo: 2,
            borVldFinalizado: 0,
            frontModelName: 'bordero',
            borDtaMvto: DEBITO,
            gerNum: 38,
        });
    });

    it('listBorderos mantém o filtro de Permutas e passa a devolver borTimCad/usnCodCad/flag', async () => {
        const { base, client } = make();
        base.listGenericPaginated.mockResolvedValue({ count: 1, rows: [CABECALHO_252] });
        const [b] = await client.listBorderos({ filCod: 2 });
        const body = base.listGenericPaginated.mock.calls[0][1];
        expect(body.filterList).toEqual({ 'borVldTipo#EQ': 2 });
        expect(body.fieldList).toEqual(
            expect.arrayContaining(['borCod', 'vlrTotalLiquido', 'usnDesNomeCad']),
        );
        expect(b).toMatchObject({
            borCod: 252,
            vlrTotalLiquido: 2346.94,
            borTimCad: 1792431474000,
            usnCodCad: 97,
            vldHasRemessaPgto: 1,
        });
    });

    it('getBordero devolve vldHasRemessaPgto (informativo), vlrTotalLiquido, borTimCad e usnCodCad', async () => {
        const { base, client } = make();
        base.getGeneric.mockResolvedValue(CABECALHO_252);
        const b = await client.getBordero({ filCod: 2, borCod: 252 });
        expect(b).toMatchObject({
            borCod: 252,
            borVldFinalizado: 1,
            vldHasRemessaPgto: 1,
            vlrTotalLiquido: 2346.94,
            borTimCad: 1792431474000,
            usnCodCad: 97,
        });
    });
});

describe('ConexosBaixaClient — borderô do grupo (ADR-0077)', () => {
    describe('criarBorderoDoGrupo', () => {
        it('POST fin010 tentativa única, com gerNum e SEM borEspNrbanco; devolve a identidade', async () => {
            const { base, client } = make();
            base.postGenericOnce.mockResolvedValue(BORDERO_253);
            const r = await client.criarBorderoDoGrupo({
                filCod: 2,
                dataMovto: DEBITO,
                gerNum: 38,
            });
            expect(base.postGenericOnce).toHaveBeenCalledWith(
                'fin010',
                {
                    filCod: 2,
                    borVldTipo: 2,
                    borVldFinalizado: 0,
                    frontModelName: 'bordero',
                    borDtaMvto: DEBITO,
                    gerNum: 38,
                },
                { filCod: 2 },
            );
            expect(base.postGeneric).not.toHaveBeenCalled();
            expect(base.runWithRetry).not.toHaveBeenCalled();
            expect(r).toEqual({
                filCod: 2,
                borCod: 253,
                borTimCad: T_253,
                usnCodCad: 97,
                borDtaMvto: DEBITO,
            });
        });

        it('resposta sem borTimCad ⇒ ConexosError transitório (a retomada busca pela janela)', async () => {
            const { base, client } = make();
            const { borTimCad: _t, ...semCarimbo } = BORDERO_253;
            base.postGenericOnce.mockResolvedValue(semCarimbo);
            const e = await client
                .criarBorderoDoGrupo({ filCod: 2, dataMovto: DEBITO, gerNum: 38 })
                .catch((x) => x);
            expect(e).toBeInstanceOf(ConexosError);
            expect(ConexosBaixaClient.classificarFalha(e).tipo).toBe('TRANSITORIA');
        });

        it('gerNum inválido ⇒ recusa ANTES do POST', async () => {
            const { base, client } = make();
            await expect(
                client.criarBorderoDoGrupo({ filCod: 2, dataMovto: DEBITO, gerNum: 0 }),
            ).rejects.toThrow(/gerNum/);
            expect(base.postGenericOnce).not.toHaveBeenCalled();
        });

        it('escrita desligada (ou sem EnvironmentProvider) ⇒ ConexosWriteDisabledError antes de qualquer chamada', async () => {
            for (const e of [env({ conexosWriteEnabled: false }), undefined]) {
                const { base, client } = make(buildBase(), e);
                await expect(
                    client.criarBorderoDoGrupo({ filCod: 2, dataMovto: DEBITO, gerNum: 38 }),
                ).rejects.toBeInstanceOf(ConexosWriteDisabledError);
                expect(base.ensureSid).not.toHaveBeenCalled();
                expect(base.postGenericOnce).not.toHaveBeenCalled();
            }
        });
    });

    describe('gravarBaixaSimples', () => {
        it('corpo igual ao da fase baixaBor do probe (snapshot); tentativa única; bxaCodSeq por Zod', async () => {
            const { base, client } = make();
            base.postGenericOnce.mockResolvedValue(BAIXA_566);
            const r = await client.gravarBaixaSimples({
                filCod: 2,
                borCod: 253,
                gerNum: 38,
                docCod: 566,
                titCod: 1,
                validacao: VALIDACAO_566,
            });
            expect(base.postGenericOnce).toHaveBeenCalledWith(
                'fin010/baixas',
                {
                    ...VALIDACAO_566,
                    filCod: 2,
                    borCod: 253,
                    borVldTipo: 2,
                    docTip: 2,
                    docCod: 566,
                    titCod: 1,
                    gerNum: 38,
                    bxaMnyValor: 341,
                    bxaMnyJuros: 0,
                    bxaMnyMulta: 0,
                    bxaMnyDesconto: 0,
                    bxaMnyLiquido: 341,
                    bxaVldSistema: 0,
                    bxaVldCcorrente: 0,
                    bxaVldCorrenteDc: 1,
                    bxaVldAdto: 0,
                    frontModelName: 'baixa',
                },
                { filCod: 2 },
            );
            expect(r.bxaCodSeq).toBe(1);
            expect(r.bxaMnyLiquido).toBe(341);
        });

        it('validação sem valor ⇒ recusa ANTES do POST', async () => {
            const { base, client } = make();
            await expect(
                client.gravarBaixaSimples({
                    filCod: 2,
                    borCod: 253,
                    gerNum: 38,
                    docCod: 566,
                    titCod: 1,
                    validacao: { bxaMnyValor: 0 },
                }),
            ).rejects.toThrow(/bxaMnyValor/);
            expect(base.postGenericOnce).not.toHaveBeenCalled();
        });

        it('resposta sem bxaCodSeq ⇒ ConexosError (nunca baixa fantasma)', async () => {
            const { base, client } = make();
            base.postGenericOnce.mockResolvedValue({ ...BAIXA_566, bxaCodSeq: null });
            await expect(
                client.gravarBaixaSimples({
                    filCod: 2,
                    borCod: 253,
                    gerNum: 38,
                    docCod: 566,
                    titCod: 1,
                    validacao: VALIDACAO_566,
                }),
            ).rejects.toBeInstanceOf(ConexosError);
        });

        it('escrita desligada ⇒ ConexosWriteDisabledError antes de qualquer chamada', async () => {
            const { base, client } = make(buildBase(), env({ conexosWriteEnabled: false }));
            await expect(
                client.gravarBaixaSimples({
                    filCod: 2,
                    borCod: 253,
                    gerNum: 38,
                    docCod: 566,
                    titCod: 1,
                    validacao: VALIDACAO_566,
                }),
            ).rejects.toBeInstanceOf(ConexosWriteDisabledError);
            expect(base.postGenericOnce).not.toHaveBeenCalled();
        });
    });

    describe('buscarBorderosNaJanela (resposta perdida, I21s)', () => {
        const janela = {
            filCod: 2,
            usnCodCad: 97,
            gerNum: 38,
            borDtaMvto: DEBITO,
            t0: T_253 - 1000,
            t1: T_253 + 2000,
            agora: T_253 + 600_000,
            margemMs: 120_000,
        };

        it('filtra tipo 2, em cadastro, usuário, conta, data e borTimCad #GE/#LE em epoch ms', async () => {
            const { base, client } = make();
            base.listGenericPaginated.mockResolvedValue({ count: 1, rows: [BORDERO_253] });
            const r = await client.buscarBorderosNaJanela(janela);
            const [endpoint, body, opts] = base.listGenericPaginated.mock.calls[0];
            expect(endpoint).toBe('fin010/list');
            expect(opts).toEqual({ filCod: 2 });
            expect(body.filterList).toEqual({
                'borVldTipo#EQ': 2,
                'borVldFinalizado#EQ': 0,
                'usnCodCad#EQ': 97,
                'gerNum#EQ': 38,
                'borDtaMvto#EQ': DEBITO,
                'borTimCad#GE': T_253 - 1000 - 120_000,
                'borTimCad#LE': T_253 + 2000 + 120_000,
            });
            expect(typeof body.filterList['borTimCad#GE']).toBe('number');
            expect(base.runWithRetry).toHaveBeenCalled();
            expect(r).toEqual([
                expect.objectContaining({ filCod: 2, borCod: 253, borTimCad: T_253 }),
            ]);
        });

        it('sem t1 (processo morreu antes de gravá-lo) ⇒ limite superior = agora + margem', async () => {
            const { base, client } = make();
            const { t1: _t1, ...semT1 } = janela;
            await client.buscarBorderosNaJanela(semT1);
            const body = base.listGenericPaginated.mock.calls[0][1];
            expect(body.filterList['borTimCad#LE']).toBe(T_253 + 600_000 + 120_000);
        });

        it('devolve TODOS (o chamador decide); zero linhas ⇒ lista vazia', async () => {
            const { base, client } = make();
            base.listGenericPaginated.mockResolvedValue({
                count: 2,
                rows: [BORDERO_253, { ...BORDERO_253, borCod: 254, borTimCad: T_253 + 27_000 }],
            });
            expect(await client.buscarBorderosNaJanela(janela)).toHaveLength(2);
            base.listGenericPaginated.mockResolvedValue({ count: 0, rows: [] });
            expect(await client.buscarBorderosNaJanela(janela)).toEqual([]);
        });

        it('linha sem borTimCad ⇒ erro (leitura que não identifica não vira "zero ⇒ cria")', async () => {
            const { base, client } = make();
            base.listGenericPaginated.mockResolvedValue({
                count: 1,
                rows: [{ ...BORDERO_253, borTimCad: null }],
            });
            await expect(client.buscarBorderosNaJanela(janela)).rejects.toBeInstanceOf(
                ConexosError,
            );
        });

        it('mais linhas do que a página ⇒ erro (nunca conclui com a lista truncada)', async () => {
            const { base, client } = make();
            base.listGenericPaginated.mockResolvedValue({ count: 300, rows: [BORDERO_253] });
            await expect(client.buscarBorderosNaJanela(janela)).rejects.toBeInstanceOf(
                ConexosError,
            );
        });

        it('janela invertida ⇒ recusa antes de ler', async () => {
            const { base, client } = make();
            await expect(
                client.buscarBorderosNaJanela({ ...janela, t1: janela.t0 - 10_000_000 }),
            ).rejects.toThrow(/janela/);
            expect(base.listGenericPaginated).not.toHaveBeenCalled();
        });
    });

    describe('buscarBorderoPorIdentidade (ausência por list, nunca GET)', () => {
        const id = { filCod: 2, borCod: 253, borTimCad: T_253 };

        it('mesmo borCod e mesmo borTimCad ⇒ PRESENTE', async () => {
            const { base, client } = make();
            base.listGenericPaginated.mockResolvedValue({ count: 1, rows: [BORDERO_253] });
            const r = await client.buscarBorderoPorIdentidade(id);
            expect(r.situacao).toBe(IDENTIDADE_BORDERO.PRESENTE);
            expect(r.bordero).toMatchObject({ borCod: 253, borTimCad: T_253 });
            const body = base.listGenericPaginated.mock.calls[0][1];
            expect(body.filterList).toEqual({ 'borVldTipo#EQ': 2, 'borCod#EQ': 253 });
            expect(base.getGeneric).not.toHaveBeenCalled();
        });

        it('zero linhas ⇒ AUSENTE', async () => {
            const { client } = make();
            expect((await client.buscarBorderoPorIdentidade(id)).situacao).toBe(
                IDENTIDADE_BORDERO.AUSENTE,
            );
        });

        it('borCod reusado pelo ERP com outro borTimCad ⇒ ALHEIO (o chamador decide)', async () => {
            const { base, client } = make();
            base.listGenericPaginated.mockResolvedValue({
                count: 1,
                rows: [{ ...BORDERO_253, borTimCad: 1792524109000 }],
            });
            const r = await client.buscarBorderoPorIdentidade(id);
            expect(r.situacao).toBe(IDENTIDADE_BORDERO.ALHEIO);
            expect(r.bordero?.borTimCad).toBe(1792524109000);
        });

        it('falha de leitura sobe (nunca vira AUSENTE)', async () => {
            const { base, client } = make();
            base.listGenericPaginated.mockRejectedValue(
                Object.assign(new Error('500'), { response: { status: 500 } }),
            );
            await expect(client.buscarBorderoPorIdentidade(id)).rejects.toBeInstanceOf(
                ConexosError,
            );
        });
    });

    describe('classificarFalha', () => {
        it('4xx de negócio ⇒ DETERMINISTICA com a key do ERP; 5xx/timeout ⇒ TRANSITORIA', () => {
            const det = new ConexosError({
                endpoint: 'fin010/253',
                cause: recusa('FIN_014.FIN_HAS_REMESSA_PGTO'),
            });
            expect(ConexosBaixaClient.classificarFalha(det)).toEqual({
                tipo: 'DETERMINISTICA',
                codigoErp: 'FIN_014.FIN_HAS_REMESSA_PGTO',
            });
            const rnf = new ConexosError({
                endpoint: 'fin010/2/253',
                cause: Object.assign(new Error('500'), {
                    response: { status: 500, data: { type: 'RECORDNOTFOUND' } },
                }),
            });
            expect(ConexosBaixaClient.classificarFalha(rnf).tipo).toBe('TRANSITORIA');
            const to = new ConexosError({ endpoint: 'fin010', code: 'CONEXOS_UPSTREAM_TIMEOUT' });
            expect(ConexosBaixaClient.classificarFalha(to).tipo).toBe('TRANSITORIA');
            expect(ConexosBaixaClient.classificarFalha(new Error('x')).tipo).toBe('TRANSITORIA');
        });
    });
});

describe('I21m — nunca finalizamos, cancelamos nem usamos o fin146 no caminho do grupo', () => {
    const RAIZ = path.resolve(__dirname, '..', '..');
    const varrer = (dir: string): string[] =>
        readdirSync(dir).flatMap((nome) => {
            const p = path.join(dir, nome);
            if (statSync(p).isDirectory()) return nome === 'node_modules' ? [] : varrer(p);
            return p.endsWith('.ts') && !p.endsWith('.test.ts') ? [p] : [];
        });

    it('finalizarBordero/cancelarBordero/fin146 só em Permutas, recebimentos, fin014 e no próprio client', () => {
        const permitidos = [
            'domain/client/ConexosBaixaClient.ts',
            'domain/client/ConexosFin014Client.ts',
            'domain/service/permutas/',
            'domain/service/recebimentos/',
            'routes/permutas.ts',
            // Sondas HML só de medição (nunca o caminho de produção).
            'jobs/probe-',
        ];
        const ofensores = [
            ...varrer(path.join(RAIZ, 'domain')),
            ...varrer(path.join(RAIZ, 'routes')),
            ...varrer(path.join(RAIZ, 'jobs')),
        ]
            .map((p) => path.relative(RAIZ, p).split(path.sep).join('/'))
            .filter((rel) => !permitidos.some((ok) => rel.startsWith(ok)))
            .filter((rel) =>
                /\bfinalizarBordero\b|\bcancelarBordero\b|\bfin146\b/.test(
                    readFileSync(path.join(RAIZ, rel), 'utf8'),
                ),
            );
        expect(ofensores).toEqual([]);
    });
});
