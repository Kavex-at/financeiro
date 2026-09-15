import type { PermutaPendente } from '@/lib/types'
import { MOTIVO_LABEL, podeMarcarExcecao } from './format'

/**
 * Exceção manual "permutado fora do painel" (ADR-0047): quem pode receber a ação "Marcar como
 * permutado fora do painel". A guarda espelha a do backend (só `bloqueada/sem-saldo-permutar`);
 * o botão aparecer onde o backend recusaria só geraria um 422 na cara do analista.
 */
const pendente = (over: Partial<PermutaPendente> = {}): PermutaPendente => ({
  docCod: '8721',
  filCod: 2,
  referencia: '0013COO/25',
  exportador: 'CODELCO',
  valorMoedaNegociada: 3787086.38,
  moeda: 'USD',
  diasEmAberto: 240,
  status: 'bloqueada',
  motivoBloqueio: 'sem-saldo-permutar',
  ...over,
})

describe('podeMarcarExcecao', () => {
  it('true só para bloqueada/sem-saldo-permutar sem exceção', () => {
    expect(podeMarcarExcecao(pendente())).toBe(true)
  })

  it.each([
    ['bloqueada/nao-pago', { motivoBloqueio: 'nao-pago' }],
    ['ja-permutado', { status: 'ja-permutado', motivoBloqueio: 'ja-permutado' }],
    ['permuta-manual', { status: 'permuta-manual', motivoBloqueio: 'cliente-filtro' }],
    ['elegivel', { status: 'elegivel', motivoBloqueio: undefined }],
  ] as const)('false para %s', (_caso, over) => {
    expect(podeMarcarExcecao(pendente(over as Partial<PermutaPendente>))).toBe(false)
  })

  it('false para sem-saldo-permutar que já tem exceção (mesmo inativa)', () => {
    expect(
      podeMarcarExcecao(
        pendente({
          excecaoManual: {
            justificativa: 'registrada antes',
            criadoPor: 'user-abc',
            criadoEm: '2026-09-15T14:30:00.000Z',
            ativa: false,
          },
        }),
      ),
    ).toBe(false)
  })
})

describe('MOTIVO_LABEL', () => {
  it('rotula o motivo novo da exceção manual', () => {
    expect(MOTIVO_LABEL['permutado-fora-do-painel']).toBe('Permutado fora do painel (exceção manual)')
  })
})
