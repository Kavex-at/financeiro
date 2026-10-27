/** Evidências exibidas: NUMERO_CONFIAVEL suprime NUMERO_IGUAL (só exibição; ADR-0079). */
import { sinaisVisiveis } from './sugestaoBoleto'

describe('sinaisVisiveis', () => {
  it('suprime NUMERO_IGUAL quando NUMERO_CONFIAVEL está presente', () => {
    expect(sinaisVisiveis(['VALOR_IGUAL', 'NUMERO_IGUAL', 'NUMERO_CONFIAVEL'])).toEqual([
      'VALOR_IGUAL',
      'NUMERO_CONFIAVEL',
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
