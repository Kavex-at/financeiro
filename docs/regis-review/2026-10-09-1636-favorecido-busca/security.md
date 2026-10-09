---
qa: Security
qa_slug: security
run_id: 2026-10-09-1636-favorecido-busca
agent: qa-security
generated_at: 2026-10-09T16:50:00-03:00
scope: all
score: 8.5
findings_count: 3
cards_count: 2
---

# Security — Regis-Review

## 1. Cenário Geral (Bass General Scenario)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Usuário autenticado com `sispag:executar` (ou sessão roubada dele) | Varre `POST /sispag/favorecidos-autorizados/busca` com termos/CPF/CNPJ em rajada para enumerar o cadastro de pessoas do Conexos | `PayeeSearchService`, `ConexosSispagClient.buscarPessoas`, rota `routes/sispag.ts`, sessão Conexos | Produção, multi-filial, teto de sessões Conexos | Exige permissão, valida o body com Zod, devolve só documento mascarado, não grava nem loga o termo, limita a taxa | 0 CPF/CNPJ/conta/chave PIX completos na resposta e nos logs; leituras Conexos por minuto por IP ≤ 200 (limite global) |

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Segredos hardcoded no delta | 0 (nenhum literal de credencial nos arquivos alterados; sonda lê env) | 0 | ✅ | `git diff origin/main` + leitura de `probe-cmn025-busca-hml.ts` |
| `.env` versionado | `src/backend/.env` é cópia local não rastreada (não lido) | 0 no git | ⚠️ confirmar que está no `.gitignore` (não aparece em `git status`) | `git status` do contexto |
| Rotas novas com autorização | 2/2 (`exigirPermissao(SISPAG_EXECUTAR)`) | 100% | ✅ | `src/backend/routes/sispag.ts` (diff) |
| Rotas novas com Zod no boundary | 2/2 (`BuscaFavorecidoSchema` max 100; `DestinoAtualQuerySchema` enum TED/PIX) | 100% | ✅ | `src/backend/http/schemas.ts` |
| SQL novo / interpolado | 0 (a busca vai ao ERP via `filterList`, sem SQL local) | 0 | ✅ | `ConexosSispagClient.buscarPessoas` |
| Documento completo na resposta HTTP | 0 (`MaskDestino.documento`; `situacao` e nomes apenas) | 0 | ✅ | `PayeeSearchService.ts` |
| CPF/CNPJ do termo em URL/log | 0 (POST com body; `req.originalUrl` não carrega o termo); `destino-atual` leva só `pesCod`+modalidade | 0 | ✅ | `errorMiddleware.ts:24`, `acesso.ts:162` |
| Chamadas `logService`/`console` do termo no serviço novo | 0 | 0 | ✅ | grep em `PayeeSearchService.ts` |
| `Cache-Control: no-store` nas respostas | 2/2 | 2/2 | ✅ | `routes/sispag.ts` (diff) |
| `dangerouslySetInnerHTML`/`localStorage` no diálogo | 0 | 0 | ✅ | grep em `SolicitarAutorizacaoDialog.tsx` |
| Sonda: impressão de documento | 0 (imprime nomes e contagens; `pdcDocFederal` só usado para montar consultas, não impresso) | 0 | ✅ | `probe-cmn025-busca-hml.ts:52-95` |
| Limite de taxa específico da busca | 0 (herda `globalLimiter` 100/min/IP; até 2 leituras Conexos por busca) | específico ≤ 30/min/usuário | ⚠️ | `buildApp.ts:59`, `rateLimit.ts:113` |
| `npm audit` | ⚠️ Não medível neste run (delta sem dependência nova; `package.json` intocado) | critical=0, high=0 | ⚠️ | diff --stat |
| IAM/CloudTrail/GuardDuty/API Gateway | ⚠️ Não medível: não existe `infra/` (Render/Vercel) | — | ⚠️ | CLAUDE.md |

## 3. Tactics — Cobertura

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Detect Intrusion | Sem alarme de enumeração/varredura da busca; sem GuardDuty (sem AWS) | ❌ ausente | — |
| Detect Service Denial | Só `globalLimiter` por IP | ⚠️ parcial | `rateLimit.ts:113` |
| Verify Message Integrity | N/A: leitura sem escrita; sem HMAC (a prévia explicitamente sem impressão) | N/A | `AuthorizedPayeeService.destinoAtual` |
| Detect Message Delay | N/A: leitura interativa, sem mensagem assíncrona | N/A | — |
| Identify Actors | Usuário autenticado resolvido por `req.acesso` | ✅ presente | `acesso.ts` |
| Authenticate Actors | Middleware de auth do Express antecede o router (Supabase Auth) | ✅ presente | `http/auth.ts` |
| Authorize Actors | `exigirPermissao(SISPAG_EXECUTAR)` nas duas rotas; revelar o destino completo segue exigindo `sispag:autorizar_favorecido` | ✅ presente | `routes/sispag.ts` diff; `routePermissions.test.ts` +7 |
| Limit Access | Filial fixa (`sispagCadastroFilCod`), sem escolha do cliente; 20 linhas por leitura | ✅ presente | `PayeeSearchService.ts`, `BUSCA_PESSOAS_LIMITE` |
| Limit Exposure | Documento mascarado; termo em POST; `no-store`; curingas `%`/`_` neutralizados | ✅ presente | `buscarPessoas`, rota |
| Encrypt Data | TLS na borda (Render/Vercel); nada persistido pelo delta | ✅ presente | — |
| Separate Entities | Read-only: nenhuma escrita local nem no ERP; sem tenant (conta única hoje) | ✅ presente | `PayeeSearchService.ts` |
| Change Default Settings | Sonda recusa base não-HML | ✅ presente | `probe-cmn025-busca-hml.ts:18` |
| Validate Input | Zod (`termo` 1–100, enum de modalidade); normalização do termo no cliente; mínimo de 3 letras; resultado do ERP validado por `pessoaRowSchema` | ✅ presente | `schemas.ts`, `ConexosSispagClient.ts` |
| Revoke Access | Herdado (revogação de permissão no banco, sem mudança) | ✅ presente | PR #93 |
| Lock Computer | Sem bloqueio por abuso na busca | ❌ ausente | — |
| Inform Actors | Sem aviso ao admin sobre uso anômalo da busca | ❌ ausente | — |
| Restore | N/A: delta sem estado | N/A | — |
| Audit Trail | Busca e prévia não gravam trilha (leitura mascarada); a revelação completa continua auditada | ⚠️ parcial | `AuthorizedPayeeService` (revelar) |

## 4. Findings

### F-security-1: Busca sem limite de taxa próprio expõe enumeração do cadastro e consome o teto de sessões Conexos

- **Severidade**: P2
- **Tactic violada**: Detect Service Denial / Limit Access
- **Localização**: `src/backend/routes/sispag.ts` (rota `/favorecidos-autorizados/busca`), `src/backend/http/buildApp.ts:59`
- **Evidência (objetiva)**:
  ```
  globalLimiter: limit 100 / 60s por IP; cada busca = 1 a 3 leituras cmn025
  => até ~300 leituras Conexos/min por IP; heavyRouteLimiter (10/min) não se aplica
  ```
- **Impacto técnico**: um usuário com `sispag:executar` ou uma sessão roubada varre nomes e CPF/CNPJ e obtém, por resposta, nome, fantasia, documento mascarado, situação e estado de autorização; a rajada ainda disputa o teto de sessões Conexos com os crons de carteira SISPAG.
- **Impacto de negócio**: vazamento lento da lista de fornecedores da Columbia (dado comercial) e risco de degradar a carteira SISPAG; sem dinheiro movido (rota read-only).
- **Métrica de baseline**: 0 limitadores específicos; 100 req/min/IP.

### F-security-2: Uso da busca/prévia não deixa rastro auditável nem sinal de abuso

- **Severidade**: P2
- **Tactic violada**: Audit Trail / Detect Intrusion
- **Localização**: `PayeeSearchService.buscar`, `AuthorizedPayeeService.destinoAtual`
- **Evidência (objetiva)**:
  ```
  buscar() e destinoAtual(): 0 chamadas a LogService/trilha (o termo não pode ser logado, I10h),
  mas também não há contador "usuário X buscou N vezes" nem log do pesCod consultado na prévia.
  ```
- **Impacto técnico**: não dá para reconstruir quem consultou o destino mascarado de qual favorecido (a prévia usa `pesCod`, que não é dado sensível) nem detectar varredura.
- **Impacto de negócio**: em investigação de fraude de favorecido (troca de conta), falta a ponta "quem olhou o cadastro antes do pedido".
- **Métrica de baseline**: 0 eventos de auditoria nas 2 rotas novas.

### F-security-3: Documento mascarado ainda identifica o favorecido junto de nome e situação (aceito, sem ação)

- **Severidade**: P3
- **Tactic violada**: Limit Exposure
- **Localização**: `PayeeSearchService.ts` (`documentoMascarado`)
- **Evidência (objetiva)**:
  ```
  Resposta: pesCod, nome, nomeFantasia, documentoMascarado, situacao, autorizacao por modalidade
  ```
- **Impacto técnico**: coerente com I10h/I14j (nenhum valor completo sai). O resíduo é dado cadastral de PJ, já visível a quem tem `sispag:executar` na tela de candidatos.
- **Impacto de negócio**: baixo; registrado só para o consolidador. Sem card (justificativa: nenhuma ação proporcional).
- **Métrica de baseline**: 0 valores completos de CPF/CNPJ/conta/PIX na resposta.

## 5. Cards Kanban

### [security-1] Limitar a taxa da busca de favorecido por usuário

- **Problema**
  > A busca herda só o `globalLimiter` (100/min/IP) e cada requisição faz até 3 leituras no `cmn025`. Uma varredura enumera o cadastro e disputa o teto de sessões Conexos com os crons.

- **Melhoria Proposta**
  > Aplicar um limiter dedicado em `POST /favorecidos-autorizados/busca` e em `destino-atual` (por usuário autenticado, ex.: 30/min), reaproveitando `rateLimit.ts`. Tactic Detect Service Denial.

- **Resultado Esperado**
  > Rajada acima de 30 buscas/min por usuário recebe 429; leituras Conexos da busca ≤ ~90/min por usuário (hoje até ~300/min por IP).

- **Tactic alvo**: Detect Service Denial
- **Severidade**: P2
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-security-1
- **Métricas de sucesso**:
  - Limitador específico na busca: 0 → 1
  - Teto de leituras da busca por usuário/min: ~300 → ≤ 90
- **Risco de não fazer**: uma conta comprometida enumera os fornecedores e, no pior caso, estoura o teto de sessões e congela a carteira SISPAG, como no incidente de 23/09.
- **Dependências**: nenhuma

### [security-2] Registrar auditoria mínima da consulta de destino e contagem de buscas

- **Problema**
  > Nem a busca nem a prévia deixam rastro de quem consultou o quê; sem isso não há detecção de varredura nem reconstrução em caso de fraude de conta.

- **Melhoria Proposta**
  > Gravar na trilha existente um evento `destino_consultado` (usuário, `pesCod`, modalidade, resultado; nunca o termo nem o destino) e um log de contagem de buscas por usuário (só número de resultados). Tactic Audit Trail, alinhado ao I10h.

- **Resultado Esperado**
  > Eventos de auditoria nas rotas novas: 0 → 100% das prévias; consulta "quem olhou o pesCod X" respondível.

- **Tactic alvo**: Audit Trail
- **Severidade**: P2
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-security-2
- **Métricas de sucesso**:
  - Prévias com registro: 0% → 100%
  - Ocorrências do termo/documento nos logs: 0 → 0 (manter)
- **Risco de não fazer**: investigação de troca de conta de favorecido fica sem a ponta da consulta.
- **Dependências**: pode seguir junto de security-1

## 6. Notas do agente

- Escopo: delta da branch; não li nem imprimi `src/backend/.env`; infra/IAM/CloudTrail não medíveis (sem `infra/`).
- Nenhum P0/P1: invariantes I10h/I14j/I14l se sustentam no delta (POST, máscara, `no-store`, sem log do termo, sonda sem impressão de documento).
- Cross-QA: Detect Service Denial/teto de sessões Conexos liga com Availability e Performance; Audit Trail com Fault Tolerance; Validate Input com Integrability.
- `npm audit` não rodado: delta sem mudança de dependências.
