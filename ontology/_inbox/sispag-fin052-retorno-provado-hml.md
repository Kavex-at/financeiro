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

## 9. A conta financeira NÃO se perde — e a rastreabilidade existe

> Esta seção substitui duas conclusões anteriores que estavam **erradas**. Ficam registradas
> porque o caminho do erro é instrutivo.
>
> - ❌ *"O caminho de baixa por retorno não propaga a conta financeira — defeito do ERP,
>   reportar à Conexos."* Baseado em duas amostras do nosso fluxo sintético e na coluna vazia
>   do grid do `fin010`.
> - ❌ *"É o parâmetro `filVldSugContabaixa`, desligado em HML."* A comparação HML × PRD lia
>   `ger008/list` e pegava `rows[0]` — que pode ser de **filiais diferentes** em cada ambiente.
>   Lendo `ger008/{filCod}` corretamente, o parâmetro é **1 nos dois**.

### O que é verdade
A linha de detalhe do retorno (`arquivosRetornoDetalhe`) do nosso ciclo (gar 5, lote 13):

```
flpCod=13  itsCodSeq=1        ← o item do lote
borCod=249 bxaCodSeq=1        ← o borderô e a baixa
gerNum=38  gerDes="BANCO ITAÚ - AG. 0641 CONTA 55.795-4"   ← a CONTA FINANCEIRA
fbeEspCod="00" "PAGAMENTO EFETUADO"
ardEspObs="BORDERO: 249 - DATA DE CREDITO: 04/10/2026"
```

**A conta financeira está registrada e correta.** O que acontece é que a *linha do borderô* no
grid do `fin010` não a exibe — mas o dado existe e é consultável pelo detalhe do retorno.
Não há buraco contábil, não há o que reportar à Conexos.

**E a rastreabilidade lote → borderô existe**, na mesma linha: `flpCod` + `itsCodSeq` +
`borCod` + `bxaCodSeq`. A afirmação anterior de que "não existe no ERP" também estava errada —
ela existe justamente no endpoint que eu não conseguia ler.

### `arquivosRetornoDetalhe/list` — DESBLOQUEADO
O filtro exigido é o **código exato** do evento bancário:
```json
{ "bncCod#EQ": 4, "gtbCodSeq#EQ": 1, "garCodSeq#EQ": 5,
  "fbeEspCod#EQ": "00", "fbeVldTipo#EQ": 2 }
```
Por que resistiu 7 meses: **arquivo não processado não tem linha de detalhe**. Todas as
tentativas anteriores foram contra arquivos em `garVldProcStatus=1` (carregado), então nenhum
código devolvia linha — e o `REQUIRED_FILTER_ERROR` de fundo mascarava isso. Com um arquivo
processado (`=2`), `fbeEspCod#EQ='00'` devolve na hora. Operadores abrangentes (`#IN`, `#LIKE`)
continuam recusados: tem que ser código a código.

`finItemSispagRet[Cab]/list` (lado do lote) também passou a devolver linha — mas traz só a
chave; o detalhe rico está no `arquivosRetornoDetalhe`.

### Lição de método
Três conclusões erradas seguidas tiveram a mesma causa: **inferir de ausência**. Coluna vazia no
grid, `count=0` numa lista, `rows[0]` de uma lista não filtrada. Em ERP, ausência quase sempre
significa "olhei no lugar errado", não "não existe".
