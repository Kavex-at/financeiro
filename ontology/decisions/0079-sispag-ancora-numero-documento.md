---
adr_number: 0079
title: SISPAG — âncora de número na sugestão de boleto DDA (número do documento confiável desempata e reserva)
date: 2026-10-27
status: accepted
type: change
related_entities: [BoletoDda, DecisaoSugestaoBoleto, TituloAPagar, ConfirmacaoEmissorBoleto]
related_business_rules: [sugestao-boleto-dda-sispag]
continues: [0068, 0072, 0073]
amends: [0068, 0072, 0073]
decided_by: yuri
decided_on: 2026-10-27
evidence:
  - "teste da analista (2026-10-26): título 2|40100|1 NELSON HEUSI (pesCod 387), doc 25037, R$ 647,56, venc. 2026-10-27; boletos 25037 e 25041 (R$ 647,57, mesmo dia, emissor 341:8262:53318) ambos FORTE ⇒ AMBIGUA; o 25041 é o doc do título irmão 2|40107|1"
  - "simulação somente leitura (2026-10-27): 79 pares vinculados pelo ERP, 45 mil títulos do fin064 (2026-01-01 a +120 d, pagos ou não, 7 filiais), 23.266 boletos do pool"
---

# ADR 0079: âncora de número na sugestão de boleto DDA

**Status:** aceito em 2026-10-27 pelo Yuri (maintainer). **Branch:** `claude/sispag-numdoc-desempate-997574`.
`/feature-tweak sugestao-boleto-dda-sispag`. `entity_changed = true`. Ontologia **0.50.0** (0.48.0 e
0.49.0 tomadas pelas branches em voo dos ADR-0077 e ADR-0078). Entrevista com o maintainer em 2026-10-27.

> **Por que I15s (e não I15q/I15r):** a letra `I15q` já está em uso duas vezes em voo, pelo PR #131
> (`feat/sispag-boleto-agrupado`, ADR-0077) e por `feat/sispag-vinculo-data-divergente` (ADR-0078);
> `I15r` está reservada para a renumeração da `data-divergente` no rebase dela. Esta regra usa **I15s**.
> **Reconferido no rebase sobre `main` v0.76.0 (2026-10-27):** os dois já entraram; `I15q` é do PR #131
> (boleto agrupado, ADR-0077) e `I15r` do PR #132 (data divergente, ADR-0078), ontologia 0.49.0. ADR-0079,
> ontologia 0.50.0 e `I15s` seguem livres.

## Contexto

A I15f trata o número do documento como apoio: igual ao número do boleto, ele sobe a confiança, mas
não decide, porque sozinho acerta ~50 % (há credor que nunca numera o boleto pelo documento). Por
isso dois boletos `FORTE` de mesmo valor e dia deixam o título `AMBIGUA` mesmo quando um deles tem o
número do título. No caso da analista (NELSON HEUSI, 26/10), 25037 e 25041 são boletos do mesmo
emissor, mesmo valor e mesmo dia; o 25037 é o do título 40100, o 25041 é o do título irmão 40107.
Ela teve de rejeitar à mão o que a tela já sabia.

O erro de 50 % da I15f vem de casos que este ADR **não** aceita: número igual com valor/data fora do
envelope (colisão) e números curtos ou repetidos. Dentro do envelope `FORTE` (Δ ≤ R$ 0,05 no dia, ou
valor igual 1–5 dias depois), com número longo e sem repetição, o número igual deixa de ser
coincidência plausível.

## Medição (somente leitura, 2026-10-27)

Pares vinculados pelo ERP (79; 19 com número igual, todos no envelope FORTE):

| N (díg. mín.) | âncoras | corretas | falsas | cobertura (/79) | precisão |
|---|---|---|---|---|---|
| 3 | 23 | 19 | 4 | 24,1 % | 82,6 % |
| **4** | **22** | **18** | **4** | **22,8 %** | **81,8 %** |
| 5 | 18 | 14 | 4 | 17,7 % | 77,8 % |
| 6 | 8 | 4 | 4 | 5,1 % | 50,0 % |

- Os **4 falsos** são todos TIME LOG, 24–25/02, boletos de valor e dia idênticos (R$ 563,10 / 750,80)
  em que o próprio vínculo do ERP parece arbitrário (o título 10298 de doc 125374 foi ligado ao
  boleto 125376, e o título 6|2508 de doc 125376 aparece como "falso" no sentido inverso). Fora desse
  aglomerado: **N=4 → 15/15, 0 falso**.
- Uso real (títulos em aberto sem vínculo, pool livre): **275 âncoras** em 3.352 títulos com número
  (228 NELSON HEUSI); **~212** em títulos que hoje têm > 1 candidato FORTE (são as que mudam a tela).
  Pelo emissor aprendido dos 79 vínculos: 144 com emissor = mesmo credor, **0 com emissor de outro
  credor**, 131 com emissor desconhecido.
- Estresse (todo o fin064, pool inclusive os vinculados a outro título como candidatos): 5 âncoras
  apontam para boleto que o ERP ligou a **outro** título, as mesmas 5 do aglomerado TIME LOG.
- O caso 40100/1 resolve com N ∈ {3, 4, 5}; com N=6 perde (5 dígitos).
- N=4 contra N=3: perde 1 par correto e corta números de 3 dígitos (mais propensos a colisão); N=5
  perde 4 corretos sem eliminar nenhum falso. **N=4 escolhido.**

## Decisão

Nova invariante **I15s — âncora de número (número confiável)**, sinal `NUMERO_CONFIAVEL`
(ver `business-rules/sugestao-boleto-dda-sispag.md`):

1. **Confiável = todas:** (1) par dentro do envelope `FORTE` (limites globais I15c, não vencido no
   débito); (2) número do título com ≥ 4 dígitos significativos (normalização de `numerosIguais`);
   (3) sem duplicata: nenhum outro boleto do pool com o mesmo número e a mesma `emissorChave`, nem com
   o mesmo número e emissor não lido (qualquer data, livre ou vinculado); nenhum outro título do
   **mesmo credor** (`pesCod`) com o mesmo número de documento (qualquer filial ou situação), sem
   contar as outras parcelas do mesmo documento; nenhum outro candidato do título com o mesmo número;
   e o boleto candidato tem emissor lido.
2. **Precedência de âncora de identidade, no nível da DPS:** vence todo outro candidato do título,
   inclusive `CONHECIDO`, e reserva o boleto na **camada 0**, antes da disputa por vencimento (Q-D).
   Sem prova por credor.
3. **Conflitos:** DPS e número no mesmo título para boletos diferentes ⇒ `AMBIGUA` (motivo próprio,
   sem hierarquia entre as âncoras). Dois títulos (inclusive parcelas do mesmo documento)
   reivindicando o mesmo boleto por âncora de identidade ⇒ nenhum reserva; seguem as camadas normais.
4. **Não muda:** tier, limites (I15d), I15h/I15o, persistência (I-DDA1), humano no controle (I15g),
   passo 2 (I17). `NUMERO_IGUAL` sem as condições segue âncora simples de ATENCAO, como hoje.

Emendas curtas: I15c (dois graus de âncora), I15e (ambiguidade e Q-D depois da camada 0), I15f
(exceção única), I15m (segundo motivo de `AMBIGUA`), I15n (camada 0 reserva antes), I15p (camada 0
compartilhada). Sem entidade, ação ou estado novos.

## Decisões do maintainer (2026-10-27)

| # | Pergunta | Decisão |
|---|----------|---------|
| D1 | O número igual pode decidir entre seguros? | Sim, quando confiável (envelope FORTE + ≥ N dígitos + sem duplicata) |
| D2 | Precedência | Mesmo nível da âncora DPS: vence CONHECIDO e reserva na camada 0 |
| D3 | Prova por credor (como a ordem DPS)? | Não; a guarda de duplicata substitui a prova |
| D4 | N | 4 (constante global de código `NUMERO_CONFIAVEL_MIN_DIGITOS`) |
| D5 (Q1) | Âncora DPS e âncora de número no mesmo título apontando para boletos diferentes | **`AMBIGUA`**, sem hierarquia entre as âncoras |
| D6 (Q2) | Fonte da checagem de título duplicado | **Carteira local** (`titulo_a_pagar`), leitura nova **sem** o filtro `ativo`; nenhuma carga extra no Conexos. Lacuna conhecida documentada abaixo |
| D7 (Q3) | Outra parcela do mesmo documento (mesmo `docCod`/`filCod`, outro `titCod`) é duplicata? | **Não.** O envelope FORTE decide qual parcela casa; se duas parcelas reivindicam o mesmo boleto, vale "dois títulos no mesmo boleto ⇒ nenhum reserva" |
| D8 (Q4) | Boleto sem emissor lido | Candidato sem `emissorChave` ⇒ **sem âncora**; outro boleto do pool com o mesmo número e emissor não lido **conta como possível duplicata** |
| D9 (Q5) | Escopo da checagem de título duplicado | **Só o mesmo credor** (`pesCod`); credores diferentes caem no conflito de dois títulos |
| D10 (Q6) | Numeração | ADR-0079 / ontologia 0.50.0 aprovados; letra ajustada para **I15s** pelo orquestrador (ver nota no topo) |

## Trade-off registrado: constante global × configuração por cliente

O curador tem como padrão mandar valor para configuração de cliente. Aqui o limiar N fica como
**constante global de código**, pelo precedente dos limites da I15c (Q-B, ADR-0068): são parâmetros
de segurança do motor, iguais para qualquer tenant, ajustáveis por ADR curta. Se um segundo cliente
medir outro N ótimo, o N migra para configuração por tenant sem mudança estrutural (watchlist).

## Consequências

- O caso 40100/40107 deixa de ser `AMBIGUA`: cada título fica `UNICA_SEGURA` com o seu boleto, e o
  outro boleto aparece como `DISPUTADA` (reservado ao irmão), não como `compartilhado`.
- ~212 títulos em aberto saem de `AMBIGUA`/disputa por vencimento sem rejeição manual (medição de
  27/10; reconferir em PRD como critério de aceite).
- **Risco residual conhecido:** emissor que emite boletos de valor e dia idênticos e o ERP liga de
  forma arbitrária (aglomerado TIME LOG). A âncora pode escolher um boleto diferente do que o ERP
  escolheria; como os boletos são idênticos em valor, dia e emissor, o efeito financeiro é nulo, mas
  o par "certo" do ERP diverge. A analista continua confirmando (I15g).
- **Lacuna de dados conhecida (D6):** a checagem de título duplicado lê só a carteira local. Não
  enxerga título que a ingestão nunca gravou (janela de vencimento −15/+45 d; p.ex. outro documento
  do mesmo credor com vencimento > +45 d) nem o `doc_esp_numero` de linhas que saíram da carteira
  antes da migration 0083 (ficam `NULL`). Como parcelas do mesmo documento não contam (D7), a lacuna
  de parcelas futuras deixa de importar; resta a de outros documentos fora da janela. A medição usou
  o fin064 completo, então a precisão em produção pode ser um pouco menor. Critério de aceite:
  reconferir a precisão com a fonte efetivamente usada. Fechar a lacuna (índice persistido de um
  `fin064` amplo) fica para quando um falso for observado.

## Alternativas rejeitadas

- **Manter o número como apoio (I15f pura):** deixa a analista desempatar à mão o que o sistema
  sabe; 212 títulos.
- **Aprender por credor quem numera pelo documento (como a prova DPS):** REJECT-PREMATURE. A guarda
  de duplicata já elimina os falsos fora do aglomerado TIME LOG sem exigir histórico; vai para o
  watchlist.
- **N = 3:** ganha 1 par e abre números de 3 dígitos, mais propensos a coincidência. **N = 5/6:**
  perdem acertos sem tirar nenhum falso.
- **Tratar o aglomerado TIME LOG à parte:** REJECT-WORKAROUND; é calibração sobre um caso.
- **Número igual fora do envelope FORTE como identidade:** REJECT-PREMATURE. I15f (colisão) e
  ADR-0078 (ack tipado para data divergente) cobrem esses casos.
- **Hierarquia DPS lido > número > ORDEM_DPS:** rejeitada em D5; conflito vira `AMBIGUA`.
- **Ampliar a ingestão do `fin064` para fechar a lacuna (D6 opção 2):** mais carga no Conexos e
  tabela nova; adiada.
- **Leitura ao vivo do `fin064` no motor:** viola o "zero leitura no Conexos" do serviço e o motor
  puro (sem I/O).
- **Auto-confirmar a âncora de número:** muda a política de humano no controle (passo 3, ADR própria).
- **Persistir a âncora:** REJECT-NOT-DOMAIN (I-DDA1; a sugestão é derivada).
