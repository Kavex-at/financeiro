# Shared metrics — run 2026-09-16-1650-metricas-historico

Baseline coletado uma vez para os 8 agentes. **Leia este arquivo ANTES de coletar qualquer métrica
própria.** Não re-rode o que já está aqui.

## Escopo desta run

`--quick`, **restrito ao delta** da branch `fix/metricas-historico-6-semanas` contra `origin/main`.
Não auditar o repositório inteiro — só o delta e o que ele toca diretamente.

Arquivos de PRODUÇÃO no delta (7):

| Arquivo | Natureza |
|---|---|
| `src/backend/migrations/0060_metricas_historico_inicio.sql` | NOVO — função SQL `metricas.historico_inicio()` |
| `src/backend/domain/interface/metricas/MetricaCiclo.ts` | campo `historico?: boolean` no filtro |
| `src/backend/domain/repository/metricas/MetricasCicloRepository.ts` | escolha do piso da série |
| `src/backend/domain/service/metricas/MetricasCicloService.ts` | repasse do flag |
| `src/backend/routes/metricas.ts` | Zod do boundary + `?historico=true` |
| `src/frontend/lib/metricas.ts` | `fetchMetricasCiclo()` passa `?historico=true` |
| `CHANGELOG.md` + 2× `package.json` | release v0.38.0 (lockstep FE/BE) |

Arquivos de TESTE no delta (6): `vwMetricasCiclo.test.ts`, `vwMetricasCiclo.integration.test.ts`,
`MetricasCicloRepository.test.ts`, `MetricasCicloService.test.ts`, `routes/metricas.test.ts`,
`src/frontend/lib/metricas.test.ts`.

Proporção: ~60 linhas de produção para ~350 de teste.

## Contexto de decisão (ler antes de julgar o desenho)

`ontology/decisions/0048-tela-metricas-recua-seis-semanas-report-fica-no-ciclo-6.md` — emenda a
ADR-0045 D4. `ontology/_inbox/metricas-historico-6-semanas-tasks.md` — spec com os critérios de
aceite. Decisões do Yuri em 2026-09-16: (a) recuar 6 semanas, data FIXA `2026-08-07 18:00`;
(b) **só a tela** recua, o `kavex-report-ciclo` fica no ciclo 6; (c) semanas recuperadas **sem marca**.

## Gates já executados nesta run — fatos dados, NÃO re-rodar

| Gate | Resultado |
|---|---|
| Backend `npm run typecheck` | ✅ limpo |
| Backend `npm test` | ✅ **139 suites / 1994 testes** |
| Backend `npm run test:sql` (Postgres 17 real, docker) | ✅ **19/19**, inclui 5 novos do delta |
| Backend `npm run lint` (biome) | 73 warnings, **0 erros** — todos pré-existentes |
| Biome nos 7 arquivos tocados | ✅ **0 problemas** |
| Frontend `npm run typecheck` | ✅ limpo |
| Frontend `npm test` | ✅ **42 suites / 344 testes** |
| Frontend `npm run lint` | 20 warnings, **0 erros** — todos pré-existentes (`AuthProvider.tsx` etc.) |

## Baseline do repositório

| Métrica | Valor |
|---|---|
| Backend LOC (não-teste) | ~12.361 |
| Arquivos de teste backend | 298 |
| Arquivos de teste frontend | 227 |
| Versão do app (FE == BE, lockstep) | 0.38.0 |

## ⚠️ Não medível neste repositório

- **`infra/` não existe.** Não há Terraform, módulos, tenants nem `tfvars`. Toda métrica de IaC,
  tenant isolation por conta AWS e `terraform plan` é **não medível** — ver CLAUDE.md, seção "Estado
  Atual vs. Alvo". Deploy real é hook do Render; auth/DB no Supabase.
- **Backend roda em Express**, não Lambda. `src/backend/lambda/` não existe. Handlers
  (`ApiGatewayHandler`, `SqsHandler`) existem como código pronto para o alvo, fora do caminho de
  execução. Não tratar isso como achado do delta — é dívida de template já registrada em
  `ontology/_inbox/migration-debt.md`.
- **Cobertura de testes (`--coverage`)**: não coletada, flag `--quick`.
- **`npm audit` profundo**: não coletado, flag `--quick`.

## Caminhos reais (o template herdado erra estes)

Backend em `src/backend/`, frontend em `src/frontend/` — **não** `backend/src/` nem `frontend/src/`.
Comandos com `find backend/src …` voltam vazios e devem ser reescritos.
