/** Evidências exibidas: NUMERO_CONFIAVEL suprime NUMERO_IGUAL (só exibição; ADR-0079). */
import { sinaisVisiveis } from './sugestaoBoleto'

describe('sinaisVisiveis', () => {
  it('suprime NUMERO_IGUAL quando NUMERO_CONFIAVEL está presente', () => {
    expect(sinaisVisiveis(['VALOR_IGUAL', 'NUMERO_IGUAL', 'NUMERO_CONFIAVEL'])).toEqual([
      'VALOR_IGUAL',
      'NUMERO_CONFIAVEL',
    ])
  })

  it('com DATA_DIVERGENTE_RECONHECIDA (ADR-0078), só NUMERO_IGUAL some', () => {
    expect(
      sinaisVisiveis(['NUMERO_IGUAL', 'NUMERO_CONFIAVEL', 'DATA_DIVERGENTE_RECONHECIDA']),
    ).toEqual(['NUMERO_CONFIAVEL', 'DATA_DIVERGENTE_RECONHECIDA'])
  })

  it('com NUMERO_CONFIAVEL, NUMERO_IGUAL e COLISAO_NUMERO somem (faixa ampliada da âncora)', () => {
    expect(
      sinaisVisiveis([
        'VALOR_ATE_5_CENTAVOS',
        'DIAS_DEPOIS',
        'NUMERO_IGUAL',
        'COLISAO_NUMERO',
        'NUMERO_CONFIAVEL',
      ]),
    ).toEqual(['VALOR_ATE_5_CENTAVOS', 'DIAS_DEPOIS', 'NUMERO_CONFIAVEL'])
  })

  it('mantém COLISAO_NUMERO quando NUMERO_CONFIAVEL está ausente', () => {
    expect(sinaisVisiveis(['NUMERO_IGUAL', 'COLISAO_NUMERO'])).toEqual([
      'NUMERO_IGUAL',
      'COLISAO_NUMERO',
    ])
  })

  it('mantém NUMERO_IGUAL sozinho', () => {
    expect(sinaisVisiveis(['NUMERO_IGUAL', 'MESMO_DIA'])).toEqual(['NUMERO_IGUAL', 'MESMO_DIA'])
  })

  it('não muta a entrada', () => {
    const entrada = ['NUMERO_IGUAL', 'NUMERO_CONFIAVEL'] as const
    sinaisVisiveis([...entrada])
    expect(entrada).toEqual(['NUMERO_IGUAL', 'NUMERO_CONFIAVEL'])
  })
})
