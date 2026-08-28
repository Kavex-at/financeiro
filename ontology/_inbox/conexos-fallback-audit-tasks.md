# tasks.md — Conexos: o fallback para o robô deixa de ser invisível

> `/feature-tweak conexos "fix: usuário com vínculo Conexos caiu no robô sem deixar rastro —
> logar o fallback e registrar no ledger a identidade do ERP que realmente executou"`
> Branch: `fix/conexos-fallback-audit` · Worktree: `~/kavex-worktrees/conexos-fallback-audit`
> Ontologia: ADR-0041 + `business-rules/identidade-execucao-conexos.md` (aprovados antes do código)

## Estado de partida

A investigação de 2026-08-25 mostrou `MARILYN_MUTAFCI` com vínculo cadastrado, login no ERP nunca
completando, e 35 execuções (13 num dia só, todas `settled`/`dry_run=false`) saindo pelo robô. O
`resolveForUser` tem três `catch` mudos; os ledgers guardam só `executado_por` (usuário da
plataforma). Diagnóstico só foi possível pela **ausência** de linha em `conexos_sessions`.

Este tweak **não muda o comportamento** — o fallback continua acontecendo e continua não
interrompendo ninguém. Muda o que fica registrado.

| | Hoje | Depois |
|---|---|---|
| Vínculo quebra em runtime | silêncio total | `warn` estruturado (I-1) |
| "Esta baixa saiu no nome de quem?" | abrir o Conexos linha a linha | consulta ao ledger (I-2) |
| Fallback sem vínculo / em job | silêncio | silêncio (é o caminho normal) |
| Usuário no meio da execução | não é avisado | não é avisado (banner de login já cobre) |

---

## T1 — O resolver passa a falar (I-1) e a publicar a identidade resolvida

**Mudança.**
- `ConexosRequestState` ganha `identity?: { conexosUsername: string; viaRobo: boolean }`.
- `ConexosSessionResolver.resolve()` publica a identidade em **toda** resolução dentro de request —
  tanto a do usuário vinculado quanto a do robô.
- `resolveForUser` injeta `LogService` e emite `warn` nos **dois** caminhos de degradação com vínculo
  presente: falha ao decifrar (`motivo: 'decrypt'`) e falha de login (`motivo: 'login'`). Campos
  mínimos: `platformUsername`, `conexosUsername`, `motivo`, `erro` (mensagem original).
- `ConexosService` ganha `getCapturedUsnCod(): string | null` — acessor puro do `usnCod` já
  capturado no `/login`, **sem** disparar login.
- Novo `ConexosIdentityProvider` (`@singleton() @injectable()`) — lê o store e devolve
  `{ conexosUsername, viaRobo, usnCod }`, resolvendo o `usnCod` **na hora da leitura** a partir de
  `state.resolved` (na hora da escrita no ledger o login já aconteceu; no `beginExecution` pode
  ainda não ter acontecido).

**Critérios de aceite.**
- Usuário SEM vínculo → robô, **nenhum** log (é o caminho normal, logar viraria ruído).
- Fora de request (job/cron) → robô, **nenhum** log, `current()` devolve `undefined`.
- Usuário COM vínculo e `decrypt` falhando → robô + 1 `warn` com `motivo: 'decrypt'`.
- Usuário COM vínculo e `ensureSid` rejeitando → robô + 1 `warn` com `motivo: 'login'`.
- O `warn` **nunca** contém a senha, cifrada ou em claro.
- Nenhum caminho passa a lançar: as quatro degradações continuam devolvendo o robô.
- `current()` reflete `viaRobo: true` quando o usuário vinculado degradou, e `false` quando a
  sessão dele foi de fato usada.

## T2 — Migration `0051`: as colunas de identidade nos seis ledgers

**Mudança.** `src/backend/migrations/0051_execucao_identidade_conexos.sql` adiciona, em
`permuta_alocacao_execucao`, `solicitacao_numerario_execucao`, `recebimento_execucao`,
`remessa_execucao`, `conciliacao_execucao` e `solicitacao_numerario`:

```sql
conexos_username TEXT   -- login do ERP que executou (usuário vinculado ou robô)
conexos_usn_cod  TEXT   -- usnCod do /login; TEXT p/ espelhar conexos_sessions.usn_cod
```

**Critérios de aceite.**
- `ADD COLUMN IF NOT EXISTS` nas 6 tabelas — idempotente, re-rodável.
- Ambas NULLABLE, sem default. Linhas históricas ficam NULL = "não capturada" (nunca "robô").
- Nenhum backfill. Nenhum índice (não há consulta por identidade no escopo).
- `npm run migrate` aplica limpo sobre um banco já em `0050`.

## T3 — Os seis ledgers persistem a identidade (I-2)

**Mudança.** Cada repositório de execução injeta `ConexosIdentityProvider` e grava as duas colunas:
- no INSERT de write-ahead (`beginExecution` / `insertIntent`);
- no `markSettled` / `markError`, preenchendo **só quando ainda nulo** (`COALESCE(coluna, $novo)`) —
  no `beginExecution` a sessão pode não ter sido resolvida ainda, no terminal ela sempre foi.

Repositórios: `PermutaExecucaoRepository`, `SolicitacaoNumerarioExecucaoRepository`,
`RecebimentoExecucaoRepository`, `RemessaExecucaoRepository`, `ConciliacaoExecucaoRepository` e
`NumerarioExecucaoRepository` (a sexta, `solicitacao_numerario` — sem o sufixo `_execucao` no nome;
achada pelo Regis-Review e corrigida dentro do ciclo).

**Critérios de aceite.**
- Execução de usuário com vínculo válido → linha com o login **dele** e o `usnCod` dele.
- Execução degradada para o robô → linha com o login **do robô**.
- `ON CONFLICT` de linha `settled` **preserva** a identidade original, como já faz com
  `executado_por` (não regride idempotência).
- Identidade indisponível → colunas ficam NULL; nenhuma escrita falha por causa disso.
- `dry_run` não é tratado de forma especial: se houve sessão resolvida, registra.
- SQL 100% parametrizado (Rule #5); nenhuma assinatura de service muda.

---

## Fora de escopo (decidido na entrevista)

- Bloquear execução quando a identidade não é a do usuário — ADR-0041 rejeita explicitamente.
- Aviso por-ação na UI — o banner de login já cobre; nada em `src/frontend/`.
- Backfill das linhas históricas — a identidade passada não é recuperável.
- Declarar `CONEXOS_CRED_ENC_KEY` no `render.yaml`/`.env.example` — **segurado pelo Yuri**;
  vira follow-up no inbox, não entra neste delta.
