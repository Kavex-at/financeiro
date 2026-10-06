import 'reflect-metadata';
import type ConexosSispagClient from '../../client/ConexosSispagClient.js';
import type PostgreeDatabaseClient from '../../client/database/PostgreeDatabaseClient.js';
import type {
    AlertaItemLote,
    ChannelProfile,
    DuplicateCandidate,
    ItemLote,
    LotePagamento,
} from '../../interface/sispag/SispagInterface.js';
import type EnvironmentProvider from '../../libs/environment/EnvironmentProvider.js';
import { SISPAG_VERIFICACAO_DEFAULT } from '../../libs/environment/model/EnvironmentVars.js';
import type AlertaItemLoteRepository from '../../repository/sispag/AlertaItemLoteRepository.js';
import type LotePagamentoRepository from '../../repository/sispag/LotePagamentoRepository.js';
import type PendenciaCadastroRepository from '../../repository/sispag/PendenciaCadastroRepository.js';
import type PerfilCanalFornecedorRepository from '../../repository/sispag/PerfilCanalFornecedorRepository.js';
import type LogService from '../LogService.js';
import type DestinoPagamentoResolver from './DestinoPagamentoResolver.js';
import { DESTINO_ORIGEM, type DestinoResolvido } from './DestinoPagamentoResolver.js';
import DuplicateDetector from './DuplicateDetector.js';
import VerificacaoTedPixService from './VerificacaoTedPixService.js';

/**
 * verificarItensTedPix (ADR-0063, I13a–k). Tudo mockado: Conexos (fin064 via client, cmn025 via o
 * resolver), banco e log. O detector de duplicidade é o real (puro).
 */

const DIA = 86_400_000;
const VENC = Date.UTC(2026, 9, 20);
const CONTA_COMPLETA = '99887766';

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

const CADASTRO: DestinoResolvido = {
    origem: DESTINO_ORIGEM.CADASTRO,
    tipo: 'CONTA',
    conta: {
        banco: 341,
        agencia: '0641',
        conta: CONTA_COMPLETA,
        contaDv: '5',
        padrao: true,
    } as never,
};
const EXCECAO: DestinoResolvido = {
    origem: DESTINO_ORIGEM.EXCECAO,
    excecaoId: 'E1',
    destino: {
        tipo: 'CHAVE_PIX',
        chavePixTipo: 'CPF_CNPJ',
        chavePix: '11144477735',
        titularDocumento: '11144477735',
    },
};
const NENHUM: DestinoResolvido = { origem: DESTINO_ORIGEM.NENHUM };

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

const perfil = (over: Partial<ChannelProfile> = {}): ChannelProfile => ({
    pesCod: '90001',
    contagens: { BOLETO: 10, TED_PIX: 0, OUTROS: 0 },
    pagamentosUnicos: 10,
    mesesDistintos: 5,
    grupoDominante: 'BOLETO',
    participacao: 1,
    confianca: 'ALTA',
    janelaInicio: 0,
    janelaFim: 1,
    ...over,
});

const build = (
    opts: {
        lote?: LotePagamento;
        titulos?: DuplicateCandidate[] | Error;
        destino?: DestinoResolvido | Error;
        vivas?: AlertaItemLote[];
        perfil?: ChannelProfile | null;
        flags?: { ted?: boolean; pix?: boolean; excecao?: boolean };
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
    const pendenciaRepo = {
        abrirOuAcrescentar: jest.fn().mockResolvedValue({ pendenciaId: 'P1', aberta: true }),
        resolverDoFavorecido: jest.fn().mockResolvedValue(0),
    };
    const perfilRepo = {
        findByPesCod: jest.fn().mockResolvedValue(opts.perfil ?? null),
    };
    const titulos = opts.titulos ?? [fin064()];
    const sispag = {
        listTitulosParaDuplicidade: jest.fn(async () => {
            if (titulos instanceof Error) throw titulos;
            return titulos;
        }),
    };
    const destino = opts.destino ?? CADASTRO;
    const resolver = {
        novoCache: jest.fn(() => new Map()),
        resolve: jest.fn(async () => {
            if (destino instanceof Error) throw destino;
            return destino;
        }),
        mascarar: jest.fn((d: DestinoResolvido) =>
            d.origem === DESTINO_ORIGEM.NENHUM ? undefined : '341 / ****-5',
        ),
    };
    const flags = { ted: true, pix: true, excecao: true, ...opts.flags };
    const env = {
        getEnvironmentVars: jest.fn().mockResolvedValue({
            sispagTedEnabled: flags.ted,
            sispagPixEnabled: flags.pix,
            sispagExcecaoDestinoEnabled: flags.excecao,
            sispagVerificacao: { ...SISPAG_VERIFICACAO_DEFAULT },
        }),
    };
    const db = { withTransaction: jest.fn(async (fn: (t: unknown) => unknown) => fn(tx)) };
    const logService = { info: jest.fn(), warn: jest.fn() };
    const service = new VerificacaoTedPixService(
        loteRepo as unknown as LotePagamentoRepository,
        alertaRepo as unknown as AlertaItemLoteRepository,
        pendenciaRepo as unknown as PendenciaCadastroRepository,
        perfilRepo as unknown as PerfilCanalFornecedorRepository,
        sispag as unknown as ConexosSispagClient,
        resolver as unknown as DestinoPagamentoResolver,
        new DuplicateDetector(),
        env as unknown as EnvironmentProvider,
        db as unknown as PostgreeDatabaseClient,
        logService as unknown as LogService,
    );
    return {
        service,
        loteRepo,
        alertaRepo,
        pendenciaRepo,
        perfilRepo,
        sispag,
        resolver,
        logService,
        tx,
    };
};

describe('VerificacaoTedPixService — alcance (I13a)', () => {
    it('ignora BOLETO, "a definir" e CRÉDITO EM CONTA; item TED verificado vira OK', async () => {
        const h = build({
            lote: lote([
                item(),
                item({ docCod: '1', modalidade: 'BOLETO' }),
                item({ docCod: '2', modalidade: undefined }),
                item({ docCod: '3', modalidade: 'CREDITO_CONTA' }),
            ]),
        });
        const r = await h.service.verificarItens('L1');
        expect(r.verificados.map((i) => i.docCod)).toEqual(['6173']);
        expect(h.resolver.resolve).toHaveBeenCalledTimes(1);
        expect(h.loteRepo.marcarVerificacaoItem).toHaveBeenCalledWith(
            expect.objectContaining({
                docCod: '6173',
                estado: 'OK',
                destinoOrigem: 'CADASTRO',
                destinoMascarado: '341 / ****-5',
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
        });
        expect(r.verificados.map((i) => i.docCod)).toEqual(['6174']);
    });

    it('lote fora de RASCUNHO não é verificado', async () => {
        const h = build({ lote: lote([item()], { status: 'FINALIZADO' }) });
        expect(await h.service.verificarItens('L1')).toEqual({
            verificados: [],
            pendentes: [],
            retirados: [],
        });
        expect(h.sispag.listTitulosParaDuplicidade).not.toHaveBeenCalled();
    });

    it('lê o fin064 da filial UMA vez por rodada, a partir da data configurada', async () => {
        const h = build({
            lote: lote([item(), item({ docCod: '6174' })]),
            titulos: [fin064(), fin064({ docCod: '6174', numeroNota: '1' })],
        });
        await h.service.verificarItens('L1');
        expect(h.sispag.listTitulosParaDuplicidade).toHaveBeenCalledTimes(1);
        expect(h.sispag.listTitulosParaDuplicidade).toHaveBeenCalledWith(
            4,
            SISPAG_VERIFICACAO_DEFAULT.duplicidadeDesde,
        );
    });
});

describe('VerificacaoTedPixService — falha fechada (I13b)', () => {
    const semEfeito = (h: ReturnType<typeof build>) => {
        expect(h.alertaRepo.criar).not.toHaveBeenCalled();
        expect(h.alertaRepo.fechar).not.toHaveBeenCalled();
        expect(h.alertaRepo.descartarDoItem).not.toHaveBeenCalled();
        expect(h.loteRepo.removerItemPeloSistema).not.toHaveBeenCalled();
        expect(h.pendenciaRepo.abrirOuAcrescentar).not.toHaveBeenCalled();
        expect(h.pendenciaRepo.resolverDoFavorecido).not.toHaveBeenCalled();
    };

    it('fin064 falha → PENDENTE, nada criado, fechado, retirado ou aberto', async () => {
        const h = build({ titulos: new Error('HTTP 500'), vivas: [viva()] });
        const r = await h.service.verificarItens('L1');
        expect(r.pendentes.map((i) => i.docCod)).toEqual(['6173']);
        expect(h.loteRepo.marcarVerificacaoItem).toHaveBeenCalledWith(
            expect.objectContaining({ estado: 'PENDENTE' }),
        );
        semEfeito(h);
    });

    it('cmn025 falha (resolver lança) → PENDENTE, sem retirar nem abrir pendência', async () => {
        const h = build({ destino: new Error('cmn025 timeout'), vivas: [viva()] });
        const r = await h.service.verificarItens('L1');
        expect(r.pendentes).toHaveLength(1);
        semEfeito(h);
    });

    it('título não encontrado no fin064 → PENDENTE (não decide por ausência)', async () => {
        const h = build({ titulos: [fin064({ docCod: '9999' })] });
        expect((await h.service.verificarItens('L1')).pendentes).toHaveLength(1);
        semEfeito(h);
    });

    it('título sem favorecido → PENDENTE', async () => {
        const h = build({ titulos: [fin064({ favorecido: undefined })] });
        expect((await h.service.verificarItens('L1')).pendentes).toHaveLength(1);
        semEfeito(h);
    });
});

describe('VerificacaoTedPixService — duplicidade e re-verificação (I13c–h)', () => {
    const DUPLA = [fin064(), fin064({ docCod: '6702', pago: true })];

    it('contraparte nova → alerta FORTE ABERTA, ator sistema', async () => {
        const h = build({ titulos: DUPLA });
        await h.service.verificarItens('L1');
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
        await h.service.verificarItens('L1');
        expect(h.alertaRepo.confirmar).toHaveBeenCalledWith('A1', expect.anything(), h.tx);
        expect(h.alertaRepo.criar).not.toHaveBeenCalled();
        expect(h.alertaRepo.fechar).not.toHaveBeenCalled();
    });

    it('contraparte que sumiu → OBSOLETA', async () => {
        const h = build({ titulos: [fin064()], vivas: [viva()] });
        await h.service.verificarItens('L1');
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
        await h.service.verificarItens('L1');
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
        await h.service.verificarItens('L1');
        expect(h.alertaRepo.criar).not.toHaveBeenCalled();
    });
});

describe('VerificacaoTedPixService — canal habitual (I13i)', () => {
    it('perfil ALTA com grupo dominante BOLETO → alerta CANAL_HABITUAL', async () => {
        const h = build({ perfil: perfil() });
        await h.service.verificarItens('L1');
        expect(h.perfilRepo.findByPesCod).toHaveBeenCalledWith('90001');
        expect(h.alertaRepo.criar).toHaveBeenCalledWith(
            expect.objectContaining({
                tipo: 'CANAL_HABITUAL',
                evidencia: expect.objectContaining({ grupoDominante: 'BOLETO' }),
            }),
            'sistema',
            h.tx,
        );
    });

    it.each([
        ['sem perfil', null],
        ['perfil MEDIA', perfil({ confianca: 'MEDIA' })],
        ['perfil ALTA de TED_PIX', perfil({ grupoDominante: 'TED_PIX' })],
    ])('%s → nenhuma alerta de canal', async (_n, p) => {
        const h = build({ perfil: p as ChannelProfile | null });
        await h.service.verificarItens('L1');
        expect(h.alertaRepo.criar).not.toHaveBeenCalled();
    });

    it('perfil que deixou de divergir → alerta de canal OBSOLETA', async () => {
        const h = build({
            perfil: perfil({ grupoDominante: 'TED_PIX' }),
            vivas: [
                viva({
                    id: 'C1',
                    tipo: 'CANAL_HABITUAL',
                    contraparteDocCod: undefined,
                    contraparteFilCod: undefined,
                }),
            ],
        });
        await h.service.verificarItens('L1');
        expect(h.alertaRepo.fechar).toHaveBeenCalledWith(
            expect.objectContaining({ id: 'C1' }),
            'OBSOLETA',
            'sistema',
            h.tx,
        );
    });
});

describe('VerificacaoTedPixService — dados de pagamento (I13j, I13k)', () => {
    it('sem cadastro e sem exceção → item SAI (sistema), pendência CONTA para TED, alertas descartadas', async () => {
        const h = build({ destino: NENHUM });
        const r = await h.service.verificarItens('L1');
        expect(r.retirados.map((i) => i.docCod)).toEqual(['6173']);
        expect(h.alertaRepo.descartarDoItem).toHaveBeenCalledWith(
            'L1',
            { filCod: 4, docCod: '6173', titCod: '1' },
            'sistema',
            h.tx,
        );
        expect(h.loteRepo.removerItemPeloSistema).toHaveBeenCalledWith(
            { loteId: 'L1', filCod: 4, docCod: '6173', titCod: '1' },
            h.tx,
        );
        expect(h.pendenciaRepo.abrirOuAcrescentar).toHaveBeenCalledWith(
            expect.objectContaining({ pesCod: '90001', tipo: 'CONTA', desfecho: 'RETIRADO' }),
            h.tx,
        );
        // Item retirado não segue para duplicidade/canal.
        expect(h.perfilRepo.findByPesCod).not.toHaveBeenCalled();
        expect(h.alertaRepo.criar).not.toHaveBeenCalled();
    });

    it('PIX sem chave → pendência CHAVE_PIX', async () => {
        const h = build({ lote: lote([item({ modalidade: 'PIX' })]), destino: NENHUM });
        await h.service.verificarItens('L1');
        expect(h.pendenciaRepo.abrirOuAcrescentar.mock.calls[0]?.[0]).toMatchObject({
            tipo: 'CHAVE_PIX',
        });
    });

    it('retirada pelo sistema NÃO marca o lote automático como manual (Q11)', async () => {
        const h = build({ destino: NENHUM });
        await h.service.verificarItens('L1');
        expect(h.loteRepo.marcarManual).not.toHaveBeenCalled();
    });

    it('com exceção APROVADA → item fica, pendência abre como MANTIDO_POR_EXCECAO', async () => {
        const h = build({ destino: EXCECAO });
        const r = await h.service.verificarItens('L1');
        expect(r.verificados).toHaveLength(1);
        expect(h.loteRepo.removerItemPeloSistema).not.toHaveBeenCalled();
        expect(h.pendenciaRepo.abrirOuAcrescentar).toHaveBeenCalledWith(
            expect.objectContaining({ desfecho: 'MANTIDO_POR_EXCECAO', tipo: 'CONTA' }),
            h.tx,
        );
        expect(h.loteRepo.marcarVerificacaoItem).toHaveBeenCalledWith(
            expect.objectContaining({ destinoOrigem: 'EXCECAO' }),
            h.tx,
        );
    });

    it('cadastro com dado → nada aberto, e a pendência ABERTA do par é resolvida', async () => {
        const h = build({ destino: CADASTRO });
        await h.service.verificarItens('L1');
        expect(h.pendenciaRepo.abrirOuAcrescentar).not.toHaveBeenCalled();
        expect(h.pendenciaRepo.resolverDoFavorecido).toHaveBeenCalledWith('90001', 'CONTA', h.tx);
    });

    it('usa o resolver de I10 com o favorecido do fin064 e repassa aposentarExcecao (finalizar)', async () => {
        const h = build();
        await h.service.verificarItens('L1', { aposentarExcecao: true });
        expect(h.resolver.resolve).toHaveBeenCalledWith(
            { modalidade: 'TED' },
            expect.objectContaining({ filCod: 4, pesCod: '90001', aposentarExcecao: true }),
        );
    });

    it('flag da modalidade desligada: não decide destino (regra de antes), mas verifica duplicidade', async () => {
        const h = build({
            flags: { ted: false },
            titulos: [fin064(), fin064({ docCod: '6702' })],
        });
        const r = await h.service.verificarItens('L1');
        expect(h.resolver.resolve).not.toHaveBeenCalled();
        expect(r.verificados).toHaveLength(1);
        expect(h.alertaRepo.criar).toHaveBeenCalledTimes(1);
    });
});

describe('VerificacaoTedPixService — logs (ADR-0042, I10h)', () => {
    it('mensagens em português e nenhum log carrega conta/chave', async () => {
        for (const destino of [CADASTRO, EXCECAO, NENHUM, new Error(`falhou ${CONTA_COMPLETA}`)]) {
            const h = build({ destino, perfil: perfil() });
            await h.service.verificarItens('L1');
            const chamadas = [...h.logService.info.mock.calls, ...h.logService.warn.mock.calls];
            expect(chamadas.length).toBeGreaterThan(0);
            for (const [params] of chamadas) {
                const texto = JSON.stringify(params);
                expect(texto).not.toContain(CONTA_COMPLETA);
                expect(texto).not.toContain('11144477735');
                expect(params.message).toMatch(/verificação/);
            }
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
