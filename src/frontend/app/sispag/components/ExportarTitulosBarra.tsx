'use client'

import { FileSpreadsheet } from 'lucide-react'
import * as React from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { isSessionExpiredError } from '@/lib/http'
import { baixarBlob } from '@/lib/download'
import {
  exportarTitulosRemessas,
  type LotePagamento,
  MAX_LOTES_EXPORT,
  temRemessa,
} from '@/lib/sispag'
import { formatBRL } from '@/lib/utils'

/** Seleção de lotes para o export de títulos — os ids marcados nos cards da aba Finalizados. */
export function useSelecaoRemessas() {
  const [selecionados, setSelecionados] = React.useState<ReadonlySet<string>>(new Set())
  const alternar = React.useCallback((lote: LotePagamento, marcado: boolean) => {
    setSelecionados((atual) => {
      const novo = new Set(atual)
      if (marcado) novo.add(lote.id)
      else novo.delete(lote.id)
      return novo
    })
  }, [])
  const definir = React.useCallback((ids: string[]) => setSelecionados(new Set(ids)), [])
  return { selecionados, alternar, definir }
}

/**
 * Barra do export de títulos das remessas (aba Finalizados): quantas remessas estão marcadas,
 * quantos títulos e quanto somam, e o botão que baixa a planilha (.xlsx) para a revisão do
 * financeiro. Só conta lotes que AINDA estão na lista e têm remessa — uma marcação que saiu do
 * filtro não vai para a planilha sem a analista ver.
 */
export function ExportarTitulosBarra({
  lotes,
  selecionados,
  onDefinir,
}: {
  /** Lotes da aba (já filtrados); só os com remessa entram na seleção. */
  lotes: LotePagamento[]
  selecionados: ReadonlySet<string>
  onDefinir: (ids: string[]) => void
}) {
  const [exportando, setExportando] = React.useState(false)
  const comRemessa = lotes.filter(temRemessa)
  if (comRemessa.length === 0) return null

  const marcados = comRemessa.filter((l) => selecionados.has(l.id))
  const titulos = marcados.reduce((acc, l) => acc + l.itens.length, 0)
  const total = marcados.reduce(
    (acc, l) => acc + l.itens.reduce((s, i) => s + (i.valor ?? 0), 0),
    0,
  )
  const acimaDoTeto = marcados.length > MAX_LOTES_EXPORT
  const todosMarcados = marcados.length === comRemessa.length

  const exportar = async () => {
    setExportando(true)
    try {
      const { nome, arquivo } = await exportarTitulosRemessas(marcados.map((l) => l.id))
      baixarBlob(arquivo, nome)
      toast.success('Títulos exportados', {
        description: `${titulos} título(s) de ${marcados.length} remessa(s) em ${nome}`,
      })
    } catch (e) {
      if (isSessionExpiredError(e)) return
      toast.error('Não foi possível exportar os títulos', {
        description: e instanceof Error ? e.message : undefined,
      })
    } finally {
      setExportando(false)
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/40 px-3 py-2">
      <FileSpreadsheet className="size-4 text-muted-foreground" aria-hidden />
      <span className="text-sm" aria-live="polite">
        {marcados.length === 0
          ? 'Marque as remessas para exportar os títulos (.xlsx).'
          : `${marcados.length} remessa(s) · ${titulos} título(s) · ${formatBRL(total)}`}
      </span>
      {acimaDoTeto ? (
        <span className="text-xs text-warning">
          Máximo de {MAX_LOTES_EXPORT} remessas por planilha.
        </span>
      ) : null}
      <div className="ml-auto flex flex-wrap gap-1">
        <Button
          size="sm"
          variant="ghost"
          disabled={exportando}
          onClick={() => onDefinir(todosMarcados ? [] : comRemessa.map((l) => l.id))}
        >
          {todosMarcados ? 'Limpar seleção' : `Marcar todas (${comRemessa.length})`}
        </Button>
        <Button
          size="sm"
          disabled={exportando || marcados.length === 0 || acimaDoTeto}
          onClick={exportar}
        >
          <FileSpreadsheet className="size-4" aria-hidden />
          {exportando ? 'Exportando…' : 'Exportar títulos (.xlsx)'}
        </Button>
      </div>
    </div>
  )
}
