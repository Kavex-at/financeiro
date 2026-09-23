import { paginaDoLote, rotuloLote } from './loteDoTitulo'

describe('rotuloLote', () => {
  it('distingue lote automático de manual', () => {
    expect(rotuloLote({ id: 'L1', automatico: true })).toBe('Lote automático')
    expect(rotuloLote({ id: 'L1', automatico: false })).toBe('Lote manual')
  })
})

describe('paginaDoLote', () => {
  const ids = ['a', 'b', 'c', 'd', 'e']

  it('devolve a página (1-based) em que o lote aparece', () => {
    expect(paginaDoLote(ids, 'a', 2)).toBe(1)
    expect(paginaDoLote(ids, 'c', 2)).toBe(2)
    expect(paginaDoLote(ids, 'e', 2)).toBe(3)
  })

  it('lote fora da lista → null (a tela avisa em vez de rolar para o nada)', () => {
    expect(paginaDoLote(ids, 'z', 2)).toBeNull()
  })
})
