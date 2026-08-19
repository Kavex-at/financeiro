'use client'

import * as React from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  CircleSlash,
  Clock,
  HelpCircle,
  Hourglass,
  XCircle,
  type LucideIcon,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { descreverLacuna, formatDuracaoSegundos, type StatusWorkflow } from '@/lib/aprovacoes'

/**
 * Chips de domínio da Frente V — wrappers FINOS sobre o `Badge` (atom agnóstico).
 * O mapa status → token/ícone/tooltip vive AQUI (feature code), não no design system.
 * Regra de a11y (DS princípio 8): status NUNCA só por cor — sempre ícone + texto + tooltip
 * explicando o significado de negócio. Mesmo idiom do `status-badges.tsx` da Frente IV.
 */

interface ChipSpec {
  label: string
  icon: LucideIcon
  /** Classe de cor outline (border+text) do token. */
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
            // O texto já identifica o estado; o `title` dá o tooltip nativo como fallback.
            title={spec.tooltip}
          >
            <Icon aria-hidden />
            {spec.label}
          </Badge>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs">{spec.tooltip}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

// ─────────────────────────────────────────────────────────── Status do workflow

const STATUS_SPECS: Record<StatusWorkflow, ChipSpec> = {
  /**
   * NÃO é erro nem falha de ingestão: ~metade dos títulos a pagar simplesmente não passa por
   * bloqueio/liberação no ERP. Esconder essas linhas apagaria o diagnóstico mais útil da tela
   * (quanto do fluxo sequer é governado por workflow), então elas aparecem, marcadas, em cinza.
   */
  SEM_WORKFLOW: {
    label: 'sem workflow',
    icon: CircleSlash,
    className: 'border-muted-foreground/30 text-muted-foreground',
    tooltip:
      'Este título não tem nenhuma etapa de aprovação registrada no ERP. Não é erro: cerca de metade dos títulos a pagar segue por fora do fluxo de bloqueio/liberação. É informação de diagnóstico.',
  },
  AGUARDANDO: {
    label: 'aguardando',
    icon: Hourglass,
    className: 'border-warning/40 text-warning',
    tooltip:
      'Há pelo menos uma etapa pendente — alguém precisa agir. O relógio da coluna "Parada há" está correndo.',
  },
  APROVADO: {
    label: 'aprovado',
    icon: CheckCircle2,
    className: 'border-success/40 text-success',
    tooltip:
      'Todas as etapas foram concluídas positivamente (LIBERAR ou APROVAR — as duas contam como conclusão por ora, pendência PV-02).',
  },
  REJEITADO: {
    label: 'rejeitado',
    icon: XCircle,
    className: 'border-danger/40 text-danger',
    tooltip: 'Alguma etapa foi rejeitada — o título não segue para pagamento por este fluxo.',
  },
  /**
   * Estado de PRIMEIRA CLASSE, com destaque visual próprio (fundo + borda sólida, não só texto).
   *
   * Existe de verdade: 13 etapas em produção têm `ftbVldStatus = 7`, valor sem legenda no spec do
   * Conexos (pendência PV-01). Classificá-las como "aprovado" por chute produziria um tempo médio
   * errado num painel auditável; escondê-las seria pior ainda. Aparecer em destaque é o
   * comportamento correto — é um convite a fechar a pendência, não uma falha da tela.
   */
  INDETERMINADO: {
    label: 'indeterminado',
    icon: HelpCircle,
    className: 'border-permuta bg-permuta-subtle font-semibold text-permuta-foreground',
    tooltip:
      'O ERP devolveu um status de etapa que não sabemos ler (pendência PV-01). NÃO é aprovado nem rejeitado — e não vira palpite: o valor bruto fica preservado até a legenda ser confirmada com o time da Columbia.',
  },
}

export function StatusWorkflowBadge({ status }: { status: StatusWorkflow }) {
  return <DomainChip spec={STATUS_SPECS[status]} />
}

// ─────────────────────────────────────────────────────────── Espera em curso ("parada há")

/**
 * Chip de espera EM CURSO de uma etapa pendente.
 *
 * O rótulo diz **"parada há"**, no presente, de propósito: isto é um relógio andando, não a
 * duração fechada de uma etapa concluída ("durou X"). Somar os dois, ou lê-los como a mesma
 * coisa, é o erro de leitura mais caro deste painel — um título parado há 40 dias e um que
 * levou 40 dias e terminou não são o mesmo fato.
 *
 * Faixas: até 2 dias verde, 2–5 âmbar, acima de 5 vermelho — mesmo idiom do `AgingBadge`
 * da Frente IV.
 */
export function ParadaHaBadge({ segundos }: { segundos?: number }) {
  if (segundos === undefined) return <span className="text-muted-foreground">—</span>
  const dias = segundos / 86_400
  const tempo = formatDuracaoSegundos(segundos)
  const base = `Espera EM CURSO: a etapa está parada há ${tempo}, aguardando ação. Não confunda com "durou" — a duração fechada só existe depois que alguém age.`
  const spec: ChipSpec =
    dias <= 2
      ? {
          label: `parada há ${tempo}`,
          icon: Clock,
          className: 'border-success/40 text-success',
          tooltip: `${base} Dentro do normal (até 2 dias).`,
        }
      : dias <= 5
        ? {
            label: `parada há ${tempo}`,
            icon: Clock,
            className: 'border-warning/40 text-warning',
            tooltip: `${base} Entre 2 e 5 dias.`,
          }
        : {
            label: `parada há ${tempo}`,
            icon: AlertTriangle,
            className: 'border-danger/40 text-danger',
            tooltip: `${base} Mais de 5 dias — priorize.`,
          }
  return <DomainChip spec={spec} />
}

// ─────────────────────────────────────────────────────────── Lacunas

/**
 * Marca o que ESTE título não nos diz.
 *
 * Um painel financeiro auditável não pode omitir o que não sabe. O backend manda CÓDIGOS
 * (`SEM_DATA_FINALIZACAO`, …); aqui eles viram a frase do analista via `descreverLacuna`, num
 * ícone + tooltip com a lista. Sem lacuna, nada é renderizado — o silêncio aqui significa
 * "nada a declarar", e por isso precisa ser confiável.
 */
export function LacunasIndicador({ lacunas }: { lacunas: string[] }) {
  if (lacunas.length === 0) {
    return (
      <span className="text-muted-foreground" aria-label="Sem lacunas conhecidas">
        —
      </span>
    )
  }
  const descricoes = lacunas.map((codigo) => ({ codigo, texto: descreverLacuna(codigo) }))
  const resumo = `${lacunas.length} ${lacunas.length === 1 ? 'lacuna' : 'lacunas'} neste título`
  const plano = descricoes.map((d) => d.texto).join(' ')
  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge
            variant="outline"
            className="border-warning/40 text-warning"
            title={`${resumo}: ${plano}`}
            aria-label={`${resumo}: ${plano}`}
          >
            <AlertTriangle aria-hidden />
            {lacunas.length}
          </Badge>
        </TooltipTrigger>
        <TooltipContent className="max-w-sm">
          <p className="font-medium">{resumo}</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-4">
            {descricoes.map((d) => (
              <li key={d.codigo}>{d.texto}</li>
            ))}
          </ul>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

// ─────────────────────────────────────────────────────────── Etapas abertas em paralelo

/**
 * Sinaliza que a etapa mostrada NÃO é a única aberta.
 *
 * `etapaAtual` é a etapa pendente mais antiga. Quando há outras em paralelo, exibir só ela em
 * silêncio faria o analista subestimar a fila — daí o `+N` ao lado do nome da etapa.
 */
export function EtapasAbertasBadge({ abertas }: { abertas?: number }) {
  if (abertas === undefined || abertas <= 1) return null
  const extras = abertas - 1
  const texto = `Este título tem ${abertas} etapas abertas ao mesmo tempo. A exibida é a mais antiga; as outras ${extras === 1 ? 'estão' : 'estão'} na trilha completa.`
  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge
            variant="outline"
            className="border-info/40 text-info"
            title={texto}
            aria-label={texto}
          >
            +{extras}
          </Badge>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs">{texto}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
