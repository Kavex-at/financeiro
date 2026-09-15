import type { PermutaPendente } from '@/lib/types'
import { MOTIVO_LABEL, podeMarcarExcecao, tagExcecao } from './format'

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

describe('tagExcecao', () => {
  const excecao = {
    justificativa: 'registrada',
    criadoPor: 'user-abc',
    criadoEm: '2026-09-15T14:30:00.000Z',
    ativa: true,
  }

  it('aplicada → ativa; registrada e não aplicada → inativa', () => {
    expect(tagExcecao(pendente({ status: 'ja-permutado', excecaoManual: excecao }))).toBe('ativa')
    expect(tagExcecao(pendente({ excecaoManual: { ...excecao, ativa: false } }))).toBe('inativa')
  })

  it('sem linha de exceção: o motivo permutado-fora-do-painel ainda mostra a tag; os demais não', () => {
    expect(
      tagExcecao(pendente({ status: 'ja-permutado', motivoBloqueio: 'permutado-fora-do-painel' })),
    ).toBe('ativa')
    expect(tagExcecao(pendente({ status: 'ja-permutado', motivoBloqueio: 'ja-permutado' }))).toBeNull()
    expect(tagExcecao(pendente())).toBeNull()
  })
})
