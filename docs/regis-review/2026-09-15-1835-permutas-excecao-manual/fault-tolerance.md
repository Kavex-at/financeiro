---
qa: Fault Tolerance
qa_slug: fault-tolerance
run_id: 2026-09-15-1835-permutas-excecao-manual
agent: qa-fault-tolerance
generated_at: 2026-09-15T18:35:00-03:00
scope: backend
score: 8.5
findings_count: 6
cards_count: 3
---

# Fault Tolerance — Regis-Review

> **Escopo estrito do delta** (`git diff origin/main..HEAD`, commits `2bcc949…52718a9`).
> QA re-instrumentado para "state consistency under partial failure" (Bass "Safety" não se
> aplica ao domínio). Este delta introduz **classificação humana** sobre um estado calculado:
> risco central é (a) o override esconder um problema real do ERP, (b) marcar/desfazer perder
> atomicidade entre `permuta_excecao_manual` e `permuta_adiantamento`, (c) corrida entre
> marcar e uma ingestão em curso, e (d) a migration 0059 redefinir a guarda de estado
> colapsado da 0055 com `NOT VALID + VALIDATE`. Findings herdados dos runs anteriores
> (`2026-09-08-1955-permutas-baixa-integridade` — reaper de `parcial`, reconciliação
> periódica DB↔ERP; `2026-09-15-0207-permutas-saldo-ordem-centavos` — reuso de `borCod`
> terminal) **não são re-abertos** aqui: o delta não os piora.

## 1. Cenário Geral (Bass General Scenario aplicado ao nf-projects)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Analista admin marca o adto 8721 (R$ 20,4 mi) como "permutado fora do painel" às 12:03, exatamente entre o `listAtivas()` do pós-passe da eleição (~12:02:58) e o `persistIngestRun` da ingestão em curso (~12:03:02) | POST `/permutas/adiantamentos/8721/excecao-manual` **em paralelo** ao cron das 12:00 | `ExcecaoPermutaService.marcar` (tx dedicada com `insertAtiva + reclassificarAdiantamento`) e `IngestaoPermutasService.executar` → `persistIngestRun` (tx com UPSERT de `permuta_adiantamento`) | Prod pós-deploy, 3× ingestões/dia (00/12/20h) + botão manual | Tabela `permuta_excecao_manual` mantém a linha ativa (I-Exc-3 protege via `uq_permuta_excecao_manual_ativa`); a linha em `permuta_adiantamento` pode ficar temporariamente com o estado calculado cru até a próxima ingestão reaplicar (R1 documentado) | **0** exceções órfãs (INSERT rollback junto do UPDATE se o WHERE otimista não casar); **0** duplicatas ativas (índice parcial); janela de inconsistência da linha ≤ ~8h (intervalo entre crons) e **auto-cura garantida** — `EleicaoPermutasService.aplicarExcecoesManuais` roda em toda ingestão |
| ERP muda o dado do 8721 (título reaberto, `valorPermutar` volta a R$ 5.000) entre marcar e a próxima eleição | Cron das 20:00 relê `com298` e o cálculo dá `permuta-manual/cliente-filtro` ou `bloqueada/nao-pago` | `ExcecaoPermutaService.aplicarExcecoes` (pós-passe puro) + `EleicaoPermutasService.aplicarExcecoesManuais` (loga `BUSINESS_WARN`) | Prod, exceção ativa mas guarda I-Exc-1 falha para o estado recalculado | Exceção **NÃO** é aplicada: `estado calculado vence` (D4, I-Exc-2). Um `BUSINESS_WARN` pt-BR distinto para `motivoBloqueio === DETAIL_INDISPONIVEL` (transiente) vs mudança real do ERP | **1** log/run/exceção-inativa (previsível, sem duplicação); **0** rows corrompidas; row do adto reflete o estado do ERP; UI mostra tag "Exceção inativa" (D5) para revisão humana |
| Deploy do backend com a migration 0059 aplicada é REVERTIDO (code volta pré-0059, mas tabela `permuta_excecao_manual` e as CHECKs redefinidas ficam) | Rollback de emergência dos 9 commits do delta | 0059 sem reverse (A4/README rollbacks); as CHECKs `permuta_adiantamento_sem_estado_colapsado` / `permuta_candidata_snapshot_sem_status_colapsado` incluem `permutado-fora-do-painel` no seu conjunto proibido | Prod pós-rollback, 1ª ingestão | O código antigo NUNCA produz o motivo novo, logo a CHECK não bloqueia; a 1ª ingestão reclassifica 8721 → `bloqueada/sem-saldo-permutar` (comportamento pré-delta); a `permuta_excecao_manual` fica órfã até roll-forward | **0** rows violando as CHECKs (verificável via `NOT VALID + VALIDATE` que passou na 0059); **0** perda de dados na tabela de exceções (nada escreve nela no código antigo); UI sem tag até re-deploy — degradação graceful |

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Atomicidade `insertAtiva + reclassificarAdiantamento` em `marcar` | 1 `withTransaction` (`BEGIN/COMMIT/ROLLBACK` em `PostgreeDatabaseClient.withTransaction:136-157`) — INSERT + UPDATE na mesma sessão | 1 tx | ✅ | `ExcecaoPermutaService.ts:136-149`; `PermutaRelationalRepository.ts:621-642` |
| Atomicidade `softDeleteAtiva + reclassificarAdiantamento` em `desfazer` | 1 `withTransaction` — UPDATE (soft delete) + UPDATE (reclassificação) na mesma sessão | 1 tx | ✅ | `ExcecaoPermutaService.ts:174-187` |
| Concurrência otimista no UPDATE (impede reclassificar row cujo estado gravado mudou) | `WHERE doc_cod=$docCod AND NOT stale AND estado_elegibilidade=$deEstado AND motivo_bloqueio=$deMotivo` — 0 rows → throw dentro da tx → rollback do INSERT | WHERE completo + rowCount check | ✅ | `PermutaRelationalRepository.ts:629-633`; `ExcecaoPermutaService.ts:142-148` |
| Unicidade de exceção ativa por adto (I-Exc-3) sob concorrência | `CREATE UNIQUE INDEX ... ON permuta_excecao_manual(adiantamento_doc_cod) WHERE removido_em IS NULL` + captura de `23505` no serviço → 409 | índice parcial + tradução | ✅ | `migrations/0059_excecao_permuta.sql:66-68`; `ExcecaoPermutaService.ts:31,150-156,196-200` |
| Idempotência de duplo-clique em POST (mark) | Sem `Idempotency-Key` cabeçalho; comportamento por defeito: 2ª chamada → 409 via `findAtiva` (linha 131) OU via `23505` no INSERT (linha 152). Fail-fast, sem estado inconsistente | ≥ 409/nova-noop | ✅ (via 409 determinístico) | `ExcecaoPermutaService.ts:131-156`; `routes/permutas.ts:454-483` |
| Idempotência de duplo-clique em DELETE (desfazer) | Sem `Idempotency-Key`; 2ª chamada → `softDeleteAtiva` retorna 0 → `ExcecaoPermutaRecusadaError('excecao-nao-encontrada')` → 404 (contratado) | ≥ 404/nova-noop | ✅ (via 404 determinístico) | `ExcecaoPermutaService.ts:175-181`; `routes/permutas.ts:486-513` |
| Autor gravado a partir do JWT verificado (I-Exc-4, sem input do cliente) | `criadoPor`/`removidoPor` = `req.user.sub` com fallback `req.user.email`; ausência de ambos → 401 `IDENTIDADE_AUSENTE`; body inclui `criadoPor` → ignorado (Zod só valida `justificativa`) | 100% JWT | ✅ | `routes/permutas.ts:436-513`; schema em `routes/permutas.ts:167-176` |
| Auditoria durável (I5): `criado_por/criado_em/removido_por/removido_em` + pareamento | CHECK `((removido_em IS NULL) = (removido_por IS NULL))` + `DEFAULT now()` em `criado_em`; soft delete preserva histórico | par obrigatório + timestamps | ✅ | `migrations/0059_excecao_permuta.sql:41-63` |
| Predicado de guarda I-Exc-1 (fonte única — marcar E aplicar) | Um único método `guardaSatisfeita = (estado, motivo)` consumido em `marcar:123` e `aplicarExcecoes:89`; constantes `ESTADO_DA_GUARDA`/`ESTADO_DA_EXCECAO` do enum | 1 fonte | ✅ | `ExcecaoPermutaService.ts:20-28,72-73,89,123` |
| Detecção de estado mudou no ERP entre marcar e aplicar (D4) | `aplicarExcecoes` empurra aviso `{docCod, estadoCalculado, motivoCalculado, transiente}` → `EleicaoPermutasService.aplicarExcecoesManuais` loga `BUSINESS_WARN` com mensagem distinta por caso | 1 warn/run/exceção-inativa | ✅ | `ExcecaoPermutaService.ts:96-103`; `EleicaoPermutasService.ts:427-455` |
| `detail-indisponivel` (blip do Conexos) não é confundido com mudança real | `transiente: candidata.motivoBloqueio === DETAIL_INDISPONIVEL` + mensagem separada ("transitório, o estado calculado vence") | mensagens distintas | ✅ | `ExcecaoPermutaService.ts:102`; `EleicaoPermutasService.ts:445-448` |
| Justificativa NÃO cai no log (evita PII/detalhe do caso vazar) | `logService.info` grava `{docCod, criadoPor}` apenas; texto fica só no DB | log minimalista | ✅ | `ExcecaoPermutaService.ts:159-163,189-193` |
| Undo só reverte a linha se o motivo gravado é o da exceção (não pisa no ERP) | WHERE de `reclassificarAdiantamento` em `desfazer` usa `ESTADO_DA_EXCECAO`; se ERP venceu, rowCount 0 é OK (só softDelete) | motivo-específico | ✅ | `ExcecaoPermutaService.ts:182-186`; task doc §6 |
| SQL parametrizado (`$nome`) — nenhuma interpolação | 100% `$…` via SqlBuilder; nenhum `${` com dado externo em `ExcecaoPermutaRepository`, `PermutaRelationalRepository.reclassificarAdiantamento`, migration 0059 | Rule #5 | ✅ | `ExcecaoPermutaRepository.ts:29-84`; migration 0059 (SQL estático) |
| Migration 0059 idempotente e sem reverse (A4) | `CREATE TABLE IF NOT EXISTS` + `DROP CONSTRAINT IF EXISTS` + `ADD ... NOT VALID` + `VALIDATE`; aplicada 3× em Postgres 16 local sem erro; `rollbacks.test.ts` intocado (política: reverse só p/ UPDATE > 1.000 linhas) | idempotente | ✅ | `migrations/0059_excecao_permuta.sql:41-100`; `_shared-metrics.md` (Postgres 16 local × 3) |
| Escrita no ERP (I4 / I-Exc-5) | Zero. `ExcecaoPermutaService` não injeta cliente Conexos; rota é DB-only | 0 | ✅ | `ExcecaoPermutaService.ts:60-66` (construtor sem `ConexosClient`) |
| Janela R1 (marcar durante ingestão) — auto-cura na próxima run | `listAtivas()` corre no FIM de `computeCandidatas`, imediatamente antes do UPSERT — janela de segundos, não de minutos. Se perder, exceção fica ativa e a próxima ingestão reaplica | segundos + reaplicação garantida | ⚠️ parcial — sem reaper que detecte se a re-aplicação foi feita | `EleicaoPermutasService.ts:398-410`; task doc R1; ausência de job de audit `permuta_excecao_manual.ativa vs permuta_adiantamento.motivo` |
| Cardinalidade dos `BUSINESS_WARN` de exceção inativa (R3) | 1 warn/run/exceção-inativa × 3 runs/dia = **3 warns/dia por exceção-inativa** até `DELETE`. Com N exceções presas em `inativa`: 3N/dia | por design | ⚠️ observabilidade | task doc R3; `EleicaoPermutasService.ts:441-455` |
| Runbook de rollback com 0059 aplicada (R4) | Documentado no cabeçalho da 0059 e no task doc, mas **não** em `docs/` operacional (DEPLOY.md ou runbook do time) | runbook presente | ⚠️ ausente | `migrations/0059_excecao_permuta.sql:23-35`; `DEPLOY.md` (sem menção a R4) |
| Baseline de testes do delta | Backend: 137 suites / 2012 testes · Frontend: 43 suites / 361 testes · **0 falhas** · typecheck 0 · lint 0 | verde | ✅ | `_shared-metrics.md` "Gate results at green" |

⚠️ **Não medível localmente**: contagem exata de rows em `permuta_candidata_snapshot` na produção do cliente (Supabase). A migration 0059 faz `ALTER TABLE ... ADD CONSTRAINT ... NOT VALID; ... VALIDATE CONSTRAINT ...` na tabela do snapshot, que tem retenção multi-run. `VALIDATE` toma `SHARE UPDATE EXCLUSIVE`, que permite reads/writes concorrentes — o DDL não trava a ingestão — mas o tempo de scan é proporcional ao volume. Recomendação: rodar `SELECT COUNT(*) FROM permuta_candidata_snapshot` na dev do cliente antes do deploy e anexar ao PR (F-fault-tolerance-2).

⚠️ **Não medível localmente**: taxa de "exceção inativa por mudança real no ERP" vs "por `detail-indisponivel`". Só observável em produção via contagem dos `BUSINESS_WARN` `transiente` vs não-`transiente` numa janela pós-deploy (F-fault-tolerance-4).

## 3. Tactics — Cobertura no nf-projects

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Substitution / Replacement | N/A — override manual não tem redundância por design (é decisão humana única) | N/A | — |
| Predictive Model | Guarda I-Exc-1 (`guardaSatisfeita`) impede tanto a criação quanto a aplicação sobre estados que não são `bloqueada/sem-saldo-permutar` — impede overwrite de saldo real, falta de pagamento, D.I. ausente e invoice ausente ANTES de gravar | ✅ | `ExcecaoPermutaService.ts:72-73,89,123` |
| Increase Competence Set | Fail-closed universal: `findAdiantamento === null` OU `stale=true` → 404; guarda falha → 422; `findAtiva` non-null → 409; `reclassificarAdiantamento` retorna 0 → 422 dentro da tx; ausência de `req.user.sub`/`email` → 401 (sem `'unknown'` que virasse fantasma na trilha) | ✅ | `ExcecaoPermutaService.ts:117-133`; `routes/permutas.ts:432-451` |
| Sanity Checking | Zod no boundary (10 ≤ `justificativa` ≤ 500, trim); CHECK gêmea no banco (`justificativa_tamanho`, `remocao_pareada`); CHECK anti-estado-colapsado (0055 estendida) rejeita `bloqueada + permutado-fora-do-painel` como violação de integridade | ✅ | `routes/permutas.ts:167-176`; `migrations/0059_excecao_permuta.sql:54-63,71-92` |
| Comparison | O pós-passe da eleição SEMPRE recomputa o estado calculado sobre o dado do ERP (relido) e compara com a guarda — a exceção nunca "vence" um cálculo positivo (D4). Se estado ≠ `bloqueada/sem-saldo-permutar`: exceção fica registrada mas **não aplicada**, log emitido | ✅ | `ExcecaoPermutaService.ts:81-107`; `EleicaoPermutasService.ts:427-455` |
| Timestamp | `criado_em/removido_em` com `DEFAULT now()` (Postgres relógio único); `stale` em `permuta_adiantamento` protege a guarda contra ler backlog velho | ✅ | `migrations/0059_excecao_permuta.sql:46-48`; `PermutaRelationalRepository.ts:632` (`AND NOT stale`) |
| Timeout | Herdado (`ConexosClient`, fora do delta); rotas admin passam pelo `heavyRouteLimiter` em `/eleicao` e `/ingestao` — não em `/excecao-manual` (que é DB-only, sem fan-out) | ✅ (herdado, adequado) | `routes/permutas.ts:454,486` |
| Condition Monitoring | 1 `BUSINESS_WARN` por exceção-inativa em cada run — visível no CloudWatch/Vercel logs; mas **não** existe métrica agregada nem reaper que detecte `permuta_excecao_manual ativa AND permuta_adiantamento.motivo ≠ 'permutado-fora-do-painel'` como estado transiente que ficou preso | ⚠️ parcial | `EleicaoPermutasService.ts:441-455`; ausência de job — ver F-fault-tolerance-1 |
| Self-Test / Voting | N/A | N/A | — |
| Redundancy | N/A (override é 1:1 humano) | N/A | — |
| Rollback (backward) | Marcar/desfazer usam `withTransaction` e a corrida perdida (`reclassificarAdiantamento` retorna 0) lança dentro da tx → o INSERT do `permuta_excecao_manual` é revertido junto. Rollback do DEPLOY é forward-only (0059 sem reverse) mas o dado é preservado (R4) | ✅ | `ExcecaoPermutaService.ts:136-156`; `PostgreeDatabaseClient.ts:142-156` |
| Repair State / Reintroduction | Auto-cura por re-execução: toda ingestão (3×/dia + botão) re-lê o ERP, re-computa e re-aplica exceções ativas — R1 se cura em uma janela. `permuta_excecao_manual.ativa` é a fonte durável | ✅ | `EleicaoPermutasService.ts:398-410,427-455`; `IngestaoPermutasService.ts:74-122` |
| Idempotent Replay | `aplicarExcecoes` é 100% puro (mesma entrada ⇒ mesma saída, `map` sem side-effects). `insertAtiva` bloqueado por índice parcial (2ª tentativa vira 409, não INSERT duplicado). `softDeleteAtiva` idempotente (2ª chamada devolve rowCount=0 → 404) | ✅ | `ExcecaoPermutaService.ts:81-107`; `ExcecaoPermutaRepository.ts:55-84`; `migrations/0059_excecao_permuta.sql:66-68` |
| Compensating Transaction | N/A explícito — o delta é DB-only (I-Exc-5). Não há passo externo a compensar. A "compensação" no cenário R1 é a re-aplicação natural na próxima ingestão (forward recovery), não um `revert` explícito | ✅ (forward recovery é a escolha certa) | ADR-0047 §D6; task doc R1 |
| Reconcile (Gray & Reuter §11) | O compute único da eleição É a reconciliação por natureza (recomputa contra ERP a cada run). Não existe job que audite pares `(excecao ativa) ↔ (adto na tabela relacional)` fora da eleição — se a eleição estivesse pausada, o desvio ficaria invisível | ⚠️ herdado (mesma dívida do run 2026-09-08-1955) — não piorado pelo delta | `EleicaoPermutasService.ts:427-455`; ausência de reaper específico da exceção |
| Quarantine | "Exceção inativa" (D5) É uma quarentena visual: a linha permanece com estado real do ERP + tag "Exceção inativa" — o analista vê que o override não vale mais, sem que a UI mascare o problema | ✅ | ADR-0047 §D4-D5; frontend `ui.tsx` tag `ExcecaoManualTag` (task doc §8) |

## 4. Findings (achados)

### F-fault-tolerance-1: Não existe reaper que confirme que exceções ativas estão de fato aplicadas na linha do adto (R1 auto-cura, mas cegamente)

- **Severidade**: P2
- **Tactic violada**: Condition Monitoring / Reconcile
- **Localização**: ausência de job — `src/backend/jobs/` não tem verificador da invariante `permuta_excecao_manual.ativa ⇔ permuta_adiantamento.motivo='permutado-fora-do-painel' (ou aviso emitido)`; comportamento vive em `EleicaoPermutasService.ts:427-455` (correção in-flight) sem auditoria externa
- **Evidência (objetiva)**:
  ```
  # nenhum resultado
  grep -rn "permuta_excecao_manual" src/backend/jobs/
  # a única leitura de listAtivas() fora do serviço é a Gestão (read-only, para UI):
  src/backend/domain/service/permutas/GestaoPermutasService.ts:102: this.excecaoPermutaRepository.listAtivas(),
  # e o pós-passe da eleição:
  src/backend/domain/service/permutas/EleicaoPermutasService.ts:437: const ativas = await this.excecaoPermutaRepository.listAtivas();
  ```
- **Impacto técnico**: Se as ingestões pararem (cron caído, ERP indisponível por várias janelas, `IngestLockBusy` recorrente), uma exceção nova marcada durante a última ingestão saudável pode ficar com a linha do adto em `bloqueada/sem-saldo-permutar` (raw) indefinidamente — a marcar TX escreveu `ja-permutado/permutado-fora-do-painel` mas a ingestão sobrescreveu, e a próxima não chega. A tabela `permuta_excecao_manual` fica correta, o adto **não fica corrompido**, só divergente em relação à intenção do analista.
- **Impacto de negócio**: Adto R$ 20 mi aparece em "Bloqueadas" (falso positivo) mesmo com override registrado. Analista pode retrabalhar em cima do mesmo docCod pensando que a marcação falhou. Retrabalho e ruído na fila, sem prejuízo monetário direto.
- **Métrica de baseline**: janela de exposição = intervalo entre ingestões saudáveis; com cron 3×/dia + botão, 99º percentil ≈ 8h. Frequência de R1 = probabilidade de POST `/excecao-manual` durante os segundos finais de uma ingestão. Não medível localmente; anexar ao PR o número de runs por dia pós-deploy.

### F-fault-tolerance-2: Migration 0059 faz `NOT VALID + VALIDATE` em `permuta_candidata_snapshot` sem baseline de row count em produção

- **Severidade**: P2
- **Tactic violada**: Predictive Model (janela de deploy não modelada)
- **Localização**: `src/backend/migrations/0059_excecao_permuta.sql:96-100`
- **Evidência (objetiva)**:
  ```
  ALTER TABLE permuta_candidata_snapshot
      VALIDATE CONSTRAINT permuta_candidata_snapshot_sem_status_colapsado;
  ```
- **Impacto técnico**: `VALIDATE CONSTRAINT` toma `SHARE UPDATE EXCLUSIVE` (permite reads e writes concorrentes, bloqueia só outros DDL / VACUUM FULL / ANALYZE), então NÃO trava a ingestão. Porém faz full table scan da snapshot, que cresce a cada run (retenção histórica); em cliente com meses de histórico, pode levar dezenas de segundos a poucos minutos e disputar I/O. `DROP CONSTRAINT` + `ADD ... NOT VALID` prévios tomam `ACCESS EXCLUSIVE` por instantes (milissegundos).
- **Impacto de negócio**: Pico de latência transitório em queries que compartilham buffers de `permuta_candidata_snapshot` durante o deploy. Sem risco de dado corrompido (o `NOT VALID` já entrou, ninguém consegue inserir uma linha em violação depois).
- **Métrica de baseline**: `SELECT count(*) FROM permuta_candidata_snapshot` na dev do cliente — desconhecido. Task doc registra que 0059 nunca foi aplicada no Supabase compartilhado. Sem número: P2, não P1.

### F-fault-tolerance-3: Rotas POST/DELETE `/excecao-manual` não honram `Idempotency-Key` (mitigação existe por 409/404, mas não é explícita)

- **Severidade**: P2
- **Tactic violada**: Idempotent Replay (por chave explícita)
- **Localização**: `src/backend/routes/permutas.ts:453-513`
- **Evidência (objetiva)**:
  ```
  # /eleicao aceita Idempotency-Key (routes/permutas.ts:206-212). /excecao-manual não:
  grep -n "Idempotency-Key" src/backend/routes/permutas.ts
  204:        // Idempotency-Key (P0-6) — duplo-clique/retry com a mesma key reaproveita
  206:        const rawKey = req.header('Idempotency-Key');
  # nada em /excecao-manual
  ```
- **Impacto técnico**: Duplo-clique do analista dispara dois POSTs. O 2º cai em 409 (via `findAtiva` linha 131 ou `23505` linha 152) sem escrever nada — comportamento seguro. Retentativa após timeout de rede pelo cliente sem confirmação da 1ª resposta: se a 1ª foi aceita e o cliente não recebeu o 200, o 2º dá 409 e o UI reporta "já existe exceção ativa" (mensagem confunde — parece que outro analista marcou primeiro).
- **Impacto de negócio**: UX confusa em retentativas por rede instável. Nenhum risco de duplicação ou dado errado.
- **Métrica de baseline**: 0 rotas de mutação de exceção com `Idempotency-Key`; 1 rota do repo aceita (`POST /permutas/eleicao`).

### F-fault-tolerance-4: `BUSINESS_WARN` de exceção-inativa emitido em toda run sem taxa de descarte / dedup por docCod (R3)

- **Severidade**: P3
- **Tactic violada**: Condition Monitoring (ruído em vez de sinal)
- **Localização**: `src/backend/domain/service/permutas/EleicaoPermutasService.ts:441-455`
- **Evidência (objetiva)**:
  ```
  for (const aviso of avisos) {
      await this.logService.warn({
          type: LOG_TYPE.BUSINESS_WARN,
          message: aviso.transiente ? '...' : 'Exceção manual de permuta não aplicada: ...',
          data: { flowId, docCod: aviso.docCod, estadoCalculado, motivoCalculado, transiente },
      });
  }
  ```
- **Impacto técnico**: Uma exceção ativa que ficou "inativa" (ERP venceu ou blip) emite 1 warn por run — 3 warns/dia até `DELETE`. Se o analista deixar a exceção sem desfazer, o log acumula. Deployments com o Sentry/CloudWatch configurados podem paginar em cima do primeiro `BUSINESS_WARN` e, sem dedup, gerar N alertas idênticos.
- **Impacto de negócio**: Alarm fatigue. Sinal de "algo mudou no ERP" (importante) diluído em ruído periódico.
- **Métrica de baseline**: 3× ingestões/dia × N exceções-inativas = 3N warns/dia. Task doc explicita "intencional" — R3.

### F-fault-tolerance-5: Runbook operacional de rollback com 0059 aplicada (R4) não está em `DEPLOY.md`

- **Severidade**: P3
- **Tactic violada**: Recovery (procedimento humano)
- **Localização**: `DEPLOY.md` (sem menção); apenas cabeçalho da migration e task doc registram R4
- **Evidência (objetiva)**:
  ```
  grep -n "0059\|excecao_permuta\|permutado-fora-do-painel" DEPLOY.md
  # (sem resultado)
  ```
- **Impacto técnico**: Emergência de rollback exige leitura da migration + task doc para entender que a tabela sobrevive e a próxima ingestão devolve o 8721 a `bloqueada`. Sem runbook explícito, on-call arrisca aplicar `DROP TABLE` desnecessário.
- **Impacto de negócio**: MTTR de rollback aumenta em minutos (não horas). Nenhum risco de perda de dado se seguido o rollback correto (drop de código).
- **Métrica de baseline**: 0 seções em `DEPLOY.md` mencionando o delta.

### F-fault-tolerance-6: Justificativa (10-500 chars) fica só em `permuta_excecao_manual` — sem backup independente

- **Severidade**: P3
- **Tactic violada**: Redundancy (do dado de auditoria)
- **Localização**: `src/backend/domain/service/permutas/ExcecaoPermutaService.ts:159-163`
- **Evidência (objetiva)**:
  ```
  await this.logService.info({
      type: LOG_TYPE.BUSINESS_INFO,
      message: 'exceção manual de permuta registrada (permutado fora do painel)',
      data: { docCod, criadoPor },
  });
  # justificativa OMITIDA de propósito (evitar PII no log)
  ```
- **Impacto técnico**: A justificativa é o motivo humano do override. Se `permuta_excecao_manual` for corrompida por falha de disco / mistake de migration futura, o "por quê" some. Backup de Postgres cobre, mas não há trilha em outra mídia.
- **Impacto de negócio**: Auditoria fiscal / contábil pode requerer o motivo escrito por dias/anos. Postgres backup do cliente cobre; é decisão intencional de segurança (não vazar PII no log agregado).
- **Métrica de baseline**: 0 mídias secundárias para a justificativa. Decisão consciente — documentar como escolha de trade-off privacidade × redundância.

## 5. Cards Kanban

### [fault-tolerance-1] Reaper que audita a invariante `excecao ativa ⇔ adto reclassificado ou aviso emitido`

- **Problema**
  > Se a série de ingestões travar (Conexos indisponível, `IngestLockBusy` recorrente, cron caído), uma exceção marcada durante os segundos finais da última ingestão saudável pode ficar com a linha do adto em `bloqueada/sem-saldo-permutar` (R1) e nunca ser re-aplicada. O adto aparece em "Bloqueadas" no painel apesar do override registrado, sem sinal claro pro time. A tabela `permuta_excecao_manual` fica correta; o desvio está entre ela e `permuta_adiantamento`.
- **Melhoria Proposta**
  > Adicionar um job (EventBridge/cron horário, ou task existente reaproveitada) que faz uma query única:
  > `SELECT e.adiantamento_doc_cod FROM permuta_excecao_manual e JOIN permuta_adiantamento a USING (adiantamento_doc_cod) WHERE e.removido_em IS NULL AND NOT a.stale AND a.estado_elegibilidade='bloqueada' AND a.motivo_bloqueio='sem-saldo-permutar' AND a.last_seen_at < now() - interval '4 hours';`
  > Cada linha vira um `BUSINESS_WARN type=EXCECAO_NAO_APLICADA_STUCK` com `docCod` + `last_ingest_run_id`. Não corrigir automaticamente — a exceção pode estar validamente inativa por mudança no ERP; o sinal é diagnóstico. Tactic: Condition Monitoring + Reconcile.
- **Resultado Esperado**
  > Toda invariante violada por mais de 4h vira 1 alerta identificável. MTTD de "exceção grudou em bloqueada" cai de "indeterminado (só descoberto na tela)" para "≤ 4h".
- **Tactic alvo**: Condition Monitoring / Reconcile
- **Severidade**: P2
- **Esforço estimado**: S (≤ 1d)
- **Findings relacionados**: F-fault-tolerance-1
- **Métricas de sucesso**:
  - Warns `EXCECAO_NAO_APLICADA_STUCK`/semana: sem instrumentação atual → linha de base ≥ 0
  - Latência de detecção (marcar → warn): indefinida → ≤ 4h
- **Risco de não fazer**: R$ 20 mi ficam em "Bloqueadas" com aparência de bug sistêmico se um cron falhar; retrabalho manual.
- **Dependências**: nenhuma (leituras já existem).

### [fault-tolerance-2] Medir e documentar `permuta_candidata_snapshot` antes de aplicar a 0059 na produção do cliente

- **Problema**
  > 0059 faz `ALTER TABLE ... ADD CONSTRAINT ... NOT VALID; VALIDATE CONSTRAINT ...` em `permuta_candidata_snapshot`, que tem retenção histórica multi-run. Em cliente com meses de eleições acumuladas, o full scan da `VALIDATE` pode disputar I/O com a ingestão em paralelo. Sem baseline, o time não sabe se o deploy é 200ms ou 3 min de pico.
- **Melhoria Proposta**
  > Antes do deploy: rodar `SELECT count(*), pg_size_pretty(pg_total_relation_size('permuta_candidata_snapshot'))` na dev do cliente (mais próxima da prod que temos). Anexar ao PR. Se > 5M rows, aplicar a `VALIDATE` durante janela de manutenção (fora dos cron das 12/20h). Tactic: Predictive Model.
- **Resultado Esperado**
  > Deploy da 0059 com janela de I/O medida e planejada; nenhuma surpresa de latência pico.
- **Tactic alvo**: Predictive Model
- **Severidade**: P2
- **Esforço estimado**: S (≤ 1d — só medir e anexar)
- **Findings relacionados**: F-fault-tolerance-2
- **Métricas de sucesso**:
  - Row count medido: desconhecido → conhecido e anexado ao PR
  - Tempo estimado de `VALIDATE` na prod: sem estimativa → estimativa documentada
- **Risco de não fazer**: pico de I/O silencioso na hora do deploy; se coincidir com ingestão, ingest pode ficar mais lenta e alarmar.
- **Dependências**: acesso read-only à dev do cliente (padrão do time).

### [fault-tolerance-3] Runbook de rollback do delta `permutas-excecao-manual` em `DEPLOY.md`

- **Problema**
  > R4 (rollback do backend com 0059 aplicada) está documentado no cabeçalho da migration e no task doc, mas não em `DEPLOY.md`. Em incidente com pressão de tempo, on-call pode: (a) tentar rodar reverse manual da 0059 (não existe, `rollbacks.test.ts` proíbe); (b) executar `DROP TABLE permuta_excecao_manual` desnecessariamente; (c) reverter só a UI e deixar as CHECKs redefinidas sem entender a semântica.
- **Melhoria Proposta**
  > Adicionar seção em `DEPLOY.md`:
  > 1. Rollback é **forward-only** (0059 sem reverse — política do `rollbacks/README.md`).
  > 2. Revert dos 9 commits do delta = safe. Tabela sobrevive (código antigo nunca escreve nela); CHECKs redefinidas seguem válidas (código antigo nunca produz `permutado-fora-do-painel`).
  > 3. Primeira ingestão pós-rollback devolve 8721 a `bloqueada/sem-saldo-permutar`; nenhum dado corrompe.
  > 4. Roll-forward posterior reaproveita as exceções gravadas.
  > Tactic: Recovery (procedimento humano).
- **Resultado Esperado**
  > MTTR de rollback do delta cai de "leitura de migration + task doc + inferência" para "seção pronta em `DEPLOY.md`".
- **Tactic alvo**: Recovery / Rollback
- **Severidade**: P3
- **Esforço estimado**: S (≤ 1d — só documentar)
- **Findings relacionados**: F-fault-tolerance-5
- **Métricas de sucesso**:
  - Seções sobre rollback do delta em `DEPLOY.md`: 0 → 1
- **Risco de não fazer**: se ninguém do time original estiver de plantão, decisões erradas de rollback (drop table, revert parcial) que podem cronificar o incidente.
- **Dependências**: nenhuma.

## 6. Notas do agente

- **Escopo estrito ao delta.** Findings herdados (reaper de `parcial`, reconciliação periódica DB↔ERP, reuso de `borCod`) NÃO foram re-abertos — nenhum piorou. Cross-QA: F-fault-tolerance-1 (reaper) tangencia Testability (não existe teste de invariante "excecao ativa ⇔ adto reclassificado") e Availability (MTTD).
- **Sem P0.** A dupla-escrita (`insertAtiva` + `reclassificarAdiantamento`) está numa única `withTransaction` com trava otimista no WHERE — o cenário "insert grava mas reclassify perde" é impossível: se o UPDATE devolve 0, o serviço lança dentro da tx e o INSERT é revertido junto (`ExcecaoPermutaService.ts:146-148`). A guarda I-Exc-1 é predicado único (`guardaSatisfeita`), consumido em ambos os call sites. O 401 sem `'unknown'` (task doc §2) elimina o fantasma na auditoria. Undo só reverte se o motivo é `permutado-fora-do-painel` — não pisa em resultado que o ERP venceu. `detail-indisponivel` tem mensagem própria (não parece mudança real). Migration 0059 aplicada 3× local sem erro; `VALIDATE` toma lock não-bloqueante para reads/writes.
- **Cross-QA a marcar no consolidator**: F-fault-tolerance-2 (VALIDATE lock) espelha Performance (janela de deploy); F-fault-tolerance-3 (idempotency-key) espelha Availability (retentativa em rede instável); F-fault-tolerance-6 (justificativa só no DB) espelha Security (auditabilidade).
- **Score 8.5** — mantido em relação ao run anterior (`2026-09-15-0207` também 8.5). Delta não piora nenhum eixo; adiciona pequenas dívidas de Condition Monitoring e Predictive Model (nenhuma bloqueia). Prior review continua sendo a fonte para findings herdados.
