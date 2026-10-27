# SISPAG boleto agrupado — follow-ups do regis-review (2026-10-26-1700)

Origem: `docs/regis-review/2026-10-26-1700-sispag-boleto-agrupado/`. Sem P0. Remediados: security-1/3 (`8b81e760`),
fault-tolerance-1 (`a7de54fa`). Abaixo, o que ficou sem implementar.

## P1 (antes de ligar o PRD)

- **hml-v7-2 — BLOQUEIA O MERGE #131:** V7, 3ª rodada (851/852): 5/6, o borderô 259 foi reaproveitado,
  mas o item seguia no lote 63 e o ERP recusou finalizar o 64. Implementar detecção antes de importar,
  retirada integral `BORDERO_ANTERIOR_NAO_RESOLVIDO` e alerta acionável; preservar o antigo. Falha/ambiguidade
  de leitura também bloqueia. A liberação automática é exploração paralela e não integra esta correção.
  Código/retomadas/limpeza corrigidos e validados localmente (305 suítes / 5979 testes; typecheck/lint exit 0).
  Plano: `sispag-boleto-agrupado-reenvio-rejeitado-plano.md`; investigação:
  `sispag-boleto-agrupado-reenvio-rejeitado-exploracao.md`. A prova HML da guarda segue pendente.

- **hml-v7-1 (resolvido antes do merge do #131)** — Execução do borderô ficava `importado` para sempre; a remessa seguinte de um
  grupo com J rejeitado virava `indeterminado` em vez de reaproveitar o borderô (I21s). Achado pela V7 em HML de 2026-10-27,
  corrigido em `FechamentoGrupoBoleto` + `BorderoGrupoBoletoService.preparar`. Ver `sispag-boleto-agrupado-hml-achados.md`
  ("Defeito: recuperação após rejeição do J") e a emenda de 2026-10-27 da ADR-0077.

- **fault-tolerance-2 / integrability-3 / testability-3** — Rodar as fases HML `falha`, `retomada` e `v7` e a medição
  PRD GT1/GT2 (read-only). Incluir o cenário novo do F-ft-1: `borTimCad` fora da janela de 120s ⇒ `indeterminado`
  (e conferir se o `fin010/list` aceita a faixa de ±24h da varredura larga).
- **Decisão de domínio a confirmar (F-ft-1)**: a varredura larga bloqueia qualquer borderô do robô, na mesma conta e
  data, que não seja de execução nossa do mesmo lote ou grupo. Borderô de outro lote no mesmo dia gera
  `indeterminado` (falso positivo possível, só em retomada pós-queda). Confirmar se o analista aceita isso ou se
  prefere restringir por outro critério (ex.: itens do borderô).

## P2

- **security-2** — Fail-closed quando faltar o claim `permissions.filiais` (depende do provisionamento do claim).
- **fault-tolerance-3** — Revalidar `gerNum` do item nativo em `concluirImport`.
- **fault-tolerance-4** — `anotarBaixa` gravar `bxaMnyValor` observado.
- **fault-tolerance-5** — Write-ahead da baixa entre `gravarBaixaSimples` e `registrarBaixa`.
- **fault-tolerance-6** — Eventos `GRUPO_PAGO` e `GRUPO_J_REJEITADO` na trilha.
- **fault-tolerance-7** — Reaper e bloqueio para partial-pay sem decisão.
- **integrability-1 / testability-1** — Fixtures reais do `fin010` do grupo.
- **integrability-2** — Contador de parse-failure Zod por endpoint.
- **integrability-5** — Match do retorno com `filCod`/`bncCod`/`flpCod`.

## P3

- **security-4** — Emenda à ADR-0077 sobre a autorização por filial (fail-open atual, roteiro fail-closed).
- **integrability-4** — Pinning de versão do Conexos com o fornecedor.
- **testability-2** — Quebrar `BorderoGrupoBoletoService.test.ts` (1.697 LOC) e extrair o fake do ERP.


## P2 da revisão da guarda de reenvio (2026-10-27)

- **Contrato bruto das leituras:** o adapter legado normaliza `rows` ausente/não-array para `[]` e
  cabeçalho supre filial/banco/status ausentes. A guarda recebe os resultados já normalizados e não
  distingue esse drift de uma ausência válida. Endurecer o boundary com teste de envelope HTTP 200
  malformado e assegurar que erro de contrato não vira prova de liberação; escopo separado da correção
  do vínculo observado em HML. Fonte: `domain/client/legacyConexosAdapter.ts` e
  `ConexosSispagWriteClient.getLoteNativo`; relatório de integrabilidade desta rodada.
