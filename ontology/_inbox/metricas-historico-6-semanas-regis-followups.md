# Regis-Review follow-ups — metricas-historico-6-semanas

> Gate do `/feature-tweak` rodado em 2026-09-18 sobre o delta da branch `fix/metricas-historico-6-semanas`.
> **Resultado: PASSA — 0 findings P0.** Nada re-entrou no loop.
>
> Os itens abaixo **não foram implementados**, por regra do pipe: só P0 volta ao ciclo
> OfficeHours → Ontology → TaskScoper → AutoLoopRunner. P1/P2/P3 ficam aqui.
>
> - Relatório: `docs/regis-review/2026-09-16-1650-metricas-historico/REPORT.md`
> - Kanban: `docs/regis-review/2026-09-16-1650-metricas-historico/KANBAN.md`
> - Seções por QA: `docs/regis-review/2026-09-16-1650-metricas-historico/<qa>.md`

## Placar

| QA | Score | Findings |
|----|-------|----------|
| Deployability | 8 | 2 |
| Security | 8 | 2 |
| Testability | 8 | 2 |
| Availability | 7 | 3 |
| Integrability | 7 | 3 |
| Modifiability | 7 | 3 |
| Fault Tolerance | 7 | 3 |
| Performance | 6 | 2 |

**Score consolidado: 7,3/10.** Cards: **0 P0 · 3 P1 · 11 P2 · 6 P3** (20 no total).

## P1 — tratar primeiro

### `performance-1` — `metricas_ciclo()` custa O(janelas × linhas), e o piso fixo não tem teto

`F-performance-1`, `performance.md`. **Medido**, não estimado: o agente subiu um Postgres 17, aplicou
as 59 migrations e rodou `EXPLAIN (ANALYZE, BUFFERS)`. Com 5.000 linhas fixas por ledger, **6 janelas
= 19,6 ms** e **111 janelas = 333,9 ms** — 17× mais lento para 18,5× mais janelas. O plano mostra
`Nested Loop Left Join` com `Materialize (loops=111)`: o ledger é re-lido e re-filtrado uma vez por
janela (`Rows Removed by Join Filter` = linhas × janelas, 555.000 em W=111).

Nem `permuta_alocacao_execucao` nem `solicitacao_numerario_execucao` têm índice em `criado_em`, e a
condição de join envolve `AT TIME ZONE`, então nem um índice simples resolveria — precisaria de índice
de expressão ou reescrita. `permuta_bordero(fil_cod, bor_cod)` está coberto pela PK da migration 0020.

**Hoje é invisível** (~5,5 ms no volume real, ~200 linhas). Como o piso `2026-08-07` é fixo, o número
de janelas cresce +1 por semana para sempre, e o ledger cresce junto: o custo é ~quadrático no tempo
decorrido desde o piso. Projeção: centenas de ms em ~1 ano, possivelmente >1 s em ~2 anos, **sem
nenhuma mudança de código**.

> Ligado à decisão do Yuri de usar data FIXA em vez de janela deslizante (ADR-0048, D2). A janela
> deslizante resolveria o crescimento de graça; foi oferecida e recusada. Reabrir isso é decisão de
> negócio, não conserto técnico.

### `testability-1` — CI roda `test:sql`, mas nada obriga o job a passar para o merge

`F-testability-1`, `testability.md`. `gh api repos/:owner/:repo/branches/main/protection` →
**`404 Branch not protected`**. Baseline: **0 required status checks**, alvo 3. O job `backend-sql`
(Postgres 17 real) roda em todo `pull_request`, mas um merge com CI vermelho não é bloqueado por nada.
**Pré-existente**, não introduzido por este delta.

### `integrability-1` — o contrato cross-repo é verificado por leitura, não por execução

`F-integrability-1`, `integrability.md`. A garantia central da ADR-0048 ("o report não muda") depende
de uma propriedade do `kavex-report-ciclo`: o `metrics.py` declara `--inicio`/`--fim` como
`required=True` e nunca envia `historico`. Isso foi conferido lendo o script real — mas ele vive em
outro repositório (`~/.claude/skills/`), **sem pin de versão**, e `find .github/workflows -exec grep
metrics.py` volta vazio. Nenhum teste consumidor-driven executa o script contra este backend em CI.

## P2 — dívida defensável

| Card | Finding | Resumo |
|------|---------|--------|
| `fault-tolerance-1` | F-ft-1 | Exposição à subnotificação de Permutas cresce ~5× (0 → 5 semanas fechadas, a mais antiga com ~42 dias) sem instrumentação de detecção. O `DELETE FROM permuta_alocacao_execucao WHERE bor_cod = $borCod` vive em `PermutaExecucaoRepository.ts:268`. Risco **declarado e decidido** (ADR-0048 D4), não oculto. |
| `fault-tolerance-2` | F-ft-2 | A tela avisa que a semana **parcial** ainda muda, mas não avisa que as **fechadas** também podem mudar (borderô cancelado depois). Risco de o analista comparar a tela com um report já entregue e ver números diferentes sem explicação na UI. |
| `availability-1` | F-av-1 | `PostgreeDatabaseClient` não define `statement_timeout` de query — só `connectionTimeoutMillis` (5 s). Com `poolMaxConnections=5` compartilhado, uma query presa esgota o pool para outras rotas. Pré-existente. |
| `availability-2` | F-av-2 | Sem kill-switch por env para desligar `?historico=true` sem redeploy, ao contrário do padrão já usado no `render.yaml` para SISPAG/Recebimentos/Conexos. |
| `deployability-1` | F-dep-1 | A compatibilidade entre ordens de deploy FE/BE depende de `cicloQuerySchema` **não** ser `.strict()` (chave desconhecida é descartada, não rejeitada). Nenhum teste trava isso como contrato. |
| `security-1` | F-sec-1 | `GET /metricas/ciclo` sem `requireRole` — qualquer autenticado lê. **Pré-existente** (idêntico em `origin/main`); a rota está atrás do JWT global (`buildApp.ts`). Agravado por este delta expor 6 semanas onde expunha 1. |
| `modifiability-1` | F-mod-1 | Um 3º piso não cabe no booleano sem tocar 5 arquivos. Não corrigir preventivamente — esperar o gatilho. |
| `modifiability-2` | F-mod-2 | `2026-08-07` é constante hardcoded no SQL, não configuração. Trocar por janela deslizante custa 1 arquivo, mas o teste de alinhamento de grade compara **literais** e não cobriria uma expressão dinâmica. |
| `integrability-2` | F-int-2 | Sem estratégia de versionamento de API; compatibilidade resolvida por flag ad hoc caso a caso. |
| `integrability-3` | F-int-3 | O endpoint não distingue chamadas por origem (`historico` presente vs. ausente) — falha do consumo da skill não gera sinal proativo. |
| `performance-2` | F-perf-2 | `GET /metricas/ciclo` sem cache e sem teto de paginação; amplifica `performance-1` sob concorrência. |

## P3 — anotados

`fault-tolerance-3` (sem retry/backoff na leitura; mitigado pelo botão "Recarregar") ·
`availability-3` (falha não degrada para a janela de 1 semana) ·
`deployability-2` (`autoDeploy: true` sem gate humano nem canário — pré-existente) ·
`modifiability-3` (nomenclatura do flag propagado por 5 camadas; binding time está correto) ·
`testability-2` (12 de 13 guardas estáticas são regex sobre o texto do SQL — tautológicas quanto a
comportamento — sem rótulo que as distinga da única guarda semântica real) ·
`security-2` (manter o rastreamento explícito cliente → SQL como guarda de regressão).

## Não-finding registrado

`F-security-2` — injeção de SQL em `MetricasCicloRepository` foi **investigada e refutada** de forma
independente por dois revisores (PatternGuardian e `qa-security`), cada um rastreando `req.query` até
a string do SQL. Fica registrado porque a ausência de achado, quando a pergunta foi feita
explicitamente, também é resultado. O consolidador o transformou num card P3 de **preservação** do
padrão (não de correção) — daí ele aparecer na lista de P3 acima.

## Três fios cross-QA (não duplicar card ao tratar)

1. **Piso fixo que envelhece** — `modifiability-2` (deriva de rótulo) e `performance-1` (custo medido)
   são consequências distintas da **mesma** causa-raiz.
2. **Zod sem `.strict()`** — é o que *garante* a compatibilidade de deploy (`deployability-1`) e o que
   alguém pode quebrar "padronizando" schemas (`modifiability`). Quem mexer num precisa ler o outro.
3. **Ausência de sinal cross-repo** — `integrability-1`/`-3` e `fault-tolerance-1`/`availability`
   apontam para a mesma lacuna de observabilidade.
