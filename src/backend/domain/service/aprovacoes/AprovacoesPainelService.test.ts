import 'reflect-metadata';
import AprovacaoIdInvalidoError from '../../errors/AprovacaoIdInvalidoError.js';
import { ETAPA_STATUS, LACUNA, STATUS_WORKFLOW } from '../../interface/aprovacoes/constants.js';
import type { EtapaAprovacao } from '../../interface/aprovacoes/EtapaAprovacao.js';
import type {
    EtapaAprovacaoRepositoryInterface,
    TituloAprovacaoRepositoryInterface,
} from '../../interface/aprovacoes/ports.js';
import { chaveTitulo } from '../../interface/aprovacoes/ports.js';
import type {
    TituloAprovacao,
    TituloAprovacaoComTrilha,
} from '../../interface/aprovacoes/TituloAprovacao.js';
import AprovacoesPainelService from './AprovacoesPainelService.js';
import DuracaoCalculator from './DuracaoCalculator.js';

/** Caso canônico do doc 4156/1 (filial 1): CONTROLLER · COMPRAS · LIBERAR · DANILO_LARA. */
const RECEBIDO_EM = new Date('2026-05-14T07:12:46.000Z');
const AGIDO_EM = new Date('2026-05-15T06:41:40.000Z');
/** 23h29m — o número que o cliente reconhece. */
const DURACAO_4156 = 84_534;

const AGORA = new Date('2026-05-16T07:12:46.000Z');

const titulo = (over: Partial<TituloAprovacao> = {}): TituloAprovacao => ({
    filCod: 1,
    docCod: 4156,
    titCod: 1,
    documentoNumero: '17',
    tituloNumero: '171',
    fornecedorCod: 5129,
    fornecedorNome: 'CLONEX TECNOLOGIA LTDA',
    valor: 11125,
    moeda: 'BRL',
    dataEmissao: new Date('2026-04-15T00:00:00.000Z'),
    dataVencimento: new Date('2026-05-05T00:00:00.000Z'),
    statusWorkflow: STATUS_WORKFLOW.APROVADO,
    etapasConcluidas: 1,
    etapasTotais: 1,
    primeiraEtapaEm: RECEBIDO_EM,
    ultimaAcaoEm: AGIDO_EM,
    tempoTotalSegundos: DURACAO_4156,
    lacunas: [LACUNA.SEM_DATA_FINALIZACAO],
    ativo: true,
    observadoEm: new Date('2026-05-16T00:00:00.000Z'),
    ...over,
});

const etapa = (over: Partial<EtapaAprovacao> = {}): EtapaAprovacao => ({
    filCod: 1,
    docCod: 4156,
    titCod: 1,
    fblCod: 6,
    ftbCod: 1,
    nome: 'CONTROLLER',
    alcada: 'COMPRAS',
    acao: 'LIBERAR',
    responsavelNome: 'DANILO_LARA',
    statusErp: 2,
    status: ETAPA_STATUS.CONCLUIDA,
    recebidoEm: RECEBIDO_EM,
    agidoEm: AGIDO_EM,
    duracaoSegundos: DURACAO_4156,
    ativo: true,
    observadoEm: new Date('2026-05-16T00:00:00.000Z'),
    ...over,
});

interface Fakes {
    service: AprovacoesPainelService;
    filtrosVistos: unknown[];
}

const montar = (opts: {
    items?: TituloAprovacao[];
    total?: number;
    etapas?: EtapaAprovacao[];
    detalhe?: TituloAprovacaoComTrilha | null;
    snapshot?: Date | null;
}): Fakes => {
    const filtrosVistos: unknown[] = [];

    const tituloRepository: TituloAprovacaoRepositoryInterface = {
        upsert: async () => undefined,
        findById: async () => opts.detalhe ?? null,
        list: async (filtro) => {
            filtrosVistos.push(filtro);
            return { items: opts.items ?? [], total: opts.total ?? opts.items?.length ?? 0 };
        },
        ultimoSnapshot: async () => opts.snapshot ?? null,
    };

    const etapaRepository: EtapaAprovacaoRepositoryInterface = {
        sincronizarTrilha: async () => undefined,
        listByTitulo: async () => opts.etapas ?? [],
        // Espelha o `listByTitulo`: agrupa as MESMAS etapas por chave natural. Um fake que
        // devolvesse vazio aqui faria o grid parecer sem trilha e mascararia a derivação.
        listByTitulos: async (chaves) =>
            new Map(
                chaves.map((c) => [chaveTitulo(c.filCod, c.docCod, c.titCod), opts.etapas ?? []]),
            ),
    };

    return {
        service: new AprovacoesPainelService(
            tituloRepository,
            etapaRepository,
            new DuracaoCalculator(),
        ),
        filtrosVistos,
    };
};

describe('AprovacoesPainelService.parseId', () => {
    const { service } = montar({});

    it('lê a chave natural do id do contrato', () => {
        expect(service.parseId('1:4156:1')).toEqual({ filCod: 1, docCod: 4156, titCod: 1 });
    });

    it('devolve o mesmo id que produz (round-trip)', () => {
        const chave = { filCod: 2, docCod: 99, titCod: 3 };
        expect(service.parseId(service.montarId(chave))).toEqual(chave);
    });

    // A armadilha que o parser existe para evitar: `Number('abc')` é NaN e `Number('')` é 0 —
    // ambos passariam calados para o SQL e devolveriam "não encontrado".
    it.each([
        ['1:4156', 'partes de menos'],
        ['1:4156:1:9', 'partes demais'],
        ['1:abc:1', 'parte não numérica'],
        ['1::1', 'parte vazia'],
        ['0:4156:1', 'zero'],
        ['-1:4156:1', 'negativo'],
        ['1: 4156 :1', 'espaços'],
        ['1:4156.0:1', 'decimal'],
        ['1:4e3:1', 'notação científica'],
        ['', 'string vazia'],
    ])('rejeita %s (%s)', (id) => {
        expect(() => service.parseId(id)).toThrow(AprovacaoIdInvalidoError);
    });

    it('classifica o id inválido como 400 (não como falha do servidor)', () => {
        try {
            service.parseId('nope');
            throw new Error('deveria ter lançado');
        } catch (err) {
            expect(err).toBeInstanceOf(AprovacaoIdInvalidoError);
            expect((err as AprovacaoIdInvalidoError).statusCode).toBe(400);
        }
    });
});

describe('AprovacoesPainelService.listar', () => {
    it('monta o item no shape do contrato, com o id composto', async () => {
        const { service } = montar({
            items: [titulo()],
            etapas: [etapa()],
            snapshot: new Date('2026-05-16T00:00:00.000Z'),
        });

        const res = await service.listar({ page: 1, pageSize: 25, filCods: [1] }, new Date(AGORA));

        expect(res.page).toBe(1);
        expect(res.pageSize).toBe(25);
        expect(res.total).toBe(1);
        expect(res.snapshotEm).toBe('2026-05-16T00:00:00.000Z');
        const [item] = res.items;
        expect(item?.id).toBe('1:4156:1');
        expect(item?.filCod).toBe(1);
        expect(item?.statusWorkflow).toBe(STATUS_WORKFLOW.APROVADO);
        expect(item?.dataEmissao).toBe('2026-04-15T00:00:00.000Z');
        expect(item?.lacunas).toEqual([LACUNA.SEM_DATA_FINALIZACAO]);
    });

    it('repassa o filtro recebido ao repository — paginação e filtros são SQL', async () => {
        const { service, filtrosVistos } = montar({ items: [] });
        const filtro = {
            page: 3,
            pageSize: 10,
            filCods: [1, 2],
            status: STATUS_WORKFLOW.AGUARDANDO,
            busca: 'CLONEX',
        };

        await service.listar(filtro, new Date(AGORA));

        expect(filtrosVistos).toEqual([filtro]);
    });

    it('não fabrica dataFinalizacao quando o ERP não a expõe (PV-04)', async () => {
        const { service } = montar({ items: [titulo()], etapas: [etapa()] });

        const res = await service.listar({ page: 1, pageSize: 25, filCods: [1] }, new Date(AGORA));

        expect(res.items[0]?.dataFinalizacao).toBeUndefined();
        // E não cai para a emissão por dentro.
        expect(res.items[0]?.dataEmissao).toBe('2026-04-15T00:00:00.000Z');
    });

    it('sem etapa pendente: nenhuma etapaAtual e zero etapas abertas', async () => {
        const { service } = montar({ items: [titulo()], etapas: [etapa()] });

        const res = await service.listar({ page: 1, pageSize: 25, filCods: [1] }, new Date(AGORA));

        expect(res.items[0]?.etapaAtual).toBeUndefined();
        expect(res.items[0]?.etapasAbertas).toBe(0);
    });

    it('etapaAtual é a PENDENTE mais antiga, com parada há X calculado no backend', async () => {
        const antiga = etapa({
            fblCod: 6,
            ftbCod: 1,
            nome: 'CONTROLLER',
            status: ETAPA_STATUS.PENDENTE,
            statusErp: 1,
            acao: undefined,
            agidoEm: undefined,
            duracaoSegundos: undefined,
            recebidoEm: RECEBIDO_EM,
        });
        const recente = etapa({
            fblCod: 9,
            ftbCod: 2,
            nome: 'DIRETORIA II',
            status: ETAPA_STATUS.PENDENTE,
            statusErp: 1,
            acao: undefined,
            agidoEm: undefined,
            duracaoSegundos: undefined,
            recebidoEm: new Date('2026-05-15T07:12:46.000Z'),
        });

        const { service } = montar({
            items: [titulo({ statusWorkflow: STATUS_WORKFLOW.AGUARDANDO, etapasConcluidas: 0 })],
            // Deliberadamente fora de ordem: o serviço não pode depender da ordem do repository.
            etapas: [recente, antiga],
        });

        const res = await service.listar({ page: 1, pageSize: 25, filCods: [1] }, new Date(AGORA));

        expect(res.items[0]?.etapaAtual?.nome).toBe('CONTROLLER');
        expect(res.items[0]?.etapasAbertas).toBe(2);
        // AGORA − RECEBIDO_EM = exatamente 2 dias.
        expect(res.items[0]?.etapaAtual?.paradaHaSegundos).toBe(172_800);
    });

    it('desempata etapas pendentes com o mesmo recebidoEm por fblCod e depois ftbCod', async () => {
        const base = {
            status: ETAPA_STATUS.PENDENTE,
            statusErp: 1,
            acao: undefined,
            agidoEm: undefined,
            duracaoSegundos: undefined,
            recebidoEm: RECEBIDO_EM,
        };
        const { service } = montar({
            items: [titulo({ statusWorkflow: STATUS_WORKFLOW.AGUARDANDO })],
            etapas: [
                etapa({ ...base, fblCod: 6, ftbCod: 9, nome: 'B' }),
                etapa({ ...base, fblCod: 6, ftbCod: 2, nome: 'A' }),
                etapa({ ...base, fblCod: 3, ftbCod: 7, nome: 'MENOR_FBL' }),
            ],
        });

        const res = await service.listar({ page: 1, pageSize: 25, filCods: [1] }, new Date(AGORA));

        expect(res.items[0]?.etapaAtual?.nome).toBe('MENOR_FBL');
    });

    it('etapa pendente sem recebidoEm não vira "a mais antiga"', async () => {
        const semData = etapa({
            fblCod: 1,
            ftbCod: 1,
            nome: 'SEM_DATA',
            status: ETAPA_STATUS.PENDENTE,
            recebidoEm: undefined,
            agidoEm: undefined,
            duracaoSegundos: undefined,
        });
        const comData = etapa({
            fblCod: 9,
            ftbCod: 9,
            nome: 'COM_DATA',
            status: ETAPA_STATUS.PENDENTE,
            recebidoEm: RECEBIDO_EM,
            agidoEm: undefined,
            duracaoSegundos: undefined,
        });

        const { service } = montar({
            items: [titulo({ statusWorkflow: STATUS_WORKFLOW.AGUARDANDO })],
            etapas: [semData, comData],
        });

        const res = await service.listar({ page: 1, pageSize: 25, filCods: [1] }, new Date(AGORA));

        expect(res.items[0]?.etapaAtual?.nome).toBe('COM_DATA');
    });

    it('ignora etapa inativa (anti-fantasma) na contagem de abertas', async () => {
        const { service } = montar({
            items: [titulo({ statusWorkflow: STATUS_WORKFLOW.AGUARDANDO })],
            etapas: [
                etapa({ status: ETAPA_STATUS.PENDENTE, agidoEm: undefined, ativo: false }),
                etapa(),
            ],
        });

        const res = await service.listar({ page: 1, pageSize: 25, filCods: [1] }, new Date(AGORA));

        expect(res.items[0]?.etapasAbertas).toBe(0);
        expect(res.items[0]?.etapaAtual).toBeUndefined();
    });

    it('recalcula tempoTotalSegundos com o relógio de agora quando ainda há pendência', async () => {
        const { service } = montar({
            items: [
                titulo({ statusWorkflow: STATUS_WORKFLOW.AGUARDANDO, ultimaAcaoEm: undefined }),
            ],
            etapas: [
                etapa({
                    status: ETAPA_STATUS.PENDENTE,
                    agidoEm: undefined,
                    duracaoSegundos: undefined,
                }),
            ],
        });

        const res = await service.listar({ page: 1, pageSize: 25, filCods: [1] }, new Date(AGORA));

        // Não é o 84.534 congelado no banco: o relógio do título não parou.
        expect(res.items[0]?.tempoTotalSegundos).toBe(172_800);
    });

    it('omite snapshotEm quando a base ainda não foi observada', async () => {
        const { service } = montar({ items: [], snapshot: null });

        const res = await service.listar({ page: 1, pageSize: 25, filCods: [1] }, new Date(AGORA));

        expect(res.snapshotEm).toBeUndefined();
        expect(res.items).toEqual([]);
    });
});

describe('AprovacoesPainelService.detalhar', () => {
    const comTrilha = (etapas: EtapaAprovacao[]): TituloAprovacaoComTrilha => ({
        ...titulo(),
        etapas,
    });

    it('devolve cabeçalho, etapas em ordem cronológica, lacunas e snapshot', async () => {
        const primeira = etapa({ fblCod: 6, ftbCod: 1, nome: 'CONTROLLER' });
        const segunda = etapa({
            fblCod: 9,
            ftbCod: 2,
            nome: 'DIRETORIA II',
            recebidoEm: AGIDO_EM,
            agidoEm: new Date('2026-05-15T08:00:00.000Z'),
            duracaoSegundos: 4700,
        });

        const { service } = montar({ detalhe: comTrilha([segunda, primeira]) });

        const trilha = await service.detalhar('1:4156:1', { agora: new Date(AGORA) });

        expect(trilha?.cabecalho.id).toBe('1:4156:1');
        expect(trilha?.etapas.map((e) => e.nome)).toEqual(['CONTROLLER', 'DIRETORIA II']);
        expect(trilha?.lacunas).toEqual([LACUNA.SEM_DATA_FINALIZACAO]);
        expect(trilha?.snapshotEm).toBe('2026-05-16T00:00:00.000Z');
    });

    it('preserva o statusErp bruto e a duração fechada do caso canônico (23h29m)', async () => {
        const { service } = montar({ detalhe: comTrilha([etapa()]) });

        const trilha = await service.detalhar('1:4156:1', { agora: new Date(AGORA) });

        const [e] = trilha?.etapas ?? [];
        expect(e?.statusErp).toBe(2);
        expect(e?.duracaoSegundos).toBe(DURACAO_4156);
        expect(e?.recebidoEm).toBe('2026-05-14T07:12:46.000Z');
        expect(e?.agidoEm).toBe('2026-05-15T06:41:40.000Z');
        // Etapa concluída não tem "parada há".
        expect(e?.paradaHaSegundos).toBeUndefined();
    });

    it('etapa INDETERMINADO (PV-01) chega à trilha sem virar concluída', async () => {
        const { service } = montar({
            detalhe: comTrilha([
                etapa({
                    status: ETAPA_STATUS.INDETERMINADO,
                    statusErp: 7,
                    duracaoSegundos: undefined,
                }),
            ]),
        });

        const trilha = await service.detalhar('1:4156:1', { agora: new Date(AGORA) });

        expect(trilha?.etapas[0]?.status).toBe(ETAPA_STATUS.INDETERMINADO);
        expect(trilha?.etapas[0]?.statusErp).toBe(7);
        expect(trilha?.etapas[0]?.duracaoSegundos).toBeUndefined();
        expect(trilha?.etapas[0]?.paradaHaSegundos).toBeUndefined();
    });

    it('devolve null quando o título não existe', async () => {
        const { service } = montar({ detalhe: null });

        expect(await service.detalhar('1:4156:1', { agora: new Date(AGORA) })).toBeNull();
    });

    // Não distinguir "não existe" de "não é sua filial" é a decisão: 403 confirmaria a existência.
    it('devolve null quando a filial está fora da allow-list, sem consultar o banco', async () => {
        const { service } = montar({ detalhe: comTrilha([etapa()]) });

        const trilha = await service.detalhar('1:4156:1', {
            filCodsPermitidos: [2, 3],
            agora: new Date(AGORA),
        });

        expect(trilha).toBeNull();
    });

    it('deixa passar quando a filial está na allow-list', async () => {
        const { service } = montar({ detalhe: comTrilha([etapa()]) });

        const trilha = await service.detalhar('1:4156:1', {
            filCodsPermitidos: [1],
            agora: new Date(AGORA),
        });

        expect(trilha?.cabecalho.filCod).toBe(1);
    });

    it('rejeita id malformado antes de qualquer consulta', async () => {
        const { service } = montar({ detalhe: comTrilha([etapa()]) });

        await expect(service.detalhar('1:abc:1')).rejects.toBeInstanceOf(AprovacaoIdInvalidoError);
    });
});
