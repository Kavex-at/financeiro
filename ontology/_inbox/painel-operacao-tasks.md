# Tasks — painel-operacao

> Slug: `painel-operacao` · Branch: `feat/painel-operacao` · Base: `main` (@ `d70088e`)
> Worktree: `~/kavex-worktrees/painel-operacao` · ADR: **0042** · Migration: **0052**
> Ontologia: v0.22.0 · `entity_changed = true` (diff aprovado pelo Yuri em 2026-09-01)

## Plano de Validação Ground-Truth

**Veredito: `SEM_GROUND_TRUTH` para a lógica nova.** O read-model, o config doctor e o alerting não
computam valor monetário — não há número do ERP contra o qual comparar.

**Exceção que exige cuidado próprio (Task 6):** a reconciliação SEFAZ não é lógica nova, é uma
**relocação** de lógica já validada (ADR-0037/0038). O gate aplicável não é ground-truth e sim
**equivalência comportamental**: o job precisa gravar exatamente o que o caminho do browser gravava,
com a mesma idempotência. Critério na Task 6.

---

### Task 1: Read-model `JobRun` + adapters

**Files to change:**
- `src/backend/domain/interface/operacao/JobRun.ts` (novo)
- `src/backend/domain/service/operacao/JobRunReadModel.ts` (novo)
- `PermutaSnapshotRepository.listRecentRuns` (adapter, já existe)
- `RecebimentoIngestaoRunRepository.listRecentRuns` (adapter, já existe)
- `PagamentoIngestaoRunRepository.listRecentRuns` (adapter, já existe)

**Acceptance criteria:**
- `JobRun` normaliza as três fontes sem alterar nenhum writer e sem migration.
- `partial` é preservado onde a fonte o distingue; **nunca** mapeado para `success`.
- SISPAG (sem `partial`) não recebe `partial` inventado — e o read-model expõe que aquela fonte não distingue o estado, para a tela não passar cegueira herdada por saúde.
- Normaliza a divergência de tipo de retorno já existente entre as fontes (`string | undefined` em recebimentos × `Date | null` nas outras duas).
- `idadeDesdeUltimoSucesso` calculada na leitura (**I6**).
- Teste unitário por adapter + um teste do invariante de `partial`.

**Dependencies:** none

### Task 2: Config doctor

**Files to change:**
- `src/backend/domain/service/operacao/ConfigDoctor.ts` (novo)
- `src/backend/domain/service/operacao/configManifest.ts` (novo — quais vars cada frente exige vs. usa)
- `src/backend/index.ts` (chamada no boot)

**Acceptance criteria:**
- Cada var conhecida classificada em `configurado | ausente | usando-default`.
- **I3:** nenhum valor de secret aparece em log ou resposta — teste que asserta isso explicitamente, inclusive para vars cujo nome não contém "secret"/"key" (`conexosPassword`, `databaseConnectionString`).
- Var **obrigatória** ausente gera `Alerta` tipo `config-ausente` no boot.
- Manifesto cobre, no mínimo e nomeadamente, as duas que já causaram defeito: `RECEBIMENTO_TITULARES_INTERNOS` e `COM297_GCD_NOTA_DEBITO`.
- Boot **não falha** por var ausente — diagnostica, não derruba (I5 aplicado ao boot).

**Dependencies:** none

### Task 3: `Alerta` — migration, repositório, port e `DbAlertSink`

**Files to change:**
- `src/backend/migrations/0052_alerta.sql` (novo)
- `src/backend/domain/interface/operacao/Alerta.ts` (novo)
- `src/backend/domain/interface/operacao/AlertSink.ts` (novo)
- `src/backend/domain/repository/operacao/AlertaRepository.ts` (novo)
- `src/backend/domain/service/operacao/DbAlertSink.ts` (novo)
- `src/backend/domain/service/operacao/NotificacaoService.ts` (novo — orquestra dedup + sinks)

**Acceptance criteria:**
- `dedupKey` por `(tipo, alvo, janela)`; segundo alerta na mesma janela **não** cria linha nova.
- Janela nova **volta** a alertar (pipeline parado há dois dias merece ser dito de novo).
- **I5:** sink que lança **não** propaga — a falha é registrada em `sinkResultados`, para que "o alerta não chegou" seja distinguível de "não houve alerta". Teste com sink que sempre lança.
- `EmailAlertSink` **não** é implementado aqui; o port existe e aceita um segundo sink sem mudança de assinatura. Teste que registra dois sinks e prova que ambos recebem.
- SQL parametrizado (`$1`/named), `@injectable()`, métodos arrow, modificadores explícitos.

**Dependencies:** Task 2

### Task 4: `detectarStaleness` + limites + workflow

**Files to change:**
- `src/backend/domain/interface/operacao/stalenessLimits.ts` (novo — a business-rule em código)
- `src/backend/domain/service/operacao/StalenessDetector.ts` (novo)
- `src/backend/jobs/detect-staleness.ts` (novo)
- `.github/workflows/detect-staleness.yml` (novo)

**Acceptance criteria:**
- Limites conforme `business-rules/staleness-por-pipeline.md`: extratos **3h**, permutas **18h**, SISPAG **30h**.
- Compara contra a última run **`success`** — `partial` não conta como sinal de vida e gera o alerta `job-parcial`, que é incidente distinto.
- Pipeline sem nenhuma run bem-sucedida (sistema novo) **não** dispara alerta perpétuo — decidir e testar o comportamento de bootstrap explicitamente.
- Teste com relógio injetado, um caso por pipeline, na fronteira do limite (logo antes / logo depois).

**Dependencies:** Task 1, Task 3

> **Desvio do spec original, corrigido durante a implementação.** O critério dizia "reaper 1h".
> Descobriu-se que `jobs/reaper-sispag-reconciling.ts` **não escreve linha de run nenhuma** — sem
> fonte, não há idade a medir e nenhum limite é aplicável. Manter o número faria a regra prometer
> uma cobertura que não pode existir. O reaper passou a ser LISTADO como `sem-trilha`, e ganhou
> alerta de falha de workflow (Task 7). Dar-lhe trilha é follow-up.

### Task 5: Rota + tela `/operacao`

**Files to change:**
- `src/backend/routes/operacao.ts` (novo) + registro em `index.ts`
- `src/frontend/app/operacao/page.tsx` (novo) + componentes
- `src/frontend/lib/operacao.ts` (novo)
- `src/frontend/app/page.tsx` (card na home)

**Acceptance criteria:**
- **I4:** a rota **não** chama o Conexos. Teste que falha se um client do ERP for resolvido no caminho — é a tela que se abre quando o ERP está fora.
- Por pipeline: última run, status, idade desde o último sucesso, métricas próprias, e destaque visual quando acima do limite.
- Lista os `Alerta` abertos (o painel é o `DbAlertSink` em ação) e o diagnóstico de configuração.
- `requireRole('admin')` na rota, coerente com o resto.
- DesignSystemReviewer verde; skeleton reflete o shape final; sem KPI decorativo — se um número não tem fonte, ele não vai para a tela.

**Dependencies:** Task 1, Task 2, Task 3, Task 4

### Task 6: Reconciliação SEFAZ sai do browser (F1 + F3)

**Files to change:**
- `src/backend/jobs/reconciliar-nde-sefaz.ts` (novo)
- `.github/workflows/reconciliar-nde.yml` (novo)
- `src/backend/domain/service/recebimentos/RecebimentosPainelService.ts` (extrair `hidratarNdes`)

**Acceptance criteria:**
- **Equivalência comportamental:** o job grava exatamente o que o caminho do browser gravava (número do SEFAZ, `ndeAutorizado`), com a mesma idempotência (`if (autorizado && nde.ndeAutorizado !== true)`).
- `GET /painel/enriquecimento` continua servindo a tela e **deixa de ser a única escritora**.
- A rota deixa de ser o único caminho de escrita sob um GET sem role — **F3 fecha**.
- Registra `JobRun` como qualquer outro pipeline, com limite de staleness próprio.
- Nenhuma mudança na regra de emissão da NDe — só em **quem** dispara a reconciliação.

**Dependencies:** Task 1, Task 4

> **Ampliação de escopo assumida.** Cumprir o critério do `JobRun` exigiu uma trilha para um job
> NOVO, que não existia — daí `job_execucao` (migration `0053`). É aditiva e não toca writer nenhum,
> então a restrição da ADR-0042 (não migrar writer vivo) continua respeitada. A alternativa era o job
> nascer cego como o reaper, entregando um segundo ponto cego dentro do slice que existe para
> eliminá-los. ADR-0042 emendada para registrar a decisão.

### Task 7: `if: failure()` nos quatro workflows existentes

**Files to change:**
- `.github/workflows/ingest-permutas.yml`
- `.github/workflows/ingest-extratos.yml`
- `.github/workflows/ingest-sispag.yml`
- `.github/workflows/reaper-sispag.yml`

**Acceptance criteria:**
- Cada workflow, ao falhar, emite o `Alerta` correspondente (`job-falhou`).
- O step de alerta **não** altera o desfecho do workflow (I5 no nível do CI).
- Nenhuma credencial nova exposta em log.

**Dependencies:** Task 3

---

## Definition of Done

- [ ] `npm run typecheck` · `npm run lint` · `npm test` verdes (backend **e** frontend)
- [ ] PatternGuardian verde (DDD, tsyringe, SQL parametrizado, sem `process.env` cru em service)
- [ ] DesignSystemReviewer verde (Task 5 toca `src/frontend/`)
- [ ] SpecVerifier: todos os critérios de aceite acima aprovados
- [ ] Ontologia: diff já aplicado (v0.22.0, ADR-0042) — reconferir número do ADR/migration no rebase
- [ ] Regis-Review rodado; **P0 remediados**; P1/P2/P3 → `painel-operacao-regis-followups.md`
- [ ] Rebase de `origin/main` limpo, gates ainda verdes
- [ ] Bump de versão FE+BE lockstep **depois** do rebase (à mão — não há `pwsh` nesta máquina)

## Follow-ups já conhecidos (não implementar neste slice)

1. **Dead-man's switch externo** — resolve os dois pontos cegos da ADR-0042 de uma vez.
2. **`EmailAlertSink`** — quando o acesso existir; é flip de config, não reescrita.
3. **`partial` no `pagamento_ingestao_run`** — remove a cegueira herdada do SISPAG; mexe em writer vivo.
4. **Substituir GH Actions por scheduler real** — junto do trabalho de escala (Tier 1).
