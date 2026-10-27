---
type: regis-review-report
run_id: 2026-10-27-1803-sispag-vinculo-data-divergente
generated_at: 2026-10-27T18:30:00-03:00
audience: technical (architects + senior devs + tech lead)
basis: Bass & Clements — Software Architecture in Practice (Fault Tolerance, Modifiability, Security, Testability — revisão reduzida)
scope: delta ADR-0078 phase 1 (git diff origin/main...HEAD, base dc4d2b9d, head 532dd766, v0.76.0)
total_cards: 14
total_p0: 0
total_p1: 2
total_p2: 7
total_p3: 5
overall_score: 7.91
qas_run: [fault-tolerance, modifiability, security, testability]
qas_skipped: [availability, deployability, integrability, performance]
---

# Regis-Review (reduzido) — financeiro — 2026-10-27-1803-sispag-vinculo-data-divergente

Revisão **reduzida** sobre o delta ADR-0078 fase 1 (reconhecimento tipado de divergência de data, regras I15r/I17p/I17q, migration 0091, `prazoBoleto`). Quatro QAs rodados por diretiva do orquestrador: Fault Tolerance, Modifiability, Security, Testability. Availability, Deployability, Integrability e Performance **não foram executados** neste ciclo — o escopo é incremento sobre o delta ADR-0077 já coberto no run `2026-10-27-1546`.

Nenhum achado P0. A feature isola a maior parte da lógica nova em libs puras pequenas, mantém `.strict()` + CHECK no banco + anti-TOCTOU server-side no caminho que mais importa (`confirmar`), e tem 42 arquivos de teste para 76 tocados. Os dois P1 são (1) dívida de testabilidade human-in-the-loop (roteiro manual HML nunca executado antes do release 0.76.0) e (2) dívida estrutural (service orquestrador passou de 1 287 LOC absorvendo I15r sem Split Module). O resto é refinamento (P2/P3).

## 1. Executive scorecard

Pesos (financeiro, SaaSo multi-tenant que move dinheiro): Security 1,5; Fault Tolerance 1,3; Modifiability 1,2; Testability 1,0. Soma = 5,0. Média ponderada **apenas sobre os 4 QAs rodados**: `(8,5·1,5 + 8·1,3 + 7·1,2 + 8·1,0) / 5,0 = 39,55 / 5,0 = 7,91`. Os 4 QAs ausentes **não** entram na média — assumir "pleno" neles seria inventar sinal.

| QA | Score (0–10) | P0 | P1 | P2 | P3 | Principal achado |
|---|---|---|---|---|---|---|
| Availability | — | — | — | — | — | **não executado (revisão reduzida)** |
| Deployability | — | — | — | — | — | **não executado (revisão reduzida)** |
| Integrability | — | — | — | — | — | **não executado (revisão reduzida)** |
| Modifiability | 7,0 | 0 | 1 | 2 | 1 | F-modifiability-1: `BoletoSuggestionService` 1 287 LOC (+105), Split Module não aplicado |
| Performance | — | — | — | — | — | **não executado (revisão reduzida)** |
| Fault Tolerance | 8,0 | 0 | 0 | 1 | 2 | F-fault-tolerance-1: `validadeDoReconhecimento` engole exceção silenciosa |
| Security | 8,5 | 0 | 0 | 1 | 2 | F-security-2: `confirmar` sem cheque `filCod` × allow-list do ator |
| Testability | 8,0 | 0 | 1 | 3 | 1 | F-testability-3: roteiro HML manual não executado antes de v0.76.0 |
| **Overall (4 QAs)** | **7,91** | **0** | **2** | **7** | **5** | — |

Interpretação: 0–3 risco estrutural; 4–6 dívida a endereçar; **7–8 saudável com oportunidades pontuais**; 9–10 referência para o estágio. A nota se refere ao delta, não ao sistema inteiro, e **não autoriza merge** por si só — autoriza a conversa de merge.

Gates do delta (worker, 2026-10-27, pós-rebase):
- Backend: typecheck clean; lint 0 errors / 126 warnings; jest **312 suites / 6 140 testes verdes**.
- Frontend: typecheck clean; lint 0 errors / 21 warnings; jest **123 suites / 1 383 testes verdes**.
- Re-check do orquestrador: 44 suites / 528 testes focados em `ElegibilidadeVinculo`, `libs/boleto`, migrations.

## 2. Riscos consolidados

Dois riscos materiais sustentados pela evidência deste delta, ambos P1, ambos de leverage alto porque a fase 2 (`SISPAG_BIND_CODBAR_DATA_DIVERGENTE_FILIAIS`, `PUT` no ERP) consome o output do que foi escrito aqui.

### R-1: Release 0.76.0 defende um invariante que o banco real nunca viu — P1

- **QAs afetados**: Testability (origem), Fault Tolerance (CHECKs 0091 só verificados contra texto SQL), Security (CHECK `reconhecedor_check` idem).
- **Findings de origem**: F-testability-3, apoio em F-fault-tolerance-1 (observabilidade do fail-closed).
- **Evidência sintetizada**: `_shared-metrics.md` registra "Not run: manual QA script; Saturday-rollover HML probe". Commit `532dd766 chore(release): v0.76.0` fez o bump sem registro de execução do roteiro. Os quatro CHECKs da migration 0091 nunca foram vistos sob dados reais.
- **Impacto técnico**: toda cadeia `confirmar → gravar → listar` foi exercitada só em mock. Se um CHECK estiver mal escrito, o primeiro reconhecimento em HML/PRD retorna `postgres error 23514` para o analista — não um teste quebrado.
- **Impacto de negócio**: fase 2 abre a flag em PRD confiando que o output da fase 1 é íntegro. Se não é, o primeiro vínculo real com data divergente é a primeira execução integrada da regra. É nesse ponto que dinheiro se move.
- **Cards relacionados**: `testability-3`, `fault-tolerance-1`, `testability-4`.
- **Custo de inação em 6 meses**: condicional — se a fase 2 abrir sem a prova integrada, qualquer CHECK mal-formado é descoberto em PRD. Premissa: fase 2 abre dentro da janela.

### R-2: `BoletoSuggestionService` virou atrator gravitacional — P1

- **QAs afetados**: Modifiability (origem), Testability (setup pesado), indiretamente Fault Tolerance (todo rollback transacional vive aqui).
- **Findings de origem**: F-modifiability-1.
- **Evidência sintetizada**: `BoletoSuggestionService.ts` passou de 1 182 → 1 287 LOC (+105 líquidos). A fase 1 adicionou o bloco I15r **em-linha** no `confirmar` (~40 LOC), mais `validadeDoReconhecimento` privado e o novo `contextoPorTitulo` público (~35 LOC). O arquivo de teste pagou o preço: 173 LOC só na suíte do delta.
- **Impacto técnico**: a fase 2 (binding real) vai cair no mesmo arquivo. Projeção: pós-fase-2 ≥ 1 400 LOC. Blast-radius crescendo linearmente com o LOC.
- **Impacto de negócio**: worktree-first amplifica conflito de rebase quando duas features SISPAG caminham em paralelo (a norma). Cada rebase paga pedágio na suíte de 173 LOC de setup.
- **Cards relacionados**: `modifiability-1`, apoio de `testability-1`.
- **Custo de inação em 6 meses**: fase 2 nasce em arquivo ≥ 1 400 LOC; cada ciclo subsequente paga mais no setup de teste do que no comportamento.

Não há evidência para dez riscos independentes. Os P2/P3 abaixo são refinamento.

## 3. Cross-cutting findings

### CC-1: Observabilidade silenciosa no fail-closed do reconhecimento
- **Aparece em**: Fault Tolerance (F-fault-tolerance-1), apoio em Testability (F-testability-3).
- **Diagnóstico**: `validadeDoReconhecimento` (`BoletoSuggestionService.ts:496-510`) tem `try { … } catch { return {}; }`. Tela trata `undefined` como "inválido" — correto (fail-closed), mas **mudo**. Em fase 2 o `vinculo_caminho = DATA_DIVERGENTE` depende diretamente desse derivado.
- **Recomendação**: card `fault-tolerance-1` (log `warn` com `decisaoId` + `erro`; não altera comportamento).

### CC-2: Aritmética de dia civil replicada entre 3 sítios novos
- **Aparece em**: Modifiability (F-modifiability-2), reflexo em Testability (3 suites separadas para o mesmo utilitário).
- **Diagnóstico**: `FatorVencimentoBoleto.ts:6`, `ElegibilidadeVinculoCodigoBarras.ts:120,129` e `src/frontend/app/sispag/situacao/prazoTitulo.ts:12-17` redeclaram `DIA_MS = 86_400_000`. `BankingCalendar` existe no backend mas não é usado nos novos puros. Gotcha "dia civil, não instante" já custou um incidente (ADR-0070).
- **Recomendação**: card `modifiability-2` (`domain/libs/calendar/CivilDays.ts` + espelho em `src/frontend/lib/`).

### CC-3: Fase 1 escreve o insumo que a fase 2 vai consumir sem allow-list por filial
- **Aparece em**: Security (F-security-2), apoio em Fault Tolerance.
- **Diagnóstico**: `POST /sugestoes-boleto/confirmar` só exige `SISPAG_EXECUTAR` (booleana por usuário). `filCod` chega pelo body. O ack persistido é o insumo direto que destrava o `PUT` no ERP em fase 2.
- **Recomendação**: card `security-2` — `exigirFilialAutorizada(req, body.filCod)` **antes** de abrir V-PRD2.

## 4. Quick wins (≤5 dias úteis — esforço S, severidade ≥ P2)

| Card | QA | Esforço | Severidade | Resultado esperado |
|---|---|---|---|---|
| `fault-tolerance-1` | Fault Tolerance | S | P2 | 100% das vezes em que `reconhecimentoValido` sai `undefined` por erro ficam no log |
| `testability-1` | Testability | S | P2 | `ConferenciaReconhecimento.test.ts`: 0 → ≥ 8 casos diretos |
| `testability-2` | Testability | S | P2 | `FaixaBloqueadosHoje` + `VencimentoCelula`: 0 → ≥ 6 testes |
| `testability-3` | Testability | S | **P1** | 1 execução registrada do roteiro HML V-HML1 + 4 CHECKs 0091 observados; pré-condição V-PRD2 |
| `testability-4` | Testability | S | P2 | Caso "sábado após feriado útil" promovido para `PrazoFinalBoleto.test.ts` (4 → ≥ 5) |
| `modifiability-2` | Modifiability | S | P2 | 3 → 0 ocorrências de `86_400_000` nos novos arquivos; `diffDays` único |
| `modifiability-3` | Modifiability | S | P2 | `grep -c "as EntradaElegibilidadeVinculo"`: 1 → 0 |
| `security-2` | Security | S | P2 | 100% dos `confirmar` com `filCod` fora da allow-list → 403; precede V-PRD2 |

**Primeira sprint pós-aprovação**: `testability-3` + `security-2` fecham o gap entre "fase 1 verde em CI" e "fase 2 pode abrir a flag em PRD".

## 5. Strategic moves (M / L / XL)

| Card | QA(s) | Esforço | Tactic alvo | Por que vale |
|---|---|---|---|---|
| `modifiability-1` | Modifiability (+Testability) | **M** | Split Module / Refactor | `BoletoSuggestionService` 1 287 LOC hoje; projeção pós-fase-2 ≥ 1 400 LOC; setup de teste do delta já consumiu 173 LOC. Extrair `ReconhecimentoDecisaoService` **antes** do PR da fase 2 é mais barato do que depois. Alvo: 1 287 → ≤ 900 LOC. |

Nenhum L/XL sustentado por este delta.

## 6. O que está bem (e por quê)

- **Executable Assertions (schema)** — migration 0091 define quatro CHECKs defensivos (`reconhecimento_tudo_ou_nada_check`, `tipo IN ('DATA_DIVERGENTE')`, motivo 10–500, `reconhecedor_check` rejeita `sistema`/`unknown`/`""`) e a invariante caminho-coerente (`DATA_DIVERGENTE ⇒ reconhecimento_id`). Banco fecha a porta antes do código.
- **Verify Message Integrity (anti-TOCTOU)** — `ConferenciaReconhecimento` compara `deltaDiasVisto`/`valorBoletoVisto` com Δ/valor **recalculados ao vivo** dentro da mesma transação; divergência vira `DivergenceAcknowledgementStaleError` (422), sem gravar.
- **Idempotent Replay** — `inserirDecisao` devolve `{criada:false, decisao}` quando `(ddcCod,ditCod)` já existe; duplo-POST absorvido sem efeito colateral.
- **Limit Structural Complexity (libs puras)** — 5 arquivos novos em `domain/libs/boleto/`, 28–91 LOC cada, 1 propósito cada. A nota 7 em Modifiability existiu apesar do inchaço do service, não por ele.
- **Limit Non-Determinism (prova explícita)** — `FatorVencimentoBoleto.test.ts:48-56` muta `jest.useFakeTimers().setSystemTime(2099)` e exige o mesmo output.
- **Limit Exposure (barcode)** — `CodigoBarrasBoleto.mascarar` único caminho; HML probes refusam base ≠ `-hml` (`exit(1)`).
- **Audit Trail imutável** — reconhecimento é **propriedade** da decisão (uma linha, mesma transação), replicado no `detalhe` do evento `DECISAO_CONFIRMADA` (trilha only-insert, ADR-0084).
- **Validate Input estrito** — `.strict()` em `ReconhecimentoDivergenciaSchema`; autor nunca vem do corpo (`ator(req)` do JWT); rota exige `exigirPermissao(SISPAG_EXECUTAR)` + `limiteDecisaoBoleto`.

## 7. Outros gates (não-QA)

### PatternGuardian
PASS, 0 violações. **Não citou** o schema da rota `confirmar` — essa superfície está no QA Security (`.strict()` + `ator(req)` do JWT verificado em `routes/sispag.ts:977-991` e `SugestaoBoletoSchemas.ts:34-62`). Separação legítima de responsabilidade entre o guardian de padrões DI/SQL e o QA de autorização.

### DesignSystemReviewer
Reportou 3 findings P0 de contraste em `src/frontend/app/sispag/situacao/VencimentoCelula.tsx:27,31,35` (`text-danger`/`text-warning` sobre badges outline). **Orquestrador verificou que essas linhas NÃO estão no delta**: existem em `origin/main` e o mesmo padrão aparece em **13 lugares** do app. **Reclassificação**: dívida pré-existente, **P2 follow-up WCAG AA**, não P0 deste PR. Entra em `ontology/_inbox/sispag-vinculo-data-divergente-regis-followups.md` como item transversal; corrigir num ciclo dedicado de design system.

### Grouped-título deadline gap (fora de ADR-0078)
Um título em boleto agrupado confirmado (`EM_GRUPO`) recebe `prazoBoleto` = sua **própria** data de vencimento, de modo que um grupo cujo boleto vence antes dos títulos nunca aparece em "vencem hoje". Evidência: `MotorSugestaoBoleto.ts:1017-1033` (branch `EM_GRUPO`), `PrazoBoletoCalculador.ts:38-59` (não recebe `boletoDataAgrupado`), `src/frontend/app/sispag/situacao/situacaoTitulos.ts:245-252`. Pré-existente desde PR #131, **fora do escopo ADR-0078**.

**Reclassificação**: P1 follow-up (não P0 deste PR). **Correção proposta**: alimentar a data do boleto do grupo em `PrazoBoletoCalculador` quando o título está em `EM_GRUPO`, com amendment na ontologia (I17p ou nova regra) explicitando `prazoEfetivo = min(prazoTítulo, prazoBoletoAgrupado)`. Entra em `ontology/_inbox/sispag-vinculo-data-divergente-regis-followups.md`.

## 8. Limitações da análise

- **Revisão reduzida**: 4 de 8 QAs rodados. Availability, Deployability, Integrability e Performance **não foram executados**. Nota 7,91 é dos QAs rodados; não representa maturidade global.
- **Delta-only, modo `--quick`**: dívidas pré-existentes (fire-and-forget do `ajusteCentavos`, ausência de DLQ no Express legado, `MotorSugestaoBoleto` 1 097 LOC) estão em `migration-debt.md` e **não** foram pontuadas aqui.
- **Fase 2 (binding real) não está em `src/`**. Achados sobre o vínculo real foram antecipados em `F-security-2` como dependência de V-PRD2.
- **Não medíveis localmente**: cobertura por linhas/branches, taxa real de `DivergenceAcknowledgementStaleError` em PRD, `npm audit`, enforcement de filial allow-list no `confirmar`.
- **Fora do pipe**: chaos engineering, threat modeling formal, custo cloud, UX, acessibilidade (P0 de contraste cobertos em follow-up P2).
- **Janela temporal**: snapshot de 2026-10-27, worktree `sispag-vinculo-data-divergente`, head `532dd766` (v0.76.0). Reavaliar após o PR da fase 2.

## 9. Ações recomendadas (30 dias)

1. **Executar o roteiro HML manual** e armar os 4 CHECKs 0091 contra dados reais (card `testability-3`). Pré-condição para abrir V-PRD2 da fase 2.
2. **Aplicar `exigirFilialAutorizada` em `POST /sugestoes-boleto/confirmar`** (card `security-2`) **antes** de abrir `SISPAG_BIND_CODBAR_DATA_DIVERGENTE_FILIAIS` em PRD.
3. **Extrair `ReconhecimentoDecisaoService` de `BoletoSuggestionService`** (card `modifiability-1`) **antes** do PR da fase 2.
4. **Centralizar `diffDays` + logar o fail-closed de `validadeDoReconhecimento`** (cards `modifiability-2` + `fault-tolerance-1`) — 2 quick wins S que cortam dívida que a fase 2 herda.
5. **Follow-ups em `ontology/_inbox/sispag-vinculo-data-divergente-regis-followups.md`**: P2 de contraste WCAG (13 ocorrências de `text-danger`/`text-warning` em outline badges); **P1 do grouped-título deadline gap** (`EM_GRUPO` ignorando `boletoDataAgrupado`, com amendment de ontologia).

---

**Total P0 = 0.** **P1 = 2**: `testability-3` (executar roteiro HML antes de habilitar phase 2) e `modifiability-1` (extrair reconhecimento tipado de `BoletoSuggestionService`). **Follow-ups P1 não-QA**: grouped-título deadline gap (`EM_GRUPO` + `PrazoBoletoCalculador`, pré-existente, fora de ADR-0078).
