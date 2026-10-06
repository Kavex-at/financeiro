---
qa: Modifiability
qa_slug: modifiability
run_id: 2026-10-06-1356
agent: qa-modifiability
generated_at: 2026-10-06T14:10:00-03:00
scope: backend
score: 7
findings_count: 4
cards_count: 3
---

# Modifiability — Regis-Review

## 1. Cenário Geral

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Analista/Kavex (mantenedor) | Mudar uma regra de verificação TED/PIX (ex.: janela de duplicidade, limiar de perfil de canal, regra L12/L13) | Serviços `domain/service/sispag/*` novos, `routes/sispag.ts`, `LotePagamentoRepository` | Desenvolvimento, pós-merge da feature | Alteração localizada em 1 serviço + seu teste, sem tocar rota/repositório alheio | <= 3 arquivos de produção por mudança de regra; nenhum arquivo > 600 LOC tocado |

## 2. Métricas observadas

Escopo: delta da feature (137 arquivos, +14.901/-276). Fan-in medido por import no código não-teste.

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| LOC dos serviços novos (Conferencia 142, DuplicateDetector 126, DuplicateResolution 188, Pendencia 95, PerfilCanal 244, ChannelProfileCalculator 189, VerificacaoTedPix 490) | max 490, p50 ~189 | max <= 600 | ✅ | `wc -l` |
| Arquivos > 600 LOC tocados pelo delta | 4 (RemessaService 1637 +9; routes/sispag.ts 1163 +153; LotePagamentoRepository 1060 +210; ConexosSispagClient 828 +112) + LotePagamentoService 607 (+175/-69) | 0 | ❌ | `git diff --numstat`, `wc -l` |
| Violações cross-layer novas (rota importa client/repository) | rotas: 1 client + 3 repositories (`routes/sispag.ts:7,10-12`), pré-existentes; 0 novas apuradas; 0 domain->lambda | 0 | ⚠️ | `grep` |
| Fan-out máx. nos arquivos novos | VerificacaoTedPixService 14 imports; routes/sispag.ts 34 | <= 15 | ⚠️ (rota) | `grep -c '^import '` |
| Funções com complexidade cognitiva > 15 no delta | 0 nos arquivos 100% novos; pré-existentes tocados: RemessaService (95, 38), LotePagamentoRepository (20) | 0 | ⚠️ | `biome lint` |
| Lint global backend | 86 warnings (total do repo) | tendência ↓ | ⚠️ | `_shared-metrics.md` |
| Fan-in dos serviços novos | DuplicateDetector 2; Conferencia/VerificacaoTedPix/PerfilCanal/Pendencia/DuplicateResolution 1 cada; LotePagamentoService 4; RemessaService 2 | n/a (baixo = ripple pequeno) | ✅ | `grep` de imports |
| Números mágicos em serviços novos | `DIA_MS = 86_400_000` duplicado em 3 arquivos; `FATIA_EXTRATO_MS = 30*DIA_MS` | 0 duplicados / regra configurável | ⚠️ | `grep` |
| Ciclos de dependência | 0 encontrados na amostra de 5 serviços novos (3 hops) | 0 | ✅ | trace manual |

Apêndice A — Top-10 maiores arquivos tocados pelo delta (não-teste)

| # | LOC | Imports | Arquivo |
|---|---|---|---|
| 1 | 1637 | 31 | domain/service/sispag/RemessaService.ts |
| 2 | 1163 | 34 | routes/sispag.ts |
| 3 | 1060 | 6 | domain/repository/sispag/LotePagamentoRepository.ts |
| 4 | 828 | 5 | domain/client/ConexosSispagClient.ts |
| 5 | 670 | 20 | domain/service/sispag/SispagPainelService.ts |
| 6 | 607 | 25 | domain/service/sispag/LotePagamentoService.ts |
| 7 | 490 | 14 | domain/service/sispag/VerificacaoTedPixService.ts |
| 8 | 310 | 13 | domain/service/sispag/IngestaoPagamentosService.ts |
| 9 | 244 | n/m | domain/service/sispag/PerfilCanalService.ts |
| 10 | 189 | n/m | domain/service/sispag/ChannelProfileCalculator.ts |

Apêndice B — Top-10 fan-in (serviços do delta; só 8 existem no escopo)

| # | Fan-in | Serviço |
|---|---|---|
| 1 | 4 | LotePagamentoService |
| 2 | 2 | RemessaService |
| 3 | 2 | DuplicateDetector |
| 4 | 1 | ConferenciaLoteService |
| 5 | 1 | VerificacaoTedPixService |
| 6 | 1 | PerfilCanalService |
| 7 | 1 | PendenciaCadastroService |
| 8 | 1 | DuplicateResolutionService |

> ⚠️ **Não medível localmente**: p50/p95 de LOC do repositório inteiro e cyclomatic top-20 (escopo quick = delta). Recomendação: rodar o `find|wc` completo no próximo ciclo full.

## 3. Tactics — Cobertura

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Split Module | Feature nova nasceu em 7 serviços coesos pequenos; porém a integração engordou os monólitos (LotePagamentoRepository +210, routes +153, LotePagamentoService +175) | ⚠️ parcial | `git diff --numstat` |
| Increase Semantic Coherence | Um serviço por conceito (detecção, resolução, conferência, pendência, perfil); regra pura L12/L13 isolada em `libs/sispag/ConferenciaLoteRule.ts` | ✅ presente | `domain/libs/sispag/ConferenciaLoteRule.ts` |
| Encapsulate | Clients Conexos encapsulam fin064/cmn025; erros de domínio tipados (8 novos) | ✅ presente | `domain/errors/*Error.ts` |
| Use an Intermediary | Repositórios por agregado novo (Alerta, Bloqueio, Pendencia, PerfilCanal, VerificacaoEvento) | ✅ presente | `domain/repository/sispag/` |
| Restrict Dependencies | Rotas ainda importam client/repositories diretamente (pré-existente, não ampliado) | ⚠️ parcial | `routes/sispag.ts:7,10-12` |
| Refactor | `ChannelProfileCalculator` e `DuplicateDetector` como cálculo puro separado do IO | ✅ presente | `ChannelProfileCalculator.ts` |
| Abstract Common Services | `DIA_MS` replicado em 3 módulos em vez de util comum | ⚠️ parcial | `DuplicateDetector.ts:9`, `ChannelProfileCalculator.ts:13`, `PerfilCanalService.ts:21` |
| Defer Binding | tsyringe `@injectable`; EnvironmentProvider/EnvironmentVars estendidos; limites de staleness em `stalenessLimits.ts`; regras de janela/limiar como constantes de código | ⚠️ parcial | `EnvironmentVars.ts`, `PerfilCanalService.ts:21-23` |

## 4. Findings

### F-modifiability-1: LotePagamentoRepository cresceu +210 LOC e passa de 1000 LOC

- **Severidade**: P1
- **Tactic violada**: Split Module
- **Localização**: `src/backend/domain/repository/sispag/LotePagamentoRepository.ts` (1060 LOC; função com complexidade 20 na linha 197)
- **Evidência (objetiva)**:
  ```
  210 insertions / 5 deletions no delta; 1060 LOC; 6 imports; cognitive complexity 20 (>15)
  ```
- **Impacto técnico**: qualquer mudança de schema do lote (migrations 0076-0079 já tocam) ripples por SQL strings num arquivo único; alta chance de conflito entre PRs paralelos.
- **Impacto de negócio**: cada nova verificação SISPAG encarece o custo de mudança do coração do fluxo de pagamentos.
- **Métrica de baseline**: 1060 LOC (alvo <= 600), +24% sobre o tamanho prévio (~850).

### F-modifiability-2: routes/sispag.ts acumula +153 LOC e 34 imports, acessando repositórios/client

- **Severidade**: P1
- **Tactic violada**: Restrict Dependencies / Split Module
- **Localização**: `src/backend/routes/sispag.ts:7-12`
- **Evidência (objetiva)**:
  ```
  1163 LOC, 34 imports, +153/-1 no delta; importa ConexosSispagClient e 3 repositories diretamente
  ```
- **Impacto técnico**: o arquivo de rotas conhece camadas abaixo de Service; cada endpoint novo (duplicidade, conferência, pendências) aumenta o fan-out. A migração para Lambda exigirá partir este arquivo.
- **Impacto de negócio**: migração Lambda (alvo) mais cara; regressões em rotas não relacionadas.
- **Métrica de baseline**: 1163 LOC (alvo <= 600), fan-out 34 (alvo <= 15).

### F-modifiability-3: Regras de negócio da verificação como constantes de código e DIA_MS triplicado

- **Severidade**: P2
- **Tactic violada**: Abstract Common Services / Defer Binding
- **Localização**: `DuplicateDetector.ts:9`, `ChannelProfileCalculator.ts:13`, `PerfilCanalService.ts:21-23`
- **Evidência (objetiva)**:
  ```
  const DIA_MS = 86_400_000;   // 3 cópias
  const FATIA_EXTRATO_MS = 30 * DIA_MS;
  ```
- **Impacto técnico**: ajustar janela de 30 dias exige edição de código + redeploy; divergência silenciosa entre cópias.
- **Impacto de negócio**: calibração de limiares pelo analista depende de deploy da Kavex.
- **Métrica de baseline**: 3 duplicações; 0 parâmetros de janela/limiar externalizados.

### F-modifiability-4: VerificacaoTedPixService concentra 490 LOC e 14 imports (orquestrador)

- **Severidade**: P3
- **Tactic violada**: Split Module
- **Localização**: `src/backend/domain/service/sispag/VerificacaoTedPixService.ts`
- **Evidência (objetiva)**:
  ```
  490 LOC (dentro do alvo 600), 14 imports (limite 15), fan-in 1
  ```
- **Impacto técnico**: próximo da fronteira; nova verificação o empurra acima de 600.
- **Impacto de negócio**: baixo hoje; risco de virar o próximo RemessaService.
- **Métrica de baseline**: 490/600 LOC (82%).

## 5. Cards Kanban

### [modifiability-1] Extrair queries da conferência/duplicidade do LotePagamentoRepository

- **Problema**
  > O repositório tem 1060 LOC (+210 nesta feature) e uma função com complexidade 20; schema do lote ripples num só arquivo.
- **Melhoria Proposta**
  > Split Module: mover as queries novas (alerta/conferência/bloqueio) para os repositórios por agregado já existentes (`AlertaItemLoteRepository`, `BloqueioDuplicidadeRepository`) ou um `LoteConferenciaRepository`; refatorar a função da linha 197.
- **Resultado Esperado**
  > LotePagamentoRepository <= 700 LOC, complexidade <= 15.
- **Tactic alvo**: Split Module
- **Severidade**: P1
- **Esforço estimado**: M
- **Findings relacionados**: F-modifiability-1
- **Métricas de sucesso**:
  - LOC do repositório: 1060 → <= 700
  - Funções com complexidade > 15: 1 → 0
- **Risco de não fazer**: o arquivo passa de 1300 LOC em 6 meses com a próxima frente SISPAG.
- **Dependências**: nenhuma

### [modifiability-2] Mover endpoints de verificação para um router dedicado e remover acesso direto a repository

- **Problema**
  > `routes/sispag.ts` tem 1163 LOC e 34 imports, e importa client/repositories, furando a cadeia Service.
- **Melhoria Proposta**
  > Restrict Dependencies + Split Module: criar `routes/sispagVerificacao.ts` (duplicidade, conferência, pendências) que só resolve Services; expor via Services o que hoje vem de repository.
- **Resultado Esperado**
  > Rotas sem imports de client/repository; arquivo principal <= 800 LOC.
- **Tactic alvo**: Restrict Dependencies
- **Severidade**: P1
- **Esforço estimado**: M
- **Findings relacionados**: F-modifiability-2
- **Métricas de sucesso**:
  - Imports de repository/client em routes/sispag.ts: 4 → 0
  - Fan-out: 34 → <= 20
- **Risco de não fazer**: migração Lambda precisa partir um arquivo de 1200+ LOC sob pressão.
- **Dependências**: nenhuma

### [modifiability-3] Centralizar constantes de tempo e externalizar janelas/limiares da verificação

- **Problema**
  > `DIA_MS` replicado 3 vezes; janela de 30 dias e limiares só mudam por deploy.
- **Melhoria Proposta**
  > Abstract Common Services: `libs/time/Duration.ts` com `DIA_MS`; Defer Binding: ler janela/limiares via EnvironmentProvider com default atual.
- **Resultado Esperado**
  > 1 definição de DIA_MS; limiares ajustáveis sem alterar código.
- **Tactic alvo**: Defer Binding
- **Severidade**: P2
- **Esforço estimado**: S
- **Findings relacionados**: F-modifiability-3, F-modifiability-4
- **Métricas de sucesso**:
  - Duplicações de DIA_MS: 3 → 1
  - Parâmetros externalizados: 0 → >= 3
- **Risco de não fazer**: calibração pós-go-live exige redeploy a cada ajuste.
- **Dependências**: nenhuma

## 6. Notas do agente

- Escopo --quick: só o delta; os arquivos gigantes (RemessaService 1637, complexidade 95) são pré-existentes e o delta os tocou pouco (+9), então sem card.
- Cross-QA: Reduce Size/ciclos -> Testability; DIA_MS/limiares hardcoded -> Deployability; rotas acessando client/repository -> Integrability.
- Pontos fortes: serviços novos pequenos, coesos, fan-in baixo, regra pura L12/L13 isolada, 0 ciclos e 0 domain->lambda.
