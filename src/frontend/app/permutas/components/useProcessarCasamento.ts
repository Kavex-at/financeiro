'use client'

import * as React from 'react'
import { toast } from 'sonner'
import { reconciliarAdiantamento } from '@/lib/api'
import { isSessionExpiredError } from '@/lib/http'
import type { CasamentoSugerido, PermutaBorderoVinculo, ReconciliarResult } from '@/lib/types'
import { temAlgoAProcessar } from './format'

/** Desfecho de UM adiantamento: a requisição voltou (com os resultados) ou estourou. */
type Desfecho =
  | { docCod: string; ok: true; resultado: ReconciliarResult }
  | { docCod: string; ok: false; motivo: string }

const motivoDe = (err: unknown): string => (err instanceof Error ? err.message : 'erro desconhecido')

/**
 * "Processar" de um casamento automático = BAIXA REAL no fin010 (cria borderô), igual aos
 * manuais. Para cada adiantamento do grupo, chama o reconciliar (que AUTO-ALOCA a partir do
 * casamento) → borderô em CADASTRO. Os já processados são ignorados. (Regra 2026-06-24:
 * Automáticas baixam.)
 *
 * REVERSÃO 2026-08-05 (ADR-0029): entre 2026-07-31 e 2026-08-05 este botão gerou a Solicitação de
 * Numerário (com299) em vez da baixa. A SN da Frente I (Permutas) e a SN da Frente IV
 * (Recebimentos) são processos DIFERENTES; a semelhança entre os serviços trocou os fios e o
 * Processar quebrou em produção. A SN dos Recebimentos segue viva na sua própria página.
 *
 * Cada adiantamento é uma requisição independente e a baixa de um NÃO é desfeita quando o
 * seguinte falha. Por isso o desfecho é acumulado por adiantamento e reportado em separado: um
 * único try em volta do laço anunciava "Falha ao processar" com a baixa do primeiro já no fin010.
 */
export function useProcessarCasamento({
  confirmacao,
  setConfirmacao,
  statusPorAdto,
  load,
}: {
  confirmacao: CasamentoSugerido | null
  setConfirmacao: (c: CasamentoSugerido | null) => void
  /** Vínculo de borderô por adiantamento — carga LAZY, chega DEPOIS do /gestao. */
  statusPorAdto: Record<string, PermutaBorderoVinculo>
  load: () => Promise<void>
}) {
  const [processando, setProcessando] = React.useState<string | null>(null)

  const confirmarProcessamento = React.useCallback(async () => {
    if (!confirmacao) return
    const c = confirmacao
    // MESMO predicado do modal (`temAlgoAProcessar`): só dispara requisição para linha que tem de
    // fato algo a baixar. Linha `valorASerUsado = 0` (adto já consumido, ou moeda diferente da
    // invoice) não tem alocação no backend — mandá-la respondia HTTP 500 e a tela declarava a
    // operação inteira falha, mesmo com a permuta que importava já liquidada (prod 2026-09-14,
    // processo 173: adto 4471 baixou certo, adto 4742 `0,00 BRL` derrubou a tela).
    // `statusPorAdto` PRECISA estar nas dependências: sem ele o callback filtrava contra o `{}` da
    // primeira renderização e reenviava adiantamento que já tem borderô.
    const pendentes = c.adiantamentos.filter((a) => temAlgoAProcessar(a, statusPorAdto[a.docCod]))
    setConfirmacao(null)
    setProcessando(c.invoice.docCod)
    try {
      const desfechos: Desfecho[] = []
      let sessaoExpirada = false
      for (const adto of pendentes) {
        try {
          const resultado = await reconciliarAdiantamento(adto.docCod, { dryRun: false })
          desfechos.push({ docCod: adto.docCod, ok: true, resultado })
        } catch (err) {
          // Sessão expirada: o `SessionExpiredModal` é o dono da UX, e os próximos também
          // falhariam. Para aqui, mas ainda anuncia o que já entrou.
          if (isSessionExpiredError(err)) {
            sessaoExpirada = true
            break
          }
          desfechos.push({ docCod: adto.docCod, ok: false, motivo: motivoDe(err) })
        }
      }
      anunciar(c, desfechos, sessaoExpirada ? pendentes.length - desfechos.length : 0)
      // Recarrega mesmo com falha: o que já baixou tem de aparecer com o borderô na tela.
      await load()
    } finally {
      setProcessando(null)
    }
  }, [confirmacao, setConfirmacao, statusPorAdto, load])

  return { processando, confirmarProcessamento }
}

/** Toasts do processamento — o que ENTROU no fin010 e o que falhou, cada um com o seu. */
function anunciar(c: CasamentoSugerido, desfechos: Desfecho[], naoEnviados: number): void {
  const ok = desfechos.flatMap((d) => (d.ok ? [d.resultado] : []))
  const falhas = desfechos.flatMap((d) => (d.ok ? [] : [d]))
  const dryRun = ok.some((r) => r.dryRun)
  const contar = (s: string) =>
    ok.reduce((n, r) => n + r.resultados.filter((x) => x.status === s).length, 0)
  const settled = contar('settled')
  const parciais = contar('parcial')
  const erros = contar('error')
  // Baixas que de fato ENTRARAM no Conexos. É isto — e não "a requisição voltou" — que decide
  // se a falha de um adiantamento pode ser anunciada como falha do processo inteiro.
  const lancadas = dryRun ? 0 : settled + parciais

  if (dryRun) {
    toast.info('Escrita desabilitada no servidor (dry-run). Payload validado, sem baixa real.')
  } else {
    const borderos = new Set(ok.flatMap((r) => (r.borCod !== undefined ? [r.borCod] : [])))
    if (erros > 0) toast.error(`${erros} baixa(s) falharam — veja a aba Borderôs.`)
    // `parcial` NÃO é sucesso nem erro: a baixa entrou, mas sobrou resíduo. Sem este toast ele
    // não apareceria em lugar nenhum da tela — o silêncio que a ADR-0044 existe para acabar.
    if (parciais > 0)
      toast.warning(
        `${parciais} baixa(s) PARCIAIS — entraram no Conexos sem fechar o valor alocado. ` +
          'Re-aloque o par para lançar o restante.',
      )
    if (settled > 0)
      toast.success(
        `Processo ${c.priCod}: ${settled} baixa(s) no fin010 (borderô${
          borderos.size === 1 ? ` ${[...borderos][0]}` : 's'
        }, EM CADASTRO). Revise e aprove em Borderôs.`,
      )
  }

  // Sessão caiu no meio: quem não foi enviado segue pendente. Só vale dizer se algo já entrou —
  // sem isso, o `SessionExpiredModal` sozinho já conta a história inteira.
  if (naoEnviados > 0 && lancadas > 0)
    toast.warning(
      `Processo ${c.priCod}: a sessão expirou — ${naoEnviados} adiantamento(s) não foram enviados ` +
        'e seguem pendentes. As baixas anunciadas acima já estão no fin010.',
    )

  if (falhas.length === 0) return
  const detalhe = falhas.map((f) => `Adiantamento ${f.docCod}: ${f.motivo}`).join(' · ')
  if (lancadas === 0) {
    // Nada entrou no fin010: aí sim é falha do processo, no formato de sempre.
    toast.error(`Falha ao processar o processo ${c.priCod}`, { description: detalhe })
    return
  }
  // Houve baixa E houve falha. O vermelho não pode apagar o que já está no fin010.
  toast.error(
    `Processo ${c.priCod}: ${falhas.length} de ${desfechos.length} adiantamento(s) NÃO processado(s)`,
    {
      description:
        `${detalhe}. As baixas anunciadas acima JÁ ESTÃO no fin010 — confira na aba Borderôs ` +
        'antes de processar de novo.',
      duration: 30000,
    },
  )
}
