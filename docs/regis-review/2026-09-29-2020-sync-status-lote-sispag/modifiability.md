---
qa: Modifiability
qa_slug: modifiability
run_id: 2026-09-29-2020
agent: qa-modifiability
generated_at: 2026-09-29T20:30:00-03:00
scope: backend
score: 7
findings_count: 5
cards_count: 4
---

# Modifiability — Regis-Review

## 1. Cenário Geral

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Desenvolvedor / analista de negócio | Nova regra de fechamento de status do lote SISPAG (ex.: novo estado de baixa no Conexos) ou nova situação de item | `DecisaoStatusLote`, `SincronizacaoLoteService`, `ConciliacaoRetornoService`, `LotePagamentoRepository`, `LoteCard.tsx` | Design-time, sem freeze | Mudança localizada na decisão pura única (L9/L10/L11 compartilham `DecisaoStatusLote`) | <= 3 arquivos de produção tocados; 0 duplicação de regra; sem deploy de infra |

## 2. Métricas observadas

Escopo `--quick`: dirs da feature. p50/p95 medidos no `src/backend` inteiro.

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| LOC por arquivo fonte (backend, n=940) p50 / p95 / max | 30 / 429 / 2415 | 150 / 400 / 600 | ⚠️ (p95 no limite; max pré-existente) | `find src/backend -name '*.ts' ! -name '*.test.ts' -exec wc -l` |
| Arquivos novos in-delta > 600 LOC | 1 (`SincronizacaoLoteService.ts` 626) | 0 | ⚠️ | `wc -l` |
| Arquivos tocados > 600 LOC (pré-existentes) | `LotePagamentoRepository` 1047 (+189 no delta), `routes/sispag.ts` 924 (+54; era 878) | <= 600 | ❌ | `wc -l`, `git diff --stat` |
| Service vs client (LOC médio) | service 20399/67 = 304; client 8240/22 = 375 | service <= client | ✅ | `_shared-metrics.md` |
| Cognitive complexity > 15 no escopo de produção não-job | 9 funções (in-delta: `ConexosTitulosClient.ts:312`; tocado: `ConciliacaoRetornoService.ts:103`) | 0 | ⚠️ | `npx biome lint` nos dirs do escopo |
| Imports fan-out (in-delta) | `SincronizacaoLoteService` 16; `routes/sispag.ts` 28; `ConciliacaoRetornoService` 12; `DecisaoStatusLote` 4 | <= 15 | ⚠️ | `grep -c '^import '` |
| Control-flow keywords (in-delta) | `routes/sispag.ts` 43; `SincronizacaoLoteService` 41; `DecisaoStatusLote` 41 (esperado: é a decisão pura) | — | ⚠️ | grep de `if/else/switch/&&/\|\|` |
| Violação de camada: domain -> routes | 0 | 0 | ✅ | `grep "from '.*routes/" domain` |
| Violação de camada: routes -> repository/client | `routes/sispag.ts`: `ConexosSispagClient` + 3 repositórios; delta adicionou só um Service (pré-existente) | 0 | ❌ | `grep domain/(repository\|client) routes` |
| Ciclos de dependência | Não detectados nas amostras (`DecisaoStatusLote` só 4 imports) | 0 | ✅ (amostrado, sem madge) | inspeção de imports |
| Valores de regra hardcoded no delta | 3 (`JANELA_ESTORNO_DIAS = 30`, `FOLGA_RETORNO_MS = 24h`, `pageSize: 200`); nenhum via `EnvironmentProvider` | 0 | ⚠️ | `SincronizacaoLoteService.ts:46,49,440` |
| Entidades por serviço (delta) | `SincronizacaoLoteService`: Lote, Item, Título, Remessa/Retorno (3 métodos públicos) | <= 2 | ⚠️ | leitura de `public` |
| JOINs em `LotePagamentoRepository` | 7 ocorrências | <= 5 | ⚠️ | `grep -c JOIN` |
| `_coverage.json` / `_index.json` drift | ⚠️ **Não medível neste escopo** (--quick); ambos alterados no delta. Recomendação: `/retro-ontology` | 0 | ⚠️ | — |

### Apêndice A — Top-10 maiores arquivos (backend, não-teste)

| # | LOC | Arquivo | No delta? |
|---|---|---|---|
| 1 | 2415 | domain/service/recebimentos/RecebimentoNumerarioService.ts | não |
| 2 | 1602 | domain/service/sispag/RemessaService.ts | não |
| 3 | 1300 | domain/client/ConexosGerDocProcessoClient.ts | não |
| 4 | 1160 | domain/service/permutas/ReconciliacaoPermutaService.ts | não |
| 5 | 1143 | domain/service/permutas/EleicaoPermutasService.ts | não |
| 6 | 1090 | domain/client/ConexosSispagWriteClient.ts | não |
| 7 | 1047 | domain/repository/sispag/LotePagamentoRepository.ts | sim (+189) |
| 8 | 1002 | routes/permutas.ts | não |
| 9 | 1000 | routes/recebimentos.ts | não |
| 10 | 924 | routes/sispag.ts | sim (+54) |

### Apêndice B — Top-10 fan-in de serviços (arquivos de produção que importam)

| # | Fan-in | Serviço |
|---|---|---|
| 1 | 43 | LogService |
| 2 | 5 | NotificacaoService |
| 3 | 4 | SincronizacaoLoteService (novo) |
| 4 | 4 | ErpErrorInterpreter |
| 5 | 4 | EleicaoPermutasService |
| 6 | 3 | VariacaoCambialPermutaService |
| 7 | 3 | SispagPainelService |
| 8 | 3 | SaldoAlocacaoAdiantamentoService |
| 9 | 3 | ReconciliacaoPermutaService |
| 10 | 3 | JobRunReadModel |

Fan-in de apoio (não-serviço): `ConexosSispagClient` 13, `ConexosTitulosClient` 10, `LotePagamentoRepository` 9. `DecisaoStatusLote` 2, `ConciliacaoRetornoService` 2. Fan-in baixo nos serviços de domínio indica blast radius pequeno; `LogService` é infra estável.

## 3. Tactics — Cobertura

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Split Module | `DecisaoStatusLote` (409) extraído como decisão pura; porém `SincronizacaoLoteService` nasce com 626 LOC e `LotePagamentoRepository` chega a 1047 | ⚠️ parcial | `wc -l` |
| Increase Semantic Coherence | Regra I11 concentrada em um módulo usado por L9/L10/L11 (elimina cópias divergentes); o serviço de sync mistura carga PSQ_018, casamento, retorno e persistência | ⚠️ parcial | `DecisaoStatusLote.ts`, `SincronizacaoLoteService.ts:135-180` |
| Encapsulate | `ConexosSispagClient`/`ConexosTitulosClient` encapsulam o ERP; `interface/sispag/SincronizacaoLote.ts` tipa o contrato | ✅ presente | delta `client/`, `interface/sispag/` |
| Use an Intermediary | Feature nova passa por Service; rota legada ainda pula camadas | ⚠️ parcial | `routes/sispag.ts:7-12` |
| Restrict Dependencies | domain -> routes: 0; routes -> repo/client legadas persistem | ⚠️ parcial | grep |
| Refactor | `ConciliacaoRetornoService` refatorado para consumir a decisão comum; ainda com complexidade >15 em `:103` | ⚠️ parcial | biome |
| Abstract Common Services | `DecisaoStatusLote`, `Executors`, `LogService`, `JobRunReadModel` reutilizados | ✅ presente | imports |
| Defer Binding | tsyringe `@injectable`; job separado do agendador (GH Actions); janela 30 dias, folga 24h e pageSize hardcoded; 0 tokens/interfaces polimórficas (aceitável para domínio único) | ⚠️ parcial | `SincronizacaoLoteService.ts:46,49,440` |

## 4. Findings

### F-modifiability-1: `SincronizacaoLoteService` nasce acima do limite e com fan-out 16 (in-delta)

- **Severidade**: P2
- **Tactic violada**: Split Module / Increase Semantic Coherence
- **Localização**: `src/backend/domain/service/sispag/SincronizacaoLoteService.ts:1-626`
- **Evidência (objetiva)**:
  ```
  626 LOC, 16 imports, 41 keywords de fluxo; 3 métodos públicos (sincronizarTodos, sincronizarLote, aplicarEventosRetorno)
  ```
- **Impacto técnico**: acumula carga de dados no Conexos, casamento por chave composta, avaliação de retorno e persistência; qualquer mudança exige reler o arquivo todo.
- **Impacto de negócio**: cada ajuste na regra de status (risco financeiro, remessas reais) custa mais revisão e teste.
- **Métrica de baseline**: 626 LOC (alvo <= 600), fan-out 16 (alvo <= 15). Excesso pequeno, por isso P2.

### F-modifiability-2: `LotePagamentoRepository` com 1047 LOC e 7 JOINs, +189 linhas no delta (in-delta; tamanho pré-existente)

- **Severidade**: P2
- **Tactic violada**: Split Module
- **Localização**: `src/backend/domain/repository/sispag/LotePagamentoRepository.ts`
- **Evidência (objetiva)**:
  ```
  1047 LOC; grep -c JOIN = 7; delta +189 (listLotesSincronizaveis, persistência de item_situacao)
  ```
- **Impacto técnico**: SQL cru concentra escrita de lote, leitura de painel e sincronização; a migration 0069 repercute num único arquivo grande.
- **Impacto de negócio**: mudanças de schema no SISPAG ficam lentas e sujeitas a conflito entre sessões paralelas.
- **Métrica de baseline**: 1047 LOC (alvo <= 600). Mantido P2: o arquivo já era grande antes e o delta é ~22%.

### F-modifiability-3: `routes/sispag.ts` pula camadas (pré-existente; delta não piorou)

- **Severidade**: P2
- **Tactic violada**: Use an Intermediary / Restrict Dependencies
- **Localização**: `src/backend/routes/sispag.ts:7-12` (924 LOC, 28 imports)
- **Evidência (objetiva)**:
  ```
  import ConexosSispagClient; ConciliacaoExecucaoRepository; PagamentoIngestaoRunRepository; RemessaExecucaoRepository
  ```
- **Impacto técnico**: 4 imports diretos de client/repositório em rota. O delta adicionou apenas `SincronizacaoLoteService` (correto).
- **Impacto de negócio**: a migração para Lambda (alvo) exigirá refatorar a rota inteira; quanto mais cresce, mais cara.
- **Métrica de baseline**: 4 violações de camada em `routes/sispag.ts` (0 novas); padrão igual em `recebimentos.ts` e `operacao.ts`.

### F-modifiability-4: Parâmetros de regra hardcoded no serviço novo (in-delta)

- **Severidade**: P3
- **Tactic violada**: Defer Binding
- **Localização**: `SincronizacaoLoteService.ts:46` (`JANELA_ESTORNO_DIAS = 30`), `:49` (`FOLGA_RETORNO_MS`), `:440` (`pageSize: 200`)
- **Evidência (objetiva)**:
  ```
  export const JANELA_ESTORNO_DIAS = 30;  // comentário: "configuração operacional, não regra (ADR-0055)"
  ```
- **Impacto técnico**: mudar a janela exige alterar código e redeploy; mitigado por serem constantes nomeadas e documentadas.
- **Impacto de negócio**: ajuste operacional (ex.: estender a janela de estorno) custa um ciclo de release.
- **Métrica de baseline**: 3 valores hardcoded, 0 externalizados.

### F-modifiability-5: Complexidade cognitiva > 15 em funções tocadas (in-delta / tocado)

- **Severidade**: P2
- **Tactic violada**: Refactor
- **Localização**: `ConexosTitulosClient.ts:312` (novo), `ConciliacaoRetornoService.ts:103` (tocado no delta)
- **Evidência (objetiva)**:
  ```
  biome: lint/complexity/noExcessiveCognitiveComplexity (limite 15) em ambos
  ```
- **Impacto técnico**: funções de parsing/decisão difíceis de alterar sem regressão. Os outros 7 avisos no escopo são pré-existentes (clients, `RemessaService:220`, `routes/recebimentos.ts:540`, etc.).
- **Impacto de negócio**: retrabalho em bug de conciliação, área financeira.
- **Métrica de baseline**: 2 funções in-delta/tocadas acima de 15 (a pontuação exata não é reportada pelo biome).

## 5. Cards Kanban

### [modifiability-1] Dividir SincronizacaoLoteService em carga, casamento e aplicação

- **Problema**
  > O serviço novo tem 626 LOC, 16 imports e três responsabilidades misturadas (carga do Conexos, casamento por chave composta, avaliação de retorno).
- **Melhoria Proposta**
  > Extrair a carga (PSQ_018 e paginação) para um serviço próprio e o casamento de linhas para função pura ao lado de `DecisaoStatusLote`; manter o serviço como orquestrador. Arquivo: `SincronizacaoLoteService.ts`.
- **Resultado Esperado**
  > 626 -> <= 350 LOC; fan-out 16 -> <= 10; testes atuais continuam verdes.
- **Tactic alvo**: Split Module
- **Severidade**: P2
- **Esforço estimado**: M
- **Findings relacionados**: F-modifiability-1
- **Métricas de sucesso**:
  - LOC do serviço: 626 -> <= 350
  - imports: 16 -> <= 10
- **Risco de não fazer**: o serviço vira o próximo `RemessaService` (1602 LOC) em 6 meses.
- **Dependências**: nenhuma

### [modifiability-2] Quebrar LotePagamentoRepository por responsabilidade

- **Problema**
  > 1047 LOC com 7 JOINs; escrita, painel e sincronização convivem no mesmo arquivo.
- **Melhoria Proposta**
  > Separar `LoteSincronizacaoRepository` (listLotesSincronizaveis, item_situacao) e um repositório de leitura para o painel. Manter SQL parametrizado.
- **Resultado Esperado**
  > 1047 -> <= 600 LOC por arquivo; JOINs por repositório <= 5.
- **Tactic alvo**: Split Module
- **Severidade**: P2
- **Esforço estimado**: M
- **Findings relacionados**: F-modifiability-2
- **Métricas de sucesso**:
  - LOC máximo por repositório: 1047 -> <= 600
- **Risco de não fazer**: toda migration SISPAG toca o mesmo arquivo, com conflito frequente entre sessões paralelas.
- **Dependências**: nenhuma

### [modifiability-3] Tirar acesso direto a client/repositório de routes/sispag.ts

- **Problema**
  > A rota importa `ConexosSispagClient` e 3 repositórios diretamente (pré-existente); a migração para Lambda fica cara.
- **Melhoria Proposta**
  > Migração proporcional em `/feature-tweak`: criar services de fachada e dividir os handlers por sub-recurso (924 -> <= 600 LOC).
- **Resultado Esperado**
  > 4 violações -> 0; rota <= 600 LOC.
- **Tactic alvo**: Use an Intermediary
- **Severidade**: P2
- **Esforço estimado**: L
- **Findings relacionados**: F-modifiability-3
- **Métricas de sucesso**:
  - imports client/repository em `routes/sispag.ts`: 4 -> 0
- **Risco de não fazer**: a dívida em `migration-debt.md` cresce a cada endpoint.
- **Dependências**: nenhuma

### [modifiability-4] Externalizar a janela de estorno e reduzir complexidade das duas funções

- **Problema**
  > `JANELA_ESTORNO_DIAS`, `FOLGA_RETORNO_MS` e `pageSize` são constantes de código; duas funções tocadas excedem complexidade 15.
- **Melhoria Proposta**
  > Ler a janela via `EnvironmentProvider` com default 30 (Defer Binding); refatorar `ConexosTitulosClient:312` e `ConciliacaoRetornoService:103` em helpers.
- **Resultado Esperado**
  > 3 valores hardcoded -> 0; avisos biome in-delta 2 -> 0.
- **Tactic alvo**: Defer Binding / Refactor
- **Severidade**: P3
- **Esforço estimado**: S
- **Findings relacionados**: F-modifiability-4, F-modifiability-5
- **Métricas de sucesso**:
  - constantes hardcoded: 3 -> 0
  - avisos de complexidade in-delta: 2 -> 0
- **Risco de não fazer**: ajustes operacionais continuam exigindo release completo.
- **Dependências**: nenhuma

## 6. Notas do agente

- Escopo `--quick`: tamanho medido no backend inteiro; ontologia (`_coverage`/`_index`) não auditada; sem madge, ciclos amostrados. Nenhum P0.
- Ponto forte: `DecisaoStatusLote` unifica L9/L10/L11 (regra I11) em módulo puro de 4 imports, com 376 linhas de teste.
- Cross-QA: Testability (arquivos grandes/complexos são difíceis de testar), Deployability (constantes de regra exigem redeploy), Integrability (clients Conexos novos e Encapsulate).
