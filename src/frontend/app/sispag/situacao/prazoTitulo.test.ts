import { ORIGEM_PRAZO, type PrazoBoleto, type TituloAPagar } from '@/lib/sispag'
import {
  causaDoPrazo,
  diaDoPrazo,
  diasAtePrazo,
  diferencaDias,
  estaPerdido,
  prazoVemDoBoleto,
} from './prazoTitulo'

// 2026-10-28 00:00Z, o dia ERP do vencimento do título.
const VENC = Date.UTC(2026, 9, 28)

const titulo = (dias: number | undefined, prazoBoleto?: PrazoBoleto): TituloAPagar => ({
  docCod: '1',
  titCod: '1',
  filCod: 1,
  valor: 100,
  liberado: true,
  pago: false,
  vencimento: VENC,
  diasAteVencimento: dias,
  ...(prazoBoleto ? { prazoBoleto } : {}),
})

const doBoleto: PrazoBoleto = {
  prazoEfetivo: '2026-10-26',
  origem: ORIGEM_PRAZO.BOLETO_SUGERIDO,
  vencimentoTitulo: '2026-10-28',
  vencimentoBoleto: '2026-10-26',
  perdido: false,
}

describe('prazoTitulo (I19t)', () => {
  it('sem prazoBoleto cai no vencimento do título', () => {
    const t = titulo(2)
    expect(diaDoPrazo(t)).toBe('2026-10-28')
    expect(diasAtePrazo(t)).toBe(2)
    expect(estaPerdido(t)).toBe(false)
    expect(prazoVemDoBoleto(t)).toBe(false)
  })

  it('prazo do boleto antecipa o dia e os dias até o prazo', () => {
    const t = titulo(2, doBoleto)
    expect(diaDoPrazo(t)).toBe('2026-10-26')
    expect(diasAtePrazo(t)).toBe(0)
    expect(prazoVemDoBoleto(t)).toBe(true)
  })

  it('origem TITULO mantém o vencimento; perdido é independente do prazo', () => {
    const t = titulo(2, {
      prazoEfetivo: '2026-10-28',
      origem: ORIGEM_PRAZO.TITULO,
      vencimentoTitulo: '2026-10-28',
      perdido: true,
    })
    expect(diasAtePrazo(t)).toBe(2)
    expect(estaPerdido(t)).toBe(true)
    expect(prazoVemDoBoleto(t)).toBe(false)
  })

  it('sem diasAteVencimento não há dias até o prazo', () => {
    expect(diasAtePrazo(titulo(undefined, doBoleto))).toBeUndefined()
  })

  it('diferença entre dias atravessa mês e ano', () => {
    expect(diferencaDias('2026-12-30', '2027-01-02')).toBe(3)
    expect(diferencaDias('2026-10-28', '2026-10-26')).toBe(-2)
  })
})

describe('causaDoPrazo (texto da linha)', () => {
  it('barra que puxa para hoje: boleto vence hoje · título vence dd/mm', () => {
    expect(causaDoPrazo(titulo(2, doBoleto))).toBe(
      'Boleto sugerido vence hoje · título vence 28/10',
    )
  })

  it('barra que puxa para outro dia mostra a data da barra', () => {
    const t = titulo(3, { ...doBoleto, prazoEfetivo: '2026-10-27', vencimentoBoleto: '2026-10-27' })
    expect(causaDoPrazo(t)).toBe('Boleto sugerido vence 27/10 · título vence 28/10')
  })

  it('ambíguos: N candidatos, com ou sem puxar o prazo', () => {
    expect(causaDoPrazo(titulo(2, { ...doBoleto, totalCandidatos: 2 }))).toBe(
      'Boleto sugerido vence hoje · título vence 28/10 · 2 candidatos',
    )
    expect(
      causaDoPrazo(
        titulo(2, {
          prazoEfetivo: '2026-10-28',
          origem: ORIGEM_PRAZO.TITULO,
          vencimentoTitulo: '2026-10-28',
          totalCandidatos: 3,
          perdido: false,
        }),
      ),
    ).toBe('3 candidatos')
  })

  it('sem prazoBoleto, origem TITULO ou perdido: sem causa (o perdido tem linha própria)', () => {
    expect(causaDoPrazo(titulo(2))).toBeUndefined()
    expect(causaDoPrazo(titulo(2, { ...doBoleto, perdido: true }))).toBeUndefined()
  })
})
