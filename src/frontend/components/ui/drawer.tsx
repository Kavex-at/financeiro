'use client'

import * as React from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * Drawer (gaveta lateral) sobre Radix Dialog — `docs/design-system/modal.md` § Drawer.
 *
 *   <Drawer.Root open={open} onOpenChange={setOpen} side="right" size="md">
 *       <Drawer.Header>
 *           <Drawer.Title>…</Drawer.Title>
 *           <Drawer.CloseButton />
 *       </Drawer.Header>
 *       <Drawer.Body>…</Drawer.Body>
 *       <Drawer.Footer>…</Drawer.Footer>
 *   </Drawer.Root>
 *
 * `modal` (default `true`): backdrop, focus trap e clique fora fecha — o Drawer do DS.
 * `modal={false}`: painel de detalhe ao lado do conteúdo. Sem backdrop, sem focus trap, a página
 * atrás continua visível e clicável e o clique fora NÃO fecha (só Esc e o X). Troque o conteúdo
 * mudando `focusKey`: o foco volta para dentro da gaveta e o "gatilho" passa a ser o último.
 *
 * Nos dois modos o foco entra na gaveta ao abrir (no próprio painel, que é anunciado pelo
 * título) e volta ao elemento que a abriu ao fechar.
 */

type DrawerSide = 'left' | 'right' | 'bottom'
type DrawerSize = 'sm' | 'md' | 'lg' | 'xl'

/** Largura (laterais; tela cheia abaixo de `sm`) ou altura (bottom). */
const sizeClass: Record<'lateral' | 'bottom', Record<DrawerSize, string>> = {
    lateral: {
        sm: 'sm:max-w-[400px]',
        md: 'sm:max-w-[560px]',
        lg: 'sm:max-w-[720px]',
        xl: 'sm:max-w-[960px]',
    },
    bottom: {
        sm: 'max-h-[40vh]',
        md: 'max-h-[60vh]',
        lg: 'max-h-[80vh]',
        xl: 'max-h-[95vh]',
    },
}

const sideClass: Record<DrawerSide, string> = {
    right: 'inset-y-0 right-0 h-full w-full border-l data-[state=open]:slide-in-from-right data-[state=closed]:slide-out-to-right',
    left: 'inset-y-0 left-0 h-full w-full border-r data-[state=open]:slide-in-from-left data-[state=closed]:slide-out-to-left',
    bottom: 'inset-x-0 bottom-0 w-full rounded-t-lg border-t data-[state=open]:slide-in-from-bottom data-[state=closed]:slide-out-to-bottom',
}

interface DrawerRootProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    side?: DrawerSide
    size?: DrawerSize
    /** `false` = sem backdrop nem focus trap; a página atrás segue utilizável. */
    modal?: boolean
    /** Só no modo modal: clique no backdrop fecha. */
    closeOnOverlayClick?: boolean
    /** Identidade do conteúdo; trocar com a gaveta aberta re-foca a gaveta (ver acima). */
    focusKey?: string
    /**
     * Vai no painel e vence as classes de lado (tailwind-merge): ex. `top-14 h-auto` para uma
     * gaveta não modal começar abaixo de um cabeçalho fixo.
     */
    className?: string
    'aria-describedby'?: string
    children: React.ReactNode
}

function DrawerRoot({
    open,
    onOpenChange,
    side = 'right',
    size = 'md',
    modal = true,
    closeOnOverlayClick = true,
    focusKey,
    className,
    children,
    ...contentProps
}: DrawerRootProps) {
    const contentRef = React.useRef<HTMLDivElement>(null)
    // Para onde o foco volta ao fechar: o elemento focado quando a gaveta abriu ou, no modo não
    // modal, quando o conteúdo foi trocado de fora (o botão de outra linha da tabela).
    const retornoRef = React.useRef<HTMLElement | null>(null)
    const chave = open ? (focusKey ?? '') : null
    const chaveAnterior = React.useRef<string | null>(null)

    // Layout effect: roda antes do autofoco do Radix, com o gatilho ainda focado.
    React.useLayoutEffect(() => {
        const anterior = chaveAnterior.current
        chaveAnterior.current = chave
        if (chave === null || chave === anterior) return
        const ativo = document.activeElement
        if (
            ativo instanceof HTMLElement &&
            ativo !== document.body &&
            !contentRef.current?.contains(ativo)
        ) {
            retornoRef.current = ativo
        }
        // Troca de conteúdo com a gaveta já aberta: o foco segue o conteúdo novo.
        if (anterior !== null) contentRef.current?.focus()
    }, [chave])

    const lateral = side === 'bottom' ? 'bottom' : 'lateral'
    return (
        <DialogPrimitive.Root open={open} onOpenChange={onOpenChange} modal={modal}>
            <DialogPrimitive.Portal>
                {modal ? (
                    <DialogPrimitive.Overlay
                        data-slot="drawer-overlay"
                        className={cn(
                            'fixed inset-0 z-[var(--z-drawer-backdrop)] bg-overlay',
                            'data-[state=open]:animate-in data-[state=closed]:animate-out',
                            'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
                            'duration-[var(--duration-slow)] motion-reduce:animate-none',
                        )}
                    />
                ) : null}
                <DialogPrimitive.Content
                    ref={contentRef}
                    data-slot="drawer"
                    data-side={side}
                    className={cn(
                        'fixed z-[var(--z-drawer)] flex flex-col gap-4 bg-card p-6 text-card-foreground',
                        'shadow-[var(--shadow-drawer)] focus:outline-none',
                        'data-[state=open]:animate-in data-[state=closed]:animate-out',
                        'duration-[var(--duration-slow)] ease-out',
                        'motion-reduce:animate-none motion-reduce:transition-none',
                        sideClass[side],
                        sizeClass[lateral][size],
                        className,
                    )}
                    onOpenAutoFocus={(e) => {
                        // O painel (anunciado pelo título), não o primeiro botão: o primeiro
                        // focável pode ser uma ação ("Confirmar boleto").
                        e.preventDefault()
                        contentRef.current?.focus()
                    }}
                    onCloseAutoFocus={(e) => {
                        e.preventDefault()
                        const alvo = retornoRef.current
                        retornoRef.current = null
                        const ativo = document.activeElement
                        // Não rouba o foco de quem já está em outro lugar da página (não modal).
                        const focoLivre =
                            ativo === null ||
                            ativo === document.body ||
                            contentRef.current?.contains(ativo) === true
                        if (alvo?.isConnected && focoLivre) alvo.focus()
                    }}
                    onInteractOutside={(e) => {
                        if (!modal || !closeOnOverlayClick) e.preventDefault()
                    }}
                    {...contentProps}
                >
                    {children}
                </DialogPrimitive.Content>
            </DialogPrimitive.Portal>
        </DialogPrimitive.Root>
    )
}

function DrawerHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
    return (
        <div
            data-slot="drawer-header"
            className={cn('flex shrink-0 items-start gap-3', className)}
            {...props}
        />
    )
}

const DrawerTitle = React.forwardRef<
    React.ElementRef<typeof DialogPrimitive.Title>,
    React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
    <DialogPrimitive.Title
        ref={ref}
        data-slot="drawer-title"
        className={cn('text-lg font-semibold leading-tight tracking-tight', className)}
        {...props}
    />
))
DrawerTitle.displayName = 'DrawerTitle'

const DrawerDescription = React.forwardRef<
    React.ElementRef<typeof DialogPrimitive.Description>,
    React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
    <DialogPrimitive.Description
        ref={ref}
        data-slot="drawer-description"
        className={cn('text-sm text-muted-foreground', className)}
        {...props}
    />
))
DrawerDescription.displayName = 'DrawerDescription'

function DrawerCloseButton({ className }: { className?: string }) {
    return (
        <DialogPrimitive.Close
            aria-label="Fechar"
            data-slot="drawer-close"
            className={cn(
                'ml-auto shrink-0 rounded-sm p-1 opacity-70 transition-opacity hover:opacity-100',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                className,
            )}
        >
            <X className="size-4" aria-hidden />
        </DialogPrimitive.Close>
    )
}

/** Rola sozinho; `min-h-0` deixa o flex-child encolher dentro da gaveta. */
function DrawerBody({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
    return (
        <div
            data-slot="drawer-body"
            className={cn('min-h-0 flex-1 overflow-y-auto', className)}
            {...props}
        />
    )
}

function DrawerFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
    return (
        <div
            data-slot="drawer-footer"
            className={cn('flex shrink-0 justify-end gap-2 border-t pt-4', className)}
            {...props}
        />
    )
}

const Drawer = {
    Root: DrawerRoot,
    Header: DrawerHeader,
    Title: DrawerTitle,
    Description: DrawerDescription,
    CloseButton: DrawerCloseButton,
    Body: DrawerBody,
    Footer: DrawerFooter,
}

export {
    Drawer,
    DrawerRoot,
    DrawerHeader,
    DrawerTitle,
    DrawerDescription,
    DrawerCloseButton,
    DrawerBody,
    DrawerFooter,
}
export type { DrawerRootProps, DrawerSide, DrawerSize }
