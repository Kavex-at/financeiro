/**
 * Gaveta do título (I21v): mostra o grupo inline e o confirma/anula ali mesmo. O "Ver grupo" da
 * carteira só abre esta gaveta; a posição do bloco depende da situação (S1).
 */
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  anularGrupoBoleto,
  confirmarGrupoBoleto,
  fetchAjustesCentavos,
  fetchBoletosDdaDoTitulo,
  fetchGruposBoleto,
  fetchSugestoesGrupoBoleto,
  type DesfechoTituloBoleto,
} from '@/lib/sispag'
import { BoletosDoTituloDialog } from './BoletosDoTituloDialog'
import { grupoConfirmado, sugestaoGrupo } from './grupoBoleto.fixtures'

jest.mock('@/lib/sispag', () => {
  const real = jest.requireActual('@/lib/sispag')
  return {
    ...real,
    fetchAjustesCentavos: jest.fn(),
    fetchBoletosDdaDoTitulo: jest.fn(),
    fetchSugestoesGrupoBoleto: jest.fn(),
    fetchGruposBoleto: jest.fn(),
    confirmarGrupoBoleto: jest.fn(),
    anularGrupoBoleto: jest.fn(),
  }
})

const sugestoes = fetchSugestoesGrupoBoleto as jest.Mock
const grupos = fetchGruposBoleto as jest.Mock
const confirmar = confirmarGrupoBoleto as jest.Mock
const anular = anularGrupoBoleto as jest.Mock

const titulo = {
  filCod: 2,
  docCod: '38884',
  titCod: '1',
  credor: 'PEDRONI',
  valor: 525,
  vencimento: '2026-10-21',
}

const desfecho = (over: Partial<DesfechoTituloBoleto> = {}): DesfechoTituloBoleto => ({
  filCod: 2,
  docCod: '38884',
  titCod: '1',
  valorTitulo: 525,
  vencimentoTitulo: '2026-10-21',
  dataDebito: '2026-10-21',
  situacao: 'GRUPO_SUGERIDO',
  candidatos: [],
  totalCandidatos: 0,
  motivo:
    'Um único boleto fecha a soma deste título com outros do mesmo credor e vencimento: confirme o grupo na gaveta do título ou na aba Boletos DDA.',
  avisoVenceAntes: 'NENHUM',
  diasVencidoNoDebito: 0,
  grupoSugerido: {
    ddcCod: 900,
    ditCod: 332841,
    numeroBoleto: '332841',
    nTitulos: 3,
    valorBoletoCentavos: 157500,
    confirmavel: true,
  },
  ...over,
})

beforeEach(() => {
  jest.clearAllMocks()
  ;(fetchAjustesCentavos as jest.Mock).mockResolvedValue({ modo: 'DESLIGADO', ajustes: [] })
  ;(fetchBoletosDdaDoTitulo as jest.Mock).mockResolvedValue({ doTitulo: [], mesmoValor: [] })
  sugestoes.mockResolvedValue([sugestaoGrupo()])
  grupos.mockResolvedValue([])
})

const abrir = (d: DesfechoTituloBoleto, over: { podeExecutar?: boolean; onGrupoAlterado?: () => void } = {}) =>
  render(
    <BoletosDoTituloDialog
      titulo={titulo}
      onClose={() => undefined}
      desfecho={d}
      podeExecutar={over.podeExecutar ?? true}
      onGrupoAlterado={over.onGrupoAlterado}
    />,
  )

describe('Gaveta do título — o grupo (I21v)', () => {
  it('GRUPO_SUGERIDO: o bloco do grupo mostra boleto, TODOS os títulos (o atual destacado) e a soma', async () => {
    abrir(desfecho())
    const bloco = await screen.findByRole('region', { name: /Boleto agrupado de PEDRONI/ })
    expect(within(bloco).getByText('38883/1')).toBeInTheDocument()
    expect(within(bloco).getByText('38884/1').closest('li')).toHaveAttribute('aria-current', 'true')
    expect(within(bloco).getByText(/Soma dos títulos/)).toBeInTheDocument()
    expect(screen.queryByText(/também faz parte de um grupo sugerido/)).not.toBeInTheDocument()
  })

  it('Confirmar grupo na gaveta usa o endpoint existente e avisa a tela (carteira, lotes, sugestões)', async () => {
    confirmar.mockResolvedValue({ criado: true, grupo: grupoConfirmado() })
    const onGrupoAlterado = jest.fn()
    abrir(desfecho(), { onGrupoAlterado })
    await userEvent.click(await screen.findByRole('button', { name: /^Confirmar grupo de PEDRONI/ }))
    await waitFor(() => expect(confirmar).toHaveBeenCalledTimes(1))
    expect(confirmar.mock.calls[0]?.[0]).toMatchObject({ origem: 'SUGERIDO', ddcCod: 900, ditCod: 332841 })
    await waitFor(() => expect(onGrupoAlterado).toHaveBeenCalled())
  })

  it('EM_GRUPO: a gaveta abre com o grupo e Anular grupo; anular usa o endpoint existente', async () => {
    grupos.mockResolvedValue([grupoConfirmado()])
    sugestoes.mockResolvedValue([])
    anular.mockResolvedValue({ anulado: true, grupo: grupoConfirmado({ estado: 'ANULADO' }) })
    abrir(desfecho({ situacao: 'EM_GRUPO', grupoSugerido: undefined }))
    await userEvent.click(await screen.findByRole('button', { name: /^Anular grupo de PEDRONI/ }))
    const dlg = await screen.findByRole('dialog')
    await userEvent.type(within(dlg).getByLabelText('Motivo'), 'boleto pago por fora do sistema')
    await userEvent.click(within(dlg).getByRole('button', { name: 'Anular grupo' }))
    await waitFor(() => expect(anular).toHaveBeenCalledWith('G1', 'boleto pago por fora do sistema'))
  })

  it('grupo NÃO confirmável: mostra o motivo e nenhum botão de confirmar', async () => {
    sugestoes.mockResolvedValue([
      sugestaoGrupo({ confirmavel: false, motivo: 'NAO_LIBERADO', motivos: ['NAO_LIBERADO'] }),
    ])
    abrir(desfecho())
    expect(await screen.findByText(/aguardando alçada/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Confirmar grupo/ })).not.toBeInTheDocument()
  })

  it('sem sispag:executar o bloco é só leitura', async () => {
    abrir(desfecho(), { podeExecutar: false })
    await screen.findByRole('region', { name: /PEDRONI/ })
    expect(screen.queryByRole('button', { name: /Confirmar grupo/ })).not.toBeInTheDocument()
  })

  it('S1: com 1:1 forte (UNICA_SEGURA) o bloco fica recolhido, abaixo, como "também faz parte"', async () => {
    abrir(desfecho({ situacao: 'UNICA_SEGURA' }))
    const resumo = await screen.findByText(/Este título também faz parte de um grupo sugerido/)
    expect(resumo.closest('details')).not.toHaveAttribute('open')
    await screen.findByRole('region', { name: /PEDRONI/, hidden: true })
  })

  it('título sem grupo: nada de bloco e nenhuma leitura de grupos', async () => {
    abrir(desfecho({ situacao: 'SEM_CANDIDATO', grupoSugerido: undefined }))
    await waitFor(() => expect(fetchAjustesCentavos).toHaveBeenCalled())
    expect(screen.queryByRole('region', { name: /Boleto agrupado/ })).not.toBeInTheDocument()
    expect(sugestoes).not.toHaveBeenCalled()
  })

  describe('limpeza do conteúdo de título único quando o grupo está em cima', () => {
    const CANDIDATO = {
      ddcCod: 500,
      ditCod: 1,
      numeroBoleto: '7128',
      valorBoleto: 525,
      vencimentoBoleto: '2026-10-21',
      avaliacao: {
        resultado: 'FORTE' as const,
        deltaValor: 0,
        deltaPercentual: 0,
        deltaDias: 0,
        sinais: [],
        confirmavel: true,
      },
      ancorado: true,
      confirmavel: true,
    }

    it.each([
      ['GRUPO_SUGERIDO', 'GRUPO_SUGERIDO' as const],
      ['EM_GRUPO', 'EM_GRUPO' as const],
    ])('%s: sem a linha "Sugestão de boleto" nem o motivo repetido do servidor', async (_n, situacao) => {
      if (situacao === 'EM_GRUPO') {
        grupos.mockResolvedValue([grupoConfirmado()])
        sugestoes.mockResolvedValue([])
      }
      abrir(desfecho({ situacao }))
      await screen.findByRole('region', { name: /Boleto agrupado de PEDRONI/ })
      expect(screen.queryByText('Sugestão de boleto')).not.toBeInTheDocument()
      expect(screen.queryByText(/Um único boleto fecha a soma/)).not.toBeInTheDocument()
      expect(screen.queryByText(/gaveta do título ou na aba Boletos DDA/)).not.toBeInTheDocument()
    })

    it('sem candidato individual confirmável, o parágrafo "É uma indicação… não grava nada no Conexos" some da gaveta', async () => {
      abrir(desfecho())
      await screen.findByRole('region', { name: /Boleto agrupado de PEDRONI/ })
      expect(screen.queryByText(/É uma indicação para você conferir/)).not.toBeInTheDocument()
    })

    it('o bloco do grupo diz, numa linha, que confirmar não grava nada no Conexos', async () => {
      abrir(desfecho())
      const bloco = await screen.findByRole('region', { name: /Boleto agrupado de PEDRONI/ })
      expect(within(bloco).getByText(/não grava nada no Conexos/)).toBeInTheDocument()
    })

    it('título em grupo: o estado "Nenhum boleto DDA com este valor" não aparece', async () => {
      abrir(desfecho())
      await screen.findByRole('region', { name: /Boleto agrupado de PEDRONI/ })
      await waitFor(() => expect(fetchBoletosDdaDoTitulo).toHaveBeenCalled())
      expect(screen.queryByText('Nenhum boleto DDA com este valor')).not.toBeInTheDocument()
    })

    it('título SEM grupo e sem boleto continua mostrando "Nenhum boleto DDA com este valor"', async () => {
      abrir(desfecho({ situacao: 'SEM_CANDIDATO', grupoSugerido: undefined }))
      expect(await screen.findByText('Nenhum boleto DDA com este valor')).toBeInTheDocument()
    })

    it('S1 inalterado: com 1:1 forte a seção do título único aparece normalmente e o grupo fica recolhido abaixo', async () => {
      abrir(desfecho({ situacao: 'UNICA_SEGURA', candidatos: [CANDIDATO], totalCandidatos: 1 }))
      expect(await screen.findByText('Sugestão de boleto')).toBeInTheDocument()
      expect(screen.getByText(/É uma indicação para você conferir/)).toBeInTheDocument()
      expect(screen.getByText(/Este título também faz parte de um grupo sugerido/)).toBeInTheDocument()
    })
  })
})
