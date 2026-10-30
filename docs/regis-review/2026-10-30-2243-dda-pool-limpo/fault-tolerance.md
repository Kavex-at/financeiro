---
qa: Fault Tolerance
qa_slug: fault-tolerance
run_id: 2026-10-30-2243-dda-pool-limpo
agent: qa-fault-tolerance
generated_at: 2026-10-30T22:43:00-03:00
scope: backend
score: 7
findings_count: 5
cards_count: 5
---

# Fault Tolerance — Regis-Review

## 1. Cenário Geral (Bass General Scenario aplicado ao nf-projects)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Postgres (consulta nova `listInativosRecentes`) | timeout, erro de conexão, erro de plano no `WHERE ativo = FALSE AND vencimento BETWEEN …` | `BoletoDdaService.consolidarEscopo` → aba "Boletos DDA" | operação normal (analista abrindo a aba durante janela de pagamento) | a falha ser contida à feição `TITULO_SAIU_CARTEIRA` (degradação graciosa): o resto da aba renderiza | 0 incidentes em que a aba inteira cai por causa da nova query informativa; `TITULO_SAIU_CARTEIRA` fica silenciosamente vazio e um `LogService.warn` sobe |
| Pipeline DDA (ingestão em cópias) | mesmo `codbar` aparece em 3+ arquivos do fin124 e um deles bate em título INATIVO mas valor+data também batem num título ATIVO com pequena variação | `ConsolidacaoBoletoDda.consolidar` / `comGrupo` | aba de ação de pagamento | representante escolhida (`arquivo mais recente`) + situação derivada não escondem um boleto que ainda precisa ser pago | 0 boletos legítimos classificados como `TITULO_SAIU_CARTEIRA` e caindo fora de `contagem.todas` / `totais.todas` / "urgentes" |

> Esta feature é **leitura-pura** (nada vai ao Conexos/Nexxera). O risco de duplo pagamento permanece em caminhos de ação (não tocados aqui). O risco de fault tolerance novo é **invisibilidade** (um boleto a pagar some do painel) e **disponibilidade da aba** (falha de query informativa derruba a aba inteira).

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Consultas novas com tratamento de falha isolado (fallback / `.catch` → degradação) | 0/1 (`listInativosRecentes` dentro de `Promise.all`) | 1/1 | ❌ | `src/backend/domain/service/sispag/BoletoDdaService.ts:136-144` |
| Writes financeiros adicionados no diff | 0 | — | N/A | `git diff --stat` (nenhum repository `insert/update` em `fin010`/`com298`/GED) |
| Idempotência de writes externos | — | — | N/A | feature é read-only |
| Transações DB cobrindo escritas múltiplas | — | — | N/A | nenhuma escrita no diff |
| Audit-trail parelho a mutações | — | — | N/A | nenhuma mutação no diff |
| Classificações informativas que a lista padrão esconde | 1 (`TITULO_SAIU_CARTEIRA` escondida de `todas`, `contagem.todas`, `totais.todas`, `urgentes`) | ≥1 com log/alerta quando grupo/decisão existir numa cópia que vira "saiu" | ⚠️ | `src/backend/domain/service/sispag/PaginacaoBoletoDda.ts:68-72, 236-241, 354-367` |
| Classificações excluídas de "urgentes" | +1 (`FORA_JANELA`) | documentado em teste | ✅ | `PaginacaoBoletoDda.ts:366-367` + `PaginacaoBoletoDda.test.ts` |
| Cobertura de teste do colapso de cópias + retargeting por grupo | 3 cenários novos (test file `ConsolidacaoBoletoDda.test.ts` +192 linhas) | — | ✅ | `src/backend/domain/service/sispag/ConsolidacaoBoletoDda.test.ts` |

> ⚠️ **Não medível localmente**: taxa real de falso-positivo de `TITULO_SAIU_CARTEIRA` em PRD (requer snapshot de produção com títulos inativos reais). Recomendação: instrumentar `LogService.warn` quando um boleto classificado `TITULO_SAIU_CARTEIRA` também tiver `candidatos.length === 0` **e** `arquivos > 1`, para detectar casos ambíguos cedo.

## 3. Tactics — Cobertura no nf-projects

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Substitution | N/A (sem redundância física envolvida no diff) | N/A | — |
| Replacement | N/A | N/A | — |
| Predictive Model | heurística `TITULO_SAIU_CARTEIRA` (±R$0,05, ±10 dias) prevê que um título já quitado explica o boleto | ✅ presente | `ConsolidacaoBoletoDda.ts:29-30, 184-220` |
| Increase Competence Set | nova situação `FORA_JANELA` ensina o sistema a diferenciar "fora do que a carteira carrega" de "sem título" — reduz ação sobre dados que a carteira nunca iria alcançar | ✅ presente | `ConsolidacaoBoletoDda.ts:85-89, 329-343` |
| Sanity Checking | Zod/validation nos boundaries não altera; precedência explícita de situação (`CANDIDATO > FORA_JANELA > TITULO_SAIU_CARTEIRA > SEM_TITULO`) atua como sanity sobre a classificação | ✅ parcial | `ConsolidacaoBoletoDda.ts:331-343` |
| Comparison | `saiuDaCarteira` compara centavos+dias; `colapsarCopias` compara `ddcCod/ditCod` para eleger representante | ✅ presente | `ConsolidacaoBoletoDda.ts:184-220, 150-176` |
| Timestamp | janela da carteira baseada em `calendar.todayBrt()`/`addDays`; `BankingCalendar.fromErpEpoch` usado no `listInativosRecentes` | ✅ presente | `BoletoDdaService.ts:93, 141-144`; `TituloAPagarRepository.ts:259-268` |
| Timeout | repository usa `PostgreeDatabaseClient` compartilhado — nenhum timeout explícito **adicionado** para a nova query (hereda o do client) | ⚠️ parcial | `TituloAPagarRepository.ts:252-268` |
| Condition Monitoring | sem instrumentação específica para `TITULO_SAIU_CARTEIRA`/`FORA_JANELA` subindo em volume | ❌ ausente | — |
| Self-Test | N/A no escopo | N/A | — |
| Voting | `comGrupo` elege: `achados.find(CONFIRMADO) ?? achados[0]` — sem tiebreak explícito quando há 2+ `CONFIRMADO` em cópias diferentes | ⚠️ parcial | `BoletoDdaService.ts:179-205` |
| Redundancy | N/A no diff | N/A | — |
| Recovery (forward/backward) | leitura pura; recovery é "o analista enxerga menos" quando `listInativosRecentes` falha — nesse caso não há recovery, a Promise.all propaga a rejeição | ❌ ausente | `BoletoDdaService.ts:136-144` |
| Reintroduction (Shadow / State Resync / Escalating Restart) | N/A | N/A | — |
| Rollback | N/A (sem write) | N/A | — |
| Repair State | `colapsarCopias` repara estado de duplicata do fin124 (uma linha por `codbar`); `comGrupo` repara "grupo na cópia errada" apontando a linha para a cópia certa | ✅ presente | `ConsolidacaoBoletoDda.ts:150-176`; `BoletoDdaService.ts:170-205` |
| Idempotent Replay | N/A (sem write) | N/A | — |
| Compensating Transaction | N/A | N/A | — |
| Reconcile | a feature **é** uma reconciliação (boleto DDA × título a pagar); nova situação `TITULO_SAIU_CARTEIRA` amplia a reconciliação para explicar livres com título quitado | ✅ presente | `ConsolidacaoBoletoDda.ts:184-220` |
| Quarantine | `TITULO_SAIU_CARTEIRA` escondida da lista padrão (`contagem.todas`, `totais.todas`, "urgentes") é uma quarentena de informação — correta por design mas sem gatilho de "revisar quarentena" | ⚠️ parcial | `PaginacaoBoletoDda.ts:68-72, 236-241, 354-358` |

## 4. Findings (achados)

### F-fault-tolerance-1: `listInativosRecentes` dentro de `Promise.all` derruba a aba inteira se a nova query falhar

- **Severidade**: P1
- **Tactic violada**: Recovery (forward) / Condition Monitoring
- **Localização**: `src/backend/domain/service/sispag/BoletoDdaService.ts:136-144`
- **Evidência (objetiva)**:
  ```ts
  const [boletos, titulos, titulosSaidos, titulosEmLote] = await Promise.all([
      this.repo.listBoletos(vencimentoDesde ? { vencimentoDesde } : {}),
      this.tituloRepo.listAtivos(),
      this.tituloRepo.listInativosRecentes({
          de: this.calendar.addDays(hoje, -(JANELA_CARTEIRA_DIAS_ATRAS + LIMITE_DIAS_SAIDO)),
          ate: this.calendar.addDays(hoje, JANELA_CARTEIRA_DIAS_ADIANTE + LIMITE_DIAS_SAIDO),
      }),
      this.loteRepo.listTitulosEmLotesAbertos(),
  ]);
  ```
  `Promise.all` rejeita no primeiro erro. Antes do diff, a aba renderizava mesmo que `titulo_a_pagar` tivesse muitos inativos — não havia essa consulta. Agora um timeout/erro de plano **apenas** na query informativa (`WHERE ativo = FALSE AND vencimento ...`) propaga para `listar`, propaga para a rota, e o analista vê um erro 500 em vez da aba de boletos.
- **Impacto técnico**: regressão de disponibilidade: uma feature **informativa** (não-crítica) passou a bloquear uma feature **crítica** (a aba de ação sobre boletos DDA).
- **Impacto de negócio**: no pior dia (fechamento, janela de pagamento), o analista fica sem conseguir abrir a aba por conta de uma classificação cosmética. Perde-se tempo e, se não notarem, pagamento atrasa.
- **Métrica de baseline**: 0/1 consultas informativas isoladas por `.catch`; antes do diff a mesma falha teria 0 efeito.

### F-fault-tolerance-2: `TITULO_SAIU_CARTEIRA` esconde o boleto da lista padrão com matching frouxo (±R$0,05 e ±10 dias) e sem telemetria

- **Severidade**: P1
- **Tactic violada**: Quarantine (sem gatilho de revisão) / Comparison (limites frouxos)
- **Localização**: `src/backend/domain/service/sispag/ConsolidacaoBoletoDda.ts:184-220, 331-343`; `PaginacaoBoletoDda.ts:68-72, 236-241, 354-358`
- **Evidência (objetiva)**:
  ```ts
  // ConsolidacaoBoletoDda.ts
  const LIMITE_VALOR_SAIDO_CENTAVOS = 5;
  export const LIMITE_DIAS_SAIDO = 10;
  // ...
  return saidos.filter(
      (s) => Math.abs(s.centavos - valor) <= LIMITE_VALOR_SAIDO_CENTAVOS &&
             Math.abs(this.diasEntre(s.vencimento, vencimento)) <= LIMITE_DIAS_SAIDO,
  )
  // PaginacaoBoletoDda.ts (contagem/totais pulam a situação)
  if (b.situacao === ESCONDIDA_NA_LISTA_PADRAO) continue;
  contagem.todas += 1;
  somar(totais.todas, b.valor);
  ```
  Semântica real do inativo (segundo o próprio comentário do repositório): "em regra quitados, mas também cancelados, previsão ou renegociados". O match ±10 dias / ±R$0,05 contra qualquer `ativo=false` esconde um boleto legítimo quando: (a) um título **cancelado/renegociado** com valor e data parecidos existir; (b) uma renegociação dividiu/combinou títulos; (c) duas faturas mensais do mesmo credor com valores quase idênticos (ex.: energia, assinatura). O boleto some da lista padrão **e** some das somas (`contagem.todas`, `totais.todas`, `urgentes`).
- **Impacto técnico**: a decisão de esconder atua antes de qualquer verificação de que o inativo foi **efetivamente quitado**; não há cross-check com `pago=true` nem com `pes_cod`/credor nos filtros.
- **Impacto de negócio**: boleto a pagar invisível → vencimento perdido → multa/juros. Cenário realista no fluxo da Columbia: um fornecedor emite duas cobranças mensais de valor próximo (energia, assinatura); o ciclo anterior foi cancelado no ERP (ativo=false) e o novo boleto cai dentro de 10 dias e R$0,05 do velho.
- **Métrica de baseline**: filtro adicional usado hoje para elegibilidade do `saidos`: `vencimento IS NOT NULL` (só). Não há `AND pago = TRUE` nem comparação de credor/pes_cod. Em PRD a razão `inativos cancelados / inativos quitados` não é medível localmente, mas basta >0 para o cenário ocorrer.

### F-fault-tolerance-3: `comGrupo` sem tiebreak quando duas cópias têm grupo `CONFIRMADO`

- **Severidade**: P3
- **Tactic violada**: Voting (sem regra de desempate)
- **Localização**: `src/backend/domain/service/sispag/BoletoDdaService.ts:181-187`
- **Evidência (objetiva)**:
  ```ts
  const escolhido =
      achados.find((x) => x.grupo.estado === 'CONFIRMADO') ?? achados[0];
  ```
  `find` devolve o primeiro na ordem de `itens = [b, ...copias]`. Se o representante é a cópia mais nova (maior `ddcCod/ditCod`) e o analista confirmou um grupo numa cópia antiga, está certo. Mas se **duas** cópias têm `CONFIRMADO` (estado inconsistente: só pode acontecer com retrabalho de ingestão + ação concorrente), a escolha é determinística pela ordem — não pela ação mais recente nem por timestamp.
- **Impacto técnico**: cenário improvável; grupos são chaveados por `(ddcCod, ditCod)`, então dois grupos CONFIRMADOs em cópias distintas requer confirmação explícita em duas chaves. Mesmo assim, feature read-only: a divergência fica no visual.
- **Impacto de negócio**: analista vê um grupo quando poderia ver outro; nenhuma ação errada decorre, pois a linha aponta à cópia do grupo escolhido e as ações usam `ddcCod/ditCod` da própria linha.
- **Métrica de baseline**: 0 testes cobrindo 2+ `CONFIRMADO` em cópias distintas.

### F-fault-tolerance-4: `FORA_JANELA` exclui o boleto de `urgentes` sem sinalização

- **Severidade**: P3
- **Tactic violada**: Condition Monitoring
- **Localização**: `src/backend/domain/service/sispag/PaginacaoBoletoDda.ts:364-367`
- **Evidência (objetiva)**:
  ```ts
  // Urgência é "conferir ou achar título": fora da janela não tem título a achar.
  if (b.situacao === BOLETO_DDA_SITUACAO.FORA_JANELA) continue;
  ```
  Um boleto com vencimento fora de `[hoje-15, hoje+45]` é retirado da conta de urgentes. Para erros de digitação de vencimento em arquivo DDA (ex.: ano trocado), isso vira silêncio onde deveria ser alerta.
- **Impacto técnico**: um boleto com data errada no `codbar`/arquivo não sobe para "urgentes" nem para `totais.todas`? Checagem: `FORA_JANELA` **conta** em `contagem.todas` e `totais.todas` (só `TITULO_SAIU_CARTEIRA` é escondida), então aparece — mas não como urgente.
- **Impacto de negócio**: perde-se o nudge de atenção para boletos com data suspeita.
- **Métrica de baseline**: 0 contadores de "boletos FORA_JANELA no dia de hoje" em painel/log.

### F-fault-tolerance-5: nova query SQL `listInativosRecentes` sem timeout explícito

- **Severidade**: P3
- **Tactic violada**: Timeout
- **Localização**: `src/backend/domain/repository/sispag/TituloAPagarRepository.ts:252-268`
- **Evidência (objetiva)**:
  ```sql
  SELECT ... FROM titulo_a_pagar
  WHERE ativo = FALSE
    AND vencimento IS NOT NULL
    AND (vencimento AT TIME ZONE 'UTC')::date BETWEEN $de::date AND $ate::date
  ORDER BY vencimento ASC
  ```
  Depende do index/plan do campo `vencimento` com cast `AT TIME ZONE 'UTC'` — pode não bater num índice simples sobre `vencimento`. Sem `statement_timeout` dedicado, uma varredura larga de `ativo=false` em PRD pode travar a Promise.all.
- **Impacto técnico**: amplifica F-fault-tolerance-1.
- **Impacto de negócio**: aba trava mais tempo do que deveria em dias com `titulo_a_pagar` grande.
- **Métrica de baseline**: tempo real da query em PRD não medível localmente.

## 5. Cards Kanban

### [fault-tolerance-1] Isolar `listInativosRecentes` com fallback para array vazio

- **Problema**
  > Hoje a nova consulta roda dentro do `Promise.all` que entrega a aba de boletos DDA. Como `TITULO_SAIU_CARTEIRA` é informativo e esconderia o boleto por padrão, uma falha nessa consulta derruba a aba inteira — regressão de disponibilidade numa feature crítica para pagar no prazo.

- **Melhoria Proposta**
  > Trocar a chamada no `Promise.all` por uma versão com `catch` que loga `LogService.warn` e devolve `[]`. Tactic alvo: Recovery (forward) — degradar graciosamente. Arquivo: `src/backend/domain/service/sispag/BoletoDdaService.ts:136-144`. Padrão sugerido: envolver `this.tituloRepo.listInativosRecentes(...)` numa função privada que faça o try/catch e marque no snapshot um bit "saídos indisponíveis" para a UI opcionalmente exibir.

- **Resultado Esperado**
  > A aba renderiza mesmo se a nova query falhar; apenas `TITULO_SAIU_CARTEIRA` fica vazio. Métrica observável: incidentes "aba DDA inteira caiu por `listInativosRecentes`": 1 risco → 0.

- **Tactic alvo**: Recovery (forward) / Condition Monitoring
- **Severidade**: P1
- **Esforço estimado**: S
- **Findings relacionados**: F-fault-tolerance-1, F-fault-tolerance-5
- **Métricas de sucesso**:
  - consultas informativas isoladas por fallback: 0/1 → 1/1
  - log de degradação parcial presente: ausente → `LogService.warn('listInativosRecentes falhou, aba degrada com saídos=[]')`
- **Risco de não fazer**: num dia de janela de pagamento, uma indisponibilidade pontual do Postgres (ou um plano ruim após `ANALYZE`) tira a aba do ar e o analista não consegue pagar.
- **Dependências**: nenhuma.

### [fault-tolerance-2] Endurecer a elegibilidade de `TITULO_SAIU_CARTEIRA` e instrumentar

- **Problema**
  > A classificação `TITULO_SAIU_CARTEIRA` esconde o boleto da lista padrão e das somas `contagem.todas`/`totais.todas`/`urgentes`. O match é frouxo (±R$0,05 e ±10 dias) e aceita qualquer `ativo=false`, inclusive **cancelados**, **previsão** e **renegociados**. Cenário realista: dois boletos mensais de valor próximo, o anterior cancelado no ERP, o novo some do painel.

- **Melhoria Proposta**
  > (1) Restringir no SQL de `listInativosRecentes` para `ativo=false AND pago=true` — mantém o espírito "em regra quitados" e corta cancelados/previsão. (2) Casar também por `pes_cod`/credor quando ambos tiverem (reduz colisão por valor). (3) Instrumentar: `LogService.warn` quando um boleto virar `TITULO_SAIU_CARTEIRA` tendo `arquivos > 1` ou valor exatamente igual ao do saído (match "colado" é mais confiável; match com delta é mais suspeito). (4) Documentar no `rotulosDda.ts` que o estado é uma inferência. Tactic alvo: Quarantine com gatilho de revisão.

- **Resultado Esperado**
  > Falso-positivo da ocultação cai: boletos cuja contraparte é cancelada/previsão/renegociada voltam a aparecer na lista padrão (como `SEM_TITULO`, com urgência preservada). Métrica observável: percentual estimado de `TITULO_SAIU_CARTEIRA` cuja contraparte não é `pago=true`: desconhecido → 0.

- **Tactic alvo**: Quarantine / Comparison
- **Severidade**: P1
- **Esforço estimado**: S
- **Findings relacionados**: F-fault-tolerance-2
- **Métricas de sucesso**:
  - cláusula `AND pago = TRUE` presente em `listInativosRecentes`: não → sim
  - log/counter de classificação `TITULO_SAIU_CARTEIRA`: ausente → presente
  - novos testes cobrindo "inativo não pago não deve esconder": 0 → 2
- **Risco de não fazer**: boleto esquecido → multa/juros ao fornecedor; recorrente de valor fixo é o caso mais provável e também o mais embaraçoso para a área financeira.
- **Dependências**: nenhuma (`pago` já é campo lido pelo repositório).

### [fault-tolerance-3] Desempate explícito em `comGrupo` quando múltiplas cópias têm grupo `CONFIRMADO`

- **Problema**
  > O escolhido em `comGrupo` é o primeiro `CONFIRMADO` encontrado em ordem — e o representante vem primeiro. Se dois `CONFIRMADO` existirem em cópias distintas (estado inconsistente), a escolha é arbitrária pela ordem e não pelo timestamp da confirmação.

- **Melhoria Proposta**
  > Tiebreak estável: ao haver 2+ `CONFIRMADO`, preferir o do `ddcCod` maior (arquivo mais recente). Caso ainda haja empate, `ditCod` maior. Adicionar teste que fixa a convenção. Tactic alvo: Voting com regra determinística.

- **Resultado Esperado**
  > Comportamento previsível em estado anômalo; log opcional alertando o caso. Métrica: testes cobrindo "dois CONFIRMADO em cópias distintas": 0 → 1.

- **Tactic alvo**: Voting
- **Severidade**: P3
- **Esforço estimado**: S
- **Findings relacionados**: F-fault-tolerance-3
- **Métricas de sucesso**:
  - teste explícito presente: não → sim
- **Risco de não fazer**: cenário raro, impacto meramente visual; conviver 6 meses sem resolver é aceitável.
- **Dependências**: nenhuma.

### [fault-tolerance-4] Contador/telemetria para boletos `FORA_JANELA`

- **Problema**
  > `FORA_JANELA` é hoje a vala comum de boleto com vencimento esquisito (típico: ano trocado no `codbar`). Fica fora de "urgentes" e sem destaque próprio.

- **Melhoria Proposta**
  > Emitir `LogService.message` com nível info quando o volume diário de `FORA_JANELA` crescer >1σ sobre a semana anterior (ou, mais simples: logar contagem no final do `consolidar`). Documentar na UI que o segmento "Fora da janela" merece revisão. Tactic alvo: Condition Monitoring.

- **Resultado Esperado**
  > Picos de boletos com vencimento esquisito ficam visíveis. Métrica: contagem diária de `FORA_JANELA` disponível em log: não → sim.

- **Tactic alvo**: Condition Monitoring
- **Severidade**: P3
- **Esforço estimado**: S
- **Findings relacionados**: F-fault-tolerance-4
- **Métricas de sucesso**:
  - log/metric diária presente: 0 → 1
- **Risco de não fazer**: perda silenciosa do nudge sobre data suspeita.
- **Dependências**: nenhuma.

### [fault-tolerance-5] `statement_timeout` dedicado para `listInativosRecentes`

- **Problema**
  > A query nova usa `(vencimento AT TIME ZONE 'UTC')::date BETWEEN …` sobre `WHERE ativo=false`. Sem timeout dedicado, uma varredura ampla em PRD pode travar a aba.

- **Melhoria Proposta**
  > Envolver a chamada em `PollExecutor`/driver-level `statement_timeout` curto (ex.: 2s) e, no erro, cair ao fallback do card [fault-tolerance-1]. Tactic alvo: Timeout.

- **Resultado Esperado**
  > Pior caso da nova query: 2s + fallback `[]` + warn. Métrica: p95 da query documentado via log/CloudWatch (não medível localmente).

- **Tactic alvo**: Timeout
- **Severidade**: P3
- **Esforço estimado**: S
- **Findings relacionados**: F-fault-tolerance-5, F-fault-tolerance-1
- **Métricas de sucesso**:
  - timeout explícito presente: não → sim
- **Risco de não fazer**: amplifica F-fault-tolerance-1.
- **Dependências**: card [fault-tolerance-1] (o fallback precisa existir primeiro).

## 6. Notas do agente

- Escopo é **leitura-pura**: nenhum achado P0 é justificável — nada neste diff executa um financial write, logo os eixos "idempotência / outbox / transação cross-ERP" são N/A. O ladrão aqui é **invisibilidade** (boleto a pagar some do painel) e **disponibilidade da aba** (query cosmética derruba a aba inteira).
- `comGrupo` retargeta `ddcCod/ditCod` da linha para a cópia que detém o grupo, portanto as ações futuras (compor/confirmar) agem na cópia certa — não vi aqui um caminho em que o analista pague/aja na cópia errada (não é P0).
- Cross-QA: F-fault-tolerance-1 e F-fault-tolerance-5 pisam em **Availability** (Promise.all + sem timeout); F-fault-tolerance-2 pisa em **Testability** (testes do inativo-não-quitado faltam) e em **Modifiability** (`TITULO_SAIU_CARTEIRA` acopla ingestão + classificação sem gatilho de revisão). Alertar o consolidator.
- Métrica "falso-positivo real de `TITULO_SAIU_CARTEIRA` em PRD" declarada não-medível localmente — depende de snapshot com `ativo=false AND pago=false`.
