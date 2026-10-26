---
name: sugerirGruposBoleto
type: action
entity: GrupoBoleto
ontology_version: "0.48.0"
implementation_status: implemented
status: draft
owners: [yuri]
related_files:
  - src/backend/domain/service/sispag/MotorGrupoBoleto.ts
  - src/backend/domain/service/sispag/RegraGrupoBoleto.ts
  - src/backend/domain/service/sispag/GrupoBoletoService.ts
  - src/backend/routes/sispag.ts
last_review: 2026-10-21
preconditions:
  - "Usuário com `sispag:ver` (ver a sugestão não é confirmar; confirmar exige `sispag:executar`)."
  - "Boleto livre no pool DDA local (sem docCod/titCod, I15e(1)), fora de outro GrupoBoleto CONFIRMADO e sem DecisaoSugestaoBoleto CONFIRMADA."
  - "Par (pesCod, emissorChave) VIGENTE ou candidato a par (confirmável no mesmo ato, I21a)."
  - "Pool DDA e carteira persistida legíveis; leitura que falha não vira 'sem grupo' (fail-closed, sem afirmação absoluta)."
postconditions:
  - "Lista calculada de grupos fechados no mesmo vencimento (I21e) e de partições intercambiáveis (I21f), cada um com `confirmavel` e motivo."
  - "Grupo fechado com título que falha I21c (ex.: aguardando alçada) é exibido com o motivo e `confirmavel = false`; o título nunca é descartado para sugerir subconjunto (decisão PI-7)."
  - "Conjunto que cruza filial aparece com `CRUZA_FILIAL`, não confirmável (I21d)."
  - "Ambiguidade (G6, emenda 2026-10-21): boleto que bate com a soma de dois conjuntos fechados (dois credores, mesmo dia, mesma soma), ou dois boletos idênticos não intercambiáveis pela I21f que casam o mesmo conjunto => nenhuma sugestão para eles; a analista compõe à mão."
  - "Nada persistido (I-DDA1)."
side_effects:
  - "Nenhum: só leitura local (pool, carteira, grupos e decisões). Zero chamada ao Conexos."
---

# sugerirGruposBoleto

ADR-0077 (P0-1, P0-2). Para cada boleto livre, o conjunto candidato é **todos** os títulos em aberto do
mesmo `pesCod` na mesma filial com vencimento **igual** ao do boleto (dia civil); só é sugerido se a soma
dos líquidos bate ao centavo com o boleto (I21b). Nunca subconjunto livre (medição M1: 922 de 2369 falsos).
K boletos iguais × títulos de mesmo valor ⇒ partição determinística marcada `intercambiavel` (I21f), cada
grupo confirmado à parte. Sugestão ambígua (G6: dois conjuntos fechados para o mesmo boleto, ou dois boletos
idênticos não intercambiáveis para o mesmo conjunto) não é sugestão: nada é exibido para esses boletos, e a
GT1 (Task 22) conta a frequência. Composição fora disso é manual (`confirmarGrupoBoleto` com `origem = MANUAL`).
Pura e idempotente; separada da sugestão 1:1 (I15), que passa a mostrar `EM_GRUPO` para título de grupo
(I15q). **Implemented.**
