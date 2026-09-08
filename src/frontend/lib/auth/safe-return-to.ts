/**
 * Reduz o `returnTo` da query string a um destino **interno**, ou descarta.
 *
 * `router.replace()` do `next/navigation` aceita URL absoluta e protocol-relative: um
 * `/login?returnTo=https://evil.example/x` mandava o navegador para fora do domínio depois de um
 * login legítimo — open redirect clássico, e um vetor de phishing plausível numa plataforma cujos
 * admins assinam remessa SISPAG e finalizam lote. Quem clica já digitou a senha; a tela falsa do
 * outro lado só precisa pedir "confirme sua senha".
 *
 * Regra: só passa caminho absoluto do próprio app (`^/`, e o segundo caractere não pode abrir
 * autoridade). Tudo o mais cai na raiz — falhar para a home é sempre seguro, e o pior caso é o
 * usuário dar mais um clique.
 */

/** Destino quando o valor recebido não é confiável. A home nunca é alvo de phishing. */
const FALLBACK = '/'

/**
 * `//evil.example` e `/\evil.example` são as duas formas de abrir autoridade sem escrever esquema:
 * a primeira é protocol-relative por especificação, a segunda porque o parser de URL do WHATWG
 * trata `\` como `/` na posição do separador. As duas viram host externo no `router.replace`.
 */
const OPENS_AUTHORITY = /^\/[/\\]/

/**
 * Caracteres de controle (inclusive TAB, LF e CR). O navegador os **remove** antes de resolver a
 * URL, então `/<TAB>/evil.example` passaria por um teste ingênuo de prefixo e sairia do outro lado
 * como `//evil.example`.
 */
const CONTROL_CHARS = /[\u0000-\u001F\u007F]/

export const safeReturnTo = (raw: string | null | undefined): string => {
  if (!raw) return FALLBACK

  const value = raw.trim()

  if (!value.startsWith('/')) return FALLBACK
  if (OPENS_AUTHORITY.test(value)) return FALLBACK
  if (CONTROL_CHARS.test(value)) return FALLBACK
  // `\` em qualquer posição, não só na segunda: `/x\..\..\evil.example` também normaliza.
  if (value.includes('\\')) return FALLBACK
  if (value.includes('://')) return FALLBACK

  return value
}
