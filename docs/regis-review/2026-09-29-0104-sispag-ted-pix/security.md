---
qa: Security
qa_slug: security
run_id: 2026-09-29-0104
agent: qa-security
generated_at: 2026-09-28T00:00:00-03:00
scope: backend
score: 7
findings_count: 5
cards_count: 4
---

# Security — Regis-Review

## 1. Cenário Geral (Bass General Scenario aplicado ao financeiro / sispag-ted-pix)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Insider ou conta de analista/admin comprometida | Troca o destino (conta/chave PIX) de um título de fornecedor num lote RASCUNHO para uma conta própria e envia a remessa TED/PIX | `POST/DELETE /sispag/lotes/:id/itens/.../destino`, `DestinoManualValidator`, remessa CNAB | Produção, flags `SISPAG_*_ENABLED` ligadas | Rota exige `admin`; titularidade (CPF/CNPJ do destino = favorecido do título) é verificada; toda troca gera linha em trilha só-inclusão; dado nunca em log/ledger/resposta | 0 destinos com titular divergente aceitos; 100% das trocas com ator+antes/depois auditados; 0 ocorrências de conta/chave/documento em log, `request_payload`, erro ou resposta |

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Segredos hardcoded no delta | 0 (probes leem env; nenhum literal de credencial) | 0 | ✅ | leitura dos probes + `git diff origin/main...HEAD` |
| Rotas novas de destino (POST/DELETE) com `requireRole('admin')` | 2/2 | 100% | ✅ | `src/backend/routes/sispag.ts:186-260` |
| Rotas novas com Zod no boundary | 2/2 (`destinoBodySchema`, `versaoDestinoSchema`, `chaveTituloSchema`; destino `.strict()` discriminado) | 100% | ✅ | `routes/sispag.ts`, `DestinoManualSchema.ts` |
| `GET /sispag/recursos` (novo) | autenticado, sem role; só 3 booleanos | sem dado sensível | ✅ | `routes/sispag.ts` |
| Respostas com lote passando por `LotePagamentoApiView` (mascaramento) | todas as `res.json({ lote })` do diff | 100% | ✅ | diff de `routes/sispag.ts` |
| `details` de erro Zod sem o valor enviado | sim (`detalhesSemValor`: só campo+código) | sim | ✅ | `routes/sispag.ts` |
| SQL novo parametrizado | named params (`$auditId`, `$loteId`...) | 100% | ✅ | `LotePagamentoRepository.ts:559-566` |
| Trilha de destino imutável no banco | trigger recusa UPDATE/DELETE/TRUNCATE; `test:sql` 30/30 | presente | ✅ | `migrations/0066_sispag_destino_manual.sql` |
| Jobs com `console.error(e)` cru (pré-existente) | 10 arquivos por `grep -c` (o caller cita 11) | 0 | ❌ | `grep -c "console.error(e)" src/backend/jobs/*.ts` |
| Probes novos: logam só `.message` e mascaram documento/chave | sim | sim | ✅ | `jobs/probe-sispag-*.ts` |
| Quatro olhos na troca de destino | 0 aprovadores (decisão ADR-0054 D2/D3) | risco aceito e mitigado | ⚠️ | ADR-0054 |
| Destino cifrado em nível de aplicação | não (JSONB em claro; depende do repouso do provedor) | cifrado | ⚠️ | migration 0066 |
| Alarme de falha de auth / de troca de destino | ausente | presente | ❌ | grep em `src/backend` |
| `npm audit`, CloudTrail/GuardDuty, IAM, SSM | ⚠️ **Não medível localmente**: `--quick` sem rede; não existe `infra/` (deploy Render/Vercel). Recomendação: medir no ciclo que criar o Terraform | — | ⚠️ | CLAUDE.md |

## 3. Tactics — Cobertura no financeiro

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Detect Intrusion | Nenhum alerta em troca de destino nem em falha de login | ❌ ausente | F-security-4 |
| Detect Service Denial | `globalLimiter`/`heavyRouteLimiter` (pré-existente) | ⚠️ parcial | `http/buildApp.ts:54,126` |
| Verify Message Integrity | Remessa CNAB validada por `RemessaCnabValidator` (segmento B, forma de lançamento) | ✅ presente | `libs/cnab/RemessaCnabValidator.ts` |
| Detect Message Delay | N/A: sem canal assíncrono novo na feature | N/A | — |
| Identify Actors | `ator(req)` = `sub`/e-mail gravado em `alterado_por` | ✅ presente | `routes/sispag.ts:102` |
| Authenticate Actors | JWT Supabase via `buildAuthMiddleware` (pré-existente) | ✅ presente | `http/buildApp.ts:116` |
| Authorize Actors | `requireRole('admin')` nas rotas mutáveis; sem segundo aprovador | ⚠️ parcial | F-security-1 |
| Limit Access | Só `admin` altera; leituras de lote a qualquer autenticado | ⚠️ parcial | F-security-3 |
| Limit Exposure | 3 flags default OFF; paridade byte-idêntica com OFF | ✅ presente | `_shared-metrics.md` |
| Encrypt Data | TLS + repouso do provedor; sem cifra de coluna | ⚠️ parcial | F-security-2 |
| Separate Entities | Trilha em tabela separada, sem FK, sobrevive ao lote | ✅ presente | migration 0066 |
| Change Default Settings | Flags nascem OFF | ✅ presente | `EnvironmentProvider` |
| Validate Input | Zod na forma + `DestinoManualValidator` (DV de CPF/CNPJ, e-mail, telefone, UUID, titularidade) | ✅ presente | `DestinoManualSchema.ts`, `DestinoManualValidator.ts` |
| Revoke Access | Sem revogação de sessão server-side (pré-existente, fora do delta) | ❌ ausente | — |
| Lock Computer | N/A: sem bloqueio de conta por tentativas neste escopo | N/A | — |
| Inform Actors | Erros 400/403/409/422 sem eco de valor | ✅ presente | `routes/sispag.ts` |
| Restore | Sem restauração automática; trilha preserva o estado anterior | ⚠️ parcial | colunas `antes`/`depois` |
| Audit Trail | Só-inclusão, imposta por trigger, com ator/antes/depois | ✅ presente | migration 0066 |

## 4. Findings

### F-security-1: Troca de destino sem quatro olhos: um único admin redireciona um pagamento
- **Classificação**: IN_DELTA (risco aceito no ADR-0054 D2/D3; registrado como risco residual)
- **Severidade**: P2
- **Tactic violada**: Authorize Actors
- **Localização**: `src/backend/routes/sispag.ts:186-226`; `LotePagamentoService.definirDestinoManualItem`
- **Evidência (objetiva)**:
  ```
  POST .../destino -> requireRole('admin') -> definirDestinoManualItem(ator); sem segundo aprovador
  ```
- **Impacto técnico**: A mitigação é a checagem de titularidade (`titularDocumento` = documento do favorecido). Um insider que informa o documento correto do fornecedor mas uma conta de terceiro passa: o sistema valida que o documento coincide, não que a conta pertence a ele.
- **Impacto de negócio**: Fraude de redirecionamento de pagamento, o vetor clássico de contas a pagar. A trilha prova depois quem fez, mas não impede.
- **Métrica de baseline**: 0 aprovadores adicionais; 1 ator basta entre o RASCUNHO e a remessa.

### F-security-2: Conta, chave PIX e documento em claro no banco; a trilha não pode ser purgada
- **Classificação**: IN_DELTA
- **Severidade**: P2
- **Tactic violada**: Encrypt Data
- **Localização**: `src/backend/migrations/0066_sispag_destino_manual.sql` (`destino_manual`, `antes`/`depois`)
- **Evidência (objetiva)**:
  ```
  destino_manual JSONB; audit.antes/depois JSONB com valor completo; trigger recusa DELETE/TRUNCATE
  ```
- **Impacto técnico**: Um dump ou leitura SQL expõe conta/chave/documento de fornecedores (inclusive pessoas físicas) sem segunda barreira. O append-only impede apagar, o que conflita com pedido de eliminação (LGPD) e com retenção.
- **Impacto de negócio**: Superfície de vazamento de dado pessoal; falta política de retenção e anonimização.
- **Métrica de baseline**: 2 colunas com dado completo, 0 cifradas na aplicação; 0 rotina de retenção.

### F-security-3: Rotas GET de SISPAG sem `requireRole`
- **Classificação**: PRE_EXISTING (o delta só adicionou `/recursos`, que expõe booleanos)
- **Severidade**: P2
- **Tactic violada**: Limit Access
- **Localização**: `src/backend/routes/sispag.ts:44,55,89,156,171` (painel, retornos, listagens de lote)
- **Evidência (objetiva)**:
  ```
  GET /painel, /retornos, lotes: sem requireRole; só autenticação
  ```
- **Impacto técnico**: Qualquer usuário autenticado lê valores, favorecidos e lotes. O destino digitado sai mascarado (ponto positivo do delta), o restante segue visível. Não confirmei como o claim `role` chega a `admin` em produção (`auth.ts` diz que tokens Supabase trazem só o claim de role do Postgres); validar.
- **Impacto de negócio**: Exposição de dados de pagamento a perfis sem necessidade.
- **Métrica de baseline**: 5 GETs de painel/lote sem role.

### F-security-4: Nenhum alerta em troca de destino nem em falha de autenticação
- **Classificação**: IN_DELTA (troca de destino) e PRE_EXISTING (falha de auth)
- **Severidade**: P2
- **Tactic violada**: Detect Intrusion
- **Localização**: `LotePagamentoService.definirDestinoManualItem`; `src/backend/http/auth.ts`
- **Evidência (objetiva)**:
  ```
  grep de alarme/métrica de destino alterado ou falha de login em src/backend: 0 ocorrências
  ```
- **Impacto técnico**: A trilha é forense, não preventiva. Um insider pode trocar 20 destinos numa hora sem que ninguém seja avisado.
- **Impacto de negócio**: Detecção só depois que o pagamento sai.
- **Métrica de baseline**: 0 alertas; 0 limite de trocas por ator/hora.

### F-security-5: Jobs terminam com `console.error(e)` e podem vazar a senha do Conexos
- **Classificação**: PRE_EXISTING (os 2 probes novos não têm o padrão)
- **Severidade**: P1
- **Tactic violada**: Limit Exposure
- **Localização**: `src/backend/jobs/*.ts`
- **Evidência (objetiva)**:
  ```
  grep -c "console.error(e)" src/backend/jobs/*.ts -> 10 arquivos com hit (caller cita 11)
  ```
- **Impacto técnico**: Um AxiosError cru carrega `config.data` (corpo do login com usuário e senha). Numa falha de login, o log do GitHub Actions ou do Render recebe a credencial.
- **Impacto de negócio**: Quem lê o log obtém a senha do robô Conexos, que executa baixas. Já planejado como follow-up. Sem evidência de vazamento real.
- **Métrica de baseline**: 10 arquivos (11 segundo o caller); alvo 0.

## 5. Cards Kanban

### [security-1] Sanear erro cru nos jobs (nunca logar AxiosError inteiro)

- **Problema**
  > Cerca de 10 jobs terminam com `console.error(e)`; em falha de login do Conexos o AxiosError inclui `config.data` com a senha. Pré-existente.

- **Melhoria Proposta**
  > Criar helper de erro seguro (mensagem + status, sem `config`/`request`) e usar nos jobs; teste que falha em `console.error(e)` cru em `src/backend/jobs`. Tactic: Limit Exposure.

- **Resultado Esperado**
  > 10 arquivos com log cru para 0, com teste de regressão.

- **Tactic alvo**: Limit Exposure
- **Severidade**: P1
- **Esforço estimado**: S
- **Findings relacionados**: F-security-5
- **Métricas de sucesso**:
  - jobs com `console.error(e)`: 10 → 0
- **Risco de não fazer**: A próxima falha de login imprime a senha do robô em log retido.
- **Dependências**: nenhuma

### [security-2] Alertar troca de destino e limitar por ator

- **Problema**
  > A trilha só-inclusão prova quem trocou, mas ninguém é avisado. Um admin pode trocar muitos destinos antes da remessa.

- **Melhoria Proposta**
  > Emitir alerta a cada gravação de `destino_manual` (ator, lote, valor do título, sem o destino), limite de trocas por ator/hora e sinalização no card do lote. Avaliar quatro olhos acima de um valor de corte (revisita ADR-0054 D3). Tactic: Detect Intrusion.

- **Resultado Esperado**
  > Trocas notificadas 0% → 100%; teto configurável por ator.

- **Tactic alvo**: Detect Intrusion
- **Severidade**: P2
- **Esforço estimado**: M
- **Findings relacionados**: F-security-1, F-security-4
- **Métricas de sucesso**:
  - trocas de destino notificadas: 0% → 100%
- **Risco de não fazer**: Fraude descoberta só na conciliação bancária.
- **Dependências**: canal de notificação definido

### [security-3] Definir retenção e cifra de coluna do destino digitado

- **Problema**
  > `destino_manual` e a trilha guardam conta, chave e documento em claro; o trigger impede qualquer purga.

- **Melhoria Proposta**
  > Cifrar em nível de aplicação (chave em env/SSM) ou tokenizar o valor na trilha; definir retenção/anonimização com exceção controlada ao trigger (migration dedicada). Tactic: Encrypt Data.

- **Resultado Esperado**
  > Dado completo só cifrado; retenção documentada.

- **Tactic alvo**: Encrypt Data
- **Severidade**: P2
- **Esforço estimado**: M
- **Findings relacionados**: F-security-2
- **Métricas de sucesso**:
  - colunas sensíveis cifradas: 0/2 → 2/2
- **Risco de não fazer**: Dump do banco expõe contas de fornecedores; pedido de eliminação sem resposta.
- **Dependências**: decisão jurídica de retenção

### [security-4] Exigir role nos GETs de SISPAG e validar o mapeamento do claim admin

- **Problema**
  > 5 GETs de painel/lotes exigem só autenticação, e falta confirmar como o claim de role vira `admin` em produção.

- **Melhoria Proposta**
  > Aplicar `requireRole` de leitura (analista/admin) com teste de rota por perfil; documentar a origem do claim. Tactic: Limit Access.

- **Resultado Esperado**
  > GETs sem role: 5 → 0.

- **Tactic alvo**: Limit Access
- **Severidade**: P2
- **Esforço estimado**: S
- **Findings relacionados**: F-security-3
- **Métricas de sucesso**:
  - GETs sem role: 5 → 0
- **Risco de não fazer**: Qualquer usuário autenticado lê dados de pagamento.
- **Dependências**: definição de perfis (transição de auth em 3 passos)

## 6. Notas do agente

- Escopo `--quick`: sem rede nem npm audit; infra/SSM/IAM/CloudTrail não medíveis (não existe `infra/`). Nenhum P0 encontrado com baseline numérico.
- Pontos fortes do delta: mascaramento na resposta (`LotePagamentoApiView`), Zod `.strict()`, `details` sem valor, trilha imutável por trigger, flags OFF. Por grep não achei log de destino em `DestinoPagamentoResolver`/`LotePagamentoService`; não li `RemessaService` linha a linha.
- Cross-QA: Audit Trail com Fault Tolerance; Limit Exposure (flags) com Availability; Validate Input com Integrability.
