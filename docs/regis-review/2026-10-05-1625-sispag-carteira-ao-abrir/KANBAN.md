# KANBAN — Regis-Review `sispag-carteira-ao-abrir` (2026-10-05)

Escopo: delta do tweak (commits `74bdfe5`, `0c6b649`, `f25c7e6`), `--quick`. **24 cards: P0 = 0, P1 = 0,
P2 = 18, P3 = 6.** Esforço: 21 S, 2 M, 1 L. O texto completo de cada card (Problema, Melhoria Proposta,
Resultado Esperado, métricas, risco, dependências) está na seção "5. Cards Kanban" do arquivo do QA.

Ordem: prioridade, depois esforço (S antes de M antes de L), agrupando por convergência.

## P2 — esforço S

| # | Card | QA | Convergência |
|---|---|---|---|
| 1 | `security-1` Sanitizar o `motivo` de `falha_recente` antes de devolver ao navegador | security | A |
| 2 | `integrability-3` Trocar `motivo` bruto por código de falha classificado | integrability | A |
| 3 | `performance-1` Dar teto de duração ao refresh da carteira e tratar timeout como "em andamento" | performance | B |
| 4 | `availability-2` Impor timeout/abort na chamada de atualização da carteira | availability | B |
| 5 | `performance-2` Isolar o polling do refresh do limiter pesado e distinguir 429 | performance | B |
| 6 | `security-2` Limitar o refresh por usuário e avaliar permissão própria | security | B |
| 7 | `ft-1` Retentar filiais não lidas em vez de tratar leitura parcial como fresca | fault-tolerance | C |
| 8 | `availability-1` Avisar a idade da carteira quando o refresh não conclui | availability | C |
| 9 | `ft-2` Fechar runs `running` mortas no próprio service ou apertar o reaper | fault-tolerance | — |
| 10 | `integrability-1` Validar a resposta de `/carteira/atualizar` com Zod e fechar a união de estados | integrability | — |
| 11 | `deployability-1` Documentar `SISPAG_CARTEIRA_TTL_MIN` e `_COOLDOWN_MIN` no deploy | deployability | D |
| 12 | `deployability-2` Desacoplar o gate de formação da string do cron | deployability | D |
| 13 | `testability-2` Garantir por teste que o `schedule` e o `if` do workflow concordam | testability | D |
| 14 | `deployability-3` Escalonar o cron SISPAG de 15:00 UTC fora do de Permutas | deployability | D |
| 15 | `modifiability-1` Unificar a leitura de env duplicada no EnvironmentProvider | modifiability | D |

## P2 — esforço M e L

| # | Card | QA | Esforço |
|---|---|---|---|
| 16 | `ft-3` Embrulhar upsert, anti-fantasma e fechamento da run em uma transação | fault-tolerance | M |
| 17 | `testability-1` Cobrir o repositório de runs de ingestão contra Postgres real | testability | M |
| 18 | `modifiability-2` Extrair o endpoint e o hook do SISPAG dos arquivos de 900+ LOC | modifiability | L |

## P3 — esforço S

| # | Card | QA |
|---|---|---|
| 19 | `integrability-2` Avisar e recarregar quando as reconferências se esgotam | integrability |
| 20 | `availability-3` Instrumentar idade da carteira e resultado do refresh | availability |
| 21 | `performance-3` Índice em `started_at` e single-flight local | performance |
| 22 | `security-3` Backoff crescente no cooldown após falha repetida | security |
| 23 | `modifiability-3` Alinhar contratos e parâmetros fixos (estados FE/BE, cron, polling) | modifiability |
| 24 | `testability-3` Acrescentar o caso 500 na rota de atualização da carteira | testability |

## Convergências (agrupar em PRs)

- **A — erro cru no contrato:** #1 + #2. Um PR: `motivo` vira código classificado + mensagem fixa em pt-BR.
- **B — refresh sem teto e limiter:** #3 + #4 + #5 + #6. Um PR: deadline/`AbortSignal`, 429 distinto de
  falha, polling fora do `heavyRouteLimiter` de 10/min por IP.
- **C — carteira parcial ou velha sem aviso:** #7 + #8 (+ #19). Um PR.
- **D — configuração operacional:** #11 + #12 + #13 + #14 + #15. Um PR pequeno.
