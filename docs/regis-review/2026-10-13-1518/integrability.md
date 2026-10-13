---
qa: Integrability
qa_slug: integrability
run_id: 2026-10-13-1518
agent: qa-integrability
generated_at: 2026-10-13T15:40:00-03:00
scope: all
score: 7.5
findings_count: 4
cards_count: 3
---

# Integrability — Regis-Review

Escopo: apenas o delta de `fix/sispag-sync-ao-abrir` vs `origin/main` (modo --quick).

## 1. Cenário Geral (Bass General Scenario aplicado ao financeiro)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Desenvolvedor (Kavex) | Adicionar um 3º gatilho de sincronização com o Conexos (ex.: Nexxera retorno ao abrir tela) ou trocar o comportamento de TTL/cooldown | `SincronizacaoPassadaService`, `CarteiraAtualizacaoService`, rotas `/sispag/lotes/sincronizar*`, `lib/sispag.ts` | Produção Render, sessão do robô Conexos com cap, cron GitHub instável (2–3 execuções/dia) | O novo gatilho reutiliza a mesma passada, lock e relógio de TTL sem tocar o client Conexos nem o contrato HTTP existente | ≤ 3 arquivos novos/alterados, sem duplicar a lógica de TTL/lock/cooldown |

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Clients com métodos HTTP genéricos vazados no delta | 0 (delta não toca `client/`) | 0 | ✅ | `git diff --stat origin/main...HEAD` |
| Service novo chamando HTTP direto (axios/fetch) | 0; delega a `SincronizacaoLoteService` | 0 | ✅ | `SincronizacaoPassadaService.ts:1-10,202` |
| Gatilhos (rota, cron, botão) que passam por um único ponto | 3 de 3 (`executarPassada`) | 100% | ✅ | `SincronizacaoPassadaService.ts:82-93`; `SincronizarLotesSispagJob.ts` |
| Config via `EnvironmentProvider` (sem `process.env` cru) | 2 vars novas, ambas via `readMinutos` | 100% | ✅ | `EnvironmentProvider.ts:357-358,454-455` |
| Implementações paralelas de "stale-while-revalidate" (TTL+cooldown+lock+estado) | 2 (Carteira e Passada) | 1 reutilizável | ⚠️ | `CarteiraAtualizacaoService.ts:67-78` vs `SincronizacaoPassadaService.ts:99-142` |
| Resposta da rota validada com Zod no consumidor (frontend) | 0 de 2 (cast `as SincronizacaoLotes`) | ≥ 80% | ⚠️ | `src/frontend/lib/sispag.ts` (`postSincronizacaoLotes`) |
| Contract tests de resposta (fixture compartilhada BE/FE) | 0 | 1 por rota nova | ⚠️ | tipos duplicados à mão em `SincronizacaoPassadaService.ts:49-59` e `lib/sispag.ts` |
| Chaves de lock distintas entre ingestão da carteira e sincronização | 2 (`726354820` ≠ lock da ingestão) | coordenado | ⚠️ | `SincronizacaoPassadaService.ts:13` |
| Versionamento explícito de API externa | N/A (delta não adiciona chamada externa nova) | — | N/A | — |
| Infra/SSM path convention | ⚠️ Não medível localmente: não existe `infra/` | — | ⚠️ | CLAUDE.md |

## 3. Tactics — Cobertura

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Encapsulate | Passada L11 encapsulada em um serviço; job e rotas viram finos | ✅ presente | `SincronizacaoPassadaService.ts:71-93`; `routes/sispag.ts` (`/lotes/sincronizar*`) |
| Use an Intermediary | `SincronizacaoLoteService` fica entre a passada e o `ConexosClient`; lock via `PostgreeDatabaseClient.withAdvisoryLock` | ✅ presente | `SincronizacaoPassadaService.ts:74,85` |
| Restrict Communication Paths | Rota só resolve o serviço; read-only no ERP (I11a) documentado | ✅ presente | `routes/sispag.ts` (`container.resolve(SincronizacaoPassadaService)`) |
| Adhere to Standards | JSON/HTTP simples, estados como constantes tipadas | ✅ presente | `SincronizacaoPassadaService.ts:24-34` |
| Abstract Common Services | TTL/cooldown/estado copiados entre Carteira e Passada em vez de um utilitário comum | ⚠️ parcial | `CarteiraAtualizacaoService.ts:67-78`; `SincronizacaoPassadaService.ts:104-141` |
| Discover Service | N/A: SSM/registry não existe (sem `infra/`); config por env var | N/A | CLAUDE.md |
| Tailor Interface | Resposta `estado` + `passada` + `motivo` adaptada ao consumidor; 410 com `code` para clientes antigos | ✅ presente | `routes/sispag.ts` (410 `LOTE_SINCRONIZACAO_POR_LOTE_APOSENTADA`) |
| Configure Behavior | TTL e cooldown configuráveis por env | ✅ presente | `EnvironmentVars.ts:220-227` |
| Manage Resources | Ordem carteira→lotes no frontend para respeitar o cap de sessões do robô; sem garantia no servidor | ⚠️ parcial | `useCarteiraAoAbrir.ts:115`; locks distintos |
| Orchestrate | Lock advisory + run em `job_execucao` como orquestração de "uma por vez" entre servidor e runner do GitHub | ✅ presente | `SincronizacaoPassadaService.ts:82-93` |
| Manage Resource Coupling | Acoplamento temporal entre carteira e lotes feito no cliente (hook), não no servidor | ⚠️ parcial | `useCarteiraAoAbrir.ts` |
| Contract testing | Sem fixture/schema compartilhado BE↔FE; testes unitários dos dois lados com mocks | ⚠️ parcial | `SincronizacaoPassadaService.test.ts`, `page.test.tsx` |
| Versioning strategy | Rota antiga mantida como 410 (shim barato, uma função); sem prefixo de versão | ⚠️ parcial | `routes/sispag.ts` |
| Backward-compatibility shims | 2 rotas 410 (marcação manual, sincronização por lote) com `code` estável | ✅ presente | `routes/sispag.ts` |
| Observability of integration failures | Run por passada em `job_execucao` com status/errorMessage e logs com `resultados` por lote; "todas falharam" vira `error` | ✅ presente | `SincronizacaoPassadaService.ts:222-267` |

## 4. Findings

### F-integrability-1: Lógica de stale-while-revalidate duplicada entre Carteira e Passada de lotes

- **Severidade**: P2
- **Tactic violada**: Abstract Common Services
- **Localização**: `src/backend/domain/service/sispag/SincronizacaoPassadaService.ts:99-174`, `src/backend/domain/service/sispag/CarteiraAtualizacaoService.ts:60-100`
- **Evidência (objetiva)**:
  ```
  ESTADO_SINCRONIZACAO = {fresca, atualizada, em_andamento, falha_recente}  // copia do vocabulário da Carteira
  ttlMs = env.sispag*TtlMin * MIN_MS ; cooldownMs = env.sispag*CooldownMin * MIN_MS
  ```
- **Impacto técnico**: Cada novo gatilho "ao abrir a tela" (ex.: Nexxera retorno, GED) copia ~80 linhas de decisão TTL/RUNNING/cooldown; correções (ex.: run presa) precisam ser replicadas.
- **Impacto de negócio**: Custo marginal de integrar o próximo recurso (Nexxera, GED) sobe; risco de comportamento divergente entre telas.
- **Métrica de baseline**: 2 implementações; 3ª já prevista (Nexxera retorno).

### F-integrability-2: Coordenação do cap de sessões do robô Conexos feita só no frontend

- **Severidade**: P2
- **Tactic violada**: Manage Resource Coupling
- **Localização**: `src/frontend/app/sispag/useCarteiraAoAbrir.ts:115`, `SincronizacaoPassadaService.ts:13`
- **Evidência (objetiva)**:
  ```
  SISPAG_SINCRONIZACAO_LOCK_KEY = 726354820   // distinto da chave da ingestão
  useRefreshAoAbrir({ ...opts, pedir: sincronizarLotesSeDefasado })  // ordem garantida só no hook
  ```
- **Impacto técnico**: O botão forçado ("Sincronizar lotes"), o cron e outra aba podem rodar a passada L11 em paralelo à ingestão da carteira; o cap de sessões do robô é compartilhado e uma sessão extra derruba uma viva (ver memória "Probe local derruba sessão Conexos").
- **Impacto de negócio**: Falha intermitente de leitura no Conexos durante o expediente; analista vê `falha_recente` sem causa óbvia.
- **Métrica de baseline**: 2 locks independentes sobre 1 recurso (sessão do robô); 0 garantias de exclusão mútua no servidor.

### F-integrability-3: Contrato HTTP BE↔FE espelhado à mão, sem validação no consumidor

- **Severidade**: P2
- **Tactic violada**: Adhere to Standards (contract testing / boundary validation)
- **Localização**: `src/frontend/lib/sispag.ts` (`postSincronizacaoLotes`, `SincronizacaoLotes`), `SincronizacaoPassadaService.ts:49-59`
- **Evidência (objetiva)**:
  ```
  return (await res.json()) as SincronizacaoLotes
  ```
- **Impacto técnico**: Mudança de forma no backend (novo `estado`) passa no typecheck do frontend e quebra em runtime; helper de erro/fetch também é replicado (`atualizarCarteiraSeDefasada`).
- **Impacto de negócio**: Regressão de tela só detectada em produção, na rotina do analista.
- **Métrica de baseline**: 0 de 2 respostas validadas por schema; 0 testes de contrato.

### F-integrability-4: Shims 410 acumulam sem prazo de remoção

- **Severidade**: P3
- **Tactic violada**: Tailor Interface (backward-compatibility shim)
- **Localização**: `src/backend/routes/sispag.ts` (`/lotes/:id/sincronizar`, `/lotes/:id/retorno-manual`)
- **Evidência (objetiva)**: dois handlers que só devolvem `410` com `code`.
- **Impacto técnico**: Custo baixo (poucas linhas), mas sem critério de remoção.
- **Impacto de negócio**: Ruído menor; nenhum.
- **Métrica de baseline**: 2 shims 410 ativos.

## 5. Cards Kanban

### [integrability-1] Extrair política de TTL/cooldown/estado para um componente comum

- **Problema**
  > `CarteiraAtualizacaoService` e `SincronizacaoPassadaService` repetem a decisão fresca/em_andamento/falha_recente/atualizada com a mesma configuração. O próximo gatilho (Nexxera retorno, GED) seria a terceira cópia.

- **Melhoria Proposta**
  > Criar uma classe `AtualizacaoSeDefasadaPolicy` (classe exportada, arrow methods) em `domain/service/sispag/` parametrizada por pipeline, TTL e cooldown, que recebe `listRecentRuns` e devolve a decisão. Os dois serviços passam a chamar a política e só executam a ação. Tactic: Abstract Common Services.

- **Resultado Esperado**
  > Uma única implementação testada; novo gatilho em ≤ 40 linhas. 2 cópias → 1.

- **Tactic alvo**: Abstract Common Services
- **Severidade**: P2
- **Esforço estimado**: M (2–5d)
- **Findings relacionados**: F-integrability-1
- **Métricas de sucesso**:
  - Implementações de SWR: 2 → 1
  - LOC de decisão por serviço: ~80 → ≤ 15
- **Risco de não fazer**: Divergência de comportamento entre telas e custo repetido a cada integração nova.
- **Dependências**: nenhuma

### [integrability-2] Serializar o uso da sessão do robô Conexos no servidor

- **Problema**
  > A ordem carteira→lotes é imposta pelo hook do frontend; o botão forçado e o cron usam outra chave de lock e podem concorrer com a ingestão pela mesma sessão do robô.

- **Melhoria Proposta**
  > Introduzir um lock de "sessão Conexos" compartilhado (ou checar a run `running` da ingestão antes de iniciar a passada e devolver `em_andamento`), no `SincronizacaoPassadaService`/`CarteiraAtualizacaoService`. Tactic: Manage Resource Coupling.

- **Resultado Esperado**
  > Passada L11 e ingestão nunca rodam simultaneamente; leituras com Bad Credentials/sessão derrubada por concorrência: não medido → 0.

- **Tactic alvo**: Manage Resource Coupling
- **Severidade**: P2
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-integrability-2
- **Métricas de sucesso**:
  - Recursos compartilhados protegidos por um único lock: 0 → 1
- **Risco de não fazer**: Falhas intermitentes de sincronização difíceis de diagnosticar em horário de pico.
- **Dependências**: integrability-1 (opcional)

### [integrability-3] Validar as respostas de sincronização no frontend com Zod e fixar um teste de contrato

- **Problema**
  > O frontend usa `as SincronizacaoLotes` e mantém tipos duplicados; mudanças de contrato não são detectadas.

- **Melhoria Proposta**
  > Schema Zod em `src/frontend/lib/` para `SincronizacaoLotes` e um teste que parseia uma fixture JSON gerada pelo teste do backend. Extrair o helper de POST/erro comum a `atualizarCarteiraSeDefasada`. Tactic: Adhere to Standards.

- **Resultado Esperado**
  > Quebra de contrato falha no CI. Respostas validadas: 0/2 → 2/2.

- **Tactic alvo**: Adhere to Standards
- **Severidade**: P2
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-integrability-3, F-integrability-4
- **Métricas de sucesso**:
  - Respostas validadas por schema: 0 → 2
  - Testes de contrato: 0 → 1
- **Risco de não fazer**: Regressão silenciosa de tela quando o backend evoluir o contrato.
- **Dependências**: nenhuma

## 6. Notas do agente

- Escopo: só o delta; nenhum client novo foi criado, então métricas de encapsulamento de client são herdadas (✅ no delta).
- F-integrability-4 (P3) sem card próprio: coberto por menção em integrability-3; remover shims quando a tela antiga sair de cache.
- Cross-QA: F-integrability-2 toca Availability/Fault Tolerance; F-integrability-3 toca Security (Validate Input) e Testability.
