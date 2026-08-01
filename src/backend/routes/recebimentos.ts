import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { container } from 'tsyringe';
import { z } from 'zod';
import { bootstrapAppContainer } from '../domain/appContainer.js';
import {
    MATCH_CLASSIFICACAO,
    PAINEL_TRANSACOES_CAP,
    RECEBIMENTO_STATUS,
} from '../domain/interface/recebimentos/constants.js';
import type { Processo } from '../domain/interface/recebimentos/GerDocProcesso.js';
import type { Recebimento } from '../domain/interface/recebimentos/Recebimento.js';
import type { TransacaoBancaria } from '../domain/interface/recebimentos/TransacaoBancaria.js';
import { TRANSACAO_TIPO } from '../domain/interface/recebimentos/constants.js';
import type {
    ListCandidatosInput,
    ProcessoProviderInterface,
} from '../domain/interface/recebimentos/ports.js';
import type { ClienteProcesso } from '../domain/interface/recebimentos/ports.js';
import { PROCESSO_PROVIDER_TOKEN } from '../domain/interface/recebimentos/ports.js';
import ConexosCadastroClient from '../domain/client/ConexosCadastroClient.js';
import RecebimentoIngestaoRunRepository from '../domain/repository/recebimentos/RecebimentoIngestaoRunRepository.js';
import RecebimentosPainelService from '../domain/service/recebimentos/RecebimentosPainelService.js';
import IngestaoTransacoesService from '../domain/service/recebimentos/IngestaoTransacoesService.js';
import RecebimentoPipelineService from '../domain/service/recebimentos/RecebimentoPipelineService.js';
import SolicitacaoNumerarioService from '../domain/service/recebimentos/SolicitacaoNumerarioService.js';
import { asyncHandler } from '../http/asyncHandler.js';
import { requireRole } from '../http/auth.js';
import {
    FilialForbiddenError,
    type FilialScopedUser,
    assertUserCanActOnFilial,
    filiaisPermitidas,
} from '../http/filialAuthz.js';
import { heavyRouteLimiter } from '../http/rateLimit.js';
import { respondHandlerError } from '../http/respondHandlerError.js';

/**
 * Rotas Frente IV (Recebimentos) — SKELETON (base scaffold). Superfície fina: read (painel) + trigger
 * (pipeline run) que delega ao `RecebimentoPipelineService` (coordinator stubbed). NENHUMA lógica de
 * negócio na rota — Zod valida no boundary, o service coordena. Montada atrás do `recebimentosGate`
 * (403 quando desabilitado). Espelha `routes/sispag.ts`.
 */
const router = Router();

/**
 * Filiais que o usuário PODE varrer. Allow-list do token quando provisionada;
 * senão, todas as do ERP (`imp021`/login) — espelha `RecebimentosPainelService.resolverFilCods`.
 *
 * É o que torna o seletor de cliente do modal "Alocar" multi-filial: um crédito
 * cai numa filial, mas a encomenda do cliente pode estar em outra. Sem isto o
 * analista não acha o cliente e não consegue alocar.
 */
const resolverFilCodsAcessiveis = async (user: FilialScopedUser | undefined): Promise<number[]> => {
    const permitidas = filiaisPermitidas(user);
    if (permitidas && permitidas.length > 0) return permitidas;
    const cadastro = container.resolve(ConexosCadastroClient);
    const filiais = await cadastro.listFiliais();
    return filiais.map((f) => Number(f.filCod)).filter((n) => Number.isInteger(n) && n > 0);
};

/**
 * Resolve as filiais-alvo de uma rota "Alocar": um `filCod` explícito (autorizado)
 * limita a busca a ele; a ausência varre TODAS as filiais acessíveis. Lança
 * `FilialForbiddenError` quando o `filCod` pedido está fora da allow-list.
 */
const resolverFilCodsAlvo = async (
    user: FilialScopedUser | undefined,
    filCod?: number,
): Promise<number[]> => {
    if (filCod !== undefined) {
        assertUserCanActOnFilial(user, filCod);
        return [filCod];
    }
    return resolverFilCodsAcessiveis(user);
};

const painelQuerySchema = z.object({
    filCod: z.coerce.number().int().positive().optional(),
    limit: z.coerce.number().int().positive().max(PAINEL_TRANSACOES_CAP).optional(),
    /** `true` traz também o ruído de tesouraria (resgates, aplicações, transf. internas). */
    incluirTesouraria: z
        .enum(['true', 'false'])
        .optional()
        .transform((v) => v === 'true'),
});

/**
 * GET /recebimentos/painel — carteira de créditos, lida do BANCO.
 *
 * Ganhou authz por-filial: antes a rota não tinha nenhuma porque não devolvia
 * dado. Agora devolve movimento financeiro real.
 */
router.get(
    '/painel',
    asyncHandler(async (req, res) => {
        await bootstrapAppContainer();
        const parsed = painelQuerySchema.safeParse(req.query);
        if (!parsed.success) {
            res.status(400).json({ error: 'Query inválida', details: parsed.error.flatten() });
            return;
        }

        let filCodsPermitidas = filiaisPermitidas(req.user);
        if (parsed.data.filCod !== undefined) {
            try {
                assertUserCanActOnFilial(req.user, parsed.data.filCod);
            } catch (err) {
                if (err instanceof FilialForbiddenError) {
                    res.status(403).json({
                        error: 'Forbidden: filial não autorizada',
                        code: err.code,
                    });
                    return;
                }
                throw err;
            }
            filCodsPermitidas = [parsed.data.filCod];
        }

        const service = container.resolve(RecebimentosPainelService);
        res.json(
            await service.montarPainel({
                filCodsPermitidas,
                limit: parsed.data.limit,
                incluirTesouraria: parsed.data.incluirTesouraria,
            }),
        );
    }),
);

const runPipelineSchema = z.object({
    // UUID guard (Regis security-2): impede um ator envenenar uma chave `receb:X` sequencial/curta de
    // outro ator. A idempotency-key é namespaced pelo `sub` do usuário abaixo.
    correlationId: z.string().uuid(),
    filCod: z.coerce.number().int().positive(),
    valorRecebido: z.number(),
    dryRun: z.boolean().optional(),
    borVldTipo: z.coerce.number().int().positive(),
    contaDestino: z.string().min(1),
});

// POST /recebimentos/pipeline/run — dispara o coordinator stubbed. `Idempotency-Key` honrado
// downstream pelo ledger (recebimento_execucao). Write-ish → requireRole('admin') + heavyRouteLimiter.
router.post(
    '/pipeline/run',
    heavyRouteLimiter,
    requireRole('admin'),
    asyncHandler(async (req, res) => {
        await bootstrapAppContainer();
        const parsed = runPipelineSchema.safeParse(req.body);
        if (!parsed.success) {
            res.status(400).json({ error: 'Payload inválido', details: parsed.error.flatten() });
            return;
        }
        // Authz por-filial (Regis security-1): valida o `filCod` do body contra a filial-permitida do
        // usuário ANTES de agir (borderô/baixa/NDe). Sem isso, `requireRole('admin')` sozinho deixa um
        // analista mover dinheiro de outra filial só mudando o número.
        try {
            assertUserCanActOnFilial(req.user, parsed.data.filCod);
        } catch (err) {
            if (err instanceof FilialForbiddenError) {
                res.status(403).json({
                    error: 'Forbidden: filial não autorizada',
                    code: err.code,
                });
                return;
            }
            throw err;
        }
        const ator = req.user?.sub ?? req.user?.email ?? 'unknown';
        // Idempotency-key namespaced pelo ator (Regis security-2): a colisão exige colisão de `sub`
        // também — impede denial-of-execution / carona no ledger money-moving de outro ator. Um
        // `Idempotency-Key` de header explícito também é namespaced pelo sub.
        const headerKey = req.header('Idempotency-Key');
        const idempotencyKey = `receb:${ator}:${headerKey ?? parsed.data.correlationId}`;
        const now = new Date();

        const transacao: TransacaoBancaria = {
            id: idempotencyKey,
            correlationId: parsed.data.correlationId,
            filCod: parsed.data.filCod,
            dataMovimento: now,
            tipo: TRANSACAO_TIPO.CREDITO,
            valor: parsed.data.valorRecebido,
            moeda: 'BRL',
            naturalKey: idempotencyKey,
            rawPayload: null,
            normalized: null,
            status: 'importada',
            importadoEm: now,
        };
        const recebimento: Recebimento = {
            id: idempotencyKey,
            correlationId: parsed.data.correlationId,
            transacaoBancariaId: transacao.id,
            filCod: parsed.data.filCod,
            classificacaoMatch: MATCH_CLASSIFICACAO.NENHUMA,
            status: RECEBIMENTO_STATUS.RASCUNHO,
            valorRecebido: parsed.data.valorRecebido,
            valorAlocado: 0,
            diferencaNaoAlocada: parsed.data.valorRecebido,
            regrasAplicadas: [],
            rateios: [],
            versao: 0,
            criadoPor: ator,
            criadoEm: now,
        };

        const service = container.resolve(RecebimentoPipelineService);
        const result = await service.run({
            recebimento,
            transacao,
            documentosAbertos: [],
            ingestao: {
                filCod: parsed.data.filCod,
                periodo: { de: now, ate: now },
                correlationId: parsed.data.correlationId,
                triggeredBy: ator,
            },
            borVldTipo: parsed.data.borVldTipo,
            contaDestino: parsed.data.contaDestino,
            dryRun: parsed.data.dryRun ?? true,
            ator,
        });
        res.json({ recebimento: result });
    }),
);

// ─────────────────────────────────────────────── "Alocar" — processos candidatos + Solicitação de
// Numerário (encomenda) via com299/gerDocProcesso (DRY-RUN-ONLY).

const listCandidatosQuerySchema = z.object({
    /** Opcional: ausente = varre TODAS as filiais acessíveis (multi-filial). */
    filCod: z.coerce.number().int().positive().optional(),
    /** Cliente escolhido pelo analista — filtro FORTE, caminho principal. */
    pesCod: z.coerce.number().int().positive().optional(),
    /** Dica do histórico do extrato — match frouxo, compatibilidade. */
    contraparte: z.string().min(1).optional(),
});

const listClientesQuerySchema = z.object({
    /** Opcional: ausente = clientes com processo em QUALQUER filial acessível. */
    filCod: z.coerce.number().int().positive().optional(),
});

/**
 * GET /recebimentos/clientes — clientes com processo aberto (`imp021`).
 *
 * Alimenta o seletor do modal "Alocar". Existe porque o extrato bancário não
 * carrega `pesCod` nem CNPJ: quem liga crédito↔cliente é o analista.
 *
 * Multi-filial: sem `filCod` varre TODAS as filiais acessíveis e agrega por
 * cliente (o provider é por-filial). O crédito cai numa filial, mas a encomenda
 * do cliente pode estar em outra — restringir à filial da transação escondia
 * clientes válidos do analista.
 */
router.get(
    '/clientes',
    asyncHandler(async (req, res) => {
        await bootstrapAppContainer();
        const parsed = listClientesQuerySchema.safeParse(req.query);
        if (!parsed.success) {
            res.status(400).json({ error: 'Query inválida', details: parsed.error.flatten() });
            return;
        }
        let filCods: number[];
        try {
            filCods = await resolverFilCodsAlvo(req.user, parsed.data.filCod);
        } catch (err) {
            if (err instanceof FilialForbiddenError) {
                res.status(403).json({ error: 'Forbidden: filial não autorizada', code: err.code });
                return;
            }
            throw err;
        }
        const provider = container.resolve<ProcessoProviderInterface>(PROCESSO_PROVIDER_TOKEN);
        // Agrega por `pesCod` sobre as filiais acessíveis. Sequencial de propósito:
        // o provider varre o `imp021` por filial (cacheado por TTL) e um fan-out
        // paralelo recria o burst de sessões que a Frente II já mitigou.
        const porCliente = new Map<number, ClienteProcesso>();
        for (const filCod of filCods) {
            for (const c of await provider.listClientes({ filCod })) {
                const atual = porCliente.get(c.pesCod);
                if (atual) {
                    atual.processosAbertos += c.processosAbertos;
                    if (!atual.filiais?.includes(filCod)) atual.filiais?.push(filCod);
                } else {
                    porCliente.set(c.pesCod, { ...c, filiais: [filCod] });
                }
            }
        }
        const clientes = [...porCliente.values()].sort((a, b) =>
            a.dpeNomPessoa.localeCompare(b.dpeNomPessoa, 'pt-BR'),
        );
        res.json({ clientes });
    }),
);

/**
 * GET /recebimentos/transacoes/:txnId/processos — lista os PROCESSOS candidatos para a transação
 * (modal "Alocar"). READ-only (sem admin), mas mantém a authz por-filial: um `filCod` explícito é
 * validado contra a allow-list; a ausência varre TODAS as filiais acessíveis (multi-filial, para
 * casar com o seletor de clientes). Cada `Processo` carrega o próprio `filCod` — a SN gerada herda a
 * filial DO PROCESSO, não a da transação. Fonte real: `imp021` filtrado por `pesCod`.
 */
router.get(
    '/transacoes/:txnId/processos',
    asyncHandler(async (req, res) => {
        await bootstrapAppContainer();
        const parsed = listCandidatosQuerySchema.safeParse(req.query);
        if (!parsed.success) {
            res.status(400).json({ error: 'Query inválida', details: parsed.error.flatten() });
            return;
        }
        let filCods: number[];
        try {
            filCods = await resolverFilCodsAlvo(req.user, parsed.data.filCod);
        } catch (err) {
            if (err instanceof FilialForbiddenError) {
                res.status(403).json({ error: 'Forbidden: filial não autorizada', code: err.code });
                return;
            }
            throw err;
        }
        const provider = container.resolve<ProcessoProviderInterface>(PROCESSO_PROVIDER_TOKEN);
        // Sequencial: o provider varre o `imp021` por filial (cache TTL). Cada linha
        // já traz seu `filCod`, então concatenar preserva a filial de cada processo.
        const processos: Processo[] = [];
        for (const filCod of filCods) {
            const input: ListCandidatosInput = {
                filCod,
                pesCod: parsed.data.pesCod,
                contraparte: parsed.data.contraparte,
            };
            processos.push(...(await provider.listCandidatosParaTransacao(input)));
        }
        res.json({ transacaoId: req.params.txnId, processos });
    }),
);

const gerarSolicitacaoNumerarioSchema = z.object({
    filCod: z.coerce.number().int().positive(),
    priCod: z.coerce.number().int().positive(),
    priEspRefcliente: z.string().optional(),
    pesCod: z.coerce.number().int().positive(),
    dpeNomPessoa: z.string().min(1),
    /** Moeda do PROCESSO (BRL/790 assumida) — NÃO é o `moeCod` do doc SN, que é `null`. */
    moeCod: z.coerce.number().int().positive(),
    /** Base da SN — valor cru da transação (o servidor totaliza o rateio líquido no com299). */
    valorTransacao: z.number(),
    /** Chave de correlação estável por "Processar" — semente do idempotencyKey (write-ahead B2). */
    correlationId: z.string().uuid().optional(),
});

/**
 * POST /recebimentos/transacoes/:txnId/solicitacao-numerario — "Processar" um processo → CONSTRÓI o
 * payload `GerDocProcessoSelectionDTOCab` da Solicitação de Numerário (encomenda) e o DEVOLVE em
 * DRY-RUN. NUNCA envia ao Conexos (não há caminho de escrita alcançável nesta iteração). Write-ish →
 * `requireRole('admin')` + `heavyRouteLimiter` + authz por-filial (mesmo padrão do pipeline/run),
 * embora seja apenas simulação.
 */
router.post(
    '/transacoes/:txnId/solicitacao-numerario',
    heavyRouteLimiter,
    requireRole('admin'),
    asyncHandler(async (req, res) => {
        await bootstrapAppContainer();
        const parsed = gerarSolicitacaoNumerarioSchema.safeParse(req.body);
        if (!parsed.success) {
            res.status(400).json({ error: 'Payload inválido', details: parsed.error.flatten() });
            return;
        }
        try {
            assertUserCanActOnFilial(req.user, parsed.data.filCod);
        } catch (err) {
            if (err instanceof FilialForbiddenError) {
                res.status(403).json({ error: 'Forbidden: filial não autorizada', code: err.code });
                return;
            }
            throw err;
        }
        const ator = req.user?.sub ?? req.user?.email ?? 'unknown';
        // Idempotency-key namespaced pelo ator (Regis security-2), semente = header `Idempotency-Key`
        // ou o `correlationId` do corpo (estável por "Processar"). Aqui é DRY-RUN: a chave é derivada e
        // ECOADA (sem escrita no ledger) — o write-ahead `beginExecution` vive no orquestrador live
        // (B2), quando a migração 0041 estiver aplicada. Ver ontology/integrations/conexos-com299-gerdoc.md.
        const headerKey = req.header('Idempotency-Key');
        const idempotencyKey = `sn:${ator}:${headerKey ?? parsed.data.correlationId ?? randomUUID()}`;
        const service = container.resolve(SolicitacaoNumerarioService);
        // DRY-RUN: só constrói e devolve o payload — nenhum POST no ERP.
        const result = await service.gerar({
            processo: {
                priCod: parsed.data.priCod,
                priEspRefcliente: parsed.data.priEspRefcliente,
                filCod: parsed.data.filCod,
                pesCod: parsed.data.pesCod,
                dpeNomPessoa: parsed.data.dpeNomPessoa,
                moeCod: parsed.data.moeCod,
            },
            valorTransacao: parsed.data.valorTransacao,
            dataReferencia: new Date(),
            ator,
        });
        res.json({ transacaoId: req.params.txnId, idempotencyKey, ...result });
    }),
);

// ─────────────────────────────────────────────────────── Ingestão do extrato (Módulo 1)

const ingestaoSchema = z.object({
    /** Vazio = todas as filiais configuradas/do ERP. */
    filCods: z.array(z.coerce.number().int().positive()).optional(),
    /** Sobrescreve a janela default (`RECEBIMENTO_INGEST_DIAS`) — útil para backfill. */
    dias: z.coerce.number().int().positive().max(365).optional(),
});

/**
 * POST /recebimentos/ingestao — dispara a ingestão do extrato (equivalente manual
 * do cron `job:ingest-extratos`).
 *
 * READ-ONLY no ERP: a única escrita é o Postgres próprio. Concorrência protegida
 * por advisory lock — uma segunda chamada enquanto a primeira roda recebe **409**
 * via `IngestLockBusyError`, em vez de dobrar o fan-out contra o Conexos.
 */
router.post(
    '/ingestao',
    heavyRouteLimiter,
    requireRole('admin'),
    asyncHandler(async (req, res) => {
        await bootstrapAppContainer();
        const parsed = ingestaoSchema.safeParse(req.body ?? {});
        if (!parsed.success) {
            res.status(400).json({ error: 'Body inválido', details: parsed.error.flatten() });
            return;
        }

        const service = container.resolve(IngestaoTransacoesService);
        const filCods = parsed.data.filCods ?? (await service.resolverFilCods());
        try {
            // Authz por filial ANTES de qualquer leitura — um admin de uma filial
            // não dispara ingestão de outra só trocando o body.
            for (const filCod of filCods) assertUserCanActOnFilial(req.user, filCod);
        } catch (err) {
            if (err instanceof FilialForbiddenError) {
                res.status(403).json({ error: 'Forbidden: filial não autorizada', code: err.code });
                return;
            }
            throw err;
        }

        const runRepo = container.resolve(RecebimentoIngestaoRunRepository);
        const idempotencyKey = req.header('Idempotency-Key');
        if (idempotencyKey) {
            const existente = await runRepo.findRunIdByIdempotencyKey(idempotencyKey);
            if (existente) {
                res.json({ runId: existente, reaproveitada: true });
                return;
            }
        }

        const periodo = await service.resolverPeriodo(parsed.data.dias);
        try {
            const result = await service.runMany({
                filCods,
                periodo,
                correlationId: randomUUID(),
                triggeredBy: req.user?.email ?? req.user?.sub ?? 'manual',
            });
            if (idempotencyKey) await runRepo.recordIdempotencyKey(idempotencyKey, result.runId);
            res.json({
                runId: result.runId,
                filCods,
                periodo: { de: periodo.de.toISOString(), ate: periodo.ate.toISOString() },
                total: result.total,
                deduplicadas: result.deduplicadas,
            });
        } catch (err) {
            if (respondHandlerError(req, res, err)) return;
            throw err;
        }
    }),
);

const runsQuerySchema = z.object({
    limit: z.coerce.number().int().positive().max(100).default(20),
});

/** GET /recebimentos/ingestao/runs — trilha de auditoria das ingestões. */
router.get(
    '/ingestao/runs',
    asyncHandler(async (req, res) => {
        await bootstrapAppContainer();
        const parsed = runsQuerySchema.safeParse(req.query);
        if (!parsed.success) {
            res.status(400).json({ error: 'Query inválida', details: parsed.error.flatten() });
            return;
        }
        const runRepo = container.resolve(RecebimentoIngestaoRunRepository);
        res.json({ runs: await runRepo.listRecentRuns(parsed.data.limit) });
    }),
);

export default router;
