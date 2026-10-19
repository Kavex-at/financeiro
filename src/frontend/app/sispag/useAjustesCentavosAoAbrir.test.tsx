import { renderHook } from '@testing-library/react'
import { retomarAjustesCentavos } from '@/lib/sispag'
import { useAjustesCentavosAoAbrir } from './useCarteiraAoAbrir'

jest.mock('@/lib/sispag', () => ({
  ...jest.requireActual('@/lib/sispag'),
  retomarAjustesCentavos: jest.fn(async () => undefined),
}))

const retomar = retomarAjustesCentavos as jest.Mock

afterEach(() => jest.clearAllMocks())

describe('useAjustesCentavosAoAbrir (ADR-0073, I18g)', () => {
  it('sispag:executar ⇒ dispara a varredura UMA vez por abertura', () => {
    const { rerender } = renderHook((p) => useAjustesCentavosAoAbrir(p), {
      initialProps: { habilitado: false, podeExecutar: true },
    })
    expect(retomar).not.toHaveBeenCalled()
    rerender({ habilitado: true, podeExecutar: true })
    rerender({ habilitado: true, podeExecutar: true })
    expect(retomar).toHaveBeenCalledTimes(1)
  })

  it('só sispag:ver ⇒ não dispara', () => {
    renderHook(() => useAjustesCentavosAoAbrir({ habilitado: true, podeExecutar: false }))
    expect(retomar).not.toHaveBeenCalled()
  })
})
