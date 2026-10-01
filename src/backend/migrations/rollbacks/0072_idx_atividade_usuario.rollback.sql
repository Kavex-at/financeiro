-- Reverse de 0072_idx_atividade_usuario.sql (ADR-0058).
--
-- Só índices: dropar não perde dado, e o histórico de /perfil continua correto (só mais lento
-- quando as tabelas crescerem). NUNCA aplicado pelo runner (fica fora do diretório que ele lê).
-- Rodar à mão, se preciso:  psql "$databaseConnectionString" -f <este arquivo>

DROP INDEX IF EXISTS idx_permuta_alocacao_execucao_ator_em;
DROP INDEX IF EXISTS idx_solicitacao_numerario_execucao_ator_em;
DROP INDEX IF EXISTS idx_remessa_execucao_ator_em;
DROP INDEX IF EXISTS idx_conciliacao_execucao_ator_em;
DROP INDEX IF EXISTS idx_lote_pagamento_criado_por_em;
DROP INDEX IF EXISTS idx_lote_pagamento_finalizado_por_em;
DROP INDEX IF EXISTS idx_permuta_excecao_manual_criado_por_em;
DROP INDEX IF EXISTS idx_permuta_excecao_manual_removido_por_em;
DROP INDEX IF EXISTS idx_destino_audit_alterado_por_em;
DROP INDEX IF EXISTS idx_alerta_reconhecido_por_em;
DROP INDEX IF EXISTS idx_app_user_access_event_ator_em;
