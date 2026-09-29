---
adr_number: 0054
title: O destino de TED e PIX pode ser digitado pela analista no item do lote, vale só para aquele item, pode substituir o do cadastro e não é escrito no Conexos
date: 2026-09-28
status: accepted
type: change
related_entities: [LotePagamento, TituloAPagar]
related_actions: [gerenciarLoteCandidato, finalizarLote, gerarRemessa]
related_business_rules: [destino-pagamento-sispag, boleto-exige-codigo-de-barras, retomada-remessa-sispag, data-debito-remessa-sispag]
related_integrations: [conexos]
evidence:
  - ontology/_inbox/sispag-ted-pix-interview.md (D1–D9, H1/H3–H6, casos de teste 1–9)
  - ontology/_inbox/sispag-ted-pix-plan.md §2 (PRD 2026-09-28 — 19/19 itens TED/crédito com pctCodSeq; 12/21 favorecidos sem conta; 0 chaves PIX em 4 favorecidos)
  - src/backend/domain/service/sispag/RemessaService.ts:41 (MODALIDADE_NATIVA manda TED 1 e PIX 1)
  - src/backend/migrations/0031_sispag_modalidade.sql (coluna modalidade do item)
  - respostas do Yuri às Q1–Q5 do interview, 2026-09-28
supersedes_decisions: []
amends_decisions: [0039, 0049]
---

# ADR 0054: destino de TED e PIX digitado no item do lote, com precedência sobre o cadastro

**Cliente:** Columbia Trading · **Entrega:** Kavex · **Branch:** `feat/sispag-ted-pix`
(`/feature-tweak entities/lote-pagamento`, slug `sispag-ted-pix`). `entity_changed = true`.

## Contexto

O `fin015` gera a remessa. O nosso trabalho é mandar os campos certos em cada item. Hoje:

- TED e PIX saem como **crédito em conta** (`itsVldModalidade = 1`; TED é `5`, PIX não tem código,
  é um conjunto de campos `itsVldChavePix`/`itsDesChavePix`/...).
- O destino vem **só do cadastro** da pessoa (`cmn025/ctcorr`, via `pctCodSeq`), e só se a conta
  for do **mesmo banco do lote**. Os 3 TEDs históricos foram todos para outro banco.
- A tela oferece TED com uma regra e o envio recusa com outra.
- A chave PIX é lida de um campo que vem sempre vazio (`fin064`), não do `cmn025/cmnPessoasPix`.

Esses quatro pontos são **bugs de implementação** e não mudam a ontologia (a não ser pela
`modalidade` do item, que existe desde a `0031` e faltava na doc).

O que muda o modelo: **metade dos favorecidos amostrados não tem conta no cadastro e nenhum tem
chave PIX**, e o cadastro do Conexos que existe está **desatualizado e causa erro de pagamento**
(Yuri, 2026-09-28). Sem entrada manual, TED e PIX quase nunca seriam utilizáveis.

O plano (§3) tinha decidido de manhã a **opção A**: gravar a conta/chave no `cmn025` e referenciar
pelo `pctCodSeq`, como o ERP faz. À tarde a decisão foi trocada pela forma mais simples.

## Decisões

### D1 — O destino digitado vale só para o item do lote (substitui a opção A do plano)

A analista digita o destino **no `ItemLote`**. Ele é persistido no nosso Postgres
(`ItemLote.destinoManual`), vai no payload do item do `fin015` **sem `pctCodSeq`**, e **não é
escrito no cadastro do Conexos**. "Atualizar o cadastro com o que foi digitado" pode entrar depois,
como feature própria.

Consequência aceita: a analista redigita o destino a cada lote em que o favorecido aparecer.

### D2 — O destino digitado pode substituir o do cadastro (Q2)

A entrada manual **não** fica restrita a "quando o cadastro está vazio". Se o favorecido tem conta
ou chave no cadastro, a analista ainda pode digitar outra, e **a digitada prevalece** naquele item.

**Por quê:** o cadastro do Conexos está desatualizado e é uma das causas de erro que motivam a
entrada manual. Uma regra que só abre a digitação com o cadastro vazio empurraria a analista a
pagar para a conta errada que o cadastro tem.

**Risco reconhecido:** retirar a restrição **alarga o risco de desvio**. Com ela, só o favorecido
sem destino podia receber um destino digitado. Sem ela, qualquer pagamento TED/PIX pode ser
redirecionado por quem tem acesso ao SISPAG. Trocar o destino de um pagamento é o vetor clássico de
fraude.

**Mitigação (bloqueante, não opcional):**
- **titularidade:** o CPF/CNPJ do titular é digitado junto e **tem de ser igual** ao do favorecido do
  título; se não for, a gravação é recusada. Para chave PIX do tipo CPF/CNPJ, **a própria chave**
  tem de bater. Para chave e-mail, telefone ou aleatória, a tela mostra o **nome do titular no DICT**
  se, e somente se, o H1 provar que `validacao/modalidadePix` devolve esse nome sem efeito colateral;
- **trilha completa:** quem, quando, valor anterior e valor novo, em cada gravação, na nossa base
  (o ERP não terá `ctcorr/log` desse dado);
- **selo "manual"** no item e destino mascarado na tela, para que quem finaliza veja que o destino não
  veio do cadastro.

### D3 — Sem regra de quatro olhos agora (Q1)

A regra "quem digitou o destino não pode finalizar o lote" foi **retirada** (decisão do Yuri,
2026-09-28): com duas analistas, ela travaria a operação sempre que uma estivesse ausente. Fica
registrado como follow-up que uma **permissão específica** para informar ou substituir destino pode
ser criada depois. O catálogo de permissões por módulo em curso na branch `feat/auth-permissoes-modulo`
(ADR-0053) é o lugar natural para ela. **Não** faz parte deste tweak.

### D4 — PIX usa a chave do cadastro `cmn025/cmnPessoasPix` ou a digitada; tipo escolhido pela analista (Q3)

PIX só é oferecido e enviado **com chave**. A chave digitada vem com o **tipo escolhido pela
analista** (CPF/CNPJ, e-mail, telefone, aleatória), e o formato é validado por tipo. Não inferimos o
tipo: 11 dígitos são CPF ou celular.

### D5 — O destino congela quando o item é importado no `fin015` (emenda a ADR-0039 e a ADR-0049)

Depois do `importarTitulos` com um destino, esse destino **não muda**: retry e retomada reenviam o
valor persistido, e ele entra na assinatura da marca d'água do lote órfão, como a `dataDebito` na
I8b. Editar só volta a ser possível com o lote em RASCUNHO (L4 reabre), e só se o lote nativo que o
usou deixou de existir.

### D6 — O H3 volta a bloquear, e a queda para a opção A exige parar e falar com o usuário

Ao escolher D1, a premissa **H3** — *o `fin015` aceita item TED com banco/agência/conta digitados
sem `pctCodSeq`* — volta ao caminho crítico. Ela **nunca foi observada**: 19/19 itens históricos
tinham `pctCodSeq`. O mesmo vale para PIX (**H5**: aceita chave que não está no `cmnPessoasPix`).

**Se o HML rejeitar o item com destino digitado e sem `pctCodSeq`, o pipeline PARA e fala com o
usuário antes de qualquer fallback.** A opção A (escrever no `cmn025` e referenciar pelo
`pctCodSeq`) é escrita em cadastro mestre, com outro perfil de risco e outra permissão do robô (H2);
ela não entra por decisão automática do loop.

Os testes em HML usam o **mesmo usuário Conexos do `.env` local**.

### D7 — A finalidade do TED é hipótese (H7), não fato

O item SISPAG carrega `fbtCod`/`fbtDesDescr`/`fbtEspCodbanco`, da tabela `FinBancosTpcontrib`
(`fin055/{bncCod}/{fbtCod}`). A ideia é copiar o valor dos 3 TEDs históricos e fixar como constante,
sem expor na tela. **Não está confirmado que esses campos são a finalidade do TED.** Fica como **H7**,
verificada na etapa de ground truth/HML antes de virar constante. Se não for finalidade, ou se o ERP
preencher sozinho, a constante não existe.

### D8 — Crédito em conta continua fora da oferta

Sem mudança em relação ao commit `fc22dcd`: `CREDITO_CONTA` segue válido no enum (item que já o tem
continua válido), mas não é oferecido.

## Alternativas consideradas

| Alternativa | Por que não |
|---|---|
| Opção A (gravar no `cmn025`, depois `pctCodSeq`) | Igual ao ERP e reaproveitável, mas é escrita em cadastro mestre, depende de permissão do robô (H2) e do formato do `cmn025`. Fica como fallback **mediante conversa** se o H3 falhar (D6). |
| Manual só com cadastro vazio | Recomendada pelo interview; recusada porque o cadastro desatualizado é justamente a causa do erro (D2). |
| Quatro olhos (quem digita não finaliza) | Recusada agora; trava a operação com duas analistas (D3). |
| Inferir o tipo da chave PIX | Ambíguo (11 dígitos) (D4). |

## Consequências

- `ItemLote` ganha `modalidade` (doc) e `destinoManual` (novo), com a invariante **I10** (D1–D9 do
  interview). Ver `entities/lote-pagamento.md` e `business-rules/destino-pagamento-sispag.md`.
- `finalizarLote` passa a barrar item TED/PIX sem destino resolvível.
- A titularidade exige ler o CPF/CNPJ do favorecido (`cmn025`, por `pesCod`) ao vivo; o
  `TituloAPagar` não o guarda.
- PIX fica atrás de feature flag até o H4 provar os campos do item e o `.REM` gerado.
- Se H3/H5 falharem, a feature de destino manual não sai como está: volta para o usuário.

## Adendo (2026-09-28) — checagem leve no finalizar e validação em PRD supervisionada

- **Finalizar usa a checagem LEVE.** Barra só o item TED/PIX sem destino digitado e sem opção
  ofertada pelo cadastro na tela. A checagem autoritativa (leitura ao vivo do `cmn025`, I10a)
  continua no envio. Decisão do usuário: o envio já faz a leitura estrita.
- **Não há HML disponível.** As hipóteses H1, H3, H5, H6 e H7 são validadas em **PRD, com
  supervisão do usuário**, num primeiro pagamento de valor baixo. Até lá, tudo o que não foi provado
  sai **atrás de feature flag desligada por padrão** (`SISPAG_TED_ENABLED`,
  `SISPAG_DESTINO_MANUAL_ENABLED`, `SISPAG_PIX_ENABLED`): o deploy não muda o comportamento em
  produção antes do teste supervisionado.
- **As validações do ERP (`validacao/modalidadeTed`, `validacao/modalidadePix`) ficam FORA do fluxo**
  até o H1 provar que não têm efeito colateral.

## Adendo (2026-09-29) — documento do favorecido e tipos de chave digitáveis

- **Documento do favorecido = `pdcDocFederal`** do `cmn025` (schema `CmnPessoas`; o mesmo campo de
  `FinTitulo` e `CmnPessoasCtcorr`). O palpite `pesNumCpfCnpj` não existe no schema. Fonte única:
  o cadastro do Conexos. Falta conferir o valor vivo no teste supervisionado.
- **Chave PIX digitada só do tipo CPF/CNPJ.** O titular de uma chave só está no DICT do Banco
  Central, que só banco consulta. Na chave CPF/CNPJ a própria chave é o documento, e a titularidade
  (I10i) é completa; telefone, e-mail e aleatória não têm titular conferível daqui e são recusadas
  (`ChavePixTitularNaoVerificavelError`). Chave vinda do cadastro do Conexos segue aceita em
  qualquer tipo. Reabrir se o `validacao/modalidadePix` (H1) ou uma consulta de chave do banco
  devolver o titular.
