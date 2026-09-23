---
adr_number: 0050
title: "SISPAG: retirar um título do lote pela aba de títulos, sem retê-lo da formação automática"
date: 2026-09-22
status: accepted
type: amendment
related_entities: [TituloAPagar, LotePagamento]
related_actions: [gerenciarLoteCandidato, montarPainelPagamentos]
related_business_rules: [nao-duplicacao-titulo-lote]
related_state_machines: [lote-pagamento]
evidence:
  - "Pedido da analista via usuário (2026-09-22): tirar um título do lote automático exige abrir o lote e achar o título"
  - "Decisão do usuário (2026-09-23): o problema é de UX; o cron é espaçado e o título voltar a um lote automático depois não é problema"
supersedes_decisions: []
amends_decisions: []
---

# ADR 0050: retirar o título do lote pela aba de títulos

> **Status `accepted`.** Aceita em 2026-09-22 com uma retenção da formação automática; **simplificada
> em 2026-09-23** pelo usuário antes do merge (ver "Retenção: proposta e retirada"). O arquivo mantém
> o nome original.

**Cliente:** Columbia Trading · **Entrega:** Kavex · **Frente:** II (SISPAG)
**Branch:** `fix/sispag-reter-titulo-lote` · **Feature:** `/feature-tweak` `sispag-reter-titulo-lote`
**Relacionado:** ADR-0015 (I3), ADR-0018 (formação automática).

## Contexto

A analista trabalha quase sempre com os lotes automáticos (ADR-0018). Quando quer tirar um título de
um lote, para pô-lo em outro ou só removê-lo, precisa ir à aba "Lotes candidatos", achar o lote e
achar o título dentro dele. A aba "Títulos a pagar" só dizia que o título estava "em lote", sem dizer
em qual. O problema é de UX: a remoção (`removerTituloDoLote`) já existe e está certa.

## Decisões

### D1: a linha do título mostra o lote em que ele está

O painel projeta, para cada título num lote RASCUNHO, `loteRascunho { id, automatico }`. A linha
mostra "Lote automático" / "Lote manual" como link: abre a aba "Lotes candidatos" na página do lote,
rola até o card, abre-o e o destaca. É projeção da relação `ItemLote` que já existe, não conceito novo.

### D2: "Retirar do lote" na linha do título

A linha de um título em lote RASCUNHO tem "Retirar do lote", com confirmação. A ação é
`removerTituloDoLote` sem precisar abrir o lote: o serviço acha o lote RASCUNHO do título e aplica a
mesma remoção da lixeira (só RASCUNHO, `marcarManual` se o lote era automático). Título que já não
está em lote RASCUNHO → 409 `TituloForaDeLoteError`. Admin, autor do JWT, nenhuma escrita no ERP (I1).

O título fica solto e pode ser incluído em outro lote logo em seguida.

## Retenção: proposta e retirada

A versão aceita em 2026-09-22 gravava, ao retirar, uma retenção "não lotar automaticamente" (tabela
própria, invariante nova na formação automática, badge e "Liberar" na linha), porque o título solto
volta a ser elegível e o cron seguinte pode lotá-lo de novo.

Em 2026-09-23, antes do merge, o usuário retirou a retenção: o cron de formação é espaçado, e o título
voltar a um lote automático depois de um tempo não é problema. A retenção resolvia um problema que a
operação não tem, ao custo de uma tabela, uma regra e duas ações a mais. Revisitar só se a analista
relatar título que ela tirou voltando a lote automático antes de ela decidir o que fazer com ele
(ver `_inbox/_watchlist.md`).

## Consequências

- Tirar um título de um lote passa a ser um clique na aba de títulos.
- Retirar de um lote automático continua convertendo o lote em manual (`marcarManual`), como a lixeira.
- Nenhuma entidade, propriedade, regra ou migration nova.
