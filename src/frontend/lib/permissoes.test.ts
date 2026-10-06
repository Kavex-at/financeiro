import { CATALOGO_PERMISSOES, MODULOS, PERMISSAO, rotuloPermissao } from '@/lib/permissoes'

describe('MODULOS (rótulos de permissão compartilhados)', () => {
  it('cobre as 12 permissões do catálogo, cada uma uma vez', () => {
    const todas = MODULOS.flatMap((m) => m.itens.map((i) => i.permissao))
    expect(todas).toHaveLength(12)
    expect(new Set(todas)).toEqual(new Set(CATALOGO_PERMISSOES))
  })

  it('a Frente IV se chama "Adiantamentos" (o rótulo do nav)', () => {
    const modulo = MODULOS.find((m) => m.itens.some((i) => i.permissao === PERMISSAO.RECEBIMENTOS_VER))
    expect(modulo?.nome).toBe('Adiantamentos')
  })

  it('rótulo legível de uma permissão: módulo + ação', () => {
    expect(rotuloPermissao(PERMISSAO.SISPAG_EXCECAO)).toBe('SISPAG — exceção de destino')
    expect(rotuloPermissao(PERMISSAO.PERMUTAS_EXECUTAR)).toBe('Permutas — executar')
    // ADR-0063
    expect(rotuloPermissao(PERMISSAO.SISPAG_CONFERIR)).toBe('SISPAG — conferir')
    expect(rotuloPermissao(PERMISSAO.SISPAG_CADASTRO)).toBe('SISPAG — pendências de cadastro')
  })
})
