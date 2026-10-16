# Follow-ups — sispag-sugestao-para-todo-titulo

Origem: DesignSystemReviewer (Task 15). Os três achados são de tokens de cor em linhas
**anteriores a esta feature** (não introduzidas pelo delta); ficam como follow-up, não remediados aqui.

| # | Sev. | Onde | Achado | Correção sugerida |
|---|------|------|--------|-------------------|
| 1 | P1 | `src/frontend/app/sispag/components/CandidatosBoletoDialog.tsx` (`DiferencaBadge`, mesmo dia) | `text-success` não é token semântico de texto | `text-success-foreground` |
| 2 | P1 | idem (`DiferencaBadge`, Δ ≠ 0) | `text-warning` idem | `text-warning-foreground` |
| 3 | P1 | `src/frontend/app/sispag/page.tsx` (aviso "Lista cortada em N de M títulos") | `text-amber-700 dark:text-amber-500` literal | `text-warning-foreground` |

## Regis-Review reduzido 2026-10-15-0130 (Security, Testability, Performance) — sem P0

### P2
- **Security F-2:** o reconhecimento é um booleano genérico, não atrelado às datas vistas pela analista
  (só auditoria de reconhecimento antigo; o servidor recalcula e continua recusando vencido).
- **Testability F-1:** invariância à permutação é um exemplo (4×4, 3 ordens), não propriedade; sem
  fast-check no backend.
- **Performance F-1:** a listagem devolve `sugestoes` (legado) e `titulos` com até 3 candidatos na
  mesma página (candidatos serializados 2×); remover o legado depois do deploy.
- **Performance F-2:** o motor é CPU síncrona (~0,6 s) e bloqueia o processo a cada expiração do cache,
  sem orçamento de tempo; quebrar em lotes com `setImmediate` e alertar acima de 1,5 s.

### P3
- Security F-1: `GET /sugestoes-boleto/titulo` sem rate limit (confirmar e copiar-linha têm).
- Security F-3: `ator` cai em `'unknown'`; confirmar que está em `ATORES_RECUSADOS` e testar.
- Testability F-2: 409 de DISPUTADA só confere status; sem teste de confirmar para SEM_CANDIDATO.
- Testability F-3: `BoletoSuggestionService.test.ts` (~1440 linhas) e `MotorSugestaoBoleto.test.ts` (~860).
- Testability: "mesmo conjunto vinculável antes/depois" fixado por literal (14), não por shadow contra a base.
- Performance F-3/F-4: `confirmar` recalcula ao vivo (anti-TOCTOU) e invalida o cache; sem p95 de
  `duracaoMs` nem bytes de payload.

### Design (já registrado pelo AutoLoopRunner)
3 achados de token de cor (`text-success`, `text-warning` em `DiferencaBadge`; `text-amber-700` no aviso de
truncamento em `page.tsx`) em linhas anteriores a esta feature.
