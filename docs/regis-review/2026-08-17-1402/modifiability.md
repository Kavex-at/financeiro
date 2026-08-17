---
qa: Modifiability
qa_slug: modifiability
run_id: 2026-08-17-1402
agent: qa-modifiability
generated_at: 2026-08-17T14:02:00-03:00
scope: backend
score: 7
findings_count: 5
cards_count: 5
---

# Modifiability — Regis-Review

> Escopo DELTA (`fix/nde-painel-lista`, base `main`). Foco nas superfícies que a feature moveu:
> `NdeRepositoryInterface` (+3 métodos), `NdeRepository` (+82 LOC de projeção + `contarPendentes` que
> lê da tabela da execução), `RecebimentosPainelService` (5→7 deps, +hidratarNdes/+hidratarUma),
> `constants.ts` (3 novos caps + `NDE_MOEDA_PADRAO` promovida) e a regra "pendente" replicada em 3
> lugares (SQL do count, `computeKpis` do FE, coluna da tabela).

## 1. Cenário Geral (Bass General Scenario aplicado ao nf-projects)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Product (Yuri) / suporte fiscal | Regra fiscal muda: "pendente" passa a considerar também `revisaoHumana` OU tempo desde emissão (novo SLA SEFAZ); ou a origem da projeção precisa de mais um campo do ledger | Projeção `NdePainelRow` + porta `NdeRepositoryInterface` + KPI `ndePendentes` + coluna da tabela + hidratação com297 | Feature em produção, painel em uso por analistas Columbia, 9 suítes e2e vermelhas ao menor drift entre banco/FE | Alterar a definição EM UM LUGAR, propagar por typecheck, sem retocar 9 stubs de teste, sem que backend e frontend divirjam sobre o que conta como "fechado" | 1 arquivo alterado, ≤ 1 dia de esforço, 0 regressão em card × tabela; nenhum stub de teste tocado para adicionar propriedade nova |

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| LOC `RecebimentosPainelService.ts` | 326 (era ~215; +51%) | ≤ 400 (limiar do projeto) | ⚠️ | `wc -l src/backend/domain/service/recebimentos/RecebimentosPainelService.ts` |
| Dependências injetadas em `RecebimentosPainelService` | 7 (era 5) | ≤ 5 (heurística "small service") | ⚠️ | ctor `RecebimentosPainelService.ts:109-120` |
| Métodos públicos + privados de `RecebimentosPainelService` | 1 público + 5 privados | 1 público + ≤ 3 privados | ⚠️ | grep método arrow |
| Cognitive complexity — `hidratarNdes`, `hidratarUma`, `enriquecerComModalidade` | 0 warnings biome | < 15 | ✅ | `npx biome lint --diagnostic-level=warn ...PainelService.ts` (0 findings) |
| LOC `NdeRepository.ts` | 185 (era ~90; +105%) | ≤ 200 (repositório fino) | ✅ (ainda dentro) | `wc -l ...NdeRepository.ts` |
| Imports em `NdeRepository.ts` | 6 | ≤ 10 | ✅ | `grep -c ^import ...NdeRepository.ts` |
| Fan-out da extensão da porta (`NdeRepositoryInterface` +3 métodos) | 9 arquivos de teste alterados só para adicionar stubs `listParaPainel`/`contarPendentes`/`updateNumeroNde` | ≤ 2 (impl real + shared fake) | ❌ | `git diff main --stat src/backend/routes/recebimentos.e2e.*.test.ts` |
| Fan-in de `NdeRepositoryInterface` (arquivos que importam a interface ou o token) | 15 | — (métrica descritiva) | ⚠️ | `grep -rln "NdeRepository\\|NDE_REPOSITORY_TOKEN" src/backend --include='*.ts'` |
| Consumidores REAIS (não-teste) de `NdeRepositoryInterface` | 2 (`RecebimentoNumerarioService` grava; `RecebimentosPainelService` lê+reconcilia) | — | ⚠️ (interface serve papéis diferentes) | grep manual |
| Cross-repository read — `NdeRepository` selecionando de `solicitacao_numerario_execucao` | 1 lugar (`NdeRepository.ts:22-27, 88-101, 103-115`) | 0 (regra "um repo por tabela") | ⚠️ **mitigado** | ADR-0034 + `ontology/entities/nota-debito-eletronica.md:109-135` documentam a inversão explicitamente |
| Duplicação da regra "pendente = NOT(emitida AND autorizada)" | 3 lugares | 1 (fonte única) | ⚠️ | `NdeRepository.ts:110-111`, `src/frontend/lib/recebimentos.ts:182`, `NdeTable.tsx:121-125` (composição implícita) |
| Constantes de política de hidratação (`PAINEL_NDE_HIDRATACAO_CAP=20`, `LOTE=5`, `PAINEL_NDES_CAP=200`) | Compile-time em `constants.ts:270-283` | Env-overridable (defer binding — cap 20 governa carga no ERP compartilhado) | ⚠️ | `constants.ts:270-283` |
| Constante promovida a shared (`NDE_MOEDA_PADRAO`) | Migrou de const local de `RecebimentoNumerarioService` para `constants.ts:286` | ✅ movimento de refactor no sentido certo (defer binding + fonte única) | ✅ | `git diff main -- ...RecebimentoNumerarioService.ts` (linha `-const NDE_MOEDA_PADRAO`) |
| Layer-skipping introduzido pelo delta | 0 | 0 | ✅ | Service→Repo→Client mantida; hidratação chama fiscalClient via injeção, não bypass |
| ADR/ontologia atualizada com a decisão de inversão da fonte | Sim (ADR-0034 citado em `nota-debito-eletronica.md:112`) | Sim | ✅ | `git diff main -- ontology/entities/nota-debito-eletronica.md` |

## 3. Tactics — Cobertura no nf-projects

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Split Module | `RecebimentosPainelService` acumulou orquestração de 3 fontes (transações + NDes + hidratação SEFAZ) + reconciliação write-through do `nde_autorizado`/`numero_nde`. `NdeRepository` acumulou CRUD + projeção de leitura cross-tabela. | ⚠️ parcial | `RecebimentosPainelService.ts:247-304` (hidratação+reconciliação misturadas); `NdeRepository.ts:22-115` (SQL de leitura em porta diferente do save) |
| Increase Semantic Coherence | `NdeRepositoryInterface` mistura contrato de ESCRITA da entidade (`save`, `findByRecebimentoId`, `updateNumeroNde`) com contrato de LEITURA da projeção do painel (`listParaPainel`, `contarPendentes`). Papéis distintos — evidência: `updateNumeroNde` é chamado pelo caminho de reconciliação da leitura, não pelo caminho de emissão. | ⚠️ parcial | `ports.ts:570-581`; consumidores reais em `RecebimentoNumerarioService` (escrita) vs `RecebimentosPainelService` (leitura+reconciliação) |
| Encapsulate | Regra "pendente" NÃO está encapsulada: aparece como predicado SQL (`NdeRepository.ts:110-111`), como reduce JS (`recebimentos.ts:182`) e como composição de badges (`NdeTable.tsx:121-125`). | ❌ ausente | `grep "statusEmissao === 'emitida'"` retorna 2 hits em stacks distintos + 1 SQL |
| Use an Intermediary | `hidratarUma` intermedia `fiscalClient` (`ConexosNdeFiscalClient`) e o repositório de execução, mas com IF/optional-chain no meio — não há um `NdeHidratadorService` isolando a chamada externa da regra de reconciliação. | ⚠️ parcial | `RecebimentosPainelService.ts:274-304` (3 responsabilidades: reler ERP, derivar autorização, write-back) |
| Restrict Dependencies | 7 deps no `RecebimentosPainelService` (`TransacaoRepository`, `RecebimentoIngestaoRunRepository`, `ConexosBaseClient`, `ProcessoProviderInterface`, `SolicitacaoNumerarioExecucaoRepositoryInterface`, `NdeRepositoryInterface`, `ConexosNdeFiscalClient`). Aproxima a fronteira "god service". | ⚠️ parcial | `RecebimentosPainelService.ts:109-120` |
| Refactor | `NDE_MOEDA_PADRAO` promovido de const local para `constants.ts:286` — movimento correto (fonte única, defer binding). | ✅ presente | `git diff main -- ...RecebimentoNumerarioService.ts` |
| Abstract Common Services | `NdeRepositoryInterface` cresceu por adição em vez de por composição de duas portas (uma de comando, uma de projeção de leitura). Segregação seria uma `NdePainelReadRepositoryInterface` separada. | ❌ ausente | `ports.ts:570-581` — 5 métodos em uma única porta |
| Defer Binding — DI/tsyringe | `NDE_REPOSITORY_TOKEN`/`SOLICITACAO_NUMERARIO_EXECUCAO_REPOSITORY_TOKEN` estão via `@inject(...)` com `Symbol` — swap por stub in-memory é trivial. | ✅ presente | `RecebimentosPainelService.ts:114-119` |
| Defer Binding — Configuration | `PAINEL_NDE_HIDRATACAO_CAP=20`, `PAINEL_NDE_HIDRATACAO_LOTE=5`, `PAINEL_NDES_CAP=200` são compile-time. O comentário do `CAP` reconhece que a razão é "não afogar o ERP compartilhado" — exatamente o tipo de knob que devia ser tunável em incidente sem redeploy. | ⚠️ parcial | `constants.ts:270-283` |
| Defer Binding — Polymorphism | `NdeRepositoryInterface` tem 1 impl real; nenhuma variação por tenant/canal. Aceitável para o escopo atual (Fase 5 uni-tenant). | N/A (aceitável) | Só 1 `implements NdeRepositoryInterface` no repo |

## 4. Findings (achados)

### F-modifiability-1: `NdeRepositoryInterface` violou ISP — 9 arquivos de teste tocados para adicionar stubs de método que não usam

- **Severidade**: P1
- **Tactic violada**: Increase Semantic Coherence + Abstract Common Services
- **Localização**: `src/backend/domain/interface/recebimentos/ports.ts:570-581`; consumidores: `src/backend/domain/service/recebimentos/RecebimentoNumerarioService.ts` (só `save`), `src/backend/domain/service/recebimentos/RecebimentosPainelService.ts` (`listParaPainel`, `contarPendentes`, `updateNumeroNde`); stubs tocados: `src/backend/routes/recebimentos.e2e.{falhas,gates,test,retomada,hmlWrite.integration,hmlTituloCondicao.integration,hmlTituloOrdem.integration,hmlTituloZero.integration,prodWrite.integration}.test.ts`
- **Evidência (objetiva)**:
  ```
  git diff main --stat src/backend/routes/recebimentos.e2e.*.test.ts
  → 9 arquivos, +37 linhas — todas do mesmo shape:
      listParaPainel: async () => [],
      contarPendentes: async () => 0,
      updateNumeroNde: async () => undefined,
  ```
- **Impacto técnico**: cada nova porta de leitura no painel obriga tour por todos os stubs, mesmo os
  que exercitam só a emissão. É retrabalho mecânico e é onde as coisas passam a ser esquecidas
  (stub desatualizado + `Cannot read properties of undefined` em outro teste).
- **Impacto de negócio**: cada mudança na projeção do painel custa 30–60 min de patch em suítes que
  não têm nada a ver com o que mudou — no ritmo atual (Frente IV ainda tem gates, alocação e
  arquivamento evoluindo), isso é multiplicado várias vezes ao mês.
- **Métrica de baseline**: fan-out da extensão = **9 arquivos**; alvo = 2 (impl real + shared fake).

### F-modifiability-2: `NdeRepository` lê da tabela `solicitacao_numerario_execucao` — cross-repository coupling em nível de schema

- **Severidade**: P2 (mitigado por ADR-0034 + entrada de ontologia)
- **Tactic violada**: Restrict Dependencies
- **Localização**: `src/backend/domain/repository/recebimentos/NdeRepository.ts:22-27` (constante `PAINEL_FROM_WHERE`), `88-101` (`listParaPainel`), `103-115` (`contarPendentes`)
- **Evidência (objetiva)**:
  ```
  const PAINEL_FROM_WHERE = `FROM solicitacao_numerario_execucao e
               LEFT JOIN nota_debito_eletronica n ON n.idempotency_key = e.idempotency_key
              WHERE e.fil_cod = ANY($filCods)
                AND e.dry_run = false
                AND COALESCE(e.nde_dispensada, false) = false
                AND (e.nd_doc_cod IS NOT NULL OR n.id IS NOT NULL)`;
  ```
- **Impacto técnico**: qualquer migração em `solicitacao_numerario_execucao` (renomear coluna, mudar
  domínio de `dry_run`/`nde_dispensada`/`nd_doc_cod`) agora tem raio de impacto duplo — os dois
  repositórios precisam mudar juntos. Sem ORM, o compilador não pega isso.
- **Impacto de negócio**: a decisão está bem-documentada (`ontology/entities/nota-debito-eletronica.md:109-135`
  + ADR-0034), então NÃO é dívida oculta; é dívida assumida. O risco é o próximo dev fazer a mesma
  inversão para outra projeção sem seguir a doutrina — o padrão precisa virar componente nomeado
  (`NdePainelReadRepository`) ou vira convite.
- **Métrica de baseline**: cross-table reads em repositórios = **1** (contido); alvo = 0 OU explicitar
  como classe separada com nome que declare o papel.

### F-modifiability-3: regra "NDe pendente = NOT(emitida AND autorizada)" duplicada em 3 stacks

- **Severidade**: P1
- **Tactic violada**: Encapsulate
- **Localização**:
  - `src/backend/domain/repository/recebimentos/NdeRepository.ts:110-111` (SQL do count)
  - `src/frontend/lib/recebimentos.ts:182` (`computeKpis`)
  - `src/frontend/app/recebimentos/components/NdeTable.tsx:121-125` (composição visual via `statusEmissao === 'emitida'` + `SefazBadge` derivado de `ndeAutorizado`)
- **Evidência (objetiva)**:
  ```
  # backend SQL (fonte de verdade para o KPI)
  NOT (COALESCE(n.status_emissao, '') = 'emitida' AND COALESCE(e.nde_autorizado, false) = true)

  # frontend TS (fallback quando backend não devolve KPI)
  !(n.statusEmissao === 'emitida' && n.ndeAutorizado === true)

  # tabela (implícita — composição de duas colunas)
  n.statusEmissao === 'emitida' ? <SefazBadge autorizado={n.ndeAutorizado} /> : '—'
  ```
- **Impacto técnico**: se amanhã a regra passa a incluir `revisaoHumana` OU um recorte por tempo, é
  MUITO fácil mudar 2 dos 3 lugares e deixar o terceiro discordando — cenário típico "card diz 12
  pendentes, tabela mostra 8 vermelhas".
- **Impacto de negócio**: card mentiroso é o modo mais efetivo de erodir a confiança do analista no
  painel. E o KPI `ndePendentes` já tem lógica não-trivial (`Math.max(0, ndePendentes - ndes.reconciliadas)`
  em `RecebimentosPainelService.ts:168`) — um segundo lugar com a mesma regra escalada é o próximo bug.
- **Métrica de baseline**: fontes da regra = **3**; alvo = 1 (SQL + FE derivam de uma expressão nomeada
  reutilizável, ou o FE nunca calcula e depende só do KPI backend).

### F-modifiability-4: `RecebimentosPainelService` aproxima "god service" — 7 deps, hidratação + reconciliação num mesmo caminho

- **Severidade**: P2
- **Tactic violada**: Split Module + Use an Intermediary
- **Localização**: `src/backend/domain/service/recebimentos/RecebimentosPainelService.ts:109-120` (ctor 7 deps), `247-304` (hidratarNdes + hidratarUma)
- **Evidência (objetiva)**:
  ```
  ctor: TransacaoRepository, RecebimentoIngestaoRunRepository, ConexosBaseClient,
        ProcessoProviderInterface, SolicitacaoNumerarioExecucaoRepositoryInterface,
        NdeRepositoryInterface, ConexosNdeFiscalClient
  hidratarUma: (1) read com297 → (2) derivar autorização → (3) write-back local do
               nde_autorizado E do numero_nde. Três responsabilidades em 30 linhas.
  ```
- **Impacto técnico**: o serviço agora sabe montar painel, prever modalidade, hidratar NDe do ERP e
  reconciliar. Um deprecation em `ConexosNdeFiscalClient` ou uma mudança no contrato de reconciliação
  do `execucaoRepo` obriga tocar o mesmo arquivo do KPI. Cognitive complexity ainda passa (biome 0
  warnings), mas o número de razões-para-mudar já subiu.
- **Impacto de negócio**: a próxima feature ("hidratação por webhook Nexxera", "cache de com297",
  "background job em vez de on-request") vai forçar refactor grande — quanto mais tarde, pior.
- **Métrica de baseline**: deps = **7** (era 5); alvo = ≤ 5. LOC = **326** (dentro de 400, mas +51%
  em uma feature só). Extrair `NdePainelHidratadorService` (deps: `execucaoRepo`, `ndeRepo`,
  `fiscalClient`) devolve o painel para 5 deps.

### F-modifiability-5: caps de hidratação são compile-time — `PAINEL_NDE_HIDRATACAO_CAP=20`, `LOTE=5`, `PAINEL_NDES_CAP=200`

- **Severidade**: P3
- **Tactic violada**: Defer Binding (Configuration)
- **Localização**: `src/backend/domain/interface/recebimentos/constants.ts:270-283`
- **Evidência (objetiva)**:
  ```
  /** Quantas NDes o painel hidrata AO VIVO no com297 por carga (`GET com297/{docCod}`). */
  export const PAINEL_NDE_HIDRATACAO_CAP = 20;
  /** Quantas hidratações correm em paralelo — o ERP é compartilhado; a rajada vira lotes. */
  export const PAINEL_NDE_HIDRATACAO_LOTE = 5;
  ```
- **Impacto técnico**: os comentários EXPLICITAM que a razão é carga no ERP compartilhado — que é
  exatamente o cenário em que se quer baixar o cap sem esperar um redeploy Render (5–8 min). Cada
  ajuste hoje = commit + PR + deploy + smoke.
- **Impacto de negócio**: sob incidente Conexos ("lento hoje"), a única mitigação disponível é
  "esperar o pico passar" ou "deploy emergencial". Ambos custam.
- **Métrica de baseline**: constantes de política externalizáveis = **3**; alvo = 3 lidos via
  `EnvironmentProvider` com fallback compile-time (padrão já usado para `SN_GCD_COD`).

## 5. Cards Kanban

### [modifiability-1] Segregar `NdeRepositoryInterface` em porta de comando + porta de projeção de leitura

- **Problema**
  > A porta atual mistura o CRUD da entidade (`save`, `findByRecebimentoId`, `updateNumeroNde`) com a
  > projeção do painel (`listParaPainel`, `contarPendentes`). Consequência mensurada: adicionar os 3
  > métodos exigiu editar 9 arquivos de teste só para redigitar stubs `async () => []` / `async () => 0`.
  > `RecebimentoNumerarioService` (emissão) usa só `save`; `RecebimentosPainelService` (painel) usa só
  > as três novas — os papéis já estão separados na prática, mas não no tipo.

- **Melhoria Proposta**
  > Extrair `NdePainelReadRepositoryInterface` (métodos `listParaPainel`, `contarPendentes`) em
  > `ports.ts`, com token próprio (`NDE_PAINEL_READ_REPOSITORY_TOKEN`). `NdeRepository` continua
  > implementando as duas interfaces (uma classe, dois contratos). `RecebimentosPainelService` injeta
  > a porta de leitura; `RecebimentoNumerarioService` mantém a porta de escrita. Tactic:
  > **Increase Semantic Coherence** + **Abstract Common Services**. Como corolário: criar
  > `src/backend/domain/repository/recebimentos/__testfakes__/NdeRepositoryFake.ts` com o stub
  > completo e sinalizar os 9 e2es para consumirem esse fake.

- **Resultado Esperado**
  > A próxima extensão da projeção do painel toca 2 arquivos (impl real + fake compartilhado), não 9
  > + fake. Compile time do typecheck flagrant se um consumidor de escrita começar a chamar métodos
  > de leitura por acidente.

- **Tactic alvo**: Increase Semantic Coherence, Abstract Common Services
- **Severidade**: P1
- **Esforço estimado**: S (≤1d) — segregação da interface é mecânica; criar o fake compartilhado é o
  esforço real
- **Findings relacionados**: F-modifiability-1
- **Métricas de sucesso**:
  - Arquivos alterados na próxima extensão da projeção: 9 → 2
  - Consumidores REAIS de `NdeRepositoryInterface` (escrita): 1 (`RecebimentoNumerarioService`)
  - Consumidores REAIS de `NdePainelReadRepositoryInterface` (leitura): 1 (`RecebimentosPainelService`)
- **Risco de não fazer**: a próxima feature de painel (aba de auditoria, filtros novos) repete o custo
  — e é onde alguém esquece um stub e alguma suíte quebra por razão que não tem nada a ver com a mudança.
- **Dependências**: nenhuma

### [modifiability-2] Encapsular a regra "NDe pendente" numa expressão nomeada única

- **Problema**
  > A definição `NDe fechada ⟺ (statusEmissao === 'emitida' AND ndeAutorizado === true)` está em 3
  > lugares: SQL do `contarPendentes` (backend), `computeKpis` (frontend) e a composição visual em
  > `NdeTable.tsx`. Um patch amanhã que acrescente `revisaoHumana === false` (cenário plausível: o
  > operacional quer separar "com194 revisada" de "fechada") tem 3 pontos de mudança e uma janela de
  > drift onde o card mostra X e a tabela filtra Y.

- **Melhoria Proposta**
  > Backend: extrair `NDE_FECHADA_SQL` (fragmento parametrizado) em `constants.ts` do domínio
  > recebimentos, usado por `contarPendentes` e por futuras projeções. Frontend: extrair
  > `isNdeFechada(n: NotaDebitoEletronica): boolean` em `src/frontend/lib/recebimentos.ts`, usado por
  > `computeKpis` E consumido por `NdeTable.tsx` como fonte única. Tactic: **Encapsulate**. A regra
  > continua nas duas linguagens (SQL e TS), mas cada lado tem UM lugar para mudar.

- **Resultado Esperado**
  > Adicionar `revisaoHumana` à definição de "fechada" é um patch em 2 pontos (SQL fragment + TS
  > helper), com typecheck garantindo que todos os call-sites já consomem a nova regra.

- **Tactic alvo**: Encapsulate
- **Severidade**: P1
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-modifiability-3
- **Métricas de sucesso**:
  - Fontes da regra: 3 → 2 (SQL fragment + TS helper)
  - Divergências backend/frontend detectadas em produção: 0 (medir via card × filtro de tabela)
- **Risco de não fazer**: bug de "KPI mente" quando a regra evoluir — e ela vai evoluir (revisão
  humana + tempo SEFAZ são candidatos já discutidos na ontologia).
- **Dependências**: nenhuma

### [modifiability-3] Extrair `NdePainelHidratadorService` de `RecebimentosPainelService`

- **Problema**
  > `RecebimentosPainelService` foi de 5 para 7 dependências e ganhou 2 métodos privados (`hidratarNdes`,
  > `hidratarUma`) que orquestram: (a) leitura do com297 via `ConexosNdeFiscalClient`, (b) derivação
  > da autorização SEFAZ, (c) write-back local em duas tabelas (`solicitacao_numerario_execucao` e
  > `nota_debito_eletronica`). São razões-para-mudar distintas do "montar painel". O serviço ainda
  > passa no biome (0 warnings de cognitive complexity), mas está no caminho crítico de virar
  > "god service".

- **Melhoria Proposta**
  > Criar `NdePainelHidratadorService` (deps: `execucaoRepo`, `ndeRepo`, `fiscalClient`) com método
  > público `hidratar(ndes: NdePainelRow[]): Promise<{ linhas; reconciliadas }>`.
  > `RecebimentosPainelService` passa a injetar esse serviço em vez dos 3 clientes. Deps do painel
  > voltam a 5. Tactic: **Split Module** + **Use an Intermediary**. Bonus: torna o hidratador testável
  > isoladamente sem stubs de 6 dependências.

- **Resultado Esperado**
  > `RecebimentosPainelService` volta a 5 deps e ~260 LOC. `NdePainelHidratadorService` fica com ~80
  > LOC e 3 deps. Suítes do painel deixam de precisar mockar `ConexosNdeFiscalClient`.

- **Tactic alvo**: Split Module, Use an Intermediary
- **Severidade**: P2
- **Esforço estimado**: S (≤1d) — mecânico, todos os testes cobertos
- **Findings relacionados**: F-modifiability-4
- **Métricas de sucesso**:
  - Deps de `RecebimentosPainelService`: 7 → 5
  - LOC de `RecebimentosPainelService.ts`: 326 → ~260
  - Deps do novo `NdePainelHidratadorService`: 3
- **Risco de não fazer**: a próxima feature de hidratação (cache, webhook, job em background) vira um
  refactor caro por acumulação — quanto mais tempo passa, mais features colam no serviço-monolito.
- **Dependências**: nenhuma (mas idealmente vem antes de [modifiability-1] para reduzir surface de teste)

### [modifiability-4] Externalizar caps de hidratação via `EnvironmentProvider`

- **Problema**
  > `PAINEL_NDE_HIDRATACAO_CAP=20`, `PAINEL_NDE_HIDRATACAO_LOTE=5` e `PAINEL_NDES_CAP=200` são
  > compile-time. Os comentários no próprio código EXPLICITAM que a razão de existirem é "não afogar o
  > ERP compartilhado" — que é exatamente o cenário em que se quer reduzir o cap sem esperar um
  > deploy Render (5–8 min). É o padrão inverso do `SN_GCD_COD` (já lido via `EnvironmentProvider`).

- **Melhoria Proposta**
  > Adicionar `painelNdeHidratacaoCap`, `painelNdeHidratacaoLote`, `painelNdesCap` em
  > `EnvironmentProvider` com fallback nas constantes atuais. Tactic: **Defer Binding
  > (Configuration)**. Sem sobrescrita = comportamento atual bit-a-bit. Com sobrescrita = knob de
  > incidente sem redeploy.

- **Resultado Esperado**
  > Durante um incidente Conexos, ops seta `PAINEL_NDE_HIDRATACAO_CAP=0` (desliga a hidratação sem
  > desligar o painel) ou `=5` (rajada menor) sem PR. Tempo de mitigação: minutos em vez de
  > horas-de-deploy.

- **Tactic alvo**: Defer Binding (Configuration)
- **Severidade**: P3
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-modifiability-5
- **Métricas de sucesso**:
  - Caps externalizáveis: 0 → 3
  - MTTR mitigável sob incidente Conexos: `redeploy Render` (5–8 min) → `restart Render` (~30s)
- **Risco de não fazer**: no próximo incidente de latência do ERP, a única mitigação é redeploy.
  Já aconteceu na Frente II (`LOGIN_ERROR_MAX_SESSIONS`) — mesma classe de problema.
- **Dependências**: nenhuma

### [modifiability-5] Renomear/documentar `NdeRepository` como cross-table read (ou extrair `NdePainelReadRepository`)

- **Problema**
  > `NdeRepository` lê da tabela `solicitacao_numerario_execucao` (dona de outro repositório) via
  > LEFT JOIN, para servir a projeção do painel. A decisão é DELIBERADA e está bem-documentada em
  > `ontology/entities/nota-debito-eletronica.md:109-135` e ADR-0034 — não é acidente. Mas o nome do
  > repositório NÃO carrega a informação: um dev novo lê "NdeRepository" e assume "só toca em
  > nota_debito_eletronica". Migração de schema em `solicitacao_numerario_execucao` agora quebra em
  > silêncio.

- **Melhoria Proposta**
  > Duas opções ranqueadas:
  > 1. **Preferida** — extrair `NdePainelReadRepository` (implementa `NdePainelReadRepositoryInterface`
  >    do card [modifiability-1]) que possui o JOIN. `NdeRepository` volta a tocar SÓ
  >    `nota_debito_eletronica`. Casa com a segregação da porta.
  > 2. **Mínima** — comentário-header em `NdeRepository` listando as tabelas que ele lê ("owns:
  >    nota_debito_eletronica; reads: solicitacao_numerario_execucao — ver ADR-0034") + item na
  >    checklist do PatternGuardian: "cross-table read em repository → PR menciona ADR".
  >
  > Tactic: **Restrict Dependencies**.

- **Resultado Esperado**
  > Migração de schema em `solicitacao_numerario_execucao` tem raio de impacto rastreável por nome de
  > arquivo (opção 1) OU por grep de "reads: solicitacao_numerario_execucao" (opção 2). Zero cross-repo
  > read sem menção explícita.

- **Tactic alvo**: Restrict Dependencies
- **Severidade**: P2
- **Esforço estimado**: S (≤1d) opção 2; M (2–3d) opção 1 (junto de [modifiability-1])
- **Findings relacionados**: F-modifiability-2, F-modifiability-1
- **Métricas de sucesso**:
  - Cross-table reads não-documentados por nome: 1 → 0
  - Tempo para descobrir "quem lê desta tabela" (grep) < 30s
- **Risco de não fazer**: próxima migração em `solicitacao_numerario_execucao` quebra silenciosamente
  o painel, e a origem do bug leva horas para achar (a suspeita natural é o repo dono da tabela, não
  o `NdeRepository`).
- **Dependências**: se optar pela versão 1, é a mesma unidade de trabalho de [modifiability-1] —
  fazer juntos.

## 6. Notas do agente

- Cognitive-complexity biome nas superfícies novas retornou **0 warnings** (`hidratarNdes`,
  `hidratarUma`, `enriquecerComModalidade`, `contarPendentes` — todas abaixo de 15). O sinal do delta
  é COESÃO/ACOPLAMENTO, não complexidade local.
- Cross-QA links para o consolidator: **F-modifiability-1** (fan-out de teste) toca
  **Testability** (a solução é um shared test-double, agenda comum). **F-modifiability-3** (regra
  duplicada BE/FE) toca **Integrability** (fonte única do contrato). **F-modifiability-4** (extrair
  hidratador) toca **Fault-Tolerance** (isolar a chamada externa facilita retry/circuit-breaker).
  **F-modifiability-5** (caps compile-time) toca **Deployability** (config em código = incidente vira
  redeploy) e **Availability** (MTTR sob degradação Conexos).
- Escopo: DELTA, não full-repo. Debitos pré-existentes fora do delta (ex.: `RecebimentoNumerarioService.ts`
  com 1777 LOC — biggest offender do repo) NÃO entraram como findings deste run, por regra do
  `_shared-metrics.md`.
