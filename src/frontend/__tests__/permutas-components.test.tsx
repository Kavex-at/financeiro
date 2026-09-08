import { render, screen, within } from '@testing-library/react'
import type { ItemHistorico } from '@/app/permutas/components/format'
import {
  fmtData,
  fmtMoeda,
  fmtTaxa,
  maskBrl,
  moedaCodigo,
  numToMask,
  parseBrl,
  somaPorMoeda,
} from '@/app/permutas/components/format'
import { Moeda, PermutaBorderoBadge } from '@/app/permutas/components/ui'
import { PermutaPendenteTable } from '@/app/permutas/components/PermutaPendenteTable'
import { AbaHistorico } from '@/app/permutas/components/AbaHistorico'
import type { PermutaPendente } from '@/lib/types'
import { useTabelaFiltro } from '@/app/permutas/components/tabela-filtro'

// Pure helpers extracted from the god-component during the CC-1 split.
describe('permutas format helpers', () => {
  it('moedaCodigo encurta nomes longos do Conexos', () => {
    expect(moedaCodigo('DOLAR DOS EUA')).toBe('USD')
    expect(moedaCodigo('EURO/COM.EUROPEIA')).toBe('EUR')
    expect(moedaCodigo('USD')).toBe('USD') // já curto → passthrough
  })

  it('parseBrl interpreta milhar (.) e decimal (,) pt-BR', () => {
    expect(parseBrl('5.557,42')).toBe(5557.42)
    expect(parseBrl('5000')).toBe(5000)
  })

  it('maskBrl lê dígitos como centavos', () => {
    expect(maskBrl('4336604')).toBe('43.366,04')
    expect(maskBrl('')).toBe('')
  })

  it('numToMask converte número para a string mascarada', () => {
    expect(numToMask(43366.04)).toBe('43.366,04')
  })

  it('fmtData/fmtTaxa formatam com fallback', () => {
    expect(fmtData(undefined)).toBe('—')
    expect(fmtTaxa(5.5)).toContain('5,5')
  })

  it('fmtMoeda cai no fallback quando a moeda não é ISO', () => {
    expect(fmtMoeda(1234, 'XYZ')).toContain('XYZ')
  })

  it('somaPorMoeda agrupa por moeda e coloca USD na frente', () => {
    const totais = somaPorMoeda([
      { valorMoedaNegociada: 100, moeda: 'EURO/COM.EUROPEIA' },
      { valorMoedaNegociada: 200, moeda: 'DOLAR DOS EUA' },
      { valorMoedaNegociada: null, moeda: 'DOLAR DOS EUA' },
    ])
    expect(totais[0]).toEqual({ moeda: 'USD', total: 200 })
    expect(totais).toContainEqual({ moeda: 'EUR', total: 100 })
  })
})

describe('Moeda', () => {
  it('mostra valor + código da moeda', () => {
    render(<Moeda valor={1234.5} moeda="DOLAR DOS EUA" />)
    expect(screen.getByText('USD')).toBeInTheDocument()
  })

  it('mostra travessão quando valor é null', () => {
    render(<Moeda valor={null} moeda="USD" />)
    expect(screen.getByText('—')).toBeInTheDocument()
  })
})

function makePendente(over: Partial<PermutaPendente> = {}): PermutaPendente {
  return {
    docCod: 'ADTO-1',
    filCod: 4,
    referencia: 'REF',
    exportador: 'ACME LTDA',
    valorMoedaNegociada: 1000,
    moeda: 'USD',
    diasEmAberto: 3,
    status: 'permuta-manual',
    saldoRestante: 1000,
    alocacoes: [],
    ...over,
  }
}

describe('PermutaPendenteTable', () => {
  it('mostra o estado-vazio sem itens', () => {
    render(
      <PermutaPendenteTable
        list={[]}
        statusPorAdto={{}}
        abrirAlocar={() => {}}
        abrirReconciliar={() => {}}
      />,
    )
    expect(screen.getByText('Nenhuma permuta cross-process')).toBeInTheDocument()
  })

  it('desabilita "Baixar" quando não há alocações e mantém "Alocar" habilitado com saldo', () => {
    render(
      <PermutaPendenteTable
        list={[makePendente()]}
        statusPorAdto={{}}
        abrirAlocar={() => {}}
        abrirReconciliar={() => {}}
      />,
    )
    expect(screen.getByText('ADTO-1')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Baixar/ })).toBeDisabled()
    expect(screen.getByRole('button', { name: /Alocar/ })).toBeEnabled()
  })

  it('desabilita "Alocar" quando totalmente alocado sem alocações para gerenciar', () => {
    render(
      <PermutaPendenteTable
        list={[makePendente({ saldoRestante: 0, alocacoes: [] })]}
        statusPorAdto={{}}
        abrirAlocar={() => {}}
        abrirReconciliar={() => {}}
      />,
    )
    expect(screen.getByRole('button', { name: /Alocar/ })).toBeDisabled()
  })

  // A data do adto é a única âncora de idade do PRÓPRIO adiantamento — "Dias em
  // Aberto" (só na Visão Geral) é ancorada na data-base da D.I/DUIMP e fica vazia
  // nos cross-process sem declaração. Meio-dia UTC no fixture evita a virada de
  // dia do `fmtData` em qualquer fuso.
  it('mostra a data de emissão do adiantamento vinda do detalhe', () => {
    render(
      <PermutaPendenteTable
        list={[
          makePendente({
            detalhe: { priCod: 'PRI-1', pago: true, dataEmissao: '2026-03-01T12:00:00.000Z' },
          }),
        ]}
        statusPorAdto={{}}
        abrirAlocar={() => {}}
        abrirReconciliar={() => {}}
      />,
    )
    expect(screen.getByRole('columnheader', { name: 'Data adto' })).toBeInTheDocument()
    const linha = screen.getByRole('row', { name: /ADTO-1/ })
    expect(within(linha).getByText('01/03/2026')).toBeInTheDocument()
  })

  it('cai no travessão quando o adiantamento não tem data de emissão', () => {
    render(
      <PermutaPendenteTable
        list={[makePendente()]} // sem `detalhe`
        statusPorAdto={{}}
        abrirAlocar={() => {}}
        abrirReconciliar={() => {}}
      />,
    )
    const linha = screen.getByRole('row', { name: /ADTO-1/ })
    expect(within(linha).getByText('—')).toBeInTheDocument()
  })
})

// Wrapper para exercitar a aba (que recebe o resultado do hook useTabelaFiltro).
function HistoricoHarness({ items }: { items: ItemHistorico[] }) {
  const aba = useTabelaFiltro(
    items,
    (h) => h.filCod,
    (h) => h.busca,
  )
  return <AbaHistorico aba={aba} loading={false} onAtualizar={() => {}} />
}

describe('AbaHistorico', () => {
  it('mostra o estado-vazio sem histórico', () => {
    render(<HistoricoHarness items={[]} />)
    expect(screen.getByText('Nada no histórico ainda')).toBeInTheDocument()
  })

  it('lista uma permuta executada', () => {
    const item: ItemHistorico = {
      key: 'auto-ADTO-1-77',
      tipo: 'Automática',
      filCod: 4,
      priCod: '523',
      cliente: 'CLIENTE X',
      exportador: 'ACME',
      adtoDocCod: 'ADTO-1',
      valor: 1000,
      moeda: 'USD',
      borCod: 77,
      finalizado: true,
      busca: '523 CLIENTE X ADTO-1 77',
    }
    render(<HistoricoHarness items={[item]} />)
    expect(screen.getByText('523')).toBeInTheDocument()
    expect(screen.getByText('Finalizado')).toBeInTheDocument()
  })
})


/**
 * C-6 — o badge era a única porta pela qual o estado novo podia entrar e sair parecendo o antigo.
 * O `typecheck` NÃO pega isso: um `else` guarda-chuva continua sendo código válido. Este teste é a
 * guarda, e por isso ele cobre os QUATRO casos (os três valores + a ausência de vínculo), cada um
 * assertando um texto distinto.
 */
describe('PermutaBorderoBadge — os três estados + pendente têm textos distintos (C-6)', () => {
  const textos = new Set<string>()

  it('sem vínculo → Pendente', () => {
    const { container } = render(<PermutaBorderoBadge />)
    expect(screen.getByText('Pendente')).toBeInTheDocument()
    textos.add(container.textContent ?? '')
  })

  it('aguardando-finalizacao → "Aguardando finalização" + nº do borderô', () => {
    const { container } = render(
      <PermutaBorderoBadge
        vinculo={{ borCod: 14735, permutaStatus: 'aguardando-finalizacao', situacao: 'EM_CADASTRO' }}
      />,
    )
    expect(screen.getByText(/Aguardando finalização · borderô 14735/)).toBeInTheDocument()
    expect(container.textContent).not.toMatch(/parcial|resíduo/i)
    textos.add(container.textContent ?? '')
  })

  it('parcial-aguardando-finalizacao → texto PRÓPRIO, dizendo que há resíduo a re-alocar', () => {
    const { container } = render(
      <PermutaBorderoBadge
        vinculo={{
          borCod: 14735,
          permutaStatus: 'parcial-aguardando-finalizacao',
          situacao: 'EM_CADASTRO',
        }}
      />,
    )
    expect(screen.getByText(/Baixa parcial/)).toBeInTheDocument()
    expect(screen.getByText(/resíduo a re-alocar/)).toBeInTheDocument()
    expect(screen.getByText(/borderô 14735/)).toBeInTheDocument()
    // NÃO pode ser renderizado como o estado antigo — este é literalmente o defeito C-6.
    expect(container.textContent).not.toMatch(/^Aguardando finalização/)
    textos.add(container.textContent ?? '')
  })

  it('finalizado → "Finalizado"', () => {
    const { container } = render(
      <PermutaBorderoBadge
        vinculo={{ borCod: 14735, permutaStatus: 'finalizado', situacao: 'FINALIZADO' }}
      />,
    )
    expect(screen.getByText(/Finalizado · borderô 14735/)).toBeInTheDocument()
    textos.add(container.textContent ?? '')
    // Os quatro renders produziram quatro textos DIFERENTES.
    expect(textos.size).toBe(4)
  })
})
