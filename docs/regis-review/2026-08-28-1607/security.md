---
qa: Security
qa_slug: security
run_id: 2026-08-28-1607
agent: qa-security
generated_at: 2026-08-28T16:07:00-03:00
scope: backend
score: 7.5
findings_count: 6
cards_count: 5
---

# Security — Regis-Review

## 1. Cenário Geral (Bass General Scenario aplicado ao nf-projects)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Insider com acesso a `stdout`/agregador de logs (dev, sysadmin, terceiro no Render) | Uma escrita financeira degrada para o robô: `SecretCipher.decrypt` estoura ou `POST /login` do usuário falha, disparando `avisarDegradacao` | `ConexosSessionResolver` (`src/backend/domain/client/ConexosSessionResolver.ts`) escrevendo `LogService.warn` com `platformUsername`, `conexosUsername`, `motivo`, `erro` | Produção (Render) executando baixas reais no `fin010`/`com298`; agregador de logs (stdout) retendo por N dias | O `warn` estruturado precisa registrar a degradação sem jamais expor a senha do usuário (cifrada ou em claro) nem material da chave-mestra `CONEXOS_CRED_ENC_KEY` | 0 fragmentos de senha/chave em qualquer log gerado pelo delta; `conexos_username`/`conexos_usn_cod` no ledger não são adulteráveis por client input |

Um segundo cenário, complementar (**non-repudiation**):

> Auditoria interna precisa reconstruir "quem, no ERP, assinou a baixa X" seis meses depois. O ledger `permuta_alocacao_execucao` (e os quatro gêmeos) deve responder de forma inequívoca: usuário vinculado (`conexos_username = MARILYN_MUTAFCI`), robô (`= env.conexosLogin`), ou **NULL** = "não capturada" (linha anterior a `0051`, ou execução fora de request). NULL nunca deve significar "robô".

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Segredos hardcoded no delta (backend) | 0 | 0 | ✅ | `grep -rEn "(password\|secret\|token\|api[_-]?key\|credential)\s*[:=]\s*['\"][^'\"]{8,}"` nos 13 arquivos do delta |
| SQL não-parametrizado nos 5 repos novos/tocados | 0 | 0 | ✅ | leitura + `grep -rEn "\`[^\`]*(SELECT\|INSERT\|UPDATE\|DELETE)[^\`]*\\\$\{"` — única interpolação restante é `LIMIT ${lim}` com `lim` clampado (`Math.min(Math.max(limit, 1), 20000)`) em `PermutaExecucaoRepository.ts:326` |
| Campos do `warn` I-1 que carregam PII ou risco de leak | 4 (`platformUsername`, `conexosUsername`, `motivo`, `erro`) | 0 senha em claro ou cifrada; PII operacional aceitável (é o propósito do log) | ⚠️ | `ConexosSessionResolver.ts:139-150`; ver F-security-1 |
| `redactSensitive` aplicado ao `erro` do `warn` I-1 | não | recomendado como defesa em profundidade | ⚠️ | mesmo arquivo, linha 148 — `error.message` é passado cru |
| Origem do `platformUsername` no contexto | 100% JWT (`req.user?.sub`), populado por `buildAuthMiddleware` **antes** do `conexosIdentityMiddleware` | 100% JWT | ✅ | `src/backend/index.ts:89-93`, `src/backend/http/conexosIdentity.ts:14` |
| Origem do `conexos_username` gravado no ledger | 100% servidor (`env.conexosLogin` ou `vinculo.conexosUsername` do DB via `getVinculoConexos`) | 100% servidor | ✅ | `ConexosSessionResolver.ts:114,125`, `UserRepository.ts:156-171` |
| Linhas históricas com `conexos_username` NULL após deploy | 35 execuções conhecidas de `MARILYN_MUTAFCI` + qualquer coisa anterior a `0051` | 0 é utópico; convenção "NULL = não capturada" é honesta | ⚠️ | migration `0051_execucao_identidade_conexos.sql:12`, follow-up F-3 |
| `CONEXOS_CRED_ENC_KEY` declarada em `render.yaml`/`.env.example` | não (F-1 do follow-up) | declarar em ambos (com `sync: false` no Render) | ⚠️ | `ontology/_inbox/conexos-fallback-audit-regis-followups.md:F-1` |
| Alarme sobre `LOG_TYPE.BUSINESS_WARN` com `motivo in (decrypt, login)` | ausente | presente | ⚠️ | F-5 do follow-up; nada consome o `warn` ainda |
| Cobertura de teste do `avisarDegradacao` isolando o payload do log | testes cobrem que o warn dispara em `decrypt`/`login`; **não asseveram que o campo `erro` esteja sanitizado** | asserção explícita de "sem senha, sem ciphertext" | ⚠️ | `ConexosSessionResolver.test.ts:110-192`, ver F-security-2 |
| Falhas históricas de `POST /login` para `MARILYN_MUTAFCI` diagnosticadas | 0 (F-2 do follow-up) | causa-raiz nomeada | ⚠️ | segurança secundária: sem essa causa, não dá para saber se é *credential compromise* vs. senha errada vs. `LOGIN_ERROR_MAX_SESSIONS` |

> ⚠️ **Não medível localmente**: taxa real de `warn` por dia em produção, distribuição de `motivo` (decrypt vs. login), e volume de execuções degradadas para robô. Requer o agregador de logs de produção (Render). Recomendação: quando o alarme do F-5 subir, exportar métricas com dimensões `motivo` e `conexos_username` (ver Cards).

> ⚠️ **Não medível neste repo**: métricas de tenant/SSM/Terraform. `infra/` não existe (deploy é hook do Render); ver `_shared-metrics.md`.

## 3. Tactics — Cobertura no nf-projects

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Identify Actors | `platformUsername = req.user?.sub` derivado do JWT verificado por `buildAuthMiddleware` (`SUPABASE_JWT_SECRET`, HS256); `conexosUsername` derivado do DB via `getVinculoConexos(username)` (nunca do body). | ✅ | `src/backend/http/auth.ts:185`, `src/backend/http/conexosIdentity.ts:14`, `UserRepository.ts:156-171` |
| Authenticate Actors | O `conexosIdentityMiddleware` só popula o contexto **após** o `buildAuthMiddleware`. Sem token válido → `req.user` `undefined` → `state.platformUsername` `undefined` → resolver cai no robô (com identidade explícita registrada). `DEV_AUTH_BYPASS` documentado, log ruidoso quando ativo. | ✅ | `src/backend/index.ts:89-93` (ordem dos `app.use`), `src/backend/http/auth.ts:124` |
| Authorize Actors | Escopo do delta: nenhuma nova rota, nenhum novo `role` gate. O ledger não é escrito por rota do cliente — é escrito internamente pelos repositórios de execução chamados pelos services de baixa. | N/A | escopo — não há surface nova de autorização no delta |
| Limit Access | O `conexos_password_enc` só é lido dentro de `ConexosSessionResolver.resolveForUser`; a senha em claro só existe (a) na memória do handler do login, (b) no cadastro do vínculo (`UserAdminService.encrypt`), (c) no processo Node depois do `decrypt`. Nunca sai para log, nunca sai para o DB fora do formato cifrado. | ✅ | `ConexosSessionResolver.ts:100`, `SecretCipher.ts:55`, `UserAdminService.ts:96` |
| Limit Exposure | `avisarDegradacao` propaga `platformUsername` e `conexosUsername` (PII operacional, é o **propósito** do log); NÃO propaga `vinculo.conexosPasswordEnc`, chave-mestra, ou o SID Conexos. Login real via axios já redige `password` com `redactSensitive` no interceptor (`services/conexos.ts:128`). `err.message` do axios é `"Request failed with status code XXX"` — não inclui o corpo com senha. **Defense-in-depth ausente**: o `erro` cru chega ao log sem passar por `redactSensitive` — ver F-security-1. | ⚠️ parcial | `ConexosSessionResolver.ts:148` |
| Encrypt Data | AES-256-GCM (IV 12 bytes, tag 16 bytes) via `SecretCipher`; IV aleatório por cifragem (nunca reusa nonce); chave 32 bytes base64 em `CONEXOS_CRED_ENC_KEY` via `EnvironmentProvider`. Erros dedicados (`MissingEncryptionKeyError`, mensagem sem material sensível). | ✅ | `SecretCipher.ts:45-78` |
| Separate Entities | Cada usuário tem sua própria `ConexosService` (chave de store `columbia:user:<login>`) e sua sessão; o robô tem a dele. O `ConexosSessionRegistry.forUser` isola credenciais por instância. | ✅ | `ConexosSessionRegistry.ts:28-32` |
| Change Default Settings | `CONEXOS_USERNAME`/`CONEXOS_PASSWORD` do robô e `CONEXOS_CRED_ENC_KEY` obrigatórios; sem chave, `SecretCipher.isEnabled` → `false` (a UI de vínculo some). **Gap**: a chave não é **declarada** em `render.yaml` / `.env.example` (F-1) — quem provisiona um ambiente novo pode não perceber que precisa gerar uma. | ⚠️ parcial | F-1 do follow-up |
| Validate Input | Nada do payload do `warn` vem do cliente. `conexosUsername`/`conexosPasswordEnc` vêm do DB via SQL parametrizado; `platformUsername` vem do JWT. Repositórios: 100% `$named` (Rule #5). Única interpolação em SQL é `LIMIT ${lim}` com `lim` clampado em `[1, 20000]`. | ✅ | ver métrica #2 |
| Detect Intrusion | Não implementado no delta (fora do escopo). `warn` I-1 detecta **degradação operacional**, não intrusão (uma sessão comprometida que passe pelo login com sucesso não dispara nada). | N/A | escopo |
| Detect Service Denial | Fora do escopo do delta. `LOGIN_ERROR_MAX_SESSIONS` já tratado no `services/conexos.ts:246` (não é do delta). | N/A | escopo |
| Verify Message Integrity | AES-GCM **é** AEAD — o auth tag garante integridade do ciphertext armazenado. Sem cobertura para integridade **da linha do ledger** (ninguém assina `conexos_username`/`conexos_usn_cod` no DB; quem tiver INSERT no Supabase adultera). Aceitável para o modelo de ameaça atual (DB compartilhado, controle via IAM Supabase), mas nomeado. | ⚠️ parcial | `SecretCipher.ts:61-63` |
| Detect Message Delay | N/A no escopo | N/A | — |
| Revoke Access | Rotacionar `CONEXOS_CRED_ENC_KEY` **quebra** todos os vínculos (blobs anteriores viram indecifráveis). Antes deste delta, isso silenciava — agora o `warn` I-1 (`motivo=decrypt`) sinaliza. Não há re-encrypt-on-rotate. | ⚠️ parcial | `SecretCipher.ts:55-63` + `ConexosSessionResolver.ts:101-109` |
| Lock Computer | N/A | N/A | — |
| Inform Actors | O `warn` de I-1 registra a degradação; **falta** o canal de notificação (F-5) — nada consome o `warn`. O usuário afetado só vê no login (`testarVinculo`), não no momento em que a baixa sai como robô. | ⚠️ parcial | F-5 do follow-up |
| Audit Trail (Restore + audit) | Alvo central do delta: `conexos_username` + `conexos_usn_cod` gravados no `beginExecution` (write-ahead) e reafirmados via `COALESCE(...)` no `markSettled`/`settle`/`fail`/`markError`. Preservação em `settled` (`CASE WHEN status='settled' THEN ... ELSE EXCLUDED ...`) — retry nunca reescreve. Cinco ledgers cobertos: `permuta_alocacao_execucao`, `solicitacao_numerario_execucao`, `recebimento_execucao`, `remessa_execucao`, `conciliacao_execucao`. | ✅ | `migrations/0051_execucao_identidade_conexos.sql`, todos os cinco repositórios |
| Restore | Backfill declinado por decisão (ADR-0041): NULL significa "não capturada", inferir do vínculo atual seria falsificar. As 35 linhas históricas de `MARILYN_MUTAFCI` permanecem NULL. Isso É a decisão — mas continua sendo uma dívida documentada (F-3). | ⚠️ parcial | migration `0051` linha 13, F-3 do follow-up |

## 4. Findings (achados)

### F-security-1: `avisarDegradacao` passa `error.message` cru para o log — defense-in-depth fraca

- **Severidade**: P2
- **Tactic violada**: Limit Exposure (defesa em profundidade)
- **Localização**: `src/backend/domain/client/ConexosSessionResolver.ts:139-150`
- **Evidência (objetiva)**:
  ```typescript
  await this.logService.warn({
      type: LOG_TYPE.BUSINESS_WARN,
      message: 'vínculo Conexos presente mas inutilizável — ...',
      data: {
          platformUsername,
          conexosUsername,
          motivo,
          erro: error instanceof Error ? error.message : String(error),
      },
  });
  ```
  Auditoria dos dois caminhos de origem do `error`:
  - `SecretCipher.decrypt` — só lança erros de crypto ("Unsupported state or unable to authenticate data") ou `MissingEncryptionKeyError`/mensagem-de-tamanho-de-chave. **Nenhum inclui plaintext, ciphertext, ou material da chave**. Verificado em `SecretCipher.ts:55-78`.
  - `ConexosService.ensureSid()` → `_doLogin` → axios `.post('/login', body)`. Erro axios tem `.message = "Request failed with status code XXX"` — o body com a senha **não** vai para `.message`. O body **está** em `err.config.data`, mas o código lê `.message` só. Verificado.
- **Impacto técnico**: hoje, na realidade do stack, a senha em claro ou o ciphertext NÃO chegam ao log — `error.message` é seguro. **Mas** o campo é passado sem sanitização, e a garantia depende de:
  1. `redactSensitive` continuar aplicado no interceptor de request do axios (`services/conexos.ts:128`) — se alguém tirar isso ao "limpar" logs, a senha vaza pelo primeiro `console.log` da rota de login, não pelo `warn` I-1.
  2. Ninguém adicionar um `wrap-and-rethrow` que jogue `err.config.data` em uma nova `Error(msg)`.
  3. `SecretCipher` não passar a incluir amostras do ciphertext em mensagens de erro para "ajudar debug".
  Defense-in-depth manda que o **próprio consumidor** do erro sanitize, não confie no produtor.
- **Impacto de negócio**: baixa hoje (não há vazamento real). Alto se qualquer uma das três garantias acima se romper: um insider com acesso ao stdout do Render (ops Kavex, ops Columbia, sysadmin do agregador de logs) extrai a senha Conexos do usuário → autentica como esse usuário no ERP → dispara baixas/remessas em nome dele, com um path que hoje é "assinado pelo usuário" e ninguém desconfia.
- **Métrica de baseline**: 1 campo do `warn` (`erro`) sem passar por sanitizador; 0 vazamentos hoje; distância de 1 mudança acidental de vazar.

### F-security-2: testes de `avisarDegradacao` não asseveram o **conteúdo** do log

- **Severidade**: P2
- **Tactic violada**: Limit Exposure (regression prevention)
- **Localização**: `src/backend/domain/client/ConexosSessionResolver.test.ts:110-192`
- **Evidência (objetiva)**: os testes cobrem que o `warn` é DISPARADO nos casos `decrypt` e `login` e verificam os campos estruturais (`platformUsername`, `conexosUsername`, `motivo`). Não há um teste que force um erro cujo `.message` contenha `"password"`/`"secret"`/o ciphertext e asseveere que **isso não aparece no `data.erro`**. Sem essa asserção, uma mudança futura no fluxo (por ex., "vamos incluir o body do axios no erro para debug") passa nos testes atuais.
- **Impacto técnico**: ausência de trava automatizada contra o vetor descrito em F-security-1.
- **Impacto de negócio**: idem F-security-1, mais lento de detectar (nenhum gate CI dispara).
- **Métrica de baseline**: 0 testes que asseveram sanitização do payload do `warn`; alvo mínimo: 2 (um para cada `motivo`).

### F-security-3: `CONEXOS_CRED_ENC_KEY` não declarada em `render.yaml` / `.env.example` — silencia degradação em ambientes novos

- **Severidade**: P2 (documentado como F-1 do follow-up, mantido aqui por completude do gate)
- **Tactic violada**: Change Default Settings
- **Localização**: `render.yaml` (ausência), `src/backend/.env.example` (ausência); referência em `SecretCipher.ts:39-42`
- **Evidência (objetiva)**: `SecretCipher.isEnabled()` retorna `false` sem a chave; UI de vínculo desaparece → ninguém cadastra → `getVinculoConexos` sempre retorna `null` → resolver cai no robô sem disparar `warn` (o `warn` só sai quando o vínculo **existe** e falha). Ou seja, um ambiente sem a chave parece saudável (sem warns), mas perde 100% da atribuição de identidade. Reproduzido em 2026-08-25 contra `.env` local (F-1 do follow-up).
- **Impacto técnico**: PR previews, staging e qualquer conta AWS futura (alvo multi-tenant) precisarão descobrir a chave por arqueologia. Rotação silenciosa (alguém remove a var em produção) → 100% das baixas voltam a sair no nome do robô sem alarme.
- **Impacto de negócio**: perda de rastreabilidade individual sem sinal. O feature "quem assinou" volta a valer 0 no dia em que a chave desaparece.
- **Métrica de baseline**: 0 declarações em `render.yaml`/`.env.example`; alvo: 2 (uma em cada, `sync: false` no Render).

### F-security-4: rotação de `CONEXOS_CRED_ENC_KEY` invalida todos os vínculos existentes — sem procedimento de re-encrypt

- **Severidade**: P2
- **Tactic violada**: Revoke Access (rotation)
- **Localização**: `SecretCipher.ts:55-78` (decrypt), `UserRepository.ts:180-194` (setVinculoConexos)
- **Evidência (objetiva)**: `decrypt` lê a chave atual e tenta desfazer o AES-GCM; qualquer blob cifrado com uma chave antiga falha no auth tag → `warn` I-1 (`motivo=decrypt`) → degradação para robô. Não há suporte a chave secundária (key ring) nem script de re-encrypt em massa.
- **Impacto técnico**: rotação de chave (ex.: por incidente) exige, de fato, apagar `conexos_password_enc` de todos os `app_user` e pedir a cada usuário para re-cadastrar a senha. Sem procedimento, a operação vira "todos degradam ao robô até alguém perceber".
- **Impacto de negócio**: janela de tempo em que 100% da atribuição vai para o robô, mascarando ações de usuários reais. Este delta pelo menos **detecta** (via `warn`), mas não **recupera**.
- **Métrica de baseline**: 0 caminhos de re-encrypt-on-rotate; alvo mínimo: um runbook + script de bulk re-encrypt aceitando `(newKey, oldKey)`.

### F-security-5: `viaRobo` calculado no resolver mas não persistido no ledger

- **Severidade**: P3
- **Tactic violada**: Audit Trail (unambiguity)
- **Localização**: `ConexosIdentityProvider.ts:32-55`, `ConexosSessionResolver.ts:114,125`, migration `0051_execucao_identidade_conexos.sql`
- **Evidência (objetiva)**: o `identity` no `AsyncLocalStorage` carrega `viaRobo: boolean` (linhas 114 e 125 do resolver), mas o `currentParams()` que vai para o SQL só materializa `conexosUsername` e `conexosUsnCod`. A migration não cria coluna `via_robo`. A inferência "linha usa o login do robô ⇒ foi robô" depende de convenção externa (o login do robô ser distinto de qualquer login de usuário) — funciona hoje (`env.conexosLogin` ≠ `MARILYN_MUTAFCI`), mas nada no schema garante.
- **Impacto técnico**: se um usuário futuramente compartilhar o login com o robô (ou o robô mudar para um login já usado como pessoal em algum tenant), fica impossível distinguir "usuário" de "fallback" na trilha sem consultar `app_user` **naquele momento**.
- **Impacto de negócio**: ambiguidade forense em cenários de exceção; hoje ínfimo.
- **Métrica de baseline**: 0 colunas persistindo `via_robo`; alvo: 1 (ou justificativa explícita no ADR de que a convenção "login do robô é único" é invariante).

### F-security-6: 35 execuções históricas ficam com `conexos_username` NULL — sem canal de aviso ao operador

- **Severidade**: P3 (dívida assumida por ADR-0041, mantida aqui por completude)
- **Tactic violada**: Audit Trail (backfill/completeness)
- **Localização**: migration `0051_execucao_identidade_conexos.sql:6-13`, F-3 do follow-up
- **Evidência (objetiva)**: NULL agora significa "não capturada" — decisão correta contra fabricar dados. Mas a tela de auditoria (se/quando existir) vai mostrar essas 35 linhas com "—" no campo de assinante, e o operador não tem contexto de que essas linhas foram, na verdade, executadas pelo robô no lugar da usuária.
- **Impacto técnico**: leitor da trilha precisa saber a data de corte (`0051`) para interpretar NULL.
- **Impacto de negócio**: se auditoria interna ou externa cair em cima do backlog anterior a `0051`, a resposta é "não sabemos" — para as 35 linhas específicas, na verdade a resposta É "foi o robô" (foi por isso que a investigação existiu). Documentar isso num anexo do ADR mitigaria.
- **Métrica de baseline**: 35 linhas conhecidas + `count(*)` de execuções em cada uma das 5 tabelas anteriores a `0051` = universo real. Não medível localmente (roda contra produção).

## 5. Cards Kanban

### [security-1] Sanitizar `erro` no `warn` I-1 e travar por teste

- **Problema**
  > `ConexosSessionResolver.avisarDegradacao` passa `error.message` cru para o log. Hoje, os dois caminhos de origem (`SecretCipher.decrypt` e `ConexosService.ensureSid`) produzem mensagens seguras, mas a garantia é indireta e frágil: depende do `redactSensitive` do interceptor axios, de ninguém wrap-and-rethrow do `err.config.data`, e de `SecretCipher` nunca incluir amostras do ciphertext em mensagens. Uma mudança de uma linha em qualquer desses três lugares vaza a senha Conexos do usuário para o stdout do Render — de onde qualquer insider com acesso ao agregador de logs extrai e usa para assinar baixas em nome do usuário sem levantar suspeita.

- **Melhoria Proposta**
  > Aplicar `redactSensitive` (já existente em `src/backend/services/conexos.ts:53`) ao campo `erro` do `warn` — o consumidor sanitiza, sem confiar no produtor (**Limit Exposure** em defesa-em-profundidade). Além disso, opcional: reduzir o `erro` a um shape estável (`{ name, code, statusCode }`) em vez do `.message` cru, para o log virar métrica sem ficar dependente de string livre.

- **Resultado Esperado**
  > Payload do `warn` provavelmente livre de qualquer valor sensível, independente de mudanças upstream no axios ou no SecretCipher.
  > Métrica: campos do `data` do `warn` passando por sanitizador antes de sair — 0 → 1 (o `erro`).

- **Tactic alvo**: Limit Exposure
- **Severidade**: P2
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-security-1, F-security-2
- **Métricas de sucesso**:
  - Chamadas ao `LogService` no delta com campo cru vindo de `error.message`: 1 → 0
  - Testes que asseveram ausência de padrões sensíveis no `data.erro`: 0 → ≥2 (um por `motivo`)
- **Risco de não fazer**: uma mudança futura (bem-intencionada, para "melhorar o debug") vaza a senha Conexos para o log sem quem tocou perceber; sem gate CI, ninguém acusa.
- **Dependências**: —

### [security-2] Teste explícito de sanitização do payload do `warn` I-1

- **Problema**
  > Os testes atuais do resolver cobrem que o `warn` dispara e que os campos estruturais estão certos, mas não têm asserção do tipo "se o erro contiver a string da senha, o log não deve contê-la". Sem essa trava, [security-1] pode ser desfeito silenciosamente numa refatoração.

- **Melhoria Proposta**
  > Adicionar dois testes em `ConexosSessionResolver.test.ts`: um mocka `SecretCipher.decrypt` para lançar `new Error('senha=<PLAINTEXT_MARKER>')`; outro mocka `service.ensureSid` para lançar `new Error('body=<CIPHERTEXT_MARKER>')`. Ambos asseveram que `logService.warn` não recebe nenhuma das marcações no `data.erro`. Fica como regressão para [security-1].

- **Resultado Esperado**
  > CI trava qualquer alteração que reintroduza payload sensível no `warn`.
  > Métrica: 0 → 2 testes de sanitização.

- **Tactic alvo**: Limit Exposure
- **Severidade**: P2
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-security-1, F-security-2
- **Métricas de sucesso**:
  - Testes de sanitização do `warn`: 0 → 2
  - Regressão de vazamento detectada por CI antes do PR: 0% → 100%
- **Risco de não fazer**: mesmo risco de [security-1] mais "fica invisível quando quebrar".
- **Dependências**: idealmente merge junto com [security-1]

### [security-3] Declarar `CONEXOS_CRED_ENC_KEY` em `render.yaml` e `.env.example`

- **Problema**
  > A chave-mestra que habilita todo o vínculo Conexos não aparece em `render.yaml` (com `sync: false`) nem em `src/backend/.env.example`. Um ambiente novo (staging, PR preview, futura conta AWS por tenant) sem a chave silenciosamente vira "coluna Conexos some, todo mundo degrada para robô, nenhum warn dispara porque não há vínculo cadastrado" — parece saudável, é 0% de atribuição individual. Reproduzido em 2026-08-25 (F-1 do follow-up). Se a chave for **removida** de produção por acidente, o mesmo cenário se instala em prod.

- **Melhoria Proposta**
  > Adicionar entrada `- key: CONEXOS_CRED_ENC_KEY / sync: false` em `render.yaml` (não vaza valor; sinaliza a existência do slot). Adicionar `CONEXOS_CRED_ENC_KEY=` (vazio, com comentário sobre como gerar via `node -e "..."`) em `src/backend/.env.example`. Complemento útil: um smoke-test em boot que loga um `warn` se `SecretCipher.isEnabled() === false` **e** houver usuários com `conexos_username != null` no DB — sinaliza "vínculos cadastrados sem chave para decifrar".

- **Resultado Esperado**
  > Provisionar ambiente novo passa a exigir explicitamente a chave; remoção acidental em prod dispara alarme.
  > Métrica: declarações da variável — `render.yaml`: 0 → 1; `.env.example`: 0 → 1.

- **Tactic alvo**: Change Default Settings
- **Severidade**: P2
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-security-3
- **Métricas de sucesso**:
  - Ambientes com atribuição individual = 100% (hoje: prod=100%, staging/local=0%)
- **Risco de não fazer**: convive-se com "todo mundo é o robô" em qualquer ambiente novo até alguém investigar; se a chave sair de prod, silencia até que auditoria repare.
- **Dependências**: F-1 do follow-up é o mesmo item — este card materializa a decisão.

### [security-4] Alarme sobre `BUSINESS_WARN` com `motivo in (decrypt, login)`

- **Problema**
  > O delta registra a degradação, mas não notifica ninguém. Um usuário com vínculo cadastrado cujo login nunca completa (o cenário original: 35 execuções de `MARILYN_MUTAFCI` no fin010 como robô) só é descoberto agora se alguém for ler o log ou olhar o ledger. O `warn` sozinho não fecha o loop.

- **Melhoria Proposta**
  > Configurar alarme no agregador de logs do Render sobre `level=WARN AND type=BUSINESS_WARN AND data.motivo in (decrypt, login)`, com deduplicação por `data.conexosUsername` e janela de 24h. Encaminhar para o canal ops. Complementar com uma métrica agregada (contador por `motivo`) para dashboard.

- **Resultado Esperado**
  > Um usuário cujo login está quebrado vira alerta em ≤24h, não em ≤3 meses.
  > Métrica: tempo médio entre "quebra do vínculo" e "operador informado": semanas/meses (baseline) → ≤24h.

- **Tactic alvo**: Inform Actors
- **Severidade**: P2
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-security-4 do follow-up (F-5), Tactic "Inform Actors"
- **Métricas de sucesso**:
  - MTTD para vínculo quebrado: n/d → ≤24h
  - Volume de `warn` por dia em prod: mensurar (baseline necessária)
- **Risco de não fazer**: o próximo `MARILYN_MUTAFCI` gera novas 35+ linhas mal atribuídas antes de alguém perceber.
- **Dependências**: nenhum; opera diretamente sobre os logs já emitidos.

### [security-5] Runbook + script de rotação de `CONEXOS_CRED_ENC_KEY`

- **Problema**
  > Rotacionar a chave hoje quebra 100% dos vínculos (todos os blobs viram indecifráveis). O delta pelo menos **detecta** via `warn` I-1 (`motivo=decrypt`), mas não recupera — cada usuário precisaria re-cadastrar a senha. Sem procedimento escrito, uma rotação por incidente vira janela de dias em que toda baixa sai como robô.

- **Melhoni Proposta**
  > Escrever runbook em `docs/runbooks/rotate-conexos-cred-enc-key.md` e implementar `scripts/rotate-conexos-cred-enc-key.ts` que aceita `(oldKey, newKey)`, itera `app_user` com `conexos_password_enc != null`, decifra com a antiga e recifra com a nova em transação. Suporte a duas chaves ativas por N horas (secundária como fallback de leitura) evita janela de indisponibilidade.

- **Resultado Esperado**
  > Rotação vira operação segura, sem janela de "todo mundo virou robô".
  > Métrica: procedimento documentado (0 → 1) + tempo de rotação sem impacto (∞ → minutos).

- **Tactic alvo**: Revoke Access
- **Severidade**: P3
- **Esforço estimado**: M (2–5d)
- **Findings relacionados**: F-security-4
- **Métricas de sucesso**:
  - Runbook publicado: 0 → 1
  - Script com teste E2E contra Postgres local: 0 → 1
- **Risco de não fazer**: um incidente que force rotação de chave desabilita atribuição individual por dias, exatamente quando ela mais importa (post-incidente).
- **Dependências**: pode encostar em [security-3] para reaproveitar a validação de chave.

## 6. Notas do agente

- **F-security-1** foi o exercício mais valioso do gate: o código atualmente é seguro contra vazamento de senha via `warn`, mas por uma cadeia frágil de garantias em três lugares distintos. O card [security-1] é preventivo, não corretivo.
- Cross-QA para o consolidator:
  - **Audit Trail** (esta seção) sobrepõe com **Fault Tolerance**: o mesmo `write-ahead + COALESCE + preservação em `settled`` que dá não-repúdio serve ao reaper de órfãos.
  - **Limit Exposure** encosta em **Availability** (blast radius): se a chave-mestra some, tudo vira robô — degradação silenciosa antes do delta, agora observável.
  - **Validate Input** sobrepõe com **Integrability**: os cinco repositórios de execução são o ponto onde a identidade vinda do JWT vira linha de ledger — a integridade dessa fronteira é o que sustenta a alegação de não-repúdio.
- Não executei `npm audit` (fora do escopo `--quick` do delta) nem varredura ampla de infra (não existe `infra/` neste repo). Métricas de tenant/SSM/Terraform: **não medíveis** por design.
