---
qa: Testability
qa_slug: testability
run_id: 2026-10-02-1636
agent: qa-testability
generated_at: 2026-10-02T16:50:00Z
scope: backend
score: 8.5
findings_count: 4
cards_count: 3
---

# Testability — Regis-Review

## 1. Cenário Geral (Bass General Scenario)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Desenvolvedor / AutoLoopRunner | Mudança na política de senha ou na ordem de efeitos (GoTrue → banco → trilha) | `OwnPasswordService`, `UserRepository.updatePassword`, `routes/me.ts`, `rateLimit.ts` | Pós-implementação, `--quick`, sem coverage | Testes forçam falha de cada passo e afirmam estado final e log, sem rede | 58 testes do delta verdes em ~8 s; 0 chamadas de rede reais; falha no GoTrue prova ROLLBACK e trilha inalterada |

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| **1. Cobertura por camada (delta)** | ⚠️ **Não medível nesta rodada** (`--quick`). Pisos enforçados no `jest.config.cjs`: global 72% linhas / 54% branches / 78% funções; `domain/service/` 88% linhas / 60% branches | 80% linhas, 70% branches nos services/repos | ⚠️ não medido; gate presente | `src/backend/jest.config.cjs:39-50` |
| Proxy: testes por arquivo-fonte do delta | 10 arquivos de teste para 9 fontes de produção novos/alterados (`OwnPasswordService`, `PasswordPolicy`, `me`, `rateLimit`, `redact`, `UserRepository`, `CredentialMirror`, `SupabaseAuthClient`, migration 0073) | ≥ 0,5 | ✅ ~1,1 | `_shared-metrics.md` |
| Testes dos 4 arquivos centrais do delta | 58 passam, 0 falham (OwnPasswordService 22, me 18, rateLimit 10, PasswordPolicy 8) | 100% verdes | ✅ | `npx jest OwnPasswordService PasswordPolicy me.test rateLimit` |
| Suíte backend completa (baseline) | 189 suítes / 3498 testes / 0 falhas; `test:sql` 5 suítes / 53 testes | verde | ✅ | `_shared-metrics.md` |
| Teste de integração real (Postgres) da migration 0073 | 1 (`0073_*.integration.test.ts`) | ≥ 1 por SQL complexo | ✅ | `ls src/backend/migrations` |
| Leituras de tempo não injetáveis no delta (fonte) | 0 em `OwnPasswordService`, `PasswordPolicy`, `me`, `rateLimit`; 4 `Date.now()` pré-existentes em `SupabaseAuthClient.ts:312,399,421,432` | 0 | ⚠️ (pré-existente, só no client) | grep |
| Aleatoriedade no delta | 0 | 0 | ✅ | grep |
| Tamanho do maior teste do delta | 403 LOC (`OwnPasswordService.test.ts`) | ≤ 500 | ✅ | `wc -l` |
| Property-based (fast-check) no delta | 0 | opcional | ⚠️ | grep |
| Rate limiter exercitado em teste | `buildOwnPasswordLimiter` aceita `SessionLimiterOptions` e tem 10 testes; limiter desligado por `NODE_ENV=test` salvo opção explícita | testável | ✅ | `http/rateLimit.ts:12,91` |
| Estilo de composição nos testes de rota | `me.test.ts:24` faz `container.resolve.bind(container)` para substituir seletivamente | injeção direta | ⚠️ parcial | `routes/me.test.ts:24` |
| Coverage frontend | ⚠️ Não aplicável: frontend fora do delta | n/a | N/A | escopo |

## 3. Tactics — Cobertura

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Specialized Interfaces | `buildMeRouter` recebe dependências; `buildOwnPasswordLimiter(options)` aceita opções de teste; `LOGOUT_SCOPE` tipado | ✅ presente | `routes/me.ts`, `http/rateLimit.ts:91` |
| Recordable Test Cases | Roteiro de QA real contra GoTrue v2.197 registrado (204/400/422/429/503); sem fixtures gravadas de respostas do GoTrue nos testes | ⚠️ parcial | `auth-senha-propria-interview.md`; `SupabaseAuthClient.test.ts` usa respostas escritas à mão |
| Sandbox | GoTrue + Postgres 17 descartáveis; `probe-gotrue-local.ts` recusa URL não-local; `test:sql` | ✅ presente | `jobs/probe-gotrue-local.ts`, `npm run test:sql` |
| Executable Assertions | Teste com banco falso registra `BEGIN, trava, escrita, admin, ROLLBACK`; trilha e `password_hash` afirmados; teste de que a senha nunca vai ao log; migration com `0073.test.ts` | ✅ presente | `UserRepository.test.ts:742-817`, `SupabaseAuthClient.test.ts:198` |
| Abstract Data Sources | `SupabaseAuth` como interface; repositório injetado via tsyringe | ✅ presente | `domain/interface/auth/SupabaseAuth.ts` |
| Limit Structural Complexity | Serviço de 206 LOC, rota de 184 LOC, arquivos de teste ≤ 403 LOC | ✅ presente | `wc -l` |
| Limit Non-Determinism | Sem relógio nem aleatoriedade no delta; limiter por janela precisa de opções de teste; `Date.now()` do client sem `Clock` | ⚠️ parcial | grep; `SupabaseAuthClient.ts:312-432` |

## 4. Findings

### F-testability-1: Cobertura do delta não medida e sem piso por arquivo para os novos serviços de senha

- **Severidade**: P2
- **Tactic violada**: Executable Assertions
- **Localização**: `src/backend/jest.config.cjs:39-50`
- **Evidência (objetiva)**:
  ```
  coverageThreshold: global 72/54/78; './domain/service/': 88/60
  (sem entrada para domain/service/auth/OwnPasswordService.ts nem http/rateLimit.ts)
  ```
- **Impacto técnico**: o piso de `domain/service/` cobre o diretório inteiro; uma queda de branches em `OwnPasswordService` (23 caminhos de erro) some no agregado.
- **Impacto de negócio**: troca de senha é fluxo de segurança; regressão silenciosa de cobertura aumenta o custo de auditoria.
- **Métrica de baseline**: pisos por arquivo para o delta: 0 de 3 (`OwnPasswordService`, `PasswordPolicy`, `buildOwnPasswordLimiter`).

### F-testability-2: Sem fixtures gravadas do GoTrue para `updateOwnPassword`/`logout`

- **Severidade**: P2
- **Tactic violada**: Recordable Test Cases
- **Localização**: `src/backend/domain/client/SupabaseAuthClient.test.ts:125-198`
- **Evidência (objetiva)**:
  ```
  Respostas do GoTrue montadas à mão no teste; a validação real existe só no roteiro manual (v2.197)
  ```
- **Impacto técnico**: uma mudança de contrato do GoTrue (ex.: código de erro para senha igual à atual) não quebra nenhum teste automatizado.
- **Impacto de negócio**: a quebra aparece em produção como 503/500 na tela do usuário.
- **Métrica de baseline**: fixtures gravadas do GoTrue: 0; roteiros reais automatizados: 0 (1 manual).

### F-testability-3: `me.test.ts` substitui o container por `container.resolve.bind`

- **Severidade**: P3
- **Tactic violada**: Specialized Interfaces
- **Localização**: `src/backend/routes/me.test.ts:24`
- **Evidência (objetiva)**:
  ```
  const real = container.resolve.bind(container);
  ```
- **Impacto técnico**: acopla o teste ao container global; ordem de testes pode vazar estado.
- **Impacto de negócio**: baixo; custo de manutenção dos testes de rota.
- **Métrica de baseline**: 1 uso de container resolvido em teste de rota do delta, contra 0 desejados com `buildMeRouter(deps)`.

### F-testability-4: `Date.now()` direto no `SupabaseAuthClient` (pré-existente)

- **Severidade**: P3
- **Tactic violada**: Limit Non-Determinism
- **Localização**: `src/backend/domain/client/SupabaseAuthClient.ts:312,399,421,432`
- **Evidência (objetiva)**:
  ```
  expiresAt: r.expires_at ?? Math.floor(Date.now() / 1000) + r.expires_in
  ```
- **Impacto técnico**: expiração e banimento dependem do relógio real; testes precisam de fake timers.
- **Impacto de negócio**: baixo; risco de teste frágil perto de limites de tempo.
- **Métrica de baseline**: 4 leituras de tempo sem `Clock` no client; 0 no código novo do delta.

Sem P0 neste delta: os fluxos de escrita (senha, trilha, ROLLBACK) têm teste de ordem e de falha parcial, e há teste de integração de SQL.

## 5. Cards Kanban

### [testability-1] Fixar pisos de cobertura por arquivo para o fluxo de senha

- **Problema**
  > O piso de `domain/service/` é agregado; os 22 testes do `OwnPasswordService` não são protegidos contra queda de cobertura isolada.
- **Melhoria Proposta**
  > Rodar coverage uma vez, medir `OwnPasswordService`, `PasswordPolicy` e `rateLimit.ts`, e adicionar entradas por arquivo no `coverageThreshold` (ratchet, medido arredondado para baixo).
- **Resultado Esperado**
  > Pisos por arquivo no delta 0 → 3; cobertura de linhas dos arquivos de senha com piso ≥ 90%.
- **Tactic alvo**: Executable Assertions
- **Severidade**: P2
- **Esforço estimado**: S
- **Findings relacionados**: F-testability-1
- **Métricas de sucesso**:
  - Entradas por arquivo no `coverageThreshold`: 0 → 3
- **Risco de não fazer**: regressão silenciosa de branches nos caminhos de erro de segurança.
- **Dependências**: nenhuma

### [testability-2] Gravar fixtures de resposta do GoTrue e usá-las nos testes do client

- **Problema**
  > O contrato com o GoTrue só foi verificado manualmente; os testes usam respostas inventadas.
- **Melhoria Proposta**
  > Capturar respostas reais (PUT /user, POST /logout, erros 4xx) do GoTrue local do `probe-gotrue-local.ts` em `__fixtures__/` e consumi-las em `SupabaseAuthClient.test.ts` (Recordable Test Cases).
- **Resultado Esperado**
  > Fixtures gravadas 0 → 6; testes do client ancorados em respostas reais.
- **Tactic alvo**: Recordable Test Cases
- **Severidade**: P2
- **Esforço estimado**: S
- **Findings relacionados**: F-testability-2
- **Métricas de sucesso**:
  - Fixtures do GoTrue: 0 → 6
- **Risco de não fazer**: upgrade do GoTrue quebra a troca de senha sem sinal em CI.
- **Dependências**: nenhuma

### [testability-3] Injetar `Clock` no `SupabaseAuthClient` e injetar deps em `me.test.ts`

- **Problema**
  > 4 `Date.now()` no client e um `container.resolve.bind` no teste de rota deixam estado global e tempo real nos testes de auth.
- **Melhoria Proposta**
  > Introduzir um `ClockProvider` injetável no client; trocar o bind do container por `buildMeRouter(deps)` com mocks.
- **Resultado Esperado**
  > Leituras de tempo não injetáveis no client 4 → 0; usos de container em teste de rota 1 → 0.
- **Tactic alvo**: Limit Non-Determinism
- **Severidade**: P3
- **Esforço estimado**: S
- **Findings relacionados**: F-testability-3, F-testability-4
- **Métricas de sucesso**:
  - `Date.now()` no client: 4 → 0
  - `container.resolve` em `me.test.ts`: 1 → 0
- **Risco de não fazer**: baixo; testes de expiração continuam dependendo de fake timers.
- **Dependências**: nenhuma

## 6. Notas do agente

- Escopo: só o delta; coverage não rodado (`--quick`), então a métrica 1 está declarada como não medida e os pisos existentes foram citados.
- Rodei os 4 arquivos de teste centrais: 58/58 verdes. Nenhum arquivo-fonte foi editado.
- Cross-QA: Limit Non-Determinism (`Clock`) toca Modifiability; fixtures do GoTrue tocam Integrability; pisos de coverage tocam Deployability; ordem BEGIN/ROLLBACK testada toca Fault Tolerance.
