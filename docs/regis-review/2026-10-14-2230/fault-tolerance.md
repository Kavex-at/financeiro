---
qa: Fault Tolerance
qa_slug: fault-tolerance
run_id: 2026-10-14-2230
agent: qa-fault-tolerance
generated_at: 2026-10-14T22:30:00-03:00
scope: backend
score: 8
findings_count: 5
cards_count: 4
---

# Fault Tolerance — Regis-Review (delta sispag-passo2-vinculo-codbar, ADR-0071)

## 1. Cenário Geral (Bass General Scenario aplicado ao financeiro)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Analista (clique em "Gerar remessa") / retry do mesmo lote | Queda de processo, 5xx, timeout ou resposta perdida entre `validacao` → `confirma` → `PUT fin015/finItemSispag` → releitura; edição de terceiro no rascunho; `totalAberto` indisponível | `VinculoCodigoBarrasService.executar` + `RemessaService` (etapa em memória `vincular_codbar`) + `ConexosSispagWriteClient.editarItemDoRascunho` | Modo `on` por filial, rascunho nativo ABERTO, ERP sem lock otimista (V3) | PUT de tentativa única; sucesso decidido pela releitura; transitório/ambíguo aborta e retoma idempotente; determinístico retira pela I16d; terceiro nunca é sobrescrito; indisponibilidade de `totalAberto` é fail-closed | 0 boletos errados/duplicados enviados ao banco; 0 itens nativos corrompidos; 100% das falhas deixam rascunho preservado + evento na trilha; retomada converge sem duplicar |

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Escritas ao ERP do vínculo com retry cego | 0 (PUT/POST em `*Once`) | 0 | ✅ | `ConexosSispagWriteClient.ts` (`putGenericOnce`/`postGenericOnce`) |
| Sucesso decidido por observação (releitura) | 1/1 (`PUT_NAO_OBSERVADO` aborta; 200 sem código ≠ sucesso) | 100% | ✅ | `VinculoCodigoBarrasService.ts:571-592` |
| Releitura imediatamente antes do PUT (anti-V3) | presente; janela residual = 1 RTT | presente | ⚠️ | `VinculoCodigoBarrasService.ts:525-537` |
| Persistência local + evento em transação única, só após observado | 1/1 | 100% | ✅ | `VinculoCodigoBarrasService.ts:595, 888-924` |
| Fail-closed sem `fin064.totalAberto` ao vivo | 1/1 (`VALOR_ABERTO_INDISPONIVEL` aborta, sem fallback à carteira) | 100% | ✅ | `VinculoCodigoBarrasService.ts:409-410` |
| Zero chamada ao ERP em `shadow`/dry-run | `prever`/`avaliarParaImport(shadow)` só leem repositórios locais | 0 chamadas | ✅ | `VinculoCodigoBarrasService.ts:197-260`; `RemessaService.ts:535-538` |
| Kill-switch derruba `on` e `shadow` | `sispagLiveWriteEnabled=false` => `OFF`; flag ausente => `OFF` | fail-closed | ✅ | `ModoVinculoCodigoBarras.ts:44-51` |
| Lote > 500 itens | aborta retomável, nunca retira | abortar | ✅ | `VinculoCodigoBarrasService.ts:317-327` |
| Nunca em lote nativo FINALIZADO | `retomarDe !== 'gerar_remessa'`; sync devolve `gerar_remessa/concluido` para status 1 | 100% | ✅ | `RemessaService.ts:732-736, 1046-1067` |
| Cancelamento da decisão após o vínculo desfaz/retira o item | 0/1 (backend ignora; só aviso de UI) | 1/1 | ❌ | `VinculoCodigoBarrasService.ts:403-404`; `SugestaoBoletoPainel.tsx` (diff) |
| Reaper de rascunho abortado no vínculo | ausente (retomada só por clique do analista) | presente | ⚠️ | n/a (sem job) |
| Reconciliação periódica vínculo local x ERP | ausente | presente | ⚠️ | n/a |
| Cobertura de testes dos cenários de falha | 818 linhas no service + 607 no RemessaService + 218 integração | cada cenário I17g coberto | ✅ (não executei) | `VinculoCodigoBarrasService.test.ts` |

> ⚠️ **Não medível localmente**: comportamento do ERP PRD (V-PRD1/V-PRD2 abertos), latência real da janela entre releitura e PUT. Recomendação: medir em HML com carga de 100+ itens.

## 3. Tactics — Cobertura

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Sanity Checking | DV/valor/banco/data/juros verificados por nós pós-confirma; schemas Zod para `validacao`/`confirma` (ausente = erro de contrato) | ✅ presente | `VinculoCodigoBarrasService.ts:480, 503-520, 774-799`; `ConexosSispagWriteClient.ts` (`VALIDACAO_CODBAR_SCHEMA`, `CONFIRMA_CODBAR_SCHEMA`) |
| Comparison | Releitura compara código, banco, valor e data contra o esperado | ✅ presente | `VinculoCodigoBarrasService.ts:802-819` |
| Condition Monitoring | Leitura do rascunho truncada (`completa=false`) aborta; "ausente" nunca é inferido de lista truncada | ✅ presente | `VinculoCodigoBarrasService.ts:659-672` |
| Timeout | Herdado do `ConexosBaseClient` (fora do delta) | ✅ presente | cross-QA availability |
| Idempotent Replay | Item já com o código esperado é reconhecido (`jaVinculado`), sem nova chamada; retomada via `sincronizarComErp` => `vincular_codbar` | ✅ presente | `VinculoCodigoBarrasService.ts:403-406, 608-655`; `RemessaService.ts:1119-1128` |
| Rollback / Compensating Transaction | N/A: ERP não desfaz o PUT; forward recovery explícito (retira pela I16d com `VINCULO_CODIGO_BARRAS_FALHOU`) | ✅ presente (escolha documentada) | `RetiradaCodigoBarrasService.ts` `alvoDoVinculo` |
| Repair State | Dual-write: ERP primeiro, local depois, só após observado; queda no meio é reparada pelo reconhecimento idempotente | ✅ presente | `VinculoCodigoBarrasService.ts:594-595` |
| Quarantine | Falha determinística => item retirado e retido (hold) até a analista liberar | ✅ presente | `RetiradaCodigoBarrasService.ts` aviso `vinculos` |
| Reintroduction / Escalating Restart | Etapa só em memória; ledger permanece em `finalizar`; retomada reconstrói do ERP | ⚠️ parcial (ver F-ft-4) | `RemessaService.ts:717-725` |
| Optimistic lock (Voting/Comparison no PUT) | ERP não oferece; mitigado por releitura pré-PUT; janela residual | ⚠️ parcial | `VinculoCodigoBarrasService.ts:522-537` |
| Reconcile | Sem job de reconciliação vínculo local x ERP; só no clique de retomada | ❌ ausente | n/a |
| Predictive Model / Substitution / Voting | N/A: sem redundância ativa; o domínio é fail-closed por design | N/A | n/a |
| Kill-switch (Avoid Faults) | Flag por filial + `sispagLiveWriteEnabled`, fail-closed `off` | ✅ presente | `ModoVinculoCodigoBarras.ts:44-51`; `RemessaService.ts:314-320` |

## 4. Findings (achados)

Nenhum P0: não encontrei caminho concreto que pague boleto errado/duplicado ou corrompa item nativo sem uma ação humana contrária ao aviso. Os P1/P2 abaixo são lacunas.

### F-ft-1: Anular a confirmação após o vínculo deixa o código no item e a retomada o trata como "digitado à mão"

- **Severidade**: P1
- **Tactic violada**: Repair State / Reconcile
- **Localização**: `src/backend/domain/service/sispag/VinculoCodigoBarrasService.ts:399-405`; `src/backend/domain/service/sispag/BoletoSuggestionService.ts:563-640`
- **Evidência (objetiva)**:
  ```
  if (codigoNoItem !== '') {
      if (!decisao) return { tipo: 'ignorado' }; // digitado à mão no ERP: não é nosso.
  ```
  `carregarContexto` só lista `CONFIRMADA` (linha 685); `anularDecisao` não toca o ERP nem o item. O item com `vinculoCodigoBarras` local continua com o código na retomada/finalização.
- **Impacto técnico**: sequência abort (transitório em item posterior) -> analista anula a confirmação -> retry: o item mantém o boleto anulado, passa pela guarda I16 (código válido) e é finalizado.
- **Impacto de negócio**: pagamento de boleto que a analista explicitamente desfez. Mitigação atual é só texto no diálogo (`itemVinculadoEmLoteVivo`), dependente de leitura humana. Janela real: lote em `error/finalizar` por abort. Rebaixado de P0 porque exige ação humana contrária ao aviso.
- **Métrica de baseline**: 0 de 1 caminho backend que reage à anulação de item já vinculado; 1 aviso de UI.

### F-ft-2: Janela residual entre a releitura pré-PUT e o PUT sem lock otimista (V3)

- **Severidade**: P2
- **Tactic violada**: Comparison (optimistic lock)
- **Localização**: `VinculoCodigoBarrasService.ts:525-556, 573-592`; `ConexosSispagWriteClient.ts` `editarItemDoRascunho` (corpo = row inteira)
- **Evidência (objetiva)**: o PUT envia `...item` (row lida em `fresca`) com 5-6 campos trocados; `bate()` só verifica esses campos.
- **Impacto técnico**: edição de terceiro (ex.: modalidade/observação/outro campo) no intervalo de 1 RTT é sobrescrita sem detecção; só a troca do `itsNumCodbar` é detectada.
- **Impacto de negócio**: baixa probabilidade (2 pessoas no mesmo item em milissegundos), efeito: item com campo do terceiro perdido; sem pagamento errado de valor/código.
- **Métrica de baseline**: janela = 1 RTT (≈ centenas de ms); campos não verificados pós-PUT: todos fora dos 5-6 gravados.

### F-ft-3: Decisões carregadas uma vez no início de um laço serial longo; custo O(n^2) de leituras

- **Severidade**: P2
- **Tactic violada**: Sanity Checking / Timestamp
- **Localização**: `VinculoCodigoBarrasService.ts:304, 336-353, 392, 525, 571`
- **Evidência (objetiva)**: `ctx` carregado em `:304` e reutilizado em todos os itens; cada item faz 3 leituras do rascunho inteiro (até 500 linhas) + `fin064` + 2 POST + PUT.
- **Impacto técnico**: anulação/rejeição durante a execução (minutos para dezenas de itens) não é vista; leituras: até 500 x 3 x 500 = 750k rows por execução no teto.
- **Impacto de negócio**: janela ampliada para F-ft-1; tempo de remessa longo => mais chance de sessão Conexos expirar no meio e abortar.
- **Métrica de baseline**: 3 leituras completas do rascunho por item; teto 500 itens.

### F-ft-4: Etapa de vínculo só em memória; abort não tem reaper nem alerta, retirada pendente é perdida e reavaliada

- **Severidade**: P2
- **Tactic violada**: Condition Monitoring / Reconcile
- **Localização**: `RemessaService.ts:717-725, 1119-1128`; `VinculoCodigoBarrasService.ts:341-347, 851-865`
- **Evidência (objetiva)**: ao abortar no item N, `retirar` (já acumulado) é descartado; na retomada o item é reavaliado e gera novo `VINCULO_FALHOU` (evento duplicado). Nenhum job varre lotes em `error/finalizar` com vínculo pendente.
- **Impacto técnico**: rascunho nativo preso até alguém reclicar; trilha com eventos duplicados.
- **Impacto de negócio**: lote da filial atrasado sem alerta (remessa do dia), ruído na trilha de auditoria.
- **Métrica de baseline**: 0 reapers; N eventos `VINCULO_FALHOU` por retomada em vez de 1.

### F-ft-5: `shadow` grava `VINCULO_SIMULADO` a cada execução sem dedupe

- **Severidade**: P3
- **Tactic violada**: Sanity Checking
- **Localização**: `VinculoCodigoBarrasService.ts:221, 927-949`
- **Evidência (objetiva)**: `registrar: true` em `avaliarParaImport(shadow)` insere um evento por item por execução.
- **Impacto técnico**: crescimento da trilha proporcional a retries; zero impacto no ERP (confirmado: nenhum client é tocado).
- **Impacto de negócio**: ruído nas medições do shadow que embasam a promoção para `on`.
- **Métrica de baseline**: 1 evento por item por execução (sem chave de dedupe).

## 5. Cards Kanban

### [fault-tolerance-1] Reagir à anulação da confirmação quando o item já foi vinculado

- **Problema**
  > Anular a confirmação depois do vínculo não desfaz o código no item; a retomada o ignora como "digitado à mão" (`VinculoCodigoBarrasService.ts:403-404`) e o boleto desfeito pela analista segue para a remessa. Só há aviso de UI.

- **Melhoria Proposta**
  > Se o item tem código e `item.vinculoCodigoBarras` local existe mas não há decisão `CONFIRMADA` (ANULADA/REJEITADA), tratar como retirada determinística (`retirar` com motivo `VINCULO_CODIGO_BARRAS_FALHOU`/`DECISAO_ANULADA`) pela maquinaria I16d, em vez de `ignorado`. Alternativamente, abortar com mensagem. Forward recovery, não desfazer no ERP. Cobrir com teste de retomada.

- **Resultado Esperado**
  > Boleto anulado nunca chega ao `finalizar`; cenário coberto por teste (0 -> 1 caminho backend).

- **Tactic alvo**: Repair State
- **Severidade**: P1
- **Esforço estimado**: S
- **Findings relacionados**: F-ft-1
- **Métricas de sucesso**:
  - Caminhos backend que reagem à anulação pós-vínculo: 0 -> 1
- **Risco de não fazer**: pagamento de boleto desautorizado no primeiro abort seguido de anulação.
- **Dependências**: nenhuma.

### [fault-tolerance-2] Revalidar a decisão por item e reduzir leituras do rascunho no laço de vínculo

- **Problema**
  > `ctx.decisoes` é um snapshot do início (`:304`) e cada item relê o rascunho inteiro 3 vezes, ampliando a janela de F-ft-1 e o tempo total.

- **Melhoria Proposta**
  > Reler a decisão do item (consulta local barata) imediatamente antes do PUT e abortar se não for mais `CONFIRMADA`; reaproveitar a leitura de `fresca` do item anterior ou paginar uma vez por lote. Medir em HML com 100+ itens.

- **Resultado Esperado**
  > 3 -> 1 leitura completa por item; decisão anulada mid-run não é aplicada.

- **Tactic alvo**: Timestamp / Sanity Checking
- **Severidade**: P2
- **Esforço estimado**: M
- **Findings relacionados**: F-ft-2, F-ft-3
- **Métricas de sucesso**:
  - Leituras completas do rascunho por item: 3 -> 1
  - Decisão revalidada antes do PUT: não -> sim
- **Risco de não fazer**: remessa lenta e sessão expirando; janela de edição de terceiro maior.
- **Dependências**: fault-tolerance-1.

### [fault-tolerance-3] Detectar rascunho abortado no vínculo e preservar a lista de retirada

- **Problema**
  > Abort no item N perde `retirar` (eventos `VINCULO_FALHOU` duplicam na retomada) e nenhum job/alerta sinaliza lote parado em `error/finalizar` com vínculo pendente.

- **Melhoria Proposta**
  > Dedupe de `VINCULO_FALHOU` por (lote, título, motivo); alerta/painel para lotes `error` há > N horas com `existemVinculaveis`; o painel de operação já existente pode surfaçar. Reaper apenas lê, nunca escreve no ERP.

- **Resultado Esperado**
  > Lotes presos visíveis em < 1h; 1 evento por falha.

- **Tactic alvo**: Condition Monitoring / Reconcile
- **Severidade**: P2
- **Esforço estimado**: M
- **Findings relacionados**: F-ft-4
- **Métricas de sucesso**:
  - Reapers de vínculo pendente: 0 -> 1
  - Eventos duplicados por retomada: N -> 1
- **Risco de não fazer**: remessa do dia atrasada sem ninguém notar.
- **Dependências**: painel-operacao.

### [fault-tolerance-4] Dedupe do evento `VINCULO_SIMULADO` no shadow

- **Problema**
  > Cada execução grava um evento por item (`:221, 927`), poluindo a medição que decide promover `shadow` -> `on`.

- **Melhoria Proposta**
  > Chave única (lote, título, resultado) ou `ON CONFLICT DO NOTHING` por janela.

- **Resultado Esperado**
  > 1 evento por item por resultado distinto.

- **Tactic alvo**: Sanity Checking
- **Severidade**: P3
- **Esforço estimado**: S
- **Findings relacionados**: F-ft-5
- **Métricas de sucesso**:
  - Eventos por item por execução: 1 -> 0 duplicados
- **Risco de não fazer**: métrica de shadow inflada e trilha crescendo.
- **Dependências**: nenhuma.

## 6. Notas do agente

- Escopo: delta; li `VinculoCodigoBarrasService.ts` inteiro, o diff de `RemessaService`, `RetiradaCodigoBarrasService` e `ConexosSispagWriteClient`. Não executei testes.
- Sem P0: PUT único + releitura decide + fail-closed no aberto + nunca em FINALIZADO + kill-switch resolvido uma vez por execução (mudar a flag no meio não afeta a execução em curso, aceitável).
- Cross-QA: Security/auditabilidade (F-ft-1, F-ft-4 trilha), Performance (F-ft-3), Testability (cenário "anulação pós-vínculo" sem teste), Availability (timeouts herdados do base client).
