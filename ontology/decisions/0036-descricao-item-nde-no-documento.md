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
itens (`POST com297/comDocProdutos/list/{docCod}/{fisCod}`); para o item cuja descrição o **ERP não
consegue derivar**, ler a linha inteira
(`GET com297/comDocProdutos/{docCod}/{fisCod}/{prdCod}/{dprCodSeq}`), substituir o campo e regravar por
**read-modify-write** (`PUT com297/comDocProdutos`, objeto inteiro, `putGenericOnce`) — mesma doutrina
do com300. Sucesso ⟺ eco com descrição **não-vazia**. Falha de ESCRITA é fail-closed antes de qualquer
coisa irreversível; falha de LEITURA degrada (WARN e segue), porque a leitura roda para toda NDe e
derrubá-la propagaria a todos um problema que é de alguns.

**O gatilho é o `preDescrProdutoNf` VAZIO, não o campo vazio** — ver §Emenda 2026-08-12.

O texto default **não é uma escolha nova**: é o que o próprio ERP produziria com o cadastro em
"1 - Descrição Produto" (`prdDesNome` da linha) — confirmado em campo, o visualizador de pré-descrição
do ERP resolve para o mesmo `PAGAMENTO ANTECIPADO`. `NDE_DESCRICAO_ITEM_FALLBACK` existe para o caso —
e só para o caso — de o fiscal querer outro texto: ele escolhe o TEXTO, não se a regra age.

`NDE_DESCRICAO_ITEM_ENABLED=false` desliga só esta etapa, sem derrubar a Frente IV.

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

## Emenda 2026-08-12 — o gatilho passa a ser o `preDescrProdutoNf`

Medição de campo no doc **18790** (o que homologou após a troca de cadastro) e nas demais NDes
saudáveis: **`dprLngDescrNf` está vazia em TODAS**, inclusive nas que homologam sem problema. O ERP
**não persiste** ali a descrição que imprime — o campo é um *override* manual, normalmente em branco.

Consequência para o desenho original: "campo vazio" **não** distingue o caso quebrado do normal. Com
ele como gatilho, a etapa escreveria em toda nota de todo cliente, trocando em 100% das emissões um
valor derivado na homologação pela saída de uma rota de **pré-visualização** — uma superfície muito
maior que o problema que a decisão existe para resolver.

O gatilho passa a ser o próprio ERP: `preDescrProdutoNf` com texto ⟹ ele deriva, não há o que
consertar, no-op; vazio ⟹ caso quebrado, grava. Se ele responder algo mesmo no caso quebrado, a etapa
não age — falha para o lado seguro. Com isso o `preDescrProdutoNf` deixa de ser *fonte* do texto e
vira *sinal*, e a precedência do texto encurta para env → `prdDesNome` → constante.

## Verificação pendente (não bloqueia) — a premissa de OVERRIDE

Se preencher `dprLngDescrNf` **sobrepõe** a derivação, ou se o ERP monta o `xProd` sempre a partir do
cadastro. O 18790 mostra que o campo fica vazio e a nota sai — o que estabelece que o ERP não persiste
ali, mas **não** decide se um campo preenchido seria respeitado. O nome do campo ("Descrição para
Impressão"), o tamanho (4000 × 50 do nome do produto) e existir uma rota só para pré-preenchê-lo
apontam para override, sem provar.

Fecha com um gesto manual: na próxima NDe travada, o analista digita o texto no campo do item **sem
tocar no cadastro** e homologa. Passou ⟹ override confirmado. Em paralelo, cabe perguntar à NTT Data.

Enquanto isso a decisão é segura por construção: só age no caso já quebrado, degrada em falha de
leitura, é fail-closed na escrita, tem interruptor por env, e o texto gravado é o mesmo que o ERP
imprimiria — não há passivo fiscal em ter escrito.
