---
qa: Security
qa_slug: security
run_id: 2026-10-08-2012-favorecido-autorizado
agent: qa-security
generated_at: 2026-10-08T20:30:00-03:00
scope: all
score: 8
findings_count: 4
cards_count: 3
---

# Security — Regis-Review

## 1. Cenário Geral (Bass General Scenario)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Insider (analista com `sispag:executar`) ou conta comprometida | Pede autorização de um favorecido cujo cadastro no Conexos foi alterado para uma conta do atacante e tenta aprová-lo sozinho, ou lê o destino completo sem rastro | `AuthorizedPayeeService`, `AuthorizedPayeeRule`, rotas `/sispag/favorecidos-autorizados/*`, `PayeeFingerprint`, tabela de eventos | Produção (Render), guarda `SISPAG_FAVORECIDO_AUTORIZADO_ENABLED` ligada | Aprovação exige 2º usuário (id autenticado) com `sispag:autorizar_favorecido`; aprovação só vale para a impressão HMAC que a tela mostrou; destino completo só no `revelar`, auditado; sem segredo a guarda falha fechada | 0 aprovações pelo próprio solicitante; 0 destinos completos em log/ledger/erro; 100% das transições com evento na mesma transação |

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Rotas novas `/sispag/favorecidos-autorizados*` com `exigirPermissao` | 9/9 | 100% | ✅ | `src/backend/routes/sispag.ts:531-690`; `http/routePermissions.test.ts:127-135` |
| Rotas novas com Zod no boundary (query/params/body) | 9/9 (400 sem eco de valor, `detalhesSemValor`) | 100% | ✅ | `routes/sispag.ts:518-530` |
| Regra aprovador ≠ solicitante por id autenticado | Presente (`req.user.sub`, comparação estrita) | presente | ✅ | `domain/libs/sispag/AuthorizedPayeeRule.ts:65-70` |
| SQL não parametrizado nos arquivos novos | 0 (só `$nome`; `SET` dinâmico montado de mapa fixo de colunas) | 0 | ✅ | `AuthorizedPayeeRepository.ts:111-252` |
| Segredo HMAC com tamanho mínimo e falha fechada | >=32 bytes; sem ele a flag resolve `false` e `calcular` lança | presente | ✅ | `EnvironmentProvider.ts:15-127`, `PayeeFingerprint.ts:41-46` |
| Segredo HMAC armazenado em SSM SecureString | env var no Render (sem `infra/`) | SSM | ⚠️ | `.env.example:155-159` |
| Destino completo em log/evento/erro | 0 ocorrências nos logs lidos (logs levam id, pesCod, modalidade, ator, `motivo()` = HTTP status ou nome do erro) | 0 | ✅ | `AuthorizedPayeeService.ts:243-251, 391-396, 605-609, 650-654` |
| Trilha append-only | Trigger UPDATE/DELETE + TRUNCATE bloqueados | presente | ✅ | `0080_sispag_favorecido_autorizado.sql:145-165` |
| Segredos hardcoded no delta | 0 | 0 | ✅ | leitura dos arquivos do delta |
| Rate limit / alarme em `revelar` | ausente | presente | ⚠️ | `routes/sispag.ts:654-670` |
| `npm audit`, CloudTrail/GuardDuty, CORS, IAM | ⚠️ **Não medível localmente** neste delta: sem `infra/`; `npm audit` fora do escopo (só arquivos da feature). Recomendação: rodar `npm audit` no gate de PR. | - | - | - |

## 3. Tactics — Cobertura

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Detect Intrusion | Alerta `SISPAG_DESTINO_ALTERADO` quando o cadastro muda sob favorecido AUTORIZADO; sem detecção de uso anômalo de `revelar` | ⚠️ parcial | `AuthorizedPayeeService.ts:533-552` |
| Detect Service Denial | Não coberto pelo delta | N/A (fora do escopo; sem WAF no Render) | - |
| Verify Message Integrity | HMAC-SHA256 do destino normalizado compara tela x cadastro vivo (anti-TOCTOU) | ✅ presente | `PayeeFingerprint.ts`; `AuthorizedPayeeRule.ts:80` |
| Detect Message Delay | N/A: aprovação relê o cadastro ao vivo no instante da decisão | N/A | `AuthorizedPayeeService.ts:191` |
| Identify Actors | `req.user.sub` gravado em solicitado_por/decidido_por/evento.ator | ✅ presente | `routes/sispag.ts:124` |
| Authenticate Actors | Middleware de auth existente (legado), `exigirPermissao` nega sem `req.acesso` | ✅ presente | `http/acesso.ts:218-223` |
| Authorize Actors | Permissão nova `sispag:autorizar_favorecido` no catálogo, migração 0080 converte `sispag:excecao`; two-person rule | ✅ presente | `Permission.ts:24`; migração 0080:231-262 |
| Limit Access | `revelar` restrito ao aprovador; Cache-Control no-store; destino mascarado em toda listagem | ✅ presente | `routes/sispag.ts:654-668` |
| Limit Exposure | Mesmo valor completo nunca persistido (só máscara + impressão) | ✅ presente | `AuthorizedPayeeService.ts:64-70, 207-215` |
| Encrypt Data | Impressão HMAC irreversível; chave fora do banco | ✅ presente | `PayeeFingerprint.ts` |
| Separate Entities | Aprovador separado do solicitante; trilha em tabela própria | ✅ presente | `AuthorizedPayeeRule.ts:68` |
| Change Default Settings | Falha fechada: sem segredo/guarda, TED/PIX não são oferecidos | ✅ presente | `routes/sispag.ts:688-700` |
| Validate Input | Zod em params/query/body; erros sem valor | ✅ presente | `routes/sispag.ts:518-530` |
| Revoke Access | `revogar` com motivo; rotação de keyId invalida impressões antigas (comparação falha) | ⚠️ parcial (rotação sem procedimento) | `AuthorizedPayeeService.ts:262-271` |
| Lock Computer | N/A neste delta | N/A | - |
| Inform Actors | Alerta de reaprovação; sem alerta para `revelar` | ⚠️ parcial | `AuthorizedPayeeService.ts:537` |
| Restore | Rollback SQL 0080 presente (ver Deployability) | ✅ presente | `migrations/rollbacks/0080_*.rollback.sql` |
| Audit Trail | Evento na mesma transação em solicitar/aprovar/decidir; `DESTINO_REVELADO` gravado antes de devolver (falha de gravação aborta a resposta); trigger append-only | ✅ presente | `AuthorizedPayeeService.ts:225-241, 385-390` |

## 4. Findings

Nenhum P0: nenhum defeito concreto no delta leva dinheiro a destino errado/não autorizado. Os pontos abaixo são endurecimento.

### F-security-1: Segredo do HMAC vive em variável de ambiente, sem procedimento de rotação

- **Severidade**: P2
- **Tactic violada**: Revoke Access / Encrypt Data (key management)
- **Localização**: `.env.example:155-159`, `EnvironmentProvider.ts:105-127`, `PayeeFingerprint.ts:41-50`
- **Evidência (objetiva)**:
  ```
  SISPAG_FAVORECIDO_FINGERPRINT_KEY=  (segredo; gerar com: openssl rand -hex 32)
  SISPAG_FAVORECIDO_FINGERPRINT_KEY_ID=v1
  ```
  O `keyId` é gravado, mas não há rotina que recalcule/reaprove impressões após trocar a chave; trocar o segredo faz toda impressão divergir.
- **Impacto técnico**: rotação acidental ou por incidente faz todos os favorecidos virarem "destino mudou" (falha fechada, correta) sem caminho de migração; vazamento da chave permite a quem tem acesso ao banco confirmar palpites de conta (espaço de busca pequeno).
- **Impacto de negócio**: pagamentos TED/PIX paralisados até reaprovação em massa, ou rotação adiada indefinidamente por medo disso.
- **Métrica de baseline**: 0 procedimentos de rotação documentados; 1 segredo por ambiente (Render env).

### F-security-2: `revelar` sem limite de taxa nem alerta, e `ator` com fallback `'unknown'`

- **Severidade**: P3
- **Tactic violada**: Detect Intrusion / Inform Actors
- **Localização**: `routes/sispag.ts:124`, `routes/sispag.ts:654-670`
- **Evidência (objetiva)**:
  ```
  const ator = (req: Request): string => req.user?.sub ?? 'unknown';
  ```
  Inalcançável hoje (o guard recusa sem `req.acesso`), mas, se o guard regredir, solicitante e aprovador seriam ambos `'unknown'` e a regra os trataria como a mesma pessoa (falha fechada, mas o evento fica sem autor). Um aprovador pode revelar N destinos completos em sequência sem sinal.
- **Impacto técnico**: exfiltração em massa de dados de pagamento por conta de aprovador comprometida só é detectável revisando eventos manualmente.
- **Impacto de negócio**: exposição de dados bancários de fornecedores (LGPD) sem detecção.
- **Métrica de baseline**: 0 limites/alertas para `DESTINO_REVELADO`.

### F-security-3: `reconferir` com `sispag:ver` pode abrir reaprovação (mutação por permissão de leitura)

- **Severidade**: P3
- **Tactic violada**: Authorize Actors
- **Localização**: `routes/sispag.ts:636-651`, `AuthorizedPayeeService.ts:320-340`
- **Evidência (objetiva)**: `POST .../reconferir` usa `P.SISPAG_VER` (`routePermissions.test.ts:133`) e chama `abrirReaprovacao` quando o destino diverge; o ator é passado e auditado.
- **Impacto técnico**: um leitor pode derrubar um favorecido AUTORIZADO para REAPROVACAO_PENDENTE (e bloquear pagamentos) repetidamente, se o cadastro divergir. Efeito é falha fechada, não perda de dinheiro.
- **Impacto de negócio**: negação de serviço operacional limitada, com trilha de quem acionou.
- **Métrica de baseline**: 1 rota de mutação protegida só por `sispag:ver`.

### F-security-4: Impressão HMAC exposta a qualquer `sispag:ver` na listagem

- **Severidade**: P3
- **Tactic violada**: Limit Exposure
- **Localização**: `AuthorizedPayeeRepository.ts:23-27`, `routes/sispag.ts:531-541`
- **Evidência (objetiva)**: `COLUNAS` inclui `fingerprint` e `fingerprint_observado`, devolvidos por `listar`. Sem a chave o valor não é reversível, então o risco é baixo; é necessária para o fluxo anti-TOCTOU de `aprovar`, mas poderia sair da listagem geral.
- **Impacto técnico**: aumenta a superfície caso a chave vaze.
- **Impacto de negócio**: marginal.
- **Métrica de baseline**: 2 campos de impressão por registro na resposta de listagem.

## 5. Cards Kanban

### [security-1] Mover o segredo do HMAC para SSM e documentar a rotação de chave

- **Problema**
  > O segredo `SISPAG_FAVORECIDO_FINGERPRINT_KEY` é env var do Render e não há procedimento para trocá-lo; uma troca invalida todas as impressões sem caminho de migração (F-security-1).
- **Melhoria Proposta**
  > Ler o segredo de SSM SecureString `/tenants/{env}/{client}/favorecido-fingerprint-key` quando houver infra; até lá, registrar runbook de rotação: duas chaves ativas por `keyId` (`PayeeFingerprint` calcula com a chave do keyId gravado) e job que reabre reaprovação em lote controlado. Tactic: Revoke Access.
- **Resultado Esperado**
  > Rotação executável sem parada de TED/PIX; segredo fora do painel de env.
- **Tactic alvo**: Revoke Access
- **Severidade**: P2
- **Esforço estimado**: M
- **Findings relacionados**: F-security-1
- **Métricas de sucesso**:
  - Runbook de rotação: 0 → 1
  - Chaves aceitas por keyId: 1 → 2 durante a janela
- **Risco de não fazer**: vazamento da chave obriga a parar pagamentos TED/PIX ou a seguir com chave comprometida.
- **Dependências**: scaffold de `infra/` (para SSM); runbook independe.

### [security-2] Limitar e alarmar o `revelar`, e remover o fallback `'unknown'`

- **Problema**
  > `revelar` entrega destino completo sem limite de taxa nem alerta, e `ator()` cai em `'unknown'` (F-security-2).
- **Melhoria Proposta**
  > Limite por usuário (ex.: 30/h) com 429, alerta em `NotificacaoService` quando passar de um limiar, e `ator` lançando 401 se `req.user.sub` faltar. Tactics: Detect Intrusion, Inform Actors.
- **Resultado Esperado**
  > Uso anômalo de `revelar` gera alerta; autor nunca é `'unknown'`.
- **Tactic alvo**: Detect Intrusion
- **Severidade**: P3
- **Esforço estimado**: S
- **Findings relacionados**: F-security-2
- **Métricas de sucesso**:
  - Alertas de revelação em massa: 0 → 1 regra
  - Eventos com ator `unknown`: possível → impossível
- **Risco de não fazer**: exfiltração de dados bancários por conta de aprovador comprometida passa despercebida.
- **Dependências**: nenhuma.

### [security-3] Restringir `reconferir` e tirar a impressão da listagem geral

- **Problema**
  > `reconferir` muta estado sob `sispag:ver` (F-security-3) e a listagem devolve impressões desnecessariamente (F-security-4).
- **Melhoria Proposta**
  > Exigir `sispag:executar` em `reconferir` (ou separar leitura de abertura de reaprovação) e devolver a impressão só no `reconferir`/detalhe do aprovador. Tactic: Authorize Actors / Limit Exposure.
- **Resultado Esperado**
  > Mutações só por quem executa; impressão só na tela de decisão.
- **Tactic alvo**: Authorize Actors
- **Severidade**: P3
- **Esforço estimado**: S
- **Findings relacionados**: F-security-3, F-security-4
- **Métricas de sucesso**:
  - Rotas de mutação com `sispag:ver`: 1 → 0
  - Campos de impressão na listagem: 2 → 0
- **Risco de não fazer**: leitor derruba autorizações vigentes; superfície maior se a chave vazar.
- **Dependências**: ajustar `routePermissions.test.ts` e a tela `favorecidos-autorizados`.

## 6. Notas do agente

- Escopo: backend do delta (serviço, regra, repositório, rotas, migração 0080, fingerprint, env). Frontend lido só quanto ao contrato (não encontrado armazenamento de token novo nem `dangerouslySetInnerHTML` avaliado em profundidade).
- Não medidos: npm audit, CloudTrail/GuardDuty, IAM, CORS (sem `infra/`; fora do delta).
- Cross-QA: Audit Trail (Fault Tolerance); Validate Input (Integrability); Restore/rollback 0080 (Availability, Deployability).
