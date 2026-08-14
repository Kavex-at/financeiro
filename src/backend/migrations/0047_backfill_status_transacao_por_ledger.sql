-- 0046_backfill_status_transacao_por_ledger.sql
-- Frente IV, Módulo 1 — ADR-0034. Realinha o status das transações JÁ EXISTENTES com o que o ledger
-- de execução (`solicitacao_numerario_execucao`) diz sobre elas.
--
-- Por que é preciso. `marcarProcessada` só nasceu na 0045 (2026-08-10). Toda alocação executada antes
-- disso deixou a transação em `importada` por construção — e mesmo depois, a escrita era best-effort
-- (falha virava WARN) e o curto-circuito de idempotência nunca a retentava. Resultado em produção:
-- a carteira mostrava créditos milionários como pendentes com a baixa já feita no Conexos. A tela
-- mentia sobre o próprio trabalho.
--
-- ⚠️ EFEITO VISÍVEL NO DEPLOY: a carteira encolhe e o KPI "a distribuir" cai de uma vez. Rode antes
-- as consultas de medição no rodapé deste arquivo e leve os números ao Yuri — foi o combinado.
--
-- Comparações em NUMERIC puro dentro do Postgres (`ROUND(x * 100)`), nunca em ponto flutuante:
-- `::float8` existe neste repo só para serialização de resposta, e usá-lo aqui reintroduziria erro
-- binário num teste de igualdade de dinheiro.
--
-- SQL idempotente: reexecutar não muda nada quando já está alinhado.

-- ── 1. Cobertura TOTAL pela Σ das alocações executadas → terminal ────────────
-- `HAVING SUM(valor) IS NOT NULL` não adivinha sobre linhas de ledger anteriores à 0042 (quando
-- `txn_id` e `valor` nasceram juntos): sem valor não há como medir cobertura, e chutar aqui seria
-- esconder dinheiro não alocado.
--
-- `dry_run = FALSE` porque preview não move dinheiro. `status = 'settled'` porque a chave do ledger é
-- `sn-real:{txnId}:{priCod}:{valor}` — somar todos os status contaria duas vezes uma alocação
-- retentada com valor diferente.
--
-- A lista de origens espelha `origensPermitidasPara(PROCESSADA)` em `recebimentoTransitions.ts`:
-- `processada` NÃO é origem de nada, então nada aqui rebaixa um crédito já concluído.
UPDATE transacao_bancaria t
   SET status = 'processada', atualizado_em = now()
  FROM (SELECT txn_id, SUM(valor) AS alocado
          FROM solicitacao_numerario_execucao
         WHERE status = 'settled' AND dry_run = FALSE AND txn_id IS NOT NULL
         GROUP BY txn_id
        HAVING SUM(valor) IS NOT NULL) s
 WHERE t.id = s.txn_id
   AND t.status IN ('importada', 'conciliada', 'parcial', 'manual', 'erro')
   AND t.valor > 0
   AND ROUND(s.alocado * 100) >= ROUND(t.valor * 100);

-- ── 2. Cobertura PARCIAL → segue na fila, agora rotulada corretamente ────────
-- Este é o caso que a marcação antiga era estruturalmente incapaz de representar: ela era por
-- `txn_id`, então o PRIMEIRO settle de um crédito dividido entre vários processos marcava o crédito
-- inteiro como concluído. Origens espelham `origensPermitidasPara(PARCIAL)` — `conciliada` não está
-- lá (a tabela de transições não admite `conciliada → parcial`).
UPDATE transacao_bancaria t
   SET status = 'parcial', atualizado_em = now()
  FROM (SELECT txn_id, SUM(valor) AS alocado
          FROM solicitacao_numerario_execucao
         WHERE status = 'settled' AND dry_run = FALSE AND txn_id IS NOT NULL
         GROUP BY txn_id
        HAVING SUM(valor) IS NOT NULL) s
 WHERE t.id = s.txn_id
   AND t.status IN ('importada', 'manual', 'erro')
   AND t.valor > 0
   AND ROUND(s.alocado * 100) > 0
   AND ROUND(s.alocado * 100) < ROUND(t.valor * 100);

-- ── 3. Último evento do ledger não terminou bem → erro ──────────────────────
-- POR ÚLTIMO de propósito: quem escreve o status é o ÚLTIMO evento do ledger, que é a mesma regra do
-- caminho vivo (`registrarFalha` roda depois do settle de outra perna). Inverter a ordem, ou tirar o
-- `AND t.status IN (...)`, faria o backfill discordar do código — e um backfill que produz um estado
-- que o runtime nunca produziria é pior que nenhum backfill.
--
-- Origens espelham `origensPermitidasPara(ERRO)`: rebaixa o `parcial` do passo 2, nunca o
-- `processada` do passo 1 (cobertura completa vence uma falha antiga de outra perna).
--
-- A cláusula de `reconciling` velho captura a execução INTERROMPIDA: o processo morreu entre abrir a
-- linha (write-ahead) e fechá-la, então nenhum `catch` rodou e nada escreveu `erro`. É o estado mais
-- perigoso do sistema — pode haver documento órfão no Conexos — e sem esta cláusula ele ficaria
-- invisível para sempre. A janela (15 min) espelha `EXECUCAO_INTERROMPIDA_MINUTOS`; uma execução
-- realmente em voo leva segundos.
UPDATE transacao_bancaria t
   SET status = 'erro', atualizado_em = now()
  FROM (SELECT DISTINCT ON (txn_id) txn_id, status, atualizado_em
          FROM solicitacao_numerario_execucao
         WHERE txn_id IS NOT NULL AND dry_run = FALSE
         ORDER BY txn_id, atualizado_em DESC) u
 WHERE t.id = u.txn_id
   AND (
        u.status = 'error'
        OR (u.status = 'reconciling' AND u.atualizado_em < now() - interval '15 minutes')
       )
   AND t.status IN ('importada', 'parcial', 'manual');

-- ── Nota sobre o que NÃO é tocado ───────────────────────────────────────────
-- Crédito sem nenhuma linha de ledger fica intacto: segue `importada` e segue sendo refrescado pelo
-- cron de ingestão. Só sai de `importada` quem teve alocação de verdade.
--
-- Efeito colateral aceito e registrado na ADR-0034: todo crédito que sai de `importada` deixa de ter
-- `valor`/`contraparte`/`visto_em_run_id` atualizados pela reingestão (o latch do `upsertMany`). Para
-- `processada` isso é desejável — o passado não deve mudar. Para `parcial` é deliberado: não queremos
-- o denominador da regra Σ se mexendo debaixo de uma alocação em curso.

-- ═══════════════════════════════════════════════════════════════════════════
-- MEDIÇÃO (não roda no boot — copie e execute à mão ANTES de aplicar)
-- ═══════════════════════════════════════════════════════════════════════════
-- Quantos créditos e quanto valor mudam de status, agrupados pelo destino:
--
--   WITH s AS (SELECT txn_id, SUM(valor) AS alocado
--                FROM solicitacao_numerario_execucao
--               WHERE status = 'settled' AND dry_run = FALSE AND txn_id IS NOT NULL
--               GROUP BY txn_id HAVING SUM(valor) IS NOT NULL),
--        u AS (SELECT DISTINCT ON (txn_id) txn_id, status
--                FROM solicitacao_numerario_execucao
--               WHERE txn_id IS NOT NULL AND dry_run = FALSE
--               ORDER BY txn_id, atualizado_em DESC)
--   SELECT CASE
--            WHEN u.status = 'error' AND NOT (ROUND(s.alocado * 100) >= ROUND(t.valor * 100))
--                 THEN 'erro'
--            WHEN ROUND(s.alocado * 100) >= ROUND(t.valor * 100) THEN 'processada'
--            WHEN ROUND(s.alocado * 100) > 0 THEN 'parcial'
--            ELSE 'sem mudanca'
--          END                              AS destino,
--          t.status                         AS status_atual,
--          COUNT(*)                         AS creditos,
--          SUM(t.valor)                     AS valor_de_face,
--          SUM(COALESCE(s.alocado, 0))      AS ja_alocado
--     FROM transacao_bancaria t
--     LEFT JOIN s ON s.txn_id = t.id
--     LEFT JOIN u ON u.txn_id = t.id
--    WHERE t.status <> 'processada' AND t.valor > 0 AND s.txn_id IS NOT NULL
--    GROUP BY 1, 2
--    ORDER BY 1, 2;
--
-- E o impacto no KPI "a distribuir" (o número que vai cair na tela do analista):
--
--   SELECT COALESCE(SUM(t.valor), 0)                          AS a_distribuir_hoje,
--          COALESCE(SUM(t.valor - COALESCE(s.alocado, 0)), 0)  AS a_distribuir_depois
--     FROM transacao_bancaria t
--     LEFT JOIN (SELECT txn_id, SUM(valor) AS alocado
--                  FROM solicitacao_numerario_execucao
--                 WHERE status = 'settled' AND dry_run = FALSE AND txn_id IS NOT NULL
--                 GROUP BY txn_id) s ON s.txn_id = t.id
--    WHERE t.arquivada_em IS NULL
--      AND t.tipo = 'CREDITO'
--      AND t.transferencia_interna = FALSE
--      AND t.status <> 'processada';
