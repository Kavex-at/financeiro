-- 0072_idx_atividade_usuario.sql
-- Perfil do usuário (ADR-0058): índices (ator, tempo) para o read model AtividadeUsuario.
--
-- O histórico de `/perfil` e os KPIs pessoais filtram cada ledger por ATOR (username da plataforma)
-- e por uma JANELA DE TEMPO, dentro de cada ramo do UNION ALL. Antes desta migration só o evento de
-- acesso tinha índice para isso (`idx_app_user_access_event_alvo_em`, 0066); as outras fontes só
-- tinham índices por status, lote, pri_cod, adto e dedup.
--
-- Índice de EXPRESSÃO onde a data é `COALESCE(encerrado_em, criado_em)` (ADR-0052): a coluna crua
-- não serve ao predicado. Índice PARCIAL onde o ator é anulável e só os preenchidos interessam.
--
-- Volumes de centenas de linhas (190 execuções de permuta, 10 remessas — 0065/0070): o EXPLAIN do PR
-- ainda mostra Seq Scan, e isso é o esperado. Os índices existem para quando a tabela crescer, não
-- para hoje. O lock de build é desprezível nesse volume.
--
-- SQL idempotente (`IF NOT EXISTS`). Só índices: sem DDL de tabela, sem dado. Sem CONCURRENTLY: o
-- BootMigrator roda cada migration em transação, antes de aceitar tráfego (mesmo racional da 0048).
-- Reverse em `rollbacks/0072_idx_atividade_usuario.rollback.sql`.

-- Execuções (datação pelo encerramento, ADR-0052).
CREATE INDEX IF NOT EXISTS idx_permuta_alocacao_execucao_ator_em
    ON permuta_alocacao_execucao (executado_por, (COALESCE(encerrado_em, criado_em)));

CREATE INDEX IF NOT EXISTS idx_solicitacao_numerario_execucao_ator_em
    ON solicitacao_numerario_execucao (executado_por, (COALESCE(encerrado_em, criado_em)));

CREATE INDEX IF NOT EXISTS idx_remessa_execucao_ator_em
    ON remessa_execucao (executado_por, (COALESCE(encerrado_em, criado_em)));

-- Conciliação não tem `encerrado_em`: data por `atualizado_em` (aproximação A3 da ADR-0058).
CREATE INDEX IF NOT EXISTS idx_conciliacao_execucao_ator_em
    ON conciliacao_execucao (executado_por, atualizado_em);

-- Eventos pontuais (o próprio carimbo é a data do fato).
CREATE INDEX IF NOT EXISTS idx_lote_pagamento_criado_por_em
    ON lote_pagamento (criado_por, criado_em);

CREATE INDEX IF NOT EXISTS idx_lote_pagamento_finalizado_por_em
    ON lote_pagamento (finalizado_por, finalizado_em)
    WHERE finalizado_por IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_permuta_excecao_manual_criado_por_em
    ON permuta_excecao_manual (criado_por, criado_em);

CREATE INDEX IF NOT EXISTS idx_permuta_excecao_manual_removido_por_em
    ON permuta_excecao_manual (removido_por, removido_em)
    WHERE removido_por IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_destino_audit_alterado_por_em
    ON lote_pagamento_item_destino_audit (alterado_por, alterado_em);

CREATE INDEX IF NOT EXISTS idx_alerta_reconhecido_por_em
    ON alerta (reconhecido_por, reconhecido_em)
    WHERE reconhecido_por IS NOT NULL;

-- `(alvo_user_id, em)` já existe na 0066; falta o lado do ator.
CREATE INDEX IF NOT EXISTS idx_app_user_access_event_ator_em
    ON app_user_access_event (ator, em);
