---
name: confirmarSugestoesEmConjunto
type: action
entity: DecisaoSugestaoBoleto
ontology_version: "0.51.0"
implementation_status: implemented
status: draft
owners: [yuri]
related_files:
  - "src/backend/domain/service/sispag/ConfirmacaoEmConjuntoService.ts"
  - "src/backend/domain/service/sispag/RegraIrmaosConjunto.ts"
  - "src/backend/domain/service/sispag/BoletoSuggestionService.ts"
  - "src/backend/domain/service/sispag/AjusteCentavosTituloService.ts"
  - "src/backend/routes/sispag.ts"
  - "src/frontend/app/sispag/components/ConfirmacaoEmConjuntoSecao.tsx"
last_review: 2026-10-29
preconditions:
  - "Usuário com `sispag:executar`; identidade do JWT (nunca `sistema`)."
  - "1 a 30 linhas (`CONFIRMACAO_CONJUNTO_MAXIMO`); acima disso 422 sem confirmar nada; repetidas contam uma vez."
  - "Cada linha: irmão elegível pela I15t(1), relido ao vivo (mesmo pesCod e filial do título de origem; candidato confirmável com NUMERO_CONFIAVEL; exigeReconhecimento = NENHUM; sem decisão CONFIRMADA; fora de grupo confirmado e de lote local finalizado)."
  - "Cada linha: as pré-condições de `confirmarSugestaoBoleto`."
postconditions:
  - "Por linha, independente: CONFIRMADA (decisão nova), JA_CONFIRMADA (idempotente, I15j) ou RECUSADA com motivo pt-BR. Nunca tudo-ou-nada."
  - "Cada decisão é idêntica à do confirmar individual; o evento DECISAO_CONFIRMADA leva `detalhe.conjunto = { id, tituloOrigem }`."
  - "Título, lote e ERP intactos pela confirmação (I15a, I15b)."
side_effects:
  - "Escrita local, uma transação por linha, em sequência; um cenário do motor recalculado do banco por pedido (D9), título, boleto e decisões relidos por linha."
  - "Depois do commit de cada linha: ajuste de centavos de hoje (I18g, ADR-0074), um pedido por título, numa fila sequencial do conjunto (nunca N renegociações simultâneas no fin070). Pares da faixa (centavos e +1..+5 dias) não se ajustam (I18a(4) inalterada): aviso FAIXA_AJUSTE_MANUAL."
---

# confirmarSugestoesEmConjunto

ADR-0080, invariante **I15t** (`implemented`, app v0.78.0). A partir da gaveta de um título, a analista marca os títulos
irmãos (mesmo credor, mesma filial) cujo boleto foi escolhido pela âncora de número (I15s) e confirma
todos de uma vez. Nada vem marcado.

## Leitura

`GET /sispag/sugestoes-boleto/titulo/irmaos?filCod=&docCod=&titCod=` (`sispag:ver`). Linhas elegíveis
pela I15t(1), o título de origem primeiro quando é elegível: título, nº do documento, nº do boleto,
valores, Δvalor com sinal, Δdias, tier, avisos `FAIXA_AJUSTE_MANUAL` e `ESCOLHIDO_SO_PELO_NUMERO`
(I15t(5)) e se o ajuste automático de centavos vai rodar. Vem do cache do cenário; quem decide é a
escrita.

## Escrita

`POST /sispag/sugestoes-boleto/confirmar-em-conjunto` (`sispag:executar`), corpo validado com Zod:
`{ origem: { filCod, docCod, titCod }, itens: [{ filCod, docCod, titCod, ddcCod, ditCod }] }`.
Resposta 200: `{ conjuntoId, resultados: [{ chave, status, motivo? }], confirmadas, recusadas }`.
422: corpo inválido ou mais de 30 linhas.
