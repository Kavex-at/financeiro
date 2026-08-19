import 'reflect-metadata';
import SqlBuilder from '../../libs/sql/SqlBuilder.js';
import { ETAPA_STATUS, STATUS_WORKFLOW } from '../../interface/aprovacoes/constants.js';
import type { EtapaAprovacao } from '../../interface/aprovacoes/EtapaAprovacao.js';
import type { TituloAprovacao } from '../../interface/aprovacoes/TituloAprovacao.js';
import EtapaAprovacaoRepository from './EtapaAprovacaoRepository.js';
import TituloAprovacaoRepository from './TituloAprovacaoRepository.js';

/**
 * Não há Postgres nesta máquina, e os testes das camadas de cima usam fakes de repository — então
 * o SQL da Frente V nunca passou por nenhuma validação. Este teste fecha a maior parte dessa lacuna
 * **sem banco**: captura cada query que os repositories emitem e a submete ao `SqlBuilder` real, o
 * mesmo que o `PostgreeDatabaseClient` usa em produção.
 *
 * O que isso pega, e que passaria batido até o deploy:
 *  - `$nome` citado na query e ausente do objeto de params (o builder lança);
 *  - mistura de parâmetro nomeado com posicional `$1` (o builder lança);
 *  - contagem de parâmetros divergente do esperado — sintoma de query montada por concatenação.
 *
 * O que NÃO pega: erro de sintaxe SQL e semântica de tipos. Isso exige um Postgres de verdade e
 * fica registrado como lacuna conhecida no roteiro de QA.
 */

interface QueryCapturada {
    query: string;
    params?: Record<string, unknown>;
}

/** Dublê do `PostgreeDatabaseClient` que só registra o que seria executado. */
const criarClienteCaptura = () => {
    const capturadas: QueryCapturada[] = [];
    const registrar = async (query: string, params?: Record<string, unknown>) => {
        capturadas.push({ query, params });
        return [];
    };

    const cliente = {
        selectMany: registrar,
        selectFirst: async (query: string, params?: Record<string, unknown>) => {
            capturadas.push({ query, params });
            return null;
        },
        update: registrar,
        insert: registrar,
        withTransaction: async (fn: (tx: unknown) => Promise<unknown>) =>
            fn({ update: registrar, selectMany: registrar, selectFirst: registrar }),
    };

    return { cliente, capturadas };
};

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
    recebidoEm: new Date(1778753566000),
    agidoEm: new Date(1778838100000),
    duracaoSegundos: 84534,
    ativo: true,
    observadoEm: new Date(),
    ...over,
});

const titulo = (over: Partial<TituloAprovacao> = {}): TituloAprovacao => ({
    filCod: 1,
    docCod: 4156,
    titCod: 1,
    documentoNumero: '17',
    statusWorkflow: STATUS_WORKFLOW.APROVADO,
    etapasConcluidas: 1,
    etapasTotais: 1,
    lacunas: [],
    ativo: true,
    observadoEm: new Date(),
    ...over,
});

/** Roda o mesmo tradutor que o cliente de produção usa. Lança se a query for inconsistente. */
const traduzir = (c: QueryCapturada) => new SqlBuilder().build(c.query, c.params ?? {});

describe('SQL da Frente V — consistência de parâmetros nomeados', () => {
    describe('EtapaAprovacaoRepository', () => {
        it('sincronizarTrilha: todas as queries são traduzíveis', async () => {
            const { cliente, capturadas } = criarClienteCaptura();
            // biome-ignore lint/suspicious/noExplicitAny: dublê estrutural do cliente de banco
            const repo = new EtapaAprovacaoRepository(cliente as any);

            await repo.sincronizarTrilha({ filCod: 1, docCod: 4156, titCod: 1 }, [etapa()]);

            expect(capturadas.length).toBeGreaterThan(0);
            for (const c of capturadas) expect(() => traduzir(c)).not.toThrow();
        });

        it('sincronizarTrilha com trilha VAZIA ainda inativa o que existia', async () => {
            // O caso é real: o ERP pode regerar bloqueios e deixar o título sem etapa nenhuma
            // (PV-06). O `<> ALL(array vazio)` é verdadeiro para toda linha, que é o que faz o
            // UPDATE alcançar tudo. Se alguém "otimizar" pulando o UPDATE quando não há etapas,
            // etapas fantasma sobrevivem para sempre.
            const { cliente, capturadas } = criarClienteCaptura();
            // biome-ignore lint/suspicious/noExplicitAny: dublê estrutural do cliente de banco
            const repo = new EtapaAprovacaoRepository(cliente as any);

            await repo.sincronizarTrilha({ filCod: 1, docCod: 4156, titCod: 1 }, []);

            const updates = capturadas.filter((c) => c.query.includes('SET ativo = FALSE'));
            expect(updates).toHaveLength(1);
            expect(updates[0]?.params?.chaves).toEqual([]);
            expect(() => traduzir(updates[0])).not.toThrow();
        });

        it('listByTitulos gera uma tupla por chave, e um parâmetro por componente', async () => {
            const { cliente, capturadas } = criarClienteCaptura();
            // biome-ignore lint/suspicious/noExplicitAny: dublê estrutural do cliente de banco
            const repo = new EtapaAprovacaoRepository(cliente as any);

            const chaves = Array.from({ length: 100 }, (_, i) => ({
                filCod: 1,
                docCod: 1000 + i,
                titCod: 1,
            }));
            await repo.listByTitulos(chaves);

            const q = capturadas[0];
            const { params } = traduzir(q);
            // 3 parâmetros por chave: filial, documento e título.
            expect(params).toHaveLength(300);
            // Comparação de TUPLA, não três `IN` independentes — três `IN` casariam combinações
            // cruzadas que não existem, inflando o resultado com trilhas de outros títulos.
            expect(q.query).toContain('(fil_cod, doc_cod, tit_cod) IN (');
        });

        it('listByTitulos com lista vazia não vai ao banco', async () => {
            const { cliente, capturadas } = criarClienteCaptura();
            // biome-ignore lint/suspicious/noExplicitAny: dublê estrutural do cliente de banco
            const repo = new EtapaAprovacaoRepository(cliente as any);

            const r = await repo.listByTitulos([]);

            expect(r.size).toBe(0);
            expect(capturadas).toHaveLength(0);
        });
    });

    describe('TituloAprovacaoRepository', () => {
        const montar = () => {
            const { cliente, capturadas } = criarClienteCaptura();
            const etapaRepo = new EtapaAprovacaoRepository(
                // biome-ignore lint/suspicious/noExplicitAny: dublê estrutural do cliente de banco
                cliente as any,
            );
            // biome-ignore lint/suspicious/noExplicitAny: dublê estrutural do cliente de banco
            const repo = new TituloAprovacaoRepository(cliente as any, etapaRepo);
            return { repo, capturadas };
        };

        it('upsert é traduzível', async () => {
            const { repo, capturadas } = montar();
            await repo.upsert(titulo());

            expect(capturadas).toHaveLength(1);
            expect(() => traduzir(capturadas[0])).not.toThrow();
        });

        it('list monta filtros sem deixar parâmetro órfão', async () => {
            const { repo, capturadas } = montar();

            await repo.list({
                page: 2,
                pageSize: 25,
                filCods: [1, 2],
                status: STATUS_WORKFLOW.AGUARDANDO,
                fornecedorCod: 5129,
                responsavel: 'DANILO',
                emissaoDe: new Date('2026-01-01'),
                emissaoAte: new Date('2026-12-31'),
                busca: 'CLONEX',
            });

            expect(capturadas.length).toBeGreaterThan(0);
            // Um `$nome` citado e não fornecido faria o builder lançar — é exatamente o erro que
            // uma query montada por concatenação de condições produz.
            for (const c of capturadas) expect(() => traduzir(c)).not.toThrow();
        });

        it('list sem filial permitida não consulta o banco', async () => {
            // Negar por omissão: allow-list vazia devolve nada, nunca "tudo".
            const { repo, capturadas } = montar();

            const r = await repo.list({ page: 1, pageSize: 25, filCods: [] });

            expect(r).toEqual({ items: [], total: 0 });
            expect(capturadas).toHaveLength(0);
        });

        it('ultimoSnapshot é traduzível', async () => {
            const { repo, capturadas } = montar();
            await repo.ultimoSnapshot([1, 2]);

            expect(() => traduzir(capturadas[0])).not.toThrow();
        });
    });
});
