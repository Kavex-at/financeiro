/**
 * Composição manual do grupo (ADR-0077, I21g): a analista escolhe os títulos de UM boleto; a soma
 * aparece ao vivo com a diferença em centavos; título fora da janela de 10 dias fica desabilitado
 * com o motivo; título que vence antes do boleto exige reconhecimento explícito (o servidor revalida).
 */
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AutorizacaoApiError, confirmarGrupoBoleto } from '@/lib/sispag'
import { ComporGrupoBoletoDialog } from './ComporGrupoBoletoDialog'

jest.mock('@/lib/sispag', () => {
  const real = jest.requireActual('@/lib/sispag')
  return { ...real, confirmarGrupoBoleto: jest.fn() }
})
const confirmar = confirmarGrupoBoleto as jest.Mock

const BOLETO = {
  ddcCod: 900,
  ditCod: 332841,
  credor: 'PEDRONI',
  codbarMascarado: '34191…7500',
  valorBoletoCentavos: 157500,
  vencimentoBoleto: '2026-10-21',
}
const titulo = (docCod: string, valorCentavos: number, vencimento = '2026-10-21') => ({
  filCod: 2,
  docCod,
  titCod: '1',
  valorCentavos,
  vencimento,
})
const CANDIDATOS = [
  titulo('501', 52500),
  titulo('502', 52500),
  titulo('503', 52500),
  titulo('504', 10000, '2026-10-10'), // 11 dias antes: fora da janela
  titulo('505', 5000, '2026-10-22'), // vence DEPOIS do boleto: fora da janela
  titulo('506', 52500, '2026-10-15'), // 6 dias antes: dentro, com aviso
]

const abrir = (over: Record<string, unknown> = {}) => {
  const onFechar = jest.fn()
  const onConfirmado = jest.fn()
  render(
    <ComporGrupoBoletoDialog
      boleto={BOLETO}
      candidatos={CANDIDATOS}
      onFechar={onFechar}
      onConfirmado={onConfirmado}
      {...over}
    />,
  )
  return { onFechar, onConfirmado }
}
const marcar = async (docs: string[]) => {
  for (const d of docs) {
    await userEvent.click(screen.getByRole('checkbox', { name: new RegExp(`${d}/1`) }))
  }
}

beforeEach(() => jest.clearAllMocks())

describe('ComporGrupoBoletoDialog', () => {
  it('mostra o boleto (credor, máscara, valor, vencimento) e os títulos candidatos', () => {
    abrir()
    expect(screen.getByRole('dialog', { name: /Compor boleto agrupado/ })).toBeInTheDocument()
    expect(screen.getByText('34191…7500')).toBeInTheDocument()
    expect(screen.getAllByText(/1\.575,00/).length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('21/10/2026')).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: /501\/1/ })).toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/\d{44}|\d{47}/)
  })

  it('soma ao vivo com a diferença em centavos; só fecha com a soma exata', async () => {
    abrir()
    await marcar(['501', '502'])
    expect(screen.getByText(/Soma selecionada/)).toHaveTextContent(/1\.050,00/)
    expect(screen.getByText(/Diferença/)).toHaveTextContent(/525,00/)
    expect(screen.getByRole('button', { name: 'Confirmar grupo' })).toBeDisabled()
    await marcar(['503'])
    expect(screen.getByText(/Diferença/)).toHaveTextContent(/0,00/)
    expect(screen.getByRole('button', { name: 'Confirmar grupo' })).toBeEnabled()
  })

  it('um título só nunca confirma (o grupo tem dois ou mais)', async () => {
    abrir({ boleto: { ...BOLETO, valorBoletoCentavos: 52500 } })
    await marcar(['501'])
    expect(screen.getByRole('button', { name: 'Confirmar grupo' })).toBeDisabled()
  })

  it('título fora da janela de 10 dias fica desabilitado com o motivo', () => {
    abrir()
    const longe = screen.getByRole('checkbox', { name: /504\/1/ })
    expect(longe).toBeDisabled()
    expect(screen.getByText(/mais de 10 dias antes do boleto/)).toBeInTheDocument()
    const depois = screen.getByRole('checkbox', { name: /505\/1/ })
    expect(depois).toBeDisabled()
    expect(screen.getByText(/vence depois do boleto/)).toBeInTheDocument()
  })

  it('sem aviso: confirma direto, origem MANUAL, sem reconheceAvisos', async () => {
    confirmar.mockResolvedValue({ criado: true, grupo: {} })
    const { onConfirmado } = abrir()
    await marcar(['501', '502', '503'])
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar grupo' }))
    await waitFor(() => expect(confirmar).toHaveBeenCalledTimes(1))
    const entrada = confirmar.mock.calls[0]?.[0]
    expect(entrada).toMatchObject({ origem: 'MANUAL', ddcCod: 900, ditCod: 332841 })
    expect(entrada.titulos).toEqual([
      { filCod: 2, docCod: '501', titCod: '1' },
      { filCod: 2, docCod: '502', titCod: '1' },
      { filCod: 2, docCod: '503', titCod: '1' },
    ])
    expect(entrada).not.toHaveProperty('reconheceAvisos')
    await waitFor(() => expect(onConfirmado).toHaveBeenCalled())
  })

  it('título que vence ANTES do boleto exige reconhecimento explícito; só então confirma, com o aviso', async () => {
    confirmar.mockResolvedValue({ criado: true, grupo: {} })
    abrir()
    // 506 (52.500) + 501 + 502 = 157.500
    await marcar(['501', '502', '506'])
    expect(screen.getByText(/vence antes do boleto/i)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar grupo' }))
    expect(confirmar).not.toHaveBeenCalled()
    const aviso = await screen.findByRole('dialog', { name: /vence antes do boleto/i })
    const confirmarAviso = within(aviso).getByRole('button', { name: 'Confirmar' })
    expect(confirmarAviso).toBeDisabled()
    await userEvent.click(within(aviso).getByRole('checkbox'))
    await userEvent.click(confirmarAviso)
    await waitFor(() => expect(confirmar).toHaveBeenCalledTimes(1))
    expect(confirmar.mock.calls[0]?.[0]).toMatchObject({
      origem: 'MANUAL',
      reconheceAvisos: ['TITULO_VENCE_ANTES_DO_BOLETO'],
    })
  })

  it('erro do servidor aparece no diálogo, que continua aberto', async () => {
    confirmar.mockRejectedValue(
      new AutorizacaoApiError(
        'A soma dos títulos (R$ 1.575,01) não bate com o boleto.',
        422,
        'GRUPO_BOLETO_SOMA_DIVERGENTE',
      ),
    )
    const { onConfirmado } = abrir()
    await marcar(['501', '502', '503'])
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar grupo' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('não bate com o boleto')
    expect(onConfirmado).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog', { name: /Compor boleto agrupado/ })).toBeInTheDocument()
  })

  it('durante a chamada os botões ficam desabilitados', async () => {
    let resolver: (v: unknown) => void = () => undefined
    confirmar.mockReturnValue(new Promise((r) => (resolver = r)))
    abrir()
    await marcar(['501', '502', '503'])
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar grupo' }))
    expect(screen.getByRole('button', { name: 'Confirmar grupo' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Cancelar' })).toBeDisabled()
    resolver({ criado: true, grupo: {} })
  })

  it('"Cancelar" fecha sem chamar a API', async () => {
    const { onFechar } = abrir()
    await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(onFechar).toHaveBeenCalled()
    expect(confirmar).not.toHaveBeenCalled()
  })
})
