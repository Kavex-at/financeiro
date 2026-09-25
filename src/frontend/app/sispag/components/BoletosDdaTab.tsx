'use client'

import * as React from 'react'
import { toast } from 'sonner'
import { AlertTriangle, Copy, DatabaseZap, RefreshCcw } from 'lucide-react'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { Spinner } from '@/components/ui/spinner'
import { formatBRL } from '@/lib/utils'
import {
  type BoletoDda,
  type BoletoDdaEscopo,
  type BoletoDdaSituacao,
  type BoletoDdaTitulo,
  type BoletosDdaResposta,
  type FiltroBoletosDda,
  fetchBoletosDda,
  SincronizacaoDdaEmAndamentoError,
  sincronizarBoletosDda,
} from '@/lib/sispag'
import {
  FiltroBarra,
  Paginacao,
  type TabelaFiltro,
} from '@/app/permutas/components/tabela-filtro'
import {
  CandidatosBoletoDialog,
  DiferencaBadge,
  fmtCivil,
  resumoCandidatos,
} from './CandidatosBoletoDialog'

type FiltroSituacao = 'todas' | BoletoDdaSituacao

const SITUACOES: { value: FiltroSituacao; label: string }[] = [
  { value: 'todas', label: 'Todas' },
  { value: 'VINCULADO', label: 'Vinculados' },
  { value: 'CANDIDATO', label: 'Candidatos' },
  { value: 'AMBIGUO', label: 'Ambíguos' },
  { value: 'SEM_TITULO', label: 'Sem título' },
]

const SITUACAO_BADGE: Record<BoletoDdaSituacao, { label: string; className: string; title: string }> =
  {
    VINCULADO: {
      label: 'vinculado',
      className: 'border-success/40 text-success',
      title: 'O Conexos já ligou este boleto a um título (associação do fin015).',
    },
    CANDIDATO: {
      label: 'candidato',
      className: 'border-info/40 text-info',
      title: 'Livre. Um título aberto tem o mesmo valor com vencimento próximo — confira.',
    },
    AMBIGUO: {
      label: 'ambíguo',
      className: 'border-warning/40 text-warning',
      title: 'Livre. Mais de um título aberto tem o mesmo valor (cobrança recorrente).',
    },
    SEM_TITULO: {
      label: 'sem título',
      className: 'border-muted text-muted-foreground',
      title: 'Livre, e nenhum título aberto tem o mesmo valor na janela de vencimento.',
    },
  }

/** Linhas por página. O backend pagina e filtra — o pool inteiro nunca vem ao navegador. */
const TAMANHO_PAGINA = 20
/** Espera antes de mandar a busca: sem isto, cada tecla vira uma requisição. */
const DEBOUNCE_BUSCA_MS = 300

function TituloLinha({ t, flpCod }: { t: BoletoDdaTitulo; flpCod?: number }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="max-w-[16rem] truncate font-medium">{t.credor ?? '—'}</span>
      <span className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
        <span>
          {t.docCod}/{t.titCod} · fil {t.filCod}
          {t.vencimento ? ` · vence ${fmtCivil(t.vencimento)}` : ''}
          {flpCod !== undefined ? ` · lote fin015 ${flpCod}` : ''}
        </span>
        <DiferencaBadge dias={t.diferencaDias} />
        {t.lote ? (
          <Badge variant="outline" className="border-muted text-muted-foreground">
            lote {t.lote.status.toLowerCase()}
          </Badge>
        ) : null}
      </span>
    </div>
  )
}

export function BoletosDdaTab() {
  const [escopo, setEscopo] = React.useState<BoletoDdaEscopo>('a-vencer')
  const [situacao, setSituacao] = React.useState<FiltroSituacao>('todas')
  const [filial, setFilial] = React.useState('todas')
  /** O que está no campo de busca. */
  const [busca, setBusca] = React.useState('')
  /** A busca que de fato vai ao servidor (depois do debounce). */
  const [buscaAplicada, setBuscaAplicada] = React.useState('')
  const [pagina, setPagina] = React.useState(1)
  const [sincronizando, setSincronizando] = React.useState(false)
  /** Incrementado para recarregar a lista (depois de sincronizar) sem mudar nenhum filtro. */
  const [recarga, setRecarga] = React.useState(0)
  /** Boleto ambíguo cujos candidatos estão abertos no modal. */
  const [candidatosDe, setCandidatosDe] = React.useState<BoletoDda | null>(null)
  /** Última resposta, com a chave da requisição que a produziu. */
  const [resultado, setResultado] = React.useState<{
    chave: string
    dados?: BoletosDdaResposta
    erro?: string
  } | null>(null)

  React.useEffect(() => {
    if (busca === buscaAplicada) return
    const t = setTimeout(() => {
      setBuscaAplicada(busca)
      setPagina(1)
    }, DEBOUNCE_BUSCA_MS)
    return () => clearTimeout(t)
  }, [busca, buscaAplicada])

  const filtro = React.useMemo<FiltroBoletosDda>(
    () => ({
      escopo,
      pagina,
      tamanho: TAMANHO_PAGINA,
      ...(situacao !== 'todas' ? { situacao } : {}),
      ...(buscaAplicada.trim() ? { busca: buscaAplicada.trim() } : {}),
      ...(filial !== 'todas' ? { filCod: Number(filial) } : {}),
    }),
    [escopo, pagina, situacao, buscaAplicada, filial],
  )
  const chave = `${JSON.stringify(filtro)}#${recarga}`

  // Estado só muda DEPOIS do fetch. Resposta de requisição já superada é descartada (`vivo`).
  React.useEffect(() => {
    let vivo = true
    fetchBoletosDda(filtro)
      .then((dados) => {
        if (vivo) setResultado({ chave, dados })
      })
      .catch((e: unknown) => {
        if (vivo) setResultado({ chave, erro: e instanceof Error ? e.message : String(e) })
      })
    return () => {
      vivo = false
    }
  }, [chave, filtro])

  /** Carregando = a última resposta é de outra requisição. A página anterior fica visível, esmaecida. */
  const carregando = resultado?.chave !== chave
  const erro = carregando ? undefined : resultado?.erro
  const dados = resultado?.dados
  const boletos = dados?.boletos ?? []
  const contagem = dados?.contagem

  const trocarEscopo = (e: BoletoDdaEscopo) => {
    setEscopo(e)
    setPagina(1)
  }
  const recarregar = () => setRecarga((n) => n + 1)

  // Mesmo formato que a `FiltroBarra` e a `Paginacao` das outras abas esperam — só que os dados
  // já chegam filtrados e paginados pelo servidor.
  const total = dados?.total ?? 0
  const aba: TabelaFiltro<BoletoDda> = {
    filial,
    busca,
    setFilial: (v) => {
      setFilial(v)
      setPagina(1)
    },
    setBusca,
    pagina,
    setPagina,
    filiais: dados?.filiais ?? [],
    slice: boletos,
    total,
    totalPaginas: Math.max(1, Math.ceil(total / TAMANHO_PAGINA)),
    paginaAtual: dados?.pagina ?? pagina,
    pageSize: dados?.tamanho ?? TAMANHO_PAGINA,
  }
  const filtrando = situacao !== 'todas' || filial !== 'todas' || buscaAplicada.trim() !== ''

  const sincronizar = async () => {
    setSincronizando(true)
    try {
      const r = await sincronizarBoletosDda()
      const partes = [`${r.arquivosNovos} arquivo(s) novo(s)`, `${r.arquivosRelidos} relido(s)`]
      if (r.falhas > 0) {
        toast.warning('DDA atualizado com falhas', {
          description: `${partes.join(', ')}; ${r.falhas} arquivo(s) não puderam ser lidos. Tente de novo.`,
        })
      } else {
        toast.success('DDA atualizado', { description: partes.join(', ') })
      }
      recarregar()
    } catch (e) {
      if (e instanceof SincronizacaoDdaEmAndamentoError) toast.info(e.message)
      else toast.error('Não foi possível atualizar o DDA', { description: String(e) })
    } finally {
      setSincronizando(false)
    }
  }

  const copiar = async (b: BoletoDda) => {
    if (!b.linhaDigitavel) return
    try {
      await navigator.clipboard.writeText(b.linhaDigitavel)
      toast.success('Linha digitável copiada', { description: `Boleto ${b.numero ?? b.ditCod}` })
    } catch {
      toast.error('Não foi possível copiar')
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <div className="flex gap-1" role="group" aria-label="Período">
            {(['a-vencer', 'todos'] as const).map((e) => (
              <Button
                key={e}
                size="sm"
                variant={escopo === e ? 'default' : 'outline'}
                onClick={() => trocarEscopo(e)}
                aria-pressed={escopo === e}
              >
                {e === 'a-vencer' ? 'A vencer' : 'Todos (inclui vencidos)'}
              </Button>
            ))}
          </div>
          <span className="text-xs text-muted-foreground">
            {dados?.sincronizadoEm
              ? `DDA de ${new Date(dados.sincronizadoEm).toLocaleString('pt-BR')}`
              : 'DDA ainda não sincronizado'}
            {dados ? ` · candidato = mesmo valor e vencimento em ±${dados.janelaDias} dias` : ''}
          </span>
        </div>
        <Button size="sm" variant="outline" onClick={sincronizar} disabled={sincronizando}>
          <RefreshCcw className={`size-4 ${sincronizando ? 'animate-spin' : ''}`} />{' '}
          {sincronizando ? 'Atualizando…' : 'Atualizar DDA'}
        </Button>
      </div>

      <div className="flex flex-wrap gap-1" role="group" aria-label="Situação">
        {SITUACOES.map((s) => (
          <Button
            key={s.value}
            size="sm"
            variant={situacao === s.value ? 'default' : 'outline'}
            onClick={() => {
              setSituacao(s.value)
              setPagina(1)
            }}
            aria-pressed={situacao === s.value}
          >
            {s.label} ({contagem ? contagem[s.value] : '—'})
          </Button>
        ))}
      </div>

      <FiltroBarra
        aba={aba}
        buscaPlaceholder="Buscar por número, valor, credor, documento, código de barras ou arquivo…"
      />

      {carregando && !dados ? (
        <div className="flex items-center justify-center gap-2 py-16 text-muted-foreground">
          <Spinner /> Carregando boletos…
        </div>
      ) : erro ? (
        <EmptyState
          icon={<AlertTriangle className="size-6" />}
          title="Não foi possível carregar os boletos"
          description={erro}
        />
      ) : total === 0 ? (
        <EmptyState
          icon={filtrando ? undefined : <DatabaseZap className="size-6" />}
          title={filtrando ? 'Nenhum boleto encontrado' : 'Nenhum boleto DDA'}
          description={
            !dados?.sincronizadoEm
              ? 'Clique em "Atualizar DDA" para trazer os boletos do fin124.'
              : filtrando
                ? 'Ajuste a situação, a filial ou a busca acima.'
                : 'Nenhum boleto neste período. Veja "Todos" para incluir os vencidos.'
          }
        />
      ) : (
        <div
          className={`overflow-x-auto rounded-lg border transition-opacity ${carregando ? 'opacity-60' : ''}`}
          aria-busy={carregando}
        >
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Situação</TableHead>
                <TableHead>Boleto</TableHead>
                <TableHead className="text-right">Valor</TableHead>
                <TableHead>Vencimento</TableHead>
                <TableHead>Banco</TableHead>
                <TableHead>Título</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {aba.slice.map((b) => {
                const badge = SITUACAO_BADGE[b.situacao]
                // Na linha vai no máximo UM título (o vínculo ou o candidato mais próximo); o
                // resto de um ambíguo abre no modal — senão a linha vira uma coluna de cartões.
                const principal = b.vinculo ?? b.candidatos[0]
                const extras = b.vinculo ? 0 : b.candidatos.length - 1
                return (
                  <TableRow key={`${b.ddcCod}:${b.ditCod}`}>
                    <TableCell>
                      <Badge variant="outline" className={badge.className} title={badge.title}>
                        {badge.label}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col gap-0.5">
                        <span className="font-medium tabular-nums">{b.numero ?? '—'}</span>
                        <span className="text-xs text-muted-foreground" title={b.arquivo}>
                          fin124 #{b.ddcCod}
                          {b.importadoEm
                            ? ` · ${new Date(b.importadoEm).toLocaleDateString('pt-BR')}`
                            : ''}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{formatBRL(b.valor)}</TableCell>
                    <TableCell>
                      <div className="flex flex-col gap-0.5">
                        <span className="text-xs text-muted-foreground">
                          {fmtCivil(b.vencimento)}
                        </span>
                        {b.vencido ? (
                          <Badge variant="outline" className="border-danger/40 text-danger">
                            vencido
                          </Badge>
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground tabular-nums">
                      {b.bancoEmissor ?? '—'}
                    </TableCell>
                    <TableCell>
                      {principal === undefined ? (
                        <span className="text-muted-foreground">—</span>
                      ) : (
                        <div className="flex flex-col items-start gap-1">
                          <TituloLinha t={principal} flpCod={b.vinculo?.flpCod} />
                          {extras > 0 ? (
                            <Button
                              size="sm"
                              variant="link"
                              className="h-auto p-0 text-xs"
                              onClick={() => setCandidatosDe(b)}
                              aria-label={`Ver os ${b.candidatos.length} títulos candidatos do boleto ${b.numero ?? b.ditCod}`}
                            >
                              {resumoCandidatos(b.candidatos)}
                            </Button>
                          ) : null}
                        </div>
                      )}
                    </TableCell>
                    <TableCell>
                      {b.linhaDigitavel ? (
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => copiar(b)}
                          aria-label={`Copiar linha digitável do boleto ${b.numero ?? b.ditCod}`}
                          title="Copiar linha digitável"
                        >
                          <Copy className="size-4" />
                        </Button>
                      ) : null}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      )}
      <Paginacao aba={aba} />
      <CandidatosBoletoDialog boleto={candidatosDe} onClose={() => setCandidatosDe(null)} />
    </div>
  )
}
