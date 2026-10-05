# sispag-carteira-ao-abrir — follow-ups do Regis-Review

Regis-Review de 2026-10-05, escopo restrito ao delta, `--quick`. **P0 = 0, P1 = 0**: nada re-entrou no
loop. Os 24 cards (18 P2, 6 P3) abaixo **não foram implementados** neste tweak. Relatório e cards completos:
`docs/regis-review/2026-10-05-1625-sispag-carteira-ao-abrir/` (`REPORT.md`, `KANBAN.md`, um arquivo por QA).

## Ordem sugerida (4 PRs pequenos)

**A — erro cru no contrato (começar por aqui).** `security-1` + `integrability-3`: `falha_recente.motivo`
devolve `run.error_message` cru a qualquer `sispag:ver` (`CarteiraAtualizacaoService.ts:94`). Trocar por
código classificado + mensagem fixa em pt-BR; texto cru só em log e em `pagamento_ingestao_run`.

**B — refresh sem teto e limiter.** `performance-1`, `availability-2`, `performance-2`, `security-2`: deadline
e `AbortSignal` no refresh síncrono; 429 não pode virar "falhou"; polling fora do `heavyRouteLimiter`
(10/min por IP); avaliar limite por usuário.

**C — carteira parcial ou velha sem aviso.** `ft-1`, `availability-1` (+ `integrability-2`): leitura parcial
de filial é gravada como `success` e a carteira fica "fresca" por 30 min; a tela precisa dizer a idade
quando o refresh não conclui.

**D — configuração operacional.** `deployability-1/2/3`, `testability-2`, `modifiability-1`: documentar
`SISPAG_CARTEIRA_TTL_MIN` e `SISPAG_CARTEIRA_COOLDOWN_MIN` em `DEPLOY.md`, `render.yaml` e `.env.example`;
ligar por teste o `schedule` ao `if` do workflow (literal `'0 10 * * *'` duplicado); tirar o cron das
15:00 UTC do horário de Permutas; unificar a leitura de env duplicada.

## Demais cards

| Card | Prioridade | Esforço |
|---|---|---|
| `integrability-1` Validar a resposta de `/carteira/atualizar` com Zod e fechar a união de estados | P2 | S |
| `ft-2` Fechar runs `running` mortas no serviço ou apertar o reaper | P2 | S |
| `ft-3` Transação para upsert + anti-fantasma + fechamento da run | P2 | M |
| `testability-1` Cobrir o repositório de runs contra Postgres real | P2 | M |
| `modifiability-2` Extrair endpoint e hook dos arquivos de 900+ LOC | P2 | L |
| `availability-3` Instrumentar idade da carteira e resultado do refresh | P3 | S |
| `performance-3` Índice em `started_at` e single-flight local | P3 | S |
| `security-3` Backoff crescente no cooldown | P3 | S |
| `modifiability-3` Alinhar contratos e parâmetros fixos | P3 | S |
| `testability-3` Caso 500 na rota de atualização | P3 | S |

## Regra proposta para o CLAUDE.md (estágio de aprendizado do tweak)

> Resposta HTTP 200 que carrega mensagem de erro de integração precisa passar pelo mesmo saneamento do
> `errorMiddleware`. Campo de texto livre vindo de `error_message` não sai para o navegador: sai um código
> estável e uma mensagem fixa.
