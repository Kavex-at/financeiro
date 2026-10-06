'use client'

import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  Copy,
  Download,
  FileText,
  Landmark,
  Plus,
  RefreshCcw,
  ShieldCheck,
  Trash2,
} from 'lucide-react'
import Link from 'next/link'
import * as React from 'react'
import { toast } from 'sonner'
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
  type AlertaItemLote,
  atualizarContaPagadora,
  atualizarModalidadeItem,
  baixarRemessa,
  cancelarLote,
  type ContaPagadora,
  ehDuplicidade,
  fetchLinhasDigitaveis,
  fetchModalidadesDisponiveis,
  fetchContasPagadoras,
  finalizarLote,
  formatCivilDate,
  formatErpDay,
  getRecursos,
  type ItemLote,
  type ItemSituacao,
  type LotePagamento,
  type Modalidade,
  MODALIDADES,
  MODALIDADES_OFERECIDAS,
  type OfertaModalidadesItem,
  pixPreferido,
  reabrirLote,
  type RecursosSispag,
  ROTULO_CANAL,
  removerItem,
  rotuloConta,
  STATUS_SINCRONIZAVEIS,
  sincronizarLote,
  type TituloSemBoleto,
  tituloDeItem,
  ultimaSincronizacao,
} from '@/lib/sispag'
import { BoletosDoTituloDialog } from './BoletosDoTituloDialog'
import { usePermissoes } from '@/lib/auth/PermissoesProvider'
import { useUsuarioAtual } from '@/lib/auth/AuthProvider'
import { baixarBlob } from '@/lib/download'
import { PERMISSAO } from '@/lib/permissoes'
import { formatBRL } from '@/lib/utils'
import { type AcaoLote, ConfirmarAcaoDialog, ConfirmarAcaoLoteDialog } from './ConfirmarAcaoDialog'
import { type Acao, GerarRemessaDialog } from './GerarRemessaDialog'
import { CadastrarExcecaoDialog } from '../excecoes/components/CadastrarExcecaoDialog'
import { ConferenciaLoteDialog } from './ConferenciaLoteDialog'
import { ResolverDuplicidadeDialog } from './ResolverDuplicidadeDialog'
import { rotuloVencimentoLote } from './loteDoTitulo'

const RECURSOS_DESLIGADOS: RecursosSispag = {
  tedEnabled: false,
  excecaoDestinoEnabled: false,
  pixEnabled: false,
}

/**
 * Itens TED/PIX (com a flag da modalidade ligada) cujo destino viria de lugar NENHUM — nem cadastro
 * do Conexos, nem exceção APROVADA. Desde a ADR-0063 (I10b revisado) isto é só AVISO: a escolha de
 * TED/PIX é livre e quem decide é a verificação do finalizar, que retira o item e abre a pendência
 * de cadastro (I13j). O backend é a autoridade.
 */
function itensSemDestino(
  itens: ItemLote[],
  oferta: Map<string, OfertaModalidadesItem> | null,
  recursos: RecursosSispag,
): ItemLote[] {
  if (!oferta || oferta.size === 0) return []
  return itens.filter((i) => {
    const alvo =
      (i.modalidade === 'TED' && recursos.tedEnabled) ||
      (i.modalidade === 'PIX' && recursos.pixEnabled)
    if (!alvo || !i.modalidade) return false
    const o = oferta.get(`${i.docCod}:${i.titCod}`)
    if (!o) return false
    const destino = o.destinos?.[i.modalidade as 'TED' | 'PIX']
    return destino ? destino.origem === 'NENHUM' : !o.modalidades.includes(i.modalidade)
  })
}

const nomesDosItens = (itens: ItemLote[]): string =>
  itens.map((i) => `${i.docCod}/${i.titCod}${i.credor ? ` (${i.credor})` : ''}`).join('; ')

/** D12: PIX antes de TED quando o favorecido tem chave CPF/CNPJ que é o próprio documento. */
function ordenarPixPrimeiro<T extends { value: Modalidade }>(opcoes: T[]): T[] {
  const pix = opcoes.filter((m) => m.value === 'PIX')
  if (pix.length === 0) return opcoes
  const resto = opcoes.filter((m) => m.value !== 'PIX')
  const iTed = resto.findIndex((m) => m.value === 'TED')
  if (iTed < 0) return opcoes
  return [...resto.slice(0, iTed), ...pix, ...resto.slice(iTed)]
}

const mensagemSemDestino = (itens: ItemLote[]): string =>
  `Sem conta (TED) ou chave PIX no cadastro do Conexos para: ${itens
    .map((i) => `${i.docCod}/${i.titCod}${i.credor ? ` (${i.credor})` : ''}`)
    .join('; ')}. Ao finalizar, a verificação retira esses itens do lote e abre uma pendência de cadastro. Corrija o cadastro no Conexos, peça uma exceção de destino (aprovada por outra pessoa) ou troque a forma de pagamento.`

/** Mesma pessoa? Comparação sem caixa nem espaço — espelho da regra do backend (I13l). */
const mesmaPessoa = (a?: string | null, b?: string | null): boolean =>
  !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase()

/** Quem montou/finalizou o lote não confere (I13l). A autoridade é o backend; isto só esconde. */
function participouDoLote(lote: LotePagamento, usuario: string | null): boolean {
  if (!usuario) return true
  return (
    mesmaPessoa(lote.finalizadoPor, usuario) ||
    lote.itens.some((i) => mesmaPessoa(i.incluidoPor, usuario)) ||
    (lote.automatico !== true && mesmaPessoa(lote.criadoPor, usuario))
  )
}

/**
 * Alertas da verificação TED/PIX de um item (ADR-0063) e o estado da verificação. Duplicidade
 * ABERTA barra o finalizar e oferece "Tratar" (só RASCUNHO, para quem executa); justificada mostra
 * o texto; canal habitual é só informativo.
 */
function AlertasDoItem({
  item,
  podeTratar,
  onTratar,
}: {
  item: ItemLote
  podeTratar: boolean
  onTratar: (alerta: AlertaItemLote) => void
}) {
  const alertas = item.alertas ?? []
  if (alertas.length === 0 && item.verificacaoEstado !== 'PENDENTE') return null
  const titulo = `${item.docCod}/${item.titCod}`
  return (
    <div className="flex flex-col gap-1">
      {item.verificacaoEstado === 'PENDENTE' ? (
        <Badge
          variant="outline"
          className="w-fit border-warning/40 text-warning"
          title="O Conexos não respondeu na verificação. O finalizar tenta de novo e barra se ainda não der."
        >
          verificação pendente
        </Badge>
      ) : null}
      {alertas.map((a) =>
        ehDuplicidade(a) ? (
          <div key={a.id} className="flex flex-wrap items-center gap-1">
            <Badge
              variant="outline"
              className={
                a.estado === 'ABERTA'
                  ? 'w-fit border-danger/40 bg-danger-subtle text-danger-foreground'
                  : 'w-fit text-muted-foreground'
              }
            >
              {a.estado === 'ABERTA' ? 'possível duplicidade' : 'duplicidade justificada'} · doc{' '}
              {a.contraparteDocCod ?? '—'}
            </Badge>
            {a.estado === 'ABERTA' && podeTratar ? (
              <Button
                type="button"
                variant="link"
                size="sm"
                className="h-auto p-0 text-xs"
                onClick={() => onTratar(a)}
                aria-label={`Tratar alerta de duplicidade do título ${titulo}`}
              >
                Tratar
              </Button>
            ) : null}
            {a.justificativa ? (
              <span className="w-full text-xs text-muted-foreground">“{a.justificativa}”</span>
            ) : null}
          </div>
        ) : (
          <Badge
            key={a.id}
            variant="outline"
            className="w-fit border-info/40 text-info"
            title="Pelo histórico, este favorecido costuma ser pago por outro canal. Não bloqueia; o conferente vê."
          >
            canal habitual: {ROTULO_CANAL[String(a.evidencia.grupoDominante)] ?? '—'}
          </Badge>
        ),
      )}
    </div>
  )
}

function StatusLoteBadge({ status }: { status: LotePagamento['status'] }) {
  if (status === 'FINALIZADO')
    return (
      <Badge variant="outline" className="border-warning/40 text-warning">
        aguardando remessa
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
      <Badge variant="outline" className="border-danger/40 bg-danger-subtle text-danger-foreground">
        rejeitado pelo banco
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

/** Rótulo e tom de cada situação do item (ADR-0055) — tokens semânticos do design system. */
const SITUACAO_ITEM: Record<ItemSituacao, { rotulo: string; classe: string }> = {
  PAGO: { rotulo: 'pago', classe: 'border-success/40 text-success' },
  AGENDADO: { rotulo: 'agendado', classe: 'border-info/40 text-info' },
  REJEITADO: { rotulo: 'rejeitado', classe: 'border-danger/40 text-danger' },
  SEM_RETORNO: { rotulo: 'sem retorno', classe: 'text-muted-foreground' },
}

const ORIGEM_BAIXA_ROTULO: Record<NonNullable<ItemLote['origemBaixa']>, string> = {
  REMESSA: 'pela remessa',
  FORA_DO_RETORNO: 'fora do retorno',
  NAO_IDENTIFICADA: 'origem não identificada',
}

/**
 * Situação do item derivada da baixa do título no Conexos (ADR-0055): pago, agendado no banco,
 * rejeitado ou ainda sem retorno — mais a trilha da baixa e a divergência, quando houver.
 */
function SituacaoDoItem({ item }: { item: ItemLote }) {
  if (!item.situacao) return <span className="text-xs text-muted-foreground">não sincronizado</span>
  const { rotulo, classe } = SITUACAO_ITEM[item.situacao]
  return (
    <div className="flex flex-col gap-0.5">
      <Badge variant="outline" className={`w-fit ${classe}`}>
        {rotulo}
      </Badge>
      {item.situacao === 'PAGO' && item.origemBaixa ? (
        <span className="text-xs text-muted-foreground tabular-nums">
          {ORIGEM_BAIXA_ROTULO[item.origemBaixa]}
          {item.borCod ? ` · borderô ${item.borCod}` : ''}
          {item.pagoEm ? ` · ${new Date(item.pagoEm).toLocaleDateString('pt-BR')}` : ''}
        </span>
      ) : null}
      {item.divergencia ? (
        <span className="flex items-start gap-1 text-xs font-medium text-danger">
          <AlertTriangle className="mt-0.5 size-3 shrink-0" aria-hidden />
          <span>Divergência: {item.divergenciaDetalhe ?? 'confira no Conexos'}</span>
        </span>
      ) : null}
    </div>
  )
}

/**
 * Destino de TED/PIX de um item (ADR-0054, ADR-0061). Mostra a MÁSCARA que veio da oferta do
 * backend: do cadastro do Conexos, ou o selo "exceção" quando o cadastro não tem destino e uma
 * exceção APROVADA assumiu. Sem destino nenhum, "sem destino: aguardando exceção" — com link para
 * a tela de exceções (e atalho de cadastro, em RASCUNHO) só para quem tem `sispag:excecao`. Não
 * há edição de destino no item: nunca recebe nem exibe o valor completo.
 */
function DestinoDoItem({
  item,
  oferta,
  semDestino,
  podeExcecao,
  excecaoHabilitada,
  busy,
  onCadastrarExcecao,
}: {
  item: ItemLote
  oferta?: OfertaModalidadesItem
  semDestino: boolean
  podeExcecao: boolean
  excecaoHabilitada: boolean
  busy: boolean
  /** Atalho "cadastrar exceção para este favorecido": só em RASCUNHO e para quem tem a permissão. */
  onCadastrarExcecao?: () => void
}) {
  const modalidade = item.modalidade === 'TED' || item.modalidade === 'PIX' ? item.modalidade : null
  const doItem = modalidade ? oferta?.destinos?.[modalidade] : undefined
  const titulo = `${item.docCod}/${item.titCod}`
  return (
    <div className="flex flex-wrap items-center gap-1">
      {doItem?.origem === 'EXCECAO' ? (
        <>
          <Badge
            variant="outline"
            className="border-warning/40 text-warning"
            title="O cadastro do Conexos não tem destino: vale a exceção aprovada por outra pessoa."
          >
            exceção
          </Badge>
          {doItem.destinoMascarado ? (
            <span className="text-xs tabular-nums text-muted-foreground">
              {doItem.destinoMascarado}
            </span>
          ) : null}
        </>
      ) : doItem?.origem === 'CADASTRO' && doItem.destinoMascarado ? (
        <span className="text-xs tabular-nums text-muted-foreground">
          cadastro: {doItem.destinoMascarado}
        </span>
      ) : null}
      {semDestino ? (
        <>
          <span className="text-xs text-warning">
            sem conta/chave no cadastro: sai do lote ao finalizar
          </span>
          {podeExcecao && excecaoHabilitada ? (
            <Link
              href="/sispag/excecoes"
              className="text-xs underline underline-offset-2"
              aria-label={`Abrir exceções de destino (título ${titulo})`}
            >
              ver exceções
            </Link>
          ) : null}
          {podeExcecao && excecaoHabilitada && onCadastrarExcecao ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-xs"
              disabled={busy}
              onClick={onCadastrarExcecao}
              aria-label={`Cadastrar exceção de destino para o favorecido do título ${titulo}`}
            >
              <Landmark className="size-3" aria-hidden />
              Cadastrar exceção
            </Button>
          ) : null}
        </>
      ) : null}
    </div>
  )
}

/** Card de lote (colapsável): resumo sempre visível; os títulos expandem sob demanda. */
export function LoteCard({
  lote: l,
  busy,
  acao,
  onAdicionar,
  destacado = false,
}: {
  lote: LotePagamento
  busy: boolean
  acao: Acao
  onAdicionar?: (lote: LotePagamento) => void
  /**
   * O usuário chegou aqui pelo link do lote na aba de títulos (ADR-0050): o card abre, rola até
   * a vista e ganha um anel de foco para ser achado na lista.
   */
  destacado?: boolean
}) {
  const [aberto, setAberto] = React.useState(false)
  // ADR-0053: toda ação do lote exige `sispag:executar`. Sem ela (ou enquanto carrega), as ações
  // SOMEM — nunca ficam desabilitadas (R11) — e as leituras reservadas a quem executa (contas
  // pagadoras, modalidades do favorecido, arquivo .REM) nem são pedidas. As linhas digitáveis
  // (conferir boleto) bastam `sispag:ver`.
  const { carregando: carregandoPermissoes, tem } = usePermissoes()
  const podeVer = !carregandoPermissoes && tem(PERMISSAO.SISPAG_VER)
  const podeExecutar = !carregandoPermissoes && tem(PERMISSAO.SISPAG_EXECUTAR)
  // ADR-0061: exceção de destino é permissão própria (cadastrar, aprovar, rejeitar, revogar).
  const podeExcecao = !carregandoPermissoes && tem(PERMISSAO.SISPAG_EXCECAO)
  // ADR-0063: conferência por 2ª pessoa. Escondida de quem montou/finalizou (o backend recusa).
  const usuario = useUsuarioAtual()
  const podeConferir =
    !carregandoPermissoes && tem(PERMISSAO.SISPAG_CONFERIR) && !participouDoLote(l, usuario)
  const [conferindo, setConferindo] = React.useState(false)
  const [tratando, setTratando] = React.useState<{ item: ItemLote; alerta: AlertaItemLote } | null>(
    null,
  )
  // ADR-0054/0061: flags de TED/PIX/exceção de destino. Desligadas (default e em falha) = tela de antes.
  const [recursos, setRecursos] = React.useState<RecursosSispag>(RECURSOS_DESLIGADOS)
  React.useEffect(() => {
    let vivo = true
    void getRecursos().then((r) => {
      if (vivo) setRecursos(r)
    })
    return () => {
      vivo = false
    }
  }, [])
  const [excecaoDe, setExcecaoDe] = React.useState<ItemLote | null>(null)
  // Título BOLETO sem DDA associado cujos boletos DDA a analista quer conferir.
  const [tituloDda, setTituloDda] = React.useState<TituloSemBoleto | null>(null)
  // "Gerar remessa" abre a confirmação com a data de débito (ADR-0049) em vez de chamar a API.
  const [gerandoRemessa, setGerandoRemessa] = React.useState(false)
  // As demais transições também passam por uma confirmação que nomeia o lote.
  const [confirmando, setConfirmando] = React.useState<AcaoLote | null>(null)
  const executar: Record<AcaoLote, () => void> = {
    finalizar: () => acao(() => finalizarLote(l.id, l.versao), 'Lote finalizado'),
    cancelar: () => acao(() => cancelarLote(l.id, l.versao), 'Lote cancelado'),
    reabrir: () => acao(() => reabrirLote(l.id, l.versao), 'Lote reaberto'),
  }

  const cardRef = React.useRef<HTMLDivElement>(null)
  // Abrir ao ganhar o destaque é ajuste de estado durante o render (padrão do React para
  // "reagir a uma prop"); só o scroll, que toca o DOM, fica no efeito.
  const [destacadoAntes, setDestacadoAntes] = React.useState(destacado)
  if (destacado !== destacadoAntes) {
    setDestacadoAntes(destacado)
    if (destacado) setAberto(true)
  }
  React.useEffect(() => {
    if (!destacado) return
    const reduzirMovimento = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    cardRef.current?.scrollIntoView({
      behavior: reduzirMovimento ? 'auto' : 'smooth',
      block: 'start',
    })
  }, [destacado])
  const total = l.itens.reduce((acc, i) => acc + (i.valor ?? 0), 0)
  // ADR-0064: o candidato diz de que dia é (o automático é um por filial × vencimento).
  const vencimento = l.status === 'RASCUNHO' ? rotuloVencimentoLote(l.itens) : undefined
  const isRascunho = l.status === 'RASCUNHO'
  const isFinalizado = l.status === 'FINALIZADO'
  const aguardandoConferencia = isFinalizado && l.exigeConferencia === true && !l.conferidoPor
  // ADR-0055: depois da remessa, o lote acompanha a baixa dos títulos no Conexos.
  const sincronizavel = STATUS_SINCRONIZAVEIS.includes(l.status)
  const isRetornado = l.status === 'RETORNADO'
  const sincronizadoEm = ultimaSincronizacao(l)
  // A2: revisão obrigatória — não finaliza enquanto houver item "a definir".
  // A coluna de retorno só aparece depois que houve conciliação — antes disso seria
  // uma coluna vazia em todo lote, ruído puro.
  // Contas pagadoras REAIS da filial (fin005). Antes era uma lista fixa de duas, o que
  // tornava impossível pagar favorecido de qualquer outro banco pela tela.
  const [contas, setContas] = React.useState<ContaPagadora[]>([])
  React.useEffect(() => {
    if (!isRascunho || !podeExecutar) return
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
  }, [isRascunho, l.filCod, podeExecutar])

  const temConciliacao = l.itens.some((i) => i.retornoEvento != null)
  const faltaModalidade = l.itens.some((i) => !i.modalidade)

  // A2 opção B: formas disponíveis (cadastro do favorecido) por item, lidas ao vivo ao
  // expandir um RASCUNHO. Chave = docCod:titCod. Enquanto não carrega, o seletor oferece todas.
  const [oferta, setOferta] = React.useState<Map<string, OfertaModalidadesItem> | null>(null)
  const disponiveis = React.useMemo(
    () =>
      oferta ? new Map([...oferta].map(([k, o]) => [k, o.modalidades] as [string, Modalidade[]])) : null,
    [oferta],
  )
  React.useEffect(() => {
    if (!aberto || !isRascunho || !podeExecutar) return
    let vivo = true
    fetchModalidadesDisponiveis(l.id)
      .then((itens) => {
        if (!vivo) return
        setOferta(new Map(itens.map((i) => [`${i.docCod}:${i.titCod}`, i])))
      })
      .catch(() => {
        if (vivo) setOferta(new Map()) // falhou → oferece todas (fallback)
      })
    return () => {
      vivo = false
    }
  }, [aberto, isRascunho, l.id, podeExecutar])

  const semDestino = itensSemDestino(l.itens, oferta, recursos)
  const semDestinoChaves = new Set(semDestino.map((i) => `${i.docCod}:${i.titCod}`))

  // Linha digitável do boleto por item, para a analista conferir com o banco. Só existe
  // depois da remessa gerada — o ERP anexa o código no import (ADR-0040), então em rascunho
  // nem chamamos. Buscado AQUI, na expansão, e não no clique: navegador bloqueia
  // `clipboard.writeText` chamado depois de um `await`.
  const [linhas, setLinhas] = React.useState<Map<string, string>>(new Map())
  // Boletos cujo código o backend recusou nos dígitos verificadores. Sem isto, um código
  // corrompido é indistinguível de "este título não é boleto": nos dois casos o botão some.
  const [linhasRecusadas, setLinhasRecusadas] = React.useState(0)
  React.useEffect(() => {
    // `GET .../linhas-digitaveis` basta `sispag:ver` no backend (ADR-0053).
    if (!aberto || isRascunho || !podeVer) return
    let vivo = true
    fetchLinhasDigitaveis(l.id)
      .then(({ itens, dropped }) => {
        if (!vivo) return
        setLinhas(new Map(itens.map((i) => [`${i.docCod}:${i.titCod}`, i.linhaDigitavel])))
        setLinhasRecusadas(dropped)
      })
      .catch(() => {
        if (!vivo) return
        setLinhas(new Map()) // sem linha → sem botão; nada quebra
        setLinhasRecusadas(0) // falha de leitura não afirma que algum código é inválido
      })
    return () => {
      vivo = false
    }
  }, [aberto, isRascunho, l.id, podeVer])

  /** Copia a linha digitável. O toast confirma sem repetir os 47 dígitos na tela. */
  const copiarLinha = async (linhaDigitavel: string, docCod: string, titCod: string) => {
    try {
      await navigator.clipboard.writeText(linhaDigitavel)
      toast.success('Linha digitável copiada', { description: `Título ${docCod}/${titCod}` })
    } catch {
      toast.error('Não foi possível copiar')
    }
  }

  return (
    <Card
      ref={cardRef}
      id={`lote-${l.id}`}
      className={[
        'scroll-mt-4',
        destacado ? 'ring-2 ring-ring' : '',
        isRetornado ? 'border-danger/40 bg-danger-subtle/30' : '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
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
          {aguardandoConferencia ? (
            <Badge
              variant="outline"
              className="border-warning/40 text-warning"
              title="Lote com TED/PIX: a remessa só sai depois da conferência por uma segunda pessoa."
            >
              aguardando conferência
            </Badge>
          ) : isFinalizado && l.conferidoPor ? (
            <Badge variant="outline" className="border-success/40 text-success">
              conferido
            </Badge>
          ) : null}
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
            {vencimento ? ` · ${vencimento}` : ''}
            {l.conta ? ` · paga por ${l.banco ?? ''} ${l.conta}`.trimEnd() : ''}
            {l.dataDebito ? ` · débito em ${formatCivilDate(l.dataDebito)}` : ''}
          </CardTitle>
          {sincronizavel && sincronizadoEm ? (
            <span className="text-xs text-muted-foreground">
              sincronizado em {new Date(sincronizadoEm).toLocaleString('pt-BR')}
            </span>
          ) : null}
        </button>
        <div className="flex shrink-0 flex-wrap gap-1">
          {isRascunho && podeExecutar ? (
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
                    : 'Verifica os itens TED/PIX (duplicidade, canal e dados de pagamento) e finaliza.'
                }
                onClick={() => setConfirmando('finalizar')}
              >
                <CheckCircle2 className="size-4" /> Finalizar
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => setConfirmando('cancelar')}
              >
                Cancelar
              </Button>
            </>
          ) : null}
          {isFinalizado && podeExecutar ? (
            <>
              <Button
                size="sm"
                disabled={busy || aguardandoConferencia}
                title={
                  aguardandoConferencia
                    ? 'Lote com TED/PIX: aguarde a conferência por uma segunda pessoa antes de gerar a remessa.'
                    : 'Escolha a data de débito; depois cria o lote no Conexos, importa os títulos, finaliza e gera o arquivo .REM.'
                }
                onClick={() => setGerandoRemessa(true)}
              >
                <FileText className="size-4" /> Gerar remessa (.REM)
              </Button>
              {gerandoRemessa ? (
                <GerarRemessaDialog
                  lote={l}
                  open
                  onOpenChange={setGerandoRemessa}
                  busy={busy}
                  acao={acao}
                />
              ) : null}
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => setConfirmando('reabrir')}
              >
                Reabrir
              </Button>
            </>
          ) : null}
          {aguardandoConferencia && podeConferir ? (
            <Button
              size="sm"
              disabled={busy}
              title="Conferir os pagamentos TED/PIX deste lote (segunda pessoa)."
              onClick={() => setConferindo(true)}
            >
              <ShieldCheck className="size-4" aria-hidden /> Conferir
            </Button>
          ) : null}
          {conferindo ? (
            <ConferenciaLoteDialog
              lote={l}
              onOpenChange={setConferindo}
              onConcluida={(atualizado, resultado) => {
                setConferindo(false)
                acao(
                  async () => atualizado,
                  resultado === 'conferido' ? 'Lote conferido' : 'Lote devolvido à analista',
                )
              }}
            />
          ) : null}
          {tratando ? (
            <ResolverDuplicidadeDialog
              lote={l}
              item={tratando.item}
              alerta={tratando.alerta}
              onOpenChange={(open) => {
                if (!open) setTratando(null)
              }}
              onResolvida={(atualizado, escolha) => {
                setTratando(null)
                acao(
                  async () => atualizado,
                  escolha === 'RETIRAR'
                    ? 'Título retirado do lote e bloqueado — cancele o documento duplicado no Conexos'
                    : 'Duplicidade justificada',
                )
              }}
            />
          ) : null}
          <BoletosDoTituloDialog titulo={tituloDda} onClose={() => setTituloDda(null)} />
          {excecaoDe ? (
            <CadastrarExcecaoDialog
              favorecido={{
                filCod: excecaoDe.filCod,
                docCod: excecaoDe.docCod,
                titCod: excecaoDe.titCod,
                ...(excecaoDe.credor ? { credor: excecaoDe.credor } : {}),
              }}
              tedEnabled={recursos.tedEnabled}
              pixEnabled={recursos.pixEnabled}
              preferirPix={pixPreferido(oferta?.get(`${excecaoDe.docCod}:${excecaoDe.titCod}`))}
              onOpenChange={(open) => {
                if (!open) setExcecaoDe(null)
              }}
              onCadastrada={() => {
                setExcecaoDe(null)
                toast.success('Exceção cadastrada: aguarda a aprovação de outra pessoa')
              }}
            />
          ) : null}
          {confirmando ? (
            <ConfirmarAcaoLoteDialog
              lote={l}
              acao={confirmando}
              onOpenChange={(open) => {
                if (!open) setConfirmando(null)
              }}
              busy={busy}
              onConfirmar={executar[confirmando]}
            />
          ) : null}
          {sincronizavel && podeExecutar ? (
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              title="Relê no Conexos a baixa dos títulos deste lote e atualiza a situação de cada item. Só leitura no ERP."
              onClick={() => acao(() => sincronizarLote(l.id), 'Lote sincronizado')}
            >
              <RefreshCcw className="size-4" aria-hidden /> Sincronizar agora
            </Button>
          ) : null}
          {l.remessaArquivo && podeExecutar ? (
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              title={`Arquivo ${l.remessaArquivo} (remessa nº ${l.remessaNum ?? '—'}), lote nativo ${l.nativeFlpCod ?? '—'}`}
              onClick={() =>
                acao(async () => {
                  const { nome, arquivo } = await baixarRemessa(l.id)
                  // Os bytes do ERP vão direto ao navegador — sem string no meio, que
                  // reencodaria em UTF-8 e quebraria as colunas fixas do CNAB.
                  baixarBlob(arquivo, nome)
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
          {isRascunho && podeExecutar ? (
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
                    {sincronizavel ? <TableHead>Situação</TableHead> : null}
                    {temConciliacao ? <TableHead>Retorno do banco</TableHead> : null}
                    {isRascunho && podeExecutar ? <TableHead className="w-10" /> : null}
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
                      ? MODALIDADES_OFERECIDAS.filter((m) => avail.includes(m.value))
                      : MODALIDADES_OFERECIDAS
                    // Garante que a modalidade já escolhida apareça mesmo se ficou indisponível.
                    const ofertaDoItem = oferta?.get(`${i.docCod}:${i.titCod}`)
                    const comAtual =
                      i.modalidade && !base.some((m) => m.value === i.modalidade)
                        ? [...base, ...MODALIDADES.filter((m) => m.value === i.modalidade)]
                        : base
                    // D12: chave CPF/CNPJ do favorecido → PIX sugerido antes de TED.
                    const opcoes = pixPreferido(ofertaDoItem) ? ordenarPixPrimeiro(comAtual) : comAtual
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
                        {formatErpDay(i.vencimento)}
                      </TableCell>
                      <TableCell>
                        {isRascunho && podeExecutar ? (
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
                              <span className="text-xs text-warning">
                                {i.modalidade === 'BOLETO'
                                  ? 'sem boleto DDA — a remessa sairia sem código de barras'
                                  : 'forma não cadastrada'}
                              </span>
                            ) : null}
                            {i.modalidade === 'BOLETO' && indisponivel ? (
                              <Button
                                type="button"
                                variant="link"
                                size="sm"
                                className="h-auto p-0 text-xs"
                                onClick={() => setTituloDda(tituloDeItem(i))}
                              >
                                Ver boletos DDA
                              </Button>
                            ) : null}
                            {recursos.tedEnabled || recursos.pixEnabled ? (
                              <DestinoDoItem
                                item={i}
                                oferta={ofertaDoItem}
                                semDestino={semDestinoChaves.has(`${i.docCod}:${i.titCod}`)}
                                podeExcecao={podeExcecao}
                                excecaoHabilitada={recursos.excecaoDestinoEnabled}
                                busy={busy}
                                onCadastrarExcecao={() => setExcecaoDe(i)}
                              />
                            ) : null}
                            <AlertasDoItem
                              item={i}
                              podeTratar={podeExecutar && !busy}
                              onTratar={(alerta) => setTratando({ item: i, alerta })}
                            />
                          </div>
                        ) : (
                          <div className="flex flex-wrap items-center gap-1">
                            <span className="text-xs text-muted-foreground">
                              {MODALIDADES.find((m) => m.value === i.modalidade)?.label ?? '—'}
                            </span>
                            {recursos.excecaoDestinoEnabled &&
                            (i.modalidade === 'TED' || i.modalidade === 'PIX') ? (
                              <DestinoDoItem
                                item={i}
                                oferta={oferta?.get(`${i.docCod}:${i.titCod}`)}
                                semDestino={false}
                                podeExcecao={podeExcecao}
                                excecaoHabilitada={recursos.excecaoDestinoEnabled}
                                busy={busy}
                              />
                            ) : null}
                            {i.modalidade === 'BOLETO' &&
                            linhas.get(`${i.docCod}:${i.titCod}`) ? (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="size-6"
                                onClick={() =>
                                  void copiarLinha(
                                    linhas.get(`${i.docCod}:${i.titCod}`) ?? '',
                                    i.docCod,
                                    i.titCod,
                                  )
                                }
                                aria-label={`Copiar linha digitável do boleto do título ${i.docCod}/${i.titCod}`}
                                title="Copiar linha digitável do boleto"
                              >
                                <Copy className="size-3" aria-hidden />
                              </Button>
                            ) : null}
                            <AlertasDoItem item={i} podeTratar={false} onTratar={() => undefined} />
                          </div>
                        )}
                      </TableCell>
                      {sincronizavel ? (
                        <TableCell>
                          <SituacaoDoItem item={i} />
                        </TableCell>
                      ) : null}
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
                      {isRascunho && podeExecutar ? (
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
          {isRetornado ? (
            <div
              role="alert"
              className="mt-3 flex items-start gap-2 rounded-lg border border-danger/40 bg-danger-subtle px-4 py-3 text-sm text-danger-foreground"
            >
              <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
              <p>
                O banco rejeitou ao menos um título deste lote. Saneie o cadastro do favorecido e
                reenvie o título num lote novo.
              </p>
            </div>
          ) : null}
          {isRascunho && semDestino.length > 0 ? (
            <div
              role="status"
              className="mt-3 flex items-start gap-2 rounded-lg border border-warning/40 bg-warning-subtle px-4 py-3 text-sm text-warning-foreground"
            >
              <ShieldCheck className="mt-0.5 size-4 shrink-0" aria-hidden />
              <p>{mensagemSemDestino(semDestino)}</p>
            </div>
          ) : null}
          {linhasRecusadas > 0 ? (
            // `aria-live`: o aviso só aparece quando o fetch volta, depois de a expansão já
            // ter sido lida. Sem isso, quem usa leitor de tela não fica sabendo.
            <div
              role="alert"
              aria-live="polite"
              className="mt-3 flex items-start gap-2 rounded-lg border border-warning/40 bg-warning-subtle px-4 py-3 text-sm text-warning-foreground"
            >
              <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
              <p>
                {linhasRecusadas === 1
                  ? '1 boleto veio com linha digitável inválida e não pode ser copiado.'
                  : `${linhasRecusadas} boletos vieram com linha digitável inválida e não podem ser copiados.`}{' '}
                Confira o código direto no Conexos antes de pagar.
              </p>
            </div>
          ) : null}
          {isRascunho && l.motivoDevolucao ? (
            <div
              role="status"
              className="mt-3 flex items-start gap-2 rounded-lg border border-warning/40 bg-warning-subtle px-4 py-3 text-sm text-warning-foreground"
            >
              <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
              <p>
                Devolvido na conferência por {l.devolvidoPor ?? '—'}
                {l.devolvidoEm ? ` em ${new Date(l.devolvidoEm).toLocaleString('pt-BR')}` : ''}:{' '}
                {l.motivoDevolucao}
              </p>
            </div>
          ) : null}
          {l.conferidoPor ? (
            <p className="mt-2 text-xs text-muted-foreground">
              Conferido por {l.conferidoPor}
              {l.conferidoEm ? ` em ${new Date(l.conferidoEm).toLocaleString('pt-BR')}` : ''}.
            </p>
          ) : null}
          {l.finalizadoPor ? (
            <p className="mt-2 text-xs text-muted-foreground">
              Finalizado por {l.finalizadoPor}
              {l.finalizadoEm ? ` em ${new Date(l.finalizadoEm).toLocaleString('pt-BR')}` : ''}.
              {aguardandoConferencia
                ? ' Aguardando a conferência por uma segunda pessoa.'
                : isFinalizado
                  ? ' Aguardando a geração da remessa.'
                  : ''}
              {isRetornado ? ' O banco rejeitou ao menos um título.' : ''}
            </p>
          ) : null}
        </CardContent>
      ) : null}
    </Card>
  )
}
