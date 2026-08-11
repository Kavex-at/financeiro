import 'reflect-metadata';
import type { Response } from 'express';
import { Router } from 'express';
import { container } from 'tsyringe';
import { z } from 'zod';
import { bootstrapAppContainer } from '../domain/appContainer.js';
import { SupabaseEmailAlreadyExistsError } from '../domain/client/SupabaseAdminClient.js';
import { derivarUsuarioStatus } from '../domain/interface/auth/usuarioStatus.js';
import { MissingEncryptionKeyError } from '../domain/libs/crypto/SecretCipher.js';
import { UsernameAlreadyExistsError } from '../domain/repository/auth/UserRepository.js';
import UserAdminService, {
    SelfDeactivationError,
    createUserSchema,
    inviteUserSchema,
    vinculoConexosSchema,
} from '../domain/service/auth/UserAdminService.js';
import { asyncHandler } from '../http/asyncHandler.js';
import { auditActor, requireRole } from '../http/auth.js';

/**
 * Gestão de usuários da plataforma — só `admin`.
 *
 * Montado APÓS `buildAuthMiddleware` + `appUserContext` (já há `req.user` com `role` e
 * `username` VINDOS DO BANCO) e protegido por `requireRole('admin')` no router inteiro: um
 * operador autenticado recebe 403.
 *
 * Dois caminhos de cadastro (ADR-0030 §7), deliberadamente:
 * - `POST /usuarios/convite` — **padrão**. O titular define a própria senha. Depende de SMTP.
 * - `POST /usuarios` — **fallback**. O admin define a senha inicial. NÃO depende de SMTP, e é
 *   isso que impede a ausência de SMTP de virar um bloqueio duro da operação.
 */
const router = Router();

// Autorização: todas as rotas de gestão exigem papel admin.
router.use(requireRole('admin'));

const idParamSchema = z.object({ id: z.coerce.number().int().positive() });
const setAtivoSchema = z.object({ ativo: z.boolean() });

/**
 * `POST /:id/reset-senha` **deixa de aceitar senha**. O admin dispara um link de recuperação;
 * a senha nova nasce e morre entre o titular e o provedor. Enviar `password` é um cliente
 * chamando o contrato antigo — recusar com 400 é mais honesto do que aceitar e ignorar em
 * silêncio, que deixaria o admin achando que definiu uma senha que ninguém definiu.
 */
const resetSenhaBodySchema = z.record(z.unknown()).refine((body) => !('password' in body), {
    message:
        'Esta operação não aceita mais uma senha: o usuário recebe um link de redefinição por e-mail.',
});

/**
 * Mapeia erros de domínio (mensagens internas em inglês) para a resposta HTTP
 * com mensagem user-facing em PT-BR (consistente com `routes/auth.ts`). Devolve
 * false se não reconhecer o erro (deixa o middleware central tratar).
 */
const respondError = (res: Response, err: unknown): boolean => {
    if (
        err instanceof UsernameAlreadyExistsError ||
        err instanceof SupabaseEmailAlreadyExistsError
    ) {
        res.status(409).json({ error: 'Já existe um usuário com este email.' });
        return true;
    }
    if (err instanceof SelfDeactivationError) {
        // Mensagem DISTINTA do 403 genérico de papel (`requireRole`): quem cai aqui É admin,
        // e dizer "permissão insuficiente" mandaria a pessoa investigar a coisa errada.
        res.status(403).json({
            error: 'Você não pode desativar o seu próprio acesso. Peça a outro administrador.',
        });
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
    if (msg.startsWith('SUPABASE_ADMIN_FAILED:') || msg.startsWith('ORPHANED_GOTRUE_USER:')) {
        res.status(502).json({
            error: 'O provedor de identidade não respondeu. Tente novamente em instantes.',
        });
        return true;
    }
    return false;
};

const resolveService = async (): Promise<UserAdminService> => {
    await bootstrapAppContainer();
    return container.resolve(UserAdminService);
};

// GET /usuarios/meta — flags de configuração p/ a UI (ex.: se o vínculo Conexos
// está disponível — depende da chave de criptografia estar setada no servidor).
router.get(
    '/meta',
    asyncHandler(async (_req, res) => {
        const service = await resolveService();
        res.json({ vinculoDisponivel: await service.vinculoDisponivel() });
    }),
);

// GET /usuarios — lista todos os usuários (sem hash de senha), com o STATUS derivado.
router.get(
    '/',
    asyncHandler(async (_req, res) => {
        const service = await resolveService();
        const usuarios = await service.list();
        // A UI precisa distinguir "nunca entrou" (convidado) de "acesso revogado" (inativo).
        // Os dois são `ativo = false` no banco; derivar aqui evita que cada tela reinvente a
        // regra — e errá-la é oferecer "reenviar convite" para quem foi desligado.
        res.json(
            usuarios.map((u) => ({
                ...u,
                status: derivarUsuarioStatus({
                    ativo: u.ativo,
                    convitePendente: u.convitePendente,
                }),
            })),
        );
    }),
);

// POST /usuarios/convite — U1, CAMINHO PADRÃO. O titular define a própria senha.
router.post(
    '/convite',
    asyncHandler(async (req, res) => {
        const parsed = inviteUserSchema.safeParse(req.body);
        if (!parsed.success) {
            res.status(400).json({
                error: parsed.error.issues[0]?.message ?? 'Requisição inválida',
            });
            return;
        }
        const service = await resolveService();
        try {
            res.status(201).json(await service.convidarUsuario(parsed.data, auditActor(req)));
        } catch (err) {
            if (!respondError(res, err)) throw err;
        }
    }),
);

// POST /usuarios — U3, FALLBACK com senha (não depende de SMTP).
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
        const service = await resolveService();
        try {
            const created = await service.cadastrarUsuarioComSenha(parsed.data, auditActor(req));
            res.status(201).json(created);
        } catch (err) {
            if (!respondError(res, err)) throw err;
        }
    }),
);

// PATCH /usuarios/:id/ativo — U4/U5. Propaga o SUCESSO PARCIAL para a UI.
router.patch(
    '/:id/ativo',
    asyncHandler(async (req, res) => {
        const id = idParamSchema.safeParse(req.params);
        const body = setAtivoSchema.safeParse(req.body);
        if (!id.success || !body.success) {
            res.status(400).json({ error: 'Requisição inválida' });
            return;
        }
        const service = await resolveService();
        try {
            // `banGoTrue: 'falhou'` é 200, não erro: o acesso ESTÁ revogado localmente. A UI
            // precisa do sinal para avisar que a sessão viva ainda pode ser renovada — mas
            // devolver erro faria o admin crer que não desativou ninguém.
            res.json(await service.setAtivo(id.data.id, body.data.ativo, auditActor(req)));
        } catch (err) {
            if (!respondError(res, err)) throw err;
        }
    }),
);

// POST /usuarios/:id/reset-senha — dispara o LINK de recuperação. Não recebe senha.
router.post(
    '/:id/reset-senha',
    asyncHandler(async (req, res) => {
        const id = idParamSchema.safeParse(req.params);
        if (!id.success) {
            res.status(400).json({ error: 'Requisição inválida' });
            return;
        }
        const body = resetSenhaBodySchema.safeParse(req.body ?? {});
        if (!body.success) {
            res.status(400).json({
                error: body.error.issues[0]?.message ?? 'Requisição inválida',
            });
            return;
        }
        const service = await resolveService();
        try {
            await service.redefinirSenhaDeTerceiro(id.data.id);
            res.json({ id: id.data.id, linkEnviado: true });
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
        const service = await resolveService();
        try {
            if (req.body?.remover === true) {
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
