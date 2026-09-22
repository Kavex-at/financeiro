jest.mock('@/lib/http', () => ({ apiFetch: jest.fn() }))
jest.mock('@/lib/auth/token', () => ({ withAuthHeaders: jest.fn(async () => ({})) }))

import { apiFetch } from '@/lib/http'
import {
  METRICA,
  type MetricaCiclo,
  absolutoDoRotulo,
  agruparPorSemana,
  fetchMetricasCiclo,
  formatarDiaLocal,
  formatarMetrica,
  formatarMomentoLocal,
} from '@/lib/metricas'

const mockApiFetch = apiFetch as jest.MockedFunction<typeof apiFetch>

const linha = (over: Partial<MetricaCiclo>): MetricaCiclo => ({
  frente: 'Permutas (Frente I)',
  metrica: METRICA.PERMUTAS_RS,
  rotulo: 'valor baixado em permutas de adiantamento',
  valor: 0,
  unidade: 'R$',
  janela_inicio: '2026-09-11T18:00:00',
  janela_fim: '2026-09-18T18:00:00',
  baseline: null,
  baseline_desc: 'sem medição do processo manual',
  parcial: false,
  apurado_ate: '2026-09-18T18:00:00',
  ...over,
})

describe('agruparPorSemana', () => {
  it('junta as métricas da mesma janela e ordena da mais recente para a mais antiga', () => {
    const semanas = agruparPorSemana([
      linha({ janela_inicio: '2026-09-11T18:00:00', janela_fim: '2026-09-18T18:00:00' }),
      linha({
        metrica: METRICA.PERMUTAS_PCT,
        unidade: '%',
        janela_inicio: '2026-09-18T18:00:00',
        janela_fim: '2026-09-25T18:00:00',
      }),
      linha({
        metrica: METRICA.RECEBIMENTOS_RS,
        janela_inicio: '2026-09-11T18:00:00',
        janela_fim: '2026-09-18T18:00:00',
      }),
    ])

    expect(semanas.map((s) => s.janelaInicio)).toEqual(['2026-09-18T18:00:00', '2026-09-11T18:00:00'])
    expect(Object.keys(semanas[1].porChave).sort()).toEqual(
      [METRICA.PERMUTAS_RS, METRICA.RECEBIMENTOS_RS].sort(),
    )
  })
})

describe('formatarDiaLocal', () => {
  it('corta a string em vez de converter fuso — sexta 18:00 continua sendo o mesmo dia', () => {
    expect(formatarDiaLocal('2026-09-18T18:00:00')).toBe('18/09')
    expect(formatarDiaLocal('2026-09-11T18:00:00', true)).toBe('11/09/2026')
    expect(formatarDiaLocal('lixo')).toBe('—')
  })
})

describe('formatarMetrica', () => {
  it('formata R$, % e ausência', () => {
    expect(formatarMetrica(linha({ valor: 1283986.92 }))).toMatch(/R\$\s?1\.283\.986,92/)
    expect(formatarMetrica(linha({ unidade: '%', valor: 92.3 }))).toBe('92,3%')
    expect(formatarMetrica(undefined)).toBe('—')
  })
})

describe('absolutoDoRotulo', () => {
  it('extrai o absoluto que acompanha o percentual', () => {
    expect(
      absolutoDoRotulo('baixas de adiantamento concluídas, com borderô finalizado — 12 de 13 tentativas'),
    ).toBe('12 de 13 tentativas')
    expect(absolutoDoRotulo('valor baixado em permutas de adiantamento')).toBeUndefined()
  })
})

describe('formatarMomentoLocal', () => {
  it('mostra o dia da semana e a hora do corte, sem converter fuso', () => {
    expect(formatarMomentoLocal('2026-09-18T15:02:00')).toBe('sex 18/09, 15:02')
    expect(formatarMomentoLocal('2026-09-14T09:30:00')).toBe('seg 14/09, 09:30')
    expect(formatarMomentoLocal('2026-09-18')).toBe('—')
  })
})

describe('agruparPorSemana — semana em curso', () => {
  it('carrega parcial e o horário de corte para a semana', () => {
    const [semana] = agruparPorSemana([linha({ parcial: true, apurado_ate: '2026-09-18T15:02:00' })])

    expect(semana.parcial).toBe(true)
    expect(semana.apuradoAte).toBe('2026-09-18T15:02:00')
  })
})

describe('fetchMetricasCiclo', () => {
  beforeEach(() => mockApiFetch.mockReset())

  /**
   * ADR-0048: sem `?historico=true` a tela volta a abrir com uma única janela aberta e `—` em tudo.
   * O parâmetro é o que separa a leitura da tela da leitura do `kavex-report-ciclo`.
   */
  it('pede o histórico de seis semanas', async () => {
    mockApiFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ serieInicio: '2026-08-07T18:00:00', metricas: [] }),
    } as unknown as Response)

    await expect(fetchMetricasCiclo()).resolves.toEqual({
      serieInicio: '2026-08-07T18:00:00',
      metricas: [],
    })
    expect(mockApiFetch.mock.calls[0][0]).toMatch(/\/metricas\/ciclo\?historico=true$/)
  })

  it('erro de leitura vira exceção com o status — a tela não finge número', async () => {
    mockApiFetch.mockResolvedValue({ ok: false, status: 503 } as unknown as Response)

    await expect(fetchMetricasCiclo()).rejects.toThrow('503')
  })
})
