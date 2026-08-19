# Métricas compartilhadas — run 2026-08-19-1603

> Escopo: **backend + frontend**, com foco no delta da **Frente V** (`feat/frente-v-aprovacoes`, e7637b8..603a3ed).
> Flag `--quick`: comandos pesados (coverage, npm audit profundo, terraform plan) foram pulados.
> Não há `infra/` neste repo (ver CLAUDE.md §Estado Atual vs. Alvo) — QAs de infra devem tratar como **não medível**.

## Delta da Frente V (o alvo primário desta revisão)
```
 src/frontend/app/aprovacoes/page.test.tsx          |  210 ++
 src/frontend/app/aprovacoes/page.tsx               |  632 +++++
 src/frontend/app/page.tsx                          |   18 +-
 src/frontend/lib/aprovacoes.ts                     |  345 +++
 73 files changed, 15482 insertions(+), 32 deletions(-)
```

### Arquivos do delta
```
src/backend/domain/appContainer.ts
src/backend/domain/aprovacoesContainer.ts
src/backend/domain/client/ConexosAprovacoesClient.test.ts
src/backend/domain/client/ConexosAprovacoesClient.ts
src/backend/domain/errors/AprovacaoIdInvalidoError.ts
src/backend/domain/interface/aprovacoes/constants.ts
src/backend/domain/interface/aprovacoes/EtapaAprovacao.ts
src/backend/domain/interface/aprovacoes/ports.ts
src/backend/domain/interface/aprovacoes/TituloAprovacao.ts
src/backend/domain/libs/environment/EnvironmentProvider.test.ts
src/backend/domain/libs/environment/EnvironmentProvider.ts
src/backend/domain/libs/environment/model/EnvironmentVars.ts
src/backend/domain/repository/aprovacoes/AprovacaoIngestaoRunRepository.ts
src/backend/domain/repository/aprovacoes/AprovacoesSql.test.ts
src/backend/domain/repository/aprovacoes/EtapaAprovacaoRepository.ts
src/backend/domain/repository/aprovacoes/TituloAprovacaoRepository.ts
src/backend/domain/service/aprovacoes/AprovacoesPainelService.test.ts
src/backend/domain/service/aprovacoes/AprovacoesPainelService.ts
src/backend/domain/service/aprovacoes/DuracaoCalculator.test.ts
src/backend/domain/service/aprovacoes/DuracaoCalculator.ts
src/backend/domain/service/aprovacoes/EtapaStatusResolver.test.ts
src/backend/domain/service/aprovacoes/EtapaStatusResolver.ts
src/backend/domain/service/aprovacoes/IngestaoAprovacoesService.test.ts
src/backend/domain/service/aprovacoes/IngestaoAprovacoesService.ts
src/backend/domain/service/aprovacoes/StatusWorkflowResolver.test.ts
src/backend/domain/service/aprovacoes/StatusWorkflowResolver.ts
src/backend/http/aprovacoesGate.ts
src/backend/index.ts
src/backend/jobs/ingest-aprovacoes.ts
src/backend/jobs/probe-aprovacoes-fin026.ts
src/backend/jobs/probe-aprovacoes-trilha.ts
src/backend/migrations/0049_aprovacao_trilha.sql
src/backend/package.json
src/backend/routes/aprovacoes.test.ts
src/backend/routes/aprovacoes.ts
src/frontend/app/aprovacoes/components/snapshot-faixa.tsx
src/frontend/app/aprovacoes/components/status-badges.tsx
src/frontend/app/aprovacoes/components/TrilhaDrawer.test.tsx
src/frontend/app/aprovacoes/components/TrilhaDrawer.tsx
src/frontend/app/aprovacoes/layout.tsx
src/frontend/app/aprovacoes/page.test.tsx
src/frontend/app/aprovacoes/page.tsx
src/frontend/app/page.tsx
src/frontend/lib/aprovacoes.ts
```

## Backend — LOC por camada (sem testes)
```
domain/service/aprovacoes:   832 total
domain/repository/aprovacoes:   518 total
domain/client:   6478 total
domain/interface/aprovacoes:   440 total
routes:   2515 total
http:   742 total
jobs:   3473 total
migrations:  221 total
```

## Contagens
| Métrica | Valor |
|---|---|
| Arquivos de teste backend | 269 |
| Arquivos de teste frontend | 212 |
| Testes backend (suíte completa) | 1372 passando / 110 suítes |
| Testes frontend (suíte completa) | 203 passando / 27 suítes |
| Deps backend | 16 prod + 14 dev |
| Deps frontend | 23 prod + 17 dev |
| Migrations | 50 (última: 0049_aprovacao_trilha.sql) |
| Módulos Terraform | ⚠️ Não medível: não existe `infra/` neste repo |
| Tenants provisionados | ⚠️ Não medível: idem |
