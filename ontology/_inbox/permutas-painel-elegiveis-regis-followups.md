# Regis-Review Follow-ups — permutas-painel-elegiveis

**Run:** `2026-06-17-2340` · **Fonte:** `docs/regis-review/2026-06-17-2340/{REPORT,KANBAN}.md`
**Regra do pipeline:** P0 re-entram no loop (remediados nesta feature); **P1/P2/P3 NÃO** — viram tickets a partir daqui.

## P1 — Alto (18)
Ver `KANBAN.md` §P1. Destaques pré-requisitos da **Fatia 2** (write `fin010`):
- `rbac-roles-permutas` (sec-1) — RBAC por perfil antes de qualquer rota de escrita.
- `pii-redact-logger` (sec-4) — logger global imprime body cru (vetor LGPD quando SISPAG/valores entrarem).
- `probe-placeholder-guard` (integ-4/mod-6/ft-7) — fail-loud se probe provisório chegar em prd.
  **Nota (2026-06-18):** a chave `adiantamento` foi **resolvida** pelo probe de rede (`docVldTipoAdto=1`,
  FinDocCab) — o placeholder anterior (`adiantamento#EQ:'S'`) era um BUG (HTTP 500). O guard de
  **runtime** ainda é **desejável** para futuros probes (ex.: `gate-3-pago-via-detail`).
- `com308-zod-boundary` (integ-1/sec-3) — aplicar `com308RowSchema` (hoje declarado, não usado).
- `status-partial-*` (avail-4/ft-4) — semântica `partial` real (capHit + falha de filial).
- `health-ready-deep` / `fail-fast-bootstrap-prd` / `down-migration-convention` — fechar o anel de deploy.
- `clock-provider` (test-3) — determinismo de aging/duração.
- `tenant-constants-ssm` (mod-3) — pré-requisito SaaSo 2º cliente.

## Novos follow-ups de domínio (descobertos pós-run)

- **`gate-3-pago-via-detail` (P1, descoberto no probe de rede 2026-06-18).** Confirmar a fonte wire
  do status **TOTALMENTE PAGO** (Gate 3) **antes** de a eleição produzir candidatas elegíveis. Nos
  **410 adiantamentos reais** (dev tenant Columbia, `filCod=2`), o `com298/list` traz
  `mnyTitAberto=null` / `mnyTitPago=null` → `isPago=false` p/ todos → Gate 3 bloquearia tudo. Fonte
  provável = **endpoint de detalhe** (modal financeiro), igual ao `mnyTitPermutar` (já hidratado via
  `getMnyTitPermutar` detail). **Bloqueante** para a feature produzir ALGUMA candidata elegível; NÃO
  foi escopo do probe. Casa com `probe-placeholder-guard` (P1) e `fixtures-conexos-wire` (P2).

## P2 — Médio (14)
Ver `KANBAN.md` §P2. Notáveis: `gateway-permutas-conexos` (anti-corruption), `fixtures-conexos-wire`
(casa com o probe P0-4 do Yuri), `multiplas-invoices-decidir` (resolver `MOTIVO_BLOQUEIO.MULTIPLAS_INVOICES`
órfão), `paginacao-painel`, `staging-environment`, `reaper-reconciliacao` (passivo da Fatia 2).

## P3 — Baixo (6)
Ver `KANBAN.md` §P3: ADR cutover do shim Conexos, readiness probe Conexos, alertamento FLOW_ERROR, etc.

## Cross-link com gaps de domínio ainda abertos
- **P0-4** (campo wire da data-base `imp019`/`imp223`) → ✅ **RESOLVIDO** (probe de rede 2026-06-18):
  `cdiDtaCi` (D.I) / `dioDtaDesembaraco` (DUIMP). Não mais aberto. `fixtures-conexos-wire` (P2) deve
  fixar esses campos reais.
- **`adiantamento` filter key** → ✅ **RESOLVIDO** (probe 2026-06-18): `docVldTipoAdto=1` (FinDocCab).
  O guard de runtime (`probe-placeholder-guard`, P1) segue desejável p/ futuros probes.
- **`gate-3-pago-via-detail`** → ✅ **RESOLVIDO** (2026-06-18, feature-tweak impl-only). Gate 3 agora
  hidrata `pago` do DETALHE (`getDetalheTitulos`, `mnyTitAberto === 0`) em vez da row do `com298/list`
  (que vinha NULL→false p/ todas). Os P1 residuais de robustez dessa fatia estão na nova seção abaixo.
- Build-probe fonte `com308` — casa com `com308-zod-boundary` (P1).

---

## Run `2026-06-18-1441` — follow-ups de gate-3-pago-via-detail (impl-only, scoped --quick)

**Fonte:** `docs/regis-review/2026-06-18-1441/{integrability,fault-tolerance,modifiability,testability}.md`
**Gate:** **0 P0 introduzidos pelo delta** → sem re-loop. P1/P2/P3 viram tickets a partir daqui (não implementados nesta fatia).
**Scorecard (scoped):** Integrability 8 · Fault-Tolerance 8.5 · Modifiability 8 · Testability 9.
(Availability/Deployability/Performance/Security não rodaram — delta read-only, sem infra/auth/SQL novo.)

### P1 — Alto
- **[integrability-1 / fault-tolerance-1] Zod no boundary do detalhe (S).** `mapDetalheTitulos`
  (`ConexosClient.ts:~902`) consome `Record<string, unknown>` sem schema. Drift de `mnyTitAberto`
  (rename/tipo) → `pago=undefined` → `false` → reprovação em massa do Gate 3, **silenciosa**. Casa com
  `com308-zod-boundary` (P1) já fichado. Adicionar `com298DetalheSchema` + log de coerção-falha.
- **[integrability-2] Fixtures reais do detalhe (S).** Os 5 cenários de `getDetalheTitulos` usam
  literais inline; o payload real (sonda 2026-06-18, docs 26471/24166, filCod=2) foi probe throwaway.
  Comitar snapshot em `__fixtures__/com298-detalhe-*.json`. Consolidar com `fixtures-conexos-wire` (P2).
- **[fault-tolerance-2] Contador run-level de DETAIL_INDISPONIVEL (S).** Há `BUSINESS_WARN` por
  candidata mas nenhum agregado; regime degradado prolongado fica invisível. Somar
  `detailIndisponivelCount` no resumo `FLOW_COMPLETE`. Tactic: Condition Monitoring.
- **[testability-1] Observar divergência list-pago vs detail-pago (S).** O caso-bug literal (list=true,
  detail=false) não asserta `calls`; a divergência é silenciosa. Emitir/assertar log estruturado
  `divergencia: 'pago_list_vs_detail'` (insumo p/ futuramente defender remoção do fan-out extra).
- **[testability-2] Assertar `valorPermutar` na candidata (S).** `buildCandidata` hidrata DOIS campos
  do detalhe; os três testes novos de service fixam só `pago`. Adicionar
  `expect(...adiantamento.valorPermutar).toBe(<detail value>)` nos três casos.

### P3 — Baixo
- **[modifiability-1] Comentário stale (trivial).** `EleicaoPermutasService.test.ts:~441` ainda cita
  `getMnyTitPermutar`. Atualizar para `getDetalheTitulos`. Cosmético; não bloqueia.

## Novos follow-ups de domínio (varredura de 408 detalhes, 2026-06-18)

Fonte: probe throwaway `probe-permutar-formula.ts` (deletado) — varreu os 411 PROFORMA reais via detalhe
`com298/{docCod}`. Identidade `mnyTitValor = mnyTitPago + mnyTitAberto` = **universal (0/408)**.
Buckets: 70 NÃO PAGO · 332 TOTALMENTE PAGO · 6 PARCIALMENTE PAGO · 42 com permuta · 3 erros HTTP 500.

- **[RESOLVIDO 2026-09-14 — ADR-0046: Gate 3 = aberto ≤ R$1,00, Gate 2 = saldo > R$1,00, só p/ o adiantamento] `residual-pago-centavos` (P2 — decisão de domínio, c/ analistas).** Doc **8721** tem `aberto=0,02`
  em título de `~R$20.373.009` (`permutar=0`). Gate 3 estrito (`=== 0`) o **BLOQUEIA**. Confirmar com os
  analistas Columbia: (a) resíduo de centavos conta como TOTALMENTE PAGO? (b) qual o teto de "residual"
  (epsilon)? Se sim → vira mudança de regra (ADR + OntologyCurator: `pago ⟺ mnyTitAberto < ε`).
  Yuri decidiu em 2026-06-18: **manter estrito por ora**, tratar 8721 como caso anômalo a confirmar.
- **`vc-permuta-parcial` (Fatia 2 — pré-requisito de escrita).** Docs **3334** (pago=462.227,29 /
  permutar=168.052,99) e **11808** (pago=193.460,42 / permutar=1.672,99) são **permutas parciais**:
  totalmente pagos (`aberto=0` → elegíveis no Gate 3) mas que usam só valor **parcial** na baixa/borderô.
  A baixa em `fin010` **deve** usar o `mnyTitPermutar` LITERAL (nunca reconstruir de pago/permuta — a
  aproximação `pago−permuta` quebra nesses casos). **⚠️ A variação cambial deve ser calculada sobre o
  valor PARCIAL efetivamente permutado, não sobre o valor integral do título** — revisar
  `computeVariacao` / `VariacaoCambialService` antes da Fatia 2.

---

## Run `2026-06-18-2039` — Fase B (modelo relacional + ingestão diária + Leitura/Processar)

**Fonte:** `docs/regis-review/2026-06-18-2039/{REPORT,KANBAN}.md` (quick, escopo Fase B).
**Overall score:** 6.9/10. **Scorecard:** Availability 7 · Deployability 6 · Integrability 6.5 ·
Modifiability 6.5 · Performance 6 · Fault-Tolerance 7.5 · Security 7.5 · Testability 7.5.
48 cards (2 "P0" pelo consolidator · 22 P1 · 15 P2 · 9 P3).

### Veredito do gate (P0 vs. follow-up)

Os **2 P0** promovidos pelo consolidator são ambos sobre o **cron de ingestão**:
`availability-1` (agendar o cron + heartbeat) e `availability-2` (`Idempotency-Key` na ingestão, só
relevante depois do cron ligado). **Decisão (AutoLoopRunner): NÃO re-entram no loop desta feature** —
a configuração do scheduler está **explicitamente fora de escopo** do plano aprovado
(`compiled-foraging-reef.md` §7 + prompt: *"Job cron-ready… Linha de cron documentada no header (não
configurar cron)"*). Não há `infra/`/Terraform neste repo. São **follow-ups operacionais** a ativar
quando o scheduler/infra for endereçado. ⇒ **Nenhum P0 in-scope** abriu para remediação imediata; a
Fase B entregue está verde (typecheck/lint/test/PatternGuardian/DesignSystemReviewer).

### "P0" (operacional — gated em ativar o cron, fora do escopo)
- `availability-1` — Agendar `ingest-permutas` (Render Cron / GH Actions) + heartbeat/last_success_at.
- `availability-2` — `Idempotency-Key` na ingestão (entrar junto de `availability-1`).

### P1 — Alto
- `availability-3` — Frontend: distinguir "indisponível" de "vazio" no fallback de `/gestao`.
- `availability-4` — Compartilhar advisory lock entre ingest e eleicao (evitar fan-out Conexos paralelo).
- `availability-5` — Timeout explícito nas chamadas Conexos antes do RetryExecutor.
- `deployability-1` — Advisory lock no MigrationRunner + UMA origem de migrações (CI × boot).
- `deployability-2` — Agendar o cron em produção (espelha `availability-1`).
- `fault-tolerance-1` — Unir TX relacional + snapshot na MESMA transação (ou compensação documentada);
  hoje `snapshotRepository.persistRun` é TX2 após TX1 commitar.
- `fault-tolerance-2` — `UNIQUE(flow_id, kind)` em `permuta_eleicao_run` (migration 0005).
- `fault-tolerance-4` — Job de reconciliação relacional × snapshot + detector de duplo-header.
- `integrability-1` — Contrato `GestaoPermutasResponse` compartilhado backend↔frontend (Zod / contract test).
- `integrability-2` — `valorMoedaNegociada` consistente OU `null` para bloqueadas (ver "campos undefined").
- `integrability-3` — Parse Zod no consumer de `/gestao` + flag de fallback explícito.
- `modifiability-1` — Extrair `chunked<T>` + `UPSERT_CHUNK` p/ lib compartilhada (Relational × Snapshot).
- `modifiability-2` — Helper `bulkUpsert` declarativo (4 upsert-chunk → specs).
- `modifiability-3` — Dividir `PermutaRelationalRepository` (512 LOC) em writes × reads.
- `performance-1` — Paginar `/gestao` + `LIMIT` nas reads.
- `performance-2` — `TRUNCATE`/recompute incremental no lugar de `DELETE FROM permuta_casamento`.
- `performance-3` — `statement_timeout`/`lock_timeout`/`idle_in_transaction_session_timeout` no pool.
- `performance-4` — Índice em `last_ingest_run_id` p/ acelerar `markStale`.
- `security-1` — RBAC/tenant no `POST /processar` + `tenant_id` em `permuta_processamento` (P0 retroativo no multi-tenant).
- `testability-1` — Teste de unidade para `jobs/ingest-permutas.ts`.
- `testability-2` — Suite de integração SQL p/ `PermutaRelationalRepository` (Postgres efêmero) — valida 0003/0004.
- `testability-3` — `ClockProvider` injetável (zerar `new Date()` — auditoria O6 determinística).

### P2 — Médio
- `availability-6` (retry tx transitório PG) · `availability-7` (stale-ratio/idade do run) ·
  `deployability-3` (runbook rollback) · **`deployability-4` (bump v0.2.0→v0.3.0 + CHANGELOG — NÃO
  executado nesta fatia, instrução "NÃO bump")** · `deployability-5` (smoke mandatório) ·
  `fault-tolerance-3` (logar header de erro engolido) · `integrability-4` (Zod em
  `mapDocPagar`/`listTitulosAPagar`) · `integrability-6` (fixture por env-flag + limpar PII) ·
  `modifiability-4` (`pickDefined`) · `modifiability-6` (split `EleicaoPermutasService` +
  `PermutaFanoutService`) · `performance-5` (mesmo PoolClient lock+tx) · `performance-7` (cache HTTP
  por `last_ingest_run_id`) · `security-2` (validar `:docCod` Zod+CHECK) · `security-3` (audit
  append-only `permuta_processamento_audit`) · `testability-4` (`IdProvider`) · `testability-5`
  (subir coverageThreshold) · `testability-6` (fixtures Permutas + `supertest`).

### P3 — Baixo
- `deployability-6` (feature flag) · `integrability-5` (`httpJson()`) · `modifiability-5`
  (externalizar `INGEST_LOCK_KEY`/chunk-size) · `performance-6` (`markStale` em CTE única) ·
  `security-4` (`Idempotency-Key` no `/processar`) · `security-5` (redaction PII no log) ·
  `testability-7` (assert audit-log em 401/422).

### Campos Conexos que ficaram undefined (follow-up de dados, não bug)

Conforme a instrução do plano ("se um campo não estiver trivialmente disponível sem fan-out extra,
deixe opcional/undefined e registre como follow-up"):

1. **`valorMoedaNegociada`** (Adiantamento e Invoice) — só hidratado para candidatas **elegíveis com
   invoice casada**, via o fan-out `listTitulosAPagar` (`titMnyValorMneg`) que já roda em
   `computeVariacao`. Para adiantamentos **bloqueados** e invoices não-casadas fica `undefined` (a tela
   cai em `0`). Popular para todos exigiria fan-out `com308` extra por documento (custoso) → ver
   `integrability-2`.
2. **`referencia`** — `docEspNumero` (fallback `priEspRefcliente`) do payload default do `com298/list`.
   Funciona; quando ausente a tela cai em `docCod`. Sem fan-out extra (OK).
3. **`exportador`** — `dpeNomPessoa` (já existente). OK.

Nenhum bloqueia a feature: a tela tem defaults e o fixture permanece como fallback de segurança.
