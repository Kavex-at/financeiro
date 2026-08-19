import type { RequestHandler } from 'express';
import { container } from 'tsyringe';
import { bootstrapAppContainer } from '../domain/appContainer.js';
import EnvironmentProvider from '../domain/libs/environment/EnvironmentProvider.js';
import { asyncHandler } from './asyncHandler.js';

/**
 * Bloqueio da Frente V (Workflow de Aprovação) via URL. Quando `aprovacoesEnabled` é
 * false, qualquer `/aprovacoes/*` responde 403 — o backend nega o acesso direto à API,
 * não só o frontend. Espelha `recebimentosGate`. Ver
 * `EnvironmentProvider.resolveAprovacoesEnabled`.
 */
export const aprovacoesGate: RequestHandler = asyncHandler(async (_req, res, next) => {
    await bootstrapAppContainer();
    const env = await container.resolve(EnvironmentProvider).getEnvironmentVars();
    if (!env.aprovacoesEnabled) {
        res.status(403).json({ error: 'Aprovações indisponível.' });
        return;
    }
    next();
});
