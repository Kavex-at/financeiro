---
type: regis-review-report
run_id: 2026-08-28-0249-sispag-boleto-dda
generated_at: 2026-08-28T02:49:00Z
audience: technical (architects + senior devs + tech lead)
basis: Bass & Clements — Software Architecture in Practice
scope: delta commit 5978ac5 (feat/sispag-boleto-dda), modo --quick
total_cards_pre_dedupe: 37
total_cards: 31
total_p0: 0
total_p1: 5
total_p2: 19
total_p3: 7
overall_score: 7.2
gate_verdict: PASS (0 P0)
---

# Regis-Review — financeiro — 2026-08-28-0249-sispag-boleto-dda

> **Nota de estado (pós-review):** dois cards já foram resolvidos no commit `5558cf8`,
> depois que as seções QA foram escritas — `security-1` (audit trail da auto-resposta)
> e `security-2` (redigir barcode real). Ambos permanecem documentados abaixo com a
> marca **✅ RESOLVIDO**, porque o raciocínio que os motivou é a parte que interessa
> na reunião. Contagem aberta real: **P1 4 · P2 18 · P3 7 = 29 cards**.

## Contexto do delta

O commit `5978ac5` conserta um defeito silenciosamente ativo em produção: a auto-detecção
de boleto usava `fin064.titEspCodbar`, que a sondagem mediu **null em 100%** dos títulos
(0/2000 em `fin064`, 0/2173 no grid de pendentes, 0/50 em `com308`). Consequência: todo
BOLETO ia para a remessa SISPAG com **segmento J sem código de barras** — o banco
recusaria a liquidação, o pagamento atrasaria, o fornecedor cobraria de novo. O delta
corrige isso ligando o fluxo à associação DDA nativa do ERP (`titVldReflexoDdaAssoc`
no grid `fin015/titulosPendentes`), com fail-closed novo (`BoletoSemCodigoBarrasError`)
antes de qualquer escrita e auto-resposta allowlistada (chave EXATA
`FIN_041.EXISTE_CODIGO_BARRAS_ASSOCIADO_TITULO`) à pergunta do ERP.

Gates verdes: 1.502 testes backend, 189 frontend, typecheck e lint limpos. Nenhum
finding sai como P0. O que este relatório defende: **o gate do `/feature-tweak` PASSA
com folga**; a superfície nova, apesar de tocar o caminho de dinheiro saindo, foi
construída com fail-closed, retomada e `postGenericOnce` — e a lista de riscos abaixo
é de defense-in-depth, não de bloqueadores.

## 1. Executive scorecard

Pesos aplicados (financeiro multi-tenant que executa escritas que movem dinheiro —
Security 1.5, Fault Tolerance 1.3, Availability e Modifiability 1.2, Testability e
Performance 1.0, Integrability e Deployability 0.9, total 9.0).
Score ponderado: `64.6/9.0` ≈ **7.2**.

| QA | Score (0–10) | P0 | P1 | P2 | P3 | Top finding |
|---|---|---|---|---|---|---|
| Availability | 8 | 0 | 0 | 3 | 1 | `temBoleto=false` mascara indisponibilidade da leitura DDA |
| Deployability | 7 | 0 | 1 | 2 | 2 | Caminho DDA sem toggle — rollback derruba SISPAG inteiro |
| Fault Tolerance | 8 | 0 | 0 | 3 | 2 | Sem verificação pós-import de `itsNumCodbar` |
| Integrability | 6 | 0 | 2 | 3 | 1 | Zod ausente em `titVldReflexoDdaAssoc` (mesma classe do bug histórico) |
| Modifiability | 7 | 0 | 0 | 4 | 2 | `RemessaService.ts` 851→971 LOC no delta |
| Performance | 6 | 0 | 1 | 4 | 1 | Painel refaz leitura DDA já persistida (+7 a +10 req Conexos/abertura) |
| Security | 7 | 0 | 1 | 1 | 1 | Auto-resposta `YES` ao ERP sem audit trail ✅ **RESOLVIDO** |
| Testability | 8 | 0 | 0 | 2 | 3 | Payload de boleto DDA não asserta ausência de `pctCodSeq`/`conta` |
| **Overall** | **7.2** | **0** | **5** | **19** | **7** | — |

Interpretação: 0–3 risco estrutural · 4–6 dívida defensável · **7–8 saudável com
oportunidades pontuais ← posição atual** · 9–10 estado-da-arte.

## 2. Veredito do gate `/feature-tweak`

**PASSA.** 0 P0. Todos os P1 vão para follow-up em
`ontology/_inbox/sispag-boleto-dda-regis-followups.md`.

Justificativa técnica da nota 7.2 e do `PASS`:

1. O caminho quente de escrita SISPAG segue a doutrina do repo — `postGenericOnce`
   em 100% das escritas não-idempotentes (`criarLote`, `importarTitulos`, `gerarRemessa`);
   ledger write-ahead antes da 1ª escrita irreversível; máquina de retomada
   (`sincronizarComErp`) cobre 8/8 estados por teste; advisory-lock por hash do
   `loteId` serializa cliques duplos.
2. Fail-closed novo (`BoletoSemCodigoBarrasError`) barra ANTES de qualquer escrita
   de item no ERP — comprovado por teste dedicado em `RemessaService.test.ts`.
3. A superfície de risco NOVA (re-POST à `QUESTION`) tem allowlist EXATA de 1 chave,
   valida `questions.length === 1`, aceita apenas `id` presente, e o 2º POST é
   `postGenericOnce` (single-shot). 5 casos de teste dedicados.
4. `contrato.test.ts` cobre a fixture com os campos DDA — contract test move em passo
   com o código.
5. Cobertura por LOC-de-teste/LOC-de-fonte nos 4 arquivos do caminho quente:
   `ConexosSispagWriteClient` 1.00, `RemessaService` 1.04, `IngestaoPagamentosService`
   1.09, `SispagPainelService` 0.97 — todos acima do alvo Bass de 0.5.

O que puxa a nota para baixo: Integrability 6 (contrato QUESTION descoberto por
engenharia reversa sem fixture cru + coerção sem Zod) e Performance 6 (o painel refaz
uma leitura que a ingestão já persistiu).

## 3. Top 5 riscos cross-QA

Ordenados por risco real de negócio: dinheiro saindo errado > rastreabilidade > custo
operacional > débito.

### R-1: Contrato `QUESTION/answers` frágil

- **QAs**: Integrability, Testability, Security, Fault Tolerance
- **Origem**: F-integrability-1 (P1), F-testability-3 (P3), F-fault-tolerance-1 (P2), F-fault-tolerance-4 (P2)
- **Evidência**: o envelope `{type:'QUESTION', questions:[{id, key, answerList}]}` foi
  descoberto por engenharia reversa (o Conexos vazou o tipo Java num erro de
  deserialização). Zero fixtures do envelope em `__fixtures__/`. `QUESTION_SCHEMA.id`
  é `.optional()`. A propriedade "POST-QUESTION não escreve" é generalizada de **1**
  medição HML para todas as execuções PRD, sem canário runtime.
- **Impacto**: se o Conexos migrar `id → questionId` ou `answers → answer`, os testes
  unitários (que mockam o próprio shape) continuam verdes; o primeiro sinal é o banco
  recusar a remessa dias depois.
- **Cards**: `sispag-question-wire-contract`, `fault-tolerance-1`, `fault-tolerance-4`.

### R-2: Zod ausente em `titVldReflexoDdaAssoc` — a causa raiz do bug histórico

- **QAs**: Integrability, Fault Tolerance
- **Origem**: F-integrability-3 (P1)
- **Evidência**: `paraTituloPendente` faz `Number(r.titVldReflexoDdaAssoc ?? 0) === 1`.
  Coerção manual, sem Zod. Se o Conexos renomear o campo, `?? 0` degrada silenciosamente
  para `false` em 100% dos títulos — **exatamente a mesma classe do defeito que esta
  feature resolve**.
- **Mitigação existente**: o fail-closed inverte o modo de falha. O bug antigo era
  fail-OPEN (remessa com barras vazia); este seria fail-CLOSED (nenhum boleto oferecido,
  `BoletoSemCodigoBarrasError` no envio). Ruidoso, não perigoso — por isso P1 e não P0.
- **Cards**: `integrability-2`.

### R-3: Rollback do caminho DDA obriga desligar 100% do SISPAG

- **QAs**: Deployability
- **Origem**: F-deployability-1 (P1), F-deployability-5 (P2)
- **Evidência**: o único gate é `SISPAG_LIVE_WRITE_ENABLED && conexosWriteEnabled &&
  !conexosDryRun`. Blast-radius medido: 100% das escritas SISPAG vs. ~31–35% dos itens
  que carregam `titVldReflexoDdaAssoc:1` em PRD.
- **Impacto**: uma anomalia da fatia BOLETO trava também PIX/TED e conciliação.
- **Cards**: `deployability-1`, `deployability-3`.

### R-4: Audit trail da auto-resposta ao ERP — ✅ RESOLVIDO (commit `5558cf8`)

- **QAs**: Security, Fault Tolerance, Modifiability
- **Origem**: F-security-1 (P1)
- **Evidência original**: T1 do `tasks.md` previa `BUSINESS_INFO` a cada auto-resposta;
  não foi implementado (`grep -c 'LogService'` = 0). Acceptance criterion descumprido,
  não melhoria oportunista.
- **Resolução**: `LogService` injetado; cada auto-resposta emite `BUSINESS_INFO` com
  chave da pergunta, `questionId`, chave do lote e títulos. 2 testes novos.
- **Cards**: `security-1` (fechado).

### R-5: Painel refaz leitura DDA que a ingestão já persistiu

- **QAs**: Performance, Availability
- **Origem**: F-performance-1 (P1), F-performance-2 (P2), F-availability-3 (P2)
- **Evidência**: +7 requisições Conexos por abertura de painel para um lote da filial 2
  (2195 pendentes / 500 pageSize = 5 páginas + contas + lotes); +10 para lote misto 2+6.
  O mesmo valor já está em `titulo_a_pagar.tem_boleto` (≤ 24 h).
- **Tensão de desenho**: a leitura ao vivo foi uma **decisão explícita do Yuri** ("nos
  dois lugares"), coerente com a doutrina anti-drift. Este card é o contra-argumento
  numérico, não um defeito — a decisão é de quem tem o contexto de negócio.
- **Cards**: `performance-1`, `performance-2`, `availability-3`.

## 4. Cards deduplicados

10 cards fundidos em 4. Total: **37 → 31**.

| Card consolidado | Origem | Prioridade |
|---|---|---|
| `sispag-question-wire-contract` | integrability-1 + testability-3 | P1 |
| `sispag-dda-status-visivel` | availability-1 + fault-tolerance-2 | P2 |
| `sispag-probes-consolidation` | security-3 + deployability-4 + modifiability-4 + modifiability-6 | P2 |
| `sispag-truncamento-observavel` | testability-4 + performance-3 | P3 |

**Não deduplicado:** `security-1` (audit trail) vs `fault-tolerance-1` (canário runtime
pré re-POST) — resolvem propriedades diferentes; o próprio qa-security alertou para não
abrir 2 cards paralelos, mas o de FT ataca outro problema.

## 5. O que está bem — 8 pontos

1. **`postGenericOnce` em 100% das escritas não-idempotentes**. Fonte:
   `ConexosSispagWriteClient.ts:158,551,558,674`.
2. **Máquina de retomada cobrindo 8/8 estados por teste**. Fonte:
   `RemessaService.test.ts:220-472`.
3. **Fail-closed antes de qualquer escrita de item** — `BoletoSemCodigoBarrasError`.
4. **Allowlist EXATA de 1 chave** — 4 defesas independentes (Zod boundary,
   `questions.length === 1`, `===` estrito, re-POST single-shot), todas testadas.
5. **Advisory-lock por hash do `loteId`** serializa cliques duplos.
6. **`contrato.test.ts` cobre os campos DDA** — contract test em passo com o código.
7. **LOC-de-teste/LOC-de-fonte ≥ 0.97** nos 4 arquivos do caminho quente (alvo Bass 0.5).
8. **Ledger write-ahead ANTES da 1ª escrita irreversível**.

## 6. Delta debt vs. dívida herdada

- **Introduzida por este delta (~23 cards)**: toggle DDA, contrato QUESTION descoberto
  agora, coerção do novo campo, painel refaz grid DDA, particionamento sem teste,
  crescimento do `RemessaService.ts`, regra dispersa em 6 arquivos,
  `MODALIDADE_NATIVA.BOLETO=7` armadilha, CHANGELOG/runbook faltando, `flp 24` órfão
  em HML. (Audit trail e barcode real já resolvidos.)
- **Herdada, tornada visível (~8 cards)**: `WriteClient` que já hospedava 4 leituras;
  30 probes acumulados em `jobs/`; ausência de version-pinning no Conexos; reaper de
  execuções `error`; `console.warn` no client; `duration_ms` ausente; frontend
  `app/sispag/` sem teste.

## 7. Limitações da análise

- **Não medível localmente**: latência real de PRD (p50/p95), MTTR/MTTD histórico
  (sem CloudWatch/Sentry no stack Render), `npm audit` profundo (pulado por `--quick`),
  bundle size, deploy success rate.
- **Infra ausente por design**: Terraform, IAM, CloudTrail, tenant isolation — `infra/`
  não existe neste repo (documentado no `CLAUDE.md`). Nenhum finding aberto contra isso.
- **Fora do escopo do pipe**: chaos engineering, threat modeling formal, custo cloud,
  revisão de contrato jurídico com Conexos.
- **Janela temporal**: snapshot de 2026-08-28, `--quick` sobre o delta. A `main` anda
  rápido; refazer trimestralmente para o repo inteiro.
- **Sondagem de PRD**: 4 sondas read-only + 2 escritas em HML, um único snapshot
  (2026-08-27).

## 8. Ações recomendadas — 30 dias

1. **Dias 1–3 — quick wins de instrumentação**: `sispag-question-wire-contract`
   (fixture + Zod), `testability-1` (asserção negativa), `testability-2` (re-POST
   não-QUESTION). Todos S. *(`security-1` já feito.)*
2. **Dias 4–10 — rollback e observabilidade**: `deployability-1`
   (`SISPAG_DDA_ASSOC_ENABLED`), `deployability-2` (CHANGELOG + step de deploy),
   `deployability-3` (runbook do cutover), `integrability-2` (Zod estrito). Prepara o
   go-live real da primeira remessa BOLETO.
3. **Dias 11–20 — performance e defense-in-depth**: `performance-1` (decisão do Yuri
   sobre reusar `tem_boleto`), `sispag-dda-status-visivel`, `fault-tolerance-1`
   (canário runtime), `fault-tolerance-4` (read-back de `itsNumCodbar`).
4. **Dias 21–30 — housekeeping**: `sispag-probes-consolidation`, `deployability-5`
   (limpar `flp 24` em HML), `modifiability-3` (`MODALIDADE_NATIVA.BOLETO=7` como
   barreira de tipo). *(`security-2` já feito.)*
5. **Backlog trimestral**: `modifiability-1`, `-2`, `-5` (extração do `RemessaService`,
   consolidação da regra, split do builder) — ROI aparece na próxima modalidade nova.

---

**Referência cruzada**: cada card está detalhado em `KANBAN.md`.
