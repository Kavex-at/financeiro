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
import ProntidaoLoteService from '../domain/service/sispag/ProntidaoLoteService.js';
import CarteiraAtualizacaoService from '../domain/service/sispag/CarteiraAtualizacaoService.js';
import IngestaoPagamentosService from '../domain/service/sispag/IngestaoPagamentosService.js';
import AuthorizationCandidatesService from '../domain/service/sispag/AuthorizationCandidatesService.js';
import PayeeSearchService from '../domain/service/sispag/PayeeSearchService.js';
import AuthorizedPayeeService from '../domain/service/sispag/AuthorizedPayeeService.js';
import type { AuthorizedPayee } from '../domain/interface/sispag/AuthorizedPayeeInterface.js';

type AuthorizedPayeeApiView = Omit<AuthorizedPayee, 'fingerprint' | 'fingerprintObservado'>;
import LotePagamentoApiView from '../domain/service/sispag/LotePagamentoApiView.js';
import LotePagamentoService from '../domain/service/sispag/LotePagamentoService.js';
import GrupoBoletoService from '../domain/service/sispag/GrupoBoletoService.js';
import {
    AnularGrupoBodySchema,
    ConfirmarGrupoBodySchema,
    GrupoBoletoIdSchema,
    GruposQuerySchema,
    IncluirGrupoNoLoteBodySchema,
    LoteGrupoParamsSchema,
    LoteIdSchema,
    RetirarGrupoQuerySchema,
} from '../domain/interface/sispag/GrupoBoletoSchemas.js';
import { FilialForbiddenError, assertUserCanActOnFilial } from '../http/filialAuthz.js';
import ConciliacaoRetornoService from '../domain/service/sispag/ConciliacaoRetornoService.js';
import DebitDateService from '../domain/service/sispag/DebitDateService.js';
import RemessaService from '../domain/service/sispag/RemessaService.js';
import VinculoCodigoBarrasService from '../domain/service/sispag/VinculoCodigoBarrasService.js';
import RemessaTitulosExportService from '../domain/service/sispag/RemessaTitulosExportService.js';
import {
    type ContextoExport,
    MAX_LOTES_EXPORT,
} from '../domain/interface/sispag/RemessaTitulosExport.js';
import TitulosAPagarExportService from '../domain/service/sispag/TitulosAPagarExportService.js';
import { MAX_TITULOS_EXPORT } from '../domain/interface/sispag/TitulosAPagarExport.js';
import SispagPainelService from '../domain/service/sispag/SispagPainelService.js';
import SincronizacaoPassadaService from '../domain/service/sispag/SincronizacaoPassadaService.js';
import { PERMISSION } from '../domain/interface/auth/Permission.js';
import { DUPLICATE_ACTION } from '../domain/interface/sispag/SispagInterface.js';
import DuplicateResolutionService from '../domain/service/sispag/DuplicateResolutionService.js';
import {
    AprovarAutorizacaoSchema,
    AutorizacaoIdSchema,
    BuscaFavorecidoSchema,
    CandidatosQuerySchema,
    DestinoAtualQuerySchema,
    DecidirAutorizacaoSchema,
    FiltroAutorizacoesSchema,
    SolicitarAutorizacaoSchema,
} from '../http/schemas.js';
import { asyncHandler } from '../http/asyncHandler.js';
import { exigirPermissao } from '../http/acesso.js';
import {
    buildPayeeSearchLimiter,
    buildSugestaoBoletoLimiter,
    heavyRouteLimiter,
} from '../http/rateLimit.js';
import type { DecisaoSugestao } from '../domain/interface/sispag/ConfirmacaoEmissorBoleto.js';
import {
    AnularDecisaoBodySchema,
    ChaveSugestaoBodySchema,
    ConfirmacaoEmissorIdSchema,
    ConfirmacoesEmissorQuerySchema,
    ConfirmarSugestaoBodySchema,
    RejeitarSugestaoBodySchema,
    RevogarConfirmacaoBodySchema,
    SugestoesQuerySchema,
    TituloSugestaoQuerySchema,
} from '../domain/interface/sispag/SugestaoBoletoSchemas.js';
import AjusteCentavosTituloService from '../domain/service/sispag/AjusteCentavosTituloService.js';
import BoletoSuggestionService from '../domain/service/sispag/BoletoSuggestionService.js';

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

// GET /sispag/lotes — lista lotes candidatos (?status=&filCod=). Leitura. Lote RASCUNHO leva a
// `prontidao` (ADR-0076): o que barra a finalização e o que sai do lote.
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
        const lotes = await container
            .resolve(ProntidaoLoteService)
            .comProntidao(await service.listarLotes(parsed.data));
        res.json({ lotes: apiView().lotes(lotes) });
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
        const [comProntidao] = await container.resolve(ProntidaoLoteService).comProntidao([lote]);
        res.json({ lote: apiView().lote(comProntidao ?? lote) });
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

const lotesPorFilialSchema = z.object({
    titulos: z
        .array(
            z.object({
                filCod: z.coerce.number().int().positive(),
                docCod: z.string().trim().min(1),
                titCod: z.string().trim().min(1),
            }),
        )
        .min(1)
        .max(500),
    mover: z.boolean().optional(),
});

// POST /sispag/lotes/por-filial — cria UM lote por filial com os títulos recebidos (ADR-0075, D15).
// Cada título passa pela mesma regra da inclusão manual (situação de pagamento, I2, I3). 200 sempre
// que o pedido é válido: o resultado por lote (CRIADO/PARCIAL/RECUSADO) e os títulos recusados com
// motivo vão no corpo; um lote que falha não desfaz os outros. admin.
router.post(
    '/lotes/por-filial',
    exigirPermissao(PERMISSION.SISPAG_EXECUTAR),
    asyncHandler(async (req, res) => {
        await bootstrapAppContainer();
        const parsed = lotesPorFilialSchema.safeParse(req.body);
        if (!parsed.success) {
            res.status(400).json({ error: 'invalid body', details: parsed.error.flatten() });
            return;
        }
        const service = container.resolve(LotePagamentoService);
        res.json(await service.criarLotesPorFilial({ ...parsed.data, ator: ator(req) }));
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
            error: 'A marcação manual de retorno foi descontinuada. Use "Sincronizar lotes" no topo da tela: o status passa a seguir a baixa dos títulos no Conexos.',
            code: 'LOTE_RETORNO_MANUAL_APOSENTADO',
        });
    },
);

// POST /sispag/lotes/:id/sincronizar — o "Sincronizar agora" POR LOTE saiu (ADR-0066): a
// sincronização é sempre a passada completa (`/lotes/sincronizar`, abaixo). 410 (e não 404) para
// quem ainda tiver a tela antiga em cache saber o motivo.
router.post(
    '/lotes/:id/sincronizar',
    exigirPermissao(PERMISSION.SISPAG_VER),
    (_req: Request, res: Response) => {
        res.status(410).json({
            error: 'A sincronização por lote foi descontinuada. Use "Sincronizar lotes" no topo da tela: ela atualiza todos os lotes de uma vez.',
            code: 'LOTE_SINCRONIZACAO_POR_LOTE_APOSENTADA',
        });
    },
);

// POST /sispag/lotes/sincronizar-se-defasado — a tela chama ao abrir, DEPOIS da carteira
// (ADR-0066): se a última passada completa de L11 tem mais que o TTL (30 min), roda uma; senão
// devolve `fresca` sem tocar o Conexos. `sispag:ver` basta: L11 só LÊ o ERP (I11a).
// Contenção vira `em_andamento`, nunca 409.
router.post(
    '/lotes/sincronizar-se-defasado',
    exigirPermissao(PERMISSION.SISPAG_VER),
    heavyRouteLimiter,
    asyncHandler(async (req, res) => {
        await bootstrapAppContainer();
        const service = container.resolve(SincronizacaoPassadaService);
        res.json(await service.sincronizarSeDefasada({ triggeredBy: `abertura:${ator(req)}` }));
    }),
);

// POST /sispag/lotes/sincronizar — "Sincronizar lotes" da tela (ADR-0066): força a passada
// completa (ignora TTL e cooldown) e respeita "uma por vez" (`em_andamento`). `sispag:ver`.
router.post(
    '/lotes/sincronizar',
    exigirPermissao(PERMISSION.SISPAG_VER),
    heavyRouteLimiter,
    asyncHandler(async (req, res) => {
        await bootstrapAppContainer();
        const service = container.resolve(SincronizacaoPassadaService);
        res.json(await service.forcar({ triggeredBy: `manual:${ator(req)}` }));
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
    id: z.guid(),
    alertaId: z.guid(),
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

// GET /sispag/titulos/retidos-por-codigo-barras — títulos que o sistema retirou de um lote por
// boleto repetido/ilegível e mantém retidos (ADR-0069 emenda 1, I16g). Só campos MASCARADOS.
router.get(
    '/titulos/retidos-por-codigo-barras',
    exigirPermissao(PERMISSION.SISPAG_VER),
    asyncHandler(async (_req, res) => {
        await bootstrapAppContainer();
        const service = container.resolve(DuplicateResolutionService);
        const retidos = await service.listarRetidosPorCodigoDeBarras();
        res.setHeader('Cache-Control', 'no-store');
        res.json({
            retidos: retidos.map((r) => ({
                filCod: r.filCod,
                docCod: r.docCod,
                titCod: r.titCod,
                origem: r.origem,
                ...(r.codigoMascarado !== undefined ? { codigoMascarado: r.codigoMascarado } : {}),
                ...(r.tituloMantido ? { tituloMantido: r.tituloMantido } : {}),
                ...(r.loteIdOrigem !== undefined ? { loteIdOrigem: r.loteIdOrigem } : {}),
                marcadoEm: r.marcadoEm,
                ...(r.credor !== undefined ? { credor: r.credor } : {}),
                ...(r.valor !== undefined ? { valor: r.valor } : {}),
                ...(r.vencimento !== undefined ? { vencimento: r.vencimento } : {}),
            })),
        });
    }),
);

// GET /sispag/lotes/:id/retirados-por-codigo-barras — o que o sistema retirou DESTE lote por código
// de barras, lido da trilha (persistente: sobrevive a recarregar a tela, I16f(3)). Só mascarado.
router.get(
    '/lotes/:id/retirados-por-codigo-barras',
    exigirPermissao(PERMISSION.SISPAG_VER),
    asyncHandler(async (req, res) => {
        await bootstrapAppContainer();
        const service = container.resolve(DuplicateResolutionService);
        const retirados = await service.listarRetiradasDoLote(String(req.params.id));
        res.setHeader('Cache-Control', 'no-store');
        res.json({ retirados });
    }),
);

// GET /sispag/lotes/:id/vinculos-previstos — o que o vínculo do código de barras confirmado FARIA
// neste lote (ADR-0071, I17k): dry-run visível, também o único canal do `shadow` (sem selo na tela).
// LOCAL: banco/pool, ZERO chamada ao ERP e nada gravado; o valor em aberto é o da carteira
// persistida (`valorAbertoFonte`). Modo `off` ⇒ lista vazia. Só máscara 5+4: nenhum campo carrega
// o código. `sispag:ver`, sem permissão nova (R11).
router.get(
    '/lotes/:id/vinculos-previstos',
    exigirPermissao(PERMISSION.SISPAG_VER),
    asyncHandler(async (req, res) => {
        await bootstrapAppContainer();
        const lote = await container.resolve(LotePagamentoService).getLote(String(req.params.id));
        if (!lote) {
            res.status(404).json({ error: 'lote not found' });
            return;
        }
        const vinculo = container.resolve(VinculoCodigoBarrasService);
        const modo = await vinculo.resolverModo(lote.filCod);
        const previsoes = modo === 'off' ? [] : await vinculo.prever(lote);
        res.setHeader('Cache-Control', 'no-store');
        res.json({
            modo,
            itens: previsoes.map((p) => ({
                titulo: p.titulo,
                elegivel: p.elegivel,
                ...(p.motivo !== undefined ? { motivo: p.motivo } : {}),
                ...(p.deltaDias !== undefined ? { deltaDias: p.deltaDias } : {}),
                ...(p.deltaCentavos !== undefined ? { deltaCentavos: p.deltaCentavos } : {}),
                ...(p.codigoMascarado !== undefined ? { codigoMascarado: p.codigoMascarado } : {}),
                ...(p.decisaoId !== undefined ? { decisaoId: p.decisaoId } : {}),
                valorAbertoFonte: p.valorAbertoFonte,
            })),
        });
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

/**
 * 30/min por usuário na busca e, em balde próprio, na prévia: as duas leem o `cmn025` na sessão
 * compartilhada do Conexos.
 */
const limiteBuscaFavorecido = buildPayeeSearchLimiter({}, 'busca');
const limitePreviaFavorecido = buildPayeeSearchLimiter({}, 'previa');

// POST /sispag/favorecidos-autorizados/busca — acha o favorecido no cadastro do Conexos (cmn025)
// para o pedido, sem abrir o Conexos. `sispag:executar` (só quem pede). Documento só mascarado;
// read-only. POST de propósito: o termo pode ser um CPF/CNPJ inteiro, e os middlewares logam
// `req.originalUrl` (com a query) em erro e em acesso negado (I10h).
router.post(
    '/favorecidos-autorizados/busca',
    exigirPermissao(PERMISSION.SISPAG_EXECUTAR),
    limiteBuscaFavorecido,
    asyncHandler(async (req, res) => {
        await bootstrapAppContainer();
        const body = BuscaFavorecidoSchema.safeParse(req.body);
        if (!body.success) return respostaInvalida(res, body.error);
        res.setHeader('Cache-Control', 'no-store');
        res.json(await container.resolve(PayeeSearchService).buscar(body.data.termo));
    }),
);

// GET /sispag/favorecidos-autorizados/destino-atual — prévia do pedido: o destino que o cadastro
// resolve agora para (favorecido, modalidade), MASCARADO (I14l), sem impressão. Read-only.
router.get(
    '/favorecidos-autorizados/destino-atual',
    exigirPermissao(PERMISSION.SISPAG_EXECUTAR),
    limitePreviaFavorecido,
    asyncHandler(async (req, res) => {
        await bootstrapAppContainer();
        const query = DestinoAtualQuerySchema.safeParse(req.query);
        if (!query.success) return respostaInvalida(res, query.error);
        res.setHeader('Cache-Control', 'no-store');
        res.json(await payees().destinoAtual(query.data.pesCod, query.data.modalidade));
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
                ...(body.data.filCod !== undefined ? { filCod: body.data.filCod } : {}),
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

// ===================================================== ADR-0068 — sugestão de boleto (passo 1)
// EVIDÊNCIA, não autoridade: nenhuma rota escreve no Conexos nem muda `temBoleto`/lote/título.
// O ator é SEMPRE o usuário autenticado (body estrito: "ator" no body é 400).

const sugestoesBoleto = (): BoletoSuggestionService => container.resolve(BoletoSuggestionService);

const limiteDecisaoBoleto = buildSugestaoBoletoLimiter({}, 'confirmar');
const limiteCopiaLinha = buildSugestaoBoletoLimiter({}, 'copiar');

/** A decisão para a API: sem a chave do emissor (carrega a conta completa; só a máscara sai). */
const decisaoParaApi = (d: DecisaoSugestao): Omit<DecisaoSugestao, 'emissorChave'> => {
    const { emissorChave: _chave, ...resto } = d;
    return resto;
};

// GET /sispag/sugestoes-boleto?filCod=&pesCod=&tier=&situacao=&pagina=&tamanho= — `sispag:ver`.
// `titulos[]` = uma linha por título elegível (ADR-0072). Emissor MASCARADO; nunca barras nem linha
// digitável (a linha só sai por `copiar-linha`, auditado).
router.get(
    '/sugestoes-boleto',
    exigirPermissao(PERMISSION.SISPAG_VER),
    asyncHandler(async (req, res) => {
        await bootstrapAppContainer();
        const query = SugestoesQuerySchema.safeParse(req.query);
        if (!query.success) return respostaInvalida(res, query.error);
        res.json(
            await sugestoesBoleto().listarSugestoes({
                ...(query.data.filCod !== undefined ? { filCod: query.data.filCod } : {}),
                ...(query.data.pesCod ? { pesCod: query.data.pesCod } : {}),
                ...(query.data.tier ? { tier: query.data.tier } : {}),
                ...(query.data.situacao ? { situacao: query.data.situacao } : {}),
                pagina: query.data.pagina,
                tamanho: query.data.tamanho,
            }),
        );
    }),
);

// GET /sispag/sugestoes-boleto/titulo?filCod=&docCod=&titCod= — `sispag:ver`. Até 3 candidatos do
// título (I15m), sob demanda; no-store; 404 nomeado se o título não é elegível.
router.get(
    '/sugestoes-boleto/titulo',
    exigirPermissao(PERMISSION.SISPAG_VER),
    asyncHandler(async (req, res) => {
        await bootstrapAppContainer();
        const query = TituloSugestaoQuerySchema.safeParse(req.query);
        if (!query.success) return respostaInvalida(res, query.error);
        try {
            const d = await sugestoesBoleto().detalharTitulo(query.data);
            res.setHeader('Cache-Control', 'no-store');
            res.json(d);
        } catch (err) {
            if (!respondLoteError(req, res, err)) throw err;
        }
    }),
);

// POST /sispag/sugestoes-boleto/confirmar — `sispag:executar`. 201 decisão nova · 200 já existia
// (idempotente) · 409 indisponível/reservado a outro título/não confirmável (fraco, ambíguo,
// disputado) · 422 boleto vencido ou aviso `VENCE_ANTES_DO_TITULO` sem `reconheceAvisos`.
router.post(
    '/sugestoes-boleto/confirmar',
    exigirPermissao(PERMISSION.SISPAG_EXECUTAR),
    limiteDecisaoBoleto,
    asyncHandler(async (req, res) => {
        await bootstrapAppContainer();
        const body = ConfirmarSugestaoBodySchema.safeParse(req.body);
        if (!body.success) return respostaInvalida(res, body.error);
        try {
            const r = await sugestoesBoleto().confirmar({ ...body.data, ator: ator(req) });
            res.status(r.criada ? 201 : 200).json({
                criada: r.criada,
                decisao: decisaoParaApi(r.decisao),
            });
        } catch (err) {
            if (!respondLoteError(req, res, err)) throw err;
        }
    }),
);

// POST /sispag/sugestoes-boleto/rejeitar — `sispag:executar`. Motivo obrigatório (422 se em branco).
router.post(
    '/sugestoes-boleto/rejeitar',
    exigirPermissao(PERMISSION.SISPAG_EXECUTAR),
    limiteDecisaoBoleto,
    asyncHandler(async (req, res) => {
        await bootstrapAppContainer();
        const body = RejeitarSugestaoBodySchema.safeParse(req.body);
        if (!body.success) return respostaInvalida(res, body.error);
        try {
            const r = await sugestoesBoleto().rejeitar({ ...body.data, ator: ator(req) });
            res.status(r.criada ? 201 : 200).json({
                criada: r.criada,
                decisao: decisaoParaApi(r.decisao),
            });
        } catch (err) {
            if (!respondLoteError(req, res, err)) throw err;
        }
    }),
);

// POST /sispag/sugestoes-boleto/anular — `sispag:executar`. CONFIRMADA → ANULADA (I15l): desfaz a
// confirmação de um título, com motivo (10–500), e libera o título e o boleto. 200 sempre que o
// título termina ANULADA (idempotente) · 409 título sem confirmação · 422 motivo curto.
router.post(
    '/sugestoes-boleto/anular',
    exigirPermissao(PERMISSION.SISPAG_EXECUTAR),
    limiteDecisaoBoleto,
    asyncHandler(async (req, res) => {
        await bootstrapAppContainer();
        const body = AnularDecisaoBodySchema.safeParse(req.body);
        if (!body.success) return respostaInvalida(res, body.error);
        try {
            const r = await sugestoesBoleto().anularDecisao({ ...body.data, ator: ator(req) });
            res.json({ anulada: r.anulada, decisao: decisaoParaApi(r.decisao) });
        } catch (err) {
            if (!respondLoteError(req, res, err)) throw err;
        }
    }),
);

// POST /sispag/sugestoes-boleto/copiar-linha — `sispag:ver` (a linha já é visível a `ver` no GET
// /boletos-dda e no lote, ADR-0053; a trilha, não o mascaramento, é o controle). Devolve a linha digitável SÓ
// depois de gravar `LINHA_COPIADA`; sem trilha, 503 e nenhuma linha (fail-closed). POST + no-store:
// a linha nunca vai em URL nem em cache.
router.post(
    '/sugestoes-boleto/copiar-linha',
    exigirPermissao(PERMISSION.SISPAG_VER),
    limiteCopiaLinha,
    asyncHandler(async (req, res) => {
        await bootstrapAppContainer();
        const body = ChaveSugestaoBodySchema.safeParse(req.body);
        if (!body.success) return respostaInvalida(res, body.error);
        try {
            const r = await sugestoesBoleto().copiarLinha({ ...body.data, ator: ator(req) });
            res.setHeader('Cache-Control', 'no-store');
            res.json({ linhaDigitavel: r.linhaDigitavel });
        } catch (err) {
            if (!respondLoteError(req, res, err)) throw err;
        }
    }),
);

// GET /sispag/confirmacoes-emissor?estado=&pesCod= — `sispag:ver`. Só o emissor mascarado.
router.get(
    '/confirmacoes-emissor',
    exigirPermissao(PERMISSION.SISPAG_VER),
    asyncHandler(async (req, res) => {
        await bootstrapAppContainer();
        const query = ConfirmacoesEmissorQuerySchema.safeParse(req.query);
        if (!query.success) return respostaInvalida(res, query.error);
        res.json({
            confirmacoes: await sugestoesBoleto().listarConfirmacoes({
                ...(query.data.estado ? { estado: query.data.estado } : {}),
                ...(query.data.pesCod ? { pesCod: query.data.pesCod } : {}),
            }),
        });
    }),
);

// POST /sispag/confirmacoes-emissor/:id/revogar — `sispag:executar` (qualquer pessoa, com motivo).
// 404 par inexistente · 422 sem motivo · no-op (200) se já revogado.
router.post(
    '/confirmacoes-emissor/:id/revogar',
    exigirPermissao(PERMISSION.SISPAG_EXECUTAR),
    limiteDecisaoBoleto,
    asyncHandler(async (req, res) => {
        await bootstrapAppContainer();
        const id = ConfirmacaoEmissorIdSchema.safeParse(req.params);
        const body = RevogarConfirmacaoBodySchema.safeParse(req.body);
        if (!id.success || !body.success) return respostaInvalida(res, id.error, body.error);
        try {
            const confirmacao = await sugestoesBoleto().revogarPar({
                id: id.data.id,
                motivo: body.data.motivo,
                ator: ator(req),
            });
            res.json({ confirmacao });
        } catch (err) {
            if (!respondLoteError(req, res, err)) throw err;
        }
    }),
);

// ===================================================== ADR-0077 — boleto agrupado (1 boleto → N títulos)
// Sugerir e listar leem (`sispag:ver`); confirmar, anular e mexer no lote são `sispag:executar`.
// O ator é SEMPRE o do token (body estrito). Nenhuma rota escreve no Conexos: a escrita do borderô
// é da geração da remessa. Resposta sem código completo (só a máscara 5+4) e sem a conta do emissor.

const gruposBoleto = (): GrupoBoletoService => container.resolve(GrupoBoletoService);
const limiteGrupoBoleto = buildSugestaoBoletoLimiter({}, 'grupo');

/** O grupo/sugestão para a API: sem `emissorChave` (carrega a conta completa do emissor). */
const semChaveDoEmissor = <T extends object>(x: T): Omit<T, 'emissorChave'> => {
    const { emissorChave: _chave, ...resto } = x as T & { emissorChave?: unknown };
    return resto as Omit<T, 'emissorChave'>;
};

/** 403 se a filial está fora da allow-list do usuário; `true` = pode seguir. */
const filialPermitida = (req: Request, res: Response, filCods: Iterable<number>): boolean => {
    try {
        for (const filCod of new Set(filCods)) assertUserCanActOnFilial(req.user, filCod);
        return true;
    } catch (err) {
        if (!(err instanceof FilialForbiddenError)) throw err;
        res.status(403).json({ error: 'Forbidden: filial não autorizada', code: err.code });
        return false;
    }
};

// GET /sispag/grupos-boleto/sugestoes?filCod= — `sispag:ver`. Sugestão calculada (grupo fechado no
// mesmo vencimento), nunca persistida; `confirmavel = false` traz o motivo.
router.get(
    '/grupos-boleto/sugestoes',
    exigirPermissao(PERMISSION.SISPAG_VER),
    asyncHandler(async (req, res) => {
        await bootstrapAppContainer();
        const query = GruposQuerySchema.safeParse(req.query);
        if (!query.success) return respostaInvalida(res, query.error);
        if (query.data.filCod !== undefined && !filialPermitida(req, res, [query.data.filCod])) {
            return;
        }
        const sugestoes = await gruposBoleto().sugerir(
            query.data.filCod !== undefined ? { filCod: query.data.filCod } : {},
        );
        res.json({ sugestoes: sugestoes.map(semChaveDoEmissor) });
    }),
);

// GET /sispag/grupos-boleto?filCod= — `sispag:ver`. Grupos confirmados com a situação derivada
// (DISPONIVEL, EM_LOTE, REJEITADO, RETIDO, DIVERGENTE, ORFAO…) e o órfão (I21u).
router.get(
    '/grupos-boleto',
    exigirPermissao(PERMISSION.SISPAG_VER),
    asyncHandler(async (req, res) => {
        await bootstrapAppContainer();
        const query = GruposQuerySchema.safeParse(req.query);
        if (!query.success) return respostaInvalida(res, query.error);
        if (query.data.filCod !== undefined && !filialPermitida(req, res, [query.data.filCod])) {
            return;
        }
        const grupos = await gruposBoleto().listar(
            query.data.filCod !== undefined ? { filCod: query.data.filCod } : {},
        );
        res.json({ grupos: grupos.map(semChaveDoEmissor) });
    }),
);

// POST /sispag/grupos-boleto/confirmar — `sispag:executar`. 201 grupo novo · 200 já confirmado
// (idempotente) · 409 título/boleto indisponível ou não confirmável · 422 soma, janela, filial,
// aviso sem reconhecimento.
router.post(
    '/grupos-boleto/confirmar',
    exigirPermissao(PERMISSION.SISPAG_EXECUTAR),
    limiteGrupoBoleto,
    asyncHandler(async (req, res) => {
        await bootstrapAppContainer();
        const body = ConfirmarGrupoBodySchema.safeParse(req.body);
        if (!body.success) return respostaInvalida(res, body.error);
        if (
            !filialPermitida(
                req,
                res,
                body.data.titulos.map((t) => t.filCod),
            )
        )
            return;
        try {
            const r = await gruposBoleto().confirmar({ ...body.data, ator: ator(req) });
            res.status(r.criado ? 201 : 200).json({
                criado: r.criado,
                grupo: semChaveDoEmissor(r.grupo),
            });
        } catch (err) {
            if (!respondLoteError(req, res, err)) throw err;
        }
    }),
);

// POST /sispag/grupos-boleto/:id/anular — `sispag:executar`. Motivo de 10 a 500 caracteres. Sai do
// lote RASCUNHO na mesma transação; em lote comprometido a resposta traz o aviso (a remessa retira).
router.post(
    '/grupos-boleto/:id/anular',
    exigirPermissao(PERMISSION.SISPAG_EXECUTAR),
    limiteGrupoBoleto,
    asyncHandler(async (req, res) => {
        await bootstrapAppContainer();
        const params = GrupoBoletoIdSchema.safeParse(req.params);
        const body = AnularGrupoBodySchema.safeParse(req.body);
        if (!params.success || !body.success) {
            return respostaInvalida(
                res,
                params.success ? undefined : params.error,
                body.success ? undefined : body.error,
            );
        }
        const filCodDoGrupo = await gruposBoleto().filialDoGrupo(params.data.id);
        if (filCodDoGrupo !== undefined && !filialPermitida(req, res, [filCodDoGrupo])) return;
        try {
            const r = await gruposBoleto().anular({
                grupoId: params.data.id,
                motivo: body.data.motivo,
                ator: ator(req),
            });
            res.json({ ...r, grupo: semChaveDoEmissor(r.grupo) });
        } catch (err) {
            if (!respondLoteError(req, res, err)) throw err;
        }
    }),
);

// POST /sispag/lotes/:id/grupos — `sispag:executar`. Inclui o grupo INTEIRO no lote RASCUNHO da
// mesma filial (`mover: true` o tira do outro rascunho). 409 lote comprometido / título em outro lote.
router.post(
    '/lotes/:id/grupos',
    exigirPermissao(PERMISSION.SISPAG_EXECUTAR),
    asyncHandler(async (req, res) => {
        await bootstrapAppContainer();
        const params = LoteIdSchema.safeParse(req.params);
        const body = IncluirGrupoNoLoteBodySchema.safeParse(req.body);
        if (!params.success || !body.success) {
            return respostaInvalida(
                res,
                params.success ? undefined : params.error,
                body.success ? undefined : body.error,
            );
        }
        const filCods: number[] = [];
        const filCodDoLote = await container
            .resolve(LotePagamentoService)
            .filialDoLote(params.data.id);
        if (filCodDoLote !== undefined) filCods.push(filCodDoLote);
        const filCodDoGrupo = await gruposBoleto().filialDoGrupo(body.data.grupoId);
        if (filCodDoGrupo !== undefined) filCods.push(filCodDoGrupo);
        if (!filialPermitida(req, res, filCods)) return;
        try {
            const r = await container.resolve(LotePagamentoService).incluirGrupo({
                loteId: params.data.id,
                ...body.data,
                ator: ator(req),
            });
            res.json({ lote: apiView().lote(r.lote), avisos: r.avisos });
        } catch (err) {
            if (!respondLoteError(req, res, err)) throw err;
        }
    }),
);

// DELETE /sispag/lotes/:id/grupos/:grupoId?versaoEsperada= — `sispag:executar`. Retira o grupo
// inteiro do lote RASCUNHO; retirar UM título dele é 409 (`GroupedBoletoIndivisibleError`).
router.delete(
    '/lotes/:id/grupos/:grupoId',
    exigirPermissao(PERMISSION.SISPAG_EXECUTAR),
    asyncHandler(async (req, res) => {
        await bootstrapAppContainer();
        const params = LoteGrupoParamsSchema.safeParse(req.params);
        const query = RetirarGrupoQuerySchema.safeParse(req.query);
        if (!params.success || !query.success) {
            return respostaInvalida(
                res,
                params.success ? undefined : params.error,
                query.success ? undefined : query.error,
            );
        }
        const filCodDoLote = await container
            .resolve(LotePagamentoService)
            .filialDoLote(params.data.id);
        if (filCodDoLote !== undefined && !filialPermitida(req, res, [filCodDoLote])) return;
        try {
            const lote = await container.resolve(LotePagamentoService).removerGrupo({
                loteId: params.data.id,
                grupoId: params.data.grupoId,
                ...(query.data.versaoEsperada !== undefined
                    ? { versaoEsperada: query.data.versaoEsperada }
                    : {}),
                ator: ator(req),
            });
            res.json({ lote: apiView().lote(lote) });
        } catch (err) {
            if (!respondLoteError(req, res, err)) throw err;
        }
    }),
);

// ===================================================== Ajuste de centavos do título (ADR-0074, I18)
// Disparo principal: pós-commit do `confirmar` (no serviço da sugestão). Aqui: "tentar de novo",
// a varredura ao abrir a tela e a leitura do estado/candidatos (M7). Só no processo do servidor.

const ajustesCentavos = (): AjusteCentavosTituloService =>
    container.resolve(AjusteCentavosTituloService);
const limiteAjusteCentavos = buildSugestaoBoletoLimiter({}, 'ajuste');

const AjusteCentavosTituloBodySchema = z.object({
    filCod: z.coerce.number().int().positive(),
    docCod: z.string().trim().min(1).max(20),
    titCod: z.string().trim().min(1).max(10),
});
const AjusteCentavosFilialSchema = z.object({
    filCod: z.coerce.number().int().positive(),
});
const AjusteCentavosRetomarBodySchema = z.object({
    filCod: z.coerce.number().int().positive().optional(),
});

// POST /sispag/ajustes-centavos/tentar-novamente — `sispag:executar`. 200 com o resultado ·
// 409 inelegível (`AJUSTE_CENTAVOS_INELEGIVEL`, com o motivo) ou incompleto (retomável).
router.post(
    '/ajustes-centavos/tentar-novamente',
    exigirPermissao(PERMISSION.SISPAG_EXECUTAR),
    limiteAjusteCentavos,
    asyncHandler(async (req, res) => {
        await bootstrapAppContainer();
        const body = AjusteCentavosTituloBodySchema.safeParse(req.body);
        if (!body.success) return respostaInvalida(res, body.error);
        try {
            res.json(await ajustesCentavos().tentarDeNovo(body.data));
        } catch (err) {
            if (!respondLoteError(req, res, err)) throw err;
        }
    }),
);

// POST /sispag/ajustes-centavos/retomar — `sispag:executar` (a tela chama ao abrir; quem só tem
// `sispag:ver` recebe 403 e a tela ignora). 202: a varredura roda em segundo plano.
router.post(
    '/ajustes-centavos/retomar',
    exigirPermissao(PERMISSION.SISPAG_EXECUTAR),
    limiteAjusteCentavos,
    asyncHandler(async (req, res) => {
        await bootstrapAppContainer();
        const body = AjusteCentavosRetomarBodySchema.safeParse(req.body ?? {});
        if (!body.success) return respostaInvalida(res, body.error);
        ajustesCentavos().agendarVarredura(
            body.data.filCod !== undefined ? { filCod: body.data.filCod } : {},
        );
        res.status(202).json({ agendado: true });
    }),
);

// GET /sispag/ajustes-centavos?filCod= — `sispag:ver`. Modo efetivo, avisos e o estado do ajuste
// por título (ledger). Só máscara 5+4; nunca o código completo.
router.get(
    '/ajustes-centavos',
    exigirPermissao(PERMISSION.SISPAG_VER),
    asyncHandler(async (req, res) => {
        await bootstrapAppContainer();
        const query = AjusteCentavosFilialSchema.safeParse(req.query);
        if (!query.success) return respostaInvalida(res, query.error);
        res.json(await ajustesCentavos().listarCandidatos({ filCod: query.data.filCod }));
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
    loteIds: z.array(z.guid()).min(1).max(MAX_LOTES_EXPORT),
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
