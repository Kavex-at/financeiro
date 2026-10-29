# sispag-confirmar-em-conjunto — diff de ontologia (proposto, aguarda aprovação do Yuri)

`entity_changed = true` (ação nova, invariante nova). Ontologia **0.50.0 → 0.51.0**. ADR **0080**.
Sem entidade nova, sem estado novo, **sem migration** (o id do conjunto vai no `detalhe` JSONB do evento).

## 1. Invariante nova I15t em `business-rules/sugestao-boleto-dda-sispag.md` (`planned`)

| **I15t** | **Confirmação em conjunto de títulos irmãos (ADR-0080, `planned`).** A partir da gaveta de
um título, a analista confirma de uma vez vários títulos **irmãos**, cada um com o seu boleto escolhido
pela âncora de número. (1) **Irmão elegível**, tudo recalculado ao vivo: mesmo `pesCod` **e** mesma
`filCod` do título de origem; desfecho `UNICA_SEGURA` ou `SO_ATENCAO` cujo candidato confirmável tem
`NUMERO_CONFIAVEL` (I15s); `exigeReconhecimento = NENHUM` (nem o tipado da I15r, nem o simples da I15o);
sem decisão `CONFIRMADA`; fora de `GrupoBoleto CONFIRMADO` (I15q); fora de `ItemLote` em lote local
`FINALIZADO`/`REMESSA_GERADA`/`RETORNADO`. `AMBIGUA`, `DISPUTADA`, `SO_FRACA`, `SO_VENCIDA`, `ORFA` e
`EM_GRUPO` nunca. O título de origem é a primeira linha quando é elegível. (2) **Seleção explícita:**
nenhuma linha vem marcada; o servidor só confirma o que foi enviado. (3) **Limite:**
`CONFIRMACAO_CONJUNTO_MAXIMO` = **30** linhas por pedido (constante global de código), acima disso 422
sem confirmar nada; linhas repetidas contam uma vez. (4) **Linha a linha, nunca tudo-ou-nada:** cada
linha passa pelo **mesmo** `confirmar` (releitura, I15e, I15j, lock de grupo, I15m), em transação
própria, em sequência; o resultado é por linha (`CONFIRMADA`, `JA_CONFIRMADA`, `RECUSADA` + motivo
pt-BR). Uma linha que deixou de ser elegível pela (1) é `RECUSADA` sem tocar no banco. (5) **Avisos,
derivados, nunca gravados como regra:** `FAIXA_AJUSTE_MANUAL` quando 0 < \|Δvalor\| e Δdias > 0
(a I18a(4) não ajusta; a renegociação é manual no Conexos); `ESCOLHIDO_SO_PELO_NUMERO` quando há no pool
**outro** boleto do mesmo emissor com o mesmo valor e o mesmo vencimento do escolhido (aglomerado tipo
TIME LOG: sem a âncora, o título seria `AMBIGUA`). Nenhum dos dois impede a marcação; ambos aparecem por
linha e contados no resumo antes de confirmar. (6) **Ajuste de centavos:** o de hoje (I18g), agendado
**uma vez por título confirmado**, nunca como operação de grupo; os de um mesmo conjunto rodam **em
sequência**, numa só fila em segundo plano, para não abrir N renegociações simultâneas no `fin070`.
(7) **Trilha:** cada linha confirmada grava o seu `DECISAO_CONFIRMADA` de sempre, com `detalhe.conjunto
= { id, tituloOrigem }` (id gerado pelo servidor, um por pedido). Não há evento do conjunto. Não sobe
tier, não alarga limite (I15d), não toca I15h/I15o/I15r, zero escrita no ERP pela confirmação (I15b). |

## 2. Ação nova `actions/sispag/confirmar-sugestoes-em-conjunto.md` (`planned`)

- **Leitura:** `GET /sispag/sugestoes-boleto/titulo/irmaos?filCod=&docCod=&titCod=` (`sispag:ver`) →
  linhas elegíveis pela I15t(1): título, nº do documento, nº do boleto, valores, Δvalor com sinal,
  Δdias, tier, avisos da I15t(5), e se o ajuste automático vai rodar (0 < \|Δ\| ≤ R$ 0,05 no mesmo dia).
  Vem do cache do cenário (mesmo da listagem); quem decide é a escrita.
- **Escrita:** `POST /sispag/sugestoes-boleto/confirmar-em-conjunto` (`sispag:executar`), corpo
  `{ origem: ChaveTitulo, itens: [ChaveSugestao] (1..30) }` validado com Zod. 200 com
  `{ conjuntoId, resultados: [{ chave, status, motivo? }], confirmadas, recusadas }`; 422 para corpo
  inválido ou mais de 30. Ator = JWT.
- **Pré-condições:** as de `confirmarSugestaoBoleto` por linha, mais a I15t(1) relida ao vivo.
- **Pós-condições:** N decisões `CONFIRMADA` comuns (as mesmas do confirmar individual), eventos com
  `detalhe.conjunto`; título, lote e ERP intactos.
- **Efeito colateral:** ajuste de centavos por título, em fila sequencial (I15t(6)).

## 3. Emendas por remissão (sem mudança de regra)

- `actions/sispag/confirmar-sugestao-boleto.md`: nota "também chamado linha a linha pela
  confirmação em conjunto (I15t); com `conjunto` no `detalhe` do evento".
- `entities/decisao-sugestao-boleto.md`: nota na trilha sobre `detalhe.conjunto`.
- `business-rules/ajuste-centavos-titulo-sispag.md`: nota à I18g "no conjunto, um pedido por título,
  em sequência (I15t(6))". I18a(4) **inalterada**.

## 4. Fora deste ADR

- Emenda da I18a(4) para pares +1..+5 dias (renegociação automática da faixa): PR separado, já
  registrado como follow-up P1 do ADR-0079.
- Conjunto entre filiais ou entre credores.
