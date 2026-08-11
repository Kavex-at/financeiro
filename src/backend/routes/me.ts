import 'reflect-metadata';
import { Router } from 'express';
import { container } from 'tsyringe';
import { bootstrapAppContainer } from '../domain/appContainer.js';
import ConexosSessionResolver from '../domain/client/ConexosSessionResolver.js';
import { asyncHandler } from '../http/asyncHandler.js';

/**
 * Rotas do PRÓPRIO usuário autenticado (não-admin). Montado após `buildAuthMiddleware` +
 * `appUserContext`, portanto `req.user` já carrega `username` e `role` RESOLVIDOS DO BANCO.
 */
const router = Router();

/**
 * `GET /me` — quem é o usuário logado, **segundo o banco**.
 *
 * É a **fonte do `role` no frontend**, e a razão de existir é um modo de falha silencioso:
 * o front lia o claim `role` do token (sem verificar) para decidir o que mostrar. O token do
 * GoTrue traz `role: 'authenticated'` para **todo mundo** — logo, no dia do cutover,
 * `useIsAdmin()` retornaria `false` para os próprios admins e a tela `/usuarios` e o card de
 * admin **sumiriam**, sem erro, sem log e sem teste vermelho. O backend continuaria
 * autorizando corretamente; só a UI desapareceria.
 *
 * É o espelho exato, no frontend, do problema que a ADR-0030 §3(4) resolve no backend — e a
 * solução é a mesma: **o papel vem do banco**.
 */
router.get(
    '/',
    asyncHandler(async (req, res) => {
        res.json({
            username: req.user?.username ?? null,
            role: req.user?.role ?? null,
        });
    }),
);

// GET /me/conexos-status — { status: 'ok' | 'falha' | 'ausente' }.
//   ok      = a credencial Conexos do usuário logou (execuções saem no nome dele);
//   falha   = tem vínculo, mas a credencial não logou → opera via robô (avisar!);
//   ausente = sem vínculo → opera via robô (normal, sem alarde).
router.get(
    '/conexos-status',
    asyncHandler(async (req, res) => {
        await bootstrapAppContainer();
        const resolver = container.resolve(ConexosSessionResolver);
        // Leitura de IDENTIDADE, não de auditoria — por isso `req.user?.username` direto,
        // SEM `auditActor`. A ausência é significativa: é ela que produz 'ausente'. Um
        // fallback `'unknown'` faria `testarVinculo('unknown')` — um SELECT vazio
        // indistinguível de "sem vínculo".
        const username = req.user?.username;
        const status = username ? await resolver.testarVinculo(username) : 'ausente';
        res.json({ status });
    }),
);

export default router;
