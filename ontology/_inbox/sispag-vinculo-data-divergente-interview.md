# Entrevista (tweak) — vínculo de código de barras com data divergente

Branch `feat/sispag-vinculo-data-divergente`. Estende `vinculo-codbar-item-sispag` (I17, ADR-0071).
Fase 2 (fora de escopo): ajustar a data do título (`fin026/alteraDataVencimento` ou `fin070`).

## Delta proposto

Novo caminho `DATA_DIVERGENTE` do passo 2: valor ainda **igual em centavos** (I17b intacta), boleto
com Δdias fora de 0..5, exige ack humano tipado da divergência. Emenda I15m/I15h/I17c ("nunca vincula
Δ<0") e a nota "passo 2 não lê ack". Vencimento decodificado do fator da barra vira 7º check de I17d
(fator reinicia em 22/02/2025; `0000` = sem vencimento), cruzado com a data do DDA.

## Respostas do maintainer (2026-10-26)

| # | Decisão |
|---|---|
| P0-1 | A mesma analista que confirma o par dá um **ack tipado e separado** (checkbox + motivo obrigatório). O ack grava o Δ e o valor vistos e **invalida se qualquer um mudar**. |
| P0-2 | Envelope mantido em **±10 dias**: ack para Δ em [-10,-1] e [6,10]. Valor: igualdade exata em centavos, sem tolerância. |
| P0-3 | **Boleto vencido na data de débito fica fora de escopo**: segue `VENCIDO_INFORMATIVO`. A barra precisa estar vigente na data de débito, rolada ao próximo dia útil bancário. |
| P0-4 | **Lote da data efetiva**: data candidata = min(título, prazo final) ≥ hoje (I8a). Item com Δ<0 vai para o lote da sua data e não puxa os demais para trás. Sem data possível, continua informativo. |

## Abertas (defaults do entrevistador, a confirmar)

- **P1-5:** flag própria `SISPAG_BIND_CODBAR_DATA_DIVERGENTE_FILIAIS`, default `off`; `shadow` registra o Δ. Portões HML antes de `on`: confirm com barra antes/depois do título, `finalizar` com `itsDtaPgto` menor/maior que o título, e o segmento J do `.REM`.
- **P1-6:** medir em HML se o J leva o vencimento do título ou da barra **antes de qualquer código**; guarda de data fail-closed (J.data == `itsDtaPgto`) junto do caminho novo. Se o J divergir da barra, o caminho fica `off` e a fase 2 vira pré-requisito.
- Δ>0: debitar na data do título ou na da barra depende da medição do J.
- Pendências: desempate da I16d.1; estado novo na UI para o par de data divergente (I15m hoje impede confirmar).

## Visibilidade do prazo efetivo (maintainer, 2026-10-26)

Aceitas as 5 propostas, mais o desempate de ambíguos:

1. **Prazo efetivo do título bloqueado = min(vencimento do título, prazo final do boleto candidato)**. Alimenta a faixa "bloqueados vencem hoje" (`FaixaBloqueadosHoje`), o contador, o filtro "Vencidos" e o filtro de/até da aba de títulos (hoje só `diaDoErp(t.vencimento)`).
2. A linha mostra a causa: "Boleto sugerido vence hoje · título vence dd/mm".
3. Mesmo botão da faixa ("Confirmar boleto sugerido"); a confirmação passa a pedir o ack tipado da divergência.
4. Só conta candidato acionável (âncora ou decisão `CONFIRMADA`); fraco/ambíguo sem âncora não puxa o título.
5. Boleto já vencido (< hoje) em linha separada: "perdido, resolver no portal do banco"; não entra no pagamento do dia.
6. **Ambíguos (decidido):** o prazo é o do candidato **mais cedo** entre os candidatos seguros, com o texto "N candidatos". Preferir um alerta a mais a perder o prazo.

Técnico: campo derivado `prazoBoleto` na lista de títulos, calculado na hora (como I15m), sem persistir.

## Respostas à revisão do diff (maintainer, 2026-10-26)

- **Δ<0, valor igual:** o ack tipado **substitui** o `reconheceAvisos` simples (implica `RECONHECEU_VENCE_ANTES`).
- **Δ>5, valor igual:** passa a pedir o ack tipado na confirmação.
- **"Perdido" (boleto < hoje):** linha separada e presente no filtro "Vencidos", **sem** virar motivo VENCIDO (ADR-0070) e sem entrar em "vencem hoje".
- **"Acionável":** CONHECIDO/FORTE (inclui ambíguos seguros, pelo mais cedo), ATENCAO ancorada ou `CONFIRMADA`. Fraco nunca puxa.
- **Pendente:** numeração (ADR-0078 / ontologia 0.49.0 / migration ≥ 0091, por colisão com `feat/sispag-boleto-agrupado`) e P1-5/P1-6 como defaults.
