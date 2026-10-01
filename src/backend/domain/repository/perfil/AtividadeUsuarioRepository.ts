import { inject, injectable } from 'tsyringe';
import { z } from 'zod';
import PostgreeDatabaseClient from '../../client/database/PostgreeDatabaseClient.js';
import {
    ACOES_ATIVIDADE,
    type AgregadosAtividade,
    type ConsultaAgregados,
    type ConsultaHistorico,
    FONTES_ATIVIDADE,
    FRENTES_ATIVIDADE,
    type LinhaAtividadeBruta,
    chavesDoStatus,
} from '../../interface/perfil/AtividadeUsuarioInterface.js';

/**
 * Histórico unificado: UNION ALL das 9 fontes (11 ramos, um por `fonte`), normalizado em
 * `{em, frente, acao, alvo_tipo, alvo_id, valor, status_bruto, fonte, fonte_id, detalhe}`.
 *
 * O ATOR e a JANELA DE TEMPO são filtrados DENTRO de cada ramo (nunca só no SELECT de fora): o
 * planner usa os índices (ator, tempo) da 0072 e nenhuma linha de outro usuário entra no conjunto
 * intermediário (I1). `dry_run = false` onde a coluna existe. Datação (ADR-0052/0058):
 * `COALESCE(encerrado_em, criado_em)` nas execuções; `atualizado_em` na conciliação (A3);
 * o próprio carimbo nos eventos pontuais.
 *
 * Constante estática — nenhum valor de entrada entra no texto (Rule #5): ator, janela, filtros e
 * cursor viajam como `$nome`. `fonte_id` é `text` porque UUIDs e inteiros convivem.
 */
const HISTORICO_SQL = `
WITH atividade AS (
    SELECT COALESCE(x.encerrado_em, x.criado_em) AS em,
           'permutas'::text AS frente,
           'baixa_permuta'::text AS acao,
           'adiantamento'::text AS alvo_tipo,
           x.adiantamento_doc_cod::text AS alvo_id,
           x.valor_baixado::numeric AS valor,
           x.status::text AS status_bruto,
           'permuta_execucao'::text AS fonte,
           x.id::text AS fonte_id,
           jsonb_strip_nulls(jsonb_build_object(
               'parcial', CASE WHEN x.status = 'parcial' THEN true END,
               'filCod', x.fil_cod,
               'conexosUsername', x.conexos_username,
               'invoiceDocCod', x.invoice_doc_cod
           )) AS detalhe
      FROM permuta_alocacao_execucao x
     WHERE x.executado_por = $username
       AND x.dry_run = false
       AND COALESCE(x.encerrado_em, x.criado_em) >= $inicio::timestamptz
       AND COALESCE(x.encerrado_em, x.criado_em) < $fim::timestamptz

    UNION ALL

    SELECT m.criado_em, 'permutas'::text, 'excecao_criada'::text, 'adiantamento'::text,
           m.adiantamento_doc_cod::text, NULL::numeric, 'evento'::text,
           'excecao_criada'::text, m.id::text, '{}'::jsonb
      FROM permuta_excecao_manual m
     WHERE m.criado_por = $username
       AND m.criado_em >= $inicio::timestamptz
       AND m.criado_em < $fim::timestamptz

    UNION ALL

    SELECT m.removido_em, 'permutas'::text, 'excecao_removida'::text, 'adiantamento'::text,
           m.adiantamento_doc_cod::text, NULL::numeric, 'evento'::text,
           'excecao_removida'::text, m.id::text, '{}'::jsonb
      FROM permuta_excecao_manual m
     WHERE m.removido_por = $username
       AND m.removido_em >= $inicio::timestamptz
       AND m.removido_em < $fim::timestamptz

    UNION ALL

    SELECT l.criado_em, 'sispag'::text, 'lote_criado'::text, 'lote'::text,
           l.id::text, NULL::numeric, l.status::text,
           'lote_criado'::text, l.id::text,
           jsonb_build_object('filCod', l.fil_cod)
      FROM lote_pagamento l
     WHERE l.criado_por = $username
       AND l.criado_em >= $inicio::timestamptz
       AND l.criado_em < $fim::timestamptz

    UNION ALL

    SELECT l.finalizado_em, 'sispag'::text, 'lote_finalizado'::text, 'lote'::text,
           l.id::text,
           (SELECT SUM(i.valor) FROM lote_pagamento_item i WHERE i.lote_id = l.id),
           l.status::text,
           'lote_finalizado'::text, l.id::text,
           jsonb_build_object('filCod', l.fil_cod)
      FROM lote_pagamento l
     WHERE l.finalizado_por = $username
       AND l.finalizado_em >= $inicio::timestamptz
       AND l.finalizado_em < $fim::timestamptz

    UNION ALL

    SELECT d.alterado_em, 'sispag'::text,
           CASE WHEN d.evento = 'APROVACAO' THEN 'destino_aprovado' ELSE 'destino_gravado' END,
           'titulo'::text,
           d.fil_cod::text || '-' || d.doc_cod || '-' || d.tit_cod,
           NULL::numeric, d.evento::text,
           'destino_audit'::text, d.id::text,
           jsonb_build_object('filCod', d.fil_cod, 'loteId', d.lote_id::text)
      FROM lote_pagamento_item_destino_audit d
     WHERE d.alterado_por = $username
       AND d.alterado_em >= $inicio::timestamptz
       AND d.alterado_em < $fim::timestamptz

    UNION ALL

    SELECT COALESCE(r.encerrado_em, r.criado_em), 'sispag'::text, 'remessa_gerada'::text,
           'lote'::text, r.lote_id::text,
           (SELECT SUM(i.valor) FROM lote_pagamento_item i WHERE i.lote_id = r.lote_id),
           r.status::text,
           'remessa'::text, r.id::text,
           jsonb_strip_nulls(jsonb_build_object(
               'filCod', r.fil_cod,
               'conexosUsername', r.conexos_username
           ))
      FROM remessa_execucao r
     WHERE r.executado_por = $username
       AND r.dry_run = false
       AND COALESCE(r.encerrado_em, r.criado_em) >= $inicio::timestamptz
       AND COALESCE(r.encerrado_em, r.criado_em) < $fim::timestamptz

    UNION ALL

    SELECT c.atualizado_em AS em, 'sispag'::text, 'retorno_conciliado'::text, 'retorno'::text,
           c.fil_cod::text || '-' || c.bnc_cod::text || '-' || c.gtb_cod_seq::text || '-'
               || c.gar_cod_seq::text,
           NULL::numeric, c.status::text,
           'conciliacao'::text, c.id::text,
           jsonb_strip_nulls(jsonb_build_object(
               'parcial', CASE WHEN c.varredura_incompleta THEN true END,
               'filCod', c.fil_cod,
               'conexosUsername', c.conexos_username
           ))
      FROM conciliacao_execucao c
     WHERE c.executado_por = $username
       AND c.dry_run = false
       AND c.atualizado_em >= $inicio::timestamptz
       AND c.atualizado_em < $fim::timestamptz

    UNION ALL

    SELECT COALESCE(s.encerrado_em, s.criado_em), 'recebimentos'::text,
           'numerario_executado'::text, 'processo'::text, s.pri_cod::text,
           s.valor::numeric, s.status::text,
           'sn_execucao'::text, s.id::text,
           jsonb_strip_nulls(jsonb_build_object(
               'filCod', s.fil_cod,
               'docCod', s.doc_cod::text,
               'conexosUsername', s.conexos_username
           ))
      FROM solicitacao_numerario_execucao s
     WHERE s.executado_por = $username
       AND s.dry_run = false
       AND COALESCE(s.encerrado_em, s.criado_em) >= $inicio::timestamptz
       AND COALESCE(s.encerrado_em, s.criado_em) < $fim::timestamptz

    UNION ALL

    SELECT al.reconhecido_em, 'plataforma'::text, 'alerta_reconhecido'::text, 'alerta'::text,
           al.id::text, NULL::numeric, 'evento'::text,
           'alerta_reconhecido'::text, al.id::text,
           jsonb_build_object('tipoAlerta', al.tipo, 'alvoAlerta', al.alvo)
      FROM alerta al
     WHERE al.reconhecido_por = $username
       AND al.reconhecido_em >= $inicio::timestamptz
       AND al.reconhecido_em < $fim::timestamptz

    UNION ALL

    SELECT e.em, 'plataforma'::text,
           CASE WHEN e.ator = $username THEN 'acesso_alterado' ELSE 'acesso_recebido' END,
           'usuario'::text, e.alvo_user_id::text, NULL::numeric, e.tipo::text,
           'acesso_evento'::text, e.id::text,
           jsonb_build_object(
               'tipoAcesso', e.tipo,
               'outroUsername', CASE WHEN e.ator = $username THEN t.username ELSE e.ator END
           )
      FROM app_user_access_event e
      JOIN app_user t ON t.id = e.alvo_user_id
     WHERE (e.ator = $username OR e.alvo_user_id = $userId)
       AND e.em >= $inicio::timestamptz
       AND e.em < $fim::timestamptz
)
SELECT to_char(a.em AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS em,
       a.frente, a.acao, a.alvo_tipo, a.alvo_id, a.valor::text AS valor, a.status_bruto,
       a.fonte, a.fonte_id, a.detalhe
  FROM atividade a
 WHERE ($frente::text IS NULL OR a.frente = $frente::text)
   AND ($tipo::text IS NULL OR a.acao = $tipo::text)
   AND ($statusChaves::text[] IS NULL OR (a.fonte || ':' || a.status_bruto) = ANY($statusChaves::text[]))
   AND (
       $cursorEm::timestamptz IS NULL
       OR a.em < $cursorEm::timestamptz
       OR (a.em = $cursorEm::timestamptz AND (a.fonte COLLATE "C" > $cursorFonte OR (a.fonte = $cursorFonte AND a.fonte_id COLLATE "C" < $cursorId)))
   )
 ORDER BY a.em DESC, a.fonte COLLATE "C" ASC, a.fonte_id COLLATE "C" DESC
 LIMIT $limit`;

/**
 * KPIs por frente, numa ida ao banco. Mesmas regras de `metricas.metricas_ciclo()` (0070) sobre
 * o recorte do usuário: Permutas com o MESMO `EXISTS` de borderô finalizado; SISPAG pela 1ª
 * remessa `settled` não-dry de cada lote ENTRE TODOS os usuários (escolhida antes de filtrar o
 * ator, para um lote nunca contar duas vezes nem para dois usuários); lote CANCELADO fora.
 *
 * Intervalo semiaberto `[$inicio, $fim)` em `timestamptz`. Equivale ao `timestamp` local SP da
 * métrica porque o offset de SP é fixo desde 2019 (ver `PeriodoPerfil`).
 */
const AGREGADOS_SQL = `
WITH permutas AS (
    SELECT x.status, x.valor_baixado,
           EXISTS (
               SELECT 1
                 FROM permuta_bordero b
                WHERE b.fil_cod = x.fil_cod
                  AND b.bor_cod = x.bor_cod
                  AND b.bor_vld_finalizado = 1
                  AND b.bor_cod_estornado IS NULL
           ) AS finalizada
      FROM permuta_alocacao_execucao x
     WHERE x.executado_por = $username
       AND x.dry_run = false
       AND COALESCE(x.encerrado_em, x.criado_em) >= $inicio::timestamptz
       AND COALESCE(x.encerrado_em, x.criado_em) < $fim::timestamptz
),
lotes_remessados AS (
    SELECT l.id
      FROM lote_pagamento l
      JOIN LATERAL (
          SELECT x.executado_por, x.encerrado_em, x.criado_em
            FROM remessa_execucao x
           WHERE x.lote_id = l.id
             AND x.dry_run = false
             AND x.status = 'settled'
           ORDER BY COALESCE(x.encerrado_em, x.criado_em), x.id
           LIMIT 1
      ) r1 ON true
     WHERE l.status <> 'CANCELADO'
       AND r1.executado_por = $username
       AND COALESCE(r1.encerrado_em, r1.criado_em) >= $inicio::timestamptz
       AND COALESCE(r1.encerrado_em, r1.criado_em) < $fim::timestamptz
),
itens_remessados AS (
    SELECT i.valor, i.situacao
      FROM lote_pagamento_item i
      JOIN lotes_remessados lr ON lr.id = i.lote_id
)
SELECT
    (SELECT COUNT(*) FILTER (WHERE status = 'settled' AND finalizada) FROM permutas)
        AS permutas_concluidas,
    (SELECT COUNT(*) FILTER (WHERE status = 'parcial' AND finalizada) FROM permutas)
        AS permutas_parciais,
    (SELECT COALESCE(SUM(valor_baixado) FILTER (WHERE status IN ('settled', 'parcial') AND finalizada), 0)
       FROM permutas)::text AS permutas_valor_baixado,
    (SELECT COUNT(*) FILTER (WHERE status IN ('settled', 'parcial') AND NOT finalizada) FROM permutas)
        AS permutas_aguardando_bordero,
    (SELECT COUNT(*) FILTER (WHERE status = 'error') FROM permutas) AS permutas_com_erro,

    (SELECT COUNT(*)
       FROM lote_pagamento l
      WHERE l.finalizado_por = $username
        AND l.finalizado_em >= $inicio::timestamptz
        AND l.finalizado_em < $fim::timestamptz
        AND l.status <> 'CANCELADO') AS sispag_lotes_finalizados,
    (SELECT COUNT(*) FROM lotes_remessados) AS sispag_remessas_geradas,
    (SELECT COALESCE(SUM(valor), 0) FROM itens_remessados)::text AS sispag_valor_remessado,
    (SELECT COALESCE(SUM(valor) FILTER (WHERE situacao IN ('AGENDADO', 'PAGO')), 0)
       FROM itens_remessados)::text AS sispag_valor_agendado,
    (SELECT COALESCE(SUM(valor) FILTER (WHERE situacao = 'PAGO'), 0)
       FROM itens_remessados)::text AS sispag_valor_pago_confirmado,
    (SELECT COUNT(*)
       FROM conciliacao_execucao c
      WHERE c.executado_por = $username
        AND c.dry_run = false
        AND c.status = 'settled'
        AND c.atualizado_em >= $inicio::timestamptz
        AND c.atualizado_em < $fim::timestamptz) AS sispag_retornos_conciliados,
    (SELECT COUNT(*)
       FROM remessa_execucao r
      WHERE r.executado_por = $username
        AND r.dry_run = false
        AND r.status = 'error'
        AND COALESCE(r.encerrado_em, r.criado_em) >= $inicio::timestamptz
        AND COALESCE(r.encerrado_em, r.criado_em) < $fim::timestamptz)
    + (SELECT COUNT(*)
       FROM conciliacao_execucao c
      WHERE c.executado_por = $username
        AND c.dry_run = false
        AND c.status = 'error'
        AND c.atualizado_em >= $inicio::timestamptz
        AND c.atualizado_em < $fim::timestamptz) AS sispag_com_erro,

    (SELECT COUNT(*)
       FROM solicitacao_numerario_execucao s
      WHERE s.executado_por = $username
        AND s.dry_run = false
        AND s.status = 'settled'
        AND COALESCE(s.encerrado_em, s.criado_em) >= $inicio::timestamptz
        AND COALESCE(s.encerrado_em, s.criado_em) < $fim::timestamptz) AS recebimentos_concluidas,
    (SELECT COALESCE(SUM(s.valor), 0)
       FROM solicitacao_numerario_execucao s
      WHERE s.executado_por = $username
        AND s.dry_run = false
        AND s.status = 'settled'
        AND COALESCE(s.encerrado_em, s.criado_em) >= $inicio::timestamptz
        AND COALESCE(s.encerrado_em, s.criado_em) < $fim::timestamptz)::text AS recebimentos_valor,
    (SELECT COUNT(*)
       FROM solicitacao_numerario_execucao s
      WHERE s.executado_por = $username
        AND s.dry_run = false
        AND s.status = 'error'
        AND COALESCE(s.encerrado_em, s.criado_em) >= $inicio::timestamptz
        AND COALESCE(s.encerrado_em, s.criado_em) < $fim::timestamptz) AS recebimentos_com_erro`;

const detalheSchema = z
    .object({
        parcial: z.boolean().optional(),
        filCod: z.coerce.number().int().optional(),
        conexosUsername: z.string().optional(),
        loteId: z.string().optional(),
        invoiceDocCod: z.string().optional(),
        docCod: z.string().optional(),
        tipoAlerta: z.string().optional(),
        alvoAlerta: z.string().optional(),
        tipoAcesso: z.string().optional(),
        outroUsername: z.string().optional(),
    })
    .strip();

const linhaSchema = z.object({
    em: z.string(),
    frente: z.enum(FRENTES_ATIVIDADE),
    acao: z.enum(ACOES_ATIVIDADE),
    alvo_tipo: z.string(),
    alvo_id: z.string(),
    valor: z.coerce.number().nullable().optional(),
    status_bruto: z.string(),
    fonte: z.enum(FONTES_ATIVIDADE),
    fonte_id: z.string(),
    detalhe: detalheSchema,
});

const contagem = z.coerce.number().int().nonnegative();
const reais = z.coerce.number();

const agregadosSchema = z.object({
    permutas_concluidas: contagem,
    permutas_parciais: contagem,
    permutas_valor_baixado: reais,
    permutas_aguardando_bordero: contagem,
    permutas_com_erro: contagem,
    sispag_lotes_finalizados: contagem,
    sispag_remessas_geradas: contagem,
    sispag_valor_remessado: reais,
    sispag_valor_agendado: reais,
    sispag_valor_pago_confirmado: reais,
    sispag_retornos_conciliados: contagem,
    sispag_com_erro: contagem,
    recebimentos_concluidas: contagem,
    recebimentos_valor: reais,
    recebimentos_com_erro: contagem,
});

/**
 * AtividadeUsuarioRepository — o read model AtividadeUsuario (ADR-0058): histórico unificado
 * (keyset) e KPIs por frente. Só leitura; nenhuma coluna de credencial; SQL 100% parametrizado.
 */
@injectable()
export default class AtividadeUsuarioRepository {
    public constructor(
        @inject(PostgreeDatabaseClient)
        private readonly databaseClient: PostgreeDatabaseClient,
    ) {}

    public historico = async (consulta: ConsultaHistorico): Promise<LinhaAtividadeBruta[]> => {
        const rows = await this.databaseClient.selectMany(HISTORICO_SQL, {
            username: consulta.username,
            userId: consulta.userId,
            inicio: consulta.inicio,
            fim: consulta.fim,
            frente: consulta.frente ?? null,
            tipo: consulta.tipo ?? null,
            statusChaves: consulta.status ? chavesDoStatus(consulta.status) : null,
            cursorEm: consulta.cursor?.em ?? null,
            cursorFonte: consulta.cursor?.fonte ?? null,
            cursorId: consulta.cursor?.fonteId ?? null,
            limit: consulta.limit,
        });
        return rows.map(this.toLinha);
    };

    public agregados = async (consulta: ConsultaAgregados): Promise<AgregadosAtividade> => {
        const raw = await this.databaseClient.selectFirst<unknown>(AGREGADOS_SQL, {
            username: consulta.username,
            inicio: consulta.inicio,
            fim: consulta.fim,
        });
        const r = agregadosSchema.parse(raw);
        return {
            permutas: {
                concluidas: r.permutas_concluidas,
                parciais: r.permutas_parciais,
                valorBaixado: r.permutas_valor_baixado,
                aguardandoBordero: r.permutas_aguardando_bordero,
                comErro: r.permutas_com_erro,
            },
            sispag: {
                lotesFinalizados: r.sispag_lotes_finalizados,
                remessasGeradas: r.sispag_remessas_geradas,
                valorRemessado: r.sispag_valor_remessado,
                valorAgendado: r.sispag_valor_agendado,
                valorPagoConfirmado: r.sispag_valor_pago_confirmado,
                retornosConciliados: r.sispag_retornos_conciliados,
                comErro: r.sispag_com_erro,
            },
            recebimentos: {
                concluidas: r.recebimentos_concluidas,
                valor: r.recebimentos_valor,
                comErro: r.recebimentos_com_erro,
            },
        };
    };

    private toLinha = (raw: unknown): LinhaAtividadeBruta => {
        const row = linhaSchema.parse(raw);
        return {
            em: row.em,
            frente: row.frente,
            acao: row.acao,
            alvoTipo: row.alvo_tipo,
            alvoId: row.alvo_id,
            ...(row.valor != null ? { valor: row.valor } : {}),
            statusBruto: row.status_bruto,
            fonte: row.fonte,
            fonteId: row.fonte_id,
            detalhe: row.detalhe,
        };
    };
}
