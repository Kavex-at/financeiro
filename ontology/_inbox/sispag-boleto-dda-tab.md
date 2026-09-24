# SISPAG — aba "Boletos DDA (fin124)"

> Feature `sispag-boletos-dda-tab` (2026-09-24). Entidade: `ontology/entities/boleto-dda.md`.
> Origem: dois erros `BoletoSemCodigoBarrasError` em testes de remessa (2026-09-22/23) que exigiram
> garimpar o fin124 à mão. A aba torna essa busca um filtro.

## Decisões (respondidas em 2026-09-24)

1. **Atualização:** só botão manual ("Atualizar DDA") + job `npm run job:ingest-boletos-dda`. Sem cron.
2. **Período:** padrão "a vencer" (vencimento ≥ hoje em Brasília), com opção "Todos".
3. **Janela de candidato:** ±3 dias entre o vencimento do boleto e o do título, valor exato.

## Os dois casos que motivaram

| | PEDRONI 34697/1 (fil 2) | ADP 5046/1 (fil 1) |
|---|---|---|
| Título (fin064) | R$ 1.412,00, vence 23/09 | R$ 4.815,33, vence 24/09 |
| Boleto provável (fin124) | #145, nº 329691, vence 24/09 | #152, nº 001532761, vence 25/09 |
| Vínculo no fin124 | nenhum | nenhum |
| Diferença | +1 dia | +1 dia |

Barras dos dois boletos confirmam o vencimento pelo fator (1579 → 24/09; 1580 → 25/09).

## Hipótese aberta (P1)

**O Conexos só associa boleto DDA a título com vencimento idêntico.** Indício novo, 2026-09-24:
depois da conversa, a carteira ingerida mostra o **5046/1 com vencimento 25/09 e `tem_boleto = true`**
— ou seja, com o vencimento alinhado ao do boleto, o Conexos passou a sinalizar o DDA. Falta
confirmar gerando a remessa (deve passar) e, idealmente, comparando os boletos que o Conexos
vinculou com os vencimentos dos seus títulos.

Se confirmada, a coluna "diferença" da aba vira o diagnóstico direto: `+N dias` = ajustar o
vencimento do título no Conexos antes de gerar a remessa.

## Fora do escopo desta entrega

- Ação "usar este boleto" (colar a linha digitável no item do fin015 via
  `finItemSispag/validacao/codigoBarras`). É escrita nova no ERP → `/feature-tweak` próprio.
- Filtros de faixa de valor e de data (a busca textual já cobre valor e número).
- Atalho da aba de títulos ("ver boletos candidatos") para esta aba pré-filtrada.
