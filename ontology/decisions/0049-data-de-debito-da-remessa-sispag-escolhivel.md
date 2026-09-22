---
adr_number: 0049
title: A data de débito da remessa SISPAG passa a ser escolhida pela analista, dentro da janela do ERP e em dia útil bancário, e congela quando o lote nativo nasce
date: 2026-09-22
status: accepted
type: change
related_entities: [LotePagamento]
related_actions: [gerarRemessa]
related_business_rules: [data-debito-remessa-sispag, retomada-remessa-sispag]
related_integrations: [conexos]
evidence:
  - ontology/_inbox/sispag-fin015-exploration.md (R1/R2, linhas 72-76; resposta A5, linha 227)
  - ontology/_inbox/sispag-fin015-ida-provada-hml.md (itsDtaPgto é snapshot do import, linha 77)
  - src/backend/domain/service/sispag/RemessaService.ts:339 (dataDebito = hojeUtc())
  - pedido da Flavia (financeiro Columbia), 2026-09-22
supersedes_decisions: []
amends_decisions: [0039]
---

# ADR 0049: a data de débito da remessa SISPAG é escolhível — e congela quando o lote nativo nasce

**Cliente:** Columbia Trading · **Entrega:** Kavex · **Branch:** `fix/sispag-data-pagamento`
(`/feature-tweak`, slug `sispag-data-pagamento`). `entity_changed = true`.

## Contexto

Ao gerar a remessa, o `RemessaService` envia ao `fin015` a data de débito (`flpDtaCredito`) fixada em
`hojeUtc()`. Isso nasceu da resposta **A5** da analista em 2026-07-09: *"data de débito = HOJE, SEMPRE,
sem agendamento"* — ela pagava no dia, mesmo com vencimento semanas à frente.

Em **2026-09-22 a Flavia pediu o contrário:** para testes e para muitos casos reais ela precisa escolher
amanhã ou outra data. A A5 descrevia o hábito de então, não uma restrição do domínio: o próprio ERP
aceita qualquer data na janela `[hoje, menor vencimento dos itens]` (R1/R2, descobertas ao vivo no
`finalizarLote`).

Dois defeitos apareceram na mesma investigação:

1. `hojeUtc()` é meia-noite UTC. Das 21h às 24h de Brasília, "hoje" já é amanhã.
2. A data é recalculada a cada tentativa. Com o lote nativo já criado, a retomada o reaproveita, e a
   data dele é a da primeira tentativa. O valor recalculado não tem para onde ir.

## Decisões

### D1 — A data é escolhida no pedido de remessa; hoje continua o default

"Gerar remessa" abre uma confirmação com a data de débito. Default = **hoje em `America/Sao_Paulo`**,
atalhos "Hoje" / "Amanhã" (próximo dia útil) e calendário. A tela mostra a janela permitida e **nomeia o
título que define o limite superior**. O card do lote passa a mostrar "débito em dd/mm".

A A5 **não é apagada**, é rebaixada: descrevia o uso comum (e continua sendo o default), não uma regra.

### D2 — `LotePagamento.dataDebito`, com invariante I8

Propriedade nova no agregado (`lote_pagamento.data_debito`). Invariante **I8**:

- **I8a** `dataDebito ∈ [hoje_BRT, min(itsDtaPgto)] ∩ diasUteisBancarios`, validado **antes** de qualquer
  escrita no ERP.
- **I8b** imutável a partir do `criarLote` que a usou; retry e retomada usam a persistida e **recusam**
  outra. Volta a ser escolhível só se aquele lote nativo deixar de existir (cancelado no ERP e confirmado
  via `LoteAnteriorCanceladoError`).

Regra completa em `business-rules/data-debito-remessa-sispag.md`.

### D3 — Fora da janela é bloqueado, não corrigido

Data depois do menor vencimento é recusada. **Descartado:** remover automaticamente os títulos que
vencem antes da data. Tiraria um fornecedor do pagamento sem decisão humana e sem rastro. Para usar uma
data posterior, a analista reabre o lote e retira o título limitante.

### D4 — Dias úteis bancários, calculados em código, com o backend como fonte única

Bloqueia fim de semana e feriados bancários nacionais: fixos (incl. 20/11 desde 2024) e os móveis
derivados da Páscoa (Carnaval segunda/terça, Sexta-feira Santa, Corpus Christi). O backend expõe a janela
já recortada; o frontend não reimplementa o calendário.

**Ontologia × configuração:** o conceito e o conjunto **nacional** ficam na ontologia, porque vêm de
regulação, valem igual para toda trading brasileira e não mudam de um ano para o outro. Os feriados
**municipais/estaduais** são valor de praça, logo configuração por cliente/filial. Estão **fora de
escopo** nesta entrega (watchlist + pergunta à Flavia). O calendário **não** é uma entidade: não tem
identidade nem ciclo de vida.

**Descartados:** tabela de feriados no banco (dado a manter todo ano para um conjunto calculável) e API
externa de feriados (dependência de rede num caminho de escrita financeira).

### D5 — "Hoje" é Brasília, e isso é domínio, não tenant

A correção de fuso entra nesta mudança. `America/Sao_Paulo` não viola a regra de não fixar valor de
tenant no código: é o fuso do sistema de pagamentos brasileiro, não uma escolha da Columbia.

### D6 — Nada de estado novo

Débito futuro **não** vira `AGENDADO`. O lote segue `FINALIZADO → REMESSA_GERADA` (L8), e a data é
propriedade dele. A máquina de estados ganha só a nota na L8.

## Consequências

- `retomada-remessa-sispag.md` (emendada): a `dataDebito` da marca d'água é a persistida, nunca
  recalculada.
- **Caso aceito, fail-closed:** lote nativo criado com data D, retomada em D+1 → o ERP recusa pelo R1. A
  retomada não reescreve a data do lote nativo. A analista cancela no `fin015` e segue pelo
  `LoteAnteriorCanceladoError`.
- **Não muda:** formação automática (filial, a-vencer ≤7d), I2–I6, o transporte manual ao banco.
- Perguntas P1 não bloqueantes em `_inbox/sispag-data-pagamento-gap.md`.

## Rejeitados na curadoria

| Candidato | Decisão |
|---|---|
| Estado `AGENDADO` | REJECT: é propriedade, não estado (Filtro E) |
| Entidade `CalendarioBancario` / `Feriado` | REJECT-DUPLICATE: é função sobre datas dentro da regra I8 (propriedade antes de entidade) |
| Feriados municipais/estaduais | REJECT-PREMATURE → watchlist (valor de configuração se voltar) |
| Diálogo, atalhos "Hoje/Amanhã", "débito em dd/mm" no card | REJECT-NOT-DOMAIN: UI, fica nas tasks |
| Remoção automática de títulos fora da janela | Rejeitado pelo usuário (D3) |
