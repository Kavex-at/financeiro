import {
  MOTIVO_RETENCAO_MAX,
  detalheRetencao,
  mensagemRemocao,
  paginaDoLote,
  rotuloLote,
} from './retencao'

/**
 * Retenção da formação automática (ADR-0050): o que a linha do título e a lixeira do lote dizem
 * à analista. A regra que importa está no backend; aqui fica o texto — e o texto é o que evita
 * que ela remova um título de um lote automático sem saber que ele fica retido.
 */

describe('rotuloLote', () => {
  it('distingue lote automático de manual', () => {
    expect(rotuloLote({ id: 'L1', automatico: true })).toBe('Lote automático')
    expect(rotuloLote({ id: 'L1', automatico: false })).toBe('Lote manual')
  })
})

describe('detalheRetencao', () => {
  it('traz autor, data e motivo', () => {
    expect(
      detalheRetencao({
        marcadoPor: 'ana@columbia.com',
        marcadoEm: '2026-09-22T15:30:00.000Z',
        motivo: 'fornecedor pediu para segurar',
      }),
    ).toEqual([
      'Retido por ana@columbia.com',
      'Em 22/09/2026 12:30',
      'Motivo: fornecedor pediu para segurar',
    ])
  })

  it('sem motivo, diz que não houve motivo (em vez de omitir a linha)', () => {
    expect(
      detalheRetencao({ marcadoPor: 'ana', marcadoEm: '2026-09-22T15:30:00.000Z' }).at(-1),
    ).toBe('Sem motivo informado')
  })
})

describe('mensagemRemocao', () => {
  it('lote automático: avisa que o título fica retido da formação automática', () => {
    const msg = mensagemRemocao({ automatico: true })
    expect(msg).toContain('não volta a entrar em lote automático')
    expect(msg).toContain('Liberar')
  })

  it('lote manual: sem confirmação (nada muda em relação a hoje)', () => {
    expect(mensagemRemocao({ automatico: false })).toBeNull()
    expect(mensagemRemocao({})).toBeNull()
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

describe('MOTIVO_RETENCAO_MAX', () => {
  it('é o mesmo limite do backend', () => {
    expect(MOTIVO_RETENCAO_MAX).toBe(500)
  })
})
