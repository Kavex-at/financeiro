'use client'

import * as React from 'react'
import { Check, ChevronDown } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from './popover'
import { cn } from '@/lib/utils'

export interface ComboboxOption {
    value: string
    label: string
    /** Texto secundário à direita (ex.: "24 processos"). */
    hint?: string
}

interface ComboboxProps {
    options: ComboboxOption[]
    value: string | null
    onChange: (value: string | null) => void
    placeholder?: string
    searchPlaceholder?: string
    emptyMessage?: string
    disabled?: boolean
    id?: string
    className?: string
    'aria-label'?: string
}

/**
 * Single-select COM BUSCA. O `Select` do Radix não tem campo de busca, e escolher
 * um cliente entre dezenas exige digitar.
 *
 * Mesma mecânica do `multi-select.tsx` (Popover + input + `<ul role="listbox">`),
 * que já é exercitada em jsdom pelos polyfills de `jest.setup.ts`.
 *
 * Filtro client-side de propósito: a lista de clientes vem inteira numa chamada e
 * cabe em memória; busca assíncrona não existe em nenhuma tela do app.
 *
 * Teclado: ↑/↓ navega · Enter escolhe · Esc fecha.
 */
export const Combobox = React.forwardRef<HTMLButtonElement, ComboboxProps>(
    (
        {
            options,
            value,
            onChange,
            placeholder = 'Selecione…',
            searchPlaceholder = 'Buscar…',
            emptyMessage = 'Nada encontrado.',
            disabled,
            id,
            className,
            'aria-label': ariaLabel,
        },
        ref,
    ) => {
        const [open, setOpen] = React.useState(false)
        const [search, setSearch] = React.useState('')
        const [ativo, setAtivo] = React.useState(0)
        // `role="combobox"` exige `aria-controls` apontando para a listbox.
        const listboxId = `${React.useId()}-listbox`

        const filtered = React.useMemo(() => {
            const q = search.trim().toLowerCase()
            if (!q) return options
            return options.filter((o) => o.label.toLowerCase().includes(q))
        }, [options, search])

        const selecionado = options.find((o) => o.value === value) ?? null

        // Reabrir com o filtro antigo mostraria uma lista podada sem explicação.
        React.useEffect(() => {
            if (!open) {
                setSearch('')
                setAtivo(0)
            }
        }, [open])

        const escolher = (v: string): void => {
            onChange(v === value ? null : v)
            setOpen(false)
        }

        const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>): void => {
            if (e.key === 'ArrowDown') {
                e.preventDefault()
                setAtivo((i) => Math.min(i + 1, filtered.length - 1))
            } else if (e.key === 'ArrowUp') {
                e.preventDefault()
                setAtivo((i) => Math.max(i - 1, 0))
            } else if (e.key === 'Enter') {
                e.preventDefault()
                const opt = filtered[ativo]
                if (opt) escolher(opt.value)
            }
        }

        return (
            <Popover open={open} onOpenChange={setOpen}>
                <PopoverTrigger asChild>
                    <button
                        ref={ref}
                        id={id}
                        type="button"
                        role="combobox"
                        aria-expanded={open}
                        aria-controls={listboxId}
                        aria-haspopup="listbox"
                        aria-label={ariaLabel}
                        disabled={disabled}
                        className={cn(
                            'flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm',
                            'ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
                            'disabled:cursor-not-allowed disabled:opacity-50',
                            className,
                        )}
                    >
                        <span className={cn('truncate', !selecionado && 'text-muted-foreground')}>
                            {selecionado ? selecionado.label : placeholder}
                        </span>
                        <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" aria-hidden />
                    </button>
                </PopoverTrigger>

                <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
                    <div className="border-b p-2">
                        <input
                            autoFocus
                            aria-label="Buscar opções"
                            value={search}
                            onChange={(e) => {
                                setSearch(e.target.value)
                                setAtivo(0)
                            }}
                            onKeyDown={onKeyDown}
                            placeholder={searchPlaceholder}
                            className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
                        />
                    </div>

                    {filtered.length === 0 ? (
                        <p id={listboxId} className="p-3 text-sm text-muted-foreground">
                            {emptyMessage}
                        </p>
                    ) : (
                        <ul id={listboxId} role="listbox" className="max-h-64 overflow-auto p-1">
                            {filtered.map((opt, i) => {
                                const escolhido = opt.value === value
                                return (
                                    <li key={opt.value}>
                                        <button
                                            type="button"
                                            role="option"
                                            aria-selected={escolhido}
                                            onClick={() => escolher(opt.value)}
                                            onMouseEnter={() => setAtivo(i)}
                                            className={cn(
                                                'flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm',
                                                i === ativo && 'bg-accent text-accent-foreground',
                                            )}
                                        >
                                            <Check
                                                className={cn(
                                                    'h-4 w-4 shrink-0',
                                                    escolhido ? 'opacity-100' : 'opacity-0',
                                                )}
                                                aria-hidden
                                            />
                                            <span className="flex-1 truncate">{opt.label}</span>
                                            {opt.hint ? (
                                                <span className="shrink-0 text-xs text-muted-foreground">
                                                    {opt.hint}
                                                </span>
                                            ) : null}
                                        </button>
                                    </li>
                                )
                            })}
                        </ul>
                    )}
                </PopoverContent>
            </Popover>
        )
    },
)
Combobox.displayName = 'Combobox'
