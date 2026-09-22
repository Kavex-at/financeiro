---
qa: Fault Tolerance
qa_slug: fault-tolerance
run_id: 2026-09-16-1650-metricas-historico
agent: qa-fault-tolerance
generated_at: 2026-09-18T15:00:00-03:00
scope: backend
score: 7
findings_count: 3
cards_count: 3
---

# Fault Tolerance — Regis-Review

## 1. Cenário Geral (Bass General Scenario aplicado ao nf-projects)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Analista da Columbia abrindo `/metricas` (via `fetchMetricasCiclo()`, que agora sempre pede `?historico=true`) — concorrente, em produção, com o fluxo humano `BorderoGestaoService.excluirBordero` que apaga linhas de `permuta_alocacao_execucao` | `GET /metricas/ciclo?historico=true` recua o piso da série de `2026-09-11` para `2026-08-07`, expondo 5 semanas fechadas adicionais lidas do **estado atual** de um ledger que pode ter sido mutado (DELETE) depois de essas mesmas semanas já terem sido reportadas ao cliente pelo `kavex-report-ciclo` | `MetricasCicloRepository.listar/serieInicio`, `metricas.historico_inicio()` (migration 0060), `MetricasCicloService.ler`, `routes/metricas.ts`, tela `/metricas` § Histórico | Produção (Render/Supabase), leitura autenticada, sem transação explícita entre as duas queries do `Promise.all` | A leitura deve permanecer 100% somente-leitura; falhar atomicamente (nunca exibir número parcial como completo); as semanas mais antigas, sendo live-recomputed e não snapshot congelado, não devem contradizer em silêncio um número já entregue ao cliente sem nenhum sinal ao leitor | 0 DML no delta (confirmado); 0 caminho de renderização parcial em erro (confirmado); 5 semanas fechadas adicionais expostas sem indicador de "sujeito a mudança retroativa" (novo); exposição a subnotificação de Permutas ampliada ~5x sobre o achado já registrado em `2026-09-14-1624-metricas-ciclo/fault-tolerance.md` (F-fault-tolerance-1), sem nova instrumentação de detecção |

> Leitura de negócio: ADR-0048 D4 é uma decisão consciente do Yuri de **não sinalizar** as semanas recuperadas. Este QA não contesta a decisão de produto — avalia se ela deixa a tela sem tactic de detecção/reconciliação para o risco que ela mesma declara aceitar (ADR-0048 §Consequências, penúltimo item).

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| DML no delta (migration 0060 + repositório + rota + service + frontend) | 0 (só `CREATE OR REPLACE FUNCTION` + `REVOKE`, ambos idempotentes) | 0 | ✅ | `git diff origin/main` (7 arquivos de produção); `0060_metricas_historico_inicio.sql:47-57` |
| Chamada ao ERP/Conexos no delta | 0 | 0 | ✅ | `routes/metricas.ts:32` comentário "Não toca o Conexos"; nenhum `ConexosClient` importado nos arquivos do delta |
| Interpolação de request no SQL (`historico`) | 0 — escolha é entre 2 literais fixos (`PISO.serie` / `PISO.historico`), nunca a data da requisição | 0 | ✅ | `MetricasCicloRepository.ts:26-36` (`PISO` como `const` objeto, não `filtro.historico` concatenado) |
| Resposta parcial em falha de leitura (uma query OK, outra falha) | 0 — `Promise.all` rejeita o par inteiro; `asyncHandler` → `next(err)` → `errorMiddleware` → `500 {"error":"Internal server error"}` | 0 | ✅ | `MetricasCicloService.ts:41-44`; `src/backend/http/asyncHandler.ts:12`; `src/backend/http/errorMiddleware.ts:35` |
| Tratamento de erro no frontend em falha de fetch | `!res.ok` lança; `page.tsx` cai em `erro !== null` → `EmptyState` com "Tentar de novo"; nunca renderiza tabela parcial | sem renderização parcial | ✅ | `src/frontend/lib/metricas.ts:56-59`; `src/frontend/app/metricas/page.tsx:53-55,85-95` |
| `historico=false` tratado como `Boolean("false")` (bug clássico de coerção) | Evitado — `z.enum(['true','false'])`, não `z.coerce.boolean()` | evitado | ✅ | `routes/metricas.ts:14-17`; `metricas.test.ts:131-136` |
| Guardas estáticas cobrindo a 0060 (não redefine `serie_inicio`, grade idêntica, sexta 18:00, REVOKE presente) | 6 guardas novas | ≥ 1 | ✅ | `vwMetricasCiclo.test.ts:130-193` |
| Semanas fechadas expostas na tela sem sinalização de que podem mudar retroativamente | 5 (antes do delta: 0 — só a semana parcial existia) | indicador presente ou risco documentado no produto, não só no SQL | ⚠️ | `page.tsx:147-189` (seção Histórico sem coluna/nota de frescor); ADR-0048 D4 |
| Linhas em `permuta_alocacao_execucao` elegíveis a `DELETE` por exclusão de borderô (achado herdado) | 190 (snapshot 2026-09-14, medido no run anterior) — nenhuma tabela append-only criada desde então | 0 mutação silenciosa de janela passada | ⚠️ | `docs/regis-review/2026-09-14-1624-metricas-ciclo/fault-tolerance.md` F-fault-tolerance-1; `grep -rl metricas_ciclo_leituras src/backend` → vazio (não implementado) |
| Multiplicador de exposição temporal ao risco de subnotificação (semana mais antiga visível) | 0 dias (só a parcial) → até ~42 dias (janela `07/08–14/08`) | — | ⚠️ | Cálculo: `historico_inicio()` = `2026-08-07 18:00`; hoje = `2026-09-18` (system date) |
| Statement timeout no papel de leitura das queries deste delta | herdado do role de conexão padrão (não há `metricas_ciclo_leitor` neste caminho — repositório usa `databaseClient` genérico) | timeout explícito | ⚠️ **não medível no delta** | `MetricasCicloRepository.ts` não define `SET statement_timeout`; achado já registrado no run anterior (F-fault-tolerance de 09-14, item de role) — fora do escopo deste delta, citado por completude |
| `RetryExecutor`/backoff na leitura de `MetricasCicloRepository` | ausente | opcional para leitura idempotente com retry manual na UI | ⚠️ | grep negativo por `RetryExecutor` em `MetricasCicloRepository.ts`/`MetricasCicloService.ts`; mitigado por botão "Recarregar" em `page.tsx:76-79` |

> ⚠️ **Não medível localmente**: quantas linhas de `permuta_alocacao_execucao` referentes às 5 semanas de agosto (07/08–11/09) já foram de fato apagadas por exclusão de borderô desde que nasceram. Requer produção (comparar contagem de linhas hoje com o total de tentativas que o `kavex-report-ciclo` reportou para essas semanas, se arquivado). Recomendação: implementar o card `fault-tolerance-1` do run `2026-09-14-1624-metricas-ciclo` (tabela append-only `metricas_ciclo_leituras`) antes de a janela de agosto envelhecer mais.

## 3. Tactics — Cobertura no nf-projects

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| **Substitution** | N/A no delta — nenhum componente redundante a substituir; leitura única contra um Postgres único. | N/A | — |
| **Replacement** | N/A — read-model sem réplica. | N/A | — |
| **Predictive Model** | N/A para este delta (a data fixa `2026-08-07` é constante de negócio, não previsão). | N/A | — |
| **Increase Competence Set** | Guardas estáticas + testes de integração cobrem os dois pisos e a nova grade combinada, ampliando o envelope de comportamento verificado antes do merge. | ✅ presente | `vwMetricasCiclo.integration.test.ts` (93 linhas novas); `MetricasCicloRepository.test.ts` (+50 linhas) |
| **Sanity Checking** | Zod no boundary rejeita `historico` fora de `{true,false}` com 400 sem tocar o banco; `z.enum` evita a armadilha de `z.coerce.boolean()`. | ✅ presente | `routes/metricas.ts:14-22`; `metricas.test.ts:138-146` |
| **Comparison** | Ausente para o caso específico deste delta: não há comparação entre o valor que uma semana fechada mostrou numa leitura anterior e o que mostra agora (drift por `DELETE` posterior). O `serieInicio` devolvido é consistente com o piso pedido (D3), o que é comparação de *contrato*, não de *valor ao longo do tempo*. | ⚠️ parcial | `MetricasCicloService.ts:38-44` (consistência do piso); ausência de comparação temporal confirmada por grep negativo em `src/backend/jobs/` |
| **Timestamp** | `historico_inicio()` é `IMMUTABLE`, data fixa documentada; `apurado_ate`/`parcial` seguem intocados nesta camada. | ✅ presente | `0060_metricas_historico_inicio.sql:47-53` |
| **Timeout** | Herdado do client genérico; nenhum timeout dedicado introduzido ou removido por este delta. | ⚠️ não avaliável no escopo do delta | `PostgreeDatabaseClient.ts` (fora do delta) |
| **Condition Monitoring** | Nenhum monitor detecta quando uma semana fechada, já visível/reportada, perde tentativas por `DELETE` no ledger de origem. Pré-existente (F-fault-tolerance-2, run 09-14), agora com 5x mais semanas expostas à mesma lacuna. | ❌ ausente | grep negativo por monitor de drift em `src/backend/jobs/`; `page.tsx` sem indicador |
| **Self-Test** | 6 guardas estáticas novas (não redefine `serie_inicio`, REVOKE presente, grade idêntica, sexta 18:00) + testes de rota nos dois caminhos (`historico` ausente/`true`/`false`/inválido). | ✅ presente | `vwMetricasCiclo.test.ts:130-193`; `routes/metricas.test.ts:113-152` |
| **Voting** | N/A — fonte única determinística. | N/A | — |
| **Redundancy** | N/A — sem réplica/fallback de dados esperado para um read-model interno. | N/A | — |
| **Recovery (forward)** | Migration `CREATE OR REPLACE` + `REVOKE ALL` idempotentes; reaplicar é no-op. Falha de leitura não trava a aplicação — propaga erro e a tela oferece "Tentar de novo". | ✅ presente | `0060:47-57`; `page.tsx:91-93` |
| **Recovery (backward)** | Nenhum rollback script dedicado para `0060` (mesma lacuna já registrada para `0058` no run anterior, F-fault-tolerance-4). Migration é aditiva e de baixo risco (uma função nova), então o rollback manual é trivial (`DROP FUNCTION`), mas o arquivo não existe. | ⚠️ parcial | `find src/backend/migrations/rollbacks -iname "*0060*"` → vazio |
| **Reintroduction** | Reaplicar a migration após reboot é no-op comprovado por teste. | ✅ presente | `vwMetricasCiclo.integration.test.ts` (guarda de idempotência herdada) |
| **Rollback** | Mesmo mecanismo do run anterior: `DELETE FROM permuta_alocacao_execucao WHERE bor_cod = $borCod` continua sem evento append-only. Este delta **não piora nem conserta** o mecanismo — amplia a janela de semanas fechadas onde o efeito fica visível na tela (achado central deste run, ver F-fault-tolerance-1 abaixo). | ⚠️ parcial (amplificado) | `PermutaExecucaoRepository.ts:268`; ADR-0048 §Consequências |
| **Repair State** | N/A — read-model; reparo pertence ao ledger de origem, fora do delta. | N/A | — |
| **Idempotent Replay** | `GET` é seguro/idempotente por construção; migration idempotente por `CREATE OR REPLACE`/`REVOKE ALL` re-executáveis. | ✅ presente | `0060:47-57`; `metricas.test.ts` (mesma query, mesmo resultado) |
| **Compensating Transaction** | N/A — leitura pura, nada a compensar. | N/A | — |
| **Reconcile** | Nenhuma reconciliação entre o valor que a tela mostra hoje para uma semana fechada e o valor que o `kavex-report-ciclo` já entregou para essa mesma semana no passado. A política declarada ("o report congela") é suficiente para o report, mas não dá à tela um sinal de quando os dois divergem. | ❌ ausente | ADR-0048 D4; grep negativo por comparação `report vs tela` em `src/backend`/`src/frontend` |
| **Quarantine** | N/A — não há item "bloqueado" nesta leitura; não existe exception queue para métricas (é um read-model, não um fluxo de execução). | N/A | — |

## 4. Findings (achados)

### F-fault-tolerance-1: ADR-0048 amplia ~5x a exposição ao risco de subnotificação de Permutas já registrado, sem nova instrumentação de detecção

- **Severidade**: P2 (débito técnico defensável — risco declarado e decidido em ADR-0048 D4/§Consequências, não é bug introduzido às escondidas; mas nenhuma tactic de detecção acompanha a decisão)
- **Tactic violada**: Comparison + Condition Monitoring + Reconcile (nenhuma monitora drift do ledger em semanas já exibidas)
- **Localização**: `src/backend/migrations/0060_metricas_historico_inicio.sql:47-53` (novo piso); `src/frontend/app/metricas/page.tsx:147-189` (seção Histórico, fora do delta mas agora recebe 5x mais linhas); mecanismo de origem em `src/backend/domain/repository/permutas/PermutaExecucaoRepository.ts:268` (`deleteByBorCod`, já registrado no run `2026-09-14-1624-metricas-ciclo`, F-fault-tolerance-1)
- **Evidência (objetiva)**:
  ```
  -- 0060_metricas_historico_inicio.sql
  -- "As semanas de agosto podem portanto SUBNOTIFICAR Permutas. Quanto mais antiga a
  --  semana, mais exposta. [...] esta ADR não o antecipa, e a D4 acima decide
  --  conscientemente não avisar o leitor na tela." (comentário do próprio autor do delta)

  # Exposição temporal antes/depois deste delta:
  #   antes: 0 semanas fechadas visíveis (só a parcial, serie_inicio = 2026-09-11)
  #   depois: 5 semanas fechadas visíveis, a mais antiga com piso 2026-08-07 18:00
  #   idade máxima de exposição: 0 dias → ~42 dias (hoje 2026-09-18)

  # run anterior (2026-09-14-1624-metricas-ciclo/fault-tolerance.md, F-fault-tolerance-1):
  # "190 linhas em permuta_alocacao_execucao (177 settled + 13 error), TODAS elegíveis a
  #  DELETE [...] Nenhuma tabela de eventos append-only registra o snapshot dos ciclos
  #  anteriores." — card fault-tolerance-1 (metricas_ciclo_leituras) NÃO implementado:
  $ grep -rl "metricas_ciclo_leituras" src/backend   # vazio
  ```
- **Impacto técnico**: cada semana fechada agora exibida na tela é uma consulta **live** sobre `permuta_alocacao_execucao`, não um snapshot. Se um borderô associado a uma tentativa de qualquer uma das 5 semanas de agosto/setembro for excluído no Conexos depois de a tela (ou um report antigo) tê-la mostrado, a linha desaparece do ledger e a tentativa some do numerador/denominador daquela semana na próxima leitura — sem qualquer marca de que isso ocorreu.
- **Impacto de negócio**: o risco que a ADR-0045 original evitava não emitindo essas semanas ("número reconstruído parece medido e não é") volta a existir, agora por decisão explícita, e para um cliente (Columbia) que pode comparar visualmente a tela com um report semanal já recebido por e-mail/arquivo para a mesma janela. Sem detecção, uma divergência entre os dois números — reduzindo a métrica de "Permutas concluídas" reportada anteriormente — aparece como inconsistência do produto, não como o efeito colateral conhecido de uma exclusão de borderô.
- **Métrica de baseline**: 190 linhas elegíveis a `DELETE` (medição de 2026-09-14, sem contagem mais recente); 0 tabela append-only; multiplicador de exposição temporal de semanas fechadas visíveis: 0 → 5 (infinito percentualmente, pois a base era zero) e idade máxima da janela exposta: 0 → ~42 dias.

### F-fault-tolerance-2: Semanas fechadas na tela não trazem nenhum sinal de que são live-recomputed, diferente do tratamento dado à semana parcial

- **Severidade**: P2 (a tela já tem o padrão de sinalizar dado sujeito a mudança — "parcial até X" — mas não aplica o mesmo princípio ao dado historicamente mutável)
- **Tactic violada**: Sanity Checking (comunicação de confiabilidade do dado ao usuário) + Comparison
- **Localização**: `src/frontend/app/metricas/page.tsx:109-114` (aviso "parcial até... os números mudam até a semana fechar") vs. `:163-182` (linhas fechadas, nenhum aviso equivalente); `src/backend/domain/interface/metricas/MetricaCiclo.ts:36-46` (comentário reconhece o problema no nível de API, mas a UI não o repassa)
- **Evidência (objetiva)**:
  ```tsx
  // page.tsx:109-114 — só a semana PARCIAL recebe o aviso de instabilidade
  {ultima.parcial ? (
    <p className="text-xs text-muted-foreground">
      Parcial até {formatarMomentoLocal(ultima.apuradoAte)}. Os números mudam até a
      semana fechar, na sexta às 18:00.
    </p>
  ) : null}

  // :163-182 — linhas "fechadas" (inclusive as 5 novas de agosto) não têm equivalente,
  // apesar de também poderem mudar por DELETE no ledger de origem (0058, invariante:
  // "O estado é o ATUAL do ledger: um borderô cancelado depois muda a semana em que a
  // baixa nasceu. O report congela o número no ciclo em que o leu.")
  ```
- **Impacto técnico**: o mesmo princípio de UX que o time já aplicou para `parcial` (não deixar número instável parecer definitivo) não foi estendido às semanas "fechadas" recuperadas pela ADR-0048, que tecnicamente também são instáveis — a diferença entre elas e a `parcial` é de grau (frequência de mudança), não de tipo.
- **Impacto de negócio**: um analista que revisita `/metricas` semanas depois pode ver um número diferente do que viu (ou do que o report entregou) para a mesma janela "fechada", sem explicação na própria tela — a explicação só existe em comentário de código/ADR, inacessível ao usuário final.
- **Métrica de baseline**: 1 de 2 estados de semana (parcial) tem aviso de instabilidade na tela; 0 de 5 semanas fechadas o têm, apesar de a ADR-0048 (§Consequências) declarar o mesmo tipo de risco para elas.

### F-fault-tolerance-3: Nenhum retry/backoff na leitura de `MetricasCicloRepository`; falha transitória de banco exige ação manual do usuário

- **Severidade**: P3 (leitura idempotente, sem escrita; mitigado pelo botão "Recarregar" na UI)
- **Tactic violada**: Recovery (forward) via `RetryExecutor`
- **Localização**: `src/backend/domain/repository/metricas/MetricasCicloRepository.ts` (inteiro); `src/backend/domain/service/metricas/MetricasCicloService.ts:41-44`
- **Evidência (objetiva)**:
  ```
  $ grep -n "RetryExecutor" src/backend/domain/repository/metricas/MetricasCicloRepository.ts \
                            src/backend/domain/service/metricas/MetricasCicloService.ts
  # (sem resultado)
  ```
- **Impacto técnico**: uma falha transitória de conexão (blip de rede Render↔Supabase) durante `Promise.all([serieInicio, listar])` propaga como erro 500 imediato, sem nenhuma tentativa automática.
- **Impacto de negócio**: baixo — a tela já oferece recarregar manualmente e o dado não é transacional. Vale registrar por padronização com outros clientes do projeto que já usam `RetryExecutor` (convenção do CLAUDE.md).
- **Métrica de baseline**: 0 usos de `RetryExecutor` nos 2 arquivos do delta que fazem I/O de banco.

## 5. Cards Kanban

### [fault-tolerance-1] Implementar `metricas_ciclo_leituras` (append-only) antes que a janela de agosto envelheça mais

- **Problema**
  > A ADR-0048 expõe 5 semanas fechadas adicionais na tela, todas lidas ao vivo de um ledger (`permuta_alocacao_execucao`) que perde linhas quando um borderô é excluído (190 linhas elegíveis, medição de 09-14). O card equivalente do run anterior (`2026-09-14-1624-metricas-ciclo`, fault-tolerance-1) não foi implementado, e a exposição temporal ao risco que ele mitigaria acabou de crescer de 0 para ~42 dias.

- **Melhoria Proposta**
  > Retomar o card `fault-tolerance-1` do run `2026-09-14-1624-metricas-ciclo`: tabela append-only `metricas.metricas_ciclo_leituras` + função `metricas.registrar_leitura(agora)`, chamada pelo `kavex-report-ciclo/scripts/metrics.py` a cada ciclo. Tactic Bass: **Rollback** (snapshot append-only) + **Reconcile**. Como consequência direta deste run, também vale registrar a leitura feita pela **tela** (não só pelo report), para permitir comparar "o que a tela mostrou hoje" com "o que ela mostrou na semana em que a janela fechou".

- **Resultado Esperado**
  > Uma divergência entre a leitura atual de uma semana fechada e a leitura registrada no momento em que ela fechou vira detectável por diff, em vez de invisível. Exposição de 5 semanas sem instrumentação → 0.

- **Tactic alvo**: Rollback + Reconcile
- **Severidade**: P2
- **Esforço estimado**: M (2–5d)
- **Findings relacionados**: F-fault-tolerance-1
- **Métricas de sucesso**:
  - Semanas fechadas com leitura registrada: 0 → 5 (as expostas hoje pela ADR-0048)
  - Divergência detectável entre leitura registrada e leitura atual: hoje impossível → mensurável por diff
- **Risco de não fazer**: quanto mais a data fixa `2026-08-07` envelhecer (ADR-0048 já assume isso em dezembro chegar a ~18 semanas), maior a superfície de semanas "fechadas" sujeitas a mudar sem rastro.
- **Dependências**: nenhuma dentro do repo.

### [fault-tolerance-2] Sinalizar na tela que semanas fechadas também podem mudar (mesma lógica do aviso de `parcial`)

- **Problema**
  > `page.tsx` avisa explicitamente quando uma semana é `parcial` ("os números mudam até fechar"), mas não avisa que semanas "fechadas" também podem mudar por exclusão de borderô no ledger de origem — um risco que a própria ADR-0048 declara e a 0058 documenta ("o report congela o número no ciclo em que o leu").

- **Melhoria Proposta**
  > Estender o aviso de rodapé já existente (`"Série iniciada em..."`) com uma nota curta e permanente — não por semana, para não parecer marca de reconstrução (respeitando D4) — do tipo "Números refletem o estado atual do ledger; podem diferir de um report já emitido para a mesma semana." Tactic Bass: **Sanity Checking** (comunicação de confiabilidade). Arquivo: `src/frontend/app/metricas/page.tsx` (fora do delta desta review, mas item de acompanhamento direto).

- **Resultado Esperado**
  > Usuário que compara tela com report antigo tem uma explicação na própria tela, não só no ADR. Aviso de instabilidade: 1 de 2 estados cobertos → 2 de 2 (mantendo D4: sem marcar semana individual).

- **Tactic alvo**: Sanity Checking
- **Severidade**: P2
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-fault-tolerance-2
- **Métricas de sucesso**:
  - Estados de semana com aviso de instabilidade: 1/2 → 2/2
- **Risco de não fazer**: divergência tela-vs-report percebida como bug de produto em vez de comportamento conhecido.
- **Dependências**: nenhuma; não conflita com ADR-0048 D4 (o aviso é genérico, não uma marca por semana).

### [fault-tolerance-3] Padronizar `RetryExecutor` na leitura de métricas

- **Problema**
  > `MetricasCicloRepository`/`MetricasCicloService` não usam `RetryExecutor` para a leitura de banco, ao contrário da convenção do projeto para I/O externo.

- **Melhoria Proposta**
  > Envolver as duas chamadas do `Promise.all` (`serieInicio`, `listar`) com `RetryExecutor` (poucas tentativas, delay curto — é leitura, não escrita). Tactic Bass: **Recovery (forward)**.

- **Resultado Esperado**
  > Blip transitório de conexão não exige clique manual em "Recarregar". Usos de `RetryExecutor` no módulo: 0 → 2.

- **Tactic alvo**: Recovery (forward)
- **Severidade**: P3
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-fault-tolerance-3
- **Métricas de sucesso**:
  - Usos de `RetryExecutor` em `MetricasCicloRepository`/`Service`: 0 → 2
- **Risco de não fazer**: baixo — UX levemente pior em blips raros; sem risco de dado incorreto.
- **Dependências**: nenhuma.

## 6. Notas do agente

- Escopo estritamente restrito aos 7 arquivos de produção do delta (`_shared-metrics.md`); `page.tsx` foi lido para avaliar impacto (focos 2–4 do prompt), mas não integra o diff desta branch — os cards 2/3 tocam um arquivo fora do delta e ficam como follow-up, não como bloqueio deste PR.
- Confirmado com evidência (não presumido): o delta é 100% somente-leitura (0 DML), não toca o ERP, e falha atomicamente (nunca parcial) tanto no backend (`Promise.all` + `errorMiddleware`) quanto no frontend (`!res.ok` → estado de erro, nunca tabela incompleta) — focos 1 e 4 do prompt respondidos negativamente (sem achado).
- Cross-QA: **Security** (F-1/F-2 tocam auditabilidade — quem viu o quê e quando, mesmo tema do run 09-14); **Testability** (o snapshot append-only do card 1 pede fixtures novas); **Integrability** (D3 da ADR-0048 já isola o `kavex-report-ciclo` do recuo — validado por `routes/metricas.test.ts:148-151`).
- Este run não repete a auditoria completa do run `2026-09-14-1624-metricas-ciclo` (cujos F-2/F-3/F-4 permanecem válidos e não re-emitidos aqui); referencia-o como baseline para quantificar a amplificação introduzida por este delta especificamente.
