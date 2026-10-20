---
name: anularGrupoBoleto
type: action
entity: GrupoBoleto
ontology_version: "0.47.0"
implementation_status: planned
status: draft
owners: [yuri]
related_files: []
last_review: 2026-10-20
preconditions:
  - "Usuário com `sispag:executar`, ou o sistema na cascata da revogação do par (I15l(2), mesma transação)."
  - "Grupo CONFIRMADO (inclusive órfão, I19u); motivo com 10–500 caracteres."
postconditions:
  - "Grupo ANULADO com anuladoPor, anuladoEm e motivoAnulacao (CHECK); terminal."
  - "Títulos e boleto liberados (índices únicos valem só para CONFIRMADO); marcas BloqueioDuplicidade GRUPO_BOLETO dos títulos encerradas."
  - "Em lote RASCUNHO: os N ItemLote retirados na mesma transação, versao do lote incrementada (I19t, decisão PI-6)."
  - "Evento GRUPO_ANULADO na trilha."
side_effects:
  - "Escrita só local; nenhuma chamada ao Conexos."
  - "Grupo em lote comprometido (FINALIZADO/REMESSA_GERADA): a tela avisa; a próxima gerarRemessa/retomada retira o grupo antes do finalizar, ou falha com erro nomeado se o lote nativo já finalizou (espelho da I17l)."
  - "Borderô antigo de um J rejeitado não é tocado: segue com o Alerta sispag-bordero-grupo-pendente até a analista resolvê-lo no ERP."
---

# anularGrupoBoleto

ADR-0076 (I19t). Saída da confirmação: idempotente sobre grupo já `ANULADO`; `PAGO` não se anula. Revogar o
par (pesCod, emissorChave) anula, na mesma transação, todos os grupos `CONFIRMADO` dele (cascata I15l(2)).
Anular nunca altera o par, o título nem o ERP. **Planned.**
