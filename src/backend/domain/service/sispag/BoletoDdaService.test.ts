import 'reflect-metadata';
import type ConexosBaseClient from '../../client/ConexosBaseClient.js';
import type ConexosDdaClient from '../../client/ConexosDdaClient.js';
import type PostgreeDatabaseClient from '../../client/database/PostgreeDatabaseClient.js';
import EmptyDdaFileError from '../../errors/EmptyDdaFileError.js';
import IngestLockBusyError from '../../errors/IngestLockBusyError.js';
import { BOLETO_DDA_ESCOPO } from '../../interface/sispag/BoletoDda.js';
import CodigoBarrasBoleto from '../../libs/boleto/CodigoBarrasBoleto.js';
import BankingCalendar from '../../libs/calendar/BankingCalendar.js';
import BoundedConcurrency from '../../libs/concurrency/BoundedConcurrency.js';
import type BoletoDdaRepository from '../../repository/sispag/BoletoDdaRepository.js';
import type PagamentoIngestaoRunRepository from '../../repository/sispag/PagamentoIngestaoRunRepository.js';
import type LotePagamentoRepository from '../../repository/sispag/LotePagamentoRepository.js';
import type TituloAPagarRepository from '../../repository/sispag/TituloAPagarRepository.js';
import type LogService from '../LogService.js';
import BoletoDdaService from './BoletoDdaService.js';
import ConsolidacaoBoletoDdaCache from './ConsolidacaoBoletoDdaCache.js';
import ConsolidacaoBoletoDda from './ConsolidacaoBoletoDda.js';
import RegraSugestaoBoleto, { REGRA_CANDIDATO_TEXTO } from './RegraSugestaoBoleto.js';
import PaginacaoBoletoDda from './PaginacaoBoletoDda.js';
import type AprendizadoFornecedorBoletoService from './AprendizadoFornecedorBoletoService.js';
import type BoletoSuggestionService from './BoletoSuggestionService.js';
import type FornecedorBoletoDda from './FornecedorBoletoDda.js';
import SugestaoBoletoCache from './SugestaoBoletoCache.js';

const HOJE = new Date('2026-09-23T15:00:00Z');
const dia = (civil: string): number => Date.parse(`${civil}T08:30:00Z`);

const build = (lockLivre = true, agora: () => number = () => 0) => {
    const calendar = BankingCalendar.withClock(() => HOJE);
    const dda = {
        listarArquivos: jest.fn().mockResolvedValue([]),
        listarItens: jest.fn().mockResolvedValue([]),
    };
    const repo = {
        listArquivosSincronizados: jest.fn().mockResolvedValue(new Map()),
        salvarArquivo: jest.fn().mockResolvedValue(undefined),
        listBoletos: jest.fn().mockResolvedValue([]),
        ultimaSincronizacao: jest.fn().mockResolvedValue(undefined),
        listArquivosEstado: jest.fn().mockResolvedValue(new Map()),
        atualizarCabecalho: jest.fn().mockResolvedValue(undefined),
        registrarConferencia: jest.fn().mockResolvedValue(undefined),
        ultimaConferencia: jest.fn().mockResolvedValue(undefined),
    };
    const db = {
        withAdvisoryLock: jest.fn(
            (_k: number, fn: () => Promise<unknown>, busy: () => Promise<unknown>) =>
                lockLivre ? fn() : busy(),
        ),
    };
    const log = { info: jest.fn(), warn: jest.fn() };
    const cache = new SugestaoBoletoCache();
    // I21v: os grupos (sugeridos e confirmados) por boleto vêm do cenário em cache das sugestões.
    const gruposDaTela = {
        gruposPorBoleto: jest.fn(async () => new Map<string, unknown>()),
    };
    const loteRepo = {
        listTitulosEmLotesAbertos: jest.fn().mockResolvedValue([]),
        assinaturaTitulosEmLotesAbertos: jest.fn().mockResolvedValue('0:0'),
    };
    const runs = { findLatestSuccessFinishedAt: jest.fn().mockResolvedValue(null) };
    const consolidados = ConsolidacaoBoletoDdaCache.withClock(agora);
    const tituloRepo = {
        listAtivos: jest.fn().mockResolvedValue([]),
        listInativosRecentes: jest.fn().mockResolvedValue([]),
    };
    // ADR-0081: o fornecedor da conta do beneficiário (leitura) e o aprendizado (fim da sincronização).
    const fornecedores = { enriquecer: jest.fn(async (linhas: unknown[]) => linhas) };
    const aprendizado = {
        aprender: jest.fn().mockResolvedValue({
            chaves: 0,
            ambiguas: 0,
            porOrigem: { VINCULADO: 0, CONFIRMADO: 0, INFERIDO: 0 },
        }),
    };
    const service = new BoletoDdaService(
        dda as unknown as ConexosDdaClient,
        { getFilCodDefault: jest.fn().mockResolvedValue(1) } as unknown as ConexosBaseClient,
        repo as unknown as BoletoDdaRepository,
        tituloRepo as unknown as TituloAPagarRepository,
        loteRepo as unknown as LotePagamentoRepository,
        new ConsolidacaoBoletoDda(new CodigoBarrasBoleto(), calendar, new RegraSugestaoBoleto()),
        new PaginacaoBoletoDda(),
        calendar,
        new BoundedConcurrency(),
        db as unknown as PostgreeDatabaseClient,
        log as unknown as LogService,
        cache,
        gruposDaTela as unknown as BoletoSuggestionService,
        consolidados,
        runs as unknown as PagamentoIngestaoRunRepository,
        fornecedores as unknown as FornecedorBoletoDda,
        aprendizado as unknown as AprendizadoFornecedorBoletoService,
    );
    return {
        service,
        dda,
        repo,
        log,
        cache,
        gruposDaTela,
        runs,
        consolidados,
        loteRepo,
        tituloRepo,
        fornecedores,
        aprendizado,
    };
};

describe('BoletoDdaService — invalida o cache das sugestões (ADR-0068, PERF-1)', () => {
    it('ao fim de toda sincronização, com ou sem falha de arquivo', async () => {
        const { service, dda, repo, cache } = build();
        const invalidar = jest.spyOn(cache, 'invalidar');
        dda.listarArquivos.mockResolvedValue([{ ddcCod: 1, importadoEm: dia('2026-09-23') }]);
        dda.listarItens.mockRejectedValue(new Error('falhou'));
        const r = await service.sincronizar({ triggeredBy: 'teste' });
        expect(r.falhas).toBe(1);
        expect(invalidar).toHaveBeenCalledTimes(1);
        repo.salvarArquivo.mockClear();
        dda.listarItens.mockResolvedValue([{ ddcCod: 1, ditCod: 1, valor: 1 }]);
        await service.sincronizar({ triggeredBy: 'teste' });
        expect(invalidar).toHaveBeenCalledTimes(2);
    });

    it('invalida mesmo quando a sincronização lança (pool pode ter mudado em parte)', async () => {
        const { service, dda, cache } = build();
        const invalidar = jest.spyOn(cache, 'invalidar');
        dda.listarArquivos.mockRejectedValue(new Error('conexos fora'));
        await expect(service.sincronizar({ triggeredBy: 'teste' })).rejects.toThrow('conexos fora');
        expect(invalidar).toHaveBeenCalledTimes(1);
    });

    it('não invalida quando o lock está ocupado (nada foi sincronizado)', async () => {
        const { service, cache } = build(false);
        const invalidar = jest.spyOn(cache, 'invalidar');
        await expect(service.sincronizar({ triggeredBy: 'teste' })).rejects.toBeInstanceOf(
            IngestLockBusyError,
        );
        expect(invalidar).not.toHaveBeenCalled();
    });
});

describe('BoletoDdaService', () => {
    it('sincronizar lê arquivos novos e relê só os recentes já conhecidos', async () => {
        const { service, dda, repo } = build();
        dda.listarArquivos.mockResolvedValue([
            { ddcCod: 162, importadoEm: dia('2026-09-23') }, // novo
            { ddcCod: 152, importadoEm: dia('2026-09-10') }, // conhecido, recente → relê
            { ddcCod: 100, importadoEm: dia('2026-06-01') }, // conhecido, antigo → pula
        ]);
        repo.listArquivosSincronizados.mockResolvedValue(
            new Map([
                [152, dia('2026-09-10')],
                [100, dia('2026-06-01')],
            ]),
        );
        dda.listarItens.mockResolvedValue([{ ddcCod: 0, ditCod: 1, valor: 1 }]);

        const r = await service.sincronizar({ triggeredBy: 'teste' });

        expect(dda.listarItens.mock.calls.map((c) => c[0].ddcCod).sort()).toEqual([152, 162]);
        expect(r).toEqual({
            arquivosNovos: 1,
            arquivosRelidos: 1,
            arquivosLidos: 2,
            boletos: 2,
            falhas: 0,
            arquivosAdiados: 0,
            arquivosVazios: 0,
        });
    });

    it('prazo estourado: não abre arquivo novo, conta como adiado e não é falha', async () => {
        const { service, dda, repo } = build();
        dda.listarArquivos.mockResolvedValue([{ ddcCod: 1 }, { ddcCod: 2 }]);

        const r = await service.sincronizar({ triggeredBy: 'teste', prazoMs: -1 });

        expect(dda.listarItens).not.toHaveBeenCalled();
        expect(repo.salvarArquivo).not.toHaveBeenCalled();
        expect(r).toMatchObject({ arquivosNovos: 2, boletos: 0, falhas: 0, arquivosAdiados: 2 });
    });

    it('sem prazo (botão, job avulso) nada é adiado', async () => {
        const { service, dda } = build();
        dda.listarArquivos.mockResolvedValue([{ ddcCod: 1 }]);
        dda.listarItens.mockResolvedValue([{ ddcCod: 1, ditCod: 1, valor: 1 }]);

        const r = await service.sincronizar({ triggeredBy: 'teste' });

        expect(r.arquivosAdiados).toBe(0);
        expect(r.boletos).toBe(1);
    });

    it('releituraDias encurta a janela de releitura dos arquivos já conhecidos', async () => {
        const { service, dda, repo } = build();
        dda.listarArquivos.mockResolvedValue([{ ddcCod: 152, importadoEm: dia('2026-09-10') }]);
        repo.listArquivosSincronizados.mockResolvedValue(new Map([[152, dia('2026-09-10')]]));

        const curta = await service.sincronizar({ triggeredBy: 'teste', releituraDias: 7 });
        expect(curta.arquivosRelidos).toBe(0);

        const padrao = await service.sincronizar({ triggeredBy: 'teste' });
        expect(padrao.arquivosRelidos).toBe(1);
    });

    it('um arquivo que falha não derruba os outros e é contado', async () => {
        const { service, dda, repo, log } = build();
        dda.listarArquivos.mockResolvedValue([{ ddcCod: 1 }, { ddcCod: 2 }]);
        dda.listarItens
            .mockRejectedValueOnce(new Error('504'))
            .mockResolvedValueOnce([{ ddcCod: 2, ditCod: 1, valor: 1 }]);

        const r = await service.sincronizar({ triggeredBy: 'teste' });

        expect(r.falhas).toBe(1);
        expect(repo.salvarArquivo).toHaveBeenCalledTimes(1);
        expect(log.warn).toHaveBeenCalledWith(
            expect.objectContaining({ data: expect.objectContaining({ ddcCod: 1, erro: '504' }) }),
        );
    });

    it('sincronização concorrente → IngestLockBusyError (409)', async () => {
        const { service } = build(false);
        await expect(service.sincronizar({ triggeredBy: 'teste' })).rejects.toBeInstanceOf(
            IngestLockBusyError,
        );
    });

    it('listar "a-vencer" corta pelo dia de Brasília; "todos" não corta', async () => {
        const { service, repo } = build();
        repo.ultimaSincronizacao.mockResolvedValue(123);

        const r = await service.listar({ escopo: 'a-vencer' });
        expect(repo.listBoletos).toHaveBeenLastCalledWith({ vencimentoDesde: '2026-09-23' });
        expect(r).toEqual({
            boletos: [],
            total: 0,
            pagina: 1,
            tamanho: 20,
            contagem: {
                todas: 0,
                VINCULADO: 0,
                CANDIDATO: 0,
                AMBIGUO: 0,
                FORA_JANELA: 0,
                TITULO_SAIU_CARTEIRA: 0,
                SEM_TITULO: 0,
                emGrupo: 0,
            },
            totais: expect.objectContaining({ todas: { qtd: 0, valor: 0 } }),
            facetas: { filiais: [], semFilial: 0, bancos: [] },
            amostraHoje: [],
            filiais: [],
            sincronizadoEm: 123,
            conferidoEm: 123,
            regraCandidato: REGRA_CANDIDATO_TEXTO,
        });

        await service.listar({ escopo: 'todos' });
        expect(repo.listBoletos).toHaveBeenLastCalledWith({});
    });

    it('listar devolve só a página pedida, com o total do escopo inteiro', async () => {
        const { service, repo } = build();
        repo.listBoletos.mockResolvedValue(
            Array.from({ length: 45 }, (_, i) => ({
                ddcCod: 1,
                ditCod: i + 1,
                valor: 10 + i,
                vencimento: '2026-10-01',
            })),
        );

        const r = await service.listar({ escopo: 'todos', pagina: 3, tamanho: 20 });

        expect(r.total).toBe(45);
        expect(r.pagina).toBe(3);
        expect(r.boletos.map((b) => b.ditCod)).toEqual([41, 42, 43, 44, 45]);
        expect(r.contagem.SEM_TITULO).toBe(45);
    });

    describe('grupo por boleto (I21v)', () => {
        const boletos = [
            { ddcCod: 165, ditCod: 24398, valor: 26369.85, vencimento: '2026-10-29' },
            { ddcCod: 1, ditCod: 2, valor: 10, vencimento: '2026-10-29' },
        ];

        it('anexa o grupo ao boleto, conta emGrupo e filtra por emGrupo', async () => {
            const { service, repo, gruposDaTela } = build();
            repo.listBoletos.mockResolvedValue(boletos);
            gruposDaTela.gruposPorBoleto.mockResolvedValue(
                new Map([
                    [
                        '165:24398',
                        { estado: 'SUGERIDO', filCod: 1, nTitulos: 2, confirmavel: true },
                    ],
                ]),
            );
            const todos = await service.listar({ escopo: 'todos' });
            expect(todos.boletos.find((b) => b.ditCod === 24398)?.grupo).toMatchObject({
                estado: 'SUGERIDO',
                nTitulos: 2,
            });
            expect(todos.boletos.find((b) => b.ditCod === 2)?.grupo).toBeUndefined();
            expect(todos.contagem.emGrupo).toBe(1);
            const so = await service.listar({ escopo: 'todos', emGrupo: true });
            expect(so.boletos.map((b) => b.ditCod)).toEqual([24398]);
        });

        it('grupo formado numa cópia mais antiga do codbar continua na linha (e a linha passa a apontar para ela)', async () => {
            const CODBAR = '34193158000004815331090113433700004286589000';
            const { service, repo, gruposDaTela } = build();
            repo.listBoletos.mockResolvedValue([
                { ddcCod: 200, ditCod: 5, valor: 10, vencimento: '2026-10-29', codbar: CODBAR },
                { ddcCod: 150, ditCod: 9, valor: 10, vencimento: '2026-10-29', codbar: CODBAR },
            ]);
            gruposDaTela.gruposPorBoleto.mockResolvedValue(
                new Map([
                    [
                        '150:9',
                        {
                            estado: 'CONFIRMADO',
                            id: 'g1',
                            filCod: 1,
                            nTitulos: 2,
                            confirmavel: true,
                        },
                    ],
                ]),
            );
            const r = await service.listar({ escopo: 'todos' });
            expect(r.boletos).toHaveLength(1);
            expect(r.boletos[0]).toMatchObject({
                ddcCod: 150,
                ditCod: 9,
                arquivos: 2,
                grupo: { estado: 'CONFIRMADO', id: 'g1' },
            });
            expect(r.contagem.emGrupo).toBe(1);
        });

        it('o grupo confirmado de uma cópia vence a sugestão da cópia mais nova', async () => {
            const CODBAR = '34193158000004815331090113433700004286589000';
            const { service, repo, gruposDaTela } = build();
            repo.listBoletos.mockResolvedValue([
                { ddcCod: 200, ditCod: 5, valor: 10, vencimento: '2026-10-29', codbar: CODBAR },
                { ddcCod: 150, ditCod: 9, valor: 10, vencimento: '2026-10-29', codbar: CODBAR },
            ]);
            gruposDaTela.gruposPorBoleto.mockResolvedValue(
                new Map([
                    ['200:5', { estado: 'SUGERIDO', filCod: 1, nTitulos: 3, confirmavel: true }],
                    [
                        '150:9',
                        {
                            estado: 'CONFIRMADO',
                            id: 'g1',
                            filCod: 1,
                            nTitulos: 2,
                            confirmavel: true,
                        },
                    ],
                ]),
            );
            const r = await service.listar({ escopo: 'todos' });
            expect(r.boletos[0]).toMatchObject({ ddcCod: 150, grupo: { estado: 'CONFIRMADO' } });
        });

        it('a representante vira cópia quando a linha troca para a cópia que tem o grupo', async () => {
            const CODBAR = '34193158000004815331090113433700004286589000';
            const { service, repo, gruposDaTela } = build();
            repo.listBoletos.mockResolvedValue([
                { ddcCod: 200, ditCod: 5, valor: 10, vencimento: '2026-10-29', codbar: CODBAR },
                { ddcCod: 170, ditCod: 7, valor: 10, vencimento: '2026-10-29', codbar: CODBAR },
                { ddcCod: 150, ditCod: 9, valor: 10, vencimento: '2026-10-29', codbar: CODBAR },
            ]);
            gruposDaTela.gruposPorBoleto.mockResolvedValue(
                new Map([
                    ['150:9', { estado: 'SUGERIDO', filCod: 1, nTitulos: 2, confirmavel: true }],
                ]),
            );
            const r = await service.listar({ escopo: 'todos' });
            expect(r.boletos[0]).toMatchObject({ ddcCod: 150, ditCod: 9, arquivos: 3 });
            expect(r.boletos[0]?.copias?.map((c) => `${c.ddcCod}:${c.ditCod}`).sort()).toEqual([
                '170:7',
                '200:5',
            ]);
        });
        it('falha ao ler os grupos não derruba a aba: lista sem grupo e avisa com o código do driver', async () => {
            const { service, repo, gruposDaTela, log } = build();
            repo.listBoletos.mockResolvedValue(boletos);
            gruposDaTela.gruposPorBoleto.mockRejectedValue(
                Object.assign(new Error('banco fora'), { code: '57P01' }),
            );
            const r = await service.listar({ escopo: 'todos' });
            expect(r.boletos).toHaveLength(2);
            expect(r.contagem.emGrupo).toBe(0);
            expect(log.warn).toHaveBeenCalledWith(
                expect.objectContaining({ data: expect.objectContaining({ codigoErro: '57P01' }) }),
            );
        });
    });

    describe('sispag-dda-paridade', () => {
        it('arquivosLidos conta só o que foi lido: sem falhas nem adiados', async () => {
            const { service, dda } = build();
            dda.listarArquivos.mockResolvedValue([{ ddcCod: 1 }, { ddcCod: 2 }, { ddcCod: 3 }]);
            dda.listarItens
                .mockRejectedValueOnce(new Error('504'))
                .mockResolvedValue([{ ddcCod: 2, ditCod: 1, valor: 1 }]);
            const r = await service.sincronizar({ triggeredBy: 'teste' });
            expect(r).toMatchObject({ arquivosNovos: 3, arquivosLidos: 2, falhas: 1 });

            const adiado = await service.sincronizar({ triggeredBy: 'teste', prazoMs: -1 });
            expect(adiado).toMatchObject({ arquivosLidos: 0, arquivosAdiados: 3 });
        });

        it('listar passa o dia de Brasília: faixas e urgentes funcionam', async () => {
            const { service, repo } = build();
            repo.listBoletos.mockResolvedValue([
                { ddcCod: 1, ditCod: 1, valor: 10, vencimento: '2026-09-23' },
                { ddcCod: 1, ditCod: 2, valor: 20, vencimento: '2026-09-30' },
            ]);
            const r = await service.listar({ escopo: 'todos', faixas: ['HOJE'] });
            expect(r.boletos.map((b) => b.ditCod)).toEqual([1]);
            expect(r.totais.hoje).toEqual({ qtd: 1, valor: 10 });
        });

        describe('cache da consolidação (F4)', () => {
            it('duas listagens na mesma chave consolidam uma vez; filtro muda só a página', async () => {
                const { service, repo } = build();
                await service.listar({ escopo: 'todos' });
                await service.listar({ escopo: 'todos', busca: 'x', pagina: 2 });
                expect(repo.listBoletos).toHaveBeenCalledTimes(1);
                await service.listar({ escopo: 'a-vencer' });
                expect(repo.listBoletos).toHaveBeenCalledTimes(2);
            });

            it('pool novo, carteira nova ou sugestões invalidadas reconsolidam', async () => {
                const { service, repo, runs, cache } = build();
                await service.listar({ escopo: 'todos' });
                repo.ultimaSincronizacao.mockResolvedValue(999);
                await service.listar({ escopo: 'todos' });
                expect(repo.listBoletos).toHaveBeenCalledTimes(2);
                runs.findLatestSuccessFinishedAt.mockResolvedValue(new Date(5_000));
                await service.listar({ escopo: 'todos' });
                expect(repo.listBoletos).toHaveBeenCalledTimes(3);
                cache.invalidar();
                await service.listar({ escopo: 'todos' });
                expect(repo.listBoletos).toHaveBeenCalledTimes(4);
            });

            it('performance-1: lote criado, item incluído/retirado ou lote finalizado reconsolida já', async () => {
                const { service, repo, loteRepo } = build();
                await service.listar({ escopo: 'todos' });
                await service.listar({ escopo: 'todos' });
                expect(repo.listBoletos).toHaveBeenCalledTimes(1);
                loteRepo.assinaturaTitulosEmLotesAbertos.mockResolvedValue('1:987');
                await service.listar({ escopo: 'todos' });
                expect(repo.listBoletos).toHaveBeenCalledTimes(2);
            });

            it('sincronizar invalida o cache, mesmo com o pool na mesma marca', async () => {
                const { service, repo } = build();
                await service.listar({ escopo: 'todos' });
                await service.sincronizar({ triggeredBy: 'teste' });
                await service.listar({ escopo: 'todos' });
                expect(repo.listBoletos).toHaveBeenCalledTimes(2);
            });

            it('TTL de 30 s: depois dele, reconsolida', async () => {
                let agora = 0;
                const { service, repo } = build(true, () => agora);
                await service.listar({ escopo: 'todos' });
                agora = 29_999;
                await service.listar({ escopo: 'todos' });
                expect(repo.listBoletos).toHaveBeenCalledTimes(1);
                agora = 30_001;
                await service.listar({ escopo: 'todos' });
                expect(repo.listBoletos).toHaveBeenCalledTimes(2);
            });

            it('chamadas concorrentes esperam a mesma consolidação; falha não fica guardada', async () => {
                const { service, repo } = build();
                await Promise.all([
                    service.listar({ escopo: 'todos' }),
                    service.listar({ escopo: 'todos' }),
                ]);
                expect(repo.listBoletos).toHaveBeenCalledTimes(1);

                const outro = build();
                outro.repo.listBoletos.mockRejectedValueOnce(new Error('banco fora'));
                await expect(outro.service.listar({ escopo: 'todos' })).rejects.toThrow(
                    'banco fora',
                );
                await outro.service.listar({ escopo: 'todos' });
                expect(outro.repo.listBoletos).toHaveBeenCalledTimes(2);
            });
        });
    });

    describe('fault-tolerance-1: arquivo vazio do fin124 (EmptyDdaFileError)', () => {
        it('loga com o código DDA_FILE_EMPTY, separado das outras falhas, e conta à parte', async () => {
            const { service, dda, repo, log } = build();
            dda.listarArquivos.mockResolvedValue([{ ddcCod: 1 }, { ddcCod: 2 }]);
            dda.listarItens.mockResolvedValueOnce([]).mockRejectedValueOnce(new Error('504'));
            repo.salvarArquivo.mockRejectedValueOnce(new EmptyDdaFileError(1, 40));
            const r = await service.sincronizar({ triggeredBy: 'teste' });
            expect(r).toMatchObject({ falhas: 2, arquivosVazios: 1, arquivosLidos: 0 });
            const avisos = log.warn.mock.calls.map((c) => c[0]);
            expect(avisos).toContainEqual(
                expect.objectContaining({
                    message: expect.stringContaining('arquivo vazio'),
                    data: expect.objectContaining({
                        ddcCod: 1,
                        codigoErro: 'DDA_FILE_EMPTY',
                        itensNoSnapshot: 40,
                    }),
                }),
            );
            expect(avisos).toContainEqual(
                expect.objectContaining({
                    message: 'sincronização DDA: falha ao ler arquivo do fin124',
                    data: expect.objectContaining({ ddcCod: 2, erro: '504' }),
                }),
            );
        });

        it('sem arquivo vazio, o resultado não muda de forma (arquivosVazios = 0)', async () => {
            const { service } = build();
            const r = await service.sincronizar({ triggeredBy: 'teste' });
            expect(r.arquivosVazios).toBe(0);
        });
    });

    describe('I-DDA6: conferência rápida (v0.53.0)', () => {
        const conhecido = { nome: 'A.RET', status: 1 };

        it('arquivo novo: lê só ele; conhecido sem mudança não é relido', async () => {
            const { service, dda, repo } = build();
            dda.listarArquivos.mockResolvedValue([
                { ddcCod: 1, nome: 'A.RET', status: 1 },
                { ddcCod: 2, nome: 'B.RET', status: 1 },
            ]);
            repo.listArquivosEstado.mockResolvedValue(new Map([[1, conhecido]]));
            dda.listarItens.mockResolvedValue([{ ddcCod: 2, ditCod: 1, valor: 1 }]);
            const r = await service.conferir({ triggeredBy: 'abertura:u1' });
            expect(dda.listarItens.mock.calls.map((c) => c[0].ddcCod)).toEqual([2]);
            expect(repo.salvarArquivo).toHaveBeenCalledTimes(1);
            expect(r).toMatchObject({
                estado: 'conferido',
                arquivosNovos: 1,
                arquivosCabecalho: 0,
            });
            expect(repo.registrarConferencia).toHaveBeenCalledWith(
                expect.objectContaining({ origem: 'abertura:u1', arquivosLidos: 1 }),
            );
        });

        it('arquivo cancelado ou com status/nome trocado: só o cabeçalho, nenhum item lido', async () => {
            const { service, dda, repo } = build();
            dda.listarArquivos.mockResolvedValue([
                { ddcCod: 1, nome: 'A.RET', status: 1, canceladoEm: 5_000 },
                { ddcCod: 2, nome: 'B2.RET', status: 1 },
                { ddcCod: 3, nome: 'C.RET', status: 2 },
            ]);
            repo.listArquivosEstado.mockResolvedValue(
                new Map([
                    [1, conhecido],
                    [2, { nome: 'B.RET', status: 1 }],
                    [3, { nome: 'C.RET', status: 1 }],
                ]),
            );
            const r = await service.conferir({ triggeredBy: 't' });
            expect(dda.listarItens).not.toHaveBeenCalled();
            expect(repo.salvarArquivo).not.toHaveBeenCalled();
            expect(repo.atualizarCabecalho.mock.calls.map((c) => c[0].ddcCod)).toEqual([1, 2, 3]);
            expect(r).toMatchObject({ estado: 'conferido', arquivosCabecalho: 3 });
        });

        it('nada mudou: só registra a conferência; não grava nem invalida caches', async () => {
            const { service, dda, repo, cache, consolidados } = build();
            const inv = jest.spyOn(cache, 'invalidar');
            const invC = jest.spyOn(consolidados, 'invalidar');
            dda.listarArquivos.mockResolvedValue([{ ddcCod: 1, nome: 'A.RET', status: 1 }]);
            repo.listArquivosEstado.mockResolvedValue(new Map([[1, conhecido]]));
            const r = await service.conferir({ triggeredBy: 't' });
            expect(r).toMatchObject({
                estado: 'conferido',
                arquivosNovos: 0,
                arquivosCabecalho: 0,
            });
            expect(repo.salvarArquivo).not.toHaveBeenCalled();
            expect(repo.atualizarCabecalho).not.toHaveBeenCalled();
            expect(repo.registrarConferencia).toHaveBeenCalledTimes(1);
            expect(inv).not.toHaveBeenCalled();
            expect(invC).not.toHaveBeenCalled();
        });

        it('gravou algo: invalida os dois caches', async () => {
            const { service, dda, repo, cache, consolidados } = build();
            const inv = jest.spyOn(cache, 'invalidar');
            const invC = jest.spyOn(consolidados, 'invalidar');
            dda.listarArquivos.mockResolvedValue([{ ddcCod: 9 }]);
            dda.listarItens.mockResolvedValue([{ ddcCod: 9, ditCod: 1, valor: 1 }]);
            await service.conferir({ triggeredBy: 't' });
            expect(inv).toHaveBeenCalledTimes(1);
            expect(invC).toHaveBeenCalledTimes(1);
            expect(repo.salvarArquivo).toHaveBeenCalledTimes(1);
        });

        it('arquivo que sumiu da listagem: nada apagado, só aviso', async () => {
            const { service, dda, repo, log } = build();
            dda.listarArquivos.mockResolvedValue([]);
            repo.listArquivosEstado.mockResolvedValue(new Map([[1, conhecido]]));
            const r = await service.conferir({ triggeredBy: 't' });
            expect(r).toMatchObject({ estado: 'conferido', arquivosSumidos: 1 });
            expect(repo.atualizarCabecalho).not.toHaveBeenCalled();
            expect(log.warn).toHaveBeenCalledWith(
                expect.objectContaining({ data: expect.objectContaining({ ddcCods: [1] }) }),
            );
        });

        it('listagem falhou: não registra conferência e devolve falhou (nunca lança)', async () => {
            const { service, dda, repo } = build();
            dda.listarArquivos.mockRejectedValue(new Error('fin124 504'));
            const r = await service.conferir({ triggeredBy: 't' });
            expect(r).toMatchObject({ estado: 'falhou', erro: 'fin124 504' });
            expect(repo.registrarConferencia).not.toHaveBeenCalled();
        });

        it('lock do DDA ocupado: ocupada, sem chamar o Conexos', async () => {
            const { service, dda } = build(false);
            expect(await service.conferir({ triggeredBy: 't' })).toEqual({ estado: 'ocupada' });
            expect(dda.listarArquivos).not.toHaveBeenCalled();
        });

        it('prazo estourado: arquivo novo fica adiado (parcial), conferência registrada', async () => {
            const { service, dda, repo } = build();
            dda.listarArquivos.mockResolvedValue([{ ddcCod: 1 }]);
            const r = await service.conferir({ triggeredBy: 't', prazoMs: -1 });
            expect(r).toMatchObject({ estado: 'parcial', arquivosAdiados: 1 });
            expect(dda.listarItens).not.toHaveBeenCalled();
            expect(repo.registrarConferencia).toHaveBeenCalled();
        });

        it('a guarda de lista vazia continua valendo (arquivo novo vazio do ERP conta como falha)', async () => {
            const { service, dda, repo } = build();
            dda.listarArquivos.mockResolvedValue([{ ddcCod: 1 }]);
            dda.listarItens.mockResolvedValue([]);
            repo.salvarArquivo.mockRejectedValueOnce(new EmptyDdaFileError(1, 3));
            const r = await service.conferir({ triggeredBy: 't' });
            expect(r).toMatchObject({ estado: 'parcial', falhas: 1, arquivosVazios: 1 });
        });

        it('conferirSeVelho: conferência com menos que o intervalo não chama o Conexos', async () => {
            const { service, dda, repo } = build();
            repo.ultimaConferencia.mockResolvedValue(1_000_000 - 5 * 60_000);
            expect(
                await service.conferirSeVelho({
                    triggeredBy: 't',
                    intervaloMs: 10 * 60_000,
                    agora: 1_000_000,
                }),
            ).toBeUndefined();
            expect(dda.listarArquivos).not.toHaveBeenCalled();
            repo.ultimaConferencia.mockResolvedValue(1_000_000 - 11 * 60_000);
            expect(
                await service.conferirSeVelho({
                    triggeredBy: 't',
                    intervaloMs: 10 * 60_000,
                    agora: 1_000_000,
                }),
            ).toMatchObject({ estado: 'conferido' });
        });

        it('passada completa também registra a conferência quando a listagem dá certo', async () => {
            const { service, repo } = build();
            await service.sincronizar({ triggeredBy: 'ingestao:cron' });
            expect(repo.registrarConferencia).toHaveBeenCalledWith(
                expect.objectContaining({ origem: 'ingestao:cron' }),
            );
        });

        it('listar devolve conferidoEm = a mais recente entre conferência e sincronização', async () => {
            const { service, repo } = build();
            repo.ultimaSincronizacao.mockResolvedValue(1_000);
            repo.ultimaConferencia.mockResolvedValue(5_000);
            expect((await service.listar({ escopo: 'todos' })).conferidoEm).toBe(5_000);
            repo.ultimaConferencia.mockResolvedValue(undefined);
            expect((await service.listar({ escopo: 'todos' })).conferidoEm).toBe(1_000);
        });
    });

    describe('títulos que saíram da carteira', () => {
        it('falha ao ler os inativos não derruba a aba: lista sem a situação e avisa', async () => {
            const { service, repo, log, tituloRepo } = build();
            repo.listBoletos.mockResolvedValue([
                { ddcCod: 1, ditCod: 1, valor: 10, vencimento: '2026-09-23' },
            ]);
            tituloRepo.listInativosRecentes.mockRejectedValue(
                Object.assign(new Error('timeout'), { code: '57014' }),
            );
            const r = await service.listar({ escopo: 'todos' });
            expect(r.total).toBe(1);
            expect(r.boletos[0]?.situacao).toBe('SEM_TITULO');
            expect(log.warn).toHaveBeenCalledWith(
                expect.objectContaining({
                    message: expect.stringContaining('saíram da carteira'),
                    data: expect.objectContaining({ codigoErro: '57014' }),
                }),
            );
        });
    });
});

describe('BoletoDdaService — fornecedor pela conta do beneficiário (ADR-0081)', () => {
    it('reaprende ao fim da sincronização, depois de copiar o pool', async () => {
        const { service, dda, repo, aprendizado } = build();
        dda.listarArquivos.mockResolvedValue([{ ddcCod: 1, importadoEm: dia('2026-09-23') }]);
        dda.listarItens.mockResolvedValue([{ ddcCod: 1, ditCod: 1, valor: 1 }]);
        await service.sincronizar({ triggeredBy: 'teste' });
        expect(aprendizado.aprender).toHaveBeenCalledTimes(1);
        expect(aprendizado.aprender.mock.invocationCallOrder[0]).toBeGreaterThan(
            repo.salvarArquivo.mock.invocationCallOrder[0] ?? 0,
        );
    });

    it('falha no aprendizado vira WARN e a sincronização termina normalmente', async () => {
        const { service, aprendizado, log } = build();
        aprendizado.aprender.mockRejectedValue(new Error('tabela ausente'));
        await expect(service.sincronizar({ triggeredBy: 'teste' })).resolves.toMatchObject({
            falhas: 0,
        });
        expect(log.warn).toHaveBeenCalledWith(
            expect.objectContaining({ message: expect.stringContaining('aprender o fornecedor') }),
        );
    });

    it('lock ocupado não aprende nada', async () => {
        const { service, aprendizado } = build(false);
        await expect(service.sincronizar({ triggeredBy: 'teste' })).rejects.toBeInstanceOf(
            IngestLockBusyError,
        );
        expect(aprendizado.aprender).not.toHaveBeenCalled();
    });

    it('listar NÃO aprende (a leitura não escreve) e enriquece depois de consolidar', async () => {
        const { service, aprendizado, fornecedores } = build();
        await service.listar({ escopo: BOLETO_DDA_ESCOPO.TODOS });
        expect(aprendizado.aprender).not.toHaveBeenCalled();
        expect(fornecedores.enriquecer).toHaveBeenCalledTimes(1);
    });

    it('falha ao ler o fornecedor tira só a coluna: a lista sai', async () => {
        const { service, fornecedores, log } = build();
        fornecedores.enriquecer.mockRejectedValue(new Error('tabela ausente'));
        await expect(service.listar({ escopo: BOLETO_DDA_ESCOPO.TODOS })).resolves.toMatchObject({
            total: 0,
        });
        expect(log.warn).toHaveBeenCalled();
    });
});
