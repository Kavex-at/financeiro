# Shared metrics — 2026-09-22-1556

Scope: **frontend**, `--quick`, delta da branch `fix/sispag-rem-download-latin1` (`git diff origin/main..HEAD`).

## Delta

```
 ontology/_inbox/sispag-rem-download-latin1-tasks.md     | 39 +++++++++++++++++++
 src/frontend/app/sispag/components/LoteCard.tsx         |  9 ++---
 src/frontend/lib/sispag.test.ts                         | 44 ++++++++++++++++++++++
 src/frontend/lib/sispag.ts                              | 11 ++++--
 4 files changed, 95 insertions(+), 8 deletions(-)
```

Mudança: `baixarRemessa` passa de `res.text()` (decodifica UTF-8) para `res.blob()`; o `LoteCard`
entrega esse Blob direto ao `URL.createObjectURL`. O backend (`src/backend/routes/sispag.ts`, rota
`GET /sispag/lotes/:id/remessa/arquivo`) já envia `Buffer` latin1. Acento no favorecido corrompia
as colunas fixas do CNAB 240.

## Frontend

| Métrica | Valor |
|---|---|
| LOC não-teste (`.ts`/`.tsx`) | 21 527 |
| Arquivos de teste | 46 suites |
| `npm run typecheck` | exit 0 |
| `npm run lint` | exit 0 |
| `npm test` | 46 suites / 379 testes passando |

## Backend / infra

- Backend: fora do escopo (delta só frontend).
- `infra/`: Não medível — não existe neste repo.
- `--quick`: sem coverage, sem npm audit profundo.
