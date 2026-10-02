---
qa: Modifiability
qa_slug: modifiability
run_id: 2026-10-02-1636-auth-senha-propria
agent: qa-modifiability
generated_at: 2026-10-02T16:50:00Z
scope: backend
score: 8
findings_count: 3
cards_count: 3
---

# Modifiability — Regis-Review

## 1. Cenário Geral (Bass General Scenario)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Desenvolvedor Kavex | Mudar a política de senha (mínimo, bytes) ou o limite de tentativas da troca da própria senha | `PasswordPolicy`, `OwnPasswordService`, `rateLimit.ts`, `routes/me.ts` | Desenvolvimento, `AUTH_PROVIDER` local ou supabase | Alterar em um ponto, sem tocar em handlers ou no cliente GoTrue | ≤ 2 arquivos de produção + testes; 0 redeploy de infra além do build |

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| LOC dos arquivos novos do delta (`OwnPasswordService`, `PasswordPolicy`, `me.ts`) | 206 / 44 / 184 | ≤ 400 | ✅ | `wc -l` |
| Arquivos tocados do delta acima de 600 LOC | 1 (`UserRepository.ts`, 664, pré-existente) | 0 | ⚠️ | `wc -l` |
| Imports de `OwnPasswordService.ts` | 15 | ≤ 15 | ⚠️ (no limite) | `grep -c '^import '` |
| Imports de `routes/me.ts` | 18 | ≤ 15 | ⚠️ | idem |
| Violações de camada no delta (route → client) | 1 (`me.ts` importa `ConexosSessionResolver`, 2 ocorrências) | 0 | ⚠️ | `grep` |
| Imports de `lambda/` em `domain/` | 0 | 0 | ✅ | `grep -rn "from '.*lambda/" domain` |
| Avisos de cognitive complexity nos arquivos do delta (`me.ts`, `domain/service/auth`, `rateLimit.ts`) | 0 | 0 | ✅ | `biome lint` (baseline: 76 avisos, todos pré-existentes) |
| Números mágicos novos no delta | 1 em `rateLimit.ts` (`OWN_PASSWORD_WINDOW_MS = 15 * 60_000`); `MAXIMO_BYTES = 72` é limite técnico do bcrypt | 0 não-nomeados | ⚠️ | `grep` |
| Fan-in de `PasswordPolicy` | 4 | — | ✅ | grep de imports |
| Dependência circular introduzida | 0 (não medido com madge; rastreado à mão nos 3 serviços novos) | 0 | ✅ | inspeção manual |
| p50 / p95 LOC do backend inteiro | ⚠️ Não medido (`--quick`, fora do escopo do delta) | p50 ≤ 150 | — | — |

### Apêndice A — Top-10 maiores arquivos (backend, não-teste; pré-existentes, nenhum do delta)

| # | Arquivo | LOC |
|---|---|---|
| 1 | `domain/service/recebimentos/RecebimentoNumerarioService.ts` | 2415 |
| 2 | `domain/service/sispag/RemessaService.ts` | 1602 |
| 3 | `domain/client/ConexosGerDocProcessoClient.ts` | 1300 |
| 4 | `domain/service/permutas/ReconciliacaoPermutaService.ts` | 1160 |
| 5 | `domain/service/permutas/EleicaoPermutasService.ts` | 1143 |
| 6 | `domain/client/ConexosSispagWriteClient.ts` | 1090 |
| 7 | `domain/repository/sispag/LotePagamentoRepository.ts` | 1047 |
| 8 | `routes/permutas.ts` | 1002 |
| 9 | `routes/recebimentos.ts` | 1000 |
| 10 | `routes/sispag.ts` | 924 |

### Apêndice B — Top-10 serviços por fan-in (arquivos não-teste que importam)

| # | Serviço | Fan-in |
|---|---|---|
| 1 | `LogService` | 48 |
| 2 | `NotificacaoService` | 5 |
| 3 | `SincronizacaoLoteService` | 4 |
| 4 | `PasswordPolicy` (delta) | 4 |
| 5 | `ErpErrorInterpreter` | 4 |
| 6 | `EleicaoPermutasService` | 4 |
| 7 | `VariacaoCambialPermutaService` | 3 |
| 8 | `SispagPainelService` | 3 |
| 9 | `SaldoAlocacaoAdiantamentoService` | 3 |
| 10 | `ReconciliacaoPermutaService` | 3 |

`LogService` com fan-in 48 é o ponto de maior ondulação; é uma fachada estável (`@singleton`).

## 3. Tactics — Cobertura

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Split Module | Delta separa política (`PasswordPolicy`), orquestração (`OwnPasswordService`), erros e limiter em arquivos pequenos; `UserRepository` (664) e `SupabaseAuthClient` (434) seguem grandes | ⚠️ parcial | `wc -l` |
| Increase Semantic Coherence | `OwnPasswordService` toca uma entidade (usuário/senha) e a trilha de acesso; `CredentialMirror` ganhou o ramo `tokenDoChamador` | ✅ presente | `domain/service/auth/` |
| Encapsulate | Interface `PasswordPolicy` em `domain/interface/auth`; GoTrue encapsulado em `SupabaseAuthClient.updateOwnPassword`; `LOGOUT_SCOPE` constante tipada | ✅ presente | `domain/interface/auth/*` |
| Use an Intermediary | `CredentialMirror` intermedia banco e GoTrue; handler delega ao service | ✅ presente | `CredentialMirror.ts` |
| Restrict Dependencies | `me.ts` importa `ConexosSessionResolver` (client) direto; o resto passa por service | ⚠️ parcial | `routes/me.ts:7` |
| Refactor | `UserRepository.updatePassword` unificado em caminho transacional único com evento (menos ramos) | ✅ presente | `UserRepository.ts` |
| Abstract Common Services | `LogService`, `redact.ts` (`senhaAtual`/`novaSenha`), `rateLimit.ts` reutilizados | ✅ presente | `http/redact.ts` |
| Defer Binding (config/polimorfismo) | `AUTH_PROVIDER` alterna local/supabase em runtime; limites de rate e janela são constantes de código, não configuração | ⚠️ parcial | `rateLimit.ts:28-32,89` |

## 4. Findings (achados)

### F-modifiability-1: limiter da troca de senha com limites fixos em código

- **Severidade**: P3
- **Tactic violada**: Defer Binding
- **Localização**: `src/backend/http/rateLimit.ts:89` (e constantes vizinhas `:28-32`)
- **Evidência (objetiva)**:
  ```
  export const OWN_PASSWORD_WINDOW_MS = 15 * 60_000;
  ```
  Quantidade de falhas (5) e janela (15 min) não passam por `EnvironmentProvider`.
- **Impacto técnico**: ajustar o limite exige novo build/deploy.
- **Impacto de negócio**: baixo; ajuste de limite em incidente de brute-force espera um deploy.
- **Métrica de baseline**: 1 constante nova de janela + 1 de contagem fixas; 0 configuráveis.

### F-modifiability-2: `routes/me.ts` com 18 imports e acesso direto a client

- **Severidade**: P2
- **Tactic violada**: Restrict Dependencies
- **Localização**: `src/backend/routes/me.ts:7`
- **Evidência (objetiva)**:
  ```
  18 imports routes/me.ts ; import ConexosSessionResolver from '../domain/client/ConexosSessionResolver.js';
  ```
  O `ConexosSessionResolver` já era usado pelas rotas `/me` antes do delta; o arquivo passou a ter 184 LOC e 18 imports.
- **Impacto técnico**: fan-out acima de 15; o handler conhece um client. Mudar a resolução de sessão toca a rota.
- **Impacto de negócio**: retrabalho em mudanças de auth do Conexos.
- **Métrica de baseline**: fan-out 18 (alvo ≤ 15); 1 bypass de camada, sem violação de integridade.

### F-modifiability-3: `UserRepository` (664 LOC) e `SupabaseAuthClient` (434 LOC) em crescimento

- **Severidade**: P2
- **Tactic violada**: Split Module
- **Localização**: `src/backend/domain/repository/auth/UserRepository.ts`, `src/backend/domain/client/SupabaseAuthClient.ts`
- **Evidência (objetiva)**:
  ```
  664 UserRepository.ts ; 434 SupabaseAuthClient.ts ; 452 AccessRepository.ts ; 473 UserAdminService.ts
  ```
- **Impacto técnico**: `UserRepository` passou do limite de 600 LOC; cada nova mutação do usuário aumenta o arquivo. O delta é pequeno, mas empurra o arquivo adiante.
- **Impacto de negócio**: o ADR-0059 é a segunda mudança de senha em pouco tempo; a próxima (ex.: reset por e-mail) cai no mesmo arquivo.
- **Métrica de baseline**: 664 LOC (alvo ≤ 600); 0 funções com cognitive complexity acima de 15 no delta.

## 5. Cards Kanban

### [modifiability-1] Externalizar limites do limiter da troca de senha

- **Problema**
  > Contagem de falhas e janela de 15 min do `buildOwnPasswordLimiter` são constantes de código (`rateLimit.ts:89`). Alterar exige build e deploy.

- **Melhoria Proposta**
  > Defer Binding: ler os limites via `EnvironmentProvider` com default igual ao atual, e juntar as constantes de limiter em um só objeto de configuração. Tocar `http/rateLimit.ts` e o provider.

- **Resultado Esperado**
  > Limites ajustáveis por env: 0 → 2 parâmetros configuráveis, defaults inalterados e testados.

- **Tactic alvo**: Defer Binding
- **Severidade**: P3
- **Esforço estimado**: S
- **Findings relacionados**: F-modifiability-1
- **Métricas de sucesso**:
  - Limites configuráveis do limiter: 0 → 2
- **Risco de não fazer**: ajuste de limite em incidente espera deploy; efeito pequeno.
- **Dependências**: nenhuma

### [modifiability-2] Tirar `ConexosSessionResolver` do handler `/me`

- **Problema**
  > `routes/me.ts` tem 18 imports e usa um client direto (`:7`), fora da cadeia Handler → Service.

- **Melhoria Proposta**
  > Restrict Dependencies: mover a resolução de sessão Conexos para um service de `/me` e deixar a rota só com HTTP, validação Zod e chamada ao service. Pode aproveitar a migração proporcional do legado.

- **Resultado Esperado**
  > Fan-out de `me.ts` 18 → ≤ 12; bypass de camada 1 → 0.

- **Tactic alvo**: Restrict Dependencies
- **Severidade**: P2
- **Esforço estimado**: S
- **Findings relacionados**: F-modifiability-2
- **Métricas de sucesso**:
  - Imports de `me.ts`: 18 → ≤ 12
  - Imports de client em rotas `/me`: 1 → 0
- **Risco de não fazer**: toda mudança de auth do Conexos continua tocando a rota.
- **Dependências**: nenhuma

### [modifiability-3] Quebrar `UserRepository` por responsabilidade

- **Problema**
  > `UserRepository` tem 664 LOC e acumula leitura, escrita de credencial e trilha. `SupabaseAuthClient` tem 434 LOC.

- **Melhoria Proposta**
  > Split Module: extrair as mutações de credencial (`updatePassword` e afins) para um `UserCredentialRepository`, mantendo a transação e o evento de trilha. Fazer só quando o próximo `/feature-tweak` tocar o arquivo.

- **Resultado Esperado**
  > `UserRepository` 664 → ≤ 450 LOC; nenhum arquivo do módulo auth acima de 600 LOC.

- **Tactic alvo**: Split Module
- **Severidade**: P2
- **Esforço estimado**: M
- **Findings relacionados**: F-modifiability-3
- **Métricas de sucesso**:
  - LOC de `UserRepository.ts`: 664 → ≤ 450
- **Risco de não fazer**: o arquivo passa de 800 LOC na próxima feature de auth.
- **Dependências**: nenhuma

## 6. Notas do agente

- Escopo: só o delta da feature. Nenhum P0 e nenhum P1 introduzido; o delta é bem fatiado em arquivos de 44–206 LOC. O top-10 de maiores arquivos é dívida pré-existente fora do delta.
- Cross-QA: o item F-2 (Restrict Dependencies) toca Integrability; o F-3 (Split Module) toca Testability; o F-1 (limites no código) toca Deployability.
- Não medido (`--quick`): madge (ciclos verificados à mão), p50/p95 global e cyclomatic top-20. Fan-in foi calculado por grep de imports, sem contar testes.
