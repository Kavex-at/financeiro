import type { RequestHandler } from 'express';
import { container } from 'tsyringe';
import { bootstrapAppContainer } from '../domain/appContainer.js';
import EnvironmentProvider from '../domain/libs/environment/EnvironmentProvider.js';
import { asyncHandler } from './asyncHandler.js';

/**
 * Bloqueio da Frente IV (Recebimentos) via URL. Quando `recebimentosEnabled` é false
 * (produção, por padrão), qualquer `/recebimentos/*` responde 403 — o backend nega o
 * acesso direto à API, não só o frontend. Habilitado fora de produção para o
 * desenvolvimento seguir. Espelha `sispagGate`. Ver
 * `EnvironmentProvider.resolveRecebimentosEnabled`.
 */
export const recebimentosGate: RequestHandler = asyncHandler(async (_req, res, next) => {
    await bootstrapAppContainer();
    const env = await container.resolve(EnvironmentProvider).getEnvironmentVars();
    if (!env.recebimentosEnabled) {
        res.status(403).json({ error: 'Recebimentos indisponível.' });
        return;
    }
    next();
});
