---
type: regis-review-report
run_id: 2026-10-22-1647-sispag-situacao-lotes
generated_at: 2026-10-22T20:30:00-03:00
audience: technical (architects + senior devs + tech lead)
basis: Bass & Clements — Software Architecture in Practice (3 de 8 QAs executados por escolha de escopo: Testability, Modifiability, Fault Tolerance)
scope: REDUZIDO — review incremental do delta `origin/main..HEAD` da branch `worktree-sispag-situacao-lotes` (PR C de `sispag-situacao-pagamento`, ADR-0076, regra `prontidao-lote` I20)
qas_run: [testability, modifiability, fault-tolerance]
qas_not_run: [availability, deployability, integrability, performance, security]
total_cards: 13
total_p0: 0
total_p1: 3
total_p2: 9
total_p3: 1
overall_score: 7.1
weights_used: { testability: 1.0, modifiability: 1.2, fault_tolerance: 1.3 }
---

# Regis-Review — financeiro — 2026-10-22-1647-sispag-situacao-lotes

## 0. Escopo da rodada (ler antes do scorecard)

Esta é uma rodada **REDUZIDA por desenho**. Três dos oito QAs do rito foram executados nesta
rodada; **cinco não foram rodados** — não por falta de dados, mas porque o delta não toca os
artefatos correspondentes. Não os score, não os infira; o REPORT trata apenas dos três eixos
medidos.

| QA | Estado nesta rodada | Justificativa |
|---|---|---|
| Testability | ✅ executado | delta altera gate de finalização, orquestrador e espelho FE — superfície de teste cresceu |
| Modifiability | ✅ executado | delta inflou `LotePagamentoService.ts` (+109 LOC), `page.tsx` (+61) e `lib/sispag.ts` (+62) |
| Fault Tolerance | ✅ executado | delta adiciona guarda nova com leitura ao vivo no caminho de escrita (`finalizarLote`) |
| Availability | ⛔ não rodado | sem alteração de job de ingestão, EventBridge, scheduler ou endpoint monetário |
| Deployability | ⛔ não rodado | sem mudança de pipeline, Render hook, Terraform ou SSM |
| Integrability | ⛔ não rodado | nenhum contrato novo com Conexos (`fin064`/`com298` já existiam); paridade BE↔FE coberta por Modifiability |
| Performance | ⛔ não rodado | sem endpoint de alta carga novo; a latência da releitura `fin064` entrou como débito em FT/Modifiability |
| Security | ⛔ não rodado | nenhuma mudança em AuthZ/AuthN; só reuso de `SISPAG_EXECUTAR` existente |

**Relevante para a reunião**: números abaixo são de 3 QAs, não dos 8. Não extrapole. O overall
`7.1` é a média ponderada dos três executados; pesos de Security, Availability etc. não compõem
porque não foram medidos.

## 1. Executive scorecard

Pesos aplicados nesta rodada: **Fault Tolerance 1.3**, **Modifiability 1.2**, **Testability 1.0**
(soma 3.5). Overall = (7.5·1.0 + 7.0·1.2 + 7.0·1.3) / 3.5 = **7.14**.

| QA | Score (0–10) | P0 | P1 | P2 | P3 | Top finding |
|---|---|---|---|---|---|---|
| Testability | 7.5 | 0 | 0 (após merge e re-triagem) | 4 | 0 | F-testability-3: GET /lotes não valida `prontidao` no payload |
| Modifiability | 7.0 | 0 | 2 | 3 | 0 | F-modifiability-1: `LotePagamentoService.ts` em 956 LOC + aviso Biome 17 |
| Fault Tolerance | 7.0 | 0 | 1 (merged) | 2 | 1 | F-fault-tolerance-1 ∪ F-testability-2: `/finalizar` sem `Idempotency-Key` |
| **Overall (3 QAs)** | **7.1** | **0** | **3** | **9** | **1** | — |

Interpretação:
- 0–3: risco estrutural — bloqueia escalonamento
- 4–6: dívida defensável — endereçar nesta janela de planejamento
- 7–8: saudável com oportunidades pontuais ← **estado atual**
- 9–10: estado-da-arte

**Leitura rápida**: o núcleo do delta (`ProntidaoLoteResolver` puro + `ProntidaoLoteService`
orquestrador + guarda `exigirSituacoesPagaveis` antes da verificação TED/PIX + CAS
`versao+status`) está sólido. A dívida está na periferia: endpoint de escrita financeira sem
`Idempotency-Key`, hotspots herdados que esta fatia continuou a inchar (`LotePagamentoService.ts`,
`page.tsx`, `lib/sispag.ts`) e loop sequencial de leitura ao Conexos sem deadline agregado.

## 2. Top 10 risks (cross-QA)

Ranqueados por severidade × leverage × business impact.

### R-1: `POST /sispag/lotes/:id/finalizar` sem `Idempotency-Key` e sem teste de reentrância
- **QA(s)**: Fault Tolerance, Testability
- **Findings**: F-fault-tolerance-1, F-testability-2
- **Evidência sintetizada**: handler em `routes/sispag.ts:374-412` só valida `{ versao }`; grep
  por `Idempotency-Key` → 0. Defesa única é CAS `versao+status` em
  `LotePagamentoService.ts:626-630, 881-920`. Nenhum teste em `routes/sispag.test.ts`,
  `prontidaoLotes.test.ts` ou `prontidaoComponentes.test.tsx` reproduz duplo-POST concorrente.
- **Impacto técnico**: retry transparente (proxy/browser) com mesmo `versao` passa a 1ª checagem
  em paralelo. CAS impede duplicação de estado, mas o 2º request recebe 409 em vez de 200
  idempotente — divergência "cliente reporta erro, backend finalizou".
- **Impacto de negócio**: `finalizarLote` dispara `fin064` ao vivo item-a-item + verificação
  TED/PIX. Duplo-disparo satura pool Postgres e cota Conexos (`fin064` é o endpoint mais contado
  do tenant). Precedente já existe em 3 rotas (`/ingestao`, `/remessa`, `/conciliacao`).
- **Card(s)**: `finalizar-idempotency` (merge canônico — ver §3 CC-1)
- **Custo de inação em 6 meses**: ticket "finalizei e deu erro, mas finalizou" × 1–2/sem em
  janela de instabilidade. Premissa: taxa de retry transparente ≥ 1% nesses períodos.

### R-2: `LotePagamentoService.ts` em 956 LOC — encosta no teto operacional
- **QA(s)**: Modifiability (direto), Testability (test file em 1 517 LOC)
- **Findings**: F-modifiability-1, F-testability-4
- **Evidência**: `wc -l` = 956 (era 832, +109 no delta); 12 ações públicas; Biome
  `noExcessiveCognitiveComplexity` 17 em `incluirTitulo:470`; 4 novos métodos privados
  empilhados.
- **Impacto técnico**: a próxima guarda cai aqui por padrão; custo marginal do próximo teste
  cresce com N.
- **Impacto de negócio**: maior fonte de diff do SISPAG; PRs paralelos serializam por conflito.
- **Card(s)**: `modifiability-1`, `testability-5`
- **Custo de inação em 6 meses**: +200/300 LOC em 2–3 fatias → arquivo passa de 1 200 LOC e vira
  gargalo de PR. Premissa: cadência de 1 fatia SISPAG a cada 3–4 semanas.

### R-3: `src/frontend/app/sispag/page.tsx` em 1 905 LOC — god-component do SISPAG
- **QA(s)**: Modifiability
- **Findings**: F-modifiability-2
- **Evidência**: 1 905 LOC, 46 imports; `SispagPanel` orquestra 4 abas + 4 filtros + 3 callbacks;
  esta fatia adicionou `filtroProntidao`, `ordemLotes`, `lotesRascunhoOrdenados`,
  `candidatosVisiveis` (page.tsx:528-540).
- **Impacto técnico**: toda alteração de aba/filtro/ordenação passa aqui — maior fonte de
  merge-conflict do SISPAG.
- **Impacto de negócio**: features paralelas da maior frente do produto são serializadas.
- **Card(s)**: `modifiability-2`
- **Custo de inação em 6 meses**: tempo médio de ciclo da fatia SISPAG +15% por rodada de
  rebase. Premissa: 3+ fatias SISPAG paralelas no próximo trimestre.

### R-4: `lerItensAoVivo` sequencial, sem deadline agregado, sem abstração de I/O
- **QA(s)**: Fault Tolerance, Modifiability (e Performance latente, não medido)
- **Findings**: F-fault-tolerance-2, F-modifiability-5
- **Evidência**: loop `for … of itens` em `LotePagamentoService.ts:761-786` com
  `.catch(() => undefined)` por item; sem `AbortController`, sem concorrência limitada, sem
  endpoint `fin064` em lote. No bulk client-side: O(N lotes × N itens) sequencial.
- **Impacto técnico**: lote de 20 itens contra Conexos a 1s/chamada consome ~20s; proxy/browser
  timeout pode cortar antes de o backend terminar.
- **Impacto de negócio**: UX degrada em pico (fechamento mensal); mistura de verdades entre
  cliente e backend.
- **Card(s)**: `fault-tolerance-2`, `modifiability-5`
- **Custo de inação em 6 meses**: 1ª janela de Conexos degradado + bulk ~40 lotes → trava UI por
  minutos. Premissa: Conexos tem p99 ≥ 2× p50 em dias de carga.

### R-5: Trilha das transições do delta em `process.stdout`, não em DB consultável
- **QA(s)**: Fault Tolerance (direto); impactaria Security se estivesse no escopo
- **Findings**: F-fault-tolerance-4
- **Evidência**: `audit()` em `LotePagamentoService.ts:945-955` delega a `LogService.info` →
  `process.stdout.write` (`LogService.ts:19-27`). Zero tabela consultável para "quem recusou /
  finalizou o lote L1 em DD/MM?".
- **Impacto técnico**: dívida global (não introduzida por este PR, mas também não fechada para
  suas transições novas).
- **Impacto de negócio**: auditoria depende do retention do CloudWatch (sem SLA documentado).
- **Card(s)**: nenhum nesta rodada (débito global, requer `/feature-new` próprio — ver
  `ontology/_inbox/migration-debt.md`)
- **Custo de inação em 6 meses**: 1º pedido formal de compliance → retrabalho.

### R-6: Serializer `GET /lotes` não exercitado para preservar `prontidao`
- **QA(s)**: Testability
- **Findings**: F-testability-3
- **Evidência**: `routes/sispag.test.ts:116-120` mocka `ProntidaoLoteService.comProntidao` como
  passthrough. Nenhum teste de rota prova que `apiView().lotes()` preserva a chave `prontidao`.
- **Impacto técnico**: refactor que omita `prontidao` passa nos tests do backend.
- **Impacto de negócio**: selo "Pronto para finalizar" some silenciosamente; analista perde o
  filtro.
- **Card(s)**: `testability-3`
- **Custo de inação em 6 meses**: 1 regressão típica em 2 fatias que mexam no serializador.

### R-7: Contrato `SituacaoPagamento` duplicado em `src/frontend/lib/sispag.ts` (2 749 LOC)
- **QA(s)**: Modifiability (Integrability latente)
- **Findings**: F-modifiability-3
- **Evidência**: `lib/sispag.ts` 2 749 LOC espelha `interface/sispag/*.ts`; delta duplicou 11
  códigos + 2 ações + 1 dono + 2 tipos. Teste de paridade bloqueia drift mas não corta o custo
  marginal (2× por fatia).
- **Impacto técnico**: cada esquecimento no espelho bloqueia PR (fricção, não regressão).
- **Impacto de negócio**: taxa fixa de "o espelho faltou" por fatia de contrato.
- **Card(s)**: `modifiability-3`
- **Custo de inação em 6 meses**: ~1h extra por fatia SISPAG; ponto duro se o FE sair do
  monorepo.

### R-8: Falta teste cobrindo falha Conexos em 1 item + bloqueio por status em outro no mesmo lote
- **QA(s)**: Testability
- **Findings**: F-testability-1 (premissa reajustada — ver §7)
- **Evidência**: dois testes do bloco `ADR-0076 I20d` já cobrem mix em `avaliarVivos`
  (`[bloqueada, pronta]` e `[FORA_DA_CARTEIRA, pronta+fontesIndisponiveis]` em
  `LotePagamentoService.test.ts:715-767`). Falta: `conexos.getTituloAPagar.mockResolvedValueOnce(ok).mockRejectedValueOnce('503')`
  combinado com bloqueio por status em outro item no mesmo lote — o cenário em que
  `catch(() => undefined)` produz "situação não conferida" num item e `BLOQUEADO` por status em
  outro no mesmo `BatchHasBlockedItemsError.details.itens[]`.
- **Impacto técnico**: paralelização futura (previsível quando lote > 30 itens) muda ordem de
  `bloqueados[]` e passa verde se não houver mix testado.
- **Impacto de negócio**: baixo hoje; cresce com volume.
- **Card(s)**: `testability-1` (reajustado P1→P2, esforço S)
- **Custo de inação em 6 meses**: baixo até a 1ª refatoração de performance.

### R-9: Bulk "Finalizar N prontos" sem botão "Parar"
- **QA(s)**: Fault Tolerance
- **Findings**: F-fault-tolerance-3
- **Evidência**: `FinalizarProntos.tsx:56-60` bloqueia o fechar enquanto `rodando`;
  `prontidaoLotes.ts:102-122` é loop puro sem `AbortSignal`.
- **Impacto técnico**: backend íntegro, front sem controle.
- **Impacto de negócio**: fricção cresce com escala; interage com R-4.
- **Card(s)**: `fault-tolerance-3`
- **Custo de inação em 6 meses**: 1 ticket/mês quando o bulk cruzar ~20 lotes.

### R-10: Prontidão degradada em bloco sem bandeira na response
- **QA(s)**: Fault Tolerance (Condition Monitoring), Testability (serializer)
- **Findings**: F-fault-tolerance-5
- **Evidência**: `ProntidaoLoteService.comProntidao` em `ProntidaoLoteService.ts:30-67` captura
  amplamente e devolve `lotes` sem campo `prontidao` nem flag "degradado". Selo some sem
  explicação.
- **Impacto técnico**: analista interpreta silêncio como "nada a finalizar".
- **Impacto de negócio**: baixo.
- **Card(s)**: `fault-tolerance-4`
- **Custo de inação em 6 meses**: baixa severidade.

## 3. Cross-cutting findings

### CC-1: Idempotência & reentrância no finalize (MERGE CANÔNICO)
- **Aparece em**: Testability, Fault Tolerance
- **Findings**: F-testability-2, F-fault-tolerance-1
- **Diagnóstico unificado**: duas superfícies — handler HTTP e cliente bulk — descrevem o MESMO
  gap: ausência de `Idempotency-Key` e de teste de duplo-disparo. A defesa efetiva é o CAS
  `versao+status`, correta mas invisível para o cliente, que recebe 409 em vez de 200 idempotente.
  Parte do gap é contrato (header), parte é assert (regressão), parte é infra (tabela leve).
- **Recomendação consolidada**: 1 card único `finalizar-idempotency` cobrindo (a)
  `Idempotency-Key` opcional no handler `/sispag/lotes/:id/finalizar` com tabela
  `(idempotency_key, lote_id, versao_pedida, resultado, criado_em)` TTL 24h; (b) teste de rota
  com 2 chamadas concorrentes; (c) teste cliente `prontidaoLotes.test.ts` para
  `finalizarEmSequencia([L1, L1], …)`. **Esse card substitui `testability-2` + `fault-tolerance-1`.**

### CC-2: Hotspots herdados que o delta continuou a inchar
- **Aparece em**: Modifiability, Testability
- **Findings**: F-modifiability-1 (service), F-modifiability-2 (page), F-testability-4 (test file)
- **Diagnóstico unificado**: a fatia nasceu com código novo DDD-friendly (resolver puro, service
  enxuto), mas colou toda a guarda em `LotePagamentoService` (+109), todo o filtro/ordem em
  `page.tsx` (+61) e espelhou no test file (+113). Em 6 meses, cada fatia SISPAG empilha
  +100 LOC em cada hotspot.
- **Recomendação consolidada**: `modifiability-1` ANTES da próxima guarda (I20+); `modifiability-2`
  quando entrar uma 5ª aba ou 5º filtro; `testability-5` como complemento imediato de
  `modifiability-1`.

### CC-3: Caminho crítico do finalize precisa de abstração de I/O
- **Aparece em**: Fault Tolerance (Timeout), Modifiability (Encapsulate)
- **Findings**: F-fault-tolerance-2, F-modifiability-5
- **Diagnóstico unificado**: `lerItensAoVivo` tem três problemas no mesmo loop — serial, sem
  deadline agregado, sem abstração. Qualquer evolução exige editar aqui.
- **Recomendação consolidada**: `modifiability-5` primeiro (extrai), `fault-tolerance-2` depois
  (aplica deadline + concorrência bounded). `finalizarLote` continua fachada.

### CC-4: Fronteira HTTP + caminhos degradados sem assert explícito
- **Aparece em**: Testability (serializer), Fault Tolerance (observability)
- **Findings**: F-testability-3, F-fault-tolerance-5
- **Diagnóstico unificado**: a chave `prontidao` sobrevive à `LotePagamentoApiView.lotes()` apenas
  por acidente; quando o `catch` amplo de `comProntidao` dispara, a response é indistinguível do
  caso "não há lotes".
- **Recomendação consolidada**: `testability-3` + `fault-tolerance-4` como 1 PR.

### CC-5: Contrato BE↔FE duplicado + helpers copiados
- **Aparece em**: Modifiability (Integrability latente)
- **Findings**: F-modifiability-3 (`lib/sispag.ts`), F-modifiability-4 (`chaveDe`)
- **Diagnóstico unificado**: duas duplicações distintas com a mesma origem — o módulo SISPAG
  cresceu antes de haver camada compartilhada.
- **Recomendação consolidada**: `modifiability-4` (S) antes; `modifiability-3` (M) precisa de
  decisão arquitetural (workspace vs. codegen).

## 4. Quick wins (≤5 dias úteis)

Cards S e severidade ≥ P2 — razão impacto/esforço alta.

| Card | QA | Esforço | Severidade | Resultado esperado |
|---|---|---|---|---|
| `modifiability-4` | Modifiability | S | P2 | 11 cópias de `chaveDe`/`chaveItem` → 1 (`domain/core/chaveTitulo.ts`); mudança de formato do titCod = patch de 1 arquivo |
| `modifiability-5` | Modifiability | S | P2 | `LeitorTitulosAoVivo` injetável; paralelismo ou endpoint-em-lote futuro = PR de 1 arquivo |
| `fault-tolerance-3` | Fault Tolerance | S | P2 | Botão "Parar" + `AbortSignal` em `finalizarEmSequencia` |
| `testability-1` (reajustado) | Testability | S | P2 | 1 caso novo cobrindo falha Conexos num item + bloqueio por status em outro no mesmo lote (ver §7) |
| `testability-3` | Testability | S | P2 | 2 testes de rota garantem `prontidao` em GET /lotes e /lotes/:id |
| `testability-4` | Testability | S | P2 | 2 casos cobrem propagação de `fontesIndisponiveis` em `ProntidaoLoteService` |

## 5. Strategic moves (M / L / XL)

| Card | QA(s) | Esforço | Tactic alvo | Por que vale |
|---|---|---|---|---|
| `finalizar-idempotency` (merged) | FT + Testability | M | Idempotent Replay | 0/1 rotas de escrita financeira no delta aceitam `Idempotency-Key`; precedente existe em 3 rotas |
| `modifiability-1` | Modifiability | M | Split Module | `LotePagamentoService.ts` 956 LOC + aviso Biome 17; alvo ≤ 600 LOC, 0 avisos |
| `modifiability-2` | Modifiability | L | Split Module | `page.tsx` 1 905 LOC + 46 imports; alvo ≤ 400 LOC, ≤ 15 imports |
| `modifiability-3` | Modifiability | M | Abstract Common Services | `lib/sispag.ts` 2 749 LOC espelha o BE; teste de paridade impede drift mas não corta custo marginal |
| `fault-tolerance-2` | FT | M | Timeout | 0/N wrappers de timeout em `lerItensAoVivo`; introduz deadline (15s) + concorrência bounded (5) |
| `testability-5` | Testability | M | Limit Structural Complexity | `LotePagamentoService.test.ts` 1 517 LOC / 95 `it()` sobre 7 áreas; alvo ≤ 700 LOC |

## 6. O que está bem (e por quê)

1. **`ProntidaoLoteResolver` puro, sem I/O** (`ProntidaoLoteResolver.ts:32-39, 139-163`). Tactic
   Bass: Specialized Interfaces. 12 `it()` sobre 11 códigos sem container, sem mocks.
2. **`exigirSituacoesPagaveis` roda ANTES da verificação TED/PIX** (`LotePagamentoService.ts:660-665`).
   Tactic: Compensating Transaction preventiva — não há escrita a desfazer.
3. **CAS `versao+status` fecha a janela de double-execute** (`LotePagamentoService.ts:626-630, 881-920`).
   Tactic: Comparison. Contrapeso ao gap do `Idempotency-Key`.
4. **Fail-closed por item em `lerItensAoVivo`** (`LotePagamentoService.ts:761-786`): Conexos
   indisponível, título sumido ou já pago viram "situação não conferida".
5. **Degradação explícita da listagem**: `comProntidao` captura e devolve lotes "sem prontidão"
   (`ProntidaoLoteService.ts:30-67`), tratados como "não é PRONTO" (`prontidaoLotes.ts:37-42`).
6. **Bulk sequencial com containment** (`prontidaoLotes.ts:102-122`): falha de 1 lote não derruba
   os demais.
7. **`BatchHasBlockedItemsError`** (`BatchHasBlockedItemsError.ts:21-42`): 422, código estável,
   `userMessage` pronto, `itens[]` + `motivo` + `rotulo` por item. Tactic: Encapsulate.
8. **`ETAPAS_AJUSTE_TERMINAIS` reaproveitada em 2 SQLs via constante de módulo**
   (`LotePagamentoRepository.ts`). Tactic: Defer Binding (lookup table).

## 7. Limitações da análise

### Correções de premissa aplicadas na consolidação

1. **F-modifiability-6 — RESOLVIDO**: ontologia `prontidao-lote.md` `related_files` incompleto
   **foi corrigido pelo orquestrador antes do consolidator rodar**; **não gera card**. Status
   registrado no `ontology/_inbox/sispag-situacao-lotes-regis-followups.md`.
2. **F-testability-1 — premissa parcialmente incorreta no agent file, reajustada aqui**:
   `testability.md` §4 afirma "os quatro testes aplicam a MESMA resposta a TODOS os itens".
   Verificação em `LotePagamentoService.test.ts:715-767`: DOIS testes já cobrem mix em
   `avaliarVivos` — `[bloqueada, pronta]` (linha 717) e
   `[{FORA_DA_CARTEIRA}, {pronta+fontesIndisponiveis:['BOLETO']}]` (linha 755). O gap REAL é mais
   estreito: **mix no caminho da leitura Conexos (um item com `getTituloAPagar` resolvendo e outro
   rejeitando) combinado com um bloqueio por status em terceiro item do mesmo lote**. Priorizado
   como **P2 (S)** em vez do P1 original. Card `testability-1` reajustado em wording e esforço
   no KANBAN.md.
3. **Rodada reduzida por desenho — 5 QAs não rodados**: não implica ausência de dívida nesses
   eixos. Métricas que normalmente viriam deles e não vêm:
   - Latência real de `finalizarLote` em produção — não medido; recomendação: instrumentar
     `duracaoMs`+`itens` quando `fault-tolerance-2` for feito.
   - p50/p99 do `fin064` e taxa de 503 do Conexos — requer CloudWatch ou staging.
   - Coverage por diretório — bloqueado pelo `--quick`; recomenda-se `coverageThreshold` nos
     arquivos do delta no `jest.config.*` (piso 90% linhas, 80% branches).
   - Tempo de deploy via Render hook — não medido.
   - Risco de AuthZ/AuthN sobre `SISPAG_EXECUTAR` em multi-tenant — não medido; delta reusa
     permissão existente.
4. **O que o pipe NÃO cobre nunca**: chaos engineering, threat modeling formal, custo cloud, UX,
   acessibilidade.
5. **Janela temporal**: snapshot 2026-10-22 do delta `origin/main..HEAD`. Refazer trimestralmente
   ou quando um PR tocar os artefatos dos QAs não rodados.

## 8. Ações recomendadas (30 dias)

1. **Rodar os 6 quick wins (§4)**: `modifiability-4` (1d), `testability-3` + `testability-4` (1d),
   `testability-1` reajustado (1d), `fault-tolerance-3` (1d). ~5 cards em 1 semana. Tira ruído
   de catálogo e observabilidade.
2. **Fechar CC-1 (idempotência do finalize)**: card merged `finalizar-idempotency` (M). PR
   dedicado com teste de rota + teste client-side + tabela de dedupe. Resolve R-1.
3. **Antes da próxima fatia que acrescentar guarda ao `finalizarLote`**: `modifiability-1` + 
   `testability-5`. Resolve R-2.
4. **Em paralelo com o estratégico**: `modifiability-5` + `fault-tolerance-2` como PR único.
   Resolve R-4.
5. **Quando entrar 5ª aba/filtro no SISPAG**: `modifiability-2`. Resolve R-3.

