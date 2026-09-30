---
qa: Security
qa_slug: security
run_id: 2026-09-30-1459-metricas-sispag
agent: qa-security
generated_at: 2026-09-30T15:30:00-03:00
scope: all
score: 8.5
findings_count: 2
cards_count: 2
---

# Security — Regis-Review

## 1. Cenário Geral (Bass General Scenario)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Usuário autenticado sem `sispag:ver` (ou conta de report) | Chama `GET /metricas/ciclo` ou abre `/metricas` esperando ver valores de pagamento | Função `metricas.metricas_ciclo`, rota `/metricas/ciclo`, página `/metricas` | Produção Express/Render, Postgres Supabase, single-tenant Columbia | Só quem tem `metricas:ver` lê agregados; a função não amplia privilégio (sem SECURITY DEFINER); só agregados saem, nunca linhas de título | 0 execuções com privilégio elevado; 0 dado por título/fornecedor/CNPJ exposto; 100% das rotas de `/metricas` com `exigirPermissao` |

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Segredos hardcoded no delta | 0 | 0 | ✅ | `git diff origin/main HEAD` (nenhum token/senha/chave) |
| Rotas do delta com authz | 1/1 (`GET /metricas/ciclo` com `exigirPermissao(METRICAS_VER)`) | 100% | ✅ | `src/backend/routes/metricas.ts:45-47` |
| Input validado com Zod | 1/1 (`cicloQuerySchema.safeParse`) | 100% | ✅ | `routes/metricas.ts:48` |
| SQL não parametrizado no delta | 0 (função SQL estática; `encerrado_em` sem interpolação) | 0 | ✅ | `0070_metricas_ciclo_sispag.sql`, `RemessaExecucaoRepository.ts:180-209` |
| Função com SECURITY DEFINER | 0 | 0 | ✅ | `0070...sql:64-67` (`STABLE`, `SET search_path = ''`, tudo qualificado com `public.`/`pg_catalog.`) |
| EXECUTE revogado de PUBLIC | sim | sim | ✅ | `0070...sql:264` |
| `dangerouslySetInnerHTML` no delta | 0 | 0 | ✅ | `src/frontend/app/metricas/page.tsx` |
| Dado por título exposto na tela | 0 (só agregados: % e R$ por semana) | 0 | ✅ | rótulo traz contagens, não identificadores |
| Usuários com `metricas:ver` sem `sispag:ver` | Não medido: a concessão é por usuário no banco | 0 ou aceito por escrito | ⚠️ | `domain/interface/auth/Permission.ts:26,42-56` |
| Exposição em produção (contexto) | 2 títulos / R$ 2.131,16 e 11 títulos / R$ 8.832,91 por semana | n/a | info | `_shared-metrics.md` |
| CloudTrail/GuardDuty, IAM, CORS, npm audit | ⚠️ Não medível: sem `infra/`; nenhum arquivo de dependência tocado | n/a | n/a | escopo do delta |

## 3. Tactics — Cobertura no delta

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Detect Intrusion | Fora do delta (pré-existente: Painel de Operação; sem CloudTrail/GuardDuty pois não há infra) | N/A | Delta não altera detecção |
| Detect Service Denial | Fora do delta; rota herda `globalLimiter` do app | N/A | `http/buildApp.ts` |
| Verify Message Integrity | N/A: o delta só lê dados internos | N/A | n/a |
| Detect Message Delay | N/A: sem mensageria no delta | N/A | n/a |
| Identify Actors | Requisição identificada pelo middleware de auth antes do router | ✅ | `buildApp.ts:170-171` |
| Authenticate Actors | Pré-existente (Supabase JWT); inalterado | ✅ | n/a |
| Authorize Actors | `metricas:ver` server-side; SISPAG novo herda a permissão de Métricas, que cruza módulo | ⚠️ parcial | `routes/metricas.ts:45-47`; F-security-1 |
| Limit Access | Sem SECURITY DEFINER, `REVOKE ALL FROM PUBLIC`, sem GRANT; `search_path=''` bloqueia sequestro de search_path | ✅ | `0070...sql:66,264` |
| Limit Exposure | Só agregados semanais; rótulo sem CNPJ, fornecedor ou número de título | ✅ | `0070...sql:224-229` |
| Encrypt Data | Pré-existente (TLS Render/Supabase); delta não altera | N/A | n/a |
| Separate Entities | Função no schema `metricas`, leitura por view; single-tenant hoje | ✅ | 0070 |
| Change Default Settings | REVOKE explícito do default `EXECUTE TO PUBLIC` do Postgres | ✅ | `0070...sql:264` |
| Validate Input | Query da rota com Zod; parâmetros da função tipados `timestamp` | ✅ | `routes/metricas.ts:48` |
| Revoke Access | Pré-existente (permissões no banco, revogáveis por usuário); inalterado | ✅ | n/a |
| Lock Computer | N/A: fora do escopo do delta | N/A | n/a |
| Inform Actors | N/A: fora do escopo do delta | N/A | n/a |
| Restore | Migration idempotente (`IF NOT EXISTS`, `CREATE OR REPLACE`); reversão documentada | ✅ | `0070...sql:25-28,38-39` |
| Audit Trail | `encerrado_em` melhora a trilha temporal de remessa (settle/fail); leitura de métricas não é auditada (pré-existente) | ⚠️ parcial | `RemessaExecucaoRepository.ts:180-209` |

## 4. Findings (achados)

### F-security-1: Valor SISPAG passa a ser visível a quem tem `metricas:ver` sem ter `sispag:ver`

- **Severidade**: P2
- **Tactic violada**: Authorize Actors (Limit Exposure como atenuante)
- **Localização**: `src/backend/routes/metricas.ts:45-47`; `src/frontend/app/metricas/page.tsx:153-169`; `src/backend/domain/interface/auth/Permission.ts:26`
- **Evidência (objetiva)**:
  ```
  router.get('/ciclo', exigirPermissao(PERMISSION.METRICAS_VER), ...)
  // SISPAG_PCT / SISPAG_RS entram na mesma resposta; nenhuma checagem de sispag:ver
  ```
- **Impacto técnico**: as permissões são por módulo e independentes. Um usuário com `metricas:ver` e sem `sispag:ver` agora lê R$ aceito e % de títulos por semana, dado que antes só o módulo SISPAG entregava. É agregado, sem títulos, fornecedores ou CNPJs, e a mesma tela já expõe R$ de Permutas e Recebimentos nesse modelo (padrão pré-existente).
- **Impacto de negócio**: o valor semanal de pagamentos a fornecedores é informação financeira sensível. Hoje são 2 a 11 títulos e R$ 2 a 9 mil por semana; a exposição é baixa, mas é um alargamento silencioso de audiência sem decisão registrada.
- **Métrica de baseline**: 0 campos por título expostos; 2 chaves agregadas novas (`sispag_titulos_aceitos_pct`, `sispag_valor_aceito`) sob `metricas:ver`. Nº de usuários com `metricas:ver` sem `sispag:ver` em produção: não medido. Sem esse número, mantido em P2.

### F-security-2: Leitura de `/metricas/ciclo` não deixa trilha de acesso

- **Severidade**: P3
- **Tactic violada**: Audit Trail
- **Localização**: `src/backend/routes/metricas.ts` (pré-existente; o delta só acrescenta dado financeiro à resposta)
- **Evidência (objetiva)**:
  ```
  Nenhum LogService/auditoria de acesso no handler /ciclo
  ```
- **Impacto técnico**: não há como responder "quem consultou o valor pago da semana X".
- **Impacto de negócio**: baixo: dado agregado, single-tenant, poucos usuários. Endurecimento opcional.
- **Métrica de baseline**: 0 registros de acesso por leitura; 1 rota afetada. Pré-existente.

## 5. Cards Kanban

### [security-1] Decidir e registrar a audiência do valor SISPAG em /metricas

- **Problema**
  > O KPI de R$ e % SISPAG passou a ser servido por `metricas:ver`, sem exigir `sispag:ver`. Não há registro de quantos usuários têm uma permissão sem a outra.

- **Melhoria Proposta**
  > Consultar em produção os usuários com `metricas:ver` e sem `sispag:ver`. Se houver, aceitar por escrito (nota na ADR-0056/0053, pois Métricas é visão gerencial) ou omitir as chaves `sispag_*` na rota quando o usuário não tiver `sispag:ver`. Tactic: Authorize Actors.

- **Resultado Esperado**
  > Audiência do dado SISPAG documentada. Usuários com metricas:ver sem sispag:ver: desconhecido → contado e aceito, ou 0.

- **Tactic alvo**: Authorize Actors
- **Severidade**: P2
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-security-1
- **Métricas de sucesso**:
  - usuários com metricas:ver sem sispag:ver: não medido → contado (0 ou aceito)
- **Risco de não fazer**: a conta `kavex-report-ciclo` ou um analista de outro módulo passa a receber valores de pagamento sem que ninguém tenha decidido isso.
- **Dependências**: nenhuma

### [security-2] Registrar em log o acesso a /metricas/ciclo

- **Problema**
  > A rota devolve agregados financeiros, agora incluindo pagamentos, e não registra quem leu (pré-existente).

- **Melhoria Proposta**
  > Log via `LogService` com usuário e janela consultada, sem valores. Baixa prioridade; junto de outras leituras sensíveis se houver trabalho de auditoria de leitura.

- **Resultado Esperado**
  > Acessos rastreáveis: 0 → 1 linha de log por consulta.

- **Tactic alvo**: Audit Trail
- **Severidade**: P3
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-security-2
- **Métricas de sucesso**:
  - leituras auditadas: 0% → 100%
- **Risco de não fazer**: sem impacto operacional relevante; só perde a capacidade forense.
- **Dependências**: nenhuma

## 6. Notas do agente

- Escopo: só o delta; sem npm audit (nenhum package.json alterado). Sem infra, IAM/CORS/CloudTrail não se aplicam.
- Pontos positivos: `SET search_path = ''` com nomes qualificados, sem SECURITY DEFINER, `REVOKE ALL FROM PUBLIC`, SQL estático, migration idempotente e backfill exato (6 settled, 4 error).
- Cross-QA: `encerrado_em` (Audit Trail) toca Fault Tolerance; migration reversível toca Deployability (Restore).
