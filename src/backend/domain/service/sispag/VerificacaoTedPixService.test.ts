import 'reflect-metadata';
import type ConexosSispagClient from '../../client/ConexosSispagClient.js';
import type PostgreeDatabaseClient from '../../client/database/PostgreeDatabaseClient.js';
import type { PayeeCheckResult } from '../../interface/sispag/AuthorizedPayeeInterface.js';
import type {
    AlertaItemLote,
    DuplicateCandidate,
    ItemLote,
    LotePagamento,
} from '../../interface/sispag/SispagInterface.js';
import type EnvironmentProvider from '../../libs/environment/EnvironmentProvider.js';
import { SISPAG_VERIFICACAO_DEFAULT } from '../../libs/environment/model/EnvironmentVars.js';
import type AlertaItemLoteRepository from '../../repository/sispag/AlertaItemLoteRepository.js';
import type LotePagamentoRepository from '../../repository/sispag/LotePagamentoRepository.js';
import type LogService from '../LogService.js';
import type AuthorizedPayeeService from './AuthorizedPayeeService.js';
import type DestinoPagamentoResolver from './DestinoPagamentoResolver.js';
import DuplicateDetector from './DuplicateDetector.js';
import VerificacaoTedPixService from './VerificacaoTedPixService.js';

/**
 * verificarItensTedPix (ADR-0063 I13, reescrito pela ADR-0065). Tudo mockado: Conexos (fin064 via
 * client), a guarda do favorecido autorizado (`AuthorizedPayeeService`), banco e log. O detector de
 * duplicidade é o real (puro).
 */

const DIA = 86_400_000;
const VENC = Date.UTC(2026, 9, 20);
const AVISO = { modo: 'AVISO' as const };
const RETIRAR = { modo: 'RETIRAR' as const };

const item = (over: Partial<ItemLote> = {}): ItemLote => ({
    loteId: 'L1',
    filCod: 4,
    docCod: '6173',
    titCod: '1',
    credor: 'FORNECEDOR A',
    valor: 100,
    modalidade: 'TED',
    incluidoPor: 'ana',
    divergencia: false,
    ...over,
});

const lote = (itens: ItemLote[], over: Partial<LotePagamento> = {}): LotePagamento => ({
    id: 'L1',
    filCod: 4,
    status: 'RASCUNHO',
    criadoPor: 'ana',
    versao: 3,
    automatico: true,
    itens,
    ...over,
});

const fin064 = (over: Partial<DuplicateCandidate> = {}): DuplicateCandidate => ({
    filCod: 4,
    docCod: '6173',
    titCod: '1',
    favorecido: '90001',
    credor: 'FORNECEDOR A',
    numeroNota: '45871',
    valorCentavos: 10_000,
    vencimento: VENC,
    pago: false,
    ...over,
});

const viva = (over: Partial<AlertaItemLote> = {}): AlertaItemLote => ({
    id: 'A1',
    loteId: 'L1',
    filCod: 4,
    docCod: '6173',
    titCod: '1',
    tipo: 'DUPLICIDADE_FORTE',
    contraparteFilCod: 4,
    contraparteDocCod: '6702',
    evidencia: {},
    estado: 'ABERTA',
    criadoEm: '2026-10-05T10:00:00.000Z',
    verificadoEm: '2026-10-05T10:00:00.000Z',
    ...over,
});

const build = (
    opts: {
        lote?: LotePagamento;
        titulos?: DuplicateCandidate[] | Error;
        /** Resultado da guarda I14 por `pesCod:modalidade`; default OK. */
        guarda?: Record<string, PayeeCheckResult>;
        vivas?: AlertaItemLote[];
    } = {},
) => {
    const tx = { tx: true };
    const loteRepo = {
        getLoteComItens: jest.fn().mockResolvedValue(opts.lote ?? lote([item()])),
        marcarVerificacaoItem: jest.fn().mockResolvedValue(1),
        limparVerificacaoItem: jest.fn().mockResolvedValue(1),
        removerItemPeloSistema: jest.fn().mockResolvedValue(true),
        marcarManual: jest.fn(),
    };
    const alertaRepo = {
        listVivasDoItem: jest.fn().mockResolvedValue(opts.vivas ?? []),
        criar: jest.fn().mockResolvedValue('NOVA'),
        confirmar: jest.fn().mockResolvedValue(undefined),
        fechar: jest.fn().mockResolvedValue(true),
        descartarDoItem: jest.fn().mockResolvedValue(0),
    };
    const titulos = opts.titulos ?? [fin064()];
    const sispag = {
        listTitulosParaDuplicidade: jest.fn(async () => {
            if (titulos instanceof Error) throw titulos;
            return titulos;
        }),
    };
    const resolver = { novoCache: jest.fn(() => new Map()) };
    const payees = {
        verificarDestinoAutorizado: jest.fn(
            async (pares: Array<{ pesCod: string; modalidade: string }>) =>
                new Map(
                    pares.map((p) => {
                        const k = `${p.pesCod}:${p.modalidade}`;
                        return [
                            k,
                            {
                                resultado: opts.guarda?.[k] ?? 'OK',
                                autorizacaoId: 'AUT-1',
                                destinoMascarado: 'banco 341 · ag. 0641 · cc ****7766-5',
                            },
                        ];
                    }),
                ),
        ),
    };
    const env = {
        getEnvironmentVars: jest.fn().mockResolvedValue({
            sispagVerificacao: { ...SISPAG_VERIFICACAO_DEFAULT },
        }),
    };
    const db = { withTransaction: jest.fn(async (fn: (t: unknown) => unknown) => fn(tx)) };
    const logService = { info: jest.fn(), warn: jest.fn() };
    const service = new VerificacaoTedPixService(
        loteRepo as unknown as LotePagamentoRepository,
        alertaRepo as unknown as AlertaItemLoteRepository,
        sispag as unknown as ConexosSispagClient,
        resolver as unknown as DestinoPagamentoResolver,
        payees as unknown as AuthorizedPayeeService,
        new DuplicateDetector(),
        env as unknown as EnvironmentProvider,
        db as unknown as PostgreeDatabaseClient,
        logService as unknown as LogService,
    );
    return { service, loteRepo, alertaRepo, sispag, payees, logService, tx };
};

describe('VerificacaoTedPixService — alcance (I13a)', () => {
    it('ignora BOLETO, "a definir" e CRÉDITO EM CONTA; item TED verificado vira OK com o selo', async () => {
        const h = build({
            lote: lote([
                item(),
                item({ docCod: '1', modalidade: 'BOLETO' }),
                item({ docCod: '2', modalidade: undefined }),
                item({ docCod: '3', modalidade: 'CREDITO_CONTA' }),
            ]),
        });
        const r = await h.service.verificarItens('L1', AVISO);
        expect(r.verificados.map((i) => i.docCod)).toEqual(['6173']);
        expect(h.payees.verificarDestinoAutorizado).toHaveBeenCalledTimes(1);
        expect(h.payees.verificarDestinoAutorizado.mock.calls[0]?.[0]).toEqual([
            { pesCod: '90001', modalidade: 'TED', filCod: 4 },
        ]);
        expect(h.loteRepo.marcarVerificacaoItem).toHaveBeenCalledWith(
            expect.objectContaining({
                docCod: '6173',
                estado: 'OK',
                autorizacaoAviso: 'OK',
                destinoMascarado: 'banco 341 · ag. 0641 · cc ****7766-5',
            }),
            h.tx,
        );
    });

    it('com `itens`, verifica só aquele item', async () => {
        const h = build({
            lote: lote([item(), item({ docCod: '6174', modalidade: 'PIX' })]),
            titulos: [fin064(), fin064({ docCod: '6174', numeroNota: '9' })],
        });
        const r = await h.service.verificarItens('L1', {
            itens: [{ filCod: 4, docCod: '6174', titCod: '1' }],
            modo: 'AVISO',
        });
        expect(r.verificados.map((i) => i.docCod)).toEqual(['6174']);
    });

    it('lote fora de RASCUNHO não é verificado', async () => {
        const h = build({ lote: lote([item()], { status: 'FINALIZADO' }) });
        expect(await h.service.verificarItens('L1', RETIRAR)).toEqual({
            verificados: [],
            pendentes: [],
            retirados: [],
            avisos: [],
        });
        expect(h.sispag.listTitulosParaDuplicidade).not.toHaveBeenCalled();
    });

    it('lê o fin064 da filial UMA vez por rodada, a partir da data configurada', async () => {
        const h = build({
            lote: lote([item(), item({ docCod: '6174' })]),
            titulos: [fin064(), fin064({ docCod: '6174', numeroNota: '1' })],
        });
        await h.service.verificarItens('L1', AVISO);
        expect(h.sispag.listTitulosParaDuplicidade).toHaveBeenCalledTimes(1);
        expect(h.sispag.listTitulosParaDuplicidade).toHaveBeenCalledWith(
            4,
            SISPAG_VERIFICACAO_DEFAULT.duplicidadeDesde,
        );
    });
});

describe('VerificacaoTedPixService — favorecido autorizado (ADR-0065 I14e)', () => {
    it('modo AVISO: favorecido não autorizado NÃO é retirado; fica com o selo e a duplicidade roda', async () => {
        const h = build({ guarda: { '90001:TED': 'FAVORECIDO_NAO_AUTORIZADO' } });
        const r = await h.service.verificarItens('L1', AVISO);
        expect(r.retirados).toEqual([]);
        expect(r.avisos).toEqual([
            expect.objectContaining({ docCod: '6173', aviso: 'FAVORECIDO_NAO_AUTORIZADO' }),
        ]);
        expect(h.loteRepo.removerItemPeloSistema).not.toHaveBeenCalled();
        expect(h.loteRepo.marcarVerificacaoItem).toHaveBeenCalledWith(
            expect.objectContaining({
                estado: 'OK',
                autorizacaoAviso: 'FAVORECIDO_NAO_AUTORIZADO',
            }),
            h.tx,
        );
        expect(h.alertaRepo.listVivasDoItem).toHaveBeenCalled();
    });

    it.each([
        'SEM_DADO_PAGAMENTO',
        'FAVORECIDO_NAO_AUTORIZADO',
        'DESTINO_ALTERADO',
    ] as const)('modo RETIRAR: %s → item sai (sistema), com o motivo, alertas descartadas', async (motivo) => {
        const h = build({ guarda: { '90001:TED': motivo } });
        const r = await h.service.verificarItens('L1', RETIRAR);
        expect(r.retirados).toEqual([expect.objectContaining({ docCod: '6173', motivo })]);
        expect(h.loteRepo.removerItemPeloSistema).toHaveBeenCalledWith(
            { loteId: 'L1', filCod: 4, docCod: '6173', titCod: '1', motivo },
            h.tx,
        );
        expect(h.alertaRepo.descartarDoItem).toHaveBeenCalledWith(
            'L1',
            { filCod: 4, docCod: '6173', titCod: '1' },
            'sistema',
            h.tx,
        );
        expect(h.loteRepo.marcarManual).not.toHaveBeenCalled();
    });

    it('uma chamada à guarda para todos os itens TED/PIX do lote', async () => {
        const h = build({
            lote: lote([item(), item({ docCod: '6174', modalidade: 'PIX' })]),
            titulos: [fin064(), fin064({ docCod: '6174', numeroNota: '2' })],
        });
        await h.service.verificarItens('L1', RETIRAR);
        expect(h.payees.verificarDestinoAutorizado).toHaveBeenCalledTimes(1);
        expect(h.payees.verificarDestinoAutorizado.mock.calls[0]?.[0]).toHaveLength(2);
    });
});

describe('VerificacaoTedPixService — falha fechada (I13b, I14f)', () => {
    const semEfeito = (h: ReturnType<typeof build>) => {
        expect(h.alertaRepo.criar).not.toHaveBeenCalled();
        expect(h.alertaRepo.fechar).not.toHaveBeenCalled();
        expect(h.alertaRepo.descartarDoItem).not.toHaveBeenCalled();
        expect(h.loteRepo.removerItemPeloSistema).not.toHaveBeenCalled();
    };

    it('fin064 falha → PENDENTE, nada criado, fechado ou retirado', async () => {
        const h = build({ titulos: new Error('HTTP 500'), vivas: [viva()] });
        const r = await h.service.verificarItens('L1', RETIRAR);
        expect(r.pendentes.map((i) => i.docCod)).toEqual(['6173']);
        expect(h.loteRepo.marcarVerificacaoItem).toHaveBeenCalledWith(
            expect.objectContaining({ estado: 'PENDENTE' }),
        );
        semEfeito(h);
    });

    it('cadastro com FALHA_LEITURA → PENDENTE, sem retirar nem no modo RETIRAR', async () => {
        const h = build({ guarda: { '90001:TED': 'FALHA_LEITURA' }, vivas: [viva()] });
        const r = await h.service.verificarItens('L1', RETIRAR);
        expect(r.pendentes).toHaveLength(1);
        expect(r.retirados).toHaveLength(0);
        semEfeito(h);
    });

    it('título não encontrado no fin064 → PENDENTE (não decide por ausência)', async () => {
        const h = build({ titulos: [fin064({ docCod: '9999' })] });
        expect((await h.service.verificarItens('L1', RETIRAR)).pendentes).toHaveLength(1);
        semEfeito(h);
    });

    it('título sem favorecido → PENDENTE', async () => {
        const h = build({ titulos: [fin064({ favorecido: undefined })] });
        expect((await h.service.verificarItens('L1', RETIRAR)).pendentes).toHaveLength(1);
        semEfeito(h);
    });
});

describe('VerificacaoTedPixService — duplicidade e re-verificação (I13c–h)', () => {
    const DUPLA = [fin064(), fin064({ docCod: '6702', pago: true })];

    it('contraparte nova → alerta FORTE ABERTA, ator sistema', async () => {
        const h = build({ titulos: DUPLA });
        await h.service.verificarItens('L1', AVISO);
        expect(h.alertaRepo.criar).toHaveBeenCalledWith(
            expect.objectContaining({
                tipo: 'DUPLICIDADE_FORTE',
                contraparteFilCod: 4,
                contraparteDocCod: '6702',
            }),
            'sistema',
            h.tx,
        );
    });

    it('mesma contraparte e tipo mantém a alerta (e a justificativa) — só confirma', async () => {
        const h = build({
            titulos: DUPLA,
            vivas: [viva({ estado: 'RESOLVIDA', resolucao: 'JUSTIFICADA', justificativa: 'ok' })],
        });
        await h.service.verificarItens('L1', AVISO);
        expect(h.alertaRepo.confirmar).toHaveBeenCalledWith('A1', expect.anything(), h.tx);
        expect(h.alertaRepo.criar).not.toHaveBeenCalled();
        expect(h.alertaRepo.fechar).not.toHaveBeenCalled();
    });

    it('contraparte que sumiu → OBSOLETA', async () => {
        const h = build({ titulos: [fin064()], vivas: [viva()] });
        await h.service.verificarItens('L1', AVISO);
        expect(h.alertaRepo.fechar).toHaveBeenCalledWith(
            expect.objectContaining({ id: 'A1' }),
            'OBSOLETA',
            'sistema',
            h.tx,
        );
    });

    it('contraparte nova ao lado de uma já justificada → só a nova é criada', async () => {
        const h = build({
            titulos: [...DUPLA, fin064({ docCod: '6800' })],
            vivas: [viva({ estado: 'RESOLVIDA', resolucao: 'JUSTIFICADA', justificativa: 'ok' })],
        });
        await h.service.verificarItens('L1', AVISO);
        expect(h.alertaRepo.criar).toHaveBeenCalledTimes(1);
        expect(h.alertaRepo.criar.mock.calls[0]?.[0]).toMatchObject({ contraparteDocCod: '6800' });
    });

    it('a busca usa a janela FRACA do tenant', async () => {
        const h = build({
            titulos: [
                fin064({ numeroNota: '' }),
                fin064({ docCod: '7', numeroNota: '', vencimento: VENC + 16 * DIA }),
            ],
        });
        await h.service.verificarItens('L1', AVISO);
        expect(h.alertaRepo.criar).not.toHaveBeenCalled();
    });
});

describe('VerificacaoTedPixService — logs (ADR-0042, I10h)', () => {
    it('mensagens em português', async () => {
        const cenarios: Array<Record<string, PayeeCheckResult>> = [
            {},
            { '90001:TED': 'SEM_DADO_PAGAMENTO' },
            { '90001:TED': 'FALHA_LEITURA' },
        ];
        for (const guarda of cenarios) {
            const h = build({ guarda });
            await h.service.verificarItens('L1', RETIRAR);
            const chamadas = [...h.logService.info.mock.calls, ...h.logService.warn.mock.calls];
            expect(chamadas.length).toBeGreaterThan(0);
            for (const [params] of chamadas) expect(params.message).toMatch(/verificação/);
        }
    });
});

describe('VerificacaoTedPixService.descartarVerificacao (I13a)', () => {
    it('descarta as alertas vivas do item e limpa o estado, numa transação', async () => {
        const h = build();
        await h.service.descartarVerificacao(
            'L1',
            { filCod: 4, docCod: '6173', titCod: '1' },
            'ana',
        );
        expect(h.alertaRepo.descartarDoItem).toHaveBeenCalledWith(
            'L1',
            { filCod: 4, docCod: '6173', titCod: '1' },
            'ana',
            h.tx,
        );
        expect(h.loteRepo.limparVerificacaoItem).toHaveBeenCalledWith(
            { loteId: 'L1', filCod: 4, docCod: '6173', titCod: '1' },
            h.tx,
        );
    });
});
