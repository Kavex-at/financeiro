# Shared Metrics — run 2026-08-06-1945

**Modo:** `--quick`, escopo **restrito ao delta** do tweak `bordero-vazio-orfao` (gate pós-impl de
`/feature-tweak`). NÃO é uma varredura full do repo — findings devem se ancorar no delta abaixo.

## Delta em revisão (`git diff --stat` vs `main`)

```
 ontology/_index.json                                      |  4 +-
 ontology/business-rules/fin010-write-contract.md          | 19 +++++
 src/backend/domain/service/permutas/BorderoGestaoService.test.ts       | 33 ++++++
 src/backend/domain/service/permutas/BorderoGestaoService.ts            | 18 +++++
 src/backend/domain/service/permutas/ReconciliacaoPermutaService.test.ts| 86 +++++++++++++
 src/backend/domain/service/permutas/ReconciliacaoPermutaService.ts     | 62 ++++++++++
 src/frontend/app/permutas/BorderosPanel.tsx                            | 10 ++-
 7 files changed, 229 insertions(+), 3 deletions(-)
```

Arquivo de decisão novo (não no diff --stat acima por ser untracked):
`ontology/decisions/0030-bordero-orfao-e-aprovacao-vazia.md`

## O que a mudança faz (I-Write-7)

1. **Produtor** — `ReconciliacaoPermutaService.removerBorderoOrfao`: ao fim de `reconciliar`, se o
   borderô foi criado *naquela chamada* e nenhuma alocação terminou `settled`, remove o borderô do ERP
   + cache. Best-effort (try/catch → `BUSINESS_WARN`), fail-safe (não apaga se `listBaixas` > 0).
2. **Consumidor** — `BorderoGestaoService.assertBorderoTemItens`: `finalizarBordero` recusa borderô sem
   item no ERP antes do POST.
3. **UI** — `BorderosPanel.tsx`: "Aprovar" desabilitado quando não há baixa `settled`.

**Origem:** borderô 18538 em produção (2026-08-06) — `"ESTE BORDERÔ NÃO POSSUI ITENS."`

## Baseline de gates (medido neste worktree)

| Métrica | Valor | Observação |
|---|---|---|
| Backend `npm run typecheck` | ✅ limpo | `tsc --noEmit`, exit 0 |
| Backend `npm run lint` | ✅ exit 0 | 35 warnings **pré-existentes** (complexity), nenhum introduzido pelo delta |
| Backend `npm test` (suites permutas) | ✅ 47/47 | `ReconciliacaoPermutaService` + `BorderoGestaoService` |
| Backend `npm test` (full) | ⚠️ 1081 pass / 14 fail | as 14 falhas são **pré-existentes**, confirmadas com `git stash` no baseline limpo: 4 suites `routes/recebimentos.e2e.*` (Frente IV), causa = env var `COM297_GCD_NOTA_DEBITO` ausente. **Fora do escopo deste delta.** |
| Frontend `npm run typecheck` | ✅ limpo | exit 0 |
| Frontend `npm run lint` | ✅ 0 errors | 15 warnings pré-existentes (`AuthProvider.tsx` — não tocado) |
| Frontend `npm test` | ✅ 141/141 | 23 suites |
| Backend arquivos de teste | 256 | |
| Frontend arquivos de teste | 209 | |
| Terraform / tenants | ⚠️ Não medível | não existe `infra/` neste repo (estado atual = Express/Render, ver CLAUDE.md) |
| `npm audit` | ⚠️ Não coletado | modo `--quick` |
| Cobertura | ⚠️ Não coletado | modo `--quick` |

## Testes adicionados pelo delta (6)

`ReconciliacaoPermutaService.test.ts` (4):
- todas as baixas falham → borderô removido do ERP
- falha seguida de sucesso → borderô TEM item, NÃO removido (caso misto, I-Write-3)
- ERP relata item → não remove, só avisa (fail-safe)
- falha ao excluir o órfão não derruba a reconciliação (erro real sobrevive)

`BorderoGestaoService.test.ts` (2):
- borderô sem baixa no ERP → recusa antes de chamar o ERP
- trilha com linha `error` não conta como item do borderô

## Notas de contexto para os agentes

- Repo **não tem `infra/`** — findings de Terraform/IaC não se aplicam ao delta; marcar como
  "Não medível / fora de escopo" em vez de inventar.
- O backend roda **Express** (legado do template), não Lambda — ver CLAUDE.md "Estado Atual vs. Alvo".
  Não penalizar o delta por isso; a regra veta *crescer* o legado, e este delta não adiciona rotas.
- Caminho financeiro de **escrita real no ERP** (`fin010`) — peso extra em fault-tolerance e security.
