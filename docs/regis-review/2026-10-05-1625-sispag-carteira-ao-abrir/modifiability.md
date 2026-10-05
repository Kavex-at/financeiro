---
qa: Modifiability
qa_slug: modifiability
run_id: 2026-10-05-1625
agent: qa-modifiability
generated_at: 2026-10-05T16:40:00-03:00
scope: all
score: 7.5
findings_count: 4
cards_count: 3
---

# Modifiability — Regis-Review

## 1. Cenário Geral

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Time de produto | Pede mudar o TTL, o cooldown ou a política de refresh da carteira SISPAG ao abrir a tela | `CarteiraAtualizacaoService`, `EnvironmentProvider`, `useCarteiraAoAbrir`, `routes/sispag.ts` | Desenvolvimento, Express/Render, pré-Lambda | Mudança de TTL/cooldown sem deploy de código; mudança de política localizada em 1 service + 1 hook | TTL/cooldown: 0 arquivos de código; política: ≤ 3 arquivos |

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| LOC do service novo | 114 | ≤ 400 | ✅ | `CarteiraAtualizacaoService.ts` |
| LOC do hook novo | 78 | ≤ 400 | ✅ | `useCarteiraAoAbrir.ts` |
| Fan-out do service novo (imports) | 6 | ≤ 15 | ✅ | `CarteiraAtualizacaoService.ts:1-6` |
| Camadas respeitadas (Rota → Service → Repository) | rota só resolve o service; 0 acesso a repository/client | 0 violações | ✅ | `routes/sispag.ts` diff (+20) |
| Constantes de negócio externalizadas | 2 (TTL, cooldown) via `EnvironmentProvider` | todas as regras | ⚠️ | `EnvironmentProvider.ts` diff |
| Constantes de negócio fixas no código novo | 3 (`RUN_PRESA_MS` 10 min; `ESPERA_REFRESH_MS` 8 s; `TENTATIVAS_REFRESH` 6) | externalizar as de regra | ⚠️ | `CarteiraAtualizacaoService.ts:13`, `useCarteiraAoAbrir.ts:7,9` |
| Pontos de edição por nova env var | 2 blocos duplicados no `EnvironmentProvider` (+ `EnvironmentVars.ts`) | 1 | ⚠️ | `EnvironmentProvider.ts` diff (hunks em ~L247 e ~L340) |
| Delta em arquivos já acima de 600 LOC | `routes/sispag.ts` +20 (944 LOC); `page.tsx` +22 (1325 LOC) | 0 | ⚠️ | `wc -l` |
| Biome (delta) | 0 erros; 78 warnings = baseline do repo | sem aumento | ✅ | `_shared-metrics.md` |
| Testes do delta | service 151 LOC e hook 72 LOC de teste; 198 suítes / 3644 testes verdes | verde | ✅ | `_shared-metrics.md` |
| Ciclos de dependência | não medido com madge; grafo do service novo é acíclico (6 imports, todos para baixo) | 0 | ✅ (amostra) | leitura manual |

Top-10 maiores arquivos e top-10 fan-in: **não coletados** (`--quick`, escopo = delta). Apenas os 2 arquivos tocados acima de 600 LOC estão listados acima.

> ⚠️ **Não medível localmente**: custo real de mudança em produção (lead time por feature). Requer histórico de PRs; recomendação: registrar arquivos tocados por tweak no `_coverage.json`.

## 3. Tactics — Cobertura no nf-projects

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Split Module | Lógica nova nasceu em service e hook próprios (114 e 78 LOC), não dentro de `routes/sispag.ts` nem de `page.tsx` | ✅ presente | `CarteiraAtualizacaoService.ts`, `useCarteiraAoAbrir.ts` |
| Increase Semantic Coherence | Service decide só "rodar ou não"; delega a ingestão; não forma lote (decisão 4 do ADR-0060) | ✅ presente | `CarteiraAtualizacaoService.ts:39-50` |
| Encapsulate | Rota expõe um único endpoint; estados em enum tipado `ESTADO_CARTEIRA` | ✅ presente | `CarteiraAtualizacaoService.ts:15-25` |
| Use an Intermediary | `EnvironmentProvider` para config; `runRepo` para estado das runs; relógio injetável (`agora`) | ✅ presente | `CarteiraAtualizacaoService.ts:57,62-63` |
| Restrict Dependencies | Service depende de 3 colaboradores via `@inject`; rota não toca repository | ✅ presente | `CarteiraAtualizacaoService.ts:53-58` |
| Refactor | Contrato de estados (`fresca`, `em_andamento`...) duplicado como strings no FE; env duplicada em dois blocos | ⚠️ parcial | `useCarteiraAoAbrir.ts:45-54`, `EnvironmentProvider.ts` |
| Abstract Common Services | Reutiliza `IngestaoPagamentosService` (mesmo caminho de cron e botão) e `respondLoteError` | ✅ presente | `routes/sispag.ts` diff |
| Defer Binding | TTL e cooldown por env com fallback seguro (`readMinutos`); `RUN_PRESA_MS` e polling do FE fixos | ⚠️ parcial | `EnvironmentProvider.ts` `readMinutos` |

## 4. Findings (achados)

### F-modifiability-1: delta cresce arquivos legados já acima de 600 LOC

- **Severidade**: P2
- **Tactic violada**: Split Module
- **Localização**: `src/backend/routes/sispag.ts:601-619`, `src/frontend/app/sispag/page.tsx` (+22)
- **Evidência (objetiva)**:
  ```
  944 src/backend/routes/sispag.ts      (+20 no delta)
  1325 src/frontend/app/sispag/page.tsx (+22 no delta)
  ```
- **Impacto técnico**: cada tweak soma ao mesmo arquivo; conflitos de merge e revisão mais lenta. O delta foi mínimo (42 linhas) e a lógica ficou em módulos próprios, então a contribuição é pequena.
- **Impacto de negócio**: sessões paralelas de feature no SISPAG colidem nesses dois arquivos.
- **Métrica de baseline**: 944 e 1325 LOC (alvo máx. 600). Dívida preexistente; rebaixada a P2.

### F-modifiability-2: variável de ambiente nova exige edição em dois blocos idênticos

- **Severidade**: P2
- **Tactic violada**: Refactor / Abstract Common Services
- **Localização**: `src/backend/domain/libs/environment/EnvironmentProvider.ts` (hunks +247 e +340)
- **Evidência (objetiva)**:
  ```
  sispagCarteiraTtlMin: this.readMinutos('SISPAG_CARTEIRA_TTL_MIN', 30),   // aparece 2x
  sispagCarteiraCooldownMin: this.readMinutos('SISPAG_CARTEIRA_COOLDOWN_MIN', 5), // aparece 2x
  ```
- **Impacto técnico**: o default 30/5 vive em 2 lugares; esquecer um deixa o ambiente divergente entre os dois caminhos de resolução.
- **Impacto de negócio**: TTL divergente entre caminhos faz o refresh se comportar diferente no servidor e nos jobs.
- **Métrica de baseline**: 2 sítios por var (alvo 1). A duplicação é herdada do padrão do arquivo (outras flags SISPAG fazem igual).

### F-modifiability-3: contrato de estados duplicado entre backend e frontend

- **Severidade**: P3
- **Tactic violada**: Abstract Common Services
- **Localização**: `CarteiraAtualizacaoService.ts:15-25` e `useCarteiraAoAbrir.ts:45-54`, `lib/sispag.ts`
- **Evidência (objetiva)**:
  ```
  BE: ESTADO_CARTEIRA = { FRESCA: 'fresca', ATUALIZADA: 'atualizada', EM_ANDAMENTO: 'em_andamento', FALHA_RECENTE: 'falha_recente' }
  FE: r.estado === 'atualizada' | 'falha_recente' | 'em_andamento'  (literais)
  ```
- **Impacto técnico**: um estado novo no BE não quebra o typecheck do FE se o tipo do FE for declarado à mão. Não verifiquei se `lib/sispag.ts` usa união literal; se usar, o risco cai.
- **Impacto de negócio**: baixo; tela pode ignorar um estado novo e encerrar como `ocioso`.
- **Métrica de baseline**: 4 literais duplicados.

### F-modifiability-4: parâmetros de regra fixos no código

- **Severidade**: P3
- **Tactic violada**: Defer Binding
- **Localização**: `CarteiraAtualizacaoService.ts:13`, `useCarteiraAoAbrir.ts:7,9`, `.github/workflows/ingest-sispag.yml` (`'0 10 * * *'`)
- **Evidência (objetiva)**:
  ```
  const RUN_PRESA_MS = 10 * MIN_MS;  ESPERA_REFRESH_MS = 8_000;  TENTATIVAS_REFRESH = 6
  if: github.event.schedule == '0 10 * * *'   // acoplado ao literal da lista de crons
  ```
- **Impacto técnico**: mudar o horário da formação exige editar o `cron:` e o `if:` em sincronia; mudar o polling do FE exige novo build. `RUN_PRESA_MS` (10 min) e o polling (~48 s) estão ligados à duração medida (~9 s), então mudam juntos se a ingestão ficar mais lenta.
- **Impacto de negócio**: baixo hoje.
- **Métrica de baseline**: 3 constantes fixas no código + 1 literal de cron duplicado.

## 5. Cards Kanban

### [modifiability-1] Unificar a leitura de env duplicada no EnvironmentProvider

- **Problema**
  > As env vars de TTL e cooldown aparecem em 2 blocos idênticos do `EnvironmentProvider`; os defaults 30/5 vivem em 2 lugares.
- **Melhoria Proposta**
  > Extrair as flags SISPAG para um método privado `sispagVars()` usado pelos dois blocos (ou constantes `DEFAULT_CARTEIRA_TTL_MIN`/`DEFAULT_CARTEIRA_COOLDOWN_MIN`). Tocar `EnvironmentProvider.ts`.
- **Resultado Esperado**
  > Sítios por env var SISPAG: 2 → 1.
- **Tactic alvo**: Abstract Common Services
- **Severidade**: P2
- **Esforço estimado**: S
- **Findings relacionados**: F-modifiability-2
- **Métricas de sucesso**:
  - Sítios de definição por var: 2 → 1
- **Risco de não fazer**: divergência silenciosa de default entre os caminhos de resolução.
- **Dependências**: nenhuma

### [modifiability-2] Extrair o endpoint e o hook do SISPAG dos arquivos de 900+ LOC

- **Problema**
  > `routes/sispag.ts` (944 LOC) e `page.tsx` (1325 LOC) seguem recebendo código; o delta soma 42 linhas.
- **Melhoria Proposta**
  > Mover rotas de carteira/ingestão para `routes/sispagCarteira.ts` e seções da página para componentes. Aplicar proporcionalmente em cada `/feature-tweak` que tocar a área.
- **Resultado Esperado**
  > `routes/sispag.ts` 944 → ≤ 600 LOC; `page.tsx` 1325 → ≤ 800 LOC em dois ciclos.
- **Tactic alvo**: Split Module
- **Severidade**: P2
- **Esforço estimado**: L
- **Findings relacionados**: F-modifiability-1
- **Métricas de sucesso**:
  - LOC de `routes/sispag.ts`: 944 → ≤ 600
  - LOC de `page.tsx`: 1325 → ≤ 800
- **Risco de não fazer**: conflitos de merge crescentes entre sessões paralelas de SISPAG.
- **Dependências**: nenhuma

### [modifiability-3] Alinhar contratos e parâmetros fixos (estados FE/BE, cron, polling)

- **Problema**
  > Os 4 estados da carteira são literais duplicados no FE; `RUN_PRESA_MS`, o polling e o literal de cron do workflow estão fixos.
- **Melhoria Proposta**
  > Tipar o retorno em `lib/sispag.ts` com união literal espelhando `EstadoCarteira`; derivar `RUN_PRESA_MS` de env opcional; no workflow, usar um nome de job/input em vez de comparar o literal do cron.
- **Resultado Esperado**
  > Estado novo no BE falha o typecheck do FE; mudar o horário da formação exige 1 edição.
- **Tactic alvo**: Defer Binding
- **Severidade**: P3
- **Esforço estimado**: S
- **Findings relacionados**: F-modifiability-3, F-modifiability-4
- **Métricas de sucesso**:
  - Literais de estado duplicados: 4 → 0
  - Edições para mudar o cron de formação: 2 → 1
- **Risco de não fazer**: baixo; fricção pequena em mudanças futuras.
- **Dependências**: nenhuma

## 6. Notas do agente

- Escopo: só o delta (`--quick`); top-10 de LOC e de fan-in não foram coletados, nem madge. Ciclos: amostra manual do service novo.
- Delta saudável: lógica em módulos pequenos, injeção por tsyringe, relógio injetável, config via `EnvironmentProvider`, 0 violação de camada. Nenhum P0/P1.
- Cross-QA: magic numbers e literal de cron tocam Deployability; o contrato FE/BE toca Integrability; arquivos grandes tocam Testability.
