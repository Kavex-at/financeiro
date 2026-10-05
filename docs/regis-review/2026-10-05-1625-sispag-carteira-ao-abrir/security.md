---
qa: Security
qa_slug: security
run_id: 2026-10-05-1625
agent: qa-security
generated_at: 2026-10-05T16:40:00-03:00
scope: backend
score: 7.5
findings_count: 3
cards_count: 3
---

# Security — Regis-Review

## 1. Cenário Geral (Bass General Scenario aplicado ao delta sispag-carteira-ao-abrir)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Usuário autenticado com `sispag:ver` (somente leitura, inclui Analista) ou script com o JWT dele | Dispara `POST /sispag/carteira/atualizar` em laço, ou lê o corpo da resposta em `falha_recente` | `CarteiraAtualizacaoService` + rota + `IngestaoPagamentosService` (leitura Conexos, escrita Postgres) | Produção, Conexos com sessões limitadas por usuário | Ingestão roda no máximo 1x por TTL (30 min); após falha só 1x por cooldown (5 min); 429 acima do limiter; nenhum detalhe interno ao navegador | Ingestões por hora por usuário no pior caso: 2 (sucesso) ou 12 (falha persistente); 0 strings de erro cru do Conexos na resposta |

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Rota nova com permissão explícita | 1/1 (`sispag:ver`) | 100% | ✅ | `src/backend/routes/sispag.ts:605-608` |
| Rota nova atrás do `sispagGate` | 1/1 (mount `/sispag`) | 100% | ✅ | `src/backend/http/buildApp.ts:158` |
| Rota nova com `heavyRouteLimiter` | sim: 10 req/min **por IP** (não por usuário) | por usuário/sessão | ⚠️ | `src/backend/http/rateLimit.ts` (`limit: 10`), `trust proxy = 1` em `buildApp.ts:49` |
| Teto de ingestões por hora (carteira ok) | 2 (TTL 30 min) | ≤ 2 | ✅ | `CarteiraAtualizacaoService.ts:78` |
| Teto de ingestões por hora (falha persistente) | 12 (cooldown 5 min) | ≤ 12 | ⚠️ | `CarteiraAtualizacaoService.ts:86-96` |
| Origem do `triggered_by` | `abertura:` + `req.user.sub` (JWT verificado), fallback `unknown`; coluna TEXT parametrizada | sem input do cliente | ✅ | `routes/sispag.ts:109,613`; `migrations/0024_pagamento_ingestao.sql:13` |
| Campos de erro cru devolvidos ao navegador | 1 (`motivo` = `run.error_message`) | 0 | ❌ | `CarteiraAtualizacaoService.ts:94` |
| Corpo do 500 genérico | `Internal server error`, sem `err.message` | sanitizado | ✅ | `http/errorMiddleware.ts:37` |
| Hardcoded secrets / SQL interpolado no delta | 0 / 0 (delta sem SQL novo; só reusa repositórios) | 0 | ✅ | leitura do delta |
| Validação de entrada | rota sem body/query; nada a validar | n/a | ✅ | `routes/sispag.ts:605-618` |

> ⚠️ **Não medível localmente**: tentativas reais de abuso em produção, 429s observados, quantas sessões Conexos foram consumidas. Requer logs do Render e do Conexos.
> ⚠️ **Não medível**: infra/Terraform/CloudTrail/GuardDuty (não existe `infra/`); `npm audit` fora do escopo (`--quick`).

## 3. Tactics — Cobertura no delta

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Detect Intrusion | Sem alarme para refresh anômalo; run auditada em `pagamento_ingestao_run` | ⚠️ parcial | `IngestaoPagamentosService.ts` (`createRun`/`finishRun`) |
| Detect Service Denial | Só o limiter por IP; sem métrica de 429 | ⚠️ parcial | `rateLimit.ts` |
| Verify Message Integrity | N/A: sem mensagem assinada nesta rota | N/A | rota sem corpo |
| Detect Message Delay | N/A: refresh síncrono | N/A | ADR-0060 |
| Identify Actors | `ator(req)` do JWT verificado vai para `triggered_by` | ✅ presente | `routes/sispag.ts:109,613` |
| Authenticate Actors | Middleware global de JWT (Supabase) antes do router | ✅ presente | `buildApp.ts` (fora do delta) |
| Authorize Actors | `sispag:ver` para ação que grava no Postgres; poderia exigir permissão própria | ⚠️ parcial | `routes/sispag.ts:607` |
| Limit Access | TTL + lock de ingestão + cooldown; só leitura no ERP (I1); não forma lote | ✅ presente | `CarteiraAtualizacaoService.ts:78-96` |
| Limit Exposure | `sispagGate` bloqueia `/sispag/*` quando `sispagEnabled` é false | ✅ presente | `http/sispagGate.ts:13-21` |
| Encrypt Data | TLS na borda (Render); delta sem dado novo em repouso | ✅ presente | n/a |
| Separate Entities | Refresh sem escrita no ERP; formação de lote separada (`sispag:executar`) | ✅ presente | `routes/sispag.ts:620-625` |
| Change Default Settings | TTL/cooldown por env com fallback seguro para valor inválido | ✅ presente | `EnvironmentProvider.ts` (`readMinutos`) |
| Validate Input | Sem entrada do cliente; `triggeredBy` montado no servidor | ✅ presente | `routes/sispag.ts:613` |
| Revoke Access | Herdado da camada de auth; delta não altera | N/A | fora do delta |
| Lock Computer | Cooldown de 5 min funciona como trava parcial após falha | ⚠️ parcial | `CarteiraAtualizacaoService.ts:86` |
| Inform Actors | `motivo` informa o usuário, mas com texto cru | ❌ mal feito | `CarteiraAtualizacaoService.ts:94` |
| Restore | Run morta (>10 min) não bloqueia; anti-fantasma por filial | ✅ presente | `CarteiraAtualizacaoService.ts:13,83` |
| Audit Trail | `pagamento_ingestao_run` com `triggered_by=abertura:<sub>` + log de negócio | ✅ presente | `IngestaoPagamentosService.ts` |

## 4. Findings (achados)

### F-security-1: `falha_recente.motivo` devolve `error_message` cru da ingestão ao navegador

- **Severidade**: P2 (sem baseline numérico de dado sensível efetivamente vazado; rebaixado de P1)
- **Tactic violada**: Inform Actors / Limit Exposure
- **Localização**: `src/backend/domain/service/sispag/CarteiraAtualizacaoService.ts:94`; origem em `IngestaoPagamentosService.ts:287` (`error.message` cru) e `resumoFalhas` (`filial N: conexos 504; ...`)
- **Evidência (objetiva)**:
  ```
  ...(ultima.errorMessage ? { motivo: ultima.errorMessage } : {}),
  errorMessage: error instanceof Error ? error.message : String(error),
  ```
  O front exibe sem filtro (`useCarteiraAoAbrir.ts:50`). O `errorMiddleware` sanitiza o 500 (`errorMiddleware.ts:37`), mas este caminho é 200 e o contorna. Qualquer usuário `sispag:ver` lê a mensagem, que pode trazer status/host do Conexos, nomes de filial e texto de erro de driver de banco.
- **Impacto técnico**: reconhecimento da topologia (host/URL do ERP, mensagens do Postgres) por perfil somente leitura; contorna a política F-security-5 já adotada.
- **Impacto de negócio**: baixo hoje (usuários internos da Columbia), mas o Analista é um perfil novo e mais amplo.
- **Métrica de baseline**: 1 campo de texto livre não sanitizado numa rota 200; 0 testes provando que a mensagem não contém host/credencial.

### F-security-2: rate limit por IP e ação de escrita sob permissão de leitura

- **Severidade**: P2 (teto medido: 12 ingestões/h na falha, 2/h no sucesso; abuso limitado, não é P1)
- **Tactic violada**: Authorize Actors / Detect Service Denial
- **Localização**: `src/backend/routes/sispag.ts:605-608`; `src/backend/http/rateLimit.ts` (`heavyRouteLimiter`, 10/min por IP)
- **Evidência (objetiva)**:
  ```
  exigirPermissao(PERMISSION.SISPAG_VER), heavyRouteLimiter,
  ```
  O contador é por IP e o escritório sai por NAT único: um usuário sozinho pode gastar o balde dos colegas (10/min) e deixá-los em 429, inclusive nas outras 6 rotas `heavyRouteLimiter` de `/sispag`. A gate real do abuso ao Conexos é o TTL (30 min) e, após erro, o cooldown (5 min): em falha persistente (ex.: 403 FIN_041 do robô) são até 12 leituras Conexos/h, a cada uma consumindo sessão do robô. Além disso `listRecentRuns(1)`/`findLatestSuccessFinishedAt` não são atômicos com `executar`: duas abas na mesma janela passam as checagens, e só o advisory lock segura a segunda (que vira `em_andamento`, ok).
- **Impacto técnico**: DoS de 429 entre colegas por IP compartilhado; consumo de sessão Conexos limitado, mas não zero.
- **Impacto de negócio**: analista fica sem poder usar o SISPAG por 1 min por rajada; sessões do robô consumidas em falha persistente.
- **Métrica de baseline**: 10 req/min por IP; 12 ingestões/h de teto na falha; ~9 s por ingestão (medido no cron de 04/10), ou seja 108 s/h de leitura Conexos no pior caso.

### F-security-3: backoff fixo, sem crescimento, e `triggered_by` sem teto de tamanho

- **Severidade**: P3 (hardening)
- **Tactic violada**: Lock Computer / Validate Input
- **Localização**: `CarteiraAtualizacaoService.ts:86-96`; `routes/sispag.ts:109`
- **Evidência (objetiva)**: cooldown constante de 5 min (`env.sispagCarteiraCooldownMin`), sem backoff; `triggeredBy: \`abertura:${ator(req)}\`` grava o `sub` do JWT sem limite (o `sub` é emitido pelo Supabase, UUID, não controlável pelo cliente; fallback literal `unknown` se `req.user` ausente, caso que a camada de auth já impede). Spoofing do ator: **não encontrado**, o valor vem do token verificado e vai por parâmetro SQL.
- **Impacto técnico**: falha persistente gera tentativa a cada 5 min indefinidamente.
- **Impacto de negócio**: ruído na tabela de runs e carga repetida no Conexos durante um incidente.
- **Métrica de baseline**: 288 tentativas/dia no teto em falha contínua (1 usuário com a tela aberta) vs. 48 com backoff exponencial até 30 min.

## 5. Cards Kanban

### [security-1] Sanitizar o `motivo` de `falha_recente` antes de devolver ao navegador

- **Problema**
  > A rota devolve `run.error_message` cru em `motivo` (`CarteiraAtualizacaoService.ts:94`) para qualquer `sispag:ver`, num 200 que escapa do `errorMiddleware`. Pode carregar host/status do Conexos e mensagens de driver.

- **Melhoria Proposta**
  > Devolver um código estável (`conexos_indisponivel`, `permissao_robo`, `erro_interno`) mais mensagem fixa em pt-BR; manter o texto cru só em log/`pagamento_ingestao_run`. Mapear no serviço a partir de `ConexosError`/classe do erro; ajustar `useCarteiraAoAbrir.ts:50` e o teste de rota para provar que host/stack não saem.

- **Resultado Esperado**
  > Campos de erro cru na resposta: 1 → 0; teste de regressão cobrindo a mensagem de falha.

- **Tactic alvo**: Inform Actors / Limit Exposure
- **Severidade**: P2
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-security-1
- **Métricas de sucesso**:
  - strings cruas de erro Conexos/DB na resposta: 1 → 0
  - testes que afirmam ausência de host/URL em `motivo`: 0 → 1
- **Risco de não fazer**: o perfil Analista passa a ver detalhes internos do ERP e do banco; o padrão se repete em novas rotas de refresh.
- **Dependências**: nenhuma

### [security-2] Limitar o refresh por usuário e avaliar permissão própria

- **Problema**
  > `heavyRouteLimiter` conta por IP (NAT do escritório) e o refresh, que grava no Postgres e consome sessão Conexos, está sob `sispag:ver`. Um usuário esgota o balde dos colegas; em falha persistente são até 12 ingestões/h.

- **Melhoria Proposta**
  > Adicionar `keyGenerator` por `req.user.sub` num limiter dedicado a `/carteira/atualizar` (ex.: 6/min por usuário) mantendo o por IP como teto folgado. Registrar no ADR-0060 a decisão consciente de manter `sispag:ver` (ação idempotente, só lê o ERP, gated por TTL) ou criar `sispag:atualizar`. Opcional: mover a checagem TTL+cooldown para dentro do lock para eliminar a janela entre leitura e `executar`.

- **Resultado Esperado**
  > Rajada de um usuário não gera 429 para os demais; teto de ingestões por usuário documentado e testado.

- **Tactic alvo**: Authorize Actors / Detect Service Denial
- **Severidade**: P2
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-security-2
- **Métricas de sucesso**:
  - chave do limiter: IP → `sub` + IP
  - usuários afetados por rajada de outro: todos do NAT → 0
- **Risco de não fazer**: um usuário (ou script com o JWT dele) trava o SISPAG de todo o escritório por minuto, repetidamente.
- **Dependências**: nenhuma

### [security-3] Backoff crescente no cooldown após falha repetida

- **Problema**
  > O cooldown é fixo em 5 min (`CarteiraAtualizacaoService.ts:86`): com o robô sem permissão (403 FIN_041) e uma tela aberta o sistema tenta 288 vezes por dia.

- **Melhoria Proposta**
  > Calcular o cooldown a partir do número de falhas consecutivas em `listRecentRuns(N)` (5, 10, 20, 30 min com teto no TTL). Tactic Lock Computer. Alarme/log de aviso quando 3 falhas seguidas forem atingidas.

- **Resultado Esperado**
  > Tentativas/dia no pior caso: 288 → ≤ 48.

- **Tactic alvo**: Lock Computer
- **Severidade**: P3
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-security-3
- **Métricas de sucesso**:
  - teto de tentativas/dia em falha contínua: 288 → 48
- **Risco de não fazer**: carga repetida e ruído de runs em cada incidente do Conexos.
- **Dependências**: nenhuma

## 6. Notas do agente

- Escopo: só o delta (`74bdfe5`, `0c6b649`, `f25c7e6`), `--quick`; sem npm audit, sem infra (inexistente).
- Não encontrado: spoofing de `triggered_by`, SQL interpolado, segredo hardcoded no delta. `sispagGate` cobre a rota nova (nega tudo quando `sispagEnabled=false`).
- Cross-QA: Limit Exposure/DoS cruza com Availability (sessões Conexos); `motivo` cru cruza com Fault Tolerance (mensagens de erro) e Integrability.
