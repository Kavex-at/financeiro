---
qa: Fault Tolerance
qa_slug: fault-tolerance
run_id: 2026-09-22-2020-sispag-data-pagamento
agent: qa-fault-tolerance
generated_at: 2026-09-22T23:15:00-03:00
scope: backend + frontend (delta, --quick)
score: 8.5
findings_count: 3
cards_count: 3
---

# Fault Tolerance — Regis-Review

## 1. Cenário Geral (Bass General Scenario aplicado ao Financeiro)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Analista clica "Gerar remessa" com uma data de débito escolhida | `POST /sispag/lotes/:id/remessa` cai num timeout/queda de processo entre o `criarLote` (fin015, escrita NÃO-idempotente) responder e o `RemessaService` persistir `nativeFlpCod` | `RemessaService.gerarRemessaSerializado`, `lote_pagamento.data_debito`, `remessa_execucao` (ledger write-ahead) | Produção, escrita real habilitada (`sispagLiveWriteEnabled=true`), analista reabre o lote e tenta de novo | O sistema NUNCA cria um segundo lote nativo pago quando o primeiro pode ter valado; quando não consegue determinar o estado real do ERP, falha fechado (`RemessaEmDuvidaError`/`DebitDateFrozenError`) em vez de repetir a escrita | 0 lotes nativos duplicados COM títulos importados por retomada; toda ambiguidade vira exceção auditável, nunca um retry cego |

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| `data_debito` persistida ANTES do `criarLote` (write-ahead) | Sim, ordem afirmada por teste (`ordemPersistir < ordemCriar`) | Persistência ANTES de qualquer POST não-idempotente | ✅ | `RemessaService.ts:454-466`; `RemessaService.test.ts:1233-1261` |
| Cenários de "data congelada" (I8b) cobertos por teste | 8 `it`/`it.each` distintos (diferente, mesma, sem data, no_passado×3 variantes de retomada, gerar_remessa já passou do vencimento) | ≥1 teste por transição do estado congelado | ✅ | `RemessaService.test.ts:1264-1420` |
| Assinatura da marca d'água inclui `dataDebito` (não só `ccoCod`) | Sim, mesmo epoch (`toErpEpoch`) gravado no ledger e comparado em `adotarPorMarcaDagua` | Assinatura precisa o bastante para não adotar lote errado | ✅ | `RemessaService.ts:454-459` (grava), `RemessaService.ts:860-861` (compara); `RemessaService.test.ts:331-345` |
| Fail-closed quando a marca d'água não existe (execução anterior ao mecanismo) | `RemessaEmDuvidaError`, `criarLote` NÃO chamado | Nunca repetir escrita sem evidência do ERP | ✅ | `RemessaService.test.ts:496-508` |
| Detecção de órfão cobre `status='error'` sem `nativeFlpCod` (não só `reconciling`) | Não — retomada de `error` sem `nativeFlpCod` chama `criarLote` direto, sem checar `listarLotesNativos`/marca | 100% dos casos sem `nativeFlpCod` passam por checagem de órfão antes de criar | ⚠️ (pré-existente, não introduzido nesta delta) | `RemessaService.test.ts:796-801` (`write.criarLote` chamado 1×, sem checagem); `RemessaExecucaoRepository.ts:124-136` (`listReconcilingParadas` filtra só `WHERE status='reconciling'`) |
| Teste dedicado ao filtro de `dataDebito` no candidato a órfão (mismatch) | Ausente — só o mismatch de `ccoCod` tem teste espelho | 1 teste por dimensão da assinatura (ccoCod, dataDebito, status, vazio) | ⚠️ | `RemessaService.test.ts:469-494` (ccoCod, existe) vs. nenhum equivalente para `dataDebito` |
| `setDataDebito` + `setRequestPayload` (marca d'água) na mesma transação DB | Não — dois `UPDATE`s sequenciais sem `tx` | Escrita-ahead atômica (ou fail-closed comprovado na janela, que já existe) | ⚠️ | `RemessaService.ts:454-459`; `LotePagamentoRepository.setDataDebito` e `RemessaExecucaoRepository.setRequestPayload` não compartilham `TransactionClient` |
| Rota `POST .../remessa` valida `dataDebito` antes de chamar o serviço | Zod `civilDateSchema` (formato + existência calendárica) | 100% dos campos de escrita financeira validados no boundary | ✅ | `routes/sispag.ts:422-455`; `routes/sispag.test.ts:555-586` |
| Erros de domínio (`DebitDateFrozenError`, `DebitDateOutsideWindowError`) mapeados para HTTP e para classes tipadas no frontend | Sim, 409/422 com `code` estável | Todo erro de domínio financeiro tem contrato de erro estável fim-a-fim | ✅ | `DebitDateFrozenError.ts:36,39`; `DebitDateOutsideWindowError.ts:67,70`; `lib/sispag.ts:492-497` |
| Frontend: `notify`/`toast` em toda falha de `gerarRemessa`, por tipo de erro | Sim — 5 ramos (`RemessaEmAndamentoError`, `LoteAnteriorCanceladoError`, `DebitDateOutsideWindowError`, `DebitDateFrozenError`, `RemessaEmDuvidaError`, `ErpPerguntaError`) + fallback genérico | Toda falha de escrita financeira gera feedback explícito, nunca silencioso | ✅ | `src/frontend/app/sispag/page.tsx:344-399` |
| Frontend: atualização otimista sem rollback no diálogo de data de débito | Nenhuma — estado só muda após `recarregarLotes()` pós-sucesso | 0 mutações otimistas sem caminho de rollback | ✅ N/A (não há otimismo a reverter) | `GerarRemessaDialog.tsx:143-147`; `page.tsx:329-340` |
| Migration `0061` aditiva, nullable, sem backfill, sem script de rollback | Conforme política (só exige reverse com `UPDATE` > 1.000 linhas) | Migration financeira reversível ou comprovadamente segura sem reverse | ✅ | `migrations/0061_lote_data_debito.sql`; `migrations/rollbacks/README.md:26-29` |
| Reaper de execuções presas (`reaper-sispag-reconciling`) tocado por esta delta | Não — arquivo intocado no diff | N/A (fora do escopo desta feature) | ⚠️ **Não medível como "desta delta"**: o reaper é pré-existente e cobre só `reconciling`; ver finding F-fault-tolerance-1 | `git diff origin/main...HEAD --stat -- src/backend/jobs/reaper-sispag-reconciling.ts` → vazio |

## 3. Tactics — Cobertura no nf-projects (aplicado a esta delta)

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| **Substitution** | N/A — não há componente redundante a substituir nesta escrita (ERP é fonte única de verdade por desenho) | N/A | — |
| **Replacement** | N/A — sem hot standby nesta camada | N/A | — |
| **Predictive Model** | N/A — não há previsão de falha; a "janela" (I8) é regra de negócio, não modelo preditivo de falha | N/A | — |
| **Increase Competence Set** | `BankingCalendar` centraliza o cálculo de "hoje BRT" e dia útil, eliminando a classe de bug do antigo `hojeUtc()` (pulava um dia após as 21h de Brasília) em TODOS os call-sites (serviço + 2 jobs) | ✅ presente | `BankingCalendar.ts:108-114`; `jobs/execute-fin015-prd.ts` e `jobs/validate-retomada-remessa-v1.ts` migrados no mesmo diff |
| **Sanity Checking** | Zod (`civilDateSchema`) no boundary HTTP; `DebitDateService.validate` (I8a) recusa data fora da janela ANTES de qualquer escrita | ✅ presente | `routes/sispag.ts:422-431`; `DebitDateService.ts:112-149` |
| **Comparison** | `adotarPorMarcaDagua` compara assinatura tripla (não estava na marca, `ccoCod`, `dataDebito`, vazio) contra o ERP antes de adotar um lote órfão | ✅ presente | `RemessaService.ts:855-861` |
| **Timestamp** | `remessa_execucao.atualizado_em` usado pelo reaper pré-existente para idade de `reconciling`; esta delta não adiciona timestamp novo | ⚠️ parcial (pré-existente, não estendido a `status='error'`) | `RemessaExecucaoRepository.ts:124-136` |
| **Timeout** | Fora do escopo desta delta (cliente HTTP do fin015 e `RetryExecutor` são pré-existentes, não tocados) — cross-ref `qa-performance`/`qa-availability` | N/A nesta delta | `git diff` não toca `ConexosBaseClient`/`RetryExecutor` |
| **Condition Monitoring** | Reaper pré-existente cobre `reconciling`; nenhuma monitoria nova cobre `error` sem `nativeFlpCod` (ver F-fault-tolerance-1) | ⚠️ parcial | `RemessaExecucaoRepository.listReconcilingParadas` |
| **Self-Test** | `jobs/validate-retomada-remessa-v1.ts` (fire-drill contra HML real) migrado para `BankingCalendar`, continua exercitando C1 (órfão sem flpCod), C2 (import parcial), C3 (remessa gerada sem settle) ao vivo | ✅ presente | `jobs/validate-retomada-remessa-v1.ts:37-63,295-341` |
| **Voting** | N/A — fonte única de verdade (ERP), sem quórum de réplicas | N/A | — |
| **Redundancy** | N/A — escrita única, não-idempotente por desenho do fin015; redundância ativa não se aplica | N/A | — |
| **Recovery — Forward** | `sincronizarComErp` pergunta ao ERP o estado real e retoma da etapa comprovada, sem repetir escritas já feitas; `resolverDataDebito` reusa a data congelada em vez de tentar "corrigir" o lote nativo | ✅ presente | `RemessaService.ts:675-817`, `RemessaService.ts:1047-1089` |
| **Recovery — Backward (Rollback)** | Não aplicável por escolha deliberada e documentada: o fin015 não expõe undo de `criarLote`; a saída é cancelar manualmente no fin015 (ver `DebitDateFrozenError` mensagem) | N/A — política explícita, não lacuna | `DebitDateFrozenError.ts:45-46`: "cancele o lote nativo flp X no fin015" |
| **Reintroduction** (Shadow/State Resync/Escalating Restart) | N/A — sem réplica a reintroduzir nesta camada | N/A | — |
| **Rollback** | Ver "Recovery — Backward" acima; dentro do Postgres local não há necessidade (nenhuma escrita local irreversível é feita antes do write-ahead) | N/A / ✅ coberto por write-ahead | — |
| **Repair State** | Auto-cura do ledger quando o ERP mostra que a remessa já foi concluída mas o `settle()` não rodou (`sync.etapa === 'concluido'`) | ✅ presente (pré-existente, exercitado pela nova data também) | `RemessaService.ts:253-260` |
| **Idempotent Replay** | Lock consultivo por `loteId` (`withAdvisoryLock`) + chave de idempotência curto-circuitando em `settled` | ✅ presente | `RemessaService.ts:141-153`, `210-232` |
| **Compensating Transaction** | N/A por desenho — forward recovery documentado substitui compensação (ver heurística da missão: Conexos não suporta undo limpo) | N/A — política explícita | Comentário `RemessaService.ts:100-107` ("POR QUE TANTA CERIMÔNIA") |
| **Reconcile** | `sincronizarComErp`/`listarChavesDoLote`/`getLoteNativo` perguntam ao ERP antes de qualquer decisão de retomada, inclusive para a data congelada | ✅ presente | `RemessaService.ts:675-817` |
| **Quarantine** | `RemessaEmDuvidaError` (409, `retryable:false`), `DebitDateFrozenError` (409), `DebitDateOutsideWindowError` (422) — todos fail-closed, exigem ação humana explícita | ✅ presente | `DebitDateFrozenError.ts:35-39`; `DebitDateOutsideWindowError.ts:66-70` |

## 4. Findings (achados)

### F-fault-tolerance-1: Retomada a partir de `status='error'` sem `nativeFlpCod` pula a checagem de órfão (marca d'água) — e agora também descarta silenciosamente a `data_debito` de uma tentativa anterior

- **Severidade**: P2
- **Tactic violada**: Condition Monitoring / Reconcile
- **Localização**: `src/backend/domain/service/sispag/RemessaService.ts:236-238` (checagem de sincronização só roda `if (anterior && !anterior.dryRun && anterior.status === 'reconciling')`), `RemessaService.ts:426-468` (ramo "else" cria lote direto quando `flpCod === undefined`, sem antes procurar candidato via `listarLotesNativos`+marca), `src/backend/domain/repository/sispag/RemessaExecucaoRepository.ts:192-212` (`fail()` grava incondicionalmente `status='error'`, inclusive para exceções de rede/timeout no `criarLote` onde o ERP pode ter processado a escrita)
- **Evidência (objetiva)**:
  ```ts
  // RemessaService.test.ts:796-801 (pré-existente, NÃO alterado por esta delta —
  // prova o comportamento atual, agora também relevante para I8):
  it('cria o lote quando não há nenhum de tentativa anterior', async () => {
      const ledger = buildLedger({ status: 'error', dryRun: false, etapa: 'criar_lote' });
      const write = buildWrite();
      await make({ ledger, write }).gerarRemessa({ loteId: 'L1', ator: 'u' });
      expect(write.criarLote).toHaveBeenCalledTimes(1); // sem checar órfão antes
  });
  ```
  ```sql
  -- RemessaExecucaoRepository.ts:124-136 — só varre `reconciling`:
  SELECT ... FROM remessa_execucao WHERE status = 'reconciling' AND atualizado_em < now() - ...
  ```
- **Impacto técnico**: um timeout de rede durante `write.criarLote` (escrita ÚNICA e NÃO-idempotente, per comentário do próprio client — `postGenericOnce`) cai no `catch` do `RemessaService` e vira `ledger.fail()` → `status='error'`. Na retomada seguinte, como o `nativeFlpCod` nunca foi persistido (a queda foi ANTES de `setNativeFlpCod`), o código NÃO passa pelo `sincronizarComErp`/`adotarPorMarcaDagua` (que só roda para `status='reconciling'`) e chama `criarLote` de novo direto. Se a primeira chamada tiver de fato "valido" no ERP (resposta perdida, escrita aplicada), fica um lote nativo vazio órfão no fin015, **nunca coberto pelo reaper** (que só varre `reconciling`). Com esta delta, cada nova tentativa também chama `loteRepo.setDataDebito` de novo — se a analista escolher uma data diferente na segunda tentativa (ou a janela sugerida mudar), a `data_debito` local passa a refletir só a tentativa mais recente, e o lote fantasma da primeira tentativa fica com uma data que não bate com nada rastreável.
- **Impacto de negócio**: o lote fantasma não move dinheiro sozinho (nasce vazio — títulos só entram no passo seguinte, que nunca roda para ele), então não é uma duplicação de pagamento. É, porém, sujeira crescente no fin015 que exige limpeza manual, e — o ponto relevante para esta feature — não há mais rastro local de QUAL data de débito aquele lote fantasma carrega, dificultando a auditoria/limpeza quando o volume de remessas aumentar.
- **Métrica de baseline**: 0% dos casos `status='error' AND native_flp_cod IS NULL` passam por checagem de órfão (100% dos casos `status='reconciling'` passam, por `sincronizarComErp`). Não introduzido por esta delta (arquitetura de retomada é da ADR-0039, revisada em `docs/regis-review/2026-08-25-1742-sispag-retomada/fault-tolerance.md`, findings F1/F4/F7 — nenhum idêntico a este); a delta amplia o efeito ao acoplar `data_debito` ao mesmo caminho não coberto.

### F-fault-tolerance-2: Filtro de `dataDebito` no candidato a órfão não tem teste dedicado (só o `ccoCod` irmão tem)

- **Severidade**: P3
- **Tactic violada**: Self-Test (cobertura de teste da tactic Comparison)
- **Localização**: `src/backend/domain/service/sispag/RemessaService.ts:855-861` (filtro `candidatos`, checa `ccoCod` e `dataDebito` simetricamente); `RemessaService.test.ts:469-494` (só o mismatch de `ccoCod` tem teste)
- **Evidência (objetiva)**:
  ```ts
  // RemessaService.ts:855-861 — os dois campos são checados simetricamente:
  const candidatos = lotes.filter(
      (l) =>
          !marca.has(l.flpCod) &&
          l.status === 0 &&
          l.titulosCount === 0 &&
          (payload?.ccoCod === undefined || l.ccoCod === payload.ccoCod) &&
          (payload?.dataDebito === undefined || l.dataDebito === payload.dataDebito),
  );
  ```
  Busca por `grep -n "OUTRA data\|data.*diferente.*marca" RemessaService.test.ts` não retorna nada; o teste espelho existente cobre só `ccoCod` (`'lote acima da marca com OUTRA conta não é candidato'`, linha 469).
- **Impacto técnico**: por inspeção, a implementação está correta e simétrica; o risco é de regressão futura (ex.: alguém remove o filtro de `dataDebito` num refactor) passar despercebido pela suíte.
- **Impacto de negócio**: baixo — é lacuna de rede de segurança, não defeito observado.
- **Métrica de baseline**: 1 de 2 dimensões da assinatura tem teste de mismatch dedicado (`ccoCod` sim, `dataDebito` não).

### F-fault-tolerance-3: `setDataDebito` + `setRequestPayload` (marca d'água) são dois `UPDATE`s sequenciais sem transação

- **Severidade**: P3
- **Tactic violada**: Rollback / Repair State (atomicidade da escrita-ahead)
- **Localização**: `src/backend/domain/service/sispag/RemessaService.ts:454-459`
- **Evidência (objetiva)**:
  ```ts
  await this.loteRepo.setDataDebito({ loteId: lote.id, dataDebito });          // UPDATE 1 (lote_pagamento)
  await this.ledger.setRequestPayload(key, {                                   // UPDATE 2 (remessa_execucao)
      marcaFlpCods: anteriores.map((l) => l.flpCod),
      ccoCod: escolhida.ccoCod,
      dataDebito: dataDebitoErp,
  });
  ```
  Nenhum dos dois métodos recebe/compartilha um `TransactionClient` aqui (ambos os repositórios suportam `tx` opcional para outros fluxos, ex. `LotePagamentoRepository.criarLote`).
- **Impacto técnico**: uma queda exatamente entre as duas escritas deixa `data_debito` persistida sem a marca d'água correspondente. O sistema já trata esse caso corretamente como fail-closed (teste `RemessaService.test.ts:496-508`, `RemessaEmDuvidaError`), então NÃO há duplicação de escrita — mas gera uma escalação para revisão humana que uma transação teria evitado.
- **Impacto de negócio**: aumento marginal de falsos-positivos "remessa em dúvida" (interrupção operacional evitável) na janela estreita entre as duas escritas; sem risco de dinheiro incorreto.
- **Métrica de baseline**: 0 das 2 escritas do write-ahead de criação compartilham transação (`grep -c "tx" nos dois call-sites` = 0); janela existe mas está coberta por fail-closed comprovado em teste.

## 5. Cards Kanban

### [fault-tolerance-1] Estender a checagem de órfão (marca d'água) para retomadas a partir de `status='error'` sem `nativeFlpCod`

- **Problema**
  > Uma queda de rede durante `write.criarLote` (escrita única, não-idempotente) grava `status='error'` no ledger via `RemessaExecucaoRepository.fail()`. Como a busca por lote órfão (`adotarPorMarcaDagua`) só roda dentro de `sincronizarComErp`, gated por `anterior.status === 'reconciling'` (`RemessaService.ts:238`), uma retomada a partir de `error` sem `nativeFlpCod` chama `criarLote` de novo sem nunca checar se a tentativa anterior já criou o lote no ERP — comprovado por `RemessaService.test.ts:796-801`, que hoje EXIGE `criarLote` chamado 1× sem checagem prévia.

- **Melhoria Proposta**
  > Unificar o ponto de entrada: sempre que `flpCodExistente === undefined` E o ledger anterior tiver `request_payload.marcaFlpCods` gravado (independente do `status` ser `reconciling` ou `error`), rodar a mesma lógica de `adotarPorMarcaDagua` antes de chamar `write.criarLote`. Em paralelo, estender a detecção (`RemessaExecucaoRepository`) com uma query irmã de `listReconcilingParadas` para `status='error' AND native_flp_cod IS NULL AND request_payload->>'marcaFlpCods' IS NOT NULL`, surfaced no mesmo painel/canal do reaper `reconciling`. Tactic Bass: **Reconcile** + **Condition Monitoring**.

- **Resultado Esperado**
  > 100% das retomadas sem `nativeFlpCod` passam por checagem de órfão antes de criar um lote novo (hoje: só as que estão em `reconciling`, ~50% dos casos possíveis por desenho atual). `RemessaService.test.ts:796-801` passa a asserir que `listarLotesNativos` é chamado antes de `criarLote` mesmo com `status='error'`.

- **Tactic alvo**: Reconcile / Condition Monitoring
- **Severidade**: P2
- **Esforço estimado**: M (2-5d)
- **Findings relacionados**: F-fault-tolerance-1
- **Métricas de sucesso**:
  - Cobertura de checagem de órfão por status do ledger: hoje `reconciling` apenas → alvo `reconciling` + `error` com marca gravada
  - Alertas de lote fantasma no painel operacional: hoje 0 (só aparecem via SQL manual) → alvo: mesmo canal do reaper `reconciling`
- **Risco de não fazer**: acúmulo silencioso de lotes vazios no fin015 a cada timeout de rede durante `criarLote`, sem qualquer sinal no sistema; com a `data_debito` agora escolhível pela analista, cada lote fantasma carrega uma data que ninguém mais consegue rastrear até o lote correto.
- **Dependências**: nenhuma.

### [fault-tolerance-2] Testar o mismatch de `dataDebito` no candidato a órfão (espelhar o teste de `ccoCod`)

- **Problema**
  > `adotarPorMarcaDagua` filtra candidatos por `ccoCod` E `dataDebito` (`RemessaService.ts:860-861`), mas só o mismatch de `ccoCod` tem teste dedicado (`RemessaService.test.ts:469-494`). O comportamento correto está implementado; falta a rede de segurança contra regressão.

- **Melhoria Proposta**
  > Adicionar um teste espelho: "lote acima da marca com a MESMA conta mas OUTRA data de débito não é candidato", seguindo exatamente o padrão do teste de `ccoCod` já existente. Tactic Bass: **Self-Test**.

- **Resultado Esperado**
  > 2 de 2 dimensões da assinatura de órfão (`ccoCod`, `dataDebito`) com teste de mismatch dedicado, em vez de 1 de 2.

- **Tactic alvo**: Self-Test
- **Severidade**: P3
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-fault-tolerance-2
- **Métricas de sucesso**:
  - Testes de mismatch da assinatura de órfão: 1/2 → 2/2
- **Risco de não fazer**: uma regressão futura no filtro de `dataDebito` (ex.: removido num refactor de `adotarPorMarcaDagua`) passaria despercebida pela suíte até se manifestar em produção como adoção de lote errado.
- **Dependências**: nenhuma.

### [fault-tolerance-3] Atomizar a marca d'água (`setDataDebito` + `setRequestPayload`) numa transação

- **Problema**
  > As duas escritas que compõem o write-ahead de criação de um lote nativo novo (`loteRepo.setDataDebito` em `lote_pagamento`, `ledger.setRequestPayload` em `remessa_execucao`) rodam como dois `UPDATE`s sequenciais sem `TransactionClient` compartilhado (`RemessaService.ts:454-459`). O sistema já é fail-closed nessa janela (`RemessaEmDuvidaError`, `RemessaService.test.ts:496-508`), mas cada queda exatamente ali gera uma escalação humana evitável.

- **Melhoria Proposta**
  > Envolver as duas escritas em `db.withTransaction`, passando o mesmo `tx` para `loteRepo.setDataDebito` e `ledger.setRequestPayload` — ambos os métodos já aceitam (ou podem aceitar, no caso do ledger) um `TransactionClient` opcional, padrão já usado em outros fluxos do mesmo repositório. Tactic Bass: **Rollback** (elimina a janela em vez de só detectá-la).

- **Resultado Esperado**
  > 0 janelas onde `data_debito` está persistida sem a marca d'água correspondente — a queda nesse ponto passa a não deixar rastro parcial, eliminando a classe de `RemessaEmDuvidaError` gerada especificamente por essa janela (hoje: existe e é fechada só por fail-closed).

- **Tactic alvo**: Rollback
- **Severidade**: P3
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-fault-tolerance-3
- **Métricas de sucesso**:
  - Escritas do write-ahead de criação compartilhando transação: 0/2 → 2/2
- **Risco de não fazer**: taxa marginal (mas não-zero) de `RemessaEmDuvidaError` evitáveis, cada uma exigindo intervenção humana para confirmar o que aconteceu no fin015.
- **Dependências**: nenhuma.

## 6. Notas do agente

- Escopo: revisão focada no que o run pediu — orquestração de escrita do fin015 em `RemessaService` (data de débito persistida antes do `criarLote`, congelamento em retomada, assinatura da marca d'água). Não reabri achados já cobertos por `docs/regis-review/2026-08-25-1742-sispag-retomada/fault-tolerance.md` (advisory lock, paginação de `listarLotesNativos`, transação `REMESSA_GERADA`+`settle`) que não são tocados por esta delta.
- Nenhum P0/P1 encontrado DENTRO desta delta: os fail-closed (`RemessaEmDuvidaError`, `DebitDateFrozenError`, `DebitDateOutsideWindowError`) e o write-ahead cobrem os caminhos de queda testados; o único gap arquitetural relevante (F-fault-tolerance-1) é pré-existente (ADR-0039) e amplificado apenas em termos de rastreabilidade de dado, não de duplicação de pagamento.
- Cross-QA: idempotência do `POST .../remessa` (chave derivada do lote) e timeouts do cliente `fin015` sobrepõem `qa-availability`/`qa-performance` — não medidos aqui por estarem fora do diff. O `remessa_execucao` como trilha de auditoria (quem/quando/o quê, via `ConexosIdentityProvider`) sobrepõe `qa-security` (auditabilidade). A cobertura de cenários de retomada por teste (`validate-retomada-remessa-v1.ts` como gate ao vivo) sobrepõe `qa-testability`.
