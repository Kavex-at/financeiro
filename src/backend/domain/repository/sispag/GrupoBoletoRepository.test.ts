import 'reflect-metadata';
import type PostgreeDatabaseClient from '../../client/database/PostgreeDatabaseClient.js';
import type { TransactionClient } from '../../client/database/PostgreeDatabaseClient.js';
import type { NovoGrupoBoleto } from '../../interface/sispag/GrupoBoletoInterface.js';
import GrupoBoletoRepository from './GrupoBoletoRepository.js';

const tx = () => ({
    selectFirst: jest.fn(
        async (_sql: string, _p?: Record<string, unknown>): Promise<unknown> => null,
    ),
    selectMany: jest.fn(
        async (_sql: string, _p?: Record<string, unknown>): Promise<unknown[]> => [],
    ),
    update: jest.fn(async (_sql: string, _p?: Record<string, unknown>) => 1),
    insert: jest.fn(async (_sql: string, _p?: Record<string, unknown>) => 1),
});

const db = (t = tx()) => ({
    ...t,
    withTransaction: jest.fn(async (fn: (x: TransactionClient) => Promise<unknown>) =>
        fn(t as unknown as TransactionClient),
    ),
});

const NOVO: NovoGrupoBoleto = {
    filCod: 2,
    pesCod: '7001',
    emissorChave: '341:1:1',
    ddcCod: 10,
    ditCod: 1,
    codbarMascarado: '34191…8200',
    valorBoletoCentavos: 157500,
    vencimentoBoleto: '2026-10-21',
    titulos: [
        {
            filCod: 2,
            docCod: '38883',
            titCod: '1',
            valorLiquidoCentavos: 52500,
            vencimento: '2026-10-21',
        },
        {
            filCod: 2,
            docCod: '38884',
            titCod: '1',
            valorLiquidoCentavos: 52500,
            vencimento: '2026-10-21',
        },
        {
            filCod: 2,
            docCod: '38885',
            titCod: '1',
            valorLiquidoCentavos: 52500,
            vencimento: '2026-10-21',
        },
    ],
    origem: 'SUGERIDO',
    intercambiavel: false,
    avisosReconhecidos: [],
    confirmacaoEmissorId: '00000000-0000-0000-0000-000000000900',
    confirmadoPor: 'ana',
};

describe('GrupoBoletoRepository (unidade)', () => {
    it('chaves de advisory lock por boleto e por título são estáveis (compartilhadas com a Task 10)', () => {
        expect(GrupoBoletoRepository.chaveLockBoleto(10, 1)).toBe('sispag:boleto:10:1');
        expect(
            GrupoBoletoRepository.chaveLockTitulo({ filCod: 2, docCod: '38883', titCod: '1' }),
        ).toBe('sispag:titulo:2:38883:1');
    });

    it('travar toma pg_advisory_xact_lock em ordem e sem repetir, parametrizado', async () => {
        const t = tx();
        await new GrupoBoletoRepository(db(t) as unknown as PostgreeDatabaseClient).travar(
            t as unknown as TransactionClient,
            ['sispag:titulo:2:2:1', 'sispag:boleto:10:1', 'sispag:titulo:2:2:1'],
        );
        const chamadas = t.selectFirst.mock.calls as unknown as Array<[string, { chave: string }]>;
        expect(chamadas.map((c) => c[1].chave)).toEqual([
            'sispag:boleto:10:1',
            'sispag:titulo:2:2:1',
        ]);
        expect(chamadas[0]?.[0]).toBe('SELECT pg_advisory_xact_lock(hashtextextended($chave, 0))');
    });

    it('inserirConfirmado recusa código que não seja a máscara 5+4 antes de tocar o banco', async () => {
        const d = db();
        await expect(
            new GrupoBoletoRepository(d as unknown as PostgreeDatabaseClient).inserirConfirmado({
                ...NOVO,
                codbarMascarado: '3'.repeat(44),
            }),
        ).rejects.toThrow(/mascarado 5\+4/);
        expect(d.withTransaction).not.toHaveBeenCalled();
    });

    it('inserirConfirmado trava boleto e títulos ANTES de ler ou gravar', async () => {
        const t = tx();
        const ordem: string[] = [];
        t.selectFirst.mockImplementation(async (sql: string) => {
            ordem.push(sql.includes('pg_advisory_xact_lock') ? 'lock' : 'leitura');
            return null;
        });
        t.insert.mockImplementation(async () => {
            ordem.push('insert');
            return 1;
        });
        await new GrupoBoletoRepository(db(t) as unknown as PostgreeDatabaseClient)
            .inserirConfirmado(NOVO)
            .catch(() => undefined); // a releitura final (mock) não acha o grupo
        expect(ordem.slice(0, 4)).toEqual(['lock', 'lock', 'lock', 'lock']);
        expect(ordem.indexOf('insert')).toBeGreaterThan(ordem.lastIndexOf('lock'));
    });

    it('anular recusa motivo fora de 10–500 antes de tocar o banco', async () => {
        const d = db();
        const repo = new GrupoBoletoRepository(d as unknown as PostgreeDatabaseClient);
        for (const motivo of ['curto', 'x'.repeat(501)]) {
            await expect(
                repo.anular({ grupoId: 'g', motivo, tipoAnulacao: 'MANUAL', ator: 'ana' }),
            ).rejects.toThrow(/10 e 500/);
        }
        expect(d.withTransaction).not.toHaveBeenCalled();
    });

    it('registrarEvento recusa código longo (máscara ou dados) e grava parametrizado', async () => {
        const t = tx();
        const repo = new GrupoBoletoRepository(db(t) as unknown as PostgreeDatabaseClient);
        await expect(
            repo.registrarEvento({
                grupoId: 'g',
                tipo: 'GRUPO_PAGO',
                ator: 'sistema',
                codigoMascarado: '3'.repeat(44),
            }),
        ).rejects.toThrow(/mascarado/);
        await expect(
            repo.registrarEvento({
                grupoId: 'g',
                tipo: 'GRUPO_PAGO',
                ator: 'sistema',
                dados: { linha: '3'.repeat(47) },
            }),
        ).rejects.toThrow(/dígitos/);
        expect(t.insert).not.toHaveBeenCalled();
        await repo.registrarEvento({ grupoId: 'g', tipo: 'GRUPO_PAGO', ator: 'sistema' });
        const [sql] = t.insert.mock.calls[0] as unknown as [string];
        expect(sql).toMatch(/VALUES \(\$id::uuid, \$grupoId::uuid, \$tipo, \$ator/);
        expect(sql).not.toMatch(/'sistema'|GRUPO_PAGO/);
    });
});
