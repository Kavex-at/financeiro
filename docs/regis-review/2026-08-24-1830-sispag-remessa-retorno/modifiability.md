---
qa: Modifiability
qa_slug: modifiability
run_id: 2026-08-24-1830-sispag-remessa-retorno
agent: qa-modifiability
generated_at: 2026-08-24T18:30-03:00
scope: all
score: 6
findings_count: 9
cards_count: 8
---

# Modifiability — Regis-Review (SISPAG — Remessa `.REM` + Conciliação `.RET`)

## 1. Cenário Geral (Bass General Scenario aplicado à frente SISPAG)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Analista financeira / dev de produto | Mudança recorrente **e previsível** no domínio: (a) novo banco na lista de contas pagadoras (`bncCod` interno → FEBRABAN); (b) nova modalidade nativa `fin015` (segmento J/A/PIX); (c) invariante nova no wire para o ERP; (d) mudança na regra de conciliação (novo `fbeVldTpret` etc.); (e) chegada da entrega efetiva do `.RET` pela tela (hoje só sintético). | Serviços `RemessaService` (467 LOC), `ConciliacaoRetornoService` (260 LOC), `LotePagamentoService` (405 LOC), repositórios `LotePagamentoRepository` (566 LOC), `RemessaExecucaoRepository` (187 LOC), rota `routes/sispag.ts` (472 LOC) e front `app/sispag/page.tsx` (930 LOC) + `LoteCard.tsx` (497 LOC) + `lib/sispag.ts` (550 LOC). Jobs (`jobs/*.ts`, 32 scripts exploratórios / 6473 LOC) espelham partes desse conhecimento. | Fatia 3 em produção com escrita **REAL** gated (`CONEXOS_WRITE_ENABLED=true` + `CONEXOS_DRY_RUN=false`); perna de retorno validada só com `.RET` sintético (nunca pela tela). Ledger `remessa_execucao` (migration 0049) já aplicada. | Alteração cabe em **≤ 2 arquivos de produção** e **1 lugar canônico por tabela de tradução** (FEBRABAN, modalidade, status, nome de banco). O código de produção não é modificado quando a mudança é de política parametrizável. | ≤ 2 arquivos por regra bancária (hoje: **4** para trocar código FEBRABAN — 3 backend + 1 frontend); ≤ 3 arquivos por novo status (hoje: **5+** por causa das strings soltas no FE); mudança em invariante do agregado toca **1 service** (hoje: **2** — `LotePagamentoService` + `RemessaService`). |

Cenário aplicado — **"o cliente contrata Bradesco (bncCod=7) além do Itaú"**: o mapa FEBRABAN é o mesmo em `RemessaService`, `jobs/preflight-fin015-prd.ts`, `jobs/validate-fin015-import.ts`, e o mapa de nomes é replicado em `frontend/lib/sispag.ts`. Trocar/adicionar uma entrada = **4 arquivos** com risco de sair de sincronia (o backend cai para o default `341` se faltar entrada; o frontend rotula `"banco N"`). Cenário sósia — **"passar `.RET` de sintético para a tela"**: o parsing e a chave `filCod+bncCod+flpCod+itsCodSeq` só existem em `ConciliacaoRetornoService` — bom. Mas o gate de "de onde veio o arquivo" mora no client (`processarArquivoRetorno`) e não é substituível — a ida via tela vai exigir tocar service + client + rota.

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| LOC max — serviço SISPAG (delta) | 467 (`RemessaService.ts`) | ≤ 400 | ⚠️ | `wc -l src/backend/domain/service/sispag/*.ts` |
| LOC max — repository SISPAG (delta) | 566 (`LotePagamentoRepository.ts`) | ≤ 400 | ❌ | idem |
| LOC — `routes/sispag.ts` | 472 (+111 no delta) | ≤ 300 | ❌ | `wc -l src/backend/routes/sispag.ts` |
| LOC — `frontend/app/sispag/page.tsx` | 930 (+160 no delta) | ≤ 400 | ❌ | `wc -l src/frontend/app/sispag/page.tsx` |
| LOC — `frontend/app/sispag/components/LoteCard.tsx` | 497 (+159 no delta) | ≤ 300 | ❌ | idem |
| LOC — `frontend/lib/sispag.ts` | 550 (+225 no delta) | ≤ 400 | ❌ | idem |
| Duplicação de `FEBRABAN_POR_BNCCOD` (mesma tabela literal `{3:1, 4:341, 7:237, 10:33}`) | **3 lugares** (`RemessaService.ts:17`, `jobs/preflight-fin015-prd.ts:47`, `jobs/validate-fin015-import.ts:63`) + 1 tabela análoga `BANCO_NOME` em `frontend/lib/sispag.ts:442` cobrindo os mesmos códigos | 1 lugar canônico (config/tabela) | ❌ | `grep -rn 'FEBRABAN_POR_BNCCOD\|3: 1' src/` |
| Enum de status do lote replicado como string crua no FE | 3 leituras (`page.tsx:225,226,239-244`, `LoteCard.tsx:48,54,72,104,105`) — sem enum importado | 0 (importar do `lib/sispag.ts` ou tipo compartilhado) | ⚠️ | `grep -rn "'RASCUNHO'\|'FINALIZADO'\|'REMESSA_GERADA'\|'BAIXADO'\|'RETORNADO'\|'CANCELADO'" src/frontend/app/sispag` |
| Cognitive complexity — Biome nos serviços do delta | `RemessaService.gerarRemessa` (linha 85) e `ConciliacaoRetornoService.conciliar` (linha 75) e `RemessaService.montarItensImport` (linha 371) todos **acima do teto 15** (Biome sinaliza os 3) | 0 excesso | ❌ | `cd src/backend && npx biome check domain/service/sispag/` |
| Cognitive complexity — Biome nos jobs do delta | 10+ jobs acima de 15 (ex.: `probe-fin052-retorno` = **88**, `execute-fin015-prd` = **66**, `probe-fin064-destino` = **49**, `probe-fin015-import` = **45**, `probe-impacto-antecipacao` = **44**, `preflight-fin015-prd` = **35**, `probe-baixa-conta-financeira` = **34**, `probe-fin015-fluxo` = **25**, `cleanup-fin015-testes` = **23**) | jobs não deveriam entrar no lint como código de produção OU deveriam estar abaixo de 15 | ❌ | `cd src/backend && npx biome check jobs/` |
| Erros de format do Biome no delta | **9 errors** em `domain/service/sispag/` + rota, **13 errors + 16 warnings** em `jobs/` | 0 | ❌ | `npx biome check` |
| Densidade de comentários em `RemessaService.ts` | 65 linhas de `//` ou `/*` em 467 LOC ≈ **14%** (invariantes críticas dormem em prosa: reciclagem de `flpCod`, `RemessaEmDuvidaError`, "buscar arquivo pelo NOME", "identidade VERBATIM") | invariante crítico = teste / função nomeada, não parágrafo | ⚠️ | `grep -c "//\|/\*\|^\s*\*" RemessaService.ts` |
| Densidade de comentários em `ConciliacaoRetornoService.ts` | 33 linhas em 260 LOC ≈ **13%** (chave `filCod+bncCod+flpCod+itsCodSeq` no "uso da empresa" do segmento A explicada em prosa, sem contrato-código) | idem | ⚠️ | idem |
| Fronteira do agregado `LotePagamento` | Dividida entre `LotePagamentoService` (RASCUNHO ↔ FINALIZADO ↔ CANCELADO ↔ RETORNADO, transição L5–L7) e `RemessaService` (FINALIZADO → REMESSA_GERADA) e `ConciliacaoRetornoService` (REMESSA_GERADA/RETORNADO → BAIXADO/RETORNADO). **3 lugares** decidem o próximo estado do mesmo agregado. | 1 lugar (o serviço do agregado) coordena a máquina de estados | ⚠️ | `grep -rn "LOTE_STATUS\." src/backend/domain/service/sispag/` |
| Ontology `state-machines/lote-pagamento.md` | Declara 4 estados (RASCUNHO, FINALIZADO, RETORNADO, CANCELADO) e diz explicitamente que `BAIXADO` é **out_of_scope**; o código do delta implementa 6 (adiciona REMESSA_GERADA e BAIXADO) | ontology = código | ❌ | `grep out_of_scope_states ontology/state-machines/lote-pagamento.md` vs `SispagInterface.ts:169` |
| Coverage `_coverage.json` — `LotePagamento` | `status: "planned"` mesmo com 6 transições implementadas + 2 novas neste delta (REMESSA_GERADA/BAIXADO) | `implemented` (ou `partial` com nota do gap) | ❌ | `ontology/_coverage.json` |
| Unused import (`randomUUID` em `RemessaService.ts:1`) | 1 (Biome error) | 0 | ⚠️ | `npx biome check` |
| Magic numbers / fallbacks silenciosos em `RemessaService` | `FEBRABAN_POR_BNCCOD[bncCod] ?? 341` (2 ocorrências), `MODALIDADE_NATIVA[...] ?? 1` — se `bncCod` não estiver no mapa, o pagamento sai **como Itaú** silenciosamente | falhar explícito (`throw`) ou tabela externalizada com validação | ⚠️ | `RemessaService.ts:171,378,414` |
| Fan-out — `RemessaService.ts` (imports) | 14 imports (13 do domínio, 1 do node) | ≤ 12 | ⚠️ | `grep -c '^import ' RemessaService.ts` |
| Fan-out — `frontend/app/sispag/page.tsx` (imports) | 21 imports | ≤ 15 | ❌ | `grep -c '^import ' page.tsx` |
| Fan-out — `routes/sispag.ts` (imports) | 18 imports; a rota resolve **6 serviços diferentes** via `container.resolve` | rota fina; ≤ 3 serviços por rota (ADR-like) | ⚠️ | `grep -c 'container.resolve' routes/sispag.ts` |
| Testes automatizados dos novos serviços | `RemessaService.test.ts` (393 LOC) e `ConciliacaoRetornoService.test.ts` (234 LOC) presentes; suíte inteira do backend verde (1330 testes) | ≥ 1 teste por invariante crítica descrita nos comentários | ✅ | `_shared-metrics.md` |
| `useState` em `app/sispag/page.tsx` | 16 estados no mesmo componente (era 15 no review de julho) | ≤ 6 | ❌ | `grep -c 'useState' page.tsx` |
| Cross-layer violations (rota → repository sem service) | 1 (`PagamentoIngestaoRunRepository` na rota `/ingestao/runs`, pré-existente e legítima como trilha de auditoria) | ≤ 1 justificada | ✅ | `routes/sispag.ts` |

### Apêndice A — Top-10 arquivos SISPAG por LOC (não-teste, foco no delta)

| # | Arquivo | LOC | Delta |
|---|---|---|---|
| 1 | `src/frontend/app/sispag/page.tsx` | 930 | +160 |
| 2 | `src/backend/domain/repository/sispag/LotePagamentoRepository.ts` | 566 | +150 (aprox.) |
| 3 | `src/frontend/lib/sispag.ts` | 550 | +225 |
| 4 | `src/backend/jobs/validate-fin015-import.ts` | 518 | +518 (novo) |
| 5 | `src/frontend/app/sispag/components/LoteCard.tsx` | 497 | +159 |
| 6 | `src/backend/routes/sispag.ts` | 472 | +111 |
| 7 | `src/backend/domain/service/sispag/RemessaService.ts` | 467 | +467 (novo) |
| 8 | `src/backend/jobs/execute-fin015-prd.ts` | 432 | +432 (novo) |
| 9 | `src/backend/domain/service/sispag/LotePagamentoService.ts` | 405 | 0 (pré-existente) |
| 10 | `src/backend/domain/client/ConexosSispagClient.ts` | 406 | pré-existente |

Fora do top-10 mas relevantes ao delta: `ConexosSispagWriteClient.ts` (396), `jobs/probe-fin052-retorno.ts` (391), `ConexosSispagRetornoClient.ts` (370), `SispagPainelService.ts` (292), `ConciliacaoRetornoService.ts` (260), `SispagInterface.ts` (291), `RemessaExecucaoRepository.ts` (187).

### Apêndice B — Fan-in por módulo SISPAG (não-teste, escopo delta)

| # | Módulo | Fan-in prod | Fan-in jobs | Chamadores prod |
|---|---|---|---|---|
| 1 | `ConexosSispagClient` | 4 | 0 | IngestaoPagamentosService, LotePagamentoService, RemessaService, SispagPainelService, `routes/sispag.ts` (/contas-pagadoras) |
| 2 | `LotePagamentoRepository` | 4 | 0 | LotePagamentoService, FormacaoLotesService, SispagPainelService, ConciliacaoRetornoService, RemessaService |
| 3 | `ConexosSispagWriteClient` | 1 | 5 | **RemessaService** + jobs (execute-fin015-prd, probe-fin015-import, sintetizar-ret-fin052, validate-fin015-import, validate-fin015-remessa, validate-fin015-tools) |
| 4 | `ConexosSispagRetornoClient` | 2 | 3 | **ConciliacaoRetornoService**, SispagPainelService + jobs (probe-fin052-hml, sintetizar-ret-fin052, validate-fin052-tools) |
| 5 | `RemessaExecucaoRepository` | 1 | 0 | RemessaService |
| 6 | `RemessaService` | 1 | 0 | `routes/sispag.ts` |
| 7 | `ConciliacaoRetornoService` | 1 | 0 | `routes/sispag.ts` |
| 8 | `LotePagamentoService` | 1 | 0 | `routes/sispag.ts` |
| 9 | `SispagPainelService` | 1 | 1 | `routes/sispag.ts` + `jobs/probe-sispag-painel.ts` |
| 10 | `SispagInterface.ts` (contrato TS) | 8+ | 5+ | todos os services + routes + jobs |

Leitura: `ConexosSispagClient` e `LotePagamentoRepository` são hubs — 4 chamadores cada; refactor deles precisa cobrir todo o fanout. `RemessaService` e `ConciliacaoRetornoService` têm fan-in 1 (só a rota), então split interno é isolado — janela ideal para reformar antes que jobs comecem a importar. `ConexosSispagWriteClient` tem fan-in prod=1 (`RemessaService`) mas fan-in jobs=5 — mudança de assinatura quebra 5 harnesses de validação AO VIVO.

## 3. Tactics — Cobertura no SISPAG (delta)

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| **Split Module** | `RemessaService` juntou 3 responsabilidades: (i) validar estado do lote, (ii) resolver conta pagadora + destino do favorecido, (iii) orquestrar sequência de 5 POSTs no `fin015`. O `montarItensImport` (75 LOC) já é um sub-módulo escondido. | ⚠️ parcial | `RemessaService.ts:85-364` (gerarRemessa) + `:367-441` (montarItensImport) |
| **Increase Semantic Coherence** | `LotePagamentoService` cuida das transições L1–L7 do agregado, mas L8/L9 (FINALIZADO→REMESSA_GERADA em `RemessaService`, REMESSA_GERADA→BAIXADO/RETORNADO em `ConciliacaoRetornoService`) vivem em outros arquivos. A máquina de estados está espalhada por 3 serviços. | ❌ ausente | `grep -rn "LOTE_STATUS\." src/backend/domain/service/sispag/` |
| **Encapsulate** | O ledger `RemessaExecucaoRepository` encapsula bem a intenção write-ahead; o `Handler`-like `respondLoteError` na rota encapsula a serialização de erro. Mas o mapa FEBRABAN não está encapsulado (é literal duplicado). | ⚠️ parcial | `RemessaService.ts:17`, `jobs/preflight-fin015-prd.ts:47`, `jobs/validate-fin015-import.ts:63`, `frontend/lib/sispag.ts:442` |
| **Use an Intermediary** | O `ConexosSispagWriteClient` é o intermediário para o fin015 (bom). O `SispagInterface.ts` centraliza tipos. Falta intermediário para "chave nativa do fin015" (`filCod+bncCod+flpCod+itsCodSeq`) — reconstruída em 3 lugares. | ⚠️ parcial | `RemessaService.ts:227-241`, `ConciliacaoRetornoService.ts:150-164`, `LotePagamentoRepository.ts:428-451` |
| **Restrict Dependencies** | DDD respeitado: services só chamam repos + clients + libs; rota só resolve serviços via `container`. **0 violações** cross-layer novas (a violação `routes → repo` de `PagamentoIngestaoRunRepository` é pré-existente e justificada). | ✅ presente | `grep -rn "from '.*routes/\|http/'" src/backend/domain/**/sispag/` |
| **Refactor** | O delta é código novo e já vem com 3 funções acima do teto de complexidade cognitiva (Biome). Cardápio de refactor entra dívida no dia 1. | ❌ ausente | `npx biome check src/backend/domain/service/sispag/` |
| **Abstract Common Services** | Não há "OrquestracaoErpService" genérico que unifique o padrão write-ahead + reaproveitamento de handle + fail-close usado em `RemessaService` (SISPAG) e `GerarSolicitacaoNumerarioService` (Recebimentos). O próprio comentário em `RemessaService.ts:65` reconhece o espelhamento. | ⚠️ parcial | `RemessaService.ts:63-70` ("Espelha `GerarSolicitacaoNumerarioService`") |
| **Configuration files (Defer Binding)** | Feature flags globais (`CONEXOS_WRITE_ENABLED`, `CONEXOS_DRY_RUN`) vêm do `EnvironmentProvider`. Bom. Porém: FEBRABAN e nome dos bancos, códigos de modalidade (`{CREDITO_CONTA:1, TED:1, PIX:1, BOLETO:7}`), fallback para Itaú (`?? 341`) e default modalidade (`?? 1`) são **hardcoded em código**. | ❌ ausente | `RemessaService.ts:17-26` |
| **Polymorphism (Defer Binding)** | tsyringe usado em 100% das classes do delta; DI presente. **Nenhuma** interface com múltiplas implementações — `RemessaService` está amarrado a `ConexosSispagWriteClient` concreto. Aceitável enquanto SISPAG for o único destino, mas fecha porta para "Nexxera direto" ou "outro ERP". | ⚠️ parcial | `RemessaService.ts:76-83` |
| **Plugin pattern / Runtime registration** | Não aplicado. Todo mapeamento fin015 é resolvido em tempo de código. | ❌ ausente | — |
| **Naming (Reduce Coupling by convention)** | Idiomas misturados no mesmo módulo: código em português (Portuguese identifiers proibidos por `CLAUDE.md` §Conventions/Language, mas historicamente aceito no SISPAG). Ex.: `gerarRemessa`, `conciliar`, `montarItensImport`. Isso é dívida de convenção, não semântica — deixa modificação por dev novo mais lenta se ele espera padrão inglês do resto do repo. | ⚠️ parcial | `CLAUDE.md` "Identifiers: English only" |

## 4. Findings

### F-modifiability-1: Tabela `FEBRABAN_POR_BNCCOD` duplicada em 3 lugares no backend + tabela análoga no frontend

- **Severidade**: P1
- **Tactic violada**: Abstract Common Services · Encapsulate · Configuration files (Defer Binding)
- **Localização**:
  - `src/backend/domain/service/sispag/RemessaService.ts:17` — `const FEBRABAN_POR_BNCCOD: Record<number, number> = { 3: 1, 4: 341, 7: 237, 10: 33 };`
  - `src/backend/jobs/preflight-fin015-prd.ts:47` — `const FEBRABAN: Record<number, number> = { 3: 1, 4: 341, 7: 237, 10: 33 };`
  - `src/backend/jobs/validate-fin015-import.ts:63` — mesma literal
  - `src/frontend/lib/sispag.ts:442` — `BANCO_NOME: Record<number, string>` com **os mesmos códigos 3, 4, 7, 10 + 10 outros** (6, 8, 11, 14, 15, 25, 35, 38, 39, 44) que o backend **não conhece**
- **Evidência**:
  ```
  RemessaService.ts:17         { 3: 1, 4: 341, 7: 237, 10: 33 }
  preflight-fin015-prd.ts:47   { 3: 1, 4: 341, 7: 237, 10: 33 }
  validate-fin015-import.ts:63 { 3: 1, 4: 341, 7: 237, 10: 33 }
  frontend/lib/sispag.ts:442   { 3:'BB', 4:'Itaú', 6:'Banco 6', 7:'Bradesco', 8:'Safra',
                                  10:'Santander', 11:'Banestes', 14:'Banco 14',
                                  15:'Daycoval', 25:'Vot.', 35:'Pine', 38:'Orig.',
                                  39:'Banco 39', 44:'XP' }
  ```
- **Impacto técnico**: adicionar um banco novo exige 4 edições. Se qualquer uma ficar para trás, o backend cai no fallback `?? 341` (silenciosamente sai como Itaú) e o frontend rotula `"banco N"`. O backend não conhece 10 dos 14 códigos que o frontend rotula — o operador vê o nome mas o SISPAG não sabe qual é o FEBRABAN.
- **Impacto de negócio**: pagamento sai com código de banco errado no CNAB — o banco pode rejeitar ou pagar para banco errado. Custo estimado: 1 remessa = ~R$ 50k a R$ 500k por lote (média Columbia). Um erro silencioso vira R$ debitado em conta errada + reprocessamento + desgaste com fornecedor.
- **Métrica de baseline**: 4 arquivos por mudança de banco (alvo: 1).

### F-modifiability-2: 32 jobs exploratórios versionados junto do código de produção, com 13 erros de format e 10+ funções acima do teto de complexidade

- **Severidade**: P2
- **Tactic violada**: Split Module · Restrict Dependencies · Semantic Coherence
- **Localização**: `src/backend/jobs/` (37 arquivos, 32 são probes/validators/preflights/executors/cleanups/seeds/sintetizadores). LOC total: 6473. Delta: 14 novos, ~2700 LOC.
- **Evidência**:
  ```
  jobs/probe-fin052-retorno.ts:62      complexity 88 (max: 15)
  jobs/execute-fin015-prd.ts:101       complexity 66 (max: 15)
  jobs/probe-fin064-destino.ts:42      complexity 49 (max: 15)
  jobs/probe-fin015-import.ts:67       complexity 45 (max: 15)
  jobs/probe-impacto-antecipacao.ts:43 complexity 44 (max: 15)
  jobs/preflight-fin015-prd.ts:59      complexity 35 (max: 15)
  jobs/probe-baixa-conta-financeira.ts:52 complexity 34 (max: 15)
  jobs/probe-fin015-fluxo.ts:18        complexity 25 (max: 15)
  jobs/cleanup-fin015-testes.ts:36     complexity 23 (max: 15)
  jobs/probe-fin052-hml.ts:26          complexity 18 (max: 15)
  ... e mais em jobs do delta
  → biome: 13 errors + 16 warnings + 4 infos em jobs/
  ```
- **Impacto técnico**: **argumento a favor** — cada probe/validate é história executável, provou uma hipótese ("`titulosPendentes/list` não tem destino"), e serviu de gabarito para o `RemessaService` (o comentário em `RemessaService.ts:65-73` deriva direto de HML lote 26). O `execute-fin015-prd.ts` é o único registro de como escrever no ERP com dois opt-ins. **Argumento contra**: os jobs importam tipos de produção (`ConexosSispagWriteClient`, `ContaPagadora`, `bootstrapAppContainer`) — mudança de assinatura em produção quebra 5 harnesses e ninguém compila até rodar `tsc --noEmit`. Fan-in prod=1, fan-in jobs=5 no `ConexosSispagWriteClient` é o sintoma. E 3 dos jobs duplicam `FEBRABAN_POR_BNCCOD` (F-1), então a "documentação executável" vai virar dívida se o mapa mudar.
- **Impacto de negócio**: risco de o dev tocar a assinatura do write client, os testes de produção passarem, e o job de validação AO VIVO (`validate-fin015-import.ts`) parar de compilar exatamente no dia em que precisamos dele para investigar um incidente em PRD.
- **Métrica de baseline**: 32 jobs "documentação executável" com dependência de código de produção, 0 testes que fixem sua compilação (nem estão no `include` do `jest`).

**Julgamento**: **não é lixo** — é dívida de forma. Vale extrair um `jobs/` com README + `tsconfig` próprio (`skipLibCheck: false`, mas fora da suíte de tests do backend) OU marcar quais são "arquivados/gabarito" (mover para `jobs/archive/`) vs quais são operacionais (`ingest-*`, `formar-lotes`, `seed-admin`). Como está, é ambíguo.

### F-modifiability-3: Invariantes críticas do wire ERP moram em prosa (comentários), não em código

- **Severidade**: P2
- **Tactic violada**: Semantic Coherence · Encapsulate
- **Localização**:
  - `RemessaService.ts:56-73` — "POR QUE TANTA CERIMÔNIA" + "INVARIANTES APRENDIDAS AO VIVO"
  - `RemessaService.ts:207-217` — comentário de 11 linhas explicando "reaproveitar lote nativo" (por que existe, o que aconteceu em HML, quando é seguro)
  - `RemessaService.ts:264-268` — "localizar o arquivo PELO NOME. Nunca pelo primeiro com conteúdo: o ERP recicla `flpCod`" — é uma **regra de negócio** que quebrou em produção
  - `RemessaService.ts:446-451` — mesma regra repetida em `baixarArquivo`
  - `ConciliacaoRetornoService.ts:47-63` — "COMO A LINHA CASA COM O NOSSO LOTE" (posições 74-93 do segmento A do CNAB) — spec bancário em comentário
- **Evidência** — proporção de linhas de comentário:
  ```
  RemessaService.ts        467 LOC · 65 linhas de comentário (14%)
  ConciliacaoRetornoService.ts 260 LOC · 33 linhas de comentário (13%)
  LotePagamentoRepository.ts   566 LOC · 50 linhas de comentário (9%)
  ```
- **Impacto técnico**: a regra "buscar pelo NOME, nunca pelo primeiro" está escrita em português informal em dois pontos de `RemessaService`. Um dev refatorando pode ver `arquivos.find((a) => a.nomeArquivo === sugerido.nomeArquivo)` e trocar por `arquivos[0]` "porque só tem um". A regra "chave = filCod+bncCod+flpCod+itsCodSeq no uso da empresa pos.74-93" está em `ConciliacaoRetornoService`, mas não há **teste** que quebre se alguém trocar a chave por só `flpCod` (que é o que o comentário diz que **falha** — o ERP recicla `flpCod`).
- **Impacto de negócio**: comentário erode; teste, não. A frase "foi assim que um `.REM` de outro mês foi lido (e cancelado) por engano em produção" (`RemessaService.ts:446-448`) é a memória viva de um incidente — e ela dorme em prosa.
- **Métrica de baseline**: **13-14% do LOC** dos serviços do delta é comentário explicativo, com 0 testes que exercitem os cenários narrados (o `RemessaService.test.ts` cobre feliz-path + idempotência + fail-close, mas não "arquivo com nome errado" nem "flpCod reciclado").

### F-modifiability-4: Fronteira do agregado `LotePagamento` fragmentada em 3 serviços

- **Severidade**: P1
- **Tactic violada**: Increase Semantic Coherence · Encapsulate
- **Localização**: transições do mesmo agregado espalhadas por:
  ```
  LotePagamentoService     L1 novo→RASCUNHO, L2 RASCUNHO auto, L3 RASCUNHO→FINALIZADO,
                           L4 FINALIZADO→RASCUNHO, L5 →CANCELADO, L7 FINALIZADO→RETORNADO
  RemessaService.ts:318    FINALIZADO → REMESSA_GERADA
  ConciliacaoRetornoService.ts:232-236  REMESSA_GERADA/RETORNADO → BAIXADO/RETORNADO
  ```
- **Evidência**: `grep -rn "LOTE_STATUS\." src/backend/domain/service/sispag/` mostra **16 leituras** distribuídas por 3 arquivos, cada um fazendo o próprio `transicionarStatus` com `de: [...]` e `para: ...` inline. Nenhum aggregate root policia a máquina inteira. `LotePagamentoRepository.transicionarStatus` aceita qualquer combinação `(de,para)` que o serviço mandar — o guardião das transições legais **não existe**.
- **Impacto técnico**: adicionar um estado novo (ex.: `PARCIALMENTE_BAIXADO` para cobrir baixa parcial que a Fatia 4 vai precisar) exige olhar 3 services + o `LOTE_STATUS` const + os 8 lugares de `'FINALIZADO'`/`'REMESSA_GERADA'` no FE. Impossível garantir que uma transição inválida (`RASCUNHO → BAIXADO`) nunca seja construída por engano — só o CHECK do Postgres (`migrations/0049`) prende.
- **Impacto de negócio**: cada nova regra de conciliação (ex.: "PIX rejeitado por chave inválida" é um sub-estado que o cliente pediu) vai custar ≥ 3 arquivos e um round de tabela de decisão manual. Prazo cresce linearmente com o número de estados.
- **Métrica de baseline**: 3 serviços mexem em `LOTE_STATUS`; alvo = 1 (o agregado).

### F-modifiability-5: Enum de status do lote replicado como string crua em 3 arquivos do frontend

- **Severidade**: P2
- **Tactic violada**: Encapsulate · Abstract Common Services
- **Localização**:
  - `src/frontend/app/sispag/page.tsx:225,226,239-244` (`'RASCUNHO'`, `['FINALIZADO','REMESSA_GERADA','RETORNADO','BAIXADO']`)
  - `src/frontend/app/sispag/components/LoteCard.tsx:48,54,72,104,105` (badges por status)
  - `src/frontend/lib/sispag.ts:122` (tipo unions manual)
- **Evidência**: `grep -rn "'REMESSA_GERADA'\|'BAIXADO'" src/frontend` → 4 ocorrências, todas hardcoded. O tipo `LotePagamento['status']` é uma união de strings duplicada do backend, sem fonte comum.
- **Impacto técnico**: renomear um estado exige varredura textual em 3 arquivos FE + rebuild. Adicionar um estado novo (F-4) e esquecer de mapear em `LoteCard.StatusLoteBadge` faz o badge sumir silenciosamente.
- **Impacto de negócio**: badges "de olho no boneco" do painel deixam de refletir o estado real — analista vê "aguardando" quando lote está `PARCIALMENTE_BAIXADO`.
- **Métrica de baseline**: 3 arquivos FE com strings soltas; alvo = 0 (importar de tipo compartilhado ou `lib/sispag.ts` central).

### F-modifiability-6: 3 funções acima do teto de complexidade cognitiva do Biome nos serviços do delta

- **Severidade**: P2
- **Tactic violada**: Refactor · Split Module
- **Localização**:
  - `RemessaService.gerarRemessa` (`:85`) — 279 LOC de método, acima do teto 15
  - `RemessaService.montarItensImport` (`:371`) — acima do teto 15
  - `ConciliacaoRetornoService.conciliar` (`:75`) — 143 LOC, 4 loops aninhados, acima do teto 15
- **Evidência**: `cd src/backend && npx biome check domain/service/sispag/` reporta os 3 explicitamente com regra `lint/complexity/noExcessiveCognitiveComplexity`.
- **Impacto técnico**: alterar o passo (2) "importar títulos" no `gerarRemessa` exige entender 5 blocos try/catch aninhados com 3 níveis de defer-idempotência. Testar exige mock de 4 clients + 2 repos + Logger + Environment. O `conciliar` acumula "processar → listar eventos → listar detalhe → casar → transicionar" numa função só.
- **Impacto de negócio**: bug em um dos 5 passos do `gerarRemessa` é caro de isolar (o log é misto e os 3 `await this.ledger.setEtapa` são pistas — mas em um método de 279 LOC).
- **Métrica de baseline**: 3 funções acima do teto; alvo = 0.

### F-modifiability-7: Ontology desalinhada do código no mesmo delta

- **Severidade**: P2
- **Tactic violada**: Documentation / Deferred binding via ontology
- **Localização**:
  - `ontology/state-machines/lote-pagamento.md:22` — `out_of_scope_states: [PROCESSANDO, ENVIADO, BAIXADO]`
  - `ontology/state-machines/lote-pagamento.md:36,50` — texto repete que `BAIXADO` é fora de escopo
  - `src/backend/domain/interface/sispag/SispagInterface.ts:169-183` — código adiciona **REMESSA_GERADA** e **BAIXADO** neste delta
  - `ontology/_coverage.json` — `LotePagamento.status = "planned"` (mesmo com 6 transições + 2 novas)
- **Evidência**: 2 estados novos no código, 0 linhas alteradas na ontology do lote. `_coverage.json` também não subiu para `partial`/`implemented`.
- **Impacto técnico**: quando um dev novo tentar entender o ciclo de vida via `ontology/`, vai ler que `BAIXADO` "é a Fatia 3" — e vai ficar procurando código que já existe. Retro-ontology overdue.
- **Impacto de negócio**: onboarding lento; o PatternGuardian (que checa ontology-first) não pode reprovar deltas futuros sem primeiro re-alinhar. Regis-Review perde poder porque a fonte da verdade drift-ou.
- **Métrica de baseline**: 2 estados de drift; ADR/entity/state-machine sem atualização.

### F-modifiability-8: Magic numbers em `RemessaService` (fallback silencioso para Itaú/CREDITO_CONTA)

- **Severidade**: P3
- **Tactic violada**: Configuration files (Defer Binding)
- **Localização**:
  - `RemessaService.ts:171` — `bncNumCodbanco: FEBRABAN_POR_BNCCOD[bncCod] ?? 341`
  - `RemessaService.ts:378` — `const febraban = FEBRABAN_POR_BNCCOD[bncCod] ?? 341;`
  - `RemessaService.ts:414` — `itsVldModalidade: MODALIDADE_NATIVA[item.modalidade ?? 'CREDITO_CONTA'] ?? 1`
  - `RemessaService.ts:26` — `BOLETO: 7` (modalidade nativa fin015 hardcoded)
- **Evidência**: 3 fallbacks silenciosos e 1 tabela literal de códigos ERP no código.
- **Impacto técnico**: se `bncCod=99` chegar amanhã (banco novo no ERP), o pagamento sai com `bncNumCodbanco=341` (Itaú) mesmo que a conta seja Bradesco. Falha silenciosa.
- **Impacto de negócio**: bank rejection ou pagamento para banco errado. Já coberto no F-1 (mesmo problema pela ótica da duplicação; aqui pela ótica do fallback).
- **Métrica de baseline**: 3 fallbacks silenciosos; alvo = 0 (validar contra tabela; falhar explícito).

### F-modifiability-9: Import não utilizado (`randomUUID`) sinalizando lint bypass ou refactor incompleto

- **Severidade**: P3
- **Tactic violada**: Refactor (housekeeping)
- **Localização**: `src/backend/domain/service/sispag/RemessaService.ts:1` — `import { randomUUID } from 'node:crypto';` (usado em zero lugares)
- **Evidência**: `grep -n "randomUUID" RemessaService.ts` → só a linha do import.
- **Impacto técnico**: o import passou pelo `_shared-metrics.md` que diz "biome: aplicado em todos os arquivos do delta", **mas** `npx biome check` reporta esse import como erro AGORA. Ou o biome não foi rodado, ou foi rodado com escopo restrito.
- **Impacto de negócio**: pouco — mas sugere que o gate de lint escapou. Se escapou aqui, escapou em outros lugares (13 errors em jobs).
- **Métrica de baseline**: 1 import morto; 9 errors totais no `biome check` da pasta do delta.

## 5. Cards Kanban

### [modifiability-1] Centralizar a tabela `bncCod → FEBRABAN → nome` em um único módulo compartilhado FE+BE

- **Problema**
  > O mapa `{3:1, 4:341, 7:237, 10:33}` está literal em 3 arquivos backend (RemessaService, preflight-fin015-prd, validate-fin015-import) e a tabela de nomes (14 códigos, superset) está no `frontend/lib/sispag.ts`. Trocar/adicionar banco exige 4 edições e o backend cai silenciosamente para `?? 341` (Itaú) se faltar entrada. O frontend rotula códigos que o backend nem conhece.
- **Melhoria Proposta**
  > Extrair para uma tabela canônica `src/shared/bancos.ts` (novo módulo) OU para uma migration + `banco_codigo` no Postgres alimentando um `BancoRepository`. Adotar tactic **Abstract Common Services**: `RemessaService`, jobs e `frontend/lib/sispag.ts` importam do lugar único. Remover fallback `?? 341` — trocar por `throw new BancoNaoMapeadoError({ bncCod })` (fail-close, como o restante do serviço).
- **Resultado Esperado**
  > Adicionar banco novo = editar **1 arquivo** (ou 1 linha de migration). Pagamento nunca sai com código de banco errado por falta de mapeamento.
- **Tactic alvo**: Abstract Common Services · Encapsulate · Configuration files
- **Severidade**: P1
- **Esforço estimado**: M (2–3d)
- **Findings relacionados**: F-modifiability-1, F-modifiability-8
- **Métricas de sucesso**:
  - Arquivos por mudança de banco: 4 → 1
  - Fallbacks silenciosos (`?? 341`): 2 → 0
  - Códigos rotulados no FE que o BE não conhece: 10 → 0
- **Risco de não fazer**: pagamento debitado com código FEBRABAN errado em 6 meses (cliente vai contratar Bradesco/BB para outras filiais — trigger direto).
- **Dependências**: nenhuma.

### [modifiability-2] Unificar a máquina de estados do agregado `LotePagamento` em um único guardião

- **Problema**
  > `LotePagamentoService`, `RemessaService` e `ConciliacaoRetornoService` decidem transições do mesmo agregado (16 leituras de `LOTE_STATUS.*` espalhadas). O repositório `transicionarStatus` aceita qualquer `(de, para)` — o único guardião real de transições legais é o CHECK do Postgres. Adicionar `PARCIALMENTE_BAIXADO` (Fatia 4 previsível) vai tocar ≥ 3 services + 5 lugares no FE.
- **Melhoria Proposta**
  > Criar um `LotePagamentoStateMachine` (classe injetável) que centralize a matriz `{ [from]: [to...] }` e seja o único chamador de `LotePagamentoRepository.transicionarStatus`. `RemessaService.settle()` e `ConciliacaoRetornoService.transicionarLote()` passam a delegar. Tactic **Increase Semantic Coherence**. Alternativa: mover a lógica de status para dentro de `LotePagamentoService.transicionar` (já existe) e `RemessaService`/`ConciliacaoRetornoService` só chamam esse método.
- **Resultado Esperado**
  > Adicionar estado novo = editar **2 arquivos** (interface + state-machine); services de escrita não precisam saber da matriz.
- **Tactic alvo**: Increase Semantic Coherence · Encapsulate
- **Severidade**: P1
- **Esforço estimado**: M (3–5d)
- **Findings relacionados**: F-modifiability-4, F-modifiability-5, F-modifiability-7
- **Métricas de sucesso**:
  - Serviços que escrevem em `LOTE_STATUS`: 3 → 1
  - Arquivos por novo estado: 5+ → 2
  - Transições ilegais possíveis em tempo de compilação: N (não-medível hoje) → 0
- **Risco de não fazer**: cada nova regra de conciliação (baixa parcial, PIX rejeitado com chave inválida, estorno) vira delta cirúrgico em 3 serviços + FE — cresce linearmente.
- **Dependências**: modifiability-3 (para o FE aproveitar).

### [modifiability-3] Enum de status compartilhado entre backend e frontend

- **Problema**
  > `page.tsx`, `LoteCard.tsx` e `lib/sispag.ts` comparam status contra literais (`'REMESSA_GERADA'`, `'BAIXADO'`, etc.) hardcoded em 4 lugares. Renomear um estado ou adicionar `PARCIALMENTE_BAIXADO` exige varredura textual.
- **Melhoria Proposta**
  > Exportar `LOTE_STATUS` do `src/backend/domain/interface/sispag/SispagInterface.ts` (ou de um `src/shared/sispag-types.ts` novo) e importar no `frontend/lib/sispag.ts` como fonte única. FE compara sempre `l.status === LOTE_STATUS.REMESSA_GERADA`. Tactic **Encapsulate**.
- **Resultado Esperado**
  > 0 strings soltas de status no FE. Compilador do TypeScript reprova estado inexistente.
- **Tactic alvo**: Encapsulate
- **Severidade**: P2
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-modifiability-5
- **Métricas de sucesso**:
  - `grep -c "'REMESSA_GERADA'" src/frontend`: 4 → 0
  - Erros em compile-time por status inexistente: N/A → detectável
- **Risco de não fazer**: badge `LoteCard.StatusLoteBadge` some silenciosamente para status novo — analista lê estado errado.
- **Dependências**: nenhuma (mecânica pura).

### [modifiability-4] Extrair testes que fixem as invariantes hoje descritas em prosa nos serviços do delta

- **Problema**
  > `RemessaService.ts` tem 14% de comentário (65 linhas) explicando "reciclagem de `flpCod`", "buscar arquivo pelo NOME", "identidade VERBATIM", "cross-filial nunca concilia". `ConciliacaoRetornoService.ts` tem 13% explicando a chave `filCod+bncCod+flpCod+itsCodSeq` no segmento A. O `RemessaService.test.ts` cobre feliz-path e idempotência, mas não os cenários descritos (arquivo com nome errado, `flpCod` reciclado, item cross-filial).
- **Melhoria Proposta**
  > Adicionar 4 testes canônicos (um por invariante narrada): (1) `listarArquivosRemessa` devolve 2 arquivos com o mesmo `flpCod`, `RemessaService` escolhe o `nomeArquivo` correto; (2) `pendente.raw.filCod !== lote.filCod` lança `Error('cross-filial nunca concilia')`; (3) chave nativa lida do `.RET` com `flpCod` reciclado não vira `findByChaveNativa` matched por outro lote antigo; (4) `.RET` com `flpCod` de lote de outro mês NÃO fecha um lote novo por acidente. Tactic **Refactor** (testes viram a spec executável que hoje é prosa).
- **Resultado Esperado**
  > Regra crítica que quebrou em produção (`nomeArquivo` reciclado) fica congelada em teste — refactor futuro que trocar `.find` por `[0]` reprova antes do CI.
- **Tactic alvo**: Refactor · Semantic Coherence
- **Severidade**: P2
- **Esforço estimado**: M (2–3d)
- **Findings relacionados**: F-modifiability-3, F-modifiability-6
- **Métricas de sucesso**:
  - Cenários descritos em prosa nos comentários com teste correspondente: 0/6 → 6/6
  - Densidade de comentário em `RemessaService`: 14% → ≤ 8% (comentário sobra só onde teste não consegue explicar)
- **Risco de não fazer**: incidente "REM de outro mês lido por engano" pode se repetir. Comentário erode; teste não.
- **Dependências**: nenhuma.

### [modifiability-5] Refatorar `RemessaService.gerarRemessa` e `ConciliacaoRetornoService.conciliar` em passos nomeados

- **Problema**
  > Biome reporta 3 funções acima do teto de complexidade cognitiva 15 nos serviços novos do delta: `gerarRemessa` (linha 85), `montarItensImport` (linha 371) e `conciliar` (linha 75). `gerarRemessa` tem 5 passos ERP em um try/catch de ~150 LOC.
- **Melhoria Proposta**
  > Extrair passos nomeados como métodos privados: `gerarRemessa` → `[resolverContaPagadora, criarOuReaproveitarLoteNativo, importarItens, finalizarLoteNativo, gerarRemessaNativa, localizarArquivoGerado]`; `conciliar` → `[processarSeAplicavel, listarLinhas, casarComLoteLocal, transicionarLotesAfetados]`. Tactic **Split Module** aplicado no nível de método. Cada passo fica testável isoladamente (contorna F-modifiability-4).
- **Resultado Esperado**
  > Nenhuma função sinalizada pelo Biome; refactor futuro em um passo isolado (ex.: mudar `sugerirRemessa` para outro endpoint) não força reler 200 LOC.
- **Tactic alvo**: Split Module · Refactor
- **Severidade**: P2
- **Esforço estimado**: M (2d)
- **Findings relacionados**: F-modifiability-6
- **Métricas de sucesso**:
  - Funções acima de complexidade cognitiva 15 nos serviços do delta: 3 → 0
  - LOC do método `gerarRemessa`: ~279 → ≤ 60 (só orquestração)
- **Risco de não fazer**: bug em produção → tempo até isolar cresce (log misto em método longo).
- **Dependências**: modifiability-4 seria consumidor natural.

### [modifiability-6] Higienizar `src/backend/jobs/` — separar operacional de exploratório

- **Problema**
  > 32 dos 37 jobs são probes/validators/preflights/executors — código exploratório versionado junto do operacional (`ingest-*`, `formar-lotes`, `seed-admin`). Importam tipos de produção (fan-in jobs=5 em `ConexosSispagWriteClient`), 13 errors de biome, 10+ funções acima do teto de complexidade. 3 deles duplicam `FEBRABAN_POR_BNCCOD` (F-1).
- **Melhoria Proposta**
  > (a) Mover exploratórios para `src/backend/jobs/archive/` (ou `jobs/probes/`, `jobs/validate/`, `jobs/preflight/`) com `README.md` por diretório explicando propósito. (b) Excluir `jobs/archive/` do `npx biome check` do delta (nova entrada em `biome.json`), mas manter typecheck para que quebra de contrato acuse. (c) Adotar tactic **Restrict Dependencies**: exploratórios importam via `import type` sempre que possível, para desacoplar de refactors internos. (d) Retire imediatamente do repo os que provaram sua tese e viraram documentação estática — mova o conteúdo relevante para `ontology/_inbox/sispag-*.md` (que já existem) ou para um teste read-only em `test/e2e/sispag/`.
- **Resultado Esperado**
  > Diretório `jobs/` volta a significar "código operacional que roda em produção" (ingest, seed, formar-lotes). Os probes ficam claramente marcados como gabaritos históricos, mas continuam compiláveis. `npx biome check` no delta passa a ser gate confiável.
- **Tactic alvo**: Split Module · Restrict Dependencies · Semantic Coherence
- **Severidade**: P2
- **Esforço estimado**: M (2–4d — categorização precisa de olho humano)
- **Findings relacionados**: F-modifiability-2, F-modifiability-9
- **Métricas de sucesso**:
  - Jobs operacionais em `jobs/` (raiz): 32 → 5
  - Biome errors em `jobs/`: 13 → 0 (nos operacionais)
  - Duplicações de FEBRABAN em `jobs/`: 2 → 0 (junto de modifiability-1)
- **Risco de não fazer**: no dia do próximo incidente PRD alguém vai rodar `validate-fin015-import.ts` e ele não vai compilar porque a assinatura do `criarLote` mudou faz 3 semanas.
- **Dependências**: modifiability-1 (para os jobs deixarem de duplicar FEBRABAN).

### [modifiability-7] Atualizar `ontology/state-machines/lote-pagamento.md`, `ontology/entities/lote-pagamento.md` e `ontology/_coverage.json` para refletir os estados novos

- **Problema**
  > Ontology declara `RASCUNHO, FINALIZADO, RETORNADO, CANCELADO` + `out_of_scope_states: [PROCESSANDO, ENVIADO, BAIXADO]`. Código deste delta adiciona `REMESSA_GERADA` e `BAIXADO`. `_coverage.json` continua marcando `LotePagamento` como `planned`. Retro-ontology overdue no mesmo dia do delta.
- **Melhoria Proposta**
  > Adicionar `REMESSA_GERADA` e `BAIXADO` à tabela de estados e transições (L8, L9) em `state-machines/lote-pagamento.md`. Escrever ADR curto justificando a promoção. Subir `LotePagamento.status` para `partial` (ou `implemented` se a spec completa passar). Tactic **Deferred binding via documentation** — ontology deve ser fonte confiável para o próximo delta.
- **Resultado Esperado**
  > PatternGuardian volta a ter chão para reprovar deltas futuros que criem estados sem passar pela ontology.
- **Tactic alvo**: Documentation / Deferred binding
- **Severidade**: P2
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-modifiability-7
- **Métricas de sucesso**:
  - Estados no código sem contrapartida na ontology: 2 → 0
  - `_coverage.json.LotePagamento.status`: `planned` → `partial` (ou `implemented`)
- **Risco de não fazer**: cada `/feature-tweak` seguinte vai ter que reler o código para saber a verdade — ontology perde valor.
- **Dependências**: modifiability-2 (a máquina de estados unificada é a fonte natural do diagrama atualizado).

### [modifiability-8] Introduzir `ContratoFin015` como intermediário para o cliente escrever no ERP

- **Problema**
  > `RemessaService` orquestra 5 chamadas em `ConexosSispagWriteClient` (criarLote → importarTitulos → finalizarLote → sugerirRemessa → gerarRemessa → listarArquivosRemessa) com invariantes específicas do fin015 embutidas no código do service (identidade VERBATIM do grid de pendentes, `filCodLote`, `itsVldModalidade`). Amanhã, se o cliente contratar "Nexxera direto" ou trocar o SISPAG por outra ferramenta do Conexos, o `RemessaService` inteiro precisa ser reescrito. Fan-in prod=1 hoje (janela ideal).
- **Melhoria Proposta**
  > Extrair um `ContratoFin015` (interface) com métodos de alto nível (`iniciarRemessa`, `importarLoteCompleto`, `emitirArquivo`) e uma implementação `Fin015NativoContrato` que encapsula a sequência de 5 POSTs + o parser da resposta. `RemessaService` passa a depender da interface. Tactic **Use an Intermediary** + **Polymorphism**. Habilita substituição futura sem tocar o serviço.
- **Resultado Esperado**
  > Trocar destino de escrita (fin015 → Nexxera direto → outro ERP) exige nova implementação da interface, 0 mudança em `RemessaService`.
- **Tactic alvo**: Use an Intermediary · Polymorphism
- **Severidade**: P3 (não urgente enquanto SISPAG for único destino; ganho de opção)
- **Esforço estimado**: L (1sem)
- **Findings relacionados**: F-modifiability-4
- **Métricas de sucesso**:
  - Interfaces de escrita ERP com múltiplas implementações: 0 → 1
  - LOC de `RemessaService` acoplado a `fin015` (`titulosPendentes`, `finalizarLote`, `sugerirRemessa`): ~80 → 0
- **Risco de não fazer**: se o cliente decidir trocar de plataforma de transmissão bancária (algo comentado em `ontology/_inbox/sispag-native-vs-nexxera.md`), a reescrita do `RemessaService` custa 1–2 semanas.
- **Dependências**: modifiability-2 (o agregado precisa estar sob controle único primeiro).

## 6. Notas do agente

- Escopo do review foi restrito à frente SISPAG (código do delta do PR #60), como pedido. Não avaliei módulos legados (Permutas, Recebimentos, Fechamentos) mesmo quando notei acoplamento óbvio (ex.: `CONEXOS_DRY_RUN` é flag global — impacto discutido em cross-QA link abaixo).
- **Cross-QA link — Testability**: F-modifiability-3 (regras em prosa) e F-modifiability-6 (funções acima do teto) explicitamente entram no radar de Testability. Métodos de 279 LOC + 5 dependências mockadas + regras narradas em comentário = função difícil de testar = função difícil de mudar. Sinalizar ao consolidator.
- **Cross-QA link — Integrability**: F-modifiability-1 (FEBRABAN duplicado) e F-modifiability-8 (`ContratoFin015`) tocam a fronteira ERP — encapsulate + intermediary reduzem custo de integrar com nova plataforma bancária. Se Integrability apontar "fin015 é ponto único de falha", os cards `modifiability-1` e `modifiability-8` são as respostas naturais.
- **Cross-QA link — Deployability**: F-modifiability-8 (magic numbers/fallbacks silenciosos) é um caso onde config externalizada evita **cada mudança = novo deploy**. Como o deploy é Render (sem tenants) e o `EnvironmentProvider` já existe, migrar `FEBRABAN`/`MODALIDADE_NATIVA` para SSM ou tabela Postgres é mudança mecânica de baixo risco.
- **Sobre os 14 jobs (pergunta 2 do briefing)** — meu julgamento: **dívida disfarçada de documentação**. O valor histórico existe (o `probe-fin015-import.ts` provou o modelo do que virou `RemessaService.montarItensImport`), mas o custo de mantê-los junto do código de produção — sem gate de lint, com fan-in de 5 em client de produção, com duplicação de FEBRABAN — é maior do que o benefício. `modifiability-6` propõe a separação sem descartar (mover para `jobs/archive/` OU `jobs/probes/` com README).
