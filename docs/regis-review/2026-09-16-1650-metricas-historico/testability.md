---
qa: Testability
qa_slug: testability
run_id: 2026-09-16-1650-metricas-historico
agent: qa-testability
generated_at: 2026-09-18T00:00:00-03:00
scope: backend
findings_count: 2
cards_count: 2
score: 8
---

# Testability — Regis-Review

## 1. Cenário Geral (Bass General Scenario aplicado ao nf-projects)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Dev altera o piso da série de métricas (segunda migration `0060` + flag `?historico=true` num endpoint que o `kavex-report-ciclo` já consome) | PR precisa provar, sem esperar sexta-feira e sem tocar produção, que (a) o report não vê diferença e (b) nenhuma janela fechada já lida muda de valor | `0060_metricas_historico_inicio.sql`, `MetricasCicloRepository`/`Service`, `routes/metricas.ts`, `vwMetricasCiclo.{test,integration.test}.ts` | CI (`backend-sql`, Postgres 17 efêmero via Docker) + `npm run test:sql` local | O invariante da ADR-0048 (grade semanal idêntica entre os dois pisos) é verificado duas vezes — estaticamente no texto da migration e dinamicamente contra Postgres real com dados semeados nas janelas que se sobrepõem | 26 testes novos (7 guarda estática + 5 integração real + 4 repo + 3 service + 5 rota + 2 frontend); `test:sql` 19/19 verde; 0 dependência de relógio real ou rede |

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Cobertura por camada (linhas/branches/funções) | ⚠️ não coletada nesta run | 80/70/80% em `domain/service`+`domain/repository` | ⚠️ não medível (`--quick`) | `_shared-metrics.md` — flag `--quick` explícita |
| Testes novos / linhas de produção novas no delta | 26 testes / ~60 LOC produção | proporção defensável para uma mudança que altera um invariante de dados publicado (ADR-0048) | ✅ | `git diff origin/main --stat`; contagem de `it(` por arquivo (ver §4) |
| `test:sql` (integração real, Postgres 17) | 19/19, dos quais 5 novos no delta | 100% verde, gatilhado em todo PR | ✅ execução / ⚠️ enforcement (ver F-testability-1) | `_shared-metrics.md`; `.github/workflows/ci.yml:34-62` |
| Testes novos que leem relógio real (`Date.now()`/`new Date()` sem argumento) ou fazem rede real | 0 | 0 | ✅ | `git diff origin/main` nos 6 arquivos de teste do delta (grep manual, nenhuma ocorrência) |
| Canário "última migration aplicada" (`vwMetricasCiclo.integration.test.ts:18`) | atualizado `0058→0060` neste PR | esperado: atualiza a cada migration nova (comportamento por design) | ✅ (atrito intencional, não bug) | diff da linha `expect(migrations[migrations.length - 1]).toBe(...)` |
| Branch protection / required status checks em `main` | 0 checks obrigatórios | ≥1 (`backend`, `backend-sql`, `frontend`) bloqueando merge | ❌ | `gh api repos/:owner/:repo/branches/main/protection` → `404 Branch not protected` |
| `coverageThreshold` configurado (contexto, não re-medido) | backend 72/54/78%, frontend 33/23/28% (globais, pré-existentes) | — | ℹ️ informativo, fora do delta | `src/backend/jest.config.cjs:39-44`, `src/frontend/jest.config.js:40-45` |

## 3. Tactics — Cobertura no nf-projects (escopo: delta desta run)

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Specialized Interfaces | `MetricasCicloRepository`/`Service` recebem `db`/`repository` mockado via **construtor**, nunca `container.resolve()`, em todos os 4 arquivos de teste unitário do delta | ✅ presente | `new MetricasCicloRepository(db as never)` em `MetricasCicloRepository.test.ts` e em `vwMetricasCiclo.integration.test.ts:280` (mesmo padrão contra Postgres real) |
| Recordable Test Cases | N/A neste delta — não há client externo novo (Conexos/Nexxera/GED) tocado; o delta é 100% interno (SQL + repo + rota + FE) | N/A | — |
| Sandbox | Integração cria/derruba um banco Postgres efêmero (`metricas_ciclo_it`) por execução, e **recusa** rodar contra qualquer host que não seja `localhost/127.0.0.1/::1` | ✅ presente | `vwMetricasCiclo.integration.test.ts:88-92` (`DROP DATABASE ... WITH (FORCE)`; guarda de host antes disso) |
| Executable Assertions | 26 novas, todas com `expect` sobre estado observável (SQL literal extraído + parseado, linhas de banco real, corpo HTTP) — não há `console.log`-style debug deixado como prova | ✅ presente | ver §4 |
| Abstract Data Sources | O `db` passado ao repositório nos testes de unidade é um objeto plano (`{ selectMany, selectFirst }`), não o `PostgreeDatabaseClient` real — troca de fonte de dados é trivial | ✅ presente | `MetricasCicloRepository.test.ts:+1-54` |
| Limit Structural Complexity | Maior arquivo de teste do delta: `vwMetricasCiclo.integration.test.ts`, 418 LOC total (abaixo do limiar de 500 do heurístico) | ✅ presente | `wc -l` |
| Limit Non-Determinism | `metricas.metricas_ciclo(p_serie_inicio, p_agora)` recebe o "agora" como **parâmetro**, não lê `now()` internamente para a lógica de janela — os testes fixam `AGORA = '2026-09-26 10:00:00'` e não dependem do relógio da máquina de CI | ✅ presente | `0058_vw_metricas_ciclo.sql` (assinatura da função); `vwMetricasCiclo.integration.test.ts:41` |

## 4. Findings (achados)

### F-testability-1: CI roda `test:sql` a cada PR, mas nada obriga esse job a passar para o merge acontecer

- **Severidade**: P1
- **Tactic violada**: Executable Assertions (a garantia só vale se o "executable" também for "enforced")
- **Localização**: repositório GitHub (branch protection de `main`), não um arquivo do delta
- **Evidência (objetiva)**:
  ```
  $ gh api repos/:owner/:repo/branches/main/protection
  {"message":"Branch not protected","status":"404"}
  ```
  `.github/workflows/ci.yml:34-62` mostra o job `backend-sql` rodando `npm run test:sql` com Postgres 17 de serviço em todo `pull_request` contra `main`/`dev`, sem `paths-filter` — ele roda neste PR. O job `tag-release` declara `needs: [backend, backend-sql, frontend]` (linha 84), mas isso só governa o job de release em `push` para `main`; não é o mesmo mecanismo que bloqueia um merge de PR (que depende de branch protection, ausente).
- **Impacto técnico**: os 5 testes de integração novos (incluindo o que prova o invariante central da ADR-0048 — "recuar o piso não move uma vírgula das janelas que já existiam") **rodam e reportam falha**, mas um reviewer pode clicar em "Rebase and merge" com o check vermelho, porque o GitHub não o marca como obrigatório.
- **Impacto de negócio**: o número que o `kavex-report-ciclo` publica todo ciclo depende deste invariante. Sem enforcement, a proteção contra regressão existe apenas enquanto um humano olha o status do check antes de mergear — o mesmo modo de falha que o card `testability-1` do Regis-Review de 2026-09-14 já havia fechado no nível "o teste existe e roda" (ver comentário em `vwMetricasCiclo.integration.test.ts:29-33`), mas que reabre no nível "o teste que roda é respeitado".
- **Métrica de baseline**: 0 required status checks configurados em `main` (branch protection 404); 3 jobs de CI existentes (`backend`, `backend-sql`, `frontend`) hoje nenhum obrigatório.

### F-testability-2: guardas estáticas de `0058`/`0060` misturam checagem sintática (tautológica) e semântica (invariante real) sob o mesmo rótulo "guardas estáticas"

- **Severidade**: P3
- **Tactic violada**: Executable Assertions (clareza do que a assertiva prova)
- **Localização**: `src/backend/migrations/vwMetricasCiclo.test.ts:97-195`
- **Evidência (objetiva)**: a maioria dos `it()` do bloco `describe('0060_metricas_historico_inicio — guardas estáticas', …)` faz `expect(SQL_0060).toMatch(/regex sobre o próprio texto do arquivo/)` — provam forma (existe uma `REVOKE`, não existe `DROP`, o literal aparece uma vez), e dariam falso-verde para qualquer regressão de comportamento que preservasse essas strings (ex.: um `historico_inicio()` com data certa mas lógica de `WHERE` quebrada em outra migration não seria pego aqui). O único teste do bloco que faz cálculo real sobre os literais — `'os dois pisos caem na mesma grade...'`, que extrai as duas datas e calcula `distanciaDias % 7 === 0` — é o que efetivamente sustenta o invariante da ADR-0048 no nível estático; ele é indistinguível dos outros pelo nome do `describe`.
- **Impacto técnico**: um novo guard estático adicionado no futuro por copy-paste do padrão predominante (regex-sobre-texto) tem baixa chance de ser questionado sobre se prova comportamento — o arquivo já tem 12 exemplos desse padrão para copiar e 1 de cálculo real.
- **Impacto de negócio**: nenhum imediato — o comportamento real É coberto pela suíte de integração (`vwMetricasCiclo.integration.test.ts`), que é onde a ADR-0048 é de fato provada contra Postgres. O risco é de médio prazo: confiança excessiva em "guardas estáticas" como se fossem prova de comportamento, à medida que o arquivo cresce.
- **Métrica de baseline**: 12 de 13 `it()` nos dois blocos de guarda estática (`0058`+`0060`) são regex-sobre-texto puro; 1 faz aritmética sobre valor extraído.

## 5. Cards Kanban

### [testability-1] Exigir os checks de CI (`backend`, `backend-sql`, `frontend`) como obrigatórios em `main`

- **Problema**
  > `gh api repos/:owner/:repo/branches/main/protection` devolve `404 Branch not protected`: nenhum status check é obrigatório para merge. O job `backend-sql` (Postgres 17 real) prova o invariante central da ADR-0048 — que recuar o piso não altera nenhuma janela já publicada pelo report — mas nada impede um merge com esse job vermelho.

- **Melhoria Proposta**
  > Configurar branch protection em `main` (via `gh api` ou GitHub UI) exigindo os 3 status checks (`Backend`, `Backend SQL (Postgres 17)`, `Frontend`) antes de permitir merge. Tactic alvo: Executable Assertions — uma assertiva só protege o sistema se sua falha bloquear a mudança que a violou.

- **Resultado Esperado**
  > Required status checks em `main`: 0 → 3 (`backend`, `backend-sql`, `frontend`). PR com `test:sql` vermelho deixa de poder ser mergeado via UI.

- **Tactic alvo**: Executable Assertions
- **Severidade**: P1
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-testability-1
- **Métricas de sucesso**:
  - Required status checks em `main`: 0 → 3
  - `gh api .../branches/main/protection`: `404` → `200` com os 3 jobs listados
- **Risco de não fazer**: em 6 meses, um PR que quebra o invariante de janelas do report pode ser mergeado por engano (CI vermelho ignorado sob pressão de prazo), e o `kavex-report-ciclo` publica um número que já não bate com o que a tela mostrou — sem que o gate que existe para isso tenha, de fato, travado nada.
- **Dependências**: nenhuma; é configuração de repositório, não código.

### [testability-2] Separar "guarda sintática" de "guarda semântica" nos testes estáticos de migration

- **Problema**
  > `vwMetricasCiclo.test.ts` roda 13 `it()` sob o rótulo comum "guardas estáticas" (0058 + 0060); 12 são regex sobre o texto do próprio arquivo SQL (provam forma, não comportamento) e 1 faz aritmética real sobre as datas extraídas (prova o alinhamento de grade da ADR-0048). O nome do bloco não distingue as duas classes, e o padrão predominante (regex) é o que um novo guard tende a copiar.

- **Melhoria Proposta**
  > Dividir os `describe` em dois: `'0060 — forma do arquivo (sintático)'` e `'0060 — invariantes de negócio (semântico, ADR-0048)'`, com um comentário no segundo bloco reforçando que só ele é evidência de comportamento sem banco — o resto é lint travestido de teste. Tactic alvo: Executable Assertions (nomeação honesta do que cada assertiva prova).

- **Resultado Esperado**
  > `describe` blocks nas guardas estáticas: 2 (misto) → 4 (2 arquivos × 2 categorias nomeadas). Nenhuma mudança de comportamento, só de rotulagem — custo de implementação mínimo.

- **Tactic alvo**: Executable Assertions
- **Severidade**: P3
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-testability-2
- **Métricas de sucesso**:
  - Guards com rótulo que declara sintático vs. semântico: 0 → 13
- **Risco de não fazer**: nenhum imediato — a suíte de integração já cobre o comportamento real. Risco é de médio prazo, à medida que mais migrations acumulam guardas regex sem musculatura semântica e a suíte estática passa a parecer mais forte do que é.
- **Dependências**: nenhuma.

## 6. Notas do agente

- Escopo restrito ao delta por instrução explícita (`--quick`); cobertura por camada não foi coletada — declarada não-medível em §2, primeira linha, conforme exigido.
- O teste `'recuar o piso não move uma vírgula das janelas que já existiam'` **não é vazio**: a seed do `beforeAll` popula `permuta_alocacao_execucao`/`solicitacao_numerario_execucao` exatamente nas janelas 11/09 e 18/09 (as únicas que se sobrepõem entre os dois pisos, já que agosto não tem seed), com valores não-triviais (tentativas > 0, R$ > 0) — a comparação `sobrepostas === serie` de fato exercita números reais, não zeros por ausência de dado. Confirmado lendo os `INSERT` do `beforeAll` linha a linha.
- O canário `expect(migrations[migrations.length - 1]).toBe('0060_...')` (atualizado de `0058_...` neste PR) é atrito **intencional e pré-existente** ao padrão do repositório (já existia apontando para `0058` antes deste delta) — não é achado do delta, por isso não virou card.
- Cross-QA: F-testability-1 (branch protection ausente) é o mesmo gap que Deployability provavelmente já registra como "CI verde não é gate de deploy" — evitar achado duplicado no consolidator, cruzar antes de somar KPIs.
- Cross-QA: `p_agora` como parâmetro da função SQL (em vez de `now()` interno) é tanto uma tactic de Testability (Limit Non-Determinism) quanto de Modifiability (facilita trocar a régua de "agora" sem tocar a função) — vale nota cruzada no consolidator.
