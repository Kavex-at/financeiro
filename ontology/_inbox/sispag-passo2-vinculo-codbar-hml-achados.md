# Passo 2 (ADR-0068 / ADR-0071) — achados V1–V9 em HML (2026-10-14)

> Job: `src/backend/jobs/probe-hml-vinculo-codbar-v1.ts` (3 execuções no mesmo dia, 1 sessão por
> execução, base `columbiatrading-hml`, credencial de `HML_ENV_FILE`, `databaseConnectionString=""`).
> **Client de produção** (`ConexosSispagWriteClient`) em toda chamada ao ERP; `VinculoCodigoBarrasService`
> real no caso guiado pelo serviço (L2); só os repositórios são em memória. Códigos de barras
> **sintéticos** (DV válido) — nenhum boleto real; este arquivo só carrega a máscara 5+4.
> Lotes de teste deixados em HML (a API não apaga rascunho): **flp 38** (rascunho), **39** (finalizado,
> `PG141061.REM`), **40** (finalizado, `PG141070.REM`), **41** (rascunho; finalizar recusado — V4b).

## 0. Limites do HML (medidos) — o que o job NÃO pôde reproduzir

| Limite | Efeito |
|---|---|
| 278 pendentes na filial 2, **todos vencidos há meses exceto o título 637** (venc. 24/10) | A janela I17c (`0 ≤ Δ ≤ 5`, barra ≥ data de débito) só é satisfeita **por um** título. O caso guiado pelo **serviço** usa o 637; os demais itens usam a **mesma sequência do client** (`validar → confirmar → PUT` + releitura) **sem** o portão de elegibilidade, com a data da barra no futuro (como no lote 36 do experimento anterior). |
| **Nenhum** título com `titVldReflexoDdaAssoc = 1` | O "1 DDA do ERP" do V1 não é reproduzível; o V1 mede 3+ vinculados e a guarda I16 sobre eles. |
| Não se editou cadastro de título em HML (`fin026`) | Pedido de alteração de vencimento foi **negado pelo classificador de permissões** (modifica recurso compartilhado fora do escopo T17); não contornado. |
| HML não tem o banco 329 cadastrado | V7/329 devolveu `FIN_015.BANCO_NAO_CADASTRADO` (recusa determinística de negócio, tratada como `retirar`). |

## 1. Resultados

| # | Resultado | Evidência (resumo) |
|---|---|---|
| **V1** | **OK** — 3 itens 341 vinculados pela sequência do client, todos **observados na releitura**; guarda I16 sobre o conjunto: 0 repetidos, 0 ilegíveis; `finalizar` e `gerarRemessa` passam; **segmentos J** (6 itens no lote 40) trazem barra, valor do título, valor de pagamento e **data de pagamento = data da barra**; `vencimento` do J = vencimento do **título** (não da barra). Item guiado pelo **serviço** (título 637, Δ +5): vinculado, evento `VINCULO_APLICADO`, J com a barra e o valor do vínculo (no lote 39 o J carregou a barra "alheia" porque o V3 rodou antes da remessa; ver §3). | `resultados-run1/2.json` |
| **V2** | **OK** — `PUT` repetido com o mesmo payload: 200 e item igual. `PUT` sobre item que **já tem** barra: **aceito e substitui** (o ERP não protege). Serviço: reexecução com o item já vinculado ⇒ **0 PUTs**. | run 1/2 |
| **V3** | **OK (comportamento do ERP medido)** — **não há lock otimista**: um `PUT` com a row antiga (sem barra) **sobrescreveu** a barra gravada por "terceiro" entre a leitura e o `PUT`. Serviço: com o terceiro já gravado, `ItemEditadoPorTerceiroError` (nada sobrescrito). | run 1/2/3 |
| **V4** | **MEDIDO — muda o desenho.** Barra de **outro banco** (237, 104) com o item/validação em modalidade **6** ⇒ `FIN_015.TITULO_NAO_PERTENCE_AO_BANCO_EM_USO` na **validação**. Com modalidade **7** (na validação, no confirma **e** no item) ⇒ aceito; releitura: `itsVldModalidade = 7`, banco/nome do confirma. **V4b:** confirma com 7 mas `PUT` com a row intacta (6) ⇒ `PUT` aceito, item fica **6** e o `finalizar` **recusa** ("A MODALIDADE DO TÍTULO … É PRÓPRIA E O BANCO FAVORECIDO NÃO É O MESMO DA REMESSA"). **Logo o `PUT` precisa de um 6º campo (`itsVldModalidade = 7`) quando banco do código ≠ banco do lote.** O J do .REM com barra 237/104 sai normal (banco na barra preservado). | run 2/3 |
| **V5** | **OK — I17i CONFIRMADA** — `PUT` em item de lote **FINALIZADO** é recusado: `FIN_015.IMPOSSIVEL_ALTERAR_REGISTRO_NAO_EM_CADASTRO` (mesma família do `DELETE`). A premissa deixa de ser "assumida". | run 2 |
| **V6** | **NÃO OBSERVÁVEL em HML** — o boleto sintético não existe no pool `fin124` e não há retorno bancário: não dá para ver se o boleto reaparece "livre" depois do pagamento. **Segue aberto** (V-PRD). | — |
| **V7** | **OK (237, 104) / recusa determinística (329)** — `splitCodBar` devolvido como lista de 7–8 segmentos; confirma devolve o banco da barra (`237 BRADESCO`, `104 CAIXA ECONÔMICA`). 329: `FIN_015.BANCO_NAO_CADASTRADO` (HML). | run 2/3 |
| **V8** | **OK — achado relevante** — `fin064.totalAberto` **difere** do `titMnyValor` do grid de pendentes em 5–7 de 40 títulos lidos (ex.: 44/1 aberto 3000,00 × 1086,40; 285/1 aberto 2663,07 × 4,30; vários com aberto 0). **Confirma que a igualdade I17b tem que ser contra o `totalAberto` AO VIVO** e que o valor do grid/carteira local **não** é o aberto (o `shadow`, que usa a carteira local, é só indicativo). | run 1/2/3 |
| **V9** | **OK** — `finalizar` aceita item com barra = data de débito (R2, igualdade) e barras com data até +10 dias do débito. Data de pagamento do item = data da barra. | run 2 |

## 2. O que muda no código (aplicado nesta entrega)

1. **Modalidade do item (V4).** `executar` recebe `bancoLote` (FEBRABAN da conta pagadora). Banco da
   barra = banco do lote ⇒ modalidade `6`; senão `7` — usada na **validação, no confirma e no item**
   (`itsVldModalidade` entra como 6º campo do `PUT`, só nesse caso). A releitura confere também a
   modalidade. Sem `bancoLote`, mantém a da linha (compat.).
2. **Releitura imediatamente antes do `PUT` (V3).** O ERP não tem lock otimista e o `PUT` leva o item
   inteiro: a row do `PUT` é a lida **agora**; código presente ⇒ `ItemEditadoPorTerceiroError`.
3. Recusa de negócio (4xx) na validação/confirma/`PUT` (`BANCO_NAO_CADASTRADO`, `TITULO_NAO_PERTENCE…`)
   ⇒ determinística ⇒ `retirar` (I17g(3)); nunca `Incompleto`.

## 3. Pontos em aberto / riscos residuais

- **TOCTOU residual (V3):** entre a releitura imediata e o `PUT` ainda há uma janela de milissegundos
  sem proteção do ERP. A observação na releitura pós-`PUT` a detecta (código ≠ esperado ⇒ terceiro),
  mas o `PUT` do terceiro, se ocorrer nessa janela, é sobrescrito. Aceito: o serviço corre em série,
  sob lock por lote, e o rascunho de remessa não é editado por outra pessoa na prática.
- **V6** (reuso do boleto no pool depois do pagamento) e **V-PRD1/V-PRD2** (permissão do robô para o
  `PUT`; ação em PRD com 1 título controlado) **seguem abertos**: o `on` em PRD continua proibido.
- Não houve título DDA em HML: a convivência "1 DDA do ERP + 2 vinculados" no mesmo lote foi coberta
  só por teste unitário (`RemessaService.test.ts`, desempate por decisão humana).
- O J do lote 39 (serviço) saiu com a barra "alheia" porque o terceiro foi simulado **antes** da
  geração da remessa no execução 1; o J do **vínculo** correto está provado pelo lote 40 (client) e
  pelo evento/releitura do serviço no lote 39.
