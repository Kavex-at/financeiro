---
qa: Fault Tolerance
qa_slug: fault-tolerance
run_id: 2026-08-25-1742-sispag-retomada
agent: qa-fault-tolerance
generated_at: 2026-08-25T18:15:00-03:00
scope: backend
score: 7
findings_count: 8
cards_count: 7
---

# Fault Tolerance — Regis-Review

## 1. Cenário Geral (Bass General Scenario aplicado ao SISPAG-retomada)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Operador humano (duplo clique / duas abas) OU falha de infra (Render restart, timeout do proxy, queda de rede) | Interrupção no meio da sequência `criarLote → importar[N×] → finalizar → gerarRemessa` (escritas fin015 não-idempotentes) OU 2º clique no mesmo lote | `RemessaService`, `ConexosSispagWriteClient`, ledger `remessa_execucao` (0049), `ConciliacaoRetornoService` + ledger `conciliacao_execucao` (0050) | Produção multi-tenant, execução assinada por operador `admin`, escrita ao vivo no Conexos habilitada | O sistema NUNCA cria um 2º lote nativo para o mesmo `lote_pagamento`; retomada consulta o estado real do ERP (não presume); onde o ERP não expõe estado verificável (marca d'água ambígua, item intruso, leitura falhou), FAIL-CLOSED com erro tipado que o operador entende | Ambiguidade real ao vivo em HML (2026-08-25): retomada dos 3 cenários VERDE (`C1 marca d'água`, `C2 import parcial`, `C3 remessa já gerada`). 0 lotes a mais do que o esperado. Zero divergência entre reportado e observado. Conciliação do `.RET` **ainda não exercitada ao vivo** (só mock). |

Referência: `ontology/business-rules/retomada-remessa-sispag.md`, `ontology/decisions/0039-*.md`, `ontology/_inbox/sispag-retomada-gap.md` (bloco "FECHADO — 2026-08-25, fim do dia").

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Escritas fin015 declaradas não-idempotentes cobertas por ledger write-ahead | 4 / 4 (`criarLote`, `importarTitulos`, `finalizarLote`, `gerarRemessa`) | 100% | ✅ | `RemessaService.ts:257-341` + `RemessaExecucaoRepository.ts` |
| Escritas fin052 (`processar`) cobertas por ledger write-ahead | 1 / 1 | 100% | ✅ | `ConciliacaoRetornoService.ts:118-210` + `ConciliacaoExecucaoRepository.ts` |
| Chamadas `postGenericOnce` (tentativa única, sem retry cego) nas escritas do delta | 3 / 3 (`criarLote`, `importarTitulos`, `gerarRemessa`) | 100% para escrita não-idempotente | ✅ | `ConexosSispagWriteClient.ts:105,442,530` |
| Endpoints POST estado-mutantes com `Idempotency-Key` derivada quando não enviada | 2 / 2 (`/lotes/:id/remessa` → `remessa:${loteId}`; `/retornos/conciliar` → `conciliacao:{fil}:{bnc}:{gtb}:{gar}`) | 100% | ✅ | `routes/sispag.ts:406-490`, `RemessaService.ts:141`, `ConciliacaoRetornoService.ts:117-121` |
| Cenários de retomada da REMESSA cobertos por teste unitário | 12+ (`gate de estado` + `idempotência` + `retomada — perguntar ao ERP` + `retry após falha`) | ≥ mecanismos documentados na regra | ✅ | `RemessaService.test.ts` linhas 181-616 |
| Cenários de retomada da REMESSA validados AO VIVO em HML | 3 / 3 (`marca d'água`, `import parcial`, `remessa já gerada`) | 3 / 3 | ✅ | `sispag-retomada-gap.md` (bloco FECHADO), `jobs/validate-retomada-remessa-v1.ts` |
| Cenários da CONCILIAÇÃO validados AO VIVO em HML | 0 / 4 | 4 / 4 (arquivo já processado; arquivo existe sem `processadoEm`; leitura falha; caminho normal) | ❌ | `_shared-metrics.md` linha 45 "NAO exercitada ao vivo nesta bateria: a perna de VOLTA" |
| Serialização de tentativas concorrentes de `gerarRemessa` para o MESMO `loteId` | Nenhuma no serviço (só `heavyRouteLimiter` por IP na rota) | Serial (advisory lock por `loteId` OU curto-circuito em `reconciling` do MESMO worker) | ❌ | `RemessaService.gerarRemessa`, `LotePagamentoService.ts:201` usa `withAdvisoryLock` — o padrão existe, mas não é aplicado aqui |
| Erros tipados que a UI diferencia de falha genérica | 3 / 3 (`REMESSA_EM_DUVIDA`, `LOTE_ANTERIOR_CANCELADO`, `ERP_PERGUNTA`) | 3 / 3 | ✅ | `frontend/lib/sispag.ts:127-158`, `page.tsx:340-364` |
| `LoteAnteriorCanceladoError` requer confirmação humana explícita (nunca default) | Sim (`req.body?.confirmarNovoLote === true` só quando `=== true`; `RemessaService.ts` linha 41-46 sem default) | Sim | ✅ | `routes/sispag.ts:425`, `RemessaService.ts:41-46` |
| Marca d'água é CONJUNTO (não máximo) — flpCod não é monotônico | Sim (`marcaFlpCods: number[]` + `!marca.has(l.flpCod)`) | Sim | ✅ | `RemessaService.ts:305-315,700-704` + teste "ADOTA um lote com flpCod MENOR que o máximo" |
| Adoção por marca d'água exige `candidates.length === 1` | Sim (candidates > 1 → `indeterminado` → `RemessaEmDuvidaError`) | Sim | ✅ | `RemessaService.ts:718-728` + teste "DOIS candidatos … é FAIL-CLOSED" |
| Falha de LEITURA distinguida de "vazio" (`undefined` vs `Set` vazio) | Sim (`listarChavesDoLote` → `undefined`; `getArquivoRetorno` → `undefined`) | Sim | ✅ | `ConexosSispagWriteClient.ts:279-296`, `RemessaService.ts:585-593` |
| Chave de item de import inclui `filCod` (mitiga colisão cross-filial) | Sim (`${filCod}:${docCod}:${titCod}`) | Sim | ✅ | `RemessaService.ts:755-758` + commit 9c73d1a |
| Filtro `filCod#EQ` no `fin015/list` (previne contaminação da marca d'água) | Sim | Sim | ✅ | `ConexosSispagWriteClient.ts:167-172` + commit c6342db |
| Cobertura paginada de `listarLotesNativos` (fonte da marca d'água) | Apenas 1ª página, `pageSize: 500` | Paginar até esgotar, OU explodir se `count > pageSize` | ⚠️ | `ConexosSispagWriteClient.ts:157-165` — sem loop de paginação; `HML max ~40 lotes/(fil,bnc)` hoje, mas o mecanismo cresce com o tempo |
| Reaper de execuções presas em `reconciling` presente | Sim (`jobs/reaper-sispag-reconciling.ts`, `SISPAG_REAPER_MIN=15`) | Sim + agendado | ⚠️ | `package.json:24` `job:reaper-sispag`; `render.yaml` **não agenda** (grep `reaper` → nenhuma linha) |
| Conciliação escreve itens + transição do lote na MESMA transação DB | Sim (`db.withTransaction`) | Sim | ✅ | `ConciliacaoRetornoService.ts:287-352` + teste "itens e transição rodam DENTRO da mesma transação" |
| Remessa escreve `setRemessaGerada` + `transicionarStatus` + `ledger.settle` na mesma transação | **Não** (3 chamadas SQL separadas fora de `withTransaction`) | Sim, OU retomada cobrir o gap | ⚠️ | `RemessaService.ts:452-465`; gap coberto parcialmente por retomada (ver F-fault-tolerance-4) |
| Verificação de rows afetadas em `transicionarStatus` dentro da remessa | **Não** (retorno ignorado) | Sim (log de warn como no `ConciliacaoRetornoService.transicionarLote`) | ⚠️ | `RemessaService.ts:459-464` vs `ConciliacaoRetornoService.ts:428-440` |
| MTTR observado em HML após interrupção (do erro à retomada VERDE) | Não medível localmente | < 60 s | ⚠️ | Requer instrumentação de métrica no reaper + logs; hoje só WARN textual |
| Taxa observada de execuções presas em `reconciling` (produção) | ⚠️ **Não medível localmente**: requer CloudWatch/Render logs + query em `remessa_execucao WHERE status='reconciling'` | < 1% das execuções por dia | ⚠️ | Recomendação: publicar métrica pelo próprio reaper (`total`, `remessa=N`, `conciliacao=M`) para painel de observabilidade |

## 3. Tactics — Cobertura no delta

Bass & Clements — Fault Tolerance tactics + o canon (idempotency, forward recovery, quarantine). Onde a tactic é responsabilidade da camada abaixo (base client, driver `pg`), marcada N/A com justificativa.

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| **Substitution** | N/A — não há redundância ativa/passiva do ERP; Conexos é fonte única | N/A | ADR-0039 é explícito: "onde o ERP expõe estado verificável" |
| **Replacement** | N/A — mesma razão | N/A | — |
| **Predictive Model** | N/A neste delta | N/A | — |
| **Increase Competence Set** | Retomada AMPLIA o conjunto de estados dos quais o sistema se recupera sem ajuda humana (5→7 dos 8 desfechos, per ADR-0039); erro `LoteAnteriorCanceladoError` transforma 1 desfecho travado em pergunta de 1 clique | ✅ presente | `RemessaService.sincronizarComErp:496-620` |
| **Sanity Checking** | Zod no boundary de escrita (`LOTE_CRIADO_SCHEMA`); rejeição por chave incompleta (`título é da filial X, mas o lote é da Y`); validação de shape da resposta de `sugerirRemessa` | ✅ presente | `ConexosSispagWriteClient.ts:22-31,504-508`; `RemessaService.ts:786-793` |
| **Comparison** | `listarChavesDoLote` vs `lote.itens` para calcular delta em import parcial; comparação de `nomeArquivo` esperado × recebido em `listarArquivosRemessa`; comparação `intrusos` (item não-nosso) | ✅ presente | `RemessaService.ts:600-620,441-449` |
| **Timestamp** | `atualizado_em` no ledger + `flpTimFinaliza` do fin015 lido de volta; `processadoEm` no fin052 usado como sinal booleano | ✅ presente | `RemessaExecucaoRepository.ts:63-72`; `ConciliacaoRetornoService.ts:150-158` |
| **Timeout** | Herdado do `ConexosBaseClient` (mesma superfície das outras frentes) | ✅ presente (fora do delta) | Cross-QA: `qa-availability`/`qa-performance` |
| **Condition Monitoring** | Reaper `reaper-sispag-reconciling` consulta ledgers e loga órfãos; endpoint `GET /sispag/execucoes?paradasHaMin=` para triagem manual | ⚠️ parcial | `jobs/reaper-sispag-reconciling.ts`; **não agendado no `render.yaml`** — depende de cron manual (F-fault-tolerance-7) |
| **Self-Test** | `jobs/validate-retomada-remessa-v1.ts` valida os 3 cenários AO VIVO (verde 2026-08-25) | ✅ presente (só para remessa); ❌ ausente para conciliação | `_shared-metrics.md` linha 45; `jobs/validate-retomada-remessa-v1.ts` |
| **Voting** | N/A | N/A | — |
| **Redundancy (Active/Passive)** | N/A no domínio deste delta | N/A | — |
| **Recovery — Rollback** | Transação PG na conciliação (`withTransaction`); ROLLBACK automático em qualquer throw | ✅ presente para conciliação | `ConciliacaoRetornoService.ts:287-352` + teste "falha no meio do loop propaga — a transação inteira desfaz" |
| **Recovery — Forward** | Retomada consulta ERP e pula apenas etapas comprovadamente concluídas; conciliação parcial (`varreduraIncompleta=true`) mantém o lote em `RETORNADO` (não fecha), permitindo 2ª passada | ✅ presente | `RemessaService.sincronizarComErp`; `ConciliacaoRetornoService.ts:270-283,374-381` |
| **Reintroduction — Shadow** | N/A (não há shadow node do ERP) | N/A | — |
| **Reintroduction — State Resync** | É EXATAMENTE o que `sincronizarComErp` faz: reanexa ao estado real do ERP em vez de presumir | ✅ presente (peça central do delta) | `RemessaService.ts:496-620` |
| **Reintroduction — Escalating Restart** | N/A no processo (Render restart é o nível 0; o mecanismo de retomada é o "escalado") | N/A | — |
| **Idempotent Replay** | Ledger com `ON CONFLICT (idempotency_key) DO UPDATE` preservando `settled`; `settled` curto-circuita totalmente | ✅ presente | `RemessaExecucaoRepository.beginExecution:74-105`; `ConciliacaoExecucaoRepository` idem |
| **Compensating Transaction** | Não existe (não há undo de `criarLote`/`processar` no ERP). Substituída por FORWARD RECOVERY documentada em ADR-0039 e pela pergunta ao humano (`LoteAnteriorCanceladoError`) — decisão explícita, não oversight | ✅ presente (como política) | `LoteAnteriorCanceladoError.ts`; ADR-0039 seção "O caso que a decisão NÃO resolve" |
| **Reconcile** | `sincronizarComErp` (remessa); `getArquivoRetorno.processadoEm` (conciliação); comparação `flpVldStatus` medida em produção como oráculo | ✅ presente | Regra de retomada, tabela "Estado observado no ERP" |
| **Quarantine** | Órfão indeterminado NUNCA é retentado às cegas: `RemessaEmDuvidaError`/`ConciliacaoEmDuvidaError` (409, retryable=false), reaper flag em WARN, `GET /sispag/execucoes` para triagem | ✅ presente | `RemessaService.ts:210-232`; `ConciliacaoRetornoService.ts:170-190` |

## 4. Findings

### F-fault-tolerance-1: Duas tentativas concorrentes de `gerarRemessa` para o MESMO `loteId` não são serializadas — janela real para dois lotes nativos

- **Severidade**: **P0** (crítico — o dano exato que o mecanismo existe para evitar)
- **Tactic violada**: Idempotent Replay (não é suficiente sem serialização); Quarantine (não escalona antes do POST)
- **Localização**: `src/backend/domain/service/sispag/RemessaService.ts:141-172` (`beginExecution` + `findByIdempotencyKey`); `src/backend/domain/repository/sispag/RemessaExecucaoRepository.ts:69-105`
- **Evidência (objetiva)**:
  ```
  # RemessaService.gerarRemessa NÃO chama db.withAdvisoryLock — o padrão existe no mesmo módulo:
  $ grep -n "withAdvisoryLock" src/backend/domain/service/sispag/*.ts
  IngestaoPagamentosService.ts:52
  LotePagamentoService.ts:201
  FormacaoLotesService.ts:42
  RemessaService.ts:                # (nenhuma ocorrência)

  # heavyRouteLimiter é POR IP (não por loteId) — dois operadores em máquinas diferentes o burlam.
  ```
  Cenário de corrida:
  1. Op1 e Op2 clicam "Gerar remessa" no mesmo lote quase simultaneamente.
  2. Ambos passam pelo `findByIdempotencyKey` → `null` (primeira tentativa).
  3. Ambos executam `beginExecution` — a segunda upserta a linha, ambos veem `status='reconciling'`.
  4. Ambos gravam `setRequestPayload({marcaFlpCods:[...]})` com a MESMA marca.
  5. Ambos executam `criarLote` → o ERP cria **dois** lotes nativos (D e E).
  6. Ambos executam `setNativeFlpCod` — a última escrita vence (D é sobrescrito por E, ou vice-versa).
  7. Ambos importam os itens (mesmo conjunto), finalizam e geram remessa.
  8. `.REM` do primeiro vai para o banco; `.REM` do segundo também. **Pagamento em duplicidade.**

  A retomada não protege este caso: a corrida acontece em execuções PARALELAS, não em uma execução interrompida.
- **Impacto técnico**: Duplicação silenciosa do lote nativo; ambos os `.REM` ficam válidos no banco; a próxima conciliação vai casar itens de ambos os lotes com o mesmo `lote_pagamento`.
- **Impacto de negócio**: Pagamento em dobro para todos os fornecedores do lote. É exatamente o dano que motivou o ledger write-ahead (ADR-0013) e que a retomada (ADR-0039) preserva. A doutrina está protegida contra INTERRUPÇÃO, mas não contra CONCORRÊNCIA. Custo direto = valor total do lote; recuperação exige estorno bancário e conversa com o fornecedor.
- **Métrica de baseline**: 0 mecanismos de serialização (advisory lock por loteId, `SELECT … FOR UPDATE`, ou rejeição early quando `anterior.status === 'reconciling'` numa execução IN-FLIGHT do MESMO worker). Alvo: 1.

### F-fault-tolerance-2: Perna de VOLTA (conciliação `.RET` / `processar` do fin052) nunca exercitada AO VIVO

- **Severidade**: **P0** (`processar` é irreversível — gera baixas no fin010 que não têm undo)
- **Tactic violada**: Self-Test
- **Localização**: `src/backend/domain/service/sispag/ConciliacaoRetornoService.ts` inteiro; **não há** `jobs/validate-conciliacao-*.ts`
- **Evidência (objetiva)**:
  ```
  $ ls src/backend/jobs/ | grep -Ei "validate|conciliac"
  validate-retomada-remessa-v1.ts

  # _shared-metrics.md, linha 45:
  # "NAO exercitada ao vivo nesta bateria: a perna de VOLTA (conciliacao do .RET)."
  ```
  A remessa passou por 3 rodadas ao vivo em HML e revelou 6 defeitos de produção que teste mockado não pegou (import 1/chamada, `titulosCount` mentira, filial na chave, `filCod#EQ`, encoding do `.REM`, `flpCod` não-monotônico — ver `_shared-metrics.md` "Defeitos de producao achados pelo gate ao vivo"). Simetria do risco: a conciliação tem o MESMO shape de risco (escrita fin052 irreversível, leitura por evento com filtro exato, retomada via `processadoEm`) e nenhuma exposição ao ERP real.
- **Impacto técnico**: Shape do `processar`, retorno do `getArquivoRetorno`, comportamento real de `listDetalhe` sob rejeição/reprocessamento — todos apoiados em suposição documentada, não em observação. Um `MODEL_INCONSISTENCY` análogo ao do import quebraria a primeira conciliação real da Columbia.
- **Impacto de negócio**: Baixas do fin010 são o registro contábil de que o fornecedor foi pago. Baixa duplicada = valor a pagar zerado 2x = descontrole de saldo. Baixa não-gravada = fornecedor cobra de novo. A varredura AO VIVO foi o único gate que pegou os 6 defeitos da remessa; sem ela, o retorno está apoiado em fé.
- **Métrica de baseline**: 0 / 4 cenários exercitados AO VIVO (arquivo processado antes; existe sem `processadoEm`; leitura falhou; caminho normal). Alvo: 4 / 4.

### F-fault-tolerance-3: `listarLotesNativos` lê só a 1ª página (500 lotes) — marca d'água fica incompleta quando `(filCod, bncCod)` passa desse teto

- **Severidade**: **P1** (silencioso; hoje HML tem ~40 lotes/(fil,bnc), mas o mecanismo cresce ~200/ano/filial × 6 filiais × N bancos)
- **Tactic violada**: Sanity Checking (silêncio no truncamento); Reconcile (marca d'água contaminada)
- **Localização**: `src/backend/domain/client/ConexosSispagWriteClient.ts:157-193` (`listarLotesNativos`)
- **Evidência (objetiva)**:
  ```typescript
  // ConexosSispagWriteClient.ts:157-165 — sem loop de paginação, sem aviso de truncamento
  return this.base.listGenericPaginated<Record<string, unknown>>(
      path,
      {
          fieldList: [],
          filterList: { 'bncCod#EQ': bncCod, 'filCod#EQ': filCod },
          serviceName: 'fin015',
          pageNumber: 1,        // ← FIXO
          pageSize: 500,        // ← teto silencioso
      },
      { filCod },
  );
  ```
  Compare com `listarTitulosPendentes` (mesmo arquivo, linhas 300-378), que **PAGINA de verdade** e imprime aviso quando trunca — mecanismo introduzido por bug pregresso ("silêncio aqui reintroduz o bug: quem chama precisa saber que viu um pedaço").
- **Impacto técnico**: Quando `(fil, bnc)` tem > 500 lotes históricos, o conjunto `marca` gravado no ledger não contém os lotes de flpCod antigo. Num crash entre `criarLote` e `setNativeFlpCod`, o `adotarPorMarcaDagua` pode achar **candidatos falsos** (lotes antigos que sempre existiram, mas não estão na marca) e ou (a) adotar um lote que não é nosso (se `candidatos.length===1`) — dinheiro do outro lote, ou (b) escalonar `indeterminado` sem motivo real.
- **Impacto de negócio**: Curto prazo (HML/2026): 0. Médio prazo (Columbia em produção com histórico crescente): P0 latente. O primeiro caso (a) é o mesmo dano de F-fault-tolerance-1: pagamento no lote errado, com valores diferentes.
- **Métrica de baseline**: 1 página de 500 lidos, sem detecção de truncamento. Alvo: paginação até esgotar OU throw explícito quando `count > acumulado.length`.

### F-fault-tolerance-4: Se DB crashar entre `loteRepo.transicionarStatus(→REMESSA_GERADA)` e `ledger.settle`, o ledger fica PRESO em `reconciling` sem caminho de autocura

- **Severidade**: **P1** (janela estreita; reaper flag em WARN, mas exige intervenção manual em SQL)
- **Tactic violada**: Rollback (ausência de transação); Recovery — Forward (retomada não cobre este estado)
- **Localização**: `src/backend/domain/service/sispag/RemessaService.ts:452-465`
- **Evidência (objetiva)**:
  ```typescript
  // Três SQLs separados, FORA de qualquer withTransaction:
  await this.loteRepo.setRemessaGerada({ loteId, gabCod, arquivo, numRemessa });
  await this.loteRepo.transicionarStatus({ id, de:[FINALIZADO], para: REMESSA_GERADA, versaoEsperada });
  await this.ledger.settle(key, { nativeGabCod });
  ```
  Se o processo morrer entre a linha 2 e a linha 3, o `lote_pagamento` está em `REMESSA_GERADA` e a `remessa_execucao` continua `reconciling`. Na próxima tentativa:
  ```typescript
  // RemessaService.gerarRemessa linhas 122-131 — gate na entrada:
  if (lote.status !== LOTE_STATUS.FINALIZADO) {
      throw new LoteEstadoInvalidoError({ /* … */ motivo: 'Só um lote FINALIZADO pode virar remessa.' });
  }
  ```
  A tentativa é rejeitada. O `sincronizarComErp` **nunca roda** porque o gate está antes. Ledger fica em `reconciling` até alguém rodar SQL manual.
- **Impacto técnico**: 1 lote por incidente presente para sempre no reaper como falso positivo. O `.REM` foi gerado e baixado, mas o painel/trilha continua sinalizando "execução parada".
- **Impacto de negócio**: Ruído no painel de execuções paradas (o operador aprende a ignorar); risco de mascarar um órfão REAL misturado com os falsos.
- **Métrica de baseline**: 3 escritas seriais sem transação. Alvo: `withTransaction` cobrindo `setRemessaGerada` + `transicionarStatus` + `ledger.settle`, OU permitir `settle` idempotente quando `lote.status === REMESSA_GERADA` e `ledger.nativeFlpCod === lote.nativeFlpCod`.

### F-fault-tolerance-5: `RemessaService` não verifica rows afetadas em `transicionarStatus` — versão desalinhada passa despercebida

- **Severidade**: **P1** (versionamento otimista silenciosamente ignorado; assimetria com `ConciliacaoRetornoService.transicionarLote` que faz o check)
- **Tactic violada**: Sanity Checking (retorno da mutação ignorado); Detect Faults
- **Localização**: `src/backend/domain/service/sispag/RemessaService.ts:459-464`
- **Evidência (objetiva)**:
  ```typescript
  // RemessaService.ts:459-464 (retorno IGNORADO):
  await this.loteRepo.transicionarStatus({
      id: lote.id,
      de: [LOTE_STATUS.FINALIZADO],
      para: LOTE_STATUS.REMESSA_GERADA,
      versaoEsperada: lote.versao,
  });

  // ConciliacaoRetornoService.ts:428-440 (mesmo repo, retorno VERIFICADO):
  const afetadas = await this.loteRepo.transicionarStatus({ /* … */ }, tx);
  if (afetadas === 0) {
      await this.logService.warn({ /* estado ou versão inesperados */ });
  }
  ```
- **Impacto técnico**: Se `lote.versao` foi incrementada por concorrente entre `getLoteComItens` e este ponto, `transicionarStatus` afeta 0 rows. O `.REM` está gerado no ERP, o `settle` roda logo depois, o ledger fecha, e o `lote_pagamento` FICA em `FINALIZADO`. Estado inconsistente que nenhum gate posterior corrige.
- **Impacto de negócio**: Painel mostra lote como FINALIZADO (não como REMESSA_GERADA); operador pode tentar "gerar remessa" outra vez e trombar em `LoteEstadoInvalidoError` (ok) OU pior — a implementação corrente entra no fluxo idempotente do ledger e devolve o `.REM` existente via `sync.etapa === 'concluido'`, o que é sorte, não desenho.
- **Métrica de baseline**: 0 dos 2 callsites de `transicionarStatus` no `RemessaService` verificam rows afetadas. Alvo: 2 / 2.

### F-fault-tolerance-6: `listarChavesDoLote` engole 401/timeout/5xx/exception como `undefined` — telemetria uniforme perde o motivo real

- **Severidade**: **P2** (fail-closed é correto; o problema é diagnóstico)
- **Tactic violada**: Condition Monitoring (perda de sinal para o operador)
- **Localização**: `src/backend/domain/client/ConexosSispagWriteClient.ts:288-296`
- **Evidência (objetiva)**:
  ```typescript
  } catch {
      return undefined;   // ← nenhum log, nenhum tipo diferenciado
  }
  ```
  Contraste: `ConciliacaoRetornoService.ts` diferencia `eventosNaoLidos.push({ evento, motivo })` e loga cada falha por evento (`falha ao ler detalhe de evento`). Aqui o silêncio é uniforme: sessão expirada e timeout do proxy caem no mesmo `undefined`.
- **Impacto técnico**: Quando a retomada escala para `indeterminado` por "lista de itens não pôde ser lida", o operador vê `RemessaEmDuvidaError` no log sem saber se foi rede, autenticação, ou payload malformado.
- **Impacto de negócio**: Aumenta MTTR em incidentes reais. Não é dano direto — mas o diferencial do delta é justamente "não sei" ≠ "vazio", e ficar sem o "por quê" enfraquece essa distinção.
- **Métrica de baseline**: 0 de 3 leitura críticas (`listarChavesDoLote`, `getLoteNativo` 404-branch, `getArquivoRetorno`) logam o motivo do fail-closed. Alvo: log estruturado (`type: LOG_TYPE.CONEXOS_ERROR`) em cada caminho de undefined.

### F-fault-tolerance-7: Reaper `reaper-sispag-reconciling` documentado mas NÃO agendado no `render.yaml`

- **Severidade**: **P2** (o script existe e roda; falta o agendamento em produção)
- **Tactic violada**: Condition Monitoring (não dispara sozinho)
- **Localização**: `src/backend/package.json:24` (script existe); `render.yaml` (não referencia)
- **Evidência (objetiva)**:
  ```
  $ grep -in "reaper\|cron" render.yaml
  # (só a linha do PISO da ingestão da Frente IV — nenhum reaper)

  $ grep -in "reaper" src/backend/package.json
  24:  "job:reaper-sispag": "tsx jobs/reaper-sispag-reconciling.ts",

  # jobs/reaper-sispag-reconciling.ts:22-25 (documentação do próprio job):
  # CRON (não configurado — entrada documentada):
  #   */15 * * * *  cd /caminho/do/repo/src/backend && npm run job:reaper-sispag
  ```
- **Impacto técnico**: A trilha existe (`GET /sispag/execucoes?paradasHaMin=`), mas depende de alguém abrir o endpoint. Órfãos silenciosos até um operador esbarrar num 409 — que pode ser "dias depois, ou nunca" (palavra do próprio comentário do job).
- **Impacto de negócio**: F-fault-tolerance-1 (concorrência) e F-fault-tolerance-4 (crash entre transições) precisam do reaper agendado para virarem "visíveis"; sem cron, o mecanismo de detecção existe mas dorme.
- **Métrica de baseline**: 0 agendamentos em `render.yaml` ou crontab. Alvo: 1 (`*/15 * * * *`).

### F-fault-tolerance-8: `processar` do fin052 fora da transação DB, sem checkpoint incremental de itens

- **Severidade**: **P3** (desperdício de trabalho, não corrupção)
- **Tactic violada**: Recovery — Forward (granularidade grossa)
- **Localização**: `src/backend/domain/service/sispag/ConciliacaoRetornoService.ts:200-352`
- **Evidência (objetiva)**:
  ```
  Ordem:
  1. ledger.marcarProcessado (fora da tx)
  2. retorno.processarArquivoRetorno (irreversível no ERP, fora da tx)
  3. varredura de eventos (fora da tx, ~92s p50 no Bradesco em serial → agora paralelo)
  4. withTransaction(itens + transicionarLote)   ← ATÔMICO
  ```
  Se o processo morrer no passo 3 após ler 100 de 153 eventos, a próxima tentativa (a) NÃO refaz `processar` (`processadoEm` no ERP) — bom, e (b) refaz a varredura INTEIRA dos 153 eventos — desperdício.
- **Impacto técnico**: Retomada da conciliação sempre parte do zero na varredura, mesmo depois de ter lido 90% dos eventos.
- **Impacto de negócio**: Latência extra em retomadas do retorno; nada além disso. Corrigir exige checkpoint por evento no ledger (ex.: `eventos_lidos jsonb`).
- **Métrica de baseline**: 0 checkpoints intermediários. Alvo: opcional — não é bloqueante para a saúde do sistema.

## 5. Cards Kanban

### [fault-tolerance-1] Serializar `gerarRemessa` por `loteId` com advisory lock (ou rejeitar early execução paralela)

- **Problema**
  > Duas requisições concorrentes de `gerarRemessa` para o mesmo `loteId` (dois cliques, duas abas, dois operadores) não são serializadas: ambas passam pelo ledger, ambas gravam a marca d'água simultaneamente e ambas executam `criarLote` no fin015 — resultando em dois lotes nativos, dois `.REM`, dois pagamentos. O ledger write-ahead protege contra INTERRUPÇÃO, não contra CONCORRÊNCIA. Só o `heavyRouteLimiter` (por IP) atrapalha o cenário — insuficiente para operadores em máquinas distintas.

- **Melhoria Proposta**
  > Envolver `RemessaService.gerarRemessa` em `db.withAdvisoryLock(hash(loteId), onAcquired, onBusy)` — mesmo padrão usado em `LotePagamentoService.ts:201` e `IngestaoPagamentosService.ts:52`. Na função `onBusy`, devolver 409 tipado (`GerarRemessaEmAndamentoError`) que a UI já entende ("tentativa em andamento — aguarde"). Alternativa mais leve: no ledger, dentro do mesmo `beginExecution`, se `anterior.status === 'reconciling'` E `now() - anterior.atualizado_em < LIMITE_JANELA` (ex.: 60s), tratar como "em voo" e rejeitar em vez de entrar no `sincronizarComErp`. Tactic Bass: **Quarantine** antecipado.

- **Resultado Esperado**
  > Duas requisições paralelas para o MESMO `loteId` resultam em: (a) 1 processada normalmente, (b) 1 rejeitada com 409 antes de qualquer POST no ERP. Zero lotes nativos duplicados sob carga concorrente. Métrica observável: teste de integração que dispara 2 promises paralelas → 1 sucesso + 1 `GerarRemessaEmAndamentoError`.

- **Tactic alvo**: Quarantine + Idempotent Replay (serialização)
- **Severidade**: **P0**
- **Esforço estimado**: S (≤1d) — o helper `withAdvisoryLock` já existe e é usado por 3 serviços vizinhos
- **Findings relacionados**: F-fault-tolerance-1
- **Métricas de sucesso**:
  - Mecanismos de serialização por `loteId` no `RemessaService`: 0 → 1
  - Teste de concorrência (2 promises paralelas para o mesmo lote): ausente → presente e VERDE
- **Risco de não fazer**: Pagamento em duplicidade num duplo clique ou dois operadores. Primeira ocorrência em produção = valor total do lote em prejuízo, mais o estorno bancário e a conversa com o fornecedor.
- **Dependências**: nenhuma

### [fault-tolerance-2] Escrever `jobs/validate-conciliacao-retorno-v1.ts` e rodar AO VIVO em HML

- **Problema**
  > A perna de VOLTA (conciliação `.RET` + `processar` do fin052) está toda apoiada em teste mockado. Nenhum cenário foi exercitado contra o ERP real. Simetria com a remessa: aquela batelada de gate AO VIVO revelou **6 defeitos de produção** que nenhum mock pegou (`_shared-metrics.md` "Defeitos de producao achados pelo gate ao vivo"). O `processar` do fin052 é **irreversível** — gera baixas no fin010 sem undo. É a área do delta com maior blast radius e menor exposição real.

- **Melhoria Proposta**
  > Escrever `validate-conciliacao-retorno-v1.ts` no molde do `validate-retomada-remessa-v1.ts`, cobrindo os 4 cenários da regra: (i) arquivo já processado antes → não re-processa, segue da leitura; (ii) arquivo existe sem `processadoEm` → refaz com segurança; (iii) leitura do arquivo falha → `ConciliacaoEmDuvidaError` (fail-closed); (iv) caminho normal — arquivo real do banco em HML, PIX/TED de teste, conciliação até fechar o lote em BAIXADO. Executor read-only em HML por padrão, `SISPAG_LIVE_WRITE_ENABLED` explícito para (i)-(iv). Documentar em `sispag-retomada-gap.md` o placar (como foi feito para a remessa). Tactic Bass: **Self-Test**.

- **Resultado Esperado**
  > Cenários AO VIVO da conciliação: 0/4 → 4/4. Igual à cobertura obtida na remessa (que fechou 3/3 e pegou 6 bugs). Registro escrito no `sispag-retomada-gap.md` seguindo o formato "Placar final".

- **Tactic alvo**: Self-Test
- **Severidade**: **P0**
- **Esforço estimado**: M (2–5d) — precisa achar/plantar `.RET` de teste em HML; conversa com o operacional para não gerar baixa que polua o dev
- **Findings relacionados**: F-fault-tolerance-2
- **Métricas de sucesso**:
  - Cenários da conciliação exercitados AO VIVO: 0 / 4 → 4 / 4
  - Defeitos de produção descobertos e corrigidos ANTES do primeiro `.RET` real da Columbia: > 0 esperado (baseado no histórico da remessa)
- **Risco de não fazer**: O 1º `.RET` real da Columbia é o ambiente de descoberta dos defeitos análogos aos 6 da remessa — só que em cima de baixa no fin010 sem undo.
- **Dependências**: coordenação com Yuri para plantar arquivo em HML; não precisa esperar F-fault-tolerance-1

### [fault-tolerance-3] `listarLotesNativos` deve paginar até esgotar OU explodir com aviso se truncar

- **Problema**
  > A fonte da marca d'água (`listarLotesNativos`) lê apenas a 1ª página de 500 lotes, sem loop e sem aviso de truncamento. Contraste direto com `listarTitulosPendentes` no mesmo arquivo, que pagina de verdade *porque um bug anterior mostrou que o silêncio no truncamento é o defeito*. Enquanto (fil, bnc) tem < 500 lotes históricos, não há dano. Passando desse teto — inevitável para a Columbia em produção — a marca fica incompleta e um órfão cujo `flpCod` estava fora dos 500 vira "candidato" (falso positivo). A regra do "exatamente um" pode adotar o errado (dinheiro no lote de outro) ou escalar para `indeterminado` sem motivo real.

- **Melhoria Proposta**
  > Copiar o padrão de `listarTitulosPendentes` (mesmo arquivo, linhas 300-378): loop com `while (pagina < maxPaginas)`, parada por `count` alcançado ou página curta, `console.warn` explícito se truncar em `maxPaginas`. Como a marca d'água usa este resultado, é razoável também explodir (throw) se o truncamento acontecer, em vez de só avisar — porque uma marca truncada quebra a garantia de "exatamente um". Tactic Bass: **Sanity Checking**.

- **Resultado Esperado**
  > Marca d'água sempre contém 100% dos lotes de `(filCod, bncCod)`. Quando o pool crescer além do teto, o próprio código avisa (ou explode) em vez de degradar silenciosamente.

- **Tactic alvo**: Sanity Checking + Reconcile
- **Severidade**: **P1**
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-fault-tolerance-3
- **Métricas de sucesso**:
  - Cobertura de paginação em `listarLotesNativos`: 1 página fixa → esgotamento OU throw explícito
  - Teste: mock devolvendo `count=1200 pageSize=500` → 3 páginas lidas OU throw
- **Risco de não fazer**: F-fault-tolerance-1-like em produção sem duplo clique — só pelo crescimento natural do histórico. Latente hoje, P0 amanhã.
- **Dependências**: nenhuma

### [fault-tolerance-4] Fechar a janela `REMESSA_GERADA` + `ledger.reconciling` — autocura ou transação

- **Problema**
  > `RemessaService.gerarRemessa` faz 3 escritas SQL seriais (`setRemessaGerada` → `transicionarStatus(→REMESSA_GERADA)` → `ledger.settle`) sem `withTransaction`. Um crash entre a 2ª e a 3ª deixa o lote em `REMESSA_GERADA` e o ledger em `reconciling` — combinação que a retomada NÃO cobre (o gate de entrada exige `status === FINALIZADO`). O reaper flag no WARN, mas ninguém consegue fechar o ledger programaticamente — precisa de SQL manual.

- **Melhoria Proposta**
  > Duas opções, escolha uma: **(A)** envolver as 3 escritas em `db.withTransaction` — atomicidade real, mas exige assinar os métodos do repo com `tx` opcional (padrão já em uso na conciliação, linhas 320-354); **(B)** ampliar o `sincronizarComErp` para reconhecer também `lote.status === REMESSA_GERADA && ledger.status === 'reconciling'` como "concluído no ERP e no nosso banco, só o ledger não fechou" e chamar `ledger.settle` — autocura pura, mais barata. A (B) segue a doutrina do ADR-0039 ("perguntar em vez de supor"). Tactic Bass: **Rollback** (A) OU **Forward Recovery** (B).

- **Resultado Esperado**
  > Um crash entre `transicionarStatus` e `ledger.settle` é auto-recuperado na próxima tentativa (opção B) OU nunca acontece (opção A). Reaper deixa de emitir falsos positivos para esta janela específica.

- **Tactic alvo**: Rollback OU Recovery — Forward
- **Severidade**: **P1**
- **Esforço estimado**: S (≤1d) — opção B; M (2–3d) — opção A
- **Findings relacionados**: F-fault-tolerance-4
- **Métricas de sucesso**:
  - Cenários de crash entre transição local e settle cobertos: 0 → 1 (teste dedicado no `RemessaService.test.ts`)
  - Falsos positivos do reaper por este motivo: N → 0
- **Risco de não fazer**: Ruído crônico no reaper que acostuma o operador a ignorar, mascarando um órfão REAL.
- **Dependências**: nenhuma

### [fault-tolerance-5] Verificar rows afetadas em `transicionarStatus` dentro do `RemessaService`

- **Problema**
  > `RemessaService.transicionarStatus(→REMESSA_GERADA)` na linha 459 ignora o retorno da chamada — assimetria direta com `ConciliacaoRetornoService.transicionarLote` (linhas 428-440), que loga WARN quando `afetadas === 0`. Numa colisão de `versaoEsperada` (concorrência local), a remessa gera arquivo, fecha ledger, e o lote FICA em `FINALIZADO` — estado que só a idempotência do ledger corrige por acaso, não por desenho.

- **Melhoria Proposta**
  > Copiar exatamente o padrão do `ConciliacaoRetornoService.transicionarLote`: capturar o retorno, se `afetadas === 0` emitir `logService.warn` com `type: LOG_TYPE.BUSINESS_WARN` incluindo `loteId`, `versaoEsperada`, `statusAtual`. Tactic Bass: **Sanity Checking**.

- **Resultado Esperado**
  > Discrepância de versão em `transicionarStatus` deixa de ser silenciosa. Quando o desalinhamento acontecer em produção, aparece no log com contexto suficiente para diagnosticar.

- **Tactic alvo**: Sanity Checking
- **Severidade**: **P1**
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-fault-tolerance-5
- **Métricas de sucesso**:
  - Callsites de `transicionarStatus` no `RemessaService` que verificam retorno: 0/2 → 2/2
  - Teste: `versaoEsperada` ≠ `versao` no repo → warn observado
- **Risco de não fazer**: Estado inconsistente entre `lote.status` e `ledger.status` sem diagnóstico. Muito raro, mas cego.
- **Dependências**: nenhuma

### [fault-tolerance-6] Diferenciar telemetria de `listarChavesDoLote` / `getLoteNativo` / `getArquivoRetorno` no caminho de "undefined"

- **Problema**
  > As três leituras críticas que sustentam a doutrina "não sei ≠ vazio" tratam qualquer exceção como `undefined` sem log estruturado. Sessão expirada, timeout do proxy, 5xx do Conexos, exception de parse — tudo caem no mesmo silêncio. Quando a retomada escala para `RemessaEmDuvidaError` ("lista de itens não pôde ser lida"), o operador não tem o motivo real no log.

- **Melhoria Proposta**
  > Trocar `catch { return undefined; }` por `catch (cause) { await this.logService.warn({ type: LOG_TYPE.CONEXOS_ERROR, message: '<qual leitura falhou>', data: { … motivo } }); return undefined; }`. Mesmo padrão usado em `ConciliacaoRetornoService.ts` para eventos-não-lidos. Tactic Bass: **Condition Monitoring**.

- **Resultado Esperado**
  > MTTR de incidentes reais cai porque o operador vê imediatamente se foi rede, sessão ou shape.

- **Tactic alvo**: Condition Monitoring
- **Severidade**: **P2**
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-fault-tolerance-6
- **Métricas de sucesso**:
  - Leituras críticas que logam o motivo do `undefined`: 0/3 → 3/3
- **Risco de não fazer**: Diagnóstico lento em produção; nada corrompe.
- **Dependências**: nenhuma

### [fault-tolerance-7] Agendar `job:reaper-sispag` no `render.yaml` (ou onde os cronjobs vivem)

- **Problema**
  > O reaper existe (`jobs/reaper-sispag-reconciling.ts` + `package.json:24`) e o próprio código documenta o crontab `*/15 * * * *`, mas o `render.yaml` **não o agenda**. Órfãos em `reconciling` só aparecem se um operador abrir o painel de execuções, ou se o cron for rodado manualmente. F-fault-tolerance-1 e F-fault-tolerance-4 dependem desta detecção para escalar da técnica ("está lá") ao humano ("alguém viu").

- **Melhoria Proposta**
  > Adicionar entrada `type: cron` no `render.yaml` (padrão do Render Blueprint) apontando para `npm run job:reaper-sispag`, schedule `*/15 * * * *`, com as env vars mínimas (`databaseConnectionString`, `SISPAG_REAPER_MIN`, `SISPAG_REAPER_LIMIT`). Confirmar que o output `[reaper-sispag] N execução(ões) parada(s)` chega ao log agregado. Tactic Bass: **Condition Monitoring**.

- **Resultado Esperado**
  > A cada 15 min, o reaper varre os dois ledgers e loga WARN quando acha órfão. Detecção passa de reativa (operador esbarra em 409) para proativa (log estruturado antes de alguém pedir).

- **Tactic alvo**: Condition Monitoring
- **Severidade**: **P2**
- **Esforço estimado**: S (≤1d) — configuração
- **Findings relacionados**: F-fault-tolerance-7
- **Métricas de sucesso**:
  - Agendamentos de reaper em `render.yaml`: 0 → 1
  - Presença de linhas `[reaper-sispag]` no log agregado nas últimas 24h: 0 → ≥ 96 (uma a cada 15 min)
- **Risco de não fazer**: Silêncio nas janelas descobertas por F-fault-tolerance-1 e F-fault-tolerance-4; a detecção existe, mas dorme.
- **Dependências**: F-fault-tolerance-1 e F-fault-tolerance-4 se beneficiam MAIS quando o reaper está agendado, mas este card independe deles.

## 6. Notas do agente

- **Escopo**: restrito ao delta `da2714e..HEAD` (7 commits do `/feature-tweak sispag retomada`). Não re-avaliei o ledger write-ahead em si (era o delta da feature anterior, cobertura em runs `2026-08-24-1830-sispag-remessa-retorno`); só onde a retomada muda a dinâmica.
- **F-fault-tolerance-8** foi rebaixado a P3 e **não gerou card** — checkpoint incremental na varredura é otimização, não fault-tolerance stricto sensu; se prioridade, tratar como card de Performance.
- **Findings resolvidos que NÃO reportei** (já documentados em `sispag-retomada-gap.md` e `sispag-investigate-model-inconsistency.md` como corrigidos no próprio delta): import 1-por-chamada, `flpCod` não-monotônico → marca vira SET, `filCod#EQ` no `list`, chave do item com filial, `titulosCount` como booleano, encoding do `.REM`. O REPORT.md não deve tratar isto como falha nova.
- **Cross-QA** — alertar o consolidator:
  - `qa-availability` / `qa-performance`: idempotência + timeouts são compartilhados; F-fault-tolerance-1 (concorrência) tem faceta de availability (rejeição rápida é melhor que fila).
  - `qa-security`: auditabilidade — o ledger é o audit trail; F-fault-tolerance-4 (janela sem transação) cria linha "reconciling" perpétua no log de auditoria.
  - `qa-testability`: F-fault-tolerance-2 (self-test ao vivo da conciliação) é gate de testabilidade; a validação AO VIVO da remessa provou-se o único gate que pega defeitos de shape reais.
