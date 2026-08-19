import 'reflect-metadata';
import { ETAPA_STATUS, STATUS_WORKFLOW } from '../../interface/aprovacoes/constants.js';
import type {
    EtapaAprovacao,
    FinTituloBloqRow,
} from '../../interface/aprovacoes/EtapaAprovacao.js';
import type {
    AprovacaoIngestaoRunRepositoryInterface,
    EtapaAprovacaoRepositoryInterface,
    TituloAprovacaoRepositoryInterface,
    TrilhaAprovacaoGatewayInterface,
} from '../../interface/aprovacoes/ports.js';
import type {
    AprovacaoIngestaoRun,
    DocPagarRow,
    TituloAprovacao,
} from '../../interface/aprovacoes/TituloAprovacao.js';
import BoundedConcurrency from '../../libs/concurrency/BoundedConcurrency.js';
import DuracaoCalculator from './DuracaoCalculator.js';
import EtapaStatusResolver from './EtapaStatusResolver.js';
import IngestaoAprovacoesService from './IngestaoAprovacoesService.js';
import StatusWorkflowResolver from './StatusWorkflowResolver.js';

/** Título real do universo (psq014), doc 4156/1 — mas na filial 1. */
const docRow = (over: Partial<DocPagarRow> = {}): DocPagarRow => ({
    filCod: 1,
    docTip: 2,
    docCod: 4156,
    titCod: 1,
    docEspNumero: '17',
    titEspNumero: '171',
    pesCod: 5129,
    dpeNomPessoa: 'CLONEX TECNOLOGIA LTDA',
    titMnyValor: 11125,
    docDtaEmissao: 1776211200000,
    titDtaVencimento: 1777939200000,
    ...over,
});

/** Etapa real: CONTROLLER · COMPRAS · LIBERAR · DANILO_LARA. */
const bloqRow = (over: Partial<FinTituloBloqRow> = {}): FinTituloBloqRow => ({
    filCod: 1,
    docTip: 2,
    docCod: 4156,
    titCod: 1,
    fblCod: 6,
    ftbCod: 1,
    fblDesNome: 'CONTROLLER',
    aprovador: 'COMPRAS',
    fbaDesNome: 'LIBERAR',
    usnDesNomeCmd: 'DANILO_LARA',
    ftbVldStatus: 2,
    ftbTimBloq: 1778753566000,
    ftbTimCmd: 1778838100000,
    ...over,
});

interface Fakes {
    service: IngestaoAprovacoesService;
    titulosSalvos: TituloAprovacao[];
    trilhasSalvas: Array<{ chave: unknown; etapas: EtapaAprovacao[] }>;
    cursores: Array<{ filCod: number; pagina: number; docCod: number }>;
    chamadasTrilha: Array<{ filCod: number; docCod: number; titCod: number }>;
    runs: AprovacaoIngestaoRun[];
    finalizacoes: Array<{ status: string; erro?: string }>;
}

const montar = (opts: {
    universo?: DocPagarRow[][];
    trilha?: FinTituloBloqRow[];
    trilhaThrow?: Error;
    /** Falha só no título indicado — simula um registro problemático no meio da varredura. */
    trilhaThrowNoDoc?: number;
    /** Falha na listagem do universo — indisponibilidade sistêmica. */
    universoThrow?: Error;
    runRetomavel?: AprovacaoIngestaoRun | null;
}): Fakes => {
    const titulosSalvos: TituloAprovacao[] = [];
    const trilhasSalvas: Array<{ chave: unknown; etapas: EtapaAprovacao[] }> = [];
    const cursores: Array<{ filCod: number; pagina: number; docCod: number }> = [];
    const chamadasTrilha: Array<{ filCod: number; docCod: number; titCod: number }> = [];
    const runs: AprovacaoIngestaoRun[] = [];
    const finalizacoes: Array<{ status: string; erro?: string }> = [];

    const paginas = opts.universo ?? [[docRow()]];

    const gateway: TrilhaAprovacaoGatewayInterface = {
        listUniverso: async ({ pageNumber }) => {
            if (opts.universoThrow) throw opts.universoThrow;
            return {
                count: paginas.flat().length,
                rows: paginas[pageNumber - 1] ?? [],
            };
        },
        listTrilha: async ({ filCod, docCod, titCod }) => {
            chamadasTrilha.push({ filCod, docCod, titCod });
            if (opts.trilhaThrow) throw opts.trilhaThrow;
            if (opts.trilhaThrowNoDoc === docCod) {
                throw new Error(`registro problemático no doc ${docCod}`);
            }
            return opts.trilha ?? [bloqRow()];
        },
    };

    const tituloRepository: TituloAprovacaoRepositoryInterface = {
        upsert: async (t) => {
            titulosSalvos.push(t);
        },
        findById: async () => null,
        list: async () => ({ items: [], total: 0 }),
        ultimoSnapshot: async () => null,
    };

    const etapaRepository: EtapaAprovacaoRepositoryInterface = {
        sincronizarTrilha: async (chave, etapas) => {
            trilhasSalvas.push({ chave, etapas });
        },
        listByTitulo: async () => [],
        listByTitulos: async () => new Map(),
    };

    const runRepository: AprovacaoIngestaoRunRepositoryInterface = {
        iniciar: async (r) => {
            runs.push(r);
        },
        salvarCursor: async (_id, cursor) => {
            cursores.push(cursor);
        },
        finalizar: async (_id, status, erro) => {
            finalizacoes.push({ status, erro });
        },
        ultimaRunRetomavel: async () => opts.runRetomavel ?? null,
    };

    const service = new IngestaoAprovacoesService(
        gateway,
        tituloRepository,
        etapaRepository,
        runRepository,
        new EtapaStatusResolver(),
        new StatusWorkflowResolver(),
        new DuracaoCalculator(),
        new BoundedConcurrency(),
    );

    return {
        service,
        titulosSalvos,
        trilhasSalvas,
        cursores,
        chamadasTrilha,
        runs,
        finalizacoes,
    };
};

describe('IngestaoAprovacoesService', () => {
    it('materializa o caso canônico com status, duração e responsável', async () => {
        const f = montar({});

        const r = await f.service.executar({ filCods: [1], triggeredBy: 'teste' });

        expect(r.titulos).toBe(1);
        expect(r.etapas).toBe(1);

        const titulo = f.titulosSalvos[0];
        expect(titulo.statusWorkflow).toBe(STATUS_WORKFLOW.APROVADO);
        expect(titulo.etapasConcluidas).toBe(1);
        expect(titulo.tempoTotalSegundos).toBe(84534);

        const etapa = f.trilhasSalvas[0].etapas[0];
        expect(etapa.nome).toBe('CONTROLLER');
        expect(etapa.responsavelNome).toBe('DANILO_LARA');
        expect(etapa.status).toBe(ETAPA_STATUS.CONCLUIDA);
        expect(etapa.duracaoSegundos).toBe(84534);
    });

    it('título sem etapas vira SEM_WORKFLOW, sem trilha', async () => {
        const f = montar({ trilha: [] });

        await f.service.executar({ filCods: [1], triggeredBy: 'teste' });

        expect(f.titulosSalvos[0].statusWorkflow).toBe(STATUS_WORKFLOW.SEM_WORKFLOW);
        expect(f.trilhasSalvas[0].etapas).toHaveLength(0);
    });

    it('status desconhecido do ERP não vira aprovação (PV-01 / I4)', async () => {
        const f = montar({ trilha: [bloqRow({ ftbVldStatus: 7 })] });

        await f.service.executar({ filCods: [1], triggeredBy: 'teste' });

        expect(f.titulosSalvos[0].statusWorkflow).toBe(STATUS_WORKFLOW.INDETERMINADO);
        expect(f.titulosSalvos[0].lacunas).toContain('STATUS_ETAPA_DESCONHECIDO');
        expect(f.trilhasSalvas[0].etapas[0].statusErp).toBe(7);
    });

    it('usa a filial DO REGISTRO, não a da varredura (invariante I5)', async () => {
        // O universo é varrido pela filial 2, mas o título mora na 1. Consultar a trilha com a
        // filial da varredura devolveria lista vazia SEM erro — falso negativo mudo.
        const f = montar({ universo: [[docRow({ filCod: 1 })]] });

        await f.service.executar({ filCods: [2], triggeredBy: 'teste' });

        expect(f.chamadasTrilha[0].filCod).toBe(1);
    });

    it('grava o cursor UMA vez por página, não por título', async () => {
        // Por título custava 23.632 UPDATEs por filial; por página, 48. O preço é reprocessar no
        // máximo uma página na retomada — inofensivo, porque o UPSERT é idempotente.
        const f = montar({
            universo: [[docRow({ docCod: 100 }), docRow({ docCod: 200 })]],
        });

        await f.service.executar({ filCods: [1], triggeredBy: 'teste' });

        expect(f.cursores).toHaveLength(1);
        expect(f.cursores[0]?.docCod).toBe(200);
    });

    it('retoma da página do cursor em vez de recomeçar', async () => {
        const f = montar({
            universo: [[docRow({ docCod: 1 })], [docRow({ docCod: 2 })]],
            runRetomavel: {
                id: 'run-anterior',
                triggeredBy: 'cron',
                status: 'running',
                filCods: [1],
                totalTitulos: 10,
                totalEtapas: 15,
                cursorFilCod: 1,
                cursorPagina: 2,
                cursorDocCod: 1,
                startedAt: new Date(),
            },
        });

        const r = await f.service.executar({
            filCods: [1],
            triggeredBy: 'cron',
            retomar: true,
        });

        // Não abriu run nova, e continuou a contagem de onde parou.
        expect(f.runs).toHaveLength(0);
        expect(r.runId).toBe('run-anterior');
        expect(r.titulos).toBe(11);
        // Página 1 foi pulada: só o doc da página 2 foi processado.
        expect(f.chamadasTrilha.map((c) => c.docCod)).toEqual([2]);
    });

    describe('um título problemático não derruba a varredura', () => {
        it('conta a falha, segue em frente e registra na run', async () => {
            // Antes, uma única exceção abortava a run inteira — e a retomada voltava ao cursor
            // ANTERIOR ao título problemático, batia nele de novo e morria de novo: um backfill de
            // 23 mil títulos que nunca terminava por causa de um registro.
            const f = montar({
                universo: [[docRow({ docCod: 100 }), docRow({ docCod: 200 })]],
                trilhaThrowNoDoc: 100,
            });

            const r = await f.service.executar({ filCods: [1], triggeredBy: 'teste' });

            expect(r.falhas).toBe(1);
            expect(r.titulos).toBe(1); // o doc 200 seguiu normalmente
            expect(f.finalizacoes[0].status).toBe('success');
            // O sucesso não é limpo, e a mensagem diz isso — é o que o operador lê no runbook.
            expect(f.finalizacoes[0].erro).toContain('1 título(s) falharam');
            expect(f.finalizacoes[0].erro).toContain('doc 100');
        });
    });

    it('falha SISTÊMICA (universo indisponível) ainda aborta e marca erro', async () => {
        // A distinção importa: tolerar um registro ruim é resiliência; tolerar o ERP inteiro fora
        // do ar seria varrer o nada e declarar sucesso.
        const f = montar({ universoThrow: new Error('ERP fora do ar') });

        await expect(f.service.executar({ filCods: [1], triggeredBy: 'teste' })).rejects.toThrow(
            'ERP fora do ar',
        );

        expect(f.finalizacoes[0].status).toBe('error');
        expect(f.finalizacoes[0].erro).toBe('ERP fora do ar');
    });

    it('ignora linha do universo sem chave utilizável', async () => {
        const f = montar({ universo: [[docRow({ docCod: undefined })]] });

        const r = await f.service.executar({ filCods: [1], triggeredBy: 'teste' });

        expect(r.titulos).toBe(0);
        expect(f.titulosSalvos).toHaveLength(0);
    });
});
