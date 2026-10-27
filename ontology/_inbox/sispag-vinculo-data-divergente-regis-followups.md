# Follow-ups do Regis-Review — sispag-vinculo-data-divergente (ADR-0078)

Revisão reduzida de 2026-10-27 (4 QAs: Fault Tolerance, Modifiability, Security, Testability), só o delta
`origin/main...HEAD` da v0.76.0. **P0 = 0**: nada re-entra no loop. Relatório e cards completos em
`docs/regis-review/2026-10-27-1803-sispag-vinculo-data-divergente/` (`REPORT.md`, `KANBAN.md`).
Não implementados neste PR.

## P1
- [ ] **r8-rolagem-fim-de-semana** ⚠️ PRIMEIRO DA FILA (pedido do maintainer, 2026-10-27) (medição HML 2026-10-27) — `DataCandidataItem` usa `PrazoFinalBoleto` (rola com o
  `BankingCalendar`, pulando feriados), mas o ERP rola a barra só sobre sábado/domingo (ADR-0078, emenda R8). Inalcançável na
  Fase 1; antes de ligar a Fase 2, a janela do lote deve rolar só o fim de semana. Teste RED: barra sáb 31/10/2026, débito
  ter 03/11 (Finados na segunda) ⇒ fora da janela.
- [x] **testability-3** (executado 2026-10-27, ver o roteiro) — executar o roteiro manual `sispag-vinculo-data-divergente-roteiro-qa.md` (9 casos) em HML/dev antes
  de qualquer passo da fase 2; os CHECKs da migration 0091 só foram verificados contra o texto do SQL.
- [ ] **modifiability-1** — extrair o fluxo do reconhecimento tipado de `BoletoSuggestionService` (1.287 LOC, +105 neste delta)
  antes do PR da fase 2.
- [ ] **prazo-grupo** (fora do QA) — título de boleto agrupado (`EM_GRUPO`) recebe `prazoBoleto` = vencimento do próprio título;
  o boleto do grupo que vence antes nunca aparece em "vencem hoje" (`MotorSugestaoBoleto.ts:1017-1033`,
  `PrazoBoletoCalculador.ts:38-59`, `situacaoTitulos.ts:245-252`). Pré-existente desde a PR #131, fora do ADR-0078. Correção
  proposta: levar a data do boleto do grupo ao `PrazoBoletoCalculador` (teste RED: boleto 03/11, título 05/11, hoje 03/11 ⇒
  prazo 03/11) + emenda de ontologia.

## P2
- [ ] **fault-tolerance-1** — logar o motivo do fail-closed de `validadeDoReconhecimento` (hoje `catch {}` mudo).
- [ ] **testability-1** — teste unitário direto de `ConferenciaReconhecimento`.
- [ ] **testability-2** — testes de `FaixaBloqueadosHoje.tsx` e `VencimentoCelula.tsx`.
- [ ] **testability-4** — probe HML da rolagem de sábado (rodar em 3–4/11 para cair no sábado 07/11; ver `-medicao.md`).
- [ ] **modifiability-2** — centralizar a aritmética de dia civil (`DIA_MS`/`diasEntre`, 3 cópias back+front).
- [ ] **modifiability-3** — separar `ElegibilidadeVinculoCodigoBarras.lerCodigo` em caminhos 1:1 e borderô (sem cast).
- [ ] **security-2** — cruzar `filCod` do `confirmar` com a allow-list de filiais do ator antes da fase 2.
- [ ] **contraste-badges** (fora do QA) — `VencimentoCelula.tsx:27,31,35` usam `text-danger`/`text-warning` em badge outline
  (contraste abaixo de WCAG AA). Linhas pré-existentes em `main`, mesmo padrão em 13 lugares do app: dívida transversal,
  reclassificada de P0 (DesignSystemReviewer) para P2 pelo orquestrador.
- [ ] **qa-painel-desatualizado** (QA 2026-10-27, caso 3) — depois de um 422 `RECONHECIMENTO_DE_DIVERGENCIA_DESATUALIZADO`, o painel
  aberto e a linha mantêm o Δ/a data antigos até recarregar a página inteira, e reabrir o reconhecimento no mesmo painel repete o 422.
  Correção proposta: reidratar o painel a partir da lista recarregada, ou fechá-lo no 422. Acrescentar o subcaso "N candidatos"
  do caso 4 do roteiro, hoje sem cobertura (título com 2+ candidatos seguros).

## P3
- [ ] **fault-tolerance-2** — aceitar `Idempotency-Key` em `confirmar`.
- [ ] **testability-5** — property-based test de `FatorVencimentoBoleto.decodificar` (fast-check já é dependência).
- [ ] **modifiability-4** — enviar `diasAtePrazo` do backend em vez de recomputar no frontend.
- [ ] **security-1** — redigir/validar `reconhecimento_motivo` antes de persistir.
- [ ] **security-3** — diretório dedicado com modo 0700 para os dumps dos probes HML.

## Outros gates
- PatternGuardian: PASS, 0 violações.
- DesignSystemReviewer: diálogo do reconhecimento e painel conformes; os 3 "P0" eram pré-existentes (acima).
