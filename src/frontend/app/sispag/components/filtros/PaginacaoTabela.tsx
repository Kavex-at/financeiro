'use client'

import { Button } from '@/components/ui/button'

/**
 * Rodapé "Mostrando X–Y de N · Página P de T · Anterior/Próxima" das tabelas da tela SISPAG
 * (Títulos a pagar e Boletos DDA). Some com zero linhas; os botões só com mais de uma página.
 */
export function PaginacaoTabela({
  pagina,
  pageSize,
  total,
  onPagina,
}: {
  pagina: number
  pageSize: number
  total: number
  onPagina: (p: number) => void
}) {
  if (total <= 0) return null
  const totalPaginas = Math.max(1, Math.ceil(total / pageSize))
  return (
    <div className="flex flex-col gap-2 pt-1 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
      <span>
        Mostrando {(pagina - 1) * pageSize + 1}–{Math.min(pagina * pageSize, total)} de {total}
      </span>
      {totalPaginas > 1 ? (
        <div className="flex items-center gap-2">
          <span>
            Página {pagina} de {totalPaginas}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={pagina <= 1}
            onClick={() => onPagina(Math.max(1, pagina - 1))}
          >
            Anterior
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={pagina >= totalPaginas}
            onClick={() => onPagina(Math.min(totalPaginas, pagina + 1))}
          >
            Próxima
          </Button>
        </div>
      ) : null}
    </div>
  )
}
