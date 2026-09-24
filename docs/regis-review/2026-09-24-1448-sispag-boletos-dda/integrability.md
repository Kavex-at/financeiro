---
qa: Integrability
qa_slug: integrability
run_id: 2026-09-24-1448-sispag-boletos-dda
agent: qa-integrability
generated_at: 2026-09-24T14:48:00-03:00
scope: backend
score: 8
findings_count: 4
cards_count: 4
---

# Integrability — Regis-Review

## 1. Cenário Geral (Bass General Scenario aplicado ao nf-projects)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Equipe adicionando uma nova aba do SISPAG (Boletos DDA) que consome dois novos endpoints Conexos (`fin124/list`, `fin124/itens/list/{ddcCod}`) e um novo snapshot local | Integrar leitura do pool `fin124` (~162 arquivos, ~24k boletos) e expor consolidado contra a carteira `titulo_a_pagar` | `ConexosDdaClient` (novo), `BoletoDdaService` + `ConsolidacaoBoletoDda`, `BoletoDdaRepository`, migração 0062, rotas `/sispag/boletos-dda*`, cliente FE em `lib/sispag.ts`, aba `BoletosDdaTab.tsx` | Feature em worktree isolado, gates verdes, medida em backend local com Conexos PRD | Nova leitura entra pela mesma família (`ConexosBaseClient`) reusando sessão, retry e paginação; snapshot local + advisory lock próprio evita colisão com ingestões existentes; UI recebe consolidado no mesmo contrato dos demais painéis SISPAG | Delta: 26 arquivos (~2371 linhas insertadas), 1 novo cliente Conexos, 1 nova migração aditiva; `sync full = 162 arquivos / 24 137 boletos / 0 falhas`; `GET /boletos-dda?escopo=todos` 393 ms; **0 rotas escrevendo no ERP**. |

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Métodos públicos do novo client são domínio-específicos (0 genéricos `get/post/request`) | 2/2 (`listarArquivos`, `listarItens`) | 100% | ✅ | `src/backend/domain/client/ConexosDdaClient.ts:62,80` |
| Zod no boundary de leitura Conexos | 2/2 endpoints (`ARQUIVO_SCHEMA`, `ITEM_SCHEMA`) usando `safeParse` tolerante | 100% | ✅ | `ConexosDdaClient.ts:20-43,66,84` |
| Serviço/rota importando `axios`/`fetch` diretamente | 0 | 0 | ✅ | `grep axios\|fetch src/backend/domain/service src/backend/routes` (nenhum caminho novo) |
| `process.env` fora de `EnvironmentProvider` no delta | 0 | 0 | ✅ | leitura de `ConexosDdaClient.ts`, `BoletoDdaService.ts`, `BoletoDdaRepository.ts` |
| Nova rota escrevendo no ERP | 0/2 (`GET /sispag/boletos-dda`, `POST /sispag/boletos-dda/sincronizar` — apenas snapshot local + leitura) | 0 | ✅ | `src/backend/routes/sispag.ts:415-446` |
| Advisory lock exclusivo da sincronização (evita coupling com outras ingestões) | `726354820` (distinto de pagamentos/permutas) | único | ✅ | `BoletoDdaService.ts:23` |
| Reuso de `ConexosBaseClient` (auth/session, retry, envelope paginado) | via `runWithRetry` + `ensureSid` + `listGenericPaginated` | reuso total | ⚠️ parcial — reimplementa laço de paginação em vez de `base.paginate` | `ConexosDdaClient.ts:112-143` vs `ConexosBaseClient.ts:260-318` |
| Contract test com fixture de shape REAL (medido em PRD) | 1 (`itemRow` — "Formato medido em PRD (fin124/itens/list/152, 2026-09-23)") | ≥1 por endpoint frágil | ✅ | `ConexosDdaClient.test.ts:14-27` |
| Tipos front espelhando o back sem codegen | ~85 linhas hand-mirrored (`BoletoDda`, `BoletoDdaTitulo`, `BoletosDdaResposta`, `SincronizacaoDdaResultado`) | 0 (idealmente OpenAPI/tRPC) | ⚠️ | `src/frontend/lib/sispag.ts:758-841` vs `src/backend/domain/interface/sispag/BoletoDda.ts:82-124` |
| Silent-truncation observability na paginação | ausente no laço local (`MAX_PAGINAS=60` sem `onCapHit`) | callback → log ao teto | ⚠️ | `ConexosDdaClient.ts:118-138` |
| Versionamento explícito na URL do provider externo | não (`fin124/list`, `fin124/itens/list/{ddcCod}`) | qualquer marcador de versão | ⚠️ **Não medível localmente** — Conexos ERP não expõe versionamento de rota; limitação do provider, não do delta |
| Cost-to-integrate próximo endpoint Conexos read-only (LOC ref. este PR) | 144 (cliente) + 43 (migração) + 140 (service) + 153 (repo) + 43 (rota) ≈ **523 LOC ao redor de 2 métodos de leitura** | ≤ ~500 LOC | ✅ ok (comparável a `ConexosExtratoClient`) | `git diff --stat origin/main...HEAD` |

## 3. Tactics — Cobertura no nf-projects

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Encapsulate | `ConexosDdaClient` expõe só `listarArquivos`/`listarItens`; a chamada HTTP crua fica em `ConexosBaseClient`. Nenhum serviço/rota importa `axios`/`fetch` para consumir `fin124`. | ✅ | `ConexosDdaClient.ts:62,80`; `BoletoDdaService.ts:41` |
| Use an Intermediary | `ConexosBaseClient` (sessão legacy + retry + envelope paginado) media todo o tráfego Conexos; o novo cliente injeta ele por composição. | ✅ | `ConexosDdaClient.ts:60`; `ConexosBaseClient.ts:146-164` |
| Restrict Communication Paths | Rotas `admin`-only, `heavyRouteLimiter` na sincronização, mesmo guard do `linhas-digitaveis` (LGPD/LC 105). Sincronização protegida por advisory lock exclusivo. | ✅ | `src/backend/routes/sispag.ts:419,435-436`; `BoletoDdaService.ts:23,72-80` |
| Adhere to Standards | Padrão da família Conexos (Zod no boundary, `ConexosError` no catch, `ensureSid` + `runWithRetry`) foi seguido; **desvio**: pagination laço local em vez de reusar `base.paginate` (como `ConexosCadastroClient`, `ConexosExtratoClient`). | ⚠️ parcial | `ConexosDdaClient.ts:112-143` vs `ConexosCadastroClient.ts:164`, `ConexosExtratoClient.ts:178-212` |
| Abstract Common Services | `runWithRetry`, `ensureSid`, `listGenericPaginated` reusados. `paginate` (com `onCapHit`) NÃO reusado — reintroduz laço `for` + parâmetros mágicos (`PAGE_SIZE=1000`, `MAX_PAGINAS=60`) que já existem no base. | ⚠️ parcial | ver acima |
| Discover Service | N/A no delta — nenhum novo endpoint de configuração/discovery; usa a URL Conexos já resolvida pelo legacy service. | N/A | — |
| Tailor Interface | Retorno "domain-shaped" (`ArquivoDda`, `ItemDda`, `BoletoDdaConsolidado`); `Zod.transform` remove padding do `ditEspNumero`, converte epoch → data civil, monta linha digitável (44→47) via `CodigoBarrasBoleto`. UI recebe registro pronto. | ✅ | `ConexosDdaClient.ts:46,90-110`; `CodigoBarrasBoleto.ts` |
| Configure Behavior | Constantes centralizadas (`RELEITURA_DIAS=60`, `FANOUT_LIMIT=3`, `JANELA_CANDIDATO_DIAS=3`, `BOLETO_DDA_SYNC_LOCK_KEY`). Nada em `process.env`. | ✅ | `BoletoDdaService.ts:23-30`; `ConsolidacaoBoletoDda.ts:21` |
| Manage Resources | `BoundedConcurrency(3)` no fan-out de `fin124/itens/list`, transação por arquivo, advisory lock exclusivo. | ✅ | `BoletoDdaService.ts:100-108,72-80` |
| Orchestrate | Serviço orquestra 3 leituras em paralelo (`Promise.all`: pool, carteira, títulos-em-lote, última sync) — orquestração LINEAR curta, sem cadeia longa que amplifique risco de swap. | ✅ | `BoletoDdaService.ts:56-61` |
| Manage Resource Coupling | Lock próprio (não colide com `ingestao-pagamentos` nem `permutas`); job usa o MESMO service que o botão manual (uma fonte de verdade). | ✅ | `BoletoDdaService.ts:23`; `src/backend/jobs/ingest-boletos-dda.ts:20-21` |
| **Contract testing** | Fixture inline com shape REAL medido em PRD (`fin124/itens/list/152, 2026-09-23`); 5 casos: item livre, vínculo Conexos, valor ausente descartado, paginação até o fim, embrulho `ConexosError`. Nenhum fixture `.json` gravado, mas o inline é rastreável a uma sondagem datada. | ✅ (parcial — sem fixture arquivada) | `ConexosDdaClient.test.ts:14-93` |
| **Versioning strategy for external API changes** | Conexos não versiona URL; a defesa é Zod tolerante (`safeParse` → descarta linha) + fixture medida. Um rename de campo do lado do ERP degrada silenciosamente para "boleto sem vínculo". | ⚠️ herdado do provider | `ConexosDdaClient.ts:66-77` |
| **Backward-compatibility shims** | N/A no delta — feature nova, sem migração de contrato anterior. | N/A | — |
| **Observability of integration failures** | Falha por arquivo é registrada como `BUSINESS_INFO` warn com `ddcCod` + `erro`; sync devolve `falhas` no payload; o job faz `process.exitCode = 1` quando `falhas > 0`. **Falta**: métrica agregada por endpoint (não há per-dependency error rate). | ⚠️ parcial | `BoletoDdaService.ts:117-125,133-137`; `ingest-boletos-dda.ts:26` |

## 4. Findings

### F-integrability-1: `ConexosDdaClient.listarTudo` duplica o `ConexosBaseClient.paginate` e diverge no comportamento de silent-truncate

- **Severidade**: P2 (débito técnico defensável — não bloqueia merge; degrada modificabilidade e observabilidade)
- **Tactic violada**: Adhere to Standards; Abstract Common Services
- **Localização**: `src/backend/domain/client/ConexosDdaClient.ts:112-143` (novo) vs `src/backend/domain/client/ConexosBaseClient.ts:260-318` (existente) e `src/backend/domain/client/ConexosCadastroClient.ts:164`, `src/backend/domain/client/ConexosExtratoClient.ts:178-212` (que reusam)
- **Evidência (objetiva)**:
  ```
  ConexosBaseClient.paginate  : MAX_PAGES=50   PAGE_SIZE=500   onCapHit?()   (silent-truncate NOTIFICADO)
  ConexosDdaClient.listarTudo : MAX_PAGINAS=60 PAGE_SIZE=1000  (SEM callback) (silent-truncate SILENCIOSO)
  ```
- **Impacto técnico**: Uma mudança no contrato de paginação Conexos (ex.: sub-envelope, header de continuação) precisa ser aplicada em N+1 lugares; se o pool crescer além de 60 mil linhas (24k hoje, ~1 arquivo/dia útil), a sincronização retorna resultado parcial sem log/telemetria — o snapshot fica furado sem sinal.
- **Impacto de negócio**: Boleto que ficaria fora do teto passa a aparecer como "não existe no pool" → analista paga fora do DDA → risco de duplicidade / perda de rastreabilidade.
- **Métrica de baseline**: 24 137 boletos hoje; teto local = 60 000 (`60 × 1000`); crescimento ~1 arquivo × ~150 itens por dia útil ≈ 39 000 boletos/ano; margem de ~1 ano até tocar o teto sem aviso.

### F-integrability-2: Tipos front/back hand-mirrored — nenhuma cerca contra drift no contrato HTTP

- **Severidade**: P2 (sistêmico do repo, mas o delta adiciona ~85 linhas de superfície)
- **Tactic violada**: Adhere to Standards (contrato compartilhado); Tailor Interface (o ajuste no back não se propaga)
- **Localização**: `src/frontend/lib/sispag.ts:758-841` (novo bloco "Boletos DDA") vs `src/backend/domain/interface/sispag/BoletoDda.ts:82-124`
- **Evidência (objetiva)**:
  ```
  Backend:  interface BoletoDdaConsolidado { candidatos: BoletoDdaTitulo[]; ... }
  Frontend: interface BoletoDda           { candidatos: BoletoDdaTitulo[]; ... }
  ```
  Nome do tipo diverge (`BoletoDdaConsolidado` no back, `BoletoDda` no front). Nenhum `tsc` compartilhado entre os projetos os liga; sem schema publicado (OpenAPI / tRPC / Zod compartilhado).
- **Impacto técnico**: Renomear/adicionar campo no back (ex.: `bancoEmissor` → `bancoEmissorFebraban`) só quebra no runtime, não em build; drift passa gate. Tipos de erros tipados (`SincronizacaoDdaEmAndamentoError`) também redigitados no FE.
- **Impacto de negócio**: Um rename no back pós-merge quebra a aba silenciosamente em produção (o `as BoletosDdaResposta` engana o `tsc`).
- **Métrica de baseline**: `src/frontend/lib/sispag.ts:758-841` = **~85 linhas** re-declaradas do backend `BoletoDda.ts`; a mesma tática é usada em toda `lib/sispag.ts` (~840 linhas espelhando ~5 interfaces de back).

### F-integrability-3: Silent-truncation da paginação DDA não emite telemetria (nem `LogService.warn`, nem contador)

- **Severidade**: P2 (baixa probabilidade hoje, alta consequência se disparar)
- **Tactic violada**: Observability of integration failures
- **Localização**: `src/backend/domain/client/ConexosDdaClient.ts:118-138`
- **Evidência (objetiva)**:
  ```typescript
  for (let pageNumber = 1; pageNumber <= MAX_PAGINAS; pageNumber += 1) { ... }
  return acumulado; // se atingiu MAX_PAGINAS, retorna incompleto sem sinalizar
  ```
  `ConexosBaseClient.paginate` já expõe `onCapHit?: () => void` exatamente para esse caso; o novo cliente ignora a facilidade e não injeta `LogService`.
- **Impacto técnico**: Quando o pool crescer além do teto, o Postgres passa a divergir do Conexos sem que ninguém veja — `sincronizacao concluída ... boletos=60000` parece sucesso.
- **Impacto de negócio**: Analista confia num snapshot furado; boletos legítimos aparecem como "SEM_TITULO" ou não aparecem.
- **Métrica de baseline**: `MAX_PAGINAS=60`, `PAGE_SIZE=1000` → 60 000 linhas de teto; pool atual 24 137 (0 sinais hoje) — margem funcional, mas ausência de telemetria é o defeito.

### F-integrability-4: Toda ingestão nova pressiona a mesma sessão Conexos compartilhada (`MPS_FRANCINEI`)

- **Severidade**: P2 (pre-existente à feature, agora exacerbado por um novo caminho de sync manual + job)
- **Tactic violada**: Manage Resource Coupling
- **Localização**: infra do provider Conexos (`ConexosBaseClient.ensureSid` → legacy service); consumo novo em `BoletoDdaService.executarSincronizacao` (`src/backend/domain/service/sispag/BoletoDdaService.ts:82-108`) e `src/backend/jobs/ingest-boletos-dda.ts`
- **Evidência (objetiva)**:
  ```
  Login Conexos: toda sessão nova recebe LOGIN_ERROR_MAX_SESSIONS
  Usuário: MPS_FRANCINEI (compartilhado), já com 3 sessões (produção)
  Recuperação: o client se recupera; mas cada retentativa custa RTTs adicionais
  ```
  Fonte: `_shared-metrics.md` linha 59.
- **Impacto técnico**: A cada botão de sync ou execução do job, o `ensureSid` inicial disputa slot com a ingestão de pagamentos e com o servidor de produção. Não é falha da DDA; é a integração compartilhada tornando o teto mais próximo.
- **Impacto de negócio**: Janela mais estreita para que duas ingestões corram em paralelo; degradação percebida como "o botão demorou".
- **Métrica de baseline**: `LOGIN_ERROR_MAX_SESSIONS` observado em 100% das sessões novas medidas em 2026-09-24; recuperação registrada, mas sem métrica agregada de latência do `ensureSid`.

## 5. Cards Kanban

### [integrability-1] Reusar `ConexosBaseClient.paginate` no `ConexosDdaClient` e propagar `onCapHit`

- **Problema**
  > `ConexosDdaClient.listarTudo` reimplementa o laço de paginação que `ConexosBaseClient.paginate` já provê (usado por `ConexosCadastroClient`, `ConexosExtratoClient`). Diverge no teto (60 páginas × 1000 vs 50 × 500) e não emite sinal quando trunca — a família Conexos passa a ter duas convenções conflitantes de silent-truncate no mesmo repositório.

- **Melhoria Proposta**
  > Refatorar `listarTudo` para chamar `this.base.paginate<Record<string, unknown>>({ endpoint, bodyBase: { ..., pageNumber:1?, pageSize? }, opts: { filCod }, onCapHit: () => this.logService.warn({...}) })`. Se o motivo do `pageSize=1000` for latência do `fin124/itens/list`, elevar o `PAGE_SIZE` em `ConexosBaseClient` (parâmetro) em vez de forkar o laço. Tactic: Adhere to Standards + Abstract Common Services.

- **Resultado Esperado**
  > Uma única implementação de paginação Conexos; `onCapHit` emite log estruturado. Redução de LOC no novo cliente e alinhamento com o padrão dos sibling clients.

- **Tactic alvo**: Adhere to Standards; Abstract Common Services
- **Severidade**: P2
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-integrability-1, F-integrability-3
- **Métricas de sucesso**:
  - LOC em `ConexosDdaClient.listarTudo`: 32 → ≤ 10
  - Convenções de paginação Conexos: 2 → 1
  - Log estruturado no cap-hit: ausente → presente (`LogService.warn`)
- **Risco de não fazer**: Quando o pool ultrapassar 60 mil boletos (~1 ano de crescimento), o snapshot fica silenciosamente truncado — a analista paga fora do DDA por confiar num pool incompleto.
- **Dependências**: nenhuma

### [integrability-2] Publicar o contrato Boletos DDA como fonte única (schema compartilhado) para eliminar a mirror manual

- **Problema**
  > `src/frontend/lib/sispag.ts` re-declara ~85 linhas de tipos (`BoletoDda`, `BoletoDdaTitulo`, `BoletosDdaResposta`, `SincronizacaoDdaResultado`) já definidos em `src/backend/domain/interface/sispag/BoletoDda.ts`, inclusive divergindo no nome (`BoletoDdaConsolidado` no back vs `BoletoDda` no front). Nenhum `tsc` cross-project os liga; `as BoletosDdaResposta` mascara drift em runtime.

- **Melhoria Proposta**
  > Extrair os tipos de contrato SISPAG (`BoletoDda.ts` + `SispagInterface.ts` na parte espelhada) para um pacote/dir compartilhado (`src/shared/sispag-contract.ts`, ou publicar OpenAPI a partir dos Zod schemas com `zod-to-openapi`). Alternativa mínima: gerar `.d.ts` a partir do backend e importar no frontend via path-mapping. Tactic: Adhere to Standards.

- **Resultado Esperado**
  > Uma única definição de `BoletoDdaConsolidado`, importada pelos dois lados; um rename no back quebra o build do front no PR seguinte.

- **Tactic alvo**: Adhere to Standards
- **Severidade**: P2
- **Esforço estimado**: M (2–5d) — feito uma vez, dilui para todos os outros contratos SISPAG (~840 linhas de mirror já hoje)
- **Findings relacionados**: F-integrability-2
- **Métricas de sucesso**:
  - Linhas re-declaradas em `lib/sispag.ts` para o bloco DDA: ~85 → 0
  - Drift detectado em build (não runtime): não → sim
- **Risco de não fazer**: Cada `/feature-tweak` novo em DDA adiciona ~10-30 linhas de mirror; um rename escapa por 1-2 releases; a aba quebra em produção com `{}` no lugar do valor.
- **Dependências**: pode viabilizar a Fatia futura de "vincular candidato" sem retrabalho.

### [integrability-3] Emitir telemetria de silent-truncation na paginação DDA

- **Problema**
  > `listarTudo` para no teto `MAX_PAGINAS=60` sem emitir log/contador; hoje o pool tem 24k boletos e o teto é 60k, mas crescimento observado de ~1 arquivo/dia útil coloca a sync em risco silencioso em ~1 ano.

- **Melhoria Proposta**
  > Se a refatoração (card 1) não for aceita, injetar `LogService` no `ConexosDdaClient` e emitir `LogService.warn({ type: BUSINESS_WARN, message: 'fin124 paginação truncada', data: { endpoint, paginas: MAX_PAGINAS, acumulado } })` quando o laço sair sem cumprir `pageWasShort` nem `reachedExpected`. Alternativa: propagar `SincronizacaoDdaResultado.truncado?: boolean`. Tactic: Observability of integration failures.

- **Resultado Esperado**
  > Cap-hit vira alerta operável, não silêncio.

- **Tactic alvo**: Observability of integration failures
- **Severidade**: P2
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-integrability-3, F-integrability-1
- **Métricas de sucesso**:
  - Truncation sem log: possível → impossível
  - Sinal para dashboard `BUSINESS_WARN` do painel de saúde: ausente → 1 evento por sync truncada
- **Risco de não fazer**: mesmo do card 1 — snapshot furado sem sinal.
- **Dependências**: se implementar o card 1, este dilui-se nele.

### [integrability-4] Segregar sessão Conexos por caminho (ou reduzir concorrência) para os novos syncs DDA

- **Problema**
  > `MPS_FRANCINEI` é usuário compartilhado com 3 sessões concorrentes já ativas; adicionar um novo caminho de sync (job + botão manual) aumenta a pressão sobre `LOGIN_ERROR_MAX_SESSIONS`. A recuperação existe no `ConexosBaseClient`, mas cada retry custa RTT extra e a probabilidade de falha em cadeia cresce.

- **Melhoria Proposta**
  > Curto prazo: garantir que o botão manual da aba DDA respeita o advisory lock ANTES de abrir sessão (já respeita — validar em teste E2E) e evitar dois cliques dispararem `ensureSid` em paralelo. Médio prazo: cada frente (permutas, sispag, DDA, extrato) tem seu próprio usuário Conexos técnico com quota de sessões dedicada — recomendar ao operador Columbia. Tactic: Manage Resource Coupling.

- **Resultado Esperado**
  > Cada sync corre com sua sessão; `LOGIN_ERROR_MAX_SESSIONS` deixa de ser rotina.

- **Tactic alvo**: Manage Resource Coupling
- **Severidade**: P2
- **Esforço estimado**: M (2–5d, dependência externa: provisionar usuário Conexos)
- **Findings relacionados**: F-integrability-4
- **Métricas de sucesso**:
  - `LOGIN_ERROR_MAX_SESSIONS` em sessões novas medidas: 100% → 0%
  - Latência do primeiro `ensureSid` de uma sync DDA: mensurar baseline hoje
- **Risco de não fazer**: enquanto o pool cresce e mais frentes chegam (Popula GED, NDe), o teto de 3 sessões vira gargalo compartilhado entre features — swap de uma delas não é possível sem quebrar as outras.
- **Dependências**: acesso do operador Columbia para criar novos usuários Conexos (fora do repo).

## 6. Notas do agente

- Escopo respeitado: --quick, feature-scoped (delta PR #85). Não auditei o resto da família Conexos — só comparei o novo cliente com sibling clients para checar consistência.
- Nenhum P0/P1: o delta é READ-ONLY no ERP, guarded por `admin`, tem Zod tolerante nos boundaries, reusa `ConexosBaseClient` para sessão/retry, tem advisory lock exclusivo, e o gate real (162 arquivos / 24 137 boletos / 0 falhas em ~90 s) foi observado. Não há tactic ausente que justifique bloquear merge.
- Métricas não coletadas: latência do `ensureSid` sob contenção (precisaria de instrumentação por RTT); rate real de aparecimento de campos de vínculo (`fil_cod/doc_cod/tit_cod`) por arquivo (útil para dimensionar risco de drift no contrato Conexos).
- Cross-QA: F-integrability-2 (hand-mirrored types) toca **Modifiability** e **Testability** — o consolidator pode juntar num card único de "adotar schema compartilhado FE/BE" se as três QAs o levantarem. F-integrability-1 e F-integrability-3 tocam **Fault Tolerance / Observability** — o silent-truncate é falha silenciosa de leitura externa, também é insumo do QA de observabilidade se rodar.
- A migração `0062_boleto_dda.sql` reutiliza o número `0062` (o anterior `0062_titulo_retencao_formacao.sql` foi removido) — o `MigrationRunner` rastreia por nome completo, então não há risco de integração; anotado para o consolidator porque cai mais claramente sob Deployability/Testability.
