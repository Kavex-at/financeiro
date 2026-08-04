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
 * Recebimentos (Frente IV) habilitado? `NEXT_PUBLIC_RECEBIMENTOS_ENABLED=true|false`
 * força; sem a env, fica habilitado só em dev local (`NEXT_PUBLIC_ENV=local`) e
 * bloqueado em qualquer build deployado (fail-safe — esquecer de setar em produção
 * NÃO expõe a frente). Espelha o backend (`recebimentosGate` / `RECEBIMENTOS_ENABLED`).
 */
export const isRecebimentosEnabled = (): boolean => {
  const flag = process.env.NEXT_PUBLIC_RECEBIMENTOS_ENABLED
  if (flag === 'true') return true
  if (flag === 'false') return false
  return process.env.NEXT_PUBLIC_ENV === 'local'
}
