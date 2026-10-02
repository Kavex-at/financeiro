/**
 * Contrato da política de senha com o front (ADR-0059, PR #101): ids das regras que a rota devolve
 * em `400 { codigo: 'POLITICA', regras }` e o corpo de `GET /me/senha/politica`.
 */
export const PASSWORD_RULE = {
    TAMANHO: 'tamanho',
    DIFERENTE_DA_ATUAL: 'diferente_da_atual',
} as const;
export type PasswordRule = (typeof PASSWORD_RULE)[keyof typeof PASSWORD_RULE];

/** Corpo de `GET /me/senha/politica`. `regras` = regras EXTRAS além de tamanho e "diferente". */
export interface PasswordPolicyDescription {
    minimo: number;
    maximo: number;
    regras: { id: string; rotulo: string; padrao?: string }[];
}
