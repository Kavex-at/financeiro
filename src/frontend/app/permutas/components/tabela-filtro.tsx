'use client'

import * as React from 'react'
import { Button } from '@/components/ui/button'
import { DatePicker } from '@/components/ui/date-picker'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

/** Chips de boleto: todos, só os que têm boleto, só os que não têm. */
export type FiltroBoleto = 'todos' | 'com' | 'sem'

/**
 * Filtros extras, opt-in por aba (Permutas não usa nenhum). Cada um só existe no estado da aba
 * quando o acessor correspondente é passado.
 */
export interface OpcoesFiltroExtra<T> {
  /**
   * Datas civis (`YYYY-MM-DD`) que o intervalo de/até considera. A linha passa se QUALQUER uma
   * cair no intervalo (um lote passa se algum item vence nele). Sem data, a linha sai quando há
   * intervalo ativo.
   */
  getDatas?: (x: T) => (string | undefined)[]
  /**
   * Boleto de cada item da linha (um título = um item). "com" passa se ALGUM tem boleto; "sem",
   * se ALGUM não tem — uma linha mista aparece nos dois, nunca some do filtro que a procura.
   */
  getBoleto?: (x: T) => boolean[]
}

/** Estado de filtro (filial + busca) + paginação de uma aba. */
export interface TabelaFiltro<T> {
  filial: string
  busca: string
  setFilial: (v: string) => void
  setBusca: (v: string) => void
  /** Zera filial, busca e os filtros extras (o "ir para o lote" precisa ver a lista inteira). */
  limparFiltros?: () => void
  // ── opt-in (presentes só quando a aba passa o acessor) ──
  dataDe?: string
  dataAte?: string
  setDataDe?: (v: string) => void
  setDataAte?: (v: string) => void
  boleto?: FiltroBoleto
  setBoleto?: (v: FiltroBoleto) => void
  /** Contagem por chip depois dos outros filtros e antes do de boleto. */
  contagemBoleto?: Record<FiltroBoleto, number>
  pagina: number
  setPagina: React.Dispatch<React.SetStateAction<number>>
  filiais: number[]
  slice: T[]
  /**
   * A lista inteira depois de TODOS os filtros (filial, busca, data, boleto), antes da paginação.
   * É o que um "selecionar todos os filtrados" deve usar — reimplementar o filtro fora daqui
   * esquece os filtros opt-in. Opcional porque abas paginadas no servidor não a têm.
   */
  filtrados?: T[]
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
  extras: OpcoesFiltroExtra<T> = {},
): TabelaFiltro<T> & { limparFiltros: () => void; filtrados: T[] } {
  const [filial, setFilialState] = React.useState('todas')
  const [busca, setBuscaState] = React.useState('')
  const [dataDe, setDataDeState] = React.useState('')
  const [dataAte, setDataAteState] = React.useState('')
  const [boleto, setBoletoState] = React.useState<FiltroBoleto>('todos')
  const [pagina, setPagina] = React.useState(1)
  const b = busca.trim().toLowerCase()
  const { getDatas, getBoleto } = extras
  const temIntervalo = getDatas !== undefined && (dataDe !== '' || dataAte !== '')

  // Memoizado porque a lista chega com até 500 linhas e o filtro rodava a CADA render — inclusive
  // nos que nada têm a ver com ele (abrir um popover, um spinner mudar de estado). Digitar na busca
  // disparava um varrimento completo por tecla, e é daí que vem a sensação de travamento.
  // As funções de acesso vêm inline do chamador (identidade nova a cada render), então ficam FORA
  // das deps de propósito: incluí-las anularia o memo. Elas são puras e derivam só de `items`.
  // Os acessores de `extras` ENTRAM nas deps — podem fechar sobre outro estado (os candidatos
  // leem o boleto da carteira) — e por isso o chamador os passa estáveis (módulo ou useMemo).
  // `semBoleto` = antes do filtro de boleto: é a base da contagem dos chips.
  const semBoleto = React.useMemo(
    () =>
      // `filCod` indefinido = item CORPORATIVO (crédito do fin095, ADR-0032): não pertence a nenhuma
      // filial e por isso passa em QUALQUER seleção, em vez de sumir quando o analista escolhe a dele.
      items.filter(
        (x) =>
          (filial === 'todas' ||
            getFilCod(x) === undefined ||
            String(getFilCod(x)) === filial) &&
          (b === '' || getBuscaTexto(x).toLowerCase().includes(b)) &&
          // Dia civil `YYYY-MM-DD` compara por ordem de string; intervalo inclusivo.
          (!temIntervalo ||
            (getDatas?.(x) ?? []).some(
              (d) =>
                d !== undefined &&
                (dataDe === '' || d >= dataDe) &&
                (dataAte === '' || d <= dataAte),
            )),
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [items, filial, b, temIntervalo, dataDe, dataAte, getDatas],
  )
  const contagemBoleto = React.useMemo(() => {
    if (!getBoleto) return undefined
    const c: Record<FiltroBoleto, number> = { todos: semBoleto.length, com: 0, sem: 0 }
    for (const x of semBoleto) {
      const flags = getBoleto(x)
      if (flags.some(Boolean)) c.com += 1
      if (flags.some((f) => !f)) c.sem += 1
    }
    return c
  }, [semBoleto, getBoleto])
  const filtrados = React.useMemo(
    () =>
      !getBoleto || boleto === 'todos'
        ? semBoleto
        : semBoleto.filter((x) =>
            boleto === 'com' ? getBoleto(x).some(Boolean) : getBoleto(x).some((f) => !f),
          ),
    [semBoleto, boleto, getBoleto],
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
  const limparFiltros = () => {
    setFilialState('todas')
    setBuscaState('')
    setDataDeState('')
    setDataAteState('')
    setBoletoState('todos')
    setPagina(1)
  }
  return {
    filial,
    busca,
    setFilial,
    setBusca,
    limparFiltros,
    ...(getDatas
      ? {
          dataDe,
          dataAte,
          setDataDe: (v: string) => {
            setDataDeState(v)
            setPagina(1)
          },
          setDataAte: (v: string) => {
            setDataAteState(v)
            setPagina(1)
          },
        }
      : {}),
    ...(getBoleto && contagemBoleto
      ? {
          boleto,
          contagemBoleto,
          setBoleto: (v: FiltroBoleto) => {
            setBoletoState(v)
            setPagina(1)
          },
        }
      : {}),
    pagina,
    setPagina,
    filiais,
    slice,
    filtrados,
    total: filtrados.length,
    totalPaginas,
    paginaAtual,
    pageSize,
  }
}

const ROTULO_BOLETO: Record<FiltroBoleto, string> = {
  todos: 'Todos',
  com: 'Boleto',
  sem: 'Sem boleto',
}

/**
 * Barra de filtro de uma aba: filial + busca, e — opt-in — intervalo de datas e chips de boleto.
 * `rotuloData` diz QUAL data o de/até filtra ("Vencimento", "Remessa gerada"…): a mesma barra
 * filtra campos diferentes em cada aba, e o rótulo é o que impede a analista de adivinhar.
 */
export function FiltroBarra<T>({
  aba,
  buscaPlaceholder,
  rotuloData,
  filtroBoleto = false,
  tituloBoleto,
}: {
  aba: TabelaFiltro<T>
  buscaPlaceholder: string
  /** Liga o de/até (a aba precisa ter passado `getDatas` ou cuidar das datas por conta própria). */
  rotuloData?: string
  /** Liga os chips Todos / Boleto / Sem boleto (a aba precisa ter passado `getBoleto`). */
  filtroBoleto?: boolean
  /** Dica (title) dos chips — p.ex. como um lote misto é tratado. */
  tituloBoleto?: string
}) {
  const { dataDe = '', dataAte = '', setDataDe, setDataAte, setBoleto, contagemBoleto } = aba
  const mostrarDatas = rotuloData !== undefined && setDataDe && setDataAte
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
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
      {mostrarDatas ? (
        <fieldset className="m-0 min-w-0 border-0 p-0">
          <legend className="mb-1 text-xs text-muted-foreground">{rotuloData} de/até</legend>
          {/* No celular os dois campos dividem a largura e o "Limpar" desce de linha: dois
              campos fixos de 144px + botão estouravam os 343px úteis de uma tela de 375px. */}
          <div className="flex flex-wrap items-center gap-1">
            <DatePicker
              className="w-full min-w-0 flex-1 sm:w-36 sm:flex-none"
              aria-label={`${rotuloData} de`}
              value={dataDe}
              {...(dataAte ? { max: dataAte } : {})}
              onChange={setDataDe}
            />
            <span className="text-muted-foreground" aria-hidden>
              –
            </span>
            <DatePicker
              className="w-full min-w-0 flex-1 sm:w-36 sm:flex-none"
              aria-label={`${rotuloData} até`}
              value={dataAte}
              {...(dataDe ? { min: dataDe } : {})}
              onChange={setDataAte}
            />
            {dataDe || dataAte ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  setDataDe('')
                  setDataAte('')
                }}
                aria-label={`Limpar ${rotuloData.toLowerCase()} de/até`}
              >
                Limpar
              </Button>
            ) : null}
          </div>
        </fieldset>
      ) : null}
      {filtroBoleto && setBoleto && contagemBoleto ? (
        <fieldset className="m-0 min-w-0 border-0 p-0">
          <legend className="mb-1 text-xs text-muted-foreground">Boleto</legend>
          <div className="flex flex-wrap gap-1">
            {(['todos', 'com', 'sem'] as const).map((f) => (
              <Button
                key={f}
                type="button"
                size="sm"
                variant={aba.boleto === f ? 'default' : 'outline'}
                aria-pressed={aba.boleto === f}
                onClick={() => setBoleto(f)}
              >
                {ROTULO_BOLETO[f]} ({contagemBoleto[f]})
              </Button>
            ))}
          </div>
          {/* Texto visível, não `title`: hover não existe no toque nem no teclado. */}
          {tituloBoleto ? (
            <p className="mt-1 max-w-xs text-xs text-muted-foreground">{tituloBoleto}</p>
          ) : null}
        </fieldset>
      ) : null}
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
