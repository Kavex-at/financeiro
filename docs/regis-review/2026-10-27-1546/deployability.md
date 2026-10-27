---
qa: Deployability
qa_slug: deployability
run_id: 2026-10-27-1546
agent: qa-deployability
generated_at: 2026-10-27T15:54:07Z
scope: backend
score: 7
findings_count: 1
cards_count: 1
---

# Deployability — Regis-Review

## 1. Cenário Geral (Bass General Scenario aplicado ao nf-projects)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Maintainer | Merge da correção de reenvio após rejeição do J | Backend Express/Render, preparação e retomada da remessa agrupada | Fluxo ativo sob os kill-switches existentes; item ainda preso ao lote anterior | Antes de importar/finalizar, comprovar ausência no lote antigo ou retirar o grupo inteiro, preservar o antigo e alertar a analista | 0 importações indevidas; N títulos retirados atomicamente; demais itens podem continuar após limpeza comprovada do rascunho atual; prova HML antes do merge |

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Última V7 real documentada, anterior à guarda | 5/6 verificações; finalização do lote novo recusada | Todos os critérios aplicáveis aprovados na rodada pós-correção, inclusive retirada quando vínculo persiste | ❌ | `ontology/_inbox/sispag-boleto-agrupado-reenvio-rejeitado-exploracao.md`, Evidência |
| Provas HML pós-guarda registradas nesta revisão | 0 | ≥1 rodada demonstrando `RETIRADO`, alerta, preservação do antigo e demais pós-condições da Task 21 | ⚠️ | `_shared-metrics.md`; `ontology/_inbox/sispag-boleto-agrupado-reenvio-rejeitado-plano.md`, critérios 1–6 |
| Novas migrations/variáveis/manifestos de deploy no delta inspecionado | 0 / 0 / 0 | 0 para esta correção de comportamento | ✅ | `git diff --stat`; diff dos serviços e `EtapaBorderoGrupo.ts` |
| Etapas CI de validação backend declaradas | 5: audit de produção, typecheck, lint, testes e build; mais job SQL separado | Manter as 5 e o job SQL antes da entrega | ✅ | `.github/workflows/ci.yml:24-30,32-65` (presença, não execução remota) |
| Gate typecheck / lint compartilhado inicial | 0 / 0 códigos de saída; lint: 943 arquivos, 124 avisos | Saída 0 nos gates finais após as correções concorrentes | ✅ | `_shared-metrics.md` (baseline inicial, não gate final) |
| Testes focados compartilhados iniciais | 278/278; revisão independente 74/74 | Gates finais após ajustes; não substituir HML | ✅ | `_shared-metrics.md` |
| Suite backend completa e build final desta revisão | Não medidos por este agente; suite em andamento na baseline | Coordenador registrar resultados finais | ⚠️ | `_shared-metrics.md`; nenhuma execução duplicada |
| Lockfile backend | 1 presente; CI usa `npm ci` | 1 lockfile e instalação reproduzível | ✅ | `src/backend/package-lock.json`; `.github/workflows/ci.yml:23` |
| Meta de rollback documentada | ≤5 minutos; tempo real não medido | Cumprir e medir em exercício/incidente | ⚠️ | `docs/runbooks/rollback.md:6` |

⚠️ **Não medível localmente**: lead time, taxa de sucesso de deploy, tempo real de rollback, latência da guarda e efeitos ERP pós-correção. Requer execução autorizada e telemetria Render/ERP; anexar horários, versão e pós-condições saneadas à evidência operacional. Bundle Lambda, módulos Terraform e tenants isolados são N/A: não há infraestrutura Lambda/Terraform atual neste repositório (`CLAUDE.md`, Estado Atual vs. Alvo).

## 3. Tactics — Cobertura no nf-projects

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Scale Rollouts | Merge ativa o fluxo; nenhuma flag nova é necessária. Kill-switch existente cobre escrita, mas não substitui prova pré-merge | ⚠️ parcial | `DEPLOY.md:113`; Task 21; plano de reenvio |
| Rollback | Procedimento Render documentado; delta sem migration nova permite reversão de código. Reverter à versão sem guarda reabre o risco; não desfaz efeitos ERP | ✅ presente | `docs/runbooks/rollback.md:12-40,81-91`; diff inspecionado |
| Script Deployment Commands | CI declara validação/build e deploy Render usa `npm ci && npm run build`, `npm start` | ✅ presente | `.github/workflows/ci.yml:15-30`; `DEPLOY.md:54-60` |
| Logical Grouping | Preparação/retomada passam pela mesma validação do vínculo; retirada usa a orquestração existente | ✅ presente | `BorderoGrupoBoletoService.ts:637-640,1004-1065`; `RemessaService.ts:1276-1286` |
| Physical Grouping | Sem alteração de unidades físicas, réplica ou alocação nesta correção de serviços Express | N/A — nenhuma mudança de topologia no delta | `CLAUDE.md`, Estado Atual vs. Alvo; diff |
| Package Dependencies | Sem dependência nova; build TypeScript existente entrega serviços em `dist/` e copia SQL já existente | ✅ presente | `src/backend/package.json`, scripts `build`/`start`; `DEPLOY.md:74-83` |
| Surge Protection | Delta não altera tráfego de entrada, número de instâncias ou mecanismo de rollout | N/A — não há mudança de capacidade/roteamento a avaliar | Diff dos serviços; latência real não medida |
| Idempotent deploys | Delta sem schema/env novo; retomada relê vínculo antigo ao vivo; limpeza do reaproveitado preserva borderô e libera continuidade só após ausência do item atual | ✅ presente | `BorderoGrupoBoletoService.ts:637-640,1295-1330`; `RemessaService.ts:1276-1286` |
| Drift detection | Nenhum recurso IaC alterado ou presente no runtime atual | N/A — Terraform é alvo, não infraestrutura desta correção | `CLAUDE.md`, Layout do repositório |
| Reproducible builds | Lockfile e `npm ci`; build final não executado por este agente em revisão quick | ⚠️ parcial | `src/backend/package-lock.json`; `.github/workflows/ci.yml`; `_shared-metrics.md` |
| Per-tenant blast-radius limit | Não há tenant Terraform provisionado nem mudança de isolamento no delta | N/A — limite por tenant não mensurável no Express/Render atual | `CLAUDE.md`, Tenants |
| Deployment observability | Saúde/versão e rollback documentados; alerta identifica filial/banco/lote/borderô; prova HML pós-guarda pendente | ⚠️ parcial | `docs/runbooks/rollback.md:55-77`; `BorderoGrupoBoletoService.ts:1009-1017,1229-1231`; plano |

## 4. Findings (achados)

### F-deployability-1: Prontidão de rollout depende da prova HML pós-guarda

- **Severidade**: P1 (alto — prontidão operacional ainda não comprovada; merge bloqueado pelo contrato existente)
- **Tactic violada**: Scale Rollouts
- **Localização**: `DEPLOY.md:113`; `ontology/_inbox/sispag-boleto-agrupado-tasks.md:744-759`; `ontology/_inbox/sispag-boleto-agrupado-reenvio-rejeitado-plano.md`
- **Evidência (objetiva)**:
  ```
  V7 terceira rodada: 5/6; borderô 259, lote antigo 63, novo 64.
  Finalização recusada por item ainda contido em outro lote ativo.
  Provas HML da guarda pós-correção nesta revisão: 0.
  Task 21 permanece pendente; merge é o rollout, sem flag nova.
  ```
- **Impacto técnico**: testes locais sustentam a guarda, mas não demonstram sua pós-condição no contrato real do ERP. Merge antecipado ativaria um fluxo cujo caminho corrigido ainda não foi comprovado ponta a ponta.
- **Impacto de negócio**: risco de nova tentativa de pagamento agrupado bloqueada na finalização, exigindo intervenção da analista e prolongando o prazo de pagamento.
- **Métrica de baseline**: última V7 real 5/6; 0 provas HML pós-guarda registradas. Trata-se de pendência de liberação já reconhecida, não de novo defeito de infraestrutura.

## 5. Cards Kanban

### [deployability-1] Comprove a guarda em HML antes do merge

- **Problema**
  > A última V7 real terminou 5/6 porque o borderô continuava no lote anterior; a guarda nova ainda tem 0 provas HML registradas. O merge ativa o fluxo em produção sob os kill-switches existentes.
- **Melhoria Proposta**
  > Aplicar o gate de Scale Rollouts já definido na Task 21: no ciclo HML autorizado, observar o grupo inteiro `RETIRADO` com `BORDERO_ANTERIOR_NAO_RESOLVIDO`, alerta acionável, antigo preservado e nenhuma importação indevida. Registrar retomada e continuidade dos demais itens após limpeza observada do rascunho atual. Anexar evidência saneada ao plano/achados e PR; manter merge bloqueado enquanto faltar a prova. Não adicionar flag, migration ou liberação automática.
- **Resultado Esperado**
  > De 0 para ≥1 rodada pós-correção aprovada nos critérios aplicáveis da Task 21, com vínculo antigo persistente tratado antes da finalização e gates locais finais registrados.
- **Tactic alvo**: Scale Rollouts
- **Severidade**: P1
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-deployability-1
- **Métricas de sucesso**:
  - Provas HML pós-guarda: 0 → ≥1 aprovada com evidência saneada.
  - Importações do grupo com vínculo antigo persistente na rodada: baseline nova não medida → 0.
- **Risco de não fazer**: liberar a correção sem validar o contrato ERP repetiria por meses tentativas inválidas e retrabalho operacional.
- **Dependências**: gates finais do coordenador; execução HML autorizada no ciclo próprio; Task 22 continua sendo gate separado da feature, sem repetição nesta revisão.

## 6. Notas do agente

- Revisão quick do delta de detecção; sem ERP/rede/DB, build, install, audit ou testes duplicados; nenhum arquivo alheio editado.
- Express/Render é atual; Lambda/Terraform é alvo. Sem flag, migration ou liberação automática nova neste delta; correções prévias preservadas.
- Retomada completa e limpeza de reaproveitado foram reinspecionadas após os ajustes concorrentes; gates finais pertencem ao coordenador.
- Cross-QA: Integrability/Fault Tolerance devem consolidar a prova do contrato de leitura e da retirada; não contar este mesmo bloqueador múltiplas vezes.
- Score 7/10 avalia prontidão deste delta; não representa maturidade global de deploy nem autorização de merge.
