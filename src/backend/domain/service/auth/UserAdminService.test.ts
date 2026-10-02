import 'reflect-metadata';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import bcrypt from 'bcryptjs';
import EmailAlreadyInUseError from '../../errors/EmailAlreadyInUseError.js';
import LastUserManagerError from '../../errors/LastUserManagerError.js';
import RoleNotFoundError from '../../errors/RoleNotFoundError.js';
import SelfDeactivationError from '../../errors/SelfDeactivationError.js';
import { PERMISSION_CATALOG } from '../../interface/auth/Permission.js';
import type SecretCipher from '../../libs/crypto/SecretCipher.js';
import type AccessRepository from '../../repository/auth/AccessRepository.js';
import {
    REPLACE_EXCEPTIONS_RESULT,
    SET_ROLE_RESULT,
    type UserAccess,
} from '../../repository/auth/AccessRepository.js';
import type UserRepository from '../../repository/auth/UserRepository.js';
import type { AntesDoCommit, CredencialLinha } from '../../repository/auth/UserRepository.js';
import SupabaseAuthUnavailableError from '../../errors/SupabaseAuthUnavailableError.js';
import {
    DEACTIVATE_RESULT,
    REACTIVATE_RESULT,
    SET_EMAIL_RESULT,
} from '../../repository/auth/UserRepository.js';
import type LogService from '../LogService.js';
import type AccessService from './AccessService.js';
import CredentialMirror from './CredentialMirror.js';
import EffectivePermissionCalculator from './EffectivePermissionCalculator.js';
import UserAdminService, {
    createUserSchema,
    exceptionsBodySchema,
    setEmailSchema,
} from './UserAdminService.js';

const ADMIN = { id: 1, nome: 'Administrador', permissoes: [...PERMISSION_CATALOG] as string[] };
const CONSULTA = { id: 2, nome: 'Consulta', permissoes: ['permutas:ver'] };

const buildRepo = () =>
    ({
        listAll: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockImplementation(async (i) => ({
            id: 9,
            username: i.email,
            email: i.email,
            role: 'admin',
            ativo: true,
            createdAt: '2026-07-10T00:00:00.000Z',
            papel: { id: i.roleId, nome: i.roleId === 1 ? 'Administrador' : 'Consulta' },
        })),
        reactivate: jest.fn().mockResolvedValue(REACTIVATE_RESULT.REACTIVATED),
        updatePassword: jest.fn().mockResolvedValue(true),
        setVinculoConexos: jest.fn().mockResolvedValue(true),
        setEmail: jest.fn().mockResolvedValue(SET_EMAIL_RESULT.UPDATED),
        deactivateGuarded: jest.fn().mockResolvedValue(DEACTIVATE_RESULT.DEACTIVATED),
    }) as unknown as jest.Mocked<UserRepository>;

const acesso = (userId: number, over: Partial<UserAccess> = {}): UserAccess => ({
    userId,
    username: `u${userId}`,
    ativo: true,
    papel: { id: 1, nome: 'Administrador' },
    pacote: ADMIN.permissoes,
    excecoes: [],
    ...over,
});

const buildAccessRepo = () =>
    ({
        listRoles: jest.fn().mockResolvedValue([
            { id: 1, nome: 'Administrador', descricao: 'Tudo', permissoes: ADMIN.permissoes },
            { id: 2, nome: 'Consulta', permissoes: CONSULTA.permissoes },
        ]),
        findRoleById: jest
            .fn()
            .mockImplementation(
                async (id: number) => [ADMIN, CONSULTA].find((r) => r.id === id) ?? null,
            ),
        findRoleByName: jest.fn().mockResolvedValue(ADMIN),
        listAccessForUsers: jest.fn().mockResolvedValue(new Map()),
        findAccessByUserId: jest.fn().mockResolvedValue(acesso(6)),
        setRole: jest.fn().mockResolvedValue({
            result: SET_ROLE_RESULT.UPDATED,
            before: { id: 1, nome: 'Administrador' },
            after: { id: 2, nome: 'Consulta' },
        }),
        replaceExceptions: jest.fn().mockResolvedValue({
            result: REPLACE_EXCEPTIONS_RESULT.UPDATED,
            before: [],
            after: [{ permissao: 'sispag:executar', efeito: 'revogar' }],
        }),
    }) as unknown as jest.Mocked<AccessRepository>;

const buildAccessService = () =>
    ({ invalidar: jest.fn() }) as unknown as jest.Mocked<AccessService>;

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

/** Espelho "sem Supabase configurado" (D3): nenhum passo, escrita só local. */
const buildMirrorLocal = () =>
    ({
        preparar: jest.fn(async (op: { tipo: string }) => ({
            operacao: op.tipo,
            estado: { supabaseAlterado: false },
        })),
        aposFalha: jest.fn().mockResolvedValue(undefined),
    }) as unknown as jest.Mocked<CredentialMirror>;

const montar = (mirror: CredentialMirror = buildMirrorLocal()) => {
    const repo = buildRepo();
    const accessRepo = buildAccessRepo();
    const accessService = buildAccessService();
    const cipher = buildCipher();
    const log = buildLog();
    const service = new UserAdminService(
        repo,
        accessRepo,
        new EffectivePermissionCalculator(),
        accessService,
        cipher,
        log,
        mirror,
    );
    return { service, repo, accessRepo, accessService, cipher, log, mirror };
};

describe('createUserSchema', () => {
    it('aceita email + papelId: normaliza o e-mail (trim/lowercase), sem default de papel', () => {
        const out = createUserSchema.parse({
            email: '  NOVO@ColumbiaBR.com ',
            password: 'segredo12',
            papelId: 2,
        });
        expect(out).toMatchObject({ email: 'novo@columbiabr.com', papelId: 2 });
    });

    it('D2: sem papelId e com role "admin" (front antigo): vira o alias de Administrador', () => {
        const out = createUserSchema.parse({
            username: ' Novo@Kavex.com',
            password: 'segredo12',
            role: 'admin',
        });
        expect(out).toMatchObject({ email: 'novo@kavex.com', usarAdministrador: true });
        expect(out.papelId).toBeUndefined();
    });

    it('D2: role "operador" ou nenhum dos dois: 400 pedindo para atualizar a página', () => {
        for (const body of [
            { email: 'a@b.com', password: 'segredo12', role: 'operador' },
            { email: 'a@b.com', password: 'segredo12' },
        ]) {
            const out = createUserSchema.safeParse(body);
            expect(out.success).toBe(false);
            expect(out.error?.issues.map((i) => i.message)).toContain(
                'Atualize a página para escolher o papel do usuário.',
            );
        }
    });

    it('papelId precisa ser inteiro positivo', () => {
        for (const papelId of [0, -1, 1.5, 'x']) {
            expect(
                createUserSchema.safeParse({ email: 'a@b.com', password: 'segredo12', papelId })
                    .success,
            ).toBe(false);
        }
    });

    it('email e username com valores diferentes: rejeita; iguais depois de normalizar: aceita', () => {
        expect(
            createUserSchema.safeParse({
                email: 'a@columbiabr.com',
                username: 'b@columbiabr.com',
                password: 'segredo12',
                papelId: 1,
            }).success,
        ).toBe(false);
        expect(
            createUserSchema.safeParse({
                email: 'A@columbiabr.com',
                username: 'a@columbiabr.com ',
                password: 'segredo12',
                papelId: 1,
            }).success,
        ).toBe(true);
    });

    it('rejeita sem e-mail, e-mail inválido e senha curta', () => {
        const base = { password: 'segredo12', papelId: 1 };
        expect(createUserSchema.safeParse(base).success).toBe(false);
        expect(createUserSchema.safeParse({ ...base, email: 'x' }).success).toBe(false);
        expect(
            createUserSchema.safeParse({ ...base, email: 'a@b.com', password: 'curta' }).success,
        ).toBe(false);
    });

    it("USER_ROLES e o default 'operador' não existem mais no service", () => {
        const fonte = readFileSync(path.join(__dirname, 'UserAdminService.ts'), 'utf8');
        expect(fonte).not.toContain('USER_ROLES');
        expect(fonte).not.toContain("'operador'");
    });
});

describe('exceptionsBodySchema', () => {
    it('aceita permissões do catálogo com efeito conceder|revogar', () => {
        expect(
            exceptionsBodySchema.safeParse({
                excecoes: [{ permissao: 'sispag:executar', efeito: 'revogar' }],
            }).success,
        ).toBe(true);
    });

    it('permissão fora do catálogo: "Permissão desconhecida."', () => {
        const out = exceptionsBodySchema.safeParse({
            excecoes: [{ permissao: 'fiscal:ver', efeito: 'conceder' }],
        });
        expect(out.success).toBe(false);
        expect(out.error?.issues[0]?.message).toBe('Permissão desconhecida.');
    });

    it('permissão repetida: "Cada permissão pode aparecer uma vez só."', () => {
        const out = exceptionsBodySchema.safeParse({
            excecoes: [
                { permissao: 'sispag:ver', efeito: 'conceder' },
                { permissao: 'sispag:ver', efeito: 'revogar' },
            ],
        });
        expect(out.success).toBe(false);
        expect(out.error?.issues[0]?.message).toBe('Cada permissão pode aparecer uma vez só.');
    });

    it('efeito desconhecido: recusado', () => {
        expect(
            exceptionsBodySchema.safeParse({
                excecoes: [{ permissao: 'sispag:ver', efeito: 'talvez' }],
            }).success,
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
    describe('create', () => {
        it('gera hash bcrypt, grava role_id do papel escolhido, createdBy, invalida e loga', async () => {
            const { service, repo, accessService, log } = montar();
            const out = await service.create(
                { email: 'novo@kavex.com', password: 'segredo12', papelId: 2 },
                'simone@kavex.com',
            );
            const arg = (repo.create as jest.Mock).mock.calls[0][0];
            expect(arg.email).toBe('novo@kavex.com');
            expect(arg.roleId).toBe(2);
            expect(arg.passwordHash).not.toBe('segredo12');
            expect(await bcrypt.compare('segredo12', arg.passwordHash)).toBe(true);
            expect(arg.createdBy).toBe('simone@kavex.com');
            expect(out.papel).toEqual({ id: 2, nome: 'Consulta' });
            expect(accessService.invalidar).toHaveBeenCalledWith(9);
            expect(log.info).toHaveBeenCalledWith(
                expect.objectContaining({
                    message: expect.stringMatching(/usuário criado/),
                    data: expect.objectContaining({ ator: 'simone@kavex.com', alvo: 9 }),
                }),
            );
        });

        it('D2: alias de Administrador resolve o papel pelo nome', async () => {
            const { service, repo, accessRepo } = montar();
            await service.create(
                { email: 'a@kavex.com', password: 'segredo12', usarAdministrador: true },
                'simone@kavex.com',
            );
            expect(accessRepo.findRoleByName).toHaveBeenCalledWith('Administrador');
            expect((repo.create as jest.Mock).mock.calls[0][0].roleId).toBe(1);
        });

        it('papelId inexistente: RoleNotFoundError, sem criar', async () => {
            const { service, repo } = montar();
            await expect(
                service.create({ email: 'a@kavex.com', password: 'segredo12', papelId: 99 }, 's'),
            ).rejects.toBeInstanceOf(RoleNotFoundError);
            expect(repo.create).not.toHaveBeenCalled();
        });

        it('com vínculo: cifra a senha Conexos e grava o vínculo', async () => {
            const { service, repo, cipher } = montar();
            const out = await service.create(
                {
                    email: 'marilyn@kavex.com',
                    password: 'segredo12',
                    papelId: 1,
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
    });

    describe('list (D6)', () => {
        it('cada usuário ganha papel, exceções e permissões efetivas, com UMA consulta de acesso', async () => {
            const { service, repo, accessRepo } = montar();
            (repo.listAll as jest.Mock).mockResolvedValue([
                { id: 1, username: 'a', role: 'admin', ativo: true, createdAt: 'x' },
                { id: 2, username: 'b', role: 'admin', ativo: true, createdAt: 'x' },
            ]);
            (accessRepo.listAccessForUsers as jest.Mock).mockResolvedValue(
                new Map([
                    [1, acesso(1)],
                    [
                        2,
                        acesso(2, {
                            papel: { id: 2, nome: 'Consulta' },
                            pacote: ['sispag:executar'],
                            excecoes: [{ permissao: 'sispag:executar', efeito: 'revogar' }],
                        }),
                    ],
                ]),
            );
            const out = await service.list();
            expect(accessRepo.listAccessForUsers).toHaveBeenCalledTimes(1);
            expect(out[0]).toMatchObject({
                role: 'admin',
                papel: { id: 1, nome: 'Administrador' },
                excecoes: [],
            });
            expect(out[0].permissoesEfetivas).toHaveLength(PERMISSION_CATALOG.length);
            expect(out[1]).toMatchObject({
                papel: { id: 2, nome: 'Consulta' },
                excecoes: [{ permissao: 'sispag:executar', efeito: 'revogar' }],
                permissoesEfetivas: ['sispag:ver'],
            });
        });
    });

    it('listarPapeis: papéis com pacote e o catálogo inteiro', async () => {
        const { service } = montar();
        const out = await service.listarPapeis();
        expect(out.catalogo).toEqual([...PERMISSION_CATALOG]);
        expect(out.papeis).toEqual([
            { id: 1, nome: 'Administrador', descricao: 'Tudo', permissoes: ADMIN.permissoes },
            { id: 2, nome: 'Consulta', permissoes: CONSULTA.permissoes },
        ]);
    });

    describe('atribuirPapel', () => {
        it('grava pelo repositório com o ator, invalida o alvo DEPOIS e loga antes → depois', async () => {
            const { service, accessRepo, accessService, log } = montar();
            const out = await service.atribuirPapel(6, 2, 'simone@kavex.com');
            expect(accessRepo.setRole).toHaveBeenCalledWith(6, 2, 'simone@kavex.com');
            expect(out).toEqual({ id: 6, papel: { id: 2, nome: 'Consulta' } });
            expect(accessService.invalidar).toHaveBeenCalledWith(6);
            expect((accessRepo.setRole as jest.Mock).mock.invocationCallOrder[0]).toBeLessThan(
                (accessService.invalidar as jest.Mock).mock.invocationCallOrder[0],
            );
            expect(log.info).toHaveBeenCalledWith(
                expect.objectContaining({
                    message: expect.stringMatching(/papel/),
                    data: {
                        ator: 'simone@kavex.com',
                        alvo: 6,
                        tipo: 'papel',
                        antes: { id: 1, nome: 'Administrador' },
                        depois: { id: 2, nome: 'Consulta' },
                    },
                }),
            );
        });

        it('mesmo papel: 200 sem log de mudança', async () => {
            const { service, accessRepo, log } = montar();
            (accessRepo.setRole as jest.Mock).mockResolvedValue({
                result: SET_ROLE_RESULT.UNCHANGED,
                before: { id: 1, nome: 'Administrador' },
                after: { id: 1, nome: 'Administrador' },
            });
            expect(await service.atribuirPapel(6, 1, 's')).toEqual({
                id: 6,
                papel: { id: 1, nome: 'Administrador' },
            });
            expect(log.info).not.toHaveBeenCalled();
        });

        it('papel inexistente: RoleNotFoundError; usuário inexistente: NOT_FOUND', async () => {
            const { service, accessRepo } = montar();
            (accessRepo.setRole as jest.Mock).mockResolvedValueOnce({
                result: SET_ROLE_RESULT.ROLE_NOT_FOUND,
            });
            await expect(service.atribuirPapel(6, 99, 's')).rejects.toBeInstanceOf(
                RoleNotFoundError,
            );
            (accessRepo.setRole as jest.Mock).mockResolvedValueOnce({
                result: SET_ROLE_RESULT.USER_NOT_FOUND,
            });
            await expect(service.atribuirPapel(99, 1, 's')).rejects.toThrow(/NOT_FOUND/);
        });

        it('recusa da guarda propaga e NÃO invalida nada', async () => {
            const { service, accessRepo, accessService } = montar();
            (accessRepo.setRole as jest.Mock).mockRejectedValue(new LastUserManagerError());
            await expect(service.atribuirPapel(6, 2, 's')).rejects.toBeInstanceOf(
                LastUserManagerError,
            );
            expect(accessService.invalidar).not.toHaveBeenCalled();
        });
    });

    describe('definirExcecoes', () => {
        it('substitui o conjunto, invalida, loga e devolve exceções + efetivas', async () => {
            const { service, accessRepo, accessService, log } = montar();
            (accessRepo.findAccessByUserId as jest.Mock).mockResolvedValue(
                acesso(6, { excecoes: [{ permissao: 'sispag:executar', efeito: 'revogar' }] }),
            );
            const out = await service.definirExcecoes(
                6,
                [{ permissao: 'sispag:executar', efeito: 'revogar' }],
                'simone@kavex.com',
            );
            expect(accessRepo.replaceExceptions).toHaveBeenCalledWith(
                6,
                [{ permissao: 'sispag:executar', efeito: 'revogar' }],
                'simone@kavex.com',
            );
            expect(accessService.invalidar).toHaveBeenCalledWith(6);
            expect(out.id).toBe(6);
            expect(out.excecoes).toEqual([{ permissao: 'sispag:executar', efeito: 'revogar' }]);
            expect(out.permissoesEfetivas).not.toContain('sispag:executar');
            expect(out.permissoesEfetivas).toContain('sispag:ver');
            expect(log.info).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({ tipo: 'excecao', alvo: 6 }),
                }),
            );
        });

        it('usuário inexistente: NOT_FOUND', async () => {
            const { service, accessRepo } = montar();
            (accessRepo.replaceExceptions as jest.Mock).mockResolvedValue({
                result: REPLACE_EXCEPTIONS_RESULT.NOT_FOUND,
            });
            await expect(service.definirExcecoes(99, [], 's')).rejects.toThrow(/NOT_FOUND/);
        });
    });

    describe('setAtivo', () => {
        it('desativar passa pela guarda com o ator, invalida DEPOIS e loga', async () => {
            const { service, repo, accessService, log } = montar();
            await service.setAtivo(6, false, 'a@kavex.com');
            expect(repo.deactivateGuarded).toHaveBeenCalledWith(6, 'a@kavex.com', undefined);
            expect(repo.reactivate).not.toHaveBeenCalled();
            expect(accessService.invalidar).toHaveBeenCalledWith(6);
            expect(log.info).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({ tipo: 'ativo', antes: true, depois: false }),
                }),
            );
        });

        it('reativar não passa pela guarda, grava o evento pelo repositório e invalida', async () => {
            const { service, repo, accessService } = montar();
            await service.setAtivo(6, true, 'a@kavex.com');
            expect(repo.reactivate).toHaveBeenCalledWith(6, 'a@kavex.com', undefined);
            expect(repo.deactivateGuarded).not.toHaveBeenCalled();
            expect(accessService.invalidar).toHaveBeenCalledWith(6);
        });

        it('NOT_FOUND nas duas direções; resetPassword também', async () => {
            const { service, repo } = montar();
            (repo.deactivateGuarded as jest.Mock).mockResolvedValue(DEACTIVATE_RESULT.NOT_FOUND);
            (repo.reactivate as jest.Mock).mockResolvedValue(REACTIVATE_RESULT.NOT_FOUND);
            (repo.updatePassword as jest.Mock).mockResolvedValue(false);
            await expect(service.setAtivo(999, false, 'a')).rejects.toThrow(/NOT_FOUND/);
            await expect(service.setAtivo(999, true, 'a')).rejects.toThrow(/NOT_FOUND/);
            await expect(service.resetPassword(999, 'segredo12')).rejects.toThrow(/NOT_FOUND/);
        });

        it('propaga as recusas da guarda', async () => {
            const { service, repo, accessService } = montar();
            (repo.deactivateGuarded as jest.Mock).mockRejectedValueOnce(
                new SelfDeactivationError(),
            );
            await expect(service.setAtivo(1, false, 'a')).rejects.toBeInstanceOf(
                SelfDeactivationError,
            );
            (repo.deactivateGuarded as jest.Mock).mockRejectedValueOnce(new LastUserManagerError());
            await expect(service.setAtivo(1, false, 'b')).rejects.toBeInstanceOf(
                LastUserManagerError,
            );
            expect(accessService.invalidar).not.toHaveBeenCalled();
        });
    });

    it('setVinculo(null): limpa sem cifrar; NOT_FOUND se id não existe', async () => {
        const { service, repo, cipher } = montar();
        await service.setVinculo(6, null);
        expect(repo.setVinculoConexos).toHaveBeenCalledWith(6, null);
        expect(cipher.encrypt).not.toHaveBeenCalled();
        (repo.setVinculoConexos as jest.Mock).mockResolvedValue(false);
        await expect(service.setVinculo(999, null)).rejects.toThrow(/NOT_FOUND/);
    });

    describe('setEmail', () => {
        it('grava com o ator e loga em português com o id e o ator', async () => {
            const { service, repo, log } = montar();
            await service.setEmail(7, 'maria@columbiabr.com', 'simone@kavex.com');
            expect(repo.setEmail).toHaveBeenCalledWith(
                7,
                'maria@columbiabr.com',
                'simone@kavex.com',
                undefined,
            );
            expect(log.info).toHaveBeenCalledTimes(1);
            const params = (log.info as jest.Mock).mock.calls[0][0];
            expect(params.message).toMatch(/e-mail/);
            expect(params.data).toMatchObject({ id: 7, ator: 'simone@kavex.com' });
        });

        it('no-op (mesmo e-mail): não loga edição', async () => {
            const { service, repo, log } = montar();
            (repo.setEmail as jest.Mock).mockResolvedValue(SET_EMAIL_RESULT.UNCHANGED);
            await service.setEmail(7, 'a@x.com', 'b');
            expect(log.info).not.toHaveBeenCalled();
        });

        it('id inexistente: NOT_FOUND; colisão: EmailAlreadyInUseError', async () => {
            const { service, repo } = montar();
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

/**
 * R6 com o espelho REAL (`CredentialMirror`) e um repositório com estado que imita a transação:
 * a escrita local é aplicada, o passo roda, e uma falha no passo DESFAZ a escrita (ROLLBACK). Assim
 * o teste lê o banco de volta. A ordem BEGIN → trava → escrita → admin → COMMIT está provada no
 * `UserRepository.test.ts`.
 */
describe('UserAdminService — escritas de credencial espelhadas no Supabase Auth (R6)', () => {
    const UUID = '0b5c2d0e-6a0c-4c8e-9b8e-2b1d3c4e5f60';

    const montarComEstado = (commitFalha = false) => {
        const linhas = new Map<number, CredencialLinha>([
            [
                4,
                {
                    id: 4,
                    username: 'beto',
                    email: 'beto@qa.local',
                    authUserId: UUID,
                    ativo: true,
                    passwordHash: 'hash-antigo',
                },
            ],
        ]);
        const transacao = async (
            id: number,
            mudanca: Partial<CredencialLinha>,
            antesDoCommit?: AntesDoCommit,
        ): Promise<void> => {
            const antes = linhas.get(id);
            if (!antes) throw new Error(`NOT_FOUND: user ${id} not found`);
            const nova = { ...antes, ...mudanca };
            linhas.set(id, nova);
            try {
                await antesDoCommit?.({} as never, nova);
                if (commitFalha) throw new Error('commit falhou');
            } catch (error) {
                linhas.set(id, antes);
                throw error;
            }
        };
        const client = {
            isAdminConfigured: jest.fn().mockResolvedValue(true),
            adminUpdateUser: jest.fn().mockResolvedValue({ id: UUID, banned: false }),
            adminCreateUser: jest.fn(),
            adminFindUserByEmail: jest.fn(),
        };
        const log = buildLog();
        const mirror = new CredentialMirror(
            client as never,
            { setAuthUserId: jest.fn(), findIdByAuthUserId: jest.fn() } as never,
            log,
        );
        const m = montar(mirror);
        Object.assign(m.repo, {
            updatePassword: jest.fn(
                async (id: number, hash: string, o: { antesDoCommit?: AntesDoCommit } = {}) => {
                    await transacao(id, { passwordHash: hash }, o.antesDoCommit);
                    return true;
                },
            ),
            deactivateGuarded: jest.fn(async (id: number, _ator: string, a?: AntesDoCommit) => {
                await transacao(id, { ativo: false }, a);
                return DEACTIVATE_RESULT.DEACTIVATED;
            }),
            setEmail: jest.fn(
                async (id: number, email: string, _por: string, a?: AntesDoCommit) => {
                    await transacao(id, { email }, a);
                    return SET_EMAIL_RESULT.UPDATED;
                },
            ),
        });
        return { ...m, linhas, client, logEspelho: log };
    };

    it('GoTrue indisponível na troca de senha: erro sobe e o banco fica como estava', async () => {
        const { service, linhas, client } = montarComEstado();
        client.adminUpdateUser.mockRejectedValue(new SupabaseAuthUnavailableError('x', 'timeout'));
        await expect(service.resetPassword(4, 'nova-senha-1')).rejects.toBeInstanceOf(
            SupabaseAuthUnavailableError,
        );
        expect(linhas.get(4)?.passwordHash).toBe('hash-antigo');
    });

    it('troca de senha: bcrypt local novo e a MESMA senha no GoTrue (R7)', async () => {
        const { service, linhas, client } = montarComEstado();
        await service.resetPassword(4, 'nova-senha-1');
        expect(await bcrypt.compare('nova-senha-1', linhas.get(4)?.passwordHash ?? '')).toBe(true);
        expect(client.adminUpdateUser).toHaveBeenCalledWith(UUID, { password: 'nova-senha-1' });
    });

    it('GoTrue indisponível na troca de e-mail: nada muda', async () => {
        const { service, linhas, client } = montarComEstado();
        client.adminUpdateUser.mockRejectedValue(new SupabaseAuthUnavailableError('x', 'timeout'));
        await expect(service.setEmail(4, 'novo@qa.local', 'adm')).rejects.toBeInstanceOf(
            SupabaseAuthUnavailableError,
        );
        expect(linhas.get(4)?.email).toBe('beto@qa.local');
    });

    it('desativar com o ban falhando: ativo = false lido de volta, AUTH_DIVERGENCIA, sem erro (exceção à R6)', async () => {
        const { service, linhas, client, logEspelho, accessService } = montarComEstado();
        client.adminUpdateUser.mockRejectedValue(new SupabaseAuthUnavailableError('x', 'timeout'));
        await expect(service.setAtivo(4, false, 'adm')).resolves.toBeUndefined();
        expect(linhas.get(4)?.ativo).toBe(false);
        expect(accessService.invalidar).toHaveBeenCalledWith(4);
        expect(logEspelho.error).toHaveBeenCalledWith(
            expect.objectContaining({ type: 'AUTH_DIVERGENCIA' }),
        );
    });

    it('commit falha depois do sucesso no GoTrue: AUTH_DIVERGENCIA com ids e operação, e o erro sobe', async () => {
        const { service, logEspelho } = montarComEstado(true);
        await expect(service.resetPassword(4, 'nova-senha-1')).rejects.toThrow('commit falhou');
        expect(logEspelho.error).toHaveBeenCalledWith(
            expect.objectContaining({
                type: 'AUTH_DIVERGENCIA',
                message: expect.stringMatching(/o sync-supabase-auth repara/),
                data: expect.objectContaining({ userId: 4, authUserId: UUID, operacao: 'senha' }),
            }),
        );
    });
});
