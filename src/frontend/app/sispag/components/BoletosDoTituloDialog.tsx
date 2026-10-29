'use client'

import * as React from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Drawer } from '@/components/ui/drawer'
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
import { formatBRL } from '@/lib/utils'
import {
  type AjusteCentavos,
  type BoletoDdaDoTitulo,
  type BoletosDdaDoTitulo,
  type DesfechoTituloBoleto,
  type ModoAjusteCentavos,
  type SugestaoBoleto,
  type TituloSemBoleto,
  fetchAjustesCentavos,
  fetchBoletosDdaDoTitulo,
} from '@/lib/sispag'
import { SITUACAO_BADGE } from './BoletosDdaTab'
import { DiferencaBadge, fmtCivil } from './CandidatosBoletoDialog'
import { ConfirmacaoEmConjuntoSecao } from './ConfirmacaoEmConjuntoSecao'
import { SugestaoBoletoPainel } from './SugestaoBoletoPainel'

function TabelaBoletos({ linhas, mostrarLigacao }: { linhas: BoletoDdaDoTitulo[]; mostrarLigacao: boolean }) {
  return (
    <Table>
      <caption className="sr-only">
        {mostrarLigacao
          ? 'Outros boletos DDA com o mesmo valor'
          : 'Boletos DDA candidatos do título'}
      </caption>
      <TableHeader>
        <TableRow>
          <TableHead scope="col">Boleto</TableHead>
          <TableHead scope="col" className="text-right">
            Valor
          </TableHead>
          <TableHead scope="col">Vencimento</TableHead>
          <TableHead scope="col">Diferença</TableHead>
          <TableHead scope="col">Situação</TableHead>
          {mostrarLigacao ? <TableHead scope="col">Ligado a</TableHead> : null}
        </TableRow>
      </TableHeader>
      <TableBody>
        {linhas.map(({ boleto: b, diferencaDias }) => {
          const badge = SITUACAO_BADGE[b.situacao]
          return (
            <TableRow key={`${b.ddcCod}:${b.ditCod}`}>
              <TableCell>
                <div className="flex flex-col gap-0.5">
                  <span className="font-medium tabular-nums">{b.numero ?? '—'}</span>
                  <span className="text-xs text-muted-foreground">fin124 #{b.ddcCod}</span>
                </div>
              </TableCell>
              <TableCell className="text-right tabular-nums">{formatBRL(b.valor)}</TableCell>
              <TableCell className="tabular-nums">{fmtCivil(b.vencimento)}</TableCell>
              <TableCell>
                <DiferencaBadge dias={diferencaDias} />
              </TableCell>
              <TableCell>
                <Badge variant="outline" className={badge.className} title={badge.title}>
                  {badge.label}
                </Badge>
              </TableCell>
              {mostrarLigacao ? (
                <TableCell className="text-xs text-muted-foreground">
                  {b.vinculo
                    ? `${b.vinculo.credor ?? '—'} · ${b.vinculo.docCod}/${b.vinculo.titCod} (fil ${b.vinculo.filCod})`
                    : '—'}
                </TableCell>
              ) : null}
            </TableRow>
          )
        })}
      </TableBody>
    </Table>
  )
}

/**
 * Boletos DDA de UM título que ficou sem associação. Reúne o que a aba "Boletos DDA" mostra,
 * filtrado pelo título: o que o Conexos lista como candidato dele e os boletos de mesmo valor com
 * outra data — onde costuma estar o problema (o Conexos associa por valor, fornecedor e data, e
 * uma diferença de dias basta para não casar).
 *
 * Gaveta lateral NÃO modal: a tabela de títulos fica visível e clicável ao lado; abrir outro
 * título com a gaveta aberta troca o conteúdo. O cabeçalho traz o nº do documento do fornecedor
 * (`doc_esp_numero`), que é o que a âncora "número do boleto igual ao do documento" compara.
 */
export function BoletosDoTituloDialog({
  titulo,
  onClose,
  sugestoes = [],
  desfecho,
  sincronizadoEm,
  onAbrirBoletosDda,
  podeExecutar = false,
  podeCopiar = false,
  ddaDefasadoHoras,
  onDecidido,
  vinculadoEmLoteVivo = false,
}: {
  /** O item do título tem o código vinculado num lote vivo (ADR-0071, I17l). */
  vinculadoEmLoteVivo?: boolean
  titulo: TituloSemBoleto | null
  onClose: () => void
  /** Sugestões (ADR-0068) deste título; vazio = a seção nem aparece. */
  sugestoes?: SugestaoBoleto[]
  /** Desfecho do título (ADR-0072); com ele a seção aparece até para "sem boleto no pool". */
  desfecho?: DesfechoTituloBoleto | undefined
  sincronizadoEm?: number | undefined
  onAbrirBoletosDda?: (() => void) | undefined
  podeExecutar?: boolean
  podeCopiar?: boolean
  ddaDefasadoHoras?: number | undefined
  onDecidido?: () => void | Promise<void>
}) {
  // O resultado guarda de QUE título é: ao trocar de título, o resultado antigo deixa de valer
  // sem precisar zerar estado dentro do efeito.
  const [resultado, setResultado] = React.useState<{
    chave: string
    dados?: BoletosDdaDoTitulo
    erro?: string
  } | null>(null)

  const [tentativa, setTentativa] = React.useState(0)

  // Ajuste de centavos (ADR-0074): modo da filial e o estado do ajuste deste título. Falha de
  // leitura não esconde nada da sugestão — só deixa o selo do ajuste de fora.
  const [ajuste, setAjuste] = React.useState<{
    chave: string
    modo: ModoAjusteCentavos
    ajuste?: AjusteCentavos
  } | null>(null)
  const [versaoAjuste, setVersaoAjuste] = React.useState(0)
  const chaveAjuste = titulo?.filCod !== undefined ? `${titulo.filCod}:${titulo.docCod}:${titulo.titCod}` : null
  React.useEffect(() => {
    if (!titulo || titulo.filCod === undefined || chaveAjuste === null) return
    let vivo = true
    fetchAjustesCentavos(titulo.filCod)
      .then((r) => {
        if (!vivo) return
        const doTitulo = r.ajustes.find(
          (a) =>
            a.docCod === titulo.docCod &&
            (a.titCodOrigem === titulo.titCod || a.titCodNovo === titulo.titCod),
        )
        setAjuste({ chave: chaveAjuste, modo: r.modo, ...(doTitulo ? { ajuste: doTitulo } : {}) })
      })
      .catch(() => undefined)
    return () => {
      vivo = false
    }
  }, [titulo, chaveAjuste, versaoAjuste])
  const ajusteAtual = ajuste !== null && ajuste.chave === chaveAjuste ? ajuste : null
  const chave = titulo ? `${titulo.filCod ?? ''}:${titulo.docCod}:${titulo.titCod}` : null
  React.useEffect(() => {
    if (!titulo || chave === null) return
    let vivo = true
    fetchBoletosDdaDoTitulo(titulo)
      .then((dados) => {
        if (vivo) setResultado({ chave, dados })
      })
      .catch((e: unknown) => {
        if (vivo)
          setResultado({
            chave,
            erro: e instanceof Error ? e.message : 'Falha ao consultar os boletos DDA',
          })
      })
    return () => {
      vivo = false
    }
  }, [titulo, chave, tentativa])

  const atual = resultado !== null && resultado.chave === chave ? resultado : null
  const dados = atual?.dados ?? null
  const erro = atual?.erro ?? null

  const vazio = dados !== null && dados.doTitulo.length === 0 && dados.mesmoValor.length === 0
  const numeroDocumento =
    titulo?.numeroDocumento ??
    desfecho?.numeroDocumento ??
    sugestoes.find((x) => x.numeroDocumento !== undefined)?.numeroDocumento
  return (
    <Drawer.Root
      open={titulo !== null}
      onOpenChange={(open) => (!open ? onClose() : undefined)}
      modal={false}
      size="md"
      focusKey={chave ?? undefined}
      // Abaixo do cabeçalho do app (`AppShellHeader`, h-14, sticky z-50): a gaveta não modal
      // convive com a página, e o cabeçalho não pode cobrir o título dela.
      // Entre xl e 2xl a gaveta estreita para `--drawer-detail-width` (480px) e a tabela atrás
      // termina onde ela começa: Credor…Forma de pagamento (o gatilho da troca) ficam à vista.
      className="top-14 h-auto xl:max-2xl:max-w-[var(--drawer-detail-width)]"
    >
      {titulo ? (
        <>
          <Drawer.Header>
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <Drawer.Title>
                Boletos DDA do título {titulo.docCod}/{titulo.titCod}
              </Drawer.Title>
              {titulo.credor ? (
                <p className="truncate text-sm font-medium" title={titulo.credor}>
                  {titulo.credor}
                </p>
              ) : null}
              <Drawer.Description asChild>
                <div className="flex flex-col gap-1">
                  <p className="text-sm tabular-nums text-foreground">
                    Título {titulo.docCod}/{titulo.titCod} ·{' '}
                    <span className="font-semibold">nº documento {numeroDocumento ?? '—'}</span>
                    {' · '}
                    {titulo.valor !== undefined ? formatBRL(titulo.valor) : 'valor desconhecido'}
                    {titulo.vencimento ? ` · vence ${fmtCivil(titulo.vencimento)}` : ''}
                    {titulo.filCod !== undefined ? ` · filial ${titulo.filCod}` : ''}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    O Conexos liga o boleto ao título sozinho, por valor, fornecedor e data. Uma
                    diferença de dias entre o vencimento do boleto e o do título costuma impedir a
                    ligação.
                  </p>
                </div>
              </Drawer.Description>
            </div>
            <Drawer.CloseButton />
          </Drawer.Header>
          <Drawer.Body className="flex flex-col gap-4">
            {sugestoes.length > 0 || desfecho !== undefined ? (
              <SugestaoBoletoPainel
                sugestoes={sugestoes}
                desfecho={desfecho}
                sincronizadoEm={sincronizadoEm}
                onAbrirBoletosDda={onAbrirBoletosDda}
                podeExecutar={podeExecutar}
                podeCopiar={podeCopiar}
                ddaDefasadoHoras={ddaDefasadoHoras}
                itemVinculadoEmLoteVivo={vinculadoEmLoteVivo}
                ajusteCentavos={ajusteAtual?.ajuste}
                modoAjusteCentavos={ajusteAtual?.modo}
                onDecidido={async () => {
                  setVersaoAjuste((n) => n + 1)
                  await onDecidido?.()
                }}
              />
            ) : null}
            {titulo.filCod !== undefined && desfecho !== undefined ? (
              // Confirmação em conjunto (I15t, ADR-0080): irmãos do mesmo credor e filial escolhidos
              // pelo número; some sozinha quando não há nenhum além deste título.
              <ConfirmacaoEmConjuntoSecao
                origem={{ filCod: titulo.filCod, docCod: titulo.docCod, titCod: titulo.titCod }}
                podeExecutar={podeExecutar}
                versao={versaoAjuste}
                onDecidido={async () => {
                  setVersaoAjuste((n) => n + 1)
                  await onDecidido?.()
                }}
              />
            ) : null}
            {erro ? (
              <div role="alert">
                <EmptyState
                  title="Não foi possível consultar os boletos DDA"
                  description={erro}
                  action={
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setResultado(null)
                        setTentativa((n) => n + 1)
                      }}
                    >
                      Tentar de novo
                    </Button>
                  }
                />
              </div>
            ) : dados === null ? (
              // O Spinner já expõe role=status com o rótulo "Loading".
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Spinner /> Consultando os boletos DDA…
              </div>
            ) : vazio ? (
              <EmptyState
                title="Nenhum boleto DDA com este valor"
                description="Confira se o arquivo DDA deste boleto já foi importado (fin124) e se o valor do título bate com o do boleto."
              />
            ) : (
              <>
                {dados.doTitulo.length > 0 ? (
                  <section className="flex flex-col gap-2">
                    <h3 className="text-sm font-medium">Candidatos deste título</h3>
                    <TabelaBoletos linhas={dados.doTitulo} mostrarLigacao={false} />
                  </section>
                ) : null}
                {dados.mesmoValor.length > 0 ? (
                  <section className="flex flex-col gap-2">
                    <h3 className="text-sm font-medium">Outros boletos com o mesmo valor</h3>
                    <p className="text-xs text-muted-foreground">
                      Não estão ligados a este título. Se o vencimento diferir por poucos dias,
                      é provável que seja o boleto dele.
                    </p>
                    <TabelaBoletos linhas={dados.mesmoValor} mostrarLigacao />
                  </section>
                ) : null}
              </>
            )}
          </Drawer.Body>
        </>
      ) : null}
    </Drawer.Root>
  )
}
