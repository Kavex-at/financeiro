---
qa: Integrability
qa_slug: integrability
run_id: 2026-09-15-1835-permutas-excecao-manual
agent: qa-integrability
generated_at: 2026-09-15T18:35:00Z
scope: backend+frontend
score: 8.5
findings_count: 7
cards_count: 3
---

# Integrability — Regis-Review

## 1. Cenário Geral (Bass General Scenario aplicado ao nf-projects)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Delta `permutas-excecao-manual` (ADR-0047) precisa (a) introduzir uma NOVA configuração de cliente (`ExcecaoPermuta`) no padrão do `ClienteFiltro` (ADR-0007), (b) expor 2 rotas admin (`POST/DELETE /permutas/adiantamentos/:docCod/excecao-manual`), (c) estender o payload de `/permutas/gestao` com uma chave nova (`excecaoManual`) sem quebrar o cliente, (d) acrescentar 1 motivo novo (`permutado-fora-do-painel`) ao union `MOTIVO_BLOQUEIO` sem tocar em constraint de banco de nenhum de seus consumidores externos, (e) NÃO tocar no wire do Conexos (I-Exc-5), e (f) coabitar com a superfície pré-existente de erros da UI (`AlocacaoExcedeSaldoError`, `IngestaoEmAndamentoError`, `SessionExpiredError`) sem redesenhar `apiFetch` | Migration 0059 (nova tabela + índice parcial + 2 CHECKs redefinidas), `ExcecaoPermutaService` transacional (`marcar`/`desfazer`) e puro (`aplicarExcecoes`), pós-passe na eleição, `ExcecaoPermutaRecusadaError` com 5 error codes discriminados, novo campo `excecaoManual` em `PermutaPendente` (BE+FE lockstep), 4 colunas no export Excel, 2 modais + 1 hook no frontend, cliente API `marcarExcecaoManual/desfazerExcecaoManual` + `ExcecaoManualRecusadaError` | `migrations/0059_excecao_permuta.sql` (100 LOC), `domain/service/permutas/ExcecaoPermutaService.ts` (novo, 201 LOC), `domain/repository/permutas/ExcecaoPermutaRepository.ts` (novo, 99 LOC), `domain/errors/ExcecaoPermutaRecusadaError.ts` (novo, 112 LOC), `routes/permutas.ts` (+93 LOC — 2 rotas + `autorDoToken`/`IDENTIDADE_AUSENTE`), `domain/interface/permutas/{ExcecaoPermuta,EstadoElegibilidade,Gestao}.ts`, `domain/service/permutas/{EleicaoPermutasService,GestaoPermutasService,RelatorioExportService}.ts`, `frontend/lib/{api.ts,types.ts}`, `frontend/app/permutas/components/{ExcecaoManualDialog,DesfazerExcecaoDialog,useExcecaoManual,ui.tsx,VisaoGeralTable,format.ts}`, `frontend/app/permutas/page.tsx` | PRD Columbia · backend Express + Postgres/Supabase · frontend Next.js consumindo `GET /permutas/gestao` · robô de ingestão lendo Conexos 3×/dia + botão · JWT verificado é a única fonte de identidade (ADR-0006) | 0 endpoints tocados fora da própria feature · 0 mudanças no `domain/client/*` (`git diff --stat origin/main..HEAD -- src/backend/domain/client` = vazio) · 0 escrita no Conexos (`grep Conexos ExcecaoPermutaService.ts` só em comentário de negação) · 5 error codes discriminados por union tipada (`STATUS_POR_TIPO`, `CODE_POR_TIPO` `Readonly<Record<...>>`) · 1 predicado de guarda (`guardaSatisfeita`) reusado em 3 sites (`aplicarExcecoes`, `marcar`, pós-passe eleição) · 1 chave nova (`excecaoManual`) opcional no payload (BE `Gestao.ts:141` ↔ FE `types.ts:145` sincronizados) · 1 nova constante enum `PERMUTADO_FORA_DO_PAINEL` (backend) refletida em `MOTIVO_LABEL` (frontend) e `ROTULO_MOTIVO` (backend, novo) · 2 probe jobs pré-existentes agregam por `motivo_bloqueio` (auto-adaptáveis: `GROUP BY` gera balde novo sem código) | Custo marginal para adicionar OUTRA "configuração do cliente com trilha de auditoria" (padrão `ClienteFiltro` + agora `ExcecaoPermuta`): **~1 tabela + 1 repo + 1 rota par + 1 modal**, sem tocar em client de ERP. Custo marginal para trocar o Conexos por outro ERP: **não moveu.** Custo marginal para adicionar um 6º motivo à taxonomia: **1 arquivo** (`EstadoElegibilidade.ts`) + rótulo em 2 (BE `ROTULO_MOTIVO`, FE `MOTIVO_LABEL`) |

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Arquivos de `domain/client/*` tocados pelo delta | **0** | 0 | ✅ | `git --no-pager diff --stat origin/main..HEAD -- src/backend/domain/client` = vazio |
| Chamadas novas ao Conexos introduzidas | **0** — `ExcecaoPermutaService` não injeta nenhum `Conexos*Client` (menção literal só em comentário auto-negador `:55`) | 0 | ✅ | `grep -n "Conexos" src/backend/domain/service/permutas/ExcecaoPermutaService.ts` → só `:55` (docblock "Nenhuma escrita no Conexos") |
| Endpoints HTTP públicos adicionados | **2** (`POST` e `DELETE /permutas/adiantamentos/:docCod/excecao-manual`), ambos `requireRole('admin')` | ≤ 2 por feature, RBAC gate 100% | ✅ | `src/backend/routes/permutas.ts:452-514` |
| Error codes novos publicados no wire | **5** discriminados por union TS: `EXCECAO_GUARDA_RECUSADA` (422), `EXCECAO_JA_ATIVA` (409), `EXCECAO_NAO_ENCONTRADA` (404), `ADIANTAMENTO_NAO_ENCONTRADO` (404), `IDENTIDADE_AUSENTE` (401) | ≥ 1 code por statusCode não-200 | ✅ | `ExcecaoPermutaRecusadaError.ts:59-66`; `routes/permutas.ts:444-447` |
| Chaves novas no payload `/permutas/gestao` | **1** (`excecaoManual?: ExcecaoManualDetalhe`, com 4 subcampos), opcional e nomeada em BE e FE de forma idêntica | ≤ 1 chave nova por delta; lockstep BE↔FE | ✅ | `src/backend/domain/interface/permutas/Gestao.ts:141`; `src/frontend/lib/types.ts:145` |
| Contrato BE↔FE — assinatura de `ExcecaoManualDetalhe` | 4 campos: `justificativa: string` · `criadoPor: string` · `criadoEm: string (ISO)` · `ativa: boolean` — MESMOS nomes/tipos em `Gestao.ts:86-96` e `types.ts` | 100% campo/tipo idênticos | ✅ | `diff <(sed -n 86,96p src/backend/domain/interface/permutas/Gestao.ts) <(grep -A5 "ExcecaoManualDetalhe" src/frontend/lib/types.ts)` (nomes casam; JSON serializa `Date→string ISO` em `toExcecaoManual`, `GestaoPermutasService.ts:460`) |
| Chamadas novas ao backend introduzidas na `lib/api.ts` do FE | **2** (`marcarExcecaoManual` `:299-311`, `desfazerExcecaoManual` `:314-322`) — reusam `apiFetch`, `withAuthHeaders`, `encodeURIComponent` | Passar por wrapper único | ✅ | `src/frontend/lib/api.ts:299-322` |
| Classe de erro FE nova, mapeando o contrato de recusa | **1** (`ExcecaoManualRecusadaError`), traduzida por `lancarErroExcecao` que centraliza `Set<[404, 409, 422]>` | 1 classe por família de erro; mapeamento em local único | ✅ | `src/frontend/lib/api.ts:274-294` |
| Consumidores de `motivo_bloqueio` fora do painel/eleição (grep excluindo `permutas/*` de produção) | **2** (probes `probe-impacto-narrativa.ts:43-52`, `probe-impacto-verificacao.ts:45-51`) — ambos fazem `GROUP BY motivo_bloqueio`, então o motivo novo cai num balde sem código | 0 leitor que faça CASE/switch por motivo específico fora do painel | ✅ | `grep -rn "motivo_bloqueio\|motivoBloqueio" src/backend --include="*.ts" \| grep -v permutas \| grep -v .test.` = 4 hits, todos em 2 probes descartáveis |
| Rótulo pt-BR do motivo — cópias (BE + FE) | **3** (novo): `ROTULO_MOTIVO` em `ExcecaoPermutaRecusadaError.ts:14-27` (BE, `Record<MotivoBloqueio,string>`), `MOTIVO_LABEL` em `format.ts:110-123` (FE, `Record<string,string>` — mais frouxo), `ExcecaoPermutaRecusadaError.ROTULO_ESTADO` `:30-37` (só estado) | ≤ 1 mapa por camada; adicionar motivo/estado exige tocar N sites | ⚠️ | `grep -rn "'permutado-fora-do-painel'\|'sem-saldo-permutar'.*:.*'" src/ --include="*.ts" \| grep -v test \| grep -v migration` — 3 sites carregam rótulos por motivo |
| Guarda estreita (I-Exc-1) — pontos onde vive o predicado | **1** (`ExcecaoPermutaService.guardaSatisfeita` `:74-75`), reusado 3× (`aplicarExcecoes:89`, `marcar:123`, docblock `:47`) | 1 fonte única | ✅ | `grep -n "guardaSatisfeita" src/backend/domain/service/permutas/ExcecaoPermutaService.ts` (1 def + 2 usos internos) |
| Tabelas novas no schema | **1** (`permuta_excecao_manual`) + 2 CHECKs redefinidas idempotentes em `permuta_adiantamento` e `permuta_candidata_snapshot` (guarda 0055 estendida) | ≤ 1 tabela nova, redefinição por `DROP+ADD` idempotente | ✅ | `src/backend/migrations/0059_excecao_permuta.sql:41-93` |
| FK entre `permuta_excecao_manual` e `permuta_adiantamento` | **0** (sobrevive a `stale=true` e à recarga da ingestão), decisão documentada no cabeçalho da 0059 | Nenhuma FK entre config-do-cliente e cache da ingestão (precedente `cliente_filtro`, `permuta_alocacao`) | ✅ | `src/backend/migrations/0059_excecao_permuta.sql:23-28`; precedente `0013_cliente_filtro.sql`, `0014_permuta_alocacao.sql` |
| Zod no boundary de rota | **1** (`excecaoManualBodySchema` `:169-171`, `justificativa` `trim().min(10).max(500)` — casa com `char_length BETWEEN 10 AND 500` da 0059) | 100% de POST com body validado no boundary | ✅ | `src/backend/routes/permutas.ts:166-171` |
| Contract tests de rota (backend) | **10 casos** (`describe('exceção manual de permuta')` `:625-790`): 200 POST/DELETE, 400 body inválido (3 formatos), 401 sem auth, 401 sem identidade no JWT, 403 RBAC, mapeamento serviço→wire de 422/404/409, 404 sem exceção ativa | ≥ 1 por statusCode + 1 por code | ✅ | `src/backend/routes/permutas.test.ts:625-790` |
| Contract tests de cliente (frontend) | **6 casos** — URL `/permutas/adiantamentos/:docCod/excecao-manual`, método POST/DELETE, `content-type`, `Authorization` bearer, body sem autor, mapeamento `it.each([422, 409, 404])` → `ExcecaoManualRecusadaError.message == body.message`; `encodeURIComponent(docCod)` | ≥ 1 por statusCode de negócio | ✅ | `src/frontend/__tests__/excecao-manual-api.test.ts` (89 LOC) |
| Contrato HTTP versionado (`/v1/`, `Api-Version`) | **ausente** (herança pré-existente do ciclo anterior — `docs/regis-review/2026-09-15-0207-permutas-saldo-ordem-centavos/integrability.md`, mesma dívida) | delta não piora | ⚠️ (pré-existente) | `grep -rn "'/v[0-9]'\|api-version" src/backend/routes` = 0 |
| `process.env` cru em service/repo introduzido pelo delta (Rule #8) | **0** — nenhum `process.env` nos novos arquivos | 0 em service/repo | ✅ | `grep -rn "process.env" src/backend/domain/service/permutas/ExcecaoPermutaService.ts src/backend/domain/repository/permutas/ExcecaoPermutaRepository.ts src/backend/domain/errors/ExcecaoPermutaRecusadaError.ts` = 0 |
| Identidade do autor — divergência do precedente `cliente-filtro` | **1** (novas rotas rejeitam com 401 `IDENTIDADE_AUSENTE` `:437-447,462-465,492-494`; `cliente-filtro` `:303` e outros 8 sites do mesmo arquivo aceitam `'unknown'`) — hardening deliberado (ADR-0047 §D1 / I-Exc-4), padrão NÃO extraído para utilitário | Padrão consistente, extraído se reusado em ≥ 2 features | ⚠️ | `grep -n "req.user?.sub ?? req.user?.email ?? 'unknown'\|autorDoToken" src/backend/routes/permutas.ts` (10 sites `'unknown'` × 2 sites `autorDoToken`) |
| Frontend distingue `IDENTIDADE_AUSENTE` (401) de sessão expirada | **não** — `apiFetch` intercepta TODO 401 e lança `SessionExpiredError` antes do `lancarErroExcecao` ver o body | 401 com `error: IDENTIDADE_AUSENTE` não pode ser confundido com JWT expirado | ⚠️ | `src/frontend/lib/http.ts:28-35` (early return `throw new SessionExpiredError()`), `src/frontend/lib/api.ts:274-294` (`lancarErroExcecao` só lida com 404/409/422) |
| Migration reverse necessária | **0** — a 0059 só `CREATE TABLE`/`CREATE INDEX` + `DROP+ADD CHECK` (idempotente), fora do escopo de `migrations/rollbacks/README.md` (>1000 linhas de UPDATE) | Reverse quando `UPDATE > 1.000` linhas | ✅ | `src/backend/migrations/0059_excecao_permuta.sql:26-28`; `migrations/rollbacks.test.ts:44-46` inalterado |
| Terraform/infra tocado | ⚠️ **Não medível** — repo `financeiro` não tem `infra/` (deploy Render/Vercel) | — | ⚠️ | `_shared-metrics.md:78` |

> ⚠️ **Não medível localmente**: (a) consumidores externos da coluna `permuta_adiantamento.motivo_bloqueio` (dashboards BI, planilhas Metabase da Columbia que consultam a Supabase direto), mesma limitação dos ciclos anteriores — sem `docs/api/CONTRACTS.md` publicado; (b) latência real do modal em produção com 8.7k adtos ativos (o `listAtivas` roda 1×/carregamento de tela); (c) fração de exceções que ficam INATIVAS em produção (I-Exc-2 — cálculo venceu) — sem sonda por adto, só `BUSINESS_WARN` livre em log.

## 3. Tactics — Cobertura no nf-projects

### Limit Dependencies

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Encapsulate | A regra "quando a exceção pode existir/ser aplicada" (I-Exc-1) vive **em UM predicado** `guardaSatisfeita(estado, motivo)` e é chamada de 3 sites (pós-passe da eleição, `marcar` na rota, aviso na `aplicarExcecoes`). As 2 constantes `ESTADO_DA_GUARDA` e `ESTADO_DA_EXCECAO` no topo do serviço são a fonte única do par (de/para) que a reclassificação usa | ✅ presente | `ExcecaoPermutaService.ts:18-28, 74-75, 89, 123`; `PermutaRelationalRepository.reclassificarAdiantamento:621-641` |
| Use an Intermediary | `ExcecaoPermutaService` é intermediário entre `(rotas + eleição)` e `(ExcecaoPermutaRepository + PermutaRelationalRepository)`. As rotas NÃO tocam repositório direto (diferente do precedente `cliente-filtro`, `:281-315`, que atropela o serviço) — decisão certa porque a operação exige transação, guarda e reclassificação em um único ato | ✅ presente | `routes/permutas.ts:468, 498` → `container.resolve(ExcecaoPermutaService)`; contraste com `:293-307` (cliente-filtro chama `ClienteFiltroRepository` direto) |
| Restrict Communication Paths | Ambas as rotas novas ganham `requireRole('admin')` e entram na lista RBAC de teste (`permutas.test.ts:625-790`). Nenhum cliente API novo do FE bypassa `apiFetch`/`withAuthHeaders` (padrão do repo) | ✅ presente | `routes/permutas.ts:453, 488`; `frontend/lib/api.ts:299-322` |
| Adhere to Standards | Migration 0059 segue a política do repo: `CREATE TABLE IF NOT EXISTS`, `DROP CONSTRAINT IF EXISTS + ADD ... NOT VALID + VALIDATE` (defesa em profundidade), `CREATE UNIQUE INDEX IF NOT EXISTS`, SQL 100% estático, cabeçalho longo explicando "por que tabela e não UPDATE", "por que sem FK", "por que sem reverse", "defesa em profundidade da 0055". SQL 100% parametrizado via `$nome` no SqlBuilder | ✅ presente | `migrations/0059_excecao_permuta.sql:1-93`; `ExcecaoPermutaRepository.ts:28-83` |
| Abstract Common Services | O único serviço compartilhado NOVO é `guardaSatisfeita` (predicado único). O contrato de erro (`ExcecaoPermutaRecusadaError` com discriminated union `tipo` → `code`/`statusCode`) reusa o `HandlerError` já usado por `AlocacaoSaldoError` (precedente `AlocacaoSaldoError.ts`) — mesma família de erro de negócio | ✅ presente | `ExcecaoPermutaRecusadaError.ts:80-84 implements HandlerError`; `ExcecaoPermutaService.ts:74-75` |

### Adapt

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Discover Service | N/A — delta não muda descoberta; a exceção mora em tabela local | N/A | — |
| Tailor Interface | Payload de `/permutas/gestao` ganha 1 chave opcional (`excecaoManual?`), sem rename e sem quebrar o contrato antigo. Frontend tem `Pick<PermutaPendente, 'motivoBloqueio' \| 'excecaoManual'>` em `podeMarcarExcecao`/`tagExcecao` — tailor por USO, não por renomear campo | ✅ presente | `Gestao.ts:141`; `types.ts:145`; `format.ts:135-146` |
| Configure Behavior | Limites 10..500 da justificativa: **hardcoded no domínio**, com espelho na Zod da rota e na CHECK da migration 0059 — decisão certa (limite editorial, não operacional), mas o valor mora em 3 sites (`0059:56` CHECK, `permutas.ts:170` Zod, `ExcecaoManualDialog.tsx:24-25` UI). Constante `JUSTIFICATIVA_MIN/MAX` exportada só do lado do FE | ⚠️ parcial | `0059:56` × `permutas.ts:170` × `ExcecaoManualDialog.tsx:24-25` — 3 cópias do par (10, 500) |
| Manage Resources | `listAtivas()` é chamado 1×/eleição (`EleicaoPermutasService.ts:437`) e 1×/render do painel (`GestaoPermutasService.ts:102`). Set de `docCod` sobre o resultado — O(n) sem N+1. Índice parcial garante 1 ativa por adto sem `SELECT ... FOR UPDATE` | ✅ presente | `EleicaoPermutasService.ts:432-458`; `GestaoPermutasService.ts:82-104`; `0059:66-68` |

### Coordinate

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Orchestrate | `ExcecaoPermutaService.marcar` orquestra `findAdiantamento` (fora da tx) → `guarda` → `findAtiva` (fora da tx) → `withTransaction(insertAtiva + reclassificarAdiantamento)` → catch `23505` → 409. `desfazer` orquestra `withTransaction(softDeleteAtiva + reclassificarAdiantamento)` em um passe, sem reler o adto (soft delete + rowCount 0 na reclassificação são o suficiente — desfazer exceção INATIVA é OK). Log de auditoria fora da tx (autor + docCod, **sem** a justificativa completa) | ✅ presente | `ExcecaoPermutaService.ts:117-179` |
| Manage Resource Coupling | A trava otimista da reclassificação (`WHERE ... AND estado_elegibilidade = $deEstado AND motivo_bloqueio = $deMotivo`) é a barreira contra corrida com a ingestão: 0 linhas → rollback da tx (marcar) ou no-op (desfazer). O par (de, para) vem das constantes no topo do serviço; ambos os sentidos compartilham a MESMA API do repo | ✅ presente | `PermutaRelationalRepository.ts:621-641`; `ExcecaoPermutaService.ts:142-152, 168-176` |

### Facetas modernas

| Faceta | Implementação atual | Status | Evidência |
|---|---|---|---|
| Contract testing (round-trip) | 10 casos backend (`permutas.test.ts:625-790`) cobrindo 200/400/401/403/404/409/422 e mapeamento código→userMessage; 6 casos frontend (`excecao-manual-api.test.ts`) cobrindo URL, método, headers, `encodeURIComponent`, `it.each([422, 409, 404])` para o mapeamento de recusa. Round-trip da chave nova em `GestaoPermutasService.test.ts:1024-1040` (linha 8721 com/sem exceção; ativa/inativa) | ✅ presente | `permutas.test.ts:625-790`; `excecao-manual-api.test.ts`; `GestaoPermutasService.test.ts:1004-1040` |
| Versioning strategy (contrato HTTP) | **inalterado** — dívida herdada; o delta não introduz `Api-Version` nem prefixo `/v1/` | ⚠️ (pré-existente) | ciclo anterior F-integrability-4 |
| Versioning strategy (contrato de motivos/estados) | O motivo novo entra pelo enum `MOTIVO_BLOQUEIO` (backend, `EstadoElegibilidade.ts:108`) refletido em `MOTIVO_LABEL` (FE, `format.ts:122`) e `ROTULO_MOTIVO` (BE, novo em `ExcecaoPermutaRecusadaError.ts:14-27`). `Record<MotivoBloqueio, string>` no BE quebra o build ao adicionar motivo; `Record<string, string>` no FE não — mesmo padrão do ciclo anterior. Migrations 0059:78,90 travam a combinação estado/motivo colapsado por CHECK (defesa em profundidade da 0055) | ✅ presente | `EstadoElegibilidade.ts:108`; `ExcecaoPermutaRecusadaError.ts:14-27`; `format.ts:110-123`; `0059:78,90` |
| Backward-compatibility shims | Payload novo é opcional (`excecaoManual?`), coluna `motivo_bloqueio` segue existindo com o mesmo domínio (novo valor **ADICIONADO** ao union, nenhum removido/renomeado). Um cliente FE antigo lendo `/permutas/gestao` continua funcionando; o painel só perde a tag/botão | ✅ presente | `types.ts:145`; nenhuma `git diff` remove chave em `PermutaPendente`/`ExcecaoManualDetalhe` |
| Observability of integration failures | `logService.info` em `marcar`/`desfazer` (auditoria com `docCod`+autor, sem a justificativa) e `logService.warn` (`BUSINESS_WARN`) por exceção INATIVA por run com mensagem distinta para `transiente` (blip de Conexos) vs "cálculo venceu" (mudou de estado real). Sem métrica agregada de fração de exceções que ficam inativas — o operador descobre pelo log | ⚠️ parcial | `ExcecaoPermutaService.ts:159-165, 178-181`; `EleicaoPermutasService.ts:432-458` |

## 4. Findings (achados)

### F-integrability-1: Wire do Conexos NÃO tocado — feature inteira absorvida pelo domínio (observação positiva)

- **Severidade**: P3 (informativa — modelo do que fazer)
- **Tactic aplicada**: **Encapsulate** — o ponto mais frágil do stack (ERP) fica CONTIDO
- **Localização**:
  - `src/backend/domain/service/permutas/ExcecaoPermutaService.ts:55` (docblock auto-negador)
  - `git --no-pager diff --stat origin/main..HEAD -- src/backend/domain/client` (vazio)
- **Evidência (objetiva)**:
  ```
  $ git --no-pager diff --stat origin/main..HEAD -- src/backend/domain/client
  (vazio)
  $ grep -n "Conexos" src/backend/domain/service/permutas/ExcecaoPermutaService.ts
  55: * Nenhuma escrita no Conexos (I4 / I-Exc-5): não há cliente Conexos injetado.
  ```
  A regra é 100% modelada no banco local (`permuta_excecao_manual`) e a exceção é aplicada em pós-passe puro sobre as candidatas — o Conexos entrega os dados, o domínio decide. I-Exc-5 do ADR-0047 (D6) cumprido por construção.
- **Impacto**: custo marginal para trocar o Conexos por outro ERP não moveu com este delta. Custo marginal para adicionar outra "configuração do cliente com trilha de auditoria" (padrão `ClienteFiltro` + `ExcecaoPermuta`) fica em ~1 tabela + 1 repo + 1 rota par.
- **Métrica de baseline**: 0 arquivos `domain/client/*` tocados · 0 chamadas Conexos novas · 0 escritas no Conexos.

### F-integrability-2: Contrato de erro discriminado por union tipada (observação positiva)

- **Severidade**: P3 (informativa)
- **Tactic aplicada**: **Adhere to Standards** — `HandlerError` reusado, `Record<Tipo, …>` para status e code
- **Localização**: `src/backend/domain/errors/ExcecaoPermutaRecusadaError.ts:38-46, 47-66`
- **Evidência (objetiva)**:
  ```typescript
  export type ExcecaoPermutaRecusa =
      | { tipo: 'guarda'; docCod: string; estado: string; motivo?: string }
      | { tipo: 'concorrencia'; docCod: string }
      | { tipo: 'adiantamento-nao-encontrado'; docCod: string }
      | { tipo: 'excecao-nao-encontrada'; docCod: string }
      | { tipo: 'ja-ativa'; docCod: string };

  const STATUS_POR_TIPO: Readonly<Record<ExcecaoPermutaRecusa['tipo'], number>> = { ... };
  const CODE_POR_TIPO:   Readonly<Record<ExcecaoPermutaRecusa['tipo'], string>> = { ... };
  ```
- **Impacto**: adicionar um 6º motivo de recusa quebra o build **AQUI**, no ponto exato onde a decisão (status + code + mensagem) precisa ser tomada. O ramo `switch` na `mensagem` é exaustivo por união. O FE lê `body.error` (o `code`) e `body.message` — se um code novo for necessário, o FE só precisa adicioná-lo ao `Set<[404, 409, 422]>` (ou mudar de estratégia) sem redesenhar a classe.
- **Métrica de baseline**: 5 codes discriminados por union · 1 statusCode `Record` · 1 code `Record` · 1 `switch` de mensagem por tipo (5 ramos) · 10 casos de teste round-trip em `permutas.test.ts:715-745`.

### F-integrability-3: Guarda I-Exc-1 em UM predicado, reusado 3 vezes (observação positiva)

- **Severidade**: P3 (informativa)
- **Tactic aplicada**: **Encapsulate** + **Abstract Common Services**
- **Localização**: `src/backend/domain/service/permutas/ExcecaoPermutaService.ts:18-28, 74-75, 89, 123`
- **Evidência (objetiva)**:
  ```typescript
  const ESTADO_DA_GUARDA  = { estado: ESTADO_ELEGIBILIDADE.BLOQUEADA,   motivo: MOTIVO_BLOQUEIO.SEM_SALDO_PERMUTAR } as const;
  const ESTADO_DA_EXCECAO = { estado: ESTADO_ELEGIBILIDADE.JA_PERMUTADO, motivo: MOTIVO_BLOQUEIO.PERMUTADO_FORA_DO_PAINEL } as const;

  public guardaSatisfeita = (estado: string, motivo?: string): boolean =>
      estado === ESTADO_DA_GUARDA.estado && motivo === ESTADO_DA_GUARDA.motivo;
  ```
  Usada em (a) pós-passe da eleição (`aplicarExcecoes:89`, decide APLICAR × emitir aviso), (b) `marcar` (linha 123, guarda de gravação), (c) reclassificação (constantes `ESTADO_DA_GUARDA`/`EXCECAO` passadas como `de`/`para` a `reclassificarAdiantamento`).
- **Impacto**: mudar a política ("permite marcar sobre `permuta-manual`?") é uma edição de UMA linha e falha nos 3 sites automaticamente. O FE tem seu próprio `podeMarcarExcecao` em `format.ts:143-146` — cópia intencional (não pode chamar o BE só para saber se o botão aparece), mas com o mesmo predicado literal.
- **Métrica de baseline**: 1 predicado BE · 1 predicado FE (espelho literal, cobertura de `excecao.test.ts:71`) · 3 sites de uso interno · 0 duplicações silenciosas.

### F-integrability-4: Contract tests em ambos os lados do wire, com fixtures de status codes (observação positiva)

- **Severidade**: P3 (informativa)
- **Tactic aplicada**: **Contract testing** (faceta moderna)
- **Localização**:
  - BE: `src/backend/routes/permutas.test.ts:625-790` (10 casos)
  - FE: `src/frontend/__tests__/excecao-manual-api.test.ts` (89 LOC, 6 casos)
  - Round-trip: `src/backend/domain/service/permutas/GestaoPermutasService.test.ts:1004-1040`
- **Evidência (objetiva)**:
  ```
  BE describe('exceção manual de permuta'): 10 it — 200 POST/DELETE, 400 (3 body inválidos),
                                              401 sem auth, 401 sem identidade JWT, 403 RBAC,
                                              422/404/409 mapeamento code→wire, 404 desfazer
  FE it.each([422, 409, 404]): mapeamento status → ExcecaoManualRecusadaError.message == body.message
  ```
- **Impacto**: qualquer mudança silenciosa no code/statusCode/mensagem quebra teste em ambos os lados. A cobertura de `excecaoManual` no payload é testada em `GestaoPermutasService.test.ts`.
- **Métrica de baseline**: 10 casos BE de rota · 6 casos FE de cliente · 6+ casos de payload em `GestaoPermutasService.test.ts` · 100% dos 5 codes de recusa cobertos por teste.

### F-integrability-5: `ROTULO_MOTIVO` (BE) é uma 3ª cópia do rótulo pt-BR de motivos — mesma palavra, 3 mapas

- **Severidade**: P2
- **Tactic violada**: **Abstract Common Services** (a mesma constante literal — string humana pt-BR do motivo — vive em 3 mapas)
- **Localização**:
  - `src/backend/domain/errors/ExcecaoPermutaRecusadaError.ts:14-27` (novo — `Record<MotivoBloqueio, string>`, exaustivo)
  - `src/frontend/app/permutas/components/format.ts:110-123` (pré-existente — `Record<string, string>`, permissivo)
  - `src/backend/domain/errors/ExcecaoPermutaRecusadaError.ts:30-37` (`ROTULO_ESTADO`, mesma família)
- **Evidência (objetiva)**:
  ```typescript
  // ExcecaoPermutaRecusadaError.ts:14-27
  const ROTULO_MOTIVO: Readonly<Record<MotivoBloqueio, string>> = {
      [MOTIVO_BLOQUEIO.PERMUTADO_FORA_DO_PAINEL]: 'Permutado fora do painel (exceção manual)',
      ...
  };
  // format.ts:110-123 (frontend)
  export const MOTIVO_LABEL: Record<string, string> = {
      'permutado-fora-do-painel': 'Permutado fora do painel (exceção manual)',
      ...
  };
  ```
  Docblock do BE literalmente reconhece a duplicação: `"Espelha MOTIVO_LABEL do frontend"`. O tipo `Readonly<Record<MotivoBloqueio, string>>` no BE quebra o build ao adicionar motivo (bom); o `Record<string, string>` no FE não quebra (herança).
- **Impacto técnico**: um motivo novo exige tocar 2 mapas (BE + FE) e o rótulo pode divergir silenciosamente entre a mensagem do 422 (BE) e a tag do painel/tooltip (FE). Se um dia o texto humano precisar de i18n, hoje há 3 pontos para virar `t('permutas.motivo.*')`.
- **Impacto de negócio**: baixo hoje (a divergência não afeta a decisão, só o texto); médio se o painel virar bilíngue (Columbia + parceiro) — cada texto pt-BR requerido em N lugares vira N chances de esquecer um.
- **Métrica de baseline**: 3 mapas com literais pt-BR de motivo/estado · 0 fonte compartilhada · 1 `Record<MotivoBloqueio, string>` exaustivo (bom) × 1 `Record<string, string>` permissivo (frouxo) = risco de divergência assimétrica.

### F-integrability-6: 401 `IDENTIDADE_AUSENTE` do backend é indistinguível de sessão expirada no frontend

- **Severidade**: P2
- **Tactic violada**: **Tailor Interface** — o code novo tem semântica (`JWT válido mas sem sub/email`), mas o cliente HTTP joga fora antes de expor a distinção
- **Localização**:
  - `src/frontend/lib/http.ts:28-35` (early return em 401)
  - `src/frontend/lib/api.ts:274-294` (`lancarErroExcecao` só cuida de 404/409/422)
  - `src/backend/routes/permutas.ts:444-447, 462-465, 492-494` (define o error code)
- **Evidência (objetiva)**:
  ```typescript
  // http.ts:28-35 — TODO 401 vira SessionExpiredError, sem ler body
  export const apiFetch = async (input, init) => {
      const res = await fetch(input, init);
      if (res.status === 401) {
          emitSessionExpired();
          throw new SessionExpiredError();
      }
      return res;
  };
  ```
  ```
  $ grep -n "IDENTIDADE_AUSENTE" src/frontend --include="*.ts" --include="*.tsx" -r
  (0 hits)
  ```
  O BE define `error: 'IDENTIDADE_AUSENTE'` (linha 444), o teste BE cobre o 401 dessa origem (`permutas.test.ts:695-711`), mas o FE nunca lê o body de 401.
- **Impacto técnico**: um analista com JWT válido mas sem `sub`/`email` (JWT degenerado ou identity provider mal configurado) vê o `SessionExpiredModal` e é forçado a re-logar — a re-logagem produz outro JWT igualmente degenerado, e o modal reabre. Diagnóstico só via log server-side. Nenhum modo de dizer ao operador "seu token está sem identidade — chame o suporte".
- **Impacto de negócio**: baixo em regime normal (o Supabase preenche `sub`); médio no dia em que alguém trocar a config do IdP. Sem observabilidade FE, o incidente só aparece por ticket.
- **Métrica de baseline**: 5 error codes definidos no BE · 4 propagáveis ao FE (404/409/422) · 1 (`IDENTIDADE_AUSENTE`, 401) silenciado por `apiFetch` · 0 cobertura FE do 401 com body.

### F-integrability-7: Padrão `autorDoToken` + `IDENTIDADE_AUSENTE` não é utilitário compartilhado — vive inline em `routes/permutas.ts`

- **Severidade**: P2
- **Tactic violada**: **Abstract Common Services** — a decisão "aceito 'unknown' × rejeito 401" precisa ser copy-paste-ready
- **Localização**: `src/backend/routes/permutas.ts:435-447` (definição inline)
- **Evidência (objetiva)**:
  ```
  $ grep -n "req.user?.sub ?? req.user?.email ?? 'unknown'\|autorDoToken" src/backend/routes/permutas.ts
  204: const triggeredBy = req.user?.sub ?? req.user?.email ?? 'unknown';        # ingestão
  238: const triggeredBy = req.user?.sub ?? req.user?.email ?? 'unknown';        # ingestão manual
  303: const criadoPor = req.user?.sub ?? req.user?.email ?? 'unknown';          # cliente-filtro POST
  373: const criadoPor = req.user?.sub ?? req.user?.email ?? 'unknown';          # alocação POST
  437: const autorDoToken = (user?: {…}) => …                                    # NOVO
  462: const criadoPor = autorDoToken(req.user); if (…) 401 IDENTIDADE_AUSENTE   # excecao POST
  492: const removidoPor = autorDoToken(req.user); if (…) 401                    # excecao DELETE
  563: const processadoPor = req.user?.sub ?? req.user?.email ?? 'unknown';      # processar
  # …+ 8 outras rotas com 'unknown'
  ```
  10 rotas com `'unknown'` × 2 rotas com `autorDoToken`. `autorDoToken` mora inline no arquivo, não é exportado, não tem teste próprio.
- **Impacto técnico**: a próxima rota admin que exigir a mesma estritude (I-Exc-4 aplicado a outra feature) vai copiar as 3 linhas de `autorDoToken` + 3 linhas do check + `IDENTIDADE_AUSENTE`. Divergência silenciosa provável (mensagem diferente, code diferente por engano). Dois padrões coabitam no mesmo arquivo sem contrato explícito sobre "qual usar quando".
- **Impacto de negócio**: baixo até uma segunda feature exigir a hardening; então, retrabalho.
- **Métrica de baseline**: 10 sites `'unknown'` × 2 sites `autorDoToken` no MESMO arquivo · 0 utilitário compartilhado exportado · 0 teste específico do `autorDoToken` (a rota é testada, o helper não).

## 5. Cards Kanban

### [integrability-1] Consolidar o rótulo pt-BR de `MotivoBloqueio` em UMA fonte compartilhada BE↔FE (ou congelar a divergência com um teste de conformidade)

- **Problema**
  > O texto humano do motivo vive em 2 mapas (`ROTULO_MOTIVO` novo no BE `ExcecaoPermutaRecusadaError.ts:14-27`, `MOTIVO_LABEL` pré-existente no FE `format.ts:110-123`) e um 3º só de estado (`ROTULO_ESTADO`). O docblock do BE literalmente diz `"Espelha MOTIVO_LABEL do frontend"`. Um motivo novo exige tocar N cópias e o `Record<string, string>` do FE não quebra o build se você esquecer — assimetria de rigor entre os dois lados. Enquanto a lista tem 12 entradas o custo é baixo; num futuro i18n (Columbia + parceiro), cada texto vira N pontos de esquecer.

- **Melhoria Proposta**
  > Duas alternativas: (a) extrair `rotulos-motivo-bloqueio.ts` no BE em `domain/interface/permutas/` como fonte única, servida por endpoint `GET /permutas/rotulos` (o FE já usa `apiFetch` para tudo, custo baixo) e cacheada como constante no bootstrap; (b) mais barato — teste de conformidade em `permutas.test.ts` que carregue `format.ts` (ou uma versão JSON exportada) e afirme `deepEqual(ROTULO_MOTIVO, MOTIVO_LABEL)`. A opção (b) não elimina a duplicação mas fecha a assimetria (`Record<string,string>` frouxo do FE) e falha o CI quando divergem. Tactic Bass: **Abstract Common Services** (a) ou **Contract testing** (b).

- **Resultado Esperado**
  > Um motivo novo exige tocar 1 fonte (a) ou continuar tocando 2 mas com CI travando divergência (b). Métrica: `# de rótulos pt-BR de motivo/estado com fonte única ou teste de conformidade` — 0 → 1 (opção a) ou 0 → 1 teste (opção b).

- **Tactic alvo**: Abstract Common Services (Bass, Limit Dependencies) ou Contract testing (faceta moderna)
- **Severidade**: P2
- **Esforço estimado**: S (≤1d) para (b) · M (2–5d) para (a)
- **Findings relacionados**: F-integrability-5
- **Métricas de sucesso**:
  - Mapas de rótulo pt-BR de motivo com fonte compartilhada: 0 → 1 · OU
  - Teste de conformidade BE↔FE de `MOTIVO_LABEL`/`ROTULO_MOTIVO`: 0 → 1 (falha se algum motivo tem texto diferente)
- **Risco de não fazer**: baixo enquanto o painel for pt-BR-only e o rol de motivos crescer devagar; médio no dia do 1º i18n ou 1º "motivo com nome mudou".
- **Dependências**: nenhuma.

### [integrability-2] Diferenciar 401 `IDENTIDADE_AUSENTE` de sessão expirada no frontend (ou remover o code novo se o UX não usa)

- **Problema**
  > O BE define e testa `error: 'IDENTIDADE_AUSENTE'` (`routes/permutas.ts:444`, cobertura em `permutas.test.ts:695-711`), mas `apiFetch` (`http.ts:28-35`) intercepta TODO 401 e lança `SessionExpiredError` antes que `lancarErroExcecao` (`api.ts:274-294`) veja o body. O operador com JWT válido sem `sub`/`email` vê o modal de sessão expirada, re-loga, ganha outro JWT igualmente degenerado, modal reabre. Diagnóstico só via log server-side. Grep no FE por `IDENTIDADE_AUSENTE` = 0 hits.

- **Melhoria Proposta**
  > Em `apiFetch`, ler o body ANTES do `throw`: se `body?.error === 'IDENTIDADE_AUSENTE'`, lançar `IdentityMissingError` (nova classe) com a mensagem do backend; caso contrário, mantém o `SessionExpiredError` atual. `useExcecaoManual` já tem `isSessionExpiredError` — adicionar `isIdentityMissingError` que mostra `toast.error("Seu token não tem identidade — chame o suporte.")`. Alternativa mais barata: se ninguém vai tratar de fato, **remover o code novo** e voltar `unknown` para as rotas de exceção (violaria I-Exc-4 — decidir com o dono do ADR-0047). Tactic Bass: **Tailor Interface**.

- **Resultado Esperado**
  > Operador com JWT degenerado vê mensagem específica em vez do loop de re-login; incidente aparece em toast, não só em log server-side. Métrica: `codes de erro definidos no BE observáveis no FE`: 4/5 → 5/5.

- **Tactic alvo**: Tailor Interface (Bass, Adapt)
- **Severidade**: P2
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-integrability-6
- **Métricas de sucesso**:
  - Codes 401 distinguíveis no FE: 0 → 1 (`IDENTIDADE_AUSENTE`)
  - Teste FE cobrindo 401 com body específico: 0 → 1
- **Risco de não fazer**: baixo em regime normal (Supabase preenche `sub`); médio em incidente de config de IdP, quando o suporte gasta tempo diagnosticando "por que o modal reabre".
- **Dependências**: alinhar com o dono do ADR-0047 se a alternativa "remover o code" for aceitável.

### [integrability-3] Extrair `autorDoToken` + `IDENTIDADE_AUSENTE` para utilitário compartilhado no `http/auth.ts`

- **Problema**
  > A hardening "autor sempre do JWT, sem `'unknown'`" (I-Exc-4 do ADR-0047) mora inline em `routes/permutas.ts:435-447` e é usada em 2 sites (novas rotas de exceção). No mesmo arquivo, 10 outras rotas admin usam `req.user?.sub ?? req.user?.email ?? 'unknown'` (a2, alocação, processamento, reconciliar, remessa, retorno, boleto, etc.). Uma 3ª feature que precisar da hardening vai copiar `autorDoToken` + `IDENTIDADE_AUSENTE` + o check — 3 chances de divergir (mensagem, code, statusCode). `autorDoToken` não é exportado, não é testado (a rota é testada; o helper não).

- **Melhoria Proposta**
  > Extrair para `http/auth.ts` (perto do `requireRole`) uma função `resolveJwtIdentity(user): string | undefined` + constante `IDENTIDADE_AUSENTE`; opcionalmente um middleware `requireJwtIdentity` que responde 401 automaticamente e injeta `req.identity`. Teste unitário do helper (sub válido, email válido, sub em branco, email em branco, ambos ausentes). Tactic Bass: **Abstract Common Services**. Baixo custo e ideal para reuso — a próxima config de cliente do padrão `ExcecaoPermuta`/`ClienteFiltro` já herda a hardening por default.

- **Resultado Esperado**
  > A próxima rota admin com trilha obrigatória usa `requireJwtIdentity` como usa `requireRole`. Métrica: `sites do padrão hardening `'unknown'`-forbid: 1 (inline) → 1 utilitário compartilhado + N usos`.

- **Tactic alvo**: Abstract Common Services (Bass, Limit Dependencies)
- **Severidade**: P2
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-integrability-7
- **Métricas de sucesso**:
  - Helper `resolveJwtIdentity` exportado e testado: 0 → 1
  - Sites inline de `autorDoToken`: 1 → 0 (migrados para o helper)
  - Testes unitários do helper (5 casos): 0 → 5
- **Risco de não fazer**: baixo até a 2ª feature exigir hardening; então, cópia + divergência prováveis.
- **Dependências**: pode ir junto com [integrability-2] (mesmo arquivo, mesma família de erros).

## 6. Notas do agente

- **Escopo real**: nova config de cliente + 2 rotas + 1 chave opcional no payload + 4 colunas Excel + 2 modais no FE. Score **8.5** (subida de 8.0 do ciclo anterior) reflete: (a) wire do Conexos intocado (I-Exc-5 satisfeito por construção); (b) contrato de erro discriminado e coberto de ponta a ponta; (c) guarda I-Exc-1 em UM predicado; (d) migration 100% idempotente com defesa em profundidade da 0055 no MESMO arquivo (sem editar 0055/0054); (e) BE↔FE lockstep verificável (nomes idênticos de campos). O que segura o 10: F-integrability-5 (3ª cópia do rótulo pt-BR de motivos), F-integrability-6 (401 `IDENTIDADE_AUSENTE` mudo no FE), F-integrability-7 (padrão hardening inline em vez de utilitário) — as 3 são débitos leves de encapsulamento, não bugs.
- **Cross-QA para o consolidator**:
  - **Modifiability**: F-integrability-3 (guarda em UM predicado, constantes `ESTADO_DA_GUARDA`/`EXCECAO`) reforça positivamente o que Modifiability vai medir como "fonte única". F-integrability-5 (3 cópias de rótulo pt-BR) e F-integrability-7 (`autorDoToken` inline) são débitos que também aparecem em Modifiability como "duplicação silenciosa".
  - **Security**: F-integrability-6 (401 `IDENTIDADE_AUSENTE` silenciado) tem overlap com Security (identidade do autor é a base da auditoria I-Exc-4/ADR-0006) — a hardening BE está OK, só a exposição FE é que fica no escuro.
  - **Testability**: F-integrability-4 (contract tests dos dois lados + round-trip de payload) é positivo e vale registrar como padrão a manter em futuras features.
  - **Fault Tolerance**: a trava otimista de `reclassificarAdiantamento` (rowCount 0 → 422/`concorrencia` no marcar; 0 → no-op no desfazer) é uma tactic Bass **Manage Resource Coupling** que Fault Tolerance vai revisitar. Overlap real, mesma linha.
- **Não medível localmente**: consumidores externos de `permuta_adiantamento.motivo_bloqueio` (herança dos ciclos anteriores). Nenhum inventário publicado; os 2 probes internos (`probe-impacto-*`) fazem `GROUP BY motivo_bloqueio`, então são auto-adaptáveis por construção.
