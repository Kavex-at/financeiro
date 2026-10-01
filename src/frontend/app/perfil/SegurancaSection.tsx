'use client'

import * as React from 'react'
import { Check, X } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Spinner } from '@/components/ui/spinner'
import {
  alterarSenha,
  POLITICA_SENHA,
  type ResultadoSenha,
  SENHA_PROPRIA_HABILITADA,
} from '@/lib/perfil/senha'
import { SecaoPerfil } from './SecaoPerfil'

/**
 * Segurança — troca da própria senha. Desenhada e testada, mas DESLIGADA ("em breve") enquanto
 * `SENHA_PROPRIA_HABILITADA = false`: o backend (`POST /me/senha`) ainda não existe. Desligada,
 * nenhum campo aceita entrada e nada vai à rede. A âncora `#senha` é o destino de
 * "Alterar senha" no menu do avatar.
 */
export function SegurancaSection({ habilitada = SENHA_PROPRIA_HABILITADA }: { habilitada?: boolean }) {
  const [atual, setAtual] = React.useState('')
  const [nova, setNova] = React.useState('')
  const [confirmacao, setConfirmacao] = React.useState('')
  const [enviando, setEnviando] = React.useState(false)
  const [resultado, setResultado] = React.useState<ResultadoSenha | null>(null)

  const falhasServidor = resultado?.tipo === 'politica' ? resultado.falhas : []
  const regras = POLITICA_SENHA.map((r) => ({
    ...r,
    atendida: r.ok(nova, atual, confirmacao) && !falhasServidor.includes(r.id),
  }))
  const atualInvalida = resultado?.tipo === 'senha_atual_invalida'

  const enviar = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!habilitada || enviando) return
    setEnviando(true)
    setResultado(null)
    try {
      const r = await alterarSenha(atual, nova)
      setResultado(r)
      if (r.tipo === 'sucesso') {
        setAtual('')
        setNova('')
        setConfirmacao('')
      }
    } finally {
      setEnviando(false)
    }
  }

  return (
    <SecaoPerfil
      id="senha"
      idTitulo="perfil-seguranca"
      titulo="Segurança"
      descricao="Troca da sua senha de acesso à plataforma."
      acoes={
        habilitada ? null : (
          <Badge variant="outline" className="border-transparent bg-info-subtle text-info-foreground">
            em breve
          </Badge>
        )
      }
    >
      <form onSubmit={enviar} className="grid gap-4 md:grid-cols-2" noValidate>
        <fieldset disabled={!habilitada} className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="senha-atual">Senha atual</Label>
            <Input
              id="senha-atual"
              type="password"
              autoComplete="current-password"
              value={atual}
              onChange={(e) => setAtual(e.target.value)}
              disabled={!habilitada}
              aria-invalid={atualInvalida ? true : undefined}
              aria-describedby={atualInvalida ? 'senha-atual-erro' : undefined}
            />
            {atualInvalida ? (
              <p id="senha-atual-erro" className="text-xs text-danger-foreground">
                A senha atual não confere.
              </p>
            ) : null}
          </div>
          <div className="space-y-1">
            <Label htmlFor="senha-nova">Nova senha</Label>
            <Input
              id="senha-nova"
              type="password"
              autoComplete="new-password"
              value={nova}
              onChange={(e) => setNova(e.target.value)}
              disabled={!habilitada}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="senha-confirmacao">Confirmar nova senha</Label>
            <Input
              id="senha-confirmacao"
              type="password"
              autoComplete="new-password"
              value={confirmacao}
              onChange={(e) => setConfirmacao(e.target.value)}
              disabled={!habilitada}
            />
          </div>
          <Button type="submit" disabled={!habilitada || enviando}>
            {enviando ? <Spinner /> : null}
            Alterar senha
          </Button>
        </fieldset>
        <div className="space-y-3 text-sm">
          <ul aria-label="Política de senha" className="space-y-1">
            {regras.map((r) => (
              <li
                key={r.id}
                aria-label={r.rotulo}
                data-ok={String(r.atendida)}
                className={`flex items-center gap-2 ${r.atendida ? 'text-success-foreground' : 'text-muted-foreground'}`}
              >
                {r.atendida ? <Check className="size-4" aria-hidden /> : <X className="size-4" aria-hidden />}
                {r.rotulo}
              </li>
            ))}
          </ul>
          <Mensagem resultado={resultado} />
        </div>
      </form>
    </SecaoPerfil>
  )
}

function Mensagem({ resultado }: { resultado: ResultadoSenha | null }) {
  if (!resultado || resultado.tipo === 'senha_atual_invalida') return null
  const texto: Record<Exclude<ResultadoSenha['tipo'], 'senha_atual_invalida'>, string> = {
    sucesso: 'Senha alterada. Use a nova senha no próximo login.',
    politica: 'A nova senha não atende à política. Confira os itens acima.',
    muitas_tentativas: 'Muitas tentativas. Aguarde alguns minutos e tente de novo.',
    indisponivel: 'Não foi possível verificar agora. Sua senha não foi alterada; tente de novo em instantes.',
  }
  return (
    <p
      role={resultado.tipo === 'sucesso' ? 'status' : 'alert'}
      className={resultado.tipo === 'sucesso' ? 'text-success-foreground' : 'text-danger-foreground'}
    >
      {texto[resultado.tipo]}
    </p>
  )
}
