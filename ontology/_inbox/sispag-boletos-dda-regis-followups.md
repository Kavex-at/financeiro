# Follow-ups do Regis-Review — `sispag-boletos-dda` (PR #85)

> Revisão `docs/regis-review/2026-09-24-1448-sispag-boletos-dda/` (execução reduzida por pedido do
> usuário: Security 8, Integrability 8, Performance 7). **Gate passou com 0 P0.** Conforme o pipeline,
> P1/P2/P3 ficam registrados aqui e **não foram implementados** nesta entrega.

## P1

- ✅ **performance-1 + security-2 — paginação de "todos" no servidor. FEITO (2026-09-25, mesmo PR #85).**
  `PaginacaoBoletoDda` filtra (situação, filial, busca) e pagina no backend; a rota aceita
  `situacao`, `busca`, `filCod`, `pagina`, `tamanho` (teto 100, acima disso 400). Aplicado aos dois
  escopos. Medido em dados reais (24.137 boletos): "todos" caiu de uma resposta de ~8,7 MB para
  **7,2 KB** por página (286 ms, backend local). Efeito colateral útil: com o rate limit global
  (100 req/min/IP), um cliente extrai no máximo ~10 mil boletos por minuto — antes, o pool inteiro
  numa chamada.

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
