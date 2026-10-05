# Follow-ups — permuta-centavos-adto (I-Write-10 / ADR-0062)

Regis-Review `docs/regis-review/2026-10-05-2134-permuta-centavos-adto/` (`REPORT.md`, `KANBAN.md`).
Nenhum P0, então nada re-entrou no loop. Os P1/P2/P3 abaixo não foram implementados, conforme a regra
do pipeline. PatternGuardian passou; os 3 P3 dele sobre o job de validação estão incluídos.

| Card | Prioridade | Finding |
|---|---|---|
| integrability-1 | P2 | `bxaMnyValorPermuta` sem Zod; não numérico vira NaN e o teto vira no-op silencioso. Sem fixture gravada do passo 3. |
| testability-1 | P2 | Faltam testes: `bxaMnyValorPermuta` ausente, DESCONTO com excesso > R$1 e fronteira R$1,00 contra R$1,01. |
| availability-1 | P2 | Contar eventos LIMITADA e fora-da-tolerância no painel de operação (hoje só log). |
| deployability-1 | P2 | Sem kill-switch e rollback não documentado no ADR-0062 (rollback = revert + redeploy). |
| modifiability-1 | P2 | `ancorarVariacaoNoAdto` e `limitarAoDisponivelDoAdto` duplicam estrutura; extrair colaborador puro. |
| modifiability-3 | P2 | `ReconciliacaoPermutaService.ts` com 1231 LOC (alvo ≤ 600); dividir no próximo tweak. |
| fault-tolerance-1 | P3 | Fora da tolerância só avisa e segue para o ERP recusar; decidir com produto se vai para a fila de exceção. |
| fault-tolerance-2 | P3 | Passo 3 sem `bxaMnyValorPermuta` desliga o teto sem log. |
| integrability-2 | P3 | A ordem âncora → teto é invariante implícito, coberto por um teste só. |
| availability-2 | P3 | Falta teste de retentativa depois de uma perna já gravada. |
| security-1 | P3 | O job usa `rejectUnauthorized: false`, como outros dois probes. |
| security-2 | P3 | O valor original da variação, antes do corte, só fica no log BUSINESS_INFO. |
| testability-2 | P3 | Nenhum teste confere o log LIMITADA; o job acessa o método privado por cast. |
| testability-3 | P3 | Extrair a aritmética monetária para uma unidade pura e reduzir os stubs. |
| modifiability-2 | P3 | O cast `as unknown as` no job escapa do typecheck. |
| deployability-2 | P3 | O validador não tem script npm. |
| performance-1 | P3 | Registrar `durationMs` por baixa. |

## Ação operacional fora do código (pendente)

- **Borderô 23184** (fil 2, em aberto): no Conexos, juros do título 2 de 419,08 para 419,07, ou
  excluir o borderô e refazer a permuta depois do deploy da v0.54.1.
- **Borderô 23188** (fil 2, em aberto): desconto da perna 39083 de 472,06 para 472,07, ou excluir e
  refazer.
- **Borderô 16596** (julho, execução em `error`): conferir se o adto 17894 ainda tem a permuta
  pendente e, se tiver, reprocessar depois do deploy.
