import { chavePeriodo, gravarPeriodo, lerPeriodo, PERIODO_PADRAO, tempoRelativo } from '@/app/perfil/periodo'

beforeEach(() => window.localStorage.clear())

describe('preferência de período (DS patterns.md §4)', () => {
  it('chave por usuário e versionada', () => {
    expect(chavePeriodo('ana.souza')).toBe('ds:perfil:ana.souza:atividade-periodo:v1')
  })

  it('grava com v: 1 e relê o mesmo período, só para o mesmo usuário', () => {
    gravarPeriodo('ana.souza', { periodo: 'personalizado', inicio: '2026-09-01', fim: '2026-09-30' })
    expect(JSON.parse(window.localStorage.getItem(chavePeriodo('ana.souza')) ?? '{}')).toMatchObject({ v: 1 })
    expect(lerPeriodo('ana.souza')).toEqual({
      periodo: 'personalizado',
      inicio: '2026-09-01',
      fim: '2026-09-30',
    })
    expect(lerPeriodo('bruno')).toEqual(PERIODO_PADRAO)
  })

  it('versão diferente, período desconhecido ou JSON torto: volta ao padrão', () => {
    window.localStorage.setItem(chavePeriodo('a'), JSON.stringify({ v: 2, periodo: 'mes' }))
    expect(lerPeriodo('a')).toEqual(PERIODO_PADRAO)
    window.localStorage.setItem(chavePeriodo('a'), JSON.stringify({ v: 1, periodo: 'ano' }))
    expect(lerPeriodo('a')).toEqual(PERIODO_PADRAO)
    window.localStorage.setItem(chavePeriodo('a'), '{torto')
    expect(lerPeriodo('a')).toEqual(PERIODO_PADRAO)
  })
})

describe('tempoRelativo', () => {
  it('em pt-BR, relativo ao agora', () => {
    const agora = Date.parse('2026-10-01T15:00:00Z')
    expect(tempoRelativo('2026-10-01T13:00:00Z', agora)).toBe('há 2 horas')
    expect(tempoRelativo('2026-09-29T15:00:00Z', agora)).toBe('anteontem')
  })
})
