# Fase B — execução REAL no Conexos HML (2026-08-03): resultado e achados

> Teste: `src/backend/routes/recebimentos.e2e.hmlWrite.integration.test.ts`
> Alocação de **R$ 123,45** no processo **186 (SKYJACK, filial 2)**, escrita LIGADA contra
> `columbiatrading-hml`. Documento real criado: **SN com299 nº 731**.

## Até onde o fluxo chegou

| Etapa | Resultado |
|---|---|
| Login + recuperação de MAX_SESSIONS | ✅ (matou a sessão mais antiga e reautenticou sozinho) |
| Pré-flight ACL (`permissoes/new/com297`) | ✅ |
| `validaProcessoPessoa` → endCodFis 1, CNPJ 13284920000120 | ✅ |
| `ConfigDocProcesso` → 11 configs; resolveu **SN-ENCOMENDA gcd 150** | ✅ |
| `validaConfigDoc` (com299) | ✅ |
| `gerDocProcesso` → **SN 731 criada** | ✅ |
| Condição de pagamento + linha de item (`comDocProdutos`) | ⚠️ gravou, mas com **condição de outro cliente** (ver Bug 1) |
| `validate/finalizacaoDocumento` + `finalizaDocumento` → HTTP 200 | ⚠️ **200, mas o doc continua `docVldFinalizado=0`** (ver Bug 2) |
| `fin014` borderô criado; `lov/TituloBorderoReceber` | ❌ **0 títulos** → fail-closed correto |
| Desfecho | `status:'error'`, `etapa:'fin014'`, `snDocCod:731`, ledger `error` — **sem duplicar nada** |

## Bug 1 (CONFIRMADO em execução real) — condição de pagamento de OUTRO cliente

`escolherCondicaoPagamento` (`RecebimentoNumerarioService.ts:510-513`) pega **a primeira condição
que contenha "DUPLICATA"** da lista devolvida por `lov/CondPgtoPessoa`. No HML esse LOV **ignora o
filtro `pesCod`** e devolve a lista GLOBAL paginada (50 linhas na 1ª página, 86 no total, ordenada
por nome).

Efeito real medido: o documento do **SKYJACK** (pesCod 232) foi gravado com
**`pgtCod 103 · "BONDUELLE - DUPLICATA"`** — condição de um cliente diferente. A condição correta
(`101 · "SKYJACK BRASIL - DUPLICATA"`) sequer aparece na primeira página do LOV.

É quase certamente a **causa raiz** da falha da finalização: o código já documenta que a com194
recusa com "CONDIÇÃO DE PAGAMENTO DIFERENTE DA SUGERIDA".

**Impacto em produção:** grava dado financeiro errado (condição de pagamento de terceiro) num
documento real e impede a geração do título.

## Bug 2 (CONFIRMADO) — a finalização diz sucesso sem ter finalizado

`finalizarDocumento` (`ConexosGerDocProcessoClient.ts:669-689`) considera sucesso quando o envelope
`messages` não traz `valid==='ERRO'`. Nesta execução ambos os POSTs voltaram **HTTP 200** e o
orquestrador avançou para o fin014 — mas a releitura do documento mostra:

```
docCod 731 · docVldFinalizado: 0 · qtdItens: 1 · docMnyValor: 123,45 · mnyTitValor: 0
```

Ou seja: **o discriminador de sucesso da finalização é insuficiente**. O correto é reler o documento
e exigir `docVldFinalizado === 1` (mesma doutrina dos outros quatro discriminadores da leg fiscal).
Sem isso a automação "acha" que finalizou e só descobre o problema uma etapa depois, com uma
mensagem que aponta para o lugar errado ("a SN não ficou finalizável").

## Confirmação fiscal (RT-001) em ambiente real

O POST real de item enviado ao ERP de homologação foi:

```json
{"filCod":2,"docTip":1,"docCod":731,"prdCod":1,"tpcCod":33,"cfoEspCod":"9999A2",
 "dprQtdQuantidade":1,"dprVldOrigMerc":9,"dprVldCstIbsCbs":"-1",
 "dprPreValorun":123.45,"prjCod":1,"ctpCod":699,"ctpDesNome":"ADIANTAMENTO DE CLIENTE ENCOMENDA"}
```

**`dprVldCstIbsCbs: "-1"` foi realmente gravado no ERP** — o gap RT-001 deixa de ser teórico: a
solução propaga CST IBS/CBS não classificado em escrita real. (E o ERP tem o dado: a grade de CFOP
do HML traz "Classificador Tributário IBS/CBS" preenchido — `5949-ND` = `000001`.)

Observação adicional: `prdCod` veio **1** (template do HML), reforçando o RT-008 (o produto do item
vem do template do ERP, não de decisão da solução).

## O que NÃO falhou (comportamento correto sob estresse real)

- **Fail-closed no fin014**: sem título, recusou baixar. Nada de dinheiro se moveu.
- **Ledger write-ahead**: `docCod 731` gravado antes do passo seguinte — um retry retomaria daí.
- **MAX_SESSIONS**: recuperação automática funcionou contra o ERP real.
- **Sem duplicação**: apenas 1 SN criada, 1 borderô (sem baixa).

## Backlog imediato (pré-requisito para a Fase B concluir)

| # | Fix | Onde | Entrada no pipe |
|---|-----|------|-----------------|
| 1 | Selecionar a condição de pagamento **do cliente do documento** (casar por `pesCod`/nome do cliente, ou ler do cadastro da pessoa), e fail-closed se não houver — nunca "primeira DUPLICATA da lista" | `RecebimentoNumerarioService.escolherCondicaoPagamento` + paginação do LOV | `/feature-tweak solicitacao-numerario "condição de pagamento do próprio cliente"` |
| 2 | Verificar `docVldFinalizado===1` relendo o documento após `finalizaDocumento` (fail-closed com mensagem correta) | `ConexosGerDocProcessoClient.finalizarDocumento` / `etapaSn` | `/feature-tweak solicitacao-numerario "verificar finalização do com299"` |
| 3 | (já mapeado) `COM297_GCD_NOTA_DEBITO_NOME` com default errado + `resolveGcdCodByName` inviável | `constants`/`EnvironmentProvider`/client | `/feature-tweak nota-debito-eletronica "resolver gcd por env, fail-closed"` |

Resíduo no HML: **SN 731** ficou não-finalizada, sem título e sem baixa (inócua). Manter como
evidência ou excluir na tela com299 — decisão do Yuri.
