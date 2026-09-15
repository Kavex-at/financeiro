import * as React from 'react'
import { cn } from '@/lib/utils'

/**
 * Textarea — atom de texto longo multi-linha (`docs/design-system/forms.md`, catálogo de inputs).
 * Mesmos tokens do `Input` (borda, placeholder, foco, desabilitado, inválido); repassa todas as
 * props nativas, inclusive `aria-*`. Contador, ajuda e erro são responsabilidade do chamador,
 * ligados por `aria-describedby`.
 */
function Textarea({ className, ...props }: React.ComponentProps<'textarea'>) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        'placeholder:text-muted-foreground border-input flex min-h-[100px] w-full min-w-0 rounded-md border bg-transparent px-3 py-2 text-base shadow-xs transition-[color,box-shadow] outline-none disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm',
        'focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]',
        'aria-invalid:border-destructive aria-invalid:ring-destructive/20',
        className,
      )}
      {...props}
    />
  )
}

export { Textarea }
