---
qa: Security
qa_slug: security
run_id: 2026-09-28-1534-metricas-encerramento
agent: qa-security
generated_at: 2026-09-28T15:55:00-03:00
scope: backend
score: 8.5
findings_count: 2
cards_count: 2
---

# Security — Regis-Review

## 1. Cenário Geral (Bass General Scenario aplicado ao nf-projects)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Analista/robô CLONEX reexecuta uma baixa de permuta ou uma SN que falhou e só liquida semanas depois (retry sobre a mesma `idempotency_key`) | Escrita write-ahead (`markSettled`/`markParcial`/`markError`) grava o carimbo de encerramento e a função `metricas.metricas_ciclo` recalcula a série a partir dele | `permuta_alocacao_execucao.encerrado_em`, `solicitacao_numerario_execucao.encerrado_em`, função `metricas.metricas_ciclo(timestamp, timestamp)` | Produção, Postgres/Supabase, acesso só pela aplicação (sem role dedicado) | A trilha de auditoria financeira registra o **primeiro** encerramento real de forma imóvel, sem caminho de escrita paralelo e sem exposição a `PUBLIC` | 0 linhas com semana de encerramento incorreta na série publicada (baseline pré-delta: 2 de 190, R$ 503.066,69 — ADR-0051); função permanece com `REVOKE ALL ... FROM PUBLIC` e `SET search_path = ''`; 100% do SQL novo parametrizado |

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| SQL não-parametrizado no delta (repositórios) | 0 ocorrências | 0 | ✅ | Leitura de `PermutaExecucaoRepository.ts` / `SolicitacaoNumerarioExecucaoRepository.ts` — todas as novas cláusulas `encerrado_em = ...` usam apenas literais SQL (`now()`, `CASE`) ou colunas, sem interpolação de variável |
| Segredos hardcoded no delta | 0 ocorrências | 0 | ✅ | `grep -rEn "(password\|secret\|token\|api[_-]?key\|credential)\s*[:=]" ` nos 6 arquivos do diff — nenhum hit |
| `GRANT`/`CREATE ROLE`/`SECURITY DEFINER`/`PASSWORD` na migração 0064 | 0 ocorrências | 0 | ✅ | `vwMetricasCiclo.test.ts:258` (`expect(SQL_0064).not.toMatch(/CREATE ROLE\|ALTER ROLE\|GRANT \|SECURITY DEFINER\|PASSWORD/i)`) |
| `REVOKE ALL ... FROM PUBLIC` na função redefinida | Presente | Presente | ✅ | `0064_metricas_ciclo_data_pelo_encerramento.sql:216`; asserção em `vwMetricasCiclo.test.ts:258-259` |
| `SET search_path` na função | `SET search_path = ''` | Definido (não vazio implícito) | ✅ | `0064_metricas_ciclo_data_pelo_encerramento.sql:87` |
| Contrato de colunas devolvidas pela função | Idêntico ao da 0058 (9 colunas + `parcial`/`apurado_ate`) | Sem regressão de superfície de dados exposta | ✅ | `vwMetricasCiclo.test.ts:215-217` (`colunasDoRetorno(SQL_0064)).toEqual(colunasDoRetorno(SQL))`) |
| Cobertura de teste do novo comportamento (`encerrado_em`) | 14 asserções novas (5 unit repo + 5 integration Postgres + 4 guardas estáticas) | 100% dos caminhos de escrita cobertos | ✅ | `_shared-metrics.md` (24/24 integration, 21/21 static guards); diffs de `*.test.ts` |
| Linhas afetadas pelo backfill (aproximação `encerrado_em = atualizado_em`) | ~190 (permuta + SN) | Drift quantificado | ⚠️ Não medível nesta sessão | Leitura de produção negada ao agente (mesma limitação registrada em `_shared-metrics.md`); consulta pronta em `ontology/_inbox/metricas-ciclo-data-encerramento-validacao.md` |
| Guarda de estado terminal em `markError` (status/`encerrado_em`) | 0 de 1 (sem `CASE` como em `markSettled`/`markParcial`) | Simetria com os irmãos `markSettled`/`markParcial` | ⚠️ Parcial (padrão pré-existente, delta apenas estende) | `PermutaExecucaoRepository.ts:539-542`, `SolicitacaoNumerarioExecucaoRepository.ts:352-354` |

## 3. Tactics — Cobertura no nf-projects (escopo: delta)

| Tactic (Bass) | Implementação atual (no delta) | Status | Evidência |
|---|---|---|---|
| Detect Intrusion | N/A — delta não toca detecção/observabilidade | N/A | fora do diff |
| Detect Service Denial | N/A — delta não toca rate limiting/throttling | N/A | fora do diff |
| Verify Message Integrity | N/A — `erp_response` continua persistido como veio do ERP, sem checksum; comportamento inalterado pelo delta | N/A | fora do diff |
| Detect Message Delay | N/A — `EXECUCAO_INTERROMPIDA_MINUTOS`/`listUltimaFalhaPorTxnIds` não são tocados | N/A | fora do diff |
| Identify Actors | ✅ presente (herdado) — `conexos_username`/`conexos_usn_cod` seguem gravados via `ConexosIdentityProvider.currentParams()` em toda escrita nova | ✅ | `PermutaExecucaoRepository.ts:450-451,505-506`; `SolicitacaoNumerarioExecucaoRepository.ts:319-320` |
| Authenticate Actors | N/A — rota `GET /metricas/ciclo` e middlewares de sessão não fazem parte do diff | N/A | `src/backend/routes/metricas.ts` não está no `git diff --stat` |
| Authorize Actors | N/A — mesma razão acima | N/A | idem |
| Limit Access | ✅ presente — `REVOKE ALL ON FUNCTION metricas.metricas_ciclo(...) FROM PUBLIC` reafirmado na redefinição da função (mesma doutrina da 0058) | ✅ | `0064...sql:216`; `vwMetricasCiclo.test.ts:258-259` |
| Limit Exposure | ✅ presente — contrato de saída (9 colunas + `parcial`/`apurado_ate`) mantido idêntico; nenhuma coluna de CNPJ/fornecedor/valor individual exposta, só agregados semanais | ✅ | `vwMetricasCiclo.test.ts:215-217` |
| Encrypt Data | N/A — delta não toca TLS/SSM/at-rest | N/A | fora do diff |
| Separate Entities | N/A — sem `infra/`/multi-tenant nesta base (estado atual, ver CLAUDE.md); delta é de único schema/aplicação | N/A | CLAUDE.md — "Estado Atual vs. Alvo" |
| Change Default Settings | ✅ presente — `SET search_path = ''` na função, blindando contra hijack de objetos por `search_path` malicioso | ✅ | `0064...sql:87` |
| Validate Input | ✅ presente — 100% do SQL novo é parametrizado (`$key`, `$borCod`, ...); zero interpolação de string nas cláusulas `encerrado_em` adicionadas. Boundary HTTP (Zod em `routes/metricas.ts`) não foi tocado pelo delta | ✅ | diff de `PermutaExecucaoRepository.ts` / `SolicitacaoNumerarioExecucaoRepository.ts` |
| Revoke Access | N/A — nenhuma lógica de sessão/revogação no diff | N/A | fora do diff |
| Lock Computer | N/A — tactic não aplicável a este backend | N/A | — |
| Inform Actors | N/A — nenhum alerta/notificação no diff | N/A | fora do diff |
| Restore | ✅ parcial — a própria migração documenta o rollback (`UPDATE ... SET encerrado_em = NULL` ou `DROP COLUMN`), reconstruível porque o backfill não toca `atualizado_em`/`criado_em`; ~190 linhas, abaixo do limiar de 1.000 que exigiria script formal | ✅ | `0064...sql:31-33`; `migrations/rollbacks/README.md` (limiar) |
| Audit Trail | ⚠️ parcial — o delta É uma melhoria de audit trail (carimba o 1º encerramento real, imóvel, em vez de depender de `criado_em`/`atualizado_em` que mentiam a data da liquidação); mas o backfill histórico é uma aproximação declarada, e `markError` grava sobre o mesmo campo sem a guarda de terminal que `markSettled`/`markParcial` têm | ⚠️ | F-security-1, F-security-2 abaixo |

## 4. Findings (achados)

### F-security-1: Backfill de `encerrado_em` é uma aproximação declarada, sem forma de quantificar o drift em produção

- **Severidade**: P2
- **Tactic violada**: Audit Trail
- **Localização**: `src/backend/migrations/0064_metricas_ciclo_data_pelo_encerramento.sql:26-33,59-67`
- **Evidência (objetiva)**:
  ```sql
  -- Linhas terminais já gravadas recebem `encerrado_em = atualizado_em`. É uma APROXIMAÇÃO, a única
  -- disponível: para uma linha `settled` re-clicada depois de liquidar, `atualizado_em` é o clique, não
  -- a liquidação.
  UPDATE public.permuta_alocacao_execucao
     SET encerrado_em = atualizado_em
   WHERE encerrado_em IS NULL
     AND status IN ('settled', 'parcial', 'error');
  ```
  A própria migração reconhece que, para uma linha já `settled`/`parcial` antes da 0064 que sofreu qualquer escrita pós-liquidação (`clearBorCod`, re-clique via `beginExecution` preservado, `setBorCod`), o `atualizado_em` usado como proxy pode não ser o instante real do encerramento.
- **Impacto técnico**: até ~190 linhas (`permuta_alocacao_execucao` + `solicitacao_numerario_execucao`) carregam uma data de auditoria aproximada em vez de exata; a série de métricas publicada a partir delas herda o mesmo desvio.
- **Impacto de negócio**: o campo que agora é a fonte de verdade de "quando o sistema executou este pagamento/permuta" — usado em relatório de ciclo para a Columbia — pode subestimar/deslocar valores em semanas específicas de forma não quantificada; um auditor ou o cliente que reconte manualmente pode encontrar divergência sem explicação disponível no sistema.
- **Métrica de baseline**: ~190 linhas backfilled (fonte: `_shared-metrics.md`); quantas delas tiveram escrita pós-settle não é medível nesta sessão (leitura de produção negada ao agente — mesma limitação documentada em `ontology/_inbox/metricas-ciclo-data-encerramento-validacao.md`).

### F-security-2: `markError` sobrescreve `encerrado_em` (e `status`) sem a guarda de terminal que `markSettled`/`markParcial` têm

- **Severidade**: P3 (contexto — a ausência de guarda em `status` é padrão pré-existente ao delta; o delta apenas estende o mesmo padrão ao novo campo de auditoria)
- **Tactic violada**: Audit Trail
- **Localização**: `src/backend/domain/repository/permutas/PermutaExecucaoRepository.ts:539-542`; `src/backend/domain/repository/recebimentos/SolicitacaoNumerarioExecucaoRepository.ts:352-354`
- **Evidência (objetiva)**:
  ```sql
  -- markError (sem CASE de proteção, ao contrário de markSettled/markParcial):
  UPDATE permuta_alocacao_execucao SET
      status = 'error',
      ...
      encerrado_em = now(),
      atualizado_em = now()
   WHERE idempotency_key = $key
  ```
  Comparar com `markSettled`/`markParcial`, que protegem `encerrado_em` com `CASE WHEN status IN ('settled','parcial') THEN COALESCE(encerrado_em, now()) ELSE now() END` — `markError` não tem equivalente.
- **Impacto técnico**: se `markError` for chamado sobre uma chave cuja linha já está `settled`/`parcial` (ex.: corrida entre um retry tardio e uma resposta de sucesso atrasada do ERP), o novo `encerrado_em` — carimbo que agora alimenta a métrica oficial do ciclo — seria sobrescrito pelo instante do erro, junto com `status` voltando a `error` sobre uma liquidação real.
- **Impacto de negócio**: uma baixa/SN realmente concluída poderia aparecer como falha na trilha e sumir/mudar de semana na métrica publicada à Columbia.
- **Métrica de baseline**: nenhum teste (unitário ou de integração) do delta cobre esse cenário de corrida — os testes novos (`PermutaExecucaoRepository.test.ts`, `SolicitacaoNumerarioExecucaoRepository.test.ts`) verificam apenas o SQL gerado isoladamente, não a interação `markSettled` → `markError` sobre a mesma chave.

## 5. Cards Kanban

### [security-1] Registrar a origem do carimbo de `encerrado_em` para distinguir backfill aproximado de encerramento real

- **Problema**
  > A migração 0064 backfilled ~190 linhas usando `atualizado_em` como proxy de `encerrado_em`, e a própria migração documenta que essa aproximação pode estar errada para linhas re-clicadas pós-liquidação (F-security-1). Hoje não há como, olhando a linha, saber se o `encerrado_em` é exato (gravado por `markSettled`/`markParcial`/`markError` depois da 0064) ou aproximado (backfill).

- **Melhoria Proposta**
  > Tactic alvo: Audit Trail. Adicionar uma coluna booleana leve (`encerrado_em_aproximado` ou similar) gravada `true` só pelo backfill da 0064 e nunca pelas escritas normais dos repositórios (`markSettled`/`markParcial`/`markError`), permitindo que o report do ciclo e qualquer auditoria futura filtrem/anotem os pontos de baixa confiança sem precisar reconstruir a lógica da migração. Arquivos: nova migration `006X`, `PermutaExecucaoRepository.ts`, `SolicitacaoNumerarioExecucaoRepository.ts`.

- **Resultado Esperado**
  > A trilha de auditoria distingue explicitamente "encerramento medido" de "encerramento reconstruído por aproximação" — 0 linhas ambíguas hoje → 100% das linhas com proveniência marcada. O report do ciclo pode citar a ressalva apenas nas semanas efetivamente afetadas, em vez de uma nota genérica.

- **Tactic alvo**: Audit Trail
- **Severidade**: P2
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-security-1
- **Métricas de sucesso**:
  - Linhas com proveniência de `encerrado_em` marcada: 0% → 100%
  - Ressalva do report do ciclo: genérica → escopada às semanas com linhas aproximadas
- **Risco de não fazer**: se uma reconciliação futura (auditoria externa, cliente, ou o próprio time) encontrar divergência num valor de semana passada, não há como hoje distinguir "erro no sistema" de "aproximação documentada do backfill de 28/09" sem reler o código da migração — desgasta a credibilidade do número publicado.
- **Dependências**: nenhuma.

### [security-2] Blindar `markError` com a mesma guarda de terminal que `markSettled`/`markParcial` já têm para `encerrado_em`

- **Problema**
  > `markError` sobrescreve `status` e (desde este delta) `encerrado_em` incondicionalmente, sem o `CASE WHEN status IN (...) THEN COALESCE(...)` que protege as escritas irmãs `markSettled`/`markParcial` (F-security-2). Nenhum teste do delta cobre a sequência `markSettled` seguido de `markError` sobre a mesma `idempotency_key`.

- **Melhoria Proposta**
  > Tactic alvo: Audit Trail. Espelhar em `markError` a mesma cláusula `CASE WHEN status IN ('settled', 'parcial') THEN ... ELSE now() END` usada em `markSettled`/`markParcial` para `encerrado_em`, e considerar o mesmo tratamento para `status` (preservar terminal), com um teste de integração que exercite explicitamente a corrida `markSettled` → `markError` sobre a mesma chave. Arquivos: `PermutaExecucaoRepository.ts`, `SolicitacaoNumerarioExecucaoRepository.ts`, mais o teste de integração `vwMetricasCiclo.integration.test.ts` ou um teste de repositório dedicado.

- **Resultado Esperado**
  > Uma liquidação real (`settled`/`parcial`) nunca mais pode ser revertida para `error` por uma escrita tardia/corrida no ledger — hoje 0 de 3 métodos de escrita terminal (`markSettled`, `markParcial`, `markError`) protegem consistentemente o par (`status`, `encerrado_em`) → alvo 3 de 3.

- **Tactic alvo**: Audit Trail (overlap com Fault Tolerance — mesma corrida discutida em `fault-tolerance-2`/idempotência)
- **Severidade**: P3
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-security-2
- **Métricas de sucesso**:
  - Métodos de escrita terminal com guarda simétrica: 2 de 3 (`markSettled`, `markParcial`) → 3 de 3
  - Teste cobrindo a corrida `markSettled`→`markError`: 0 → 1
- **Risco de não fazer**: o risco é de baixa probabilidade (exige corrida real entre duas chamadas sobre a mesma chave) mas alto custo se ocorrer — uma baixa realmente liquidada apareceria como erro na trilha usada para a métrica oficial do ciclo, exigindo investigação manual para provar que o dinheiro efetivamente moveu.
- **Dependências**: nenhuma; pode andar junto com qualquer follow-up de Fault Tolerance sobre o mesmo par de métodos.

## 6. Notas do agente

- Escopo estritamente delta (ADR-0051): migração 0064, os dois repositórios de ledger e seus testes. Rota HTTP, autenticação, autorização, IAM, secrets/SSM e dependências (`npm audit`, pulado por `--quick`) não fazem parte deste diff e não foram medidos.
- Achado F-security-2 é majoritariamente débito pré-existente (o padrão de `markError` sem guarda de terminal já existia antes da 0051); mantido como P3/contexto por tocar diretamente o novo campo de auditoria, não como reabertura de dívida fora de escopo.
- Cross-QA: F-security-1 e F-security-2 tangenciam Fault Tolerance (mesma doutrina de idempotência/corrida write-ahead) e Availability (nenhum achado de blast-radius multi-tenant aqui — este repo ainda não tem `infra/`/isolamento por conta AWS, ver CLAUDE.md "Estado Atual vs. Alvo").
