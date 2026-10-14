# Regis-Review (reduzido) 2026-10-14-2030 — métricas compartilhadas

> Escopo: delta da branch `feat/sispag-remocao-codbar-repetido` contra `origin/main` (v0.66.1), tweak
> `sispag-remocao-codbar-repetido` (PR 2 de 2: RETIRADA AUTOMÁTICA do item repetido). Worktree:
> `/home/inteli/Área de trabalho/projects/kavex/financeiro/.claude/worktrees/sispag-remocao-codbar-repetido`
> (use SEMPRE caminhos dentro dele). Delta = `git diff origin/main HEAD`.

## O que muda
Item BOLETO com código lido e repetido (mantém um: vencimento→docCod→filCod→titCod) ou lido e inválido (DV)
é retirado do lote: transação local (remove item + marca BloqueioDuplicidade com `origem` + evento
`ITEM_REMOVIDO_SISTEMA`), depois `DELETE fin015/finItemSispag/...` no rascunho nativo, releitura para
confirmar ausência; falha parcial fecha (ledger failed, nada finaliza). Exceção estreita: retirar item de
lote local FINALIZADO durante `gerarRemessa`. Ausência pura/leitura incompleta continua abortando.
Migration 0085 (colunas da marca). UI: aviso persistente no LoteCard, selo/undo dos retidos. Rede do
`.REM` (gate 5.1) continua abort-only. Só o código mascarado (5+4) é persistido.

## Baselines (relatados pelo AutoLoopRunner)
typecheck limpo; lint 0 erros/97 warnings; backend 243 suites/4479 testes; integração Postgres ok;
frontend jest 95 suites/995 testes; PatternGuardian PASS; DesignSystemReviewer aprovado.
Ground truth HML (2026-10-14): DELETE de item existente = 200 sem corpo; ausente/inexistente = 500
RECORDNOTFOUND; lote nativo FINALIZADO = 400 FIN_015.IMPOSSIVEL_ALTERAR_REGISTRO_NAO_EM_CADASTRO.

## Fora do escopo
Guarda entre lotes/contra boleto pago (HMAC + migration), passo 2 da ADR-0068, "prefira o confirmado por
humano" (P1-1b).
