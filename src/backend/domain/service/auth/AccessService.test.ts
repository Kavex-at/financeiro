import 'reflect-metadata';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { PERMISSION_CATALOG } from '../../interface/auth/Permission.js';
import type Clock from '../../libs/clock/Clock.js';
import type AccessRepository from '../../repository/auth/AccessRepository.js';
import type { UserAccess } from '../../repository/auth/AccessRepository.js';
import type LogService from '../LogService.js';
import AccessService from './AccessService.js';
import EffectivePermissionCalculator from './EffectivePermissionCalculator.js';

const acesso = (over: Partial<UserAccess> = {}): UserAccess => ({
    userId: 7,
    username: 'Maria@Columbiabr.com',
    ativo: true,
    papel: { id: 1, nome: 'Administrador' },
    pacote: [...PERMISSION_CATALOG],
    excecoes: [],
    ...over,
});

/** Relógio controlado pelo teste: nada de `setTimeout` real, nada de esperar 30 s. */
const buildClock = (inicio = 1_000_000) => {
    let agora = inicio;
    return {
        clock: { now: () => agora } as unknown as Clock,
        avancar: (ms: number) => {
            agora += ms;
        },
    };
};

const buildService = () => {
    const repo = { findAccessBySub: jest.fn(), findAccessByAuthUserId: jest.fn() };
    const log = { warn: jest.fn().mockResolvedValue(undefined) };
    const { clock, avancar } = buildClock();
    const service = new AccessService(
        repo as unknown as AccessRepository,
        new EffectivePermissionCalculator(),
        log as unknown as LogService,
        clock,
    );
    return { service, repo, log, avancar };
};

describe('AccessService.resolver', () => {
    it('devolve papel e efetivas calculadas pelo EffectivePermissionCalculator', async () => {
        const { service, repo } = buildService();
        repo.findAccessBySub.mockResolvedValue(
            acesso({
                pacote: ['sispag:executar'],
                excecoes: [{ permissao: 'metricas:ver', efeito: 'conceder' }],
            }),
        );
        const out = await service.resolver({ tipo: 'username', valor: 'maria@columbiabr.com' });
        expect(out).toMatchObject({
            userId: 7,
            username: 'Maria@Columbiabr.com',
            ativo: true,
            papel: { id: 1, nome: 'Administrador' },
        });
        expect([...(out?.permissoes ?? [])].sort()).toEqual([
            'metricas:ver',
            'sispag:executar',
            'sispag:ver',
        ]);
    });

    it('duas chamadas dentro de 30 s: UMA ida ao repositório; depois de 30 s, outra', async () => {
        const { service, repo, avancar } = buildService();
        repo.findAccessBySub.mockResolvedValue(acesso());
        await service.resolver({ tipo: 'username', valor: 'maria@columbiabr.com' });
        avancar(29_999);
        await service.resolver({ tipo: 'username', valor: 'maria@columbiabr.com' });
        expect(repo.findAccessBySub).toHaveBeenCalledTimes(1);
        avancar(1);
        await service.resolver({ tipo: 'username', valor: 'maria@columbiabr.com' });
        expect(repo.findAccessBySub).toHaveBeenCalledTimes(2);
    });

    it('o TTL é uma constante nomeada da classe, de 30 s', () => {
        expect(AccessService.CACHE_TTL_MS).toBe(30_000);
    });

    it('casa sub sem distinção de caixa: Admin e admin são a mesma entrada', async () => {
        const { service, repo } = buildService();
        repo.findAccessBySub.mockResolvedValue(acesso());
        await service.resolver({ tipo: 'username', valor: 'Admin' });
        await service.resolver({ tipo: 'username', valor: 'admin' });
        expect(repo.findAccessBySub).toHaveBeenCalledTimes(1);
    });

    it('invalidar(userId): a próxima resolução vai ao banco, mesmo dentro dos 30 s', async () => {
        const { service, repo } = buildService();
        repo.findAccessBySub.mockResolvedValue(acesso());
        await service.resolver({ tipo: 'username', valor: 'maria@columbiabr.com' });
        service.invalidar(7);
        await service.resolver({ tipo: 'username', valor: 'maria@columbiabr.com' });
        expect(repo.findAccessBySub).toHaveBeenCalledTimes(2);
    });

    it('invalidar não afeta a entrada de outro usuário', async () => {
        const { service, repo } = buildService();
        repo.findAccessBySub.mockImplementation(async (sub: string) =>
            acesso({ userId: sub === 'a' ? 1 : 2, username: sub }),
        );
        await service.resolver({ tipo: 'username', valor: 'a' });
        await service.resolver({ tipo: 'username', valor: 'b' });
        service.invalidar(1);
        await service.resolver({ tipo: 'username', valor: 'b' });
        expect(repo.findAccessBySub).toHaveBeenCalledTimes(2);
        await service.resolver({ tipo: 'username', valor: 'a' });
        expect(repo.findAccessBySub).toHaveBeenCalledTimes(3);
    });

    it('usuário inexistente NÃO é cacheado', async () => {
        const { service, repo } = buildService();
        repo.findAccessBySub.mockResolvedValue(null);
        expect(await service.resolver({ tipo: 'username', valor: 'fantasma' })).toBeNull();
        await service.resolver({ tipo: 'username', valor: 'fantasma' });
        expect(repo.findAccessBySub).toHaveBeenCalledTimes(2);
    });

    it('inativo é cacheado, e a invalidação cobre a reativação', async () => {
        const { service, repo } = buildService();
        repo.findAccessBySub.mockResolvedValueOnce(acesso({ ativo: false }));
        expect(
            (await service.resolver({ tipo: 'username', valor: 'maria@columbiabr.com' }))?.ativo,
        ).toBe(false);
        expect(
            (await service.resolver({ tipo: 'username', valor: 'maria@columbiabr.com' }))?.ativo,
        ).toBe(false);
        expect(repo.findAccessBySub).toHaveBeenCalledTimes(1);

        repo.findAccessBySub.mockResolvedValueOnce(acesso({ ativo: true }));
        service.invalidar(7);
        expect(
            (await service.resolver({ tipo: 'username', valor: 'maria@columbiabr.com' }))?.ativo,
        ).toBe(true);
    });

    it('erro do repositório propaga e NÃO é cacheado', async () => {
        const { service, repo } = buildService();
        repo.findAccessBySub.mockRejectedValueOnce(new Error('banco fora'));
        await expect(
            service.resolver({ tipo: 'username', valor: 'maria@columbiabr.com' }),
        ).rejects.toThrow('banco fora');
        repo.findAccessBySub.mockResolvedValueOnce(acesso());
        await expect(
            service.resolver({ tipo: 'username', valor: 'maria@columbiabr.com' }),
        ).resolves.toMatchObject({
            userId: 7,
        });
        expect(repo.findAccessBySub).toHaveBeenCalledTimes(2);
    });

    it('valor fora do catálogo: ignorado no cálculo e avisado em português (R4)', async () => {
        const { service, repo, log } = buildService();
        repo.findAccessBySub.mockResolvedValue(acesso({ pacote: ['permutas:ver', 'fiscal:ver'] }));
        const out = await service.resolver({ tipo: 'username', valor: 'maria@columbiabr.com' });
        expect([...(out?.permissoes ?? [])]).toEqual(['permutas:ver']);
        expect(log.warn).toHaveBeenCalledWith(
            expect.objectContaining({
                message: expect.stringMatching(/permiss(ão|ões).*fora do catálogo/),
                data: expect.objectContaining({ ignoradas: ['fiscal:ver'] }),
            }),
        );
    });
});

describe('AccessService.resolver — emissor supabase (ADR-0054, D13)', () => {
    const UUID = '0b5c2d0e-6a0c-4c8e-9b8e-2b1d3c4e5f60';

    it('tipo authUserId busca por auth_user_id e devolve o username e o authUserId', async () => {
        const { service, repo } = buildService();
        repo.findAccessByAuthUserId.mockResolvedValue(
            acesso({ username: 'fulano', authUserId: UUID }),
        );
        const out = await service.resolver({ tipo: 'authUserId', valor: UUID });
        expect(repo.findAccessByAuthUserId).toHaveBeenCalledWith(UUID);
        expect(repo.findAccessBySub).not.toHaveBeenCalled();
        expect(out).toMatchObject({ username: 'fulano', authUserId: UUID, userId: 7 });
    });

    it('cache com chave prefixada: o mesmo texto em tipos diferentes são entradas diferentes', async () => {
        const { service, repo } = buildService();
        repo.findAccessBySub.mockResolvedValue(acesso());
        repo.findAccessByAuthUserId.mockResolvedValue(acesso({ authUserId: UUID }));
        await service.resolver({ tipo: 'username', valor: UUID });
        await service.resolver({ tipo: 'authUserId', valor: UUID });
        await service.resolver({ tipo: 'authUserId', valor: UUID.toUpperCase() });
        expect(repo.findAccessBySub).toHaveBeenCalledTimes(1);
        expect(repo.findAccessByAuthUserId).toHaveBeenCalledTimes(1);
    });

    it('invalidar(userId) derruba as entradas dos DOIS tipos daquele usuário', async () => {
        const { service, repo } = buildService();
        repo.findAccessBySub.mockResolvedValue(acesso());
        repo.findAccessByAuthUserId.mockResolvedValue(acesso({ authUserId: UUID }));
        await service.resolver({ tipo: 'username', valor: 'maria@columbiabr.com' });
        await service.resolver({ tipo: 'authUserId', valor: UUID });
        service.invalidar(7);
        await service.resolver({ tipo: 'username', valor: 'maria@columbiabr.com' });
        await service.resolver({ tipo: 'authUserId', valor: UUID });
        expect(repo.findAccessBySub).toHaveBeenCalledTimes(2);
        expect(repo.findAccessByAuthUserId).toHaveBeenCalledTimes(2);
    });

    it('vínculo inexistente devolve null e não é cacheado', async () => {
        const { service, repo } = buildService();
        repo.findAccessByAuthUserId.mockResolvedValue(null);
        expect(await service.resolver({ tipo: 'authUserId', valor: UUID })).toBeNull();
        await service.resolver({ tipo: 'authUserId', valor: UUID });
        expect(repo.findAccessByAuthUserId).toHaveBeenCalledTimes(2);
    });
});

describe('gotcha dos ~58 jobs', () => {
    it('bootstrapAppContainer não referencia AccessService nem o cache', () => {
        const fonte = readFileSync(path.join(__dirname, '..', '..', 'appContainer.ts'), 'utf8');
        expect(fonte).not.toMatch(/AccessService/);
        expect(fonte).not.toMatch(/AccessRepository/);
        expect(fonte).not.toMatch(/CACHE_TTL/);
    });

    it('AccessService não lê process.env', () => {
        const fonte = readFileSync(path.join(__dirname, 'AccessService.ts'), 'utf8');
        expect(fonte).not.toMatch(/process\.env/);
    });
});
