'use client'

import * as React from 'react'
import { format, formatDistanceToNowStrict } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { AlertTriangle, Database } from 'lucide-react'

/** Converte um ISO em `Date`, devolvendo `null` para ausente ou inválido. */
export const parseDataIso = (iso?: string): Date | null => {
  if (!iso) return null
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? null : d
}

/**
 * Faixa de idade do dado — invariante **I7**, não negociável.
 *
 * Este painel NÃO fala com o ERP ao vivo: ele lê um snapshot ingerido periodicamente. Um analista
 * que aprova (ou cobra) com base numa foto velha, achando que é o estado atual, toma a decisão
 * errada com toda a confiança do mundo. Por isso a idade do dado aparece tanto no grid quanto no
 * detalhe da trilha — abrir o drawer não pode fazer o leitor perder essa informação de vista —
 * e a AUSÊNCIA dela é tratada como alerta, não como detalhe silencioso.
 */
export function SnapshotFaixa({ snapshotEm }: { snapshotEm?: string }) {
  const data = parseDataIso(snapshotEm)
  if (data === null) {
    return (
      <div
        role="status"
        className="flex items-start gap-2 rounded-lg border border-danger/40 bg-danger/5 p-3 text-sm"
      >
        <AlertTriangle className="mt-0.5 size-4 shrink-0 text-danger" aria-hidden />
        <div>
          <span className="font-medium">Idade do dado desconhecida.</span> O backend não informou
          quando este snapshot do Conexos foi tirado, então não há como saber o quanto ele está
          defasado. Trate os números abaixo como indicativos até a próxima ingestão.
        </div>
      </div>
    )
  }
  return (
    <div
      role="status"
      className="flex items-start gap-2 rounded-lg border border-info/40 bg-info/5 p-3 text-sm"
    >
      <Database className="mt-0.5 size-4 shrink-0 text-info" aria-hidden />
      <div>
        <span className="font-medium">Snapshot, não o ERP ao vivo.</span> Dados sincronizados do
        Conexos em{' '}
        <span className="font-medium">{format(data, "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}</span>{' '}
        ({formatDistanceToNowStrict(data, { locale: ptBR, addSuffix: true })}). Aprovações feitas no
        ERP depois desse instante ainda não aparecem aqui.
      </div>
    </div>
  )
}
