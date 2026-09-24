# Follow-ups do Regis-Review — `sispag-boletos-dda` (PR #85)

> Revisão `docs/regis-review/2026-09-24-1448-sispag-boletos-dda/` (execução reduzida por pedido do
> usuário: Security 8, Integrability 8, Performance 7). **Gate passou com 0 P0.** Conforme o pipeline,
> P1/P2/P3 ficam registrados aqui e **não foram implementados** nesta entrega.

## P1

- **performance-1 + security-2 — paginação de "todos" no servidor.** `GET /sispag/boletos-dda?escopo=todos`
  devolve 24.137 linhas com código de barras e linha digitável (~8,5 MB sem compressão, estimado).
  Recomendado como primeiro follow-up. O padrão "a vencer" (1.665 linhas) pode seguir filtrado no
  cliente.

## P2

- **security-1** — persistir runs da sincronização DDA em tabela consultável (`boleto_dda_sync_run`).
- **integrability-1 / integrability-3** — reusar `ConexosBaseClient.paginate` (com `onCapHit`) no
  `ConexosDdaClient`; hoje a paginação é duplicada e o truncamento em 60 mil linhas é silencioso.
- **integrability-2** — contrato único back/front para os tipos de Boletos DDA.
- **integrability-4** — pressão de sessão no usuário Conexos compartilhado (`LOGIN_ERROR_MAX_SESSIONS`
  em toda sessão nova medida).
- **performance-2** — cache da consolidação por `sincronizadoEm`.
- **performance-3** — pré-computar o texto de busca da aba.
- **performance-6** — confirmar compressão HTTP no caminho SISPAG.

## P3

- **performance-4** — não reler arquivos DDA cancelados.
- **performance-5** — índice `idx_boleto_dda_valor` sem uso; índice parcial em `cancelado_em`.
- **security-3** — alarme para uso repetido de `escopo=todos`.
- **security-4** — JWT em `localStorage` (pré-existente).
