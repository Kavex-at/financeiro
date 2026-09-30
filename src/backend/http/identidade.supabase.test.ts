import 'reflect-metadata';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import express, { type NextFunction, type Request, type Response } from 'express';
import { type JWTVerifyGetKey, type KeyLike, SignJWT, generateKeyPair } from 'jose';
import { container } from 'tsyringe';

// O bootstrap real importa migrations (usa `import.meta`, incompatível com o transform CJS).
jest.mock('../domain/appContainer.js', () => ({
    bootstrapAppContainer: jest.fn().mockResolvedValue(undefined),
}));

import ConexosSessionResolver from '../domain/client/ConexosSessionResolver.js';
import { PERMISSION_CATALOG, type Permission } from '../domain/interface/auth/Permission.js';
import { conexosRequestContext } from '../domain/libs/requestContext/ConexosRequestContext.js';
import RecebimentoIngestaoRunRepository from '../domain/repository/recebimentos/RecebimentoIngestaoRunRepository.js';
import TransacaoRepository from '../domain/repository/recebimentos/TransacaoRepository.js';
import type { ChaveAcesso, ResolvedAccess } from '../domain/service/auth/AccessService.js';
import UserAdminService from '../domain/service/auth/UserAdminService.js';
import ReconciliacaoPermutaService from '../domain/service/permutas/ReconciliacaoPermutaService.js';
import ImportacaoExtratoArquivoService from '../domain/service/recebimentos/ImportacaoExtratoArquivoService.js';
import IngestaoTransacoesService from '../domain/service/recebimentos/IngestaoTransacoesService.js';
import meRouter from '../routes/me.js';
import permutasRouter from '../routes/permutas.js';
import recebimentosRouter from '../routes/recebimentos.js';
import usuariosRouter from '../routes/usuarios.js';
import { resolverAcesso } from './acesso.js';
import { buildAuthMiddleware } from './auth.js';
import { conexosIdentityMiddleware } from './conexosIdentity.js';

/**
 * Gate de identidade I2 (ADR-0056): com um token do SUPABASE (ES256, `sub = <uuid>`,
 * `email = x@columbiabr.com`), toda a cadeia auth → resolverAcesso → identidade Conexos → rotas
 * enxerga `sub = 'fulano'` (o `app_user.username`). Nenhuma trilha grava o UUID nem o e-mail.
 */
const SUPABASE_URL = 'https://kngrpoqzaxtuzkcugsyl.supabase.co';
const UUID = '0b5c2d0e-6a0c-4c8e-9b8e-2b1d3c4e5f60';
const USERNAME = 'fulano';
const EMAIL_DO_TOKEN = 'x@columbiabr.com';

let privateKey: KeyLike;
let keyResolver: JWTVerifyGetKey;
let server: Server;
let base: string;
let token: string;
const resolver = jest.fn(
    async (chave: ChaveAcesso): Promise<ResolvedAccess | null> =>
        chave.tipo === 'authUserId' && chave.valor === UUID
            ? {
                  userId: 42,
                  username: USERNAME,
                  ativo: true,
                  authUserId: UUID,
                  papel: { id: 1, nome: 'Administrador' },
                  permissoes: new Set<Permission>(PERMISSION_CATALOG),
              }
            : null,
);
const contextoConexos: Array<string | undefined> = [];

beforeAll(async () => {
    const pair = await generateKeyPair('ES256');
    privateKey = pair.privateKey;
    keyResolver = (() => pair.publicKey) as unknown as JWTVerifyGetKey;
    token = await new SignJWT({
        role: 'authenticated',
        is_anonymous: false,
        email: EMAIL_DO_TOKEN,
    })
        .setProtectedHeader({ alg: 'ES256', kid: 'k' })
        .setIssuer(`${SUPABASE_URL}/auth/v1`)
        .setAudience('authenticated')
        .setSubject(UUID)
        .setIssuedAt()
        .setExpirationTime('1h')
        .sign(privateKey);

    // Mesma ordem do `buildApp`: auth → resolverAcesso → identidade Conexos → routers.
    const app = express();
    app.use(express.json());
    app.use(
        buildAuthMiddleware(
            { provider: 'supabase', supabaseUrl: SUPABASE_URL, devBypass: false },
            keyResolver,
        ),
    );
    app.use(
        resolverAcesso({
            devBypass: false,
            obterServico: async () => ({ resolver }),
            obterLog: () => ({ error: jest.fn().mockResolvedValue(undefined) }),
        }),
    );
    app.use(conexosIdentityMiddleware);
    app.use((_req: Request, _res: Response, next: NextFunction) => {
        contextoConexos.push(conexosRequestContext.getStore()?.platformUsername);
        next();
    });
    app.use('/me', meRouter);
    app.use('/usuarios', usuariosRouter);
    app.use('/permutas', permutasRouter);
    app.use('/recebimentos', recebimentosRouter);
    server = await new Promise((r) => {
        const s = app.listen(0, '127.0.0.1', () => r(s));
    });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
    await new Promise((r) => server.close(r));
});

afterEach(() => {
    container.clearInstances();
    jest.restoreAllMocks();
    contextoConexos.length = 0;
});

const chamar = (metodo: string, caminho: string, body?: unknown) =>
    fetch(`${base}${caminho}`, {
        method: metodo,
        headers: {
            authorization: `Bearer ${token}`,
            ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
    });

/** Nenhum valor capturado pode ser o UUID nem o e-mail do token. */
const semUuidNemEmail = (valores: unknown[]) => {
    const texto = JSON.stringify(valores);
    expect(texto).not.toContain(UUID);
    expect(texto).not.toContain(EMAIL_DO_TOKEN);
};

describe('I2 — token Supabase, identidade = app_user.username em toda a cadeia', () => {
    it('o resolverAcesso procura pelo auth_user_id e a identidade Conexos recebe "fulano"', async () => {
        const testarVinculo = jest.fn().mockResolvedValue('ok');
        container.registerInstance(ConexosSessionResolver, { testarVinculo } as never);

        const res = await chamar('GET', '/me/conexos-status');

        expect(res.status).toBe(200);
        expect(resolver).toHaveBeenCalledWith({ tipo: 'authUserId', valor: UUID });
        expect(contextoConexos).toEqual([USERNAME]);
        // GET /me/conexos-status consulta o vínculo por 'fulano'.
        expect(testarVinculo).toHaveBeenCalledWith(USERNAME);
    });

    it('/usuarios: o ator gravado é "fulano"', async () => {
        const atribuirPapel = jest.fn().mockResolvedValue({ id: 7, papel: { id: 2, nome: 'X' } });
        container.registerInstance(UserAdminService, { atribuirPapel } as never);

        const res = await chamar('PATCH', '/usuarios/7/papel', { papelId: 2 });

        expect(res.status).toBe(200);
        expect(atribuirPapel).toHaveBeenCalledWith(7, 2, USERNAME);
        semUuidNemEmail(atribuirPapel.mock.calls);
    });

    it('Permutas: executado_por da reconciliação é "fulano"', async () => {
        const reconciliar = jest.fn().mockResolvedValue({ ok: true });
        container.registerInstance(ReconciliacaoPermutaService, { reconciliar } as never);

        const res = await chamar('POST', '/permutas/adiantamentos/123/reconciliar', {
            dryRun: true,
        });

        expect(res.status).toBe(200);
        expect(reconciliar).toHaveBeenCalledWith(
            expect.objectContaining({ executadoPor: USERNAME }),
        );
        semUuidNemEmail(reconciliar.mock.calls);
    });

    it('Recebimentos: triggeredBy da ingestão (:735) é "fulano"', async () => {
        const runMany = jest.fn().mockResolvedValue({ runId: 'r1', total: 0, deduplicadas: 0 });
        container.registerInstance(IngestaoTransacoesService, {
            resolverFilCods: jest.fn().mockResolvedValue([1]),
            resolverPeriodo: jest
                .fn()
                .mockResolvedValue({ de: new Date('2026-09-01'), ate: new Date('2026-09-30') }),
            runMany,
        } as never);
        container.registerInstance(RecebimentoIngestaoRunRepository, {
            findRunIdByIdempotencyKey: jest.fn(),
            recordIdempotencyKey: jest.fn(),
        } as never);

        const res = await chamar('POST', '/recebimentos/ingestao', { filCods: [1] });

        expect(res.status).toBe(200);
        expect(runMany).toHaveBeenCalledWith(expect.objectContaining({ triggeredBy: USERNAME }));
        semUuidNemEmail(runMany.mock.calls);
    });

    it('Recebimentos: triggeredBy do upload (:935) é "fulano"', async () => {
        const importar = jest.fn().mockResolvedValue({ importadas: 0 });
        container.registerInstance(ImportacaoExtratoArquivoService, { importar } as never);
        const form = new FormData();
        form.append('filCod', '1');
        form.append('gerNum', '10');
        form.append('file', new Blob([Buffer.from('x')]), 'extrato.xlsx');

        const res = await fetch(`${base}/recebimentos/ingestao/upload`, {
            method: 'POST',
            headers: { authorization: `Bearer ${token}` },
            body: form,
        });

        expect(res.status).toBe(200);
        expect(importar).toHaveBeenCalledWith(expect.objectContaining({ triggeredBy: USERNAME }));
        const { buffer: _buffer, ...semBuffer } = importar.mock.calls[0][0];
        semUuidNemEmail([semBuffer]);
    });

    it('Recebimentos: ator do arquivar (:975) é "fulano"', async () => {
        const arquivar = jest.fn().mockResolvedValue(true);
        container.registerInstance(TransacaoRepository, {
            findById: jest.fn().mockResolvedValue({ id: 't1' }),
            arquivar,
        } as never);

        const res = await chamar('POST', '/recebimentos/transacoes/t1/arquivar');

        expect(res.status).toBe(200);
        expect(arquivar).toHaveBeenCalledWith('t1', USERNAME);
        expect(await res.json()).toMatchObject({ ator: USERNAME });
    });

    it('token Supabase de um UUID sem app_user: 401, nenhuma rota roda', async () => {
        const outro = await new SignJWT({ role: 'authenticated', is_anonymous: false })
            .setProtectedHeader({ alg: 'ES256', kid: 'k' })
            .setIssuer(`${SUPABASE_URL}/auth/v1`)
            .setAudience('authenticated')
            .setSubject('11111111-2222-4333-8444-555555555555')
            .setExpirationTime('1h')
            .sign(privateKey);
        const res = await fetch(`${base}/me/conexos-status`, {
            headers: { authorization: `Bearer ${outro}` },
        });
        expect(res.status).toBe(401);
        expect(contextoConexos).toEqual([]);
    });
});
