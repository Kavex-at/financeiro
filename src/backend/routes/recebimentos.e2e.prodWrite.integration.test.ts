import 'reflect-metadata';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import express from 'express';

/**
 * EXECUÇÃO REAL EM PRODUÇÃO — **um** caso, ponta a ponta.
 *
 * Roteiro, pré-condições e critérios de escolha do caso: `docs/e2e/producao-runbook-primeira-execucao.md`.
 * Rode o pré-flight ANTES (`recebimentos.e2e.prodPreflight`) — ele não escreve nada e diz se o caso passa.
 *
 * Executa a rota real do produto (`POST /recebimentos/transacoes/:txnId/solicitacao-numerario`) contra o
 * Conexos de PRODUÇÃO: SN no com299 → baixa no fin014 → NDe no com297 → fiscal → observações →
 * homologação → poll SEFAZ. O artefato que o cliente valida é a **NDe no ERP**.
 *
 * ⚠️ ISTO ESCREVE EM PRODUÇÃO E NÃO SE DESFAZ SOZINHO. Tudo até `obs-done` o analista desfaz no ERP;
 * de `homologado` em diante é fato fiscal. NÃO há teardown aqui — de propósito: a NDe emitida é
 * trabalho de verdade sobre um adiantamento real, não resíduo de teste.
 *
 * Quatro travas, nesta ordem:
 *
 *   1. **Guarda invertida** — aborta se a URL for de homologação (as outras sondas abortam se NÃO for).
 *   2. **Confirmação explícita** — `PROD_WRITE_CONFIRM` tem que valer exatamente `EXECUTAR-EM-PRODUCAO`.
 *      Sem isso o teste não roda, e nenhum `npx jest` genérico o alcança por acidente.
 *   3. **O dinheiro tem que existir.** O crédito é procurado no extrato REAL (fin095) da conta informada.
 *      Se não achar, o teste para: gerar uma SN contra um pagamento que não entrou seria pior que
 *      qualquer bug. Nada de transação fabricada, ao contrário do teste de homologação.
 *   4. **Ledger em ARQUIVO, não em memória.** A decisão foi não depender de Postgres nesta rodada; um
 *      ledger em memória, porém, nasce vazio a cada `npx jest` — uma quebra no meio seguida de
 *      reprocessamento criaria uma SEGUNDA SN em produção. Persistir em JSON local devolve a
 *      idempotência: o reprocessamento RETOMA a partir da etapa alcançada.
 *
 * Fora da suíte padrão. Rodar explicitamente:
 *
 *   CONEXOS_PROD_BASE_URL=... CONEXOS_PROD_USERNAME=... CONEXOS_PROD_PASSWORD=... \
 *   PROD_WRITE_CONFIRM=EXECUTAR-EM-PRODUCAO \
 *   PROD_FIL_COD=2 PROD_PRI_COD=<processo> PROD_PES_COD=<cliente> \
 *   PROD_DPE_NOME="<NOME DO CLIENTE>" PROD_GER_NUM=<conta> PROD_VALOR=<valor do crédito> \
 *   npx jest recebimentos.e2e.prodWrite --testPathIgnorePatterns "/node_modules/"
 */

jest.setTimeout(1_800_000);

jest.mock('../domain/appContainer.js', () => ({
    bootstrapAppContainer: jest.fn().mockResolvedValue(undefined),
}));

const CONFIRMACAO = 'EXECUTAR-EM-PRODUCAO';
/** O ledger que sobrevive ao processo — é ele que impede a segunda SN. */
const LEDGER_ARQUIVO = 'C:/tmp/prod-sn-ledger.json';
const RELATORIO = 'C:/tmp/prod-execucao.json';
/** Janela de busca do crédito no extrato. Amplo o bastante para um pagamento recente. */
const DIAS_EXTRATO = 60;
/** Tolerância do casamento por valor — centavos, não faixa. */
const TOLERANCIA = 0.005;

type AnyRecord = Record<string, unknown>;

const exigirEnv = (nome: string): string => {
    const valor = process.env[nome];
    if (valor === undefined || valor.trim() === '') {
        throw new Error(
            `ABORTADO: ${nome} não está no ambiente. Alvo, credenciais e o caso vêm do SHELL — ` +
                'nada de produção toca o disco. Ver o cabeçalho do teste.',
        );
    }
    return valor.trim();
};

const buildFakeDb = (): AnyRecord => ({
    init: async () => undefined,
    withAdvisoryLock: async (_k: number, onAcquired: () => Promise<unknown>): Promise<unknown> =>
        onAcquired(),
    selectMany: async () => {
        throw new Error('execução em produção: SQL indisponível (ledger é o arquivo)');
    },
    selectFirst: async () => {
        throw new Error('execução em produção: SQL indisponível (ledger é o arquivo)');
    },
    insert: async () => {
        throw new Error('execução em produção: SQL indisponível (ledger é o arquivo)');
    },
    update: async () => {
        throw new Error('execução em produção: SQL indisponível (ledger é o arquivo)');
    },
    withTransaction: async () => {
        throw new Error('execução em produção: SQL indisponível (ledger é o arquivo)');
    },
});

/**
 * Ledger de idempotência PERSISTIDO em arquivo. Mesma superfície do repositório real, mas gravando um
 * JSON a cada mudança — o que faz um reprocessamento retomar em vez de duplicar. Cada escrita é
 * sincrona e imediata: se o processo morrer no meio, o que já aconteceu está no disco.
 */
const buildLedgerEmArquivo = (): { ledger: AnyRecord; ler: () => AnyRecord[] } => {
    const rows = new Map<string, AnyRecord>();
    if (existsSync(LEDGER_ARQUIVO)) {
        for (const row of JSON.parse(readFileSync(LEDGER_ARQUIVO, 'utf8')) as AnyRecord[]) {
            rows.set(String(row.idempotencyKey), row);
        }
        // eslint-disable-next-line no-console
        console.log(
            `[LEDGER] retomando de ${LEDGER_ARQUIVO}: ${rows.size} execução(ões) conhecida(s)`,
        );
    }
    const gravar = (): void => {
        writeFileSync(LEDGER_ARQUIVO, JSON.stringify([...rows.values()], null, 2), 'utf8');
    };
    const touch = (key: string, patch: AnyRecord): void => {
        const row = rows.get(key);
        if (row) Object.assign(row, patch, { atualizadoEm: new Date().toISOString() });
        gravar();
        // eslint-disable-next-line no-console
        console.log(`[LEDGER] ${key} <- ${JSON.stringify(patch)}`);
    };
    const ledger: AnyRecord = {
        findByIdempotencyKey: async (key: string): Promise<AnyRecord | null> =>
            rows.get(key) ?? null,
        beginExecution: async (
            input: AnyRecord,
        ): Promise<{ status: string; alreadySettled: boolean }> => {
            const key = String(input.idempotencyKey);
            const existente = rows.get(key);
            if (existente?.status === 'settled') {
                // eslint-disable-next-line no-console
                console.log(`[LEDGER] ${key} JÁ ESTÁ settled — nada a refazer.`);
                return { status: 'settled', alreadySettled: true };
            }
            if (existente) {
                // eslint-disable-next-line no-console
                console.log(
                    `[LEDGER] ${key} retomando da etapa "${String(existente.etapa ?? '-')}" ` +
                        `(docCod ${String(existente.docCod ?? '-')}, borCod ${String(existente.fin014BorCod ?? '-')}, ` +
                        `ndDocCod ${String(existente.ndDocCod ?? '-')}) — o que já foi escrito NÃO se repete.`,
                );
            } else {
                rows.set(key, {
                    ...input,
                    status: 'reconciling',
                    criadoEm: new Date().toISOString(),
                    atualizadoEm: new Date().toISOString(),
                });
                gravar();
            }
            return { status: 'reconciling', alreadySettled: false };
        },
        setDocCod: async (key: string, docCod: number) => touch(key, { docCod }),
        setRequestPayload: async (key: string, payload: unknown) =>
            touch(key, { requestPayloadKeys: Object.keys((payload ?? {}) as AnyRecord) }),
        setFin014BorCod: async (key: string, borCod: number) =>
            touch(key, { fin014BorCod: borCod, etapa: 'fin014-done' }),
        setNdDocCod: async (key: string, docCod: number) =>
            touch(key, { ndDocCod: docCod, etapa: 'nota-debito' }),
        setEtapa: async (key: string, etapa: string) => touch(key, { etapa }),
        setRevisaoHumana: async (key: string, revisao: boolean) =>
            touch(key, { revisaoHumana: revisao }),
        setNdeAutorizado: async (key: string, autorizado: boolean) =>
            touch(key, { ndeAutorizado: autorizado }),
        markSettled: async (key: string, data: AnyRecord) =>
            touch(key, { ...data, status: 'settled', etapa: 'concluido' }),
        markError: async (key: string, data: AnyRecord) => touch(key, { ...data, status: 'error' }),
    };
    return { ledger, ler: () => [...rows.values()] };
};

/** NDe emitida — sem Postgres nesta rodada, mas o registro vai para o relatório. */
const buildNdeRepo = (): { repo: AnyRecord; rows: AnyRecord[] } => {
    const rows: AnyRecord[] = [];
    return {
        rows,
        repo: {
            save: async (nde: AnyRecord): Promise<AnyRecord> => {
                rows.push(nde);
                // eslint-disable-next-line no-console
                console.log(
                    `[NDE] numero=${String(nde.numeroNde)} valor=${String(nde.valor)} ` +
                        `status=${String(nde.statusEmissao)}`,
                );
                return nde;
            },
            findByRecebimentoId: async (id: string): Promise<AnyRecord | null> =>
                rows.find((r) => r.recebimentoId === id) ?? null,
        },
    };
};

interface TestServer {
    url: string;
    close: () => Promise<void>;
}

const listen = (app: express.Express): Promise<TestServer> =>
    new Promise((resolve) => {
        const server: Server = app.listen(0, '127.0.0.1', () => {
            const { port } = server.address() as AddressInfo;
            resolve({
                url: `http://127.0.0.1:${port}`,
                close: () => new Promise((r) => server.close(() => r())),
            });
        });
    });

describe('PRODUÇÃO — uma execução real, do crédito à NDe', () => {
    const relatorio: AnyRecord = { caso: null, credito: null, resposta: null, ledger: null };
    let appServer: TestServer;
    let lerLedger: () => AnyRecord[];
    let ndeRows: AnyRecord[];
    let caso: {
        filCod: number;
        priCod: number;
        pesCod: number;
        dpeNomPessoa: string;
        gerNum: number;
        valor: number;
    };
    /** O crédito REAL do extrato — só existe se o dinheiro existir. */
    let credito: AnyRecord | undefined;
    let txnId: string;

    beforeAll(async () => {
        const url = exigirEnv('CONEXOS_PROD_BASE_URL');
        if (/-hml\./.test(url)) {
            throw new Error(
                `ABORTADO: ${url} é homologação. Este teste é de PRODUÇÃO — para o HML use ` +
                    '`recebimentos.e2e.hmlWrite`.',
            );
        }
        if (exigirEnv('PROD_WRITE_CONFIRM') !== CONFIRMACAO) {
            throw new Error(
                `ABORTADO: PROD_WRITE_CONFIRM precisa valer exatamente "${CONFIRMACAO}". ` +
                    'Esta execução escreve documentos reais e emite uma NDe.',
            );
        }
        caso = {
            filCod: Number(exigirEnv('PROD_FIL_COD')),
            priCod: Number(exigirEnv('PROD_PRI_COD')),
            pesCod: Number(exigirEnv('PROD_PES_COD')),
            dpeNomPessoa: exigirEnv('PROD_DPE_NOME'),
            gerNum: Number(exigirEnv('PROD_GER_NUM')),
            valor: Number(exigirEnv('PROD_VALOR')),
        };
        relatorio.caso = { ...caso, baseUrl: url };

        process.env.CONEXOS_BASE_URL = url;
        process.env.CONEXOS_USERNAME = exigirEnv('CONEXOS_PROD_USERNAME');
        process.env.CONEXOS_PASSWORD = exigirEnv('CONEXOS_PROD_PASSWORD');
        process.env.CONEXOS_FIL_COD = String(caso.filCod);
        // As duas chaves que ligam a escrita. Os defaults são seguros; ligá-las é decisão, não descuido.
        process.env.CONEXOS_WRITE_ENABLED = 'true';
        process.env.CONEXOS_DRY_RUN = 'false';
        // `COM297_GCD_NOTA_DEBITO` fica DE FORA: o código é por-ambiente (o do HML é 186) — em produção
        // o com297 tem que resolver a configuração pelo NOME. O pré-flight já confirmou que resolve.
        delete process.env.COM297_GCD_NOTA_DEBITO;
        process.env.NDE_ACL_PREFLIGHT = 'true';
        process.env.environment = 'local';
        delete process.env.client_name;
        delete process.env.databaseConnectionString;

        const { container } = await import('tsyringe');
        const { default: PostgreeDatabaseClient } = await import(
            '../domain/client/database/PostgreeDatabaseClient.js'
        );
        const { default: TransacaoRepository } = await import(
            '../domain/repository/recebimentos/TransacaoRepository.js'
        );
        const { default: RecebimentoIngestaoRunRepository } = await import(
            '../domain/repository/recebimentos/RecebimentoIngestaoRunRepository.js'
        );
        const { SOLICITACAO_NUMERARIO_EXECUCAO_REPOSITORY_TOKEN, NDE_REPOSITORY_TOKEN } =
            await import('../domain/interface/recebimentos/ports.js');
        container.registerInstance(PostgreeDatabaseClient, buildFakeDb() as never);

        const { buildLegacyConexosAdapter } = await import(
            '../domain/client/legacyConexosAdapter.js'
        );
        const { default: ConexosBaseClient, LEGACY_CONEXOS_TOKEN } = await import(
            '../domain/client/ConexosBaseClient.js'
        );
        const { default: ConexosSessionResolver } = await import(
            '../domain/client/ConexosSessionResolver.js'
        );
        const resolver = container.resolve(ConexosSessionResolver);
        container.register(LEGACY_CONEXOS_TOKEN, {
            useValue: buildLegacyConexosAdapter(() => resolver.resolve()),
        });
        container.resolve(ConexosBaseClient);

        // ── TRAVA 3: o dinheiro tem que existir no extrato ────────────────────────────────────
        const { default: ConexosExtratoClient } = await import(
            '../domain/client/ConexosExtratoClient.js'
        );
        const extrato = container.resolve(ConexosExtratoClient);
        const ate = new Date();
        const de = new Date(ate.getTime() - DIAS_EXTRATO * 24 * 60 * 60 * 1000);
        const lancamentos = await extrato.listLancamentos({
            filCod: caso.filCod,
            gerNum: caso.gerNum,
            de,
            ate,
        });
        const candidatos = lancamentos.filter(
            (l) => l.tipo === 'CREDITO' && Math.abs(l.valor - caso.valor) < TOLERANCIA,
        );
        // eslint-disable-next-line no-console
        console.log(
            `[PROD] extrato conta ${caso.gerNum} (${DIAS_EXTRATO}d): ${lancamentos.length} lançamento(s), ` +
                `${candidatos.length} crédito(s) de R$ ${caso.valor}`,
        );
        if (candidatos.length !== 1) {
            throw new Error(
                `ABORTADO: esperava EXATAMENTE 1 crédito de R$ ${caso.valor} na conta ${caso.gerNum} ` +
                    `nos últimos ${DIAS_EXTRATO} dias, achei ${candidatos.length}. Gerar uma SN contra um ` +
                    'pagamento que não entrou (ou escolher entre homônimos no escuro) é pior que qualquer ' +
                    'bug — ajuste PROD_VALOR/PROD_GER_NUM até a identificação ser única.',
            );
        }
        const { buildNaturalKey, buildTransacaoId } = await import(
            '../domain/service/recebimentos/normalizarLancamento.js'
        );
        const escolhido = candidatos[0];
        const naturalKey = buildNaturalKey(escolhido);
        txnId = buildTransacaoId(naturalKey);
        credito = { ...escolhido, naturalKey, txnId };
        relatorio.credito = credito;
        // eslint-disable-next-line no-console
        console.log(`[PROD] crédito identificado: ${JSON.stringify(credito)}`);

        // A transação semeada é o crédito REAL recém-lido, não um objeto inventado.
        const store = new Map<string, AnyRecord>([
            [
                txnId,
                {
                    id: txnId,
                    naturalKey,
                    filCod: caso.filCod,
                    tipo: 'CREDITO',
                    status: 'importada',
                    valor: escolhido.valor,
                    dataMovimento: escolhido.dataLancamento,
                    gerNum: caso.gerNum,
                    moeda: 'BRL',
                    correlationId: txnId,
                    rawPayload: null,
                    normalized: null,
                    importadoEm: new Date(),
                },
            ],
        ]);
        container.registerInstance(TransacaoRepository, {
            upsertMany: async () => ({ inseridas: 0, deduplicadas: 0 }),
            findById: async (id: string) => store.get(id) ?? null,
            listParaPainel: async () => [...store.values()],
            contarKpis: async () => ({}),
            somarValorPorStatus: async () => ({}),
        } as never);
        container.registerInstance(RecebimentoIngestaoRunRepository, {
            createRun: async () => txnId,
            finishRun: async () => undefined,
            listRecentRuns: async () => [],
            findLatestSuccessFinishedAt: async () => undefined,
            findRunIdByIdempotencyKey: async () => null,
            recordIdempotencyKey: async () => undefined,
        } as never);

        const { registerRecebimentosPorts } = await import('../domain/recebimentosContainer.js');
        registerRecebimentosPorts();
        const ledger = buildLedgerEmArquivo();
        lerLedger = ledger.ler;
        container.register(SOLICITACAO_NUMERARIO_EXECUCAO_REPOSITORY_TOKEN, {
            useValue: ledger.ledger,
        });
        const nde = buildNdeRepo();
        ndeRows = nde.rows;
        container.register(NDE_REPOSITORY_TOKEN, { useValue: nde.repo });

        const { default: recebimentosRouter } = await import('./recebimentos.js');
        const { errorMiddleware } = await import('../http/errorMiddleware.js');
        const app = express();
        app.use(express.json());
        app.use((req, _res, next) => {
            req.user = { sub: 'prod-e2e', role: 'admin', email: 'tech@kavex.at' };
            next();
        });
        app.use('/recebimentos', recebimentosRouter);
        app.use(errorMiddleware);
        appServer = await listen(app);
    });

    afterAll(async () => {
        await appServer?.close();
        relatorio.ledger = lerLedger?.() ?? null;
        relatorio.nde = ndeRows ?? null;
        writeFileSync(RELATORIO, JSON.stringify(relatorio, null, 2), 'utf8');
        // eslint-disable-next-line no-console
        console.log(`[PROD] relatório completo em ${RELATORIO}`);
        // eslint-disable-next-line no-console
        console.log(
            `[PROD] ledger persistido em ${LEDGER_ARQUIVO} — NÃO apague antes de conferir o ERP.`,
        );
    });

    it('executa a alocação real e emite a NDe', async () => {
        const res = await fetch(
            `${appServer.url}/recebimentos/transacoes/${txnId}/solicitacao-numerario`,
            {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({
                    priCod: caso.priCod,
                    valor: caso.valor,
                    filCod: caso.filCod,
                    pesCod: caso.pesCod,
                    dpeNomPessoa: caso.dpeNomPessoa,
                    moeCod: 790,
                }),
            },
        );
        const body = (await res.json()) as AnyRecord;
        relatorio.resposta = { status: res.status, body };
        // eslint-disable-next-line no-console
        console.log('[PROD] resposta da rota:', JSON.stringify(body, null, 2));
        // eslint-disable-next-line no-console
        console.log('[PROD] ledger final:', JSON.stringify(lerLedger(), null, 2));

        const linha = lerLedger()[0] ?? {};
        // eslint-disable-next-line no-console
        console.log(
            `[PROD] ===== PARA CONFERIR NO ERP =====\n` +
                `  SN (com299)   docCod ${String(linha.docCod ?? '-')}\n` +
                `  Borderô fin014 borCod ${String(linha.fin014BorCod ?? '-')}\n` +
                `  NDe (com297)  docCod ${String(linha.ndDocCod ?? '-')}\n` +
                `  etapa ${String(linha.etapa ?? '-')} · status ${String(linha.status ?? '-')} · ` +
                `NDe autorizada: ${String(linha.ndeAutorizado ?? '-')}`,
        );

        // O desfecho é REGISTRADO, não exigido: `settled` com `ndeAutorizado:false` é resultado válido
        // (a SEFAZ é assíncrona e reconcilia depois). O que não pode é passar despercebido.
        expect([200, 422]).toContain(res.status);
        expect(String(body.status ?? 'sem-status')).not.toBe('sem-status');
    });
});
