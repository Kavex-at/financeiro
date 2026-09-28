import 'reflect-metadata';
import { Router } from 'express';
import { container } from 'tsyringe';
import { bootstrapAppContainer } from '../domain/appContainer.js';
import ConexosSessionResolver from '../domain/client/ConexosSessionResolver.js';
import { PERMISSION } from '../domain/interface/auth/Permission.js';
import { somenteAutenticado } from '../http/acesso.js';
import { asyncHandler } from '../http/asyncHandler.js';

/**
 * Rotas do PRÓPRIO usuário autenticado. Montado após o auth e o `resolverAcesso`; as duas rotas
 * exigem só usuário existente e ativo (JC-6), com o guard explícito `somenteAutenticado()`.
 */
const router = Router();

// GET /me/conexos-status — { status: 'ok' | 'falha' | 'ausente' }.
//   ok      = a credencial Conexos do usuário logou (execuções saem no nome dele);
//   falha   = tem vínculo, mas a credencial não logou → opera via robô (avisar!);
//   ausente = sem vínculo → opera via robô (normal, sem alarde).
router.get(
    '/conexos-status',
    somenteAutenticado(),
    asyncHandler(async (req, res) => {
        await bootstrapAppContainer();
        const resolver = container.resolve(ConexosSessionResolver);
        const username = req.user?.sub;
        const status = username ? await resolver.testarVinculo(username) : 'ausente';
        res.json({ status });
    }),
);

// GET /me/permissoes — o que ESTE usuário pode, calculado no servidor (ADR-0053). É a fonte única
// do front (`usePermissoes`): nav, cards, páginas e botões se escondem por aqui. Esconder é
// ergonomia; o gate real continua sendo o guard de cada rota (I2).
//
// `operacao` é compatibilidade com o front da v0.43 na janela de deploy (R10): deriva de
// `operacao:ver` e sai num tweak posterior. `no-store` porque a permissão muda sem o token mudar.
router.get(
    '/permissoes',
    somenteAutenticado(),
    asyncHandler(async (req, res) => {
        const acesso = req.acesso;
        if (!acesso) throw new Error('GET /me/permissoes sem req.acesso: resolverAcesso não rodou');
        const permissoes = [...acesso.permissoes].sort();
        res.setHeader('Cache-Control', 'no-store');
        res.json({
            permissoes,
            papel: acesso.papel,
            operacao: acesso.permissoes.has(PERMISSION.OPERACAO_VER),
        });
    }),
);

export default router;
