/**
 * O grupo no lote é UMA linha (ADR-0077, I21j): boleto mascarado, total, credor, vencimento do
 * boleto e situação, que expande os N títulos. Retirar age no grupo inteiro.
 */
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { GrupoNoLote, ItemLote } from '@/lib/sispag'
import { GrupoBoletoLinha } from './GrupoBoletoLinha'

const TITULOS = ['901', '902', '903'].map((docCod) => ({ filCod: 2, docCod, titCod: '1' }))
const grupo = (over: Partial<GrupoNoLote> = {}): GrupoNoLote => ({
  grupoId: 'G1',
  codbarMascarado: '34191…7500',
  valorBoleto: 1575,
  vencimentoBoleto: '2026-10-21',
  credor: 'PEDRONI',
  situacao: 'EM_LOTE',
  titulos: TITULOS,
  ...over,
})
const itens: ItemLote[] = TITULOS.map((t) => ({
  loteId: 'L1',
  ...t,
  credor: 'PEDRONI',
  valor: 525,
  modalidade: 'BOLETO',
  incluidoPor: 'bia',
  grupoBoletoId: 'G1',
}))

const renderLinha = (over: Record<string, unknown> = {}) => {
  const onRetirar = jest.fn()
  render(
    <table>
      <tbody>
        <GrupoBoletoLinha grupo={grupo()} itens={itens} onRetirar={onRetirar} {...over} />
      </tbody>
    </table>,
  )
  return { onRetirar }
}

describe('GrupoBoletoLinha', () => {
  it('é UMA linha com boleto mascarado, total, credor, vencimento do boleto e situação', () => {
    renderLinha()
    const linha = screen.getByRole('row', { name: /Boleto agrupado/ })
    expect(within(linha).getByText('34191…7500')).toBeInTheDocument()
    expect(within(linha).getByText(/1\.575,00/)).toBeInTheDocument()
    expect(within(linha).getByText('PEDRONI')).toBeInTheDocument()
    expect(within(linha).getByText('21/10/2026')).toBeInTheDocument()
    expect(within(linha).getByText('Em lote')).toBeInTheDocument()
    expect(within(linha).getByText(/3 títulos/)).toBeInTheDocument()
    expect(screen.queryByText('901/1')).not.toBeInTheDocument()
  })

  it('expande os N títulos com o valor de cada um e recolhe de novo', async () => {
    renderLinha()
    const abrir = screen.getByRole('button', { name: /Mostrar os 3 títulos/ })
    expect(abrir).toHaveAttribute('aria-expanded', 'false')
    await userEvent.click(abrir)
    for (const t of TITULOS) expect(screen.getByText(`${t.docCod}/${t.titCod}`)).toBeInTheDocument()
    expect(screen.getAllByText(/525,00/).length).toBe(3)
    expect(screen.getByRole('button', { name: /Ocultar os 3 títulos/ })).toHaveAttribute(
      'aria-expanded',
      'true',
    )
    await userEvent.click(screen.getByRole('button', { name: /Ocultar os 3 títulos/ }))
    expect(screen.queryByText('901/1')).not.toBeInTheDocument()
  })

  it('retirar age no grupo: um botão só, que entrega o grupo inteiro', async () => {
    const { onRetirar } = renderLinha()
    await userEvent.click(screen.getByRole('button', { name: /Retirar boleto agrupado 34191…7500/ }))
    expect(onRetirar).toHaveBeenCalledTimes(1)
    expect(onRetirar).toHaveBeenCalledWith(expect.objectContaining({ grupoId: 'G1' }))
    expect(screen.queryByRole('button', { name: /Retirar título/ })).not.toBeInTheDocument()
  })

  it('sem onRetirar (sem executar, ou lote que não é rascunho) não há botão de retirar', () => {
    renderLinha({ onRetirar: undefined })
    expect(screen.queryByRole('button', { name: /Retirar boleto agrupado/ })).not.toBeInTheDocument()
  })

  it('ocupado: o botão de retirar fica desabilitado', () => {
    renderLinha({ ocupado: true })
    expect(screen.getByRole('button', { name: /Retirar boleto agrupado/ })).toBeDisabled()
  })

  it('REJEITADO mostra o que fazer com o borderô antigo', () => {
    renderLinha({ grupo: grupo({ situacao: 'REJEITADO' }) })
    expect(
      screen.getByText(/Resolva o borderô antigo no Conexos antes de pôr o grupo num lote novo/),
    ).toBeInTheDocument()
  })

  it('divergência de título do grupo fica visível na linha expandida', async () => {
    renderLinha({
      itens: itens.map((i, n) =>
        n === 0 ? { ...i, divergencia: true, divergenciaDetalhe: 'boleto agrupado com parte dos títulos pagos' } : i,
      ),
    })
    await userEvent.click(screen.getByRole('button', { name: /Mostrar os 3 títulos/ }))
    expect(screen.getByText(/parte dos títulos pagos/)).toBeInTheDocument()
  })

  it('nenhum código completo na tela', () => {
    renderLinha()
    expect(document.body.textContent).not.toMatch(/\d{44}|\d{47}/)
  })
})
