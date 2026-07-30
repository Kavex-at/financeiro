'use client'

import * as React from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * Dialog primitives built on Radix UI. Compound API:
 *   <Dialog> <DialogTrigger /> <DialogContent>
 *      <DialogHeader><DialogTitle/><DialogDescription/></DialogHeader>
 *      <DialogBody />
 *      <DialogFooter />
 *   </DialogContent> </Dialog>
 *
 * Defaults follow `docs/design-system/modal.md`:
 *   - focus trap (Radix default)
 *   - ESC closes
 *   - overlay click closes
 *   - focus returns to trigger
 *   - role=dialog + aria-modal=true (Radix default)
 */

const Dialog = DialogPrimitive.Root
const DialogTrigger = DialogPrimitive.Trigger
const DialogPortal = DialogPrimitive.Portal
const DialogClose = DialogPrimitive.Close

const DialogOverlay = React.forwardRef<
    React.ElementRef<typeof DialogPrimitive.Overlay>,
    React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
    <DialogPrimitive.Overlay
        ref={ref}
        data-slot="dialog-overlay"
        className={cn(
            'fixed inset-0 z-50 bg-overlay data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
            className,
        )}
        {...props}
    />
))
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName

interface DialogContentProps
    extends React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> {
    size?: 'sm' | 'md' | 'lg' | 'xl' | 'full'
    showClose?: boolean
}

const sizeClass: Record<NonNullable<DialogContentProps['size']>, string> = {
    sm: 'max-w-[400px]',
    md: 'max-w-[600px]',
    lg: 'max-w-[800px]',
    xl: 'max-w-[1024px]',
    full: 'max-w-[90vw] max-h-[90vh]',
}

const DialogContent = React.forwardRef<
    React.ElementRef<typeof DialogPrimitive.Content>,
    DialogContentProps
>(({ className, children, size = 'md', showClose = true, ...props }, ref) => (
    <DialogPortal>
        <DialogOverlay />
        <DialogPrimitive.Content
            ref={ref}
            data-slot="dialog-content"
            className={cn(
                'fixed left-1/2 top-1/2 z-50 w-full -translate-x-1/2 -translate-y-1/2 gap-4 border bg-card text-card-foreground p-6 shadow-lg duration-200 rounded-lg',
                // Nenhum diálogo pode passar da viewport: sem o teto, uma lista
                // longa empurra o cabeçalho (e os controles) para fora da tela.
                'flex max-h-[85vh] flex-col',
                'data-[state=open]:animate-in data-[state=closed]:animate-out',
                'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
                'data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95',
                sizeClass[size],
                className,
            )}
            {...props}
        >
            {children}
            {showClose ? (
                <DialogPrimitive.Close
                    aria-label="Fechar"
                    className="absolute right-4 top-4 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none"
                >
                    <X className="h-4 w-4" />
                </DialogPrimitive.Close>
            ) : null}
        </DialogPrimitive.Content>
    </DialogPortal>
))
DialogContent.displayName = DialogPrimitive.Content.displayName

const DialogHeader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
    <div
        data-slot="dialog-header"
        className={cn('flex shrink-0 flex-col space-y-1.5 text-left', className)}
        {...props}
    />
)
DialogHeader.displayName = 'DialogHeader'

/**
 * Corpo do diálogo. Rola sozinho quando o conteúdo excede a altura do
 * `DialogContent` (`min-h-0` é o que permite o flex-child encolher).
 * Telas que precisam manter um controle fixo no topo passam
 * `className="overflow-hidden"` e rolam só a região interna.
 */
const DialogBody = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
    <div
        data-slot="dialog-body"
        className={cn('min-h-0 flex-1 overflow-y-auto py-4', className)}
        {...props}
    />
)
DialogBody.displayName = 'DialogBody'

const DialogFooter = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
    <div
        data-slot="dialog-footer"
        className={cn('flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2', className)}
        {...props}
    />
)
DialogFooter.displayName = 'DialogFooter'

const DialogTitle = React.forwardRef<
    React.ElementRef<typeof DialogPrimitive.Title>,
    React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
    <DialogPrimitive.Title
        ref={ref}
        data-slot="dialog-title"
        className={cn('text-lg font-semibold leading-none tracking-tight', className)}
        {...props}
    />
))
DialogTitle.displayName = DialogPrimitive.Title.displayName

const DialogDescription = React.forwardRef<
    React.ElementRef<typeof DialogPrimitive.Description>,
    React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
    <DialogPrimitive.Description
        ref={ref}
        data-slot="dialog-description"
        className={cn('text-sm text-muted-foreground', className)}
        {...props}
    />
))
DialogDescription.displayName = DialogPrimitive.Description.displayName

export {
    Dialog,
    DialogTrigger,
    DialogClose,
    DialogPortal,
    DialogOverlay,
    DialogContent,
    DialogHeader,
    DialogBody,
    DialogFooter,
    DialogTitle,
    DialogDescription,
}
