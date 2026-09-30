# metricas-sispag — follow-ups do Regis-Review (2026-09-30)

Run: `docs/regis-review/2026-09-30-1459-metricas-sispag/` (REPORT.md + KANBAN.md). Overall **8.0**,
**0 P0** (gate não reabre o loop), 0 P1, 8 P2, 5 P3 — 13 cards únicos. Nada abaixo foi implementado.

## Decidido

- **security-1 (P2) — aceito pelo Yuri em 30/09**, registrado na ADR-0056 (D7): quem tem
  `metricas:ver` vê o agregado semanal do SISPAG, mesmo sem `sispag:ver`. Card fechado.

## Primeira sprint pós-merge (S, P2)

- **availability-1** (⊃ fault-tolerance-2, integrability-2): sinal de idade do último sync do
  `sincronizar-lotes-sispag` (ou do título mais antigo sem `situacao`), para "0 aceitos" não se
  confundir com cron parado. Opcional no mesmo card: guarda `AND status <> 'settled'` em
  `RemessaExecucaoRepository.fail` (pré-existente, R-7).
- **fault-tolerance-1** (⊃ testability-1) + **testability-2**: `settle`/`fail` em Postgres real
  (1º encerramento imóvel; erro → liquidação sobrescreve) e borda de fuso da semana no SISPAG.
- **deployability-1** + **availability-3**: `rollbacks/0070_metricas_ciclo_sispag.rollback.sql`
  registrado no `rollbacks.test.ts`; conferir se o runner envolve o arquivo em transação.

## Antes da próxima frente de métrica

- **integrability-1** (⊃ modifiability-3): fixture de contrato + Zod tolerante no front + teste
  SQL ↔ `METRICA`.
- **modifiability-2**: registry de frentes no front (KPI, colunas e skeleton da mesma lista).
- **modifiability-1** (M): uma função SQL por frente, `metricas_ciclo` como união.

## P3 / condicionais

- deployability-2 (travar com teste a tela sem chaves `sispag_*`), testability-3, security-2,
  performance-1 (só com > ~5k itens ou > 100 ms).
