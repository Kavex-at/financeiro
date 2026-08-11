import { injectable, singleton } from 'tsyringe';
import type { AppUserContext } from '../../repository/auth/UserRepository.js';

/**
 * TTL do contexto de autorização, em milissegundos.
 *
 * **Constante tipada, deliberadamente NÃO uma variável de ambiente** — "um número de
 * segurança que se muda por deploy é um número que se muda **sem revisão**"
 * (`business-rules/revogacao-de-acesso.md`, I-Usuario-8).
 *
 * É o preço explícito do desenho: a autorização é resolvida do banco a **cada request**
 * (I-Usuario-9), o que seria um `SELECT` por request sem este cache. Em troca,
 * `desativarUsuario` produz efeito em **≤ 30 s**, não instantaneamente — latência
 * **declarada**, não escondida atrás da palavra "imediata".
 */
export const APP_USER_CONTEXT_TTL_MS = 30_000;

interface CacheEntry {
    expiresAt: number;
    /** `null` = não existe linha em `app_user` (403 fail-closed cacheado). */
    context: AppUserContext | null;
}

/**
 * Cache process-local do contexto de autorização, chaveado por `auth_user_id`.
 *
 * ## ⚠️ Restrição datada (2026-08-06) — a premissa que envelhece em silêncio
 *
 * A invalidação é **local ao processo**, e isso só é **suficiente** porque o backend roda
 * em **Render `plan: starter` — instância única** (`render.yaml`).
 *
 * No dia em que houver mais de uma instância, a invalidação deixa de cruzar processos e a
 * latência real de revogação vira o **TTL cheio — sem erro, sem log, sem alarme**. Um admin
 * desativaria um usuário, veria sucesso na UI, e o usuário continuaria operando em outra
 * instância até o TTL expirar. Nada no sistema sinalizaria a diferença.
 *
 * **Escalar horizontalmente EXIGE revisitar `business-rules/revogacao-de-acesso.md`**:
 * invalidação distribuída (pub/sub, Redis) ou TTL menor com custo de leitura maior.
 *
 * `@singleton()` é o que garante o "local ao processo": um único Map por processo, tanto
 * para o middleware quanto para o `UserAdminService` que o invalida.
 */
@singleton()
@injectable()
export default class AppUserContextCache {
    private entries: Map<string, CacheEntry> = new Map();

    /**
     * Chave da entrada de quem se identificou pelo **token legado**, cujo `sub` é o
     * `username` e não um `auth_user_id` (ADR-0030 §6).
     *
     * O namespace não é cosmético: durante as fases 2–3 do rollout a **mesma pessoa** tem
     * duas identidades vivas ao mesmo tempo, e a revogação precisa alcançar as duas
     * (`UserAdminService.setAtivo`) sem que uma apague a outra. O caminho do provedor
     * continua usando a chave **crua** — prefixá-la também quebraria a invalidação síncrona
     * sem quebrar teste nenhum.
     *
     * Some na Fase 4, junto do esquema legado.
     */
    public legacyKeyFor = (username: string): string => `legacy:${username}`;

    /**
     * Entrada viva para o `auth_user_id`, ou `undefined` quando ausente/expirada.
     * O `null` INTERNO (linha inexistente) é um resultado cacheado legítimo — daí o
     * envelope: sem ele, um token órfão em loop faria um `SELECT` por request.
     */
    public get = (authUserId: string): CacheEntry | undefined => {
        const entry = this.entries.get(authUserId);
        if (!entry) return undefined;
        if (entry.expiresAt <= Date.now()) {
            this.entries.delete(authUserId);
            return undefined;
        }
        return entry;
    };

    /** Grava o resultado (inclusive o `null` de "sem linha") com o TTL padrão. */
    public set = (authUserId: string, context: AppUserContext | null): void => {
        this.entries.set(authUserId, {
            context,
            expiresAt: Date.now() + APP_USER_CONTEXT_TTL_MS,
        });
    };

    /**
     * Remove a entrada **sincronicamente**. É esta sincronicidade — e não o TTL — que faz
     * o "≤ 30 s" da revogação valer: `desativarUsuario` invalida no MESMO processo que
     * atende a request de desativação, antes de responder.
     */
    public invalidate = (authUserId: string): void => {
        this.entries.delete(authUserId);
    };

    /** Esvazia o cache inteiro. Existe para testes e para um eventual reset operacional. */
    public clear = (): void => {
        this.entries.clear();
    };
}
