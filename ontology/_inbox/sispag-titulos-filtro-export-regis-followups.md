# Follow-ups — Regis-Review de `sispag-titulos-filtro-export`

> Run `--quick` sobre o delta `e832057` em 2026-10-08: **0 P0 / 0 P1**, 5 P2, 5 P3, overall 8.1.
> Relatório: `docs/regis-review/2026-10-08-1958-sispag-titulos/REPORT.md` · cards: `KANBAN.md` (mesma pasta).
> Pelo gate, só P0 é remediado no ciclo; os itens abaixo NÃO foram implementados.

| Card | Prioridade | Esforço | Finding |
|---|---|---|---|
| availability-1 (+ performance-1) | P2 | S | Log do export sem `durationMs`; leituras sem `statement_timeout` (pool compartilhado com remessa/lote). |
| security-1 | P2 | S | Log dos 2 exports SISPAG sem `userId`: extração de credores/valores/bancos não atribuível. Fazer junto com availability-1 (mesmas linhas). |
| modifiability-1 (+ integrability-2) | P2 | S | Teto de 5000 em 3 cópias (`TITULOS_CAP`, `MAX_TITULOS_EXPORT` BE e FE) sem fonte única nem teste de paridade. |
| testability-1 | P2 | S | `PlanilhaXlsxWriter` (2 consumidores) sem teste direto: 0 → 3 casos. |
| modifiability-2 | P2 | L | `routes/sispag.ts` 1257 LOC e `app/sispag/page.tsx` 1475 LOC (alvo 600): Split Module incremental no próximo tweak em SISPAG. |
| availability-2 (+ security-2) | P3 | S | Export relê a carteira ativa inteira; só agir se availability-1 mostrar p95 > 2s. |
| integrability-1 | P3 | S | Formato da chave `fil:doc:tit` duplicado FE/BE sem teste de paridade. |
| testability-2 | P3 | S | Sem asserção de chave duplicada e de escala no `montar`. |
| deployability-1 | P3 | S | FE (Vercel) pode publicar antes do BE (Render): 404 transitório. Regra "rota aditiva: backend primeiro" no `DEPLOY.md`. |
| fault-tolerance-1 | P3 | S | 3 leituras sem snapshot: registrar como leitura best-effort aceita. |

Notas menores dos gates (não-bloqueantes):
- DesignSystemReviewer: o `title` do botão de export não aparece quando ele está desabilitado (acima do teto). Inalcançável hoje porque o painel já corta em 5000, mas um texto visível ao lado seria mais claro.
- DesignSystemReviewer: os botões de faixa (A vencer/Vencidos/Todos) não têm `aria-pressed`; o novo filtro tem. Pré-existente.
