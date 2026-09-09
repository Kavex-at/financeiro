---
qa: Modifiability
qa_slug: modifiability
run_id: 2026-09-08-2011
agent: qa-modifiability
generated_at: 2026-09-08T20:35:00Z
scope: backend
score: 6.5
findings_count: 8
cards_count: 6
---

# Modifiability — Regis-Review

## 1. Cenário Geral (Bass General Scenario aplicado ao delta `fix/permuta-snapshot-estados`)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Yuri (domínio) / analista Columbia | Regra nova de elegibilidade força a criação de um **SEXTO estado** de `PermutaCandidata` (ex.: `EM_APROVACAO`, `EXECUTADA`, ou uma variante de `permuta-manual` cross-process) | Estados de elegibilidade — 4 unions/consts em TS + 2 CHECKs SQL + hardcoded filters em 6 serviços + 3 arquivos de UI | Development-time, ciclo `/feature-new` ou `/feature-tweak`, worktree dedicado | Compilador (`npm run typecheck`) DEVE quebrar em **todo lugar** onde a decisão do estado importa; testes vermelhos onde a semântica muda; nenhuma perda silenciosa como a que originou este delta (2,72× de inflação) | Nº de arquivos que precisam ser tocados; % desses lugares que o build QUEBRA (vs. os que silenciam) — **alvo: 100% quebra, hoje ≈ 15%** |

Bass: "everything will change". O delta é, por definição, a evidência do custo de esconder mudança atrás de convenção implícita: **três catch-alls independentes** (escrita/leitura/ingestão relacional) que colapsavam 3 estados em `bloqueada` por meses, sem que compilador ou teste alertassem — porque nenhuma tactic de **Restrict Dependencies** ou **Refactor** havia sido aplicada ao union de estados. O delta corrige as três, mas o cenário acima permanece parcialmente exposto.

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Fontes de verdade paralelas para a lista de estados | **6** (TS) + **2** (SQL CHECKs, com sets divergentes) | 1 canônica + espelho SQL derivado | ❌ | `grep -rln "elegivel\\|bloqueada\\|casamento-manual" src/backend src/frontend` |
| Sítios com `switch` exaustivo (`never` assign) sobre `EstadoElegibilidade` | **1** (`IngestaoPermutasService.toEstadoRow`) | ≥ toda projeção estado→X | ⚠️ | `grep -rn "estado: never" src/backend` |
| Sítios com `if/ternário/filter` NÃO-exaustivo sobre estado | **≥ 32** hits em 8 arquivos (ver F-modifiability-2) | ≤ 5 (isolados a UI de leitura) | ❌ | `grep` de igualdades `status === '...'` / `estadoElegibilidade === '...'` |
| CHECK SQL divergentes entre `permuta_adiantamento` (6 estados, inclui `descoberta`) e `permuta_candidata_snapshot` (5 estados) | 2 constraints, sets ≠ | 1 conjunto canônico ou 2 sets documentados como intencionais | ⚠️ | `src/backend/migrations/0054_estado_ja_permutado.sql` §1-2 |
| LOC dos serviços tocados (delta vs. baseline `origin/main`) | Eleicao 974→1008 (+34); Gestao 537→543 (+6); Ingestao 503→519 (+16); RelationalRepo 641→686 (+45); SnapshotRepo 367→443 (+76) | EleicaoPermutasService ≤ 600 (Bass "Split Module" candidato) | ⚠️ | `wc -l` em ambas as pontas do stash |
| Cognitive-complexity warnings (Biome) em arquivos de `permutas/` | **17** — idêntico ao baseline `origin/main` (**17**); total repo **66** (inalterado) | 0 novos regressos → ✅; hotspots crônicos → carry-over | ✅ (delta) / ⚠️ (crônico) | `npm run lint -- --max-diagnostics=200 \| grep noExcessiveCognitiveComplexity` |
| Fan-in (não-teste) do módulo `EstadoElegibilidade.ts` | **9 arquivos** (2 repos + 5 services + 2 interfaces) | fan-in alto justificado ↔ 1 fonte de verdade | ⚠️ | `grep -rln "ESTADO_ELEGIBILIDADE\\|EstadoElegibilidade" src/backend --include=*.ts \| grep -v test` |
| Fan-in dos serviços chave (não-teste) | Eleicao 6 · Gestao 4 · Ingestao 4 · SnapshotRepo 7 · RelationalRepo 7 | monitorar; nada acima de 12 | ✅ | idem |
| Cross-layer violations (`lambda → repository` / `route → repository`) | 0 nas rotas tocadas por este delta (`routes/permutas.ts`) — segue chamando pela via Service | 0 | ✅ | `grep -n "Repository" src/backend/routes/permutas.ts` |
| Circular deps entre serviços de `permutas/` | Nenhum ciclo detectado (Ingestao → Eleicao, RelatorioExport → Gestao, ReconciliacaoLote → Gestao; grafo acíclico) | 0 | ✅ | `grep -rn "import.*from './(Eleicao\\|Ingestao\\|Gestao)PermutasService'" src/backend/domain/service/permutas` |
| Ontology `_index.json` / `_coverage.json` acurados após delta | ADR-0043 registrada, business-rule `fidelidade-snapshot-eleicao` criada, state-machine T6 documentada, `_coverage` bumped | 100% acurado | ✅ | `git diff origin/main -- ontology/` |
| Migração 0054 idempotência + reversibilidade | **idempotente** (ver comentário do próprio SQL — asserção detecta 2ª execução via `NOT EXISTS status NOT IN (elegivel,bloqueada)`); **sem script de rollback escrito** | idempotente + rollback documentado | ⚠️ | `src/backend/migrations/0054_estado_ja_permutado.sql` §Idempotência |
| Cobertura de teste do delta | **+22 testes** (1723 → 1745) — 3 casos I5 canônicos em `EleicaoPermutasService.test.ts` + 5-state round-trip em `PermutaSnapshotRepository.test.ts` + parity `PermutaRelationalRepository.test.ts` | testes canônicos do invariante ✅ | ✅ | shared metrics + `ontology/business-rules/fidelidade-snapshot-eleicao.md` §Teste canônico |

### Apêndice A — Top-5 arquivos mais tocados/inchados no delta (LOC pós-delta)

| Arquivo | LOC pós | LOC pré | Δ | Warnings CC |
|---|---|---|---|---|
| `src/backend/domain/service/permutas/EleicaoPermutasService.ts` | **1008** | 974 | +34 | 2 |
| `src/backend/domain/repository/permutas/PermutaRelationalRepository.ts` | **686** | 641 | +45 | 2 |
| `src/backend/domain/service/permutas/GestaoPermutasService.ts` | **543** | 537 | +6 | 4 |
| `src/backend/domain/service/permutas/IngestaoPermutasService.ts` | **519** | 503 | +16 | 4 |
| `src/backend/domain/repository/permutas/PermutaSnapshotRepository.ts` | **443** | 367 | +76 | 0 |

### Apêndice B — Fan-in dos módulos de estado/repositórios do delta (não-teste)

| Módulo | Fan-in (files, não-teste) | Comentário |
|---|---|---|
| `EstadoElegibilidade.ts` (`ESTADO_ELEGIBILIDADE`) | **9** | Fonte de verdade parcial — 3 fontes paralelas persistem (ver F-1) |
| `PermutaSnapshotRepository.ts` | 7 | Coração da correção; mudança rippled p/ 7 consumers, tudo verde |
| `PermutaRelationalRepository.ts` | 7 | Idem |
| `EleicaoPermutasService.ts` | 6 | Fan-in "orquestrador do domínio" — esperado |
| `IngestaoPermutasService.ts` | 4 | Único módulo com exhaustive `never` sobre estado |
| `GestaoPermutasService.ts` | 4 | Filters não-exaustivos internos (F-2) |

## 3. Tactics — Cobertura no delta

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| **Split Module** | Não aplicado; `EleicaoPermutasService.ts` atravessou o teto de 1000 LOC no delta (1008). Repository `PermutaSnapshotRepository` cresceu 76 LOC concentrando runs + snapshot + idempotência + latest-ingest. | ⚠️ parcial | `wc -l` (Apêndice A) |
| **Increase Semantic Coherence** | Bom — `EleicaoPermutasService.contarPorEstado` centraliza a agregação **única** que alimenta header e snapshot (`...totals`), satisfazendo a cláusula 2 de I5 por construção. `IngestaoPermutasService` mantém foco em ingestão; `PainelService` (91 LOC) foi removido — coesão aumentou. | ✅ presente | `EleicaoPermutasService.ts:976-999` (`contarPorEstado`); `IngestaoPermutasService.ts:381-402` (`...totals`) |
| **Encapsulate** | Novo `parseStatusSnapshot` (`PermutaSnapshotRepository.ts:97-112`) e `parseEstadoElegibilidadeRow` (`PermutaRelationalRepository.ts:53-60`) encapsulam o narrowing "coluna → tipo do domínio" com fail-loud. Sub o padrão dos catch-alls silenciosos. | ✅ presente | code refs acima |
| **Use an Intermediary** | Repository é o intermediário canônico entre serviço e SQL; delta mantém essa fronteira (services chamam repos, não SQL direto). | ✅ presente | `grep "databaseClient" src/backend/domain/service/permutas/*.ts` (0 hits em serviços do delta) |
| **Restrict Dependencies** | O union `EstadoElegibilidadeRow` continua **duplicado** em `PermutaRelationalRepository.ts:19-24`, `interface/permutas/Gestao.ts:8-13`, `frontend/lib/types.ts:25-30`. O delta reconhece a duplicação em comentário mas **não a elimina** ("Uma fonte só", diz o comentário — a fonte segue múltipla). | ❌ ausente | `EstadoElegibilidade.ts` vs `PermutaRelationalRepository.ts:19` vs `Gestao.ts:8` vs `frontend/lib/types.ts:25` |
| **Refactor** | `IngestaoPermutasService.toEstadoRow` foi refatorado de `default: 'descoberta'` para `switch` exaustivo com `const naoMapeado: never` (`IngestaoPermutasService.ts:273-291`). É o único refactor de exaustividade do delta. | ⚠️ parcial | `IngestaoPermutasService.ts:287` |
| **Abstract Common Services** | Não há utilitário `assertNever` / `exhaustiveCheck` compartilhado — cada narrowing de coluna reimplementa o Set + throw. 2 sítios agora (`parseStatusSnapshot`, `parseEstadoElegibilidadeRow`) com a mesma forma. | ⚠️ parcial | `grep "assertNever\\|checkExhaustive" src/backend` → 0 hits |
| **Defer Binding — polymorphism/DI** | tsyringe segue em todos os novos módulos (`@injectable()` em `PermutaSnapshotRepository`, `EleicaoPermutasService`, `IngestaoPermutasService`). Zero interfaces com múltiplas implementações — DI é usada para wiring, não runtime variability. Aceitável e documentado no CLAUDE.md. | ✅ presente | `grep "@injectable" src/backend/domain/**/permutas/*.ts` |
| **Defer Binding — configuration files** | Constantes do delta são **hard-coded no código** (SNAPSHOT_INSERT_CHUNK=500, INGEST_LOCK_KEY=918273645, TTL 24h da idempotência, PAGE_SIZE=500). Nenhuma vai a `EnvironmentProvider` / SSM. Aceitável — não são regras de negócio, são limites técnicos —, mas o cutoff do TTL de idempotência (24h) É uma decisão de negócio embutida sem defer. | ⚠️ parcial | `PermutaSnapshotRepository.ts:69, 148`; `IngestaoPermutasService.ts:37`; `EleicaoPermutasService.ts:68-69` |
| **Defer Binding — plugin/runtime registration** | N/A — domínio single-tenant single-workflow por design; não há espaço legítimo. | N/A | — |

## 4. Findings (achados)

### F-modifiability-1: Estados vivem em **6 fontes de verdade paralelas** — o delta reconhece o problema mas só endereça uma

- **Severidade**: P1
- **Tactic violada**: Restrict Dependencies (o delta ainda depende de N declarações independentes que precisam ficar em sincronia por convenção humana)
- **Localização**:
  - `src/backend/domain/interface/permutas/EstadoElegibilidade.ts:8-27` — `ESTADO_ELEGIBILIDADE` (constante canônica)
  - `src/backend/domain/repository/permutas/PermutaRelationalRepository.ts:19-33` — `EstadoElegibilidadeRow` union + `ESTADOS_ROW_VALIDOS` (6 estados, inclui `descoberta`)
  - `src/backend/domain/interface/permutas/Gestao.ts:8-13` — `StatusElegibilidade` union (5 estados, sem `descoberta`)
  - `src/frontend/lib/types.ts:25-30` — `StatusElegibilidade` union (5 estados, cópia carbono da Gestao.ts)
  - `src/frontend/app/permutas/components/format.ts:161-179` — `FILTRO_VAZIO_LABEL`, `STATUS_LABEL`, `STATUS_OPTIONS` (3 mapas duplicando os estados)
  - `src/backend/migrations/0054_estado_ja_permutado.sql:56-63,66-70` — 2 CHECK constraints, **com sets diferentes** (adiantamento aceita 6, snapshot 5)
- **Evidência (objetiva)**:
  ```
  $ grep -rln "'ja-permutado'\|'casamento-manual'\|'permuta-manual'" src/backend src/frontend | grep -v test | grep -v migrations | wc -l
  10
  ```
  Além disso, o próprio `PermutaRelationalRepository.ts:11-16` documenta em comentário: *"este union aparecia DUPLICADO... uma fonte só."* — o comentário virou aspiração; a duplicação com o frontend, `Gestao.ts` e o próprio `EstadoElegibilidade.ts` permanece.
- **Impacto técnico**: adicionar um 6º estado exige tocar 6 arquivos (backend + frontend + 2 migrations com CHECKs distintas), e **nenhum deles quebra o build se algum for esquecido** — repetindo a classe exata de defeito que este delta corrige.
- **Impacto de negócio**: o bug corrigido custou 2,72× de inflação em passivo externo reportado durante ~3 meses (677 vs. 249 reais; ver ADR-0043). A raiz — "estado é convenção espalhada, não invariante forçado" — permanece.
- **Métrica de baseline**: 6 fontes paralelas em TS + 2 CHECKs SQL com sets divergentes; 0 lugares onde uma nova entrada em `ESTADO_ELEGIBILIDADE` propaga automaticamente.

### F-modifiability-2: Um único `switch` exaustivo protege o pipeline — 32+ sítios continuam **silenciando** um estado desconhecido

- **Severidade**: P1
- **Tactic violada**: Refactor (o padrão `never` deveria ser regra, não exceção pontual)
- **Localização** (sítios que aceitam calado o estado do domínio):
  - `src/backend/domain/service/permutas/EleicaoPermutasService.ts:976-999` — `contarPorEstado` enumera as 6 chaves a mão; novo estado NÃO entra em `EleicaoTotals` → `PermutaEleicaoRunInput` — snapshot **grava** mas contagem do header perde
  - `src/backend/domain/service/permutas/GestaoPermutasService.ts:176-180` — 5 `.filter(p => p.status === '...')` para os totalizadores do painel
  - `src/backend/domain/service/permutas/GestaoPermutasService.ts:266-267` — `statusDoEstado = (estado) => estado === 'descoberta' ? 'bloqueada' : estado` (pass-through; aceitaria estado novo tacitamente)
  - `src/backend/domain/service/permutas/GestaoPermutasService.ts:291,299,315-326` — cadeia de ternários `status === '...'` que decide badge/aloc/tipoPermuta
  - `src/backend/domain/service/permutas/RelatorioExportService.ts:70-88, 258-263, 328-331` — **12 filters** hardcoded que alimentam o export XLSX
  - `src/backend/domain/service/operacao/JobRunReadModel.ts:193-199` — `metricas` de eleicao com 6 chaves em pt-BR fixas
  - `src/frontend/app/permutas/components/ui.tsx:43-93` — `StatusBadge` if-chain com **default → "Bloqueada"** (a badge silenciosa que o próprio bug produzia)
  - `src/frontend/app/permutas/components/format.ts:164-179` — labels + options arrays
- **Evidência (objetiva)**:
  ```
  $ grep -rn "estado: never" src/backend --include=*.ts | wc -l
  1
  $ grep -rn "status === '\\(elegivel\\|bloqueada\\|casamento-manual\\|permuta-manual\\|ja-permutado\\)'" src/backend --include=*.ts | grep -v test | wc -l
  20
  ```
  Único sítio protegido: `IngestaoPermutasService.ts:287` (`const naoMapeado: never = estado`). Todos os outros aceitam um estado novo sem erro de build.
- **Impacto técnico**: um `/feature-new "adicionar estado EM_APROVACAO"` precisa lembrar de 8 arquivos. O compilador ajuda em 1 (`toEstadoRow`). O restante são hits de `grep` — a ferramenta usada pelo desenvolvedor humano que este delta prova ser insuficiente.
- **Impacto de negócio**: idem F-1 — o próximo estado do domínio (ADR-0013 já prevê `EXECUTADA` na Fase 3) vai atravessar os mesmos ~30 sítios, e a probabilidade de reprodução do bug é linear no nº de sítios não-exaustivos.
- **Métrica de baseline**: 1 sítio exaustivo / ≥ 20 sítios com igualdade nua = **5% de cobertura de exaustividade**.

### F-modifiability-3: CHECK SQL das duas tabelas com sets divergentes — schema como fonte de verdade **inconsistente**

- **Severidade**: P2
- **Tactic violada**: Increase Semantic Coherence (schema conta uma versão da história, código conta outra)
- **Localização**: `src/backend/migrations/0054_estado_ja_permutado.sql:53-70`
- **Evidência (objetiva)**:
  ```sql
  -- permuta_adiantamento aceita 6 estados
  CHECK (estado_elegibilidade IN
      ('descoberta', 'elegivel', 'bloqueada', 'casamento-manual', 'permuta-manual', 'ja-permutado'));
  -- permuta_candidata_snapshot aceita 5 — SEM 'descoberta'
  CHECK (status IN
      ('elegivel', 'bloqueada', 'casamento-manual', 'permuta-manual', 'ja-permutado'));
  ```
  A justificativa (`descoberta` é inalcançável no caminho do snapshot porque toda candidata passa por `avaliarElegibilidade` antes) está documentada em `PermutaSnapshotRepository.ts:170-175`, mas **não no schema**. Um DBA lendo os dois CHECKs sem o contexto do TypeScript não sabe por que divergem.
- **Impacto técnico**: qualquer future migration que estenda os estados precisa lembrar de estender **as duas** constraints com regras potencialmente diferentes; o custo de mudança de estado = 2 migrations + backfill + código. Binding time: deploy (não runtime).
- **Impacto de negócio**: baixo hoje; alto se um estado transiente for adicionado e uma migration esquecer uma das duas CHECKs.
- **Métrica de baseline**: 2 CHECKs, |A ∩ B| = 5, |A ∪ B| = 6, |A △ B| = 1 (`descoberta`).

### F-modifiability-4: LOC de `EleicaoPermutasService.ts` cruzou 1000 (1008) — candidato canônico a **Split Module**

- **Severidade**: P2
- **Tactic violada**: Split Module
- **Localização**: `src/backend/domain/service/permutas/EleicaoPermutasService.ts` (1008 LOC pós-delta; 974 pré)
- **Evidência (objetiva)**:
  ```
  $ wc -l src/backend/domain/service/permutas/EleicaoPermutasService.ts
  1008
  ```
  O arquivo agrega: (a) fan-out Conexos multi-filial com concurrency, (b) idempotência com `pg_try_advisory_lock`, (c) `runEleicao` orchestration, (d) hidratação `hidratarInvoiceNegociada` + `derivarPagoDosTitulos`, (e) `contarPorEstado` e `countByMotivo`, (f) persistência via snapshot repo. **6 responsabilidades num arquivo.**
- **Impacto técnico**: teste do delta cresceu para 216 linhas novas em `EleicaoPermutasService.test.ts`; adicionar teste para um 6º caminho vai empilhar num arquivo já grande. Cognitive load cresce; refatorar isoladamente uma das 6 responsabilidades força tocar o arquivo inteiro.
- **Impacto de negócio**: médio — o custo real aparece na próxima feature que precisar de fan-out concurrente E de contagem por estado (o delta é exatamente esta feature).
- **Métrica de baseline**: 1 arquivo com 1008 LOC e 6 responsabilidades identificáveis; teto do padrão (600 LOC) ultrapassado em +68%.

### F-modifiability-5: Complexidade cognitiva **estável mas alta** nos hotspots de `permutas/` — o delta não regrediu, mas não melhorou

- **Severidade**: P2
- **Tactic violada**: Refactor (Reduce Size of Module aplicado a funções, não arquivos)
- **Localização**: 17 warnings Biome `noExcessiveCognitiveComplexity` em arquivos de `permutas/`, mesma contagem antes e depois do delta.
- **Evidência (objetiva)**:
  ```
  $ npm run lint -- --max-diagnostics=200 2>&1 | grep -B 1 noExcessiveCognitiveComplexity | grep permutas | wc -l
  17     # delta
  17     # baseline origin/main
  ```
  Hotspots (linhas ajustadas pós-delta): `GestaoPermutasService.ts:46, 223, 278, 487`; `IngestaoPermutasService.ts:214, 309, 332, 441`; `PermutaRelationalRepository.ts:278, 609`; `AlocacaoPermutasService.ts:123, 190`; `EleicaoPermutasService.ts:537, 685`; `BorderoGestaoService.ts:488`; `ReconciliacaoLotePermutaService.ts:80`; `ReconciliacaoPermutaService.ts:99`.
- **Impacto técnico**: cada função sinalizada é um convite ao próximo bug com o mesmo perfil deste delta (ramificação sobre estado dentro de fluxo grande). Nenhuma é hotpath deste delta, mas todas são carry-over que a próxima mudança de regra vai pagar.
- **Impacto de negócio**: baixo/médio a curto prazo; alto no acumulado — modificar uma dessas funções custa releitura completa.
- **Métrica de baseline**: 17 warnings em `permutas/` (5 arquivos), 0 novos, 0 removidos.

### F-modifiability-6: `JobRunReadModel.lerPermutas` hardcoda chaves em pt-BR — cross-cutting concern com o painel de operação

- **Severidade**: P3
- **Tactic violada**: Restrict Dependencies (contagem por estado vive em 2 lugares: `contarPorEstado` no domínio + `metricas` no read-model)
- **Localização**: `src/backend/domain/service/operacao/JobRunReadModel.ts:193-199`
- **Evidência (objetiva)**:
  ```typescript
  metricas: {
      candidatas: r.totalCandidatas,
      elegiveis: r.totalElegiveis,
      bloqueadas: r.totalBloqueadas,
      'casamento manual': r.totalCasamentoManual,
      'permuta manual': r.totalPermutaManual,
      'já permutado': r.totalJaPermutado,
  },
  ```
  O comentário adjacente (`JobRunReadModel.ts:180-191`) DEFENDE a decisão — a tela renderiza `Object.entries(metricas)` com a chave crua, um mapa de rótulos ampliaria o escopo p/ UI. Justo. Mas: um 6º estado exige lembrar deste arquivo, sem help do compilador (chaves de object literal não são checadas contra `EleicaoTotals`).
- **Impacto técnico**: contagens novas de estado ficam invisíveis no painel `/operacao` até alguém adicionar a chave aqui. Bug de omissão típico.
- **Impacto de negócio**: baixo — a tela `/operacao` é interna; um estado novo sem badge no painel é ruído, não incidente.
- **Métrica de baseline**: 1 shape (`EleicaoTotals`) → 3 duplicações estruturais (`PermutaEleicaoRunInput`, `PermutaRunSummary`, `JobRunReadModel.metricas`); 4 se contar o `Object.entries` da UI.

### F-modifiability-7: Ausência de utilitário `assertNever` compartilhado — cada sítio reimplementa

- **Severidade**: P3
- **Tactic violada**: Abstract Common Services
- **Localização**: `IngestaoPermutasService.ts:287` (única exhaustividade); `PermutaSnapshotRepository.ts:97-112`, `PermutaRelationalRepository.ts:53-60` (dois narrowings Set-based com throw praticamente idênticos)
- **Evidência (objetiva)**:
  ```
  $ grep -rn "assertNever\|checkExhaustive\|neverReached" src/backend 2>/dev/null | wc -l
  0
  ```
- **Impacto técnico**: reimplementar o padrão em cada arquivo aumenta a chance de que a próxima ocorrência esqueça o `throw` — que foi como o `default: 'descoberta'` sobreviveu por meses.
- **Impacto de negócio**: baixo. É uma alavanca barata para transformar F-2 de "convenção humana" em "erro de compilação".
- **Métrica de baseline**: 0 helpers / 3 sítios equivalentes com forma manual.

### F-modifiability-8: Migração 0054 sem **script de rollback** — reversibilidade da mudança de estado não está codificada

- **Severidade**: P3
- **Tactic violada**: Defer Binding (a decisão "estado é permanente" está congelada na migration; reverter custa design ad-hoc)
- **Localização**: `src/backend/migrations/0054_estado_ja_permutado.sql`
- **Evidência (objetiva)**: a migration documenta idempotência forward (bloco `DO $$` na §4 e o `WHERE status = 'bloqueada'` do UPDATE não reclassifica o já reclassificado), mas **não há** `0054_estado_ja_permutado.down.sql` nem procedimento textual. Reverter exige reconstruir os motivos originais a partir dos totais — informação que existe (`bloqueadas_by_motivo` do header) mas ninguém escreveu o SQL de recuo.
- **Impacto técnico**: se produção precisar recuar (ex.: um consumidor externo dos totais aguardando comunicação), o rollback é design-on-fire. Nada catastrófico — a coluna `motivo_bloqueio` preserva a informação —, mas cruza direto com Deployability e Availability.
- **Impacto de negócio**: baixo dado o contexto (backfill validado por asserção em 2026-09-08, 0 divergências em 250 runs), mas o custo aparece se e quando o rollback for necessário.
- **Métrica de baseline**: 1 forward migration / 0 rollback scripts na 0054; padrão do repositório (nenhuma das 54 migrations tem `.down.sql`), então isto é achado transversal — este delta é o candidato natural para inaugurar a prática, dado o alto stake do backfill (152.516 linhas reescritas).

## 5. Cards Kanban

### [modifiability-1] Colapsar os unions de `EstadoElegibilidade` em fonte única, com espelho gerado para o frontend

- **Problema**
  > O delta corrige três catch-alls (escrita, leitura, ingestão) mas mantém a lista de estados declarada em 6 lugares: `EstadoElegibilidade.ts`, `PermutaRelationalRepository.ts`, `Gestao.ts`, `frontend/lib/types.ts`, `frontend/format.ts` e 2 CHECKs SQL divergentes. Adicionar um 6º estado (ADR-0013 já prevê `EXECUTADA`) obriga tocar todos e o compilador só ajuda em 1.

- **Melhoria Proposta**
  > Aplicar **Restrict Dependencies**. Tornar `ESTADO_ELEGIBILIDADE` (backend) a única fonte de verdade; substituir `EstadoElegibilidadeRow` (PermutaRelationalRepository) e `StatusElegibilidade` (Gestao.ts) por `EstadoElegibilidade` importado. Publicar o tipo do backend como pacote consumido pelo frontend (barrel `interface/permutas/index.ts` copiado no build ou export type via API contract), eliminando a re-declaração em `frontend/lib/types.ts`. Substituir os arrays hardcoded em `frontend/format.ts` por `.map` sobre `Object.values(ESTADO_ELEGIBILIDADE)`. Manter as 2 CHECKs SQL, mas documentar no cabeçalho de cada migration que o conjunto **deriva** do TypeScript.

- **Resultado Esperado**
  > Adicionar um estado novo toca 1 arquivo TS (+2 migrations); build quebra em todos os lugares onde a decisão de estado importa. Fontes de verdade paralelas: 6 → 1 (+2 CHECKs SQL derivados documentados).

- **Tactic alvo**: Restrict Dependencies · Encapsulate
- **Severidade**: P1
- **Esforço estimado**: M (2–5d) — mecânico, mas atravessa BE/FE.
- **Findings relacionados**: F-modifiability-1, F-modifiability-3
- **Métricas de sucesso**:
  - Fontes paralelas TS: 6 → 1
  - CHECKs SQL divergentes: 2 sets ≠ → 2 sets iguais + comentário "derivado de `ESTADO_ELEGIBILIDADE`"
  - Nº de arquivos que precisam ser editados p/ adicionar 1 estado: 6 → 1 + 2 migrations
- **Risco de não fazer**: repetir a classe exata do bug corrigido (2,72× de inflação) no próximo estado adicionado.
- **Dependências**: nenhuma; pode rodar isolado.

### [modifiability-2] Instalar `assertNever` compartilhado e usar em todo `switch` sobre estado (contarPorEstado, statusDoEstado, StatusBadge, RelatorioExport)

- **Problema**
  > Um único `switch` do delta (`IngestaoPermutasService.toEstadoRow`) usa `const naoMapeado: never = estado` para forçar exaustividade. Os outros ≥ 20 sítios que ramificam por estado (`EleicaoPermutasService.contarPorEstado`, 5 filters em `GestaoPermutasService`, 12 em `RelatorioExportService`, `JobRunReadModel.metricas`, `StatusBadge`, `format.ts`) aceitam calado um estado desconhecido. A ferramenta do desenvolvedor é `grep`, e a lição do delta é que `grep` falha.

- **Melhoria Proposta**
  > Aplicar **Abstract Common Services + Refactor**. Criar `src/backend/domain/libs/assertNever.ts` (função que recebe `never` e lança). Refatorar os sítios acima em `switch (estado)` com todos os `case ESTADO_ELEGIBILIDADE.*` + `default: assertNever(estado)`. No frontend, portar o helper (`src/frontend/lib/assertNever.ts`) e aplicar em `StatusBadge` e `format.ts` (substituir if-chain por `switch`).

- **Resultado Esperado**
  > Sítios exaustivos sobre `EstadoElegibilidade`: 1 → ≥ 8 (todos os que ramificam por estado). Adicionar um estado novo quebra o build em cada lugar que precisa opinar sobre ele; nada silencia.

- **Tactic alvo**: Refactor · Abstract Common Services
- **Severidade**: P1
- **Esforço estimado**: M (2–5d) — cirúrgico por arquivo, ~30 pontos.
- **Findings relacionados**: F-modifiability-2, F-modifiability-7
- **Métricas de sucesso**:
  - Sítios com `assertNever`: 1 → 8+
  - `grep -rn "status === '" src/backend/domain/service/permutas` em contexto de contagem: 20 → 0
  - `StatusBadge` fallback silencioso → `default: assertNever`
- **Risco de não fazer**: o próximo estado (ADR-0013 prevê `EXECUTADA`) reproduz a classe do bug em ≥ 20 sítios ao mesmo tempo.
- **Dependências**: [modifiability-1] preferível antes (mais tipos únicos = mais alcance do helper).

### [modifiability-3] Trocar as 6 chaves de `EleicaoTotals` por um `Record<EstadoElegibilidade, number>` derivado

- **Problema**
  > `EleicaoTotals`, `PermutaEleicaoRunInput` e `PermutaRunSummary` declaram 6 propriedades manualmente (`totalCandidatas`, `totalElegiveis`, `totalBloqueadas`, `totalCasamentoManual`, `totalPermutaManual`, `totalJaPermutado`). `JobRunReadModel.metricas` faz a mesma enumeração em 6 chaves pt-BR. `contarPorEstado` monta o dicionário item a item. 4 lugares mantidos em sincronia por convenção.

- **Melhoria Proposta**
  > Aplicar **Increase Semantic Coherence**. Substituir os campos individuais por `porEstado: Record<EstadoElegibilidade, number>` + `totalCandidatas`. `contarPorEstado` passa a construir o record via `for...of Object.values(ESTADO_ELEGIBILIDADE)`. Manter migração backward-compat na coluna SQL (o header já tem colunas separadas — repository as compõe do record na hora do INSERT).

- **Resultado Esperado**
  > Novo estado adicionado a `ESTADO_ELEGIBILIDADE` propaga automaticamente para `EleicaoTotals` e `contarPorEstado`. Adicionar coluna SQL segue sendo migration explícita (correto — schema é decisão de storage), mas o TypeScript deixa de duplicar a enumeração 4×.

- **Tactic alvo**: Increase Semantic Coherence · Refactor
- **Severidade**: P2
- **Esforço estimado**: M (2–5d) — impacta serviços, repos, read-model, testes.
- **Findings relacionados**: F-modifiability-2, F-modifiability-6
- **Métricas de sucesso**:
  - Declarações estruturais duplicadas de "contagem por estado": 4 → 1
  - Nº de spots que ganham a chave nova automaticamente (sem intervenção): 0 → 3
- **Risco de não fazer**: a próxima adição de estado deixa contagens incompletas no header/painel `/operacao` sem alerta.
- **Dependências**: [modifiability-1]

### [modifiability-4] Dividir `EleicaoPermutasService` em fan-out Conexos + orquestração/contagem

- **Problema**
  > `EleicaoPermutasService.ts` atravessou 1000 LOC neste delta (1008, +34). Concentra fan-out Conexos multi-filial concurrent, idempotência com advisory lock, hidratação `derivarPagoDosTitulos`, `contarPorEstado`, `countByMotivo` e orquestração de persistência. 6 responsabilidades por arquivo, cognitive load alto, testes empilhando.

- **Melhoria Proposta**
  > Aplicar **Split Module**. Extrair: (a) `ConexosFanOutService` — leitura multi-filial concurrent + hidratação `derivarPagoDosTitulos` (500 LOC); (b) `EleicaoTotalsService` — só `contarPorEstado` + `countByMotivo` (60 LOC, isolável e altamente testável isoladamente); (c) `EleicaoPermutasService` mantém orquestração + idempotência (≤ 500 LOC).

- **Resultado Esperado**
  > 3 arquivos ≤ 500 LOC cada; testes de fan-out separados dos testes de convergência I5 (que hoje coabitam com 6 responsabilidades). O próximo delta de contagem por estado ([modifiability-3]) fica isolado no `EleicaoTotalsService`.

- **Tactic alvo**: Split Module
- **Severidade**: P2
- **Esforço estimado**: L (1–2sem) — reorganização com testes que precisam ser redistribuídos.
- **Findings relacionados**: F-modifiability-4, F-modifiability-5
- **Métricas de sucesso**:
  - LOC max em `permutas/service/`: 1008 → ≤ 500
  - Warnings CC em `EleicaoPermutasService`: 2 → 0 (redistribuídos)
- **Risco de não fazer**: cada mudança em qualquer das 6 responsabilidades força releitura de 1000 LOC.
- **Dependências**: nenhuma técnica, mas prefere vir depois de [modifiability-3] (que reduz o `contarPorEstado`).

### [modifiability-5] Documentar rollback da 0054 no ADR-0043 e inaugurar padrão `.down.sql`

- **Problema**
  > A 0054 reescreve `total_bloqueadas` histórico (64.893 → 51.459) e reclassifica 152.516 linhas de snapshot. É idempotente forward, mas não existe rollback escrito. Se um consumidor externo dos totais quebrar após deploy, o recuo é design-on-fire.

- **Melhoria Proposta**
  > Aplicar **Defer Binding — configuration**. Adicionar seção "Rollback" ao ADR-0043 com o SQL de recuo (usa `motivo_bloqueio` para inferir o estado antigo — informação preservada). Criar `src/backend/migrations/0054_estado_ja_permutado.down.sql`. Discutir com Yuri se o padrão `.down.sql` passa a ser regra para migrations de reclassificação (não para DDL puro).

- **Resultado Esperado**
  > A migration 0054 é reversível por um comando escrito e revisado, não por raciocínio ad-hoc no incidente.

- **Tactic alvo**: Defer Binding (configuration files)
- **Severidade**: P3
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-modifiability-8
- **Métricas de sucesso**:
  - Migrations de reclassificação com rollback documentado: 0 → 1 (0054 inaugura)
  - Tempo estimado de rollback em incidente: "ad-hoc" → "execução de script pronto"
- **Risco de não fazer**: baixo em regime normal; incidente-caro se e quando um consumidor externo dos totais reagir mal.
- **Dependências**: cross-QA com Deployability + Availability.

### [modifiability-6] Externalizar TTL da idempotência de eleição (24h hardcoded → `EnvironmentProvider`)

- **Problema**
  > `PermutaSnapshotRepository.findRunIdByIdempotencyKey` usa `INTERVAL '24 hours'` hardcoded no SQL. É uma decisão de negócio (janela em que a mesma `Idempotency-Key` é reconhecida) embutida no repository. Mudar de 24h para 48h (ou para 1h em incidente) exige deploy + migration de código.

- **Melhoria Proposta**
  > Aplicar **Defer Binding — configuration**. Ler o TTL de `EnvironmentProvider` (ex.: `permuta_idempotency_ttl_hours`, default 24), interpolar como parâmetro SQL (`WHERE created_at > now() - ($ttlHours * INTERVAL '1 hour')`). Documentar no CLAUDE.md e no bootstrap de container.

- **Resultado Esperado**
  > TTL da idempotência ajustável por ambiente sem code change. Deployability + Modifiability ganham.

- **Tactic alvo**: Defer Binding (configuration)
- **Severidade**: P3
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-modifiability-8 (cross-cut) + tactic Defer Binding
- **Métricas de sucesso**:
  - Regras de negócio hard-coded no repository: 1 → 0 (TTL 24h externalizado)
  - `EnvironmentProvider` schema documenta o novo key
- **Risco de não fazer**: baixo, mas o padrão "24h no SQL" pode se replicar em futuras janelas (retenção de snapshots, TTL de casamento auto, etc.).
- **Dependências**: nenhuma.

## 6. Notas do agente

- **Cross-QA — Refactor + Encapsulate** (findings F-1, F-2, F-7) tem forte overlap com Integrability: um union canônico único é a mesma condição que permite gerar um SDK/contract compartilhado com o frontend. Alertar o consolidator para consolidar F-1 numa card compartilhada.
- **Cross-QA — Reduce Size + Cycles** (F-4, F-5): não detectei ciclos reais entre os serviços (grafo acíclico: Ingestao → Eleicao → Elegibilidade; Relatorio/ReconciliacaoLote → Gestao). `EleicaoPermutasService` a 1008 LOC é alarme de Testability também — o teste do delta já cresceu 216 linhas num arquivo compartilhado por 3 outras suites de eleição.
- **Cross-QA — Magic numbers / config not externalized** (F-8, card 6): TTL 24h da idempotência = mudança de regra = redeploy → colide com Deployability. `SNAPSHOT_INSERT_CHUNK=500` e `PAGE_SIZE=500` são limites técnicos legítimos hard-coded; o TTL não é.
- **Delta é uma correção honesta**: 3 catch-alls silenciosos vs. 1 exhaustive `switch` + 2 narrowings fail-loud + invariante I5 canonizada em business-rule com teste. Nota 6,5 reflete que a raiz do bug (duplicação de union + hardcoded filters) permanece parcialmente exposta; se aplicadas as cards 1+2, salta para 8,5.
- **Métrica de contexto**: nenhum warning novo de Biome; nenhum novo layer violation; +22 testes; sem ciclo. O delta melhora a modifiability efetiva do artefato PermutaCandidata sem regressão mensurável — mas o **padrão** que permitiu o bug original persiste em módulos não tocados.
