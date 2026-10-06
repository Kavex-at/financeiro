---
qa: Availability
qa_slug: availability
run_id: 2026-10-06-1500-sispag-remessa-download-export
agent: qa-availability
generated_at: 2026-10-06T15:30:00-03:00
scope: all
score: 7.5
findings_count: 4
cards_count: 3
---

# Availability — Regis-Review

## 1. Cenário Geral (Bass General Scenario)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Analista financeiro (SISPAG) | Pede o download do `.REM` de um lote com remessa gerada; o `fin015` não lista o arquivo na grade (1 página de 20) ou o arquivo foi excluído no ERP | `RemessaService.baixarArquivo`, rota `GET /sispag/lotes/:id/remessa/arquivo`, `ConexosSispagWriteClient.baixarRemessa` | Operação normal, Conexos degradado ou com dado reciclado | Recuperar pelo `gabCod` registrado (Exception Handling / Retry); se não houver, erro explícito `REMESSA_ARQUIVO_INDISPONIVEL`, sem mascarar como "sem remessa" | 0 downloads falso-negativos por limite de paginação; erro distinguível em 100% dos casos |

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Caminhos de download com fallback por identidade registrada | 2 (nome na grade, depois `gabCod` do lote) | ≥2 | ✅ | `RemessaService.ts` (baixarArquivo) |
| Erro de lote COM remessa distinguível de lote SEM remessa | sim (`RemittanceFileUnavailableError` vs 404 genérico) | sim | ✅ | `RemittanceFileUnavailableError.ts`, `routes/sispag.ts` |
| Export: validação tudo-ou-nada (inexistente/sem remessa) | sim (422 `EXPORT_REMESSA_INVALIDO`) | sim | ✅ | `RemessaTitulosExportService.ts` (exportar) |
| Teto de lotes por export | 50 (Zod no boundary) + `heavyRouteLimiter` | definido | ✅ | `routes/sispag.ts` (exportarTitulosSchema) |
| Export depende de Conexos | não (leitura local) | não | ✅ | `RemessaTitulosExportService.ts` |
| Escrita nova em sistema externo / mutação de estado | 0 (delta read-only) | 0 | ✅ | `git diff origin/main HEAD` |
| Testes dos ramos de falha novos | 6 em `baixarArquivo`, 1 de recusa no export, rota testada | — | ✅ | `RemessaService.test.ts`, `RemessaTitulosExportService.test.ts` |
| Timeout explícito do GET `gerArquivosBancos/download` | Não verificado (herdado de `ConexosBaseClient.runWithRetry`/`getGeneric`) | explícito | ⚠️ | `ConexosSispagWriteClient.ts:1077` |

> ⚠️ **Não medível localmente**: taxa real de falha do download e MTTR. Requer logs de produção (Render). Recomendação: contar a mensagem `remessa baixada pelo gabCod` e `REMESSA_ARQUIVO_INDISPONIVEL` por semana. Não existe `infra/` (CloudWatch, DLQ, alarmes N/A neste repo); nenhum número foi inventado.

## 3. Tactics — Cobertura

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Ping/Echo | Sem health check de dependência no delta | N/A | Delta não adiciona dependência nova |
| Heartbeat | Sem processo de longa duração no delta | N/A | — |
| Monitor | Log `BUSINESS_INFO` no fallback e no export; sem alarme | ⚠️ parcial | `RemessaService.ts` (fallback); `exportar` |
| Timestamp | Não aplicável ao delta | N/A | — |
| Sanity Checking | Valida status com remessa, existência de ids, UUID e teto | ✅ presente | `exportarTitulosSchema`, `STATUS_COM_REMESSA` |
| Condition Monitoring | Ausente | ❌ ausente | — |
| Voting | Sem redundância computacional | N/A | — |
| Exception Detection | Erro tipado separa "sem remessa" de "arquivo sumiu no ERP" | ✅ presente | `RemittanceFileUnavailableError.ts` |
| Self-Test | Ausente | ❌ ausente | — |
| Active Redundancy | N/A para o delta | N/A | — |
| Passive Redundancy | Segundo caminho de obtenção do arquivo (grade, depois download por gabCod) | ⚠️ parcial | `RemessaService.ts` |
| Spare | Instância única no Render | N/A | — |
| Exception Handling | Rota traduz `HandlerError` com status e `userMessage` em pt-BR | ✅ presente | `routes/sispag.ts` (respondLoteError) |
| Rollback | Sem escrita | N/A | — |
| Software Upgrade | Fora do escopo do delta | N/A | — |
| Retry | Download usa `runWithRetry` (leitura, idempotente) | ✅ presente | `ConexosSispagWriteClient.ts:1080` |
| Ignore Faulty Behavior | Ids repetidos deduplicados; ids ausentes não voltam | ⚠️ parcial | `exportar`, `listLotesPorIds` |
| Degradation | Download falha de forma explícita e orienta conferir no fin015; export independe do ERP | ✅ presente | `userMessage` do erro |
| Reconfiguration | N/A | N/A | — |
| Shadow | N/A | N/A | — |
| State Resynchronization | `listLotes` projeta o mesmo cabeçalho do `getLoteComItens` (constante única), removendo divergência de estado | ✅ presente | `LOTE_HEADER_COLUMNS` |
| Escalating Restart | N/A | N/A | — |
| Non-Stop Forwarding | N/A | N/A | — |
| Removal from Service | N/A | N/A | — |
| Transactions | Delta sem escrita | N/A | — |
| Predictive Model | Ausente | ❌ ausente | — |
| Exception Prevention | Zod, teto de 50, recusa tudo-ou-nada, `heavyRouteLimiter` | ✅ presente | `routes/sispag.ts` |
| Increase Competence Set | Fallback por gabCod cobre a limitação de 1 página da grade | ✅ presente | `RemessaService.ts` |

## 4. Findings

### F-availability-1: Fallback por `gabCod` não confere se o conteúdo baixado é o arquivo esperado

- **Severidade**: P2
- **Tactic violada**: Sanity Checking
- **Localização**: `src/backend/domain/service/sispag/RemessaService.ts` (baixarArquivo, ramo `nativeGabCod`)
- **Evidência (objetiva)**:
  ```
  const conteudo = await this.write.baixarRemessa({ filCod, gabCod: lote.nativeGabCod });
  if (conteudo) { ... return { nomeArquivo, conteudo }; }
  ```
  O nome devolvido é o do lote; o conteúdo vem do `gabCod`, sem cruzar o header do CNAB com `remessaNum`.
- **Impacto técnico**: se o `gabCod` registrado apontar para outro arquivo, entrega conteúdo errado com nome certo.
- **Impacto de negócio**: o analista poderia reenviar ao banco um CNAB que não é o do lote. O download não escreve; o risco só se materializa por reenvio manual.
- **Métrica de baseline**: 0 validações de conteúdo no ramo de fallback. `gabCod` é chave única do ERP, logo a probabilidade é baixa (não medida).

### F-availability-2: Download sem observabilidade agregada e timeout não verificado

- **Severidade**: P2
- **Tactic violada**: Monitor
- **Localização**: `ConexosSispagWriteClient.ts:1077-1090`, `RemessaService.ts` (log do fallback)
- **Evidência (objetiva)**: o log do fallback é `info`; `REMESSA_ARQUIVO_INDISPONIVEL` só aparece como 404 HTTP. O timeout do GET não foi verificado no delta.
- **Impacto técnico**: um Conexos lento pode prender a requisição Express até o limite da plataforma; ninguém sabe que o fallback virou rotina.
- **Impacto de negócio**: o analista descobre sozinho que o arquivo sumiu.
- **Métrica de baseline**: 0 alarmes; timeout não medido.

### F-availability-3: Export síncrono em memória, sem teto de títulos

- **Severidade**: P3
- **Tactic violada**: Exception Prevention
- **Localização**: `RemessaTitulosExportService.ts` (exportar / serializar)
- **Evidência (objetiva)**: teto de 50 lotes, mas não de títulos; `listLotesPorIds` carrega todos os itens e o exceljs monta o workbook inteiro antes do `send`.
- **Impacto técnico**: 50 lotes grandes elevam a memória do processo Render compartilhado com o resto da API.
- **Impacto de negócio**: risco de afetar outras telas durante uma exportação; tamanho real dos lotes não medido.
- **Métrica de baseline**: teto 50 lotes; itens por lote desconhecido.

### F-availability-4: Falha no log pós-geração derruba o export já pronto

- **Severidade**: P3
- **Tactic violada**: Exception Handling
- **Localização**: `RemessaTitulosExportService.ts` (`await this.logService.info` após `serializar`)
- **Evidência (objetiva)**: o log é aguardado depois da planilha pronta; se lançar, a rota devolve 500 e o arquivo gerado é perdido.
- **Impacto técnico**: efeito colateral não essencial acoplado ao caminho de resposta.
- **Impacto de negócio**: marginal; a analista repete o export.
- **Métrica de baseline**: 0 incidentes conhecidos.

Nenhum P0/P1: o delta é read-only, não altera estado nem escreve em sistemas externos, e o fallback torna o download mais resiliente que o anterior.

## 5. Cards Kanban

### [availability-1] Validar conteúdo do `.REM` baixado pelo gabCod

- **Problema**
  > O fallback por `gabCod` devolve o conteúdo sob o nome do lote sem conferir se é o arquivo certo (F-availability-1).
- **Melhoria Proposta**
  > Sanity Checking: ler o header do CNAB (sequencial da remessa) e comparar com `remessaNum`; se divergir, lançar `RemittanceFileUnavailableError`. Tocar `RemessaService.baixarArquivo`.
- **Resultado Esperado**
  > Conteúdo de outro arquivo nunca é entregue: validações de identidade no fallback 0 → 1.
- **Tactic alvo**: Sanity Checking
- **Severidade**: P2
- **Esforço estimado**: S
- **Findings relacionados**: F-availability-1
- **Métricas de sucesso**:
  - Validação de identidade no fallback: 0 → 1
- **Risco de não fazer**: entrega silenciosa de CNAB errado se o `gabCod` registrado divergir.
- **Dependências**: nenhuma

### [availability-2] Contar uso do fallback e indisponibilidade; confirmar timeout do download

- **Problema**
  > Não há contagem do fallback nem de `REMESSA_ARQUIVO_INDISPONIVEL`, e o timeout do GET de download não foi confirmado (F-availability-2).
- **Melhoria Proposta**
  > Monitor: elevar o log de arquivo indisponível a `warn` com campos contáveis, confirmar o timeout em `ConexosBaseClient.getGeneric` e expor no painel de operação.
- **Resultado Esperado**
  > Alerta quando arquivos somem do fin015 acima de um limite semanal; download com timeout explícito.
- **Tactic alvo**: Monitor
- **Severidade**: P2
- **Esforço estimado**: S
- **Findings relacionados**: F-availability-2
- **Métricas de sucesso**:
  - Eventos contáveis: 0 → 2 tipos
- **Risco de não fazer**: degradação só percebida pelo analista.
- **Dependências**: painel-operacao

### [availability-3] Endurecer o export (log não bloqueante e teto de títulos)

- **Problema**
  > O log pós-geração é aguardado e não há teto de itens (F-availability-3, F-availability-4).
- **Melhoria Proposta**
  > Exception Prevention / Handling: capturar falha do log sem derrubar a resposta e limitar o total de títulos (ex.: 20 mil) com 422 explicativo.
- **Resultado Esperado**
  > Export nunca falha por causa do log; memória limitada de forma determinística.
- **Tactic alvo**: Exception Prevention
- **Severidade**: P3
- **Esforço estimado**: S
- **Findings relacionados**: F-availability-3, F-availability-4
- **Métricas de sucesso**:
  - Teto de títulos: nenhum → definido
- **Risco de não fazer**: baixo; pressão de memória pontual.
- **Dependências**: nenhuma

## 6. Notas do agente

- Escopo: apenas o delta (commit 341f756), leitura de código; nada executado contra Conexos ou rede.
- Sem `infra/`: DLQ, alarmes e timeouts de Lambda não se aplicam; timeout do cliente Conexos não verificado e declarado como tal.
- Cross-QA: F-availability-1 também toca Security/Integrability (integridade do conteúdo do CNAB).
