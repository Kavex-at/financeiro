# Regis-Review reduzido 2026-10-14-2030 — `feat/sispag-remocao-codbar-repetido` (PR 2 de 2)

Escopo: delta contra `origin/main`. 4 QAs escolhidos pelo risco (Fault Tolerance, Security, Testability,
Modifiability); os outros 4 não se aplicam (sem infra, sem integração nova além do `DELETE` já medido
em HML, sem mudança de deploy, sem tráfego novo relevante).

| QA | Nota | P0 | P1 | P2 | P3 |
|---|---|---|---|---|---|
| Fault Tolerance | 8 | 0 | 2 | 1 | 0 |
| Security | 8 | 0 | 0 | 1 | 2 |
| Testability | 8 | 0 | 2 | 1 | 1 |
| Modifiability | 7 | 0 | 0 | 1 | 3 |

**Nenhum P0.** Por julgamento do orquestrador, dois achados foram corrigidos mesmo sendo P1, por serem
furos de correção do código novo e não melhorias (`6e43977`):

- Testability-2: `removido:false`/falha da transação local seguia para o `DELETE` nativo e contava o item
  como retirado sem marca nem trilha. Agora falha fechado antes do `DELETE`.
- Fault Tolerance F-1: o desfazer da retenção não bloqueava na janela de crash (ledger `reconciling`).
  Agora é recusado (`RESOLUCAO_DUPLICIDADE_LIMPEZA_PENDENTE`, 409).

Demais achados: `ontology/_inbox/sispag-remocao-codbar-repetido-regis-followups.md`.

Decisão de produto em aberto: F-3 (retenção encerra quando o título mantido é pago; o título retirado
volta a ser elegível; o banco tende a rejeitar o boleto já pago). A guarda contra boleto já pago está fora
de escopo (HMAC + migration; watchlist).

Ground truth: DELETE medido em HML em 2026-10-14 (200 existente; 500 RECORDNOTFOUND ausente; 400 lote
nativo FINALIZADO). Ver `ontology/_inbox/sispag-remocao-codbar-repetido-hml-achados.md`.
