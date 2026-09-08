/**
 * Feature flags do frontend (lidas das `NEXT_PUBLIC_*`).
 */

/**
 * SISPAG (Frente II) habilitado? `NEXT_PUBLIC_SISPAG_ENABLED=true|false` força;
 * sem a env, fica habilitado só em dev local (`NEXT_PUBLIC_ENV=local`) e
 * bloqueado em qualquer build deployado (fail-safe — esquecer de setar em
 * produção NÃO expõe o SISPAG). Espelha o backend (`SISPAG_ENABLED`).
 */
export const isSispagEnabled = (): boolean => {
  const flag = process.env.NEXT_PUBLIC_SISPAG_ENABLED
  if (flag === 'true') return true
  if (flag === 'false') return false
  return process.env.NEXT_PUBLIC_ENV === 'local'
}

/**
 * A Frente IV (Recebimentos / Gestão de Adiantamentos) NÃO tem flag no frontend:
 * está liberada em produção (ADR-0028). O kill-switch de emergência é só do
 * backend (`RECEBIMENTOS_ENABLED=false` → `recebimentosGate` responde 403), e é
 * deliberado que ele não tenha espelho aqui: uma `NEXT_PUBLIC_*` é assada no
 * build da Vercel, então o espelho só voltaria a valer no próximo deploy — tarde
 * demais para uma emergência. Desligar no Render basta.
 */

/**
 * Modo demonstração. Quando ligado, `fetchGestaoPermutas` volta a cair no
 * `gestaoPermutasFixture` em vez de propagar a falha ou mostrar a carteira
 * vazia — é a rede de segurança do demo, que vivia SEMPRE ligada e agora exige
 * opt-in explícito.
 *
 * Default OFF em todo lugar, `local` inclusive: só a string exata `'true'`
 * liga. Diferente de `isSispagEnabled()`, aqui não há default por ambiente —
 * dado falso na tela nunca é o comportamento desejado por omissão.
 */
export const isDemoMode = (): boolean => process.env.NEXT_PUBLIC_DEMO_MODE === 'true'

/** O único ambiente onde o modo demonstração é tolerável. */
const LOCAL_ENV = 'local'

/**
 * Fail-fast, espelhando `assertAuthEnv()` (`lib/auth/env.ts`). O modo
 * demonstração troca o dado do banco por um fixture com nomes de clientes e
 * valores em USD reais; num sistema onde a analista decide baixa de
 * adiantamento, deployá-lo ligado é da mesma família de erro que deployar sem o
 * gate de autenticação. Um build assim deve ESTOURAR, não subir bonito.
 *
 * Chamado uma vez no carregamento de `lib/api.ts`, que é quem consome o flag.
 */
export const assertDemoEnv = (): void => {
  if (isDemoMode() && process.env.NEXT_PUBLIC_ENV !== LOCAL_ENV) {
    const env = process.env.NEXT_PUBLIC_ENV ?? '(unset)'
    throw new Error(
      `NEXT_PUBLIC_DEMO_MODE must not be enabled outside local ` +
        `(NEXT_PUBLIC_ENV="${env}"). It replaces real portfolio data with a ` +
        `demo fixture and would ship a plausible, false screen. Set ` +
        `NEXT_PUBLIC_ENV=local for demos, or unset NEXT_PUBLIC_DEMO_MODE.`,
    )
  }
}
