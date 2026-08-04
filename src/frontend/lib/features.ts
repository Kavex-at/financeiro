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
