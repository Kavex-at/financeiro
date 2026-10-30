# dda-pool-limpo — follow-ups do Regis-Review (2026-10-30)

> Run: `docs/regis-review/2026-10-30-2243-dda-pool-limpo/` (REPORT.md, KANBAN.md com o detalhe de cada card).
> Nenhum P0 (feature só de leitura). Score geral 7,0/10. Só P0 re-entra no loop; os abaixo NÃO foram implementados,
> exceto o marcado **FEITO**.

## Decisões abertas de produto
- `TITULO_SAIU_CARTEIRA` esconde boleto de "Todas" com casamento frouxo (±R$ 0,05, ±10 dias) contra qualquer título inativo
  (também cancelado/previsão/renegociado). Risco medido pelo fault-tolerance-2: cobrança recorrente cuja competência anterior
  foi cancelada some do painel. Decidir: restringir a elegibilidade (ex.: exigir `pago`, ou dias menores) e/ou telemetria.

## P1
- **FEITO** deployability-1 — UI tolerante a situação desconhecida (`badgeDaSituacao`, `rotuloDaSituacao` + teste). Bundle antigo já
  entregue precisa de reload (anotar no PR).
- **FEITO** fault-tolerance-1 (≡ availability-1 ≡ integrability-2) — `inativosOuNenhum` no `BoletoDdaService`: falha degrada para `[]` + `warn` em português (teste no `BoletoDdaService.test.ts`).
- fault-tolerance-2 — endurecer elegibilidade de `TITULO_SAIU_CARTEIRA` e instrumentar (ver decisão acima).
- **FEITO** performance-1 — `indexarSaidos` ordena por centavos e `saiuDaCarteira` faz busca por faixa ±5 centavos (como `indexarAbertos`). Medição antes: +436 ms com ~23 k boletos; não remedido após a mudança (contagens da PRD idênticas).
- **FEITO** testability-1 — unit (SQL/params) em `TituloAPagarRepository.test.ts` e integração com bordas 00:00Z/15:00Z em `TituloAPagarRepository.integration.test.ts` (rodada contra Postgres 17 descartável: 14/14 com o do BoletoDda).

## P2
- [availability-1] Degradar graciosamente quando `listInativosRecentes` falha
- [availability-2] Limitar e cobrir por índice a nova query de inativos
- [deployability-2] Introduzir `arquivos` como opcional + default no FE
- [deployability-3] Feature flag para desligar o pool consolidado DDA sem revert
- [deployability-4] Fonte única de contrato (ou contract test) para `BoletoDda*`
- [integrability-1] Introduzir shim retrocompatível no serializador do pool DDA
- [integrability-2] Blindar `consolidarEscopo` contra falha do `listInativosRecentes`
- [integrability-3] Expor janela da carteira via `EnvironmentProvider`
- [modifiability-1] Quebrar `PaginacaoBoletoDda.totalizar` em passes nomeados
- [modifiability-2] Encapsular "esconder saídos da lista padrão" como filtro declarativo
- [modifiability-3] Mover `JANELA + LIMITE_DIAS_SAIDO` para a lib de janela
- [modifiability-4] Registry único para `BoletoDdaSituacao` (label + segmento + ordem + chave de total)
- [performance-2] Tornar o filtro de `vencimento` em `listInativosRecentes` sargável
- [performance-3] Instrumentar `duracaoMs` nas fases de `BoletoDdaService.listar`
- [performance-4] Garantir que a chave do `ConsolidacaoBoletoDdaCache` reflita `titulosSaidos`
- [testability-2] Trocar `Date.now()` da `IngestaoPagamentosService` pelo relógio injetado

## P3
- [deployability-5] Release marker + contador para novas situações
- [fault-tolerance-3] Desempate explícito em `comGrupo` quando múltiplas cópias têm grupo `CONFIRMADO`
- [fault-tolerance-4] Contador/telemetria para boletos `FORA_JANELA`
- [fault-tolerance-5] `statement_timeout` dedicado para `listInativosRecentes`
- [integrability-4] Documentar política do contrato FE para `copias`
- [modifiability-5] Separar `comGrupo` do `BoletoDdaService`
- [modifiability-6] Nomear o recorte da janela de inativos
- [security-1] Blindar o payload DDA caso a Columbia venha a criar role somente-DDA no futuro
- [security-2] Fixar invariante de parametrização em `listInativosRecentes` com teste e comentário
- [testability-3] Gravar o contrato das novas situações num teste de rota
- [testability-4] Partir `BoletoDdaService.test.ts` por responsabilidade
- [testability-5] Caso "saiu da carteira sem credor" no teste de consolidação

## Do trabalho de rebase (fora do Regis)
- Decisões/grupos são chaveados por item (ddc:dit); `comGrupo` já procura em todas as cópias e reaponta a linha para a cópia que tem o grupo (CONFIRMADO vence SUGERIDO). Decisões de sugestão por título seguem o motor, que lê todas as cópias.
