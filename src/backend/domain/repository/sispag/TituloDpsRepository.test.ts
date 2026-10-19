import 'reflect-metadata';
import type PostgreeDatabaseClient from '../../client/database/PostgreeDatabaseClient.js';
import TituloDpsRepository from './TituloDpsRepository.js';

const buildDb = () => ({
    selectMany: jest.fn().mockResolvedValue([]),
    insert: jest.fn(async () => 1),
});

const repoCom = (db: ReturnType<typeof buildDb>) =>
    new TituloDpsRepository(db as unknown as PostgreeDatabaseClient);

describe('TituloDpsRepository (ADR-0073, I15p)', () => {
    it('listarLidos lê só status LIDO e mapeia para DpsConhecido', async () => {
        const db = buildDb();
        db.selectMany.mockResolvedValueOnce([
            {
                fil_cod: 2,
                doc_cod: '41155',
                tit_cod: '1',
                pes_cod: '386',
                nfse: '86666',
                dps: '776132',
            },
            { fil_cod: 4, doc_cod: '10463', tit_cod: '1', pes_cod: null, nfse: null, dps: '25459' },
        ]);
        const lidos = await repoCom(db).listarLidos();
        const [sql] = db.selectMany.mock.calls[0] as unknown as [string];
        expect(sql).toMatch(/FROM titulo_dps/);
        expect(sql).toMatch(/status = 'LIDO'/);
        expect(lidos).toEqual([
            {
                filCod: 2,
                docCod: '41155',
                titCod: '1',
                pesCod: '386',
                nfse: '86666',
                dps: '776132',
            },
            { filCod: 4, docCod: '10463', titCod: '1', dps: '25459' },
        ]);
    });

    it('listarLidos descarta linha sem DPS numérico (defesa além do CHECK)', async () => {
        const db = buildDb();
        db.selectMany.mockResolvedValueOnce([
            { fil_cod: 2, doc_cod: '1', tit_cod: '1', pes_cod: '386', nfse: '1', dps: null },
            { fil_cod: 2, doc_cod: '2', tit_cod: '1', pes_cod: '386', nfse: '2', dps: '77x' },
        ]);
        expect(await repoCom(db).listarLidos()).toEqual([]);
    });

    it('registrar grava UPSERT por título, parametrizado, somando tentativas', async () => {
        const db = buildDb();
        await repoCom(db).registrar({
            filCod: 2,
            docCod: '41155',
            titCod: '1',
            pesCod: '386',
            nfse: '86666',
            dps: '776132',
            status: 'LIDO',
            fonte: 'PDF_GED',
            arquivo: 'NF_86666.PDF',
        });
        const [sql, params] = db.insert.mock.calls[0] as unknown as [
            string,
            Record<string, unknown>,
        ];
        expect(sql).toMatch(/INSERT INTO titulo_dps/);
        expect(sql).toMatch(/ON CONFLICT \(fil_cod, doc_cod, tit_cod\) DO UPDATE SET/);
        expect(sql).toMatch(/tentativas = titulo_dps\.tentativas \+ 1/);
        expect(sql).not.toContain('41155');
        expect(params).toMatchObject({
            filCod: 2,
            docCod: '41155',
            titCod: '1',
            dps: '776132',
            status: 'LIDO',
            arquivo: 'NF_86666.PDF',
        });
    });

    it('registrar tentativa sem DPS grava dps nulo e o motivo', async () => {
        const db = buildDb();
        await repoCom(db).registrar({
            filCod: 2,
            docCod: '41156',
            titCod: '1',
            status: 'SEM_PDF',
            fonte: 'PDF_GED',
            motivo: 'nenhum PDF na pasta do processo',
        });
        const [, params] = db.insert.mock.calls[0] as unknown as [string, Record<string, unknown>];
        expect(params).toMatchObject({
            dps: null,
            pesCod: null,
            status: 'SEM_PDF',
            motivo: 'nenhum PDF na pasta do processo',
        });
    });
});
