import 'reflect-metadata';
import type ConexosBaseClient from './ConexosBaseClient.js';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import Logger from '../libs/logger/Logger.js';
import ConexosSispagClient, { CAMPO_DOCUMENTO_FAVORECIDO } from './ConexosSispagClient.js';

const buildBase = () => ({
    listGenericPaginated: jest.fn(),
    // Espelha o `ConexosBaseClient.runWithRetry` real (executa `fn`); os reads
    // SISPAG passam por ele para paridade de retry com os demais read-clients.
    runWithRetry: jest.fn(<T>(fn: () => Promise<T>) => fn()),
});
const make = (base: ReturnType<typeof buildBase>) =>
    new ConexosSispagClient(base as unknown as ConexosBaseClient);

/** Erro axios-shaped (o que `authenticatedPost` re-lança em não-401). */
const httpError = (status: number, data?: unknown) => ({ response: { status, data } });

/** 400 de filtro como o ERP o escreve — medido em fin052/fin134/fin095. */
const filtroRecusado = (msg = "O filtro 'titDtaVencimento' não foi encontrado") =>
    httpError(400, { type: 'VALIDATION', messages: [{ message: msg }] });

const fin064Row = (over: Record<string, unknown> = {}) => ({
    docCod: '100',
    titCod: '1',
    dpeNomPessoa: 'ACME LTDA',
    titMnyValor: 1234.5,
    moeEspSigla: 'BRL',
    titDtaVencimento: 1_760_000_000_000,
    vldLib: 1,
    vldPago: 0,
    bncDesNome: 'ITAÚ',
    titNumRemessa: null,
    ...over,
});

describe('ConexosSispagClient (read-only)', () => {
    it('listTitulosAPagar mapeia rows do fin064 (liberado/pago via flags)', async () => {
        const base = buildBase();
        base.listGenericPaginated.mockResolvedValue({ count: 1, rows: [fin064Row()] });
        const titulos = await make(base).listTitulosAPagar(2, {
            minVencimento: 1,
            maxVencimento: 2,
        });
        expect(titulos[0]).toMatchObject({
            docCod: '100',
            titCod: '1',
            filCod: 2,
            credor: 'ACME LTDA',
            valor: 1234.5,
            liberado: true,
            pago: false,
            banco: 'ITAÚ',
        });
        // filtro server-side aplicado (vldPago + janela de vencimento)
        const [, body] = base.listGenericPaginated.mock.calls[0];
        expect((body as { filterList: Record<string, unknown> }).filterList).toMatchObject({
            'vldPago#EQ': 0,
            'titDtaVencimento#GE': 1,
            'titDtaVencimento#LE': 2,
        });
    });

    it('favorecido do fin064 vem de pesCodFor quando pesCod chega vazio (forma real do ERP)', async () => {
        const base = buildBase();
        base.listGenericPaginated.mockResolvedValue({
            count: 2,
            rows: [
                fin064Row({ pesCod: null, pesCodFor: 1161 }),
                fin064Row({ docCod: 101, pesCod: 384, pesCodFor: 1161 }),
            ],
        });
        const [semPesCod, comPesCod] = await make(base).listTitulosAPagar(2);
        expect(semPesCod.pesCod).toBe('1161');
        // `pesCod` preenchido continua mandando.
        expect(comPesCod.pesCod).toBe('384');
    });

    it('listTitulosAPagar cai para busca sem filtro quando o Conexos recusa o filtro (400)', async () => {
        const base = buildBase();
        base.listGenericPaginated.mockRejectedValueOnce(filtroRecusado()).mockResolvedValueOnce({
            count: 1,
            rows: [fin064Row({ dpeNomPessoa: null, dpeNomPessoaFor: 'FRETE X' })],
        });
        const titulos = await make(base).listTitulosAPagar(2, { minVencimento: 1 });
        expect(base.listGenericPaginated).toHaveBeenCalledTimes(2);
        // 2ª chamada é sem o filtro de vencimento (só o serviço filtra em memória)
        const [, fallbackBody] = base.listGenericPaginated.mock.calls[1];
        expect((fallbackBody as { filterList: Record<string, unknown> }).filterList).toEqual({});
        expect(titulos[0].credor).toBe('FRETE X');
    });

    it('listTitulosAPagar PROPAGA erro transitório (5xx/timeout) em vez de mascarar com leitura sem filtro', async () => {
        const base = buildBase();
        base.listGenericPaginated.mockRejectedValueOnce(httpError(500));
        await expect(make(base).listTitulosAPagar(2, { minVencimento: 1 })).rejects.toEqual(
            httpError(500),
        );
        // NÃO cai no fallback sem filtro — só a chamada filtrada aconteceu
        expect(base.listGenericPaginated).toHaveBeenCalledTimes(1);
    });

    describe('boundary numérico — `null` do ERP não é zero', () => {
        it('titDtaVencimento null NÃO vira epoch 0', async () => {
            // `z.coerce.number()` fazia `Number(null) === 0`. Epoch 0 ordena no TOPO da
            // carteira (comendo o cap de 5000), vira "vencido 20700d" na tela, infla o KPI de
            // vencidos e sai como `itsDtaPgto: 0` na remessa — que viola a regra R2 do ERP.
            const base = buildBase();
            base.listGenericPaginated.mockResolvedValue({
                count: 1,
                rows: [fin064Row({ titDtaVencimento: null })],
            });
            const [titulo] = await make(base).listTitulosAPagar(2);
            expect(titulo.vencimento).toBeUndefined();
        });

        it('string numérica continua sendo coagida (a tolerância não se perdeu)', async () => {
            const base = buildBase();
            base.listGenericPaginated.mockResolvedValue({
                count: 1,
                rows: [fin064Row({ titDtaVencimento: '1760000000000', titMnyValor: '99.5' })],
            });
            const [titulo] = await make(base).listTitulosAPagar(2);
            expect(titulo.vencimento).toBe(1_760_000_000_000);
            expect(titulo.valor).toBe(99.5);
        });

        it('prontoParaRemessa é `undefined` quando o fin064 não sabe — nunca `false`', async () => {
            // O fin064 não enxerga boleto (ADR-0040) nem conta do favorecido, e mede 0% nos
            // campos `its*`. "Não sei" não é "falta cadastro": um `false` aqui acenderia o
            // aviso na carteira INTEIRA, que é a mesma mentira de antes com o sinal trocado.
            const base = buildBase();
            base.listGenericPaginated.mockResolvedValue({
                count: 1,
                rows: [fin064Row({ itsVldModalidade: null, itsDesChavePix: null })],
            });
            const [titulo] = await make(base).listTitulosAPagar(2);
            expect(titulo.prontoParaRemessa).toBeUndefined();
        });

        it('prontoParaRemessa é `true` quando o read DE FATO viu um destino', async () => {
            const base = buildBase();
            base.listGenericPaginated.mockResolvedValue({
                count: 1,
                rows: [fin064Row({ itsDesChavePix: 'chave@pix.br' })],
            });
            const [titulo] = await make(base).listTitulosAPagar(2);
            expect(titulo.prontoParaRemessa).toBe(true);
        });
    });

    it('400 SEM corpo NÃO é recusa de filtro — propaga em vez de reler sem filtro', async () => {
        // Um 400 mudo não AFIRMA que o filtro foi recusado, e o fallback só se justifica
        // por uma afirmação. Antes, qualquer 400 (body malformado, drift de schema, sessão)
        // virava uma releitura AMPLA — milhares de linhas sem recorte de vencimento —
        // apresentada como se fosse a carteira normal.
        const base = buildBase();
        base.listGenericPaginated.mockRejectedValueOnce(httpError(400));
        await expect(make(base).listTitulosAPagar(2, { minVencimento: 1 })).rejects.toEqual(
            httpError(400),
        );
        expect(base.listGenericPaginated).toHaveBeenCalledTimes(1);
    });

    it('400 de OUTRA causa (não-filtro) propaga — não vira leitura ampla', async () => {
        const base = buildBase();
        const outro = httpError(400, {
            type: 'VALIDATION',
            messages: [{ message: 'CODIGO_IDENTIFICADOR_REGISTRO_EXISTENTE' }],
        });
        base.listGenericPaginated.mockRejectedValueOnce(outro);
        await expect(make(base).listTitulosAPagar(2, { minVencimento: 1 })).rejects.toEqual(outro);
        expect(base.listGenericPaginated).toHaveBeenCalledTimes(1);
    });

    it('400 REQUIRED_FILTER_ERROR é recusa de filtro — cai no fallback', async () => {
        const base = buildBase();
        base.listGenericPaginated
            .mockRejectedValueOnce(
                httpError(400, { messages: [{ message: 'Generic.REQUIRED_FILTER_ERROR' }] }),
            )
            .mockResolvedValueOnce({ count: 0, rows: [] });
        await make(base).listTitulosAPagar(2, { minVencimento: 1 });
        expect(base.listGenericPaginated).toHaveBeenCalledTimes(2);
    });

    it('400 que NOMEIA um campo filtrado é recusa de filtro, mesmo com frase nova', async () => {
        // O predicado não depende de uma frase exata do ERP: se ele nomear `docVldPrevisao`,
        // que foi um dos campos que MANDAMOS, é recusa de filtro.
        const base = buildBase();
        base.listGenericPaginated
            .mockRejectedValueOnce(
                httpError(400, { messages: [{ message: 'docVldPrevisao: operador inválido' }] }),
            )
            .mockResolvedValueOnce({ count: 0, rows: [] });
        await make(base).listTitulosAPagar(2, { minVencimento: 1 });
        expect(base.listGenericPaginated).toHaveBeenCalledTimes(2);
    });

    it('reads SISPAG passam pelo runWithRetry (paridade de retry com os demais read-clients)', async () => {
        const base = buildBase();
        base.listGenericPaginated.mockResolvedValue({ count: 0, rows: [] });
        const client = make(base);
        await client.listTitulosAPagar(2);
        await client.getTituloAPagar(2, '100', '1');
        await client.listLotes(2);
        await client.listBorderosAPagar(2);
        await client.listExteriorDocCods(2);
        // 5 reads → 5 passagens pelo runWithRetry (1:1)
        expect(base.runWithRetry).toHaveBeenCalledTimes(5);
    });

    it('getTituloAPagar acha o título por docCod+titCod ou devolve null', async () => {
        const base = buildBase();
        base.listGenericPaginated.mockResolvedValue({
            count: 2,
            rows: [fin064Row({ titCod: '9' }), fin064Row({ titCod: '1' })],
        });
        const found = await make(base).getTituloAPagar(2, '100', '1');
        expect(found?.titCod).toBe('1');
        base.listGenericPaginated.mockResolvedValue({ count: 0, rows: [] });
        expect(await make(base).getTituloAPagar(2, '100', '1')).toBeNull();
    });

    it('listLotes mapeia fin015 (envio/retorno via flags)', async () => {
        const base = buildBase();
        base.listGenericPaginated.mockResolvedValue({
            count: 1,
            rows: [
                {
                    flpCod: 3,
                    bncDesNome: 'ITAÚ',
                    conta: '55795-4',
                    layoutConta: 'AG:641',
                    flpVldStatus: 1,
                    flpVldConfEnvio: 1,
                    flpVldRet: 0,
                    titulosCount: 2,
                    soma: 500,
                    itensRetorno: 16,
                    usnDesNomeFin: 'RENE',
                    flpDtaCredito: 123,
                },
            ],
        });
        const lotes = await make(base).listLotes(2);
        expect(lotes[0]).toMatchObject({
            filCod: 2,
            flpCod: 3,
            envioConfirmado: true,
            retornoProcessado: false,
            itensRetorno: 16,
            finalizadoPor: 'RENE',
        });
    });

    it('listBorderosAPagar mapeia fin010 (temRemessa/temBaixa via flags)', async () => {
        const base = buildBase();
        base.listGenericPaginated.mockResolvedValue({
            count: 1,
            rows: [
                {
                    borCod: 1850,
                    gerDes: 'BANCO ITAÚ',
                    vlrTotalLiquido: 6449.25,
                    borDtaMvto: 123,
                    borVldFinalizado: 3,
                    vldHasRemessaPgto: 0,
                    vldHasBaixa: 1,
                },
            ],
        });
        const borderos = await make(base).listBorderosAPagar(2);
        expect(borderos[0]).toMatchObject({
            borCod: 1850,
            filCod: 2,
            temRemessa: false,
            temBaixa: true,
        });
        // filtro borVldTipo=2 (a-pagar)
        const [, body] = base.listGenericPaginated.mock.calls[0];
        expect((body as { filterList: Record<string, unknown> }).filterList).toMatchObject({
            'borVldTipo#EQ': 2,
        });
    });

    it('listExteriorDocCods devolve o conjunto de docCods EX', async () => {
        const base = buildBase();
        base.listGenericPaginated.mockResolvedValue({
            count: 2,
            rows: [{ docCod: 200 }, { docCod: '201' }],
        });
        const set = await make(base).listExteriorDocCods(2);
        expect(set.has('200')).toBe(true);
        expect(set.has('201')).toBe(true);
        const [, body] = base.listGenericPaginated.mock.calls[0];
        expect((body as { filterList: Record<string, unknown> }).filterList).toMatchObject({
            'ufEspSigla#LIKE': 'EX',
        });
    });
    describe('listLotes — escopo de filial', () => {
        it('filtra por filCod#EQ e rotula com a filial DA LINHA', async () => {
            // `opts.filCod` é contexto de sessão, não filtro. Sem `filCod#EQ` o ERP devolve
            // lotes de todas as filiais, e carimbar o parâmetro faria um lote da filial 1
            // sair como da 2 — `findByChaveNativa` casa o retorno por (fil, bnc, flp).
            const base = buildBase();
            base.listGenericPaginated.mockResolvedValue({
                count: 1,
                rows: [{ filCod: 1, flpCod: 5, flpVldStatus: 1 }],
            });

            const lotes = await make(base).listLotes(2);

            const [, body] = base.listGenericPaginated.mock.calls[0];
            expect((body as { filterList: Record<string, unknown> }).filterList).toMatchObject({
                'filCod#EQ': 2,
            });
            if (lotes.length > 0) expect(lotes[0]?.filCod).toBe(1);
        });
    });
    // ── ADR-0054 — destino de TED/PIX lido do cadastro da pessoa (cmn025) ─────────────
    describe('listChavesPixFavorecido (cmn025/cmnPessoasPix)', () => {
        const chave = (over: Record<string, unknown> = {}) => ({
            cixCod: 1,
            cixDesChave: 'fornecedor@exemplo.com',
            cixVldTipo: 2,
            cixVldSituacao: 1,
            cixVldDefault: 0,
            pesCod: 77,
            ...over,
        });

        it('lê por pesCod na filial e devolve só as ativas, default primeiro', async () => {
            const base = buildBase();
            base.listGenericPaginated.mockResolvedValue({
                count: 3,
                rows: [
                    chave({ cixCod: 1 }),
                    chave({ cixCod: 2, cixVldSituacao: 0 }),
                    chave({ cixCod: 3, cixVldTipo: 4, cixVldDefault: 1, cixDesChave: 'aa-bb' }),
                ],
            });
            const chaves = await make(base).listChavesPixFavorecido('77', 2);
            const [path, body, opts] = base.listGenericPaginated.mock.calls[0];
            expect(path).toBe('cmn025/cmnPessoasPix/list');
            expect((body as { filterList: Record<string, unknown> }).filterList).toEqual({
                'pesCod#EQ': '77',
            });
            // `filCod` em opts é o que vira o header `Cnx-filCod` no ConexosBaseClient.
            expect(opts).toEqual({ filCod: 2 });
            expect(chaves.map((c) => c.cixCod)).toEqual([3, 1]);
            expect(chaves[0]).toMatchObject({ tipo: 'ALEATORIA', padrao: true, pesCod: '77' });
            expect(chaves[1]).toMatchObject({ tipo: 'EMAIL', padrao: false });
        });

        it('linha fora do schema é descartada sem derrubar a lista', async () => {
            const base = buildBase();
            base.listGenericPaginated.mockResolvedValue({
                count: 2,
                rows: [chave({ cixCod: 'x', cixDesChave: null }), chave({ cixCod: 9 })],
            });
            const chaves = await make(base).listChavesPixFavorecido(77, 1);
            expect(chaves.map((c) => c.cixCod)).toEqual([9]);
        });

        it('tipo desconhecido não vira tipo inventado', async () => {
            const base = buildBase();
            base.listGenericPaginated.mockResolvedValue({
                count: 1,
                rows: [chave({ cixVldTipo: 9 })],
            });
            const [c] = await make(base).listChavesPixFavorecido(77, 1);
            expect(c?.tipo).toBeUndefined();
        });

        it('nunca loga a chave em claro', async () => {
            const spies = [
                jest.spyOn(Logger, 'info').mockImplementation(() => undefined),
                jest.spyOn(Logger, 'warn').mockImplementation(() => undefined),
                jest.spyOn(Logger, 'error').mockImplementation(() => undefined),
            ];
            const base = buildBase();
            base.listGenericPaginated.mockResolvedValue({
                count: 2,
                rows: [chave({ cixCod: 'x' }), chave({ cixCod: 5 })],
            });
            await make(base).listChavesPixFavorecido(77, 1);
            const logado = JSON.stringify(spies.map((s) => s.mock.calls));
            expect(logado).not.toContain('fornecedor@exemplo.com');
            for (const s of spies) s.mockRestore();
        });
    });

    describe('getDocumentoFavorecido (cmn025, campo a confirmar)', () => {
        it('devolve só dígitos do CPF/CNPJ lido do campo nomeado', async () => {
            const base = buildBase();
            base.listGenericPaginated.mockResolvedValue({
                count: 1,
                rows: [{ pesCod: 77, [CAMPO_DOCUMENTO_FAVORECIDO]: '12.345.678/0001-95' }],
            });
            const doc = await make(base).getDocumentoFavorecido('77', 2);
            expect(doc).toBe('12345678000195');
            const [path, body, opts] = base.listGenericPaginated.mock.calls[0];
            expect(path).toBe('cmn025/list');
            expect((body as { filterList: Record<string, unknown> }).filterList).toEqual({
                'pesCod#EQ': '77',
            });
            expect(opts).toEqual({ filCod: 2 });
        });

        it('sem o campo, com valor inválido ou sem linha → undefined, nunca throw', async () => {
            for (const rows of [
                [{ pesCod: 77 }],
                [{ pesCod: 77, [CAMPO_DOCUMENTO_FAVORECIDO]: '123' }],
                [{ pesCod: 77, [CAMPO_DOCUMENTO_FAVORECIDO]: null }],
                [{ pesCod: 88, [CAMPO_DOCUMENTO_FAVORECIDO]: '12345678000195' }],
                [],
            ]) {
                const base = buildBase();
                base.listGenericPaginated.mockResolvedValue({ count: rows.length, rows });
                await expect(make(base).getDocumentoFavorecido('77', 2)).resolves.toBeUndefined();
            }
        });

        it('nunca loga o documento em claro', async () => {
            const spies = [
                jest.spyOn(Logger, 'info').mockImplementation(() => undefined),
                jest.spyOn(Logger, 'warn').mockImplementation(() => undefined),
            ];
            const base = buildBase();
            base.listGenericPaginated.mockResolvedValue({
                count: 1,
                rows: [{ pesCod: 77, [CAMPO_DOCUMENTO_FAVORECIDO]: '12345678000195' }],
            });
            await make(base).getDocumentoFavorecido('77', 2);
            expect(JSON.stringify(spies.map((s) => s.mock.calls))).not.toContain('12345678000195');
            for (const s of spies) s.mockRestore();
        });
    });

    describe('listContasFavorecido', () => {
        it('não filtra por banco dentro do client (regressão: TED para qualquer banco)', async () => {
            const base = buildBase();
            base.listGenericPaginated.mockResolvedValue({
                count: 3,
                rows: [
                    { pctCodSeq: 1, pctNumBanco: 341, pctVldStatus: 1, pctVldDefault: 0 },
                    { pctCodSeq: 2, pctNumBanco: 237, pctVldStatus: 1, pctVldDefault: 1 },
                    { pctCodSeq: 3, pctNumBanco: 1, pctVldStatus: 0, pctVldDefault: 0 },
                ],
            });
            const contas = await make(base).listContasFavorecido('77', 2);
            expect(contas.map((c) => [c.pctCodSeq, c.banco])).toEqual([
                [2, 237],
                [1, 341],
            ]);
        });
    });

    it('não chama as validações do ERP (H1 não provado)', () => {
        const fonte = readFileSync(join(__dirname, 'ConexosSispagClient.ts'), 'utf8');
        expect(fonte).not.toMatch(/validacao\/modalidade/);
    });
});

describe('ConexosSispagClient.lerSituacaoTitulo — fin064 tri-estado (I11c, ADR-0055)', () => {
    const linha = (over: Record<string, unknown> = {}) =>
        fin064Row({
            docCod: '38682',
            titCod: '1',
            vldPago: 1,
            totalAberto: 0,
            totalPago: 275,
            ...over,
        });

    it('lê por docCod SEM o filtro vldPago#EQ:0 da carteira', async () => {
        const base = buildBase();
        base.listGenericPaginated.mockResolvedValue({ count: 1, rows: [linha()] });
        await make(base).lerSituacaoTitulo(2, '38682', '1');
        const [endpoint, body, opts] = base.listGenericPaginated.mock.calls[0];
        expect(endpoint).toBe('fin064/list');
        expect(body.filterList).toEqual({ 'docCod#EQ': '38682' });
        expect(opts).toEqual({ filCod: 2 });
    });

    it.each([
        [1, true],
        ['1', true],
        [true, true],
        [0, false],
        ['0', false],
        [false, false],
    ])('vldPago %p → %p', async (valor, esperado) => {
        const base = buildBase();
        base.listGenericPaginated.mockResolvedValue({
            count: 1,
            rows: [linha({ vldPago: valor })],
        });
        const r = await make(base).lerSituacaoTitulo(2, '38682', '1');
        expect(r).toEqual({ legivel: true, vldPago: esperado, aberto: 0, valorPagoTitulo: 275 });
    });

    it.each([
        ['ausente', undefined],
        ['null', null],
        ['texto', 'SIM'],
        ['número estranho', 2],
    ])('vldPago %s NÃO vira "não pago": leitura ilegível', async (_n, valor) => {
        const base = buildBase();
        const row = linha({ vldPago: valor });
        if (valor === undefined) delete (row as Record<string, unknown>).vldPago;
        base.listGenericPaginated.mockResolvedValue({ count: 1, rows: [row] });
        const r = await make(base).lerSituacaoTitulo(2, '38682', '1');
        expect(r.legivel).toBe(false);
    });

    it('aberto: totalAberto primeiro, titMnyAberto como reserva; ausente nos dois → ilegível', async () => {
        const base = buildBase();
        base.listGenericPaginated
            .mockResolvedValueOnce({
                count: 1,
                rows: [linha({ totalAberto: null, titMnyAberto: 12.5 })],
            })
            .mockResolvedValueOnce({
                count: 1,
                rows: [linha({ totalAberto: null, titMnyAberto: null })],
            });
        const client = make(base);
        expect(await client.lerSituacaoTitulo(2, '38682', '1')).toEqual(
            expect.objectContaining({ legivel: true, aberto: 12.5 }),
        );
        expect((await client.lerSituacaoTitulo(2, '38682', '1')).legivel).toBe(false);
    });

    it('título ausente da leitura → ilegível (não "não pago")', async () => {
        const base = buildBase();
        base.listGenericPaginated.mockResolvedValue({ count: 1, rows: [linha({ titCod: '2' })] });
        const r = await make(base).lerSituacaoTitulo(2, '38682', '1');
        expect(r).toEqual({ legivel: false, motivo: expect.stringMatching(/não encontrado/) });
    });

    it.each([
        ['rede', new Error('socket hang up')],
        ['403', httpError(403, { message: 'forbidden' })],
        ['500', httpError(500)],
    ])('falha HTTP (%s) → ilegível, sem lançar', async (_n, erro) => {
        const base = buildBase();
        base.listGenericPaginated.mockRejectedValue(erro);
        const r = await make(base).lerSituacaoTitulo(2, '38682', '1');
        expect(r.legivel).toBe(false);
    });

    it('getTituloAPagar existente continua coagindo vldPago ilegível a false (carteira intocada)', async () => {
        const base = buildBase();
        base.listGenericPaginated.mockResolvedValue({
            count: 1,
            rows: [linha({ vldPago: 'SIM' })],
        });
        const t = await make(base).getTituloAPagar(2, '38682', '1');
        expect(t?.pago).toBe(false);
    });
});
