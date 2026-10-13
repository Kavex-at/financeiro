# sispag-sync-ao-abrir — tasks

**Tweak** de `sincronizarStatus` (L11, `business-rules/sincronizacao-status-lote-sispag.md`).
Branch `fix/sispag-sync-ao-abrir`. ADR-0066, ontologia 0.39.1.

## Intenção (entrevista, 2026-10-09 → 2026-10-13)

O cron horário de L11 rodou 2–3x/dia (GitHub atrasa/derruba schedules) e lotes baixados no Conexos
ficaram em `REMESSA_GERADA` até alguém clicar em "Sincronizar agora". Decisões do usuário:

1. Ao abrir `/sispag`, sincronizar os lotes se a última passada completa tiver mais de **30 min**.
2. **`sispag:ver`** basta (L11 é read-only no ERP).
3. Roda **depois** do refresh da carteira, nunca junto (cap de sessões do robô).
4. **Um único "Sincronizar agora"** na tela (passada completa, forçada); o botão por lote sai.

Sem lógica monetária nova → **Ground-Truth não se aplica** (mesma L11, só muda o gatilho).

## Tasks

### T1 — Passada única de L11 com trava (backend)
`SincronizacaoPassadaService` (domain/service/sispag): `executarPassada({ triggeredBy })` =
advisory lock próprio (`SISPAG_SINCRONIZACAO_LOCK_KEY`) → run em `job_execucao`
(`sispag-sincronizacao`) → `SincronizacaoLoteService.sincronizarTodos` → fecha a run
(`success` / `partial` / `error` com as mesmas regras do job de hoje). Lock ocupado →
`IngestLockBusyError`. O job `SincronizarLotesSispagJob` passa a delegar para ele (exit code igual).
- Aceite: testes de status da run (sucesso, parcial, todas as leituras falharam, exceção) e do lock
  ocupado; teste do job segue verde com o exit code de hoje.

### T2 — Sincronizar se defasada / forçar (backend)
No mesmo serviço: `sincronizarSeDefasada({ triggeredBy, agora? })` → `fresca` (última run
`success`/`partial` finalizada há < `sispagLotesSyncTtlMin`), `falha_recente` (última run `error`
há < `sispagLotesSyncCooldownMin`), `em_andamento` (run `running` com < 10 min ou lock ocupado),
`atualizada` (rodou). `forcar({ triggeredBy })` ignora TTL e cooldown; lock ocupado → `em_andamento`.
Config: `SISPAG_LOTES_SYNC_TTL_MIN` (default 30), `SISPAG_LOTES_SYNC_COOLDOWN_MIN` (default 5).
- Aceite: teste por estado com relógio injetado; run `running` velha (> 10 min) não bloqueia.

### T3 — Rotas (backend)
- `POST /sispag/lotes/sincronizar-se-defasado` (`sispag:ver`, `heavyRouteLimiter`) → T2.
- `POST /sispag/lotes/sincronizar` (`sispag:ver`, `heavyRouteLimiter`) → `forcar`.
- `POST /sispag/lotes/:id/sincronizar` → **410** com mensagem apontando para o botão da tela.
- Aceite: testes de rota (200 por estado, 403 sem permissão, 410 na rota antiga).

### T4 — Tela (frontend)
- `useCarteiraAoAbrir` encadeia a sincronização dos lotes **depois** do passo da carteira (mesmo com
  carteira `falhou`), com o mesmo laço de espera para `em_andamento`; ao `atualizada`, recarrega os
  lotes. Status visível ("sincronizando os lotes…" / falha com motivo).
- Botão **"Sincronizar lotes"** no cabeçalho, visível com `sispag:ver`, desabilitado enquanto roda;
  ao terminar recarrega os lotes e mostra o resumo (transicionados).
- `LoteCard`: sai o botão "Sincronizar agora" e o `sincronizarLote`; fica o "sincronizado em".
- Aceite: testes do hook (ordem carteira → lotes; espera em andamento; falha não quebra a carteira)
  e do card (sem botão); DesignSystemReviewer verde.

### T5 — Docs
`DEPLOY.md`/env: as duas variáveis novas; comentário do workflow do cron ("rede de segurança").
`related_files` da regra I11 com os arquivos novos.
