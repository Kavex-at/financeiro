# Notas de contrato: situação de pagamento (PR B, frontend)

O frontend foi feito contra o contrato do commit `958aa01` (`SituacaoPagamento.ts` e o espelho em
`lib/sispag.ts`) sem alterar a forma dele. O que o backend precisa saber:

## Lacunas do contrato

1. **`mover` (ADR-0064) no `POST /sispag/lotes/por-filial`.** O corpo é só `{ titulos: ChaveTitulo[] }`.
   O fluxo antigo deixava selecionar um título que já estava em lote RASCUNHO e o movia para o lote
   novo. Sem um campo equivalente, o servidor recusaria esse título. Por isso, na aba nova, título
   em rascunho **não é selecionável** (a linha explica e oferece "Retirar do lote"). Se o backend
   aceitar, por exemplo, `titulos: Array<ChaveTitulo & { mover?: boolean }>`, o frontend volta a
   permitir a seleção (é uma troca em `situacao/selecao.ts`, `selecionavel`).
2. **`resumoSituacao` x títulos em lote comprometido.** Os cards "Prontos" e "Precisam de ação" usam
   `resumoSituacao` (carteira inteira). O filtro externo e os chips usam a lista da tela, que por
   padrão **esconde** os títulos em lote finalizado/remessa gerada. Se o resumo contar esses títulos
   como PRONTO, o card pode mostrar mais prontos do que a tabela. Sugestão: o resumo não contar
   título com lote comprometido (ou devolver essa contagem à parte).
3. **Aviso de situação incompleta.** O frontend mostra um aviso quando `fontesIndisponiveis` não está
   vazio. Se o backend preferir sinalizar por título, precisa de um campo novo; hoje o aviso vale
   para a carteira inteira.

## O que o frontend assume do backend

- `situacaoPagamento.estado`, `principal`, `rotulo`, `dono`, `acao.{codigo,rotulo}` e `detalhe` vêm
  preenchidos para todo BLOQUEADO. `acao` ausente em bloqueado: a linha mostra só "resolve: <dono>".
- `diasAteVencimento` é por **dia civil** (ADR-0070): `0` = vence hoje. A faixa vermelha, os
  presets de vencimento e o card "Vencem em até 2 dias" dependem disso.
- `POST /sispag/lotes/por-filial` responde `{ lotes: LoteCriadoPorFilial[] }`; erro de domínio no
  recorte do título vai em `recusados[]` (com `motivo` quando a recusa foi por situação) e **não**
  como HTTP 4xx. Falha geral (4xx/5xx) mostra a mensagem do corpo (`error`).
- Título já em lote RASCUNHO continua trazendo `loteRascunho`/`loteComprometido` no painel.
- A ação `TENTAR_AJUSTE` chama `POST .../ajustes-centavos/tentar-novamente` (já existente);
  `DESFAZER_RETENCAO` e `TRATAR_DUPLICIDADE` chamam
  `POST /sispag/titulos/:fil/:doc/:tit/bloqueio-duplicidade/desfazer` (já existente, com motivo).
  Se o backend criar um fluxo próprio para tratar duplicidade no título, é só trocar em
  `situacao/AcaoDoTitulo.tsx`.

## Compatibilidade

- Sem `resumoSituacao` no painel (backend antigo), a página renderiza a aba e os KPIs de antes.
  `titulo.situacaoPagamento` ausente em algum título não quebra nada (conta só em "Todos").
- Os KPIs de topo da página (A vencer 7d/30d, Vencidos, Lotes candidatos) saem **apenas** quando o
  backend manda `resumoSituacao`: os 4 cards da aba substituem esses números.
