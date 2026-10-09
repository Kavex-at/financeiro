'use client'

import * as React from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Spinner } from '@/components/ui/spinner'
import {
  type BuscaFavorecidos,
  buscarFavorecidos,
  type FavorecidoAutorizado,
  type FavorecidoEncontrado,
  type ModalidadeAutorizavel,
  type OrigemSolicitacao,
  type PreviaDestino,
  pedirAutorizacao,
  previaDestinoFavorecido,
  ROTULO_ESTADO_AUTORIZACAO,
} from '@/lib/sispag'

export interface PedidoInicial {
  pesCod?: string
  credor?: string
  modalidade?: ModalidadeAutorizavel
  filCod?: number
}

const DEBOUNCE_BUSCA_MS = 350
const MODALIDADES: ModalidadeAutorizavel[] = ['TED', 'PIX']

/** `pesVldStatus` do Conexos. Ativo (1) não ganha selo. */
const ROTULO_SITUACAO: Record<number, string> = {
  2: 'Inativo',
  3: 'Em cadastro',
  4: 'Bloqueado',
  5: 'Não vender',
}

/** Bloqueado e "não vender" pesam mais que inativo/em cadastro. */
const TOM_SITUACAO: Record<number, string> = {
  4: 'border-danger/40 bg-danger-subtle text-danger-foreground',
  5: 'border-danger/40 bg-danger-subtle text-danger-foreground',
}
const TOM_AVISO = 'border-warning/40 bg-warning-subtle text-warning-foreground'

/** Selo da situação; código fora do mapa aparece como número em vez de sumir. */
const situacaoDe = (n?: number): { rotulo: string; tom: string } | undefined => {
  if (n === undefined || n === 1) return undefined
  return { rotulo: ROTULO_SITUACAO[n] ?? `Situação ${n}`, tom: TOM_SITUACAO[n] ?? TOM_AVISO }
}

/** "TED autorizado · PIX pendente" — só as modalidades com autorização vigente ou decidida. */
const autorizacoesDe = (f: FavorecidoEncontrado): string[] =>
  MODALIDADES.flatMap((m) => {
    const estado = f.autorizacao[m].estado
    return estado === 'NENHUMA' ? [] : [`${m} ${ROTULO_ESTADO_AUTORIZACAO[estado].toLowerCase()}`]
  })

/** Estados em que pedir de novo não faz nada: já há um pedido ou uma autorização valendo. */
const JA_VIGENTE = new Set(['PENDENTE', 'AUTORIZADO'])

/** Texto curto: só dígitos/pontuação é código ou documento; texto precisa de 3 letras. */
const buscavel = (termo: string): boolean => {
  const t = termo.trim()
  return /^[\d.\-/\s]+$/.test(t) ? t.length > 0 : t.length >= 3
}

const AVISO: Record<string, string> = {
  PIX_CHAVE_NAO_E_DOCUMENTO_DO_FAVORECIDO:
    'A chave PIX não é o CPF/CNPJ do favorecido. Quem aprovar vai conferir.',
}

/**
 * Pedir a autorização de um favorecido (F1, `sispag:executar`). Quem pede acha o favorecido no
 * cadastro do Conexos por nome, CPF/CNPJ ou código, sem abrir o Conexos, e vê o destino que o
 * cadastro tem, mascarado (I14l). Nunca nasce autorizado: outra pessoa, com
 * `sispag:autorizar_favorecido`, aprova depois, conferindo o destino.
 */
export function SolicitarAutorizacaoDialog({
  inicial,
  origem,
  onOpenChange,
  onSolicitada,
}: {
  inicial?: PedidoInicial
  origem: OrigemSolicitacao
  onOpenChange: (open: boolean) => void
  onSolicitada: (a: FavorecidoAutorizado) => void
}) {
  /** Veio pronto do item do lote ou do relatório: não há o que buscar. */
  const fixo = Boolean(inicial?.pesCod)
  const [escolhido, setEscolhido] = React.useState<{
    pesCod: string
    nome?: string
    encontrado?: FavorecidoEncontrado
  } | null>(inicial?.pesCod ? { pesCod: inicial.pesCod, ...(inicial.credor ? { nome: inicial.credor } : {}) } : null)
  const [modalidade, setModalidade] = React.useState<ModalidadeAutorizavel>(
    inicial?.modalidade ?? 'TED',
  )
  const [erro, setErro] = React.useState<string | null>(null)
  const [salvando, setSalvando] = React.useState(false)

  // --------------------------------------------------------------- busca
  const [termo, setTermo] = React.useState('')
  const [termoAplicado, setTermoAplicado] = React.useState('')
  const [busca, setBusca] = React.useState<{
    termo: string
    dados?: BuscaFavorecidos
    erro?: string
  } | null>(null)
  /** Último termo cuja busca deu certo (a lista em `busca` é dele). */
  const ultimaBuscaOk = React.useRef<string | null>(null)

  React.useEffect(() => {
    if (termo === termoAplicado) return
    const t = setTimeout(() => setTermoAplicado(termo), DEBOUNCE_BUSCA_MS)
    return () => clearTimeout(t)
  }, [termo, termoAplicado])

  React.useEffect(() => {
    if (fixo || escolhido || !buscavel(termoAplicado)) return
    const alvo = termoAplicado.trim()
    // "Trocar" volta ao mesmo termo: a lista que deu certo é reaproveitada. Erro não entra aqui,
    // e `busca` fica fora das dependências — senão um erro re-dispararia a busca sem parar.
    if (ultimaBuscaOk.current === alvo) return
    const ctrl = new AbortController()
    buscarFavorecidos(alvo, { signal: ctrl.signal })
      .then((dados) => {
        ultimaBuscaOk.current = alvo
        setBusca({ termo: alvo, dados })
      })
      .catch((e: unknown) => {
        if (ctrl.signal.aborted) return
        setBusca({ termo: alvo, erro: e instanceof Error ? e.message : 'Não foi possível buscar no Conexos.' })
      })
    return () => ctrl.abort()
  }, [termoAplicado, fixo, escolhido])

  const buscando = !fixo && !escolhido && buscavel(termoAplicado) && busca?.termo !== termoAplicado.trim()

  // --------------------------------------------------------------- prévia do destino
  const [previa, setPrevia] = React.useState<{ chave: string; dados?: PreviaDestino; erro?: string } | null>(null)
  const chavePrevia = escolhido ? `${escolhido.pesCod}:${modalidade}` : null

  React.useEffect(() => {
    if (!escolhido) return
    const ctrl = new AbortController()
    const chave = `${escolhido.pesCod}:${modalidade}`
    previaDestinoFavorecido(escolhido.pesCod, modalidade, { signal: ctrl.signal })
      .then((dados) => setPrevia({ chave, dados }))
      .catch((e: unknown) => {
        if (ctrl.signal.aborted) return
        setPrevia({ chave, erro: e instanceof Error ? e.message : 'Não foi possível ler o cadastro.' })
      })
    return () => ctrl.abort()
  }, [escolhido, modalidade])

  const previaAtual = previa && previa.chave === chavePrevia ? previa : null
  const semDado = previaAtual?.dados?.resultado === 'SEM_DADO'
  const carregandoPrevia = Boolean(escolhido) && !previaAtual
  const estadoDe = (m: ModalidadeAutorizavel) => escolhido?.encontrado?.autorizacao[m].estado
  const jaVigente = (m: ModalidadeAutorizavel) => JA_VIGENTE.has(estadoDe(m) ?? '')

  const escolher = (f: FavorecidoEncontrado) => {
    setErro(null)
    setEscolhido({ pesCod: f.pesCod, nome: f.nome, encontrado: f })
    const livre = MODALIDADES.find((m) => !JA_VIGENTE.has(f.autorizacao[m].estado))
    if (JA_VIGENTE.has(f.autorizacao[modalidade].estado) && livre) setModalidade(livre)
  }

  async function enviar(e: React.FormEvent) {
    e.preventDefault()
    if (salvando) return
    if (!escolhido) {
      setErro('Escolha o favorecido.')
      return
    }
    setErro(null)
    setSalvando(true)
    try {
      onSolicitada(
        await pedirAutorizacao({
          pesCod: escolhido.pesCod,
          ...(escolhido.nome ? { credor: escolhido.nome } : {}),
          modalidade,
          origem,
          // Só o atalho do item do lote traz a filial (a do lote); sem ela, o backend usa a do tenant.
          ...(inicial?.filCod !== undefined ? { filCod: inicial.filCod } : {}),
        }),
      )
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Não foi possível pedir a autorização.')
    } finally {
      setSalvando(false)
    }
  }

  const resultados = busca && busca.termo === termoAplicado.trim() ? busca : null

  return (
    <Dialog open onOpenChange={(aberto) => { if (!salvando) onOpenChange(aberto) }}>
      <DialogContent size="md">
        <form onSubmit={enviar} noValidate>
          <DialogHeader>
            <DialogTitle>Pedir autorização de favorecido</DialogTitle>
            <DialogDescription>
              O pedido fica pendente até outra pessoa aprovar, conferindo a conta ou a chave PIX
              do cadastro do Conexos.
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="space-y-4">
            {escolhido ? (
              <div className="flex items-start justify-between gap-3 rounded-lg border border-border px-4 py-3">
                <div className="min-w-0">
                  <p className="text-xs text-muted-foreground">Favorecido</p>
                  <p className="truncate font-medium">{escolhido.nome ?? `favorecido ${escolhido.pesCod}`}</p>
                  <p className="text-xs tabular-nums text-muted-foreground">
                    código {escolhido.pesCod}
                    {escolhido.encontrado?.documentoMascarado ? ` · ${escolhido.encontrado.documentoMascarado}` : ''}
                  </p>
                </div>
                {!fixo ? (
                  <Button type="button" variant="ghost" size="sm" onClick={() => setEscolhido(null)} disabled={salvando}>
                    Trocar
                  </Button>
                ) : null}
              </div>
            ) : (
              <div className="space-y-2">
                <Label htmlFor="pedido-busca">Favorecido</Label>
                <Input
                  id="pedido-busca"
                  type="search"
                  value={termo}
                  onChange={(e) => setTermo(e.target.value)}
                  placeholder="Nome, CNPJ/CPF ou código do Conexos"
                  aria-required="true"
                  autoComplete="off"
                  autoFocus
                />
                <ResultadosBusca
                  termo={termo}
                  buscando={buscando}
                  resultados={resultados}
                  onEscolher={escolher}
                />
              </div>
            )}

            <fieldset className="space-y-1.5" disabled={!escolhido}>
              <legend className="text-sm font-medium">Forma de pagamento</legend>
              <div className="flex flex-wrap gap-x-6 gap-y-1">
                {MODALIDADES.map((m) => {
                  const estado = estadoDe(m)
                  return (
                    <label key={m} className="inline-flex items-center gap-2 text-sm">
                      <input
                        type="radio"
                        name="pedido-modalidade"
                        value={m}
                        checked={modalidade === m}
                        disabled={jaVigente(m)}
                        onChange={() => setModalidade(m)}
                      />
                      {m}
                      {estado && estado !== 'NENHUMA' ? (
                        <span className="text-xs text-muted-foreground">
                          ({ROTULO_ESTADO_AUTORIZACAO[estado].toLowerCase()})
                        </span>
                      ) : null}
                    </label>
                  )
                })}
              </div>
            </fieldset>

            {escolhido && MODALIDADES.every(jaVigente) ? (
              <p className="text-sm text-muted-foreground">
                Este favorecido já tem pedido ou autorização para TED e PIX.
              </p>
            ) : null}
            {escolhido ? <PreviaDestinoBox modalidade={modalidade} previa={previaAtual} /> : null}

            {erro ? (
              <p role="alert" className="rounded-lg border border-danger/40 bg-danger-subtle px-4 py-3 text-sm text-danger-foreground">
                {erro}
              </p>
            ) : null}
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={salvando}>
              Voltar
            </Button>
            <Button type="submit" disabled={salvando || !escolhido || carregandoPrevia || semDado || jaVigente(modalidade)}>
              {salvando ? <Spinner aria-hidden /> : null}
              Pedir autorização
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function ResultadosBusca({
  termo,
  buscando,
  resultados,
  onEscolher,
}: {
  termo: string
  buscando: boolean
  resultados: { dados?: BuscaFavorecidos; erro?: string } | null
  onEscolher: (f: FavorecidoEncontrado) => void
}) {
  if (!buscavel(termo)) {
    return <p className="text-xs text-muted-foreground">Digite ao menos 3 letras, ou o CNPJ/CPF ou o código.</p>
  }
  if (buscando || !resultados) {
    return (
      <p className="flex items-center gap-2 text-xs text-muted-foreground" role="status">
        <Spinner className="size-3" aria-hidden /> Buscando no Conexos…
      </p>
    )
  }
  if (resultados.erro) {
    return (
      <p role="alert" className="text-sm text-danger-foreground">
        {resultados.erro}
      </p>
    )
  }
  const lista = resultados.dados?.favorecidos ?? []
  if (lista.length === 0) {
    return (
      <p className="text-sm text-muted-foreground" role="status">
        Nenhum favorecido encontrado no cadastro do Conexos.
      </p>
    )
  }
  return (
    <div className="space-y-1">
      <p className="sr-only" role="status">
        {lista.length === 1 ? '1 favorecido encontrado' : `${lista.length} favorecidos encontrados`}
      </p>
      <ul aria-label="Favorecidos encontrados" className="max-h-64 divide-y divide-border overflow-y-auto rounded-lg border border-border">
        {lista.map((f) => {
          const situacao = situacaoDe(f.situacao)
          const autorizacoes = autorizacoesDe(f)
          const rotulo = [
            `Escolher ${f.nome}`,
            `código ${f.pesCod}`,
            ...(f.documentoMascarado ? [`documento ${f.documentoMascarado}`] : []),
            ...(situacao ? [situacao.rotulo] : []),
            ...autorizacoes,
          ].join(', ')
          return (
            <li key={f.pesCod}>
              <button
                type="button"
                onClick={() => onEscolher(f)}
                className="flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left hover:bg-muted focus-visible:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                aria-label={rotulo}
              >
                <span className="flex w-full items-center gap-2">
                  <span className="truncate text-sm font-medium">{f.nome}</span>
                  {situacao ? (
                    <Badge variant="outline" className={situacao.tom}>
                      {situacao.rotulo}
                    </Badge>
                  ) : null}
                </span>
                {f.nomeFantasia && f.nomeFantasia !== f.nome ? (
                  <span className="truncate text-xs text-muted-foreground">{f.nomeFantasia}</span>
                ) : null}
                <span className="text-xs tabular-nums text-muted-foreground">
                  código {f.pesCod}
                  {f.documentoMascarado ? ` · ${f.documentoMascarado}` : ''}
                  {autorizacoes.map((a) => ` · ${a}`).join('')}
                </span>
              </button>
            </li>
          )
        })}
      </ul>
      {resultados.dados?.truncado ? (
        <p className="text-xs text-muted-foreground">Há mais resultados. Refine pelo nome completo ou pelo CNPJ.</p>
      ) : null}
    </div>
  )
}

function PreviaDestinoBox({
  modalidade,
  previa,
}: {
  modalidade: ModalidadeAutorizavel
  previa: { dados?: PreviaDestino; erro?: string } | null
}) {
  const oQue = modalidade === 'TED' ? 'conta' : 'chave PIX'
  if (!previa) {
    return (
      <p className="flex items-center gap-2 text-xs text-muted-foreground" role="status">
        <Spinner className="size-3" aria-hidden /> Lendo o cadastro do Conexos…
      </p>
    )
  }
  if (previa.erro || previa.dados?.resultado === 'FALHA_LEITURA') {
    return (
      <p className="rounded-lg border border-border bg-muted px-4 py-3 text-sm text-muted-foreground">
        Não foi possível ler a {oQue} no Conexos agora. O pedido pode seguir: quem aprovar lê de novo.
      </p>
    )
  }
  if (previa.dados?.resultado === 'SEM_DADO') {
    return (
      <p role="alert" className="rounded-lg border border-warning/40 bg-warning-subtle px-4 py-3 text-sm text-warning-foreground">
        O cadastro do Conexos não tem {oQue} para este favorecido. Peça ao responsável pelo cadastro
        no Conexos que informe a {oQue} antes de pedir a autorização.
      </p>
    )
  }
  return (
    <div className="space-y-1 rounded-lg border border-border px-4 py-3">
      <p className="text-xs text-muted-foreground">{modalidade === 'TED' ? 'Conta' : 'Chave PIX'} no cadastro do Conexos</p>
      <p className="text-sm font-medium tabular-nums">{previa.dados?.destinoMascarado ?? '—'}</p>
      {(previa.dados?.avisos ?? []).map((a) => (
        <p key={a} className="text-xs text-warning-foreground">
          {AVISO[a] ?? a}
        </p>
      ))}
    </div>
  )
}
