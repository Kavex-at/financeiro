---
qa: Integrability
qa_slug: integrability
run_id: 2026-08-28-1607
agent: qa-integrability
generated_at: 2026-08-28T16:07:00-03:00
scope: backend
score: 7
findings_count: 6
cards_count: 5
---

# Integrability — Regis-Review

## 1. Cenário Geral (Bass General Scenario aplicado ao nf-projects)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Time da plataforma | Precisa **auditar** de quem saiu uma baixa no ERP (usuário vinculado vs. robô) e, mais tarde, **substituir** o transporte legado (`services/conexos.ts` → `domain/client/ConexosBaseClient` puro) sem quebrar a nova coluna `conexos_username`/`conexos_usn_cod` | Seam Conexos: `ConexosSessionResolver` + `ConexosIdentityProvider` + `AsyncLocalStorage` + 5 `*ExecucaoRepository` + coluna nova nos 5 ledgers | Backend Express em produção, ERP Conexos v1 estável, sub-clients (`ConexosNdeClient`, `ConexosSispagWriteClient`, `ConexosFin014Client`, …) inalterados | Nova identidade viaja de ponta-a-ponta sem que sub-clients precisem enxergar o mecanismo; substituição futura do transporte precisa mudar **um** ponto de publicação e **um** ponto de leitura (o resolver e o provider) | Marginal cost do delta: 13 arquivos de produção +1099/-100 LOC; substituição do transporte legado projetada: `ConexosService` referenciada como TIPO em 4 arquivos de domínio — a v0.2 precisa manter `getCapturedUsnCod(): string \| null` ou definir shim |

Contextualização do delta: até 2026-08-25 a identidade do ERP era **invisível** (o fallback para o robô só era inferível pela ausência de linha em `conexos_sessions`). O delta cria o seam de identidade; a pergunta de integrability é **quanto** de acoplamento novo isso introduziu e **quão caro** vai ser trocar o transporte na v0.2.

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| `LegacyConexosShape` / `ConexosBaseClient` tocados no delta | 0 | 0 | ✅ | `git diff main..HEAD -- src/backend/domain/client/ConexosBaseClient.ts src/backend/domain/client/legacyConexosAdapter.ts` (sem output) |
| Sub-clients Conexos alterados (`ConexosNdeClient`, `ConexosSispagWriteClient`, `ConexosFin014Client`, `ConexosExtratoClient`, `ConexosNdeFiscalClient`, `ConexosTitulosClient`, `ConexosGerDocProcessoClient`, `ConexosCadastroClient`, `ConexosFinanceiroClient`, `ConexosSispagRetornoClient`, `ConexosBaixaClient`) | 0 de 11 | 0 | ✅ | `git diff main..HEAD --stat -- src/backend/domain/client/` (só `ConexosIdentityProvider.*` e `ConexosSessionResolver.*`) |
| Repositórios que passaram a depender de `ConexosIdentityProvider` | 5 (`Permuta`, `SolicitacaoNumerario`, `Recebimento`, `Remessa`, `Conciliacao`) | ≤5 (uma por ledger de escrita ERP) | ✅ | `grep -c ConexosIdentityProvider src/backend/domain/repository/**/*ExecucaoRepository.ts` |
| Widening da superfície pública de `services/conexos.ts` | +1 método (`getCapturedUsnCod(): string \| null`) | ≤1 accessor puro por ciclo | ✅ | `git diff main..HEAD -- src/backend/services/conexos.ts` (+10 LOC, um accessor) |
| Referências a `ConexosService` FORA de `services/` (acoplamento legado a migrar) | 4 (`legacyConexosAdapter.ts:1`, `ConexosSessionResolver.ts:2`, `ConexosIdentityProvider.test.ts:2`, `ConexosRequestContext.ts:2`) | ↓ tender a 0 na v0.2 | ⚠️ | `grep -rn "^import type { ConexosService }" src/backend/domain/` |
| Ambient context em vez de threading por parâmetro | 1 `AsyncLocalStorage` (`conexosRequestContext`) + 1 middleware Express | 1 (aceitável se documentado; ver seção 3) | ⚠️ | `src/backend/domain/libs/requestContext/ConexosRequestContext.ts:32`, `src/backend/http/conexosIdentity.ts:15` |
| Contrato entre publicador (resolver) e consumidor (provider) | Interface `ConexosResolvedIdentity` + `ConexosRequestState` + método `currentParams(): {conexosUsername\|null, conexosUsnCod\|null}` | Contrato tipado explícito | ✅ | `src/backend/domain/libs/requestContext/ConexosRequestContext.ts:23-31`, `src/backend/domain/client/ConexosIdentityProvider.ts:36-41` |
| Contract tests do seam (resolver + provider) | 15 testes (`ConexosSessionResolver.test.ts` 12 + `ConexosIdentityProvider.test.ts` 3 grupos, 5 casos) | ≥cobertura das 4 rotas de fallback + I-1 + I-2 | ✅ | `wc -l src/backend/domain/client/ConexosSessionResolver.test.ts src/backend/domain/client/ConexosIdentityProvider.test.ts` |
| Repositórios afetados sem teste unitário próprio | 1 de 5 (`ConciliacaoExecucaoRepository.ts` — arquivo de teste **inexistente**) | 0 | ❌ | `ls src/backend/domain/repository/sispag/*.test.ts` — `ConciliacaoExecucaoRepository.test.ts` ausente |
| Camadas cruzadas indevidamente (client → domain → services legado) | `domain/repository/*ExecucaoRepository → domain/client/ConexosIdentityProvider → domain/libs/requestContext → services/conexos.ts (tipo)` | domain não deve importar `services/` | ⚠️ | `grep -rn "from '../../../services/conexos.js'" src/backend/domain/libs/requestContext/` |
| Schema versioning do payload ERP (versão explícita em URL/header) | 0 sub-clients pinam versão | Documentar (Conexos não expõe `/v1`) | ⚠️ (Não medível — ERP não versiona) | `grep -rn "/v[0-9]" src/backend/domain/client/Conexos*` (sem match) |
| `getCapturedUsnCod()` sem tipo de retorno explícito e sem modificador de acesso | 1 método (viola CLAUDE.md §"TypeScript Style" no `services/` legado, mas coerente com o entorno) | Ao migrar `services/` para `domain/service/`, normalizar | ⚠️ | `src/backend/services/conexos.ts:349-351` |
| `SecretCipher` cifrando senha do vínculo Conexos: chave `CONEXOS_CRED_ENC_KEY` documentada no `render.yaml` / `.env.example` | ausente (segurada pelo Yuri no `-regis-followups.md` F-1) | declarada | ❌ | `grep -rn "CONEXOS_CRED_ENC_KEY" src/backend/.env.example render.yaml` (sem match) |

## 3. Tactics — Cobertura no nf-projects

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| **Encapsulate** | Sub-clients (`ConexosNdeClient` etc.) NÃO enxergam o mecanismo de identidade; a decisão vive num único ponto (`ConexosSessionResolver.resolve`) e a leitura vive noutro (`ConexosIdentityProvider.currentParams`). `LegacyConexosShape` intacto. | ✅ presente | `src/backend/domain/client/legacyConexosAdapter.ts:16-24` (adapter chama `resolveService()` a cada método, sub-clients ignoram) |
| **Use an Intermediary** | `ConexosIdentityProvider` é o intermediário entre o `AsyncLocalStorage` e os 5 repositórios; `currentParams()` normaliza o formato SQL (evita repetição do `?? null`). | ✅ presente | `src/backend/domain/client/ConexosIdentityProvider.ts:36-41` |
| **Restrict Communication Paths** | Boa: só 5 repositórios veem `ConexosIdentityProvider`; nenhum sub-client vê. Ruim: `ConexosRequestState.resolved: ConexosService` faz o domínio importar `services/` (o pacote LEGADO que a arquitetura pretende extinguir). | ⚠️ parcial | `src/backend/domain/libs/requestContext/ConexosRequestContext.ts:2` importa `../../../services/conexos.js` |
| **Adhere to Standards** | Repositórios seguem o padrão DI existente (`@inject(ConexosIdentityProvider)`). Coluna nova em ledger espelha `conexos_sessions.usn_cod` (TEXT). SQL parametrizado (Rule #5). Migration idempotente (`IF NOT EXISTS`). | ✅ presente | `src/backend/migrations/0051_execucao_identidade_conexos.sql:19-40` |
| **Abstract Common Services** | `currentParams()` centraliza a projeção SQL das duas chaves — o mesmo spread `...this.identityProvider.currentParams()` aparece nos 5 repositórios sem drift. | ✅ presente | 5 repositórios × `...this.identityProvider.currentParams()` em `beginExecution`/`markSettled`/`markError`/`fail` |
| **Discover Service** | Fora do escopo do delta — o registry de sessão (`ConexosSessionRegistry`) escolhe entre robô e usuário; publicação da identidade é upstream disso. Convenção da chave: `columbia:user:<login>` e `columbia-default` (robô). Documentada em `ontology/integrations/conexos.md`. | N/A (não é discovery de endpoint) | `src/backend/domain/client/ConexosSessionRegistry.ts:6,32` |
| **Tailor Interface** | O adapter `LegacyConexosShape` já tailor-a a interface do sub-client em cima do `ConexosService` legado; o delta reusa esse adapter sem estendê-lo. | ✅ presente (pré-existente) | `src/backend/domain/client/legacyConexosAdapter.ts` |
| **Configure Behavior** | Comportamento por request via `AsyncLocalStorage` (o middleware injeta `platformUsername`; o resolver decide). Configuração global via `EnvironmentProvider.conexosLogin` para o robô — CLAUDE.md Rule #8. | ✅ presente | `src/backend/http/conexosIdentity.ts:15`, `src/backend/domain/client/ConexosSessionResolver.ts:117-121` |
| **Manage Resources** | Sessão cacheada no `state.resolved` para não repetir lookup+login dentro da mesma request; store por chave (`columbia:user:<login>`) mantém `MAX_SESSIONS` do ERP por usuário. | ✅ presente | `src/backend/domain/client/ConexosSessionResolver.ts:58,66`; `src/backend/domain/client/ConexosSessionRegistry.ts:31-33` |
| **Orchestrate** | Orquestração linear e explícita: middleware → resolver → sub-client (que ignora identidade) → repositório (que lê a identidade publicada). Não há event bus intermediário. | ✅ presente | Fluxo em `src/backend/index.ts:93` → `src/backend/http/conexosIdentity.ts:15` → `src/backend/domain/appContainer.ts:61-64` |
| **Manage Resource Coupling** | Coupling ambient (`AsyncLocalStorage`) em vez de threading por parâmetro. Escolha justificada (mesmo padrão de LogService), mas cria assinaturas enganosas em `beginExecution`/`markSettled`/`markError`. | ⚠️ parcial | `src/backend/domain/client/ConexosSessionResolver.ts:56-64` |
| **Contract testing** | Testes de contrato do seam (resolver ↔ provider ↔ context) presentes. O provider é lido nos testes dos repositórios via mock injetável (`buildIdentity()`); os SQL contêm as duas chaves novas em cinco tabelas — cobertos por asserts de spy em `db.selectFirst`/`db.update`. | ✅ presente | `src/backend/domain/client/ConexosIdentityProvider.test.ts`; `src/backend/domain/repository/permutas/PermutaExecucaoRepository.test.ts:14-19` (helper `buildIdentity`) |
| **Versioning strategy** | Conexos v1 não expõe versão em URL — impossível medir. Delta manda payload ERP inalterado (só muda o **cookie/header** que já são o mecanismo de identidade histórico do provedor). | N/A (upstream sem versionamento) | `src/backend/services/conexos.ts:517,538-539` |
| **Backward-compatibility shims** | Coluna nova é NULL-permissiva por design (ADR-0041 §"Fora de escopo — sem backfill"). SQL `COALESCE(conexos_username, $conexosUsername)` no `markSettled`/`markError` respeita valor pré-existente e no `INSERT ... ON CONFLICT` preserva `settled` (não reescreve autoria). | ✅ presente | `src/backend/domain/repository/permutas/PermutaExecucaoRepository.ts:243-249,308-310` |
| **Observability of integration failures** | I-1: `warn` estruturado (`LOG_TYPE.BUSINESS_WARN`) por request que degrada com vínculo presente; distingue `decrypt` de `login`; nunca vaza senha. I-2: ledger persiste **quem** assinou. Métrica agregada e alarme sobre `motivo in (decrypt, login)` ficaram no follow-up (F-5). | ✅ presente para o registro; ⚠️ parcial para o alarme | `src/backend/domain/client/ConexosSessionResolver.ts:126-142`; `ontology/_inbox/conexos-fallback-audit-regis-followups.md` F-5 |

## 4. Findings

### F-integrability-1: `ConexosIdentityProvider` em `domain/client/` cria uma dependência REPOSITORY → CLIENT que inverte a direção canônica de DDD

- **Severidade**: P2 (débito técnico defensável)
- **Tactic violada**: Restrict Communication Paths
- **Localização**: `src/backend/domain/client/ConexosIdentityProvider.ts`, `src/backend/domain/repository/permutas/PermutaExecucaoRepository.ts:2,67-68`, `src/backend/domain/repository/recebimentos/RecebimentoExecucaoRepository.ts:2,27-28`, `src/backend/domain/repository/recebimentos/SolicitacaoNumerarioExecucaoRepository.ts:2,39-40`, `src/backend/domain/repository/sispag/RemessaExecucaoRepository.ts:2,33-34`, `src/backend/domain/repository/sispag/ConciliacaoExecucaoRepository.ts:2,28-29`
- **Evidência (objetiva)**:
  ```
  # 5 repositórios importam de domain/client (o inverso do fluxo canônico Service→Repository→Client)
  $ grep -c ConexosIdentityProvider src/backend/domain/repository/**/*ExecucaoRepository.ts
  3 3 3 3 3  # (import + @inject + campo)
  ```
- **Impacto técnico**: `ConexosIdentityProvider` não é um cliente externo — é uma **query sobre estado ambiente in-process**. Colocá-lo em `domain/client/` cria uma dependência lexical do `domain/repository` para o `domain/client`, contrariando o fluxo declarado no CLAUDE.md §"DDD Layers" (`Handler → Service → Repository → Client`). Uma futura regra de PatternGuardian que proíba `domain/repository` → `domain/client` reprovaria estes 5 arquivos.
- **Impacto de negócio**: baixo hoje (o provider não faz I/O). Alto se a semântica de "client = adapter de sistema externo" for adotada como convenção — obriga a mover 5 arquivos + tocar `appContainer.ts`.
- **Métrica de baseline**: 5 arquivos de `domain/repository` importando de `domain/client` (0 antes do delta).

### F-integrability-2: `ConexosRequestState.resolved: ConexosService` faz o domínio importar do pacote LEGADO `services/` que a arquitetura pretende extinguir

- **Severidade**: P1 (alto — degrada a métrica de "% domínio sem `services/`" que a migração inteira usa)
- **Tactic violada**: Encapsulate + Restrict Communication Paths
- **Localização**: `src/backend/domain/libs/requestContext/ConexosRequestContext.ts:2`, `src/backend/domain/client/ConexosSessionResolver.ts:2`, `src/backend/domain/client/ConexosIdentityProvider.test.ts:2`, `src/backend/domain/client/legacyConexosAdapter.ts:1`
- **Evidência (objetiva)**:
  ```
  $ grep -rn "^import type { ConexosService }" src/backend/domain/
  src/backend/domain/libs/requestContext/ConexosRequestContext.ts:2:import type { ConexosService } from '../../../services/conexos.js';
  src/backend/domain/client/ConexosSessionResolver.ts:2:import type { ConexosService } from '../../services/conexos.js';
  src/backend/domain/client/ConexosIdentityProvider.test.ts:2:import type { ConexosService } from '../../services/conexos.js';
  src/backend/domain/client/legacyConexosAdapter.ts:1:import type { ConexosService } from '../../services/conexos.js';
  ```
- **Impacto técnico**: o read `state.resolved?.getCapturedUsnCod()` (`ConexosIdentityProvider.ts:47-49`) **exige** que `state.resolved` seja uma instância viva de `ConexosService`. Substituir o transporte legado por um `ConexosBaseClient` puro obriga a manter na v0.2 um método com assinatura idêntica `getCapturedUsnCod(): string | null` — caso contrário, o provider quebra sem que nenhum call site óbvio grite. É um **contrato tácito** entre camada de request-context e a classe legada, não declarado numa interface.
- **Impacto de negócio**: aumenta o custo de "substituir o transporte" (item explícito de integrability neste review) — o que era um seam de um único ponto (`resolveService()` no adapter) vira dois pontos (`resolveService` + `state.resolved` como `ConexosService`).
- **Métrica de baseline**: 4 arquivos em `src/backend/domain/` importam `ConexosService` do pacote `services/`. Alvo pós-v0.2: 0 (ou 1 arquivo com um alias `type ConexosSession = { getCapturedUsnCod(): string | null }`).

### F-integrability-3: `ConciliacaoExecucaoRepository` ganhou nova dependência `ConexosIdentityProvider` sem qualquer teste unitário (arquivo `.test.ts` inexistente)

- **Severidade**: P2 (débito técnico defensável — a coluna nova é COALESCE-null, cria pouco risco imediato)
- **Tactic violada**: Contract testing
- **Localização**: `src/backend/domain/repository/sispag/ConciliacaoExecucaoRepository.ts:2,28-29,110-113,131-135,150-155`
- **Evidência (objetiva)**:
  ```
  $ ls src/backend/domain/repository/sispag/*.test.ts
  LotePagamentoRepository.test.ts
  PagamentoIngestaoRunRepository.test.ts
  RemessaExecucaoRepository.test.ts
  TituloAPagarRepository.test.ts
  # ConciliacaoExecucaoRepository.test.ts AUSENTE
  ```
- **Impacto técnico**: os 4 outros repositórios afetados receberam mock `buildIdentity()` nos testes (asserts sobre `db.selectFirst`/`db.update` incluem as chaves novas). O 5º não tem nenhum teste — se o SQL do `beginExecution`/`fail` de conciliação regredir (ordem de placeholders, coluna renomeada, `COALESCE` invertido), nada quebra na suíte.
- **Impacto de negócio**: baixo hoje (a coluna é aditiva, NULL-permissiva). Sobe se uma futura task tocar o SQL de conciliação achando que está coberto.
- **Métrica de baseline**: 4/5 = 80% dos repositórios de execução com contract test. Alvo: 5/5. Dívida pré-existente ao delta — o delta a torna mais visível.

### F-integrability-4: `getCapturedUsnCod()` foi adicionado ao `ConexosService` legado sem modificador de acesso nem tipo de retorno explícito, contrariando CLAUDE.md §"TypeScript Style"

- **Severidade**: P3 (baixo — melhoria opcional; coerente com o entorno legado)
- **Tactic violada**: Adhere to Standards
- **Localização**: `src/backend/services/conexos.ts:344-351`
- **Evidência (objetiva)**:
  ```typescript
  // src/backend/services/conexos.ts:349-351
  getCapturedUsnCod(): string | null {
      return this.usnCod;
  }
  ```
  CLAUDE.md §"TypeScript Style": "Explicit access modifiers on all methods/properties"; "Methods as arrow functions: `public method = () => {}`". O método novo não é `public` nem arrow — coerente com o estilo do arquivo legado (o próprio `getSid`, `filCodDefault`, etc. seguem esse padrão), mas quando `services/conexos.ts` for migrado para `domain/service/` esta assinatura precisa normalizar junto.
- **Impacto técnico**: nenhum funcional. Cria um item a mais na lista de re-formatting durante a migração v0.2.
- **Impacto de negócio**: nulo hoje. Marca a **primeira** adição feita sob o novo regime dentro de código que a arquitetura pretende extinguir — vira precedente se não for revisitado.
- **Métrica de baseline**: 1 método novo fora do estilo DDD adicionado em `services/` no delta. Alvo: 0 após v0.2 (migrar `ConexosService` para `domain/service/ConexosSessionService.ts`).

### F-integrability-5: `AsyncLocalStorage` como transporte de identidade cria assinaturas enganosas em `beginExecution`/`markSettled`/`markError` — a dependência de contexto não aparece na tipagem

- **Severidade**: P2 (débito técnico defensável)
- **Tactic violada**: Manage Resource Coupling
- **Localização**: `src/backend/domain/client/ConexosIdentityProvider.ts:47`, `src/backend/domain/repository/permutas/PermutaExecucaoRepository.ts:256,319,343` (todos os `...this.identityProvider.currentParams()`)
- **Evidência (objetiva)**:
  ```typescript
  // Assinatura pública NÃO menciona que existe um AsyncLocalStorage por trás:
  public beginExecution = async (input: BeginPermutaExecucaoInput): Promise<...> => {
      ...
      ...this.identityProvider.currentParams(),  // lê do AsyncLocalStorage
  }
  ```
  Um consumidor que chame `repo.beginExecution(...)` **fora** de `conexosRequestContext.run(...)` grava `NULL/NULL` nas duas colunas sem que o TypeScript avise. Os testes mockam o provider e evitam o problema; o runtime não tem tal proteção.
- **Impacto técnico**: escrita de uma execução real fora de request (ex.: um script chamando o repositório direto) grava identidade NULL, que a regra de negócio I-2 interpreta como "não capturada" — silêncio semanticamente distinto do "robô" mas indistinguível de "bug de contexto". Threading explícito (`beginExecution(input, identity)`) tornaria a dependência visível no compilador.
- **Impacto de negócio**: baixo hoje (os cinco call sites reais estão sob middleware Express). Sobe se aparecer um novo job/cron que chame um `ExecucaoRepository` diretamente — o gate de compilador não trava, o log I-1 não dispara (é fora de request), e a linha nasce órfã.
- **Métrica de baseline**: 5 métodos públicos em 5 repositórios têm dependência oculta do `AsyncLocalStorage`. Alvo defensável: manter o `AsyncLocalStorage` **e** ter um lint/test que impeça chamar `ExecucaoRepository.begin*` fora de `conexosRequestContext.run(...)`.

### F-integrability-6: `CONEXOS_CRED_ENC_KEY` não declarada em `render.yaml` nem em `.env.example` — todo ambiente que não seja produção degrada silenciosamente para o robô com `warn`

- **Severidade**: P1 (alto — a Fatia B inteira fica sem efeito em qualquer ambiente novo)
- **Tactic violada**: Configure Behavior + Discover Service (contrato de configuração)
- **Localização**: ambiente/config — `render.yaml` (raiz do repo) e `src/backend/.env.example`
- **Evidência (objetiva)**:
  ```
  $ grep -rn "CONEXOS_CRED_ENC_KEY" src/backend/.env.example render.yaml
  # (nenhum match)
  ```
  Documentado em `ontology/_inbox/conexos-fallback-audit-regis-followups.md` F-1: "Levantado na investigação e adiado pelo Yuri neste ciclo. Não afeta produção (a chave está setada lá) […]. Afeta todo ambiente que não seja produção: sem a chave, `SecretCipher.isEnabled()` → `false`, a coluna Conexos some da tela de Usuários, e todo vínculo degrada para o robô — silenciosamente antes deste delta, agora com `warn`."
- **Impacto técnico**: em staging, dev pessoal, tenant novo, worktree — a decisão do resolver **sempre** cai no robô, mesmo para usuários vinculados. O `warn` de I-1 nem dispara nesse caso (é o caminho "sem vínculo", não "vínculo presente inutilizável"). O comportamento é semanticamente correto (fallback silencioso) mas mascara a falha de config.
- **Impacto de negócio**: quando um segundo tenant subir ou quando um dev novo entrar, ninguém detecta que a Fatia B está desligada — só descobre auditando `conexos_username` do ledger dias depois.
- **Métrica de baseline**: 0 de 2 arquivos de configuração declaram `CONEXOS_CRED_ENC_KEY`. Alvo: 2/2 com `sync: false` no `render.yaml` e placeholder no `.env.example`.

## 5. Cards Kanban

### [integrability-1] Mover `ConexosIdentityProvider` para fora de `domain/client/` (é query in-process, não adapter externo)

- **Problema**
  > 5 repositórios (`Permuta`, `SolicitacaoNumerario`, `Recebimento`, `Remessa`, `Conciliacao`) agora importam de `domain/client/`, invertendo o fluxo canônico `Handler→Service→Repository→Client` do CLAUDE.md. `ConexosIdentityProvider` não faz I/O externo — só lê `AsyncLocalStorage` — logo não é um "client" no sentido Bass/DDD do projeto.
- **Melhoria Proposta**
  > Mover para `src/backend/domain/libs/requestContext/ConexosIdentityProvider.ts` (ou `src/backend/domain/service/ConexosIdentityProvider.ts` se ficar mais confortável ao PatternGuardian). Ajustar os 5 imports nos repositórios. **Tactic Bass alvo: Restrict Communication Paths.**
- **Resultado Esperado**
  > `grep -c "domain/client" src/backend/domain/repository/**/*ExecucaoRepository.ts` cai para 0 (hoje: 5). PatternGuardian pode adicionar regra "domain/repository não importa domain/client".
- **Tactic alvo**: Restrict Communication Paths
- **Severidade**: P2
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-integrability-1
- **Métricas de sucesso**:
  - Repositórios importando de `domain/client`: 5 → 0
  - Regra de PatternGuardian nova: 0 → 1
- **Risco de não fazer**: quando uma sexta frente for adicionada (`fin010` write, por exemplo), o autor copia o padrão errado; a inversão de camada se solidifica como convenção de fato.
- **Dependências**: nenhuma

### [integrability-2] Substituir `ConexosRequestState.resolved: ConexosService` por uma interface mínima `{ getCapturedUsnCod(): string | null }`

- **Problema**
  > 4 arquivos de `domain/` importam a classe `ConexosService` do pacote LEGADO `services/`. Isso é o contrário do vetor de migração (`services/` deve encolher). Além disso, congela um contrato tácito: a v0.2 do transporte Conexos precisa manter `getCapturedUsnCod` assinatura idêntica, senão o `ConexosIdentityProvider.current()` quebra silenciosamente.
- **Melhoria Proposta**
  > Declarar em `ConexosRequestContext.ts` uma interface `ConexosSessionCapture { getCapturedUsnCod(): string | null }` e tipar `resolved?: ConexosSessionCapture`. `ConexosService` continua satisfazendo estruturalmente. Remover os 4 `import type { ConexosService }` de `domain/`. **Tactic Bass alvo: Encapsulate.**
- **Resultado Esperado**
  > `grep -rn "import type { ConexosService }" src/backend/domain/` retorna 0 (hoje: 4). Substituir `services/conexos.ts` por `domain/client/ConexosBaseClient` puro na v0.2 deixa de exigir manter esse método específico — basta satisfazer a interface.
- **Tactic alvo**: Encapsulate
- **Severidade**: P1
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-integrability-2
- **Métricas de sucesso**:
  - `import type { ConexosService }` em `src/backend/domain/`: 4 → 0
  - Arquivos que a v0.2 precisa manter assinatura-compatível: 1 (`ConexosService`) → 0 (satisfaz interface)
- **Risco de não fazer**: em 6 meses, quem for migrar `services/conexos.ts` para `domain/client/` descobre o acoplamento tarde e precisa manter shim de compatibilidade só para o `getCapturedUsnCod` — dobra o custo da substituição.
- **Dependências**: nenhuma (pode acontecer antes ou depois de [integrability-1])

### [integrability-3] Criar `ConciliacaoExecucaoRepository.test.ts` cobrindo `beginExecution`/`fail`/`markSettled` incluindo as chaves de identidade Conexos

- **Problema**
  > O 5º repositório afetado pelo delta não tem arquivo de teste. Se o SQL regredir (ordem de placeholders, `COALESCE` invertido, coluna renomeada), a suíte não detecta. Os outros 4 repositórios têm `buildIdentity()` mockado e asserts sobre `db.update`/`db.selectFirst`.
- **Melhoria Proposta**
  > Espelhar `RemessaExecucaoRepository.test.ts` (mesmo dono, mesmo pacote): `buildDb()` + `buildIdentity()`, asserts que o SQL contém `conexos_username`/`conexos_usn_cod` e que os placeholders bindados são os do `currentParams()`. Cobrir explicitamente o comportamento `ON CONFLICT`/`COALESCE`. **Tactic Bass alvo: Contract testing.**
- **Resultado Esperado**
  > `ls src/backend/domain/repository/sispag/*.test.ts` inclui `ConciliacaoExecucaoRepository.test.ts`. Cobertura de contract testing dos repositórios de execução: 4/5 (80%) → 5/5 (100%).
- **Tactic alvo**: Contract testing
- **Severidade**: P2
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-integrability-3
- **Métricas de sucesso**:
  - Repositórios de execução com teste unitário: 4/5 → 5/5
  - Casos cobertos: 0 → ≥6 (findByIdempotencyKey null/hit, beginExecution INSERT/ON CONFLICT settled-preserva, markSettled COALESCE, fail COALESCE)
- **Risco de não fazer**: primeira alteração no SQL do ConciliacaoExecucaoRepository — por qualquer motivo — regride silenciosa. Como o ledger é `NULL`-permissivo, a regressão só aparece na auditoria de identidade dias/semanas depois.
- **Dependências**: nenhuma

### [integrability-4] Trocar o `AsyncLocalStorage` implícito por um teste-guarda que impeça chamar `ExecucaoRepository.begin*` fora de `conexosRequestContext.run(...)`

- **Problema**
  > `beginExecution`/`markSettled`/`markError`/`fail` têm dependência oculta do `AsyncLocalStorage`. Chamada fora de request grava `NULL/NULL` sem que o compilador avise. Threading explícito (`begin(input, identity)`) resolveria mas custa 5 refactors de assinatura pública; o compromisso mínimo é uma barreira em runtime que faça o teste falhar.
- **Melhoria Proposta**
  > Adicionar em `ConexosIdentityProvider.current()` (ou num wrapper) uma modo `strict` que lance quando `conexosRequestContext.getStore()` é `undefined` **e** o repositório está prestes a escrever `NOT NULL`-esperado. Alternativa mais barata: um `describe`-guarda em cada `*ExecucaoRepository.test.ts` que rode `beginExecution` sem `.run(...)` e afirme que grava NULL — documentando o comportamento em vez de mudá-lo. **Tactic Bass alvo: Manage Resource Coupling.**
- **Resultado Esperado**
  > Uso do repositório fora de contexto vira erro **explícito** (ou fica coberto por teste declarativo). Novos autores enxergam a dependência sem precisar ler `ConexosIdentityProvider.ts`.
- **Tactic alvo**: Manage Resource Coupling
- **Severidade**: P2
- **Esforço estimado**: S (≤1d, opção teste-guarda) / M (2-5d, opção threading explícito)
- **Findings relacionados**: F-integrability-5
- **Métricas de sucesso**:
  - Métodos públicos com dependência de `AsyncLocalStorage` sem barreira: 5 → 0
  - Testes-guarda documentando o comportamento fora de request: 0 → 5
- **Risco de não fazer**: um novo job/cron chama o repositório direto (achando que "identidade opcional = ok"), grava `NULL/NULL`, e a coluna nova perde poder de auditoria justamente onde é mais valiosa — jobs de conciliação em massa.
- **Dependências**: benefícia de [integrability-1] (provider fora de `domain/client/`), mas independe dele

### [integrability-5] Declarar `CONEXOS_CRED_ENC_KEY` em `render.yaml` (`sync: false`) e no `.env.example`

- **Problema**
  > A chave de cifra do vínculo Conexos existe em produção mas não está declarada em nenhum arquivo de contrato de config. Todo ambiente que não seja produção (staging futuro, dev pessoal, tenant novo) roda com `SecretCipher.isEnabled()` = false — a Fatia B inteira desliga silenciosamente, todo usuário vinculado degrada para o robô.
- **Melhoria Proposta**
  > Adicionar `CONEXOS_CRED_ENC_KEY: { sync: false }` no `render.yaml` (bloco `envVars` do serviço backend) e um placeholder comentado no `src/backend/.env.example`. Opcional: fail-fast no bootstrap se a chave estiver ausente **fora** de produção-legada, para que dev novo bata na parede em vez de operar em modo degradado. **Tactic Bass alvo: Configure Behavior.**
- **Resultado Esperado**
  > `grep -rn "CONEXOS_CRED_ENC_KEY" src/backend/.env.example render.yaml` retorna 2 matches. Novo dev/staging sabe **antes de rodar** que precisa de uma chave; se subir sem ela, o boot falha ou grita.
- **Tactic alvo**: Configure Behavior
- **Severidade**: P1
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-integrability-6
- **Métricas de sucesso**:
  - Arquivos de contrato de config declarando a chave: 0/2 → 2/2
  - Ambientes que degradam silenciosamente: N → 0 (com fail-fast opcional)
- **Risco de não fazer**: o segundo tenant sobe sem a chave e ninguém percebe. A Fatia B fica de enfeite lá; a auditoria de identidade acumula `NULL/NULL` porque o vínculo sempre falha em `decrypt`.
- **Dependências**: nenhuma. Já registrado no `ontology/_inbox/conexos-fallback-audit-regis-followups.md` F-1 como "segurado pelo Yuri" — reafirmando aqui como card de integrability porque o problema não é apenas config, é **contrato de integração** com a plataforma Render/tenant.

## 6. Notas do agente

- Ontologia validada contra código: `ontology/integrations/conexos.md` §"Identidade da sessão" está **fiel** à implementação (5 situações de fallback, chave `columbia:user:<login>`/`columbia-default`, viagem via `sid` + `cnx-usncod`). A tabela de decisão bate 1:1 com `ConexosSessionResolver.resolve` (`src/backend/domain/client/ConexosSessionResolver.ts:56-70`). O único gap na ontologia: menciona `cnx-usncod` mas não diz explicitamente que o valor sai da resposta do `POST /login` da sessão específica — o código deixa claro (`services/conexos.ts:238-239`). Sugestão: adicionar uma linha "capturado do `resp.data.usnCod` do `/login` da sessão em uso" na §"Identidade da sessão".
- Boundary preservado: `LegacyConexosShape`, `ConexosBaseClient` e os 11 sub-clients Conexos NÃO foram tocados no delta — é exatamente o ponto forte de integrability deste PR. O seam de identidade cabe num único ponto de decisão (resolver) e um único ponto de leitura (provider).
- Cross-QA:
  - **Modifiability**: F-integrability-1 (provider em `domain/client`) e F-integrability-2 (import de `services/`) são os MESMOS artefatos que o `qa-modifiability` deve olhar como "obstáculo à migração DDD-Lambda". Consolidar como card único.
  - **Fault Tolerance**: F-integrability-6 (chave de cifra ausente) sobrepõe com "modo degradado silencioso" — flag jointly com `qa-fault-tolerance`.
  - **Security**: `SecretCipher` e o `warn` que nunca vaza senha (`ConexosSessionResolver.test.ts:170-186`) são positivos para Security — não achar nada aqui.
- Métrica que tentei coletar e falhei: número de chamadas em produção que já degradam para o robô (métrica agregada com dimensão `conexosUsername`). Requer painel sobre `LOG_TYPE.BUSINESS_WARN` no destino de logs (Papertrail/Loki/CloudWatch dependendo do tenant); ficou em F-5 do `-regis-followups.md`. Não medível localmente.
