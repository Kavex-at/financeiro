---
qa: Modifiability
qa_slug: modifiability
run_id: 2026-10-01-1909-perfil-usuario
agent: qa-modifiability
generated_at: 2026-10-01T19:30:00-03:00
scope: backend+frontend (quick, delta feat/perfil-usuario vs origin/main)
score: 7
findings_count: 4
cards_count: 3
---

# Modifiability — Regis-Review

## 1. Cenário Geral

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Time Kavex / analista Columbia | Mudar a regra de KPI por frente (ou a âncora da semana sex 18:00) | `AtividadeUsuarioRepository` (AGREGADOS_SQL), `metricas.metricas_ciclo()`, `PeriodoPerfil`, `periodo.ts` | Desenvolvimento, pré-deploy | Alterar a regra num único ponto, com guarda de paridade acusando divergência | Sítios a tocar: hoje 2 (SQL) + 2 (âncora BE/FE) -> alvo 1 por regra; divergência detectada em CI |

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| LOC máx. arquivo src do delta | 464 (`jobs/validate-perfil-usuario-v1.ts`); 442 (repo) | ≤ 600 | ✅ | `_shared-metrics.md` |
| LOC médio dos 28 arquivos src do delta | ~158 (4412/28) | p50 ≤ 150 | ⚠️ (leve) | `_shared-metrics.md` |
| Arquivos > 400 LOC | 3 (464, 442, 405) | 0 | ⚠️ | idem |
| Cognitive complexity > 15 (delta) | 3 funções: AtividadeSection 35, HistoricoSection 22, validate job main 35 | 0 | ⚠️ | biome (lint backend 77 warn vs 76 em main; frontend 19 = main; valores do run anterior) |
| Fan-out máx. | baixo (módulo `perfil/` linear) | ≤ 15 | ✅ | grep de imports |
| Fan-in dos módulos novos | todos 1-2 importadores (apêndice B) | n/a | ✅ | grep |
| Violações de camada novas | 0 (`routes/me.ts` importa `domain/client/ConexosSessionResolver`, pré-existente; 25 rotas fazem o mesmo) | 0 | ⚠️ legado | `git diff origin/main`; grep |
| Ciclos de dependência | 0 observados (rota -> service -> repo) | 0 | ✅ | inspeção manual |
| Magic numbers de regra | 3 (`HISTORICO_PAGINA=25`, `MAXIMO_DIAS=366`, `HISTORICO_DIAS_PADRAO=30`), constantes nomeadas e exportadas | configuráveis ou documentadas | ⚠️ P3 | `PerfilService.ts:32`, `PeriodoPerfil.ts:47,50` |
| Duplicação de regra de KPI | 2 sítios (AGREGADOS_SQL e `metricas_ciclo()`), sem guarda em CI | 1 ou guarda | ⚠️ | `AtividadeUsuarioRepository.ts:204-262` |
| Paridade medida (manual) | 350 comparações, 0 divergências | 0 | ✅ | `_shared-metrics.md` |
| UNION ALL no histórico | 11 ramos | ≤ 5 por consulta | ⚠️ | `grep -c "UNION ALL"` = 11 |
| `_index.json` / `_coverage.json` | não reamostrados neste quick; commit 88c7d4b marca AtividadeUsuario implemented | 100% | ⚠️ não verificada | git log |

### Apêndice A — Top-10 maiores arquivos (delta, src não-teste)

| # | Arquivo | LOC |
|---|---|---|
| 1 | src/backend/jobs/validate-perfil-usuario-v1.ts | 464 |
| 2 | src/backend/domain/repository/perfil/AtividadeUsuarioRepository.ts | 442 |
| 3 | src/frontend/app/perfil/HistoricoSection.tsx | 405 |
| 4 | src/frontend/app/perfil/AtividadeSection.tsx | 366 |
| 5 | src/frontend/app/usuarios/EditarAcessoDialog.tsx | 289 |
| 6 | src/backend/domain/service/perfil/PerfilService.ts | 287 |
| 7 | src/backend/domain/interface/perfil/AtividadeUsuarioInterface.ts | 260 |
| 8 | src/backend/routes/me.ts | 178 |
| 9 | src/backend/domain/service/perfil/PeriodoPerfil.ts | 162 |
| 10 | src/frontend/lib/api/perfil.ts | 161 |

### Apêndice B — Fan-in dos módulos do delta (arquivos não-teste importadores)

| # | Módulo | Fan-in |
|---|---|---|
| 1 | AtividadeUsuarioRepository | 2 |
| 2 | PerfilQueryInvalidError | 2 |
| 3 | PerfilService | 1 |
| 4 | PeriodoPerfil | 1 |
| 5 | HistoricoCursor | 1 |
| 6 | PerfilRepository | 1 |

Só 6 módulos no delta; top-10 de serviços do repo inteiro não foi recalculado (fora do delta, --quick). Fan-in baixo = mudanças locais.

## 3. Tactics — Cobertura

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Split Module | Perfil dividido em Service/Cursor/Periodo/Repo; FE em 6 seções. Repo com 442 LOC e 2 seções >360 | ⚠️ parcial | Apêndice A |
| Increase Semantic Coherence | `PeriodoPerfil`, `HistoricoCursor` isolados; PerfilService toca 2 entidades (Perfil, Atividade) | ✅ | `domain/service/perfil/` |
| Encapsulate | Zod em `PerfilQuerySchemas`, erro de domínio `PerfilQueryInvalidError` -> 400 | ✅ | `PerfilQuerySchemas.ts`, commit beae170 |
| Use an Intermediary | Service entre rota e repositórios; FE usa `lib/api/perfil.ts` | ✅ | `lib/api/perfil.ts` |
| Restrict Dependencies | Camadas respeitadas no delta; legado `routes -> client` pré-existente | ✅ (delta) | grep |
| Refactor | 3 funções com complexidade > 15 | ⚠️ parcial | F-modifiability-3 |
| Abstract Common Services | Regra de KPI duplicada em SQL e na função de métricas | ❌ | F-modifiability-1 |
| Defer Binding | tsyringe `@injectable`; constantes nomeadas mas fixas em código; sem tokens/polimorfismo (adequado ao escopo) | ⚠️ parcial | `PerfilService.ts:32`, `PeriodoPerfil.ts:47-50` |

## 4. Findings

### F-modifiability-1: Regra de KPI e âncora de semana duplicadas sem guarda de paridade em CI
- **Severidade**: P2
- **Tactic violada**: Abstract Common Services
- **Localização**: `src/backend/domain/repository/perfil/AtividadeUsuarioRepository.ts:204-262`; `src/backend/domain/service/perfil/PeriodoPerfil.ts:44`; `src/frontend/app/perfil/periodo.ts:16-18`
- **Evidência (objetiva)**:
  ```
  AtividadeUsuarioRepository.ts:204 "Mesmas regras de `metricas.metricas_ciclo()` (0070)"
  Paridade só verificada manualmente: 350 comparações / 0 divergências (job validate-perfil-usuario-v1)
  ```
- **Impacto técnico**: alterar a regra em `metricas_ciclo()` sem alterar AGREGADOS_SQL faz o perfil divergir de /metricas em silêncio; o job de validação é manual.
- **Impacto de negócio**: números diferentes entre telas corroem a confiança do analista da Columbia.
- **Métrica de baseline**: 2 sítios de regra de KPI + 3 da âncora (BE, FE, SQL); 0 guardas automáticas.

### F-modifiability-2: Consulta de histórico com 11 ramos UNION ALL num arquivo de 442 LOC
- **Severidade**: P2
- **Tactic violada**: Split Module
- **Localização**: `src/backend/domain/repository/perfil/AtividadeUsuarioRepository.ts` (arquivo inteiro)
- **Evidência (objetiva)**:
  ```
  grep -c "UNION ALL" -> 11; 442 LOC (limite 600, p95 400)
  ```
- **Impacto técnico**: nova fonte de atividade = editar SQL monolítico, cursor e interface (260 LOC) juntos.
- **Impacto de negócio**: cada nova frente/ação custa mais revisão e risco de regressão na tela de histórico.
- **Métrica de baseline**: 11 ramos; 442 LOC.

### F-modifiability-3: Complexidade cognitiva > 15 em 3 funções
- **Severidade**: P2
- **Tactic violada**: Refactor
- **Localização**: `src/frontend/app/perfil/AtividadeSection.tsx` (35); `src/frontend/app/perfil/HistoricoSection.tsx` (22); `src/backend/jobs/validate-perfil-usuario-v1.ts` main (35)
- **Evidência (objetiva)**:
  ```
  biome noExcessiveCognitiveComplexity: 35 / 22 / 35 (limite 15)
  ```
- **Impacto técnico**: componentes difíceis de alterar e testar isoladamente; job sem decomposição.
- **Impacto de negócio**: ajustes de UI do perfil mais lentos e propensos a regressão.
- **Métrica de baseline**: 3 funções acima do limite.

### F-modifiability-4: Parâmetros de regra fixos em código
- **Severidade**: P3
- **Tactic violada**: Defer Binding
- **Localização**: `src/backend/domain/service/perfil/PerfilService.ts:32` (25); `PeriodoPerfil.ts:47` (366), `:50` (30)
- **Evidência (objetiva)**:
  ```
  export const HISTORICO_PAGINA = 25; MAXIMO_DIAS = 366; HISTORICO_DIAS_PADRAO = 30
  ```
- **Impacto técnico**: mudar exige deploy.
- **Impacto de negócio**: baixo; parâmetros de UX estáveis, nomeados e testados.
- **Métrica de baseline**: 3 constantes.

## 5. Cards Kanban

### [modifiability-1] Criar guarda de paridade KPI perfil x metricas_ciclo em CI
- **Problema**
  > A regra de KPI vive em AGREGADOS_SQL e em `metricas.metricas_ciclo()`, e a âncora da semana em BE, FE e SQL. Só há verificação manual (350 comparações, 0 divergências).
- **Melhoria Proposta**
  > Teste de integração SQL (harness local PG já existe, 36/36) comparando as duas fontes em dataset fixo; ou fazer AGREGADOS_SQL consumir a função. Tactic: Abstract Common Services.
- **Resultado Esperado**
  > Divergência quebra o CI; guardas automáticas 0 -> 1.
- **Tactic alvo**: Abstract Common Services
- **Severidade**: P2
- **Esforço estimado**: M
- **Findings relacionados**: F-modifiability-1
- **Métricas de sucesso**:
  - Guardas de paridade em CI: 0 -> 1
  - Sítios de regra por KPI: 2 -> 1 (ou 2 com guarda)
- **Risco de não fazer**: as telas /metricas e /perfil divergem após a próxima alteração de regra.
- **Dependências**: nenhuma

### [modifiability-2] Quebrar o histórico em fontes por frente
- **Problema**
  > Um repositório de 442 LOC concentra 11 ramos UNION ALL.
- **Melhoria Proposta**
  > Extrair fragmentos SQL por frente (módulos de constantes) compostos no repositório. Tactic: Split Module.
- **Resultado Esperado**
  > Arquivo principal < 250 LOC; nova fonte = 1 fragmento + 1 linha de composição.
- **Tactic alvo**: Split Module
- **Severidade**: P2
- **Esforço estimado**: M
- **Findings relacionados**: F-modifiability-2
- **Métricas de sucesso**:
  - LOC do repositório: 442 -> < 250
  - Ramos por arquivo: 11 -> ≤ 4
- **Risco de não fazer**: o arquivo passa de 600 LOC quando entrar a próxima frente.
- **Dependências**: modifiability-1 (rede de segurança)

### [modifiability-3] Decompor seções e job com complexidade > 15
- **Problema**
  > AtividadeSection (35), HistoricoSection (22) e o main do job de validação (35) excedem o limite 15.
- **Melhoria Proposta**
  > Extrair subcomponentes/hooks e funções puras (formatação por tipo de evento, passos do job). Tactic: Refactor. Aproveitar para agrupar as constantes P3 (F-modifiability-4) num módulo de configuração, se conveniente.
- **Resultado Esperado**
  > Funções acima do limite 3 -> 0; testes existentes (319/319) seguem verdes.
- **Tactic alvo**: Refactor
- **Severidade**: P2
- **Esforço estimado**: M
- **Findings relacionados**: F-modifiability-3, F-modifiability-4
- **Métricas de sucesso**:
  - Funções com complexidade > 15: 3 -> 0
- **Risco de não fazer**: a tela de perfil vira ponto de atrito a cada ajuste de UX.
- **Dependências**: nenhuma

## 6. Notas do agente

- Escopo: só o delta (--quick); fan-in e ontologia do repo todo não medidos; infra não medível (sem `infra/`). Complexidade cognitiva e paridade 350/0 vêm do run anterior e dos gates, não foram reexecutadas.
- Reconfirmado agora: 11 UNION ALL, constantes em file:line, fan-in, nenhuma violação de camada nova. Sem P0/P1; score 7.
- Cross-QA: Testability (módulos grandes e funções complexas), Deployability (constantes hardcoded = redeploy), Integrability (guarda de paridade com a função SQL de /metricas).
