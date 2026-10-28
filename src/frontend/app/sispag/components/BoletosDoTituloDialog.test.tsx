/**
 * Diálogo dos boletos DDA de um título sem associação: busca por `doc/tit` e por valor, separa o
 * que o Conexos lista como candidato dos boletos de mesmo valor e destaca a diferença de data.
 */

import * as React from 'react'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { BoletoDda, BoletosDdaResposta } from '@/lib/sispag'
import { BoletosDoTituloDialog } from './BoletosDoTituloDialog'

// Boundary HTTP mockado: `fetchBoletosDdaDoTitulo` chama `fetchBoletosDda` no MESMO módulo, então
// mockar o export não pegaria — o que se controla é a resposta do backend.
jest.mock('@/lib/http', () => ({ apiFetch: jest.fn() }))
jest.mock('@/lib/auth/token', () => ({ withAuthHeaders: jest.fn(async () => ({})) }))
import { apiFetch } from '@/lib/http'

const mockApiFetch = apiFetch as jest.MockedFunction<typeof apiFetch>

const ok = (corpo: BoletosDdaResposta) =>
  ({ ok: true, status: 200, json: async () => corpo }) as unknown as Response

/** `busca` de cada requisição feita ao backend. */
const buscasFeitas = () =>
  mockApiFetch.mock.calls.map((c) => new URL(String(c[0]), 'http://x').searchParams.get('busca'))

const resposta = (boletos: BoletoDda[]): BoletosDdaResposta => ({
  boletos,
  total: boletos.length,
  pagina: 1,
  tamanho: 50,
  contagem: { todas: boletos.length, VINCULADO: 0, CANDIDATO: 0, AMBIGUO: 0, SEM_TITULO: 0 },
  filiais: [1],
  regraCandidato: 'candidato = regra em camadas',
})

const titulo = {
  filCod: 1,
  docCod: '5046',
  titCod: '1',
  credor: 'ADP BRASIL LTDA',
  valor: 4815.33,
  vencimento: '2026-09-24',
}

const boleto = (over: Partial<BoletoDda>): BoletoDda => ({
  ddcCod: 152,
  ditCod: 7,
  numero: '001532761',
  valor: 4815.33,
  vencimento: '2026-09-27',
  vencido: false,
  situacao: 'SEM_TITULO',
  candidatos: [],
  ...over,
})

describe('BoletosDoTituloDialog', () => {
  beforeEach(() => mockApiFetch.mockReset())

  it('mostra o boleto de mesmo valor com a diferença de data do título', async () => {
    mockApiFetch.mockResolvedValue(ok(resposta([boleto({})])))
    render(<BoletosDoTituloDialog titulo={titulo} onClose={jest.fn()} />)

    expect(await screen.findByText('Outros boletos com o mesmo valor')).toBeInTheDocument()
    expect(screen.getByText('001532761')).toBeInTheDocument()
    // vencimento do boleto 27/09 − do título 24/09 = +3 dias
    expect(screen.getByText('+3 dias')).toBeInTheDocument()
    // duas buscas: por doc/tit e por valor
    expect(buscasFeitas()).toEqual(expect.arrayContaining(['5046/1', '4815.33']))
    expect(
      mockApiFetch.mock.calls.every(
        (c) => new URL(String(c[0]), 'http://x').searchParams.get('filCod') === '1',
      ),
    ).toBe(true)
  })

  it('lista como candidato o boleto que o Conexos já relaciona ao título', async () => {
    mockApiFetch.mockResolvedValue(
      ok(
        resposta([
          boleto({
            vencimento: '2026-09-24',
            situacao: 'CANDIDATO',
            candidatos: [{ filCod: 1, docCod: '5046', titCod: '1', diferencaDias: 0 }],
          }),
        ]),
      ),
    )
    render(<BoletosDoTituloDialog titulo={titulo} onClose={jest.fn()} />)
    expect(await screen.findByText('Candidatos deste título')).toBeInTheDocument()
    expect(screen.getByText('mesmo dia')).toBeInTheDocument()
    expect(screen.queryByText('Outros boletos com o mesmo valor')).not.toBeInTheDocument()
  })

  it('sem nenhum boleto de mesmo valor explica o que conferir', async () => {
    mockApiFetch.mockResolvedValue(ok(resposta([])))
    render(<BoletosDoTituloDialog titulo={titulo} onClose={jest.fn()} />)
    expect(await screen.findByText('Nenhum boleto DDA com este valor')).toBeInTheDocument()
  })

  it('erro da consulta aparece no diálogo, não some', async () => {
    mockApiFetch.mockResolvedValue({ ok: false, status: 500, json: async () => ({}) } as unknown as Response)
    render(<BoletosDoTituloDialog titulo={titulo} onClose={jest.fn()} />)
    await waitFor(() =>
      expect(screen.getByText('Não foi possível consultar os boletos DDA')).toBeInTheDocument(),
    )
    expect(screen.getByText('API 500')).toBeInTheDocument()
  })

  it('fechado (sem título) não consulta nada', () => {
    render(<BoletosDoTituloDialog titulo={null} onClose={jest.fn()} />)
    expect(mockApiFetch).not.toHaveBeenCalled()
  })

  it('com sugestão: mostra o painel de sugestão acima dos boletos', async () => {
    mockApiFetch.mockResolvedValue(ok(resposta([boleto({})])))
    const sug = {
      filCod: 1,
      docCod: '5046',
      titCod: '1',
      valorTitulo: 4815.33,
      vencimentoTitulo: '2026-09-24',
      dataDebito: '2026-09-24',
      ddcCod: 152,
      ditCod: 7,
      valorBoleto: 4815.33,
      vencimentoBoleto: '2026-09-27',
      avaliacao: {
        resultado: 'FORTE' as const,
        deltaValor: 0,
        deltaPercentual: 0,
        deltaDias: 3,
        sinais: ['VALOR_IGUAL' as const],
        confirmavel: true,
      },
      estado: 'SUGERIDA' as const,
      confirmavel: true,
    }
    render(
      <BoletosDoTituloDialog
        titulo={titulo}
        onClose={() => undefined}
        sugestoes={[sug]}
        podeExecutar={false}
        podeCopiar
      />,
    )
    expect(await screen.findByText('Sugestão de boleto')).toBeInTheDocument()
    expect(screen.getByText('+3 dias')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Confirmar boleto/ })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Copiar linha digitável/ })).toBeInTheDocument()
  })

  it('as tabelas têm nome acessível conforme a seção', async () => {
    mockApiFetch.mockResolvedValue(ok(resposta([boleto({})])))
    render(<BoletosDoTituloDialog titulo={titulo} onClose={jest.fn()} />)
    expect(
      await screen.findByRole('table', { name: 'Outros boletos DDA com o mesmo valor' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'Boleto' })).toHaveAttribute('scope', 'col')
  })

  it('carregando é role=status; falha é role=alert e "Tentar de novo" refaz a consulta', async () => {
    mockApiFetch.mockRejectedValueOnce(new Error('Falha de rede'))
    mockApiFetch.mockRejectedValueOnce(new Error('Falha de rede'))
    render(<BoletosDoTituloDialog titulo={titulo} onClose={jest.fn()} />)
    expect(screen.getByRole('status')).toBeInTheDocument()
    expect(screen.getByText(/Consultando os boletos DDA/)).toBeInTheDocument()
    expect(await screen.findByRole('alert')).toHaveTextContent('Falha de rede')
    mockApiFetch.mockReset()
    mockApiFetch.mockResolvedValue(ok(resposta([boleto({})])))
    await userEvent.click(screen.getByRole('button', { name: 'Tentar de novo' }))
    expect(await screen.findByText('001532761')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  describe('gaveta lateral (não modal) com o nº do documento', () => {
    const t1 = { ...titulo, filCod: 2, docCod: '40919', numeroDocumento: '25349', valor: 647.56, vencimento: '2026-10-26' }

    it('o cabeçalho mostra título, nº do documento, valor, vencimento, filial e credor', async () => {
      mockApiFetch.mockResolvedValue(ok(resposta([])))
      render(<BoletosDoTituloDialog titulo={t1} onClose={jest.fn()} />)
      const dlg = await screen.findByRole('dialog', { name: /40919\/1/ })
      expect(dlg).toHaveTextContent('nº documento 25349')
      expect(dlg).toHaveTextContent('R$ 647,56')
      expect(dlg).toHaveTextContent('vence 26/10/2026')
      expect(dlg).toHaveTextContent('filial 2')
      expect(dlg).toHaveTextContent('ADP BRASIL LTDA')
    })

    it('sem nº do documento mostra "nº documento —"', async () => {
      mockApiFetch.mockResolvedValue(ok(resposta([])))
      render(<BoletosDoTituloDialog titulo={titulo} onClose={jest.fn()} />)
      expect(await screen.findByRole('dialog')).toHaveTextContent('nº documento —')
    })

    it('sem nº no título, usa o do desfecho (mesmo título)', async () => {
      mockApiFetch.mockResolvedValue(ok(resposta([])))
      const desfecho = {
        filCod: 1,
        docCod: '5046',
        titCod: '1',
        numeroDocumento: '777',
        valorTitulo: 4815.33,
        vencimentoTitulo: '2026-09-24',
        dataDebito: '2026-09-24',
        situacao: 'SEM_CANDIDATO' as const,
        candidatos: [],
        totalCandidatos: 0,
        motivo: 'sem boleto',
        avisoVenceAntes: 'NENHUM' as const,
        diasVencidoNoDebito: 0,
      }
      render(<BoletosDoTituloDialog titulo={titulo} onClose={jest.fn()} desfecho={desfecho} />)
      expect(await screen.findByRole('dialog')).toHaveTextContent('nº documento 777')
    })

    it('não é modal: a página atrás continua clicável e o clique fora não fecha', async () => {
      mockApiFetch.mockResolvedValue(ok(resposta([])))
      const onClose = jest.fn()
      const naTabela = jest.fn()
      render(
        <>
          <button type="button" onClick={naTabela}>
            linha da tabela
          </button>
          <BoletosDoTituloDialog titulo={titulo} onClose={onClose} />
        </>,
      )
      const dlg = await screen.findByRole('dialog')
      expect(dlg).not.toHaveAttribute('aria-modal', 'true')
      // Acessível (não aria-hidden) e clicável com a gaveta aberta.
      await userEvent.click(screen.getByRole('button', { name: 'linha da tabela' }))
      expect(naTabela).toHaveBeenCalledTimes(1)
      expect(onClose).not.toHaveBeenCalled()
      expect(screen.getByRole('dialog')).toBeInTheDocument()
    })

    it('trocar de título com a gaveta aberta troca o conteúdo', async () => {
      mockApiFetch.mockResolvedValue(ok(resposta([])))
      const { rerender } = render(<BoletosDoTituloDialog titulo={titulo} onClose={jest.fn()} />)
      expect(await screen.findByRole('dialog', { name: /5046\/1/ })).toBeInTheDocument()
      rerender(<BoletosDoTituloDialog titulo={t1} onClose={jest.fn()} />)
      expect(await screen.findByRole('dialog', { name: /40919\/1/ })).toHaveTextContent(
        'nº documento 25349',
      )
      expect(screen.getAllByRole('dialog')).toHaveLength(1)
    })

    it('Esc fecha', async () => {
      mockApiFetch.mockResolvedValue(ok(resposta([])))
      const onClose = jest.fn()
      render(<BoletosDoTituloDialog titulo={titulo} onClose={onClose} />)
      await screen.findByRole('dialog')
      await userEvent.keyboard('{Escape}')
      expect(onClose).toHaveBeenCalledTimes(1)
    })

    it('o foco entra na gaveta ao abrir e volta ao gatilho ao fechar (X)', async () => {
      mockApiFetch.mockResolvedValue(ok(resposta([])))
      function Harness() {
        const [aberto, setAberto] = React.useState(false)
        return (
          <>
            <button type="button" onClick={() => setAberto(true)}>
              abrir gaveta
            </button>
            <BoletosDoTituloDialog titulo={aberto ? titulo : null} onClose={() => setAberto(false)} />
          </>
        )
      }
      render(<Harness />)
      const gatilho = screen.getByRole('button', { name: 'abrir gaveta' })
      await userEvent.click(gatilho)
      const dlg = await screen.findByRole('dialog')
      await waitFor(() => expect(dlg).toContainElement(document.activeElement as HTMLElement))
      await userEvent.click(within(dlg).getByRole('button', { name: 'Fechar' }))
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
      expect(gatilho).toHaveFocus()
    })
  })
})
