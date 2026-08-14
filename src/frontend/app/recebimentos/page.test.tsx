import { act, render, screen } from '@testing-library/react'
import RecebimentosPage from '@/app/recebimentos/page'
import { metadata } from '@/app/recebimentos/layout'
import { fetchPainelRecebimentos } from '@/lib/recebimentos'

// O painel busca a carteira no mount; o objeto deste teste é o cabeçalho, não os
// dados. Reaproveita o `recebimentosPainelFixture` já exportado pela lib — montar
// um painel à mão aqui só criaria uma segunda shape para manter em sincronia.
jest.mock('@/lib/recebimentos', () => {
  const real = jest.requireActual('@/lib/recebimentos')
  return {
    ...real,
    fetchPainelRecebimentos: jest.fn().mockResolvedValue(real.recebimentosPainelFixture),
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
