'use client'

import { AlertTriangle, CheckCircle2, ChevronDown, Download, FileText, Plus, Trash2 } from 'lucide-react'
import * as React from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  atualizarContaPagadora,
  atualizarModalidadeItem,
  baixarRemessa,
  cancelarLote,
  type ContaPagadora,
  fetchModalidadesDisponiveis,
  fetchContasPagadoras,
  finalizarLote,
  type GerarRemessaResult,
  gerarRemessa,
  type LotePagamento,
  marcarRetorno,
  type Modalidade,
  MODALIDADES,
  reabrirLote,
  removerItem,
  rotuloConta,
} from '@/lib/sispag'
import { formatBRL } from '@/lib/utils'

const fmtData = (ms?: number) =>
  ms != null ? new Date(ms).toLocaleDateString('pt-BR') : '—'

function StatusLoteBadge({ status }: { status: LotePagamento['status'] }) {
  if (status === 'FINALIZADO')
    return (
      <Badge variant="outline" className="border-warning/40 text-warning">
        aguardando retorno
      </Badge>
    )
  if (status === 'REMESSA_GERADA')
    return (
      <Badge variant="outline" className="border-info/40 text-info">
        remessa gerada
      </Badge>
    )
  if (status === 'BAIXADO')
    return (
      <Badge variant="outline" className="border-success/40 text-success">
        baixado
      </Badge>
    )
  if (status === 'RETORNADO')
    return (
      <Badge variant="outline" className="border-success/40 text-success">
        de volta do Nexxera
      </Badge>
    )
  if (status === 'CANCELADO')
    return (
      <Badge variant="outline" className="text-muted-foreground">
        cancelado
      </Badge>
    )
  return (
    <Badge variant="outline" className="border-info/40 text-info">
      rascunho
    </Badge>
  )
}

type Acao = (
  // Recebe `opts` para que a própria ação possa ser repetida COM confirmação — é assim
  // que o toast do lote cancelado reexecuta exatamente a mesma chamada, só que aprovada.
  fn: (opts?: { confirmarNovoLote?: boolean }) => Promise<unknown>,
  okMsg: string | ((resultado: unknown) => { titulo: string; descricao?: string }),
) => void

/** Card de lote (colapsável): resumo sempre visível; os títulos expandem sob demanda. */
export function LoteCard({
  lote: l,
  busy,
  acao,
  onAdicionar,
}: {
  lote: LotePagamento
  busy: boolean
  acao: Acao
  onAdicionar?: (lote: LotePagamento) => void
}) {
  const [aberto, setAberto] = React.useState(false)
  const total = l.itens.reduce((acc, i) => acc + (i.valor ?? 0), 0)
  const isRascunho = l.status === 'RASCUNHO'
  const isFinalizado = l.status === 'FINALIZADO'
  // A2: revisão obrigatória — não finaliza enquanto houver item "a definir".
  // A coluna de retorno só aparece depois que houve conciliação — antes disso seria
  // uma coluna vazia em todo lote, ruído puro.
  // Contas pagadoras REAIS da filial (fin005). Antes era uma lista fixa de duas, o que
  // tornava impossível pagar favorecido de qualquer outro banco pela tela.
  const [contas, setContas] = React.useState<ContaPagadora[]>([])
  React.useEffect(() => {
    if (!isRascunho) return
    let vivo = true
    fetchContasPagadoras(l.filCod)
      .then((cs) => {
        if (vivo) setContas(cs)
      })
      .catch(() => {
        if (vivo) setContas([])
      })
    return () => {
      vivo = false
    }
  }, [isRascunho, l.filCod])

  const temConciliacao = l.itens.some((i) => i.retornoEvento != null)
  const faltaModalidade = l.itens.some((i) => !i.modalidade)

  // A2 opção B: formas disponíveis (cadastro do favorecido) por item, lidas ao vivo ao
  // expandir um RASCUNHO. Chave = docCod:titCod. Enquanto não carrega, o seletor oferece todas.
  const [disponiveis, setDisponiveis] = React.useState<Map<string, Modalidade[]> | null>(null)
  React.useEffect(() => {
    if (!aberto || !isRascunho) return
    let vivo = true
    fetchModalidadesDisponiveis(l.id)
      .then((itens) => {
        if (!vivo) return
        setDisponiveis(new Map(itens.map((i) => [`${i.docCod}:${i.titCod}`, i.modalidades])))
      })
      .catch(() => {
        if (vivo) setDisponiveis(new Map()) // falhou → oferece todas (fallback)
      })
    return () => {
      vivo = false
    }
  }, [aberto, isRascunho, l.id])

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 py-3">
        <button
          type="button"
          onClick={() => setAberto((v) => !v)}
          className="flex flex-1 items-center gap-2 text-left"
          aria-expanded={aberto}
        >
          <ChevronDown
            className={`size-4 shrink-0 text-muted-foreground transition-transform ${
              aberto ? 'rotate-180' : ''
            }`}
          />
          <StatusLoteBadge status={l.status} />
          {l.automatico ? (
            <Badge
              variant="outline"
              className="border-info/40 text-info"
              title="Formado automaticamente pelo cron — revise antes de aprovar."
            >
              automático
            </Badge>
          ) : null}
          <CardTitle className="text-sm font-medium">
            Filial {l.filCod} · {l.itens.length} título(s) · {formatBRL(total)}
            {l.conta ? ` · paga por ${l.banco ?? ''} ${l.conta}`.trimEnd() : ''}
          </CardTitle>
        </button>
        <div className="flex shrink-0 flex-wrap gap-1">
          {isRascunho ? (
            <>
              {onAdicionar ? (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() => onAdicionar(l)}
                  title="Adicionar mais títulos elegíveis a este lote"
                >
                  <Plus className="size-4" /> Adicionar título
                </Button>
              ) : null}
              <Button
                size="sm"
                disabled={busy || l.itens.length === 0 || faltaModalidade}
                title={
                  faltaModalidade
                    ? 'Defina a forma de pagamento de todos os títulos antes de finalizar.'
                    : undefined
                }
                onClick={() => acao(() => finalizarLote(l.id, l.versao), 'Lote finalizado')}
              >
                <CheckCircle2 className="size-4" /> Finalizar
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => acao(() => cancelarLote(l.id, l.versao), 'Lote cancelado')}
              >
                Cancelar
              </Button>
            </>
          ) : null}
          {isFinalizado ? (
            <>
              <Button
                size="sm"
                disabled={busy}
                title="Cria o lote no Conexos, importa os títulos, finaliza e gera o arquivo .REM."
                onClick={() =>
                  acao((o) => gerarRemessa(l.id, o), (r) => {
                    const res = r as GerarRemessaResult
                    if (res.status === 'dry-run') {
                      return {
                        titulo: 'Simulação (dry-run) — NADA foi criado no Conexos',
                        descricao:
                          'A escrita está desligada (CONEXOS_DRY_RUN). Nenhum lote nem arquivo existe no ERP.',
                      }
                    }
                    if (res.status === 'skipped') {
                      return {
                        titulo: 'Remessa já existia — nada foi gerado de novo',
                        descricao: `Lote nativo ${res.nativeFlpCod ?? '—'} no Conexos.`,
                      }
                    }
                    return {
                      titulo: `Remessa ${res.arquivo ?? ''} gerada`,
                      // Sem isto, quem gerou não sabe ONDE procurar no ERP — foi o que
                      // aconteceu no primeiro teste: sucesso na tela, e ninguém achava o lote.
                      descricao: `Lote nativo ${res.nativeFlpCod} · filial ${l.filCod} · remessa nº ${res.numRemessa ?? '—'}`,
                    }
                  })
                }
              >
                <FileText className="size-4" /> Gerar remessa (.REM)
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                title="Simula o retorno do Nexxera (o gatilho real é a conciliação do .RET)."
                onClick={() => acao(() => marcarRetorno(l.id, l.versao), 'Retorno do Nexxera registrado')}
              >
                <CheckCircle2 className="size-4" /> Marcar retorno recebido
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => acao(() => reabrirLote(l.id, l.versao), 'Lote reaberto')}
              >
                Reabrir
              </Button>
            </>
          ) : null}
          {l.remessaArquivo ? (
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              title={`Arquivo ${l.remessaArquivo} (remessa nº ${l.remessaNum ?? '—'}), lote nativo ${l.nativeFlpCod ?? '—'}`}
              onClick={() =>
                acao(async () => {
                  const { nome, conteudo } = await baixarRemessa(l.id)
                  // Blob local: o arquivo já veio do ERP, só entregamos ao navegador.
                  const url = URL.createObjectURL(
                    new Blob([conteudo], { type: 'text/plain;charset=latin1' }),
                  )
                  const a = document.createElement('a')
                  a.href = url
                  a.download = nome
                  a.click()
                  URL.revokeObjectURL(url)
                }, 'Arquivo baixado')
              }
            >
              <Download className="size-4" /> Baixar {l.remessaArquivo}
            </Button>
          ) : null}
        </div>
      </CardHeader>
      {aberto ? (
        <CardContent>
          {isRascunho ? (
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <span className="text-xs text-muted-foreground">Conta pagadora:</span>
              <Select
                value={l.conta ?? undefined}
                disabled={busy}
                onValueChange={(conta) => {
                  const opt = contas.find((c) => `${c.numeroConta}-${c.dvConta ?? ''}` === conta)
                  if (!opt || conta === l.conta) return
                  acao(
                    () =>
                      atualizarContaPagadora(l.id, {
                        versao: l.versao,
                        banco: rotuloConta(opt).split(' · ')[0],
                        conta,
                      }),
                    'Conta pagadora atualizada',
                  )
                }}
              >
                <SelectTrigger className="h-8 w-72" aria-label="Conta pagadora do lote">
                  <SelectValue placeholder="Selecione a conta" />
                </SelectTrigger>
                <SelectContent>
                  {contas.map((c) => (
                    <SelectItem
                      key={c.ccoCod}
                      value={`${c.numeroConta}-${c.dvConta ?? ''}`}
                    >
                      {rotuloConta(c)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {contas.length > 0 ? (
                <span className="text-[11px] text-muted-foreground">
                  {contas.length} contas da filial {l.filCod} · o favorecido só recebe se o banco
                  da conta pagadora for o mesmo da conta dele
                </span>
              ) : null}
            </div>
          ) : null}
          {l.itens.length === 0 ? (
            <p className="text-xs text-muted-foreground">Lote vazio.</p>
          ) : (
            <div className="overflow-x-auto rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Credor</TableHead>
                    <TableHead>Documento</TableHead>
                    <TableHead className="text-right">Valor</TableHead>
                    <TableHead>Vencimento</TableHead>
                    <TableHead>Forma de pgto.</TableHead>
                    {temConciliacao ? <TableHead>Retorno do banco</TableHead> : null}
                    {isRascunho ? <TableHead className="w-10" /> : null}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {l.itens.map((i) => {
                    // A2 opção B: formas disponíveis no cadastro do favorecido (ao vivo).
                    const avail = disponiveis?.get(`${i.docCod}:${i.titCod}`)
                    const carregou = avail !== undefined
                    const semCadastro = carregou && avail.length === 0
                    // Opções: se carregou e há disponíveis, só essas; senão todas (fallback).
                    const base = carregou && avail.length > 0
                      ? MODALIDADES.filter((m) => avail.includes(m.value))
                      : MODALIDADES
                    // Garante que a modalidade já escolhida apareça mesmo se ficou indisponível.
                    const opcoes =
                      i.modalidade && !base.some((m) => m.value === i.modalidade)
                        ? [...base, ...MODALIDADES.filter((m) => m.value === i.modalidade)]
                        : base
                    const indisponivel =
                      carregou && !!i.modalidade && !!avail && !avail.includes(i.modalidade)
                    return (
                    <TableRow key={`${i.docCod}:${i.titCod}`}>
                      <TableCell className="max-w-[16rem] truncate">{i.credor ?? '—'}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {i.docCod}/{i.titCod}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {i.valor != null ? formatBRL(i.valor) : '—'}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {fmtData(i.vencimento)}
                      </TableCell>
                      <TableCell>
                        {isRascunho ? (
                          <div className="flex flex-col gap-0.5">
                            <Select
                              value={i.modalidade ?? undefined}
                              disabled={busy}
                              onValueChange={(m) =>
                                acao(
                                  () =>
                                    atualizarModalidadeItem(l.id, {
                                      filCod: i.filCod,
                                      docCod: i.docCod,
                                      titCod: i.titCod,
                                      versao: l.versao,
                                      modalidade: m as (typeof MODALIDADES)[number]['value'],
                                    }),
                                  'Forma de pagamento atualizada',
                                )
                              }
                            >
                              <SelectTrigger
                                className={`h-8 w-40 ${i.modalidade && !indisponivel ? '' : 'border-warning/60 text-warning'}`}
                                aria-label="Forma de pagamento do título"
                              >
                                <SelectValue placeholder="A definir" />
                              </SelectTrigger>
                              <SelectContent>
                                {opcoes.map((m) => (
                                  <SelectItem key={m.value} value={m.value}>
                                    {m.label}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            {semCadastro ? (
                              <span className="text-xs text-warning">sem forma cadastrada</span>
                            ) : indisponivel ? (
                              <span className="text-xs text-warning">forma não cadastrada</span>
                            ) : null}
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground">
                            {MODALIDADES.find((m) => m.value === i.modalidade)?.label ?? '—'}
                          </span>
                        )}
                      </TableCell>
                      {temConciliacao ? (
                        <TableCell>
                          {i.retornoEvento ? (
                            <div className="flex flex-col gap-0.5">
                              <span
                                className={`text-xs font-medium ${i.rejeitado ? 'text-danger' : 'text-success'}`}
                              >
                                {i.rejeitado ? (
                                  <AlertTriangle className="mr-1 inline size-3" />
                                ) : (
                                  <CheckCircle2 className="mr-1 inline size-3" />
                                )}
                                {i.retornoEvento} · {i.retornoDescricao ?? '—'}
                              </span>
                              {/* borderô e baixa: o elo que o ERP não guarda consultável.
                                  Sem exibir aqui, ninguém consegue rastrear o pagamento. */}
                              {i.borCod ? (
                                <span className="text-[11px] text-muted-foreground tabular-nums">
                                  borderô {i.borCod}
                                  {i.bxaCodSeq ? ` · baixa ${i.bxaCodSeq}` : ''}
                                </span>
                              ) : null}
                            </div>
                          ) : (
                            <span className="text-xs text-muted-foreground">aguardando</span>
                          )}
                        </TableCell>
                      ) : null}
                      {isRascunho ? (
                        <TableCell>
                          <Button
                            size="icon"
                            variant="ghost"
                            disabled={busy}
                            aria-label="remover título"
                            onClick={() =>
                              acao(
                                () =>
                                  removerItem(l.id, {
                                    filCod: i.filCod,
                                    docCod: i.docCod,
                                    titCod: i.titCod,
                                  }),
                                'Título removido',
                              )
                            }
                          >
                            <Trash2 className="size-4" />
                          </Button>
                        </TableCell>
                      ) : null}
                    </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>
          )}
          {l.finalizadoPor ? (
            <p className="mt-2 text-xs text-muted-foreground">
              Finalizado por {l.finalizadoPor}
              {l.finalizadoEm ? ` em ${new Date(l.finalizadoEm).toLocaleString('pt-BR')}` : ''}.
              {isFinalizado ? ' Aguardando retorno do Nexxera.' : ''}
              {l.status === 'RETORNADO' ? ' Retorno do Nexxera recebido.' : ''}
            </p>
          ) : null}
        </CardContent>
      ) : null}
    </Card>
  )
}
