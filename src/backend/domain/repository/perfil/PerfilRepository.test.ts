import 'reflect-metadata';
import PerfilRepository from './PerfilRepository.js';

const identidadeRow = (over: Record<string, unknown> = {}) => ({
    id: 7,
    username: 'ana.souza',
    email: 'ana@columbia.com.br',
    ativo: true,
    created_at: new Date('2026-08-01T12:00:00.000Z'),
    created_by: 'admin',
    conexos_username: 'ANA_SOUZA',
    role_id: 2,
    role_nome: 'Operador',
    role_descricao: 'Executa as frentes',
    ...over,
});

describe('PerfilRepository.buscarIdentidade', () => {
    it('seleciona só colunas exibíveis — nunca credencial — filtrando por $userId', async () => {
        const db = { selectFirst: jest.fn().mockResolvedValue(identidadeRow()) };
        await new PerfilRepository(db as never).buscarIdentidade(7);
        const [sql, params] = db.selectFirst.mock.calls[0];
        expect(sql).not.toMatch(/password_hash|conexos_password_enc|auth_user_id/);
        expect(sql).not.toMatch(/u\.\*/);
        expect(sql).toMatch(/WHERE u\.id = \$userId/);
        expect(params).toEqual({ userId: 7 });
    });

    it('mapeia a linha, com nulos do banco como ausentes', async () => {
        const db = {
            selectFirst: jest.fn().mockResolvedValue(
                identidadeRow({
                    email: null,
                    created_by: null,
                    conexos_username: null,
                    role_descricao: null,
                }),
            ),
        };
        const r = await new PerfilRepository(db as never).buscarIdentidade(7);
        expect(r).toEqual({
            userId: 7,
            username: 'ana.souza',
            ativo: true,
            membroDesde: '2026-08-01T12:00:00.000Z',
            papel: { id: 2, nome: 'Operador' },
        });
    });

    it('com vínculo e e-mail, devolve os campos preenchidos', async () => {
        const db = { selectFirst: jest.fn().mockResolvedValue(identidadeRow()) };
        const r = await new PerfilRepository(db as never).buscarIdentidade(7);
        expect(r).toMatchObject({
            email: 'ana@columbia.com.br',
            criadoPor: 'admin',
            conexosUsername: 'ANA_SOUZA',
            papel: { id: 2, nome: 'Operador', descricao: 'Executa as frentes' },
        });
    });

    it('usuário inexistente → null', async () => {
        const db = { selectFirst: jest.fn().mockResolvedValue(null) };
        await expect(new PerfilRepository(db as never).buscarIdentidade(99)).resolves.toBeNull();
    });
});

describe('PerfilRepository.buscarFontesDePermissao', () => {
    it('pacote do papel e exceções com efeito, concedido_por e concedido_em', async () => {
        const db = {
            selectFirst: jest.fn().mockResolvedValue({
                pacote: ['permutas:ver', 'sispag:executar'],
                excecoes: [
                    {
                        permissao: 'metricas:ver',
                        efeito: 'conceder',
                        concedido_por: 'admin',
                        concedido_em: '2026-09-01T10:00:00.123456+00:00',
                    },
                ],
            }),
        };
        const r = await new PerfilRepository(db as never).buscarFontesDePermissao(7);
        const [sql, params] = db.selectFirst.mock.calls[0];
        expect(sql).toMatch(/app_role_permission/);
        expect(sql).toMatch(/user_permission/);
        expect(sql).toMatch(/concedido_por/);
        expect(sql).toMatch(/concedido_em/);
        expect(sql).not.toMatch(/password_hash|conexos_password_enc/);
        expect(params).toEqual({ userId: 7 });
        expect(r).toEqual({
            pacote: ['permutas:ver', 'sispag:executar'],
            excecoes: [
                {
                    permissao: 'metricas:ver',
                    efeito: 'conceder',
                    concedidoPor: 'admin',
                    concedidoEm: '2026-09-01T10:00:00.123Z',
                },
            ],
        });
    });

    it('sem usuário: pacote e exceções vazios', async () => {
        const db = { selectFirst: jest.fn().mockResolvedValue(null) };
        await expect(new PerfilRepository(db as never).buscarFontesDePermissao(7)).resolves.toEqual(
            { pacote: [], excecoes: [] },
        );
    });
});
