import 'reflect-metadata';
import type { Request, Response } from 'express';
import { Router } from 'express';
import { container } from 'tsyringe';
import { z } from 'zod';
import { bootstrapAppContainer } from '../domain/appContainer.js';
import ConexosSispagClient from '../domain/client/ConexosSispagClient.js';
import { isHandlerError } from '../domain/libs/handler/HandlerError.js';
import ConciliacaoExecucaoRepository from '../domain/repository/sispag/ConciliacaoExecucaoRepository.js';
import PagamentoIngestaoRunRepository from '../domain/repository/sispag/PagamentoIngestaoRunRepository.js';
import RemessaExecucaoRepository from '../domain/repository/sispag/RemessaExecucaoRepository.js';
import FormacaoLotesService from '../domain/service/sispag/FormacaoLotesService.js';
import IngestaoPagamentosService from '../domain/service/sispag/IngestaoPagamentosService.js';
import LotePagamentoService from '../domain/service/sispag/LotePagamentoService.js';
import ConciliacaoRetornoService from '../domain/service/sispag/ConciliacaoRetornoService.js';
import DebitDateService from '../domain/service/sispag/DebitDateService.js';
import RemessaService from '../domain/service/sispag/RemessaService.js';
import SispagPainelService from '../domain/service/sispag/SispagPainelService.js';
import { asyncHandler } from '../http/asyncHandler.js';
import { requireRole } from '../http/auth.js';
import { heavyRouteLimiter } from '../http/rateLimit.js';

/**
 * Rotas SISPAG (Escopo II) — SPIKE READ-ONLY (semente da Fatia 1).
 *
 * Só leitura: monta o painel de pagamentos (títulos a pagar, lotes SISPAG
 * nativos, borderôs) a partir do Conexos. NENHUMA rota de escrita/execução —
 * o fluxo (montar/finalizar/enviar/baixar) é SIMULADO no frontend. Quando a
 * Fatia 3 chegar, a escrita entra gated (`CONEXOS_WRITE_ENABLED`), como em
 * Permutas. Ver `ontology/_inbox/sispag-*.md`.
 */
const router = Router();

// GET /sispag/painel — painel diário read-only (dados ao vivo do Conexos).
router.get(
    '/painel',
    asyncHandler(async (_req, res) => {
        await bootstrapAppContainer();
        const service = container.resolve(SispagPainelService);
        const painel = await service.montarPainel();
        res.json(painel);
    }),
);

// GET /sispag/retornos — arquivos de retorno (.RET) do fin052, ao vivo. READ-ONLY.
router.get(
    '/retornos',
    asyncHandler(async (_req, res) => {
        await bootstrapAppContainer();
        const service = container.resolve(SispagPainelService);
        const arquivos = await service.listRetornos();
        res.json({ arquivos });
    }),
);

// GET /sispag/lotes/:id/modalidades-disponiveis — formas de pgto. do favorecido por título
// (A2 opção B), lidas ao vivo do Conexos. READ-ONLY.
/**
 * Linhas digitáveis dos boletos do lote. Só devolve algo depois da remessa gerada — o ERP
 * anexa o código ao item no import (ADR-0040). Em rascunho a lista é vazia, e isso é o
 * estágio, não um erro: o serviço nunca lança.
 */
router.get(
    '/lotes/:id/linhas-digitaveis',
    // Mesmo raciocínio do download do `.REM`: a linha digitável é destino de pagamento —
    // carrega banco, agência e conta do cedente no campo livre, além do valor. Sem o guard,
    // um loop de `curl` extrai a carteira de boletos da Columbia. LGPD Art. 6º e LC 105.
    requireRole('admin'),
    asyncHandler(async (req, res) => {
        await bootstrapAppContainer();
        const service = container.resolve(SispagPainelService);
        const itens = await service.linhasDigitaveisDoLote(String(req.params.id));
        res.json({ itens });
    }),
);

router.get(
    '/lotes/:id/modalidades-disponiveis',
    asyncHandler(async (req, res) => {
        await bootstrapAppContainer();
        const service = container.resolve(SispagPainelService);
        const itens = await service.modalidadesDisponiveisDoLote(String(req.params.id));
        res.json({ itens });
    }),
);

// ===================================================== Fatia 2 — Lotes candidatos
// Montagem assistida + gate. Estado LOCAL — NENHUMA escrita no Conexos (I1).

const ator = (req: Request): string => req.user?.sub ?? req.user?.email ?? 'unknown';

/**
 * Autor de uma escrita que fica na trilha da retenção (ADR-0050, ADR-0006): `sub` do JWT
 * verificado, com fallback no `email`. Sem nenhum dos dois devolve `undefined` e a rota recusa
 * com 401 — a retenção não aceita autor `'unknown'`. Mesmo contrato da exceção de Permutas.
 */
const autorDoToken = (req: Request): string | undefined => {
    const sub = req.user?.sub?.trim();
    if (sub) return sub;
    const email = req.user?.email?.trim();
    return email ? email : undefined;
};

const IDENTIDADE_AUSENTE = {
    error: 'IDENTIDADE_AUSENTE',
    message: 'Não foi possível identificar o usuário no token. Entre de novo e repita a ação.',
};

/** Chave do título na URL (`/:filCod/:docCod/:titCod`) — Zod no boundary. */
const chaveTituloSchema = z.object({
    filCod: z.coerce.number().int().positive(),
    docCod: z.string().trim().min(1),
    titCod: z.string().trim().min(1),
});

/**
 * Corpo do "Retirar do lote" (ADR-0050 D6): só o motivo, opcional, até 500 caracteres. Motivo em
 * branco vale como ausente. Autor e data vêm do JWT e do servidor, nunca do corpo.
 */
const retirarDoLoteSchema = z.object({
    motivo: z
        .string()
        .trim()
        .max(500)
        .optional()
        .transform((m) => (m ? m : undefined)),
});

/** Mapeia um erro de domínio (HandlerError) para a resposta HTTP; senão devolve false. */
const respondLoteError = (req: Request, res: Response, err: unknown): boolean => {
    if (!isHandlerError(err)) return false;
    res.status(err.statusCode).json({
        error: err.userMessage,
        code: err.code,
        retryable: err.retryable,
        ...(err.details !== undefined ? { details: err.details } : {}),
        ...(req.header('x-request-id') ? { requestId: req.header('x-request-id') } : {}),
    });
    return true;
};

const criarLoteSchema = z.object({
    filCod: z.coerce.number().int().positive(),
    banco: z.string().trim().min(1).optional(),
    conta: z.string().trim().min(1).optional(),
});
const listLotesSchema = z.object({
    status: z.enum(['RASCUNHO', 'FINALIZADO', 'CANCELADO']).optional(),
    filCod: z.coerce.number().int().positive().optional(),
});
const incluirTituloSchema = z.object({
    filCod: z.coerce.number().int().positive(),
    docCod: z.string().trim().min(1),
    titCod: z.string().trim().min(1),
});
const versaoSchema = z.object({ versao: z.coerce.number().int().min(1) });
const contaPagadoraSchema = z.object({
    versao: z.coerce.number().int().min(1),
    banco: z.string().trim().min(1),
    conta: z.string().trim().min(1),
});
const modalidadeSchema = z.object({
    versao: z.coerce.number().int().min(1),
    modalidade: z.enum(['BOLETO', 'TED', 'PIX', 'CREDITO_CONTA']),
});

// GET /sispag/lotes — lista lotes candidatos (?status=&filCod=). Leitura.
router.get(
    '/lotes',
    asyncHandler(async (req, res) => {
        await bootstrapAppContainer();
        const parsed = listLotesSchema.safeParse(req.query);
        if (!parsed.success) {
            res.status(400).json({ error: 'invalid query', details: parsed.error.flatten() });
            return;
        }
        const service = container.resolve(LotePagamentoService);
        res.json({ lotes: await service.listarLotes(parsed.data) });
    }),
);

// GET /sispag/lotes/:id — um lote com itens.
router.get(
    '/lotes/:id',
    asyncHandler(async (req, res) => {
        await bootstrapAppContainer();
        const service = container.resolve(LotePagamentoService);
        const lote = await service.getLote(String(req.params.id));
        if (!lote) {
            res.status(404).json({ error: 'lote not found' });
            return;
        }
        res.json({ lote });
    }),
);

// POST /sispag/lotes — cria um lote candidato (RASCUNHO). admin.
router.post(
    '/lotes',
    requireRole('admin'),
    asyncHandler(async (req, res) => {
        await bootstrapAppContainer();
        const parsed = criarLoteSchema.safeParse(req.body);
        if (!parsed.success) {
            res.status(400).json({ error: 'invalid body', details: parsed.error.flatten() });
            return;
        }
        const service = container.resolve(LotePagamentoService);
        const lote = await service.criarLote({ ...parsed.data, ator: ator(req) });
        res.status(201).json({ lote });
    }),
);

// POST /sispag/lotes/:id/itens — inclui um título no lote. admin.
router.post(
    '/lotes/:id/itens',
    requireRole('admin'),
    asyncHandler(async (req, res) => {
        await bootstrapAppContainer();
        const parsed = incluirTituloSchema.safeParse(req.body);
        if (!parsed.success) {
            res.status(400).json({ error: 'invalid body', details: parsed.error.flatten() });
            return;
        }
        const service = container.resolve(LotePagamentoService);
        try {
            const lote = await service.incluirTitulo({
                loteId: String(req.params.id),
                ...parsed.data,
                ator: ator(req),
            });
            res.json({ lote });
        } catch (err) {
            if (!respondLoteError(req, res, err)) throw err;
        }
    }),
);

// DELETE /sispag/lotes/:id/itens/:filCod/:docCod/:titCod — remove um título. admin.
router.delete(
    '/lotes/:id/itens/:filCod/:docCod/:titCod',
    requireRole('admin'),
    asyncHandler(async (req, res) => {
        await bootstrapAppContainer();
        const filCod = Number(req.params.filCod);
        if (!Number.isInteger(filCod) || filCod <= 0) {
            res.status(400).json({ error: 'invalid filCod' });
            return;
        }
        // Num lote automático a remoção grava a retenção (ADR-0050), que exige autor real.
        const autor = autorDoToken(req);
        if (autor === undefined) {
            res.status(401).json(IDENTIDADE_AUSENTE);
            return;
        }
        const service = container.resolve(LotePagamentoService);
        try {
            const lote = await service.removerTitulo({
                loteId: String(req.params.id),
                filCod,
                docCod: String(req.params.docCod),
                titCod: String(req.params.titCod),
                ator: autor,
            });
            res.json({ lote });
        } catch (err) {
            if (!respondLoteError(req, res, err)) throw err;
        }
    }),
);

// POST /sispag/titulos/:filCod/:docCod/:titCod/retirar-do-lote — "Retirar do lote" na aba de
// títulos (ADR-0050 D3): remove o título do lote RASCUNHO em que está e o retém da formação
// automática, numa transação. Admin. 400 chave/corpo inválido · 401 sem identidade · 409 título
// fora de lote ou lote fora de RASCUNHO.
router.post(
    '/titulos/:filCod/:docCod/:titCod/retirar-do-lote',
    requireRole('admin'),
    asyncHandler(async (req, res) => {
        await bootstrapAppContainer();
        const chave = chaveTituloSchema.safeParse(req.params);
        const corpo = retirarDoLoteSchema.safeParse(req.body ?? {});
        if (!chave.success || !corpo.success) {
            res.status(400).json({
                error: 'invalid request',
                details: (chave.success ? corpo : chave).error?.flatten(),
            });
            return;
        }
        const autor = autorDoToken(req);
        if (autor === undefined) {
            res.status(401).json(IDENTIDADE_AUSENTE);
            return;
        }
        const service = container.resolve(LotePagamentoService);
        try {
            const lote = await service.retirarDoLote({
                ...chave.data,
                ...(corpo.data.motivo !== undefined ? { motivo: corpo.data.motivo } : {}),
                ator: autor,
            });
            res.json({ lote });
        } catch (err) {
            if (!respondLoteError(req, res, err)) throw err;
        }
    }),
);

// DELETE /sispag/titulos/:filCod/:docCod/:titCod/retencao — "Liberar" (ADR-0050 D5): encerra a
// retenção ativa (soft delete, motivo 'liberado'). Admin. 400 · 401 · 404 sem retenção ativa.
router.delete(
    '/titulos/:filCod/:docCod/:titCod/retencao',
    requireRole('admin'),
    asyncHandler(async (req, res) => {
        await bootstrapAppContainer();
        const chave = chaveTituloSchema.safeParse(req.params);
        if (!chave.success) {
            res.status(400).json({ error: 'invalid request', details: chave.error.flatten() });
            return;
        }
        const autor = autorDoToken(req);
        if (autor === undefined) {
            res.status(401).json(IDENTIDADE_AUSENTE);
            return;
        }
        const service = container.resolve(LotePagamentoService);
        try {
            await service.liberarRetencao({ ...chave.data, ator: autor });
            res.json({ liberado: true });
        } catch (err) {
            if (!respondLoteError(req, res, err)) throw err;
        }
    }),
);

// POST /sispag/lotes/:id/{finalizar|reabrir|cancelar} — transições (gate). admin.
for (const acao of ['finalizar', 'reabrir', 'cancelar', 'retorno'] as const) {
    router.post(
        `/lotes/:id/${acao}`,
        requireRole('admin'),
        asyncHandler(async (req, res) => {
            await bootstrapAppContainer();
            const parsed = versaoSchema.safeParse(req.body);
            if (!parsed.success) {
                res.status(400).json({
                    error: 'invalid body (versao)',
                    details: parsed.error.flatten(),
                });
                return;
            }
            const service = container.resolve(LotePagamentoService);
            const input = {
                loteId: String(req.params.id),
                versao: parsed.data.versao,
                ator: ator(req),
            };
            try {
                const lote =
                    acao === 'finalizar'
                        ? await service.finalizarLote(input)
                        : acao === 'reabrir'
                          ? await service.reabrirLote(input)
                          : acao === 'retorno'
                            ? await service.marcarRetorno(input)
                            : await service.cancelarLote(input);
                res.json({ lote });
            } catch (err) {
                if (!respondLoteError(req, res, err)) throw err;
            }
        }),
    );
}

// POST /sispag/lotes/:id/itens/:filCod/:docCod/:titCod/modalidade — define a forma de
// pagamento de um item (A2, só RASCUNHO; optimistic lock). admin.
router.post(
    '/lotes/:id/itens/:filCod/:docCod/:titCod/modalidade',
    requireRole('admin'),
    asyncHandler(async (req, res) => {
        await bootstrapAppContainer();
        const filCod = Number(req.params.filCod);
        if (!Number.isInteger(filCod) || filCod <= 0) {
            res.status(400).json({ error: 'invalid filCod' });
            return;
        }
        const parsed = modalidadeSchema.safeParse(req.body);
        if (!parsed.success) {
            res.status(400).json({
                error: 'invalid body (versao, modalidade)',
                details: parsed.error.flatten(),
            });
            return;
        }
        const service = container.resolve(LotePagamentoService);
        try {
            const lote = await service.atualizarModalidadeItem({
                loteId: String(req.params.id),
                filCod,
                docCod: String(req.params.docCod),
                titCod: String(req.params.titCod),
                modalidade: parsed.data.modalidade,
                versao: parsed.data.versao,
                ator: ator(req),
            });
            res.json({ lote });
        } catch (err) {
            if (!respondLoteError(req, res, err)) throw err;
        }
    }),
);

// POST /sispag/lotes/:id/conta — troca a conta pagadora do lote (A3, só RASCUNHO). admin.
router.post(
    '/lotes/:id/conta',
    requireRole('admin'),
    asyncHandler(async (req, res) => {
        await bootstrapAppContainer();
        const parsed = contaPagadoraSchema.safeParse(req.body);
        if (!parsed.success) {
            res.status(400).json({
                error: 'invalid body (versao, banco, conta)',
                details: parsed.error.flatten(),
            });
            return;
        }
        const service = container.resolve(LotePagamentoService);
        try {
            const lote = await service.atualizarContaPagadora({
                loteId: String(req.params.id),
                versao: parsed.data.versao,
                banco: parsed.data.banco,
                conta: parsed.data.conta,
                ator: ator(req),
            });
            res.json({ lote });
        } catch (err) {
            if (!respondLoteError(req, res, err)) throw err;
        }
    }),
);

// ===================================================== Ingestão de Pagamentos
// Cadência da carteira (cron + manual). Só LEITURA do ERP; escreve só no Postgres.

// POST /sispag/ingestao — dispara a ingestão manual (grava run + idempotência).
// Honra o header `Idempotency-Key`; `IngestLockBusyError` → 409 (já rodando).
router.post(
    '/ingestao',
    requireRole('admin'),
    heavyRouteLimiter,
    asyncHandler(async (req, res) => {
        await bootstrapAppContainer();
        const service = container.resolve(IngestaoPagamentosService);
        const idempotencyKey = req.header('Idempotency-Key') ?? undefined;
        try {
            const result = await service.executar({ triggeredBy: ator(req), idempotencyKey });
            res.json(result);
        } catch (err) {
            if (!respondLoteError(req, res, err)) throw err;
        }
    }),
);

// POST /sispag/lotes/formar — forma lotes candidatos automaticamente (cron/manual).
// Mesmas regras da montagem (I4, só a vencer ≤7d). `IngestLockBusyError` → 409.
router.post(
    '/lotes/formar',
    requireRole('admin'),
    heavyRouteLimiter,
    asyncHandler(async (req, res) => {
        await bootstrapAppContainer();
        const service = container.resolve(FormacaoLotesService);
        try {
            const result = await service.formar({ triggeredBy: ator(req) });
            res.json(result);
        } catch (err) {
            if (!respondLoteError(req, res, err)) throw err;
        }
    }),
);

// GET /sispag/ingestao/runs — trilha de auditoria das ingestões (?limit=).
router.get(
    '/ingestao/runs',
    asyncHandler(async (req, res) => {
        await bootstrapAppContainer();
        const limit = Math.min(Number(req.query.limit) || 10, 50);
        const repo = container.resolve(PagamentoIngestaoRunRepository);
        res.json({ runs: await repo.listRecentRuns(limit) });
    }),
);

// GET /sispag/contas-pagadoras?filCod= — contas correntes da filial (fin005). Leitura.
// A tela usava uma lista FIXA de duas contas (Itaú e Santander) enquanto a filial tem 17.
// Um favorecido só recebe se a conta pagadora for do MESMO banco da conta dele — com a
// lista fixa, todo favorecido de outro banco ficava impossível de pagar pela tela.
router.get(
    '/contas-pagadoras',
    // Dado bancário da EMPRESA (17 contas na filial 2). As rotas irmãs de escrita já exigem
    // admin; a assimetria era o defeito — leitura de conta corrente não é menos sensível que
    // escrita. Quando existir um papel `viewer`, reavaliar se esta rota o aceita.
    requireRole('admin'),
    asyncHandler(async (req, res) => {
        await bootstrapAppContainer();
        const filCod = Number(req.query.filCod);
        if (!Number.isInteger(filCod) || filCod <= 0) {
            res.status(400).json({ error: 'filCod obrigatório' });
            return;
        }
        const service = container.resolve(ConexosSispagClient);
        res.json({ contas: await service.listContasCorrentes(filCod) });
    }),
);

// ===================================================== Fatia 3 — REMESSA e CONCILIAÇÃO
// ESCRITA no Conexos. Gated por `conexosWriteEnabled`/`conexosDryRun` no serviço; dry-run é
// o default seguro (monta e loga o payload, sem POST).

const conciliarSchema = z.object({
    bncCod: z.coerce.number().int().positive(),
    gtbCodSeq: z.coerce.number().int().nonnegative(),
    garCodSeq: z.coerce.number().int().nonnegative(),
    filCod: z.coerce.number().int().positive(),
    /** Chama o `processar` do ERP antes de conciliar — é o que gera as BAIXAS no fin010. */
    processar: z.coerce.boolean().optional(),
    dryRun: z.coerce.boolean().optional(),
});

/**
 * Data civil `AAAA-MM-DD` que existe no calendário (recusa 2026-02-30). Checagem de forma só:
 * janela e dia útil são regra de domínio e ficam no `DebitDateService`.
 */
const civilDateSchema = z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .refine((s) => {
        const d = new Date(`${s}T00:00:00Z`);
        return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
    }, 'data inexistente');

/**
 * Só `dataDebito` é validado aqui. `dryRun`/`confirmarNovoLote` seguem com a leitura estrita
 * `=== true` de antes (passthrough): mudar o contrato deles não é escopo da ADR-0049.
 */
const gerarRemessaSchema = z.object({ dataDebito: civilDateSchema.optional() }).passthrough();

// GET /sispag/lotes/:id/remessa/janela — janela permitida da data de débito (I8). Leitura.
// Mesma autenticação das outras leituras de lote. Não consulta o ERP: usa o snapshot do lote.
router.get(
    '/lotes/:id/remessa/janela',
    asyncHandler(async (req, res) => {
        await bootstrapAppContainer();
        const service = container.resolve(DebitDateService);
        try {
            res.json(await service.getWindow(String(req.params.id)));
        } catch (err) {
            if (!respondLoteError(req, res, err)) throw err;
        }
    }),
);

// POST /sispag/lotes/:id/remessa — gera a remessa .REM do lote FINALIZADO. admin.
// Honra `Idempotency-Key`; sem ele a chave é derivada do lote (duas tentativas colidem
// de propósito — é o que impede duas remessas para o mesmo lote).
router.post(
    '/lotes/:id/remessa',
    requireRole('admin'),
    heavyRouteLimiter,
    asyncHandler(async (req, res) => {
        await bootstrapAppContainer();
        const parsed = gerarRemessaSchema.safeParse(req.body ?? {});
        if (!parsed.success) {
            res.status(400).json({ error: 'invalid body', details: parsed.error.flatten() });
            return;
        }
        const service = container.resolve(RemessaService);
        try {
            const result = await service.gerarRemessa({
                loteId: String(req.params.id),
                ator: ator(req),
                // I8 (ADR-0049): ausente = o serviço usa o primeiro dia útil da janela.
                ...(parsed.data.dataDebito !== undefined
                    ? { dataDebito: parsed.data.dataDebito }
                    : {}),
                ...(req.header('Idempotency-Key')
                    ? { idempotencyKey: req.header('Idempotency-Key') as string }
                    : {}),
                ...(req.header('x-request-id')
                    ? { correlationId: req.header('x-request-id') as string }
                    : {}),
                ...(req.body?.dryRun === true ? { dryRunOverride: true } : {}),
                // Segundo clique da tela quando o lote anterior foi cancelado no ERP.
                // Deliberadamente NÃO tem default: a confirmação tem que ser explícita.
                ...(req.body?.confirmarNovoLote === true ? { confirmarNovoLote: true } : {}),
            });
            res.json(result);
        } catch (err) {
            if (!respondLoteError(req, res, err)) throw err;
        }
    }),
);

// GET /sispag/lotes/:id/remessa/arquivo — conteúdo do .REM já gerado (CNAB 240). Leitura.
router.get(
    '/lotes/:id/remessa/arquivo',
    // O `.REM` é um CNAB 240 com CNPJ, banco, agência e conta de CADA FORNECEDOR pago.
    // Sem este guard, qualquer usuário autenticado extraía a carteira de fornecedores da
    // Columbia com um loop de `curl` — LGPD Art. 6º e sigilo bancário (LC 105).
    requireRole('admin'),
    asyncHandler(async (req, res) => {
        await bootstrapAppContainer();
        const service = container.resolve(RemessaService);
        const arquivo = await service.baixarArquivo(String(req.params.id));
        if (!arquivo) {
            res.status(404).json({ error: 'lote sem remessa gerada' });
            return;
        }
        res.setHeader('Content-Type', 'text/plain; charset=latin1');
        res.setHeader('Content-Disposition', `attachment; filename="${arquivo.nomeArquivo}"`);
        // Buffer, não string. Com string o Express REESCREVE o charset para utf-8 e
        // codifica os bytes em UTF-8 — e o CNAB 240 é posicional: um "Ç" no nome do
        // favorecido viraria 2 bytes e empurraria todas as colunas seguintes daquele
        // registro. O banco recusa o arquivo, ou pior, lê os campos deslocados.
        res.send(Buffer.from(arquivo.conteudo, 'latin1'));
    }),
);

// POST /sispag/retornos/conciliar — lê o detalhe do .RET e traz o resultado para os lotes. admin.
// Honra `Idempotency-Key`; sem ele o serviço deriva a chave do próprio arquivo de retorno —
// que é a identidade certa: o risco é reprocessar o MESMO arquivo, não a mesma requisição.
router.post(
    '/retornos/conciliar',
    requireRole('admin'),
    heavyRouteLimiter,
    asyncHandler(async (req, res) => {
        await bootstrapAppContainer();
        const parsed = conciliarSchema.safeParse(req.body);
        if (!parsed.success) {
            res.status(400).json({ error: 'invalid body', details: parsed.error.flatten() });
            return;
        }
        const service = container.resolve(ConciliacaoRetornoService);
        try {
            const result = await service.conciliar({
                filCod: parsed.data.filCod,
                bncCod: parsed.data.bncCod,
                gtbCodSeq: parsed.data.gtbCodSeq,
                garCodSeq: parsed.data.garCodSeq,
                ator: ator(req),
                ...(parsed.data.processar !== undefined
                    ? { processar: parsed.data.processar }
                    : {}),
                ...(parsed.data.dryRun === true ? { dryRunOverride: true } : {}),
                ...(req.header('Idempotency-Key')
                    ? { idempotencyKey: String(req.header('Idempotency-Key')) }
                    : {}),
                ...(req.header('x-request-id')
                    ? { correlationId: String(req.header('x-request-id')) }
                    : {}),
            });
            res.json(result);
        } catch (err) {
            if (!respondLoteError(req, res, err)) throw err;
        }
    }),
);

// GET /sispag/execucoes?status=&limit= — trilha dos DOIS ledgers (remessa e conciliação). admin.
//
// Existe porque o fail-closed protege mas não avisa: quando uma execução fica presa em
// `reconciling`, a única forma de descobrir era um operador esbarrar no 409 da tela, ou
// alguém com acesso ao Supabase rodar SQL na mão. Aqui a lista fica visível — e o job
// `reaper-sispag-reconciling` consome a mesma consulta para logar sozinho.
//
// Não age: só mostra. Cancelar um lote órfão no ERP é decisão humana, e continua sendo.
const execucoesSchema = z.object({
    status: z.enum(['pending', 'reconciling', 'settled', 'error']).optional(),
    limit: z.coerce.number().int().positive().max(200).optional(),
    /** Só execuções `reconciling` paradas há mais de N minutos (triagem de órfão). */
    paradasHaMin: z.coerce.number().int().positive().max(10_080).optional(),
});

router.get(
    '/execucoes',
    requireRole('admin'),
    asyncHandler(async (req, res) => {
        await bootstrapAppContainer();
        const parsed = execucoesSchema.safeParse(req.query);
        if (!parsed.success) {
            res.status(400).json({ error: 'invalid query', details: parsed.error.flatten() });
            return;
        }
        const limit = parsed.data.limit ?? 50;
        const remessaRepo = container.resolve(RemessaExecucaoRepository);
        const conciliacaoRepo = container.resolve(ConciliacaoExecucaoRepository);

        if (parsed.data.paradasHaMin !== undefined) {
            const min = parsed.data.paradasHaMin;
            res.json({
                remessa: await remessaRepo.listReconcilingParadas(min, limit),
                conciliacao: await conciliacaoRepo.listReconcilingParadas(min, limit),
            });
            return;
        }
        if (parsed.data.status !== undefined) {
            res.json({
                remessa: await remessaRepo.listByStatus(parsed.data.status, limit),
                conciliacao: await conciliacaoRepo.listByStatus(parsed.data.status, limit),
            });
            return;
        }
        res.status(400).json({ error: 'Informe status ou paradasHaMin' });
    }),
);

export default router;
