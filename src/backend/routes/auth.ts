import 'reflect-metadata';
import { Router } from 'express';
import { container } from 'tsyringe';
import { z } from 'zod';
import { bootstrapAppContainer } from '../domain/appContainer.js';
import EnvironmentProvider from '../domain/libs/environment/EnvironmentProvider.js';
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

// GET /auth/transicao — o banner de transição para e-mail na tela de login está ligado?
// PÚBLICA (a tela de login não tem token). Devolve SÓ `{ ativo: boolean }` (I5): nada de contagem,
// nomes ou e-mails. Vem da chave manual `AUTH_TRANSICAO_EMAIL_BANNER`, não do banco — por isso não
// chama `bootstrapAppContainer` nem resolve repositório nenhum. `no-store` para que desligar a
// chave valha no próximo carregamento da tela.
router.get(
    '/transicao',
    asyncHandler(async (_req, res) => {
        const env = await container.resolve(EnvironmentProvider).getEnvironmentVars();
        res.set('Cache-Control', 'no-store');
        res.status(200).json({ ativo: env.authTransicaoEmailBanner === true });
    }),
);

export default router;
