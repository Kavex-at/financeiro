import 'reflect-metadata';
import bcrypt from 'bcryptjs';
import type SecretCipher from '../../libs/crypto/SecretCipher.js';
import type UserRepository from '../../repository/auth/UserRepository.js';
import EmailAlreadyInUseError from '../../errors/EmailAlreadyInUseError.js';
import LastActiveAdminError from '../../errors/LastActiveAdminError.js';
import SelfDeactivationError from '../../errors/SelfDeactivationError.js';
import { DEACTIVATE_RESULT, SET_EMAIL_RESULT } from '../../repository/auth/UserRepository.js';
import type LogService from '../LogService.js';
import UserAdminService, { createUserSchema, setEmailSchema } from './UserAdminService.js';

const buildRepo = () =>
    ({
        listAll: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockImplementation(async (i) => ({
            id: 9,
            username: i.email,
            email: i.email,
            role: i.role,
            ativo: true,
            createdAt: '2026-07-10T00:00:00.000Z',
        })),
        setAtivo: jest.fn().mockResolvedValue(true),
        updatePassword: jest.fn().mockResolvedValue(true),
        setVinculoConexos: jest.fn().mockResolvedValue(true),
        setEmail: jest.fn().mockResolvedValue(SET_EMAIL_RESULT.UPDATED),
        deactivateGuarded: jest.fn().mockResolvedValue(DEACTIVATE_RESULT.DEACTIVATED),
    }) as unknown as jest.Mocked<UserRepository>;

const buildCipher = () =>
    ({
        encrypt: jest.fn().mockImplementation(async (p: string) => `enc(${p})`),
        isEnabled: jest.fn().mockResolvedValue(true),
    }) as unknown as jest.Mocked<SecretCipher>;

const buildLog = () =>
    ({
        info: jest.fn().mockResolvedValue(undefined),
        error: jest.fn().mockResolvedValue(undefined),
        warn: jest.fn().mockResolvedValue(undefined),
    }) as unknown as jest.Mocked<LogService>;

describe('createUserSchema', () => {
    it('aceita email: normaliza (trim/lowercase) e default role=operador', () => {
        const out = createUserSchema.parse({
            email: '  NOVO@ColumbiaBR.com ',
            password: 'segredo12',
        });
        expect(out).toMatchObject({ email: 'novo@columbiabr.com', role: 'operador' });
    });
    it('aceita username como alias (compatibilidade com o front antigo durante o deploy)', () => {
        const out = createUserSchema.parse({ username: ' Novo@Kavex.com', password: 'segredo12' });
        expect(out).toMatchObject({ email: 'novo@kavex.com' });
    });
    it('email e username com valores diferentes: rejeita', () => {
        const out = createUserSchema.safeParse({
            email: 'a@columbiabr.com',
            username: 'b@columbiabr.com',
            password: 'segredo12',
        });
        expect(out.success).toBe(false);
    });
    it('email e username iguais depois de normalizar: aceita', () => {
        const out = createUserSchema.safeParse({
            email: 'A@columbiabr.com',
            username: 'a@columbiabr.com ',
            password: 'segredo12',
        });
        expect(out.success).toBe(true);
    });
    it('rejeita sem e-mail, e-mail inválido, senha curta e role desconhecida', () => {
        expect(createUserSchema.safeParse({ password: 'segredo12' }).success).toBe(false);
        expect(createUserSchema.safeParse({ email: 'x', password: 'segredo12' }).success).toBe(
            false,
        );
        expect(createUserSchema.safeParse({ email: 'a@b.com', password: 'curta' }).success).toBe(
            false,
        );
        expect(
            createUserSchema.safeParse({ email: 'a@b.com', password: 'segredo12', role: 'root' })
                .success,
        ).toBe(false);
    });
});

describe('setEmailSchema', () => {
    it('normaliza (trim/lowercase) e descarta campos extras como username (I1)', () => {
        const out = setEmailSchema.parse({ email: ' Maria@X.com ', username: 'outro' });
        expect(out).toEqual({ email: 'maria@x.com' });
    });
    it('rejeita e-mail inválido com mensagem em português', () => {
        const out = setEmailSchema.safeParse({ email: 'nao-e-email' });
        expect(out.success).toBe(false);
        expect(out.error?.issues[0]?.message).toBe('E-mail inválido.');
    });
});

describe('UserAdminService', () => {
    it('create: gera hash bcrypt (nunca senha em claro), grava o e-mail e propaga createdBy', async () => {
        const repo = buildRepo();
        const service = new UserAdminService(repo, buildCipher(), buildLog());
        await service.create(
            { email: 'novo@kavex.com', password: 'segredo12', role: 'operador' },
            'simone@kavex.com',
        );
        const arg = (repo.create as jest.Mock).mock.calls[0][0];
        expect(arg.email).toBe('novo@kavex.com');
        expect(arg.passwordHash).not.toBe('segredo12');
        expect(await bcrypt.compare('segredo12', arg.passwordHash)).toBe(true);
        expect(arg.createdBy).toBe('simone@kavex.com');
    });

    it('create com vínculo: cifra a senha Conexos e grava o vínculo', async () => {
        const repo = buildRepo();
        const cipher = buildCipher();
        const service = new UserAdminService(repo, cipher, buildLog());
        const out = await service.create(
            {
                email: 'marilyn@kavex.com',
                password: 'segredo12',
                role: 'operador',
                conexosUsername: 'MARILYN_MUTAFCI',
                conexosPassword: 'senha-erp',
            },
            'simone@kavex.com',
        );
        expect(cipher.encrypt).toHaveBeenCalledWith('senha-erp');
        expect(repo.setVinculoConexos).toHaveBeenCalledWith(9, {
            conexosUsername: 'MARILYN_MUTAFCI',
            conexosPasswordEnc: 'enc(senha-erp)',
        });
        expect(out.conexosUsername).toBe('MARILYN_MUTAFCI');
    });

    it('setVinculo(null): limpa sem cifrar; NOT_FOUND se id não existe', async () => {
        const repo = buildRepo();
        const cipher = buildCipher();
        const service = new UserAdminService(repo, cipher, buildLog());
        await service.setVinculo(6, null);
        expect(repo.setVinculoConexos).toHaveBeenCalledWith(6, null);
        expect(cipher.encrypt).not.toHaveBeenCalled();
        (repo.setVinculoConexos as jest.Mock).mockResolvedValue(false);
        await expect(service.setVinculo(999, null)).rejects.toThrow(/NOT_FOUND/);
    });

    it('setAtivo/resetPassword: lançam NOT_FOUND quando o id não existe', async () => {
        const repo = buildRepo();
        (repo.setAtivo as jest.Mock).mockResolvedValue(false);
        (repo.deactivateGuarded as jest.Mock).mockResolvedValue(DEACTIVATE_RESULT.NOT_FOUND);
        (repo.updatePassword as jest.Mock).mockResolvedValue(false);
        const service = new UserAdminService(repo, buildCipher(), buildLog());
        await expect(service.setAtivo(999, false, 'a@kavex.com')).rejects.toThrow(/NOT_FOUND/);
        await expect(service.setAtivo(999, true, 'a@kavex.com')).rejects.toThrow(/NOT_FOUND/);
        await expect(service.resetPassword(999, 'segredo12')).rejects.toThrow(/NOT_FOUND/);
    });

    it('setAtivo(false) passa pela guarda com o ator; setAtivo(true) não passa', async () => {
        const repo = buildRepo();
        const service = new UserAdminService(repo, buildCipher(), buildLog());
        await service.setAtivo(6, false, 'a@kavex.com');
        expect(repo.deactivateGuarded).toHaveBeenCalledWith(6, 'a@kavex.com');
        expect(repo.setAtivo).not.toHaveBeenCalled();
        await service.setAtivo(6, true, 'a@kavex.com');
        expect(repo.setAtivo).toHaveBeenCalledWith(6, true);
        expect(repo.deactivateGuarded).toHaveBeenCalledTimes(1);
    });

    it('setAtivo(false): propaga as recusas da guarda', async () => {
        const repo = buildRepo();
        const service = new UserAdminService(repo, buildCipher(), buildLog());
        (repo.deactivateGuarded as jest.Mock).mockRejectedValueOnce(new SelfDeactivationError());
        await expect(service.setAtivo(1, false, 'a@kavex.com')).rejects.toBeInstanceOf(
            SelfDeactivationError,
        );
        (repo.deactivateGuarded as jest.Mock).mockRejectedValueOnce(new LastActiveAdminError());
        await expect(service.setAtivo(1, false, 'b@kavex.com')).rejects.toBeInstanceOf(
            LastActiveAdminError,
        );
    });

    describe('setEmail', () => {
        it('grava com o ator e loga em português com o id e o ator', async () => {
            const repo = buildRepo();
            const log = buildLog();
            const service = new UserAdminService(repo, buildCipher(), log);
            await service.setEmail(7, 'maria@columbiabr.com', 'simone@kavex.com');
            expect(repo.setEmail).toHaveBeenCalledWith(
                7,
                'maria@columbiabr.com',
                'simone@kavex.com',
            );
            expect(log.info).toHaveBeenCalledTimes(1);
            const params = (log.info as jest.Mock).mock.calls[0][0];
            expect(params.message).toMatch(/e-mail/);
            expect(params.data).toMatchObject({ id: 7, ator: 'simone@kavex.com' });
        });

        it('no-op (mesmo e-mail): não loga edição', async () => {
            const repo = buildRepo();
            (repo.setEmail as jest.Mock).mockResolvedValue(SET_EMAIL_RESULT.UNCHANGED);
            const log = buildLog();
            await new UserAdminService(repo, buildCipher(), log).setEmail(7, 'a@x.com', 'b');
            expect(log.info).not.toHaveBeenCalled();
        });

        it('id inexistente: NOT_FOUND; colisão: EmailAlreadyInUseError', async () => {
            const repo = buildRepo();
            const service = new UserAdminService(repo, buildCipher(), buildLog());
            (repo.setEmail as jest.Mock).mockResolvedValueOnce(SET_EMAIL_RESULT.NOT_FOUND);
            await expect(service.setEmail(999, 'a@x.com', 'b')).rejects.toThrow(/NOT_FOUND/);
            (repo.setEmail as jest.Mock).mockRejectedValueOnce(
                new EmailAlreadyInUseError('a@x.com'),
            );
            await expect(service.setEmail(7, 'a@x.com', 'b')).rejects.toBeInstanceOf(
                EmailAlreadyInUseError,
            );
        });
    });
});
