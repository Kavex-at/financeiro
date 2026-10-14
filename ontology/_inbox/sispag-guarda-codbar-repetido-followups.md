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

## Regis-Review reduzido 2026-10-14-1806 (Security, Testability, Fault Tolerance) — sem P0

Fault Tolerance teve um P1, corrigido em `ce9243e` (ledger retomável depois do aborto).

## F6 — Convênio/arrecadação (prefixo 8) vira "ilegível" e abortaria o lote (P3)
Códigos de 44 posições iniciados por `8` não têm o DV mod 11 de boleto bancário. Frequência **não
medida**: a tentativa de contar `itsNumCodbar` por prefixo nos lotes recentes em PRD (read-only) devolveu
403 do Conexos para o robô. Medir (via HML ou com permissão) antes do PR 2; se houver ocorrência,
tratar convênio como "fora do escopo da guarda" em vez de abortar.

## F7 — Testes: apenas 1 dos 3 DVs de campo exercitado em `paraBarras`; privacidade só parcial no serviço (P2)

## F8 — `message` limita 20 títulos, `details`/log não (P2); `lidas` conta linhas não-boleto (P2)

## F9 — JSDoc órfão em `RemessaService` (~1032–1036) e `lastIndexOf(':')` na chave composta (P2, PatternGuardian)

## F10 — Gate 5.1 do `.REM` detecta depois do `finalizarLote`: recuperação é manual (P2)

## F11 — Mudança de comportamento fora da guarda (registrar na PR)
O predicado de retomada agora também encaminha `status='error' && etapa='finalizar' && nativeFlpCod`
por `sincronizarComErp` (necessário para o ledger ficar retomável depois do aborto).
