# Retirada por código de barras (ADR-0069 emenda 1) — medição HML do `DELETE` de item (Task 12 / P1-5)

> Data: 2026-10-14. Harness: `src/backend/jobs/probe-hml-delete-item-inexistente.ts` (+ `hmlEnvFile.ts`,
> copiado de `chore/sispag-hml-bind-experimentos`). Roda **só em HML** (`CONEXOS_BASE_URL` com `-hml`),
> credenciais de arquivo privado (`HML_ENV_FILE`), `databaseConnectionString=""` (sem gravar sessão no
> slot do robô), 1 sessão, sequencial. Itens importados **sem código de barras**: nenhum código, real ou
> sintético, trafegou. Lote de teste: **flp 37** (fil 2, bnc 4), deixado em HML como rascunho **vazio**
> (`titulosCount = 0`, `soma = 0`). Saída bruta: `/tmp/hml-delete-item/resultados.json` (só identidade
> `docCod/titCod`, `filCod`, `itsCodSeq` e contagens).

## Resultado

| Caso | Chamada | Resposta do ERP | Efeito observado |
|---|---|---|---|
| **C1** `itsCodSeq` existente | `DELETE fin015/finItemSispag/4/37/1/2/2` | **200**, corpo vazio | item some da lista; `titulosCount` **continua 1** (já sabido: não é contagem), `soma` cai exatamente o valor do item (7 085 568,30 → 7 085 101,89 = −466,41) |
| **C2** mesmo `itsCodSeq`, já ausente | idem | **500** `RECORDNOTFOUND` — `Not Found: FinItemSispag (bncCod, filCodLote, flpCod, itsCodSeq, filCod)` | nada muda |
| **C3** `itsCodSeq` nunca existente (999999) | idem | **500** `RECORDNOTFOUND` | nada muda |
| **C4a** `filCodItem` trocado (outra filial) | `.../2/1/2` | **500** `RECORDNOTFOUND` | item **permanece** |
| **C4b** `filCodLote` trocado (path + header) | `.../2/2/1` | **500** `RECORDNOTFOUND` | item **permanece** |
| **C5** lote nativo **FINALIZADO** (flp 36) | `DELETE .../36/1/2/2` | **400** `FIN_015.IMPOSSIVEL_ALTERAR_REGISTRO_NAO_EM_CADASTRO` | item **permanece** |
| **C6** método de produção `removerItemDoRascunho` (item de `filCod` 7 num lote da filial 2) | — | não lançou | item some; `soma` do lote cai |

Q1 (identidade na leitura): o row de `fin015/finItemSispag/list` traz `filCod`, `filCodLote`, `docCod`,
`titCod` e `itsCodSeq` — confirmado ao vivo. Achado lateral: o lote nativo da filial 2 aceitou item de
`filCod = 7` (cross-filial); o `DELETE` desse item usa `filCodItem = 7` e `filCodLote = 2`, e funcionou.

## O que isto confirma (e o que não muda)

1. **O tratamento "observação vence status" está certo.** O `DELETE` de item já ausente **não é 200**: é
   **500 `RECORDNOTFOUND`**. `RetiradaCodigoBarrasService.apagarNoRascunho` já engole a falha do `DELETE`
   (log mascarado) e decide pela releitura: ausente ⇒ sucesso. Em retomada, o item só recebe `DELETE` se a
   leitura **na hora** o mostra, então o 500 de "já ausente" só ocorre numa corrida entre duas leituras.
2. **Nada de `filCod`/`itsCodSeq` errado apaga outra coisa**: chave trocada devolve `RECORDNOTFOUND` sem
   efeito (C4a/C4b). A identidade completa lida na hora (Task 3) é a única que funciona.
3. **A limpeza só funciona antes da finalização** (C5): confirma o ramo `finalizado` do
   `BoletoCodigoBarrasRetiradaIncompletaError` (lote nativo já finalizado ⇒ nada local é mexido; cancelar o
   lote nativo no Conexos e gerar de novo).
4. **`titulosCount` não serve** para "sobrou algo?" — fica em 1 enquanto houver item; a releitura da lista
   (que a guarda já faz) é a fonte. A `soma` acompanha, mas a decisão nunca depende dela.

Nenhum comportamento contradiz Task 9/10: **não reabre P0**. O status `SEM_GROUND_TRUTH` do cabeçalho do
`tasks.md` fica **fechado** por esta medição.

## Estado deixado em HML
- Lote de teste **flp 37**: rascunho vazio (`titulosCount 0`, `soma 0`). A API não apaga rascunho; descarte
  manual opcional.
- Lote **flp 36**: inalterado (o `DELETE` foi recusado).
- Títulos de teste 637/1, 520/1, 44/1 e 804/1 voltaram à carteira pendente (itens removidos do rascunho).
