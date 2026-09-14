import {
  METRICA,
  type MetricaCiclo,
  absolutoDoRotulo,
  agruparPorSemana,
  formatarDiaLocal,
  formatarMetrica,
  formatarMomentoLocal,
} from '@/lib/metricas'

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
