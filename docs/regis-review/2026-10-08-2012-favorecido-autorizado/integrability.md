---
qa: Integrability
qa_slug: integrability
run_id: 2026-10-08-2012-favorecido-autorizado
agent: qa-integrability
generated_at: 2026-10-08T20:30:00-03:00
scope: all
score: 8
findings_count: 3
cards_count: 3
---

# Integrability — Regis-Review

## 1. Cenário Geral

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Time de integração | Conexos muda o shape de cadastro de favorecido (`cmn025`/contas/chaves PIX) ou a Nexxera entra como nova fonte de destino | `DestinoPagamentoResolver` + `ConexosSispagClient` + `AuthorizedPayeeService` | Operação normal, flag `sispagFavorecidoAutorizadoEnabled` ligada | A mudança fica contida no client e no resolver; as regras de autorização não são tocadas | <= 2 arquivos de produção fora do client; 0 mudanças em `AuthorizedPayeeRule` |

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Clients novos/alterados pela feature | 0 (a feature reutiliza `ConexosSispagClient`) | n/a | ✅ | `_shared-metrics.md` (lista de arquivos) |
| Services novos do delta que dependem de client externo direto | 1 (`DestinoPagamentoResolver` -> `ConexosSispagClient`, deliberado e único) | <= 1 por regra | ✅ | `DestinoPagamentoResolver.ts:102` |
| `AuthorizedPayeeService` sem acesso a client externo (só repo, resolver, db) | sim, 0 clients Conexos | 0 | ✅ | `AuthorizedPayeeService.ts:92-99` |
| `VerificacaoTedPixService` / `RemessaService` com clients Conexos diretos | 1 e 2 (pré-existente em `RemessaService`) | <= 2 | ⚠️ | `VerificacaoTedPixService.ts:116`, `RemessaService.ts:178-179` |
| Uso de axios/fetch em service/repo do delta | 0 | 0 | ✅ | grep em `domain/service/sispag`, `domain/repository/sispag`, `routes/sispag.ts` |
| `process.env` cru em service/repo/libs do delta | 0 | 0 | ✅ | grep `process\.env` |
| Config via `EnvironmentProvider` | 3 vars novas (`enabled`, `fingerprintKey`, `fingerprintKeyId`) | 100% | ✅ | `EnvironmentVars.ts:203-205` |
| Schemas Zod no boundary HTTP | 5 schemas novos (`Solicitar/Aprovar/Decidir/AutorizacaoId/FiltroAutorizacoes`) | >= 80% | ✅ | `http/schemas.ts:23-46` |
| Zod na resposta do Conexos para destino (contas/chaves/documento) | `documentoSchema.safeParse` presente; schema completo das contas e chaves não conferido | >= 80% | ⚠️ | `ConexosSispagClient.ts:724` |
| Versionamento de API externa em URL | não aplicável ao delta | n/a | ⚠️ não medível: o Conexos não expõe versão | n/a |
| Testes de contrato com fixture (client) | `ConexosSispagClient.test.ts` existe; o delta não adicionou fixture de cadastro de favorecido | 100% | ⚠️ | `ls domain/client/*.test.ts` |
| Pontos de chamada fetch no frontend | 1 wrapper (`apiFetch`) usado por `lib/sispag.ts` | 1 wrapper | ✅ | `src/frontend/lib/sispag.ts:4` |
| Observabilidade de falha por dependência | ⚠️ **Não medível localmente**: precisa de logs/CloudWatch ou métricas de produção | n/a | ⚠️ | n/a |

## 3. Tactics — Cobertura

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Encapsulate | `DestinoPagamentoResolver` é a única regra de destino, e só ele fala com o client de cadastro; o client expõe métodos de domínio (`listContasFavorecido`, `getDocumentoFavorecido`) | ✅ presente | `DestinoPagamentoResolver.ts:195-239` |
| Use an Intermediary | O resolver faz de anti-corruption layer entre Conexos e a regra de autorização; `PayeeFingerprint` isola o hash do destino | ✅ presente | `AuthorizedPayeeService.ts:94-95` |
| Restrict Communication Paths | `AuthorizedPayeeService` não importa client Conexos; `VerificacaoTedPixService` e `RemessaService` ainda importam `ConexosSispagClient` direto | ⚠️ parcial | `VerificacaoTedPixService.ts:116` |
| Adhere to Standards | Zod no HTTP, SQL parametrizado, DI tsyringe | ✅ presente | `http/schemas.ts:23` |
| Abstract Common Services | Retry/sessão do Conexos vêm de `ConexosBaseClient`, sem duplicação no delta | ✅ presente | `domain/client/ConexosBaseClient.ts` |
| Discover Service | N/A: não há infra/SSM neste repo; a config vem do `EnvironmentProvider` | N/A | CLAUDE.md |
| Tailor Interface | Os erros tipados (`AuthorizedPayee*Error`) traduzem o domínio para o HTTP | ✅ presente | `domain/errors/AuthorizedPayee*.ts` |
| Configure Behavior | Flag `sispagFavorecidoAutorizadoEnabled`, que cai para `false` se a chave tiver < 32 bytes; `keyId` permite rotação | ✅ presente | `EnvironmentVars.ts:193-205` |
| Manage Resources | Memoização por contexto no resolver reduz chamadas ao Conexos | ✅ presente | `DestinoPagamentoResolver.ts:190` |
| Orchestrate | `VerificacaoTedPixService` orquestra linearmente 9 colaboradores (hotspot) | ⚠️ parcial | `VerificacaoTedPixService.ts:114-122` |
| Manage Resource Coupling | Sem eventos; acoplamento síncrono em processo | ⚠️ parcial | idem |
| Contract testing | Sem fixture gravada do cadastro de favorecido no delta | ⚠️ parcial | `ConexosSispagClient.test.ts` |
| Versioning strategy | Sem versionamento (limitação do Conexos); a chave HMAC tem `keyId` | ⚠️ parcial | `.env.example:157-159` |
| Backward-compat shims | Flag desligada preserva o comportamento antigo (exceção de destino), com custo de dois caminhos | ⚠️ parcial | `ExcecaoSubstituicaoService.ts`, `aposentar-excecoes-substituidas.ts` |
| Observability of integration failures | Falhas passam pelo `LogService`; não há taxa de erro por dependência | ⚠️ parcial | `AuthorizedPayeeService.ts:99` |

## 4. Findings

### F-integrability-1: Orquestrador de verificação TED/PIX acumula 9 colaboradores

- **Severidade**: P2
- **Tactic violada**: Restrict Communication Paths / Orchestrate
- **Localização**: `src/backend/domain/service/sispag/VerificacaoTedPixService.ts:114-122`
- **Evidência (objetiva)**:
  ```
  loteRepo, alertaRepo, ConexosSispagClient, resolver, payees, detector, environmentProvider, db, logService
  ```
- **Impacto técnico**: Trocar ou evoluir o client de cadastro obriga a tocar este serviço e o resolver, porque o serviço ainda chama o `ConexosSispagClient` diretamente.
- **Impacto de negócio**: Cada integração nova (Nexxera, GED) encarece a manutenção da guarda de pagamento.
- **Métrica de baseline**: 9 dependências no construtor; 1 client externo direto.

### F-integrability-2: Sem fixture de contrato para o cadastro de favorecido

- **Severidade**: P2
- **Tactic violada**: Contract testing
- **Localização**: `src/backend/domain/client/ConexosSispagClient.test.ts`
- **Evidência (objetiva)**: o delta lista 0 arquivos de client e 0 fixtures novas de contas, chaves PIX ou documento do favorecido.
- **Impacto técnico**: Uma mudança de shape no Conexos só aparece em runtime, e a guarda de autorização depende desse shape para o fingerprint do destino.
- **Impacto de negócio**: Uma mudança silenciosa pode gerar falsos `DESTINO_ALTERADO` e bloquear remessas.
- **Métrica de baseline**: 0 fixtures de cadastro de favorecido no delta.

### F-integrability-3: Dois caminhos de destino convivem atrás de flag

- **Severidade**: P3
- **Tactic violada**: Backward-compatibility shims
- **Localização**: `ExcecaoSubstituicaoService.ts`, `src/backend/jobs/aposentar-excecoes-substituidas.ts`
- **Evidência (objetiva)**: o legado de exceção de destino e o novo favorecido autorizado coexistem, e a flag `sispagFavorecidoAutorizadoEnabled` escolhe entre eles.
- **Impacto técnico**: Duplicação de regra enquanto a flag existir.
- **Impacto de negócio**: Baixo, desde que a aposentadoria seja concluída.
- **Métrica de baseline**: 2 caminhos de autorização de destino.

## 5. Cards Kanban

### [integrability-1] Isolar o acesso ao cadastro do Conexos no resolver

- **Problema**
  > `VerificacaoTedPixService` injeta `ConexosSispagClient` ao lado do `DestinoPagamentoResolver`, que já é a única regra de destino. Há dois caminhos até o Conexos.
- **Melhoria Proposta**
  > Mover as leituras restantes do client para métodos do resolver ou de um port de cadastro. O serviço passa a depender só do resolver.
- **Resultado Esperado**
  > Clients Conexos diretos em `VerificacaoTedPixService`: 1 -> 0.
- **Tactic alvo**: Restrict Communication Paths
- **Severidade**: P2
- **Esforço estimado**: S
- **Findings relacionados**: F-integrability-1
- **Métricas de sucesso**:
  - Clients diretos no serviço: 1 -> 0
- **Risco de não fazer**: Cada mudança no cadastro continua tocando dois serviços.
- **Dependências**: nenhuma

### [integrability-2] Gravar fixtures do cadastro de favorecido no teste do client

- **Problema**
  > O fingerprint do destino depende do shape de contas, chaves e documento do Conexos, e não há fixture real para travar esse shape.
- **Melhoria Proposta**
  > Adicionar fixtures redigidas (como `redigir-fixture-rem.ts`) e testes de parsing em `ConexosSispagClient.test.ts`. Validar o schema completo com Zod.
- **Resultado Esperado**
  > Fixtures de cadastro de favorecido: 0 -> 3 (contas, chaves PIX, documento).
- **Tactic alvo**: Contract testing
- **Severidade**: P2
- **Esforço estimado**: S
- **Findings relacionados**: F-integrability-2
- **Métricas de sucesso**:
  - Fixtures de cadastro: 0 -> 3
- **Risco de não fazer**: Falsos `DESTINO_ALTERADO` por mudança de shape sem aviso.
- **Dependências**: nenhuma

### [integrability-3] Aposentar o caminho legado de exceção de destino

- **Problema**
  > Depois que a flag for ligada em produção, o caminho legado vira código morto com custo de manutenção.
- **Melhoria Proposta**
  > Remover o legado e a flag depois de uma janela estável, usando `aposentar-excecoes-substituidas`.
- **Resultado Esperado**
  > Caminhos de autorização de destino: 2 -> 1.
- **Tactic alvo**: Backward-compatibility shims
- **Severidade**: P3
- **Esforço estimado**: M
- **Findings relacionados**: F-integrability-3
- **Métricas de sucesso**:
  - Caminhos de autorização: 2 -> 1
- **Risco de não fazer**: Divergência de regra entre os dois caminhos.
- **Dependências**: flag ligada e estável em produção

## 6. Notas do agente

- O escopo foi o delta; a feature não cria client novo e reaproveita `ConexosSispagClient`, então a integrabilidade fica boa.
- Não medi o Zod completo das respostas do Conexos nem a taxa de erro por dependência.
- Cruza com Modifiability (Encapsulate) e Security (o segredo do fingerprint vem do `EnvironmentProvider`).
- Nenhum P0 encontrado.
