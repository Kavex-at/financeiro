import type { Permission } from '../auth/Permission.js';

/**
 * Perfil do próprio usuário (ADR-0058). Só leitura: nenhuma credencial (`password_hash`,
 * `conexos_password_enc`, `auth_user_id`) entra nestes tipos — e por isso nunca sai na resposta.
 */

/** Identidade como está no banco, só as colunas exibíveis. */
export interface IdentidadeUsuario {
    userId: number;
    username: string;
    email?: string;
    ativo: boolean;
    /** `app_user.created_at`, ISO UTC. */
    membroDesde: string;
    criadoPor?: string;
    papel: { id: number; nome: string; descricao?: string };
    /** Vinculado = `conexos_username IS NOT NULL` (ADR-0041). */
    conexosUsername?: string;
}

/** Exceção com autoria, para dizer "concedida por X em data". */
export interface ExcecaoComAutoria {
    permissao: string;
    efeito: string;
    concedidoPor: string;
    /** ISO UTC. */
    concedidoEm: string;
}

/** As duas origens cruas das permissões: o pacote do papel e as exceções. */
export interface FontesDePermissao {
    pacote: string[];
    excecoes: ExcecaoComAutoria[];
}

/** Origem de uma permissão exibida no perfil (4 valores). */
export const ORIGEM_PERMISSAO = {
    PAPEL: 'papel',
    CONCEDIDA: 'concedida',
    REVOGADA: 'revogada',
    IMPLICADA: 'implicada',
} as const;
export type OrigemPermissao = (typeof ORIGEM_PERMISSAO)[keyof typeof ORIGEM_PERMISSAO];

export interface PermissaoComOrigem {
    codigo: Permission;
    /** `true` = está no conjunto do `EffectivePermissionCalculator`. Revogada sai com `false`. */
    efetiva: boolean;
    origem: OrigemPermissao;
    por?: string;
    em?: string;
    implicadaPor?: Permission;
}

/** O corpo de `GET /me`. */
export interface PerfilUsuario {
    username: string;
    email: string | null;
    ativo: boolean;
    membroDesde: string;
    criadoPor: string | null;
    papel: { id: number; nome: string; descricao: string | null };
    conexos: { vinculado: boolean; conexosUsername: string | null };
    permissoes: PermissaoComOrigem[];
}
