# Medição HML — vínculo com data divergente (ADR-0078)

## V10 — 2026-10-26, `probe-hml-vinculo-data-divergente.ts` (sem lote, sem escrita persistente conhecida)

Barras sintéticas de R$ 100, banco 341 (= banco do lote), vencimento de título fictício 15/11/2026, filial 2, banco 4.
Saída bruta: `/tmp/hml-vinculo-data-divergente/v10.json` (modalidade 6) e `v10-modalidade7.json`.

| Caso | Δ (barra − título) | Barra vence | `validacao` (barraDtaVencimento) | `confirma` → `itsDtaPgtoResult` | Resultado |
|---|---|---|---|---|---|
| V10m5 | −5 | 10/11 | 10/11 | 10/11 (= barra) | aceito |
| V10m2 | −2 | 13/11 | 13/11 | 13/11 (= barra) | aceito |
| V10m1 | −1 | 14/11 | 14/11 | 14/11 (= barra) | aceito |
| V10p0 | 0 | 15/11 | 15/11 | 15/11 (= barra) | aceito |
| V10p6 | +6 | 21/11 | 21/11 | 21/11 (= barra) | aceito |
| V10p10 | +10 | 25/11 | 25/11 | 25/11 (= barra) | aceito |

**Achados**
1. O ERP **não compara a barra com a data do título**: aceita Δ de −5 a +10 e devolve sempre a data da **barra** como data do item. Confirma a premissa do ADR-0078 (o item acompanha a barra).
2. Com modalidade **7** e barra do banco 341 (mesmo banco do lote), o `confirma` recusa os 6 casos com
   `FIN_015.TITULO_DEVE_SER_MODALIDADE_TITULO_PROPRIO`; com modalidade **6** aceita. A modalidade depende de o banco da barra ser o do lote (já conhecido: 7 só quando o banco do código ≠ banco do lote). Não tem relação com a data.

## V11 e V12 — 2026-10-26, `probe-hml-vinculo-data-divergente-rem.ts` (+ `-remessa.ts`), modalidade 6

Lotes de teste deixados em HML: **53** (finalizado, com remessa PG261002.REM), **54** e **55** (rascunhos que o `finalizar` recusou).
Títulos consumidos: docs 284, 232, 640, 642 (use `JA_USADOS=284,232,640,642`). Saída bruta em `/tmp/hml-vinculo-data-divergente/`.

| Lote | Débito | Item (barra vence) | `finalizar` | Leitura |
|---|---|---|---|---|
| L-J (53) | 27/10 | 29/10 e 03/11 | **aceito** | débito ≤ min(`itsDtaPgto`) passa; `itsDtaPgto` relido = barra |
| L-R2 (54) | 03/11 | 28/10 | **recusado** | "EXISTEM TÍTULOS QUE IRÃO VENCER ANTES DA DATA DE PAGAMENTO DESTE LOTE" (R2) |
| L-ROLAGEM (55) | 03/11 (terça, depois de Finados) | sábado 31/10 | **recusado** | mesma mensagem: o ERP compara a data **sem rolar** ao dia útil |

**V12 — segmento J do `.REM` (lote 53, 2 itens):**

| J | Vencimento (J) | Data de pagamento (J) |
|---|---|---|
| 1 | 18/12/2025 = vencimento do **título** | 29/10/2026 = vencimento da **barra** |
| 2 | 10/12/2025 = vencimento do **título** | 03/11/2026 = vencimento da **barra** |

**Achados**
1. **R2 confirmada:** `dataDebito ≤ min(itsDtaPgto)` no `finalizar`, e `itsDtaPgto` = data da barra.
2. **Rolagem de sábado: NÃO conclusiva.** O lote 55 usou débito na terça 03/11 porque segunda 02/11 é feriado (Finados), e foi recusado. Isso é compatível com (a) o ERP **não rolar** a data, e com (b) o ERP rolar só até a segunda (ignorando o feriado). **Não distingue as duas.** Para decidir, repetir com um sábado cuja segunda seguinte seja dia útil (débito = essa segunda). Enquanto isso, a regra segura é a que já está no ADR-0078 (fail-closed): débito ≤ data da barra **sem rolar**, de modo que barra de sábado/feriado puxa o débito para o dia útil anterior.
3. **O J mistura as duas datas:** o campo *vencimento* leva a data do **título**; a *data de pagamento* leva a da **barra**. O código de barras do mesmo J carrega o fator da barra. Em HML não há banco, então **não se sabe se o banco recusa J com vencimento ≠ fator do código**. Esse é o risco que decide o `on` do caminho novo.
4. O número da remessa deve ser o sugerido pelo ERP (`sugerirRemessa`); chutar deu `NUMERO_DE_REMESSA_JA_USADO`.

## Resíduo em HML (2026-10-26)

- Lotes de teste: **53** (finalizado, remessa `PG261002.REM`), **54** e **55** (rascunhos; o client não cancela lote).
- Títulos consumidos: docs **284, 232, 640, 642** (`JA_USADOS=284,232,640,642`).
- Nada foi enviado a banco; nenhuma escrita em PRD.
- Em aberto: o banco recusa J com vencimento ≠ fator do código? Só um boleto real pequeno em PRD responde; a flag
  `SISPAG_BIND_CODBAR_DATA_DIVERGENTE_FILIAIS` fica `off` até lá (ADR-0078, emenda 2026-10-26).

## V11/R8 — rolagem de sábado, 2026-10-27 (`probe-hml-vinculo-data-divergente-rem.ts`, `CASOS=L-ROLAGEM SABADO=2026-11-07`)

Autorização do maintainer na sessão de 2026-10-27. Só o caso L-ROLAGEM; nenhuma remessa gerada; nada enviado a banco.

| Tentativa | Lote | Débito | Item (barra vence) | Modalidade | `finalizar` | Leitura |
|---|---|---|---|---|---|---|
| 1 | **67** | seg 09/11 | 839/1, sáb 07/11 | 7 | recusado: "FALTA O CÓDIGO DE BARRAS DE ALGUM PAGAMENTO" | **inválida**: `confirmaCodigoBarras` recusou `FIN_015.TITULO_DEVE_SER_MODALIDADE_TITULO_PROPRIO` (barra do banco 341 = banco do lote exige modalidade 6, já medido em V10) |
| 2 | **68** | seg 09/11 | 841/1, sáb 07/11 (`itsDtaPgto` relido 07/11) | 6 | **aceito** | o ERP compara o débito com a barra de sábado **rolada** para a segunda |

**Achado (fecha a R8):** com débito na segunda 09/11 e item com data no sábado 07/11, o `finalizar` aceita; a regra
"débito ≤ min(`itsDtaPgto`)" usa a data da barra **rolada ao dia útil seguinte**. Somado ao lote **55** (sábado 31/10,
débito terça 03/11, recusado; segunda 02/11 = Finados), a leitura consistente é: o ERP **rola fim de semana para a segunda,
mas não considera o feriado de Finados** (se considerasse, 31/10 rolaria para 03/11 e o lote 55 passaria). Não medido: outros
feriados nacionais/bancários e boleto vencendo em feriado de dia de semana.

**Consequência para a regra (aplicada: ADR-0078, emenda 2026-10-27 R8, decisão do maintainer):** o fail-closed atual do ADR-0078 ("débito ≤ data da barra **sem
rolar**") é mais restrito do que o ERP. Pode ser relaxado para "débito ≤ data da barra rolada **só sobre sábado/domingo**";
rolar com o `BankingCalendar` (que pula feriados) seria **errado** nos feriados, como o lote 55 mostra. Mudança de regra
Decidida pelo maintainer em 2026-10-27 e registrada no ADR-0078 e na I8c; o código da janela (`DataCandidataItem`) ainda rola com feriados e fica como follow-up `r8-rolagem-fim-de-semana` antes da Fase 2.

**Resíduo em HML:** lote **67** (rascunho, item 839/1 sem barra) e lote **68** (finalizado, item 841/1, sem remessa).
Títulos consumidos: **839, 841** (somar ao `JA_USADOS`: `284,232,640,642,839,841`). Saída: `/tmp/hml-vinculo-data-divergente/v-sabado-tentativa1.json`
e `v11-v12.json`; logs `/tmp/hml-vinculo-data-divergente-sabado.log` e `-sabado-2.log`.
