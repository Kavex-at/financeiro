---
qa: Security
qa_slug: security
run_id: 2026-08-25-1742-sispag-retomada
agent: qa-security
generated_at: 2026-08-25T17:49:00Z
scope: backend
score: 8
findings_count: 4
cards_count: 4
---

# Security — Regis-Review

## 1. Cenário Geral (Bass General Scenario aplicado ao delta)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Ator interno com acesso a repo/CI ou operador em máquina de dev | Executa retomada de remessa apontando ambiente errado (dev com `.env` de PRD, job de HML rodado contra PRD, download do `.REM` por usuário não-admin) | `RemessaService.gerarRemessa` (retomada), `POST /sispag/lotes/:id/remessa`, `GET /sispag/lotes/:id/remessa/arquivo`, `GET /sispag/execucoes`, jobs `seed-hml-vencimento`/`validate-retomada-remessa-v1`, `BootMigrator`, `EnvironmentProvider` | Ambiente ao lado da produção; `.env` local com base PRD por padrão (leitura ao vivo é legítima) | Guardas em camadas: (i) `requireRole('admin')` em toda rota SISPAG de mutação e no download do `.REM`; (ii) `sispagLiveWriteEnabled` como kill-switch por-frente; (iii) `EnvironmentProvider` ignora `CONEXOS_WRITE_ENABLED=true` em `local`+PRD; (iv) `BootMigrator` recusa DDL de `local` para host remoto conhecido; (v) jobs de seed/validate abortam sem `-hml` na URL do ERP; (vi) fixtures capturadas do ERP têm todo valor redigido por tipo e teste dedicado guarda a redação | 0 rota da retomada sem `admin` (10/10 rotas de mutação SISPAG); 0 escrita em PRD a partir de `local` sem override explícito; 0 fixture com valor cru de CNPJ/agência/conta no repo; 0 job de escrita rodável em PRD por default; MTTR de override desligado = 1 redeploy |

> Escopo desta lente: só o delta do `/feature-tweak sispag` (retomada). Rotação dos 4 segredos de PRD e `app_user.role DEFAULT 'admin'` são **conhecidos** — vivem no runbook `docs/runbooks/rotacao-segredos.md` e não voltam aqui.

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Rotas SISPAG de mutação/execução financeira com `requireRole('admin')` | 14/14 (`POST /lotes`, `POST /lotes/:id/itens`, `DELETE .../itens/...`, `finalizar/reabrir/cancelar/retorno`, `.../modalidade`, `.../conta`, `POST /ingestao`, `POST /lotes/formar`, `GET /contas-pagadoras`, `POST /lotes/:id/remessa`, `GET /lotes/:id/remessa/arquivo`, `POST /retornos/conciliar`, `GET /execucoes`) | 100% | ✅ | `grep -n "requireRole\|router\.\(get\|post\|delete\)" src/backend/routes/sispag.ts` |
| Rota nova da retomada (`GET /sispag/execucoes`) com authz e teste | admin + teste (`role: 'viewer'` → 403) em `sispag.test.ts:628` | admin + teste | ✅ | `src/backend/routes/sispag.test.ts:600-635` |
| Download do `.REM` (CNAB 240 com CNPJ/agência/conta de fornecedor) exige admin | Sim + teste dedicado em `sispag.test.ts:466` (`role='viewer'` → 403) | admin | ✅ | `src/backend/routes/sispag.ts:437-455` |
| Fixtures capturadas do ERP com redação por tipo | 6/6 (fin005, fin015-lote, fin015-titulo-pendente, fin050, fin064, ger015) — teste de contrato exige `strings.startsWith('<')` para 100% dos valores string | 100% | ✅ (com ressalva — ver F-security-1) | `src/backend/domain/interface/sispag/__fixtures__/contrato.test.ts:97-107` |
| Jobs de escrita/seed que **recusam** rodar em PRD por default | 2/2 (`seed-hml-vencimento` — hard-refuse sem `-hml`, sem escapatória; `validate-retomada-remessa-v1` — refuse sem `-hml` OU `PERMITIR_PRD=1`, e ainda exige `--executar` explícito) | 100% | ✅ | `src/backend/jobs/seed-hml-vencimento.ts:38-42`; `src/backend/jobs/validate-retomada-remessa-v1.ts:48-51` |
| Guarda `BootMigrator` (DDL de `local` para banco remoto) | Presente, testada (5 casos em `BootMigrator.test.ts:131-165`), escapatória documentada `PERMITIR_MIGRACAO_REMOTA=1` | Presente + testada | ✅ | `src/backend/migrations/BootMigrator.ts:96-115` |
| Guarda `EnvironmentProvider` (write PRD a partir de `local`) | Presente, testada (5 casos em `EnvironmentProvider.test.ts:218-290`), escapatória documentada `PERMITIR_ESCRITA_PRD_LOCAL=1` | Presente + testada | ✅ | `src/backend/domain/libs/environment/EnvironmentProvider.ts:33-70` |
| Kill-switch `sispagLiveWriteEnabled` reaplicado nos dois serviços de escrita SISPAG | 2/2 (`RemessaService.ts:130-137`, `ConciliacaoRetornoService.ts:107-115`) | 2/2 | ✅ | `grep -c "sispagLiveWriteEnabled" src/backend/domain/service/sispag/{RemessaService,ConciliacaoRetornoService}.ts` |
| Body do `.REM` no request/response logger em caso de erro | Não redigido — o logger só imprime body em `statusCode >= 400`; `conteudo` **não** está em `DEFAULT_SENSITIVE_KEYS` de `redact.ts` | Redigido ou fora do log | ⚠️ (defense-in-depth — ver F-security-2) | `src/backend/index.ts:60-66`; `src/backend/http/redact.ts:11-22` |
| Response da `POST /sispag/lotes/:id/remessa` inclui `conteudo` do `.REM` no JSON | Sim (`RemessaService.ts:205-207` retomada-síncrona e `RemessaService.ts:490` caminho normal) — duplica a superfície do CNAB para além do `GET .../arquivo` | Só o GET dedicado carrega o corpo | ⚠️ | `src/backend/domain/service/sispag/RemessaService.ts:189-208, 481-493` |
| Escapatórias (`PERMITIR_*`) com log auditável em `LogService` | 0/3 — as três chaves só emitem `console.warn`/`console.error`, sem trilha estruturada | 3/3 via `LogService.warn` | ❌ | `src/backend/migrations/BootMigrator.ts:100`; `src/backend/domain/libs/environment/EnvironmentProvider.ts:56`; `src/backend/jobs/validate-retomada-remessa-v1.ts:48` |
| Cobertura do detector de host remoto no `BootMigrator` | 5 provedores (`supabase.{com,co}`, `neon.tech`, `render.com`, `amazonaws.com`, `azure.com`) — não pega Google Cloud SQL (`googleusercontent.com`), PlanetScale (`psdb.cloud`), DigitalOcean (`db.ondigitalocean.com`), Aiven (`aivencloud.com`) | Cobre os provedores plausíveis do time | ⚠️ | `src/backend/migrations/BootMigrator.ts:102` |
| `capture-fixtures-sispag.ts` faz apenas leitura | Só `listGenericPaginated` — nenhum `putGeneric`/`postGeneric` (0 hits para PUT/POST no arquivo) | Só leitura | ✅ | `grep -c "putGeneric\|postGeneric" src/backend/jobs/capture-fixtures-sispag.ts` (=0) |

> ⚠️ **Não medível localmente**: presença de log estruturado (LogService) do momento em que qualquer `PERMITIR_*` foi ativado em produção. Requer inspeção do drain do Render pós-deploy. Recomendação: emitir `LogService.warn({type: SECURITY_OVERRIDE_ENABLED})` no boot quando as chaves estiverem setadas, para o operador conseguir buscar "quem ligou a escapatória, quando".

## 3. Tactics — Cobertura no delta

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Detect Intrusion | Ausente para o delta — 0 aggregate/alerta específico para escrita SISPAG anômala | ❌ | fora do delta |
| Detect Service Denial | `heavyRouteLimiter` nas mutações SISPAG (herdado, não do delta) | ✅ herdado | `src/backend/routes/sispag.ts:322,341,375,407,464` |
| Verify Message Integrity | Idempotency-Key (retomada) — chave derivada do lote impede segundo lote no duplo-clique; `RemessaService.ts:139` | ✅ | `src/backend/domain/service/sispag/RemessaService.ts:139-142` |
| Detect Message Delay | Reaper de execuções presas em `reconciling` publica `BUSINESS_WARN` para remessa E conciliação após N min; mesma consulta em `GET /sispag/execucoes?paradasHaMin=` | ✅ | `src/backend/jobs/reaper-sispag-reconciling.ts:43-77` |
| Identify Actors | `ator(req) = req.user?.sub ?? req.user?.email ?? 'unknown'` propagado para service/ledger | ✅ | `src/backend/routes/sispag.ts:73` |
| Authenticate Actors | `buildAuthMiddleware` (JWT HS256/JWKS) monta `req.user` antes das rotas SISPAG (herdado do bootstrap) | ✅ herdado | `src/backend/http/auth.ts:118-197` |
| Authorize Actors | `requireRole('admin')` em 14/14 rotas de mutação/execução. `GET /sispag/execucoes` (novo) coberto | ✅ | `src/backend/routes/sispag.ts:143..514` |
| Limit Access | Download do `.REM` (CNAB com dado bancário) exige admin + teste; `GET /contas-pagadoras` (fin005) exige admin; response do POST /remessa duplica `conteudo` — ver F-security-2 | ⚠️ parcial | `src/backend/routes/sispag.ts:437-455`; `src/backend/domain/service/sispag/RemessaService.ts:490` |
| Limit Exposure | Kill-switches por-frente (`sispagLiveWriteEnabled`), fail-safe em `production`; `EnvironmentProvider` ignora `CONEXOS_WRITE_ENABLED` em local+PRD; jobs recusam PRD por default | ✅ | `src/backend/domain/libs/environment/EnvironmentProvider.ts:33-70`, `RemessaService.ts:130-137` |
| Encrypt Data | Tráfego Conexos é HTTPS; JWT assinado HS256; secrets em Render env (não no delta) | ✅ herdado | `src/backend/http/auth.ts:191-197` |
| Separate Entities | Ledgers de remessa e conciliação separados (`RemessaExecucaoRepository`, `ConciliacaoExecucaoRepository`); rotas SISPAG separadas de Permutas/Recebimentos | ✅ | `src/backend/domain/repository/sispag/` |
| Change Default Settings | Default de escrita = `dryRun=true` (`RemessaService.ts:132-136`); default do `validate-retomada-remessa-v1` = DRY (`--executar` explícito); default do `seed-hml-vencimento` = leitura (`SEED_WRITE=1` explícito) | ✅ | `src/backend/domain/service/sispag/RemessaService.ts:132-136`; `src/backend/jobs/validate-retomada-remessa-v1.ts:37`; `src/backend/jobs/seed-hml-vencimento.ts:47` |
| Validate Input | Zod nas rotas novas/tocadas (`execucoesSchema`, `conciliarSchema`, corpo da remessa com `confirmarNovoLote` opcional) | ✅ | `src/backend/routes/sispag.ts:394-401, 507-511` |
| Revoke Access | N/A no delta — depende do controle no Supabase, fora do escopo | N/A | — |
| Lock Computer | N/A | N/A | — |
| Inform Actors | Reaper publica warn estruturado + `GET /sispag/execucoes` mostra órfãos na tela | ✅ | `src/backend/jobs/reaper-sispag-reconciling.ts:43-77` |
| Restore | Fluxo de retomada explicito (`sync.etapa === 'concluido'` fecha ledger sem duplicar; `sync.canceladoFlpCod` obriga `confirmarNovoLote=true` na 2ª tentativa) | ✅ | `src/backend/domain/service/sispag/RemessaService.ts:180-215` |
| Audit Trail | Ledgers `remessa_execucao`/`conciliacao_execucao` gravam por chave idempotente; `logService.info/warn` em cada mudança de estado. Ativação de `PERMITIR_*` NÃO é auditada — ver F-security-4 | ⚠️ parcial | `src/backend/domain/service/sispag/RemessaService.ts:145..497` |

## 4. Findings

### F-security-1: fixture redaction test só valida strings — valores numéricos (`titMnyValor`, `pesCod`, `filCod`) podem regredir sem o teste avisar

- **Severidade**: P2
- **Tactic violada**: Limit Access
- **Localização**: `src/backend/domain/interface/sispag/__fixtures__/contrato.test.ts:97-107`
- **Evidência (objetiva)**:
  ```typescript
  it('a fixture está redigida — nenhum valor de string real vazou', () => {
      const linha = carregar(fixture);
      const stringsCruas = Object.entries(linha).filter(
          ([, v]) => typeof v === 'string' && !v.startsWith('<'),
      );
      expect(stringsCruas).toEqual([]);
  });
  ```
  O `capture-fixtures-sispag.ts:redigir` mapeia `number → 0` corretamente hoje (`jobs/capture-fixtures-sispag.ts:50`), mas o teste de contrato não verifica isso — só strings. Um refactor que trocasse `return 0` por `return valor` (para não perder tipo) publicaria `titMnyValor: 12345.67`, `pesCod: 4711` (id do fornecedor no ERP), `filCod: 2` cru no repo e todos os testes continuariam verdes.
- **Impacto técnico**: uma recaptura futura pode commitar dados de fornecedor sem quebrar CI.
- **Impacto de negócio**: publicar id/CNPJ/valor de fornecedor real em repositório é o mesmo defeito que `security-1` corrigiu no CNAB — só que permanente e versionado no histórico do git.
- **Métrica de baseline**: 0/6 fixtures têm assert numérico ("valor numérico ≠ 0 → falha"); 6/6 têm assert de string.

### F-security-2: `POST /sispag/lotes/:id/remessa` devolve o `conteudo` do `.REM` no JSON — duplica a superfície do CNAB e o campo `conteudo` não está em `DEFAULT_SENSITIVE_KEYS`

- **Severidade**: P2
- **Tactic violada**: Limit Access
- **Localização**: `src/backend/domain/service/sispag/RemessaService.ts:205-207, 490`; `src/backend/http/redact.ts:11-22`
- **Evidência (objetiva)**:
  ```typescript
  // RemessaService.ts:490 — caminho normal
  return {
      status: 'gerada', ...,
      ...(arquivo.conteudo !== undefined ? { conteudo: arquivo.conteudo } : {}),
      ...
  };
  // redact.ts:11 — nem "conteudo" nem "cnab" nem "arquivo" estão na lista
  const DEFAULT_SENSITIVE_KEYS = ['password','senha','token','accesstoken',
      'refreshtoken','authorization','secret','api_key','apikey','jwt'];
  ```
  O `GET /sispag/lotes/:id/remessa/arquivo` (endpoint dedicado, com comentário "CNPJ, banco, agência e conta de CADA FORNECEDOR") já retorna o CNAB. O POST duplica isso dentro de JSON. Hoje só é logado no erro (`statusCode >= 400`, `src/backend/index.ts:63`) e o frontend só usa `baixarRemessa()` (`src/frontend/app/sispag/components/LoteCard.tsx:276`) — logo o campo do POST é dead-code do ponto de vista da UI, mas a superfície permanece. Um error path que ecoe `data` (ex.: 500 com `arquivo.conteudo` populado) despeja o CNAB inteiro no drain do Render.
- **Impacto técnico**: dois caminhos autorizados devolvem o mesmo dado sensível — um exercitado, outro fantasma. Refactor de logging que decidir imprimir body em sucesso passa a vazar.
- **Impacto de negócio**: LGPD Art. 6º + LC 105 (sigilo bancário) — dado bancário de fornecedor da Columbia num log público de deploy.
- **Métrica de baseline**: 2 caminhos de retorno do CNAB (POST + GET) para 1 consumo real (GET); 0/1 chave sensível (`conteudo`) presente em `DEFAULT_SENSITIVE_KEYS`.

### F-security-3: `BootMigrator.recusarBancoRemotoEmAmbienteLocal` cobre 5 provedores por regex — Google Cloud SQL, PlanetScale, DigitalOcean, Aiven passam

- **Severidade**: P3
- **Tactic violada**: Limit Exposure
- **Localização**: `src/backend/migrations/BootMigrator.ts:102`
- **Evidência (objetiva)**:
  ```typescript
  const remoto = /(supabase\.(com|co)|neon\.tech|render\.com|amazonaws\.com|azure\.com)/i;
  if (!remoto.test(conn)) return;
  ```
  Um `.env` de dev apontando para `psdb.cloud`, `googleusercontent.com`, `db.ondigitalocean.com` ou `aivencloud.com` recebe DDL do `tsx watch` — o mesmo defeito da `0049` chegando à PRD, só que com o outro host. O time hoje usa Supabase, então o risco é hipotético — mas o guard existe pra dizer "não confio no `.env`", e no dia que alguém migrar o banco para outro provedor o guard silenciosamente para de valer.
- **Impacto técnico**: guard-rail de detecção incompleto passa a ser inefetivo se a stack de dados mudar sem alguém lembrar de mexer no regex.
- **Impacto de negócio**: baixa hoje; alta quando o time decidir sair de Supabase.
- **Métrica de baseline**: 5 provedores cobertos, ≥4 provedores plausíveis não cobertos.

### F-security-4: ativação de `PERMITIR_MIGRACAO_REMOTA` / `PERMITIR_ESCRITA_PRD_LOCAL` / `PERMITIR_PRD` só emite `console.warn` — sem trilha auditável em `LogService`

- **Severidade**: P3
- **Tactic violada**: Audit Trail
- **Localização**: `src/backend/migrations/BootMigrator.ts:100`; `src/backend/domain/libs/environment/EnvironmentProvider.ts:56-70`; `src/backend/jobs/validate-retomada-remessa-v1.ts:48-51`
- **Evidência (objetiva)**:
  ```
  grep -n "PERMITIR_" src/backend/**/*.ts | grep -v test
  # 3 hits — nenhum chama logService.warn/info com type estruturado
  ```
  As três escapatórias são deliberadamente "digitadas na hora" (regra do runbook `rotacao-segredos.md §4`), mas se alguém deixá-las morar num `.env` ou setar em produção via dashboard do Render, nada distinguível aparece na trilha de auditoria do LogService. Descobrir "quem ligou o override, quando" exige `grep` no stdout do drain, sem correlação com `request_id`.
- **Impacto técnico**: forense pós-incidente depende só do stdout do container.
- **Impacto de negócio**: para uma auditoria que pergunte "quem autorizou a escrita PRD daquela terça?", a resposta é "provavelmente o Yuri, olhando no log do dia" em vez de um registro estruturado.
- **Métrica de baseline**: 0/3 escapatórias emitem `logService.warn` estruturado; 3/3 emitem apenas `console.warn`/`console.error`.

## 5. Cards Kanban

### [security-1] Fechar o teste de redação de fixture para valores NUMÉRICOS

- **Problema**
  > O `contrato.test.ts` guarda a redação exigindo que toda string comece com `<`, mas não olha para valores numéricos. Hoje `capture-fixtures-sispag.ts:redigir` transforma `number → 0`; o dia que alguém "melhorar" isso para preservar tipo, uma recaptura publicaria `titMnyValor`, `pesCod` e `filCod` reais de fornecedor no repo — sem CI vermelho.

- **Melhoria Proposta**
  > Estender o teste "a fixture está redigida" para asserção adicional: todo valor numérico da linha deve ser exatamente `0` (o marcador que o `redigir` produz). Ajuste em `src/backend/domain/interface/sispag/__fixtures__/contrato.test.ts`. Tactic Bass: Limit Access.

- **Resultado Esperado**
  > O teste falha se uma recaptura vazar qualquer número não-zero. Métrica: cobertura de asserção da redação = strings (100%, já) + numbers (0% → 100%).

- **Tactic alvo**: Limit Access
- **Severidade**: P2
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-security-1
- **Métricas de sucesso**:
  - Asserções por fixture: 3 (chaves + ausentes + strings) → 4 (adicionar numbers)
  - Cobertura de detecção de vazamento numérico: 0% → 100%
- **Risco de não fazer**: em 6 meses, alguém refactora `redigir` "para não perder tipo", capturam-se fixtures novas com valores reais e nada avisa até um auditor externo abrir o repo.
- **Dependências**: nenhuma

### [security-2] Não retornar `conteudo` do `.REM` no POST /remessa — ou adicionar `conteudo`/`cnab` à `DEFAULT_SENSITIVE_KEYS`

- **Problema**
  > O `POST /sispag/lotes/:id/remessa` devolve o CNAB inteiro dentro de `conteudo` no JSON de sucesso, duplicando o `GET /lotes/:id/remessa/arquivo` (que é o único caminho que a UI usa). O logger só imprime body em erro, mas `conteudo` não está na lista de redação — qualquer refactor futuro que log-e response no caminho feliz despeja CNPJ/banco/agência/conta de cada fornecedor no drain do Render.

- **Melhoria Proposta**
  > Duas opções cumulativas: (a) tirar o campo `conteudo` do payload de retorno em `RemessaService.gerarRemessa` (linhas 205-207 e 490) — a UI já baixa via GET dedicado; (b) adicionar `conteudo`, `cnab`, `arquivo`, `gabLngDados` a `DEFAULT_SENSITIVE_KEYS` em `src/backend/http/redact.ts` como piso de defesa-em-profundidade. Tactic Bass: Limit Access.

- **Resultado Esperado**
  > Só o `GET /lotes/:id/remessa/arquivo` (endpoint dedicado, admin-gated) carrega o CNAB. Métrica: superfície de retorno do CNAB = 2 endpoints → 1; chaves sensíveis relacionadas ao CNAB em `DEFAULT_SENSITIVE_KEYS` = 0 → ≥3.

- **Tactic alvo**: Limit Access
- **Severidade**: P2
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-security-2
- **Métricas de sucesso**:
  - Endpoints que devolvem `conteudo` do CNAB: 2 → 1
  - Chaves sensíveis específicas de CNAB redigidas em log: 0 → 3
- **Risco de não fazer**: um dia alguém liga log de response no caminho feliz para debugar um pipeline (ou já é feito em observabilidade externa) e o CNAB de todo fornecedor da Columbia entra no destino de logs.
- **Dependências**: nenhuma

### [security-3] Ampliar o detector de host remoto do `BootMigrator` (Google Cloud SQL, PlanetScale, DigitalOcean, Aiven)

- **Problema**
  > O guard que impede `tsx watch` de aplicar DDL em banco remoto casa exatamente 5 provedores (Supabase, Neon, Render, AWS, Azure). Se a Kavex migrar Postgres para PlanetScale, Google Cloud SQL, DigitalOcean ou Aiven amanhã, a mesma janela que causou a `0049` reabre em silêncio.

- **Melhoria Proposta**
  > Inverter a lógica: por default, tratar como remoto TUDO que não bata em `localhost`/`127.0.0.1`/socket-unix, e liberar `PERMITIR_MIGRACAO_REMOTA=1` para exceção. Alternativa mais conservadora: acrescentar `psdb\.cloud`, `googleusercontent\.com`, `db\.ondigitalocean\.com`, `aivencloud\.com` ao regex. Tactic Bass: Limit Exposure.

- **Resultado Esperado**
  > Nenhum provedor plausível passa despercebido. Métrica: falso-negativo do detector = ≥4 provedores → 0.

- **Tactic alvo**: Limit Exposure
- **Severidade**: P3
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-security-3
- **Métricas de sucesso**:
  - Falso-negativos do regex remoto: 4 → 0
  - Testes de `BootMigrator` cobrindo novos provedores: +N
- **Risco de não fazer**: no dia da migração de banco, o guard silenciosamente para de proteger e ninguém percebe até a próxima `0049`.
- **Dependências**: nenhuma

### [security-4] Auditar (via `LogService.warn` estruturado) toda ativação de `PERMITIR_*`

- **Problema**
  > As três escapatórias (`PERMITIR_MIGRACAO_REMOTA`, `PERMITIR_ESCRITA_PRD_LOCAL`, `PERMITIR_PRD`) só emitem `console.warn`. Se alguém setar uma delas em produção (por engano no dashboard do Render ou por um `.env` local durante um go-live assistido), o rastro é só stdout — sem correlação com `request_id`, sem `type` que permita alertar.

- **Melhoria Proposta**
  > Emitir `logService.warn({ type: LOG_TYPE.SECURITY_OVERRIDE_ENABLED, message: '<chave> ativa', data: { key, environment, host } })` no ponto em que cada uma é lida. Considerar um `LOG_TYPE.SECURITY_OVERRIDE_ENABLED` novo. Tactic Bass: Audit Trail.

- **Resultado Esperado**
  > Fica documentado no LogService (portanto no drain estruturado, com timestamp e agregável) quando e onde cada escapatória rodou. Métrica: 3/3 escapatórias auditadas → 3/3.

- **Tactic alvo**: Audit Trail
- **Severidade**: P3
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-security-4
- **Métricas de sucesso**:
  - Escapatórias auditadas em LogService: 0/3 → 3/3
  - Presença de `LOG_TYPE.SECURITY_OVERRIDE_ENABLED`: ausente → presente
- **Risco de não fazer**: numa auditoria pós-incidente ("quem ligou a escrita PRD naquela terça?"), a resposta continua sendo `grep -R PERMITIR /var/log` no dia certo, sem correlação.
- **Dependências**: nenhuma

## 6. Notas do agente

- **Escopo**: só o delta do `/feature-tweak sispag` (retomada). Não reabri a rotação dos 4 segredos de PRD (runbook `rotacao-segredos.md`) nem `app_user.role DEFAULT 'admin'` — ambos declarados como já-conhecidos no prompt.
- **Nada de P0/P1 encontrado no delta.** As guardas novas (BootMigrator + EnvironmentProvider + jobs) são densas, têm testes dedicados e vieram com escapatórias documentadas — bom trabalho de defesa-em-profundidade. As 4 findings são P2/P3 (defense-in-depth ou hardening).
- **Cross-QA**:
  - `security-4` (audit trail das escapatórias) sobrepõe **Fault Tolerance** (`Audit Trail`) — o consolidator pode fundir com achado equivalente.
  - `security-2` (CNAB duplicado no POST /remessa) sobrepõe **Modifiability**: retornar campo dead-code no payload é ruído estrutural.
  - `security-3` (detector `BootMigrator`) sobrepõe **Deployability** (kill-switch de deploy).
  - Todas as guardas de `--executar`/`SEED_WRITE=1` e `sispagLiveWriteEnabled` sobrepõem **Availability** (limit exposure / blast radius).
- **Métrica não coletada**: pen-test contra `/sispag/execucoes` com JWT válido de outro tenant — fora do escopo local; requer ambiente de PRD e permissão explícita.
