# Follow-ups — sispag-guarda-codbar-repetido (PR 1: detectar e abortar)

Registrados no ship da guarda I16 (ADR-0069, app v0.66.1). Nada abaixo foi implementado nesta entrega.

## F1 — Repetição entre lotes vivos e contra boleto já pago (P2)
A guarda vale dentro de um lote. O mesmo boleto em dois lotes (vencimentos distintos, ADR-0064) ou já
pago não é detectado. Requer hash salgado do código (HMAC com segredo do `EnvironmentProvider`)
persistido + migration + ADR próprio. Nunca persistir o código nem a forma de 44 dígitos.

## F2 — Passo 2 da ADR-0068 chama a mesma função depois do `PUT finItemSispag` (P1)
`AnaliseCodigoBarrasRepetido.analisar` é pura e sem dependência de ERP/ledger. O passo 2 (bind do código
confirmado ao item) deve chamá-la sobre o conjunto final de códigos do lote, depois do `PUT`.
Pré-requisito declarado na ADR-0069.

## F3 — R3: leitura única (pageSize 500) e itens sem código pós-import (P2)
`listarLinhasDigitaveisDoLote` é página única. Hoje, `itens + invalidos < nº de BOLETO` vira `warn` e
segue (a rede do `.REM` cobre). Decidir com o Yuri se vira abort (fail-closed total). Afeta a retomada
de lotes em que o ERP ainda não preencheu `itsNumCodbar`.

## F4 — Retirar o título do lote local não retira o item do rascunho nativo (P1)
A guarda lê o rascunho nativo do ERP, que não se apaga por API. Depois de a analista retirar o título
repetido do lote LOCAL, a retomada reaproveita o rascunho que ainda contém o item importado e a guarda
bloqueia de novo (fail-closed correto: finalizar pagaria o boleto duas vezes). A saída hoje é cancelar o
rascunho no Conexos. É o escopo da feature separada de remoção automática (PR 2); o texto da mensagem
"o rascunho no Conexos será reaproveitado" só se cumpre nela.

## F5 — Unificar as três máscaras de código de barras (P3)
I15k (banco…4), `RemessaCnabValidator.mascarar` (4+x+4, barras inválidas) e I16e (5+4). A guarda define a
sua e não altera as outras. Unificar mexe em I15k e nos testes do painel.
