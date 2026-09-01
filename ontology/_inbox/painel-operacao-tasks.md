# Tasks — painel-operacao

> Slug: `painel-operacao` · Branch: `feat/painel-operacao` · Base: `main` (@ `d70088e`)
> Worktree: `~/kavex-worktrees/painel-operacao` · ADR: **0042** · Migration: **0052**
> Ontologia: v0.22.0 · `entity_changed = true` (diff aprovado pelo Yuri em 2026-09-01)

## Plano de Validação Ground-Truth

**Veredito: `SEM_GROUND_TRUTH` para a lógica nova.** O read-model, o config doctor e o alerting não
computam valor monetário — não há número do ERP contra o qual comparar.

**Exceção que exige cuidado próprio (T6):** a reconciliação SEFAZ não é lógica nova, é uma
**relocação** de lógica já validada (ADR-0037/0038). O gate aplicável não é ground-truth e sim
**equivalência comportamental**: o job precisa gravar exatamente o que o caminho do browser gravava,
com a mesma idempotência. Critério em T6.

---

## T1 — Read-model `JobRun` + adapters

**Arquivos**
- `src/backend/domain/interface/operacao/JobRun.ts` (novo)
- `src/backend/domain/service/operacao/JobRunReadModel.ts` (novo)
- adapters: reusam `PermutaSnapshotRepository.listRecentRuns`,
  `RecebimentoIngestaoRunRepository.listRecentRuns`, `PagamentoIngestaoRunRepository.listRecentRuns`
  (todos já existem, todos já recebem `limit`)

**Aceite**
1. `JobRun` normaliza as três fontes sem alterar nenhum writer e sem migration.
2. `partial` é preservado onde a fonte o distingue; **nunca** mapeado para `success`.
3. SISPAG (sem `partial`) não recebe `partial` inventado — e o read-model expõe que aquela fonte
   não distingue o estado, para a tela não passar cegueira herdada por saúde.
4. Normaliza a divergência de tipo de retorno já existente entre as fontes
   (`string | undefined` em recebimentos × `Date | null` nas outras duas).
5. `idadeDesdeUltimoSucesso` calculada na leitura (**I6**).
6. Teste unitário por adapter + um teste do invariante de `partial`.

---

## T2 — Config doctor

**Arquivos**
- `src/backend/domain/service/operacao/ConfigDoctor.ts` (novo)
- `src/backend/domain/service/operacao/configManifest.ts` (novo — quais vars cada frente exige vs. usa)
- `src/backend/index.ts` (chamada no boot)

**Aceite**
1. Cada var conhecida classificada em `configurado | ausente | usando-default`.
2. **I3:** nenhum valor de secret aparece em log ou resposta — teste que asserta isso explicitamente,
   inclusive para vars cujo nome não contém "secret"/"key" (`conexosPassword`, `databaseConnectionString`).
3. Var **obrigatória** ausente gera `Alerta` tipo `config-ausente` no boot.
4. Manifesto cobre, no mínimo e nomeadamente, as duas que já causaram defeito:
   `RECEBIMENTO_TITULARES_INTERNOS` e `COM297_GCD_NOTA_DEBITO`.
5. Boot **não falha** por var ausente — diagnostica, não derruba (I5 aplicado ao boot).

---

## T3 — `Alerta`: migration, repositório, port e `DbAlertSink`

**Arquivos**
- `src/backend/migrations/0052_alerta.sql` (novo)
- `src/backend/domain/interface/operacao/Alerta.ts`, `AlertSink.ts` (novos)
- `src/backend/domain/repository/operacao/AlertaRepository.ts` (novo)
- `src/backend/domain/service/operacao/DbAlertSink.ts` (novo)
- `src/backend/domain/service/operacao/NotificacaoService.ts` (novo — orquestra dedup + sinks)

**Aceite**
1. `dedupKey` por `(tipo, alvo, janela)`; segundo alerta na mesma janela **não** cria linha nova.
2. Janela nova **volta** a alertar (pipeline parado há dois dias merece ser dito de novo).
3. **I5:** sink que lança **não** propaga — a falha é registrada em `sinkResultados`, para que
   "o alerta não chegou" seja distinguível de "não houve alerta". Teste com sink que sempre lança.
4. `EmailAlertSink` **não** é implementado aqui; o port existe e aceita um segundo sink sem
   mudança de assinatura. Teste que registra dois sinks e prova que ambos recebem.
5. SQL parametrizado (`$1`/named), `@injectable()`, métodos arrow, modificadores explícitos.

---

## T4 — `detectarStaleness` + limites + workflow

**Arquivos**
- `src/backend/domain/interface/operacao/stalenessLimits.ts` (novo — a business-rule em código)
- `src/backend/domain/service/operacao/StalenessDetector.ts` (novo)
- `src/backend/jobs/detect-staleness.ts` (novo)
- `.github/workflows/detect-staleness.yml` (novo)

**Aceite**
1. Limites conforme `business-rules/staleness-por-pipeline.md`: extratos **3h**, permutas **18h**,
   SISPAG **30h**, reaper **1h**.
2. Compara contra a última run **`success`** — `partial` não conta como sinal de vida e gera o
   alerta `job-parcial`, que é incidente distinto.
3. Pipeline sem nenhuma run bem-sucedida (sistema novo) **não** dispara alerta perpétuo — decidir e
   testar o comportamento de bootstrap explicitamente.
4. Teste com relógio injetado, um caso por pipeline, na fronteira do limite (logo antes / logo depois).

---

## T5 — Rota + tela `/operacao`

**Arquivos**
- `src/backend/routes/operacao.ts` (novo) + registro em `index.ts`
- `src/frontend/app/operacao/page.tsx` (novo) + componentes
- `src/frontend/lib/operacao.ts` (novo)
- `src/frontend/app/page.tsx` (card na home)

**Aceite**
1. **I4:** a rota **não** chama o Conexos. Teste que falha se um client do ERP for resolvido no
   caminho — é a tela que se abre quando o ERP está fora.
2. Por pipeline: última run, status, idade desde o último sucesso, métricas próprias, e destaque
   visual quando acima do limite.
3. Lista os `Alerta` abertos (o painel é o `DbAlertSink` em ação) e o diagnóstico de configuração.
4. `requireRole('admin')` na rota, coerente com o resto.
5. DesignSystemReviewer verde; skeleton reflete o shape final; sem KPI decorativo — se um número não
   tem fonte, ele não vai para a tela.

---

## T6 — Reconciliação SEFAZ sai do browser (F1 + F3)

**Arquivos**
- `src/backend/jobs/reconciliar-nde-sefaz.ts` (novo)
- `.github/workflows/reconciliar-nde.yml` (novo)
- `src/backend/domain/service/recebimentos/RecebimentosPainelService.ts` (extrair `hidratarNdes`)

**Aceite**
1. **Equivalência comportamental:** o job grava exatamente o que o caminho do browser gravava
   (número do SEFAZ, `ndeAutorizado`), com a mesma idempotência
   (`if (autorizado && nde.ndeAutorizado !== true)`).
2. `GET /painel/enriquecimento` continua servindo a tela e **deixa de ser a única escritora**.
3. A rota deixa de ser o único caminho de escrita sob um GET sem role — **F3 fecha**.
4. Registra `JobRun` como qualquer outro pipeline, com limite de staleness próprio.
5. Nenhuma mudança na regra de emissão da NDe — só em **quem** dispara a reconciliação.

---

## T7 — `if: failure()` nos quatro workflows existentes

**Arquivos**
- `.github/workflows/ingest-permutas.yml`, `ingest-extratos.yml`, `ingest-sispag.yml`,
  `reaper-sispag.yml`

**Aceite**
1. Cada workflow, ao falhar, emite o `Alerta` correspondente (`job-falhou`).
2. O step de alerta **não** altera o desfecho do workflow (I5 no nível do CI).
3. Nenhuma credencial nova exposta em log.

---

## Definition of Done

- [ ] `npm run typecheck` · `npm run lint` · `npm test` verdes (backend **e** frontend)
- [ ] PatternGuardian verde (DDD, tsyringe, SQL parametrizado, sem `process.env` cru em service)
- [ ] DesignSystemReviewer verde (T5 toca `src/frontend/`)
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
