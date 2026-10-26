import { type SugestaoBoleto, SITUACOES_SUGESTAO_TITULO } from '@/lib/sispag'
import {
  agruparPorTitulo,
  chaveTitulo,
  formatDeltaDias,
  formatDeltaPercentual,
  formatDeltaValor,
  resumoDoTitulo,
  ROTULO_SITUACAO,
  SITUACAO_SEM_PAINEL,
  TOM_SITUACAO,
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
  it('confirmação órfã vence a confirmada comum (precisa de atenção)', () => {
    expect(
      resumoDoTitulo([
        base({ estado: 'CONFIRMADA', ditCod: 7 }),
        base({ estado: 'CONFIRMADA', ditCod: 8, orfa: true, confirmavel: false }),
      ]),
    ).toBe('ORFA')
    expect(resumoDoTitulo([base({ estado: 'CONFIRMADA', orfa: true })])).toBe('ORFA')
  })
  it('agrupa por fil:doc:tit', () => {
    const m = agruparPorTitulo([base(), base({ ditCod: 9 }), base({ titCod: '2' })])
    expect(m.get(chaveTitulo({ filCod: 1, docCod: '10', titCod: '1' }))).toHaveLength(2)
    expect(m.size).toBe(2)
  })
})

describe('EM_GRUPO — título dentro de um boleto agrupado confirmado (I15q, ADR-0077)', () => {
  it('é uma situação conhecida, só informativa: sem painel e sem tom de ação', () => {
    expect(SITUACOES_SUGESTAO_TITULO).toContain('EM_GRUPO')
    expect(ROTULO_SITUACAO.EM_GRUPO).toBe('em boleto agrupado')
    expect(TOM_SITUACAO.EM_GRUPO).toBe('mudo')
    expect(SITUACAO_SEM_PAINEL.has('EM_GRUPO')).toBe(true)
  })
})
