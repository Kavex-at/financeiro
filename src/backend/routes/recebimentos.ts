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
import type { Recebimento } from '../domain/interface/recebimentos/Recebimento.js';
import type { TransacaoBancaria } from '../domain/interface/recebimentos/TransacaoBancaria.js';
import { TRANSACAO_TIPO } from '../domain/interface/recebimentos/constants.js';
import type {
    ListCandidatosInput,
    ProcessoProviderInterface,
} from '../domain/interface/recebimentos/ports.js';
import { PROCESSO_PROVIDER_TOKEN } from '../domain/interface/recebimentos/ports.js';
import RecebimentoIngestaoRunRepository from '../domain/repository/recebimentos/RecebimentoIngestaoRunRepository.js';
import RecebimentosPainelService from '../domain/service/recebimentos/RecebimentosPainelService.js';
import IngestaoTransacoesService from '../domain/service/recebimentos/IngestaoTransacoesService.js';
import RecebimentoPipelineService from '../domain/service/recebimentos/RecebimentoPipelineService.js';
import SolicitacaoNumerarioService from '../domain/service/recebimentos/SolicitacaoNumerarioService.js';
import { asyncHandler } from '../http/asyncHandler.js';
import { requireRole } from '../http/auth.js';
import {
    FilialForbiddenError,
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
    filCod: z.coerce.number().int().positive(),
    /** Cliente escolhido pelo analista — filtro FORTE, caminho principal. */
    pesCod: z.coerce.number().int().positive().optional(),
    /** Dica do histórico do extrato — match frouxo, compatibilidade. */
    contraparte: z.string().min(1).optional(),
});

const listClientesQuerySchema = z.object({
    filCod: z.coerce.number().int().positive(),
});

/**
 * GET /recebimentos/clientes — clientes com processo aberto na filial (`imp021`).
 *
 * Alimenta o seletor do modal "Alocar". Existe porque o extrato bancário não
 * carrega `pesCod` nem CNPJ: quem liga crédito↔cliente é o analista.
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
        try {
            assertUserCanActOnFilial(req.user, parsed.data.filCod);
        } catch (err) {
            if (err instanceof FilialForbiddenError) {
                res.status(403).json({ error: 'Forbidden: filial não autorizada', code: err.code });
                return;
            }
            throw err;
        }
        const provider = container.resolve<ProcessoProviderInterface>(PROCESSO_PROVIDER_TOKEN);
        res.json({ clientes: await provider.listClientes({ filCod: parsed.data.filCod }) });
    }),
);

/**
 * GET /recebimentos/transacoes/:txnId/processos — lista os PROCESSOS candidatos para a transação
 * (modal "Alocar"). READ-only (sem admin), mas mantém a authz por-filial: o `filCod` vem da query e
 * é validado contra a filial-permitida do usuário. Fonte real: `imp021` filtrado por `pesCod`.
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
        try {
            assertUserCanActOnFilial(req.user, parsed.data.filCod);
        } catch (err) {
            if (err instanceof FilialForbiddenError) {
                res.status(403).json({ error: 'Forbidden: filial não autorizada', code: err.code });
                return;
            }
            throw err;
        }
        const provider = container.resolve<ProcessoProviderInterface>(PROCESSO_PROVIDER_TOKEN);
        const input: ListCandidatosInput = {
            filCod: parsed.data.filCod,
            pesCod: parsed.data.pesCod,
            contraparte: parsed.data.contraparte,
        };
        const processos = await provider.listCandidatosParaTransacao(input);
        res.json({ transacaoId: req.params.txnId, processos });
    }),
);

const gerarSolicitacaoNumerarioSchema = z.object({
    filCod: z.coerce.number().int().positive(),
    priCod: z.coerce.number().int().positive(),
    priEspRefcliente: z.string().optional(),
    pesCod: z.coerce.number().int().positive(),
    dpeNomPessoa: z.string().min(1),
    moeCod: z.coerce.number().int().positive(),
    /** Base da SN — valor cru da transação (regra de % da encomenda é não-resolvida). */
    valorTransacao: z.number(),
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
        const service = container.resolve(SolicitacaoNumerarioService);
        // DRY-RUN: só constrói e devolve o payload — nenhum POST no ERP.
        const result = service.gerar({
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
        res.json({ transacaoId: req.params.txnId, ...result });
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
