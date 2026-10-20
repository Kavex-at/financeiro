import { TITULOS_FIXTURE } from '../__fixtures__/situacaoPagamento'
import { descreverFiltros, opcoesDosFiltros } from './filtrosAtivos'
import { FILTROS_VAZIOS } from './situacaoTitulos'

describe('descreverFiltros', () => {
  it('sem filtro de coluna: nenhuma etiqueta (o estado externo tem barra própria)', () => {
    expect(descreverFiltros({ ...FILTROS_VAZIOS, estado: 'bloqueados' })).toEqual([])
  })

  it('uma etiqueta por coluna, cada uma com o que zerar', () => {
    const f = {
      ...FILTROS_VAZIOS,
      credor: 'ceva',
      valorMin: '1000',
      valorMax: '20000',
      faixas: ['HOJE' as const],
      vencDe: '2026-10-20',
      situacoes: ['PRONTO' as const, 'VENCIDO' as const],
      donos: ['VOCE' as const],
      filiais: [1, 7],
    }
    const e = descreverFiltros(f)
    expect(e.map((x) => x.id)).toEqual(['credor', 'valor', 'faixas', 'periodo', 'situacoes', 'donos', 'filiais'])
    expect(e.find((x) => x.id === 'valor')?.texto).toBe('Valor de R$ 1.000 até R$ 20.000')
    expect(e.find((x) => x.id === 'periodo')?.texto).toBe('Vencimento de 20/10/2026')
    expect(e.find((x) => x.id === 'situacoes')?.texto).toBe('Situação: pronto, vencido')
    expect(e.find((x) => x.id === 'valor')?.remover).toEqual({ valorMin: '', valorMax: '' })
  })
})

describe('opcoesDosFiltros', () => {
  const o = opcoesDosFiltros(TITULOS_FIXTURE)

  it('situação: Pronto primeiro, motivos na ordem do contrato, só os presentes', () => {
    expect(o.situacoes[0]).toMatchObject({ valor: 'PRONTO', total: 9 })
    expect(o.situacoes.map((s) => s.valor)).toEqual([
      'PRONTO',
      'ALCADA',
      'TIPO_PERMUTA',
      'VENCIDO',
      'FORMA_NAO_SISPAG',
      'DUPLICIDADE',
      'AJUSTE_CENTAVOS_PENDENTE',
      'BOLETO_SEM_DDA',
    ])
  })

  it('formas: boleto com DDA antes de boleto sem DDA; título sem forma vira "sem forma"', () => {
    const chaves = o.formas.map((f) => f.valor)
    expect(chaves.indexOf('boleto-com-dda')).toBeLessThan(chaves.indexOf('boleto-sem-dda'))
    expect(chaves.at(-1)).toBe('sem-forma')
  })

  it('filiais ordenadas, donos com contagem', () => {
    expect(o.filiais.map((f) => f.valor)).toEqual([1, 3, 7])
    expect(o.donos.find((d) => d.valor === 'APROVADOR')?.total).toBe(1)
  })
})
