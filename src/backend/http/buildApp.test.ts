import 'reflect-metadata';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { buildApp } from './buildApp.js';
import { markDraining, resetReadinessForTests } from './readinessState.js';

jest.mock('../domain/appContainer.js', () => ({
    bootstrapAppContainer: jest.fn().mockResolvedValue(undefined),
    diagnosticarConfiguracao: jest.fn().mockResolvedValue(undefined),
}));

/**
 * A ordem dos middlewares é o contrato do `buildApp` (card `modifiability-3`).
 *
 * Trocar duas linhas de lugar ali é mudança de SEGURANÇA, não de estilo: mover o auth para depois
 * de um router expõe a rota; mover o requestId para depois do logger apaga a correlação. Enquanto
 * isso vivia no `index.ts`, que dispara o boot no import, nada disso podia ser exercitado por
 * teste — o arquivo tinha 0% de cobertura por construção.
 *
 * Porta efêmera + `fetch`, como em `routes/health.test.ts` (o repo não usa supertest).
 */
const subir = async (): Promise<{ server: Server; base: string }> => {
    const app = buildApp();
    const server: Server = await new Promise((r) => {
        const s = app.listen(0, '127.0.0.1', () => r(s));
    });
    const { port } = server.address() as AddressInfo;
    return { server, base: `http://127.0.0.1:${port}` };
};

describe('buildApp (modifiability-3)', () => {
    const bypassOriginal = process.env.DEV_AUTH_BYPASS;
    const segredoOriginal = process.env.AUTH_JWT_SECRET;

    beforeEach(() => {
        resetReadinessForTests();
        // Auth LIGADO de propósito: metade destes testes existe para provar que o middleware
        // continua entre as rotas públicas e as protegidas. Com bypass, não provariam nada.
        process.env.DEV_AUTH_BYPASS = 'false';
        process.env.AUTH_JWT_SECRET = 'segredo-de-teste-hs256-com-tamanho-suficiente';
    });

    afterEach(() => {
        resetReadinessForTests();
        process.env.DEV_AUTH_BYPASS = bypassOriginal;
        process.env.AUTH_JWT_SECRET = segredoOriginal;
        jest.restoreAllMocks();
    });

    it('serve /health publicamente, sem token', async () => {
        const { server, base } = await subir();
        const res = await fetch(`${base}/health`);

        expect(res.status).toBe(200);
        expect(await res.json()).toMatchObject({ status: 'ok' });
        server.close();
    });

    /** availability-1: o balanceador precisa parar de rotear ANTES de o processo sair. */
    it('vira /health para 503 durante o drain', async () => {
        markDraining();
        const { server, base } = await subir();
        const res = await fetch(`${base}/health`);

        expect(res.status).toBe(503);
        expect(await res.json()).toMatchObject({ status: 'shutting_down' });
        server.close();
    });

    it('devolve X-Request-Id em toda resposta (correlação)', async () => {
        const { server, base } = await subir();
        const res = await fetch(`${base}/health`);

        expect(res.headers.get('x-request-id')).toBeTruthy();
        server.close();
    });

    /**
     * O auth vem DEPOIS de `/health` e `/auth`, e ANTES de todo o resto. Se alguém mover o
     * `app.use(buildAuthMiddleware(...))` para baixo de um router, este teste é o que grita.
     */
    it('rejeita rota protegida sem autenticação', async () => {
        const { server, base } = await subir();
        const res = await fetch(`${base}/permutas/painel`);

        expect(res.status).toBe(401);
        server.close();
    });

    it('mantém /auth alcançável sem token', async () => {
        const { server, base } = await subir();
        const res = await fetch(`${base}/auth/login`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: '{}',
        });

        // Qualquer coisa menos 401: a rota tem de ser ALCANÇÁVEL sem token.
        expect(res.status).not.toBe(401);
        server.close();
    });
});
