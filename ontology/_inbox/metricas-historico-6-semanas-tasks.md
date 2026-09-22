# Tasks — metricas-historico-6-semanas

> `/feature-tweak metricas "a tela Métricas mostra as últimas 6 semanas; o report segue no ciclo 6"`
> Branch `fix/metricas-historico-6-semanas`, base `origin/main` (6d3b5b5).
> **`entity_changed = false`** — read-model, sem entidade/ação/estado novo. Emenda a ADR-0045 D4.

## Sintoma medido

`/metricas` em produção mostra `—` em tudo. Não é defeito: é a ADR-0045 D4.
`metricas.serie_inicio()` devolve `TIMESTAMP '2026-09-11 18:00:00'`, e hoje é 2026-09-16 — existe
**uma** janela, `11/09 18:00 → 18/09 18:00`, ainda aberta (`parcial = true`). As linhas de `%` só
são emitidas `WHERE tentativas > 0`; sem execução de permuta/SN desde sexta, sobram as duas linhas
de `R$` valendo 0. O `ultima = semanas.find(s => !s.parcial) ?? semanas[0]` do `page.tsx` cai na
semana parcial, e os KPIs saem `—` / `R$ 0,00`.

## Decisões do Yuri (2026-09-16, entrevista cirúrgica)

| # | Pergunta | Resposta |
|---|----------|----------|
| D-a | Até onde recuar? | **Últimas 6 semanas — `2026-08-07 18:00`.** Não é janela deslizante. |
| D-b | Vale para o report semanal? | **Não. Só a tela.** O `kavex-report-ciclo` segue ancorado em `2026-09-11 18:00`. |
| D-c | Marcar as semanas recuperadas? | **Não.** Aparecem como qualquer outra — sem flag `reconstruido`. |

## Por que `2026-08-07` e não "6 semanas atrás"

`2026-08-07` e `2026-09-11` são **os dois sexta-feira**, separados por exatamente **35 dias = 5
semanas**. O `generate_series(p_serie_inicio, p_agora, '7 days')` da 0058 passa a emitir
`08-07, 08-14, 08-21, 08-28, 09-04, 09-11` — **a mesma grade** da série vigente, deslocada para
trás. Nenhuma janela fechada muda de fronteira, então as linhas que o report lê continuam byte a
byte as mesmas. Uma data que não fosse sexta teria rebatido a grade inteira e mudado todo número já
reportado.

## Como D-b é garantido (e não só prometido)

`kavex-report-ciclo/scripts/metrics.py` declara `--inicio` e `--fim` como `required=True` e sempre
monta `GET /metricas/ciclo?inicio=&fim=`. Ainda assim, **não dependemos disso**: o recuo é
*opt-in* por parâmetro. Sem `?historico=true`, a rota responde exatamente o que responde hoje —
piso `serie_inicio()`, `serieInicio = 2026-09-11T18:00:00`. O report não muda uma linha de código e
não muda um byte de resposta. Quem pede o recuo é a tela.

É também o que mantém D-c coerente: com `historico=true` o `serieInicio` devolvido é o piso
**efetivamente usado** (`2026-08-07`), então o rodapé "Série iniciada em 07/08/2026" e a tabela
contam a mesma história. Devolver `2026-09-11` junto com semanas de agosto seria uma flag
involuntária — exatamente o que D-c recusa.

## Tarefas

### T1 — `metricas.historico_inicio()` (migration 0060)

`src/backend/migrations/0060_metricas_historico_inicio.sql` — **aditiva**.

- `CREATE OR REPLACE FUNCTION metricas.historico_inicio() RETURNS timestamp` → `TIMESTAMP '2026-08-07 18:00:00'`, `IMMUTABLE`, `SET search_path = ''`.
- `REVOKE ALL ... FROM PUBLIC`, como as duas funções da 0058.
- **Não toca** `serie_inicio()`, `metricas_ciclo()` nem `vw_metricas_ciclo`.

**Aceite**
- [ ] `serie_inicio()` continua devolvendo `2026-09-11 18:00:00` — a 0060 não a redefine.
- [ ] `vw_metricas_ciclo` segue ancorada em `serie_inicio()` e só com semanas fechadas.
- [ ] Sem DML, sem `GRANT`, sem `SECURITY DEFINER`, sem role novo (ADR-0045 D5).
- [ ] Idempotente: re-rodar não altera nada.
- [ ] Guarda estática nova em `vwMetricasCiclo.test.ts` (roda sem banco).

### T2 — o piso vira escolha da chamada (backend)

- `MetricaCiclo.ts`: `MetricasCicloFiltro` ganha `historico?: boolean`.
- `MetricasCicloRepository.listar`: piso = `metricas.historico_inicio()` quando `historico`, senão `metricas.serie_inicio()`. É escolha entre **dois literais SQL fixos**, nunca interpolação de entrada.
- `MetricasCicloRepository.serieInicio(historico)`: devolve o piso em vigor.
- `MetricasCicloService.ler`: repassa `historico`.
- `routes/metricas.ts`: `historico: z.enum(['true','false']).optional()` no Zod do boundary. **Não** `z.coerce.boolean()` — `'false'` viraria `true`.

**Aceite**
- [ ] `GET /metricas/ciclo` sem o parâmetro → SQL com `metricas.serie_inicio()`, `serieInicio = 2026-09-11T18:00:00`. Resposta idêntica à de hoje.
- [ ] `GET /metricas/ciclo?historico=true` → SQL com `metricas.historico_inicio()`, `serieInicio = 2026-08-07T18:00:00`.
- [ ] `?historico=false` → tratado como ausente (e não como `true`).
- [ ] `?historico=xpto` → 400, sem tocar o banco.
- [ ] `inicio`/`fim` seguem funcionando iguais, sobre o piso escolhido.
- [ ] As 9 colunas do contrato + `parcial`/`apurado_ate` inalteradas em ambos os caminhos.

### T3 — a tela pede o histórico

- `src/frontend/lib/metricas.ts`: `fetchMetricasCiclo()` chama `…/metricas/ciclo?historico=true`.
- `src/frontend/app/metricas/page.tsx`: **sem mudança de lógica**. Com 5 semanas fechadas na
  resposta, `semanas.find((s) => !s.parcial)` passa a achar `04/09 → 11/09` e os KPIs deixam de cair
  na parcial vazia. O rodapé "Série iniciada em" passa a dizer `07/08/2026` porque o backend devolve
  o piso em vigor.

**Aceite**
- [ ] A tela emite `?historico=true`.
- [ ] Com semanas fechadas na resposta, os KPIs mostram a última **fechada**, não a parcial.
- [ ] A semana em curso segue no histórico com "em andamento · parcial até …" (D-c não afrouxa a marca de *parcial*, que é outra coisa).
- [ ] Nenhuma semana recuperada ganha marca própria (D-c).

## Fora de escopo

- Janela deslizante (recusada em D-a): `2026-08-07` é fixo e **envelhece** — em dezembro serão ~18 semanas, não 6. Consequência registrada na ADR-0048, não corrigida aqui.
- Backfill no report / mover `serie_inicio()` (recusado em D-b).
- Coluna `reconstruido` no contrato (recusado em D-c).
- `permuta_alocacao_execucao` apagar linha quando o borderô é excluído (ADR-0045 D4): as semanas de agosto podem **subnotificar** Permutas. Não é consertável nesta fatia — o conserto de fundo é a tabela de eventos append-only já registrada como follow-up na ADR-0045.

## Gates

`npm run typecheck` · `npm run lint` · `npm test` (backend e frontend) · PatternGuardian ·
DesignSystemReviewer (toca `src/frontend/`) · SpecVerifier · Regis-Review.
**Ground-Truth Validation: não se aplica** — nenhuma lógica monetária muda. As fórmulas de `valor`,
`%`, `finalizada` e as fronteiras de janela são as da 0058, intocadas; só o piso do
`generate_series` se move, e sobre a mesma grade de sexta 18:00.
