---
qa: Integrability
qa_slug: integrability
run_id: 2026-08-06-1945
agent: qa-integrability
generated_at: 2026-08-06T19:45:00-03:00
scope: backend
score: 8
findings_count: 4
cards_count: 4
---

# Integrability — Regis-Review

> Escopo: revisão **restrita ao delta** do `/feature-tweak bordero-vazio-orfao`
> (I-Write-7). O foco é a integração com o Conexos ERP (`fin010`) — nenhum client
> novo foi introduzido; apenas duas chamadas pré-existentes do `ConexosBaixaClient`
> (`listBaixas`, `excluirBordero`) passaram a ser consumidas por
> `ReconciliacaoPermutaService`, e o `BorderoGestaoService.finalizarBordero`
> ganhou um guard de `listBaixas` antes do POST.

## 1. Cenário Geral (Bass General Scenario aplicado ao nf-projects)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Analista aciona "Baixar" em uma permuta e o handshake do `fin010` falha em TODAS as invoices | Passo 1 (`criarBordero`) sucede + passos 2-5 lançam ERRO ("SALDO INSUFICIENTE", "CONTA…") em cada par adto→invoice | `ReconciliacaoPermutaService.reconciliar` + `ConexosBaixaClient.{listBaixas, excluirBordero}` | Produção (`CONEXOS_WRITE_ENABLED=true`, `CONEXOS_DRY_RUN=false`); ERP responde 200/HTTP mas `messages[].valid='ERRO'` | Sistema NÃO deixa borderô-casco: pergunta ao ERP quantas baixas o borderô tem (`listBaixas`), se `=0` remove (`excluirBordero`); erro real das baixas sobe intacto ao analista. Falha da limpeza vira `BUSINESS_WARN` (best-effort). | 0 borderôs órfãos aprováveis após o ciclo; ≤ 2 chamadas HTTP extras adicionadas ao happy-path (0 quando `borderoCriadoAqui=false`); `finalizarBordero` recusa em 0 requisições ao ERP quando a lista do ERP retorna `[]`. |

Cenário-âncora: borderô **18538** (2026-08-06) — nascido pelo passo 1, todas as baixas
falharam, casco sobrevivendo no ERP e recusado na aprovação com `"ESTE BORDERÔ NÃO
POSSUI ITENS."`. É o gatilho da guarda dupla (produtor + consumidor).

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Clients novos introduzidos pelo delta | 0 | 0 (reuso) | ✅ | `git diff --stat` em `src/backend/domain/client/` — 0 arquivos |
| Métodos novos em `ConexosBaixaClient` | 0 | 0 (reuso das assinaturas existentes) | ✅ | `grep "public " ConexosBaixaClient.ts` — 13 públicas, todas pré-delta |
| Métodos genéricos (`get`/`post`/`request`) expostos pelo client | 0 | 0 | ✅ | `ConexosBaixaClient.ts` — todas domain-specific (`criarBordero`, `listBaixas`, `excluirBordero`, `finalizarBordero`, …) |
| Operações distintas do `fin010` consumidas por `ReconciliacaoPermutaService` | **8** (antes 6) | ≤ 10 antes de considerar ACL/agrupador | ⚠️ | `ReconciliacaoPermutaService.ts:249,317,326,367,493,528,559,591,814` — `criarBordero`, `listBaixas`, `excluirBordero`, `setBorCod` (repo), `validarTituloBaixa`, `validarTituloPermuta`, `atualizarValorLiquido`, `gravarBaixaPermuta`, `getBordero` |
| Assinaturas honradas (tipos de entrada/saída) | 3/3 | 3/3 | ✅ | `listBaixas({filCod, borCod})`, `excluirBordero({filCod, borCod})`, `finalizarBordero({filCod, borCod})` — chamadas em `ReconciliacaoPermutaService.ts:317,326` e `BorderoGestaoService.ts:206,265` batem 1:1 com `ConexosBaixaClient.ts:140,225,240` |
| Suposição sobre a resposta do ERP para `listBaixas` vazio | `Array<{…}>` com `.length===0` | Deve tolerar null/undefined/paginado | ✅ (SDK) / ⚠️ (paginação) | Client normaliza com `page.rows ?? []` (`ConexosBaixaClient.ts:169-187`) e devolve `Array<…>` tipado. Paginação limitada a `pageSize:200`, `pageNumber:1` — sem loop |
| Ceiling de paginação documentado (`listBaixas`) | ❌ ausente | Documentar teto ou implementar continuação | ⚠️ | `ConexosBaixaClient.ts:158-166` e `business-rules/fin010-write-contract.md:105-122` (I-Write-7) não citam o teto de 200 nem o número máximo esperado de baixas por borderô |
| Contrato `fin010` atualizado coerentemente | ✅ I-Write-7 adicionada; tabela de handshake preservada | Atualização por delta | ✅ | `business-rules/fin010-write-contract.md:14-19` (5-chamada intacta), `:105-122` (I-Write-7 nova, cita borderô 18538 + ADR-0030) |
| `ontology/integrations/conexos.md` reflete o novo consumo | Parcial — `listBaixas` documentado no nível de endpoint (linha 60), mas sem cross-ref a I-Write-7 | Doc cita quem consome cada operação | ⚠️ | `ontology/integrations/conexos.md:60` (definição) — não referencia `ReconciliacaoPermutaService.removerBorderoOrfao` nem `BorderoGestaoService.assertBorderoTemItens` |
| `axios`/`fetch` fora dos clients no delta | 0 | 0 | ✅ | `grep -rn "axios\|fetch(" ReconciliacaoPermutaService.ts BorderoGestaoService.ts` — nenhum |
| Zod / validação de schema na fronteira do delta | 0 | ≥ 1 (guard estruturado) | ⚠️ | Não há schema Zod aplicado ao retorno de `listBaixas`; o guard confia no shape tipado do client (aceitável — normalização acontece em `ConexosBaixaClient.ts:169-183`) |
| Testes de contrato adicionados (fixtures) | 6 casos (unit + interaction) | Coverage do happy + falha + misto | ✅ | `ReconciliacaoPermutaService.test.ts` (4) + `BorderoGestaoService.test.ts` (2) — `_shared-metrics.md` |
| Chamadas extras ao ERP no happy-path | +0 (só quando `borderoCriadoAqui && sem settled`) e +1 em `finalizar` | ≤ 1 marginal | ✅ | Guard-condition em `ReconciliacaoPermutaService.ts:291`; guard sempre chama `listBaixas` antes de `finalizarBordero` (`BorderoGestaoService.ts:206` → `:264`) |

⚠️ **Não medível localmente**: número máximo de baixas por borderô em produção
(precisa amostragem do Conexos). Recomendação: query analítica no cache
`permuta_bordero` para o P95 de `baixas.length` histórico → dimensiona se
`pageSize:200` é suficiente.

## 3. Tactics — Cobertura no nf-projects

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Encapsulate | `ConexosBaixaClient` continua o único ponto de entrada do `fin010`; delta não vaza `axios`/URL/JSON crus para o serviço | ✅ presente | `ReconciliacaoPermutaService.ts:317,326`, `BorderoGestaoService.ts:265` — só chamam métodos domain-specific |
| Use an Intermediary | Nenhum ACL/agrupador entre `ReconciliacaoPermutaService` e `ConexosBaixaClient`; serviço agora depende de 8 operações do mesmo client | ⚠️ parcial | `ReconciliacaoPermutaService.ts` — 8 chamadas ao `conexosBaixaClient`. Ainda tolerável (mesmo client, mesmo módulo `fin010`), mas cresce a superfície |
| Restrict Communication Paths | Novas chamadas passam pelo mesmo caminho DI (`@inject(ConexosBaixaClient)`) — nenhum bypass | ✅ presente | `ReconciliacaoPermutaService.ts:84`, `BorderoGestaoService.ts:72` |
| Adhere to Standards | `POST /fin010/baixas/list/{borCod}` e `DELETE /fin010/{borCod}` são endpoints canônicos do Conexos (sonda HAR), documentados no contrato | ✅ presente | `business-rules/fin010-write-contract.md:14-19`; `ontology/integrations/conexos.md:59-60` |
| Abstract Common Services | `runWithRetry` + `ensureSid` compartilhados via `base` — `listBaixas` os herda; `excluirBordero` não usa `runWithRetry` (delete idempotente, tentativa única — decisão explícita no comentário) | ✅ presente | `ConexosBaixaClient.ts:156-158` (retry+sid) vs `:229-233` (só sid) |
| Discover Service | SSM segue a convenção `/tenants/{env}/{client}/{name}` para credenciais do Conexos — inalterado no delta | ✅ presente | `EnvironmentProvider` (não tocado); `CONEXOS_WRITE_ENABLED` gate reutilizado em `BorderoGestaoService.ts:97,276` |
| Tailor Interface | Cliente já expõe interface enxuta (só o necessário para permuta); delta reusa exatamente as assinaturas | ✅ presente | `ConexosBaixaClient.ts:140,225` — assinaturas idênticas às chamadas do delta |
| Configure Behavior | Guard-rails de escrita (`conexosWriteEnabled`, `conexosDryRun`, `dryRunOverride`) mantidos; a limpeza do órfão respeita o gate implicitamente (só ocorre se houve tentativa de POST real) | ✅ presente | `ReconciliacaoPermutaService.ts:138-140,291` — `borderoCriadoAqui` só é `true` no ramo não-dry-run |
| Manage Resources | Sessão Conexos (`ensureSid`) reaproveitada nas novas chamadas — sem duplicar login | ✅ presente | `ConexosBaixaClient.ts:157,229` |
| Orchestrate | O laço de reconciliação orquestra o handshake linearmente (produtor); consumidor (`finalizarBordero`) faz guard→ação→cache; nenhum evento assíncrono adicionado | ✅ presente | `ReconciliacaoPermutaService.ts:148-293`; `BorderoGestaoService.ts:200-217` |
| Manage Resource Coupling | `ReconciliacaoPermutaService` sobe de 6 → 8 operações distintas do `fin010`; não existe ainda um "fin010 façade" que agregue baixa+bordero | ⚠️ parcial | `ReconciliacaoPermutaService.ts` importa `ConexosBaixaClient` E `ConexosTitulosClient` — dois clients distintos do Conexos + agora 8 métodos do primeiro |
| Contract testing (fixture-based) | 6 testes adicionais cobrem cenários do delta com mocks tipados (não fixture HAR) | ✅ presente | `_shared-metrics.md` — 47/47 verdes em permutas |
| Versioning strategy | Conexos não expõe versão no path (`/fin010/...`); estratégia é HAR-sonda por endpoint — inalterada | ⚠️ parcial | `business-rules/fin010-write-contract.md` — "Origem: HAR 2026-06-23/25"; sem `?api-version=` no ERP |
| Backward-compatibility shims | Filtro `Number.isFinite(b.docCod && b.bxaCodSeq)` no `listBaixas` (linha 186 do client) protege contra rows quebrados do ERP — shim silencioso | ✅ presente | `ConexosBaixaClient.ts:186` |
| Observability of integration failures | Logs `BUSINESS_INFO/BUSINESS_WARN` estruturados nos dois lados; falha da limpeza é `WARN` sem mascarar o erro real | ✅ presente | `ReconciliacaoPermutaService.ts:319-343`, `BorderoGestaoService.ts:130-136` |

## 4. Findings (achados)

### F-integrability-1: `listBaixas` só lê a página 1 (`pageSize:200`) sem paginação — teto não documentado nas guardas I-Write-7

- **Severidade**: P2 (débito técnico defensável — cenário requer >200 baixas em um único borderô de permuta)
- **Tactic violada**: Adhere to Standards (paginação); Backward-compatibility shims (não previne desvio)
- **Localização**: `src/backend/domain/client/ConexosBaixaClient.ts:158-168`; consumido por
  `src/backend/domain/service/permutas/ReconciliacaoPermutaService.ts:317`
  e `src/backend/domain/service/permutas/BorderoGestaoService.ts:265,173`.
- **Evidência (objetiva)**:
  ```ts
  // ConexosBaixaClient.ts:158-168
  const page = await this.base.listGenericPaginated<Record<string, unknown>>(
      `fin010/baixas/list/${borCod}`,
      { fieldList: [], filterList: {}, pageNumber: 1, pageSize: 200, ... },
      { filCod },
  );
  return (page.rows ?? []).map(...).filter(b => Number.isFinite(b.docCod) && Number.isFinite(b.bxaCodSeq));
  ```
  Nenhum consumidor testa `page.hasMore`/`page.total` — a decisão `baixas.length === 0`
  (em `ReconciliacaoPermutaService.ts:318` e `BorderoGestaoService.ts:266`) confia
  que "página 1 vazia" ⇒ "borderô vazio".
- **Impacto técnico**: Cenário 1 (produtor): impossível — nesta chamada nenhuma
  baixa foi confirmada, `listBaixas` sempre retornaria `[]`. Cenário 2 (consumidor
  `assertBorderoTemItens`): se o borderô legitimamente tiver >200 baixas E, por
  algum bug do ERP, a página 1 vier vazia (`rows: []`, `hasMore: true`), o guard
  passaria uma aprovação inválida — cenário puramente teórico.
- **Impacto de negócio**: Baixo em curto prazo (permuta típica: 1 adto × 1–10
  invoices). Se a mesma fixture for reutilizada para `com298/SISPAG` (SISPAG tem
  lotes maiores) sem ajuste, o risco escala.
- **Métrica de baseline**: teto atual = **200** baixas por borderô lidas por
  chamada; P95 real em produção **não medido** (ver métrica "Não medível" na §2).

### F-integrability-2: `ontology/integrations/conexos.md` documenta `listBaixas` no nível de endpoint mas não referencia a nova invariante I-Write-7 que o consome

- **Severidade**: P3 (documentação/tracing)
- **Tactic violada**: Encapsulate (documentação); Restrict Communication Paths (rastreabilidade)
- **Localização**: `ontology/integrations/conexos.md:60`; contra
  `ontology/business-rules/fin010-write-contract.md:105-122` (I-Write-7)
  e `ReconciliacaoPermutaService.ts:317`, `BorderoGestaoService.ts:265`.
- **Evidência (objetiva)**:
  ```
  # conexos.md:60
  | `fin010/baixas/list/{borCod}` | baixas de um borderô (lado-invoice) |
    `listBaixas({filCod, borCod})` | ... |
    ADR-0014: detalhe de borderôs lançados direto no Conexos (sem trilha). |
  ```
  A célula "propósito" cita apenas o caso original (ADR-0014); o novo consumo
  como "fonte da verdade para casco vazio" (ADR-0030 / I-Write-7) não aparece
  em `integrations/conexos.md`.
- **Impacto técnico**: Ao refatorar o client (ex.: mudar contrato do
  `listGenericPaginated`), o revisor não vê que a semântica de "array vazio =
  borderô vazio" é agora carga do guard I-Write-7. Alto risco de regressão
  silenciosa se alguém trocar por "retorna undefined em corpo vazio".
- **Impacto de negócio**: Reabre a porta do casco vazio; borderô 18538 volta
  a acontecer no próximo refactor.
- **Métrica de baseline**: 1 ocorrência conhecida de casco vazio em produção
  (2026-08-06); 0 cross-references entre `conexos.md:60` e `fin010-write-contract.md:I-Write-7`.

### F-integrability-3: `ReconciliacaoPermutaService` cresce para 8 operações distintas do `fin010` (+2 no delta) — sem intermediário

- **Severidade**: P2 (débito estrutural — acoplamento monotonicamente crescendo)
- **Tactic violada**: Use an Intermediary; Manage Resource Coupling
- **Localização**: `src/backend/domain/service/permutas/ReconciliacaoPermutaService.ts`
  — chamadas ao `conexosBaixaClient` em `:249, 317, 326, 493, 528, 559, 591, 814`.
- **Evidência (objetiva)**:
  ```
  criarBordero (249) · listBaixas (317) NOVO · excluirBordero (326) NOVO ·
  validarTituloBaixa (493) · validarTituloPermuta (528) ·
  atualizarValorLiquido (559) · gravarBaixaPermuta (591) · getBordero (814)
  ```
  O serviço também injeta `ConexosTitulosClient` (`:85`) — 2 clients Conexos
  distintos em um único orquestrador. `BorderoGestaoService` usa outros 6
  métodos, com 3 sobreposições (`listBaixas`, `excluirBordero`, `finalizarBordero`),
  reforçando que o "façade fin010" existe implicitamente distribuído em 2 serviços.
- **Impacto técnico**: Trocar o provedor do ERP (ex.: Conexos v2 / outro TMS)
  exige mexer em 2 serviços de permuta + toda a superfície do `ConexosBaixaClient`.
  Cada nova ação de borderô cresce essa contagem — hoje é linear com o número de
  operações do fin010 usadas.
- **Impacto de negócio**: Custo de upgrade do Conexos (v2 anunciado no roadmap
  Conexos, sem data firme) escala com nº de operações consumidas. Hoje ≈ 11
  operações fin010 distintas em `permutas/*` — se dobrarem, o custo dobra.
- **Métrica de baseline**: `ReconciliacaoPermutaService` acopla-se a **8**
  operações de `ConexosBaixaClient` (era 6 antes deste delta) e a **1** de
  `ConexosTitulosClient` = 9 métodos externos do ERP no mesmo serviço.

### F-integrability-4: Guard `assertBorderoTemItens` adiciona 1 round-trip ao ERP em toda `finalizarBordero`, sem cache/short-circuit local

- **Severidade**: P3 (custo marginal aceitável, mas mensurável e por-operação)
- **Tactic violada**: Manage Resources; Configure Behavior (falta bypass configurável)
- **Localização**: `src/backend/domain/service/permutas/BorderoGestaoService.ts:205-206,264-272`
- **Evidência (objetiva)**:
  ```ts
  // BorderoGestaoService.ts:200-206
  public finalizarBordero = async (params) => {
      const filCod = await this.guardAcaoBordero(params.borCod);
      await this.assertBorderoTemItens(filCod, params.borCod); // <— +1 HTTP ERP
      await this.conexosBaixaClient.finalizarBordero({ filCod, borCod });
      ...
  };
  ```
  A trilha local tem `bxa_cod_seq` para cada baixa `settled` do borderô, mas o
  comentário no serviço explica (corretamente) por que ela não pode ser usada
  como fonte para o guard: linhas `error` também carregam `bor_cod`. Ainda
  assim, um short-circuit "trilha tem ≥ 1 `settled` para este `bor_cod`" evitaria
  a chamada ao ERP no caso feliz (o único caminho em que o guard passa).
- **Impacto técnico**: Cada aprovação = +1 POST `fin010/baixas/list/{borCod}`.
  Em volumes atuais (dezenas de aprovações/dia), custo desprezível; em picos
  de fechamento mensal (centenas de borderôs), soma latência ao usuário.
- **Impacto de negócio**: Marginal. Não bloqueia funcionalidade.
- **Métrica de baseline**: 1 chamada extra por aprovação — antes 1 POST ao
  ERP (`finalizarBordero`), agora 2 (`listBaixas` + `finalizarBordero`).

## 5. Cards Kanban

### [integrability-1] Documentar o teto de paginação de `listBaixas` e ancorar I-Write-7 nele

- **Problema**
  > O guard I-Write-7 (produtor e consumidor) decide "borderô vazio" a partir
  > de `listBaixas(...).length === 0`, mas o client só lê `pageSize:200` da
  > página 1. O teto real de baixas por borderô de permuta em produção não
  > foi medido, e nenhum consumidor testa `hasMore`. Cenário teórico: >200
  > baixas + página 1 devolvida vazia por bug do ERP → guard falso-positivo.

- **Melhoria Proposta**
  > Adicionar em `ontology/business-rules/fin010-write-contract.md`
  > (seção I-Write-7) o teto de 200 e a suposição "borderô de permuta ≤ N
  > baixas típicas". No `ConexosBaixaClient.listBaixas`, tornar explícito no
  > JSDoc que a chamada é single-page e loga `BUSINESS_WARN` se
  > `page.rows.length === pageSize` (indício de truncamento). Coletar
  > P95 de `baixas.length` do cache `permuta_bordero` (query analítica única)
  > para calibrar o teto. Tactic: **Adhere to Standards** + **Backward-compatibility shims**.

- **Resultado Esperado**
  > Contrato de escrita cita paginação; consumidor detecta e alerta em caso
  > de truncamento. Métrica: **0 → 100%** das chamadas de `listBaixas` com
  > alerta automático quando `rows.length == pageSize`.

- **Tactic alvo**: Adhere to Standards
- **Severidade**: P2
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-integrability-1
- **Métricas de sucesso**:
  - Doc I-Write-7 cita teto de paginação: ❌ → ✅
  - `listBaixas` loga aviso em truncamento: 0% → 100%
  - P95 de `baixas.length` medido: ausente → registrado no doc
- **Risco de não fazer**: A guarda I-Write-7 vira armadilha silenciosa quando
  o volume de baixas por borderô crescer (ex.: SISPAG reusa a fixture).
- **Dependências**: nenhuma

### [integrability-2] Cross-referenciar I-Write-7 em `ontology/integrations/conexos.md`

- **Problema**
  > A tabela de endpoints em `conexos.md:60` documenta `listBaixas` como
  > "detalhe de borderôs lançados direto no Conexos (ADR-0014)" — não
  > menciona o novo consumo pelo guard I-Write-7. Refactor futuro do client
  > pode quebrar a semântica "array vazio = borderô vazio" sem que o revisor
  > perceba que essa semântica virou carga arquitetural.

- **Melhoria Proposta**
  > Atualizar `ontology/integrations/conexos.md` (linhas 59-60) para citar,
  > na coluna "propósito", ADR-0030 + I-Write-7 como consumidor da mesma
  > operação. Adicionar bloco "Consumidores" no fim da seção fin010 mapeando
  > `endpoint → serviço:método` de todo consumo interno. Tactic: **Encapsulate**
  > (nível de documentação).

- **Resultado Esperado**
  > Toda operação `fin010` documentada com seus consumidores nomeados.
  > Cross-reference bidirecional entre business-rules e integrations. Métrica:
  > **0 → 100%** das operações fin010 usadas com consumidor nomeado em `conexos.md`.

- **Tactic alvo**: Encapsulate
- **Severidade**: P3
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-integrability-2
- **Métricas de sucesso**:
  - `conexos.md` cita I-Write-7 e ADR-0030: ❌ → ✅
  - Ratio "operação fin010 documentada com consumidor": 0/11 → 11/11
- **Risco de não fazer**: Regressão silenciosa no refactor do
  `listGenericPaginated` — casco vazio volta ao produção.
- **Dependências**: nenhuma

### [integrability-3] Consolidar orquestração fin010 em um façade "fin010BorderoFacade" (ACL)

- **Problema**
  > `ReconciliacaoPermutaService` já depende de 8 operações do
  > `ConexosBaixaClient` + 1 do `ConexosTitulosClient`; `BorderoGestaoService`
  > sobrepõe 3 dessas operações + 3 novas. Não há intermediário entre os
  > serviços de permuta e o SDK do Conexos. Trocar o provedor ou migrar
  > para Conexos v2 exigirá mexer nos 2 serviços simultaneamente.

- **Melhoria Proposta**
  > Extrair um `Fin010BorderoFacade` (ou `ConexosBorderoWriteGateway`)
  > responsável pelo ciclo completo do borderô: `abrir`, `baixar`,
  > `contarItens`, `apagar`, `finalizar`, `cancelar`, `estornar`. Os
  > serviços de permuta passam a depender do façade — o `ConexosBaixaClient`
  > vira detalhe de implementação do gateway. Tactic: **Use an Intermediary**
  > + **Manage Resource Coupling**.

- **Resultado Esperado**
  > Um único ponto de anti-corrupção contra o `fin010`. Migração para o
  > Conexos v2 troca a implementação do façade sem impacto nos serviços.
  > Métrica: contagem de chamadas diretas a `ConexosBaixaClient` fora do
  > gateway: **11 → 0** (todas passam pelo façade).

- **Tactic alvo**: Use an Intermediary
- **Severidade**: P2
- **Esforço estimado**: M (2–5d)
- **Findings relacionados**: F-integrability-3
- **Métricas de sucesso**:
  - Chamadas diretas a `ConexosBaixaClient` fora do gateway: 11 → 0
  - Nº de serviços impactados pela troca de v1→v2 do fin010: 2 → 1
- **Risco de não fazer**: Cada novo caso de escrita fin010 (ex.: reabrir
  cancelamento, estorno programático — hoje TODO) grava mais uma
  aresta serviço→SDK. Débito monotonicamente crescendo.
- **Dependências**: integrability-2 (para saber quem consome o quê)

### [integrability-4] Short-circuit local no guard de `finalizarBordero` (evitar round-trip quando trilha já garante ≥1 settled)

- **Problema**
  > `assertBorderoTemItens` sempre chama `listBaixas` no ERP antes do
  > `finalizarBordero`, mesmo quando a trilha local já tem ≥1 execução
  > `settled` para o `bor_cod` — que é o único caminho em que a
  > finalização faria sentido. Custo: 1 POST ao ERP por aprovação.

- **Melhoria Proposta**
  > Adicionar `execucaoRepository.hasSettledForBorCod(borCod)` como
  > short-circuit: se `true`, pula `listBaixas` e vai direto ao
  > `finalizarBordero`. Se `false` (ou borderô fora da trilha), mantém
  > o fallback atual pelo ERP. Comentar por que: linhas `error` também
  > carregam `bor_cod`, mas `settled` só aparece após confirmação
  > (`bxaCodSeq`). Tactic: **Manage Resources** + **Configure Behavior**.

- **Resultado Esperado**
  > Aprovações do "caminho feliz" com 1 chamada ao ERP (só `finalizarBordero`).
  > Só borderôs fora da trilha (ou incidentes de trilha corrompida)
  > pagam o custo do `listBaixas`. Métrica: nº médio de HTTP ao ERP por
  > aprovação: **2 → 1** no caminho feliz.

- **Tactic alvo**: Manage Resources
- **Severidade**: P3
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-integrability-4
- **Métricas de sucesso**:
  - HTTP ao ERP por `finalizarBordero` (caminho feliz): 2 → 1
  - Cobertura de teste: adicionar caso "trilha `settled` presente → sem `listBaixas`"
- **Risco de não fazer**: Custo desprezível hoje. Só reabrir se
  fechamento mensal virar gargalo.
- **Dependências**: nenhuma

## 6. Notas do agente

- Escopo estritamente `--quick` no delta do tweak; nenhum finding sobre Nexxera/GED/SharePoint (fora do delta).
- Cross-QA: F-integrability-1 (paginação silenciosa como fonte de verdade) tem
  eco em **Fault Tolerance** (guard baseado em resposta parcial pode falhar-aberto)
  e **Testability** (falta de teste com fixture ">200 rows"). Sinalizar ao consolidador.
- Cross-QA: F-integrability-3 (acoplamento 8 métodos) tem eco direto em
  **Modifiability** — mesmo código, mesma tactic (Use an Intermediary). Se
  o Modifiability trouxer o mesmo achado, unificar cards.
- Métrica "P95 de `baixas.length` por borderô" não coletada por ser análise
  de dado de produção (fora do modo `--quick`). Recomendada em follow-up
  se `integrability-1` for priorizado.
- Não implementei nada — como manda o gate `--quick`, apenas registro
  achados; nenhum arquivo do delta foi modificado.
