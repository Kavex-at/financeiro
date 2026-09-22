# GAP — data de débito escolhível na remessa SISPAG (perguntas à Flavia)

> `/feature-tweak` slug `sispag-data-pagamento`, ADR-0049. Data: 2026-09-22.
> **Todas P1, nenhuma bloqueia a implementação.** A regra I8 (`business-rules/data-debito-remessa-sispag.md`)
> é conservadora: onde há dúvida, ela bloqueia a data em vez de aceitá-la.

## P1-1 — Feriados municipais/estaduais

O calendário bloqueia fim de semana + feriados bancários **nacionais** (fixos, incl. 20/11, e Carnaval,
Sexta-feira Santa, Corpus Christi). Não bloqueia feriado da cidade (ex.: aniversário da cidade da
filial/agência).

- Já aconteceu de um pagamento cair num feriado municipal e o banco não processar?
- Se sim, de quais cidades (filial pagadora ou agência Itaú da conta)?

**Default enquanto não responder:** só nacionais. Se entrar, entra como configuração por filial, não na
ontologia.

## P1-2 — Como o Itaú trata débito em dia não útil

Hoje nós bloqueamos a escolha de dia não útil. Mas se chegar ao banco um arquivo com débito num dia sem
expediente (feriado que não conhecemos), o Itaú:

- (a) rejeita o pagamento no retorno,
- (b) paga no próximo dia útil, ou
- (c) paga no dia útil anterior?

Isso define o risco de um feriado municipal que escape da P1-1 (em (b), um boleto que vence naquele dia
pode ser pago com atraso).

Relacionado: **31/12** tem compensação normal para pagamento via remessa, ou deve ser bloqueado também?

## P1-3 — Remessa com data futura: quando o arquivo vai ao banco?

Com débito em D+1 ou depois, o `.REM` é gerado na hora do pedido.

- O arquivo pode ir para a pasta/Nexxera **no mesmo dia** (o banco guarda e debita na data), ou
- tem de ser mandado **no dia do débito**?

Se for o segundo caso, o transporte (que é manual e externo, `REMESSA_GERADA ≠ ENVIADO`) passa a ter uma
data certa, e talvez valha um aviso na tela. Hoje nada muda: o sistema não observa o envio.

---

**Respostas:** editar este arquivo abaixo de cada pergunta. Resposta que mude a regra volta ao
OntologyCurator (`/feature-tweak`).
