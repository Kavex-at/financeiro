---
adr_number: 0063
title: SISPAG — verificações TED/PIX, duplicidade e conferência por segunda pessoa
date: 2026-10-05
status: accepted
type: addition
related_entities: [LotePagamento, TituloAPagar, AlertaItemLote, BloqueioDuplicidade, PendenciaCadastro, PerfilCanalFornecedor, ExcecaoDestino, Usuario]
related_actions: [verificarItensTedPix, resolverAlertaDuplicidade, conferirLote, devolverLote, calcularPerfilCanal, finalizarLote, reabrirLote, gerarRemessa, gerenciarLoteCandidato, formarLotesAutomaticos]
related_business_rules: [verificacao-ted-pix-sispag, destino-pagamento-sispag, excecao-destino-sispag]
related_state_machines: [lote-pagamento]
related_integrations: [conexos]
supersedes_decisions: []
amends_decisions: [0053, 0054, 0061]   # 0053: catálogo de permissões (+2); 0054/0061: I10a no finalizar passa a remover o item em vez de só barrar
evidence:
  - docs/bpmn/sispag-pagamento-proposto.bpmn (commits e7ef4ef..2bdb5b5)
  - src/backend/jobs/probe-duplicidade-titulos.ts (fin064 PRD; caso canônico fil 4, docs 6173 × 6702)
  - src/backend/jobs/probe-canal-por-fornecedor.ts (fin010 × fin095 PRD; 89% do valor pago em fornecedores de confiança ALTA; sinal A do fin064 = 0% de forma de pagamento)
  - entrevista do usuário (Columbia/Yuri, product owner), 2026-10-05 — regras A–E
---

# ADR 0063: verificações TED/PIX, duplicidade e conferência por segunda pessoa

**Branch:** `fix/sispag-verificacoes-ted-pix`. `/feature-tweak LotePagamento`. `entity_changed = true`.
**Fora de escopo:** envio/retorno automático via Nexxera mostrado no BPMN proposto (vira
`/feature-new` próprio).

## Contexto

O BPMN proposto do SISPAG (`docs/bpmn/sispag-pagamento-proposto.bpmn`) põe três controles entre a
montagem do lote e a remessa, todos só para **TED e PIX** (boleto o banco valida pelo código de
barras, e o código só é confirmado na remessa, ADR-0040):

1. **Verificar os títulos TED/PIX** (falta de dado de pagamento, duplicidade, canal incomum).
2. **Tratar alerta de duplicidade** (justificar ou retirar e pedir cancelamento no Conexos).
3. **Conferência por segunda pessoa** antes de gerar a remessa, quando o lote tem TED/PIX.

Medições que sustentam o desenho:

- **A forma de pagamento não vem do ERP.** O `fin064` não traz forma de pagamento nem código de
  barras (probe de canal, sinal A = 0%). Logo a verificação **não pode** rodar na ingestão das 07h:
  só depois que a analista escolhe TED/PIX no item.
- **Duplicidade real existe.** fil 4, documentos 6173 e 6702: mesmo favorecido, mesma NF, dois
  `docCod` (PRD). A ingestão identifica título por `(filCod, docCod, titCod)`; NF lançada duas vezes
  vira dois títulos elegíveis, e nada no fluxo atual o percebe. O histórico do `fin064` começa em
  2026-01 em 6 das 7 filiais.
- **O canal habitual é estável na maior parte do dinheiro.** Casando baixa (`fin010`) com débito do
  extrato (`fin095`), só casamentos únicos: 89% do valor pago está em fornecedores com confiança
  ALTA (≥5 pagamentos, ≥3 meses, ≥95% num grupo de canal).

## Decisão

### A. Verificação TED/PIX (I13a, I13b)

- Roda **depois** que a analista define `modalidade ∈ {TED, PIX}` no item (`atualizarModalidadeItem`)
  e **de novo** no `finalizarLote` (L3). Nunca na ingestão.
- `BOLETO` e item sem modalidade **nunca** são verificados.
- Leitura do Conexos que falha deixa o item em **verificação pendente**; o `finalizarLote` re-roda e,
  se ainda não verificável, **barra** (falha fechada).

### B. Duplicidade (I13c–I13g)

- **FORTE:** mesmo favorecido (`pesCod`) + mesmo número de NF normalizado (`docEspNumero`, só
  dígitos, sem zeros à esquerda), `docCod` diferente, qualquer tipo de documento, **inclusive
  títulos já pagos**. Fonte: `fin064` ao vivo.
- **FRACA:** mesmo favorecido + mesmo valor (centavos) + vencimento a ±15 dias, `docCod` diferente.
- Parcelas do mesmo `docCod` **nunca** são duplicidade.
- As duas **bloqueiam** o `finalizarLote` até cada alerta ser resolvida pela analista:
  **JUSTIFICAR** (texto obrigatório, quem/quando; item fica) ou **RETIRAR** (item sai do lote e o
  título recebe um **bloqueio por duplicidade** local: "cancelamento pendente no Conexos").
- O título bloqueado fica fora da formação automática e da inclusão manual até sumir do `fin064`
  (inativo/cancelado) ou a analista desfazer o bloqueio (auditado). **Nenhuma escrita no ERP.**
- A justificativa sobrevive à re-verificação se a contraparte for a mesma; contraparte nova abre
  alerta nova, não resolvida.

### C. Canal habitual (I13h)

- Alerta **não bloqueante**, exibido na conferência, quando um item TED/PIX vai a um favorecido cujo
  canal histórico é predominantemente outro grupo (`BOLETO` ou `OUTROS`; TED e PIX são um grupo só,
  `TED_PIX`).
- Só para favorecido com perfil de confiança **ALTA**. Sem perfil, ou perfil não ALTA, não há alerta.
- O perfil é **pré-calculado e persistido** por favorecido (`PerfilCanalFornecedor`) por um job
  periódico read-only no ERP.
- Os limiares (5 pagamentos, 3 meses, 95%) são **ponto de partida** e ficam em **configuração do
  cliente**, não na ontologia (Filtro B).

### D. Dados de pagamento (I13i, I13j)

- TED sem conta / PIX sem chave no cadastro `cmn025` **e** sem `ExcecaoDestino` `APROVADA` → o item
  **sai do lote** (remoção pelo sistema, auditada, ator `sistema`) e abre-se uma
  **`PendenciaCadastro`**.
- Com `ExcecaoDestino` `APROVADA` (ADR-0061, inalterada) → o item **fica** (o destino resolve pela
  exceção), mas a `PendenciaCadastro` é aberta do mesmo jeito, para o cadastro ser corrigido no
  Conexos.
- `PendenciaCadastro`: por favorecido + tipo (`CONTA` \| `CHAVE_PIX`), com o título de origem;
  `ABERTA → RESOLVIDA` **automaticamente** quando o cadastro passa a ter o dado (reconferido ao
  atualizar a tela e na próxima verificação). Fila "Pendências de cadastro" para quem tem a nova
  permissão **`sispag:cadastro`**. Sem e-mail.
- A analista continua sem digitar dado de conta no lote; a `ExcecaoDestino` segue o único caminho
  fora do cadastro.

### E. Conferência por segunda pessoa (I13k; L12, L13)

- Lote `FINALIZADO` com ≥1 item TED ou PIX **exige conferência** antes do `gerarRemessa` (L8). Lote
  só de boleto não exige.
- Nova permissão **`sispag:conferir`**. Sem status novo: a conferência é registrada no lote
  (`conferidoPor`, `conferidoEm`).
- **L12 `conferirLote`** (`FINALIZADO → FINALIZADO`): o conferente tem `sispag:conferir` e **não**
  é `finalizadoPor`, nem `incluidoPor` de nenhum item, nem `criadoPor` de lote manual. Comparação
  pela identidade do usuário autenticado, no backend (espelho de I12b).
- **L13 `devolverLote`** (`FINALIZADO → RASCUNHO`): o conferente devolve com motivo obrigatório;
  limpa a conferência.
- `reabrirLote` (L4) também limpa a conferência.
- **L8** ganha a guarda `exigeConferencia ⇒ conferido` (`ConferenceRequiredError`).
- O conferente vê, por item TED/PIX: favorecido, conta/chave (mascarada, I10h), valor, alertas de
  duplicidade com a justificativa e alertas de canal.

## Análise de curadoria (Filtros A–E)

| Candidato | Resultado | Decisão |
|---|---|---|
| Verificação TED/PIX como regra (I13) | A: Y (controle de pagamento universal), C: Y, D: estende I10 sem duplicar | ACCEPT |
| `AlertaItemLote` (duplicidade/canal, resolução) | A: Y (alerta de duplicidade é controle clássico de contas a pagar), E: entidade com ciclo (aberta → resolvida) | ACCEPT |
| `BloqueioDuplicidade` | A: Y; D: **não** é a retenção retirada da ADR-0050 (lá: motivo operacional, título voltar ao cron era aceito; aqui: o título é dívida possivelmente paga duas vezes) | ACCEPT |
| `PendenciaCadastro` | A: Y (cadastro mestre incompleto tratado por outra área); E: entidade com ciclo próprio, não estado do item | ACCEPT |
| `PerfilCanalFornecedor` | A: Y em conceito (canal habitual do fornecedor), 1 cliente medido; B: estrutura na ontologia, limiares em config | ACCEPT, com limiares REJECT-CONFIG |
| Limiares 5 / 3 / 95% / ±15 dias | Valores de um cliente | REJECT-CONFIG (configuração do tenant; defaults documentados) |
| Status novo `CONFERIDO` no lote | E: é atributo do `FINALIZADO`, não estado; um status novo duplicaria L4/L5/L8 | REJECT-DUPLICATE (propriedades `conferidoPor/Em`) |
| Alerta por e-mail ao responsável pelo cadastro | Usuário decidiu fila in-app | REJECT-PREMATURE → watchlist |
| Envio/retorno automático via Nexxera | Fora deste tweak | Fora de escopo (feature própria) |
| Verificação na ingestão das 07h | `fin064` sem forma de pagamento (0%) | REJECT (não observável) |

## Alternativas consideradas

| Alternativa | Por que não |
|---|---|
| Verificar todos os títulos na ingestão | O ERP não diz a forma de pagamento; verificaríamos boletos à toa e erraríamos o canal |
| Duplicidade só com títulos em aberto | O caso perigoso é justamente pagar de novo o que já foi pago |
| Retirar a duplicata e escrever o cancelamento no Conexos | Escrita de documento no ERP fora de escopo; o cancelamento é ato humano no Conexos |
| Canal habitual bloqueante | Falso positivo trava pagamento legítimo; é sinal para o conferente, não regra |
| Calcular o canal ao vivo a cada verificação | `fin010 × fin095` é varredura cara (páginas de borderô por filial); o perfil muda devagar |
| Item sem dado de pagamento só barra a finalização (I10a como estava) | O lote ficaria preso por um problema de outra área; tirar o item e abrir pendência destrava o resto |
| Conferência como status `CONFERIDO` | Ver tabela acima |
| Conferente = qualquer pessoa diferente do finalizador | Quem incluiu o item ou montou o lote manual também é parte interessada |

## Consequências

- **Permissões novas** no catálogo da ADR-0053: `sispag:conferir` e `sispag:cadastro`, avulsas
  (não implicam nem são implicadas por `sispag:ver`/`sispag:executar`), padrão da 0068/0075
  (migration troca o `CHECK` das duas tabelas de permissão). Concessão default: gap Q8.
- **Conferência exige duas pessoas habilitadas.** Com um só titular de `sispag:conferir` que também
  finaliza, nenhum lote TED/PIX chega à remessa. É o efeito desejado, e é decisão operacional da
  Columbia conceder a permissão.
- **I10a muda de forma no `finalizarLote`:** item TED/PIX sem destino resolvível deixa de só barrar;
  sai do lote e abre pendência (I13i). No envio (`gerarRemessa`) I10a continua barrando como antes.
  A interação com I10b ("oferta = envio") está aberta (gap Q1, P0).
- **Novas tabelas** (nomes propostos): `lote_pagamento_item_alerta`, `sispag_bloqueio_duplicidade`,
  `sispag_pendencia_cadastro`, `sispag_perfil_canal_fornecedor`; colunas novas em `lote_pagamento`
  (`conferido_por`, `conferido_em`, `devolvido_por`, `devolvido_em`, `motivo_devolucao`) e em
  `lote_pagamento_item` (`verificacao_estado`, `verificado_em`).
- **Novo job** `calcular-perfil-canal` (read-only no ERP, escrita local, `JobRun` como os demais).
- Não há escrita nova no Conexos em nenhum dos cinco blocos.
- A ADR-0061 tem `adr_number: 0060` no frontmatter (drift do renumeramento `8daee5b`); não corrigido
  aqui.

## Questões abertas

Ver `ontology/_inbox/sispag-verificacoes-ted-pix-gap.md` (Q1 é P0).
