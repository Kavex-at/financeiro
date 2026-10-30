/**
 * Previsão de que confirmar renegocia o título no Conexos (ADR-0074, I18a) e o aviso de fim do
 * acompanhamento do ajuste.
 */
import type { AjusteCentavos, SugestaoBoleto } from '@/lib/sispag'
import {
  ajusteDoTitulo,
  ajusteEmCurso,
  confirmarRenegocia,
  mensagemFimAjuste,
} from './sugestaoBoleto'

const par = (deltaValor: number, deltaDias = 0): Pick<SugestaoBoleto, 'avaliacao'> => ({
  avaliacao: {
    resultado: 'FORTE',
    deltaValor,
    deltaPercentual: 0,
    deltaDias,
    sinais: [],
    confirmavel: true,
  },
})

const ajuste = (over: Partial<AjusteCentavos> = {}): AjusteCentavos => ({
  id: 'exec-1',
  filCod: 1,
  docCod: '41027',
  titCodOrigem: '1',
  decisaoId: 'dec-1',
  etapa: 'pendente',
  tentativas: 1,
  ...over,
})

describe('confirmarRenegocia', () => {
  it('modo on, Δ R$ 0,01 e mesmo vencimento: renegocia', () => {
    expect(confirmarRenegocia({ sugestao: par(0.01), modo: 'on' })).toBe(true)
    expect(confirmarRenegocia({ sugestao: par(-0.05), modo: 'on' })).toBe(true)
  })

  it('shadow ou sem modo: nada é gravado', () => {
    expect(confirmarRenegocia({ sugestao: par(0.01), modo: 'shadow' })).toBe(false)
    expect(confirmarRenegocia({ sugestao: par(0.01) })).toBe(false)
  })

  it('Δ zero ou acima de R$ 0,05: sem ajuste', () => {
    expect(confirmarRenegocia({ sugestao: par(0), modo: 'on' })).toBe(false)
    expect(confirmarRenegocia({ sugestao: par(0.06), modo: 'on' })).toBe(false)
  })

  it('vencimento diferente (faixa +1..+5 dias): não ajusta (I18a(4))', () => {
    expect(confirmarRenegocia({ sugestao: par(0.01, 2), modo: 'on' })).toBe(false)
  })
})

describe('ajusteEmCurso / ajusteDoTitulo', () => {
  it('etapas intermediárias andam; concluído e recusado são finais', () => {
    expect(ajusteEmCurso('pendente')).toBe(true)
    expect(ajusteEmCurso('rechaveada')).toBe(true)
    expect(ajusteEmCurso('concluido')).toBe(false)
    expect(ajusteEmCurso('recusado')).toBe(false)
  })

  it('acha o ajuste pelo título de origem ou pelo novo', () => {
    const a = ajuste({ titCodNovo: '2' })
    expect(ajusteDoTitulo([a], { docCod: '41027', titCod: '1' })).toBe(a)
    expect(ajusteDoTitulo([a], { docCod: '41027', titCod: '2' })).toBe(a)
    expect(ajusteDoTitulo([a], { docCod: '41027', titCod: '3' })).toBeUndefined()
  })
})

describe('mensagemFimAjuste', () => {
  it('concluído: origem → novo · líquido', () => {
    const texto = mensagemFimAjuste(
      ajuste({ etapa: 'concluido', titCodNovo: '2', valorBoletoCentavos: 64757 }),
    )
    // `formatBRL` usa espaço não separável depois de "R$".
    expect(texto.replace(/\s/g, ' ')).toBe(
      'Título renegociado no Conexos: 41027/1 → 41027/2 · R$ 647,57',
    )
  })

  it('recusado: reusa o texto do selo', () => {
    expect(mensagemFimAjuste(ajuste({ etapa: 'recusado' }))).toBe(
      'O título não foi ajustado; ajuste pelo fluxo normal do Conexos.',
    )
  })
})
