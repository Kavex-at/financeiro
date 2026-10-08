import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { TituloAPagar } from '@/lib/sispag'
import { ExportarTitulosAPagarBotao } from './ExportarTitulosAPagarBotao'

jest.mock('@/lib/sispag', () => ({
  ...jest.requireActual('@/lib/sispag'),
  exportarTitulosAPagar: jest.fn(),
}))
jest.mock('@/lib/download', () => ({
  ...jest.requireActual('@/lib/download'),
  baixarBlob: jest.fn(),
}))
jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn() } }))

import { toast } from 'sonner'
import { baixarBlob } from '@/lib/download'
import { exportarTitulosAPagar } from '@/lib/sispag'

const titulo = (docCod: string, filCod = 7): TituloAPagar => ({
  filCod,
  docCod,
  titCod: '1',
  valor: 10,
  liberado: true,
  pago: false,
})

beforeEach(() => jest.clearAllMocks())

describe('ExportarTitulosAPagarBotao', () => {
  it('exporta as chaves de todas as linhas do filtro, na ordem, e baixa o arquivo', async () => {
    const arquivo = new Blob(['PK'])
    jest
      .mocked(exportarTitulosAPagar)
      .mockResolvedValue({ nome: 'sispag-titulos-a-pagar-2026-10-08.xlsx', arquivo })
    render(<ExportarTitulosAPagarBotao titulos={[titulo('802'), titulo('801', 2)]} />)

    await userEvent.click(screen.getByRole('button', { name: /exportar \(2\)/i }))

    await waitFor(() => expect(baixarBlob).toHaveBeenCalledWith(arquivo, expect.any(String)))
    expect(exportarTitulosAPagar).toHaveBeenCalledWith(['7:802:1', '2:801:1'])
    expect(toast.success).toHaveBeenCalled()
  })

  it('sem linhas no filtro fica desabilitado', () => {
    render(<ExportarTitulosAPagarBotao titulos={[]} />)
    expect(screen.getByRole('button', { name: /exportar \(0\)/i })).toBeDisabled()
  })

  it('falha do servidor vira toast de erro com a mensagem', async () => {
    jest.mocked(exportarTitulosAPagar).mockRejectedValue(new Error('Exporte de 1 a 5000 títulos.'))
    render(<ExportarTitulosAPagarBotao titulos={[titulo('1')]} />)
    await userEvent.click(screen.getByRole('button', { name: /exportar/i }))
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith('Não foi possível exportar os títulos', {
        description: 'Exporte de 1 a 5000 títulos.',
      }),
    )
    expect(baixarBlob).not.toHaveBeenCalled()
  })
})
