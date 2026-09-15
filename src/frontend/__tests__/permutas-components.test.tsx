import { fireEvent, render, screen, within } from '@testing-library/react'
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
import {
  ExcecaoManualTag,
  Moeda,
  PermutaBorderoBadge,
  StatusBadge,
} from '@/app/permutas/components/ui'
import { ExcecaoManualDialog } from '@/app/permutas/components/ExcecaoManualDialog'
import { DesfazerExcecaoDialog } from '@/app/permutas/components/DesfazerExcecaoDialog'
import { VisaoGeralTable } from '@/app/permutas/components/VisaoGeralTable'
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

// ─── Exceção manual "permutado fora do painel" (ADR-0047) ─────────────────────
describe('exceção manual — badge e tag', () => {
  it('StatusBadge ja-permutado com o motivo da exceção: "Já permutado" + title da exceção', () => {
    render(<StatusBadge status="ja-permutado" motivo="permutado-fora-do-painel" />)
    const badge = screen.getByText('Já permutado')
    expect(badge).toHaveAttribute('title', 'Permutado fora do painel (exceção manual)')
  })

  it('StatusBadge ja-permutado do ERP mantém o title "Já permutado"', () => {
    render(<StatusBadge status="ja-permutado" motivo="ja-permutado" />)
    expect(screen.getByText('Já permutado')).toHaveAttribute('title', 'Já permutado')
  })

  it('ExcecaoManualTag: ativa → "Exceção manual"; inativa → "Exceção inativa"', () => {
    const { rerender } = render(<ExcecaoManualTag ativa />)
    expect(screen.getByText('Exceção manual')).toBeInTheDocument()
    rerender(<ExcecaoManualTag ativa={false} />)
    expect(screen.getByText('Exceção inativa')).toBeInTheDocument()
    expect(screen.getByText('Exceção inativa')).toHaveAttribute(
      'title',
      expect.stringContaining('vale o estado calculado'),
    )
  })
})

const EXCECAO = {
  justificativa: 'Baixas cruzadas 21 x 198 em 30/04 com a invoice 7329',
  criadoPor: 'user-abc',
  criadoEm: '2026-09-15T14:30:00.000Z',
  ativa: true,
}

const adto8721 = (over: Partial<PermutaPendente> = {}): PermutaPendente => ({
  docCod: '8721',
  filCod: 2,
  referencia: '0013COO/25',
  exportador: 'CODELCO',
  importador: 'COPPER',
  valorMoedaNegociada: 3787086.38,
  moeda: 'USD',
  diasEmAberto: 240,
  status: 'bloqueada',
  motivoBloqueio: 'sem-saldo-permutar',
  detalhe: { priCod: '124', pago: true },
  ...over,
})

describe('ExcecaoManualDialog', () => {
  const abrir = (onConfirmar = jest.fn()) => {
    render(
      <ExcecaoManualDialog
        pendente={adto8721()}
        onClose={() => {}}
        salvando={false}
        onConfirmar={onConfirmar}
      />,
    )
    const campo = screen.getByLabelText(/Justificativa/)
    const confirmar = screen.getByRole('button', { name: /Marcar como permutado/ })
    return { campo, confirmar, onConfirmar }
  }

  it('tem título, descrição e o campo ligado à ajuda e ao contador', () => {
    const { campo } = abrir()
    expect(
      screen.getByRole('dialog', { name: 'Marcar como permutado fora do painel' }),
    ).toBeInTheDocument()
    const descritores = (campo.getAttribute('aria-describedby') ?? '').split(' ')
    expect(descritores).toHaveLength(2)
    for (const idDescritor of descritores) {
      expect(document.getElementById(idDescritor)).not.toBeNull()
    }
  })

  it('confirmar desabilitado com 0–9 caracteres (após trim) e habilitado com 10', () => {
    const { campo, confirmar } = abrir()
    expect(confirmar).toBeDisabled()
    fireEvent.change(campo, { target: { value: '   123456789   ' } })
    expect(confirmar).toBeDisabled()
    fireEvent.change(campo, { target: { value: '1234567890' } })
    expect(confirmar).toBeEnabled()
  })

  it('confirmar desabilitado acima de 500 caracteres', () => {
    const { campo, confirmar } = abrir()
    fireEvent.change(campo, { target: { value: 'x'.repeat(501) } })
    expect(confirmar).toBeDisabled()
    expect(campo).toHaveAttribute('aria-invalid', 'true')
    fireEvent.change(campo, { target: { value: 'x'.repeat(500) } })
    expect(confirmar).toBeEnabled()
  })

  it('onConfirmar recebe o texto com trim', () => {
    const { campo, confirmar, onConfirmar } = abrir()
    fireEvent.change(campo, { target: { value: `  ${EXCECAO.justificativa}  ` } })
    fireEvent.click(confirmar)
    expect(onConfirmar).toHaveBeenCalledWith(EXCECAO.justificativa)
  })
})

describe('DesfazerExcecaoDialog', () => {
  it('mostra justificativa, autor e data; "Cancelar" não chama onConfirmar', () => {
    const onConfirmar = jest.fn()
    const onClose = jest.fn()
    render(
      <DesfazerExcecaoDialog
        pendente={adto8721({
          status: 'ja-permutado',
          motivoBloqueio: 'permutado-fora-do-painel',
          excecaoManual: EXCECAO,
        })}
        onClose={onClose}
        desfazendo={false}
        onConfirmar={onConfirmar}
      />,
    )
    expect(screen.getByText(EXCECAO.justificativa)).toBeInTheDocument()
    expect(screen.getByText('user-abc')).toBeInTheDocument()
    expect(screen.getByText(fmtData(EXCECAO.criadoEm))).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(onConfirmar).not.toHaveBeenCalled()
    expect(onClose).toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: /Desfazer exceção/ }))
    expect(onConfirmar).toHaveBeenCalledTimes(1)
  })
})

describe('VisaoGeralTable — exceção manual na linha expandida', () => {
  const renderLinha = (p: PermutaPendente) => {
    const abrirMarcarExcecao = jest.fn()
    const abrirDesfazerExcecao = jest.fn()
    render(
      <VisaoGeralTable
        vista="adiantamentos"
        filtro="todos"
        listaFiltrada={[p]}
        invoicesPagina={[]}
        pendentesPagina={[p]}
        invoiceListExpandida={null}
        setInvoiceListExpandida={() => {}}
        expandido={p.docCod}
        setExpandido={() => {}}
        invoiceByAdto={new Map()}
        abrirAlocar={() => {}}
        abrirMarcarExcecao={abrirMarcarExcecao}
        abrirDesfazerExcecao={abrirDesfazerExcecao}
        paginaAtual={1}
        totalPaginas={1}
        setPagina={() => {}}
      />,
    )
    return { abrirMarcarExcecao, abrirDesfazerExcecao }
  }

  it('bloqueada/sem-saldo-permutar mostra "Marcar como permutado fora do painel"', () => {
    const p = adto8721()
    const { abrirMarcarExcecao } = renderLinha(p)
    fireEvent.click(screen.getByRole('button', { name: 'Marcar como permutado fora do painel' }))
    expect(abrirMarcarExcecao).toHaveBeenCalledWith(p)
    expect(screen.queryByRole('button', { name: /Desfazer exceção/ })).toBeNull()
  })

  it('bloqueada/nao-pago NÃO mostra a ação de marcar', () => {
    renderLinha(adto8721({ motivoBloqueio: 'nao-pago' }))
    expect(screen.queryByRole('button', { name: /permutado fora do painel/ })).toBeNull()
  })

  it('linha com exceção mostra tag, detalhe (justificativa/autor/data) e "Desfazer exceção"', () => {
    const p = adto8721({
      status: 'ja-permutado',
      motivoBloqueio: 'permutado-fora-do-painel',
      excecaoManual: EXCECAO,
    })
    const { abrirDesfazerExcecao } = renderLinha(p)
    expect(screen.getAllByText('Exceção manual').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText(EXCECAO.justificativa)).toBeInTheDocument()
    expect(screen.getByText('user-abc')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Marcar como permutado/ })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /Desfazer exceção/ }))
    expect(abrirDesfazerExcecao).toHaveBeenCalledWith(p)
  })

  it('exceção inativa avisa que não foi aplicada e ainda permite desfazer', () => {
    renderLinha(
      adto8721({
        status: 'permuta-manual',
        motivoBloqueio: 'cliente-filtro',
        excecaoManual: { ...EXCECAO, ativa: false },
      }),
    )
    expect(screen.getAllByText('Exceção inativa').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText(/Não aplicada/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Desfazer exceção/ })).toBeInTheDocument()
  })
})
