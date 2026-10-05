/**
 * Tabela de exceções de destino (ADR-0061): só máscaras, "Aprovar" bloqueado para o cadastrante
 * (com a razão), ações escondidas sem a permissão e o marcador de divergência do cadastro.
 */

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ExcecaoDestinoResumo } from '@/lib/sispag'
import { ExcecoesTable, mesmaPessoa } from './ExcecoesTable'

const exc = (over: Partial<ExcecaoDestinoResumo> = {}): ExcecaoDestinoResumo => ({
  id: 'E1',
  pesCod: '7001',
  filCod: 1,
  tipo: 'CONTA',
  destinoMascarado: 'banco 237 · ag. 1234 · cc ****7766-1',
  titularDocumentoMascarado: '***.444.777-**',
  estado: 'PENDENTE',
  origem: 'MANUAL',
  justificativa: 'cadastro desatualizado',
  cadastradoPor: 'ana',
  cadastradoEm: '2026-10-05T12:00:00.000Z',
  versao: 1,
  ...over,
})

const render_ = (
  excecoes: ExcecaoDestinoResumo[],
  over: Partial<React.ComponentProps<typeof ExcecoesTable>> = {},
) => {
  const fns = { onAprovar: jest.fn(), onRejeitar: jest.fn(), onRevogar: jest.fn() }
  render(<ExcecoesTable excecoes={excecoes} usuario="bia" podeAgir {...fns} {...over} />)
  return fns
}

describe('ExcecoesTable', () => {
  it('mostra só as máscaras e o estado em português', () => {
    render_([exc()])
    expect(screen.getByText('banco 237 · ag. 1234 · cc ****7766-1')).toBeInTheDocument()
    expect(screen.getByText('***.444.777-**')).toBeInTheDocument()
    expect(screen.getByText('Pendente')).toBeInTheDocument()
    expect(screen.getByText('TED')).toBeInTheDocument()
  })

  it('PENDENTE de outra pessoa: Aprovar e Rejeitar chamam os callbacks', async () => {
    const user = userEvent.setup()
    const { onAprovar, onRejeitar } = render_([exc()])
    await user.click(screen.getByRole('button', { name: /aprovar exceção do favorecido 7001/i }))
    expect(onAprovar).toHaveBeenCalledWith(expect.objectContaining({ id: 'E1' }))
    await user.click(screen.getByRole('button', { name: /rejeitar exceção do favorecido 7001/i }))
    expect(onRejeitar).toHaveBeenCalledTimes(1)
  })

  it('o cadastrante vê "Aprovar" desabilitado, com a razão no tooltip e para leitor de tela', async () => {
    const user = userEvent.setup()
    const { onAprovar, onRejeitar } = render_([exc({ cadastradoPor: 'Bia' })])
    const aprovar = screen.getByRole('button', { name: /aprovar exceção/i })
    expect(aprovar).toBeDisabled()
    expect(aprovar.closest('span')).toHaveAttribute('title', expect.stringMatching(/outra pessoa/))
    expect(aprovar).toHaveAccessibleDescription(/quem cadastrou a exceção não pode aprová-la/i)
    await user.click(aprovar)
    expect(onAprovar).not.toHaveBeenCalled()
    // Rejeitar a própria PENDENTE continua permitido.
    await user.click(screen.getByRole('button', { name: /rejeitar exceção/i }))
    expect(onRejeitar).toHaveBeenCalledTimes(1)
  })

  it('APROVADA: só Revogar (inclusive para o cadastrante)', async () => {
    const user = userEvent.setup()
    const { onRevogar } = render_([exc({ estado: 'APROVADA', cadastradoPor: 'bia' })])
    expect(screen.queryByRole('button', { name: /aprovar/i })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /revogar exceção do favorecido 7001/i }))
    expect(onRevogar).toHaveBeenCalledTimes(1)
  })

  it('estados terminais não têm ação', () => {
    render_([
      exc({ id: 'A', estado: 'REJEITADA' }),
      exc({ id: 'B', estado: 'REVOGADA' }),
      exc({ id: 'C', estado: 'SUBSTITUIDA' }),
    ])
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('sem permissão (podeAgir=false): nenhuma ação e nem a coluna', () => {
    render_([exc()], { podeAgir: false })
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(screen.queryByRole('columnheader', { name: /ações/i })).not.toBeInTheDocument()
  })

  it('SUBSTITUIDA com divergência do cadastro mostra o marcador; sem divergência, não', () => {
    render_([
      exc({ id: 'A', estado: 'SUBSTITUIDA', divergiu: true }),
      exc({ id: 'B', estado: 'SUBSTITUIDA' }),
    ])
    expect(screen.getAllByText('cadastro divergiu')).toHaveLength(1)
  })

  it('mostra o motivo da rejeição/revogação', () => {
    render_([exc({ estado: 'REVOGADA', motivoDecisao: 'fornecedor trocou de banco' })])
    expect(screen.getByText(/fornecedor trocou de banco/)).toBeInTheDocument()
  })

  it('mesmaPessoa ignora caixa e espaço e nunca iguala vazio/ausente', () => {
    expect(mesmaPessoa(' Ana ', 'ana')).toBe(true)
    expect(mesmaPessoa('ana', 'bia')).toBe(false)
    expect(mesmaPessoa(null, 'ana')).toBe(false)
    expect(mesmaPessoa('', '')).toBe(false)
  })
})
