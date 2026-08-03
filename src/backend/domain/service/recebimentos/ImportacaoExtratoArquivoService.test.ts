import 'reflect-metadata';
import ExcelJS from 'exceljs';
import type PostgreeDatabaseClient from '../../client/database/PostgreeDatabaseClient.js';
import IngestLockBusyError from '../../errors/IngestLockBusyError.js';
import { TRANSACAO_TIPO } from '../../interface/recebimentos/constants.js';
import type { TransacaoBancaria } from '../../interface/recebimentos/TransacaoBancaria.js';
import type RecebimentoIngestaoRunRepository from '../../repository/recebimentos/RecebimentoIngestaoRunRepository.js';
import type TransacaoRepository from '../../repository/recebimentos/TransacaoRepository.js';
import type LogService from '../LogService.js';
import BradescoExtratoParser from './parsers/BradescoExtratoParser.js';
import ImportacaoExtratoArquivoService from './ImportacaoExtratoArquivoService.js';

type Linha = [string, string, string, string, number | string, number | string];

/** Créditos + débitos padrão (3 créditos, 2 débitos) sob o layout Bradesco. */
const LINHAS_PADRAO: Linha[] = [
    ['03/08/2026', 'TED RECEBIDA MACDON', 'MACDON BRASIL', '20.440.034/0001-04', 17804.86, ''],
    ['03/08/2026', 'PIX RECEBIDO MULTILO', 'MULTILOG S/A', '78.614.229/0001-03', 2690.04, ''],
    ['03/08/2026', 'BOLETO PAGO INTERNACIONA', 'INTERNACIONAL', '36.364.875/0001-10', -690.0, ''],
    ['03/08/2026', 'SISCOMEX PROT 3588', '', '', -12837.08, ''],
    ['03/08/2026', 'RECEBIMENTOS PYRRHA', 'PYRRHA IMPORTACAO', '48.743.773/0001-94', 196636.42, ''],
];

const construirExtrato = async (linhas: Linha[] = LINHAS_PADRAO): Promise<Buffer> => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Extrato');
    ws.addRow(['Agência:', '0641']);
    ws.addRow(['Conta:', '0055795-4']);
    ws.addRow(['Periodo:', '03/08/2026 até 03/08/2026']);
    ws.addRow(['Data', 'Lançamento', 'Razão social', 'CPF/CNPJ', 'Valor (R$)', 'Saldo (R$)']);
    ws.addRow(['02/08/2026', 'SALDO ANTERIOR', '', '', '', 573557.05]);
    for (const l of linhas) ws.addRow(l);
    ws.addRow(['03/08/2026', 'SALDO EM CONTA CORRENTE', '', '', '', 1551849.73]);
    return Buffer.from(await wb.xlsx.writeBuffer());
};

interface Mocks {
    transacaoRepo: jest.Mocked<Pick<TransacaoRepository, 'upsertMany' | 'existingNaturalKeys'>>;
    runRepo: jest.Mocked<
        Pick<
            RecebimentoIngestaoRunRepository,
            'createRun' | 'finishRun' | 'findRunIdByIdempotencyKey' | 'recordIdempotencyKey'
        >
    >;
    db: { withAdvisoryLock: jest.Mock };
    logService: { info: jest.Mock };
}

const build = (over: Partial<Mocks> = {}) => {
    const mocks: Mocks = {
        transacaoRepo: {
            upsertMany: jest.fn().mockResolvedValue({ inseridas: 3, deduplicadas: 0 }),
            existingNaturalKeys: jest.fn().mockResolvedValue(new Set<string>()),
        },
        runRepo: {
            createRun: jest.fn().mockResolvedValue('11111111-1111-1111-1111-111111111111'),
            finishRun: jest.fn().mockResolvedValue(undefined),
            findRunIdByIdempotencyKey: jest.fn().mockResolvedValue(null),
            recordIdempotencyKey: jest.fn().mockResolvedValue(undefined),
        },
        // default: adquire o lock e roda `onAcquired`.
        db: { withAdvisoryLock: jest.fn((_key, onAcquired) => onAcquired()) },
        logService: { info: jest.fn().mockResolvedValue(undefined) },
        ...over,
    };

    const service = new ImportacaoExtratoArquivoService(
        new BradescoExtratoParser(),
        mocks.transacaoRepo as unknown as TransacaoRepository,
        mocks.runRepo as unknown as RecebimentoIngestaoRunRepository,
        mocks.db as unknown as PostgreeDatabaseClient,
        mocks.logService as unknown as LogService,
    );
    return { service, mocks };
};

const capturarTransacoes = (mocks: Mocks): TransacaoBancaria[] =>
    mocks.transacaoRepo.upsertMany.mock.calls[0]?.[0] ?? [];

describe('ImportacaoExtratoArquivoService.importar', () => {
    it('importa SÓ créditos (valor > 0), ignorando débitos e marcadores', async () => {
        const { service, mocks } = build();
        const result = await service.importar({
            buffer: await construirExtrato(),
            arquivoNome: 'extrato.xlsx',
            filCod: 1,
            triggeredBy: 'ana@columbia',
        });

        const transacoes = capturarTransacoes(mocks);
        expect(transacoes).toHaveLength(3); // 3 créditos, 2 débitos ignorados
        expect(transacoes.every((t) => t.tipo === TRANSACAO_TIPO.CREDITO)).toBe(true);
        expect(transacoes.every((t) => t.valor > 0)).toBe(true);
        expect(transacoes.every((t) => t.canal === 'xlsx_bradesco')).toBe(true);
        expect(transacoes.every((t) => t.filCod === 1)).toBe(true);
        expect(result.totalCreditos).toBe(3);
        expect(mocks.runRepo.finishRun).toHaveBeenCalledWith(
            expect.objectContaining({ status: 'success', totalLidas: 3 }),
        );
    });

    it('gera chaves naturais determinísticas — re-upload de período sobreposto deduplica', async () => {
        const buffer = await construirExtrato();
        const primeira = build();
        await primeira.service.importar({
            buffer,
            arquivoNome: 'a.xlsx',
            filCod: 1,
            triggeredBy: 'x',
        });
        const segunda = build();
        await segunda.service.importar({
            buffer,
            arquivoNome: 'a.xlsx',
            filCod: 1,
            triggeredBy: 'x',
        });

        const chaves1 = capturarTransacoes(primeira.mocks).map((t) => t.naturalKey);
        const chaves2 = capturarTransacoes(segunda.mocks).map((t) => t.naturalKey);
        expect(chaves2).toEqual(chaves1); // mesmas chaves → ON CONFLICT dedupica no banco
        expect(chaves1.every((k) => k.startsWith('xlsx-bradesco:'))).toBe(true);
    });

    it('duplicata legítima: dois créditos idênticos no mesmo dia viram 2 linhas (ocorrência)', async () => {
        const doisIguais: Linha[] = [
            ['03/08/2026', 'PIX RECEBIDO ACME', 'ACME', '11.111.111/0001-11', 100.0, ''],
            ['03/08/2026', 'PIX RECEBIDO ACME', 'ACME', '11.111.111/0001-11', 100.0, ''],
        ];
        const { service, mocks } = build();
        await service.importar({
            buffer: await construirExtrato(doisIguais),
            arquivoNome: 'dup.xlsx',
            filCod: 1,
            triggeredBy: 'x',
        });
        const chaves = capturarTransacoes(mocks).map((t) => t.naturalKey);
        expect(chaves).toHaveLength(2);
        expect(new Set(chaves).size).toBe(2); // ocorrências 1 e 2 → chaves distintas
    });

    it('idempotência de arquivo: mesmo hash → reaproveita a run e NÃO reescreve', async () => {
        const { service, mocks } = build({
            runRepo: {
                createRun: jest.fn(),
                finishRun: jest.fn(),
                findRunIdByIdempotencyKey: jest.fn().mockResolvedValue('run-anterior'),
                recordIdempotencyKey: jest.fn(),
            } as Mocks['runRepo'],
        });
        const result = await service.importar({
            buffer: await construirExtrato(),
            arquivoNome: 'extrato.xlsx',
            filCod: 1,
            triggeredBy: 'x',
        });
        expect(result).toEqual(
            expect.objectContaining({ runId: 'run-anterior', reaproveitada: true }),
        );
        expect(mocks.db.withAdvisoryLock).not.toHaveBeenCalled();
        expect(mocks.transacaoRepo.upsertMany).not.toHaveBeenCalled();
    });

    it('lock ocupado → IngestLockBusyError (409)', async () => {
        const { service } = build({
            db: { withAdvisoryLock: jest.fn((_key, _onAcquired, onBusy) => onBusy()) },
        });
        await expect(
            service.importar({
                buffer: await construirExtrato(),
                arquivoNome: 'extrato.xlsx',
                filCod: 1,
                triggeredBy: 'x',
            }),
        ).rejects.toBeInstanceOf(IngestLockBusyError);
    });

    it('excluirLinhas: importa só os créditos não excluídos, ocorrência calculada sobre o total', async () => {
        const doisIguais: Linha[] = [
            ['03/08/2026', 'PIX RECEBIDO ACME', 'ACME', '11.111.111/0001-11', 100.0, ''],
            ['03/08/2026', 'PIX RECEBIDO ACME', 'ACME', '11.111.111/0001-11', 100.0, ''],
        ];
        // Baseline sem exclusão: captura as chaves das duas ocorrências.
        const baseline = build();
        await baseline.service.importar({
            buffer: await construirExtrato(doisIguais),
            arquivoNome: 'dup.xlsx',
            filCod: 1,
            triggeredBy: 'x',
        });
        const chavesBaseline = capturarTransacoes(baseline.mocks).map((t) => t.naturalKey);

        // Linha 6 é a primeira ocorrência (linha 1 = cabeçalho de agência, ... linha 5 = header da
        // grade); exclui-a e mantém só a segunda ocorrência.
        const { service, mocks } = build();
        const result = await service.importar({
            buffer: await construirExtrato(doisIguais),
            arquivoNome: 'dup.xlsx',
            filCod: 1,
            triggeredBy: 'x',
            excluirLinhas: [6],
        });

        const transacoes = capturarTransacoes(mocks);
        expect(transacoes).toHaveLength(1);
        // A ocorrência remanescente preserva a MESMA naturalKey que tinha no baseline (ocorrência 2),
        // não é recalculada como se fosse a única linha (o que a tornaria ocorrência 1).
        expect(transacoes[0]?.naturalKey).toBe(chavesBaseline[1]);
        expect(result.reaproveitada).toBe(false);
    });

    it('excluirLinhas muda a chave de idempotência — reenviar com outra seleção não é "reaproveitada"', async () => {
        const buffer = await construirExtrato();
        const primeira = build();
        const r1 = await primeira.service.importar({
            buffer,
            arquivoNome: 'a.xlsx',
            filCod: 1,
            triggeredBy: 'x',
        });
        expect(r1.reaproveitada).toBe(false);

        const segunda = build();
        const r2 = await segunda.service.importar({
            buffer,
            arquivoNome: 'a.xlsx',
            filCod: 1,
            triggeredBy: 'x',
            excluirLinhas: [6],
        });
        expect(r2.reaproveitada).toBe(false);
        expect(capturarTransacoes(segunda.mocks)).toHaveLength(2); // 3 créditos - 1 excluído
    });

    it('erro no upsert → run finaliza como error e o erro propaga (nada mascarado)', async () => {
        const { service, mocks } = build({
            transacaoRepo: {
                upsertMany: jest.fn().mockRejectedValue(new Error('db down')),
                existingNaturalKeys: jest.fn().mockResolvedValue(new Set<string>()),
            },
        });
        await expect(
            service.importar({
                buffer: await construirExtrato(),
                arquivoNome: 'extrato.xlsx',
                filCod: 1,
                triggeredBy: 'x',
            }),
        ).rejects.toThrow('db down');
        expect(mocks.runRepo.finishRun).toHaveBeenCalledWith(
            expect.objectContaining({ status: 'error' }),
        );
    });
});

describe('ImportacaoExtratoArquivoService.preview', () => {
    it('classifica novos × já importados sem escrever nada', async () => {
        const buffer = await construirExtrato();
        // Pré-computa as chaves para marcar UMA como já existente.
        const capture = build();
        await capture.service.importar({
            buffer,
            arquivoNome: 'x.xlsx',
            filCod: 1,
            triggeredBy: 'x',
        });
        const chaves = capturarTransacoes(capture.mocks).map((t) => t.naturalKey);

        const { service, mocks } = build({
            transacaoRepo: {
                upsertMany: jest.fn(),
                existingNaturalKeys: jest.fn().mockResolvedValue(new Set([chaves[0]])),
            },
        });
        const preview = await service.preview({ buffer, arquivoNome: 'x.xlsx', filCod: 1 });

        expect(preview.totalCreditos).toBe(3);
        expect(preview.totalIgnorados).toBe(2);
        expect(preview.novos).toBe(2);
        expect(preview.jaImportados).toBe(1);
        expect(preview.cabecalho.agencia).toBe('0641');
        expect(mocks.transacaoRepo.upsertMany).not.toHaveBeenCalled();
        expect(mocks.runRepo.createRun).not.toHaveBeenCalled();
    });
});
