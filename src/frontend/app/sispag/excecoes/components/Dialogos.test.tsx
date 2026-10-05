/**
 * Diálogos da exceção de destino (ADR-0061): cadastrar (formato no cliente, erro do servidor
 * inline, sem reexibir o valor), aprovar (só máscaras, erro 403 inline) e rejeitar/revogar
 * (motivo obrigatório). Acessíveis por teclado: Esc fecha, campos com label.
 */

import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ExcecaoDestinoResumo } from '@/lib/sispag'

jest.mock('@/lib/sispag', () => {
  const real = jest.requireActual('@/lib/sispag')
  return {
    ...real,
    cadastrarExcecao: jest.fn(),
    aprovarExcecao: jest.fn(),
    rejeitarExcecao: jest.fn(),
    revogarExcecao: jest.fn(),
  }
})

import { aprovarExcecao, cadastrarExcecao, rejeitarExcecao, revogarExcecao } from '@/lib/sispag'
import { AprovarExcecaoDialog } from './AprovarExcecaoDialog'
import { CadastrarExcecaoDialog } from './CadastrarExcecaoDialog'
import { RevogarExcecaoDialog } from './RevogarExcecaoDialog'

const exc: ExcecaoDestinoResumo = {
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
}

beforeEach(() => jest.clearAllMocks())

describe('CadastrarExcecaoDialog', () => {
  const abrir = (over: Partial<React.ComponentProps<typeof CadastrarExcecaoDialog>> = {}) => {
    const onCadastrada = jest.fn()
    const onOpenChange = jest.fn()
    render(
      <CadastrarExcecaoDialog
        tedEnabled
        pixEnabled
        onCadastrada={onCadastrada}
        onOpenChange={onOpenChange}
        {...over}
      />,
    )
    return { onCadastrada, onOpenChange }
  }

  const preencherConta = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.type(screen.getByLabelText('Banco (FEBRABAN)'), '237')
    await user.type(screen.getByLabelText('Agência'), '1234')
    await user.type(screen.getByLabelText('Conta'), '99887766')
    await user.type(screen.getByLabelText('DV da conta'), '1')
    await user.type(screen.getByLabelText('CPF/CNPJ do titular'), '11144477735')
  }

  it('na tela de exceções pede filial e favorecido; formato e justificativa são conferidos antes de chamar a API', async () => {
    const user = userEvent.setup()
    abrir()
    await user.click(screen.getByRole('button', { name: /cadastrar exceção/i }))
    expect(await screen.findByText('Informe a filial.')).toBeInTheDocument()
    expect(screen.getByText('Informe o código do favorecido.')).toBeInTheDocument()
    expect(screen.getByText('Explique por que o destino difere do cadastro do Conexos.')).toBeInTheDocument()
    expect(cadastrarExcecao).not.toHaveBeenCalled()
  })

  it('cadastra por pesCod e filial, com o destino normalizado e a justificativa', async () => {
    ;(cadastrarExcecao as jest.Mock).mockResolvedValue(exc)
    const user = userEvent.setup()
    const { onCadastrada } = abrir()
    await user.type(screen.getByLabelText('Filial'), '1')
    await user.type(screen.getByLabelText(/código do favorecido/i), '7001')
    await preencherConta(user)
    await user.type(screen.getByLabelText('Justificativa'), 'cadastro desatualizado')
    await user.click(screen.getByRole('button', { name: /cadastrar exceção/i }))
    await waitFor(() => expect(onCadastrada).toHaveBeenCalledWith(exc))
    expect(cadastrarExcecao).toHaveBeenCalledWith({
      filCod: 1,
      pesCod: '7001',
      destino: {
        tipo: 'CONTA',
        bancoCod: '237',
        agencia: '1234',
        conta: '99887766',
        contaDv: '1',
        titularDocumento: '11144477735',
      },
      justificativa: 'cadastro desatualizado',
    })
  })

  it('a partir de um título: manda docCod/titCod (o backend lê o favorecido) e nenhum campo de pesCod', async () => {
    ;(cadastrarExcecao as jest.Mock).mockResolvedValue(exc)
    const user = userEvent.setup()
    abrir({ favorecido: { filCod: 7, docCod: '801', titCod: '1', credor: 'ACME' } })
    expect(screen.queryByLabelText(/código do favorecido/i)).not.toBeInTheDocument()
    await preencherConta(user)
    await user.type(screen.getByLabelText('Justificativa'), 'j')
    await user.click(screen.getByRole('button', { name: /cadastrar exceção/i }))
    await waitFor(() => expect(cadastrarExcecao).toHaveBeenCalled())
    expect(cadastrarExcecao).toHaveBeenCalledWith(
      expect.objectContaining({ filCod: 7, docCod: '801', titCod: '1' }),
    )
    expect((cadastrarExcecao as jest.Mock).mock.calls[0][0]).not.toHaveProperty('pesCod')
  })

  it('PIX só aceita chave CPF/CNPJ: outra chave é recusada no cliente', async () => {
    const user = userEvent.setup()
    abrir({ favorecido: { filCod: 7, docCod: '801', titCod: '1' }, preferirPix: true })
    expect(screen.getByRole('tab', { name: /PIX/ })).toHaveAttribute('aria-selected', 'true')
    await user.type(screen.getByLabelText('Chave PIX (CPF/CNPJ)'), 'a@b.com')
    await user.type(screen.getByLabelText('CPF/CNPJ do titular'), '11144477735')
    await user.type(screen.getByLabelText('Justificativa'), 'j')
    await user.click(screen.getByRole('button', { name: /cadastrar exceção/i }))
    expect(await screen.findByText('Chave inválida para o tipo escolhido.')).toBeInTheDocument()
    expect(cadastrarExcecao).not.toHaveBeenCalled()
  })

  it('erro do servidor (422 titularidade) fica inline, o diálogo segue aberto e o valor não é reexibido', async () => {
    ;(cadastrarExcecao as jest.Mock).mockRejectedValue(
      new Error('O CPF/CNPJ do titular não é o do favorecido.'),
    )
    const user = userEvent.setup()
    const { onCadastrada } = abrir({ favorecido: { filCod: 7, docCod: '801', titCod: '1' } })
    await preencherConta(user)
    await user.type(screen.getByLabelText('Justificativa'), 'j')
    await user.click(screen.getByRole('button', { name: /cadastrar exceção/i }))
    const alerta = await screen.findByRole('alert')
    expect(alerta).toHaveTextContent('O CPF/CNPJ do titular não é o do favorecido.')
    expect(onCadastrada).not.toHaveBeenCalled()
    expect(alerta).not.toHaveTextContent('99887766')
  })

  it('Esc fecha o diálogo', async () => {
    const user = userEvent.setup()
    const { onOpenChange } = abrir()
    await user.keyboard('{Escape}')
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })
})

describe('AprovarExcecaoDialog', () => {
  it('mostra só as máscaras, o cadastrante e a justificativa; aprova ao confirmar', async () => {
    ;(aprovarExcecao as jest.Mock).mockResolvedValue({ ...exc, estado: 'APROVADA' })
    const onAprovada = jest.fn()
    const user = userEvent.setup()
    render(<AprovarExcecaoDialog excecao={exc} onOpenChange={jest.fn()} onAprovada={onAprovada} />)
    const dialog = screen.getByRole('dialog', { name: 'Aprovar exceção de destino' })
    expect(within(dialog).getByText('banco 237 · ag. 1234 · cc ****7766-1')).toBeInTheDocument()
    expect(within(dialog).getByText('***.444.777-**')).toBeInTheDocument()
    expect(within(dialog).getByText('ana')).toBeInTheDocument()
    expect(aprovarExcecao).not.toHaveBeenCalled()
    await user.click(within(dialog).getByRole('button', { name: /aprovar exceção/i }))
    await waitFor(() => expect(onAprovada).toHaveBeenCalled())
    expect(aprovarExcecao).toHaveBeenCalledWith('E1')
  })

  it('403 do backend (aprovar a própria) fica inline e o diálogo não fecha', async () => {
    ;(aprovarExcecao as jest.Mock).mockRejectedValue(
      new Error('Quem cadastrou a exceção de destino não pode aprová-la.'),
    )
    const onAprovada = jest.fn()
    const user = userEvent.setup()
    render(<AprovarExcecaoDialog excecao={exc} onOpenChange={jest.fn()} onAprovada={onAprovada} />)
    await user.click(screen.getByRole('button', { name: /aprovar exceção/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent('não pode aprová-la')
    expect(onAprovada).not.toHaveBeenCalled()
  })
})

describe('RevogarExcecaoDialog (rejeitar e revogar exigem motivo)', () => {
  it.each([
    ['rejeitar', rejeitarExcecao, /rejeitar exceção$/i],
    ['revogar', revogarExcecao, /revogar exceção$/i],
  ] as const)('%s: motivo vazio é recusado; com motivo chama a API', async (acao, fn, botao) => {
    ;(fn as jest.Mock).mockResolvedValue({ ...exc })
    const onConcluida = jest.fn()
    const user = userEvent.setup()
    render(
      <RevogarExcecaoDialog
        excecao={exc}
        acao={acao}
        onOpenChange={jest.fn()}
        onConcluida={onConcluida}
      />,
    )
    await user.click(screen.getByRole('button', { name: botao }))
    expect(await screen.findByText('Informe o motivo.')).toBeInTheDocument()
    expect(fn).not.toHaveBeenCalled()
    await user.type(screen.getByLabelText('Motivo'), '  fornecedor trocou ')
    await user.click(screen.getByRole('button', { name: botao }))
    await waitFor(() => expect(onConcluida).toHaveBeenCalled())
    expect(fn).toHaveBeenCalledWith('E1', 'fornecedor trocou')
  })

  it('erro do servidor fica inline', async () => {
    ;(revogarExcecao as jest.Mock).mockRejectedValue(new Error('A exceção já mudou de estado.'))
    const user = userEvent.setup()
    render(
      <RevogarExcecaoDialog
        excecao={exc}
        acao="revogar"
        onOpenChange={jest.fn()}
        onConcluida={jest.fn()}
      />,
    )
    await user.type(screen.getByLabelText('Motivo'), 'x')
    await user.click(screen.getByRole('button', { name: /revogar exceção$/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent('já mudou de estado')
  })
})
