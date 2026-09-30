import { act, render, screen } from '@testing-library/react'
import MetricasPage from '@/app/metricas/page'
import { type MetricaCiclo, type MetricasCicloLeitura, fetchMetricasCiclo } from '@/lib/metricas'

jest.mock('@/lib/metricas', () => {
  const real = jest.requireActual('@/lib/metricas')
  return { ...real, fetchMetricasCiclo: jest.fn() }
})

// Quem chega à tela tem `metricas:ver` (o guard de página tem teste próprio, ADR-0053).
jest.mock('@/lib/auth/PermissoesProvider', () => ({
  usePermissoes: () => ({ carregando: false, tem: () => true }),
}))

const linha = (over: Partial<MetricaCiclo>): MetricaCiclo => ({
  frente: 'Permutas (Frente I)',
  metrica: 'permutas_valor_baixado',
  rotulo: 'valor baixado em permutas de adiantamento',
  valor: 0,
  unidade: 'R$',
  janela_inicio: '2026-09-18T18:00:00',
  janela_fim: '2026-09-25T18:00:00',
  baseline: null,
  baseline_desc: 'sem medição do processo manual',
  parcial: false,
  apurado_ate: '2026-09-25T18:00:00',
  ...over,
})

const EM_CURSO = {
  janela_inicio: '2026-09-25T18:00:00',
  janela_fim: '2026-10-02T18:00:00',
  parcial: true,
  apurado_ate: '2026-10-02T15:02:00',
}

const leituraFake: MetricasCicloLeitura = {
  serieInicio: '2026-09-11T18:00:00',
  metricas: [
    linha({ ...EM_CURSO, valor: 70 }),
    linha({
      metrica: 'permutas_baixas_concluidas_pct',
      rotulo: 'baixas de adiantamento concluídas, com borderô finalizado — 12 de 13 tentativas',
      valor: 92.3,
      unidade: '%',
    }),
    linha({ valor: 1283986.92 }),
    linha({
      frente: 'Conciliação de Recebimentos (Frente IV)',
      metrica: 'recebimentos_valor_alocado',
      rotulo: 'valor de créditos de cliente alocados',
    }),
    linha({
      frente: 'SISPAG (Frente II)',
      metrica: 'sispag_titulos_aceitos_pct',
      rotulo: 'títulos aceitos pelo banco em remessa gerada — 2 de 5 títulos, 2 aguardando retorno',
      valor: 40,
      unidade: '%',
    }),
    linha({
      frente: 'SISPAG (Frente II)',
      metrica: 'sispag_valor_aceito',
      rotulo: 'valor de títulos aceitos pelo banco',
      valor: 2131.16,
    }),
    linha({
      janela_inicio: '2026-09-11T18:00:00',
      janela_fim: '2026-09-18T18:00:00',
      apurado_ate: '2026-09-18T18:00:00',
      valor: 500,
    }),
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

  it('os KPIs mostram a última semana FECHADA, não a em curso', async () => {
    await renderPagina()

    expect(screen.getByRole('heading', { name: /^Semana de 18\/09 a 25\/09\/2026$/ })).toBeInTheDocument()
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

  it('SISPAG (Frente II): títulos aceitos pelo banco, com o absoluto e o valor', async () => {
    await renderPagina()

    expect(screen.getByText('Pagamentos aceitos pelo banco')).toBeInTheDocument()
    expect(screen.getAllByText('40,0%').length).toBeGreaterThan(0)
    expect(screen.getAllByText('2 de 5 títulos, 2 aguardando retorno').length).toBeGreaterThan(0)
    expect(screen.getAllByText(/R\$\s2\.131,16/).length).toBeGreaterThan(0)
    expect(screen.getByRole('columnheader', { name: 'Pagamentos aceitos' })).toBeInTheDocument()
  })

  it('semana sem remessa gerada mostra travessão no SISPAG, não 0%', async () => {
    ;(fetchMetricasCiclo as jest.Mock).mockResolvedValue({
      serieInicio: '2026-09-11T18:00:00',
      metricas: [linha({ frente: 'SISPAG (Frente II)', metrica: 'sispag_valor_aceito', valor: 0 })],
    })

    await renderPagina()

    expect(screen.getByText('sem remessa na semana')).toBeInTheDocument()
    expect(screen.queryByText('0,0%')).not.toBeInTheDocument()
  })

  it('o histórico lista a semana em curso marcada com o horário de corte', async () => {
    await renderPagina()

    const tabela = screen.getByRole('table', { name: 'Métricas por semana' })
    expect(tabela.querySelectorAll('tbody tr')).toHaveLength(3)
    expect(screen.getByText('em andamento · parcial até sex 02/10, 15:02')).toBeInTheDocument()
    expect(screen.getByText(/Série iniciada em 11\/09\/2026/)).toBeInTheDocument()
  })

  it('antes da primeira semana fechar, os KPIs mostram a em curso — e dizem que é parcial', async () => {
    ;(fetchMetricasCiclo as jest.Mock).mockResolvedValue({
      serieInicio: '2026-09-11T18:00:00',
      metricas: [
        linha({
          janela_inicio: '2026-09-11T18:00:00',
          janela_fim: '2026-09-18T18:00:00',
          parcial: true,
          apurado_ate: '2026-09-18T15:02:00',
          valor: 1283986.92,
        }),
      ],
    })

    await renderPagina()

    expect(
      screen.getByRole('heading', { name: /Semana em andamento de 11\/09 a 18\/09\/2026/ }),
    ).toBeInTheDocument()
    expect(screen.getByText(/Parcial até sex 18\/09, 15:02/)).toBeInTheDocument()
  })

  it('antes de a série começar, diz isso em vez de mostrar zeros', async () => {
    ;(fetchMetricasCiclo as jest.Mock).mockResolvedValue({ serieInicio: '2026-09-11T18:00:00', metricas: [] })

    await renderPagina()

    expect(screen.getByText('Nenhuma semana iniciada ainda')).toBeInTheDocument()
  })

  it('quando a leitura falha, diz que falhou', async () => {
    ;(fetchMetricasCiclo as jest.Mock).mockRejectedValue(new Error('Falha ao carregar as métricas (HTTP 500).'))

    await renderPagina()

    expect(screen.getByText('Não foi possível carregar')).toBeInTheDocument()
  })
})
