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

## 5. Onde o ciclo parou (dado de HML, não código)

Com a filial correta, o `processar` percorreu tudo — achou o item, montou a fila de baixa e
chegou a **finalizar o borderô no fin010** — e parou em:

> NÃO É POSSÍVEL FINALIZAR UM BORDERO COM CONTA FINANCEIRA INATIVA. CONTA(S): 37

É **configuração do ambiente**: a conta financeira 37 está inativa em HML. Não é formato, não é
payload, não é o nosso código. Para fechar a baixa ponta-a-ponta, alguém da Columbia precisa
ativar essa conta financeira (ou indicar a conta correta) no HML.

## 6. Achado de harness — conta pagadora é POR FILIAL
O harness passava a `ContaPagadora` do Itaú hardcoded (`ccoCod=1`). Na filial 2 o ERP resolveu
`ccoCod=1` para uma conta **Banestes (021), ag 01111, cc 111111** — e o `.REM` saiu com esse
header. **O serviço de orquestração precisa buscar a conta pagadora por filial**, nunca fixar.

## 7. Gaps abertos
1. **Ativar a conta financeira 37 em HML** (Columbia) — destrava a baixa ponta-a-ponta. **P0** para fechar o ciclo.
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
