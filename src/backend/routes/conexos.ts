import 'reflect-metadata';
import { Router } from 'express';
import { container } from 'tsyringe';
import ConexosCadastroClient from '../domain/client/ConexosCadastroClient.js';
import { bootstrapAppContainer } from '../domain/appContainer.js';
import { somenteAutenticado } from '../http/acesso.js';
import { asyncHandler } from '../http/asyncHandler.js';

/**
 * Example route proving the Conexos ERP integration is wired end-to-end in the
 * skeleton. Domain features (financeiro) add their own routers following this
 * shape: resolve a client/service from the tsyringe container, never `new`.
 */
const router = Router();

// GET /conexos/filiais — lists the tenant's branches + the default filCod.
router.get(
    '/filiais',
    // JC-6: seletor de filial das três frentes — basta estar autenticado e ativo (ADR-0053).
    somenteAutenticado(),
    asyncHandler(async (_req, res) => {
        await bootstrapAppContainer();
        const client = container.resolve(ConexosCadastroClient);
        const [filiais, filCodDefault] = await Promise.all([
            client.listFiliais(),
            client.getFilCodDefault(),
        ]);
        res.json({ filiais, filCodDefault });
    }),
);

export default router;
