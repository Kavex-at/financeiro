# Gap — sispag-sugestao-boleto-dda (P1, não bloqueante)

**Aberto por:** AutoLoopRunner, fase 1 (T1, T2, T3a, T3b, T3c)
**Prioridade:** P1 — o loop segue com o default abaixo; pede confirmação do Yuri/Columbia.

## Pergunta 1 — envelope de plausibilidade da `ATENCAO`

I15c define os limites **seguros** (|Δ| ≤ R$ 0,05 no mesmo dia; valor igual e 1–5 dias depois), e diz que
"qualquer coisa maior é `ATENCAO`". Mas **não há teto**: sem um, todo boleto livre do pool seria
"ATENCAO" para todo título. A regra pura (`RegraSugestaoBoleto`) precisa de um limite acima do qual o
par é `SEM_RELACAO` (não candidato).

**Default implementado (constantes de código, ajustáveis por ADR curta):**

| Constante | Valor | Origem |
|---|---|---|
| `ENVELOPE_VALOR_ABSOLUTO` | R$ 10,00 | caso medido +R$ 10,00 |
| `ENVELOPE_VALOR_PERCENTUAL` | 2 % | caso medido +1,6 % (Q12 da entrevista propunha `max(R$ 10; 2 %)`) |
| `ENVELOPE_DIAS` | 10 dias (em módulo) | **sem medição** — escolhido para cobrir +6 dias (exemplo dos testes) |

Tolerância de valor = `max(ENVELOPE_VALOR_ABSOLUTO, ENVELOPE_VALOR_PERCENTUAL % do título)`.

**Opções:** (a) manter; (b) apertar `ENVELOPE_DIAS` para 7; (c) trocar por outro teto medido em PRD.

## Pergunta 2 — âncora para `ATENCAO` no motor (T3c)

O pool não traz beneficiário (só o código de barras). Sem uma âncora, uma `ATENCAO` por faixa de valor/data
geraria dezenas de sugestões espúrias por título. **Default implementado no motor:** uma sugestão
`ATENCAO` só é emitida quando há âncora de evidência — `EMISSOR_CONFIRMADO` (par vigente do credor com o
emissor do boleto) **ou** `NUMERO_IGUAL` (número do documento igual). Fora disso, o candidato é descartado.

**Opções:** (a) manter; (b) emitir `ATENCAO` também sem âncora (muito ruído); (c) só com par vigente.

## Pergunta 3 — título com 2+ boletos empatados (risco 4 do tasks.md)

**Default implementado:** o título **não** recebe `FORTE` nem `CONHECIDO`; recebe **nenhuma sugestão**
(os boletos empatados ficam disponíveis; o analista os vê na aba DDA como candidatos). Documentar em I15e.

**Opções:** (a) manter; (b) devolver `ATENCAO` "ambíguo" com a lista dos empatados.
