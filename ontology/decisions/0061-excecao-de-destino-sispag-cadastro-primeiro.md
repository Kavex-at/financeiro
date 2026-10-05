---
adr_number: 0060
title: Cadastro do Conexos é a fonte principal do destino de pagamento SISPAG; destino fora do cadastro só como Exceção de destino aprovada por segunda pessoa
date: 2026-10-05
status: accepted
type: change
related_entities: [ExcecaoDestino, LotePagamento, Usuario]
related_actions: [registrarExcecaoDestino, aprovarExcecaoDestino, rejeitarExcecaoDestino, revogarExcecaoDestino, carregarExcecoesDestinoPlanilha, aposentarExcecoesSubstituidas, finalizarLote, gerarRemessa]
related_business_rules: [destino-pagamento-sispag, excecao-destino-sispag]
related_integrations: [conexos]
supersedes_decisions: []
superseded_parts_of: [0054]   # D2, D3 (ressalva "permissão específica pode vir depois"), D10, D11
amends_decisions: [0053]      # catálogo de permissões: sispag:aprovar_destino -> sispag:excecao
evidence:
  - ontology/_inbox/sispag-excecao-destino-diff-proposal.md (aprovado pelo Yuri em 2026-10-05, com as respostas abaixo)
  - entrevista do usuário (Columbia/Yuri), 2026-10-05 (respostas 1 a 6 + respostas ao diff)
  - ontology/decisions/0054-destino-de-pagamento-sispag-digitado-no-item.md (D1, adendos de 2026-09-28 e 2026-09-29)
---

# ADR 0060: cadastro primeiro; exceção de destino aprovada por segunda pessoa como fallback

**Branch:** `worktree-sispag-ted-pix-conexos-fonte-excecao` (continuação de `sispag-ted-pix`).
`entity_changed = true`.

## Contexto

A ADR-0054 deixou a analista digitar o destino no item, com precedência sobre o cadastro (D2),
confirmação pela própria pessoa para conta (D10) e sem aprovação para chave PIX CPF/CNPJ (D11). O
risco foi reconhecido na época: trocar o destino de um pagamento é o vetor clássico de fraude. Em
2026-10-05 o usuário reavaliou: o cadastro do Conexos é a fonte principal por segurança/fraude, e
quem digita não pode, sozinho, mover dinheiro para um destino novo.

## Decisão

1. **Cadastro (`cmn025`: conta do favorecido e chaves PIX) é a fonte principal.** Nunca escrevemos
   no `cmn025` (D1 da 0054 mantida). Cadastro ausente ou errado é problema operacional da Columbia,
   a corrigir no Conexos; a exceção é ponte, não substituto.
2. **Cadastro primeiro, exceção aprovada só como fallback**, quando o cadastro não tem destino
   válido para a modalidade. Substitui D2 (o digitado deixa de vencer o cadastro).
3. **Entidade `ExcecaoDestino`**, por favorecido (`pesCod`), reutilizável em qualquer lote, não por
   item. Estados `PENDENTE → APROVADA → {SUBSTITUIDA, REVOGADA}` e `PENDENTE → REJEITADA`. A
   analista não digita dado de pagamento no item; cadastra-se uma exceção.
4. **Uma única permissão, `sispag:excecao`**, cobre cadastrar, aprovar, rejeitar e revogar. A
   separação de funções vem **só da regra de backend `aprovadoPor ≠ cadastradoPor`** (comparada pelo
   id do usuário autenticado). Vale para **TED e PIX**. Substitui D10 (autoaprovação), D11 (PIX sem
   aprovação) e a permissão `sispag:aprovar_destino` da 0068 (a migration deve converter as
   concessões existentes; ver Consequências).
5. **PIX só com chave CPF/CNPJ**, e a chave tem de ser igual ao `pdcDocFederal` do favorecido
   (I10i mantida). E-mail, telefone e chave aleatória ficam **fora de escopo**.
6. **Ciclo de vida:** a exceção aprovada **não expira**. Vive até ser **revogada** (por qualquer
   pessoa com `sispag:excecao`, inclusive quem cadastrou) ou **substituída** pelo cadastro.
7. **Conflito:** se o cadastro passa a ter destino válido, a exceção vai a `SUBSTITUIDA` e nunca é
   usada; se o valor do cadastro difere do da exceção, grava-se evento `DIVERGENCIA_CADASTRO` na
   trilha (valores mascarados). Divergência é evento, não entidade.
8. **Carga por planilha** (a Columbia mantém uma): cria só `PENDENTE`; carga e recarga nunca
   aprovam. O layout da planilha **não foi visto** e não foi inventado (gap Q1).
9. **Mantidos:** trilha só-inclusão (mesmo padrão e trigger de `lote_pagamento_item_destino_audit`),
   máscara (`MaskDestino`), validação de formato (`DestinoManualValidator`), congelamento no import
   (I10f), flags desligadas por padrão.
10. **O fluxo por item (`destinoManual`, aprovação por item) é retirado** e refatorado para este
    modelo.

## Superseção parcial da ADR-0054

D2, D10 e D11 deixam de valer; em D3, a ressalva "uma permissão específica pode vir depois" é
cumprida de outra forma (`sispag:excecao`). D1, D4–D9 e as ressalvas I10g/h/i seguem.

## Alternativas consideradas

| Alternativa | Por que não |
|---|---|
| Manter o digitado por item e só exigir segunda pessoa | Continua digitando dado de pagamento na ponta; sem reuso; cadastro deixa de ser a fonte principal |
| Gravar no `cmn025` (opção A da 0054) | Escrita em cadastro mestre; usuário reafirmou que não |
| Exceção por item | Obriga recadastrar a cada lote; contraria "por favorecido, reutilizável" |
| Exceção com precedência sobre o cadastro | Reabre o vetor de fraude que motivou a revisão |
| Duas permissões (cadastrar × aprovar) | Usuário escolheu uma só; a dupla validação é regra de backend, não de papel |
| Exceção com validade | Usuário: sem expiração; vive até revogada ou substituída |

## Consequências

- Nova entidade, máquina de estados, regra de negócio, 6 ações, migration nova (0075, reconfirmar
  contra `origin/main`) e a permissão `sispag:excecao`.
- **Migração de permissões:** a migration troca o `CHECK` das duas tabelas de permissão
  (padrão da 0068) e **converte as concessões de `sispag:aprovar_destino` em `sispag:excecao`**
  (papel e exceções por usuário, inclusive "revogar vence"), sem deixar concessão órfã.
- Como a permissão única hoje só está no papel `Administrador`, a dupla validação exige **duas
  pessoas com `sispag:excecao`**; com um só titular, nada se aprova. Quem concede a permissão ao
  `Analista` (0074: sispag só leitura) é decisão operacional da Columbia, fora desta ADR.
- Tela: sai o diálogo "Informar destino" por item; entra tela de Exceções (cadastrar, aprovar,
  rejeitar, revogar, carregar planilha). No lote a analista só vê a origem do destino.
- Migração de dados: contar `destino_manual` antes de decidir (gap Q4, tarefa de implementação).
- H3/H5 do HML continuam sem prova; as flags seguem desligadas até o teste supervisionado.
- Risco residual: cadastrante e aprovador conluiados; o DICT não é consultado. Limite de valor por
  exceção e observação do retorno do banco ficam na watchlist.

## Questões abertas (não decididas)

Q1, Q3, Q4, Q6, Q8, Q9, Q10, Q11: ver `ontology/_inbox/sispag-excecao-gap.md`.
