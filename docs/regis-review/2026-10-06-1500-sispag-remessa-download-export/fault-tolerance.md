---
qa: Fault Tolerance
qa_slug: fault-tolerance
run_id: 2026-10-06-1500-sispag-remessa-download-export
agent: qa-fault-tolerance
generated_at: 2026-10-06T15:00:00-03:00
scope: all
score: 8
findings_count: 3
cards_count: 3
---

# Fault Tolerance — Regis-Review

## 1. Cenário Geral (Bass General Scenario aplicado ao delta sispag-remessa-download-export)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Analista do financeiro | Pede o download de uma remessa cujo arquivo saiu da grade de 20 do fin015, ou exporta títulos de lotes selecionados | `RemessaService.baixarArquivo`, `RemessaTitulosExportService.exportar`, rotas `GET /sispag/lotes/:id/remessa/arquivo` e `POST /sispag/remessas/titulos/exportar` | Operação normal; Conexos pode estar lento, instável ou devolvendo resposta atípica | Leitura pura: tenta a identidade registrada (nome, depois `gabCod` do lote), nunca um `gabCod` alheio; se não achar, falha de forma explícita e distinguível (`RemittanceFileUnavailableError`); a exportação recusa o pedido inteiro se algum lote faltar | 0 escritas financeiras no delta; 0 arquivos de outro lote servidos; 100% das falhas com mensagem própria (não "sem remessa") |

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Escritas em Conexos/DB no delta | 0 (somente SELECT + download GET) | 0 para fluxos de leitura | ✅ | `RemessaTitulosExportService.ts`, `RemessaService.baixarArquivo` |
| Callsites que mutam estado sem audit pareado | 0 (delta é read-only; log `BUSINESS_INFO` emitido em ambos) | 0 | ✅ | `RemessaService.ts`, `RemessaTitulosExportService.ts:exportar` |
| Falha de arquivo ausente distinguida de "sem remessa" | sim (`RemittanceFileUnavailableError` vs `null`/404) | sim | ✅ | `RemessaService.ts` (baixarArquivo) |
| Validação de resposta em `baixarRemessa` | 0 de 1 (coerção `String(raw ?? '')`) | 1 de 1 | ⚠️ | `ConexosSispagWriteClient.ts:1077-1089` |
| Exportação atômica (tudo ou nada) | sim; rejeita se qualquer id inexistente/sem remessa | sim | ✅ | `exportar` |
| Teto de lotes por exportação | `MAX_LOTES_EXPORT` + `heavyRouteLimiter` | presente | ✅ | `routes/sispag.ts` |
| Timeout em chamada externa nova | herdado do `ConexosBaseClient` (`runWithRetry`); não alterado no delta | 100% | ⚠️ | não verificado no delta; cross-ref qa-availability |
| Idempotência de endpoint novo | N/A: GET e POST de leitura são naturalmente idempotentes | n/a | ✅ | rotas |
| Reaper de estado preso / reconciliação | N/A para o delta (nenhum estado novo) | n/a | ✅ | — |

## 3. Tactics — Cobertura

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Sanity Checking | Exportação valida existência e status do lote; download valida nome registrado; `baixarRemessa` não valida o corpo | ⚠️ parcial | `exportar`; `ConexosSispagWriteClient.ts:1085` |
| Comparison | Nome do arquivo comparado ao registrado no lote (impede `.REM` de outro mês) | ✅ presente | `baixarArquivo` |
| Timeout | Herdado do client base | ⚠️ parcial | `runWithRetry` |
| Condition Monitoring | Log `remessa baixada pelo gabCod` revela uso do caminho de fallback | ✅ presente | `RemessaService.ts` |
| Retry / Forward Recovery | Fallback pelo `gabCod` registrado; erro explícito se esgotar | ✅ presente | `baixarArquivo` |
| Idempotent Replay | Leituras puras | ✅ presente | rotas |
| Compensating Transaction | N/A: nenhuma escrita no delta | N/A | — |
| Quarantine | Pedido inválido rejeitado inteiro (`RemittanceExportInvalidError`), sem export parcial | ✅ presente | `exportar` |
| Reconcile / Stuck-state | N/A: sem novo estado | N/A | — |
| Rollback (frontend) | Sem optimistic update; barra de export notifica erro | ✅ presente | `ExportarTitulosBarra.tsx`, `lib/sispag.ts` |

## 4. Findings

### F-fault-tolerance-1: `baixarRemessa` coage qualquer resposta a string e pode servir lixo como arquivo de remessa

- **Severidade**: P2
- **Tactic violada**: Sanity Checking
- **Localização**: `src/backend/domain/client/ConexosSispagWriteClient.ts:1085`; consumido em `RemessaService.baixarArquivo` (fallback por `gabCod`)
- **Evidência (objetiva)**:
  ```
  return typeof raw === 'string' ? raw : String(raw ?? '');
  ```
  Se o Conexos devolver um objeto (envelope de erro em JSON com HTTP 200), o resultado é `"[object Object]"`, truthy, e `baixarArquivo` o entrega como conteúdo da remessa.
- **Impacto técnico**: o fallback novo amplia a exposição a esse caminho; o analista pode baixar um arquivo corrompido sem erro. `RemessaCnabValidator` existe mas não é aplicado no download.
- **Impacto de negócio**: o arquivo pode ser reenviado ao banco manualmente. Risco baixo, pois o CNAB inválido é rejeitado pelo banco, mas gera retrabalho e confusão. Nenhuma escrita é feita pelo sistema.
- **Métrica de baseline**: 0 de 1 caminhos de download validam o corpo (formato CNAB 240, linhas de 240 colunas).

### F-fault-tolerance-2: fallback por `gabCod` não confirma que o arquivo baixado é o registrado no lote

- **Severidade**: P3
- **Tactic violada**: Comparison
- **Localização**: `src/backend/domain/service/sispag/RemessaService.ts` (bloco `if (lote.nativeGabCod)`)
- **Evidência (objetiva)**: o caminho por nome compara `nomeArquivo`; o caminho por `gabCod` confia apenas na identidade registrada e devolve o conteúdo sem checar o header do arquivo (número da remessa, `remessaNum`).
- **Impacto técnico**: se o ERP reciclar `gabCod`, o conteúdo poderia ser de outro lote. O risco é remoto e a identidade usada é a registrada na geração.
- **Impacto de negócio**: download de arquivo trocado; sem efeito financeiro automático, pois é leitura.
- **Métrica de baseline**: 1 caminho de fallback sem comparação de conteúdo.

### F-fault-tolerance-3: exportação carrega todos os itens de até `MAX_LOTES_EXPORT` lotes em memória

- **Severidade**: P3
- **Tactic violada**: Condition Monitoring
- **Localização**: `RemessaTitulosExportService.exportar` / `serializar`
- **Evidência (objetiva)**: `listLotesPorIds` + `workbook.xlsx.writeBuffer()` em buffer único, sem timeout nem métrica de duração; protegido por teto de lotes e `heavyRouteLimiter`.
- **Impacto técnico**: um lote com muitos itens segura o processo (Render, instância única) durante a serialização.
- **Impacto de negócio**: lentidão pontual do painel; sem perda de dados.
- **Métrica de baseline**: teto = `MAX_LOTES_EXPORT` lotes; duração não medida (⚠️ não medível localmente).

## 5. Cards Kanban

### [fault-tolerance-1] Validar o corpo de `baixarRemessa` antes de servir como remessa

- **Problema**
  > `baixarRemessa` converte qualquer resposta em string (`String(raw ?? '')`); um objeto vira `"[object Object]"` e o fallback novo o entrega como arquivo de remessa.

- **Melhoria Proposta**
  > Sanity Checking: em `ConexosSispagWriteClient.baixarRemessa`, rejeitar resposta não-string ou vazia com `ConexosError`; em `baixarArquivo`, aplicar `RemessaCnabValidator` (linhas de 240 colunas) ao conteúdo e, se inválido, lançar `RemittanceFileUnavailableError`.

- **Resultado Esperado**
  > Download nunca devolve conteúdo que não seja CNAB válido. Caminhos validados: 0/1 → 1/1.

- **Tactic alvo**: Sanity Checking
- **Severidade**: P2
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-fault-tolerance-1
- **Métricas de sucesso**:
  - Caminhos de download com validação do corpo: 0/1 → 1/1
  - Teste cobrindo resposta objeto/vazia: ausente → presente
- **Risco de não fazer**: o analista baixa um arquivo corrompido sem aviso quando o Conexos mudar o envelope de resposta.
- **Dependências**: nenhuma

### [fault-tolerance-2] Comparar identidade do conteúdo no fallback por `gabCod`

- **Problema**
  > O fallback por `gabCod` não confere que o arquivo baixado corresponde ao `remessaNum`/lote registrado.

- **Melhoria Proposta**
  > Comparison: ler o header CNAB (número sequencial do arquivo) e comparar com `lote.remessaNum` antes de devolver; divergência vira `RemittanceFileUnavailableError`.

- **Resultado Esperado**
  > Arquivo servido sempre pertence ao lote pedido, mesmo com reciclagem de `gabCod`.

- **Tactic alvo**: Comparison
- **Severidade**: P3
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-fault-tolerance-2
- **Métricas de sucesso**:
  - Fallbacks com checagem de identidade do conteúdo: 0/1 → 1/1
- **Risco de não fazer**: baixa probabilidade de servir remessa de outro lote após reciclagem de `gabCod` no ERP.
- **Dependências**: fault-tolerance-1 (reutiliza o parser CNAB)

### [fault-tolerance-3] Medir duração e tamanho da exportação de títulos

- **Problema**
  > A exportação serializa tudo em memória sem métrica de duração/linhas além do log de contagem.

- **Melhoria Proposta**
  > Condition Monitoring: registrar `durationMs` e número de linhas no log `títulos de remessas exportados`; revisar `MAX_LOTES_EXPORT` com base no p95 observado.

- **Resultado Esperado**
  > Visibilidade do custo real da exportação antes que ela degrade o processo.

- **Tactic alvo**: Condition Monitoring
- **Severidade**: P3
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-fault-tolerance-3
- **Métricas de sucesso**:
  - Exportações com duração registrada: 0% → 100%
- **Risco de não fazer**: crescimento de lotes degrada o painel sem sinal prévio.
- **Dependências**: nenhuma

## 6. Notas do agente

- Escopo: apenas o delta `origin/main..HEAD`; nenhuma chamada a Conexos ou rede. O delta é inteiramente de leitura, então idempotência de SQS, transação, outbox e reconciliação não se aplicam.
- Ponto positivo de FT: o erro de arquivo ausente agora é distinguível do "lote sem remessa" e o fallback usa só o `gabCod` registrado (nunca o da grade).
- Cross-QA: timeout do client base (availability/performance); validação do corpo (integrability); exportação sem teste de carga (testability).
