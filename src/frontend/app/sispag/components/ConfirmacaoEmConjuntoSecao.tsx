'use client'

import { AlertTriangle } from 'lucide-react'
import * as React from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
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
  type ChaveAnulacaoBoleto,
  type IrmaoConjunto,
  type IrmaosConjunto,
  type ResultadoConjunto,
  confirmarEmConjunto,
  fetchIrmaosConjunto,
} from '@/lib/sispag'
import { formatBRL } from '@/lib/utils'
import { DiferencaBadge } from './CandidatosBoletoDialog'
import { formatDeltaValor } from './sugestaoBoleto'

const chaveDaLinha = (l: { filCod: number; docCod: string; titCod: string; ddcCod: number; ditCod: number }) =>
  `${l.filCod}:${l.docCod}:${l.titCod}:${l.ddcCod}:${l.ditCod}`

/** Textos dos avisos por linha (I15t(5)). */
export const AVISO_CONJUNTO_TEXTO = {
  FAIXA_AJUSTE_MANUAL: {
    rotulo: 'ajuste manual',
    explicacao:
      'Diferença de centavos com o boleto vencendo depois do título: o ajuste automático não cobre este caso. Depois de confirmar, renegocie o valor no Conexos.',
  },
  ESCOLHIDO_SO_PELO_NUMERO: {
    rotulo: 'só pelo número',
    explicacao:
      'Há outro boleto do mesmo emissor com o mesmo valor e vencimento. Só o número do documento separa os dois: confira antes de marcar.',
  },
} as const

/**
 * Resumo do que vai ser confirmado (I15t(5)): quantos terão ajuste automático, quantos pedem
 * renegociação manual e quantos foram escolhidos só pelo número.
 */
export const resumoDaSelecao = (linhas: readonly IrmaoConjunto[]) => ({
  total: linhas.length,
  ajusteAutomatico: linhas.filter((l) => l.ajusteAutomatico).length,
  ajusteManual: linhas.filter((l) => l.avisos.includes('FAIXA_AJUSTE_MANUAL')).length,
  soPeloNumero: linhas.filter((l) => l.avisos.includes('ESCOLHIDO_SO_PELO_NUMERO')).length,
})

const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`

/**
 * Confirmação em conjunto de títulos irmãos (I15t, ADR-0080), dentro da gaveta de um título. Lista
 * os títulos do mesmo credor e filial cujo boleto foi escolhido pelo número do documento. Nada vem
 * marcado; cada linha confirmada passa pelo mesmo confirmar do servidor, e o resultado é por linha.
 */
export function ConfirmacaoEmConjuntoSecao({
  origem,
  podeExecutar,
  versao = 0,
  onDecidido,
}: {
  origem: ChaveAnulacaoBoleto
  podeExecutar: boolean
  /** Muda quando outra ação da gaveta decide algo: a lista é relida. */
  versao?: number
  onDecidido?: () => void | Promise<void>
}) {
  const chaveOrigem = `${origem.filCod}:${origem.docCod}:${origem.titCod}`
  const [estado, setEstado] = React.useState<{
    chave: string
    dados?: IrmaosConjunto
    erro?: string
  } | null>(null)
  const [releitura, setReleitura] = React.useState(0)
  const [marcadas, setMarcadas] = React.useState<{ chave: string; linhas: Set<string> }>({
    chave: chaveOrigem,
    linhas: new Set(),
  })
  const [resultado, setResultado] = React.useState<{
    chave: string
    r: ResultadoConjunto
  } | null>(null)
  const [confirmando, setConfirmando] = React.useState(false)

  React.useEffect(() => {
    let vivo = true
    fetchIrmaosConjunto(origem)
      .then((dados) => {
        if (vivo) setEstado({ chave: chaveOrigem, dados })
      })
      .catch((e: unknown) => {
        if (vivo)
          setEstado({
            chave: chaveOrigem,
            erro: e instanceof Error ? e.message : 'Falha ao consultar os títulos do fornecedor.',
          })
      })
    return () => {
      vivo = false
    }
    // `origem` é estável pela chave; reler quando a chave, a versão externa ou a releitura mudam.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chaveOrigem, versao, releitura])

  const atual = estado?.chave === chaveOrigem ? estado : null
  const dados = atual?.dados
  const selecao = marcadas.chave === chaveOrigem ? marcadas.linhas : new Set<string>()
  const resultadoAtual = resultado?.chave === chaveOrigem ? resultado.r : null

  if (atual === null) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Spinner /> Procurando outros títulos deste fornecedor…
      </div>
    )
  }
  if (atual.erro) {
    return (
      <p role="alert" className="text-sm text-muted-foreground">
        Não foi possível listar os outros títulos deste fornecedor: {atual.erro}{' '}
        <Button size="sm" variant="link" className="h-auto p-0" onClick={() => setReleitura((n) => n + 1)}>
          Tentar de novo
        </Button>
      </p>
    )
  }
  const irmaos = dados?.irmaos ?? []
  const maximo = dados?.maximo ?? 30
  // Só faz sentido com pelo menos um título além deste.
  if (!irmaos.some((l) => !l.origem) && resultadoAtual === null) return null

  const selecionadas = irmaos.filter((l) => selecao.has(chaveDaLinha(l)))
  const noLimite = selecao.size >= maximo
  const alternar = (l: IrmaoConjunto, marcar: boolean) => {
    const proximas = new Set(selecao)
    if (marcar) proximas.add(chaveDaLinha(l))
    else proximas.delete(chaveDaLinha(l))
    setMarcadas({ chave: chaveOrigem, linhas: proximas })
  }

  const confirmar = async () => {
    const r = await confirmarEmConjunto(origem, selecionadas)
    setResultado({ chave: chaveOrigem, r })
    setMarcadas({ chave: chaveOrigem, linhas: new Set() })
    setConfirmando(false)
    setReleitura((n) => n + 1)
    await onDecidido?.()
  }

  return (
    <section className="flex flex-col gap-2" aria-labelledby={`conjunto-${chaveOrigem}`}>
      <h3 id={`conjunto-${chaveOrigem}`} className="text-sm font-medium">
        Outros títulos deste fornecedor com número confiável
      </h3>
      <p className="text-xs text-muted-foreground">
        Cada título foi casado com o boleto de mesmo número.
        {podeExecutar
          ? ` Nada vem marcado: confira e marque os que quiser confirmar (até ${maximo} por vez).`
          : ''}
      </p>
      {resultadoAtual ? <ResultadoDoConjunto r={resultadoAtual} irmaos={irmaos} /> : null}
      {irmaos.length > 0 ? (
        <Table>
          <caption className="sr-only">Títulos do mesmo fornecedor com boleto de mesmo número</caption>
          <TableHeader>
            <TableRow>
              {podeExecutar ? (
                <TableHead scope="col" className="w-8">
                  <span className="sr-only">Marcar</span>
                </TableHead>
              ) : null}
              <TableHead scope="col">Título</TableHead>
              <TableHead scope="col">Boleto</TableHead>
              <TableHead scope="col">Diferença</TableHead>
              <TableHead scope="col">Avisos</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {irmaos.map((l) => {
              const k = chaveDaLinha(l)
              const marcada = selecao.has(k)
              return (
                <TableRow key={k} data-state={marcada ? 'selected' : undefined}>
                  {podeExecutar ? (
                    <TableCell>
                      <Checkbox
                        checked={marcada}
                        disabled={!marcada && noLimite}
                        onCheckedChange={(v) => alternar(l, v === true)}
                        aria-label={`Marcar o título ${l.docCod}/${l.titCod}`}
                      />
                    </TableCell>
                  ) : null}
                  <TableCell>
                    <div className="flex flex-col gap-0.5">
                      <span className="font-medium tabular-nums">
                        {l.docCod}/{l.titCod}
                        {l.origem ? (
                          <Badge variant="outline" className="ml-2">
                            este título
                          </Badge>
                        ) : null}
                      </span>
                      <span className="text-xs tabular-nums text-muted-foreground">
                        nº doc {l.numeroDocumento ?? '—'} · {formatBRL(l.valorTitulo)}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-col gap-0.5">
                      <span className="font-medium tabular-nums">nº {l.numeroBoleto ?? '—'}</span>
                      <span className="text-xs tabular-nums text-muted-foreground">
                        {formatBRL(l.valorBoleto)}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-col items-start gap-1">
                      <span className="text-xs tabular-nums">{formatDeltaValor(l.deltaValor)}</span>
                      <DiferencaBadge dias={l.deltaDias} />
                    </div>
                  </TableCell>
                  <TableCell>
                    <AvisosDaLinha linha={l} />
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      ) : null}
      {podeExecutar && irmaos.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" disabled={selecao.size === 0} onClick={() => setConfirmando(true)}>
            Confirmar selecionados ({selecao.size})
          </Button>
          {noLimite ? (
            <span className="text-xs text-muted-foreground">
              Limite de {maximo} títulos por vez.
            </span>
          ) : null}
        </div>
      ) : null}
      {confirmando ? (
        <ConfirmarConjuntoDialog
          linhas={selecionadas}
          onFechar={() => setConfirmando(false)}
          onConfirmar={confirmar}
        />
      ) : null}
    </section>
  )
}

function AvisosDaLinha({ linha }: { linha: IrmaoConjunto }) {
  if (linha.avisos.length === 0 && !linha.ajusteAutomatico) {
    return <span className="text-xs text-muted-foreground">—</span>
  }
  return (
    <div className="flex flex-col items-start gap-1">
      {linha.avisos.map((a) => (
        <Badge
          key={a}
          variant="outline"
          className="whitespace-normal border-warning/40 text-warning"
          title={AVISO_CONJUNTO_TEXTO[a].explicacao}
        >
          <AlertTriangle className="mr-1 size-3" aria-hidden />
          {AVISO_CONJUNTO_TEXTO[a].rotulo}
          <span className="sr-only"> — {AVISO_CONJUNTO_TEXTO[a].explicacao}</span>
        </Badge>
      ))}
      {linha.ajusteAutomatico ? (
        <Badge
          variant="outline"
          className="whitespace-normal border-info/40 text-info"
          title="Diferença de centavos no mesmo dia: o ajuste automático de centavos roda depois de confirmar."
        >
          ajuste automático
          <span className="sr-only"> de centavos, depois de confirmar</span>
        </Badge>
      ) : null}
    </div>
  )
}

function ResultadoDoConjunto({ r, irmaos }: { r: ResultadoConjunto; irmaos: readonly IrmaoConjunto[] }) {
  // A analista está no botão, no fim da lista: o resultado sobe à vista quando chega.
  const ref = React.useRef<HTMLDivElement>(null)
  React.useEffect(() => {
    ref.current?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' })
  }, [r])
  const recusadas = r.resultados.filter((x) => x.status === 'RECUSADA')
  const numeroDoc = (docCod: string, titCod: string) =>
    irmaos.find((l) => l.docCod === docCod && l.titCod === titCod)?.numeroDocumento
  return (
    <div
      ref={ref}
      role="status"
      className={
        recusadas.length > 0
          ? 'rounded-md border border-warning/40 bg-warning-subtle p-3 text-sm text-warning-foreground'
          : 'rounded-md border border-success/40 bg-success-subtle p-3 text-sm text-success-foreground'
      }
    >
      <p className="font-medium">
        {plural(r.confirmadas, 'título confirmado', 'títulos confirmados')}
        {recusadas.length > 0 ? `, ${plural(recusadas.length, 'recusado', 'recusados')}` : ''}.
      </p>
      {recusadas.length > 0 ? (
        <ul className="mt-1 list-disc space-y-0.5 pl-5">
          {recusadas.map((x) => {
            const doc = numeroDoc(x.chave.docCod, x.chave.titCod)
            return (
              <li key={chaveDaLinha(x.chave)}>
                <span className="tabular-nums">
                  {x.chave.docCod}/{x.chave.titCod}
                  {doc ? ` (nº doc ${doc})` : ''}
                </span>
                : {x.motivo ?? 'recusado'}
              </li>
            )
          })}
        </ul>
      ) : null}
    </div>
  )
}

function ConfirmarConjuntoDialog({
  linhas,
  onFechar,
  onConfirmar,
}: {
  linhas: readonly IrmaoConjunto[]
  onFechar: () => void
  /** Rejeita com a mensagem em português para o diálogo mostrar. */
  onConfirmar: () => Promise<void>
}) {
  const [erro, setErro] = React.useState<string | null>(null)
  const [salvando, setSalvando] = React.useState(false)
  const resumo = resumoDaSelecao(linhas)

  const enviar = async (e: React.FormEvent) => {
    e.preventDefault()
    if (salvando) return
    setErro(null)
    setSalvando(true)
    try {
      await onConfirmar()
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Não foi possível confirmar os títulos.')
      setSalvando(false)
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(aberto) => {
        if (!aberto && !salvando) onFechar()
      }}
    >
      <DialogContent size="sm">
        <form onSubmit={enviar} noValidate>
          <DialogHeader>
            <DialogTitle>
              Confirmar {plural(resumo.total, 'título', 'títulos')} de uma vez
            </DialogTitle>
            <DialogDescription>
              Cada título é conferido de novo no servidor antes de confirmar. Os que tiverem mudado
              voltam recusados, com o motivo; os outros são confirmados mesmo assim.
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="space-y-2 text-sm">
            <ul className="list-disc space-y-1 pl-5">
              {resumo.ajusteAutomatico > 0 ? (
                <li>
                  {plural(resumo.ajusteAutomatico, 'título terá', 'títulos terão')} o ajuste automático
                  de centavos (renegociação no Conexos), um por vez, depois de confirmar.
                </li>
              ) : null}
              {resumo.ajusteManual > 0 ? (
                <li className="text-warning-foreground">
                  {plural(resumo.ajusteManual, 'título precisa', 'títulos precisam')} de ajuste manual
                  no Conexos: diferença de centavos com o boleto vencendo depois.
                </li>
              ) : null}
              {resumo.soPeloNumero > 0 ? (
                <li className="text-warning-foreground">
                  {plural(resumo.soPeloNumero, 'título foi escolhido', 'títulos foram escolhidos')} só
                  pelo número: há boletos idênticos do mesmo emissor.
                </li>
              ) : null}
              {resumo.ajusteAutomatico === 0 ? <li>Nada é escrito no Conexos.</li> : null}
            </ul>
            {erro ? (
              <p role="alert" className="text-destructive">
                {erro}
              </p>
            ) : null}
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onFechar} disabled={salvando}>
              Cancelar
            </Button>
            <Button type="submit" disabled={salvando}>
              {salvando ? <Spinner /> : null}
              Confirmar {plural(resumo.total, 'título', 'títulos')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
