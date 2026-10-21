---
type: regis-review-report
run_id: 2026-10-21-1458-sispag-situacao-pagamento
generated_at: 2026-10-21T19:10:00-03:00
audience: technical (architects + senior devs + tech lead)
scope: reduced — 3 of 8 QAs (testability, modifiability, fault-tolerance) por decisão do pipe; os outros 5 QAs (availability, deployability, integrability, performance, security) NÃO foram executados neste PR por escolha de escopo, não por ausência de dados
basis: Bass & Clements — Software Architecture in Practice
pr: 128
feature: sispag-situacao-pagamento (ADR-0075)
head_sha: 737d010
total_cards: 20
total_p0: 0
total_p1: 4
total_p2: 11
total_p3: 5
overall_score: 8.0
---

# Regis-Review — financeiro — 2026-10-21-1458-sispag-situacao-pagamento

## 0. Escopo desta rodada

**Review reduzido por desenho.** O pipeline `/feature-tweak` executou 3 dos 8 QAs do Bass neste PR, por decisão de escopo (feature focada em regra de domínio + aba nova de UI, sem toque em infra, auth, remessa ou retorno). Os cinco QAs **não executados**:

- `availability` — não rodado (nenhuma mudança de disponibilidade/SLA; a feature não altera job de ingestão nem endpoint monetário).
- `deployability` — não rodado (sem mudança de pipeline, Render hook, Terraform ou SSM).
- `integrability` — não rodado (nenhum contrato novo com o Conexos; `com298/list` já existia; o espelhamento FE↔BE é coberto no eixo Modifiability).
- `performance` — não rodado (sem endpoint de alta carga; `/sispag/painel` já tinha benchmark em PRs anteriores).
- `security` — não rodado (nenhuma mudança em AuthZ/AuthN, apenas uso da permissão `SISPAG_EXECUTAR` já existente).

**Isto NÃO é lacuna de medição** — é escolha explícita do que vale rodar neste delta. Os cinco não rodados devem voltar à mesa quando um PR tocar os artefatos correspondentes.

Pesos aplicados sobre os 3 QAs rodados (perfil financeiro multi-tenant): Fault Tolerance 1.3 · Modifiability 1.2 · Testability 1.0 (total 3.5).

## 1. Executive scorecard

| QA | Score (0–10) | P0 | P1 | P2 | P3 | Top finding |
|---|---|---|---|---|---|---|
| Testability | 8.0 | 0 | 2 | 3 | 1 | F-testability-1: `validate-situacao-pagamento-v1.ts` aplica migrations em qualquer banco que a conexão apontar — já aconteceu em PRD em 20/10/2026 |
| Modifiability | 8.0 | 0 | 0 | 4 | 3 | F-modifiability-1: rótulo de motivo diverge entre BE (`PERFIL[m].rotulo`) e FE (`ROTULO_MOTIVO[m]`) sem teste de paridade (3/9 pares) |
| Fault Tolerance | 8.0 | 0 | 2 | 4 | 1 | F-fault-tolerance-1: `exigirSituacaoPagavel` curto-circuita quando o título está fora da carteira persistida (1.277 títulos nesse estado em PRD) |
| **Overall (ponderado)** | **8.0** | **0** | **4** | **11** | **5** | — |

Score interpretation:
- 0–3: risco estrutural — bloqueia escalonamento
- 4–6: dívida defensável — endereçar nesta janela de planejamento
- 7–8: saudável com oportunidades pontuais
- 9–10: estado-da-arte para o estágio atual

**Leitura:** o PR está firme em todas as três dimensões medidas. Nenhum achado P0; nenhum caminho onde um título BLOQUEADO possa ser pago sem passar por um guarda vivo adicional (remessa, finalização, I3 na inclusão). O que resta é higiene de observabilidade, uma linha de defesa fail-closed a mais, e dívidas de escala no `LotePagamentoService` já herdadas de PRs anteriores.

## 2. Top 5 risks (cross-QA — reduzido ao escopo rodado)

Ordenados por severidade × leverage × business impact.

### R-1: Inclusão manual escapa das regras ADR-0075 quando o título está fora da carteira persistida
- **QA(s) afetados**: Fault Tolerance, Testability
- **Findings de origem**: F-fault-tolerance-1 (`LotePagamentoService.ts:332-348`), F-testability-3 (`SituacaoPagamentoService.ts:171-194`)
- **Evidência sintetizada**: `avaliarVivo` devolve `null` quando `lerPersistido(chave)` não encontra o título; em `exigirSituacaoPagavel`, `situacao?.estado === BLOQUEADO` com `situacao` nulo é falso — então segue. Baseline em PRD (20/10/2026): 1.277 títulos ativos sem `tpd_cod` (= populados sem o enriquecimento ADR-0075). O caminho `null` é silencioso (sem log, sem métrica).
- **Verificação do orquestrador**: F-fault-tolerance-1 foi re-checada em código. `LotePagamentoService.ts:332-348` confirma `avaliarVivo` null ⇒ sem bloqueio. **Afeta apenas títulos ausentes da carteira persistida, foi escolha documentada, e não é regressão versus `main`** — a `main` também não bloqueava permuta nem forma-não-SISPAG na inclusão manual. Mantida como P1 porque: (a) a feature ADR-0075 vendeu "regra única" e o caminho de inclusão deixa a regra escapar numa população mensurável; (b) resolver é esforço S (opção A, recusa fail-closed) ou M (opção B, construir contexto on-the-fly).
- **Impacto técnico**: `TIPO_PERMUTA`, `FORMA_NAO_SISPAG`, `VENCIDO`, `BOLETO_SEM_DDA`, `AJUSTE_CENTAVOS_PENDENTE`, `CONFIRMACAO_A_REVISAR` deixam de barrar inclusões para a população fora da carteira. Guardas vivos remanescentes = `getTituloAPagar` (pago/liberado/existe) + `BloqueioDuplicidadeRepository.findAtivo`. Permuta e forma não cobertas no vivo.
- **Impacto de negócio**: analista inclui à mão um `(PERMUTA)` ou `CHEQUE`/`CAIXA`, só descobre no desenho da remessa ou (pior) depois do pagamento, falando com a frente de permutas. Não é double-pay; é regra de domínio contornável pelo caminho secundário.
- **Card(s) Kanban**: `fault-tolerance-1`, `testability-3`
- **Custo de inação em 6 meses**: estimativa ~2–4 incidentes de "título pagado por fora da regra" até alguém pedir reconciliação ad-hoc. Pressupõe inclusão manual acontecer na média histórica.

### R-2: Fonte de contexto indisponível silencia motivos no caminho de escrita
- **QA(s) afetados**: Fault Tolerance, Testability
- **Findings de origem**: F-fault-tolerance-2 (`SituacaoPagamentoService.ts:66-82`), F-testability-3
- **Evidência sintetizada**: `this.ler(fonte, …)` captura exceções, popula `fontesIndisponiveis` e devolve `undefined` para a leitura. O painel vê isso. `criarLotesPorFilial`/`incluirTitulo` passam pela mesma avaliação, mas **`CriarLotesPorFilialResult` não carrega `fontesIndisponiveis`** — o chamador não sabe que operou em contexto degradado.
- **Impacto técnico**: janela instável de `boleto.situacaoPorTitulo` deixa `BOLETO_SEM_DDA` sem aplicar; o `BoletoSemCodigoBarrasError` da remessa (ADR-0071/ADR-0063) ainda cobre o pagamento duplicado, mas o lote inteiro aparece verde para a analista aprovar.
- **Impacto de negócio**: analista aprova lote em cima de contexto que ela não sabe estar degradado. Trilha pós-fato não distingue "fonte caiu" de "título era PRONTO mesmo".
- **Card(s) Kanban**: `fault-tolerance-2`
- **Custo de inação em 6 meses**: baixo em frequência (fontes locais são Postgres), alto em credibilidade quando acontecer o primeiro caso.

### R-3: `validate-situacao-pagamento-v1.ts` roda migrations em qualquer banco apontado — já executou `0089` em PRD por engano
- **QA(s) afetados**: Testability (Sandbox), Fault Tolerance (reconciliação prometida), e implicitamente Deployability (não rodado neste review)
- **Findings de origem**: F-testability-1 (`src/backend/jobs/validate-situacao-pagamento-v1.ts:9-27`), F-fault-tolerance-6
- **Evidência sintetizada**: o próprio header do arquivo documenta: *"Contra o banco de produção isso roda a 0089 antes do deploy (foi o que aconteceu em 20/10/2026)"*. `grep -c "NODE_ENV\|allow-migrations" src/backend/jobs/validate-situacao-pagamento-v1.ts = 0`. Zero teste automatizado do próprio job. O precedente concreto do repositório é a `0061` (23/09/2026), que **esvaziou abas de pagamento em produção** — a 0089 teve sorte de ser aditiva.
- **Impacto técnico**: próxima migration não-idempotente (DROP, ALTER com default, UPDATE de backfill) repete o incidente.
- **Impacto de negócio**: janela mensurável de SISPAG sem lotes montados até reversão manual.
- **Card(s) Kanban**: `testability-1`
- **Custo de inação em 6 meses**: assumindo 1 migration não-idempotente a cada 2–3 PRs grandes, risco mensurável de 1 incidente de disponibilidade de SISPAG.

### R-4: `com298/list` sem fixture gravado — schema de tipo nunca exercido contra bytes reais do Conexos
- **QA(s) afetados**: Testability (Recordable Test Cases), implicitamente Integrability (não rodado)
- **Findings de origem**: F-testability-2 (`ConexosSispagClient.ts:1004-1041`, `__fixtures__/` só tem `fin015/vinculo-codbar`)
- **Evidência sintetizada**: 4 testes 100% mockados; `tipoDocumentoRowSchema` (campos `tpdCod`, `tpdDesNome`) nunca exercido contra resposta real do Conexos. `safeParse` descarta silenciosamente linhas que não baterem o schema (`if (!parsed.success) continue;`). Em PRD, 1.277/1.277 títulos com `tpd_cod` nulo — o leitor **ainda não rodou com dado real**.
- **Impacto técnico**: a primeira renomeação de campo no ERP faz `TIPO_PERMUTA` virar `0 bloqueios` sem sinal. É exatamente o modo de falha "silêncio" que a regra I19l diz combater.
- **Impacto de negócio**: `TIPO_PERMUTA` é a **única** barreira automatizada contra pagar duas vezes um PROFORMA já abatido no `fin010`. O `fin064` não traz tipo (`ADR-0075 §Evidência`). Silêncio = volta ao mundo pré-ADR-0075.
- **Card(s) Kanban**: `testability-2`
- **Custo de inação em 6 meses**: baixo até o Conexos atualizar o endpoint. Alto no dia do update: zero alarme, zero bloqueio em permuta.

### R-5: `POST /sispag/lotes/por-filial` sem `Idempotency-Key` — replay com `mover: true` cria lotes novos cancelando os anteriores
- **QA(s) afetados**: Fault Tolerance (Idempotent Replay), implicitamente Availability/Performance (não rodados)
- **Findings de origem**: F-fault-tolerance-3 (`routes/sispag.ts:272-289`)
- **Evidência sintetizada**: outros 3 endpoints que criam agregado monetário já aceitam `Idempotency-Key` (remessa, retorno, ingestão — `routes/sispag.ts:1192, 1404, 1564`). O endpoint novo é o único fora do padrão. FE desabilita botão enquanto `criando=true`, cobre duplo-clique **mas não retry por timeout**.
- **Impacto técnico**: sob `mover: true`, replay cancela os lotes da primeira tentativa e cria IDs novos. Não é double-execution financeiro (SISPAG continua RASCUNHO); é não-idempotência observável na trilha.
- **Impacto de negócio**: analista comunica "lote #142" por chat/print, dá refresh, aparece "#143". Toda referência operacional órfã.
- **Card(s) Kanban**: `fault-tolerance-3`
- **Custo de inação em 6 meses**: dívida pequena e cumulativa; dor aparece em cliente com proxy corporativo instável.

## 3. Cross-cutting findings

### CC-1: Observabilidade do caminho degradado é toda silenciosa
- **Aparece em**: Testability, Fault Tolerance
- **Findings**: F-testability-3 (`avaliarVivo` null sem log), F-fault-tolerance-2 (`fontesIndisponiveis` não propaga para `CriarLotesPorFilialResult`), F-fault-tolerance-4 (`cancelarSeVazio(...).catch(() => false)` engole erro), F-fault-tolerance-5 (sem auditoria agregada de `criarLotesPorFilial`), F-fault-tolerance-7 (um só `FLOW_ERROR` no painel para falha de infra e bug)
- **Diagnóstico unificado**: a feature acerta nos guardas (fail-closed na remessa, transação única no `mover`, advisory lock por título). Mas os caminhos "degradado mas segue" são todos invisíveis: título fora da carteira ⇒ `null` sem log; fonte caiu ⇒ `undefined` sem campo no retorno; `cancelarSeVazio` falhou ⇒ `.catch(() => false)` sem WARN. A camada de defesa funciona, mas a camada de **detectar que estamos operando em modo degradado** não.
- **Recomendação consolidada**: 1 card de instrumentação (`testability-3` + `fault-tolerance-4` + `fault-tolerance-5` + `fault-tolerance-7` são S cada; podem virar um PR único de observabilidade) + 1 card estrutural (`fault-tolerance-2` — adicionar `fontesIndisponiveis` ao retorno do `criarLotesPorFilial`).

### CC-2: Fail-open implícito na escrita quando a autoridade (carteira persistida / fonte do contexto) falha
- **Aparece em**: Fault Tolerance, Testability
- **Findings**: F-fault-tolerance-1 (`null` persistido ⇒ passa), F-fault-tolerance-2 (fonte caiu ⇒ motivo não aplica)
- **Diagnóstico unificado**: a regra ADR-0075 depende de duas fontes autoritativas por motivo — a carteira persistida (snapshot da última ingestão) + o `fin064` ao vivo. Quando a carteira não tem o título, o código opta por "deixar seguir" (fail-open). Quando uma fonte do contexto cai, o motivo correspondente não aplica (fail-open parcial). Para uma feature cujo propósito é "não descobrir tarde", ambos os defaults deveriam ser fail-closed na escrita (`criarLotesPorFilial`, `incluirTitulo`), ainda que fail-soft no painel.
- **Recomendação consolidada**: ADR complementar (ou extensão da ADR-0075) classificando cada fonte como "crítica" (bloqueia escrita se indisponível) ou "acessória" (apenas aviso). Cards: `fault-tolerance-1`, `fault-tolerance-2`.

### CC-3: Paridade/duplicação BE↔FE em contrato de UI
- **Aparece em**: Modifiability, implicitamente Integrability (não rodado)
- **Findings**: F-modifiability-1 (rótulos de motivo divergem em 3/9 pares), F-modifiability-2 (`HORIZONTE_DIAS` = `JANELA_FORMACAO_DIAS` = 7 em 2 arquivos), F-modifiability-6 (`chaveDe` reimplementado em 5 arquivos)
- **Diagnóstico unificado**: a paridade de **valor** dos enums é testada por reflexão (`src/frontend/lib/sispag.test.ts`), e isso evita um `MOTIVO_PAGAMENTO` novo no BE sem o par no FE. Mas a paridade de **rótulos user-facing** e de **constantes de política** (janela, chave de advisory lock) não tem teste; só o paradigma. Cada ajuste de vocabulário do produto exige coordenar FE+BE em lockstep.
- **Recomendação consolidada**: estender o teste de paridade existente para capturar `PERFIL[m].rotulo` do fonte do resolver + um endpoint `GET /sispag/painel` que já carrega `janelaFormacaoDias` (resolve F-modifiability-2 e F-modifiability-7 juntos). Cards: `modifiability-1`, `modifiability-2`, `modifiability-6`, `modifiability-7`.

### CC-4: Hotspot `LotePagamentoService` encosta no teto operacional
- **Aparece em**: Modifiability (único QA rodado que ataca isso)
- **Findings**: F-modifiability-3 (832 LOC, 11 `@inject`, 13 métodos públicos; +135 LOC/+1 dep neste PR sem refactor compensatório), F-modifiability-5 (`SituacaoPagamentoService` com 8 deps, sem fachada do loader)
- **Diagnóstico unificado**: o PR fez a coisa certa estruturalmente (resolver puro novo, service separado, 4 callers), mas despejou a cola nova no serviço já hotspot. Não é P0 nem P1 — a feature funciona e é testada. É dívida que cobra juros no próximo endpoint SISPAG (lote-por-prioridade, lote-por-credor): o arquivo cruza 1000 LOC e vira risco de regressão.
- **Recomendação consolidada**: planejar o split (`LoteLifecycleService`, `LoteItemService`, `LoteQueryService`) antes do próximo endpoint de lote; `criarLotesPorFilial` vira orquestrador fino. Cards: `modifiability-3`, `modifiability-5`.

## 4. Quick wins (≤5 dias úteis, S + severidade ≥ P2)

| Card | QA | Esforço | Severidade | Resultado esperado |
|---|---|---|---|---|
| `testability-1` | Testability | S | P1 | Guarda de host + flag `--allow-production-migrations` + 2 testes do próprio job. Fecha a porta por onde `0089` entrou em PRD. |
| `testability-2` | Testability | S | P1 | 3 fixtures reais de `com298/list` gravados + teste contra fixture. Primeiro contrato real do leitor de tipo. |
| `fault-tolerance-1` (opção A) | Fault Tolerance | S | P1 | Recusa fail-closed quando título fora da carteira. Fecha o escape das regras ADR-0075 na inclusão manual. |
| `fault-tolerance-2` | Fault Tolerance | S | P1 | `fontesIndisponiveis` no retorno de `criarLotesPorFilial`. Trilha de contexto degradado deixa de ser invisível na escrita. |
| `testability-3` | Testability | S | P2 | 1 WARN + 1 asserção quando `avaliarVivo` cai em `null`. Observabilidade do caminho morto. |
| `testability-4` | Testability | S | P2 | `AjusteCentavosExecucaoRepository.test.ts` com 3 casos. Cobertura isolada do SQL de `listarUltimaEtapaPorTitulo`. |
| `modifiability-1` | Modifiability | S | P2 | Paridade de rótulos BE↔FE testada; 3 pares divergentes caem para 0. |
| `modifiability-2` | Modifiability | S | P2 | Janela de formação vinda do backend em `GET /sispag/painel`; FE para de duplicar `7`. |
| `modifiability-4` | Modifiability | S | P2 | Cabeçalhos de coluna extraídos para array declarativo; `TabelaTitulos.tsx` cai de 427 → ≤ 300 LOC. |
| `fault-tolerance-3` | Fault Tolerance | S | P2 | `Idempotency-Key` honrado em `/sispag/lotes/por-filial`; replay devolve o resultado anterior. |
| `fault-tolerance-4` | Fault Tolerance | S | P2 | `cancelarSeVazio(...).catch(e => warn(...))`; falha de descarte deixa trilha. |
| `fault-tolerance-5` | Fault Tolerance | S | P2 | 1 `BUSINESS_INFO` agregado por chamada de `criarLotesPorFilial`; MTTR de triagem reduz. |

**Defesa em reunião:** 12 cards S com severidade ≥ P2 formam a primeira sprint pós-aprovação (≤ 10 dias úteis se dois devs tocam em paralelo). Resolve 100% dos P1 e 7 dos 11 P2.

## 5. Strategic moves (M / L / XL)

| Card | QA(s) | Esforço | Tactic alvo | Por que vale |
|---|---|---|---|---|
| `testability-5` | Testability | M | Limit Structural Complexity | `TabelaTitulos.tsx` (427 LOC, maior FE do delta) só é exercitado via `TitulosAbaSituacao.test.tsx` (29 casos integrados). Diagnóstico de regressão aponta sempre para o container. Teste focado reduz triagem — mede: 0 casos diretos → ≥ 5. |
| `modifiability-3` | Modifiability | M | Split Module + Increase Semantic Coherence | `LotePagamentoService.ts` em 832 LOC + 11 deps; o PR acrescentou +135 LOC/+1 dep sem compensar. Antes do próximo endpoint de lote (prioridade/credor), split para 3 serviços de 200–350 LOC — métrica dura: maior arquivo cai de 832 → ≤ 400. |
| `modifiability-7` | Modifiability | M | Defer Binding (configuration) | `HORIZONTE_DIAS=7`, `FORMACAO_LOCK_KEY=615243789`, `EFEITO_MOTIVO`, `ORIENTACAO_NO_CONEXOS` hardcoded. Cada ajuste de vocabulário consome um release FE+BE em lockstep. Compor com `modifiability-2` (endpoint `/sispag/recursos`) — a janela sai do código. |
| `fault-tolerance-1` (opção B) | Fault Tolerance | M | Sanity Checking + Increase Competence Set | Em vez de recusar título fora da carteira, construir o contexto ADR-0075 a partir do `fin064` ao vivo + leitura ad-hoc de `com298/list`. Preserva UX (analista não é bloqueada por "ingestão ainda não rodou"); custa a complexidade do fallback. |
| `fault-tolerance-6` | Fault Tolerance | M | Reconcile + Comparison contínua | Promover `validate-situacao-pagamento-v1.ts` a job agendado com alerta quando divergência > 1% da carteira. Tempo de detecção de drift entre carteira local e Conexos: indefinido → ≤ 24h. Vale: o próprio delta já criou o esqueleto da sonda. |

Cada "Por que vale" aqui está amarrado a um número do `_shared-metrics.md` ou da seção §2 do QA correspondente.

## 6. O que está bem (e por quê)

Sete acertos arquiteturais que a mesa precisa reconhecer antes de discutir dívida.

1. **Resolver puro (`SituacaoPagamentoResolver.ts`, 352 LOC) sem I/O e sem relógio.** Tactic: Increase Semantic Coherence + Specialized Interfaces. Recebe `diasAteVencimento` já calculado e `ctx` com fontes. 567 LOC de teste cobrindo 60 casos (`SituacaoPagamentoResolver.test.ts`). Fan-in = 1 (único cliente é o service).
2. **Paridade enum BE↔FE testada por reflexão de fonte.** Tactic: Executable Assertions. `src/frontend/lib/sispag.test.ts:747-772` lê o fonte do backend por `readFileSync`, compara os 7 enums (ESTADO/MOTIVO/SUGESTAO/DONO/ACAO/FONTE/RESULTADO_LOTE_FILIAL), **incluindo ordem**. Dev que adiciona motivo novo no BE sem par no FE quebra CI.
3. **Transação única no `mover` (retira origem + insere destino).** Tactic: Rollback. `LotePagamentoService.ts:446-494`: `retirarDaOrigem` recebe o `tx` do `withTransaction` do `incluirTitulo`. Crash entre remove-e-insert desfaz tudo.
4. **Advisory lock por título (`hash(filCod:docCod:titCod)`) na inclusão/mover.** Tactic: idempotência de nível fraco + anti-double-execute. `LotePagamentoService.ts:440-443, 812-819`. Dois cliques simultâneos no mesmo título serializam.
5. **Fontes de contexto fail-soft com registro.** Tactic: Sanity Checking + Condition Monitoring (parcial — ver R-2). `SituacaoPagamentoService.ler(fonte, …)` captura exceção por fonte, popula `fontesIndisponiveis`, segue com o resto. Painel degrada corretamente; a dívida é propagar isso para a escrita (R-2).
6. **Migration 0089 aditiva e idempotente (`ADD COLUMN IF NOT EXISTS`).** Tactic: Rollback-free deploy. Mesmo com o incidente do `validate-situacao-pagamento-v1.ts` aplicando-a em PRD por engano, foi inócua. A ferramenta foi azar — o conteúdo foi disciplina.
7. **Delta com razão teste:produção excepcional.** `_shared-metrics.md`: 20 arquivos de teste contra ~34 de produção; ~2.586 linhas de teste contra ~7.235 de produção. Backend 280 suítes / 5.255 testes verdes; frontend 112 / 1.228 verdes; CI do PR (Postgres 17) verde no HEAD 737d010.

## 7. Limitações da análise

**Métricas não medidas localmente** (sinalizadas por cada agent):
- Cobertura de linha/branch do delta (nenhum QA rodou `--coverage`; recomendação: 1 passada em `src/backend/domain/service/sispag/SituacaoPagamento*` colando o número ao PR como baseline).
- Taxa de WARN `fonte indisponível` por hora em PRD (depende de CloudWatch ou tail de log do Render).
- Latência p99 do `incluirTitulo` sob carga concorrente com advisory lock (depende de medição em HML/PRD).
- Validação ao vivo do `com298/list` (depende do robô Conexos; conectada ao card `testability-2`).

**QAs intencionalmente não rodados** (reitero da §0): availability, deployability, integrability, performance, security. Devem voltar quando um PR tocar os artefatos correspondentes (job de ingestão, pipeline, endpoint com298 novo, caminho monetário, AuthZ). Este snapshot NÃO afirma que esses eixos estão bem — afirma que não foram medidos.

**O que o pipe NÃO cobre em nenhum review** (independente de quais QAs rodaram): chaos engineering, threat modeling formal, custo cloud, UX, acessibilidade, conformidade LGPD/BC específica.

**Janela temporal**: snapshot de 2026-10-21 no HEAD `737d010`. Refazer trimestralmente ou quando o próximo PR tocar `src/backend/domain/service/sispag/`.

**Correção de premissa documentada**: F-fault-tolerance-1 foi re-checada em código pelo orquestrador (`LotePagamentoService.ts:332-348`: `avaliarVivo` null ⇒ no block). Confirmado que afeta apenas títulos ausentes da carteira persistida, é escolha documentada, e NÃO é regressão versus `main` (main também não bloqueava permuta/forma na inclusão). Prioridade mantida em P1 por leverage (fecha a camada de defesa que a ADR-0075 vendeu) e esforço (S na opção A).

## 8. Ações recomendadas (próximos 30 dias)

1. **Primeira sprint pós-aprovação (≤ 10 dias úteis, 2 devs em paralelo)**: executar os 4 cards P1 (`testability-1`, `testability-2`, `fault-tolerance-1` opção A, `fault-tolerance-2`) + 3 cards P2 de observabilidade (`testability-3`, `fault-tolerance-4`, `fault-tolerance-5`). Fecha o CC-1 (observabilidade do caminho degradado) e o CC-2 (fail-closed na escrita).
2. **Segunda sprint**: 4 cards P2 de higiene de contrato (`modifiability-1`, `modifiability-2`, `modifiability-4`, `fault-tolerance-3`). Fecha o CC-3 (paridade FE↔BE); o `Idempotency-Key` do `/lotes/por-filial` fica alinhado com os outros 3 endpoints SISPAG.
3. **Antes do próximo endpoint SISPAG de lote (prioridade/credor)**: executar `modifiability-3` (split do `LotePagamentoService`). Pré-requisito para a próxima feature não cruzar 1000 LOC no arquivo host.
4. **Dentro de 60 dias**: `fault-tolerance-6` (reconciliação diária carteira × Conexos) + `modifiability-7` (externalizar janela/textos). Resolve dois buracos que são crônicos, não agudos.
5. **Cards P3** (`testability-6`, `modifiability-5`, `modifiability-6`, `modifiability-7`, `fault-tolerance-7`): aceitar o backlog; só puxar quando outro feature-tweak passar pelo arquivo correspondente.


## Errata do orquestrador (2026-10-21)

A baseline "1.277 títulos" citada para `fault-tolerance-1` / R-1 está **mal atribuída**: 1.277 é o número de títulos
da carteira persistida **sem `tpd_cod`** (medição de 20/10), que estão **na** carteira e portanto são avaliados por
`avaliarVivo`. A população exposta ao `null` é outra: títulos que ainda **não** estão na carteira persistida
(criados no Conexos depois da última ingestão). Essa população não foi medida. A prioridade P1 se mantém pelo
leverage e pelo esforço S, não pelo volume.
