'use client'

import * as React from 'react'
import { Check, Circle, Eye, EyeOff, X } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Spinner } from '@/components/ui/spinner'
import {
  alterarSenha,
  buscarPoliticaSenha,
  montarChecklist,
  POLITICA_PADRAO,
  type PoliticaSenha,
  type ResultadoSenha,
  SENHA_PROPRIA_HABILITADA,
} from '@/lib/perfil/senha'
import { SecaoPerfil } from './SecaoPerfil'

/**
 * Segurança — troca da própria senha (backend: ADR-0059). Ligada por `SENHA_PROPRIA_HABILITADA`.
 * Com a flag em `false` (kill switch) volta a "em breve": nenhum campo aceita entrada, nada vai à
 * rede e o checklist mostra a `POLITICA_PADRAO` (8 a 72). A âncora `#senha` é o destino de "Alterar senha" no menu do avatar.
 */
export function SegurancaSection({ habilitada = SENHA_PROPRIA_HABILITADA }: { habilitada?: boolean }) {
  const [politica, setPolitica] = React.useState<PoliticaSenha>(POLITICA_PADRAO)
  const [atual, setAtual] = React.useState('')
  const [nova, setNova] = React.useState('')
  const [confirmacao, setConfirmacao] = React.useState('')
  const [enviando, setEnviando] = React.useState(false)
  const [resultado, setResultado] = React.useState<ResultadoSenha | null>(null)

  React.useEffect(() => {
    if (!habilitada) return
    let vivo = true
    buscarPoliticaSenha().then((p) => {
      if (vivo) setPolitica(p)
    })
    return () => {
      vivo = false
    }
  }, [habilitada])

  const falhasServidor = resultado?.tipo === 'politica' ? resultado.regras : []
  const checklist = montarChecklist(politica).map((r) => {
    const local = r.ok(nova, atual, confirmacao)
    const atendida = falhasServidor.includes(r.id) ? false : local
    return { id: r.id, rotulo: r.rotulo, atendida }
  })
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
        toast.success('Senha alterada', {
          description: 'Esta sessão continua ativa; as outras foram encerradas.',
        })
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
          <CampoSenha
            id="senha-atual"
            rotulo="Senha atual"
            autoComplete="current-password"
            valor={atual}
            onChange={setAtual}
            habilitado={habilitada}
            erro={atualInvalida ? 'A senha atual não confere.' : undefined}
          />
          <CampoSenha
            id="senha-nova"
            rotulo="Nova senha"
            autoComplete="new-password"
            valor={nova}
            onChange={setNova}
            habilitado={habilitada}
            maxLength={politica.maximo}
          />
          <CampoSenha
            id="senha-confirmacao"
            rotulo="Confirmar nova senha"
            autoComplete="new-password"
            valor={confirmacao}
            onChange={setConfirmacao}
            habilitado={habilitada}
            maxLength={politica.maximo}
          />
          <Button type="submit" disabled={!habilitada || enviando}>
            {enviando ? <Spinner /> : null}
            Alterar senha
          </Button>
        </fieldset>
        <div className="space-y-3 text-sm">
          <ul aria-label="Política de senha" className="space-y-1">
            {checklist.map((r) => (
              <li
                key={r.id}
                aria-label={r.rotulo}
                data-ok={r.atendida === null ? 'indefinido' : String(r.atendida)}
                className={`flex items-center gap-2 ${r.atendida ? 'text-success-foreground' : 'text-muted-foreground'}`}
              >
                {r.atendida === null ? (
                  <Circle className="size-4" aria-hidden />
                ) : r.atendida ? (
                  <Check className="size-4" aria-hidden />
                ) : (
                  <X className="size-4" aria-hidden />
                )}
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

/** Campo de senha com botão mostrar/ocultar (`aria-pressed`), alvo de toque de 40px. */
function CampoSenha({
  id,
  rotulo,
  autoComplete,
  valor,
  onChange,
  habilitado,
  erro,
  maxLength,
}: {
  id: string
  rotulo: string
  autoComplete: string
  valor: string
  onChange: (v: string) => void
  habilitado: boolean
  erro?: string
  maxLength?: number
}) {
  const [visivel, setVisivel] = React.useState(false)
  const idErro = `${id}-erro`
  return (
    <div className="space-y-1">
      <Label htmlFor={id}>{rotulo}</Label>
      <div className="relative">
        <Input
          id={id}
          type={visivel ? 'text' : 'password'}
          autoComplete={autoComplete}
          value={valor}
          onChange={(e) => onChange(e.target.value)}
          disabled={!habilitado}
          maxLength={maxLength}
          className="pr-10"
          aria-invalid={erro ? true : undefined}
          aria-describedby={erro ? idErro : undefined}
        />
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="absolute inset-y-0 right-0 h-full w-10 text-muted-foreground"
          onClick={() => setVisivel((v) => !v)}
          disabled={!habilitado}
          aria-label={visivel ? `Ocultar ${rotulo.toLowerCase()}` : `Mostrar ${rotulo.toLowerCase()}`}
          aria-pressed={visivel}
          aria-controls={id}
        >
          {visivel ? <EyeOff className="size-4" aria-hidden /> : <Eye className="size-4" aria-hidden />}
        </Button>
      </div>
      {erro ? (
        <p id={idErro} className="text-xs text-danger-foreground">
          {erro}
        </p>
      ) : null}
    </div>
  )
}

function Mensagem({ resultado }: { resultado: ResultadoSenha | null }) {
  if (!resultado || resultado.tipo === 'senha_atual_invalida') return null
  const texto: Record<Exclude<ResultadoSenha['tipo'], 'senha_atual_invalida'>, string> = {
    sucesso: 'Senha alterada. Use a nova senha no próximo login.',
    politica: 'A nova senha não atende à política. Confira os itens acima.',
    muitas_tentativas: 'Muitas tentativas. Aguarde alguns minutos e tente de novo.',
    indisponivel:
      'Serviço de autenticação indisponível. Sua senha não foi alterada; tente de novo em instantes.',
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
