import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import express, { type Request, type Response } from 'express';
import { MemoryStore } from 'express-rate-limit';
import {
    LOGIN_FAILURES_PER_IDENTIFIER,
    LOGIN_FAILURE_WINDOW_MS,
    LOGIN_IP_LIMIT_PER_MINUTE,
    MENSAGEM_MUITAS_TENTATIVAS,
    OWN_PASSWORD_FAILURES,
    OWN_PASSWORD_WINDOW_MS,
    REFRESH_IP_LIMIT_PER_MINUTE,
    buildLoginLimiters,
    buildOwnPasswordLimiter,
    buildRefreshLimiter,
    identificadorDoLogin,
} from './rateLimit.js';

/**
 * Os limitadores de sessão (D4) com `skip: () => false`: o `skipInTest` global continua valendo para
 * o resto da suíte, mas aqui o limite é exercitado de verdade. `trust proxy = 1` como em produção
 * (Render), para que o `X-Forwarded-For` seja o IP do cliente.
 */
const subir = async () => {
    const login = buildLoginLimiters({ skip: () => false });
    const refresh = buildRefreshLimiter({ skip: () => false });
    const app = express();
    app.set('trust proxy', 1);
    app.use(express.json());
    const senhaCerta = 'certa';
    app.post(
        '/auth/login',
        login.porIp,
        (req: Request, res: Response, next) => {
            // Corpo inválido responde ANTES do limitador por identificador (não consome o balde).
            if (typeof req.body?.username !== 'string' || req.body.username.trim() === '') {
                res.status(400).json({ error: 'Requisição inválida' });
                return;
            }
            next();
        },
        login.porIdentificador,
        (req: Request, res: Response) => {
            if (req.body.password === senhaCerta) res.json({ token: 't' });
            else res.status(401).json({ error: 'Credenciais inválidas' });
        },
    );
    app.post('/auth/refresh', refresh, (_req: Request, res: Response) => {
        res.json({ ok: true });
    });
    const server: Server = await new Promise((r) => {
        const s = app.listen(0, '127.0.0.1', () => r(s));
    });
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const post = (caminho: string, body: unknown, ip: string) =>
        fetch(`${base}${caminho}`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
            body: JSON.stringify(body),
        });
    return { server, post };
};

describe('limitadores de sessão (D4)', () => {
    it('os limites são as constantes do D4', () => {
        expect(LOGIN_IP_LIMIT_PER_MINUTE).toBe(20);
        expect(LOGIN_FAILURES_PER_IDENTIFIER).toBe(10);
        expect(LOGIN_FAILURE_WINDOW_MS).toBe(15 * 60_000);
        expect(REFRESH_IP_LIMIT_PER_MINUTE).toBe(30);
    });

    it('/auth/login: a 21ª requisição do mesmo IP no minuto recebe 429 com cabeçalhos RateLimit', async () => {
        const { server, post } = await subir();
        const statuses: number[] = [];
        for (let i = 0; i < 21; i++) {
            // identificadores diferentes: só o limite por IP age
            const res = await post(
                '/auth/login',
                { username: `u${i}`, password: 'certa' },
                '10.0.0.1',
            );
            statuses.push(res.status);
            if (i === 20) {
                expect(await res.json()).toEqual({ error: MENSAGEM_MUITAS_TENTATIVAS });
                expect(res.headers.get('ratelimit-policy')).toBeTruthy();
            }
        }
        server.close();
        expect(statuses.slice(0, 20).every((s) => s === 200)).toBe(true);
        expect(statuses[20]).toBe(429);
    });

    it('/auth/login: a 11ª FALHA do mesmo identificador, vinda de IPs diferentes, recebe 429', async () => {
        const { server, post } = await subir();
        const statuses: number[] = [];
        for (let i = 0; i < 11; i++) {
            const res = await post(
                '/auth/login',
                { username: ' Beto@QA.local ', password: 'errada' },
                `10.0.1.${i}`,
            );
            statuses.push(res.status);
        }
        // Outro identificador, de um IP novo, passa.
        const outro = await post('/auth/login', { username: 'ana', password: 'certa' }, '10.0.2.1');
        server.close();
        expect(statuses.slice(0, 10).every((s) => s === 401)).toBe(true);
        expect(statuses[10]).toBe(429);
        expect(outro.status).toBe(200);
    });

    it('login certo depois de 9 falhas não conta como falha', async () => {
        const { server, post } = await subir();
        for (let i = 0; i < 9; i++) {
            await post('/auth/login', { username: 'beto', password: 'errada' }, `10.0.3.${i}`);
        }
        const certo = await post(
            '/auth/login',
            { username: 'beto', password: 'certa' },
            '10.0.4.1',
        );
        const decima = await post(
            '/auth/login',
            { username: 'beto', password: 'errada' },
            '10.0.4.2',
        );
        const decimaPrimeira = await post(
            '/auth/login',
            { username: 'beto', password: 'errada' },
            '10.0.4.3',
        );
        server.close();
        expect(certo.status).toBe(200);
        expect(decima.status).toBe(401);
        expect(decimaPrimeira.status).toBe(429);
    });

    it('corpo inválido não consome o balde do identificador', async () => {
        const { server, post } = await subir();
        for (let i = 0; i < 15; i++) {
            await post('/auth/login', { username: '' }, `10.0.5.${i}`);
        }
        const res = await post('/auth/login', { username: 'caio', password: 'errada' }, '10.0.6.1');
        server.close();
        expect(res.status).toBe(401);
    });

    it('/auth/refresh: a 31ª requisição do mesmo IP no minuto recebe 429', async () => {
        const { server, post } = await subir();
        const statuses: number[] = [];
        for (let i = 0; i < 31; i++) {
            statuses.push((await post('/auth/refresh', { refreshToken: 'x' }, '10.0.7.1')).status);
        }
        server.close();
        expect(statuses.slice(0, 30).every((s) => s === 200)).toBe(true);
        expect(statuses[30]).toBe(429);
    });

    it('o identificador é normalizado (trim + minúsculas)', () => {
        expect(identificadorDoLogin({ body: { username: '  Beto@QA.Local ' } } as Request)).toBe(
            'beto@qa.local',
        );
    });
});

/**
 * Limitador da troca da própria senha (ADR-0059): 5 FALHAS (422) em 15 min por usuário
 * autenticado (`req.user.sub`), venham de que IP vierem. Só o 422 conta.
 */
describe('limitador de troca de senha (ADR-0059)', () => {
    const subirSenha = async () => {
        const limiter = buildOwnPasswordLimiter({ skip: () => false, store: new MemoryStore() });
        const app = express();
        app.use(express.json());
        app.use((req: Request, _res: Response, next) => {
            req.user = { sub: String(req.headers['x-usuario'] ?? 'beto') };
            next();
        });
        app.post('/me/senha', limiter, (req: Request, res: Response) => {
            res.status(Number(req.body.status)).end();
        });
        const server: Server = await new Promise((r) => {
            const s = app.listen(0, '127.0.0.1', () => r(s));
        });
        const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
        const post = (status: number, usuario = 'beto') =>
            fetch(`${base}/me/senha`, {
                method: 'POST',
                headers: { 'content-type': 'application/json', 'x-usuario': usuario },
                body: JSON.stringify({ status }),
            });
        return { server, post };
    };

    it('os limites são 5 falhas em 15 minutos', () => {
        expect(OWN_PASSWORD_FAILURES).toBe(5);
        expect(OWN_PASSWORD_WINDOW_MS).toBe(15 * 60_000);
    });

    it('5 × 422 → a 6ª responde 429 { codigo: MUITAS_TENTATIVAS } sem chegar ao handler', async () => {
        const { server, post } = await subirSenha();
        for (let i = 0; i < 5; i++) expect((await post(422)).status).toBe(422);
        const sexta = await post(204);
        const corpo = await sexta.json();
        server.close();
        expect(sexta.status).toBe(429);
        expect(corpo).toEqual({ codigo: 'MUITAS_TENTATIVAS', error: MENSAGEM_MUITAS_TENTATIVAS });
    });

    it('204, 400 POLITICA e 503 não contam; o balde é por usuário', async () => {
        const { server, post } = await subirSenha();
        for (let i = 0; i < 4; i++) await post(422);
        for (const s of [204, 400, 503, 400, 204]) expect((await post(s)).status).toBe(s);
        expect((await post(422)).status).toBe(422); // 5ª falha: ainda passa
        expect((await post(422, 'outra')).status).toBe(422); // outro usuário, outro balde
        const bloqueado = await post(204);
        server.close();
        expect(bloqueado.status).toBe(429);
    });
});
