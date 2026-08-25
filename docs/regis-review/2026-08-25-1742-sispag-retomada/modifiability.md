---
qa: Modifiability
qa_slug: modifiability
run_id: 2026-08-25-1742-sispag-retomada
agent: qa-modifiability
generated_at: 2026-08-25T18:20:00-03:00
scope: backend+frontend
score: 4.5
findings_count: 7
cards_count: 6
---

# Modifiability — Regis-Review

## 1. Cenário Geral (Bass General Scenario aplicado ao delta de retomada)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Analista financeira / dev de produto | Mudança recorrente **e previsível** no domínio de retomada: (a) **quinto estado observável** no `fin015` (ex.: `flpVldStatus=4` "em análise") — hoje só 0/1/2/3 são conhecidos; (b) **novo banco** (Bradesco/Santander) com outro `bncCod`; (c) mudança na regra de "adotar por marca d'água" (ex.: passar a exigir também `bncCod` na assinatura); (d) mudar a chave do item (ex.: passar a incluir `titTipCod` — foi assim que a chave sem filial explodiu); (e) trocar a política de janela de retry ou o fail-closed. | `RemessaService.gerarRemessa` (870 LOC, complexidade cognitiva **70**), `sincronizarComErp` + `adotarPorMarcaDagua` + `pular(etapa)` (máquina de estados implícita em ifs), 8 sites que constroem `${filCod}:${docCod}:${titCod}` como template string em 5 arquivos, `FEBRABAN_POR_BNCCOD` duplicado em 5 lugares (o delta ADICIONOU o 5º), `page.tsx` (1026 LOC, 23 hooks, 12 handlers no mesmo componente). | Feature verde AO VIVO (3 cenários de retomada + caminho normal com 2 itens). Perna de VOLTA (`.RET` real) ainda não exercitada AO VIVO. | Alteração cabe em **≤ 2 arquivos de produção** e **1 lugar canônico por conceito** (tabela FEBRABAN, chave do item, estado observado no ERP). Nenhuma dessas mudanças deveria tocar `gerarRemessa`. | ≤ 2 arquivos por novo banco (hoje: **6** — 1 service + 4 jobs + 1 mapa de nomes no FE); adicionar um estado observado do fin015 = **1 arquivo** (hoje: 3 branches em `sincronizarComErp` + 1 em `adotarPorMarcaDagua`); mudar a chave do item = **1 arquivo** (hoje: **5** arquivos, 8 sites de template string). |

Cenário aplicado — **"chegou o Bradesco (bncCod=7) na conta pagadora e o `fin015` passou a devolver `flpVldStatus=4` para lote 'em análise antifraude'"**: a entrada FEBRABAN precisa ser garantida em `RemessaService.ts:19`, `jobs/preflight-fin015-prd.ts:47`, `jobs/validate-fin015-import.ts:63`, `jobs/execute-fin015-prd.ts:61`, `jobs/validate-retomada-remessa-v1.ts:105` e `frontend/lib/sispag.ts:479` (`BANCO_NOME`) — **6 arquivos**, e o fallback `?? 341` (Itaú) engoliria silenciosamente qualquer omissão. O novo estado `4` obriga a decidir em `sincronizarComErp` (ramos `estado.status === 2 || estado.status === 3` e `estado.status === 1` em `RemessaService.ts:562–599`) mais o filtro `l.status === 0` de `adotarPorMarcaDagua:706–711` — cada esquecimento é um pagamento potencialmente duplicado.

Cenário sósia — **"a chave do item precisa incluir `titTipCod` para separar título parcial de original"**: hoje isso obriga tocar `RemessaService.ts:635, 761, 774`, `ConexosSispagWriteClient.ts:283, 359`, `LotePagamentoService.ts:386`, `SispagPainelService.ts:92,94` e `frontend/app/sispag/page.tsx:64`. 8 sites em 5 arquivos; um esquecimento repete o incidente que este próprio delta veio corrigir ("chave sem filial importava pagamento de outro fornecedor").

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Cognitive complexity — `RemessaService.gerarRemessa` | **70** | ≤ 15 (teto do Biome) | ❌ | `cd src/backend && npx biome lint domain/service/sispag/RemessaService.ts` |
| Cognitive complexity — `RemessaService.montarItensImport` | **22** | ≤ 15 | ❌ | idem |
| Cognitive complexity — `ConciliacaoRetornoService.conciliar` | **37** | ≤ 15 | ❌ | `npx biome lint domain/service/sispag/ConciliacaoRetornoService.ts` |
| Cognitive complexity — `ConciliacaoRetornoService` bloco linha 287 (loop principal `for` + `withTransaction`) | **63** | ≤ 15 | ❌ | idem |
| Cognitive complexity — `jobs/validate-retomada-remessa-v1.ts` (main) | **55** | ≤ 15 | ❌ | `npx biome lint jobs/validate-retomada-remessa-v1.ts` |
| LOC — `RemessaService.ts` | **870** (era 467 no review anterior; **+403, +86 %**) | ≤ 400 | ❌ | `wc -l src/backend/domain/service/sispag/RemessaService.ts` |
| LOC — `ConciliacaoRetornoService.ts` | **455** (era 260; +195, +75 %) | ≤ 400 | ⚠️ | `wc -l ConciliacaoRetornoService.ts` |
| LOC — `frontend/app/sispag/page.tsx` | **1026** (era 930; +96, +10 %) | ≤ 400 | ❌ | `wc -l src/frontend/app/sispag/page.tsx` |
| LOC — `frontend/lib/sispag.ts` | **587** (era 550; +37) | ≤ 400 | ❌ | `wc -l src/frontend/lib/sispag.ts` |
| LOC — `LotePagamentoRepository.ts` | **566** (pré-existente) | ≤ 400 | ❌ | `wc -l LotePagamentoRepository.ts` |
| LOC — `routes/sispag.ts` | **545** (+73 no delta agregado) | ≤ 300 | ❌ | `wc -l routes/sispag.ts` |
| Duplicação de `FEBRABAN_POR_BNCCOD` (mesma tabela literal `{3:1, 4:341, 7:237, 10:33}`) | **5 lugares** — `RemessaService.ts:19` + `jobs/preflight-fin015-prd.ts:47` + `jobs/validate-fin015-import.ts:63` + `jobs/execute-fin015-prd.ts:61` + `jobs/validate-retomada-remessa-v1.ts:105` (**este último é do delta atual**); + 1 tabela `BANCO_NOME` no `frontend/lib/sispag.ts:479` | 1 lugar canônico | ❌ (piorou) | `grep -rn "3: 1, 4: 341" src/` |
| Construção da chave `${filCod}:${docCod}:${titCod}` como template string | **8 sites** em 5 arquivos: `RemessaService.ts:635, 761, 774`; `ConexosSispagWriteClient.ts:283, 359`; `LotePagamentoService.ts:386`; `SispagPainelService.ts:92, 94`; `frontend/app/sispag/page.tsx:64` (`keyOf`) | 1 função + 1 tipo compartilhado (FE+BE) | ❌ | `grep -rEn '[$]\{[^}]*docCod[^}]*\}:[$]\{[^}]*titCod[^}]*\}' src/` |
| Máquina de estados de retomada expressa em `if`/`switch` implícitos | **6 branches** em `sincronizarComErp` (lote inexistente, cancelado 2, cancelado 3, finalizado c/ arquivo, finalizado s/ arquivo, aberto vazio, aberto parcial, aberto completo, aberto com intruso) + **3 saídas** em `adotarPorMarcaDagua` (nenhum candidato, um só, múltiplos) + `pular(etapa)` comparando índices de array | 1 tabela declarativa ou máquina de estados nomeada — a ontologia (`retomada-remessa-sispag.md`) já é declarativa; o código não | ❌ | `RemessaService.ts:497–722` |
| Enum `LOTE_STATUS` importado no FE | 0 (o FE tem `LotePagamentoStatus` só como `type` em `frontend/lib/sispag.ts:127`, mas o backend declara a fonte em `SispagInterface.ts:176`) | 1 fonte compartilhada FE+BE | ⚠️ | `grep -rn "LOTE_STATUS" src/frontend/` |
| `useState` em `app/sispag/page.tsx:SispagPanel` | **14** (era 15 no review anterior — desceu 1, mas com componente inflado) | ≤ 6 (extrair reducer ou hooks compostos) | ❌ | `grep -c "React.useState" src/frontend/app/sispag/page.tsx` |
| Total de `React.useState/useEffect/useCallback/useMemo/useRef` em `page.tsx` | **23** hooks + **12** handlers async internos ao mesmo componente | ≤ 10 combinados | ❌ | `grep -c "React.use" page.tsx` |
| Handlers async coabitando o mesmo componente (`SispagPanel`) | 12: `ingerir`, `formar`, `carregar`, `recarregarLotes`, `carregarRuns`, `abrirIngestao`, `toggle`, `criarLoteComSelecionados`, `acaoLote`, `conciliar`, `carregarRetornos`, mais o `useEffect` inicial | ≤ 3 (o resto em hooks/services do FE) | ❌ | `grep -nE "^  const .* = async" page.tsx` |
| Fan-out — imports em `RemessaService.ts` | **16** imports (era 14 no review anterior) | ≤ 12 | ❌ | `grep -c '^import ' RemessaService.ts` |
| Fan-out — imports em `ConciliacaoRetornoService.ts` | **12** imports | ≤ 12 | ⚠️ | `grep -c '^import ' ConciliacaoRetornoService.ts` |
| Métodos privados de `RemessaService` | 4 (`sincronizarComErp`, `adotarPorMarcaDagua`, `nomeArquivoDoLedger`, `montarItensImport`, `hojeUtc`) — mas `gerarRemessa` tem 4 escritas + 5 pontos de decisão inline, sem extração | ≥ 8 (uma por etapa canônica: `resolverContaPagadora`, `criarOuReaproveitarLoteNativo`, `importarItens`, `finalizarLoteNativo`, `sugerirEGerarRemessa`, `localizarArquivoGerado`, `settle`, `retomarSeNecessario`) | ❌ | `grep -c "private " RemessaService.ts` |
| Magic numbers em `RemessaService` (fallbacks silenciosos) | `FEBRABAN_POR_BNCCOD[bncCod] ?? 341` (2×), `MODALIDADE_NATIVA[...] ?? 1` — se `bncCod` sair da tabela, o pagamento vai como Itaú **sem log** | 0 fallbacks silenciosos em regra monetária; `throw` explícito | ⚠️ | `RemessaService.ts:267, 776, 811` |
| Densidade de comentários — `RemessaService.ts` | ~180 linhas de comentário em 870 LOC ≈ **21 %** (invariantes críticas dormem em prosa: "flpCod não é monotônico", "chave inclui filial", "buscar arquivo pelo NOME", "recomeça do zero zera o flpCod") | invariante crítica = teste nomeado, não parágrafo | ⚠️ | `grep -cE "^\s*(//|\*)" RemessaService.ts` |
| Cross-layer violations (novas no delta) | 0 (routes → services, services → repo/client, DDD respeitado) | 0 | ✅ | `grep -rn "from '../..*routes/'" src/backend/domain/` |
| Testes das novas rotas de retomada | `RemessaService.test.ts` cresceu de 828 LOC → 828 LOC (298 linhas adicionadas). Suíte inteira do backend verde. | ≥ 1 teste por invariante crítica ("flpCod não monotônico", "chave inclui filial", "adotar exige único candidato", "cancelado exige confirmarNovoLote") | ✅ | `_shared-metrics.md` |
| Cards herdados do review 2026-08-24 remediados neste delta | 0 de 7 (`modifiability-1`..`modifiability-7`) — FEBRABAN duplicou de novo, máquina de estados fragmentada só cresceu | ≥ 2 remediados por sprint | ❌ | `docs/regis-review/2026-08-24-1830-sispag-remessa-retorno/modifiability.md` |

### Apêndice A — Top-10 arquivos SISPAG por LOC (não-teste, com delta desta feature)

| # | Arquivo | LOC | Δ vs. review anterior |
|---|---|---|---|
| 1 | `src/frontend/app/sispag/page.tsx` | 1026 | +96 (era 930) |
| 2 | `src/backend/domain/service/sispag/RemessaService.ts` | **870** | **+403 (era 467)** |
| 3 | `src/backend/domain/client/ConexosSispagWriteClient.ts` | 629 | +233 (era 396) |
| 4 | `src/frontend/lib/sispag.ts` | 587 | +37 (era 550) |
| 5 | `src/backend/domain/repository/sispag/LotePagamentoRepository.ts` | 566 | 0 (pré-existente) |
| 6 | `src/backend/routes/sispag.ts` | 545 | +73 (era 472) |
| 7 | `src/frontend/app/sispag/components/LoteCard.tsx` | 499 | +2 (estável) |
| 8 | `src/backend/jobs/validate-retomada-remessa-v1.ts` | 473 | +473 (**novo, do delta**) |
| 9 | `src/backend/domain/service/sispag/ConciliacaoRetornoService.ts` | 455 | +195 (era 260) |
| 10 | `src/backend/domain/client/ConexosSispagClient.ts` | 419 | +13 (era 406) |

Fora do top-10 mas relevantes: `ConexosSispagRetornoClient.ts` (401), `LotePagamentoService.ts` (405), `SispagPainelService.ts` (356), novos jobs do delta `probe-imp021-modalidade` (87), `probe-impacto-recebimentos-kpis` (241), `probe-impacto-sispag-volume` (104), `probe-impacto-narrativa` (134).

### Apêndice B — Fan-in por módulo SISPAG (não-teste, escopo do delta)

| # | Módulo | Fan-in prod | Fan-in jobs | Chamadores prod |
|---|---|---|---|---|
| 1 | `SispagInterface.ts` (LOTE_STATUS, tipos) | 8+ | 5+ | todos services + routes + jobs |
| 2 | `LotePagamentoRepository` | 5 | 0 | LotePagamentoService, FormacaoLotesService, SispagPainelService, **RemessaService**, **ConciliacaoRetornoService** |
| 3 | `ConexosSispagClient` (read) | 4 | 0 | IngestaoPagamentosService, LotePagamentoService, RemessaService, SispagPainelService |
| 4 | `ConexosSispagWriteClient` | 1 | 5 | **RemessaService** + jobs (execute-fin015-prd, validate-fin015-import, validate-retomada-remessa-v1, sintetizar-ret-fin052, probe-fin015-import) |
| 5 | `ConexosSispagRetornoClient` | 2 | 3 | **ConciliacaoRetornoService**, SispagPainelService + jobs |
| 6 | `RemessaExecucaoRepository` | 1 | 0 | RemessaService |
| 7 | `ConciliacaoExecucaoRepository` | 1 | 0 | ConciliacaoRetornoService |
| 8 | `RemessaService` | 1 | 0 | `routes/sispag.ts` |
| 9 | `ConciliacaoRetornoService` | 1 | 0 | `routes/sispag.ts` |
| 10 | `LotePagamentoService` | 1 | 0 | `routes/sispag.ts` |

Leitura: `ConexosSispagWriteClient` continua com fan-in de jobs=5 (o mais crítico do delta) — o `validate-retomada-remessa-v1.ts` acabou de entrar. Mudar assinatura desse cliente quebra **5 harnesses de validação AO VIVO** simultaneamente. `RemessaService`/`ConciliacaoRetornoService` mantêm fan-in prod=1 — janela ideal para reformar internamente antes que jobs comecem a resolvê-los via `container`.

## 3. Tactics — Cobertura no delta

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| **Split Module** | `gerarRemessa` acumulou 5 responsabilidades num único método de 279 linhas: idempotência, sincronização com ERP, dry-run, escrita 4-passos, settle. Complexidade cognitiva **70** (max 15) — **4,7× o teto**. Nenhuma extração feita neste delta. | ❌ ausente | `RemessaService.ts:102–498`; Biome |
| **Increase Semantic Coherence** | `RemessaService` mistura hoje 3 conceitos: (1) orquestração da sequência fin015, (2) máquina de retomada (`sincronizarComErp`+`adotarPorMarcaDagua`), (3) montagem de item (`montarItensImport` que também bate no `cmn025` do favorecido). São 3 concerns diferentes no mesmo arquivo. | ❌ ausente | `RemessaService.ts:497–722` (retomada), `753–825` (montagem) |
| **Encapsulate** | O ledger encapsula bem write-ahead; `nomeArquivoDoLedger` encapsula acesso ao payload. **Mas** a chave `filCod:docCod:titCod` NÃO está encapsulada — é template string em 8 sites; e o mapa FEBRABAN não está encapsulado (é literal duplicado 5×). | ⚠️ parcial | `RemessaService.ts:19, 635, 761, 774`; `LotePagamentoService.ts:386`; `ConexosSispagWriteClient.ts:283, 359`; `frontend/app/sispag/page.tsx:64` |
| **Use an Intermediary** | `ConexosSispagWriteClient` é intermediário para o fin015 (bom). **Falta** intermediário para (a) a chave `TituloKey = {filCod, docCod, titCod}` (tipo + `equals` + `serialize`) e (b) o `EstadoErpDoLote` — hoje o `sincronizarComErp` mistura leitura + decisão de retomada. | ⚠️ parcial | `RemessaService.ts:497–648` |
| **Restrict Dependencies** | DDD respeitado no delta: services só chamam repo + client + libs; rota só resolve services via `container`. 0 novas violações cross-layer. | ✅ presente | `grep -rn "from '.*routes/'" src/backend/domain/` |
| **Refactor** | Não houve extração no delta: `gerarRemessa` cresceu de ~217 para 396 LOC absorvendo a máquina de retomada inline. Biome aponta 5 funções acima do teto no escopo. | ❌ ausente | `npx biome lint domain/service/sispag/ jobs/validate-retomada-remessa-v1.ts` |
| **Abstract Common Services** | Não há `ErpRetomadaEngine` genérica que capture o padrão "consultar estado real → decidir etapa → pular passos com evidência". O comentário em `ConciliacaoRetornoService.ts:198` explicitamente diz "aqui a retomada é mais simples que a da remessa" — reconhece o espelhamento mas não abstrai. | ❌ ausente | `RemessaService.ts:497` vs `ConciliacaoRetornoService.ts:145–200` |
| **Configuration files (Defer Binding)** | Feature flags (`sispagLiveWriteEnabled`, `conexosDryRun`, `conexosWriteEnabled`) vêm de `EnvironmentProvider`. Bom. **Mas** FEBRABAN, `MODALIDADE_NATIVA`, fallback `?? 341`, `CONEXOS_FANOUT_LIMIT=4` continuam hardcoded. `pageSize: 500` do listarTitulosPendentes também. | ❌ ausente | `RemessaService.ts:19, 22–27, 267, 776`; `ConciliacaoRetornoService.ts:49` |
| **Polymorphism (Defer Binding)** | tsyringe usado em 100% das classes; DI presente. Nenhuma interface com múltiplas implementações — `RemessaService` amarrado a `ConexosSispagWriteClient` concreto. Aceitável enquanto SISPAG for único destino; fecha porta para "Nexxera direto". | ⚠️ parcial | `RemessaService.ts:96–100` |
| **Plugin pattern / Runtime registration** | Não aplicado. Todo mapeamento fin015 é resolvido em tempo de código. | N/A | contexto ainda 100 % Conexos-only |
| **Naming (Reduce Coupling by convention)** | Idiomas misturados: código em português (`gerarRemessa`, `sincronizarComErp`, `adotarPorMarcaDagua`, `pular`) contra o CLAUDE.md ("Identifiers: English only"). É dívida de convenção herdada da frente SISPAG, mas o delta reforçou a divergência. | ⚠️ parcial | `CLAUDE.md` "Identifiers: English only" vs `RemessaService.ts` |

## 4. Findings

### F-modifiability-1: `RemessaService.gerarRemessa` bateu complexidade cognitiva 70 (4,7× o teto) — a máquina de retomada está inline

- **Severidade**: P1
- **Tactic violada**: Split Module + Increase Semantic Coherence
- **Localização**: `src/backend/domain/service/sispag/RemessaService.ts:102–498` (o método) + `497–722` (`sincronizarComErp`/`adotarPorMarcaDagua`)
- **Evidência (objetiva)**:
  ```
  domain/service/sispag/RemessaService.ts:102:89 lint/complexity/noExcessiveCognitiveComplexity
  ! Excessive complexity of 70 detected (max: 15).
  i Please refactor this function to reduce its complexity score from 70 to the max allowed complexity 15.

  domain/service/sispag/RemessaService.ts:755:48 lint/complexity/noExcessiveCognitiveComplexity
  ! Excessive complexity of 22 detected (max: 15).
  ```
  Um único método concentra: (a) validação de estado do lote (3 guards), (b) idempotência (`settled`/`reconciling`), (c) chamada à máquina de retomada (`sincronizarComErp` — 6 branches), (d) resolução de conta pagadora, (e) dry-run branch, (f) sequência 4-passos com `pular(etapa)` inline (3 `if`s), (g) settle. LOC do método: ~396 (linhas 102–498).
- **Impacto técnico**: qualquer mudança na sequência 4-passos (ex.: adicionar `validarConta` entre `criarLote` e `importarTitulos`) obriga a mexer no mesmo método que decide retomada + idempotência. O risco de introduzir um retry duplicado (que foi exatamente o problema que a retomada veio resolver) sobe a cada delta.
- **Impacto de negócio**: uma escrita fin015 duplicada = **pagamento duplicado**. O comentário do próprio arquivo (`RemessaService.ts:70–75`) diz que dois cliques na tela geraram dois lotes órfãos em HML (flp 1 e flp 2). Um dev novo mudando essa função sem varrer 396 linhas de invariantes tem alta probabilidade de reintroduzir o incidente.
- **Métrica de baseline**: complexidade cognitiva **70** (teto 15). LOC do método: **396**. Comentários de invariante ("por que" da regra) somam ~180 linhas.

### F-modifiability-2: `FEBRABAN_POR_BNCCOD` piorou — o delta ADICIONOU uma 5ª cópia em vez de remediar `modifiability-1` do review anterior

- **Severidade**: P1
- **Tactic violada**: Encapsulate + Abstract Common Services
- **Localização**:
  - `src/backend/domain/service/sispag/RemessaService.ts:19`
  - `src/backend/jobs/preflight-fin015-prd.ts:47`
  - `src/backend/jobs/validate-fin015-import.ts:63`
  - `src/backend/jobs/execute-fin015-prd.ts:61`
  - `src/backend/jobs/validate-retomada-remessa-v1.ts:105` **(novo, deste delta)**
  - `src/frontend/lib/sispag.ts:479` (tabela análoga `BANCO_NOME`)
- **Evidência (objetiva)**:
  ```
  $ grep -rn "3: 1, 4: 341, 7: 237" src/ --include="*.ts" | grep -v coverage
  src/backend/domain/service/sispag/RemessaService.ts:19:const FEBRABAN_POR_BNCCOD: Record<number, number> = { 3: 1, 4: 341, 7: 237, 10: 33 };
  src/backend/jobs/validate-retomada-remessa-v1.ts:105:    const FEBRABAN: Record<number, number> = { 3: 1, 4: 341, 7: 237, 10: 33 };
  src/backend/jobs/preflight-fin015-prd.ts:47:const FEBRABAN: Record<number, number> = { 3: 1, 4: 341, 7: 237, 10: 33 };
  src/backend/jobs/validate-fin015-import.ts:63:const FEBRABAN_POR_BNCCOD: Record<number, number> = { 3: 1, 4: 341, 7: 237, 10: 33 };
  src/backend/jobs/execute-fin015-prd.ts:61:const FEBRABAN: Record<number, number> = { 3: 1, 4: 341, 7: 237, 10: 33 };
  ```
  O card `modifiability-1` do review `2026-08-24-1830` era exatamente isso. O delta corrente adicionou mais uma cópia em `jobs/validate-retomada-remessa-v1.ts`, que agora é o próprio gate ao vivo — o gate valida o código de produção usando uma tabela paralela. Se o mapa mudar no service e não no gate, o gate valida contra premissa falsa.
- **Impacto técnico**: adicionar Bradesco (`bncCod=7` já existe) ou Santander (`bncCod=?`) exige atualizar 5 tabelas idênticas + 1 mapa de nomes no FE. Fallback silencioso `?? 341` (Itaú) engole omissão sem log — pagamento sai como Itaú.
- **Impacto de negócio**: quando o cliente contratar mais um banco, a probabilidade de o dev esquecer 1 dos 6 lugares é alta. Consequência: (a) `bncNumCodbanco` errado no CNAB → banco rejeita a remessa inteira; (b) na melhor das hipóteses o job de validação AO VIVO usa mapa desatualizado e não pega o bug antes de PRD.
- **Métrica de baseline**: 5 cópias backend + 1 tabela relacionada FE. Modificação atômica hoje = **6 arquivos**. Fallback silencioso (`?? 341`) em 3 sites.

### F-modifiability-3: Chave do item construída em 8 sites como template string — o próprio delta veio corrigir um bug DISTO

- **Severidade**: P1
- **Tactic violada**: Encapsulate + Use an Intermediary
- **Localização**:
  - `src/backend/domain/service/sispag/RemessaService.ts:635`, `761`, `774`
  - `src/backend/domain/client/ConexosSispagWriteClient.ts:283`, `359`
  - `src/backend/domain/service/sispag/LotePagamentoService.ts:386` (`lockKey` advisory)
  - `src/backend/domain/service/sispag/SispagPainelService.ts:92`, `94`
  - `src/frontend/app/sispag/page.tsx:64` (`keyOf`)
- **Evidência (objetiva)**:
  ```
  $ grep -rEn '[$]\{[^}]*docCod[^}]*\}:[$]\{[^}]*titCod[^}]*\}' src/ --include="*.ts"
  RemessaService.ts:635:  const nossas = new Set(lote.itens.map((i) => `${i.filCod}:${i.docCod}:${i.titCod}`));
  RemessaService.ts:761:      `${t.filCod}:${t.docCod}:${t.titCod}`;
  RemessaService.ts:774:      pendentes.map((p) => [`${Number(p.raw.filCod)}:${p.docCod}:${p.titCod}`, p]),
  ConexosSispagWriteClient.ts:283:  `${Number(r.filCod ?? filCod)}:${String(r.docCod ?? '')}:${String(r.titCod ?? '1')}`,
  ConexosSispagWriteClient.ts:359:  vistas.add(`${pendente.filCod}:${pendente.docCod}:${pendente.titCod}`);
  LotePagamentoService.ts:386:  const s = `${filCod}:${docCod}:${titCod}`;
  SispagPainelService.ts:92:  const emLote = new Set(emRascunho.map((t) => `${t.filCod}:${t.docCod}:${t.titCod}`));
  frontend/app/sispag/page.tsx:64:const keyOf = (t: TituloAPagar) => `${t.filCod}:${t.docCod}:${t.titCod}`
  ```
  O commit `9c73d1a` deste próprio delta ("fix(sispag): chave do item passa a incluir a FILIAL — e o gate ao vivo fecha verde") corrigiu o bug em 3 sites de `RemessaService.ts`. Ficaram 5 sites variantes: `ConexosSispagWriteClient.ts:283` usa `String(r.titCod ?? '1')`, o resto usa `.titCod` puro; `WriteClient.ts:283` fallback para `filCod` do escopo, o resto pega do próprio item. Nenhum contrato-código garante que o próximo campo adicionado à chave (ex.: `titTipCod`) vai bater nos 8 sites.
- **Impacto técnico**: reintrodução do incidente que este delta corrigiu — dessa vez, se alguém mudar a chave em 7 dos 8 sites e esquecer o 8º, o `Map` colide e o pagamento de uma filial sobrescreve o de outra. Não há teste de contrato que force os 8 a evoluírem juntos.
- **Impacto de negócio**: crédito na conta errada do fornecedor errado. Já quase aconteceu neste delta (só C1 do gate AO VIVO detectou).
- **Métrica de baseline**: 8 sites × 5 arquivos, 2 formatos variantes (`titCod ?? '1'` vs `titCod`).

### F-modifiability-4: Máquina de retomada expressa em ifs implícitos — a ontologia declara tabela; o código não

- **Severidade**: P2
- **Tactic violada**: Increase Semantic Coherence + Use an Intermediary
- **Localização**: `src/backend/domain/service/sispag/RemessaService.ts:497–722` (`sincronizarComErp` + `adotarPorMarcaDagua` + `pular(etapa)`)
- **Evidência (objetiva)**:
  ```
  // sincronizarComErp — 9 branches
  if (flpCod === undefined)                     -> adotarPorMarcaDagua
  if (!estado)                                  -> etapa 'criar_lote'
  if (estado.status === 2 || estado.status === 3) -> 'criar_lote' + canceladoFlpCod
  if (estado.status === 1) { … 2 sub-branches } -> 'gerar_remessa' | 'concluido' | 'gerar_remessa'
  if (estado.titulosCount === 0)                -> 'importar'
  if (!jaNoErp)                                 -> 'indeterminado'
  if (intrusos.length > 0)                      -> 'indeterminado'
  if (faltando.size === 0)                      -> 'finalizar'
  default                                       -> 'importar' + apenas
  ```
  A ontologia (`ontology/business-rules/retomada-remessa-sispag.md`) já declara isso como **tabela de 8 linhas** com "estado observado → ação". O código repete cada linha como `if` numa cadeia de 226 linhas. `pular(etapa)` compara índice de array (`ORDEM_ETAPAS.indexOf(etapa) < ORDEM_ETAPAS.indexOf(retomarDe)`) — uma máquina de estados feita "à mão".
- **Impacto técnico**: adicionar um novo `flpVldStatus` (ex.: `4 = em análise`) exige localizar todos os `estado.status === X` no service. Hoje isso é 3 lugares (`status === 2 || 3`, `status === 1`, `status === 0` implícito). Mais: `adotarPorMarcaDagua:706–711` filtra `l.status === 0` — quarto local. O código não guia o dev para a lista fechada.
- **Impacto de negócio**: divergência ontologia ↔ código só é detectada em produção. Um estado novo mal tratado = tentar retomar num lote que o ERP marcou "não posso mais mexer" → 500 no operador.
- **Métrica de baseline**: 9 branches em 3 métodos, 4 sites que testam `status === X`. Tabela ontologia = 8 linhas. Ratio ontologia:código = 1:5.

### F-modifiability-5: `page.tsx` chegou a 1026 LOC com 23 hooks e 12 handlers no mesmo componente — cada tweak toca "o arquivão"

- **Severidade**: P1
- **Tactic violada**: Split Module + Increase Semantic Coherence
- **Localização**: `src/frontend/app/sispag/page.tsx` (todo o arquivo, particularmente `SispagPanel` linhas 108–1000+)
- **Evidência (objetiva)**:
  ```
  $ wc -l src/frontend/app/sispag/page.tsx
  1026
  $ grep -c "React.useState\|React.useCallback\|React.useMemo\|React.useEffect\|React.useRef" page.tsx
  23
  $ grep -nE "^  const .* = async" page.tsx
  170  const ingerir = async () => {
  192  const formar = async () => {
  281  const criarLoteComSelecionados = async () => {
  324  const acaoLote = async (
  382  const conciliar = async (r, processar) => {
  423  const carregarRetornos = async () => {
  ```
  14 `useState` + 12 handlers async + 3 memoizações + 3 `useCallback` + 1 `useEffect`, tudo num único componente. O delta acrescentou +96 linhas: tratamento dos novos erros `RemessaEmDuvidaError` e `LoteAnteriorCanceladoError` (dialog de confirmação) e propagação do `confirmarNovoLote`.
- **Impacto técnico**: tocar a lógica de conciliação obriga a passar pelo mesmo componente que renderiza títulos, lotes, retornos, ingestão e formação. Nada é reusável fora daqui. Cada re-render invalida hooks não relacionados.
- **Impacto de negócio**: velocidade de mudança na tela SISPAG desce a cada delta. Já foram 3 revisões consecutivas apontando isso (`sispag-frente-ii` 07/18, `sispag-remessa-retorno` 08/24, este). O delta corrente adicionou UI para retomada sem extrair 1 handler — dívida composta.
- **Métrica de baseline**: 1026 LOC (alvo ≤ 400), 23 hooks (alvo ≤ 10 por componente), 12 handlers (alvo ≤ 3).

### F-modifiability-6: `ConciliacaoRetornoService.conciliar` bateu complexidade cognitiva 37; o loop interno bate 63

- **Severidade**: P2
- **Tactic violada**: Split Module
- **Localização**: `src/backend/domain/service/sispag/ConciliacaoRetornoService.ts:104` (`conciliar`) e `287` (loop `for (const l of linhas)` dentro de `withTransaction`)
- **Evidência (objetiva)**:
  ```
  domain/service/sispag/ConciliacaoRetornoService.ts:104:80 lint/complexity/noExcessiveCognitiveComplexity
  ! Excessive complexity of 37 detected (max: 15).
  domain/service/sispag/ConciliacaoRetornoService.ts:287:50 lint/complexity/noExcessiveCognitiveComplexity
  ! Excessive complexity of 63 detected (max: 15).
  ```
  Simetria com `RemessaService.gerarRemessa`: idempotência + retomada + `processar` + varredura de eventos + casamento + transição de lote inline.
- **Impacto técnico**: as etapas 1–4 (`processar` no ERP, ler detalhe evento-a-evento, casar com lote local, transicionar lote) coabitam. Alterar "como transicionamos o lote" (regra `todosBaixados`) obriga a reler todo o método.
- **Impacto de negócio**: bug no fechamento do lote (`BAIXADO` vs `RETORNADO`) tem consequência contábil direta. Manter tudo num só método aumenta risco de regressão.
- **Métrica de baseline**: complexidade cognitiva 37 (método) + 63 (loop transacional). 2 funções ~4× o teto.

### F-modifiability-7: Gate AO VIVO (`validate-retomada-remessa-v1.ts`) reimplementa o service — divergência silenciosa possível

- **Severidade**: P2
- **Tactic violada**: Abstract Common Services
- **Localização**: `src/backend/jobs/validate-retomada-remessa-v1.ts` (473 LOC novos, complexidade cognitiva 55)
- **Evidência (objetiva)**:
  ```
  jobs/validate-retomada-remessa-v1.ts:72:16 lint/complexity/noExcessiveCognitiveComplexity
  ! Excessive complexity of 55 detected (max: 15).
  jobs/validate-retomada-remessa-v1.ts:105:    const FEBRABAN: Record<number, number> = { 3: 1, 4: 341, 7: 237, 10: 33 };
  ```
  O gate é o **único** que fecha o ciclo AO VIVO ("os 3 cenarios de retomada verdes"). Mas ele tem sua própria cópia da tabela FEBRABAN, sua própria chave montada inline e sua própria orquestração — quando o service muda a semântica (ex.: novo estado), o gate não acompanha automaticamente.
- **Impacto técnico**: um bug no service pode não ser detectado pelo gate porque o gate assume o mundo "de antes". Já aconteceu no ciclo anterior (o `_shared-metrics.md` cita "NAO exercitada ao vivo nesta bateria: a perna de VOLTA (conciliacao do .RET)" — o gate não cobre a volta).
- **Impacto de negócio**: falso senso de segurança. "Gate verde" ≠ "código verde" se a assinatura do que o gate valida diverge da assinatura do que o service faz.
- **Métrica de baseline**: 473 LOC de código de teste com complexidade 55, tabela FEBRABAN duplicada, chave do item construída inline (2 sites).

## 5. Cards Kanban

### [modifiability-1] Quebrar `RemessaService.gerarRemessa` em etapas nomeadas + isolar a máquina de retomada

- **Problema**
  > `gerarRemessa` acumulou 5 concerns (idempotência, retomada, dry-run, escrita 4-passos, settle) num método de 396 LOC com complexidade cognitiva **70** — 4,7× o teto configurado do Biome. A máquina de retomada (`sincronizarComErp` + `adotarPorMarcaDagua`) mora inline como cadeia de ifs. Cada mudança na sequência 4-passos obriga a reler as ~180 linhas de comentário de invariante que o próprio método carrega para não repetir o incidente do pagamento duplicado.
- **Melhoria Proposta**
  > Aplicar **Split Module** no nível de método: extrair `resolverContaPagadora`, `criarOuReaproveitarLoteNativo`, `importarItens`, `finalizarLoteNativo`, `sugerirEGerarRemessa`, `localizarArquivoGerado`, `settle`. Extrair a máquina de retomada para uma nova classe `RemessaRetomadaEngine` (`@injectable`) com uma função `decidir(anterior, lote): Retomada` que devolve `{etapa, flpCod?, apenas?, canceladoFlpCod?}`. `gerarRemessa` fica com o esqueleto: idempotência → engine.decidir → for-each etapa. Aceitar redução do método principal a ≤ 60 LOC / complexidade ≤ 15.
- **Resultado Esperado**
  > `RemessaService.ts` cai de 870 para ~450 LOC; `gerarRemessa` cai de 396 para ≤ 60 LOC; Biome deixa de reclamar. `RemessaRetomadaEngine.decidir` é testável isoladamente (hoje o teste é indireto via `gerarRemessa`).
- **Tactic alvo**: Split Module + Increase Semantic Coherence
- **Severidade**: P1
- **Esforço estimado**: L (1–2 sem)
- **Findings relacionados**: F-modifiability-1, F-modifiability-4
- **Métricas de sucesso**:
  - Cognitive complexity `gerarRemessa`: 70 → ≤ 15
  - LOC `RemessaService.ts`: 870 → ≤ 450
  - LOC do método `gerarRemessa`: 396 → ≤ 60
  - Testes unitários específicos para `RemessaRetomadaEngine`: 0 → ≥ 8 (um por linha da tabela ontológica)
- **Risco de não fazer**: próxima mudança na sequência 4-passos (ex.: adicionar `validarConta` antes do import) reintroduz o incidente do pagamento duplicado — o comentário do arquivo (linha 70–75) atesta que dois cliques já geraram dois lotes órfãos em HML.
- **Dependências**: nenhuma — fan-in de `RemessaService` = 1 (só a rota); janela ideal antes que jobs importem o service diretamente.

### [modifiability-2] Extrair `TituloKey` (tipo + `chave.of()`) compartilhado FE+BE

- **Problema**
  > A chave `filCod:docCod:titCod` é montada como template string em **8 sites** distribuídos em 5 arquivos (2 dentro do próprio `RemessaService`, 2 no `ConexosSispagWriteClient`, 1 em `LotePagamentoService`, 2 em `SispagPainelService`, 1 no `page.tsx`). Este mesmo delta veio corrigir um bug de chave sem filial (commit `9c73d1a`) que teria importado pagamento de outro fornecedor. Há duas variantes já divergentes: `titCod ?? '1'` no cliente vs `titCod` puro no resto.
- **Melhoria Proposta**
  > Criar `src/backend/domain/interface/sispag/TituloKey.ts` com `type TituloKey = { readonly filCod: number; readonly docCod: string; readonly titCod: string }` e helpers `serializar(k: TituloKey): string`, `equals(a, b)`. Substituir os 8 sites por `serializar({filCod, docCod, titCod})`. Espelhar em `src/frontend/lib/sispag.ts` (mesmo formato). Adicionar teste de paridade FE↔BE que garante mesma string. Tactic **Encapsulate**.
- **Resultado Esperado**
  > 8 sites de template string → 1 função canônica no backend + 1 helper no FE. Próxima mudança na chave (ex.: incluir `titTipCod`) toca 2 arquivos, não 5.
- **Tactic alvo**: Encapsulate + Use an Intermediary
- **Severidade**: P1
- **Esforço estimado**: S (≤ 1d)
- **Findings relacionados**: F-modifiability-3
- **Métricas de sucesso**:
  - Sites de template string `filCod:docCod:titCod`: 8 → 0
  - Arquivos que precisam mudar para adicionar campo à chave: 5 → 2
  - Variantes de formato coexistindo: 2 → 1
- **Risco de não fazer**: repetição direta do incidente de "chave sem filial" que este delta corrigiu — próxima adição de campo esquecerá 1 dos 8 sites e o `Map` colidirá, importando pagamento de outra filial.
- **Dependências**: nenhuma.

### [modifiability-3] Centralizar `bncCod → FEBRABAN → nome` num único módulo compartilhado FE+BE (retomada do `modifiability-1` de 2026-08-24)

- **Problema**
  > O card `modifiability-1` do review anterior (2026-08-24-1830) apontava 3 cópias de `FEBRABAN_POR_BNCCOD`. Não foi remediado, e o delta corrente ADICIONOU a 5ª cópia em `jobs/validate-retomada-remessa-v1.ts`. Como esse job é o próprio gate AO VIVO da retomada, ele valida o service usando uma tabela paralela: uma alteração no service que não seja replicada no gate passa despercebida. O fallback silencioso `?? 341` (Itaú) engole omissões — o pagamento sai como Itaú sem log.
- **Melhoria Proposta**
  > Criar `src/backend/domain/config/BancosFebraban.ts` como classe `@singleton() @injectable()` que expõe `codigoFebraban(bncCod: number): number` (sem fallback silencioso — `throw BancoNaoMapeadoError` se ausente) e `nomeBanco(bncCod)`. Importar de `RemessaService`, `preflight-fin015-prd`, `validate-fin015-import`, `execute-fin015-prd`, `validate-retomada-remessa-v1`. Espelhar em `src/frontend/lib/bancos.ts` (mesma tabela, ou via endpoint). Alternativa mais forte: mover a tabela para SSM `/tenants/{env}/{client}/bancos-febraban` (tactic **Configuration files**).
- **Resultado Esperado**
  > 5 cópias backend + 1 FE → 1 lugar canônico. Novo banco = 1 PR de config, não 6 arquivos. Omissão de banco falha explícito (throw), não silenciosamente como Itaú.
- **Tactic alvo**: Encapsulate + Configuration files (Defer Binding)
- **Severidade**: P1
- **Esforço estimado**: M (2–5d)
- **Findings relacionados**: F-modifiability-2, F-modifiability-7
- **Métricas de sucesso**:
  - Cópias `FEBRABAN_POR_BNCCOD`: 5 → 1
  - Fallback silencioso `?? 341`: 3 sites → 0 (throw explícito)
  - Arquivos tocados por novo banco: 6 → 1
- **Risco de não fazer**: quando o cliente contratar Bradesco/Santander, o dev vai esquecer 1 dos 6 lugares; se for o gate, o gate valida com mapa desatualizado e não pega o bug; se for o service, o CNAB sai com FEBRABAN 341 e o banco rejeita a remessa inteira.
- **Dependências**: nenhuma. Facilita [modifiability-4].

### [modifiability-4] Turnar o gate `validate-retomada-remessa-v1` em consumidor do próprio service

- **Problema**
  > O gate AO VIVO da retomada é o único artefato que garante que os 3 cenários fecham verdes contra o ERP real. Mas ele tem 473 LOC próprios com complexidade cognitiva 55, sua tabela FEBRABAN e sua chave montada inline. Quando o service muda semântica (ex.: novo estado observado), o gate não acompanha — foi assim que a perna de VOLTA (conciliação `.RET`) ficou fora da cobertura AO VIVO desta bateria (`_shared-metrics.md`).
- **Melhoria Proposta**
  > Refatorar o gate para consumir `RemessaService` e `ConciliacaoRetornoService` diretamente via `container.resolve` (já é como faz o resto do backend), em vez de reimplementar a sequência. O papel do gate passa a ser **orquestrar cenários** (matar processo entre etapas, verificar estado final), não **repetir** a sequência. Aplica Tactic **Abstract Common Services**: uma única lógica canônica servindo produção e validação.
- **Resultado Esperado**
  > Gate cai de 473 para ~200 LOC. Divergência gate↔service se torna estrutural­mente impossível. Cobertura AO VIVO estendida à perna de volta sem duplicar código.
- **Tactic alvo**: Abstract Common Services
- **Severidade**: P2
- **Esforço estimado**: M (2–5d)
- **Findings relacionados**: F-modifiability-7
- **Métricas de sucesso**:
  - LOC `validate-retomada-remessa-v1.ts`: 473 → ≤ 200
  - Cognitive complexity main: 55 → ≤ 15
  - Cópias privadas de FEBRABAN e da chave: 1 + 2 → 0 (consumidas do service)
  - Perna coberta pelo gate: 1 (só remessa) → 2 (remessa + conciliação)
- **Risco de não fazer**: falso senso de segurança. "Gate verde" hoje só cobre a ida; volta continua sem contrato AO VIVO. Bug no `ConciliacaoRetornoService` chega ao operador antes de qualquer alarme.
- **Dependências**: [modifiability-1] (o service precisa estar decomposto para ser consumível em cenários), [modifiability-3] (para o gate deixar de duplicar FEBRABAN).

### [modifiability-5] Extrair `SispagPanel` em hooks + subcomponentes (retomada de card do review anterior, agravado)

- **Problema**
  > `page.tsx` cresceu de 930 → 1026 LOC, `SispagPanel` concentra 14 `useState`, 23 hooks totais e 12 handlers async. O delta corrente adicionou UI de retomada (dialog `LoteAnteriorCancelado`, tratamento `RemessaEmDuvida`) sem extrair um handler sequer. É a terceira revisão consecutiva flagando isto — dívida composta.
- **Melhoria Proposta**
  > Extrair 4 hooks: `useSispagPainel()` (retorna painel + `carregar`), `useLotesSispag()` (lotes + `recarregarLotes`), `useSelecaoTitulos()` (`selecionados`, `toggle`, `totalSelecionado`), `useAcoesLote()` (handlers `acaoLote`, `criarLoteComSelecionados`, `conciliar`, `formar`, `ingerir`). Extrair 3 subcomponentes: `TitulosAba`, `LotesEmAndamentoAba`, `RetornosAba`. `SispagPanel` fica com composição + roteamento de abas.
- **Resultado Esperado**
  > `page.tsx` cai de 1026 para ~350 LOC; `SispagPanel` cai de ~900 para ≤ 200 LOC; abas testáveis isoladamente.
- **Tactic alvo**: Split Module + Increase Semantic Coherence
- **Severidade**: P1
- **Esforço estimado**: L (1–2 sem)
- **Findings relacionados**: F-modifiability-5
- **Métricas de sucesso**:
  - LOC `page.tsx`: 1026 → ≤ 400
  - `useState` no `SispagPanel`: 14 → ≤ 5
  - Handlers async no mesmo componente: 12 → ≤ 3
  - Subcomponentes de aba testáveis isoladamente: 0 → 3
- **Risco de não fazer**: continuação da tendência — cada delta adiciona +50–100 LOC no mesmo arquivo. Em 3 sprints o arquivo passa de 1200 LOC e ninguém aceita mais tocá-lo, todo bug SISPAG vira gargalo humano.
- **Dependências**: nenhuma — o backend não muda.

### [modifiability-6] Extrair a máquina de retomada em tabela declarativa espelhando a ontologia

- **Problema**
  > A ontologia (`ontology/business-rules/retomada-remessa-sispag.md`) declara a retomada como tabela de 8 linhas ("estado observado no ERP → ação"). O código expressa isso como cadeia de 9 `if`s em `sincronizarComErp` + 3 em `adotarPorMarcaDagua` + comparação de índice de array em `pular(etapa)`. Ontologia:código = 1:5. Um novo `flpVldStatus` (ex.: 4 = "em análise") exige encontrar todos os `estado.status === X` sem guia do compilador.
- **Melhoria Proposta**
  > Modelar `EstadoErpDoLote` como discriminated union (`'inexistente' | 'cancelado' | 'finalizado_com_arquivo' | 'finalizado_sem_arquivo' | 'aberto_vazio' | 'aberto_parcial' | 'aberto_completo' | 'aberto_com_intruso'`) e `RemessaRetomadaEngine.decidir` como `switch` exaustivo sobre essa union (compilador força cobertura). Espelhar a tabela ontológica 1:1. `ORDEM_ETAPAS` vira `enum Etapa` com método `.podeSerPuladaSe(retomarDe)`.
- **Resultado Esperado**
  > Adicionar `flpVldStatus=4` = novo case do union → compilador aponta 1 arquivo. Divergência ontologia↔código detectada em typecheck, não em produção.
- **Tactic alvo**: Increase Semantic Coherence + Use an Intermediary
- **Severidade**: P2
- **Esforço estimado**: M (2–5d)
- **Findings relacionados**: F-modifiability-4
- **Métricas de sucesso**:
  - `if (estado.status === X)` no service: 4 sites → 0 (só o mapeamento status→union numa função)
  - Branches em `sincronizarComErp`: 9 ifs → 1 switch exaustivo
  - Ratio ontologia:código de linhas: 1:5 → 1:1
- **Risco de não fazer**: cada novo estado do fin015 fica dependente de arqueologia humana. Um estado novo mal tratado tenta retomar num lote que o ERP marcou "não posso mais mexer" → 500 no operador, dinheiro travado.
- **Dependências**: [modifiability-1] (a engine já foi extraída).

## 6. Notas do agente

- Cross-QA (para o consolidator):
  - **modifiability-1 + testability**: `gerarRemessa` com CC=70 é notoriamente difícil de testar por caminhos — cross-check com o QA de Testability sobre cobertura por branch da máquina de retomada.
  - **modifiability-3 (FEBRABAN externalizado) ↔ deployability + integrability**: se a tabela for para SSM, é 1 config por tenant sem redeploy — economia de deployability real; mas se ficar em módulo TypeScript compartilhado FE+BE, aparece no bundle do frontend (cross-check com integrability sobre contrato compartilhado).
  - **modifiability-4 (gate consome service) ↔ testability**: hoje o gate é o único contrato AO VIVO; a decisão de reformá-lo impacta o Ground-Truth Validator.
  - **modifiability-5 (page.tsx) ↔ performance**: 23 hooks num só componente = re-renders desnecessários — cross-check com Performance.
- Escopo: só o delta do tweak, mas 4 dos 6 cards são retomadas de cards do review 2026-08-24 (`modifiability-1..7`) — nenhum remediado neste ciclo. O consolidator deveria marcar isso como "dívida acumulada" no REPORT.md.
- Não medido localmente: complexidade ciclomática exata dos jobs `probe-impacto-*` novos (7 jobs, ~1000 LOC agregados) — Biome só sinaliza `noExcessiveCognitiveComplexity`. Recomendação: adicionar `--reporter=json` no CI para tracking histórico.
