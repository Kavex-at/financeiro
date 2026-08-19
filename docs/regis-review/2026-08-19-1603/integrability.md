---
qa: Integrability
qa_slug: integrability
run_id: 2026-08-19-1603
agent: qa-integrability
generated_at: 2026-08-19T16:03:00-03:00
scope: backend + frontend
score: 7.5
findings_count: 6
cards_count: 6
---

# Integrability — Regis-Review

## 1. Cenário Geral (Bass General Scenario aplicado ao nf-projects)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Time do ERP Conexos / analista de suporte | PV-07 fecha (acesso à tela `fin103` é liberado) e a Frente V precisa trocar a fonte de leitura de "1 chamada por título" para "varredura paginada da tela unificada" | `TrilhaAprovacaoGatewayInterface` (`domain/interface/aprovacoes/ports.ts`) + binding em `aprovacoesContainer.ts` + `ConexosAprovacoesClient` | Produção, com ~23.6k títulos/12m só na filial 2 e histórico já ingerido no Postgres local | Trocar a implementação do port sem tocar em `IngestaoAprovacoesService`, `AprovacoesPainelService`, `routes/aprovacoes.ts`, `jobs/ingest-aprovacoes.ts`, nem no frontend | ≤ 1 arquivo novo (`Fin103TrilhaGateway.ts`) + 1 LOC em `aprovacoesContainer.ts:27`. Zero LOC em service/repository/route/UI. Tempo de "escrita da nova implementação → primeira chamada verde no HML" ≤ 1d dev |

> Cenário irmão (regressão): a Conexos renomeia `titVld1libera → titVld1Libera` em `fin026/infoTitulo` (armadilha #4 do doc de integração) — a página do painel deve **falhar de forma alta e observável** (500 na rota), nunca renderizar `INDETERMINADO` calado. Hoje a resposta é lida direto como `PagedRaw<FinTituloBloqRow>` (`ConexosAprovacoesClient.ts:76,109`), sem Zod — a queda cai em `EtapaStatusResolver` como valor `undefined`, silenciosa.

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| # clients com verbo HTTP genérico exposto (`get`/`post`/`request`) | 0 | 0 | ✅ | `grep -n "public " src/backend/domain/client/Conexos*Client.ts` (só nomes de domínio: `listUniverso`, `listTrilha`, `listar`, `homologar` etc.) |
| Public methods do `ConexosAprovacoesClient` | 2 (`listUniverso`, `listTrilha`) | ≤ 4, todos domínio | ✅ | `ConexosAprovacoesClient.ts:59,100` |
| `import 'axios'`/`fetch(` em `service`/`repository` | 0 | 0 | ✅ | `grep -rn "^import.*axios\|fetch(" src/backend/routes src/backend/domain/service src/backend/domain/repository` (matches em `.test.ts` apenas) |
| `process.env.*` em `domain/service` | 0 | 0 | ✅ | `grep "process\.env\." src/backend/domain/service` (nenhum) |
| `process.env.*` em `domain/client` fora de `EnvironmentProvider` | 1 (`BcbClient.ts:123` — fallback CDI) | 0 | ⚠️ | mesmo comando; único no delta cross-frente |
| Serviços com >3 colaboradores injetados (candidatos a orquestrador) | 2 (`IngestaoAprovacoesService`=8, `AprovacoesPainelService`=4) | ≤ 5 sem orquestração assíncrona | ⚠️ | `grep -c "@inject" src/backend/domain/service/aprovacoes/*.ts` |
| Ocorrências de Zod no `ConexosAprovacoesClient.ts` | **0** | ≥ 1 por response shape (paridade com irmãos) | ❌ | `grep -c "z\.\|from 'zod'" src/backend/domain/client/ConexosAprovacoesClient.ts` |
| Ocorrências de Zod em `ConexosSispagClient` / `ConexosExtratoClient` / `ConexosNdeClient` (irmãos) | 10 / 10 / 4 | — | ✅ (baseline) | `grep -c "z\." src/backend/domain/client/Conexos{Sispag,Extrato,Nde}Client.ts` |
| Ocorrências de Zod em `src/frontend/lib/aprovacoes.ts` | **0** (mesmo padrão dos outros libs FE) | ≥ 1 no boundary (`fetchAprovacoes`, `fetchTrilha`) | ❌ | `grep -c "zod\|z\.object\|z\.string" src/frontend/lib/aprovacoes.ts` |
| API versionada em URL (`/v1`, `/v2`) — Conexos | 0 | N/A — provedor não expõe versão | N/A | `grep -rn "/v[0-9]\|api-version" src/backend/domain/client` — nenhum, e não há versão pública |
| Client Conexos com teste que casa resposta contra fixture real (probe/HAR) | 0/9 (todos usam dublê `montar()` inline) | ≥ 1 para clients dependentes de shape do ERP | ⚠️ | `ConexosAprovacoesClient.test.ts:19-32` (dublê inline); mesmo padrão em irmãos |
| Test explicitando "read-only surface" via reflexão | 1 (`ConexosAprovacoesClient.test.ts:154-170`) | — (assertividade nova, boa prática) | ✅ (positivo) | idem |
| # de LOC para trocar o gateway do port quando PV-07 fechar | 1 (`aprovacoesContainer.ts:27`) + 1 arquivo novo | ≤ 3 LOC + 1 arquivo | ✅ | inspeção manual: `IngestaoAprovacoesService.ts:62-63` injeta pelo token, não pela classe |
| Ratio "call-sites HTTP no `app/` FE ÷ wrappers no `lib/`" | 0 / 1 (todas via `apiFetch` em `lib/http.ts`) | 0 / 1 | ✅ | `grep -rn "fetch(" src/frontend/app` = 0; `src/frontend/lib/http.ts:29` centraliza |
| SSM path convention (`/tenants/{env}/{client}/{name}`) | ⚠️ **Não medível localmente** | — | — | não existe `infra/` neste repo (CLAUDE.md §Estado Atual); nenhum SSM real é lido |

> ⚠️ **Não medível localmente**: latência real da varredura `psq014/list + fin026/infoTitulo` em produção; taxa de erro por armadilha #1–#8 do doc de integração. Requer telemetria da run (`AprovacaoIngestaoRunRepository`) em ambiente com dados reais. Recomendação: emitir contador por tipo de erro no `runWithRetry` e persistir amostra em `AprovacaoIngestaoRun.errorMessage` já hoje.

## 3. Tactics — Cobertura no nf-projects

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Encapsulate | `ConexosAprovacoesClient` expõe só `listUniverso` e `listTrilha`; nenhum `get`/`post` vazado; nenhum `axios` cruzando fronteira | ✅ presente | `ConexosAprovacoesClient.ts:47-124`; `grep` em `service/repository` sem `axios`/`fetch` |
| Use an Intermediary | `TrilhaAprovacaoGatewayInterface` como **port**; `IngestaoAprovacoesService` injeta pelo token, não pela classe | ✅ presente | `interface/aprovacoes/ports.ts:34-59`; `IngestaoAprovacoesService.ts:62-63` |
| Restrict Communication Paths | Port deliberadamente **não expõe método de escrita**. Doutrina afirmada no doc do port ("torna a escrita inexpressável") e defendida por teste (`.test.ts:154-170`) verificando que `trocaBloqueio`/`regerarBloqueios`/`aplicarComando` não são propriedades | ✅ presente (exemplar) | `ports.ts:23-45`; `ConexosAprovacoesClient.ts:30-45`; `.test.ts:154-170` |
| Adhere to Standards | Segue o padrão dos irmãos (`Conexos*Client` composta com `ConexosBaseClient`, `runWithRetry`, `ensureSid` implícito, `@singleton()`+`@injectable()`, arrow methods, modifier explícito) | ✅ presente | `ConexosAprovacoesClient.ts:46-58` vs `ConexosSispagClient.ts:97-100`, `ConexosNdeClient.ts:50-52` |
| Abstract Common Services | Auth/retry/paginação/`filCod` header centralizados em `ConexosBaseClient` (`runWithRetry`, `postGeneric`, session shared via `LegacyConexosShape`). Nenhum `performInit`/`tryAcquireLock` duplicado no cliente novo | ✅ presente | `ConexosBaseClient.ts:39-95,167-237`; `ConexosAprovacoesClient.ts:71-93` |
| Discover Service | ⚠️ **N/A no repo local**: sem `infra/` nem SSM. Padrão de descoberta é o adapter legacy (`legacyConexosAdapter`) resolvido no `appContainer`. `bootstrapAppContainer` chama `registerAprovacoesPorts` (`appContainer.ts:73`) | N/A | CLAUDE.md §Estado Atual vs. Alvo |
| Tailor Interface | O port modela DTOs de domínio (`DocPagarRow`, `FinTituloBloqRow`) — não expõe `PagedRaw` bruto do ERP para o service. `filCod` é obrigatório no `listTrilha` (não default), fechando a armadilha #5 | ✅ presente | `ports.ts:37-58`; `ConexosAprovacoesClient.ts:100-119` |
| Configure Behavior | Janela de emissão (`emissaoDesde` epoch ms) e paginação são parâmetros; `orderList` é imposto por default. Não há feature flag por endpoint — trade-off consciente | ✅ parcial | `ConexosAprovacoesClient.ts:59-93` |
| Manage Resources | Retry em leitura via `runWithRetry`; `listTrilha` é 1 chamada por título (custo O(N) reconhecido no comentário); job compensa com retomada (`AprovacaoIngestaoRunRepository`) | ✅ presente | `ConexosAprovacoesClient.ts:98-119`; `IngestaoAprovacoesService.ts:31-33` |
| Orchestrate | `IngestaoAprovacoesService` orquestra 8 colaboradores sincrônicos (`@inject`=8), fluxo linear em batch, sem event bus/SQS. Aceitável para o job batch mas concentra a cascata de troca | ⚠️ parcial | `IngestaoAprovacoesService.ts:59-73` |
| Manage Resource Coupling | Cada frente registra os próprios ports em container isolado (`aprovacoesContainer.ts` idempotente); no-op quando já registrado | ✅ presente | `aprovacoesContainer.ts:24-32` |
| Contract Testing | Teste do client é *behavioral mock* (dublê inline `montar()`), não *contract test* contra fixture real do Conexos. Doc `ontology/integrations/conexos-aprovacao-trilha.md` cataloga 8 armadilhas verificadas, mas as sondas (`probe-aprovacoes-*.ts`) não emitem fixtures reusáveis pelo teste | ⚠️ parcial | `ConexosAprovacoesClient.test.ts:19-32`; `src/backend/jobs/probe-aprovacoes-trilha.ts` |
| Versioning strategy | Conexos não expõe versão de API; a estratégia é *change detection via boundary schema*. Como o boundary não tem schema no cliente novo (0 Zod), qualquer renomeação silenciosa vira `undefined` a jusante | ❌ ausente | `ConexosAprovacoesClient.ts:76,109` (cast direto, sem `.parse`) |
| Backward-compatibility shims | O port foi desenhado para acomodar 2 backends (hoje `psq014+fin026`; amanhã `fin103`) sem shim intermediário — o próprio port já é o shim | ✅ presente (proativo) | `ports.ts:20-34`; `aprovacoesContainer.ts:16-27` |
| Observability of integration failures | `RetryExecutor` loga; `AprovacaoIngestaoRunRepository.finalizar` grava `errorMessage`. Não há contador por *tipo* de armadilha (epoch/grafia/`filCod` errado devolveria `count:0` mudo — sem sinal negativo) | ⚠️ parcial | `IngestaoAprovacoesService.ts:66-68`; armadilha #5 do doc de integração |

## 4. Findings (achados)

### F-integrability-1: `ConexosAprovacoesClient` não valida o boundary com Zod — divergência do padrão dos irmãos

- **Severidade**: P1
- **Tactic violada**: Versioning strategy · Contract Testing · Tailor Interface (parcial)
- **Localização**: `src/backend/domain/client/ConexosAprovacoesClient.ts:76-93,109-119`
- **Evidência (objetiva)**:
  ```
  Zod occurrences per client (grep -c "z\.\|from 'zod'"):
    ConexosAprovacoesClient.ts  = 0   ← Frente V
    ConexosNdeClient.ts         = 4
    ConexosSispagClient.ts      = 10
    ConexosExtratoClient.ts     = 10
    ConexosBaixaClient.ts       = 14
    ConexosFin014Client.ts      = 17
    ConexosNdeFiscalClient.ts   = 40
    ConexosGerDocProcessoClient.ts = 62
  ```
  Trecho crítico:
  ```ts
  // ConexosAprovacoesClient.ts:76
  this.base.postGeneric<PagedRaw<DocPagarRow>>(ENDPOINT_UNIVERSO, { ... })
  // cast tipado, sem .parse — se `docCod` deixar de existir ou virar string, o TS não sabe
  ```
- **Impacto técnico**: qualquer das 8 armadilhas verificadas (`ontology/integrations/conexos-aprovacao-trilha.md`) que reapareça no futuro — em especial a #4 (grafia varia por endpoint: `titVld1Libera` vs `titVld1libera`) — atravessa como `undefined` e desce ao `EtapaStatusResolver` como valor sem legenda, virando `INDETERMINADO` silencioso. O painel continua servindo respostas, mas contamina o "tempo médio" que é justamente o número que a Frente V vende.
- **Impacto de negócio**: painel financeiro auditável que troca alto-e-observável (500 na rota) por erro silencioso (lacuna "explicada") — o oposto da doutrina declarada em `constants.ts:74-78` ("aparecer como indeterminado é honesto"). O `INDETERMINADO` foi projetado para o **conhecido** (`ftbVldStatus=7`, PV-01); reciclá-lo para o desconhecido dilui o sinal.
- **Métrica de baseline**: `Zod count = 0` no client novo vs. `média 20.9` nos 8 irmãos que consomem shape do Conexos. Divergência de 100% no atributo, sem justificativa técnica registrada.

### F-integrability-2: Frontend replica tipos/dicionário do backend sem contrato compartilhado nem validação Zod

- **Severidade**: P1
- **Tactic violada**: Tailor Interface · Adhere to Standards · Versioning strategy
- **Localização**: `src/frontend/lib/aprovacoes.ts:24-108` (enums + `LACUNA_DESCRICAO`); `:245-291` (`fetchAprovacoes`); `:301-335` (`fetchTrilha`)
- **Evidência (objetiva)**:
  ```ts
  // src/frontend/lib/aprovacoes.ts:33-38
  export type StatusWorkflow =
    | 'SEM_WORKFLOW' | 'AGUARDANDO' | 'APROVADO' | 'REJEITADO' | 'INDETERMINADO'
  // → espelho manual de STATUS_WORKFLOW em backend/interface/aprovacoes/constants.ts:19-25

  // :44-49 — mesmo espelho para LACUNA (backend/constants.ts:87-93)
  export type Lacuna =
    | 'STATUS_ETAPA_DESCONHECIDO' | 'SEM_DATA_FINALIZACAO'
    | 'ETAPA_SEM_RESPONSAVEL' | 'TIMESTAMPS_INCONSISTENTES' | 'ACAO_ETAPA_DESCONHECIDA'

  // :52-63 — dicionário LACUNA_DESCRICAO copiado literalmente
  ```
  E na chamada:
  ```ts
  // :266 — cast, sem .parse
  const json = (await res.json()) as Partial<AprovacoesListResponse>
  ```
- **Impacto técnico**: adicionar uma `LACUNA` nova no backend (esperado quando PV-01/PV-02/PV-04 fecharem) NÃO quebra o build do FE, mas cai em `descreverLacuna` no default `?? codigo` (`:83`). O código bruto (`STATUS_ETAPA_DESCONHECIDO_V2`) aparece como texto na UI. Idem para status: `switch` incompletos passam silenciosos.
- **Impacto de negócio**: drift assintomático entre backend e FE — o pior modo de falha de contrato num painel *auditável*: o valor aparece renderizado (não faltando), sem que quem sustenta o produto perceba o dessincronia. Custo marginal de correção multiplica: uma migração em backend exige varrer o FE inteiro para encontrar espelhos.
- **Métrica de baseline**: **3 enums** e **1 dicionário** copiados por cópia no FE; **0 arquivos** de contrato compartilhado; **0 arquivos** de FE validando resposta com Zod (o mesmo padrão vale para `lib/recebimentos.ts` — dívida cross-frente, mas o delta da V não fecha nem no próprio delta).

### F-integrability-3: Teste do client é *behavioral mock*, não *contract test* — armadilhas do doc de integração sem lastro em fixture real

- **Severidade**: P2
- **Tactic violada**: Contract Testing
- **Localização**: `src/backend/domain/client/ConexosAprovacoesClient.test.ts:19-32,109-153`; probes em `src/backend/jobs/probe-aprovacoes-{fin026,trilha}.ts`
- **Evidência (objetiva)**:
  ```ts
  // .test.ts:19-32 — dublê inline; postGeneric devolve o que o teste mandar
  const montar = (resposta: unknown = { count: 0, rows: [] }) => {
      const base = {
          ensureSid: async () => undefined,
          runWithRetry: async <T>(fn) => fn(),
          postGeneric: async (path, body, opts) => {
              chamadas.push({ path, body, opts });
              return resposta; // ← shape controlada pelo teste, não pelo ERP
          },
      };
      ...
  }
  ```
  `ontology/integrations/conexos-aprovacao-trilha.md` lista 8 armadilhas verificadas na produção; nenhuma delas está reproduzida como fixture no teste (a bateria só cobre o *request*, não a *resposta shape-drifted*).
- **Impacto técnico**: se o Conexos alterar a projeção (ex.: `ftbTimBloq` passa a vir como string ISO, ou `ftbVldStatus` inclui valor `3` novo), o teste continua verde. A regressão só aparece em produção via `INDETERMINADO` silencioso (agrava o F-1).
- **Impacto de negócio**: um *contract test* dedicado (fixture + Zod) custa horas e captura ~80% das armadilhas #1–#8 documentadas — o esforço já foi feito em outros clients (ver `ConexosNdeFiscalClient.ts` = 40 usos de Zod).
- **Métrica de baseline**: 0/9 clients Conexos com fixture-based response test; probes produzem output em stdout, não em `test/fixtures/aprovacoes/`. Doc de integração cataloga 8 armadilhas → 0 delas viram teste automático.

### F-integrability-4: `IngestaoAprovacoesService` orquestra 8 colaboradores sincronamente — cascata de troca alta

- **Severidade**: P2
- **Tactic violada**: Orchestrate · Manage Resource Coupling
- **Localização**: `src/backend/domain/service/aprovacoes/IngestaoAprovacoesService.ts:59-73,75`
- **Evidência (objetiva)**:
  ```
  grep -c "@inject" src/backend/domain/service/aprovacoes/IngestaoAprovacoesService.ts → 8
  ```
  Injeções: gateway, 3 repositories, 3 resolvers (`EtapaStatusResolver`, `StatusWorkflowResolver`, `DuracaoCalculator`) + Logger. Fluxo é linear (`executar` → varre páginas → para cada linha resolve trilha → resolve status → persiste). Não há SQS/EventBridge para desacoplar leitura ERP × persistência.
- **Impacto técnico**: quando `fin103` entrar (PV-07), a fase de **leitura** muda de complexidade (O(N) → O(1) por página). Mas resolvers e repositories continuam iguais. A troca do gateway é 1 LOC; o serviço continua saudável. O risco é a *segunda* troca: se um dia a persistência passar a ser assíncrona (fila), esta classe precisa ser quebrada em 2 (produtor da fila + consumidor). Vale como sinal, não como bloqueio agora.
- **Impacto de negócio**: dívida latente; hoje o job roda em batch e a cascata é aceitável. Vira problema quando/se a Frente V precisar rodar em modo *streaming* (por título assim que o ERP fecha).
- **Métrica de baseline**: 8 `@inject` no `IngestaoAprovacoesService` (limite empírico do repo: `RecebimentosPainelService`=9 é o outro >6). Nenhum event bus no delta.

### F-integrability-5: `filCod` errado devolve `count:0` sem erro — armadilha #5 do doc não tem contramedida ativa no client

- **Severidade**: P2
- **Tactic violada**: Observability of integration failures · Tailor Interface
- **Localização**: `src/backend/domain/client/ConexosAprovacoesClient.ts:98-119`
- **Evidência (objetiva)**:
  ```ts
  // :117-118 — resposta vazia é resposta legítima (título sem trilha)
  return resposta.rows ?? [];
  ```
  Não há discriminação entre "título sem trilha" (semanticamente vazio, esperado) e "consulta com `filCod` errado" (bug — falso negativo mudo). A invariante I5 (`ports.ts:47-52`) é imposta na assinatura (`filCod` obrigatório do chamador), mas nada *observa* a colisão em runtime.
- **Impacto técnico**: se o `IngestaoAprovacoesService` alguma vez injetar `filCod` do lugar errado (ex.: default de sessão), a run inteira grava trilhas vazias sem log, e o painel diz "sem workflow" para toda a base.
- **Impacto de negócio**: o painel *já teve* esse bug na 1ª sondagem (3 títulos em toda a produção — nota no comentário do `ConexosAprovacoesClient.ts:15-19`). Custou uma rodada de investigação; hoje não há telemetria que apitaria se voltasse.
- **Métrica de baseline**: 0 contadores/logs específicos de "resposta vazia inesperada"; 0 asserts pós-condição (ex.: título com `docVldFinalizado=1` do universo NUNCA deveria devolver `rows.length=0` na trilha se as invariantes do ERP valem).

### F-integrability-6: Sem Zod no boundary do frontend — `apiFetch` centraliza *fetch*, mas não *validação*

- **Severidade**: P2
- **Tactic violada**: Tailor Interface (FE) · Backward-compatibility shims
- **Localização**: `src/frontend/lib/http.ts:1-33`; `src/frontend/lib/aprovacoes.ts:266-291`
- **Evidência (objetiva)**:
  ```
  grep -c "zod\|z\.object\|z\.string\|z\.number" src/frontend/lib/aprovacoes.ts → 0
  ```
  `apiFetch` trata 401 (sessão), mas devolve `Response` cru — cada caller faz `res.json() as Partial<T>`. Não há um `apiJson(schema)` que force validação.
- **Impacto técnico**: cada nova rota do FE é livre para consumir a resposta como `any` disfarçado. Onboarding de uma frente futura (ex.: SISPAG UI) herda o mesmo padrão.
- **Impacto de negócio**: mesma classe de drift do F-2, ampliada — a solução é única (`apiJson`) e serve todas as libs. Fazer só na V é sub-ótimo; fazer no `lib/http.ts` custa 1 utilitário e vira convenção do repo.
- **Métrica de baseline**: 0 de 8 libs em `src/frontend/lib/` usam Zod para validar resposta; `apiFetch` retorna `Response` (7 call-sites `res.json() as Partial<T>` só nas libs afetadas pelo delta).

## 5. Cards Kanban

### [integrability-1] Zod no boundary do `ConexosAprovacoesClient` — paridade com irmãos

- **Problema**
  > O client novo da Frente V é o **único** entre 9 clients Conexos que não valida a resposta com Zod (`grep -c z\.` = 0 vs. média 20.9). Grafia divergente por endpoint, `ftbVldStatus` novo, campos `Tim*` como string ISO — todas as 8 armadilhas documentadas em `ontology/integrations/conexos-aprovacao-trilha.md` atravessam como `undefined` e viram `INDETERMINADO` silencioso, contaminando o "tempo médio" que é o valor central do painel.

- **Melhoria Proposta**
  > Adicionar `pagedSchema<Row>` para `PagedRaw<DocPagarRow>` e `PagedRaw<FinTituloBloqRow>` no `ConexosAprovacoesClient.ts` (tactic **Tailor Interface** + **Versioning strategy**). Espelhar o padrão do `ConexosSispagClient.ts:37-73` (`z.preprocess` p/ desembrulhar `.data`, `passthrough` para preservar campos extras). Falhar alto na primeira ocorrência de shape drift; nunca coalescer para `INDETERMINADO`.

- **Resultado Esperado**
  > Uma renomeação/reprojeção do Conexos produz 500 na rota `GET /aprovacoes` (ou erro carimbado na run de ingestão), não linha `INDETERMINADO` na UI. Zod count: 0 → ≥ 6 (paridade com `ConexosNdeClient`).

- **Tactic alvo**: Versioning strategy · Tailor Interface
- **Severidade**: P1
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-integrability-1, F-integrability-3
- **Métricas de sucesso**:
  - Zod occurrences em `ConexosAprovacoesClient.ts`: 0 → ≥ 6
  - # armadilhas do doc que quebrariam o parse em vez de silenciar: 0 → ≥ 5 de 8
- **Risco de não fazer**: em 6 meses o Conexos aplicará uma correção de projeção (histórico do ERP mostra isso); o painel continuará "funcionando" com dado errado, e a descoberta virá do usuário reclamando de número.
- **Dependências**: —

### [integrability-2] Contrato compartilhado backend↔frontend das enums e lacunas da Frente V

- **Problema**
  > Frontend replica por cópia `StatusWorkflow`, `EtapaStatus`, `Lacuna` e o dicionário `LACUNA_DESCRICAO` (`lib/aprovacoes.ts:33-108`, backend em `interface/aprovacoes/constants.ts:19-108`). Adicionar `LACUNA_X` no backend não quebra build do FE, cai em `codigo ?? descreverLacuna` e a UI renderiza o código bruto. Um painel auditável não pode ter dessincronia enum silenciosa.

- **Melhoria Proposta**
  > Extrair `packages/contracts/aprovacoes` (mínimo: só as `const` de status/lacuna e os DTOs) e importar dos dois lados via monorepo path. Como alternativa mais leve, gerar `src/frontend/lib/aprovacoes-contract.generated.ts` a partir do backend no build (tsc project reference ou codegen) e proibir edição manual via lint. Tactic **Adhere to Standards** + **Tailor Interface**.

- **Resultado Esperado**
  > Adicionar uma lacuna nova é 1 edição em `constants.ts` — o FE quebra o build (`switch` incompleto ou `never` no dicionário) até ser atualizado.

- **Tactic alvo**: Adhere to Standards
- **Severidade**: P1
- **Esforço estimado**: M (2–5d)
- **Findings relacionados**: F-integrability-2, F-integrability-6
- **Métricas de sucesso**:
  - Enums Frente V replicadas: 3 → 0
  - Dicionários replicados: 1 → 0
  - Falhas de build por dessincronia detectáveis: 0 → 100% (todo diff em `constants.ts` que não atualize o FE quebra CI)
- **Risco de não fazer**: cada nova PV (PV-01..PV-10) que fechar adiciona lacuna; em 6 meses são 5+ desincronias latentes acumuladas.
- **Dependências**: decisão sobre `packages/` monorepo vs. codegen (arquitetura).

### [integrability-3] `apiJson(schema)` — validação de resposta uniforme no frontend

- **Problema**
  > `apiFetch` (`src/frontend/lib/http.ts:29`) centraliza `fetch` e trata 401, mas devolve `Response` cru. Todos os callers fazem `res.json() as Partial<T>` — nenhum valida a resposta. Zero uso de Zod no `src/frontend/lib/`. Padrão herda para futuras frentes.

- **Melhoria Proposta**
  > Introduzir `apiJson<T>(url, schema, init)` no `lib/http.ts` que faz `apiFetch` + `schema.parse(await res.json())`, com erro `SchemaDriftError` distinto do `SessionExpiredError`. Migrar `fetchAprovacoes`/`fetchTrilha` para o novo helper (2 chamadas). Tactic **Tailor Interface** (FE) + **Backward-compatibility shims**.

- **Resultado Esperado**
  > Toda drift do backend explode no FE com stack específico (não como `undefined.map` a 3 componentes abaixo). Habilita telemetria única de "backend mudou contrato".

- **Tactic alvo**: Tailor Interface · Backward-compatibility shims
- **Severidade**: P2
- **Esforço estimado**: M (2–5d) — o utilitário é S, migrar 8 libs para o padrão é o esforço real
- **Findings relacionados**: F-integrability-6, F-integrability-2
- **Métricas de sucesso**:
  - `res.json() as Partial<T>` no FE: 7 → 0
  - Zod usage em `src/frontend/lib/`: 0 → ≥ 1 por lib
- **Risco de não fazer**: cada nova rota do FE aumenta a superfície de drift silencioso.
- **Dependências**: preferencialmente depois do card `integrability-2` (para reusar os schemas compartilhados)

### [integrability-4] Contract test com fixture real — casar armadilhas do doc de integração ao teste do client

- **Problema**
  > `ConexosAprovacoesClient.test.ts` mocka `postGeneric` inline; a resposta é o que o teste decidir. As 8 armadilhas verificadas em produção (`ontology/integrations/conexos-aprovacao-trilha.md`) não têm reprodução automatizada. Cada armadilha já custou uma investigação; nenhuma protege regressão.

- **Melhoria Proposta**
  > Persistir amostras do `probe-aprovacoes-trilha.ts` em `src/backend/domain/client/__fixtures__/aprovacoes/{universo-psq014.json, trilha-fin026.json, trilha-status7.json}` e adicionar casos em `.test.ts` que carregam a fixture, aplicam o schema Zod introduzido no card `integrability-1`, e asseguram parse verde + valores esperados. Tactic **Contract Testing**.

- **Resultado Esperado**
  > Regressão do Conexos (renomeação, tipo trocado, campo faltando) quebra CI antes de virar linha `INDETERMINADO` no painel.

- **Tactic alvo**: Contract Testing
- **Severidade**: P2
- **Esforço estimado**: S (≤1d) — as sondas já produzem os dados
- **Findings relacionados**: F-integrability-3, F-integrability-1
- **Métricas de sucesso**:
  - Fixtures reais checadas em CI: 0 → ≥ 3
  - Armadilhas do doc reproduzidas em teste: 0 → ≥ 5 de 8
- **Risco de não fazer**: parse silencioso volta como bug de produção; investigação recomeça do zero.
- **Dependências**: card `integrability-1`

### [integrability-5] Sinal negativo para `filCod` errado — armadilha #5 mudável para explícita

- **Problema**
  > `listTrilha` devolve `[]` sem discriminar "título sem trilha" (esperado) de "`filCod` errado" (bug). A doutrina do port impõe `filCod` explícito na assinatura, mas nada observa em runtime. Já causou um bug de "3 títulos no universo" na 1ª sondagem — sem telemetria hoje, voltaria calado.

- **Melhoria Proposta**
  > No `IngestaoAprovacoesService.executar`, contar títulos do universo com `docVldFinalizado != null` cuja `listTrilha` volta `[]`, e emitir contador/alerta se a razão ultrapassar um piso (ex.: >90% dos títulos do universo sem trilha = provável `filCod` cross). Tactic **Observability of integration failures** (per-dependency error rates).

- **Resultado Esperado**
  > A regressão de "filCod errado devolve vazio" é detectada em ≤1 run, não em produção via reclamação de usuário.

- **Tactic alvo**: Observability of integration failures
- **Severidade**: P2
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-integrability-5
- **Métricas de sucesso**:
  - Contador `aprovacoes.trilha_vazia_inesperada` emitido por run: 0 → 1
  - Alerta configurado com piso empírico: 0 → 1
- **Risco de não fazer**: bug de config silencia o painel inteiro por dias.
- **Dependências**: —

### [integrability-6] `process.env` em `BcbClient` — mover fallback CDI para `EnvironmentProvider`

- **Problema**
  > `src/backend/domain/client/BcbClient.ts:123` lê `process.env.BCB_CDI_FALLBACK` direto — únicos `process.env` em `domain/` fora do `EnvironmentProvider` (viola Regra Inviolável #8 de forma discreta, e é o único vazamento cross-frente). Não é do delta da V, mas o Regis-Review não fecha os olhos.

- **Melhoria Proposta**
  > Mover o fallback para `EnvironmentVars` e resolver via `EnvironmentProvider.getEnvironmentVars()`. Tactic **Configure Behavior** (fonte única de truth).

- **Resultado Esperado**
  > `grep -rn "process\.env\." src/backend/domain/client` → 0.

- **Tactic alvo**: Configure Behavior
- **Severidade**: P3
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: métrica da seção 2 (fora do delta V; sinalizado)
- **Métricas de sucesso**:
  - `process.env` em `domain/client`: 1 → 0
- **Risco de não fazer**: dívida técnica pontual; não bloqueia; usada como âncora para relaxar a regra em outras frentes.
- **Dependências**: —

## 6. Notas do agente

- **Boas notícias do delta da V**: o desenho *port-first* com o token `TRILHA_APROVACAO_GATEWAY_TOKEN` + binding num container próprio (`aprovacoesContainer.ts`) cumpre literalmente o cenário de troca do gateway em 1 LOC — `IngestaoAprovacoesService` injeta pelo símbolo (`:62-63`), não pela classe. O teste em `.test.ts:154-170` que valida a **superfície read-only via reflexão** é exemplar e deveria ser padrão dos outros clients Conexos (candidato a `Adhere to Standards` positivo). A doutrina de "escrita inexpressável" no port é uma tactic Bass rara aplicada bem: **Restrict Communication Paths** virada em contrato de tipo.
- **Cross-QA links para o consolidator**:
  - `F-integrability-1` e `F-integrability-3` casam com **Fault Tolerance** (parse silencioso = ausência de fail-fast) e **Security** (validate input at boundary). Recomendar merge de card.
  - `F-integrability-2` casa com **Modifiability** (dessincronia enum é o custo marginal alto quando PV-01..PV-10 fecharem) — flag jointly.
  - `F-integrability-4` casa com **Testability** (fixtures reais aumentam também o índice de teste do client).
  - `F-integrability-5` casa com **Availability** (falso negativo mudo é MTTR alto).
- **Não medível**: SSM convention/discovery — não há `infra/` neste repo. Taxa de erro por armadilha em produção — sem telemetria coletada.
- Score 7.5: base 8.0 pelo desenho do port + shared base client; -0.5 pelo Zod ausente no cliente novo (paridade quebrada com irmãos) e enums replicados por cópia no FE.
