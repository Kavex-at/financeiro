import 'reflect-metadata';
import type { Response } from 'express';
import { Router } from 'express';
import { container } from 'tsyringe';
import { z } from 'zod';
import { bootstrapAppContainer } from '../domain/appContainer.js';
import { MissingEncryptionKeyError } from '../domain/libs/crypto/SecretCipher.js';
import AuthEmailInUseError from '../domain/errors/AuthEmailInUseError.js';
import EmailAlreadyInUseError from '../domain/errors/EmailAlreadyInUseError.js';
import LastUserManagerError from '../domain/errors/LastUserManagerError.js';
import RoleNotFoundError from '../domain/errors/RoleNotFoundError.js';
import SelfAccessRemovalError from '../domain/errors/SelfAccessRemovalError.js';
import ReactivationRequiresEmailError from '../domain/errors/ReactivationRequiresEmailError.js';
import SelfDeactivationError from '../domain/errors/SelfDeactivationError.js';
import SupabaseAuthRejectedError from '../domain/errors/SupabaseAuthRejectedError.js';
import SupabaseAuthUnavailableError from '../domain/errors/SupabaseAuthUnavailableError.js';
import { PERMISSION } from '../domain/interface/auth/Permission.js';
import UserAdminService, {
    createUserSchema,
    exceptionsBodySchema,
    resetPasswordSchema,
    setEmailSchema,
    setRoleSchema,
    vinculoConexosSchema,
} from '../domain/service/auth/UserAdminService.js';
import { exigirPermissao } from '../http/acesso.js';
import { asyncHandler } from '../http/asyncHandler.js';

/**
 * Gestão de usuários da plataforma (Fatia A) e do acesso deles (ADR-0053).
 *
 * Montado APÓS o auth e o `resolverAcesso` e protegido por `usuarios:gerenciar` no router inteiro:
 * quem não a tem recebe 403 com o código da permissão, em qualquer rota daqui.
 */
const router = Router();

// Autorização: todas as rotas de gestão exigem `usuarios:gerenciar`.
router.use(exigirPermissao(PERMISSION.USUARIOS_GERENCIAR));

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
    // R6 (ADR-0057): o Supabase Auth falhou dentro da transação, então ela foi desfeita.
    if (err instanceof SupabaseAuthUnavailableError || err instanceof SupabaseAuthRejectedError) {
        res.status(503).json({ error: 'Serviço de autenticação indisponível; nada foi alterado.' });
        return true;
    }
    if (err instanceof AuthEmailInUseError) {
        res.status(409).json({ error: 'Já existe um acesso com este e-mail.' });
        return true;
    }
    if (err instanceof ReactivationRequiresEmailError) {
        res.status(400).json({ error: 'Cadastre um e-mail antes de reativar este usuário.' });
        return true;
    }
    if (err instanceof EmailAlreadyInUseError) {
        res.status(409).json({ error: 'Este e-mail já identifica outro usuário.' });
        return true;
    }
    if (err instanceof SelfDeactivationError) {
        res.status(409).json({ error: 'Você não pode desativar o próprio acesso.' });
        return true;
    }
    if (err instanceof LastUserManagerError) {
        res.status(409).json({
            error: 'Não é possível remover o último usuário com permissão de gerenciar usuários.',
        });
        return true;
    }
    if (err instanceof SelfAccessRemovalError) {
        res.status(409).json({
            error: 'Você não pode remover a sua própria permissão de gerenciar usuários.',
        });
        return true;
    }
    if (err instanceof RoleNotFoundError) {
        res.status(404).json({ error: 'Papel não encontrado.' });
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

// GET /usuarios/papeis — papéis (com pacote) para o seletor, e o catálogo de permissões (D6).
router.get(
    '/papeis',
    asyncHandler(async (_req, res) => {
        await bootstrapAppContainer();
        const service = container.resolve(UserAdminService);
        res.json(await service.listarPapeis());
    }),
);

// GET /usuarios — lista todos os usuários (sem hash de senha), cada um com papel, exceções e
// permissões efetivas calculadas no servidor (D6). `role` continua no JSON (front antigo).
router.get(
    '/',
    asyncHandler(async (_req, res) => {
        await bootstrapAppContainer();
        const service = container.resolve(UserAdminService);
        res.json(await service.list());
    }),
);

// POST /usuarios — cria um novo usuário (e-mail + senha + papel), com username = e-mail.
// `papelId` é obrigatório (Q3). Na janela de deploy (D2), o front antigo ainda manda `username`
// (alias de `email`) e `role`: `'admin'` vira Administrador; o resto pede para atualizar a página.
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
        const actor = req.user?.sub;
        if (!actor) {
            res.status(401).json({ error: 'Não foi possível identificar quem está criando.' });
            return;
        }
        await bootstrapAppContainer();
        const service = container.resolve(UserAdminService);
        try {
            const created = await service.create(parsed.data, actor);
            res.status(201).json(created);
        } catch (err) {
            if (!respondError(res, err)) throw err;
        }
    }),
);

// PATCH /usuarios/:id/email — grava o e-mail de login (ADR-0051). Nunca edita `username` (I1):
// o schema só lê `email`. O autor da edição vem do token verificado (`req.user.sub`).
router.patch(
    '/:id/email',
    asyncHandler(async (req, res) => {
        const id = idParamSchema.safeParse(req.params);
        if (!id.success) {
            res.status(400).json({ error: 'Requisição inválida' });
            return;
        }
        const body = setEmailSchema.safeParse(req.body);
        if (!body.success) {
            res.status(400).json({ error: 'E-mail inválido.' });
            return;
        }
        const actor = req.user?.sub;
        if (!actor) {
            res.status(401).json({ error: 'Não foi possível identificar quem está editando.' });
            return;
        }
        await bootstrapAppContainer();
        const service = container.resolve(UserAdminService);
        try {
            await service.setEmail(id.data.id, body.data.email, actor);
            res.json({ id: id.data.id, email: body.data.email });
        } catch (err) {
            if (!respondError(res, err)) throw err;
        }
    }),
);

// PATCH /usuarios/:id/papel — troca o papel (ADR-0053). Guarda R9/R-extra: nem a própria
// `usuarios:gerenciar`, nem deixar zero gestores ativos (409). Mesmo papel = 200 sem mudança.
router.patch(
    '/:id/papel',
    asyncHandler(async (req, res) => {
        const id = idParamSchema.safeParse(req.params);
        const body = setRoleSchema.safeParse(req.body);
        if (!id.success || !body.success) {
            res.status(400).json({ error: 'Requisição inválida' });
            return;
        }
        const actor = req.user?.sub;
        if (!actor) {
            res.status(401).json({ error: 'Não foi possível identificar quem está alterando.' });
            return;
        }
        await bootstrapAppContainer();
        const service = container.resolve(UserAdminService);
        try {
            res.json(await service.atribuirPapel(id.data.id, body.data.papelId, actor));
        } catch (err) {
            if (!respondError(res, err)) throw err;
        }
    }),
);

// PUT /usuarios/:id/permissoes — substitui o conjunto de exceções (conceder/revogar) do usuário.
// Permissão fora do catálogo ou repetida = 400. Mesma guarda do papel.
router.put(
    '/:id/permissoes',
    asyncHandler(async (req, res) => {
        const id = idParamSchema.safeParse(req.params);
        if (!id.success) {
            res.status(400).json({ error: 'Requisição inválida' });
            return;
        }
        const body = exceptionsBodySchema.safeParse(req.body);
        if (!body.success) {
            const mensagem = body.error.issues.find((i) => i.code === 'custom')?.message;
            res.status(400).json({ error: mensagem ?? 'Requisição inválida' });
            return;
        }
        const actor = req.user?.sub;
        if (!actor) {
            res.status(401).json({ error: 'Não foi possível identificar quem está alterando.' });
            return;
        }
        await bootstrapAppContainer();
        const service = container.resolve(UserAdminService);
        try {
            res.json(await service.definirExcecoes(id.data.id, body.data.excecoes, actor));
        } catch (err) {
            if (!respondError(res, err)) throw err;
        }
    }),
);

// PATCH /usuarios/:id/ativo — ativa/desativa o acesso de um usuário. Desativar passa pela guarda
// R9/R-extra (nem o próprio acesso, nem o último usuário ativo com `usuarios:gerenciar`), e por
// isso exige saber QUEM pede: sem `req.user.sub`, recusa em vez de desativar às cegas.
router.patch(
    '/:id/ativo',
    asyncHandler(async (req, res) => {
        const id = idParamSchema.safeParse(req.params);
        const body = setAtivoSchema.safeParse(req.body);
        if (!id.success || !body.success) {
            res.status(400).json({ error: 'Requisição inválida' });
            return;
        }
        const actor = req.user?.sub;
        if (!actor) {
            res.status(401).json({ error: 'Não foi possível identificar quem está alterando.' });
            return;
        }
        await bootstrapAppContainer();
        const service = container.resolve(UserAdminService);
        try {
            await service.setAtivo(id.data.id, body.data.ativo, actor);
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
