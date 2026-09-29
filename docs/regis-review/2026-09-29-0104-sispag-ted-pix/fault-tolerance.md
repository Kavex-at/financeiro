---
qa: Fault Tolerance
qa_slug: fault-tolerance
run_id: 2026-09-29-0104
agent: qa-fault-tolerance
generated_at: 2026-09-28T23:00:00-03:00
scope: backend
score: 7.5
findings_count: 4
cards_count: 3
---

# Fault Tolerance — Regis-Review

Modo --quick, escopo da feature `sispag-ted-pix`. Leitura estática, sem rede e sem chamar o Conexos. Não existe `infra/`, então filas SQS, DLQ e Lambda são N/A neste repo (o runtime é Express/Render).

## 1. Cenário Geral

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Analista SISPAG / cron de retomada | A remessa cai depois do `criarLote` e antes de gravar o `flpCod`, ou o destino do item muda entre a 1ª tentativa e a retomada | `RemessaService.gerarRemessaSerializado` + `prepararDestinos` + ledger `remessa_execucao` | Produção, ERP sem HML, flags TED/PIX/manual em go-live supervisionado | O destino é resolvido e conferido antes de qualquer escrita. A retomada fixa o destino ao que a tentativa anterior registrou. Divergência falha fechada com `DestinoCongeladoError` | 0 remessas duplicadas, 0 títulos enviados a destino diferente do 1º envio, 0 lotes nativos criados com item sem destino |

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Escritas ao ERP antecedidas por pré-voo de destino (TED/PIX ligados) | 1 de 1: `prepararDestinos` roda antes de `criarLote` | 100% | ✅ | `RemessaService.ts` (diff `origin/main...HEAD`) |
| Gravações de `request_payload` que carregam a assinatura de destinos (flags ligadas) | 4 de 4: marca d'água, import, nome do arquivo e `comDestinos` | 100% | ✅ | `RemessaService.ts` (diff, `comDestinos`) |
| Persistência de destino manual + trilha na mesma transação | Sim: `withTransaction` com `SELECT ... FOR UPDATE`, UPDATE, bump de versão e INSERT na trilha | 100% | ✅ | `LotePagamentoRepository.ts:520-575` |
| Trilha do destino só-inclusão | UPDATE/DELETE/TRUNCATE recusados (test:sql) | Sim | ✅ | `_shared-metrics.md` (30 testes SQL) |
| Freeze I10f com falha fechada | 2 de 2 caminhos de indeterminação lançam `DestinoCongeladoError(INDETERMINADO)` (`getLoteNativo` e `listarChavesDoLote`) | 100% | ✅ | `LotePagamentoService.ts`, `exigirNaoImportado` |
| Pin de destino na retomada quando a flag foi desligada entre tentativas | 0 de 1 cenário coberto: flags OFF devolvem o payload intacto e a assinatura some | 1 de 1 | ⚠️ | `RemessaService.ts`, `prepararDestinos` (1º `return`) |
| Assinatura ilegível ou ausente na retomada | Fail-open: `destinosDoLedger` devolve `undefined` e o destino é resolvido de novo | Fail-closed | ⚠️ | `RemessaService.ts`, `destinosDoLedger` |
| Leituras ao vivo sequenciais no pré-voo | 2 a 3 por item TED/PIX (`getTituloAPagar`, `listContas`, e `getDocumentoFavorecido` se manual), sem paralelismo | Limite de tempo por requisição | ⚠️ | `resolverDestinosAntesDaEscrita` (laço `for`) |
| Reaper de estado preso e reconciliação periódica contra o Conexos | Ausente como job agendado. A retomada é manual/sob demanda | Presente | ❌ PRE_EXISTING | `src/backend/jobs/`: sem scheduler (CLAUDE.md) |
| SQS/DLQ com handler | ⚠️ **Não medível localmente**: não existe infra/SQS neste repo. Recomendação: tratar ao migrar para Lambda | 100% | N/A | CLAUDE.md, tabela Estado Atual |

## 3. Tactics — Cobertura no nf-projects

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Substitution | N/A: não há componente redundante a substituir | N/A | Sem HML nem 2º ERP |
| Predictive Model | N/A: sem modelo de previsão de falha | N/A | n/a |
| Increase Competence Set | Destino digitado pela analista (manual) vira exceção tratada em vez de falha terminal | ✅ presente | `LotePagamentoService.definirDestinoManualItem` |
| Sanity Checking | Zod na assinatura do ledger, `DestinoManualValidator`, titularidade contra o CPF/CNPJ lido ao vivo, e validador CNAB do `.REM` (caso 8, só aviso) | ✅ presente | `assinaturaDestinoSchema`; `conferirTitularidade` |
| Comparison | O `.REM` é comparado com o que o lote mandou (TED/PIX); a titularidade compara o destino com o cadastro | ⚠️ parcial (CNAB só avisa até o teste supervisionado) | `cnab.validar(..., {ted,pix})` |
| Timestamp | Marca d'água e data de débito imutável (I8b) | ✅ presente | PRE_EXISTING, ampliado pelo delta |
| Timeout | Não verificado no delta, e o pré-voo adiciona N chamadas sequenciais | ⚠️ parcial | F-fault-tolerance-3 |
| Condition Monitoring | Sem monitor de ledger em `reconciling` | ❌ ausente PRE_EXISTING | n/a |
| Self-Test | Sonda supervisionada `probe-sispag-ted-pix-supervisionado.ts` (manual, somente leitura) | ⚠️ parcial | `src/backend/jobs/` |
| Voting | N/A: sem réplicas | N/A | n/a |
| Redundancy | N/A no escopo | N/A | n/a |
| Recovery (forward) | Retomada por evidência no ERP; ledger write-ahead; fail-closed no que não é verificável. Não há desfazer no Conexos, e a escolha de forward recovery está documentada em `retomada-remessa-sispag.md` | ✅ presente | `sincronizarComErp` |
| Reintroduction (State Resync) | `sincronizarComErp` relê o ERP antes de pular etapas. O delta acrescenta o pin de destino | ✅ presente | `aplicarFixado` |
| Rollback | N/A: escritas do fin015 não têm undo. O delta não escreve no ERP antes do pré-voo | N/A | ADR-0039 |
| Repair State | Reuso do lote nativo vazio, e `apenasChaves` importa só o que falta | ✅ presente | PRE_EXISTING |
| Idempotent Replay | Assinatura de destinos no `request_payload`, somente referências (`pctCodSeq`, `cixCod`, `auditId`), sem dado sensível | ✅ presente | `assinar` |
| Compensating Transaction | Forward recovery declarado: cancelar o lote nativo no fin015 é passo humano | ⚠️ parcial (documentado) | `retomada-remessa-sispag.md` |
| Reconcile | Só sob demanda. Sem job periódico Conexos versus DB | ❌ ausente PRE_EXISTING | n/a |
| Quarantine | `DestinoPagamentoAusenteError` devolve a lista inteira de itens sem destino para a analista, e nada é escrito | ✅ presente | `resolverDestinosAntesDaEscrita` |

## 4. Findings (achados)

O delta é bem construído para o princípio "verifica, não supõe". Não encontrei defeito crítico (P0). Os achados abaixo são lacunas de borda na retomada.

### F-fault-tolerance-1: O pin de destino se perde se as flags TED/PIX forem desligadas entre tentativas (IN_DELTA)

- **Severidade**: P2 (o cenário exige kill-switch acionado no meio de uma retomada. O go-live é supervisionado)
- **Tactic violada**: Idempotent Replay
- **Localização**: `src/backend/domain/service/sispag/RemessaService.ts`, `prepararDestinos`, 1º `return`
- **Evidência (objetiva)**:
  ```
  if (!o.flags.ted && !o.flags.pix) return { comDestinos: (payload) => payload };
  ```
  Com as flags OFF, `setRequestPayload` regrava o payload sem `destinos`. A retomada passa a resolver pela regra do `main` (conta ativa no banco do lote) e importa itens restantes sem conferir o destino já enviado.
- **Impacto técnico**: um lote parcialmente importado com destinos TED/PIX pode ter os itens restantes importados com destino diferente do enviado antes.
- **Impacto de negócio**: pagamento ao destino errado. É o pior caso do domínio, mas exige a combinação flag-off mais retomada parcial.
- **Métrica de baseline**: 0 testes cobrem "flags desligadas na retomada de lote com `destinos` no ledger". A verificação é estática. Não rodei o cenário.

### F-fault-tolerance-2: Assinatura ilegível ou ausente na retomada degrada para fail-open (IN_DELTA)

- **Severidade**: P2
- **Tactic violada**: Sanity Checking
- **Localização**: `RemessaService.ts`, `destinosDoLedger` e `prepararDestinos`
- **Evidência (objetiva)**:
  ```
  return parsed.success ? parsed.data : undefined;   // falha de parse => sem pin
  ```
  Quando há `flpCodExistente` mas o ledger não tem `destinos` (ledger gravado antes da flag, ou payload corrompido), `anteriores` fica `undefined` e o destino é resolvido de novo sem fixação. Além disso, numa retomada com `apenasChaves`, `assinatura` passa a ser só a dos itens que faltam. `setRequestPayload` substitui o payload e apaga a assinatura dos itens já importados.
- **Impacto técnico**: com o lote nativo já existente e itens já importados, a fixação vale só para o subconjunto. Uma 3ª tentativa não tem a referência dos itens já enviados.
- **Impacto de negócio**: enfraquece a garantia I10f "mesmo destino do 1º envio" em retomadas encadeadas.
- **Métrica de baseline**: 1 caminho de `safeParse` sem tratamento de falha. Assinatura parcial em 1 caminho (`apenasChaves`).

### F-fault-tolerance-3: O pré-voo faz leituras ao vivo sequenciais no Conexos antes de qualquer escrita (IN_DELTA)

- **Severidade**: P2
- **Tactic violada**: Timeout
- **Localização**: `RemessaService.ts`, `resolverDestinosAntesDaEscrita` e `destinoConferidoDoItem`
- **Evidência (objetiva)**: laço `for (const item of p.itens)` com `await getTituloAPagar` e, para destino manual, `getDocumentoFavorecido` (2 a 3 chamadas por item TED/PIX). Não há limite agregado nem paralelismo. O `cache` cobre só o resolver.
- **Impacto técnico**: um lote grande alonga a requisição HTTP que segura o serializador da remessa. Uma queda de rede no meio falha fechada (sem escrita), o que é seguro, mas lento.
- **Impacto de negócio**: retrabalho da analista. Sem risco financeiro, porque o pré-voo falha antes de escrever.
- **Métrica de baseline**: N x 2 a 3 chamadas sequenciais. Latência real ⚠️ não medível localmente.

### F-fault-tolerance-4: Não existe reaper de estado preso nem reconciliação periódica contra o Conexos (PRE_EXISTING)

- **Severidade**: P1
- **Tactic violada**: Condition Monitoring / Reconcile
- **Localização**: `src/backend/jobs/`. Não há scheduler (CLAUDE.md), e o ledger em `reconciling` só é tratado quando alguém reenvia.
- **Evidência (objetiva)**: um lote com `nativeFlpCod` gravado e sem `.REM` fica indefinidamente até a analista agir. A memória do projeto registra o caso "run com 0 títulos aparece como success" nos crons.
- **Impacto técnico**: itens presos mid-flow não geram alerta.
- **Impacto de negócio**: pagamento atrasado sem ninguém saber.
- **Métrica de baseline**: 0 jobs agendados de detecção de estado preso; o delta não agrava. Não confirmei se existe algum job manual equivalente entre os ~58 de `jobs/`.

## 5. Cards Kanban

### [fault-tolerance-1] Preservar a assinatura de destinos no ledger em toda gravação, com flags ligadas ou não

- **Problema**
  > Com as flags TED/PIX desligadas, `prepararDestinos` regrava o `request_payload` sem `destinos`. Numa retomada de lote parcialmente importado, o pin de destino some. Com a assinatura ilegível, `destinosDoLedger` degrada para "sem pin". Numa retomada com `apenasChaves`, a assinatura fica só com os itens que faltam.

- **Melhoria Proposta**
  > Em `comDestinos`, mesclar (não substituir) a assinatura existente do `anterior` com a nova, por chave de item. Quando houver `flpCodExistente` e o ledger anterior tiver `destinos`, mantê-los mesmo com flags OFF. Quando o ledger tiver `destinos` que falham no parse, falhar fechado com `DestinoCongeladoError(INDETERMINADO)`. Adicionar 3 testes: flag OFF na retomada, payload corrompido e retomada parcial encadeada.

- **Resultado Esperado**
  > O pin de destino sobrevive a qualquer sequência de retomadas. Testes de cenários de retomada com pin: 0 → 3.

- **Tactic alvo**: Idempotent Replay
- **Severidade**: P2
- **Esforço estimado**: S
- **Findings relacionados**: F-fault-tolerance-1, F-fault-tolerance-2
- **Métricas de sucesso**:
  - Caminhos de retomada que perdem o pin: 3 → 0
  - Testes de pin em retomada: 0 → 3
- **Risco de não fazer**: pagamento a destino diferente do 1º envio em retomada encadeada, depois de acionar o kill-switch.
- **Dependências**: nenhuma.

### [fault-tolerance-2] Limitar e paralelizar o pré-voo de destinos

- **Problema**
  > O pré-voo lê o Conexos item a item, em série, antes do `criarLote`. Um lote com dezenas de TED/PIX estende a requisição de envio. Não há limite agregado de tempo.

- **Melhoria Proposta**
  > Usar leituras com concorrência limitada (ex.: 5) e um teto de tempo total do pré-voo, expresso via `RetryExecutor`/`FallbackExecutor` (nunca `setTimeout`). Estourar o teto falha fechado, sem escrita.

- **Resultado Esperado**
  > Latência do pré-voo limitada e previsível. Chamadas sequenciais por lote: N x 2 a 3 → no máximo ceil(N/5) x 3 (medir em PRD supervisionado).

- **Tactic alvo**: Timeout
- **Severidade**: P2
- **Esforço estimado**: S
- **Findings relacionados**: F-fault-tolerance-3
- **Métricas de sucesso**:
  - Tempo do pré-voo para um lote de 30 itens: ⚠️ não medido → abaixo de 10 s (a validar)
- **Risco de não fazer**: timeouts do proxy em lotes grandes, que forçam retomadas sem necessidade.
- **Dependências**: nenhuma.

### [fault-tolerance-3] Criar reaper de lotes presos e reconciliação diária com o fin015

- **Problema**
  > Lote com `nativeFlpCod` e sem `.REM` (ou ledger em `reconciling`) só é tratado se a analista reenviar. Não há job que detecte a idade do estado nem que compare o que acreditamos ter enviado com o ERP.

- **Melhoria Proposta**
  > Job diário (o scheduler ainda não existe, então começar como script em `jobs/` com cron do GitHub Actions) que lista ledgers abertos há mais de N horas e lotes finalizados sem retorno, e os publica no painel de operação como bloqueados. Nunca reexecuta escrita, apenas sinaliza. Depois comparar `nativeFlpCod` contra `getLoteNativo` para detectar divergência.

- **Resultado Esperado**
  > Todo lote preso vira item visível em até 24 h. Jobs de detecção de estado preso: 0 → 1.

- **Tactic alvo**: Condition Monitoring / Reconcile
- **Severidade**: P1
- **Esforço estimado**: M
- **Findings relacionados**: F-fault-tolerance-4
- **Métricas de sucesso**:
  - Idade máxima de um lote preso sem alerta: ilimitada → 24 h
- **Risco de não fazer**: pagamentos atrasados sem ninguém notar, e o painel mostrando um estado que o ERP não confirma.
- **Dependências**: decisão sobre o scheduler (Render cron versus GitHub Actions). Ver a memória sobre os secrets Conexos dos crons desatualizados.

## 6. Notas do agente

- O ponto forte a registrar: o pré-voo roda antes de qualquer escrita, o pin usa só referências (I10h), o destino manual e a trilha estão na mesma transação sob `FOR UPDATE`, e o freeze I10f falha fechado. Por isso não classifiquei nada como P0.
- Não verifiquei se `ledger.fail` após falha do pré-voo altera o estado que `sincronizarComErp` usa numa retomada. É o mesmo caminho pré-existente de qualquer throw, mas vale um teste dedicado. Também não verifiquei o `timeout` do `ConexosSispagClient` (grep não achou a palavra).
- SQS, DLQ e Lambda são N/A: não existe infra. Cross-QA: timeouts se ligam a Availability/Performance. A trilha só-inclusão se liga a Security (auditabilidade). A cobertura de testes de retomada se liga a Testability.
