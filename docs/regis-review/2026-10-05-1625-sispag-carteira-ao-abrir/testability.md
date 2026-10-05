---
qa: Testability
qa_slug: testability
run_id: 2026-10-05-1625
agent: qa-testability
generated_at: 2026-10-05T16:40:00-03:00
scope: all
score: 7.5
findings_count: 4
cards_count: 3
---

# Testability — Regis-Review

## 1. Cenário Geral

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Desenvolvedor / CI | Mudança na regra de TTL, cooldown ou run morta da carteira SISPAG | `CarteiraAtualizacaoService`, rota `POST /sispag/carteira/atualizar`, `useCarteiraAoAbrir`, workflow `ingest-sispag.yml` | Desenvolvimento e CI, `--quick` (sem cobertura) | Testes forçam cada estado (fresca, atualizada, em_andamento, falha_recente) e quebram se a regra regredir | 4 estados + 2 bordas de tempo cobertos sem relógio real; 0 caminhos de decisão só validáveis em produção |

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| 1. Cobertura por camada (backend) | ⚠️ Não medível: `--quick` dispensa `--coverage`. Piso configurado: `domain/service/` 88% linhas / 60% branches; global 72/54/78 | 80% linhas em service | ⚠️ | `src/backend/jest.config.cjs:39-50` |
| Suítes no baseline | Backend 198 suítes / 3644 testes; frontend sispag+lib 16 / 197; todos passam | verde | ✅ | `_shared-metrics.md` |
| Arquivo de teste por arquivo novo do delta | 3 de 3 arquivos lógicos novos (service, hook, rota) têm teste | 1:1 | ✅ | `CarteiraAtualizacaoService.test.ts`, `useCarteiraAoAbrir.test.ts`, `routes/sispag.test.ts:513-540` |
| Casos no service | 10 `it` cobrindo 4 estados, TTL configurável, run morta >10 min, corrida de lock, cooldown antes e depois, propagação de erro | todas as ramificações das linhas 78-111 | ✅ | `CarteiraAtualizacaoService.test.ts:58-146` |
| Casos no hook | 5 `it` com `jest.useFakeTimers` (reconferência, desistência após 6 tentativas, unmount) | todos os caminhos | ✅ | `useCarteiraAoAbrir.test.ts:15-68` |
| Casos na rota | 2 (200 com `sispag:ver` e gatilho `abertura:<ator>`; 401). 500 propagado: 0 casos | 3 | ⚠️ | `routes/sispag.test.ts:513-540` |
| Leituras de relógio sem injeção no delta | 1 (`Date.now()` como fallback de `input.agora`, linha 65); a rota não passa `agora`, mas o service é testável | 0 não abstraídas | ✅ | `CarteiraAtualizacaoService.ts:65` |
| Testes de integração com Postgres real | 0 arquivos com `describe('integration')` no repo; repo tests usam banco mockado | ≥1 por repositório com SQL complexo | ❌ | `grep -rl "integration:" src/backend`; `PagamentoIngestaoRunRepository.test.ts:55` |
| Teste do gating de cron do workflow | 0 (condição `github.event.schedule == '0 10 * * *'` sem teste) | verificação automática | ❌ | `.github/workflows/ingest-sispag.yml:62-65` |
| Gate de cobertura em CI | `coverageThreshold` presente em backend e frontend | presente | ✅ | `jest.config.cjs:39`, `jest.config.js:41` |

## 3. Tactics — Cobertura no financeiro

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Specialized Interfaces | Service recebe `agora?` e tem constantes exportadas (`ESPERA_REFRESH_MS`, `TENTATIVAS_REFRESH`) usadas pelos testes | ✅ presente | `CarteiraAtualizacaoService.ts:62-65`; `useCarteiraAoAbrir.ts:7-9` |
| Recordable Test Cases | Sem fixtures gravadas; a ingestão é mockada na íntegra, e a resposta real do `/carteira/atualizar` não está gravada | ⚠️ parcial | `CarteiraAtualizacaoService.test.ts:37` |
| Sandbox | Mocks do repositório e da ingestão via construtor; sem Postgres de teste, o lock advisory e o SQL de `listRecentRuns` nunca rodam em teste | ⚠️ parcial | `CarteiraAtualizacaoService.test.ts:30-56` |
| Executable Assertions | `IngestLockBusyError` tipado como contenção; estado em constantes tipadas `ESTADO_CARTEIRA` | ✅ presente | `CarteiraAtualizacaoService.ts:15-25,108` |
| Abstract Data Sources | `PagamentoIngestaoRunRepository` e `EnvironmentProvider` injetados via tsyringe | ✅ presente | `CarteiraAtualizacaoService.ts:53-58` |
| Limit Structural Complexity | Service com 114 LOC e 4 saídas, hook com 78 LOC; testes de 151 e 72 LOC | ✅ presente | `_shared-metrics.md` |
| Limit Non-Determinism | Relógio injetável no service, timers falsos no hook; run morta/cooldown testados por tempo calculado, sem sleep | ✅ presente | `useCarteiraAoAbrir.test.ts:11`; `CarteiraAtualizacaoService.test.ts:10` |

## 4. Findings

### F-testability-1: Lock advisory e regra de run morta nunca exercitados contra um banco real

- **Severidade**: P2 (sem baseline numérico de falha; o risco é de lacuna de evidência)
- **Tactic violada**: Sandbox
- **Localização**: `CarteiraAtualizacaoService.ts:82-85`; `PagamentoIngestaoRunRepository.ts:87`; `PagamentoIngestaoRunRepository.test.ts:55`
- **Evidência (objetiva)**:
  ```
  const [ultima] = await this.runRepo.listRecentRuns(1);
  if (ultima?.status === 'running' && agora - Date.parse(ultima.startedAt) < RUN_PRESA_MS)
  ```
  O teste da run morta (`.test.ts:99`) fornece `startedAt` pronto. O formato que o SQL devolve (ISO string vs Date, fuso) e a ordenação de `listRecentRuns(1)` não são verificados. 0 testes de integração no repo.
- **Impacto técnico**: se `startedAt` vier num formato que `Date.parse` não leia, retorna `NaN`, a comparação é `false` e a run `running` nunca bloqueia, o que pode disparar ingestões paralelas (só o lock as segura).
- **Impacto de negócio**: sessões Conexos limitadas por usuário podem ser gastas por aberturas concorrentes de tela.
- **Métrica de baseline**: integração com Postgres real 0 → o delta tem 0 casos; não medível o formato real sem banco.

### F-testability-2: Gating por `github.event.schedule` do workflow sem teste

- **Severidade**: P2
- **Tactic violada**: Executable Assertions
- **Localização**: `.github/workflows/ingest-sispag.yml:22,62-65`
- **Evidência (objetiva)**:
  ```
  if: github.event_name == 'workflow_dispatch' || github.event.schedule == '0 10 * * *'
  ```
  A condição compara com a string cron literal; se alguém editar a expressão do `schedule:` e não esta, a formação de lotes deixa de rodar sem erro algum (a run aparece como sucesso, o que já ocorreu em outro incidente com 0 títulos).
- **Impacto técnico**: duas cópias da mesma string sem verificação cruzada.
- **Impacto de negócio**: lotes deixam de ser formados pela manhã e o analista só percebe ao abrir a tela.
- **Métrica de baseline**: 2 ocorrências da expressão `0 10 * * *`, 0 testes de consistência.

### F-testability-3: Rota sem teste do caminho de erro (500) e sem teste de contrato do payload

- **Severidade**: P3
- **Tactic violada**: Recordable Test Cases
- **Localização**: `routes/sispag.test.ts:513-540`; `lib/sispag.ts` (cliente do frontend)
- **Evidência (objetiva)**: 2 casos (200 e 401). O service testa a propagação (`.test.ts:146`) e a tela testa o erro da chamada (`page.test.tsx:409`), mas nenhum teste liga os dois: 500 do backend não é verificado na rota.
- **Impacto técnico**: o mapeamento erro → 500 depende do handler global, sem asserção neste endpoint.
- **Impacto de negócio**: baixo; a tela já degrada graciosamente.
- **Métrica de baseline**: casos de rota 2 → 3 desejado.

### F-testability-4: Cobertura do delta não medida nesta rodada

- **Severidade**: P3
- **Tactic violada**: Executable Assertions
- **Localização**: `jest.config.cjs:39-50`
- **Evidência (objetiva)**: `--quick` pulou `--coverage`; o piso de `domain/service/` é 88% linhas, mas a cobertura do arquivo novo não foi medida.
- **Impacto técnico**: não se sabe se `CarteiraAtualizacaoService.ts` está acima do piso; pela leitura, as linhas 78-111 têm teste.
- **Impacto de negócio**: nenhum conhecido.
- **Métrica de baseline**: não medível localmente nesta rodada.

## 5. Cards Kanban

### [testability-1] Cobrir o repositório de runs de ingestão contra Postgres real

- **Problema**
  > A regra de run morta e o lock advisory dependem de SQL que só roda mockado; 0 testes de integração no repo. O formato de `startedAt` devolvido por `listRecentRuns` nunca é validado contra o banco.

- **Melhoria Proposta**
  > Adicionar `describe('integration: PagamentoIngestaoRunRepository')` (Postgres efêmero, marcado e fora do ciclo unitário) com `listRecentRuns(1)`, `findLatestSuccessFinishedAt` e uma run `running` com `startedAt` de 11 min atrás passada pelo `CarteiraAtualizacaoService` real. Tactic: Sandbox.

- **Resultado Esperado**
  > Testes de integração em repositórios do SISPAG 0 → 3 casos; regra de run morta validada ponta a ponta.

- **Tactic alvo**: Sandbox
- **Severidade**: P2
- **Esforço estimado**: M
- **Findings relacionados**: F-testability-1
- **Métricas de sucesso**:
  - Arquivos de integração: 0 → 1
  - Casos sobre `pagamento_ingestao_run`: 0 → 3
- **Risco de não fazer**: uma mudança no formato da coluna quebra o freio de concorrência em silêncio.
- **Dependências**: banco de teste (docker ou serviço do CI)

### [testability-2] Garantir por teste que o `schedule` e o `if` do workflow concordam

- **Problema**
  > A mesma expressão cron aparece em `schedule:` e no `if`; divergência desliga a formação matinal sem falha visível.

- **Melhoria Proposta**
  > Teste Jest leve que lê o YAML e afirma que `github.event.schedule == '<expr>'` usa uma expressão presente em `on.schedule[].cron`. Tactic: Executable Assertions.

- **Resultado Esperado**
  > Testes sobre workflows 0 → 1; divergência de expressão detectada no PR (2 cópias → 1 fonte verificada).

- **Tactic alvo**: Executable Assertions
- **Severidade**: P2
- **Esforço estimado**: S
- **Findings relacionados**: F-testability-2
- **Métricas de sucesso**:
  - Testes de consistência de workflow: 0 → 1
- **Risco de não fazer**: lotes deixam de ser formados após uma edição inocente do cron.
- **Dependências**: nenhuma

### [testability-3] Acrescentar o caso 500 na rota de atualização da carteira

- **Problema**
  > A rota tem 2 casos (200, 401); o erro inesperado do service não é afirmado no nível HTTP.

- **Melhoria Proposta**
  > Em `routes/sispag.test.ts`, `atualizarSeDefasada` rejeita e a rota responde 500 com mensagem em português. Tactic: Recordable Test Cases.

- **Resultado Esperado**
  > Casos da rota 2 → 3.

- **Tactic alvo**: Recordable Test Cases
- **Severidade**: P3
- **Esforço estimado**: S
- **Findings relacionados**: F-testability-3, F-testability-4
- **Métricas de sucesso**:
  - Casos de `POST /sispag/carteira/atualizar`: 2 → 3
- **Risco de não fazer**: baixo; regressão no mapeamento de erro passa sem alerta.
- **Dependências**: nenhuma

## 6. Notas do agente

- Escopo: só o delta; `--quick`, sem cobertura (métrica 1 não medível localmente, piso de configuração citado).
- Pontos fortes: relógio injetável (`agora`), constantes exportadas para os timers falsos, DI por construtor.
- Cross-QA: F-testability-2 toca Deployability (gate do cron); F-testability-1 toca Fault Tolerance (run morta, lock) e Availability.
