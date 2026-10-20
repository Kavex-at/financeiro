'use client'

import { ArrowDown, ArrowUp, ChevronsUpDown, Filter } from 'lucide-react'
import * as React from 'react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { TableHead } from '@/components/ui/table'
import { cn } from '@/lib/utils'

/**
 * Cabeçalho de coluna com ordenação (clique no nome) e filtro (ícone do funil, abre um popover).
 * Reutilizável: o filtro em si é o `children` (texto, faixa, múltipla escolha). Estado fica com
 * quem usa; este componente só desenha e avisa. O funil fica preenchido quando há filtro ativo.
 *
 * Acessibilidade: `aria-sort` no `<th>`, o nome é um botão, o funil tem nome próprio e
 * `aria-pressed` quando ativo, e o popover devolve o foco ao funil ao fechar (Radix).
 */

export type DirecaoOrdenacao = 1 | -1 | null

export interface ColumnHeaderFilterProps {
  label: string
  /** Direção atual quando ESTA coluna é a ordenada; `null` quando é outra. */
  direcao: DirecaoOrdenacao
  /** Pede a ordenação (a coluna decide o ciclo asc → desc → padrão). */
  onOrdenar: (direcao: 1 | -1) => void
  /** Rótulos dos dois botões de ordem dentro do popover (ex.: "Menor primeiro"). */
  rotulosOrdem?: readonly [string, string]
  ativo: boolean
  onLimpar: () => void
  /** "12 resultados" no rodapé do popover. */
  resumo?: string
  align?: 'left' | 'right'
  className?: string
  children: React.ReactNode
}

export function ColumnHeaderFilter({
  label,
  direcao,
  onOrdenar,
  rotulosOrdem = ['A a Z', 'Z a A'],
  ativo,
  onLimpar,
  resumo,
  align = 'left',
  className,
  children,
}: ColumnHeaderFilterProps) {
  const Seta = direcao === 1 ? ArrowUp : direcao === -1 ? ArrowDown : ChevronsUpDown
  return (
    <TableHead
      aria-sort={direcao === 1 ? 'ascending' : direcao === -1 ? 'descending' : 'none'}
      className={cn('whitespace-nowrap', align === 'right' && 'text-right', className)}
    >
      <div className={cn('flex items-center gap-0.5', align === 'right' && 'justify-end')}>
        <button
          type="button"
          onClick={() => onOrdenar(direcao === 1 ? -1 : 1)}
          aria-label={`Ordenar por ${label}`}
          className={cn(
            'inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-xs font-medium hover:bg-accent focus-visible:ring-ring/50 focus-visible:ring-[3px] outline-none',
            direcao !== null && 'text-foreground',
          )}
        >
          {label}
          <Seta
            className={cn('size-3', direcao === null ? 'opacity-40' : 'text-primary')}
            aria-hidden
          />
        </button>
        <Popover>
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label={`Filtrar ${label}`}
              aria-pressed={ativo}
              className={cn(
                'inline-flex size-6 items-center justify-center rounded-md hover:bg-accent focus-visible:ring-ring/50 focus-visible:ring-[3px] outline-none',
                ativo ? 'bg-primary text-primary-foreground hover:bg-primary/90' : 'text-muted-foreground',
              )}
            >
              <Filter className="size-3" aria-hidden />
            </button>
          </PopoverTrigger>
          <PopoverContent
            align={align === 'right' ? 'end' : 'start'}
            className="w-64 space-y-3 p-3 font-normal text-foreground"
          >
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium">{label}</p>
            </div>
            <div className="flex gap-1">
              {([1, -1] as const).map((d, i) => (
                <Button
                  key={d}
                  type="button"
                  size="sm"
                  variant={direcao === d ? 'default' : 'outline'}
                  className="h-7 flex-1 px-2 text-xs"
                  aria-pressed={direcao === d}
                  onClick={() => onOrdenar(d)}
                >
                  {d === 1 ? <ArrowUp className="size-3" aria-hidden /> : <ArrowDown className="size-3" aria-hidden />}
                  {rotulosOrdem[i]}
                </Button>
              ))}
            </div>
            {children}
            <div className="flex items-center justify-between border-t pt-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs"
                disabled={!ativo}
                onClick={onLimpar}
              >
                Limpar filtro
              </Button>
              {resumo ? (
                <span className="text-xs text-muted-foreground" aria-live="polite">
                  {resumo}
                </span>
              ) : null}
            </div>
          </PopoverContent>
        </Popover>
      </div>
    </TableHead>
  )
}

// ------------------------------------------------------------------ conteúdos de filtro

/** Texto "contém…". */
export function FiltroTexto({
  label,
  valor,
  onChange,
  placeholder = 'Contém…',
}: {
  label: string
  valor: string
  onChange: (v: string) => void
  placeholder?: string
}) {
  return (
    <Input
      type="text"
      value={valor}
      placeholder={placeholder}
      aria-label={`Filtrar ${label} por texto`}
      onChange={(e) => onChange(e.target.value)}
    />
  )
}

/** Faixa numérica De/Até (valor em reais). */
export function FiltroFaixaNumerica({
  label,
  min,
  max,
  onChange,
}: {
  label: string
  min: string
  max: string
  onChange: (v: { min: string; max: string }) => void
}) {
  return (
    <div className="grid grid-cols-2 gap-2">
      <label className="space-y-1 text-xs text-muted-foreground">
        De (R$)
        <Input
          type="number"
          inputMode="decimal"
          min={0}
          value={min}
          aria-label={`${label}: valor mínimo`}
          onChange={(e) => onChange({ min: e.target.value, max })}
        />
      </label>
      <label className="space-y-1 text-xs text-muted-foreground">
        Até (R$)
        <Input
          type="number"
          inputMode="decimal"
          min={0}
          value={max}
          aria-label={`${label}: valor máximo`}
          onChange={(e) => onChange({ min, max: e.target.value })}
        />
      </label>
    </div>
  )
}

/** Período De/Até por dia civil (`YYYY-MM-DD`). */
export function FiltroPeriodo({
  label,
  de,
  ate,
  onChange,
}: {
  label: string
  de: string
  ate: string
  onChange: (v: { de: string; ate: string }) => void
}) {
  return (
    <div className="grid grid-cols-2 gap-2">
      <label className="space-y-1 text-xs text-muted-foreground">
        De
        <Input
          type="date"
          value={de}
          max={ate || undefined}
          aria-label={`${label}: de`}
          onChange={(e) => onChange({ de: e.target.value, ate })}
        />
      </label>
      <label className="space-y-1 text-xs text-muted-foreground">
        Até
        <Input
          type="date"
          value={ate}
          min={de || undefined}
          aria-label={`${label}: até`}
          onChange={(e) => onChange({ de, ate: e.target.value })}
        />
      </label>
    </div>
  )
}

export interface OpcaoFiltro<V extends string | number> {
  valor: V
  rotulo: string
  /** Quantas linhas há nesta opção (opcional). */
  total?: number
}

/** Múltipla escolha com caixas de seleção; vazio = sem filtro. */
export function FiltroMultipla<V extends string | number>({
  label,
  opcoes,
  selecionadas,
  onChange,
}: {
  label: string
  opcoes: ReadonlyArray<OpcaoFiltro<V>>
  selecionadas: readonly V[]
  onChange: (v: V[]) => void
}) {
  const grupoId = React.useId()
  const alternar = (v: V) =>
    onChange(selecionadas.includes(v) ? selecionadas.filter((x) => x !== v) : [...selecionadas, v])
  if (opcoes.length === 0) {
    return <p className="text-xs text-muted-foreground">Nenhuma opção na lista atual.</p>
  }
  return (
    <div role="group" aria-label={`Filtrar ${label}`} className="max-h-56 space-y-1 overflow-y-auto">
      {opcoes.map((o) => {
        const id = `${grupoId}-${String(o.valor)}`
        return (
          <label key={String(o.valor)} htmlFor={id} className="flex cursor-pointer items-center gap-2 py-0.5 text-sm">
            <Checkbox
              id={id}
              checked={selecionadas.includes(o.valor)}
              onCheckedChange={() => alternar(o.valor)}
            />
            <span className="flex-1">{o.rotulo}</span>
            {o.total !== undefined ? (
              <span className="text-xs tabular-nums text-muted-foreground">{o.total}</span>
            ) : null}
          </label>
        )
      })}
    </div>
  )
}
