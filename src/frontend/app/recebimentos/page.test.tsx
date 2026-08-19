import { act, fireEvent, render, screen, within } from '@testing-library/react'
import RecebimentosPage from '@/app/recebimentos/page'
import { metadata } from '@/app/recebimentos/layout'
import {
  fetchPainelEnriquecimento,
  fetchPainelRecebimentos,
  recebimentosPainelFixture,
} from '@/lib/recebimentos'

// O painel busca a carteira no mount; o objeto deste teste é o cabeçalho, não os
// dados. Reaproveita o `recebimentosPainelFixture` já exportado pela lib — montar
// um painel à mão aqui só criaria uma segunda shape para manter em sincronia.
jest.mock('@/lib/recebimentos', () => {
  const real = jest.requireActual('@/lib/recebimentos')
  return {
    ...real,
    fetchPainelRecebimentos: jest.fn().mockResolvedValue(real.recebimentosPainelFixture),
    // O enriquecimento (ADR-0038) é a 2ª chamada do mount; sem mock ele bateria na rede real.
    fetchPainelEnriquecimento: jest.fn().mockResolvedValue({
      geradoEm: '2026-08-19T12:00:00.000Z',
      modalidades: {},
      ndes: [],
      ndePendentes: 0,
    }),
  }
})

/**
 * Título da Frente IV. A rota continua `/recebimentos` (o termo de domínio segue
 * "Recebimento" na ontologia), mas o que o usuário lê é "Gestão de Adiantamentos".
 */
describe('RecebimentosPage — título', () => {
  /** Deixa o fetch do mount assentar, senão o React alerta de update fora de `act`. */
  const renderPainel = async () => {
    await act(async () => {
      render(<RecebimentosPage />)
    })
  }

  it('o H1 da página é "Gestão de Adiantamentos"', async () => {
    await renderPainel()

    expect(
      screen.getByRole('heading', { name: 'Gestão de Adiantamentos', level: 1 }),
    ).toBeInTheDocument()
  })

  it('não sobrou a tela de bloqueio "Recebimentos indisponível"', async () => {
    // A rota era gated: fora de `NEXT_PUBLIC_ENV=local` mostrava bloqueio em vez
    // do painel. O gate saiu (ADR-0028) — o painel tem de renderizar sempre.
    process.env.NEXT_PUBLIC_ENV = 'production'
    await renderPainel()

    expect(screen.queryByText(/Recebimentos indisponível/i)).not.toBeInTheDocument()
  })

  // Report do analista (2026-08-10): "esses valores não estão no extrato" — estavam,
  // só que em OUTRA conta. A carteira funde todas as contas (ADR-0032) e a tabela não
  // dizia de qual extrato cada linha veio. A antiga coluna "Tipo" era constante
  // ('CREDITO' para toda linha, porque o painel só devolve crédito) e cedeu o lugar.
  it('a tabela de transações identifica a conta, não o tipo constante', async () => {
    await renderPainel()

    const cabecalhos = screen.getAllByRole('columnheader').map((c) => c.textContent)
    expect(cabecalhos).toContain('Conta')
    expect(cabecalhos).not.toContain('Tipo')
  })

  it('o título da aba do browser acompanha o H1', () => {
    // Precisa morar no layout: `page.tsx` é 'use client' e o Next ignora
    // `export const metadata` em client component — sairia o título do layout raiz.
    expect(metadata.title).toBe('Gestão de Adiantamentos')
  })
})

/**
 * ADR-0034 — a tela para de oferecer o que não existe e ganha a aba de falhas.
 */
describe('RecebimentosPage — abas e filtros (ADR-0034)', () => {
  const renderPainel = async () => {
    await act(async () => {
      render(<RecebimentosPage />)
    })
  }

  it('pede a carteira já filtrada no servidor pelo default "A processar"', async () => {
    await renderPainel()

    // Server-side de propósito: filtrar no cliente rodava sobre a página capada em 500 linhas, e o
    // histórico processado consumia a cota da fila de trabalho.
    expect(fetchPainelRecebimentos).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'pendentes' }),
    )
  })

  it('tem aba Falhas e NÃO tem mais a Fila manual (placeholder do Módulo 2)', async () => {
    await renderPainel()

    expect(screen.getByRole('tab', { name: /Falhas/ })).toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: /Fila manual/ })).not.toBeInTheDocument()
  })

  it('não mostra os KPIs sem writer — Conciliadas e Fila manual', async () => {
    await renderPainel()

    // Um KPI permanentemente zero ensina o analista que os números da tela são decorativos.
    expect(screen.queryByText('Conciliadas')).not.toBeInTheDocument()
    expect(screen.queryByText('Fila manual')).not.toBeInTheDocument()
    expect(screen.getByText('Processadas')).toBeInTheDocument()
  })

  it('não oferece filtro por status que nada escreve', async () => {
    await renderPainel()

    const botoes = screen.getAllByRole('button').map((b) => b.textContent)
    expect(botoes).toContain('processada')
    expect(botoes).toContain('parcial')
    expect(botoes).not.toContain('conciliada')
    expect(botoes).not.toContain('manual')
  })
})

/**
 * Estados de carregamento (issue "Missing loading states").
 *
 * O que estes testes protegem: entre o clique e o dado renderizado NUNCA existe um quadro sem
 * sinal, e uma recarga jamais desmonta a carteira que o analista já está lendo.
 */
describe('RecebimentosPage — estados de carregamento', () => {
  /** Promessa que o teste resolve na hora que quiser — é o "request em voo". */
  const adiada = <T,>() => {
    let resolver: (v: T) => void = () => {}
    let rejeitar: (e: unknown) => void = () => {}
    const promessa = new Promise<T>((res, rej) => {
      resolver = res
      rejeitar = rej
    })
    return { promessa, resolver, rejeitar }
  }

  beforeEach(() => {
    jest.clearAllMocks()
    ;(fetchPainelRecebimentos as jest.Mock).mockResolvedValue(recebimentosPainelFixture)
    ;(fetchPainelEnriquecimento as jest.Mock).mockResolvedValue({
      geradoEm: '2026-08-19T12:00:00.000Z',
      modalidades: {},
      ndes: [],
      ndePendentes: 0,
    })
  })

  it('a primeira carga mostra um skeleton com a MESMA contagem de colunas da tabela final', async () => {
    // Skeleton com forma diferente do conteúdo empurra a página quando os dados chegam — é o
    // layout shift que a issue pede para eliminar.
    const emVoo = adiada<typeof recebimentosPainelFixture>()
    ;(fetchPainelRecebimentos as jest.Mock).mockReturnValue(emVoo.promessa)

    render(<RecebimentosPage />)

    // O conteúdo do skeleton é `aria-hidden` (decorativo, por `skeleton.md`), então a forma se
    // verifica pelo slot da célula e não pelo papel acessível.
    const carregando = screen.getByRole('status', { name: /Carregando a carteira/i })
    expect(carregando.querySelectorAll('[data-slot="table-head"]')).toHaveLength(10)

    await act(async () => {
      emVoo.resolver(recebimentosPainelFixture)
    })
    expect(screen.getAllByRole('columnheader')).toHaveLength(10)
  })

  it('trocar o filtro NÃO desmonta a tabela — as linhas ficam, e o botão clicado fica ocupado', async () => {
    await act(async () => {
      render(<RecebimentosPage />)
    })

    const emVoo = adiada<typeof recebimentosPainelFixture>()
    ;(fetchPainelRecebimentos as jest.Mock).mockReturnValue(emVoo.promessa)

    const botao = screen.getByRole('button', { name: 'parcial' })
    await act(async () => {
      fireEvent.click(botao)
    })

    // A carteira anterior continua na tela (nada de voltar ao skeleton).
    expect(screen.getByText('CLIENTE EXEMPLO LTDA')).toBeInTheDocument()
    expect(screen.queryByRole('status', { name: /Carregando a carteira/i })).not.toBeInTheDocument()
    // E o controle que disparou a busca diz que é ele que está trabalhando.
    expect(botao).toBeDisabled()
    expect(botao).toHaveAttribute('aria-busy', 'true')

    await act(async () => {
      emVoo.resolver(recebimentosPainelFixture)
    })
    expect(botao).not.toBeDisabled()
  })

  it('falha na RECARGA preserva a carteira e oferece tentar de novo', async () => {
    await act(async () => {
      render(<RecebimentosPage />)
    })
    ;(fetchPainelRecebimentos as jest.Mock).mockRejectedValue(new Error('API 503'))

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Recarregar/ }))
    })

    // Trocar dado velho por tela em branco é pior: o analista perde o que estava lendo.
    expect(screen.getByText('CLIENTE EXEMPLO LTDA')).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('API 503')
    expect(screen.getByRole('button', { name: /Tentar de novo/ })).toBeInTheDocument()
  })

  it('a modalidade prevista chega no segundo request e preenche a célula sem recarregar a tabela', async () => {
    ;(fetchPainelEnriquecimento as jest.Mock).mockResolvedValue({
      geradoEm: '2026-08-19T12:00:00.000Z',
      modalidades: {
        'txn-0001': {
          priVldTipo: 3,
          rotulo: 'POR ENCOMENDA',
          previsao: true,
          ndeDispensada: false,
        },
      },
      ndes: [],
      ndePendentes: 0,
    })

    await act(async () => {
      render(<RecebimentosPage />)
    })

    expect(fetchPainelEnriquecimento).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'pendentes' }),
    )
    // `~` é a marca de PREVISÃO no DomainChip — palpite não pode ter a cara de fato.
    expect(screen.getByText('~ POR ENCOMENDA')).toBeInTheDocument()
  })

  it('o enriquecimento falhando não derruba nada — a carteira veio do banco e continua de pé', async () => {
    ;(fetchPainelEnriquecimento as jest.Mock).mockRejectedValue(new Error('conexos fora'))

    await act(async () => {
      render(<RecebimentosPage />)
    })

    expect(screen.getByText('CLIENTE EXEMPLO LTDA')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('enriquecimento obsoleto NÃO pinta a carteira nova', async () => {
    // Os botões de busca ficam desabilitados enquanto a carteira carrega, mas o enriquecimento roda
    // em SEGUNDO PLANO: ele sobrevive à troca de filtro e pode chegar depois. Aplicá-lo então
    // carimbaria a modalidade de um crédito na linha de outro.
    const lenta = adiada<{
      geradoEm: string
      modalidades: Record<string, unknown>
      ndes: unknown[]
      ndePendentes: number
    }>()
    ;(fetchPainelEnriquecimento as jest.Mock).mockReturnValueOnce(lenta.promessa)

    await act(async () => {
      render(<RecebimentosPage />)
    })

    // Troca de filtro: a carteira nova chega e o enriquecimento da anterior fica órfão.
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'parcial' }))
    })

    await act(async () => {
      lenta.resolver({
        geradoEm: '2026-08-19T12:00:00.000Z',
        modalidades: {
          'txn-0001': {
            priVldTipo: 3,
            rotulo: 'POR ENCOMENDA',
            previsao: true,
            ndeDispensada: false,
          },
        },
        ndes: [],
        ndePendentes: 99,
      })
    })

    expect(screen.queryByText('~ POR ENCOMENDA')).not.toBeInTheDocument()
    expect(screen.queryByText('99')).not.toBeInTheDocument()
  })
})
