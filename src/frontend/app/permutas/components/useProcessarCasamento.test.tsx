import { act, renderHook } from '@testing-library/react'
import type { CasamentoSugerido, PermutaBorderoVinculo, ReconciliarResult } from '@/lib/types'
import { useProcessarCasamento } from './useProcessarCasamento'

jest.mock('sonner', () => ({
  toast: { success: jest.fn(), warning: jest.fn(), error: jest.fn(), info: jest.fn() },
}))
jest.mock('@/lib/api', () => ({ reconciliarAdiantamento: jest.fn() }))
jest.mock('@/lib/http', () => ({
  isSessionExpiredError: (e: unknown) => e instanceof Error && e.message === 'SESSAO_EXPIRADA',
}))

import { toast } from 'sonner'
import { reconciliarAdiantamento } from '@/lib/api'

const reconciliar = reconciliarAdiantamento as jest.Mock

const casamento: CasamentoSugerido = {
  priCod: '173',
  invoice: { docCod: 'INV-9', moeda: 'USD' },
  adiantamentos: [
    { docCod: '4471', referencia: 'A', valorASerUsado: 100, moeda: 'USD' },
    { docCod: '4742', referencia: 'B', valorASerUsado: 50, moeda: 'USD' },
  ],
} as unknown as CasamentoSugerido

const baixou = (docCod: string, borCod: number): ReconciliarResult => ({
  adiantamentoDocCod: docCod,
  dryRun: false,
  writeEnabled: true,
  borCod,
  resultados: [{ invoiceDocCod: 'INV-9', status: 'settled', dryRun: false, borCod }],
})

type Props = { statusPorAdto: Record<string, PermutaBorderoVinculo> }

const montar = (statusInicial: Record<string, PermutaBorderoVinculo> = {}) => {
  const load = jest.fn().mockResolvedValue(undefined)
  const setConfirmacao = jest.fn()
  const hook = renderHook(
    ({ statusPorAdto }: Props) =>
      useProcessarCasamento({ confirmacao: casamento, setConfirmacao, statusPorAdto, load }),
    { initialProps: { statusPorAdto: statusInicial } },
  )
  return { ...hook, load, setConfirmacao }
}

describe('useProcessarCasamento', () => {
  beforeEach(() => jest.clearAllMocks())

  /**
   * O vínculo de borderô chega LAZY, depois do /gestao. O callback memoizado sem `statusPorAdto`
   * nas dependências filtrava contra o `{}` inicial e reenviava o adiantamento já baixado.
   */
  it('filtra contra o statusPorAdto que chegou depois, não contra o {} inicial', async () => {
    reconciliar.mockResolvedValue(baixou('4742', 901))
    const { result, rerender } = montar({})

    rerender({
      statusPorAdto: {
        '4471': { borCod: 900, permutaStatus: 'EM_CADASTRO', situacao: 'CADASTRO' },
      } as unknown as Record<string, PermutaBorderoVinculo>,
    })
    await act(() => result.current.confirmarProcessamento())

    expect(reconciliar).toHaveBeenCalledTimes(1)
    expect(reconciliar).toHaveBeenCalledWith('4742', { dryRun: false })
  })

  it('borderô CANCELADO não segura: o adiantamento volta a ser enviado', async () => {
    reconciliar.mockImplementation(async (docCod: string) => baixou(docCod, 902))
    const { result } = montar({
      '4471': { borCod: 900, permutaStatus: 'EM_CADASTRO', situacao: 'CANCELADO' },
    } as unknown as Record<string, PermutaBorderoVinculo>)

    await act(() => result.current.confirmarProcessamento())

    expect(reconciliar.mock.calls.map((c) => c[0])).toEqual(['4471', '4742'])
  })

  /**
   * O 1º adiantamento baixa, o 2º estoura. Antes: um único try em volta do laço, e a única
   * mensagem era "Falha ao processar" — com a baixa do 1º já no fin010.
   */
  it('sucesso parcial: anuncia a baixa que entrou E a falha, e recarrega a tela', async () => {
    reconciliar
      .mockResolvedValueOnce(baixou('4471', 900))
      .mockRejectedValueOnce(new Error('API 500'))
    const { result, load } = montar()

    await act(() => result.current.confirmarProcessamento())

    expect(toast.success).toHaveBeenCalledWith(
      'Processo 173: 1 baixa(s) no fin010 (borderô 900, EM CADASTRO). Revise e aprove em Borderôs.',
    )
    expect(toast.error).toHaveBeenCalledTimes(1)
    const [titulo, opts] = (toast.error as jest.Mock).mock.calls[0]
    expect(titulo).toBe('Processo 173: 1 de 2 adiantamento(s) NÃO processado(s)')
    expect(opts.description).toContain('Adiantamento 4742: API 500')
    expect(opts.description).toContain('JÁ ESTÃO no fin010')
    expect(titulo).not.toMatch(/Falha ao processar/)
    // Sem o reload, a baixa que entrou não apareceria com o borderô.
    expect(load).toHaveBeenCalledTimes(1)
    expect(result.current.processando).toBeNull()
  })

  it('uma falha no 1º não impede o 2º de ser tentado', async () => {
    reconciliar
      .mockRejectedValueOnce(new Error('ALOCACAO_SEM_COBERTURA'))
      .mockResolvedValueOnce(baixou('4742', 901))
    const { result } = montar()

    await act(() => result.current.confirmarProcessamento())

    expect(reconciliar).toHaveBeenCalledTimes(2)
    expect(toast.success).toHaveBeenCalledWith(expect.stringContaining('borderô 901'))
    expect((toast.error as jest.Mock).mock.calls[0][1].description).toContain(
      'Adiantamento 4471: ALOCACAO_SEM_COBERTURA',
    )
  })

  it('tudo falhou: "Falha ao processar", sem sugerir que algo entrou', async () => {
    reconciliar.mockRejectedValue(new Error('API 500'))
    const { result, load } = montar()

    await act(() => result.current.confirmarProcessamento())

    expect(toast.success).not.toHaveBeenCalled()
    expect(toast.error).toHaveBeenCalledTimes(1)
    const [titulo, opts] = (toast.error as jest.Mock).mock.calls[0]
    expect(titulo).toBe('Falha ao processar o processo 173')
    expect(opts.description).not.toContain('JÁ ESTÃO')
    expect(load).toHaveBeenCalledTimes(1)
  })

  it('requisição que voltou só com baixas em erro não conta como "já está no fin010"', async () => {
    reconciliar
      .mockResolvedValueOnce({
        ...baixou('4471', 900),
        resultados: [{ invoiceDocCod: 'INV-9', status: 'error', dryRun: false, erro: 'x' }],
      })
      .mockRejectedValueOnce(new Error('API 500'))
    const { result } = montar()

    await act(() => result.current.confirmarProcessamento())

    const titulos = (toast.error as jest.Mock).mock.calls.map((c) => c[0])
    expect(titulos).toContain('1 baixa(s) falharam — veja a aba Borderôs.')
    expect(titulos).toContain('Falha ao processar o processo 173')
  })

  it('sessão expirada no meio: para o laço e diz que os demais não foram enviados', async () => {
    reconciliar
      .mockResolvedValueOnce(baixou('4471', 900))
      .mockRejectedValueOnce(new Error('SESSAO_EXPIRADA'))
    const { result } = montar()

    await act(() => result.current.confirmarProcessamento())

    expect(toast.success).toHaveBeenCalledTimes(1)
    expect(toast.error).not.toHaveBeenCalled()
    expect(toast.warning).toHaveBeenCalledWith(
      expect.stringContaining('1 adiantamento(s) não foram enviados'),
    )
  })
})
