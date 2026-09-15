# Regis-Review — follow-ups do tweak `permutas-excecao-manual` (ADR-0047)

**Branch:** `fix/permutas-excecao-manual` · **Data:** 2026-09-15 · **Run:** `docs/regis-review/2026-09-15-1835-permutas-excecao-manual/`
**Resultado do gate:** score consolidado **8,1** · **0 P0** · 2 P1 · 14 P2 · 11 P3 (27 cards após dedupe). Nenhum card re-entrou no loop (só P0).
Lista completa com esforço e QAs em [`KANBAN.md`](../../docs/regis-review/2026-09-15-1835-permutas-excecao-manual/KANBAN.md); narrativa em [`REPORT.md`](../../docs/regis-review/2026-09-15-1835-permutas-excecao-manual/REPORT.md).

## Prioridade recomendada (antes de nova feature em Permutas)
1. **`security-1` (P1, S)** — escapar prefixo de fórmula (`= + - @ \t \r`) nas células de texto de usuário do Excel (justificativa/autor da exceção). ExcelJS grava texto, autoria é só admin — defesa em profundidade, ~3 linhas, reutilizável.
2. **`availability-1` (P1, S)** — fail-open com `BUSINESS_WARN` se `listAtivas` falhar na eleição (não abortar a run inteira do cron); `availability-2` (P2) idem no `/gestao`.

## P2
`availability-3` lock do migrate do cron · `deployability-1` kill-switch das rotas de exceção · `deployability-4` contador de exceções ativas/aplicadas · `integrability-2` 401 identidade × sessão expirada · `integrability-3` utilitário `autorDoToken` · `modifiability-1` guarda BE/FE de uma const · `rotulo-motivo-be-fe` fonte única de rótulos · `fault-tolerance-1` reaper da invariante · `fault-tolerance-2` medir snapshot antes da 0059 em prd · `security-2` RBAC de leitura do `/gestao` · `availability-4` VALIDATE retroativo no snapshot · `performance-1` retenção do snapshot · `testability-1` teste da 0059 em Postgres real.

## P3
`availability-5` · `deployability-2` (informacional — runner rastreia migrations por nome) · `deployability-3` · `performance-2` · `performance-3` · `fault-tolerance-3` · `testability-2` · `testability-3` · `testability-4` · `modifiability-3` · `modifiability-4`.

## Follow-ups de implementação (AutoLoopRunner)
- Repo não tem `notify()`/NotificationCenter do design system — mutações seguem com `toast.*`.
- Formulário do diálogo de exceção poderia usar FormField + react-hook-form + Zod (não bloqueante).
- Riscos residuais R1–R4 do ADR-0047: janela de segundos na corrida marcar × ingestão em curso; aviso por run enquanto a exceção estiver inativa; rollback de código devolve 8721 a bloqueada na próxima ingestão (tabela intacta); falha de leitura do Conexos mostra bloqueada naquela run.
- Verificação pós-deploy: marcar 8721 com justificativa → "Atualizar" → "Já permutado" + tag "Exceção manual".
