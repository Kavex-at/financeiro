'use client'

import * as React from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { KPIGrid, SimpleKPI } from '@/components/ui/kpi-card'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import {
  type Atividade,
  type ConsultaAtividade,
  type FrenteAtividade,
  getAtividade,
  type TipoPeriodo,
} from '@/lib/api/perfil'
import { usePermissoes } from '@/lib/auth/PermissoesProvider'
import { isSessionExpiredError } from '@/lib/http'
import { PERMISSAO } from '@/lib/permissoes'
import { formatBRL } from '@/lib/utils'
import { gravarPeriodo, lerPeriodo, PERIODO_PADRAO, ROTULO_PERIODO } from './periodo'
import { ErroSecao, SecaoPerfil, VerificacaoIndisponivel } from './SecaoPerfil'

const TIPOS: readonly TipoPeriodo[] = ['hoje', 'semana', 'mes', 'personalizado']

/** Contagem em pt-BR, sem casas decimais ("1.234"). */
const formatInteiro = (n: number): string => n.toLocaleString('pt-BR', { maximumFractionDigits: 0 })

/** ↑/↓ contra o período anterior. Texto acessível junto da seta e da cor: nunca só cor. */
function Comparacao({
  atual,
  anterior,
  formatar = formatInteiro,
}: {
  atual: number
  anterior: number
  formatar?: (n: number) => string
}) {
  const delta = atual - anterior
  if (delta === 0) {
    return (
      <span className="text-muted-foreground">
        <span aria-hidden>= </span>
        <span className="sr-only">igual ao período anterior</span>
        <span aria-hidden>igual ao anterior</span>
      </span>
    )
  }
  const sobe = delta > 0
  const valor = formatar(Math.abs(delta))
  return (
    <span className={sobe ? 'text-success-foreground' : 'text-warning-foreground'}>
      <span aria-hidden>
        {sobe ? '↑' : '↓'} {valor} vs. anterior
      </span>
      <span className="sr-only">
        {sobe ? 'aumento' : 'queda'} de {valor} em relação ao período anterior
      </span>
    </span>
  )
}

/** "N com erro" que leva ao histórico filtrado. Some quando é zero. */
function ComErro({
  n,
  frente,
  nomeFrente,
  onVerErros,
}: {
  n: number
  frente: FrenteAtividade
  nomeFrente: string
  onVerErros: (frente: FrenteAtividade) => void
}) {
  if (n === 0) return null
  return (
    <button
      type="button"
      onClick={() => onVerErros(frente)}
      aria-label={`${n} com erro em ${nomeFrente}`}
      className="rounded-sm text-danger-foreground underline underline-offset-4 outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {n} com erro
    </button>
  )
}

/**
 * Minha atividade: KPIs por frente (só as frentes com `<frente>:ver`), no período escolhido, com o
 * anterior para comparação. Mesma grade e mesmas regras de `/metricas` (I7): Permutas conta só
 * baixas com borderô finalizado; SISPAG separa remessado / agendado / pago confirmado (I4).
 */
export function AtividadeSection({
  onVerErros,
}: {
  onVerErros: (frente: FrenteAtividade) => void
}) {
  const { tem, falhou, carregando: carregandoPermissoes, recarregar } = usePermissoes()
  const [consulta, setConsulta] = React.useState<ConsultaAtividade>(PERIODO_PADRAO)
  const [rascunho, setRascunho] = React.useState({ inicio: '', fim: '' })
  const [tentativa, setTentativa] = React.useState(0)
  /** Resposta amarrada à consulta que a pediu: consulta nova = carregando até ela responder. */
  const [resposta, setResposta] = React.useState<{
    chave: string
    dados: Atividade | null
    erro: string | null
  } | null>(null)
  const chave = `${JSON.stringify(consulta)}#${tentativa}`

  // Preferência lida DEPOIS da montagem (ler no render quebraria a hidratação do SSR).
  React.useEffect(() => {
    const salvo = lerPeriodo()
    // Mesmo período do padrão: mantém a referência e não dispara uma segunda consulta.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- o localStorage só existe no cliente; mesmo padrão de components/ui/sidebar.tsx
    setConsulta((atual) => (JSON.stringify(atual) === JSON.stringify(salvo) ? atual : salvo))
    if (salvo.periodo === 'personalizado') {
      setRascunho({ inicio: salvo.inicio ?? '', fim: salvo.fim ?? '' })
    }
  }, [])

  const frentes = {
    permutas: tem(PERMISSAO.PERMUTAS_VER),
    sispag: tem(PERMISSAO.SISPAG_VER),
    recebimentos: tem(PERMISSAO.RECEBIMENTOS_VER),
  }
  const algumaFrente = frentes.permutas || frentes.sispag || frentes.recebimentos
  const podeBuscar = !falhou && !carregandoPermissoes && algumaFrente

  React.useEffect(() => {
    if (!podeBuscar) return
    if (consulta.periodo === 'personalizado' && (!consulta.inicio || !consulta.fim)) return
    let vivo = true
    getAtividade(consulta)
      .then((dados) => {
        if (vivo) setResposta({ chave, dados, erro: null })
      })
      .catch((e: unknown) => {
        if (!vivo || isSessionExpiredError(e)) return
        setResposta({
          chave,
          dados: null,
          erro: e instanceof Error ? e.message : 'Não foi possível carregar sua atividade.',
        })
      })
    return () => {
      vivo = false
    }
  }, [consulta, podeBuscar, chave])

  const atual = resposta?.chave === chave ? resposta : null
  const carregando = atual === null
  const dados = atual?.dados ?? null
  const erro = atual?.erro ?? null

  const escolher = (tipo: TipoPeriodo) => {
    if (tipo === 'personalizado') {
      setConsulta({ periodo: 'personalizado', ...(rascunho.inicio && rascunho.fim ? rascunho : {}) })
      return
    }
    const nova = { periodo: tipo }
    setConsulta(nova)
    gravarPeriodo(nova)
  }

  const aplicarPersonalizado = (e: React.FormEvent) => {
    e.preventDefault()
    if (!rascunho.inicio || !rascunho.fim) return
    const nova: ConsultaAtividade = { periodo: 'personalizado', ...rascunho }
    setConsulta(nova)
    gravarPeriodo(nova)
  }

  const seletor = (
    <div className="flex flex-wrap gap-2" role="group" aria-label="Período">
      {TIPOS.map((tipo) => (
        <Button
          key={tipo}
          type="button"
          size="sm"
          variant={consulta.periodo === tipo ? 'default' : 'outline'}
          aria-pressed={consulta.periodo === tipo}
          onClick={() => escolher(tipo)}
        >
          {ROTULO_PERIODO[tipo]}
        </Button>
      ))}
    </div>
  )

  return (
    <SecaoPerfil
      idTitulo="perfil-atividade"
      titulo="Minha atividade"
      descricao="O que você executou, com os mesmos critérios de /metricas."
    >
      {falhou ? (
        <VerificacaoIndisponivel onRecarregar={recarregar} />
      ) : !carregandoPermissoes && !algumaFrente ? (
        <p className="text-sm text-muted-foreground">
          Nenhuma frente liberada para você ainda. Seu histórico continua abaixo.
        </p>
      ) : (
        <div className="space-y-4">
          {seletor}
          {consulta.periodo === 'personalizado' ? (
            <form onSubmit={aplicarPersonalizado} className="flex flex-wrap items-end gap-3">
              <div className="space-y-1">
                <Label htmlFor="atividade-inicio">De</Label>
                <Input
                  id="atividade-inicio"
                  type="date"
                  value={rascunho.inicio}
                  onChange={(e) => setRascunho((r) => ({ ...r, inicio: e.target.value }))}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="atividade-fim">Até</Label>
                <Input
                  id="atividade-fim"
                  type="date"
                  value={rascunho.fim}
                  onChange={(e) => setRascunho((r) => ({ ...r, fim: e.target.value }))}
                />
              </div>
              <Button type="submit" size="sm" disabled={!rascunho.inicio || !rascunho.fim}>
                Aplicar
              </Button>
            </form>
          ) : null}
          {consulta.periodo === 'personalizado' && (!consulta.inicio || !consulta.fim) ? (
            <p className="text-sm text-muted-foreground">Escolha as datas e clique em Aplicar.</p>
          ) : carregando || carregandoPermissoes ? (
            <KPIGrid columns={3}>
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} data-testid="skeleton" className="h-28" />
              ))}
            </KPIGrid>
          ) : erro ? (
            <ErroSecao mensagem={erro} onTentar={() => setTentativa((n) => n + 1)} />
          ) : dados ? (
            <Frentes dados={dados} frentes={frentes} onVerErros={onVerErros} />
          ) : null}
        </div>
      )}
    </SecaoPerfil>
  )
}

function Frentes({
  dados,
  frentes,
  onVerErros,
}: {
  dados: Atividade
  frentes: { permutas: boolean; sispag: boolean; recebimentos: boolean }
  onVerErros: (frente: FrenteAtividade) => void
}) {
  const p = dados.permutas
  const s = dados.sispag
  const r = dados.recebimentos
  return (
    <div className="space-y-6">
      {frentes.permutas ? (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold">Permutas</h3>
          <KPIGrid columns={2}>
            <SimpleKPI
              label="Permutas concluídas"
              value={formatInteiro(p.atual.concluidas)}
              tooltip="Baixas com borderô finalizado no ERP — o mesmo critério de /metricas."
              footer={<Comparacao atual={p.atual.concluidas} anterior={p.anterior.concluidas} />}
            />
            <SimpleKPI
              label="Valor baixado"
              value={formatBRL(p.atual.valorBaixado)}
              tooltip="Baixas integrais e parciais com borderô finalizado."
              footer={
                <Comparacao
                  atual={p.atual.valorBaixado}
                  anterior={p.anterior.valorBaixado}
                  formatar={formatBRL}
                />
              }
            />
          </KPIGrid>
          <p className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <span>{p.atual.parciais} parciais</span>
            <span>{p.atual.aguardandoBordero} aguardando borderô finalizado</span>
            <ComErro n={p.atual.comErro} frente="permutas" nomeFrente="Permutas" onVerErros={onVerErros} />
          </p>
        </div>
      ) : null}

      {frentes.sispag ? (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold">SISPAG</h3>
          <KPIGrid columns={4}>
            <SimpleKPI
              label="Lotes finalizados"
              value={formatInteiro(s.atual.lotesFinalizados)}
              footer={<Comparacao atual={s.atual.lotesFinalizados} anterior={s.anterior.lotesFinalizados} />}
            />
            <SimpleKPI
              label="Remessas geradas"
              value={formatInteiro(s.atual.remessasGeradas)}
              tooltip="Lotes cuja primeira remessa foi gerada por você. A remessa é gerada aqui e enviada ao banco fora da plataforma."
              footer={<Comparacao atual={s.atual.remessasGeradas} anterior={s.anterior.remessasGeradas} />}
            />
            <SimpleKPI
              label="Retornos conciliados"
              value={formatInteiro(s.atual.retornosConciliados)}
              footer={
                <Comparacao atual={s.atual.retornosConciliados} anterior={s.anterior.retornosConciliados} />
              }
            />
            <SimpleKPI
              label="Valor remessado"
              value={formatBRL(s.atual.valorRemessado)}
              tooltip="Soma dos títulos das remessas que você gerou."
              footer={
                <Comparacao
                  atual={s.atual.valorRemessado}
                  anterior={s.anterior.valorRemessado}
                  formatar={formatBRL}
                />
              }
            />
          </KPIGrid>
          <p className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <span>{formatBRL(s.atual.valorAgendado)} agendado pelo banco</span>
            <span>{formatBRL(s.atual.valorPagoConfirmado)} pago confirmado no ERP</span>
            <ComErro n={s.atual.comErro} frente="sispag" nomeFrente="SISPAG" onVerErros={onVerErros} />
          </p>
        </div>
      ) : null}

      {frentes.recebimentos ? (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold">Adiantamentos</h3>
          <KPIGrid columns={2}>
            <SimpleKPI
              label="Adiantamentos concluídos"
              value={formatInteiro(r.atual.concluidas)}
              footer={<Comparacao atual={r.atual.concluidas} anterior={r.anterior.concluidas} />}
            />
            <SimpleKPI
              label="Valor alocado"
              value={formatBRL(r.atual.valor)}
              footer={<Comparacao atual={r.atual.valor} anterior={r.anterior.valor} formatar={formatBRL} />}
            />
          </KPIGrid>
          <p className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <ComErro
              n={r.atual.comErro}
              frente="recebimentos"
              nomeFrente="Adiantamentos"
              onVerErros={onVerErros}
            />
          </p>
        </div>
      ) : null}
    </div>
  )
}
