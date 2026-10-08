import 'reflect-metadata';
import type { Request, Response } from 'express';
import { Router } from 'express';
import { container } from 'tsyringe';
import { z } from 'zod';
import { bootstrapAppContainer } from '../domain/appContainer.js';
import ConexosSispagClient from '../domain/client/ConexosSispagClient.js';
import EnvironmentProvider from '../domain/libs/environment/EnvironmentProvider.js';
import { isHandlerError } from '../domain/libs/handler/HandlerError.js';
import ConciliacaoExecucaoRepository from '../domain/repository/sispag/ConciliacaoExecucaoRepository.js';
import PagamentoIngestaoRunRepository from '../domain/repository/sispag/PagamentoIngestaoRunRepository.js';
import RemessaExecucaoRepository from '../domain/repository/sispag/RemessaExecucaoRepository.js';
import { BOLETO_DDA_ESCOPO } from '../domain/interface/sispag/BoletoDda.js';
import BoletoDdaService from '../domain/service/sispag/BoletoDdaService.js';
import {
    BOLETO_DDA_TAMANHO_MAX,
    BOLETO_DDA_TAMANHO_PADRAO,
    DATA_CIVIL_REGEX,
    SITUACOES_FILTRAVEIS,
} from '../domain/service/sispag/PaginacaoBoletoDda.js';
import FormacaoLotesService from '../domain/service/sispag/FormacaoLotesService.js';
import CarteiraAtualizacaoService from '../domain/service/sispag/CarteiraAtualizacaoService.js';
import IngestaoPagamentosService from '../domain/service/sispag/IngestaoPagamentosService.js';
import AuthorizationCandidatesService from '../domain/service/sispag/AuthorizationCandidatesService.js';
import AuthorizedPayeeService from '../domain/service/sispag/AuthorizedPayeeService.js';
import type { AuthorizedPayee } from '../domain/interface/sispag/AuthorizedPayeeInterface.js';

type AuthorizedPayeeApiView = Omit<AuthorizedPayee, 'fingerprint' | 'fingerprintObservado'>;
import LotePagamentoApiView from '../domain/service/sispag/LotePagamentoApiView.js';
import LotePagamentoService from '../domain/service/sispag/LotePagamentoService.js';
import ConciliacaoRetornoService from '../domain/service/sispag/ConciliacaoRetornoService.js';
import DebitDateService from '../domain/service/sispag/DebitDateService.js';
import RemessaService from '../domain/service/sispag/RemessaService.js';
import RemessaTitulosExportService from '../domain/service/sispag/RemessaTitulosExportService.js';
import {
    type ContextoExport,
    MAX_LOTES_EXPORT,
} from '../domain/interface/sispag/RemessaTitulosExport.js';
import TitulosAPagarExportService from '../domain/service/sispag/TitulosAPagarExportService.js';
import { MAX_TITULOS_EXPORT } from '../domain/interface/sispag/TitulosAPagarExport.js';
import SispagPainelService from '../domain/service/sispag/SispagPainelService.js';
import SincronizacaoLoteService from '../domain/service/sispag/SincronizacaoLoteService.js';
import { PERMISSION } from '../domain/interface/auth/Permission.js';
import { DUPLICATE_ACTION } from '../domain/interface/sispag/SispagInterface.js';
import DuplicateResolutionService from '../domain/service/sispag/DuplicateResolutionService.js';
import {
    AprovarAutorizacaoSchema,
    AutorizacaoIdSchema,
    CandidatosQuerySchema,
    DecidirAutorizacaoSchema,
    FiltroAutorizacoesSchema,
    SolicitarAutorizacaoSchema,
} from '../http/schemas.js';
import { asyncHandler } from '../http/asyncHandler.js';
import { exigirPermissao } from '../http/acesso.js';
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
    exigirPermissao(PERMISSION.SISPAG_VER),
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
    exigirPermissao(PERMISSION.SISPAG_VER),
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
    // A linha digitável é destino de pagamento (banco, agência e conta do cedente no campo livre,
    // além do valor), mas conferir boleto faz parte de acompanhar o lote: basta `sispag:ver`
    // (decisão do dono do ciclo, ADR-0053). Quem não tem `ver` não passa; o download do `.REM`
    // continua em `sispag:executar`.
    exigirPermissao(PERMISSION.SISPAG_VER),
    asyncHandler(async (req, res) => {
        await bootstrapAppContainer();
        const service = container.resolve(SispagPainelService);
        const { itens, total, dropped } = await service.linhasDigitaveisDoLote(
            String(req.params.id),
        );
        // `total`/`dropped` viajam junto para a tela poder dizer POR QUE faltou um botão.
        res.json({ itens, total, dropped });
    }),
);

router.get(
    '/lotes/:id/modalidades-disponiveis',
    exigirPermissao(PERMISSION.SISPAG_VER),
    asyncHandler(async (req, res) => {
        await bootstrapAppContainer();
        const service = container.resolve(SispagPainelService);
        const itens = await service.modalidadesDisponiveisDoLote(String(req.params.id));
        res.json({ itens });
    }),
);

// ===================================================== Fatia 2 — Lotes candidatos
// Montagem assistida + gate. Estado LOCAL — NENHUMA escrita no Conexos (I1).

const ator = (req: Request): string => req.user?.sub ?? 'unknown';

/**
 * Toda resposta com lote passa por aqui (ADR-0054 I10h): o destino digitado sai só mascarado.
 * Resolvido por chamada — o container dos testes troca instâncias entre casos.
 */
const apiView = (): LotePagamentoApiView => container.resolve(LotePagamentoApiView);

/** Chave do título na URL (`/:filCod/:docCod/:titCod`) — Zod no boundary. */
const chaveTituloSchema = z.object({
    filCod: z.coerce.number().int().positive(),
    docCod: z.string().trim().min(1),
    titCod: z.string().trim().min(1),
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
    // ADR-0064: título em outro lote RASCUNHO sai de lá e entra neste, atomicamente.
    mover: z.boolean().optional(),
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
    exigirPermissao(PERMISSION.SISPAG_VER),
    asyncHandler(async (req, res) => {
        await bootstrapAppContainer();
        const parsed = listLotesSchema.safeParse(req.query);
        if (!parsed.success) {
            res.status(400).json({ error: 'invalid query', details: parsed.error.flatten() });
            return;
        }
        const service = container.resolve(LotePagamentoService);
        res.json({ lotes: apiView().lotes(await service.listarLotes(parsed.data)) });
    }),
);

// GET /sispag/lotes/:id — um lote com itens.
router.get(
    '/lotes/:id',
    exigirPermissao(PERMISSION.SISPAG_VER),
    asyncHandler(async (req, res) => {
        await bootstrapAppContainer();
        const service = container.resolve(LotePagamentoService);
        const lote = await service.getLote(String(req.params.id));
        if (!lote) {
            res.status(404).json({ error: 'lote not found' });
            return;
        }
        res.json({ lote: apiView().lote(lote) });
    }),
);

// POST /sispag/lotes — cria um lote candidato (RASCUNHO). admin.
router.post(
    '/lotes',
    exigirPermissao(PERMISSION.SISPAG_EXECUTAR),
    asyncHandler(async (req, res) => {
        await bootstrapAppContainer();
        const parsed = criarLoteSchema.safeParse(req.body);
        if (!parsed.success) {
            res.status(400).json({ error: 'invalid body', details: parsed.error.flatten() });
            return;
        }
        const service = container.resolve(LotePagamentoService);
        const lote = await service.criarLote({ ...parsed.data, ator: ator(req) });
        res.status(201).json({ lote: apiView().lote(lote) });
    }),
);

// POST /sispag/lotes/:id/itens — inclui um título no lote (`mover: true` o tira do lote RASCUNHO
// em que está, na mesma transação — ADR-0064). admin. 409 título em outro lote / comprometido.
router.post(
    '/lotes/:id/itens',
    exigirPermissao(PERMISSION.SISPAG_EXECUTAR),
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
            res.json({ lote: apiView().lote(lote) });
        } catch (err) {
            if (!respondLoteError(req, res, err)) throw err;
        }
    }),
);

// DELETE /sispag/lotes/:id/itens/:filCod/:docCod/:titCod — remove um título. admin.
router.delete(
    '/lotes/:id/itens/:filCod/:docCod/:titCod',
    exigirPermissao(PERMISSION.SISPAG_EXECUTAR),
    asyncHandler(async (req, res) => {
        await bootstrapAppContainer();
        const filCod = Number(req.params.filCod);
        if (!Number.isInteger(filCod) || filCod <= 0) {
            res.status(400).json({ error: 'invalid filCod' });
            return;
        }
        const service = container.resolve(LotePagamentoService);
        try {
            const lote = await service.removerTitulo({
                loteId: String(req.params.id),
                filCod,
                docCod: String(req.params.docCod),
                titCod: String(req.params.titCod),
                ator: ator(req),
            });
            res.json({ lote: apiView().lote(lote) });
        } catch (err) {
            if (!respondLoteError(req, res, err)) throw err;
        }
    }),
);

// POST /sispag/titulos/:filCod/:docCod/:titCod/retirar-do-lote — "Retirar do lote" na aba de
// títulos (ADR-0050): remove o título do lote RASCUNHO em que está, com as regras da lixeira.
// Admin. 400 chave inválida · 409 título fora de lote ou lote fora de RASCUNHO.
router.post(
    '/titulos/:filCod/:docCod/:titCod/retirar-do-lote',
    exigirPermissao(PERMISSION.SISPAG_EXECUTAR),
    asyncHandler(async (req, res) => {
        await bootstrapAppContainer();
        const chave = chaveTituloSchema.safeParse(req.params);
        if (!chave.success) {
            res.status(400).json({ error: 'invalid request', details: chave.error.flatten() });
            return;
        }
        const service = container.resolve(LotePagamentoService);
        try {
            const lote = await service.retirarDoLote({ ...chave.data, ator: ator(req) });
            res.json({ lote: apiView().lote(lote) });
        } catch (err) {
            if (!respondLoteError(req, res, err)) throw err;
        }
    }),
);

// POST /sispag/lotes/:id/{finalizar|reabrir|cancelar} — transições (gate). admin.
for (const acao of ['finalizar', 'reabrir', 'cancelar'] as const) {
    router.post(
        `/lotes/:id/${acao}`,
        exigirPermissao(PERMISSION.SISPAG_EXECUTAR),
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
                if (acao === 'finalizar') {
                    // ADR-0065 L3: o lote finaliza com os restantes; a resposta lista os itens que
                    // a verificação do favorecido autorizado retirou (vazio quando nenhum saiu).
                    const { lote, retirados } = await service.finalizarLote(input);
                    res.json({ lote: apiView().lote(lote), retirados });
                    return;
                }
                const lote =
                    acao === 'reabrir'
                        ? await service.reabrirLote(input)
                        : await service.cancelarLote(input);
                res.json({ lote: apiView().lote(lote) });
            } catch (err) {
                if (!respondLoteError(req, res, err)) throw err;
            }
        }),
    );
}

// POST /sispag/lotes/:id/retorno — L7 `marcarRetorno` APOSENTADA (ADR-0055). Levava o lote a
// RETORNADO sem .RET, sem chave nativa e sem baixa, e dali nada o tirava. O retorno real chega
// pela sincronização. 410 (e não 404) para quem ainda tiver a tela antiga em cache saber o motivo.
router.post(
    '/lotes/:id/retorno',
    exigirPermissao(PERMISSION.SISPAG_EXECUTAR),
    (_req: Request, res: Response) => {
        res.status(410).json({
            error: 'A marcação manual de retorno foi descontinuada. Use "Sincronizar agora" no card do lote: o status passa a seguir a baixa dos títulos no Conexos.',
            code: 'LOTE_RETORNO_MANUAL_APOSENTADO',
        });
    },
);

// POST /sispag/lotes/:id/sincronizar — "Sincronizar agora" (L11, ADR-0055). admin.
// READ-ONLY no ERP: lê o título (fin064), o retorno (fin052) e as baixas (PSQ_018) e grava só o
// que observou. 404 lote inexistente · 409 conflito de versão ou lote fora de REMESSA_GERADA/
// RETORNADO/BAIXADO (convenção dos erros de lote).
const loteIdSchema = z.object({ id: z.string().uuid() });
router.post(
    '/lotes/:id/sincronizar',
    exigirPermissao(PERMISSION.SISPAG_EXECUTAR),
    heavyRouteLimiter,
    asyncHandler(async (req, res) => {
        await bootstrapAppContainer();
        const parsed = loteIdSchema.safeParse(req.params);
        if (!parsed.success) {
            res.status(400).json({ error: 'invalid lote id', details: parsed.error.flatten() });
            return;
        }
        const service = container.resolve(SincronizacaoLoteService);
        try {
            const sincronizado = await service.sincronizarLote(parsed.data.id);
            if (!sincronizado) {
                res.status(404).json({ error: 'lote not found' });
                return;
            }
            res.json({
                lote: apiView().lote(sincronizado.lote),
                resumo: sincronizado.resultado,
            });
        } catch (err) {
            if (!respondLoteError(req, res, err)) throw err;
        }
    }),
);

// POST /sispag/lotes/:id/itens/:filCod/:docCod/:titCod/modalidade — define a forma de
// pagamento de um item (A2, só RASCUNHO; optimistic lock). admin.
router.post(
    '/lotes/:id/itens/:filCod/:docCod/:titCod/modalidade',
    exigirPermissao(PERMISSION.SISPAG_EXECUTAR),
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
            res.json({ lote: apiView().lote(lote) });
        } catch (err) {
            if (!respondLoteError(req, res, err)) throw err;
        }
    }),
);

// ===================================================== ADR-0063 — verificação TED/PIX
// O ator é SEMPRE o usuário autenticado (`req.user.sub`): o Zod descarta campo desconhecido, então
// um "ator" mandado no body é ignorado. Nada aqui escreve no Conexos.

const resolucaoAlertaSchema = z
    .object({
        acao: z.enum([DUPLICATE_ACTION.JUSTIFICAR, DUPLICATE_ACTION.RETIRAR]),
        justificativa: z.string().max(2000).optional(),
    })
    .refine(
        (b) => b.acao !== DUPLICATE_ACTION.JUSTIFICAR || (b.justificativa ?? '').trim() !== '',
        {
            message: 'justificativa obrigatória para JUSTIFICAR',
            path: ['justificativa'],
        },
    );
const alertaParamsSchema = chaveTituloSchema.extend({
    id: z.string().uuid(),
    alertaId: z.string().uuid(),
});
const motivoSchema = z.object({ motivo: z.string().trim().min(1).max(2000) });

// POST /sispag/lotes/:id/itens/:filCod/:docCod/:titCod/alertas/:alertaId/resolucao — a analista
// trata UMA alerta de duplicidade (I13f): JUSTIFICAR (texto obrigatório; o item fica) ou RETIRAR (o
// item sai e o título fica bloqueado até o cancelamento no Conexos). Só RASCUNHO.
// 400 body · 404 alerta · 409 alerta já tratada / lote fora de RASCUNHO.
router.post(
    '/lotes/:id/itens/:filCod/:docCod/:titCod/alertas/:alertaId/resolucao',
    exigirPermissao(PERMISSION.SISPAG_EXECUTAR),
    asyncHandler(async (req, res) => {
        await bootstrapAppContainer();
        const params = alertaParamsSchema.safeParse(req.params);
        const body = resolucaoAlertaSchema.safeParse(req.body);
        if (!params.success || !body.success) {
            return respostaInvalida(res, params.error, body.error);
        }
        const service = container.resolve(DuplicateResolutionService);
        try {
            const lote = await service.resolverAlertaDuplicidade({
                loteId: params.data.id,
                chave: {
                    filCod: params.data.filCod,
                    docCod: params.data.docCod,
                    titCod: params.data.titCod,
                },
                alertaId: params.data.alertaId,
                acao: body.data.acao,
                ...(body.data.justificativa !== undefined
                    ? { justificativa: body.data.justificativa }
                    : {}),
                ator: ator(req),
            });
            res.json({ lote: apiView().lote(lote) });
        } catch (err) {
            if (!respondLoteError(req, res, err)) throw err;
        }
    }),
);

// POST /sispag/titulos/:filCod/:docCod/:titCod/bloqueio-duplicidade/desfazer — a analista desfaz o
// bloqueio por duplicidade do título (I13g), com motivo, auditado. 400 · 409 sem bloqueio ATIVO.
router.post(
    '/titulos/:filCod/:docCod/:titCod/bloqueio-duplicidade/desfazer',
    exigirPermissao(PERMISSION.SISPAG_EXECUTAR),
    asyncHandler(async (req, res) => {
        await bootstrapAppContainer();
        const chave = chaveTituloSchema.safeParse(req.params);
        const body = motivoSchema.safeParse(req.body);
        if (!chave.success || !body.success) return respostaInvalida(res, chave.error, body.error);
        const service = container.resolve(DuplicateResolutionService);
        try {
            const bloqueio = await service.desfazerBloqueio({
                chave: chave.data,
                motivo: body.data.motivo,
                ator: ator(req),
            });
            res.json({ bloqueio });
        } catch (err) {
            if (!respondLoteError(req, res, err)) throw err;
        }
    }),
);

// ===================================================== ADR-0065 — favorecido autorizado

/**
 * `details` do Zod SEM o valor enviado (I10h): só caminho e código de cada problema. O
 * `flatten()` padrão pode repetir o valor recebido na mensagem (enum, literal).
 */
const detalhesSemValor = (erro: z.ZodError): Array<{ campo: string; codigo: string }> =>
    erro.issues.map((i) => ({ campo: i.path.join('.') || '(body)', codigo: i.code }));

const respostaInvalida = (res: Response, ...erros: Array<z.ZodError | undefined>): void => {
    res.status(400).json({
        error: 'invalid request',
        details: erros.flatMap((e) => (e ? detalhesSemValor(e) : [])),
    });
};

const payees = (): AuthorizedPayeeService => container.resolve(AuthorizedPayeeService);

/**
 * Projeção da autorização para a API: sem as impressões (HMAC) aprovada e observada. Não são
 * reversíveis, mas não servem a quem só lê (`sispag:ver`); a tela de decisão recebe a impressão
 * ATUAL pelo `reconferir`, que é a que a aprovação envia.
 */
const semImpressao = (a: AuthorizedPayee): AuthorizedPayeeApiView => {
    const { fingerprint: _f, fingerprintObservado: _o, ...resto } = a;
    return resto;
};

// GET /sispag/favorecidos-autorizados — lista (?estado=&pesCod=). Só máscara, nunca o destino.
router.get(
    '/favorecidos-autorizados',
    exigirPermissao(PERMISSION.SISPAG_VER),
    asyncHandler(async (req, res) => {
        await bootstrapAppContainer();
        const filtro = FiltroAutorizacoesSchema.safeParse(req.query);
        if (!filtro.success) return respostaInvalida(res, filtro.error);
        res.json({ autorizacoes: (await payees().listar(filtro.data)).map(semImpressao) });
    }),
);

// GET /sispag/favorecidos-autorizados/candidatos — relatório read-only (listarCandidatosAutorizacao).
// Paginado: o cmn025 é lido só para a página, com cache por favorecido. Nenhuma escrita.
router.get(
    '/favorecidos-autorizados/candidatos',
    exigirPermissao(PERMISSION.SISPAG_VER),
    asyncHandler(async (req, res) => {
        await bootstrapAppContainer();
        const query = CandidatosQuerySchema.safeParse(req.query);
        if (!query.success) return respostaInvalida(res, query.error);
        const service = container.resolve(AuthorizationCandidatesService);
        res.json(await service.listar(query.data));
    }),
);

// POST /sispag/favorecidos-autorizados — pedir a autorização (F1) ou confirmar a reaprovação (F5).
// `sispag:executar`. O solicitante é o usuário autenticado; nunca nasce AUTORIZADO.
router.post(
    '/favorecidos-autorizados',
    exigirPermissao(PERMISSION.SISPAG_EXECUTAR),
    asyncHandler(async (req, res) => {
        await bootstrapAppContainer();
        const body = SolicitarAutorizacaoSchema.safeParse(req.body);
        if (!body.success) return respostaInvalida(res, body.error);
        try {
            const autorizacao = await payees().solicitar({
                pesCod: body.data.pesCod,
                ...(body.data.credor ? { credor: body.data.credor } : {}),
                modalidade: body.data.modalidade,
                origem: body.data.origem,
                filCod: body.data.filCod,
                ator: ator(req),
            });
            res.status(201).json({ autorizacao: semImpressao(autorizacao) });
        } catch (err) {
            if (!respondLoteError(req, res, err)) throw err;
        }
    }),
);

// POST /sispag/favorecidos-autorizados/:id/aprovar — F2/F6, `sispag:autorizar_favorecido`. Envia a
// impressão que a tela mostrou (anti-TOCTOU). 403 aprovador = solicitante · 409 destino mudou /
// reaprovação não confirmada / versão · 422 cadastro sem dado.
router.post(
    '/favorecidos-autorizados/:id/aprovar',
    exigirPermissao(PERMISSION.SISPAG_AUTORIZAR_FAVORECIDO),
    asyncHandler(async (req, res) => {
        await bootstrapAppContainer();
        const id = AutorizacaoIdSchema.safeParse(req.params);
        const body = AprovarAutorizacaoSchema.safeParse(req.body);
        if (!id.success || !body.success) return respostaInvalida(res, id.error, body.error);
        try {
            const autorizacao = await payees().aprovar({
                id: id.data.id,
                versao: body.data.versao,
                fingerprintMostrado: body.data.fingerprintMostrado,
                ator: ator(req),
            });
            res.json({ autorizacao: semImpressao(autorizacao) });
        } catch (err) {
            if (!respondLoteError(req, res, err)) throw err;
        }
    }),
);

// POST /sispag/favorecidos-autorizados/:id/{rejeitar|revogar} — F3/F7, motivo obrigatório.
for (const acao of ['rejeitar', 'revogar'] as const) {
    router.post(
        `/favorecidos-autorizados/:id/${acao}`,
        exigirPermissao(PERMISSION.SISPAG_AUTORIZAR_FAVORECIDO),
        asyncHandler(async (req, res) => {
            await bootstrapAppContainer();
            const id = AutorizacaoIdSchema.safeParse(req.params);
            const body = DecidirAutorizacaoSchema.safeParse(req.body);
            if (!id.success || !body.success) return respostaInvalida(res, id.error, body.error);
            const input = {
                id: id.data.id,
                versao: body.data.versao,
                motivo: body.data.motivo,
                ator: ator(req),
            };
            try {
                const autorizacao =
                    acao === 'rejeitar'
                        ? await payees().rejeitar(input)
                        : await payees().revogar(input);
                res.json({ autorizacao: semImpressao(autorizacao) });
            } catch (err) {
                if (!respondLoteError(req, res, err)) throw err;
            }
        }),
    );
}

// POST /sispag/favorecidos-autorizados/:id/reconferir — "reconferir com o Conexos" (selo, I14l),
// `sispag:ver`. Devolve o destino ATUAL mascarado e a impressão que a aprovação envia. Pode abrir
// a reaprovação (F4).
router.post(
    '/favorecidos-autorizados/:id/reconferir',
    exigirPermissao(PERMISSION.SISPAG_VER),
    asyncHandler(async (req, res) => {
        await bootstrapAppContainer();
        const id = AutorizacaoIdSchema.safeParse(req.params);
        if (!id.success) return respostaInvalida(res, id.error);
        try {
            const { autorizacao, atual } = await payees().reconferir(id.data.id, ator(req));
            res.json({ autorizacao: semImpressao(autorizacao), atual });
        } catch (err) {
            if (!respondLoteError(req, res, err)) throw err;
        }
    }),
);

// POST /sispag/favorecidos-autorizados/:id/revelar — o destino COMPLETO, lido ao vivo do cmn025,
// só na resposta e auditado (I14l). `sispag:autorizar_favorecido`. Nunca em cache.
router.post(
    '/favorecidos-autorizados/:id/revelar',
    exigirPermissao(PERMISSION.SISPAG_AUTORIZAR_FAVORECIDO),
    asyncHandler(async (req, res) => {
        await bootstrapAppContainer();
        const id = AutorizacaoIdSchema.safeParse(req.params);
        if (!id.success) return respostaInvalida(res, id.error);
        try {
            const revelado = await payees().revelar(id.data.id, ator(req));
            res.setHeader('Cache-Control', 'no-store');
            res.json(revelado);
        } catch (err) {
            if (!respondLoteError(req, res, err)) throw err;
        }
    }),
);

// GET /sispag/favorecidos-autorizados/:id/eventos — a trilha (quem, quando, o quê), sem valores.
router.get(
    '/favorecidos-autorizados/:id/eventos',
    exigirPermissao(PERMISSION.SISPAG_VER),
    asyncHandler(async (req, res) => {
        await bootstrapAppContainer();
        const id = AutorizacaoIdSchema.safeParse(req.params);
        if (!id.success) return respostaInvalida(res, id.error);
        try {
            res.json({ eventos: await payees().eventos(id.data.id) });
        } catch (err) {
            if (!respondLoteError(req, res, err)) throw err;
        }
    }),
);

// GET /sispag/recursos — o que a tela deve mostrar (flags do ADR-0054/0065), SÓ como booleanos.
// `tedEnabled`/`pixEnabled` já dizem se a modalidade é OFERECIDA: exigem a guarda do favorecido
// autorizado ligada (I14k).
router.get(
    '/recursos',
    exigirPermissao(PERMISSION.SISPAG_VER),
    asyncHandler(async (_req, res) => {
        await bootstrapAppContainer();
        const env = await container.resolve(EnvironmentProvider).getEnvironmentVars();
        const guarda = env.sispagFavorecidoAutorizadoEnabled === true;
        res.json({
            tedEnabled: guarda && env.sispagTedEnabled === true,
            pixEnabled: guarda && env.sispagPixEnabled === true,
            favorecidoAutorizadoEnabled: guarda,
        });
    }),
);

// POST /sispag/lotes/:id/conta — troca a conta pagadora do lote (A3, só RASCUNHO). admin.
router.post(
    '/lotes/:id/conta',
    exigirPermissao(PERMISSION.SISPAG_EXECUTAR),
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
            res.json({ lote: apiView().lote(lote) });
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
    exigirPermissao(PERMISSION.SISPAG_EXECUTAR),
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

// POST /sispag/carteira/atualizar — a tela chama ao abrir (ADR-0060): se a carteira gravada
// está defasada (TTL de 30 min), roda a ingestão; senão devolve `fresca` sem tocar o Conexos.
// `sispag:ver` basta: só LÊ o ERP (I1) e escreve no Postgres próprio. NÃO forma lotes.
// Contenção (`IngestLockBusyError`) vira `em_andamento`, nunca 409.
router.post(
    '/carteira/atualizar',
    exigirPermissao(PERMISSION.SISPAG_VER),
    heavyRouteLimiter,
    asyncHandler(async (req, res) => {
        await bootstrapAppContainer();
        const service = container.resolve(CarteiraAtualizacaoService);
        try {
            res.json(await service.atualizarSeDefasada({ triggeredBy: `abertura:${ator(req)}` }));
        } catch (err) {
            if (!respondLoteError(req, res, err)) throw err;
        }
    }),
);

// POST /sispag/lotes/formar — forma lotes candidatos automaticamente (cron/manual).
// Mesmas regras da montagem (I4, só a vencer ≤7d). `IngestLockBusyError` → 409.
router.post(
    '/lotes/formar',
    exigirPermissao(PERMISSION.SISPAG_EXECUTAR),
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

// ===================================================== Boletos DDA (fin124)
// Snapshot local do pool DDA consolidado contra a carteira. READ-ONLY no ERP.

const boletosDdaSchema = z.object({
    escopo: z.enum([BOLETO_DDA_ESCOPO.A_VENCER, BOLETO_DDA_ESCOPO.TODOS]).default('a-vencer'),
    situacao: z.enum(SITUACOES_FILTRAVEIS).optional(),
    busca: z.string().trim().max(100).optional(),
    filCod: z.coerce.number().int().positive().optional(),
    pagina: z.coerce.number().int().min(1).default(1),
    tamanho: z.coerce
        .number()
        .int()
        .min(1)
        .max(BOLETO_DDA_TAMANHO_MAX)
        .default(BOLETO_DDA_TAMANHO_PADRAO),
    // Intervalo de vencimento (data civil, inclusivo). O formato estrito é o que torna segura a
    // comparação por string no `PaginacaoBoletoDda` — nada disto chega a SQL.
    vencimentoDe: z.string().regex(DATA_CIVIL_REGEX).optional(),
    vencimentoAte: z.string().regex(DATA_CIVIL_REGEX).optional(),
});

// GET /sispag/boletos-dda?escopo=&situacao=&busca=&filCod=&vencimentoDe=&vencimentoAte=&pagina=&tamanho=
// Devolve UMA página (≤ 100 linhas) — nunca o pool inteiro (Regis-Review performance-1/security-2).
router.get(
    '/boletos-dda',
    // Mesmo guard das linhas digitáveis do lote: `sispag:ver` basta para consultar os boletos
    // DDA (decisão do dono do ciclo, ADR-0053). Sincronizar continua em `sispag:executar`.
    exigirPermissao(PERMISSION.SISPAG_VER),
    asyncHandler(async (req, res) => {
        await bootstrapAppContainer();
        const parsed = boletosDdaSchema.safeParse(req.query);
        if (!parsed.success) {
            res.status(400).json({ error: 'invalid query', details: parsed.error.flatten() });
            return;
        }
        const service = container.resolve(BoletoDdaService);
        res.json(await service.listar(parsed.data));
    }),
);

// POST /sispag/boletos-dda/sincronizar — relê o fin124 (incremental). `IngestLockBusyError` → 409.
router.post(
    '/boletos-dda/sincronizar',
    exigirPermissao(PERMISSION.SISPAG_EXECUTAR),
    heavyRouteLimiter,
    asyncHandler(async (req, res) => {
        await bootstrapAppContainer();
        const service = container.resolve(BoletoDdaService);
        try {
            res.json(await service.sincronizar({ triggeredBy: ator(req) }));
        } catch (err) {
            if (!respondLoteError(req, res, err)) throw err;
        }
    }),
);

/**
 * `?limit=` da trilha de ingestões. Leitura, então lixo cai no default 10 (contrato já testado)
 * em vez de 400 — mas nunca chega ao `LIMIT` do SQL como negativo, fracionário ou NaN.
 */
const runsLimitSchema = z.coerce.number().int().positive().catch(10);

// GET /sispag/ingestao/runs — trilha de auditoria das ingestões (?limit=).
router.get(
    '/ingestao/runs',
    exigirPermissao(PERMISSION.SISPAG_VER),
    asyncHandler(async (req, res) => {
        await bootstrapAppContainer();
        const limit = Math.min(runsLimitSchema.parse(req.query.limit), 50);
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
    exigirPermissao(PERMISSION.SISPAG_EXECUTAR),
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
/**
 * `dryRun` e `confirmarNovoLote` decidem se a remessa é ESCRITA de verdade no ERP, então passam
 * pelo schema como booleanos estritos: `"true"` (string) ou uma chave com erro de digitação vira
 * 400, em vez de cair calada no default (que pode ser a escrita real). `false` e ausente seguem
 * iguais — o serviço usa o `conexosDryRun` do ambiente.
 */
const gerarRemessaSchema = z
    .object({
        dataDebito: civilDateSchema.optional(),
        dryRun: z.boolean().optional(),
        confirmarNovoLote: z.boolean().optional(),
    })
    .strict();

// GET /sispag/lotes/:id/remessa/janela — janela permitida da data de débito (I8). Leitura.
// Mesma autenticação das outras leituras de lote. Não consulta o ERP: usa o snapshot do lote.
router.get(
    '/lotes/:id/remessa/janela',
    exigirPermissao(PERMISSION.SISPAG_VER),
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
    exigirPermissao(PERMISSION.SISPAG_EXECUTAR),
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
                ...(parsed.data.dryRun === true ? { dryRunOverride: true } : {}),
                // Segundo clique da tela quando o lote anterior foi cancelado no ERP.
                // Deliberadamente NÃO tem default: a confirmação tem que ser explícita.
                ...(parsed.data.confirmarNovoLote === true ? { confirmarNovoLote: true } : {}),
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
    exigirPermissao(PERMISSION.SISPAG_EXECUTAR),
    asyncHandler(async (req, res) => {
        await bootstrapAppContainer();
        const service = container.resolve(RemessaService);
        let arquivo: Awaited<ReturnType<RemessaService['baixarArquivo']>>;
        try {
            arquivo = await service.baixarArquivo(String(req.params.id));
        } catch (err) {
            // Lote COM remessa cujo arquivo não está no fin015: mensagem própria, não "sem remessa".
            if (respondLoteError(req, res, err)) return;
            throw err;
        }
        if (!arquivo) {
            res.status(404).json({ error: 'Este lote não tem remessa gerada.' });
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

// POST /sispag/remessas/titulos/exportar — planilha (.xlsx) com os títulos das remessas
// selecionadas, para a revisão do financeiro. Leitura local (sem Conexos), mesmos dados que
// `GET /sispag/lotes` já mostra (sem destino do favorecido) → `SISPAG_VER`. POST porque leva
// uma lista de ids; o teto evita uma planilha gigante segurando o processo.
const CONTENT_TYPE_XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
/** Quem pediu o export: vai para o log — a planilha expõe credores, valores e bancos. */
const contextoExport = (req: Request): ContextoExport => ({
    requestId: req.requestId,
    ator: ator(req),
    ...(req.acesso ? { userId: req.acesso.userId } : {}),
});
const exportarTitulosSchema = z.object({
    loteIds: z.array(z.string().uuid()).min(1).max(MAX_LOTES_EXPORT),
});
router.post(
    '/remessas/titulos/exportar',
    exigirPermissao(PERMISSION.SISPAG_VER),
    heavyRouteLimiter,
    asyncHandler(async (req, res) => {
        await bootstrapAppContainer();
        const parsed = exportarTitulosSchema.safeParse(req.body);
        if (!parsed.success) {
            res.status(400).json({
                error: `Selecione de 1 a ${MAX_LOTES_EXPORT} lotes para exportar.`,
                details: parsed.error.flatten(),
            });
            return;
        }
        const service = container.resolve(RemessaTitulosExportService);
        try {
            const { filename, buffer } = await service.exportar(
                parsed.data.loteIds,
                contextoExport(req),
            );
            res.setHeader('Content-Type', CONTENT_TYPE_XLSX);
            res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
            res.send(buffer);
        } catch (err) {
            if (!respondLoteError(req, res, err)) throw err;
        }
    }),
);

// POST /sispag/titulos/exportar — planilha (.xlsx) dos títulos a pagar que a aba mostra com o
// filtro atual. A tela manda só as chaves; os valores saem da carteira persistida (os mesmos que
// `GET /sispag/painel` já mostra) → `SISPAG_VER`. POST porque leva a lista de chaves.
// Chave compacta `filCod:docCod:titCod` (a mesma da tela): 5000 objetos estourariam o limite de
// 100 KB do `express.json()`; em string cabem com folga.
const exportarTitulosAPagarSchema = z.object({
    chaves: z
        .array(
            z
                .string()
                .regex(/^\d{1,6}:[^:]{1,40}:[^:]{1,40}$/)
                .transform((k) => {
                    const [filCod, docCod, titCod] = k.split(':');
                    return { filCod: Number(filCod), docCod: docCod ?? '', titCod: titCod ?? '' };
                }),
        )
        .min(1)
        .max(MAX_TITULOS_EXPORT),
});
router.post(
    '/titulos/exportar',
    exigirPermissao(PERMISSION.SISPAG_VER),
    heavyRouteLimiter,
    asyncHandler(async (req, res) => {
        await bootstrapAppContainer();
        const parsed = exportarTitulosAPagarSchema.safeParse(req.body);
        if (!parsed.success) {
            res.status(400).json({
                error: `Exporte de 1 a ${MAX_TITULOS_EXPORT} títulos.`,
                details: parsed.error.flatten(),
            });
            return;
        }
        const service = container.resolve(TitulosAPagarExportService);
        const { filename, buffer } = await service.exportar(
            parsed.data.chaves,
            contextoExport(req),
        );
        res.setHeader('Content-Type', CONTENT_TYPE_XLSX);
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.send(buffer);
    }),
);

// POST /sispag/retornos/conciliar — lê o detalhe do .RET e traz o resultado para os lotes. admin.
// Honra `Idempotency-Key`; sem ele o serviço deriva a chave do próprio arquivo de retorno —
// que é a identidade certa: o risco é reprocessar o MESMO arquivo, não a mesma requisição.
router.post(
    '/retornos/conciliar',
    exigirPermissao(PERMISSION.SISPAG_EXECUTAR),
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
    exigirPermissao(PERMISSION.SISPAG_EXECUTAR),
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
