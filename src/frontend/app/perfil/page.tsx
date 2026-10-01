'use client'

import * as React from 'react'
import { PageHeader } from '@/components/ui/page-header'
import { type FrenteAtividade, getPerfil } from '@/lib/api/perfil'
import { isSessionExpiredError } from '@/lib/http'
import { AtividadeSection } from './AtividadeSection'
import { type FiltrosHistoricoTela, HistoricoSection } from './HistoricoSection'
import { type EstadoPerfil, IdentidadeSection } from './IdentidadeSection'
import { PermissoesSection } from './PermissoesSection'
import { SegurancaSection } from './SegurancaSection'

/**
 * `/perfil` — a página pessoal do usuário logado (ADR-0058).
 *
 * Cards empilhados, não abas: `#senha` precisa ser âncora nativa, e cada seção carrega e falha
 * sozinha (a falha do histórico não derruba a identidade). Acesso pelo menu do avatar; não há
 * entrada no nav. Tudo só leitura e sempre do PRÓPRIO usuário: o alvo vem da sessão no servidor.
 */
export default function PerfilPage() {
  const [tentativa, setTentativa] = React.useState(0)
  /** Resposta amarrada à tentativa que a pediu: tentativa nova = carregando até ela responder. */
  const [resposta, setResposta] = React.useState<{
    tentativa: number
    perfil: EstadoPerfil['perfil']
    erro: string | null
  } | null>(null)
  const [filtros, setFiltros] = React.useState<FiltrosHistoricoTela>({})
  const historicoRef = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    let vivo = true
    getPerfil()
      .then((perfil) => {
        if (vivo) setResposta({ tentativa, perfil, erro: null })
      })
      .catch((e: unknown) => {
        if (!vivo || isSessionExpiredError(e)) return
        setResposta({
          tentativa,
          perfil: null,
          erro: e instanceof Error ? e.message : 'Não foi possível carregar seu perfil.',
        })
      })
    return () => {
      vivo = false
    }
  }, [tentativa])

  const atual = resposta?.tentativa === tentativa ? resposta : null
  const estado: EstadoPerfil = {
    carregando: atual === null,
    erro: atual?.erro ?? null,
    perfil: atual?.perfil ?? null,
  }

  const tentarPerfil = React.useCallback(() => setTentativa((n) => n + 1), [])

  // "N com erro" num tile: filtra o histórico por aquela frente e status=erro, e rola até ele.
  const verErros = React.useCallback((frente: FrenteAtividade) => {
    setFiltros({ frente, status: 'erro' })
    historicoRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' })
  }, [])

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6">
      <PageHeader title="Meu perfil" subtitle="Quem você é na plataforma, o que pode fazer e o que já fez." />
      <IdentidadeSection estado={estado} onTentar={tentarPerfil} />
      <PermissoesSection estado={estado} onTentar={tentarPerfil} />
      <AtividadeSection onVerErros={verErros} />
      <div ref={historicoRef}>
        <HistoricoSection
          filtros={filtros}
          onFiltros={setFiltros}
          vinculo={estado.perfil?.conexos.conexosUsername ?? null}
        />
      </div>
      <SegurancaSection />
    </div>
  )
}
