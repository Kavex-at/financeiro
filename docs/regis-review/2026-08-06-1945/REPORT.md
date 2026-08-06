---
type: regis-review-report
run_id: 2026-08-06-1945
generated_at: 2026-08-06T20:15:00-03:00
audience: technical (architects + senior devs + tech lead)
basis: Bass & Clements — Software Architecture in Practice (Availability, Deployability, Integrability, Modifiability, Performance, Fault Tolerance, Security, Testability)
scope: gate pós-implementação de `/feature-tweak bordero-vazio-orfao` — delta de 7 arquivos, +229/-3 LOC, I-Write-7 (limpeza de borderô órfão + recusa de aprovação vazia) no fluxo `fin010` de Permutas
total_cards: 23
total_p0: 0
total_p1: 0
total_p2: 13
total_p3: 10
overall_score: 8.1
gate_status: PASS (nenhum P0 emergiu; gate #8 do pipeline atendido → PR liberado)
---

# Regis-Review — financeiro — 2026-08-06-1945

## 0. Enquadramento e status do gate

Este NÃO é um `/regis-review` full — é o **gate pós-implementação** do `/feature-tweak
bordero-vazio-orfao` (`Green Criterion #8` do pipeline). Escopo do delta:

- **7 arquivos, +229/-3 LOC** — 2 services de permuta, 2 test files, 1 componente FE, 1
  business-rule (I-Write-7), 1 update em `ontology/_index.json` + ADR-0030 (untracked).
- **Origem operacional:** borderô 18538 em produção (2026-08-06) — `POST /fin010/finalizar/18538`
  recusado com `"ESTE BORDERÔ NÃO POSSUI ITENS."`.
- **Invariante nova:** I-Write-7 fecha (a) o **produtor** (`ReconciliacaoPermutaService.removerBorderoOrfao`,
  best-effort fail-safe) e (b) o **consumidor** (`BorderoGestaoService.assertBorderoTemItens`,
  fail-closed) do casco vazio, com espelho na UI (`BorderosPanel.tsx`).

**Nenhum agente reportou P0.** Isso é o critério objetivo que libera o PR — o pipeline exige
remediar apenas P0; P1/P2/P3 vão para o inbox `ontology/_inbox/bordero-vazio-orfao-regis-followups.md`.

**Baseline de gates confirmado:**

| Gate | Estado | Observação |
|---|---|---|
| Backend `typecheck` | limpo | exit 0 |
| Backend `lint` | limpo | 35 warnings pré-existentes; **0** introduzidos pelo delta |
| Suites permutas (backend) | 47/47 verde | `ReconciliacaoPermutaService` + `BorderoGestaoService` |
| Backend `npm test` (full) | 1081 pass / 14 fail | **as 14 falhas são pré-existentes** (baseline confirmado com `git stash` no worktree limpo): 4 suites `routes/recebimentos.e2e.*` (Frente IV) por env var `COM297_GCD_NOTA_DEBITO` ausente. **Não são regressão deste delta.** |
| Frontend `typecheck` | limpo | exit 0 |
| Frontend `lint` | 0 errors | 15 warnings pré-existentes em `AuthProvider.tsx` (não tocado) |
| Frontend `npm test` | 141/141 | 23 suites |
| Cobertura per-file no delta | 94,95% stmts / 79,10% branch / 98,07% funcs | acima dos alvos Bass (80/70/80 na service layer) |
| Terraform / `infra/` | **não aplicável** | não existe `infra/` no repo (estado atual = Express/Render/Vercel/Supabase, ver CLAUDE.md §Estado Atual vs. Alvo). Findings de IaC/multi-tenant/CloudWatch são marcados N/A e transferidos para follow-up quando a infra alvo for provisionada. |

## 1. Executive scorecard

**Pesos (financeiro — SaaSo que executa escritas que movem dinheiro no ERP):**
Security 1.5, Fault Tolerance 1.3, Availability 1.2, Modifiability 1.2, Testability 1.0,
Performance 1.0, Integrability 0.9, Deployability 0.9 — total = 9.0.

| QA | Score (0–10) | P0 | P1 | P2 | P3 | Top finding |
|---|---|---|---|---|---|---|
| Availability | 8.0 | 0 | 0 | 2 | 2 | F-availability-1: fail-closed do `assertBorderoTemItens` sem mensagem diferenciada para "ERP down" vs. "borderô vazio" |
| Deployability | 8.0 | 0 | 0 | 3 | 1 | F-deployability-2: `excluirBordero` no ERP é irreversível — rollback de código não desfaz efeito externo (mitigado pelo `borderoCriadoAqui` + fail-safe) |
| Integrability | 8.0 | 0 | 0 | 1 | 3 | F-integrability-3: `ReconciliacaoPermutaService` acopla-se a 8 métodos do `ConexosBaixaClient` (era 6) sem intermediário |
| Modifiability | 8.0 | 0 | 0 | 1 | 2 | F-modifiability-2: método `reconciliar` já em 204 linhas (+13 pelo delta) — hot spot de mudança |
| Performance | 8.0 | 0 | 0 | 2 | 0 | F-performance-1: `finalizarBordero` paga +1 RTT ao Conexos por aprovação (`listBaixas`) sem baseline mensurável |
| Fault Tolerance | 8.0 | 0 | 0 | 3 | 1 | F-fault-tolerance-2 (**reescrita** — ver §7): `listBaixas` filtra rows sem `docCod`/`bxaCodSeq` finitos → resposta 200 malformada pode render `[]` para borderô que TEM baixas, levando à exclusão de borderô legítimo |
| Security | 9.0 | 0 | 0 | 0 | 2 | F-security-1 e F-security-2: **evidência positiva** — `filCod` derivado da trilha (nunca do request), `borderoCriadoAqui` limita blast-radius, catch preserva pattern anti-Cookie/sid |
| Testability | 7.5 | 0 | 0 | 2 | 2 | F-testability-1: guarda `vazio` do `BorderosPanel.tsx` sem teste automatizado (harness FE existe) |
| **Overall** | **8.1** | **0** | **0** | **13** | **10** | — |

**Cálculo:** (9×1.5 + 8×1.3 + 8×1.2 + 8×1.2 + 7.5×1.0 + 8×1.0 + 8×0.9 + 8×0.9) / 9.0 = 73.0/9.0 = **8.11**.

Score interpretation:
- 0–3: structural risk — bloqueia escalonamento
- 4–6: dívida defensável — endereçar nesta janela de planejamento
- 7–8: saudável com oportunidades pontuais
- 9–10: estado-da-arte para o estágio atual

**Leitura do 8.1:** delta bem calibrado. O score reflete um tweak **defensivo** — I-Write-7
adiciona guardas em produtor e consumidor, com fail-safe (`listBaixas>0`), fail-closed (recusa
aprovação vazia) e observabilidade estruturada. As oportunidades identificadas (13 P2 / 10 P3)
são **débito defensável** para próxima janela; nenhuma bloqueia o merge.

## 2. Top 10 risks (cross-QA)

Ranqueados por composição **severidade × leverage × impacto de negócio** — não é lista dos 10 findings piores.

### R-1: Observabilidade agregada do best-effort ausente
- **QA(s) afetados**: Availability, Deployability, Fault Tolerance, Testability
- **Findings de origem**: F-availability-2, F-deployability-2, F-fault-tolerance-1, F-testability-2
- **Evidência sintetizada**: `removerBorderoOrfao` emite `BUSINESS_INFO`/`BUSINESS_WARN`
  estruturados em 3 caminhos (sucesso, ERP-tem-item, catch), mas: (a) 0 alarmes agregam esses
  eventos (repo não tem `infra/`), (b) 0 testes asseveram sobre o log, (c) o `catch` único mistura
  "ERP apagou, cache falhou" com "ERP nem apagou" no mesmo `BUSINESS_WARN` enganoso.
- **Impacto técnico**: se `gravarBaixaPermuta` regredir (novo tipo de erro do ERP, mudança de
  contrato no `fin010`), a taxa de nascimento de cascos sobe sem sinal — o borderô 18538 leva 3
  meses a ser notado, exatamente o padrão que motivou este tweak.
- **Impacto de negócio**: o único sinal de saúde do fluxo I-Write-7 é o painel — bloqueio
  reativo do analista. MTTA para regressão do produtor: dias a semanas.
- **Card(s) Kanban relacionados**: cq-observabilidade-orfao, ft-1, test-2
- **Custo de inação em 6 meses**: alta probabilidade de reintroduzir a bug-classe do 18538
  em produção sem detecção proativa. Premissa: 1 tweak/mês toca `gravarBaixaPermuta` ou o loop
  de reconciliação (baseado no ritmo do repo).

### R-2: Normalização silenciosa do `listBaixas` pode induzir exclusão de borderô legítimo (F-fault-tolerance-2 reescrita)
- **QA(s) afetados**: Fault Tolerance, Integrability
- **Findings de origem**: F-fault-tolerance-2 (variante correta — ver §7), F-integrability-1
- **Evidência sintetizada**: `ConexosBaixaClient.listBaixas` (`src/backend/domain/client/ConexosBaixaClient.ts:169-187`)
  normaliza com `page.rows ?? []` E filtra `Number.isFinite(b.docCod) && Number.isFinite(b.bxaCodSeq)`.
  Uma resposta HTTP 200 com payload malformado (rows sem `bxaCodSeq` finito) faz `listBaixas`
  retornar `[]` para um borderô que TEM baixas — o guard `listBaixas.length === 0` de
  `removerBorderoOrfao` interpreta como "casco vazio" e chama `excluirBordero`.
- **Impacto técnico**: exclusão de borderô com baixa real → divergência ERP↔contábil no `fin010`.
- **Impacto de negócio**: MÉDIO. Probabilidade baixa (requer bug de payload do ERP), mas
  severidade financeira ALTA (baixa efetiva perdida no ERP). O guard `borderoCriadoAqui` reduz o
  blast-radius (só borderô criado NESTA chamada), mas não elimina o risco se a mesma chamada
  criar o borderô + acontecer o payload malformado.
- **Card(s) Kanban relacionados**: ft-2 (reescrita), ft-3, integ-1 (rebaixada P3 — ver §7)
- **Custo de inação em 6 meses**: 1–2 divergências fiscais reconciliáveis (o borderô apagado é
  vazio-por-definição pelo guard, mas o número some do histórico do ERP). Premissa: probabilidade
  de payload malformado ≈ frequência de deploys no ERP.

### R-3: Método `reconciliar` cruzou 200 linhas (204 pós-delta) sem sinalização automática
- **QA(s) afetados**: Modifiability, Testability
- **Findings de origem**: F-modifiability-2, F-testability-4
- **Evidência sintetizada**: `reconciliar` = 204 LoC (era 191), concentrando 6 responsabilidades
  (resolve, auto-alocação, dry-run, loop de 4 sub-branches, tratamento por par, cleanup).
  Biome NÃO sinaliza — a complexidade cognitiva é somada por aninhamento, não por comprimento.
  A suite de teste subiu para 736 LoC pelo mesmo motivo. Alvo Bass: método ≤ 60 LoC.
- **Impacto técnico**: hot spot de mudança do módulo permutas — cada tweak novo (I-Write-6,
  I-Write-7…) empurra o método mais longe do teto de compreensão. Já é o método mais complexo
  do domínio.
- **Impacto de negócio**: cost-multiplier de futuros tweaks; PRs difíceis de revisar aumentam
  probabilidade de regressão silenciosa no fluxo financeiro crítico.
- **Card(s) Kanban relacionados**: mod-2, test-4
- **Custo de inação em 6 meses**: 2 tweaks empurram o método para > 250 LoC; a partir daí,
  qualquer alteração no loop custa 2×. Premissa: 1 tweak/mês toca o loop de reconciliação.

### R-4: 8 operações distintas do `fin010` em `ReconciliacaoPermutaService`, sem intermediário
- **QA(s) afetados**: Integrability, Modifiability
- **Findings de origem**: F-integrability-3
- **Evidência sintetizada**: `ReconciliacaoPermutaService` acopla-se a 8 métodos do
  `ConexosBaixaClient` (era 6 antes do delta) + 1 do `ConexosTitulosClient` = 9 chamadas
  externas ao ERP em um único orquestrador. `BorderoGestaoService` sobrepõe 3 desses métodos —
  o "façade fin010" existe distribuído em 2 serviços.
- **Impacto técnico**: migrar para Conexos v2 (roadmap anunciado sem data firme) exige mexer
  em N serviços simultaneamente. O acoplamento cresce monotonicamente com cada operação nova.
- **Impacto de negócio**: custo de upgrade escala linearmente com nº de operações consumidas.
  Hoje ≈ 11 operações fin010 distintas em `permutas/*`.
- **Card(s) Kanban relacionados**: integ-3
- **Custo de inação em 6 meses**: cada nova ação de borderô (estorno programático, reabertura
  de cancelamento — hoje TODO) adiciona +1 aresta ao acoplamento. Refactor tardio custa 3–5×.

### R-5: Cobertura da guarda `vazio` no `BorderosPanel.tsx` = 0 (UI é a primeira barreira)
- **QA(s) afetados**: Testability, Modifiability, Availability
- **Findings de origem**: F-testability-1, F-modifiability-1
- **Evidência sintetizada**: `!b.baixas.some(x => x.status === 'settled')` desabilita o botão
  "Aprovar" e mostra `title` explicativo. Zero testes no FE cobrem essa guarda; harness
  `@testing-library/react` já existe (`__tests__/permutas-components.test.tsx`).
- **Impacto técnico**: um refactor que troque `settled` por `!== 'error'` (parece equivalente,
  não é — `skipped`/`dry-run` também não são settled) passa por CI. Regressão do 18538
  volta silenciosamente pelo lado UX.
- **Impacto de negócio**: analista descobre que o borderô é casco só ao clicar; retorno da UX
  ruim que motivou o tweak. Custo de suporte mensurável, não fatal.
- **Card(s) Kanban relacionados**: test-1, cq-predicado-vazio
- **Custo de inação em 6 meses**: alta probabilidade de erosão da guarda em algum refactor de
  status/enum. Premissa: 2 tweaks/6m tocam `BorderosPanel` ou o schema de baixa.

### R-6: Latência de aprovação sobe para 2× RTT do Conexos sem baseline mensurável
- **QA(s) afetados**: Performance, Availability, Integrability
- **Findings de origem**: F-performance-1, F-performance-2, F-integrability-4
- **Evidência sintetizada**: `finalizarBordero` agora executa `listBaixas` + `finalizarBordero`
  (era só o segundo). O Conexos é on-prem sobre HTTP; sem instrumentação no
  `ConexosBaseClient` — `grep -n "duration|elapsed|Date.now|performance.now"` = 0 hits. Cada
  aprovação passa a dobrar o número de RTTs.
- **Impacto técnico**: no pior caso pessimista (2s p95 do Conexos), aprovar dobra de 2s → 4s.
  No caso benigno (200ms p95), custo imperceptível. Sem baseline, impossível classificar.
- **Impacto de negócio**: em picos de fechamento mensal (analistas aprovando dezenas de
  borderôs em lote), UX degrada. Sem observabilidade, regressão vira reclamação, não SLI.
- **Card(s) Kanban relacionados**: cq-shortcircuit-assert, perf-2
- **Custo de inação em 6 meses**: risco duplo — (a) UX degrada em picos sem sinal, (b) todo
  card futuro de performance no eixo Conexos fica rebaixado por falta de baseline.

### R-7: Predicado "borderô vazio" em 3 fontes diferentes com 3 shapes
- **QA(s) afetados**: Modifiability, Availability, Integrability
- **Findings de origem**: F-modifiability-1, F-availability-3, F-integrability-2
- **Evidência sintetizada**: produtor usa `!resultados.some(r => r.status === 'settled')`
  (in-memory); consumidor usa `listBaixas().length === 0` (ERP); UI usa
  `!b.baixas.some(x => x.status === 'settled')` (trilha via API). A divergência de **fonte** é
  intencional (documentada no ADR-0030); a divergência do **status alvo** (`'settled'`) é
  cópia-cola. Sem gate automático que force coerência.
- **Impacto técnico**: introduzir um estado novo (`partially-settled`, `reconciling-partial`)
  exige tocar 3 pontos em sincronia. Um deles esquecer → cascos aprovados voltam ou aprovações
  legítimas travam.
- **Impacto de negócio**: mesma bug-classe do 18538, propagada por refactor. Probabilidade
  cresce a cada tweak em status.
- **Card(s) Kanban relacionados**: cq-predicado-vazio, integ-2
- **Custo de inação em 6 meses**: 1 refactor de enum de status = 1 chance de regressão. ADR-0030
  mitiga em ~80%; consolidar em constante remove o risco.

### R-8: Kill-switch nuclear (`CONEXOS_WRITE_ENABLED`) é o único interruptor para a auto-limpeza
- **QA(s) afetados**: Deployability, Fault Tolerance
- **Findings de origem**: F-deployability-3
- **Evidência sintetizada**: `removerBorderoOrfao` está transitivamente coberta pelo gate
  `CONEXOS_WRITE_ENABLED` (verificado: `borderoCriadoAqui` só vira `true` no ramo não-dry-run),
  mas não tem interruptor próprio. Se o comportamento se mostrar defeituoso, o único
  mitigante granular é `CONEXOS_WRITE_ENABLED=false` — que também para as baixas legítimas.
- **Impacto técnico**: time-to-mitigate para bug isolado na auto-limpeza é ~15 min (revert +
  redeploy) em vez de segundos (toggle).
- **Impacto de negócio**: assimetria com o pattern existente (`CONEXOS_WRITE_ENABLED`). Um
  incidente hipotético segura toda a Frente I até revert. Volume esperado baixo.
- **Card(s) Kanban relacionados**: deploy-3
- **Custo de inação em 6 meses**: probabilidade baixa, severidade contida. Vale como polimento
  para o próximo release. Premissa: 6 testes verdes + fail-safe robusto.

### R-9: Ordem `ERP → cache` na compensação com log enganoso em falha parcial
- **QA(s) afetados**: Fault Tolerance
- **Findings de origem**: F-fault-tolerance-1
- **Evidência sintetizada**: `removerBorderoOrfao` faz `excluirBordero` (ERP) →
  `deleteBorderoCache` (local) dentro do MESMO `try`. Se o ERP sucede e o cache falha, o catch
  loga `BUSINESS_WARN` "remover pelo painel" — mensagem incorreta (o borderô já não existe no
  ERP). Auto-recuperável no próximo `refreshCache`, mas cria janela confusa.
- **Impacto técnico**: analista tenta ação impossível (excluir algo que já sumiu); log mente
  para dashboard futuro (se instrumentado).
- **Impacto de negócio**: baixo — polui operação, não perde dinheiro. Consumidor
  (`assertBorderoTemItens`) cobre a aprovação inválida.
- **Card(s) Kanban relacionados**: ft-1
- **Custo de inação em 6 meses**: incidentes esporádicos de "borderô sumido no cache". Sem
  urgência, mas resolve com 1 dia de trabalho.

### R-10: Deploy não-atômico FE↔BE numa mudança que exige as duas guardas
- **QA(s) afetados**: Deployability
- **Findings de origem**: F-deployability-1
- **Evidência sintetizada**: Render (BE) e Vercel (FE) são deploy hooks independentes. A janela
  intermediária é **segura nos dois sentidos** (análise A vs. B na seção 4 do
  `deployability.md`), mas o lockstep de versão (`scripts/bump-version.ps1`) correlaciona apenas
  a versão, não a atomicidade física.
- **Impacto técnico**: nas duas ordens a degradação é segura (nunca corrompe dado, no pior caso
  volta à mensagem crua do ERP). Não há caminho que produza estado inconsistente entre FE e BE.
- **Impacto de negócio**: analista percebe brevemente mensagem crua ao clicar "Aprovar" na
  janela pré-deploy total. Sem perda financeira.
- **Card(s) Kanban relacionados**: deploy-1
- **Custo de inação em 6 meses**: próxima guarda dupla FE↔BE pode escolher uma direção onde a
  ordem intermediária é regressiva, sem que o revisor perceba. Documentação preventiva.

## 3. Cross-cutting findings

### CC-1: Observabilidade do best-effort — 3 sinais estruturados sem alarme, sem teste, sem split
- **Aparece em**: Availability, Deployability, Fault Tolerance, Testability
- **Findings**: F-availability-2 (alarme), F-deployability-2 (alerta), F-fault-tolerance-1
  (log enganoso), F-testability-2 (asserção sobre log)
- **Diagnóstico unificado**: o `removerBorderoOrfao` é best-effort com 3 caminhos observáveis
  (sucesso, ERP-tem-item, catch). Nenhum é: (a) alarmado em produção (`infra/` inexistente),
  (b) diferenciado por passo (o `try` cobre ERP+cache no mesmo catch), (c) assevered em teste
  (0 hits em `logService.warn`/`info` no bloco I-Write-7). O sinal existe no código; falta
  fechá-lo em observabilidade, teste e granularidade de catch.
- **Recomendação consolidada**: 1 card core (cq-observabilidade-orfao) + 2 cards dependentes
  (ft-1 = split do catch, test-2 = asserção sobre log). O card core cria os contadores
  estruturados e prepara para o alerta CloudWatch/Sentry quando `infra/` chegar.

### CC-2: Predicado "borderô vazio" espalhado em 3 fontes, 3 shapes, 1 semântica
- **Aparece em**: Modifiability, Availability, Integrability
- **Findings**: F-modifiability-1 (const compartilhada), F-availability-3 (flag `podeAprovar`
  no serviço), F-integrability-2 (cross-ref em `ontology/integrations/conexos.md`)
- **Diagnóstico unificado**: as **fontes** divergem intencionalmente (ADR-0030 explica por quê);
  o **status alvo** (`'settled'`) é literal cópia-colada. Front-back podem dessincronizar em
  refactor. `conexos.md` documenta o endpoint mas não sinaliza que a semântica "array vazio =
  borderô vazio" virou carga arquitetural.
- **Recomendação consolidada**: 1 card (cq-predicado-vazio) que (a) extrai
  `BAIXA_STATUS_CONFIRMADO = 'settled' as const` em `src/shared/types/permuta.ts`, (b) expõe
  `podeAprovar: boolean` no `BorderoGestaoService.listarBorderos` para o FE consumir, (c)
  atualiza `conexos.md` cross-referenciando I-Write-7.

### CC-3: Custo síncrono de +1 RTT ao Conexos por aprovação, sem baseline mensurável
- **Aparece em**: Performance, Integrability, Availability
- **Findings**: F-performance-1 (RTT extra), F-performance-2 (sem instrumentação),
  F-integrability-4 (short-circuit possível), F-availability-1 (mensagem indiferenciada)
- **Diagnóstico unificado**: `assertBorderoTemItens` sempre chama `listBaixas`, mesmo quando a
  trilha local já tem ≥1 baixa `settled` para o `bor_cod` — que é o caminho feliz da esmagadora
  maioria. O motivo do read-through é evitar contar linhas `error` com `bor_cod` como "item",
  mas `error` NUNCA é `settled` — basta contar `settled` na trilha. Sem baseline de latência
  do Conexos, o custo é invisível.
- **Recomendação consolidada**: 2 cards paralelos (cq-shortcircuit-assert + perf-2). O
  short-circuit reduz o custo de 2 → 1 RTT no caminho feliz; a instrumentação torna a decisão
  falseável e prepara qualquer otimização futura no eixo Conexos.

### CC-4: Fail-closed do `assertBorderoTemItens` sem observabilidade nem teste específico
- **Aparece em**: Availability, Fault Tolerance, Testability
- **Findings**: F-availability-1 (mensagem indiferenciada), F-fault-tolerance-2 reescrita
  (payload malformado), F-testability-3 (política em teste)
- **Diagnóstico unificado**: a decisão de fail-closed é correta (evita aprovar borderô fantasma
  como o 18538), mas não está: (a) documentada como política no JSDoc, (b) diferenciada em
  mensagem ao analista (ERP down vs. borderô vazio geram a mesma UX), (c) coberta por teste
  ("`listBaixas` lança → aprovação recusa"). Além disso, o filtro silencioso do
  `ConexosBaixaClient.listBaixas` (rows sem `docCod`/`bxaCodSeq` finitos) transforma resposta
  malformada em `[]` — cenário raro mas com blast-radius alto.
- **Recomendação consolidada**: 3 cards (avail-1 + ft-2 + test-3). Diferenciar mensagem + logar
  contador + assertar política em teste + adicionar log de truncamento no
  `ConexosBaixaClient.listBaixas` quando `rows.length === pageSize` OU quando
  `rows.length > result.length` (rows filtradas por sanity).

## 4. Quick wins (≤5 dias úteis)

Cards com esforço S e severidade ≥ P2, com alta razão impacto/esforço. Estes são os cards
para defender em reunião como "aceitamos como primeira sprint pós-aprovação":

| Card | QA | Esforço | Severidade | Resultado esperado |
|---|---|---|---|---|
| cq-observabilidade-orfao | Availability + Deployability + Fault Tolerance | S | P2 | 2 contadores estruturados (`permuta.bordero_orfao.removido`, `permuta.bordero_orfao.limpeza_falhou`), 1 dashboard de saúde, MTTA de regressão silenciosa cai de "dias" para "<1 dia útil" |
| test-2 | Testability | S | P2 | Asserções de `logService.warn`/`info` em 3 caminhos best-effort (0 → 3); dashboard de observabilidade deixa de mentir silenciosamente |
| avail-1 | Availability | S | P2 | Mensagem diferenciada no `finalizarBordero`: "ERP indisponível" vs. "borderô vazio — use Excluir"; contador estruturado no `LogService` |
| ft-1 | Fault Tolerance | S | P2 | Split do catch em `removerBorderoOrfao` (ERP vs. cache); teste do cenário "ERP OK + cache falhou" (0 → 1) |
| ft-2 (reescrita) | Fault Tolerance | S | P2 | Log de sanity no `ConexosBaixaClient.listBaixas` quando `rows.length > filteredRows.length` (payload malformado é sinalizado antes de virar exclusão errônea) |
| ft-3 | Fault Tolerance | S | P2 | Teste do 2º nível de defesa: `listBaixas → []` E `excluirBordero → reject` → catch logs `BUSINESS_WARN` (0 → 1); trip-wire para mudança contratual no ERP |
| deploy-1 | Deployability | S | P2 | Seção "Ordem de deploy" no ADR-0030 documenta análise A/B; template para próximas guardas duplas FE↔BE |
| deploy-3 | Deployability | S | P2 | Kill-switch `CONEXOS_AUTO_CLEANUP_ORFAO_ENABLED` (default `true`); time-to-mitigate ~15 min → <1 min |
| cq-shortcircuit-assert | Performance + Integrability | S | P2 | RTTs ao Conexos por aprovação no caminho feliz: 2 → 1; latência p50 do `assertBorderoTemItens` cai de 1× RTT ERP para ~1 ms |
| perf-2 | Performance | S | P2 | Instrumentação `{ endpoint, duration_ms, status, attempts }` no `ConexosBaseClient`; baseline p50/p95 disponível em ≤ 1 semana; qualquer card futuro de latência vira falseável |
| test-1 | Testability | S | P2 | 2 fixtures em `borderos-panel.test.tsx` cobrindo botão "Aprovar" habilitado/desabilitado; regressão do 18538 na UX defendida por CI |

**Total quick wins: 11 cards.** Todos S (≤1 dia). Executáveis em 1 sprint de 5 dias por 2 devs.

## 5. Strategic moves (M / L / XL)

Cards de maior fôlego. Cada linha de "Por que vale" está ancorada em um número:

| Card | QA(s) | Esforço | Tactic alvo | Por que vale |
|---|---|---|---|---|
| mod-2 | Modifiability + Testability | M (2–5d) | Split Module / Refactor | Método `reconciliar` está em 204 LoC (delta +13); Bass alvo ≤ 60. Split para `baixarAlocacoesDoBordero` reduz para ≤ 80. Sem refactor, próximo tweak empurra para > 250, ponto onde qualquer PR passa a ser difícil de revisar. Já é o método mais complexo do domínio permutas. |
| integ-3 | Integrability + Modifiability | M (2–5d) | Use an Intermediary | `ReconciliacaoPermutaService` acopla-se a **8** métodos do `ConexosBaixaClient` (era 6, +2 no delta). Extrair `Fin010BorderoFacade` reduz custo de migração para Conexos v2 (roadmap sem data firme) de "mexer em 2 serviços + toda a superfície do client" para "mexer no facade". Blast-radius de troca de provider: 11 chamadas diretas → 0. |
| test-4 | Testability | M (2–3d) | Limit Structural Complexity | `ReconciliacaoPermutaService.test.ts` = 736 LoC (delta +86); Bass alerta em >500. Segmentar por invariante (I-Write-N por arquivo) mantém a suite navegável. Sem isso, +50 a +100 LoC por tweak; em 2 tweaks passa dos 900 e leitura por invariante começa a doer. |

**Total strategic: 3 cards M.** Executáveis em janela de 2 sprints, com trade-off explícito
de estabilidade (mexer em código quente).

## 6. O que está bem (e por quê)

Reuniões defensivas caem na armadilha de "tudo está ruim". Este delta acerta em pontos
concretos que devem ancorar a credibilidade do resto do relatório:

1. **Compensating Transaction (Bass — Fault Tolerance)**: `removerBorderoOrfao` é rollback
   compensatório do passo 1 do handshake, com fail-safe explícito (`listBaixas > 0` bloqueia
   exclusão). Testado em 4 caminhos verdes.
2. **Sanity Checking + Exception Prevention (Bass — Fault Tolerance)**: `assertBorderoTemItens`
   recusa aprovação vazia ANTES do POST no ERP — impede o `Generic.ERROR_MESSAGE` que motivou
   o tweak. Fonte da verdade = ERP, não trilha (documentado em ADR-0030 §"Por que a contagem
   vem do ERP").
3. **Limit Exposure (Bass — Security)**: `filCod` de `assertBorderoTemItens` vem de
   `requireOwnBorderoFilCod` (trilha), NUNCA do request. Um admin com JWT comprometido que
   POSTe `borCod=99999` recebe 403 antes que qualquer `listBaixas` seja executado no ERP —
   sem oráculo de existência.
4. **Encrypt Data / Audit Trail (Bass — Security)**: catch de `removerBorderoOrfao` loga
   `err.message` (não `err` cru), preservando o pattern anti-Cookie/sid documentado em
   `routes/permutas.ts:98`.
5. **Increase Resource Efficiency (Bass — Performance)**: `removerBorderoOrfao` é gated por
   `borderoCriadoAqui && !resultados.some(isBaixaConfirmada)` — **0 RTT extra no caminho feliz**.
6. **Rastreabilidade documental**: ADR-0030 + I-Write-7 em `fin010-write-contract.md` explicam
   por quê, alternativas descartadas e escopo deliberadamente fora ("órfãos existentes não são
   varridos"). Score de Modifiability sobe por isso — quem herdar sabe *por que* está do jeito
   que está.
7. **Cobertura per-file forte**: 94,95% stmts / 79,10% branch / 98,07% funcs nos 2 arquivos
   backend — acima dos alvos Bass (80/70/80) com folga.
8. **Determinismo dos 6 testes novos**: mocks isolados por `buildDeps()`, sem `beforeAll`
   global, sem `Date.now()`/`setTimeout`/`Math.random`. `mockRejectedValueOnce()` é ordenado
   por chamada, não por tempo. Sem risco de flake.

## 7. Limitações da análise

### Correções aplicadas a findings dos agents

Duas correções foram aplicadas na consolidação — verificadas manualmente no código, os agents
erraram:

**F-fault-tolerance-2 — reescrita:**
- **O agent afirmou (incorretamente)**: falha de I/O do `listBaixas` chega ao analista como
  "não possui baixas — use Excluir".
- **Realidade verificada no código**: `ConexosBaixaClient.listBaixas`
  (`src/backend/domain/client/ConexosBaixaClient.ts:155-191`) envelopa a chamada em `try/catch`
  e **lança** `ConexosError` — nunca retorna `[]` em erro. A exceção propaga por
  `assertBorderoTemItens` e é interpretada como erro do ERP por `respondActionError`.
- **Variante REAL usada no card ft-2**: `listBaixas` normaliza com `page.rows ?? []` (linha 170)
  e depois filtra `rows.filter(b => Number.isFinite(b.docCod) && Number.isFinite(b.bxaCodSeq))`
  (linha 186). Uma resposta HTTP 200 com payload malformado (rows sem `bxaCodSeq` finito) pode
  render `[]` para um borderô que TEM baixas — o guard interpreta como "casco vazio". Mantida
  em P2.

**F-integrability-1 — rebaixada para P3 e reformulada:**
- **O agent afirmou (P2)**: `listBaixas` ler só a página 1 (`pageSize:200`) torna o guard
  falso-positivo.
- **Realidade**: para uma checagem de VAZIO isso não se sustenta — se o borderô tem qualquer
  baixa, ela está na página 1; a página 1 não fica vazia enquanto páginas seguintes têm linhas.
  O cenário exigiria bug do ERP retornando página 1 vazia + `hasMore: true`, hipotético.
- **Reformulação (P3)**: documentar o teto de 200 em I-Write-7 e no JSDoc do `listBaixas` (não
  como risco de correção, mas como boundary conhecido). Também recomendar log de sanity quando
  `rows.length === pageSize` (indício de truncamento futuro se o volume crescer).

### Não medível localmente pelos agents

- MTTR real de indisponibilidade do ERP no `finalizarBordero` (requer produção).
- Latência p50/p95 de `listBaixas` / `finalizarBordero` (0 hits para `duration|elapsed|Date.now`
  no `ConexosBaseClient.ts`).
- Taxa de nascimento de cascos em produção (só temos 1 ocorrência conhecida: 18538).
- P95 de `baixas.length` por borderô de permuta (requer query no cache `permuta_bordero`).
- `npm audit` — não coletado no modo `--quick`.

### Não coberto pelo pipe

- Chaos engineering (queda coordenada de ERP + backend cache).
- Threat modeling formal (STRIDE) — este delta é pequeno, avaliação foi feita pontualmente.
- Custo de cloud (não aplicável — Render/Vercel/Supabase, sem `infra/`).
- UX real (não temos usabilidade quantitativa; a análise assume que o analista consegue ler
  o `title` do botão desabilitado).
- Acessibilidade da UI.

### Janela temporal e escopo

- Snapshot de **2026-08-06**. Este é um `--quick` restrito ao delta de 7 arquivos; NÃO é uma
  varredura full do repo.
- O repo NÃO tem `infra/` (Terraform inexistente — estado atual é Express/Render/Vercel/Supabase,
  conforme CLAUDE.md §Estado Atual vs. Alvo). Findings de IaC/multi-tenant/CloudWatch/GuardDuty
  foram marcados **N/A** pelos agents — cards de observabilidade em produção assumem o roadmap
  `AwsInfraArchitect` como pré-requisito para alerta CloudWatch; até lá, ficam como log
  estruturado + dashboard de log-grep.
- As 14 falhas de teste em `npm test` full são **pré-existentes** (4 suites
  `routes/recebimentos.e2e.*`, Frente IV, env var `COM297_GCD_NOTA_DEBITO` ausente),
  confirmadas com `git stash` no baseline limpo. **Não são regressão deste delta.**

### Deduplicação de cards

4 pares de cards originais foram fundidos em 4 cards consolidados no KANBAN (originalmente 27
cards, agora 23):
- `availability-2` + `deployability-2` → **cq-observabilidade-orfao** (observabilidade agregada)
- `performance-1` + `integrability-4` → **cq-shortcircuit-assert** (short-circuit local)
- `availability-3` + `modifiability-1` → **cq-predicado-vazio** (consolidar `'settled'` +
  `podeAprovar`)
- `availability-4` + `fault-tolerance-4` → **cq-timeout-limpeza** (teto de tempo/AbortController
  na compensação)

Cada card consolidado cita explicitamente as QAs que o levantaram (rastreabilidade preservada).

## 8. Ações recomendadas (30 dias)

1. **Sprint 1 (5 dias, 2 devs):** executar os 11 quick wins (§4). Prioridade máxima para
   observabilidade (cq-observabilidade-orfao + test-2 + avail-1) e para ft-2/ft-3 (defesa
   contra payload malformado do ERP). Cards: `cq-observabilidade-orfao`, `test-2`, `avail-1`,
   `ft-1`, `ft-2`, `ft-3`, `deploy-1`, `deploy-3`, `cq-shortcircuit-assert`, `perf-2`, `test-1`.
2. **Sprint 2 (5 dias):** iniciar o refactor de `reconciliar` (mod-2) e o façade fin010
   (integ-3). Coordenar cronologicamente — o façade toca superfícies do reconciliador. Cards:
   `mod-2`, `integ-3`.
3. **Antes do merge do PR deste tweak (bloqueante):** bump de versão (Green Criterion #10).
   Card: `deploy-4`. Delta contém `fix(permutas)` → semver PATCH obrigatório (0.20.1 → 0.20.2).
   **Estado: já aplicado neste worktree** (FE+BE em 0.20.2 + entrada de CHANGELOG).
4. **Follow-up de trimestre:** repetir `/regis-review` **full** (não `--quick`) daqui a 3 meses
   para reavaliar débito acumulado e coletar métricas de produção que não são medíveis
   localmente (baseline de latência do Conexos + taxa de cascos + P95 de `baixas.length`).
5. **Watchlist para próximo `/feature-tweak` que tocar `ReconciliacaoPermutaService.reconciliar`:**
   se `mod-2` não estiver completo, considerar bloquear expansão do método — a próxima
   invariante empurra o método para 220+ LoC.
