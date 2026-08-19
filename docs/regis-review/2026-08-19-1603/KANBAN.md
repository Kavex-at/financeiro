---
type: regis-review-kanban
run_id: 2026-08-19-1603
total: 55
counts: { p0: 3, p1: 19, p2: 28, p3: 5 }
fechados_na_remediacao: 8
---

# Kanban — Frente V — run 2026-08-19-1603

> Importável para o quadro. Ordem: P0 → P1 → P2 → P3; dentro de cada faixa, por esforço.
> Esforço: **S** ≤1d · **M** 2–5d · **L** >5d.

## ✅ Já fechados — não puxe estes cards

Fechados nos commits `dea5ce7` e `2418cdf`, **depois** do snapshot desta revisão.

| Card | O que foi feito |
|---|---|
| `testability-1` (P0) | `npm run verify:sql-aprovacoes` — migration aplicada a um PostgreSQL real (embedded, sem Docker); idempotência, tabelas, índices, CHECK e repositories verificados |
| `testability-2` (P0) | `jobs/ingest-aprovacoes.e2e.test.ts` — ingestão real contra ERP fake HTTP |
| `availability-1` (P1) | `try/catch` por título; falha sistêmica ainda aborta |
| `performance-2` (P1) | `BoundedConcurrency` limite 4 |
| `integrability-1` (P1) | Zod no boundary do client |
| `deployability-1` (P1) | `APROVACOES_ENABLED` em `render.yaml` + `DEPLOY.md` |
| `performance-3` (P2) | Cursor por página — 23.632 UPDATEs → 48 |
| `fault-tolerance-3` (P2) | `ultimoSnapshot` escopado por filial |

**Restam: 1 P0 · 15 P1 · 26 P2 · 5 P3.**

---

## P0 — Crítico

### [performance-1] Reduzir o custo da varredura · Performance · L · **BLOQUEADO (PV-07)**
- **Problema.** Uma chamada `fin026/infoTitulo/list` por título — 23.632 medidas na filial 2 em 12 meses; wall-clock ~3,3h (agora ~50–70min com a concorrência já aplicada).
- **Melhoria.** ⚠️ **A premissa original deste card caiu.** Supunha-se que bastava liberar a tela `fin103`. Ela é a **fila pessoal do usuário logado** — nunca serviria para varredura. O card vira: *investigar com o fornecedor do ERP se existe alguma projeção em massa de `FinTituloBloq` independente de quem está logado.*
- **Resultado.** Se existir: 23.680 → ~48 chamadas. Se não existir: o custo é estrutural e a alavanca passa a ser a janela de backfill (PV-08).
- **Tactic.** Reduce Overhead. **Nota:** o port já isola a troca em uma linha.

---

## P1 — Alto

### [availability-3] Backoff exponencial no retry · Availability · S
- **Problema.** `retries: 2`, `delayMs: 500` fixo — tolera menos de 1,4s de transiente.
- **Melhoria.** `backoffFactor` no `RetryExecutor`; instância de leitura com `retries: 4`, base 300ms, fator 2.
- **Resultado.** Janela de tolerância 1,4s → ~5s. **Tactic.** Retry.

### [deployability-2] / [fault-tolerance-1] Workflow de cron do job · Deploy + FT · S
- **Problema.** `ingest-aprovacoes` é o único das 4 frentes sem `.github/workflows/*.yml`. Sem cadência, o snapshot envelhece sem alarme e a Degradation deliberada vira "painel congelado".
- **Melhoria.** Espelhar `ingest-sispag.yml`. Só `workflow_dispatch` até o go-live; `schedule:` depois. Horário sem colisão com as outras ingestões.
- **Resultado.** Idade do snapshot ≤ 25h. **Tactic.** Heartbeat / Scale Rollouts.
- **Nota.** Card único; dois IDs mantidos para rastreabilidade cross-QA.

### [deployability-3] Receita de rollback da migration 0049 · Deployability · S
- **Problema.** Repo é forward-only; não há receita documentada para reverter as 3 tabelas se a estreia corromper o schema.
- **Melhoria.** Seção "Rollback de schema" no runbook, com `DROP TABLE` + `DELETE FROM schema_migrations`, restrita a homologação e a prod antes do go-live.
- **Resultado.** Rescue em ≤15min. **Tactic.** Rollback.

### [fault-tolerance-2] Alertar em `status='error'` · Fault Tolerance · S
- **Problema.** `finalizar(id,'error',msg)` grava e ninguém lê. Backfill quebrado há 3 dias é indistinguível de backfill não disparado.
- **Melhoria.** `GET /aprovacoes/health/last-run` + exit-code do job virando notificação do Actions.
- **Resultado.** MTTD: dias → 24h. **Tactic.** Condition Monitoring.

### [performance-4] Índices trigram para a busca `ILIKE` · Performance · S
- **Problema.** Busca livre com wildcard à esquerda cai em `Seq Scan` — não há índice trigram na 0049.
- **Melhoria.** Migration `0050`: `pg_trgm` + `gin (col gin_trgm_ops)` em `fornecedor_nome`, `documento_numero`, `responsavel_nome`.
- **Resultado.** p95 da busca ~300–800ms → ≤100ms. **Tactic.** Index discipline.

### [modifiability-1] Reduzir a complexidade de `executar` · Modifiability · S
- **Problema.** Cognitive 33, mais que o dobro do teto Biome. **Parcialmente resolvido**: o split em `processarFilial`/`processarPagina` já reduziu; medir de novo.
- **Melhoria.** Confirmar ≤15; extrair o que sobrar.
- **Resultado.** `executar` ≤15. **Tactic.** Split Module.

### [modifiability-3] Quebrar `TrilhaDrawer.tsx` · Modifiability · S
- **Problema.** 540 LOC com 7 componentes internos; a timeline será reusada no analítico da Fase 2.
- **Melhoria.** Mover para `components/trilha/` (`EtapaItem`, `MarcoZero`, `LacunasBloco`, `CabecalhoTitulo`, `TempoDaEtapa`).
- **Resultado.** Nenhum arquivo do drawer >200 LOC. **Tactic.** Split Module.

### [testability-3] Teste do entrypoint do job · Testability · S
- **Problema.** `jobs/ingest-aprovacoes.ts` não tem teste: parsing de `FILS`, janela default, early-exit e `RETOMAR` passam sem rede.
- **Melhoria.** Extrair os resolvers e cobrir os 4 caminhos.
- **Resultado.** ≥6 casos. **Tactic.** Specialized Interfaces.

### [testability-4] `ClockProvider` e propagação de `agora` · Testability · S
- **Problema.** A rota não passa `agora`, e o serviço de ingestão faz `new Date()` embutido — a tactic foi desenhada e o laço não fecha.
- **Melhoria.** `ClockProvider` injetável; remover o default de `listar`/`detalhar`.
- **Resultado.** 0 `new Date()` embutido na frente. **Tactic.** Limit Non-Determinism.

### [availability-2] Cadência + alarme de idade do snapshot · Availability · M
- **Problema.** Sem cron, `snapshotEm` cresce indefinidamente.
- **Melhoria.** Cron diário + métrica de idade com alarme em 48h.
- **Resultado.** Idade p95 ≤48h. **Tactic.** Heartbeat.

### [availability-4] Smoke contra homologação real · Availability · M
- **Problema.** A ingestão nunca tocou o Conexos real (o e2e usa ERP fake).
- **Melhoria.** Executar a Fase 1 do runbook em homologação e publicar os números no ADR-0038.
- **Resultado.** ≥1 execução real antes da estreia. **Tactic.** Self-Test.

### [integrability-2] / [modifiability-5] Contrato compartilhado FE↔BE · Integr + Modif · M
- **Problema.** `lib/aprovacoes.ts` replica literalmente 5 uniões, 5 interfaces e o `LACUNA_DESCRICAO`. Lacuna nova no backend não quebra o build do FE.
- **Melhoria.** `src/shared/aprovacoes-contract.ts` importado dos dois lados, ou codegen no `prebuild`.
- **Resultado.** Definições duplicadas 10 → 0. **Tactic.** Adhere to Standards + Encapsulate.
- **Nota.** Card único; dois IDs por cross-QA.

### [modifiability-2] Quebrar `page.tsx` · Modifiability · M
- **Problema.** 632 LOC, 58% acima do p95 do frontend; cada PV que fechar reabre o arquivo.
- **Melhoria.** Extrair `KpisCards`, `FiltrosBar`, `AprovacoesTable`, `useAprovacoesQuery`.
- **Resultado.** ≤200 LOC. **Tactic.** Split Module.

### [security-1] Claim `filiais` no JWT + fail-closed · Security · M · **depende de PV-09**
- **Problema.** `userCanActOnFilial` devolve `true` sem a claim, e **0% dos tokens a carregam**: qualquer analista autenticado vê a carteira multi-filial inteira. **Herdado da Frente IV** — vale igualmente para recebimentos e sispag.
- **Melhoria.** Emitir `permissions.filiais` no Supabase; então inverter o default para fail-closed. Provisionar usuários existentes por migration.
- **Resultado.** 100% dos tokens com claim; sem claim → `{items: [], total: 0}`.
- **Tactic.** Authorize Actors. **Nota.** Inverter só na Frente V deixaria a tela vazia enquanto as irmãs seguem abertas — a mudança é transversal.

---

## P2 — Médio

| Card | QA | Esf. | Problema → Melhoria → Resultado |
|---|---|:---:|---|
| `availability-5` | Avail | S | `/health` responde 200 mesmo com DB fora → `/health/deep` sondando DB e sessão ERP → detecção de dependência caída |
| `availability-6` | Avail | S | Runs órfãs em `running` sem consumidor → query no cron acionando `RETOMAR=1` → retomada automática |
| `deployability-4` | Deploy | S | Critérios de go-live qualitativos → tabela com 5 cortes numéricos de aborto → decisão objetiva |
| `fault-tolerance-5` | FT | S | Run morta por SIGKILL fica `running` para sempre → reaper de >6h marcando `error` → 0 zumbis |
| `integrability-4` | Integr | S | As 8 armadilhas do doc não têm regressão automatizada → fixtures reais do probe + casos no teste do client → ≥5 das 8 quebram o CI |
| `integrability-5` | Integr | S | `filCod` errado devolve `[]` sem sinal → contador de "trilha vazia inesperada" com piso → detecção em ≤1 run |
| `modifiability-4` | Modif | S | `PAGE_SIZE`, `MAX_PAGINAS` e janela hardcoded → `EnvironmentProvider` → ajuste vira dashboard |
| `performance-7` | Perf | S | `TrilhaDrawer` estático arrasta `date-fns` para o First Load → `next/dynamic` → −25 a −40 KB |
| `security-2` | Sec | S | Sondas gravam JSON de PRD em `/tmp` sem expurgo nem ACL → TTL + `mode 0o700` + registro de quem rodou + truncar PII do stdout → 0 artefatos residuais |
| `security-3` | Sec | S | `redactBody` ignora `responsavelNome`/`fornecedorNome`/`valor`/`cnpj`, e a query nunca é redigida → expandir chaves e aplicar à query → 0 PII no drain |
| `testability-5` | Test | S | Nenhum caminho de erro asserta log → injetar `LogService` e assertar contexto → ≥3 asserts |
| `testability-6` | Test | S | Precedência do resolver coberta só por exemplos → property-based (`fast-check`, **não instalado**) → ≥4 propriedades |
| `testability-7` | Test | S | `list` tem 32 combinações de filtro; o teste cobre 1 → +6 casos → todas as ramificações |
| `availability-7` | Avail | M | Sem breaker, outage prolongado itera 23k chamadas em timeout → circuit breaker → detecção ~10min |
| `deployability-5` | Deploy | M | 10 chaves `sync: false` sem reconciliação → drift check semanal `render.yaml` × dashboard + `/health/migrations` → detecção ≤7d |
| `deployability-6` | Deploy | M | Migrations nunca testadas em CI → passo com Postgres real no `ci.yml` (**o script `verify:sql-aprovacoes` já existe — falta plugá-lo**) → 50/50 |
| `fault-tolerance-4` | FT | M | Drift no % de `INDETERMINADO` invisível → view diária + contador na resposta → evidência para fechar PV-01 |
| `fault-tolerance-6` | FT | M | Divergência ERP × Postgres mascarada pelo `SEM_WORKFLOW` legítimo → reconciliação amostral semanal → divergência ≤1% |
| `integrability-3` | Integr | M | `apiFetch` devolve `Response` cru; 0 Zod no FE → `apiJson(url, schema)` com `SchemaDriftError` → 0 casts silenciosos |
| `modifiability-6` | Modif | M | 3 entradas de drift ontológico no `_watchlist` → `/retro-ontology` focado → 0 entradas |
| `performance-5` | Perf | M/S | `LIMIT/OFFSET` profundo não coberto por índice multi-filial → keyset ou índice global → p95 ≤200ms |
| `performance-8` | Perf | M | Sem budget wall-clock nem `AbortController` → budget de 2h + timeout de 30s por request → detecção de degradação lenta |
| `security-4` | Sec | M | Sem audit trail de consumo do painel → `aprovacao_acesso_log` fire-and-forget → forense em <5min |
| `security-5` | Sec | M | Token vazado vale até `exp` (~1h) → denylist server-side por `jti` → revogação <1min |
| `security-6` | Sec | M | JWT em `localStorage` → cookie `HttpOnly` + `SameSite=Strict` → 0 tokens acessíveis via JS |
| `fault-tolerance-8`* | FT | S | Falha antes do `bootstrapAppContainer` não deixa rastro na run → registrar antes → rastreabilidade total |

\* numeração do agente de origem; sem card separado no relatório.

---

## P3 — Baixo

| Card | QA | Esf. | Problema → Melhoria |
|---|---|:---:|---|
| `integrability-6` | Integr | S | `process.env` direto em `BcbClient` (fora do delta) → mover para `EnvironmentProvider` |
| `modifiability-7` | Modif | S | `routes/aprovacoes.ts` importa `ConexosCadastroClient` direto (layer-skip herdado) → `FiliaisService`. Some quando PV-09 fechar |
| `modifiability-8` | Modif | S | 879 LOC de sondas convivendo com 106 do job real em `jobs/` → mover para `scripts/` (**`scripts/` já existe agora**) |
| `performance-6` | Perf | S | `fetchFiliais` sem cache no mount → `sessionStorage` com TTL 30min → 1 request por sessão |
| `testability-8` | Test | M | Nenhum teste encadeia rota → serviço → repo → SQL → e2e completo (**depende do Postgres em CI**) |

---

## Sequência sugerida

**Sprint 1 — risco de estreia.** `deployability-2`/`fault-tolerance-1`, `deployability-3`,
`availability-3`, `fault-tolerance-2`, `performance-4`, `security-3`, `security-2`.

**Sprint 2 — fechar o que sobrou de CC-3.** `deployability-6` (plugar o `verify:sql-aprovacoes` no
CI), `availability-4` (homologação real), `testability-3`, `testability-4`.

**Sprint 3 — contrato e hotspots.** `integrability-2`/`modifiability-5`, `integrability-3`,
`modifiability-1`, `modifiability-2`, `modifiability-3`.

**Sprint 4 — segurança.** `security-1` (com PV-09), `security-4`, `security-5`, `security-6`.

**Fora de sprint, dependência externa.** `performance-1` — depende de descobrir com o fornecedor do
ERP se existe projeção em massa de `FinTituloBloq`. Se não existir, o card fecha como
"custo estrutural aceito" e a alavanca passa a ser a janela de backfill (PV-08).
