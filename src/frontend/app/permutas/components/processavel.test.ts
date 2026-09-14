import type { PermutaBorderoVinculo } from '@/lib/types'
import { motivoSemProcessar, temAlgoAProcessar, vinculoSeguraBaixa } from './format'

/**
 * Quem pode ser processado na aba Automáticas — e por que cada linha que NÃO pode não pode.
 *
 * Regressão de dois bugs reais de produção (processo 173, 2026-09-14):
 *
 *  1. O adto `4742` (`0,00 BRL` contra invoice em USD) aparecia como **Pendente** na tabela e era
 *     contado/disparado pelo modal. O backend respondia HTTP 500 (`has no alocacoes to reconcile`)
 *     e a tela declarava falha — mesmo com a permuta que importava já liquidada.
 *  2. O modal rotulava o adto `3211` — JÁ liquidado no borderô 2185 — como "sem saldo a permutar",
 *     enquanto a tabela ao lado mostrava "Finalizado · borderô 2185". Causa: o modal olhava o
 *     `processamentoStatus` (marcador manual, na prática nunca preenchido) em vez do vínculo de
 *     borderô, que é a execução real.
 */
const vinculo = (over: Partial<PermutaBorderoVinculo> = {}): PermutaBorderoVinculo => ({
  borCod: 2185,
  permutaStatus: 'finalizado',
  situacao: 'FINALIZADO',
  ...over,
})

describe('temAlgoAProcessar', () => {
  it('linha com valor e sem borderô é processável', () => {
    expect(temAlgoAProcessar({ valorASerUsado: 29575.24 }, undefined)).toBe(true)
  })

  it('valor zerado não é processável (o backend não teria alocação)', () => {
    expect(temAlgoAProcessar({ valorASerUsado: 0 }, undefined)).toBe(false)
  })

  it('borderô vivo impede reprocessar, mesmo com valor > 0', () => {
    // Caso 4471: baixa entrou no borderô 2466, aguardando aprovação. Contá-la inflava o botão.
    expect(
      temAlgoAProcessar(
        { valorASerUsado: 29575.24 },
        vinculo({ borCod: 2466, permutaStatus: 'aguardando-finalizacao', situacao: 'EM_CADASTRO' }),
      ),
    ).toBe(false)
  })

  it('borderô CANCELADO libera o relançamento (idempotência viva)', () => {
    expect(
      temAlgoAProcessar({ valorASerUsado: 100 }, vinculo({ situacao: 'CANCELADO' })),
    ).toBe(true)
  })

  it('marcador manual `processado` também exclui', () => {
    expect(temAlgoAProcessar({ valorASerUsado: 100, processamentoStatus: 'processado' })).toBe(
      false,
    )
  })
})

describe('vinculoSeguraBaixa', () => {
  it.each(['CANCELADO', 'ESTORNADO', 'REMOVIDO'] as const)('%s não segura a baixa', (situacao) => {
    expect(vinculoSeguraBaixa(vinculo({ situacao }))).toBe(false)
  })

  it.each(['EM_CADASTRO', 'FINALIZADO'] as const)('%s segura a baixa', (situacao) => {
    expect(vinculoSeguraBaixa(vinculo({ situacao }))).toBe(true)
  })

  it('INDISPONIVEL conta como vivo (lado conservador)', () => {
    expect(vinculoSeguraBaixa(vinculo({ situacao: 'INDISPONIVEL' }))).toBe(true)
  })

  it('sem vínculo não segura nada', () => {
    expect(vinculoSeguraBaixa(undefined)).toBe(false)
  })
})

describe('motivoSemProcessar', () => {
  it('linha processável não tem motivo', () => {
    expect(motivoSemProcessar({ valorASerUsado: 10, moeda: 'USD' }, { moedaInvoice: 'USD' })).toBe(
      undefined,
    )
  })

  it('já liquidado nomeia o borderô — não "sem saldo" (bug do 3211)', () => {
    expect(
      motivoSemProcessar(
        { valorASerUsado: 0, moeda: 'USD' },
        { moedaInvoice: 'USD', vinculo: vinculo({ borCod: 2185 }) },
      ),
    ).toBe('já processado · borderô 2185')
  })

  it('moeda diferente da invoice é dita explicitamente (bug do 4742)', () => {
    expect(
      motivoSemProcessar({ valorASerUsado: 0, moeda: 'BRL' }, { moedaInvoice: 'USD' }),
    ).toBe('moeda diferente da invoice')
  })

  it('mesma moeda e valor zerado = adiantamento consumido', () => {
    expect(motivoSemProcessar({ valorASerUsado: 0, moeda: 'USD' }, { moedaInvoice: 'USD' })).toBe(
      'sem saldo a permutar',
    )
  })

  it('borderô cancelado volta a ser processável — sem motivo', () => {
    expect(
      motivoSemProcessar(
        { valorASerUsado: 100, moeda: 'USD' },
        { moedaInvoice: 'USD', vinculo: vinculo({ situacao: 'CANCELADO' }) },
      ),
    ).toBe(undefined)
  })
})
