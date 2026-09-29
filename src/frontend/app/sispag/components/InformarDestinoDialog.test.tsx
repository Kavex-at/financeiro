/**
 * "Informar destino" (ADR-0054): a analista digita a conta (TED) ou a chave (PIX) do item. O
 * formato é conferido aqui, espelhando o backend; a titularidade e o congelamento são do backend,
 * e a mensagem dele aparece no diálogo. O valor digitado nunca vai para o console.
 */

import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ItemLote, LotePagamento } from '@/lib/sispag'
import { InformarDestinoDialog } from './InformarDestinoDialog'

jest.mock('@/lib/sispag', () => {
  const real = jest.requireActual('@/lib/sispag')
  return { ...real, definirDestinoItem: jest.fn() }
})

import { definirDestinoItem } from '@/lib/sispag'

const mockDefinir = definirDestinoItem as jest.MockedFunction<typeof definirDestinoItem>

const item: ItemLote = {
  loteId: 'L1',
  filCod: 7,
  docCod: '801',
  titCod: '1',
  credor: 'ACME',
  modalidade: 'TED',
  incluidoPor: 'u1',
}
const lote: LotePagamento = {
  id: 'L1',
  filCod: 7,
  status: 'RASCUNHO',
  criadoPor: 'u1',
  versao: 3,
  itens: [item],
}

const renderDialog = (o: { pixEnabled?: boolean; tedEnabled?: boolean } = {}) => {
  const onSalvo = jest.fn()
  const onOpenChange = jest.fn()
  render(
    <InformarDestinoDialog
      lote={lote}
      item={item}
      tedEnabled={o.tedEnabled ?? true}
      pixEnabled={o.pixEnabled ?? false}
      onOpenChange={onOpenChange}
      onSalvo={onSalvo}
    />,
  )
  return { onSalvo, onOpenChange, dialog: screen.getByRole('dialog', { name: 'Informar destino' }) }
}

const preencherConta = async (
  user: ReturnType<typeof userEvent.setup>,
  over: Partial<Record<'banco' | 'agencia' | 'conta' | 'dv' | 'titular', string>> = {},
) => {
  await user.type(screen.getByLabelText('Banco (FEBRABAN)'), over.banco ?? '237')
  await user.type(screen.getByLabelText('Agência'), over.agencia ?? '1234')
  await user.type(screen.getByLabelText('Conta'), over.conta ?? '99887766')
  await user.type(screen.getByLabelText('DV da conta'), over.dv ?? '1')
  await user.type(screen.getByLabelText('CPF/CNPJ do titular'), over.titular ?? '111.444.777-35')
}

describe('InformarDestinoDialog', () => {
  beforeEach(() => jest.clearAllMocks())

  it('TED: grava a conta normalizada com a versão do lote', async () => {
    const user = userEvent.setup()
    mockDefinir.mockResolvedValueOnce(lote)
    const { onSalvo } = renderDialog()
    await preencherConta(user)
    await user.click(screen.getByRole('button', { name: 'Salvar destino' }))

    expect(mockDefinir).toHaveBeenCalledWith('L1', {
      filCod: 7,
      docCod: '801',
      titCod: '1',
      versao: 3,
      destino: {
        tipo: 'CONTA',
        bancoCod: '237',
        agencia: '1234',
        conta: '99887766',
        contaDv: '1',
        titularDocumento: '11144477735',
      },
    })
    expect(onSalvo).toHaveBeenCalledWith(lote)
  })

  it('validação de formato no cliente: não chama a API e marca os campos', async () => {
    const user = userEvent.setup()
    const { dialog } = renderDialog()
    await preencherConta(user, { banco: '37', titular: '11144477736' })
    await user.click(screen.getByRole('button', { name: 'Salvar destino' }))

    expect(mockDefinir).not.toHaveBeenCalled()
    expect(screen.getByLabelText('Banco (FEBRABAN)')).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByLabelText('CPF/CNPJ do titular')).toHaveAttribute('aria-invalid', 'true')
    expect(within(dialog).getByText('Use o código FEBRABAN de 3 dígitos.')).toBeInTheDocument()
  })

  it('erro de titularidade do backend aparece no diálogo, que fica aberto', async () => {
    const user = userEvent.setup()
    mockDefinir.mockRejectedValueOnce(
      new Error('O CPF/CNPJ do titular não é o do favorecido do título 801/1.'),
    )
    const { onSalvo, dialog } = renderDialog()
    await preencherConta(user)
    await user.click(screen.getByRole('button', { name: 'Salvar destino' }))

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(/titular não é o do favorecido/)
    expect(onSalvo).not.toHaveBeenCalled()
  })

  it('aba PIX só existe com a flag PIX ligada', () => {
    renderDialog({ pixEnabled: false })
    expect(screen.queryByRole('tab', { name: 'PIX' })).not.toBeInTheDocument()
  })

  it('PIX digitado: só o tipo CPF/CNPJ é oferecido (titular conferível)', async () => {
    const user = userEvent.setup()
    mockDefinir.mockResolvedValueOnce(lote)
    renderDialog({ pixEnabled: true, tedEnabled: false })
    // Sem TED, o diálogo abre direto no PIX.
    expect(screen.getAllByRole('radio').map((r) => r.closest('label')?.textContent)).toEqual([
      'CPF/CNPJ',
    ])
    expect(screen.queryByRole('radio', { name: 'Telefone' })).not.toBeInTheDocument()
    await user.type(screen.getByLabelText('Chave PIX'), '111.444.777-35')
    await user.type(screen.getByLabelText('CPF/CNPJ do titular'), '11144477735')
    await user.click(screen.getByRole('button', { name: 'Salvar destino' }))

    expect(mockDefinir).toHaveBeenCalledWith(
      'L1',
      expect.objectContaining({
        destino: {
          tipo: 'CHAVE_PIX',
          chavePixTipo: 'CPF_CNPJ',
          chavePix: '11144477735',
          titularDocumento: '11144477735',
        },
      }),
    )
  })

  it('o valor digitado nunca vai para o console', async () => {
    const user = userEvent.setup()
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) =>
      jest.spyOn(console, m).mockImplementation(() => undefined),
    )
    mockDefinir.mockRejectedValueOnce(new Error('falhou'))
    renderDialog()
    await preencherConta(user)
    await user.click(screen.getByRole('button', { name: 'Salvar destino' }))
    await screen.findByRole('alert')

    const tudo = JSON.stringify(spies.map((s) => s.mock.calls))
    expect(tudo).not.toContain('99887766')
    expect(tudo).not.toContain('11144477735')
    for (const s of spies) s.mockRestore()
  })
})
