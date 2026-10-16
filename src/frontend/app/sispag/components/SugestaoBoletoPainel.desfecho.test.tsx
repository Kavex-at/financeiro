/**
 * Painel com o desfecho do título (ADR-0072): situação e motivo, "mostrando 3 de N", confirmar
 * ausente para o que não é confirmável, diálogo de reconhecimento (caso B), estado vazio com a hora
 * do sync, e as mensagens de aviso.
 */
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  AutorizacaoApiError,
  type CandidatoTituloBoleto,
  confirmarSugestaoBoleto,
  type DesfechoTituloBoleto,
} from '@/lib/sispag'
import { SugestaoBoletoPainel } from './SugestaoBoletoPainel'

jest.mock('@/lib/sispag', () => {
  const real = jest.requireActual('@/lib/sispag')
  return {
    ...real,
    confirmarSugestaoBoleto: jest.fn(),
    rejeitarSugestaoBoleto: jest.fn(),
    copiarLinhaSugestao: jest.fn(),
    revogarConfirmacaoEmissor: jest.fn(),
    anularConfirmacaoBoleto: jest.fn(),
  }
})

const confirmar = confirmarSugestaoBoleto as jest.Mock

const candidato = (n: number, over: Partial<CandidatoTituloBoleto> = {}): CandidatoTituloBoleto => ({
  ddcCod: 152,
  ditCod: n,
  numeroBoleto: `00${n}`,
  valorBoleto: 100 + n,
  vencimentoBoleto: '2026-10-20',
  emissor: { banco: '237', layout: 'BRADESCO_237', mascarado: '237 / 2656 / ***2740' },
  avaliacao: {
    resultado: 'ATENCAO',
    deltaValor: n,
    deltaPercentual: n,
    deltaDias: 0,
    sinais: ['MESMO_DIA'],
    confirmavel: false,
    diasVencidoNoDebito: 0,
  },
  ancorado: false,
  confirmavel: false,
  motivo: 'Sem confirmação do emissor nem do número do documento: só informativo.',
  ...over,
})

const desfecho = (over: Partial<DesfechoTituloBoleto> = {}): DesfechoTituloBoleto => ({
  filCod: 1,
  docCod: '5046',
  titCod: '1',
  credor: 'ADP BRASIL LTDA',
  valorTitulo: 100,
  vencimentoTitulo: '2026-10-20',
  dataDebito: '2026-10-20',
  situacao: 'SO_FRACA',
  candidatos: [candidato(1)],
  totalCandidatos: 1,
  motivo: 'Só há candidatos sem confirmação do emissor ou do número.',
  avisoVenceAntes: 'NENHUM',
  diasVencidoNoDebito: 0,
  ...over,
})

const onDecidido = jest.fn()

const renderPainel = (
  d: DesfechoTituloBoleto,
  p: {
    executar?: boolean
    sincronizadoEm?: number
    defasado?: number
    onBoletos?: () => void
  } = {},
) =>
  render(
    <SugestaoBoletoPainel
      sugestoes={[]}
      desfecho={d}
      sincronizadoEm={p.sincronizadoEm}
      onAbrirBoletosDda={p.onBoletos}
      podeExecutar={p.executar ?? true}
      podeCopiar
      ddaDefasadoHoras={p.defasado}
      onDecidido={onDecidido}
    />,
  )

beforeEach(() => jest.clearAllMocks())

describe('SugestaoBoletoPainel — desfecho do título (ADR-0072)', () => {
  it('SO_FRACA: mostra o candidato com Δ com sinal e o motivo; NÃO há botão Confirmar', () => {
    renderPainel(desfecho())
    expect(screen.getByText(/Só há candidatos sem confirmação/)).toBeInTheDocument()
    expect(screen.getByText('R$ +1,00')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Confirmar boleto/ })).not.toBeInTheDocument()
    expect(screen.getByText(/Confirmar indisponível: Sem confirmação do emissor/)).toBeInTheDocument()
    // rejeitar candidato exibido e não confirmável é permitido (Q2)
    expect(screen.getByRole('button', { name: /^Rejeitar boleto/ })).toBeInTheDocument()
  })

  it('"mostrando 3 de N" quando há mais candidatos do que o corte de exibição', () => {
    renderPainel(
      desfecho({
        candidatos: [candidato(1), candidato(2), candidato(3)],
        totalCandidatos: 5,
      }),
    )
    expect(screen.getByTestId('situacao-titulo')).toHaveTextContent('Mostrando 3 de 5 candidatos')
    expect(screen.getAllByRole('listitem').filter((li) => li.className.includes('rounded-lg'))).toHaveLength(3)
  })

  it('AMBIGUA: todos sem Confirmar, com Rejeitar em cada um', () => {
    renderPainel(
      desfecho({
        situacao: 'AMBIGUA',
        motivo: 'Mais de um boleto igualmente provável.',
        candidatos: [
          candidato(1, { avaliacao: { ...candidato(1).avaliacao, resultado: 'FORTE' } }),
          candidato(2, { avaliacao: { ...candidato(2).avaliacao, resultado: 'FORTE' } }),
        ],
        totalCandidatos: 2,
      }),
    )
    expect(screen.queryByRole('button', { name: /^Confirmar boleto/ })).not.toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: /^Rejeitar boleto/ })).toHaveLength(2)
  })

  it('DISPUTADA: informa o título que reservou o boleto', () => {
    renderPainel(
      desfecho({
        situacao: 'DISPUTADA',
        candidatos: [
          candidato(1, {
            reservadoParaTitulo: { filCod: 1, docCod: '1234', titCod: '1' },
            motivo: 'Boleto reservado ao título 1234 (1/1).',
          }),
        ],
      }),
    )
    expect(screen.getByText(/Reservado ao título 1234\/1 \(fil 1\)/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Confirmar boleto/ })).not.toBeInTheDocument()
  })

  it('compartilhado: avisa que o boleto aparece em outro título sem reserva', () => {
    renderPainel(desfecho({ candidatos: [candidato(1, { compartilhado: true })] }))
    expect(screen.getByText(/também aparece como candidato de outro título/)).toBeInTheDocument()
  })

  it('SEM_CANDIDATO: texto com o envelope, a hora do sync, "de há N h" e o atalho para Boletos DDA', async () => {
    const onBoletos = jest.fn()
    renderPainel(
      desfecho({ situacao: 'SEM_CANDIDATO', candidatos: [], totalCandidatos: 0 }),
      { sincronizadoEm: Date.UTC(2026, 9, 15, 13, 30), defasado: 20, onBoletos },
    )
    const estado = screen.getByText(/Nenhum boleto no pool DDA dentro do envelope/)
    expect(estado).toHaveTextContent('±R$ 10,00 ou 2 %, ±10 dias')
    expect(estado).toHaveTextContent('Último arquivo DDA sincronizado em')
    expect(estado).toHaveTextContent('no pool de há 20 h')
    await userEvent.click(screen.getByRole('button', { name: /Boletos DDA/ }))
    expect(onBoletos).toHaveBeenCalled()
  })

  describe('caso A (vencido no débito): só informação', () => {
    it('aviso completo com os dias de atraso; sem Confirmar nem Rejeitar', () => {
      renderPainel(
        desfecho({
          situacao: 'SO_VENCIDA',
          avisoVenceAntes: 'CRITICO',
          diasVencidoNoDebito: 3,
          vencimentoTitulo: '2026-10-16',
          dataDebito: '2026-10-16',
          candidatos: [
            candidato(1, {
              vencimentoBoleto: '2026-10-13',
              avaliacao: {
                ...candidato(1).avaliacao,
                resultado: 'VENCIDO_INFORMATIVO',
                deltaDias: -3,
                diasVencidoNoDebito: 3,
                sinais: ['VENCE_ANTES_DO_TITULO'],
              },
            }),
          ],
        }),
      )
      expect(screen.getByText(/já estará vencido há 3 dias/)).toBeInTheDocument()
      expect(screen.getByText(/Serve só como informação/)).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /^Confirmar boleto/ })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /^Rejeitar boleto/ })).not.toBeInTheDocument()
    })
  })

  describe('caso B: confirmar exige reconhecimento', () => {
    const casoB = () =>
      desfecho({
        situacao: 'SO_ATENCAO',
        avisoVenceAntes: 'ATENCAO',
        vencimentoTitulo: '2026-10-16',
        dataDebito: '2026-10-14',
        candidatos: [
          candidato(1, {
            ancorado: true,
            confirmavel: true,
            motivo: undefined,
            vencimentoBoleto: '2026-10-15',
            avaliacao: {
              ...candidato(1).avaliacao,
              deltaDias: -1,
              confirmavel: true,
              sinais: ['EMISSOR_CONFIRMADO', 'VENCE_ANTES_DO_TITULO'],
            },
          }),
        ],
      })

    it('Confirmar abre o diálogo; o botão só habilita com o checkbox; envia o reconhecimento', async () => {
      confirmar.mockResolvedValue({ criada: true, decisao: {} })
      renderPainel(casoB())
      expect(screen.getByText(/Confirmar não faz o boleto sair na remessa/)).toBeInTheDocument()
      await userEvent.click(screen.getByRole('button', { name: /^Confirmar boleto/ }))
      const dlg = await screen.findByRole('dialog')
      expect(confirmar).not.toHaveBeenCalled()
      const botao = within(dlg).getByRole('button', { name: 'Confirmar' })
      expect(botao).toBeDisabled()
      await userEvent.click(within(dlg).getByRole('checkbox'))
      expect(botao).toBeEnabled()
      await userEvent.click(botao)
      await waitFor(() => expect(confirmar).toHaveBeenCalledTimes(1))
      expect(confirmar.mock.calls[0]).toEqual([
        { filCod: 1, docCod: '5046', titCod: '1', ddcCod: 152, ditCod: 1 },
        ['VENCE_ANTES_DO_TITULO'],
      ])
      await waitFor(() => expect(onDecidido).toHaveBeenCalled())
    })

    it('erro 422 do servidor aparece no diálogo, que continua aberto', async () => {
      confirmar.mockRejectedValue(
        new AutorizacaoApiError(
          'Antes de confirmar, confirme o vencimento no portal do banco e reconheça o aviso.',
          422,
          'RECONHECIMENTO_DE_AVISO_OBRIGATORIO',
        ),
      )
      renderPainel(casoB())
      await userEvent.click(screen.getByRole('button', { name: /^Confirmar boleto/ }))
      const dlg = await screen.findByRole('dialog')
      await userEvent.click(within(dlg).getByRole('checkbox'))
      await userEvent.click(within(dlg).getByRole('button', { name: 'Confirmar' }))
      expect(await within(dlg).findByRole('alert')).toHaveTextContent('portal do banco')
      expect(screen.getByRole('dialog')).toBeInTheDocument()
    })

    it('sem o sinal, o fluxo atual (sem diálogo) não muda', async () => {
      confirmar.mockResolvedValue({ criada: true, decisao: {} })
      renderPainel(
        desfecho({
          situacao: 'UNICA_SEGURA',
          candidatos: [
            candidato(1, {
              confirmavel: true,
              motivo: undefined,
              avaliacao: {
                ...candidato(1).avaliacao,
                resultado: 'FORTE',
                confirmavel: true,
              },
            }),
          ],
        }),
      )
      await userEvent.click(screen.getByRole('button', { name: /^Confirmar boleto/ }))
      await waitFor(() => expect(confirmar).toHaveBeenCalledTimes(1))
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      expect(confirmar.mock.calls[0]).toHaveLength(1)
    })
  })
})
