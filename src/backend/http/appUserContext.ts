import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { container } from 'tsyringe';
import { bootstrapAppContainer } from '../domain/appContainer.js';
import SupabaseAdminClient from '../domain/client/SupabaseAdminClient.js';
import type { AppUserContext } from '../domain/repository/auth/UserRepository.js';
import UserRepository from '../domain/repository/auth/UserRepository.js';
import AppUserContextCache, {
    APP_USER_CONTEXT_TTL_MS,
} from '../domain/service/auth/AppUserContextCache.js';
import type { AuthScheme, AuthUser } from './auth.js';
import type { AuthEnv } from './authEnv.js';

/**
 * O TTL do contexto vive em `AppUserContextCache` (constante tipada, nunca env var) e é
 * reexportado aqui porque é aqui que ele é observável: o middleware é o único consumidor.
 */
export { APP_USER_CONTEXT_TTL_MS };

/**
 * Usuário sintético injetado sob `DEV_AUTH_BYPASS`.
 *
 * O `username` é **inconfundível de propósito**: ele **vai vazar para `executado_por`** pela
 * mesma regra que governa todo ator (I-Usuario-1). Um bypass que grava um e-mail plausível é
 * **pior** do que um que grava lixo óbvio — o lixo óbvio é detectado na primeira leitura da
 * trilha; o plausível é atribuído a uma pessoa de verdade.
 *
 * O `role: 'admin'` fecha um bug de passagem: hoje o bypass deixa `req.user` **indefinido**,
 * e por isso `requireRole` responde **401 em toda mutação em dev**.
 *
 * (O fail-fast que impede `DEV_AUTH_BYPASS` fora de local/dev vive em `authEnv.ts` e é
 * deny-by-default — ele é a razão pela qual este usuário nunca alcança um ambiente real.)
 */
export const DEV_BYPASS_USER: AuthUser = {
    sub: 'dev-bypass',
    username: 'dev-bypass@local',
    email: 'dev-bypass@local',
    role: 'admin',
};

/** Mensagens user-facing (PT-BR). Os motivos internos ficam no log, em inglês. */
const FORBIDDEN_NO_ROW =
    'Seu acesso não está habilitado nesta plataforma. Fale com um administrador.';
const FORBIDDEN_INACTIVE = 'Seu acesso foi desativado. Fale com um administrador.';
const FORBIDDEN_PENDING_INVITE =
    'Seu convite ainda não foi concluído. Abra o link enviado por e-mail e defina sua senha.';
const UNAUTHENTICATED = 'Não autenticado.';

/**
 * `resolverContextoUsuario` — resolve a AUTORIZAÇÃO do banco a cada request (I-Usuario-9).
 *
 * > A ação silenciosa mais importante do sistema: não tem rota, não tem botão, não aparece
 * > na UI — e toda request autenticada passa por ela.
 *
 * ```
 * O JWT prova IDENTIDADE.   →  buildAuthMiddleware (JWKS/HS256) → req.user.{sub,authScheme}
 * O banco decide AUTORIZAÇÃO. →  este middleware               → req.user.{role,username,appUserId}
 * ```
 *
 * **Dois esquemas, dois lookups** (ADR-0030 §6). Durante as fases 2–3 do rollout convivem o
 * token do provedor (`sub` = UUID → `auth_user_id`) e o token legado (`sub` = username →
 * `username`). `req.user.authScheme` é quem decide — e não é detalhe de implementação: uma
 * doutrina única de lookup manda um e-mail para uma coluna `UUID` e transforma **toda
 * request autenticada em 500** no exato instante em que o rollback é acionado.
 *
 * | Resultado | Resposta |
 * |---|---|
 * | linha encontrada, `ativo = true` | segue — `req.user.role` **sobrescrito** por `app_user.role` |
 * | **sem linha** | **403** |
 * | linha com `ativo = false` | **403** |
 *
 * **Nunca 401 nesses dois casos.** A identidade é legítima; o que falta é autorização — e
 * 401 manda o frontend tentar refresh contra um provedor que está respondendo corretamente.
 *
 * **Por que fail-closed não é paranoia:** o **mesmo projeto Supabase** hospeda o nosso
 * Postgres e emite os tokens. Com signup público ligado, qualquer pessoa na internet obtém
 * um token válido com `aud: 'authenticated'`. Desligar o signup é a primeira camada (passo
 * humano, num painel); este 403 é a **única que vive no código** — logo a única que sobrevive
 * a alguém religar o signup por engano.
 *
 * **Ordem de montagem é contrato** (`index.ts`): `buildAuthMiddleware` → **este** →
 * `conexosIdentityMiddleware`. Identidade → autorização → identidade-no-ERP. Invertê-la
 * mandaria o `sub` (UUID) para o ALS e a cadeia Conexos degradaria para o robô **em
 * silêncio**.
 *
 * Ver `actions/usuario/resolver-contexto-usuario.md` e
 * `business-rules/autorizacao-resolvida-do-banco.md`.
 */
export const buildAppUserContextMiddleware = (authEnv: AuthEnv): RequestHandler => {
    /** Grava o contexto do banco sobre o `req.user` do token. Sobrescrita, não merge. */
    const applyContext = (req: Request, context: AppUserContext): void => {
        req.user = {
            ...(req.user ?? { sub: context.username }),
            role: context.role,
            username: context.username,
            appUserId: context.id,
        };
    };

    const forbid = (req: Request, res: Response, message: string, reason: string): void => {
        console.warn(
            `[appUserContext] forbidden ${req.method} ${req.originalUrl}: ${reason} ` +
                `(sub='${req.user?.sub ?? 'none'}')`,
        );
        res.status(403).json({ error: message });
    };

    /**
     * **U2 — aceite do convite, verificado NO PROVEDOR.** Devolve o contexto **ativado**
     * quando o titular confirmou, ou `undefined` para manter o 403.
     *
     * `convidado` e `inativo` são **ambos `ativo = false`** no banco; `convite_pendente` é o
     * que os separa — e a separação é de **segurança**, não de UI. Sem ela, aceitar um convite
     * **reativaria silenciosamente um usuário desligado** que ainda tem o e-mail corporativo:
     * a mesma porta dos fundos que o reset de senha fecha, reaberta pelo convite.
     *
     * Por isso um usuário **revogado nunca chega a falar com o provedor** — é a guarda, não
     * uma otimização.
     *
     * E apresentar um JWT válido **não é prova de aceite**: o próprio link de convite abre
     * sessão no GoTrue **antes** de a senha existir. Confirmação no provedor é.
     */
    const resolveInactive = async (
        sub: string,
        scheme: AuthScheme,
        context: AppUserContext,
    ): Promise<AppUserContext | undefined> => {
        if (!context.convitePendente) return undefined;
        // Token legado: `sub` é o username, não um id do GoTrue — `getUserById` não teria o
        // que consultar. E não há caso legítimo a atender: `AuthService.login` já recusa
        // `ativo = false`, e um convidado nunca teve `password_hash`, então ninguém chega
        // aqui por este caminho com um convite de verdade. 403, sem falar com o provedor.
        if (scheme === 'legacy') return undefined;
        try {
            const goTrueUser = await container.resolve(SupabaseAdminClient).getUserById(sub);
            if (!goTrueUser?.emailConfirmedAt) return undefined;
        } catch (error) {
            // Fail-closed: provedor indisponível não ativa ninguém "no escuro".
            console.warn(
                `[appUserContext] could not verify invite acceptance for sub='${sub}': ` +
                    `${error instanceof Error ? error.message : String(error)}`,
            );
            return undefined;
        }
        return { ...context, ativo: true, convitePendente: false };
    };

    return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        // Bypass ANTES de qualquer container/DB: em dev o Postgres pode nem existir.
        if (authEnv.devBypass) {
            req.user = { ...DEV_BYPASS_USER };
            next();
            return;
        }

        const sub = req.user?.sub;
        if (!sub) {
            // Único 401 deste middleware: aqui falta mesmo IDENTIDADE.
            res.status(401).json({ error: UNAUTHENTICATED });
            return;
        }

        // Default `'provider'` quando ausente: só um harness de teste monta `req.user` à
        // mão. O default seguro é garantido pela guarda de UUID no repositório — uma
        // classificação errada custa 403, nunca 500.
        const scheme: AuthScheme = req.user?.authScheme ?? 'provider';

        await bootstrapAppContainer();
        const cache = container.resolve(AppUserContextCache);
        const key = scheme === 'legacy' ? cache.legacyKeyFor(sub) : sub;

        const cached = cache.get(key);
        if (cached) {
            if (cached.context === null) {
                forbid(req, res, FORBIDDEN_NO_ROW, 'no app_user row (cached)');
                return;
            }
            if (!cached.context.ativo) {
                forbid(req, res, FORBIDDEN_INACTIVE, 'app_user inactive (cached)');
                return;
            }
            applyContext(req, cached.context);
            next();
            return;
        }

        const repository = container.resolve(UserRepository);
        // **O roteamento que torna o rollout reversível** (ADR-0030 §6). O `sub` de um token
        // legado é o username; o de um token do provedor é o UUID do GoTrue. Uma única
        // doutrina de lookup para os dois faz o Postgres recusar `'marilyn@kavex.com'` como
        // sintaxe de UUID — 500 em toda request autenticada, no exato momento em que alguém
        // acionou o botão de emergência.
        const context =
            scheme === 'legacy'
                ? await repository.findContextByUsername(sub)
                : await repository.findByAuthUserId(sub);
        // O `null` é cacheado de propósito: sem isso um token órfão em loop faria um
        // `SELECT` por request — exatamente o cenário que o fail-closed torna comum.
        cache.set(key, context);

        if (context === null) {
            forbid(req, res, FORBIDDEN_NO_ROW, 'no app_user row');
            return;
        }

        if (!context.ativo) {
            const activated = await resolveInactive(sub, scheme, context);
            if (!activated) {
                const revoked = !context.convitePendente;
                forbid(
                    req,
                    res,
                    revoked ? FORBIDDEN_INACTIVE : FORBIDDEN_PENDING_INVITE,
                    revoked ? 'app_user inactive' : 'invite not accepted yet',
                );
                return;
            }
            await repository.markConviteAceito(context.id);
            // Reescreve (em vez de só invalidar) para que o request seguinte não repita nem o
            // SELECT nem a chamada à Admin API.
            cache.set(key, activated);
            applyContext(req, activated);
            next();
            return;
        }

        applyContext(req, context);
        next();
    };
};
