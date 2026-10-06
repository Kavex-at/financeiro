/** Diálogo de tratar duplicidade (ADR-0063, I13f): justificar exige texto; retirar avisa do Conexos. */

import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { AlertaItemLote, ItemLote, LotePagamento } from '@/lib/sispag'

jest.mock('@/lib/sispag', () => {
  const real = jest.requireActual('@/lib/sispag')
  return { ...real, resolverAlertaDuplicidade: jest.fn() }
})

import { resolverAlertaDuplicidade } from '@/lib/sispag'
import { ResolverDuplicidadeDialog } from './ResolverDuplicidadeDialog'

const item: ItemLote = {
  loteId: 'L1',
  filCod: 4,
  docCod: '6173',
  titCod: '1',
  credor: 'FORNECEDOR A',
  valor: 18450,
  modalidade: 'TED',
  incluidoPor: 'ana',
}
const alerta: AlertaItemLote = {
  id: 'A1',
  loteId: 'L1',
  filCod: 4,
  docCod: '6173',
  titCod: '1',
  tipo: 'DUPLICIDADE_FORTE',
  contraparteFilCod: 4,
  contraparteDocCod: '6702',
  contraparteTitulos: [{ titCod: '1', valor: 18450, pago: true }],
  evidencia: {},
  estado: 'ABERTA',
  criadoEm: '2026-10-05T10:00:00.000Z',
  verificadoEm: '2026-10-05T10:00:00.000Z',
}
const lote = { id: 'L1', filCod: 4, status: 'RASCUNHO', criadoPor: 'ana', versao: 3, itens: [item] } as LotePagamento

const renderDialog = () => {
  const onResolvida = jest.fn()
  render(
    <ResolverDuplicidadeDialog
      lote={lote}
      item={item}
      alerta={alerta}
      onOpenChange={jest.fn()}
      onResolvida={onResolvida}
    />,
  )
  return onResolvida
}

beforeEach(() => jest.clearAllMocks())

describe('ResolverDuplicidadeDialog', () => {
  it('mostra a contraparte, inclusive já paga', () => {
    renderDialog()
    expect(screen.getByText(/doc 6702 \(mesma NF/)).toBeInTheDocument()
    expect(screen.getByText('já pago')).toBeInTheDocument()
  })

  it('justificar sem texto não chama a API', async () => {
    renderDialog()
    await userEvent.click(screen.getByRole('button', { name: 'Manter e justificar' }))
    expect(screen.getByRole('alert')).toHaveTextContent(/Informe a justificativa/)
    expect(resolverAlertaDuplicidade).not.toHaveBeenCalled()
  })

  it('justificar com texto chama a API e devolve o lote', async () => {
    ;(resolverAlertaDuplicidade as jest.Mock).mockResolvedValue(lote)
    const onResolvida = renderDialog()
    await userEvent.type(screen.getByLabelText('Justificativa'), 'NF de serviço e de produto')
    await userEvent.click(screen.getByRole('button', { name: 'Manter e justificar' }))
    await waitFor(() => expect(onResolvida).toHaveBeenCalledWith(lote, 'JUSTIFICAR'))
    expect(resolverAlertaDuplicidade).toHaveBeenCalledWith(
      'L1',
      { filCod: 4, docCod: '6173', titCod: '1' },
      'A1',
      { acao: 'JUSTIFICAR', justificativa: 'NF de serviço e de produto' },
    )
  })

  it('retirar avisa para cancelar no Conexos e não exige texto', async () => {
    ;(resolverAlertaDuplicidade as jest.Mock).mockResolvedValue(lote)
    const onResolvida = renderDialog()
    await userEvent.click(screen.getByRole('radio', { name: /Retirar do lote/ }))
    expect(screen.getByRole('status')).toHaveTextContent(/Cancele o documento duplicado no Conexos/)
    await userEvent.click(screen.getByRole('button', { name: 'Retirar do lote' }))
    await waitFor(() => expect(onResolvida).toHaveBeenCalledWith(lote, 'RETIRAR'))
    expect((resolverAlertaDuplicidade as jest.Mock).mock.calls[0][3]).toEqual({ acao: 'RETIRAR' })
  })

  it('erro do backend aparece em português, no diálogo', async () => {
    ;(resolverAlertaDuplicidade as jest.Mock).mockRejectedValue(
      new Error('Esta alerta de duplicidade já foi tratada ou deixou de valer. Atualize o lote.'),
    )
    renderDialog()
    await userEvent.type(screen.getByLabelText('Justificativa'), 'x')
    await userEvent.click(screen.getByRole('button', { name: 'Manter e justificar' }))
    expect(await screen.findByText(/já foi tratada/)).toBeInTheDocument()
  })
})
