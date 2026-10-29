'use client'

import { Layers } from 'lucide-react'
import * as React from 'react'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import {
  anularGrupoBoleto,
  confirmarGrupoBoleto,
  type ChaveTituloGrupo,
  type GrupoBoletoListado,
  type SugestaoGrupoBoleto,
} from '@/lib/sispag'
import { formatDate } from '@/lib/utils'
import {
  EXPLICACAO_INTERCAMBIAVEL,
  formatCentavos,
  type GrupoEncontrado,
  orientacaoSituacaoGrupo,
  resumoMotivosGrupo,
} from './grupoBoleto'
import { SituacaoGrupoBadge } from './GrupoBoletoLinha'
import { MotivoDecisaoDialog } from './MotivoDecisaoDialog'
import { ReconhecerAvisosGrupo, type ResumoAvisosGrupo } from './ReconhecerAvisosGrupo'

/** Menor motivo de anulação aceito (o servidor tem a mesma regra: 10 a 500 caracteres). */
const MOTIVO_ANULACAO_MINIMO_GRUPO = 10

const mesmoTitulo = (a: ChaveTituloGrupo, b: ChaveTituloGrupo): boolean =>
  a.filCod === b.filCod && a.docCod === b.docCod && a.titCod === b.titCod

interface VisaoDoGrupo {
  credor: string
  filCod: number
  numeroBoleto?: string | undefined
  codbarMascarado?: string | undefined
  valorBoletoCentavos: number
  vencimentoBoleto: string
  somaCentavos: number
  intercambiavel: boolean
  titulos: Array<ChaveTituloGrupo & { valorCentavos: number }>
}

const visaoDaSugestao = (s: SugestaoGrupoBoleto): VisaoDoGrupo => ({
  credor: s.credor ?? s.pesCod,
  filCod: s.filCod,
  numeroBoleto: s.numeroBoleto,
  codbarMascarado: s.codbarMascarado,
  valorBoletoCentavos: s.valorBoletoCentavos,
  vencimentoBoleto: s.vencimentoBoleto,
  somaCentavos: s.somaTitulosCentavos ?? s.titulos.reduce((a, t) => a + t.valorCentavos, 0),
  intercambiavel: s.intercambiavel,
  titulos: s.titulos.map((t) => ({
    filCod: t.filCod,
    docCod: t.docCod,
    titCod: t.titCod,
    valorCentavos: t.valorCentavos,
  })),
})

const visaoDoConfirmado = (g: GrupoBoletoListado): VisaoDoGrupo => ({
  credor: g.credor ?? g.pesCod,
  filCod: g.filCod,
  numeroBoleto: g.numeroBoleto,
  codbarMascarado: g.codbarMascarado,
  valorBoletoCentavos: g.valorBoletoCentavos,
  vencimentoBoleto: g.vencimentoBoleto,
  somaCentavos: g.somaTitulosCentavos,
  intercambiavel: g.intercambiavel,
  titulos: g.titulos.map((t) => ({
    filCod: t.filCod,
    docCod: t.docCod,
    titCod: t.titCod,
    valorCentavos: t.valorLiquidoCentavos ?? 0,
  })),
})

/** O que a pessoa reconhece ao confirmar: títulos que vencem antes do boleto (`deltaDias > 0`). */
const resumoDosAvisos = (s: SugestaoGrupoBoleto): ResumoAvisosGrupo => {
  const antes = s.titulos.filter((t) => (t.deltaDias ?? 0) > 0)
  return {
    quantidadeTitulosAntes: antes.length,
    vencimentoBoleto: s.vencimentoBoleto,
    diferencaCentavos: (s.somaTitulosCentavos ?? 0) - s.valorBoletoCentavos,
    maiorAntecedenciaDias: Math.max(0, ...antes.map((t) => t.deltaDias ?? 0)),
  }
}

/**
 * O boleto agrupado inline (ADR-0077, I21v): o boleto, TODOS os títulos que ele paga (o título
 * atual destacado) e a soma contra o boleto. Sugestão confirmável tem **Confirmar grupo** (com o
 * reconhecimento dos avisos da I21i, quando houver); sugestão não confirmável mostra o motivo; grupo
 * confirmado mostra a situação, a orientação e **Anular grupo**. Mesmos endpoints da antiga aba
 * Boletos agrupados: nenhuma escrita nova. Escrita só para `sispag:executar`.
 */
export function GrupoBoletoBloco({
  encontrado,
  tituloAtual,
  podeExecutar,
  onAlterado,
}: {
  encontrado: GrupoEncontrado
  tituloAtual?: ChaveTituloGrupo | undefined
  podeExecutar: boolean
  /** Depois de confirmar ou anular, com a frase para o `role="status"` da tela que hospeda. */
  onAlterado: (mensagem: string) => void | Promise<void>
}) {
  const [confirmando, setConfirmando] = React.useState(false)
  const [reconhecendo, setReconhecendo] = React.useState(false)
  const [erro, setErro] = React.useState<string | null>(null)
  const [anulando, setAnulando] = React.useState<GrupoBoletoListado | null>(null)

  const sugestao = encontrado.tipo === 'SUGERIDO' ? encontrado.sugestao : undefined
  const confirmado = encontrado.tipo === 'CONFIRMADO' ? encontrado.grupo : undefined
  const v = sugestao ? visaoDaSugestao(sugestao) : confirmado ? visaoDoConfirmado(confirmado) : null
  if (!v) return null

  const enviar = async (s: SugestaoGrupoBoleto, reconheceAvisos?: readonly string[]) => {
    setErro(null)
    setConfirmando(true)
    try {
      await confirmarGrupoBoleto({
        origem: 'SUGERIDO',
        ddcCod: s.ddcCod,
        ditCod: s.ditCod,
        titulos: s.titulos.map((t) => ({ filCod: t.filCod, docCod: t.docCod, titCod: t.titCod })),
        ...(reconheceAvisos && reconheceAvisos.length > 0 ? { reconheceAvisos } : {}),
      })
    } catch (e) {
      throw new Error(e instanceof Error && e.message ? e.message : 'Não foi possível confirmar o grupo.')
    } finally {
      setConfirmando(false)
    }
    await onAlterado('Boleto agrupado confirmado.')
  }

  const confirmar = async (s: SugestaoGrupoBoleto) => {
    if (confirmando) return
    if (s.avisos.length > 0) {
      setReconhecendo(true)
      return
    }
    try {
      await enviar(s)
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível confirmar o grupo.')
    }
  }

  const orientacao = confirmado ? orientacaoSituacaoGrupo(confirmado.situacao) : undefined
  const rotuloBoleto = v.numeroBoleto ? `${v.numeroBoleto} · ` : ''

  return (
    <section
      aria-label={`Boleto agrupado de ${v.credor}`}
      className="flex flex-col gap-3 rounded-lg border bg-card p-4"
    >
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <Layers className="size-4 text-muted-foreground" aria-hidden />
            {sugestao ? 'Grupo sugerido' : 'Grupo confirmado'} · {v.credor}
          </h3>
          <p className="text-xs text-muted-foreground">
            Filial {v.filCod} · boleto {rotuloBoleto}
            <span className="tabular-nums">{v.codbarMascarado ?? '—'}</span>
          </p>
        </div>
        <dl className="text-right text-sm">
          <dt className="sr-only">Valor do boleto</dt>
          <dd className="font-medium tabular-nums">{formatCentavos(v.valorBoletoCentavos)}</dd>
          <dt className="sr-only">Vencimento do boleto</dt>
          <dd className="text-xs tabular-nums text-muted-foreground">
            {formatDate(v.vencimentoBoleto)}
          </dd>
        </dl>
      </header>

      <ul aria-label="Títulos que o boleto paga" className="flex flex-col gap-1 text-sm">
        {v.titulos.map((t) => {
          const atual = tituloAtual !== undefined && mesmoTitulo(t, tituloAtual)
          return (
            <li
              key={`${t.filCod}:${t.docCod}:${t.titCod}`}
              aria-current={atual ? 'true' : undefined}
              className={`flex items-center justify-between gap-3 rounded px-2 py-1${atual ? ' bg-muted font-medium' : ''}`}
            >
              <span className="tabular-nums">
                {t.docCod}/{t.titCod}
                {atual ? <span className="ml-2 text-xs text-primary">este título</span> : null}
              </span>
              <span className="tabular-nums">{formatCentavos(t.valorCentavos)}</span>
            </li>
          )
        })}
      </ul>

      <p className="text-sm">
        Soma dos títulos:{' '}
        <strong className="tabular-nums">{formatCentavos(v.somaCentavos)}</strong>
        <span className="text-muted-foreground">
          {' '}
          · boleto <span className="tabular-nums">{formatCentavos(v.valorBoletoCentavos)}</span>
        </span>
      </p>
      {v.intercambiavel ? (
        <p className="text-xs text-muted-foreground">{EXPLICACAO_INTERCAMBIAVEL}</p>
      ) : null}

      {sugestao ? (
        sugestao.confirmavel ? (
          podeExecutar ? (
            <div className="flex flex-col items-start gap-1">
              <p className="text-xs text-muted-foreground">
                Confirmar registra a sua decisão e <strong>não grava nada no Conexos</strong>: o
                borderô nasce na remessa.
              </p>
              <Button
                size="sm"
                disabled={confirmando}
                aria-label={`Confirmar grupo de ${v.credor}`}
                onClick={() => void confirmar(sugestao)}
              >
                {confirmando ? <Spinner aria-hidden /> : null}
                Confirmar grupo
              </Button>
            </div>
          ) : null
        ) : (
          <p className="text-sm text-warning-foreground">
            Não confirmável: {resumoMotivosGrupo(sugestao.motivos)}
          </p>
        )
      ) : confirmado ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-col items-start gap-1">
            <SituacaoGrupoBadge situacao={confirmado.situacao} />
            {orientacao ? (
              <span className="text-xs text-muted-foreground">{orientacao}</span>
            ) : null}
          </div>
          {podeExecutar ? (
            <Button
              size="sm"
              variant="outline"
              aria-label={`Anular grupo de ${v.credor}`}
              onClick={() => setAnulando(confirmado)}
            >
              Anular grupo
            </Button>
          ) : null}
        </div>
      ) : null}

      {erro ? (
        <p
          role="alert"
          className="rounded-lg border border-danger/40 bg-danger-subtle px-4 py-3 text-sm text-danger-foreground"
        >
          {erro}
        </p>
      ) : null}

      {reconhecendo && sugestao ? (
        <ReconhecerAvisosGrupo
          avisos={sugestao.avisos}
          resumo={resumoDosAvisos(sugestao)}
          onFechar={() => setReconhecendo(false)}
          onConfirmar={async (reconhecidos) => {
            await enviar(sugestao, reconhecidos)
            setReconhecendo(false)
          }}
        />
      ) : null}

      {anulando ? (
        <MotivoDecisaoDialog
          titulo="Anular boleto agrupado"
          descricao={`${anulando.credor ?? anulando.pesCod} · ${anulando.codbarMascarado}. Os títulos e o boleto ficam livres; se o grupo estiver num lote em rascunho, ele sai de lá. Nada muda no Conexos. O motivo fica na trilha.`}
          rotuloConfirmar="Anular grupo"
          minimoCaracteres={MOTIVO_ANULACAO_MINIMO_GRUPO}
          onFechar={() => setAnulando(null)}
          onConfirmar={async (motivo) => {
            let r: Awaited<ReturnType<typeof anularGrupoBoleto>>
            try {
              r = await anularGrupoBoleto(anulando.id, motivo)
            } catch (e) {
              throw new Error(
                e instanceof Error && e.message ? e.message : 'Não foi possível anular o grupo.',
              )
            }
            setAnulando(null)
            await onAlterado(
              [
                'Boleto agrupado anulado.',
                r.retiradoDoLoteId ? 'Os títulos saíram do lote em rascunho.' : '',
                r.avisoLoteComprometido?.mensagem ?? '',
              ]
                .filter(Boolean)
                .join(' '),
            )
          }}
        />
      ) : null}
    </section>
  )
}
