---
qa: Integrability
qa_slug: integrability
run_id: 2026-09-08-1955-permutas-baixa-integridade
agent: qa-integrability
generated_at: 2026-09-08T22:15:00Z
scope: backend
score: 7.5
findings_count: 6
cards_count: 5
---

# Integrability — Regis-Review

> Escopo restrito ao DELTA do commit `8b18686` — remediação de R-1/R-2 do run `2026-09-08-1414-permutas`.
> Integrações reais tocadas: **Conexos ERP** (`com308/financeiroAPagar/list` — leitura; `fin010`
> — handshake de escrita) e **Postgres** (advisory lock + repositório). Não há AWS/SQS/GED
> neste repo; qualquer tactic que dependa desses barramentos é N/A e vem justificada.

## 1. Cenário Geral (Bass General Scenario aplicado ao nf-projects)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Fornecedor Conexos (evolutiva do `com308` ou `fin010`) | Muda o contrato de leitura: renomeia/remove `titMnyTotPago`, passa a devolver `titFltTaxaMneg` como string com locale BR (`"5,0211"`), altera o wire de `pago` de `1/2/3` para `"PAGO"/"PARCIAL"/"ABERTO"`, ou torna `pago` filtrável (destrancando a opção server-side) | `ConexosTitulosClient.listTitulosAPagar` + `ReconciliacaoPermutaService.assertCobertura` (I-Write-8a) + `ConexosBaixaClient` (handshake `fin010`) | Escrita ligada em PRD (137 execuções desde 2026-06-24, R$ 38 M baixados); este delta ainda em branch | Fail-closed em quem grava (Zod barra no boundary; a baixa não sai); derivação de cobertura NÃO regride para falso-positivo; corroboração `pago` continua sendo WARN, nunca gate | 0 baixas duplicadas; 0 baixas aprovadas sobre invoice já quitada; toque de código para adaptar ao novo wire = 1 client + 1 schema (nunca >3 arquivos fora de `client/`) |

Contexto que ancora a severidade: o eixo de risco não é adicionar uma integração nova — é
**absorver mudança de contrato em uma integração já quente**. O delta acrescentou leitura de
`pago` e leitura de `titMnyTotPago` como pivô semântico do I-Write-8a; se qualquer um dos dois
mudar o formato, a pré-checagem que a ADR-0043 acabou de instituir passa a aprovar exatamente o
caso que motivou sua existência.

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Clients tocados no delta | 1 (`ConexosTitulosClient`) — só ganhou 1 campo, sem novo método público | 1 client por integração | ✅ | `git diff --stat HEAD~1 -- src/backend/domain/client/` |
| Métodos públicos genéricos (`get/post/request`) expostos por clients Conexos | 0 no delta; superfície permanece domínio-específica (`listTitulosAPagar`, `criarBordero`, `gravarBaixaPermuta`, `excluirBordero`, `listBaixas`) | 0 | ✅ | `grep -n "public " src/backend/domain/client/ConexosTitulosClient.ts src/backend/domain/client/ConexosBaixaClient.ts` |
| Serviços que resolvem >2 clients Conexos | 1 (`ReconciliacaoPermutaService` injeta `ConexosBaixaClient` + `ConexosTitulosClient`) — orquestrador honesto: um lê contexto (títulos), o outro escreve | ≤2 clients externos por serviço; se >2, considerar anti-corruption layer | ✅ | `grep -c "@inject" src/backend/domain/service/permutas/ReconciliacaoPermutaService.ts` = **11 injects**, dos quais **2** são Conexos |
| `axios`/`fetch` em `service`/`repository`/`routes` da permuta | 0 | 0 | ✅ | `grep -rn "axios\|from 'node:http'" src/backend/domain/service/permutas src/backend/domain/repository/permutas` |
| `process.env.` direto nos módulos do delta | 0 (usa `EnvironmentProvider.getEnvironmentVars`) | 0 | ✅ | `grep -rn "process\.env\." src/backend/domain/service/permutas src/backend/domain/client/ConexosTitulosClient.ts` |
| Zod nas respostas do handshake `fin010` (5 passos) | **2 de 5** (`criarBordero:83` e `gravarBaixaPermuta:479` via `BORDERO_CRIADO_SCHEMA`/`BAIXA_GRAVADA_SCHEMA`); os 3 do meio (`listBaixas`, `excluirBordero`, `excluirBaixa`) e o `com308/list` seguem sem schema | 5/5 nos passos que geram efeito irreversível ou alimentam gate | ⚠️ | `grep -n "SCHEMA\.parse\|z\.object" src/backend/domain/client/ConexosBaixaClient.ts src/backend/domain/client/ConexosTitulosClient.ts` |
| Zod no novo campo `pago` (I-Write-8a corroboração) | 0 — mapeado via `parseOptionalNumber` (`Number.parseFloat` em cima de `String(raw)`), sem enum `1\|2\|3` | Zod `z.union([z.literal(1), z.literal(2), z.literal(3)])` ou `z.coerce.number().int().min(1).max(3)` | ❌ | `ConexosTitulosClient.ts:293` |
| Zod em `titMnyTotPago` (pivô do em-aberto derivado) | 0 — mesmo `parseOptionalNumber`; `Number.parseFloat("1.234,56")` devolve `1.234` (trunca no ponto), então uma resposta em locale BR silenciosamente subestima o pago em ordem de grandeza | Schema numérico com `z.coerce.number().finite()` e teste de fixture com locale BR | ⚠️ | `ConexosTitulosClient.ts:292` + `ConexosBaseClient.ts:356-360` |
| Envelope de paginação (`count`) acessível a `assertCobertura` | 0 — `legacyConexosAdapter.listGeneric` (linha 26-30) já desembrulha `.rows` e descarta `count`; `callList` (base:238) chama `listGeneric` (não `listGenericPaginated`), então a guarda `rows.length !== count` proposta pela ADR é INEXEQUÍVEL do ponto atual sem trocar o pipe | Se a guarda for ativada, `paginate`/`listGenericPaginated` para expor `count` | ⚠️ | `src/backend/domain/client/legacyConexosAdapter.ts:26-33`, `ConexosBaseClient.ts:228-247` |
| Endpoints externos com versão explícita no path/header | 0 do delta (Conexos não usa `/v1/…`; a versão que temos é o swagger `docs/conexos-api/070-com3.json` — versionamento por fixture) | Versão pinada quando o provedor suporta; senão, fixture versionada em repo (feito) | ⚠️ N/A parcial | Conexos não versiona URL; ver `docs/conexos-api/070-com3.json` |
| Contract test com fixture do wire real para `listTitulosAPagar` | 1 (`ConexosSubClients.test.ts:970-988` — fixture com `titMnyTotPago` e `titFltTaxaMneg` do docCod 14042, mas SEM `pago` no wire) | Fixture inclui todos os campos que a ADR-0043 nomeia (`pago` no wire + BR-locale de `titMnyTotPago`) | ⚠️ | `ConexosSubClients.test.ts:970-988,999` |
| Ratio de testes que validam parse de resposta real vs. mock cru | Delta ampliou mocks de resposta mas a única fixture "wire-shaped" já existia no `ConexosSubClients.test.ts`; toda a bateria nova em `ReconciliacaoPermutaService.test.ts:920-980` mocka o RETORNO do client (não o wire), então não pega regressão de parsing | ≥1 fixture wire-real por integração crítica | ⚠️ | `grep -n "'pago'" src/backend/domain/service/permutas/ReconciliacaoPermutaService.test.ts` (2 hits, ambos em nível de client mockado) |
| Cross-boundary contract test FE↔BE (paridade de uniões) | ✅ **presente** — `src/frontend/lib/types.test.ts` lê o arquivo-fonte do backend e compara literais (`ExecucaoStatus`, `PermutaStatusBordero`, `LoteAdiantamentoStatus`); a ADR nomeia isso como a única guarda possível dado que os dois projetos compilam separados | 1 guarda para cada união espelhada | ✅ | `src/frontend/lib/types.test.ts:41-77` |
| Erros tipados encaminhados via `respondHandlerError` (evita achatamento em 500) | ✅ — a rota `POST /reconciliar/:docCod` (routes/permutas.ts:501-522) adotou o helper; `AlocacaoSemCoberturaError` (422) e `ReconciliacaoEmAndamentoError` (409) chegam à analista com `userMessage` em PT, `code` estável, `retryable` | 100% dos erros de negócio novos → contrato preservado | ✅ | `src/backend/http/respondHandlerError.ts:21-32` + `routes/permutas.ts:513-521` |

⚠️ **Não medível localmente**: métricas de "tempo-to-first-call" para uma integração NOVA
não se aplicam a este delta — nada nasceu, uma leitura foi estendida e um handshake ganhou
serialização. Fica registrado como referência de background: a superfície `fin010` levou
5 passos + 2 schemas Zod + 1 executor de retry para ficar de pé (ver `ConexosBaixaClient.ts`
inteiro), o que é o custo de nascimento típico neste repo.

## 3. Tactics — Cobertura no nf-projects

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| **Encapsulate** | O delta preserva a fronteira: `ConexosTitulosClient` continua expondo `listTitulosAPagar`/`getDetalheTitulos`/`listBaixasTitulo` (domain-specific) e nada de `get`/`post` cru. O novo campo `pago` cabe na interface `TituloAPagar` sem vazar o wire | ✅ | `src/backend/domain/client/ConexosTitulosClient.ts:5-77` |
| **Use an Intermediary** | `ConexosBaseClient` é o intermediário — o delta não fura: `listTitulosAPagar` continua via `base.callList` → `RetryExecutor` → `legacyConexosAdapter.listGeneric`. O advisory lock do Postgres é um segundo intermediário (`this.db.withAdvisoryLock`) que serializa por adto no lado do CALLER, não do client | ✅ | `ConexosBaseClient.ts:228-247` + `ReconciliacaoPermutaService.ts:152-170` |
| **Restrict Communication Paths** | Serviço → Client → Base → adapter legado → axios (dentro de `services/conexos.ts`). Nenhum service/repository/route da permuta importa `axios`/`fetch` direto (grep vazio no delta e no baseline dos módulos tocados) | ✅ | `grep -rn "axios" src/backend/domain/service/permutas src/backend/domain/repository/permutas src/backend/routes/permutas.ts` |
| **Adhere to Standards** | Zod nos boundaries CRÍTICOS do handshake (passos 1 e 5) e no `respondHandlerError` do Express. O novo `pago` não adere: entrou como `parseOptionalNumber` sem schema, então o padrão "boundary = Zod" que a ADR-0043 declara como P0 do run anterior está PARCIALMENTE fechado — o delta não regrediu, mas também não estendeu | ⚠️ | `ConexosBaixaClient.ts:20-49` (schemas) vs. `ConexosTitulosClient.ts:293` (parseOptionalNumber sem schema) |
| **Abstract Common Services** | `ensureSid`, `runWithRetry`, `parseOptionalNumber`, `isPago` viveM em `ConexosBaseClient`. Erros de negócio via `HandlerError` + `respondHandlerError` são o padrão compartilhado (agora usado por 3 rotas — sispag, recebimentos, permutas). Duplicação zero no delta | ✅ | `ConexosBaseClient.ts:356-374` + `src/backend/http/respondHandlerError.ts` |
| **Discover Service** | N/A — Conexos e Postgres têm URL/credencial fixa via `EnvironmentProvider`. Não há service registry, não há SSM (repo não tem `infra/`). Aplicável quando a migração AWS materializar SSM | N/A | CLAUDE.md — "Estado Atual vs. Alvo" |
| **Tailor Interface** | O delta faz TAILORING correto: `TituloAPagar` reflete só o subconjunto que a permuta usa — nunca devolve o wire cru. A doc-string do `pago` explica exatamente qual é a semântica autorizada ("corroboração, NUNCA recusa"); o tipo, porém, é `number` liso — nada no compilador impede um caller futuro de tratar como gate | ⚠️ | `ConexosTitulosClient.ts:60-76` |
| **Configure Behavior** | Gate de escrita via `env.conexosWriteEnabled && !env.conexosDryRun` — o delta preserva; `assertCobertura` respeita o toggle porque roda ANTES de qualquer POST. O dryRun override por request funciona (`input.dryRunOverride === true`). Serialização por adto é comportamento CONFIGURÁVEL pela hash da chave — colisão só custa serialização extra, não corretude | ✅ | `ReconciliacaoPermutaService.ts:223-227` + `chaveDeLock:174-180` |
| **Manage Resources** | Advisory lock do Postgres (per-adto) + tentativa ÚNICA nos POSTs irreversíveis + retry só nos GETs. O delta acrescenta `withAdvisoryLock` na entrada do reconciliar — segurança sobre concorrência sem consumo extra de conexão (o lock é sessão-local, reutiliza a pool) | ✅ | `ReconciliacaoPermutaService.ts:152-170` + `PostgreeDatabaseClient.ts:137-155` |
| **Orchestrate** | `ReconciliacaoPermutaService.reconciliarSerializado` orquestra passo-a-passo: descobre alocações → auto-aloca se preciso → guard-rails env → loop por alocação (idempotência → begin → assertCobertura → handshake → markSettled/markParcial) → cleanup de órfão. Nenhuma coreografia por eventos — é síncrono e linear (adequado para a semântica "clique → baixa") | ✅ | `ReconciliacaoPermutaService.ts:182-393` |
| **Manage Resource Coupling** | Serviço injeta 11 dependências (limite superior do razoável; incluí `PostgreeDatabaseClient` só para o advisory lock — decisão explícita, documentada nas linhas 137-139: "no fim da lista de propósito para não quebrar a montagem posicional dos testes"). Nota: um `AdvisoryLockService` extraído reduziria o injectee a 10 e daria ponto de teste isolado | ⚠️ | `ReconciliacaoPermutaService.ts:122-139` |
| **Contract testing** (facet moderno) | 1 contract test FE↔BE (uniões espelhadas — `types.test.ts`); 1 fixture wire-real por `listTitulosAPagar` (mas SEM `pago` na fixture); zero contract test que garanta que `pago ∈ {1,2,3}` no wire | ⚠️ | `src/frontend/lib/types.test.ts` + `ConexosSubClients.test.ts:970-988` |
| **Versioning strategy** (facet moderno) | Conexos não versiona URL. Repo materializou o swagger versionado `docs/conexos-api/070-com3.json` (schema `FinTituloFin`) — versionamento por commit/fixture. O comentário no docblock de `pago` cita a fonte versionada explicitamente | ✅ pragma | `ConexosTitulosClient.ts:63` |
| **Backward-compatibility shims** (facet moderno) | Fallback de título único ("lista vazia ⇒ 1 título com valor cheio") é o único shim — `ReconciliacaoPermutaService.ts:319-322`. O delta explicita o rastro (`titulosDoErp` boolean, C-2) para que a pré-checagem de cobertura NÃO recuse o fallback (que é sintético). Correto por construção | ✅ | `ReconciliacaoPermutaService.ts:296-323` |
| **Observability of integration failures** (facet moderno) | `ConexosError` (endpoint + priCod + cause), `BUSINESS_WARN` para divergência `pago` vs. em-aberto derivado (linha 691-704), `BUSINESS_WARN` para reconciliação bloqueada pelo lock, `BUSINESS_WARN` para parcial, `BUSINESS_WARN` para borderô vazio no órfão. Não há métrica agregada (Prom/CloudWatch) — só logs. `--quick` não avalia se são consumíveis | ⚠️ | Grep `BUSINESS_WARN` em `ReconciliacaoPermutaService.ts` (5 hits novos no delta) |

## 4. Findings (achados)

### F-integrability-1: `pago` entra no client sem validação de domínio (Zod ausente no boundary novo)

- **Severidade**: P1
- **Tactic violada**: Adhere to Standards (padrão "boundary = Zod" declarado como P0 do run anterior e implementado em `ConexosBaixaClient`) + Contract testing
- **Localização**: `src/backend/domain/client/ConexosTitulosClient.ts:293` (mapeamento) + `src/backend/domain/client/ConexosTitulosClient.ts:60-76` (interface)
- **Evidência (objetiva)**:
  ```ts
  // ConexosTitulosClient.ts:293
  const pago = this.base.parseOptionalNumber(r.pago);
  // …
  ...(pago !== undefined ? { pago } : {}),

  // parseOptionalNumber (ConexosBaseClient.ts:356-360)
  public parseOptionalNumber = (raw: unknown): number | undefined => {
      if (raw === null || raw === undefined || raw === '') return undefined;
      const n = typeof raw === 'number' ? raw : Number.parseFloat(String(raw));
      return Number.isFinite(n) ? n : undefined;
  };
  ```
  A interface declara `pago?: number` (não `1 | 2 | 3`). Nada barra `pago === 7`, `pago === 0` ou string `"PAGO"` (que vira `NaN` → `undefined`, silencioso). Comparar com `ConexosBaixaClient.ts:20-49`, onde `BORDERO_CRIADO_SCHEMA` e `BAIXA_GRAVADA_SCHEMA` fazem parse estrito.
- **Impacto técnico**: Se o Conexos mudar o wire de `pago` (int → string, `1/2/3` → `"PAID"/"PARTIAL"/"OPEN"`, ou expandir o enum), a única evidência será o `BUSINESS_WARN` do `assertCobertura` NÃO disparar mais. A corroboração morre em silêncio; o eixo ortogonal `titVldStatus`↔`pago` que a ADR-0043 acabou de instituir volta a ser invisível.
- **Impacto de negócio**: baixo/moderado. O uso atual é warn-only (`t.pago === 1 ⇒ log`), então não bloqueia nem aprova baixa indevida. Mas o valor da corroboração é DETECÇÃO PRECOCE de divergência de contrato — é justamente o que perdemos se o wire mudar em silêncio. Custo de PR de correção: 1 schema em 1 arquivo, ~8 linhas. Não fazer significa que a próxima mudança de contrato do ERP nos alcança em produção, com a analista.
- **Métrica de baseline**: **0 schemas Zod em `ConexosTitulosClient.ts`** (`grep -c "z\.object\|SCHEMA\.parse" src/backend/domain/client/ConexosTitulosClient.ts` = 0), contra **2 schemas Zod** em `ConexosBaixaClient.ts` (o irmão do handshake).

### F-integrability-2: `titMnyTotPago` é o pivô da cobertura derivada e passa por `Number.parseFloat` locale-cego

- **Severidade**: P1
- **Tactic violada**: Adhere to Standards + Manage Resource Coupling (acoplamento oculto a um formato numérico específico) + Contract testing
- **Localização**: `src/backend/domain/client/ConexosTitulosClient.ts:292` (mapping) + `ConexosBaseClient.ts:356-360` (helper) + `ReconciliacaoPermutaService.ts:687-689` (uso na cobertura)
- **Evidência (objetiva)**:
  ```ts
  // ReconciliacaoPermutaService.ts:687-689 (assertCobertura)
  const abertoUsd = round2(t.usd - (t.pagoBrl ?? 0) / t.taxa);
  cobertura = round2(cobertura + abertoUsd);

  // helper compartilhado — locale-cego
  const n = typeof raw === 'number' ? raw : Number.parseFloat(String(raw));
  ```
  `Number.parseFloat("1.234,56")` → `1.234` (trunca no `,`). `Number.parseFloat("R$ 1.234,56")` → `NaN`. Não há nada no `parseOptionalNumber` que rejeite representações não-canônicas — silenciosamente coerce e segue.
- **Impacto técnico**: Se o Conexos flipar `titMnyTotPago` para BR-locale (o cliente é BR, o ERP tem tenants BR — não é hipótese absurda), `pagoBrl` cai ordens de magnitude, `abertoUsd = usd − 1.234/taxa ≈ usd`, e a cobertura resulta ≈ `Σ face` — **exatamente o cenário que motivou a ADR-0043**. O caso do doc 9320 (face USD 83.476,12, aberto 0) passaria de novo. Nem string nem NaN levantam.
- **Impacto de negócio**: **crítico condicional**. A ADR institui `assertCobertura` como fail-closed pré-POST — a razão de ser é recusar baixa de invoice já quitada. Se o pivô numérico do invariante silenciosamente concorda com "0 pago" para qualquer representação não-inteira, o invariante volta a aprovar exatamente o defeito que ele foi construído para barrar. Escrita PRD já é R$ 38 M/2,5 meses. Um pull request de correção é curto: schema Zod com `z.union([z.number().finite(), z.string().transform(...normalizado...)])` + fixture. Não fazer significa que o invariante depende de um contrato NÃO DECLARADO com o fornecedor.
- **Métrica de baseline**: **0 fixtures wire-real com locale BR** em `ConexosSubClients.test.ts:970-988` (fixtura usa `2032384.41` — ponto). Único teste de parsing existente pressupõe formato US. A sonda `probe-com308-cobertura.ts` observou 22 títulos com formato US-numérico — amostra enviesada por definição (só invoices que já passaram pela nossa baixa).

### F-integrability-3: cobertura Zod no handshake `fin010` continua 2 de 5

- **Severidade**: P2
- **Tactic violada**: Adhere to Standards (parcialmente fechada) — este é o mesmo `int-4` que o run anterior deixou como P1 parcial. O delta acrescentou UM read novo (`listTitulosAPagar` com `pago`) que também caberia com Zod, mas manteve o assimétrico
- **Localização**: 5 pontos do handshake — `ConexosBaixaClient.ts:83` (com Zod), `ConexosBaixaClient.ts:141-193` (`listBaixas`, sem Zod), `ConexosBaixaClient.ts:226-234` (`excluirBordero`, sem Zod), `ConexosBaixaClient.ts:214-224` (`excluirBaixa`, sem Zod), `ConexosBaixaClient.ts:479` (com Zod), `ConexosTitulosClient.ts:244-311` (`listTitulosAPagar`, sem Zod)
- **Evidência (objetiva)**: `listBaixas` mapeia `bxaCodSeq: Number(r.bxaCodSeq)` (linha 176) e depois filtra `Number.isFinite(b.docCod) && Number.isFinite(b.bxaCodSeq)` — guarda manual, defensiva, mas **não** parse tipado nem enum-check. A superfície `listBaixas` alimenta o `removerBorderoOrfao` (I-Write-7), que decide se APAGA o borderô do ERP. Uma resposta desconhecida do ERP hoje é aceita com filtro `finite` e segue.
- **Impacto técnico**: A decisão de excluir um borderô no ERP depende de o `listBaixas` devolver `[]` — se por um bug o ERP devolver `[{ docCod: null, bxaCodSeq: null }]`, o filtro `finite` derruba a linha e o serviço conclui "sem baixas" e APAGA o borderô. A guarda `.filter(finite)` é lenient onde poderia ser strict.
- **Impacto de negócio**: baixo (o cenário exige um bug do fornecedor + null nas duas chaves + borderô que na verdade tem baixa). Documentado como P2 porque o custo de corrigir é 1 schema Zod extra por endpoint (3 endpoints) e o padrão está estabelecido ao lado.
- **Métrica de baseline**: **2/5** passos do handshake com Zod (40%); alvo declarado no run anterior era ≥80% dos passos que geram efeito irreversível ou alimentam decisão fail-closed.

### F-integrability-4: guarda de truncamento inexequível — `count` do envelope é descartado antes de chegar ao caller

- **Severidade**: P2
- **Tactic violada**: Encapsulate (o cliente esconde informação que o caller precisaria para uma guarda defensiva)
- **Localização**: `src/backend/domain/client/legacyConexosAdapter.ts:26-33` (`listGeneric` colapsa `.rows`) + `ConexosBaseClient.ts:228-247` (`callList` chama `listGeneric`, não `listGenericPaginated`) + `ConexosTitulosClient.ts:249-286` (`listTitulosAPagar` usa `callList`)
- **Evidência (objetiva)**:
  ```ts
  // legacyConexosAdapter.ts:26-30
  const data = await svc.authenticatedPost<{ rows?: T } | T>(`/${serviceName}`, body, opts);
  const maybeRows = (data as { rows?: T }).rows;
  return (maybeRows ?? data) as T;
  ```
  O envelope `{count, rows}` do Conexos é desembrulhado uma linha antes do caller — `callList` recebe já `rows`, sem `count`. A ADR-0043 comenta a decisão como "guarda defensiva NÃO implementada" com o critério correto (`rows.length !== count`, **não** `rows.length === pageSize`), mas o critério é irrealizável a partir do ponto atual do pipe: `count` foi jogado fora antes.
- **Impacto técnico**: Se um dia a guarda for ativada, o esforço não é "1 comparação em `assertCobertura`" — é migrar `listTitulosAPagar` de `callList` para `paginate`/`listGenericPaginated`, propagar `count` até a interface do client, e só então comparar. É mais custoso do que a ADR sugere.
- **Impacto de negócio**: baixo agora — a sonda mediu 1–2 títulos por invoice em 22 títulos totais; população real hoje NÃO trunca. Mas a amostra é enviesada (só invoices que já baixamos), e o número de títulos por invoice depende do fornecedor Conexos, não da gente. Ficamos operacionalmente confortáveis até o dia em que uma invoice de multi-parcela chegar. Custo hoje: baixo. Custo se ativar depois: médio.
- **Métrica de baseline**: **0 pontos no pipe** onde `count` da paginação está acessível para `listTitulosAPagar`. Alvo (se implementar): expor `count` como parte do retorno do client (ex.: `{ titulos, envelopeCount }`).

### F-integrability-5: `TituloAPagar.pago` é `number` liso — semântica "corroboração-only" é prosa, não tipo

- **Severidade**: P3
- **Tactic violada**: Tailor Interface (o tipo não conta a história que a doc conta)
- **Localização**: `src/backend/domain/client/ConexosTitulosClient.ts:60-76`
- **Evidência (objetiva)**:
  ```ts
  /**
   * Situação de PAGAMENTO do título (`pago` no wire):
   * `1 TOTALMENTE PAGO · 2 PARCIALMENTE PAGO · 3 NÃO PAGO`
   * …
   * É retornável mas NÃO filtrável … Por isso entra como CORROBORAÇÃO do em-aberto
   * derivado (I-Write-8a), nunca como gate de recusa.
   */
  pago?: number;
  ```
  A doc-string declara `pago ∈ {1,2,3}` e "corroboração, nunca gate". O tipo permite `pago === 42`, `pago === -1`, `pago === 1.5`. Nenhum guard-rail no compilador impede um caller futuro de fazer `if (titulo.pago !== 1) throw` como se fosse gate.
- **Impacto técnico**: superfície suscetível a "cargo-cult adoption" — o próximo desenvolvedor a tocar em cobertura pode "melhorar" transformando a corroboração em gate, e nem o tipo nem os testes barram.
- **Impacto de negócio**: baixo, prevenção. Correção: `pago?: 1 | 2 | 3` na interface, com um schema Zod que rejeita o resto (fecha F-integrability-1 pelo mesmo PR).
- **Métrica de baseline**: **0 union literals** em `TituloAPagar`. Comparar com `PermutaStatus` (`aguardando-finalizacao | parcial-aguardando-finalizacao | finalizado`) — mesmíssimo dono do arquivo, disciplina inconsistente entre superfícies.

### F-integrability-6: colisão de nome `TituloAPagar` entre `ConexosTitulosClient` e `ConexosSispagClient`

- **Severidade**: P3
- **Tactic violada**: Encapsulate (dois shapes distintos com o mesmo nome invocam confusão em refactor)
- **Localização**: `src/backend/domain/client/ConexosTitulosClient.ts:5` (export local para o `com308`) vs. `src/backend/domain/interface/sispag/SispagInterface.ts` (export para o `fin064`, importado em `ConexosSispagClient.ts:8`)
- **Evidência (objetiva)**: dois `TituloAPagar` distintos coexistem — o de permuta tem `valorNegociado`/`taxa`/`pago`; o de sispag tem outros campos. O nome é idêntico. IDE auto-import pode enganar, especialmente em serviços que injetam ambos os clients (não é o caso deste delta, mas `EleicaoPermutasService` injeta `ConexosTitulosClient` e há sispag ao lado).
- **Impacto técnico**: risco de import trocado. TS pega em typecheck se o shape diverge; se um dia convergirem parcialmente, passa silente.
- **Impacto de negócio**: baixíssimo. Renomear um dos dois para `TituloComPagar`/`TituloParaPagamento` seria um PR mecânico (~30 arquivos, mas todo típing local).
- **Métrica de baseline**: **2 tipos com o mesmo nome** em domínios distintos do mesmo bounded context.

## 5. Cards Kanban

### [integrability-1] Introduzir `TituloAPagarSchema` (Zod) em `ConexosTitulosClient.listTitulosAPagar`

- **Problema**
  > O delta acrescentou `pago` e passou a depender criticamente de `titMnyTotPago` (pivô de `assertCobertura`), ambos coerced via `parseOptionalNumber` (`Number.parseFloat` locale-cego). Uma virada de formato do ERP para `"1.234,56"` faz `pagoBrl` colapsar em ordem de grandeza; a cobertura passa a aprovar invoices já quitadas — o defeito exato que a ADR-0043 institui para barrar. `pago === 7` ou `pago === "PAID"` passa como `undefined` sem sinal.

- **Melhoria Proposta**
  > Criar `TITULO_A_PAGAR_SCHEMA = z.object({ titCod: z.coerce.number().int().positive(), titMnyValorMneg: z.coerce.number().finite().optional(), titFltTaxaMneg: z.coerce.number().finite().positive().optional(), titMnyTotPago: z.coerce.number().finite().optional(), pago: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional(), moeCodMneg: z.coerce.number().int().optional(), moeEspNome: z.string().optional() })` e `.parse()` cada row de `listTitulosAPagar` (Adhere to Standards). No mesmo PR, estreitar `TituloAPagar.pago` para `1 | 2 | 3` (fecha F-integrability-5). Adicionar fixture em `ConexosSubClients.test.ts` com locale BR (`"1.234,56"`) e outra com `pago` fora do enum — ambas devem lançar.

- **Resultado Esperado**
  > Um schema Zod em `ConexosTitulosClient.ts`; qualquer variação de formato do ERP para `titMnyTotPago` ou `pago` gera erro no boundary (não `undefined` silencioso). Fixture wire-real com locale BR passa a existir. Cobertura de Zod nos passos do handshake `fin010` sobe de 2/5 para 3/5.

- **Tactic alvo**: Adhere to Standards + Contract testing
- **Severidade**: P1
- **Esforço estimado**: S (≤1d — 1 schema, 1 arquivo, 3 testes)
- **Findings relacionados**: F-integrability-1, F-integrability-2, F-integrability-5
- **Métricas de sucesso**:
  - Schemas Zod em `ConexosTitulosClient.ts`: 0 → ≥1
  - Fixtures wire-real com locale BR em `ConexosSubClients.test.ts`: 0 → ≥1
  - `TituloAPagar.pago` tipo: `number` → `1 | 2 | 3`
- **Risco de não fazer**: em 6 meses, uma evolutiva do fornecedor (locale, ou expansão do enum de `pago`) passa despercebida. A pré-checagem de I-Write-8a — que existe para recusar baixa em invoice quitada — silenciosamente aprova o mesmo defeito que a ADR-0043 documentou como razão-de-ser do gate. Cenário concreto: doc 9320-like (face USD 83.476,12, aberto 0) volta a passar.
- **Dependências**: nenhuma

### [integrability-2] Estender Zod aos 3 passos intermediários do handshake `fin010`

- **Problema**
  > O handshake tem 5 passos: 1 (`criarBordero`) e 5 (`gravarBaixaPermuta`) parseiam com Zod; 2 (`listBaixas`), 3 (`excluirBaixa`), 4 (`excluirBordero`) usam `Number(...)` + `.filter(finite)`. `listBaixas` alimenta a decisão de excluir borderô órfão (I-Write-7) — decisão irreversível no ERP. `excluirBaixa`/`excluirBordero` não têm retorno tipado (só sucesso ou erro), mas o path que consome `listBaixas` decide a partir de shape que não é validado.

- **Melhoria Proposta**
  > `LISTA_BAIXAS_SCHEMA` (array de `z.object({ docCod: z.coerce.number().int().positive(), bxaCodSeq: z.coerce.number().int().positive(), … })`) no retorno de `listBaixas`; o filtro `finite` vira `.parse()` — malformado LANÇA em vez de silenciosamente derrubar (Adhere to Standards). Um schema por endpoint intermediário (podem viver no mesmo arquivo, ao lado dos existentes).

- **Resultado Esperado**
  > Cobertura de Zod no handshake `fin010` sobe de 2/5 para 5/5. `listBaixas` retornando payload malformado ergue `ConexosError` (endpoint declarado), e a limpeza de órfão vira fail-safe REAL, não fail-safe-por-filter-de-`finite`.

- **Tactic alvo**: Adhere to Standards
- **Severidade**: P2
- **Esforço estimado**: S (≤1d — 3 schemas)
- **Findings relacionados**: F-integrability-3
- **Métricas de sucesso**:
  - Passos do handshake com Zod: 2/5 → 5/5
  - `.filter(Number.isFinite)` em resposta do ERP: 1 → 0 (some por causa do parse estrito)
- **Risco de não fazer**: casco de vazio + `listBaixas` retornando shape estranho leva a excluir borderô que TEM baixa. A ADR marca `listBaixas` como fonte da verdade; a fonte da verdade merece Zod. Provavelmente nunca dispara — mas quando disparar, é dinheiro apagado.
- **Dependências**: nenhuma

### [integrability-3] Fixture-based contract test para `listTitulosAPagar` cobrindo `pago` e locale

- **Problema**
  > Toda a bateria nova (`ReconciliacaoPermutaService.test.ts:920-980`) mocka o RETORNO do client — não pega regressão de parsing. O único teste que ataca o wire (`ConexosSubClients.test.ts:970-988`) usa fixture US-locale e não inclui `pago`. Se o ERP mudar o wire, os 1.768 testes passam.

- **Melhoria Proposta**
  > Uma tabela de fixtures em `src/backend/domain/client/__fixtures__/com308-listTitulos-*.json` capturadas em sonda real (formato do que `svc.authenticatedPost` retorna hoje), MAIS variações negativas: `pago: "1"` (string), `pago: 4` (out-of-enum), `titMnyTotPago: "1.234,56"` (BR-locale), `titMnyTotPago: null`. Cada fixture roda contra o parser (via Zod do card 1) e afirma resultado esperado ou throw.

- **Resultado Esperado**
  > Ratio de fixture-based contract tests para clients Conexos críticos: baseline atual 1 (SispagWrite) + 1 (Fin014) + 1 (Titulos com US-locale, sem pago) → 4+ (Titulos com pago + BR-locale + variantes). Contract regression detectável em CI, não em produção.

- **Tactic alvo**: Contract testing
- **Severidade**: P2
- **Esforço estimado**: S (≤1d — carrega o card 1)
- **Findings relacionados**: F-integrability-1, F-integrability-2
- **Métricas de sucesso**:
  - Fixtures wire-real para `listTitulosAPagar`: 1 → ≥4
  - Cobertura de casos negativos (locale, out-of-enum, null) na fronteira: 0 → 3
- **Risco de não fazer**: card 1 fecha o parse mas o teste que garante a estabilidade do parse não existe. Refactor futuro do `parseOptionalNumber` (parece inócuo) pode reintroduzir o defeito sem falhar em CI.
- **Dependências**: **carrega o card [integrability-1]** — o schema tem que existir primeiro para os testes o exercerem.

### [integrability-4] Expor `count` do envelope de paginação para permitir a guarda de truncamento

- **Problema**
  > A ADR-0043 declara a guarda `rows.length !== count` como "defensiva opcional" e deixa a critério do futuro. O critério é irrealizável a partir do ponto atual: `legacyConexosAdapter.listGeneric` (linha 26-30) descarta `count` uma linha antes de `callList` receber o resultado. Ativar a guarda depois exige refactor cascata (adapter → base → client). Amostra atual (22 títulos, 1–2 por invoice) é enviesada — só cobre invoices que já baixamos.

- **Melhoria Proposta**
  > Migrar `listTitulosAPagar` de `callList` para `paginate`/`listGenericPaginated` (que já expõe `{ count, rows }`); adicionar `envelopeCount` no retorno do client e ativar a guarda em `assertCobertura` (`if (envelopeCount !== undefined && titulos.length !== envelopeCount) warn+ conservador`). Encapsulate: o caller decide sobre a informação — sem precisar cavar o adapter.

- **Resultado Esperado**
  > `count` acessível ao caller; guarda de truncamento pronta para ativar sem refactor. Se algum dia uma invoice de multi-parcela chegar (não impossível), a subestimativa de cobertura resulta em WARN em vez de aprovação silenciosa.

- **Tactic alvo**: Encapsulate
- **Severidade**: P2
- **Esforço estimado**: M (2–5d — mexe em 3 camadas do pipe, testes acompanham)
- **Findings relacionados**: F-integrability-4
- **Métricas de sucesso**:
  - Pontos do pipe onde `count` está acessível a `listTitulosAPagar`: 0 → 1
  - Guarda `titulos.length !== envelopeCount` no `assertCobertura`: ausente → presente (warn-only, não recusa)
- **Risco de não fazer**: enquanto a amostra continuar 1–2 títulos, nada quebra. Uma invoice com 3+ parcelas paginada pelo ERP (page-size que ele imponha) resulta em cobertura subestimada — recusa indevida (falha para o lado seguro, mas atrapalha a analista); ou, se a implementação vier depois e mudar o critério para `pageSize === rows.length`, gera falso-positivo (ver medição do run anterior em HML: pedimos 500, veio 50).
- **Dependências**: nenhuma bloqueante — mas o pareamento natural é com o card 1 (mesmo arquivo).

### [integrability-5] Renomear `TituloAPagar` do sispag para eliminar colisão de nome

- **Problema**
  > `TituloAPagar` existe em dois lugares com shapes distintos — o de permuta em `ConexosTitulosClient.ts:5` (campos `valorNegociado/taxa/pago`) e o de sispag em `SispagInterface.ts` (importado em `ConexosSispagClient.ts:8`). Nenhum arquivo cross-importa hoje, mas serviços que injetam ambos os clients existem no mesmo bounded context (ex.: se uma tela de conciliação de recebimentos amanhã tocar em títulos de invoice, o IDE oferece dois `TituloAPagar`).

- **Melhoria Proposta**
  > Renomear o de sispag para `TituloPagamento` ou `TituloComPagar` (Encapsulate — nomes que carregam o subdomínio evitam ambiguidade). PR mecânico, ~30 arquivos, todo em `src/backend/domain/service/sispag`, `repository/sispag`, `interface/sispag`.

- **Resultado Esperado**
  > Um único `TituloAPagar` no repo. Auto-import não oferece dois candidatos.

- **Tactic alvo**: Encapsulate + Adhere to Standards (naming discipline)
- **Severidade**: P3
- **Esforço estimado**: S (≤1d, sed-and-typecheck)
- **Findings relacionados**: F-integrability-6
- **Métricas de sucesso**:
  - Tipos com nome idêntico e shape diferente no bounded context: 2 → 1
- **Risco de não fazer**: bug em potencial num refactor futuro; nada quebra por conta própria.
- **Dependências**: nenhuma. Não faz sentido colar em um `/feature-tweak`; é candidato a hygiene sprint.

## 6. Notas do agente

- **Escopo do gate**: `--quick`, delta-only. Não re-avaliei o run anterior; herdo baselines dele. O commit `8b18686` MELHORA integrability em duas direções (contrato 409/422 preservado até a UI via `respondHandlerError`; contract test FE↔BE via `types.test.ts` que lê o arquivo-fonte do backend) e IGNORA a extensão da tactic "Zod no boundary" ao campo novo — o findings 1, 2 e 3 formam o mesmo cluster.
- **Não medido**: latência de handshake, `npm audit` profundo, cobertura por arquivo (esperado no `--quick`); ver `_shared-metrics.md`. `pageSize` do `com308` observado (50 em HML apesar de pedir 500 — `ConexosGerDocProcessoClient.ts:928-931`) foi lido como referência, não medido de novo.
- **Cross-QA**:
  - **F-integrability-1/2** overlappa com **Security** (validate external input) e **Fault Tolerance** (fail-closed no boundary vs. fail-open silencioso). Se o consolidator vir card equivalente vindo de security-*/fault-tolerance-*, unificar em um único ticket.
  - **F-integrability-3** overlappa com **Modifiability** (o padrão "Zod no boundary" declarado como P0 do run anterior ainda está parcialmente fechado — o mesmo código é o ofensor).
  - **F-integrability-5** é low-priority hygiene; o consolidator pode agrupar com achados de nomenclatura de outros QAs se aparecerem.
- **Decisão de score**: 7.5. O delta é UMA MELHORIA LÍQUIDA de integrability (advisory lock por adto formaliza uma resource-coupling; contract test FE↔BE é ativo raro; erros tipados chegam à UI). Perde ponto porque estendeu o wire do Conexos com um campo novo sem estender a disciplina Zod que a ADR-0043 P0-remediation implicitamente demanda. Não é P0 porque o uso atual do campo é warn-only (`pago === 1 ⇒ log`), não gate — o defeito conceitual está em `titMnyTotPago` (pivô real da cobertura derivada), que é o motivo de finding 2 empatar em P1.
