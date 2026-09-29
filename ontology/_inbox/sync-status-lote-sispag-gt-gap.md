# Ground truth pendente — sync-status-lote-sispag (ADR-0055)

**Status:** PENDENTE (não bloqueia o PR) · **Aberto em:** 2026-09-29 · **Dono:** Yuri

## Por que não rodou no loop

A validação ao vivo precisa de uma sessão do robô no Conexos PRD. Nesta máquina:

- o `.env` local não tem credencial do Conexos;
- um login local em PRD ocupa um dos ~3 slots de sessão do usuário (`LOGIN_ERROR_MAX_SESSIONS`) e
  derruba quem estiver usando o ERP;
- com `databaseConnectionString` preenchido, o login local grava a sessão de outro usuário no slot
  do robô (`columbia-default`).

Por isso o gate não foi executado aqui. O script está pronto e é read-only.

## Como fechar

Preferido — **pós-deploy, pelo próprio sistema** (a sessão do robô já está no servidor):

1. Depois do merge e do deploy, no card do lote do PG230901.REM (fil 2/flp 24), clicar
   **Sincronizar agora** (ou `POST /sispag/lotes/<id>/sincronizar`). A passada só lê o ERP.
2. Conferir no card: 38682/1 `pago`, lote `baixado`, origem `fora do retorno` com borderô 22320
   (ou `origem não identificada`, se o PSQ_018 der 403 ao robô — esperado hoje).
3. Repetir no lote fil 1/flp 8 (4030/7) e conferir contra o fin064 do dia.

Alternativa — script, com credencial do robô e janela combinada:

```bash
cd src/backend
databaseConnectionString= GT_CONFIRMO_SESSAO=1 CONEXOS_BASE_URL=... CONEXOS_USERNAME=... \
  CONEXOS_PASSWORD=... tsx jobs/validate-sync-status-lote-sispag-v1.ts
```

Roda o `SincronizacaoLoteService` real com repositório em memória: nada é gravado.

## Verdade verificada à mão (a citar)

| Item | fonte | valor |
|---|---|---|
| 38682/1 (fil 2/flp 24) | fin064 | Valor Pago 275,00 · Aberto 0 |
| 38682/1 | fin010 | borderô 22320, criado e finalizado à mão por ERICA_VIANA em 24/09 12:47 |
| gar 9 | fin052 | processado nativamente em 24/09 08:33, só evento BD (fil 1/flp 8 e fil 2/flp 24 no mesmo arquivo) |
| gar 10 | fin052 | carregado, nunca processado |

## Tolerância

Zero divergência em situação e destino do lote; valor pago exato ao centavo quando lido.
Divergência, quando a validação rodar, reabre o loop como defeito crítico. Este arquivo NÃO é pergunta de domínio em aberto: é validação ao vivo adiada (não bloqueia o PR).

## Observação sobre a amostra

Os dois itens estão em lotes nativos de filiais diferentes (fil 1/flp 8 e fil 2/flp 24). Como o lote
local é por filial (I4), são dois lotes locais: cada um fecha sozinho. A frase da ADR "o lote só vai a
BAIXADO se os dois estiverem pagos" vale só se os dois itens estiverem no mesmo lote local — conferir
no banco de produção antes de concluir.
