---
qa: Integrability
qa_slug: integrability
run_id: 2026-10-05-1625
agent: qa-integrability
generated_at: 2026-10-05T16:40:00-03:00
scope: all
score: 7.5
findings_count: 3
cards_count: 3
---

# Integrability — Regis-Review

## 1. Cenário Geral (Bass General Scenario aplicado ao delta sispag-carteira-ao-abrir)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Analista abrindo `/sispag` (N abas/usuários) + cron | Carteira gravada com mais de 30 min; abertura simultânea; Conexos com sessão limitada por usuário e 403 do robô em `titulosPendentes` | `POST /sispag/carteira/atualizar`, `CarteiraAtualizacaoService`, `useCarteiraAoAbrir`, tipo espelho em `lib/sispag.ts` | Operação normal, Express/Render, ingestão síncrona ~9 s | Rodar no máximo uma ingestão por janela; contenção e falha viram estados tipados (não HTTP 409/500); front reage sem acoplamento a texto | Ingestões no Conexos por dia limitadas pelo TTL (≤48/dia + 3 crons); 0 divergências entre contrato back e front |

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Estados do contrato de resposta | 4 (`fresca`, `atualizada`, `em_andamento`, `falha_recente`) | enumerados e testados | ✅ | `CarteiraAtualizacaoService.ts:15-25` |
| Espelho front↔back do tipo `CarteiraAtualizacao` | 2 declarações manuais idênticas, 0 schema compartilhado | 1 fonte de verdade ou Zod no boundary | ⚠️ | `CarteiraAtualizacaoService.ts:27-37` vs `lib/sispag.ts` (`EstadoCarteira`/`CarteiraAtualizacao`, `as CarteiraAtualizacao`) |
| Validação Zod da resposta no front | 0 de 1 call site novo (cast `as`) | ≥80% | ❌ | `lib/sispag.ts` `atualizarCarteiraSeDefasada` |
| Teto de ingestões por abertura (pressão de sessão Conexos) | 1 por 30 min (TTL) → máx. 48/dia + 3 crons/dia; em falha, 1 por 5 min (cooldown) → máx. 12/h | proporcional ao TTL | ✅ | `CarteiraAtualizacaoService.ts:78-96`, `_shared-metrics.md` |
| Chamadas HTTP do hook por abertura em contenção | até 6 (`TENTATIVAS_REFRESH`) × 8 s ≈ 48 s | limitado | ✅ | `useCarteiraAoAbrir.ts:7-9` |
| `process.env` cru no delta | 0 (TTL/cooldown via `EnvironmentProvider`) | 0 | ✅ | `CarteiraAtualizacaoService.ts:66-68` |
| Clients com métodos HTTP genéricos vazados no delta | 0 (service não toca `ConexosClient`; reutiliza `IngestaoPagamentosService`) | 0 | ✅ | `CarteiraAtualizacaoService.ts:51-58` |
| Contract tests / fixtures | Service 151 LOC de teste, hook 72 LOC, mocks em ambos os lados; sem teste que amarre os dois tipos | par back/front verificado | ⚠️ | `_shared-metrics.md` |
| Observabilidade por dependência (taxa de erro Conexos por origem) | Não medível localmente | por `triggeredBy` | ⚠️ | Requer consulta a `pagamento_ingestao_run` em produção; `triggeredBy` `abertura:<ator>` permite separar a origem |

## 3. Tactics — Cobertura no delta

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Encapsulate | Service novo só orquestra a decisão; ingestão e Conexos ficam atrás de `IngestaoPagamentosService` | ✅ presente | `CarteiraAtualizacaoService.ts:54` |
| Use an Intermediary | `CarteiraAtualizacaoService` é intermediário entre a rota/tela e a ingestão | ✅ presente | `routes/sispag.ts` (+20) |
| Restrict Communication Paths | Rota exige `sispag:ver`, só lê o ERP (I1), `heavyRouteLimiter`; tela fala só via `lib/sispag.ts` | ✅ presente | `routes/sispag.ts` rota `/carteira/atualizar` |
| Adhere to Standards | Estados em 200 JSON em vez de 409; erro HTTP padrão `{error}`; sem versionamento de rota (`/sispag/...` sem `/v1`) | ⚠️ parcial | `routes/sispag.ts`; `lib/sispag.ts` |
| Abstract Common Services | Reuso do lock, run auditada e anti-fantasma da ingestão existente | ✅ presente | `CarteiraAtualizacaoService.ts:98-112` |
| Discover Service | N/A: sem registry; URL via `API` constante do front | N/A | Sem `infra/` |
| Tailor Interface | Resposta carrega `idadeMin`, `ultimaIngestaoEm`, `motivo` por estado | ✅ presente | `CarteiraAtualizacaoService.ts:27-37` |
| Configure Behavior | TTL e cooldown por `SISPAG_CARTEIRA_TTL_MIN`/`COOLDOWN_MIN`; inválido cai no default | ✅ presente | `EnvironmentProvider.ts` (+10) |
| Manage Resources | TTL + lock + cooldown protegem sessões Conexos; `RUN_PRESA_MS` evita run morta travar | ✅ presente | `CarteiraAtualizacaoService.ts:13,83` |
| Orchestrate | Orquestração linear e síncrona (checa TTL → checa runs → ingere); polling no cliente | ⚠️ parcial | `useCarteiraAoAbrir.ts:42-63` |
| Manage Resource Coupling | Hook acoplado a 4 strings de estado e a ~10 s de ingestão; sem push | ⚠️ parcial | `useCarteiraAoAbrir.ts:45-61` |
| Contract testing | Mocks de cada lado; sem schema compartilhado | ❌ ausente | `lib/sispag.ts` cast `as` |
| Versioning strategy | Rota sem versão; evolução do contrato depende de deploy FE+BE lockstep (já é política do repo) | ⚠️ parcial | `routes/sispag.ts` |
| Backward-compat shims | Nenhum necessário (rota nova) | N/A | Rota nova, 1 consumidor |
| Observability of integration failures | Run auditada por `triggeredBy`; sem métrica agregada | ⚠️ parcial | `_shared-metrics.md` |

## 4. Findings (achados)

### F-integrability-1: Contrato da resposta espelhado à mão e lido com cast, sem validação

- **Severidade**: P2
- **Tactic violada**: Adhere to Standards / Contract testing
- **Localização**: `src/backend/domain/service/sispag/CarteiraAtualizacaoService.ts:15-37`; `src/frontend/lib/sispag.ts` (`EstadoCarteira`, `CarteiraAtualizacao`, `return (await res.json()) as CarteiraAtualizacao`)
- **Evidência (objetiva)**:
  ```
  back:  ESTADO_CARTEIRA = {fresca, atualizada, em_andamento, falha_recente} as const
  front: type EstadoCarteira = 'fresca' | 'atualizada' | 'em_andamento' | 'falha_recente'
  ```
- **Impacto técnico**: um quinto estado no backend cai no ramo `fresca` do hook (`useCarteiraAoAbrir.ts:60-62`, é o último ramo, sem `else` explícito) e encerra o refresh sem aviso; o TypeScript não acusa porque o `as` apaga a checagem.
- **Impacto de negócio**: analista vê carteira defasada sem saber, num fluxo de pagamento.
- **Métrica de baseline**: 2 cópias manuais; 0 validações em runtime; 1 consumidor. Sem incidente medido, por isso P2.

### F-integrability-2: Hook desiste em silêncio após 6 reconferências e trata estado desconhecido como `fresca`

- **Severidade**: P2
- **Tactic violada**: Manage Resource Coupling
- **Localização**: `src/frontend/app/sispag/useCarteiraAoAbrir.ts:42-64`
- **Evidência (objetiva)**:
  ```
  for (i < TENTATIVAS_REFRESH=6) { ... em_andamento → esperar 8s; continue }
  if (vivo) setSituacao('ocioso')   // sai do laço sem recarregar nem avisar
  ```
- **Impacto técnico**: se a ingestão de outra pessoa/cron passar de ~48 s (cron do GitHub atrasa 2–5 h, mas a ingestão em si leva ~9 s), a tela termina `ocioso` com dados antigos, sem `aoAtualizar`. O acoplamento ao tempo da ingestão (comentário "~10 s") é implícito.
- **Impacto de negócio**: baixo hoje; cresce se a ingestão crescer com mais filiais.
- **Métrica de baseline**: margem 48 s / 9 s ≈ 5,3x. Sem caso observado.

### F-integrability-3: `motivo` expõe `errorMessage` bruto da última run ao navegador

- **Severidade**: P2
- **Tactic violada**: Tailor Interface
- **Localização**: `CarteiraAtualizacaoService.ts:91-95`; `useCarteiraAoAbrir.ts:50`
- **Evidência (objetiva)**:
  ```
  ...(ultima.errorMessage ? { motivo: ultima.errorMessage } : {})
  setAviso(r.motivo ?? 'a última ingestão falhou')
  ```
- **Impacto técnico**: mensagens de erro do Conexos/SQL ficam acopladas ao contrato; qualquer texto do provedor chega à UI (usuário com `sispag:ver`, escopo amplo).
- **Impacto de negócio**: possível vazamento de detalhe interno; ruído para o analista (o 403 FIN_041 do robô já é caso conhecido).
- **Métrica de baseline**: 1 campo livre por resposta `falha_recente`; não medível quanto vaza em produção. Cross-QA com Security.

## 5. Cards Kanban

### [integrability-1] Validar a resposta de `/carteira/atualizar` com Zod e fechar a união de estados

- **Problema**
  > O tipo `CarteiraAtualizacao` existe em duas cópias manuais e o front lê a resposta com `as`. Um estado novo no backend passaria despercebido no hook.
- **Melhoria Proposta**
  > Adhere to Standards: schema Zod com `z.enum` dos 4 estados em `lib/sispag.ts` (ou arquivo compartilhado), `parse` na resposta; `switch` exaustivo no hook com `never` no default; um teste de contrato que serialize a saída real do service e passe pelo schema.
- **Resultado Esperado**
  > Estado desconhecido vira erro visível. Validações de runtime: 0 → 1; cópias do tipo: 2 → 1 fonte.
- **Tactic alvo**: Adhere to Standards / Contract testing
- **Severidade**: P2
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-integrability-1, F-integrability-2
- **Métricas de sucesso**:
  - Call sites novos com validação de borda: 0 → 1
  - Ramo implícito `fresca` por estado desconhecido: 1 → 0
- **Risco de não fazer**: a próxima evolução do contrato quebra a tela sem sinal.
- **Dependências**: nenhuma.

### [integrability-2] Avisar e recarregar quando as reconferências se esgotam

- **Problema**
  > Após 6 × 8 s o hook volta para `ocioso` sem recarregar nem avisar, deixando dados antigos na tela.
- **Melhoria Proposta**
  > Manage Resource Coupling: ao esgotar o laço, setar aviso "atualização ainda em andamento" e permitir recarga manual; opcionalmente expor um `retryAfterMs` na resposta `em_andamento`, para tirar a constante de 8 s do cliente.
- **Resultado Esperado**
  > Tela nunca fica em `ocioso` com atualização pendente; saídas silenciosas: 1 → 0.
- **Tactic alvo**: Manage Resource Coupling
- **Severidade**: P3
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-integrability-2
- **Métricas de sucesso**:
  - Saídas silenciosas do laço: 1 → 0
- **Risco de não fazer**: carteira defasada percebida como atual se a ingestão passar de ~48 s.
- **Dependências**: integrability-1 (opcional).

### [integrability-3] Trocar `motivo` bruto por código de falha classificado

- **Problema**
  > `falha_recente` devolve `errorMessage` da run ao navegador, acoplando o contrato a texto de provedor.
- **Melhoria Proposta**
  > Tailor Interface: devolver `motivoCodigo` (ex.: `conexos_permissao`, `conexos_indisponivel`, `desconhecido`) e mensagem em português mapeada no front; manter a mensagem bruta apenas no log/`pagamento_ingestao_run`.
- **Resultado Esperado**
  > Texto livre no contrato: 1 campo → 0; UI com mensagem estável por código.
- **Tactic alvo**: Tailor Interface
- **Severidade**: P2
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-integrability-3
- **Métricas de sucesso**:
  - Campos de texto livre de erro no contrato: 1 → 0
- **Risco de não fazer**: detalhe interno do Conexos exibido a qualquer usuário `sispag:ver`.
- **Dependências**: nenhuma.

## 6. Notas do agente

- Escopo restrito ao delta (`--quick`); pressão de sessão Conexos avaliada pelo desenho (TTL 30 min, lock, cooldown 5 min), sem medição em produção, o que não é medível localmente.
- Ponto positivo: estados de contenção/falha em 200 tipado e sem 409, sem client genérico vazado, config por `EnvironmentProvider`.
- Cross-QA: F-integrability-3 com Security; F-integrability-1 com Testability (contrato back/front).
