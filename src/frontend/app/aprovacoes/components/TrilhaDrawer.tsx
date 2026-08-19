'use client'

import * as React from 'react'
import { format } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import {
  AlertTriangle,
  CheckCircle2,
  CircleSlash,
  Flag,
  HelpCircle,
  Hourglass,
  RefreshCcw,
  XCircle,
  type LucideIcon,
} from 'lucide-react'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { Skeleton } from '@/components/ui/skeleton'
import { cn, formatBRL, formatDate, formatNumber } from '@/lib/utils'
import {
  descreverLacuna,
  fetchTrilha,
  formatDuracaoSegundos,
  type AprovacaoListItem,
  type EtapaStatus,
  type EtapaTrilha,
  type TrilhaResponse,
} from '@/lib/aprovacoes'
import { ParadaHaBadge, StatusWorkflowBadge } from './status-badges'
import { SnapshotFaixa, parseDataIso } from './snapshot-faixa'

/**
 * Drawer da TRILHA de aprovação de um título (Frente V, tarefa T3.1).
 *
 * Linha do tempo vertical e cronológica: uma entrada por etapa, na ordem que o backend devolveu.
 * Somente leitura — a tela não aprova, não libera e não escreve nada no ERP.
 *
 * Quatro decisões de produto estão codificadas aqui, e cada uma existe porque a alternativa
 * mente para o analista:
 *
 * 1. **Duração só aparece onde existe.** `duracaoSegundos` ausente não significa "levou zero":
 *    significa que o dado não permite afirmar quanto levou (etapa ainda pendente, ou carimbos de
 *    tempo inconsistentes). Renderizar `0` ou um `—` seco no lugar de uma duração faria a etapa
 *    parecer instantânea — exatamente a leitura errada.
 * 2. **"Parada há" nunca vira "durou".** A primeira é espera EM CURSO (o relógio anda a cada
 *    leitura); a segunda é intervalo FECHADO. Só etapa `PENDENTE` tem a primeira, e os rótulos
 *    são diferentes de propósito.
 * 3. **`INDETERMINADO` é estado de primeira classe** (PV-01): destaque próprio e o `statusErp`
 *    CRU ao lado. O código bruto é o que permite a analista reportar ao time da Columbia qual
 *    valor apareceu — é ele que fecha a pendência.
 * 4. **O marco zero é a primeira etapa, não a finalização do documento** (PV-04). O ERP não expõe
 *    `docDtaFinalizacao` na projeção acessível hoje, então o relógio começa onde ele começa — e a
 *    timeline diz isso em voz alta, porque o exemplo que o cliente usou para definir o aceite
 *    partia justamente da finalização.
 */

interface TrilhaDrawerProps {
  /** Chave natural `${filCod}:${docCod}:${titCod}`; `null` quando nenhuma linha está selecionada. */
  id: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

/** Data + hora em pt-BR; `null` quando ausente ou inválida (quem chama decide o texto). */
const formatDataHora = (iso?: string): string | null => {
  const data = parseDataIso(iso)
  return data === null ? null : format(data, "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })
}

/** Valor monetário sem truncar (taste-profile); moeda diferente de BRL vem prefixada. */
const fmtValor = (valor?: number, moeda?: string): string => {
  if (valor === undefined) return '—'
  if (moeda === undefined || moeda === 'BRL') return formatBRL(valor)
  return `${moeda} ${formatNumber(valor)}`
}

// ─────────────────────────────────────────────────────────── Aparência por status de etapa

interface EtapaVisual {
  rotulo: string
  icone: LucideIcon
  /** Cor da marca (bolinha) na linha do tempo. */
  marca: string
  /** Destaque do cartão inteiro — só `INDETERMINADO` usa, e usa de propósito. */
  cartao: string
}

const ETAPA_VISUAL: Record<EtapaStatus, EtapaVisual> = {
  CONCLUIDA: {
    rotulo: 'concluída',
    icone: CheckCircle2,
    marca: 'border-success/40 text-success',
    cartao: 'border-border',
  },
  PENDENTE: {
    rotulo: 'pendente',
    icone: Hourglass,
    marca: 'border-warning/40 text-warning',
    cartao: 'border-warning/40',
  },
  REJEITADA: {
    rotulo: 'rejeitada',
    icone: XCircle,
    marca: 'border-danger/40 text-danger',
    cartao: 'border-danger/40',
  },
  INDETERMINADO: {
    rotulo: 'indeterminado',
    icone: HelpCircle,
    marca: 'border-permuta bg-permuta-subtle text-permuta-foreground',
    cartao: 'border-permuta bg-permuta-subtle',
  },
}

// ─────────────────────────────────────────────────────────── Blocos da entrada da timeline

/**
 * Tempo consumido pela etapa — o ponto onde este drawer mais se recusa a arredondar a verdade.
 *
 * Três desfechos possíveis, com rótulos deliberadamente distintos:
 * - pendente → **"parada há"** (espera em curso, relógio andando);
 * - concluída com `duracaoSegundos` → **"durou"** (intervalo fechado);
 * - sem duração apurável → uma frase que diz que é DESCONHECIDO, nunca um `0` nem um traço.
 */
function TempoDaEtapa({ etapa }: { etapa: EtapaTrilha }) {
  if (etapa.status === 'PENDENTE') {
    return (
      <p className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-xs uppercase tracking-wide text-muted-foreground">
          Espera em curso
        </span>
        {etapa.paradaHaSegundos === undefined ? (
          <span className="text-muted-foreground">
            aguardando ação; o ERP não informou desde quando
          </span>
        ) : (
          <ParadaHaBadge segundos={etapa.paradaHaSegundos} />
        )}
      </p>
    )
  }
  if (etapa.duracaoSegundos === undefined) {
    return (
      <p className="flex items-start gap-2 text-sm text-warning">
        <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
        <span>
          Duração não apurada — os carimbos de tempo desta etapa não permitem afirmar quanto ela
          levou. Não é zero: é desconhecido.
        </span>
      </p>
    )
  }
  return (
    <p className="flex flex-wrap items-baseline gap-2 text-sm">
      <span className="text-xs uppercase tracking-wide text-muted-foreground">Durou</span>
      <span className="font-medium tabular-nums">
        {formatDuracaoSegundos(etapa.duracaoSegundos)}
      </span>
      <span className="text-xs text-muted-foreground">
        (intervalo fechado, de receber até agir)
      </span>
    </p>
  )
}

/** Par rótulo/valor da grade de carimbos de tempo da etapa. */
function CampoEtapa({ rotulo, valor }: { rotulo: string; valor: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">{rotulo}</dt>
      <dd className="text-sm">{valor}</dd>
    </div>
  )
}

/**
 * Uma etapa da trilha.
 *
 * `ordem` é a posição cronológica (1ª, 2ª…): a numeração deixa explícito que a lista é uma
 * sequência no tempo, não um conjunto sem ordem.
 */
function EtapaItem({ etapa, ordem }: { etapa: EtapaTrilha; ordem: number }) {
  const visual = ETAPA_VISUAL[etapa.status]
  const Icone = visual.icone
  const pendente = etapa.status === 'PENDENTE'
  const titulo = etapa.nome ?? etapa.alcada ?? `Etapa ${etapa.fblCod}.${etapa.ftbCod}`
  const recebidoEm = formatDataHora(etapa.recebidoEm)
  const agidoEm = formatDataHora(etapa.agidoEm)

  return (
    <li className="relative mb-4 ml-6 last:mb-0">
      <span
        className={cn(
          'absolute -left-[2.15rem] top-3 flex size-6 items-center justify-center rounded-full border bg-card',
          visual.marca,
        )}
        aria-hidden
      >
        <Icone className="size-3.5" />
      </span>

      <article className={cn('space-y-2 rounded-lg border p-3', visual.cartao)}>
        <header className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground">{ordem}ª etapa</span>
          <h4 className="text-sm font-semibold">{titulo}</h4>
          {etapa.alcada !== undefined && etapa.alcada !== '' ? (
            <Badge variant="outline" title="Alçada configurada no ERP para esta etapa.">
              alçada {etapa.alcada}
            </Badge>
          ) : null}
          {etapa.acao !== undefined && etapa.acao !== '' ? (
            <Badge
              variant="outline"
              className="border-info/40 text-info"
              title="Ação registrada no ERP. LIBERAR e APROVAR são ações distintas; hoje as duas contam como conclusão positiva (pendência PV-02)."
            >
              {etapa.acao}
            </Badge>
          ) : null}
          <Badge variant="outline" className={cn('ml-auto', visual.marca)}>
            <Icone aria-hidden />
            {visual.rotulo}
          </Badge>
        </header>

        {/*
          PV-01 — o código bruto do ERP fica VISÍVEL, não escondido num tooltip. É ele que a
          analista repassa ao time da Columbia; sem o número, a pendência não fecha.
        */}
        {etapa.status === 'INDETERMINADO' ? (
          <p className="flex items-start gap-2 text-sm text-permuta-foreground">
            <HelpCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span>
              {etapa.statusErp === undefined
                ? 'status não informado pelo ERP, ainda não mapeado — PV-01.'
                : `status ${etapa.statusErp} do ERP, ainda não mapeado — PV-01.`}{' '}
              Não é aprovado nem rejeitado. Informe este código ao time da Columbia: é ele que
              fecha a pendência.
            </span>
          </p>
        ) : null}

        <dl className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <CampoEtapa
            rotulo={pendente ? 'Aguardando' : 'Quem agiu'}
            valor={
              etapa.responsavelNome === undefined || etapa.responsavelNome === '' ? (
                <span className="text-muted-foreground">responsável não registrado no ERP</span>
              ) : (
                <span className="font-medium">{etapa.responsavelNome}</span>
              )
            }
          />
          <CampoEtapa
            rotulo="Recebeu em"
            valor={
              recebidoEm === null ? (
                <span className="text-muted-foreground">não informado pelo ERP</span>
              ) : (
                recebidoEm
              )
            }
          />
          <CampoEtapa
            rotulo="Agiu em"
            valor={
              agidoEm === null ? (
                <span className="text-muted-foreground">
                  {pendente ? 'ainda não agiu' : 'não informado pelo ERP'}
                </span>
              ) : (
                agidoEm
              )
            }
          />
        </dl>

        <TempoDaEtapa etapa={etapa} />

        {etapa.observacao !== undefined && etapa.observacao !== '' ? (
          <p className="text-sm text-muted-foreground">
            <span className="font-medium">Observação: </span>
            {etapa.observacao}
          </p>
        ) : null}
      </article>
    </li>
  )
}

/**
 * Marco zero da linha do tempo — PV-04.
 *
 * O exemplo que o cliente usou para definir o aceite começa em *"o documento foi finalizado às
 * 10:00"*. Esse campo (`docDtaFinalizacao`) não vem na projeção do ERP acessível hoje, então o
 * relógio deste painel começa na PRIMEIRA ETAPA. Isso não pode ficar implícito: sem o aviso, o
 * usuário lê o tempo total como se cobrisse desde a finalização do documento — e ele não cobre.
 */
function MarcoZero({
  cabecalho,
  primeiraEtapaEm,
}: {
  cabecalho: AprovacaoListItem
  primeiraEtapaEm: string | null
}) {
  const finalizacao = formatDataHora(cabecalho.dataFinalizacao)
  if (finalizacao !== null) {
    return (
      <li className="relative mb-4 ml-6">
        <span
          className="absolute -left-[2.15rem] top-3 flex size-6 items-center justify-center rounded-full border border-info/40 bg-card text-info"
          aria-hidden
        >
          <Flag className="size-3.5" />
        </span>
        <div className="rounded-lg border border-info/40 bg-info/5 p-3 text-sm">
          <span className="font-medium">Documento finalizado em {finalizacao}.</span> É daqui que o
          workflow de aprovação parte.
        </div>
      </li>
    )
  }
  return (
    <li className="relative mb-4 ml-6">
      <span
        className="absolute -left-[2.15rem] top-3 flex size-6 items-center justify-center rounded-full border border-warning/40 bg-card text-warning"
        aria-hidden
      >
        <Flag className="size-3.5" />
      </span>
      <div className="rounded-lg border border-warning/40 bg-warning/5 p-3 text-sm">
        <span className="font-medium">O relógio começa na primeira etapa</span>
        {primeiraEtapaEm === null ? '' : ` (${primeiraEtapaEm})`}
        <span>
          , e não na finalização do documento. O Conexos não expõe a data de finalização na
          projeção acessível hoje (PV-04), então o intervalo entre finalizar o documento e o
          workflow começar NÃO está contado abaixo.
        </span>
      </div>
    </li>
  )
}

/**
 * O que esta trilha não nos diz.
 *
 * Fica em texto corrido na tela, não escondido atrás de tooltip: num painel financeiro auditável,
 * o que falta é tão informativo quanto o que está lá. Um código novo que o frontend ainda não
 * conhece aparece cru (é o que `descreverLacuna` faz) em vez de sumir.
 */
function LacunasBloco({ lacunas }: { lacunas: string[] }) {
  if (lacunas.length === 0) return null
  return (
    <section
      aria-labelledby="trilha-lacunas-titulo"
      className="rounded-lg border border-warning/40 bg-warning/5 p-3"
    >
      <h3 id="trilha-lacunas-titulo" className="flex items-center gap-2 text-sm font-medium">
        <AlertTriangle className="size-4 shrink-0 text-warning" aria-hidden />
        O que esta trilha não nos diz
      </h3>
      <ul className="mt-2 list-disc space-y-1 pl-6 text-sm text-muted-foreground">
        {lacunas.map((codigo) => (
          <li key={codigo}>{descreverLacuna(codigo)}</li>
        ))}
      </ul>
    </section>
  )
}

/** Cabeçalho do título: identificação, valor e situação agregada do workflow. */
function CabecalhoTitulo({ cabecalho }: { cabecalho: AprovacaoListItem }) {
  return (
    <section className="space-y-2 rounded-lg border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <StatusWorkflowBadge status={cabecalho.statusWorkflow} />
        <span className="text-sm text-muted-foreground">
          {cabecalho.etapasConcluidas} de {cabecalho.etapasTotais} etapas concluídas
        </span>
        {cabecalho.tempoTotalSegundos === undefined ? null : (
          <span className="text-sm text-muted-foreground">
            · tempo total desde a primeira etapa:{' '}
            <span className="tabular-nums">
              {formatDuracaoSegundos(cabecalho.tempoTotalSegundos)}
            </span>
          </span>
        )}
      </div>
      <dl className="grid grid-cols-1 gap-2 sm:grid-cols-4">
        <CampoEtapa rotulo="Fornecedor" valor={cabecalho.fornecedorNome ?? '—'} />
        <CampoEtapa
          rotulo="Valor"
          valor={
            <span className="tabular-nums">{fmtValor(cabecalho.valor, cabecalho.moeda)}</span>
          }
        />
        {/*
          "Emissão", nunca "Finalização" — mesmo motivo do grid (PV-04). São datas diferentes e o
          rótulo tem de dizer qual delas está ali.
        */}
        <CampoEtapa
          rotulo="Emissão"
          valor={cabecalho.dataEmissao ? formatDate(cabecalho.dataEmissao) : '—'}
        />
        <CampoEtapa
          rotulo="Vencimento"
          valor={cabecalho.dataVencimento ? formatDate(cabecalho.dataVencimento) : '—'}
        />
      </dl>
    </section>
  )
}

function TrilhaSkeleton() {
  return (
    <div
      className="space-y-4"
      role="status"
      aria-busy="true"
      aria-label="Carregando a trilha de aprovação"
    >
      <Skeleton className="h-16 w-full" />
      <Skeleton className="h-24 w-full" />
      {Array.from({ length: 3 }).map((_, i) => (
        <Skeleton key={i} className="h-28 w-full" />
      ))}
    </div>
  )
}

// ─────────────────────────────────────────────────────────── Drawer

export function TrilhaDrawer({ id, open, onOpenChange }: TrilhaDrawerProps) {
  const [trilha, setTrilha] = React.useState<TrilhaResponse | null>(null)
  const [loading, setLoading] = React.useState(false)
  const [erro, setErro] = React.useState<string | null>(null)

  const carregar = React.useCallback(async () => {
    if (id === null) return
    setLoading(true)
    setErro(null)
    // Zera antes de buscar: manter na tela a trilha do título ANTERIOR enquanto a nova carrega
    // faria o analista ler etapas de um documento como se fossem de outro.
    setTrilha(null)
    try {
      setTrilha(await fetchTrilha(id))
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Falha ao carregar a trilha de aprovação.')
    } finally {
      setLoading(false)
    }
  }, [id])

  React.useEffect(() => {
    if (!open) return
    void carregar()
  }, [open, carregar])

  const cabecalho = trilha?.cabecalho
  const etapas = trilha?.etapas ?? []
  // Lacunas do título e da trilha são a mesma classe de informação; o `Set` só evita repetir a
  // mesma frase duas vezes se o backend mandar o código nos dois lugares.
  const lacunas = React.useMemo(
    () => [...new Set([...(trilha?.lacunas ?? []), ...(cabecalho?.lacunas ?? [])])],
    [trilha, cabecalho],
  )
  const primeiraEtapaEm = formatDataHora(etapas[0]?.recebidoEm)

  const documento = cabecalho?.documentoNumero ?? id ?? ''

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="xl" aria-describedby="trilha-descricao">
        <DialogHeader>
          <DialogTitle>Trilha de aprovação — documento {documento}</DialogTitle>
          <DialogDescription id="trilha-descricao">
            Percurso de bloqueio/liberação deste título no Conexos, em ordem cronológica. Somente
            leitura: nada aqui aprova, libera ou altera o ERP.
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="space-y-4">
          {loading ? (
            <TrilhaSkeleton />
          ) : erro !== null ? (
            <EmptyState
              icon={<AlertTriangle className="size-6" aria-hidden />}
              title="Não foi possível carregar a trilha"
              description={erro}
              action={
                <Button size="sm" variant="outline" onClick={() => void carregar()}>
                  <RefreshCcw className="size-4" aria-hidden /> Tentar de novo
                </Button>
              }
            />
          ) : trilha === null || cabecalho === undefined ? null : (
            <>
              {/* I7 — a idade do dado acompanha o detalhe; abrir o drawer não pode escondê-la. */}
              <SnapshotFaixa snapshotEm={trilha.snapshotEm} />
              <CabecalhoTitulo cabecalho={cabecalho} />
              <LacunasBloco lacunas={lacunas} />

              {etapas.length === 0 ? (
                <EmptyState
                  icon={<CircleSlash className="size-6" aria-hidden />}
                  title="Sem etapas de aprovação registradas"
                  description="Este título não passou por bloqueio/liberação no ERP. Não é erro nem falha de ingestão: cerca de metade dos títulos a pagar segue por fora do fluxo de workflow."
                />
              ) : (
                <ol
                  className="relative ml-3 border-l border-border"
                  aria-label="Linha do tempo das etapas de aprovação, em ordem cronológica"
                >
                  <MarcoZero cabecalho={cabecalho} primeiraEtapaEm={primeiraEtapaEm} />
                  {etapas.map((etapa, i) => (
                    <EtapaItem
                      key={`${etapa.fblCod}:${etapa.ftbCod}`}
                      etapa={etapa}
                      ordem={i + 1}
                    />
                  ))}
                </ol>
              )}
            </>
          )}
        </DialogBody>
      </DialogContent>
    </Dialog>
  )
}
