# Boleto agrupado: reenvio após rejeição — duas frentes

Data: 2026-10-27. Decisão do Yuri nesta sessão: registrar as duas opções e trabalhá-las em paralelo;
a detecção deve estar corrigida **antes do merge da PR #131**; a liberação automática é investigação.

## Evidência e desenho aprovado

A terceira rodada V7, títulos 851/1 e 852/1, passou 5/6 verificações. A correção de conclusão da execução
funcionou: o borderô 259 foi reaproveitado do lote nativo 63 no 64. O Conexos aceitou a importação, mas
recusou finalizar o lote 64 porque o item permanece no lote 63. Aparecer em `borderosPendentes` do lote
novo **não prova** a liberação. O retorno de rejeição e o estado local `RETORNADO` também não a provam.

**Opção 1, executar agora:** consultar ao vivo o lote/item antigo antes de adotar/importar o borderô.
Se o item continua associado, ou não é possível comprovar sua liberação, retirar o grupo inteiro com
`BORDERO_ANTERIOR_NAO_RESOLVIDO` e emitir `sispag-bordero-grupo-pendente`, identificando filial, lote
antigo, borderô e a necessidade de resolução pela analista no Conexos. Não alterar o lote antigo nem
suas baixas/borderô. Seguir com os demais itens pela retirada existente; lote só com o grupo usa o
desfecho de lote esvaziado já existente. A retomada de uma execução reaproveitada também passa pela
guarda antes de continuar, inclusive se o rascunho atual já está completo ou só faltam avulsos. Quando
o item já foi importado no novo rascunho, a retirada remove somente esse item e comprova sua ausência; mantém o
borderô antigo e sua pendência para a analista, sem impedir os pagamentos saudáveis de continuar.
Ausência só vale com leitura completa, identidade e chaves reconhecidas.

**Opção 2, explorar:** procurar operação suportada para liberar o item rejeitado no lote antigo, com
prova da semântica e da não interferência nos demais itens. Não habilitar cancelamento de lote ou
liberação automática por inferência. A investigação local é paralela à opção 1, registrada em
`sispag-boleto-agrupado-reenvio-rejeitado-exploracao.md`. Um experimento de escrita em HML será separado,
com escopo, resultados esperados e resíduos explícitos. Nenhuma chamada ao ERP integra esta execução.

## Plano de implementação e validação

- [x] Localizar a falha real e os contratos existentes (`BorderoGrupoBoletoService`, `lerItemDeBordero`).
- [x] Registrar ambas as opções e a prioridade de merge; emendar I21s/ADR-0077 e a tabela de retomada.
- [x] Escrever regressão que mantenha o item no lote antigo, embora o borderô apareça pendente no novo;
  observar RED antes de implementar a guarda.
- [x] Em `BorderoGrupoBoletoService`, impedir adoção/importação quando o vínculo antigo persiste ou
  não é verificável; proteger também a retomada; manter o caminho permitido após ausência comprovada.
- [x] Cobrir alerta acionável, preservação do antigo, ausência de segundo borderô e falhas de leitura.
- [x] Executar testes focados e os gates backend: `npm run typecheck`, `npm run lint`, `npm test`.
- [x] Revisar o diff com agente independente e corrigir achados que comprometam o contrato.
- [x] Registrar resultados e a pendência de prova HML da guarda; não marcar a V7 como aprovada por
  testes locais nem liberar o merge sem a prova ponta a ponta exigida pela Task 21.

## Critérios de aceite antes do merge

1. Nenhuma importação do borderô no lote novo quando seu item segue no lote antigo.
2. Grupo inteiro retirado e alerta operacional com identificação do conflito; nenhum erro genérico
   de finalização usado como mecanismo de detecção.
3. Lote/borderô antigos preservados; nenhum segundo borderô criado para contornar o vínculo.
4. Falha/ambiguidade de leitura não autoriza reaproveitamento, inclusive na retomada.
5. Ausência comprovada permite o reaproveitamento, sujeito às conferências já existentes.
6. Regressões e gates locais verdes; prova HML deve demonstrar o caminho `RETIRADO` enquanto o item
   permanece vinculado. Liberação automática não é requisito desta correção.

Esta tarefa não faz commit, push, merge ou alteração em HML/PRD. O working tree já continha a correção
anterior da execução do borderô; ela deve ser preservada e validada junto com a nova guarda.


## Resultados locais — 2026-10-27

- Regressões RED observadas antes da guarda e das correções de retomada/limpeza.
- Revisão independente identificou e corrigiu três casos: rascunho completo pulava preparação;
  rascunho misto com avulso faltante também pulava; limpeza de reaproveitamento impedia continuar os
  itens saudáveis embora o item atual já tivesse saído. Testes incluem a composição real dos serviços
  de borderô e retirada, preservando o item antigo e suas três baixas.
- Todas as retomadas de lote aberto com grupos passam pela preparação; só os avulsos faltantes são
  importados. Limpeza do reaproveitamento mantém ledger/alerta do antigo pendente e comunica ausência
  do item no rascunho atual, sem declarar o borderô antigo excluído.
- `npm run typecheck`: exit 0. `npm run lint`: exit 0, 124 avisos, sem erros (mesma contagem de baseline).
- `npm test -- --runInBand`: **305 suítes / 5979 testes aprovados**, 89,147 s. `git diff --check`: exit 0.
- Alertas de rejeição não prescrevem mais cancelamento/exclusão genéricos; identificam lote antigo,
  vínculo no `fin015` e borderô `fin010`, para regularização com a analista/responsável pelo ERP.
- **Pendente antes do merge:** nova prova HML da guarda (Task 21). Nenhuma execução HML nesta sessão.
- Exploração concluída em arquivo próprio: não há contrato comprovado de liberação seletiva pós-retorno;
  há roteiro de experimento HML isolado. A opção 2 continua investigação, sem automação habilitada.

Revisão final em `docs/regis-review/2026-10-27-1546/REPORT.md` e `KANBAN.md`: oito atributos,
sem P0; um P1 operacional (prova HML) e um P2 de boundary legado. Nenhum novo defeito material
remanescente identificado na correção após reavaliação das retomadas e da limpeza.


## Complemento local — controle com boleto sintético

Preparado `CONTROL_DOC=doc/tit` para a V7: título avulso fora de `DOCS`, semeado no banco local com
boleto sintético próprio e confirmado por `BoletoSuggestionService`. Modalidade BOLETO explícita e
vínculo por título `FIL:on` só neste cenário; entra apenas no segundo lote, após a rejeição do grupo.
Não é necessário criar boleto/DDA bancário real. Fixture sugerida: AR SOLUÇÕES (`pesCod 121`), filial 2,
R$ 50,00, vencimento futuro igual ao do par; finalizado, aprovado, não pago e fora de lote.

A prova verifica item antigo presente antes do retry; snapshots exatos por SHA256 preservados;
retirada do novo ledger sem adoção/importação; grupo fora do lote local/nativo/arquivo; exatamente o J
do controle com barra/valor corretos; alerta novo da guarda com contexto do vínculo antigo. Contexto
inconclusivo interrompe antes do segundo lote. Não confundir máscaras de barras com identidade.

Validação local após esta extensão: **75 testes do probe aprovados**, typecheck exit 0, Biome limpo nos
três arquivos e `git diff --check` exit 0. Revisão independente identificou e corrigiu ausência de
modalidade do controle e colisão de máscaras; sem bloqueador concreto remanescente no diff revisado.
Nenhuma chamada HML executada; IDs dos três títulos e autorização de escrita ainda necessários.
