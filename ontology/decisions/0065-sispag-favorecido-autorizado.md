---
adr_number: 0065
title: SISPAG — favorecido autorizado substitui a conferência por lote e a exceção de destino
date: 2026-10-08
status: accepted
type: change
related_entities: [FavorecidoAutorizado, LotePagamento, AlertaItemLote, PerfilCanalFornecedor, Usuario, ExcecaoDestino, PendenciaCadastro]
related_actions: [solicitarAutorizacaoFavorecido, aprovarAutorizacaoFavorecido, rejeitarAutorizacaoFavorecido, revogarAutorizacaoFavorecido, verificarDestinoAutorizado, listarCandidatosAutorizacao, verificarItensTedPix, finalizarLote, reabrirLote, gerarRemessa, calcularPerfilCanal]
related_business_rules: [favorecido-autorizado-sispag, verificacao-ted-pix-sispag, destino-pagamento-sispag, excecao-destino-sispag]
related_state_machines: [favorecido-autorizado, lote-pagamento, excecao-destino]
related_integrations: [conexos]
supersedes_decisions: [0061]
amends_decisions: [0053, 0054, 0063]   # 0053: catálogo de permissões; 0054: D1 mantida, H3/H5 irrelevantes, I10i sai; 0063: I13i/k/l, L12/L13, PendenciaCadastro
evidence:
  - ontology/_inbox/sispag-favorecido-autorizado-interview.md (entrevista + respostas do usuário, 2026-10-08)
  - ontology/_inbox/sispag-favorecido-autorizado-ontology-diff.md (proposta aprovada em 2026-10-08)
---

# ADR 0065: favorecido autorizado substitui a conferência por lote e a exceção de destino

**Branch:** `fix/sispag-favorecido-autorizado`. `/feature-tweak`. `entity_changed = true`.

## Contexto

A Columbia rejeitou a conferência por segunda pessoa **por lote** (ADR-0063, I13l, L12/L13): custa
tempo da analista a cada lote e vai contra o objetivo de automatizar. Ao mesmo tempo, nenhuma regra
comparava o destino lido do `cmn025` com um valor aprovado antes: a troca de conta no cadastro
(vetor clássico de fraude) só era pega pela conferência humana. A exceção de destino (ADR-0061)
nunca foi usada (0 registros; flags TED/PIX desligadas em produção) e mantinha dado de pagamento
fora do Conexos.

## Decisão

1. **Nova entidade `FavorecidoAutorizado`** por (favorecido, modalidade): lista de quem pode receber
   por TED/PIX, amarrada por **fingerprint** (HMAC, segredo do tenant com versão) ao destino exato
   que o resolvedor escolhe na aprovação. Sem expiração; revogável com motivo; auditada.
2. **Duas pessoas sempre** (I14c): solicitante com `sispag:executar`, aprovador com
   `sispag:autorizar_favorecido`, aprovador ≠ solicitante no backend. A **reaprovação** aberta pelo
   sistema quando o destino muda exige o mesmo par: alguém confirma o pedido (F5) e outra pessoa
   aprova (F6). O sistema não conta como solicitante.
3. **Verificação em cada passo** (I14e): ao definir TED/PIX, só aviso no item; no `finalizarLote`,
   o item que falha **sai do lote** e o lote **finaliza na mesma chamada** com os restantes; em
   `gerarRemessa` (L8), **só enquanto não existe lote nativo no `fin015`**, barra o lote inteiro
   antes de qualquer escrita. Depois que existe lote nativo vale o congelamento (I10f). Falha
   fechada mantida.
4. **Destino só do `cmn025`.** A `ExcecaoDestino` é apagada por inteiro (entidade, I12, state
   machine, 6 actions, tabelas, trilha e triggers), e também a `lote_pagamento_item_destino_audit`
   (ADR-0054). A migração **recusa rodar** se `excecao_destino`, a trilha da exceção ou a
   `lote_pagamento_item_destino_audit` tiverem qualquer linha no banco de destino.
5. **Sai a conferência por lote:** I13l, L12 `conferirLote`, L13 `devolverLote`,
   `ConferenceRequiredError`, `SelfConferenceError`, `sispag:conferir` e os atributos de
   conferência/devolução.
6. **Sai a `PendenciaCadastro`** e `sispag:cadastro` (I13k). Falta de conta/chave no cadastro vira
   retirada auditada ("pedir ao responsável pelo cadastro do Conexos") e seção do relatório.
7. **Canal habitual sai do item** (I13i): `PerfilCanalFornecedor` só alimenta o relatório read-only
   `listarCandidatosAutorizacao`, que serve para validar a lista com a Columbia. O perfil não
   pré-preenche a lista.
8. **Duplicidade (I13c–h) inalterada**, resolvida só pela analista.
9. **Destino mascarado** (I14l): banco e agência completos, conta com os 4 últimos dígitos, PIX com
   tipo e trecho; selo "igual ao Conexos · igual ao aprovado" ou "diferente do aprovado"; botão
   "reconferir com o Conexos"; valor completo **só** pelo botão "revelar" (`sispag:autorizar_favorecido`),
   em qualquer tela, inclusive a de aprovação, auditado.
10. **Permissões:** `sispag:excecao` convertida em `sispag:autorizar_favorecido` (concessões
    migradas; `Administrador` recebe); `sispag:conferir` e `sispag:cadastro` removidas.
11. **Transição:** TED/PIX não é oferecido sem a guarda habilitada (I14k; flag de configuração).
    Liga-se só depois de a Columbia validar o relatório. Lotes `FINALIZADO` que aguardavam
    conferência não são marcados: passam pela guarda nova de L8.

## Lote vazio: diferença deliberada em relação à ADR-0064

Quando a verificação do `finalizarLote` retira **todos** os itens, o lote **fica `RASCUNHO`**
(`BatchEmptiedByCheckError`). Já um RASCUNHO esvaziado por `mover` (ADR-0064, L5) vai a `CANCELADO`.
Lá o esvaziamento é efeito colateral de outra ação da analista sobre outro lote; aqui é o sistema
retirando itens de um lote que a analista está fechando, e ela decide o que fazer com ele.

## Alternativas rejeitadas

- **Manter a conferência por lote:** custo recorrente por lote, rejeitado pelo cliente.
- **Reaprovação com um único aprovador:** o caso que a 2ª pessoa existe para pegar é justamente a
  troca de conta; um único aprovador re-liberaria sozinho.
- **Pinar o conjunto de todas as contas do favorecido:** qualquer conta nova invalidaria a autorização.
- **PIX só com chave CPF/CNPJ:** menos favorecidos elegíveis; a 2ª pessoa decide, com aviso.
- **Pré-preencher a lista pelo perfil de canal:** o perfil é estatística, não aprovação.
- **Retirar o item em L8:** L8 é a primeira escrita no ERP, com ledger e retomada (ADR-0039); mudar a
  composição do lote ali complica a marca d'água.

## Consequências

- H3/H5 (ADR-0054) deixam de importar: todo TED vai por `pctCodSeq`, todo PIX por chave do
  `cmnPessoasPix`. Saem `SISPAG_EXCECAO_DESTINO_ENABLED`/`SISPAG_DESTINO_MANUAL_ENABLED`,
  `ExcecaoDesabilitadaError`, a tela `/sispag/excecoes`, o alerta `SISPAG_EXCECAO_DIVERGENCIA`.
- Entra o `Alerta` operacional `SISPAG_DESTINO_ALTERADO` (dedup por favorecido + modalidade).
- Rotação do segredo do HMAC não é "destino mudou" (`fingerprintChaveId`).
- Favorecido autorizado cujo destino some do `cmn025`: item sai com `SEM_DADO_PAGAMENTO`, sem
  reaprovação.
- Ontologia à frente do código até a implementação desta branch.
- Universalidade de `FavorecidoAutorizado` vem de 1 cliente e de um controle padrão de tesouraria:
  revisar com o Francinei.
