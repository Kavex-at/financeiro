import { act, render, renderHook, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { LotePagamento } from '@/lib/sispag'
import { ExportarTitulosBarra, useSelecaoRemessas } from './ExportarTitulosBarra'

jest.mock('@/lib/sispag', () => ({
  ...jest.requireActual('@/lib/sispag'),
  exportarTitulosRemessas: jest.fn(),
}))
jest.mock('@/lib/download', () => ({
  ...jest.requireActual('@/lib/download'),
  baixarBlob: jest.fn(),
}))
jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn() } }))

import { toast } from 'sonner'
import { baixarBlob } from '@/lib/download'
import { exportarTitulosRemessas } from '@/lib/sispag'

const lote = (id: string, status: LotePagamento['status'], valores: number[]): LotePagamento => ({
  id,
  filCod: 7,
  status,
  criadoPor: 'u1',
  versao: 1,
  itens: valores.map(
    (valor, i) =>
      ({
        loteId: id,
        filCod: 7,
        docCod: String(800 + i),
        titCod: '1',
        valor,
        incluidoPor: 'u1',
      }) as LotePagamento['itens'][number],
  ),
})

const LOTES = [
  lote('A', 'REMESSA_GERADA', [100, 50.5]),
  lote('B', 'BAIXADO', [10]),
  lote('C', 'FINALIZADO', [999]),
]

describe('ExportarTitulosBarra', () => {
  beforeEach(() => jest.clearAllMocks())

  it('some quando nenhum lote da aba tem remessa', () => {
    const { container } = render(
      <ExportarTitulosBarra lotes={[LOTES[2]]} selecionados={new Set()} onDefinir={jest.fn()} />,
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('sem seleção: orienta e deixa o export desabilitado', () => {
    render(<ExportarTitulosBarra lotes={LOTES} selecionados={new Set()} onDefinir={jest.fn()} />)
    expect(screen.getByText(/marque as remessas/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /exportar títulos/i })).toBeDisabled()
  })

  it('resume só os marcados que têm remessa e exporta os ids deles', async () => {
    const user = userEvent.setup()
    const arquivo = new Blob(['PK'])
    ;(exportarTitulosRemessas as jest.Mock).mockResolvedValue({ nome: 'x.xlsx', arquivo })
    // 'C' (sem remessa) e 'Z' (fora da lista) marcados não entram.
    render(
      <ExportarTitulosBarra
        lotes={LOTES}
        selecionados={new Set(['A', 'B', 'C', 'Z'])}
        onDefinir={jest.fn()}
      />,
    )
    expect(screen.getByText(/2 remessa\(s\) · 3 título\(s\)/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /exportar títulos/i }))
    expect(exportarTitulosRemessas).toHaveBeenCalledWith(['A', 'B'])
    await waitFor(() => expect(baixarBlob).toHaveBeenCalledWith(arquivo, 'x.xlsx'))
    expect(toast.success).toHaveBeenCalled()
  })

  it('erro do backend vira toast com a mensagem', async () => {
    const user = userEvent.setup()
    ;(exportarTitulosRemessas as jest.Mock).mockRejectedValue(new Error('ainda sem remessa gerada'))
    render(<ExportarTitulosBarra lotes={LOTES} selecionados={new Set(['A'])} onDefinir={jest.fn()} />)
    await user.click(screen.getByRole('button', { name: /exportar títulos/i }))
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith('Não foi possível exportar os títulos', {
        description: 'ainda sem remessa gerada',
      }),
    )
  })

  it('"Marcar todas" marca só os com remessa; com todos marcados vira "Limpar seleção"', async () => {
    const user = userEvent.setup()
    const onDefinir = jest.fn()
    const { rerender } = render(
      <ExportarTitulosBarra lotes={LOTES} selecionados={new Set()} onDefinir={onDefinir} />,
    )
    await user.click(screen.getByRole('button', { name: /marcar todas \(2\)/i }))
    expect(onDefinir).toHaveBeenCalledWith(['A', 'B'])

    rerender(
      <ExportarTitulosBarra lotes={LOTES} selecionados={new Set(['A', 'B'])} onDefinir={onDefinir} />,
    )
    await user.click(screen.getByRole('button', { name: /limpar seleção/i }))
    expect(onDefinir).toHaveBeenLastCalledWith([])
  })
})

describe('useSelecaoRemessas', () => {
  it('alterna e redefine a seleção', () => {
    const { result } = renderHook(() => useSelecaoRemessas())
    act(() => result.current.alternar(LOTES[0], true))
    act(() => result.current.alternar(LOTES[1], true))
    act(() => result.current.alternar(LOTES[0], false))
    expect([...result.current.selecionados]).toEqual(['B'])
    act(() => result.current.definir([]))
    expect(result.current.selecionados.size).toBe(0)
  })
})
