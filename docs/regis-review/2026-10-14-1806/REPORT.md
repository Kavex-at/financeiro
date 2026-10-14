# Regis-Review reduzido 2026-10-14-1806 — `fix/sispag-guarda-codbar-repetido` (PR 1 de 2)

Escopo: delta contra `origin/main` (v0.66.0). 3 QAs escolhidos pelo risco; os outros 5 não se aplicam
(sem infra, sem migration, sem UI, sem integração nova, sem escrita nova no ERP).

| QA | Nota | P0 | P1 | P2 | P3 |
|---|---|---|---|---|---|
| Security | 9 | 0 | 0 | 1 | 1 |
| Testability | 8,5 | 0 | 0 | 2 | 0 |
| Fault Tolerance | 7,5 → corrigido | 0 | 1 (corrigido em `ce9243e`) | 3 | 0 |

**Nenhum P0.** P1 de Fault Tolerance (ledger não retomável após o aborto) corrigido; commit `c717cff`
ajustou a mensagem por modo. Demais achados em
`ontology/_inbox/sispag-guarda-codbar-repetido-followups.md` (F6–F11).

Limitação conhecida e aceita nesta entrega: remover o título do lote local não retira o item do rascunho
nativo no Conexos; a nova tentativa aborta de novo (fail-closed) até o rascunho ser descartado. A
remoção automática é o PR 2.

Não medível: frequência de códigos de convênio (prefixo 8) em PRD — leitura devolveu 403 (F6).
