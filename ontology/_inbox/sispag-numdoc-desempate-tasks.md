# Tasks: sispag-numdoc-desempate

**Spec source:** ADR-0079 (rascunho), regra I15s "âncora de número" (`NUMERO_CONFIAVEL`) em
`ontology/business-rules/sugestao-boleto-dda-sispag.md`; aprovada pelo Yuri em 2026-10-27.
**entity_changed:** true (diff de ontologia escrito por outro agente; não é tarefa deste arquivo)
**Estimated scope:** M (motor + regra + 1 consulta nova + 1 sinal na UI; sem migration, sem rota nova)

## Decisões que o TaskScoper fixou (overrides da proposta)

- (a) Âncora DPS e âncora de número em boletos DIFERENTES do mesmo título → `AMBIGUA` (texto próprio).
- (b) Outras parcelas do MESMO documento (mesmo `filCod`+`docCod`, `titCod` diferente) NÃO são duplicata.
- (c) Duplicata de título vem de leitura NOVA do `TituloAPagarRepository` SEM filtro `ativo` (só Postgres,
  SQL parametrizado), entregue ao motor ao lado de `listAtivos()`.
- (d) Boleto sem emissor nunca é âncora de número.
- A camada 0 do motor vira "âncoras fortes" (DPS + número), sem duplicar código.

## T1 — Regra: normalização e constante (`RegraSugestaoBoleto`)
- [ ] `RegraSugestaoBoleto.normalizarNumero` (dígitos, sem zeros à esquerda) e constante
      `NUMERO_CONFIAVEL_MIN_DIGITOS = 4`; `numerosIguais` passa a usá-la.
- AC: números `'0025037'` e `'25037'` normalizam igual; vazio devolve `''`; teste em `RegraSugestaoBoleto.test.ts`.

## T2 — Sinal `NUMERO_CONFIAVEL` (interface BE + schema/rótulo FE)
- [ ] `SINAL_SUGESTAO.NUMERO_CONFIAVEL`; `SINAIS_SUGESTAO_BOLETO` (zod) e `TEXTO_SINAL`/`SINAIS_ANCORA` no FE.
- AC: schema FE aceita o sinal; rótulo "número do boleto igual ao do documento (confiável)", sem aviso.

## T3 — Repositório: números de documento de todos os títulos
- [ ] `TituloAPagarRepository.listNumerosDocumento()` — lê `titulo_a_pagar` SEM `ativo`, só colunas
      necessárias, SQL sem interpolação.
- AC: teste unitário do SQL (sem `ativo = TRUE`, parametrizado) e do mapeamento.

## T4 — Serviço: alimenta o motor
- [ ] `BoletoSuggestionService.sugerirAgora` lê a lista nova junto de `listAtivos()` e a passa em
      `titulosDoCredor`.
- AC: teste do serviço mostra a chamada e o campo na entrada do motor.

## T5 — Motor: âncora de número + camada 0 generalizada
- [ ] Candidato ganha `NUMERO_CONFIAVEL` quando TODAS valem: tier CONHECIDO/FORTE (envelope FORTE);
      `numerosIguais` e ≥ 4 dígitos; boleto com `emissorChave`; nenhum outro boleto do pool completo
      (`listBoletos({})`, qualquer data, vinculados inclusive) com mesmo número e mesmo emissor; nenhum
      outro título do mesmo `pesCod` (exceto parcelas do mesmo documento) com o mesmo número; nenhum
      outro candidato do título com o mesmo número.
- [ ] Precedência = DPS: vence qualquer candidato (inclusive CONHECIDO), reserva o boleto na camada 0
      (contrato legado e desfecho); dois títulos reivindicando o mesmo boleto por âncora forte → nenhum
      reserva; confirmável como o escolhido por DPS.
- [ ] Conflito DPS × número em boletos diferentes → `AMBIGUA`, sem reserva, motivo próprio.
- AC (`MotorSugestaoBoleto.numero.test.ts`): caso real (título 25037, R$ 647,56; boletos 25037 e 25041,
  R$ 647,57, mesmo dia/emissor) → escolha 25037, confirmável, reservado; um teste por desqualificador
  (3 dígitos; duplicata no pool com mesmo emissor desqualifica, com emissor diferente NÃO; título
  duplicado do credor; parcela do mesmo documento NÃO desqualifica; candidato duplicado; sem emissor;
  fora do envelope FORTE); vence CONHECIDO; DPS × número divergentes → AMBIGUA; DPS e número no mesmo
  boleto → escolhido; dois títulos no mesmo boleto → nenhum reserva; o outro título vê o boleto como
  reservado (não `compartilhado`).

## Gates (DoD)
- [ ] typecheck/lint/test backend e frontend verdes
- [ ] PatternGuardian; DesignSystemReviewer (só um rótulo no FE)
- [ ] Ontologia (I15s, ADR-0079, `_index`/`_coverage`) aplicada pelo OntologyCurator
- [ ] Regis-Review (P0 only), rebase da `main`, bump de versão + CHANGELOG (`feat`)
