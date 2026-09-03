# tapar-furos-backend — follow-ups do Regis-Review

**Run:** `2026-09-03-1901-tapar-furos-backend`
**Relatórios:** `docs/regis-review/2026-09-03-1901-tapar-furos-backend/REPORT.md` e `KANBAN.md`
**Branch:** `fix/tapar-furos-backend` · commits `e575221` + `e974796`
**Escopo do review:** restrito ao delta (5 arquivos), `--quick`.

## Veredito do gate

**Score consolidado 8,07/10. ZERO findings P0 → o gate do pipeline PASSA.**

| QA | Score | P0 | P1 | P2 | P3 |
|---|---:|---:|---:|---:|---:|
| Availability | 8,0 | 0 | 0 | 2 | 1 |
| Deployability | 8,0 | 0 | 0 | 2 | 1 |
| Integrability | 7,5 | 0 | **1** | 1 | 1 |
| Modifiability | 8,5 | 0 | 0 | 0 | 3 |
| Performance | 8,5 | 0 | 0 | 1 | 2 |
| Fault Tolerance | 8,0 | 0 | 0 | 2 | 1 |
| Security | 8,0 | 0 | 0 | 1 | 1 |
| Testability | 8,0 | 0 | 0 | 2 | 2 |
| **Total** | **8,07** | **0** | **1** | **11** | **12** |

Conforme a política do pipe, **P1/P2/P3 não são implementados neste ciclo** — ficam registrados aqui.

---

## Resolvido DENTRO deste ciclo (não é follow-up)

### `[performance-3]` — pool congelado antes das retentativas → **FEITO** (commit `e974796`)

Este card não é dívida: era uma **regressão que o próprio BE-05 introduzia**, e por isso foi
remediado ainda no ciclo em vez de virar follow-up. `query` congelava
`const pool = this.connectionPool` fora do `RetryExecutor`. Enquanto o handler de `error` apenas
soltava a referência, o pool congelado seguia utilizável e a retentativa funcionava; depois de
passar a encerrá-lo de fato, a 2ª tentativa bateria em `Cannot use a pool after calling end on the
pool` — trocando erro recuperável por definitivo exatamente no caminho que o retry existe para
salvar. A `init()` passou para dentro do executor e há teste de regressão
(`retries against a NEW pool after the broken one was ended`).

---

## P1 — entra primeiro na janela pós-merge

### `[integrability-2]` Encerrar o pool secundário do `conexosSessionStore` no shutdown

- **Origem:** `F-integrability-2` (Integrability 7,5). Cross-QA: Availability, Fault Tolerance, Deployability. É o **R-1** do REPORT.
- **Achado:** `src/backend/services/conexosSessionStore.ts:242-256` cria um **segundo** `Pool` Postgres (`max: 2`) no load do módulo, com handler `pool.on('error', () => undefined)` — **literalmente a assinatura do BE-05 que este tweak acabou de corrigir no cliente primário**. Esse pool não é conhecido pelo `gracefulShutdown`, então cada SIGTERM deixa até 2 sessões penduradas no pooler até o `idleTimeoutMillis`.
- **Por que importa:** o laço de retro-alimentação do BE-05 (esgotamento → erro classificado como transitório → mais conexões) continua **armado** num segundo sítio, em escala menor (`max: 2` vs `max: 5`).
- **Esforço:** S. Aplicar o mesmo `pool.end()` com guarda de reentrada e plugar no shutdown.
- **Nota do agente Backend:** este é o achado mais valioso do run. O tweak corrigiu o sítio que eu fui mandado corrigir; a busca por outros sítios da mesma classe não estava no escopo e encontrou este. Recomendo tratá-lo como continuação direta, não como backlog.

---

## P2 — janela seguinte

| Card | QA | Achado | Esforço |
|---|---|---|---|
| `[availability-1]` | Availability | `/health` responde 200 durante o drain; a flag `shuttingDown` vive num closure isolado e nenhum endpoint a lê. Sem sinal de readiness, o LB pode mandar requisição nova para uma instância que está descendo. | S |
| `[availability-2]` | Availability | `server.close()` não fecha conexões keep-alive **ociosas** (`closeIdleConnections`/`closeAllConnections`: 0 ocorrências no repo). Isso pode fazer o caminho feliz virar o degenerado — todo drain estourando os 10s. | S |
| `[deployability-2]` | Deployability | Rollback é manual no dashboard do Render, sem runbook versionado (`docs/runbooks/` não tem rollback). | M |
| `[deployability-3]` | Deployability | `render.yaml:24` declara `preDeployCommand` que **nunca roda** (feature de plano pago; serviço criado pelo dashboard). O `BootMigrator` mitiga, mas duas fontes divergem. | S |
| `[integrability-1]` | Integrability | `IClient` (`src/backend/domain/core/client/IClient.ts`) declara só `init()`. O `close()` novo é convenção informal, e o shutdown referencia a **classe concreta**. Só 1 de 17 clients declara `implements IClient`. | S |
| `[performance-1]` | Performance | Teto real de sessões do plano Supabase não documentado. Teto teórico de 35 (7 processos × 5) contra um `max_client_conn` desconhecido — o próximo bump legítimo de `poolMaxConnections` pode estourar sem aviso. | S |
| `[fault-tolerance-1]` | Fault Tolerance | Teto de drenagem de 10s usa só ~33% do envelope de ~30s do Render. Requisições mais longas que 10s reproduzem o **mesmo** órfão `reconciling`, agora com log. Propõe ~25s amarrado aos timeouts dos clientes. | S |
| `[fault-tolerance-2]` | Fault Tolerance | Force-exit por estouro do drain só deixa `console.log`. Uma rota patológica que **sempre** estoura ficaria invisível para `/operacao`, `job_execucao` e `alerta` — reintroduz a categoria de falha invisível que a ADR-0042 gastou um workflow para eliminar. | S |
| `[security-1]` | Security | `src/backend/http/gracefulShutdown.ts:94` loga `falha ao encerrar o pool: ${asMessage(error)}` sem passar pelo `redactErrorMessage` (`src/backend/http/redact.ts:79`), cuja docstring nomeia `password authentication failed for user "financeiro"` como alvo — exatamente o que o `pg` emite. Fix de 1 linha. | S |
| `[testability-1]` | Testability | 3 branches "reais" descobertas em `gracefulShutdown.ts` (58,82% de branches): o `if (err)` do callback de `server.close`, a guarda `if (exited) return` de `exitOnce`, e o default `target = process`. **Consequência concreta:** remover o `clearTimeout` deixaria os 8 testes verdes com `onExit(0)` chamado 2×. | S |
| `[testability-2]` | Testability | `index.ts` continua sem teste (`void start()` no top-level, 0% de cobertura), com 5 passos de boot ordenados cuja sequência já causou incidente em 2026-08-10. Propõe extrair `bootstrap.ts`. | M |

---

## P3 — backlog

`[availability-3]` instrumentar duração do drain e frequência de force-exit ·
`[deployability-1]` `/health` → 503 durante o drain ·
`[integrability-3]` documentar por que a sessão do Conexos **não** é encerrada no SIGTERM ·
`[modifiability-1]` extrair `endPoolQuietly(pool)` (o idiom `pool.end().catch(...)` aparece em 2 sítios) ·
`[modifiability-2]` amarrar `drainTimeoutMs` a `process.env` ·
`[modifiability-3]` extrair `buildApp()`/`startServer()` do `index.ts` (198 LOC, 30 imports) ·
`[performance-2]` histograma p50/p95/p99 de latência HTTP e de query ·
`[fault-tolerance-3]` instalar `unhandledRejection`/`uncaughtException` como último handler ·
`[security-2]` ~40 docstrings `Run:` em `src/backend/jobs/*.ts` ainda ensinam `npx tsx jobs/...` ·
`[testability-3]` sanity-test que falha se um script crítico voltar a começar com `npx ` (trava a classe do BE-09 em 0) ·
`[testability-4]` ratchet mensal no threshold de cobertura do frontend.

---

## Estágio de aprendizado (obrigatório no pipe v2)

> *"Que regra teria evitado estes bugs?"* — proposta de diff para o `CLAUDE.md`, a decidir com o Yuri.

1. **Todo recurso de processo que é aberto precisa de dono que o feche.** O BE-05 e o
   `[integrability-2]` são o mesmo defeito em dois sítios: um `Pool` criado sem ninguém responsável
   por `end()`. Uma regra candidata: *"Client que abre pool/socket/handle expõe `close()` e é
   registrado no shutdown; handler de `error` que descarta um recurso deve encerrá-lo, nunca só
   soltar a referência."* Isso teria pego os dois de uma vez.
2. **Gate que não pode falhar não é gate.** O BE-09 passou despercebido porque `npx` transforma
   ausência de ferramenta em sucesso silencioso. Regra candidata: *"Script de gate invoca o binário
   local pelo nome (`biome`, `jest`, `tsc`), nunca via `npx` — o modo de falha correto de um gate sem
   dependência é exit ≠ 0, não exit 0."* O card `[testability-3]` automatiza a verificação.
3. **Divergência entre regra escrita e prática medida.** O `CLAUDE.md` exige *commit subjects em
   inglês*, mas os commits recentes da `main` são em português (`feat(sispag): a analista copia a
   linha digitável…`, `feat(operacao): painel recortado por identidade…`), inclusive depois da
   ADR-0042 — que revisou justamente esse bloco e **manteve** a exigência em inglês. Segui a regra
   escrita (subject em inglês, corpo em português), mas a divergência precisa de decisão: ou a
   ADR-0042 ganha um adendo admitindo a prática (como fez com as mensagens de log), ou os commits
   passam a seguir a regra. Hoje ela tem o mesmo defeito que a ADR-0042 diagnosticou: *"uma regra
   que 40% do código viola não é uma regra, é ruído"*.
