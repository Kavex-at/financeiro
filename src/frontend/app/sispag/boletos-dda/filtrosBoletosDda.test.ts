import type { BoletosDdaResposta } from '@/lib/sispag'
import {
  alternarSituacaoConferir,
  descreverFiltrosDda,
  FILTROS_DDA_VAZIOS,
  filtroDoServidor,
  haFiltroDda,
  segmentoDe,
  somaTotais,
  textosDe,
  totalDe,
  urgentesAtivo,
} from './filtrosBoletosDda'

const vazio = FILTROS_DDA_VAZIOS

describe('filtrosBoletosDda', () => {
  it('sem filtro, o pedido é só escopo + página + 25', () => {
    expect(filtroDoServidor(vazio, textosDe(vazio), 1, null)).toEqual({
      escopo: 'a-vencer',
      pagina: 1,
      tamanho: 25,
    })
  })

  it('valor vazio ou inválido não vai; vírgula vira ponto', () => {
    const f = { ...vazio, valorMin: '10,5', valorMax: 'abc' }
    expect(filtroDoServidor(f, textosDe(f), 1, null)).toEqual({
      escopo: 'a-vencer',
      pagina: 1,
      tamanho: 25,
      valorMin: 10.5,
    })
  })

  it('segmento é derivado das situações (um só estado)', () => {
    expect(segmentoDe([])).toBe('todos')
    expect(segmentoDe(['VINCULADO'])).toBe('casados')
    expect(segmentoDe(['CANDIDATO', 'AMBIGUO'])).toBe('conferir')
    expect(segmentoDe(['AMBIGUO'])).toBe('conferir')
    expect(segmentoDe(['SEM_TITULO'])).toBe('sem-titulo')
    expect(segmentoDe(['VINCULADO', 'SEM_TITULO'])).toBeUndefined()
  })

  it('chips de Para conferir: marcar restringe, desmarcar volta aos dois', () => {
    expect(alternarSituacaoConferir(['CANDIDATO', 'AMBIGUO'], 'CANDIDATO')).toEqual(['CANDIDATO'])
    expect(alternarSituacaoConferir(['CANDIDATO'], 'CANDIDATO')).toEqual(['CANDIDATO', 'AMBIGUO'])
    expect(alternarSituacaoConferir(['CANDIDATO'], 'AMBIGUO')).toEqual(['CANDIDATO', 'AMBIGUO'])
  })

  it('urgentes = hoje + 1–2 dias e as três situações não casadas', () => {
    expect(
      urgentesAtivo({
        ...vazio,
        faixas: ['1-2', 'HOJE'],
        situacoes: ['SEM_TITULO', 'CANDIDATO', 'AMBIGUO'],
      }),
    ).toBe(true)
    expect(urgentesAtivo({ ...vazio, faixas: ['HOJE'] })).toBe(false)
  })

  it('etiquetas: colunas sim; segmento puro não; combinação sem segmento sim', () => {
    expect(descreverFiltrosDda({ ...vazio, situacoes: ['VINCULADO'] })).toEqual([])
    expect(
      descreverFiltrosDda({ ...vazio, situacoes: ['VINCULADO', 'SEM_TITULO'], filiais: [1, 'sem'] }).map(
        (e) => e.texto,
      ),
    ).toEqual(['Filial 1, sem filial', 'Situação: casado, sem título'])
    expect(haFiltroDda({ ...vazio, emGrupo: true })).toBe(true)
    expect(haFiltroDda({ ...vazio, escopo: 'todos' })).toBe(false)
  })

  it('totais: usa `totais` do servidor; backend antigo cai na contagem, sem R$', () => {
    const contagem = { todas: 3, VINCULADO: 1, CANDIDATO: 2, AMBIGUO: 0, SEM_TITULO: 0, emGrupo: 0 }
    const antigo = { contagem } as unknown as BoletosDdaResposta
    expect(totalDe(antigo, 'CANDIDATO')).toEqual({ qtd: 2 })
    expect(totalDe(antigo, 'urgentes')).toEqual({})
    expect(somaTotais({ qtd: 1, valor: 0.1 }, { qtd: 2, valor: 0.2 })).toEqual({ qtd: 3, valor: 0.3 })
    expect(somaTotais({ qtd: 1 }, { qtd: 2, valor: 1 })).toEqual({ qtd: 3 })
  })
})
