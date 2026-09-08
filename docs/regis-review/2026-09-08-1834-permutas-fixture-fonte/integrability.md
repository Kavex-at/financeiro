---
qa: Integrability
qa_slug: integrability
run_id: 2026-09-08-1834
agent: qa-integrability
generated_at: 2026-09-08T18:34:00-03:00
scope: frontend
score: 7.0
findings_count: 5
cards_count: 4
---

# Integrability — Regis-Review

## 1. Cenário Geral (Bass General Scenario aplicado ao nf-projects)

Delta 100% frontend. O único ponto de integração tocado é o contrato `GET /permutas/gestao`
consumido por `fetchGestaoPermutas` (`src/frontend/lib/api.ts:79-118`). O cenário canônico é o
FE↔BE dessa chamada.

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Backend Express (`GestaoPermutasService`) | Responde `GET /permutas/gestao` com payload novo, campo renomeado, status enum ampliado, HTTP 5xx ou 401 | `fetchGestaoPermutas` (frontend), `usePermutasData`, `Painel de Permutas` | Produção (Render+Vercel), analista revisando carteira | FE distingue os três casos: banco (vazio ou populado) exibe dado real, falha lança para o banner de erro, demo explícito serve fixture com aviso destrutivo. Sessão expirada abre modal sem virar fixture. | 0 respostas silenciosamente mascaradas em produção; contrato validado no boundary (hoje ausente — cast `as Partial<T>`); MTTR de mudança de contrato = 1 arquivo alterado (hoje = 2: `interface/permutas/Gestao.ts` + `lib/types.ts`). |

O delta cirurgicamente restaura a discriminação dos três casos e move o fallback de demo atrás
de opt-in explícito (`NEXT_PUBLIC_DEMO_MODE`) com fail-fast em não-local (`assertDemoEnv`,
`lib/features.ts:47-60`). Isso é integrabilidade recuperada: uma nova tela que consuma o mesmo
endpoint agora herda um contrato honesto em vez de ter que redescobrir a máscara.

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Arquivos do delta que tocam o boundary FE↔BE | 1 (`lib/api.ts`, `fetchGestaoPermutas`) | ≤2 (wrapper + tipos) | ✅ | `git diff --stat origin/main...HEAD -- src/frontend/lib/` |
| Uso de Zod em `src/frontend/**` | 0 arquivos | ≥1 no wrapper de API para respostas críticas | ❌ | `grep -rn "from 'zod'\|z\.object" src/frontend --include="*.ts" --include="*.tsx"` |
| Casts unsafe `as Partial<T>` / `as { … }` em wrappers de API do FE | 22 em 5 arquivos (`api.ts` 8, `recebimentos.ts` 7, `sispag.ts` 5, `usuarios.ts` 2, `operacao.ts` 0) | 0 (schema validado) | ❌ | `grep -c "as Partial<\|as { " src/frontend/lib/{api,recebimentos,operacao,sispag,usuarios}.ts` |
| Contrato `GestaoPermutasResponse` duplicado no repo | 2 sítios (`src/backend/domain/interface/permutas/Gestao.ts:177 linhas` + `src/frontend/lib/types.ts:232-262`, com comentário "espelham EXATAMENTE") | 1 sítio (single source of truth compartilhada) ou geração automática | ⚠️ | `wc -l src/backend/domain/interface/permutas/Gestao.ts` + `sed -n '232,262p' src/frontend/lib/types.ts` |
| Lógica de agregação (`totais`) duplicada BE↔FE | 2 (`GestaoPermutasService.ts:199-208` + `api.ts:103-113`) | 1 (só no servidor; FE renderiza) | ⚠️ | `grep -n "totais:" src/backend/domain/service/permutas/GestaoPermutasService.ts` + `api.ts:103` |
| Consumidores diretos de `apiFetch` em componentes (bypass do `lib/*.ts`) | 13 (`BorderosPanel.tsx` 5, `sispag/page.tsx` 3, `recebimentos/page.tsx` 2, `useIngestao.ts` 1, `operacao/page.tsx` 1, `FalhasTable.tsx` 1) | 0 (todos por wrapper tipado) | ⚠️ | `grep -c apiFetch src/frontend/app/**/*.tsx src/frontend/app/**/*.ts` (não é do delta, mas contexto) |
| Chamada HTTP fora de `apiFetch` no frontend | 0 sítios de negócio (`fetch(` só em `http.ts:31` interno) | 0 | ✅ | `grep -rn "await fetch(" src/frontend --include="*.ts" --include="*.tsx"` |
| Versão de API pinada em URL/header | Não aplicável — mesmo repo (BE Express+FE Next dentro do mesmo release) | N/A | N/A | `grep -n "/v[0-9]\|api-version" src/frontend/lib/api.ts` |
| Discriminador de fonte (`fonte: 'banco' \| 'fixture'`) surfaced na UI | Sim (banner + testes cobrindo, novo no delta) | Sim | ✅ | `permutas-fonte-dado.test.ts`, `banners.tsx` |
| Fixture de demo desativado por default fora de `NEXT_PUBLIC_ENV=local` | Sim, com fail-fast no import (`assertDemoEnv`) | Sim | ✅ | `lib/features.ts:47-60`, `features-demo-mode.test.ts` |
| Módulos Terraform / SSM tenants / IAM | ⚠️ **Não medível** — `infra/` não existe (ver `_shared-metrics.md`) | — | N/A | CLAUDE.md marca a camada como (alvo) |
| Contract test com fixture do payload real | Sim, o próprio `permutas-fixture.ts` (227 linhas de dados sondados) é executado como resposta em `permutas-fonte-dado.test.ts` | Sim, para todo endpoint crítico | ✅ para `GET /permutas/gestao`; ⚠️ para os demais | `src/frontend/__tests__/permutas-fonte-dado.test.ts` |

> ⚠️ **Não medível localmente**: taxa de erro por dependência externa em produção (Conexos,
> Supabase). Requer instrumentação server-side + observabilidade agregadora (Datadog/CloudWatch).
> Fora do escopo do delta FE.

## 3. Tactics — Cobertura no nf-projects

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Encapsulate | `fetchGestaoPermutas` isola o boundary — a página consome tipos, nunca `fetch`/`Response`. Discriminador `fonte` agora exposto e checado. | ✅ presente | `src/frontend/lib/api.ts:79-118`, `app/permutas/components/usePermutasData.ts` |
| Use an Intermediary | `apiFetch` centraliza 401 → `SessionExpiredError` + evento de sessão. O delta corrige o `catch` que engolia esse Error específico. | ✅ presente | `src/frontend/lib/http.ts:22-36`, `api.ts:114-117` |
| Restrict Communication Paths | Ideal: componentes só falam com `lib/*.ts`; wrappers só falam com `apiFetch`. Realidade: **13 chamadas diretas de `apiFetch` em componentes**, mas nenhuma no delta. | ⚠️ parcial | `grep -rn apiFetch src/frontend/app --include="*.tsx"` |
| Adhere to Standards | Sem schema padronizado no boundary. Contrato spelled manualmente em dois arquivos "espelham EXATAMENTE" segundo o próprio código. | ❌ ausente | `src/backend/domain/interface/permutas/Gestao.ts:1-4` (comentário do espelho) + `src/frontend/lib/types.ts:232-262` |
| Abstract Common Services | `withAuthHeaders`, `apiFetch`, `assertDemoEnv` extraídos para libs. Cada função de fetch ainda repete o try/parse-json/detail (padrão manual em ~20 sítios). | ⚠️ parcial | `lib/api.ts` (blocos `if (!res.ok) { let detail = ''; try { const j = await res.json(); detail = j?.error ? … } … }` repetidos) |
| Discover Service | Endpoint via `NEXT_PUBLIC_API_URL` (`api.ts:22`), default `http://localhost:3001`. Sem SSM (infra é Render/Vercel). | ✅ presente | `src/frontend/lib/api.ts:22` |
| Tailor Interface | Discriminador `fonte` na resposta, `assertDemoEnv` como gate de import. Nenhuma tradução server-side no FE (`GerarNumerarioResult` etc. importados por espelho de tipos). | ⚠️ parcial | `lib/types.ts:236` + `lib/features.ts:47-60` |
| Configure Behavior | `NEXT_PUBLIC_DEMO_MODE` + `NEXT_PUBLIC_ENV` + `NEXT_PUBLIC_API_URL` + `NEXT_PUBLIC_SISPAG_ENABLED` documentados em `.env.example`. | ✅ presente | `src/frontend/.env.example` (delta +9 linhas) |
| Manage Resources | N/A — FE stateless; sem pool/session/connection para gerenciar. | N/A | — |
| Orchestrate | `usePermutasData` orquestra fetch + estado (loading/data/error). Composição linear, sem event bus. | ✅ presente | `src/frontend/app/permutas/components/usePermutasData.ts` |
| Manage Resource Coupling | Wrapper único (`lib/api.ts`) para o endpoint; página não conhece o URL. | ✅ presente | `usePermutasData.ts` importa `fetchGestaoPermutas` |
| Contract Testing | `permutas-fonte-dado.test.ts` (novo, 7 casos) cobre os três caminhos do contrato: 200 populado, 200 vazio, HTTP 5xx, rede, 401. Payload real (227 linhas do fixture) exercido. | ✅ presente para `/permutas/gestao` | `src/frontend/__tests__/permutas-fonte-dado.test.ts` |
| Versioning Strategy | N/A no escopo mono-repo (BE+FE released em lockstep, `chore(release): vX.Y.Z`). Se um cliente externo consumir o BE, versioning aparece — hoje não há. | N/A | ver `chore(release)` no `git log` |
| Backward-Compatibility Shims | Não aplicável — o único consumidor é o FE deste repo. | N/A | — |
| Observability of Integration Failures | Erro sobe até a página, banner + botão "Tentar novamente". `console` só. Sem métrica agregadora (não há Datadog/Sentry configurado no FE do delta). | ⚠️ parcial | `banners.tsx` (`LoadErrorBanner`) + ausência de client Sentry |

## 4. Findings (achados)

### F-integrability-1: FE consome resposta sem validação de schema no boundary

- **Severidade**: P1
- **Tactic violada**: Adhere to Standards (contract validation)
- **Localização**: `src/frontend/lib/api.ts:92` (linha do cast `as Partial<GestaoPermutasResponse>`); mesmo padrão em `recebimentos.ts:808,908`, `sispag.ts` (5), `usuarios.ts` (2).
- **Evidência (objetiva)**:
  ```ts
  const json = (await res.json()) as Partial<GestaoPermutasResponse>
  ```
  ```
  # grep de Zod no frontend
  $ grep -rn "from 'zod'\|z\.object" src/frontend --include="*.ts" --include="*.tsx" | wc -l
  0
  ```
- **Impacto técnico**: se o backend renomear um campo (ex.: `pendentes` → `adiantamentosPendentes`), adicionar um novo `StatusElegibilidade` (ex.: `revisao-fiscal`) ou emitir `null` num campo tipado como `string`, o TypeScript aceita silenciosamente e a UI decide fazer nada (ou explodir num `.map`). O comentário do próprio contrato BE diz "espelham EXATAMENTE `src/frontend/lib/types.ts`" — a única salvaguarda é a diligência do dev de os dois lados. O delta corrigiu o mascaramento de dado; a **detecção** de contrato quebrado continua sem cobertura.
- **Impacto de negócio**: uma refactor de nome de campo no BE, feito por outro dev que só olhou o backend, chega em prod como carteira vazia silenciosa — que agora, graças ao delta, aparece como "Zero pendentes" na tela real (regressão sutil, sem erro visível).
- **Métrica de baseline**: 0/108 arquivos FE não-teste usam Zod. 22 sítios em 5 wrappers de API usam cast `as Partial<T>` para narrow de resposta.

> **Nota**: o backlog `ontology/_inbox/backlog-melhorias-2026-09-02.md` §3.4 já classifica este item
> como P1. Este finding **não é novo**; é reafirmado no contexto do delta porque `fetchGestaoPermutas`
> segue o mesmo padrão que ele registra como débito.

### F-integrability-2: contrato `GestaoPermutasResponse` duplicado à mão entre BE e FE

- **Severidade**: P2
- **Tactic violada**: Abstract Common Services (single source of truth para types de wire)
- **Localização**: `src/backend/domain/interface/permutas/Gestao.ts` (177 linhas, 9 exports) e `src/frontend/lib/types.ts:232-262` (30 linhas para `GestaoPermutasResponse` + tipos aninhados)
- **Evidência (objetiva)**:
  ```
  # src/backend/domain/interface/permutas/Gestao.ts:1-4
  /**
   * Shapes da resposta `GET /permutas/gestao` — espelham EXATAMENTE
   * `src/frontend/lib/types.ts` (a tela consome este JSON diretamente).
   */
  ```
  Duplicação declarada como tal pelo próprio código. Nenhum test/lint impõe o espelho.
- **Impacto técnico**: adicionar um campo no `PermutaPendente` exige edição em dois arquivos, em duas timelines de dev; entre um passo e outro, ou o backend serializa campo que o FE não consome, ou (pior) o FE consome campo que o BE ainda não emite. Um consumidor terceiro (job de export, mobile) precisaria copiar o types.ts inteiro pela terceira vez.
- **Impacto de negócio**: MTTR de mudança de contrato dobra (edit + review em dois pacotes). Silêncio quando o espelho quebra — só um dev cuidadoso rodando type-check em ambos os lados percebe. Custo marginal de adicionar um novo consumidor do endpoint: replicar ~200 linhas de types.
- **Métrica de baseline**: 2 sítios (177 linhas BE + 30 linhas FE só para `GestaoPermutasResponse`; multiplicado por outros contratos do domínio).

### F-integrability-3: lógica de agregação (`totais`) duplicada BE↔FE

- **Severidade**: P2
- **Tactic violada**: Encapsulate (agregação server-side não deve ser recomputável no cliente)
- **Localização**: `src/backend/domain/service/permutas/GestaoPermutasService.ts:199-208` (definição autoritativa) e `src/frontend/lib/api.ts:103-113` (fallback `json.totais ?? { … }`)
- **Evidência (objetiva)**:
  ```ts
  // api.ts:103-113
  totais: json.totais ?? {
    pendentes: json.pendentes?.length ?? 0,
    invoicesEmAberto: json.invoicesEmAberto?.length ?? 0,
    elegiveis: (json.pendentes ?? []).filter((p) => p.status === 'elegivel').length,
    bloqueadas: (json.pendentes ?? []).filter((p) => p.status === 'bloqueada').length,
    casamentoManual: (json.pendentes ?? []).filter((p) => p.status === 'casamento-manual').length,
    permutaManual: (json.pendentes ?? []).filter((p) => p.status === 'permuta-manual').length,
    jaPermutado: (json.pendentes ?? []).filter((p) => p.status === 'ja-permutado').length,
  }
  ```
  Backend sempre emite `totais` (`GestaoPermutasService.ts:199`) — o ramo `??` é código morto até um dia deixar de ser.
- **Impacto técnico**: quando um novo `StatusElegibilidade` for adicionado (ex.: `revisao-fiscal`), o BE incluirá o `total.revisaoFiscal` correto; o fallback do FE não conhece o status e retornaria contagem parcialmente errada — só se o BE parar de emitir totais no mesmo dia. É bomba armada com trava, não bomba solta. Mas é lógica de negócio no wire-adapter.
- **Impacto de negócio**: baixo hoje; alto quando alguém introduzir um status silenciosamente e o cálculo do FE virar o número exibido no KPI do painel.
- **Métrica de baseline**: 1 função de agregação replicada em 2 arquivos (11 linhas × 2). Enum `StatusElegibilidade` com 5 valores em ambos os lados.

### F-integrability-4: fixture de demo mora no cliente HTTP em vez de num modo de teste separado

- **Severidade**: P3
- **Tactic violada**: Restrict Communication Paths (o wrapper HTTP não deveria conhecer dados de teste)
- **Localização**: `src/frontend/lib/api.ts:19` (import do fixture), `:99` e `:115` (branches condicionados por `isDemoMode()`)
- **Evidência (objetiva)**:
  ```ts
  import { gestaoPermutasFixture } from './permutas-fixture'
  // ...
  if (vazia && isDemoMode()) return gestaoPermutasFixture
  // ...
  if (isDemoMode()) return gestaoPermutasFixture
  ```
- **Impacto técnico**: um novo consumidor de `/permutas/gestao` (ex.: um export de relatório server-side rodando em job, ou uma segunda tela) não pode reusar `fetchGestaoPermutas` sem herdar o fixture. A responsabilidade de escolher fonte de dado (banco vs. demo) deveria estar num nível acima — o wrapper devia só falar HTTP. Alternativa: MSW/`fetch-mock` no `NEXT_PUBLIC_DEMO_MODE=true`, deixando `fetchGestaoPermutas` puro.
- **Impacto de negócio**: baixo hoje (único consumidor é o painel). Cresce com nº de telas que pisam no mesmo endpoint.
- **Métrica de baseline**: 1 wrapper HTTP mistura 2 responsabilidades (I/O + fonte de dado). Delta reduziu, não eliminou.

### F-integrability-5: consistência de padrão FE — `recebimentos` já migrou, `permutas` migra agora

- **Severidade**: P3 (observacional, positiva)
- **Tactic violada**: nenhuma; é reforço de `Adhere to Standards`
- **Localização**: `src/frontend/lib/recebimentos.ts:823-830` (comentário "NÃO cai mais em fixture") e `src/frontend/lib/api.ts:79-118` (delta atual)
- **Evidência (objetiva)**:
  ```
  # recebimentos.ts:823-830
   * Busca o painel de Recebimentos (`GET /recebimentos/painel`).
   *
   * NÃO cai mais em fixture. O early-return de "lista vazia → dados de demonstração"
   * sequestrava qualquer resposta legítima …
  ```
  O padrão "vazio → fixture / catch → fixture" foi removido de `recebimentos` em ciclo anterior; o delta atual aplica o mesmo padrão em `permutas`. `recebimentosPainelFixture` continua exportado, mas só é consumido em testes (`app/recebimentos/page.test.tsx`), não em produção.
- **Impacto técnico**: consistência do padrão FE aumenta — dois endpoints críticos passam a se comportar igual diante de resposta vazia e diante de falha. Um dev novo que abre `lib/*.ts` encontra uma regra única.
- **Impacto de negócio**: reduz probabilidade de reintrodução acidental do anti-padrão em novos wrappers (o exemplo canônico agora é o correto).
- **Métrica de baseline**: 2/2 wrappers de painel (`fetchPainelRecebimentos`, `fetchGestaoPermutas`) seguem o mesmo protocolo pós-delta (antes: 1/2).

## 5. Cards Kanban

### [integrability-1] Validar no boundary FE↔BE a resposta de `/permutas/gestao` com Zod

- **Problema**
  > `fetchGestaoPermutas` faz `(await res.json()) as Partial<GestaoPermutasResponse>` (`api.ts:92`). O contrato é duplicado à mão entre BE e FE ("espelham EXATAMENTE"); nenhum guardião checa que o wire bate com o tipo. Um rename ou um novo `StatusElegibilidade` no backend chega mudo no cliente e vira KPI errado silenciosamente. Backlog `ontology/_inbox/backlog-melhorias-2026-09-02.md` §3.4 já registra o débito como P1; o delta corrigiu o mascaramento de dado, mas não fechou a detecção.

- **Melhoria Proposta**
  > Introduzir Zod no wrapper. Definir `gestaoPermutasResponseSchema` compartilhado (ou colocado em `src/frontend/lib/schemas/permutas.ts` e re-derivar o `type` via `z.infer`). Trocar o cast por `schema.safeParse(json)`, com log estruturado em `success=false` e `throw` (tratado pelo `LoadErrorBanner`). Iniciar por `/permutas/gestao` (endpoint corrigido no delta, tem cobertura de teste). Estender depois ao restante de `lib/api.ts` e `lib/recebimentos.ts` — não escopo deste card.

- **Resultado Esperado**
  > 1 wrapper (`fetchGestaoPermutas`) validando resposta contra schema; 0 casts `as Partial<T>` nesse wrapper; se BE renomear campo ou emitir enum novo, cliente falha ruidosamente com nome do campo no console + banner ao invés de KPI errado.

- **Tactic alvo**: Adhere to Standards (contract validation) + Tailor Interface
- **Severidade**: P1
- **Esforço estimado**: S (schema de 1 endpoint + 1 teste que quebra ao mudar shape)
- **Findings relacionados**: F-integrability-1
- **Métricas de sucesso**:
  - Arquivos FE usando Zod: 0 → ≥1
  - Casts `as Partial<T>` em `fetchGestaoPermutas`: 1 → 0
  - Teste de contrato explícito (payload de shape inválido → erro nomeado): 0 → 1
- **Risco de não fazer**: refactor de campo no BE (esperado quando as 4 frentes convergirem) chega em prod como carteira vazia ou KPI errado, sem sinal na tela — regressão sutil que o próprio delta buscou evitar.
- **Dependências**: nenhuma; se `zod` ainda não estiver em `package.json` do FE, adicionar. **Cross-QA**: overlap com Security (F-security-Validate-Input) e Fault-Tolerance (F-fault-tolerance-Validate-External-Boundary) — flag conjunta para o consolidator.

### [integrability-2] Colapsar a duplicação `interface/permutas/Gestao.ts` ↔ `lib/types.ts`

- **Problema**
  > O contrato `GestaoPermutasResponse` (e amigos) vive em dois arquivos que "espelham EXATAMENTE" um ao outro (`src/backend/domain/interface/permutas/Gestao.ts:1-4`, `src/frontend/lib/types.ts:232-262`). Nada além da disciplina do dev garante a sincronia; um consumidor terceiro (job/relatório/mobile) copiaria uma terceira cópia. MTTR de mudança de contrato dobra.

- **Melhoria Proposta**
  > Duas rotas realistas no monorepo atual (não há workspace publicado):
  > 1. **Publicar o `interface/permutas/*.ts` do BE em `src/shared/contracts/`** e importar tanto do FE quanto do BE via path relativo/alias TS. Requer ajuste de `tsconfig` e do `paths` do Next. Mais barato; casa com CLAUDE.md.
  > 2. **Emitir os tipos a partir do schema Zod** (combina com integrability-1): `z.infer` no BE e no FE, um único arquivo. Mais caro, mas destranca F-1.
  > Escolher (2) se o backlog aprovar Zod primeiro; senão (1).

- **Resultado Esperado**
  > 1 arquivo autoritativo (BE + FE) para o wire de `/permutas/gestao`. Mudança de campo = 1 edit + tsc rebate os dois consumidores.

- **Tactic alvo**: Abstract Common Services
- **Severidade**: P2
- **Esforço estimado**: M (alias TS + reorg de imports; mais teste)
- **Findings relacionados**: F-integrability-2, F-integrability-1 (compartilha solução com integrability-1)
- **Métricas de sucesso**:
  - Sítios com definição de `GestaoPermutasResponse`: 2 → 1
  - LOC de types duplicados (~30 linhas por contrato) → 0
  - Nº de contratos wire duplicados no repo (Gestao, Recebimentos, SISPAG…): auditar; alvo global 0
- **Risco de não fazer**: drift silencioso quando as 4 frentes evoluírem em paralelo (Permutas / SISPAG / GED / Recebimentos).
- **Dependências**: idealmente sequenciar após integrability-1 (Zod → `z.infer` = types "de graça").

### [integrability-3] Mover a agregação `totais` para 100% server-side

- **Problema**
  > `fetchGestaoPermutas` recomputa `totais` caso o backend omita (`api.ts:103-113`), replicando a lógica de `GestaoPermutasService.ts:199-208`. Hoje o BE sempre emite — o ramo é código morto. Amanhã, quando um `StatusElegibilidade` novo for introduzido, o ramo do FE devolve contagem stale sem alerta.

- **Melhoria Proposta**
  > Remover o fallback `?? { … }` no `api.ts:103`. Se o schema (F-1) obrigar `totais` presente, o Zod já cobre. Caso contrário, `throw new Error('resposta sem totais')` com log estruturado — a tela cai no `LoadErrorBanner`, que é o comportamento correto quando o contrato quebra. Alternativa suave: manter o fallback só em `NEXT_PUBLIC_DEMO_MODE=true`.

- **Resultado Esperado**
  > 1 função de agregação, no BE. FE virou renderer.

- **Tactic alvo**: Encapsulate
- **Severidade**: P2
- **Esforço estimado**: S (delete + teste)
- **Findings relacionados**: F-integrability-3
- **Métricas de sucesso**:
  - Duplicação de lógica de contagem BE↔FE: 2 sítios → 1
  - LOC no `api.ts` do bloco `totais`: 11 → 0
- **Risco de não fazer**: adição de status vira KPI incorreto no dia em que o BE deixar de emitir `totais` (uma refactor bem-intencionada).
- **Dependências**: integrability-1 (validação de schema torna a remoção segura).

### [integrability-4] Extrair fixture de demo do wrapper HTTP

- **Problema**
  > `fetchGestaoPermutas` importa `gestaoPermutasFixture` e escolhe fonte de dado dentro do wrapper HTTP (`api.ts:19,99,115`). Isso mistura I/O com "modo demo" e cria dependência ativa entre a camada de rede e um dataset de teste — qualquer novo consumidor do endpoint reimporta o fixture ou reimplementa o `isDemoMode()`.

- **Melhoria Proposta**
  > Trocar o branch por MSW (`msw` handlers ligados quando `NEXT_PUBLIC_DEMO_MODE=true`), ou por uma injeção via `dataSourceProvider` que decide entre HTTP e in-memory. Um `fetchGestaoPermutas` puro apenas fala com o backend; o modo demo é resolvido antes de chegar em `fetch`.

- **Resultado Esperado**
  > Wrapper HTTP com uma responsabilidade só: rede. Fixture consumido por handler MSW ou provider — reusável, testável, e sem crescer o `api.ts` a cada endpoint que precise de demo.

- **Tactic alvo**: Restrict Communication Paths + Abstract Common Services
- **Severidade**: P3
- **Esforço estimado**: M (introduzir MSW + reescrever 1 wrapper + testes)
- **Findings relacionados**: F-integrability-4, F-integrability-5
- **Métricas de sucesso**:
  - Imports de `permutas-fixture` em `lib/api.ts`: 1 → 0
  - Nº de endpoints que precisariam de branch `isDemoMode()` no wrapper: N → 0
- **Risco de não fazer**: cada novo endpoint que precise de demo repete o padrão; quando novas telas surgirem em Permutas/SISPAG/GED com `NEXT_PUBLIC_DEMO_MODE`, o `api.ts` acumula branches.
- **Dependências**: baixo. Independente de F-1/F-2/F-3.

## 6. Notas do agente

- Escopo estrito respeitado: revisão do delta `frontend-only`, avaliando integrabilidade no
  boundary de `fetchGestaoPermutas`. Não reabri o backlog P1 já registrado em §3.4 —
  reafirmei-o (F-1) porque o delta toca o mesmo wrapper.
- Métricas de infra (Terraform/SSM/CloudWatch) declaradas **não medíveis** conforme
  `_shared-metrics.md` — o repo não tem `infra/`.
- Cross-QA sinalizado ao consolidator: **F-integrability-1 = F-security-Validate-Input =
  F-fault-tolerance-Validate-External-Boundary** — mesmo defeito de código (`as Partial<T>`
  sem Zod), três QAs. Mesmo card resolve os três. **F-integrability-2 = F-modifiability
  (duplicação BE↔FE)** — mesmo bloco de types.
- Observação positiva encapsulada como F-5 (P3): o padrão "vazio → fixture" foi removido de
  `recebimentos` em ciclo anterior; o delta atual completa a consistência do padrão em
  `permutas`. É argumento a favor da nota final.
