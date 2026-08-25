---
type: regis-review-kanban
run_id: 2026-08-25-1742-sispag-retomada
total: 52
counts: { p0: 6, p1: 21, p2: 21, p3: 4 }
---

# Kanban — SISPAG retomada — 2026-08-25-1742

> Ordem: P0 (S → M → L), P1, P2, P3.
> O detalhamento de cada card (Problema / Melhoria Proposta / Resultado Esperado, métricas e riscos)
> está na seção `{qa-slug}.md` correspondente, neste mesmo diretório.
> **[DUP]** marca cards que são o mesmo trabalho visto por lentes diferentes — contam uma vez só.

---

## P0 — Crítico (6)

### Bloqueiam a PRIMEIRA REMESSA REAL

| # | Card | QA | Esforço | Problema em uma linha |
|---|---|---|---|---|
| 1 | `fault-tolerance-1` | Fault Tolerance | S | `gerarRemessa` não serializa por `loteId` — duas requisições concorrentes criam DOIS lotes nativos e pagam duas vezes. `withAdvisoryLock` já existe e é usado por serviços vizinhos |
| 2 | `availability-1` **[DUP: fault-tolerance-7, deployability-3]** | Availability | S | Reaper de execuções presas existe, é testado, e não está agendado — `grep cron render.yaml` vazio |
| 3 | `integrability-1` | Integrability | M | Protocolo `QUESTION` do ERP tratado em 1 de 5 escritas; a docstring de `importarTitulos` prevê o cenário FIN_041 e o catch engole em erro genérico |

### Bloqueiam a PRIMEIRA CONCILIAÇÃO REAL

| # | Card | QA | Esforço | Problema em uma linha |
|---|---|---|---|---|
| 4 | `fault-tolerance-2` **[DUP: testability-2, availability-2]** | FT | M | Perna de VOLTA nunca exercitada ao vivo — 26 testes mockados contra um `processar` irreversível no fin010 |
| 5 | `testability-1` | Testability | M | 3 shapes centrais da VOLTA (`fin015/finItemSispag/list`, `fin052/arquivosRetorno/list`, `.../Detalhe/list`) + `cmn025` sem fixture nem contrato |
| 6 | `testability-2` **[DUP de 4]** | Testability | M | Mesmo trabalho do card 4, pela lente de teste |

---

## P1 — Alto (21)

### Esforço S

| Card | QA | Problema em uma linha |
|---|---|---|
| `availability-3` | Availability | `ConciliacaoEmDuvidaError` sem classe tipada no FE — cai no toast genérico, ao contrário do irmão da remessa |
| `deployability-1` | Deployability | `/health` não expõe as flags; operador só descobre kill-switch OFF clicando |
| `deployability-2` | Deployability | Copy diz `CONEXOS_DRY_RUN` quando a causa dominante pós-deploy é `SISPAG_LIVE_WRITE_ENABLED` |
| `design-system-1` | Design System | Banner de execuções presas sem `role="alert"`/`aria-live` |
| `fault-tolerance-3` | Fault Tolerance | `listarLotesNativos` lê só a 1ª página, sem aviso — contamina a marca d'água quando o histórico crescer |
| `fault-tolerance-4` | Fault Tolerance | Janela `REMESSA_GERADA` + ledger `reconciling` sem autocura: o gate de entrada impede a retomada |
| `fault-tolerance-5` | Fault Tolerance | `transicionarStatus` no `RemessaService` ignora rows afetadas — o irmão da conciliação verifica |
| `integrability-5` | Integrability | `arquivosRetorno/processar` manda `items[]` (plural) nunca testado com N>1 — mesmo shape enganoso que quebrou o import |
| `modifiability-2` | Modifiability | Chave `filCod:docCod:titCod` montada em 8 sites de 5 arquivos, com 2 variantes já divergentes |
| `performance-1` | Performance | `importarTitulos` serial: 25 itens ≈ 25s. `BoundedConcurrency` já é usado no painel |
| `performance-2` | Performance | N+1 em `listContasFavorecido` sem dedupe por `pesCod` — o painel já faz certo |
| `performance-3` | Performance | Axios do Conexos sem keep-alive: 25 POSTs = 25 handshakes TLS |
| `testability-5` | Testability | `listContasCorrentes` e `listContasFavorecido` sem teste — `pctVldStatus` decide todo o import |
| `testability-6` | Testability | `ConciliacaoExecucaoRepository` (novo, 149 LOC) com 15% de linhas e 0% de branches |

### Esforço M / L

| Card | QA | Esforço | Problema em uma linha |
|---|---|---|---|
| `availability-2` **[DUP de fault-tolerance-2]** | Availability | M | Gate ao vivo da retomada da conciliação |
| `design-system-4` | Design System | M | "Gerar um lote novo" é decisão financeira num toast de 60s — e a mensagem manda a pessoa sair para conferir o ERP |
| `integrability-4` | Integrability | M | Contract test cobre 6 de 17 endpoints (35%) |
| `modifiability-3` | Modifiability | M | `FEBRABAN_POR_BNCCOD` em 5 cópias — esta feature adicionou a 5ª — com fallback silencioso `?? 341` |
| `modifiability-1` | Modifiability | L | `gerarRemessa`: 396 LOC, complexidade cognitiva 70 (teto 15) |
| `modifiability-5` | Modifiability | L | `page.tsx` 1026 LOC, 14 `useState`, 12 handlers async no mesmo componente |
| `testability-3` | Testability | L | Gate ao vivo não é repetível: consome 2 títulos por cenário e deixa lotes vazios que não podem ser cancelados |

---

## P2 — Médio (21)

| Card | QA | Esforço | Problema em uma linha |
|---|---|---|---|
| `availability-4` | Availability | S | Reaper só loga — sem canal ativo (e-mail/Slack), ninguém lê |
| `availability-5` | Availability | S | `MINUTOS_ORFAO` em dois lugares — painel e reaper podem divergir |
| `deployability-3` **[DUP de availability-1]** | Deployability | S | Cron do reaper via GitHub Actions |
| `design-system-2` | Design System | S | Banner de contexto sem `role="region"` |
| `design-system-3` | Design System | S | `text-amber-700` hardcoded onde o aviso vizinho usa `text-warning` |
| `fault-tolerance-6` | Fault Tolerance | S | As 3 leituras críticas engolem 401/timeout/5xx como `undefined` sem log |
| `fault-tolerance-7` **[DUP de availability-1]** | Fault Tolerance | S | Agendar o reaper |
| `integrability-2` *(rebaixado de P1)* | Integrability | S | **Dívida de verificação:** medir os endpoints restantes. Não adicionar `filCod#EQ` cegamente — medido que `fin005` e `fin064` já escopam |
| `integrability-6` | Integrability | S | `describeConexosValidation` duplicado 100%; `ErpResponseReader` existe e ninguém importa |
| `integrability-7` | Integrability | S | `listarArquivosRemessa` é o único filtro do delta sem `#EQ` explícito |
| `performance-4` | Performance | S | `heavyRouteLimiter` em 4 de 18 rotas — falta em `/painel`, `/retornos`, `/modalidades-disponiveis` |
| `performance-5` | Performance | S | Sem instrumentação de latência por etapa — impossível dimensionar em produção |
| `security-1` | Security | S | Teste de redação de fixture não cobre valores numéricos |
| `security-2` | Security | S | `POST /remessa` devolve o CNAB no JSON, duplicando a superfície do GET dedicado |
| `testability-4` | Testability | S | `hojeUtc()` lê `new Date()` direto — testes de R1/R2 dependem do dia real |
| `availability-6` | Availability | M | Motivo do "indeterminado" não é tipado — reaper e UI não distinguem "sem pista" de "dois candidatos" |
| `integrability-8` | Integrability | M | Sem métrica por endpoint × outcome — drift do ERP só aparece como incidente |
| `modifiability-4` | Modifiability | M | O gate ao vivo reimplementa a sequência em vez de consumir o service |
| `modifiability-6` | Modifiability | M | Máquina de retomada como 9 ifs, enquanto a ontologia já a declara como tabela de 8 linhas |
| `performance-6` | Performance | M | Sem budget agregado — soma das chamadas pode estourar o proxy sem contexto |
| `testability-7` | Testability | M | Contract test pega campo que some, não campo que muda de tipo — o defeito do `titulosCount` escaparia |

---

## P3 — Baixo (4)

| Card | QA | Esforço | Problema em uma linha |
|---|---|---|---|
| `deployability-4` | Deployability | S | 50 migrations sem convenção de rollback escrita |
| `deployability-5` | Deployability | S | Três versões de Node convivendo (CI 24, cron 22, Render default) |
| `security-3` | Security | S | Detector de host remoto do `BootMigrator` cobre 5 provedores por regex |
| `security-4` | Security | S | Ativação das escapatórias `PERMITIR_*` só em `console.warn`, sem log estruturado |

---

## Cards descartados na verificação do orquestrador

Registrados para que não voltem numa próxima revisão sem nova evidência.

| Card proposto | Agente | Por que caiu |
|---|---|---|
| `integrability-3` (P0) — `fin005/list` vazaria contas de outra filial | integrability | Medido ao vivo: 17 linhas, todas da filial 2. `fin015` é a exceção entre os endpoints |
| design-system: migrar toasts para `notify()` | design-system | `notify()`, `NotificationCenter` e "Patterns §21" não existem neste repositório |
| design-system: persistir operações financeiras no NotificationCenter | design-system | idem |
