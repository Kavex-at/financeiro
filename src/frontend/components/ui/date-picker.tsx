'use client'

import * as React from 'react'
import { cn } from '@/lib/utils'

interface DatePickerProps {
    value?: string
    onChange?: (value: string) => void
    id?: string
    name?: string
    placeholder?: string
    disabled?: boolean
    min?: string
    max?: string
    className?: string
    'aria-invalid'?: boolean
    'aria-describedby'?: string
    'aria-label'?: string
}

/**
 * Minimal date picker using the native `<input type="date">`. Value is the
 * ISO date string (`YYYY-MM-DD`) — same shape the backend expects in the
 * `dataBase` field. Uses native browser locale for display, but the bound
 * value is always ISO so deep-linking works across locales.
 */
export const DatePicker = React.forwardRef<HTMLInputElement, DatePickerProps>(
    ({ value, onChange, className, ...props }, ref) => {
        return (
            <input
                ref={ref}
                type="date"
                data-slot="date-picker"
                value={value ?? ''}
                onChange={(e) => onChange?.(e.target.value)}
                className={cn(
                    'flex h-9 w-full items-center rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none transition-[color,box-shadow] disabled:cursor-not-allowed disabled:opacity-50',
                    'focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]',
                    'aria-invalid:border-destructive aria-invalid:ring-destructive/20',
                    className,
                )}
                {...props}
            />
        )
    },
)
DatePicker.displayName = 'DatePicker'
