import { act, renderHook } from '@testing-library/react'
import type { PermutaPendente } from '@/lib/types'
import { useExcecaoManual } from './useExcecaoManual'

jest.mock('sonner', () => ({
  toast: { success: jest.fn(), warning: jest.fn(), error: jest.fn() },
}))
jest.mock('@/lib/api', () => {
  class ExcecaoManualRecusadaError extends Error {}
  return {
    ExcecaoManualRecusadaError,
    marcarExcecaoManual: jest.fn(),
    desfazerExcecaoManual: jest.fn(),
  }
})

import { toast } from 'sonner'
import { ExcecaoManualRecusadaError, desfazerExcecaoManual, marcarExcecaoManual } from '@/lib/api'

/**
 * Marcar/desfazer reclassificam a linha no banco na mesma transação (ADR-0047), então basta o
 * `load()` para o adiantamento trocar de card ("Bloqueadas" ↔ "Já permutado") — sem ingestão.
 */
const adto = { docCod: '8721' } as PermutaPendente

describe('useExcecaoManual', () => {
  beforeEach(() => jest.clearAllMocks())

  it('marcar com sucesso: chama a API com a justificativa, fecha o modal e recarrega (load)', async () => {
    const load = jest.fn().mockResolvedValue(undefined)
    ;(marcarExcecaoManual as jest.Mock).mockResolvedValue(undefined)
    const { result } = renderHook(() => useExcecaoManual(load))

    act(() => result.current.setMarcandoExcecao(adto))
    await act(() => result.current.confirmarExcecao('Baixas cruzadas 21 x 198'))

    expect(marcarExcecaoManual).toHaveBeenCalledWith('8721', 'Baixas cruzadas 21 x 198')
    expect(load).toHaveBeenCalledTimes(1)
    expect(result.current.marcandoExcecao).toBeNull()
    expect(result.current.salvandoExcecao).toBe(false)
    expect(toast.success).toHaveBeenCalled()
  })

  it('recusa de regra (422/409/404) vira aviso, mantém o modal aberto e não recarrega', async () => {
    const load = jest.fn()
    ;(marcarExcecaoManual as jest.Mock).mockRejectedValue(
      new ExcecaoManualRecusadaError('Só "Sem saldo a permutar".'),
    )
    const { result } = renderHook(() => useExcecaoManual(load))

    act(() => result.current.setMarcandoExcecao(adto))
    await act(() => result.current.confirmarExcecao('justificativa válida'))

    expect(toast.warning).toHaveBeenCalledWith('Só "Sem saldo a permutar".')
    expect(load).not.toHaveBeenCalled()
    expect(result.current.marcandoExcecao).toBe(adto)
  })

  it('desfazer com sucesso: chama a API, fecha a confirmação e recarrega (load)', async () => {
    const load = jest.fn().mockResolvedValue(undefined)
    ;(desfazerExcecaoManual as jest.Mock).mockResolvedValue(undefined)
    const { result } = renderHook(() => useExcecaoManual(load))

    act(() => result.current.setDesfazendoExcecao(adto))
    await act(() => result.current.confirmarDesfazerExcecao())

    expect(desfazerExcecaoManual).toHaveBeenCalledWith('8721')
    expect(load).toHaveBeenCalledTimes(1)
    expect(result.current.desfazendoExcecao).toBeNull()
  })

  it('erro genérico ao desfazer vira toast de erro', async () => {
    const load = jest.fn()
    ;(desfazerExcecaoManual as jest.Mock).mockRejectedValue(new Error('API 500'))
    const { result } = renderHook(() => useExcecaoManual(load))

    act(() => result.current.setDesfazendoExcecao(adto))
    await act(() => result.current.confirmarDesfazerExcecao())

    expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('API 500'))
    expect(load).not.toHaveBeenCalled()
  })
})
