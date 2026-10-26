import 'reflect-metadata';
import type PostgreeDatabaseClient from '../../client/database/PostgreeDatabaseClient.js';
import SuggestionListingTruncatedError from '../../errors/SuggestionListingTruncatedError.js';
import SugestaoBoletoRepository from './SugestaoBoletoRepository.js';

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

const make = (db: DbMock) => new SugestaoBoletoRepository(db as unknown as PostgreeDatabaseClient);

const PAR_ROW = {
    id: 'p1',
    pes_cod: '7001',
    credor: 'ACME',
    emissor_chave: '341:1234:12345',
    layout_emissor: 'ITAU_341',
    banco_emissor: '341',
    emissor_mascarado: '341 / 1234 / ***2345',
    estado: 'VIGENTE',
    evidencia: { tier: 'FORTE' },
    confirmado_por: 'ana',
    confirmado_em: new Date('2026-10-14T10:00:00Z'),
    revogado_por: null,
    revogado_em: null,
    motivo_revogacao: null,
    versao: 1,
};

const DECISAO_ROW = {
    id: 'd1',
    fil_cod: 2,
    doc_cod: '9001',
    tit_cod: '1',
    pes_cod: '7001',
    credor: 'ACME',
    ddc_cod: 10,
    dit_cod: 3,
    numero_boleto: 'NF1',
    codbar_mascarado: '341…0100',
    valor_titulo: '100.00',
    vencimento_titulo: '2026-10-20',
    valor_boleto: '100.03',
    vencimento_boleto: '2026-10-20',
    delta_valor: '0.03',
    delta_percentual: '0.0300',
    delta_dias: 0,
    sinais: ['MESMO_DIA'],
    tier: 'FORTE',
    emissor_chave: '341:1234:12345',
    decisao: 'CONFIRMADA',
    decidido_por: 'ana',
    decidido_em: new Date('2026-10-14T10:00:00Z'),
    motivo: null,
    confirmacao_emissor_id: 'p1',
    versao: 1,
    anulada_por: null,
    anulada_em: null,
    motivo_anulacao: null,
};

const NOVA_DECISAO = {
    filCod: 2,
    docCod: '9001',
    titCod: '1',
    pesCod: '7001',
    credor: 'ACME',
    ddcCod: 10,
    ditCod: 3,
    numeroBoleto: 'NF1',
    codbarMascarado: '341…0100',
    valorTitulo: 100,
    vencimentoTitulo: '2026-10-20',
    valorBoleto: 100.03,
    vencimentoBoleto: '2026-10-20',
    deltaValor: 0.03,
    deltaPercentual: 0.03,
    deltaDias: 0,
    sinais: ['MESMO_DIA' as const],
    tier: 'FORTE' as const,
    emissorChave: '341:1234:12345',
    decisao: 'CONFIRMADA' as const,
    decididoPor: 'ana',
    confirmacaoEmissorId: 'p1',
};

describe('SugestaoBoletoRepository (ADR-0068, migration 0084)', () => {
    it('listarParesVigentes: só VIGENTE, parametrizado, mapeia a linha', async () => {
        const db = buildDb();
        db.selectMany.mockResolvedValue([PAR_ROW]);
        const r = await make(db).listarParesVigentes(['7001']);
        const [sql, params] = db.selectMany.mock.calls[0];
        expect(sql).toMatch(/estado = 'VIGENTE'/);
        expect(sql).not.toMatch(/'7001'/);
        expect(params).toEqual({ pesCods: ['7001'] });
        expect(r[0]).toMatchObject({
            id: 'p1',
            pesCod: '7001',
            emissorChave: '341:1234:12345',
            layoutEmissor: 'ITAU_341',
            estado: 'VIGENTE',
            versao: 1,
        });
        expect(r[0]).not.toHaveProperty('revogadoPor');
    });

    it('listagens no teto de 10000 linhas falham alto em vez de devolver lista truncada', async () => {
        const cheia = (row: unknown) => Array.from({ length: 10000 }, () => row);
        const casos: Array<[string, (r: SugestaoBoletoRepository) => Promise<unknown>, unknown]> = [
            ['listarParesVigentes', (r) => r.listarParesVigentes(), PAR_ROW],
            ['listarPares', (r) => r.listarPares(), PAR_ROW],
            ['listarDecisoes', (r) => r.listarDecisoes({}), DECISAO_ROW],
        ];
        for (const [, chamar, row] of casos) {
            const db = buildDb();
            db.selectMany.mockResolvedValue(cheia(row));
            await expect(chamar(make(db))).rejects.toBeInstanceOf(SuggestionListingTruncatedError);
        }
    });

    it('listarParesVigentes sem filtro passa pesCods nulo', async () => {
        const db = buildDb();
        await make(db).listarParesVigentes();
        expect(db.selectMany.mock.calls[0][1]).toEqual({ pesCods: null });
    });

    it('inserirPar: ON CONFLICT no índice parcial; devolve criado=true quando RETURNING traz id', async () => {
        const db = buildDb();
        db.selectFirst.mockResolvedValueOnce({ id: 'novo' }).mockResolvedValueOnce(PAR_ROW);
        const r = await make(db).inserirPar({
            pesCod: '7001',
            credor: 'ACME',
            emissorChave: '341:1234:12345',
            layoutEmissor: 'ITAU_341',
            bancoEmissor: '341',
            emissorMascarado: '341 / 1234 / ***2345',
            evidencia: { tier: 'FORTE' },
            confirmadoPor: 'ana',
        });
        const [sql, params] = db.selectFirst.mock.calls[0];
        expect(sql).toMatch(/ON CONFLICT \(pes_cod, emissor_chave\) WHERE estado = 'VIGENTE'/);
        expect(sql).toMatch(/DO NOTHING/);
        expect(sql).toMatch(/RETURNING id/);
        expect(sql).not.toMatch(/'ana'|'7001'/);
        expect(params).toMatchObject({ pesCod: '7001', confirmadoPor: 'ana' });
        expect(params.evidencia).toBe(JSON.stringify({ tier: 'FORTE' }));
        expect(r.criado).toBe(true);
    });

    it('inserirPar: perdedor da corrida relê e devolve a vencedora (criado=false)', async () => {
        const db = buildDb();
        db.selectFirst.mockResolvedValueOnce(null).mockResolvedValueOnce(PAR_ROW);
        const r = await make(db).inserirPar({
            pesCod: '7001',
            emissorChave: '341:1234:12345',
            layoutEmissor: 'ITAU_341',
            bancoEmissor: '341',
            emissorMascarado: 'm',
            evidencia: {},
            confirmadoPor: 'bia',
        });
        expect(r.criado).toBe(false);
        expect(r.par.id).toBe('p1');
        expect(db.selectFirst.mock.calls[1][0]).toMatch(/estado = 'VIGENTE'/);
    });

    it('revogarPar: lock otimista por versao e só se VIGENTE; devolve linhas afetadas', async () => {
        const db = buildDb();
        db.update.mockResolvedValue(0);
        const n = await make(db).revogarPar({
            id: 'p1',
            versaoEsperada: 1,
            ator: 'bia',
            motivo: 'conta trocada',
        });
        const [sql, params] = db.update.mock.calls[0];
        expect(sql).toMatch(/versao = \$versao/);
        expect(sql).toMatch(/estado = 'VIGENTE'/);
        expect(sql).toMatch(/versao = versao \+ 1/);
        expect(sql).not.toMatch(/conta trocada|'bia'/);
        expect(params).toEqual({ id: 'p1', versao: 1, ator: 'bia', motivo: 'conta trocada' });
        expect(n).toBe(0);
    });

    it('anularDecisao: CONFIRMADA → ANULADA com lock por versao, só se ainda CONFIRMADA', async () => {
        const db = buildDb();
        db.update.mockResolvedValue(0);
        const n = await make(db).anularDecisao({
            id: 'd1',
            versaoEsperada: 3,
            ator: 'bia',
            motivo: 'confirmação errada',
        });
        const [sql, params] = db.update.mock.calls[0];
        expect(sql).toMatch(/decisao = 'ANULADA'/);
        expect(sql).toMatch(/versao = \$versao/);
        expect(sql).toMatch(/decisao = 'CONFIRMADA'/);
        expect(sql).toMatch(/versao = versao \+ 1/);
        expect(sql).not.toMatch(/confirmação errada|'bia'/);
        expect(params).toEqual({
            id: 'd1',
            versao: 3,
            ator: 'bia',
            motivo: 'confirmação errada',
        });
        expect(n).toBe(0);
    });

    it('listarConfirmadasDoPar trava as linhas (FOR UPDATE) e mapeia a anulação', async () => {
        const db = buildDb();
        db.selectMany.mockResolvedValue([
            {
                ...DECISAO_ROW,
                decisao: 'ANULADA',
                anulada_por: 'bia',
                anulada_em: new Date('2026-10-14T12:00:00Z'),
                motivo_anulacao: 'par revogado: x',
                versao: 2,
            },
        ]);
        const tx = db as never;
        const r = await make(db).listarConfirmadasDoPar('p1', tx);
        expect(db.selectMany.mock.calls[0][0]).toMatch(/FOR UPDATE/);
        expect(db.selectMany.mock.calls[0][0]).toMatch(/decisao = 'CONFIRMADA'/);
        expect(r[0]).toMatchObject({
            decisao: 'ANULADA',
            anuladaPor: 'bia',
            motivoAnulacao: 'par revogado: x',
            versao: 2,
        });
    });

    it('buscarParVigente trava o par (FOR SHARE) só dentro da transação e quando pedido', async () => {
        const db = buildDb();
        const tx = buildDb();
        await make(db).buscarParVigente('7001', '341:1234:12345', undefined, true);
        await make(db).buscarParVigente('7001', '341:1234:12345', tx as never);
        await make(db).buscarParVigente('7001', '341:1234:12345', tx as never, true);
        expect(db.selectFirst.mock.calls[0][0]).not.toMatch(/FOR SHARE/);
        expect(tx.selectFirst.mock.calls[0][0]).not.toMatch(/FOR SHARE/);
        expect(tx.selectFirst.mock.calls[1][0]).toMatch(/FOR SHARE/);
    });

    it('inserirDecisao CONFIRMADA: ON CONFLICT DO NOTHING; criada=true com a linha gravada', async () => {
        const db = buildDb();
        db.selectFirst.mockResolvedValueOnce({ id: 'd1' }).mockResolvedValueOnce(DECISAO_ROW);
        const r = await make(db).inserirDecisao(NOVA_DECISAO);
        const [sql, params] = db.selectFirst.mock.calls[0];
        expect(sql).toMatch(/ON CONFLICT DO NOTHING/);
        expect(sql).toMatch(/RETURNING id/);
        expect(params.sinais).toBe(JSON.stringify(['MESMO_DIA']));
        expect(r.criada).toBe(true);
        expect(r.decisao).toMatchObject({
            id: 'd1',
            valorBoleto: 100.03,
            deltaDias: 0,
            tier: 'FORTE',
        });
    });

    it('inserirDecisao: os sinais novos (ADR-0072) serializam em JSONB e voltam iguais na leitura', async () => {
        const sinais = [
            'MESMO_DIA',
            'VENCE_ANTES_DO_TITULO',
            'RECONHECEU_VENCE_ANTES',
        ] as NonNullable<typeof NOVA_DECISAO.sinais>;
        const db = buildDb();
        db.selectFirst.mockResolvedValueOnce({ id: 'd1' }).mockResolvedValueOnce({
            ...DECISAO_ROW,
            sinais,
        });
        const r = await make(db).inserirDecisao({ ...NOVA_DECISAO, sinais });
        expect(db.selectFirst.mock.calls[0][1].sinais).toBe(JSON.stringify(sinais));
        expect(r.decisao.sinais).toEqual(sinais);

        db.selectMany.mockResolvedValueOnce([{ ...DECISAO_ROW, sinais }]);
        const lidas = await make(db).listarDecisoes({ decisao: 'CONFIRMADA' });
        expect(lidas[0]?.sinais).toEqual(sinais);
    });

    it('decisão legada sem os sinais novos continua legível', async () => {
        const db = buildDb();
        db.selectMany.mockResolvedValueOnce([{ ...DECISAO_ROW, sinais: ['MESMO_DIA'] }]);
        const lidas = await make(db).listarDecisoes({ decisao: 'CONFIRMADA' });
        expect(lidas[0]?.sinais).toEqual(['MESMO_DIA']);
    });

    it('inserirDecisao: grava o reconhecimento tipado parametrizado, com a hora do servidor (ADR-0078)', async () => {
        const db = buildDb();
        const reconhecimento = {
            tipo: 'DATA_DIVERGENTE' as const,
            motivo: 'conferi o vencimento no portal',
            deltaDiasVisto: -3,
            valorBoletoVisto: 10_003,
            reconhecidoPor: 'ana',
        };
        db.selectFirst.mockResolvedValueOnce({ id: 'd1' }).mockResolvedValueOnce({
            ...DECISAO_ROW,
            reconhecimento_tipo: 'DATA_DIVERGENTE',
            reconhecimento_motivo: reconhecimento.motivo,
            reconhecimento_delta_dias_visto: -3,
            reconhecimento_valor_boleto_visto_centavos: '10003',
            reconhecido_por: 'ana',
            reconhecido_em: new Date('2026-10-26T12:00:00Z'),
        });
        const r = await make(db).inserirDecisao({ ...NOVA_DECISAO, reconhecimento });
        const [sql, params] = db.selectFirst.mock.calls[0];
        expect(sql).toMatch(/reconhecimento_tipo/);
        expect(sql).toMatch(/\$reconhecimentoTipo/);
        expect(sql).not.toContain(reconhecimento.motivo);
        expect(params).toMatchObject({
            reconhecimentoTipo: 'DATA_DIVERGENTE',
            reconhecimentoMotivo: reconhecimento.motivo,
            reconhecimentoDeltaDiasVisto: -3,
            reconhecimentoValorBoletoVisto: 10_003,
            reconhecidoPor: 'ana',
        });
        expect(r.decisao.reconhecimento).toEqual({
            tipo: 'DATA_DIVERGENTE',
            motivo: reconhecimento.motivo,
            deltaDiasVisto: -3,
            valorBoletoVisto: 10_003,
            reconhecidoPor: 'ana',
            reconhecidoEm: '2026-10-26T12:00:00.000Z',
        });
    });

    it('inserirDecisao sem reconhecimento grava nulos; decisão antiga lê `reconhecimento` ausente', async () => {
        const db = buildDb();
        db.selectFirst.mockResolvedValueOnce({ id: 'd1' }).mockResolvedValueOnce(DECISAO_ROW);
        const r = await make(db).inserirDecisao(NOVA_DECISAO);
        expect(db.selectFirst.mock.calls[0][1]).toMatchObject({
            reconhecimentoTipo: null,
            reconhecimentoMotivo: null,
            reconhecidoPor: null,
        });
        expect(r.decisao).not.toHaveProperty('reconhecimento');
    });

    it('inserirDecisao: perdedor relê a vencedora pelo título OU pelo boleto (criada=false)', async () => {
        const db = buildDb();
        db.selectFirst.mockResolvedValueOnce(null).mockResolvedValueOnce(DECISAO_ROW);
        const r = await make(db).inserirDecisao(NOVA_DECISAO);
        const [sql, params] = db.selectFirst.mock.calls[1];
        expect(sql).toMatch(/decisao = \$decisao/);
        expect(sql).toMatch(/\(fil_cod = \$filCod AND doc_cod = \$docCod AND tit_cod = \$titCod\)/);
        expect(sql).toMatch(/\(ddc_cod = \$ddcCod AND dit_cod = \$ditCod\)/);
        expect(params).toMatchObject({ decisao: 'CONFIRMADA', ddcCod: 10 });
        expect(r.criada).toBe(false);
        expect(r.decisao.id).toBe('d1');
    });

    it('inserirDecisao REJEITADA: relê só por (título, boleto)', async () => {
        const db = buildDb();
        db.selectFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({
            ...DECISAO_ROW,
            decisao: 'REJEITADA',
            motivo: 'outro credor',
        });
        const { confirmacaoEmissorId: _c, ...base } = NOVA_DECISAO;
        const r = await make(db).inserirDecisao({
            ...base,
            decisao: 'REJEITADA',
            motivo: 'outro credor',
        });
        const sql = db.selectFirst.mock.calls[1][0] as string;
        expect(sql).toMatch(
            /fil_cod = \$filCod AND doc_cod = \$docCod AND tit_cod = \$titCod\s+AND ddc_cod = \$ddcCod AND dit_cod = \$ditCod/,
        );
        expect(r.criada).toBe(false);
        expect(r.decisao.motivo).toBe('outro credor');
    });

    it('listarDecisoes: filtros nomeados e teto de linhas', async () => {
        const db = buildDb();
        db.selectMany.mockResolvedValue([DECISAO_ROW]);
        const r = await make(db).listarDecisoes({ decisao: 'CONFIRMADA', filCod: 2 });
        const [sql, params] = db.selectMany.mock.calls[0];
        expect(sql).toMatch(/\$decisao::text IS NULL OR decisao = \$decisao::text/);
        expect(sql).toMatch(/LIMIT 10000/);
        expect(params).toMatchObject({ decisao: 'CONFIRMADA', filCod: 2, docCod: null });
        expect(r).toHaveLength(1);
    });

    it('inserirEvento: parametrizado, detalhe como jsonb; devolve o id', async () => {
        const db = buildDb();
        const id = await make(db).inserirEvento({
            tipo: 'LINHA_COPIADA',
            ator: 'ana',
            filCod: 2,
            docCod: '9001',
            titCod: '1',
            ddcCod: 10,
            ditCod: 3,
            detalhe: { codbarMascarado: '341…0100' },
        });
        const [sql, params] = db.insert.mock.calls[0];
        expect(sql).toMatch(/INSERT INTO sispag_sugestao_boleto_evento/);
        expect(sql).toMatch(/\$detalhe::jsonb/);
        expect(sql).not.toMatch(/'ana'/);
        expect(params).toMatchObject({
            id,
            tipo: 'LINHA_COPIADA',
            ator: 'ana',
            pesCod: null,
            motivo: null,
            detalhe: JSON.stringify({ codbarMascarado: '341…0100' }),
        });
    });

    it('nada persistido carrega 44 dígitos seguidos (barras completas)', async () => {
        const db = buildDb();
        db.selectFirst.mockResolvedValueOnce({ id: 'd1' }).mockResolvedValueOnce(DECISAO_ROW);
        const repo = make(db);
        await repo.inserirDecisao(NOVA_DECISAO);
        await repo.inserirEvento({
            tipo: 'LINHA_COPIADA',
            ator: 'ana',
            detalhe: { m: '341…0100' },
        });
        const gravado = JSON.stringify([
            ...db.selectFirst.mock.calls.map((c) => c[1]),
            ...db.insert.mock.calls.map((c) => c[1]),
        ]);
        expect(gravado).not.toMatch(/\d{44}/);
    });
});
