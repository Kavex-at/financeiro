import 'reflect-metadata';
import { Router } from 'express';
import { container } from 'tsyringe';
import { z } from 'zod';
import { bootstrapAppContainer } from '../domain/appContainer.js';
import AuthService from '../domain/service/auth/AuthService.js';
import { asyncHandler } from '../http/asyncHandler.js';

/**
 * Zod no boundary — corpo do POST /login (Rule: validar inputs externos).
 *
 * `username` é o identificador: e-mail OU usuário legado (ADR-0051). O nome do campo não muda
 * para não quebrar o login na janela entre o deploy do front (Vercel) e o do back (Render).
 * Normalizado aqui (trim + minúsculas) porque o login não distingue caixa.
 */
const loginBodySchema = z.object({
    username: z.string().trim().toLowerCase().min(1),
    password: z.string().min(1),
});

/**
 * Login simples por e-mail ou usuário + senha. Rota PÚBLICA — montada ANTES do middleware
 * de auth global em `index.ts` (caso contrário ninguém conseguiria logar).
 *
 * Segue o padrão de `routes/conexos.ts`: resolve o service do container tsyringe
 * (nunca `new`), `bootstrapAppContainer()` no início (Postgres + migrations).
 */
const router = Router();

// POST /auth/login — valida credenciais e devolve um JWT HS256 próprio.
router.post(
    '/login',
    asyncHandler(async (req, res) => {
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

export default router;
