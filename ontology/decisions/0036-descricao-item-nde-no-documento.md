---
adr_number: 0036
title: A Descrição para Impressão do item da NDe é escrita NO DOCUMENTO (com297 comDocProdutos, RMW) quando o ERP a deixa vazia — nunca no cadastro do cliente (cmn025 dpeVld1DescrNfe), cujo valor "Descrição DI" é legítimo para a NF-e de mercadoria
date: 2026-08-11
status: accepted
type: change
related_entities: [NotaDebitoEletronica]
related_actions: [executarRecebimento]
related_integrations: [conexos-nde-fiscal]
supersedes_decisions: []
amends_decisions: [0022, 0024]
---

# ADR 0036: descrição do item da NDe é conserto de documento, não de cadastro

**Cliente:** Columbia Trading · **Entrega:** Kavex (created by Clonex) · **Fonte:** homologações
recusadas em campo (relato do Yuri, 2026-08-11) + contrato do tenant (`docs/conexos-api/020-cmn0.json`,
`060-com2.json`). **`entity_changed = false`** — nenhuma entidade, relação ou máquina de estado muda; o
que entra é uma regra de negócio nova (`descricao-item-nde`, I-Receb-5) sobre a cauda fiscal existente.

## Contexto

A homologação da NDe passou a ser recusada para **alguns** clientes. O padrão: os clientes cujo
cadastro tem **"1ª Descrição dos Produtos" = Descrição da DI** (rótulo do tenant: "DI + DUIMP"). Trocar
o campo para "Descrição do Produto" no cadastro faz a nota homologar — foi como o problema foi isolado
manualmente.

Mecanismo, fechado contra o contrato do ERP:

- O campo é `cmn025` → `CmnDadosPessoas.dpeVld1DescrNfe` (enum `0..6`; `4` = Descrição DI).
- Ele governa `ComDocProdutosFisFin.dprLngDescrNf` — *"Descrição para Impressão"*, `maxLength 4000` —
  que é o `xProd` da NF-e.
- A linha de produto da NDe é materializada **pelo ERP** a partir do `prdCod` do header do
  `gerDocProcesso` (a automação nunca a escreveu: HAR 23-27 não faz `POST com297/comDocProdutos`).
- Com a regra em "Descrição DI" e um produto de **encargo** (`41978` PAGAMENTO ANTECIPADO, que não tem
  adição de DI), a derivação não tem de onde tirar texto → campo vazio → NF-e sem descrição de produto.

A automação **nunca tocou** `dprLngDescrNf`: estava inteiramente à mercê de dado-mestre por-cliente.

## Decisão

**Garantir a descrição no DOCUMENTO, antes da leg fiscal.** Entre a geração da NDe e o `com300`, ler os
itens (`POST com297/comDocProdutos/list/{docCod}/{fisCod}`); se `dprLngDescrNf` estiver vazia, ler a
linha inteira (`GET com297/comDocProdutos/{docCod}/{fisCod}/{prdCod}/{dprCodSeq}`), substituir o campo e
regravar por **read-modify-write** (`PUT com297/comDocProdutos`, objeto inteiro, `putGenericOnce`) —
mesma doutrina do com300. Sucesso ⟺ eco com descrição **não-vazia**; falha é fail-closed antes de
qualquer escrita irreversível.

O texto default **não é uma escolha nova**: é o que o próprio ERP produziria com o cadastro em
"1 - Descrição Produto" (`prdDesNome` da linha), depois de tentar o `preDescrProdutoNf` do ERP.
`NDE_DESCRICAO_ITEM_FALLBACK` existe para o caso — e só para o caso — de o fiscal querer outro texto.

Regra completa e ordem de precedência: `business-rules/descricao-item-nde.md`.

## Alternativas descartadas

| Alternativa | Por que não |
|---|---|
| Trocar `dpeVld1DescrNfe` no cadastro (permanente) | O valor está **certo**: para a NF-e de mercadoria do mesmo cliente, descrever a DI/DUIMP é o comportamento fiscal desejado. Consertaria a NDe quebrando o faturamento. |
| Trocar, emitir e restaurar (janela curta) | Escrita em dado-mestre **versionado** (`dpeCodSeq`), com corrida contra qualquer nota emitida por humano na janela e risco de deixar o cadastro errado se o processo morrer no meio. |
| Outro `prdCod` para a NDe | A NDe é encargo, não mercadoria; `41978` é o produto acordado com o fiscal. |
| Outra Configuração de Documento (`gcd`) | Não resolve: a regra de descrição vem da **pessoa**, não do `gcd`. |
| Deixar o analista corrigir na tela a cada nota | É trabalho manual recorrente em cima de um passo automatizado — e some no volume. |

## Consequências

- Clientes com cadastro compatível: **nada muda** (a etapa é no-op — a descrição já vem preenchida).
- Clientes com "Descrição DI": a NDe passa a homologar sem tocar em cadastro nenhum.
- Execuções que **já falharam** por isso (paradas em `obs-done`) são consertadas **na retomada** — por
  isso a regra é idempotente pelo estado do documento e **não** ganhou etapa própria no ledger
  (uma etapa monotônica pularia exatamente esses casos).
- Novo ponto de escrita no ERP (`PUT com297/comDocProdutos`) — a conta de serviço precisa da ação de
  **alteração de item** em `com297`. Se faltar, a etapa falha fail-closed com o 403 do ERP, antes de
  qualquer coisa irreversível.
- NDes **já homologadas** com descrição vazia (se houver) não são alcançadas: homologação é
  irreversível. O levantamento fica em `_inbox/nde-descricao-produto-nfe-diagnostico.md`.

## Verificação pendente (não bloqueia)

Se o ERP monta o XML a partir do `dprLngDescrNf` **gravado** (hipótese, sustentada por o campo ser
persistido, editável no UI e ter uma rota dedicada só para *pré-preencher*) ou se o recalcula na
homologação. A sonda read-only `recebimentos.e2e.descricaoNfeNde.integration.test.ts` responde
comparando um documento que falhou com um que homologou.
