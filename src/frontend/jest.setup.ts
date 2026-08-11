import '@testing-library/jest-dom';
import { TextDecoder, TextEncoder } from 'node:util';

// ── Fetch API no jsdom ───────────────────────────────────────────────────────────────────
// O ambiente jsdom do Jest não expõe `fetch`/`Request`/`Response`/`Headers`. Sem eles, tudo
// que toca `@supabase/ssr` (o middleware e os helpers de servidor) falha já no IMPORT — o
// teste nem chega a uma asserção, e a mensagem não menciona a causa. Node 18+ tem a Fetch
// API nativa; aqui só a promovemos para o escopo global do jsdom.
{
    const scope = globalThis as unknown as Record<string, unknown>;
    if (!('TextEncoder' in scope)) scope.TextEncoder = TextEncoder;
    if (!('TextDecoder' in scope)) scope.TextDecoder = TextDecoder;

    if (typeof window !== 'undefined') {
        const win = window as unknown as Record<string, unknown>;
        for (const name of ['fetch', 'Request', 'Response', 'Headers', 'FormData'] as const) {
            if (!(name in win) && name in scope) {
                win[name] = scope[name];
            }
        }
    }
}

// Polyfills required by Radix UI primitives in jsdom (Switch, Select, etc).
if (typeof window !== 'undefined' && !('ResizeObserver' in window)) {
    class ResizeObserverPolyfill {
        observe = (): void => undefined;
        unobserve = (): void => undefined;
        disconnect = (): void => undefined;
    }
    (window as unknown as { ResizeObserver: unknown }).ResizeObserver = ResizeObserverPolyfill;
}

// Polyfill PointerEvent helpers used by Radix in jsdom.
if (typeof window !== 'undefined') {
    const proto = window.HTMLElement.prototype as unknown as Record<string, unknown>;
    if (!('hasPointerCapture' in proto)) {
        proto.hasPointerCapture = (): boolean => false;
    }
    if (!('releasePointerCapture' in proto)) {
        proto.releasePointerCapture = (): void => undefined;
    }
    if (!('scrollIntoView' in proto)) {
        proto.scrollIntoView = (): void => undefined;
    }
}
