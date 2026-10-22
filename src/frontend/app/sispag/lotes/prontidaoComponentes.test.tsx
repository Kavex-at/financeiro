import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ItemLote, LotePagamento, PendenciaLote, ProntidaoLote } from '@/lib/sispag'
import { FinalizarProntos } from './FinalizarProntos'
import { FiltroProntidaoLotes } from './FiltroProntidaoLotes'
import { PendenciasDoLote } from './PendenciasDoLote'
import { SeloProntidao } from './SeloProntidao'

jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn(), warning: jest.fn() } }))

const item = (titCod: string, over: Partial<ItemLote> = {}): ItemLote =>
  ({
    loteId: 'L1',
    filCod: 2,
    docCod: '100',
    titCod,
    credor: `CREDOR ${titCod}`,
    valor: 100,
    modalidade: 'BOLETO',
    incluidoPor: 'ana',
    ...over,
  }) as ItemLote

const chave = (titCod: string) => ({ filCod: 2, docCod: '100', titCod })

const pend = (titCod: string, over: Partial<PendenciaLote> = {}): PendenciaLote => ({
  efeito: 'BARRA',
  codigo: 'SEM_FORMA',
  rotulo: 'Sem forma de pagamento',
  detalhe: 'escolha a forma na tabela de itens',
  dono: 'VOCE',
  chave: chave(titCod),
  ...over,
})

const prontidao = (over: Partial<ProntidaoLote> = {}): ProntidaoLote => ({
  estado: 'COM_PENDENCIA',
  itensQueVao: 2,
  barram: 1,
  saem: 0,
  pendencias: [pend('1')],
  fontesIndisponiveis: [],
  ...over,
})

const lote = (id: string, over: Partial<LotePagamento> = {}): LotePagamento => ({
  id,
  filCod: 2,
  status: 'RASCUNHO',
  criadoPor: 'ana',
  versao: 3,
  itens: [item('1'), item('2')],
  ...over,
})

const acoes = (over = {}) => ({
  podeExecutar: true,
  onTratarAlerta: jest.fn(),
  onResolvido: jest.fn(),
  ...over,
})

describe('SeloProntidao (ADR-0076)', () => {
  it('pronto: "Pronto para finalizar"', () => {
    render(<SeloProntidao itens={2} prontidao={prontidao({ estado: 'PRONTO', barram: 0, pendencias: [] })} />)
    expect(screen.getByText('Pronto para finalizar')).toBeInTheDocument()
  })

  it('com o que barra e o que sai: "Não finaliza" e "N saem do lote", com a barra descrita', () => {
    render(
      <SeloProntidao
        itens={4}
        prontidao={prontidao({
          barram: 1,
          saem: 2,
          pendencias: [pend('1'), pend('2', { efeito: 'SAI' }), pend('3', { efeito: 'SAI' })],
        })}
      />,
    )
    expect(screen.getByText('Não finaliza')).toBeInTheDocument()
    expect(screen.getByText('2 saem do lote')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: '1 de 4 itens prontos, 2 saem, 1 barram' })).toBeInTheDocument()
  })

  it('só o que sai: não diz "Não finaliza"', () => {
    render(
      <SeloProntidao
        itens={2}
        prontidao={prontidao({ barram: 0, saem: 1, pendencias: [pend('1', { efeito: 'SAI' })] })}
      />,
    )
    expect(screen.queryByText('Não finaliza')).not.toBeInTheDocument()
    expect(screen.getByText('1 sai do lote')).toBeInTheDocument()
  })

  it('sem prontidão (backend antigo): nada', () => {
    const { container } = render(<SeloProntidao itens={2} />)
    expect(container).toBeEmptyDOMElement()
  })
})

describe('PendenciasDoLote (ADR-0076, I20f)', () => {
  it('mostra o resumo, o efeito, o item, o motivo e quem resolve', () => {
    render(<PendenciasDoLote lote={lote('L1', { prontidao: prontidao() })} acoes={acoes()} />)
    const lista = screen.getByRole('region', { name: 'Pendências do lote' })
    expect(within(lista).getByText('2 de 2 itens vão ao finalizar')).toBeInTheDocument()
    expect(within(lista).getByText('Resolva o que barra a finalização para poder finalizar.')).toBeInTheDocument()
    expect(within(lista).getByText('Barra a finalização')).toBeInTheDocument()
    expect(within(lista).getByText('CREDOR 1')).toBeInTheDocument()
    expect(within(lista).getByText('Sem forma de pagamento: escolha a forma na tabela de itens')).toBeInTheDocument()
    expect(within(lista).getByText('resolve: Você')).toBeInTheDocument()
  })

  it('pendência do lote (sem chave) aparece como "Lote"', () => {
    const p = prontidao({ pendencias: [pend('x', { codigo: 'SEM_CONTA', rotulo: 'Sem conta pagadora', chave: undefined })] })
    render(<PendenciasDoLote lote={lote('L1', { prontidao: p })} acoes={acoes()} />)
    expect(screen.getByText('Lote')).toBeInTheDocument()
  })

  it('mostra 4 e esconde o resto atrás de "Mostrar as outras N pendências"', async () => {
    const itens = ['1', '2', '3', '4', '5', '6'].map((t) => item(t))
    const p = prontidao({ pendencias: itens.map((i) => pend(i.titCod)) })
    render(<PendenciasDoLote lote={lote('L1', { itens, prontidao: p })} acoes={acoes()} />)
    expect(screen.getAllByText('Barra a finalização')).toHaveLength(4)
    await userEvent.click(screen.getByRole('button', { name: 'Mostrar as outras 2 pendências' }))
    expect(screen.getAllByText('Barra a finalização')).toHaveLength(6)
  })

  it('"Tratar alerta" abre o diálogo do item; some para quem não executa', async () => {
    const p = prontidao({
      pendencias: [
        pend('1', {
          codigo: 'DUPLICIDADE_ABERTA',
          rotulo: 'Possível duplicidade',
          acao: { codigo: 'TRATAR_DUPLICIDADE', rotulo: 'Tratar alerta' },
        }),
      ],
    })
    const a = acoes()
    const { rerender } = render(<PendenciasDoLote lote={lote('L1', { prontidao: p })} acoes={a} />)
    await userEvent.click(screen.getByRole('button', { name: 'Tratar alerta' }))
    expect(a.onTratarAlerta).toHaveBeenCalledWith(expect.objectContaining({ titCod: '1' }))
    rerender(<PendenciasDoLote lote={lote('L1', { prontidao: p })} acoes={acoes({ podeExecutar: false })} />)
    expect(screen.queryByRole('button', { name: 'Tratar alerta' })).not.toBeInTheDocument()
  })

  it('"Pedir autorização" leva à tela de autorizações já preenchida', () => {
    const itens = [item('1', { modalidade: 'PIX', credor: 'ACME' })]
    const p = prontidao({
      pendencias: [
        pend('1', {
          efeito: 'SAI',
          codigo: 'FAVORECIDO_NAO_AUTORIZADO',
          rotulo: 'Favorecido não autorizado',
          dono: 'APROVADOR',
          acao: { codigo: 'PEDIR_AUTORIZACAO', rotulo: 'Pedir autorização' },
        }),
      ],
    })
    render(<PendenciasDoLote lote={lote('L1', { itens, prontidao: p })} acoes={acoes()} />)
    const link = screen.getByRole('link', { name: 'Pedir autorização' })
    expect(link.getAttribute('href')).toContain('/sispag/favorecidos-autorizados?pedir=1&modalidade=PIX')
    expect(link.getAttribute('href')).toContain('credor=ACME')
    expect(screen.getByText('resolve: Aprovador')).toBeInTheDocument()
  })

  it('"Abrir cadastro no Conexos" (dono Cadastro) abre a orientação com o documento', async () => {
    const p = prontidao({
      pendencias: [
        pend('1', {
          efeito: 'SAI',
          codigo: 'SEM_DADO_PAGAMENTO',
          rotulo: 'Sem conta nem chave PIX no cadastro',
          dono: 'CADASTRO',
          acao: { codigo: 'ABRIR_CADASTRO_NO_CONEXOS', rotulo: 'Abrir cadastro no Conexos' },
        }),
      ],
    })
    render(<PendenciasDoLote lote={lote('L1', { prontidao: p })} acoes={acoes()} />)
    expect(screen.getByText('resolve: Cadastro')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Abrir cadastro no Conexos' }))
    expect(await screen.findByText('Cadastrar conta ou chave PIX no Conexos')).toBeInTheDocument()
    expect(screen.getByText('filial 2 · documento 100/1')).toBeInTheDocument()
  })

  it('situação bloqueada usa o botão da situação do título ("Ver boleto" chama o handler)', async () => {
    const onVerBoleto = jest.fn()
    const p = prontidao({
      pendencias: [
        pend('1', {
          codigo: 'SITUACAO_BLOQUEADA',
          rotulo: 'Boleto sem DDA',
          motivo: 'BOLETO_SEM_DDA',
          acao: { codigo: 'VER_BOLETO', rotulo: 'Ver boleto' },
        }),
      ],
    })
    render(<PendenciasDoLote lote={lote('L1', { prontidao: p })} acoes={acoes({ onVerBoleto })} />)
    await userEvent.click(screen.getByRole('button', { name: 'Ver boleto' }))
    expect(onVerBoleto).toHaveBeenCalledWith(expect.objectContaining({ docCod: '100', titCod: '1' }))
  })

  it('fonte caída: avisa "Situação incompleta" com a consulta que faltou', () => {
    const p = prontidao({ fontesIndisponiveis: ['DUPLICIDADE'] })
    render(<PendenciasDoLote lote={lote('L1', { prontidao: p })} acoes={acoes()} />)
    expect(screen.getByText(/Situação incompleta: sem a consulta de duplicidade/)).toBeInTheDocument()
  })
})

describe('FiltroProntidaoLotes', () => {
  it('marca o filtro escolhido, mostra as contagens e troca a ordem', async () => {
    const onFiltro = jest.fn()
    render(
      <FiltroProntidaoLotes
        filtro="todos"
        contagens={{ todos: 5, prontos: 2, 'com-pendencia': 3 }}
        onFiltro={onFiltro}
        ordem="pendencias"
        onOrdem={jest.fn()}
      />,
    )
    const grupo = screen.getByRole('group', { name: 'Situação do lote' })
    expect(within(grupo).getByRole('button', { name: /Todos 5/ })).toHaveAttribute('aria-pressed', 'true')
    await userEvent.click(within(grupo).getByRole('button', { name: /Prontos para finalizar 2/ }))
    expect(onFiltro).toHaveBeenCalledWith('prontos')
    expect(screen.getByLabelText('Ordenar por')).toHaveTextContent('Pendências primeiro')
  })
})

describe('FinalizarProntos (D20)', () => {
  it('sem lote pronto, nada aparece', () => {
    const { container } = render(
      <FinalizarProntos prontos={[]} finalizar={jest.fn()} onConcluido={jest.fn()} />,
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('confirma com a lista, finaliza um por vez e mostra o resultado lote a lote', async () => {
    const finalizar = jest.fn(async (l: LotePagamento) => {
      if (l.id === 'B') throw new Error('Há alerta de duplicidade sem tratamento')
      return { retirados: l.id === 'C' ? [{}] : [] }
    })
    const onConcluido = jest.fn()
    render(
      <FinalizarProntos
        prontos={[lote('A'), lote('B', { filCod: 7 }), lote('C')]}
        finalizar={finalizar}
        onConcluido={onConcluido}
      />,
    )
    expect(screen.getByText('3 lotes sem nenhuma pendência')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Finalizar os 3 lotes prontos' }))
    const dialogo = await screen.findByRole('dialog')
    expect(within(dialogo).getAllByRole('listitem')).toHaveLength(3)
    expect(finalizar).not.toHaveBeenCalled()

    await userEvent.click(within(dialogo).getByRole('button', { name: 'Finalizar 3 lotes' }))
    expect(await within(dialogo).findByText('2 de 3 lotes finalizados')).toBeInTheDocument()
    expect(finalizar.mock.calls.map(([l]) => l.id)).toEqual(['A', 'B', 'C'])
    expect(within(dialogo).getByText('Há alerta de duplicidade sem tratamento')).toBeInTheDocument()
    expect(within(dialogo).getByText('1 item TED/PIX saiu pela verificação do favorecido.')).toBeInTheDocument()

    // O "X" do diálogo também se chama Fechar; o do rodapé é o que tem o texto.
    const fechar = within(dialogo)
      .getAllByRole('button', { name: 'Fechar' })
      .find((b) => b.textContent === 'Fechar')
    if (!fechar) throw new Error('botão Fechar do rodapé ausente')
    await userEvent.click(fechar)
    await waitFor(() => expect(onConcluido).toHaveBeenCalledTimes(1))
  })

  it('cancelar não finaliza nada nem recarrega', async () => {
    const finalizar = jest.fn()
    const onConcluido = jest.fn()
    render(<FinalizarProntos prontos={[lote('A')]} finalizar={finalizar} onConcluido={onConcluido} />)
    await userEvent.click(screen.getByRole('button', { name: 'Finalizar o lote pronto' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Cancelar' }))
    expect(finalizar).not.toHaveBeenCalled()
    expect(onConcluido).not.toHaveBeenCalled()
  })
})
