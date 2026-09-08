---
qa: Availability
qa_slug: availability
run_id: 2026-09-08-1834
agent: qa-availability
generated_at: 2026-09-08T18:34:00-03:00
scope: frontend
score: 8.0
findings_count: 3
cards_count: 3
---

# Availability — Regis-Review

> **Escopo do delta.** Review de DELTA `permutas-fixture-fonte` (commit `27023a9`,
> 10 arquivos, +558 / −19). O delta é 100% `src/frontend/` + 1 doc de ontologia — não
> toca backend, jobs, migrations nem rotas. Sob a ótica de disponibilidade do
> **negócio** (a analista consegue confiar no painel para decidir baixa de
> adiantamento?), o delta é uma correção de disponibilidade de **sinal**, não de
> tempo de resposta: antes, a tela devolvia dados fantasma quando o backend falhava
> ou a carteira estava vazia — availability "aparente" 100%, availability real 0%
> quando o dado importava. Após o fix, falha é falha e o operador sabe.
>
> `infra/` não existe neste repo (ver `_shared-metrics.md`). Toda métrica de
> CloudWatch/EventBridge/DLQ/tenant é declarada **não medível**, jamais como
> finding.

## 1. Cenário Geral (Bass General Scenario aplicado ao nf-projects)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Backend `GET /permutas/gestao` (Render) e/ou rede intermediária | Falha transitória (HTTP 5xx, timeout de rede, 401 de sessão expirada) durante o refresh da Gestão de Permutas | `fetchGestaoPermutas` (`src/frontend/lib/api.ts`) → `usePermutasData` → `page.tsx` | Analista com a tela aberta, revisando pendentes e casamentos permuta↔invoice | O aplicativo (i) NÃO substitui o dado do banco por fixture; (ii) preserva a última carga bem-sucedida na tela; (iii) exibe banner de falha com retry manual; (iv) 401 sobe para o `SessionExpiredModal` em vez de virar fixture | 100% das falhas de refresh preservam o dado anterior + sinalizam o operador; 0 caminhos onde falha vira dado falso silencioso; 100% dos builds fora de `NEXT_PUBLIC_ENV=local` estouram se `NEXT_PUBLIC_DEMO_MODE=true` |

Análogo (não coberto pelo delta) que fica de contexto: falha em `apiFetch` sem
`AbortController`/timeout deixa o spinner de carga inicial rodando enquanto o
navegador mantiver a conexão pendurada — degrada UX mas não corrompe dado.

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Caminhos em `fetchGestaoPermutas` que devolvem fixture sem sinalizar (fallback silencioso) | **0** (era 2) | 0 | ✅ | `git show origin/main:src/frontend/lib/api.ts \| grep -c 'return gestaoPermutasFixture'` = 2; `cat src/frontend/lib/api.ts \| grep -c 'return gestaoPermutasFixture'` = 2, ambos agora sob `if (isDemoMode())` (linhas 92 e 116) |
| Caminhos gated por `isDemoMode()` (opt-in explícito) | 2 | 2 | ✅ | `src/frontend/lib/api.ts:92`, `src/frontend/lib/api.ts:116` |
| Fail-fast se demo mode ligado fora de `local` | Presente | Presente | ✅ | `src/frontend/lib/features.ts:44-56` (`assertDemoEnv()` chamado em `src/frontend/lib/api.ts:22`) |
| Falha de refresh preserva o dado anterior (Degradation) | Sim | Sim | ✅ | `src/frontend/app/permutas/components/usePermutasData.ts:47-53` (não faz `setData(null)` no catch) |
| Retry manual disponível ao operador em falha | Sim (botão "Tentar novamente") | Sim | ✅ | `src/frontend/app/permutas/components/banners.tsx:71-77`, `src/frontend/app/permutas/page.tsx:740-744` |
| `SessionExpiredError` propaga em vez de virar fixture | Sim | Sim | ✅ | `src/frontend/lib/api.ts:114-118` (só entra no fixture se `isDemoMode()`); `usePermutasData.ts:50` (`isSessionExpiredError` filtra do banner genérico) |
| Suítes de teste cobrindo os 3 caminhos (vazio, falha, demo) + fail-fast + banners | 3 novas suítes / 20 casos, todas verdes | ≥1 por caminho | ✅ | `_shared-metrics.md` (baseline 26/194 → 29/214); `src/frontend/__tests__/permutas-fonte-dado.test.ts`, `features-demo-mode.test.ts`, `banners.test.tsx` |
| Timeout / `AbortController` no `fetch` do painel de permutas | **0** | ≥1 (com deadline explícito) | ❌ | `grep -c 'AbortController\|AbortSignal\|signal:' src/frontend/lib` = 0; `apiFetch` em `src/frontend/lib/http.ts:29-36` não seta `signal` |
| Retry automático com backoff no cliente | 0 (retry é 100% manual, dirigido pela analista) | Aceitável para painel human-in-loop; documentar | ⚠️ | Nenhum uso de `RetryExecutor` no frontend (Executors são backend); `usePermutasData.ts` só re-chama via `load()` no clique |
| Fixture-fallback SILENCIOSO remanescente em outras libs do frontend | **0** (foi removido em `recebimentos.ts` antes deste delta) | 0 | ✅ | `src/frontend/lib/recebimentos.ts:830-855` já lança em vez de cair em fixture; doc de ontologia (`fonte-do-dado-permutas.md` §Backlog) confirma |

> ⚠️ **Não medível localmente**: MTTR real, uptime do endpoint `/permutas/gestao`,
> taxa de 5xx, latência p95 em produção. Requer instrumentação de observabilidade
> em Render/Vercel (o alvo Terraform+CloudWatch não existe neste repo — ver
> `_shared-metrics.md`). Recomendação: emitir um evento client-side quando o
> `LoadErrorBanner` aparecer (com `res.status` e latência da chamada), enviado
> a um sink já configurado no ambiente atual, para se ter um sinal de
> disponibilidade percebida pela analista sem esperar a migração para AWS.

> ⚠️ **Não medível localmente**: DLQ, alarmes CloudWatch, tenant blast radius,
> configuração de tempo limite de Lambda. `infra/` não existe.

## 3. Tactics — Cobertura no nf-projects

Escopo restrito ao **delta**. Tactics fora do raio do delta são marcadas `N/A`
com justificativa, sem inflar findings.

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Ping/Echo | Nenhuma sonda ativa cliente→backend | N/A | Fora do escopo do delta; painel é read-model, latência percebida via ausência de resposta |
| Heartbeat | Ausente | N/A | Idem; heartbeat é do lado servidor e `infra/` não existe |
| Monitor | Ausente localmente; em produção, logs Render + Vercel | ⚠️ parcial | Não medível neste repo; delta adiciona sinal semântico (`fonte`) que pode virar métrica |
| Timestamp | `geradoEm` presente na resposta e refletido no `usePermutasData` | ✅ presente | `src/frontend/lib/api.ts:102` (`geradoEm: json.geradoEm`) |
| Sanity Checking | Response validada por forma (`pendentes`/`invoicesEmAberto`) antes de decidir vazio vs. fixture; discriminante `fonte` chega à UI | ✅ presente | `src/frontend/lib/api.ts:88-93`; `src/frontend/app/permutas/page.tsx:723` (`DemoDataBanner fonte={data?.fonte ?? 'banco'}`) |
| Condition Monitoring | Estado `error` em `usePermutasData` é o monitor da última carga | ✅ presente | `src/frontend/app/permutas/components/usePermutasData.ts:20-27` |
| Voting | N/A | N/A | Read-model single-source (backend Render → Postgres) — não há redundância a votar |
| Exception Detection | `catch` agora distingue `SessionExpiredError` (para o modal) de erro genérico (para o banner) e re-lança fora de demo | ✅ presente | `src/frontend/lib/api.ts:112-118`, `src/frontend/app/permutas/components/usePermutasData.ts:47-53` |
| Self-Test | N/A | N/A | Fora do escopo; painel é UI cliente |
| Active Redundancy | N/A | N/A | Single-region Render — nenhum replica ativa no delta |
| Passive Redundancy | N/A | N/A | Idem |
| Spare | N/A | N/A | Idem |
| Exception Handling | Handler explícito por caminho (rede, HTTP não-OK com `detail`, 401) e catch do effect só seta banner se não for 401 | ✅ presente | `src/frontend/lib/api.ts:81-118`; `usePermutasData.ts:64-72` |
| Rollback | N/A | N/A | Read path — nada a reverter |
| Software Upgrade | N/A | N/A | Fora do escopo de delta de UI |
| Retry | Retry MANUAL via botão "Tentar novamente"; sem retry automático nem backoff | ⚠️ parcial | `src/frontend/app/permutas/page.tsx:740-744` (retry manual); ausência de `RetryExecutor` cliente é aceitável para painel human-in-loop, mas não há política documentada de deadline entre tentativas |
| Ignore Faulty Behavior | Antes: caso patológico ("ignorar" backend caído devolvendo fixture) — corrigido. Agora: só ignora em modo demo explícito | ✅ presente | `src/frontend/lib/api.ts:114-118` (só devolve fixture se `isDemoMode()`) |
| Degradation | Falha de refresh mantém a última carga bem-sucedida na tela; banner sinaliza que pode estar desatualizada | ✅ presente | `usePermutasData.ts:47-53` (não zera `data`); `banners.tsx:64-79` (`stale` muda o copy); `page.tsx:724-726` |
| Reconfiguration | Flag `NEXT_PUBLIC_DEMO_MODE` reconfigura a fonte (banco↔fixture) em tempo de build; `assertDemoEnv()` recusa reconfiguração fora de `local` | ✅ presente | `src/frontend/lib/features.ts:26-56` |
| Shadow | N/A | N/A | Não há segundo path a rodar em sombra |
| State Resynchronization | Retry recarrega snapshot completo do backend; não há reconciliação incremental | ⚠️ parcial | `usePermutasData.ts:load()` refetch total — aceitável para o volume atual (carteira "vazia" é comum, tamanho conhecido) |
| Escalating Restart | N/A | N/A | Cliente browser; recarregar a página é a única "restart" — coberto pelo próprio botão de retry |
| Non-Stop Forwarding | N/A | N/A | Não se aplica a UI |
| Removal from Service | `assertDemoEnv()` faz o inverso benéfico: RECUSA subir um build com config perigosa. Análogo ao `assertAuthEnv()` (`lib/auth/env.ts`) | ✅ presente (analogia) | `src/frontend/lib/features.ts:44-56`; teste `features-demo-mode.test.ts:44-56` |
| Transactions | N/A | N/A | Read path |
| Predictive Model | N/A | N/A | Fora do escopo |
| Exception Prevention | `isDemoMode()` só aceita a string exata `'true'` — evita "1"/"yes" acidentais; `LoadErrorBanner` só renderiza com dados carregados (evita duplicar mensagem com `EmptyState`) | ✅ presente | `src/frontend/lib/features.ts:36` (`=== 'true'`); `page.tsx:724-726` (`{data ? <LoadErrorBanner …/> : null}`) |
| Increase Competence Set | Documentação do invariante em `ontology/ui-flows/fonte-do-dado-permutas.md` e no docblock de `fetchGestaoPermutas` reduz reincidência do padrão | ✅ presente | `ontology/ui-flows/fonte-do-dado-permutas.md`; `src/frontend/lib/api.ts:64-79` |

## 4. Findings

### F-availability-1: `apiFetch` sem timeout/`AbortController` — backend pendurado deixa spinner infinito na carga inicial

- **Severidade**: P2 (débito técnico defensável — precede o delta, não é regressão; sem baseline numérico de produção para justificar P1)
- **Tactic violada**: Exception Detection (Timeout como sub-tactic)
- **Localização**: `src/frontend/lib/http.ts:29-36`, `src/frontend/lib/api.ts:82-85`
- **Evidência (objetiva)**:
  ```
  $ grep -rn "AbortController\|AbortSignal\|signal:" src/frontend/lib --include="*.ts"
  (vazio — 0 hits em 62 chamadas de fetch/apiFetch no frontend)
  ```
  ```ts
  // src/frontend/lib/http.ts:29-36
  export const apiFetch = async (input, init) => {
    const res = await fetch(input, init)   // sem signal, sem deadline
    if (res.status === 401) { emitSessionExpired(); throw new SessionExpiredError() }
    return res
  }
  ```
- **Impacto técnico**: se o backend Render aceita a conexão mas nunca responde (ex.: pool RDS travado, cold start prolongado), o `fetch()` fica pendurado por até o timeout default do navegador (frequentemente ≥60s no Chromium). Enquanto isso, `loading=true` e `error=null` — o operador vê o skeleton sem sinal de retry. O delta melhora TUDO menos este caminho, porque o `catch` só dispara depois que o fetch resolve ou rejeita.
- **Impacto de negócio**: no pior caso a analista fecha a aba e reabre, o que também limpa a última carga preservada — perdendo a única vantagem do banner de refresh degradado. Não é perda de dado do banco; é perda de tempo humano e frustração.
- **Métrica de baseline**: 0/62 chamadas de fetch no `src/frontend/lib` têm timeout explícito. Não há medição de p99 de latência do `/permutas/gestao` neste repo (declarado não medível na seção 2).

### F-availability-2: retry só existe manual — nenhuma política de backoff/re-tentativa automática para falhas transitórias

- **Severidade**: P3 (melhoria opcional — o desenho human-in-loop torna o retry manual defensável; não há incidente conhecido)
- **Tactic violada**: Retry (parcial)
- **Localização**: `src/frontend/app/permutas/components/usePermutasData.ts:41-58`, `src/frontend/app/permutas/page.tsx:740-744`
- **Evidência (objetiva)**:
  ```ts
  // usePermutasData.ts — o único caminho de retry é a função `load()`,
  // que só é chamada pelo clique do botão em banners/EmptyState.
  const load = React.useCallback(async () => { setLoading(true); try { setData(await fetchGestaoPermutas()); setError(null) } catch (err) { … } finally { setLoading(false) } }, [])
  ```
- **Impacto técnico**: falha transitória de 1–2s (cold start Render, jitter Vercel↔Render) obriga o operador a clicar. Isso é aceitável porque (a) o painel é human-in-loop, (b) o dado anterior fica visível, (c) um retry automático agressivo em cima de um backend Render pequeno pioraria contenção.
- **Impacto de negócio**: um clique a mais em um caminho raro. Sem baseline de frequência real de falha, não é P1/P0.
- **Métrica de baseline**: 0 usos de `RetryExecutor`/backoff no frontend. Sem taxa observada de falha transitória neste repo.

### F-availability-3: sem sinal semântico de disponibilidade emitido quando o banner de falha aparece

- **Severidade**: P2 (débito de observabilidade — bloqueia medir MTTR real percebido pelo cliente)
- **Tactic violada**: Monitor
- **Localização**: `src/frontend/app/permutas/components/usePermutasData.ts:41-58`, `src/frontend/app/permutas/components/banners.tsx:53-79`
- **Evidência (objetiva)**: o `catch` em `usePermutasData.load()` seta `error` para o banner mas não emite nada para nenhum sink (analytics/logrocket/sentry/dsn). O `_shared-metrics.md` declara métricas de MTTR "não medíveis" — parte disso é infraestrutural (não temos CloudWatch), parte é opção: hoje o cliente vê a falha e não avisa nada.
- **Impacto técnico**: sem essa emissão, "quantas vezes a analista viu o `LoadErrorBanner` nesta semana?" é indistinguível de "quantas vezes ela tomou uma decisão sobre carteira desatualizada?"
- **Impacto de negócio**: impede priorizar o F-availability-1 e o F-availability-2 com número real. Investimento em timeout ou backoff automático fica só na intuição.
- **Métrica de baseline**: 0 eventos client-side emitidos por falha de `fetchGestaoPermutas`. Nenhum dashboard/relatório vinculado.

## 5. Cards Kanban

### [availability-1] Adicionar deadline explícito (timeout/`AbortController`) ao `apiFetch`

- **Problema**
  > `apiFetch` (`src/frontend/lib/http.ts:29-36`) chama `fetch()` sem `signal` nem deadline. Se o backend aceita a conexão mas trava (cold start Render, pool RDS saturado, proxy intermediário mudo), o painel de permutas fica em `loading=true` indefinidamente — o `catch` que abre o banner de retry só dispara depois de o fetch rejeitar. O delta atual melhora o comportamento em ERRO, mas não em SILÊNCIO.

- **Melhoria Proposta**
  > Instrumentar `apiFetch` com `AbortController` e um deadline default (proposta: 15 s para leituras interativas, override por chamada). Traduzir `AbortError` em um `Error` com mensagem em pt-BR ("O backend demorou mais que o esperado — tentar de novo?"). Cobrir com teste em `src/frontend/__tests__/` que valida que uma promessa nunca-resolvida vira erro em ≤15 s. Tactic Bass: Exception Detection / Timeout.

- **Resultado Esperado**
  > 100% das chamadas de `apiFetch` respeitam um deadline. `loading` termina em ≤15 s mesmo com backend pendurado; o banner de retry aparece e o operador tem controle.
  > - Chamadas de `apiFetch` sem `signal`: 62 → 0.
  > - Tempo máximo de spinner sem sinal de erro: ilimitado → ≤15 s.

- **Tactic alvo**: Exception Detection (Timeout)
- **Severidade**: P2
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-availability-1
- **Métricas de sucesso**:
  - `grep -c 'AbortController\|signal:' src/frontend/lib/http.ts`: 0 → 1
  - Teste "backend pendurado → erro em ≤15 s": ausente → presente e verde
- **Risco de não fazer**: um incidente de latência do Render vira um "app quebrou" percebido pela analista, quando na verdade é só um endpoint lento. Perde-se a chance de mostrar o banner de retry que este delta acabou de introduzir.
- **Dependências**: nenhuma

### [availability-2] Emitir sinal client-side quando `LoadErrorBanner` aparecer (base para MTTR percebido)

- **Problema**
  > O delta introduz `LoadErrorBanner` para tornar visível a falha, mas o evento não é registrado em nenhum sink. Sem esse registro, é impossível quantificar disponibilidade percebida pela analista, priorizar `availability-1` com números reais ou fechar o loop com backend/infra. `_shared-metrics.md` declara MTTR "não medível" — parte disso é opção nossa, não só ausência de `infra/`.

- **Melhoria Proposta**
  > Adicionar uma emissão leve (fetch fire-and-forget para um endpoint de telemetria já existente, ou console estruturado consumido por Render logs) quando `usePermutasData.load()` cai no `catch`. Payload: `{ endpoint, httpStatus, message, elapsedMs, ts }`. Excluir `SessionExpiredError` (já tem seu próprio caminho). Tactic Bass: Monitor.

- **Resultado Esperado**
  > Cada aparição do `LoadErrorBanner` deixa rastro. Passa a existir uma métrica auditável: "N falhas percebidas por semana no painel de permutas".
  > - Eventos emitidos por falha: 0 → 1 por incidente.
  > - Semanas com dado auditável de disponibilidade percebida: 0 → todas.

- **Tactic alvo**: Monitor
- **Severidade**: P2
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-availability-3, F-availability-1 (habilita medição), F-availability-2 (habilita medição)
- **Métricas de sucesso**:
  - Eventos client-side de falha de `fetchGestaoPermutas` roteados a um sink: 0 → 1/ocorrência
  - Dashboard/relatório referenciando esses eventos: ausente → 1
- **Risco de não fazer**: continuar sem número para defender qualquer investimento em disponibilidade (timeout, backoff, alarme). O F-availability-1 fica em P2 para sempre por falta de baseline.
- **Dependências**: nenhuma (implementação com `console.warn` estruturado é suficiente na Fase 1; migrar para sink dedicado quando existir)

### [availability-3] Documentar política explícita de retry (manual vs. automático) para painéis human-in-loop

- **Problema**
  > O delta escolheu retry manual (botão), e a escolha é sólida para um painel onde a analista decide baixa de adiantamento, mas não está escrita em lugar nenhum. Novas telas do mesmo domínio (Recebimentos, SISPAG, GED) tendem a copiar padrões sem entender a razão — corre-se o risco de alguém adicionar retry automático agressivo no `RetryExecutor` do backend + retry automático no cliente e criar contenção sobre o Render.

- **Melhoria Proposta**
  > Adicionar seção em `docs/design-system/patterns.md` §Error states (ou complementar `ontology/ui-flows/fonte-do-dado-permutas.md`) explicitando: (a) painéis human-in-loop = retry manual; (b) exceção: chamadas idempotentes leves com deadline curto podem ter 1 retry automático com jitter; (c) mutações permanecem sem retry automático no cliente. Tactic Bass: Increase Competence Set.

- **Resultado Esperado**
  > Próximo `/feature-new` de painel financeiro parte da política escrita, não de um chute copiado. Reduz retrabalho em revisão.
  > - Documento de política de retry cliente-side: ausente → presente.
  > - Referência cruzada nos docblocks de `usePermutasData` / `apiFetch`: 0 → 2.

- **Tactic alvo**: Increase Competence Set
- **Severidade**: P3
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-availability-2
- **Métricas de sucesso**:
  - Seção "Retry policy" em `docs/design-system/patterns.md`: ausente → presente
  - PRs futuros no domínio citam a política: baseline 0 → objetivo ≥1 na próxima feature de painel
- **Risco de não fazer**: proliferação de padrões inconsistentes nos painéis IV (Recebimentos) e II (SISPAG) — cada tela decidindo por conta própria se refetcha em background, se retorna dado stale, se re-empilha requisições no clique múltiplo.
- **Dependências**: nenhuma

## 6. Notas do agente

- Delta é frontend puro; adaptei o cenário Bass para "disponibilidade do sinal do painel" em vez de "disponibilidade do worker SQS". O ganho estrutural do fix é substituir um pseudo-uso de Ignore Faulty Behavior (mascarar falha com fixture) por Degradation + Exception Detection + Monitor manual — três tactics reais no lugar de uma antipattern.
- Métricas de MTTR/uptime real, DLQ, alarmes CloudWatch e blast-radius multi-tenant são todas "não medíveis" aqui e assim foram declaradas — nenhuma virou finding, conforme instrução.
- Achado F-availability-1 (timeout) precede o delta; incluí porque uma review de disponibilidade que se cala sobre ausência de timeout no único caminho de leitura interativa não é honesta. Fica em P2 (sem baseline de p99 de produção para elevar a P1).
- Cross-QA: F-availability-3 e o card `availability-2` se sobrepõem à trilha de Observability/Monitoring — sinalizar ao `qa-consolidator` para não duplicar com um eventual card em `qa-testability` ou `qa-integrability` sobre logging.
