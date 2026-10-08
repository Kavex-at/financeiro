---
name: favorecido-autorizado
type: state-machine
entity: FavorecidoAutorizado
ontology_version: "0.38.0"
implementation_status: planned
status: draft
owners: [yuri]
related_files: []
last_review: 2026-10-08
states: [PENDENTE, AUTORIZADO, REJEITADO, REAPROVACAO_PENDENTE, REVOGADO]
---

# State machine: FavorecidoAutorizado (ADR-0065)

Terminais: `REJEITADO`, `REVOGADO`. Só `AUTORIZADO` **com fingerprint igual ao destino atual** libera
pagamento (I14a). Toda transição grava evento na trilha só-inclusão (I14j) e incrementa `versao`.

**Duas pessoas sempre (I14c):** toda aprovação (primeira ou reaprovação) exige um `solicitadoPor`
humano com `sispag:executar` e um aprovador com `sispag:autorizar_favorecido`, **aprovador ≠
solicitante**, comparados pelo usuário autenticado no backend. O sistema abre a reaprovação mas não
conta como solicitante.

| # | De → Para | Ação | Guarda / efeito |
|---|---|---|---|
| F1 | `(novo) → PENDENTE` | `solicitarAutorizacaoFavorecido` | `sispag:executar`. Sem registro vigente para (`pesCod`, `modalidade`). Grava `solicitadoPor`. Nunca nasce `AUTORIZADO` (nem a partir do relatório). |
| F2 | `PENDENTE → AUTORIZADO` | `aprovarAutorizacaoFavorecido` | `sispag:autorizar_favorecido`; aprovador ≠ `solicitadoPor`. Lê o `cmn025` ao vivo; recusa se o fingerprint que a tela mostrou ≠ o atual (409) ou se não há dado (422). Grava `fingerprint`, `fingerprintChaveId`, `destinoMascarado`, `avisos`. |
| F3 | `PENDENTE → REJEITADO` | `rejeitarAutorizacaoFavorecido` | `sispag:autorizar_favorecido`; motivo obrigatório. |
| F4 | `AUTORIZADO → REAPROVACAO_PENDENTE` | `verificarDestinoAutorizado` (**sistema**) | Leitura bem-sucedida e fingerprint atual ≠ gravado (mesma `fingerprintChaveId`). Grava `fingerprintObservado`/`destinoObservadoMascarado`, **limpa `solicitadoPor`**, emite `Alerta` `SISPAG_DESTINO_ALTERADO` (dedup `pesCod` + `modalidade`). Falha de leitura **nunca** dispara. `cmn025` sem dado **não** dispara (resultado `SEM_DADO_PAGAMENTO`). |
| F5 | `REAPROVACAO_PENDENTE → REAPROVACAO_PENDENTE` | `solicitarAutorizacaoFavorecido` (confirmar o pedido) | `sispag:executar`. Grava `solicitadoPor`/`solicitadoEm`. Sem isto F6 é recusada. |
| F6 | `REAPROVACAO_PENDENTE → AUTORIZADO` | `aprovarAutorizacaoFavorecido` | Mesmas guardas de F2, incluindo `solicitadoPor` não nulo e aprovador ≠ `solicitadoPor`. Grava o novo fingerprint. O aprovador vê antes × agora mascarados. |
| F7 | `AUTORIZADO \| REAPROVACAO_PENDENTE → REVOGADO` | `revogarAutorizacaoFavorecido` | `sispag:autorizar_favorecido`; motivo obrigatório. Um pedido novo cria outro registro (F1). |

Revogação vale para lotes ainda não importados no `fin015`; destino já congelado (I10f) segue o
lote nativo (I14g).
