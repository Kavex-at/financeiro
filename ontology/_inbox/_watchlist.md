# Ontology Watchlist — conceitos premature / a revisitar

> Conceitos capturados durante curadorias que **não entraram** na ontologia agora (premature ou
> aguardando contrato/decisão), mas que devem ser revisitados quando houver mais profundidade ou um 2º
> cliente. Cada item aponta a curadoria/ADR que o registrou.

## Frente IV — Conciliação de Recebimentos + NDe (ADR-0022, curadoria 2026-07-24)

- **Regras de negócio DEFERIDAS à Fase 4** (stubs criados, semântica não fixada — não modelar antes da
  hora): `encomenda-percentuais` (0,1%/0,9% — base, significado, contas, arredondamento);
  `adiantamento-cliente` (critério de identificação + ciclo do `CreditoCliente`); `separacao-multa-juros`
  (informado × calculado, destino por parcela, divergência esperado×pago). Cada uma tem OfficeHours
  própria na Fase 4.
- **Nexxera — canal/formato (O7):** API vs SFTP/CNAB240 vs OFX, auth, sandbox **não confirmados**.
  Modelado com port channel-agnostic; **spike na Fase 0**. Revisitar quando o contrato do vendor fechar
  (define o adaptador concreto).
- **Write de recebível (O3):** aposta = `fin010` parametrizado. **Confirmar o shape do payload/endpoint
  no build (Fase 5)** — capturar uma baixa real de recebível se a parametrização não fechar.
- **Emissão da NDe:** endpoint/trigger de emissão no Conexos **a confirmar na Fase 5** (junto do O3).
  Idempotência ("já emitida") já modelada; o contrato wire não.
- **Módulo 6 (observabilidade):** transversal, não é entidade/ação única — **semeado** em cada fase
  (correlation id, run de auditoria, logs) e **consolidado na Fase 6** (dashboards/métricas/alertas).
  Não modelar como entidade agora.
- **Enum de componentes do rateio** (`PRINCIPAL | MULTA | JUROS | ENCOMENDA | …`) e a **estratégia de
  distribuição** (greedy por saldo / vencimento / componente): forma esboçada em `RateioRecebimento`;
  enum e motor concretos na **Fase 3/4**.
- **Sub-estados de execução** (ex.: `executando`/`pending` no write-ahead ledger do `Recebimento`):
  detalhe de implementação da **Fase 5** (espelha `permuta_alocacao_execucao`) — não fixados na
  state-machine skeleton de propósito.
- **Scheduler (O4, herdado do SISPAG):** sem runtime de job/cron nativo (Express). Cadência do Módulo 1
  começa manual-trigger + cron probe (como a ingestão SISPAG); EventBridge é o alvo.
