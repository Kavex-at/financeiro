---
qa: Security
qa_slug: security
run_id: 2026-10-06-1356
agent: qa-security
generated_at: 2026-10-06T14:10:00-03:00
scope: backend
score: 8
findings_count: 3
cards_count: 3
---

# Security — Regis-Review

## 1. Cenário Geral (Bass General Scenario aplicado ao nf-projects)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Insider com `sispag:executar` (quem monta/finaliza o lote) ou sessão comprometida | Tenta conferir o próprio lote TED/PIX, forjar o ator no body, ou reabrir/devolver para limpar a conferência e gerar a remessa sozinho | `ConferenciaLoteService`, `ConferenciaLoteRule`, `RemessaService.gerarRemessa`, `LotePagamentoRepository`, `sispag_verificacao_evento` | Produção, Express/Render, JWT Supabase, escrita no Conexos habilitada | Backend recusa (403) por identidade autenticada, remessa só sai com `conferido_por`, toda transição vira evento append-only | 0 lotes TED/PIX com remessa sem 2ª pessoa distinta; 100% das transições com evento persistido |

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Ator vindo do body nas rotas novas (conferir/devolver/resolver) | 0 (`ator(req)` = `req.user.sub`; Zod descarta campos extras) | 0 | ✅ | `routes/sispag.ts:116,435,514,538` |
| Rotas novas com `exigirPermissao` | conferir/devolver = `SISPAG_CONFERIR`; fila = `sispag:cadastro` | 100% | ✅ | `routes/sispag.ts:505,528,550` |
| Entrada validada com Zod nas rotas novas | 100% (`safeParse` em todas) | 100% | ✅ | `routes/sispag.ts:435-536` |
| SQL novo com interpolação de string (repos sispag do delta) | 0 sítios (grep de template literal com `${` em SQL) | 0 | ✅ | `grep` em `domain/repository/sispag/*.ts` |
| Guarda de remessa antes de qualquer chamada ao ERP | presente | presente | ✅ | `RemessaService.ts:253-258` |
| Conferência limpa em reabrir/devolver | sim (SQL `CASE ... NULL`) | sim | ✅ | `LotePagamentoRepository.ts:641-642, 789-790` |
| Trilha de auditoria imutável | trigger recusa UPDATE/DELETE/TRUNCATE | imutável no DB | ✅ | `migrations/0078...sql:87-97` |
| Restrição de segregação no DB (CHECK `conferido_por <> finalizado_por`) | ausente | presente (defesa em profundidade) | ⚠️ | `migrations/0078...sql` |
| Hardcoded secrets / `.env` / tfstate no delta | não verificado a fundo em `--quick`; sem hits nos arquivos lidos | 0 | ⚠️ | leitura dirigida |
| `npm audit` | ⚠️ **Não medível localmente** (`--quick`) | crit=0, high=0 | ⚠️ | n/a |
| IAM / API Gateway / CloudTrail | ⚠️ **Não medível localmente**: não existe `infra/` (Render) | n/a | ⚠️ | CLAUDE.md |

## 3. Tactics — Cobertura no nf-projects

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Detect Intrusion | Sem alarme para rajada de 403 `SelfConferenceError` / tentativas de autoconferência | ❌ ausente | `SelfConferenceError` só responde 403 |
| Detect Service Denial | Fora do delta | N/A | sem mudança de exposição |
| Verify Message Integrity | Versão otimista (`versao = $versaoEsperada`) em conferir/devolver | ✅ presente | `LotePagamentoRepository.ts:756-759` |
| Detect Message Delay | N/A para o delta (sem mensageria) | N/A | — |
| Identify Actors | `req.user.sub`, fail-closed para vazio/`unknown` | ✅ presente | `ConferenciaLoteRule.ts:7,56-60` |
| Authenticate Actors | Supabase JWT (fora do delta) | ✅ presente | PR #99 (memória do projeto) |
| Authorize Actors | `sispag:conferir`/`sispag:cadastro` por rota + regra de segregação no serviço (finalizou/incluiu item/criou lote manual) | ✅ presente | `ConferenciaLoteRule.ts:29-45`, `routes/sispag.ts:505` |
| Limit Access | Permissões avulsas sem concessão automática na migração; `sispag:ver` basta para ver conta mascarada | ✅ presente | `0079...sql` |
| Limit Exposure | Conta/chave PIX mascaradas ao conferente (`MaskDestino`) | ✅ presente | `domain/libs/sispag/MaskDestino` |
| Encrypt Data | Fora do delta (TLS/Supabase) | N/A | — |
| Separate Entities | Conferente ≠ executor (dual control) | ✅ presente | `ConferenciaLoteRule.impedimento` |
| Change Default Settings | Nenhuma concessão default de permissão | ✅ presente | `0079...sql` |
| Validate Input | Zod com `safeParse` em todas as rotas novas; SQL parametrizado (`$ator`, `$loteId`) | ✅ presente | `routes/sispag.ts:435`, `LotePagamentoRepository.ts:756` |
| Revoke Access | Devolver limpa finalização e conferência; reabrir limpa conferência | ✅ presente | `LotePagamentoRepository.ts:786-791` |
| Lock Computer | Sem bloqueio de conta após tentativas de autoconferência | ❌ ausente | — |
| Inform Actors | Erro 403 tipado com motivo; sem notificação a gestor | ⚠️ parcial | `SelfConferenceError` |
| Restore | Reabrir/devolver para RASCUNHO preservam histórico | ✅ presente | `LotePagamentoService.ts:436-448` |
| Audit Trail | `sispag_verificacao_evento` append-only (trigger), gravado na mesma transação da mutação | ✅ presente | `0078...sql:87-97`, `LotePagamentoRepository.ts:760-768` |

## 4. Findings (achados)

Nenhum P0 nem P1 no delta. A segregação de funções (I13l) não foi contornada por nenhum dos vetores testados: body forjado, reabertura e devolução com limpeza de estado, e o guard no `RemessaService`.

### F-security-1: Segregação de funções só em código, sem restrição no banco

- **Severidade**: P2
- **Tactic violada**: Separate Entities (defesa em profundidade)
- **Localização**: `src/backend/migrations/0078_sispag_perfil_canal_conferencia.sql`; `LotePagamentoRepository.ts:756-759`
- **Evidência (objetiva)**:
  ```
  UPDATE lote_pagamento SET conferido_por = $ator ... WHERE ... AND conferido_por IS NULL
  -- sem CHECK (conferido_por IS DISTINCT FROM finalizado_por)
  ```
- **Impacto técnico**: Um novo caminho de código ou script (jobs de probe/validate rodam com acesso direto ao banco) pode gravar `conferido_por` igual a `finalizado_por` sem passar por `ConferenciaLoteRule`. O `RemessaService` só testa `!lote.conferidoPor` (`RemessaService.ts:256`), não a distinção.
- **Impacto de negócio**: A garantia anti-fraude depende de nenhum caminho futuro esquecer a regra. Um insider com acesso ao banco gera a remessa de um lote que ele mesmo montou.
- **Métrica de baseline**: 0 constraints de DB para a regra; 1 ponto de aplicação (serviço) mais o guard de remessa, que testa só a presença.

### F-security-2: Identidade comparada por username normalizado, sem alerta de tentativa de autoconferência

- **Severidade**: P2
- **Tactic violada**: Detect Intrusion
- **Localização**: `ConferenciaLoteRule.ts:56-60`, `domain/errors/SelfConferenceError.ts`
- **Evidência (objetiva)**:
  ```
  const normalizada = id?.trim().toLowerCase();  // username, não id imutável
  ```
- **Impacto técnico**: Duas contas da mesma pessoa (alias, e-mail diferente) passam como "outra pessoa". Tentativas de autoconferência negadas (403) não geram métrica nem alerta.
- **Impacto de negócio**: Conluio ou conta duplicada vira quórum válido. Uma rajada de tentativas fica invisível ao gestor.
- **Métrica de baseline**: 0 alarmes; 1 sinal (log do 403). Não medível: contas duplicadas por pessoa em produção.

### F-security-3: Conferência não é reverificada no envio da remessa

- **Severidade**: P3
- **Tactic violada**: Verify Message Integrity
- **Localização**: `RemessaService.ts:250-258`
- **Evidência (objetiva)**:
  ```
  // Não re-verifica os itens aqui (gap Q10) ... if (exigeConferencia && !lote.conferidoPor) throw
  ```
- **Impacto técnico**: Não há hash/versão dos itens vinculado à conferência. A mitigação existente é a imutabilidade do lote FINALIZADO e a reconferência do destino ao vivo (I10a/I12f).
- **Impacto de negócio**: Risco residual baixo, já aceito no ADR-0063 (gap Q10).
- **Métrica de baseline**: 1 verificação booleana (`conferidoPor`) entre conferir e remessa.

## 5. Cards Kanban

### [security-1] Adicionar CHECK de segregação em `lote_pagamento` e guard no RemessaService

- **Problema**
  > A regra conferente ≠ finalizador existe só no serviço. O banco aceita `conferido_por = finalizado_por`, e a remessa só confere se `conferido_por` está preenchido.

- **Melhoria Proposta**
  > Nova migration com `CHECK (conferido_por IS NULL OR conferido_por IS DISTINCT FROM finalizado_por)` (comparação em minúsculas). No `RemessaService`, repetir `ConferenciaLoteRule.impedimento(lote, lote.conferidoPor)` como invariante (defesa em profundidade).

- **Resultado Esperado**
  > O banco recusa gravação autoconferida. Pontos de aplicação da regra: 1 → 3.

- **Tactic alvo**: Separate Entities
- **Severidade**: P2
- **Esforço estimado**: S
- **Findings relacionados**: F-security-1
- **Métricas de sucesso**:
  - Constraints de DB para dual control: 0 → 1
  - Pontos de aplicação: 1 → 3
- **Risco de não fazer**: Um caminho futuro (job, script, rota) esquece a regra e a fraude que a feature previne volta a ser possível.
- **Dependências**: nenhuma

### [security-2] Alarmar tentativas de autoconferência e reforçar a identidade

- **Problema**
  > `SelfConferenceError` só devolve 403. Ninguém é avisado de que alguém tentou conferir o próprio lote, e a identidade é um username normalizado.

- **Melhoria Proposta**
  > Registrar evento `CONFERENCIA_NEGADA` em `sispag_verificacao_evento` (append-only) e contar no painel de operação, com alerta acima de N por dia. Avaliar comparar também o `sub` imutável do Supabase, além do username.

- **Resultado Esperado**
  > Tentativas negadas passam a ser visíveis e auditáveis. Alarmes: 0 → 1.

- **Tactic alvo**: Detect Intrusion
- **Severidade**: P2
- **Esforço estimado**: M
- **Findings relacionados**: F-security-2
- **Métricas de sucesso**:
  - Alarmes de tentativa negada: 0 → 1
  - Eventos de negação persistidos: 0% → 100%
- **Risco de não fazer**: Uma tentativa de fraude em andamento fica sem rastro além de log efêmero.
- **Dependências**: nenhuma

### [security-3] Vincular a conferência ao conteúdo dos itens (hash)

- **Problema**
  > A conferência é um booleano (`conferido_por`). Se um novo caminho permitir editar item de lote FINALIZADO, a conferência continua válida sobre conteúdo alterado.

- **Melhoria Proposta**
  > Gravar um hash dos itens/destinos no momento de `conferir`. O `RemessaService` recalcula e compara antes de chamar o ERP.

- **Resultado Esperado**
  > Alteração pós-conferência invalida a remessa. Verificações de integridade: 0 → 1.

- **Tactic alvo**: Verify Message Integrity
- **Severidade**: P3
- **Esforço estimado**: M
- **Findings relacionados**: F-security-3
- **Métricas de sucesso**:
  - Verificações de integridade conferência→remessa: 0 → 1
- **Risco de não fazer**: Risco residual baixo, já aceito no gap Q10 do ADR-0063.
- **Dependências**: decisão de produto sobre o gap Q10

## 6. Notas do agente

- Escopo: delta da feature, `--quick`. Li `ConferenciaLoteRule`, `ConferenciaLoteService`, o guard do `RemessaService`, as rotas de conferir/devolver, o SQL de `conferir`/`devolver` e as migrations 0078/0079. Não fiz `npm audit` nem varredura global de secrets; não há `infra/`.
- Não verifiquei por leitura completa: a máscara no `LotePagamentoApiView`, a barreira que impede edição de itens em lote FINALIZADO e o `requireAuth` global. Estes pontos merecem teste de integração.
- Cross-QA: Audit Trail se sobrepõe a Fault Tolerance. Validate Input se sobrepõe a Integrability. Restore (reabrir/devolver) se sobrepõe a Availability e Deployability.
