# Gap — sispag-vinculo-data-divergente (G1 FECHADO em 2026-10-26)

## G1 — **RESOLVIDO** (decisão do maintainer 2026-10-26: sim, cobre também o VENCIDO_INFORMATIVO ancorado de valor igual com barra < hoje, sem puxar o `prazoEfetivo`; emenda I19t(3)/(5), caso 19, ADR-0078, CHANGELOG 0.49.0 e `PrazoBoletoCalculador.perdidoInformativo` aplicados) — "Perdido" (I19t(5)) e candidato VENCIDO_INFORMATIVO

I19t(3) diz que `VENCIDO_INFORMATIVO` nunca puxa o prazo; I19t(5) e o caso canônico 19 dizem que barra `< hoje`
é `perdido = true`. Pela regra I15h a barra `< dataDebito` já é `VENCIDO_INFORMATIVO`, e sem lote a
`dataDebito` é o vencimento do título. Logo, com título a vencer e barra de ontem, o candidato é
informativo (não acionável) e **não** aparece como "perdido".

**Implementado (leitura literal):** `perdido` só nasce de candidato acionável (CONHECIDO/FORTE, ATENCAO
ancorada, CONFIRMADA não órfã) cujo prazo final `< hoje`. Na prática: decisão CONFIRMADA cuja barra passou, ou
título já vencido com barra posterior ao título mas `< hoje`.

**Pergunta ao Yuri:** o "perdido" deve cobrir também o par de valor igual + âncora que está
`VENCIDO_INFORMATIVO` com barra `< hoje` (título ainda a vencer)? Se sim, é uma emenda à I19t(3) e a mudança é
só em `PrazoBoletoCalculador.acionavel` (um caso a mais, sem puxar o `prazoEfetivo`).
