import { inject, injectable } from 'tsyringe';
import { z } from 'zod';
import PostgreeDatabaseClient from '../../client/database/PostgreeDatabaseClient.js';
import type {
    FontesDePermissao,
    IdentidadeUsuario,
} from '../../interface/perfil/PerfilInterface.js';

/**
 * Colunas EXIBÍVEIS de `app_user`, listadas uma a uma (nunca `u.*`): `password_hash`,
 * `conexos_password_enc` e `auth_user_id` não são selecionadas — I6 da AtividadeUsuario.
 */
const IDENTIDADE_SQL = `
    SELECT u.id, u.username, u.email, u.ativo, u.created_at, u.created_by, u.conexos_username,
           r.id AS role_id, r.nome AS role_nome, r.descricao AS role_descricao
      FROM app_user u
      JOIN app_role r ON r.id = u.role_id
     WHERE u.id = $userId`;

/** Pacote do papel + exceções com autoria, numa ida (sem N+1). */
const FONTES_SQL = `
    SELECT COALESCE(
               (SELECT array_agg(rp.permission ORDER BY rp.permission)
                  FROM app_role_permission rp
                 WHERE rp.role_id = u.role_id),
               ARRAY[]::text[]
           ) AS pacote,
           COALESCE(
               (SELECT json_agg(
                           json_build_object(
                               'permissao', up.permission,
                               'efeito', up.efeito,
                               'concedido_por', up.concedido_por,
                               'concedido_em', up.concedido_em
                           )
                           ORDER BY up.permission)
                  FROM user_permission up
                 WHERE up.user_id = u.id),
               '[]'::json
           ) AS excecoes
      FROM app_user u
     WHERE u.id = $userId`;

/** Zod na borda do banco. Nulos de `email`, `created_by`, `conexos_username` viram ausentes. */
const identidadeSchema = z.object({
    id: z.coerce.number().int(),
    username: z.string(),
    email: z.string().nullable().optional(),
    ativo: z.boolean(),
    created_at: z.coerce.date(),
    created_by: z.string().nullable().optional(),
    conexos_username: z.string().nullable().optional(),
    role_id: z.coerce.number().int(),
    role_nome: z.string(),
    role_descricao: z.string().nullable().optional(),
});

const fontesSchema = z.object({
    pacote: z.array(z.string()),
    excecoes: z.array(
        z.object({
            permissao: z.string(),
            efeito: z.string(),
            concedido_por: z.string(),
            concedido_em: z.coerce.date(),
        }),
    ),
});

/**
 * PerfilRepository — identidade e origens de permissão do usuário do perfil (ADR-0058).
 *
 * Só leitura, SQL parametrizado (`$userId`). Não calcula permissão efetiva: isso é do
 * `EffectivePermissionCalculator` (I7 do ADR-0053), chamado pelo serviço.
 */
@injectable()
export default class PerfilRepository {
    public constructor(
        @inject(PostgreeDatabaseClient)
        private readonly databaseClient: PostgreeDatabaseClient,
    ) {}

    /** `null` = usuário inexistente. */
    public buscarIdentidade = async (userId: number): Promise<IdentidadeUsuario | null> => {
        const raw = await this.databaseClient.selectFirst<unknown>(IDENTIDADE_SQL, { userId });
        if (!raw) return null;
        const row = identidadeSchema.parse(raw);
        return {
            userId: row.id,
            username: row.username,
            ...(row.email != null ? { email: row.email } : {}),
            ativo: row.ativo,
            membroDesde: row.created_at.toISOString(),
            ...(row.created_by != null ? { criadoPor: row.created_by } : {}),
            papel: {
                id: row.role_id,
                nome: row.role_nome,
                ...(row.role_descricao != null ? { descricao: row.role_descricao } : {}),
            },
            ...(row.conexos_username != null ? { conexosUsername: row.conexos_username } : {}),
        };
    };

    /** Pacote do papel e exceções (com efeito, autor e data). Sem usuário: tudo vazio. */
    public buscarFontesDePermissao = async (userId: number): Promise<FontesDePermissao> => {
        const raw = await this.databaseClient.selectFirst<unknown>(FONTES_SQL, { userId });
        if (!raw) return { pacote: [], excecoes: [] };
        const row = fontesSchema.parse(raw);
        return {
            pacote: row.pacote,
            excecoes: row.excecoes.map((e) => ({
                permissao: e.permissao,
                efeito: e.efeito,
                concedidoPor: e.concedido_por,
                concedidoEm: e.concedido_em.toISOString(),
            })),
        };
    };
}
