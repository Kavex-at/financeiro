---
qa: Modifiability
qa_slug: modifiability
run_id: 2026-10-14-2030
agent: qa-modifiability
generated_at: 2026-10-14T20:30:00-03:00
scope: backend
score: 7
findings_count: 4
cards_count: 3
---

# Modifiability — Regis-Review

> Escopo reduzido: delta `origin/main..HEAD` (retirada automática por código de barras repetido). Métricas globais do repo não foram recoletadas.

## 1. Cenário Geral

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Desenvolvedor | Passo 2 da ADR-0068 (guarda entre lotes / boleto pago) ou novo motivo de retirada | `RetiradaCodigoBarrasService`, `AnaliseCodigoBarrasRepetido`, `RemessaService`, ledger | Desenvolvimento, pós-merge | Mudança localizada na lib de análise + serviço de retirada, sem tocar `RemessaService` nem o CHECK do ledger | Arquivos tocados ≤ 4; zero migration de ledger; construtor do `RemessaService` não cresce |

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| LOC `RetiradaCodigoBarrasService.ts` (novo) | 558 | ≤ 600 | ⚠️ 93% do teto; 3 métodos públicos | `wc -l` |
| LOC `RemessaService.ts` | 1813 (era 1839; -26 líquido, +88/-114) | ≤ 600 | ❌ pré-existente; delta reduziu | `wc -l`, `git diff --stat` |
| Dependências de construtor do novo serviço | 7 (write, loteRepo, db, analise, log, bloqueios, eventos) | ≤ 15 | ✅ | `RetiradaCodigoBarrasService.ts:132-147` |
| Dependências de construtor `RemessaService` | 12 (+1: `retirada`) | ≤ 8 | ⚠️ | `RemessaService.ts:198-213` |
| Construtor `LotePagamentoRepository` | 3 deps (inalterado no delta) | ≤ 5 | ✅ | `LotePagamentoRepository.ts:126-133` |
| Métodos novos em `LotePagamentoRepository` | 2 (`retirarItemPorCodigoDeBarras`, `desfazerAutomaticosVencidos`), +120 LOC | — | ✅ | `git diff` |
| Violações de camada no delta | 0 | 0 | ✅ | leitura de imports |
| Literais numéricos de regra no novo serviço | retries 2 / delay 150ms inline em `RetryExecutor` | externalizado | ⚠️ | `RetiradaCodigoBarrasService.ts:129` |
| Ciclos de dependência | 0 observados (Retirada → repos/libs; Remessa → Retirada) | 0 | ✅ | leitura manual |
| Cognitive complexity por função | ⚠️ Não medido por função (lint relatado: 97 warnings totais) | ≤ 15 | ⚠️ | — |

### Apêndice A — Top-10 maiores arquivos tocados (delta)

| # | Arquivo | LOC |
|---|---|---|
| 1 | `domain/service/sispag/RemessaService.ts` | 1813 |
| 2 | `domain/service/sispag/LotePagamentoService.ts` | 690 |
| 3 | `domain/service/sispag/RetiradaCodigoBarrasService.ts` | 558 |
| 4 | `domain/repository/sispag/LotePagamentoRepository.ts` | > 540 (total não medido; +120 no delta) |
| 5 | `jobs/probe-hml-delete-item-inexistente.ts` | 374 |
| 6 | `domain/repository/sispag/BloqueioDuplicidadeRepository.ts` | total não medido (+192) |
| 7 | `domain/errors/BoletoCodigoBarrasRetiradaIncompletaError.ts` | 166 |
| 8 | `domain/client/ConexosSispagWriteClient.ts` | total não medido (+96) |
| 9 | `domain/repository/sispag/VerificacaoEventoRepository.ts` | total não medido (+85) |
| 10 | `domain/libs/boleto/AnaliseCodigoBarrasRepetido.ts` | ≥ 85 |

### Apêndice B — Fan-in (módulos tocados)

| # | Módulo | Importado por (no delta) |
|---|---|---|
| 1 | `LotePagamentoRepository` | Retirada, Remessa, LotePagamentoService |
| 2 | `AnaliseCodigoBarrasRepetido` | RetiradaCodigoBarrasService, RemessaCnabValidator |
| 3 | `BloqueioDuplicidadeRepository` | Retirada, LotePagamentoRepository |
| 4 | `VerificacaoEventoRepository` | Retirada, LotePagamentoRepository |
| 5 | `RetiradaCodigoBarrasService` | RemessaService |

> Fan-in global top-10 de serviços não recoletado (fora do escopo reduzido).

## 3. Tactics — Cobertura

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Split Module | Guarda extraída do `RemessaService` para `RetiradaCodigoBarrasService` (Remessa -26 LOC líquidos) | ⚠️ parcial; novo módulo a 93% do teto | `RetiradaCodigoBarrasService.ts` |
| Increase Semantic Coherence | Decisão pura (`AnaliseCodigoBarrasRepetido`) separada da orquestração e do I/O | ✅ presente | `AnaliseCodigoBarrasRepetido.ts` |
| Encapsulate | Código completo só em variáveis locais; saem apenas máscara 5+4 | ✅ presente | cabeçalho do serviço |
| Use an Intermediary | `RemessaService` fala com a retirada por fronteira única (`garantir`, `classificarIntrusos`) | ✅ presente | `RemessaService.ts:211` |
| Restrict Dependencies | Serviço só toca repos/client/lib; sem lambda/route | ✅ presente | imports |
| Refactor | Dois DELETEs de item local (`removerItemDeRascunho` só RASCUNHO vs `retirarItemPorCodigoDeBarras`) | ⚠️ parcial | `LotePagamentoRepository.ts:500` e novo método |
| Abstract Common Services | Análise de código de barras compartilhada com `RemessaCnabValidator` | ✅ presente | `RemessaCnabValidator.ts:240` |
| Defer Binding | Etapa `limpar_retirados` só em memória; retries/delay inline | ⚠️ parcial | `RemessaService.ts:109-114` |

## 4. Findings

### F-modifiability-1: Etapa `limpar_retirados` existe só em memória; o CHECK do ledger não a conhece

- **Severidade**: P2
- **Tactic violada**: Defer Binding (acoplamento implícito entre `ORDEM_ETAPAS` e o CHECK da migration 0049)
- **Localização**: `RemessaService.ts:109-114`, `interface/sispag/RemessaExecucao.ts:14`, `migrations/0049_sispag_remessa_retorno.sql:89`
- **Evidência (objetiva)**:
  ```
  ORDEM_ETAPAS inclui 'limpar_retirados'; RemessaEtapa (tipo do ledger) = 5 valores, sem ela
  setEtapa só é chamado com 'finalizar' e 'gerar_remessa' (RemessaService.ts:672, 694)
  ```
- **Impacto técnico**: Seguro hoje: o tipo `RemessaEtapa` impede a gravação em compile-time e a etapa é sempre re-derivada da observação do ERP. O risco é de manutenção: unificar `EtapaReal` com `RemessaEtapa` faria o UPDATE violar o CHECK em runtime. Não é defeito estrutural de dinheiro.
- **Impacto de negócio**: Baixo; eventual falha trava a geração de remessa, não gera pagamento errado.
- **Métrica de baseline**: 1 etapa fora do CHECK; 0 escritas ao ledger.

### F-modifiability-2: `RetiradaCodigoBarrasService` perto do teto, com três responsabilidades

- **Severidade**: P3
- **Tactic violada**: Split Module
- **Localização**: `RetiradaCodigoBarrasService.ts` (`garantir`, `classificarIntrusos`, reconhecimento de resíduo)
- **Evidência (objetiva)**: `wc -l` = 558; 3 métodos públicos; 4 interfaces e 3 helpers de chave locais.
- **Impacto técnico**: o passo 2 da ADR-0068 tende a empurrá-lo acima de 600 LOC.
- **Impacto de negócio**: revisão mais lenta de código de segurança financeira.
- **Métrica de baseline**: 558 LOC / alvo 600.

### F-modifiability-3: Dois caminhos de DELETE de item local com efeitos colaterais divergentes

- **Severidade**: P3
- **Tactic violada**: Refactor (duplicação)
- **Localização**: `LotePagamentoRepository.ts:500-511` e `retirarItemPorCodigoDeBarras`; `LotePagamentoService.ts:370-390` (mover/I13j) vs `RetiradaCodigoBarrasService.ts:444`
- **Evidência (objetiva)**: dois `DELETE FROM lote_pagamento_item ... USING lote_pagamento` com predicados de status distintos; o caminho de mover faz `descartarDoItem`/`marcarManual`/`tocarLote`/`cancelarSeVazio`, o da retirada tem transação e marca próprias.
- **Impacto técnico**: regra nova de remoção precisa ser lembrada nos dois; a divergência é deliberada (sistema vs analista) mas documentada só em comentário.
- **Impacto de negócio**: baixo; risco de inconsistência de versão/alertas.
- **Métrica de baseline**: 2 DELETEs, 2 orquestrações transacionais.

### F-modifiability-4: `AnaliseCodigoBarrasRepetido` só é reaproveitável parcialmente para o passo 2

- **Severidade**: P3
- **Tactic violada**: Abstract Common Services
- **Localização**: `libs/boleto/AnaliseCodigoBarrasRepetido.ts`
- **Evidência (objetiva)**: opera sobre itens do MESMO lote (chave opaca); sem noção de conjunto externo (outros lotes / boleto pago); a ordem "quem fica" (vencimento→docCod→filCod→titCod) é fixa.
- **Impacto técnico**: o passo 2 precisa de índice cross-lote (HMAC, migration) e decisão distinta; só `mascarar`/validação de DV/normalização 44 são reutilizáveis.
- **Impacto de negócio**: estimativa do passo 2 não deve presumir reuso integral.
- **Métrica de baseline**: 1 lib, 0 pontos de extensão (ordenação não injetável).

## 5. Cards Kanban

### [modifiability-1] Travar por teste o invariante da etapa em memória

- **Problema**
  > `limpar_retirados` está em `ORDEM_ETAPAS` mas não em `RemessaEtapa` nem no CHECK 0049; a separação é garantida por comentário e tipo.
- **Melhoria Proposta**
  > Teste de contrato que falha se `ORDEM_ETAPAS` e `RemessaEtapa` divergirem sem decisão explícita; separar por tipo nomeado a etapa efêmera (`EtapaReal`) da persistida em `RemessaExecucao.ts`.
- **Resultado Esperado**
  > Impossível gravar etapa efêmera no ledger por refactor desatento: 0 → 1 teste guardião.
- **Tactic alvo**: Defer Binding
- **Severidade**: P2
- **Esforço estimado**: S
- **Findings relacionados**: F-modifiability-1
- **Métricas de sucesso**:
  - testes guardiões da divergência: 0 → 1
- **Risco de não fazer**: UPDATE rejeitado em retomada após refactor, travando geração de remessa.
- **Dependências**: nenhuma

### [modifiability-2] Preparar retirada e análise para o passo 2 da ADR-0068

- **Problema**
  > O serviço (558 LOC) e a análise (mesmo lote, ordenação fixa) vão crescer com a guarda cross-lote/boleto pago.
- **Melhoria Proposta**
  > Antes do passo 2: extrair o reconhecimento de resíduo (I16h(c)) para colaborador próprio e tornar "quem fica" uma estratégia; a guarda cross-lote entra como outro serviço que reusa só `mascarar`/validação (Split Module + Abstract Common Services).
- **Resultado Esperado**
  > Serviço de retirada ≤ 450 LOC; passo 2 sem editar `RemessaService`.
- **Tactic alvo**: Split Module
- **Severidade**: P3
- **Esforço estimado**: M
- **Findings relacionados**: F-modifiability-2, F-modifiability-4
- **Métricas de sucesso**:
  - LOC do serviço: 558 → ≤ 450
- **Risco de não fazer**: serviço > 600 LOC numa área de segurança financeira.
- **Dependências**: decisão de desenho do passo 2

### [modifiability-3] Unificar a regra de remoção de item local

- **Problema**
  > Dois DELETEs e duas orquestrações de remoção; efeitos colaterais (alerta, versão, cancelar vazio) divergem.
- **Melhoria Proposta**
  > Um método de repositório com política explícita (analista vs sistema), ou contrato testado que fixe a diferença.
- **Resultado Esperado**
  > Um ponto por regra de remoção: 2 → 1 DELETE parametrizado.
- **Tactic alvo**: Refactor
- **Severidade**: P3
- **Esforço estimado**: S
- **Findings relacionados**: F-modifiability-3
- **Métricas de sucesso**:
  - DELETEs de item: 2 → 1
- **Risco de não fazer**: regra nova esquecida em um dos caminhos.
- **Dependências**: nenhuma

## 6. Notas do agente

- Nenhum P0: construtor do `LotePagamentoRepository` não cresceu (3 deps) e `RemessaService` encolheu no delta; etapa em memória é protegida por tipo.
- `RemessaService` com 1813 LOC segue P1 pré-existente (Split Module), fora do delta.
- Cross-QA: Testability (RemessaService grande), Fault-Tolerance (etapa em memória e retomada), Integrability (DELETE nativo + releitura).
- Não coletados: fan-in global, cognitive complexity por função.
