# Shared baseline metrics — run 2026-08-28-1607

> Coletadas do worktree `~/kavex-worktrees/conexos-fallback-audit` (branch `fix/conexos-fallback-audit`,
> 2 commits sobre `617ca3b`). **Escopo do review: o DELTA da branch** (`--quick`), não o repo inteiro.

## Escopo do delta (13 arquivos de produção + 6 de teste + ontologia)

| Arquivo | Δ |
|---|---|
| `src/backend/domain/client/ConexosSessionResolver.ts` | +93/-? (reescrito: logs I-1 + publicação de identidade) |
| `src/backend/domain/client/ConexosIdentityProvider.ts` | +56 (novo) |
| `src/backend/domain/libs/requestContext/ConexosRequestContext.ts` | +13 |
| `src/backend/services/conexos.ts` | +10 (`getCapturedUsnCod`) |
| `src/backend/migrations/0051_execucao_identidade_conexos.sql` | +36 (novo) |
| `domain/repository/permutas/PermutaExecucaoRepository.ts` | +22 |
| `domain/repository/recebimentos/SolicitacaoNumerarioExecucaoRepository.ts` | +22 |
| `domain/repository/recebimentos/RecebimentoExecucaoRepository.ts` | +22 |
| `domain/repository/sispag/RemessaExecucaoRepository.ts` | +20 |
| `domain/repository/sispag/ConciliacaoExecucaoRepository.ts` | +27 |

Total: **+1099 / -100** em 22 arquivos.

## Baseline do repositório

| Métrica | Valor |
|---|---|
| Backend LOC (sem testes) | 46.642 |
| Backend arquivos de teste | 124 |
| Frontend LOC (sem testes) | 17.742 |
| Frontend arquivos de teste | 25 |
| Backend deps (prod/dev) | 16/14 |
| Frontend deps (prod/dev) | 23/17 |
| Módulos Terraform | ⚠️ **Não medível**: `infra/` não existe neste repo (deploy via Render hook, ver CLAUDE.md) |
| Tenants provisionados | ⚠️ **Não medível**: idem |

## Gates já executados neste delta (medidos, não estimados)

| Gate | Resultado |
|---|---|
| `npm run typecheck` (backend) | ✅ 0 erros |
| `npm run lint` (backend) | ✅ 57 warnings — **idêntico ao baseline da `main`** (392→394 arquivos, 0 warning novo) |
| `npm test` (backend) | ✅ 1493 passed / 110 suites / 0 failed |
| Migration `0051` | ✅ aplicada em Postgres LOCAL (docker) sobre schema em `0050`; 2ª execução = no-op (idempotente) |
| Frontend | não tocado — `npm test`/lint do FE fora do escopo do delta |

## Notas de ambiente para os agents

- `infra/`, Terraform, SSM, Lambda: **não existem**. Toda tactic que dependa deles é
  **não medível neste repo** — registrar como tal, não como falha.
- O runtime é **Express** (`src/backend/http/` + `routes/`), não Lambda. Ver CLAUDE.md §"Estado Atual vs. Alvo".
- `src/backend/.env` aponta `databaseConnectionString` para o **Supabase compartilhado de produção**.
  Nenhum agent deve rodar migration, escrita ou `npm run migrate` contra ele.
- O delta é de **auditoria e observabilidade**: não altera lógica monetária, fórmula, sinal,
  classificação nem filtro de fetch financeiro.
