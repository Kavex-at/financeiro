---
qa: Modifiability
qa_slug: modifiability
run_id: 2026-10-08-2012-favorecido-autorizado
agent: qa-modifiability
generated_at: 2026-10-08T20:30:00Z
scope: all
score: 5.5
findings_count: 5
cards_count: 4
---

# Modifiability — Regis-Review

## 1. Cenário Geral (Bass General Scenario)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Desenvolvedor Kavex | Nova regra de autorização de favorecido (ex.: nova modalidade além de TED/PIX, ou novo critério de re-aprovação) | `AuthorizedPayeeRule`, `AuthorizedPayeeService`, `RemessaService`, `routes/sispag.ts` | Desenvolvimento, pipeline `/feature-tweak` | Mudança localizada nas libs/serviços do favorecido, sem tocar o orquestrador de remessa | ≤ 3 arquivos de produção tocados, 0 funções novas com complexidade cognitiva > 15 |

## 2. Métricas observadas

Escopo: 52 arquivos .ts/.tsx de produção tocados pela feature (sem testes).

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| LOC por arquivo tocado (p50 / p95 / max) | 145 / 1147 / 1701 | ≤150 / ≤400 / ≤600 | ❌ (p95 e max) | `wc -l` sobre a lista de `_shared-metrics.md` |
| Arquivos tocados > 600 LOC | 8 (RemessaService 1701, sispag.ts FE 1654, page.tsx 1460, routes/sispag.ts 1147, LotePagamentoRepository 1099, LoteCard 1067, SispagInterface 777, LotePagamentoService 678) + AuthorizedPayeeService 655 = 9 | 0 | ❌ | idem |
| Novo arquivo do delta > 600 LOC | 1 (`AuthorizedPayeeService.ts`, 655, 100% novo) | 0 | ❌ | `git diff --stat origin/main` |
| Funções com complexidade cognitiva > 15 (domain/service/sispag, libs, repository, routes) | 5 não-teste (RemessaService:227 = 94, RemessaService:1026 = 38, ConciliacaoRetornoService = 57, IngestaoPagamentosService = 25, LotePagamentoService:298 = 17); 2 em RemessaService, 1 em LotePagamentoService tocados pelo delta | 0 | ❌ | `npx biome lint` |
| Crescimento líquido do RemessaService | 1672 → 1701 LOC (+29; 223 linhas alteradas) | ≤ 0 em arquivo > 600 | ⚠️ | `git show origin/main:...` |
| Fan-out máx. (imports) nos arquivos tocados | 37 (page.tsx), 36 (routes/sispag.ts), 30 (RemessaService), 27 (LotePagamentoService) | ≤ 15 | ❌ | `grep -c '^import '` |
| Fan-out dos arquivos novos do favorecido | AuthorizedPayeeService 16, VerificacaoTedPixService 14, demais ≤ 9 | ≤ 15 | ⚠️ (1 acima) | idem |
| Violações de camada: routes importando repository/client direto | 4 em `routes/sispag.ts` (idem em origin/main: 4, delta não piora) | 0 | ⚠️ pré-existente | `grep` |
| Domain importando lambda | 0 | 0 | ✅ | `grep` |
| Dependência circular (amostra manual: AuthorizedPayeeService ↔ RemessaService ↔ DestinoPagamentoResolver) | 0; RemessaService → AuthorizedPayeeService → Rule/Repository, sem retorno | 0 | ✅ | leitura de imports |
| Magic numbers de regra de negócio nos novos service/rule | 0 detectados (nenhuma constante numérica ≥ 3 dígitos) | 0 | ✅ | `grep` |
| JOINs no AuthorizedPayeeRepository | 0 | ≤ 5 | ✅ | `grep -c JOIN` |
| Cobertura de testes dos novos módulos | cada arquivo novo tem `.test.ts`; integração SQL para migration 0080 e repositório | todos | ✅ | `_shared-metrics.md` |

### Apêndice A — Top-10 maiores arquivos (escopo do delta)

| # | LOC | Imports | Arquivo |
|---|---|---|---|
| 1 | 1701 | 30 | src/backend/domain/service/sispag/RemessaService.ts |
| 2 | 1654 | 4 | src/frontend/lib/sispag.ts |
| 3 | 1460 | 37 | src/frontend/app/sispag/page.tsx |
| 4 | 1147 | 36 | src/backend/routes/sispag.ts |
| 5 | 1099 | 7 | src/backend/domain/repository/sispag/LotePagamentoRepository.ts |
| 6 | 1067 | 20 | src/frontend/app/sispag/components/LoteCard.tsx |
| 7 | 777 | 1 | src/backend/domain/interface/sispag/SispagInterface.ts |
| 8 | 678 | 27 | src/backend/domain/service/sispag/LotePagamentoService.ts |
| 9 | 655 | 16 | src/backend/domain/service/sispag/AuthorizedPayeeService.ts |
| 10 | 515 | 18 | src/backend/domain/service/sispag/SispagPainelService.ts |

### Apêndice B — Fan-in (importadores não-teste) dos módulos do delta

Medido só sobre os módulos de serviço/regra tocados (não sobre todo `domain/service/`); `grep -rlE "/<Nome>(\.js)?'"`.

| # | Fan-in | Módulo |
|---|---|---|
| 1 | 6 | DestinoPagamentoResolver |
| 2 | 3 | LotePagamentoService |
| 3 | 3 | AuthorizedPayeeService |
| 4 | 2 | SispagPainelService |
| 5 | 2 | RemessaService |
| 6 | 2 | PayeeFingerprint |
| 7 | 2 | AuthorizedPayeeRepository |
| 8 | 1 | VerificacaoTedPixService |
| 9 | 1 | AuthorizedPayeeRule |
| 10 | 0 | ExcecaoDestinoService / ConferenciaLoteService / PendenciaCadastroService (acessados via container ou rotas dinâmicas; fan-in estático 0) |

O ponto de ripple mais largo é `DestinoPagamentoResolver` (6): qualquer mudança no contrato de destino atinge Remessa, Lote, Verificação, Candidatos etc.

## 3. Tactics — Cobertura

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Split Module | Delta separa regra pura (`AuthorizedPayeeRule`, `PayeeFingerprint`, `MaskDestino`, `DestinoManualValidator`), repositório, serviço, candidatos e verificação em módulos pequenos; mas `AuthorizedPayeeService` nasce com 655 LOC e `RemessaService` segue com 1701 | ⚠️ parcial | `wc -l`; Apêndice A |
| Increase Semantic Coherence | Libs `libs/sispag/*` são puras e coesas; `AuthorizedPayeeService` mistura solicitar/aprovar/rejeitar/revogar/verificar/reconferir/revelar (ciclo de vida + consulta de destino + revelação de dado sensível) | ⚠️ parcial | `AuthorizedPayeeService.ts:102-373` |
| Encapsulate | Erros tipados por regra (≈25 classes novas), `AuthorizedPayeeInterface`, `DestinoManualSchema` (Zod) nos boundaries | ✅ presente | `domain/errors/*`, `domain/interface/sispag/` |
| Use an Intermediary | `DestinoPagamentoResolver` isola a resolução de destino; `AuthorizedPayeeService` é a única porta para o repositório de favorecidos | ✅ presente | `RemessaService.ts:186-187` |
| Restrict Dependencies | `routes/sispag.ts` ainda importa 4 repositórios/clients direto (pré-existente, inalterado); sem ciclos | ⚠️ parcial | `routes/sispag.ts:7-12` |
| Refactor | Delta toca funções com complexidade 94 e 38 em RemessaService sem reduzi-las | ❌ ausente | biome lint |
| Abstract Common Services | `PayeeFingerprint`, `MaskDestino` compartilhados entre candidatos, exceção e favorecido | ✅ presente | `libs/sispag/` |
| Defer Binding | tsyringe `@inject`; sem tokens/polimorfismo para modalidades (TED/PIX é união fixa em `AuthorizedPayeeModality`); flags via `EnvironmentVars` (+EnvironmentProvider alterado) | ⚠️ parcial | `EnvironmentProvider.ts`, `AuthorizedPayeeInterface.ts` |

## 4. Findings

### F-modifiability-1: RemessaService permanece monolito de 1701 LOC e absorve a integração do favorecido autorizado
- **Severidade**: P1
- **Tactic violada**: Split Module
- **Localização**: `src/backend/domain/service/sispag/RemessaService.ts` (30 imports; injeta `AuthorizedPayeeService` e `DestinoPagamentoResolver` em :186-187)
- **Evidência (objetiva)**:
  ```
  origin/main 1672 LOC -> HEAD 1701 LOC; 223 linhas alteradas; 30 imports
  ```
- **Impacto técnico**: toda regra de remessa, destino congelado e favorecido compartilha um arquivo; cada tweak conflita e exige reler 1700 linhas.
- **Impacto de negócio**: custo de mudança alto na frente SISPAG, que é a de maior cadência de mudança (várias ADRs por ciclo).
- **Métrica de baseline**: 1701 LOC (alvo ≤ 600), fan-out 30 (alvo ≤ 15).

### F-modifiability-2: Funções de complexidade cognitiva 94 e 38 tocadas sem redução
- **Severidade**: P1
- **Tactic violada**: Refactor
- **Localização**: `RemessaService.ts:227`, `RemessaService.ts:1026`; também `LotePagamentoService.ts:298` (17)
- **Evidência (objetiva)**:
  ```
  noExcessiveCognitiveComplexity: 94, 38 (RemessaService); 17 (LotePagamentoService); max 15
  ```
- **Impacto técnico**: ramificações da verificação de autorização somam-se a fluxo já ilegível; regressão provável em novas regras.
- **Impacto de negócio**: bug em remessa = pagamento errado; dificulta revisão de segurança financeira.
- **Métrica de baseline**: 3 funções > 15 no delta, pior = 94.

### F-modifiability-3: AuthorizedPayeeService nasce com 655 LOC e múltiplas responsabilidades
- **Severidade**: P2
- **Tactic violada**: Increase Semantic Coherence
- **Localização**: `src/backend/domain/service/sispag/AuthorizedPayeeService.ts:102-373`
- **Evidência (objetiva)**:
  ```
  655 LOC, 16 imports, 8 métodos públicos: listar, eventos, solicitar, aprovar, rejeitar, revogar, verificarDestinoAutorizado, reconferir, revelar
  ```
- **Impacto técnico**: ciclo de vida (F1–F7), verificação em remessa e revelação de dado sensível mudam por razões distintas.
- **Impacto de negócio**: novos fluxos de aprovação (4-olhos, alçadas) aumentam o arquivo antes de haver teto.
- **Métrica de baseline**: 655 LOC (alvo ≤ 400), 1 import acima de 15.

### F-modifiability-4: routes/sispag.ts concentra 1147 LOC e importa repositórios/clients direto
- **Severidade**: P2
- **Tactic violada**: Restrict Dependencies
- **Localização**: `src/backend/routes/sispag.ts:7-12` (fan-out 36)
- **Evidência (objetiva)**:
  ```
  4 imports de domain/repository|client na rota (mesmo número em origin/main)
  ```
- **Impacto técnico**: rotas conhecem persistência; migração para Lambda exige reescrever a mesma lógica. Delta não agrava, mas adiciona rotas de favorecidos ao mesmo arquivo.
- **Impacto de negócio**: migração para o alvo Lambda mais cara (dívida de migração já registrada).
- **Métrica de baseline**: 1147 LOC, 36 imports, 4 violações de camada.

### F-modifiability-5: Modalidade de pagamento é união fixa, sem ponto de extensão
- **Severidade**: P3
- **Tactic violada**: Defer Binding
- **Localização**: `src/backend/domain/interface/sispag/AuthorizedPayeeInterface.ts` (`AuthorizedPayeeModality`), `AuthorizedPayeeRule.ts`
- **Evidência (objetiva)**:
  ```
  0 tokens/interfaces com múltiplas implementações; modalidades TED/PIX codificadas na regra
  ```
- **Impacto técnico**: adicionar modalidade (ex.: boleto, DOC) toca regra, fingerprint, validator e UI.
- **Impacto de negócio**: aceitável hoje (escopo contratual TED/PIX); registrar para quando houver nova modalidade.
- **Métrica de baseline**: 0 pontos de extensão; 5+ arquivos tocados por nova modalidade (estimado).

## 5. Cards Kanban

### [modifiability-1] Extrair a verificação de favorecido do RemessaService
- **Problema**
  > RemessaService tem 1701 LOC, 30 imports e funções de complexidade 94 e 38; o delta adicionou a integração do favorecido autorizado dentro dele.
- **Melhoria Proposta**
  > Split Module + Refactor: extrair para um `RemessaAutorizacaoGuard` (ou similar) a chamada a `AuthorizedPayeeService`/`DestinoPagamentoResolver` e o tratamento de erros associados; quebrar `RemessaService.ts:227` em passos nomeados. Fazer proporcionalmente no próximo `/feature-tweak` que tocar a remessa.
- **Resultado Esperado**
  > RemessaService ≤ 1000 LOC no primeiro passo, nenhuma função nova > 15.
- **Tactic alvo**: Split Module
- **Severidade**: P1
- **Esforço estimado**: L (1–2sem)
- **Findings relacionados**: F-modifiability-1, F-modifiability-2
- **Métricas de sucesso**:
  - LOC RemessaService: 1701 → ≤ 1000
  - Complexidade da função mais crítica: 94 → ≤ 30 (etapa 1)
- **Risco de não fazer**: cada regra nova de remessa aumenta o risco de regressão em geração de CNAB.
- **Dependências**: testes de remessa existentes como rede de segurança.

### [modifiability-2] Dividir AuthorizedPayeeService em ciclo de vida e verificação
- **Problema**
  > O serviço novo já tem 655 LOC e mistura transições de estado, verificação em remessa e revelação de destino.
- **Melhoria Proposta**
  > Increase Semantic Coherence: separar `AuthorizedPayeeLifecycleService` (solicitar/aprovar/rejeitar/revogar), `AuthorizedPayeeVerifier` (verificar/reconferir) e manter `revelar` isolado por ser sensível.
- **Resultado Esperado**
  > Nenhum arquivo > 400 LOC; imports ≤ 15.
- **Tactic alvo**: Increase Semantic Coherence
- **Severidade**: P2
- **Esforço estimado**: M (2–5d)
- **Findings relacionados**: F-modifiability-3
- **Métricas de sucesso**:
  - LOC máx.: 655 → ≤ 400
  - Imports: 16 → ≤ 12
- **Risco de não fazer**: o arquivo cresce com alçadas e auditoria até ficar como o RemessaService.
- **Dependências**: nenhuma.

### [modifiability-3] Mover acesso a repositórios/clients de routes/sispag.ts para serviços
- **Problema**
  > A rota importa 4 repositórios/clients direto e tem 1147 LOC, 36 imports.
- **Melhoria Proposta**
  > Restrict Dependencies: criar serviços de fachada para execução/ingestão e dividir o router em `sispag.favorecidos.ts`, `sispag.remessa.ts`, `sispag.lotes.ts`.
- **Resultado Esperado**
  > 0 violações de camada, cada router ≤ 400 LOC.
- **Tactic alvo**: Restrict Dependencies
- **Severidade**: P2
- **Esforço estimado**: M (2–5d)
- **Findings relacionados**: F-modifiability-4
- **Métricas de sucesso**:
  - Violações de camada: 4 → 0
  - LOC routes/sispag.ts: 1147 → ≤ 400 por arquivo
- **Risco de não fazer**: migração Lambda mais cara.
- **Dependências**: `ontology/_inbox/migration-debt.md`.

### [modifiability-4] Registrar ponto de extensão para modalidades de pagamento
- **Problema**
  > TED/PIX é união fixa na regra do favorecido; nova modalidade exige tocar vários arquivos.
- **Melhoria Proposta**
  > Defer Binding: tabela de estratégia por modalidade (fingerprint + validator) resolvida por mapa tipado; só quando surgir a 3ª modalidade.
- **Resultado Esperado**
  > Nova modalidade = 1 arquivo + 1 registro.
- **Tactic alvo**: Defer Binding
- **Severidade**: P3
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-modifiability-5
- **Métricas de sucesso**:
  - Arquivos tocados por nova modalidade: ~5 → 2
- **Risco de não fazer**: baixo; custo concentrado numa mudança futura.
- **Dependências**: demanda de nova modalidade.

## 6. Notas do agente

- Escopo: só arquivos do delta; fan-in medido por regex estática (`/<Nome>(.js)?'`) sobre os módulos tocados, não sobre todo `domain/service/`.
- Pontos positivos do delta: libs puras pequenas, erros tipados, sem ciclos, sem magic numbers, sem JOINs, testes por módulo.
- Cross-QA: RemessaService grande/complexo reduz Testability; flags novas em `EnvironmentVars` tocam Deployability; fronteira rota→repository toca Integrability. Nenhum P0.
