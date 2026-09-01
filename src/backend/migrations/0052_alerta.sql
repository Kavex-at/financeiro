-- 0052 — alertas operacionais (ADR-0042).
--
-- Quatro crons alimentam as três frentes e NENHUM avisa quando falha: não há `if: failure()`,
-- não há canal, e `/health` responde "o processo subiu", não "o pipeline rodou". O comentário do
-- próprio `reaper-sispag.yml` já registrava a consequência: "uma queda na sexta à noite ficaria
-- invisível até segunda".
--
-- A tabela existe por três razões, nesta ordem:
--   1. DEDUP — um staleness que dispara a cada rodada do detector vira ruído, e canal ruidoso é
--      canal ignorado; ignorar um canal desativa todos os alertas que passam por ele.
--   2. O painel é um SINK — `DbAlertSink` faz o alerting funcionar no dia 1, sem credencial
--      nenhuma, enquanto o `EmailAlertSink` espera o acesso que ainda não temos.
--   3. HISTÓRICO — "isso já aconteceu antes?" é a primeira pergunta de qualquer investigação, e
--      hoje ela não tem resposta.
CREATE TABLE IF NOT EXISTS alerta (
    id                  BIGSERIAL PRIMARY KEY,
    -- job-falhou | job-parcial | job-parado | config-ausente
    tipo                TEXT NOT NULL
                        CHECK (tipo IN ('job-falhou', 'job-parcial', 'job-parado', 'config-ausente')),
    -- O que sofreu o incidente: nome do pipeline, ou o nome da var de configuração.
    alvo                TEXT NOT NULL,
    severidade          TEXT NOT NULL DEFAULT 'erro'
                        CHECK (severidade IN ('aviso', 'erro')),
    -- (tipo, alvo, janela) — o mesmo incidente na mesma janela NÃO gera segunda linha.
    -- Janela NOVA volta a alertar: um pipeline parado há dois dias merece ser dito de novo.
    dedup_key           TEXT NOT NULL,
    janela_inicio       TIMESTAMPTZ NOT NULL,
    -- Contexto legível do incidente (idade, limite, mensagem do ERP). NUNCA valor de secret (I3).
    detalhe             JSONB NOT NULL DEFAULT '{}'::jsonb,
    -- Resultado por sink. Falha de sink NÃO propaga (I5), mas também não passa em silêncio:
    -- é aqui que "o alerta não chegou" fica distinguível de "não houve alerta".
    sink_resultados     JSONB NOT NULL DEFAULT '[]'::jsonb,
    criado_em           TIMESTAMPTZ NOT NULL DEFAULT now(),
    notificado_em       TIMESTAMPTZ,
    -- Quem reconheceu o alerta na tela (o painel é o sink; o alerta some da lista de abertos).
    reconhecido_em      TIMESTAMPTZ,
    reconhecido_por     TEXT
);

-- A trava de dedup é do BANCO, não da aplicação: duas execuções concorrentes do detector
-- (cron atrasado sobrepondo o seguinte) não podem gerar dois alertas do mesmo incidente.
CREATE UNIQUE INDEX IF NOT EXISTS ux_alerta_dedup ON alerta (dedup_key);

-- A lista de abertos é a leitura quente do painel.
CREATE INDEX IF NOT EXISTS idx_alerta_abertos
    ON alerta (criado_em DESC) WHERE reconhecido_em IS NULL;
