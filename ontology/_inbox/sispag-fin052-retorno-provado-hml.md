# SISPAG fin052 — perna de RETORNO exercitada em HML (2026-08-20)

> Continuação de [`sispag-fin015-ida-provada-hml.md`](./sispag-fin015-ida-provada-hml.md).
> O ciclo `.REM → .RET → carregar → processar → baixa` foi percorrido ao vivo com um `.RET`
> **sintético**, gerado a partir do `.REM` que nós mesmos produzimos.
>
> ⚠️ **LIMITE:** um `.RET` sintético valida o NOSSO caminho e o parser do ERP. NÃO valida o
> formato real do Itaú. O pedido de um `.RET` real do banco continua aberto.

## 1. A especificação do `.RET` vem do próprio ERP

`ger015.gtbLngSql` do layout "ITAÚ PADRÃO" (bnc 4) é um PL/SQL de 20k que lê as linhas cruas
(`GER_ARQUIVO_RETORNO_LINHAS.GAR_ESP_LINHA`) por posição:

| posição | conteúdo |
|---|---|
| 8 | tipo de registro — só `'3'` (detalhe) é processado |
| 14 | segmento — `'Z'` ignorado; `'A'`, `'J'`, `'O'` têm offsets distintos |
| **74-93** (segmento A) | **a chave do item**: `filCod(2) + bncCod(4) + flpCod(7) + itsCodSeq(7)` |
| **231-240** | até **5 códigos de ocorrência** de 2 chars |

Cada código de ocorrência precisa existir em `FIN_BANCOS_ERROS` (`bncCod` + `fbeEspCod` +
`fbeVldTipo=2`), senão o arquivo INTEIRO falha com *'A SIGLA "xx" NÃO FOI CONFIGURADA'*.

Semântica (`fbeVldTpret`, via `fin050/list`): **`tpret=1` = pago** · **`tpret=2` = rejeitado**
(`FIN_ITEM_SISPAG.ITS_VLD_REJ = 1`). Para o **Itaú há exatamente UM código de sucesso: `00` =
PAGAMENTO EFETUADO** (52 códigos no total, 7 de rejeição). Bradesco tem 153, TODOS de rejeição.

## 2. A conciliação não precisa de heurística

A chave das posições 74-93 é escrita pelo ERP **na ida** e lida **na volta**. No `.REM` do lote 26:
`01000400000260000001` = filCod 01 + bncCod 0004 + flpCod 0000026 + itsCodSeq 0000001 — a chave
primária de `FIN_ITEM_SISPAG`. **A correlação `.RET` ↔ item de lote é determinística**; não é
preciso casar por valor + data + favorecido. Isso responde o gap "chave de correlação lote↔.RET".

## 3. Ferramentas validadas ao vivo
- **`carregarArquivoRetorno` ✅** — primeira validação desde julho. Upload multipart aceito
  (`gar` 2, 3 e 4), layout reconhecido, 0 erros de parse.
- **`processar` — body descoberto:** o envelope é **`{ items: [...] }`**. Sem ele, para em
  `SELECTION_ERROR / NENHUM_REGISTRO_SELECIONADO`. Ainda ausente do OpenAPI.
- **`processar` é ATÔMICO** — quando falhou na etapa da baixa, nada ficou gravado: arquivo
  seguiu em `status 1/1` e `FIN_ITEM_SISPAG_RET` vazio. Bom para tolerância a falhas: não há
  estado parcial a reconciliar.

## 4. INVARIANTE DESCOBERTA — lote e título têm que ser da MESMA filial

O `SELECT` do parser exige as duas condições simultaneamente:
```sql
FIN_ITEM_SISPAG.FIL_COD  = <filial lida do arquivo>
FIN_LOTE_SISPAG.FIL_COD  = FIN_ITEM_SISPAG.FIL_COD
```
No lote 26 o item tinha `filCod=2` (filial do TÍTULO) e `filCodLote=1`. Testado com `01` e com
`02` gravados no arquivo: **ambos falham**, por motivos opostos — com `01` o item não casa; com
`02` o item casa mas o lote não. **Nenhum valor satisfaz as duas.**

Repetido o ciclo com lote e título ambos na filial 2 (flp 12), o erro *"NÃO FOI ENCONTRADO O
ITEM"* **desapareceu** — confirmação direta.

> **Consequência para o código:** o I4 do `LotePagamentoService` hoje garante "uma filial por
> lote" olhando a filial do TÍTULO. Precisa passar a exigir `filial do título == filial do lote`,
> senão montamos lotes cujo retorno nunca processa. Ver §7.

## 5. CICLO FECHADO — o título foi quitado ✅

O `processar` primeiro parou em *"NÃO É POSSÍVEL FINALIZAR UM BORDERO COM CONTA FINANCEIRA
INATIVA. CONTA(S): 37"* — configuração de ambiente, não formato nem payload. A conta 37
(`fin004` / Plano de Contas Financeiro, "BANCO ITAÚ - AG. 2000 CONTA 35.911-3") estava com
`gerVldStatus=2`. Ativada (`=1`) pela Columbia, o ciclo fechou na hora.

**Body do `processar` (o que funciona):** o envelope é **`items[]` com a chave do arquivo**:
`{ items: [{ filCod, bncCod, gtbCodSeq, garCodSeq, tipo: 1 }] }`. Confirmado em execução limpa
(gar 5). A chave FORA de `items[]` dá `SELECTION_ERROR / NENHUM_REGISTRO_SELECIONADO`.

Estado após o processamento (lote 12, filial 2, doc 801):

| onde | evidência |
|---|---|
| arquivo `gar 4` | `garVldProcStatus = 2` (processado), 0 erros, 0 rejeitados |
| item do lote | `itsVldRej = 0` · retorno vinculado em `FIN_ITEM_SISPAG_RET` (`fstCodSeq=1`) |
| lote 12 | `flpVldConfEnvio = 1` · `itensRetorno = 1` |
| **título doc 801** | **`vldPago = 1`** · `vldPendente = 0` · `totalPago = 275` · `titMnyAberto = null` |

Ou seja: `.REM → .RET → carregar → processar → BAIXA no fin010`, ponta a ponta.

### ⚠️ `flpVldRet` NÃO é o sinal de retorno processado
Mesmo com o retorno processado e a baixa dada, o lote ficou com **`flpVldRet = 0`** e
`itensRetorno = 1`. O `ConexosSispagClient` mapeia `retornoProcessado` a partir de `flpVldRet`,
então o painel mostraria "aberto" para um lote já conciliado. **Usar `itensRetorno > 0` ou o
vínculo no item (`finItemSispagRet`), não `flpVldRet`.**

## 6. Achado de harness — conta pagadora é POR FILIAL
O harness passava a `ContaPagadora` do Itaú hardcoded (`ccoCod=1`). Na filial 2 o ERP resolveu
`ccoCod=1` para uma conta **Banestes (021), ag 01111, cc 111111** — e o `.REM` saiu com esse
header. **O serviço de orquestração precisa buscar a conta pagadora por filial**, nunca fixar.

## 7. Gaps abertos
1. ~~Ativar a conta financeira 37 em HML~~ — **FEITO** (2026-08-20). Ver §5.
2. **`.RET` real do Itaú** (Columbia) — o sintético não substitui.
3. **Invariante filial** (§4) — mudar o I4 do `LotePagamentoService`.
4. **Conta pagadora por filial** (§6) — remover o hardcode antes de qualquer escrita real.
5. **`arquivosRetornoDetalhe/list`** — exige o filtro `fbeEspCod`, mas nenhum operador testado
   (`#EQ`, `#LIKE`, `#GE`, `#IN`) satisfaz o "tipo de filtro especificado". Contornável: o
   `finItemSispagRet[Cab]/list` (lado do lote) funciona e é o caminho natural para nós.
6. **Robô de retorno já existente?** Os 23 `.RET` do Bradesco em HML foram carregados E
   processados pelo usuário `CONEXOS` — automação, não humano. Perguntar à Columbia se já existe
   ingestão automática de retorno; muda o escopo do que temos que construir.

## 8. Jobs
| job | o que faz | escreve? |
|---|---|---|
| `sintetizar-ret-fin052.ts` | gera o `.RET` a partir do nosso `.REM`; `RET_UPLOAD=1` sobe | HML, opt-in |
| `processar-ret-fin052.ts` | descobre o body e chama o `processar` | HML, opt-in |
| `probe-fin052-retorno.ts` | leitura: configs, arquivos, detalhe, lado do lote | não |


---

## 9. DEFEITO CONFIRMADO — a baixa via retorno nasce SEM conta financeira

Levantado ao olhar o `fin010`: o borderô gerado pelo retorno vem com **`gerNum` e `gerDes`
nulos**, enquanto borderôs normais da mesma filial trazem `gerNum=38` ("BANCO ITAÚ - AG. 0641
CONTA 55.795-4").

**Primeira hipótese (errada):** seria efeito de um cadastro quebrado. O harness fixava
`ccoCod=1`, e na filial 2 esse código aponta para um registro inconsistente do HML — conta
corrente **BANESTES ag 1111 cc 111111** ligada à conta financeira **37** ("BANCO ITAÚ - AG.
2000"). Foi o que produziu o `.REM` com header `021` e o erro de conta financeira inativa.

**Teste controlado:** repetido o ciclo inteiro com `ccoCod=2` — a conta Itaú de verdade
(ag 0641, cc 55795-4, `gerNum=38`). O `.REM` saiu com header **341 / ITAU**, correto.

| borderô | conta pagadora usada | `gerNum` do borderô |
|---|---|---|
| 248 | ccoCod 1 (registro quebrado, Banestes) | **null** |
| 249 | ccoCod 2 (Itaú 0641 correta, gerNum 38) | **null** |

**Conclusão: não é o cadastro.** O caminho de baixa por retorno **não propaga a conta
financeira** para o borderô, mesmo com conta pagadora bem configurada. Nos dois casos o título
foi quitado corretamente (doc 801 → 275,00; doc 813 → 6.622.898,68) e a baixa está no borderô —
mas sem `gerNum`.

**Por que importa:** relatório e conciliação por conta financeira não enxergam esses
lançamentos. O dinheiro sai e o borderô não diz de qual conta. Em produção isso vira buraco
contábil silencioso — o pagamento aparece como feito, mas não aparece no extrato gerencial da
conta.

**Ações:**
1. **Reportar à Conexos** — é comportamento do ERP, não do nosso código. Levar os borderôs 248 e
   249 do HML como evidência (mesma conclusão com conta quebrada e com conta correta).
2. **Confirmar em PRD** se os borderôs originados de retorno SISPAG também vêm sem `gerNum`. Se
   vierem, já existe hoje um passivo de conciliação na Columbia, independente da nossa automação.
3. Enquanto não houver correção, o nosso serviço precisa **registrar o vínculo lote → borderô →
   conta pagadora do nosso lado** — o que já era necessário, porque `vldHasRemessaPgto` também
   vem 0 e não marca origem SISPAG (§ item do lote com `borCod` nulo).

### Correção de rumo do harness
`validate-fin015-import.ts` não fixa mais a conta pagadora: lê do `fin005` da filial via `CCO=`.
O mesmo `ccoCod` aponta para contas DIFERENTES em cada filial — fixar foi o que causou toda esta
investigação.

### Nota operacional
O usuário do `.env` (`MPS_FRANCINEI`) bateu **`LOGIN_ERROR_MAX_SESSIONS`**: cada job abre sessão
nova e o ERP limita as simultâneas. O serviço de orquestração precisa **reusar sessão**, e vale
um usuário de robô dedicado — hoje toda escrita fica atribuída a uma pessoa real.
