import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ReconhecerAvisosGrupo } from './ReconhecerAvisosGrupo'

const resumo = {
  quantidadeTitulosAntes: 2,
  vencimentoBoleto: '2026-10-21',
  diferencaCentavos: 0,
  maiorAntecedenciaDias: 3,
}

describe('ReconhecerAvisosGrupo (extraído do diálogo de composição, I21i)', () => {
  it('mostra o que se reconhece e devolve os códigos dos avisos ao confirmar', async () => {
    const onConfirmar = jest.fn().mockResolvedValue(undefined)
    render(
      <ReconhecerAvisosGrupo
        avisos={['TITULO_VENCE_ANTES_DO_BOLETO']}
        resumo={resumo}
        onFechar={() => undefined}
        onConfirmar={onConfirmar}
      />,
    )
    const dlg = await screen.findByRole('dialog')
    expect(within(dlg).getByText(/2 título\(s\) vencem antes do boleto \(21\/10\/2026\)/)).toBeInTheDocument()
    expect(within(dlg).getByText('3 dias')).toBeInTheDocument()
    await userEvent.click(within(dlg).getByRole('checkbox'))
    await userEvent.click(within(dlg).getByRole('button', { name: /Reconhecer|Confirmar/ }))
    await waitFor(() => expect(onConfirmar).toHaveBeenCalledWith(['TITULO_VENCE_ANTES_DO_BOLETO']))
  })
})
