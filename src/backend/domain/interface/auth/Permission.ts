import { z } from 'zod';

/**
 * Catálogo de permissões da plataforma (ADR-0053) — FIXO no código, sem tabela.
 *
 * Grossas, por módulo, em dois níveis (`ver` / `executar`), mais quatro avulsas. Um valor novo aqui
 * exige também uma migration que troque o `CHECK (permission IN (...))` das tabelas
 * `app_role_permission` e `user_permission` (R4); o teste de paridade da 0066 falha se só um dos
 * lados mudar.
 *
 * Nenhuma rota escreve a string crua: todas usam estas constantes.
 */
export const PERMISSION = {
    PERMUTAS_VER: 'permutas:ver',
    PERMUTAS_EXECUTAR: 'permutas:executar',
    SISPAG_VER: 'sispag:ver',
    SISPAG_EXECUTAR: 'sispag:executar',
    /**
     * Aprovar a conta (TED) digitada no item do lote antes de finalizar (ADR-0054 D10, 0068).
     * Avulsa: não implica nem é implicada por `sispag:ver`/`sispag:executar`.
     */
    SISPAG_APROVAR_DESTINO: 'sispag:aprovar_destino',
    RECEBIMENTOS_VER: 'recebimentos:ver',
    RECEBIMENTOS_EXECUTAR: 'recebimentos:executar',
    OPERACAO_VER: 'operacao:ver',
    METRICAS_VER: 'metricas:ver',
    USUARIOS_GERENCIAR: 'usuarios:gerenciar',
} as const;

export type Permission = (typeof PERMISSION)[keyof typeof PERMISSION];

/** O catálogo inteiro, na ordem de exibição (módulo, depois ver → executar). */
export const PERMISSION_CATALOG: readonly Permission[] = [
    PERMISSION.PERMUTAS_VER,
    PERMISSION.PERMUTAS_EXECUTAR,
    PERMISSION.SISPAG_VER,
    PERMISSION.SISPAG_EXECUTAR,
    PERMISSION.SISPAG_APROVAR_DESTINO,
    PERMISSION.RECEBIMENTOS_VER,
    PERMISSION.RECEBIMENTOS_EXECUTAR,
    PERMISSION.OPERACAO_VER,
    PERMISSION.METRICAS_VER,
    PERMISSION.USUARIOS_GERENCIAR,
];

/** Zod no boundary: só valores do catálogo passam (R4). */
export const permissionSchema = z.enum([
    PERMISSION.PERMUTAS_VER,
    PERMISSION.PERMUTAS_EXECUTAR,
    PERMISSION.SISPAG_VER,
    PERMISSION.SISPAG_EXECUTAR,
    PERMISSION.SISPAG_APROVAR_DESTINO,
    PERMISSION.RECEBIMENTOS_VER,
    PERMISSION.RECEBIMENTOS_EXECUTAR,
    PERMISSION.OPERACAO_VER,
    PERMISSION.METRICAS_VER,
    PERMISSION.USUARIOS_GERENCIAR,
]);

/**
 * `executar` implica `ver` no mesmo módulo (I7, Q8). A chave é a permissão maior; o valor, o que
 * ela arrasta junto. Revogar o valor (`ver`) derruba também a chave (`executar`).
 */
export const PERMISSION_IMPLIES: Readonly<Partial<Record<Permission, Permission>>> = {
    [PERMISSION.PERMUTAS_EXECUTAR]: PERMISSION.PERMUTAS_VER,
    [PERMISSION.SISPAG_EXECUTAR]: PERMISSION.SISPAG_VER,
    [PERMISSION.RECEBIMENTOS_EXECUTAR]: PERMISSION.RECEBIMENTOS_VER,
};

/** Efeito de uma exceção por usuário (Q2): dar além do papel, ou tirar do papel. */
export const EXCEPTION_EFFECT = {
    CONCEDER: 'conceder',
    REVOGAR: 'revogar',
} as const;

export type ExceptionEffect = (typeof EXCEPTION_EFFECT)[keyof typeof EXCEPTION_EFFECT];

export const exceptionEffectSchema = z.enum([EXCEPTION_EFFECT.CONCEDER, EXCEPTION_EFFECT.REVOGAR]);

/**
 * Exceção como sai do banco: strings livres, porque um valor antigo pode sobrar depois de uma
 * permissão sair do código (R4). Quem valida contra o catálogo é o calculador.
 */
export interface PermissionException {
    permissao: string;
    efeito: string;
}

/** Exceção já validada contra o catálogo (entrada da tela). */
export interface ValidPermissionException {
    permissao: Permission;
    efeito: ExceptionEffect;
}

/** Papel resumido: o que a tela e o token de auditoria mostram. */
export interface RoleRef {
    id: number;
    nome: string;
}

/** Nome do papel semeado pela 0066 (nove permissões; a 0068 acrescenta a décima). */
export const ADMIN_ROLE_NAME = 'Administrador';

/** `true` quando o valor é uma permissão do catálogo. */
export const isPermission = (value: string): value is Permission =>
    (PERMISSION_CATALOG as readonly string[]).includes(value);
