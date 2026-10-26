'use client'

import { Layers } from 'lucide-react'
import * as React from 'react'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { Spinner } from '@/components/ui/spinner'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  anularGrupoBoleto,
  confirmarGrupoBoleto,
  fetchGruposBoleto,
  fetchSugestoesGrupoBoleto,
  type GrupoBoletoListado,
  type SugestaoGrupoBoleto,
} from '@/lib/sispag'
import { formatDate } from '@/lib/utils'
import {
  EXPLICACAO_INTERCAMBIAVEL,
  formatCentavos,
  orientacaoSituacaoGrupo,
  resumoMotivosGrupo,
} from './grupoBoleto'
import { SituacaoGrupoBadge } from './GrupoBoletoLinha'
import { MotivoDecisaoDialog } from './MotivoDecisaoDialog'

/** Menor motivo de anulação aceito (o servidor tem a mesma regra: 10 a 500 caracteres). */
const MOTIVO_ANULACAO_MINIMO_GRUPO = 10

const chaveSugestao = (s: SugestaoGrupoBoleto): string => `${s.ddcCod}:${s.ditCod}`

/**
 * Painel do boleto agrupado (ADR-0077): sugestões de grupo fechado no mesmo vencimento e os grupos
 * confirmados. Sugestão não confirmável mostra o motivo e não oferece o botão. Escrita só para
 * `sispag:executar` (sem a permissão os botões nem aparecem). Só a máscara 5+4 do boleto sai na
 * tela; nada é escrito no ERP aqui — o borderô nasce na geração da remessa.
 */
export function GrupoBoletoPainel({
  podeExecutar,
  filCod,
  onAlterado,
  onCompor,
}: {
  podeExecutar: boolean
  filCod?: number
  /** Depois de confirmar ou anular: a tela relê o painel e os lotes. */
  onAlterado?: () => void | Promise<void>
  /** Abre a composição manual (quem escolhe o boleto e os títulos é a tela). */
  onCompor?: () => void
}) {
  const [sugestoes, setSugestoes] = React.useState<SugestaoGrupoBoleto[] | null>(null)
  const [grupos, setGrupos] = React.useState<GrupoBoletoListado[] | null>(null)
  const [erro, setErro] = React.useState<string | null>(null)
  const [confirmando, setConfirmando] = React.useState<string | null>(null)
  const [erroConfirmar, setErroConfirmar] = React.useState<string | null>(null)
  const [anulando, setAnulando] = React.useState<GrupoBoletoListado | null>(null)
  const [aviso, setAviso] = React.useState<string | null>(null)

  const carregar = React.useCallback(async () => {
    try {
      const [s, g] = await Promise.all([fetchSugestoesGrupoBoleto(filCod), fetchGruposBoleto(filCod)])
      setSugestoes(s)
      setGrupos(g)
      setErro(null)
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Falha ao carregar os boletos agrupados.')
    }
  }, [filCod])

  React.useEffect(() => {
    void carregar()
  }, [carregar])

  const confirmar = async (s: SugestaoGrupoBoleto) => {
    if (confirmando) return
    setConfirmando(chaveSugestao(s))
    setErroConfirmar(null)
    setAviso(null)
    try {
      await confirmarGrupoBoleto({
        origem: 'SUGERIDO',
        ddcCod: s.ddcCod,
        ditCod: s.ditCod,
        titulos: s.titulos.map((t) => ({ filCod: t.filCod, docCod: t.docCod, titCod: t.titCod })),
      })
      await carregar()
      await onAlterado?.()
    } catch (e) {
      setErroConfirmar(e instanceof Error ? e.message : 'Não foi possível confirmar o grupo.')
    } finally {
      setConfirmando(null)
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div role="status" className="text-sm">
        {aviso ? <p className="text-success-foreground">{aviso}</p> : null}
      </div>
      {erro ? (
        <EmptyState
          title="Não foi possível carregar os boletos agrupados"
          description={erro}
          action={
            <Button size="sm" variant="outline" onClick={() => void carregar()}>
              Tentar de novo
            </Button>
          }
        />
      ) : sugestoes === null || grupos === null ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner /> Carregando os boletos agrupados…
        </div>
      ) : (
        <>
          <section aria-labelledby="grupo-sugestoes" className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 id="grupo-sugestoes" className="text-base font-semibold">
                Sugestões de boleto agrupado
              </h3>
              {podeExecutar && onCompor ? (
                <Button size="sm" variant="outline" onClick={onCompor}>
                  <Layers aria-hidden />
                  Compor grupo manualmente
                </Button>
              ) : null}
            </div>
            {erroConfirmar ? (
              <p
                role="alert"
                className="rounded-lg border border-danger/40 bg-danger-subtle px-4 py-3 text-sm text-danger-foreground"
              >
                {erroConfirmar}
              </p>
            ) : null}
            {sugestoes.length === 0 ? (
              <EmptyState
                title="Nenhuma sugestão de boleto agrupado"
                description="Aparece quando um boleto paga, de uma vez, todos os títulos em aberto do credor que vencem no mesmo dia."
              />
            ) : (
              <div className="grid gap-3 lg:grid-cols-2">
                {sugestoes.map((s) => (
                  <article
                    key={chaveSugestao(s)}
                    aria-label={`Sugestão de boleto agrupado de ${s.credor ?? s.pesCod}`}
                    className="flex flex-col gap-3 rounded-lg border bg-card p-4"
                  >
                    <header className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <h4 className="text-sm font-semibold">{s.credor ?? s.pesCod}</h4>
                        <p className="text-xs text-muted-foreground">
                          Filial {s.filCod} · boleto{' '}
                          <span className="tabular-nums">{s.codbarMascarado ?? '—'}</span>
                        </p>
                      </div>
                      <dl className="text-right text-sm">
                        <dt className="sr-only">Valor do boleto</dt>
                        <dd className="font-medium tabular-nums">
                          {formatCentavos(s.valorBoletoCentavos)}
                        </dd>
                        <dt className="sr-only">Vencimento do boleto</dt>
                        <dd className="text-xs tabular-nums text-muted-foreground">
                          {formatDate(s.vencimentoBoleto)}
                        </dd>
                      </dl>
                    </header>
                    <ul className="flex flex-col gap-1 text-sm">
                      {s.titulos.map((t) => (
                        <li
                          key={`${t.filCod}:${t.docCod}:${t.titCod}`}
                          className="flex items-center justify-between gap-3"
                        >
                          <span className="tabular-nums">
                            {t.docCod}/{t.titCod}
                          </span>
                          <span className="tabular-nums">{formatCentavos(t.valorCentavos)}</span>
                        </li>
                      ))}
                    </ul>
                    <p className="text-sm">
                      Soma dos títulos:{' '}
                      <strong className="tabular-nums">
                        {formatCentavos(s.somaTitulosCentavos ?? 0)}
                      </strong>
                    </p>
                    {s.intercambiavel ? (
                      <p className="text-xs text-muted-foreground">{EXPLICACAO_INTERCAMBIAVEL}</p>
                    ) : null}
                    {s.confirmavel ? (
                      podeExecutar ? (
                        <div>
                          <Button
                            size="sm"
                            disabled={confirmando !== null}
                            aria-label={`Confirmar grupo de ${s.credor ?? s.pesCod}`}
                            onClick={() => void confirmar(s)}
                          >
                            {confirmando === chaveSugestao(s) ? <Spinner aria-hidden /> : null}
                            Confirmar
                          </Button>
                        </div>
                      ) : null
                    ) : (
                      <p className="text-sm text-warning-foreground">
                        Não confirmável: {resumoMotivosGrupo(s.motivos)}
                      </p>
                    )}
                  </article>
                ))}
              </div>
            )}
          </section>

          <section aria-labelledby="grupo-confirmados" className="flex flex-col gap-3">
            <h3 id="grupo-confirmados" className="text-base font-semibold">
              Boletos agrupados confirmados
            </h3>
            {grupos.length === 0 ? (
              <EmptyState
                title="Nenhum boleto agrupado confirmado"
                description="Ao confirmar uma sugestão ou compor um grupo à mão, ele aparece aqui, com a situação."
              />
            ) : (
              <Table>
                <caption className="sr-only">Boletos agrupados confirmados</caption>
                <TableHeader>
                  <TableRow>
                    <TableHead>Credor</TableHead>
                    <TableHead>Boleto</TableHead>
                    <TableHead className="text-right">Valor</TableHead>
                    <TableHead>Vencimento</TableHead>
                    <TableHead>Títulos</TableHead>
                    <TableHead>Situação</TableHead>
                    <TableHead className="text-right">
                      <span className="sr-only">Ações</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {grupos.map((g) => {
                    const orientacao = orientacaoSituacaoGrupo(g.situacao)
                    return (
                      <TableRow key={g.id}>
                        <TableCell className="font-medium">{g.credor ?? g.pesCod}</TableCell>
                        <TableCell className="tabular-nums">{g.codbarMascarado}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatCentavos(g.valorBoletoCentavos)}
                        </TableCell>
                        <TableCell className="tabular-nums">{formatDate(g.vencimentoBoleto)}</TableCell>
                        <TableCell className="tabular-nums">
                          {g.titulos.map((t) => `${t.docCod}/${t.titCod}`).join(', ')}
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-col items-start gap-1">
                            <SituacaoGrupoBadge situacao={g.situacao} />
                            {orientacao ? (
                              <span className="text-xs text-muted-foreground">{orientacao}</span>
                            ) : null}
                          </div>
                        </TableCell>
                        <TableCell className="text-right">
                          {podeExecutar ? (
                            <Button
                              size="sm"
                              variant="outline"
                              aria-label={`Anular grupo de ${g.credor ?? g.pesCod}`}
                              onClick={() => setAnulando(g)}
                            >
                              Anular
                            </Button>
                          ) : null}
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            )}
          </section>
        </>
      )}
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
            setAviso(
              [
                'Boleto agrupado anulado.',
                r.retiradoDoLoteId ? 'Os títulos saíram do lote em rascunho.' : '',
                r.avisoLoteComprometido?.mensagem ?? '',
              ]
                .filter(Boolean)
                .join(' '),
            )
            await carregar()
            await onAlterado?.()
          }}
        />
      ) : null}
    </div>
  )
}
