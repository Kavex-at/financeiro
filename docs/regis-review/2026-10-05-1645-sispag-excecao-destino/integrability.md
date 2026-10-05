---
qa: Integrability
qa_slug: integrability
run_id: 2026-10-05-1645
agent: qa-integrability
generated_at: 2026-10-05T16:50:00-03:00
scope: all
score: 7
findings_count: 3
cards_count: 3
---

# Integrability — Regis-Review

## 1. Cenário Geral

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Time Kavex | Trocar/atualizar a fonte de destino de pagamento (Conexos `ConexosSispagClient`) ou renomear flag de exceção | `DestinoPagamentoResolver`, `LotePagamentoService`, `EnvironmentProvider`, `routes/sispag.ts` | Desenvolvimento, Render | Mudança isolada no client; contrato HTTP/flag mantém compatibilidade | <=1 client + 1 resolver tocados; 0 serviços do escopo importando axios/fetch |

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| axios/fetch em service/repository do escopo | 0 | 0 | ✅ | grep nos 5 arquivos de domínio tocados |
| Services do escopo que injetam Client direto | 3 (Resolver, LotePagamento, Painel) | — | ⚠️ | `@inject(...Client)` |
| Collaborators Conexos no `SispagPainelService` | 4 clients (Sispag, Write, Retorno, Base) | <=2 | ⚠️ | `SispagPainelService.ts:103-107` |
| Clients Conexos com métodos genéricos vazados (escopo) | 0 (métodos de domínio: `listContasFavorecido`, `listChavesPixFavorecido`, `getDocumentoFavorecido`) | 0 | ✅ | `ConexosSispagClient.ts:518-599` |
| Env cru fora do EnvironmentProvider (escopo) | 0 (`readEnv` encapsulado) | 0 | ✅ | `EnvironmentProvider.ts:32` |
| Zod no boundary HTTP do escopo | `routes/sispag.ts` 58 ocorrências; `LotePagamentoService` 0 | ≥80% | ✅ rota | `grep z\. routes/sispag.ts` |
| Chamadas frontend via wrapper único `apiFetch` | 100% em `lib/sispag.ts` (0 `fetch(` cru nos componentes de `app/sispag`) | 1 wrapper | ✅ | `lib/sispag.ts:133,300,...` |
| Versão de API externa pinada | não medível localmente (Conexos sem versão em URL) | — | ⚠️ | n/a |
| Testes de contrato com fixtures (Conexos) | não verificados neste escopo (feature não alterou o client) | 100% | ⚠️ | fora do delta |

> ⚠️ **Não medível localmente**: taxa de erro por dependência (requer logs/produção). Recomendação: métrica por client no LogService.

## 3. Tactics — Cobertura

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Encapsulate | Conexos acessado via `ConexosSispagClient` com métodos de domínio; resolver não conhece HTTP | ✅ presente | `DestinoPagamentoResolver.ts:268-312` |
| Use an Intermediary | `DestinoPagamentoResolver` faz de ACL entre Conexos e o item de lote | ✅ presente | `DestinoPagamentoResolver.ts:131` |
| Restrict Communication Paths | Services chamam client direto; Painel acopla 4 clients | ⚠️ parcial | `SispagPainelService.ts:103-107` |
| Adhere to Standards | Zod nas rotas; REST/JSON | ✅ presente | `routes/sispag.ts:5,121` |
| Abstract Common Services | Auth/sessão no `ConexosBaseClient` compartilhado | ✅ presente | `SispagPainelService.ts:2` |
| Discover Service | SSM é alvo, não existe (Render + env) | N/A | CLAUDE.md "Estado Atual" |
| Tailor Interface | Views de API (`LotePagamentoApiView`) desacoplam contrato do modelo | ✅ presente | `LotePagamentoApiView.ts` |
| Configure Behavior | Flag `SISPAG_EXCECAO_DESTINO_ENABLED` com alias legado e default false | ✅ presente | `EnvironmentProvider.ts:35-40` |
| Manage Resources | Pool Postgres único via `PostgreeDatabaseClient`; transação via `tx` | ✅ presente | `LotePagamentoRepository.ts:98-102` |
| Orchestrate | `LotePagamentoService` orquestra Conexos + DB de forma síncrona; sem eventos | ⚠️ parcial | `LotePagamentoService.ts:186` |
| Manage Resource Coupling | Jobs `aposentar-excecoes-substituidas` desacoplam limpeza do request | ✅ presente | `_shared-metrics.md` |
| Contract testing | Sem fixture gravada de resposta Conexos neste delta | ⚠️ parcial | fora do delta |
| Versioning strategy | Alias de env (nome antigo -> novo) é shim de compatibilidade; migração 0075 aditiva | ⚠️ parcial | `EnvironmentProvider.ts:39-40` |
| Backward-compat shims | Alias `SISPAG_DESTINO_MANUAL_ENABLED` sem data de remoção | ⚠️ parcial | `EnvironmentProvider.ts:35` |
| Observability of integration failures | Logs de negação/divergência adicionados; sem contador por dependência | ⚠️ parcial | `_shared-metrics.md` (ObservabilityAdvisor) |

## 4. Findings

### F-integrability-1: Shim de env var legada sem prazo de remoção

- **Severidade**: P3
- **Tactic violada**: Configure Behavior (backward-compat shim)
- **Localização**: `src/backend/domain/libs/environment/EnvironmentProvider.ts:35-40`
- **Evidência (objetiva)**:
  ```
  const novo = this.readEnv('SISPAG_EXCECAO_DESTINO_ENABLED');
  const valor = novo !== '' ? novo : this.readEnv('SISPAG_DESTINO_MANUAL_ENABLED');
  ```
- **Impacto técnico**: duas fontes de verdade; ambiente com ambas divergentes segue o novo silenciosamente.
- **Impacto de negócio**: risco baixo de flag ligada/desligada por engano em Render.
- **Métrica de baseline**: 1 alias legado, 0 datas de remoção.

### F-integrability-2: SispagPainelService acopla 4 clients Conexos

- **Severidade**: P2
- **Tactic violada**: Restrict Communication Paths / Use an Intermediary
- **Localização**: `src/backend/domain/service/sispag/SispagPainelService.ts:103-107`
- **Evidência (objetiva)**:
  ```
  @inject(ConexosSispagClient) ... ConexosSispagWriteClient ... ConexosSispagRetornoClient ... ConexosBaseClient
  ```
- **Impacto técnico**: upgrade do Conexos ou troca do gateway de retorno (Nexxera) cascateia no serviço do painel.
- **Impacto de negócio**: custo maior das próximas integrações (Nexxera, escrita fin010).
- **Métrica de baseline**: 4 clients injetados (alvo <=2).

### F-integrability-3: Sem contract test com fixture para os métodos Conexos consumidos pelo resolver

- **Severidade**: P2
- **Tactic violada**: Contract testing
- **Localização**: `src/backend/domain/service/sispag/DestinoPagamentoResolver.test.ts` (mocks de retorno do client)
- **Evidência (objetiva)**: teste do resolver mocka `ConexosSispagClient`; parsing de resposta real não coberto neste delta.
- **Impacto técnico**: mudança de shape do Conexos só aparece em produção.
- **Impacto de negócio**: destino de pagamento errado/ausente atrasa lote SISPAG.
- **Métrica de baseline**: 0 fixtures de contrato verificadas no escopo (não medido no client).

## 5. Cards Kanban

### [integrability-1] Fixar data de remoção do alias SISPAG_DESTINO_MANUAL_ENABLED

- **Problema**
  > O alias legado coexiste com a variável nova sem prazo (`EnvironmentProvider.ts:39-40`).
- **Melhoria Proposta**
  > Registrar data em `migration-debt.md`, logar aviso quando só o nome antigo estiver setado e remover após o deploy confirmado.
- **Resultado Esperado**
  > 1 alias -> 0 aliases.
- **Tactic alvo**: Configure Behavior
- **Severidade**: P3
- **Esforço estimado**: S
- **Findings relacionados**: F-integrability-1
- **Métricas de sucesso**:
  - aliases legados: 1 -> 0
- **Risco de não fazer**: flag divergente em Render passa despercebida.
- **Dependências**: confirmar env em produção.

### [integrability-2] Extrair intermediário (gateway Conexos SISPAG) do SispagPainelService

- **Problema**
  > O painel injeta 4 clients Conexos, ampliando o raio de mudança em upgrade ou troca de provedor.
- **Melhoria Proposta**
  > Criar uma fachada de domínio (`SispagGateway`) que agregue leitura/escrita/retorno, ao tocar o painel em `/feature-tweak`.
- **Resultado Esperado**
  > Clients injetados no painel: 4 -> 1.
- **Tactic alvo**: Use an Intermediary
- **Severidade**: P2
- **Esforço estimado**: M
- **Findings relacionados**: F-integrability-2
- **Métricas de sucesso**:
  - clients injetados no painel: 4 -> 1
- **Risco de não fazer**: a integração Nexxera replica o acoplamento.
- **Dependências**: nenhuma.

### [integrability-3] Adicionar fixtures gravadas dos endpoints Conexos de favorecido

- **Problema**
  > Os testes do resolver mockam o client; o parsing de respostas reais não é fixado.
- **Melhoria Proposta**
  > Gravar respostas sanitizadas de `listContasFavorecido`, `listChavesPixFavorecido` e `getDocumentoFavorecido` e testar o parsing no `ConexosSispagClient.test.ts`.
- **Resultado Esperado**
  > Métodos com fixture: 0/3 -> 3/3.
- **Tactic alvo**: Contract testing
- **Severidade**: P2
- **Esforço estimado**: S
- **Findings relacionados**: F-integrability-3
- **Métricas de sucesso**:
  - métodos com fixture: 0/3 -> 3/3
- **Risco de não fazer**: quebra silenciosa em mudança de payload do Conexos.
- **Dependências**: nenhuma.

## 6. Notas do agente

- Escopo restrito aos arquivos do delta; os clients Conexos não foram alterados pela feature, então a análise de duplicação de auth/lock fica fora.
- Cross-QA: Zod em `routes/sispag.ts` (Security/Fault Tolerance); `SispagPainelService` com 4 clients (Modifiability).
- Nenhum P0: nenhum achado tem baseline que o justifique.
