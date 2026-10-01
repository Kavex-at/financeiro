import * as React from 'react'
import { cn } from '@/lib/utils'

/**
 * Iniciais de um username: a parte local (antes do `@`) quebrada em `.`, `_`, `-` ou espaço.
 * Duas partes → primeira letra de cada (`ana.souza` → "AS"); uma parte → as duas primeiras letras
 * (`admin` → "AD").
 */
export const iniciais = (username: string): string => {
  const local = username.split('@')[0] ?? username
  const partes = local.split(/[._\-\s]+/).filter(Boolean)
  if (partes.length >= 2) return `${partes[0]?.[0] ?? ''}${partes[1]?.[0] ?? ''}`.toUpperCase()
  return (partes[0] ?? local).slice(0, 2).toUpperCase()
}

interface AvatarProps extends React.HTMLAttributes<HTMLSpanElement> {
  username: string
}

/**
 * Avatar de iniciais (atom do DS, `atomic-classification.md`). Sem foto e sem Radix: a plataforma
 * não guarda imagem de usuário. `aria-label` com o username, porque as iniciais sozinhas não
 * identificam ninguém para um leitor de tela.
 */
export const Avatar = React.forwardRef<HTMLSpanElement, AvatarProps>(
  ({ username, className, ...props }, ref) => (
    <span
      ref={ref}
      role="img"
      aria-label={username}
      data-slot="avatar"
      className={cn(
        'inline-flex size-8 shrink-0 select-none items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground',
        className,
      )}
      {...props}
    >
      <span aria-hidden>{iniciais(username)}</span>
    </span>
  ),
)
Avatar.displayName = 'Avatar'
