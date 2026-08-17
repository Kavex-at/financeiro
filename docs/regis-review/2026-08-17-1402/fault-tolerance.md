---
qa: Fault Tolerance
qa_slug: fault-tolerance
run_id: 2026-08-17-1402
agent: qa-fault-tolerance
generated_at: 2026-08-17T14:02:00Z
scope: backend
score: 6
findings_count: 4
cards_count: 4
---

# Fault Tolerance — Regis-Review

> Escopo do delta: `GET /recebimentos/painel` (READ) passou a fazer ESCRITA LOCAL de reconciliação
> em `RecebimentosPainelService.hidratarUma` — grava `execucao.nde_autorizado=true` e
> `nota_debito_eletronica.numero_nde` quando o `com297` confirma que o SEFAZ autorizou. As duas
> escritas rodam com `.catch(() => undefined)`, sem transação entre si, sem log.

## 1. Cenário Geral (Bass General Scenario aplicado ao nf-projects)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Analista abre a aba NDe (ou o navegador re-fetcha o painel) | GET /recebimentos/painel dispara N hidratações do com297 — cada uma faz duas escritas locais (`setNdeAutorizado`+`updateNumeroNde`) sem transação | `RecebimentosPainelService.hidratarUma` + `SolicitacaoNumerarioExecucaoRepository.setNdeAutorizado` + `NdeRepository.updateNumeroNde` | Operação normal; DB local intermitente OU linha órfã (nd_doc_cod set, sem NDe local) | Reconciliar as duas metades; qualquer falha parcial precisa ser detectada, logada e retomada no próximo load | 0 linhas com `nde_autorizado=true` sem `numero_nde` reconciliado; 0 falhas silenciosas (todas em log); MTTR ≤ 1 load do painel |

O fato de essa rota agora escrever muda o cenário de "cache miss" para "reconciliação distribuída
sem coordenador" — três escritas independentes (ledger da execução, tabela `nota_debito_eletronica`
e leitura da fonte da verdade Conexos) precisam terminar coerentes, e o poll oficial em
`RecebimentoNumerarioService.etapaPoll` continua concorrendo pelo mesmo flag.

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Escritas de reconciliação envolvidas em transação | 0 / 2 | 2 / 2 (ou justificativa de policy) | ❌ | `RecebimentosPainelService.ts:297-302` |
| Escritas de reconciliação com log de falha | 0 / 2 | 2 / 2 | ❌ | `RecebimentosPainelService.ts:297-302` (dois `.catch(() => undefined)` sem `logService`) |
| `LogService` injetado no serviço que agora faz escrita | 0 (não injeta) | injetado | ❌ | construtor em `RecebimentosPainelService.ts:109-120` — 7 deps, nenhuma é `LogService` |
| Comparação com serviço-irmão que faz o MESMO poll SEFAZ | `RecebimentoNumerarioService` injeta `LogService` e emite `warn` em falha de reconciliação análoga | paridade | ❌ | `RecebimentoNumerarioService.ts:257` + `marcarTransacaoProcessada:504-513` |
| Idempotência da escrita local repetida (mesmo `key`, mesma resposta ERP) | idempotente por natureza (`UPDATE ... SET x=$v`); guard `numeroNde !== nde.numeroNde` antes do 2º UPDATE | idempotente | ✅ | `RecebimentosPainelService.ts:298-302` + `NdeRepository.ts:117-124` |
| Idempotência entre poll do painel × `etapaPoll` (writer) | ambos escrevem o mesmo valor (`true`) sob a mesma condição (`vldAutorizado != 0`); último-a-escrever-vence é seguro | 0 divergência | ✅ | `RecebimentosPainelService.ts:286-297` × `RecebimentoNumerarioService.ts:1573-1575` |
| Escritas com trilha de "quem/quando" (auditoria) | apenas `atualizado_em=now()`; sem `executado_por` no path do painel | who + when + what persistidos | ⚠️ | `SolicitacaoNumerarioExecucaoRepository.ts:186-193` (`setNdeAutorizado` não recebe ator) |
| Cap de blast-radius por load (rajada ao ERP) | `PAINEL_NDE_HIDRATACAO_CAP` + lote `PAINEL_NDE_HIDRATACAO_LOTE` | cap presente | ✅ | `RecebimentosPainelService.ts:250-265` |
| Timeout no `fiscalClient.lerDocParaPolling` | herdado do `ConexosNdeFiscalClient` (não medido neste delta) | 100% dos externos | ⚠️ | não medível localmente sem inspecionar o client; ver qa-availability/performance |
| Cobertura de teste do caminho reconciliação | happy path + ERP fora + cap testados; **falha isolada de `setNdeAutorizado`** e **falha isolada de `updateNumeroNde`** não são testadas | ≥ 1 teste por transição parcial | ⚠️ | `RecebimentosPainelService.test.ts:200-240` |

> ⚠️ **Não medível localmente**: taxa real de divergência em produção. Requer telemetria no painel
> (contador `nde_reconciliation_write_failed_total`) + query `SELECT count(*) FROM solicitacao_numerario_execucao e LEFT JOIN nota_debito_eletronica n ON n.idempotency_key=e.idempotency_key WHERE e.nde_autorizado=true AND (n.id IS NULL OR n.numero_nde IS NULL)` em janela recente. Recomendação: instrumentar antes de mergear.

## 3. Tactics — Cobertura no nf-projects

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Substitution | N/A no delta — sem componente redundante substituível | N/A | — |
| Replacement | N/A no delta | N/A | — |
| Predictive Model | N/A | N/A | — |
| Increase Competence Set | N/A no delta | N/A | — |
| Sanity Checking | `vldAutorizado === 0` tratado como "SEFAZ ainda não respondeu" (não como falha) — sanidade do domínio existe | ✅ presente | `RecebimentosPainelService.ts:285-286` |
| Comparison | Nenhuma comparação entre o que o painel escreveu vs o que `etapaPoll` já havia escrito — os dois writers coexistem sem checar consistência | ⚠️ parcial | ambos escrevem o mesmo `true`, então a comparação não é necessária para correção — mas não há verificação explícita |
| Timestamp | `atualizado_em = now()` em cada UPDATE preserva ordem parcial | ✅ presente | `SolicitacaoNumerarioExecucaoRepository.ts:189` |
| Timeout | delegado ao `ConexosNdeFiscalClient` (não observado no delta) | ⚠️ parcial | cross-ref qa-performance |
| Condition Monitoring | **quebrada** neste caminho: `.catch(() => undefined)` em duas escritas sem `logService`; o serviço nem injeta `LogService` | ❌ ausente | `RecebimentosPainelService.ts:297,301` + construtor `:109-120` |
| Self-Test | Nenhuma checagem periódica de rows com `nde_autorizado=true` sem `numero_nde` gravado — divergência pode permanecer indefinidamente | ❌ ausente | Grep confirma que não há job reaper para o pipeline NDe |
| Voting | N/A (fonte da verdade é o ERP, sem quorum) | N/A | — |
| Redundancy | `etapaPoll` no writer + hidratação no painel são redundantes (dois caminhos que escrevem `nde_autorizado`) — funciona como redundância de detecção | ✅ presente (efeito colateral) | `RecebimentoNumerarioService.ts:1573-1575` × `RecebimentosPainelService.ts:297` |
| Recovery (forward) | Doutrina "best-effort — falhar aqui só adia a reconciliação para o próximo load" declarada no comentário `:295-296` — recovery para frente É a política deliberada | ⚠️ parcial | declarada em comentário; **quebra em um cenário concreto** (F-fault-tolerance-1) — a linha sai da lista de candidatas e nunca mais é reconciliada |
| Recovery (backward) | Nenhum rollback entre as duas escritas | ❌ ausente | não há `BEGIN/COMMIT/ROLLBACK` em `hidratarUma` |
| Reintroduction (Shadow / State Resync / Escalating Restart) | N/A no delta | N/A | — |
| Rollback | Ausente entre `setNdeAutorizado` e `updateNumeroNde` — pode ficar meio commit meio não | ❌ ausente | `RecebimentosPainelService.ts:297-302` |
| Repair State | `updateNumeroNde` é `UPDATE` puro (não `INSERT ... ON CONFLICT`); em linha órfã (execução com `nd_doc_cod` set mas sem row em `nota_debito_eletronica`) o UPDATE afeta 0 rows e o flag `nde_autorizado=true` é gravado assim mesmo — divergência permanente | ❌ ausente | `NdeRepository.ts:117-124` + `PAINEL_FROM_WHERE:22-27` (a lista INCLUI rows sem `n.id`) |
| Idempotent Replay | Reprocessar a mesma linha N vezes é seguro (mesmo `key`, escritas idempotentes por natureza) | ✅ presente | `NdeRepository.ts:117-124` + `SolicitacaoNumerarioExecucaoRepository.ts:186-193` |
| Compensating Transaction | Nenhuma — mas o writer também não desfaz na etapaPoll; policy declarada é forward-only | ⚠️ parcial | consistente com o resto do domínio |
| Reconcile | ESTA é a tática que o delta introduz — mas ela mesma tem os buracos das linhas acima | ⚠️ parcial | `RecebimentosPainelService.ts:247-304` |
| Quarantine | Linhas em `error` ficam no ledger com `erro_mensagem` para o painel destacar — quarantine implícita existe upstream | ✅ presente (upstream) | `SolicitacaoNumerarioExecucaoRepository.ts:250-271` |

## 4. Findings (achados)

### F-fault-tolerance-1: Reconciliação em duas escritas SEM transação — falha do 2º UPDATE gera divergência permanente

- **Severidade**: P1 (alto — quebra a promessa de "no próximo load a gente reconcilia")
- **Tactic violada**: Rollback / Recovery (forward)
- **Localização**: `src/backend/domain/service/recebimentos/RecebimentosPainelService.ts:297-302`
- **Evidência (objetiva)**:
  ```typescript
  // Escrita LOCAL de reconciliação (nada vai para o ERP): o painel é o poll que a homologação
  // não pôde esperar. Best-effort — falhar aqui só adia a reconciliação para o próximo load.
  await this.execucaoRepo.setNdeAutorizado(nde.idempotencyKey, true).catch(() => undefined);
  if (numeroNde !== undefined && numeroNde !== nde.numeroNde) {
      await this.ndeRepo
          .updateNumeroNde(nde.idempotencyKey, numeroNde)
          .catch(() => undefined);
  }
  ```
  Combinado com o filtro de candidatas em `:250-252`:
  ```typescript
  const candidatas = ndes
      .filter((n) => n.ndDocCod !== undefined && n.ndeAutorizado !== true)
  ```
- **Impacto técnico**: se `setNdeAutorizado` grava OK e `updateNumeroNde` falha (glitch de rede/DB entre os dois UPDATEs), a próxima leitura verá `nde_autorizado=true` no ledger — e o filtro `ndeAutorizado !== true` **exclui a linha da próxima hidratação**. O `numero_nde` local nunca é preenchido; o comentário "só adia para o próximo load" é falso neste ramo. Reconciliação parcial permanente.
- **Impacto de negócio**: NDe autorizada pela SEFAZ que aparece sem número na tela do analista (ou com número desatualizado); o analista pode achar que precisa reprocessar e/ou abrir chamado; auditoria fiscal em risco de divergência entre "o que a Columbia mostra" e "o que a SEFAZ tem".
- **Métrica de baseline**: 0 escritas de reconciliação estão envolvidas em transação (0/2); 0 testes cobrem a transição parcial.

### F-fault-tolerance-2: `.catch(() => undefined)` engole falha SEM `logService.warn` — Condition Monitoring cega

- **Severidade**: P1 (alto — impossibilita detectar degradação da reconciliação)
- **Tactic violada**: Condition Monitoring
- **Localização**: `src/backend/domain/service/recebimentos/RecebimentosPainelService.ts:297,301` (dois pontos) e `:195-197,281-282,315-317` (padrão sistêmico neste serviço)
- **Evidência (objetiva)**:
  ```typescript
  await this.execucaoRepo.setNdeAutorizado(nde.idempotencyKey, true).catch(() => undefined);
  ...
  await this.ndeRepo.updateNumeroNde(nde.idempotencyKey, numeroNde).catch(() => undefined);
  ```
  Construtor do serviço em `:109-120` — 7 dependências, `LogService` **não está** entre elas. Contraste com o serviço-irmão `RecebimentoNumerarioService` que faz o MESMO poll SEFAZ (`etapaPoll:1564-1585`) e usa `logService.warn` para toda falha de reconciliação (ex.: `marcarTransacaoProcessada:504-513`).
- **Impacto técnico**: se o Postgres degrada e 100% das escritas de reconciliação começam a falhar, ninguém vê. O painel continua servindo dados aparentemente "corretos" (as escritas são best-effort e a leitura funciona), mas a reconciliação é 0%. Sem sinal em log, o incidente vira "por que o número não atualiza?" pego por um analista dias depois. É a mesma doutrina de "log-and-continue" que o `RecebimentoNumerarioService.marcarTransacaoProcessada` já pratica corretamente; o painel a violou.
- **Impacto de negócio**: MTTR de qualquer regressão neste caminho passa a depender de reclamação humana; SLO de "reconciliação em N loads" não é observável.
- **Métrica de baseline**: 0 / 2 escritas emitem log em falha; 0 métricas/contadores instrumentados; 0 de 7 dependências do serviço é `LogService`.

### F-fault-tolerance-3: `updateNumeroNde` é UPDATE puro — em linha órfã (execução com `nd_doc_cod` sem NDe local) grava 0 rows e `derivarStatusEmissao` mente

- **Severidade**: P1 (alto — falso "pendente"/"erro" para NDe realmente autorizada)
- **Tactic violada**: Repair State
- **Localização**:
  - `src/backend/domain/repository/recebimentos/NdeRepository.ts:117-124` (`UPDATE ... WHERE idempotency_key=$key` — sem `INSERT ... ON CONFLICT`)
  - `src/backend/domain/repository/recebimentos/NdeRepository.ts:22-27` (o `PAINEL_FROM_WHERE` INCLUI linhas sem `n.id`: `e.nd_doc_cod IS NOT NULL OR n.id IS NOT NULL`)
  - `src/backend/domain/repository/recebimentos/NdeRepository.ts:130-136` (`derivarStatusEmissao`: `temNde=false` sempre devolve `pendente` ou `erro`, **ignora `nde_autorizado`**)
- **Evidência (objetiva)**:
  ```typescript
  // NdeRepository.ts:117-124
  public updateNumeroNde = async (idempotencyKey: string, numeroNde: string): Promise<void> => {
      await this.databaseClient.update(
          `UPDATE nota_debito_eletronica
              SET numero_nde = $numeroNde
            WHERE idempotency_key = $idempotencyKey`,
          { idempotencyKey, numeroNde },
      );
  };

  // NdeRepository.ts:130-136
  private derivarStatusEmissao = (r, temNde: boolean): NdeStatusEmissao => {
      if (temNde) return (r.status_emissao as NdeStatusEmissao) ?? NDE_STATUS_EMISSAO.EMITIDA;
      return r.exec_status === 'error' ? NDE_STATUS_EMISSAO.ERRO : NDE_STATUS_EMISSAO.PENDENTE;
  };
  ```
- **Impacto técnico**: cenário concreto — `RecebimentoNumerarioService.rodarEtapas` chega em `etapa='nota-debito'` (grava `nd_doc_cod`) e falha na etapa fiscal seguinte antes do `ndeRepository.save` em `:1535`. A linha existe no `solicitacao_numerario_execucao` com `nd_doc_cod` set e `status='error'`, e **não há row correspondente** em `nota_debito_eletronica`. O painel a inclui (LEFT JOIN em `PAINEL_FROM_WHERE`). `hidratarUma` faz o GET no com297; SEFAZ diz `vldAutorizado=1`. `setNdeAutorizado(key, true)` grava OK. `updateNumeroNde(key, "000123")` executa `UPDATE` que afeta **0 rows** (não existe row com essa `idempotency_key`). `derivarStatusEmissao` com `temNde=false` + `exec_status='error'` devolve `'erro'`. UI mostra "erro" apesar do SEFAZ ter autorizado. Ainda pior: como `nde_autorizado=true` agora, a linha **sai** do filtro de candidatas (F-fault-tolerance-1) e nunca é revisitada.
- **Impacto de negócio**: NDe emitida no ERP e autorizada pela SEFAZ mostrada como "erro" ao analista, que reprocessa, gera SN duplicada, retrabalho contábil. É o mesmo tipo de risco de "state consistency under partial failure" que fundamenta a escolha de Fault Tolerance como QA.
- **Métrica de baseline**: hoje 0 checagem de "row exists" antes do UPDATE; 0 teste cobre execução em `error`/`homologado` com `nd_doc_cod` set e sem NDe local.

### F-fault-tolerance-4: Ausência de trilha de "quem/quando" na reconciliação disparada pelo painel

- **Severidade**: P2 (médio — auditoria degradada, não breakage funcional)
- **Tactic violada**: Timestamp / audit-trail (invariante do projeto)
- **Localização**: `src/backend/domain/repository/recebimentos/SolicitacaoNumerarioExecucaoRepository.ts:186-193`
- **Evidência (objetiva)**:
  ```typescript
  public setNdeAutorizado = async (key: string, autorizado: boolean): Promise<void> => {
      await this.databaseClient.update(
          `UPDATE solicitacao_numerario_execucao
              SET nde_autorizado = $autorizado, atualizado_em = now()
           WHERE idempotency_key = $key`,
          { key, autorizado },
      );
  };
  ```
  Contraste: `beginExecution:78-124` grava `executado_por`; a reconciliação pelo painel não sabe quem disparou o GET (o ator existe em `req.user`, mas o serviço nem o recebe).
- **Impacto técnico**: quando surgir divergência real ("por que a NDe X virou autorizada às 14:22?"), a única evidência será `atualizado_em`. Não há como distinguir "poll do writer" de "reconciliação de painel disparada pela analista Beatriz" — dois caminhos de código escrevendo o MESMO campo com semânticas ligeiramente diferentes.
- **Impacto de negócio**: auditoria fiscal/contábil sobre "quando e por que a Columbia considerou esta NDe autorizada" fica ambígua.
- **Métrica de baseline**: 0 caminhos do painel gravam `executado_por` na reconciliação; 1/1 caminho do writer grava (paridade quebrada).

## 5. Cards Kanban

### [fault-tolerance-1] Envolver as duas escritas de reconciliação em transação + tratar linha órfã

- **Problema**
  > `hidratarUma` grava `nde_autorizado=true` e `numero_nde` em duas UPDATEs sem transação; se a segunda falha, a linha sai do filtro de candidatas e a divergência é permanente. Além disso, o segundo UPDATE afeta 0 rows quando não existe NDe local (execução em `error` com `nd_doc_cod`), e a UI passa a mentir "erro" para NDe realmente autorizada.

- **Melhoria Proposta**
  > Introduzir um método único no repositório (ex.: `reconciliarAutorizacao(key, {autorizado, numeroNde})`) que faça as duas escritas em UMA transação com `BEGIN/COMMIT` via `PostgreeDatabaseClient.transaction()` (ou implementar o helper caso ainda não exista). No `NdeRepository`, trocar `updateNumeroNde` por um `UPSERT` limitado a rows órfãs conhecidas — ou (mais simples e conservador) só marcar `nde_autorizado=true` no ledger QUANDO o UPDATE do número afetou ≥ 1 row OU a NDe local já existia. Aplica Rollback + Repair State (Bass).

- **Resultado Esperado**
  > Zero rows com `nde_autorizado=true` sem `numero_nde` correspondente (na presença de `docEspNumero` retornado pelo ERP). Métrica: `SELECT count(*) FROM solicitacao_numerario_execucao e LEFT JOIN nota_debito_eletronica n ON n.idempotency_key=e.idempotency_key WHERE e.nde_autorizado=true AND (n.id IS NULL OR n.numero_nde IS NULL)` → 0 → 0.

- **Tactic alvo**: Rollback + Repair State
- **Severidade**: P1
- **Esforço estimado**: M (2–5d) — inclui helper `transaction()` se ainda não existe + teste de falha isolada de cada UPDATE
- **Findings relacionados**: F-fault-tolerance-1, F-fault-tolerance-3
- **Métricas de sucesso**:
  - Escritas de reconciliação em transação: 0/2 → 2/2
  - Testes cobrindo transição parcial (`setNdeAutorizado` OK + `updateNumeroNde` falha): 0 → ≥ 1
  - Linhas com `nde_autorizado=true` sem `numero_nde` (em ambiente com `docEspNumero` disponível): permanente → 0
- **Risco de não fazer**: em 6 meses, com N loads/dia, algumas rows vão travar em "autorizado sem número" ou "erro fantasma"; auditoria fiscal vira caça ao fantasma.
- **Dependências**: nenhuma (o `PostgreeDatabaseClient` já pool-a conexão; falta expor `transaction()` se ausente)

### [fault-tolerance-2] Injetar `LogService` em `RecebimentosPainelService` e emitir `warn` em toda falha de reconciliação

- **Problema**
  > O serviço não injeta `LogService` e usa `.catch(() => undefined)` em 4 pontos (linhas 195, 281, 297, 301). Se o Postgres/Conexos degradar, a reconciliação vira 0% sem sinal em log. O serviço-irmão `RecebimentoNumerarioService` já pratica a doutrina correta (`marcarTransacaoProcessada:504-513`); o painel a rompeu.

- **Melhoria Proposta**
  > Adicionar `@inject(LogService)` no construtor. Substituir os `catch(() => undefined)` por `catch((err) => { void this.logService.warn({ type: LOG_TYPE.BUSINESS_WARN, message: '...', error: err, data: {...} }); })` — mesma frase que o comentário do código promete ("só adia para o próximo load") vai virar log observável. Adicionar contador para a hidratação: `nde_reconciliation_write_failed_total` (rótulo: `write=setNdeAutorizado|updateNumeroNde`). Aplica Condition Monitoring (Bass).

- **Resultado Esperado**
  > Toda falha de reconciliação vira 1 linha de log estruturado (com `idempotencyKey`, `ndDocCod`, `filCod`); dashboard consegue plotar taxa de falha.

- **Tactic alvo**: Condition Monitoring
- **Severidade**: P1
- **Esforço estimado**: S (≤ 1d)
- **Findings relacionados**: F-fault-tolerance-2
- **Métricas de sucesso**:
  - Escritas com log de falha: 0/2 → 2/2
  - Pontos de `.catch(() => undefined)` no serviço: 4 → 0
  - Cobertura por teste do log em falha: 0 → 1 (por catch)
- **Risco de não fazer**: primeiro incidente de reconciliação silenciosa só vira ticket quando o cliente reclamar do dashboard; MTTR é indefinido.
- **Dependências**: —

### [fault-tolerance-3] Reaper periódico para linhas em divergência SEFAZ × local

- **Problema**
  > Mesmo com [fault-tolerance-1] fechado, um reprocesso disparado por navegador só cobre linhas que o analista ATIVAMENTE olha. Rows fora da janela do painel (por cap, por filtro, por analista de férias) podem ficar em `nde_autorizado=false` local mesmo com SEFAZ tendo autorizado há dias.

- **Melhoria Proposta**
  > Job EventBridge diário (`nde-reconciliation-reaper`) que varre `solicitacao_numerario_execucao WHERE etapa IN ('homologado','concluido') AND nde_autorizado=false AND nd_doc_cod IS NOT NULL AND atualizado_em < now() - interval '2 hours'`, chama `com297` e reaplica a reconciliação (o MESMO método do card 1). Cap por batch. Aplica Self-Test (Bass) — a stuck-state reaper que o mission-brief item 8 exige.

- **Resultado Esperado**
  > MTTR de "SEFAZ autorizou mas nosso banco não sabe" cai de "próximo painel do analista" (indefinido) para ≤ 24h.

- **Tactic alvo**: Self-Test / Sanity Checking
- **Severidade**: P1
- **Esforço estimado**: M (2–5d) — inclui o `EventBridgeLambdaHandler` (ainda que hoje rode em Express, pode ser um endpoint interno com cron do Render ou um `RetryExecutor` agendado)
- **Findings relacionados**: F-fault-tolerance-1, F-fault-tolerance-3 (redundância defensiva contra o mesmo cenário)
- **Métricas de sucesso**:
  - Rows com `nde_autorizado=false` e `homologado` há mais de 24h: baseline → 0
  - Presença de reaper: ausente → presente
- **Risco de não fazer**: divergência acumula silenciosamente entre carteiras; em 6 meses, "quantas NDes autorizadas SEFAZ estão fora de sincronismo local" vira uma migração de dados manual.
- **Dependências**: [fault-tolerance-1] (para não amplificar o bug via reaper)

### [fault-tolerance-4] Registrar `executado_por` (ou marcador `source=painel-poll`) na reconciliação pelo painel

- **Problema**
  > `setNdeAutorizado` só grava `atualizado_em`; a auditoria fiscal não consegue distinguir "poll oficial do writer" de "reconciliação disparada por load do painel". A invariante de audit-trail do projeto ("who, when, what") está parcialmente atendida.

- **Melhoria Proposta**
  > Estender a assinatura para `setNdeAutorizado(key, autorizado, { source, ator })` — `source` como enum (`writer-poll` | `painel-hydrate` | `reaper`); persistir em coluna própria (ex.: `nde_autorizado_source`) ou numa tabela de eventos apartada. Serviço do painel passa `req.user` como `ator`; writer passa `ctx.ator`. Aplica invariante audit-trail (cross-QA Security).

- **Resultado Esperado**
  > Toda transição de `nde_autorizado=false→true` tem quem/quando/como registrados.

- **Tactic alvo**: Timestamp / audit-trail
- **Severidade**: P2
- **Esforço estimado**: S (≤ 1d) — 1 migração de coluna + 3 callsites
- **Findings relacionados**: F-fault-tolerance-4
- **Métricas de sucesso**:
  - Callsites de `setNdeAutorizado` sem `source`: 2/2 → 0/2
  - Coluna de source presente: ausente → presente
- **Risco de não fazer**: primeira auditoria contábil vira arqueologia de log; retrabalho de compliance.
- **Dependências**: alinhado com invariantes de audit-trail do proposto (cross-ref qa-security)

## 6. Notas do agente

- Escopo restrito ao DELTA (o endpoint que virou read+write); pré-existências como o pattern `.catch(() => undefined)` em `enriquecerComModalidade:195-197` e `construirIndicePrevisao:315-317` são contextuais e reforçam F-fault-tolerance-2, mas não geram cards separados.
- Não medível localmente: taxa real de falha das escritas de reconciliação (precisa CloudWatch/métrica). Recomendação embutida em [fault-tolerance-2].
- Cross-QA: (a) idempotência e timeout do `fiscalClient` — cross-ref qa-availability e qa-performance. (b) audit-trail com `executado_por`/`source` — cross-ref qa-security (auditabilidade). (c) teste da transição parcial (`setNdeAutorizado` OK, `updateNumeroNde` falha) e teste da linha órfã sem NDe local — cross-ref qa-testability.
- Item positivo digno de menção: idempotência de replay entre painel × `etapaPoll` foi resolvida de forma limpa (ambos escrevem o mesmo `true` sob mesma condição) — não é um card, é uma decisão bem tomada.
