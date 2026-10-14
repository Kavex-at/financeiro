import type { SugestaoBoleto } from '@/lib/sispag'
import {
  agruparPorTitulo,
  chaveTitulo,
  formatDeltaDias,
  formatDeltaPercentual,
  formatDeltaValor,
  resumoDoTitulo,
} from './sugestaoBoleto'

const base = (over: Partial<SugestaoBoleto> = {}): SugestaoBoleto => ({
  filCod: 1,
  docCod: '10',
  titCod: '1',
  valorTitulo: 100,
  vencimentoTitulo: '2026-10-20',
  dataDebito: '2026-10-20',
  ddcCod: 5,
  ditCod: 6,
  valorBoleto: 100,
  vencimentoBoleto: '2026-10-20',
  avaliacao: {
    resultado: 'FORTE',
    deltaValor: 0,
    deltaPercentual: 0,
    deltaDias: 0,
    sinais: [],
    confirmavel: true,
  },
  estado: 'SUGERIDA',
  confirmavel: true,
  ...over,
})

describe('deltas com sinal (boleto − título)', () => {
  it('valor', () => {
    expect(formatDeltaValor(0.01)).toBe('R$ +0,01')
    expect(formatDeltaValor(-12.5)).toBe('R$ -12,50')
    expect(formatDeltaValor(0)).toBe('R$ 0,00')
  })
  it('percentual', () => {
    expect(formatDeltaPercentual(1.6)).toBe('+1,6 %')
    expect(formatDeltaPercentual(-0.34)).toBe('-0,3 %')
  })
  it('dias', () => {
    expect(formatDeltaDias(2)).toBe('+2 dias')
    expect(formatDeltaDias(-1)).toBe('-1 dia')
    expect(formatDeltaDias(0)).toBe('0 dias')
  })
})

describe('resumo por título', () => {
  it('sem sugestão = indefinido', () => {
    expect(resumoDoTitulo(undefined)).toBeUndefined()
    expect(resumoDoTitulo([])).toBeUndefined()
  })
  it('confirmada vence a disponível; informativa quando nada é confirmável', () => {
    expect(resumoDoTitulo([base(), base({ estado: 'CONFIRMADA', ditCod: 7 })])).toBe('CONFIRMADA')
    expect(resumoDoTitulo([base()])).toBe('DISPONIVEL')
    expect(
      resumoDoTitulo([
        base({
          confirmavel: false,
          avaliacao: { ...base().avaliacao, resultado: 'VENCIDO_INFORMATIVO', confirmavel: false },
        }),
      ]),
    ).toBe('INFORMATIVA')
  })
  it('agrupa por fil:doc:tit', () => {
    const m = agruparPorTitulo([base(), base({ ditCod: 9 }), base({ titCod: '2' })])
    expect(m.get(chaveTitulo({ filCod: 1, docCod: '10', titCod: '1' }))).toHaveLength(2)
    expect(m.size).toBe(2)
  })
})
