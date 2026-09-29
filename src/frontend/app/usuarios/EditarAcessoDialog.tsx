'use client'

import { useMemo, useState } from 'react'
import { ShieldCheck, Undo2 } from 'lucide-react'
import { toast } from 'sonner'
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
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Spinner } from '@/components/ui/spinner'
import { PERMISSAO, type Permissao } from '@/lib/permissoes'
import {
  type AppUser,
  atribuirPapel,
  definirExcecoes,
  type EfeitoExcecao,
  type ExcecaoPermissao,
  type PapelComPermissoes,
} from '@/lib/usuarios'

/** Uma permissão na tela: o código e o rótulo curto da ação ("ver", "executar", "gerenciar"). */
interface ItemPermissao {
  permissao: Permissao
  acao: string
}

/** Agrupamento por módulo, na ordem da navegação. Só aparece o que estiver no `catalogo`. */
const MODULOS: ReadonlyArray<{ nome: string; itens: ItemPermissao[] }> = [
  {
    nome: 'Permutas',
    itens: [
      { permissao: PERMISSAO.PERMUTAS_VER, acao: 'ver' },
      { permissao: PERMISSAO.PERMUTAS_EXECUTAR, acao: 'executar' },
    ],
  },
  {
    nome: 'SISPAG',
    itens: [
      { permissao: PERMISSAO.SISPAG_VER, acao: 'ver' },
      { permissao: PERMISSAO.SISPAG_EXECUTAR, acao: 'executar' },
    ],
  },
  {
    nome: 'Adiantamentos',
    itens: [
      { permissao: PERMISSAO.RECEBIMENTOS_VER, acao: 'ver' },
      { permissao: PERMISSAO.RECEBIMENTOS_EXECUTAR, acao: 'executar' },
    ],
  },
  { nome: 'Operação', itens: [{ permissao: PERMISSAO.OPERACAO_VER, acao: 'ver' }] },
  { nome: 'Métricas', itens: [{ permissao: PERMISSAO.METRICAS_VER, acao: 'ver' }] },
  { nome: 'Usuários', itens: [{ permissao: PERMISSAO.USUARIOS_GERENCIAR, acao: 'gerenciar' }] },
]

/** `executar` → `ver` do mesmo módulo (Q8). */
const VER_DE: Partial<Record<Permissao, Permissao>> = {
  [PERMISSAO.PERMUTAS_EXECUTAR]: PERMISSAO.PERMUTAS_VER,
  [PERMISSAO.SISPAG_EXECUTAR]: PERMISSAO.SISPAG_VER,
  [PERMISSAO.RECEBIMENTOS_EXECUTAR]: PERMISSAO.RECEBIMENTOS_VER,
}
/** `ver` → `executar` do mesmo módulo. */
const EXECUTAR_DE: Partial<Record<Permissao, Permissao>> = Object.fromEntries(
  Object.entries(VER_DE).map(([executar, ver]) => [ver, executar]),
)

type Excecoes = ReadonlyMap<Permissao, EfeitoExcecao>

const ORIGEM: Record<EfeitoExcecao, string> = { conceder: 'concedida', revogar: 'revogada' }

/**
 * "Editar acesso" de um usuário (ADR-0053): papel + exceções. `alvo=null` fecha.
 *
 * Cada permissão é um checkbox que mostra o acesso EFETIVO e a origem (do papel, concedida,
 * revogada). Marcar ou desmarcar grava a diferença em relação ao papel como exceção — conceder o
 * que o papel não dá, revogar o que ele dá —, e "voltar ao papel" desfaz a exceção. Regra do Q8
 * aplicada na tela: marcar "executar" marca "ver"; desmarcar "ver" desmarca "executar".
 *
 * O servidor é o gate e o cálculo oficial (as efetivas da lista voltam dele depois de salvar); o
 * diálogo só projeta a escolha. As recusas da guarda (409: último gestor, a própria permissão)
 * aparecem INLINE, com o diálogo aberto (`docs/design-system/forms.md`); o toast é só do sucesso.
 */
export function EditarAcessoDialog({
  alvo,
  papeis,
  catalogo,
  souEu,
  onClose,
  onSaved,
}: {
  alvo: AppUser | null
  papeis: PapelComPermissoes[]
  catalogo: Permissao[]
  souEu: boolean
  onClose: () => void
  onSaved: () => void
}) {
  const inicial = useMemo<Excecoes>(
    () => new Map((alvo?.excecoes ?? []).map((e) => [e.permissao, e.efeito])),
    [alvo],
  )
  // A página remonta o diálogo a cada alvo (`key`), então o estado nasce certo sem efeito.
  const [papelId, setPapelId] = useState<number | undefined>(alvo?.papel?.id)
  const [excecoes, setExcecoes] = useState<Excecoes>(inicial)
  const [erro, setErro] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const papel = papeis.find((p) => p.id === papelId)
  const modulos = MODULOS.map((m) => ({
    ...m,
    itens: m.itens.filter((i) => catalogo.includes(i.permissao)),
  })).filter((m) => m.itens.length > 0)

  /** O papel dá a permissão (inclusive o `ver` que vem de um `executar` do pacote). */
  const doPapel = (p: Permissao): boolean => {
    const pacote = papel?.permissoes ?? []
    const executar = EXECUTAR_DE[p]
    return pacote.includes(p) || (executar !== undefined && pacote.includes(executar))
  }

  const efetivo = (p: Permissao, mapa: Excecoes = excecoes): boolean => {
    const ver = VER_DE[p]
    if (ver !== undefined && mapa.get(ver) === 'revogar') return false
    const efeito = mapa.get(p)
    if (efeito === 'revogar') return false
    if (efeito === 'conceder' || doPapel(p)) return true
    const executar = EXECUTAR_DE[p]
    return executar !== undefined && mapa.get(executar) === 'conceder'
  }

  /** Grava a escolha como exceção relativa ao papel (ou remove, quando coincide com ele). */
  const definir = (mapa: Map<Permissao, EfeitoExcecao>, p: Permissao, quer: boolean) => {
    if (quer === doPapel(p)) mapa.delete(p)
    else mapa.set(p, quer ? 'conceder' : 'revogar')
  }

  const alternar = (p: Permissao, quer: boolean) => {
    setErro(null)
    setExcecoes((atual) => {
      const mapa = new Map(atual)
      definir(mapa, p, quer)
      const ver = VER_DE[p]
      if (quer && ver !== undefined && !efetivo(ver, mapa)) definir(mapa, ver, true)
      const executar = EXECUTAR_DE[p]
      if (!quer && executar !== undefined && efetivo(executar, mapa)) definir(mapa, executar, false)
      return mapa
    })
  }

  const voltarAoPapel = (p: Permissao) => {
    setErro(null)
    setExcecoes((atual) => {
      const mapa = new Map(atual)
      mapa.delete(p)
      return mapa
    })
  }

  /** Exceções que valem para o papel escolhido: sem as redundantes, em ordem estável. */
  const normalizadas = (mapa: Excecoes): ExcecaoPermissao[] =>
    [...mapa.entries()]
      .filter(([p, efeito]) => (efeito === 'conceder') !== doPapel(p))
      .map(([permissao, efeito]) => ({ permissao, efeito }))
      .sort((a, b) => a.permissao.localeCompare(b.permissao))

  const chave = (lista: ExcecaoPermissao[]) =>
    lista.map((e) => `${e.permissao}:${e.efeito}`).join('|')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!alvo || saving) return
    const papelMudou = papelId !== undefined && papelId !== alvo.papel?.id
    const novas = normalizadas(excecoes)
    const originais = [...(alvo.excecoes ?? [])].sort((a, b) => a.permissao.localeCompare(b.permissao))
    const excecoesMudaram = chave(novas) !== chave(originais)
    if (!papelMudou && !excecoesMudaram) {
      onClose()
      return
    }
    setSaving(true)
    setErro(null)
    try {
      if (papelMudou && papelId !== undefined) await atribuirPapel(alvo.id, papelId)
      if (excecoesMudaram) await definirExcecoes(alvo.id, novas)
      toast.success(`Acesso de ${alvo.username} atualizado.`)
      onClose()
      onSaved()
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Falha ao salvar o acesso.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog
      open={alvo != null}
      onOpenChange={(o) => {
        if (!o) onClose()
      }}
    >
      <DialogContent>
        {/* O form entra na coluna flex do DialogContent (teto de 85vh): sem isso o DialogBody não
            encolhe nem rola, e em telas baixas o "Salvar" é empurrado para fora do diálogo. */}
        <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
          <DialogHeader>
            <DialogTitle>Editar acesso</DialogTitle>
            <DialogDescription>
              Papel e exceções de <strong>{alvo?.username}</strong>. Marcar ou desmarcar uma
              permissão cria uma exceção ao papel; o acesso vale na próxima ação do usuário.
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="editar-acesso-papel">Papel</Label>
              <Select
                value={papelId !== undefined ? String(papelId) : undefined}
                onValueChange={(v) => {
                  setErro(null)
                  setPapelId(Number(v))
                }}
              >
                <SelectTrigger id="editar-acesso-papel">
                  <SelectValue placeholder="Escolha o papel" />
                </SelectTrigger>
                <SelectContent>
                  {papeis.map((p) => (
                    <SelectItem key={p.id} value={String(p.id)}>
                      {p.nome}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {souEu ? (
              <p className="rounded-md border border-warning/40 bg-warning-subtle p-2 text-xs text-warning-foreground">
                Este é o seu acesso. Você não pode remover a sua própria permissão de gerenciar
                usuários.
              </p>
            ) : null}

            <div className="space-y-3">
              {modulos.map((modulo) => (
                <fieldset key={modulo.nome} className="rounded-lg border p-3">
                  <legend className="px-1 text-sm font-medium">{modulo.nome}</legend>
                  <ul className="space-y-2">
                    {modulo.itens.map(({ permissao, acao }) => {
                      const id = `acesso-${permissao.replace(':', '-')}`
                      const rotulo = `${modulo.nome} — ${acao}`
                      const excecao = excecoes.get(permissao)
                      return (
                        <li key={permissao} className="flex items-center gap-3">
                          <Checkbox
                            id={id}
                            checked={efetivo(permissao)}
                            onCheckedChange={(v) => alternar(permissao, v === true)}
                            aria-label={rotulo}
                          />
                          <Label htmlFor={id} className="capitalize">
                            {acao}
                          </Label>
                          {excecao ? (
                            <>
                              <Badge variant="outline" className="text-xs">
                                {ORIGEM[excecao]}
                              </Badge>
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="ml-auto h-7"
                                onClick={() => voltarAoPapel(permissao)}
                                aria-label={`Voltar ${rotulo} ao papel`}
                              >
                                <Undo2 className="size-3.5" aria-hidden /> voltar ao papel
                              </Button>
                            </>
                          ) : doPapel(permissao) ? (
                            <span className="text-xs text-muted-foreground">do papel</span>
                          ) : null}
                        </li>
                      )
                    })}
                  </ul>
                </fieldset>
              ))}
            </div>

            {erro ? (
              <p role="alert" className="text-xs text-destructive">
                {erro}
              </p>
            ) : null}
          </DialogBody>
          <DialogFooter>
            <Button type="submit" disabled={saving}>
              {saving ? <Spinner /> : <ShieldCheck className="size-4" aria-hidden />} Salvar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
