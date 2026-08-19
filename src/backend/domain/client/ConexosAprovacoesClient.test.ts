import 'reflect-metadata';
import ConexosAprovacoesClient from './ConexosAprovacoesClient.js';

/**
 * Testes do client de leitura da trilha (Frente V).
 *
 * Cada caso aqui corresponde a uma armadilha **verificada contra a produção** durante a sondagem
 * (`ontology/_inbox/frente-v-probe-resultado.md`, `ontology/integrations/conexos-aprovacao-trilha.md`).
 * Não são preferências de estilo: cada uma já custou uma rodada de investigação, e todas falham de
 * forma silenciosa — devolvendo lista vazia ou dado incompleto em vez de erro.
 */
/** Linha real de `FinTituloBloq` observada em produção: doc 4156/1, filial 1. */
const etapaReal = (): Record<string, unknown> => ({
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
});

describe('ConexosAprovacoesClient', () => {
    interface Chamada {
        path: string;
        body: Record<string, unknown>;
        opts?: { filCod?: number };
    }

    const montar = (resposta: unknown = { count: 0, rows: [] }) => {
        const chamadas: Chamada[] = [];
        const base = {
            ensureSid: async () => undefined,
            runWithRetry: async <T>(fn: () => Promise<T>): Promise<T> => fn(),
            postGeneric: async (
                path: string,
                body: Record<string, unknown>,
                opts?: { filCod?: number },
            ) => {
                chamadas.push({ path, body, opts });
                return resposta;
            },
        };
        // biome-ignore lint/suspicious/noExplicitAny: dublê estrutural do ConexosBaseClient
        const client = new ConexosAprovacoesClient(base as any);
        return { client, chamadas };
    };

    describe('listUniverso', () => {
        it('usa a tela de PESQUISA (psq014), não a carteira corrente (fin026)', async () => {
            // `fin026/list` projeta a carteira CORRENTE e perde títulos já liberados — foi o erro
            // de método que fez a 1ª sondagem concluir que havia 3 títulos com workflow em toda a
            // produção. O doc 4156 existe no psq014 e não aparece no fin026.
            const { client, chamadas } = montar();

            await client.listUniverso({ filCod: 2, pageNumber: 1, pageSize: 500 });

            expect(chamadas[0]?.path).toBe('psq014/list');
        });

        it('filtra contas a pagar por docTip = 2', async () => {
            const { client, chamadas } = montar();

            await client.listUniverso({ filCod: 2, pageNumber: 1, pageSize: 500 });

            const filtros = chamadas[0]?.body.filterList as Record<string, unknown>;
            expect(filtros['docTip#EQ']).toBe(2);
            expect(filtros['filCod#EQ']).toBe(2);
        });

        it('manda a janela de emissão como epoch em MILISSEGUNDOS', async () => {
            // String ISO é recusada com 500: "Value '2026-01-01' of ENUM ECnxDataType can't be
            // converted to java.util.Date". O operador estava certo; o formato é que não.
            const { client, chamadas } = montar();
            const desde = Date.UTC(2025, 7, 1);

            await client.listUniverso({
                filCod: 2,
                emissaoDesde: desde,
                pageNumber: 1,
                pageSize: 500,
            });

            const filtros = chamadas[0]?.body.filterList as Record<string, unknown>;
            expect(filtros['docDtaEmissao#GE']).toBe(desde);
            expect(typeof filtros['docDtaEmissao#GE']).toBe('number');
        });

        it('omite o filtro de data quando não há janela', async () => {
            const { client, chamadas } = montar();

            await client.listUniverso({ filCod: 2, pageNumber: 1, pageSize: 500 });

            const filtros = chamadas[0]?.body.filterList as Record<string, unknown>;
            expect('docDtaEmissao#GE' in filtros).toBe(false);
        });

        it('pede ordenação estável — requisito da retomada do backfill', async () => {
            // Sem `orderList`, o Conexos não garante ordem entre páginas, e a retomada por número
            // de página pularia ou repetiria títulos silenciosamente.
            const { client, chamadas } = montar();

            await client.listUniverso({ filCod: 2, pageNumber: 3, pageSize: 500 });

            expect(chamadas[0]?.body.orderList).toEqual({
                orderList: [{ propertyName: 'docCod', order: 'asc' }],
            });
            expect(chamadas[0]?.body.pageNumber).toBe(3);
        });

        it('devolve count e rows, com defaults quando o ERP omite', async () => {
            const { client } = montar({});

            const r = await client.listUniverso({ filCod: 2, pageNumber: 1, pageSize: 500 });

            expect(r).toEqual({ count: 0, rows: [] });
        });
    });

    describe('listTrilha', () => {
        it('monta o path literal com a chave completa do título', async () => {
            // Path LITERAL de propósito: `listGenericPaginated` posta em `/{serviceName}`, que em
            // várias telas do Conexos é a rota de CRIAÇÃO. No fin026 a diferença entre ler e
            // escrever é o sufixo `/list`.
            const { client, chamadas } = montar();

            await client.listTrilha({ filCod: 1, docTip: 2, docCod: 4156, titCod: 1 });

            expect(chamadas[0]?.path).toBe('fin026/infoTitulo/list/1/2/4156/1');
        });

        it('propaga o filCod do título no header da chamada (invariante I5)', async () => {
            // Consultar a trilha com a filial errada devolve `count: 0` SEM erro — falso negativo
            // mudo. O doc 4156 é da filial 1; como filial 2 ele responde vazio.
            const { client, chamadas } = montar();

            await client.listTrilha({ filCod: 1, docTip: 2, docCod: 4156, titCod: 1 });

            expect(chamadas[0]?.opts?.filCod).toBe(1);
        });

        it('devolve as linhas de bloqueio do título', async () => {
            const etapa = {
                fblCod: 6,
                ftbCod: 1,
                fblDesNome: 'CONTROLLER',
                aprovador: 'COMPRAS',
                fbaDesNome: 'LIBERAR',
                usnDesNomeCmd: 'DANILO_LARA',
                ftbVldStatus: 2,
                ftbTimBloq: 1778753566000,
                ftbTimCmd: 1778838100000,
            };
            const { client } = montar({ count: 1, rows: [etapa] });

            const r = await client.listTrilha({ filCod: 1, docTip: 2, docCod: 4156, titCod: 1 });

            expect(r).toEqual([etapa]);
        });

        it('devolve lista vazia quando o título não tem trilha', async () => {
            const { client } = montar({ count: 0 });

            const r = await client.listTrilha({ filCod: 1, docTip: 2, docCod: 973, titCod: 1 });

            expect(r).toEqual([]);
        });
    });

    describe('boundary Zod — tolerante, mas sem deixar lixo entrar', () => {
        it('descarta linha que não é objeto sem derrubar a página', async () => {
            // Numa varredura de 23 mil títulos, um registro torto não pode invalidar os outros 499
            // da página. Mas também não pode passar adiante e virar NaN silencioso lá na frente.
            const { client } = montar({ count: 3, rows: [etapaReal(), null, 'lixo'] });

            const r = await client.listTrilha({ filCod: 1, docTip: 2, docCod: 4156, titCod: 1 });

            expect(r).toHaveLength(1);
            expect(r[0]?.fblDesNome).toBe('CONTROLLER');
        });

        it('preserva campos que ainda não modelamos (passthrough)', async () => {
            // O ERP projeta mais campos do que consumimos; descartá-los silenciosamente esconderia
            // dado útil de quem for depurar contra a resposta crua.
            const { client } = montar({
                count: 1,
                rows: [{ ...etapaReal(), campoNovoDoErp: 'valor' }],
            });

            const r = await client.listTrilha({ filCod: 1, docTip: 2, docCod: 4156, titCod: 1 });

            expect((r[0] as Record<string, unknown>).campoNovoDoErp).toBe('valor');
        });

        it('coage número vindo como string — o ERP alterna os dois entre telas', async () => {
            const { client } = montar({
                count: 1,
                rows: [{ ...etapaReal(), ftbVldStatus: '2', ftbTimBloq: '1778753566000' }],
            });

            const r = await client.listTrilha({ filCod: 1, docTip: 2, docCod: 4156, titCod: 1 });

            expect(r[0]?.ftbVldStatus).toBe(2);
            expect(r[0]?.ftbTimBloq).toBe(1778753566000);
        });

        it('degrada campo torto para indefinido em vez de propagar NaN', async () => {
            const { client } = montar({
                count: 1,
                rows: [{ ...etapaReal(), ftbTimCmd: 'não é data' }],
            });

            const r = await client.listTrilha({ filCod: 1, docTip: 2, docCod: 4156, titCod: 1 });

            expect(r[0]?.ftbTimCmd).toBeUndefined();
            // O resto da linha sobrevive — degradação por campo, não por registro.
            expect(r[0]?.usnDesNomeCmd).toBe('DANILO_LARA');
        });

        it('vale também para o universo', async () => {
            const { client } = montar({ count: 2, rows: [{ docCod: 4156, titCod: 1 }, 42] });

            const r = await client.listUniverso({ filCod: 1, pageNumber: 1, pageSize: 500 });

            expect(r.rows).toHaveLength(1);
            expect(r.rows[0]?.docCod).toBe(4156);
        });
    });

    describe('superfície read-only (ADR-0038 D2)', () => {
        it('não expõe nenhum método de escrita', () => {
            // O ERP tem `trocaBloqueio`, `regerarBloqueios` e `aplicarComando` nas MESMAS telas, e
            // essas ações liberam pagamento. Manter a superfície sem escrita torna o erro
            // inexpressável, em vez de depender de disciplina de quem mexer depois.
            const { client } = montar();
            // Só as funções: os campos injetados pelo construtor (o `base`) não são superfície.
            const metodos = Object.entries(client)
                .filter(([, v]) => typeof v === 'function')
                .map(([k]) => k);

            expect(metodos.sort()).toEqual(['listTrilha', 'listUniverso']);
            for (const proibido of ['trocaBloqueio', 'regerarBloqueios', 'aplicarComando']) {
                expect(metodos).not.toContain(proibido);
            }
        });
    });
});
