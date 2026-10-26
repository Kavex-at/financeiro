# Boleto agrupado — follow-ups de observabilidade (Task 23, 2026-10-26)

Revisão do ObservabilityAdvisor sobre `BorderoGrupoBoletoService`, `FechamentoGrupoBoleto`, `CasamentoRetornoGrupo` e as views de métricas. Cada achado foi conferido no código antes de agir.

## Aplicado

- **P1 — logs das etapas `BAIXAS_GRAVADAS` e `BORDERO_CONFERIDO`**: faltavam entre "borderô do grupo criado" e "importado no lote nativo". Entraram (`BorderoGrupoBoletoService.ts`), com teste.

## Não aplicado (conferido)

- **"P0" — divergência de grupo sem Alerta: o achado está errado.** A divergência de parte paga (I21r) sai pelo caminho de sempre: `DecisaoStatusLote.aplicarGrupos` marca `divergencia` nos N itens e a decisão emite `sispag-baixa-divergente` por lote (`DecisaoStatusLote.ts:104-114`). O evento `GRUPO_DIVERGENTE` de `FechamentoGrupoBoleto.registrarDivergencia` é só a trilha. Um segundo alerta por grupo duplicaria o aviso. Rever só se a Columbia pedir o alerta por grupo.

## Follow-ups (não implementados, nada bloqueia o merge)

- **P2 — métrica de grupos pagos × divergentes no ciclo.** `vw_metricas_ciclo` conta os títulos do grupo como itens SISPAG comuns (`0070`, CTE `sispag`), sem separar. Nova CTE `sispag_grupos` sobre `sispag_grupo_boleto` (estado `PAGO`) e `sispag_grupo_boleto_evento` (`GRUPO_DIVERGENTE`), migration nova. Fazer depois de a primeira semana de PRD dar volume.
- **P3 — `CasamentoRetornoGrupo.casar` sem log.** Linha de retorno com `borCod` que casa (ou não) com a execução não deixa rastro. Injetar `LogService`: `info` no casamento (`loteId`, `borCod`, `grupoId`, `execucaoId`), `warn` quando uma linha com `borCod` não acha execução.
