import 'reflect-metadata';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import express, { type NextFunction, type Request, type Response } from 'express';
import { MemoryStore } from 'express-rate-limit';
import { container } from 'tsyringe';
import ConexosSessionResolver from '../domain/client/ConexosSessionResolver.js';
import CurrentPasswordInvalidError from '../domain/errors/CurrentPasswordInvalidError.js';
import PasswordPolicyError from '../domain/errors/PasswordPolicyError.js';
import SupabaseAuthUnavailableError from '../domain/errors/SupabaseAuthUnavailableError.js';
import { PERMISSION_CATALOG, type Permission } from '../domain/interface/auth/Permission.js';
import OwnPasswordService from '../domain/service/auth/OwnPasswordService.js';

jest.mock('../domain/appContainer.js', () => ({
    bootstrapAppContainer: jest.fn().mockResolvedValue(undefined),
}));

let acessoAtual: Request['acesso'];
let srv: { server: Server; url: string };
const testarVinculo = jest.fn();
const alterarSenha = jest.fn();

beforeAll(async () => {
    const real = container.resolve.bind(container);
    jest.spyOn(container, 'resolve').mockImplementation(((token: unknown) => {
        if (token === ConexosSessionResolver) return { testarVinculo };
        if (token === OwnPasswordService) return { alterar: alterarSenha };
        return real(token as never);
    }) as never);

    const { default: meRouter } = await import('./me.js');
    const app = express();
    app.use((req: Request, _res: Response, next: NextFunction) => {
        req.user = { sub: 'maria@columbiabr.com' };
        if (acessoAtual) req.acesso = acessoAtual;
        next();
    });
    app.use('/me', meRouter);
    app.use((_err: unknown, _req: Request, res: Response, _next: NextFunction) => {
        res.status(500).json({ error: 'erro interno' });
    });
    srv = await new Promise((resolve) => {
        const server: Server = app.listen(0, '127.0.0.1', () => {
            const { port } = server.address() as AddressInfo;
            resolve({ server, url: `http://127.0.0.1:${port}` });
        });
    });
});

afterAll(async () => {
    jest.restoreAllMocks();
    await new Promise((r) => srv.server.close(r));
});

const acesso = (permissoes: Permission[], papel = { id: 1, nome: 'Administrador' }) => ({
    userId: 7,
    papel,
    permissoes: new Set<Permission>(permissoes),
});

describe('GET /me/permissoes', () => {
    it('Administrador: as nove, ordenadas, papel e operacao = true', async () => {
        acessoAtual = acesso([...PERMISSION_CATALOG].reverse());
        const res = await fetch(`${srv.url}/me/permissoes`);
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({
            permissoes: [...PERMISSION_CATALOG].sort(),
            papel: { id: 1, nome: 'Administrador' },
            operacao: true,
        });
    });

    it('só permutas:ver: exatamente isso, e operacao = false (deriva de operacao:ver, R10)', async () => {
        acessoAtual = acesso(['permutas:ver'], { id: 2, nome: 'Consulta' });
        const res = await fetch(`${srv.url}/me/permissoes`);
        expect(await res.json()).toEqual({
            permissoes: ['permutas:ver'],
            papel: { id: 2, nome: 'Consulta' },
            operacao: false,
        });
    });

    it('responde com Cache-Control: no-store (permissão muda sem o token mudar)', async () => {
        acessoAtual = acesso(['permutas:ver']);
        const res = await fetch(`${srv.url}/me/permissoes`);
        expect(res.headers.get('cache-control')).toBe('no-store');
    });

    it('sem req.acesso (fora da cadeia de acesso): 500, nunca uma lista vazia inventada', async () => {
        acessoAtual = undefined;
        const res = await fetch(`${srv.url}/me/permissoes`);
        expect(res.status).toBe(500);
    });
});

/** JWT só com o cabeçalho que importa: o `auth` (fora deste teste) já verificou a assinatura. */
const tokenCom = (alg: string): string =>
    `${Buffer.from(JSON.stringify({ alg, typ: 'JWT' })).toString('base64url')}.e30.assinatura`;
const TOKEN_ES256 = tokenCom('ES256');
const TOKEN_HS256 = tokenCom('HS256');

/** Um app novo por teste: o limitador por usuário tem `store` próprio e está LIGADO. */
const subirSenha = async (comAcesso = true) => {
    const { buildMeRouter } = await import('./me.js');
    const app = express();
    app.use(express.json());
    app.use((req: Request, _res: Response, next: NextFunction) => {
        req.user = { sub: 'maria@columbiabr.com' };
        if (comAcesso) req.acesso = acesso([]);
        next();
    });
    app.use('/me', buildMeRouter({ limiters: { skip: () => false, store: new MemoryStore() } }));
    app.use((_err: unknown, _req: Request, res: Response, _next: NextFunction) => {
        res.status(500).json({ error: 'erro interno' });
    });
    const server: Server = await new Promise((r) => {
        const s: Server = app.listen(0, '127.0.0.1', () => r(s));
    });
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const post = (body: unknown, token = TOKEN_ES256) =>
        fetch(`${url}/me/senha`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
            body: JSON.stringify(body),
        });
    return { server, url, post };
};

const CORPO = { senhaAtual: 'Senha-atual-1', novaSenha: 'Senha-nova-22' };

describe('GET /me/senha/politica', () => {
    it('200 { minimo: 8, maximo: 72, regras: [] }', async () => {
        const { server, url } = await subirSenha();
        const res = await fetch(`${url}/me/senha/politica`);
        const corpo = await res.json();
        server.close();
        expect(res.status).toBe(200);
        expect(corpo).toEqual({ minimo: 8, maximo: 72, regras: [] });
    });

    it('guard somenteAutenticado(): sem req.acesso → 500 (montagem fora de ordem), nunca a política', async () => {
        const { server, url } = await subirSenha(false);
        const res = await fetch(`${url}/me/senha/politica`);
        server.close();
        expect(res.status).toBe(500);
    });
});

describe('POST /me/senha', () => {
    beforeEach(() => {
        alterarSenha.mockReset();
        alterarSenha.mockResolvedValue(undefined);
    });

    it('sucesso → 204 sem corpo; identidade = req.user.sub, token e alg do Bearer repassados', async () => {
        const { server, post } = await subirSenha();
        const res = await post(CORPO);
        const texto = await res.text();
        server.close();
        expect(res.status).toBe(204);
        expect(texto).toBe('');
        expect(alterarSenha).toHaveBeenCalledWith({
            username: 'maria@columbiabr.com',
            senhaAtual: 'Senha-atual-1',
            novaSenha: 'Senha-nova-22',
            tokenDoChamador: TOKEN_ES256,
            algDoToken: 'ES256',
        });
    });

    it('Bearer HS256 → algDoToken HS256 (o service decide a revogação pelo alg)', async () => {
        const { server, post } = await subirSenha();
        await post(CORPO, TOKEN_HS256);
        server.close();
        expect(alterarSenha).toHaveBeenCalledWith(
            expect.objectContaining({ algDoToken: 'HS256', tokenDoChamador: TOKEN_HS256 }),
        );
    });

    it('caso 2/3: PasswordPolicyError → 400 { codigo: POLITICA, regras, error }', async () => {
        alterarSenha.mockRejectedValue(new PasswordPolicyError(['diferente_da_atual']));
        const { server, post } = await subirSenha();
        const res = await post(CORPO);
        const corpo = await res.json();
        server.close();
        expect(res.status).toBe(400);
        expect(corpo).toEqual({
            codigo: 'POLITICA',
            regras: ['diferente_da_atual'],
            error: expect.any(String),
        });
    });

    it('caso 4: CurrentPasswordInvalidError → 422 SENHA_ATUAL_INVALIDA, nunca 401', async () => {
        alterarSenha.mockRejectedValue(new CurrentPasswordInvalidError());
        const { server, post } = await subirSenha();
        const res = await post(CORPO);
        const corpo = await res.json();
        server.close();
        expect(res.status).toBe(422);
        expect(res.status).not.toBe(401);
        expect(corpo).toEqual({ codigo: 'SENHA_ATUAL_INVALIDA', error: expect.any(String) });
    });

    it('caso 4: 5 × 422 → a 6ª (senha certa) responde 429 MUITAS_TENTATIVAS sem chegar ao service', async () => {
        alterarSenha.mockRejectedValue(new CurrentPasswordInvalidError());
        const { server, post } = await subirSenha();
        for (let i = 0; i < 5; i++) expect((await post(CORPO)).status).toBe(422);
        alterarSenha.mockResolvedValue(undefined);
        const sexta = await post(CORPO);
        const corpo = await sexta.json();
        server.close();
        expect(sexta.status).toBe(429);
        expect(corpo).toEqual({ codigo: 'MUITAS_TENTATIVAS', error: expect.any(String) });
        expect(alterarSenha).toHaveBeenCalledTimes(5);
    });

    it('caso 4: um 204 e um 400 POLITICA não contam como falha', async () => {
        const { server, post } = await subirSenha();
        alterarSenha.mockRejectedValue(new CurrentPasswordInvalidError());
        for (let i = 0; i < 4; i++) await post(CORPO);
        alterarSenha.mockResolvedValueOnce(undefined);
        expect((await post(CORPO)).status).toBe(204);
        alterarSenha.mockRejectedValueOnce(new PasswordPolicyError(['tamanho']));
        expect((await post(CORPO)).status).toBe(400);
        expect((await post(CORPO)).status).toBe(422); // 5ª falha: ainda chega ao service
        const sexta = await post(CORPO);
        server.close();
        expect(sexta.status).toBe(429);
    });

    it('caso 5: GoTrue fora → 503 AUTH_INDISPONIVEL "nada foi alterado"', async () => {
        alterarSenha.mockRejectedValue(new SupabaseAuthUnavailableError('x', 'timeout'));
        const { server, post } = await subirSenha();
        const res = await post(CORPO);
        const corpo = await res.json();
        server.close();
        expect(res.status).toBe(503);
        expect(corpo).toEqual({
            codigo: 'AUTH_INDISPONIVEL',
            error: 'Serviço de autenticação indisponível; nada foi alterado.',
        });
    });

    it('caso 5: GoTrue 429 (rateLimited) → 429 MUITAS_TENTATIVAS, não 503', async () => {
        alterarSenha.mockRejectedValue(new SupabaseAuthUnavailableError('x', 'rate_limited', 429));
        const { server, post } = await subirSenha();
        const res = await post(CORPO);
        const corpo = await res.json();
        server.close();
        expect(res.status).toBe(429);
        expect(corpo).toEqual({ codigo: 'MUITAS_TENTATIVAS', error: expect.any(String) });
    });

    it('caso 7: campo extra ou faltando → 400 sem codigo, service não chamado, limitador intocado', async () => {
        const { server, post } = await subirSenha();
        const malformados = [
            { ...CORPO, extra: 1 },
            { senhaAtual: 'x' },
            { novaSenha: 'y' },
            { senhaAtual: '', novaSenha: 'Senha-nova-22' },
            { senhaAtual: 1, novaSenha: 2 },
        ];
        for (const corpo of [...malformados, ...malformados]) {
            const res = await post(corpo);
            const json = await res.json();
            expect(res.status).toBe(400);
            expect(json).not.toHaveProperty('codigo');
        }
        expect(alterarSenha).not.toHaveBeenCalled();
        // 10 corpos malformados depois, o balde do usuário ainda está cheio: 5 × 422 passam.
        alterarSenha.mockRejectedValue(new CurrentPasswordInvalidError());
        for (let i = 0; i < 5; i++) expect((await post(CORPO)).status).toBe(422);
        server.close();
    });

    it('nenhum caminho responde 401 por senha errada', async () => {
        const erros = [
            new CurrentPasswordInvalidError(),
            new PasswordPolicyError(['tamanho']),
            new SupabaseAuthUnavailableError('x', 'timeout'),
            new SupabaseAuthUnavailableError('x', 'rate_limited', 429),
        ];
        for (const erro of erros) {
            alterarSenha.mockRejectedValueOnce(erro);
            const { server, post } = await subirSenha();
            const res = await post(CORPO);
            server.close();
            expect(res.status).not.toBe(401);
        }
    });

    it('guard somenteAutenticado(): sem req.acesso → 500, service não chamado', async () => {
        const { server, post } = await subirSenha(false);
        const res = await post(CORPO);
        server.close();
        expect(res.status).toBe(500);
        expect(alterarSenha).not.toHaveBeenCalled();
    });
});

describe('GET /me/conexos-status', () => {
    it('basta estar autenticado e ativo: responde o status do vínculo', async () => {
        acessoAtual = acesso([]);
        testarVinculo.mockResolvedValue('ausente');
        const res = await fetch(`${srv.url}/me/conexos-status`);
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ status: 'ausente' });
    });
});
