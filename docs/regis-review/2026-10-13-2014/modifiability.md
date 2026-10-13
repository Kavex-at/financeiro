---
qa: Modifiability
qa_slug: modifiability
run_id: 2026-10-13-2014
agent: qa-modifiability
generated_at: 2026-10-13T20:30:00-03:00
scope: backend + frontend (delta 5a17d3e..HEAD)
score: 7.5
findings_count: 5
cards_count: 4
---

# Modifiability — Regis-Review

## 1. Cenário Geral

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Time de produto/ops | Mudar o orçamento da sync DDA (60 s), a cadência dos crons (07/12/16 h) ou acrescentar um estado novo ao `dda` | `IngestaoPagamentosService`, `BoletoDdaService`, `ddaDefasado.ts`, job `ingest-pagamentos.ts` | Design time, repo único | Mudança localizada em 1 constante / 1 tipo, sem tocar o fluxo de títulos | ≤ 2 arquivos de produção por mudança; 0 strings de estado duplicadas entre camadas |

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Complexidade cognitiva `runIngestion` | 20 (era 31 antes da extração de `avisoDaRun`) | ≤ 15 | ⚠️ | `npx biome lint domain/service/sispag/IngestaoPagamentosService.ts` (linha 295) |
| Warnings de complexidade no delta | 1 (o mesmo `runIngestion`) | 0 | ⚠️ | idem |
| LOC `IngestaoPagamentosService.ts` | 425 (era 329, +96) | ≤ 600 | ✅ | `wc -l`, `git show 5a17d3e:` |
| LOC `runIngestion` | ~133 (L292–425) | ≤ 80 | ⚠️ | leitura do arquivo |
| Dependências injetadas em `IngestaoPagamentosService` | 10 (era 9) | ≤ 8 | ⚠️ | constructor L44–56 |
| Fan-in de `IngestaoPagamentosService` (não-teste) | 5 arquivos (`CarteiraAtualizacaoService`, `routes/sispag.ts`, `jobs/ingest-pagamentos.ts`, `jobs/ingest-boletos-dda.ts`, `IngestaoTransacoesService` por nome) | — | ✅ | grep -l |
| Ciclo introduzido | 0 (`BoletoDdaService` não importa `IngestaoPagamentosService`) | 0 | ✅ | grep dos imports |
| Violações de camada no delta | 0 | 0 | ✅ | leitura do diff |
| Constantes numéricas novas | 2: `DDA_PRAZO_NA_INGESTAO_MS = 60_000` (backend), `DDA_DEFASADO_HORAS = 8` (frontend); ambas nomeadas, comentadas e exportadas | 0 mágicos anônimos | ✅ | diff |
| Duplicação de strings de estado backend↔frontend | 0: `DDA_NA_INGESTAO` vive só no backend; `IngestaoPagamentosResult` do frontend (`frontend/lib/sispag.ts:130`) não tem o campo `dda` | 0 | ✅ | grep |
| Duplicação de predicado `FALHOU\|\|PARCIAL` | 2 cópias (`avisoDaRun` L282; `jobs/ingest-pagamentos.ts`) | 1 | ⚠️ | diff |
| Binding-time do prazo DDA | compile-time (constante), 0 via `EnvironmentProvider` | — | ⚠️ (P3) | `IngestaoPagamentosService.ts:29` |

### Apêndice A — Top-10 maiores arquivos (delta)

| # | Arquivo | LOC |
|---|---|---|
| 1 | `src/backend/domain/service/sispag/IngestaoPagamentosService.ts` | 425 |
| 2 | `src/frontend/app/sispag/components/BoletosDdaTab.tsx` | 445 |
| 3 | `src/backend/domain/repository/sispag/TituloAPagarRepository.ts` | 250 |
| 4 | `src/backend/domain/service/sispag/BoletoDdaService.ts` | 180 |
| 5 | `src/backend/domain/interface/sispag/SispagInterface.ts` | (> 200; +34 no delta) |
| 6 | `src/frontend/app/sispag/components/ddaDefasado.ts` | 35 |
| 7 | `src/backend/jobs/ingest-pagamentos.ts` | ~60 |
| 8 | `src/backend/migrations/0083_titulo_doc_esp_numero.sql` | 17 |
| 9 | `src/backend/domain/interface/sispag/BoletoDda.ts` | pequeno (+5) |
| 10 | `src/backend/domain/client/ConexosSispagClient.ts` | (+3) |

Nenhum acima de 600 LOC no delta. O delta toca só 5 arquivos de produção relevantes; a tabela completa do repo é do `_shared-metrics.md`.

### Apêndice B — Fan-in dos serviços tocados

| Serviço | Dependentes (não-teste) |
|---|---|
| `IngestaoPagamentosService` | 5 |
| `BoletoDdaService` | 3 (`IngestaoPagamentosService` novo, rotas, job `ingest-boletos-dda`) |

## 3. Tactics — Cobertura

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Split Module | `sincronizarDda` e `avisoDaRun` extraídos como métodos privados; `runIngestion` ainda ~133 LOC | ⚠️ parcial | `IngestaoPagamentosService.ts:198,272,292` |
| Increase Semantic Coherence | A ingestão agora também orquestra a sync de outro agregado (pool DDA); justificado pelo ADR-0067 (flag e casamento leem `boleto_dda`) | ⚠️ parcial | `IngestaoPagamentosService.ts:198-222` |
| Encapsulate | `DdaNaIngestao` é a única interface de saída; `BoletoDdaService` expõe `prazoMs`/`releituraDias` opcionais, sem vazar lock/SQL | ✅ presente | `BoletoDdaService.ts:90-100` |
| Use an Intermediary | Falha/lock/prazo traduzidos para `DdaNaIngestao.estado` — o consumidor não conhece `IngestLockBusyError` | ✅ presente | `sincronizarDda` catch |
| Restrict Dependencies | Direção service→service única (Ingestão→BoletoDda), sem ciclo | ✅ presente | grep imports |
| Refactor | `runIngestion` 31→20; ainda > 15 | ⚠️ parcial | biome |
| Abstract Common Services | `avisar()` reaproveitado; predicado "DDA com aviso" não abstraído (2 cópias) | ⚠️ parcial | `avisoDaRun`, job |
| Defer Binding | `prazoMs` é parâmetro (bom, default sem prazo para botão/job); valor 60 s é constante compile-time; 8 h idem no frontend | ⚠️ parcial | `IngestaoPagamentosService.ts:29`, `ddaDefasado.ts:7` |

## 4. Findings

### F-modifiability-1: `runIngestion` segue acima do limite de complexidade e ganhou uma responsabilidade

- **Severidade**: P2
- **Tactic violada**: Refactor / Split Module
- **Localização**: `src/backend/domain/service/sispag/IngestaoPagamentosService.ts:292-425`
- **Evidência (objetiva)**:
  ```
  IngestaoPagamentosService.ts:295:43 noExcessiveCognitiveComplexity
  Excessive complexity of 20 detected (max: 15).
  ```
- **Impacto técnico**: toda mudança no fluxo (leitura por filial, flag, upsert, desbloqueio de duplicidade, sync DDA) passa pelo mesmo método de ~133 linhas; teste de unidade precisa montar 10 dependências.
- **Impacto de negócio**: cada ajuste da Frente II (SISPAG) custa mais revisão e tem maior chance de regressão na carteira.
- **Métrica de baseline**: complexidade 20 (alvo 15); 10 dependências injetadas; ~133 LOC. Piora de 9→10 deps no delta, mas melhora de 31→20 em complexidade.

### F-modifiability-2: predicado "pool DDA com aviso" duplicado e mapeamento manual de campos

- **Severidade**: P3
- **Tactic violada**: Abstract Common Services
- **Localização**: `IngestaoPagamentosService.ts:282-283` e `src/backend/jobs/ingest-pagamentos.ts` (bloco `if (d.estado === FALHOU || PARCIAL)`); `IngestaoPagamentosService.ts:210-217`
- **Evidência (objetiva)**:
  ```
  dda.estado === FALHOU || dda.estado === PARCIAL   // service
  d.estado   === FALHOU || d.estado   === PARCIAL   // job
  ```
  O resultado de `BoletoDdaService.sincronizar` é copiado campo a campo (5 campos) para `DdaNaIngestao`.
- **Impacto técnico**: um 5º estado (ex.: `adiado`) exige editar 2 lugares e é fácil esquecer o job (sem teste que cubra a combinação).
- **Impacto de negócio**: aviso do cron (`::warning::`) pode divergir do `error_message` da run — operador vê coisas diferentes.
- **Métrica de baseline**: 2 cópias do predicado; 0 helper compartilhado.

### F-modifiability-3: limiar de 8 h acoplado implicitamente à cadência dos crons

- **Severidade**: P2
- **Tactic violada**: Defer Binding (configuração) / Encapsulate
- **Localização**: `src/frontend/app/sispag/components/ddaDefasado.ts:7`; `.github/workflows/ingest-sispag.yml:25-27`
- **Evidência (objetiva)**:
  ```
  crons BRT: 07:00 (diário), 12:00 e 16:00 (seg–sex)  → maior vão = 16:00→07:00 = 15 h
  DDA_DEFASADO_HORAS = 8
  ```
  Com a pipeline saudável, entre 00:00 e 07:00 BRT de qualquer dia útil (e segunda 00:00–07:00 vindo de domingo) o pool tem > 8 h e o aviso aparece: 7 h de 24 h (≈ 29 %) das horas de dia útil mostram alerta falso.
- **Impacto técnico**: o número 8 só é correto enquanto a cadência dos crons e o fuso forem estes; mudar o workflow não sinaliza o frontend. Nada liga as duas constantes.
- **Impacto de negócio**: baixo (madrugada, tela raramente aberta), mas ensina o analista a ignorar o aviso — o oposto do objetivo (pool ficou 5 dias parado sem ninguém ver).
- **Métrica de baseline**: janela de falso positivo ≈ 7 h/dia útil; 0 testes ligando limiar à cadência.

### F-modifiability-4: prazo da sync DDA é constante compile-time

- **Severidade**: P3
- **Tactic violada**: Defer Binding
- **Localização**: `IngestaoPagamentosService.ts:29`
- **Evidência (objetiva)**:
  ```
  export const DDA_PRAZO_NA_INGESTAO_MS = 60_000;   // justificado por "~10 s medidos no cron"
  ```
- **Impacto técnico**: ajustar o orçamento (ex.: pool cresce, ou Render muda timeout) exige novo deploy; o tuning real só aparece em produção. Ponto positivo: `prazoMs` é parâmetro de `BoletoDdaService`, então promover a env/EnvironmentProvider é mudança de 1 linha.
- **Impacto de negócio**: baixo; pool cresce devagar e o prazo vira `parcial` com aviso visível, não falha.
- **Métrica de baseline**: 1 constante, 0 configuração externa. Comparável a `MIN_MS = 60_000` em `CarteiraAtualizacaoService`/`SincronizacaoPassadaService` (mesmo padrão do repo, não regressão).

### F-modifiability-5: tipo de resultado do frontend já diverge do backend (risco futuro de duplicação)

- **Severidade**: P3
- **Tactic violada**: Increase Semantic Coherence
- **Localização**: `src/frontend/lib/sispag.ts:130-135` vs `SispagInterface.ts` (`IngestaoPagamentosResult`)
- **Evidência (objetiva)**: backend tem 7 campos (`dda`, `filiaisComFalha`, `filiaisSemFlagBoleto` além dos 4); frontend declara 4.
- **Impacto técnico**: hoje é positivo — o frontend não duplica as strings do estado. Quando a UI passar a mostrar `dda.estado`, a tentação será re-declarar a união.
- **Impacto de negócio**: nenhum agora.
- **Métrica de baseline**: 0 strings duplicadas hoje; 3 campos de diferença.

## 5. Cards Kanban

### [modifiability-1] Reduzir `runIngestion` para complexidade ≤ 15

- **Problema**
  > `runIngestion` mede complexidade cognitiva 20 (limite 15) e ~133 LOC; a sync DDA entrou como mais uma etapa do mesmo método.
- **Melhoria Proposta**
  > Split Module / Refactor: extrair a fase "persistir + encerrar run + desbloquear duplicidade" (de `upsertMany` até o `finishRun`) para um método privado `finalizarRun`, e a fase de leitura por filial para `lerTitulosDasFiliais`. Opcional: mover `sincronizarDda`+`avisoDaRun` para um colaborador `DdaNaIngestaoPolicy` e baixar as deps de 10 para 9.
- **Resultado Esperado**
  > `runIngestion` ≤ 15 sem warning; método ≤ 80 LOC.
- **Tactic alvo**: Refactor / Split Module
- **Severidade**: P2
- **Esforço estimado**: S
- **Findings relacionados**: F-modifiability-1
- **Métricas de sucesso**:
  - Complexidade cognitiva: 20 → ≤ 15
  - LOC de `runIngestion`: ~133 → ≤ 80
- **Risco de não fazer**: próxima feature na ingestão (ex.: nova fonte de enriquecimento) leva o método a ≥ 25 e a pior cobertura de teste.
- **Dependências**: nenhuma

### [modifiability-2] Centralizar o predicado "pool DDA com aviso"

- **Problema**
  > O mesmo `FALHOU || PARCIAL` existe no serviço e no job; o job só é exercitado em produção.
- **Melhoria Proposta**
  > Abstract Common Services: exportar `ddaTemAviso(dda)` junto de `DDA_NA_INGESTAO` em `SispagInterface.ts` (ou um `Set` `ESTADOS_COM_AVISO`) e usá-lo em `avisoDaRun` e `ingest-pagamentos.ts`.
- **Resultado Esperado**
  > Um estado novo muda 1 lugar; job e `error_message` sempre concordam.
- **Tactic alvo**: Abstract Common Services
- **Severidade**: P3
- **Esforço estimado**: S
- **Findings relacionados**: F-modifiability-2
- **Métricas de sucesso**:
  - Cópias do predicado: 2 → 1
- **Risco de não fazer**: divergência silenciosa entre o aviso do cron e o da run.
- **Dependências**: nenhuma

### [modifiability-3] Amarrar o limiar de 8 h à cadência dos crons

- **Problema**
  > 8 h é menor que o vão noturno de 15 h (16:00→07:00); aviso aparece ≈ 7 h por dia útil com a pipeline saudável, e a constante não referencia o workflow.
- **Melhoria Proposta**
  > Defer Binding: em vez de horas corridas, comparar contra "última janela de cron esperada" (ex.: considerar defasado só se `agora` > próximo horário de sync esperado + folga), ou subir para 17 h com comentário apontando `ingest-sispag.yml`; alternativamente o backend devolve `defasado: boolean` junto de `sincronizadoEm` e a regra fica num único lugar, ao lado do cron. Adicionar teste que falha se o vão do workflow exceder o limiar.
- **Resultado Esperado**
  > Aviso só aparece quando o pool realmente perdeu uma rodada.
- **Tactic alvo**: Defer Binding
- **Severidade**: P2
- **Esforço estimado**: S
- **Findings relacionados**: F-modifiability-3
- **Métricas de sucesso**:
  - Horas/dia útil com falso positivo: ≈ 7 → 0
- **Risco de não fazer**: o aviso vira ruído e é ignorado — o cenário que o motivou (pool 5 dias parado) se repete sem ser visto.
- **Dependências**: confirmar com Operações a cadência desejada dos crons

### [modifiability-4] Registrar (ou externalizar) o prazo DDA como parâmetro de ambiente

- **Problema**
  > `DDA_PRAZO_NA_INGESTAO_MS` é fixo em 60 s; calibrar exige deploy.
- **Melhoria Proposta**
  > Defer Binding: ler via `EnvironmentProvider` (`ddaPrazoNaIngestaoMs`, default 60_000). Só vale se a primeira semana de produção mostrar `parcial` recorrente; senão manter e fechar.
- **Resultado Esperado**
  > Ajuste de prazo sem deploy, com default atual preservado.
- **Tactic alvo**: Defer Binding
- **Severidade**: P3
- **Esforço estimado**: S
- **Findings relacionados**: F-modifiability-4, F-modifiability-5
- **Métricas de sucesso**:
  - Deploys por ajuste de prazo: 1 → 0
- **Risco de não fazer**: baixo; custo é um deploy.
- **Dependências**: dados de `arquivosAdiados` da primeira semana

## 6. Notas do agente

- Escopo só o delta; complexidade medida com `biome lint` no arquivo (20, confirma o declarado). Fan-in por grep de nome, não por `madge`.
- Pontos fortes: sem ciclo, sem violação de camada, estados `DDA_NA_INGESTAO` como const tipada num único lugar, frontend não duplica strings.
- Cross-QA: Fault-tolerance/Availability (enriquecimento nunca derruba a ingestão; prazo 60 s no caminho da abertura de tela); Deployability (F-3 e F-4: config compile-time = redeploy); Testability (runIngestion com 10 deps e CC 20 é difícil de testar; predicado do job sem teste).
