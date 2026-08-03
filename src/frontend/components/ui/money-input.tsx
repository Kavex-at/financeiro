'use client'

import { cn } from '@/lib/utils'
import { maskBrl, numToMask } from '@/lib/brl'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

/**
 * Input de valor monetário com máscara pt-BR (milhar `.` / centavos `,`) e botão "Máx"
 * opcional que preenche o valor total disponível. `value`/`onChange` operam na string
 * mascarada (parse com `parseBrl` de `@/lib/brl`).
 */
export function MoneyInput({
  value,
  onChange,
  max,
  className,
  ...props
}: {
  value: string
  onChange: (masked: string) => void
  max?: number
  className?: string
} & Omit<React.ComponentProps<typeof Input>, 'value' | 'onChange' | 'className'>) {
  const temMax = max != null && Number.isFinite(max) && max > 0
  return (
    <div className="flex items-center gap-1">
      <Input
        value={value}
        inputMode="decimal"
        onChange={(e) => onChange(maskBrl(e.target.value))}
        placeholder="0,00"
        className={cn('text-right tabular-nums', className)}
        {...props}
      />
      {temMax ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          title={`Preencher o máximo disponível (${numToMask(max)})`}
          onClick={() => onChange(numToMask(max))}
        >
          Máx
        </Button>
      ) : null}
    </div>
  )
}
