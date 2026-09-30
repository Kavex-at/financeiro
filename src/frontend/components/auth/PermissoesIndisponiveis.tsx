import { RefreshCw, ShieldQuestion } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'

/**
 * Estado de página quando a VERIFICAÇÃO das permissões falhou (serviço de autenticação instável,
 * rede fora) — diferente de "sem permissão" (`AcessoNegado`). Dizer "você não tem acesso" aqui
 * faria o usuário achar que perdeu o acesso; a sessão continua ativa e basta tentar de novo
 * (Regis `availability-1`). Molecule sobre o `EmptyState` do design system.
 */
export function PermissoesIndisponiveis({ onTentarDeNovo }: { onTentarDeNovo: () => void }) {
  return (
    <EmptyState
      icon={<ShieldQuestion className="size-8" aria-hidden />}
      title="Não foi possível verificar suas permissões agora."
      description="O serviço de autenticação pode estar instável. Sua sessão continua ativa; tente de novo em instantes."
      action={
        <Button variant="outline" onClick={onTentarDeNovo}>
          <RefreshCw className="size-4" aria-hidden /> Tentar de novo
        </Button>
      }
    />
  )
}
