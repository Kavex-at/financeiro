'use client'

import * as React from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

/** Estado de filtro (filial + busca) + paginação de uma aba. */
export interface TabelaFiltro<T> {
  filial: string
  busca: string
  setFilial: (v: string) => void
  setBusca: (v: string) => void
  pagina: number
  setPagina: React.Dispatch<React.SetStateAction<number>>
  filiais: number[]
  slice: T[]
  total: number
  totalPaginas: number
  paginaAtual: number
  pageSize: number
}

/**
 * Hook de filtro (filial + busca textual) + paginação para uma aba — espelha a
 * tabela principal. Trocar filtro volta à 1ª página (sem setState-in-effect).
 */
export function useTabelaFiltro<T>(
  items: T[],
  getFilCod: (x: T) => number | undefined,
  getBuscaTexto: (x: T) => string,
  pageSize = 20,
): TabelaFiltro<T> {
  const [filial, setFilialState] = React.useState('todas')
  const [busca, setBuscaState] = React.useState('')
  const [pagina, setPagina] = React.useState(1)
  const b = busca.trim().toLowerCase()

  // Memoizado porque a lista chega com até 500 linhas e o filtro rodava a CADA render — inclusive
  // nos que nada têm a ver com ele (abrir um popover, um spinner mudar de estado). Digitar na busca
  // disparava um varrimento completo por tecla, e é daí que vem a sensação de travamento.
  // As funções de acesso vêm inline do chamador (identidade nova a cada render), então ficam FORA
  // das deps de propósito: incluí-las anularia o memo. Elas são puras e derivam só de `items`.
  const filtrados = React.useMemo(
    () =>
      // `filCod` indefinido = item CORPORATIVO (crédito do fin095, ADR-0032): não pertence a nenhuma
      // filial e por isso passa em QUALQUER seleção, em vez de sumir quando o analista escolhe a dele.
      items.filter(
        (x) =>
          (filial === 'todas' ||
            getFilCod(x) === undefined ||
            String(getFilCod(x)) === filial) &&
          (b === '' || getBuscaTexto(x).toLowerCase().includes(b)),
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [items, filial, b],
  )
  const totalPaginas = Math.max(1, Math.ceil(filtrados.length / pageSize))
  const paginaAtual = Math.min(pagina, totalPaginas)
  const slice = React.useMemo(
    () => filtrados.slice((paginaAtual - 1) * pageSize, paginaAtual * pageSize),
    [filtrados, paginaAtual, pageSize],
  )
  // Corporativos não geram opção no dropdown — não há filial a oferecer.
  const filiais = React.useMemo(
    () =>
      [...new Set(items.map(getFilCod).filter((f): f is number => f !== undefined))].sort(
        (a, c) => a - c,
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [items],
  )
  const setFilial = (v: string) => {
    setFilialState(v)
    setPagina(1)
  }
  const setBusca = (v: string) => {
    setBuscaState(v)
    setPagina(1)
  }
  return {
    filial,
    busca,
    setFilial,
    setBusca,
    pagina,
    setPagina,
    filiais,
    slice,
    total: filtrados.length,
    totalPaginas,
    paginaAtual,
    pageSize,
  }
}

/** Barra de filtro de uma aba: filial + busca por exportador/processo. */
export function FiltroBarra<T>({
  aba,
  buscaPlaceholder,
}: {
  aba: TabelaFiltro<T>
  buscaPlaceholder: string
}) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
      <div className="flex flex-col gap-1">
        <span className="text-xs text-muted-foreground">Filial</span>
        <Select value={aba.filial} onValueChange={aba.setFilial}>
          <SelectTrigger className="w-44" aria-label="Filtrar por filial">
            <SelectValue placeholder="Todas as filiais" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todas">Todas as filiais</SelectItem>
            {aba.filiais.map((f) => (
              <SelectItem key={f} value={String(f)}>
                Filial {f}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex flex-1 flex-col gap-1">
        <span className="text-xs text-muted-foreground">Buscar</span>
        <Input
          value={aba.busca}
          onChange={(e) => aba.setBusca(e.target.value)}
          placeholder={buscaPlaceholder}
          aria-label={buscaPlaceholder}
        />
      </div>
    </div>
  )
}

/** Rodapé de paginação de uma aba (igual ao da tabela principal). */
export function Paginacao<T>({ aba }: { aba: TabelaFiltro<T> }) {
  if (aba.total === 0) return null
  return (
    <div className="flex flex-col gap-2 pt-3 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
      <span>
        Mostrando {(aba.paginaAtual - 1) * aba.pageSize + 1}–
        {Math.min(aba.paginaAtual * aba.pageSize, aba.total)} de {aba.total}
      </span>
      {aba.totalPaginas > 1 ? (
        <div className="flex items-center gap-2">
          <span>
            Página {aba.paginaAtual} de {aba.totalPaginas}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={aba.paginaAtual <= 1}
            onClick={() => aba.setPagina((p) => Math.max(1, p - 1))}
          >
            Anterior
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={aba.paginaAtual >= aba.totalPaginas}
            onClick={() => aba.setPagina((p) => Math.min(aba.totalPaginas, p + 1))}
          >
            Próxima
          </Button>
        </div>
      ) : null}
    </div>
  )
}
