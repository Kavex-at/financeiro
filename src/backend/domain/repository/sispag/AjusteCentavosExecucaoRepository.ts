import { randomUUID } from 'node:crypto';
import { inject, injectable } from 'tsyringe';
import PostgreeDatabaseClient, {
    type TransactionClient,
} from '../../client/database/PostgreeDatabaseClient.js';
import {
    type AjusteCentavosExecucao,
    ajusteCentavosExecucaoRowSchema,
    type RechaveamentoInput,
    type RechaveamentoResultado,
} from '../../interface/sispag/AjusteCentavos.js';
import { SISPAG_SYSTEM_ACTOR } from '../../interface/sispag/SispagInterface.js';
import EtapaAjusteCentavos, {
    ETAPA_AJUSTE,
    type EtapaAjuste,
} from '../../libs/boleto/EtapaAjusteCentavos.js';
import LotePagamentoRepository from './LotePagamentoRepository.js';
import SugestaoBoletoRepository from './SugestaoBoletoRepository.js';
import TituloAPagarRepository from './TituloAPagarRepository.js';

const COLUNAS = `id, fil_cod, doc_cod, tit_cod_origem, decisao_id, tit_cod_novo, frn_cod, marcador,
    etapa, intencao, motivo, delta_centavos, frn_vld_tpop, valor_boleto_centavos, codigo_mascarado,
    fbl_cod, conexos_username, conexos_usn_cod, tentativas, criado_em, atualizado_em, concluido_em`;

const TERMINAIS_SQL = `('concluido', 'concluido_sem_decisao', 'aguardando_aprovacao_manual',
    'cancelado', 'recusado', 'indeterminado', 'simulado')`;

/** Máscara 5+4 (I17j): o repositório recusa qualquer outra coisa antes de tocar o banco. */
const MASCARA = /^\d{5}…\d{4}$/;

export interface NovaExecucaoAjuste {
    filCod: number;
    docCod: string;
    titCodOrigem: string;
    decisaoId: string;
    deltaCentavos?: number;
    frnVldTpop?: 1 | 2;
    valorBoletoCentavos?: number;
    codigoMascarado?: string;
    conexosUsername?: string;
    conexosUsnCod?: string;
    /** Etapa inicial: `pendente` (on) ou `recusado`/`simulado` (registro direto). */
    etapa?: EtapaAjuste;
    motivo?: string;
}

/** Campos que uma etapa grava junto com a transição. */
export interface ResultadoEtapa {
    frnCod?: number;
    titCodNovo?: string;
    fblCod?: number;
    motivo?: string;
    conexosUsername?: string;
    conexosUsnCod?: string;
}

/**
 * AjusteCentavosExecucaoRepository — ledger write-ahead `sispag_ajuste_centavos_execucao`
 * (ADR-0073, I18h; migration 0087). SQL 100% parametrizado. Um ledger por tentativa, idempotente
 * por (filial, documento, título de origem, decisão); no máximo um NÃO terminal por título (índice
 * único parcial). Toda transição passa pela máquina pura (`EtapaAjusteCentavos`) e é condicionada à
 * etapa lida (lock otimista): duas execuções concorrentes nunca avançam o mesmo ledger.
 *
 * `rechavear` é a transação local do I18j: decisão, carteira, itens em RASCUNHO e ledger, juntos ou
 * nenhum.
 */
@injectable()
export default class AjusteCentavosExecucaoRepository {
    public constructor(
        @inject(PostgreeDatabaseClient) private readonly db: PostgreeDatabaseClient,
        @inject(SugestaoBoletoRepository) private readonly sugestoes: SugestaoBoletoRepository,
        @inject(TituloAPagarRepository) private readonly titulos: TituloAPagarRepository,
        @inject(LotePagamentoRepository) private readonly lotes: LotePagamentoRepository,
    ) {}

    private conn = (tx?: TransactionClient): PostgreeDatabaseClient | TransactionClient =>
        tx ?? this.db;

    /**
     * Write-ahead: abre o ledger ANTES de qualquer chamada ao ERP. Conflito na chave de
     * idempotência ⇒ devolve o existente (`criado: false`); outro ledger NÃO terminal do mesmo
     * título (outra decisão) ⇒ devolve esse (a execução não abre uma segunda renegociação).
     */
    public abrir = async (
        input: NovaExecucaoAjuste,
    ): Promise<{ criado: boolean; execucao: AjusteCentavosExecucao }> => {
        if (input.codigoMascarado !== undefined && !MASCARA.test(input.codigoMascarado)) {
            throw new Error('ledger do ajuste aceita só o código mascarado 5+4');
        }
        const id = randomUUID();
        const inserida = await this.db.selectFirst<Record<string, unknown>>(
            `INSERT INTO sispag_ajuste_centavos_execucao
                (id, fil_cod, doc_cod, tit_cod_origem, decisao_id, marcador, etapa, motivo,
                 delta_centavos, frn_vld_tpop, valor_boleto_centavos, codigo_mascarado,
                 conexos_username, conexos_usn_cod, tentativas, concluido_em)
             VALUES ($id::uuid, $filCod, $docCod, $titCodOrigem, $decisaoId::uuid, $marcador,
                     $etapa, $motivo, $deltaCentavos, $frnVldTpop, $valorBoletoCentavos,
                     $codigoMascarado, $conexosUsername, $conexosUsnCod, 1,
                     CASE WHEN $terminal::boolean THEN now() END)
             ON CONFLICT DO NOTHING
             RETURNING ${COLUNAS}`,
            {
                id,
                filCod: input.filCod,
                docCod: input.docCod,
                titCodOrigem: input.titCodOrigem,
                decisaoId: input.decisaoId,
                marcador: AjusteCentavosExecucaoRepository.marcadorDe(id),
                etapa: input.etapa ?? ETAPA_AJUSTE.PENDENTE,
                motivo: input.motivo ?? null,
                deltaCentavos: input.deltaCentavos ?? null,
                frnVldTpop: input.frnVldTpop ?? null,
                valorBoletoCentavos: input.valorBoletoCentavos ?? null,
                codigoMascarado: input.codigoMascarado ?? null,
                conexosUsername: input.conexosUsername ?? null,
                conexosUsnCod: input.conexosUsnCod ?? null,
                terminal: EtapaAjusteCentavos.ehTerminal(input.etapa ?? ETAPA_AJUSTE.PENDENTE),
            },
        );
        if (inserida) {
            return { criado: true, execucao: ajusteCentavosExecucaoRowSchema.parse(inserida) };
        }
        const existente = await this.db.selectFirst<Record<string, unknown>>(
            `SELECT ${COLUNAS} FROM sispag_ajuste_centavos_execucao
              WHERE fil_cod = $filCod AND doc_cod = $docCod AND tit_cod_origem = $titCodOrigem
                AND (decisao_id = $decisaoId::uuid OR etapa NOT IN ${TERMINAIS_SQL})
              ORDER BY (etapa NOT IN ${TERMINAIS_SQL}) DESC, criado_em DESC
              LIMIT 1`,
            {
                filCod: input.filCod,
                docCod: input.docCod,
                titCodOrigem: input.titCodOrigem,
                decisaoId: input.decisaoId,
            },
        );
        if (!existente) throw new Error('ledger do ajuste não encontrado após conflito');
        return { criado: false, execucao: ajusteCentavosExecucaoRowSchema.parse(existente) };
    };

    /** Marcador de correlação curto e sem dígitos longos (vai na obs do `fin070`, I18i). */
    public static marcadorDe = (id: string): string =>
        `AJC-${id.replace(/-/g, '').slice(0, 12).toUpperCase()}`;

    /** Write-ahead: a intenção da próxima chamada ao ERP, gravada ANTES dela. */
    public registrarIntencao = async (id: string, intencao: string): Promise<void> => {
        await this.db.update(
            `UPDATE sispag_ajuste_centavos_execucao
                SET intencao = $intencao, intencao_em = now(), atualizado_em = now()
              WHERE id = $id::uuid`,
            { id, intencao },
        );
    };

    /** Nova tentativa sobre o mesmo ledger (retomada / "tentar de novo"). */
    public registrarTentativa = async (
        id: string,
        identidade: { conexosUsername?: string; conexosUsnCod?: string },
    ): Promise<void> => {
        await this.db.update(
            `UPDATE sispag_ajuste_centavos_execucao
                SET tentativas = tentativas + 1, atualizado_em = now(),
                    conexos_username = COALESCE($conexosUsername, conexos_username),
                    conexos_usn_cod = COALESCE($conexosUsnCod, conexos_usn_cod)
              WHERE id = $id::uuid`,
            {
                id,
                conexosUsername: identidade.conexosUsername ?? null,
                conexosUsnCod: identidade.conexosUsnCod ?? null,
            },
        );
    };

    /**
     * Resultado de uma etapa: transição validada pela máquina e CONDICIONADA à etapa de origem
     * (lock otimista). Limpa a intenção. `false` = outro processo avançou o ledger antes.
     */
    public registrarResultado = async (
        id: string,
        de: EtapaAjuste,
        para: EtapaAjuste,
        campos: ResultadoEtapa = {},
        tx?: TransactionClient,
    ): Promise<boolean> => {
        EtapaAjusteCentavos.transicionar(de, para);
        const n = await this.conn(tx).update(
            `UPDATE sispag_ajuste_centavos_execucao
                SET etapa = $para, intencao = NULL, intencao_em = NULL, atualizado_em = now(),
                    frn_cod = COALESCE($frnCod, frn_cod),
                    tit_cod_novo = COALESCE($titCodNovo, tit_cod_novo),
                    fbl_cod = COALESCE($fblCod, fbl_cod),
                    motivo = COALESCE($motivo, motivo),
                    conexos_username = COALESCE($conexosUsername, conexos_username),
                    conexos_usn_cod = COALESCE($conexosUsnCod, conexos_usn_cod),
                    concluido_em = CASE WHEN $terminal::boolean THEN now() ELSE concluido_em END
              WHERE id = $id::uuid AND etapa = $de`,
            {
                id,
                de,
                para,
                frnCod: campos.frnCod ?? null,
                titCodNovo: campos.titCodNovo ?? null,
                fblCod: campos.fblCod ?? null,
                motivo: campos.motivo ?? null,
                conexosUsername: campos.conexosUsername ?? null,
                conexosUsnCod: campos.conexosUsnCod ?? null,
                terminal: EtapaAjusteCentavos.ehTerminal(para),
            },
        );
        return n > 0;
    };

    public buscarPorId = async (id: string): Promise<AjusteCentavosExecucao | null> => {
        const row = await this.db.selectFirst<Record<string, unknown>>(
            `SELECT ${COLUNAS} FROM sispag_ajuste_centavos_execucao WHERE id = $id::uuid`,
            { id },
        );
        return row ? ajusteCentavosExecucaoRowSchema.parse(row) : null;
    };

    /** Ledgers NÃO terminais (varredura de retomada, I18g(3)). Mais antigos primeiro. */
    public listarNaoTerminais = async (filCod?: number): Promise<AjusteCentavosExecucao[]> => {
        const rows = await this.db.selectMany(
            `SELECT ${COLUNAS} FROM sispag_ajuste_centavos_execucao
              WHERE etapa NOT IN ${TERMINAIS_SQL}
                AND ($filCod::int IS NULL OR fil_cod = $filCod::int)
              ORDER BY criado_em, id
              LIMIT 500`,
            { filCod: filCod ?? null },
        );
        return rows.map((r) => ajusteCentavosExecucaoRowSchema.parse(r));
    };

    /** I18a(7): o título já é fruto de um ajuste nosso (é `tit_cod_novo` de algum ledger)? */
    public buscarConcluidoPorTitCodNovo = async (chave: {
        filCod: number;
        docCod: string;
        titCod: string;
    }): Promise<AjusteCentavosExecucao | null> => {
        const row = await this.db.selectFirst<Record<string, unknown>>(
            `SELECT ${COLUNAS} FROM sispag_ajuste_centavos_execucao
              WHERE fil_cod = $filCod AND doc_cod = $docCod AND tit_cod_novo = $titCod
              ORDER BY criado_em DESC
              LIMIT 1`,
            chave,
        );
        return row ? ajusteCentavosExecucaoRowSchema.parse(row) : null;
    };

    /** O ajuste mais recente que envolve o título (como origem ou como novo) — para a UI. */
    public ultimoPorTitulo = async (chave: {
        filCod: number;
        docCod: string;
        titCod: string;
    }): Promise<AjusteCentavosExecucao | null> => {
        const row = await this.db.selectFirst<Record<string, unknown>>(
            `SELECT ${COLUNAS} FROM sispag_ajuste_centavos_execucao
              WHERE fil_cod = $filCod AND doc_cod = $docCod
                AND (tit_cod_origem = $titCod OR tit_cod_novo = $titCod)
              ORDER BY criado_em DESC
              LIMIT 1`,
            chave,
        );
        return row ? ajusteCentavosExecucaoRowSchema.parse(row) : null;
    };

    /** O ajuste mais recente por título de origem, da filial (endpoint `GET`, M7). */
    public listarUltimosDaFilial = async (filCod: number): Promise<AjusteCentavosExecucao[]> => {
        const rows = await this.db.selectMany(
            `SELECT DISTINCT ON (doc_cod, tit_cod_origem) ${COLUNAS}
               FROM sispag_ajuste_centavos_execucao
              WHERE fil_cod = $filCod
              ORDER BY doc_cod, tit_cod_origem, criado_em DESC
              LIMIT 2000`,
            { filCod },
        );
        return rows.map((r) => ajusteCentavosExecucaoRowSchema.parse(r));
    };

    /**
     * I18j — rechaveamento numa ÚNICA transação local: (1)–(3) transfere a decisão (anula antes de
     * inserir, eventos na trilha); (4) upsert do título novo e inativa o antigo; (5) itens em
     * RASCUNHO passam ao título novo (`valor` = líquido, M6); (6) ledger a `rechaveada`. Decisão já
     * anulada pela analista ⇒ (1)–(3) não acontecem; (4)–(6) sim. Qualquer falha desfaz tudo.
     */
    public rechavear = async (input: RechaveamentoInput): Promise<RechaveamentoResultado> =>
        this.db.withTransaction(async (tx) => {
            const decisao = await this.sugestoes.transferirDecisao(
                {
                    decisaoId: input.decisaoId,
                    titCodNovo: input.titCodNovo,
                    frnCod: input.frnCod,
                    ator: SISPAG_SYSTEM_ACTOR,
                },
                tx,
            );
            const chaveAntiga = {
                filCod: input.filCod,
                docCod: input.docCod,
                titCod: input.titCodAntigo,
            };
            await this.titulos.upsertTituloRenegociado(
                {
                    filCod: input.filCod,
                    docCod: input.docCod,
                    titCodAntigo: input.titCodAntigo,
                    titCodNovo: input.titCodNovo,
                    valor: input.tituloNovo.valorBase,
                    vencimentoEpoch: input.tituloNovo.vencimentoEpoch,
                    aprovado: input.tituloNovo.aprovado,
                },
                tx,
            );
            await this.titulos.inativar(chaveAntiga, tx);
            const lotesTocados = await this.lotes.trocarTituloDoItemEmRascunho(
                {
                    filCod: input.filCod,
                    docCod: input.docCod,
                    titCodAntigo: input.titCodAntigo,
                    titCodNovo: input.titCodNovo,
                    valorNovo: input.tituloNovo.valorLiquido,
                    frnCod: input.frnCod,
                },
                tx,
            );
            const avancou = await this.registrarResultado(
                input.execucaoId,
                input.etapaAtual,
                ETAPA_AJUSTE.RECHAVEADA,
                { titCodNovo: input.titCodNovo, frnCod: input.frnCod },
                tx,
            );
            if (!avancou) {
                throw new Error('ledger do ajuste mudou durante o rechaveamento');
            }
            return {
                decisaoTransferida: decisao.transferida,
                ...(decisao.novaDecisaoId ? { novaDecisaoId: decisao.novaDecisaoId } : {}),
                lotesTocados,
            };
        });
}
