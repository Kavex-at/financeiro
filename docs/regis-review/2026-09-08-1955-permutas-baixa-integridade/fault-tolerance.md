---
qa: Fault Tolerance
qa_slug: fault-tolerance
run_id: 2026-09-08-1955-permutas-baixa-integridade
agent: qa-fault-tolerance
generated_at: 2026-09-08T19:55:00-03:00
scope: backend
score: 8.0
findings_count: 5
cards_count: 2
---

# Fault Tolerance — Regis-Review

> **Escopo estrito do delta** (`git diff HEAD~1 -- src/`, commit `8b18686`). Este QA é o dono
> do commit: ele existe para remediar `F-fault-tolerance-1` (P0) e `F-fault-tolerance-4` do run
> `2026-09-08-1414-permutas`. A verificação abaixo é adversarial — traçando o código, não
> confiando em docstring nem em teste passando. Findings/cards fora do delta que ainda seguem
> abertos (reaper `reconciling` órfão / job de reconciliação DB↔ERP) permanecem nos
> follow-ups do run anterior e **não** são re-abertos aqui.

## 1. Cenário Geral (Bass General Scenario aplicado ao nf-projects)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Dois analistas (2 abas / 2 máquinas) na mesma janela | Dois `POST /adiantamentos/:docCod/reconciliar` sobrepostos no MESMO adto | `ReconciliacaoPermutaService.reconciliar` + `PermutaExecucaoRepository.beginExecution` + `ConexosBaixaClient.gravarBaixaPermuta` | Prod, `CONEXOS_WRITE_ENABLED=true` (137 execuções desde 24-jun-2026, R$ 38,5 M) | Advisory lock por `hash(adiantamentoDocCod)`: **exatamente 1** entra em `reconciliarSerializado`; o outro recebe 409 `ReconciliacaoEmAndamentoError` (retryable), sem tocar o ERP | **0** duplicatas `gravarBaixaPermuta`; **0** borderôs órfãos da trilha; adtos distintos não se bloqueiam (custo apenas em colisão de hash int32) |
| ERP `fin010` (invariante I-Write-8b) | Alocação é 1.000 USD; somatório do em-aberto vivo cai para 600 USD entre eleição e POST | `executarBaixa` (loop de baixa por título) + `markParcial` | Prod, mesma janela | Fecha o par como **`parcial`** — terminal irmão de `settled`, não `settled` degradado — grava `valor_residual_usd`, emite `BUSINESS_WARN`, desenha `parcial-aguardando-finalizacao` na tela | **0** `settled` com resíduo > 0,005 USD; 100 % das linhas `parcial` com `valor_residual_usd` != NULL; badge distinto na tela |

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| `withAdvisoryLock` cobre TODA a região crítica do `reconciliar` (findAdiantamento → beginExecution → criarBordero → executarBaixa → markSettled/markParcial → removerBorderoOrfao) | ✔️ (envolve `reconciliarSerializado` inteira) | ✔️ | ✅ | `ReconciliacaoPermutaService.ts:151-167` |
| Determinismo do hash de lock (chave estável / int32) | mesma string ⇒ mesma chave; `(31·h + code)&0xFFFFFFFF` (`Math.imul` + `\| 0`) | estável, int32 | ✅ | `ReconciliacaoPermutaService.ts:174-181`; teste `chaves[0]===chaves[1]` e `Number.isInteger` em `ReconciliacaoPermutaService.test.ts:857-864` |
| `beginExecution.ON CONFLICT` preserva `parcial` em TODAS as 5 CASEs (`status`, `dry_run`, `executado_por`, `conexos_username`, `conexos_usn_cod`) | 5/5 | 5/5 | ✅ | `PermutaExecucaoRepository.ts:256-266`; assertivas em `PermutaExecucaoRepository.test.ts:42-46` |
| `alreadySettled` retorna true para `parcial` | true | true | ✅ | `PermutaExecucaoRepository.ts:284` |
| Idempotência viva no serviço trata `parcial` como `settled` (skipped se borderô válido, renameKey se cancelado) | `existente?.status === 'settled' \|\| existente?.status === 'parcial'` | ambos | ✅ | `ReconciliacaoPermutaService.ts:262-263` |
| `isBaixaConfirmada` protege borderô da limpeza órfã para os DOIS terminais | `status === 'settled' \|\| status === 'parcial'` | ambos | ✅ | `ReconciliacaoPermutaService.ts:60-61`; gate em `:385` |
| Pré-checagem I-Write-8a pulada exclusivamente no fallback sintético (`titulosDoErp=false`) | condição `!p.titulosDoErp` | idem | ✅ | `ReconciliacaoPermutaService.ts:684`; `titulosDoErp = titulos.length > 0` em `:501` (após filtro) |
| Teste de concorrência `Promise.allSettled` com 2 POSTs para o MESMO adto ⇒ **1** `gravarBaixaPermuta` + **1** `criarBordero`; perdedora recebe 409 | 1/1 e 409 | 1/1 e 409 | ✅ | `ReconciliacaoPermutaService.test.ts:787-825` |
| Teste de adtos distintos ⇒ 2 baixas em paralelo | 2/2 | 2/2 | ✅ | `ReconciliacaoPermutaService.test.ts:827-855` |
| Reaper para permutas (`reconciling` órfão) | ausente | 1 job / 15 min | ❌ | `ls src/backend/jobs/ \| grep -i reap` ⇒ só `reaper-sispag-reconciling.ts` (fora do escopo deste delta, herdado do run anterior) |
| Reaper/detector proativo para `parcial` | **ausente** | ao menos um sinal proativo (job ou consulta agregada na tela) | ❌ | `grep -rn "listParcial\|listReconcilingParadas" src/backend/domain/repository/permutas/` ⇒ 0 hits; único sinal é o badge lazy em `BorderoGestaoService.statusPorAdiantamento` (:494-593) |
| Rollback-safe: código anterior a `8b18686` sabe ler linhas `parcial` | **não** — a versão anterior nem tinha o valor no union, e `beginExecution` só preservava `settled` | rollback seguro ou runbook de forward-only | ❌ | `PermutaExecucaoRepository.ts:16` (union pré-delta = 4 valores); migration `0054_permuta_execucao_parcial.sql` amplia o CHECK mas não é revertida por rollback do código |
| Baseline de testes do módulo (backend, worktree) | 123 suites / 1.768 testes, 0 falhas | verde | ✅ | `_shared-metrics.md` |

⚠️ **Não medível localmente**: contagem real de `parcial` em prod (o delta ainda não subiu — `docs/impacto/h1-permutas-achados.md` registra 12 erros, sem categoria `parcial` porque o estado não existia). Recomendação: instrumentar contador `permuta_parcial_pendente` no painel operacional assim que shippar.

## 3. Tactics — Cobertura no nf-projects

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Substitution | N/A — sem hot spare para `fin010`; escrita é síncrona | N/A | — |
| Increase Competence Set | Fallback sintético de título único quando o ERP não devolve títulos | ✅ | `ReconciliacaoPermutaService.ts:505-507` |
| Predictive Model | Pré-checagem I-Write-8a antes do 1º POST (`assertCobertura`) — falha ANTES de gravar dinheiro | ✅ | `ReconciliacaoPermutaService.ts:679-703` (chamada em `:540`) |
| Sanity Checking | Anti-drift por título + `assertCobertura` do agregado + WARN se `pago=1` diverge do em-aberto derivado | ✅ | `ReconciliacaoPermutaService.ts:686-705`, `:504-511` (anti-drift, pré-existente) |
| Comparison / Voting | Cobertura derivada `Σ (valorNegociado − pago/taxa)` vs. `valorAlocado` com tolerância `0,005` (moeda negociada) | ✅ | `ReconciliacaoPermutaService.ts:686-703`; testes de fronteira ±0,005 em `.test.ts:711-735` |
| Timestamp | `atualizado_em = now()` em toda escrita da trilha | ✅ | `PermutaExecucaoRepository.ts:249-269`, `:388` |
| Timeout | Herdada do cliente Conexos (fora do delta) | ✅ (herdado) | `ConexosBaixaClient` |
| Condition Monitoring | `BUSINESS_WARN` no `parcial` + no caller barrado pelo lock + no `pago` divergente | ⚠️ **parcial** — nenhum job varre logs nem a coluna `valor_residual_usd`; detecção humana (badge lazy) | `ReconciliacaoPermutaService.ts:589-599`, `:155-167`, `:697-706` |
| Self-Test | N/A | N/A | — |
| Redundancy (Active/Passive/Spare) | N/A — escrita monolítica no `fin010` | N/A | — |
| Rollback | `markError` grava resposta crua para conciliação manual; `removerBorderoOrfao` best-effort quando **nenhuma** baixa entrou | ✅ | `ReconciliacaoPermutaService.ts:404-437` |
| Repair State / Reintroduction | `renameKey` libera relançamento quando borderô virou nulo — agora simétrico para `parcial` | ✅ | `ReconciliacaoPermutaService.ts:271-274`; comentário C-8 em `:249-260` |
| Idempotent Replay | Chave inclui `atualizado_em` da alocação; re-alocar cunha chave nova; par terminal (`settled`/`parcial`) → skipped | ✅ | `ReconciliacaoPermutaService.ts:243-263` |
| Compensating Transaction | `removerBorderoOrfao` só age quando `!resultados.some(isBaixaConfirmada)`; fail-safe via `listBaixas` | ✅ | `ReconciliacaoPermutaService.ts:385-437` |
| Reconcile (Gray & Reuter §11) | `borderoAindaValido` sob demanda no próximo `reconciliar`; **não há job periódico DB↔ERP** (dívida herdada do run anterior, fora do delta) | ⚠️ herdado | `ReconciliacaoPermutaService.ts:811-825` |
| Quarantine | `reconciling` órfão vira IN-DOUBT com mensagem explícita; fail-closed | ✅ | `ReconciliacaoPermutaService.ts:283-311` |
| Transactions (autoral, Gray & Reuter §7) | Advisory lock serializa por adto — a região crítica é inteira, sem gap entre lock e primeira escrita | ✅ | `PostgreeDatabaseClient.ts:137-158`; `ReconciliacaoPermutaService.ts:151-167` |
| Human-in-the-Loop / MTTR (autoral) | Badge `parcial-aguardando-finalizacao` **visualmente distinto** do `aguardando-finalizacao`; mensagens de erro em pt-BR | ⚠️ **parcial** — sinal é lazy (só na tela de borderôs); sem fila proativa | `ui.tsx:135-143`; `BorderoGestaoService.ts:494-593` |

## 4. Findings (achados)

### F-fault-tolerance-1: R-1 (P0) fechado — advisory lock cobre a região crítica sem janela

- **Severidade**: N/A — verificação de remediação.
- **Tactic (posit)**: Transactions + Idempotent Replay.
- **Localização**: `src/backend/domain/service/permutas/ReconciliacaoPermutaService.ts:151-167` (público `reconciliar`) + `:174-181` (hash) + `:183-395` (`reconciliarSerializado`).
- **Evidência (traçada)**:
  - O público `reconciliar` é **só** a wrapper `this.db.withAdvisoryLock(chaveDeLock(input.adiantamentoDocCod), () => this.reconciliarSerializado(input), () => throw ReconciliacaoEmAndamentoError)`. Nada roda antes do lock; nada roda entre o lock e o corpo.
  - Dentro de `reconciliarSerializado`, TODAS as escritas (`beginExecution`, `criarBordero`, `setBorCod`, `gravarBaixaPermuta`, `markSettled`, `markParcial`, `markError`, `removerBorderoOrfao`) rodam sob o mesmo backend Postgres que segurou o `pg_try_advisory_lock` (`PostgreeDatabaseClient.ts:137-158` — mesmo `client` do pool para acquire/release).
  - Hash é determinístico: `let h=0; for(...) h = (Math.imul(31,h) + code) | 0`. Mesma string ⇒ mesma chave; teste `ReconciliacaoPermutaService.test.ts:857-864` verifica estabilidade e int32.
  - Colisão entre adtos distintos serializa a mais (custo, não corretude) — teste `:827-855` mostra `9999` vs `2767` rodando em paralelo com 2 `gravarBaixaPermuta`.
- **Interleaving fechado**: os passos `t3`/`t5`/`t9`/`t11` da tabela do run anterior (`fault-tolerance.md:2026-09-08-1414`) ficam impossíveis porque a segunda requisição sai por `onBusy → ReconciliacaoEmAndamentoError` antes de qualquer read/write.
- **Sem card** — remediação de R-1 confirmada. Move o item de "0 por sorte, com R$ 280 k médios por evento em risco" para "0 por construção".

### F-fault-tolerance-2: R-2 fechado — `parcial` é terminal em TODOS os gates

- **Severidade**: N/A — verificação de remediação.
- **Tactic (posit)**: Sanity Checking + Idempotent Replay.
- **Localização**: cinco pontos de gate, todos verificados:
  1. `PermutaExecucaoRepository.ts:256-266` — as **5** CASEs do `ON CONFLICT` (`status`, `dry_run`, `executado_por`, `conexos_username`, `conexos_usn_cod`) preservam `parcial` alongside `settled`.
  2. `PermutaExecucaoRepository.ts:284` — `alreadySettled = status === 'settled' || status === 'parcial'`.
  3. `ReconciliacaoPermutaService.ts:262-263` — idempotência viva do serviço: `existente?.status === 'settled' || existente?.status === 'parcial'` ⇒ borderô válido ⇒ skipped; borderô nulo ⇒ `renameKey` (libera relançamento sem apagar histórico).
  4. `ReconciliacaoPermutaService.ts:60-61` — `isBaixaConfirmada` retorna true para os dois; gate em `:385` (`!resultados.some(isBaixaConfirmada)`) NÃO chama `removerBorderoOrfao` quando qualquer resultado é `parcial`.
  5. `BorderoGestaoService.ts:522-524` — a máquina B1' agrega por par `adto:borCod`, marcando `parcial-aguardando-finalizacao` quando ao menos uma execução daquele borderô é `parcial`.
- **Cross-check semântico**: `parcial` é irmão de `settled` (afirma "houve baixa confirmada, sobrou resíduo em moeda negociada"), NÃO `settled` degradado nem `error` suavizado. `markParcial` grava `bxa_cod_seq` obrigatório (I-Recon-2), e `valor_residual_usd` != NULL apenas em `parcial` (documentado em `0054_permuta_execucao_parcial.sql`).
- **Sem card** — remediação de R-2 confirmada.

### F-fault-tolerance-3: Pré-checagem I-Write-8a — condicional pelo booleano de origem, não pela contagem

- **Severidade**: N/A — verificação de remediação.
- **Tactic (posit)**: Predictive Model + Comparison.
- **Localização**: `ReconciliacaoPermutaService.ts:676-710` (`assertCobertura`) + `:501` (set de `titulosDoErp`) + `:513` (chamada).
- **Evidência (traçada)**:
  - `titulosDoErp` é `boolean`, setado **após** o filtro em `:501` como `titulos.length > 0`. O `catch` do try do `listTitulosAPagar` deixa `titulosDoErp = false`.
  - `assertCobertura :684` — primeira linha: `if (!p.titulosDoErp) return;`. Pré-checagem pulada apenas no caminho sintético (lista vazia ou catch), que é majoritário em produção.
  - Teste `NÃO dispara no fallback de título único (lista vazia)` em `.test.ts:663-680`; teste `NÃO dispara no fallback (catch)` em `:682-693`; teste `1 título REAL do ERP dispara 8a` em `:695-713` (garante que a condição não é `titulos.length === 1`).
- **Truncamento (guarda `count`) deliberadamente NÃO implementada**: documentado em `AlocacaoSemCoberturaError.ts:15-25` e no docblock C-4 (`ReconciliacaoPermutaService.ts:667-676`). Racional: a página do ERP é imposta pelo próprio (`rows.length === pageSize` NÃO indica truncamento — pedimos 500, vieram 50 com `count: 86` em HML). Trade-off assumido: uma invoice com truncamento silencioso poderia gerar recusa indevida (fail-closed benigno) OU aprovação com resíduo (que aí termina em `parcial`, não em `settled` mudo). Aceitável dado que 8b é o backstop.
- **Sem card** — condição correta, testes cobrem os dois ramos.

### F-fault-tolerance-4: `parcial` sem reaper/detector proativo — o novo silêncio que a ADR nomeia (P1)

- **Severidade**: **P1** — impacto **médio** (dinheiro se moveu, o resíduo é trabalho pendente), probabilidade **alta** (todo `parcial` depende de olho humano na tela certa).
- **Tactic violada**: **Condition Monitoring** (Bass) — os sinais existem (log `BUSINESS_WARN`, coluna `valor_residual_usd`, badge `parcial-aguardando-finalizacao`), mas **nenhum é proativo**; todos exigem que alguém abra a tela ou grep-e no log.
- **Localização**: `src/backend/jobs/` (ausência) + `src/backend/domain/repository/permutas/PermutaExecucaoRepository.ts` (sem `listParcialParados`) + `src/backend/domain/service/permutas/BorderoGestaoService.ts:494-593` (badge lazy).
- **Evidência (objetiva)**:
  ```
  $ ls src/backend/jobs/ | grep -i reap
  reaper-sispag-reconciling.ts
  $ grep -rn "listParcial\|listReconcilingParadas" src/backend/domain/repository/permutas/
  (vazio) — nenhum método de scan agregado no repo de permutas
  $ grep -rn "valor_residual_usd" src/backend/domain/service/permutas/ | grep -v test
  BorderoGestaoService.ts:509:  (`valor_residual_usd` + `GET /execucoes`), que é onde ele pertence.
  ```
  SISPAG tem `listReconcilingParadas` no repo (`RemessaExecucaoRepository.ts:124`, `ConciliacaoExecucaoRepository.ts:54`), exposto em `GET /sispag/execucoes` e consumido pelo painel (`SispagPainelService.ts:376-377`). O par para permutas — mesmo esqueleto — **não existe**.
- **Interleaving concreto**: analista Simone executa a baixa em `2767→INV-X` numa segunda-feira à tarde. `listTitulosAPagar` devolve 3 títulos que somam 600 USD (o alocado eram 1.000 — 40 % faltando por baixa externa que ninguém avisou). A pré-checagem dispararia (`AlocacaoSemCoberturaError`) e ela re-alocaria. Cenário mais provável em produção, porém: os títulos passam pela pré-checagem (cobertura ≥ alocado no snapshot inicial), mas entre a validação e o loop de `baixarTitulo` o ERP reduz o em-aberto do último título ⇒ anti-drift baixa MENOR ⇒ resíduo positivo pós-loop ⇒ `markParcial`. Simone fecha o browser. A tela de "adiantamentos elegíveis" continua listando `2767` porque `parcial` não é input de elegibilidade (design consciente — `_shared-metrics.md:contexto`). Mas nenhuma view "borderôs com resíduo pendente" existe. Sem uma passagem de olho de Simone/Yuri pela tela de Borderôs (ou grep pelo log `BUSINESS_WARN`), o par `2767→INV-X` permanece parcial por dias/semanas. É exatamente a objeção que motivou I-Recon-7.
- **Impacto técnico**: linhas `parcial` acumulam silenciosamente, com `valor_residual_usd` positivo, sem alerta operacional. Aging vira dado inconsistente (o backlog envelhecendo 78→108 dias, medido no run anterior, é o mesmo formato de sintoma).
- **Impacto de negócio**: KPIs de "R$ baixado" divergem do "R$ alocado" cronicamente. Analista descobre por auditoria, não por operação. Custo médio por evento: fração do `valor_residual_usd` — sem dados prod ainda, mas média por execução é R$ 280 k (137 execuções, R$ 38,5 M), portanto um `parcial` típico de 20-40 % é R$ 56-112 k residuais parados.
- **Métrica de baseline**: 0 reapers de permuta (SISPAG tem 1); 0 queries agregadas sobre `valor_residual_usd`; janela detectada = "próximo momento em que um humano abre a tela de Borderôs OU o par entra numa nova rodada de reconciliar" — indefinida na prática.

### F-fault-tolerance-5: Rollback do código sem rollback da migration re-executa `parcial` (P1)

- **Severidade**: **P1** — probabilidade **baixa** (rollback é evento raro), impacto **crítico** (é justamente a dupla-baixa que R-1 acaba de matar por outro caminho).
- **Tactic violada**: **Rollback** (Bass) — o esquema deste QA é "toda transição commit-a-tudo, roll-back-tudo, ou fica em quarentena". O delta introduz um estado terminal (`parcial`) cuja retração é **assimétrica**: a migration 0054 amplia o CHECK, mas o rollback do código não reverte o CHECK — e o código anterior a `8b18686` NÃO conhece `parcial` como terminal.
- **Localização**: `src/backend/migrations/0054_permuta_execucao_parcial.sql` (amplia CHECK) + comparação com `PermutaExecucaoRepository.ts` versão anterior (recuperável do run `2026-09-08-1414`, seção sobre `beginExecution`).
- **Evidência (traçada)**:
  - Migration adiciona `'parcial'` ao CHECK (`0054:20-22`) e a coluna `valor_residual_usd` (`:26-27`).
  - `PermutaExecucaoRepository.ts:16` (após o delta): union `'pending' | 'reconciling' | 'settled' | 'error' | 'parcial'`. Antes: `... | 'error'` (sem `parcial`).
  - `PermutaExecucaoRepository.ts:256-266` (após o delta): CASE preserva `IN ('settled', 'parcial')`. Antes: `IN ('settled')` apenas.
  - Se o código volta para a versão pré-delta com a migration aplicada (rollback normal via `git revert` ou tag anterior) e uma linha `parcial` já existir:
    1. `beginExecution` UPSERT: a CASE do código antigo NÃO casa `status = 'settled'`, cai no ELSE, `EXCLUDED.status = 'reconciling'` sobrescreve. A linha regride de `parcial` para `reconciling`, mantendo `bor_cod` e `bxa_cod_seq` da baixa que **existe no ERP**.
    2. `beginExecution` retorna `alreadySettled: false` (status não é `settled`).
    3. O caller (`ReconciliacaoPermutaService.reconciliar` pré-delta) segue para o handshake — cria NOVO borderô (`criarBordero`), sobrescreve `bor_cod`, POSTa `gravarBaixaPermuta` de novo.
    4. **Dupla baixa no `fin010` para o par que já era `parcial`.**
  - O check em `existente?.status === 'settled'` no código antigo também não gera skipped (o status voltou a ser `reconciling` pela CASE, mas mesmo sem isso o gate de `existente?.status === 'parcial'` não existe lá).
- **Interleaving concreto**: `2767→INV-X` é executado com sucesso em D, deixa `parcial` com resíduo 100 USD. Em D+1 detectam bug **outro** neste delta e revertem o commit `8b18686` (mantendo a migration — o padrão de operação `main` a migration já rodou). Em D+2 Simone re-executa `2767` porque quer tentar o resíduo. `beginExecution` regride `parcial → reconciling`, `criarBordero` gera bor 10001, `gravarBaixaPermuta` posta uma **segunda baixa** — sobre o mesmo título que já foi baixado em `parcial`. Anti-drift **detecta** parcialmente (o em-aberto do título já foi consumido pelo `parcial`, então o em-aberto vivo é 0 → 0 aborta). Mas isto só protege se o título já foi TOTALMENTE consumido; num `parcial` típico o resíduo é sobre alocação, não sobre título — títulos com em-aberto positivo ainda existem, e a "segunda tentativa" baixa por cima.
- **Impacto técnico**: retrocesso do delta requer revert coordenado do CHECK e conversão manual `UPDATE permuta_alocacao_execucao SET status='settled' WHERE status='parcial'` (perda de informação — o resíduo some do livro-razão). Sem esse cuidado, rollback = dupla-baixa.
- **Impacto de negócio**: cenário de baixa probabilidade e alto impacto — um dia de rollback silencioso pode inserir a mesma R$ 280 k média × N pares parciais. É a mesma escala do risco que R-1 acabou de fechar, mas pela porta de trás da operação, não da concorrência.
- **Métrica de baseline**: 0 runbooks de rollback deste delta; 0 scripts de conversão `parcial → settled` documentados; migration 0054 é forward-only mas nada barra o rollback do código.

## 5. Cards Kanban

### [fault-tolerance-1] Reaper/detector proativo de execuções `parcial` — paridade com SISPAG e defesa contra o novo silêncio

- **Problema**
  > O terminal `parcial` (ADR-0043) grava fielmente o que aconteceu — baixa confirmada, resíduo por re-alocar — mas depende **inteiramente** de detecção humana: log `BUSINESS_WARN` (para quem lê logs), coluna `valor_residual_usd` positiva (sem query agregada), badge `parcial-aguardando-finalizacao` (visível só quando a analista abre a tela de Borderôs). SISPAG resolveu o problema idêntico com `RemessaExecucaoRepository.listReconcilingParadas` (`:124`) + `ConciliacaoExecucaoRepository.listReconcilingParadas` (`:54`) + `SispagPainelService:376-377` + `reaper-sispag-reconciling.ts` (cron 15 min). Sem o par para permutas, `parcial` vira o novo silêncio que a própria ADR nomeia como risco.

- **Melhoria Proposta**
  > (1) Adicionar `PermutaExecucaoRepository.listParcialPendentes(limit)` — `WHERE status='parcial' AND valor_residual_usd > 0 ORDER BY atualizado_em DESC`. (2) Expor `GET /permutas/execucoes?status=parcial` (`requireRole('admin')` como no SISPAG). (3) Publicar contador no painel operacional (`sispag`-style card com `parciais_pendentes` + `soma_residual_usd`). (4) Job `reaper-permutas-parcial.ts` que roda por hora, escreve no `job_execucao` (`data: {parciaisPendentes: N, agingMedio: dias}`) e emite `BUSINESS_WARN` para pares com > 24 h em `parcial` (não age — só publica; forward recovery humano).

- **Resultado Esperado**
  > Toda execução `parcial` com > 1 h de idade aparece na trilha de operação em ≤ 1 h após o fato. Latência de detecção (t_reap - t_atualizado_em) mediana ≤ 60 min. Contador `parciais_pendentes` visível no painel.

- **Tactic alvo**: Condition Monitoring (Bass) + Human-in-the-Loop / MTTR (autoral)
- **Severidade**: **P1**
- **Esforço estimado**: **S** (≤ 1 d) — copiar shape do SISPAG.
- **Findings relacionados**: F-fault-tolerance-4
- **Métricas de sucesso**:
  - `listParcialPendentes` no repo: ausente → presente + teste
  - Endpoint `GET /permutas/execucoes?status=parcial`: ausente → presente
  - Reapers de permuta: 0 → 1 (paridade com SISPAG)
  - Latência de detecção `parcial`: N/A → ≤ 60 min p50
- **Risco de não fazer**: `parcial` acumula silenciosamente; a KPI de "R$ baixado" mente sobre o "R$ alocado" cronicamente; o resíduo médio esperado (20-40 % de R$ 280 k) fica invisível até auditoria manual.
- **Dependências**: nenhuma.

### [fault-tolerance-2] Runbook + guard de rollback para o delta `parcial` — evitar dupla-baixa por retrocesso

- **Problema**
  > A migration 0054 amplia o CHECK de `permuta_alocacao_execucao.status` para aceitar `'parcial'` e o código passa a gravar esse valor. Reverter só o código (rollback via `git revert 8b18686` ou tag `v0.34.0`) mantendo a migration deixa linhas `parcial` no banco que a versão antiga **regride para `reconciling` no próximo `beginExecution`** (CASE antiga só preserva `settled`), habilitando um segundo `criarBordero` + `gravarBaixaPermuta` — a mesma dupla-baixa que R-1 fechou pela porta da frente. É baixa probabilidade (rollback é evento raro), alto impacto (R$ 280 k médios por par).

- **Melhoria Proposta**
  > (a) Documentar `docs/runbook/rollback-permutas-parcial.md` explicitando: "revert do commit `8b18686` **exige** SQL prévio `UPDATE permuta_alocacao_execucao SET status='settled' WHERE status='parcial'` (perde-se `valor_residual_usd`, aceitável dado que o par `parcial` retornaria a ser re-lançado num relançamento humano) OU rollback da migration 0054 numa migration nova (`0055_permuta_execucao_parcial_rollback.sql`)". (b) Alternativa defensiva no código: incluir uma cláusula `--- version-tag ---` na 0054 e uma probe boot-time que checa se o CHECK aceita `'parcial'` mas o código não conhece a string (mismatch → refuse to boot, fail-closed). (c) Marcar a ADR-0043 como **forward-only** no header.

- **Resultado Esperado**
  > Rollback documentado como operação com pré-condição SQL. 0 caminhos silenciosos para regressão `parcial → reconciling`.

- **Tactic alvo**: Rollback (Bass) + Sanity Checking (probe boot)
- **Severidade**: **P1**
- **Esforço estimado**: **S** (≤ 1 d) — runbook + probe boot-time simples.
- **Findings relacionados**: F-fault-tolerance-5
- **Métricas de sucesso**:
  - Runbook `rollback-permutas-parcial.md`: ausente → presente
  - Probe boot-time (opcional mas defensável): ausente → presente, com teste
  - ADR-0043 header: sem marca → marcada como `forward-only`
- **Risco de não fazer**: um único rollback mal orquestrado insere dupla-baixa em N pares parciais — a mesma escala do dano que R-1 acabou de eliminar. É a via traseira.
- **Dependências**: nenhuma.

## 6. Notas do agente

- **Escopo estrito ao delta cumprido**: findings/cards do módulo Permutas fora deste commit (reaper `reconciling` órfão — `ft-2` do run anterior; job de reconciliação DB↔ERP — `ft-3`; `withTransaction` em `criarRascunhosAtomico` — `ft-5`; cobertura de branch — `ft-6`; endpoint de liberação — `ft-7`) permanecem nos follow-ups do run `2026-09-08-1414-permutas` e **não** são re-abertos aqui.
- **Positivo em série**: R-1 (P0) e R-2 (P1) do run anterior verificados fechados por traçado adversarial. O `parcial` é irmão de `settled`, não `settled` degradado; o gate é simétrico nos 5 pontos que importam (CASE do UPSERT, `alreadySettled`, idempotência viva, `isBaixaConfirmada`, badge B1'). Score sobe de 6,5 → 8,0.
- **Cross-QA para o consolidator**:
  - F-fault-tolerance-4 toca **Testability** (falta de teste E2E que exercite "parcial gravado + tempo passa + surface aparece") e **Modifiability** (o modelo B1' foi construído para NÃO colapsar os dois pendentes — a extensão futura merece preservar essa cardinalidade).
  - F-fault-tolerance-5 toca **Deployability** (runbook de rollback é artefato de deploy) e **Modifiability** (migrations forward-only precisam ser marcadas em ADR).
