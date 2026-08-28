# Follow-ups — `conexos-fallback-audit`

Delta da branch `fix/conexos-fallback-audit` (ADR-0041). Origem: `/investigate` de 2026-08-25 +
`/feature-tweak` de 2026-08-28.

**Regis-Review completo:** `docs/regis-review/2026-08-28-1607/REPORT.md` ·
**cards:** `docs/regis-review/2026-08-28-1607/KANBAN.md`

**Score global: 7,45** (média ponderada por peso financeiro) — Performance 8,5 · Deployability 8,0 ·
Fault Tolerance 8,0 · Availability 7,5 · Security 7,5 · Integrability 7,0 · Modifiability 7,0 ·
Testability 6,0.

**P0 = 0 nos 8 QAs** → o gate do `/feature-tweak` passa **sem sub-loop de remediação**.
21 cards abertos (4 P1 → 1 aberto / 2 resolvidos / 1 deferido, 9 P2, 8 P3). **P1/P2/P3 não são
implementados por regra do pipeline** — exceto os que já foram fechados dentro do ciclo, abaixo.

---

## Fechados DENTRO do ciclo (commit `ae3c44c`)

| Card | Achado | O que foi feito |
|---|---|---|
| `fault-tolerance-1` + `modifiability-3` | **A SEXTA ledger.** `solicitacao_numerario` (0032, `NumerarioExecucaoRepository`, alcançável por `routes/permutas.ts:536`) é write-ahead igual às outras e guarda a cadeia com299→fin014→com297 da PERMUTA — ficou de fora porque a lista foi montada pelo sufixo `_execucao`. Achada por **dois agentes independentes**. | Migration `0051` estendida à 6ª tabela e revalidada em Postgres local (replay do zero aplica as 6, 2ª execução no-op); repositório persiste identidade; regra e ADR passam a definir o critério como **"guarda escrita irreversível no ERP"**, não o sufixo. |
| `testability-1` | Assimetria: só 1 de 5 ledgers tinha asserção da nova invariante (20%). | Asserções de identidade nos 6 ledgers (medido: 9–11 ocorrências por arquivo de teste). |
| `conciliacao-execucao-tests` | `ConciliacaoExecucaoRepository` era o único `*Execucao*` sem **nenhum** arquivo de teste. | Arquivo criado. `NumerarioExecucaoRepository` também não tinha — criado junto. Suite: 1493 → **1510** testes, 110 → **112** suites. |

## Segurado pelo Yuri (deferred-by-decision, não é oversight)

| Card | Prioridade | Nota |
|---|---|---|
| `conexos-cred-enc-key-config` | **P1** (Integrability) + P2 (Security) | Declarar `CONEXOS_CRED_ENC_KEY` no `render.yaml` (`sync: false`) e no `.env.example`. **Adiado por decisão explícita do Yuri em 2026-08-28.** Não afeta produção (a chave está setada lá, senão o cadastro de vínculo teria falhado no `encrypt`). Afeta todo ambiente que não seja produção: sem a chave, `SecretCipher.isEnabled()` → `false`, a coluna Conexos some da tela de Usuários e **todo** vínculo degrada para o robô. Reproduzido em 2026-08-25: `testarVinculo` devolveu `falha` para os dois usuários vinculados contra o `.env` local. Dois QAs independentes o classificaram P1/P2 — vale revisitar a decisão antes do 2º tenant ou de qualquer rotação de chave. |

## P1 aberto

| Card | Nota |
|---|---|
| `integrability-2` | 4 arquivos em `domain/` importam `ConexosService` do pacote **legado** `services/`. Propõe trocar `ConexosRequestState.resolved: ConexosService` por uma interface mínima `{ getCapturedUsnCod(): string \| null }`. **Pré-existente** — o delta adiciona 1 import a um padrão que já existia; encarece a substituição de transporte prevista para a v0.2. |

## P2 (9)

`availability-1` (blindar `avisarDegradacao`/`degradarParaRobo` contra exceção do path de
observabilidade — o docstring promete "nunca lança" e o código não impõe) ·
**`observability-business-warn`** (consumer + alarme + dedup sobre `BUSINESS_WARN` com
`motivo in (decrypt, login)` — **6 cards de 5 QAs mergeados aqui**; é a metade que falta da
ADR-0041: o registro fechou, a notificação não) · `integrability-1` (mover
`ConexosIdentityProvider` para fora de `domain/client/` — é query in-process, não adapter externo;
hoje 5 repositórios importam "para cima") · `integrability-4` (teste-guarda contra chamar
`begin*` fora de `conexosRequestContext.run`) · `modifiability-1` (extrair fragmento SQL de
identidade em helper compartilhado — ~60 linhas quase-idênticas × 6) · `security-1` + `security-2`
(sanitizar e travar por teste o campo `erro` do `warn`: hoje seguro, mas a garantia depende de 3
lugares independentes) · `testability-3` (teste de aplicação de migrations em Postgres docker) ·
`testability-4` (integração leve resolver → provider → ledger).

## P3 (8)

`deployability-1` (portar `bump-version.ps1` para Node — `pwsh` não existe nesta máquina, o bump
deste release foi replicado à mão e conferido) · `deployability-2` (`render.yaml:22` declara um
`preDeployCommand` que **nunca roda**; a autoridade real de ordering é o `BootMigrator`) ·
`deployability-3` (runbook de release + verificação do `/health`) · `fault-tolerance-2` (try/catch
no logger) · `fault-tolerance-4` (documentar e testar a semântica de identidade sob **retry
cross-identity**: hoje "primeira identidade vence" via COALESCE — veredito do QA foi *semântica
correta, documentar*) · `modifiability-2` (tripwire de schema exigindo as colunas em toda ledger) ·
`security-5` (runbook de rotação da chave — hoje rotacionar quebra 100% dos vínculos) ·
`testability-5` (asserção explícita "log falhar não derruba a execução").

## Dívida assumida pelo delta

| # | Item | Nota |
|---|---|---|
| F-3 | As 35 execuções históricas de `MARILYN_MUTAFCI` e todas as linhas anteriores à `0051` ficam com identidade NULL | Sem backfill por decisão da ADR-0041: a identidade usada no passado não está gravada em lugar nenhum, e inferi-la do vínculo atual seria um palpite na trilha de auditoria. NULL = "não capturada". |
| F-4 | O `warn` de I-1 sai 1×/request que degrada, sem dedup | Deliberado. O `state.resolved` já limita a 1 por request (não 1 por ledger write). Cenário do incidente = 13 linhas/dia. Se virar ruído, o caminho é `observability-business-warn`. |

## Causa-raiz operacional (fora do código, com o time)

`MARILYN_MUTAFCI` não completa `POST /login` no Conexos. Senha incorreta, conta bloqueada e limite
de sessões produzem o mesmo sintoma; o `warn` de I-1 agora separa `decrypt` de `login`, mas não as
causas *dentro* de `login`. Diagnóstico: `GET /me/conexos-status` como o usuário, e a
presença/ausência de `columbia:user:MARILYN_MUTAFCI` em `conexos_sessions`.

## Gates

- **PatternGuardian** — verificado inline (Rules #5, #7, #8, #9). Sem achado. `getCapturedUsnCod()`
  em `services/conexos.ts` segue o estilo do arquivo legado — coerente com o entorno (`integrability-4`, P3).
- **DesignSystemReviewer** — n/a: `src/frontend/` não foi tocado.
- **Ground-Truth Validation** — n/a: nenhuma lógica monetária, fórmula, sinal, classificação ou
  filtro de fetch financeiro mudou.
- **Regis-Review** — ✅ executado (8 QAs + consolidator), run `2026-08-28-1607`, **0 P0**.
