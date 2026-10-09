/**
 * Pedir autorização sem abrir o Conexos: busca no cadastro (nome, CNPJ/CPF, código), escolha numa
 * lista com documento mascarado e prévia mascarada do destino. Sem destino no cadastro, não pede.
 */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { BuscaFavorecidos } from '@/lib/sispag'

jest.mock('@/lib/sispag', () => {
  const real = jest.requireActual('@/lib/sispag')
  return {
    ...real,
    buscarFavorecidos: jest.fn(),
    previaDestinoFavorecido: jest.fn(),
    pedirAutorizacao: jest.fn(),
  }
})

import { buscarFavorecidos, pedirAutorizacao, previaDestinoFavorecido } from '@/lib/sispag'
import { SolicitarAutorizacaoDialog } from './SolicitarAutorizacaoDialog'

const busca = (over: Partial<BuscaFavorecidos> = {}): BuscaFavorecidos => ({
  favorecidos: [
    {
      pesCod: '77',
      nome: 'ACME LTDA',
      nomeFantasia: 'ACME',
      documentoMascarado: '**.345.678/****-**',
      situacao: 1,
      autorizacao: { TED: { estado: 'AUTORIZADO', id: 'A1' }, PIX: { estado: 'NENHUMA' } },
    },
    {
      pesCod: '88',
      nome: 'BETA SA',
      situacao: 4,
      autorizacao: { TED: { estado: 'NENHUMA' }, PIX: { estado: 'NENHUMA' } },
    },
  ],
  truncado: false,
  ...over,
})

const renderizar = (props: Partial<React.ComponentProps<typeof SolicitarAutorizacaoDialog>> = {}) => {
  const onSolicitada = jest.fn()
  render(
    <SolicitarAutorizacaoDialog
      origem="MANUAL"
      onOpenChange={jest.fn()}
      onSolicitada={onSolicitada}
      {...props}
    />,
  )
  return { onSolicitada }
}

const digitar = (texto: string) =>
  fireEvent.change(screen.getByLabelText(/^favorecido$/i), { target: { value: texto } })

beforeEach(() => {
  jest.clearAllMocks()
  ;(buscarFavorecidos as jest.Mock).mockResolvedValue(busca())
  ;(previaDestinoFavorecido as jest.Mock).mockResolvedValue({
    resultado: 'OK',
    destinoMascarado: 'PIX e-mail · f***@empresa.com.br',
    avisos: [],
  })
})

describe('SolicitarAutorizacaoDialog — busca no Conexos', () => {
  it('não pede código: busca por nome e lista com documento mascarado, situação e autorização', async () => {
    renderizar()
    expect(screen.queryByLabelText(/código do favorecido/i)).not.toBeInTheDocument()
    digitar('acme')
    const lista = within(await screen.findByRole('list', { name: /favorecidos encontrados/i }))
    expect(buscarFavorecidos).toHaveBeenCalledTimes(1)
    expect((buscarFavorecidos as jest.Mock).mock.calls[0][0]).toBe('acme')
    expect(lista.getByText('ACME LTDA')).toBeInTheDocument()
    expect(lista.getByText(/\*\*\.345\.678\/\*\*\*\*-\*\*/)).toBeInTheDocument()
    expect(lista.getByText(/TED autorizado/i)).toBeInTheDocument()
    expect(lista.getByText('Bloqueado')).toBeInTheDocument()
  })

  it('texto com menos de 3 letras não vai ao Conexos', async () => {
    renderizar()
    digitar('ac')
    expect(await screen.findByText(/ao menos 3 letras/i)).toBeInTheDocument()
    await new Promise((r) => setTimeout(r, 450))
    expect(buscarFavorecidos).not.toHaveBeenCalled()
  })

  it('escolher mostra a prévia mascarada; modalidade já autorizada fica desabilitada e o pedido vai na livre', async () => {
    const { onSolicitada } = renderizar()
    ;(pedirAutorizacao as jest.Mock).mockResolvedValue({ id: 'N1' })
    digitar('acme')
    await userEvent.click(await screen.findByRole('button', { name: /escolher ACME LTDA/i }))

    expect(screen.getByRole('radio', { name: /TED/ })).toBeDisabled()
    expect(screen.getByRole('radio', { name: /PIX/ })).toBeChecked()
    expect(await screen.findByText('PIX e-mail · f***@empresa.com.br')).toBeInTheDocument()
    expect(previaDestinoFavorecido).toHaveBeenLastCalledWith('77', 'PIX', expect.anything())

    await userEvent.click(screen.getByRole('button', { name: /^pedir autorização$/i }))
    await waitFor(() =>
      expect(pedirAutorizacao).toHaveBeenCalledWith({
        pesCod: '77',
        credor: 'ACME LTDA',
        modalidade: 'PIX',
        origem: 'MANUAL',
      }),
    )
    expect(onSolicitada).toHaveBeenCalledWith({ id: 'N1' })
  })

  it('cadastro sem destino para a modalidade: avisa e não deixa pedir', async () => {
    ;(previaDestinoFavorecido as jest.Mock).mockResolvedValue({ resultado: 'SEM_DADO', avisos: [] })
    renderizar()
    digitar('beta')
    await userEvent.click(await screen.findByRole('button', { name: /escolher BETA SA/i }))
    expect(await screen.findByText(/não tem conta para este favorecido/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^pedir autorização$/i })).toBeDisabled()
  })

  it('enquanto a prévia não chega, não deixa pedir (o "sem destino" ainda pode vir)', async () => {
    let resolver: (v: unknown) => void = () => undefined
    ;(previaDestinoFavorecido as jest.Mock).mockReturnValue(new Promise((r) => { resolver = r }))
    renderizar()
    digitar('beta')
    await userEvent.click(await screen.findByRole('button', { name: /escolher BETA SA/i }))
    expect(screen.getByRole('button', { name: /^pedir autorização$/i })).toBeDisabled()
    resolver({ resultado: 'OK', destinoMascarado: 'banco 237 · cc ****4321', avisos: [] })
    await waitFor(() => expect(screen.getByRole('button', { name: /^pedir autorização$/i })).toBeEnabled())
  })

  it('"Trocar" volta à lista do mesmo termo sem buscar de novo', async () => {
    renderizar()
    digitar('beta')
    await userEvent.click(await screen.findByRole('button', { name: /escolher BETA SA/i }))
    await userEvent.click(screen.getByRole('button', { name: /trocar/i }))
    expect(await screen.findByRole('button', { name: /escolher BETA SA/i })).toBeInTheDocument()
    expect(buscarFavorecidos).toHaveBeenCalledTimes(1)
  })

  it('busca que falha mostra o erro e não tenta de novo sozinha', async () => {
    ;(buscarFavorecidos as jest.Mock).mockRejectedValue(new Error('Conexos indisponível'))
    renderizar()
    digitar('acme')
    expect(await screen.findByText('Conexos indisponível')).toBeInTheDocument()
    await new Promise((r) => setTimeout(r, 100))
    expect(buscarFavorecidos).toHaveBeenCalledTimes(1)
  })

  it('prévia barrada pelo limite (429) mostra a mensagem do servidor e não bloqueia o pedido', async () => {
    const { AutorizacaoApiError } = jest.requireActual('@/lib/sispag')
    ;(previaDestinoFavorecido as jest.Mock).mockRejectedValue(
      new AutorizacaoApiError('Muitas buscas em pouco tempo. Aguarde um minuto e tente de novo.', 429, 'MUITAS_BUSCAS'),
    )
    renderizar()
    digitar('beta')
    await userEvent.click(await screen.findByRole('button', { name: /escolher BETA SA/i }))
    expect(await screen.findByText(/muitas buscas em pouco tempo/i)).toBeInTheDocument()
    expect(screen.queryByText(/não foi possível ler/i)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^pedir autorização$/i })).toBeEnabled()
  })

  it('falha de leitura não bloqueia o pedido (quem aprova lê de novo)', async () => {
    ;(previaDestinoFavorecido as jest.Mock).mockResolvedValue({ resultado: 'FALHA_LEITURA', avisos: [] })
    renderizar()
    digitar('beta')
    await userEvent.click(await screen.findByRole('button', { name: /escolher BETA SA/i }))
    expect(await screen.findByText(/não foi possível ler a conta/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^pedir autorização$/i })).toBeEnabled()
  })

  it('"Trocar" volta para a busca; nada encontrado é dito', async () => {
    renderizar()
    digitar('beta')
    await userEvent.click(await screen.findByRole('button', { name: /escolher BETA SA/i }))
    await userEvent.click(screen.getByRole('button', { name: /trocar/i }))
    ;(buscarFavorecidos as jest.Mock).mockResolvedValue(busca({ favorecidos: [] }))
    digitar('zzzz')
    expect(await screen.findByText(/nenhum favorecido encontrado/i)).toBeInTheDocument()
  })

  it('vindo do item/relatório (favorecido já definido): sem busca, com prévia', async () => {
    renderizar({ origem: 'ITEM', inicial: { pesCod: '7001', credor: 'GAMA', modalidade: 'TED', filCod: 4 } })
    expect(screen.queryByLabelText(/^favorecido$/i)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /trocar/i })).not.toBeInTheDocument()
    expect(screen.getByText('GAMA')).toBeInTheDocument()
    await screen.findByText('PIX e-mail · f***@empresa.com.br')
    expect(previaDestinoFavorecido).toHaveBeenCalledWith('7001', 'TED', expect.anything())
    expect(buscarFavorecidos).not.toHaveBeenCalled()
  })
})
