'use client'

import * as React from 'react'
import { Archive, ArchiveRestore, MoreVertical } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'

/**
 * Classe do item de menu. O anel de foco segue a convenção do `Button` do design system
 * (`outline-none` + `focus-visible:ring-*`) — remover o outline sem repor o anel deixaria o item
 * invisível para quem navega por teclado, que é justamente quem depende dele.
 */
const ITEM_CLASSES =
  'flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm outline-none transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50'

export interface AcoesLinhaMenuProps {
  /** Nome legível da linha — entra nos `aria-label` para o leitor de tela saber de qual se trata. */
  rotuloLinha: string
  arquivada: boolean
  onArquivar: () => void
  onDesarquivar: () => void
  /** `true` enquanto a chamada está em voo — trava o item para evitar duplo clique. */
  emAndamento?: boolean
}

/**
 * Menu de 3 pontinhos de uma LINHA da tabela — as ações que não merecem um botão fixo.
 *
 * Construído sobre o `Popover` do design system, e não sobre um `DropdownMenu`: o projeto não tem
 * essa primitiva e adicionar `@radix-ui/react-dropdown-menu` só para um item de menu traria uma
 * dependência nova. O `Popover` já é usado, já é acessível (foco preso, ESC fecha, clique fora
 * fecha) e o `role="menu"` abaixo dá a semântica que falta.
 */
export function AcoesLinhaMenu({
  rotuloLinha,
  arquivada,
  onArquivar,
  onDesarquivar,
  emAndamento = false,
}: AcoesLinhaMenuProps) {
  const [aberto, setAberto] = React.useState(false)

  const executar = (fn: () => void) => {
    // Fecha ANTES de agir: a linha pode sair da lista no mesmo instante (arquivar tira da carteira),
    // e um popover ancorado num nó que sumiu fica órfão na tela.
    setAberto(false)
    fn()
  }

  return (
    <Popover open={aberto} onOpenChange={setAberto}>
      <PopoverTrigger asChild>
        <Button
          size="sm"
          variant="ghost"
          aria-label={`Mais ações para ${rotuloLinha}`}
          aria-haspopup="menu"
          disabled={emAndamento}
        >
          <MoreVertical className="size-4" aria-hidden />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-56 p-1">
        <div role="menu" aria-label={`Ações para ${rotuloLinha}`}>
          {arquivada ? (
            <button
              type="button"
              role="menuitem"
              disabled={emAndamento}
              onClick={() => executar(onDesarquivar)}
              className={ITEM_CLASSES}
            >
              <ArchiveRestore className="size-4" aria-hidden />
              Desarquivar
            </button>
          ) : (
            <button
              type="button"
              role="menuitem"
              disabled={emAndamento}
              onClick={() => executar(onArquivar)}
              className={ITEM_CLASSES}
            >
              <Archive className="size-4" aria-hidden />
              Arquivar
            </button>
          )}
          <p className="px-2 py-1.5 text-xs text-muted-foreground">
            {arquivada
              ? 'Volta para a carteira e para os totais.'
              : 'Sai da carteira e dos totais. Reversível.'}
          </p>
        </div>
      </PopoverContent>
    </Popover>
  )
}
