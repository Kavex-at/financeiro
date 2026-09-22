/**
 * Download de arquivo vindo do backend — um lugar só.
 *
 * Existia uma cópia deste fluxo em `lib/api.ts` (`exportarRelatorio`, .xlsx) e outra em
 * `lib/sispag.ts` (`baixarRemessa`, CNAB 240). A segunda nasceu lendo o corpo com
 * `res.text()` e regravando num `Blob` — o que corrompe qualquer byte ≥ 0x80 (v0.39.1).
 * Um arquivo binário/latin1 não sobrevive a uma passagem por string: `text()` decodifica
 * sempre como UTF-8 e o `Blob` reencoda em UTF-8. Com o fluxo aqui, quem adicionar o
 * próximo download (GED, retorno Nexxera) herda o caminho certo em vez de reinventá-lo.
 */

/** Extrai o `filename="..."` de um header Content-Disposition (ou undefined). */
export function parseContentDispositionFilename(header: string | null): string | undefined {
  if (!header) return undefined
  const match = /filename="?([^"]+)"?/.exec(header)
  return match?.[1]
}

/**
 * Lê o corpo da resposta como BYTES (`res.blob()`, nunca `res.text()`) e devolve junto o
 * nome anunciado pelo backend.
 *
 * Confere de quebra se o corpo chegou inteiro: se o `Content-Length` anuncia mais bytes do
 * que o blob tem, a resposta foi truncada no caminho (proxy, conexão caindo) e o arquivo
 * sai corrompido do mesmo jeito que saía com o bug de encoding — só que por outra causa, e
 * de novo sem ninguém perceber. A comparação é deliberadamente unilateral: com
 * `Content-Encoding: gzip` o header traz o tamanho COMPRIMIDO, menor que o blob
 * descomprimido, e uma checagem de igualdade reprovaria todo download legítimo.
 * Sem `Content-Length` (resposta chunked, ou header não exposto por CORS) não há o que
 * conferir — a checagem é best-effort e nunca inventa uma falha.
 */
export async function lerArquivoDaResposta(
  res: Response,
  nomePadrao: string,
): Promise<{ nome: string; arquivo: Blob }> {
  const nome = parseContentDispositionFilename(res.headers.get('content-disposition')) ?? nomePadrao
  const arquivo = await res.blob()
  const anunciado = Number(res.headers.get('content-length'))
  if (Number.isFinite(anunciado) && anunciado > 0 && arquivo.size < anunciado) {
    throw new Error(
      `Download incompleto de ${nome}: recebidos ${arquivo.size} de ${anunciado} bytes. Tente de novo.`,
    )
  }
  return { nome, arquivo }
}

/** Entrega o `Blob` ao navegador como download, sem passar por string. */
export function baixarBlob(arquivo: Blob, nome: string): void {
  const url = URL.createObjectURL(arquivo)
  try {
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = nome
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
  } finally {
    // `finally`: um `click()` que lança não pode deixar a URL viva segurando o arquivo
    // inteiro em memória até o reload da página.
    URL.revokeObjectURL(url)
  }
}
