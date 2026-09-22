---
qa: Modifiability
qa_slug: modifiability
run_id: 2026-09-22-2020-sispag-data-pagamento
agent: qa-modifiability
generated_at: 2026-09-22T20:20:36Z
scope: backend + frontend (delta de `fix/sispag-data-pagamento`, `--quick`)
score: 6.5
findings_count: 5
cards_count: 4
---

# Modifiability — Regis-Review

## 1. Cenário Geral (Bass General Scenario aplicado ao financeiro)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Analista SISPAG / dev do próximo `/feature-tweak` | Pedido de nova regra sobre a data de débito (ex.: feriado municipal — já é `P1-1` em `ontology/_inbox/sispag-data-pagamento-gap.md`) ou nova etapa no fluxo `gerarRemessa` | `RemessaService.gerarRemessaSerializado` (508 linhas, complexidade cognitiva 91) + o par `SispagInterface.ts`/`src/frontend/lib/sispag.ts` | Desenvolvimento normal, gate `npm run lint` com `noExcessiveCognitiveComplexity` em warn (15) | A mudança deveria ser localizável em `DebitDateService`/`BankingCalendar` (já isolados nesta feature) sem tocar `gerarRemessaSerializado`; o contrato de tipos deveria mudar em um lugar só | Nº de arquivos tocados por mudança de regra ≤ 3; complexidade da função tocada ≤ 15 (hoje 91, 6× o teto) |

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Complexidade cognitiva de `RemessaService.gerarRemessaSerializado` | 91 (linha 169) | ≤ 15 (Biome `noExcessiveCognitiveComplexity`) | ❌ | `cd src/backend && npx biome check . --max-diagnostics=200 \| grep -A2 "RemessaService.ts:169"` |
| Complexidade cognitiva de `RemessaService.gerarPayloadsAssociacaoDda` (aprox., linha 913) | 32 | ≤ 15 | ❌ | mesmo comando, `RemessaService.ts:913` |
| LOC de `RemessaService.ts` | 1111 (antes do delta: 1028, `origin/main`) | ≤ 600 (P1) / ≤ 1000 (limiar de risco arquitetural) | ❌ | `wc -l src/backend/domain/service/sispag/RemessaService.ts`; `git show origin/main:… \| wc -l` |
| LOC de `src/frontend/app/sispag/page.tsx` | 1083 (delta: +15) | ≤ 600 | ❌ (pré-existente, não agravado por esta feature) | `wc -l src/frontend/app/sispag/page.tsx` |
| Warnings totais Biome (`noExcessiveCognitiveComplexity`) no repo | 73 (0 introduzidos por este delta fora de `RemessaService`, que já era o maior) | 0 | ⚠️ | `_shared-metrics.md`; `npx biome check . --max-diagnostics=200` |
| Imports de `domain/repository/*`/`domain/client/*` em `routes/sispag.ts` (camada handler) | 4 (`ConexosSispagClient`, `ConciliacaoExecucaoRepository`, `PagamentoIngestaoRunRepository`, `RemessaExecucaoRepository`) | 0 — Lambda/route → Service → Repository → Client, sem pular camada | ❌ | `grep -n "^import" src/backend/routes/sispag.ts \| grep -E "domain/repository\|domain/client"` |
| Fan-in de `BankingCalendar` (novo nesta feature) | 4 (`DebitDateService`, `RemessaService`, 2 jobs) | — informativo | ✅ (Abstract Common Services aplicado) | `grep -rl "from .*calendar/BankingCalendar" src/backend` |
| Fan-in de `SispagInterface.ts` (tipos de domínio; +44 linhas neste delta) | 12 arquivos | — informativo; maior ripple do domínio SISPAG | ⚠️ | `grep -rl "from .*interface/sispag/SispagInterface" src/backend` |
| Fan-in de `LotePagamentoRepository.ts` | 6 arquivos | — informativo | ✅ | `grep -rl "from .*repository/sispag/LotePagamentoRepository" src/backend` |
| Fan-in de `DebitDateService.ts` (novo) | 2 (`routes/sispag.ts`, `RemessaService.ts`) | — informativo | ✅ | `grep -rl "from .*service/sispag/DebitDateService" src/backend` |
| Motivos duplicados entre backend (`MOTIVO_FORA_DA_JANELA`, 6 valores num `as const`) e frontend (`JanelaDataDebito.vazia.motivo`, união literal com só 3 valores) | 2 fontes de verdade para o mesmo enum, sem link de compilador | 1 fonte (geração de tipos ou pacote compartilhado) | ❌ | `src/backend/domain/errors/DebitDateOutsideWindowError.ts:5-18` vs `src/frontend/lib/sispag.ts:330-331` |
| `ontology/_index.json`: `entities.LotePagamento.status` | `"planned"` com 14 `impl_files` (repo+service+route+frontend), este delta acrescentou 1 arquivo à lista sem corrigir o status | `"implemented"` | ❌ (drift pré-existente, perpetuado) | `python3 -c "import json; print(json.load(open('ontology/_index.json'))['entities']['LotePagamento'])"` |
| Ontologia `_coverage.json` — regra `data-debito-remessa-sispag` (I8) | `implemented`, `has_canonical_test: true`, gerado no mesmo dia do delta (`2026-09-22`) | mantido em sincronia com o código | ✅ | `ontology/_coverage.json`, commit `5d641e6` |
| Testes acompanhando o delta | 8 arquivos de teste novos/alterados (`DebitDateErrors.test.ts`, `BankingCalendar.test.ts`, `DebitDateService.test.ts` 241L, `RemessaService.test.ts` +321L, `LotePagamentoRepository.test.ts`, `routes/sispag.test.ts` 150L, `GerarRemessaDialog.test.tsx` 222L, `lib/sispag.test.ts` +93L) | cobertura de cada arquivo novo | ✅ | `_shared-metrics.md` — 144 suites backend + 48 suites frontend passando |
| `npm run typecheck` / `npm run lint` (backend+frontend) | exit 0 ambos, 0 erros | 0 erros | ✅ | `_shared-metrics.md` |

### Apêndice — Top arquivos tocados por LOC (escopo do delta, `--quick`)

| # | Arquivo | LOC | Observação |
|---|---|---|---|
| 1 | `src/backend/domain/service/sispag/RemessaService.ts` | 1111 | +83 líquidas neste delta; já era o maior arquivo do domínio SISPAG antes (1028) |
| 2 | `src/frontend/app/sispag/page.tsx` | 1083 | +15 líquidas; tamanho pré-existente, não é foco desta feature |
| 3 | `src/frontend/lib/sispag.ts` | 731 | +~40 líquidas; contrato de API + tipos + erros do domínio SISPAG num único arquivo |
| 4 | `src/backend/routes/sispag.ts` | 609 | +43 líquidas; camada de rota com 4 imports de repository/client (layer-skip pré-existente) |
| 5 | `src/backend/domain/repository/sispag/LotePagamentoRepository.ts` | 589 | +21 líquidas (`data_debito`, `setDataDebito`) |
| 6 | `src/frontend/app/sispag/components/LoteCard.tsx` | 534 | **-34 líquidas** — lógica de "Gerar remessa" extraída para `GerarRemessaDialog.tsx` (Split Module aplicado) |
| 7 | `src/backend/domain/interface/sispag/SispagInterface.ts` | 358 | +44 líquidas; fan-in de 12 (maior do domínio) |
| 8 | `src/frontend/app/sispag/components/GerarRemessaDialog.tsx` | 266 | arquivo novo; componente extraído do `LoteCard` |
| 9 | `src/backend/domain/service/sispag/DebitDateService.ts` | 194 | arquivo novo; single-responsibility (janela + validação I8) |
| 10 | `src/backend/domain/libs/calendar/BankingCalendar.ts` | 138 | arquivo novo; `@singleton`, fan-in 4, testável via `withClock` |

### Apêndice — Fan-in dos módulos do domínio SISPAG tocados/criados pelo delta

| # | Módulo | Fan-in (arquivos não-teste) | Observação |
|---|---|---|---|
| 1 | `SispagInterface.ts` | 12 | maior ripple do domínio; tipos I8 (`JanelaDataDebito`, `TituloLimitante`) entraram aqui |
| 2 | `LotePagamentoRepository.ts` | 6 | `setDataDebito` novo método |
| 3 | `BankingCalendar.ts` | 4 | novo; já compartilhado por 2 services + 2 jobs |
| 4 | `RemessaService.ts` | 2 | `routes/sispag.ts`, `jobs/validate-retomada-remessa-v1.ts` |
| 5 | `LotePagamentoService.ts` | 2 | não tocado pelo delta, referência de baseline |
| 6 | `FormacaoLotesService.ts` | 2 | idem |
| 7 | `IngestaoPagamentosService.ts` | 2 | idem |
| 8 | `ConciliacaoRetornoService.ts` | 2 | idem |
| 9 | `SispagPainelService.ts` | 2 | idem |
| 10 | `DebitDateService.ts` | 2 | novo (`routes/sispag.ts`, `RemessaService.ts`) |

> Escopo `--quick`: fan-in medido só dentro de `src/backend` para os módulos do domínio SISPAG tocados ou vizinhos diretos — não é uma varredura completa do monorepo.

## 3. Tactics — Cobertura no financeiro

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Split Module | `DebitDateService` extraído em vez de crescer `RemessaService`; no frontend, `GerarRemessaDialog.tsx` extraído de `LoteCard.tsx` (LoteCard **encolheu** 34 linhas líquidas). Mas `gerarRemessaSerializado` continua monolítico e recebeu mais 2 blocos de lógica (`resolverDataDebito`, encoding `dataDebitoErp`) direto no corpo | ⚠️ parcial | `src/backend/domain/service/sispag/DebitDateService.ts` (novo); `src/backend/domain/service/sispag/RemessaService.ts:169-674` |
| Increase Semantic Coherence | `DebitDateService` só fala de janela/validação de data de débito — 1 entidade (janela), sem misturar lote/remessa/conciliação. `BankingCalendar` só fala de calendário. Ambos coesos | ✅ presente | `DebitDateService.ts` (métodos: `getWindow`, `computeWindow`, `validate`, `resolve`) |
| Encapsulate | `sispagRequest<T>` no frontend centraliza parsing de erro HTTP e mapeia `code` → classe de erro tipada (`DebitDateOutsideWindowError`, `DebitDateFrozenError`); rota usa Zod (`civilDateSchema`) para validar forma antes de chamar o service | ✅ presente | `src/frontend/lib/sispag.ts:489-503`; `src/backend/routes/sispag.ts` (`civilDateSchema`, `gerarRemessaSchema`) |
| Use an Intermediary | `respondLoteError` (rota) e `BankingCalendar.withClock` (fábrica com relógio injetável) atuam como intermediários entre regra e I/O | ✅ presente | `routes/sispag.ts` (`respondLoteError`); `BankingCalendar.ts:44-48` |
| Restrict Dependencies | DDD (Lambda/route → Service → Repository → Client) respeitado nos arquivos **novos** desta feature (`DebitDateService` só depende de `LotePagamentoRepository`+`BankingCalendar`); mas `routes/sispag.ts` (arquivo tocado) importa 4 repositories/clients diretamente, pulando a camada Service — pré-existente, não introduzido por este delta, mas não corrigido nele | ⚠️ parcial | `routes/sispag.ts:7-11` |
| Refactor | `hojeUtc()` duplicado em 2 jobs foi refeito para delegar a `BankingCalendar.toErpEpoch(todayBrt())` em vez de reimplementar `Date.UTC` cru — reduz uma fonte de bug (o bug original de virada de dia às 21h BRT) | ✅ presente | `git diff` em `jobs/execute-fin015-prd.ts` e `jobs/validate-retomada-remessa-v1.ts` |
| Abstract Common Services | `BankingCalendar` (`@singleton @injectable`) nasce já compartilhado por 2 services + 2 jobs — bom precedente para deferir o cálculo de calendário a um único lugar | ✅ presente | fan-in 4, ver apêndice acima |
| Defer Binding (config/polimorfismo/plugin/runtime registration) | Feriados nacionais fixos e móveis (Páscoa por algoritmo) ficam em constantes de código, não em configuração — decisão documentada e consciente (`// Fora de escopo (gap P1): feriados municipais/estaduais e 31/12`), com plano explícito de virar "configuração por filial" se a resposta ao gap `P1-1` exigir. Nenhum token/interface com múltiplas implementações escolhidas em runtime nesta feature (esperado — não é ponto de variação do domínio) | ⚠️ parcial (gap já registrado e triado, não é surpresa) | `BankingCalendar.ts:8-22`; `ontology/_inbox/sispag-data-pagamento-gap.md` (`P1-1`) |

## 4. Findings (achados)

### F-modifiability-1: `RemessaService.gerarRemessaSerializado` chega a complexidade cognitiva 91 (6× o teto) e este delta adicionou lógica nova ao corpo em vez de extrair

- **Severidade**: P1
- **Tactic violada**: Refactor / Split Module
- **Localização**: `src/backend/domain/service/sispag/RemessaService.ts:167-674` (função `gerarRemessaSerializado`); trecho novo do delta em `RemessaService.ts:328-333` (cálculo de `flpCodExistente`/`dataDebito`) e `:360-363` (`dataDebitoErp`)
- **Evidência (objetiva)**:
  ```
  domain/service/sispag/RemessaService.ts:169:36 lint/complexity/noExcessiveCognitiveComplexity
  ! Excessive complexity of 91 detected (max: 15).
  private gerarRemessaSerializado = async (
      input: GerarRemessaInput,
  ): Promise<GerarRemessaResult> => {
  ```
  Diff do delta adiciona, dentro dessa mesma função, mais 2 pontos de decisão (`const dataDebito = await this.resolverDataDebito(...)` e `dataDebito !== undefined ? this.calendar.toErpEpoch(dataDebito) : undefined`) — a nova lógica de negócio (I8) foi corretamente isolada em `DebitDateService`/`resolverDataDebito`, mas os pontos de **chamada** dessa lógica ficaram dentro da função já mais complexa do serviço.
- **Impacto técnico**: qualquer alteração futura nesta função (novo passo de pagamento, nova condição de retomada) soma complexidade a uma base que já excede 6× o teto do linter (warn, não erro — não bloqueia merge). Bugs de regressão em um fluxo com 508 linhas e >90 caminhos de decisão são difíceis de prever por leitura.
- **Impacto de negócio**: `gerarRemessaSerializado` é o caminho que cria o lote nativo no ERP e dispara a remessa bancária real (dinheiro saindo). Um retrabalho malfeito aqui tem custo direto — já há um gotcha documentado (`sispag-filial-7-primeira-remessa-nao-validada`, remessa gerada e depois cancelada por boleto sem código de barras) mostrando que este fluxo já teve incidentes de produção.
- **Métrica de baseline**: complexidade cognitiva 91 (Biome `noExcessiveCognitiveComplexity`, teto 15) — `domain/service/sispag/RemessaService.ts:169`.

### F-modifiability-2: `RemessaService.ts` cresce para 1111 LOC — acima do próprio limiar de risco arquitetural

- **Severidade**: P1
- **Tactic violada**: Split Module (Reduce Size of Module)
- **Localização**: `src/backend/domain/service/sispag/RemessaService.ts` (1111 linhas)
- **Evidência (objetiva)**:
  ```
  origin/main:src/backend/domain/service/sispag/RemessaService.ts → 1028 linhas
  HEAD:src/backend/domain/service/sispag/RemessaService.ts        → 1111 linhas (+83 líquidas)
  ```
- **Impacto técnico**: arquivo já ultrapassava o teto defensável (600 LOC) antes deste delta; o delta, mesmo tendo extraído `DebitDateService`, ainda adicionou 83 linhas líquidas ao arquivo em vez de compensar com extração equivalente. Tende a crescer monotonicamente a cada `/feature-tweak` de SISPAG.
- **Impacto de negócio**: cada nova regra de remessa (ex.: as 3 perguntas P1 abertas em `ontology/_inbox/sispag-data-pagamento-gap.md`) provavelmente vai tocar este mesmo arquivo, aumentando o tempo de review e o risco de regressão silenciosa no fluxo de pagamento.
- **Métrica de baseline**: 1111 LOC vs. alvo ≤ 600 (P1) / ≤ 1000 (limiar de risco arquitetural já ultrapassado, inclusive antes deste delta).

### F-modifiability-3: `routes/sispag.ts` (camada de rota) importa `domain/repository/*` e `domain/client/*` diretamente, pulando a camada Service

- **Severidade**: P2
- **Tactic violada**: Restrict Dependencies
- **Localização**: `src/backend/routes/sispag.ts:7-11`
- **Evidência (objetiva)**:
  ```
  import ConexosSispagClient from '../domain/client/ConexosSispagClient.js';
  import ConciliacaoExecucaoRepository from '../domain/repository/sispag/ConciliacaoExecucaoRepository.js';
  import PagamentoIngestaoRunRepository from '../domain/repository/sispag/PagamentoIngestaoRunRepository.js';
  import RemessaExecucaoRepository from '../domain/repository/sispag/RemessaExecucaoRepository.js';
  ```
  Pré-existente (não introduzido por este delta, que só adicionou o import de `DebitDateService`, corretamente na camada Service), mas o arquivo foi tocado (+43 linhas) sem remediar.
- **Impacto técnico**: CLAUDE.md declara a cadeia `Lambda handler → Service → Repository → Client` como regra sem exceções, policiada pelo `PatternGuardian`. A presença de 4 imports de camada inferior na rota mostra que o gate não está pegando esse padrão específico (ou tolera pré-existente) — cada novo endpoint em `routes/sispag.ts` tem um precedente ruim para copiar.
- **Impacto de negócio**: acopla a camada HTTP diretamente a detalhes de persistência/ERP; uma mudança de schema ou de client passa a exigir grep em `routes/` além de `service/`, aumentando a superfície de uma mudança simples.
- **Métrica de baseline**: 4 imports de repository/client em `routes/sispag.ts` (alvo: 0).

### F-modifiability-4: Enum de motivos (`MOTIVO_FORA_DA_JANELA`) e o contrato `JanelaDataDebito` são mantidos em duas fontes sem link de compilador entre backend e frontend

- **Severidade**: P2
- **Tactic violada**: Restrict Dependencies / Abstract Common Services (ausência de tipos compartilhados)
- **Localização**: `src/backend/domain/errors/DebitDateOutsideWindowError.ts:5-18` vs. `src/frontend/lib/sispag.ts:317-331`
- **Evidência (objetiva)**:
  ```ts
  // backend — 6 valores, única fonte
  export const MOTIVO_FORA_DA_JANELA = {
      ANTES_DE_HOJE: 'antes_de_hoje', DEPOIS_DO_VENCIMENTO: 'depois_do_vencimento',
      NAO_UTIL: 'nao_util', TITULO_VENCIDO: 'titulo_vencido',
      SEM_DIA_UTIL: 'sem_dia_util', TITULO_SEM_VENCIMENTO: 'titulo_sem_vencimento',
  } as const;

  // frontend — união literal escrita à mão, só 3 dos 6 valores (os de `vazia`)
  vazia?: { motivo: 'titulo_vencido' | 'sem_dia_util' | 'titulo_sem_vencimento' }
  // e o motivo de `DebitDateOutsideWindowError.details` no frontend é só `motivo?: string`
  // (perde a união dos outros 3 valores completamente)
  ```
- **Impacto técnico**: não há geração de tipos nem pacote compartilhado entre `src/backend` e `src/frontend` (dois `package.json` independentes). Adicionar um 7º motivo no backend (ex.: resposta ao gap `P1-2`, 31/12) não quebra o build do frontend — o TypeScript não vai reclamar porque o campo correspondente já é `string` solto; a tela simplesmente não vai saber traduzir o motivo novo para o usuário até alguém lembrar de editar `sispag.ts` manualmente.
- **Impacto de negócio**: risco de mensagem de erro genérica/confusa na tela do analista exatamente quando o SISPAG mais precisa ser claro (dinheiro real, janela de débito). Já há 3 perguntas abertas (`P1-1`..`P1-3`) que, se respondidas, provavelmente mexem nesse mesmo enum.
- **Métrica de baseline**: 2 fontes de verdade (backend `as const` com 6 valores; frontend com 2 representações parciais — união de 3 valores + `string` solto) para o mesmo conceito de domínio, 0 verificação estrutural entre elas.

### F-modifiability-5: `ontology/_index.json` mantém `LotePagamento` como `"status": "planned"` apesar de 14 arquivos de implementação (repo+service+route+frontend); este delta adicionou um arquivo à lista sem corrigir o status

- **Severidade**: P3
- **Tactic violada**: Defer Binding (ontologia como mapa confiável para planejamento de mudança)
- **Localização**: `ontology/_index.json` → `entities.LotePagamento`
- **Evidência (objetiva)**:
  ```
  main : status="planned", impl_files=13
  HEAD : status="planned", impl_files=14 (+ RemessaService.ts, adicionado por este delta)
  ```
  Arquivos referenciados existem de fato (`RemessaService.ts`, `routes/sispag.ts`, `LotePagamentoRepository.ts`, `src/frontend/app/sispag/page.tsx` — todos confirmados no filesystem).
- **Impacto técnico**: o `CodebaseNavigator` e qualquer `/feature-tweak` futuro que consultar `_index.json` para estimar o raio de uma mudança em `LotePagamento` vai subestimar o escopo real (a entidade é o núcleo operacional do SISPAG, não algo "planejado").
- **Impacto de negócio**: nenhum incidente direto, mas reduz a confiabilidade do artefato que a missão desta review trata como "a fonte de mapeamento" — cada drift não corrigido é um "estamos voando às cegas" a mais na próxima estimativa de esforço.
- **Métrica de baseline**: 1 entidade central do domínio SISPAG com status inconsistente (`planned` com 14 impl_files); não é possível, no escopo `--quick`, varrer as 19 entidades do `_coverage.json` para contar o drift total.

## 5. Cards Kanban

### [modifiability-1] Extrair um `RemessaWriteOrchestrator` (ou dividir `gerarRemessaSerializado` em etapas nomeadas) antes da próxima regra de SISPAG

- **Problema**
  > `RemessaService.gerarRemessaSerializado` tem complexidade cognitiva 91 (teto do lint: 15) e 1111 LOC no arquivo todo. Este delta seguiu o precedente certo ao criar `DebitDateService` para a regra nova, mas ainda assim inseriu 2 novos pontos de decisão dentro da função monolítica em vez de chamá-los de um orquestrador mais fino.

- **Melhoria Proposta**
  > Aplicar **Split Module**: quebrar `gerarRemessaSerializado` em passos nomeados e testáveis isoladamente (ex.: `resolverContaPagadora`, `garantirLoteNativo`, `sincronizarOuCriar`, já parcialmente esboçados como blocos comentados no código atual) — cada um como método privado curto ou service colaborador, com o método público restando como orquestração linear. Uso da tactic **Refactor** apoiado pelos 144 testes de `RemessaService.test.ts` já existentes como rede de segurança.

- **Resultado Esperado**
  > Complexidade cognitiva da função principal: 91 → ≤ 30 na primeira passada (alvo final ≤ 15). LOC de `RemessaService.ts`: 1111 → ≤ 700 após extrair pelo menos 2 sub-fluxos para arquivos próprios.

- **Tactic alvo**: Split Module / Refactor
- **Severidade**: P1
- **Esforço estimado**: L (1-2 semanas — função crítica, exige regressão cuidadosa)
- **Findings relacionados**: F-modifiability-1, F-modifiability-2
- **Métricas de sucesso**:
  - Complexidade cognitiva de `gerarRemessaSerializado`: 91 → ≤ 15
  - LOC de `RemessaService.ts`: 1111 → ≤ 700
- **Risco de não fazer**: cada `/feature-tweak` de SISPAG nos próximos 6 meses (há 3 perguntas P1 já abertas sobre esta mesma regra) volta a tocar esta função; a probabilidade de uma regressão silenciosa no fluxo que move dinheiro real cresce a cada adição não isolada.
- **Dependências**: nenhuma — pode começar isolado, aproveitando a suíte de testes já verde.

### [modifiability-2] Remediar o layer-skip em `routes/sispag.ts` (rota → repository/client direto)

- **Problema**
  > `routes/sispag.ts` importa `ConexosSispagClient` e 3 repositories diretamente, contrariando a cadeia `Lambda/route → Service → Repository → Client` que o CLAUDE.md declara sem exceções e que o `PatternGuardian` deveria bloquear. Não foi introduzido por este delta, mas o arquivo foi tocado (+43 linhas) sem correção.

- **Melhoria Proposta**
  > Aplicar **Restrict Dependencies**: mover as chamadas de `ConciliacaoExecucaoRepository`, `PagamentoIngestaoRunRepository`, `RemessaExecucaoRepository` e `ConexosSispagClient` para dentro do service correspondente (provavelmente `ConciliacaoRetornoService`/`SispagPainelService`), deixando a rota falar só com services. Abrir como `/feature-tweak` dedicado para não misturar com regra de negócio nova.

- **Resultado Esperado**
  > Imports de `domain/repository/*`/`domain/client/*` em `routes/sispag.ts`: 4 → 0. `PatternGuardian` passa a ter um exemplo limpo para comparar contra novos endpoints.

- **Tactic alvo**: Restrict Dependencies
- **Severidade**: P2
- **Esforço estimado**: M (2-5 dias)
- **Findings relacionados**: F-modifiability-3
- **Métricas de sucesso**:
  - Imports de repository/client em `routes/sispag.ts`: 4 → 0
- **Risco de não fazer**: cada novo endpoint em `routes/sispag.ts` (e o arquivo já tem 609 linhas) copia o padrão de pular a camada Service, ampliando o acoplamento HTTP↔persistência.
- **Dependências**: nenhuma.

### [modifiability-3] Gerar (ou compartilhar) os tipos/enums do contrato SISPAG entre backend e frontend

- **Problema**
  > `MOTIVO_FORA_DA_JANELA` (backend, 6 valores, `as const`) e `JanelaDataDebito`/`DebitDateOutsideWindowError` (frontend, união literal parcial + `string` solto) são mantidos manualmente em sincronia. Um novo motivo no backend não quebra o build do frontend — só produz uma tela sem tradução para o caso novo.

- **Melhoria Proposta**
  > Não é escopo reescrever a stack para monorepo com tipos compartilhados agora (`--quick`, fora do raio deste delta), mas registrar a lacuna como débito e, na próxima vez que `MOTIVO_FORA_DA_JANELA` mudar, propagar o enum completo para `src/frontend/lib/sispag.ts` (união literal com os 6 valores, não só 3) e trocar `motivo?: string` de `DebitDateOutsideWindowError.details` por uma união de fato. Avaliar, a médio prazo, gerar os tipos de contrato SISPAG a partir de um schema Zod único (`civilDateSchema`/`gerarRemessaSchema` já são Zod no backend) exportável para o frontend via build step.

- **Resultado Esperado**
  > `DebitDateOutsideWindowError.details.motivo` deixa de ser `string` solto e passa a ser a união dos 6 valores; qualquer novo motivo adicionado ao backend gera erro de compilação no frontend até ser tratado.

- **Tactic alvo**: Restrict Dependencies / Abstract Common Services
- **Severidade**: P2
- **Esforço estimado**: S (≤1 dia) para a correção pontual do enum; M para explorar geração automática
- **Findings relacionados**: F-modifiability-4
- **Métricas de sucesso**:
  - Nº de fontes de verdade para `MOTIVO_FORA_DA_JANELA`: 2 → 1 (ou 2 com verificação estrutural automatizada)
- **Risco de não fazer**: a próxima resposta aos gaps P1-1/P1-2 (`ontology/_inbox/sispag-data-pagamento-gap.md`) provavelmente adiciona um motivo novo; sem o link de tipos, é fácil esquecer o lado frontend e a analista ver uma mensagem genérica no exato momento em que a regra de dinheiro real mais precisa ser clara.
- **Dependências**: nenhuma.

### [modifiability-4] Corrigir o status de `LotePagamento` em `ontology/_index.json` (retro-ontologia)

- **Problema**
  > `entities.LotePagamento.status` permanece `"planned"` com 14 `impl_files` que cobrem repository, service, rota e frontend — a entidade central do SISPAG está de fato implementada e em produção (ver gotcha "SISPAG filial 7"). Este delta adicionou `RemessaService.ts` à lista sem corrigir o status.

- **Melhoria Proposta**
  > Rodar `/retro-ontology` focado em `LotePagamento` (e, se o tempo permitir, nas demais 18 entidades para medir o drift total do `_coverage.json`) e atualizar `status` para `"implemented"` ou `"partial"` conforme o que realmente falta.

- **Resultado Esperado**
  > `entities.LotePagamento.status` = `"implemented"` (ou `"partial"` com gap explícito), coerente com os 14 arquivos já referenciados.

- **Tactic alvo**: Defer Binding (confiabilidade do mapa entidade→implementação para planejamento)
- **Severidade**: P3
- **Esforço estimado**: S (≤1 dia)
- **Findings relacionados**: F-modifiability-5
- **Métricas de sucesso**:
  - `LotePagamento.status`: `"planned"` → `"implemented"`/`"partial"` correto
- **Risco de não fazer**: estimativas de esforço para futuras mudanças em `LotePagamento` continuam calibradas por um mapa que subestima o que já existe.
- **Dependências**: nenhuma; pode rodar em paralelo com qualquer outro card.

## 6. Notas do agente

- Escopo `--quick`: fan-in medido só para módulos do domínio SISPAG tocados/vizinhos diretos, não o monorepo inteiro; LOC p50/p95 do repo todo não foi recalculado aqui (ver `_shared-metrics.md` para os agregados de LOC/testes).
- **Cross-QA**: F-modifiability-1/2 (Refactor + Split Module em `RemessaService`) tem overlap direto com Testability — a função tem 508 linhas e 91 de complexidade, mas está coberta por `RemessaService.test.ts` (+321 linhas neste delta); vale conferir com `qa-testability` se a suíte testa os ramos novos por unidade ou só integração ponta a ponta.
- **Cross-QA**: F-modifiability-3 (layer-skip em `routes/sispag.ts`) é o mesmo achado que `qa-integrability` provavelmente reporta como acoplamento HTTP↔persistência — mesma evidência, ângulos diferentes.
- **Cross-QA**: F-modifiability-5 (drift de ontologia) não tem número de magic constants/config a comparar com Deployability nesta feature — os "feriados fixos" do `BankingCalendar` são lei federal em código-fonte, não parâmetro de negócio; os autores já documentaram essa fronteira (gap `P1-1`) como decisão consciente, não como surpresa.
