---
qa: Security
qa_slug: security
run_id: 2026-10-05-1645-sispag-excecao-destino
agent: qa-security
generated_at: 2026-10-05T16:50:00-03:00
scope: backend
score: 8
findings_count: 4
cards_count: 4
---

# Security — Regis-Review

## 1. Cenário Geral

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Insider com `sispag:excecao` (ou conta comprometida) | Cadastra uma exceção de destino TED/PIX para desviar um pagamento e tenta aprová-la sozinho (inclusive via bypass de dev ou id ausente) | `ExcecaoDestinoService`, `ExcecaoDestinoRule`, `routes/sispag.ts`, `excecao_destino`, `excecao_destino_audit` (migration 0075) | Produção multi-filial, flag `SISPAG_EXCECAO_DESTINO_ENABLED` ligada | Nega a auto-aprovação no serviço e no CHECK do banco, confere a titularidade ao vivo, mascara o destino em toda saída e grava a trilha só-inclusão | 0 aprovações com `aprovado_por = cadastrado_por`; 0 ocorrências de conta/chave em log/API/erro; 100% dos eventos na trilha; negação visível em log |

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Segredos hardcoded no escopo | 0 | 0 | ✅ | grep `password/secret/token` em arquivos novos de `sispag/`, `jobs/`, migration 0075 |
| Four-eyes na camada de serviço | 1 ponto (`ExcecaoDestinoRule.exigirAprovadorDiferente`, falha fechada: id ausente/`unknown`/vazio) | 1 | ✅ | `ExcecaoDestinoRule.ts:76-88,149-153` |
| Four-eyes no banco | 1 CHECK (`excecao_destino_aprovador_check`) + índice único parcial de 1 `APROVADA` por (pes_cod, tipo) | 1 | ✅ | `0075_sispag_excecao_destino.sql` |
| Rotas de exceção com guard `sispag:excecao` | 5 de 5 (GET lista, POST, aprovar, rejeitar, revogar) + eventos | 100% | ✅ | `routes/sispag.ts:467-590` |
| Rotas de exceção com Zod no boundary | 100% (`.strict()`, uuid em params, `details` sem o valor enviado) | 100% | ✅ | `routes/sispag.ts:420-457` |
| Trigger só-inclusão na trilha | 2 (UPDATE/DELETE + TRUNCATE) | 2 | ✅ | migration 0075 |
| Trigger/guarda na tabela principal `excecao_destino` | 0 | 1 (UPDATE de `aprovado_por` só via fluxo auditado) | ⚠️ | migration 0075 |
| Colunas com conta/chave em claro (tabelas) | 2 locais: `excecao_destino.conta/chave_pix` e `excecao_destino_audit.depois->destino` (evento CADASTRO) | 1 (e cifrado) | ⚠️ | `ExcecaoDestinoRepository.ts:154,380-390` |
| Log de negação (auto-aprovação, permissão, titularidade) | `warn` com ator, alvo, código; sem conta/chave | presente | ✅ | `ExcecaoDestinoService.negacoes` |
| Alarme agregado de negações/falha de autorização | 0 | 1 | ❌ | grep sem alerta além do tipo `sispag-excecao-divergencia` |
| Usuários distintos com `sispag:excecao` em produção | ⚠️ **Não medível localmente** (requer consulta em `app_role_permission`/`user_permission`) | ≥ 2 e ≤ 4 | ⚠️ | Recomenda-se `SELECT count(DISTINCT user_id)` antes de ligar a flag |
| `npm audit` / cobertura | ⚠️ **Não medível localmente** (escopo `_shared-metrics.md`) | crit=0, high=0 | ⚠️ | CI já audita prod deps (bb160a5) |

## 3. Tactics — Cobertura

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Detect Intrusion | Log `warn` de cada negação; alerta de divergência com cadastro; sem correlação/alarme | ⚠️ parcial | `ExcecaoDestinoService.ts` `negacoes`, `Alerta.ts` |
| Detect Service Denial | Fora do escopo da feature | N/A | Rate limit é transversal |
| Verify Message Integrity | Titularidade relida ao vivo no cadastro e na aprovação (TOCTOU coberto); `versao` + `WHERE estado = $de` (lock otimista) | ✅ presente | `aprovar`, `transition` |
| Detect Message Delay | N/A: sem mensageria nesta feature | N/A | — |
| Identify Actors | Ator = `req.user.sub` autenticado, nunca do body; `ator(req)` cai em `unknown` e a regra falha fechada | ✅ presente | `routes/sispag.ts:112,420` |
| Authenticate Actors | JWT Supabase; `DEV_AUTH_BYPASS` só local/dev (boot derruba fora disso), ator fixo `dev-bypass` | ✅ presente | `http/acesso.ts:64-128` |
| Authorize Actors | `sispag:excecao` única, checada na rota e de novo no serviço; separação de funções por regra aprovador ≠ cadastrante; Analista sem a permissão | ✅ presente | `Rule.exigirPermissao`, migration 0075 |
| Limit Access | Rejeitar/revogar permitidos ao cadastrante (reduzem risco); cadastrar/aprovar exigem flag; destino completo nunca na API | ✅ presente | `resumo`, `eventos` (`depois - 'destino'`) |
| Limit Exposure | Máscara em resposta, log, erro (`redactErrorMessage`), `details` Zod sem valor | ✅ presente | `routes/sispag.ts:420-426` |
| Encrypt Data | Sem cifra de coluna para conta/chave; confia em TLS + criptografia do volume Supabase | ⚠️ parcial | F-security-2 |
| Separate Entities | Exceção separada do cadastro `cmn025` (nunca escreve nele); trilha em tabela própria | ✅ presente | migration 0075 |
| Change Default Settings | Flag nasce desligada; Q4 não converte `destino_manual` em APROVADA | ✅ presente | migration 0075 §5 |
| Validate Input | Zod `.strict()` + `DestinoManualValidator`; PIX só CPF/CNPJ por CHECK e regra; titular = documento do favorecido | ✅ presente | `excecao_destino_campos_check` |
| Revoke Access | `revogar` por qualquer titular da permissão; `SUBSTITUIDA` automática por varredura | ✅ presente | `ExcecaoSubstituicaoService` |
| Lock Computer | Sem bloqueio de conta após N negações de auto-aprovação | ❌ ausente | F-security-3 |
| Inform Actors | Alerta `sispag-excecao-divergencia`; sem notificação ao terceiro quando uma exceção é cadastrada/aprovada | ⚠️ parcial | F-security-3 |
| Restore | Sem apagamento: 0075 é cria-apenas, `destino_manual` fica inerte | ✅ presente | migration 0075 |
| Audit Trail | Só-inclusão (trigger + TRUNCATE), 7 eventos incl. USO e DIVERGENCIA, ator em todos | ✅ presente | `excecao_destino_audit` |

## 4. Findings

### F-security-1: Tabela principal sem guarda contra UPDATE direto de aprovador/estado

- **Severidade**: P2
- **Tactic violada**: Audit Trail / Authorize Actors (defesa em profundidade)
- **Localização**: `src/backend/migrations/0075_sispag_excecao_destino.sql` (tabela `excecao_destino`)
- **Evidência (objetiva)**:
  ```
  excecao_destino_aprovador_check: aprovado_por IS NULL OR aprovado_por <> cadastrado_por
  triggers em excecao_destino: 0 (só excecao_destino_audit tem trigger)
  ```
- **Impacto técnico**: o CHECK impede igualar aprovador e cadastrante, mas quem tem a credencial de escrita do banco pode fazer `UPDATE ... SET estado='APROVADA', aprovado_por='x'` ou trocar `conta` de uma exceção já aprovada sem deixar linha na trilha. A trilha só-inclusão protege a si mesma, não a tabela que audita.
- **Impacto de negócio**: um insider com acesso ao `DATABASE_URL` (já presente no Render e nos crons) redireciona pagamento do favorecido sem rastro e sem segunda pessoa.
- **Métrica de baseline**: 0 triggers na tabela `excecao_destino`; 1 credencial de banco com escrita total.

### F-security-2: Conta e chave PIX em claro, inclusive dentro da trilha imutável

- **Severidade**: P2
- **Tactic violada**: Encrypt Data
- **Localização**: `ExcecaoDestinoRepository.ts:154` (`depois: { estado, destino }`), colunas `conta`, `chave_pix`, `titular_documento`
- **Evidência (objetiva)**:
  ```
  audit CADASTRO.depois = { estado: 'PENDENTE', destino: <conta/chave/titular completos> }
  API remove com (depois - 'destino'), mas o dado persiste na linha
  ```
- **Impacto técnico**: a API é segura; o banco não. Como a trilha é só-inclusão (UPDATE e DELETE recusados), o valor não pode ser anonimizado depois. Um dump ou backup expõe 2 locais de dado financeiro de terceiro.
- **Impacto de negócio**: pedido de eliminação LGPD de dado do favorecido não pode ser atendido na trilha; vazamento de backup expõe contas e CPF/CNPJ de fornecedores.
- **Métrica de baseline**: 2 locais com valor completo; 0 colunas cifradas.

### F-security-3: Negação de auto-aprovação só vira log, sem alarme nem notificação

- **Severidade**: P2
- **Tactic violada**: Detect Intrusion / Inform Actors / Lock Computer
- **Localização**: `ExcecaoDestinoService.negacoes`; `Alerta.ts`
- **Evidência (objetiva)**:
  ```
  logService.warn('exceção de destino: aprovar negado', {acao, ator, alvo, codigo})
  alertas novos: 1 (sispag-excecao-divergencia); alertas por EXCECAO_APROVACAO_PROPRIO_CADASTRANTE: 0
  ```
- **Impacto técnico**: a tentativa de auto-aprovação é o sinal mais forte de fraude interna e fica só em log do Render, sem agregação. Também não há aviso a um terceiro (gestor) quando uma exceção é cadastrada ou aprovada.
- **Impacto de negócio**: o conluio ou a tentativa só é descoberta se alguém ler o log; a janela de detecção é indefinida.
- **Métrica de baseline**: 0 alarmes sobre negações; 0 notificações ao cadastrar/aprovar.

### F-security-4: Risco residual de conluio entre dois titulares da permissão

- **Severidade**: P2
- **Tactic violada**: Authorize Actors / Separate Entities
- **Localização**: migration 0075 (Administrador recebe `sispag:excecao`); `ExcecaoDestinoRule.exigirAprovadorDiferente`
- **Evidência (objetiva)**:
  ```
  four-eyes = identidades distintas (sub normalizado); sem limite de valor, sem teto por favorecido,
  sem 3ª pessoa; a migration concede a permissão a todo Administrador
  ```
- **Impacto técnico**: dois usuários que conspiram (ou um dono de duas contas com `sub` diferentes) cumprem a regra. O titularity check reduz o dano (destino tem de ser do titular CPF/CNPJ do favorecido), mas não cobre favorecido cujo cadastro `cmn025` já foi adulterado. Com 1 só titular, nada se aprova (falha segura).
- **Impacto de negócio**: sem controle compensatório, o teto de perda é o valor total de um lote.
- **Métrica de baseline**: nº de titulares em produção não medível aqui; mínimo exigido 2.

## 5. Cards Kanban

### [security-1] Impedir alteração direta de `excecao_destino` fora do fluxo auditado

- **Problema**
  > A tabela principal não tem trigger; um UPDATE direto troca aprovador, estado ou conta sem linha na trilha (0 triggers, 1 credencial de escrita total).
- **Melhoria Proposta**
  > Trigger BEFORE UPDATE em `excecao_destino` que recusa mudança em `conta`, `chave_pix`, `agencia`, `titular_documento`, `cadastrado_por` e exige `versao` incrementada; opcionalmente trigger AFTER que insere a linha de audit. Papel de banco da aplicação sem DELETE.
- **Resultado Esperado**
  > UPDATE ad hoc de destino ou de aprovador recusado ou auditado: 0 → 100% das mutações na trilha.
- **Tactic alvo**: Audit Trail
- **Severidade**: P2
- **Esforço estimado**: S
- **Findings relacionados**: F-security-1
- **Métricas de sucesso**:
  - Triggers em `excecao_destino`: 0 → 1
  - Mutações sem linha de audit: não medido → 0
- **Risco de não fazer**: fraude por insider com acesso ao banco sem rastro.
- **Dependências**: nenhuma

### [security-2] Cifrar conta/chave PIX em repouso e tirar o destino completo da trilha

- **Problema**
  > Conta, chave PIX e documento do titular ficam em claro em 2 locais, e a trilha imutável impede anonimização.
- **Melhoria Proposta**
  > Gravar na trilha só a máscara e o hash (HMAC) do destino em `depois`; cifrar colunas `conta`/`chave_pix` com chave em SSM (pgcrypto ou cifra na aplicação), mantendo o valor completo só para o envio ao fin015.
- **Resultado Esperado**
  > Locais com valor em claro: 2 → 0; trilha compatível com pedido LGPD.
- **Tactic alvo**: Encrypt Data
- **Severidade**: P2
- **Esforço estimado**: M
- **Findings relacionados**: F-security-2
- **Métricas de sucesso**:
  - Locais com conta/chave em claro: 2 → 0
- **Risco de não fazer**: vazamento de backup expõe dados bancários de fornecedores; trilha não anonimizável.
- **Dependências**: decisão sobre gestão de chave (SSM) e migração dos registros existentes.

### [security-3] Alarmar e notificar tentativas de auto-aprovação e aprovações de exceção

- **Problema**
  > A negação de auto-aprovação é só `warn` em log; ninguém é avisado de cadastro ou aprovação de exceção.
- **Melhoria Proposta**
  > Novo tipo de alerta (`sispag-excecao-negada`) disparado a partir de `negacoes` quando o código for `EXCECAO_APROVACAO_PROPRIO_CADASTRANTE` (limiar: 1), e notificação por e-mail ao gestor em cada aprovação. Reaproveitar o painel de operação.
- **Resultado Esperado**
  > Alarmes de tentativa de fraude interna: 0 → 1 tipo; tempo de detecção: indefinido → < 1 dia útil.
- **Tactic alvo**: Detect Intrusion / Inform Actors
- **Severidade**: P2
- **Esforço estimado**: S
- **Findings relacionados**: F-security-3
- **Métricas de sucesso**:
  - Alertas sobre negação: 0 → 1 tipo
- **Risco de não fazer**: tentativa de fraude passa despercebida nos logs do Render.
- **Dependências**: `Alerta.ts` e o CHECK de `alerta.tipo` (nova migration).

### [security-4] Controle compensatório do conluio e conferência da concessão de `sispag:excecao`

- **Problema**
  > Four-eyes é satisfeito por duas contas conluiadas; a migration dá a permissão a todo Administrador sem limite.
- **Melhoria Proposta**
  > Antes de ligar a flag: listar os titulares (`SELECT count(DISTINCT user_id)`), restringir a 2–4 pessoas de funções distintas; relatório semanal das exceções aprovadas (cadastrante, aprovador, valor pago via exceção) para revisão do gestor; avaliar teto de valor por pagamento via exceção acima do qual exige 3ª aprovação.
- **Resultado Esperado**
  > Titulares conhecidos e conferidos: não medido → 2–4; revisão semanal de 100% das exceções aprovadas.
- **Tactic alvo**: Authorize Actors
- **Severidade**: P2
- **Esforço estimado**: S
- **Findings relacionados**: F-security-4
- **Métricas de sucesso**:
  - Titulares com `sispag:excecao`: não medido → 2–4
  - Exceções aprovadas revistas: 0% → 100%
- **Risco de não fazer**: conluio entre dois administradores desvia pagamento sem barreira adicional.
- **Dependências**: decisão do Yuri/Columbia sobre o teto e o relatório.

## 6. Notas do agente

- Sem P0: nenhum segredo, SQL interpolado ou endpoint sem guard encontrado no escopo; self-approval via bypass fica barrada (ator único `dev-bypass`, regra e CHECK exigem pessoa distinta).
- Não verifiquei teste a teste o mascaramento em todos os erros; confiei em `redactErrorMessage` e nos testes citados em `_shared-metrics.md`.
- Cross-QA: Audit Trail (F-security-1) com Fault Tolerance; Validate Input (titularidade) com Integrability; flag desligada por padrão ajuda Deployability (rollback).
