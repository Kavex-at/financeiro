# Design Tokens

Todos os valores visuais do sistema são expressos como tokens. Literais (HEX, px, ms) são proibidos no código de componentes — exceto dentro do arquivo de definição dos tokens.

Tokens são definidos em **CSS custom properties** no `globals.css` dentro de `@theme`, e exportados em TS para uso em casos que exigem valor estático (animações imperativas, cálculos).

## Princípios

- **Semântico sobre literal**: `--color-surface` em vez de `--color-white`. O significado sobrevive a mudanças de paleta; a cor específica, não.
- **Escala sobre valores arbitrários**: spacing é `xs | sm | md | lg | xl | 2xl | ...`, não `4px | 7px | 13px`.
- **Paridade com Tailwind v4**: tokens alinham com a API do Tailwind (`--color-*`, `--radius`, `--shadow-*`, etc) para que `bg-primary`, `rounded-md`, `shadow-lg` funcionem a partir dos tokens.
- **Tema light é a base**; dark mode aplica overrides via classe `.dark` na raiz. Nenhum literal HEX em código de componente.
- **Environment theming** muda apenas a paleta de marca (primary + acentos) — estrutura permanece idêntica.

## Color tokens

### Semânticos (base — light theme)

```css
@theme {
    /* Brand */
    --color-primary: #FF8C42;
    --color-primary-hover: #E67A36;
    --color-primary-active: #CC6A2E;
    --color-primary-subtle: #FFF0E3;
    --color-primary-foreground: #FFFFFF;

    /* Secondary (neutro escuro) */
    --color-secondary: #212121;
    --color-secondary-hover: #2D2D2D;
    --color-secondary-foreground: #FFFFFF;

    /* Surfaces (hierarquia de plano de fundo) */
    --color-background: #F4F4F4;        /* plano de fundo geral da página */
    --color-surface: #FFFFFF;           /* cards, painéis, modais */
    --color-surface-raised: #FFFFFF;    /* popover, dropdown */
    --color-surface-sunken: #EEEEEE;    /* áreas recuadas (track de input) */

    /* Texto */
    --color-text-primary: #212121;      /* títulos e corpo principal */
    --color-text-secondary: #3D3D3D;    /* texto de apoio */
    --color-text-muted: #6B6B6B;        /* legendas, helpers */
    --color-text-subtle: #9A9A9A;       /* placeholders, labels descritivos */
    --color-text-disabled: #C0C0C0;
    --color-text-inverse: #FFFFFF;      /* texto sobre surfaces escuras */
    --color-text-link: #FF8C42;
    --color-text-link-hover: #E67A36;

    /* Borders */
    --color-border: #E5E5E5;            /* borda padrão */
    --color-border-strong: #C0C0C0;     /* borda de input, card */
    --color-border-subtle: #F0F0F0;     /* divisórias internas */
    --color-border-focus: #FF8C42;

    /* Focus ring */
    --color-ring: #FF8C42;
    --color-ring-offset: #FFFFFF;

    /* Overlay */
    --color-overlay: rgba(0, 0, 0, 0.5); /* backdrop de modal/drawer */

    /* Feedback semântico — implementados em src/styles/globals.css (dentro de @theme) */
    --color-success: #10B981;
    --color-success-subtle: #C7FFD3;
    --color-success-foreground: #064E3B;

    --color-warning: #F59E0B;
    --color-warning-subtle: #FFFDC7;
    --color-warning-foreground: #78350F;

    --color-danger: #EF4444;
    --color-danger-subtle: #FFC7C7;
    --color-danger-foreground: #7F1D1D;

    --color-info: #3B82F6;
    --color-info-subtle: #DBEAFE;
    --color-info-foreground: #1E3A8A;

    /* NF status (domínio, mas vive no DS por ser parte da identidade visual) */
    --color-status-saved: #3B82F6;           /* SAVED */
    --color-status-processing: #F59E0B;      /* PROCESSING */
    --color-status-escriturada: #8B5CF6;     /* ESCRITURADA */
    --color-status-finalizada: #10B981;      /* FINALIZADA */
    --color-status-pending: #EF4444;         /* PENDING */

    --color-status-saved-subtle: #DBEAFE;
    --color-status-processing-subtle: #FFFDC7;
    --color-status-escriturada-subtle: #EDE9FE;
    --color-status-finalizada-subtle: #C7FFD3;
    --color-status-pending-subtle: #FFC7C7;
}
```

### Dark theme (override)

```css
.dark {
    --color-background: #0A0A0A;
    --color-surface: #171717;
    --color-surface-raised: #1F1F1F;
    --color-surface-sunken: #0F0F0F;

    --color-text-primary: #F4F4F4;
    --color-text-secondary: #D4D4D4;
    --color-text-muted: #A3A3A3;
    --color-text-subtle: #737373;
    --color-text-disabled: #525252;
    --color-text-inverse: #0A0A0A;

    --color-border: #2A2A2A;
    --color-border-strong: #3F3F3F;
    --color-border-subtle: #1F1F1F;

    --color-overlay: rgba(0, 0, 0, 0.7);
    --color-ring-offset: #0A0A0A;

    /* Feedback em dark: cores base mantidas, subtles recalibradas */
    --color-success-subtle: #064E3B;
    --color-warning-subtle: #78350F;
    --color-danger-subtle: #7F1D1D;
    --color-info-subtle: #1E3A8A;

    --color-status-saved-subtle: #1E3A8A;
    --color-status-processing-subtle: #78350F;
    --color-status-escriturada-subtle: #4C1D95;
    --color-status-finalizada-subtle: #064E3B;
    --color-status-pending-subtle: #7F1D1D;
}
```

**Observação:** dark mode é preparado mas não ativado no produto hoje. A classe `.dark` não é aplicada em nenhum lugar. Quando ativar, basta `<html className="dark">` ou toggle via prefers-color-scheme.

### Environment theming (prd / uat / dev)

Cada ambiente tem sua paleta de marca. O token `--color-primary` e derivados mudam conforme o ambiente detectado via variável de ambiente (injetada no build) ou via runtime config.

```css
/* PRD — default, aplicado sem necessidade de classe */
:root {
    --color-primary: #FF8C42;          /* laranja produção */
    --color-primary-hover: #E67A36;
    --color-primary-active: #CC6A2E;
    --color-primary-subtle: #FFF0E3;
    --color-header-bg: #212121;        /* header preto padrão */
    --color-env-accent: transparent;   /* sem faixa de ambiente */
}

/* UAT — classe .env-uat aplicada em <html> no boot */
.env-uat {
    --color-primary: #8B5CF6;          /* roxo UAT */
    --color-primary-hover: #7C3AED;
    --color-primary-active: #6D28D9;
    --color-primary-subtle: #EDE9FE;
    --color-header-bg: #4C1D95;
    --color-env-accent: #8B5CF6;       /* faixa sutil no header */
    --color-env-label: #FFFFFF;
}

/* DEV — classe .env-dev aplicada em <html> no boot */
.env-dev {
    --color-primary: #10B981;          /* verde DEV */
    --color-primary-hover: #059669;
    --color-primary-active: #047857;
    --color-primary-subtle: #C7FFD3;
    --color-header-bg: #064E3B;
    --color-env-accent: #10B981;
    --color-env-label: #FFFFFF;
}
```

**Regras de environment theming:**

- A classe de ambiente é aplicada em `<html>` no boot da aplicação, lendo de `process.env.NEXT_PUBLIC_ENV` ou de um runtime config.
- Em PRD a classe é omitida (padrão).
- O tema afeta apenas `--color-primary`, `--color-header-bg`, `--color-env-accent` e derivados. Toda a estrutura (texto, surfaces, borders) permanece idêntica.
- Em UAT e DEV, o header exibe um badge no canto esquerdo ou faixa fina no topo com o nome do ambiente em caixa alta ("UAT", "DEV").
- Em PRD, o nome do ambiente **não** aparece (comportamento normal — ausência é o sinal).
- Tema não é alternável pelo usuário; não há toggle na interface.

## Typography tokens

Família única para o produto inteiro. Escala baseada em proporção modular (1.25 ratio).

```css
@theme {
    --font-family-sans: 'Inter', system-ui, -apple-system, 'Segoe UI', sans-serif;
    --font-family-mono: 'JetBrains Mono', 'Menlo', 'Consolas', monospace;

    /* Sizes */
    --text-xs: 0.75rem;      /* 12px — captions, timestamps */
    --text-sm: 0.875rem;     /* 14px — body secundário, labels */
    --text-base: 1rem;       /* 16px — body padrão */
    --text-lg: 1.125rem;     /* 18px — subtítulos de seção */
    --text-xl: 1.25rem;      /* 20px — títulos de card, KPI label */
    --text-2xl: 1.5rem;      /* 24px — títulos de seção */
    --text-3xl: 1.875rem;    /* 30px — títulos de página */
    --text-4xl: 2.25rem;     /* 36px — KPI value */
    --text-5xl: 3rem;        /* 48px — KPI value extra grande */

    /* Weights */
    --font-weight-regular: 400;
    --font-weight-medium: 500;
    --font-weight-semibold: 600;
    --font-weight-bold: 700;

    /* Line heights */
    --leading-tight: 1.2;      /* títulos */
    --leading-snug: 1.375;     /* subtítulos */
    --leading-normal: 1.5;     /* body */
    --leading-relaxed: 1.625;  /* texto longo */
    --leading-loose: 2;        /* espaçado */

    /* Letter spacing */
    --tracking-tight: -0.02em;
    --tracking-normal: 0;
    --tracking-wide: 0.02em;
    --tracking-wider: 0.08em;   /* uppercase labels */
}
```

### Escala tipográfica semântica

| Token | Uso | Size | Weight | Line-height |
|---|---|---|---|---|
| `heading.h1` | Título de página | 3xl | bold | tight |
| `heading.h2` | Título de seção | 2xl | semibold | tight |
| `heading.h3` | Título de card/bloco | xl | semibold | snug |
| `heading.h4` | Título de subseção | lg | semibold | snug |
| `body.lg` | Parágrafo destacado | lg | regular | normal |
| `body.base` | Parágrafo padrão | base | regular | normal |
| `body.sm` | Texto de apoio | sm | regular | normal |
| `label.default` | Label de campo | sm | medium | snug |
| `label.uppercase` | Label de tabela, seção | xs | semibold | snug, wider |
| `caption` | Legenda, metadata | xs | regular | normal |
| `code` | Valores mono (CNPJ, ID) | sm | regular | normal, mono |

## Spacing tokens

Escala baseada em 4px.

```css
@theme {
    --spacing-0: 0;
    --spacing-px: 1px;
    --spacing-0-5: 0.125rem;   /* 2px */
    --spacing-1: 0.25rem;      /* 4px */
    --spacing-1-5: 0.375rem;   /* 6px */
    --spacing-2: 0.5rem;       /* 8px */
    --spacing-3: 0.75rem;      /* 12px */
    --spacing-4: 1rem;         /* 16px */
    --spacing-5: 1.25rem;      /* 20px */
    --spacing-6: 1.5rem;       /* 24px */
    --spacing-8: 2rem;         /* 32px */
    --spacing-10: 2.5rem;      /* 40px */
    --spacing-12: 3rem;        /* 48px */
    --spacing-16: 4rem;        /* 64px */
    --spacing-20: 5rem;        /* 80px */
    --spacing-24: 6rem;        /* 96px */
}
```

### Apelidos semânticos

Use quando o contexto fica mais legível com nome do que com número:

```css
--gap-xs: var(--spacing-1);       /* 4px */
--gap-sm: var(--spacing-2);       /* 8px */
--gap-md: var(--spacing-4);       /* 16px */
--gap-lg: var(--spacing-6);       /* 24px */
--gap-xl: var(--spacing-8);       /* 32px */
--gap-2xl: var(--spacing-12);     /* 48px */

--padding-card: var(--spacing-6);
--padding-input: var(--spacing-3);
--padding-page: var(--spacing-8);
```

## Border radius tokens

```css
@theme {
    --radius-none: 0;
    --radius-sm: 0.25rem;      /* 4px — tags, chips pequenos */
    --radius-md: 0.5rem;       /* 8px — botões, inputs, cards */
    --radius-lg: 0.75rem;      /* 12px — cards grandes, modais */
    --radius-xl: 1rem;         /* 16px — surfaces destacadas */
    --radius-2xl: 1.5rem;      /* 24px */
    --radius-full: 9999px;     /* pill, avatar */

    --radius: var(--radius-md);  /* default usado pelo shadcn */
}
```

### Uso semântico

- **`radius-sm`**: badges, tags, chips.
- **`radius-md`**: botões, inputs, small cards, popovers.
- **`radius-lg`**: cards grandes, KPIs, modais, drawers.
- **`radius-xl`**: hero blocks, landing cards.
- **`radius-full`**: avatares, indicadores circulares, toggles.

## Shadow tokens

Elevação em 5 níveis. Use o token correspondente ao contexto, não o valor.

```css
@theme {
    --shadow-none: none;
    --shadow-xs: 0 1px 2px 0 rgb(0 0 0 / 0.05);
    --shadow-sm: 0 1px 3px 0 rgb(0 0 0 / 0.08), 0 1px 2px -1px rgb(0 0 0 / 0.04);
    --shadow-md: 0 4px 6px -1px rgb(0 0 0 / 0.08), 0 2px 4px -2px rgb(0 0 0 / 0.06);
    --shadow-lg: 0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.05);
    --shadow-xl: 0 20px 25px -5px rgb(0 0 0 / 0.12), 0 8px 10px -6px rgb(0 0 0 / 0.08);
    --shadow-2xl: 0 25px 50px -12px rgb(0 0 0 / 0.25);

    /* Sombras contextuais */
    --shadow-card: var(--shadow-sm);
    --shadow-popover: var(--shadow-md);
    --shadow-dropdown: var(--shadow-md);
    --shadow-modal: var(--shadow-xl);
    --shadow-drawer: var(--shadow-xl);
    --shadow-toast: var(--shadow-lg);
    --shadow-sticky: 0 2px 4px 0 rgb(0 0 0 / 0.04); /* header/sidebar sticky */
    --shadow-focus: 0 0 0 3px rgb(255 140 66 / 0.25);
}
```

**Regra**: use os contextuais (`shadow-card`, `shadow-modal`) em vez dos genéricos em componentes. Isso permite recalibrar o sistema inteiro mudando um token sem tocar em cada componente.

## Seleção de linha

A linha "ativa" de uma tabela (ex.: o título aberto na gaveta de detalhe não modal, marcado com
`aria-current="true"`) usa fundo `primary/10` e um filete à esquerda. A largura do filete é token;
nunca escreva `3px` no componente.

```css
:root {
    --selection-bar-width: 3px;
    --shadow-selection: inset var(--selection-bar-width) 0 0 0 var(--primary);
}
```

Uso: `bg-primary/10 shadow-[var(--shadow-selection)]` (em SISPAG, `CLASSE_LINHA_ATIVA` de
`app/sispag/situacao/situacaoTitulos.ts`).

**Contraste (WCAG AA), fundo da página `--background` oklch(0.98 0 0) + `primary/10`:**

| Par | Razão | AA |
|---|---|---|
| `--foreground` sobre a linha ativa | 14.8:1 | passa |
| `--muted-foreground` sobre a linha ativa | 3.9:1 | **falha** |
| `foreground/70` sobre a linha ativa | 6.9:1 | passa |
| filete `--primary` contra a linha (não texto, ≥ 3:1) | 4.9:1 | passa |

Por isso, dentro da linha ativa o texto `text-muted-foreground` passa a `text-foreground/70`
(`[&_.text-muted-foreground]:text-foreground/70`). Só tema claro: não há override `.dark` em
`globals.css` hoje.

## Gaveta de detalhe

```css
:root {
    --drawer-detail-width: 30rem;                                       /* 480px */
    --drawer-detail-reserve: calc(var(--drawer-detail-width) - 2rem);   /* desconta lg:px-8 do main */
}
```

Gaveta não modal (`modal.md` § Drawer não modal) entre `xl` e `2xl`: a gaveta usa
`--drawer-detail-width` e, enquanto ela está aberta, o contêiner da tabela ganha margem direita
`--drawer-detail-reserve`, para a tabela não ficar sob a gaveta. 480px é a menor largura em que o cartão de boleto
não quebra a linha de diferenças.

## Z-index tokens

Evitar z-index ad-hoc. Toda sobreposição usa um dos níveis.

```css
@theme {
    --z-base: 0;
    --z-sticky: 10;           /* header sticky, coluna fixa da tabela */
    --z-dropdown: 20;         /* dropdown menu, autocomplete */
    --z-popover: 30;          /* popovers, tooltips */
    --z-drawer-backdrop: 40;
    --z-drawer: 45;
    --z-modal-backdrop: 50;
    --z-modal: 55;
    --z-toast: 60;            /* toast deve sobrepor modais */
    --z-tooltip: 70;          /* tooltip sempre no topo */
    --z-max: 9999;            /* uso emergencial; exige justificativa no PR */
}
```

## Breakpoints

Usados tanto em CSS quanto em JS (via media queries matching ou `useBreakpoint`).

| Token | Min-width | Uso | Target |
|---|---|---|---|
| `mobile` | 0 | smartphones | fluxos auxiliares (login, notificações) |
| `tablet` | 640px | tablets pequenos, landscape | lista com scroll |
| `laptop` | 768px | tablets grandes, laptops pequenos | dashboards simplificados |
| `desktop` | 1024px | desktop padrão | **target primário do produto** |
| `wide` | 1280px | monitores grandes | layout completo com espaço para gráficos |
| `ultrawide` | 1536px | ultrawide / 4K | layout expandido |

Alinhados com Tailwind: `sm` = tablet, `md` = laptop, `lg` = desktop, `xl` = wide, `2xl` = ultrawide.

## Motion tokens

Animação tem propósito — comunicar causa e efeito, suavizar transições de estado, indicar carregamento. Nunca decora.

```css
@theme {
    /* Durações */
    --duration-instant: 0ms;
    --duration-fast: 120ms;        /* hover, focus, small state changes */
    --duration-normal: 200ms;      /* abrir/fechar popover, toggle */
    --duration-slow: 300ms;        /* modal in/out, drawer */
    --duration-slower: 500ms;      /* transição maior, loading overlay */

    /* Easings */
    --ease-linear: linear;
    --ease-in: cubic-bezier(0.4, 0, 1, 1);
    --ease-out: cubic-bezier(0, 0, 0.2, 1);
    --ease-in-out: cubic-bezier(0.4, 0, 0.2, 1);
    --ease-bounce: cubic-bezier(0.68, -0.55, 0.265, 1.55);

    /* Shimmer (skeleton) */
    --shimmer-duration: 1.5s;

    /* Pulse (skeleton base + dot indicators) */
    --pulse-duration: 1.6s;
    --pulse-easing: var(--ease-in-out);
    --pulse-opacity-from: 1;
    --pulse-opacity-to: 0.45;
}

/* Animação pulse — reutilizada pela base do skeleton e por indicadores "dot" (ex.: polling ativo) */
@keyframes pulse {
    0%, 100% { opacity: var(--pulse-opacity-from); }
    50%      { opacity: var(--pulse-opacity-to); }
}
```

### Respeito a `prefers-reduced-motion`

```css
@media (prefers-reduced-motion: reduce) {
    *,
    *::before,
    *::after {
        animation-duration: 0.01ms !important;
        animation-iteration-count: 1 !important;
        transition-duration: 0.01ms !important;
    }
}
```

Esta regra é obrigatória no `globals.css`. Componentes que dependem de animação para transmitir informação (ex: shimmer em skeleton) devem ter fallback visual estático (opacidade levemente diferente).

## Exemplo de uso em componente

```tsx
// Use classes Tailwind que resolvem para os tokens
<div className="bg-surface rounded-lg shadow-card p-6 text-text-primary">
    <h3 className="text-xl font-semibold leading-tight">Título</h3>
    <p className="text-sm text-text-muted mt-2">Legenda</p>
</div>

// Para animações e valores imperativos, importe tokens em TS:
import { tokens } from '@/shared/design-system/tokens';

const timeline = {
    duration: tokens.motion.duration.normal,
    easing: tokens.motion.easing.out,
};
```

## Do / Don't

### Do

- Sempre use o token semântico mais específico (`shadow-modal`, não `shadow-xl` em um modal).
- Use `--color-text-*` para texto; nunca `--color-primary` ou `--color-secondary` para texto.
- Atualize o valor no `@theme` quando a marca mudar; nunca procure e substitua HEX em componentes.
- Alinhe novos tokens com a API Tailwind (prefixo `--color-`, `--radius-`, `--shadow-`, etc) para que as utility classes funcionem.

### Don't

- Não crie tokens paralelos para casos específicos (`--color-table-header-background`). Reutilize existentes.
- Não use HEX, px, ms literais em código de componente fora do arquivo de tokens.
- Não use `--color-primary` em texto informativo (feedback success/error/warning têm seus próprios).
- Não use `z-index` arbitrário. Se o caso não cabe nos tokens, o problema é arquitetural.
- Não dependa do user agent para motion — respeite sempre `prefers-reduced-motion`.
