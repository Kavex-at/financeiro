# Regis-Review follow-ups — sispag-rem-download-latin1

Run: `docs/regis-review/2026-09-22-1556/` (`REPORT.md`, `KANBAN.md`). Escopo: delta frontend, `--quick`.
Gate: **0 P0**, score 8.2/10. Os cards abaixo **não foram implementados** neste tweak.

| Card | Prioridade | Finding | Detalhe |
|---|---|---|---|
| `deployability-1` | P1 | Fix de formato CNAB só tem fixture sintético de 9 bytes como portão pré-merge; falta checklist de conferir um `.REM` real (Vercel Preview) antes de mergear | KANBAN.md §P1 |
| ~~`cross-1`~~ | P2 | ~~`baixarRemessa` não compara `Content-Length` com `blob.size`~~ | **FEITO** no próprio PR #79 (`lerArquivoDaResposta` em `lib/download.ts`) |
| ~~`cross-2`~~ | P2 | ~~Padrão de download duplicado entre `lib/api.ts` e `lib/sispag.ts`~~ | **FEITO** no próprio PR #79 (`lib/download.ts`; absorve também `integrability-2`) |
| `testability-1` | P2 | Wiring de download do `LoteCard` (`createObjectURL` → `click` → `revokeObjectURL`) sem teste de componente; jsdom precisa de polyfill de `URL.createObjectURL` | KANBAN.md §P2 |
| `availability-2` | P3 | Download de remessa sem log/telemetria de sucesso ou falha | KANBAN.md §P3 |
| `modifiability-2` | P3 | `arquivo` significa nome (`GerarRemessaResult.arquivo: string`) e bytes (`baixarRemessa().arquivo: Blob`) no mesmo arquivo | KANBAN.md §P3 |
| `security-2` | P3 | `Blob` herda o `Content-Type` do backend sem whitelist no cliente | KANBAN.md §P3 |

Nota: `integrability-2` (`revokeObjectURL` sem `try/finally` no `LoteCard`) foi absorvido no `cross-2`.
