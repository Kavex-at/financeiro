---
name: duracao-etapa-aprovacao
type: business-rule
entity: EtapaAprovacao
ontology_version: "0.10"
implementation_status: planned
status: draft
owners: [yuri]
related_files:
  - src/backend/domain/service/aprovacoes/DuracaoCalculator.ts
  - src/backend/domain/service/aprovacoes/DuracaoCalculator.test.ts
  - src/backend/migrations/0049_aprovacao_trilha.sql
last_review: 2026-08-19
---

# Regra — duração de uma etapa de aprovação

> **A métrica-produto da Frente V.** Tudo que o cliente pediu ("quanto tempo cada pessoa ficou para
> aprovar") sai daqui, e o analítico da Fase 2 vai agregar exatamente este número. Errar aqui
> contamina o produto inteiro.

## Enunciado

```
duracaoSegundos = (agidoEm − recebidoEm) / 1000        , se status ∈ {CONCLUIDA, REJEITADA}
duracaoSegundos = null                                  , caso contrário
```

- **Relógio corrido** (wall-clock), não dias úteis.
- Unidade: **segundos**. A formatação (h/dias) é decisão de apresentação.
- Fuso de referência para exibição: `America/Sao_Paulo`. O cálculo em si é sobre epoch, então é
  imune a fuso; o fuso só importa ao renderizar o instante.

## Por que relógio corrido, e não dias úteis

Dias úteis exigiriam calendário de feriados por filial — que não temos e que o cliente não pediu.
Mais importante: o número corrido é o **fato**; "3 dias úteis" é uma **interpretação**. Um painel
auditável entrega o fato, e a interpretação pode ser adicionada depois como campo derivado
adicional — **nunca substituindo** o corrido.

Se a analista pedir dias úteis na Fase 2, a coluna nova se calcula sobre `recebido_em`/`agido_em`,
que continuam gravados.

## Casos que a regra recusa a calcular (invariante I3)

| Caso | O que fazemos | Por quê |
|------|---------------|---------|
| `agidoEm` nulo | `null` | Ninguém agiu — não há duração |
| `agidoEm == recebidoEm` | `null` e status `PENDENTE` | O ERP carimba o mesmo instante enquanto o bloqueio não é resolvido. Observado nas 8 etapas pendentes da amostra |
| `agidoEm < recebidoEm` | `null` + lacuna | Dado inconsistente no ERP. **Não** clampar para zero: zero é um valor plausível e mentiroso |
| `statusErp` desconhecido | `null` | Não sabemos se a etapa terminou (PV-01) |

> **Nunca estimar.** Um painel financeiro que preenche silenciosamente um tempo faltante produz uma
> média que ninguém consegue auditar. Ausência é informação, e a UI a exibe via `lacunas[]`.

## "Parada há X" — métrica diferente, não confundir

Para etapas `PENDENTE`, o painel mostra **`paradaHaSegundos = agora − recebidoEm`**.

Isso **não é** `duracaoSegundos` e não entra em nenhuma média de duração:

- `duracaoSegundos` é **fechado e imutável** — mede um intervalo que terminou.
- `paradaHaSegundos` é **aberto e cresce a cada leitura** — mede espera em curso.

Misturar os dois enviesaria o tempo médio para baixo (etapas ainda abertas entrariam com o tempo
parcial). São campos distintos no contrato de API e rótulos distintos na UI.

## Dependência aberta

**PV-03** — se `recebidoEm` (`ftbTimBloq`) for o instante em que a *regra* criou o bloqueio, e não o
instante em que o aprovador foi notificado, a duração inclui um tempo de sistema que não é espera
humana. A regra não muda; muda a **interpretação** do número. Documentar na UI quando PV-03 fechar.

## Evidência

169 etapas resolvidas, filial 2 (produção, 2026-08-18):
mediana **2,5 h** · média **20,4 h** · p90 **70 h** · máximo **234,4 h**.

A distância entre mediana e média é o achado que justifica a frente: metade resolve em duas horas e
meia, e a cauda vai a dez dias.
