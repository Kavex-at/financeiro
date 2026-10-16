---
qa: Security
qa_slug: security
run_id: 2026-10-15-0130
agent: qa-security
generated_at: 2026-10-15T01:30:00-03:00
scope: backend
score: 8.5
findings_count: 3
cards_count: 3
---

# Security — Regis-Review (delta sispag-sugestao-para-todo-titulo, ADR-0072)

## 1. Cenário Geral (Bass General Scenario)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Usuário autenticado com `sispag:executar` (ou cliente adulterado) | POST `/sispag/sugestoes-boleto/confirmar` com chave de título/boleto cujo desfecho é fraco, ambíguo, disputado ou vencido, ou sem `reconheceAvisos` | `BoletoSuggestionService.confirmar` + `MotorSugestaoBoleto` + rota `sispag.ts` | Produção, DDA sincronizado, carteira com 894 títulos elegíveis | Servidor recalcula o cenário do banco, recusa o que não é o candidato escolhido (409/422), exige reconhecimento do aviso e grava quem reconheceu | 0 decisões CONFIRMADA fora de UNICA_SEGURA/SO_ATENCAO; 100% das confirmações com aviso carregam `RECONHECEU_VENCE_ANTES` + `decididoPor` |

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Caminhos que gravam decisão CONFIRMADA | 1 (`confirmar`) | 1 | ✅ | `grep inserirDecisao src/backend` (só Service + Repository) |
| Confirmação decidida sobre estado recalculado (não cache) | sim (`sugerirAgora()` direto) | sim | ✅ | `BoletoSuggestionService.ts:270,283` |
| Rotas novas/alteradas com guard de permissão | 2/2 (`GET /titulo` = `SISPAG_VER`; confirmar = `SISPAG_EXECUTAR`) | 100% | ✅ | `routes/sispag.ts`, `routePermissions.test.ts` (58 rotas sispag) |
| Query/body novos validados por Zod `.strict()` | 3/3 (`TituloSugestaoQuerySchema`, `ConfirmarSugestaoBodySchema`, `situacao` nativeEnum) | 100% | ✅ | `SugestaoBoletoSchemas.ts` |
| Campos de barras/linha digitável em `DesfechoTituloView`/`CandidatoTituloView` | 0 (emissor só `banco/layout/mascarado`, `emissorChave` removida) | 0 | ✅ | `SugestaoBoleto.ts:305-325`, `paraViewDesfecho` |
| Rate limit na leitura nova `GET /titulo` | ausente (só confirmar/copiar têm limiter) | presente | ⚠️ | `routes/sispag.ts` |
| Reconhecimento atrelado aos valores vistos (datas) | não (só o sinal) | sim | ⚠️ | `exigirReconhecimento` |
| Secrets hardcoded no delta | 0 | 0 | ✅ | inspeção do diff |
| `npm audit` / SQL novo | não medido / sem SQL novo (sem migration) | — | ⚠️ | Não medível neste escopo reduzido |

## 3. Tactics — Cobertura

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Detect Intrusion | Fora do delta | N/A | sem mudança de superfície de detecção |
| Detect Service Denial | Limiter só em confirmar/copiar; detalhe novo sem limiter | ⚠️ parcial | `limiteDecisaoBoleto` |
| Verify Message Integrity | Estado relido do banco no confirmar; nada confiado do cliente | ✅ | `BoletoSuggestionService.ts:255-290` |
| Detect Message Delay | N/A | N/A | não aplicável ao delta |
| Identify Actors | `ator(req)` = `req.user.sub`; `exigirAtor` recusa genéricos | ✅ | `sispag.ts:153`, `Service.ts:766` |
| Authenticate Actors | Middleware global existente, inalterado | ✅ | `routePermissions.test.ts` |
| Authorize Actors | ver/executar por rota; teste de introspecção cobre a rota nova | ✅ | `routePermissions.test.ts:148-149` |
| Limit Access | Só o candidato `confirmavel` do motor passa; rival => 409 | ✅ | `sugestaoConfirmavel` |
| Limit Exposure | Barras/linha nunca na lista/detalhe; `Cache-Control: no-store` no detalhe | ✅ | `paraViewDesfecho`, rota `/titulo` |
| Encrypt Data | Inalterado | N/A | — |
| Separate Entities | Passo 2 (I17) intocado; reutiliza só `CONFIRMADA` | ✅ | diff não toca passo 2 |
| Change Default Settings | N/A | N/A | — |
| Validate Input | Zod strict; `reconheceAvisos` enum de 1 valor, `max(1)` | ✅ | `SugestaoBoletoSchemas.ts` |
| Revoke Access | Rejeitar/anular/revogar inalterados | ✅ | sem diff funcional |
| Lock Computer | N/A | N/A | — |
| Inform Actors | 409/422 nomeados com motivo e datas | ✅ | `WarningAcknowledgementRequiredError` |
| Restore | N/A | N/A | decisão anulável (I15l) |
| Audit Trail | `decididoPor`, `sinais` com `RECONHECEU_VENCE_ANTES`, evento `DECISAO_CONFIRMADA` com `detalhe.reconheceu` + `ator` | ✅ | `Service.ts:287-394` |

## 4. Findings

Resposta às perguntas do foco: nenhum bypass encontrado. Ordem em `confirmar`: idempotência/unicidade (decisão já existente) -> releitura do banco (pago, DDA, vinculado) -> `regra.avaliar` (vencido => 422) -> `sugestaoConfirmavel` (só o candidato escolhido pelo motor sobre cenário recalculado, nunca cache) -> `exigirReconhecimento` (422) -> transação com unique constraints. Corpo/ids forjados só chegam a um boleto cujo estado recalculado seja UNICA_SEGURA/SO_ATENCAO. O atalho idempotente (decisão já CONFIRMADA do mesmo par) devolve a decisão existente; não cria nada novo.

### F-security-1: Rota de detalhe por título sem rate limit

- **Severidade**: P3
- **Tactic violada**: Detect Service Denial / Limit Exposure
- **Localização**: `src/backend/routes/sispag.ts` (GET `/sugestoes-boleto/titulo`)
- **Evidência (objetiva)**:
  ```
  router.get('/sugestoes-boleto/titulo', exigirPermissao(SISPAG_VER), asyncHandler(...))
  // sem limiteDecisaoBoleto/limiteCopiaLinha; confirmar e copiar-linha têm
  ```
- **Impacto técnico**: um usuário com `sispag:ver` enumera títulos e dispara `cache.obter(calcularCenario)`; o cenário é single-flight, então o custo é limitado (~0,6 s por recálculo).
- **Impacto de negócio**: baixo; dados já visíveis na listagem, sem barras.
- **Métrica de baseline**: 0 limiters nas 2 leituras de sugestão.

### F-security-2: Reconhecimento do aviso não é atrelado às datas que o analista viu

- **Severidade**: P2
- **Tactic violada**: Verify Message Integrity / Authorize Actors
- **Localização**: `BoletoSuggestionService.ts:997-1014`, `ConfirmarSugestaoBodySchema`
- **Evidência (objetiva)**:
  ```
  if (!reconhecidos.includes(VENCE_ANTES_DO_TITULO)) throw WarningAcknowledgementRequiredError
  return [...sinais, RECONHECEU_VENCE_ANTES]
  ```
- **Impacto técnico**: o reconhecimento é um booleano genérico. Se entre abrir o diálogo e confirmar a data de débito/vencimento do boleto mudar (novo lote, sync DDA), o servidor aceita o reconhecimento antigo para a situação nova. O servidor já recalcula e ainda recusa vencido (422), então o risco é só de ciência desatualizada, não de pagamento de boleto vencido/errado.
- **Impacto de negócio**: trilha diz "analista reconheceu" sem provar o quê (datas) foi reconhecido.
- **Métrica de baseline**: 0 campos de datas no body de reconhecimento; 1 sinal booleano gravado.

### F-security-3: Fallback `ator = 'unknown'` depende de `exigirAtor` para não gravar trilha anônima

- **Severidade**: P3
- **Tactic violada**: Identify Actors
- **Localização**: `routes/sispag.ts:153`, `BoletoSuggestionService.ts:766`
- **Evidência (objetiva)**:
  ```
  const ator = (req) => req.user?.sub ?? 'unknown';
  ATORES_RECUSADOS.has(ator.trim().toLowerCase())  // confirma 'unknown' recusado?
  ```
- **Impacto técnico**: a segurança do campo "quem reconheceu" repousa em lista de recusa; o guard de permissão já impede acesso sem `req.user`, então é defesa em profundidade.
- **Impacto de negócio**: mínimo.
- **Métrica de baseline**: 1 fallback literal; conferir que `unknown` está em `ATORES_RECUSADOS` (não verificado linha a linha).

## 5. Cards Kanban

### [security-1] Atrelar o reconhecimento de aviso às datas apresentadas

- **Problema**
  > `reconheceAvisos` é só o enum `VENCE_ANTES_DO_TITULO`. O servidor não sabe qual par de datas o analista viu; se o cenário mudar entre diálogo e confirmação, o reconhecimento antigo vale para a situação nova.
- **Melhoria Proposta**
  > Opcional `reconhecimentoRef` (vencimentoBoleto + dataDebito exibidos) no body; servidor compara com a avaliação recalculada e responde 409 com os novos valores se divergirem; gravar as datas reconhecidas no evento `DECISAO_CONFIRMADA`. Tocar `SugestaoBoletoSchemas.ts`, `exigirReconhecimento`, `ReconhecerAvisoDialog`.
- **Resultado Esperado**
  > Trilha prova o quê foi reconhecido. Reconhecimentos divergentes: indeterminado -> 0 aceitos.
- **Tactic alvo**: Verify Message Integrity
- **Severidade**: P2
- **Esforço estimado**: S
- **Findings relacionados**: F-security-2
- **Métricas de sucesso**:
  - Eventos de confirmação com datas reconhecidas gravadas: 0% -> 100% dos com aviso
- **Risco de não fazer**: auditoria não consegue provar ciência do aviso específico.
- **Dependências**: nenhuma

### [security-2] Aplicar rate limit na leitura de detalhe por título

- **Problema**
  > GET `/sugestoes-boleto/titulo` não tem limiter, ao contrário de confirmar/copiar.
- **Melhoria Proposta**
  > Reusar `buildSugestaoBoletoLimiter({}, 'detalhe')` na rota.
- **Resultado Esperado**
  > Enumeração de títulos limitada por usuário; 0 rotas de sugestão sem limiter.
- **Tactic alvo**: Detect Service Denial
- **Severidade**: P3
- **Esforço estimado**: S
- **Findings relacionados**: F-security-1
- **Métricas de sucesso**:
  - Rotas de sugestão sem limiter: 2 -> 0 (ou justificada)
- **Risco de não fazer**: ruído de carga sob script; sem impacto financeiro.
- **Dependências**: nenhuma

### [security-3] Teste explícito de que ator genérico é recusado em confirmar com reconhecimento

- **Problema**
  > A trilha "quem reconheceu" depende de `exigirAtor` recusar `unknown`; não há teste que ligue isso ao caminho com `reconheceAvisos`.
- **Melhoria Proposta**
  > Adicionar caso em `BoletoSuggestionService.test.ts`: ator `unknown`/vazio com `reconheceAvisos` -> erro e nenhuma decisão gravada.
- **Resultado Esperado**
  > Regressão do fallback detectada pelo CI.
- **Tactic alvo**: Identify Actors
- **Severidade**: P3
- **Esforço estimado**: S
- **Findings relacionados**: F-security-3
- **Métricas de sucesso**:
  - Testes cobrindo ator recusado em confirmar com aviso: 0 -> 1
- **Risco de não fazer**: remoção acidental da recusa grava decisão anônima.
- **Dependências**: nenhuma

## 6. Notas do agente

- Escopo reduzido ao delta; sem `npm audit`, SSM, IAM (não existe `infra/`).
- Nenhum P0: não achei caminho para CONFIRMADA de candidato fraco/ambíguo/disputado/vencido; passo 2 (I17) só consome decisões criadas por `confirmar`, único escritor.
- Cross-QA: Validate Input com Integrability/Fault Tolerance; Audit Trail com Fault Tolerance; condição de corrida entre releitura e transação é coberta por unique constraints (I15j).
