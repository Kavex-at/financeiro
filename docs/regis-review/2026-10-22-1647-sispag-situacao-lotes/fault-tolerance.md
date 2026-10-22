---
qa: Fault Tolerance
qa_slug: fault-tolerance
run_id: 2026-10-22-1647-sispag-situacao-lotes
agent: qa-fault-tolerance
generated_at: 2026-10-22T16:47:00-03:00
scope: all
score: 7
findings_count: 5
cards_count: 4
---

# Fault Tolerance — Regis-Review

## 1. Cenário Geral (Bass General Scenario aplicado ao nf-projects)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Analista clica "Finalizar os N lotes prontos" (bulk) ou "Finalizar" num card durante janela matinal de SISPAG | `fin064` lento, 503 pontual, fonte de contexto da situação cai, ou duplo clique / retry do navegador no POST `/finalizar` | `LotePagamentoService.finalizarLote` + `exigirSituacoesPagaveis.lerItensAoVivo` + `ProntidaoLoteService.comProntidao` + `prontidaoLotes.finalizarEmSequencia` | Produção multi-filial, Conexos sob carga (fechamento mensal), analista em pressão de prazo bancário | O lote recusa a finalização com motivo por item (sem retirar nada antes de bloquear), o CAS por `versao+status` barra duplo-POST, cada lote do bulk falha isolado e os demais seguem; a listagem degrada para "sem prontidão" se o contexto quebra | 0 lotes finalizados em duplicata; 0 itens retirados em lote que o guard-rail recusa; 100% dos lotes bulk reportados individualmente (ok/erro + mensagem); listagem continua carregando mesmo com fonte caída |

> Esta rodada é incremental: nenhuma fila SQS, nenhum write ao ERP, nenhuma remessa — o delta só adiciona guarda de leitura antes do gate e orquestração sequencial no cliente. O risco de "double-execution" aqui é o `finalizarLote` executando duas vezes para o mesmo lote (que o CAS por versão já contém) e o diálogo bulk sendo re-disparado (congelamento de `alvo` em `abrir()`).

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Serviços de escrita no delta com dedupe explícito (CAS `versao+status`) | 1/1 (`finalizarLote` → `transicionarStatus` em `LotePagamentoRepository`) | 1/1 | ✅ | `LotePagamentoService.ts:617-687`, `transicionar` em `:881-920` |
| Endpoints POST que mutam estado aceitando `Idempotency-Key` no header | 0/1 (`/sispag/lotes/:id/finalizar`) | 1/1 para rotas de escrita financeira | ⚠️ | `routes/sispag.ts:374-412` |
| Chamadas Conexos no caminho do finalize envolvidas em try/catch fail-closed | 1/1 (`.catch(() => undefined)` por item) | 1/1 | ✅ | `LotePagamentoService.ts:761-786` |
| Chamadas Conexos no caminho do finalize com timeout agregado (AbortController, deadline) | 0/N (sequenciais, bounded só pelo `runWithRetry` interno) | 1 orçamento por POST | ⚠️ | `LotePagamentoService.ts:761-786` |
| Caminhos de leitura degradáveis que capturam amplamente e logam WARN | 1/1 (`ProntidaoLoteService.comProntidao`) | 1/1 | ✅ | `ProntidaoLoteService.ts:33-66` |
| Trilha persistida (DB) para transições de lote no delta (`finalizar`, `exigirSituacoesPagaveis`) | 0 (só `logService.info` → `process.stdout.write`) | 100% das transições de dinheiro em tabela auditável | ⚠️ | `LogService.ts:19-27`; `LotePagamentoService.ts:945-955` |
| Bulk sequencial com containment por lote (falha de 1 não derruba os demais) | 1/1 (`finalizarEmSequencia` push de resultado individual, sem throw) | 1/1 | ✅ | `prontidaoLotes.ts:102-122` |
| Bulk sequencial com AbortSignal / botão "Parar" | 0 (diálogo bloqueia `fechar` enquanto `rodando`) | 1 abort path | ⚠️ | `FinalizarProntos.tsx:56-59`; `prontidaoLotes.ts:102-122` |
| Guarda que roda ANTES da verificação TED/PIX (não retira itens de um lote que vai ser recusado) | 1/1 (`exigirSituacoesPagaveis` antes de `verificacao.verificarItens`) | 1/1 | ✅ | `LotePagamentoService.ts:660-665` |

> ⚠️ **Não medível localmente**: SLA real do `fin064` sob carga (p50/p99) e taxa de 503 do Conexos num bulk de ~40 lotes. Requer CloudWatch ou run instrumentado contra tenant staging. Recomendação: medir no primeiro ciclo pós-deploy e ajustar o tamanho máximo defensivo do bulk (hoje sem teto no cliente).

## 3. Tactics — Cobertura no nf-projects

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Substitution / Replacement | N/A (sem redundância ativa; dependemos de uma instância Conexos por tenant) | N/A | — |
| Predictive Model | `ProntidaoLote` serve exatamente a esse papel: a listagem antecipa o que a finalização vai recusar sem tocar o Conexos | ✅ presente | `ProntidaoLoteResolver.ts:140-163` |
| Increase Competence Set | A guarda `exigirSituacoesPagaveis` cobre fail-closed `FORA_DA_CARTEIRA` e `LEITURA_FALHOU` (I19s) — amplia o escopo de "entrada tratada" | ✅ presente | `LotePagamentoService.ts:727-742`; `SituacaoPagamentoService.ts:185-230` |
| Sanity Checking | Zod no boundary da rota + `AVALIACAO_INCLUSAO` como discriminador; `BatchHasBlockedItemsError` carrega `rotulo/motivo` estruturados | ✅ presente | `routes/sispag.ts:199`; `BatchHasBlockedItemsError.ts:21-42` |
| Comparison | Optimistic lock `versao` + CAS por `status` no transicionar. Duas chamadas concorrentes de `finalizarLote` com mesma `versao` → só uma afeta linha, a outra levanta `LoteVersaoConflitoError`. Dedupe de fato | ✅ presente | `LotePagamentoService.ts:626-630, 881-917` |
| Timestamp | Não aplicável diretamente ao delta; `prontidao` é snapshot by-request | N/A | — |
| Timeout | Nenhum deadline agregado para o loop sequencial de `lerItensAoVivo` (N chamadas Conexos). O `runWithRetry` do client limita cada chamada, mas o POST inteiro não tem orçamento | ⚠️ parcial | `LotePagamentoService.ts:761-786` |
| Condition Monitoring | `fontesIndisponiveis[]` registrado por `avaliarGravados`/`avaliarVivos` e propagado para `ProntidaoLote.fontesIndisponiveis` — a tela sabe POR QUE a situação não foi avaliada | ✅ presente | `SituacaoPagamentoService.ts:84-101, 236-250`; `ProntidaoLoteResolver.ts:161` |
| Self-Test | Não aplicável ao delta (sem job de reconciliação novo) | N/A | — |
| Voting | N/A (sem réplica) | N/A | — |
| Redundancy | N/A (sem réplica) | N/A | — |
| Recovery - Rollback (backward) | Transição por CAS: se nenhuma linha for afetada o estado permanece RASCUNHO; nenhum efeito colateral persistido | ✅ presente | `LotePagamentoService.ts:881-920` |
| Recovery - Forward (Repair State / Reconcile) | Bulk sequencial trata lote-falho como "não finalizado, continua RASCUNHO"; o backend é a verdade e a tela recarrega ao fim | ✅ presente | `prontidaoLotes.ts:102-122`; `FinalizarProntos.tsx:56-63` |
| Reintroduction (Shadow / State Resync / Escalating Restart) | Degradação explícita da prontidão: `comProntidao` captura falhas e devolve lotes "sem prontidão" (nunca contados como PRONTO no cliente) | ✅ presente | `ProntidaoLoteService.ts:30-67`; `prontidaoLotes.ts:36-42` |
| Idempotent Replay | Sem `Idempotency-Key` no endpoint; a invariância vem do CAS `versao+status`. Replay com mesma versão idempotente só no primeiro commit; replays subsequentes recebem 409 explícito | ⚠️ parcial | `routes/sispag.ts:396-401`; `LotePagamentoService.ts:626-630` |
| Compensating Transaction | A ordem é deliberada: `exigirSituacoesPagaveis` ANTES de `verificacao.verificarItens`, para que uma recusa por situação não deixe itens retirados pela verificação TED/PIX — não há compensação porque não há escrita a desfazer | ✅ presente | `LotePagamentoService.ts:660-664` |
| Quarantine | Alertas de duplicidade e aviso de autorização continuam no item (não limpos pela recusa); a trilha fica | ✅ presente | `LotePagamentoService.ts:821-851` |
| Audit (persist who/when/what) | Chamadas `this.audit(...)` do delta vão para `LogService.info`, que escreve em `process.stdout`. Não há tabela de auditoria consultável; o invariante global (proposta cross-cutting) é parcialmente coberto só por log estruturado | ⚠️ parcial | `LotePagamentoService.ts:945-955`; `LogService.ts:19-27` |

## 4. Findings (achados)

### F-fault-tolerance-1: `finalizarLote` sem `Idempotency-Key`; defesa única é o CAS `versao+status`

- **Severidade**: P2
- **Tactic violada**: Idempotent Replay
- **Localização**: `src/backend/routes/sispag.ts:374-412`, `src/backend/domain/service/sispag/LotePagamentoService.ts:617-687`
- **Evidência (objetiva)**:
  ```ts
  // routes/sispag.ts:380-391 — body valida só { versao }
  const parsed = versaoSchema.safeParse(req.body);
  // LotePagamentoService.ts:626-630 — primeira defesa
  if (lote.versao !== input.versao) {
      throw new LoteVersaoConflitoError({ loteId: lote.id, versaoEsperada: input.versao });
  }
  ```
  Grep (`Idempotency-Key` ou `idempotency` no delta) → 0 ocorrências em `routes/sispag.ts` e `LotePagamentoService.ts`.
- **Impacto técnico**: duplo-POST concorrente (duplo clique sobrevivente ao `disabled` do botão, retry do browser por timeout, retry transparente do balanceador) com mesmo `versao` passa a primeira checagem em paralelo. Está contido pelo `transicionarStatus` CAS (`versao=X AND status=RASCUNHO → versao=X+1`), que afeta no máximo uma linha, mas o segundo request recebe 409 em vez de 200 idempotente — nenhum double-execute, só uma classe de erro reportada ao usuário mesmo quando a transição de fato aconteceu.
- **Impacto de negócio**: nenhuma remessa duplicada / nenhum lote duplo-finalizado. A tela do analista pode mostrar erro mesmo após o lote efetivamente ter transitado, forçando um F5 para confirmar o estado real. Não é um bloqueio; é fricção.
- **Métrica de baseline**: 0/1 rota de escrita financeira no delta aceita `Idempotency-Key`; 1/1 defendida por CAS `versao+status`.

### F-fault-tolerance-2: `lerItensAoVivo` sequencial, sem deadline agregado ao POST

- **Severidade**: P2
- **Tactic violada**: Timeout
- **Localização**: `src/backend/domain/service/sispag/LotePagamentoService.ts:752-786`
- **Evidência (objetiva)**:
  ```ts
  for (const item of itens) {
      const vivo = await this.conexos
          .getTituloAPagar(item.filCod, item.docCod, item.titCod)
          .catch(() => undefined);
      // ...fail-closed por item
  }
  ```
  Nenhum `AbortController`, `Promise.race` com deadline, ou cap no loop. O catch por-item é correto (fail-closed vira "situação não conferida"), mas o loop inteiro é O(N) nas chamadas Conexos, cada uma sujeita ao retry/backoff interno do client.
- **Impacto técnico**: um lote com 20 itens contra um Conexos lento (média 1s cada) consome ~20s de uma conexão do pool antes do CAS. No bulk sequencial do cliente (até ~40 lotes), isso serializa — a janela "Finalizando X de Y..." pode ficar aberta por minutos. O browser timeout (típico 30s–60s em proxy) pode cortar antes de o backend terminar, levando o cliente a reportar falha num lote que o backend ainda vai (ou vai conseguir) finalizar.
- **Impacto de negócio**: UX degrada visivelmente em pico de uso; mais importante, mistura de verdades entre "resultado reportado ao cliente" e "estado do backend" durante blips de rede. Mitigado pela recarga automática pós-bulk e pelo CAS que impede estado inconsistente.
- **Métrica de baseline**: 0/N wrappers de timeout no loop; `getTituloAPagar` serializado por item sem concorrência limitada.

### F-fault-tolerance-3: Bulk `finalizarEmSequencia` sem abort / botão "Parar"

- **Severidade**: P2
- **Tactic violada**: Recovery - Forward (controle do operador)
- **Localização**: `src/frontend/app/sispag/lotes/FinalizarProntos.tsx:56-63`, `src/frontend/app/sispag/lotes/prontidaoLotes.ts:102-122`
- **Evidência (objetiva)**:
  ```ts
  // FinalizarProntos.tsx:56-60 — diálogo trava o fechar enquanto rodando
  const fechar = async () => {
      if (rodando) return
      setAberto(false)
      if (resultados !== null) await onConcluido()
  }
  // prontidaoLotes.ts:102-121 — loop puro, sem signal
  export const finalizarEmSequencia = async (lotes, finalizar, aoAvancar?) => {
      const resultados: ResultadoFinalizacao[] = []
      for (const lote of lotes) {
          try { ... } catch (e) { ... }
          aoAvancar?.(resultados.length)
      }
  }
  ```
- **Impacto técnico**: a analista que descobre no lote 3 de 25 que precisa parar (ex.: observa que o fornecedor foi mal cadastrado, telefona o aprovador) não tem botão de abort — a única saída é fechar a aba. O backend está íntegro em qualquer ponto (cada lote é atômico), mas o front não exerce controle.
- **Impacto de negócio**: baixa severidade enquanto o volume for ~10 lotes; cresce com a escala do bulk. Interage com F-ft-2: um loop lento sem abort combina mal com Conexos degradado.
- **Métrica de baseline**: 0 abort paths expostos; 1 bloqueio explícito do close enquanto `rodando` em `FinalizarProntos.tsx:57`.

### F-fault-tolerance-4: Trilha das transições do delta não persistida (`logService.info` → stdout)

- **Severidade**: P2
- **Tactic violada**: Audit (persist who/when/what)
- **Localização**: `src/backend/domain/service/sispag/LotePagamentoService.ts:945-955`, `src/backend/domain/service/LogService.ts:19-27`
- **Evidência (objetiva)**:
  ```ts
  // LotePagamentoService.ts:945-955 — audit() delega ao LogService.info
  private audit = (...): Promise<void> =>
      this.logService.info({ type: LOG_TYPE.BUSINESS_INFO, ... });
  // LogService.ts:19-27 — info() apenas escreve em stdout
  private writeLog = async (input: CreateLogInput): Promise<void> => {
      process.stdout.write(`${JSON.stringify(logBody)}\n`);
  };
  ```
- **Impacto técnico**: o invariante global da proposta ("todo write/transição persistido com quem/quando/o quê") é parcialmente coberto só via log estruturado em CloudWatch/stdout, não via tabela consultável. Esta PR não cria o gap, mas não o fecha para suas transições novas (`exigirSituacoesPagaveis` recusa não gera registro na DB; o `transicionar` só grava `finalizadoPor`).
- **Impacto de negócio**: numa auditoria "quem recusou/finalizou o lote L1 em DD/MM?" dependemos do retention do CloudWatch (hoje não garantido por SLA documentado). Para operação financeira isso é dívida; para esta PR, é P2 (herda o débito global, não o amplia).
- **Métrica de baseline**: 0 tabelas de auditoria consultáveis para transições de lote no delta; 1 destino (stdout).

### F-fault-tolerance-5: `comProntidao` degrada em bloco; a tela não sabe POR QUÊ

- **Severidade**: P3
- **Tactic violada**: Condition Monitoring (observability do caminho degradado)
- **Localização**: `src/backend/domain/service/sispag/ProntidaoLoteService.ts:30-67`
- **Evidência (objetiva)**:
  ```ts
  } catch (error) {
      await this.logService.warn({ ... });
      return lotes; // lotes sem `prontidao`
  }
  ```
  Quando a avaliação parcial roda (`avaliarGravados` devolve), `fontesIndisponiveis` chega granular ao resolver (`ProntidaoLoteResolver.ts:161`). Quando o catch amplo dispara (ex.: `titulosComAjusteNaoTerminalNosLotes` lança), todos os lotes voltam sem `prontidao` e sem bandeira que diga "a listagem está em modo degradado".
- **Impacto técnico**: o cliente trata ausência de `prontidao` como "não é PRONTO" (`prontidaoLotes.ts:37-42`), o que é fail-closed e correto para o bulk — mas a tela não exibe banner "prontidão indisponível"; o único sinal é o selo some.
- **Impacto de negócio**: analista vê selo sumir sem explicação; pode interpretar como "nada a finalizar hoje" em vez de "tente recarregar". Baixo risco.
- **Métrica de baseline**: 0/1 flag de degradação visível na response quando o catch amplo dispara (vs 1/1 quando `fontesIndisponiveis` tem granularidade).

## 5. Cards Kanban

### [fault-tolerance-1] Aceitar `Idempotency-Key` em `/sispag/lotes/:id/finalizar` e dedupe por chave

- **Problema**
  > Hoje o endpoint só valida `{ versao }` (`routes/sispag.ts:380-391`). Um retry transparente (browser/proxy) do POST após o backend já ter aplicado a transição resulta em 409 `LoteVersaoConflitoError`, mesmo quando a intenção era "repetir o mesmo pedido". O CAS impede duplicação de estado — o header completaria o idiom e permitiria devolver 200 idempotente na segunda tentativa.

- **Melhoria Proposta**
  > Aceitar header `Idempotency-Key` (tática Bass: Idempotent Replay). Tabela leve `(idempotency_key, lote_id, versao_pedida, resultado, criado_em)` com TTL de 24h; na segunda chamada com a mesma chave e mesmos parâmetros, devolver o resultado persistido. Rota tocada: `src/backend/routes/sispag.ts` (handler do `/finalizar`). Service: um método paralelo `finalizarLoteIdem(input, key)` que embrulhe `finalizarLote`.

- **Resultado Esperado**
  > Retry transparente devolve 200 com o payload original.
  > Rotas de escrita financeira com `Idempotency-Key`: 0/1 → 1/1.

- **Tactic alvo**: Idempotent Replay
- **Severidade**: P2
- **Esforço estimado**: M (2–5d)
- **Findings relacionados**: F-fault-tolerance-1
- **Métricas de sucesso**:
  - `# endpoints de escrita financeira aceitando Idempotency-Key` em `routes/sispag.ts`: 0 → 1
  - `# 409 "versão conflito"` por chamadas idênticas em janela < 5s (dashboard): medir pós-mudança
- **Risco de não fazer**: fricção crescente em dias de instabilidade de rede; relatos de "finalizei e deu erro, mas o lote finalizou" continuam, e cada um consome tempo do time de suporte.
- **Dependências**: nenhuma.

### [fault-tolerance-2] Orçamento de tempo (deadline) no `finalizarLote` e concorrência limitada em `lerItensAoVivo`

- **Problema**
  > O loop em `LotePagamentoService.ts:761-786` executa até ~20 reads sequenciais no Conexos sem AbortController nem deadline total; no bulk sequencial do cliente (até ~40 lotes), isso serializa e pode exceder timeouts intermediários (proxy, browser), levando a divergência entre o que o cliente reporta e o estado real no backend.

- **Melhoria Proposta**
  > Introduzir um `deadline` por POST (ex.: 15s) via `AbortController` passado ao `conexos.getTituloAPagar`. Avaliar `Promise.all` com concorrência limitada (ex.: 5) em vez de serial — a fail-closed por item já tolera parciais, basta não impor ordem. Tática Bass: Timeout + Condition Monitoring. Arquivos: `src/backend/domain/service/sispag/LotePagamentoService.ts`; se preciso, estender assinatura de `ConexosSispagClient.getTituloAPagar` para aceitar `AbortSignal`.

- **Resultado Esperado**
  > Nenhum POST `/finalizar` fica aberto > deadline fixado.
  > Tempo p99 do POST com lote de 20 itens: medir (hoje não instrumentado) → ≤ 15s.

- **Tactic alvo**: Timeout
- **Severidade**: P2
- **Esforço estimado**: M (2–5d)
- **Findings relacionados**: F-fault-tolerance-2
- **Métricas de sucesso**:
  - `# wrappers de timeout agregado` em `exigirSituacoesPagaveis`: 0 → 1
  - p99 do POST `/finalizar` com lote p90-sized: ser instrumentado e capeado
- **Risco de não fazer**: na primeira janela de Conexos degradado em pico de volume, o bulk de 40 lotes trava a UI por minutos; analistas abrem tickets por "finalização não responde".
- **Dependências**: a mudança em `getTituloAPagar` precisa estender para outros chamadores sem quebrar `runWithRetry`.

### [fault-tolerance-3] Botão "Parar" no diálogo bulk + `AbortSignal` em `finalizarEmSequencia`

- **Problema**
  > `FinalizarProntos` bloqueia o fechar com `if (rodando) return` (`FinalizarProntos.tsx:57`) e `finalizarEmSequencia` (`prontidaoLotes.ts:102-122`) é um loop puro sem signal. Analista sem controle para interromper um bulk longo.

- **Melhoria Proposta**
  > Expor `AbortSignal` em `finalizarEmSequencia` e um botão "Parar" no diálogo quando `rodando` for `true`. Ao abortar, parar o loop antes do próximo lote (os já finalizados ficam, os não iniciados aparecem como "não tentado"). Nada muda no backend. Tática Bass: Recovery - Forward (controle do operador). Arquivos: `prontidaoLotes.ts`, `FinalizarProntos.tsx`, `prontidaoLotes.test.ts`.

- **Resultado Esperado**
  > Diálogo bulk aceita parada controlada.
  > `# abort paths no bulk sequencial`: 0 → 1

- **Tactic alvo**: Recovery - Forward
- **Severidade**: P2
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-fault-tolerance-3
- **Métricas de sucesso**:
  - Teste cobrindo "abort no meio do loop deixa `resultados` consistentes": 0 → ≥1
- **Risco de não fazer**: fricção crescente conforme o número de lotes prontos simultâneos sobe; interação com F-ft-2 amplifica.
- **Dependências**: nenhuma; alinhado com F-ft-2 (ambos empurram abortabilidade).

### [fault-tolerance-4] Expor flag "prontidão em modo degradado" na response de `/sispag/lotes`

- **Problema**
  > Quando o catch amplo de `ProntidaoLoteService.comProntidao` dispara, todos os lotes voltam sem `prontidao` e sem bandeira dizendo "estamos em modo degradado"; a tela só vê o selo sumir.

- **Melhoria Proposta**
  > Adicionar `prontidao: { degradado: true, motivo? }` (ou campo no envelope da listagem) quando o catch amplo ativa. Preservar o compatível quando `avaliarGravados` degradou parcial via `fontesIndisponiveis`. Mostrar banner na aba "Lotes candidatos" quando flag presente. Tática Bass: Condition Monitoring. Arquivos: `ProntidaoLoteService.ts`, `routes/sispag.ts`, `src/frontend/app/sispag/page.tsx`.

- **Resultado Esperado**
  > Analista vê "prontidão temporariamente indisponível — tente de novo" em vez de interpretar silêncio como "nada a finalizar".
  > `# sinalizações de modo degradado na response de /sispag/lotes`: 0 → 1

- **Tactic alvo**: Condition Monitoring
- **Severidade**: P3
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-fault-tolerance-5
- **Métricas de sucesso**:
  - Teste de `ProntidaoLoteService` cobrindo "erro no `titulosComAjusteNaoTerminalNosLotes` retorna flag degradado": 0 → 1
- **Risco de não fazer**: incidente silencioso durante blips de DB; usuário aborta operação por falsa percepção de "sem lote pronto".
- **Dependências**: nenhuma.

> **F-fault-tolerance-4 (audit em stdout, não DB)** não gera card dedicado nesta rodada: é débito global (toda a camada de audit do financeiro) e seria tratado por `/feature-new` próprio (ver `migration-debt.md`). Registrado no cross-ref para o `qa-consolidator`.

## 6. Notas do agente

- Escopo estritamente delta `origin/main..HEAD`; não auditei fluxos de remessa/conciliação (fora do PR).
- Nada do delta cria write ao ERP: o universo de "double financial-write" não se aplica aqui — a defesa é contra duplo-finalize local, que o CAS `versao+status` já contém. Score 7 reflete isso: o core é sólido (fail-closed por item, forward recovery no bulk, degradação explícita na listagem) e as lacunas são abortabilidade + idempotência de header + persistência de audit.
- Cross-QA: F-ft-2 pisa em Performance (sequencial N-reads é também gargalo de latência); F-ft-4 (audit em stdout) pisa em Security (auditabilidade da proposta); F-ft-3 (bulk sem abort) pisa em Testability (sem teste de abort mid-loop). Sinalizar ao consolidator.
- Métricas Conexos (p50/p99, taxa de 503, timeout do proxy) não medíveis sem CloudWatch; recomendei instrumentar na primeira janela pós-deploy.
