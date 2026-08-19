import 'reflect-metadata';
import { type Response, Router } from 'express';
import { container } from 'tsyringe';
import { z } from 'zod';
import { bootstrapAppContainer } from '../domain/appContainer.js';
import ConexosCadastroClient from '../domain/client/ConexosCadastroClient.js';
import { STATUS_WORKFLOW } from '../domain/interface/aprovacoes/constants.js';
import AprovacoesPainelService from '../domain/service/aprovacoes/AprovacoesPainelService.js';
import { asyncHandler } from '../http/asyncHandler.js';
import {
    FilialForbiddenError,
    type FilialScopedUser,
    assertUserCanActOnFilial,
    filiaisPermitidas,
} from '../http/filialAuthz.js';
import { respondHandlerError } from '../http/respondHandlerError.js';
import { validateInput } from '../http/validate.js';

/**
 * Rotas da Frente V (Workflow de Aprovação) — LEITURA APENAS. Duas superfícies: o grid
 * (`GET /aprovacoes`) e a trilha de um título (`GET /aprovacoes/:id/trilha`).
 *
 * Nenhuma lógica de negócio aqui: Zod valida no boundary, o `AprovacoesPainelService` deriva.
 * Montada atrás do `aprovacoesGate` (403 quando desabilitada). Espelha `routes/recebimentos.ts`.
 */
const router = Router();

/** Teto de página — impede que `?pageSize=100000` vire uma varredura da tabela inteira. */
const PAGE_SIZE_MAX = 100;
const PAGE_SIZE_PADRAO = 25;

/**
 * Filiais que o usuário PODE ver. Allow-list do token quando provisionada; senão, todas as do ERP
 * (`imp021`/login) — espelha `resolverFilCodsAcessiveis` da Frente IV.
 *
 * O fallback existe porque o JWT de hoje ainda não carrega a claim `filiais` (ver `filialAuthz.ts`):
 * sem ele, TODO usuário veria um painel vazio. Quando a claim for provisionada, ela passa a mandar
 * sem edição de rota. Premissa registrada em **PV-09**.
 */
const resolverFilCodsAcessiveis = async (user: FilialScopedUser | undefined): Promise<number[]> => {
    const permitidas = filiaisPermitidas(user);
    if (permitidas && permitidas.length > 0) return permitidas;
    const cadastro = container.resolve(ConexosCadastroClient);
    const filiais = await cadastro.listFiliais();
    return filiais.map((f) => Number(f.filCod)).filter((n) => Number.isInteger(n) && n > 0);
};

/**
 * Filiais-alvo da consulta: um `filCod` explícito (autorizado) restringe a ele; a ausência varre
 * todas as acessíveis. Lança `FilialForbiddenError` quando o `filCod` pedido está fora da
 * allow-list — pedir filial alheia é 403, não uma lista vazia silenciosa.
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

const listQuerySchema = z.object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(PAGE_SIZE_MAX).default(PAGE_SIZE_PADRAO),
    filCod: z.coerce.number().int().positive().optional(),
    status: z
        .enum([
            STATUS_WORKFLOW.SEM_WORKFLOW,
            STATUS_WORKFLOW.AGUARDANDO,
            STATUS_WORKFLOW.APROVADO,
            STATUS_WORKFLOW.REJEITADO,
            STATUS_WORKFLOW.INDETERMINADO,
        ])
        .optional(),
    fornecedorCod: z.coerce.number().int().positive().optional(),
    responsavel: z.string().trim().min(1).max(200).optional(),
    emissaoDe: z.coerce.date().optional(),
    emissaoAte: z.coerce.date().optional(),
    busca: z.string().trim().min(1).max(200).optional(),
});

/**
 * `${filCod}:${docCod}:${titCod}` — recusado no boundary antes de virar consulta. O
 * `AprovacoesPainelService.parseId` revalida: esta regex é a primeira barreira, não a única.
 */
const trilhaParamsSchema = z.object({
    id: z.string().regex(/^\d+:\d+:\d+$/, 'formato esperado: filCod:docCod:titCod'),
});

/** Responde 403 quando o erro é de filial; devolve `false` para o chamador seguir tratando. */
const respondFilialForbidden = (res: Response, err: unknown): boolean => {
    if (!(err instanceof FilialForbiddenError)) return false;
    res.status(403).json({ error: 'Forbidden: filial não autorizada', code: err.code });
    return true;
};

/** GET /aprovacoes — grid paginado do painel. */
router.get(
    '/',
    asyncHandler(async (req, res) => {
        await bootstrapAppContainer();
        const parsed = validateInput(listQuerySchema, req.query);
        if (!parsed.success) {
            res.status(parsed.status).json(parsed.body);
            return;
        }

        try {
            const filCods = await resolverFilCodsAlvo(req.user, parsed.data.filCod);
            const service = container.resolve(AprovacoesPainelService);
            res.json(
                await service.listar({
                    page: parsed.data.page,
                    pageSize: parsed.data.pageSize,
                    filCods,
                    status: parsed.data.status,
                    fornecedorCod: parsed.data.fornecedorCod,
                    responsavel: parsed.data.responsavel,
                    emissaoDe: parsed.data.emissaoDe,
                    emissaoAte: parsed.data.emissaoAte,
                    busca: parsed.data.busca,
                }),
            );
        } catch (err) {
            if (respondFilialForbidden(res, err)) return;
            if (respondHandlerError(req, res, err)) return;
            throw err;
        }
    }),
);

/**
 * GET /aprovacoes/:id/trilha — a timeline completa de um título.
 *
 * 404 cobre tanto "não existe" quanto "existe em filial que você não vê": distinguir os dois
 * confirmaria a existência do título a quem não tem acesso a ele.
 */
router.get(
    '/:id/trilha',
    asyncHandler(async (req, res) => {
        await bootstrapAppContainer();
        const parsed = validateInput(trilhaParamsSchema, req.params);
        if (!parsed.success) {
            res.status(parsed.status).json(parsed.body);
            return;
        }

        try {
            const service = container.resolve(AprovacoesPainelService);
            const trilha = await service.detalhar(parsed.data.id, {
                filCodsPermitidos: filiaisPermitidas(req.user),
            });
            if (!trilha) {
                res.status(404).json({ error: 'Título de aprovação não encontrado.' });
                return;
            }
            res.json(trilha);
        } catch (err) {
            if (respondFilialForbidden(res, err)) return;
            if (respondHandlerError(req, res, err)) return;
            throw err;
        }
    }),
);

export default router;
