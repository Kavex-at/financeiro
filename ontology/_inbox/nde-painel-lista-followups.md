# Follow-ups — `nde-painel-lista` (P1/P2, NÃO implementados)

Gates rodados em 2026-08-17 sobre o delta da branch `fix/nde-painel-lista`.
**P0 encontrados: 1 — remediado no próprio ciclo** (ver abaixo). O resto fica registrado aqui.

## P0 (remediado, sem pendência)

| # | Gate | Finding | Remediação |
|---|------|---------|------------|
| DS-1 | DesignSystemReviewer | `NdeTable.tsx` — mensagem de erro do ERP em `text-danger` **só por cor**, sem ícone (viola "status nunca só por cor", DS princípio 8 / WCAG 2.1 AA) | Ícone `AlertTriangle` + texto, com teste de regressão em `NdeTable.test.tsx` |

## P1

| # | Gate | Finding | Nota |
|---|------|---------|------|
| DS-2 | DesignSystemReviewer | As classes utilitárias `text-danger` / `text-warning` / `text-success` / `text-info` **não estão documentadas** em `docs/design-system/tokens.md` — existem só como `--color-*` no `globals.css` (`@theme`, Tailwind v4). Funcionam, mas o spec não as descreve. | Documentar (ou decidir que o token CSS é a única fonte). Não é dívida deste delta: já era assim para todos os chips da Frente IV. |

## P2

| # | Gate | Finding | Nota |
|---|------|---------|------|
| PG-1 | PatternGuardian | `NdeRepository` faz a projeção do painel dirigindo a query por `solicitacao_numerario_execucao` (LEFT JOIN na NDe), enquanto seus outros métodos são CRUD sobre `nota_debito_eletronica`. Padrão de *read model*, documentado no arquivo — **não é violação**. | Se a governança quiser separação estrita por tabela: extrair `NdePainelRepository` só com `listParaPainel`/`contarPendentes`. |
| DS-3 | DesignSystemReviewer | A mensagem de erro na tabela não passa pelo `DomainChip` como os demais estados. | Só faria sentido se a mensagem virar chip — hoje é texto livre vindo do ERP, de tamanho imprevisível. |

## Contexto herdado (não é deste delta)

As suítes `recebimentos.e2e.{test,falhas,gates,retomada}` estão **vermelhas na `main`** por falta de
`COM297_GCD_NOTA_DEBITO` no ambiente local (erro: `com297 Configuracao "NOTA DE DEBITO PAGAMENTO
ANTECIPADO" not found`). Diff por teste confirma que este delta **não adiciona** falha nenhuma —
mas alguém precisa decidir se essas suítes deveriam pular sem a env em vez de falhar.
