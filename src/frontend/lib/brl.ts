/**
 * Helpers de valor monetário pt-BR (milhar `.` / centavos `,`).
 *
 * Fonte ÚNICA compartilhada — `app/permutas/components/format.ts` e o modal de
 * Recebimentos re-importam daqui. Não duplicar máscara/parse em feature code.
 */

/** Parse de valor digitado em pt-BR ("5.557,42" → 5557.42). Ponto = milhar,
 * vírgula = decimal. Sem vírgula, aceita o número como veio (ex.: "5000"). */
export const parseBrl = (s: string): number => {
  const t = s.trim()
  return t.includes(',') ? Number(t.replace(/\./g, '').replace(',', '.')) : Number(t)
}

/** Máscara monetária pt-BR no estilo "centavos": os dígitos digitados são lidos como
 * centavos e formatados com milhar (.) + decimais (,). Ex.: "4336604" → "43.366,04". */
export const maskBrl = (raw: string): string => {
  const digits = raw.replace(/\D/g, '').replace(/^0+(?=\d)/, '')
  if (digits === '') return ''
  return (Number(digits) / 100).toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

/** Converte um número (ex.: saldo) para a string mascarada pt-BR ("43.366,04"). */
export const numToMask = (n: number): string => maskBrl(String(Math.round(n * 100)))
