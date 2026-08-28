# Shared metrics — run 2026-08-28-1608-invoice-pago-detalhe

> **Escopo:** `--quick`, DELTA da branch `fix/invoice-pago-detalhe` (commit 48abd7b vs origin/main 617ca3b).
> **Layout:** este repo usa `src/backend`/`src/frontend` — os comandos do template (`backend/src`) foram reescritos.
> **`infra/` NÃO existe** neste repo (deploy via Render blueprint). Toda métrica de Terraform/tenant = ⚠️ Não medível.

## Delta sob revisão
```
 ontology/_inbox/invoice-pago-detalhe-tasks.md      |  93 ++++++++
 ontology/entities/invoice.md                       |   2 +-
 ontology/integrations/conexos.md                   |  22 ++
 render.yaml                                        |  54 +++++
 .../domain/client/ConexosSubClients.test.ts        |  38 +++
 src/backend/domain/client/ConexosTitulosClient.ts  |  23 ++
 .../client/permutas/conexosPermutasSchemas.ts      |   1 +
 .../permutas/EleicaoPermutasService.test.ts        | 119 ++++++++++
 .../service/permutas/EleicaoPermutasService.ts     |  41 +++-
 src/backend/jobs/probe-invoice-pago.ts             | 255 +++++++++++++++++++++
 .../jobs/validate-invoice-pago-detalhe-v1.ts       | 110 +++++++++
 11 files changed, 756 insertions(+), 2 deletions(-)
```

## Baseline do repo
- Backend LOC (não-teste):   46833 total
- Backend arquivos de teste: 123
- Frontend LOC:  17742 total
- Frontend arquivos de teste: 25
- Terraform modules: ⚠️ Não medível — `infra/` não existe
- Tenants provisionados: ⚠️ Não medível — sem `tenants-vars/`
- Backend deps: dependencies=16 devDependencies=14
- Frontend deps: dependencies=23 devDependencies=17
