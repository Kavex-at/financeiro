# Follow-ups — sispag-sugestao-para-todo-titulo

Origem: DesignSystemReviewer (Task 15). Os três achados são de tokens de cor em linhas
**anteriores a esta feature** (não introduzidas pelo delta); ficam como follow-up, não remediados aqui.

| # | Sev. | Onde | Achado | Correção sugerida |
|---|------|------|--------|-------------------|
| 1 | P1 | `src/frontend/app/sispag/components/CandidatosBoletoDialog.tsx` (`DiferencaBadge`, mesmo dia) | `text-success` não é token semântico de texto | `text-success-foreground` |
| 2 | P1 | idem (`DiferencaBadge`, Δ ≠ 0) | `text-warning` idem | `text-warning-foreground` |
| 3 | P1 | `src/frontend/app/sispag/page.tsx` (aviso "Lista cortada em N de M títulos") | `text-amber-700 dark:text-amber-500` literal | `text-warning-foreground` |
