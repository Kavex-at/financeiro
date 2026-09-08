---
qa: Security
qa_slug: security
run_id: 2026-09-03-2015-session-store-pool
agent: qa-security
generated_at: 2026-09-03T20:15:00-03:00
scope: backend
score: 7.5
findings_count: 3
cards_count: 2
---

# Security — Regis-Review

## 1. Cenário Geral (Bass General Scenario aplicado ao nf-projects)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| pooler Postgres (Supabase) derruba um cliente ocioso do 2º pool do processo (session store) | evento `error` do `pg.Pool` carregando mensagem de infra (`password authentication failed for user "financeiro"`, `connect ECONNREFUSED 10.0.0.5:5432`, `getaddrinfo ENOTFOUND aws-0-sa-east-1.pooler.supabase.com`) | `src/backend/services/conexosSessionStore.ts` — handler de `error` do Pool e catch de construção | Prod Render Express, drain do stdout indexado no painel do Render (retido) | encerrar o pool quebrado, esvaziar o slot, permitir reconstrução preguiçosa na próxima chamada, emitir `console.warn` com detalhe **redigido** — sem `throw`, sem derrubar o backend | 0 credenciais/senhas/URLs completas no stdout · 0 vazamentos de `sid`/`login_payload` da tabela `conexos_sessions` · 100% dos `console.warn` do arquivo passando por `redactErrorMessage` |

Delta desta rodada é cirúrgico (~50 linhas em um arquivo). A tactic-mãe do delta é **Limit Access** (redação no ponto de log) somada a **Restore** (reconstrução preguiçosa) e **Lock Computer** (shutdown trava a reconstrução).

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| `console.warn` no arquivo que passam por `redactErrorMessage` | 1 de 3 (33%) | 3 de 3 (100%) | ⚠️ | `grep -n "console.warn" src/backend/services/conexosSessionStore.ts` → linhas 217, 306, 331; só 306 usa o redator |
| Padrões cobertos pelo `redactErrorMessage` para erros típicos do `pg` sobre socket/auth | 4 de 6 formatos comuns cobertos (connection string completa, `password=…`, cookie/`sid=`, `for user "X"`) — **fora**: `ECONNREFUSED <ip>:<port>` e `ENOTFOUND <host>` | 6 de 6 | ⚠️ | `src/backend/http/redact.ts:61-74` + inspeção manual das mensagens padrão do `pg`/`libpq` |
| Novos sítios de log que exponham `sid` ou `login_payload` da tabela `conexos_sessions` neste delta | 0 | 0 | ✅ | Handler novo (`pool.on('error', …)`, linha 301) opera sobre erro de socket, não sobre resultado de query; e Pattern 3 (`\b(?:cookie\|set-cookie\|sid\|jsessionid)\s*[=:]\s*\S+`) redige `sid=` caso apareça |
| Credenciais hardcoded (grep no arquivo) | 0 | 0 | ✅ | `grep -Ei "(password\|secret\|token\|credential)\s*[:=]\s*['\"][^'\"]{6,}" src/backend/services/conexosSessionStore.ts` → nenhum hit; connection string vem de `env.databaseConnectionString` |
| Uso de SQL parametrizado no arquivo | 100% (4/4 queries com `$1..$9`) | 100% | ✅ | `src/backend/services/conexosSessionStore.ts:120, 148-160, 170-184, 205-208` — Inviolable Rule #5 respeitada |
| Cobertura de teste do arquivo | stmts 90,47% · branches 75,80% · funcs 93,75% · lines 91,11% | thresholds do repo (72/54/78) | ✅ | `_shared-metrics.md` (execução do run) |
| `console.warn` com redação verificada por teste | 1 (o novo, com formato `for user "…"`) | 1 (o novo é o único adicionado no delta) | ✅ | `src/backend/services/conexosSessionStorePool.test.ts:98-108` — teste `logs a redacted warning instead of swallowing the error silently` |

> ⚠️ **Não medível localmente** (nem relevante nesta rodada, mas registro para o consolidator):
> - Presença de CloudTrail/GuardDuty **por tenant**: N/A neste repo — runtime é Render/Vercel, não há `infra/` nem multi-tenant AWS provisionado.
> - Alerta sobre volume anômalo de `console.warn` do session store no painel do Render: fora do escopo do delta (é métrica de operação, não de código).
> - `npm audit`: **skip** por flag `--quick` do run, conforme escopo do coordenador.

## 3. Tactics — Cobertura no nf-projects

Mapa completo das tactics de Security do Bass. Marcadas **N/A escopo** as que dependem de artefatos fora do arquivo sob revisão (autz, autn de usuário, IAM, etc.) — este é um review restrito a um arquivo, não um review de repositório.

### Detect Attacks

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Detect Intrusion | Sem IDS/GuardDuty no repo (runtime Render). Fora do escopo do delta. | N/A escopo | — |
| Detect Service Denial | Pool `error` agora emite `console.warn` (era `() => undefined`). Substrato para alertar volume anômalo — mas o alerta em si vive fora do arquivo. | ⚠️ parcial | `conexosSessionStore.ts:301-313` |
| Verify Message Integrity | N/A escopo — delta não trata mensagens do Conexos. | N/A escopo | — |
| Detect Message Delay | N/A escopo | N/A escopo | — |

### Resist Attacks

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Identify Actors | `holder = pid:${process.pid}` grava quem persistiu o `sid` na tabela — útil forensicamente. Não é autenticação, é atribuição. | ✅ presente | `conexosSessionStore.ts:95, 148-160` |
| Authenticate Actors | N/A escopo — autn de usuário/API não passa por este arquivo. | N/A escopo | — |
| Authorize Actors | N/A escopo | N/A escopo | — |
| **Limit Access** (chave desta rodada) | `redactErrorMessage` aplicado ao **novo** `console.warn` do handler de `error` do Pool. Cobre connection string, `password=`, `for user "…"`, cookie/`sid=`, Bearer. **NÃO cobre**: IP interno em `ECONNREFUSED 10.0.0.5:5432` e hostname interno em `ENOTFOUND …supabase.com`. **Inconsistente** dentro do próprio arquivo — dois outros `console.warn` (linhas 217, 331) chamam `console.warn` sem passar pelo redator. | ⚠️ parcial | `conexosSessionStore.ts:306-308` (com redator); `:217, :331` (sem); `redact.ts:61-74` (padrões) |
| Limit Exposure | Pool `max: 2` e `idleTimeoutMillis: 10000` mantêm o blast radius da leak de conexão em 2 sockets/deploy; shutdown drena tudo (`storeClosed` trava reabertura). | ✅ presente | `conexosSessionStore.ts:290-296, 247-255` |
| Encrypt Data | N/A escopo — TLS é responsabilidade da connection string (`?sslmode=require` no Supabase), não do código do store. | N/A escopo | — |
| Separate Entities | Pool dedicado ao session store (separado do `PostgreeDatabaseClient` do domínio) — falha aqui não trava o resto. `PoolHolder` isola pool corrente do handler de erro. | ✅ presente | `conexosSessionStore.ts:229-235` |
| Change Default Settings | N/A — não há credencial padrão no arquivo; `env.databaseConnectionString` é injetada. | N/A | — |
| Validate Input | N/A escopo — delta não introduz novo boundary de input externo. Persist recebe input tipado do `ConexosService`. | N/A escopo | — |

### React to Attacks

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Revoke Access | `invalidate(deadSid)` deleta linha condicionalmente (só se ainda contém o sid morto) — não expandido nesta rodada, mas presente. | ✅ presente | `conexosSessionStore.ts:202-212` |
| Lock Computer | `storeClosed = true` impede reconstrução preguiçosa após shutdown — "trava" o subsistema. | ✅ presente | `conexosSessionStore.ts:237, 247-255, 320-325` |
| Inform Actors | `console.warn` redigido dá visibilidade — mas termina no stdout do Render, não em canal de alerta (Slack/PagerDuty). Ganho vs. `() => undefined` original, teto baixo. | ⚠️ parcial | `conexosSessionStore.ts:306-308` |

### Recover from Attacks

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Restore | Reconstrução preguiçosa do pool: `pool ?? (storeClosed ? undefined : openPool())`. Encerra + esquece + reconstrói. Teste dedicado (`rebuilds the pool on the next call after an error killed it`). | ✅ presente | `conexosSessionStore.ts:319-327`; `conexosSessionStorePool.test.ts:78-93` |
| Audit Trail | `console.warn` no stdout NÃO é audit trail persistido. O log do drain do Render é retido, mas não indexado nem correlacionado a `job_execucao`. Overlap com Fault Tolerance. | ⚠️ parcial | `conexosSessionStore.ts:306-308` |

## 4. Findings (achados)

### F-security-1: Segundo `console.warn` do arquivo (catch da construção do Pool) NÃO passa por `redactErrorMessage`

- **Severidade**: P2 (débito técnico defensável — vazamento condicional a um throw síncrono raro, mas inconsistência clara dentro do mesmo arquivo)
- **Tactic violada**: Limit Access
- **Localização**: `src/backend/services/conexosSessionStore.ts:329-335`
- **Evidência (objetiva)**:
  ```typescript
  } catch (cause) {
      const detail = cause instanceof Error ? cause.message : String(cause);
      console.warn(
          `[ConexosSessionStore] construção do Pool falhou — store desabilitado: ${detail}`,
      );
      return new ConexosSessionStore({ db: null });
  }
  ```
  Comparar com o irmão na linha 306, que usa `redactErrorMessage(detail)`. Mesma classe de erro (`pg`/`pg-connection-string`), mesmo destino (stdout do Render), redação diferente.
- **Impacto técnico**: `new Pool({ connectionString })` do `pg` chega a lançar sincronamente quando a `connectionString` é malformada — o parser `pg-connection-string` lança `Error` com **a URL de entrada dentro da mensagem** (ex.: `Invalid URI: postgresql://user:senha_real@host:5432/db?...`). Nesse caminho, senha e host internos aparecem crus no log do Render — enquanto o irmão a 25 linhas de distância redige o mesmo formato.
- **Impacto de negócio**: um insider com acesso ao painel de logs do Render (ou ao GitHub Action que agrega o drain) extrai a senha do Postgres compartilhado do Conexos session store em plaintext. Como o Supabase é multi-schema, a senha vale para todo o tenant do banco. O evento é raro (só num deploy com `DATABASE_CONNECTION_STRING` malformada), mas persistente: o log fica retido até a política de retenção expirar.
- **Métrica de baseline**: 2 de 3 `console.warn` do arquivo (linhas 217, 331) NÃO passam por `redactErrorMessage` — 33% de cobertura de redação dentro do próprio arquivo. Cardinalidade de credenciais potencialmente expostas por evento: 1 (senha do Postgres do session store) + 1 (host interno).

### F-security-2: Regexes de `redactErrorMessage` não cobrem IP interno e hostname interno em erros de socket do `pg`

- **Severidade**: P3 (informational leak — expõe topologia, não credencial; ainda assim é o formato de erro mais comum do `pg` num socket ocioso, então cai no log do Render regularmente)
- **Tactic violada**: Limit Access
- **Localização**: `src/backend/http/redact.ts:61-74` (padrões) + `src/backend/services/conexosSessionStore.ts:306-308` (call site do delta)
- **Evidência (objetiva)**:
  Padrões atuais em `redact.ts`:
  ```
  [/\b[a-z][a-z0-9+.-]*:\/\/[^\s:@/]+:[^\s@/]+@/gi, '[REDACTED_URL]@'],      // só cobre URL com user:pass@
  [/\b(?:password|senha|pwd|secret|token|api[_-]?key|jwt)\s*[=:]\s*\S+/gi, ...],
  [/\b(?:cookie|set-cookie|sid|jsessionid)\s*[=:]\s*\S+/gi, ...],
  [/\bbearer\s+[\w-]{8,}\.?[\w.-]*/gi, ...],
  [/\bfor user\s+"[^"]*"/gi, ...],
  [/\b[A-Za-z0-9+/]{32,}={0,2}\b/g, ...],                                    // base64 longo (32+)
  ```
  Formatos típicos do `pg` que escapam:
  - `connect ECONNREFUSED 10.0.0.5:5432` — IP + porta ficam crus
  - `getaddrinfo ENOTFOUND aws-0-sa-east-1.pooler.supabase.com` — hostname (com project-ref implícito) fica cru
  - `connection to server at "db.abcdefghijklmn.supabase.co" (10.0.0.5), port 5432 failed` — host + IP crus
- **Impacto técnico**: o novo `console.warn` do handler de `error` do Pool (linha 306) redige senha/URL/cookie/user, mas passa direto IP interno e hostname interno do Supabase — que são exatamente os formatos que o `pg` produz para os erros mais comuns (socket ocioso derrubado pelo pooler, DNS transiente). O rastro operacional que se ganhou custa exposição contínua da topologia.
- **Impacto de negócio**: um atacante com leitura do drain de logs enumera o hostname do pooler Supabase da Columbia (project-ref revelável), o range de IP interno da rede do Render e a porta do pool — mapa completo de alvo para tentativa de conexão direta. Não é credencial (`sslmode=require` continua barrando), mas reduz o custo de reconhecimento de dias para segundos.
- **Métrica de baseline**: 2 formatos comuns do `pg` (de ~6 formatos usuais) escapam da redação — cobertura ~67%. Frequência esperada em produção: 1-3 eventos/dia por processo, conforme comportamento do pooler Supabase em modo transação.

### F-security-3: `private warn` (chamado por `acquire`/`persist`/`invalidate`) permanece sem `redactErrorMessage` — inconsistência agora convive no mesmo arquivo

- **Severidade**: P2 (pré-existente ao delta, mas o delta cria a assimetria que torna o débito visível)
- **Tactic violada**: Limit Access
- **Localização**: `src/backend/services/conexosSessionStore.ts:214-219` (chamado em `:125, :192, :210`)
- **Evidência (objetiva)**:
  ```typescript
  private warn(message: string, cause: unknown): void {
      const detail = cause instanceof Error ? cause.message : JSON.stringify(cause);
      console.warn(`[ConexosSessionStore] ${message}: ${detail}`);
      if (DEBUG_VERBOSE) boxLog('ConexosSessionStore warn', { message, detail });
  }
  ```
  Erros do `pg` numa `pool.query` podem carregar: `password authentication failed for user "financeiro"` (parcialmente coberto por Pattern 5), `duplicate key value violates unique constraint "conexos_sessions_key_key"` (sem segredo), `connect ECONNREFUSED …` (fugindo dos padrões, ver F-security-2). Chamado por `acquire`, `persist` e `invalidate` — os três caminhos de query do arquivo.
- **Impacto técnico**: o pool `error` (novo, redigido) e o query error (antigo, não redigido) convivem no mesmo arquivo com políticas de redação diferentes. Um erro pontual de auth (ex.: senha rotacionada mid-flight) durante uma `acquire` vai ao stdout sem passar por `redactErrorMessage` — o mesmo texto que o handler novo redigiria.
- **Impacto de negócio**: mesmo perfil de vazamento de F-security-1, disparado por query em vez de construção — muito mais frequente. Nenhum caminho novo desta rodada expõe `sid`/`login_payload` (o handler novo é socket-level), mas o caminho antigo continua exposto ao formato `for user "…"` em falha de auth (parcialmente redigido pelo Pattern 5).
- **Métrica de baseline**: `private warn` é chamado em 3 sítios (`:125`, `:192`, `:210`); nenhum passa por `redactErrorMessage`. Frequência esperada em produção: baixa (erro de query no session store é raro), mas cumulativa entre deploys.

## 5. Cards Kanban

### [security-1] Passar `detail` pelo `redactErrorMessage` no catch de construção do Pool

- **Problema**
  > O `console.warn` do bloco `catch` da construção do Pool (`conexosSessionStore.ts:331-333`) loga `detail` cru. Um `new Pool({ connectionString: '<URL malformada>' })` que lance sincronamente com a URL de entrada dentro da mensagem (comportamento do `pg-connection-string`) despeja senha e host internos no stdout do Render. Inconsistente com o irmão a 25 linhas de distância (`:306`) que já passa `detail` pelo `redactErrorMessage`.

- **Melhoria Proposta**
  > Envolver `detail` em `redactErrorMessage(detail)` no `console.warn` da linha 331. Tactic Bass: **Limit Access**. Um único arquivo tocado: `src/backend/services/conexosSessionStore.ts`. Adicionar teste no `conexosSessionStorePool.test.ts` que injeta um `Pool` mock que lança sincronamente com uma URL fictícia contendo senha (`postgresql://u:MINHA_SENHA@host/db`) e verifica que `warn.mock.calls` **não contém** `'MINHA_SENHA'`.

- **Resultado Esperado**
  > 3 de 3 `console.warn` do arquivo passam por `redactErrorMessage` (33% → 100%). O caminho de falha de boot deixa de vazar credencial mesmo no cenário raro de connection string malformada.

- **Tactic alvo**: Limit Access
- **Severidade**: P2
- **Esforço estimado**: S (≤1d) — ~3 linhas de código + 1 teste
- **Findings relacionados**: F-security-1
- **Métricas de sucesso**:
  - `console.warn` do arquivo passando pelo redator: 1/3 → 3/3 (100%)
  - Teste dedicado ao caminho de boot com credencial na URL: 0 → 1
- **Risco de não fazer**: em 6 meses, uma rotação/typo de connection string em produção despeja senha do Postgres compartilhado do session store no drain do Render — permanência do log conforme política de retenção da plataforma (retido).
- **Dependências**: nenhuma.

### [security-2] Adicionar padrões de IP interno e hostname interno ao `redactErrorMessage`

- **Problema**
  > `redactErrorMessage` (redact.ts:61-74) redige URL/senha/cookie/user, mas passa direto os dois formatos mais comuns do `pg` num socket ocioso derrubado pelo pooler: `connect ECONNREFUSED <ip>:<port>` e `getaddrinfo ENOTFOUND <host>`. O novo `console.warn` do handler de `error` do Pool (o principal ganho desta rodada) cai justamente nesses formatos em produção — o rastro que se ganhou expõe topologia (IP interno + hostname do project-ref Supabase) continuamente.

- **Melhoria Proposta**
  > Estender `PADROES_SENSIVEIS` em `src/backend/http/redact.ts` com dois padrões:
  > - `/\b(?:ECONNREFUSED|ECONNRESET|EHOSTUNREACH)\s+\d{1,3}(?:\.\d{1,3}){3}(?::\d+)?/gi` → substituir por `'[REDACTED_ENDPOINT]'`
  > - `/\b(?:ENOTFOUND|EAI_AGAIN)\s+[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+/gi` → substituir por `'[REDACTED_HOST]'`
  >
  > Tactic Bass: **Limit Access**. Cobertura no redator existente — não introduz redator novo. Adicionar 2 casos ao `redact.test.ts` (que já existe, referenciado por `redact.ts:47` como "ADR-0042, achado de segurança do Regis-Review").

- **Resultado Esperado**
  > Cobertura dos formatos comuns do `pg` na redação de erro: 4/6 → 6/6 (100%). O `console.warn` novo do handler de `error` do Pool passa a redigir topologia interna além de credenciais.

- **Tactic alvo**: Limit Access
- **Severidade**: P3
- **Esforço estimado**: S (≤1d) — 2 regex + 2 testes
- **Findings relacionados**: F-security-2, F-security-3 (F-3 se beneficia após aplicar security-3)
- **Métricas de sucesso**:
  - Padrões cobertos em `PADROES_SENSIVEIS`: 6 → 8
  - `ECONNREFUSED <ip>:<port>` em log do session store: exposto → redigido
  - `ENOTFOUND <host>` em log do session store: exposto → redigido
- **Risco de não fazer**: em 6 meses, o drain de logs do Render acumula o hostname do pooler Supabase da Columbia (project-ref revelável) e o range de IP da rede interna — mapa de reconhecimento pronto para qualquer leitor do painel.
- **Dependências**: nenhuma. Independente de security-1 e security-3.

## 6. Notas do agente

- **Escopo respeitado**: julgamento contido ao arquivo `conexosSessionStore.ts` (delta) e à dependência direta `redact.ts` — não avaliei autz/autn/IAM/CORS/CSRF/dependencies, marcadas `N/A escopo` no mapa de tactics conforme instrução do coordenador.
- **Migrar para DDD**: F-security-3 (`private warn`) toca a mesma classe de vazamento do delta, mas o método é pré-existente e nasce no bloco legado que a docstring do arquivo explicitamente marca como exceção (BE-11 de outra revisão). Registrado como P2 para reaproveitar o card de redação (security-1 sugere estender teste; security-3 pode subir junto ou aguardar migração DDD).
- **Cross-QA para o consolidator**:
  - **Fault Tolerance**: Audit Trail em `console.warn` do stdout é frágil — o handler de `error` do Pool não persiste em `job_execucao`. Se Fault Tolerance abrir card sobre falta de trilha persistida em `alerta.detalhe.erro`, ele resolve parte do Audit Trail deste QA sem retrabalho.
  - **Availability**: `Limit Exposure` (pool max 2 + shutdown drain) é ganho conjunto — o mesmo delta reduz blast radius de vazamento de conexão. Availability provavelmente contabiliza como ganho da rodada.
  - **Integrability**: reconstrução preguiçosa é a correção do achado `integrability-2` da rodada anterior — devolver ao qa-integrability como remediação verificada.
- **Verificado por teste**: `conexosSessionStorePool.test.ts:98-108` prova que `for user "financeiro"` → `for user "[REDACTED]"` no novo `console.warn`. Não há teste para IP/hostname (base do F-security-2) nem para o catch de construção (base do F-security-1).
