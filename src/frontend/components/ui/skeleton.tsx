import { cn } from '@/lib/utils'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

function Skeleton({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="skeleton" className={cn('bg-accent animate-pulse rounded-md', className)} {...props} />
}

/**
 * Skeleton com a FORMA de uma tabela (`docs/design-system/skeleton.md` §Skeleton.Table).
 *
 * Usa as mesmas primitivas `Table*` da tabela real de propósito: são elas que definem altura de
 * linha e padding de célula, então a transição carregando → carregado não desloca nada. Um bloco
 * cinza genérico com a altura "mais ou menos certa" empurra a página inteira quando os dados
 * chegam, que é exatamente o defeito que um skeleton existe para evitar.
 *
 * `larguras` permite aproximar cada coluna do conteúdo que ela vai receber (data curta, nome longo,
 * valor à direita). Sem elas, todas as colunas nascem iguais e a página ainda dá um pulo lateral.
 */
function TableSkeleton({
  columns,
  rows = 8,
  larguras,
  className,
  'aria-label': ariaLabel = 'Carregando tabela',
}: {
  columns: number
  rows?: number
  larguras?: string[]
  className?: string
  'aria-label'?: string
}) {
  const largura = (i: number) => larguras?.[i] ?? 'w-24'
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label={ariaLabel}
      className={cn('overflow-x-auto rounded-lg border', className)}
    >
      <Table aria-hidden>
        <TableHeader>
          <TableRow>
            {Array.from({ length: columns }).map((_, i) => (
              <TableHead key={i}>
                <Skeleton className={cn('h-4', largura(i))} />
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {Array.from({ length: rows }).map((_, linha) => (
            <TableRow key={linha}>
              {Array.from({ length: columns }).map((_, coluna) => (
                <TableCell key={coluna}>
                  {/* `h-5` acompanha a altura de um badge/texto de célula, não a de uma linha nua. */}
                  <Skeleton className={cn('h-5', largura(coluna))} />
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

export { Skeleton, TableSkeleton }
