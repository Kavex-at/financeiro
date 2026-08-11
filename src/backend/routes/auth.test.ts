import 'reflect-metadata';
import { readFileSync } from 'node:fs';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import express from 'express';
import { container } from 'tsyringe';

jest.mock('../domain/appContainer.js', () => ({
    bootstrapAppContainer: jest.fn().mockResolvedValue(undefined),
}));

import { errorMiddleware } from '../http/errorMiddleware.js';

interface TestServer {
    url: string;
    close: () => Promise<void>;
}

const listen = (app: express.Express): Promise<TestServer> =>
    new Promise((resolve) => {
        const server: Server = app.listen(0, () => {
            const { port } = server.address() as AddressInfo;
            resolve({
                url: `http://127.0.0.1:${port}`,
                close: () => new Promise((r) => server.close(() => r())),
            });
        });
    });

const post = (url: string, body: unknown) =>
    fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
    });

/**
 * O router lê a flag no CARREGAMENTO do módulo (como o resto da configuração de auth), então
 * o ambiente precisa ser montado antes do `import`, e o registry de módulos resetado entre
 * cenários.
 */
interface FreshModules {
    container: typeof container;
    AuthService: unknown;
    UserAdminService: unknown;
}

let freshContainer: typeof container | undefined;

const loadRouter = async (
    env: Record<string, string | undefined>,
    register: (deps: FreshModules) => void = () => undefined,
): Promise<express.Express> => {
    jest.resetModules();
    const previous = { ...process.env };
    Object.assign(process.env, { AUTH_JWT_SECRET: 'test-secret', ...env });
    const { default: authRouter } = await import('./auth.js');
    // Depois de `resetModules` TUDO é novo — inclusive o módulo `tsyringe`, e portanto o
    // próprio `container`. Registrar no container importado no topo deste arquivo não
    // alcançaria o router: ele resolve de outro. Os tokens de DI são as próprias classes,
    // que também são objetos novos.
    const { container: fresh } = await import('tsyringe');
    const { default: AuthService } = await import('../domain/service/auth/AuthService.js');
    const { default: UserAdminService } = await import(
        '../domain/service/auth/UserAdminService.js'
    );
    Object.assign(process.env, previous);
    freshContainer = fresh;
    register({ container: fresh, AuthService, UserAdminService });

    const app = express();
    app.use(express.json());
    app.use('/auth', authRouter);
    app.use(errorMiddleware);
    return app;
};

afterEach(() => {
    container.clearInstances();
    freshContainer?.clearInstances();
    freshContainer = undefined;
    jest.restoreAllMocks();
});

describe('POST /auth/login — o botão de rollback da Fase 3', () => {
    it('funciona com AUTH_LEGACY_LOGIN_ENABLED=true (default do rollout)', async () => {
        const server = await listen(
            await loadRouter(
                { AUTH_LEGACY_LOGIN_ENABLED: 'true' },
                ({ container: di, AuthService }) => {
                    di.registerInstance(
                        AuthService as never,
                        {
                            login: jest.fn().mockResolvedValue({
                                token: 'jwt',
                                username: 'a@kavex.com',
                                role: 'admin',
                            }),
                        } as never,
                    );
                },
            ),
        );
        try {
            const res = await post(`${server.url}/auth/login`, {
                username: 'a@kavex.com',
                password: 'segredo12',
            });
            expect(res.status).toBe(200);
        } finally {
            await server.close();
        }
    });

    it('responde 410 Gone com AUTH_LEGACY_LOGIN_ENABLED=false — e NÃO chama o service', async () => {
        // 410, não 404: o recurso EXISTIU e foi retirado deliberadamente. Um 404 mandaria
        // quem diagnostica procurar um erro de rota que não existe.
        const login = jest.fn();
        const server = await listen(
            await loadRouter(
                { AUTH_LEGACY_LOGIN_ENABLED: 'false' },
                ({ container: di, AuthService }) => {
                    di.registerInstance(AuthService as never, { login } as never);
                },
            ),
        );
        try {
            const res = await post(`${server.url}/auth/login`, {
                username: 'a@kavex.com',
                password: 'segredo12',
            });
            expect(res.status).toBe(410);
            expect(login).not.toHaveBeenCalled();
        } finally {
            await server.close();
        }
    });

    it('a flag ausente NÃO desliga o login (default-on protege quem não migrou)', async () => {
        const server = await listen(
            await loadRouter({}, ({ container: di, AuthService }) => {
                di.registerInstance(
                    AuthService as never,
                    {
                        login: jest.fn().mockResolvedValue(null),
                    } as never,
                );
            }),
        );
        try {
            // 401 (credencial inválida), não 410 — a rota está VIVA.
            const res = await post(`${server.url}/auth/login`, {
                username: 'a@kavex.com',
                password: 'errada',
            });
            expect(res.status).toBe(401);
        } finally {
            await server.close();
        }
    });

    it('a flag vem do authEnv validado, nunca de process.env cru no route', () => {
        const source = readFileSync(path.join(__dirname, 'auth.ts'), 'utf8');
        expect(source).toContain('loadAuthEnv');
        const code = source
            .split('\n')
            .filter((l) => {
                const t = l.trimStart();
                return !t.startsWith('*') && !t.startsWith('/*') && !t.startsWith('//');
            })
            .join('\n');
        expect(code).not.toContain('process.env');
    });
});

describe('POST /auth/forgot-password — anti-enumeração', () => {
    it('resposta IDÊNTICA (status e corpo) exista ou não o usuário', async () => {
        // Um endpoint público que diferencia "e-mail não cadastrado" de "enviamos o link"
        // entrega a lista de funcionários da Columbia, um e-mail por vez.
        const solicitarRedefinicaoSenha = jest
            .fn()
            .mockResolvedValue({ enviado: true, mensagem: 'Se este e-mail estiver cadastrado...' });
        const server = await listen(
            await loadRouter({}, ({ container: di, UserAdminService }) => {
                di.registerInstance(
                    UserAdminService as never,
                    {
                        solicitarRedefinicaoSenha,
                    } as never,
                );
            }),
        );
        try {
            const existe = await post(`${server.url}/auth/forgot-password`, {
                username: 'existe@kavex.com',
            });
            const naoExiste = await post(`${server.url}/auth/forgot-password`, {
                username: 'fantasma@kavex.com',
            });

            expect(existe.status).toBe(naoExiste.status);
            expect(await existe.text()).toBe(await naoExiste.text());
        } finally {
            await server.close();
        }
    });

    it('input malformado responde IGUAL — validar "para fora" também seria um oráculo', async () => {
        const solicitarRedefinicaoSenha = jest
            .fn()
            .mockResolvedValue({ enviado: true, mensagem: 'ok' });
        const server = await listen(
            await loadRouter({}, ({ container: di, UserAdminService }) => {
                di.registerInstance(
                    UserAdminService as never,
                    {
                        solicitarRedefinicaoSenha,
                    } as never,
                );
            }),
        );
        try {
            const valido = await post(`${server.url}/auth/forgot-password`, {
                username: 'a@kavex.com',
            });
            const invalido = await post(`${server.url}/auth/forgot-password`, { username: '' });
            expect(invalido.status).toBe(valido.status);
            expect(await invalido.text()).toBe(await valido.text());
        } finally {
            await server.close();
        }
    });
});

describe('GUARDA — seed-admin não carrega credencial em código (ADR-0030 §9)', () => {
    it('o default hardcoded foi REMOVIDO e a ausência de ADMIN_PASSWORD falha', () => {
        // Uma senha de administrador em código-fonte, num repositório, é uma senha pública.
        const source = readFileSync(path.join(__dirname, '..', 'jobs', 'seed-admin.ts'), 'utf8');
        expect(source).not.toContain('columbia2026');
        expect(source).toMatch(/ADMIN_PASSWORD is required/);
        // Sem fallback `??` na leitura da senha — só no username, que não é segredo.
        expect(source).not.toMatch(/ADMIN_PASSWORD\s*\?\?/);
        // E o doc-comment não pode mais anunciar defaults que não existem.
        expect(source).toMatch(/\*\*sem default\*\*|sem default/);
    });
});
