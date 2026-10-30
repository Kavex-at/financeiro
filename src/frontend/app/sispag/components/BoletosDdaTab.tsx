'use client'

import * as React from 'react'
import { toast } from 'sonner'
import { AlertTriangle, DatabaseZap, RefreshCcw, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { Input } from '@/components/ui/input'
import { TableSkeleton } from '@/components/ui/skeleton'
import { usePermissoes } from '@/lib/auth/PermissoesProvider'
import { PERMISSAO } from '@/lib/permissoes'
import {
  type BoletoDda,
  type BoletosDdaResposta,
  type SincronizacaoDdaResultado,
  fetchBoletosDda,
  SincronizacaoDdaEmAndamentoError,
  sincronizarBoletosDda,
} from '@/lib/sispag'
import { FaixaBoletosHoje } from '../boletos-dda/FaixaBoletosHoje'
import { FiltroSituacaoDdaBarra } from '../boletos-dda/FiltroSituacaoDdaBarra'
import { haFiltroDda, totalDe } from '../boletos-dda/filtrosBoletosDda'
import { RegrasBoletoDda } from '../boletos-dda/RegrasBoletoDda'
import { TabelaBoletosDda } from '../boletos-dda/TabelaBoletosDda'
import { useTabelaBoletosDda } from '../boletos-dda/useTabelaBoletosDda'
import { CandidatosBoletoDialog } from './CandidatosBoletoDialog'
import { CardsBoletosDda } from './CardsBoletosDda'
import { horasDdaDefasado } from './ddaDefasado'

// A gaveta do título (`BoletosDoTituloDialog`) importa o selo daqui.
export { SITUACAO_BADGE } from '../boletos-dda/rotulosDda'

/**
 * Toast do "Atualizar DDA" (F3): conta o que foi LIDO, não o que foi planejado. `arquivosNovos`
 * inclui os que falharam ou ficaram para depois do prazo de 60 s.
 */
export const resumoDaSincronizacao = (
  r: SincronizacaoDdaResultado,
): { completa: boolean; descricao: string } => {
  const adiados = r.arquivosAdiados ?? 0
  const lidos = r.arquivosLidos ?? Math.max(0, r.arquivosNovos + r.arquivosRelidos - r.falhas - adiados)
  const partes = [`${lidos} arquivo(s) lido(s)`]
  if (adiados > 0) partes.push(`${adiados} adiado(s)`)
  if (r.falhas > 0) partes.push(`${r.falhas} com falha`)
  const completa = adiados === 0 && r.falhas === 0
  return {
    completa,
    descricao: completa
      ? partes.join(' · ')
      : `${partes.join(' · ')}. Clique em "Atualizar DDA" de novo para completar.`,
  }
}

export function BoletosDdaTab({
  onCompor,
  onGrupoAlterado,
  versaoCarteira,
  atualizandoCarteira = false,
}: {
  /** Compor um boleto agrupado a partir de um boleto livre (ADR-0077): só com `sispag:executar`. */
  onCompor?: (boleto: BoletoDda) => void
  /** I21v: depois de confirmar ou anular um grupo aqui, a tela relê carteira, lotes e sugestões. */
  onGrupoAlterado?: () => void | Promise<void>
  /**
   * Marca da última ingestão da carteira (a da página). Mudou = a ingestão re-sincronizou o pool
   * DDA, e a aba relê sem esperar um filtro mudar (F4).
   */
  versaoCarteira?: string | number
  /**
   * I-DDA7: a abertura da tela está atualizando a carteira ou conferindo o DDA. O aviso "DDA parado"
   * fica quieto até terminar (o resultado chega pelo `versaoCarteira`).
   */
  atualizandoCarteira?: boolean
} = {}) {
  // ADR-0053: consultar os boletos (`GET /sispag/boletos-dda`) basta `sispag:ver`; sincronizar
  // com o fin124 ("Atualizar DDA") exige `sispag:executar` e some sem ela (R11). Sem `ver`, por
  // defesa, o componente não lê nada.
  const { carregando: carregandoPermissoes, tem } = usePermissoes()
  const podeVer = !carregandoPermissoes && tem(PERMISSAO.SISPAG_VER)
  const podeExecutar = !carregandoPermissoes && tem(PERMISSAO.SISPAG_EXECUTAR)
  const tabela = useTabelaBoletosDda()
  const { filtros, filtro } = tabela
  const [sincronizando, setSincronizando] = React.useState(false)
  /** Incrementado para recarregar a lista (depois de sincronizar) sem mudar nenhum filtro. */
  const [recarga, setRecarga] = React.useState(0)
  const [candidatosDe, setCandidatosDe] = React.useState<BoletoDda | null>(null)
  const [regrasAbertas, setRegrasAbertas] = React.useState(false)
  const regrasId = React.useId()
  /** Última resposta, com a chave da requisição que a produziu. */
  const [resultado, setResultado] = React.useState<{
    chave: string
    dados?: BoletosDdaResposta
    erro?: string
  } | null>(null)

  const chave = `${JSON.stringify(filtro)}#${recarga}#${versaoCarteira ?? ''}`

  // F4: a requisição superada é ABORTADA (não só descartada); estado muda só depois do fetch.
  React.useEffect(() => {
    if (!podeVer) return
    const ctrl = new AbortController()
    fetchBoletosDda(filtro, { signal: ctrl.signal })
      .then((dados) => {
        if (!ctrl.signal.aborted) setResultado({ chave, dados })
      })
      .catch((e: unknown) => {
        if (ctrl.signal.aborted) return
        setResultado({ chave, erro: e instanceof Error ? e.message : String(e) })
      })
    return () => ctrl.abort()
  }, [chave, filtro, podeVer])

  /** Carregando = a última resposta é de outra requisição. A página anterior fica visível, esmaecida. */
  const carregando = resultado?.chave !== chave
  const erro = carregando ? undefined : resultado?.erro
  const dados = resultado?.dados
  // I-DDA7: conta da última conferência bem-sucedida, não do último arquivo gravado.
  const horasDefasado = atualizandoCarteira
    ? undefined
    : horasDdaDefasado(dados?.conferidoEm ?? dados?.sincronizadoEm)
  const filtrando = haFiltroDda(filtros)
  const recarregar = () => setRecarga((n) => n + 1)

  const sincronizar = async () => {
    setSincronizando(true)
    try {
      const { completa, descricao } = resumoDaSincronizacao(await sincronizarBoletosDda())
      if (completa) toast.success('DDA atualizado', { description: descricao })
      else toast.warning('DDA atualizado em parte', { description: descricao })
      recarregar()
    } catch (e) {
      if (e instanceof SincronizacaoDdaEmAndamentoError) toast.info(e.message)
      else {
        toast.error('Não foi possível atualizar o DDA', {
          description: e instanceof Error ? e.message : String(e),
        })
      }
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

  if (!podeVer) return null

  // F1: "não sincronizado" só com resposta OK sem `sincronizadoEm` — nunca na carga nem no erro.
  const quando = (ms: number) => new Date(ms).toLocaleString('pt-BR')
  const cabecalhoDda = dados
    ? dados.sincronizadoEm
      ? dados.conferidoEm !== undefined && dados.conferidoEm !== dados.sincronizadoEm
        ? `DDA conferido em ${quando(dados.conferidoEm)} · dados de ${quando(dados.sincronizadoEm)}`
        : `DDA de ${quando(dados.sincronizadoEm)}`
      : 'DDA ainda não sincronizado'
    : erro
      ? 'Não foi possível ler o DDA'
      : 'Carregando o DDA…'

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <div className="flex gap-1" role="group" aria-label="Período">
            {(['a-vencer', 'todos'] as const).map((e) => (
              <Button
                key={e}
                size="sm"
                variant={filtros.escopo === e ? 'default' : 'outline'}
                onClick={() => tabela.atualizar({ escopo: e })}
                aria-pressed={filtros.escopo === e}
              >
                {e === 'a-vencer' ? 'A vencer' : 'Todos (inclui vencidos)'}
              </Button>
            ))}
          </div>
          <span className="text-xs text-muted-foreground">{cabecalhoDda}</span>
          {horasDefasado !== undefined ? (
            <span role="status" className="flex items-center gap-1 text-xs text-warning">
              <AlertTriangle className="size-3.5" aria-hidden="true" />
              DDA parado há {horasDefasado} h — a coluna Boleto pode estar defasada. A ingestão
              atualiza o DDA a cada rodada
              {podeExecutar ? '; use "Atualizar DDA" para forçar.' : '.'}
            </span>
          ) : null}
        </div>
        {podeExecutar ? (
          <Button size="sm" variant="outline" onClick={sincronizar} disabled={sincronizando}>
            <RefreshCcw className={`size-4 ${sincronizando ? 'animate-spin' : ''}`} />{' '}
            {sincronizando ? 'Atualizando…' : 'Atualizar DDA'}
          </Button>
        ) : null}
      </div>

      <CardsBoletosDda
        dados={dados}
        carregando={carregando}
        segmento={tabela.segmento}
        urgentesAtivo={tabela.urgentesAtivo}
        emGrupoAtivo={filtros.emGrupo}
        onVerCasados={() => tabela.definirSegmento(tabela.segmento === 'casados' ? 'todos' : 'casados')}
        onVerForaJanela={() =>
          tabela.definirSegmento(tabela.segmento === 'fora-janela' ? 'todos' : 'fora-janela')
        }
        onConferir={() => tabela.definirSegmento(tabela.segmento === 'conferir' ? 'todos' : 'conferir')}
        onAlternarUrgentes={tabela.alternarUrgentes}
        onAlternarEmGrupo={tabela.alternarEmGrupo}
      />

      {dados ? (
        <FaixaBoletosHoje
          amostra={dados.amostraHoje ?? []}
          total={totalDe(dados, 'hoje').qtd ?? 0}
          onVerSoEstes={tabela.verSoHoje}
          onVerCandidatos={setCandidatosDe}
        />
      ) : null}

      <FiltroSituacaoDdaBarra
        dados={dados}
        segmento={tabela.segmento}
        situacoes={filtros.situacoes}
        emGrupo={filtros.emGrupo}
        onSegmento={tabela.definirSegmento}
        onAlternarConferir={tabela.alternarConferir}
        onAlternarEmGrupo={tabela.alternarEmGrupo}
        regrasAbertas={regrasAbertas}
        regrasId={regrasId}
        onAlternarRegras={() => setRegrasAbertas((v) => !v)}
      />
      {regrasAbertas ? <RegrasBoletoDda id={regrasId} regraCandidato={dados?.regraCandidato} /> : null}

      <label className="relative block max-w-md">
        <span className="sr-only">Buscar boletos</span>
        <Search
          className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <Input
          type="search"
          className="pl-8"
          value={filtros.busca}
          placeholder="Buscar por número, valor, credor, fornecedor, documento, código de barras ou arquivo…"
          onChange={(e) => tabela.atualizar({ busca: e.target.value })}
        />
      </label>

      {!dados && carregando ? (
        <TableSkeleton
          columns={9}
          aria-label="Carregando boletos"
          larguras={['w-20', 'w-24', 'w-20', 'w-20', 'w-10', 'w-32', 'w-40', 'w-10', 'w-8']}
        />
      ) : erro ? (
        <EmptyState
          icon={<AlertTriangle className="size-6" />}
          title="Não foi possível carregar os boletos"
          description={erro}
          action={
            <Button size="sm" variant="outline" onClick={recarregar}>
              <RefreshCcw className="size-4" /> Tentar de novo
            </Button>
          }
        />
      ) : dados && dados.total === 0 ? (
        <EmptyState
          icon={filtrando ? undefined : <DatabaseZap className="size-6" />}
          title={filtrando ? 'Nenhum boleto encontrado' : 'Nenhum boleto DDA'}
          description={
            !dados.sincronizadoEm
              ? podeExecutar
                ? 'Clique em "Atualizar DDA" para trazer os boletos do fin124.'
                : 'A ingestão traz os boletos do fin124 às 07h, 12h e 16h dos dias úteis.'
              : filtrando
                ? 'Ajuste a situação, os filtros das colunas ou a busca.'
                : 'Nenhum boleto neste período. Veja "Todos" para incluir os vencidos.'
          }
          action={
            filtrando ? (
              <Button size="sm" variant="outline" onClick={tabela.limpar}>
                Limpar filtros
              </Button>
            ) : undefined
          }
        />
      ) : dados ? (
        <TabelaBoletosDda
          tabela={tabela}
          dados={dados}
          carregando={carregando}
          podeExecutar={podeExecutar}
          {...(onCompor ? { onCompor } : {})}
          onVerCandidatos={setCandidatosDe}
          onCopiar={(b) => void copiar(b)}
          onGrupoAlterado={async () => {
            recarregar()
            await onGrupoAlterado?.()
          }}
        />
      ) : null}
      <CandidatosBoletoDialog boleto={candidatosDe} onClose={() => setCandidatosDe(null)} />
    </div>
  )
}
