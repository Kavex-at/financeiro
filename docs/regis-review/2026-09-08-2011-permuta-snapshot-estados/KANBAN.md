---
type: regis-review-kanban
run_id: 2026-09-08-2011-permuta-snapshot-estados
total: 30
counts: { p0: 0, p1: 7, p2: 16, p3: 7 }
---

# Kanban — financeiro — 2026-09-08-2011-permuta-snapshot-estados

> Importável para o Kanban do time. Cada card abaixo já tem Problema / Melhoria Proposta / Resultado Esperado.
> Ordem: P0 (nenhum) → P1 (S → XL) → P2 (S → XL) → P3 (S → XL).
> IDs em kebab-case; taxonomia de estados em inglês; textos em pt-BR.

---

## P0 — Crítico

_Nenhum. Justificativa na §1 e §7 do REPORT.md._

---

## P1 — Alto

### [rollback-0054] Escrever `.rollback.sql` + dump prévio da 0054 (reverse determinístico via `motivo_bloqueio`)

**QA**: Fault Tolerance + Deployability + Availability + Integrability + Modifiability (consolida `availability-2`, `deployability-1`, `fault-tolerance-1`, `integrability-5`, `modifiability-5`)
**Tactic alvo**: Recovery — Rollback (backward)
**Esforço**: S
**Findings**: F-availability-2, F-deployability-1, F-fault-tolerance-1, F-integrability-5, F-modifiability-8

**Problema**
> A 0054 muta destrutivamente 152.516 linhas de `permuta_candidata_snapshot` e reescreve `total_bloqueadas` histórico de 250 runs (64.893 → 51.459, Δ −13.434). O valor "antes" do `status` é irrecuperável a partir do banco — apenas `motivo_bloqueio` sobrevive. Nenhum `pg_dump`/`CREATE TABLE _bkp AS SELECT` está registrado no `.sql` nem no `DEPLOY.md`. Reverse é determinístico (o CASE inverso pelo motivo é reconstruível), mas ninguém escreveu o SQL — quem reverter escreve sob pressão.

**Melhoria Proposta**
> (a) Adicionar `src/backend/migrations/0054_estado_ja_permutado.rollback.sql` (não incluído no runner automático; documentado em `docs/runbooks/rollback-0054.md`): recolapsa `status` para `elegivel|bloqueada` usando `motivo_bloqueio`; recomputa `total_bloqueadas` como `bloqueadas + casamento_manual + permuta_manual + ja_permutado`; reverte as CHECKs para os valores anteriores. (b) Opcional: `0054a_backup_pre_estado_ja_permutado.sql` com `CREATE TABLE permuta_candidata_snapshot__pre0054 AS SELECT * FROM permuta_candidata_snapshot IF NOT EXISTS`. (c) Testar o rollback num snapshot da produção (staging). (d) Registrar no CLAUDE.md a política: "migration com `UPDATE` sobre >1000 linhas exige script de reverse na review".

**Resultado Esperado**
> MTTR de reversão do backfill semântico ≤ 15 min (executar 1 script conhecido) em vez de improvisar. Existência de `0054_estado_ja_permutado.rollback.sql`: não → sim. Runbook em `docs/runbooks/` referenciando o script: 0 → 1.

**Métricas de sucesso**
- Scripts `*_rollback.sql` em `src/backend/migrations/`: 0 → ≥ 1 (0054) + política para futuras
- Tabelas `__pre0054`: 0 → 2 (temporárias, retenção 30d)
- Runbook publicado: 0 → 1

**Risco de não fazer**
> Se um defeito latente aparecer no read-path que consome `total_bloqueadas` (ex.: relatório mensal enviado ao Yuri usando o número histórico), reverter fica no improviso. A ADR-0043 rejeita view de compat, o que fecha a saída "avança corrigindo" para consumidores externos que dependam do dado colapsado.

**Dependências**: acesso a snapshot/staging com dados representativos.

---

### [lock-timeout-not-valid] Blindar `MigrationRunner` com `lock_timeout` + `statement_timeout` + convenção `NOT VALID`

**QA**: Availability + Performance (consolida `availability-1`, `performance-4`)
**Tactic alvo**: Removal from Service (bounded) + Software Upgrade + Bound Execution Times
**Esforço**: S
**Findings**: F-availability-1, F-performance-4

**Problema**
> `grep -c "lock_timeout|statement_timeout|NOT VALID"` na 0054 = 0. Nenhuma das 55 migrations do repo seta esses limites. `MigrationRunner.run` envia o arquivo cru via `databaseClient.insert(sql)` sem preludiar com `SET LOCAL`. `ADD CONSTRAINT CHECK` sem `NOT VALID` toma **ACCESS EXCLUSIVE** por full-scan de 152.516 linhas. Se uma sessão qualquer segurar lock em `permuta_candidata_snapshot` no momento do deploy (run em voo, scan longo), o `ALTER TABLE` da nova instância fica em espera indefinida — e `/health` não responde porque `app.listen()` ainda não foi chamado.

**Melhoria Proposta**
> No `MigrationRunner.run` (`src/backend/migrations/runMigrations.ts`), executar `SET LOCAL lock_timeout='30s'` e `SET LOCAL statement_timeout='5min'` antes do SQL de cada migration (mesma transação implícita). Adotar convenção: quando a migration usar `ADD CONSTRAINT CHECK`/`FOREIGN KEY` em tabela com >10k linhas, dividir em dois passos — `ADD CONSTRAINT ... NOT VALID` (instantâneo) + `VALIDATE CONSTRAINT ...` (não toma ACCESS EXCLUSIVE). Documentar no header de cada migration os limites que ela assume.

**Resultado Esperado**
> Deploy que inclua migração pesada tem tempo máximo de espera por lock previsível. Se a espera for excedida, o boot morre alto (fail-fast) com mensagem apontando `lock_timeout`; Render mantém versão anterior no ar.

**Métricas de sucesso**
- `grep -c "SET LOCAL lock_timeout" src/backend/migrations/runMigrations.ts`: 0 → 1
- Migrations com `ADD CONSTRAINT` sobre tabelas >10k linhas usando `NOT VALID`: 0% → 100%
- Tempo máximo teórico de boot travado em lock: ∞ → ≤ 30 s

**Risco de não fazer**
> Um deploy futuro que coincidir com uma run longa de eleição fica preso até o Render matar o boot por health-check timeout. Rollback = git revert + esperar o próximo ciclo.

**Dependências**: nenhuma (mudança isolada ao migration runner).

---

### [view-compat-snapshot] Publicar view de compat + `COMMENT ON COLUMN` para leitores externos da tabela

**QA**: Integrability
**Tactic alvo**: Encapsulate + Adhere to Standards
**Esforço**: S
**Findings**: F-integrability-1

**Problema**
> A 0054 amplia o domínio de `permuta_candidata_snapshot.status` de 2 para 5 valores e reescreve `total_bloqueadas` de 250 headers históricos (64.893 → 51.459). Qualquer leitor externo à aplicação — dashboard BI, planilha do analista, ferramenta interna consultando a Supabase direto — que filtre `WHERE status='bloqueada'` passa a devolver 20,7% a 63% menos linhas sem sinal, sem erro, sem log. É a mesma classe de defeito que este delta corrige internamente.

**Melhoria Proposta**
> Publicar `CREATE VIEW permuta_candidata_snapshot_legado AS SELECT run_id, doc_cod, pri_cod, CASE WHEN status = 'elegivel' THEN 'elegivel' ELSE 'bloqueada' END AS status, motivo_bloqueio, ... FROM permuta_candidata_snapshot;` numa migration 0055, com `COMMENT ON VIEW` marcando "DEPRECATED — use a tabela base; será removida em YYYY-MM-DD". Alternativa mais leve (fazer em paralelo): `COMMENT ON COLUMN permuta_candidata_snapshot.status IS 'ADR-0043 (2026-09-08): dominio ampliado de 2 para 5 valores. Filtros externos WHERE status=bloqueada mudaram de significado — ver docs/adr/0043.md'`.

**Resultado Esperado**
> Leitor externo que consulte a view continua vendo o domínio binário; leitor que consulte a tabela base vê o novo domínio; consulta acidental encontra o `COMMENT ON` (visível em `\d+` do psql e em DBeaver/Metabase).

**Métricas de sucesso**
- `SELECT relname FROM pg_class WHERE relname='permuta_candidata_snapshot_legado'`: 0 → 1
- `COMMENT ON COLUMN`/`COMMENT ON VIEW` presente: 0 → 1

**Risco de não fazer**
> Uma sala de reunião com o cliente em que um dashboard mostra "queda de 20% nas bloqueadas" e alguém celebra, sem saber que é reclassificação. O ADR-0043 §Consequências antecipa exatamente esse cenário; este card é a defesa técnica que falta.

**Dependências**: nenhuma; pode ir sozinho como migration 0055.

---

### [rollback-assimetrico] Fechar a janela deploy antigo × schema novo (TRIGGER de bloqueio + runbook)

**QA**: Fault Tolerance + Deployability (consolida `fault-tolerance-2`, `deployability-2`)
**Tactic alvo**: Sanity Checking + Recovery — Rollback (backward)
**Esforço**: M
**Findings**: F-fault-tolerance-2, F-deployability-2

**Problema**
> A 0054 estende a CHECK de `permuta_candidata_snapshot.status` para 5 valores e a de `permuta_adiantamento.estado_elegibilidade` para 6. O código de `origin/main` grava só `elegivel|bloqueada` no snapshot e usa `default: 'descoberta'` no `toEstadoRow`. Se o deploy for revertido para `origin/main` sem também reverter a migration (cenário-padrão de rollback de emergência), a CHECK aceita a regressão silenciosamente e ~80 linhas promovidas a `ja-permutado` voltam a `bloqueada` na primeira ingestão — o bug corrigido reaparece com zero sinal de fault.

**Melhoria Proposta**
> Em ordem de preferência: (a) `TRIGGER BEFORE INSERT/UPDATE` em `permuta_adiantamento` e `permuta_candidata_snapshot` que rejeite o combo antigo (`estado_elegibilidade='bloqueada' AND motivo_bloqueio='ja-permutado'` em uma; `snapshot.status='bloqueada' AND motivo_bloqueio IN ('composto-nm','cliente-filtro','ja-permutado')` na outra) — se código antigo tentar reintroduzir a regressão, o INSERT falha alto. (b) Documentar explicitamente em `DEPLOY.md` que rollback do deploy ≠ rollback OK sem rollback do banco, com o comando exato para reverter 0054 (reusa o script de `rollback-0054`). (c) `docs/runbooks/rollback-deploy.md` + workflow `gh workflow run rollback-to-tag -f tag=v0.34.0` que faça revert + roda SQL parametrizado.

**Resultado Esperado**
> Deploy/rollback assimétrico deixa de ser silencioso. Se `origin/main` for redeployado sem reverter 0054, a próxima ingestão FALHA com constraint violation em vez de sobrescrever ~80 rows. Runbook centralizado desalinha `render.yaml`+`DEPLOY.md`+`BootMigrator.ts` (3 fontes discordantes → 1).

**Métricas de sucesso**
- Cenário "rollback do deploy sem rollback da migration" tratado: 0 defesa → ≥ 1 (trigger + runbook)
- Linhas revertidas silenciosamente por ingestão pós-rollback: ~80 → 0 (com trigger)
- Passos manuais em rollback: 4+ → 1 (`gh workflow run rollback-to-tag`)

**Risco de não fazer**
> Em qualquer incidente que force rollback de emergência do BE (bug futuro no fluxo de execução da permuta, por exemplo), o bug do snapshot binário volta silenciosamente. O relatório de impacto v1 já custou uma correção pública; uma repetição custa mais.

**Dependências**: `rollback-0054` (o script de reverse SQL é insumo do workflow).

---

### [taxonomia-fonte-unica] Colapsar `EstadoElegibilidade` em fonte única + espelho para o frontend

**QA**: Modifiability + Integrability (consolida `modifiability-1`, `integrability-2`)
**Tactic alvo**: Restrict Dependencies + Encapsulate + Abstract Common Services
**Esforço**: M
**Findings**: F-modifiability-1, F-integrability-2

**Problema**
> Os 5 estados (`elegivel`, `bloqueada`, `casamento-manual`, `permuta-manual`, `ja-permutado`) vivem em 6 representações paralelas TS: enum canônico em `interface/permutas/EstadoElegibilidade.ts`, union `EstadoElegibilidadeRow` em `PermutaRelationalRepository.ts`, union `StatusElegibilidade` em `interface/permutas/Gestao.ts`, cópia carbono em `src/frontend/lib/types.ts`, e mapas `STATUS_LABEL`+`STATUS_OPTIONS` em `src/frontend/app/permutas/components/format.ts`. Este próprio delta pagou o preço: ~10 arquivos de produção mexidos para introduzir `JA_PERMUTADO`. `PermutaRelationalRepository.ts:11-16` reconhece a duplicação em comentário: "uma fonte só" — aspiração que não virou código. As 2 CHECKs SQL (uma por tabela) diferem em `descoberta` **por construção** — `descoberta` é o estado transitório de uma candidata ainda não avaliada, e o snapshot só grava candidatas após a avaliação. Essa diferença é intencional (o snapshot rejeita gravar auditoria de algo não avaliado) e não é o alvo deste card — o alvo é a duplicação em TypeScript.

**Melhoria Proposta**
> (a) Tornar `ESTADO_ELEGIBILIDADE` (`src/backend/domain/interface/permutas/EstadoElegibilidade.ts`) a única fonte da verdade em código. (b) Derivar `EstadoElegibilidadeRow = EstadoElegibilidade | 'descoberta'` em vez de reescrever a lista. (c) Frontend importa via barrel `interface/permutas/index.ts` copiado no build OU `scripts/gen-frontend-types.ts` emitindo `src/frontend/lib/generated/estados.ts` — elimina a re-declaração em `frontend/lib/types.ts`. Substituir arrays hardcoded em `frontend/format.ts` por `.map` sobre `Object.values(ESTADO_ELEGIBILIDADE)`. (d) Documentar em ambas as CHECKs SQL o motivo da diferença de `descoberta` (comentário SQL + link para o card).

**Resultado Esperado**
> Adicionar um estado novo toca 1 arquivo TS (+ eventuais migrations SQL) em vez de 6; build quebra em todos os lugares onde a decisão de estado importa; diferença de `descoberta` entre as duas CHECKs fica documentada como invariante intencional.

**Métricas de sucesso**
- Fontes paralelas TS: 6 → 1
- Arquivos tocados em `/feature-new` para adicionar 1 estado: 10+ → ≤ 4
- Comentário SQL em cada CHECK explicando a inclusão/exclusão de `descoberta`: ausente → presente em ambas

**Risco de não fazer**
> Repetir a classe exata do bug corrigido (2,72× de inflação em passivo externo por 3 meses). ADR-0013 prevê `EXECUTADA` na Fase 3 — a probabilidade de omissão em 1 dos 6 lugares TS é ≈ 1.

**Dependências**: nenhuma; pode rodar isolado. Prefere vir antes de `assertNever-propagacao` (mais tipos únicos = mais alcance do helper).

---

### [assertNever-propagacao] Instalar `assertNever` e propagar para todos os despachos sobre `EstadoElegibilidade`

**QA**: Modifiability + Testability + Integrability (consolida `modifiability-2`, `testability-2`, F-modifiability-7)
**Tactic alvo**: Refactor + Abstract Common Services + Limit Structural Complexity
**Esforço**: M
**Findings**: F-modifiability-2, F-modifiability-7, F-testability-3

**Problema**
> Um único `switch` do delta (`IngestaoPermutasService.toEstadoRow`) usa `const naoMapeado: never = estado` para forçar exaustividade. Os outros ≥20 sítios que ramificam por estado (`EleicaoPermutasService.contarPorEstado`, 5 filters em `GestaoPermutasService`, 12 em `RelatorioExportService`, `JobRunReadModel.metricas`, `StatusBadge`, `format.ts`) aceitam calado um estado desconhecido. A ferramenta do desenvolvedor é `grep`, e a lição do delta é que `grep` falha.

**Melhoria Proposta**
> (a) Criar `src/backend/domain/libs/assertNever.ts` (função que recebe `never` e lança). (b) Refatorar os sítios acima em `switch (estado)` com todos os `case ESTADO_ELEGIBILIDADE.*` + `default: assertNever(estado)`. (c) No frontend, portar o helper (`src/frontend/lib/assertNever.ts`) e aplicar em `StatusBadge` e `format.ts` (substituir if-chain por `switch`). (d) Adicionar 1 teste que ateste, para cada consumidor de `EstadoElegibilidade`, que ele opera sobre TODOS os 5 valores do enum.

**Resultado Esperado**
> Sítios exaustivos sobre `EstadoElegibilidade`: 1 → ≥ 6 (5% → 75%+). Adicionar um estado novo quebra o build em cada lugar que precisa opinar sobre ele; nada silencia.

**Métricas de sucesso**
- Sítios com `assertNever`: 1 → ≥ 6
- `grep -rn "status === '" src/backend/domain/service/permutas` em contexto de contagem: 20 → 0
- `StatusBadge` fallback silencioso → `default: assertNever`

**Risco de não fazer**
> O próximo estado (ADR-0013 prevê `EXECUTADA`) reproduz a classe do bug em ≥ 20 sítios ao mesmo tempo.

**Dependências**: `taxonomia-fonte-unica` preferível antes.

---

### [migration-test-harness] Harness `docker-compose.test.yml` + Postgres 16 + testes de integração para a 0054

**QA**: Testability + Deployability
**Tactic alvo**: Sandbox + Executable Assertions
**Esforço**: L
**Findings**: F-testability-1, F-testability-5, F-testability-6

**Problema**
> A migration 0054 (227 LOC, backfill de 152.516 linhas + 250 headers com `RAISE EXCEPTION` que aborta se divergir) NÃO tem NENHUM teste automatizado. `BootMigrator.test.ts` cobre o RUNNER (lock, propagação de erro), não o CONTEÚDO SQL. Não existe `docker-compose.test.yml`, nem `--integration` no Jest, nem test-pg harness. O contrato de idempotência ("rodar duas vezes é no-op") declarado no cabeçalho **não é testado** — em produção só roda 1 vez.

**Melhoria Proposta**
> Introduzir `docker-compose.test.yml` com Postgres 16 + um novo `migrations/__integration__/` seguindo padrão CLAUDE.md (`describe('integration: ...')`). Escrever `0054_estado_ja_permutado.integration.test.ts` com 3 cenários: (a) aplica em schema virgem + fixture de 3 runs típicas, assere distribuição final; (b) reaplica sem apagar `schema_migrations` — assere no-op (row counts iguais); (c) injeta uma row divergente (header diz 100 elegíveis, snapshot só tem 50) e assere que `RAISE EXCEPTION` dispara com mensagem instrumentada. Harness reutilizável para próximas migrations com backfill.

**Resultado Esperado**
> Testes automatizados cobrindo `0054_estado_ja_permutado.sql`: 0 → 3 cenários; harness reutilizável para próximas migrations com backfill; próxima pessoa consegue re-verificar sem refazer o setup à mão.

**Métricas de sucesso**
- Testes cobrindo migration 0054: 0 → 3 cenários
- Migrations com harness Postgres real disponível: 0 → 1 template + 1 exemplo
- Contratos de idempotência declarados mas não testados: 1 → 0

**Risco de não fazer**
> Próxima correção de projeção herda o mesmo padrão de "medi na PRD antes do commit e torci" — o próprio ADR-0043 nasceu de um bug assim que durou 3 meses. `_watchlist.md` já pauta 0054-like em recebimentos/pagamentos.

**Dependências**: nenhuma (paralelo). Cruza com `rollback-assimetrico` (o teste de integração vira gate do runbook de rollback).

---

## P2 — Médio

### [boot-observabilidade] Expor `/health` mínimo antes de `BootMigrator.run()` + `statement_timeout` no runner

**QA**: Availability + Performance (consolida `availability-3`, `performance-1`)
**Tactic alvo**: Ping/Echo + Monitor + Bound Execution Times
**Esforço**: M
**Findings**: F-availability-3, F-performance-1

**Problema**
> `/health` só é servido após `app.listen()`, que só é chamado depois de `BootMigrator.run()` completar. Durante a janela de migração — que hoje inclui a 0054 tocando 152 k linhas — a sonda externa recebe TCP-refused. Complica diagnóstico e é bloqueante para migração eventual para plano com rolling deploy.

**Melhoria Proposta**
> (a) Iniciar um mini-server Express (só `/health` respondendo `{status:'migrating', version}`) antes de invocar `BootMigrator.run()`, e substituí-lo pelo app completo após a migração terminar. (b) Envelopar cada migration no runner com `SET LOCAL statement_timeout='5min'` (complementa `lock-timeout-not-valid`). (c) Documentar a versão do Supabase (PG 17.6, medida em PRD 2026-09-08) num arquivo de premissas.

**Resultado Esperado**
> Sonda externa vê `HTTP 200 {status:'migrating'}` durante a janela de migração, `HTTP 200 {status:'ok'}` depois. Sem TCP-refused nunca. Habilita observabilidade e destrava rolling deploy quando o plano do Render permitir.

**Métricas de sucesso**
- Tempo com `/health` inalcançável durante deploy: `duração_da_migração` → 0
- Estado do `/health` distinguível: sim → `{status:'migrating'}` durante, `{status:'ok'}` depois

**Risco de não fazer**
> Falso positivo de "serviço fora do ar" durante deploys longos; incapacidade de instrumentar duração real de boot migrations. **Não** propõe tirar migration do boot (mitigação deliberada pós-incidente 2026-08-10; ver §7 do REPORT.md).

**Dependências**: nenhuma. Combina bem com `lock-timeout-not-valid`.

---

### [deprecacao-rotas] Política HTTP de deprecação (Sunset/Deprecation + 410 Gone) + `docs/api/CONTRACTS.md`

**QA**: Integrability + Deployability (consolida `integrability-4`, `deployability-6`)
**Tactic alvo**: Versioning strategy + Scale Rollouts
**Esforço**: M
**Findings**: F-integrability-4, F-deployability-6

**Problema**
> `GET /permutas/painel` foi removido por deleção pura. A premissa "zero call sites" foi verificada só dentro do monorepo — não há inventário de API financeira publicado (`docs/conexos-api/` cataloga o Conexos, não este backend). Consumidores externos (BI, planilhas, jobs Airflow) descobrem a remoção como 404 sem contexto. `grep -rn "Sunset|Deprecation" src/backend/routes` = 0.

**Melhoria Proposta**
> (a) Publicar `docs/api/CONTRACTS.md` listando endpoints públicos do backend financeiro e sua estabilidade. (b) Padrão de deprecação: 1 sprint antes da remoção, a rota devolve 200 + headers `Deprecation: true` e `Sunset: <RFC 7231 date>`, e log `BUSINESS_WARN` em cada chamada. (c) Na remoção, a rota devolve 410 Gone com body `{removed:true, since, adr, substituto}` por 1 sprint antes de virar 404.

**Resultado Esperado**
> Consumidor externo que ainda dependa de um endpoint em deprecação recebe sinal in-band (header + log) e o operador tem visibilidade via `BUSINESS_WARN`. Após remoção, 410 dá pista técnica em vez de 404 mudo.

**Métricas de sucesso**
- Rotas removidas com `Deprecation`/`Sunset` header prévio: 0/1 → 1/1
- `docs/api/CONTRACTS.md` publicado: ausente → presente

**Risco de não fazer**
> Em ~6 meses, outra rota será removida com o mesmo raciocínio "zero call sites no repo" e algum consumidor externo — potencialmente uma planilha do próprio cliente — quebra na hora do deploy sem chance de reação.

**Dependências**: nenhuma.

---

### [metricas-camelcase] Renomear as 3 chaves pt-BR com espaço/acento em `JobRunReadModel.metricas`

**QA**: Integrability + Modifiability (registrada como dívida consciente)
**Tactic alvo**: Tailor Interface (feita de forma consistente)
**Esforço**: S
**Findings**: F-integrability-3, F-modifiability-6

**Problema**
> `JobRunReadModel.ts:196-198` grava chaves de contrato HTTP como `'casamento manual'`, `'permuta manual'`, `'já permutado'` (com espaço e acento). O objeto mistura 3 chaves camelCase ASCII com 3 chaves pt-BR-com-espaço, criando assimetria dentro do mesmo contrato. Foi decisão explícita do Yuri para evitar tocar o frontend e acionar o DesignSystemReviewer — **dívida consciente**, não descuido. Consumidor precisa fazer `obj['já permutado']`; codegen que exija identificador válido quebra; um 6º estado exige lembrar deste arquivo, sem help do compilador.

**Melhoria Proposta**
> Renomear as 3 chaves para `casamentoManual`, `permutaManual`, `jaPermutado`. Introduzir mapa de rótulos no frontend (`src/frontend/lib/labels/metricas.ts`) — 1 linha por métrica. DesignSystemReviewer é acionado sim, mas para um patch de 1 arquivo, não uma redesign.

**Resultado Esperado**
> 6/6 chaves de `metricas` seguem camelCase ASCII. Frontend consome `data.metricas.jaPermutado` diretamente. Consumidor Python/BI faz `dataclass(ja_permutado: int)` sem `Field(alias=...)`.

**Métricas de sucesso**
- Chaves de `metricas` com identificador JS/TS válido: 3/6 → 6/6
- Arquivos de frontend tocados: 1 (mapa de rótulos)

**Risco de não fazer**
> Cada consumidor futuro paga o pedágio do `obj['já permutado']`. ADR-0042 e a decisão de linguagem em CLAUDE.md dizem "mensagens em pt-BR"; **chaves** de payload não são mensagem — são identificadores.

**Dependências**: coordenar com DesignSystemReviewer (mudança no frontend).

---

### [cobertura-motivos] Fechar mapeamento por motivo com asserção de cobertura enumerada

**QA**: Availability
**Tactic alvo**: Sanity Checking
**Esforço**: S
**Findings**: F-availability-4

**Problema**
> A DO block da 0054 reconcilia agregados; um `motivo_bloqueio` novo que aparecesse entre a medição de 2026-09-08 e o deploy cairia em `ELSE 'bloqueada'` sem sinalizar. Hoje é seguro porque a taxonomia é estável, mas nada no código enforça essa suposição.

**Melhoria Proposta**
> Antes do UPDATE do snapshot na próxima migration análoga, executar `SELECT DISTINCT motivo_bloqueio FROM permuta_candidata_snapshot WHERE status='bloqueada'` e comparar contra a lista enumerada no CASE. `RAISE EXCEPTION` se aparecer motivo fora da lista esperada.

**Resultado Esperado**
> Se a taxonomia de `motivo_bloqueio` mudar no futuro, a próxima migração que dependa dela falha alto ANTES de rodar o backfill, apontando exatamente qual motivo é inesperado.

**Métricas de sucesso**
- Motivos silenciosamente absorvidos por `ELSE`: possível → 0 (asserção enumera)

**Risco de não fazer**
> Pequeno hoje; cresce se a Frente I evoluir a taxonomia sem revisar migrações antigas.

**Dependências**: nenhuma.

---

### [pg-do-pos-backfill] Adicionar `DO $$` self-test pós-backfill (0055 imediatamente subsequente)

**QA**: Fault Tolerance
**Tactic alvo**: Self-Test + Sanity Checking
**Esforço**: S
**Findings**: F-fault-tolerance-3, F-fault-tolerance-5

**Problema**
> A asserção do 0054 confere o estado ANTES do UPDATE. Se um bug no CASE do §6 produzir classificação errada, nem a asserção nem a CHECK permissiva sinalizam nada. A migration atomiza tudo com sucesso, mas o conteúdo pode estar errado. A invariante I5 é conferida por testes unitários e por construção no código NOVO — o histórico backfilled não é revalidado após a escrita.

**Melhoria Proposta**
> Adicionar 0055 imediatamente subsequente (evitando alterar 0054 já aplicada) com bloco `DO $$` que rode a MESMA agregação de `EleicaoPermutasService.contarPorEstado` diretamente em SQL sobre o snapshot recém-mutado, compare com o header recém-recomputado e `RAISE EXCEPTION` se algum `total_<s> <> COUNT(*) FILTER (WHERE status=s)`.

**Resultado Esperado**
> A convergência I5 sobre o histórico backfilled fica auto-validada: qualquer bug no CASE derrubaria a migration inteira.

**Métricas de sucesso**
- Blocos `DO $$` pós-mutação: 0 → 1
- Cobertura da invariante I5 sobre histórico: pré-condição → verificação linha a linha pós-UPDATE

**Risco de não fazer**
> Bug futuro em migration análoga (recebimentos, pagamentos — pautados no `_watchlist.md`) fica sem defesa.

**Dependências**: nenhuma.

---

### [job-audit-i5] Job periódico de reconciliação I5 sobre todas as runs

**QA**: Fault Tolerance
**Tactic alvo**: Reconcile + Condition Monitoring
**Esforço**: S
**Findings**: F-fault-tolerance-5

**Problema**
> A invariante I5 é garantida por construção nas runs escritas pelo código-alvo. Não há job recorrente que audite `header.total_<s> === COUNT(snapshot WHERE status=s)` sobre o histórico — se uma regressão futura reintroduzir divergência silenciosa, ela só será percebida por relato humano.

**Melhoria Proposta**
> Novo job `probe-fidelidade-snapshot-eleicao.ts` em `src/backend/jobs/`, agendado diariamente (mesmo cron da ingestão), que rode a agregação de referência sobre `permuta_candidata_snapshot` e compare com `permuta_eleicao_run.total_<s>`. Falhas viram `LogService.error` com `type: BUSINESS_INVARIANT_BROKEN` e listagem das runs divergentes.

**Resultado Esperado**
> Divergência silenciosa detectada em ≤ 24h. Linha `probe-fidelidade-snapshot-eleicao` na trilha de execução de jobs em PRD; 0 runs divergentes reportadas como baseline.

**Métricas de sucesso**
- Jobs recorrentes de audit da I5: 0 → 1
- Runs divergentes reportadas: — → 0 (baseline)

**Risco de não fazer**
> A regressão que este ciclo corrigiu volta a ser descoberta por analista — mesmo modo de falha que originou o ciclo.

**Dependências**: nenhuma; pode reusar `job-execucao` (ADR-0042).

---

### [migration-begin-commit] `BEGIN;`/`COMMIT;` explícito + teste de atomicidade no `MigrationRunner`

**QA**: Fault Tolerance
**Tactic alvo**: Redundancy (defesa em profundidade)
**Esforço**: S
**Findings**: F-fault-tolerance-4

**Problema**
> A atomicidade da 0054 (e das 0005/0012) depende do implicit-transaction do simple-query protocol — comportamento correto do PG hoje, mas não coberto por teste. Um refactor futuro do `MigrationRunner` que faça split por `;`, migre para extended query protocol com parâmetros nomeados, ou use `psql -f`, quebra silenciosamente a invariante sem que nenhum teste falhe.

**Melhoria Proposta**
> (a) Prefixar cada migration destrutiva com `BEGIN;` e sufixar com `COMMIT;` — atomicidade **declarada**, independente do driver. (b) Adicionar teste em `runMigrations.test.ts` que crie uma migration fake com dois `INSERT`s seguidos de `RAISE`, execute pelo runner real, e verifique 0 linhas persistidas.

**Resultado Esperado**
> A atomicidade multi-statement passa a ser uma invariante testada, não um efeito colateral não documentado.

**Métricas de sucesso**
- Testes de atomicidade do MigrationRunner: 0 → 1
- Migrations destrutivas com `BEGIN;/COMMIT;` explícitos: 0 → ≥ 1

**Risco de não fazer**
> Um refactor do runner meses depois quebra a atomicidade de próximas migrations sem que ninguém perceba.

**Dependências**: nenhuma. Combina com `migration-test-harness`.

---

### [fast-check-i5] Property-based test sobre a invariante I5 (fast-check)

**QA**: Testability
**Tactic alvo**: Executable Assertions
**Esforço**: S
**Findings**: F-testability-2

**Problema**
> `EleicaoPermutasService.test.ts:1259` prova convergência I5 SÓ para o input canônico dos 5 estados com 1 candidata cada. Um refactor que passe a derivar contagens de fontes distintas passa esse teste e regride em produção com um input diferente (all-elegivel, all-bloqueada, N > 500 disparando chunking).

**Melhoria Proposta**
> Adicionar `fast-check` como dev-dep no `src/backend/package.json`. Escrever `EleicaoPermutasService.invariants.test.ts` com um arbitrário de `PermutaCandidata[]` (tamanhos 0..1500, mix de 5 estados) e propriedade: para toda run, `contarPorEstado(candidatas).totalX === candidatas.filter(c => c.estado === X).length` e `headerParams === snapshotStatusCount`.

**Resultado Esperado**
> Formatos de input testados para I5: 1 → ≥100 (100 runs × dezenas de shrinks); property-based tests no backend: 0 → 1.

**Métricas de sucesso**
- Property-based tests no backend: 0 → 1
- Cenários exercitando I5: 1 → ≥ 100

**Risco de não fazer**
> O próximo bug de projeção passa pela mesma peneira que este passou (uma coincidência para 5 rows).

**Dependências**: nenhuma.

---

### [colapsar-scans-0054] Refactor de referência: colapsar 4 scans em 2 usando `RETURNING`+CTE

**QA**: Performance
**Tactic alvo**: Reduce Overhead
**Esforço**: S
**Findings**: F-performance-2

**Problema**
> Dentro da 0054 há 4 full-scans sobre `permuta_candidata_snapshot`: (1) validação do `ADD CONSTRAINT`, (2) asserção `DO $$` com CTE `mapeado`+`por_run`, (3) UPDATE do snapshot, (4) UPDATE do header com subquery agregada. Os passes 2 e 4 calculam exatamente as mesmas agregações. A 0054 já foi mergeada, mas o refactor vira **template para a próxima migração**.

**Melhoria Proposta**
> Refatorar o UPDATE do snapshot com `RETURNING run_id, status`, capturar num `WITH updated AS (...)` e reusar para agregar o header. Documentar como pattern em `docs/patterns/migrations.md`.

**Resultado Esperado**
> Passes de tabela cheia: 4 → 2 (ADD CONSTRAINT + UPDATE combined). Extrapolado para 848k linhas (projeção 12 meses): ~14 s → ~7 s.

**Métricas de sucesso**
- Passes de tabela cheia (template): 4 → 2
- Tempo local rerun em cópia: 2,6 s → ~1,3 s

**Risco de não fazer**
> A próxima migration sobre snapshot copia a estrutura da 0054 e herda o custo — com 848k linhas em 12 meses o overhead vira janela de deploy travada.

**Dependências**: `boot-observabilidade` (se `/health` mínimo estiver em PRD, o custo cai porque não bloqueia mais o healthcheck).

---

### [rbac-gestao-adr] ADR formalizando a política de RBAC em `/permutas/gestao`

**QA**: Security
**Tactic alvo**: Authorize Actors + Limit Access
**Esforço**: S
**Findings**: F-security-3

**Problema**
> `GET /permutas/gestao` responde 200 para qualquer role (o teste `RBAC — requireRole nas rotas de mutação` afirma isso explicitamente). O payload traz o passivo consolidado — pendentes, invoicesEmAberto, casamentos, totais por estado, incluindo `pesCod`/`importador` e valores em BRL. Enquanto as 7 mutações são gatiadas por `requireRole('admin')`, a leitura mais rica do domínio não é. Não é claro se essa é decisão de produto ou omissão histórica — este ciclo é a primeira vez que o comportamento é assumido por teste.

**Melhoria Proposta**
> Uma de duas ações concretas (ADR curta em `ontology/decisions/`): (1) **se é intencional**: registrar ADR-0044 "Leitura de `/permutas/gestao` é aberta a todo autenticado" + comentário em `permutas.ts:423` remetendo à ADR. (2) **se não é**: aplicar `requireRole('analyst')` no handler + caso `role: 'viewer'` → 403 no bloco RBAC do teste.

**Resultado Esperado**
> Política de leitura em `/permutas/gestao` documentada por ADR OU gatiada por role — nunca "porque o teste diz que sim".

**Métricas de sucesso**
- Rotas de leitura sensíveis sem RBAC e sem ADR justificando: 1 → 0
- Presença de ADR sobre a política: 0 → 1

**Risco de não fazer**
> Em 6 meses, uma discussão sobre "quem pode ver o passivo consolidado" (SOX, LGPD, cliente demandando compliance do CNPJ) ressurge e o repositório não tem resposta escrita.

**Dependências**: decisão de produto (Yuri).

---

### [bump-version-node] Portar `bump-version.ps1` para Node

**QA**: Deployability
**Tactic alvo**: Script Deployment Commands + Reproducible Builds
**Esforço**: S
**Findings**: F-deployability-3

**Problema**
> `bump-version.ps1` tem shebang `#!/usr/bin/env pwsh` e o ambiente atual (Linux, `which pwsh` vazio) não tem PowerShell instalado. O passo Ship (green criterion #10 do CLAUDE.md) obriga o script — Linux devs não conseguem completar `/feature-tweak` sem instalar dependência extra.

**Melhoria Proposta**
> Reescrever `scripts/bump-version.ps1` em Node (`scripts/bump-version.mjs`), usando `fs`/`path` nativos + `child_process.execSync('git ...')`. TypeScript não é necessário — é ~100 linhas de lógica semver.

**Resultado Esperado**
> `node scripts/bump-version.mjs` roda em qualquer OS onde já roda o backend. Zero dependência extra.

**Métricas de sucesso**
- Dependência de runtime não-Node no path de release: 1 (pwsh) → 0
- Devs bloqueados no Ship por OS/runtime: 100% dos Linux sem pwsh → 0%

**Risco de não fazer**
> Novo dev Linux gasta um dia debugando o Ship, ou pula o passo e commita sem `chore(release)` — versão em `/health` diverge do estado do repo.

**Dependências**: nenhuma.

---

### [changelog-promover] `bump-version` promove `## Não lançado` em vez de inserir bloco acima

**QA**: Deployability
**Tactic alvo**: Script Deployment Commands
**Esforço**: S
**Findings**: F-deployability-4

**Problema**
> O bloco `## Não lançado` é onde o autor escreve o texto rico da release (tabela antes×depois, motivo do bump). O script atual insere `## vX.Y.Z (data)` acima, com bullets automáticas de commits — deixando dois blocos que precisam de merge manual. Perde-se o texto autoral se o operador só empurrar o PR sem editar.

**Melhoria Proposta**
> No `bump-version` (portado ou não), detectar o bloco `## Não lançado` e **substituir** o cabeçalho por `## vX.Y.Z (data)`, mantendo o conteúdo abaixo. Se o autor não escreveu `## Não lançado`, cair no comportamento atual.

**Resultado Esperado**
> `## Não lançado — o snapshot da eleição para de mentir (ADR-0043)` vira `## v0.35.0 (2026-09-08) — o snapshot da eleição para de mentir (ADR-0043)` num único passo.

**Métricas de sucesso**
- Passos manuais no CHANGELOG por release: 1+ → 0
- Releases com texto autoral perdido: risco atual >0% → 0%

**Risco de não fazer**
> Releases futuros com texto rico repetem a fricção; alguém eventualmente publica notas incompletas.

**Dependências**: `bump-version-node` (aproveitar o mesmo trabalho).

---

### [node-unificar] Unificar versão de Node entre CI (24), crons (22) e Render (unpinned)

**QA**: Deployability
**Tactic alvo**: Reproducible Builds
**Esforço**: S
**Findings**: F-deployability-5

**Problema**
> CI roda Node 24, os 6 crons rodam Node 22, e o Render não pina versão (`runtime: node`). API-diff entre majors (crypto, streams, buffers) pode passar no CI e falhar em cron/prd. A migration 0054 é aplicada por qualquer um dos crons na 1ª execução após deploy — divergência é diretamente relevante ao delta.

**Melhoria Proposta**
> (a) Adicionar `"engines": { "node": ">=22 <23" }` em `src/backend/package.json` + `src/frontend/package.json`. (b) Pinar `node-version` em CI para o mesmo major (22). (c) Documentar no `render.yaml` como comentário qual versão o Render está servindo.

**Resultado Esperado**
> 1 versão de Node em todo o pipeline. Um upgrade futuro é uma mudança única.

**Métricas de sucesso**
- Versões distintas de Node no repo: 3 → 1

**Risco de não fazer**
> Um crypto/streams-diff quebra um cron em PRD; ADR-0042 cobre o alerta, mas o custo é diagnóstico noturno em vez de red no CI.

**Dependências**: nenhuma.

---

### [totals-record] Substituir campos `total_*` por `Record<EstadoElegibilidade, number>` derivado

**QA**: Modifiability
**Tactic alvo**: Increase Semantic Coherence + Refactor
**Esforço**: M
**Findings**: F-modifiability-2 (parcial), F-modifiability-6

**Problema**
> `EleicaoTotals`, `PermutaEleicaoRunInput` e `PermutaRunSummary` declaram 6 propriedades manualmente. `JobRunReadModel.metricas` faz a mesma enumeração em 6 chaves pt-BR. `contarPorEstado` monta o dicionário item a item. 4 lugares mantidos em sincronia por convenção.

**Melhoria Proposta**
> Substituir os campos individuais por `porEstado: Record<EstadoElegibilidade, number>` + `totalCandidatas`. `contarPorEstado` passa a construir o record via `for...of Object.values(ESTADO_ELEGIBILIDADE)`. Manter migração backward-compat na coluna SQL (repository compõe do record no INSERT).

**Resultado Esperado**
> Novo estado adicionado a `ESTADO_ELEGIBILIDADE` propaga automaticamente para `EleicaoTotals` e `contarPorEstado`.

**Métricas de sucesso**
- Declarações estruturais duplicadas de "contagem por estado": 4 → 1
- Nº de spots que ganham a chave nova automaticamente: 0 → 3

**Risco de não fazer**
> A próxima adição de estado deixa contagens incompletas no header/painel `/operacao` sem alerta.

**Dependências**: `taxonomia-fonte-unica`.

---

### [split-eleicao-service] Dividir `EleicaoPermutasService` (1008 LOC) em fan-out + orquestração

**QA**: Modifiability
**Tactic alvo**: Split Module
**Esforço**: L
**Findings**: F-modifiability-4, F-modifiability-5

**Problema**
> `EleicaoPermutasService.ts` atravessou 1000 LOC neste delta (1008, +34). Concentra fan-out Conexos multi-filial concurrent, idempotência com advisory lock, hidratação `derivarPagoDosTitulos`, `contarPorEstado`, `countByMotivo` e orquestração de persistência. 6 responsabilidades por arquivo, cognitive load alto, testes empilhando (+216 linhas neste ciclo).

**Melhoria Proposta**
> Extrair: (a) `ConexosFanOutService` — leitura multi-filial concurrent + `derivarPagoDosTitulos` (~500 LOC); (b) `EleicaoTotalsService` — só `contarPorEstado` + `countByMotivo` (~60 LOC, isolável e altamente testável); (c) `EleicaoPermutasService` mantém orquestração + idempotência (≤ 500 LOC).

**Resultado Esperado**
> 3 arquivos ≤ 500 LOC cada; testes de fan-out separados dos testes de convergência I5.

**Métricas de sucesso**
- LOC max em `permutas/service/`: 1008 → ≤ 500
- Warnings CC em `EleicaoPermutasService`: 2 → 0 (redistribuídos)

**Risco de não fazer**
> Cada mudança em qualquer das 6 responsabilidades força releitura de 1000 LOC.

**Dependências**: `totals-record` idealmente antes.

---

### [retencao-snapshot] Política de retenção/particionamento para `permuta_candidata_snapshot`

**QA**: Performance
**Tactic alvo**: Bound Queue Sizes
**Esforço**: L
**Findings**: F-performance-3, F-performance-4

**Problema**
> A tabela cresce ~1.906 linhas/dia (610 × 3 runs). Em 12 meses são 848k linhas; em 3 anos, 2,2M. Não existe partitioning, sweep, archive nem VACUUM FULL agendado (0 hits em `grep -rn "partition|prune|retention" src/backend/migrations`).

**Melhoria Proposta**
> Transformar `permuta_candidata_snapshot` em tabela particionada por mês (RANGE em `created_at`). Retenção sugerida: 6 meses on-line, o restante para `permuta_candidata_snapshot_archive`. Runs de eleição escrevem só na partição atual — INSERT rate constante. `ALTER TABLE ADD CONSTRAINT` sobre partição de 45k linhas (1 mês) ≈ 0,8 s vs. 45 s sobre 848k acumuladas.

**Resultado Esperado**
> Custo de futuras DDLs sobre snapshot: linear em 12M → constante em 1M. `findLatestSnapshot` p95: constante ao longo do tempo.

**Métricas de sucesso**
- Linhas por partição ativa: máx ~57k (30 dias × 1.906)
- Tempo de `ADD CONSTRAINT CHECK` sobre partição ativa: < 1 s
- Retenção declarada em ADR: ausente → definida (ex.: 6 meses on-line)

**Risco de não fazer**
> Em 12–18 meses, cada nova migração sobre snapshot é uma decisão de janela de deploy. Em 3 anos, refatorar a tabela é uma épica de 2 sprints em vez de uma tarefa.

**Dependências**: acordo produto/Yuri sobre janela de retenção.

---

## P3 — Baixo

### [predeploy-doc] Reconciliar `render.yaml.preDeployCommand` e `DEPLOY.md` com a realidade

**QA**: Deployability
**Tactic alvo**: Script Deployment Commands
**Esforço**: S
**Findings**: F-deployability-7

**Problema**
> `render.yaml:19-20` e `DEPLOY.md:24-26` afirmam que o Pre-Deploy roda `npm run migrate && npm run seed:admin`. A docstring do `BootMigrator.ts:33-38` diz literalmente que "o preDeployCommand nunca rodou". Três fontes desalinhadas para o mesmo comportamento.

**Melhoria Proposta**
> **Desligar** o `preDeployCommand` no `render.yaml` (comentado como "não usado — vide BootMigrator"), remover a linha do `DEPLOY.md`.

**Resultado Esperado**
> Doc e config batem com o comportamento real. Onboarding para de perder tempo procurando por que o pre-deploy não aparece nos logs.

**Métricas de sucesso**
- Declarações discordantes sobre a origem da migração no deploy: 3 → 1

**Risco de não fazer**
> Baixo; débito de documentação.

**Dependências**: idealmente com `rollback-assimetrico`.

---

### [quarentena-snapshot] Contenção linha a linha em `parseStatusSnapshot`

**QA**: Fault Tolerance
**Tactic alvo**: Quarantine
**Esforço**: S
**Findings**: F-fault-tolerance-6

**Problema**
> `parseStatusSnapshot` lança `Error` se uma linha do snapshot vier com `status` fora do enum. Uma única linha corrompida derruba a leitura inteira do painel — trocaria "informação errada" por "sem informação nenhuma".

**Melhoria Proposta**
> `parseStatusSnapshot` retorna sentinel `EstadoElegibilidade | 'quarantine'` e a linha é excluída do resultado com contador `linhasEmQuarentena`, exposto no header da resposta e logado como `BUSINESS_WARN`.

**Resultado Esperado**
> Snapshot com 1+ linhas corrompidas → painel mostra as N-1 válidas + badge de quarentena. 0 requests 500 causados por `snapshot fora da máquina de estados`.

**Métricas de sucesso**
- Contador de linhas em quarentena disponível
- Se ocorresse, MTTR de "painel offline" cai de N minutos para 0

**Risco de não fazer**
> Muito baixo — se a CHECK da 0054 funcionar, o cenário não ocorre.

**Dependências**: nenhuma.

---

### [audit-erro-runeleicao] Robustez do `persistRun` de erro em `runEleicao`

**QA**: Fault Tolerance
**Tactic alvo**: Idempotent Replay (audit trail em cenário degradado)
**Esforço**: S
**Findings**: F-fault-tolerance-7

**Problema**
> Se o fan-out Conexos falhou por DB temporariamente indisponível, o próprio `persistRun` também falha; o `runId` fica indefinido, o log de erro roda mas sem `snapshotId`, e o erro que sobe é o do `persistRun` (não o do fan-out). Retry executor mitiga só transientes.

**Melhoria Proposta**
> Capturar falha do `persistRun` de erro num `try/catch` interno, gravar em fila persistente (DLQ simples numa tabela `job_erro_persistencia_pendente`), e re-lançar o erro **original** do fan-out.

**Resultado Esperado**
> Audit trail preservada mesmo em incidente concorrente de DB.

**Métricas de sucesso**
- Erros originais mascarados por falha de `persistRun`: possível → 0

**Risco de não fazer**
> Baixo em contexto normal; audit gap teórico.

**Dependências**: nenhuma.

---

### [ttl-idempotencia-env] Externalizar TTL de idempotência (24h hardcoded → `EnvironmentProvider`)

**QA**: Modifiability
**Tactic alvo**: Defer Binding (configuration files)
**Esforço**: S
**Findings**: F-modifiability-8 (cross-cut) + tactic Defer Binding

**Problema**
> `PermutaSnapshotRepository.findRunIdByIdempotencyKey` usa `INTERVAL '24 hours'` hardcoded no SQL. É uma decisão de negócio (janela em que a mesma `Idempotency-Key` é reconhecida) embutida no repository.

**Melhoria Proposta**
> Ler o TTL de `EnvironmentProvider` (ex.: `permuta_idempotency_ttl_hours`, default 24), interpolar como parâmetro SQL. Documentar no CLAUDE.md e no bootstrap de container.

**Resultado Esperado**
> TTL da idempotência ajustável por ambiente sem code change.

**Métricas de sucesso**
- Regras de negócio hard-coded no repository: 1 → 0

**Risco de não fazer**
> Baixo, mas o padrão "24h no SQL" pode replicar-se em futuras janelas.

**Dependências**: nenhuma.

---

### [pg-version-registrar] Declarar versão-alvo do Postgres/Supabase no repo

**QA**: Performance
**Tactic alvo**: Increase Resource Efficiency (validação de premissa)
**Esforço**: S
**Findings**: F-performance-5

**Problema**
> O código da 0054 assume que `ADD COLUMN INTEGER NOT NULL DEFAULT 0` é metadata-only — verdade em PG ≥ 11. A premissa não está codificada em lugar nenhum: `DEPLOY.md` só fala "Session pooler do Supabase" e `grep -r "PG_VERSION"` retorna vazio. Medi em PRD: **PG 17.6**.

**Melhoria Proposta**
> Adicionar à `DEPLOY.md` uma seção "Premissas de runtime" com Postgres versão medida (17.6) e mínima suportada (≥ 15). Considerar assertion no boot que faça `SELECT current_setting('server_version_num')` e RECUSE subir se < versão-alvo.

**Resultado Esperado**
> Versão-alvo documentada + assertion no boot.

**Métricas de sucesso**
- Versão-alvo Postgres declarada: ausente → declarada em `DEPLOY.md`
- Assertion de versão no boot: ausente → presente

**Risco de não fazer**
> Baixo. Documental.

**Dependências**: nenhuma.

---

### [casts-endurecer] Endurecer os 4 casts `as` remanescentes com parse-com-throw

**QA**: Security
**Tactic alvo**: Validate Input
**Esforço**: S
**Findings**: F-security-4

**Problema**
> Delta endureceu `parseStatusSnapshot` e `parseEstadoElegibilidadeRow` para lançar em valor fora do enum. Restam 4 casts sem parse: `motivoBloqueio` (aberto por design), `variante` (CHECK no banco), `bloqueadas_by_motivo` (JSON próprio), `RunStatus` (CHECK). Nenhum é vetor de injeção, mas a assimetria (2 endurecidos, 4 não) cria dívida cognitiva.

**Melhoria Proposta**
> (1) Endurecer os fechados por CHECK (`variante`, `RunStatus`): trocar o cast por `parseVariante`/`parseRunStatus` no mesmo padrão de `parseStatusSnapshot`. (2) Manter documentado o cast de `motivoBloqueio` (aberto por decisão) e do JSON `bloqueadas_by_motivo` (superfície confiada), com comentário linkando este card.

**Resultado Esperado**
> Casts de leitura de banco sobre colunas com CHECK são todos guardados por `parseX` que lança em valor fora do enum. Cobertura: 33% → 67%.

**Métricas de sucesso**
- Casts `as` sobre coluna com CHECK, sem parse-com-throw: 2 → 0
- Casts sobre superfície aberta, com comentário linkando este card: 2 → 2

**Risco de não fazer**
> Baixo — não é vetor de injeção. Consequência realista: a próxima vez que a taxonomia mudar (novo estado terminal), inconsistência se manifesta em relatório aparente-correto.

**Dependências**: nenhuma.

---

### [lint-not-tobe] Regra CI proibindo `.not.toBe(<código HTTP>)` em teste de autorização

**QA**: Security + Testability (consolida `security-2`, `testability-5`)
**Tactic alvo**: Authorize Actors (via robustez do teste) + Executable Assertions
**Esforço**: S
**Findings**: F-security-1, F-security-2, F-testability-4, F-testability-5

**Problema**
> O achado F-security-1 mostra que uma sonda de RBAC ficou vazia por meses porque combinava (a) mock com nome de método errado + (b) asserção negativa `.not.toBe(403)` + (c) ausência de `toHaveBeenCalled`. A varredura atual mostra que o anti-padrão está morto no repo (0 hits vivos em 11 arquivos), mas nada impede sua reintrodução.

**Melhoria Proposta**
> (1) Regra custom simples de Biome ou script `scripts/lint-tests-authz.sh` chamado no CI: proíbe `\.not\.toBe\((200|201|401|403)\)` em `**/*.test.ts` dentro de descrição contendo `RBAC|requireRole|role|auth`. Falha o build com mensagem `"asserção negativa em teste de autorização — use expect(status).toBe(200) e expect(mock).toHaveBeenCalled()"`. (2) Convenção documentada em CLAUDE.md.

**Resultado Esperado**
> Anti-padrão `.not.toBe(...)` em teste de autorização é rejeitado no CI ou pelo linter. Contagem futura: 0 sustentada.

**Métricas de sucesso**
- Ocorrências vivas de `\.not\.toBe\((401|403|200)\)` em `**/*.test.ts` de rotas: 0 (mantido)
- Presença de check automatizado no CI ou lint: 0 → 1

**Risco de não fazer**
> Em 12 meses, com 200+ suítes de teste, alguém escreve `.not.toBe(403)` porque não sabe qual código esperar. F-security-1 se repete em outro endpoint.

**Dependências**: nenhuma.

---

### [clock-provider] Extrair `ClockProvider` injetável (8 sítios `new Date()`/`Date.now()`)

**QA**: Testability
**Tactic alvo**: Limit Non-Determinism + Abstract Data Sources
**Esforço**: S
**Findings**: F-testability-7

**Problema**
> `IngestaoPermutasService` (5×) e `EleicaoPermutasService` (3×) leem `new Date()`/`Date.now()` diretamente. Nenhum teste consegue asserir `durationMs`, `finishedAt` calculado ou monotonia de logs sem `jest.useFakeTimers` espalhado. Pré-existente ao delta, persiste como custo escondido.

**Melhoria Proposta**
> Criar `src/backend/domain/libs/clock/ClockProvider.ts` (`@injectable()`) com `now(): Date` e `nowMs(): number`. Injetar via construtor em `IngestaoPermutasService` e `EleicaoPermutasService`. Nos testes, injetar `FrozenClockProvider`.

**Resultado Esperado**
> Sítios `new Date()`/`Date.now()` em service/permutas: 8 → 0. Testes futuros podem asserir `runArg.startedAt.toISOString() === '2026-06-17T10:00:00Z'` sem `jest.useFakeTimers`.

**Métricas de sucesso**
- Sítios de leitura direta de tempo em service/permutas: 8 → 0
- Testes assertando `durationMs`/`finishedAt` sem `jest.useFakeTimers`: 0 → ≥ 1

**Risco de não fazer**
> Custo de manutenção crescente; qualquer teste que queira falar sobre tempo vira boilerplate.

**Dependências**: nenhuma.
