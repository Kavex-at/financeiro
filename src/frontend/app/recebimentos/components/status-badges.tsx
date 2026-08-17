'use client'

import * as React from 'react'
import {
  AlertTriangle,
  CheckCheck,
  CheckCircle2,
  Clock,
  Download,
  FileCheck,
  FileEdit,
  FileX,
  Landmark,
  PieChart,
  Undo2,
  UserSearch,
  type LucideIcon,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import type {
  MatchClassificacao,
  NdeStatusEmissao,
  RecebimentoStatus,
  TransacaoBancariaStatus,
} from '@/lib/recebimentos'

/**
 * Chips de domínio da Frente IV — wrappers FINOS sobre o `Badge` (atom agnóstico).
 * Domínio (mapa status → token/ícone/tooltip) vive AQUI (feature code), não no DS.
 * Regra de a11y (DS princípio 8): status NUNCA só por cor — sempre ícone + texto +
 * tooltip explicando o significado de negócio. Estilo outline `border-<token>/40
 * text-<token>` espelha o `VencimentoBadge` do SISPAG.
 */

interface ChipSpec {
  label: string
  icon: LucideIcon
  /** Classe de cor outline (border+text) do token; vazio = variant `secondary`/`outline`. */
  className: string
  tooltip: string
}

/** Núcleo compartilhado: badge outline com ícone + texto + tooltip acessível. */
function DomainChip({ spec }: { spec: ChipSpec }) {
  const Icon = spec.icon
  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge
            variant="outline"
            className={cn(spec.className)}
            // O texto já identifica o estado; o title dá o tooltip nativo como fallback.
            title={spec.tooltip}
          >
            <Icon aria-hidden />
            {spec.label}
          </Badge>
        </TooltipTrigger>
        <TooltipContent>{spec.tooltip}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

// ─────────────────────────────────────────────────────────── TransacaoBancaria status

const TRANSACAO_SPECS: Record<TransacaoBancariaStatus, ChipSpec> = {
  importada: {
    label: 'importada',
    icon: Download,
    className: 'border-info/40 text-info',
    tooltip: 'Importado, ainda não conciliado.',
  },
  // `conciliada` e `manual` não têm produtor até o Módulo 2 (motor de matching) e estão fora da
  // tela desde a ADR-0034. As chaves ficam porque o `Record` é exaustivo — e porque uma linha
  // antiga do banco ainda poderia trazê-las.
  conciliada: {
    label: 'conciliada',
    icon: CheckCircle2,
    className: 'border-success/40 text-success',
    tooltip: 'Casado com confiança (match único).',
  },
  parcial: {
    label: 'parcial',
    icon: PieChart,
    className: 'border-warning/40 text-warning',
    tooltip:
      'Parte do crédito já foi alocada e BAIXADA no ERP — resta saldo a alocar. Não é um palpite de match: é dinheiro que já se moveu.',
  },
  manual: {
    label: 'fila manual',
    icon: UserSearch,
    className: 'border-permuta/40 text-permuta',
    tooltip: 'Match incerto → fila de análise manual. O sistema nunca auto-baixa incerto.',
  },
  erro: {
    label: 'erro',
    icon: AlertTriangle,
    className: 'border-danger/40 text-danger',
    tooltip: 'A última execução de uma alocação deste crédito falhou — veja a aba Falhas.',
  },
  processada: {
    label: 'processada',
    icon: CheckCheck,
    className: 'border-success/40 text-success',
    tooltip:
      'Alocação executada até o fim — SN + baixa fin014, com nota de débito ou sem ela (só POR ENCOMENDA emite). Nada mais a fazer.',
  },
}

/** Modalidade do processo (ADR-0033) — REAL (do ledger) ou PREVISÃO (pelos processos do cliente). */
export function ModalidadeBadge({
  modalidade,
}: {
  modalidade?: {
    priVldTipo: number
    rotulo: string
    previsao: boolean
    ndeDispensada: boolean
  }
}) {
  if (!modalidade) return <span className="text-muted-foreground">—</span>
  const { rotulo, previsao, ndeDispensada } = modalidade
  return (
    <DomainChip
      spec={{
        // O `~` marca o palpite. A modalidade decide se sai uma nota fiscal irreversível, então a
        // tela nunca pode pintar previsão com a mesma cara de fato.
        label: previsao ? `~ ${rotulo}` : rotulo,
        icon: ndeDispensada ? FileX : FileCheck,
        className: previsao
          ? 'border-dashed border-muted-foreground/40 text-muted-foreground'
          : ndeDispensada
            ? 'border-muted text-muted-foreground'
            : 'border-info/40 text-info',
        tooltip: previsao
          ? `PREVISÃO pelos processos abertos deste cliente — ainda não alocado, então a modalidade real só sai ao processar. ${ndeDispensada ? 'Nessa modalidade a nota de débito NÃO é emitida.' : 'Nessa modalidade a nota de débito é emitida.'}`
          : ndeDispensada
            ? 'Modalidade da alocação executada. A nota de débito NÃO era devida — a quitação fechou com a SN e a baixa.'
            : 'Modalidade da alocação executada. A nota de débito foi emitida.',
      }}
    />
  )
}

export function TransacaoStatusBadge({ status }: { status: TransacaoBancariaStatus }) {
  return <DomainChip spec={TRANSACAO_SPECS[status]} />
}

// ─────────────────────────────────────────────────────────── Recebimento lifecycle

const RECEBIMENTO_SPECS: Record<RecebimentoStatus, ChipSpec> = {
  rascunho: {
    label: 'rascunho',
    icon: FileEdit,
    className: 'border-muted text-muted-foreground',
    tooltip: 'Em edição — aguarda aprovação do analista (ponto human-in-the-loop).',
  },
  aprovado: {
    label: 'aprovado',
    icon: CheckCircle2,
    className: 'border-info/40 text-info',
    tooltip: 'Aprovado pelo analista — pronto para executar (baixa + NDe).',
  },
  executado: {
    label: 'executado',
    icon: Landmark,
    className: 'border-success/40 text-success',
    tooltip: 'Baixa registrada no ERP e NDe emitida.',
  },
  estornado: {
    label: 'estornado',
    icon: Undo2,
    className: 'border-danger/40 text-danger',
    tooltip: 'Execução revertida — estado terminal.',
  },
}

export function RecebimentoStatusBadge({ status }: { status: RecebimentoStatus }) {
  return <DomainChip spec={RECEBIMENTO_SPECS[status]} />
}

// ─────────────────────────────────────────────────────────── Match classificação

const MATCH_SPECS: Record<MatchClassificacao, ChipSpec> = {
  unica: {
    label: 'única',
    icon: CheckCircle2,
    className: 'border-success/40 text-success',
    tooltip: 'Um único documento candidato — elegível a baixa automática (1:1).',
  },
  multiplas: {
    label: 'múltiplas',
    icon: PieChart,
    className: 'border-info/40 text-info',
    tooltip: 'Vários candidatos — precisa da escolha do analista.',
  },
  parcial: {
    label: 'parcial',
    icon: PieChart,
    className: 'border-warning/40 text-warning',
    tooltip: 'Casamento parcial — resta saldo não alocado.',
  },
  nenhuma: {
    label: 'nenhuma',
    icon: UserSearch,
    className: 'border-permuta/40 text-permuta',
    tooltip: 'Nenhum candidato — vai para a fila manual.',
  },
}

export function MatchClassificacaoBadge({ classificacao }: { classificacao?: MatchClassificacao }) {
  if (!classificacao) return <span className="text-muted-foreground">—</span>
  return <DomainChip spec={MATCH_SPECS[classificacao]} />
}

// ─────────────────────────────────────────────────────────── NDe emissão

const NDE_SPECS: Record<NdeStatusEmissao, ChipSpec> = {
  pendente: {
    label: 'pendente',
    icon: Clock,
    className: 'border-warning/40 text-warning',
    tooltip: 'Write-ahead — emissão ainda não confirmada pelo Conexos.',
  },
  emitida: {
    label: 'emitida',
    icon: CheckCircle2,
    className: 'border-success/40 text-success',
    tooltip: 'NDe emitida pelo Conexos (número atribuído).',
  },
  erro: {
    label: 'erro',
    icon: AlertTriangle,
    className: 'border-danger/40 text-danger',
    tooltip: 'Falha na emissão — reprocessável (idempotente).',
  },
}

export function NdeStatusBadge({ status }: { status: NdeStatusEmissao }) {
  return <DomainChip spec={NDE_SPECS[status]} />
}

/**
 * Autorização do SEFAZ — deliberadamente SEPARADA do status de emissão.
 *
 * Homologar e autorizar são dois eventos: a homologação é nossa (síncrona), a autorização é do SEFAZ
 * (assíncrona, de segundos a horas). Fundir os dois num chip só faria "aguardando SEFAZ" parecer
 * falha de emissão — e levaria o analista a reprocessar uma NDe que está perfeitamente emitida.
 */
export function SefazBadge({ autorizado }: { autorizado?: boolean }) {
  return (
    <DomainChip
      spec={
        autorizado === true
          ? {
              label: 'autorizada',
              icon: CheckCheck,
              className: 'border-success/40 text-success',
              tooltip: 'SEFAZ autorizou a NF-e (vldAutorizado ≠ 0).',
            }
          : {
              label: 'aguardando SEFAZ',
              icon: Clock,
              className: 'border-info/40 text-info',
              tooltip:
                'Emitida e homologada; a autorização do SEFAZ é assíncrona e ainda não voltou. Não é falha — o painel relê o Conexos a cada carga.',
            }
      }
    />
  )
}

/**
 * Marca a NDe que existe no ERP e NÃO passou pela ferramenta.
 *
 * Não é um alerta: é uma nota fiscal legítima, emitida à mão no Conexos. O chip existe porque essas
 * linhas não têm `correlationId`, etapa nem transação bancária — sem a marca, o analista veria
 * metade das colunas vazias e concluiria que a ferramenta perdeu o rastro de algo que ela emitiu.
 */
export function OrigemErpBadge() {
  return (
    <DomainChip
      spec={{
        label: 'fora da ferramenta',
        icon: Landmark,
        className: 'border-dashed border-muted-foreground/40 text-muted-foreground',
        tooltip:
          'Emitida direto no Conexos, sem passar pelo "Processar" — por isso não há correlationId nem etapa. O ERP é a fonte desta linha.',
      }}
    />
  )
}

/** Marca a NDe que homologou COM validações pendentes (com194) — emitida, mas precisa de olhos. */
export function RevisaoHumanaBadge() {
  return (
    <DomainChip
      spec={{
        label: 'revisão',
        icon: UserSearch,
        className: 'border-warning/40 text-warning',
        tooltip:
          'Homologou com validações pendentes no com194 — a NDe saiu, mas alguém precisa conferir.',
      }}
    />
  )
}

// ─────────────────────────────────────────────────────────── Aging (idade na fila)

/**
 * Chip de idade — verde < 2 dias, âmbar 2–5, vermelho > 5. Espelha o idiom do
 * `VencimentoBadge` do SISPAG. Entrada em dias (inteiro ≥ 0); `undefined` → travessão.
 */
export function AgingBadge({ dias }: { dias?: number }) {
  if (dias === undefined) return <span className="text-muted-foreground">—</span>
  const spec: ChipSpec =
    dias <= 2
      ? {
          label: `${dias}d na fila`,
          icon: Clock,
          className: 'border-success/40 text-success',
          tooltip: 'Recente na fila manual (até 2 dias).',
        }
      : dias <= 5
        ? {
            label: `${dias}d na fila`,
            icon: Clock,
            className: 'border-warning/40 text-warning',
            tooltip: 'Aguardando análise há 2–5 dias.',
          }
        : {
            label: `${dias}d na fila`,
            icon: AlertTriangle,
            className: 'border-danger/40 text-danger',
            tooltip: 'Parado há mais de 5 dias — priorize.',
          }
  return <DomainChip spec={spec} />
}
