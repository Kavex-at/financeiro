# sispag-retirar-titulo-lote — perguntas em aberto

> **Encerrado em 2026-09-23.** O usuário retirou a retenção da formação automática antes do merge
> (ADR-0050): o problema era de UX, e o título voltar a um lote automático depois não é problema.
> P1-1, P1-2, P2-1 e P2-2 perderam o objeto. Mantido como registro.

> Aberto pelo OntologyCurator em 2026-09-22, junto com a ADR-0050. P1-1 e P1-2 respondidas pelo
> usuário em 2026-09-22, na aprovação da ADR (agora `accepted`); P2-1 e P2-2 seguem abertas e não
> bloqueiam. Implementação: feature `sispag-reter-titulo-lote`.

## P1-1: a remoção feita dentro do lote também deve reter?

Hoje há duas portas para tirar um título do lote: a nova ação na aba de títulos (retém, ADR-0050 D3) e
a remoção existente na tela do lote (`DELETE /sispag/lotes/:id/itens/...`, não retém). Pela segunda
porta, o título continua voltando no próximo cron.

- **Recomendação:** reter também na tela do lote quando o lote é **automático**. Nesse caso a intenção
  é a mesma: a analista não quer o título ali. No lote **manual**, não reter: ela está rearranjando o
  próprio lote e pode querer mover o título para outro.
- **Alternativa:** deixar como está (só a aba de títulos retém).

Resposta (usuário, 2026-09-22): **SIM.** A lixeira dentro do lote também grava a retenção, mas **só
quando o lote é AUTOMÁTICO**. O serviço lê `automatico` **antes** de `marcarManual` virar o lote para
manual, na mesma transação da remoção. A remoção num lote manual não muda. Incorporado à ADR-0050 D3,
a `gerenciar-lote-candidato.md` e a `reter-titulo-da-formacao.md`.

## P1-2: a retenção pode ser marcada num título solto?

O pedido foi só "retirar do lote". O rascunho da ADR-0050 (D5) recomendava permitir também "Reter" num
título que ainda não está em lote (ativo, não pago), para a analista segurar um título antes de o cron
lotá-lo.
Custo de modelo zero; custo de UI: um botão a mais na linha.

- **Recomendação:** sim.

Resposta (usuário, 2026-09-22): **NÃO — rejeitada, fora de escopo.** A D5 saiu da ADR-0050, da regra
e da action. A retenção só nasce ao tirar o título de um lote. Registrado também no
`_watchlist.md`.

## P2-1: a retenção deve expirar?

A ADR não expira a retenção. Título pago, inativo ou vencido fica com a marca, inerte. Risco: uma
retenção esquecida num título que continua a vencer. O badge na linha é a mitigação.

- **Recomendação:** não expirar agora. Revisitar se aparecer retenção esquecida que causou atraso de
  pagamento.

Resposta:

## P2-2: universalidade (Francinei)

Evidência de cliente: uma (Columbia). A estrutura corresponde ao *payment block* (SAP) e ao *hold*
(Oracle). Pedir ao Francinei a confirmação de que outras tradings seguram títulos fora da proposta
automática sem proibir o pagamento manual.

Resposta:
