---
adr_number: 0069
title: SISPAG — guarda de código de barras repetido na remessa (um código de barras, um item)
date: 2026-10-14
status: accepted
type: addition
related_entities: [LotePagamento, TituloAPagar, BoletoDda]
related_business_rules: [boleto-exige-codigo-de-barras, verificacao-ted-pix-sispag, sugestao-boleto-dda-sispag]
continues: [0040, 0063, 0068]
amended_by: ["0069#emenda-1"]
evidence:
  - ontology/_inbox/sispag-guarda-codbar-repetido-interview.md
  - ontology/_inbox/sispag-guarda-codbar-repetido-ontology-diff.md
  - "regis-review 2026-10-14-1330, F-6; followups fault-tolerance-5 (sispag-sugestao-boleto-dda-regis-followups.md)"
  - "medição PRD: 27 títulos flagados em grupos com mais títulos que boletos; caso PEDRONI fil 2, 10 títulos de R$ 1.412,00 venc. 14/10, 2 boletos"
  - "experimentos HML 2026-10-14 (branch chore/sispag-hml-bind-experimentos): o ERP não valida o DV do código digitado nem o compara com o título; importar descarta o código do payload; o código só chega ao item via PUT fin015/finItemSispag após validacao/codigoBarras + confirmaCodigoBarras"
---

# ADR 0069: guarda de código de barras repetido

**Branch:** `fix/sispag-guarda-codbar-repetido`. `/feature-tweak`. `entity_changed = true`.
**Status da implementação:** aborto (I16a–c) `implemented` (app v0.66.1, ontologia v0.40.2); **retirada automática (Emenda 1, I16d–h) `planned`** (ontologia v0.41.0).

> **Reconferido no ship (2026-10-14):** `origin/main` não avançou desde a base (último ADR 0068, ontologia
> 0.40.0 + a 0.40.1 desta branch, app 0.66.0); número 0069 livre.

## Contexto
`titVldReflexoDdaAssoc` é "existe boleto DDA com mesmo valor e vencimento", não reserva 1:1. O ERP anexa o
mesmo código de barras a cada item importado; o `.REM` pagaria o mesmo boleto N vezes. A única guarda era de
ausência (ADR-0040). A duplicidade por título (ADR-0063) não vê isso: são títulos distintos.

Achado de HML (2026-10-14): o ERP **não valida** o dígito verificador de um código digitado nem o compara
com o título; `importar` descarta o código enviado no payload; o código chega ao item só por
`PUT fin015/finItemSispag`, depois de `validacao/codigoBarras` + `confirmaCodigoBarras`. Logo o ERP não é
uma segunda linha de defesa contra código repetido ou malformado.

## Decisão
Nova invariante **I16** em `boleto-exige-codigo-de-barras`: um código de barras normalizado (44 dígitos), um
item. Checada (1) logo após `importarTitulos`, antes de `finalizarLote`, sobre `listarLinhasDigitaveisDoLote`;
(2) nos segmentos J do `.REM` em `RemessaCnabValidator`, como rede. No acerto, aborta com
`BoletoCodigoBarrasRepetidoError` (409), marca o ledger `failed`, deixa o rascunho e a analista retira o
título repetido do lote local; a retomada reaproveita o rascunho. Código presente porém inválido falha
fechado. Nada do código é persistido nem logado em claro (só mascarado). Sem permissão nova; lote manual e
automático compartilham o caminho.

**Derivação e momento.** A unicidade roda sobre o código de 44 dígitos **derivado de `itsNumCodbar` depois
que o item é final**: pós-import e, no passo 2 da ADR-0068, também pós-edição (`PUT finItemSispag`). A guarda
**não pode confiar que o ERP rejeitou** um código malformado. **É pré-requisito do passo 2 da ADR-0068 (o
bind de valor igual).**

## Rejeitado
- **Descartar o item repetido em silêncio / remover do rascunho por API:** viola human-in-the-loop; remoção
  por API não verificada. (REJECT-WORKAROUND) — **revogado pela Emenda 1**: a remoção por API foi
  verificada em HML e deixa de ser em silêncio.
- **Regra irmã `boleto-codbar-unico`:** mesmo ponto e mesmo fail-closed; vira invariante da regra existente. (REJECT-DUPLICATE)
- **Guarda entre lotes vivos e contra boleto pago:** exige hash salgado persistido + migration. Follow-up
  com ADR próprio. (REJECT-PREMATURE)

## Consequências
Pré-requisito do passo 2 da ADR-0068. Custo: 0 chamadas novas ao ERP (reusa a leitura do lote). Risco
residual: reenvio entre lotes não é detectado até o follow-up.

## Emenda 1 (2026-10-14, mesmo dia): de "abortar" para "retirar e seguir"

**Decisão do mantenedor.** Achada a repetição de código de barras, ou item BOLETO cujo código foi **lido e
descartado** (DV inválido, tamanho incorreto), a solução **retira** os itens ofensores automaticamente e
continua a remessa com o restante, informando a analista. Mantém **um** item por código (menor
vencimento, depois menor `docCod`, `filCod`, `titCod`) e retira os demais. **Ausência pura de código e
leitura incompleta continuam abortando** (P0-3(c)): podem ser falha de leitura do ERP, e leitura
incompleta nunca vira retirada.

**O que revoga.** O "Rejeitado: descartar o item repetido em silêncio / remover do rascunho por API"
cai nas duas razões: (a) a remoção por API foi **verificada** em HML (2026-10-14):
`DELETE /api/fin015/finItemSispag/{bncCod}/{flpCod}/{itsCodSeq}/{filCod}/{filCodLote}` remove um item de
lote nativo em RASCUNHO, retorna 200 sem corpo e o título volta ao grid de pendentes; lote nativo em
rascunho continua sem poder ser apagado; (b) não é "em silêncio": há evento na trilha, aviso persistente
no lote e marca de retenção visível.

**Decisões do mantenedor.**

| # | Decisão |
|---|---|
| P0-1(a) | Exceção explícita: durante `gerarRemessa` o sistema retira item de lote local `FINALIZADO`, sem mudar o status, com `versao` incrementada, evento e recálculo do total; só para código repetido ou ilegível (I16d.8). |
| P0-2(a) | Marca de retenção = extensão de `BloqueioDuplicidade` com `origem` (`DUPLICIDADE_TITULO` \| `CODIGO_BARRAS_REPETIDO` \| `CODIGO_BARRAS_ILEGIVEL`), `tituloMantido`, `codigoMascarado`, `alertaId` opcional; uma migration; condição de encerramento própria por origem (I16g). |
| P0-3(c) | Retira código **lido e descartado** ou **lido e repetido**; **aborta** na ausência pura e na leitura incompleta (I16c, I16d.2). |
| P1-1(a) | Regra vencimento → `docCod` → `filCod` → `titCod`. **Follow-up aberto, não implementado:** (b) preferir o título com decisão humana confirmada da ADR-0068 quando houver exatamente um. |
| P1-2(a) | Lote manual: mesmo comportamento. |
| P1-3(a) | Persiste só o código **mascarado** (5+4); I16e muda para "só o mascarado persiste". |
| P1-4(a) | Divergência herdada de I13j (retiradas sem marca caem em `indeterminado`) fora de escopo; watchlist. |
| P1-5 | `DELETE` de item inexistente **não medido**; a regra decide pela releitura (I16h(e)). |
| P1-6 | Encerramento automático de `CODIGO_BARRAS_REPETIDO`: título mantido pago/cancelado/fora do `fin064`; boleto do título retido mudou; lote de origem cancelado sem remessa. Sinal "boleto mudou" depende de `titVldReflexoDdaAssoc`/`fin124`; confirmar custo na implementação. |

**Mecanismo.** I16d.1–I16d.8, I16f, I16g, I16h em `boleto-exige-codigo-de-barras`. Local primeiro, ERP
depois; sucesso é a ausência observada na releitura; falha parcial fecha (nada finaliza com código
repetido restante) e a retomada termina a limpeza (etapa `limpar_retirados`, resíduo = marca `ATIVO` +
evento do sistema).

**Marca de retenção.** Extensão de `BloqueioDuplicidade`; reusa a infraestrutura de I13g (formação e
inclusão) e muda só a condição de encerramento. Nenhuma entidade nova.

**`SystemRemovalReason` (I13j).** Ganha `CODIGO_BARRAS_REPETIDO` e `CODIGO_BARRAS_ILEGIVEL`
(`CODIGO_BARRAS_AUSENTE_OU_ILEGIVEL` do rascunho da proposta **não** existe: ausência aborta).

**Consequências.** (+) a remessa do dia não para por causa do caso PEDRONI. (-) a retirada é decisão
financeira tomada por heurística: gravada, reversível, avisada. (-) uma migration. (-) exceção à máquina
de estados do lote local. A rede do `.REM` (I16b(2)) permanece abortando.

**Continua rejeitado.**

| # | Candidato | Categoria | Razão |
|---|---|---|---|
| R1 | Retirar também o item que **fica** | REJECT-WORKAROUND | Transforma duplicidade em inadimplência certa de um boleto devido. |
| R2 | Apagar lotes nativos em rascunho | REJECT-NOT-DOMAIN | Sem API (verificado); o lote vazio permanece e é reaproveitado. |
| R3 | Persistir código completo, hash ou HMAC | REJECT-PREMATURE | Serve à repetição entre lotes; watchlist. |
| R4 | Entidade `RetiradaPorCodigoRepetido` | REJECT-DUPLICATE | Trilha + `BloqueioDuplicidade` cobrem. |
| R5 | Reusar `PendenciaCadastro` | REJECT-DUPLICATE | Removida na ADR-0065; é de cadastro. |
| R6 | Reusar `AlertaItemLote` como marca | REJECT-WORKAROUND | Morre com o item; não impede o laço. |
| R7 | Retirada automática no gate do `.REM` | REJECT-WORKAROUND | Lote finalizado e arquivo gerado; só cabe abortar. |
| R8 | `DELETE` antes da transação local | REJECT-WORKAROUND | Falha entre os passos deixa item fora do ERP e dentro do lote local. |
| R9 | Usar o `200` do DELETE como prova | REJECT-WORKAROUND | Corpo vazio; item inexistente desconhecido. |
| R10 | Retirar por **ausência pura** do código (`CODIGO_BARRAS_AUSENTE_OU_ILEGIVEL`) | REJECT-WORKAROUND | Pode ser falha de leitura do ERP; retiraria itens bons (P0-3(c)). |
| R11 | Guarda entre lotes vivos / contra boleto pago | REJECT-PREMATURE | Persistir hash salgado + migration; watchlist. |

**Texto de CHANGELOG (para o ship; não aplicado aqui).**

```markdown
- **Boleto repetido não trava mais a remessa.** Quando dois ou mais títulos do mesmo lote apontam para o
  **mesmo código de barras** (um boleto DDA reservado a vários títulos de mesmo valor e vencimento), a
  remessa agora **retira os repetidos sozinha** e segue com o restante. Fica um título por boleto: o de
  menor vencimento e, em empate, o de menor número de documento. O lote mostra quais títulos saíram e
  qual ficou com o boleto, e os títulos retirados ficam retidos (aba "Títulos a pagar", selo "retido:
  boleto repetido") até o boleto deixar de ser compartilhado ou você desfazer a retenção com motivo. O
  mesmo vale para boleto cujo código foi lido e é inválido; boleto sem código nenhum continua barrando a
  remessa. Nenhum título é pago em duplicidade e nenhum código de barras completo é guardado ou exibido.
```
