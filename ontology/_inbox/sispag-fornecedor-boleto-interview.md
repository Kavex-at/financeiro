# Entrevista + tarefas — fornecedor do boleto DDA pela conta do beneficiário

> **Slug:** `sispag-fornecedor-boleto` · **Branch:** `claude/dda-fornecedor-ee46a7` · **Tipo:** feature-new
> **Modo:** as respostas da entrevista vieram prontas da sessão orquestradora (aprovadas pelo maintainer); nada
> ficou sem resposta. O desvio medido está na ADR-0081.

## Entrevista (resumo)

| Eixo | Resposta |
|---|---|
| Entidade | `FornecedorContaBoleto`: chave de conta → `pes_cod` + credor + origem + evidências, **derivada e descartável**. |
| Ação | Aprender ao fim de `BoletoDdaService.sincronizar`; enriquecer `listar` depois de `consolidar`. Leitura não escreve; nada no `bootstrapAppContainer`. |
| Invariante | `VINCULADO > CONFIRMADO > INFERIDO`; 2+ `pes_cod` na origem vencedora = ambíguo = sem nome; "provável" nos inferidos; banco sem layout validado não tem chave. |
| Integração | Só leitura local (`boleto_dda`, `titulo_a_pagar`, `sispag_decisao_sugestao_boleto`). Zero chamada ao Conexos. |
| "Confirmado" | Decisão `CONFIRMADA` em `sispag_decisao_sugestao_boleto` (anulada/rejeitada não contam). A confirmação de emissor não entra: a chave dela (`341:ag:conta`) é outra e a decisão já a implica. |

## Tarefas (todas concluídas)

1. `ContaBeneficiariaBoleto` — tabela de layouts 237/341/033/001 + testes com barras reais de PRD.
2. Migration 0093 + reverse + teste de fonte + registro no `rollbacks.test.ts`.
3. `ConsolidacaoFornecedorConta` (pura): origem mais confiável, ambiguidade, nome mais comum.
4. `FornecedorContaBoletoRepository`: `listEvidencias` (3 origens), `substituir` (transação), `listMapeamentos`.
5. `AprendizadoFornecedorBoletoService` + gancho no fim de `sincronizar` (falha = WARN).
6. `FornecedorBoletoDda` (enriquecimento) + `BoletoDdaConsolidado.fornecedor?` + busca em `PaginacaoBoletoDda`.
7. Frontend: coluna "Fornecedor" + selo "provável" (`BoletosDdaTab.tsx`, `lib/sispag.ts`) + teste.

## Fase 2 / follow-ups (NÃO implementados)

- **F1. Candidatos só do mesmo credor.** Com o fornecedor conhecido, descartar candidatos de outro `pes_cod`
  (reduz o AMBIGUO). Mexe em `ConsolidacaoBoletoDda`/`RegraSugestaoBoleto`: depois do PR da `dda-pool-limpo`.
- **F2. Boleto = soma de 2–3 títulos** (42 + 8 achados na cópia de 30/10) — liga com o grupo (ADR-0077).
- **F3. Título = soma de vários boletos** (38 achados).
- **F4. Filtro por fornecedor** na aba (exige lista de fornecedores no payload ou busca por `pesCod`); hoje só a busca de texto.
- **F5. (feito) Mais bancos:** Sicredi 748, Safra 422, Citibank 745, Caixa 104, Ailos 085 e Sicoob 756 entraram em `LAYOUTS` (layouts do worker `dda-layouts-banco`, validados em dda_prd_3010). Seguem sem layout: 329, 136, 274, 077, 755.
- **F6. Aprender também ao fim da ingestão de pagamentos.** O DDA sincroniza ANTES da carteira; a inferência usa a
  carteira da rodada anterior (defasagem de um ciclo). Um segundo gatilho em `IngestaoPagamentosService` fecha isso.
- **F7. Acúmulo.** O mapeamento é reconstruído do pool atual; um boleto que saia do `fin124` leva embora a
  evidência dele. Se virar problema, trocar `substituir` por upsert com `ultima_evidencia_em`.
- **F8. Integração real do SQL.** `listEvidencias` foi validada contra a cópia de PRD (views temporárias) mas
  não há teste de integração com Postgres no CI para ela.

## Regis-Review (escopo da feature: segurança, tolerância a falhas, desempenho) — P1/P2/P3, nada P0

- **F9 (P1, FEITO a pedido do maintainer):** `INFERIDO` só nomeia com 2+ boletos distintos (`EVIDENCIAS_MINIMAS_INFERIDO`); vínculo e decisão valem com 1.
- **F10 (P2).** `substituir` com lista vazia apaga o mapeamento inteiro. Guarda: se o novo conjunto é vazio e o
  anterior não, manter o anterior e logar WARN.
- **F11 (P3).** Sem trilha persistida do reaprendizado (só logs); `chave` guardada em claro (dado bancário de
  terceiros, não sai pela API); o aprendizado alonga a janela do lock da sincronização; `credor` nulo com `pes_cod`
  válido some silenciosamente da coluna.
- **F12 (P2, desempenho).** `enriquecer` é O(n) por `listar` (<50 ms hoje para ~24k). Memoizar `codbar → chave` ou
  coluna pré-computada se o pool passar de ~50k.
- PatternGuardian e DesignSystemReviewer: 0 violações (só a largura máxima do nome, 14rem vs 16rem, deliberada).
