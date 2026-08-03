import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { type RequestHandler, Router } from 'express';
import multer from 'multer';
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
import type {
    ClienteProcesso,
    SolicitacaoNumerarioExecucaoRepositoryInterface,
} from '../domain/interface/recebimentos/ports.js';
import {
    PROCESSO_PROVIDER_TOKEN,
    SOLICITACAO_NUMERARIO_EXECUCAO_REPOSITORY_TOKEN,
} from '../domain/interface/recebimentos/ports.js';
import ConexosCadastroClient from '../domain/client/ConexosCadastroClient.js';
import RecebimentoIngestaoRunRepository from '../domain/repository/recebimentos/RecebimentoIngestaoRunRepository.js';
import RecebimentosPainelService from '../domain/service/recebimentos/RecebimentosPainelService.js';
import IngestaoTransacoesService from '../domain/service/recebimentos/IngestaoTransacoesService.js';
import ImportacaoExtratoArquivoService from '../domain/service/recebimentos/ImportacaoExtratoArquivoService.js';
import RecebimentoPipelineService from '../domain/service/recebimentos/RecebimentoPipelineService.js';
import NumerarioAclChecker from '../domain/service/recebimentos/NumerarioAclChecker.js';
import RecebimentoNumerarioService from '../domain/service/recebimentos/RecebimentoNumerarioService.js';
import TransacaoRepository from '../domain/repository/recebimentos/TransacaoRepository.js';
import EnvironmentProvider from '../domain/libs/environment/EnvironmentProvider.js';
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

const solicitacaoNumerarioSchema = z.object({
    /** Nº do processo de importação (imp021) que recebe a alocação. */
    priCod: z.coerce.number().int().positive(),
    /** Valor alocado a ESTE processo (split-capable — uma alocação por chamada). */
    valor: z.number().positive(),
    /**
     * Filial DO PROCESSO escolhido (imp021) — pode diferir da filial do pagamento. TODO o fluxo
     * Conexos (com299 SN → fin014 → com297 + cauda fiscal → homologar → poll) roda NESTA filial;
     * o pagamento é só a fonte de `gerNum`/`valor`. A conta financeira (`gerNum`) é global (fin133
     * devolve os mesmos gerNums entre filiais), então continua válida aqui, sem baixa cross-filial.
     */
    filCod: z.coerce.number().int().positive(),
    priEspRefcliente: z.string().optional(),
    pesCod: z.coerce.number().int().positive(),
    dpeNomPessoa: z.string().min(1),
    /** Moeda do PROCESSO (BRL/790 assumida) — NÃO é o `moeCod` do doc SN, que é `null`. */
    moeCod: z.coerce.number().int().positive(),
    /**
     * CNPJ da pessoa (`pdcDocFederal`) e endereço fiscal (`endCodFis`) do com299 — OPCIONAIS: o imp021
     * não os expõe (GAP de fonte). Quando o front os tiver, envia aqui; senão o payload os OMITE.
     */
    pdcDocFederal: z.string().optional(),
    endCodFis: z.coerce.number().int().positive().optional(),
    /** Força dry-run mesmo com a escrita ligada (preview sob demanda). */
    dryRun: z.boolean().optional(),
});

/**
 * POST /recebimentos/transacoes/:txnId/solicitacao-numerario — "Processar" UMA alocação (pagamento ×
 * processo): roda o fluxo REAL do numerário (com299 SN → fin014 baixa na conta DO PAGAMENTO → com297
 * NDe → leg fiscal → homologar → poll SEFAZ) via `RecebimentoNumerarioService`. Split-capable: cada
 * chamada aloca um `valor` a um `priCod`.
 *
 * Carrega a transação (`TransacaoRepository.findById`) → `gerNum`/`valor`; **422 se `gerNum` ausente**
 * (o pagamento sem conta financeira não pode baixar). Authz: `heavyRouteLimiter` + `requireRole('admin')`
 * + `assertUserCanActOnFilial` (filial DO PROCESSO). Antes de qualquer escrita (não-dry-run), pré-flight
 * de ACL da conta de serviço (fail-closed, gated por `NDE_ACL_PREFLIGHT`). HTTP 200 mesmo em erro de
 * etapa (o `status` carrega o resultado); um re-POST com o mesmo corpo RETOMA (idempotência por alocação).
 */
router.post(
    '/transacoes/:txnId/solicitacao-numerario',
    heavyRouteLimiter,
    requireRole('admin'),
    asyncHandler(async (req, res) => {
        await bootstrapAppContainer();
        const parsed = solicitacaoNumerarioSchema.safeParse(req.body);
        if (!parsed.success) {
            res.status(400).json({ error: 'Payload inválido', details: parsed.error.flatten() });
            return;
        }
        const txnId = String(req.params.txnId);

        // Carrega a transação (pagamento): fonte da conta financeira (gerNum) e da filial.
        const transacaoRepo = container.resolve(TransacaoRepository);
        const transacao = await transacaoRepo.findById(txnId);
        if (!transacao) {
            res.status(404).json({ error: 'Transação não encontrada', txnId });
            return;
        }
        if (transacao.gerNum === undefined) {
            res.status(422).json({
                error: 'Transação sem conta financeira (gerNum) — não é possível baixar o recebimento',
                txnId,
            });
            return;
        }

        // Authz por-filial: a SN/baixa/NDe herdam a filial DO PROCESSO (não a da transação). O
        // processo pode viver numa filial diferente do pagamento — o front envia o `filCod` do
        // processo escolhido no modal "Alocar". Sem isto, `validaProcessoPessoa` procurava o
        // ImpProcesso na filial do pagamento e devolvia RECORDNOTFOUND (500).
        const processoFilCod = parsed.data.filCod;
        try {
            assertUserCanActOnFilial(req.user, processoFilCod);
        } catch (err) {
            if (err instanceof FilialForbiddenError) {
                res.status(403).json({ error: 'Forbidden: filial não autorizada', code: err.code });
                return;
            }
            throw err;
        }

        const ator = req.user?.sub ?? req.user?.email ?? 'unknown';
        const env = await container.resolve(EnvironmentProvider).getEnvironmentVars();
        const dryRun = parsed.data.dryRun === true || !env.conexosWriteEnabled || env.conexosDryRun;

        // Pré-flight de ACL ANTES de qualquer escrita (só na execução REAL). Fail-closed; gated por env.
        if (!dryRun && env.ndeAclPreflight) {
            const acl = await container
                .resolve(NumerarioAclChecker)
                .verificar({ filCod: processoFilCod });
            if (!acl.ok) {
                res.status(403).json({
                    error: 'Forbidden: conta de serviço sem permissões (com300/com131/com297/com194)',
                    code: 'NDE_ACL_INSUFICIENTE',
                    ...(acl.motivo !== undefined ? { motivo: acl.motivo } : {}),
                });
                return;
            }
        }

        const service = container.resolve(RecebimentoNumerarioService);
        const result = await service.processarAlocacao({
            txnId,
            transacao: {
                gerNum: transacao.gerNum,
                filCod: transacao.filCod,
                valor: transacao.valor,
            },
            priCod: parsed.data.priCod,
            valor: parsed.data.valor,
            processoFields: {
                filCod: processoFilCod,
                ...(parsed.data.priEspRefcliente !== undefined
                    ? { priEspRefcliente: parsed.data.priEspRefcliente }
                    : {}),
                pesCod: parsed.data.pesCod,
                dpeNomPessoa: parsed.data.dpeNomPessoa,
                moeCod: parsed.data.moeCod,
                ...(parsed.data.pdcDocFederal !== undefined
                    ? { pdcDocFederal: parsed.data.pdcDocFederal }
                    : {}),
                ...(parsed.data.endCodFis !== undefined
                    ? { endCodFis: parsed.data.endCodFis }
                    : {}),
            },
            ator,
            ...(parsed.data.dryRun === true ? { dryRunOverride: true } : {}),
        });
        // HTTP 200 mesmo em erro de etapa — o `status` carrega o desfecho (settled/skipped/error/dry-run).
        res.json({ transacaoId: txnId, ...result });
    }),
);

/**
 * GET /recebimentos/execucoes — AUDITORIA do ledger de execução da SN (por transação ou por status).
 * `?txnId=` → todas as alocações daquela transação; `?status=error|reconciling|settled|pending` → as N
 * mais recentes. Cada linha traz status, etapa, doc_cod (SN), nd_doc_cod (NDe), erro_mensagem, erp_response,
 * revisao_humana, nde_autorizado — a trilha completa p/ auditar um sucesso ou uma falha sem SQL.
 */
const execucoesQuerySchema = z
    .object({
        txnId: z.string().min(1).optional(),
        status: z.enum(['pending', 'reconciling', 'settled', 'error']).optional(),
        limit: z.coerce.number().int().positive().max(200).optional(),
    })
    .refine((q) => q.txnId !== undefined || q.status !== undefined, {
        message: 'Informe txnId ou status',
    });

router.get(
    '/execucoes',
    requireRole('admin'),
    asyncHandler(async (req, res) => {
        await bootstrapAppContainer();
        const parsed = execucoesQuerySchema.safeParse(req.query);
        if (!parsed.success) {
            res.status(400).json({ error: 'Query inválida', details: parsed.error.flatten() });
            return;
        }
        const repo = container.resolve<SolicitacaoNumerarioExecucaoRepositoryInterface>(
            SOLICITACAO_NUMERARIO_EXECUCAO_REPOSITORY_TOKEN,
        );
        if (parsed.data.txnId !== undefined) {
            res.json({ execucoes: await repo.listByTxnId(parsed.data.txnId) });
            return;
        }
        if (parsed.data.status !== undefined) {
            res.json({
                execucoes: await repo.listByStatus(parsed.data.status, parsed.data.limit ?? 50),
            });
            return;
        }
        res.status(400).json({ error: 'Informe txnId ou status' });
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

// ───────────────────────────────── Ingestão por UPLOAD manual (.xlsx) — canal alternativo

/** Teto do upload: extratos são pequenos (KBs). 10MB cobre folga sem virar vetor de DoS de memória. */
const UPLOAD_MAX_BYTES = 10 * 1024 * 1024;

const uploadExtrato = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: UPLOAD_MAX_BYTES, files: 1 },
    fileFilter: (_req, file, cb) => {
        if (!/\.xlsx$/i.test(file.originalname)) {
            cb(new Error('Apenas arquivos .xlsx são aceitos.'));
            return;
        }
        cb(null, true);
    },
}).single('file');

/** Roda o multer e converte erros (arquivo grande, extensão inválida) em 400 — não em 500. */
const comUploadExtrato: RequestHandler = (req, res, next) => {
    uploadExtrato(req, res, (err: unknown) => {
        if (err) {
            const message =
                err instanceof multer.MulterError
                    ? `Upload inválido: ${err.code}`
                    : err instanceof Error
                      ? err.message
                      : 'Upload inválido';
            res.status(400).json({ error: message });
            return;
        }
        next();
    });
};

/** `filCod` chega como campo de formulário (string) ao lado do arquivo. */
const uploadFilCodSchema = z.object({
    filCod: z.coerce.number().int().positive(),
});

/**
 * A confirmação aceita também `excluirLinhas` — o `linhaIndice` dos créditos que o analista
 * desmarcou no preview. Chega como JSON stringificado (FormData só carrega string/Blob).
 */
const uploadImportSchema = uploadFilCodSchema.extend({
    excluirLinhas: z.preprocess((v) => {
        if (v === undefined || v === '') return undefined;
        if (typeof v !== 'string') return v;
        try {
            return JSON.parse(v);
        } catch {
            return v; // deixa o zod rejeitar como array inválido
        }
    }, z.array(z.number().int().nonnegative()).optional()),
});

/**
 * Valida presença + extensão do arquivo e o corpo (via `schema`), com authz por filial. Devolve o
 * contexto pronto, ou `undefined` após já ter respondido o erro.
 */
const resolverUpload = <TSchema extends z.ZodType<{ filCod: number }>>(
    req: Parameters<RequestHandler>[0],
    res: Parameters<RequestHandler>[1],
    schema: TSchema,
): ({ buffer: Buffer; arquivoNome: string } & z.infer<TSchema>) | undefined => {
    const file = req.file;
    if (!file) {
        res.status(400).json({ error: 'Arquivo .xlsx obrigatório (campo "file").' });
        return undefined;
    }
    const parsed = schema.safeParse(req.body ?? {});
    if (!parsed.success) {
        res.status(400).json({ error: 'Parâmetros inválidos', details: parsed.error.flatten() });
        return undefined;
    }
    try {
        assertUserCanActOnFilial(req.user, parsed.data.filCod);
    } catch (err) {
        if (err instanceof FilialForbiddenError) {
            res.status(403).json({ error: 'Forbidden: filial não autorizada', code: err.code });
            return undefined;
        }
        throw err;
    }
    return { buffer: file.buffer, arquivoNome: file.originalname, ...parsed.data };
};

/**
 * POST /recebimentos/ingestao/upload/preview — dry-run do upload: parseia o extrato, classifica
 * novos × já importados e devolve uma amostra. NÃO escreve nada (confirm-before-commit).
 */
router.post(
    '/ingestao/upload/preview',
    heavyRouteLimiter,
    requireRole('admin'),
    comUploadExtrato,
    asyncHandler(async (req, res) => {
        await bootstrapAppContainer();
        const ctx = resolverUpload(req, res, uploadFilCodSchema);
        if (!ctx) return;
        const service = container.resolve(ImportacaoExtratoArquivoService);
        res.json(await service.preview(ctx));
    }),
);

/**
 * POST /recebimentos/ingestao/upload — importa efetivamente os créditos do extrato .xlsx.
 *
 * Canal MANUAL, alternativo ao fin095 automático — alimenta a MESMA `transacao_bancaria`.
 * Idempotente por hash do arquivo (`Idempotency-Key` opcional). Concorrência protegida pelo MESMO
 * advisory lock do canal automático → **409** (`IngestLockBusyError`) se houver ingestão rodando.
 */
router.post(
    '/ingestao/upload',
    heavyRouteLimiter,
    requireRole('admin'),
    comUploadExtrato,
    asyncHandler(async (req, res) => {
        await bootstrapAppContainer();
        const ctx = resolverUpload(req, res, uploadImportSchema);
        if (!ctx) return;
        const service = container.resolve(ImportacaoExtratoArquivoService);
        const idempotencyKey = req.header('Idempotency-Key') ?? undefined;
        try {
            const result = await service.importar({
                ...ctx,
                triggeredBy: req.user?.email ?? req.user?.sub ?? 'manual',
                ...(idempotencyKey ? { idempotencyKey } : {}),
            });
            res.json(result);
        } catch (err) {
            if (respondHandlerError(req, res, err)) return;
            throw err;
        }
    }),
);

export default router;
