import 'reflect-metadata';
import bcrypt from 'bcryptjs';
import { decodeJwt } from 'jose';
import type EnvironmentProvider from '../../libs/environment/EnvironmentProvider.js';
import type { AppUser } from '../../repository/auth/UserRepository.js';
import type UserRepository from '../../repository/auth/UserRepository.js';
import type LogService from '../LogService.js';
import AuthService from './AuthService.js';

const SEGREDO = 'segredo-de-teste-hs256-com-tamanho-suficiente';
const SENHA = 'segredo12';

let hash: string;

beforeAll(async () => {
    // Custo baixo só no teste: o que se testa é o fluxo, não o bcrypt.
    hash = await bcrypt.hash(SENHA, 4);
});

const usuario = (over: Partial<AppUser> = {}): AppUser => ({
    id: 1,
    username: 'admin',
    passwordHash: hash,
    role: 'admin',
    ativo: true,
    email: 'ti@columbiabr.com',
    ...over,
});

const build = (linhas: AppUser[]) => {
    const repo = {
        findByLoginIdentifier: jest.fn().mockResolvedValue(linhas),
        findByUsername: jest.fn(),
    } as unknown as jest.Mocked<UserRepository>;
    const env = {
        getEnvironmentVars: jest.fn().mockResolvedValue({ authJwtSecret: SEGREDO }),
    } as unknown as jest.Mocked<EnvironmentProvider>;
    const log = {
        error: jest.fn().mockResolvedValue(undefined),
        info: jest.fn().mockResolvedValue(undefined),
        warn: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<LogService>;
    return { repo, env, log, service: new AuthService(repo, env, log) };
};

describe('AuthService.login', () => {
    afterEach(() => jest.restoreAllMocks());

    it('busca pelo identificador (e-mail ou usuário), não pelo username exato', async () => {
        const { repo, service } = build([usuario()]);
        await service.login({ username: 'ti@columbiabr.com', password: SENHA });
        expect(repo.findByLoginIdentifier).toHaveBeenCalledWith('ti@columbiabr.com');
        expect(repo.findByUsername).not.toHaveBeenCalled();
    });

    it('uma linha, ativa, senha certa: emite o token', async () => {
        const { service } = build([usuario()]);
        const out = await service.login({ username: 'admin', password: SENHA });
        expect(out?.token).toEqual(expect.any(String));
    });

    it('zero linhas: null (a rota responde o mesmo 401)', async () => {
        const { service } = build([]);
        expect(await service.login({ username: 'ninguem', password: SENHA })).toBeNull();
    });

    it('usuário inativo: null', async () => {
        const { service } = build([usuario({ ativo: false })]);
        expect(await service.login({ username: 'admin', password: SENHA })).toBeNull();
    });

    it('senha errada: null', async () => {
        const { service } = build([usuario()]);
        expect(await service.login({ username: 'admin', password: 'errada123' })).toBeNull();
    });

    it('mais de uma linha: null, sem bcrypt.compare, e loga erro com os ids (nunca a senha)', async () => {
        const compare = jest.spyOn(bcrypt, 'compare');
        const { service, log } = build([
            usuario({ id: 1, username: 'admin', email: 'ti@columbiabr.com' }),
            usuario({ id: 2, username: 'ti@columbiabr.com', email: undefined }),
        ]);

        const out = await service.login({ username: 'ti@columbiabr.com', password: SENHA });

        expect(out).toBeNull();
        expect(compare).not.toHaveBeenCalled();
        expect(log.error).toHaveBeenCalledTimes(1);
        const params = (log.error as jest.Mock).mock.calls[0][0];
        expect(params.message).toMatch(/identificador/i);
        expect(params.message).toMatch(/usuários/i);
        expect(params.data).toMatchObject({ ids: [1, 2] });
        expect(JSON.stringify(params)).not.toContain(SENHA);
    });

    it('I1: logar pelo e-mail de quem tem username "admin" dá sub === "admin", sem claim email', async () => {
        const { service } = build([usuario()]);
        const out = await service.login({ username: 'ti@columbiabr.com', password: SENHA });
        if (!out) throw new Error('login deveria ter passado');

        const payload = decodeJwt(out.token);
        expect(payload.sub).toBe('admin');
        expect(Object.keys(payload).sort()).toEqual(['aud', 'exp', 'iat', 'role', 'sub']);
        expect(payload).not.toHaveProperty('email');
    });

    it('a resposta traz o username canônico (e o e-mail, fora do token)', async () => {
        const { service } = build([usuario()]);
        const out = await service.login({ username: 'ti@columbiabr.com', password: SENHA });
        expect(out).toMatchObject({ username: 'admin', role: 'admin', email: 'ti@columbiabr.com' });
    });

    it('sem e-mail cadastrado, a resposta omite a chave email', async () => {
        const { service } = build([usuario({ email: undefined })]);
        const out = await service.login({ username: 'admin', password: SENHA });
        expect(out).not.toHaveProperty('email');
    });
});
