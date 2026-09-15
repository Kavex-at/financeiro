---
qa: Integrability
qa_slug: integrability
run_id: 2026-09-15-0207-permutas-saldo-ordem-centavos
agent: qa-integrability
generated_at: 2026-09-15T02:35:00Z
scope: backend
score: 8.0
findings_count: 6
cards_count: 3
---

# Integrability — Regis-Review

## 1. Cenário Geral (Bass General Scenario aplicado ao nf-projects)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Delta `permutas-saldo-ordem-centavos` (ADR-0046) precisa (a) mudar o predicado de "pago"/"sem saldo" em um único lugar do domínio, (b) alinhar o `saldoRestante` da tela com o teto do `alocar`, e (c) casar isso com o que o ERP JÁ abateu de `mnyTitPermutar` em borderô finalizado | Introdução de constante de domínio (`ToleranciaResiduo`), extração de serviço-fonte-única (`SaldoAlocacaoAdiantamentoService`), nova query SQL (`listConsumosFinalizados`) que JOINa 4 tabelas, e mudança semântica do carimbo `permuta_bordero.atualizado_em` (agora só anda quando a situação muda) | `interface/permutas/ToleranciaResiduo.ts` (novo, 50 LOC), `service/permutas/SaldoAlocacaoAdiantamentoService.ts` (novo, 108 LOC), `repository/permutas/PermutaExecucaoRepository.listConsumosFinalizados`, `repository/permutas/PermutaAlocacaoRepository.listByAdiantamento` (substitui `sumByAdiantamento`), `client/ConexosTitulosClient.ts` (só doc-string), `frontend/app/permutas/components/historico.ts` (novo módulo, 121 LOC) | PRD Columbia · backend Express + Postgres/Supabase · frontend Next.js consumindo `GET /permutas/gestao` · robô de ingestão lendo `com298`/`fin010`/`imp019`/`imp223` no Conexos · script `validate-permutas-saldo-ordem-centavos-v1.ts` (read-only, HML/PRD gated por `PROBE_ALLOW_PRD=1`) | 0 novos endpoints HTTP · 0 mudanças no wire do Conexos (só o doc-string de `ConexosTitulosClient` cita a nova ADR) · 1 API de repositório removida (`sumByAdiantamento`) com zero call sites remanescentes · 2 abstrações compartilhadas introduzidas em 3+2 call sites de produção · 1 coluna do cache muda semântica (`atualizado_em`) sem `COMMENT ON COLUMN`/view de compat · ground-truth validator (247 linhas, 0 DIVERGENTE) usa as funções de produção em vez de re-implementar | Custo marginal para trocar/upgrade do Conexos: **não moveu**. Custo marginal para mudar a definição de "R$1,00 de tolerância" ou "não consumido pelo ERP": **1 arquivo** (fonte única), não 3 |

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Arquivos de `domain/client/*` tocados pelo delta | **1** (`ConexosTitulosClient.ts`, +4/-2 linhas, **só doc-string**) | 0 wire, 0 assinatura | ✅ | `git --no-pager diff --stat origin/main..HEAD -- src/backend/domain/client` |
| Chamadas novas ao Conexos introduzidas | **0** (o único uso no script de validação é `getDetalheTitulos`, já existente) | 0 | ✅ | `git --no-pager diff origin/main..HEAD -- src/backend/domain/client` = só comentários |
| Endpoints HTTP públicos adicionados/removidos/mudados | **0** | 0 sem versionamento | ✅ | `git --no-pager diff origin/main..HEAD -- src/backend/routes` = vazio |
| Nova abstração compartilhada #1 (`ToleranciaResiduo`) — call sites de produção | **3** (`ElegibilidadeService.ts:74`, `EleicaoPermutasService.ts:805,826`, `ReconciliacaoPermutaService.ts:935`) | ≥ 2 (justifica extrair) | ✅ | `grep -rn "ToleranciaResiduo" src/backend --include="*.ts" \| grep -v test` |
| Nova abstração compartilhada #2 (`SaldoAlocacaoAdiantamentoService`) — call sites de produção | **2** (`AlocacaoPermutasService.ts:252` teto do `alocar`, `GestaoPermutasService.ts:92,368` tela) | ≥ 2 | ✅ | `grep -rn "somaNaoConsumida\|carregarConsumosPorAdiantamento" src/backend --include="*.ts" \| grep -v test` |
| API de repositório removida com callers pendentes | **0** — `sumByAdiantamento` removido, `grep sumByAdiantamento src/` = 0 hits | 0 | ✅ | `grep -rn "sumByAdiantamento" src/` |
| Tabelas acopladas em UMA query nova (`listConsumosFinalizados`) | **4** (`permuta_alocacao_execucao`, `permuta_bordero`, `permuta_adiantamento`, `permuta_eleicao_run`) | ≤ 3 típico; > 3 exige contrato explícito de esquema | ⚠️ | `src/backend/domain/repository/permutas/PermutaExecucaoRepository.ts:189-201` |
| Coluna com semântica MUDADA in-place (`permuta_bordero.atualizado_em`) | **1** — antes: "carimbo de refresh" (bump em todo UPSERT); agora: "carimbo de última mudança de situação" (só quando `bor_vld_finalizado`/`bor_cod_estornado` diferem) | 0 sem `COMMENT ON COLUMN`/view de compat | ⚠️ | `PermutaExecucaoRepository.ts:577-587` (replace), `:602-611` (updateSituacao) |
| Leitores externos de `permuta_bordero.atualizado_em` verificáveis | ⚠️ **Não medível localmente** (nenhum dashboard/BI/planilha inventariado; INVENTARIO-INTEGRACAO.md continua ausente, como no ciclo anterior) | inventário publicado | ⚠️ | `grep -rn "atualizado_em" src/ \| grep permuta_bordero` = 1 hit interno, 0 externos |
| Testes de contrato de esquema para a nova query (`listConsumosFinalizados`) | **4 asserções de SQL** (`e.dry_run = false`, `status IN ('settled','parcial')`, `b.bor_vld_finalizado = 1`, `b.atualizado_em < r.started_at`) + 3 casos de mapeamento (settled, parcial, status descartado) | ≥ 1 por cláusula crítica | ✅ | `PermutaExecucaoRepository.test.ts:505-598` |
| Ground-truth validator usa funções de PRODUÇÃO (não re-implementa) | **sim** — importa `ElegibilidadeService`, `SaldoAlocacaoAdiantamentoService`, `ToleranciaResiduo`; a única lógica replicada (roteamento de cliente-filtro, privado do `EleicaoPermutasService`) usa os predicados de produção | 100% das regras reusadas | ✅ | `src/backend/jobs/validate-permutas-saldo-ordem-centavos-v1.ts:15-22, 147-159` |
| Ground-truth validator: execução AO VIVO (Conexos + banco) | **247 linhas, 0 DIVERGENTE** (`_shared-metrics.md` §Gate results at green) | 0 DIVERGENTE | ✅ | `docs/regis-review/2026-09-15-0207-permutas-saldo-ordem-centavos/_shared-metrics.md:86` |
| Frontend HTTP contract shape changes (chaves de payload) | **0 chaves novas**; `PermutaPendente.alocacoes` doc-string alargada para incluir `ja-permutado` (semântica de EXIBIÇÃO — os mesmos campos são reusados) | ≤ 1 quebra por delta | ✅ | `src/frontend/lib/types.ts:139-143` (só JSDoc) |
| `process.env` cru em service/repo (Inviolable Rule #8) — introduzido por este delta | **0** novos em `service/`/`repository/`. Job `validate-permutas-saldo-ordem-centavos-v1.ts:58-59` lê `CONEXOS_BASE_URL` + `PROBE_ALLOW_PRD` — aceito para script one-shot, mesmo padrão de `validate-conciliacao-retorno-v1.ts` etc. | 0 em service/repo | ✅ | `grep -n "process.env" src/backend/jobs/validate-permutas-saldo-ordem-centavos-v1.ts` |
| Terraform/infra tocado | ⚠️ **Não medível** — repo `financeiro` não tem `infra/` (deploy Render/Vercel) | — | ⚠️ | `_shared-metrics.md:78` |
| Contrato HTTP versionado (`/v1/`, `Api-Version`) | **ausente** (herança pré-existente do ciclo anterior — `docs/regis-review/2026-09-08-2011-permuta-snapshot-estados/integrability.md` F-integrability-4) | delta não pioROU | ⚠️ (pré-existente) | `grep -rn "'/v[0-9]'\|api-version" src/backend/routes` = 0 |
| View de compat / `COMMENT ON COLUMN` para a mudança semântica de `atualizado_em` | **ausente** — comentário mora só no docblock de `replaceBorderoCache` | ≥ 1 `COMMENT ON COLUMN` publicada em migration | ❌ | `grep -rn "COMMENT ON COLUMN" src/backend/migrations/` = 0 hits para `permuta_bordero.atualizado_em` |

> ⚠️ **Não medível localmente**: (a) leitores externos de `permuta_bordero.atualizado_em` (dashboards BI, planilhas ad-hoc do cliente que consultam a Supabase direto), pelo mesmo motivo do ciclo anterior — sem `docs/api/CONTRACTS.md`; (b) impacto real na primeira ingestão pós-deploy (uma janela em que linhas antigas do cache têm `atualizado_em` posterior ao último `started_at` e seguem descontando alocações do saldo — comportamento intencional documentado no ADR-0046 §Consequências, mas não instrumentado em métrica).

## 3. Tactics — Cobertura no nf-projects

### Limit Dependencies

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Encapsulate | `SaldoAlocacaoAdiantamentoService` **encapsula** a regra "quanto do alocado ainda não foi abatido pelo ERP", ANTES espalhada implicitamente entre `alocar` (`sumByAdiantamento`) e a tela (`Σ valor_alocado`). Um só ponto para mudar, dois consumidores | ✅ presente | `service/permutas/SaldoAlocacaoAdiantamentoService.ts:29-107`; call sites `AlocacaoPermutasService.ts:252`, `GestaoPermutasService.ts:92,368` |
| Use an Intermediary | O novo serviço é INTERMEDIÁRIO entre `AlocacaoPermutasService` e (`PermutaAlocacaoRepository` + `PermutaExecucaoRepository`) — antes o service consultava só o alocacao-repo com `sumByAdiantamento`, agora atravessa o intermediário que combina alocações + consumos + regra de versão | ✅ presente | `SaldoAlocacaoAdiantamentoService.ts:44-72` (`naoConsumido` puro + `somaNaoConsumida`) |
| Restrict Communication Paths | Delta não muda nada de RBAC/HTTP; herda a superfície do ciclo anterior. `sumByAdiantamento` deletado sem deixar callers órfãos (`grep sumByAdiantamento src/` = 0) | ✅ presente | `git diff origin/main..HEAD -- src/backend/routes` = vazio; `grep sumByAdiantamento src/` = 0 |
| Adhere to Standards | Query nova segue o padrão do repo (`selectMany`, params `$adtoDocCod`, `NULL::text OR ...`). Não usa concatenação de string nem SQL dinâmico. Guard explícito de terminal (`status !== 'settled' && status !== 'parcial'` → descarta), sem cast, cobre "campo novo aparece no wire" | ✅ presente | `PermutaExecucaoRepository.ts:186-206` (query), `:629-641` (`mapConsumo`) |
| Abstract Common Services | `ToleranciaResiduo.LIMITE_BRL` **passa a ser a constante única** para R$1,00 em 3 call sites de produção (Elegibilidade Gate 2/3, roteamento de cliente-filtro, âncora I-Write-6 da Reconciliação) — antes o `limiteResiduo = 1` no `ReconciliacaoPermutaService.ts:935` e o `=== 0` do Gate 3 no `EleicaoPermutasService` viviam em silos separados | ✅ presente (novo) | `interface/permutas/ToleranciaResiduo.ts:22-49`; `ReconciliacaoPermutaService.ts:935` (`limiteResiduo = ToleranciaResiduo.LIMITE_BRL`) |

### Adapt

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Discover Service | N/A — o delta não muda descoberta de serviço | N/A | Nenhuma nova conexão externa; `ConexosSessionResolver` inalterado |
| Tailor Interface | Backend não tailoreia payload novo. Frontend acrescenta `alocacoes?` a um `ja-permutado` só para renderização no Histórico — reusa o mesmo shape que `permuta-manual`/`casamento-manual` já usam. Zero chave nova, zero rename | ✅ presente | `src/frontend/lib/types.ts:139-143` (doc só); `historico.ts:12-16` (input tipado com os mesmos tipos existentes) |
| Configure Behavior | Constante `LIMITE_BRL = 1` é **hardcoded no domínio, não SSM/env** — decisão correta: valor de negócio referenciando a âncora I-Write-6 (ADR-0020), muda com ADR nova. Guarda de frescor implícita na query (`b.atualizado_em < r.started_at`) — sem flag | ✅ presente | `ToleranciaResiduo.ts:22` (`public static readonly LIMITE_BRL = 1`) |
| Manage Resources | Query `listConsumosFinalizados` roda no `Promise.all` do `exporGestao` — carrega TODOS os consumos numa chamada só (o `carregarConsumosPorAdiantamento` monta o Map por adto no cliente), evitando N+1 fan-out. Custo O(1) queries por painel | ✅ presente | `SaldoAlocacaoAdiantamentoService.ts:84-95`; `GestaoPermutasService.ts:82-93` (`Promise.all` com 8 leituras paralelas) |

### Coordinate

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Orchestrate | `SaldoAlocacaoAdiantamentoService` coordena dois repositórios (alocação + execução) numa única API pura (`somaNaoConsumida`) + duas fachadas async (`somaNaoConsumidaDoAdiantamento`, `carregarConsumosPorAdiantamento`). A tela usa uma; o `alocar` usa a outra. **Uma fonte da regra**, dois pontos de entrada — a divergência antiga (tela mostrava −19.257,73 no doc 12860; teto travava em 4.304,94 no doc 9328) fica impossível por construção | ✅ presente | `SaldoAlocacaoAdiantamentoService.ts:83-107`; ADR-0046 §D3 evidência |
| Manage Resource Coupling | O carimbo `permuta_bordero.atualizado_em` passa a ser o RELÓGIO da guarda de frescor. Isso ACOPLA a query de consumos ao invariante "cache só bumpa `atualizado_em` quando situação muda" — se algum caminho de escrita esquecer, o saldo pode superestimar (falso "consumido"). Coberto por 2 testes (replace + updateSituacao) e mora no doc-string do `replaceBorderoCache`. Não há assertion de esquema (`ASSERT`/CHECK) que force o invariante fora do TS | ⚠️ parcial | `PermutaExecucaoRepository.ts:548-587` doc-string + `PermutaExecucaoRepository.test.ts:453-475` |

### Facetas modernas

| Faceta | Implementação atual | Status | Evidência |
|---|---|---|---|
| Contract testing (round-trip, schema-pinned) | (a) `listConsumosFinalizados` tem 4 asserções DE SQL (`WHERE` inteiro) + round-trip de settled/parcial + guard de status fora do terminal; (b) `carimbo só anda quando muda` é asserido em SQL (regex `CASE WHEN ... IS DISTINCT FROM ... THEN now() ELSE ... END`) tanto para `replaceBorderoCache` quanto para `updateBorderoCacheSituacao` | ✅ presente | `PermutaExecucaoRepository.test.ts:453-475, 489-500, 505-598` |
| Contract testing (ERP ↔ produção) | `validate-permutas-saldo-ordem-centavos-v1.ts` (736 LOC) roda AO VIVO contra Conexos HML/PRD, importa as classes de produção (`ElegibilidadeService`, `SaldoAlocacaoAdiantamentoService`, `ToleranciaResiduo`) e compara com o ground truth do ERP. **247 linhas, 0 DIVERGENTE** no gate green | ✅ presente | `src/backend/jobs/validate-permutas-saldo-ordem-centavos-v1.ts`; `_shared-metrics.md:86` |
| Versioning strategy (contrato HTTP) | **inalterado** — nenhum endpoint novo, nenhum removido. A dívida pré-existente (`grep -rn "'/v[0-9]'\|api-version" src/backend/routes` = 0) continua, mas o delta não a piora | ⚠️ (pré-existente) | ver ciclo anterior F-integrability-4 |
| Versioning strategy (contrato DE DADOS Postgres) | **degradação leve** — `permuta_bordero.atualizado_em` muda de "carimbo de refresh" para "carimbo de mudança de situação" in-place, sem `COMMENT ON COLUMN`. Menor blast radius que a mudança de domínio de `permuta_candidata_snapshot.status` do ciclo anterior (2→5 valores, 152.516 linhas reclassificadas), mas mesma classe: leitor externo continua vendo a coluna, com semântica nova, sem sinal | ❌ ausente | `PermutaExecucaoRepository.ts:577-587` |
| Backward-compatibility shims | O `sumByAdiantamento` foi removido em vez de mantido como wrapper deprecated → correto, porque `grep sumByAdiantamento src/` = 0 hits, sem consumidor órfão. Alternativa "manter wrapper que soma cru" seria mentir (dupla contagem, exatamente o bug que o delta corrige) | ✅ decisão correta | `git log --oneline origin/main..HEAD -- src/backend/domain/repository/permutas/PermutaAlocacaoRepository.ts` |
| Observability of integration failures | Delta não instrumenta métrica por-fonte-do-consumo. A guarda de frescor pode fazer o saldo ficar `subestimado por até ~6h` (ADR-0046 §Consequências), sem alerta — só `SELECT count(*) WHERE atualizado_em > started_at` daria a janela. Não é regressão; é ausência herdada | ⚠️ parcial | ADR-0046 §Consequências linhas 179-184 |

## 4. Findings (achados)

### F-integrability-1: `permuta_bordero.atualizado_em` mudou de "carimbo de refresh" para "carimbo de mudança de situação" sem `COMMENT ON COLUMN` nem view de compat

- **Severidade**: P2
- **Tactic violada**: **Adhere to Standards** + **Manage Resource Coupling** (o invariante do carimbo vive só em TS)
- **Localização**:
  - `src/backend/domain/repository/permutas/PermutaExecucaoRepository.ts:577-587` (`replaceBorderoCache`)
  - `src/backend/domain/repository/permutas/PermutaExecucaoRepository.ts:602-611` (`updateBorderoCacheSituacao`)
- **Evidência (objetiva)**:
  ```sql
  atualizado_em = CASE
      WHEN permuta_bordero.bor_vld_finalizado IS DISTINCT FROM EXCLUDED.bor_vld_finalizado
        OR permuta_bordero.bor_cod_estornado IS DISTINCT FROM EXCLUDED.bor_cod_estornado
      THEN now() ELSE permuta_bordero.atualizado_em END
  ```
  Antes (`git show origin/main:src/backend/domain/repository/permutas/PermutaExecucaoRepository.ts | grep atualizado_em`): `atualizado_em = now()` incondicional.
  ```
  $ grep -rn "COMMENT ON COLUMN" src/backend/migrations/ | grep permuta_bordero
  (0 hits)
  ```
- **Impacto técnico**: qualquer leitor externo (dashboard "última atualização do borderô", alerta "cache frio > 6h") continua consultando `MAX(atualizado_em)` sem saber que a coluna agora dorme entre situações. Um borderô finalizado a 3 dias atrás e reaparecendo em vários refreshes continua com `atualizado_em` = 3 dias, embora a ingestão de fato o tenha lido HOJE. Frescor operacional visto por fora está SUBESTIMADO.
- **Impacto de negócio**: se algum dashboard/alarme externo usa esta coluna como "healthcheck do cache", passa a soar alarme falso. Menor blast radius que o `permuta_candidata_snapshot.status` do ciclo anterior (63% de queda), mas mesma classe — mudar significado in-place sem sinal.
- **Métrica de baseline**: 2 caminhos SQL alterados (replace + updateSituacao) · 1 tabela · 0 `COMMENT ON COLUMN` · 0 view de compat · 0 sonda de observabilidade da nova janela de subestimação (ADR-0046 §Consequências reconhece a janela de ~6h)

### F-integrability-2: `listConsumosFinalizados` JOIN de 4 tabelas acopla o cálculo do saldo a 4 esquemas de uma vez

- **Severidade**: P2
- **Tactic violada**: **Encapsulate** (blast radius de mudança de esquema)
- **Localização**: `src/backend/domain/repository/permutas/PermutaExecucaoRepository.ts:189-201`
- **Evidência (objetiva)**:
  ```sql
  FROM permuta_alocacao_execucao e
  JOIN permuta_bordero b ON b.fil_cod = e.fil_cod AND b.bor_cod = e.bor_cod
  JOIN permuta_adiantamento a ON a.doc_cod = e.adiantamento_doc_cod
  JOIN permuta_eleicao_run r ON r.id = a.last_ingest_run_id
  WHERE e.dry_run = false
    AND e.status IN ('settled', 'parcial')
    AND b.bor_vld_finalizado = 1
    AND b.bor_cod_estornado IS NULL
    AND b.atualizado_em < r.started_at
  ```
  4 tabelas, 5 cláusulas de filtro que dependem cada uma de 1 semântica externa (dry_run, status terminal, `borVldFinalizado=1`, `borCodEstornado IS NULL`, `atualizado_em < started_at`).
- **Impacto técnico**: renomear coluna em qualquer uma das 4 tabelas (`last_ingest_run_id`, `bor_vld_finalizado`, `bor_cod_estornado`, `dry_run`, `started_at`) quebra a query. Não é P1 porque o teste `PermutaExecucaoRepository.test.ts:516-529` asserta cada uma das 4 cláusulas em regex de SQL — uma mudança silenciosa em qualquer coluna dispara test-fail. Mas o blast radius (4 tabelas → 1 SQL) é grande para um repo sem geração automática de tipos DB.
- **Impacto de negócio**: adiar migration que renomeie `last_ingest_run_id` (ou o `dry_run` do executor) exige mexer neste SQL + no `carregarConsumosPorAdiantamento` + no validador live — 3 pontos de mudança.
- **Métrica de baseline**: 4 tabelas × 5 cláusulas de filtro = 20 acoplamentos coluna-a-esquema numa query; 4 asserções de SQL no teste (cobre 4/5 cláusulas — a última, `AND ($adtoDocCod::text IS NULL OR ...)`, é asserida separadamente)

### F-integrability-3: `ToleranciaResiduo` extraída como fonte única do R$1,00 (positivo — observação sem card)

- **Severidade**: P3 (informativa — ficaria como card apenas se **rejeitássemos** a extração; é o oposto)
- **Tactic aplicada**: **Abstract Common Services**
- **Localização**:
  - `src/backend/domain/interface/permutas/ToleranciaResiduo.ts:1-50` (novo, 50 LOC + 90 LOC de teste)
  - Call sites: `ElegibilidadeService.ts:74`, `EleicaoPermutasService.ts:805,826`, `ReconciliacaoPermutaService.ts:935`
- **Evidência (objetiva)**:
  ```
  $ grep -rn "ToleranciaResiduo" src/backend --include="*.ts" | grep -v test
  ConexosTitulosClient.ts:177          # doc-string apenas
  ElegibilidadeService.ts:13,74        # Gate 2
  ReconciliacaoPermutaService.ts:8,935 # âncora I-Write-6 (ADR-0020)
  EleicaoPermutasService.ts:23,805,826 # hidratação Gate 3 + roteamento cliente-filtro
  Adiantamento.ts:10                    # doc-string
  ```
- **Impacto**: o R$1,00 antes era literal (`limiteResiduo = 1` na reconciliação) e implicitamente `=== 0` no Gate 3. Agora **1 constante** para os dois usos do mesmo fenômeno de arredondamento — mudar de R$1,00 para R$0,50 no futuro é 1 edição, testes correspondentes.
- **Métrica de baseline**: 3 call sites de produção convergem para 1 constante · 90 LOC de teste unitário do próprio predicado · 0 duplicação restante do literal `1` como limite absoluto

### F-integrability-4: `SaldoAlocacaoAdiantamentoService` extraído como intermediário único da regra "não consumido pelo ERP" (positivo — observação sem card)

- **Severidade**: P3 (informativa)
- **Tactic aplicada**: **Use an Intermediary** + **Orchestrate**
- **Localização**: `src/backend/domain/service/permutas/SaldoAlocacaoAdiantamentoService.ts:29-107`
- **Evidência (objetiva)**:
  ```
  $ grep -rn "somaNaoConsumidaDoAdiantamento\|carregarConsumosPorAdiantamento" src/backend --include="*.ts" | grep -v test
  AlocacaoPermutasService.ts:252   # teto de I-Permuta-1
  GestaoPermutasService.ts:92,368  # saldoRestante da tela
  SaldoAlocacaoAdiantamentoService.ts:87,98-106  # implementação
  ```
- **Impacto**: dois consumidores (o teto do `alocar` e o `saldoRestante` da tela) agora leem a MESMA função. A divergência anterior — tela mostrava `−19.257,73` no doc 12860; teto travava em `4.304,94` no doc 9328 com saldo real de `39.652,47` (ADR-0046 §D3) — deixa de ser possível por construção. `sumByAdiantamento` deletado sem callers órfãos (`grep sumByAdiantamento src/` = 0).
- **Métrica de baseline**: 1 fonte da regra · 2 consumidores · API pura (`somaNaoConsumida`) + 2 fachadas async · 108 LOC de código + 170 LOC de teste

### F-integrability-5: Ground-truth validator usa funções de produção em vez de re-implementar (positivo — observação sem card)

- **Severidade**: P3 (informativa)
- **Tactic aplicada**: **Contract testing** (faceta moderna)
- **Localização**: `src/backend/jobs/validate-permutas-saldo-ordem-centavos-v1.ts:15-22, 147-159`
- **Evidência (objetiva)**:
  ```typescript
  import ToleranciaResiduo from '../domain/interface/permutas/ToleranciaResiduo.js';
  import ElegibilidadeService from '../domain/service/permutas/ElegibilidadeService.ts';
  import SaldoAlocacaoAdiantamentoService from '../domain/service/permutas/SaldoAlocacaoAdiantamentoService.js';
  // ...
  const naoConsumido = saldo.somaNaoConsumida(alocacoes, consumosVivos);
  const nosso = saldoErpNeg - naoConsumido;
  ```
  Docblock (`:32-34`): *"Importa as funções de produção em vez de reimplementar a regra: um validador que reescreve a fórmula valida a si mesmo."*
- **Impacto**: 247 linhas validadas AO VIVO, 0 DIVERGENTE. Se `naoConsumido` mudar de assinatura, o validador quebra na compilação — não silenciosamente com fixture antiga.
- **Métrica de baseline**: 736 LOC de validador · 0 re-implementação da regra de saldo · 0 re-implementação do predicado de tolerância · 0 DIVERGENTE em 247 linhas

### F-integrability-6: Wire do Conexos NÃO tocado — só doc-string do `ConexosTitulosClient` (observação positiva)

- **Severidade**: P3 (informativa)
- **Tactic aplicada**: **Encapsulate** — o ponto mais frágil do stack (ERP) fica CONTIDO
- **Localização**: `src/backend/domain/client/ConexosTitulosClient.ts:172-181`
- **Evidência (objetiva)**:
  ```
  $ git --no-pager diff --stat origin/main..HEAD -- src/backend/domain/client
   src/backend/domain/client/ConexosTitulosClient.ts | 6 ++++--
   1 file changed, 4 insertions(+), 2 deletions(-)
  ```
  O diff é 100% doc-string informando que a tolerância R$1,00 vive no domínio (`ToleranciaResiduo`), não no wire. `mapDetalheTitulos` mantém `pago = (mnyTitAberto === 0)` estrito, porque o mesmo método serve também às invoices e ao SISPAG.
- **Impacto**: o custo marginal de trocar o Conexos por outro ERP não se moveu com este delta. A mudança de regra do adiantamento fica dentro do domínio; o wire do ERP e o `pago` do wire ficam intocados para os outros consumidores (Invoice, SISPAG).

## 5. Cards Kanban

### [integrability-1] Documentar em SQL a nova semântica de `permuta_bordero.atualizado_em` (COMMENT ON COLUMN + view de compat opcional)

- **Problema**
  > A coluna `permuta_bordero.atualizado_em` mudou de "carimbo de refresh" (bump em todo `UPSERT`) para "carimbo de última mudança de situação" (só quando `bor_vld_finalizado`/`bor_cod_estornado` diferem — `PermutaExecucaoRepository.ts:577-587`). É a base da guarda de frescor da regra D3 do ADR-0046. Qualquer leitor externo à aplicação (dashboard "última atualização", alerta "cache frio > 6h") continua consultando `MAX(atualizado_em)` sem sinal, e passa a ver borderôs "envelhecidos" que na verdade foram relidos hoje. É a mesma classe de defeito da mudança de domínio de `permuta_candidata_snapshot.status` do ciclo anterior — menor blast radius, mesmo formato.

- **Melhoria Proposta**
  > (a) Migration nova (`0055_permuta_bordero_atualizado_em_comment.sql` — o número já bate com a política do ciclo anterior): `COMMENT ON COLUMN permuta_bordero.atualizado_em IS 'ADR-0046 (2026-09-14): carimbo de última mudança de bor_vld_finalizado/bor_cod_estornado, NÃO de refresh. É a base da guarda de frescor da soma de alocações consumidas — refresh sem mudança de situação NÃO atualiza este campo.'`. (b) Opcional, se algum consumidor externo for identificado: `CREATE VIEW permuta_bordero_com_ultimo_refresh AS SELECT b.*, GREATEST(b.atualizado_em, r.started_at) AS ultimo_refresh_em FROM permuta_bordero b LEFT JOIN LATERAL (...) r`. Tactic Bass: **Adhere to Standards**.

- **Resultado Esperado**
  > Ferramenta externa (DBeaver, Metabase, `psql \d+`) mostra a nota da ADR-0046 no schema; leitor externo com dúvida sobre "quando este borderô foi visto pela última vez" tem pista em SQL, não só no docblock TS. Métrica: `SELECT description FROM pg_description WHERE objoid = 'permuta_bordero'::regclass AND objsubid = (SELECT attnum FROM pg_attribute WHERE attrelid = 'permuta_bordero'::regclass AND attname = 'atualizado_em')` retorna a nota.

- **Tactic alvo**: Adhere to Standards (Bass, Limit Dependencies)
- **Severidade**: P2
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-integrability-1
- **Métricas de sucesso**:
  - `COMMENT ON COLUMN permuta_bordero.atualizado_em` presente: 0 → 1
  - Migrations do delta que tocam `permuta_bordero` com nota de mudança semântica: 0 → 1
- **Risco de não fazer**: pequeno enquanto o único consumidor conhecido é in-repo (a própria query D3 e a `carregarConsumosPorAdiantamento`); cresce se algum dashboard externo do cliente usar a coluna. Mesma classe do card `[integrability-1]` do ciclo anterior, custo similar.
- **Dependências**: pode ir junto com o card `[integrability-1]` do ciclo anterior (2026-09-08-2011), que já propunha uma política de `COMMENT ON` em migrations de mudança semântica.

### [integrability-2] Instrumentar métrica da janela de subestimação de saldo introduzida pela guarda de frescor

- **Problema**
  > A guarda de frescor da D3 (`b.atualizado_em < r.started_at`) é intencionalmente conservadora: um borderô finalizado DEPOIS do início da última ingestão continua descontando alocações do saldo até a próxima ingestão reler `valorPermutar` (ADR-0046 §Consequências linhas 179-184: "O saldo fica **subestimado** por até ~6h"). Isso é o sentido seguro, mas não há sonda que diga "esta janela ficou aberta X borderôs por Y horas" — o time descobre pelo cliente, se descobre.

- **Melhoria Proposta**
  > Sonda `probe-guarda-frescor-permutas.ts` (ou métrica no `LogService`) que emita, por ingestão: (a) `count(*) FROM permuta_bordero WHERE atualizado_em > (last started_at)` — quantos borderôs vivos entraram na "janela de subestimação"; (b) `avg(now() - b.atualizado_em) WHERE b.bor_vld_finalizado = 1 AND b.atualizado_em > r.started_at` — quanto tempo em média. Tactic Bass: **Observability of integration failures** (faceta moderna).

- **Resultado Esperado**
  > O time detecta janelas anormais (> 12h) antes do cliente. Um bug futuro que "esqueça" de bumpar `atualizado_em` quando a situação muda de fato dispara alarme. Métrica: dashboard com 2 séries (contagem + duração) publicada.

- **Tactic alvo**: Observability of integration failures (Bass, faceta moderna)
- **Severidade**: P2
- **Esforço estimado**: M (2–5d)
- **Findings relacionados**: F-integrability-1 (mesma coluna, faceta diferente)
- **Métricas de sucesso**:
  - Sondas de janela de subestimação em produção: 0 → 1
  - Dashboards ou alertas para "borderôs com `atualizado_em > started_at`": 0 → 1
- **Risco de não fazer**: janela conhecida (documentada na ADR) fica sem sensor; se o bumping quebrar por outro caminho de escrita futuro, o saldo superestima silenciosamente e libera super-alocação — o sentido perigoso.
- **Dependências**: nenhuma; pode ir depois do `[integrability-1]` (o COMMENT ON COLUMN dá a fundação semântica).

### [integrability-3] Colocar `listConsumosFinalizados` sob teste que asserte cada uma das 5 cláusulas de filtro em CI (blindar 4-way JOIN)

- **Problema**
  > A nova query `PermutaExecucaoRepository.listConsumosFinalizados` (`:186-206`) une 4 tabelas com 5 cláusulas críticas de filtro (`dry_run=false`, `status IN`, `bor_vld_finalizado=1`, `bor_cod_estornado IS NULL`, `atualizado_em < started_at`). Cada uma corresponde a uma decisão do ADR-0046 §D3 (uma execução conta como "consumida pelo ERP"). O teste atual asserta 4/5 (falta assertion explícita do NULL do adiantamento parametrizado como isolado). Uma migration futura que renomeie qualquer coluna dessas 4 tabelas quebra a semântica sem que o teste unitário devolva erro claro se a assertion do WHERE for débil.

- **Melhoria Proposta**
  > (a) Complementar `PermutaExecucaoRepository.test.ts:505-529` com **5** asserções mínimas de cláusula (não só 4), + 1 caso positivo/negativo por cláusula (borderô cancelado NÃO conta; execução `error` NÃO conta; borderô estornado NÃO conta; borderô visto pós-ingestão NÃO conta; execução `dry_run=true` NÃO conta). (b) Adicionar `contract.test.ts` que rode a query contra uma fixture Postgres real (`docker compose up postgres-test`) — a mesma técnica que o `ReconciliacaoPermutaService.test.ts` já usa em partes. Tactic Bass: **Contract testing**.

- **Resultado Esperado**
  > Qualquer mudança de nome de coluna em `permuta_bordero`, `permuta_adiantamento`, `permuta_eleicao_run` ou `permuta_alocacao_execucao` que quebre o filtro dispara test-fail com evidência clara ("a cláusula X sumiu do SQL"). Métrica: 5/5 cláusulas críticas com assertion regex de SQL + ≥ 1 caso positivo/negativo cada.

- **Tactic alvo**: Contract testing (Bass, faceta moderna)
- **Severidade**: P3
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-integrability-2
- **Métricas de sucesso**:
  - Cláusulas de filtro asseridas em teste: 4/5 → 5/5
  - Casos positivos/negativos por cláusula: variado → ≥1 cada
- **Risco de não fazer**: baixo — o teste atual é bom, é uma blindagem de "N+1 anos". Mas o custo é hora, cabe no follow-up.
- **Dependências**: nenhuma.

## 6. Notas do agente

- **Escopo real**: correção de regra que ATRAVESSA 3 pontos internos do domínio (Gate 2/3 da elegibilidade, roteamento de cliente-filtro, `saldoRestante`/teto do `alocar`) e 1 mudança semântica em coluna de cache. Zero superfície externa nova. Score 8.0 (subida de 6.5 do ciclo anterior) reflete: (a) duas abstrações compartilhadas extraídas em vez de duplicadas (`ToleranciaResiduo` + `SaldoAlocacaoAdiantamentoService`); (b) `sumByAdiantamento` deletado limpo (0 callers órfãos); (c) validador AO VIVO usa código de produção; (d) wire do Conexos intocado. O que puxa para baixo: a mudança de `atualizado_em` in-place sem `COMMENT ON COLUMN` é a mesma classe de F-integrability-1 do ciclo anterior — herança que precisa virar política.
- **Cross-QA para o consolidator**:
  - F-integrability-1 (semântica de `atualizado_em`) tem overlap com **Fault Tolerance** e **Availability**: a guarda de frescor É a estratégia anti-super-alocação. Overlap com **Modifiability** também: mudar a política de "quando bumpar" exige tocar 2 métodos SQL.
  - F-integrability-4 (SaldoAlocacaoAdiantamentoService) e F-integrability-3 (ToleranciaResiduo) reforçam positivamente o que **Modifiability** vai medir como "single source of truth". Não são débitos — são melhorias.
  - F-integrability-5 (validator com funções de produção) toca **Testability**: é o padrão que o repo já adotou (`validate-conciliacao-retorno-v1.ts`, `validate-retomada-remessa-v1.ts`). Vale registrar como "boa prática do repo, mantida".
- **Não medível localmente**: consumidores externos de `permuta_bordero.atualizado_em` (mesma limitação do ciclo anterior). Nenhum inventário publicado.
