import type { RequestHandler } from 'express';
import { conexosRequestContext } from '../domain/libs/requestContext/ConexosRequestContext.js';

/**
 * Middleware de identidade Conexos (Fatia B) — roda APÓS `appUserContext` e envolve o
 * restante da request num `AsyncLocalStorage` com o `platformUsername`, que é o
 * **`app_user.username`** (o e-mail), **nunca o `sub`/UUID do token**. O resolver de sessão
 * lê esse contexto para usar a sessão Conexos do usuário logado; sem usuário, cai no robô.
 *
 * ## Por que este site NÃO usa `auditActor`
 *
 * Porque ele **precisa** do `undefined`. `platformUsername` é uma **chave de junção**
 * (`getVinculoConexos(username)`), não uma coluna de auditoria: a ausência é o que faz cair
 * no robô. Injetar `'unknown'` aqui produziria `getVinculoConexos('unknown')` — um `SELECT`
 * garantidamente vazio **disfarçado de vínculo ausente**. Um fallback é correto para uma
 * coluna de auditoria e errado para uma chave de junção.
 *
 * ## ⚠️ Esta cadeia degrada sem lançar erro
 *
 * Se `platformUsername` deixar de casar com `app_user.username`, `getVinculoConexos` devolve
 * `null` e o sistema **degrada para o usuário-robô**: as baixas `fin010` continuam saindo —
 * atribuídas à máquina. Sem exceção, sem log de erro, sem alarme. É por isso que
 * `GET /me/conexos-status` respondendo como antes da migração é o sinal de QA que importa
 * (`integrations/supabase-auth.md`).
 *
 * Precisa envolver a cadeia inteira (via `run(...)` em volta do `next`) para que
 * as chamadas assíncronas ao ERP, lá adiante, ainda enxerguem o contexto.
 */
export const conexosIdentityMiddleware: RequestHandler = (req, _res, next) => {
    const platformUsername = req.user?.username;
    conexosRequestContext.run(platformUsername ? { platformUsername } : {}, () => next());
};
