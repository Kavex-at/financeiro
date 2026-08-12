---
name: descricao-item-nde
type: business-rule
entity: NotaDebitoEletronica
ontology_version: "0.18"
implementation_status: implemented
status: accepted
owners: [yuri]
invariant: I-Receb-5
related_files:
  - src/backend/domain/client/ConexosNdeFiscalClient.ts
  - src/backend/domain/service/recebimentos/RecebimentoNumerarioService.ts
  - src/backend/domain/interface/recebimentos/NdeFiscal.ts
  - src/backend/domain/libs/environment/model/EnvironmentVars.ts
  - src/backend/domain/libs/environment/EnvironmentProvider.ts
last_review: 2026-08-12
has_canonical_test: true
---

# Regra: descricao-item-nde (a Descrição para Impressão do item sai do DOCUMENTO, não do cadastro)

> **Invariante I-Receb-5 — Toda NDe apresentada à homologação tem `dprLngDescrNf` não-vazia no seu
> item, e essa garantia é obtida ESCREVENDO NO DOCUMENTO, nunca alterando o cadastro do cliente.**

## Contexto

`ComDocProdutosFisFin.dprLngDescrNf` ("Descrição para Impressão", `maxLength` 4000 **bytes**) é o campo
que vira o **`xProd` da NF-e**. Quem o preenche na geração é o ERP, aplicando a regra do cadastro do
CLIENTE (`cmn025` → `CmnDadosPessoas.dpeVld1DescrNfe`, enum `0..6`).

Para os clientes com essa regra em **`4` — Descrição DI** (rótulo do tenant "DI + DUIMP"), a derivação
não tem de onde tirar texto: o produto de encargo da NDe (`41978` PAGAMENTO ANTECIPADO) não tem adição
de DI. O campo sai vazio e a homologação é recusada.

## A regra

1. Entre a geração da NDe e a leg fiscal (`com300`), listar os itens do documento.
2. Item com `dprLngDescrNf` **não-vazia** ⟹ **no-op**: é override manual de alguém, não é nosso.
3. `preDescrProdutoNf` do item devolve **texto** ⟹ **no-op**: o ERP consegue derivar e a nota sai
   certa sozinha. É o caso da esmagadora maioria das emissões.
4. `preDescrProdutoNf` devolve **vazio** ⟹ é o caso quebrado: resolver o texto (precedência abaixo),
   ler a linha INTEIRA e regravá-la por **read-modify-write** (`PUT com297/comDocProdutos`, objeto
   completo, tentativa única).
5. **Sucesso ⟺ o eco traz `dprLngDescrNf` não-vazia.** HTTP 200 não é sucesso.
6. O cadastro do cliente (`cmn025`) **nunca** é escrito.

### Por que o gatilho NÃO é "campo vazio"

Medido em produção (2026-08-12, doc 18790 e demais NDes saudáveis): **`dprLngDescrNf` fica vazia em
TODA NDe**, inclusive nas que homologam sem problema. O ERP não persiste ali a descrição que imprime —
o campo é um *override* manual, normalmente em branco.

Logo, "campo vazio" não distingue o caso quebrado do caso normal. Usá-lo como gatilho faria a regra
escrever em toda nota de todo cliente, trocando em 100% das emissões um valor derivado na homologação
pela saída de uma rota de **pré-visualização** — surface muito maior do que o problema que a regra
existe para resolver.

O discriminador correto é o próprio ERP: se ele deriva algo, não há o que consertar. Se o
`preDescrProdutoNf` responder texto mesmo no caso quebrado, a regra não age — falha para o lado
seguro, que é o comportamento anterior a ela.

### Precedência do texto (só quando a regra age)

| # | Fonte | Por quê |
|---|---|---|
| 1 | `NDE_DESCRICAO_ITEM_FALLBACK` (env) | Escape do fiscal, se ele quiser OUTRO texto. Normalmente ausente. Escolhe o TEXTO, não se a regra age. |
| 2 | `prdDesNome` da própria linha | O texto que o ERP produziria com o cadastro em "1 - Descrição Produto" — reproduz **byte a byte** o workaround manual. Confirmado em campo: o visualizador de pré-descrição do ERP resolve para o mesmo `PAGAMENTO ANTECIPADO`. |
| 3 | `NDE_GERACAO_DEFAULTS.produtoNome` | Último recurso, se nem o join do produto vier. |

O limite de 4000 é contado em **bytes UTF-8**, não em caracteres: a coluna é `VARCHAR2(4000 BYTE)` e
texto acentuado custa 2 bytes por acento.

## Por que no DOCUMENTO e não no cadastro

O valor `4 - Descrição DI` está **certo**: para a NF-e de mercadoria do mesmo cliente, descrever a
DI/DUIMP é o comportamento fiscal desejado. Trocá-lo consertaria a NDe **quebrando o faturamento**. E é
dado-mestre **versionado** (`dpeCodSeq`) e compartilhado — trocar-e-restaurar correria contra qualquer
nota emitida por um humano na janela. Ver ADR-0036 para a tabela completa de alternativas descartadas.

## Idempotência: pelo estado do DOCUMENTO, não pelo ledger

O gate é apenas "ainda não homologou". A regra **não** tem etapa própria em `etapaOrdem`, de propósito:
uma etapa monotônica pularia exatamente as execuções que **já falharam** por este bug (paradas em
`obs-done`). Com o gate no estado do documento, **retomar uma alocação travada conserta-a**.

Depois de homologada não há o que consertar — a NF-e já saiu.

## Postura de falha: LER degrada, ESCREVER é fail-closed

Assimetria deliberada, por blast radius:

- **Escrita** (`gravarDescricaoItemNde`) falhou ⟹ **fail-closed**: `status=error`, `etapa=nota-debito`,
  sem tocar `com300`/`com131`/homologar. Homologar sem a descrição seria queimar a nota.
- **Leituras** (`listItensNde`, `lerItemNde`) falharam ⟹ **degrada**: `BUSINESS_WARN` e segue para a leg
  fiscal. A listagem roda para TODA NDe, inclusive as em que a regra é no-op; se ela derrubasse a
  alocação, uma ACL faltando ou um ERP instável transformaria um problema de ALGUNS clientes numa
  parada da frente inteira. Degradando, o pior caso é o comportamento anterior à regra.
- **Documento sem linha de item** ⟹ WARN e segue. Não inventamos a linha: criá-la é outra escrita, com
  outro contrato, e o ERP tem a última palavra.

## Interruptor

`NDE_DESCRICAO_ITEM_ENABLED=false` desliga só esta regra (default ligado). Pular é seguro por
construção — a regra roda antes de qualquer coisa irreversível. Mesmo padrão da ADR-0028
(`snCondPgtoAutoajuste`).

## Pré-requisito no ERP

A conta de serviço precisa da ação de **alteração de item** em `com297` (`PUT comDocProdutos`). Sem ela
a escrita 403 e a alocação para fail-closed — antes de qualquer coisa irreversível.

## Verificação pendente — a premissa de OVERRIDE

Se preencher `dprLngDescrNf` **sobrepõe** a derivação, ou se o ERP monta o `xProd` sempre a partir do
cadastro e ignora o campo.

Evidência de campo até agora (2026-08-12, doc 18790 — o que homologou depois da troca de cadastro):

- O MESMO documento passou a homologar só trocando `dpeVld1DescrNfe` de `4` para `1`.
- `dprLngDescrNf` do item continua **VAZIA** nesse documento, e a nota foi autorizada.
- As demais NDes saudáveis também têm o campo vazio.
- `Cód. DI`/`Seq. DI`/`Adição` do item estão vazios — confirma a raiz: o produto de encargo não tem
  adição de DI, então a regra "Descrição da DI" não tem de onde tirar texto.
- O visualizador de pré-descrição do ERP resolve para `PAGAMENTO ANTECIPADO` — idêntico ao texto que
  esta regra grava.

Isso estabelece que o ERP **não persiste** a descrição derivada no campo, mas **não** decide se um
campo preenchido seria respeitado. Dois modelos seguem compatíveis com tudo que foi medido:

| Modelo | `xProd` = | Esta regra |
|---|---|---|
| **Override** | campo se preenchido, senão deriva do cadastro | vale |
| **Sempre derivado** | sempre do cadastro; o campo serve a outra coisa | inerte |

O nome do campo ("Descrição **para Impressão**"), o tamanho (4000 contra 50 do nome do produto), estar
vazio por padrão e existir uma rota dedicada a *pré-preenchê-lo* apontam para override — mas não provam.

**Como fechar:** na próxima NDe travada de cliente com `dpeVld1DescrNfe = 4`, o analista digita o texto
no campo "Descrição para Impressão" do item — **sem tocar no cadastro** — e homologa. Passou ⟹ override
confirmado. Alternativa em paralelo: perguntar à NTT Data se preencher o campo sobrepõe a derivação.

Enquanto isso a regra é segura por construção: só age quando o ERP não deriva nada (caso já quebrado),
degrada em falha de leitura, é fail-closed na escrita e tem interruptor por env.
