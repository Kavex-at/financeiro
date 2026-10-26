import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { RetirarDoLoteDialog } from './RetirarDoLoteDialog'

const GRUPO = {
  grupoId: 'G1',
  codbarMascarado: '34191…7500',
  credor: 'PEDRONI',
  titulos: ['901', '902', '903'].map((docCod) => ({ filCod: 2, docCod, titCod: '1' })),
}

describe('RetirarDoLoteDialog — boleto agrupado (I21j)', () => {
  it('com `grupo`: o título do diálogo é do grupo, lista os N títulos e diz que sai inteiro', () => {
    render(
      <RetirarDoLoteDialog
        titulo={null}
        grupo={GRUPO}
        onClose={jest.fn()}
        salvando={false}
        onConfirmar={jest.fn()}
      />,
    )
    expect(screen.getByRole('dialog', { name: 'Retirar boleto agrupado' })).toBeInTheDocument()
    expect(screen.getByText('34191…7500')).toBeInTheDocument()
    for (const d of ['901', '902', '903']) expect(screen.getByText(`${d}/1`)).toBeInTheDocument()
    expect(screen.getByText(/sai inteiro/)).toBeInTheDocument()
    expect(screen.getByText(/Nada é escrito no ERP/)).toBeInTheDocument()
  })

  it('confirmar e cancelar; salvando desabilita os dois', async () => {
    const onConfirmar = jest.fn()
    const onClose = jest.fn()
    const { rerender } = render(
      <RetirarDoLoteDialog
        titulo={null}
        grupo={GRUPO}
        onClose={onClose}
        salvando={false}
        onConfirmar={onConfirmar}
      />,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Retirar do lote' }))
    expect(onConfirmar).toHaveBeenCalledTimes(1)
    rerender(
      <RetirarDoLoteDialog
        titulo={null}
        grupo={GRUPO}
        onClose={onClose}
        salvando
        onConfirmar={onConfirmar}
      />,
    )
    expect(screen.getByRole('button', { name: 'Retirar do lote' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Cancelar' })).toBeDisabled()
  })

  it('sem título nem grupo o diálogo fica fechado (comportamento de antes)', () => {
    render(
      <RetirarDoLoteDialog titulo={null} onClose={jest.fn()} salvando={false} onConfirmar={jest.fn()} />,
    )
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
