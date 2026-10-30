'use client'

import type { BoletoDdaSituacao } from '@/lib/sispag'
import { SITUACAO_BADGE } from './rotulosDda'

const ORDEM: readonly BoletoDdaSituacao[] = ['VINCULADO', 'CANDIDATO', 'AMBIGUO', 'SEM_TITULO']

/** Como a situação do boleto é calculada (o "?" da barra), no padrão de `RegrasSituacao`. */
export function RegrasBoletoDda({ id, regraCandidato }: { id: string; regraCandidato?: string }) {
  return (
    <section
      id={id}
      aria-label="Como a situação do boleto é calculada"
      className="space-y-2 rounded-lg border bg-card px-4 py-3 text-sm"
    >
      <ul className="space-y-1">
        {ORDEM.map((s) => (
          <li key={s}>
            <span className="font-medium">{SITUACAO_BADGE[s].label}:</span>{' '}
            <span className="text-muted-foreground">{SITUACAO_BADGE[s].title}</span>
          </li>
        ))}
      </ul>
      {regraCandidato ? (
        <p className="text-xs text-muted-foreground">Regra de candidato: {regraCandidato}.</p>
      ) : null}
      <p className="text-xs text-muted-foreground">
        &quot;Vencem hoje&quot; e &quot;em até 2 dias&quot; usam o vencimento do boleto (dia de
        Brasília) e não contam os casados. Filtrar por filial mostra só os boletos daquela filial;
        boleto sem título casado nem candidatos de uma filial só aparece em &quot;sem filial&quot;.
      </p>
    </section>
  )
}
