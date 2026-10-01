---
qa: Security
qa_slug: security
run_id: 2026-10-01-1909-perfil-usuario
agent: qa-security
generated_at: 2026-10-01T19:30:00-03:00
scope: all
score: 8.5
findings_count: 4
cards_count: 3
---

# Security — Regis-Review

## 1. Cenário Geral (Bass General Scenario)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Usuário autenticado malicioso (ou token roubado) | Tenta ler o perfil/histórico de OUTRO usuário via `userId`/`username` na query, cursor forjado ou filtros | `GET /me`, `/me/atividade`, `/me/historico` (Express, Supabase JWT + `resolverAcesso`) | Produção Render, multi-usuário numa mesma base Postgres | Alvo vem só de `req.acesso.userId` + `req.user.sub`; parâmetro desconhecido recusado com 400; cursor inválido recusado; SQL parametrizado | 0 vazamentos cross-user em 11 ramos UNION; 0 colunas de credencial; 0 SQL interpolado; `no-store` em 3/3 rotas |

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Rotas novas com guard explícito (`somenteAutenticado`) | 3/3 (`GET /me`, `/me/atividade`, `/me/historico`) | 100% | ✅ | `src/backend/routes/me.ts:105,123,153`; `routePermissions.test.ts:156` |
| Schemas de query com `.strict()` | 3/3 (`perfil`, `atividade`, `historico`) | 100% | ✅ | `PerfilQuerySchemas.ts:248,256,271` |
| Rotas com `:id` / alvo vindo do cliente | 0 | 0 | ✅ | `me.ts:70-77` (`alvoDaSessao`) |
| Ramos do UNION com filtro de ator dentro do ramo | 11/11 (`executado_por`/`criado_por`/`removido_por`/`finalizado_por`/`alterado_por`/`reconhecido_por`; acesso: `ator = $username OR alvo_user_id = $userId`) | 11/11 | ✅ | `AtividadeUsuarioRepository.ts:46-184` |
| SQL com interpolação de entrada | 0 (2 constantes estáticas + `$nome`) | 0 | ✅ | `AtividadeUsuarioRepository.ts:28,212`; `PerfilRepository.ts:13,21` |
| Colunas de credencial selecionadas | 0 (`password_hash`, `conexos_password_enc`, `auth_user_id` fora; sem `u.*`) | 0 | ✅ | `PerfilRepository.ts:14-18` |
| Rotas com `Cache-Control: no-store` | 3/3 | 3/3 | ✅ | `me.ts:97` (via `responderLeitura`) |
| Hardcoded secrets / `.env` / tfstate no delta | 0 | 0 | ✅ | grep no delta; `docs/perfil-usuario/` só tem `explain.md` e `equivalencia-v1.txt` |
| `dangerouslySetInnerHTML`/`innerHTML` no delta | 0 | 0 | ✅ | grep `app/perfil`, `components/auth` |
| `localStorage` no delta | 1 uso: preferência de período, chave por username, sem token/PII sensível, validada por regex ao ler | só não-sensível | ✅ | `app/perfil/periodo.ts:31,49` |
| Logs com PII no `PerfilService`/repos | 0 chamadas de log | 0 | ✅ | grep de log em `PerfilService.ts` vazio |
| Edição de permissão na `/perfil` | 0 (cliente só `GET`; `EditarAcessoDialog.tsx` apenas refatorado para `MODULOS`) | 0 | ✅ | `lib/api/perfil.ts:141` |
| `npm audit` frontend (árvore inteira) | 1 critical, 7 high, 1 moderate, 1 low | crit=0, high=0 | ❌ (fora do delta) | `npm audit --json`; crítico = `next` (direto, pré-existente) |
| `@radix-ui/react-dropdown-menu` (dep nova) | 0 advisories | 0 | ✅ | `npm audit` (nenhuma entrada radix) |
| Rate limiting em `/me/historico` | ausente | presente (P3) | ⚠️ | `me.ts` (sem limiter) |
| Alarme de falha de autenticação / CloudTrail / GuardDuty | ⚠️ **Não medível localmente**: sem `infra/`. Requer logs do Render/Supabase. | — | ⚠️ | — |

## 3. Tactics — Cobertura

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Detect Intrusion | Sem alerta/métrica para 400 repetido (cursor adulterado, parâmetro proibido) | ⚠️ parcial | `me.ts:97-101` |
| Detect Service Denial | Sem rate limit; UNION de 11 ramos ~0,5 ms com índices da 0072 | ⚠️ parcial | `0072_idx_atividade_usuario.sql`; `docs/perfil-usuario/explain.md` |
| Verify Message Integrity | Cursor opaco sem HMAC, mas só carrega posição e é revalidado por Zod; não amplia escopo | ⚠️ parcial (suficiente) | `HistoricoCursor.ts:193-226` |
| Detect Message Delay | N/A — leitura síncrona, sem mensageria | N/A | — |
| Identify Actors | Identidade só de `req.user.sub` + `req.acesso.userId` | ✅ presente | `me.ts:70-77` |
| Authenticate Actors | Supabase JWT no pipeline (montado antes do router) | ✅ presente | `me.ts:19-21` |
| Authorize Actors | `somenteAutenticado()` explícito + tabela de guards testada | ✅ presente | `routePermissions.test.ts:153-156` |
| Limit Access | Ator filtrado em cada ramo; cursor só refina o conjunto já filtrado (WHERE externo) | ✅ presente | `AtividadeUsuarioRepository.ts:192-199` |
| Limit Exposure | Colunas listadas uma a uma; `detalhe` com `.strip()` Zod; `dry_run=false` | ✅ presente | `PerfilRepository.ts:14`; `AtividadeUsuarioRepository.ts:318-331` |
| Encrypt Data | TLS fora do delta; `no-store` evita cache da resposta | ✅ presente | `me.ts:97` |
| Separate Entities | Isolamento por conta AWS é alvo (N/A hoje); separação por usuário via ator em cada ramo | ⚠️ parcial | — |
| Change Default Settings | N/A no delta | N/A | — |
| Validate Input | Zod `.strict()` na query; enums fechados; datas `AAAA-MM-DD`; cursor ≤512, base64url, JSON `.strict()`, `em` por regex, `fonte` enum | ✅ presente | `PerfilQuerySchemas.ts`; `HistoricoCursor.ts` |
| Revoke Access | Fora do delta; `/perfil` não edita permissão | N/A | — |
| Lock Computer | N/A no delta | N/A | — |
| Inform Actors | 400 em pt-BR sem eco de dados internos | ✅ presente | `me.ts:80-82` |
| Restore | Rollback da 0072 (só índices) testado | ✅ presente | `rollbacks/0072_idx_atividade_usuario.rollback.sql`; `rollbacks.test.ts` |
| Audit Trail | Leitura do próprio histórico não é auditada (aceitável); o read model deriva das trilhas existentes | ⚠️ parcial | `AtividadeUsuarioRepository.ts:28` |

## 4. Findings

Nenhum P0 no delta. Nenhum P1 com baseline defensável.

### F-security-1: Dependência `next` com advisory crítico na árvore do frontend (pré-existente)

- **Severidade**: P2 (rebaixada: não é introduzida pelo delta, que só soma `@radix-ui/react-dropdown-menu`, 0 advisories)
- **Tactic violada**: Limit Exposure
- **Localização**: `src/frontend/package.json` (`next`), `package-lock.json`
- **Evidência (objetiva)**:
  ```
  npm audit (frontend): critical 1, high 7, moderate 1, low 1 (total 10)
  critical: next (direto) | high: brace-expansion, browserslist, js-yaml, nanoid, postcss, sharp, ws
  ```
- **Impacto técnico**: o frontend serve `/perfil`, que expõe username, e-mail, papel e histórico financeiro do usuário; um advisory crítico no runtime Next é superfície para todas as páginas.
- **Impacto de negócio**: dados de pagamento e atividade de analistas atrás de um framework com CVE crítico conhecido.
- **Métrica de baseline**: 1 critical / 7 high (alvo 0/0).

### F-security-2: Saída do job de validação imprime planos EXPLAIN com usernames reais; redação é manual

- **Severidade**: P3
- **Tactic violada**: Limit Exposure
- **Localização**: `src/backend/jobs/validate-perfil-usuario-v1.ts:431-434`; `docs/perfil-usuario/explain.md:5`
- **Evidência (objetiva)**:
  ```
  console.log(leitor.planos[0] ...)   // plano contém executado_por = '<username real>'
  explain.md: "Os usernames foram trocados por '<ator>'"  (troca manual, sem código)
  ```
- **Impacto técnico**: quem roda o job vê usernames de produção no terminal/CI; o doc commitado depende de troca manual. Verificado: o doc commitado só tem `<ator>` e 0 connection string. A connection string é lida só do `.env` e nunca impressa (`:46-49`); erros passam por `redactErrorMessage` (`:461`); transação `READ ONLY` + `ROLLBACK` (`:283-290,437`).
- **Impacto de negócio**: risco baixo de vazar identificadores de analistas em log de CI.
- **Métrica de baseline**: 1 ponto de impressão sem redação programática; 0 segredos vazados.

### F-security-3: `/me/historico` sem rate limit e sem métrica para 400 repetido

- **Severidade**: P3
- **Tactic violada**: Detect Service Denial
- **Localização**: `src/backend/routes/me.ts:152-176`
- **Evidência (objetiva)**:
  ```
  UNION ALL de 11 ramos + subselects SUM (lote_finalizado, remessa_gerada), 25 por página
  ~0,5 ms com índice (explain.md); sem limiter na rota
  ```
- **Impacto técnico**: um token válido pode paginar em loop; custo baixo e limitado ao próprio ator, então o risco é de ruído.
- **Impacto de negócio**: marginal; defesa em profundidade.
- **Métrica de baseline**: 0 limiters; ~0,5 ms/consulta.

### F-security-4: Ramo `acesso_evento` expõe username da contraparte (intencional); cursor não é assinado

- **Severidade**: P3
- **Tactic violada**: Verify Message Integrity
- **Localização**: `AtividadeUsuarioRepository.ts:174-186`; `HistoricoCursor.ts:193-226`
- **Evidência (objetiva)**:
  ```
  'outroUsername', CASE WHEN e.ator = $username THEN t.username ELSE e.ator END
  WHERE (e.ator = $username OR e.alvo_user_id = $userId)
  ```
- **Impacto técnico**: o usuário só vê eventos em que é ator ou alvo, e só o username do outro lado (sem e-mail/id). Cursor forjado só desloca a posição dentro do conjunto já filtrado por ator, e `$cursorEm/$cursorFonte/$cursorId` viajam como parâmetros: 0 caminhos de widening ou injeção.
- **Impacto de negócio**: nenhum vazamento cross-user; decisão consciente registrada.
- **Métrica de baseline**: 0 vazamentos nos 11 ramos; 350 comparações com 0 divergências (_shared-metrics.md).

## 5. Cards Kanban

### [security-1] Atualizar `next` e dependências high do frontend

- **Problema**
  > `npm audit` do frontend marca 1 critical (`next`) e 7 high. A branch não os introduz, mas `/perfil` aumenta a exposição de dados do usuário no mesmo runtime.

- **Melhoria Proposta**
  > Subir `next` para a versão corrigida e rodar `npm audit fix` nas transitivas (postcss, ws, sharp etc.). Adicionar `npm audit --audit-level=high` ao CI do frontend. Tactic: Limit Exposure.

- **Resultado Esperado**
  > `npm audit`: critical 1 → 0, high 7 → 0.

- **Tactic alvo**: Limit Exposure
- **Severidade**: P2
- **Esforço estimado**: S
- **Findings relacionados**: F-security-1
- **Métricas de sucesso**:
  - critical: 1 → 0
  - high: 7 → 0
- **Risco de não fazer**: CVE crítico do framework segue exposto em produção por meses.
- **Dependências**: nenhuma (verificar changelog do Next para breaking changes)

### [security-2] Redigir usernames na saída do job de validação

- **Problema**
  > `validate-perfil-usuario-v1.ts` imprime planos EXPLAIN com usernames reais; a troca por `<ator>` no doc commitado é manual.

- **Melhoria Proposta**
  > Substituir programaticamente `atores[]` por `<ator>` antes do `console.log` dos planos (`:431-434`) e fixar um teste em `validatePerfilUsuarioIsolation.test.ts`. Tactic: Limit Exposure.

- **Resultado Esperado**
  > Pontos de impressão sem redação: 1 → 0.

- **Tactic alvo**: Limit Exposure
- **Severidade**: P3
- **Esforço estimado**: S
- **Findings relacionados**: F-security-2
- **Métricas de sucesso**:
  - impressões de username real: 1 → 0
- **Risco de não fazer**: um commit futuro de `explain.md` pode levar identificadores reais.
- **Dependências**: nenhuma

### [security-3] Rate limit leve e métrica de 400 em `/me/*`

- **Problema**
  > As rotas `/me/*` não têm limiter e os 400 por parâmetro/cursor inválido não geram métrica; sondagem repetida passa despercebida.

- **Melhoria Proposta**
  > Limiter por `userId` (ex.: 60 req/min) em `/me/historico` e contador de `PerfilQueryInvalidError`/400 para detecção. Opcional: HMAC no cursor. Tactics: Detect Service Denial, Detect Intrusion.

- **Resultado Esperado**
  > Rotas com limiter: 0/3 → 3/3; 400 repetidos visíveis em métrica.

- **Tactic alvo**: Detect Service Denial
- **Severidade**: P3
- **Esforço estimado**: S
- **Findings relacionados**: F-security-3, F-security-4
- **Métricas de sucesso**:
  - rotas com limiter: 0/3 → 3/3
- **Risco de não fazer**: baixo; perde-se visibilidade de sondagem.
- **Dependências**: política de rate limit do backend (cross-QA Availability)

## 6. Notas do agente

- Escopo: só o delta de `feat/perfil-usuario`; `npm audit` rápido do frontend (backend não auditado, `--quick`). Infra/CloudTrail/GuardDuty não medíveis (sem `infra/`).
- Focos confirmados limpos: identidade só da sessão, `.strict()`, 11 ramos filtrados por ator, cursor sem widening/injeção, sem credenciais, `no-store`, sem UI de escalonamento.
- Cross-QA: Validate Input com Integrability/Fault Tolerance; Detect Service Denial com Availability/Performance; F-security-1 com Deployability (gate de audit no CI).
