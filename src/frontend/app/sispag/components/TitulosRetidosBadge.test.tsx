/**
 * Selo "retido por boleto repetido" + desfazer com motivo obrigatório (ADR-0069 emenda 1, I16g).
 */
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { TituloRetidoPorCodigoBarras } from '@/lib/sispag'
import { TitulosRetidosBadge } from './TitulosRetidosBadge'

jest.mock('@/lib/sispag', () => {
  const real = jest.requireActual('@/lib/sispag')
  return { ...real, desfazerBloqueioDuplicidade: jest.fn() }
})

import { desfazerBloqueioDuplicidade } from '@/lib/sispag'

const mockDesfazer = desfazerBloqueioDuplicidade as jest.MockedFunction<
  typeof desfazerBloqueioDuplicidade
>

const retido: TituloRetidoPorCodigoBarras = {
  filCod: 2,
  docCod: '1001',
  titCod: '1',
  origem: 'CODIGO_BARRAS_REPETIDO',
  codigoMascarado: '34191…0000',
  tituloMantido: { filCod: 2, docCod: '1000', titCod: '1' },
  marcadoEm: '2026-10-14T10:00:00.000Z',
}

afterEach(() => jest.clearAllMocks())

describe('TitulosRetidosBadge', () => {
  it('mostra o selo, o código mascarado e o título que ficou', () => {
    render(<TitulosRetidosBadge retido={retido} podeDesfazer onDesfeito={jest.fn()} />)
    expect(screen.getByText(/retido por boleto repetido/)).toBeInTheDocument()
    expect(screen.getByText(/código 34191…0000/)).toBeInTheDocument()
    expect(screen.getByText(/ficou o título 1000\/1/)).toBeInTheDocument()
  })

  it('ilegível tem o seu próprio rótulo', () => {
    render(
      <TitulosRetidosBadge
        retido={{ ...retido, origem: 'CODIGO_BARRAS_ILEGIVEL', tituloMantido: undefined }}
        podeDesfazer={false}
        onDesfeito={jest.fn()}
      />,
    )
    expect(screen.getByText(/retido por código de barras ilegível/)).toBeInTheDocument()
  })

  it('sem permissão de executar, a ação some (não fica desabilitada)', () => {
    render(<TitulosRetidosBadge retido={retido} podeDesfazer={false} onDesfeito={jest.fn()} />)
    expect(screen.queryByRole('button', { name: /desfazer retenção/i })).toBeNull()
  })

  it('desfazer exige motivo: vazio não chama a API; com motivo desfaz e avisa a página', async () => {
    mockDesfazer.mockResolvedValue(undefined)
    const onDesfeito = jest.fn()
    const user = userEvent.setup()
    render(<TitulosRetidosBadge retido={retido} podeDesfazer onDesfeito={onDesfeito} />)

    await user.click(screen.getByRole('button', { name: /desfazer retenção/i }))
    await user.click(screen.getByRole('button', { name: /^desfazer retenção$/i, hidden: false }))
    expect(mockDesfazer).not.toHaveBeenCalled()
    expect(screen.getByText('Informe o motivo.')).toBeInTheDocument()

    await user.type(screen.getByLabelText('Motivo'), 'boleto corrigido no fin124')
    await user.click(screen.getByRole('button', { name: /^desfazer retenção$/i }))
    await waitFor(() => expect(mockDesfazer).toHaveBeenCalledTimes(1))
    expect(mockDesfazer).toHaveBeenCalledWith(
      { filCod: 2, docCod: '1001', titCod: '1' },
      'boleto corrigido no fin124',
    )
    await waitFor(() => expect(onDesfeito).toHaveBeenCalled())
  })

  it('erro do servidor aparece no diálogo, que continua aberto', async () => {
    mockDesfazer.mockRejectedValue(new Error('A limpeza do rascunho ainda não terminou.'))
    const onDesfeito = jest.fn()
    const user = userEvent.setup()
    render(<TitulosRetidosBadge retido={retido} podeDesfazer onDesfeito={onDesfeito} />)
    await user.click(screen.getByRole('button', { name: /desfazer retenção/i }))
    await user.type(screen.getByLabelText('Motivo'), 'x')
    await user.click(screen.getByRole('button', { name: /^desfazer retenção$/i }))
    expect(await screen.findByText(/limpeza do rascunho ainda não terminou/)).toBeInTheDocument()
    expect(onDesfeito).not.toHaveBeenCalled()
  })
})
