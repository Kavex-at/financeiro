import type * as React from 'react'
import { AlertTriangle, RefreshCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

/**
 * Card de uma seção do perfil. `<section aria-labelledby>` = landmark "region" nomeado pelo título,
 * para leitor de tela e para os testes acharem cada seção pelo nome.
 */
export function SecaoPerfil({
  idTitulo,
  titulo,
  descricao,
  id,
  acoes,
  children,
}: {
  idTitulo: string
  titulo: string
  descricao?: React.ReactNode
  /** Âncora da seção (ex.: `senha`). */
  id?: string
  acoes?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <section id={id} aria-labelledby={idTitulo} className="scroll-mt-20">
      <Card>
        <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-1">
            <CardTitle>
              <h2 id={idTitulo} className="text-lg font-semibold leading-tight">
                {titulo}
              </h2>
            </CardTitle>
            {descricao ? <CardDescription>{descricao}</CardDescription> : null}
          </div>
          {acoes ? <div className="flex flex-wrap items-center gap-2">{acoes}</div> : null}
        </CardHeader>
        <CardContent>{children}</CardContent>
      </Card>
    </section>
  )
}

/** Erro de uma seção, com "tentar de novo". Não afeta as outras seções. */
export function ErroSecao({ mensagem, onTentar }: { mensagem: string; onTentar: () => void }) {
  return (
    <div role="alert" className="flex flex-col items-start gap-3 text-sm">
      <p className="flex items-start gap-2 text-danger-foreground">
        <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
        {mensagem}
      </p>
      <Button variant="outline" size="sm" onClick={onTentar}>
        <RefreshCcw aria-hidden />
        Tentar de novo
      </Button>
    </div>
  )
}

/**
 * Falha ao VERIFICAR permissões (`usePermissoes().falhou`) — diferente de "sem acesso" (I5 da
 * AtividadeUsuario, Regis `availability-1`). Nunca diz que o usuário não tem acesso.
 */
export function VerificacaoIndisponivel({ onRecarregar }: { onRecarregar: () => void }) {
  return (
    <div role="alert" className="flex flex-col items-start gap-3 text-sm">
      <p className="flex items-start gap-2 text-warning-foreground">
        <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
        Não foi possível verificar suas permissões agora. Isso não muda o que você pode fazer;
        tente de novo em instantes.
      </p>
      <Button variant="outline" size="sm" onClick={onRecarregar}>
        <RefreshCcw aria-hidden />
        Recarregar
      </Button>
    </div>
  )
}
