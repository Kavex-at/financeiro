---
qa: Integrability
qa_slug: integrability
run_id: 2026-09-08-2011-permuta-snapshot-estados
agent: qa-integrability
generated_at: 2026-09-08T20:20:31Z
scope: backend
score: 6.5
findings_count: 6
cards_count: 5
---

# Integrability — Regis-Review

## 1. Cenário Geral (Bass General Scenario aplicado ao nf-projects)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Migration 0054 aplicada em PRD (152.516 linhas de snapshot + 250 headers de eleição) e mudança de domínio de `permuta_candidata_snapshot.status` (2 → 5 valores) | Ampliação de taxonomia (`ja-permutado` vira estado; CHECK binária revogada) + remoção de `GET /permutas/painel` + reescrita retroativa de `total_bloqueadas` | `permuta_candidata_snapshot.status`, `permuta_eleicao_run` (colunas novas + reescrita), enum `ESTADO_ELEGIBILIDADE`, union relational `EstadoElegibilidadeRow`, union frontend `StatusElegibilidade`, `GET /permutas/painel` (removido), probes de impacto | PRD Columbia; back-end Express + Postgres (Supabase); read-model consumido por frontend Next.js, jobs de probe e potencialmente BI externo | Backend passa a gravar 5 estados fiéis; header e snapshot convergem por construção (I5); consumidores externos que dependiam da projeção binária ou do endpoint removido descobrem a quebra apenas ao consultar (silêncio no wire) | 0 novos call sites do backend ao Conexos (integração externa **não tocada** — `git diff --stat origin/main src/backend/domain/client` = 0 arquivos); 5 representações paralelas da taxonomia; 152.516 linhas reclassificadas sem rollback script; 1 endpoint removido sem 410 Gone / versionamento |

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Arquivos de `domain/client/*` tocados pelo delta | **0** | 0 (delta não deve alterar integração ERP) | ✅ | `git --no-pager diff --stat origin/main -- src/backend/domain/client` |
| Chamadas novas ao Conexos introduzidas | **0** | 0 | ✅ | `git --no-pager diff origin/main -- src/backend/domain/client src/backend/domain/repository/permutas src/backend/domain/service/permutas \| grep -c 'ConexosClient\.'` = 0 |
| Endpoints HTTP públicos REMOVIDOS neste delta | **1** (`GET /permutas/painel`) | 0 sem versionamento ou 410-Gone temporário | ⚠️ | `src/backend/routes/permutas.ts:772-779` |
| Consumidores do endpoint removido dentro do monorepo | **0** call sites no frontend, **0** em jobs, **0** em scripts | 0 | ✅ | `grep -rn "permutas/painel" src/frontend src/backend/jobs scripts` — sem hits |
| Consumidores fora do monorepo verificáveis | ⚠️ **Não medível localmente** | — | ⚠️ | Não existe `docs/conexos-api/INVENTARIO-INTEGRACAO.md` neste worktree (só o listagem OpenAPI de endpoints do **Conexos**, não da API do financeiro); `docs/impacto/` também não existe. Worktree paralelo `../supabase-auth/src/backend/routes/permutas.test.ts` **ainda** referencia `/permutas/painel` (4 hits), mas é branch legada, não consumidor vivo |
| Colunas de `permuta_eleicao_run` adicionadas | **3** (`total_casamento_manual`, `total_permuta_manual`, `total_ja_permutado`) — `NOT NULL DEFAULT 0` | schema aditivo (não quebra leitores existentes) | ✅ | `src/backend/migrations/0054_estado_ja_permutado.sql:83-90` |
| Coluna com domínio de valores AMPLIADO retroativamente | **1** (`permuta_candidata_snapshot.status`: 2 → 5) | quebra silenciosa para `WHERE status='bloqueada'` externo | ❌ | `src/backend/migrations/0054_estado_ja_permutado.sql:77-81` |
| Linhas de snapshot reclassificadas pelo backfill | **152.516** (`bloqueada` → `permuta-manual`/`casamento-manual`/`ja-permutado`/`bloqueada`) | 0 alteração retroativa sem view de compat OU reclassificação com view | ❌ | `migrations/0054_estado_ja_permutado.sql:169-177` + comentário `:11` |
| Linhas de header com `total_bloqueadas` reescrito | **250 runs** (64.893 → 51.459 no agregado; -13.434) | preservar série ou versionar | ❌ | `migrations/0054_estado_ja_permutado.sql:182-198` + comentário `:181-183` |
| Representações paralelas da taxonomia `EstadoElegibilidade` (uma fonte da verdade?) | **5** (TS enum `ESTADO_ELEGIBILIDADE`, TS union `EstadoElegibilidadeRow`, TS union `StatusElegibilidade`, SQL CHECK `permuta_adiantamento`, SQL CHECK `permuta_candidata_snapshot`) | 1 (geração automática) ou ≤ 2 (uma fonte + geração para a outra) | ❌ | `src/backend/domain/interface/permutas/EstadoElegibilidade.ts:9-49`, `src/backend/domain/repository/permutas/PermutaRelationalRepository.ts:19-33`, `src/frontend/lib/types.ts:25-30`, `migrations/0054_estado_ja_permutado.sql:73-81` |
| Arquivos tocados por AMPLIAR a taxonomia neste ciclo (proxy do custo marginal) | **~10** arquivos de produção (enum, 2 unions, 2 CHECKs, `ElegibilidadeService`, `IngestaoPermutasService.toEstadoRow`, `EleicaoPermutasService.contarPorEstado`, `PermutaSnapshotRepository`, `JobRunReadModel`) | ≤ 3 (fonte única + rebuild) | ❌ | Ver seção "Files to change" das tasks 2, 3, 5, 6, 7 em `ontology/_inbox/permuta-snapshot-estados-tasks.md` |
| Contrato HTTP versionado (`/v1/`, `Api-Version`, `Accept`-versionado) | **ausente** — nenhuma rota do backend financeiro usa versionamento | não bloqueante enquanto o consumidor é único e in-repo; **bloqueante** ao contemplar consumo externo (BI/terceiro) | ⚠️ | `grep -rn "'/v[0-9]'\|api-version" src/backend/routes` = 0 hits |
| Mecanismo de aviso de quebra a leitores externos da tabela (view de compat, `CHANGELOG` público, migration comment visível ao DBA externo) | header no arquivo `.sql` + `ontology/decisions/0043-*.md` — **nada exposto no wire** (nenhuma `deprecated_status_view`, nenhum comentário em `COMMENT ON COLUMN`) | comentário SQL + view de compat ou versão de schema | ❌ | `grep -n "COMMENT ON\|CREATE VIEW" src/backend/migrations/0054_estado_ja_permutado.sql` = 0 hits |
| Chaves de agregado da resposta HTTP (contrato interno FE↔BE) em identificador de código-válido | **3 novas** (`'casamento manual'`, `'permuta manual'`, `'já permutado'` com **espaço** e **acento**) | camelCase / snake_case ASCII | ⚠️ | `src/backend/domain/service/operacao/JobRunReadModel.ts:196-198` |
| Rollback script para a migration 0054 | **ausente** — só `RAISE EXCEPTION` de precondição; nenhum `.down.sql` nem `revert-0054.sql` | 1 script `revert-0054.sql` que recomponha `elegivel|bloqueada` a partir do motivo | ⚠️ | `ls src/backend/migrations/*revert*` = 0 hits; `MigrationRunner.run` só aplica UP |
| Testes de contrato/round-trip para o novo domínio de `status` | **presente** (round-trip dos 5 estados no `PermutaSnapshotRepository.test.ts`; convergência I5 no `EleicaoPermutasService.test.ts`) | ≥ 1 teste por status × leitura × escrita | ✅ | `src/backend/domain/repository/permutas/PermutaSnapshotRepository.test.ts` (+224 linhas); `src/backend/domain/service/permutas/EleicaoPermutasService.test.ts` describe "fidelidade e convergência do snapshot (I5)" |

> ⚠️ **Não medível localmente**: consumidores fora do monorepo (dashboards BI, planilhas Metabase/Retool do cliente, jobs Airflow externos). Requer inventário formal de integrações do financeiro (o `docs/conexos-api/` só cobre o ERP como emissor de dados, não a API do financeiro como emissora). Recomendação: instrumentar `Middleware de request-log com contagem por rota` e/ou publicar `docs/api/CONTRACTS.md` com semver do backend.

## 3. Tactics — Cobertura no nf-projects

### Limit Dependencies

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Encapsulate | `PermutaSnapshotRepository` encapsula acesso à tabela `permuta_candidata_snapshot`; escrita/leitura convergem no repositório com `parseStatusSnapshot` que falha alto | ✅ presente | `src/backend/domain/repository/permutas/PermutaSnapshotRepository.ts:96-106` |
| Encapsulate (lado dos leitores externos) | Probes leem `s.status` **direto** por SQL (bypass do repositório), o que faz a mudança de domínio pegar leitores externos por surpresa | ⚠️ parcial | `src/backend/jobs/probe-impacto-verificacao.ts:44-51` |
| Use an Intermediary | Não há intermediário entre a tabela `permuta_candidata_snapshot` e leitores diretos (probes, futuros BI). A projeção binária que antes servia de intermediário foi removida sem substituto | ❌ ausente | Antes: leitura catch-all (perdia informação). Agora: leitura direta, quem consultar via SQL vê o novo domínio. |
| Restrict Communication Paths | HTTP público do backend restringe pouco: nenhum RBAC no read, o endpoint removido tinha 0 call sites mas era **público**; consumidores externos não são inventariados | ⚠️ parcial | `src/backend/routes/permutas.ts` — sem `requireRole` no `/gestao` (herança de dívida documentada em ciclos anteriores) |
| Adhere to Standards | SQL CHECK segue idioma padrão (`CHECK (status IN (...))`); nenhum uso de `CREATE VIEW` de compat ou `COMMENT ON COLUMN` para sinalizar a mudança | ⚠️ parcial | `migrations/0054_estado_ja_permutado.sql:77-81` |
| Abstract Common Services | **Cinco** representações paralelas da mesma taxonomia (enum TS, 2 unions TS, 2 CHECKs SQL) — sem geração automática de nenhuma a partir de nenhuma. Cada estado novo exige tocar as 5 | ❌ ausente | ver métrica "Representações paralelas da taxonomia" |

### Adapt

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Discover Service | N/A — integração externa deste delta (nenhuma) | N/A | `git diff --stat origin/main -- src/backend/domain/client` = 0 |
| Tailor Interface | `JobRunReadModel` "tailoreia" as chaves para o formato que a tela renderiza cru (`Object.entries`), MAS usa **chaves em pt-BR com espaço e acento** (`'casamento manual'`, `'já permutado'`) que quebram identificador JS/TS e criam um contrato friccional | ⚠️ parcial | `src/backend/domain/service/operacao/JobRunReadModel.ts:196-198` |
| Configure Behavior | N/A neste delta (nenhum flag de config novo) | N/A | — |
| Manage Resources | Migration executa DDL + `UPDATE` em 152.516 linhas na **mesma transação implícita** — janela de lock estende pela duração inteira do `UPDATE`. Não é "gerenciar", é "torcer para não ter concorrência". Não há `LOCK TABLE` explícito nem cap de duração | ⚠️ parcial | `migrations/0054_estado_ja_permutado.sql:63-71` + `migrate.ts` (arquivo inteiro como um comando simples) |

### Coordinate

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Orchestrate | O pipeline `EleicaoPermutasService.executar → snapshotRepository.persistRun` coordena header + snapshot **na mesma transação com uma agregação só** (`contarPorEstado`), fechando a divergência de duas fontes | ✅ presente | `src/backend/domain/service/permutas/EleicaoPermutasService.ts:990-1010` (método `contarPorEstado`) |
| Manage Resource Coupling | Header e snapshot passam a compartilhar **a mesma coleção `candidatas`** como fonte de contagem (invariante I5, cláusula 2) — desacopla a corretude estrutural do "lembrar de fazer a mesma agregação em dois lugares" | ✅ presente | `EleicaoPermutasService.ts:380-395` (`...totals` em vez de campo a campo) |

### Facetas modernas

| Faceta | Implementação atual | Status | Evidência |
|---|---|---|---|
| Contract testing (round-trip, schema-pinned) | Round-trip dos 5 estados no repositório; falha-alto na leitura para valor fora do enum; convergência I5 asserida com repo REAL contra pool mock | ✅ presente | `PermutaSnapshotRepository.test.ts` (+224 linhas); `EleicaoPermutasService.test.ts` describe I5 |
| Versioning strategy para o contrato HTTP externo | **ausente** — nenhuma rota versionada; remoção pura sem 410 Gone, sem `Sunset` header, sem `deprecations.json` | ❌ ausente | `grep -n "Sunset\|Deprecation" src/backend/routes/permutas.ts` = 0 |
| Versioning strategy para o contrato DE DADOS (schema Postgres exposto) | **ausente** — mudança de domínio de coluna feita in-place; `total_bloqueadas` histórico reescrito; sem view `permuta_candidata_snapshot_v1` de compat | ❌ ausente | `migrations/0054_estado_ja_permutado.sql:169-198` |
| Backward-compatibility shims | Explicitamente **rejeitadas** pela ADR-0043 §Alternativas (a): "mantém a mentira disponível". Decisão consciente, mas trava para consumidores externos futuros que não estejam mapeados | ⚠️ decisão consciente | ADR-0043 §Alternativas |
| Observability of integration failures | Nenhum log/métrica por-consumidor de leitura da tabela — não há como medir se algo externo estava dependendo do domínio binário | ❌ ausente | `grep -n "COMMENT ON COLUMN\|CREATE VIEW.*legado" migrations/*.sql` = 0 hits |

## 4. Findings (achados)

### F-integrability-1: Domínio de `permuta_candidata_snapshot.status` ampliado retroativamente sem view de compat nem versionamento

- **Severidade**: P1
- **Tactic violada**: **Adhere to Standards** + **Encapsulate** (o "leitor externo" não conta como interno, portanto o encapsulamento pela API do repositório não o protege)
- **Localização**:
  - `src/backend/migrations/0054_estado_ja_permutado.sql:77-81` (CHECK ampliada)
  - `src/backend/migrations/0054_estado_ja_permutado.sql:169-177` (UPDATE de 152.516 linhas)
  - `src/backend/migrations/0054_estado_ja_permutado.sql:182-198` (reescrita de `total_bloqueadas` histórico)
- **Evidência (objetiva)**:
  ```sql
  -- 152.516 linhas mudam de significado; qualquer SQL externo
  --   SELECT COUNT(*) FROM permuta_candidata_snapshot WHERE status='bloqueada'
  -- passa a devolver ~1/1.26 do valor anterior (51.459 vs. 64.893 no agregado)
  -- sem erro, sem log, sem código de status.
  UPDATE permuta_candidata_snapshot
     SET status = CASE
                      WHEN motivo_bloqueio = 'cliente-filtro'                       THEN 'permuta-manual'
                      WHEN motivo_bloqueio IN ('composto-nm', 'multiplas-invoices') THEN 'casamento-manual'
                      WHEN motivo_bloqueio = 'ja-permutado'                         THEN 'ja-permutado'
                      ELSE 'bloqueada'
                  END
   WHERE status = 'bloqueada';
  ```
- **Impacto técnico**: leitor externo (dashboard BI, planilha ad-hoc do cliente, job Airflow, ferramenta interna que consulta a Supabase direto) que filtre `WHERE status='bloqueada'` continua funcionando sintaticamente, mas passa a devolver **20,7% menos linhas** no agregado histórico (64.893 → 51.459) e **63% menos** na run viva de 2026-09-08 (677 → 249). É a mesma classe de defeito que o delta corrige internamente — informação mudando sem sinal.
- **Impacto de negócio**: repetir, com o sinal invertido, o erro do relatório de impacto v1 (documentado no ADR-0043 §Consequências). Um relatório externo diz "as bloqueadas caíram 20%" — sem menção à reclassificação, é lido como melhora operacional. A ADR reconhece isso; o delta não instrumenta nada para prevenir.
- **Métrica de baseline**: 152.516 linhas reclassificadas · 250 runs com `total_bloqueadas` reescrito · 13.434 linhas mudam de balde (`bloqueada` → `ja-permutado`) · 63% de queda no valor da run viva.

### F-integrability-2: Taxonomia de `EstadoElegibilidade` vive em 5 representações paralelas sem geração automática

- **Severidade**: P2
- **Tactic violada**: **Abstract Common Services**
- **Localização**:
  - `src/backend/domain/interface/permutas/EstadoElegibilidade.ts:9-49` (enum TS canônico, 5 valores)
  - `src/backend/domain/repository/permutas/PermutaRelationalRepository.ts:19-33` (union TS relational, **6** valores — inclui `descoberta`)
  - `src/frontend/lib/types.ts:25-30` (union TS frontend, 5 valores)
  - `src/backend/migrations/0054_estado_ja_permutado.sql:73-81` (2 CHECKs SQL — 6 e 5 valores, respectivamente)
- **Evidência (objetiva)**:
  ```
  # 3 arquivos TS listam literais dos 5 estados; 2 CHECKs SQL repetem
  $ grep -rn "'casamento-manual'\|'permuta-manual'\|'ja-permutado'" src/ --include='*.ts' --include='*.tsx' -l | sort -u | wc -l
  23
  ```
  ```typescript
  // Comentário existente já denuncia o problema (repository):
  // "este union aparecia DUPLICADO — na row e no filtro de listAdiantamentosAtivos —
  //  e cada estado novo (`casamento-manual` em ADR-0005, `permuta-manual` em ADR-0007,
  //  `ja-permutado` em ADR-0043) obrigava a editar os dois lugares"
  // (PermutaRelationalRepository.ts:12-16)
  ```
- **Impacto técnico**: custo marginal de **adicionar 1 estado novo** = tocar 5 representações (enum, 2 unions, 2 CHECKs) + serviços que fazem `switch` exaustivo. Este próprio delta pagou o preço: ~10 arquivos de produção mexidos só para introduzir `JA_PERMUTADO`. A defesa contra achatamento é hoje `default: never` em `IngestaoPermutasService.toEstadoRow` (`:284-290`) — funciona **porque um humano lembrou de trocar** o `default: 'descoberta'` original.
- **Impacto de negócio**: cada novo estado tem probabilidade não-desprezível de ser esquecido em 1 dos 5 lugares. O caso `IngestaoPermutasService.toEstadoRow` com `default: 'descoberta'` era exatamente isso — o estado novo teria sido persistido silenciosamente como `descoberta` sem erro de compilação (tasks doc `permuta-snapshot-estados-tasks.md` Task 3 registra a descoberta).
- **Métrica de baseline**: 5 representações · 23 arquivos com literais de estado · 10+ arquivos tocados neste ciclo só para 1 estado novo.

### F-integrability-3: Chaves de contrato HTTP em pt-BR com espaço e acento em `JobRunReadModel`

- **Severidade**: P2
- **Tactic violada**: **Tailor Interface** (usada de forma que quebra a convenção de identificador)
- **Localização**: `src/backend/domain/service/operacao/JobRunReadModel.ts:196-198`
- **Evidência (objetiva)**:
  ```typescript
  metricas: {
      candidatas: r.totalCandidatas,
      elegiveis: r.totalElegiveis,
      bloqueadas: r.totalBloqueadas,
      'casamento manual': r.totalCasamentoManual,
      'permuta manual': r.totalPermutaManual,
      'já permutado': r.totalJaPermutado,
  }
  ```
- **Impacto técnico**: (i) frontend precisa fazer `obj['já permutado']` (perde `obj.jaPermutado`); (ii) qualquer consumidor Python/Java/BI que gere `dataclasses`/records a partir do JSON precisa fazer `Field(alias=...)`; (iii) `JSON.stringify` funciona, mas ferramentas de codegen/gRPC/OpenAPI que exijam identificador válido quebram; (iv) o comentário `:180-189` argumenta "renomear as chaves de recebimentos, sispag ou ingest mudaria a tela deles sem necessidade" — decisão pragmática, mas cria assimetria dentro do próprio contrato de `metricas` (3 camelCase / 3 espaço-acento).
- **Impacto de negócio**: consumidor externo (dashboard) que integrar via a rota `/operacao/*` gasta esforço adicional para lidar com as 3 chaves; o custo é pequeno mas será pago N vezes.
- **Métrica de baseline**: 3 chaves de contrato em pt-BR com espaço/acento (`'casamento manual'`, `'permuta manual'`, `'já permutado'`) misturadas com 3 em camelCase ASCII no mesmo objeto.

### F-integrability-4: `GET /permutas/painel` removido sem versionamento nem 410-Gone temporário

- **Severidade**: P2
- **Tactic violada**: **Versioning strategy** (faceta moderna)
- **Localização**: `src/backend/routes/permutas.ts:772-779` (rota deletada; comentário no lugar)
- **Evidência (objetiva)**:
  ```typescript
  // `GET /permutas/painel` e o `PainelService` foram REMOVIDOS em ADR-0043 §5:
  // zero call sites no frontend, e era o segundo implementador da ação
  // `exporNoPainel` — justamente o que achatava os 5 estados em `elegivel|bloqueada`.
  ```
  ```
  # Verificação independente da premissa "zero call sites":
  $ grep -rn "permutas/painel" src/frontend src/backend/jobs scripts docs/conexos-api
  (sem resultados)
  # Mas: nenhum registro público de API financeiro-lado; INVENTARIO-INTEGRACAO.md
  # citado no briefing NÃO existe neste worktree.
  ```
- **Impacto técnico**: "zero call sites no repo" ≠ "zero consumidores". Não há `docs/api/` publicado; o `docs/conexos-api/` cataloga a API do **Conexos**, não a do backend financeiro. Um consumidor externo (planilha do analista, dashboard Retool) descobre a remoção como **404**, não como `Sunset`/`Deprecation` header ou 410 Gone com corpo explicativo.
- **Impacto de negócio**: se existir um consumidor externo (não localizável a partir deste repo), ele quebra na hora do deploy. O `PainelService` teve o teste de RBAC substituído por `/permutas/gestao` (`routes/permutas.test.ts:626-651` no diff), mas o contrato externo em si é apagado.
- **Métrica de baseline**: 1 endpoint público removido; 0 mecanismo de deprecação/versionamento em uso no repo (`grep "Sunset\|Deprecation\|/v[0-9]/" src/backend/routes` = 0).

### F-integrability-5: Migration 0054 não tem script de rollback e faz DDL + UPDATE de 152.516 linhas em transação implícita

- **Severidade**: P2
- **Tactic violada**: **Manage Resources** (janela de lock) + rollback (faceta operacional)
- **Localização**:
  - `src/backend/migrations/0054_estado_ja_permutado.sql` (arquivo inteiro; sem contraparte `revert-0054.sql`)
  - `src/backend/migrations/migrate.ts` (runner só aplica UP)
- **Evidência (objetiva)**:
  ```
  $ ls src/backend/migrations/*revert* src/backend/migrations/*.down.sql 2>&1
  (nenhum resultado)
  ```
  A migration comenta: *"MigrationRunner.run envia o arquivo inteiro como UM comando simples ao Postgres, que o executa numa transação implícita — uma falha no meio (inclusive o RAISE abaixo) reverte tudo"* (`:66-71`). A afirmação é verdadeira para **abort durante a apply**; para **desfazer depois** de commitada, não há caminho.
- **Impacto técnico**: (i) uma vez commitada, o único caminho de volta é restore de backup (a reclassificação e a reescrita de `total_bloqueadas` são destrutivas — o motivo original permanece, mas o estado antigo `'bloqueada'` foi sobrescrito onde valia `permuta-manual`/`casamento-manual`/`ja-permutado`); (ii) o UPDATE toca 152.516 linhas com um único CASE — sem `LIMIT`, sem batching, janela de lock ≈ duração completa do UPDATE. Em PRD Supabase pequeno isto tende a ser rápido, mas o custo não é medido antes.
- **Impacto de negócio**: incidente que exija rollback (ex: descobrir que um consumidor externo dependia da projeção binária) exige DBA + restore parcial. A ADR-0043 rejeita view de compat (`§Alternativas (a)`), o que fecha essa saída.
- **Métrica de baseline**: 152.516 linhas UPDATE + 250 linhas UPDATE + 3 DDL numa transação · 0 scripts de rollback · 0 medição de janela de lock antes do deploy.

### F-integrability-6: Integração com Conexos ERP não é tocada — confirmado (observação positiva)

- **Severidade**: P3 (informativa; nenhum card)
- **Tactic**: **Encapsulate** — confirmação de que o `ConexosClient` **não** é o ponto de mudança
- **Localização**: `src/backend/domain/client/**` (13 arquivos ConexosXxx*.ts)
- **Evidência (objetiva)**:
  ```
  $ git --no-pager diff --stat origin/main -- src/backend/domain/client
  (0 arquivos)
  ```
  O delta é uma projeção interna sobre dados já lidos (`mnyTitPermuta`/`mnyTitPermutar`, consumidos em `EleicaoPermutasService.ts:701, 744`). Nenhuma chamada nova ao ERP; nenhuma mudança de contrato externo com o Conexos.
- **Impacto**: positivo — a mudança de estado ficou **contida** no boundary interno (repositório + serviço + rota), não vazou para a integração externa que é a mais frágil do stack. Este é o comportamento certo e merece registro.

## 5. Cards Kanban

### [integrability-1] Publicar view de compat `permuta_candidata_snapshot_v1` (ou aviso in-band) para leitores externos da tabela

- **Problema**
  > A migration 0054 amplia o domínio de `permuta_candidata_snapshot.status` de 2 para 5 valores e reescreve `total_bloqueadas` de 250 headers históricos (64.893 → 51.459). Qualquer leitor externo à aplicação — dashboard BI, planilha do analista, ferramenta interna consultando a Supabase direto — que filtre `WHERE status='bloqueada'` passa a devolver 20,7% a 63% menos linhas sem sinal, sem erro, sem log. É a mesma classe de defeito que este delta corrige internamente.

- **Melhoria Proposta**
  > Publicar `CREATE VIEW permuta_candidata_snapshot_legado AS SELECT run_id, doc_cod, pri_cod, CASE WHEN status = 'elegivel' THEN 'elegivel' ELSE 'bloqueada' END AS status, motivo_bloqueio, ... FROM permuta_candidata_snapshot;` numa migration 0055, com `COMMENT ON VIEW` marcando "DEPRECATED — use a tabela base com o novo domínio de status; será removida em YYYY-MM-DD". Alternativa mais leve: `COMMENT ON COLUMN permuta_candidata_snapshot.status IS 'ADR-0043 (2026-09-08): dominio ampliado de 2 para 5 valores. Filtros externos `WHERE status="bloqueada"` mudaram de significado — ver docs/adr/0043.md'`. Tactic Bass: **Encapsulate** + **Adhere to Standards**.

- **Resultado Esperado**
  > Leitor externo que consulte a view continua vendo o domínio binário; leitor que consulte a tabela base vê o novo domínio; consulta acidental encontra o `COMMENT ON` (visível em `\d+` do psql e em ferramentas como DBeaver/Metabase). Métrica observável: `SELECT relname FROM pg_class WHERE relname='permuta_candidata_snapshot_legado'` retorna 1 linha; ou `SELECT description FROM pg_description WHERE objsubid > 0 AND (SELECT relname FROM pg_class WHERE oid=objoid) = 'permuta_candidata_snapshot'` retorna a nota de deprecação.

- **Tactic alvo**: Encapsulate (Bass, Limit Dependencies)
- **Severidade**: P1
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-integrability-1
- **Métricas de sucesso**:
  - Consumidores externos detectáveis com `WHERE status='bloqueada'` que quebram silenciosamente: hoje ilimitado (unknown-unknown) → 0 (view preserva semântica)
  - `COMMENT ON COLUMN`/`COMMENT ON VIEW` presente: 0 → 1
- **Risco de não fazer**: uma sala de reunião com o cliente em que um dashboard mostra "queda de 20% nas bloqueadas" e alguém celebra, sem saber que é reclassificação. O ADR-0043 §Consequências antecipa exatamente esse cenário e este card é a defesa técnica que falta.
- **Dependências**: nenhuma; pode ir sozinho como migration 0055.

### [integrability-2] Extrair a taxonomia `EstadoElegibilidade` para uma fonte única com geração/checagem das outras

- **Problema**
  > Os 5 estados (`elegivel`, `bloqueada`, `casamento-manual`, `permuta-manual`, `ja-permutado`) vivem em 5 representações paralelas: enum TS canônico, union TS do repository (com o 6º estado `descoberta`), union TS do frontend, e 2 CHECKs SQL. Adicionar `ja-permutado` neste ciclo custou tocar ~10 arquivos e a defesa contra "cair no `default` errado" é hoje um `switch exaustivo (never)` que só funciona **porque um humano trocou** o `default: 'descoberta'` original (registrado em `permuta-snapshot-estados-tasks.md` Task 3).

- **Melhoria Proposta**
  > (a) Tornar `ESTADO_ELEGIBILIDADE` (`interface/permutas/EstadoElegibilidade.ts`) a única fonte da verdade em código; (b) derivar `EstadoElegibilidadeRow` do enum + `'descoberta'` via `type EstadoElegibilidadeRow = EstadoElegibilidade | 'descoberta'` em vez de reescrever a lista; (c) frontend importa o mesmo tipo via um `packages/shared-types` ou codegen simples (`scripts/gen-frontend-types.ts` que emite `src/frontend/lib/generated/estados.ts`); (d) test de contrato SQL↔TS: script em `src/backend/migrations/checks/` que faz `SELECT unnest(...) INTERSECT SELECT unnest(...)` contra a CHECK viva e falha o CI se divergir. Tactic Bass: **Abstract Common Services**.

- **Resultado Esperado**
  > Adicionar 1 estado novo passa a exigir tocar `EstadoElegibilidade.ts` + 2 CHECKs SQL (na próxima migration), com typecheck cascateando o resto. Métrica: representações paralelas 5 → 2 (TS canônico + SQL, com CI validando congruência); arquivos tocados por novo estado 10+ → ≤ 4.

- **Tactic alvo**: Abstract Common Services (Bass, Limit Dependencies)
- **Severidade**: P2
- **Esforço estimado**: M (2–5d)
- **Findings relacionados**: F-integrability-2
- **Métricas de sucesso**:
  - Representações paralelas da taxonomia: 5 → 2
  - Arquivos tocados em `/feature-new` que adiciona 1 estado: 10+ → ≤ 4
  - Teste de contrato SQL↔TS no CI: ausente → presente
- **Risco de não fazer**: cada novo estado tem chance 1/5 de ser esquecido num dos 5 lugares. `IngestaoPermutasService.toEstadoRow` já quase virou incidente (o `default: 'descoberta'` teria persistido `ja-permutado` como `descoberta` sem erro de compilação). É um bug esperando o próximo estado.
- **Dependências**: nenhuma; pode ir antes ou depois de [integrability-1].

### [integrability-3] Trocar as 3 chaves de `metricas` em pt-BR com espaço/acento por camelCase ASCII

- **Problema**
  > `JobRunReadModel.ts:196-198` grava chaves de contrato HTTP como `'casamento manual'`, `'permuta manual'`, `'já permutado'` (com espaço e acento). Consumidor precisa fazer `obj['já permutado']` em vez de `obj.jaPermutado`; codegen que exija identificador válido quebra; o mesmo objeto mistura 3 chaves camelCase ASCII com 3 chaves pt-BR-com-espaço, criando assimetria dentro do próprio contrato.

- **Melhoria Proposta**
  > Renomear as 3 chaves para `casamentoManual`, `permutaManual`, `jaPermutado`. Se o argumento "a tela renderiza `Object.entries(metricas)` sem mapa de rótulos" (comentário `:180-189`) for real, introduzir o mapa de rótulos no frontend (`src/frontend/lib/labels/metricas.ts`) — é uma linha por métrica, muito menor que o custo de manter chaves inválidas como identificador. O DesignSystemReviewer é acionado sim, mas para um patch de 1 arquivo, não uma redesign. Tactic Bass: **Tailor Interface** (feita de forma consistente).

- **Resultado Esperado**
  > 6/6 chaves de `metricas` seguem camelCase ASCII. Frontend consome `data.metricas.jaPermutado` diretamente. Consumidor Python/BI faz `dataclass(ja_permutado: int)` sem `Field(alias=...)`.

- **Tactic alvo**: Tailor Interface (Bass, Adapt)
- **Severidade**: P2
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-integrability-3
- **Métricas de sucesso**:
  - Chaves de `metricas` em `JobRunReadModel` com identificador JS/TS válido: 3/6 → 6/6
  - Arquivos de frontend tocados: 1 (mapa de rótulos)
- **Risco de não fazer**: cada consumidor futuro paga o pedágio do `obj['já permutado']`. O ADR-0042 e a decisão de linguagem em CLAUDE.md dizem "mensagens em pt-BR"; **chaves** de payload não são mensagem — são identificadores.
- **Dependências**: coordenar com Modifiability (mesmo arquivo).

### [integrability-4] Introduzir política de deprecação de rotas HTTP (`Sunset`/`Deprecation` + 410-Gone temporário)

- **Problema**
  > `GET /permutas/painel` foi removido por deleção pura. A premissa "zero call sites" foi verificada só dentro do monorepo — não há inventário de API financeira publicado (`docs/conexos-api/` cataloga o **Conexos**, não este backend), e o INVENTARIO-INTEGRACAO.md citado no briefing não existe neste worktree. Consumidores externos (BI, planilhas, jobs Airflow) descobrem a remoção como 404 sem contexto.

- **Melhoria Proposta**
  > (a) Publicar `docs/api/CONTRACTS.md` listando os endpoints públicos do backend financeiro e sua estabilidade; (b) padrão de deprecação: 1 sprint antes da remoção, a rota devolve 200 + headers `Deprecation: true` e `Sunset: <RFC 7231 date>`, e log `BUSINESS_WARN` em cada chamada; (c) na remoção, a rota devolve **410 Gone** com body `{ removed: true, since: <ISO date>, adr: 'ADR-0043', substituto: 'GET /permutas/gestao' }` por 1 sprint antes de virar 404. Tactic Bass: **Versioning strategy** (faceta moderna).

- **Resultado Esperado**
  > Consumidor externo que ainda dependa de um endpoint em deprecação recebe sinal in-band (header + log) e o operador tem visibilidade via `BUSINESS_WARN`. Após remoção, 410 dá pista técnica em vez de 404 mudo. Métrica: 1 rota removida por deleção pura → 0 rotas removidas sem passagem por 410-Gone.

- **Tactic alvo**: Versioning strategy / Encapsulate (Bass modern)
- **Severidade**: P2
- **Esforço estimado**: M (2–5d)
- **Findings relacionados**: F-integrability-4
- **Métricas de sucesso**:
  - Rotas removidas com `Deprecation`/`Sunset` header prévio: 0/1 → 1/1
  - `docs/api/CONTRACTS.md` publicado com endpoints e SLAs de estabilidade: ausente → presente
- **Risco de não fazer**: em ~6 meses, outra rota vai ser removida com o mesmo raciocínio "zero call sites no repo" e algum consumidor externo — potencialmente uma planilha do próprio cliente — quebra na hora do deploy sem chance de reação.
- **Dependências**: coordena com Deployability (release notes) e Security (a rota que substituir precisa de RBAC).

### [integrability-5] Escrever `revert-0054.sql` e medir janela de lock antes do deploy de migrations DML-pesadas

- **Problema**
  > A migration 0054 faz DDL + UPDATE em 152.516 linhas + UPDATE em 250 headers numa única transação implícita, sem script de rollback. O comentário no arquivo (`:66-71`) afirma corretamente que a transação implícita reverte se abortar durante a apply — mas isso não é rollback pós-commit. Uma vez aplicada, desfazer a reclassificação exige restore de backup (a reescrita de `total_bloqueadas` é destrutiva; e o motivo original é preservado, mas o `status='bloqueada'` original foi sobrescrito onde valia `permuta-manual`/`casamento-manual`/`ja-permutado`).

- **Melhoria Proposta**
  > (a) `src/backend/migrations/revert/0054_revert.sql`: reconstrói `status='elegivel'|'bloqueada'` a partir do motivo (a reclassificação é determinística nos dois sentidos, garantido pela mesma condição de determinismo — 0 linhas `status='bloqueada' AND motivo_bloqueio IS NULL`) e recalcula `total_bloqueadas` histórico como `total_bloqueadas + total_casamento_manual + total_permuta_manual + total_ja_permutado`; (b) probe `preflight-migration-0054.ts` que mede tempo de UPDATE contra a Supabase HML antes de deploy PRD, para calibrar janela de lock; (c) política escrita: toda migration que toque > 10k linhas exige revert script na review. Tactic Bass: **Manage Resources**.

- **Resultado Esperado**
  > Se o card [integrability-1] descobrir um consumidor externo pós-deploy, o revert existe. Se PRD tem load contended, o preflight avisa. Métrica: 0 scripts de rollback → 1 (para 0054); política em CLAUDE.md → presente.

- **Tactic alvo**: Manage Resources (Bass, Adapt) + rollback discipline
- **Severidade**: P2
- **Esforço estimado**: S (≤1d) para o revert + M para a política + preflight
- **Findings relacionados**: F-integrability-5
- **Métricas de sucesso**:
  - Script de rollback para 0054: ausente → presente
  - Janela de lock medida em HML antes do deploy: não-medida → medida (≤ X ms documentado)
  - Política "migration > 10k linhas exige revert" em `CLAUDE.md`: ausente → presente
- **Risco de não fazer**: um incidente que exija rollback (ex: descobrir dependência externa) exige DBA e restore parcial; o custo operacional é alto e a janela de reação, curta.
- **Dependências**: nenhuma; pode ir em paralelo com [integrability-1].

## 6. Notas do agente

- **Escopo real:** este delta é uma correção de projeção interna que **não toca a integração externa mais frágil** (Conexos) — confirmado com `git diff --stat origin/main -- src/backend/domain/client` = 0. Isso puxa a nota para cima: o custo marginal de integrar com o ERP não se moveu. O que se moveu foi o custo de leitores externos da nossa **própria** tabela — categoria menos crítica, mas menos monitorada.
- **Score 6.5:** boa disciplina interna (round-trip tests, falha-alto em vez de fallback silencioso, agregação única `contarPorEstado`, `switch never`, invariante I5 com teste canônico), mas 3 débitos concretos ficam: taxonomia em 5 lugares (F2), quebra silenciosa para leitor externo da tabela (F1), remoção pura de rota pública (F4). Nenhum é P0 porque a ADR-0043 os reconhece e o consumidor externo direto **não é observável** deste worktree.
- **Cross-QA para o consolidator:**
  - F-integrability-2 (5 representações paralelas) é o mesmo código que **Modifiability** deve flagar como duplicação — reforçar mutuamente.
  - F-integrability-1 (mudança silenciosa de domínio) tem overlap com **Availability**/**Fault Tolerance**: um relatório externo quebrado é falha observacional, não de sistema; **Testability** também é afetado (fixtures externas de BI podem estar stale).
  - F-integrability-3 (chaves com espaço/acento) toca **Modifiability** e **Usability** (frontend consumindo `obj['já permutado']`).
- **Não medível localmente:** consumidores fora do monorepo (BI, planilhas Retool/Metabase, jobs Airflow do cliente). Único proxy disponível é a ausência de INVENTARIO-INTEGRACAO.md — que já é sinal.
