---
type: regis-review-kanban
run_id: 2026-09-15-0207-permutas-saldo-ordem-centavos
total: 23
counts: { p0: 0, p1: 0, p2: 14, p3: 9 }
---

# Kanban — financeiro — 2026-09-15-0207-permutas-saldo-ordem-centavos

> Importável para o Kanban do time. Cada card abaixo já tem Problema / Melhoria Proposta / Resultado Esperado.
> Ordem: P0 (nenhum) → P1 (nenhum) → P2 (S → M) → P3 (S).
> IDs em kebab-case; taxonomia de estados em inglês; textos em pt-BR.
> Cards que apareceram em >1 QA foram consolidados; a linha `QA` lista todas as fontes.
> Um card foi resolvido no próprio pipeline (`bump-versao-v0.36.5`) — marcado como `RESOLVIDO PELO PIPELINE` e NÃO deve ir para o inbox de follow-ups.

---

## P0 — Crítico

_Nenhum. Justificativa na §1 e §7 do REPORT.md._

---

## P1 — Alto

_Nenhum. Justificativa na §1 do REPORT.md — nenhum finding cumpre os dois testes (bloqueia merge + dano concreto se merge for feito)._

---

## P2 — Médio

### [comment-atualizado-em] Documentar em SQL a nova semântica de `permuta_bordero.atualizado_em` (COMMENT ON COLUMN)

**QA**: Integrability (consolida `integrability-1`)
**Tactic alvo**: Adhere to Standards (Bass, Limit Dependencies)
**Esforço**: S
**Findings**: F-integrability-1

**Problema**
> A coluna `permuta_bordero.atualizado_em` mudou de "carimbo de refresh" (bump em todo `UPSERT`) para "carimbo de última mudança de situação" (só quando `bor_vld_finalizado`/`bor_cod_estornado` diferem — `PermutaExecucaoRepository.ts:577-587`). É a base da guarda de frescor da regra D3 do ADR-0046. Qualquer leitor externo à aplicação (dashboard "última atualização", alerta "cache frio > 6h") continua consultando `MAX(atualizado_em)` sem sinal, e passa a ver borderôs "envelhecidos" que na verdade foram relidos hoje. Mesma classe de defeito da mudança de domínio de `permuta_candidata_snapshot.status` do ciclo anterior — menor blast radius, mesmo formato.

**Melhoria Proposta**
> (a) Migration nova `0058_permuta_bordero_atualizado_em_comment.sql`: `COMMENT ON COLUMN permuta_bordero.atualizado_em IS 'ADR-0046 (2026-09-14): carimbo de última mudança de bor_vld_finalizado/bor_cod_estornado, NÃO de refresh. É a base da guarda de frescor da soma de alocações consumidas — refresh sem mudança de situação NÃO atualiza este campo.'`. (b) Opcional, se algum consumidor externo for identificado: `CREATE VIEW permuta_bordero_com_ultimo_refresh AS SELECT b.*, GREATEST(b.atualizado_em, r.started_at) AS ultimo_refresh_em FROM permuta_bordero b LEFT JOIN LATERAL (...) r`.

**Resultado Esperado**
> Ferramenta externa (DBeaver, Metabase, `psql \d+`) mostra a nota da ADR-0046 no schema; leitor externo com dúvida sobre "quando este borderô foi visto pela última vez" tem pista em SQL, não só no docblock TS.

**Métricas de sucesso**
- `COMMENT ON COLUMN permuta_bordero.atualizado_em` presente: 0 → 1
- Migrations do delta que tocam `permuta_bordero` com nota de mudança semântica: 0 → 1

**Risco de não fazer**
> Pequeno enquanto o único consumidor conhecido é in-repo; cresce se algum dashboard externo do cliente usar a coluna. Mesma classe do card `[integrability-1]` do run 2026-09-08, custo similar.

**Dependências**: pode ir junto com o card `[integrability-1]` do ciclo anterior (2026-09-08-2011), que já propunha política de `COMMENT ON` em migrations de mudança semântica.

---

### [perf-indices-listconsumos] EXPLAIN ANALYZE + `durationMs` + índices dedicados para `listConsumosFinalizados`

**QA**: Availability + Performance (consolida `availability-3`, `performance-1`, `performance-2`)
**Tactic alvo**: Reduce Overhead + Index discipline + Predictive Model
**Esforço**: S
**Findings**: F-availability-3, F-performance-1, F-performance-2

**Problema**
> A query nova do hot path (`GET /permutas/gestao` — 8ª do `Promise.all`) une 4 tabelas com 5 cláusulas de filtro. Índices que apoiam hoje: 4 PK joins + `idx_...status`. Ausentes: `permuta_adiantamento.last_ingest_run_id` (FK sem índice), `permuta_bordero (bor_vld_finalizado, bor_cod_estornado)`, e possível índice parcial `permuta_alocacao_execucao (adiantamento_doc_cod) WHERE dry_run = false AND status IN ('settled','parcial')`. Nenhum `EXPLAIN ANALYZE` foi capturado; nenhum `durationMs` está no log. Cardinalidades declaradas em prod (250/500-2k/800/250) sugerem custo baixo hoje, mas qualquer decisão de indexação vira palpite sem número.

**Melhoria Proposta**
> (1) Rodar `EXPLAIN (ANALYZE, BUFFERS)` do `listConsumosFinalizados` em staging/pooler com dados atuais. (2) Wrap do `Promise.all` do `exporGestao` com `const t0 = performance.now()...` e adicionar `durationMs` ao `logService.info('permuta gestao served', ...)`. (3) Depois de 24h de dados, criar `CREATE INDEX IF NOT EXISTS idx_permuta_adiantamento_last_ingest_run ON permuta_adiantamento (last_ingest_run_id) WHERE last_ingest_run_id IS NOT NULL` (migration idempotente, `CREATE INDEX CONCURRENTLY`). Criar índices adicionais SOMENTE se o plano mostrar seqscan dominante — decisão explícita de não criar também é aceitável, registrada em ADR/inbox.

**Resultado Esperado**
> Log de p50/p95/p99 de `/permutas/gestao` disponível no LogService. EXPLAIN ANALYZE do JOIN documentado. Índices criados APENAS se justificados por número. Plan estável mesmo quando volume dobrar.

**Métricas de sucesso**
- Duração média `listConsumosFinalizados()` (adto=NULL): desconhecida → medida em ms
- p95 `/permutas/gestao`: desconhecida → medida; alvo < 1500 ms
- EXPLAIN ANALYZE colado em ADR/inbox: ausente → presente
- FK indexada: `pg_indexes WHERE tablename='permuta_adiantamento' AND indexdef LIKE '%last_ingest_run_id%'`: 0 → 1

**Risco de não fazer**
> A próxima duplicação do volume de execução (rotina de 6-12 meses) vira degradação silenciosa; só descoberta pela queixa do analista.

**Dependências**: acesso a staging/PRD para EXPLAIN.

---

### [detectar-reuso-borcod] Instrumentar detecção de reuso de `bor_cod` para execuções terminais

**QA**: Fault Tolerance (consolida `fault-tolerance-1`)
**Tactic alvo**: Sanity Checking + Condition Monitoring
**Esforço**: S
**Findings**: F-fault-tolerance-2

**Problema**
> `listConsumosFinalizados` (`PermutaExecucaoRepository.ts:188-211`) casa execução↔borderô por `(fil_cod, bor_cod)`. Prod já mostra reuso de `bor_cod` para execuções `error` (documentado em `clearBorCod:288-296`); não temos evidência de reuso PARA execuções terminais (`settled`/`parcial`), mas o cenário requer só 3 condições: estorno do borderô original + reuso do número + finalização do novo. Se ocorrer, o `saldoRestante` do adto antigo é OVERSTATED em `valorAlocado` (execução antiga é contada como consumida indevidamente), habilitando super-alocação — a única defesa a jusante é a pré-checagem I-Write-8a por título da INVOICE, que não confere `mnyTitPermutar` do ADTO.

**Melhoria Proposta**
> (1) Query de detecção diária: `SELECT (fil_cod, bor_cod), COUNT(DISTINCT adiantamento_doc_cod) AS adtos_distintos FROM permuta_alocacao_execucao WHERE bor_cod IS NOT NULL AND status IN ('settled', 'parcial') GROUP BY 1 HAVING COUNT(DISTINCT adiantamento_doc_cod) > 1`. Qualquer resultado indica reuso terminal e é alerta imediato. (2) Se aparecer, avaliar `clearBorCod` também para `settled/parcial` cujo `permuta_bordero.bor_cod_estornado IS NOT NULL` no momento da chamada, migrando o `bor_cod` para uma coluna histórica (`bor_cod_original`). (3) Enquanto isso, esta detecção não bloqueia release; entra como job/relatório no `_inbox` de operação.

**Resultado Esperado**
> Casos de reuso terminal detectados em ≤ 24h. Se `adtos_distintos > 1` = alerta operacional.

**Métricas de sucesso**
- Query de detecção: ausente → presente + agendada
- `permuta_bordero_reuso_terminal_count`: N/A → 0 esperado

**Risco de não fazer**
> Super-alocação silenciosa sobre adto cuja execução casou com bordero de OUTRO adto. Recuperação existe (próxima ingestão relê `mnyTitPermutar`), mas janela ≤ 6h de exposição.

**Dependências**: nenhuma.

---

### [validador-write-guards] Enforçar `CONEXOS_WRITE_ENABLED=false`/`CONEXOS_DRY_RUN=true` no `main()` do validador AO VIVO

**QA**: Security (consolida `security-1`)
**Tactic alvo**: Change Default Settings + Limit Exposure
**Esforço**: S
**Findings**: F-security-1

**Problema**
> `jobs/validate-permutas-saldo-ordem-centavos-v1.ts:54-57` documenta no docblock que o validador deve rodar com `CONEXOS_WRITE_ENABLED=false CONEXOS_DRY_RUN=true PROBE_ALLOW_PRD=1`, mas apenas o guard de URL (`PROBE_ALLOW_PRD`) e a `SET TRANSACTION READ ONLY` do banco são checados no código. Hoje isso não vaza (o script só chama endpoints GET/list do Conexos). Amanhã, um desenvolvedor que copie este arquivo como template para uma outra sonda e acrescente uma chamada de escrita "temporária" passa a rodar com o `CONEXOS_WRITE_ENABLED=true` do próprio `.env` (default de trabalho no backend) sem alarme.

**Melhoria Proposta**
> Duas linhas defensivas no topo do `main()`:
> ```typescript
> if (process.env.CONEXOS_WRITE_ENABLED !== 'false') { console.error('RECUSADO: rode com CONEXOS_WRITE_ENABLED=false'); process.exit(1); }
> if (process.env.CONEXOS_DRY_RUN !== 'true') { console.error('RECUSADO: rode com CONEXOS_DRY_RUN=true'); process.exit(1); }
> ```
> Se preferir centralizar (padrão para futuras sondas), extrair `requireReadOnlyEnv()` em `src/backend/jobs/_shared/readOnlyEnv.ts` e chamar dos scripts `validate-*` e `probe-*`.

**Resultado Esperado**
> Os 3 guards documentados passam a ser 3 guards executados. Guards do validador enforçados vs. documentados: 2/3 → 3/3.

**Métricas de sucesso**
- Env vars checadas no início do `main()`: 1 (`PROBE_ALLOW_PRD`) → 3 (`+CONEXOS_WRITE_ENABLED`, `+CONEXOS_DRY_RUN`)
- Sondas futuras que reusam o padrão (via `_shared/readOnlyEnv.ts`, se adotado): 0 → N

**Risco de não fazer**
> Em 6 meses, um `probe-*.ts` ou `validate-*.ts` novo é escrito a partir deste template e um desenvolvedor acrescenta um `POST` "só pra testar" com o `.env` do backend. A escrita vai para PRD sob a identidade do operador. É a versão sonda-AO-VIVO do bug que a Regis-Review da ADR-0043 já pegou (asserção fraca em RBAC): defesa "documentada" que nunca foi exercitada é decorativa.

**Dependências**: nenhuma.

---

### [validador-classificacao-test] Teste unitário à função de classificação do `validate-permutas-saldo-ordem-centavos-v1.ts` (canary sobre sinal do delta)

**QA**: Testability (consolida `testability-3`)
**Tactic alvo**: Executable Assertions
**Esforço**: S
**Findings**: F-testability-3

**Problema**
> O script ground-truth (736 LOC) importa a lógica de produção — grande vitória sobre PR #111 — mas a **classificação** (EXATO / OK_CENTAVO / DIVERGENTE / EXPLICADO / SEM_GROUND_TRUTH, baseada em `TOL = 0.01` e no sinal do delta) não tem teste. Se em manutenção futura alguém inverter `esperado − nosso` por `nosso − esperado`, o veredito "DIVERGENTE (perigoso)" vira "EXPLICADO (conservador)" e o script relata 0 DIVERGENTE em produção — falso-verde. Padrão do repo (`find src/backend/jobs -name 'validate-*.test.ts'` vazio) tolera one-shots, mas este script é o único guardião de duas invariantes do banco (F-testability-1) que hoje não têm cobertura de integração.

**Melhoria Proposta**
> Extrair a função de classificação para módulo puro (`classificarLinhaGroundTruth`), importável tanto pelo script quanto por teste. Adicionar `validate-permutas-saldo-ordem-centavos-v1.test.ts` com 4 casos canary: (a) `(nosso=100, esperado=100)` → EXATO; (b) `(100, 100.005)` → OK_CENTAVO; (c) `(100, 90)` → DIVERGENTE; (d) `(100, 110)` → EXPLICADO. Documentar o sinal esperado na docstring da função.

**Resultado Esperado**
> Função de classificação testada: **0** → **≥4 casos canary**. Uma inversão de sinal futura cai vermelho em CI antes de virar 0 DIVERGENTE-com-falso-verde em produção.

**Métricas de sucesso**
- Testes cobrindo a classificação do ground-truth: 0 → **4**
- Vertentes do veredito com canary: **0/5** → **4/5** (SEM_GROUND_TRUTH é degenerado)

**Risco de não fazer**
> Dado que o ground-truth ao vivo é hoje a única defesa contra F-testability-1 (SQL sem Postgres real) e F-testability-2 (guarda de frescor sem comportamento), um falso-verde na classificação apaga as duas defesas de uma vez. Custo direto = repetição do padrão PR #111.

**Dependências**: nenhum (pode ser feito isoladamente); complementar a `integracao-postgres-permutas`.

---

### [rbac-gestao-alocacoes] Reavaliar leitura sem RBAC de `/permutas/gestao` à luz da expansão do payload

**QA**: Security (consolida `security-2`)
**Tactic alvo**: Authorize Actors + Limit Access
**Esforço**: S
**Findings**: F-security-2

**Problema**
> Card `security-1` da ADR-0043 já apontou que `GET /permutas/gestao` responde 200 para qualquer autenticado. Este delta amplia marginalmente a projeção: `alocacoes[]` (invoiceDocCod, invoicePriCod, valorAlocado, taxa, criadoPor) agora aparece também em `ja-permutado` — não é PII novo, mas amplia o universo do vazamento (~+41% em contagem de linhas na entrevista: 63 novos `ja-permutado` INOX + 43 executados reclassificados sem D.I). Enquanto o card [security-1] ADR-0043 não fecha (formalização de ADR ou aplicação de `requireRole`), este ciclo só piora marginalmente a mesma exposição.

**Melhoria Proposta**
> Fechar o card `security-1` de ADR-0043 (ADR curta OU `requireRole` na rota), reconhecendo no texto que o payload cresceu para incluir `alocacoes[]` em `ja-permutado`. Se o caminho escolhido for `requireRole('analyst')`, ele passa a proteger 3 classes de status (`permuta-manual`, `casamento-manual`, `ja-permutado`) que hoje carregam alocação.

**Resultado Esperado**
> Política de leitura de `/permutas/gestao` documentada por ADR (referenciando D4 de ADR-0046) OU gatiada por role. Rotas de leitura sensíveis sem RBAC e sem ADR: 1 → 0.

**Métricas de sucesso**
- Rotas de leitura sensíveis sem RBAC e sem ADR justificando: 1 → 0
- ADR referenciando D4 de ADR-0046 (exposição de `alocacoes` em `ja-permutado`): 0 → 1

**Risco de não fazer**
> Cada nova feature amplia o payload de `/gestao` marginalmente; em 6 meses, a projeção acumula campos e o vazamento cresce sem que o RBAC seja revisitado. A discussão de política volta em cada Regis-Review e a decisão fica postergada.

**Dependências**: [security-1] da ADR-0043 (`fix/permuta-snapshot-estados`), ainda em aberto.

---

### [kill-switch-saldo] Introduzir kill-switch da regra do `saldoRestante` (env `PERMUTAS_SALDO_NAO_CONSUMIDO_ENABLED`)

**QA**: Deployability (consolida `deployability-2`)
**Tactic alvo**: Feature Flags
**Esforço**: S
**Findings**: F-deployability-2

**Problema**
> A ADR-0046 nomeia 3 adtos de "risco residual" (bordero `fin=1` sem abate no ERP) que poderiam produzir super-cálculo do saldo se o cache não pegar o motivo real. Sem kill-switch, a única mitigação em prd é `git revert` + esperar o autoDeploy — MTTR limitado pela reconstrução do Render (~3-5 min), não pelo dashboard.

**Melhoria Proposta**
> Adicionar `PERMUTAS_SALDO_NAO_CONSUMIDO_ENABLED` em `render.yaml` (`sync: false`, default `true`). Em `SaldoAlocacaoAdiantamentoService.somaNaoConsumida`, checar a flag via `EnvironmentProvider`: se `false`, cair no comportamento pré-delta (`Σ valorAlocado`). Mesmo pattern do `RECEBIMENTOS_ENABLED`.

**Resultado Esperado**
> Se um adto começar a apresentar super-cálculo, o operador seta `false` no dashboard do Render e o painel volta ao comportamento antigo em segundos, sem redeploy. `git revert` fica como fix definitivo, sem pressão.

**Métricas de sucesso**
- Kill-switches para regras críticas de Permutas: 0 → 1
- MTTR para reverter comportamento do saldo: ~5min (revert+deploy) → ~30s (dashboard flip)

**Risco de não fazer**
> Um erro de regra em 1 dos 3 adtos residuais escala para incidente sem mitigação rápida.

**Dependências**: `observabilidade-frescor-convergencia` (a flag e a métrica são naturalmente correlacionadas).

---

### [saldoneg-helper] Extrair helper único `saldoNegDoAdto(adto)` e migrar 5 call sites

**QA**: Modifiability (consolida `modifiability-1`)
**Tactic alvo**: Abstract Common Services · Refactor
**Esforço**: S
**Findings**: F-modifiability-1

**Problema**
> A ADR-0046 pede "uma única fonte da regra para todo lugar que desconta alocações do saldo do adto". A metade do MINUENDO (as alocações não consumidas) foi extraída em `SaldoAlocacaoAdiantamentoService`. A metade do MINUENDO oposto (o saldo do ERP em moeda negociada, `valorPermutar / taxa`) segue duplicada em 5 sítios de `service/`, cada um reescrevendo a mesma pré-condição `valorPermutar !== undefined && taxa !== undefined && taxa > 0`.

**Melhoria Proposta**
> Aplicar **Abstract Common Services**. Adicionar um método estático `saldoNegDoAdto(adiantamento: { valorPermutar?: number; taxa?: number }): number | undefined` a `SaldoAlocacaoAdiantamentoService` (ou a uma nova classe pura `SaldoNegociadoCalculator` se `SaldoAlocacaoAdiantamentoService` não deve depender do shape do adto). Substituir os 5 sítios: `GestaoPermutasService.ts:262,365,586`; `AlocacaoPermutasService.ts:250,376`; `IngestaoPermutasService.ts:425`; `ReconciliacaoPermutaService.ts:899`.

**Resultado Esperado**
> Uma edição futura na definição de "saldo negociado" (ex.: aplicar `Math.max(0, ...)`; ou usar a **última** taxa em vez da carimbada) toca 1 arquivo. Duplicação de fórmula em services: 5 → 0. Duplicação de pré-condição: 4 → 0.

**Métricas de sucesso**
- Sítios com `valorPermutar / taxa` inline em `domain/service/permutas/`: 5 → 0
- Sítios com pré-condição `valorPermutar !== undefined && taxa !== undefined && taxa > 0`: 4 → 0

**Risco de não fazer**
> Baixo hoje; se a próxima ADR de saldo mexer na definição, custo linear no nº de sítios e sem alarme de compilador.

**Dependências**: nenhuma.

---

### [rollout-observabilidade] Documentar e observar a janela de rollout do fix D3

**QA**: Availability (consolida `availability-1`)
**Tactic alvo**: Condition Monitoring; State Resynchronization
**Esforço**: S
**Findings**: F-availability-1

**Problema**
> Por até 6h após o deploy (1 ciclo da ingestão de Permutas), as linhas antigas do cache `permuta_bordero` têm `atualizado_em` renovado pelo comportamento anterior a cada refresh, então a guarda de frescor (`b.atualizado_em < r.started_at`) as reprova e `saldoRestante` segue o comportamento antigo (double-count). É a direção conservadora prevista no ADR (F-availability-1), mas sem observabilidade o time só saberia consultando o Postgres.

**Melhoria Proposta**
> (i) Runbook em `docs/runbooks/permutas-saldo-ordem-centavos-rollout.md` explicando a janela e como acompanhá-la (query `SELECT max(started_at) FROM permuta_eleicao_run WHERE status='success'` vs. `SELECT count(*) FROM permuta_bordero WHERE atualizado_em > $started`). (ii) Log estruturado (`LogService.info` `permuta gestao served`) já existe em `GestaoPermutasService.ts:211-220` — acrescentar contagem de adtos com `alocacoes.length>0 AND saldoRestante < 0` para monitorar o encolhimento da janela.

**Resultado Esperado**
> (a) `# adtos com saldoRestante < 0` no log do painel → cai a zero até a 1ª ingestão pós-deploy; (b) time sabe quando a janela fechou sem precisar abrir o Supabase.

**Métricas de sucesso**
- Presença do runbook: 0 → 1
- Campo `saldosNegativosNoPainel` no log info `permuta gestao served`: 0 → 1 (novo)
- Tempo até janela fechar (deploy → 1ª ingestão): não observável → observável em log

**Risco de não fazer**
> Analista abre chamado dentro da janela ("meu 12860 continua −R$ 19 mil"), time perde ciclo debugando algo que era esperado.

**Dependências**: nenhuma.

---

### [bump-versao-v0.36.5] Bumpar app para v0.36.5 (patch — delta é fix-only) + CHANGELOG

**QA**: Deployability (consolida `deployability-3`)
**Tactic alvo**: Script Deployment Commands
**Esforço**: S
**Findings**: F-deployability-4
**Status**: **RESOLVIDO PELO PIPELINE** — não vai para inbox de follow-ups

**Problema**
> Delta traz 3 `fix(permutas)` sobre regra de elegibilidade e saldo (ADR-0046). `_shared-metrics.md` lista o bump como pendente. Sem ele, `/health` continuará devolvendo `0.36.4` rodando código novo, e a `tag-release` do CI não dispara.

**Melhoria Proposta**
> **Correção do agent original**: o delta é 100% `fix(...)` sem `feat`/`perf`, então o green criterion #11 do CLAUDE.md pede **patch** (v0.36.5), não `minor` (v0.37.0) que o agent de deployability sugeriu. Rodar `scripts/bump-version.ps1 -Execute -Level patch`. Editar `CHANGELOG.md` com bloco `## v0.36.5 (2026-09-15) — resíduo de R$1,00 comparado em centavos, prioridade única de motivos, saldo sem dupla contagem (ADR-0046)`, incluindo os casos canônicos (12860, 9328) como narrativa de negócio. Commit `chore(release): v0.36.5`.

**Resultado Esperado**
> `jq -r .version src/*/package.json` = `0.36.5` para os dois; `git tag -l v0.36.5` presente após o merge; `/health` devolve `version: "0.36.5"`.

**Métricas de sucesso**
- versão de app: `0.36.4` → `0.36.5` (FE=BE)
- tag Git para o delta: ausente → `v0.36.5`
- bloco no CHANGELOG.md: ausente → presente com narrativa dos casos 12860/9328

**Risco de não fazer**
> Release silencioso; correlacionar "quando a ADR-0046 entrou" ao commit vira arqueologia manual.

**Dependências**: nenhuma. **Este item é passo obrigatório do ship (green criterion #11), executado pelo AutoLoopRunner/orquestrador antes do PR — não é follow-up de sprint.**

---

### [observabilidade-frescor-convergencia] Instrumentar a janela de convergência/frescor pós-deploy

**QA**: Deployability + Integrability + Fault Tolerance (consolida `deployability-1`, `integrability-2`; parcial: `fault-tolerance-2` complementar)
**Tactic alvo**: Deployment observability + Condition Monitoring + Observability of integration failures
**Esforço**: M
**Findings**: F-deployability-1, F-integrability-1, F-availability-1 (parcial)

**Problema**
> A ADR-0046 documenta que a nova semântica do `saldoRestante` só toma efeito depois da 1ª ingestão pós-deploy que renove `permuta_eleicao_run.started_at` sem tocar `permuta_bordero.atualizado_em` (janela conservadora ≤ 6h). Hoje, nenhum log/contador conta "quantos consumos foram aplicados" nem "quantos adtos ainda estão na janela conservadora" nem "quanto tempo dura em média a janela por borderô". Operador vê o painel após deploy e não sabe se o comportamento antigo persistente é bug ou convergência natural. Um bug futuro que "esqueça" de bumpar `atualizado_em` quando a situação muda de fato passa a superestimar silenciosamente sem alarme.

**Melhoria Proposta**
> (a) Adicionar `@inject(LogService)` em `SaldoAlocacaoAdiantamentoService` e emitir uma linha `info` por chamada de `carregarConsumosPorAdiantamento`: `{ adtos_com_consumo, total_consumos, adtos_sem_consumo, run_started_at_min, cache_atualizado_em_max }`. (b) Sonda `probe-guarda-frescor-permutas.ts` (job ou métrica no `LogService`) que emita, por ingestão: `count(*) FROM permuta_bordero WHERE atualizado_em > (last started_at)` — quantos borderôs vivos entraram na "janela de subestimação"; e `avg(now() - b.atualizado_em) WHERE b.bor_vld_finalizado = 1 AND b.atualizado_em > r.started_at` — quanto tempo em média. (c) Expor essas contagens no `/health/pipelines` (middleware já existe).

**Resultado Esperado**
> Após 1 ingestão pós-deploy, o operador consulta o `/health/pipelines` e vê "adtos com consumo aplicado: 128/1247, cache_atualizado_em_max: 2026-09-14T15:36Z, started_at_min: 2026-09-14T16:00Z". Time detecta janelas anormais (> 12h) antes do cliente. Um bug futuro que "esqueça" de bumpar `atualizado_em` dispara alarme.

**Métricas de sucesso**
- Logs emitidos por `SaldoAlocacaoAdiantamentoService`: 0 → ≥1 por chamada
- Métrica exposta em `/health/pipelines` para convergência: ausente → presente
- Sondas de janela de subestimação em produção: 0 → 1
- Dashboards ou alertas para "borderôs com `atualizado_em > started_at`": 0 → 1

**Risco de não fazer**
> Primeiro incidente pós-deploy é reaberto como regressão da ADR-0046, e o autor gasta tempo provando que "não é bug, é convergência". Perde-se o âncora temporal do fix. Janela conhecida (documentada na ADR) fica sem sensor; se o bumping quebrar por outro caminho de escrita futuro, o saldo superestima silenciosamente e libera super-alocação — o sentido perigoso.

**Dependências**: nenhuma; `comment-atualizado-em` (P2, S) dá a fundação semântica em SQL.

---

### [unificar-reconciliacao-saldo] Unificar o teto do adto na reconciliação com `SaldoAlocacaoAdiantamentoService`

**QA**: Availability (consolida `availability-2`)
**Tactic alvo**: State Resynchronization; Increase Competence Set
**Esforço**: M
**Findings**: F-availability-2

**Problema**
> `ReconciliacaoPermutaService` (`:200, :215`) lê `alocacaoRepository.listAtivas()` diretamente e soma `valor_alocado` para calibrar o teto — a regra "não descontar consumido do ERP" da ADR-0046 D3 vive na tela e no `alocar`, mas **não** na baixa. Pré-existente, delta não amplia (F1 do scoping / F-availability-2); porém, agora que a ontologia dita fonte única, ficar com duas fontes vira dívida ativa.

**Melhoria Proposta**
> Trocar `alocacaoRepository.listAtivas().filter(...)` no `reconciliarSerializado` por `SaldoAlocacaoAdiantamentoService.somaNaoConsumidaDoAdiantamento(adtoDocCod)`. Manter o `borderoDoPar` como trava de integridade (não é sobre saldo, é sobre re-uso de baixa).

**Resultado Esperado**
> 1 fonte de saldo consumida por 3 callers (tela, `alocar`, `reconciliar`) — hoje é 1 fonte para 2 callers e outra fonte para 1 caller.

**Métricas de sucesso**
- Callers de `somaNaoConsumidaDoAdiantamento`: 2 → 3
- Callers de `alocacaoRepository.listAtivas` na reconciliação: 2 → 0 (ou justificado)

**Risco de não fazer**
> Divergência silenciosa entre "cabe R$ X (tela)" e "cabe R$ Y (POST da baixa)" quando a semântica de "consumido" evoluir novamente.

**Dependências**: nenhuma (o serviço já está injetado no container).

---

### [reconciliacao-periodica-erp] Reconciliação DB↔ERP periódica do saldo consumido

**QA**: Fault Tolerance (consolida `fault-tolerance-3`)
**Tactic alvo**: Reconcile (Gray & Reuter §11)
**Esforço**: M
**Findings**: F-fault-tolerance-3

**Problema**
> O ground-truth `validate-permutas-saldo-ordem-centavos-v1.ts` (247 linhas, 0 DIVERGENTE) foi rodado UMA vez, antes do merge. Sem job periódico, o painel post-deploy pode divergir do ERP sem que ninguém veja — e agora a divergência tem duas fontes novas: (a) guarda de frescor com skew ainda não instrumentado; (b) reuso de `bor_cod` sem detecção. Cardado no run anterior como dívida de Reconcile (Gray & Reuter §11) e reforçado aqui pelo delta introduzir consumidores da hipótese "cache == ERP".

**Melhoria Proposta**
> Reaproveitar o script `validate-permutas-saldo-ordem-centavos-v1.ts` como job semanal (`reconciliacao-permutas-saldo.ts`, cron 7d), lendo o mesmo catálogo de 128 adtos + amostra rotativa. Emite `BUSINESS_WARN` para cada linha DIVERGENTE não explicada e resumo agregado. Rodar em Render/cron externo (repo não tem `infra/`).

**Resultado Esperado**
> Divergências saldo(nosso) vs saldo(ERP) detectadas em ≤ 7 dias. `divergentes_semanais = 0` esperado; > 0 = ticket aberto automaticamente.

**Métricas de sucesso**
- Job periódico: 0 → 1
- Cobertura de amostragem: 247 linhas one-off → 100 linhas/semana (rotativas) + amostra fixa

**Risco de não fazer**
> Divergência silenciosa acumula; um caso de reuso `bor_cod` ou saldo stale pode passar semanas sem detecção operacional.

**Dependências**: nenhuma (script pronto).

---

### [integracao-postgres-permutas] Cobrir com Postgres real a query `listConsumosFinalizados` e a guarda de frescor

**QA**: Testability + Integrability (consolida `testability-1`, `integrability-3`)
**Tactic alvo**: Sandbox + Executable Assertions + Contract testing
**Esforço**: M
**Findings**: F-testability-1, F-testability-2, F-integrability-2, F-integrability-3

**Problema**
> As duas peças novas de SQL mais complexas do delta — `listConsumosFinalizados` (5 joins + `b.atualizado_em < r.started_at` + `bor_cod_estornado IS NULL`) e o `ON CONFLICT ... IS DISTINCT FROM ...` do `replaceBorderoCache`/`updateBorderoCacheSituacao` — são exercitadas só por casamento de string em teste (`PermutaExecucaoRepository.test.ts:453-475, 514-586`). O padrão de integração existe no repo (14 `*.integration.test.ts` em `routes/recebimentos.*`), mas não foi aplicado a permutas (`find src/backend -name '*.integration.test.ts' -path '*permuta*'` → vazio). Refactor que troque `USING(bor_cod)` sem `fil_cod` produz colisão silenciosa entre filiais; refactor que troque `IS DISTINCT FROM` por `!=` (semântica NULL diferente) refaz o bug canônico do "Finalizar → refresh → saldo cheio". Adicionalmente, o teste atual de assertion de cláusulas cobre 4/5 (falta assertion explícita do NULL do adiantamento parametrizado como isolado).

**Melhoria Proposta**
> (a) Criar `src/backend/domain/repository/permutas/PermutaExecucaoRepository.integration.test.ts` seguindo o padrão de `routes/recebimentos.*.integration.test.ts`. Cobrir 3 cenários: (1) `listConsumosFinalizados` — inserir 2 execuções `settled` em `bor_cod` idênticos de filiais diferentes e provar que só a da filial certa aparece; (2) guarda de frescor — inserir uma execução com `b.atualizado_em > r.started_at` e provar que NÃO aparece; (3) `replaceBorderoCache` — invocar duas vezes com mesma situação e provar que `atualizado_em` não avançou. (b) Complementar `PermutaExecucaoRepository.test.ts:505-529` com 5 asserções mínimas de cláusula (não só 4), + 1 caso positivo/negativo por cláusula (borderô cancelado NÃO conta; execução `error` NÃO conta; borderô estornado NÃO conta; borderô visto pós-ingestão NÃO conta; execução `dry_run=true` NÃO conta).

**Resultado Esperado**
> `find src/backend -name '*.integration.test.ts' -path '*permuta*'` sobe de 0 → **≥1**. 3 casos de banco real (join cross-filial, guarda de frescor, `IS DISTINCT FROM` sob `NULL`) pinados em CI. Refactor futuro que quebre a semântica cai vermelho localmente, não em produção. Cláusulas de filtro asseridas em teste: 4/5 → 5/5.

**Métricas de sucesso**
- Testes de integração no domínio permutas: 0 → **≥3** (join, guarda de frescor, ON CONFLICT)
- Semânticas do Postgres exercitadas sob PR: 0 → **3** (`IS DISTINCT FROM` sobre NULL, join composto `(fil_cod, bor_cod)`, comparação `timestamptz` de segundos)
- Cláusulas de filtro asseridas: 4/5 → 5/5

**Risco de não fazer**
> O ground-truth ao vivo (247 linhas, 0 DIVERGENTE) passa a ser o único guardião das duas semânticas. Ele roda **antes do PR**, não em CI; hotfixes com `--urgent` pulam. Uma regressão do join cross-filial produziria contagem incorreta de "consumido" e o teto do `alocar` daria super-alocação — mesmo bug simétrico ao 12860/9328 que este delta corrige.

**Dependências**: levantar (ou reaproveitar) o `docker-compose.test.yml` que `routes/recebimentos.*.integration.test.ts` já pressupõe.

---

## P3 — Baixo

### [runbook-convergencia-pos-deploy] Documentar sequência e efeito do primeiro ingest pós-deploy no CHANGELOG e no runbook

**QA**: Deployability (consolida `deployability-4`)
**Tactic alvo**: Deployment observability
**Esforço**: S
**Findings**: F-deployability-1, F-deployability-3

**Problema**
> A "convergência natural" descrita na ADR-0046 §Consequências (até a 1ª ingestão pós-deploy, `saldoRestante` mantém o comportamento pré-delta) é sutil: FE se comporta como antes por um tempo, aí muda. Sem nota explícita no CHANGELOG e no runbook, o suporte ficará confuso e vai abrir tickets falso-positivo.

**Melhoria Proposta**
> No bloco de v0.36.5 do CHANGELOG (card `bump-versao-v0.36.5`), incluir uma linha "por que o adto 12860 pode ainda aparecer com saldo negativo por até 1h após o deploy — a nova semântica só ativa depois da próxima ingestão de permutas". Adicionar seção "Convergência pós-deploy (ADR-0046)" em `docs/runbooks/rollback.md` (ou runbook novo) explicando o que verificar em `permuta_bordero.atualizado_em` vs `permuta_eleicao_run.started_at` para confirmar convergência.

**Resultado Esperado**
> Suporte tem checklist: "1) `/health` = 0.36.5; 2) `SELECT max(atualizado_em) FROM permuta_bordero` vs `SELECT max(started_at) FROM permuta_eleicao_run` — segundo deve ser maior; 3) painel do adto 12860 mostra `saldoRestante` = R$ 30.364,73". Ticket "não convergiu" deixa de ser mistério.

**Métricas de sucesso**
- Nota de convergência no CHANGELOG v0.36.5: ausente → presente
- Runbook "convergência pós-deploy": ausente → presente

**Risco de não fazer**
> Baixo, mas re-abre incidentes pela primeira semana pós-deploy.

**Dependências**: `bump-versao-v0.36.5`.

---

### [mover-tolerancia-libs] Mover `ToleranciaResiduo` de `domain/interface/permutas/` para `domain/libs/permutas/`

**QA**: Modifiability (consolida `modifiability-2`)
**Tactic alvo**: Increase Semantic Coherence
**Esforço**: S
**Findings**: F-modifiability-2

**Problema**
> `ToleranciaResiduo` é a única classe **com comportamento** em `domain/interface/permutas/`, pasta que o repo reserva para tipos e enums. A convenção do CLAUDE.md sugere `domain/libs/` para utilitários (padrão de `EnvironmentProvider`, `Logger`, `Executors`) — a classe é um utilitário de domínio, não uma interface de dados.

**Melhoria Proposta**
> Aplicar **Increase Semantic Coherence**. Mover o arquivo para `src/backend/domain/libs/permutas/ToleranciaResiduo.ts` (ou o caminho equivalente adotado no repo — checar se `domain/libs/` aceita subpastas por bounded context) e ajustar os 7 imports (2 comentários, 5 usos). Nenhuma mudança semântica.

**Resultado Esperado**
> A estrutura de pastas volta a refletir o tipo do arquivo (tipos em `interface/`, comportamento em `service/` ou `libs/`). Precedente removido para futuras classes serem colocadas fora do lugar.

**Métricas de sucesso**
- Classes com comportamento em `domain/interface/`: 1 → 0
- Convenção documentada em CLAUDE.md ou ADR pequena

**Risco de não fazer**
> Baixo. Convenção reproduzir-se com o tempo (o próximo dev pode ver e replicar).

**Dependências**: nenhuma.

---

### [tolerancia-usd-consolidada] Consolidar tolerâncias em "moeda negociada" (USD) num único helper + amarrar `SALDO_TOL` back↔front

**QA**: Modifiability + Testability (consolida `modifiability-3`, `testability-2`)
**Tactic alvo**: Encapsulate · Abstract Common Services · Limit Structural Complexity
**Esforço**: S
**Findings**: F-modifiability-4, F-testability-4

**Problema**
> A tolerância de resíduo em BRL foi consolidada em `ToleranciaResiduo.LIMITE_BRL`. A tolerância equivalente em moeda negociada — usada para comparar saldos em USD/EUR — continua espalhada como literal `1` em 4 sítios de `service/permutas/` (Gestao ×2, Alocacao ×2) e como `SALDO_TOL = 1` no frontend, com um `+ 0.005` (float epsilon) em Alocacao com semântica distinta. Além disso, `SALDO_TOL` (no frontend) e `LIMITE_BRL = 1` (no backend `ToleranciaResiduo.ts`) não estão amarrados por teste. Se alguém subir o teto do backend para R$2, o frontend segue filtrando por outro valor.

**Melhoria Proposta**
> (1) Aplicar **Encapsulate**. Adicionar `ToleranciaResiduo.LIMITE_MOEDA_NEGOCIADA = 1` com um helper `dentroDoLimiteMoedaNegociada`. Substituir os 4 literais em `service/permutas/`. Manter o `+ 0.005` só se for genuinamente epsilon de ponto flutuante — nesse caso, extrair como `EPSILON_FLOAT = 1e-6` ou `TOLERANCIA_ARREDONDAMENTO_USD = 0.005` com JSDoc. (2) Extrair `permutaManualCompleta` e a partição `{ jaPermutados, multiplasManuais, ... }` de `page.tsx` para módulo puro (`src/frontend/app/permutas/components/particionar.ts`). (3) Exportar `LIMITE_BRL` num módulo compartilhado (opção A: pacote comum consumido por FE+BE; opção B: espelho no FE com teste que carrega o BE e falha se divergirem). (4) Adicionar suite de teste ao módulo extraído.

**Resultado Esperado**
> 5 literais numéricos com semântica de tolerância → 1 (ou 2) constante(s) nomeada(s) com JSDoc. `page.tsx` deixa de conter closures que dependem de constantes de domínio não-amarradas. Testes de módulo puro cobrem `permutaManualCompleta` e a partição — de 0 → ≥5 casos. Divergência entre back e front do teto de R$1,00 vira erro de compilação (opção A) ou teste vermelho (opção B).

**Métricas de sucesso**
- Literais `1`/`0.005` com semântica de tolerância em `service/permutas/`: 5 → 0
- Constantes nomeadas de tolerância: 1 (BRL) → 2 (BRL + moeda negociada), com JSDoc justificando cada
- LOC de closures em `page.tsx` que dependem de constante de domínio: **2** → **0**
- Constante `LIMITE_BRL` amarrada por teste back↔front: **não** → **sim**

**Risco de não fazer**
> Baixo. Redundância inofensiva enquanto BRL≈USD nesse teto de 1. Retorno do defeito pré-ADR-0046 (adto em duas abas) se o teto do backend subir e o FE não acompanhar.

**Dependências**: preferível vir junto com [saldoneg-helper] (mesmo tipo de refactor, mesma passada).

---

### [log-duracao-gestao] Instrumentar `durationMs` no log do `exporGestao` e no `listConsumosFinalizados`

**QA**: Performance (consolida `performance-3`)
**Tactic alvo**: Increase Resource Efficiency (via medição)
**Esforço**: S
**Findings**: F-performance-6

**Problema**
> O log atual do painel só emite `pendentes.length`, `invoicesEmAberto.length`, `casamentos.length` — não emite tempo. As findings de performance são inspeção estática; sem `durationMs` no LogService, uma regressão só será notada por queixa do analista.

**Melhoria Proposta**
> No `exporGestao`, wrap do `Promise.all` com `const t0 = performance.now(); ...; const durationMs = performance.now() - t0;` e adicionar ao `data` do `logService.info`. Idem para o repositório em queries "quentes" do delta (`listConsumosFinalizados`). Alternativa mais rica: middleware Express de duração por rota — se ainda não existir.

**Resultado Esperado**
> Log de cada request `permuta gestao served` inclui `durationMs`, `querysDurationsMs` (opcional por query) — permitindo dashboards de p50/p95/p99 no Render logs ou destino de logs downstream.

**Métricas de sucesso**
- Campo `durationMs` presente em 100% dos logs `permuta gestao served`: 0% → 100%
- Painel/consulta de p95 disponível: ausente → presente

**Risco de não fazer**
> Regressões silenciosas de performance no delta seguinte ficam invisíveis.

**Dependências**: nenhuma (complementar a `perf-indices-listconsumos`).

---

### [crescimento-execucao-doc] Documentar limites de crescimento previstos de `permuta_alocacao_execucao`

**QA**: Performance (consolida `performance-4`)
**Tactic alvo**: Bound Queue Sizes
**Esforço**: S
**Findings**: F-performance-1

**Problema**
> O custo do novo JOIN escala linearmente com a cardinalidade de `permuta_alocacao_execucao` filtrada por `status IN ('settled','parcial') AND dry_run=false`. Hoje: ~250 linhas. Sem política de retenção nem estimativa de crescimento documentada, não há gatilho claro para agir (ex.: "quando passar de 10k, criar índice parcial").

**Melhoria Proposta**
> Adicionar seção em `ontology/business-rules/idempotencia-reconciliacao.md` (ou num inbox `_inbox/permuta-execucao-perf.md`) com: (a) taxa média de novos `settled`/`parcial` por semana observada em prod; (b) gatilho para revisitar (ex.: 5.000 linhas terminais); (c) opções de mitigação (índice parcial, particionamento por ano).

**Resultado Esperado**
> Time sabe QUANDO agir sem depender de perceber degradação. `regis-review` futuros comparam contra o gatilho.

**Métricas de sucesso**
- Documento de gatilho de retenção/particionamento: ausente → presente
- Métrica "linhas terminais em `permuta_alocacao_execucao`" incluída no `retro-ontology` semanal: ausente → presente

**Risco de não fazer**
> Quando o número cruzar um limiar, ninguém percebe até virar dor.

**Dependências**: `perf-indices-listconsumos` (medição informa o gatilho).

---

### [existsby-auto-alocacao] Substituir `listAtivas()` full-scans dos auto-alocadores por `existsByAdiantamento`/`countByProcessoEEstado`

**QA**: Performance (consolida `performance-5`)
**Tactic alvo**: Limit Event Response
**Esforço**: S
**Findings**: contextual — não é finding do delta; nota do agente qa-performance

**Problema**
> `AlocacaoPermutasService.autoAlocarSeElegivel` (`AlocacaoPermutasService.ts:305-345`) e `autoAlocarDeCasamento` (`:381-406`) chamam `listAtivas()` (SELECT * `permuta_alocacao`) apenas para checar "há alguma alocação deste adto?" — e `listAdiantamentosAtivos()` para filtrar por `priCod`. **Pré-existente**, não introduzido por este delta, mas o delta amplia o uso da regra "por-versão" que passa por estes caminhos.

**Melhoria Proposta**
> Substituir por `existsByAdiantamento(docCod)` (SELECT 1 ... WHERE ... LIMIT 1) e `countByProcessoEEstado(priCod, estado)` — queries dedicadas.

**Resultado Esperado**
> Auto-alocação decide com O(1) round-trip por check em vez de puxar toda a tabela.

**Métricas de sucesso**
- Tamanho médio de resultset de `listAtivas()` chamado por `autoAlocar*`: N linhas → 1 linha ou contagem

**Risco de não fazer**
> Quando `permuta_alocacao` crescer, cada `Baixar` do auto puxa a tabela inteira; hoje é pequena.

**Dependências**: nenhuma; **card opcional**, sinaliza dívida.

---

### [skew-clock-app-db] Instrumentar skew de relógio app↔Postgres (fresh guard depende dele)

**QA**: Fault Tolerance (consolida `fault-tolerance-2`)
**Tactic alvo**: Timestamp + Condition Monitoring
**Esforço**: S (healthcheck) ou M (refactor `started_at` para `now()` do Postgres)
**Findings**: F-fault-tolerance-1

**Problema**
> A guarda de frescor `b.atualizado_em < r.started_at` compara um timestamp gravado pelo Postgres (`now()` em `replaceBorderoCache`/`updateBorderoCacheSituacao`) com um timestamp gravado pelo Node (`new Date()` em `IngestaoPermutasService.ts:74`, persistido em `permuta_eleicao_run.started_at`). Toda direção de skew analisada resulta em SUBESTIMAR consumo (conservador, fail-safe), mas skews grandes (dezenas de minutos) prolongariam a janela em que `saldoRestante` fica visualmente maior que o real, sem que ninguém saiba. Deploys em ambientes com clock drift (containers, VMs pausadas) são realistas.

**Melhoria Proposta**
> (1) Adicionar healthcheck periódico (job noturno) que loga `SELECT extract(epoch from now() - $appNow::timestamptz)` com `$appNow = new Date().toISOString()` do Node. Emite `BUSINESS_WARN` se `|skew| > 30s`. (2) Documentar em ADR-0046 que a guarda de frescor pressupõe skew ≤ minutos; alertar operação se ambientes futuros (novos tenants) rodarem com relógios livres. (3) Alternativa mais defensiva (opcional): usar `now()` do Postgres para `started_at` também, escrevendo `INSERT ... VALUES ($id, now(), ...) RETURNING started_at` e devolvendo ao app — elimina o skew inteiramente. Requer refactor pequeno em `PermutaRelationalRepository.insertIngestRunHeader:207-238`.

**Resultado Esperado**
> Skew visível em log/alerta. Se opção (3) for implementada, skew = 0 por construção.

**Métricas de sucesso**
- Skew instrumentado: ausente → presente
- `|skew_app_db|` p95: N/A → ≤ 30s

**Risco de não fazer**
> Se um deploy futuro tiver clock drift severo, saldos ficam subestimados por horas sem alerta. Direção segura, mas invisível a operação.

**Dependências**: nenhuma.

---

### [alarme-validador-prd] Alarme de execução do validador AO VIVO em PRD (correlacionar `PROBE_ALLOW_PRD=1` a operador)

**QA**: Security (consolida `security-3`)
**Tactic alvo**: Detect Intrusion + Audit Trail
**Esforço**: S
**Findings**: F-security-1, F-security-5

**Problema**
> O validador AO VIVO tem 3 guards contra escrita acidental (ver F-security-1), mas nenhum sinal de observabilidade externa: se rodar em PRD, ninguém fora do terminal do operador sabe. As chamadas a Conexos aparecem no log do ERP como leituras normais do usuário de serviço, sem carimbo distintivo. Um insider poderia rodar o validador para varrer a base de adiantamentos (BRL/USD por linha) sem levantar suspeita.

**Melhoria Proposta**
> Duas ações combinadas:
> 1. Enviar 1 evento estruturado ao logger central (Sentry/CloudWatch — o que existir) no início da execução do validador quando `PROBE_ALLOW_PRD=1` estiver ativo: `{ script: 'validate-permutas-saldo-ordem-centavos-v1', base: BASE, operator: process.env.USER ?? 'unknown', started_at: new Date().toISOString() }`.
> 2. Documentar em `CLAUDE.md` (seção "Ground truth AO VIVO"): "Toda execução do validador contra PRD gera alarme no canal `#ops-ground-truth`; a intenção é revisão retroativa, não bloqueio".

**Resultado Esperado**
> Execuções do validador contra PRD são visíveis fora do terminal do operador. Sinal de "quem rodou o quê contra qual BASE" fica auditável mesmo depois do terminal fechar.

**Métricas de sucesso**
- Execuções do validador contra PRD com evento estruturado emitido: 0 → 100%
- Presença de subseção em `CLAUDE.md` documentando o alarme: 0 → 1

**Risco de não fazer**
> Baixo — o validador ainda é ferramenta de desenvolvedor. Alto se num ano ele virar uma sonda de rotina disparada por múltiplos operadores; sem sinal externo, um mal-uso vira invisível.

**Dependências**: nenhuma.

---

### [property-tolerancia-fastcheck] Property-based test em `ToleranciaResiduo` cobrindo `NaN`/`±Infinity`

**QA**: Testability (consolida `testability-4`)
**Tactic alvo**: Limit Non-Determinism
**Esforço**: S
**Findings**: F-testability-5

**Problema**
> `ToleranciaResiduo.test.ts` tem 13 casos hand-picked cobrindo fronteira monetária e ruído de float, mas não exercita `NaN`, `+Infinity`, `-Infinity`, exponenciais grandes (`1e20`). O guard `Number.isFinite` (`ToleranciaResiduo.ts:42`) está no código sem teste correspondente. `fast-check` já é dep do frontend, não do backend. Se um `parseFloat` num consumidor futuro (ex.: `ConexosTitulosClient.mapDetalheTitulos`) produzir `NaN` para `valorAberto`, o predicado cai silenciosamente no `pago` do wire.

**Melhoria Proposta**
> Adicionar `fast-check` como devDep do backend (`cd src/backend && npm i -D fast-check`) e escrever 3 property tests em `ToleranciaResiduo.test.ts`: (a) `fc.assert(fc.property(fc.double({noNaN: false}), (x) => adiantamentoTotalmentePago({valorAberto: x}) ⇔ Number.isFinite(x) && Math.round(Math.abs(x)*100) <= 100))`; (b) simétrico para `semSaldoPermutar`; (c) `NaN`, `±Infinity` explicitamente.

**Resultado Esperado**
> Cobertura de fronteira monetária sobe de **13 casos hand-picked** → **13 + 3 properties com centenas de amostras cada rodada**. `NaN`/`±Infinity` explicitamente testados: **0** → **3**.

**Métricas de sucesso**
- `fast-check` dep no backend: **não** → **sim**
- Property tests em `ToleranciaResiduo.test.ts`: 0 → **3**
- Casos `NaN`/`±Infinity`: 0 → **3**

**Risco de não fazer**
> Baixo direto; mantém padrão de defesa "hand-picked apenas" que já produziu incidentes em outras áreas do repo (variação `NaN`). Débito herdável.

**Dependências**: nenhuma.

