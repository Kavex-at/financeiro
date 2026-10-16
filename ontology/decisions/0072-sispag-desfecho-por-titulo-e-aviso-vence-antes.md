---
adr_number: 0072
title: SISPAG — desfecho de sugestão para todo título "boleto sem DDA" e aviso "boleto vence antes do título"
date: 2026-10-15
status: accepted
type: change
related_entities: [DecisaoSugestaoBoleto, ConfirmacaoEmissorBoleto, BoletoDda, TituloAPagar]
related_business_rules: [sugestao-boleto-dda-sispag, vinculo-codbar-item-sispag]
continues: [0068, 0071]
amends: [0068, 0071]
evidence:
  - ontology/_inbox/sispag-sugestao-para-todo-titulo-proposta.md
  - "leitura somente leitura em PRD (2026-10-15): 14 titulos 'sem DDA' na grade, apenas 7 com selo (5 FORTE + 2 ATENCAO ancorada); candidato dentro do envelope existia para os 14"
---

# ADR 0072: desfecho por título e aviso "vence antes do título"

**Branch:** `feat/sispag-sugestao-para-todo-titulo`. `/feature-new`. `entity_changed = true`. Ontologia **0.43.0**
(`implemented`, app v0.69.0). Sem código nesta etapa.

> **Reconferido (2026-10-15):** `origin/main` v0.68.1 (3788e34), ontologia 0.42.0, último ADR 0071; número
> 0072 livre. Reconferir antes do ship (versões colidem entre sessões paralelas).

## Requisito do maintainer
"Preciso ter uma sugestão para todo título e ter um aviso quando houver um boleto com vencimento antes do
título, o que pode significar atraso no pagamento."

## Contexto
Hoje só 7 de 14 títulos mostram selo, embora o pool tivesse candidato dentro do envelope para os 14. Duas
causas, ambas **decisões de implementação**, não regras do maintainer: (1) `ATENCAO` **sem âncora** era
descartada; (2) a ambiguidade (2+ seguros de mesma força) resultava em "sem sugestão" silencioso (I15e). A
disputa (Q-D) também fazia o perdedor "perder" o boleto em silêncio.

## Decisão
1. **"Sugestão para todo título" vira "desfecho para todo título"** (`SituacaoSugestaoTitulo`, derivada, não
   persistida): `UNICA_SEGURA`, `AMBIGUA`, `SO_ATENCAO`, `SO_FRACA`, `SO_VENCIDA`, `DISPUTADA`,
   `SEM_CANDIDATO` (+ `CONFIRMADA`/`ORFA`). Honestidade: candidato dentro do envelope **não é** boleto
   correto; é evidência fraca, exibida como tal. Nunca boleto sintético (I15m).
2. **Exibir ≠ confirmar (P0-1, aprovado: opção a).** Candidato **fraco (sem âncora)** e **ambíguos** são
   **informativos**, ranqueados, `confirmavel = false`; o servidor recusa a confirmação. O ambíguo se resolve
   **rejeitando** os outros (ação existente); o restante vira único/FORTE. I15c/I15d e I17 intactos.
3. **Aviso `VENCE_ANTES_DO_TITULO` com reconhecimento no servidor (P0-2, aprovado: opção a).** Δdias < 0
   avisa; confirmar exige `reconheceAvisos` (422 sem ele), gravado no snapshot. Boleto já vencido na data
   de débito segue **bloqueado** (I15h). O passo 2 nunca vincula Δdias < 0.
4. **Invariantes novas:** I15m (desfecho visível), I15n (fraco não reserva; `DISPUTADA`), I15o (aviso + ack).
   Emendas curtas em I15c, I15e, I15h; notas em I17a/I17c (sem mudança de regra).
5. **Defaults P1 aplicados:** top-N = 3 (constante de exibição, não domínio); uma linha por título +
   candidatos sob demanda; atraso por dia civil (ADR-0070); sem aviso para título já associado a DDA pelo ERP;
   revisão de universalidade com o Francinei, **não bloqueante** (1 cliente, precedente Q-I do 0068);
   **medição somente leitura em PRD como critério de aceite** (nenhum título sem desfecho; `SO_FRACA` não
   pode ser maioria silenciosa).

## O que NÃO muda
I15a/b (confirmação é evidência; zero escrita no ERP no passo 1), I15d (nunca alarga limite), I15k
(permissão/máscara), I17a–d (elegibilidade do vínculo), envelope e constantes globais, cache do cenário,
escrita no ERP. Sem entidade nova; 1 propriedade derivada; 2 sinais no snapshot.

## Rejeitados (resumo)
- **REJECT-PREMATURE:** confirmar `ATENCAO` sem âncora (cria par a partir de caso com Δ alto e contamina
  sugestões futuras); escolher um dos ambíguos; alargar a janela do passo 2 (+6..+10 d, MULTILOG +8 d);
  retirar/travar automaticamente do lote título com boleto vencido. Todos na watchlist.
- **REJECT-DUPLICATE:** persistir o desfecho (I-DDA1); aviso por dia útil bancário (ADR-0070).
- **REJECT-WORKAROUND:** ack só na UI; boleto sintético/"melhor chute".
- **REJECT-NOT-DOMAIN:** top-N como regra; alerta ativo por e-mail/notificação.

## Consequências
Mais candidatos visíveis (risco de ruído), contido por envelope inalterado, top-N, rótulo honesto
(`muted`/`warning`, nunca "sugestão disponível" para fraco), contadores por situação e log de medição.
Mudança de contrato de listagem (uma linha por título) e rota de detalhe sob demanda, a cargo do TaskScoper.
