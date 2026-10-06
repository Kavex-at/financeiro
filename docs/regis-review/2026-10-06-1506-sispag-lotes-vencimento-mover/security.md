---
qa: Security
qa_slug: security
run_id: 2026-10-06-1506
agent: qa-security
generated_at: 2026-10-06T15:06:00-03:00
scope: backend
score: 8
findings_count: 2
cards_count: 2
---

# Security — Regis-Review (delta sispag-lotes-vencimento-mover)

## 1. Cenário Geral

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Usuário autenticado (ou atacante com sessão válida) | `POST /sispag/lotes/:id/itens` com `mover:true` sobre título de lote FINALIZADO/REMESSA_GERADA, ou corrida com finalização do lote de origem | `LotePagamentoService.incluirTitulo`, `LotePagamentoRepository`, rota `/sispag` | Produção Express/Render, Postgres Supabase | Rejeitar (409) título comprometido; abortar mover se origem deixou de ser RASCUNHO; registrar ator | 0 títulos de lote comprometido movidos; 100% das mutações com ator auditado |

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Segredos hardcoded no delta | 0 | 0 | ✅ | git diff 1e68bd7..HEAD (inspeção) |
| SQL não parametrizado no delta | 0 (4 queries novas, todas com params nomeados) | 0 | ✅ | LotePagamentoRepository.ts diff |
| Endpoint mutante novo/alterado com Zod | 1/1 (`mover: z.boolean().optional()`, teste 400 para `'sim'`) | 100% | ✅ | routes/sispag.ts:157 |
| Endpoint com permissão explícita | 1/1 (`SISPAG_EXECUTAR`) | 100% | ✅ | routes/sispag.ts:224 |
| `dangerouslySetInnerHTML`/`localStorage` nos novos arquivos FE | 0 | 0 | ✅ | grep |
| Ação mover com trilha persistida em tabela | 0 (apenas `logService.info`) | 1 | ⚠️ | LotePagamentoService.ts:640-650 |
| IAM / rede / CloudTrail / npm audit | ⚠️ Não medível localmente: sem `infra/`; delta não altera dependências | — | — | — |

## 3. Tactics — Cobertura

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Detect Intrusion / Service Denial / Message Delay | Fora do delta | N/A | sem alteração |
| Verify Message Integrity | Versão otimista do lote bumpada na origem (`tocarLote`) | ✅ | Service retirarDaOrigem |
| Identify Actors | `ator(req)` propagado | ✅ | routes/sispag.ts |
| Authenticate Actors | Middleware existente | N/A | fora do delta |
| Authorize Actors | `exigirPermissao(SISPAG_EXECUTAR)` | ✅ | routes/sispag.ts:224 |
| Limit Access | Bloqueio de título em lote comprometido (FINALIZADO/REMESSA_GERADA), DELETE só se RASCUNHO | ✅ | Repository removerItemDeRascunho |
| Limit Exposure | Erro 409 expõe `loteId`/status só a usuário autenticado | ⚠️ parcial | TitleInCommittedBatchError |
| Encrypt Data | Fora do delta | N/A | — |
| Separate Entities | Single-tenant hoje; sem tenant scoping novo | N/A | CLAUDE.md |
| Change Default Settings | — | N/A | — |
| Validate Input | Zod no body; SQL parametrizado | ✅ | routes/sispag.ts:154-158 |
| Revoke Access / Lock Computer / Inform Actors | Fora do delta | N/A | — |
| Audit Trail | Log estruturado (`moverTitulo` com origem/destino/ator), não tabela | ⚠️ parcial | Service:334-338 |
| Restore | Atomicidade via transação + advisory lock por título | ✅ | Service:280-300 |

## 4. Findings

### F-security-1: Auditoria do mover é só log, emitida fora da transação

- **Severidade**: P2
- **Tactic violada**: Audit Trail
- **Localização**: `src/backend/domain/service/sispag/LotePagamentoService.ts:334-338, 640-650`
- **Evidência (objetiva)**:
  ```
  await this.audit(origem ? 'moverTitulo' : 'incluirTitulo', ...)  // após withTransaction
  audit = logService.info({... data: { loteId, ator, loteOrigem } })
  ```
- **Impacto técnico**: se o processo cair entre commit e log, ou o log for rotacionado, o movimento (que pode cancelar um lote de origem) fica sem rastro de quem fez.
- **Impacto de negócio**: reconstituição de "quem tirou o título do lote X" depende de retenção de logs do Render; exigência de trilha persistida da proposta não é satisfeita. Padrão preexistente, o delta o estende a uma ação destrutiva (cancelamento automático de lote).
- **Métrica de baseline**: 0 linhas persistidas em tabela de auditoria por mover (alvo ≥1).

### F-security-2: Erro 409 devolve identificadores de lote e status de lote comprometido

- **Severidade**: P3
- **Tactic violada**: Limit Exposure
- **Localização**: `src/backend/domain/errors/TitleInCommittedBatchError.ts`
- **Evidência (objetiva)**: erro carrega `loteId` e `status` no payload.
- **Impacto técnico**: usuário com `SISPAG_EXECUTAR` enumera estado de lotes; baixo risco (já tem acesso de leitura ao painel).
- **Impacto de negócio**: desprezível em single-tenant; relevante ao virar multi-usuário com escopo por filial.
- **Métrica de baseline**: 2 campos expostos.

Pontos verificados sem finding: SQL com parâmetros nomeados (`ANY($status)`, `DELETE ... USING` condicionado a `status='RASCUNHO'`); corrida mover x finalização tratada (rowCount 0 aborta a transação inteira); advisory lock por título evita duplicação; destino segue validação existente de status/filial.

## 5. Cards Kanban

### [security-1] Persistir a trilha de auditoria de incluir/mover título em tabela

- **Problema**
  > O mover (que pode cancelar o lote de origem) é registrado apenas via `logService.info` após o commit, fora da transação.
- **Melhoria Proposta**
  > Gravar linha em tabela de auditoria (ator, ação, lote origem/destino, título, timestamp) dentro da mesma `withTransaction`. Tactic: Audit Trail. Tocar `LotePagamentoService.incluirTitulo` e criar migration. Reaproveitar para as demais ações de lote.
- **Resultado Esperado**
  > 100% dos movimentos rastreáveis por consulta SQL, atômicos com a mutação (0 → 1 linha por mover).
- **Tactic alvo**: Audit Trail
- **Severidade**: P2
- **Esforço estimado**: M (2–5d)
- **Findings relacionados**: F-security-1
- **Métricas de sucesso**:
  - Ações de lote com trilha persistida: 0% → 100%
- **Risco de não fazer**: Em disputa sobre pagamento omitido/movido, não há prova durável de quem agiu.
- **Dependências**: nenhuma (cruza com Fault Tolerance)

### [security-2] Reduzir payload do 409 de lote comprometido

- **Problema**
  > O erro expõe loteId e status ao cliente.
- **Melhoria Proposta**
  > Manter só mensagem operacional em pt-BR e o loteId necessário para a UI; revisar ao introduzir escopo por filial. Tactic: Limit Exposure.
- **Resultado Esperado**
  > Payload mínimo; sem enumeração entre escopos.
- **Tactic alvo**: Limit Exposure
- **Severidade**: P3
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-security-2
- **Métricas de sucesso**:
  - Campos internos no 409: 2 → ≤1
- **Risco de não fazer**: Vazamento de estado entre escopos quando houver RBAC por filial.
- **Dependências**: RBAC por filial

## 6. Notas do agente

- Escopo: só o delta 1e68bd7..HEAD; sem `infra/`, IAM/rede/CloudTrail não medíveis; npm audit não rodado (sem mudança de dependências).
- Nenhum P0: sem segredos, SQL parametrizado, Zod + permissão presentes, mover atômico e bloqueado em lotes comprometidos.
- Cross-QA: Audit Trail sobrepõe Fault Tolerance; Validate Input sobrepõe Integrability.
