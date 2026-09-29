---
qa: Modifiability
qa_slug: modifiability
run_id: 2026-09-29-0104
agent: qa-modifiability
generated_at: 2026-09-28T00:00:00-03:00
scope: backend
score: 5.5
findings_count: 4
cards_count: 3
---

# Modifiability — Regis-Review

## 1. Cenário Geral

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Time de produto/analista Columbia | Novo meio de pagamento (após TED/PIX: ex. DOC, tributos) ou nova regra de destino de favorecido | `RemessaService`, `DestinoPagamentoResolver`, `LotePagamentoService`, `routes/sispag.ts`, `LoteCard` | Desenvolvimento, três flags OFF em produção | Mudança concentrada no Resolver e em libs de destino, sem editar o orquestrador de remessa | Arquivos tocados por nova modalidade ≤ 4; nenhum arquivo > 600 LOC editado |

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Max LOC, arquivo do escopo (RemessaService) | 1499 (main: 1111; delta +388) | ≤ 600 | ❌ | `wc -l` |
| Arquivos do escopo > 600 LOC | 5 (RemessaService, routes/sispag 832, LotePagamentoRepository 769, LotePagamentoService 676, ConexosSispagClient 617) | 0 | ❌ | `wc -l` |
| Arquivos novos do delta (Resolver 232, DestinoManualValidator 217, MaskDestino 108, ApiView 53) | todos ≤ 232 | ≤ 400 | ✅ | `wc -l` |
| Imports por arquivo (fan-out) | RemessaService 27, routes/sispag 26, LotePagamentoService 22, Painel 18, Resolver 4 | ≤ 15 | ❌ (legado) / ✅ (Resolver) | `grep -c '^import '` |
| Complexidade cognitiva Biome (delta) | RemessaService.gerarRemessaSerializado 91→93; montarItensImport 32→36 (limite 15) | ≤ 15 | ❌ | `_shared-metrics.md` |
| Warnings Biome totais | 75 (pré-existentes) | 0 novos | ⚠️ | `_shared-metrics.md` |
| Violações domain→routes | 0 | 0 | ✅ | `grep "from '.*routes/" domain` |
| Imports de repository/client em routes/sispag.ts | 4 (ConexosSispagClient, ConciliacaoExecucaoRepository, PagamentoIngestaoRunRepository, RemessaExecucaoRepository) | 0 | ❌ PRE_EXISTING | `routes/sispag.ts:7-12` |
| Ciclos de dependência | Não verificado (sem madge; Resolver tem 4 imports, sem retorno ao RemessaService) | 0 | ⚠️ | inspeção manual |
| Magic numbers de regra nos services | `TITULOS_CAP=5000`, `MINUTOS_ORFAO=15`, `MAX_TITULOS_POR_LOTE=25` (nenhum no delta; delta usa flags) | configuráveis | ⚠️ PRE_EXISTING | `grep const` |
| Drift `_index.json` / `_coverage.json` | ⚠️ Não medido nesta rodada (--quick, escopo da feature) | drift ≤ 5 | ⚠️ | n/a |

### Apêndice A — Top-10 maiores arquivos (backend `domain/` + `routes/`, não-teste)

| # | Arquivo | LOC |
|---|---|---|
| 1 | domain/service/recebimentos/RecebimentoNumerarioService.ts | 2415 |
| 2 | domain/service/sispag/RemessaService.ts | 1499 |
| 3 | domain/client/ConexosGerDocProcessoClient.ts | 1300 |
| 4 | domain/service/permutas/ReconciliacaoPermutaService.ts | 1160 |
| 5 | domain/service/permutas/EleicaoPermutasService.ts | 1143 |
| 6 | domain/client/ConexosSispagWriteClient.ts | 1090 |
| 7 | routes/permutas.ts | 994 |
| 8 | routes/recebimentos.ts | 984 |
| 9 | routes/sispag.ts | 832 |
| 10 | domain/repository/sispag/LotePagamentoRepository.ts | 769 |

### Apêndice B — Fan-in (arquivos não-teste que importam o módulo), módulos do escopo

Medição limitada ao escopo sispag (não há varredura de todos os services em --quick).

| # | Módulo | Fan-in |
|---|---|---|
| 1 | ConexosSispagClient | 12 |
| 2 | LotePagamentoRepository | 7 |
| 3 | SispagPainelService | 3 |
| 4 | RemessaService | 2 |
| 5 | LotePagamentoService | 2 |
| 6 | DestinoPagamentoResolver | 2 |
| 7 | MaskDestino | 2 |
| 8 | DestinoManualValidator | 2 |
| 9 | RemessaCnabValidator | 2 |
| 10 | ConciliacaoRetornoService | 2 |

## 3. Tactics — Cobertura

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Split Module | Delta extraiu Resolver, Validator, MaskDestino, ApiView (bom), mas ainda acrescentou +388 LOC líquidas ao RemessaService e +238 ao LotePagamentoService | ⚠️ parcial | `git diff --numstat` |
| Increase Semantic Coherence | Regra de destino unificada no `DestinoPagamentoResolver` (mesma regra para remessa e checagem); LotePagamentoService agora mistura ciclo de vida de lote e edição de destino | ⚠️ parcial | `RemessaService.ts:1076-1083`; `LotePagamentoService.ts:384-403` |
| Encapsulate | Mascaramento (`MaskDestino`), `LotePagamentoApiView` esconde dado sensível da API | ✅ presente | libs/sispag, ApiView |
| Use an Intermediary | Resolver entre RemessaService e dados de destino; repository entre service e SQL | ✅ presente | `RemessaService.ts:176` |
| Restrict Dependencies | Rotas Express importam repository/client (PRE_EXISTING); domain não importa routes | ⚠️ parcial | `routes/sispag.ts:7-12` |
| Refactor | Complexidade de `gerarRemessaSerializado` cresceu (91→93) em vez de cair | ❌ ausente | Biome |
| Abstract Common Services | Resolver compartilhado por remessa e painel; EnvironmentProvider para flags | ✅ presente | `EnvironmentProvider.ts:228-230` |
| Defer Binding | 3 flags de go-live via EnvironmentProvider; DI tsyringe; sem tokens/polimorfismo por modalidade (ramificação em RemessaService) | ⚠️ parcial | `EnvironmentProvider.ts:228,335` |

## 4. Findings

### F-modifiability-1: RemessaService segue crescendo (1499 LOC, 27 imports, complexidade 93)
- **Severidade**: P1 — IN_DELTA (agravamento de problema PRE_EXISTING: 1111 LOC no main)
- **Tactic violada**: Split Module / Refactor
- **Localização**: `src/backend/domain/service/sispag/RemessaService.ts`
- **Evidência (objetiva)**:
  ```
  1499 LOC (main 1111, +388); 27 imports; gerarRemessaSerializado cognitiva 91->93; montarItensImport 32->36 (limite 15)
  ```
- **Impacto técnico**: Toda nova modalidade de pagamento edita o mesmo arquivo; alto risco de regressão no envio bancário.
- **Impacto de negócio**: Remessa errada vira rejeição do banco; cada mudança exige teste supervisionado em PRD (sem HML).
- **Métrica de baseline**: 1499 LOC (2,5x o alvo de 600); complexidade 93 (6x o limite 15).

### F-modifiability-2: LotePagamentoService absorveu edição de destino (+238 LOC, 22 imports)
- **Severidade**: P1 — IN_DELTA
- **Tactic violada**: Increase Semantic Coherence / Split Module
- **Localização**: `src/backend/domain/service/sispag/LotePagamentoService.ts:384-411`
- **Evidência (objetiva)**:
  ```
  438 -> 676 LOC; novos métodos definirDestinoManualItem / limparDestinoManualItem junto com ciclo de vida do lote
  ```
- **Impacto técnico**: Duas responsabilidades (estado do lote e destino de item) no mesmo service.
- **Impacto de negócio**: Evolução das regras de destino (ex.: nova chave PIX) atinge o serviço crítico de lotes.
- **Métrica de baseline**: 676 LOC (> 600); 22 imports (> 15).

### F-modifiability-3: Rotas importam repository/client diretamente
- **Severidade**: P2 — PRE_EXISTING (o delta tocou o arquivo: +122/-9 em routes/sispag.ts, 832 LOC)
- **Tactic violada**: Restrict Dependencies / Use an Intermediary
- **Localização**: `src/backend/routes/sispag.ts:7-12`
- **Evidência (objetiva)**:
  ```
  import ConexosSispagClient ...; ConciliacaoExecucaoRepository; PagamentoIngestaoRunRepository; RemessaExecucaoRepository
  ```
- **Impacto técnico**: Mudança de schema/cliente ripple até a camada HTTP; migração Lambda exige reescrita.
- **Impacto de negócio**: Custo extra na migração ao alvo Lambda (ver migration-debt).
- **Métrica de baseline**: 4 imports de repository/client em routes/sispag.ts; 26 imports no total.

### F-modifiability-4: Modalidade (TED/PIX/crédito) tratada por ramificação, sem estratégia por modalidade
- **Severidade**: P3 — IN_DELTA
- **Tactic violada**: Defer Binding
- **Localização**: `RemessaService.ts:1076-1083`, `DestinoPagamentoResolver.ts`
- **Evidência (objetiva)**:
  ```
  Resolver centraliza a regra, mas o mapeamento modalidade->itsVldModalidade e a serialização ficam em RemessaService
  ```
- **Impacto técnico**: Adicionar DOC/tributo exige tocar Resolver, Validator CNAB e RemessaService.
- **Impacto de negócio**: Ampliação de meios de pagamento custa mais que o necessário.
- **Métrica de baseline**: ~3 arquivos por nova modalidade (estimativa por leitura, não medida).

## 5. Cards Kanban

### [modifiability-1] Extrair montagem de itens de remessa do RemessaService

- **Problema**
  > RemessaService tem 1499 LOC e complexidade 93 em `gerarRemessaSerializado`; o delta acrescentou +388 LOC. Cada nova modalidade edita esse arquivo.
- **Melhoria Proposta**
  > Split Module: extrair `RemessaItensBuilder` (montarItensImport, resolução de destino) e a orquestração de data de débito para services próprios; Refactor em `gerarRemessaSerializado` por etapas. Migrar proporcionalmente em `/feature-tweak` que tocar o arquivo, cobertos pelos testes de paridade existentes.
- **Resultado Esperado**
  > RemessaService ≤ 600 LOC; complexidade da função principal 93 → ≤ 30 (meta intermediária); imports 27 → ≤ 15.
- **Tactic alvo**: Split Module / Refactor
- **Severidade**: P1
- **Esforço estimado**: L
- **Findings relacionados**: F-modifiability-1, F-modifiability-4
- **Métricas de sucesso**:
  - LOC RemessaService: 1499 → ≤ 600
  - Complexidade cognitiva máxima: 93 → ≤ 30
- **Risco de não fazer**: Cada nova modalidade adiciona ~200-400 LOC ao arquivo; em 6 meses passa de 2000 LOC.
- **Dependências**: Manter flags e testes de paridade (byte-idêntico com flags OFF) verdes.

### [modifiability-2] Separar edição de destino do LotePagamentoService

- **Problema**
  > O service ganhou +238 LOC misturando ciclo de vida do lote e destino manual (676 LOC, 22 imports).
- **Melhoria Proposta**
  > Increase Semantic Coherence: criar `DestinoItemService` com `definirDestinoManualItem`/`limparDestinoManualItem` e `atualizarModalidadeItem`, delegando ao Resolver/Validator.
- **Resultado Esperado**
  > LotePagamentoService 676 → ≤ 450 LOC; imports 22 → ≤ 15.
- **Tactic alvo**: Increase Semantic Coherence
- **Severidade**: P1
- **Esforço estimado**: M
- **Findings relacionados**: F-modifiability-2
- **Métricas de sucesso**:
  - LOC: 676 → ≤ 450
  - Imports: 22 → ≤ 15
- **Risco de não fazer**: Regras de destino evoluem dentro do serviço mais crítico de lotes.
- **Dependências**: Nenhuma.

### [modifiability-3] Tirar acesso a repository/client de routes/sispag.ts

- **Problema**
  > Rotas importam 4 repository/client direto (PRE_EXISTING) e o delta acrescentou mais 122 linhas ao arquivo de 832 LOC.
- **Melhoria Proposta**
  > Restrict Dependencies: expor leituras via services/facades (ex. `SispagPainelService`) e dividir o arquivo de rotas por recurso (lotes, remessa, ingestão).
- **Resultado Esperado**
  > Imports repository/client em routes/sispag.ts 4 → 0; arquivo 832 → ≤ 400 LOC por router.
- **Tactic alvo**: Restrict Dependencies / Split Module
- **Severidade**: P2
- **Esforço estimado**: M
- **Findings relacionados**: F-modifiability-3
- **Métricas de sucesso**:
  - Imports diretos: 4 → 0
  - LOC por arquivo de rota: 832 → ≤ 400
- **Risco de não fazer**: Migração Lambda mais cara; rotas continuam acopladas a schema.
- **Dependências**: Alinha com `ontology/_inbox/migration-debt.md`.

## 6. Notas do agente

- Escopo feature-scoped (--quick): fan-in medido só para módulos sispag; ciclos e `_index.json`/`_coverage.json` não verificados. F-modifiability-4 (P3) sem card próprio, coberto por modifiability-1.
- Ponto positivo IN_DELTA: Resolver (232 LOC, 4 imports), Validator, MaskDestino e ApiView são pequenos e coesos; flags via EnvironmentProvider (Defer Binding).
- Cross-QA: Reduce Size/complexidade sobrepõe Testability; rotas→repository sobrepõe Integrability; flags de go-live em env exigem redeploy (Deployability); magic numbers PRE_EXISTING em Painel/Formação (5000, 15, 25).
