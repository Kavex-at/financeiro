## Interview Transcript — sispag-ted-pix — 2026-09-28

**Mode:** tweak
**Comando:** `/feature-tweak entities/lote-pagamento "TED e PIX na remessa SISPAG, com destino manual por lote"`
**Entity affected:** `LotePagamento` → membro `ItemLote` (`lote_pagamento_item`). Toca também a leitura
de destino do `TituloAPagar`/favorecido (`cmn025`) e a ação de gerar remessa (`RemessaService`).
**Fonte do que já se sabe:** `ontology/_inbox/sispag-ted-pix-plan.md` (medições PRD de 2026-09-28).

> **Nota sobre o plano.** O §3 do plano registra a **opção A** (gravar no cadastro `cmn025` e
> depois referenciar pelo `pctCodSeq`). **Essa decisão foi substituída em 2026-09-28** pela versão
> mais simples (próximo da opção B): o destino digitado vale **só para aquele item do lote**, fica
> gravado no nosso Postgres e segue no payload do item do `fin015`. **Não se escreve no cadastro
> do Conexos agora.** O "atualizar cadastro" pode entrar depois. Com isso o **H3 volta a bloquear**
> (ver §6) e o H2 sai do caminho crítico. O OntologyCurator deve anotar a troca no plano.

---

### 1. Comportamento atual (confirmado no código e na ontologia)

- **A ontologia não modela modalidade nem destino.** `entities/lote-pagamento.md` lista as
  propriedades do `ItemLote` sem `modalidade`, mas a coluna existe desde a migration `0031`
  (`BOLETO | TED | PIX | CREDITO_CONTA`, NULL = "a definir", bloqueia a finalização). É uma
  divergência de ontologia anterior a esta feature.
- **TED e PIX saem como crédito em conta.** `RemessaService.ts:41`, `MODALIDADE_NATIVA` manda
  `TED: 1` e `PIX: 1`. No `fin015`, `1` = crédito CC e `5` = TED. **Não há código de PIX**: o PIX é
  um conjunto de campos (`itsVldChavePix`, `itsDesChavePix`, `itsEspLocPix`, `itsEspTxidPix`) que
  hoje não mandamos.
- **O envio só aceita conta no mesmo banco do lote.** Em `montarItensImport` (~l.982), `noBanco`
  filtra as contas do favorecido pelo FEBRABAN do lote. Os 3 TEDs históricos foram todos para
  **outro** banco, então nenhum deles passaria hoje.
- **A oferta e o envio discordam.** `SispagPainelService.modalidadesDisponiveisDoLote` oferece TED
  quando o favorecido tem conta ativa em **qualquer** banco, e o envio recusa se não for o banco
  do lote.
- **PIX nunca é oferecido na prática.** A oferta de PIX vem de `itsDesChavePix` no `fin064`
  (`ConexosSispagClient.ts:215`), um LEFT JOIN no item SISPAG com 0% de preenchimento medido. Não
  lemos `cmn025/cmnPessoasPix`.
- **O destino sempre vem do cadastro**, via `pctCodSeq` (19/19 itens TED/crédito históricos).
  Não existe entrada manual.
- **`RemessaCnabValidator` não olha o segmento A**: um PIX que saísse como crédito passaria.
- **Crédito em conta está fora da oferta** (commit `fc22dcd`). Item que já o tem continua válido.

### 2. Comportamento desejado (delta)

1. **TED correto.** `TED → itsVldModalidade = 5`. Destino = conta ativa do cadastro
   (`cmn025/ctcorr`) em **qualquer banco**, a default primeiro. A oferta segue a mesma regra do envio.
2. **PIX.** Destino = chave ativa do cadastro (`cmn025/cmnPessoasPix`, por `pesCod`), a default
   primeiro. O item vai com `itsVldChavePix` / `itsDesChavePix` (e `itsEspLocPix` / `itsEspTxidPix` /
   `itsVldModalidade` como o HML mostrar). PIX só é oferecido/enviado **com chave**.
3. **Destino manual por item.** Quando o cadastro não resolve, a analista digita o destino **só
   para aquele item do lote**:
   - TED: banco, agência (e DV, se houver), conta, DV da conta, e CPF/CNPJ do titular (ver Q1);
   - PIX: a chave (e o tipo, ver Q4).
   O destino fica gravado no `ItemLote` (Postgres, colunas novas), vai no payload do item do
   `fin015` **sem `pctCodSeq`**, e **não** é escrito no cadastro do Conexos.
4. **Validação no envio.** O `RemessaCnabValidator` passa a conferir a forma de lançamento do
   segmento A contra a modalidade (TED × crédito × PIX; códigos a confirmar no fixture) e a
   presença do segmento B.
5. **Validações do ERP** (`validacao/modalidadeTed` e `validacao/modalidadePix`) só entram no fluxo
   se o H1 provar que não têm efeito colateral.

### 3. Regra ou bug?

As duas coisas, e o diff deve separar:

| Parte | Tipo | Diff de ontologia? |
|---|---|---|
| `TED → 1` em vez de `5` | **implementation bug** | não (mas a doc do `ItemLote` precisa ganhar `modalidade`, que falta) |
| TED só no mesmo banco / oferta ≠ envio | **implementation bug** (a regra nunca foi "mesmo banco"; o histórico é 100% outro banco) | não |
| PIX lido do `fin064` em vez do `cmnPessoasPix` | **implementation bug** | não |
| Destino manual por item | **rule change** + **new property** | sim: propriedades novas no `ItemLote`, invariantes novas, ADR |
| PIX como forma de pagamento real | **rule change** | sim: regra "PIX exige chave" e mapeamento de campos |

**entity_changed: true.**

### 4. Invariantes afetadas (propostas para o OntologyCurator)

- **D1 — destino resolvível antes de qualquer escrita.** Todo item TED/PIX precisa ter destino
  resolvido (cadastro ou manual) **antes do `criarLote`** no `fin015`. Item sem destino barra o
  envio inteiro com erro nomeado por item, como o `BoletoSemCodigoBarrasError` faz hoje. Nada de
  lote nativo pela metade.
- **D2 — oferta = envio.** A regra que decide se TED/PIX aparece na tela é a **mesma função** que
  o envio usa para resolver o destino. Hoje são duas regras diferentes, e isso é o bug.
- **D3 — TED aceita qualquer banco.** O banco do favorecido não precisa ser o do lote.
- **D4 — PIX só com chave.** Sem chave (do cadastro ou digitada) o PIX não é oferecido nem enviado.
- **D5 — destino manual só em RASCUNHO.** Digitar ou alterar o destino segue as regras do lote
  (I5/I6): só com o lote em RASCUNHO, com `versao` (optimistic lock), e reabrir (L4) volta a
  permitir a edição.
- **D6 — congelamento após o import.** Depois que o item foi importado no `fin015` com um destino,
  esse destino **não muda**: retry e retomada (ADR-0039) reenviam o valor persistido, como a
  `dataDebito` na I8b. O destino entra na assinatura da marca d'água do lote órfão.
- **D7 — trilha.** Toda gravação de destino manual registra quem, quando, valor anterior e valor
  novo. O dado é nosso, então a trilha também é, porque o ERP não terá `ctcorr/log`.
- **D8 — mascaramento.** Conta e chave são gravadas **completas** (vão ao ERP), mas aparecem
  **mascaradas** na tela e **nunca** saem inteiras em log, `LogService.data`, ledger
  (`remessa_execucao.requestPayload`) ou mensagem de erro. Revelar só para a pessoa que está
  editando.
- **D9 — titularidade** (forma exata em Q1). O destino digitado pertence ao favorecido do título.
- **Preservadas sem mudança:** I2, I3, I4 (uma filial), I8 (data de débito), a chave
  `filCod:docCod:titCod` verbatim do grid de pendentes, e o freio `SISPAG_DDA_ASSOC_ENABLED`
  (que continua sem afetar TED/PIX).

**Raio de impacto se errar:** o dinheiro vai para a conta errada, e isso é irreversível na prática.
Trocar o destino de um pagamento é o vetor clássico de fraude. Por isso D7 a D9 não são opcionais.

### 5. Casos de teste canônicos

1. **TED para outro banco (o caso histórico).** Lote Itaú (341), favorecido com uma única conta
   ativa no Bradesco (237) no `ctcorr`. Hoje: erro "não tem conta ativa no banco 341". Esperado:
   item com `itsVldModalidade=5` e o `pctCodSeq` dessa conta.
2. **Conta default.** Favorecido com duas contas ativas, uma `pctVldDefault`. Esperado: vai a default.
3. **Oferta = envio.** Favorecido só com conta inativa. Esperado: TED não é oferecido **e** o envio
   recusa, com a mesma mensagem.
4. **TED manual.** Favorecido sem conta (12/21 da amostra). A analista digita banco/agência/conta.
   Esperado: item sem `pctCodSeq`, com os campos digitados, trilha gravada, conta mascarada na tela
   e nos logs.
5. **PIX do cadastro.** Favorecido com chave ativa no `cmnPessoasPix`. Esperado: PIX oferecido e
   item com `itsVldChavePix=1` e `itsDesChavePix`.
6. **PIX sem chave.** Favorecido sem chave (4/4 medidos) e sem chave digitada. Esperado: PIX não
   oferecido. Se forçado via API, `D1` barra antes do `criarLote`.
7. **Retomada.** Import feito, queda antes do `finalizar`, analista tenta mudar o destino. Esperado:
   recusado (D6). A retomada reenvia o destino persistido.
8. **Validador.** `.REM` com item PIX cujo segmento A traz a forma de crédito em conta. Esperado:
   `RemessaCorrompidaError`.
9. **Lote misto** boleto + TED + PIX na mesma filial. Esperado: cada item com a modalidade
   certa (o ERP quebra em lotes CNAB, GT-3, Fase 4).

### 6. Premissas que dependem do HML (não são perguntas; bloqueiam o PRD)

| # | Premissa | Se falhar |
|---|---|---|
| H1 | `validacao/modalidadeTed` / `modalidadePix` não têm efeito colateral | não chamamos; o `RemessaCnabValidator` fica como única rede |
| **H3 (volta)** | o `fin015` aceita item TED com banco/agência/conta digitados **sem `pctCodSeq`** (nunca observado: 19/19 históricos tinham `pctCodSeq`) | o destino manual de TED não funciona sem gravar no cadastro, e a opção A (escrita no `cmn025`) volta para a mesa |
| H4 | campos que o item PIX exige (`itsVldModalidade`? `itsEspLocPix`/`itsEspTxidPix` vazios?) e forma/segmentos do `.REM` gerado. Não há item PIX histórico em PRD | o PIX fica atrás de feature flag até o HML provar |
| H5 | o `fin015` aceita chave PIX digitada que não está no `cmnPessoasPix` | idem H3, para PIX |
| H6 | o ERP não sobrescreve `itsVldModalidade=5` (como faz com boleto DDA) | ajustar o mapeamento ao que ele grava |

Estratégia (decidida): desenvolver agora com base no histórico de TED. A validação com a Columbia
(plano §5) corre em paralelo. O PIX é construído só até onde o HML provar.

### Summary

TED hoje sai como crédito em conta (`1` em vez de `5`) e só aceita conta no banco do lote, quando o
histórico real é 100% TED para outro banco. Além disso a oferta da tela e o envio usam regras
diferentes, e o PIX nunca é oferecido porque lemos a chave de um campo que vem sempre vazio. O
tweak corrige esses bugs e adiciona duas regras: PIX com chave do cadastro `cmnPessoasPix`, e
destino digitado pela analista **só para o item do lote**, gravado no Postgres e enviado no
payload do `fin015` sem tocar o cadastro do Conexos. A entrada manual traz invariantes de
segurança (titularidade, trilha, mascaramento, congelamento após o import), e depende do H3, que
nunca foi observado.

### Extracted rules

- R1: TED = `itsVldModalidade 5`, destino em qualquer banco, conta default primeiro.
- R2: PIX exige chave (cadastro ou digitada); campos do item conforme o HML.
- R3: oferta e envio usam a mesma resolução de destino.
- R4: destino manual vale só para o item do lote, só em RASCUNHO, sem escrita no `cmn025`.
- R5: destino congelado depois do import no `fin015`.
- R6: trilha completa e mascaramento em tela, log e ledger.
- R7: titularidade do destino digitado (forma em Q1).
- Crédito em conta continua fora da oferta.

### entity_changed: true
### Ontology diff needed: yes
- `entities/lote-pagamento.md`: `ItemLote` ganha `modalidade` (já existe na `0031`, faltava na doc)
  e as propriedades do destino manual (`destinoOrigem: CADASTRO|MANUAL`, banco, agência, conta,
  DV, doc do titular, chave PIX, tipo de chave, `destinoInformadoPor/Em`), e as invariantes D1 a D9.
- Business rule nova: `destino-pagamento-sispag.md` (resolução, precedência, titularidade, congelamento).
- ADR: destino manual por item sem escrita no cadastro (substitui a opção A do plano) e o risco H3.
- Plano `sispag-ted-pix-plan.md` §3 e §6: registrar a troca da opção A e o H3 de volta.

### Reason: implementation bug (TED→1, filtro de banco, fonte do PIX) + rule change / new property (destino manual, PIX)

### Open questions (respostas do Yuri antes do diff)

- **Q1 — Controles do destino digitado.** Sem papéis de usuário hoje (auth é o e-mail Columbia),
  quem pode digitar e o que se exige?
  *Default recomendado:* qualquer usuário do SISPAG digita. **Titularidade obrigatória e
  bloqueante**: o CPF/CNPJ do titular é digitado junto e tem de ser igual ao do favorecido do
  título. Para chave PIX do tipo CPF/CNPJ, a própria chave precisa bater. Para e-mail, telefone e
  aleatória, mostrar o nome do DICT se o H1 provar que a validação devolve esse nome. Trilha sempre.
  **Quatro olhos:** quem digitou o destino não pode ser quem finaliza o lote (a Columbia tem duas
  analistas, Flavia e Rene, então dá para operar).
- **Q2 — O destino digitado pode substituir o do cadastro?**
  *Default recomendado:* **não.** A entrada manual só aparece quando o cadastro não tem conta ativa
  (TED) ou chave ativa (PIX). Quem quer trocar um destino que já existe corrige no Conexos. Isso
  fecha o caminho de "desviar" um fornecedor que já tem cadastro.
- **Q3 — Tipo da chave PIX: digitado ou inferido?**
  *Default recomendado:* **a analista escolhe o tipo** (CPF/CNPJ, e-mail, telefone, aleatória), e
  validamos o formato por tipo. Inferir erra no caso de 11 dígitos, que tanto pode ser CPF quanto
  celular.
- **Q4 — Onde fica na tela?**
  *Default recomendado:* na linha do item no `LoteCard`, ao lado da escolha da forma de pagamento.
  Ao escolher TED/PIX sem destino no cadastro, aparece "Informar destino" (um diálogo), editável só
  com o lote em RASCUNHO. O item mostra o destino mascarado e um selo "manual". A finalização fica
  bloqueada enquanto houver TED/PIX sem destino (como já acontece com "modalidade a definir").
- **Q5 — Finalidade do TED.**
  *Default recomendado:* copiar o que os 3 TEDs históricos gravaram no item (a confirmar no
  fixture/HML) e fixar como constante, **sem** expor na tela. Só vira campo se a Columbia pagar
  TED com finalidade diferente de crédito em conta a fornecedor.
