---
qa: Testability
qa_slug: testability
run_id: 2026-10-01-1909-perfil-usuario
agent: qa-testability
generated_at: 2026-10-01T19:30:00-03:00
scope: all
score: 8
findings_count: 5
cards_count: 4
---

# Testability — Regis-Review

## 1. Cenário Geral

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Desenvolvedor Kavex | Muda a regra de período/cursor/isolamento por usuário da tela /perfil | `PerfilService`, `AtividadeUsuarioRepository`, `routes/me.ts`, `app/perfil/*` | CI (PR) e local, `--quick` | Testes unitários (DI + `Clock` injetado) e SQL integration falham na regressão, sem rede nem relógio real | Delta com teste por unidade de negócio; 0 chamadas de rede reais; integration roda no CI; falso-verde ≈ 0 |

## 2. Métricas observadas

Coverage não foi rodado (`--quick`); valores de gates vêm de `_shared-metrics.md`.

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| **#1 Cobertura por camada (delta)**: service 3 de 3 unidades com teste (PerfilService, HistoricoCursor, PeriodoPerfil); repository 2/2; route 1/1 (`me.test.ts`); migration 3 testes (unit, rollback, integration); frontend `app/perfil` 3 testes p/ 8 arquivos; `lib/` 1 de 3 (só permissoes) | % de linhas por pasta ⚠️ **Não medível (--quick)**; presença de teste: backend 100%, frontend ~44% | service/repo ≥80% linhas | ⚠️ | `_shared-metrics.md` delta; lista de `.test.*` |
| Razão test/source no delta backend | 10 test files / 14 fontes TS (≈0,71) | ≥0,5 | ✅ | `_shared-metrics.md` |
| Razão test/source no delta frontend | 7 test files / 16 fontes (≈0,44) | ≥0,5 | ⚠️ | idem |
| Suítes/testes verdes | BE 193 suites/3531; FE 73/738; SQL integ. 36/36 | 100% | ✅ | `_shared-metrics.md` Gates |
| Integration SQL no CI | `npm run test:sql` no job backend-sql | presente | ✅ | `.github/workflows/ci.yml:60-62`; `package.json` test:sql |
| Integration test do delta | `atividadeUsuario.integration.test.ts` (406 LOC) | ≥1 por repo com SQL complexo | ✅ | `src/backend/migrations/` |
| Leituras de tempo na fonte do delta (backend) | 0 `new Date()`/`Date.now()`; `Clock` injetado em `PeriodoPerfil.ts:61-66,112` | 0 | ✅ | grep |
| Leituras de tempo em teste sem fake timers | 1 (`page.test.tsx:105`) | 0 | ⚠️ | grep |
| Rede real em testes do delta | 0 (fetch mockado) | 0 | ✅ | inspeção |
| Maior teste do delta | 406 LOC (integration), 374 (`page.test.tsx`), todos <500 | <500 | ✅ | `wc -l` |
| Piso de cobertura | BE global 72/54/78 + `./domain/service/` 88/60; FE global 33/23/28, só `./lib/auth/` 24 | ≥70% em caminho crítico | BE ✅ / FE ⚠️ | `jest.config.cjs:39-50`, `jest.config.js:41-49` |
| fast-check no frontend | 0 usos (dep existente) | n/a | ⚠️ | grep |

## 3. Tactics — Cobertura no nf-projects

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Specialized Interfaces | Construtores tsyringe aceitam mocks; `Clock` injetável; rota `me.ts` testada via `me.test.ts` | ✅ presente | `PeriodoPerfil.ts:61`; `me.test.ts` |
| Recordable Test Cases | Job `validate-perfil-usuario-v1` compara com produção (350 comparações, 0 divergências) + `explain.md`; sem fixtures gravadas de API externa (delta não toca client externo) | ⚠️ parcial | `_shared-metrics.md` Gates |
| Sandbox | SQL integration em PG real (local e CI) | ✅ presente | `ci.yml:60-62` |
| Executable Assertions | Zod nos boundaries (`PerfilQuerySchemas`), `PerfilQueryInvalidError` → 400; teste de isolamento por usuário | ✅ presente | `validatePerfilUsuarioIsolation.test.ts`; commit beae170 |
| Abstract Data Sources | Repository atrás do service; tabela de guard de rotas | ✅ presente | `routePermissions.test.ts` |
| Limit Structural Complexity | Lógica pura extraída (`HistoricoCursor`, `PeriodoPerfil`, `periodo.ts`); `AtividadeSection`+`HistoricoSection` = 771 LOC só via `page.test.tsx` | ⚠️ parcial | `AtividadeSection.tsx` 366, `HistoricoSection.tsx` 405 |
| Limit Non-Determinism | Backend limpo; frontend com `Date.now()` solto em teste; sem aleatoriedade | ⚠️ parcial | `page.test.tsx:105` |

## 4. Findings (achados)

### F-testability-1: AtividadeSection e HistoricoSection só são exercidas indiretamente

- **Severidade**: P2
- **Tactic violada**: Limit Structural Complexity
- **Localização**: `src/frontend/app/perfil/AtividadeSection.tsx`, `HistoricoSection.tsx`; `page.test.tsx` (374 LOC)
- **Evidência (objetiva)**:
  ```
  366 + 405 = 771 LOC; único teste: page.test.tsx; sem AtividadeSection.test.tsx / HistoricoSection.test.tsx
  ```
- **Impacto técnico**: falha de paginação/cursor/período aparece como falha de página inteira; casos de borda difíceis de isolar.
- **Impacto de negócio**: custo de teste e diagnóstico maior a cada mudança na tela de histórico.
- **Métrica de baseline**: 0 testes dedicados para 771 LOC.

### F-testability-2: Teste frontend lê relógio real

- **Severidade**: P2
- **Tactic violada**: Limit Non-Determinism
- **Localização**: `src/frontend/app/perfil/page.test.tsx:105`
- **Evidência (objetiva)**:
  ```
  em: new Date(Date.now() - 2 * 3600_000).toISOString(),
  ```
- **Impacto técnico**: se a UI formata tempo relativo, a asserção depende do instante de execução (flake em borda de hora/dia).
- **Impacto de negócio**: flake esporádico em CI, retrabalho de re-run.
- **Métrica de baseline**: 1 leitura de tempo sem `useFakeTimers`.

### F-testability-3: lib/api/perfil.ts e lib/perfil/senha.ts sem teste direto; frontend sem piso por pasta

- **Severidade**: P2
- **Tactic violada**: Executable Assertions
- **Localização**: `src/frontend/lib/api/perfil.ts` (161 LOC), `src/frontend/lib/perfil/senha.ts` (80 LOC); `src/frontend/jest.config.js:41-49`
- **Evidência (objetiva)**:
  ```
  coverageThreshold frontend: global 33/23/28; só './lib/auth/' tem piso por pasta
  ```
- **Impacto técnico**: regras de senha e parsing de resposta cobertos só indiretamente; regressão não derruba gate.
- **Impacto de negócio**: regra de senha errada afeta a segurança da conta do analista.
- **Métrica de baseline**: 241 LOC sem teste direto; 0 pisos para `lib/perfil/` e `lib/api/`.

### F-testability-4: SegurancaSection sem caso de fetch rejeitado/401

- **Severidade**: P3
- **Tactic violada**: Executable Assertions
- **Localização**: `src/frontend/app/perfil/SegurancaSection.test.tsx` (7 casos)
- **Evidência (objetiva)**: 7 `it` no arquivo; carga dos casos de erro de transporte (rejeição/401) não foi confirmada por leitura integral do arquivo, apenas pela conclusão do run anterior.
- **Impacto técnico**: ramo de erro de rede/sessão expirada possivelmente sem defesa.
- **Impacto de negócio**: mensagem errada ao usuário numa falha de troca de senha.
- **Métrica de baseline**: 0 casos de erro de transporte (conforme run anterior).

### F-testability-5: fast-check disponível e sem uso no delta

- **Severidade**: P3
- **Tactic violada**: Recordable Test Cases
- **Localização**: `src/frontend/app/perfil/periodo.ts`, `src/backend/domain/service/perfil/HistoricoCursor.ts`
- **Evidência (objetiva)**: 0 imports de `fast-check` em `app/`, `lib/`, `components/`; encode/decode de cursor e período são propriedades naturais (round-trip).
- **Impacto técnico**: casos de borda só os escritos à mão.
- **Impacto de negócio**: baixo.
- **Métrica de baseline**: 0 testes de propriedade.

## 5. Cards Kanban

### [testability-1] Testar AtividadeSection e HistoricoSection isoladamente

- **Problema**
  > 771 LOC de UI de atividade/histórico só passam por `page.test.tsx` (374 LOC); falhas não se isolam.
- **Melhoria Proposta**
  > Criar `AtividadeSection.test.tsx` e `HistoricoSection.test.tsx` com props/fetch mockados cobrindo vazio, erro, paginação por cursor e troca de período.
- **Resultado Esperado**
  > Testes dedicados 0 → 2 arquivos (≥10 casos); `page.test.tsx` fica só com integração de página.
- **Tactic alvo**: Limit Structural Complexity
- **Severidade**: P2
- **Esforço estimado**: M
- **Findings relacionados**: F-testability-1
- **Métricas de sucesso**:
  - arquivos de teste dedicados: 0 → 2
  - razão test/source delta FE: 0,44 → ≥0,56
- **Risco de não fazer**: toda mudança no histórico exige depurar a página inteira.
- **Dependências**: nenhuma

### [testability-2] Congelar o relógio em page.test.tsx

- **Problema**
  > `page.test.tsx:105` usa `Date.now()` real.
- **Melhoria Proposta**
  > `jest.useFakeTimers().setSystemTime(...)` no `beforeEach` e constante `AGORA` para derivar `em`.
- **Resultado Esperado**
  > Leituras de tempo reais em testes do delta 1 → 0.
- **Tactic alvo**: Limit Non-Determinism
- **Severidade**: P2
- **Esforço estimado**: S
- **Findings relacionados**: F-testability-2
- **Métricas de sucesso**:
  - `Date.now()` sem fake timers: 1 → 0
- **Risco de não fazer**: flake em borda de horário.
- **Dependências**: nenhuma (relacionado a Modifiability: clock injetável)

### [testability-3] Testes diretos de lib/api/perfil e lib/perfil/senha + piso por pasta

- **Problema**
  > 241 LOC de lib sem teste direto e o frontend só tem piso por pasta em `lib/auth/`.
- **Melhoria Proposta**
  > Criar `perfil.test.ts` (parsing, erros HTTP) e `senha.test.ts` (regras); medir cobertura e adicionar `./lib/perfil/` e `./lib/api/` em `coverageThreshold` com o valor medido arredondado para baixo.
- **Resultado Esperado**
  > Testes diretos lib/perfil 0 → 2 arquivos; pisos por pasta FE 1 → 3.
- **Tactic alvo**: Executable Assertions
- **Severidade**: P2
- **Esforço estimado**: S
- **Findings relacionados**: F-testability-3
- **Métricas de sucesso**:
  - arquivos de teste: 0 → 2
  - pisos por pasta: 1 → 3
- **Risco de não fazer**: regressão em regra de senha passa pelo gate.
- **Dependências**: rodar coverage (fora do `--quick`) para obter o piso

### [testability-4] Casos de erro de transporte e teste de propriedade (baixa prioridade)

- **Problema**
  > SegurancaSection sem caso de fetch rejeitado/401; `fast-check` sem uso.
- **Melhoria Proposta**
  > Adicionar 2 casos (rejeição, 401) em `SegurancaSection.test.tsx`; propriedade de round-trip para `HistoricoCursor` e `periodo.ts`.
- **Resultado Esperado**
  > Casos de erro SegurancaSection 0 → 2; testes de propriedade 0 → 2.
- **Tactic alvo**: Executable Assertions
- **Severidade**: P3
- **Esforço estimado**: S
- **Findings relacionados**: F-testability-4, F-testability-5
- **Métricas de sucesso**:
  - casos SegurancaSection: 7 → 9
  - propriedades fast-check: 0 → 2
- **Risco de não fazer**: baixo; bordas continuam só manuais.
- **Dependências**: nenhuma

## 6. Notas do agente

- Reverificado do run anterior: sem P0/P1; integration roda no CI (`ci.yml:60-62`); score 8 mantido. Não li o `throw` com `CI=true` sem DSN, nem o conteúdo integral de `SegurancaSection.test.tsx`; ambos vêm do run anterior.
- `--quick`: sem coverage; a tabela por camada usa presença de teste, não %. Infra não medível (sem `infra/`).
- `InformarDestinoDialog.test.tsx` flaky, fora do delta: só nota. Cross-QA: Modifiability (Clock), Deployability (job backend-sql como gate), Integrability (job de equivalência com prod).
