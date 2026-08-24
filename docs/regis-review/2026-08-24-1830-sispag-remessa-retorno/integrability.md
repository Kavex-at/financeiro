---
qa: Integrability
qa_slug: integrability
run_id: 2026-08-24-1830-sispag-remessa-retorno
agent: qa-integrability
generated_at: 2026-08-24T18:30:00-03:00
scope: backend
score: 5.5
findings_count: 9
cards_count: 8
---

# Integrability — Regis-Review

## 1. Cenário Geral (Bass General Scenario aplicado ao SISPAG)

O SISPAG casa a Columbia com dois contratos externos NÃO estáveis:

1. O ERP Conexos, integrado por endpoints REST cujo corpo/comportamento foi
   descoberto por sondagem (`arquivosRetorno/processar` sem body no OpenAPI;
   `titulosPendentes/importar` com campos de seleção duplicados; `gerarRemessa`
   sem `valid:'SUCESSO'`; `fbeEspCod` recusando `#IN`/`#LIKE`).
2. Um protocolo interativo (`type:'QUESTION'`, `answerList:[YES, ABORT]`) que
   o ERP dispara no meio da chamada em vez de erro.

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Time Conexos (fornecedor do ERP) | Renomeia/remove um campo de seleção em `titulosPendentes/importar` (ex.: `bncCodFin015` → `bncCod`) ou muda o shape de `arquivosRetorno/processar` numa release menor sem changelog público | `ConexosSispagWriteClient.importarTitulos:186-197` · `ConexosSispagRetornoClient.processarArquivoRetorno:154-163` · `RemessaService.montarItensImport:369-434` · `Fin015Write.ts` (DTOs) | Produção, `CONEXOS_WRITE_ENABLED=true`, `CONEXOS_DRY_RUN=false`, remessa disparada pela tela SISPAG | 400 `SELECTION_ERROR` classificado como `CONEXOS_UPSTREAM_REJECTED` (retryable=false) · `RemessaService` marca ledger `error` · lote nativo órfão fica registrado com `native_flp_cod` para descarte manual · surface pt-BR no usuário citando o campo apontado pelo ERP | MTTR ≤ 4 h úteis (localizar 1 client + 1 DTO + o job `execute-fin015-prd` de smoke); 0 remessas duplicadas; 0 lotes órfãos que precisem de suporte Conexos para desfazer |

Cenário derivado (Q protocol): o `titulosPendentes/importar` dispara
`QUESTION` `FIN_041.PESSOA_FAVORECIDA_SEM_CONTA_ATIVA_NO_BANCO_...` porque o
favorecido não tem conta no banco do lote. Hoje o parser de pergunta
(`perguntaDoErp`) SÓ está ligado no `sugerirRemessa`, e essa chamada é POSTERIOR
ao `importar` — logo, a pergunta chega como `ConexosError` genérico e o analista
não recebe o texto/`YES/ABORT` na UI. (F-integrability-3.)

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Clients diretos dos 3 novos endpoints (Sispag/Write/Retorno) | 3 (leitura/escrita/retorno), todos compostos com `ConexosBaseClient` | 1–3, sempre passando por `ConexosBaseClient` | ✅ | `ls src/backend/domain/client/ConexosSispag*.ts` |
| Métodos genéricos leakados fora do client (services/routes chamando `postGeneric/getGeneric`) | 0 (services só usam métodos de domínio: `criarLote`, `importarTitulos`, `gerarRemessa`, `listDetalhe`, ...) | 0 | ✅ | `grep -rn "postGeneric\|getGeneric\|postMultipartOnce" src/backend/domain/service src/backend/routes` |
| Arquivos `service/` ou `routes/` que importam `axios` diretamente | 0 | 0 | ✅ | `grep -rln "from 'axios'" src/backend/domain/service src/backend/domain/repository src/backend/routes` |
| Zod no boundary — clients do delta com validação de payload | 1/3 (`ConexosSispagWriteClient` com `LOTE_CRIADO_SCHEMA`/`SUCESSO_SCHEMA`; `ConexosSispagClient` com 3 schemas ricos; `ConexosSispagRetornoClient` sem Zod) | 3/3 | ⚠️ | `grep -l "from 'zod'" src/backend/domain/client/ConexosSispag*.ts` |
| Fixtures de resposta REAL gravados e re-parseados em teste | 0 fixtures — todos os `.test.ts` do delta usam objetos hand-built em `mockResolvedValue({...})` | ≥1 fixture por endpoint estatful (5+: `titulosPendentes/list`, `titulosPendentes/importar`, `gerArquivosBancos/gerarRemessa`, `arquivosRetorno/list`, `arquivosRetornoDetalhe/list`) | ❌ | `find src/backend -name "__fixtures__" -o -name "fixture*" \| head`; leitura dos 4 `.test.ts` do delta (1088 LOC, nenhum fixture) |
| Versionamento explícito de API do ERP (URL/header) | Ausente — `baseURL = https://columbiatrading.conexos.cloud/api` (sem `/v1`, sem `Accept: application/vnd.conexos.v1`) | Não medível localmente (Conexos não expõe versão), MITIGAÇÃO: pinnar shape em fixture datada | ⚠️ | `sed -n '117-122p' src/backend/services/conexos.ts` |
| Duplicação boundary-error (linhas idênticas entre WriteClient e RetornoClient) | ~35 linhas de `describeConexosValidation`+`toConexosError` copiadas verbatim | 0 (extrair p/ `ConexosBaseClient` ou helper) | ❌ | `diff <(sed -n '61-99p' ConexosSispagWriteClient.ts) <(sed -n '47-81p' ConexosSispagRetornoClient.ts)` |
| Tabelas de tradução (FEBRABAN, MODALIDADE_NATIVA) discoveráveis vs hardcoded | 2 hardcoded no service (`FEBRABAN_POR_BNCCOD` linha 17, `MODALIDADE_NATIVA` linha 20 de `RemessaService.ts`), 1 delas duplicada em `jobs/validate-fin015-import.ts:63` | Discover Service — ler de `cmn025`/tabela do ERP; ou parametrizar via SSM/env | ❌ | `grep -rn "FEBRABAN_POR_BNCCOD" src/backend` |
| Configuração `grbCodSeq` (config de layout de remessa) | Hardcoded `grbCodSeq: 1` em `RemessaService.ts:291` + duplicado em 6 jobs; comentário diz "1 = REMESSA SISPAG - ITAÚ" | Lookup em `gerArquivosBancos/config` (ou `ger015`) por `(bncCod, direção)`, sem constante mágica | ❌ | `grep -rn "grbCodSeq" src/backend` (10 ocorrências) |
| Protocolo `QUESTION` do ERP reconhecido em quantas chamadas de escrita | 1/3 (`sugerirRemessa` só; `importarTitulos` e `gerarRemessa` NÃO tratam, apesar do JSDoc de `importarTitulos:190-193` documentar o `QUESTION` observado) | 3/3 (todo `postGenericOnce` capaz de disparar QUESTION deveria embrulhar) | ❌ | `grep -n "perguntaDoErp\|ErpPerguntaError" src/backend/domain/client/ConexosSispagWriteClient.ts` |
| `gerarRemessa` — teste que garante sucesso sem `valid:'SUCESSO'` (defesa em profundidade documentada no code comment `ConexosSispagWriteClient.ts:326-330`) | 1 teste em `ConexosSispagWriteClient.test.ts` cobre "sem valid → sucesso" (mock, não fixture) | 1 fixture do PG200893.REM (o único caso real, 2026-08-20, flp 26, 1210 chars) parseado no teste | ⚠️ | `grep -n "sucesso: true\|valid" ConexosSispagWriteClient.test.ts` |
| Wrapper único no frontend (Ratio call sites : wrapper) | 6 wrappers em `src/frontend/lib/sispag.ts` (`fetchSispagPainel`, `fetchLotes`, ...); componentes chamam SÓ o wrapper (0 `fetch(`/`axios` em `sispag/**`) | 1 wrapper, 0 chamadas diretas | ✅ | `grep -n "fetch\|axios" src/frontend/app/sispag/page.tsx` (0 hits fora do wrapper) |
| Ledger write-ahead reaproveitável entre integrações não-idempotentes | 2 tabelas quase idênticas: `solicitacao_numerario_execucao` (Recebimentos) + `remessa_execucao` (SISPAG, migration 0049) | 1 abstração compartilhada (ou 2 instâncias de uma template de tabela) | ⚠️ | `cat src/backend/migrations/0049_sispag_remessa_retorno.sql` + `grep -n "solicitacao_numerario_execucao" src/backend/migrations` |
| `CONEXOS_DRY_RUN` isolável por frente (SISPAG independente de Recebimentos/Permutas) | Não — flag global, compartilhada com Permutas e Recebimentos | Flag por frente (`CONEXOS_DRY_RUN_SISPAG` ou similar) | ⚠️ | `grep -rn "conexosDryRun" src/backend/domain` (uso global em 3 frentes) |
| Observabilidade de falhas por integração (per-endpoint error rate) | Não medível localmente — `LogService` grava `CONEXOS_ERROR` genérico, sem dimension `endpoint`/`serviceName` | Contador ou histograma por `endpoint` + status | ⚠️ **Não medível localmente** | `grep -n "CONEXOS_ERROR" src/backend/domain/interface/log/LogInterface.ts` |

## 3. Tactics — Cobertura no SISPAG (Bass canon)

### Limit Dependencies

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Encapsulate | Cada família de endpoint tem seu client (`ConexosSispagClient` para leitura, `ConexosSispagWriteClient` para fin015 write, `ConexosSispagRetornoClient` para fin052). Todos por composição em `ConexosBaseClient`. Métodos são de domínio (`criarLote`, `importarTitulos`, `gerarRemessa`, `listDetalhe`), nunca `post`/`get` cru. | ✅ presente | `src/backend/domain/client/ConexosSispag{,Write,Retorno}Client.ts` |
| Use an Intermediary | `ConexosBaseClient` intermedia autenticação/sessão/retry/HTTP passthrough para 3 sub-clients. Legacy adapter (`legacyConexosAdapter.ts`) mantém a compat com `services/conexos.ts` (v0.1 → v0.2 roadmap). | ✅ presente | `src/backend/domain/client/ConexosBaseClient.ts:135-296` |
| Restrict Communication Paths | Services só chamam clients (`RemessaService` injeta `ConexosSispagWriteClient` + `ConexosSispagClient`; nunca axios). 0 arquivos em `service/`/`repository/`/`routes/` importam axios. | ✅ presente | `grep -rln "from 'axios'" src/backend/domain/service src/backend/domain/repository src/backend/routes` = 0 |
| Adhere to Standards | Sem OpenAPI de retorno (endpoints como `arquivosRetorno/processar` foram descobertos por probing). O que temos versionado em `docs/conexos-api/` está INCOMPLETO na perna que este delta cobre. Sem pinning de versão no URL/header. | ❌ ausente | `python -c "..."` mostrou `arquivosRetorno/processar` sem requestBody; `src/backend/services/conexos.ts:117` → `baseURL` sem versão |
| Abstract Common Services | `describeConexosValidation`+`toConexosError` foram COPIADOS de `ConexosSispagWriteClient` para `ConexosSispagRetornoClient` (~35 linhas iguais). Já é o segundo cliente duplicando; próximo cliente ERP-write vai duplicar de novo. `FEBRABAN_POR_BNCCOD` também está duplicado (RemessaService + validate-fin015-import). | ❌ ausente | `sed -n '61-99p' ConexosSispagWriteClient.ts` = `sed -n '47-81p' ConexosSispagRetornoClient.ts`; `grep -rn "FEBRABAN_POR_BNCCOD"` = 2 definições |

### Adapt

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Discover Service | `sugerirRemessa` DELEGA a numeração de remessa ao ERP (`initialValues` → `{gabNumRemessa, gabEspNomeArquivo}`), com comentário explícito "não inventar esses valores". `listConfigsRetorno` (`ger015`) descobre `gtbCodSeq` por banco. `listContasCorrentes` (`fin005`) descobre a conta pagadora por filial. | ✅ presente (parcial) | `ConexosSispagWriteClient.ts:239-278`; `ConexosSispagRetornoClient.ts:316-345`; `ConexosSispagClient.ts:230-256` |
| Tailor Interface | Interfaces `TituloAPagar`/`LotePagamento`/`ArquivoRetorno` traduzem shape ERP → shape doméstico. Zod parse com `passthrough()` deixa campos crus disponíveis (`raw`) para importar VERBATIM no `titulosPendentes/importar`. | ✅ presente | `Fin015Write.ts:53-67` (TituloPendente.raw); `ConexosSispagWriteClient.ts:164-183` |
| Configure Behavior | Gating via `conexosWriteEnabled`/`conexosDryRun` via `EnvironmentProvider`. Idempotency key por lote (`remessa:${lote.id}`) impede duplicar remessa. `grbCodSeq`, `FEBRABAN_POR_BNCCOD`, `MODALIDADE_NATIVA`, `bncNumCodbanco: 341` (default) HARDCODED — mudar de Itaú para Santander é uma edição de código. | ⚠️ parcial | `RemessaService.ts:17-24, 171, 291, 378, 420` |
| Manage Resources | `RetryExecutor` central (retries=2, delay 500ms, jitter 200ms) para leituras; escritas não-idempotentes usam `postGenericOnce`/`putGenericOnce`/`postMultipartOnce` (tentativa única). Ledger `remessa_execucao` grava progresso etapa a etapa para reprise. | ✅ presente | `ConexosBaseClient.ts:154-166`; `ConexosSispagWriteClient.ts:115` (comment); `RemessaService.ts:230-355` |

### Coordinate

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Orchestrate | `RemessaService.gerarRemessa` orquestra 6 chamadas seriais ao ERP (`listContasCorrentes` → `criarLote` → `listarTitulosPendentes` → `listContasFavorecido` × N itens → `importarTitulos` → `finalizarLote` → `sugerirRemessa` → `gerarRemessa` → `listarArquivosRemessa`), coordenadas com o ledger e o repositório local. Sync (não há SQS/EventBridge para SISPAG). | ⚠️ parcial (orquestrador longo, síncrono; substituir 1 client cascateia mudança no service) | `RemessaService.ts:105-355` |
| Manage Resource Coupling | `ConciliacaoRetornoService` casa retorno ↔ lote SÓ pela chave composta (fil,bnc,flp,its) que o ERP grava no segmento A do CNAB — é a única cola porque o ERP RECICLA `flpCod` e não expõe rastreabilidade lote→borderô. Está codificado no ledger (`native_fil_cod`/`native_bnc_cod`/`native_flp_cod`) e no repo (`findByChaveNativa`). Mas essa disciplina ("nunca use `flpCod` sozinho") é convenção humana — não há linter/type guard. | ⚠️ parcial | `LotePagamentoRepository.ts:460` (comment); `migration 0049` linhas 20-23; `SispagInterface.ts:249` |

### Facets modernos

| Tactic | Implementação atual | Status | Evidência |
|---|---|---|---|
| Contract testing (fixture-based) | 0 fixtures no delta. `ConexosSispagWriteClient.test.ts` (285L) e `ConexosSispagRetornoClient.test.ts` (176L) usam `mockResolvedValue({ ... })` com shapes hand-built. Todo o conhecimento sobre "campos de seleção nos dois níveis" e "sem `valid:'SUCESSO'` = sucesso" está codificado como asserção, mas contra dados fabricados pelo próprio autor do teste. | ❌ ausente | leitura de `ConexosSispagWriteClient.test.ts:84-114`; `find src/backend -name "__fixtures__"` (só existe em `recebimentos/`) |
| Versioning strategy p/ mudanças externas | `baseURL = .../api` sem versão. Sem `Accept-Version`. Nenhum snapshot datado dos payloads observados em produção guardado no repo. Existe uma pasta `docs/conexos-api/` com OpenAPI parciais (090-fin0.json), mas o próprio delta cita gaps ("body ausente do OpenAPI"). | ❌ ausente | `sed -n '117-122p' src/backend/services/conexos.ts`; `python -c` sobre 090-fin0.json |
| Backward-compat shims | `LOTE_CRIADO_SCHEMA` faz `preprocess` para desembrulhar `.data` "quando o Conexos embrulha". `SUCESSO_SCHEMA` aceita `valid?` porque a versão observada em HML às vezes não devolve o campo. Coerções em `ConexosSispagClient` (`numOpt`/`strOpt`/`boolFromFlag`) toleram string↔number↔boolean. Único ponto onde o shim é explícito. | ⚠️ parcial | `ConexosSispagWriteClient.ts:19-35`; `ConexosSispagClient.ts:31-45` |
| Observability de falhas por dependência | `ConexosError` carrega `endpoint`, mas o `LogService` grava tipo `CONEXOS_ERROR` sem dimensão explícita de endpoint/serviceName no schema do log. Não medível localmente (Render não expõe métricas per-tag para o skill). | ⚠️ **Não medível localmente** — requer inspeção do Grafana/Loki configurado no Render | `src/backend/domain/interface/log/LogInterface.ts:14-15` |

## 4. Findings

### F-integrability-1: Conhecimento tácito do contrato ERP mora nos JSDoc, não nos testes

- **Severidade**: P1
- **Tactic violada**: Contract testing (facet moderno); Adhere to Standards
- **Localização**: `src/backend/domain/client/ConexosSispagWriteClient.ts:184-196` · `src/backend/domain/client/ConexosSispagRetornoClient.ts:141-163` · `src/backend/domain/client/ConexosSispagWriteClient.test.ts` (285 LOC, 0 fixtures) · `src/backend/domain/client/ConexosSispagRetornoClient.test.ts` (176 LOC, 0 fixtures)
- **Evidência (objetiva)**:
  ```
  # ConexosSispagWriteClient.ts:184-196 (JSDoc do importarTitulos):
  # "SHAPE PROVADO AO VIVO EM HML (2026-08-20, lote flp 26). O endpoint NÃO recebe um
  #  `FinItemSispag` inteiro: ele projeta um DTO de SELEÇÃO. Quatro campos precisam ir
  #  ao MESMO TEMPO no nível da requisição E dentro de cada item..."
  # "IDENTIDADE: cada item leva a chave VERBATIM do `titulosPendentes/list`..."
  # "O ERP pode responder `{ type: 'QUESTION', answerList: [YES, ABORT] }`..."

  # ConexosSispagWriteClient.test.ts: cobre "dois níveis" com objeto FABRICADO,
  # não com uma captura real do erro `SELECTION_ERROR` que o ERP devolve quando falta.

  $ find src/backend -name "__fixtures__" -type d
  src/backend/domain/interface/recebimentos/__fixtures__   # só Recebimentos tem
  ```
- **Impacto técnico**: A próxima vez que o Conexos alterar (renomear/adicionar/remover) um campo de seleção em `titulosPendentes/importar` (ou o shape de resposta do `gerArquivosBancos/gerarRemessa`, hoje "sem `valid:'SUCESSO'`" documentado como sucesso), o TESTE não pega. Só o job `execute-fin015-prd.ts` rodando em HML/PRD detecta — e ele é operação manual travada por `PERMITIR_PRD=1`.
- **Impacto de negócio**: Uma release menor do ERP (sem changelog público) pode transformar o botão "Gerar remessa" em "cria lote nativo, não importa itens, gera arquivo em branco" — sem sinal automático. Se `CONEXOS_WRITE_ENABLED=true` na hora, é dinheiro parado até a analista notar.
- **Métrica de baseline**: 0 fixtures no delta; 1088 LOC de teste 100% baseado em `mockResolvedValue({...})` com shapes hand-typed. `SELECTION_ERROR`/`VALIDATION_LIST`/`QUESTION` são strings em JSDoc, não asserts contra amostras reais.

### F-integrability-2: `describeConexosValidation` + `toConexosError` duplicados verbatim entre WriteClient e RetornoClient

- **Severidade**: P2
- **Tactic violada**: Abstract Common Services
- **Localização**: `src/backend/domain/client/ConexosSispagWriteClient.ts:61-99` (39 linhas) · `src/backend/domain/client/ConexosSispagRetornoClient.ts:47-81` (35 linhas — a diferença é 1 linha de campo opcional `type?: string` presente só no Write)
- **Evidência (objetiva)**:
  ```
  # Ambos definem o mesmo shape `body = { messages?: [...], itemMessages?: [...] }`
  # com o mesmo parser de `vars.msg` e `item + constraint`, e a mesma
  # `toConexosError = (endpoint, cause) => new ConexosError({ endpoint, cause, message: this.describeConexosValidation(cause) })`.
  # Comentário no Retorno confessa: "Igual ao ConexosSispagWriteClient (duplicado por ora)."
  ```
- **Impacto técnico**: Já são 2 clones. `ConexosNdeClient`, `ConexosBaixaClient` e `ConexosFin014Client` tendem a precisar do mesmo tratamento (todos escrevem no ERP e o ERP sinaliza validação nos mesmos 2 shapes). Cada novo shape de erro do ERP (ex.: `SELECTION_ERROR` mencionado nos comentários mas não coberto no parser) precisa ser adicionado em N lugares.
- **Impacto de negócio**: Divergência silenciosa entre a mensagem que o analista de pagamentos vê e a que o de contas a pagar vê para a mesma classe de erro do ERP. Manutenção duplicada.
- **Métrica de baseline**: ~35 linhas x 2 clients = 70 LOC de código de infra copiado. `git blame` mostra que os dois nasceram na mesma branch — o segundo já nasceu duplicado.

### F-integrability-3: Protocolo `QUESTION` do ERP é reconhecido em 1/3 dos writes; `importarTitulos` documenta o QUESTION observado mas não o trata

- **Severidade**: P1
- **Tactic violada**: Tailor Interface; Restrict Communication Paths (paths de erro)
- **Localização**: `src/backend/domain/client/ConexosSispagWriteClient.ts:203-220` (parser `perguntaDoErp`) · `src/backend/domain/client/ConexosSispagWriteClient.ts:198-201` (JSDoc de `importarTitulos` documenta o QUESTION `FIN_041...`) · `src/backend/domain/client/ConexosSispagWriteClient.ts:245-278` (`sugerirRemessa` usa `perguntaDoErp`) · `importarTitulos` NÃO usa
- **Evidência (objetiva)**:
  ```
  // importarTitulos JSDoc:
  // "⚠️ O ERP pode responder `{ type: 'QUESTION', answerList: [YES, ABORT] }` (ex.:
  //  favorecido sem conta ativa no banco do lote, `FIN_041.PESSOA_FAVORECIDA_SEM_CONTA_
  //  ATIVA_NO_BANCO_MODALIDADE_ALTERADA_TITULO_PROPRIO`). É uma confirmação interativa e
  //  hoje vira erro — tratar no serviço de orquestração antes de ligar a escrita."

  // Mas o `catch` do próprio importarTitulos NÃO chama perguntaDoErp:
  } catch (cause) {
      throw this.toConexosError(path, cause);
  }
  ```
- **Impacto técnico**: Quando o QUESTION dispara no `importarTitulos`, ele vira `ConexosError` genérico ("O ERP Conexos recusou esta operação"). O `ErpPerguntaError` (código `ERP_PERGUNTA` → HTTP 409, texto pt-BR pedindo decisão humana) só sobe pelo `sugerirRemessa`, que é o passo 4 da orquestração — passa DEPOIS do `importar` e do `finalizar`. A perna que mais precisa do tratamento é justamente a que não o tem.
- **Impacto de negócio**: A analista clica "Gerar remessa", recebe "ERP recusou esta operação: FIN_041..." sem opção de YES/ABORT. O lote nativo `flpCod` órfão fica no ERP; ela precisa entrar no Conexos manualmente para desfazer. Sem tratamento, o SISPAG desliga a auto-atendimento.
- **Métrica de baseline**: 1/3 dos endpoints de escrita fin015 tratam QUESTION (só `sugerirRemessa`; `importarTitulos` e `gerarRemessa` não).

### F-integrability-4: Tabelas de tradução (FEBRABAN, MODALIDADE_NATIVA, `grbCodSeq`) hardcoded, duplicadas e sem gate de novo banco

- **Severidade**: P1
- **Tactic violada**: Configure Behavior; Discover Service
- **Localização**: `src/backend/domain/service/sispag/RemessaService.ts:17-24` (`FEBRABAN_POR_BNCCOD` + `MODALIDADE_NATIVA`) · `RemessaService.ts:291` (`grbCodSeq: 1`) · `src/backend/jobs/validate-fin015-import.ts:63` (duplicata do FEBRABAN) · `src/backend/jobs/execute-fin015-prd.ts:60-62` (3ª duplicata) · 6 jobs referenciam `grbCodSeq`
- **Evidência (objetiva)**:
  ```
  // RemessaService.ts:17
  const FEBRABAN_POR_BNCCOD: Record<number, number> = { 3: 1, 4: 341, 7: 237, 10: 33 };
  const MODALIDADE_NATIVA: Record<string, number> = { CREDITO_CONTA:1, TED:1, PIX:1, BOLETO:7 };

  // RemessaService.ts:171
  bncNumCodbanco: FEBRABAN_POR_BNCCOD[bncCod] ?? 341,  // default silencioso para Itaú

  // RemessaService.ts:291
  grbCodSeq: 1,  // "1 = REMESSA SISPAG - ITAÚ" — comentário no interface

  // jobs/validate-fin015-import.ts:63 — MESMA constante literal, cópia
  const FEBRABAN_POR_BNCCOD: Record<number, number> = { 3: 1, 4: 341, 7: 237, 10: 33 };
  ```
- **Impacto técnico**: Adicionar um novo banco à Columbia (`bncCod=15` = Bradesco, por exemplo) exige: (1) editar `RemessaService.ts`, (2) editar `validate-fin015-import.ts`, (3) editar `execute-fin015-prd.ts`, (4) descobrir o `grbCodSeq` correspondente do layout de remessa do Bradesco (que o ERP conhece em `ger015`, mas o service não consulta), (5) atualizar `MODALIDADE_NATIVA` se o novo banco codifica boleto diferente. O `?? 341` (Itaú) mascara o erro: um `bncCod` desconhecido não falha, gera remessa apontando para o Itaú.
- **Impacto de negócio**: Onboarding de banco novo é dias de trabalho de dev, não configuração de operação. Pior: falha silenciosa se o `bncCod` novo não estiver na tabela, com o `.REM` saindo com header errado (que já aconteceu 1x, ver comentário `ContaCorrentePagadora`).
- **Métrica de baseline**: 3 pontos de código com a mesma tabela FEBRABAN literal; 6 jobs com `grbCodSeq` hardcoded; 0 chamadas a `listConfigsRetorno`/`ger015` para descobrir a config de layout REM correspondente.

### F-integrability-5: `arquivosRetorno/processar` — body descoberto empiricamente, sem fixture, sem OpenAPI, sem contrato pinado

- **Severidade**: P1
- **Tactic violada**: Adhere to Standards; Contract testing
- **Localização**: `src/backend/domain/client/ConexosSispagRetornoClient.ts:141-163` · `docs/conexos-api/090-fin0.json` (endpoint listado sem `requestBody`)
- **Evidência (objetiva)**:
  ```
  $ python3 -c "..." docs/conexos-api/090-fin0.json
  put /api/fin052/arquivosRetorno/processar requestBody? False   # <-- SEM requestBody documentado

  // ConexosSispagRetornoClient.ts:141-163 (comentário do processarArquivoRetorno):
  // "Body descoberto ao vivo (ausente do OpenAPI): `{ items: [ chave + tipo ] }`. A chave
  //  fora de `items[]` devolve `SELECTION_ERROR / NENHUM_REGISTRO_SELECIONADO`."
  // "`tipo` é o bind `:TIPO` do PL/SQL de parse: `1` dispara as atualizações..."

  # Teste: usa mockResolvedValue({...}) — não há fixture do payload real que fez o processar
  # funcionar em HML.
  ```
- **Impacto técnico**: `processarArquivoRetorno` é a chamada mais consequente da perna de retorno (grava as BAIXAS no fin010). O contrato só existe na cabeça de quem sondou e num JSDoc. Qualquer mudança no ERP quebra sem sinal.
- **Impacto de negócio**: Se o ERP passar a exigir `{ items:[chave], op:1 }` (paralelo ao `titulosPendentes/importar`), a conciliação para; o retorno fica não-processado; as baixas não são geradas; a contabilidade de pagamento diverge. Sem fixture datada, o time perde horas comparando dois "shapes plausíveis" quando o problema aparecer.
- **Métrica de baseline**: 1 endpoint crítico com 0 documentação externa e 0 fixture no repo; `tipo=1` é um bind PL/SQL cujo semântico é desconhecido além do valor testado.

### F-integrability-6: `flpCod` reciclado — invariante crítica só como convenção humana, sem type guard

- **Severidade**: P2
- **Tactic violada**: Manage Resource Coupling
- **Localização**: `src/backend/domain/repository/sispag/LotePagamentoRepository.ts:460` (comentário) · `src/backend/domain/interface/sispag/SispagInterface.ts:249` (comentário) · `src/backend/migrations/0049_sispag_remessa_retorno.sql:15-22` · `src/backend/domain/service/sispag/RemessaService.ts:296-317` (uso da chave composta ao localizar arquivo)
- **Evidência (objetiva)**:
  ```
  # LotePagamentoRepository.ts:460 (JSDoc):
  # "⚠️ A chave é COMPOSTA (fil, bnc, flp). O ERP recicla `flpCod` de lotes que deixaram
  #  de existir — o número sozinho não identifica nada de forma estável."

  # SispagInterface.ts:249: A chave é COMPOSTA (mesmo comentário)

  # Mas o TIPO `LotePagamento` expõe `nativeFlpCod?: number` como campo INDEPENDENTE
  # dos outros dois. Nada impede que um autor futuro busque `where native_flp_cod = X`
  # em vez de `where (native_fil_cod, native_bnc_cod, native_flp_cod) = (X, Y, Z)`.
  ```
- **Impacto técnico**: A disciplina "sempre buscar pela tupla" é convenção — não há tipo `NativeLoteKey = { filCod, bncCod, flpCod }` que force o consumidor a passar as três. `RemessaService.baixarArquivo` (linha 448) até já quebrou com "o primeiro com conteúdo" antes de corrigir para "busca pelo nome". Próxima função vai cair no mesmo buraco.
- **Impacto de negócio**: Um `.REM` de outro lote/mês foi lido e cancelado por engano em produção (documentado no JSDoc do `baixarArquivo`). O comentário registra o incidente; nada impede a repetição.
- **Métrica de baseline**: 5 arquivos com comentário "recicla flpCod" — 0 tipos/guards que impeçam o uso não-composto.

### F-integrability-7: Ledger write-ahead duplicado entre SISPAG e Recebimentos (2 tabelas quase gêmeas)

- **Severidade**: P3
- **Tactic violada**: Abstract Common Services
- **Localização**: `src/backend/migrations/0049_sispag_remessa_retorno.sql:63-95` (`remessa_execucao`) · `src/backend/migrations/0041_*` (`solicitacao_numerario_execucao`, referenciado no JSDoc do `RemessaExecucao.ts` como "espelha")
- **Evidência (objetiva)**:
  ```
  # RemessaExecucao.ts:6-9 confessa:
  # "Espelha `solicitacao_numerario_execucao` (Recebimentos) porque o problema é o mesmo:
  #  uma sequência de escritas NÃO-idempotentes contra o Conexos."

  # migration 0049 duplica colunas: idempotency_key, correlation_id, status
  # (pending/reconciling/settled/error), dry_run, etapa, request_payload, erp_response,
  # erro_mensagem, executado_por, criado_em, atualizado_em — todas em ambas as tabelas.
  ```
- **Impacto técnico**: Cada nova frente que escreve não-idempotentemente (Fin014 baixa manual, Conexos NDe fiscal RMW) vai criar sua 3ª tabela. Regras cross-frente (ex.: "todo `reconciling` órfão >2h vira alerta") precisam de N implementações.
- **Impacto de negócio**: O padrão está certo; a duplicação atrasa a próxima integração e cria N pontos onde um bug do ledger pode aparecer.
- **Métrica de baseline**: 2 tabelas com ~10 colunas idênticas cada; ~90 LOC de SQL replicado.

### F-integrability-8: Versionamento de API ausente e `CONEXOS_DRY_RUN` compartilhado entre 3 frentes

- **Severidade**: P2
- **Tactic violada**: Adhere to Standards; Configure Behavior
- **Localização**: `src/backend/services/conexos.ts:117-122` (baseURL sem versão) · `src/backend/domain/service/permutas/BorderoGestaoService.ts:97,277` · `src/backend/domain/service/sispag/RemessaService.ts:112-113` · `src/backend/domain/service/sispag/ConciliacaoRetornoService.ts:77-78` · `src/backend/domain/service/permutas/GerarSolicitacaoNumerarioService.ts:134-135`
- **Evidência (objetiva)**:
  ```
  // services/conexos.ts:117
  baseURL: opts.baseUrl || process.env.CONEXOS_BASE_URL
           || 'https://columbiatrading.conexos.cloud/api',
  // Sem /v1, sem Accept: application/vnd.conexos.v1+json

  // conexosDryRun é lido em Permutas + SISPAG + Recebimentos usando o MESMO campo do env.
  // Não dá para dry-run só a nova frente SISPAG e deixar Permutas escrevendo real.
  ```
- **Impacto técnico**: Sem shape pinado por versão datada, um upgrade do ERP muda comportamento sem sinal. Sem flag por frente, ativar SISPAG em produção obriga a ativar Permutas junto, ou vice-versa.
- **Impacto de negócio**: Deploy da frente SISPAG "só olhando" (dry-run) sem interromper Permutas é impossível hoje. Rollback também é all-or-nothing.
- **Métrica de baseline**: 1 flag `CONEXOS_DRY_RUN` compartilhada por 3 serviços de frentes distintas; 0 headers/URL de versão.

### F-integrability-9: Observabilidade per-endpoint ausente

- **Severidade**: P3
- **Tactic violada**: (facet moderno) Observability of integration failures
- **Localização**: `src/backend/domain/interface/log/LogInterface.ts:11-16`
- **Evidência (objetiva)**:
  ```
  // Tipos de log:
  BUSINESS_INFO / BUSINESS_WARN / CONEXOS_ERROR / CONEXOS_DEBUG
  // "endpoint" está DENTRO do payload de dados livre; não é dimension no schema.
  // ConexosError carrega .endpoint mas o LogService não o promove.
  ```
- **Impacto técnico**: Contar erros por endpoint (`fin015/finalizarLote` vs `fin052/arquivosRetorno/processar`) exige grep no Loki, não uma métrica. Sem série temporal por endpoint, degradação lenta ("`titulosPendentes/importar` está falhando 5% agora") só vira ticket quando o cliente reclama.
- **Impacto de negócio**: Não medível localmente. Recomendação: `LogService.error` promove `endpoint` para tag/labels quando `cause instanceof ConexosError`.
- **Métrica de baseline**: ⚠️ **Não medível localmente** — precisa acesso ao dashboard do Render/Loki.

## 5. Cards Kanban

### [integrability-1] Recorde fixtures reais do ERP e faça-os falharem o teste quando o shape mudar

- **Problema**
  > Os 4 `.test.ts` do delta SISPAG (1088 LOC) usam `mockResolvedValue({...})` com shapes hand-typed pelo próprio autor. Não há fixtures do payload que o ERP realmente devolveu em HML nos dias 2026-07-11 e 2026-08-20 (as datas citadas nos JSDoc). Quando o Conexos alterar `titulosPendentes/importar` ou `arquivosRetorno/processar` sem changelog, o teste continua verde e a quebra só aparece no botão da analista.
- **Melhoria Proposta**
  > Introduzir `src/backend/domain/interface/sispag/__fixtures__/` com JSONs capturados das sondas HAR (`probe-fin015-import.ts`, `probe-fin052-retorno.ts`, `execute-fin015-prd.ts`). Reescrever ≥1 teste por endpoint estatful para carregar o JSON e passar por `Zod.parse` — no `WriteClient` e no `RetornoClient`. Datar cada fixture (`2026-08-20-flp26-importar.ok.json`). Padrão a copiar: `src/backend/domain/interface/recebimentos/__fixtures__/` (único lugar do repo com fixtures reais). Tactic: **Contract testing** (facet moderno) + **Adhere to Standards**.
- **Resultado Esperado**
  > Quando o Conexos remover/renomear um campo de seleção ou o shape de sucesso de `gerarRemessa`, `npm test` fica vermelho em vez de o botão da analista quebrar em produção.
- **Tactic alvo**: Contract testing / Adhere to Standards
- **Severidade**: P1
- **Esforço estimado**: M (2–5d — 5 fixtures principais + reescrita dos 4 testes)
- **Findings relacionados**: F-integrability-1, F-integrability-5
- **Métricas de sucesso**:
  - Fixtures no repo: 0 → ≥5 (importar, gerarRemessa, arquivosRetorno/list, arquivosRetornoDetalhe/list, processar)
  - `% clients SISPAG com teste fixture-based`: 0% → 100% (3/3)
- **Risco de não fazer**: Uma release do ERP em Q1 2027 quebra silenciosamente a geração de remessa em prd; MTTR sobe para "quantos dias até a Columbia reclamar", porque nada dispara no CI.
- **Dependências**: nenhuma; fixtures já existem em `/tmp/preflight-fin015` e `/tmp/execute-fin015-prd` das sondas (só copiar para o repo, redigindo PII).

### [integrability-2] Extraia `describeConexosValidation` + `toConexosError` para `ConexosBaseClient`

- **Problema**
  > 35 linhas de parse de erro (`VALIDATION_LIST` messages/vars.msg + `VALIDATION` itemMessages/constraint) foram copiadas verbatim de `ConexosSispagWriteClient` para `ConexosSispagRetornoClient` — o próprio comentário do Retorno confessa "duplicado por ora". O próximo cliente de escrita (Fin014 baixa manual, ConexosNde etc.) vai duplicar de novo.
- **Melhoria Proposta**
  > Mover `describeConexosValidation` e `toConexosError` para métodos `public` de `ConexosBaseClient` (`base.describeConexosValidation`, `base.toConexosError(endpoint, cause)`). Também mover a extração de `SELECTION_ERROR` (que o JSDoc menciona mas não parseia) para o mesmo lugar. Tactic: **Abstract Common Services**. Escopo: `ConexosBaseClient.ts` + 2 clients atuais + testes existentes.
- **Resultado Esperado**
  > Cada novo cliente ERP-write herda tratamento de erro consistente em ≤3 linhas.
- **Tactic alvo**: Abstract Common Services
- **Severidade**: P2
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-integrability-2
- **Métricas de sucesso**:
  - Linhas duplicadas de boundary-error: ~70 → 0
  - # clients com `describeConexosValidation` privado: 2 → 0
- **Risco de não fazer**: Terceira duplicação inevitável na próxima frente; divergência silenciosa da UX de erro entre módulos.
- **Dependências**: nenhuma.

### [integrability-3] Trate `QUESTION` do ERP em TODOS os writes do fin015, não só em `sugerirRemessa`

- **Problema**
  > `importarTitulos` documenta no JSDoc o QUESTION `FIN_041.PESSOA_FAVORECIDA_SEM_CONTA_ATIVA_...` que o ERP dispara na prática, mas seu `catch` só chama `toConexosError` — a pergunta some virando "ERP recusou". Só `sugerirRemessa` chama `perguntaDoErp`. `ErpPerguntaError` (HTTP 409 + texto pt-BR) nunca sobe pelas duas escritas mais quentes.
- **Melhoria Proposta**
  > Extrair `handleErpError(endpoint, cause)` helper que primeiro tenta `perguntaDoErp` (throw `ErpPerguntaError`), fallback para `toConexosError`. Aplicar em `criarLote`, `importarTitulos`, `finalizarLote`, `gerarRemessa`, `processarArquivoRetorno`, `carregarArquivoRetorno`. Casar com F-integrability-2 (helper mora no `ConexosBaseClient`). Adicionar teste unitário com fixture do QUESTION.
- **Resultado Esperado**
  > Quando o favorecido não tem conta ativa no banco do lote, a analista vê "O Conexos pediu confirmação (FIN_041...)" com 409 na UI, entra no ERP e resolve. Hoje ela vê "ERP recusou" sem contexto.
- **Tactic alvo**: Tailor Interface
- **Severidade**: P1
- **Esforço estimado**: S (≤1d — extração + 6 pontos de uso + testes)
- **Findings relacionados**: F-integrability-3
- **Métricas de sucesso**:
  - Endpoints de escrita fin015+fin052 que reconhecem QUESTION: 1/6 → 6/6
  - Testes com fixture do `type:'QUESTION'`: 0 → 1
- **Risco de não fazer**: Cada favorecido com conta em outro banco = 1 chamado de suporte + 1 lote nativo órfão a limpar à mão no ERP.
- **Dependências**: melhor sequenciar depois de [integrability-2] (helper compartilhado).

### [integrability-4] Descubra `bncNumCodbanco` e `grbCodSeq` no ERP em vez de hardcodar em 3 lugares

- **Problema**
  > `FEBRABAN_POR_BNCCOD: Record<number, number> = { 3:1, 4:341, 7:237, 10:33 }` está literal em `RemessaService.ts:17` e em `jobs/validate-fin015-import.ts:63` e (parcial) em `execute-fin015-prd.ts:60`. `grbCodSeq: 1` (que significa "REMESSA SISPAG - ITAÚ") é literal em 6 jobs + RemessaService. Um novo `bncCod` sem entrada na tabela cai no `?? 341` (default Itaú) — remessa sai com header errado silenciosamente.
- **Melhoria Proposta**
  > (a) Adicionar `ConexosSispagClient.listBancos()` que lê `cmn0??/list` e devolve `Map<bncCod, {bncNumCodbanco, nome}>`; cache em memória com TTL curto. (b) Chamar `listConfigsRetorno`/equivalente de remessa para descobrir `grbCodSeq` por `(bncCod, direção='remessa')`. (c) Remover as duas cópias hardcoded do FEBRABAN. (d) `?? 341` fail-hard: `throw` se bncCod não conhecido em vez de assumir Itaú. Tactic: **Discover Service** + **Configure Behavior**.
- **Resultado Esperado**
  > Onboarding de novo banco = zero linha de código (o ERP já sabe).
- **Tactic alvo**: Discover Service
- **Severidade**: P1
- **Esforço estimado**: M (2–5d — 1 novo método client + refactor de `RemessaService` + apagar duplicatas dos jobs + testes)
- **Findings relacionados**: F-integrability-4
- **Métricas de sucesso**:
  - # cópias hardcoded do FEBRABAN: 3 → 0
  - # jobs/services com `grbCodSeq: 1` literal: 7 → 0
  - Novo bncCod sem cadastro: retorna 200 remessa-Itaú-por-engano → retorna erro explícito
- **Risco de não fazer**: Já custou um `.REM` de conta Banestes emitido como Itaú (documentado no comentário de `ContaCorrentePagadora`). Repetível a qualquer momento.
- **Dependências**: F-integrability-1 (fixtures) ajuda a validar `listBancos` sem escrever.

### [integrability-5] Pin de contrato datada para endpoints não-documentados no OpenAPI

- **Problema**
  > `arquivosRetorno/processar` (PUT) não tem `requestBody` no OpenAPI (`docs/conexos-api/090-fin0.json`). O body `{ items:[chave+tipo] }` foi descoberto por probing; o significado de `tipo=1` é uma nota de rodapé. Não há snapshot datado do payload que funcionou.
- **Melhoria Proposta**
  > Criar `docs/conexos-api/discovered/` com um `.md` por endpoint descoberto (`fin052-arquivosRetorno-processar.md`), contendo: URL exato, corpo mínimo, corpo observado, tipos de erro conhecidos, data da última confirmação AO VIVO em HML e o `flpCod`/`garCodSeq` usado. Casar cada arquivo com sua fixture (F-integrability-1). Tactic: **Adhere to Standards** (torna o contrato tácito em standard interno).
- **Resultado Esperado**
  > Contrato discovered vira artefato consultável; time novo entende por que `tipo:1` sem precisar reler probes.
- **Tactic alvo**: Adhere to Standards / Versioning strategy
- **Severidade**: P1
- **Esforço estimado**: S (≤1d — 4-5 docs curtos)
- **Findings relacionados**: F-integrability-5, F-integrability-8
- **Métricas de sucesso**:
  - # endpoints usados fora do OpenAPI oficial: 4+ → 0 sem doc paralelo
  - # arquivos `docs/conexos-api/discovered/*.md`: 0 → ≥5
- **Risco de não fazer**: Quem sondou vai embora; o próximo bug no `processar` vai custar 1 dia de re-descoberta.
- **Dependências**: F-integrability-1 (as fixtures são a evidência que o doc referencia).

### [integrability-6] Tipe a chave nativa composta (fil, bnc, flp[, its]) e proíba o uso solto

- **Problema**
  > O ERP recicla `flpCod`. A disciplina "sempre buscar pela tupla" é só comentário. `LotePagamento.nativeFlpCod?: number` é campo independente — nada impede um SELECT novo usar só `flpCod`. Já custou um `.REM` cancelado por engano.
- **Melhoria Proposta**
  > Introduzir `type NativeLoteKey = { readonly filCod: number; readonly bncCod: number; readonly flpCod: number }` (e `NativeItemKey` estendendo com `itsCodSeq`) em `SispagInterface.ts`. Refatorar `LotePagamento` para carregar `nativeKey?: NativeLoteKey` em vez de 3 campos separados. `LotePagamentoRepository.findByChaveNativa`, `setChavesNativas`, `RemessaService` recebem/produzem só a tupla. Adicionar teste que garante que buscar por `{flpCod}` sozinho não compila. Tactic: **Manage Resource Coupling**.
- **Resultado Esperado**
  > O compilador impede o uso do `flpCod` sozinho; a invariante deixa de ser convenção.
- **Tactic alvo**: Manage Resource Coupling
- **Severidade**: P2
- **Esforço estimado**: M (2–3d, refactor + migração de teste; a migration SQL fica intacta)
- **Findings relacionados**: F-integrability-6
- **Métricas de sucesso**:
  - # acessos a `nativeFlpCod` sem os pares (`nativeFilCod`, `nativeBncCod`): 8+ → 0
- **Risco de não fazer**: Repetição do incidente do `.REM` errado. Convenção humana em contrato instável do ERP.
- **Dependências**: nenhuma.

### [integrability-7] Isole `CONEXOS_DRY_RUN` por frente (SISPAG independente de Permutas/Recebimentos)

- **Problema**
  > `env.conexosDryRun` é uma flag única lida por `RemessaService`, `ConciliacaoRetornoService`, `GerarSolicitacaoNumerarioService`, `BorderoGestaoService`. Não dá para colocar SISPAG em dry-run enquanto Recebimentos continua escrevendo, o que trava rollout gradual e rollback cirúrgico.
- **Melhoria Proposta**
  > Refatorar `EnvironmentProvider.getEnvironmentVars` para expor `dryRun: { sispag: boolean; permutas: boolean; recebimentos: boolean }` derivado de flags específicas com fallback para a global. Serviços passam a ler `env.dryRun.sispag`. Tactic: **Configure Behavior**.
- **Resultado Esperado**
  > Dry-run só do SISPAG mantendo as outras frentes em modo real.
- **Tactic alvo**: Configure Behavior
- **Severidade**: P2
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-integrability-8
- **Métricas de sucesso**:
  - # frentes que compartilham a mesma flag `conexosDryRun`: 3 → 1 (SISPAG por si)
- **Risco de não fazer**: Rollout de SISPAG em produção continua bloqueado por qualquer instabilidade em Recebimentos e vice-versa.
- **Dependências**: nenhuma.

### [integrability-8] Promova `endpoint` a tag no LogService para métricas per-integração

- **Problema**
  > `LogService` grava `CONEXOS_ERROR` com `endpoint` dentro do payload livre — não como dimension. Contar erros por endpoint hoje é grep no Loki.
- **Melhoria Proposta**
  > Estender `LogService.error({ type, message, data, ...tags?: { endpoint?: string; serviceName?: string } })` e, quando `data.cause instanceof ConexosError`, promover `cause.endpoint` para tag automaticamente. Tactic: **Observability of integration failures**.
- **Resultado Esperado**
  > Dashboard "erros por endpoint Conexos" fica trivial de montar.
- **Tactic alvo**: Observability (facet moderno)
- **Severidade**: P3
- **Esforço estimado**: S (≤1d — depende de o transport de logs no Render suportar labels; verificar com Yuri)
- **Findings relacionados**: F-integrability-9
- **Métricas de sucesso**:
  - # métricas per-endpoint disponíveis: 0 → N (N = nº de endpoints usados)
- **Risco de não fazer**: Degradações lentas de um endpoint específico continuam invisíveis até chamado do cliente.
- **Dependências**: Confirmar com o time que o Loki/Render agrega por label.

## 6. Notas do agente

- Escopo restrito à frente SISPAG (branch `fix/sispag-fin015-import-shape`); ignorei clients pré-existentes (Fin014, Nde, Extrato, Baixa) exceto quando ancoram o padrão que SISPAG copia.
- Métrica de "observabilidade de falhas por dependência" (F-integrability-9) é declaradamente **não medível localmente** — requer acesso ao stack de logs do Render.
- Cross-QA:
  - **Fault Tolerance** — F-integrability-3 (QUESTION não tratado em `importarTitulos`) e F-integrability-6 (`flpCod` reciclado) devem ser flagados junto: são falhas silenciosas em contrato instável.
  - **Modifiability** — F-integrability-2 (duplicação de `describeConexosValidation`) e F-integrability-4 (FEBRABAN hardcoded) são as mesmas violações vistas pela lente de "custo de mudar".
  - **Testability** — F-integrability-1 (0 fixtures) sobrepõe a lacuna de testabilidade de integração; consolidar.
  - **Security** — o `endpoint` promovido a tag (F-integrability-9) precisa passar por redator (não vazar `docCod`/`pesCod` em label cardinality).
- Preferi P1 a P0 nos achados porque o cenário deste run é escrita GATED (`CONEXOS_WRITE_ENABLED` + `CONEXOS_DRY_RUN`) — o dano imediato hoje é operacional, não financeiro em massa. Se o gate for aberto sem cumprir [integrability-1] e [integrability-3], reavaliar para P0.
