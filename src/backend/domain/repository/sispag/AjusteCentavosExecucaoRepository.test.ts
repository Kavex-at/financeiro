import 'reflect-metadata';
import type PostgreeDatabaseClient from '../../client/database/PostgreeDatabaseClient.js';
import type { TransactionClient } from '../../client/database/PostgreeDatabaseClient.js';
import AjusteCentavosExecucaoRepository from './AjusteCentavosExecucaoRepository.js';
import type LotePagamentoRepository from './LotePagamentoRepository.js';
import SugestaoBoletoRepository from './SugestaoBoletoRepository.js';
import type TituloAPagarRepository from './TituloAPagarRepository.js';

const db = () => ({
    selectFirst: jest.fn(async () => null),
    selectMany: jest.fn(async () => []),
    update: jest.fn(async () => 1),
    insert: jest.fn(async () => 1),
    withTransaction: jest.fn(),
});

const make = (d = db()) =>
    new AjusteCentavosExecucaoRepository(
        d as unknown as PostgreeDatabaseClient,
        {} as SugestaoBoletoRepository,
        {} as TituloAPagarRepository,
        {} as LotePagamentoRepository,
    );

describe('AjusteCentavosExecucaoRepository (unidade)', () => {
    it('marcador curto, MAIÚSCULO e sem dígitos longos', () => {
        const m = AjusteCentavosExecucaoRepository.marcadorDe(
            '00000000-0000-0000-0000-0000000000a1',
        );
        expect(m).toBe('AJC-000000000000');
        expect(m.length).toBeLessThan(20);
    });

    it('abrir recusa código que não seja a máscara 5+4, antes de tocar o banco', async () => {
        const d = db();
        await expect(
            make(d).abrir({
                filCod: 2,
                docCod: '536',
                titCodOrigem: '1',
                decisaoId: 'd',
                codigoMascarado: '3'.repeat(44),
            }),
        ).rejects.toThrow(/mascarado 5\+4/);
        expect(d.selectFirst).not.toHaveBeenCalled();
    });

    it('transição inválida lança antes do UPDATE; a válida é condicionada à etapa de origem', async () => {
        const d = db();
        const r = make(d);
        await expect(r.registrarResultado('id', 'pendente', 'concluido')).rejects.toThrow();
        expect(d.update).not.toHaveBeenCalled();
        await r.registrarResultado('id', 'pendente', 'renegociacao_criada', { frnCod: 3 });
        const [sql, params] = d.update.mock.calls[0] as unknown as [
            string,
            Record<string, unknown>,
        ];
        expect(sql).toMatch(/WHERE id = \$id::uuid AND etapa = \$de/);
        expect(params).toMatchObject({ de: 'pendente', para: 'renegociacao_criada', frnCod: 3 });
    });
});

describe('SugestaoBoletoRepository.transferirDecisao (I18j, M1)', () => {
    const linha = {
        id: 'd-1',
        fil_cod: 2,
        doc_cod: '536',
        tit_cod: '1',
        pes_cod: '7001',
        ddc_cod: 10,
        dit_cod: 1,
        codbar_mascarado: '34191…9000',
        valor_titulo: 462.49,
        vencimento_titulo: '2026-10-30',
        valor_boleto: 462.5,
        vencimento_boleto: '2026-10-30',
        delta_valor: 0.01,
        delta_percentual: 0,
        delta_dias: 0,
        sinais: [],
        tier: 'CONHECIDO',
        emissor_chave: '341:1:1',
        decisao: 'CONFIRMADA',
        decidido_por: 'ana',
        decidido_em: '2026-10-19T10:00:00Z',
        confirmacao_emissor_id: 'par-1',
        versao: 1,
    };

    it('anula ANTES de inserir (índices únicos I15l) e grava os dois eventos', async () => {
        const ordem: string[] = [];
        const tx = {
            selectFirst: jest.fn(async () => linha),
            selectMany: jest.fn(),
            update: jest.fn(async (sql: string) => {
                ordem.push(sql.includes('UPDATE') ? 'anula' : 'evento');
                return 1;
            }),
            insert: jest.fn(async () => {
                ordem.push('insere');
                return 1;
            }),
        };
        const r = await new SugestaoBoletoRepository(
            {} as PostgreeDatabaseClient,
        ).transferirDecisao(
            { decisaoId: 'd-1', titCodNovo: '2', frnCod: 3, ator: 'sistema' },
            tx as unknown as TransactionClient,
        );
        expect(r.transferida).toBe(true);
        expect(ordem).toEqual(['anula', 'insere', 'evento', 'evento']);
        const [, params] = tx.update.mock.calls[0] as unknown as [string, Record<string, unknown>];
        expect(params.motivo).toBe('título renegociado 536/1 → 536/2, frnCod 3');
    });

    it('a decisão nova HERDA o reconhecimento (I15r/I18j): copia as seis colunas; a validade é derivada', async () => {
        const tx = {
            selectFirst: jest.fn(async () => linha),
            selectMany: jest.fn(),
            update: jest.fn(async () => 1),
            insert: jest.fn(async () => 1),
        };
        await new SugestaoBoletoRepository({} as PostgreeDatabaseClient).transferirDecisao(
            { decisaoId: 'd-1', titCodNovo: '2', frnCod: 3, ator: 'sistema' },
            tx as unknown as TransactionClient,
        );
        const [sql] = tx.insert.mock.calls[0] as unknown as [string];
        for (const coluna of [
            'reconhecimento_tipo',
            'reconhecimento_motivo',
            'reconhecimento_delta_dias_visto',
            'reconhecimento_valor_boleto_visto_centavos',
            'reconhecido_por',
            'reconhecido_em',
        ]) {
            // aparece na lista de colunas E no SELECT que copia da decisão antiga
            expect(sql.split(coluna).length - 1).toBe(2);
        }
        // O autor do reconhecimento é o humano herdado, nunca `sistema` (parâmetro $ator só em transferida_por).
        expect(sql).not.toMatch(/reconhecido_por[^,]*\$ator/);
    });

    it('decisão já não CONFIRMADA ⇒ nada muda', async () => {
        const tx = {
            selectFirst: jest.fn(async () => ({
                ...linha,
                decisao: 'ANULADA',
                anulada_por: 'bia',
            })),
            update: jest.fn(),
            insert: jest.fn(),
        };
        const r = await new SugestaoBoletoRepository(
            {} as PostgreeDatabaseClient,
        ).transferirDecisao(
            { decisaoId: 'd-1', titCodNovo: '2', frnCod: 3, ator: 'sistema' },
            tx as unknown as TransactionClient,
        );
        expect(r).toEqual({ transferida: false });
        expect(tx.update).not.toHaveBeenCalled();
        expect(tx.insert).not.toHaveBeenCalled();
    });
});
