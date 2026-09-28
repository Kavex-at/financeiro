import 'reflect-metadata';
import type { Request, Response } from 'express';
import { Router } from 'express';
import { container } from 'tsyringe';
import { z } from 'zod';
import { bootstrapAppContainer } from '../domain/appContainer.js';
import { UsernameAlreadyExistsError } from '../domain/repository/auth/UserRepository.js';
import { MissingEncryptionKeyError } from '../domain/libs/crypto/SecretCipher.js';
import UserAdminService, {
    createUserSchema,
    resetPasswordSchema,
    vinculoConexosSchema,
} from '../domain/service/auth/UserAdminService.js';
import { asyncHandler } from '../http/asyncHandler.js';
import { requireRole } from '../http/auth.js';

/**
 * Gestão de usuários da plataforma (Fatia A) — só `admin`.
 *
 * Montado APÓS o middleware de auth (já há `req.user`) e protegido por
 * `requireRole('admin')` no router inteiro: um operador autenticado recebe 403.
 * Substitui o cadastro manual de usuários @kavex direto no banco.
 */
const router = Router();

// Autorização: todas as rotas de gestão exigem papel admin.
router.use(requireRole('admin'));

const ator = (req: Request): string | undefined => req.user?.sub ?? req.user?.email;

const idParamSchema = z.object({ id: z.coerce.number().int().positive() });
const setAtivoSchema = z.object({ ativo: z.boolean() });
/**
 * `remover` decide se o vínculo Conexos é APAGADO; só o booleano `true` apaga. Qualquer outro
 * tipo (ex.: `"true"`) é 400 explícito — não cai no ramo de gravar login/senha nem é ignorado.
 */
const removerVinculoSchema = z.object({ remover: z.boolean().optional() }).passthrough();

/**
 * Mapeia erros de domínio (mensagens internas em inglês) para a resposta HTTP
 * com mensagem user-facing em PT-BR (consistente com `routes/auth.ts`). Devolve
 * false se não reconhecer o erro (deixa o middleware central tratar).
 */
const respondError = (res: Response, err: unknown): boolean => {
    if (err instanceof UsernameAlreadyExistsError) {
        res.status(409).json({ error: 'Já existe um usuário com este email.' });
        return true;
    }
    if (err instanceof MissingEncryptionKeyError) {
        res.status(503).json({
            error: 'Vínculo Conexos indisponível: a chave de criptografia não está configurada no servidor.',
        });
        return true;
    }
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.startsWith('NOT_FOUND:')) {
        res.status(404).json({ error: 'Usuário não encontrado.' });
        return true;
    }
    return false;
};

// GET /usuarios/meta — flags de configuração p/ a UI (ex.: se o vínculo Conexos
// está disponível — depende da chave de criptografia estar setada no servidor).
router.get(
    '/meta',
    asyncHandler(async (_req, res) => {
        await bootstrapAppContainer();
        const service = container.resolve(UserAdminService);
        res.json({ vinculoDisponivel: await service.vinculoDisponivel() });
    }),
);

// GET /usuarios — lista todos os usuários (sem hash de senha).
router.get(
    '/',
    asyncHandler(async (_req, res) => {
        await bootstrapAppContainer();
        const service = container.resolve(UserAdminService);
        res.json(await service.list());
    }),
);

// POST /usuarios — cria um novo usuário (email + senha + papel).
router.post(
    '/',
    asyncHandler(async (req, res) => {
        const parsed = createUserSchema.safeParse(req.body);
        if (!parsed.success) {
            res.status(400).json({
                error: parsed.error.issues[0]?.message ?? 'Requisição inválida',
            });
            return;
        }
        await bootstrapAppContainer();
        const service = container.resolve(UserAdminService);
        try {
            const created = await service.create(parsed.data, ator(req));
            res.status(201).json(created);
        } catch (err) {
            if (!respondError(res, err)) throw err;
        }
    }),
);

// PATCH /usuarios/:id/ativo — ativa/desativa o acesso de um usuário.
router.patch(
    '/:id/ativo',
    asyncHandler(async (req, res) => {
        const id = idParamSchema.safeParse(req.params);
        const body = setAtivoSchema.safeParse(req.body);
        if (!id.success || !body.success) {
            res.status(400).json({ error: 'Requisição inválida' });
            return;
        }
        await bootstrapAppContainer();
        const service = container.resolve(UserAdminService);
        try {
            await service.setAtivo(id.data.id, body.data.ativo);
            res.json({ id: id.data.id, ativo: body.data.ativo });
        } catch (err) {
            if (!respondError(res, err)) throw err;
        }
    }),
);

// POST /usuarios/:id/reset-senha — redefine a senha de um usuário.
router.post(
    '/:id/reset-senha',
    asyncHandler(async (req, res) => {
        const id = idParamSchema.safeParse(req.params);
        const body = resetPasswordSchema.safeParse(req.body);
        if (!id.success || !body.success) {
            res.status(400).json({
                error: body.success ? 'Requisição inválida' : body.error.issues[0]?.message,
            });
            return;
        }
        await bootstrapAppContainer();
        const service = container.resolve(UserAdminService);
        try {
            await service.resetPassword(id.data.id, body.data.password);
            res.json({ id: id.data.id, senhaRedefinida: true });
        } catch (err) {
            if (!respondError(res, err)) throw err;
        }
    }),
);

// PATCH /usuarios/:id/vinculo — define o vínculo Conexos (login + senha do ERP);
// `{ remover: true }` limpa o vínculo (o usuário volta a operar via robô).
router.patch(
    '/:id/vinculo',
    asyncHandler(async (req, res) => {
        const id = idParamSchema.safeParse(req.params);
        if (!id.success) {
            res.status(400).json({ error: 'Requisição inválida' });
            return;
        }
        await bootstrapAppContainer();
        const service = container.resolve(UserAdminService);
        try {
            const remocao = removerVinculoSchema.safeParse(req.body ?? {});
            if (!remocao.success) {
                res.status(400).json({ error: 'Campo "remover" deve ser verdadeiro ou falso.' });
                return;
            }
            if (remocao.data.remover === true) {
                await service.setVinculo(id.data.id, null);
                res.json({ id: id.data.id, vinculo: null });
                return;
            }
            const body = vinculoConexosSchema.safeParse(req.body);
            if (!body.success) {
                res.status(400).json({ error: 'Informe o login e a senha do Conexos.' });
                return;
            }
            await service.setVinculo(id.data.id, body.data);
            res.json({ id: id.data.id, conexosUsername: body.data.conexosUsername });
        } catch (err) {
            if (!respondError(res, err)) throw err;
        }
    }),
);

export default router;
