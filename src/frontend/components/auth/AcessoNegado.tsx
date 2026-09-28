import Link from 'next/link'
import { ShieldAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'

/**
 * Estado vazio de "sem permissão" para uma página inteira (ADR-0053). Molecule sobre o
 * `EmptyState` do design system: explica o que falta e oferece o caminho de volta. Não redireciona
 * em silêncio — quem chegou por um link antigo precisa saber por que a tela está vazia.
 */
export function AcessoNegado() {
  return (
    <EmptyState
      icon={<ShieldAlert className="size-8" aria-hidden />}
      title="Você não tem acesso a esta área."
      description="Se precisar dela, peça a quem gerencia os usuários da plataforma."
      action={
        <Button asChild variant="outline">
          <Link href="/">Voltar para o início</Link>
        </Button>
      }
    />
  )
}
