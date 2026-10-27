---
qa: Modifiability
qa_slug: modifiability
run_id: 2026-10-27-1803-sispag-vinculo-data-divergente
agent: qa-modifiability
generated_at: 2026-10-27T18:03:00-03:00
scope: all
score: 7
findings_count: 4
cards_count: 4
---

# Modifiability — Regis-Review

## 1. Cenário Geral (Bass General Scenario aplicado ao nf-projects)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Produto (ADR-0078) | Nova regra para divergência de data Δ ∈ [-10,-1]∪[6,10] com valor igual (I15r/I17p/I17q) exige reconhecimento tipado, 7º check de fator de vencimento, prazo efetivo pelo boleto | SISPAG: `BoletoSuggestionService`, `MotorSugestaoBoleto`, `ElegibilidadeVinculoCodigoBarras`, novas libs `boleto/*`, UI `SugestaoBoletoPainel`/`situacao/*` | Fase 1 (acknowledgement, sem binding) em HML | Delta localizado nas novas libs puras (`PrazoBoletoCalculador`, `FatorVencimentoBoleto`, `PrazoFinalBoleto`, `ReconhecimentoDivergencia`, `ConferenciaReconhecimento`); services grandes recebem +115/+30 LOC ao invés de novos splits | LOC adicionado por módulo ≤ 100 fora das classes gigantes; sem duplicação cross-camada > 1 função |

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| LOC `BoletoSuggestionService.ts` (pós) | 1287 (+105) | ≤ 600 | ❌ | `wc -l` + `git diff --numstat` |
| LOC `MotorSugestaoBoleto.ts` (pós) | 1097 (+29) | ≤ 600 | ❌ | `wc -l` + `git diff --numstat` |
| LOC `ElegibilidadeVinculoCodigoBarras.ts` | 335 (+20 líquido) | ≤ 400 | ✅ | `wc -l` + diff |
| Libs novas em `domain/libs/boleto/` | 5 arquivos (`FatorVencimentoBoleto` 62, `PrazoFinalBoleto` 31, `ReconhecimentoDivergencia` 28, `DataCandidataItem` 61, `PrazoBoletoCalculador` 91) | p95 ≤ 400 | ✅ | `wc -l src/backend/domain/libs/boleto/*.ts` |
| Duplicação `diasEntre`/`diferencaDias` + `DIA_MS = 86_400_000` cross-camada | 2 implementações independentes (backend `FatorVencimentoBoleto.ts:6`, `ElegibilidadeVinculoCodigoBarras.ts:120`; frontend `prazoTitulo.ts:12-17`) | 1 utilitário por camada reutilizado | ⚠️ | `grep -c "86_400_000\|24 \* 60 \* 60"` |
| Cross-layer violations introduzidas | 0 | 0 | ✅ | diff reader (todas as novas classes `@injectable()`, repositórios usam `$1/$2`) |
| Gate PatternGuardian | pass | pass | ✅ | `_shared-metrics.md` (lint 0 errors, typecheck clean) |
| Fan-in de `BoletoSuggestionService` tocado pelo delta | 1 rota (`routes/sispag.ts`) + 1 UI (`SugestaoBoletoPainel`) + testes | — | ✅ | diff |
| Magic numbers em services novos (regras de negócio) | 0 (`VINCULO_DIAS_MIN=0`, `DIAS_DEPOIS_MAX` reusado, `CICLO_DIAS=9000`, `CICLOS_CONSIDERADOS=6` são constantes nomeadas FEBRABAN) | 0 na faixa de política | ✅ | leitura dos novos arquivos |
| Ontology coverage drift (delta) | atualizado (`_coverage.json`, `_index.json`, novas regras I15r/I17p/I17q, ADR-0078) | sem drift | ✅ | `ontology/CHANGELOG.md` v0.76.0 |

> ⚠️ **Não medível localmente (delta)**: fan-in exato das classes grandes (precisa de madge/ts-morph). Aproximado por `grep -rln`.

## 3. Tactics — Cobertura no nf-projects

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Split Module | Delta criou 5 libs puras pequenas em `domain/libs/boleto/` ao invés de inflar `MotorSugestaoBoleto`; `ConferenciaReconhecimento` e `PrazoBoletoCalculador` extraídos de `BoletoSuggestionService` | ⚠️ parcial | `src/backend/domain/libs/boleto/{FatorVencimentoBoleto,PrazoFinalBoleto,ReconhecimentoDivergencia,DataCandidataItem}.ts`, `service/sispag/{PrazoBoletoCalculador,ConferenciaReconhecimento}.ts` — mas `BoletoSuggestionService` ainda ganhou +105 LOC |
| Increase Semantic Coherence | Libs novas 1-propósito (decodificador de fator, cálculo de prazo final, DTO de reconhecimento, candidato por item, prazo efetivo por título) | ✅ presente | arquivos de 28–91 LOC, cada um com um conceito |
| Encapsulate | `ElegibilidadeVinculoCodigoBarras.lerCodigo` passou a servir 1:1 e item de borderô via parâmetro `motivoFatorDiverge` com default — encapsula a leitura/decodificação do código em um ponto só | ✅ presente | `ElegibilidadeVinculoCodigoBarras.ts:282-321`; chamada em `:168` e `:223` |
| Use an Intermediary | `PrazoBoletoCalculador` é intermediário puro entre o cenário do motor e a UI (serializado em `prazoBoleto`); `ConferenciaReconhecimento` é intermediário entre payload da rota e persistência | ✅ presente | `PrazoBoletoCalculador.ts`, `ConferenciaReconhecimento.ts:93 LOC` |
| Restrict Dependencies | Novas libs em `domain/libs/boleto/` não importam de `service/` nem de `repository/`; frontend `prazoTitulo.ts` consome só o DTO | ✅ presente | leitura dos imports |
| Refactor | `BoletoSuggestionService` **não** foi refatorado — I15r foi adicionado em-linha ao `confirmar` (bloco de ~40 LOC) e via novo método `contextoPorTitulo`; o service ficou mais denso em vez de mais fino | ⚠️ parcial | `BoletoSuggestionService.ts` 1182 → 1287 LOC |
| Abstract Common Services | Aritmética `diasEntre` sobre `YYYY-MM-DD` reimplementada em `FatorVencimentoBoleto.ts:129`, `ElegibilidadeVinculoCodigoBarras.ts:129` e `frontend/prazoTitulo.ts:17`; `BankingCalendar` existe mas não é usado nos novos sítios puros | ⚠️ parcial | `grep -c "86_400_000\|24 \* 60 \* 60"` |
| Defer Binding (DI / plugin / config) | Tudo `@injectable()`; `ConferenciaReconhecimento` com API estática puro (sem DI) — aceitável por ser função; novas libs resolvidas via `container` | ✅ presente | decoradores presentes em todos os novos arquivos de service/lib |
| Defer Binding (feature flag / runtime variability) | Fase 2 do binding atrás de `SISPAG_BIND_CODBAR_DATA_DIVERGENTE_FILIAIS` (não no delta) — padrão já estabelecido para rollout por filial | ✅ presente | ADR-0078; `_shared-metrics.md` |

## 4. Findings

### F-modifiability-1: `BoletoSuggestionService` cresceu +105 LOC e passa de 1 282 — Split Module não foi aplicado

- **Severidade**: P1
- **Tactic violada**: Split Module / Refactor
- **Localização**: `src/backend/domain/service/sispag/BoletoSuggestionService.ts` (1 182 → 1 287 LOC)
- **Evidência (objetiva)**:
  ```
  git diff origin/main...HEAD --numstat src/backend/domain/service/sispag/BoletoSuggestionService.ts
  115    10    src/backend/domain/service/sispag/BoletoSuggestionService.ts
  wc -l → 1287
  ```
  O delta adiciona ao `confirmar` um bloco de ~40 LOC para reconhecimento tipado (I15r), um novo método privado `validadeDoReconhecimento` e o método público `contextoPorTitulo` (~35 LOC), em vez de deslocar para um colaborador dedicado.
- **Impacto técnico**: cada nova nuance de reconhecimento (fase 2 do binding, novas regras I19x) tende a cair no mesmo arquivo; teste reaproveita o setup pesado do service (173 LOC só no teste do delta). Fan-in alto do service multiplica blast-radius.
- **Impacto de negócio**: o próximo ciclo (binding real, SISPAG_BIND_CODBAR_DATA_DIVERGENTE_FILIAIS) vai tocar o mesmo arquivo; risco de rebase/conflito em paralelo com outras features SISPAG.
- **Métrica de baseline**: 1 287 LOC (alvo p95 ≤ 400); +8,9 % de LOC em uma feature de fase 1.

### F-modifiability-2: Aritmética de dias civis replicada em 3 sítios novos

- **Severidade**: P2
- **Tactic violada**: Abstract Common Services
- **Localização**:
  - `src/backend/domain/libs/boleto/FatorVencimentoBoleto.ts:6`
  - `src/backend/domain/libs/boleto/ElegibilidadeVinculoCodigoBarras.ts:120,129`
  - `src/frontend/app/sispag/situacao/prazoTitulo.ts:12-17`
- **Evidência (objetiva)**:
  ```
  const DIA_MS = 24 * 60 * 60 * 1000;              // backend libs/boleto
  const MS_DIA = 86_400_000                         // frontend prazoTitulo
  const diasEntre = (de, ate) => Math.round(...)   // repetido com nome e assinatura diferentes
  ```
  Backend tem `BankingCalendar.fromErpEpoch/toErpEpoch` (CLAUDE.md gotcha) que já cobre dia civil, mas nenhum dos novos arquivos puros o usa.
- **Impacto técnico**: cada mudança de regra (DST hipotética, mudança de fuso, migração para `Temporal`) ripples por 3 arquivos; a inconsistência de nome (`diasEntre` vs `diferencaDias`) atrapalha busca.
- **Impacto de negócio**: baixo hoje; alto na próxima vez que alguém mexer em cálculo de prazo e esquecer um sítio.
- **Métrica de baseline**: 3 implementações independentes do mesmo utilitário no delta.

### F-modifiability-3: `ElegibilidadeVinculoCodigoBarras.lerCodigo` parametrizado por default-arg mistura dois contratos

- **Severidade**: P2
- **Tactic violada**: Increase Semantic Coherence
- **Localização**: `src/backend/domain/libs/boleto/ElegibilidadeVinculoCodigoBarras.ts:282-321` (`lerCodigo` com `motivoFatorDiverge: MotivoInelegivelVinculo = FATOR_VENCIMENTO_DIVERGE`)
- **Evidência (objetiva)**: a mesma função devolve `FATOR_VENCIMENTO_DIVERGE` quando chamada por `avaliar` (1:1, ADR-0078) e `BOLETO_INCONSISTENTE` quando chamada por `avaliarItemDeBordero` (ADR-0077). O chamador de borderô monta um `EntradaElegibilidadeVinculo` sintético (`as EntradaElegibilidadeVinculo`, l.229) só para reaproveitar.
- **Impacto técnico**: cast estrutural (`as`) oculta campos obrigatórios; evoluir a entrada do 1:1 pode quebrar a borderô silenciosamente. Dois motivos legítimos no mesmo caminho condicional reduzem coesão semântica.
- **Impacto de negócio**: ambos ADRs (0077 e 0078) estão vivos; qualquer ajuste em um força testes do outro. Risco médio para a próxima tweak.
- **Métrica de baseline**: 1 função com 2 contratos distintos distinguidos por default-arg + 1 cast estrutural (`as EntradaElegibilidadeVinculo`).

### F-modifiability-4: Noção de `prazoBoleto` duplicada entre backend `PrazoBoletoCalculador` e frontend `prazoTitulo.ts`

- **Severidade**: P3
- **Tactic violada**: Use an Intermediary / Abstract Common Services
- **Localização**: `src/backend/domain/service/sispag/PrazoBoletoCalculador.ts` (91 LOC) + `src/frontend/app/sispag/situacao/prazoTitulo.ts` (64 LOC) + `src/frontend/app/sispag/situacao/VencimentoCelula.tsx` (uso)
- **Evidência (objetiva)**: ambos replicam o critério "o boleto puxa o prazo" via `ORIGEM.BOLETO_SUGERIDO`; o front calcula `diasAtePrazo = diasAteVencimento + diferencaDias(vencimentoTitulo, prazoEfetivo)` em vez de receber o campo pronto do backend.
- **Impacto técnico**: mudar o conceito de "perdido"/"origem" exige coordenar backend + frontend. Hoje a definição é compartilhada por constantes importadas (`ORIGEM_PRAZO`), o que mitiga.
- **Impacto de negócio**: baixo. É um split camada-apresentação legítimo.
- **Métrica de baseline**: 2 implementações do mesmo conceito; `diasAtePrazo` não vem no DTO.

## 5. Cards Kanban

### [modifiability-1] Extrair o fluxo de reconhecimento tipado de `BoletoSuggestionService`

- **Problema**
  > `BoletoSuggestionService` chegou a 1 287 LOC (+105 nesta feature) absorvendo o reconhecimento tipado da divergência de data (I15r) e o novo `contextoPorTitulo`. O arquivo já era o maior service do SISPAG e a fase 2 (binding real, flag `SISPAG_BIND_CODBAR_DATA_DIVERGENTE_FILIAIS`) vai cair aqui também.
- **Melhoria Proposta**
  > Aplicar **Split Module**: mover a lógica de reconhecimento tipado (`confirmar` → bloco I15r, `validadeDoReconhecimento`, `contextoPorTitulo`) para um colaborador `ReconhecimentoDecisaoService` já pronto para a fase 2. Manter o `BoletoSuggestionService` apenas como orquestrador transacional. Reaproveitar `ConferenciaReconhecimento` (já extraído).
- **Resultado Esperado**
  > `BoletoSuggestionService` ≤ 900 LOC no próximo ciclo; novo colaborador 150–250 LOC; teste do novo colaborador independente do setup transacional pesado.
- **Tactic alvo**: Split Module / Refactor
- **Severidade**: P1
- **Esforço estimado**: M
- **Findings relacionados**: F-modifiability-1
- **Métricas de sucesso**:
  - LOC `BoletoSuggestionService.ts`: 1287 → ≤ 900
  - Fan-in de métodos de reconhecimento: direcionados ao novo serviço
- **Risco de não fazer**: na fase 2 o arquivo passa de 1 400 LOC; conflito de rebase crônico com outras features SISPAG em paralelo (worktree-first amplifica isso).
- **Dependências**: feito antes do PR de fase 2 do binding (`SISPAG_BIND_CODBAR_DATA_DIVERGENTE_FILIAIS`).

### [modifiability-2] Centralizar aritmética de dia civil em um utilitário puro compartilhado

- **Problema**
  > Três sítios novos (`FatorVencimentoBoleto.ts:6`, `ElegibilidadeVinculoCodigoBarras.ts:120-129`, `frontend/prazoTitulo.ts:12-17`) redeclaram `DIA_MS = 86_400_000` e sua própria `diasEntre`/`diferencaDias`. `BankingCalendar` já existe no backend mas não é usado nos novos puros, e o frontend não tem equivalente.
- **Melhoria Proposta**
  > Criar `domain/libs/calendar/CivilDays.ts` (puro, sem DI) com `diffDays(a: CivilDate, b: CivilDate): number` e `MS_PER_DAY`, e espelho equivalente em `src/frontend/lib/civilDays.ts`. Migrar os 3 sítios novos. Documentar que `BankingCalendar` continua sendo a porta de entrada para "hoje" e rolagem bancária.
- **Resultado Esperado**
  > 1 função por camada; nome único (`diffDays`); zero `86_400_000` solto no delta.
- **Tactic alvo**: Abstract Common Services
- **Severidade**: P2
- **Esforço estimado**: S
- **Findings relacionados**: F-modifiability-2
- **Métricas de sucesso**:
  - Ocorrências de `86_400_000`/`24 * 60 * 60 * 1000` nos novos arquivos: 3 → 0
- **Risco de não fazer**: o próximo cálculo de prazo (fase 2) adiciona um 4º sítio; drift semântico silencioso quando alguém trocar `Math.round` por `Math.trunc`.
- **Dependências**: nenhuma.

### [modifiability-3] Separar `lerCodigo` em dois caminhos coesos (1:1 vs borderô)

- **Problema**
  > `ElegibilidadeVinculoCodigoBarras.lerCodigo` serve `avaliar` (1:1, retorna `FATOR_VENCIMENTO_DIVERGE`) e `avaliarItemDeBordero` (retorna `BOLETO_INCONSISTENTE`) via default-arg. O chamador do borderô monta um `EntradaElegibilidadeVinculo` com `as` (l.229), o que esconde campos obrigatórios do 1:1.
- **Melhoria Proposta**
  > Extrair o núcleo de decodificação (`limpo`, `decodificar`, conferência valor/fator) para uma função pura `decodificarCodigo(entrada: EntradaCodigoBarrasBase)` sem default-arg; cada caminho (`avaliar`/`avaliarItemDeBordero`) traduz o resultado para o próprio enum `MotivoInelegivelVinculo` sem herdar campos uns dos outros.
- **Resultado Esperado**
  > Zero `as EntradaElegibilidadeVinculo`; dois contratos de retorno distintos tipados; mudar ADR-0077 não força leitura de ADR-0078.
- **Tactic alvo**: Increase Semantic Coherence / Encapsulate
- **Severidade**: P2
- **Esforço estimado**: S
- **Findings relacionados**: F-modifiability-3
- **Métricas de sucesso**:
  - `grep -c "as EntradaElegibilidadeVinculo" src/backend`: 1 → 0
  - Default-args em `lerCodigo`: 1 → 0
- **Risco de não fazer**: tweak em uma das regras (I17d ou I21o) quebra a outra em teste de integração; já quase aconteceu neste delta (ver test suite de 36 LOC só para o novo contrato).
- **Dependências**: nenhuma.

### [modifiability-4] Enviar `diasAtePrazo` do backend em vez de recomputar no frontend

- **Problema**
  > `frontend/prazoTitulo.ts:24-29` recalcula `diasAtePrazo` a partir de `diasAteVencimento + diferencaDias(vencimentoTitulo, prazoEfetivo)`. O backend já tem `PrazoBoletoCalculador` com todos os insumos; estender o DTO `PrazoBoleto` com `diasAtePrazo` elimina o espelho de aritmética na UI.
- **Melhoria Proposta**
  > Adicionar `diasAtePrazoBoleto` ao DTO `PrazoBoleto` em `domain/interface/sispag/PrazoBoleto.ts`, calculado em `PrazoBoletoCalculador` com o `hoje` BRT que o service já recebe. UI apenas lê.
- **Resultado Esperado**
  > Função pura `diasAtePrazo` sai da UI; cálculo canônico vive só no backend.
- **Tactic alvo**: Use an Intermediary
- **Severidade**: P3
- **Esforço estimado**: S
- **Findings relacionados**: F-modifiability-4
- **Métricas de sucesso**:
  - Linhas de aritmética de data em `prazoTitulo.ts`: 29 → ≤ 10
- **Risco de não fazer**: baixo; incorporar quando mexer na próxima regra de prazo.
- **Dependências**: idealmente após [modifiability-2].

## 6. Notas do agente

- Review reduzido (delta-only). Classes gigantes pré-existentes (`MotorSugestaoBoleto` 1 097 LOC, `BoletoSuggestionService` 1 287 LOC) estão fora do escopo exceto quando o delta as fez crescer materialmente — só `BoletoSuggestionService` (+105 LOC) qualificou.
- Cross-QA:
  - [modifiability-1] (Split) overlap com **Testability** — service grande = setup de teste pesado (173 LOC só na suite do delta).
  - [modifiability-3] (Encapsulate em `lerCodigo`) overlap com **Integrability** — contrato compartilhado entre ADR-0077 e ADR-0078.
  - [modifiability-2] (duplicação) overlap com **Testability** (3 suites separadas para a mesma lógica) e marginalmente com **Deployability** (nada escapa como config aqui).
- Nenhum P0: a feature não introduziu ciclos, não quebrou camadas (PatternGuardian verde) e isolou a maior parte da lógica nova em libs puras pequenas — o preço foi inflar o service orquestrador que já era grande.
