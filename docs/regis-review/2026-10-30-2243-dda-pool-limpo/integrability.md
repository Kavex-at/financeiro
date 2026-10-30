---
qa: Integrability
qa_slug: integrability
run_id: 2026-10-30-2243-dda-pool-limpo
agent: qa-integrability
generated_at: 2026-10-30T22:50:00-03:00
scope: backend+frontend (diff `dda-pool-limpo` apenas)
score: 7.5
findings_count: 5
cards_count: 4
---

# Integrability — Regis-Review

## 1. Cenário Geral (Bass General Scenario aplicado ao nf-projects)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Mudança na janela da carteira (fin064) ou nova situação derivada do pool DDA (ex.: `TITULO_SAIU_CARTEIRA`) exigida pela área financeira | Delta no contrato `BoletoDdaConsolidado` + nova constante compartilhada entre ingestão (`IngestaoPagamentosService`), consolidação (`ConsolidacaoBoletoDda`) e serviço de aba (`BoletoDdaService`) | 3 serviços backend + repositório `TituloAPagarRepository` + rota Zod `boletos-dda` + 7 arquivos de UI em `src/frontend/app/sispag/boletos-dda/` e `src/frontend/lib/sispag.ts` | Desenvolvimento (sem feature flag; deploy lockstep FE+BE pelo `chore(release)`) | A integração se dá em UM lugar (constante + union literal + Record exaustivo), sem edição espalhada; valores novos aparecem em facetas, filtros Zod e cards sem retrabalho | ≤2 pontos de edição por nova `BoletoDdaSituacao`; 0 duplicação da janela (−15/+45 dias); contrato backend ⇄ frontend sem campos obrigatórios faltantes |

> Esta review avalia **apenas o diff `dda-pool-limpo`** (constante `JanelaCarteira`, novas situações `FORA_JANELA`/`TITULO_SAIU_CARTEIRA`, campo `arquivos`/`copias`, novo repo `listInativosRecentes`), não a integrabilidade geral do SISPAG.

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Duplicações do par (−15, +45) depois do refactor | 0 (3 call-sites importam de `libs/calendar/JanelaCarteira.ts`) | 0 | ✅ | `grep -n "JANELA_CARTEIRA" src/backend` (3 serviços + 1 interface comentário) |
| Call-sites que leem a janela via constante compartilhada | 3 (`IngestaoPagamentosService:368-369`, `ConsolidacaoBoletoDda:86-87`, `BoletoDdaService:141-142`) | ≥3 | ✅ | `grep -n JANELA_CARTEIRA src/backend/domain/service/sispag/*.ts` |
| Union `BoletoDdaSituacao` sincronizada BE⇄FE | 6 valores idênticos nos dois lados | 6/6 | ✅ | `BoletoDda.ts:55-62` ⇄ `sispag.ts:1675-1681` |
| `BoletoDdaContagem`/`Totais` dependem só do union | sim — `Record<BoletoDdaSituacao \| ...>` nos 2 lados | sim | ✅ | `sispag.ts:1743,1759` + `PaginacaoBoletoDda.ts:325-343` |
| Enum Zod da rota derivado programaticamente do contrato | sim — `SITUACOES_FILTRAVEIS = Object.values(BOLETO_DDA_SITUACAO)` | sim | ✅ | `PaginacaoBoletoDda.ts:410` + `routes/sispag.ts:1547,1567` |
| Campos novos do payload opcionais (compat retro) | 2 opcionais (`titulosSaidos?`, `copias?`) + **1 obrigatório** (`arquivos: number`) | 100% opcional ou feature flag | ⚠️ | `BoletoDda.ts:116,139` + `sispag.ts:1715` |
| Campo backend expõe que o frontend não tipa | 1 (`copias?: BoletoDdaCopia[]`) | 0 | ⚠️ | `BoletoDda.ts:94,120-121` sem par em `sispag.ts` |
| Janela (−15/+45) configurável por tenant/env | não — hard-coded em `JanelaCarteira.ts:6-7` | configurável via `EnvironmentProvider` quando houver 2º tenant | ⚠️ | `src/backend/domain/libs/calendar/JanelaCarteira.ts:1-7` |
| Validação Zod cobre as novas situações | sim (auto, via `Object.values`) | sim | ✅ | `routes/sispag.ts:1547` |
| Serviço com >3 colaboradores injetados tocado neste diff | `BoletoDdaService` com 16 injects (pré-existente; +0 neste diff) | ≤8 | ⚠️ | `grep -c @inject BoletoDdaService.ts` → 16 |
| Nº de arquivos tocados para adicionar as 2 situações novas | 11 (6 BE + 5 FE) | ≤12 | ✅ | `git diff --stat` |

> ⚠️ **Não medível localmente**: contagem real de clientes consumidores do payload `BoletosDdaResposta` (há só UM consumidor — a aba SISPAG), portanto o custo do campo obrigatório `arquivos` é limitado ao deploy lockstep do próprio monorepo.

## 3. Tactics — Cobertura no nf-projects

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Encapsulate | Janela da carteira isolada em `JanelaCarteira.ts`; três serviços antes computavam `−15`/`+45` separados | ✅ presente | `src/backend/domain/libs/calendar/JanelaCarteira.ts:6-7`; antes: `IngestaoPagamentosService.ts:368-369` tinha `15*DAY_MS`/`45*DAY_MS` literal |
| Use an Intermediary | `ConsolidacaoBoletoDda` é intermediária pura (4 injects, sem I/O) entre `BoletoDdaService` e a regra `RegraSugestaoBoleto`; `BoletoDdaService.comGrupo` resolve pivot de cópia por grupo antes de entregar à rota | ✅ presente | `ConsolidacaoBoletoDda.ts:76-82`; `BoletoDdaService.ts:175-209` |
| Restrict Communication Paths | FE fala só com a rota `/sispag/boletos-dda`; cópias (`BoletoDdaCopia`) são deliberadamente escondidas do contrato FE | ✅ presente | `BoletoDdaService.ts:191-209` reescreve `ddcCod/ditCod` para a cópia com grupo CONFIRMADO antes de serializar |
| Adhere to Standards | `const object + as const + Record<Enum, …>` padrão repetido para `BOLETO_DDA_SITUACAO`, `BoletoDdaContagem`, `BoletoDdaTotais`; Zod `z.enum(Object.values(...))` deriva do mesmo | ✅ presente | `BoletoDda.ts:63-67`; `PaginacaoBoletoDda.ts:160-165,410`; `routes/sispag.ts:1547` |
| Abstract Common Services | `BankingCalendar.addDays`/`fromErpEpoch` continua único (`+/-` dias civis). Nova constante NÃO virou `BankingCalendar.janelaCarteira()` — é tupla solta importada | ⚠️ parcial | `JanelaCarteira.ts` é só duas `export const`; não há método em `BankingCalendar` |
| Discover Service | N/A — integração interna, sem registry de serviço (SSM/Conexos não tocado por este diff) | N/A | diff não toca client/SSM |
| Tailor Interface | `BoletoDdaConsolidado.copias` fica no BE (uso interno de `comGrupo`), e o frontend recebe só `arquivos: number` + `titulosSaidos` + `copias?` ignorado — interface deliberadamente mais estreita | ⚠️ parcial | `sispag.ts:1715` não declara `copias`; o campo CHEGA no JSON mas não há tipo; se um dev FE for usar, não há schema |
| Configure Behavior | `JANELA_CARTEIRA_*`, `LIMITE_DIAS_SAIDO=10`, `LIMITE_VALOR_SAIDO_CENTAVOS=5`, `RELEITURA_DIAS=60`, `BOLETO_DDA_PRAZO_MS=60_000` todos como `const` no código, não via `EnvironmentProvider` | ⚠️ parcial | `JanelaCarteira.ts:6-7`; `ConsolidacaoBoletoDda.ts:30-31`; `BoletoDdaService.ts:49,54` |
| Manage Resources | `BoundedConcurrency(FANOUT_LIMIT=3)` + `withAdvisoryLock(BOLETO_DDA_SYNC_LOCK_KEY)` + `ConsolidacaoBoletoDdaCache` chaveado por `[escopo, hoje, sincronizadoEm, carteiraEm, lotes, sugestoesCache.versao()]` | ✅ presente | `BoletoDdaService.ts:101-111,222-234,409-419` |
| Orchestrate | `BoletoDdaService.listar` orquestra 4 reads em `Promise.all` + consolidação + grupos + paginação, de forma linear; `BoletoDdaService.consolidarEscopo` orquestra 4 reads mais; sem event-bus | ⚠️ parcial | `BoletoDdaService.ts:94-99,136-150` |
| Manage Resource Coupling | `BoletoDdaService` tem **16 injeções** (`grep -c @inject` → 16). Qualquer troca de 1 colaborador exige mocar os 16 em teste. Pré-existente; **não degradado** por este diff | ⚠️ parcial | `grep -c "@inject" src/backend/domain/service/sispag/BoletoDdaService.ts` → 16 |
| Contract testing (fixture / schema-pinned) | `ConsolidacaoBoletoDda.test.ts` cobre cenários novos (`FORA_JANELA`, `TITULO_SAIU_CARTEIRA`, colapso por `codbar`); `ConsolidacaoBoletoDdaCache.test.ts` ajustado; `sispag.test.ts` FE adiciona a situação — mas não há snapshot do payload inteiro | ✅ presente | `ConsolidacaoBoletoDda.test.ts:234-290`; `PaginacaoBoletoDda.test.ts +55 linhas` |
| Versioning strategy | `BoletosDdaResposta` tem comentários "Backend anterior à v0.80/v0.81 não manda" para campos opcionais, mas o novo `arquivos: number` é obrigatório sem bump explícito de contrato | ⚠️ parcial | `sispag.ts:1715,1787,1796` |
| Backward-compat shims | Nenhum necessário no backend; frontend atualizado no mesmo diff (política lockstep do monorepo); nenhum consumidor externo | ✅ presente | lockstep documentado em `CLAUDE.md` Green criteria #10 |
| Observability of integration failures | `gruposOuNenhum` degrada graciosamente com `logService.warn` quando `BoletoSuggestionService.gruposPorBoleto` falha (resumo de grupo "desliga", lista continua). Falha ao ler título inativo (`listInativosRecentes`) não tem fallback dedicado — se o SELECT novo falhar, `consolidarEscopo` propaga | ⚠️ parcial | `BoletoDdaService.ts:153-168` (fallback) ; `TituloAPagarRepository.ts:252-269` (sem try/catch no serviço chamador) |

## 4. Findings

### F-integrability-1: Campo `arquivos: number` obrigatório sem shim de retrocompatibilidade

- **Severidade**: P2 (médio — débito defensável)
- **Tactic violada**: Backward-compatibility shims / Versioning strategy
- **Localização**: `src/backend/domain/interface/sispag/BoletoDda.ts:116`, `src/frontend/lib/sispag.ts:1715`
- **Evidência (objetiva)**:
  ```ts
  // backend
  arquivos: number;                 // obrigatório
  copias?: BoletoDdaCopia[];        // opcional
  // frontend
  arquivos: number                  // obrigatório
  ```
  Para `BoletoDdaConsolidado`, o diff introduz 1 campo obrigatório. Para `BoletosDdaResposta.contagem`, dois novos keys obrigatórios (`FORA_JANELA`, `TITULO_SAIU_CARTEIRA`) via o `Record<BoletoDdaSituacao,...>`.
- **Impacto técnico**: Deploy lockstep é a única salvaguarda; um FE antigo contra BE novo (ex.: aba aberta em cache do browser, service-worker Vercel atrasado) renderiza `undefined`/`NaN` nas colunas que leem `arquivos`. Nenhum shim nem default.
- **Impacto de negócio**: Baixo — monorepo single-consumer, release `chore(release)` sincronizado. O risco cresce quando a aba for incorporada em webviews externas ou quando o contrato DDA for exposto a outro cliente além da Columbia.
- **Métrica de baseline**: 1 campo obrigatório novo (`arquivos`) + 2 keys obrigatórios em `contagem`/`totais` sem default no serializador BE. Call-sites FE que leem `arquivos`: 2 (`CardsBoletosDda.tsx`, `TabelaBoletosDda.tsx` — verificar).

### F-integrability-2: `BoletoDdaCopia` existe no backend, mas o frontend não declara o tipo

- **Severidade**: P3 (baixo)
- **Tactic violada**: Tailor Interface (parcial — ok como design, mas sem documentação do "porquê")
- **Localização**: `src/backend/domain/interface/sispag/BoletoDda.ts:94-99,120-121` ⇄ ausente em `src/frontend/lib/sispag.ts`
- **Evidência (objetiva)**: Campo `copias?: BoletoDdaCopia[]` serializado no payload, mas sem par em `BoletoDda` no FE. `BoletoDdaService.comGrupo` o usa internamente para pivotar `ddcCod/ditCod` quando o grupo CONFIRMADO foi tagueado em outra cópia (`BoletoDdaService.ts:181-208`). O FE lê apenas o escalar `arquivos`.
- **Impacto técnico**: Dev FE que precisar surfaceá-las no futuro não tem tipo; terá que replicar `BoletoDdaCopia`. Payload trafega bytes a mais (até 4-5 cópias × ~40 bytes por boleto).
- **Impacto de negócio**: Desprezível no curto prazo; vira dívida quando a UI "ver cópias" nascer.
- **Métrica de baseline**: 1 campo serializado sem tipo FE correspondente.

### F-integrability-3: Janela da carteira (−15/+45) hard-coded, sem gancho de configuração

- **Severidade**: P2 (médio)
- **Tactic violada**: Configure Behavior
- **Localização**: `src/backend/domain/libs/calendar/JanelaCarteira.ts:6-7`
- **Evidência (objetiva)**:
  ```ts
  export const JANELA_CARTEIRA_DIAS_ATRAS = 15;
  export const JANELA_CARTEIRA_DIAS_ADIANTE = 45;
  ```
  Tactic Encapsulate foi aplicada (bom) — mas a próxima linha deveria ser `Configure Behavior`: a janela é propriedade DA CARTEIRA (fin064) e muda se a Columbia renegociar o filtro no ERP. Hoje a troca é hot-fix + release.
- **Impacto técnico**: Mudança do fin064 do lado da Columbia → código, build e deploy. Nenhum valor de tenant/env sobrescreve.
- **Impacto de negócio**: Hoje baixo (único tenant, janela estável desde 2026-09). Vira P1 quando houver 2º tenant SISPAG ou se a carteira do fin064 for parametrizada por filial.
- **Métrica de baseline**: 0 ganchos `EnvironmentProvider` para a janela; 2 constantes `export const` cruas; 3 call-sites.

### F-integrability-4: Novo `TituloAPagarRepository.listInativosRecentes` sem fallback no orquestrador

- **Severidade**: P2 (médio)
- **Tactic violada**: Observability of integration failures / Fault boundary
- **Localização**: `src/backend/domain/repository/sispag/TituloAPagarRepository.ts:252-269`; `src/backend/domain/service/sispag/BoletoDdaService.ts:136-145`
- **Evidência (objetiva)**: Em `consolidarEscopo`, as 4 leituras rodam em `Promise.all`. Uma falha de `listInativosRecentes` (ex.: índice ausente, estouro de intervalo) derruba a aba inteira: a lista para de carregar, mesmo que `TITULO_SAIU_CARTEIRA` seja a situação menos crítica (escondida da lista padrão). Compare com `gruposOuNenhum` (`BoletoDdaService.ts:153-168`), que tem try/catch dedicado e degrada "só o resumo de grupo".
- **Impacto técnico**: Novo caminho de erro acoplado ao caminho feliz; a situação secundária arrasta a primária.
- **Impacto de negócio**: Aba offline por consulta cuja situação alvo é escondida por default.
- **Métrica de baseline**: 1 chamada nova sem try/catch isolado em orquestrador que já tem 1 try/catch de precedente (grupos).

### F-integrability-5: `BoletoDdaService` com 16 injeções — pré-existente, não degradado

- **Severidade**: P3 (baixo — contexto para o consolidador)
- **Tactic violada**: Manage Resource Coupling
- **Localização**: `src/backend/domain/service/sispag/BoletoDdaService.ts:65-84`
- **Evidência (objetiva)**: `grep -c "@inject" BoletoDdaService.ts` → 16. Qualquer teste de integração mocka 16 dependências.
- **Impacto técnico**: Alto acoplamento conceitual. Este diff **não adiciona** injeções novas (reaproveita `TituloAPagarRepository`, `ConsolidacaoBoletoDda`, `BankingCalendar` já presentes).
- **Impacto de negócio**: Risco de bola de neve: a próxima feature DDA que precisar de "mais um colaborador" vai cair aqui.
- **Métrica de baseline**: 16 injeções; alvo razoável ≤8.

> **Cross-QA**: F-integrability-4 toca Fault-Tolerance ("Limit Fault Propagation"); F-integrability-5 toca Modifiability ("High Cohesion / Low Coupling"); F-integrability-1 toca Modifiability (contrato BE⇄FE). Sinalizar ao consolidador.

## 5. Cards Kanban

### [integrability-1] Introduzir shim retrocompatível no serializador do pool DDA

- **Problema**
  > O diff adiciona `arquivos: number` obrigatório e dois keys obrigatórios em `BoletoDdaContagem`/`BoletoDdaTotais` (`FORA_JANELA`, `TITULO_SAIU_CARTEIRA`). Deploy lockstep FE+BE é a única salvaguarda; um FE em cache de SW/CDN contra BE novo renderiza NaN em cards KPI.
- **Melhoria Proposta**
  > Adotar tactic *Backward-compatibility shims* em dois pontos: (1) tornar `arquivos` opcional no contrato FE (`arquivos?: number` com default `1` em `CardsBoletosDda`/`TabelaBoletosDda`) OU manter obrigatório e documentar política de bump maior; (2) acrescentar comentário "Backend anterior à vX não manda `FORA_JANELA`/`TITULO_SAIU_CARTEIRA`" em `BoletoDdaContagem`, análogo ao padrão de `totais?` e `conferidoEm?`.
- **Resultado Esperado**
  > FE em versão anterior consegue renderizar payload BE novo sem quebra visível. Ratio de campos obrigatórios/opcionais novos: `3/3` → `0/3`.
- **Tactic alvo**: Backward-compatibility shims
- **Severidade**: P2
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-integrability-1
- **Métricas de sucesso**:
  - Campos novos obrigatórios no contrato wire: 3 → 0
  - Deploy lockstep necessário: sim → não (quando release pular 1 versão FE)
- **Risco de não fazer**: Em 6 meses, com a aba incorporada em webview Columbia ou cache CDN prolongado, 1 incidente de "cards zerados" em release.
- **Dependências**: nenhuma

### [integrability-2] Blindar `consolidarEscopo` contra falha do `listInativosRecentes`

- **Problema**
  > A nova query de títulos inativos entra num `Promise.all` sem try/catch dedicado. Falha dela derruba a aba inteira, mesmo sendo situação escondida da lista padrão (`TITULO_SAIU_CARTEIRA` serve só ao filtro próprio).
- **Melhoria Proposta**
  > Envelope análogo a `gruposOuNenhum`: `listInativosRecentesOuVazio` que captura, loga `BUSINESS_WARN` e devolve `[]`. Consolidação segue entregando `FORA_JANELA`/`SEM_TITULO` normalmente.
- **Resultado Esperado**
  > Falha isolada no caminho secundário não propaga para o primário.
- **Tactic alvo**: Observability of integration failures / Limit Fault Propagation
- **Severidade**: P2
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-integrability-4
- **Métricas de sucesso**:
  - Caminhos secundários sem fallback no `consolidarEscopo`: 1 → 0
  - Logs `BUSINESS_WARN` dedicados a falhas de leitura inativa: 0 → 1
- **Risco de não fazer**: Incidente de aba DDA offline causado por regressão em query de situação escondida.
- **Dependências**: nenhuma

### [integrability-3] Expor janela da carteira via `EnvironmentProvider`

- **Problema**
  > `JANELA_CARTEIRA_DIAS_ATRAS=15` / `_ADIANTE=45` são `export const` fixos. A janela é propriedade da **carteira do ERP (fin064)** da Columbia; se mudar, troca-se código e sobe-se release.
- **Melhoria Proposta**
  > Mover para `EnvironmentProvider.janelaCarteira(): { diasAtras, diasAdiante }` com default `(15, 45)` e override por SSM/env (preparando o 2º tenant SISPAG). Os 3 call-sites passam a resolver via container. Alternativa menor: encapsular como método em `BankingCalendar` para o próximo passo.
- **Resultado Esperado**
  > Mudar a janela deixa de exigir rebuild — passa a ser hot-reload de config.
- **Tactic alvo**: Configure Behavior
- **Severidade**: P2
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-integrability-3
- **Métricas de sucesso**:
  - Call-sites com janela configurável: 0/3 → 3/3
  - Rebuild necessário para mudar a janela: sim → não
- **Risco de não fazer**: Quando a 2ª empresa do grupo Columbia subir no SISPAG com janela diferente, vira hot-fix com release.
- **Dependências**: Nenhuma; se o padrão `EnvironmentProvider.janela*` for adotado, outras constantes (`RELEITURA_DIAS`, `BOLETO_DDA_PRAZO_MS`) viram candidatas.

### [integrability-4] Documentar política do contrato FE para `copias`

- **Problema**
  > `BoletoDdaCopia` existe no backend e vai pelo wire; o FE não tipa (nem usa). Decisão deliberada do `comGrupo` (pivotar `ddcCod/ditCod` no servidor), mas sem comentário no FE.
- **Melhoria Proposta**
  > Em `src/frontend/lib/sispag.ts` perto de `BoletoDda`, acrescentar comentário: "O backend serializa `copias?: Array<{ddcCod, ditCod, arquivo?, importadoEm?}>` mas o FE não consome — o pivot já foi feito em `BoletoDdaService.comGrupo`. Qualquer uso FE precisa republicar o tipo." Opcional: declarar `copias?: unknown[]` para evitar pass-through acidental.
- **Resultado Esperado**
  > Próximo dev FE sabe por que o campo chega e não é tipado.
- **Tactic alvo**: Tailor Interface
- **Severidade**: P3
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-integrability-2
- **Métricas de sucesso**:
  - Comentário presente: não → sim
- **Risco de não fazer**: Dev FE replica `BoletoDdaCopia` sem alinhar e cria segundo contrato.
- **Dependências**: nenhuma

## 6. Notas do agente

- Escopo respeitado — review olhou apenas o diff `dda-pool-limpo`; não há finding sobre o legado SISPAG geral.
- Métrica positiva do diff: redução concreta de 2 → 0 duplicações da janela (−15/+45) depois da extração para `JanelaCarteira.ts`; `IngestaoPagamentosService:368-369` antes tinha `15 * DAY_MS` literal.
- "Parallel `fornecedor` worker contract" mencionado no prompt não foi tocado por este diff — nenhuma mudança em `ChannelProfileCalculator`/`PerfilCanalService`. Interplay com cache `SugestaoBoletoCache/ConsolidacaoBoletoDdaCache` chaveado por `ddcCod:ditCod` (`GrupoBoletoService.ts:96`) permanece válido — chaves não mudaram.
- Cross-QA: F-integrability-1 overlaps Modifiability (contrato); F-integrability-4 overlaps Fault-Tolerance; F-integrability-5 overlaps Modifiability (coupling).
