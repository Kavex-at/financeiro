-- 0060_metricas_historico_inicio.sql
-- ADR-0048 — a tela Métricas recua seis semanas; o report semanal continua no ciclo 6.
--
-- ── O PROBLEMA ───────────────────────────────────────────────────────────────────────────────────
--
-- Aberta em produção em 2026-09-16, `/metricas` mostra `—` em tudo. Não é defeito: é a ADR-0045 D4.
-- `metricas.serie_inicio()` devolve 2026-09-11 18:00, então existe UMA janela (11/09 → 18/09), ainda
-- aberta. As linhas de `%` só saem `WHERE tentativas > 0`; sem execução de permuta ou SN desde
-- sexta, restam as duas de `R$` valendo zero, e os KPIs da tela caem na semana parcial.
--
-- ── O QUE ESTA MIGRATION FAZ (E O QUE NÃO FAZ) ───────────────────────────────────────────────────
--
-- Acrescenta UM piso alternativo e nada mais. É **aditiva**:
--
--   * `metricas.serie_inicio()`     — NÃO é redefinida. Segue 2026-09-11 18:00.
--   * `metricas.metricas_ciclo()`   — NÃO é redefinida. Toda a lógica continua na 0058.
--   * `metricas.vw_metricas_ciclo`  — NÃO é redefinida. Segue ancorada em `serie_inicio()`.
--
-- Quem escolhe o piso é a CHAMADA (`MetricasCicloRepository`), conforme a rota receba ou não
-- `?historico=true`. O `kavex-report-ciclo` não passa o parâmetro e por isso não vê diferença
-- alguma — nem no código, nem na resposta, nem no `serieInicio`. Ver ADR-0048, D1 e D3.
--
-- ── POR QUE 2026-08-07 18:00 E NÃO "SEIS SEMANAS ATRÁS" ──────────────────────────────────────────
--
-- 2026-08-07 e 2026-09-11 são AMBOS sexta-feira, separados por exatamente 35 dias (5 semanas). O
-- `generate_series(p_serie_inicio, p_agora, INTERVAL '7 days')` da 0058 passa a emitir
-- 08-07, 08-14, 08-21, 08-28, 09-04, 09-11 — a MESMA grade da série vigente, cinco janelas a mais.
-- Nenhuma janela fechada muda de fronteira, logo nenhuma linha que o report já leu muda de valor.
--
-- Um piso que não caísse numa sexta teria rebatido a grade inteira e reescrito todo número já
-- reportado. Isso seria "quebra anotada no report" (0058), e não é o que se está fazendo aqui.
--
-- Data FIXA, não janela deslizante (decisão do Yuri, 2026-09-16). Ela envelhece: em dezembro a tela
-- mostrará ~18 semanas, não 6. Consequência registrada na ADR-0048, não corrigida aqui.
--
-- ── RESSALVA QUE A TELA NÃO EXIBE ────────────────────────────────────────────────────────────────
--
-- `permuta_alocacao_execucao` APAGA linha quando o borderô é excluído (ADR-0045, D4). As semanas de
-- agosto podem portanto SUBNOTIFICAR Permutas — quanto mais antiga, mais exposta. O Yuri decidiu em
-- 2026-09-16 não marcar as semanas recuperadas na tela (ADR-0048, D4). O conserto de fundo continua
-- sendo a tabela de eventos append-only, follow-up aberto desde a 0045.
--
-- Somente leitura. Sem DML, sem GRANT, sem role novo, sem SECURITY DEFINER (ADR-0045, D5).
-- SQL idempotente: `CREATE OR REPLACE` e REVOKE re-rodáveis.

-- Piso do HISTÓRICO da tela. Irmão de `metricas.serie_inicio()`, não substituto: os dois coexistem,
-- e é a chamada que escolhe. Mudar é decisão de negócio, em migration nova.
CREATE OR REPLACE FUNCTION metricas.historico_inicio()
RETURNS timestamp
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $fn$
    SELECT TIMESTAMP '2026-08-07 18:00:00'
$fn$;

REVOKE ALL ON FUNCTION metricas.historico_inicio() FROM PUBLIC;
