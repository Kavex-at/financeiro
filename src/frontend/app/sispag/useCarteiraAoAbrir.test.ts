import { act, renderHook, waitFor } from '@testing-library/react'
import { atualizarCarteiraSeDefasada, sincronizarLotesSeDefasado } from '@/lib/sispag'
import {
  ESPERA_REFRESH_MS,
  TENTATIVAS_REFRESH,
  useCarteiraAoAbrir,
  useLotesAoAbrir,
} from './useCarteiraAoAbrir'

jest.mock('@/lib/sispag', () => ({
  atualizarCarteiraSeDefasada: jest.fn(),
  sincronizarLotesSeDefasado: jest.fn(),
}))
const mockRefresh = atualizarCarteiraSeDefasada as jest.Mock
const mockLotes = sincronizarLotesSeDefasado as jest.Mock

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

  it('concluido só vira true quando o passo termina — é o que encadeia os lotes', async () => {
    let soltar: (v: unknown) => void = () => undefined
    mockRefresh.mockReturnValue(new Promise((r) => (soltar = r)))
    const { result } = renderHook(() =>
      useCarteiraAoAbrir({ habilitado: true, aoAtualizar: jest.fn() }),
    )
    await act(async () => {
      await jest.advanceTimersByTimeAsync(0)
    })
    expect(result.current.concluido).toBe(false)
    await act(async () => {
      soltar({ estado: 'atualizada' })
      await jest.advanceTimersByTimeAsync(0)
    })
    expect(result.current.concluido).toBe(true)
  })

  it('falha também conclui (os lotes sincronizam mesmo com a carteira falhando)', async () => {
    mockRefresh.mockRejectedValue(new Error('API 500'))
    const { result } = renderHook(() =>
      useCarteiraAoAbrir({ habilitado: true, aoAtualizar: jest.fn() }),
    )
    await act(async () => {
      await jest.advanceTimersByTimeAsync(0)
    })
    expect(result.current.situacao).toBe('falhou')
    expect(result.current.concluido).toBe(true)
  })
})

describe('useLotesAoAbrir (ADR-0066)', () => {
  beforeEach(() => {
    mockRefresh.mockReset()
    mockLotes.mockReset()
    jest.useFakeTimers()
  })
  afterEach(() => jest.useRealTimers())

  it('encadeado na carteira: só chama a sincronização depois que a carteira conclui', async () => {
    let soltar: (v: unknown) => void = () => undefined
    mockRefresh.mockReturnValue(new Promise((r) => (soltar = r)))
    mockLotes.mockResolvedValue({ estado: 'atualizada' })
    const recarregarLotes = jest.fn()
    renderHook(() => {
      const carteira = useCarteiraAoAbrir({ habilitado: true, aoAtualizar: jest.fn() })
      return useLotesAoAbrir({ habilitado: carteira.concluido, aoAtualizar: recarregarLotes })
    })
    await act(async () => {
      await jest.advanceTimersByTimeAsync(0)
    })
    expect(mockLotes).not.toHaveBeenCalled()
    await act(async () => {
      soltar({ estado: 'fresca' })
      await jest.advanceTimersByTimeAsync(0)
    })
    expect(mockLotes).toHaveBeenCalledTimes(1)
    expect(recarregarLotes).toHaveBeenCalledTimes(1)
  })

  it('passada que rodou e fechou em erro: recarrega e avisa com o motivo', async () => {
    mockLotes.mockResolvedValue({ estado: 'atualizada', motivo: 'nenhum título pôde ser lido' })
    const aoAtualizar = jest.fn()
    const { result } = renderHook(() => useLotesAoAbrir({ habilitado: true, aoAtualizar }))
    await act(async () => {
      await jest.advanceTimersByTimeAsync(0)
    })
    expect(aoAtualizar).toHaveBeenCalledTimes(1)
    expect(result.current.situacao).toBe('falhou')
    expect(result.current.aviso).toBe('nenhum título pôde ser lido')
  })
})
