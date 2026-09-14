import { act, render, screen } from '@testing-library/react'
import MetricasPage from '@/app/metricas/page'
import { type MetricasCicloLeitura, fetchMetricasCiclo } from '@/lib/metricas'

jest.mock('@/lib/metricas', () => {
  const real = jest.requireActual('@/lib/metricas')
  return { ...real, fetchMetricasCiclo: jest.fn() }
})

const base = {
  baseline: null,
  baseline_desc: 'sem medição do processo manual',
}

const leituraFake: MetricasCicloLeitura = {
  serieInicio: '2026-09-11T20:00:00',
  metricas: [
    {
      ...base,
      frente: 'Permutas (Frente I)',
      metrica: 'permutas_baixas_concluidas_pct',
      rotulo: 'baixas de adiantamento concluídas, com borderô finalizado — 12 de 13 tentativas',
      valor: 92.3,
      unidade: '%',
      janela_inicio: '2026-09-18T20:00:00',
      janela_fim: '2026-09-25T20:00:00',
    },
    {
      ...base,
      frente: 'Permutas (Frente I)',
      metrica: 'permutas_valor_baixado',
      rotulo: 'valor baixado em permutas de adiantamento',
      valor: 1283986.92,
      unidade: 'R$',
      janela_inicio: '2026-09-18T20:00:00',
      janela_fim: '2026-09-25T20:00:00',
    },
    {
      ...base,
      frente: 'Conciliação de Recebimentos (Frente IV)',
      metrica: 'recebimentos_valor_alocado',
      rotulo: 'valor de créditos de cliente alocados',
      valor: 0,
      unidade: 'R$',
      janela_inicio: '2026-09-18T20:00:00',
      janela_fim: '2026-09-25T20:00:00',
    },
    {
      ...base,
      frente: 'Permutas (Frente I)',
      metrica: 'permutas_valor_baixado',
      rotulo: 'valor baixado em permutas de adiantamento',
      valor: 500,
      unidade: 'R$',
      janela_inicio: '2026-09-11T20:00:00',
      janela_fim: '2026-09-18T20:00:00',
    },
  ],
}

const renderPagina = async () => {
  await act(async () => {
    render(<MetricasPage />)
  })
}

describe('MetricasPage', () => {
  beforeEach(() => {
    ;(fetchMetricasCiclo as jest.Mock).mockResolvedValue(leituraFake)
  })

  it('mostra a semana fechada mais recente nos KPIs', async () => {
    await renderPagina()

    expect(screen.getByRole('heading', { name: /Semana de 18\/09 a 25\/09\/2026/ })).toBeInTheDocument()
    expect(screen.getAllByText('92,3%').length).toBeGreaterThan(0)
  })

  it('o percentual nunca aparece sem o absoluto', async () => {
    await renderPagina()

    expect(screen.getAllByText('12 de 13 tentativas').length).toBeGreaterThan(0)
  })

  it('semana sem tentativa em adiantamentos mostra travessão, não 0%', async () => {
    await renderPagina()

    expect(screen.getAllByText('sem tentativas na semana').length).toBeGreaterThan(0)
    expect(screen.queryByText('0,0%')).not.toBeInTheDocument()
  })

  it('lista todas as semanas no histórico e diz quando a série começou', async () => {
    await renderPagina()

    const tabela = screen.getByRole('table', { name: 'Métricas por semana' })
    expect(tabela.querySelectorAll('tbody tr')).toHaveLength(2)
    expect(screen.getByText(/Série iniciada em 11\/09\/2026/)).toBeInTheDocument()
  })

  it('antes da primeira semana fechar, diz isso em vez de mostrar zeros', async () => {
    ;(fetchMetricasCiclo as jest.Mock).mockResolvedValue({ serieInicio: '2026-09-11T20:00:00', metricas: [] })

    await renderPagina()

    expect(screen.getByText('Nenhuma semana fechada ainda')).toBeInTheDocument()
    expect(screen.getByText(/A série começou em 11\/09\/2026/)).toBeInTheDocument()
  })

  it('quando a leitura falha, diz que falhou', async () => {
    ;(fetchMetricasCiclo as jest.Mock).mockRejectedValue(new Error('Falha ao carregar as métricas (HTTP 500).'))

    await renderPagina()

    expect(screen.getByText('Não foi possível carregar')).toBeInTheDocument()
  })
})
