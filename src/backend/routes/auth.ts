import 'reflect-metadata';
import { Router } from 'express';
import { container } from 'tsyringe';
import { z } from 'zod';
import { bootstrapAppContainer } from '../domain/appContainer.js';
import AuthService from '../domain/service/auth/AuthService.js';
import UserAdminService from '../domain/service/auth/UserAdminService.js';
import { asyncHandler } from '../http/asyncHandler.js';
import { loadAuthEnv } from '../http/authEnv.js';
import { heavyRouteLimiter } from '../http/rateLimit.js';

/** Zod no boundary — corpo do POST /login (Rule: validar inputs externos). */
const loginBodySchema = z.object({
    username: z.string().trim().min(1),
    password: z.string().min(1),
});

/** Zod no boundary — corpo do POST /forgot-password (rota PÚBLICA). */
const forgotPasswordBodySchema = z.object({
    username: z.string().trim().toLowerCase().min(1),
});

/**
 * Rotas PÚBLICAS de autenticação — montadas ANTES do middleware de auth global em
 * `index.ts` (caso contrário ninguém conseguiria logar nem recuperar a senha).
 *
 * Segue o padrão de `routes/conexos.ts`: resolve o service do container tsyringe
 * (nunca `new`), `bootstrapAppContainer()` no início (Postgres + migrations).
 */
const router = Router();

/**
 * Flag lida do `authEnv` VALIDADO (Zod, nunca `process.env` cru no route), uma vez no
 * carregamento do módulo — como o resto da configuração de auth.
 */
const { legacyLoginEnabled } = loadAuthEnv();

/**
 * `POST /auth/login` — login legado por usuário/senha, assinando um JWT HS256 próprio.
 *
 * **É o botão de rollback da Fase 3 do cutover** (ADR-0030 §6). Enquanto
 * `AUTH_LEGACY_LOGIN_ENABLED=true` (default), ele funciona lado a lado com o GoTrue;
 * `false` o desliga.
 *
 * ⚠️ **Gate operacional:** desligar a flag enquanto existir `app_user` com
 * `auth_user_id IS NULL` deixa esse usuário **sem nenhum caminho de login** — o legado
 * desligado e ele inexistente no provedor. `listPendingMigration()` retornando vazio é a
 * pré-condição da transição de fase, não um relatório.
 */
router.post(
    '/login',
    asyncHandler(async (req, res) => {
        if (!legacyLoginEnabled) {
            // 410 Gone, não 404: o recurso EXISTIU e foi retirado deliberadamente. Um 404
            // sugeriria erro de rota e mandaria quem diagnostica procurar no lugar errado.
            res.status(410).json({
                error: 'O login por senha nesta aplicação foi desativado. Use a tela de entrada padrão.',
            });
            return;
        }

        const parsed = loginBodySchema.safeParse(req.body);
        if (!parsed.success) {
            res.status(400).json({ error: 'Requisição inválida' });
            return;
        }

        await bootstrapAppContainer();
        const service = container.resolve(AuthService);
        const result = await service.login(parsed.data);
        if (!result) {
            res.status(401).json({ error: 'Credenciais inválidas' });
            return;
        }
        res.status(200).json(result);
    }),
);

/**
 * `POST /auth/forgot-password` — self-service de redefinição de senha. **Rota pública.**
 *
 * **A resposta é constante**: mesmo corpo e mesmo status exista ou não o usuário, esteja ele
 * ativo ou não, funcione o SMTP ou não. Um endpoint público que diferencia *"e-mail não
 * cadastrado"* de *"enviamos o link"* entrega a **lista de funcionários da Columbia** a
 * qualquer pessoa na internet, um e-mail por vez — é a primeira coisa que um scanner tenta
 * contra um formulário de recuperação.
 *
 * O `heavyRouteLimiter` está aqui pela mesma razão: sem limite, uma resposta constante ainda
 * pode ser sondada por volume.
 */
router.post(
    '/forgot-password',
    heavyRouteLimiter,
    asyncHandler(async (req, res) => {
        const parsed = forgotPasswordBodySchema.safeParse(req.body);
        await bootstrapAppContainer();
        const service = container.resolve(UserAdminService);
        // Input malformado responde IGUAL — validar "para fora" também seria um oráculo.
        const username = parsed.success ? parsed.data.username : '';
        res.status(200).json(await service.solicitarRedefinicaoSenha(username));
    }),
);

export default router;
