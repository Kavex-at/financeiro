---
qa: Availability
qa_slug: availability
run_id: 2026-08-28-0249-sispag-boleto-dda
agent: qa-availability
generated_at: 2026-08-28T02:49:00-03:00
scope: backend
score: 8
findings_count: 4
cards_count: 3
---

# Availability — Regis-Review

## 1. Cenário Geral (Bass General Scenario aplicado ao delta)

O delta amplia o caminho de dinheiro saindo da empresa (`RemessaService` do SISPAG): abre o boleto
como forma de pagamento, cabeada à associação DDA do ERP (`fin124` via `titVldReflexoDdaAssoc`),
introduz um re-POST allowlistado à pergunta do Conexos (`FIN_041.EXISTE_CODIGO_BARRAS_ASSOCIADO_TITULO`)
e uma 3ª fonte de leitura AO VIVO no painel (grid de pendentes do `fin015` por filial). Todas as
novas leituras têm degradação best-effort; a fail-close nova (`BoletoSemCodigoBarrasError`) barra
ANTES de qualquer escrita, e o mecanismo de retomada (`sincronizarComErp` + ledger write-ahead)
absorve interrupção pós-`QUESTION`.

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| ERP Conexos (`fin015`) | responde `type: QUESTION` (`FIN_041.EXISTE_CODIGO_BARRAS_ASSOCIADO_TITULO`) no `POST importar` | `ConexosSispagWriteClient.importarTitulos` (worktree, `ConexosSispagWriteClient.ts:512-567`) | operação normal (analista gerou remessa BOLETO com DDA associado) | reconhece a pergunta (allowlist por `key` EXATA), re-POSTa MESMO body com `answers: { <id>: 'YES' }` UMA vez; se repetir a pergunta, sobe `ErpPerguntaError` (não vira laço) | 0 laços; 2 POSTs máx./chamada; qualquer falha do 2º POST cai para `sincronizarComErp` na próxima tentativa (medido em HML 2026-08-27: 1º POST não importa; contagem do lote fica inalterada) |
| Conexos indisponível/lento na leitura do flag DDA | `listarTitulosComBoletoDda` falha | `IngestaoPagamentosService.titulosComBoletoDda` (`IngestaoPagamentosService.ts:73-99`) e `SispagPainelService.modalidadesDisponiveisDoLote` (`SispagPainelService.ts:242-324`) | rodada diária de ingestão ou request de painel | degrada — devolve `Set()` vazio com WARN, títulos entram com `temBoleto=false`, boleto some da lista de modalidades | 0 rodadas de ingestão perdidas; 0 requests de painel derrubados; contra-partida: 0 sinais visíveis ao operador de que a filial X está sem informação (ver F-availability-1) |
| ERP recicla `flpCod` / lote nativo cancelado entre `listarLotesNativos` e `listarTitulosPendentes` | contexto de leitura do grid vira lote inválido | `ConexosSispagWriteClient.listarTitulosComBoletoDda` (`ConexosSispagWriteClient.ts:439-462`) | fluxo diário; filial nova ou operação humana no ERP | falha da 2ª leitura vira exceção capturada pelo caller best-effort; degrada como acima. Filial SEM lote nenhum devolve `Set()` vazio SEM warn (ver F-availability-3) | 0 crashes; 1 caminho silencioso não instrumentado (bootstrap de filial nova) |
| Analista marca BOLETO em título sem DDA associado | `RemessaService.montarItensImport` | envio da remessa | `BoletoSemCodigoBarrasError` (409) — ANTES do `criarLote`; nenhuma escrita no ERP | 0 `.REM` com segmento J vazio (fail-closed antes de qualquer escrita, comprovado em `RemessaService.test.ts` — teste `BOLETO SEM boleto DDA → BoletoSemCodigoBarrasError antes de qualquer escrita`) |

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Escritas do delta usando `postGenericOnce` (tentativa única) | 100% (`criarLote`, `importarTitulos` — inclusive re-POST allowlistado, `finalizarLote` (GET), `gerarRemessa`) | 100% para escrita não-idempotente | ✅ | `ConexosSispagWriteClient.ts:158, 551, 558, 657, 674` |
| Leituras do delta usando `runWithRetry` | 100% (`listarLotesNativos`, `getLoteNativo`, `listarChavesDoLote`, `listarTitulosPendentes`, `listarArquivosRemessa`, `baixarRemessa`) | 100% para leitura idempotente | ✅ | `ConexosSispagWriteClient.ts:201, 268, 311, 383, 709, 746` |
| Cobertura de `try/catch` nas novas superfícies best-effort | 3/3 (`titulosComBoletoDda`, `modalidadesDisponiveisDoLote` per filial, `listRetornos` per filial) | 100% best-effort com WARN estruturado | ✅ | `IngestaoPagamentosService.ts:88`, `SispagPainelService.ts:110, 214` |
| Fail-closed antes de qualquer escrita (boleto sem DDA) | 100% | 100% (0 `.REM` sem barras) | ✅ | `RemessaService.ts:876-882`, teste em `RemessaService.test.ts:930-943` |
| Allowlist de auto-resposta a `QUESTION` | 1 chave, exata (`FIN_041.EXISTE_CODIGO_BARRAS_ASSOCIADO_TITULO`), rejeita envelope com 2+ perguntas | 1 chave documentada com evidência HML | ✅ | `ConexosSispagWriteClient.ts:52, 574-582`; testes `ConexosSispagWriteClient.test.ts:297-343` |
| Sanity checking de transição de estado (`lote_pagamento`) | `LotePagamentoRepository.transicionarStatus` valida `de: [FINALIZADO] → REMESSA_GERADA` com `versaoEsperada` | guard obrigatório | ✅ | `RemessaService.ts:533-538` |
| Condition monitoring de execuções órfãs (`reconciling` > 15min) | presente no painel (`contarExecucoesParadas`), com `nativeFlpCod` para o operador; falha da leitura degrada em WARN | painel expõe contagem + IDs | ✅ | `SispagPainelService.ts:137, 334-358` |
| State Resynchronization (`sincronizarComErp`) — cobertura de estados do `flpVldStatus` | 4/4 (0-aberto, 1-finalizado, 2-cancelado, 3-outro terminal) + adoção por marca d'água (regra do exatamente-1) | 100% dos estados MEDIDOS em produção (22 lotes fil 1/2/4/6 em 2026-08-25) | ✅ | `RemessaService.ts:592-809`; regra em `ontology/business-rules/retomada-remessa-sispag.md` |
| Timeout HTTP em Conexos | 40 s (axios global), sem timeout específico do novo caminho | ≤ 40 s | ✅ | `src/backend/services/conexos.ts:121` |
| Visibilidade ao operador quando `temBoleto` degrada | 0 sinais (UI mostra "sem boleto" idêntico ao caso real) | ≥ 1 badge/indicador por filial degradada | ❌ | `src/frontend/app/sispag/page.tsx:715-737`, delta do commit `5978ac5` |
| Fan-out `modalidadesDisponiveisDoLote` — leituras Conexos por request | até 3 × (`titulos_do_lote` + `favorecidos_distintos` + `filiais_distintas`) chamadas + paginação do grid (5 páginas × 500 medido na filial 2) | ≤ CONEXOS_FANOUT_LIMIT=4 em paralelo, sem timeout composto explícito | ⚠️ | `SispagPainelService.ts:257-311` |
| Idempotência de `RemessaService.gerarRemessa` por lote | advisory lock + `remessa_execucao.idempotencyKey` (`remessa:${loteId}`) — chave estável | 100% para o caminho `gerar remessa` | ✅ | `RemessaService.ts:126-138, 191, 195-215` |
| Idempotência de `IngestaoPagamentosService.executar` | opcional (`idempotencyKey`) + advisory lock `PAGAMENTO_INGEST_LOCK_KEY` | presente | ✅ | `IngestaoPagamentosService.ts:47-63` |
| Guarda contra `chavesDesejadas` incompletas em uma única página | presente (só para quando ACHOU todas) | não falso-positivo por corte de página | ✅ | `ConexosSispagWriteClient.ts:407-411`; testes `ConexosSispagWriteClient.test.ts:533-548` |

> ⚠️ **Não medível localmente**: MTTR real (tempo entre `.REM` rejeitado no banco e nova remessa
> válida gerada). Requer CloudWatch/Sentry — não existem nesta run (deploy Render). Recomendação:
> instrumentar duração de `remessa_execucao` (`beginExecution → settle`) e emitir métrica de
> retomadas por origem (`sync.motivo`), para diferenciar retomada normal de retomada por marca
> d'água (proxy da janela irrecuperável antiga).
>
> ⚠️ **Não medível localmente**: percentual real de rodadas de ingestão em que
> `listarTitulosComBoletoDda` degrada. Requer produção. Recomendação: contar por filial as
> ocorrências do log `'ingestão pagamentos: leitura do flag de boleto DDA falhou (ignorada)'`
> e do log `'ingestão pagamentos: filial sem conta pagadora — sem flag de boleto'`.

## 3. Tactics — Cobertura no delta

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| **Detect Faults** | | | |
| Ping/Echo | não aplicado (o ERP Conexos não expõe healthcheck; latência é medida por request) | N/A | — |
| Monitor | logs estruturados via `LogService` em cada catch best-effort (`BUSINESS_WARN`) | ✅ | `IngestaoPagamentosService.ts:80, 90, 152`; `SispagPainelService.ts:111, 214, 351` |
| Heartbeat | não há daemon novo neste delta | N/A | — |
| Timestamp | `remessa_execucao` grava `criadoEm`; `contarExecucoesParadas` filtra por idade (15min); `titTimFinaliza` do ERP é lido para separar aberto/finalizado | ✅ | `RemessaService.ts:299-307`, `SispagPainelService.ts:43, 334-358` |
| Sanity Checking | (a) `LotePagamentoRepository.transicionarStatus` guarda `de → para` + `versaoEsperada`; (b) `LOTE_CRIADO_SCHEMA` (Zod) exige `flpCod` positivo, senão `ConexosError`; (c) regra do EXATAMENTE UM na adoção por marca d'água (`adotarPorMarcaDagua`); (d) `QUESTION_SCHEMA` rejeita envelope com 2+ perguntas mesmo contendo a allowlistada | ✅ | `RemessaService.ts:533-538, 781-799`; `ConexosSispagWriteClient.ts:22-31, 574-582` |
| Condition Monitoring | `contarExecucoesParadas` no painel expõe `remessa`/`conciliacao` em `reconciling` > 15 min + `lotesNativos` para atendimento humano | ✅ | `SispagPainelService.ts:334-358` |
| Voting | N/A (uma fonte por decisão) | N/A | — |
| Exception Detection | (a) `ErpPerguntaError` distingue pergunta interativa do ERP de falha real; (b) `BoletoSemCodigoBarrasError` distingue "não liquidável no banco" de erro genérico do `.REM` | ✅ | `ConexosSispagWriteClient.ts:139-147`; `RemessaService.ts:876-882` |
| Self-Test | N/A (probes ao vivo em `jobs/` são operacionais, não self-test do runtime) | N/A | — |
| **Recover from Faults — Preparation & Repair** | | | |
| Active Redundancy | N/A (Conexos é único; multi-tenant é AWS-alvo, não delta) | N/A | — |
| Passive Redundancy | N/A | N/A | — |
| Spare | N/A | N/A | — |
| Exception Handling | try/catch em toda escrita; `ledger.fail(key)` no catch central de `gerarRemessa`; `toConexosError` unifica embrulho | ✅ | `RemessaService.ts:567-576`; `ConexosSispagWriteClient.ts:139-147, 181-184` |
| Rollback | N/A no ERP (escrita é irreversível e não-idempotente por desenho — por isso `postGenericOnce`); local: `remessa_execucao.status='error'` é rollback de METADADO, não de efeito no ERP — retomada resolve pelo estado do ERP | N/A | — |
| Software Upgrade | N/A neste delta | N/A | — |
| Retry | leituras: `runWithRetry` (2 retries, 500 ms, jitter 200 ms, `shouldRetry` bloqueia recusa determinística); escritas: **deliberadamente ausentes** (retry duplicaria dinheiro) | ✅ | `ConexosBaseClient.ts:154-163`; `ConexosSispagWriteClient.ts:70-72` |
| Ignore Faulty Behavior | `titulosComBoletoDda` falha → `Set()` vazio; `modalidadesDisponiveisDoLote` per filial falha → boleto some da lista da filial | ⚠️ (silent — ver F-availability-1) | `IngestaoPagamentosService.ts:88-98`; `SispagPainelService.ts:298-311` |
| Graceful Degradation | (a) ingestão inteira ainda entrega a carteira mesmo se DDA cair; (b) painel entrega modalidades restantes; (c) `contarExecucoesParadas` falha ≠ painel down; (d) `filiaisLidas` só inclui filiais com sucesso (anti-fantasma na inativação); (e) painel continua monta-lote mesmo com todas as leituras AO VIVO degradadas | ✅ | `IngestaoPagamentosService.ts:133-161`; `SispagPainelService.ts:334-358` |
| Reconfiguration | N/A | N/A | — |
| **Recover from Faults — Reintroduction** | | | |
| Shadow | N/A | N/A | — |
| **State Resynchronization** | `sincronizarComErp` consulta o ERP (`getLoteNativo` + `listarChavesDoLote` + `listarArquivosRemessa` pelo NOME registrado no write-ahead) e retoma exatamente da etapa que ainda falta; adoção por marca d'água cobre a janela `criarLote respondeu / ledger não gravou`. É a tactic com maior investimento neste delta e é o que permite o re-POST pós-`QUESTION` ser seguro (se cair depois do 2º POST, a próxima tentativa lê o estado real do lote e importa só o que falta) | ✅ | `RemessaService.ts:592-809`; regra `ontology/business-rules/retomada-remessa-sispag.md` |
| Escalating Restart | N/A | N/A | — |
| Non-Stop Forwarding | N/A | N/A | — |
| **Prevent Faults** | | | |
| Removal from Service | N/A neste delta (o kill-switch `sispagLiveWriteEnabled` já existia; delta consome mas não altera) | N/A | `RemessaService.ts:184-188` |
| Predictive Model | N/A | N/A | — |
| Transactions | (a) advisory lock por lote (`db.withAdvisoryLock(chaveDeLock(loteId))` — impede dois cliques criarem dois lotes nativos); (b) advisory lock global de ingestão (`PAGAMENTO_INGEST_LOCK_KEY`); (c) idempotency-key + `remessa_execucao` como write-ahead-log; (d) `transicionarStatus(versaoEsperada)` = optimistic concurrency | ✅ | `RemessaService.ts:126-150`; `IngestaoPagamentosService.ts:54-63` |
| Exception Prevention | `BoletoSemCodigoBarrasError` **antes** de qualquer escrita elimina a classe inteira de "`.REM` sem barras", que antes só era descoberta depois do arquivo pronto — possivelmente já entregue; allowlist EXATA de 1 chave em `PERGUNTA_AUTO_RESPONDIVEL` previne auto-resposta a pergunta que muda intenção (ex.: modalidade alterada por favorecido sem conta) | ✅ | `RemessaService.ts:876-882`; `ConexosSispagWriteClient.ts:52, 574-582` |
| Increase Competence Set | (a) o re-POST allowlistado transforma `QUESTION` (que antes travava) em caminho normal para o único caso em que a resposta não move nada além do que já pedimos; (b) `sincronizarComErp` transformou 4 estados que travavam em retomada automática (só permanecem 3 fail-closed: sem `flpCod`+sem marca, 2+ candidatos ambíguos, intruso no lote) | ✅ | `ConexosSispagWriteClient.ts:512-567`; `RemessaService.ts:592-809` |

## 4. Findings

### F-availability-1: `temBoleto=false` mascara indisponibilidade da leitura DDA para o operador

- **Severidade**: P2 (débito técnico defensável — não perde dinheiro, mas fabrica retrabalho invisível)
- **Tactic violada**: `Condition Monitoring` (a degradação existe, mas não é reportada ao humano que decide)
- **Localização**:
  - `src/backend/domain/service/sispag/IngestaoPagamentosService.ts:73-99` (WARN só em log)
  - `src/backend/domain/service/sispag/SispagPainelService.ts:298-311` (falha per-filial vira set vazio, silenciosa)
  - `src/frontend/app/sispag/page.tsx:715-737` (badge "sem boleto" idêntico para "não tem" e "não sei")
- **Evidência (objetiva)**:
  ```ts
  // IngestaoPagamentosService.ts:88-98
  } catch (error) {
      await this.logService.warn({
          type: LOG_TYPE.BUSINESS_WARN,
          message: 'ingestão pagamentos: leitura do flag de boleto DDA falhou (ignorada)',
          data: { filCod, reason: … },
      });
      return new Set();
  }
  ```
  ```tsx
  // src/frontend/app/sispag/page.tsx:715-737 — mesma renderização nos dois casos:
  {t.temBoleto ? <Badge>boleto</Badge> : <span>sem boleto</span>}
  ```
- **Impacto técnico**: se o `fin015/list` ou o grid de pendentes degradar por qualquer motivo
  (`LOGIN_ERROR_MAX_SESSIONS`, 5xx, timeout dos 40 s), a filial toda aparece com `temBoleto=false`.
  A analista não distingue "esse fornecedor não tem boleto DDA" de "o sistema não conseguiu ler".
- **Impacto de negócio**: retrabalho — pode-se cadastrar TED/PIX para um fornecedor que só teria
  boleto (mais lento, tarifa TED); ou perde-se a chance de usar boleto em uma janela em que ele
  existiu. Não há perda de dinheiro; há perda de sinal. Contra-partida: WARN só é lido por quem
  abre o log do Render (documentado como "ninguém, por hábito" no comentário do próprio código —
  `SispagPainelService.ts:135-138`).
- **Métrica de baseline**: 0 sinais visuais de degradação; 100% de sobreposição entre "sem boleto
  real" (46/173 na filial 1, 364/500 na fil 2, 476/500 na fil 4, 348/500 na fil 6 — medido) e
  "leitura falhou". A carteira TEM 26% (fil 1) a 30% (fil 6) de títulos com DDA — a chance de
  invisibilidade escondida é material.

### F-availability-2: bootstrap silencioso — filial sem lote nativo nunca aprende `temBoleto`

- **Severidade**: P3 (hardening — só afeta bootstrap; nenhum tenant novo em produção neste
  momento, ver CLAUDE.md § Tenants "_(vazio)_")
- **Tactic violada**: `Sanity Checking` (o estado "sem lote" é indistinguível de "todos sem
  boleto" no retorno); `Monitor` (sem WARN)
- **Localização**: `src/backend/domain/client/ConexosSispagWriteClient.ts:439-462`
- **Evidência (objetiva)**:
  ```ts
  // ConexosSispagWriteClient.ts:445-450
  const lotes = await this.listarLotesNativos({ filCod, bncCod });
  const contexto = lotes.reduce<number | undefined>(
      (maior, l) => (maior === undefined || l.flpCod > maior ? l.flpCod : maior),
      undefined,
  );
  if (contexto === undefined) return new Set();  // ← retorno silencioso
  ```
- **Impacto técnico**: uma filial NOVA (ou uma filial em que todos os lotes tenham sido apagados)
  devolve `Set()` vazio, portanto TODOS os títulos ficam com `temBoleto=false` até o primeiro
  lote nativo existir. Não há WARN diferenciando "filial sem lote" de "grid vazio de verdade".
- **Impacto de negócio**: primeira remessa de uma filial nova nunca oferece boleto na UI. A
  analista descobre marcando BOLETO e sendo barrada por `BoletoSemCodigoBarrasError` no envio —
  o que é fail-closed correto, mas leva a ciclo "monta → tenta → erra → refaz". Bootstrap
  irritante, não incidente.
- **Métrica de baseline**: N/A — não medível (nenhuma filial nova neste repo). Custo é limitado
  à 1ª remessa por filial nova.

### F-availability-3: `modalidadesDisponiveisDoLote` — leitura do grid DDA compõe latência sem timeout específico

- **Severidade**: P2 (débito defensável — não derruba, mas empilha até o limite de 40 s do axios
  global do Conexos)
- **Tactic violada**: `Timestamp`/`Removal from Service` — nenhuma tactic elimina o cenário, mas
  o composto latência+fan-out reduz a janela de trabalho útil se o ERP degradar
- **Localização**: `src/backend/domain/service/sispag/SispagPainelService.ts:242-324`
- **Evidência (objetiva)**:
  ```ts
  // 3 fases sequenciais no request, cada uma com bounded.run(CONEXOS_FANOUT_LIMIT=4):
  //   1. titulosSettled — 1 chamada por item do lote
  //   2. contasSettled  — 1 chamada por (filCod,pesCod) distinto do lote
  //   3. boletoSettled  — 1 chamada por filial distinta + N páginas do grid (medido: 5 páginas
  //      × 500 na filial 2 com ~2020 pendentes)
  ```
- **Impacto técnico**: uma sessão com Conexos degradado ao ponto de responder no limite de 40 s
  compõe rapidamente. Para um lote com 25 itens em 2 filiais (caso típico medido):
  25 × 40 s (item) + Nfav × 40 s (contas) + 2 × 5 × 40 s (boleto) → o axios do `services/conexos.ts`
  segura por request individual, mas o request de painel não tem deadline agregado. O usuário
  vê o front dependurado.
- **Impacto de negócio**: analista fica bloqueada de montar próximos lotes durante o incidente;
  cascata de refresh multiplica pressão em cima do Conexos (`LOGIN_ERROR_MAX_SESSIONS`).
- **Métrica de baseline**: 40 000 ms por chamada individual (`services/conexos.ts:121`); nenhum
  deadline agregado no service. Fanout é bounded (4 paralelos), mas o total sequencial pode
  passar de 60 s facilmente sob degradação. Não há teste que exercite tempo total.

### F-availability-4: WARN em log do Render é o único canal de detecção de degradação de leitura DDA

- **Severidade**: P2 (mesma classe do F-availability-1, mas do lado do time de plantão em vez
  do operador de negócio)
- **Tactic violada**: `Monitor` — o meio existe, o observador não
- **Localização**: `IngestaoPagamentosService.ts:88-98`, `SispagPainelService.ts:110-122, 214-222`
- **Evidência (objetiva)**: o próprio comentário do delta admite (`SispagPainelService.ts:135-138`):
  > "Um WARN no log do Render é lido por quem abre o log, ou seja: ninguém, por hábito."
- **Impacto técnico**: um Conexos degradado só é notado quando alguém reclama do sintoma (retrabalho
  por título sem boleto), sem correlação. Sem métrica agregada, sem alerta, sem contagem de
  ocorrências por filial.
- **Impacto de negócio**: MTTD (Mean Time To Detect) = tempo até a analista abrir chamado.
  Historicamente > 1 dia neste stack (não medido, mas o `--quick` deste repo já explicita a
  ausência de CloudWatch/Sentry).
- **Métrica de baseline**: 0 alertas, 0 métricas agregadas, 1 canal (log Render). Todos os 3
  WARN novos do delta (2 na ingestão, 1 no painel) caem no mesmo balde.

## 5. Cards Kanban

### [availability-1] Sinalizar visualmente quando `temBoleto` é resultado de degradação (não ausência real)

- **Problema**
  > Quando `listarTitulosComBoletoDda` falha (5xx do Conexos, `LOGIN_ERROR_MAX_SESSIONS`,
  > filial sem lote nativo), TODOS os títulos da filial ficam com `temBoleto=false`. A UI
  > renderiza esses casos idênticos a "esse fornecedor não tem boleto DDA" (badge "sem boleto"
  > cinza). A analista não distingue e pode escolher TED/PIX quando o boleto existe (retrabalho,
  > tarifa TED, fornecedor que só recebe boleto).

- **Melhoria Proposta**
  > Persistir por filial × run a origem de `temBoleto=false` (`ok-sem-flag` vs `leitura-falhou`
  > vs `sem-lote-nativo`) e expor no `SispagPainelResponse` como `boletoDdaStatusPorFilial`.
  > Renderizar no cabeçalho de cada filial no `sispag/page.tsx` uma tag `informação de boleto
  > DDA indisponível para esta filial`. Tactic: `Condition Monitoring` visível ao operador
  > (Bass, capítulo 4). Tocar `IngestaoPagamentosService.titulosComBoletoDda`,
  > `SispagInterface`, o repository (novo campo em `run` ou tabela auxiliar), `sispag/page.tsx`.

- **Resultado Esperado**
  > A analista sabe, sem sair do painel, quais filiais estão sem informação de DDA vs. quais
  > realmente não têm boleto — 0 → 1 canal visual explícito, sobreposição de "sem boleto real"
  > × "leitura falhou" reduzida de 100% para 0%.

- **Tactic alvo**: Condition Monitoring
- **Severidade**: P2
- **Esforço estimado**: M (2–5d) — passa por 3 camadas (repo, service, front)
- **Findings relacionados**: F-availability-1, F-availability-2
- **Métricas de sucesso**:
  - Sinal visual de degradação DDA por filial: 0 → 1
  - Overlap "sem boleto real" vs "leitura falhou" na UI: 100% → 0%
- **Risco de não fazer**: retrabalho silencioso na escolha de forma de pagamento; degradação
  parcial do Conexos vira suspeita difusa da analista sem correlação com sintoma.
- **Dependências**: — (independente)

### [availability-2] Deadline agregado no `modalidadesDisponiveisDoLote` (evita empilhamento sob degradação)

- **Problema**
  > O request `modalidadesDisponiveisDoLote` faz 3 fan-outs sequenciais (títulos + favorecidos
  > + boleto DDA por filial × páginas), cada chamada limitada aos 40 s do axios global. Sob
  > degradação parcial do Conexos, o total pode passar de 60 s: o painel fica dependurado,
  > o usuário refresha, cascata de pressão sobre o pool de sessões (`LOGIN_ERROR_MAX_SESSIONS`).
  > O delta introduziu o terceiro fan-out (boleto DDA).

- **Melhoria Proposta**
  > Adicionar um `AbortController` de escopo request com deadline configurável (ex.: 30 s por
  > default via `EnvironmentProvider`) que cancela o fan-out remanescente e devolve o parcial
  > com marcadores por filial ausente. Tactic: `Removal from Service` (limita o tempo em que
  > uma dependência degradada segura o request). Tocar `SispagPainelService`, `BoundedConcurrency`
  > (aceitar sinal), `services/conexos.ts` (propagar abort).

- **Resultado Esperado**
  > 100% dos requests do painel encerram em ≤ 30 s (medido no service, não só por chamada).
  > Degradação parcial do Conexos ainda entrega o painel com aviso "modalidades da filial X
  > não puderam ser calculadas — refresh em 30 s" em vez de página dependurada.

- **Tactic alvo**: Removal from Service (composto com Ignore Faulty Behavior já existente)
- **Severidade**: P2
- **Esforço estimado**: M (2–5d)
- **Findings relacionados**: F-availability-3
- **Métricas de sucesso**:
  - Deadline agregado no service: ausente → 30 s
  - Cascata de refresh sob incidente: reduz (não medível localmente; monitorar por logs de
    `LOGIN_ERROR_MAX_SESSIONS`)
- **Risco de não fazer**: incidente parcial no Conexos vira incidente total percebido pela
  analista; multiplicador de pressão no pool de sessões.
- **Dependências**: [availability-1] ajuda (marcadores por filial são o vocabulário do parcial)

### [availability-3] Métrica agregada de degradação DDA — do WARN de log para uma contagem observável

- **Problema**
  > Os 3 WARNs novos do delta (`ingestão pagamentos: leitura do flag de boleto DDA falhou`,
  > `ingestão pagamentos: filial sem conta pagadora`, `SISPAG: leitura de lotes nativos falhou`)
  > só existem no log do Render. O próprio comentário do delta admite que "ninguém abre por
  > hábito". MTTD do incidente = tempo até a analista reclamar.

- **Melhoria Proposta**
  > Contagem por filial × dia dessas ocorrências, persistida na tabela `pagamento_ingestao_run`
  > (ou nova `sispag_leitura_degradacao`), com um KPI no painel: "Filiais com leitura DDA
  > degradada nas últimas 24 h". Tactic: `Monitor` com endpoint observável em vez de scan de
  > log. Alternativa mais leve: só emitir um LOG_TYPE novo (`DEGRADATION`) e configurar um
  > filtro no Render/Sentry (quando existir).

- **Resultado Esperado**
  > A degradação de leitura DDA vira número na tela em vez de linha de log. MTTD por
  > degradação parcial cai de "quando a analista reclama" para "próximo refresh do painel".

- **Tactic alvo**: Monitor
- **Severidade**: P2
- **Esforço estimado**: S (≤1d) para a contagem persistida; a integração com Sentry/CloudWatch
  é do backlog da migração de infra.
- **Findings relacionados**: F-availability-4, F-availability-1
- **Métricas de sucesso**:
  - Canais de detecção de degradação DDA: 1 (log) → 2 (log + KPI no painel)
  - MTTD: não medível hoje; reduzir para "≤ 1 refresh do painel" (~5 min)
- **Risco de não fazer**: incidente do Conexos degrada em silêncio até se transformar em
  reclamação. Retrabalho invisível se acumula por dias.
- **Dependências**: [availability-1] compartilha vocabulário e possivelmente storage.

## 6. Notas do agente

- O delta INVESTE em availability, não sacrifica: `sincronizarComErp` é livro-texto de
  `State Resynchronization`; o re-POST allowlistado é `Increase Competence Set` com allowlist
  EXATA (uma única chave, medida em HML); `BoletoSemCodigoBarrasError` é `Exception Prevention`
  clássica antes de qualquer escrita.
- O ponto de escrutínio nº 1 do briefing (re-POST pós-`QUESTION`) checa limpo: o 1º POST não
  escreve (medido HML 2026-08-27), o 2º é `postGenericOnce` (sem 401-retry), e uma queda pós-2º
  é absorvida por `sincronizarComErp` — o mesmo mecanismo já validado em `retomada-remessa-sispag.md`.
  Não abri finding aqui.
- Cross-QA: [availability-3] compartilha vocabulário/storage com o que a Testability/Observability
  provavelmente vai propor sobre metadata do run. Consolidator deve costurar.
- Não abri finding sobre "3ª fonte externa no `modalidadesDisponiveisDoLote`" como
  Availability — é Performance/Integrability. Só o composto latência-sem-deadline entrou aqui
  (F-availability-3).
