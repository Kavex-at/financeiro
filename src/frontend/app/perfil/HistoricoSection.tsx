'use client'

import * as React from 'react'
import Link from 'next/link'
import { History } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
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
  type FiltrosHistorico,
  type FrenteAtividade,
  getHistorico,
  type LinhaHistorico,
  type StatusAtividade,
} from '@/lib/api/perfil'
import { usePermissoes } from '@/lib/auth/PermissoesProvider'
import { isSessionExpiredError } from '@/lib/http'
import { PERMISSAO, type Permissao } from '@/lib/permissoes'
import { formatBRL } from '@/lib/utils'
import { rotuloAlvo, separador } from './alvo'
import { momentoSp, tempoRelativo } from './periodo'
import { ErroSecao, SecaoPerfil } from './SecaoPerfil'

/** Filtros visíveis do histórico (o cursor é interno da seção). */
export type FiltrosHistoricoTela = Omit<FiltrosHistorico, 'cursor'>

const TODAS = 'todas'

const FRENTES: ReadonlyArray<{ valor: FrenteAtividade; rotulo: string }> = [
  { valor: 'permutas', rotulo: 'Permutas' },
  { valor: 'sispag', rotulo: 'SISPAG' },
  { valor: 'recebimentos', rotulo: 'Adiantamentos' },
  { valor: 'plataforma', rotulo: 'Plataforma' },
]

const STATUS: ReadonlyArray<{ valor: StatusAtividade; rotulo: string; classe: string }> = [
  { valor: 'sucesso', rotulo: 'Sucesso', classe: 'bg-success-subtle text-success-foreground' },
  { valor: 'erro', rotulo: 'Erro', classe: 'bg-danger-subtle text-danger-foreground' },
  { valor: 'em_andamento', rotulo: 'Em andamento', classe: 'bg-warning-subtle text-warning-foreground' },
  { valor: 'cancelado', rotulo: 'Cancelado', classe: 'bg-muted text-muted-foreground' },
  { valor: 'info', rotulo: 'Registro', classe: 'bg-info-subtle text-info-foreground' },
]

const ROTULO_FRENTE: Record<FrenteAtividade, string> = {
  permutas: 'Permutas',
  sispag: 'SISPAG',
  recebimentos: 'Adiantamentos',
  plataforma: 'Plataforma',
}

/** Ação → frase em português. O código vem do servidor; o texto mora aqui. */
const descreverAcao = (l: LinhaHistorico): string => {
  const outro = l.detalhe.outroUsername ?? 'outro usuário'
  switch (l.acao) {
    case 'baixa_permuta':
      return 'Baixa de permuta'
    case 'excecao_criada':
      return 'Marcou permutado fora do painel'
    case 'excecao_removida':
      return 'Desfez exceção de permuta'
    case 'lote_criado':
      return 'Criou lote'
    case 'lote_finalizado':
      return 'Finalizou lote'
    case 'destino_gravado':
      return 'Gravou destino de pagamento'
    case 'destino_aprovado':
      return 'Aprovou destino manual'
    case 'remessa_gerada':
      return 'Gerou remessa'
    case 'retorno_conciliado':
      return 'Conciliou retorno'
    case 'numerario_executado':
      return 'Executou solicitação de numerário'
    case 'alerta_reconhecido':
      return `Reconheceu alerta${l.detalhe.tipoAlerta ? ` (${l.detalhe.tipoAlerta})` : ''}`
    case 'acesso_alterado':
      return `Alterou acesso de ${outro}`
    case 'acesso_recebido':
      return `Seu acesso foi alterado por ${outro}`
    default:
      return l.acao
  }
}

/** Para onde o link da linha leva, e a permissão que o mostra (sem ela, só o id em texto). */
const destino = (l: LinhaHistorico): { href: string; nome: string; permissao: Permissao } | null => {
  switch (l.frente) {
    case 'permutas':
      return { href: '/permutas', nome: 'Permutas', permissao: PERMISSAO.PERMUTAS_VER }
    case 'sispag':
      return { href: '/sispag', nome: 'SISPAG', permissao: PERMISSAO.SISPAG_VER }
    case 'recebimentos':
      return { href: '/recebimentos', nome: 'Adiantamentos', permissao: PERMISSAO.RECEBIMENTOS_VER }
    case 'plataforma':
      if (l.alvoTipo === 'alerta') {
        return { href: '/operacao', nome: 'Operação', permissao: PERMISSAO.OPERACAO_VER }
      }
      if (l.alvoTipo === 'usuario') {
        return { href: '/usuarios', nome: 'Usuários', permissao: PERMISSAO.USUARIOS_GERENCIAR }
      }
      return null
  }
}

/**
 * Histórico das MINHAS ações nos ledgers (read model AtividadeUsuario). Mostra todas as ações do
 * usuário, mesmo de frentes cuja permissão ele perdeu (é a trilha dele); só o link para a frente
 * depende de `<frente>:ver`. Paginação por cursor opaco: o front nunca o decodifica.
 */
export function HistoricoSection({
  filtros,
  onFiltros,
  vinculo,
}: {
  filtros: FiltrosHistoricoTela
  onFiltros: (f: FiltrosHistoricoTela) => void
  /** Login Conexos do usuário, para dizer "assinado no ERP como X" quando a linha diverge. */
  vinculo: string | null
}) {
  const [carregandoMais, setCarregandoMais] = React.useState(false)
  const [tentativa, setTentativa] = React.useState(0)
  /**
   * Páginas carregadas, amarradas aos filtros que as pediram. Filtro novo = chave nova = cursor
   * novo: a página 1 é sempre recarregada do zero, e até ela chegar a seção mostra o skeleton.
   */
  const [resposta, setResposta] = React.useState<{
    chave: string
    itens: LinhaHistorico[]
    proximo?: string
    erro: string | null
  } | null>(null)
  const chave = `${JSON.stringify(filtros)}#${tentativa}`

  React.useEffect(() => {
    let vivo = true
    getHistorico({ ...filtros })
      .then((p) => {
        if (vivo) setResposta({ chave, itens: p.itens, proximo: p.proximoCursor, erro: null })
      })
      .catch((e: unknown) => {
        if (!vivo || isSessionExpiredError(e)) return
        setResposta({
          chave,
          itens: [],
          erro: e instanceof Error ? e.message : 'Não foi possível carregar o histórico.',
        })
      })
    return () => {
      vivo = false
    }
  }, [filtros, chave])

  const atual = resposta?.chave === chave ? resposta : null
  const carregando = atual === null
  const itens = atual?.itens ?? []
  const proximo = atual?.proximo
  const erro = atual?.erro ?? null

  const carregarMais = async () => {
    if (!proximo) return
    const chaveDoPedido = chave
    setCarregandoMais(true)
    try {
      const p = await getHistorico({ ...filtros, cursor: proximo })
      setResposta((r) =>
        r && r.chave === chaveDoPedido
          ? { ...r, itens: [...r.itens, ...p.itens], proximo: p.proximoCursor }
          : r,
      )
    } catch (e: unknown) {
      if (!isSessionExpiredError(e)) {
        const mensagem = e instanceof Error ? e.message : 'Não foi possível carregar o histórico.'
        setResposta((r) => (r && r.chave === chaveDoPedido ? { ...r, erro: mensagem } : r))
      }
    } finally {
      setCarregandoMais(false)
    }
  }

  const mudar = (parcial: Partial<FiltrosHistoricoTela>) => {
    const novo = { ...filtros, ...parcial }
    for (const k of Object.keys(novo) as Array<keyof FiltrosHistoricoTela>) {
      if (!novo[k]) delete novo[k]
    }
    onFiltros(novo)
  }

  return (
    <SecaoPerfil
      idTitulo="perfil-historico"
      titulo="Histórico"
      descricao="Suas ações registradas na plataforma. Sem datas, os últimos 30 dias."
    >
      <div className="space-y-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <Label htmlFor="historico-frente">Frente</Label>
            <Select
              value={filtros.frente ?? TODAS}
              onValueChange={(v) => mudar({ frente: v === TODAS ? undefined : (v as FrenteAtividade) })}
            >
              <SelectTrigger id="historico-frente" aria-label="Frente" className="w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={TODAS}>Todas</SelectItem>
                {FRENTES.map((f) => (
                  <SelectItem key={f.valor} value={f.valor}>
                    {f.rotulo}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="historico-status">Status</Label>
            <Select
              value={filtros.status ?? TODAS}
              onValueChange={(v) => mudar({ status: v === TODAS ? undefined : (v as StatusAtividade) })}
            >
              <SelectTrigger id="historico-status" aria-label="Status" className="w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={TODAS}>Todos</SelectItem>
                {STATUS.map((s) => (
                  <SelectItem key={s.valor} value={s.valor}>
                    {s.rotulo}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="historico-inicio">De</Label>
            <Input
              id="historico-inicio"
              type="date"
              className="w-40"
              value={filtros.inicio ?? ''}
              onChange={(e) => mudar({ inicio: e.target.value || undefined })}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="historico-fim">Até</Label>
            <Input
              id="historico-fim"
              type="date"
              className="w-40"
              value={filtros.fim ?? ''}
              onChange={(e) => mudar({ fim: e.target.value || undefined })}
            />
          </div>
        </div>

        {carregando ? (
          <div className="space-y-2">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} data-testid="skeleton" className="h-10" />
            ))}
          </div>
        ) : erro ? (
          <ErroSecao mensagem={`Não foi possível carregar o histórico. ${erro}`} onTentar={() => setTentativa((n) => n + 1)} />
        ) : itens.length === 0 ? (
          <EmptyState
            icon={<History className="size-8" aria-hidden />}
            title="Nenhuma ação no período"
            description="Mude a frente, o status ou as datas para ver outras ações suas."
          />
        ) : (
          <>
            <Linhas itens={itens} vinculo={vinculo} />
            {proximo ? (
              <div className="flex justify-center">
                <Button variant="outline" onClick={carregarMais} disabled={carregandoMais}>
                  {carregandoMais ? <Spinner /> : null}
                  Carregar mais
                </Button>
              </div>
            ) : null}
          </>
        )}
      </div>
    </SecaoPerfil>
  )
}

function Quando({ em }: { em: string }) {
  return (
    <time dateTime={em} title={momentoSp(em)} className="whitespace-nowrap">
      {tempoRelativo(em)}
    </time>
  )
}

function StatusBadge({ l }: { l: LinhaHistorico }) {
  const s = STATUS.find((x) => x.valor === l.status) ?? STATUS[4]
  return (
    <span className="flex flex-wrap gap-1">
      <Badge variant="outline" className={`border-transparent ${s?.classe ?? ''}`}>
        {s?.rotulo ?? l.status}
      </Badge>
      {l.detalhe.parcial ? (
        <Badge variant="outline" className="border-transparent bg-warning-subtle text-warning-foreground">
          parcial
        </Badge>
      ) : null}
    </span>
  )
}

function Alvo({ l, vinculo }: { l: LinhaHistorico; vinculo: string | null }) {
  const { tem } = usePermissoes()
  const d = destino(l)
  const assinado = l.detalhe.conexosUsername
  const rotulo = rotuloAlvo(l)
  return (
    <span className="flex flex-col gap-0.5">
      <span className="flex flex-wrap items-center gap-2">
        {rotulo.codigo !== undefined && rotulo.prefixo !== undefined ? (
          <span title={rotulo.titulo} className="text-sm">
            {rotulo.prefixo}
            {separador(rotulo.prefixo)}
            <span className="select-all font-mono text-xs">{rotulo.codigo}</span>
          </span>
        ) : (
          <span title={rotulo.titulo} className="text-sm">
            {rotulo.texto}
          </span>
        )}
        {d && tem(d.permissao) ? (
          <Link
            href={d.href}
            aria-label={`Abrir ${d.nome}`}
            className="text-xs text-primary underline-offset-4 hover:underline"
          >
            abrir
          </Link>
        ) : null}
      </span>
      {rotulo.detalhe ? <span className="text-xs text-muted-foreground">{rotulo.detalhe}</span> : null}
      {assinado && assinado !== vinculo ? (
        <span className="text-xs text-muted-foreground">assinado no ERP como {assinado}</span>
      ) : null}
    </span>
  )
}

function Linhas({ itens, vinculo }: { itens: LinhaHistorico[]; vinculo: string | null }) {
  return (
    <>
      <div className="hidden overflow-x-auto rounded-lg border md:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Quando</TableHead>
              <TableHead>Frente</TableHead>
              <TableHead>Ação</TableHead>
              <TableHead>Alvo</TableHead>
              <TableHead className="text-right">Valor</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {itens.map((l) => (
              <TableRow key={`${l.fonte}:${l.fonteId}`}>
                <TableCell>
                  <Quando em={l.em} />
                </TableCell>
                <TableCell>{ROTULO_FRENTE[l.frente]}</TableCell>
                <TableCell className="min-w-40 whitespace-normal">{descreverAcao(l)}</TableCell>
                <TableCell className="min-w-48 whitespace-normal">
                  <Alvo l={l} vinculo={vinculo} />
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {l.valor !== undefined ? formatBRL(l.valor) : '—'}
                </TableCell>
                <TableCell>
                  <StatusBadge l={l} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <ul className="space-y-2 md:hidden">
        {itens.map((l) => (
          <li key={`${l.fonte}:${l.fonteId}`} className="space-y-1 rounded-lg border p-3 text-sm">
            <div className="flex items-start justify-between gap-2">
              <span className="font-medium">{descreverAcao(l)}</span>
              <StatusBadge l={l} />
            </div>
            <div className="flex flex-wrap gap-x-3 text-xs text-muted-foreground">
              <Quando em={l.em} />
              <span>{ROTULO_FRENTE[l.frente]}</span>
              {l.valor !== undefined ? <span className="tabular-nums">{formatBRL(l.valor)}</span> : null}
            </div>
            <Alvo l={l} vinculo={vinculo} />
          </li>
        ))}
      </ul>
    </>
  )
}
