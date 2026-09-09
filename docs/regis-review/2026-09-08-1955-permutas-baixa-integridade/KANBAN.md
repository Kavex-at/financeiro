---
type: regis-review-kanban
run_id: 2026-09-08-1955-permutas-baixa-integridade
generated_at: 2026-09-08T22:45:00-03:00
total: 27
counts: { p0: 0, p1: 7, p2: 10, p3: 10 }
scope: DELTA-only (commit 8b18686)
---

# Kanban — financeiro — 2026-09-08-1955-permutas-baixa-integridade

> Importável para o Kanban do time. Cada card abaixo já vem com Problema / Melhoria Proposta /
> Resultado Esperado copiados verbatim das 8 seções QA.
>
> Ordem: **P0 → P1 → P2 → P3**, e dentro de cada prioridade **S → M → L → XL**.
>
> Notas de duplicação (ver §3 do REPORT.md):
> - `availability-2` (P1) e `fault-tolerance-1` (P1) são a mesma entrega física — o reaper de
>   `parcial`. Entregar em um único PR.
> - `deployability-1` (P1) e `fault-tolerance-2` (P1) são a mesma remediação — guard + runbook
>   para rollback com estado `parcial` no banco. Entregar em um único PR.
> - `availability-1` (P1) e `performance-3` (P2, parte A) são o mesmo eixo — bump `poolMax`.
>   O consolidator resolveu a divergência de severidade em favor de P1 (§ R-3 do REPORT.md).

---

## P0 — Crítico

_Nenhum. Zero P0 no delta — gate PASSA._

---

## P1 — Alto

### [fault-tolerance-1] Reaper/detector proativo de execuções `parcial` — paridade com SISPAG e defesa contra o novo silêncio

**QA**: Fault Tolerance
**Tactic alvo**: Condition Monitoring (Bass) + Human-in-the-Loop / MTTR (autoral)
**Esforço**: S (≤ 1 d) — copiar shape do SISPAG.
**Findings**: F-fault-tolerance-4

**Problema**
> O terminal `parcial` (ADR-0043) grava fielmente o que aconteceu — baixa confirmada, resíduo por re-alocar — mas depende **inteiramente** de detecção humana: log `BUSINESS_WARN` (para quem lê logs), coluna `valor_residual_usd` positiva (sem query agregada), badge `parcial-aguardando-finalizacao` (visível só quando a analista abre a tela de Borderôs). SISPAG resolveu o problema idêntico com `RemessaExecucaoRepository.listReconcilingParadas` (`:124`) + `ConciliacaoExecucaoRepository.listReconcilingParadas` (`:54`) + `SispagPainelService:376-377` + `reaper-sispag-reconciling.ts` (cron 15 min). Sem o par para permutas, `parcial` vira o novo silêncio que a própria ADR nomeia como risco.

**Melhoria Proposta**
> (1) Adicionar `PermutaExecucaoRepository.listParcialPendentes(limit)` — `WHERE status='parcial' AND valor_residual_usd > 0 ORDER BY atualizado_em DESC`. (2) Expor `GET /permutas/execucoes?status=parcial` (`requireRole('admin')` como no SISPAG). (3) Publicar contador no painel operacional (`sispag`-style card com `parciais_pendentes` + `soma_residual_usd`). (4) Job `reaper-permutas-parcial.ts` que roda por hora, escreve no `job_execucao` (`data: {parciaisPendentes: N, agingMedio: dias}`) e emite `BUSINESS_WARN` para pares com > 24 h em `parcial` (não age — só publica; forward recovery humano).

**Resultado Esperado**
> Toda execução `parcial` com > 1 h de idade aparece na trilha de operação em ≤ 1 h após o fato. Latência de detecção (t_reap - t_atualizado_em) mediana ≤ 60 min. Contador `parciais_pendentes` visível no painel.

**Métricas de sucesso**
- `listParcialPendentes` no repo: ausente → presente + teste
- Endpoint `GET /permutas/execucoes?status=parcial`: ausente → presente
- Reapers de permuta: 0 → 1 (paridade com SISPAG)
- Latência de detecção `parcial`: N/A → ≤ 60 min p50

**Risco de não fazer**
> `parcial` acumula silenciosamente; a KPI de "R$ baixado" mente sobre o "R$ alocado" cronicamente; o resíduo médio esperado (20-40 % de R$ 280 k) fica invisível até auditoria manual.

**Dependências**: nenhuma.

---

### [fault-tolerance-2] Runbook + guard de rollback para o delta `parcial` — evitar dupla-baixa por retrocesso

**QA**: Fault Tolerance
**Tactic alvo**: Rollback (Bass) + Sanity Checking (probe boot)
**Esforço**: S (≤ 1 d) — runbook + probe boot-time simples.
**Findings**: F-fault-tolerance-5

**Problema**
> A migration 0054 amplia o CHECK de `permuta_alocacao_execucao.status` para aceitar `'parcial'` e o código passa a gravar esse valor. Reverter só o código (rollback via `git revert 8b18686` ou tag `v0.34.0`) mantendo a migration deixa linhas `parcial` no banco que a versão antiga **regride para `reconciling` no próximo `beginExecution`** (CASE antiga só preserva `settled`), habilitando um segundo `criarBordero` + `gravarBaixaPermuta` — a mesma dupla-baixa que R-1 fechou pela porta da frente. É baixa probabilidade (rollback é evento raro), alto impacto (R$ 280 k médios por par).

**Melhoria Proposta**
> (a) Documentar `docs/runbook/rollback-permutas-parcial.md` explicitando: "revert do commit `8b18686` **exige** SQL prévio `UPDATE permuta_alocacao_execucao SET status='settled' WHERE status='parcial'` (perde-se `valor_residual_usd`, aceitável dado que o par `parcial` retornaria a ser re-lançado num relançamento humano) OU rollback da migration 0054 numa migration nova (`0055_permuta_execucao_parcial_rollback.sql`)". (b) Alternativa defensiva no código: incluir uma cláusula `--- version-tag ---` na 0054 e uma probe boot-time que checa se o CHECK aceita `'parcial'` mas o código não conhece a string (mismatch → refuse to boot, fail-closed). (c) Marcar a ADR-0043 como **forward-only** no header.

**Resultado Esperado**
> Rollback documentado como operação com pré-condição SQL. 0 caminhos silenciosos para regressão `parcial → reconciling`.

**Métricas de sucesso**
- Runbook `rollback-permutas-parcial.md`: ausente → presente
- Probe boot-time (opcional mas defensável): ausente → presente, com teste
- ADR-0043 header: sem marca → marcada como `forward-only`

**Risco de não fazer**
> Um único rollback mal orquestrado insere dupla-baixa em N pares parciais — a mesma escala do dano que R-1 acabou de eliminar. É a via traseira.

**Dependências**: nenhuma.

---

### [availability-2] Reaper/staleness proativo sobre `permuta_alocacao_execucao WHERE status='parcial'`

**QA**: Availability
**Tactic alvo**: Monitor / Condition Monitoring
**Esforço**: S (o `reaper-sispag-reconciling.ts` é template pronto)
**Findings**: F-availability-2

> **Nota**: mesma entrega física do `fault-tolerance-1`. Entregar em um PR único; mantido como
> card separado só para trilha por QA.

**Problema**
> `parcial` é terminal e depende de humano re-alocar o resíduo. O único sinal ativo é o badge FE (`frontend/app/permutas/components/ui.tsx:135`) — se a analista não olha o painel, o dinheiro do adto fica parcialmente travado sem que ninguém saiba. Único reaper existente cobre SISPAG (`jobs/reaper-sispag-reconciling.ts:13`); `detect-staleness.ts` não cita permuta. I-Recon-7 (c) já é gap conhecido; aqui ele é impacto de disponibilidade operacional.

**Melhoria Proposta**
> Criar `jobs/reaper-permuta-parcial.ts` no molde do `reaper-sispag-reconciling.ts`: cron a cada 15 min via GitHub Actions, `SELECT ... FROM permuta_alocacao_execucao WHERE status='parcial' AND age(now() - atualizado_em) > interval '1 hour'`, emitir `BUSINESS_WARN` com `adiantamentoDocCod`, `borCod`, `valorResidualUsd`, `atualizado_em`. Estender `detect-staleness.ts` para incluir a categoria. Bass **Monitor / Condition Monitoring**.

**Resultado Esperado**
> 0 execuções `parcial` com idade > 24 h invisíveis: cada uma dispara pelo menos um `BUSINESS_WARN` por hora após 1h. Painel operacional agrega contagem `AGE(parcial)` por faixa (< 1h, 1–24h, > 24h).

**Métricas de sucesso**
- Reapers cobrindo `permuta_alocacao_execucao`: 0 → 1
- WARNs proativos com `age > 1h`: 0 → cobertura por hora
- Idade mediana das linhas `parcial` que sobreviveram > 24h: não medido → alerta explícito

**Risco de não fazer**
> Em 6 meses, saldo de adto travado em `parcial` sem que ninguém saiba — a mesma fricção que a Frente III tem com anexos GED, mas em cima de dinheiro.

**Dependências**: `.github/workflows/reaper-permuta.yml` (novo).

---

### [deployability-1] Documentar (e implementar guard) para rollback de código sobre linhas `parcial` persistidas

**QA**: Deployability
**Tactic alvo**: Rollback
**Esforço**: S (runbook) + S (guard) = ≤ 1d combinado
**Findings**: F-deployability-1, F-deployability-4

> **Nota**: mesma remediação do `fault-tolerance-2`, vista pelo eixo do deploy. Entregar em um
> PR único.

**Problema**
> O código antigo em `main`@`47c48f8` não conhece o valor `parcial` do union e seu `beginExecution` só preserva `= 'settled'`. Se este commit for revertido enquanto houver linhas `parcial` já gravadas, a próxima execução da rota reabre a linha para `reconciling`, `alreadySettled=false`, e o serviço tenta re-POSTar a baixa no `fin010` — que é irreversível por nós. Risco concentrado na janela imediatamente após a primeira baixa parcial em produção.

**Melhoria Proposta**
> Adicionar seção "Rollback do código quando já houver linhas `parcial`" no `docs/runbooks/fin010-write-cutover.md`, com passos numerados: (a) `CONEXOS_WRITE_ENABLED=false` PRIMEIRO; (b) SQL para marcar `parcial` como `settled` no banco após auditar cada linha contra o ERP (o `bxa_cod_seq` já está preenchido — a baixa existe); (c) só então reverter o commit. Complementar: no código, considerar guard defensivo — antes de re-abrir uma execução, comparar `bxa_cod_seq` do banco com o ERP e abortar se houver baixa registrada mesmo em status não-terminal (barra o cenário via dado, não via documento). Tactic Bass: **Rollback** com foco em backward-compatibility ativa.

**Resultado Esperado**
> Runbook cobre code rollback com estado novo persistido; opcionalmente, `PermutaExecucaoRepository.beginExecution` recusa reabrir linha com `bxa_cod_seq IS NOT NULL` (0 linhas parcial → estado atual do banco / delta ainda não deployado; assim que a primeira parcial existir, o cenário estará coberto por procedimento).

**Métricas de sucesso**
- Parágrafos do runbook cobrindo code-rollback: 0 → 1 (passos numerados)
- Guard no repository: ausente → presente (teste `Promise.all([reconciliar(A), revert+reconciliar(A)])` — via mock — recebe 409/abort)

**Risco de não fazer**
> Primeira janela de rollback pós-`parcial` pode duplicar uma baixa no ERP (irreversível por nós; estorno manual pela Columbia). R$ médio por baixa em Permutas hoje: R$ 280.775 (137 baixas / R$ 38,46M).

**Dependências**: nenhuma — depende só do delta atual.

---

### [availability-1] Elevar `poolMaxConnections` e instrumentar retenção do lock

**QA**: Availability
**Tactic alvo**: Reconfiguration / Condition Monitoring
**Esforço**: S (bump de constante + logs) + M (instrumentação e leitura de p95 em 2 semanas)
**Findings**: F-availability-1, F-availability-3

**Problema**
> O advisory lock por adiantamento (delta deste tweak) retém um cliente dedicado do pool durante todo o handshake com o Conexos (`ReconciliacaoPermutaService.ts:120-153`, `PostgreeDatabaseClient.ts:137-158`). Com `poolMaxConnections=5` e um axios de 40 s por passo do handshake (`services/conexos.ts:122`), cinco reconciliações simultâneas para adtos distintos (paralelismo legítimo, provado em `ReconciliacaoPermutaService.test.ts:857`) esgotam o pool. Outras queries do backend passam a esperar até 5 s e falhar.

**Melhoria Proposta**
> (1) Elevar `poolMaxConnections` para ≥ `2 × N_analistas_simultâneas_previstas + 2` (proposta inicial: 10) — Bass **Reconfiguration** de capacidade estática. (2) Instrumentar `logService.info` com `duration_ms` no início/fim de `reconciliarSerializado` e em cada passo do handshake em `ConexosBaixaClient` — Bass **Timestamp / Condition Monitoring**. (3) Após 2 semanas de produção com métrica, calibrar o `poolMaxConnections` pelo p95 observado.

**Resultado Esperado**
> Nenhuma requisição de leitura do painel espera > 100 ms por conexão durante fechamento diário. `duration_ms` do handshake disponível em log estruturado para calibração futura.

**Métricas de sucesso**
- `poolMaxConnections`: 5 → ≥ 10
- `duration_ms` do handshake: não medido → p50/p95 em log estruturado
- Erros `poolConnectionTimeout` no `LogService`: baseline atual (não medido) → 0 sob 5 reconciliações concorrentes simuladas

**Risco de não fazer**
> Primeiro incidente de "painel travado" durante fechamento (2 analistas × múltiplos POST) sem métrica para diagnosticar — postura reativa numa ferramenta com R$ 38 mi em produção.

**Dependências**: nenhuma — pura configuração + log.

---

### [integrability-1] Introduzir `TituloAPagarSchema` (Zod) em `ConexosTitulosClient.listTitulosAPagar`

**QA**: Integrability
**Tactic alvo**: Adhere to Standards + Contract testing
**Esforço**: S (≤1d — 1 schema, 1 arquivo, 3 testes)
**Findings**: F-integrability-1, F-integrability-2, F-integrability-5

**Problema**
> O delta acrescentou `pago` e passou a depender criticamente de `titMnyTotPago` (pivô de `assertCobertura`), ambos coerced via `parseOptionalNumber` (`Number.parseFloat` locale-cego). Uma virada de formato do ERP para `"1.234,56"` faz `pagoBrl` colapsar em ordem de grandeza; a cobertura passa a aprovar invoices já quitadas — o defeito exato que a ADR-0043 institui para barrar. `pago === 7` ou `pago === "PAID"` passa como `undefined` sem sinal.

**Melhoria Proposta**
> Criar `TITULO_A_PAGAR_SCHEMA = z.object({ titCod: z.coerce.number().int().positive(), titMnyValorMneg: z.coerce.number().finite().optional(), titFltTaxaMneg: z.coerce.number().finite().positive().optional(), titMnyTotPago: z.coerce.number().finite().optional(), pago: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional(), moeCodMneg: z.coerce.number().int().optional(), moeEspNome: z.string().optional() })` e `.parse()` cada row de `listTitulosAPagar` (Adhere to Standards). No mesmo PR, estreitar `TituloAPagar.pago` para `1 | 2 | 3` (fecha F-integrability-5). Adicionar fixture em `ConexosSubClients.test.ts` com locale BR (`"1.234,56"`) e outra com `pago` fora do enum — ambas devem lançar.

**Resultado Esperado**
> Um schema Zod em `ConexosTitulosClient.ts`; qualquer variação de formato do ERP para `titMnyTotPago` ou `pago` gera erro no boundary (não `undefined` silencioso). Fixture wire-real com locale BR passa a existir. Cobertura de Zod nos passos do handshake `fin010` sobe de 2/5 para 3/5.

**Métricas de sucesso**
- Schemas Zod em `ConexosTitulosClient.ts`: 0 → ≥1
- Fixtures wire-real com locale BR em `ConexosSubClients.test.ts`: 0 → ≥1
- `TituloAPagar.pago` tipo: `number` → `1 | 2 | 3`

**Risco de não fazer**
> Em 6 meses, uma evolutiva do fornecedor (locale, ou expansão do enum de `pago`) passa despercebida. A pré-checagem de I-Write-8a — que existe para recusar baixa em invoice quitada — silenciosamente aprova o mesmo defeito que a ADR-0043 documentou como razão-de-ser do gate. Cenário concreto: doc 9320-like (face USD 83.476,12, aberto 0) volta a passar.

**Dependências**: nenhuma.

---

### [testability-baixa-1] Suíte de integração contra Postgres real cobrindo advisory lock + CHECK da migration 0054

**QA**: Testability
**Tactic alvo**: Sandbox, Executable Assertions
**Esforço**: L (1–2 sem — precisa de docker-compose.test.yml, scripts de migração no CI, wiring do jest para o marcador `integration:`)
**Findings**: F-testability-1, F-testability-2

**Problema**
> Duas remediações P0/P1 deste delta dependem de comportamento do Postgres que o teste unitário **não pode** provar: (a) `pg_try_advisory_lock` serializando duas conexões DIFERENTES do pool (o mock com `Set<number>` prova o contrato, não a semântica cross-connection); (b) o CHECK constraint da migration 0054 aceitando `INSERT status='parcial'` — hoje só o TEXTO do SQL do repositório é assertado (`PermutaExecucaoRepository.test.ts:42`). Enquanto essa suíte não existir, uma migration mal-aplicada, um typo no nome da constraint, ou uma migração acidental do lock para uma API que não sobrevive ao pooler passam batido — e a detecção acontece **em produção**, depois do POST fin010 já ter movido dinheiro. Referências: `PostgreeDatabaseClient.ts:137-158`, `0054_permuta_execucao_parcial.sql:18-23`, `ReconciliacaoPermutaService.test.ts:83-100`.

**Melhoria Proposta**
> Introduzir suíte com marcador `describe('integration: ...', ...)` conforme padrão do CLAUDE.md, contra Postgres em contêiner (docker-compose.test.yml minimo). Casos: (1) duas conexões concorrentes pedindo `pg_try_advisory_lock($1)` — a segunda recebe `locked=false`; (2) migration 0054 aplicada, `INSERT ... status='parcial'` **succeeds**; (3) constraint antigo (pré-0054) rejeita `'parcial'` com CHECK violation; (4) SESSION-level lock não vaza para outra sessão do pool após `release()`. Tactic Bass: **Sandbox** (banco descartável) + **Executable Assertions** (invariante do CHECK verificado no banco, não no texto do SQL).

**Resultado Esperado**
> Testes de integração contra Postgres real do módulo permutas: **0 → ≥4 cases**. Confiança contra dupla-baixa cross-instance: **derivada** (mocked) → **medida**. Migration 0054 verificada em CI antes do deploy.

**Métricas de sucesso**
- Testes de integração contra PG real no módulo permutas: 0 → ≥4 cases
- Confiança da guarda R-1 P0 (dupla-baixa): "prova o contrato" → "prova o comportamento cross-connection"
- Migration 0054 gates em CI: 0 → 1 (aplica + testa antes de release)

**Risco de não fazer**
> Uma migration não-idempotente ou renomeada em `0055+` pode deixar o CHECK antigo de pé; o primeiro `parcial` em produção falha DEPOIS do fin010 aceitar a baixa; o erro chega ao analista como "falha ao gravar terminal" e o ledger diverge. Custo estimado: 1 super-pagamento por incidente do padrão do borderô 15593 = ~R$ 5–40k por par afetado.

**Dependências**: escolha entre `pg-mem` (rápido, sem docker) e Postgres real em contêiner (fidelidade total). Recomendação: Postgres real — `pg-mem` não implementa `pg_advisory_lock` fielmente. Coordenar com `Deployability` para o CI runner.

---

## P2 — Médio

### [availability-3] Sanity-check de idempotência do 409 sob restart de processo Express

**QA**: Availability
**Tactic alvo**: Monitor + State Resynchronization
**Esforço**: S (add-on do card availability-2)
**Findings**: F-availability-2

**Problema**
> O advisory lock é **session-level** e ligado à `PoolClient` que o adquire. Se o processo Node cair no meio de `reconciliarSerializado` (SIGTERM do Render, OOM), a conexão Postgres fecha e o lock é liberado pelo backend — **mas** a linha `permuta_alocacao_execucao` pode ficar em `reconciling` sem `bor_cod` ou com `bor_cod` sem confirmação. O caminho IN-DOUBT (`ReconciliacaoPermutaService.ts:290-311`) barra re-POST, o que preserva o dinheiro; a disponibilidade da funcionalidade, no entanto, exige intervenção manual (comentário `NÃO re-POSTado`). Sem alerta imediato, o operador só descobre quando tenta reconciliar de novo.

**Melhoria Proposta**
> Estender o reaper de `availability-2` para também emitir WARN sobre `status='reconciling' AND age > 15 min AND bor_cod IS NOT NULL` (mesma heurística de `reaper-sispag-reconciling.ts:63`). Bass **Monitor** + **State Resynchronization** (fornecer ao operador o `borCod` a conciliar no ERP).

**Resultado Esperado**
> Toda execução IN-DOUBT dispara um WARN dentro de 15 min. Runbook do operador tem `borCod` no log; MTTR de decisão humana < 30 min.

**Métricas de sucesso**
- Alerta médio para IN-DOUBT: hoje só descoberto na próxima tentativa → < 15 min
- Falso-positivos (execuções que resolveram sozinhas): monitorar após 4 semanas

**Risco de não fazer**
> Probabilidade baixa (restart no meio do handshake é raro), mas quando acontecer a analista fica sem sinal ativo — só descobre no próximo clique.

**Dependências**: availability-2.

---

### [availability-4] Reduzir `heavyRouteLimiter.limit` para o caminho de escrita ou introduzir queue-length limit

**QA**: Availability
**Tactic alvo**: Reconfiguration
**Esforço**: S
**Findings**: F-availability-4

**Problema**
> `heavyRouteLimiter=10/min/IP` (`src/backend/http/rateLimit.ts:28-36`) é generoso para a rota `/permutas/adiantamentos/:docCod/reconciliar` cujo custo interno é ≥ 1 pool-client × handshake de ~5 chamadas ao Conexos. Um IP pode gerar 10 requisições/min contra um pool de 5 clientes; dois IPs, 20. O limitador atual foi calibrado contra "flood do ERP", não contra "starvation do pool DB local".

**Melhoria Proposta**
> Criar `writeRouteLimiter` (nome sugerido) com `limit ≈ poolMaxConnections − 2` (folga para reads) aplicado seletivamente às rotas de escrita `fin010` (`/reconciliar`, `/reconciliar-lote`, `/gerar-numerario`). Alternativamente, adotar um semáforo em memória (`p-limit(N)`) em torno de `reconciliar` para bloquear a admissão antes do lock. Bass **Reconfiguration** (admission control).

**Resultado Esperado**
> A admissão por instância nunca excede `poolMaxConnections − reserva_reads`. Requisições em excesso recebem 429 com `Retry-After`, sem estourar o pool.

**Métricas de sucesso**
- `heavy_limit / poolMax` no caminho de escrita: 10/5 = 2 → ≤ (poolMax−2)/poolMax ≈ 0.6
- 429 emitidos sob teste de carga com 10 clientes: hoje 0 (todos entram, pool estoura) → esperado ≥ 5

**Risco de não fazer**
> Multiplica o cenário de F-availability-1 quando aparecer um segundo operador em janela concorrente.

**Dependências**: idealmente após availability-1 (elevar `poolMaxConnections` primeiro, depois calibrar limiter).

---

### [deployability-2] Expor `writeEnabled`, `dryRun` e `lastMigration` no `/health`

**QA**: Deployability
**Tactic alvo**: Deployment Observability
**Esforço**: S (≤1d)
**Findings**: F-deployability-2

**Problema**
> `/health` devolve `{ status, version }`. A "nota de vigência" que este delta adicionou ao runbook aponta para `/health` como âncora de "esta versão já traz a ADR-0043", mas o operador precisa correlacionar version → CHANGELOG.md → ADR à mão. Adicionalmente, saber se o serviço está escrevendo agora (não em dry-run) exige abrir o dashboard do Render. Card já existia no run anterior (`deployability-2`) — este delta o reforça em vez de fechar.

**Melhoria Proposta**
> Ampliar o handler de `src/backend/index.ts:79` para expor `{ status, version, writeEnabled, dryRun, lastMigration }`. `lastMigration` vem do próprio `BootMigrator` (nome do último arquivo aplicado / `MAX(name) FROM migrations_applied`). Manter o campo `status` como estava — decisão binária que a sonda externa consome. Não expor secrets nem info que descreva a operação para não-`admin` (segue a doutrina do `routes/health.ts:14-22`). Tactic Bass: **Deployment Observability**.

**Resultado Esperado**
> `curl /health` responde os 5 campos; runbook pode citar `lastMigration >= 0054_permuta_execucao_parcial` como critério de vigência sem correlacionar CHANGELOG à mão. MTTR de "qual código estava rodando com qual flag" cai do minuto (correlacionar 2 sistemas) para segundos.

**Métricas de sucesso**
- Campos expostos em `/health`: 2 → 5 (`status`, `version`, `writeEnabled`, `dryRun`, `lastMigration`)
- Fontes que o operador consulta durante incidente: 2 (dashboard + repo) → 1 (só `/health`)

**Risco de não fazer**
> Cada incidente de escrita na Frente I gasta 3-5min de correlação manual antes do primeiro passo real de diagnóstico.

**Dependências**: nenhuma.

---

### [deployability-3] Criar `PERMUTAS_WRITE_ENABLED` como kill-switch dedicado (reduzir blast radius do `CONEXOS_WRITE_ENABLED`)

**QA**: Deployability
**Tactic alvo**: Logical Grouping / Configure Behavior
**Esforço**: S (≤1d) — flag + manifest + teste + entrada no runbook
**Findings**: F-deployability-3

**Problema**
> Hoje o único gate específico da escrita da Frente I é o global `CONEXOS_WRITE_ENABLED`, que também governa Recebimentos. Uma regressão em Permutas força ou revert lento (com risco de F-deployability-1) ou desligar Recebimentos junto — uma frente independente, saudável, com seu próprio livro-razão. Card já aberto no run anterior (`deployability-1`); este delta não fecha, mas também não agrava.

**Melhoria Proposta**
> Introduzir `PERMUTAS_WRITE_ENABLED` no `EnvironmentProvider`/`configManifest.ts`; `ReconciliacaoPermutaService` verifica ANTES da lógica global (`CONEXOS_WRITE_ENABLED=true && PERMUTAS_WRITE_ENABLED !== 'false'`). Default seguro `true` para não regressar produção (a escrita já está ligada); explicitar no `render.yaml` como `sync: false` (fonte no dashboard). Tactic Bass: **Logical Grouping** (feature flag por front) e **Rollback** (limitar blast radius).

**Resultado Esperado**
> 1 alavanca dedicada para desligar SÓ Permutas em incidente, sem impactar Recebimentos. Alinha Frente I com o padrão que Frente II e Frente IV já seguem (`SISPAG_LIVE_WRITE_ENABLED`, `RECEBIMENTOS_ENABLED`).

**Métricas de sucesso**
- Kill-switch dedicado para Frente I: ausente → presente
- Frentes afetadas ao desligar escrita de Permutas: 2 (Permutas + Recebimentos) → 1 (só Permutas)

**Risco de não fazer**
> Próximo incidente de escrita na Frente I força o operador a escolher entre revert arriscado (F-deployability-1) e derrubar a Frente IV (saudável).

**Dependências**: nenhuma.

---

### [deployability-4] Consolidar runbook — bloco único "revert com estado novo persistido"

**QA**: Deployability
**Tactic alvo**: Rollback
**Esforço**: S (≤1d)
**Findings**: F-deployability-4, F-deployability-1

**Problema**
> O runbook agora tem informação sobre `parcial` em três lugares (Rollback, Sinais de problema, Invariantes) mas não tem o caminho **inverso**: "eu quero reverter este commit — o que faço com as linhas `parcial` que ele criou?". F-deployability-1 descreve o risco; F-deployability-4 é a receita.

**Melhoria Proposta**
> Adicionar bloco numerado no `docs/runbooks/fin010-write-cutover.md` chamado "Revert do commit `8b18686` (ou versões subsequentes que escrevam `parcial`)": (1) desligar escrita; (2) contar linhas `parcial`; (3) para cada uma, auditar o ERP pelo `bxa_cod_seq` gravado; (4) marcar `parcial` como `settled` no banco (SQL de exemplo); (5) só então executar revert. Referenciar `deployability-1` como origem. Tactic Bass: **Script Deployment Commands** (revert como script, não como memória).

**Resultado Esperado**
> Bloco de 6-10 linhas com SQL explícito e ordem clara; runbook autocontido.

**Métricas de sucesso**
- Parágrafos do runbook dedicados a code-rollback: 0 → 1
- Passos numerados para revert seguro: 0 → 5

**Risco de não fazer**
> Sobrepõe ao `deployability-1`.

**Dependências**: `deployability-1` (a receita depende do procedimento definido lá; podem ser mergeados num só card se preferir).

---

### [integrability-2] Estender Zod aos 3 passos intermediários do handshake `fin010`

**QA**: Integrability
**Tactic alvo**: Adhere to Standards
**Esforço**: S (≤1d — 3 schemas)
**Findings**: F-integrability-3

**Problema**
> O handshake tem 5 passos: 1 (`criarBordero`) e 5 (`gravarBaixaPermuta`) parseiam com Zod; 2 (`listBaixas`), 3 (`excluirBaixa`), 4 (`excluirBordero`) usam `Number(...)` + `.filter(finite)`. `listBaixas` alimenta a decisão de excluir borderô órfão (I-Write-7) — decisão irreversível no ERP. `excluirBaixa`/`excluirBordero` não têm retorno tipado (só sucesso ou erro), mas o path que consome `listBaixas` decide a partir de shape que não é validado.

**Melhoria Proposta**
> `LISTA_BAIXAS_SCHEMA` (array de `z.object({ docCod: z.coerce.number().int().positive(), bxaCodSeq: z.coerce.number().int().positive(), … })`) no retorno de `listBaixas`; o filtro `finite` vira `.parse()` — malformado LANÇA em vez de silenciosamente derrubar (Adhere to Standards). Um schema por endpoint intermediário (podem viver no mesmo arquivo, ao lado dos existentes).

**Resultado Esperado**
> Cobertura de Zod no handshake `fin010` sobe de 2/5 para 5/5. `listBaixas` retornando payload malformado ergue `ConexosError` (endpoint declarado), e a limpeza de órfão vira fail-safe REAL, não fail-safe-por-filter-de-`finite`.

**Métricas de sucesso**
- Passos do handshake com Zod: 2/5 → 5/5
- `.filter(Number.isFinite)` em resposta do ERP: 1 → 0 (some por causa do parse estrito)

**Risco de não fazer**
> Casco de vazio + `listBaixas` retornando shape estranho leva a excluir borderô que TEM baixa. A ADR marca `listBaixas` como fonte da verdade; a fonte da verdade merece Zod. Provavelmente nunca dispara — mas quando disparar, é dinheiro apagado.

**Dependências**: nenhuma.

---

### [integrability-3] Fixture-based contract test para `listTitulosAPagar` cobrindo `pago` e locale

**QA**: Integrability
**Tactic alvo**: Contract testing
**Esforço**: S (≤1d — carrega o card 1)
**Findings**: F-integrability-1, F-integrability-2

**Problema**
> Toda a bateria nova (`ReconciliacaoPermutaService.test.ts:920-980`) mocka o RETORNO do client — não pega regressão de parsing. O único teste que ataca o wire (`ConexosSubClients.test.ts:970-988`) usa fixture US-locale e não inclui `pago`. Se o ERP mudar o wire, os 1.768 testes passam.

**Melhoria Proposta**
> Uma tabela de fixtures em `src/backend/domain/client/__fixtures__/com308-listTitulos-*.json` capturadas em sonda real (formato do que `svc.authenticatedPost` retorna hoje), MAIS variações negativas: `pago: "1"` (string), `pago: 4` (out-of-enum), `titMnyTotPago: "1.234,56"` (BR-locale), `titMnyTotPago: null`. Cada fixture roda contra o parser (via Zod do card 1) e afirma resultado esperado ou throw.

**Resultado Esperado**
> Ratio de fixture-based contract tests para clients Conexos críticos: baseline atual 1 (SispagWrite) + 1 (Fin014) + 1 (Titulos com US-locale, sem pago) → 4+ (Titulos com pago + BR-locale + variantes). Contract regression detectável em CI, não em produção.

**Métricas de sucesso**
- Fixtures wire-real para `listTitulosAPagar`: 1 → ≥4
- Cobertura de casos negativos (locale, out-of-enum, null) na fronteira: 0 → 3

**Risco de não fazer**
> Card 1 fecha o parse mas o teste que garante a estabilidade do parse não existe. Refactor futuro do `parseOptionalNumber` (parece inócuo) pode reintroduzir o defeito sem falhar em CI.

**Dependências**: **carrega o card [integrability-1]** — o schema tem que existir primeiro para os testes o exercerem.

---

### [performance-3] Elevar `poolMaxConnections` e/ou reduzir a janela do advisory lock — dissolver a colisão entre `withAdvisoryLock` e leituras do painel

**QA**: Performance
**Tactic alvo**: Increase Resources · Bound Execution Times · Reduce Overhead
**Esforço**: **S** para (A) isoladamente (uma constante + comentário + smoke test); **M** para (A)+(B) juntas (extração de fases pré-lock e teste que garante que a idempotência não é violada por decisões tomadas fora do lock).
**Findings**: F-performance-1

> **Nota**: parte (A) — bump de `poolMax` — é sub-item do `availability-1` (P1). Não duplicar
> entregas; usar como referência para a parte (B) mais adiante.

**Problema**
> `PostgreeDatabaseClient.withAdvisoryLock` (`PostgreeDatabaseClient.ts:137-158`) retém 1 `PoolClient` dedicado por **toda a duração** de `reconciliarSerializado`, que faz ~6 chamadas Conexos (timeout 40 s cada) — worst-case ~240 s por adto de título único, mais quando há multi-título. Com `Pool.max=5` (`PostgreeDatabaseClient.ts:26`), 5 reconciliações concorrentes de adtos **distintos** esgotam o pool e qualquer outra query (painel, health-check, o próprio `listAtivas` de `performance-2`) começa a estourar `connectionTimeoutMillis=5000`. Este é o modo mais provável de degradação sob concorrência real (dois operadores + `/reconciliar-lote` + painel atualizando).

**Melhoria Proposta**
> Duas alternativas complementares, ambas alinhadas com Bass. Escolher **A + B**, não uma só, porque atacam eixos diferentes:
> - **A. Increase Resources** — Elevar `poolMaxConnections` de **5 → 12** (`PostgreeDatabaseClient.ts:26`) e revisar o comentário-diretriz que hoje justifica só o cenário SISPAG. Documentar a fórmula: `pool_max ≥ max(reconciliacoes_concorrentes_esperadas + leituras_de_painel_ativas + margem_de_2)`. Custo baixo: pool `pg` no Render é elástico dentro do plano.
> - **B. Bound Execution Times** — Reduzir a **janela** do advisory lock: o lock por adto só precisa proteger o trecho **write-ahead → POST → mark(settled|parcial|error)**. As leituras de decisão (`findAdiantamento`, `listAtivas`, `autoAlocarSe…`, `assertCobertura`) podem rodar **antes** do lock, o que corta o tempo de retenção do client dedicado em ~30–50 %. Alternativa incremental: manter o lock e liberar/re-adquirir o client dedicado nas leituras que não precisam do mesmo backend (o unlock é da sessão, então essa opção exige refactor não trivial e não deve entrar sem teste dedicado).
> Tática Bass: **Increase Resources** (A) + **Reduce Overhead / Bound Execution Times** (B).

**Resultado Esperado**
> Duas reconciliações de adtos distintos + 1 painel atualizando em paralelo terminam **sem** `connection acquisition timeout` no pool. Tempo de retenção do client dedicado por lock cai de ~240 s (worst-case) para ≤ ~90 s (só o handshake write). Espaço mínimo garantido no pool para leituras não-permuta (painel, health-check) mesmo com o `/reconciliar-lote` sequencial de 6 adtos em andamento.

**Métricas de sucesso**
- `Pool.max`: 5 → 12 (item A) — mensurável em `PostgreeDatabaseClient.ts:26`.
- Duração de retenção do client dedicado por lock (worst-case): ~240 s → ≤ 90 s (item B) — mensurável assim que o card `availability-5` (instrumentação de duração) do run anterior for entregue.
- `p95` de `connection acquisition wait` no `pg` durante `/reconciliar-lote` de 6 adtos: hoje inobservado → alvo `< 100 ms` (requer métrica; segue dependente de `availability-5`).

**Risco de não fazer**
> Nos próximos meses, à medida que a Frente IV (Conciliação de Recebimentos) e novos jobs cron ganham espaço, cada novo consumidor do pool encurta a folga. O sistema segue funcionando na maior parte do tempo, mas a analista vê queda intermitente do painel exatamente quando roda o fechamento do lote — o pior lugar possível para uma UX inconsistente, dado o valor médio (~R$ 280 k) por adto.

**Dependências**: `availability-5` do run anterior (instrumentação de duração) para tornar as métricas de sucesso observáveis. Nada bloqueia (A) — dá para ir com (A) primeiro e agendar (B) só se (A) não zerar as reclamações.

---

### [integrability-4] Expor `count` do envelope de paginação para permitir a guarda de truncamento

**QA**: Integrability
**Tactic alvo**: Encapsulate
**Esforço**: M (2–5d — mexe em 3 camadas do pipe, testes acompanham)
**Findings**: F-integrability-4

**Problema**
> A ADR-0043 declara a guarda `rows.length !== count` como "defensiva opcional" e deixa a critério do futuro. O critério é irrealizável a partir do ponto atual: `legacyConexosAdapter.listGeneric` (linha 26-30) descarta `count` uma linha antes de `callList` receber o resultado. Ativar a guarda depois exige refactor cascata (adapter → base → client). Amostra atual (22 títulos, 1–2 por invoice) é enviesada — só cobre invoices que já baixamos.

**Melhoria Proposta**
> Migrar `listTitulosAPagar` de `callList` para `paginate`/`listGenericPaginated` (que já expõe `{ count, rows }`); adicionar `envelopeCount` no retorno do client e ativar a guarda em `assertCobertura` (`if (envelopeCount !== undefined && titulos.length !== envelopeCount) warn+ conservador`). Encapsulate: o caller decide sobre a informação — sem precisar cavar o adapter.

**Resultado Esperado**
> `count` acessível ao caller; guarda de truncamento pronta para ativar sem refactor. Se algum dia uma invoice de multi-parcela chegar (não impossível), a subestimativa de cobertura resulta em WARN em vez de aprovação silenciosa.

**Métricas de sucesso**
- Pontos do pipe onde `count` está acessível a `listTitulosAPagar`: 0 → 1
- Guarda `titulos.length !== envelopeCount` no `assertCobertura`: ausente → presente (warn-only, não recusa)

**Risco de não fazer**
> Enquanto a amostra continuar 1–2 títulos, nada quebra. Uma invoice com 3+ parcelas paginada pelo ERP (page-size que ele imponha) resulta em cobertura subestimada — recusa indevida (falha para o lado seguro, mas atrapalha a analista); ou, se a implementação vier depois e mudar o critério para `pageSize === rows.length`, gera falso-positivo (ver medição do run anterior em HML: pedimos 500, veio 50).

**Dependências**: nenhuma bloqueante — mas o pareamento natural é com o card 1 (mesmo arquivo).

---

### [testability-baixa-2] Ampliar guarda de paridade FE↔BE — cobrir 7/7 uniões, matar o regex

**QA**: Testability
**Tactic alvo**: Executable Assertions, Abstract Data Sources
**Esforço**: M (2–3d — a extração dos `as const` é mecânica, mas cada consumidor no backend do union type precisa migrar para o valor exportado; se o backend usa `import type` no lugar de `import`, mudar não muda runtime)
**Findings**: F-testability-3

**Problema**
> O teste `frontend/lib/types.test.ts` cobre **3 de 8** uniões espelhadas à mão (`ExecucaoStatus`, `PermutaStatusBordero`, `LoteAdiantamentoStatus`), e usa `readFileSync + match(new RegExp(...=([^;]+);))` — o que quebra em três cenários inocentes: (a) remoção do `;` (TS aceita), (b) `;` dentro de comentário/JSDoc na união, (c) colapso da `\n\n` sentinela do FE. As não-cobertas (`StatusElegibilidade`, `TipoPermuta`, `ProcessamentoStatus`, `BorderoSituacao`, `RelatorioTipo`) espelham enums que mudam a cada `/feature-tweak` de gestão. A guarda existe para prevenir o defeito C-6 (badge divergente sem typecheck failure) — cobrir menos da metade das uniões é ceder metade da defesa.

**Melhoria Proposta**
> Duas frentes: (1) **acabar com o regex** — extrair as uniões do backend para um módulo `src/backend/domain/interface/permutas/enums.ts` exportado como valor (`export const EXECUCAO_STATUS = ['pending','reconciling','settled','error','parcial'] as const` + `type ExecucaoStatus = typeof EXECUCAO_STATUS[number]`), e importar o valor no teste FE via caminho relativo — a comparação passa a ser `expect(FRONTEND_EXECUCAO_STATUS).toEqual(BACKEND_EXECUCAO_STATUS)`, sem parsing de texto; (2) **cobrir 7/7 uniões** — parametrizar via `describe.each`. Tactic Bass: **Executable Assertions** (invariante = "as duas listas são iguais", assertado no CÓDIGO, não no TEXTO do código).

**Resultado Esperado**
> Uniões espelhadas cobertas: **3/8 → 8/8**. Fragilidade do regex: **presente → ausente** (compilador falha se o valor exportado do backend não bate). Custo de acrescentar uma nova união: **manter 4 lugares → manter 2 lugares (o valor e o teste `describe.each`)**.

**Métricas de sucesso**
- Uniões cobertas pela paridade: 3 → 8
- Fragilidade da guarda (quebra com formatação inocente): 3 vetores → 0
- LOC de regex-parsing em `types.test.ts`: ~20 → 0

**Risco de não fazer**
> Reincidência do C-6 (badge que cai no `else` errado) em qualquer união fora das 3 cobertas. Detectável hoje só por revisão humana ou incidente.

**Dependências**: nenhuma; escopo contido em `src/backend/domain/interface/permutas/` + `src/frontend/lib/types*.ts`.

---

## P3 — Baixo

### [deployability-5] Documentar como referência: template de "encolher union CHECK" para futuras remoções de estado

**QA**: Deployability
**Tactic alvo**: Script Deployment Commands
**Esforço**: S (≤1d)
**Findings**: F-deployability-5

**Problema**
> O repo tem 54 migrations forward-only. Nenhum template explica como remover um valor de union do CHECK sem violar constraint se ainda existirem linhas com aquele valor. É débito latente — não custa nada hoje, mas custa horas na primeira vez que aparecer.

**Melhoria Proposta**
> Escrever `docs/migrations-playbook.md` (ou seção em `CLAUDE.md`) com 3 casos padronizados: (a) expandir union (o que a 0054 faz); (b) encolher union com dados presentes (`UPDATE ... SET status='error' WHERE status='<removido>'` ANTES de `DROP/ADD` do CHECK); (c) renomear valor (idem, com preservação do histórico via coluna auxiliar). Tactic Bass: **Script Deployment Commands** (playbook, não memória).

**Resultado Esperado**
> 1 doc referenciável quando (se) alguém precisar remover `parcial` ou qualquer outro valor de union no futuro.

**Métricas de sucesso**
- Templates de "encolher union" documentados: 0 → 1

**Risco de não fazer**
> Quando aparecer, custa 2-4h de descoberta ad-hoc em incidente.

**Dependências**: nenhuma.

---

### [integrability-5] Renomear `TituloAPagar` do sispag para eliminar colisão de nome

**QA**: Integrability
**Tactic alvo**: Encapsulate + Adhere to Standards (naming discipline)
**Esforço**: S (≤1d, sed-and-typecheck)
**Findings**: F-integrability-6

**Problema**
> `TituloAPagar` existe em dois lugares com shapes distintos — o de permuta em `ConexosTitulosClient.ts:5` (campos `valorNegociado/taxa/pago`) e o de sispag em `SispagInterface.ts` (importado em `ConexosSispagClient.ts:8`). Nenhum arquivo cross-importa hoje, mas serviços que injetam ambos os clients existem no mesmo bounded context (ex.: se uma tela de conciliação de recebimentos amanhã tocar em títulos de invoice, o IDE oferece dois `TituloAPagar`).

**Melhoria Proposta**
> Renomear o de sispag para `TituloPagamento` ou `TituloComPagar` (Encapsulate — nomes que carregam o subdomínio evitam ambiguidade). PR mecânico, ~30 arquivos, todo em `src/backend/domain/service/sispag`, `repository/sispag`, `interface/sispag`.

**Resultado Esperado**
> Um único `TituloAPagar` no repo. Auto-import não oferece dois candidatos.

**Métricas de sucesso**
- Tipos com nome idêntico e shape diferente no bounded context: 2 → 1

**Risco de não fazer**
> Bug em potencial num refactor futuro; nada quebra por conta própria.

**Dependências**: nenhuma. Não faz sentido colar em um `/feature-tweak`; é candidato a hygiene sprint.

---

### [modifiability-delta-1] Nomear e elevar `limiteResiduo` a top-level constante do módulo

**QA**: Modifiability
**Tactic alvo**: Encapsulate
**Esforço**: S (≤ 1h)
**Findings**: F-modifiability-2

**Problema**
> O delta introduziu duas constantes novas de regra em `ReconciliacaoPermutaService.ts`. Uma virou top-level nomeada e comentada (`TOLERANCIA_FECHAMENTO_NEG = 0.005`, `:41`); a outra ficou inline dentro do método (`const limiteResiduo = 1`, `:886`). Inconsistência gratuita — a segunda vale exatamente pela mesma razão que a primeira (invariante do domínio, referenciada em ADR-0020).

**Melhoria Proposta**
> Aplicar **Encapsulate**: elevar `limiteResiduo` a `const LIMITE_RESIDUO_ANCORAGEM_BRL = 1;` no topo do arquivo, com o mesmo padrão de comentário de `TOLERANCIA_FECHAMENTO_NEG` (por que é absoluto, ADR-referência, o que acontece se mudar). Se o card `modifiability-4` do run anterior for atacado (mover para `permutas/config/`), levar as duas juntas.

**Resultado Esperado**
> Ambas as constantes referenciáveis por nome de módulo, testáveis sem entrar em `ancorarVariacaoNoAdto`, coerentes com o padrão do resto do arquivo.
> Métrica: 2/2 constantes novas do delta como top-level nomeadas (hoje: 1/2).

**Métricas de sucesso**
- Constantes de regra top-level em `ReconciliacaoPermutaService.ts`: 3 → 4
- Grep de literais `= 1` dentro de métodos de regra: −1

**Risco de não fazer**
> Nenhum imediato. Débito acumulável — a cada delta em que o padrão não é imitado, o F-modifiability-4 herdado engorda em 1.

**Dependências**: nenhuma.

---

### [performance-4] Instrumentar duração do `withAdvisoryLock` e do `reconciliar` — visibilidade antes de qualquer otimização adicional

**QA**: Performance
**Tactic alvo**: Increase Resource Efficiency (via observabilidade)
**Esforço**: S
**Findings**: F-performance-1 (o baseline hoje é derivado).

**Problema**
> Não há sinal do tempo real de retenção do client no pool nem do p95 de `reconciliarSerializado` em produção. O card `availability-5` do run anterior pediu instrumentação de duração; enquanto ele não sai, o único baseline defensável de `performance-3` é derivado (timeout × nº de calls), não medido.

**Melhoria Proposta**
> Emitir 2 `logService.info({ type: 'PERF' })` no fluxo de `withAdvisoryLock`: (i) tempo de espera até adquirir o lock, (ii) tempo entre acquire→release do client dedicado. Emitir 1 `PERF` no wrapper `reconciliar` com a duração total. Tag `adiantamentoDocCod`, `borCod`, `titulos.length`. Custo baixo, sem dependência de infra AWS. Tática Bass: **Increase Resource Efficiency** via observabilidade — pré-requisito para qualquer ajuste de pool sizing.

**Resultado Esperado**
> Painel operacional consegue plotar histograma de duração de `reconciliar` por dia. p95, p99 e worst-case observáveis. `performance-3(A)` e `(B)` passam a ter métrica de sucesso REAL, não derivada.

**Métricas de sucesso**
- Duração p50/p95/p99 de `reconciliar`: hoje inobservável → observável em painel diário.
- Tempo de retenção do client dedicado por lock: hoje inobservável → observável.

**Risco de não fazer**
> `performance-3` fica sem métrica de sucesso e vira "vamos elevar pool porque a gente acha", em vez de "elevamos pool porque X% das requisições ficavam esperando > Y ms".

**Dependências**: substancialmente sobreposto com `availability-5` do run anterior — coordenar para não duplicar trabalho.

---

### [security-delta-1] Redigir `details` de `AlocacaoSemCoberturaError` para não devolver valores brutos ao cliente

**QA**: Security
**Tactic alvo**: Limit Exposure
**Esforço**: S (≤1d)
**Findings**: F-security-delta-1

**Problema**
> A resposta 422 do `/permutas/:docCod/reconciliar` inclui `details.{cobertura, valorAlocado, deficit, invoiceDocCod}` — o USD em aberto da invoice, o alocado do par, e o déficit. Hoje é irrelevante (todos são `admin`), mas o dia em que `security-1/2/3` forem implementados, o `details` do erro passa a devolver faturamento em aberto por invoice para um role operador que provavelmente não deveria enxergá-lo cross-filial. A analista já vê os números na tela onde alocou, então o `details` só serve para logs/debug — não para renderização.

**Melhoria Proposta**
> Em `AlocacaoSemCoberturaError.ts:52-58`, dividir em dois: manter `this.details` (server-side, para logs/audit) e adicionar `this.clientDetails` (apenas `adiantamentoDocCod` e `invoiceDocCod` — o mínimo para a UI orientar re-alocar) OU alterar `respondHandlerError.ts:24-27` para NÃO propagar `details` a menos que o erro sinalize `publicDetails: true`. Preferível a segunda: uma decisão por classe de erro, no ponto de emissão. Tactic Bass: Limit Exposure. Arquivos: `src/backend/domain/errors/AlocacaoSemCoberturaError.ts`, `src/backend/http/respondHandlerError.ts`, e revisão de `IngestLockBusyError`/`RemessaEmAndamentoError` para consistência.

**Resultado Esperado**
> Resposta 422 devolve `error` + `code` + `retryable`, sem valores financeiros; UI segue mostrando `userMessage` (que continua contendo os números — mas isso é decisão explícita da mensagem, não default do middleware). Métrica: `details` com campo numérico financeiro em resposta HTTP: **1 → 0**.

**Métricas de sucesso**
- `curl -s -X POST /permutas/{X}/reconciliar` com alocação inválida devolve `error`+`code`+`retryable`, sem `details.cobertura|valorAlocado|deficit`: sim
- Testes de contrato de erro atualizados em `ReconciliacaoPermutaService.test.ts`

**Risco de não fazer**
> Após `security-1/2/3` landing, resposta 422 vira canal lateral de exfiltração de faturamento em aberto por invoice para roles não-admin — sem que `security-3` sozinho resolva.

**Dependências**: idealmente antes de `security-1` do run anterior chegar ao merge, para não ter que revisitar dois PRs.

---

### [security-delta-2] Restringir permissões do artefato de `probe-com308-cobertura.ts` (0o700 dir, 0o600 file)

**QA**: Security
**Tactic alvo**: Limit Exposure
**Esforço**: S (≤1d)
**Findings**: F-security-delta-2

**Problema**
> O probe versionado escreve `achados.json` em `/tmp/probe-com308-cobertura/` com umask default (dir 0755, arquivo 0644, verificado localmente). Contém `docCod`s reais de invoices em PRD e USD face por título. Em host multiusuário (ou VM compartilhada com CI runner), qualquer outra conta local lê. É read-only no ERP e não roda em CI — o risco é de dev-machine hygiene, não de aplicação.

**Melhoria Proposta**
> `mkdirSync(OUT_DIR, { recursive: true, mode: 0o700 })` + `writeFileSync(arquivo, ..., { mode: 0o600 })` no `src/backend/jobs/probe-com308-cobertura.ts:63, 258`. Adicionar linha no header explicando que o arquivo contém `docCod`s de PRD e que o probe **não** deve ser rodado em host compartilhado com outras contas. Tactic Bass: Limit Exposure + Change Default Settings.

**Resultado Esperado**
> `stat -c '%a' /tmp/probe-com308-cobertura/achados.json` = `600`, `stat -c '%a' /tmp/probe-com308-cobertura` = `700`. Header do probe adverte sobre compartilhamento do host.
> Métrica: permissão do artefato: **664 → 600**.

**Métricas de sucesso**
- `stat -c '%a'` do output = 600 / dir 700
- Comentário no cabeçalho reflete a restrição

**Risco de não fazer**
> Baixo. Dev que rode o probe em host compartilhado (VM de laboratório com múltiplos usuários, CI runner, dev-container multi-tenant) deixa `docCod`s + USD legíveis para outras contas locais.

**Dependências**: nenhuma.

---

### [security-delta-3] Deixar registrado no _inbox: os P0/P1 estruturais do run anterior continuam de pé

**QA**: Security
**Tactic alvo**: (meta — rastreabilidade)
**Esforço**: S (≤1d)
**Findings**: F-security-delta-4

**Problema**
> O delta remediou R-1 (P0 do run `2026-09-08-1414-permutas` — dois cliques criando dois borderôs) e R-2 (P1 do mesmo run — resíduo silenciado como `settled`). NÃO tocou: `security-1` (12/12 `admin`), `security-2` (conta compartilhada), `security-3` (falta `assertUserCanActOnFilial` nas rotas de Permutas), `security-4` (8 HIGH no frontend), `security-6` (JWT em `localStorage`). Todos permanecem exatamente como estavam. Este card existe para que o consolidator NÃO trate a ausência de re-menção como "resolvido".

**Melhoria Proposta**
> Registro em `ontology/_inbox/permutas-baixa-integridade-regis-followups.md`: os cards `security-1/2/3/4/6` do run `2026-09-08-1414-permutas` **continuam abertos**. Este PR os deixou intactos por escopo (foi remediação de R-1/R-2), não por descarte. Tactic Bass alvo dos originais: Authorize Actors / Identify Actors / Separate Entities.

**Resultado Esperado**
> Follow-up registrado; consolidator do run `2026-09-08-1955` referencia os cards do run anterior em vez de re-emitir. Métrica: cards duplicados entre runs: **0**.

**Métricas de sucesso**
- Inbox de follow-up atualizado
- REPORT.md do run atual não recontabiliza `security-1/2/3/4/6`

**Risco de não fazer**
> Consolidator sobrecontabiliza P0 estruturais e a nota do Security do delta é injustamente puxada para baixo por defeitos que este PR não introduziu nem podia resolver.

**Dependências**: consolidator do run atual.

---

### [testability-baixa-3] Ramos residuais de `assertCobertura` — asserção explícita de "no-warn" na tolerância

**QA**: Testability
**Tactic alvo**: Executable Assertions
**Esforço**: S (≤1d)
**Findings**: F-testability-4

**Problema**
> `ReconciliacaoPermutaService.ts:693` tem o predicado `if (t.pago === 1 && Math.abs(abertoUsd) > TOLERANCIA_FECHAMENTO_NEG)`. O teste `ReconciliacaoPermutaService.test.ts:947` prova o WARN quando o aberto derivado ≠ 0. Não existe teste que asserta a **AUSÊNCIA** do WARN no caso `pago===1` com aberto ≈ 0 (o caso normal de título quitado). Se alguém remover o `&& Math.abs(...) > TOLERANCIA` (por "simplificação"), o WARN passa a vazar em toda baixa; o teste atual **não pega**. Além disso, o guard `bxaCodSeqs[0] !== undefined ? {…} : {}` no `markParcial` (`.ts:582`) tem um ramo vazio que nenhum teste exercita — hoje inalcançável (parcial implica ≥1 baixa gravada), mas é um ramo pago no CI.

**Melhoria Proposta**
> (1) `it('pago===1 dentro da tolerância NÃO emite WARN — silêncio é contrato')` — cobertura 500 quitada com `Math.abs(abertoUsd) < 0.005`, assertar `logService.warn` NÃO chamado com `pago`; (2) documentar (no docblock ou como `throw` explícito) que o ramo "`bxaCodSeqs` vazio em `parcial`" é inalcançável — ou remover a guarda condicional se de fato é. Tactic Bass: **Executable Assertions** (ausência é tão importante quanto presença).

**Resultado Esperado**
> Ramos observáveis de `assertCobertura` cobertos: **6/7 → 7/7**. Guardas mortas no laço de resíduo: **1 → 0** (removida ou documentada como unreachable). Sinal do detector proativo BUSINESS_WARN protegido contra "otimização" que quebre o silêncio.

**Métricas de sucesso**
- Ramos cobertos de `assertCobertura`: 6/7 → 7/7
- Asserções "no-warn" no arquivo: 0 → ≥1

**Risco de não fazer**
> Poluição do canal BUSINESS_WARN por regressão silenciosa; degradação do detector proativo I-Recon-7. Baixo impacto financeiro direto, alto impacto no signal-to-noise.

**Dependências**: nenhuma.

---

### [modifiability-delta-2] Estender guarda de paridade FE↔BE para interfaces (não só uniões)

**QA**: Modifiability
**Tactic alvo**: Use an Intermediary (via detection guard); alternativa Encapsulate + Shared Contract
**Esforço**: M (2–3 dias — o parser TS via regex fica frágil; talvez mais simples usar o compiler API para extrair os membros)
**Findings**: F-modifiability-3, F-modifiability-2 do run anterior, F-modifiability-5 do run anterior

**Problema**
> O delta ADICIONOU `valorResidualUsd?: number` em `ResultadoAlocacao` nos dois lados à mão, e nada teria detectado se ficasse só de um lado. `types.test.ts` fecha o modo de falha para 3 UNIÕES (`ExecucaoStatus`, `PermutaStatus`/`PermutaStatusBordero`, `LoteAdiantamentoStatus`), mas ≥5 interfaces espelhadas seguem sem guarda: `ResultadoAlocacao`, `ReconciliarResult`, `ReconciliarLoteResult`, `PermutaBorderoVinculo`, `ExecucaoPermuta`.

**Melhoria Proposta**
> Estender o mesmo padrão de detecção do `types.test.ts` para extrair a lista de PROPRIEDADES de uma `interface`/`export type X = {...}` no arquivo backend e comparar com o frontend. Alternativa canônica (mais forte, também mais cara): **Use an Intermediary** — extrair um pacote compartilhado (`packages/permutas-contracts`) e importá-lo dos dois lados. A guarda por parse é o meio-termo aceitável enquanto o monorepo não for repartido.

**Resultado Esperado**
> Adicionar um campo à interface backend sem espelhar no frontend faz o CI reprovar; o modo de falha silencioso ("`—`" na tela) some.
> Métrica: interfaces espelhadas cobertas por parity test: 0/5 → 5/5.

**Métricas de sucesso**
- Uniões guardadas: 3/3 (mantido)
- Interfaces guardadas: 0/5 → 5/5
- Regressão FE↔BE detectada em CI antes de merge: 100 % dos casos

**Risco de não fazer**
> Campo novo espelhado à mão vai divergir na primeira feature em que o dev do frontend não abrir o backend. `valorResidualUsd` é a próxima que a UI vai apresentar (rateio, tela de re-alocação); qualquer campo derivado dele nasce nesse risco.

**Dependências**: depende de `modifiability-2` do run 2026-09-08-1414 (que propõe o SSOT via pacote compartilhado) — se aquele card for feito primeiro, este vira desnecessário.

---

### [testability-baixa-4] Split de `ReconciliacaoPermutaService.test.ts` por invariante ou índice `describe`

**QA**: Testability
**Tactic alvo**: Limit Structural Complexity
**Esforço**: M (2–3d — mecânico, mas roda em todo `it()`)
**Findings**: F-testability-5

**Problema**
> `ReconciliacaoPermutaService.test.ts` cruzou **1.301 LOC / 46 it()** neste delta. Os 4 `describe` de topo (I-Recon-5, I-Write-8a, I-Recon-6/7, T2) são coesos, mas compartilham `buildDeps()` — o que acopla os 46 casos à mesma assinatura de construtor do serviço. O ciclo do `painel-operacao` já mostrou o pedágio: adicionar 1 `@inject` custa 46 edições `as never` neste arquivo. É o único arquivo do módulo que cruzou o threshold de 1k LOC.

**Melhoria Proposta**
> (1) Extrair `buildDeps` para um `__testkit__/reconciliacaoPermutaServiceKit.ts` — muda de "46 casos com deps posicional" para "46 casos com deps NOMEADA e defaults" (`buildService({ chavesEmVoo: new Set() })`); (2) split opcional por invariante: `.i-recon-5-concorrencia.test.ts`, `.i-write-8a-cobertura.test.ts`, `.i-recon-6-7-parcial.test.ts`. Tactic Bass: **Limit Structural Complexity**. Não é remoção — é reorganização por eixo de invariante (mesmo padrão usado hoje pelos `describe`, elevado ao filesystem).

**Resultado Esperado**
> LOC do maior arquivo de teste do módulo: **1.301 → ≤ 500 por arquivo**. Custo de "adicionar 1 `@inject` ao serviço": **46 edições `as never`** → **1 edição no kit**. Diferença de compreensão para novo dev: `describe` de topo em 1 arquivo → 4 arquivos nomeados por invariante — o índice fica no filesystem.

**Métricas de sucesso**
- LOC do maior test file no módulo permutas: 1.301 → ≤ 500
- Sítios `as never` no `buildDeps`: 12 → 0 (com kit tipado)

**Risco de não fazer**
> Hotspot de conflito de merge crescente. Toda `/feature-tweak` paralela que toque o serviço colide neste arquivo.

**Dependências**: coordenar com futuros deltas que já estejam em worktree paralelo (evitar rebase caro).

---

## Legenda de esforço

- **S** = ≤ 1 dia útil
- **M** = 2–5 dias
- **L** = 1–2 semanas
- **XL** = > 2 semanas

## Resumo de contagem

| Prioridade | Total |
|---|---|
| P0 (Crítico) | 0 |
| P1 (Alto) | 7 |
| P2 (Médio) | 10 |
| P3 (Baixo) | 10 |
| **Total** | **27** |

Cards por QA: Availability 4 · Deployability 5 · Fault Tolerance 2 · Integrability 5 ·
Modifiability 2 · Performance 2 · Security 3 · Testability 4.
