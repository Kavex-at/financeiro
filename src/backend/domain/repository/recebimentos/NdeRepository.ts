import { inject, injectable } from 'tsyringe';
import PostgreeDatabaseClient from '../../client/database/PostgreeDatabaseClient.js';
import { NDE_MOEDA_PADRAO, NDE_STATUS_EMISSAO } from '../../interface/recebimentos/constants.js';
import type { NdeStatusEmissao } from '../../interface/recebimentos/constants.js';
import type { NotaDebitoEletronica } from '../../interface/recebimentos/NotaDebitoEletronica.js';
import type {
    ListNdesPainelFiltro,
    NdePainelRow,
    NdeRepositoryInterface,
    SolicitacaoNumerarioEtapa,
} from '../../interface/recebimentos/ports.js';

/**
 * Recorte comum da aba NDe — a lista e o COUNT precisam concordar sobre o que existe.
 *
 * A **execução** dirige e a NDe entra por LEFT JOIN: o documento com297 nasce no ERP antes da nossa
 * linha local (que só é gravada depois de homologar), então listar pela tabela local esconderia
 * exatamente o caso que o analista precisa ver — a NDe cuja cauda fiscal morreu no meio.
 * `dry_run` fica de fora (nada foi ao ERP) e `nde_dispensada` também (ADR-0031: não era devida).
 * O último termo é a definição de "há NDe aqui": ou o ERP já mintou o `docCod`, ou nós já gravamos.
 */
const PAINEL_FROM_WHERE = `FROM solicitacao_numerario_execucao e
             LEFT JOIN nota_debito_eletronica n ON n.idempotency_key = e.idempotency_key
            WHERE e.fil_cod = ANY($filCods)
              AND e.dry_run = false
              AND COALESCE(e.nde_dispensada, false) = false
              AND (e.nd_doc_cod IS NOT NULL OR n.id IS NOT NULL)`;

/**
 * NdeRepository — CRUD fino sobre `nota_debito_eletronica` (0038) mais a projeção de leitura da aba
 * NDe do painel. Registro local só para idempotência + auditoria (a fonte da verdade é o ERP).
 * `idempotency_key` UNIQUE garante uma NDe por Recebimento. SQL 100% parametrizado (Rule #5);
 * mapeadores privados. Sem lógica de negócio.
 */
@injectable()
export default class NdeRepository implements NdeRepositoryInterface {
    constructor(
        @inject(PostgreeDatabaseClient)
        private databaseClient: PostgreeDatabaseClient,
    ) {}

    public save = async (nde: NotaDebitoEletronica): Promise<NotaDebitoEletronica> => {
        await this.databaseClient.update(
            `INSERT INTO nota_debito_eletronica (
                id, recebimento_id, fil_cod, correlation_id, numero_nde, valor, moeda,
                status_emissao, idempotency_key, erp_response, emitida_em, emitida_por
            ) VALUES (
                $id, $recebimentoId, $filCod, $correlationId, $numeroNde, $valor, $moeda,
                $statusEmissao, $idempotencyKey, $erpResponse::jsonb, $emitidaEm, $emitidaPor
            )
            ON CONFLICT (idempotency_key) DO UPDATE SET
                numero_nde = EXCLUDED.numero_nde,
                status_emissao = EXCLUDED.status_emissao,
                erp_response = EXCLUDED.erp_response,
                emitida_em = EXCLUDED.emitida_em`,
            {
                id: nde.id,
                recebimentoId: nde.recebimentoId,
                filCod: nde.filCod,
                correlationId: nde.correlationId,
                numeroNde: nde.numeroNde ?? null,
                valor: nde.valor,
                moeda: nde.moeda,
                statusEmissao: nde.statusEmissao,
                idempotencyKey: nde.idempotencyKey,
                erpResponse: JSON.stringify(nde.erpResponse ?? null),
                emitidaEm: nde.emitidaEm ?? null,
                emitidaPor: nde.emitidaPor ?? null,
            },
        );
        return nde;
    };

    public findByRecebimentoId = async (
        recebimentoId: string,
    ): Promise<NotaDebitoEletronica | null> => {
        const row = await this.databaseClient.selectFirst<Record<string, unknown>>(
            `SELECT id, recebimento_id, fil_cod, correlation_id, numero_nde, valor, moeda,
                    status_emissao, idempotency_key, erp_response, emitida_em, emitida_por
             FROM nota_debito_eletronica
             WHERE recebimento_id = $recebimentoId
             LIMIT 1`,
            { recebimentoId },
        );
        return row ? this.mapRow(row) : null;
    };

    public listParaPainel = async (filtro: ListNdesPainelFiltro): Promise<NdePainelRow[]> => {
        const rows = await this.databaseClient.selectMany(
            `SELECT e.idempotency_key, e.correlation_id, e.fil_cod, e.txn_id, e.valor,
                    e.nd_doc_cod, e.etapa, e.revisao_humana, e.nde_autorizado,
                    e.status AS exec_status, e.erro_mensagem, e.atualizado_em,
                    n.id AS nde_id, n.recebimento_id, n.numero_nde, n.valor AS nde_valor,
                    n.moeda, n.status_emissao, n.emitida_em, n.emitida_por
             ${PAINEL_FROM_WHERE}
            ORDER BY COALESCE(n.emitida_em, e.atualizado_em) DESC
            LIMIT $limit`,
            { filCods: filtro.filCods, limit: filtro.limit },
        );
        return rows.map((r) => this.mapPainelRow(r as Record<string, unknown>));
    };

    public contarPendentes = async (filtro: { filCods: number[] }): Promise<number> => {
        // "Pendente" = o ciclo não fechou: ou a NDe não foi emitida, ou foi e o SEFAZ ainda não
        // autorizou. O NOT sobre a conjunção é a definição de "fechou" — mudá-la aqui sem mudar a
        // derivação da lista faria card e tabela discordarem.
        const row = await this.databaseClient.selectFirst<{ total: number | string }>(
            `SELECT count(*) AS total
             ${PAINEL_FROM_WHERE}
               AND NOT (COALESCE(n.status_emissao, '') = 'emitida'
                        AND COALESCE(e.nde_autorizado, false) = true)`,
            { filCods: filtro.filCods },
        );
        return Number(row?.total ?? 0);
    };

    public updateNumeroNde = async (idempotencyKey: string, numeroNde: string): Promise<void> => {
        await this.databaseClient.update(
            `UPDATE nota_debito_eletronica
                SET numero_nde = $numeroNde
              WHERE idempotency_key = $idempotencyKey`,
            { idempotencyKey, numeroNde },
        );
    };

    /**
     * Com NDe gravada o status vem dela; sem NDe, a execução em `error` é `erro` e qualquer outra é
     * `pendente` — a NDe que o ERP começou e não terminou.
     */
    private derivarStatusEmissao = (
        r: Record<string, unknown>,
        temNde: boolean,
    ): NdeStatusEmissao => {
        if (temNde) return (r.status_emissao as NdeStatusEmissao) ?? NDE_STATUS_EMISSAO.EMITIDA;
        return r.exec_status === 'error' ? NDE_STATUS_EMISSAO.ERRO : NDE_STATUS_EMISSAO.PENDENTE;
    };

    /**
     * Deriva a linha da aba a partir do par (execução, NDe).
     *
     * O status NÃO é lido de um lugar só: com NDe gravada ele vem dela; sem NDe, a execução em
     * `error` é `erro` e qualquer outra é `pendente` — é a NDe que o ERP começou e não terminou.
     * Sem NDe local não há id local: a identidade vira a da execução, com prefixo, para a UI nunca
     * confundir os dois espaços de id.
     */
    private mapPainelRow = (r: Record<string, unknown>): NdePainelRow => {
        const temNde = r.nde_id != null;
        const statusEmissao = this.derivarStatusEmissao(r, temNde);
        const idempotencyKey = String(r.idempotency_key);

        return {
            id: temNde ? String(r.nde_id) : `exec:${idempotencyKey}`,
            // Toda linha desta query nasceu de uma execução NOSSA — por definição do
            // `PAINEL_FROM_WHERE`. As linhas `'erp'` entram depois, no serviço, a partir do grid.
            origem: 'ferramenta',
            recebimentoId: String(r.recebimento_id ?? r.txn_id ?? ''),
            filCod: Number(r.fil_cod),
            correlationId: String(r.correlation_id ?? idempotencyKey),
            ...(r.numero_nde != null ? { numeroNde: String(r.numero_nde) } : {}),
            valor: Number(r.nde_valor ?? r.valor ?? 0),
            moeda: String(r.moeda ?? NDE_MOEDA_PADRAO),
            statusEmissao,
            idempotencyKey,
            ...(r.emitida_em != null ? { emitidaEm: new Date(r.emitida_em as string | Date) } : {}),
            ...(r.emitida_por != null ? { emitidaPor: String(r.emitida_por) } : {}),
            ...(r.nd_doc_cod != null ? { ndDocCod: Number(r.nd_doc_cod) } : {}),
            ...(r.etapa != null ? { etapa: r.etapa as SolicitacaoNumerarioEtapa } : {}),
            ...(r.revisao_humana != null ? { revisaoHumana: Boolean(r.revisao_humana) } : {}),
            ...(r.nde_autorizado != null ? { ndeAutorizado: Boolean(r.nde_autorizado) } : {}),
            ...(r.erro_mensagem != null ? { erroMensagem: String(r.erro_mensagem) } : {}),
        };
    };

    private mapRow = (r: Record<string, unknown>): NotaDebitoEletronica => ({
        id: String(r.id),
        recebimentoId: String(r.recebimento_id),
        filCod: Number(r.fil_cod),
        correlationId: String(r.correlation_id),
        ...(r.numero_nde != null ? { numeroNde: String(r.numero_nde) } : {}),
        valor: Number(r.valor),
        moeda: String(r.moeda),
        statusEmissao: (r.status_emissao as NdeStatusEmissao) ?? NDE_STATUS_EMISSAO.PENDENTE,
        idempotencyKey: String(r.idempotency_key),
        ...(r.erp_response != null ? { erpResponse: r.erp_response } : {}),
        ...(r.emitida_em != null ? { emitidaEm: new Date(r.emitida_em as string | Date) } : {}),
        ...(r.emitida_por != null ? { emitidaPor: String(r.emitida_por) } : {}),
    });
}
