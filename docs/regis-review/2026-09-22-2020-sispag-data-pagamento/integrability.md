---
qa: Integrability
qa_slug: integrability
run_id: 2026-09-22-2020-sispag-data-pagamento
agent: qa-integrability
generated_at: 2026-09-22T20:20:00-03:00
scope: backend + frontend (delta `fix/sispag-data-pagamento` vs `origin/main`)
score: 7
findings_count: 4
cards_count: 3
---

# Integrability — Regis-Review

## 1. Cenário Geral (Bass General Scenario aplicado ao nf-projects)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Analista SISPAG (via UI) | escolhe `dataDebito` fora da rotina "hoje" e confirma "Gerar remessa" | `RemessaService.gerarRemessa` → `ConexosSispagWriteClient.criarLote` (fin015) | Runtime dev/HML, `sispagLiveWriteEnabled` ligado | `DebitDateService.validate` recusa ANTES de qualquer POST no ERP; se aceita, a data é persistida (`lote_pagamento.data_debito`) e congelada assim que o lote nativo nasce | 0 lotes nativos criados com `flpDtaCredito` fora da janela `[hoje BRT, menor vencimento] ∩ dias úteis`; nenhuma segunda escrita quando a data pedida diverge da congelada (`DebitDateFrozenError`, 422) |
| Time Kavex (manutenção) | precisa trocar o provedor do gateway bancário (Nexxera) ou subir a API do fin015 de versão | `RemessaService.ts` (1112 linhas, orquestra `ConexosSispagWriteClient` + `ConexosSispagClient` + `PostgreeDatabaseClient` + 5 outros colaboradores) | Qualquer ambiente | A mudança fica contida no client (`ConexosSispagWriteClient`) e não vaza para a rota/tela | LOC tocadas fora do client-alvo ao trocar um provedor — hoje não medível sem o exercício real; ver F-integrability-2 |

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Clients com métodos HTTP genéricos (`get/post/request`) no delta | 0 | 0 | ✅ | `ConexosSispagWriteClient.ts` só expõe `criarLote`, `importarTitulos`, `finalizarLote`, `sugerirRemessa`, `gerarRemessa`, `listarArquivosRemessa`, etc. (grep `axios\.`/`\.request(` = 0 ocorrências) |
| Zod nos `POST`/query do delta (`src/backend/routes/sispag.ts`) | `dataDebito` validado por `civilDateSchema` (regex `AAAA-MM-DD` + existência calendária), `gerarRemessaSchema.passthrough()` | 100% dos campos novos | ✅ (campo novo) / ⚠️ (`dryRun`/`confirmarNovoLote` seguem passthrough, pré-existente) | `src/backend/routes/sispag.ts:426-438` |
| Zod nas respostas consumidas pelo frontend (`lib/sispag.ts`) | 0 arquivos | ≥80% dos boundaries | ❌ | `grep -n "zod" src/frontend/lib/sispag.ts src/frontend/app/sispag/components/GerarRemessaDialog.tsx` → 0 ocorrências; `sispagRequest` faz `body as T` sem parse |
| Duplicação de tipo de contrato (`JanelaDataDebito`, `TituloLimitante`, `GerarRemessaResult`) | 2 fontes mantidas à mão (backend `SispagInterface.ts` + frontend `lib/sispag.ts`) | 1 fonte (codegen ou pacote compartilhado) | ⚠️ | `src/backend/domain/interface/sispag/SispagInterface.ts:291-312` vs `src/frontend/lib/sispag.ts:319-332` |
| Colaboradores injetados em `RemessaService` (após o delta) | 10 (`LotePagamentoRepository`, `RemessaExecucaoRepository`, `ConexosSispagWriteClient`, `ConexosSispagClient`, `EnvironmentProvider`, `LogService`, `PostgreeDatabaseClient`, `RemessaCnabValidator`, `DebitDateService`, `BankingCalendar`) | ≤2 clients diretos por service (heurística anti-corruption layer) | ⚠️ | `src/backend/domain/service/sispag/RemessaService.ts:117-130` — 3 desses 10 são Clients (`ConexosSispagWriteClient`, `ConexosSispagClient`, `PostgreeDatabaseClient`) |
| Duplicação de lógica de data eliminada pelo delta | 2 sítios (`execute-fin015-prd.ts`, `validate-retomada-remessa-v1.ts`) passaram a usar `BankingCalendar.toErpEpoch(todayBrt())` em vez de `hojeUtc()` local | 0 duplicações de regra de data no fin015 | ✅ | `git diff origin/main...HEAD -- src/backend/jobs/execute-fin015-prd.ts src/backend/jobs/validate-retomada-remessa-v1.ts` |
| Testes de contrato com payload real do ERP (fixture-based) para `DebitDateService`/`RemessaService` | 0 — os 2 arquivos de teste do delta usam `jest.fn()` mockando `ConexosSispagWriteClient`/`ConexosSispagClient` diretamente | ≥1 fixture de payload real do fin015 (`criarLote`/`listarLotesNativos`) | ⚠️ (padrão pré-existente do repo, não regressão do delta) | `src/backend/domain/service/sispag/RemessaService.test.ts:1-17`, `src/backend/domain/service/sispag/DebitDateService.test.ts:1-40` |
| Nova rota de leitura sem chamada ao ERP | `GET /sispag/lotes/:id/remessa/janela` calcula a partir do snapshot local (`LotePagamentoRepository` + `BankingCalendar`), sem tocar o Conexos | — | ✅ (reduz acoplamento de runtime) | `src/backend/routes/sispag.ts:440-453`, comentário "Não consulta o ERP: usa o snapshot do lote" |
| `process.env.` cru fora de `EnvironmentProvider` no delta | 0 | 0 | ✅ | `grep -rn "process\.env\." <arquivos do delta>` → nenhuma ocorrência fora de `EnvironmentProvider` |

> ⚠️ **Não medível localmente**: taxa de erro por integração (observability de falhas do fin015 em produção — CloudWatch/APM). Requer ambiente de produção; a rota `GET /sispag/execucoes` (pré-existente, não tocada pelo delta) já expõe uma trilha local via Postgres, mas não emite métrica agregada por dependência externa.

## 3. Tactics — Cobertura no nf-projects

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Encapsulate | `ConexosSispagWriteClient` mantém métodos de domínio (`criarLote`, `sugerirRemessa`, `gerarRemessa`); o delta muda SÓ o valor passado a `criarLote({ dataDebito })`, não a assinatura do client | ✅ presente | `src/backend/domain/service/sispag/RemessaService.ts:462-467` |
| Use an Intermediary | `RemessaService` funciona como intermediário entre a rota e os 2 clients Conexos + Postgres, mas ele mesmo acumula 10 colaboradores (3 deles Clients) sem uma segunda camada de anti-corrupção | ⚠️ parcial | `src/backend/domain/service/sispag/RemessaService.ts:117-130` |
| Restrict Communication Paths | Nova rota `GET .../remessa/janela` calcula no backend a partir do snapshot local — não abre novo caminho de rede para o ERP | ✅ presente | `src/backend/routes/sispag.ts:440-453` |
| Adhere to Standards | Data civil `'YYYY-MM-DD'` como padrão único ponta a ponta (Postgres `DATE`, JSON, UI); erro de domínio segue o contrato `HandlerError` (`code`/`statusCode`/`retryable`/`details`) já estabelecido no resto do SISPAG | ✅ presente | `src/backend/domain/errors/DebitDateOutsideWindowError.ts:66-80`, `src/backend/migrations/0061_lote_data_debito.sql:8-9` |
| Abstract Common Services | `BankingCalendar` centraliza o cálculo de dia útil/feriado/"hoje BRT" — elimina a duplicação de `hojeUtc()` que existia em `RemessaService` e nos 2 scripts de job | ✅ presente | `src/backend/domain/libs/calendar/BankingCalendar.ts:1-138`; diff em `execute-fin015-prd.ts` e `validate-retomada-remessa-v1.ts` |
| Discover Service | Não aplicável ao delta — nenhuma configuração nova de SSM/endpoint foi introduzida (o `BankingCalendar` é calculado em código, "sem tabela, sem rede, sem dependência nova") | N/A | `src/backend/domain/libs/calendar/BankingCalendar.ts:30-31` (comentário explícito) |
| Tailor Interface | `gerarRemessaSchema` adapta o corpo HTTP (`dataDebito` opcional) sem alterar o contrato dos campos pré-existentes (`dryRun`/`confirmarNovoLote` seguem passthrough) | ✅ presente | `src/backend/routes/sispag.ts:434-438` |
| Configure Behavior | Nenhuma flag de ambiente nova para a data de débito — o comportamento é decidido por `DebitDateService.resolve` (mesma imagem para todo tenant); `sispagLiveWriteEnabled`/`conexosDryRun` pré-existentes continuam sendo o kill-switch | ✅ presente | `src/backend/domain/service/sispag/RemessaService.ts:196-203` |
| Manage Resources | `withAdvisoryLock` por `loteId` (pré-existente) segue protegendo a escrita; o delta não introduz novo recurso compartilhado além da coluna `data_debito` | ✅ presente | `src/backend/domain/service/sispag/RemessaService.ts:141-153` |
| Orchestrate | `gerarRemessaSerializado` é um orquestrador síncrono linear de 6+ passos (`resolverDataDebito` → conta pagadora → `criarLote` → `importarTitulos` → `finalizarLote` → `sugerirRemessa` → `gerarRemessa` → `listarArquivosRemessa`); o delta insere a decisão de data ANTES do primeiro POST, no lugar certo, mas aprofunda a cadeia | ⚠️ parcial | `src/backend/domain/service/sispag/RemessaService.ts:327-467` |
| Manage Resource Coupling | Ledger write-ahead (`RemessaExecucaoRepository`) e a marca d'água (`marcaFlpCods`) desacoplam retry de duplicação — mecanismo pré-existente, reaproveitado sem alteração pelo delta | ✅ presente | `src/backend/domain/service/sispag/RemessaService.ts:440-459` |
| Contract testing | Testes do delta (`DebitDateService.test.ts`, `RemessaService.test.ts`) usam mocks `jest.fn()` para os clients Conexos, não fixtures de payload real do fin015 | ⚠️ parcial | `src/backend/domain/service/sispag/RemessaService.test.ts:5-17` |
| Versioning strategy | Fora do escopo do delta — `ConexosSispagWriteClient` não foi tocado; o fin015 do Conexos não é versionado por URL/header em nenhum client (herdado, não introduzido aqui) | N/A (não tocado pelo delta) | — |
| Backward-compatibility shims | `dataDebito` é opcional em toda a cadeia (rota, `GerarRemessaInput`, DB nullable); lote legado sem `data_debito` segue funcionando sem congelamento (`resolverDataDebito` retorna `undefined` e loga aviso) | ✅ presente | `src/backend/domain/service/sispag/RemessaService.ts:1047-1068`, `src/backend/migrations/0061_lote_data_debito.sql:11-12` |
| Observability of integration failures | `LogService` estruturado em cada branch de decisão (dry-run, retomada, marca d'água, congelamento) — mas segue sem métrica agregada por dependência (contagem de falhas do fin015 por tipo) | ⚠️ parcial | `src/backend/domain/service/sispag/RemessaService.ts:378-389,653-658` |

## 4. Findings (achados)

### F-integrability-1: Contrato `JanelaDataDebito`/`TituloLimitante`/`GerarRemessaResult` duplicado à mão, sem validação de schema no frontend

- **Severidade**: P2
- **Tactic violada**: Adhere to Standards / Contract testing
- **Localização**: `src/backend/domain/interface/sispag/SispagInterface.ts:287-312` (fonte) vs `src/frontend/lib/sispag.ts:290-332` (cópia manual); consumo sem parse em `src/frontend/lib/sispag.ts:467-504` (`sispagRequest`)
- **Evidência (objetiva)**:
  ```
  // backend
  export interface JanelaDataDebito {
    hoje: string; sugerida?: string; amanha?: string; min?: string; max?: string;
    limitante?: TituloLimitante; naoUteis: string[];
    vazia?: { motivo: 'titulo_vencido' | 'sem_dia_util' | 'titulo_sem_vencimento' };
    congelada?: { data: string; nativeFlpCod: number; motivo: 'lote_nativo_criado' | 'no_passado' };
  }

  // frontend (repetido campo a campo, mesmo comentário "espelha")
  export interface JanelaDataDebito { hoje: string; sugerida?: string; ... }

  // consumo sem Zod
  async function sispagRequest<T>(path: string, init: RequestInit): Promise<T> {
    ...
    return body as T   // <- cast sem validação de forma
  }
  ```
  `grep -n "zod" src/frontend/lib/sispag.ts src/frontend/app/sispag/components/GerarRemessaDialog.tsx` → 0 ocorrências.
- **Impacto técnico**: se o backend mudar a forma de `JanelaDataDebito` (por exemplo, renomear `motivo` ou adicionar um novo valor ao union `vazia.motivo`) sem lembrar de atualizar `lib/sispag.ts`, o TypeScript do frontend não pega o drift em runtime — só em build, e só se o campo divergente for usado num tipo estreito. O `as T` faz o `GerarRemessaDialog` confiar cegamente na forma da resposta.
- **Impacto de negócio**: uma resposta inesperada do backend (ex.: `vazia.motivo` com um novo valor não mapeado em `explicarJanelaVazia`) cai no `default` genérico da tela em vez de falhar de forma visível — a analista vê uma mensagem menos precisa em vez de um erro auditável, num fluxo que decide QUANDO dinheiro sai do banco.
- **Métrica de baseline**: 0 arquivos com Zod nos 2 arquivos de frontend do delta que consomem a nova rota `/remessa/janela` e `/remessa` (POST).

### F-integrability-2: `RemessaService` concentra 10 colaboradores injetados, 3 deles Clients — hotspot de troca de provedor

- **Severidade**: P2
- **Tactic violada**: Use an Intermediary / Manage Resource Coupling
- **Localização**: `src/backend/domain/service/sispag/RemessaService.ts:117-130`
- **Evidência (objetiva)**:
  ```
  public constructor(
      @inject(LotePagamentoRepository) private readonly loteRepo: LotePagamentoRepository,
      @inject(RemessaExecucaoRepository) private readonly ledger: RemessaExecucaoRepository,
      @inject(ConexosSispagWriteClient) private readonly write: ConexosSispagWriteClient,
      @inject(ConexosSispagClient) private readonly sispag: ConexosSispagClient,
      @inject(EnvironmentProvider) private readonly environmentProvider: EnvironmentProvider,
      @inject(LogService) private readonly logService: LogService,
      @inject(PostgreeDatabaseClient) private readonly db: PostgreeDatabaseClient,
      @inject(RemessaCnabValidator) private readonly cnab: RemessaCnabValidator,
      @inject(DebitDateService) private readonly debitDate: DebitDateService,
      @inject(BankingCalendar) private readonly calendar: BankingCalendar,
  ) {}
  ```
  10 dependências injetadas, 3 são Clients (`ConexosSispagWriteClient`, `ConexosSispagClient`, `PostgreeDatabaseClient`) — acima do limite de 2 da heurística de anti-corruption layer. O delta adiciona 2 novas (`DebitDateService`, `BankingCalendar`), aprofundando a orquestração síncrona em série de 6+ chamadas ao ERP (`criarLote` → `importarTitulos` → `finalizarLote` → `sugerirRemessa` → `gerarRemessa` → `listarArquivosRemessa`, linhas 462-559).
- **Impacto técnico**: trocar o provedor de gateway bancário por trás do fin015, ou subir a API do Conexos de versão, obriga a tocar o mesmo arquivo de 1112 linhas que já concentra idempotência, retomada por sync-com-ERP, validação CNAB e agora a decisão de data de débito — o raio de mudança de uma troca de integração não fica isolado num client fino.
- **Impacto de negócio**: qualquer manutenção futura no boundary Conexos/Nexxera nesta frente carrega risco de regressão nas outras responsabilidades do mesmo arquivo (idempotência, fail-closed em `reconciling`), aumentando o tempo de QA manual antes de liberar.
- **Métrica de baseline**: 10 colaboradores injetados / limite heurístico de 2 clients diretos por service; arquivo com 1112 linhas totais (101 adicionadas neste delta).

### F-integrability-3: Testes do delta validam `DebitDateService`/`RemessaService` só com mocks, sem fixture de payload real do fin015

- **Severidade**: P3
- **Tactic violada**: Contract testing
- **Localização**: `src/backend/domain/service/sispag/RemessaService.test.ts:1-17`, `src/backend/domain/service/sispag/DebitDateService.test.ts:1-40`
- **Evidência (objetiva)**:
  ```
  const repo = { getLoteComItens: jest.fn().mockResolvedValue(l) };
  return { repo, service: new DebitDateService(repo as unknown as LotePagamentoRepository, calendarAt(hoje)) };
  ```
  Nenhum dos 2 arquivos de teste novos/alterados carrega um fixture gravado de resposta real do `ConexosSispagWriteClient` (`criarLote`, `listarLotesNativos`); tudo é `jest.fn()` com retorno sintético.
- **Impacto técnico**: mudanças no formato real das respostas do fin015 (ex.: novo campo, tipo alterado) não são pegas por este conjunto de testes — só por QA manual em HML, que é como o time já vem descobrindo comportamento do ERP (ver comentários "medido em HML" espalhados pelo próprio `RemessaService.ts`).
- **Impacto de negócio**: risco de regressão silenciosa entre ciclos de `/feature-tweak` na mesma frente, especialmente quando o Conexos alterar o encoding de `flpDtaCredito` ou a paginação de `listarTitulosPendentes`.
- **Métrica de baseline**: 0 de 2 arquivos de teste do delta usam fixture-based parsing; é o mesmo padrão do restante do módulo SISPAG (não é uma regressão introduzida por este delta, é debt herdado que o delta não fecha).

### F-integrability-4: `dryRun`/`confirmarNovoLote` seguem sem schema Zod (passthrough) no mesmo endpoint tocado pelo delta

- **Severidade**: P3
- **Tactic violada**: Tailor Interface / Adhere to Standards
- **Localização**: `src/backend/routes/sispag.ts:434-438,484-487`
- **Evidência (objetiva)**:
  ```
  const gerarRemessaSchema = z.object({ dataDebito: civilDateSchema.optional() }).passthrough();
  ...
  ...(req.body?.dryRun === true ? { dryRunOverride: true } : {}),
  ...(req.body?.confirmarNovoLote === true ? { confirmarNovoLote: true } : {}),
  ```
  O comentário do próprio código já documenta a decisão consciente de não mexer nesses 2 campos ("mudar o contrato deles não é escopo da ADR-0049"), mas o efeito prático é que o mesmo endpoint tem uma parte validada por Zod (`dataDebito`) e outra lida por leitura estrita direto do `req.body`.
- **Impacto técnico**: baixo — leitura `=== true` é segura contra tipos inesperados (qualquer coisa que não seja o boolean `true` vira `false`), mas o padrão fica inconsistente dentro do mesmo handler.
- **Impacto de negócio**: nenhum imediato; é uma oportunidade de limpeza quando o endpoint for revisitado.
- **Métrica de baseline**: 1 de 3 campos do corpo de `POST /sispag/lotes/:id/remessa` validado por Zod (`dataDebito`); os outros 2 seguem passthrough — escopo explicitamente descartado nesta ADR.

## 5. Cards Kanban

### [integrability-1] Validar a resposta de `/remessa/janela` e `/remessa` com Zod no frontend

- **Problema**
  > `lib/sispag.ts` consome `JanelaDataDebito` e `GerarRemessaResult` com um cast `as T` sem checagem de forma em runtime (`src/frontend/lib/sispag.ts:503`); o tipo é uma cópia manual do backend (`SispagInterface.ts:291-312`), então drift entre as duas pontas só aparece como comportamento errado na tela, não como erro explícito.

- **Melhoria Proposta**
  > Adicionar um schema Zod espelhando `JanelaDataDebito`/`GerarRemessaResult` em `lib/sispag.ts` (ou um módulo `lib/schemas/sispag.ts`) e trocar o `body as T` de `sispagRequest` por `schema.parse(body)` nos dois endpoints tocados pelo delta (`fetchJanelaDataDebito`, `gerarRemessa`). Tactic alvo: **Adhere to Standards** / **Contract testing**.

- **Resultado Esperado**
  > Resposta fora de forma lança erro explícito e logado (`Error: shape inválido de JanelaDataDebito`) em vez de silenciosamente quebrar `explicarJanelaVazia`/`erroDaData`. Métrica: 0 → 2 endpoints com Zod no frontend do módulo SISPAG.

- **Tactic alvo**: Adhere to Standards
- **Severidade**: P2
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-integrability-1
- **Métricas de sucesso**:
  - Arquivos de frontend com Zod nos boundaries SISPAG: 0 → ≥2 (`fetchJanelaDataDebito`, `gerarRemessa`)
- **Risco de não fazer**: um campo renomeado no backend (ex.: `vazia.motivo` ganhar um novo valor) muda o comportamento da tela sem qualquer sinal de erro visível ao time.
- **Dependências**: nenhuma — isolado ao arquivo `lib/sispag.ts`.

### [integrability-2] Extrair um adapter fino para as 6 chamadas em série do fin015 dentro de `RemessaService`

- **Problema**
  > `RemessaService.gerarRemessaSerializado` orquestra 3 Clients (`ConexosSispagWriteClient`, `ConexosSispagClient`, `PostgreeDatabaseClient`) e 10 colaboradores no total, com uma sequência síncrona de 6+ chamadas ao ERP (`criarLote` → `importarTitulos` → `finalizarLote` → `sugerirRemessa` → `gerarRemessa` → `listarArquivosRemessa`), e o delta aprofundou essa cadeia inserindo a decisão de data de débito antes do primeiro POST (`RemessaService.ts:117-130,327-467`).

- **Melhoria Proposta**
  > Extrair a sequência de escrita fin015 (passos 1-5 do comentário "POR QUE TANTA CERIMÔNIA") para um objeto de orquestração dedicado (`RemessaFin015Orchestrator` ou similar) que recebe só `ConexosSispagWriteClient` + o ledger, deixando `RemessaService` como fachada que resolve data/conta pagadora e delega a escrita. Tactic alvo: **Use an Intermediary**.

- **Resultado Esperado**
  > `RemessaService` cai de 10 para ≤6 colaboradores diretos; a lógica de retomada/sync-com-ERP fica isolada num único ponto de mudança quando o fin015 subir de versão ou o gateway bancário trocar.

- **Tactic alvo**: Use an Intermediary
- **Severidade**: P2
- **Esforço estimado**: L (1-2sem) — a extração precisa preservar o ledger write-ahead e a cobertura de teste existente (321 linhas de `RemessaService.test.ts` só neste delta)
- **Findings relacionados**: F-integrability-2
- **Métricas de sucesso**:
  - Colaboradores injetados em `RemessaService`: 10 → ≤6
  - Clients injetados diretamente: 3 → ≤1 (via o novo orquestrador)
- **Risco de não fazer**: cada ciclo de `/feature-tweak` nesta frente (já são 5 commits recentes só para a data de débito) continua acumulando responsabilidade no mesmo arquivo; a próxima mudança no gateway bancário (Nexxera) ou versão do fin015 tem custo de revisão crescente.
- **Dependências**: nenhuma decisão de produto — é refactor puro; fazer depois de estabilizar a ADR-0049 em produção para não competir por atenção de QA manual.

### [integrability-3] Gravar um fixture real do fin015 para `RemessaService`/`DebitDateService`

- **Problema**
  > Os testes do delta mockam `ConexosSispagWriteClient` com `jest.fn()` sintético; não há um payload gravado (JSON) de uma resposta real de `criarLote`/`listarLotesNativos`/`listarTitulosPendentes` observada em HML, apesar do próprio `RemessaService.ts` documentar várias invariantes "medidas em HML" nos comentários.

- **Melhoria Proposta**
  > Capturar 1-2 payloads reais (dry-run em HML, sem dado sensível) e versionar como fixture em `src/backend/domain/client/__fixtures__/fin015/`; adicionar um teste de `ConexosSispagWriteClient` que faz o parse desse fixture e valida os campos que `RemessaService` depende (`flpCod`, `titulosCount`, `dataDebito`). Tactic alvo: **Contract testing**.

- **Resultado Esperado**
  > Pelo menos 1 teste de client cobrindo o parsing de um payload real do fin015, reduzindo a chance de o time só descobrir mudança de formato do ERP em produção.

- **Tactic alvo**: Contract testing
- **Severidade**: P3
- **Esforço estimado**: M (2-5d) — depende de acesso a HML para capturar o payload
- **Findings relacionados**: F-integrability-3
- **Métricas de sucesso**:
  - Testes de `ConexosSispagWriteClient` com fixture real: 0 → ≥1
- **Risco de não fazer**: debt aceitável no curto prazo; o risco só se materializa quando o Conexos alterar o schema do fin015 sem aviso, o que já aconteceu de fato pelo menos uma vez segundo os comentários do código (encoding de `itsVldModalidade` sobrescrito pelo ERP).
- **Dependências**: acesso a ambiente HML com dado de teste (não produção).

## 6. Notas do agente

- Escopo do delta (`--quick`): revisão restrita aos arquivos listados em `_shared-metrics.md`; `ConexosSispagWriteClient.ts`/`ConexosSispagClient.ts` não foram alterados pelo delta e por isso a tactic "Versioning strategy" foi marcada `N/A (não tocado)` em vez de gerar finding — seria um achado herdado, não desta feature.
- Nenhum P0 encontrado: a decisão de data de débito é fail-closed antes de qualquer escrita (`DebitDateService.validate` roda antes do `criarLote`), e a migração é aditiva/nullable sem backfill — não há evidência numérica de defeito crítico dentro do delta.
- **Cross-QA**: F-integrability-1 (validação de resposta no frontend) e F-integrability-4 (passthrough parcial no `POST /remessa`) sobrepõem Security/Fault Tolerance — sinalizar ao consolidator para não duplicar contagem se os agentes `qa-security`/`qa-fault-tolerance` também os levantarem. F-integrability-2 (orquestrador denso) sobrepõe Modifiability — mesmo arquivo (`RemessaService.ts`) provavelmente citado lá também.
