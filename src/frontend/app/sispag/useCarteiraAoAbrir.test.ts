import { act, renderHook, waitFor } from '@testing-library/react'
import { atualizarCarteiraSeDefasada } from '@/lib/sispag'
import { ESPERA_REFRESH_MS, TENTATIVAS_REFRESH, useCarteiraAoAbrir } from './useCarteiraAoAbrir'

jest.mock('@/lib/sispag', () => ({ atualizarCarteiraSeDefasada: jest.fn() }))
const mockRefresh = atualizarCarteiraSeDefasada as jest.Mock

describe('useCarteiraAoAbrir', () => {
  beforeEach(() => {
    mockRefresh.mockReset()
    jest.useFakeTimers()
  })
  afterEach(() => jest.useRealTimers())

  it('desabilitado não chama o backend', () => {
    renderHook(() => useCarteiraAoAbrir({ habilitado: false, aoAtualizar: jest.fn() }))
    expect(mockRefresh).not.toHaveBeenCalled()
  })

  it('em_andamento (outra ingestão): reconfere e, quando fica fresca, recarrega os dados novos', async () => {
    const aoAtualizar = jest.fn()
    mockRefresh
      .mockResolvedValueOnce({ estado: 'em_andamento' })
      .mockResolvedValueOnce({ estado: 'em_andamento' })
      .mockResolvedValueOnce({ estado: 'fresca' })
    const { result } = renderHook(() => useCarteiraAoAbrir({ habilitado: true, aoAtualizar }))

    await act(async () => {
      await jest.advanceTimersByTimeAsync(ESPERA_REFRESH_MS * 2)
    })
    expect(mockRefresh).toHaveBeenCalledTimes(3)
    expect(aoAtualizar).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(result.current.situacao).toBe('ocioso'))
  })

  it('fresca de primeira não recarrega nada', async () => {
    const aoAtualizar = jest.fn()
    mockRefresh.mockResolvedValue({ estado: 'fresca' })
    renderHook(() => useCarteiraAoAbrir({ habilitado: true, aoAtualizar }))
    await act(async () => {
      await jest.advanceTimersByTimeAsync(0)
    })
    expect(aoAtualizar).not.toHaveBeenCalled()
  })

  it('desiste depois de TENTATIVAS_REFRESH reconferências (outra ingestão que não termina)', async () => {
    mockRefresh.mockResolvedValue({ estado: 'em_andamento' })
    const { result } = renderHook(() =>
      useCarteiraAoAbrir({ habilitado: true, aoAtualizar: jest.fn() }),
    )
    await act(async () => {
      await jest.advanceTimersByTimeAsync(ESPERA_REFRESH_MS * (TENTATIVAS_REFRESH + 2))
    })
    expect(mockRefresh).toHaveBeenCalledTimes(TENTATIVAS_REFRESH)
    expect(result.current.situacao).toBe('ocioso')
  })

  it('desmontar interrompe: não chama mais nada nem atualiza estado', async () => {
    mockRefresh.mockResolvedValue({ estado: 'em_andamento' })
    const { unmount } = renderHook(() =>
      useCarteiraAoAbrir({ habilitado: true, aoAtualizar: jest.fn() }),
    )
    await act(async () => {
      await jest.advanceTimersByTimeAsync(0)
    })
    unmount()
    await act(async () => {
      await jest.advanceTimersByTimeAsync(ESPERA_REFRESH_MS * 3)
    })
    expect(mockRefresh).toHaveBeenCalledTimes(1)
  })
})
