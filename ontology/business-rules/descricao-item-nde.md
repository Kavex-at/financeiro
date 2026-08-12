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
2. Item com `dprLngDescrNf` **não-vazia** ⟹ **no-op**. É a esmagadora maioria das emissões.
3. Item com `dprLngDescrNf` vazia ⟹ resolver o texto (precedência abaixo), ler a linha INTEIRA e
   regravá-la por **read-modify-write** (`PUT com297/comDocProdutos`, objeto completo, tentativa única).
4. **Sucesso ⟺ o eco traz `dprLngDescrNf` não-vazia.** HTTP 200 não é sucesso.
5. O cadastro do cliente (`cmn025`) **nunca** é escrito.

### Precedência do texto

| # | Fonte | Por quê |
|---|---|---|
| 1 | `NDE_DESCRICAO_ITEM_FALLBACK` (env) | Escape do fiscal, se ele quiser OUTRO texto. Normalmente ausente. |
| 2 | `preDescrProdutoNf` do próprio ERP | Respeita a regra do cadastro quando ela produz algo. Best-effort: nunca derruba a etapa. |
| 3 | `prdDesNome` da própria linha | O texto que o ERP produziria com o cadastro em "1 - Descrição Produto" — reproduz **byte a byte** o workaround manual. |
| 4 | `NDE_GERACAO_DEFAULTS.produtoNome` | Último recurso, se nem o join do produto vier. |

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

## Verificação pendente

Se o ERP monta o `xProd` a partir do `dprLngDescrNf` **gravado** ou o **recalcula** na homologação a
partir do cadastro. Evidência de campo (2026-08-12): o MESMO documento passou a homologar só trocando
o cadastro do cliente — o que é compatível tanto com "recalcula e ignora o gravado" (regra inerte)
quanto com "recalcula só quando o campo está vazio" (regra vale). A sonda read-only
`recebimentos.e2e.descricaoNfeNde.integration.test.ts` discrimina: basta ler o `dprLngDescrNf` do
documento que homologou após a troca. Não-vazio ⟹ o campo é o portador e a regra vale.
