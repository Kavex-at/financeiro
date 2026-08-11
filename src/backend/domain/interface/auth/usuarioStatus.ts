/**
 * `Usuario` — constantes tipadas do ciclo de vida (ontologia P3: nunca strings cruas).
 *
 * Espelha `ontology/state-machines/usuario.md`. Os três estados são LOCAIS
 * (`app_user`), não do GoTrue: o provedor custodia a credencial; o ciclo de vida do
 * ACESSO À PLATAFORMA é nosso.
 *
 * `excluido` é `out_of_scope` **por decisão**, não por fatiamento: hard delete é
 * proibido (I-Usuario-3) — a saída de um usuário é `ativo = false`, jamais `DELETE`.
 */
export const USUARIO_STATUS = {
    /** Convite enviado, senha ainda não definida pelo titular. `ativo = false`. Não opera nada. */
    CONVIDADO: 'convidado',
    /** Opera conforme seu `role`. Único estado em que o vínculo Conexos é utilizável (I-Usuario-5). */
    ATIVO: 'ativo',
    /** Acesso revogado (soft-disable). 403 em toda rota autenticada, incluindo LEITURA (I-Usuario-4). */
    INATIVO: 'inativo',
} as const;

export type UsuarioStatus = (typeof USUARIO_STATUS)[keyof typeof USUARIO_STATUS];

/**
 * Deriva o estado do ciclo de vida a partir das duas colunas persistidas.
 *
 * **`ativo` é lido PRIMEIRO, e isso é a decisão, não a ordem do `if`.** Ele continua
 * sendo a ÚNICA fonte de autorização (I-Usuario-9 / I-Usuario-4); `convite_pendente`
 * apenas refina o ramo `false`, para que a UI distinga "nunca entrou" de "acesso
 * revogado". Não há dois interruptores — um usuário `ativo = true` é `ativo`,
 * independentemente do que `convite_pendente` disser.
 */
export const derivarUsuarioStatus = (input: {
    ativo: boolean;
    convitePendente: boolean;
}): UsuarioStatus => {
    if (input.ativo) return USUARIO_STATUS.ATIVO;
    return input.convitePendente ? USUARIO_STATUS.CONVIDADO : USUARIO_STATUS.INATIVO;
};
