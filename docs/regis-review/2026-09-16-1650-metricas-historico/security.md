---
qa: Security
qa_slug: security
run_id: 2026-09-16-1650-metricas-historico
agent: qa-security
generated_at: 2026-09-18T00:00:00-03:00
scope: backend
score: 8
findings_count: 2
cards_count: 2
---

# Security — Regis-Review

## 1. Cenário Geral (Bass General Scenario aplicado ao Financeiro)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Usuário autenticado (qualquer papel, JWT válido) sem privilégio `admin` | `GET /metricas/ciclo?historico=true` — tenta ler 6 semanas de agregados de negócio (antes, 1 semana) | `routes/metricas.ts` → `MetricasCicloService` → `MetricasCicloRepository.listar/serieInicio` → `metricas.metricas_ciclo()`/`historico_inicio()` (Postgres) | Produção, backend Express atrás de `buildAuthMiddleware` global | Sistema autentica via JWT (presente), decide o piso da série por um booleano validado no boundary (nunca por string livre do cliente), e devolve só agregados semanais sem identificador de cliente | 0 sítios de SQL interpolado com valor do cliente; 0 colunas novas expostas; 0/1 rotas de `/metricas` com `requireRole` (pré-existente) |

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Sítios de SQL string-interpolado com dado controlado pelo cliente (`MetricasCicloRepository`) | 0/2 (`listar`, `serieInicio` usam `this.piso(historico)`, que retorna 1 de 2 literais fixos — nunca a string da requisição) | 0 | ✅ | `src/backend/domain/repository/metricas/MetricasCicloRepository.ts:27-36,60-92` |
| Validação Zod do novo parâmetro `historico` no boundary | `z.enum(['true','false'])`, valores fora do enum → 400 sem tocar o serviço | 100% dos parâmetros do endpoint validados | ✅ | `src/backend/routes/metricas.ts:19-23`, testado em `src/backend/routes/metricas.test.ts` ("historico fora de true/false é 400") |
| Colunas/dimensões novas expostas por `?historico=true` | 0 — mesmas 11 colunas de `linhaSchema` (`frente, metrica, rotulo, valor, unidade, janela_inicio, janela_fim, baseline, baseline_desc, parcial, apurado_ate`); nenhuma é identificador de cliente/CNPJ/documento | 0 novas dimensões sensíveis | ✅ | `src/backend/domain/repository/metricas/MetricasCicloRepository.ts:7-19`; `src/backend/migrations/0058_vw_metricas_ciclo.sql:90-224` (agregação por `COUNT`/`SUM` sobre janela semanal, sem `SELECT *` de linha crua) |
| Controles de hardening na migration 0060 (GRANT explícito, `SECURITY DEFINER`, `REVOKE ALL FROM PUBLIC`, `SET search_path = ''`) | 4/4 ausentes-quando-devem/presentes-quando-devem: sem `GRANT`, sem `SECURITY DEFINER`, `REVOKE ALL ON FUNCTION metricas.historico_inicio() FROM PUBLIC` presente, `SET search_path = ''` presente | 4/4 | ✅ | `src/backend/migrations/0060_metricas_historico_inicio.sql:43,48-55`; guarda estática em `src/backend/migrations/vwMetricasCiclo.test.ts:155-160` |
| Rotas de `/metricas` com `requireRole` explícito | 0/1 (`GET /metricas/ciclo`) — idêntico em `origin/main` antes do delta | 100% (ou justificativa por dado não-sensível) | ⚠️ | `src/backend/routes/metricas.ts` (sem import de `../http/auth.js`); contraste com `src/backend/routes/sispag.ts`, `permutas.ts`, `recebimentos.ts`, `usuarios.ts` (todos usam `requireRole('admin')`) |
| Autenticação (JWT) na rota `/metricas` | Presente — `buildAuthMiddleware` montado globalmente em `buildApp.ts:112` antes de `app.use('/metricas', metricasRouter)` em `buildApp.ts:160` | Presente | ✅ | `src/backend/http/buildApp.ts:112,160` |
| Janela de dados retornada (semanas) | 1 → 6 (delta) | — (mudança de produto, não de segurança per se) | ℹ️ | `src/backend/migrations/0060_metricas_historico_inicio.sql:23-34` |

⚠️ **Não medível localmente**: `npm audit` profundo, cobertura de testes, IAM/Terraform (repo não usa Lambda/infra — ver `_shared-metrics.md`). Fora do escopo `--quick` restrito ao delta.

## 3. Tactics — Cobertura no delta

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Validate Input | `cicloQuerySchema` (Zod) valida `inicio`/`fim`/`historico` no boundary; `historico` usa `z.enum(['true','false'])` deliberadamente (não `z.coerce.boolean()`, que trataria `'false'` como truthy) | ✅ presente | `src/backend/routes/metricas.ts:15-23` |
| Verify Message Integrity (do dado que chega ao SQL) | O booleano validado nunca vira string livre: `piso()` mapeia para 1 de 2 constantes (`PISO.serie` / `PISO.historico`), definidas em módulo, não deriváveis da requisição | ✅ presente | `src/backend/domain/repository/metricas/MetricasCicloRepository.ts:27-36,92` |
| Authenticate Actors | JWT obrigatório, aplicado globalmente antes de `/metricas` | ✅ presente | `src/backend/http/buildApp.ts:112,160` |
| Authorize Actors | Nenhum `requireRole` na rota — qualquer usuário autenticado (independente de papel) lê o endpoint. Justificado no comentário do código ("leitura aberta a quem está autenticado, como as demais leituras da plataforma") mas sem granularidade de papel | ⚠️ parcial | `src/backend/routes/metricas.ts:25-30` (comentário); ausência de `requireRole` confirmada idêntica em `origin/main` |
| Limit Exposure | Resposta é só agregado semanal (`COUNT`/`SUM` por janela); sem CNPJ, sem valor por título/documento, sem `erp_response` — mesmo contrato de colunas de antes do delta, só mais linhas históricas | ✅ presente | `src/backend/migrations/0058_vw_metricas_ciclo.sql:113-224`; `MetricaCiclo` interface |
| Separate Entities (piso oficial vs. piso do histórico) | Migration aditiva: `serie_inicio()` e `metricas_ciclo()`/`vw_metricas_ciclo` não são redefinidas; `historico_inicio()` é função irmã, isolada. O `kavex-report-ciclo` não passa `historico` e por isso não muda de comportamento | ✅ presente | `src/backend/migrations/0060_metricas_historico_inicio.sql:11-21` |
| Change Default Settings (privilégio SQL) | `REVOKE ALL ... FROM PUBLIC` e `SET search_path = ''` na função nova, espelhando o padrão da 0058; sem `GRANT` explícito a role de app (mesmo padrão da 0058 — app roda como owner) | ✅ presente | `src/backend/migrations/0060_metricas_historico_inicio.sql:43,52` |
| Encrypt Data | N/A ao delta — nenhuma mudança em transporte/armazenamento; TLS/at-rest do Postgres gerenciado (Supabase) fora do escopo do delta | N/A — sem mudança neste PR |
| Audit Trail | N/A ao delta — endpoint é leitura, não há mutação/ação financeira a auditar aqui; ver `fault-tolerance.md` para audit trail das ações de negócio (permuta/SISPAG) | N/A — endpoint read-only |

## 4. Findings (achados)

### F-security-1: `GET /metricas/ciclo` sem `requireRole` — pré-existente, superfície de dado ampliada pelo delta

- **Severidade**: P2
- **Tactic violada**: Authorize Actors
- **Localização**: `src/backend/routes/metricas.ts:40-66` (rota); contraste com `src/backend/http/auth.ts` (`requireRole`, usado em `permutas.ts`, `sispag.ts`, `recebimentos.ts`, `usuarios.ts`)
- **Evidência (objetiva)**:
  ```
  git show origin/main:src/backend/routes/metricas.ts | grep -n "requireRole\|import"
  → nenhum import de ../http/auth.js, nenhum requireRole (idêntico ao HEAD do delta)

  grep -rn "requireRole" src/backend/routes/metricas.ts → 0 ocorrências
  grep -rn "requireRole" src/backend/routes/{permutas,sispag,recebimentos,usuarios}.ts → 30+ ocorrências
  ```
- **Impacto técnico**: qualquer conta autenticada na plataforma (JWT válido, qualquer papel) lê `/metricas/ciclo`, sem checagem de papel — a rota depende só de `buildAuthMiddleware` global.
- **Impacto de negócio**: baixo isoladamente (dado é agregado semanal, sem CNPJ/cliente/valor por documento), mas o delta amplia de 1 para 6 semanas o que fica exposto sob esse mesmo controle fraco — o raio de dado visível a um usuário de baixo privilégio cresce 6x sem mudança de authz correspondente.
- **Métrica de baseline**: 0/1 rotas de `/metricas` com `requireRole`, vs. 30+ ocorrências de `requireRole('admin')` no restante de `src/backend/routes/`. **Achado PRÉ-EXISTENTE** — confirmado idêntico em `git show origin/main:src/backend/routes/metricas.ts`, não é regressão introduzida por este PR.

### F-security-2: SQL injection em `MetricasCicloRepository` — investigado e refutado

- **Severidade**: N/A (não-finding, registrado por transparência do processo de verificação pedido)
- **Tactic violada**: nenhuma — Verify Message Integrity e Validate Input confirmados presentes
- **Localização**: `src/backend/domain/repository/metricas/MetricasCicloRepository.ts:60-92`
- **Evidência (objetiva)**: rastreamento completo do dado, ponta a ponta:
  ```
  req.query.historico (string arbitrária do cliente)
    → routes/metricas.ts:19-23  cicloQuerySchema.safeParse → z.enum(['true','false']).optional()
                                  (qualquer valor fora do enum → 400, nunca chega ao service)
    → routes/metricas.ts:55-63  historico === 'true' ? { historico: true } : {}
                                  (a partir daqui é SEMPRE um boolean ou undefined — a string
                                   original do query já foi descartada)
    → MetricasCicloService.ts:32-38  repasse do boolean, sem concatenação
    → MetricasCicloRepository.ts:92  private piso = (historico?: boolean): string =>
                                        (historico ? PISO.historico : PISO.serie)
                                      // PISO.serie/historico são literais de módulo (linhas 31-36),
                                      // nunca deriváveis de req.query
    → MetricasCicloRepository.ts:69,87  `${this.piso(filtro.historico)}` interpola só 1 de 2
                                          strings fixas — nenhum caractere do request chega ao SQL
                                          por essa via.
  ```
  Os únicos valores de `req.query`/`req.body` que de fato entram na query (`inicio`, `fim`) vão via
  bind parameter nomeado (`$inicio::timestamp`, `$fim::timestamp`) para
  `PostgreeDatabaseClient.selectMany(query, params)` — parametrização real, não string.
- **Impacto técnico**: nenhum — não há caminho de injeção neste delta.
- **Impacto de negócio**: nenhum.
- **Métrica de baseline**: 0/2 sítios de `piso()` interpolam dado do cliente. Confirmado independentemente (não aceito o veredito de outro revisor por afirmação).

## 5. Cards Kanban

### [security-1] Adicionar `requireRole` (ou decisão explícita documentada) em `/metricas/ciclo`

- **Problema**
  > `GET /metricas/ciclo` não tem `requireRole`, ao contrário de toda outra rota de negócio do backend (`permutas`, `sispag`, `recebimentos`, `usuarios`). É achado pré-existente, não introduzido por este PR — mas o delta amplia de 1 para 6 semanas o volume de métricas de negócio (valor baixado em permutas, valor de créditos alocados, taxas de conclusão) que um usuário autenticado de qualquer papel pode ler sob esse mesmo controle.

- **Melhoria Proposta**
  > Decidir explicitamente (ADR curto) se `/metricas/ciclo` deve permanecer aberta a qualquer autenticado — caso em que o comentário atual em `routes/metricas.ts:25-30` deveria virar uma decisão registrada em ontologia, não só um comentário de código — ou ganhar `requireRole('admin')` como as demais rotas de leitura sensível. Tactic alvo: **Authorize Actors**. Arquivo a tocar: `src/backend/routes/metricas.ts` (+ `src/backend/routes/metricas.test.ts` para o 403/200 por papel).

- **Resultado Esperado**
  > Ou 1/1 rotas de `/metricas` com `requireRole` explícito (igualando a cobertura das demais 30+ ocorrências no repo), ou uma decisão documentada em `ontology/decisions/` justificando a leitura aberta — métrica: 0/1 → 1/1 rotas com controle de papel decidido conscientemente (implementado ou formalmente dispensado).

- **Tactic alvo**: Authorize Actors
- **Severidade**: P2
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-security-1
- **Métricas de sucesso**:
  - Rotas de `/metricas` com `requireRole` explícito OU decisão documentada: 0/1 → 1/1
- **Risco de não fazer**: conforme a tela Métricas ganha mais frentes e janelas (a ADR-0048 já registra que a data fixa "envelhece" — em dezembro serão ~18 semanas), o volume de dado de negócio exposto sob autenticação genérica cresce sem novo checkpoint de decisão.
- **Dependências**: nenhuma.

### [security-2] Manter o padrão de rastreamento explícito de dado-do-cliente → SQL como guarda de regressão

- **Problema**
  > O padrão usado em `MetricasCicloRepository.piso()` (booleano validado → 1 de 2 literais fixos, nunca a string da requisição) é correto e foi verificado ponta a ponta neste review, mas não há um teste que trave especificamente "nenhuma string de `req.query` chega a um template SQL sem passar por bind parameter" — hoje isso é auditado manualmente a cada review.

- **Melhoria Proposta**
  > Formalizar como regra de `PatternGuardian` (gate do pipeline) um grep/lint que sinalize template literals com `${...}` dentro de uma string SQL cujo identificador não seja um literal de módulo (`const X = 'literal'`) — reduz a necessidade de auditoria manual ponta-a-ponta a cada PR que toca repository. Tactic alvo: **Validate Input** / **Verify Message Integrity**.

- **Resultado Esperado**
  > Regra automatizada substitui parte da verificação manual feita neste review; qualquer futuro `${variávelDerivadaDeRequest}` dentro de um template SQL falha o gate antes do merge.

- **Tactic alvo**: Validate Input
- **Severidade**: P3
- **Esforço estimado**: M (2-5d)
- **Findings relacionados**: F-security-2
- **Métricas de sucesso**:
  - Regra de lint/gate para interpolação SQL fora de literais de módulo: ausente → presente
- **Risco de não fazer**: o padrão seguro depende de disciplina manual a cada novo repository; um futuro PR poderia reintroduzir interpolação de dado do cliente sem um gate automatizado que pegue isso antes do review humano.
- **Dependências**: nenhuma.

## 6. Notas do agente

Escopo restrito ao delta (`--quick`), por instrução do `_shared-metrics.md` e do prompt de invocação — não
reauditei `requireRole`/CORS/rate-limit fora de `/metricas`. F-security-1 é achado pré-existente
(confirmado via `git show origin/main:...`, idêntico ao HEAD do delta); registrado porque o delta amplia
a janela de dado exposto sob o mesmo controle, não porque o PR o introduziu. SQL injection (foco #1 do
prompt) foi rastreado ponta a ponta e refutado independentemente — ver F-security-2. Migration 0060 segue
byte a byte o padrão de hygiene da 0058 (sem GRANT, sem SECURITY DEFINER, REVOKE ALL FROM PUBLIC,
`search_path=''`), com guarda estática própria em `vwMetricasCiclo.test.ts`. Cross-QA: F-security-1
(Authorize Actors) pode interessar a `availability.md`/`fault-tolerance.md` se a mesma rota vier a ganhar
mais dado sensível no futuro — nenhum overlap de Audit Trail ou Restore neste delta (endpoint é read-only,
sem escrita/mutação).
