import { safeReturnTo } from '@/lib/auth/safe-return-to'

/**
 * `safeReturnTo` é o único ponto entre a query string e o `router.replace` da tela de login
 * (`app/login/page.tsx`). O que este teste trava é a lista de formas de escrever "host externo"
 * sem escrever `https://` — é aí que um teste ingênuo de prefixo (`startsWith('/')`) passa e o
 * navegador sai do domínio mesmo assim.
 */
describe('safeReturnTo', () => {
  describe('deixa passar destino interno', () => {
    it.each([
      ['/', '/'],
      ['/permutas', '/permutas'],
      ['/permutas/borderos', '/permutas/borderos'],
      ['/recebimentos?filial=3&status=aberto', '/recebimentos?filial=3&status=aberto'],
      ['/sispag#lote-12', '/sispag#lote-12'],
      // `@` no caminho é caminho, não credencial: só vira autoridade depois de `//`.
      ['/usuarios/a@b.com', '/usuarios/a@b.com'],
      // Espaço em volta é do transporte, não da intenção.
      ['  /operacao  ', '/operacao'],
    ])('%s → %s', (raw, esperado) => {
      expect(safeReturnTo(raw)).toBe(esperado)
    })
  })

  describe('cai na home quando o valor abriria autoridade externa', () => {
    it.each([
      // Absoluto com esquema — o caso óbvio.
      'https://evil.example/x',
      'http://evil.example',
      'javascript:alert(1)',
      // Protocol-relative: sem esquema, mas o navegador herda o da página.
      '//evil.example',
      '//evil.example/permutas',
      // `\` no lugar do separador: o parser do WHATWG normaliza para `/`.
      '/\\evil.example',
      '\\\\evil.example',
      '/permutas\\..\\..\\evil.example',
      // Controle no meio: o navegador remove o TAB e sobra `//evil.example`.
      '/\t/evil.example',
      '/\n/evil.example',
      '/\r/evil.example',
      // Esquema embutido depois de um prefixo que parece interno.
      '/redirect?to=https://evil.example',
      // Relativo — sem `/` inicial resolve contra a rota atual, e não é o contrato.
      'permutas',
      '../permutas',
    ])('%j → /', (raw) => {
      expect(safeReturnTo(raw)).toBe('/')
    })
  })

  describe('cai na home quando não há valor', () => {
    it.each([[null], [undefined], [''], ['   ']])('%j → /', (raw) => {
      expect(safeReturnTo(raw)).toBe('/')
    })
  })
})
