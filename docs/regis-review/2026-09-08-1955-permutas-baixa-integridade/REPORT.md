---
type: regis-review-report
run_id: 2026-09-08-1955-permutas-baixa-integridade
generated_at: 2026-09-08T22:45:00-03:00
audience: technical (architects + senior devs + tech lead)
basis: Bass & Clements — Software Architecture in Practice (Availability, Deployability, Integrability, Modifiability, Performance, Fault Tolerance, Security, Testability)
scope: DELTA-only (commit 8b18686 — fix/permutas-baixa-integridade); base main@47c48f8
gate_verdict: PASSA (0 P0 no delta)
total_cards: 27
total_p0: 0
total_p1: 7
total_p2: 10
total_p3: 10
overall_score: 7.5
---

# Regis-Review — financeiro — 2026-09-08-1955-permutas-baixa-integridade

> Gate `--quick` **pós-implementação** do tweak `fix/permutas-baixa-integridade` (commit `8b18686`).
> Escopo estrito ao DELTA — não é review do módulo Permutas (esse é o run pai
> `docs/regis-review/2026-09-08-1414-permutas/`), nem review do repo.
>
> **Contexto que calibra severidade:** este delta **NÃO está em produção** — commit em branch,
> sem PR, sem release. A escrita `fin010` está LIGADA em produção desde 2026-06-24 (137 execuções,
> R$ 38.466.226,25 baixados) — essa exposição é do código ATUAL em `main`, não deste delta. Nada
> aqui deve ser lido como "risco ativo em produção".

## Veredito do gate

**PASSA.** Zero P0 no delta, verificado seção por seção pelos 8 agentes. A regra do pipeline
(`AutoLoopRunner`) é que só P0 re-entra no loop; P1/P2/P3 vão para follow-ups em
`ontology/_inbox/permutas-baixa-integridade-regis-followups.md`.

**O que este delta faz bem, com evidência:**
- Fecha `F-fault-tolerance-1` (P0 do run pai) — advisory lock por `adiantamentoDocCod` serializa
  a região crítica sem janela; verificado por traçado adversarial em 4 pontos (§F-ft-1 do QA
  fault-tolerance). Confirmação: `PostgreeDatabaseClient.ts:137-158` (client dedicado retido do
  `pg_try_advisory_lock` ao `pg_advisory_unlock`), `ReconciliacaoPermutaService.ts:151-167` (wrap
  público), `:174-181` (hash determinístico int32), 3 testes de concorrência em
  `ReconciliacaoPermutaService.test.ts:787/827/857`.
- Fecha `F-fault-tolerance-4` (P1 do run pai) — terminal `parcial` como irmão de `settled`
  (não `settled` degradado), com `valor_residual_usd`, `BUSINESS_WARN` de 4 campos canônicos e
  badge FE `parcial-aguardando-finalizacao`. Preservação em 5 CASEs do `ON CONFLICT`
  (`PermutaExecucaoRepository.ts:256-266`), `alreadySettled` retorna true para `parcial` (`:284`),
  idempotência viva reconhece os dois terminais (`ReconciliacaoPermutaService.ts:262-263`).
- Adiciona pré-checagem `assertCobertura` (I-Write-8a) — 422 antes do 1º POST irreversível
  quando `Σ (usd − pago_brl/taxa) < alocado`, com fronteira ±0,005 testada.
- Contract test raro FE↔BE — `src/frontend/lib/types.test.ts` lê o arquivo-fonte do backend e
  compara literais de 3 uniões (`ExecucaoStatus`, `PermutaStatusBordero`, `LoteAdiantamentoStatus`).
  A guarda cobre 3/8, mas ativos como esse são atípicos no repo.
- Migration `0054_permuta_execucao_parcial.sql` idempotente (`DROP … IF EXISTS` + `ADD COLUMN …
  IF NOT EXISTS`), forward-compatible (schema novo é SUPERSET do union antigo), aplicada sob
  `pg_advisory_lock(314159265)` pelo `BootMigrator` antes do `listen()`.
- Security **subiu com o delta** (7,5 → 8,0): novos vetores de Limit Exposure (advisory lock
  barra 2ª chamada antes do ERP), Audit Trail (`parcial` + WARN estruturado) e Validate Input
  (`assertCobertura`).
- Suite verde: 123 suites / 1.768 testes backend, 27 suites / 201 testes frontend, 0 falhas;
  28 testes novos cobrem R-1/R-2, `+0` regressões nos 1.740 pré-existentes.

**Ressalva importante sobre a prova do lock (impacta interpretação do gate):**
o `qa-fault-tolerance` confirmou o fechamento do P0 por traçado de código; o `qa-testability`
demonstrou que o teste de concorrência re-implementa a semântica do lock com `Set<number>` — prova
o **contrato** (o serviço chama `withAdvisoryLock` com chave estável, `onBusy` quando ocupada),
**não** prova que `pg_try_advisory_lock` serializa **entre conexões diferentes do pool**, que é
o cenário de produção com ≥2 instâncias no Render. As duas conclusões não se contradizem;
combinadas dizem "o mecanismo certo foi cablado, e a serialização real em Postgres ainda não foi
exercitada em CI". Isso motiva o card `testability-baixa-1` (P1, esforço L) como a única peça
faltante para virar "prova por construção" em "prova medida".

## 1. Executive scorecard

**Pesos aplicados (financeiro — SaaSo multi-tenant que executa escritas irreversíveis no ERP):**
Security 1,5 · Fault Tolerance 1,3 · Availability 1,2 · Modifiability 1,2 · Testability 1,0 ·
Performance 1,0 · Integrability 0,9 · Deployability 0,9 (Σ pesos = 9,0).

| QA | Score (0–10) | P0 | P1 | P2 | P3 | Top finding |
|---|---|---|---|---|---|---|
| Availability | 7,5 | 0 | 2 | 2 | 0 | F-availability-1: pool `max=5` + advisory lock retido ~240 s ⇒ starvation de leituras não-relacionadas |
| Deployability | 7,0 | 0 | 1 | 3 | 1 | F-deployability-1: rollback do commit com linhas `parcial` no banco regride para `reconciling` e re-POSTa `fin010` |
| Fault Tolerance | 8,0 | 0 | 2 | 0 | 0 | F-fault-tolerance-4: `parcial` é terminal humano-dependente sem reaper/detector proativo |
| Integrability | 7,5 | 0 | 1 | 3 | 1 | F-integrability-2: `titMnyTotPago` (pivô da cobertura) passa por `Number.parseFloat` locale-cego — flip para BR-locale reintroduz o defeito da ADR-0043 |
| Modifiability | 6,5 | 0 | 0 | 0 | 2 | F-modifiability-1: `mod-1` do run pai não atacada — `reconciliarSerializado` cresceu +255 LOC, cc 35→36 |
| Performance | 7,5 | 0 | 0 | 1 | 1 | F-performance-1: `withAdvisoryLock` retém 1/5 clients do pool durante toda a reconciliação (~240 s worst-case) |
| Security | 8,0 | 0 | 0 | 0 | 3 | F-security-delta-1: `AlocacaoSemCoberturaError.details` ecoa cobertura/valorAlocado/deficit no 422 — inócuo hoje (todos `admin`), vira canal lateral quando `security-1/2/3` for implementado |
| Testability | 8,0 | 0 | 1 | 2 | 2 | F-testability-1/2: mock do lock com `Set` prova contrato, não cross-connection; migration 0054 sem teste contra Postgres real |
| **Overall (ponderado)** | **7,5** | **0** | **7** | **10** | **10** | — |

Score interpretation:
- 0–3: risco estrutural — bloqueia escalonamento
- 4–6: dívida defensável — endereçar nesta janela de planejamento
- **7–8: saudável com oportunidades pontuais** ← este delta cai aqui
- 9–10: estado-da-arte para o estágio atual

## 2. Top 10 risks (cross-QA)

Ranking por composite = severidade × business impact × leverage. Foca no que este delta expõe
especificamente, não no débito estrutural do módulo (que é do run pai).

### R-1: Rollback do commit com linhas `parcial` persistidas re-POSTa baixa no `fin010`

- **QA(s) afetados**: Deployability + Fault Tolerance
- **Findings de origem**: F-deployability-1 (P1) — `deployability.md:69-86`; F-fault-tolerance-5 (P1) — `fault-tolerance.md:132-150`
- **Evidência sintetizada**: dois agentes independentes chegaram à mesma janela. Migration
  `0054` amplia o CHECK para aceitar `parcial`, mas se o commit for revertido (`git revert 8b18686`)
  mantendo a migration (que é forward-only), o código pré-delta em `main@47c48f8` tem
  `PermutaExecucaoRepository.beginExecution` com CASE preservando **apenas** `status='settled'`
  (`:257-284`). Linha `parcial` cai no ELSE, `EXCLUDED.status='reconciling'` sobrescreve, a rota
  segue para o handshake porque `alreadySettled=false`, `criarBordero` gera novo `borCod`,
  `gravarBaixaPermuta` POSTa uma **segunda baixa** para o mesmo par — que já tinha `bxa_cod_seq`
  no ERP. Anti-drift ajuda **apenas se o título já foi totalmente consumido**; num `parcial`
  típico o resíduo é sobre alocação, e títulos com em-aberto positivo baixam por cima.
- **Impacto técnico**: dupla-baixa no `fin010`, irreversível por nós (estorno manual pela
  Columbia). É a **mesma classe de defeito que o P0 do run pai fecha pela porta da frente** —
  agora entrando pela porta traseira (rollback), o que é irônico dado o propósito do delta.
- **Impacto de negócio**: R$ ~280 k médios por par (137 execuções, R$ 38,5 M); N pares parciais
  em janela de rollback × probabilidade de rollback. Baixa probabilidade (rollback é evento
  raro), alto impacto por incidente.
- **Card(s) Kanban relacionados**: `deployability-1` (S+S, P1), `fault-tolerance-2` (S, P1),
  `deployability-4` (S, P2 — runbook), `deployability-5` (S, P3 — template forward-only)
- **Custo de inação em 6 meses**: se a primeira linha `parcial` vier a subir em prod (esperado
  se o delta for merged), a janela abre. Um rollback mal orquestrado insere R$ 280 k × N (N =
  linhas `parcial` acumuladas no dia do revert). Custo do guard proposto: 1 arquivo, ~15 linhas
  (`bxa_cod_seq IS NOT NULL ⇒ abort`).

> **Nota de decisão do consolidator, elevada:** dois agentes independentes acharam este caminho
> de dupla-baixa. Ambos rotularam **P1 corretamente sob régua estrita** ("dinheiro se move errado
> com o código como está, porém exige um rollback"). O guard proposto em `deployability-1`
> (recusar reabertura quando `bxa_cod_seq IS NOT NULL`) é barato e fecha a porta antes do merge.
> **A decisão é do Yuri**: apresentamos o trade-off, não decidimos — este risco está acima da
> sua prioridade formal porque expõe uma superfície com histórico de causar o P0 original.

### R-2: `parcial` acumula silenciosamente sem reaper proativo — o "novo silêncio" que a ADR-0043 nomeia

- **QA(s) afetados**: Availability + Fault Tolerance
- **Findings de origem**: F-availability-2 (P1) — `availability.md`; F-fault-tolerance-4 (P1) — `fault-tolerance.md:112-131`
- **Evidência sintetizada**: `parcial` sinaliza via (a) `BUSINESS_WARN` no log estruturado, (b)
  coluna `valor_residual_usd > 0` na trilha, (c) badge FE `parcial-aguardando-finalizacao`
  (`ui.tsx:135-143`). **Todos exigem que alguém abra a tela ou grep-e no log.** SISPAG resolveu
  o problema idêntico com `RemessaExecucaoRepository.listReconcilingParadas:124` +
  `SispagPainelService:376-377` + `reaper-sispag-reconciling.ts` (cron 15 min). Para Permutas,
  `grep -rn "permuta_alocacao_execucao" src/backend/jobs/` retorna só probes; zero reapers.
  A própria ADR-0043 nomeou o risco ao escolher `parcial` em vez de fail-closed — a defesa
  fecha um silêncio (POST duplicado) e abre outro (resíduo esquecido).
- **Impacto técnico**: MTBF do resíduo → indefinido; MTTR → depende do olho humano no painel.
- **Impacto de negócio**: KPI "R$ baixado" diverge de "R$ alocado" cronicamente; resíduo médio
  esperado (20–40 % de R$ 280 k = R$ 56–112 k por evento) fica invisível até auditoria manual.
- **Card(s) Kanban relacionados**: `availability-2` (S, P1), `fault-tolerance-1` (S, P1) — MESMO
  card visto por dois QAs; consolidator recomenda entrega única (`reaper-permutas-parcial.ts` +
  `listParcialPendentes` no repo + endpoint + painel).
- **Custo de inação em 6 meses**: acumulação de aging silencioso; a KPI operacional passa a
  mentir sistematicamente.

### R-3: Pool `max=5` + advisory lock retido ~240 s ⇒ starvation de requisições não-relacionadas

- **QA(s) afetados**: Availability + Performance
- **Findings de origem**: F-availability-1 (P1) — `availability.md`; F-performance-1 (P2) — `performance.md:68-105`
- **Evidência sintetizada**: `withAdvisoryLock` (`PostgreeDatabaseClient.ts:137-158`) mantém o
  MESMO `PoolClient` durante todo `reconciliarSerializado` (worst-case ~240 s: 6 chamadas
  Conexos × 40 s timeout). Com `pg.Pool.max = 5` (`PostgreeDatabaseClient.ts:26`) e
  `connectionTimeoutMillis = 5000`, 5 reconciliações concorrentes de adtos **distintos**
  (paralelismo legítimo — teste `ReconciliacaoPermutaService.test.ts:857` valida) consomem
  100 % do pool. Qualquer outra query (`/painel`, health-check, jobs cron, o próprio
  `beginExecution` da reconciliação em curso) espera 5 s e rejeita.
- **Divergência de severidade entre agentes** (P1 vs. P2): o `qa-availability` rotulou P1, o
  `qa-performance` rotulou P2. **Consolidator resolve como P1** — o modo de falha aqui não é
  "lentidão"; é *starvation de requisições não relacionadas* durante o fechamento diário
  (2 analistas + `/reconciliar-lote` de 6 adtos + painel atualizando). O impacto é UX de painel
  travado com 5 baixas de R$ 280 k na tela do operador, exatamente na janela em que ele mais
  precisa do sistema respondendo.
- **Card(s) Kanban relacionados**: `availability-1` (S+M, P1) — bump `max` 5→10 e instrumentar;
  `performance-3` (S/M, P2) — bump + reduzir janela do lock; `availability-4` (S, P2) — reduzir
  `heavyRouteLimiter` para a rota de escrita
- **Custo de inação em 6 meses**: primeiro incidente de "painel travado" durante fechamento sem
  métrica para diagnosticar — postura reativa numa ferramenta com R$ 38 M já em produção.
  Cada nova Frente (IV Recebimentos + jobs cron) que aterrissa encurta a folga.

### R-4: Advisory lock não tem prova cross-connection em Postgres real

- **QA(s) afetados**: Testability + Fault Tolerance
- **Findings de origem**: F-testability-1 (P2) — `testability.md:65-86`; F-testability-2 (P1) — `testability.md:88-110`
- **Evidência sintetizada**: os 4 testes de concorrência (`ReconciliacaoPermutaService.test.ts:787/827/857/874`)
  usam mock com `Set<number>` que re-implementa a semântica do lock. Isso prova o CONTRATO (o
  serviço chama `withAdvisoryLock` com chave estável derivada do `adiantamentoDocCod`, invoca
  `onBusy` quando ocupada). **Não** prova que `pg_try_advisory_lock` serializa entre conexões
  DIFERENTES do pool — o cenário de produção (Render ≥2 instâncias, um Postgres compartilhado).
  Simultaneamente, a migration 0054 é validada só no texto do SQL
  (`PermutaExecucaoRepository.test.ts:42` — `sql.toContain("... IN ('settled', 'parcial')")`), não
  na semântica do CHECK contra Postgres real. Um typo em migration futura, uma renomeação, um
  ambiente que não aplicou 0054, causam falha em runtime **depois** do POST `fin010`.
- **Impacto técnico**: as duas defesas mais caras deste delta (lock + CHECK) só existem
  "por construção", sem prova medida.
- **Impacto de negócio**: baixa probabilidade, alto impacto. Reintrodução silenciosa do
  defeito que o commit inteiro existe para fechar.
- **Card(s) Kanban relacionados**: `testability-baixa-1` (L, P1) — docker-compose.test.yml +
  ≥4 casos de integração PG. É a única peça arquitetural faltante para o veredito virar
  "prova medida em CI".
- **Custo de inação em 6 meses**: mantém a defesa como derivada, não medida. Se aparecer bug
  no lock ou desalinhamento de migration, aparece em prod.

### R-5: Wire Conexos sem Zod em `pago` + `titMnyTotPago` (parseFloat locale-cego)

- **QA(s) afetados**: Integrability + Security (Validate Input) + Fault Tolerance
- **Findings de origem**: F-integrability-1 (P1) — `integrability.md:79-101`; F-integrability-2 (P1) — `integrability.md:103-120`
- **Evidência sintetizada**: `titMnyTotPago` é o **pivô semântico** de `assertCobertura`
  (`ReconciliacaoPermutaService.ts:687-689` — `abertoUsd = usd − (pagoBrl ?? 0) / taxa`). Entra
  por `parseOptionalNumber` (`ConexosBaseClient.ts:356-360`), que faz `Number.parseFloat(String(raw))`
  sem enum-check, sem locale. `Number.parseFloat("1.234,56")` = `1.234` (trunca no vírgula) —
  4 ordens de magnitude a menos. Se o Conexos flipar `titMnyTotPago` para locale BR (o cliente
  é BR, o ERP tem tenants BR — não é hipótese absurda), `pagoBrl` colapsa, `abertoUsd ≈ usd`,
  cobertura resulta ≈ `Σ face`, e a pré-checagem I-Write-8a **aprova exatamente o caso do doc
  9320 que a ADR-0043 documenta como motivação**. Nem string nem NaN levantam. Simultaneamente,
  `pago` entra sem enum `1|2|3` — `pago==="PAGO"` vira `undefined` silencioso; a corroboração
  ADR-0043 morre sem sinal.
- **Impacto técnico**: dormente hoje (ERP devolve número JSON, formato US). *Ativa-se* na
  primeira mudança de contrato do fornecedor.
- **Impacto de negócio**: **crítico condicional**. Custo do fix: 1 schema Zod em 1 arquivo
  (~8 linhas) + 1 fixture BR-locale.
- **Card(s) Kanban relacionados**: `integrability-1` (S, P1); `integrability-3` (S, P2 — fixture);
  `integrability-2` (S, P2 — estender Zod aos 3 passos intermediários do handshake `fin010`)
- **Custo de inação em 6 meses**: uma evolutiva do fornecedor (locale, expansão de enum) passa
  despercebida em CI e chega em prod na tela do analista — reintroduz o defeito que a ADR-0043
  foi criada para barrar.

### R-6: `PERMUTAS_WRITE_ENABLED` inexistente — kill-switch da Frente I é o global `CONEXOS_WRITE_ENABLED`

- **QA(s) afetados**: Deployability + Modifiability
- **Findings de origem**: F-deployability-3 (P2) — `deployability.md:108-125`
- **Evidência sintetizada**: `render.yaml:29-58` tem `SISPAG_ENABLED`, `SISPAG_LIVE_WRITE_ENABLED`,
  `RECEBIMENTOS_ENABLED` (kill-switches por frente), `CONEXOS_WRITE_ENABLED` (global). **Não
  existe `PERMUTAS_*`**. Um incidente de escrita na Frente I hoje força escolha entre revert
  (com risco de R-1) ou derrubar `CONEXOS_WRITE_ENABLED` — que também para Recebimentos, uma
  frente independente com seu próprio livro-razão.
- **Card(s) Kanban relacionados**: `deployability-3` (S, P2) — 1 flag no `configManifest.ts` +
  gate no serviço + entrada no runbook
- **Custo de inação em 6 meses**: próximo incidente de Permutas força o operador a escolher
  entre revert arriscado e blast radius desnecessário.

### R-7: `/health` não expõe `writeEnabled`, `dryRun`, `lastMigration` — "vigência" do runbook depende de correlação manual

- **QA(s) afetados**: Deployability + Availability
- **Findings de origem**: F-deployability-2 (P2) — `deployability.md:88-106`
- **Evidência sintetizada**: `src/backend/index.ts:79` — `app.get('/health', … res.json({ status,
  version }))`. O runbook novo deste delta (`docs/runbooks/fin010-write-cutover.md:80-83`) diz
  "confirme que a versão em produção já traz a ADR-0043 — GET /health devolve a version, e a
  ADR aparece no CHANGELOG.md". Isso força o operador (às 2h da manhã, num incidente) a
  correlacionar version → CHANGELOG → ADR à mão E abrir o dashboard do Render para saber se
  `CONEXOS_WRITE_ENABLED=true`. Este delta apoia-se no `/health` como âncora sem completar a
  peça — reforça o card sem fechar.
- **Card(s) Kanban relacionados**: `deployability-2` (S, P2) — 5 campos no `/health`
- **Custo de inação em 6 meses**: 3–5 min de correlação por incidente antes do primeiro passo
  de diagnóstico.

### R-8: Guarda de paridade FE↔BE cobre 3/8 uniões e o regex é frágil

- **QA(s) afetados**: Testability + Modifiability + Integrability
- **Findings de origem**: F-testability-3 (P2) — `testability.md:112-133`; F-modifiability-3 (P3) — `modifiability.md:95-113`
- **Evidência sintetizada**: `types.test.ts:26,36` usa
  `readFileSync + match(new RegExp("export type X =([^;]+);"))` — quebra se alguém remove `;`
  no fim do type, se `;` aparece em JSDoc dentro da união, ou se a formatação colapsa a `\n\n`
  sentinela no FE. Cobre `ExecucaoStatus`, `PermutaStatus/PermutaStatusBordero`,
  `LoteAdiantamentoStatus`; não cobre `StatusElegibilidade`, `TipoPermuta`, `ProcessamentoStatus`,
  `BorderoSituacao`, `RelatorioTipo`. E não pega adição de PROPRIEDADE nova numa interface — que é
  o modo de falha mais frequente (o delta adicionou `valorResidualUsd?` a `ResultadoAlocacao`
  nos dois lados à mão; nada teria detectado se ficasse só de um lado).
- **Card(s) Kanban relacionados**: `testability-baixa-2` (M, P2) — extrair `as const` para
  módulo compartilhado; `modifiability-delta-2` (M, P3) — parity guard para interfaces
- **Custo de inação em 6 meses**: recorrência do defeito C-6 (badge divergente sem typecheck
  failure) em qualquer união fora das 3 cobertas.

### R-9: Guarda de truncamento (`rows.length !== count`) declarada "opcional" pela ADR-0043 é INEXEQUÍVEL do ponto atual do pipe

- **QA(s) afetados**: Integrability
- **Findings de origem**: F-integrability-4 (P2) — `integrability.md:132-147`
- **Evidência sintetizada**: `legacyConexosAdapter.listGeneric:26-30` desembrulha `.rows` e
  **descarta `count`** uma linha antes de `callList` receber; `ConexosBaseClient.callList:238`
  chama `listGeneric` (não `listGenericPaginated`). O critério da ADR (`rows.length !== count`)
  não é implementável em `assertCobertura` sem migrar `listTitulosAPagar` de `callList` para
  `paginate`/`listGenericPaginated`, propagar `count` até a interface do client. **A ADR
  sugere um follow-up barato; é caro** (3 camadas do pipe). Isso merece emenda na ADR.
- **Card(s) Kanban relacionados**: `integrability-4` (M, P2)
- **Custo de inação em 6 meses**: baixo agora (sonda mediu 1–2 títulos por invoice em 22 títulos,
  sem truncamento). Sobe quando uma invoice multi-parcela chegar — recusa indevida (falha para
  o lado seguro, mas atrapalha a analista).

### R-10: `AlocacaoSemCoberturaError.details` ecoa cobertura/valorAlocado/deficit no 422 — canal lateral latente

- **QA(s) afetados**: Security
- **Findings de origem**: F-security-delta-1 (P3) — `security.md:79-103`
- **Evidência sintetizada**: `respondHandlerError.ts:24-27` propaga `err.details` no payload
  HTTP 422. `AlocacaoSemCoberturaError.ts:52-58` popula esses três números + `invoiceDocCod`.
  Hoje é irrelevante — `requireRole('admin')` gate a rota E todos são `admin` (`security-1/2`
  do run pai). **Assim que `security-1/2/3` do run pai forem implementados** (role operador,
  `assertUserCanActOnFilial`), o `details` vira canal lateral que devolve faturamento em aberto
  por invoice para um role que provavelmente não deveria vê-lo cross-filial — porque o gate é
  na rota, mas o `details` é montado no serviço.
- **Padrão importante:** um *fix* de outro card (`security-3` do run pai) *ativa* esta exposição.
  Sinalize como classe latente.
- **Card(s) Kanban relacionados**: `security-delta-1` (S, P3)
- **Custo de inação em 6 meses**: acoplado ao roadmap de RBAC. Corrigir ANTES do landing de
  `security-3` é o momento certo.

## 3. Cross-cutting findings

### CC-1: Retração assimétrica de estado terminal (rollback re-executa `parcial`)

- **Aparece em**: Deployability + Fault Tolerance
- **Findings**: F-deployability-1 (P1), F-fault-tolerance-5 (P1)
- **Diagnóstico unificado**: derivação independente por dois QAs. Migration 0054 é forward-only,
  código anterior a `8b18686` não conhece o valor `parcial`, e `beginExecution` pré-delta só
  preserva `settled`. A ampliação do union num commit único, sem shim de leitura no código
  antigo, cria uma janela de retração assimétrica. É a mesma classe do P0 original, agora pela
  porta traseira da operação.
- **Recomendação consolidada**: entregar `deployability-1` + `fault-tolerance-2` no mesmo PR:
  (a) guard no `beginExecution` — recusar reabertura quando `bxa_cod_seq IS NOT NULL` (fecha
  a porta via dado, não via documento); (b) runbook `rollback-permutas-parcial.md` com SQL
  numerado; (c) marcar ADR-0043 no header como forward-only. Custo: ≤ 1 dia combinado.

### CC-2: Advisory lock retém client dedicado + pool `max=5` = starvation

- **Aparece em**: Availability + Performance
- **Findings**: F-availability-1 (P1), F-performance-1 (P2 — reclassificado P1 pelo consolidator)
- **Diagnóstico unificado**: o design correto (session-level advisory lock por adto) tem
  um custo de retenção que era invisível antes deste delta porque não havia lock. Agora existe,
  e o pool não foi redimensionado. `heavyRouteLimiter=10/min/IP` é 2× a capacidade do pool —
  admissão sem tampa efetiva.
- **Recomendação consolidada**: `availability-1` + `performance-3`(A) + `availability-4` no mesmo
  ciclo — bump `poolMaxConnections` 5 → 10 (ou 12), instrumentar `duration_ms` do lock e do
  handshake, reduzir `writeRouteLimiter` para `poolMax − 2`. Custo: S (config) + M (instrumentação
  + 2 semanas de p95 medido). Sem instrumentação, qualquer ajuste é adivinhação.

### CC-3: `parcial` sem sinal proativo — o "novo silêncio" da ADR-0043

- **Aparece em**: Availability + Fault Tolerance
- **Findings**: F-availability-2 (P1), F-fault-tolerance-4 (P1)
- **Diagnóstico unificado**: a defesa que a ADR institui (aceitar `parcial` em vez de recusar)
  troca o modo de falha "duplo POST" por "resíduo esquecido". SISPAG resolveu com reaper +
  `listReconcilingParadas`; Permutas ficou sem par. É a mesma dívida operacional que o run pai
  levantou; este delta o cria como categoria específica.
- **Recomendação consolidada**: uma entrega — `reaper-permutas-parcial.ts` (cópia mecânica do
  `reaper-sispag-reconciling.ts`) + `PermutaExecucaoRepository.listParcialPendentes` + endpoint
  `GET /permutas/execucoes?status=parcial` + card no painel operacional. Fecha os dois findings.
  Custo: S (≤ 1 dia).

### CC-4: Sem prova cross-connection do advisory lock + sem teste de integração da migration 0054

- **Aparece em**: Testability + Fault Tolerance
- **Findings**: F-testability-1, F-testability-2 (P1), com nota do `qa-fault-tolerance` sobre a mesma limitação
- **Diagnóstico unificado**: mock com `Set` prova contrato, não semântica. Migration validada
  no texto do SQL, não no comportamento do CHECK. Ambos convergem para "precisamos de Postgres
  real em CI".
- **Recomendação consolidada**: `testability-baixa-1` (L, P1) — docker-compose.test.yml + jest
  marker `integration:` + 4 casos mínimos (advisory lock cross-connection, CHECK aceita `parcial`,
  CHECK antigo rejeita, session lock não vaza pós-release). Peça arquitetural que serve os
  próximos deltas de Permutas e Recebimentos.

### CC-5: Boundary Conexos com Zod parcial — 2 de 5 passos do handshake + campos novos sem schema

- **Aparece em**: Integrability + Security (Validate Input) + Fault Tolerance
- **Findings**: F-integrability-1 (P1), F-integrability-2 (P1), F-integrability-3 (P2)
- **Diagnóstico unificado**: `ConexosBaixaClient` tem `BORDERO_CRIADO_SCHEMA` e
  `BAIXA_GRAVADA_SCHEMA` (passos 1 e 5); `listBaixas`, `excluirBaixa`, `excluirBordero` e o
  novo `listTitulosAPagar.pago`/`titMnyTotPago` seguem com `Number(...)` + `.filter(finite)` ou
  `parseOptionalNumber`. O padrão "boundary = Zod" declarado como P0 do run pai está
  parcialmente fechado; o delta estendeu o wire sem estender a disciplina.
- **Recomendação consolidada**: `integrability-1` + `integrability-2` no mesmo PR — 4 schemas
  Zod (1 em `ConexosTitulosClient.ts`, 3 em `ConexosBaixaClient.ts`), fixture BR-locale em
  `ConexosSubClients.test.ts`. Custo: S + S ≈ 1–2 dias.

## 4. Quick wins (≤ 5 dias úteis)

Cards com esforço S e severidade ≥ P2, alta razão impacto/esforço:

| Card | QA | Esforço | Severidade | Resultado esperado |
|---|---|---|---|---|
| `fault-tolerance-1` | Fault Tolerance | S | P1 | Reaper de `parcial` + endpoint + contador no painel — fecha CC-3 |
| `availability-2` | Availability | S | P1 | Idem (mesma entrega física do `fault-tolerance-1`; ver §3) |
| `deployability-1` | Deployability | S+S | P1 | Guard `bxa_cod_seq IS NOT NULL ⇒ abort` + runbook de rollback — fecha CC-1 |
| `fault-tolerance-2` | Fault Tolerance | S | P1 | Idem CC-1 pelo lado da migration/ADR |
| `availability-1` | Availability | S+M | P1 | Bump `poolMax` 5→10 + instrumentação `duration_ms` |
| `integrability-1` | Integrability | S | P1 | Zod em `TituloAPagar` + fixture BR-locale — fecha vetor CC-5 crítico |
| `availability-3` | Availability | S | P2 | Reaper cobre também `reconciling` órfão IN-DOUBT (extensão do `availability-2`) |
| `availability-4` | Availability | S | P2 | `writeRouteLimiter` alinhado a `poolMax` — fecha o mismatch 10/5 |
| `deployability-2` | Deployability | S | P2 | 5 campos em `/health` (`writeEnabled`, `dryRun`, `lastMigration`) |
| `deployability-3` | Deployability | S | P2 | `PERMUTAS_WRITE_ENABLED` — kill-switch dedicado |
| `deployability-4` | Deployability | S | P2 | Runbook: bloco "revert com estado novo persistido" |
| `integrability-2` | Integrability | S | P2 | Zod nos 3 passos intermediários do handshake `fin010` |
| `integrability-3` | Integrability | S | P2 | Fixtures wire-real com `pago` + BR-locale |
| `performance-3` (parte A) | Performance | S | P2 | Bump `poolMaxConnections` isolado — sub-item do `availability-1` |

## 5. Strategic moves (M / L / XL)

| Card | QA(s) | Esforço | Tactic alvo | Por que vale |
|---|---|---|---|---|
| `testability-baixa-1` | Testability + Fault Tolerance | L | Sandbox + Executable Assertions | O P0 fechado por este delta e o CHECK da 0054 são hoje defesas *derivadas*. Baseline: 0 testes de integração PG no módulo. Alvo: ≥4 casos. Vira "prova por construção" em "prova medida em CI". Sem isso, o próximo delta que tocar lock ou union arrisca reintroduzir R-1 do run pai sem sinal. |
| `performance-3` (parte B) | Performance + Availability | M | Bound Execution Times | Retenção do client dedicado no lock cai de ~240 s (worst-case: 6 chamadas × 40 s) para ≤ 90 s (só o trecho write). Amplia folga do pool sem crescer capacidade. Métrica dependente de `availability-1` para observar. |
| `integrability-4` | Integrability | M | Encapsulate | ADR-0043 declara `rows.length !== count` como "defensivo opcional"; medição neste run mostrou que o critério é *inexequível* sem migrar `listTitulosAPagar` de `callList` para `listGenericPaginated`. Baseline: 0 pontos do pipe onde `count` está acessível. Se uma invoice multi-parcela chegar (não impossível), sem esta base a subestimativa de cobertura vira recusa indevida. |
| `testability-baixa-2` | Testability + Modifiability | M | Executable Assertions | Baseline: 3/8 uniões cobertas, regex frágil em 3 vetores. Alvo: 8/8 via `as const` em módulo compartilhado. Custo de acrescentar união: 4 lugares → 2. Fecha classes de recorrência de C-6. |
| `testability-baixa-4` | Testability | M | Limit Structural Complexity | `ReconciliacaoPermutaService.test.ts` cruzou 1.301 LOC / 46 `it()`. Adicionar 1 `@inject` custa 46 edições `as never`. Sem split ou testkit, cada `/feature-tweak` paralela colide. |
| `modifiability-delta-2` | Modifiability + Integrability | M | Use an Intermediary | Guarda de parity só cobre uniões; o delta adicionou `valorResidualUsd?` em `ResultadoAlocacao` nos dois lados à mão. 0/5 interfaces guardadas. Alvo: 5/5 via parser ou pacote compartilhado. |

## 6. O que está bem (e por quê)

1. **Lock em `finally` aninhado** — `PostgreeDatabaseClient.ts:145-158`: o `pg_advisory_unlock`
   roda antes do `client.release()`, e se a conexão cair o Postgres libera o lock por sessão.
   *Transactions tactic — exception path coberto por construção.*
2. **Idempotência viva reconhece os DOIS terminais** — `ReconciliacaoPermutaService.ts:262-263`:
   `existente?.status === 'settled' || existente?.status === 'parcial'`. Zero regressão de
   re-POST em re-execução com terminal válido. *Idempotent Replay tactic.*
3. **Pré-checagem I-Write-8a é fail-closed pré-POST** — `assertCobertura:679-703` recusa 422
   ANTES do 1º POST irreversível. Tolerância ±0,005 explicitamente comentada. Poupa a analista
   de um `parcial` que o serviço sabe ser inevitável. *Exception Prevention tactic.*
4. **`markParcial` é IRMÃO de `markSettled`, não `settled` degradado** —
   `PermutaExecucaoRepository.ts:287-397`. Cada método afirma uma proposição distinta no
   livro-razão. Auditabilidade do ledger é o próprio negócio deste código. *Increase Semantic
   Coherence tactic.*
5. **Contract test FE↔BE lendo o arquivo-fonte** — `src/frontend/lib/types.test.ts:41-77`. Ativo
   raro no repo. O modo de falha mais frequente (adicionar estado só de um lado, os dois
   projetos compilam separados) morre para as 3 uniões cobertas.
6. **`respondHandlerError` — erros tipados chegam à UI com contrato** —
   `routes/permutas.ts:513-521` + `http/respondHandlerError.ts:21-32`. `AlocacaoSemCoberturaError`
   (422) e `ReconciliacaoEmAndamentoError` (409) chegam à analista com `userMessage` em PT,
   `code` estável, `retryable`. Não vazam `err.message` bruto. *Inform Actors tactic.*
7. **Migration idempotente e forward-compatible** — `0054_permuta_execucao_parcial.sql`:
   `DROP CONSTRAINT IF EXISTS` + `ADD COLUMN IF NOT EXISTS`; CHECK novo é SUPERSET do antigo,
   deploy blue/green passa sem quebrar instância antiga. Aplicada pelo `BootMigrator` sob
   `pg_advisory_lock(314159265)` antes do `listen()`. *Script Deployment Commands + Idempotent
   Deploys tactics.*
8. **`heavyRouteLimiter` protege o handshake** — 10 req/min/IP na rota `/reconciliar` é
   generoso para o pool (P2 registrado), mas ele existe e é `express-rate-limit` well-known
   pattern, não implementação caseira. *Limit Access tactic (herdado; delta preserva).*

## 7. Limitações da análise

- **Métricas declaradas como "não medíveis localmente" pelos agentes**:
  - Cobertura por arquivo neste run (`--quick`); a do módulo Permutas é 94,74 % stmts /
    72,78 % branch, medida no run pai.
  - `npm audit` profundo (`--quick`). Baseline do run pai: FE 8 HIGH, BE 3 moderate + 1 low.
  - Latência p95 real de `/reconciliar` em prod — sem instrumentação de duração (card
    `availability-5` do run pai; carregado como bloqueio de métrica de `performance-3`).
  - MTTR real de `parcial` — depende de intervenção humana; instrumentar quando shippar.
  - Retenção do lock em prod — sem `duration_ms`.
- **Não coberto pelo pipe neste stack**:
  - Chaos engineering — não temos harness de fault injection.
  - Threat modeling formal — Security cobre superfície do delta, não STRIDE completo.
  - Custo cloud — sem `infra/` neste repo (deploy Render Blueprint).
  - Acessibilidade — delta tocou `ui.tsx` (badge B1'); passou por suíte verde, não é auditoria a11y.
  - Terraform / IAM / CloudTrail / GuardDuty — o repo não tem `infra/`. Estado-alvo é AWS
    multi-tenant, mas não há arquivo para revisar. Registrado como N/A onde aplicável.
- **Correções a registros anteriores que este run produziu — não perder**:
  - **`mod-1` do run pai cita cc obsoleto.** `qa-modifiability` mediu `reconciliar` em cc 35
    em `main@47c48f8` (não 24 como o card afirma) e 36 pós-delta. Efeito real: +1, dentro do
    ruído. O card `mod-1` precisa ter o baseline atualizado quando for retomado.
  - **A ADR-0043 sugere um follow-up barato que é caro.** A guarda `rows.length !== count`
    (§ "defensiva opcional") é INEXEQUÍVEL do ponto atual do pipe — `legacyConexosAdapter.listGeneric`
    descarta `count`. Merece emenda na ADR registrando o custo real (M, 3 camadas). Registrado
    aqui e no card `integrability-4`.
- **Riscos latentes que se ativam depois — classe fácil de perder**:
  - **`titMnyTotPago` locale-cego** — dormente hoje (ERP devolve número JSON), acorda quando o
    fornecedor mudar formato. Card `integrability-1` cobre.
  - **`AlocacaoSemCoberturaError.details` — canal lateral latente**: hoje inócuo (12/12 `admin`),
    ativa quando `security-1/2/3` do run pai landing. Card `security-delta-1` cobre. **Padrão
    importante: um fix de outro card ATIVA esta exposição.**
- **Janela temporal**: snapshot do commit `8b18686` em 2026-09-08. Código é vivo; refazer o
  gate na próxima mudança do `service/permutas/*` que altere lock, terminal ou cobertura.
  `--quick` implica que a suíte foi rodada mas coverage/audit não foram recalculados.

## 8. Ações recomendadas (30 dias)

1. **Antes de merge**: implementar o guard defensivo de `deployability-1` (recusar reabertura
   quando `bxa_cod_seq IS NOT NULL`) e o runbook `rollback-permutas-parcial.md`. Fecha CC-1
   pela via mais barata. Custo: ≤ 1 dia combinado com `fault-tolerance-2`.
2. **Sprint 1 pós-approval — quick wins P1 (5 dias)**: entregar como bloco único
   (`fault-tolerance-1` + `availability-2` são o mesmo reaper); `availability-1` (bump
   `poolMax` 5→10 + instrumentar `duration_ms`); `integrability-1` (Zod em `TituloAPagar` +
   fixture BR-locale). Fecha CC-2 (pool starvation), CC-3 (novo silêncio) e o vetor crítico
   de CC-5 (contrato Conexos).
3. **Sprint 1 (continuação, dependente de 2)** — `availability-4` (writeRouteLimiter alinhado
   a `poolMax`), `deployability-2/3/4` (5 campos no `/health`, `PERMUTAS_WRITE_ENABLED`,
   runbook de rollback). Custo agregado: ~3 dias.
4. **Sprint 2 — peça arquitetural**: `testability-baixa-1` (docker-compose.test.yml + suíte
   de integração PG com ≥4 casos). Fecha CC-4. Habilita o próximo delta a testar lock e CHECK
   sem depender de mock. Custo: L (1–2 semanas), mas paga o resto do módulo.
5. **Sprint 2/3 — otimização com métrica**: após 2 semanas de `duration_ms` em prod,
   `performance-3` parte B (reduzir janela do lock puxando leituras pré-lock). Só executar
   depois de baseline medido — sem isso é adivinhação.

Follow-ups explícitos (P1/P2/P3) vão para
`ontology/_inbox/permutas-baixa-integridade-regis-followups.md`. Os P0/P1 estruturais do run pai
(`security-1/2/3/4/6`, `mod-1`, `testability-2/3`, `availability-5`, etc.) **continuam abertos**
— este delta os deixou intactos por escopo (era remediação de R-1/R-2), não por descarte.

---

*Assinado pelo `qa-consolidator` do pipeline Regis-Review, 2026-09-08. Baseia-se nos 8 relatórios
de QA (`availability.md`, `deployability.md`, `fault-tolerance.md`, `integrability.md`,
`modifiability.md`, `performance.md`, `security.md`, `testability.md`) + `_shared-metrics.md`
neste mesmo diretório. Score ponderado: 7,53 (arredondado para 7,5).*
