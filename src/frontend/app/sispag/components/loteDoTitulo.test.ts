import type { LotePagamento } from '@/lib/sispag'
import { paginaDoLote, rotuloLote, textoBuscaLote } from './loteDoTitulo'

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

describe('textoBuscaLote', () => {
  const lote = {
    id: 'L1',
    filCod: 2,
    criadoPor: 'ana',
    itens: [
      { loteId: 'L1', filCod: 2, docCod: '813', titCod: '1', credor: 'ACME', incluidoPor: 'ana' },
      { loteId: 'L1', filCod: 2, docCod: '9001', titCod: '3', incluidoPor: 'ana' },
    ],
  } as unknown as LotePagamento

  it('traz o documento de cada título como na aba de títulos (docCod/titCod)', () => {
    const texto = textoBuscaLote(lote)
    expect(texto).toContain('813/1')
    expect(texto).toContain('9001/3')
  })

  it('mantém filial, autor e credor', () => {
    const texto = textoBuscaLote(lote)
    expect(texto).toContain('2')
    expect(texto).toContain('ana')
    expect(texto).toContain('ACME')
  })
})
