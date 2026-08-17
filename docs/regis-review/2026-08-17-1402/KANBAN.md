---
type: regis-review-kanban
run_id: 2026-08-17-1402
total: 27
counts: { p0: 1, p1: 7, p2: 13, p3: 6 }
---

# Kanban — financeiro — 2026-08-17-1402 (feature `nde-painel-lista`)

> Importável para o board do time. Ordem: P0 → P1 → P2 → P3, e dentro de cada faixa por esforço.
>
> **Escopo:** DELTA `fix/nde-painel-lista` vs `main`. Cards já remediados dentro do ciclo foram
> EXCLUÍDOS (ver `REPORT.md` §0). Onde as seções cruas dizem "ADR-0034" leia **ADR-0037**, e
> "migration 0046" leia **0048** (os números foram realocados no rebase).
>
> **Unidades de trabalho conjuntas** — não estime duas vezes:
> - `security-4` + `availability-5` = mesma implementação (heavyRouteLimiter + requestTimeout)
> - `modifiability-3` + `testability-5` = mesma extração (`NdePainelHidratadorService`)
> - `security-2` + `performance-1` + `fault-tolerance-3` = mesma arquitetura (`NdeReconcilerJob`)

---

## P0 — Crítico

### [security-1] Deny-by-default no recorte por filial do `/painel` — **PRÉ-EXISTENTE E SISTÊMICO**

**QA:** Security · **Tactic:** Authorize Actors + Limit Access · **Esforço:** M

**Problema**
> `filiaisPermitidas(req.user)` devolve `undefined` para 100% dos tokens Supabase de hoje (o próprio
> `auth.ts:24-27` documenta que o claim `filiais` ainda não é emitido). Com isso o
> `resolverFilCods` cai em `base.getFiliais()` e o `WHERE e.fil_cod = ANY($filCods)` deixa de ser
> barreira: o painel devolve a carteira e as NDes de TODAS as filiais do ERP. Vale para toda a
> Frente IV, não só para a aba NDe — o delta apenas ampliou a superfície de leitura.

**Melhoria Proposta**
> Inverter o default para fail-closed: sem allow-list explícita, o usuário só vê as filiais
> declaradas (claim `permissions.filiais` no JWT ou tabela `app_user_filial`). O comportamento atual
> sobrevive apenas atrás de `AUTHZ_FILIAL_LEGACY_OPEN=true` (default `false`), com aviso no boot e
> log por request que a use.

**Resultado Esperado**
> Sem allow-list, o `/painel` responde 403 em vez de 200 com N filiais. Nenhum tenant multi-filial
> expõe dados cruzados.

**Métricas:** cobertura do claim `filiais` em produção 0% → 100% · rotas com fail-open documentado
1 → 0 · teste novo provando o 403.

**Dependências:** time de auth Supabase (hook de JWT) + OntologyCurator (entidade `UsuarioFilial`).

---

## P1 — Alto

### [security-3] Sanitizar `erroMensagem` do ERP antes de sair do backend
**QA:** Security · **Tactic:** Limit Exposure · **Esforço:** S

**Problema**
> Mensagens cruas do Conexos chegam ao browser via `NdeRepository.mapPainelRow` → `NdeTable.tsx`.
> Expõem superfície interna do ERP (`RECORDNOTFOUND`, nomes de env, às vezes fragmento de SQL).
> Combinado com `security-1`, o analista lê os erros de todas as filiais. Há precedente pré-existente
> no `BorderosPanel` de permutas.

**Melhoria Proposta**
> Mapear no backend para código estável (`NDE_ERR_RECORDNOTFOUND`, `NDE_ERR_ACL`, `NDE_ERR_TIMEOUT`,
> `NDE_ERR_DESCONHECIDO`) + mensagem curta pt-BR aprovada. `erpResponse` continua persistido para
> auditoria interna; o campo exposto deixa de ser passthrough.

**Resultado Esperado**
> O browser vê "Documento não encontrado no ERP (NDE_ERR_RECORDNOTFOUND)", não a mensagem crua.

**Métricas:** cobertura de códigos estáveis 0% → 100% · nenhum snapshot do FE contém tokens do ERP.

### [security-4] `heavyRouteLimiter` + `requestTimeout` no `GET /painel` — (= `availability-5`)
**QA:** Security + Availability · **Tactic:** Detect Service Denial · **Esforço:** S

**Problema**
> `http/rateLimit.ts:5-7` define o `heavyRouteLimiter` para "rotas cujo fan-out ao Conexos pode
> esgotar o pool de sessão" — perfil que o `/painel` passou a ter (até 20 GETs por request). A rota
> está no limiter global (100 req/min por IP): pior caso 2000 GETs/min ao ERP. E `app.listen` não
> define `server.requestTimeout` (default do Node = sem limite).

**Melhoria Proposta**
> Aplicar `heavyRouteLimiter` ao `/painel`; `server.requestTimeout = 30000`; `keepAliveTimeout`
> alinhado ao Render. Opcional: cache de resposta por usuário/filial com TTL ≤ 30 s + `ETag`.

**Resultado Esperado**
> Um usuário não amplifica a carga sobre o Conexos além do teto; request pendurado morre em 30 s.

**Métricas:** rate-limit no `/painel` 100/min → 10/min · `requestTimeout` 0 → 30000.

### [performance-1] Mover a hidratação para um job; painel só lê o banco — (unidade com `security-2`, `fault-tolerance-3`)
**QA:** Performance · **Tactic:** Schedule Resources · **Esforço:** M

**Problema**
> A hidratação roda dentro do request HTTP (agora capada em 12 s pelo orçamento). O próprio código
> admite que "o painel é o poll que a homologação não pôde esperar". ADR-0037 aceitou o trade-off
> para esta entrega; desacoplar é a próxima iteração.

**Melhoria Proposta**
> `NdeReconcilerJob` periódico (TTL 30–60 s) usando o mesmo `hidratarNdes`, escrevendo só no banco.
> `montarPainel` passa a apenas ler o ledger.

**Resultado Esperado**
> p95 do painel deixa de depender do Conexos na aba NDe.

**Métricas:** chamadas Conexos por load da aba 20 → 0 · p95 do endpoint ≤ 12 s → ≤ 400 ms · frescor
da reconciliação "só se houver load" → ≤ 60 s.

### [fault-tolerance-3] Reaper periódico da divergência SEFAZ × local
**QA:** Fault Tolerance · **Tactic:** Self-Test / Sanity Checking · **Esforço:** M

**Problema**
> Linhas fora da janela do painel (cap, filtro, analista de férias) podem ficar `nde_autorizado=false`
> por dias mesmo com o SEFAZ tendo autorizado. A remediação 4 fechou o caso da escrita parcial, não o
> das janelas sem tráfego humano.

**Melhoria Proposta**
> Job diário varrendo `etapa IN ('homologado','concluido') AND nde_autorizado=false AND nd_doc_cod IS
> NOT NULL AND atualizado_em < now() - interval '2 hours'`, reaplicando a reconciliação com log.

**Resultado Esperado**
> MTTR de "SEFAZ autorizou e nosso banco não sabe" cai de indefinido para ≤ 24 h.

**Métricas:** linhas homologadas e não autorizadas há > 24 h: baseline → 0.

### [modifiability-1] Segregar `NdeRepositoryInterface` (comando vs. projeção de leitura)
**QA:** Modifiability · **Tactic:** Increase Semantic Coherence · **Esforço:** S

**Problema**
> A porta mistura CRUD da entidade (`save`, `findByRecebimentoId`, `updateNumeroNde`) com a projeção
> do painel (`listParaPainel`, `contarPendentes`). Custo medido: adicionar 3 métodos exigiu editar
> 9 arquivos e2e só para redigitar stubs. Os consumidores reais são disjuntos.

**Melhoria Proposta**
> Extrair `NdePainelReadRepositoryInterface` com token próprio; `NdeRepository` implementa as duas.
> Criar um fake de teste compartilhado em `__testfakes__/` e apontar os 9 e2es para ele.

**Resultado Esperado**
> Próxima extensão da projeção toca 2 arquivos em vez de 9 + fake.

**Métricas:** arquivos alterados na próxima extensão 9 → 2.

### [modifiability-2] Encapsular a regra "NDe fechada" numa expressão nomeada
**QA:** Modifiability · **Tactic:** Encapsulate · **Esforço:** S

**Problema**
> `NDe fechada ⟺ (statusEmissao === 'emitida' AND ndeAutorizado === true)` vive em 3 lugares: SQL do
> `contarPendentes`, `computeKpis` do FE e a composição visual da tabela. Acrescentar `revisaoHumana`
> à definição amanhã exige 3 patches e abre janela de drift.

**Melhoria Proposta**
> Backend: fragmento `NDE_FECHADA_SQL` em `constants.ts`. Frontend: helper `isNdeFechada()` em
> `lib/recebimentos.ts`, consumido por `computeKpis` E pela tabela.

**Resultado Esperado**
> Evoluir a regra passa a ser um patch em 2 pontos.

**Métricas:** fontes da regra 3 → 2 · divergência card↔tabela observada em produção: 0.

### [testability-1] Smoke e2e da aba NDe em ao menos uma suíte de rota
**QA:** Testability · **Tactic:** Specialized Interfaces · **Esforço:** S

**Problema**
> Os 9 fakes de `NdeRepository` nos e2e devolvem `[]`/`0`. Nenhum caso prova que
> `GET /recebimentos/painel` serializa `ndes` no shape que a `NdeTable` consome — uma mudança no
> serializer passa verde.

**Melhoria Proposta**
> Na suíte canônica, popular o fake com 3 linhas (emitida+autorizada, pendente com `ndDocCod`, erro)
> e assertar o shape e a contagem via HTTP.

**Resultado Esperado**
> Regressão de serializer da aba NDe pega em CI.

**Métricas:** casos e2e cobrindo a aba 0 → ≥ 1.

---

## P2 — Médio

### [security-2] Tirar as escritas do `GET` (POST reconcile ou job) + audit trail
**QA:** Security · **Tactic:** Audit Trail · **Esforço:** M · (unidade com `performance-1`, `fault-tolerance-3`)

**Problema**
> `hidratarUma` chama `setNdeAutorizado` e `updateNumeroNde` dentro de um `GET`. Já ganhou log
> (rem. 1) e ordem de commit (rem. 4). Faltam: conformidade de safe-method, audit trail por ator e o
> desacoplamento. Severidade rebaixada de P0 porque ADR-0037 aceitou o trade-off explicitamente.

**Melhoria Proposta**
> `POST /recebimentos/reconciliacao/nde/:idempotencyKey` idempotente e gateado, OU mover para o job.
> Nos dois casos, log estruturado com ator + tabela `nde_audit`.

**Resultado Esperado**
> `GET /painel` volta a ser 100% read-only; toda reconciliação deixa rastro por ator/timestamp.

**Métricas:** writes em GET 2 → 0 · cobertura de audit por reconciliação → 100%.

### [availability-3] Cache curto (TTL 30–60 s) e/ou circuit-breaker na hidratação
**QA:** Availability · **Tactic:** Removal from Service + Predictive Model · **Esforço:** M

**Problema**
> Sem cache entre requests: duas aberturas do painel em 30 s = 40 GETs ao com297.
> `ProcessoProviderConexos` já cacheia `imp021` exatamente por isso; a hidratação NDe não segue a
> doutrina. Sob ERP degradado, cada refresh amplifica (thundering herd).

**Melhoria Proposta**
> Cache in-process por `docCod` com TTL 30 s + breaker simples (5 falhas em 60 s → abre por 30 s, e
> as candidatas voltam intocadas).

**Métricas:** cache hit ratio 0% → ≥ 70% · GETs por request sob incidente 20 → ≤ 5.

### [availability-5] `heavyRouteLimiter` e `requestTimeout` no `/painel`
**QA:** Availability · **Esforço:** S · **MESMA implementação de `security-4`** — ver acima.

### [deployability-1] Job `deploy` orquestrado no CI (BE → healthcheck → FE)
**QA:** Deployability · **Tactic:** Scale Rollouts · **Esforço:** M

**Problema**
> Render (BE) e Vercel (FE) deployam por webhook independente, sem ordem. Para este delta o risco é
> nulo (contrato aditivo), mas a próxima feature breaking depende de disciplina humana.

**Melhoria Proposta**
> Job `deploy` (needs backend+frontend) que dispara o Render via API, faz polling até `live` e só
> então promove o Vercel. Aprovação manual via `environment: production`.

**Métricas:** ordem de deploy determinística 0% → 100%.

### [deployability-2] `GET /deployinfo` + `<meta name="build-sha">`
**QA:** Deployability · **Tactic:** Deployment Observability · **Esforço:** S

**Problema**
> Diagnosticar skew hoje exige comparar dashboards Render e Vercel à mão (5–15 min num incidente).

**Melhoria Proposta**
> Backend expõe `{sha, buildTime, version}`; frontend injeta `VERCEL_GIT_COMMIT_SHA` no meta.
> Documentar como checklist pós-deploy no `DEPLOY.md`.

**Métricas:** tempo para descobrir o SHA no ar ≥ 5 min → ≤ 30 s.

### [fault-tolerance-4] Registrar `source`/`ator` na reconciliação
**QA:** Fault Tolerance · **Tactic:** Timestamp / audit-trail · **Esforço:** S

**Problema**
> `setNdeAutorizado` só grava `atualizado_em`. A auditoria fiscal não distingue "poll do writer" de
> "hidratação disparada por load do painel" nem de "reaper".

**Melhoria Proposta**
> `setNdeAutorizado(key, autorizado, { source, ator })` com `source` enum
> (`writer-poll` | `painel-hydrate` | `reaper`), persistido em coluna própria ou tabela de eventos.

**Métricas:** callsites sem `source` 2/2 → 0/2.

### [integrability-2] Propagar `ExternalCallOptions` até o `ConexosBaseClient`
**QA:** Integrability · **Tactic:** Tailor Interface + Configure Behavior · **Esforço:** M

**Problema**
> `lerDocParaPolling` serve dois consumidores com SLOs opostos. O `ExternalCallOptions{timeoutMs,
> signal}` declarado em `ports.ts:45-49` como contrato obrigatório não chega ao `getGeneric`. A
> remediação 2 resolveu com `Promise.race` local — o contrato do módulo continua não cumprido.

**Melhoria Proposta**
> Aceitar `opts` no client, propagar até o adapter HTTP e implementar via `AbortController`; permitir
> override de `retries`.

**Métricas:** chamadas com `timeoutMs` honrado no adapter 0 → 100%.

### [integrability-3] Métrica de falha por endpoint no `montarPainel`
**QA:** Integrability · **Esforço:** S

**Problema**
> O `montarPainel` toca 3 rotas Conexos (`getFiliais`, `imp021`, `com297`). Com `LogService` já
> injetado há log, mas não há contador por dependência: aba parcial não diz qual leg quebrou.

**Melhoria Proposta**
> Instrumentar os `.catch` com `MetricsPortInterface` (`stage`, `outcome`, `endpoint`, `filCod`).

**Métricas:** contadores por endpoint 0 → 3 · MTTR de "aba em branco" indefinido → alertável.

### [modifiability-3] Extrair `NdePainelHidratadorService`
**QA:** Modifiability · **Tactic:** Split Module · **Esforço:** S · (= `testability-5`)

**Problema**
> O serviço foi de 5 para 7 deps e ganhou 2 métodos privados que orquestram leitura do com297 +
> derivação da autorização + write-back em duas tabelas — razões-para-mudar distintas de "montar o
> painel".

**Melhoria Proposta**
> Novo serviço com `hidratar(ndes)` e as deps de ERP/ledger/log; o painel injeta só ele.

**Métricas:** deps do painel 7 → 5 · LOC do painel ~330 → ~260.

### [modifiability-5] Nomear/documentar o cross-table read do `NdeRepository`
**QA:** Modifiability · **Tactic:** Restrict Dependencies · **Esforço:** S

**Problema**
> `NdeRepository` lê de `solicitacao_numerario_execucao` (tabela de outro repositório). É deliberado
> (ADR-0037) e comentado no arquivo, mas o NOME não carrega a informação.

**Melhoria Proposta**
> Preferida: extrair `NdePainelReadRepository` (casa com `modifiability-1`). Mínima: header listando
> "owns / reads" + item no checklist do PatternGuardian.

**Métricas:** cross-table reads não sinalizados pelo nome 1 → 0.

### [performance-4] Overlapar a hidratação com o `Promise.all` inicial
**QA:** Performance · **Tactic:** Increase Concurrency · **Esforço:** S

**Problema**
> `hidratarNdes` só arranca depois do `Promise.all` e do enriquecimento, embora dependa apenas de
> `ndesDoBanco`. (Se `performance-1` for feito, este card vira N/A.)

**Métricas:** total do `montarPainel` de "soma" para "máximo" entre enriquecer e hidratar.

### [performance-5] Colapsar `listParaPainel` + `contarPendentes` numa query
**QA:** Performance · **Tactic:** Reduce Overhead · **Esforço:** S

**Problema**
> Duas queries com o MESMO LEFT JOIN por load. Com o índice novo o custo caiu, mas ainda são 2
> round-trips e o COUNT é derivável do mesmo scan.

**Melhoria Proposta**
> `count(*) FILTER (...) OVER ()` ou CTE.

**Métricas:** queries por load 2 → 1.

### [testability-4] Integration test com Postgres real para o LEFT JOIN
**QA:** Testability · **Tactic:** Sandbox · **Esforço:** M

**Problema**
> 16 asserções `expect(sql).toContain(...)` provam a string, não o comportamento. Um `NOT` esquecido
> no COUNT passaria. Débito herdado, agravado por ~46 LOC de SQL novo.

**Melhoria Proposta**
> Suíte de integração condicionada a `PGHOST`: 4 execuções (autorizada, pendente sem NDe, dry-run,
> dispensada) provando 2 linhas na lista e 1 no COUNT.

**Métricas:** casos de integração do delta 0 → ≥ 4.

---

## P3 — Baixo

### [deployability-3] Teste de contrato cross-boundary do `ndePendentes`
**QA:** Deployability · **Esforço:** S — fixture gerada no BE consumida por teste do FE, garantindo
que `computeKpis` e o COUNT concordem. **Métricas:** testes cross-boundary 0 → 1.

### [deployability-4] Seção "Rollback" no `DEPLOY.md`
**QA:** Deployability · **Esforço:** S — árvore de decisão (migration aditiva vs destrutiva, contrato
aditivo, env nova), referenciando `BootMigrator` e `RECEBIMENTOS_ENABLED`. **Métricas:** operador
decide em ≤ 2 min sem envolver o time.

### [integrability-4] Capturar HAR do grid `com297`
**QA:** Integrability · **Esforço:** L — destrava o GAP `nde-painel-lista-gap.md` (NDes emitidas fora
da ferramenta) e permite bulk-read. **Métricas:** HTTPs por abertura de painel 20 → 1.
**Dono:** Yuri (acesso à tela de Fiscais de Saída).

### [modifiability-4] Externalizar os caps de hidratação via `EnvironmentProvider`
**QA:** Modifiability · **Tactic:** Defer Binding · **Esforço:** S

**Problema**
> `PAINEL_NDES_CAP`, `PAINEL_NDE_HIDRATACAO_CAP`, `PAINEL_NDE_HIDRATACAO_TIMEOUT_MS` e
> `PAINEL_NDE_HIDRATACAO_BUDGET_MS` são compile-time. Os comentários dizem que existem para "não
> afogar o ERP compartilhado" — exatamente o cenário em que se quer baixar o cap sem redeploy.

**Melhoria Proposta**
> Ler as quatro do `EnvironmentProvider` com fallback nas constantes atuais (sem override =
> comportamento idêntico).

**Métricas:** caps externalizáveis 0 → 4 · mitigação sob incidente: redeploy (5–8 min) → restart (~30 s).

### [testability-5] Extrair o orquestrador da hidratação
**QA:** Testability · **Esforço:** S/M — **MESMA unidade de `modifiability-3`**. **Métricas:** deps do
painel 7 → ≤ 5 · stubs no builder de teste 7 → 4.

### [testability-6] `ClockProvider` injetável
**QA:** Testability · **Tactic:** Limit Non-Determinism · **Esforço:** S — remove `new Date()` do
serviço e do mapeamento, viabilizando snapshot/property-based testing. **Métricas:** sítios de
`new Date()` no delta 3 → 0.
