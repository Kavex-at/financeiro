# Métricas compartilhadas — run 2026-08-03-0904 (--quick, escopo: delta do tweak)

> Escopo REAL desta revisão: worktree `C:/tmp/sn-titulo-wt`, branch `fix/sn-titulo-condicao-fail-closed`
> contra a base `fix/sn-cond-pgto-finalizacao`. Flag `--quick`: sem coverage, sem npm audit profundo.
> **Não há `infra/` neste repositório** (estado atual = Express/Render, ver CLAUDE.md) — métricas de
> Terraform/tenants são NÃO-MEDÍVEIS por ausência do alvo, não por falha de comando.

## Delta em revisão
```
 ontology/_coverage.json                            |   8 +-
 ontology/_inbox/_watchlist.md                      |  16 +++
 ontology/_inbox/com299-sn-generation-har.md        |  11 ++
 ontology/_index.json                               |  21 +--
 .../recebimentos/gerar-solicitacao-numerario.md    |  21 ++-
 ...n-condicao-pagamento-condicional-fail-closed.md | 109 +++++++++++++++
 ontology/entities/solicitacao-numerario.md         |  26 +++-
 ontology/integrations/conexos-com299-gerdoc.md     |  66 +++++++++
 .../RecebimentoNumerarioService.test.ts            | 148 ++++++++++++++++++---
 .../recebimentos/RecebimentoNumerarioService.ts    | 128 ++++++++++++++++--
 src/backend/routes/recebimentos.e2e.falhas.test.ts |   6 +-
 11 files changed, 513 insertions(+), 47 deletions(-)
```

## Backend — LOC por camada (produção, sem testes)
```
domain/service: 10366 linhas em 45 arquivos
domain/repository: 4329 linhas em 19 arquivos
domain/client: 5770 linhas em 20 arquivos
domain/libs: 1050 linhas em 13 arquivos
routes: 2044 linhas em 7 arquivos
http: 721 linhas em 14 arquivos
```

## Arquivo central do delta
```
  1400 src/backend/domain/service/recebimentos/RecebimentoNumerarioService.ts
  1128 src/backend/domain/service/recebimentos/RecebimentoNumerarioService.test.ts
  2528 total
```

## Testes
- arquivos de teste no backend: 104
- integration tests (fora da suíte padrão, batem no ERP real): 7
- suíte padrão (medida nesta branch): **97 suites / 1017 testes verdes**
- typecheck: **limpo**
Found 33 warnings.
check ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  × Some errors were emitted while running checks.
  


## Lint (baseline PRÉ-EXISTENTE, não regressão deste delta)
```
check ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  × Some errors were emitted while running checks.
  

```
- `npm run lint` do backend falha **repo-wide** por CRLF vs LF (Biome exige LF) — pré-existente, documentado no handoff da sessão anterior.
- Único achado de lint no arquivo central do delta: `noExcessiveCognitiveComplexity` em `classificarAlocacao` — **presente também na branch base** (verificado com `biome check` nos dois worktrees).
