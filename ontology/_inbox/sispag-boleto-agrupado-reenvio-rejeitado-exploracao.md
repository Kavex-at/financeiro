# Reenvio após J rejeitado — exploração da liberação no Conexos

Data: 2026-10-27. Estado: **opção 2 em exploração; não autoriza escrita nem automação**.
Escopo desta análise: arquivos e histórico locais; nenhuma chamada ao ERP, alteração de dados, commit ou push.

## Decisão e bloqueador de merge

A opção 1 (detectar o vínculo ao lote anterior **antes de importar**, retirar com
`BORDERO_ANTERIOR_NAO_RESOLVIDO` e emitir Alerta) é o bloqueador imediato do merge.
A opção 2 (liberar automaticamente o item rejeitado e reenviar) permanece investigação separada.
Não há evidência local suficiente para declarar segura uma operação que libere somente o rejeitado
num lote nativo finalizado, especialmente depois de `.REM` e retorno, ou num lote misto.
A presença em `borderosPendentes` **não prova** que o pagamento está livre de outro lote ativo.

## Evidência que motiva a investigação

V7, terceira rodada, títulos 851/1 e 852/1, filial 2, banco nativo 4, 2026-10-27:

- Primeira remessa: borderô 259, lote nativo 63, `PG271004.REM`, retorno 11, rejeição `BI`
  (selecionada de `fin050`, `tpret=2`); grupo `REJEITADO`, lote local `RETORNADO`, Alerta emitido.
- Segunda tentativa: lote nativo 64; reaproveitamento do borderô 259 e importação observados.
  Finalização recusada: “EXISTEM ITENS DE PAGAMENTO QUE ESTÃO CONTIDOS EM OUTROS LOTES ATIVOS”.
  V7 terminou **5/6**; check 5 falhou corretamente. Um único borderô vivo não garante remessa válida.
- Resíduo informado pela rodada: 63 finalizado com arquivo e retorno rejeitado; 64 em rascunho
  contendo o item do borderô 259. Não foi realizada releitura nova nesta exploração; não afirmar
  limpeza, baixa paga, cancelamento ou recuperação já concluída.

Fontes: `/tmp/hml-boleto-agrupado-e2e-v7-3.log:425-428` (recusa e check);
histórico local `/home/inteli/.claude/projects/-home-inteli--rea-de-trabalho-projects-kavex-financeiro/8c23b388-86cd-433c-8282-8d98aa6a7744.jsonl`,
mensagem de 2026-10-27T15:25:11.374Z (`uuid 77d7049a-3246-428a-9c16-5ff5f789b5bc`).
Um extrato seletivo saneado foi preservado pelo coordenador em
`evidencias/sispag-boleto-agrupado-hml-2026-10-27/hml-boleto-agrupado-e2e-v7-3-extrato.log`;
o log integral temporário não deve ser copiado sem remover credenciais e barras completas.

## O boleto simples já resolve isso?

Não foi localizado um fluxo de produto comprovado que solte automaticamente o item rejeitado.
A orientação “sanear cadastro e reenviar em lote novo” descreve a intenção humana, sem fornecer
contrato de liberação: `ontology/_inbox/sync-status-lote-sispag-ontology-diff.md:75,165,397`.
A ADR-0064 registra a lacuna do rejeitado em `RETORNADO` (`ontology/decisions/0064-sispag-lotes-por-vencimento-e-mover-titulos.md:85-86,130`).

O caminho de retomada reconhece lote cancelado externamente (status 2/3) e exige confirmação da
intenção antes de criar outro: `src/backend/domain/service/sispag/RemessaService.ts:1148-1162`
e `:450-455`. Isso **não executa cancelamento**, não prova liberação por item e não é reenvio bancário
automático. A sincronização de situação e a rejeição do retorno tampouco constituem liberação.

## Operações encontradas: alcance real da prova

| Operação | Evidência local | Limite / estado da prova |
|---|---|---|
| Ler cabeçalho e itens nativos | `ConexosSispagWriteClient.ts:600,852-879`; lista `fin015/finItemSispag/list/{fil}/{bnc}/{flp}` | Contrato existente; exigir leitura completa e identidade. “Rascunho” no nome do método não prova capacidade de mutar finalizado. |
| Retirar **item de rascunho** | `ConexosSispagWriteClient.ts:1184-1210`: `DELETE fin015/finItemSispag/{bnc}/{flp}/{its}/{filItem}/{filLote}`; achados HML e probe TDD v3 (`probe-hml-boleto-agrupado-tdd.ts:595-635`) | Medida para rascunho, seguida de ausência observada e retorno a pendentes. Não comprovada para finalizado com `.REM` e retorno rejeitado. Não promover a operação além do contrato atual. |
| Cancelar **lote inteiro** | `src/backend/jobs/cleanup-fin015-testes.ts:12-15,45-51`: `GET fin015/cancelarLote/{fil}/{bnc}/{flp}`; chamadas também nos jobs `validate-fin015-import.ts:515` e `execute-fin015-prd.ts:395` | Endpoint candidato existente em harness; esses sítios não comprovam segurança pós-retorno. O cleanup imprime CANCELADO após resposta, sem demonstrar a pós-condição por releitura. |
| Reconhecer cancelamento | `ontology/business-rules/retomada-remessa-sispag.md:46-55`: medição de lotes com status 2 e zero itens; `RemessaService.ts:1153-1162` | Prova do estado observado, não de uma chamada específica que o produziu, nem da preservação de pagamentos já aceitos. |
| Excluir baixas / borderô | `ontology/business-rules/boleto-agrupado-sispag.md:86,108,112`; `CLAUDE.md`, gotcha ADR-0077 | Só limpeza antes de lote finalizado/arquivo; borderô antigo de rejeição não é limpo. Não usar como liberação automática. |
| Estornar ou cancelar borderô; cancelar retorno | Tela explorada cita Estornar/Cancelar (`sispag-fin015-exploration.md:83`); cleanup de retorno em `cleanup-fin015-testes.ts:55-76` | Nenhuma prova de que libere o item correto preservando baixa, retorno e histórico; cancelar retorno é outra entidade. I21m proíbe finalizar/cancelar borderô de grupo. |

Referências de client sem prefixo na tabela pertencem a
`src/backend/domain/client/ConexosSispagWriteClient.ts`.

Há evidência histórica de maturidades diferentes: `sispag-fin015-ida-provada-hml.md:118-120`
relata que cancelar lote só aceita finalizado e que rascunhos ficaram como resíduo;
`validate-retomada-remessa-v1.ts:465-467` diz que cancelamento não foi exercitado/provado naquele
roteiro e manda executar pela tela. Não converter a existência do endpoint ou uma mensagem de
sucesso em prova de liberação segura após rejeição.

## Risco de cancelar um lote misto

`RETORNADO` local pode conter um item rejeitado e outros pagos, agendados ou sem retorno.
Cancelar o lote inteiro pode retirar vínculos dos demais, modificar a conciliação ou deixar um
pagamento aceito disponível para duplicação. Mesmo rejeição integral local não prova que o banco
não recebeu outros eventos. Falta medir efeitos em `fin015`, `fin010`, `fin064`, `fin052` e arquivos.
Por isso o candidato cancelar-lote não serve como compensação genérica nem fallback silencioso.
Mudar `itsVldRej`/`itsVldExcluido`, estornar ou apagar o antigo sem contrato observado também não é solução.

## Próximo experimento HML proposto (ainda não executado)

1. **Descoberta sem escrita:** capturar pela tela/HAR o comando nativo suportado para liberar
   somente pagamento rejeitado; confirmar com responsável Conexos o efeito após retorno e em lote misto.
   Não inventar endpoint `liberar`, parâmetro ou uso de `estornar` a partir do nome do botão.
2. **Fixture isolada nova:** grupo com dois títulos HML novos e lote dedicado, sem pagamentos reais;
   gerar `.REM` pelo produto, processar rejeição sintética realmente `tpret=2`, registrar chaves completas
   (filial/banco/lote/item, `borCod+borTimCad`, retorno/arquivo e execuções locais). Não experimentar
   destrutivamente sobre 63/64 ou outros lotes compartilhados antes de inventariar seus vínculos.
3. **Snapshot antes:** releitura completa do lote antigo e de todos os seus itens, borderô por identidade,
   N baixas, N títulos no `fin064`, eventos `fin052`, arquivos e pendentes. Preservar dados saneados,
   contagens, estados e valores. Guardar controle independente fora do grupo.
4. **Uma operação por rodada:** preferir a operação seletiva capturada. Se ela for exatamente o DELETE
   existente, tratá-lo como teste de contrato novo no finalizado; não usar o wrapper como alegação de
   segurança. Resposta perdida/timeout exige releitura, nunca retry cego. Se não existir operação seletiva,
   avaliar `cancelarLote` somente numa fixture inteiramente rejeitada e isolada, como outra hipótese.
5. **Pós-condições antes de reenviar:** item antigo deixa de participar de lote ativo; borderô mantém
   identidade e exatamente N baixas/valores; títulos continuam abertos sem baixa paga; nenhum segundo
   borderô vivo, nenhum item de controle alterado; retorno e arquivo antigos preservados e auditáveis.
   Se contrato exigir excluir histórico, parar e discutir modelagem antes de automatizar.
6. **Reenvio:** inclusão manual do grupo num lote novo pelo produto, releitura de import, finalização e
   `.REM` com exatamente um J e valor correto. O sucesso exige finalização real, não apenas import.
   Repetir retomada após resposta perdida e garantir nenhum item/borderô/pagamento duplicado.
7. **Lote misto é outro gate:** somente após contrato seletivo funcionar, fixture específica com um item
   rejeitado e controle pago/agendado/sem retorno; comprovar que estados, vínculos e baixas do controle
   permanecem iguais e que ele nunca entra no novo arquivo. Sem essa prova, não habilitar para mistos.

**Aceite da opção 2:** operação documentada e suportada, prova HML de todas as pós-condições,
comportamento de timeout reconhecível, teste de lote misto e revisão da regra I21s/ledger/auditoria.
Falha em qualquer verificação mantém opção 1 e Alerta; não autoriza nova tentativa destrutiva.

**Rollback e resíduo:** não presumir rollback de cancelamento, estorno ou retorno processado.
Abortar antes da operação quando a leitura for incompleta; após ambiguidade, congelar a fixture e
registrar alerta/estado indeterminado. Só retirar item do **novo rascunho** mediante estado ao vivo
aberto, sem `.REM`, identidade atual e ausência observada; preservar o borderô antigo. Rascunho
vazio pode permanecer (resíduo conhecido). Após finalização/arquivo, preservar lote, borderô e
retorno; recuperação é decisão operacional documentada. Registrar no relatório final IDs, estados,
resíduos e quem fará eventual saneamento; não prometer voltar ao estado inicial.
