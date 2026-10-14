# Passo 2 (ADR-0068) — achados dos experimentos em HML (2026-10-14)

> Harnesses: `src/backend/jobs/probe-hml-validacao-codbar.ts`, `probe-hml-importar-codbar.ts`,
> `probe-hml-editar-item-codbar.ts`, `probe-hml-diff-item.ts` (+ `hmlEnvFile.ts`). Todos recusam base
> não-HML; credenciais de HML vêm de arquivo privado (`HML_ENV_FILE`). Códigos de barras
> **sintéticos** (DV mod 11 válido, banco 341): nenhum boleto real. Lote de teste `flp 35` e `flp 36`
> ficaram em HML como rascunho (a API não apaga rascunho).

## 1. O que descobrimos

| # | Achado | Evidência |
|---|---|---|
| 1 | **`importar` DESCARTA o código de barras.** `titEspCodbar` e/ou `itsNumCodbar` no corpo de `titulosPendentes/importar` voltam vazios no item (`vldVinculoDda = 0`). Passar a barra na importação **não funciona**. | G2/G3: item importado com `itsNumCodbar=""` |
| 2 | **O caminho do ERP é editar o item depois**: `PUT fin015/finItemSispag` com a linha digitável (47 dígitos) grava `itsNumCodbar`. O ERP não define `vldVinculoDda` (fica 0): não é associação DDA, é digitação. | H1/H2: itens com 47 dígitos após o PUT |
| 3 | **`validacao/codigoBarras` é só decodificador**: devolve valor e vencimento da barra (`barraVlrPgto`, `barraDtaVencimento`, `splitCodBar`). **Não compara com o título**, não pergunta e não recusa diferença de valor ou de data. Também **não valida o DV**: um DV corrompido volta SUCESSO com valor absurdo (R$ 89.012.340,00). Só recusa comprimento ≠ 44/47 (`FIN_015.CODIGO_BARRA_INVALIDO`). | C1–C10 |
| 4 | **`confirmaCodigoBarras` exige o `splitCodBar` da etapa 1** e devolve `itsMnyVlrPgtoResult = valor da barra + juros − desconto` e `itsDtaPgtoResult = vencimento da barra`, mais banco (`itsBncNumCodbancoResult`, `itsBncDesNomeResult`). Juros **soma** ao valor da barra; não concilia. | C1–C8, H2 (juros 0,01 ⇒ 1028,82) |
| 5 | **A data que o ERP usa para pagar é a da barra.** Barra com vencimento depois do título ⇒ `itsDtaPgto` acompanha a barra; barra vencida ⇒ data no passado (R1 do finalizar barra). | C5–C8 |
| 6 | **O item só fica "completo" com banco da barra**: precisa de `itsNumBanco` e `bncDesNome` (do resultado do confirma). Sem eles: "EXISTEM ITENS COM DADOS INCOMPLETOS". | diff vs lote 26 |
| 7 | **Controle do ERP no `finalizar`:** "ITEM DE PAGAMENTO COM VALOR DE PAGAMENTO MAIOR QUE O VALOR EM ABERTO DO TÍTULO". Boleto **acima** do título (o caso NELSON, +R$ 0,01) **não finaliza** com o título como está. Boleto abaixo/igual passa essa checagem. | H2 com 1028,81 > 1028,80 |
| 8 | A pergunta `FIN_041.PESSOA_FAVORECIDA_SEM_CONTA_ATIVA_NO_BANCO_MODALIDADE_ALTERADA_TITULO_PROPRIO` aparece também **sem barra** (G1): é do favorecido (sem conta ativa no Itaú), não da barra. Já é tratada como decisão humana no `RemessaService`. | G1 |

## 2. O que isto muda no passo 2

- **Não existe "colar a barra no import".** O bind é uma sequência: importar o título → `validacao/codigoBarras`
  → `confirmaCodigoBarras` → `PUT fin015/finItemSispag` (barra, banco, valor, data do resultado) → finalizar.
- **O ERP não valida nada do que importa para nós** (DV, valor contra título, data contra título). Toda
  verificação de DV, valor e data é **nossa**, antes do PUT (e já existe `RemessaCnabValidator` depois).
- **Boleto acima do título não passa no `finalizar`.** Para o caso mais comum medido (NELSON, +R$ 0,01),
  o ERP espera que o **título** carregue a diferença (acréscimo) — ver §3.
- A associação não vira `vldVinculoDda`; o vínculo vive na nossa decisão (`DecisaoSugestaoBoleto`).

## 3. Resultado dos testes seguintes (mesma data)

| # | Achado | Evidência |
|---|---|---|
| 9 | **`PUT fin026` é aceito mas NÃO altera o valor do título**: `titMnyValor` volta 1028,80 após enviar 1028,81; o DTO da tela (`FinTituloFin026`) não tem campo de juros nem desconto. `fin064` mostra `totalAberto = totalLiquido = valor` e nenhum campo de juros preenchido. | `probe-hml-fin026-titulo.ts` |
| 10 | **Nenhum campo do ITEM destrava boleto acima do título.** Testados: `itsMnyOutros = 0,01`, `itsMnyValor = pagamento`, `itsMnyValor + titMnyValor + titMnyLiquido`, `titMnyJuros`. O `finalizar` continua recusando: a comparação é com o valor em aberto do TÍTULO (`fin064.totalAberto`), não com o item. `titMnyValor`/`titMnyJuros` do item são espelho: o PUT não os persiste. | `probe-hml-item-variantes.ts` |
| 11 | **Ponta a ponta com barra de MESMO valor funciona**: editar item → `finalizarLote` OK → `gerarRemessa` sucesso → segmento J com barra, `valorTitulo`, `valorPagamento` iguais ao item e `dataPagamento` = data do item. | `probe-hml-editar-item-codbar.ts` (FINALIZAR=1, DV2=0) |
| 12 | **Barra que vence DEPOIS do título (+5 dias)** também finaliza: no J, `vencimento` continua a data do TÍTULO (09/10), `dataPagamento` é a do item/barra (29/10) e o valor é o da barra. A barra carrega uma data diferente do campo de vencimento do registro. | segmento 3 do lote 36 |

## 4. O que isto fecha para o passo 2

1. **Viável via SISPAG (fin015):** boleto de valor **igual** ao título em aberto, com vencimento igual ou
   posterior (AR SOLUÇÕES, os "valor+dia iguais que o ERP recusou"). Sequência: importar → validar →
   confirmar → `PUT` do item (barra 47 díg., `itsNumBanco`, `bncDesNome`, valor e data do resultado) →
   finalizar. Verificações de DV, valor e data são NOSSAS (o ERP não faz).
2. **NÃO viável pelos endpoints que testamos:** boleto **acima** do valor em aberto (NELSON, +R$ 0,01:
   93 de 94). O ERP só aceita se o título tiver saldo em aberto ≥ pagamento, e não encontramos campo do
   título nem do item que o aumente (`fin026` não altera valor; sem juros no DTO). Precisa de um processo
   do ERP que ainda não conhecemos (acréscimo/juros no título, baixa com juros) ou pagamento fora do
   SISPAG. **Pergunta para a Columbia/Conexos.**
3. Boleto **abaixo** do título: não testado (provavelmente passa a trava, deixa saldo em aberto).
4. O vínculo DDA do ERP (`vldVinculoDda`) não é gravado por este caminho: a verdade fica na
   `DecisaoSugestaoBoleto`.

## 5. Estado deixado em HML
- Lotes de teste `flp 35` (vazio) e `flp 36` (**finalizado**, com remessa `PG1410…93.REM` gerada).
- Títulos de teste 757/1, 636/1 e 619/1 ficaram nesse lote. `fin026`: nenhuma alteração persistiu.
- Item 636/1 voltou a barra de valor igual (1028,80).

## 6. Pendente
- Pergunta ao Conexos/Columbia sobre boleto acima do título (como registram acréscimo antes do envio).
- Permissão do robô CLONEX em PRD para `PUT fin015/finItemSispag` (e validar que o `PUT` não precisa de
  perfil extra).
- Tratar a pergunta do ERP `PESSOA_FAVORECIDA_SEM_CONTA_ATIVA…` no fluxo (decisão humana, como hoje).
