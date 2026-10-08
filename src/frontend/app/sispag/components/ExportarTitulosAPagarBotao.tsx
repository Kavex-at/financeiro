'use client'

import { FileSpreadsheet } from 'lucide-react'
import * as React from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { baixarBlob } from '@/lib/download'
import { isSessionExpiredError } from '@/lib/http'
import { exportarTitulosAPagar, MAX_TITULOS_EXPORT, type TituloAPagar } from '@/lib/sispag'
import { chaveTitulo } from './selecionarTodos'

/**
 * Botão "Exportar (.xlsx)" da aba Títulos a pagar: exporta as linhas do filtro atual — todas as
 * páginas, na ordem da tela. Manda só as chaves; os valores saem da carteira no servidor.
 */
export function ExportarTitulosAPagarBotao({ titulos }: { titulos: TituloAPagar[] }) {
  const [exportando, setExportando] = React.useState(false)
  const acimaDoTeto = titulos.length > MAX_TITULOS_EXPORT

  const exportar = async () => {
    setExportando(true)
    try {
      const { nome, arquivo } = await exportarTitulosAPagar(titulos.map(chaveTitulo))
      baixarBlob(arquivo, nome)
      toast.success('Títulos exportados', { description: `${titulos.length} título(s) em ${nome}` })
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
    <Button
      size="sm"
      variant="outline"
      disabled={exportando || titulos.length === 0 || acimaDoTeto}
      onClick={exportar}
      title={
        acimaDoTeto
          ? `Máximo de ${MAX_TITULOS_EXPORT} títulos por planilha — refine o filtro.`
          : `Exporta os ${titulos.length} títulos do filtro atual, em todas as páginas.`
      }
    >
      <FileSpreadsheet className="size-4" aria-hidden />
      {exportando ? 'Exportando…' : `Exportar (${titulos.length})`}
    </Button>
  )
}
