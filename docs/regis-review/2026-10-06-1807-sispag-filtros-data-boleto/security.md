---
qa: Security
qa_slug: security
run_id: 2026-10-06-1807-sispag-filtros-data-boleto
agent: qa-security
generated_at: 2026-10-06T18:30:00-03:00
scope: all
score: 9
findings_count: 2
cards_count: 2
---

# Security — Regis-Review

## 1. Cenário Geral (Bass General Scenario aplicado ao financeiro)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Usuário autenticado (ou atacante com token roubado) | Envia `vencimentoDe`/`vencimentoAte` malformados ou maliciosos (`2026-10-31' OR 1=1`, formato BR, array repetido) em `GET /sispag/boletos-dda` | `routes/sispag.ts` (`boletosDdaSchema`) + `PaginacaoBoletoDda` | Produção Express/Render, atrás de `sispagGate` + `exigirPermissao(SISPAG_VER)` | Zod rejeita com 400 antes de qualquer lógica; valor só é comparado como string em memória, sem SQL | 100% das entradas fora de `YYYY-MM-DD` retornam 400; 0 sites de SQL novos; 0 endpoints novos sem authz |

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Segredos hardcoded no delta | 0 | 0 | ✅ | `git show 65d1fdf da095fa` (sem env/credencial no diff) |
| Novos endpoints sem authz | 0 (nenhum endpoint novo; rota existente mantém `exigirPermissao(SISPAG_VER)`) | 0 | ✅ | `src/backend/routes/sispag.ts:~879`; `buildApp.ts:158` (`sispagGate`) |
| Novos parâmetros de entrada validados com Zod | 2 / 2 | 100% | ✅ | `routes/sispag.ts` (`z.string().regex(DATA_CIVIL_REGEX).optional()`) |
| Sites de SQL não parametrizado no delta | 0 (sem SQL no delta) | 0 | ✅ | `git diff` — apenas filtro em memória |
| `dangerouslySetInnerHTML`/`innerHTML`/`localStorage` no delta frontend | 0 | 0 | ✅ | grep no diff `src/frontend` |
| Query string montada com `URLSearchParams` (sem concatenação) | sim | sim | ✅ | `src/frontend/lib/sispag.ts` (`qs.set`) |
| Testes negativos de input (formato inválido, injeção) | 2 casos (`01/10/2026`, `' OR 1=1`) | ≥1 | ✅ | `src/backend/routes/sispag.test.ts` |
| Validação semântica da data (mês/dia reais) | não (regex só valida forma) | sim | ⚠️ | `PaginacaoBoletoDda.ts` `DATA_CIVIL_REGEX` |
| Rate limit na leitura `GET /boletos-dda` | ausente (só `heavyRouteLimiter` no POST sincronizar) | presente | ⚠️ | `routes/sispag.ts` |
| Infra/IAM/CloudTrail/npm audit | ⚠️ **Não medível localmente**: sem `infra/`; delta sem dependências novas | n/a | n/a | CLAUDE.md; `_shared-metrics.md` |

## 3. Tactics — Cobertura no financeiro

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Detect Intrusion | Fora do delta (sem GuardDuty/infra) | N/A | Delta não toca detecção |
| Detect Service Denial | Sem rate limit na leitura DDA; página limitada a 100 linhas | ⚠️ parcial | `BOLETO_DDA_TAMANHO_MAX` |
| Verify Message Integrity | N/A — delta não envia mensagens a terceiros | N/A | Somente leitura |
| Detect Message Delay | N/A — sem mensageria no delta | N/A | — |
| Identify Actors | `sispagGate` herdado | ✅ presente | `buildApp.ts:158` |
| Authenticate Actors | JWT Supabase herdado; frontend usa `withAuthHeaders()` | ✅ presente | `lib/sispag.ts` |
| Authorize Actors | `exigirPermissao(SISPAG_VER)` na rota alterada; filtros client-side das abas são só apresentação e não ampliam acesso | ✅ presente | `routes/sispag.ts` |
| Limit Access | Filtro reduz o conjunto retornado; sem novo acesso a dados | ✅ presente | `PaginacaoBoletoDda.ts` |
| Limit Exposure | Resposta paginada ≤100 linhas; sem endpoint novo | ✅ presente | `routes/sispag.ts` |
| Encrypt Data | N/A — nenhum dado novo em trânsito/repouso | N/A | — |
| Separate Entities | N/A — sem mudança de fronteira de tenant | N/A | — |
| Change Default Settings | N/A | N/A | — |
| Validate Input | Zod com regex estrito nos 2 novos parâmetros; 400 em falha; comparação só por string em memória | ✅ presente (forma) / ⚠️ semântica | `routes/sispag.ts`; F-security-1 |
| Revoke Access | Fora do escopo do delta | N/A | — |
| Lock Computer | Fora do escopo do delta | N/A | — |
| Inform Actors | Fora do escopo do delta | N/A | — |
| Restore | Delta é read-only/stateless; rollback = revert do commit | N/A | — |
| Audit Trail | Delta não muta estado nem move dinheiro; filtros são leituras | N/A | Nenhuma ação financeira nova |

## 4. Findings (achados)

Nenhum P0 ou P1. O delta não introduz SQL, endpoint, segredo, dependência nem escrita no Conexos.

### F-security-1: Regex valida só a forma da data, não o calendário

- **Severidade**: P3
- **Tactic violada**: Validate Input
- **Localização**: `src/backend/domain/service/sispag/PaginacaoBoletoDda.ts` (`DATA_CIVIL_REGEX`), `src/backend/routes/sispag.ts` (`boletosDdaSchema`)
- **Evidência (objetiva)**:
  ```
  export const DATA_CIVIL_REGEX = /^\d{4}-\d{2}-\d{2}$/;   // aceita 2026-99-99
  ```
- **Impacto técnico**: `vencimentoDe=2026-99-99` passa; a comparação lexicográfica devolve conjunto vazio ou inesperado, sem 400. Não há injeção nem crash (nada chega a SQL).
- **Impacto de negócio**: Apenas UX/consistência (lista vazia sem aviso). Sem risco financeiro.
- **Métrica de baseline**: 0 vetores de exploração; 1 classe de entrada inválida aceita (datas impossíveis).

### F-security-2: Leitura `GET /sispag/boletos-dda` sem rate limit dedicado

- **Severidade**: P3
- **Tactic violada**: Detect Service Denial
- **Localização**: `src/backend/routes/sispag.ts` (rota `GET /boletos-dda`)
- **Evidência (objetiva)**:
  ```
  router.get('/boletos-dda', exigirPermissao(PERMISSION.SISPAG_VER), asyncHandler(...))  // sem limiter
  POST /boletos-dda/sincronizar usa heavyRouteLimiter
  ```
- **Impacto técnico**: Cada chamada filtra/pagina o conjunto em memória; os novos filtros acrescentam um passo O(n) por requisição. Usuário autenticado pode repetir chamadas. Custo baixo, pré-existente, só marginalmente ampliado.
- **Impacto de negócio**: Degradação de latência em abuso por usuário já autenticado; hardening, não incidente.
- **Métrica de baseline**: 1 passo O(n) adicional por requisição; 0 limiters na rota GET.

## 5. Cards Kanban

### [security-1] Validar calendário real nos parâmetros vencimentoDe/vencimentoAte

- **Problema**
  > O regex `^\d{4}-\d{2}-\d{2}$` aceita datas impossíveis (`2026-99-99`) e devolve lista vazia silenciosa em vez de 400. Sem risco de injeção, é apenas rigor de borda.

- **Melhoria Proposta**
  > Em `boletosDdaSchema`, acrescentar `.refine` que confirma que a data existe (ex.: `Date.UTC` round-trip) e, se `De > Ate`, rejeitar com 400. Reutilizar a mesma função no teste. Tactic: Validate Input.

- **Resultado Esperado**
  > Datas impossíveis ou intervalo invertido retornam 400 com mensagem clara (hoje: 200 com lista vazia).

- **Tactic alvo**: Validate Input
- **Severidade**: P3
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-security-1
- **Métricas de sucesso**:
  - Classes de data inválida aceitas: 1 → 0
- **Risco de não fazer**: Confusão operacional ocasional; nenhum risco de segurança.
- **Dependências**: nenhuma

### [security-2] Aplicar limiter de leitura às rotas de listagem SISPAG

- **Problema**
  > `GET /sispag/boletos-dda` não tem limiter; os filtros novos somam trabalho O(n) em memória por chamada.

- **Melhoria Proposta**
  > Aplicar um `readRouteLimiter` (mais frouxo que `heavyRouteLimiter`) às listagens paginadas do SISPAG. Tactic: Detect Service Denial / Limit Exposure.

- **Resultado Esperado**
  > Rajadas abusivas de um usuário retornam 429; uso normal inalterado. Limiters em rotas GET de listagem: 0 → 1.

- **Tactic alvo**: Detect Service Denial
- **Severidade**: P3
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-security-2
- **Métricas de sucesso**:
  - Rotas GET de listagem SISPAG com limiter: 0 → todas
- **Risco de não fazer**: Latência degradada sob abuso de usuário autenticado.
- **Dependências**: nenhuma

## 6. Notas do agente

- Escopo: apenas o delta (65d1fdf, da095fa); sem `infra/`, então IAM, rede, CloudTrail e `npm audit` não foram avaliados (sem dependências novas no delta).
- Filtros client-side (REM/RET/títulos/finalizados) operam sobre dados já autorizados no cliente: não ampliam acesso nem expõem dado novo.
- Cross-QA: Validate Input com Integrability/Fault Tolerance (card security-1); Detect Service Denial com Performance/Availability (card security-2).
