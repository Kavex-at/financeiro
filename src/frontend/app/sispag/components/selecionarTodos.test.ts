import type { TituloAPagar } from '@/lib/sispag'
import {
  MOTIVO_VARIAS_FILIAIS,
  alternarTodos,
  chaveTitulo,
  estadoSelecionarTodos,
  filtrarComoAba,
} from './selecionarTodos'

const titulo = (over: Partial<TituloAPagar> = {}): TituloAPagar => ({
  filCod: 2,
  docCod: '100',
  titCod: '1',
  valor: 10,
  liberado: true,
  pago: false,
  ...over,
})

describe('estadoSelecionarTodos / alternarTodos', () => {
  const a = titulo({ docCod: '1' })
  const b = titulo({ docCod: '2', loteRascunho: { id: 'L', automatico: true } })
  const travado = titulo({ docCod: '3', loteComprometido: { id: 'F', status: 'FINALIZADO' } })

  it('nada marcado → marca todas as selecionáveis do filtro (pula lote comprometido)', () => {
    const estado = estadoSelecionarTodos([a, b, travado], new Set())
    expect(estado.marcado).toBe(false)
    expect(estado.bloqueio).toBeUndefined()
    expect([...alternarTodos(estado, new Set())].sort()).toEqual([chaveTitulo(a), chaveTitulo(b)])
  })

  it('parte marcada → indeterminado; o clique limpa as linhas do filtro e preserva o resto', () => {
    const fora = 'x:outro:1'
    const sel = new Set([chaveTitulo(a), fora])
    const estado = estadoSelecionarTodos([a, b], sel)
    expect(estado.marcado).toBe('indeterminate')
    expect([...alternarTodos(estado, sel)]).toEqual([fora])
  })

  it('tudo marcado → marcado; o clique desmarca', () => {
    const sel = new Set([chaveTitulo(a), chaveTitulo(b)])
    const estado = estadoSelecionarTodos([a, b, travado], sel)
    expect(estado.marcado).toBe(true)
    expect(alternarTodos(estado, sel).size).toBe(0)
  })

  it('selecionáveis de mais de uma filial → desabilitado com o motivo', () => {
    const estado = estadoSelecionarTodos([a, titulo({ docCod: '9', filCod: 4 })], new Set())
    expect(estado.bloqueio).toBe(MOTIVO_VARIAS_FILIAIS)
    expect(alternarTodos(estado, new Set()).size).toBe(0)
  })

  it('outra filial só em linha travada não bloqueia', () => {
    const travadoOutra = titulo({
      filCod: 4,
      loteComprometido: { id: 'R', status: 'REMESSA_GERADA' },
    })
    expect(estadoSelecionarTodos([a, travadoOutra], new Set()).bloqueio).toBeUndefined()
  })

  it('nenhuma selecionável → desabilitado', () => {
    expect(estadoSelecionarTodos([travado], new Set()).bloqueio).toBeDefined()
  })
})

describe('filtrarComoAba', () => {
  const itens = [
    titulo({ docCod: '1', credor: 'ACME' }),
    titulo({ docCod: '2', credor: 'Beta', filCod: 4 }),
  ]
  const texto = (t: TituloAPagar) => `${t.credor ?? ''} ${t.docCod}/${t.titCod}`

  it('aplica filial e busca como o hook da aba', () => {
    expect(filtrarComoAba(itens, { filial: 'todas', busca: '' }, texto)).toHaveLength(2)
    expect(filtrarComoAba(itens, { filial: '4', busca: '' }, texto).map((t) => t.docCod)).toEqual([
      '2',
    ])
    expect(filtrarComoAba(itens, { filial: 'todas', busca: ' acme ' }, texto)).toHaveLength(1)
  })
})
