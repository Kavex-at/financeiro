import { randomUUID } from 'node:crypto';
import { inject, injectable } from 'tsyringe';
import PostgreeDatabaseClient, {
    type TransactionClient,
} from '../../client/database/PostgreeDatabaseClient.js';
import ExcecaoEstadoInvalidoError from '../../errors/ExcecaoEstadoInvalidoError.js';
import ExcecaoNaoEncontradaError from '../../errors/ExcecaoNaoEncontradaError.js';
import { destinoManualSchema } from '../../interface/sispag/DestinoManualSchema.js';
import {
    CHAVE_PIX_TIPO,
    DESTINO_MANUAL_TIPO,
    type DestinoManual,
    type DestinoManualTipo,
    EXCECAO_ESTADO,
    EXCECAO_EVENTO,
    type ExcecaoDestino,
    type ExcecaoDestinoEvento,
    type ExcecaoEstado,
    type ExcecaoEvento,
    type ExcecaoOrigem,
} from '../../interface/sispag/SispagInterface.js';
import Logger from '../../libs/logger/Logger.js';

/** Superfície de query comum ao pool e ao cliente transacional. */
type QueryRunner = Pick<PostgreeDatabaseClient, 'selectMany' | 'selectFirst' | 'insert' | 'update'>;

interface ExcecaoRow {
    id: string;
    pes_cod: string;
    fil_cod: number;
    tipo: DestinoManualTipo;
    banco_cod: string | null;
    agencia: string | null;
    agencia_dv: string | null;
    conta: string | null;
    conta_dv: string | null;
    chave_pix_tipo: string | null;
    chave_pix: string | null;
    titular_documento: string;
    estado: ExcecaoEstado;
    origem: ExcecaoOrigem;
    carga_id: string | null;
    justificativa: string;
    cadastrado_por: string;
    cadastrado_em: Date;
    aprovado_por: string | null;
    aprovado_em: Date | null;
    decidido_por: string | null;
    decidido_em: Date | null;
    motivo_decisao: string | null;
    substituida_em: Date | null;
    divergiu?: boolean | null;
    versao: number;
}

interface EventoRow {
    id: string;
    excecao_id: string;
    evento: ExcecaoEvento;
    ator: string;
    ocorrido_em: Date;
    depois: Record<string, unknown> | null;
}

const COLUNAS = `id, pes_cod, fil_cod, tipo, banco_cod, agencia, agencia_dv, conta, conta_dv,
    chave_pix_tipo, chave_pix, titular_documento, estado, origem, carga_id, justificativa,
    cadastrado_por, cadastrado_em, aprovado_por, aprovado_em, decidido_por, decidido_em,
    motivo_decisao, substituida_em, versao,
    EXISTS (SELECT 1 FROM excecao_destino_audit a
             WHERE a.excecao_id = excecao_destino.id
               AND a.evento = 'DIVERGENCIA_CADASTRO') AS divergiu`;

const iso = (d: Date | null): string | undefined => (d ? new Date(d).toISOString() : undefined);

export interface NovaExcecao {
    pesCod: string;
    filCod: number;
    destino: DestinoManual;
    origem: ExcecaoOrigem;
    cargaId?: string;
    justificativa: string;
    cadastradoPor: string;
}

export interface FiltroExcecoes {
    estado?: ExcecaoEstado;
    pesCod?: string;
}

/** Uma decisão que muda o estado: de qual estado parte, para qual vai e o que a trilha registra. */
export interface TransicaoExcecao {
    id: string;
    de: ExcecaoEstado;
    para: ExcecaoEstado;
    evento: ExcecaoEvento;
    ator: string;
    /** Motivo da rejeição/revogação (obrigatório nelas — validado no service). */
    motivo?: string;
    /** Estado da trilha: SEM valores de destino em claro além do CADASTRO. */
    depois?: Record<string, unknown>;
}

/**
 * ExcecaoDestinoRepository — a exceção de destino e a sua trilha só-inclusão (ADR-0060, I12a,
 * I12e). SQL só com parâmetros nomeados.
 *
 * Duas garantias moram aqui:
 *
 * - **Transição + trilha são UMA transação.** O `UPDATE ... WHERE estado = $de` é a trava
 *   otimista: 0 linhas = outro foi mais rápido (ou a ação não cabe no estado), e vira
 *   `ExcecaoEstadoInvalidoError` sem escrever nada. A linha de trilha entra na mesma transação:
 *   se ela falha, o estado volta.
 * - **Aprovar substitui.** No máximo uma `APROVADA` por (favorecido, tipo): a anterior vai a
 *   `SUBSTITUIDA` na MESMA transação, com a trilha dos dois eventos (o índice único parcial do
 *   banco é a última defesa).
 *
 * O valor do destino só existe aqui e no banco. `list`/`getById` devolvem a entidade COMPLETA para
 * uso interno (resolver/envio); a projeção mascarada é do service (I10h).
 */
@injectable()
export default class ExcecaoDestinoRepository {
    public constructor(
        @inject(PostgreeDatabaseClient) private readonly databaseClient: PostgreeDatabaseClient,
    ) {}

    /** Cadastra `PENDENTE` + evento CADASTRO (valor completo só na trilha do banco). */
    public insert = async (nova: NovaExcecao): Promise<ExcecaoDestino> => {
        const id = randomUUID();
        await this.databaseClient.withTransaction(async (tx) => {
            await tx.insert(
                `INSERT INTO excecao_destino
                    (id, pes_cod, fil_cod, tipo, banco_cod, agencia, agencia_dv, conta, conta_dv,
                     chave_pix_tipo, chave_pix, titular_documento, estado, origem, carga_id,
                     justificativa, cadastrado_por)
                 VALUES ($id, $pesCod, $filCod, $tipo, $bancoCod, $agencia, $agenciaDv, $conta, $contaDv,
                         $chavePixTipo, $chavePix, $titular, 'PENDENTE', $origem, $cargaId,
                         $justificativa, $cadastradoPor)`,
                {
                    id,
                    pesCod: nova.pesCod,
                    filCod: nova.filCod,
                    ...this.colunasDoDestino(nova.destino),
                    origem: nova.origem,
                    cargaId: nova.cargaId ?? null,
                    justificativa: nova.justificativa,
                    cadastradoPor: nova.cadastradoPor,
                },
            );
            await this.appendAudit(
                {
                    excecaoId: id,
                    evento: EXCECAO_EVENTO.CADASTRO,
                    ator: nova.cadastradoPor,
                    depois: { estado: EXCECAO_ESTADO.PENDENTE, destino: nova.destino },
                },
                tx,
            );
        });
        const criada = await this.getById(id);
        if (!criada) throw new ExcecaoNaoEncontradaError({ excecaoId: id });
        return criada;
    };

    public getById = async (id: string): Promise<ExcecaoDestino | null> => {
        const row = await this.databaseClient.selectFirst<ExcecaoRow>(
            `SELECT ${COLUNAS} FROM excecao_destino WHERE id = $id`,
            { id },
        );
        return row ? this.map(row) : null;
    };

    /** A exceção `APROVADA` do (favorecido, tipo) — no máximo uma (I12a). */
    public findAprovada = async (
        pesCod: string,
        tipo: DestinoManualTipo,
    ): Promise<ExcecaoDestino | null> => {
        const row = await this.databaseClient.selectFirst<ExcecaoRow>(
            `SELECT ${COLUNAS} FROM excecao_destino
             WHERE pes_cod = $pesCod AND tipo = $tipo AND estado = 'APROVADA'`,
            { pesCod, tipo },
        );
        return row ? this.map(row) : null;
    };

    public list = async (filtro: FiltroExcecoes = {}): Promise<ExcecaoDestino[]> => {
        const rows = (await this.databaseClient.selectMany(
            `SELECT ${COLUNAS} FROM excecao_destino
             WHERE ($estado::text IS NULL OR estado = $estado)
               AND ($pesCod::text IS NULL OR pes_cod = $pesCod)
             ORDER BY cadastrado_em DESC, id`,
            { estado: filtro.estado ?? null, pesCod: filtro.pesCod ?? null },
        )) as ExcecaoRow[];
        return this.mapAll(rows);
    };

    /** Todas as `APROVADA` (a varredura de aposentadoria, I12c). */
    public listAprovadas = async (): Promise<ExcecaoDestino[]> => this.list({ estado: 'APROVADA' });

    /**
     * Transição de estado + trilha, numa transação (ver docstring da classe). Sem linha afetada
     * lança `ExcecaoEstadoInvalidoError` e a trilha NÃO é escrita.
     */
    public transition = async (t: TransicaoExcecao): Promise<ExcecaoDestino> => {
        await this.databaseClient.withTransaction((tx) => this.aplicarTransicao(t, tx));
        const atual = await this.getById(t.id);
        if (!atual) throw new ExcecaoNaoEncontradaError({ excecaoId: t.id });
        return atual;
    };

    /** O corpo da transição, sobre a transação do chamador (não relê: o commit ainda não houve). */
    private aplicarTransicao = async (
        t: TransicaoExcecao,
        tx: TransactionClient,
    ): Promise<void> => {
        const afetadas = await tx.update(this.sqlTransicao(t), {
            id: t.id,
            de: t.de,
            para: t.para,
            ator: t.ator,
            motivo: t.motivo ?? null,
        });
        if (afetadas === 0) {
            throw new ExcecaoEstadoInvalidoError({
                excecaoId: t.id,
                estadoAtual: t.de,
                acao: t.evento,
            });
        }
        await this.appendAudit(
            {
                excecaoId: t.id,
                evento: t.evento,
                ator: t.ator,
                antes: { estado: t.de },
                depois: {
                    estado: t.para,
                    ...(t.motivo ? { motivo: t.motivo } : {}),
                    ...(t.depois ?? {}),
                },
            },
            tx,
        );
    };

    /**
     * Aprova a `PENDENTE` (E2): UMA transação, que trava a exceção, move a `APROVADA` anterior do
     * mesmo (favorecido, tipo) a `SUBSTITUIDA` (com a sua trilha) e só então grava a aprovação —
     * a ordem evita o conflito do índice único parcial. A regra "aprovador ≠ cadastrante" é do
     * service/regra; o `CHECK` do banco é a última defesa.
     */
    public aprovar = async (params: { id: string; ator: string }): Promise<ExcecaoDestino> => {
        await this.databaseClient.withTransaction(async (tx) => {
            const alvo = await tx.selectFirst<{ pes_cod: string; tipo: string; estado: string }>(
                `SELECT pes_cod, tipo, estado FROM excecao_destino WHERE id = $id FOR UPDATE`,
                { id: params.id },
            );
            if (!alvo) throw new ExcecaoNaoEncontradaError({ excecaoId: params.id });
            if (alvo.estado !== EXCECAO_ESTADO.PENDENTE) {
                throw new ExcecaoEstadoInvalidoError({
                    excecaoId: params.id,
                    estadoAtual: alvo.estado,
                    acao: 'aprovar',
                });
            }
            const anterior = await tx.selectFirst<{ id: string }>(
                `SELECT id FROM excecao_destino
                 WHERE pes_cod = $pesCod AND tipo = $tipo AND estado = 'APROVADA'
                 FOR UPDATE`,
                { pesCod: alvo.pes_cod, tipo: alvo.tipo },
            );
            if (anterior) {
                await this.aplicarTransicao(
                    {
                        id: anterior.id,
                        de: EXCECAO_ESTADO.APROVADA,
                        para: EXCECAO_ESTADO.SUBSTITUIDA,
                        evento: EXCECAO_EVENTO.SUBSTITUICAO,
                        ator: params.ator,
                        depois: { substituidaPor: params.id },
                    },
                    tx,
                );
            }
            await this.aplicarTransicao(
                {
                    id: params.id,
                    de: EXCECAO_ESTADO.PENDENTE,
                    para: EXCECAO_ESTADO.APROVADA,
                    evento: EXCECAO_EVENTO.APROVACAO,
                    ator: params.ator,
                    ...(anterior ? { depois: { substituiu: anterior.id } } : {}),
                },
                tx,
            );
        });
        const aprovada = await this.getById(params.id);
        if (!aprovada) throw new ExcecaoNaoEncontradaError({ excecaoId: params.id });
        return aprovada;
    };

    /** Linha da trilha. Só `INSERT` — o trigger do banco recusa o resto (I12e). */
    public appendAudit = async (
        params: {
            excecaoId: string;
            evento: ExcecaoEvento;
            ator: string;
            antes?: Record<string, unknown>;
            depois?: Record<string, unknown>;
        },
        tx?: TransactionClient,
    ): Promise<string> => {
        const id = randomUUID();
        await this.db(tx).insert(
            `INSERT INTO excecao_destino_audit (id, excecao_id, evento, ator, antes, depois)
             VALUES ($id, $excecaoId, $evento, $ator, $antes::jsonb, $depois::jsonb)`,
            {
                id,
                excecaoId: params.excecaoId,
                evento: params.evento,
                ator: params.ator,
                antes: params.antes ? JSON.stringify(params.antes) : null,
                depois: params.depois ? JSON.stringify(params.depois) : null,
            },
        );
        return id;
    };

    /** A trilha da exceção na leitura: só estados e metadados, nunca conta/chave (I10h). */
    public listEventos = async (excecaoId: string): Promise<ExcecaoDestinoEvento[]> => {
        const rows = (await this.databaseClient.selectMany(
            `SELECT id, excecao_id, evento, ator, ocorrido_em,
                    (depois - 'destino') AS depois
             FROM excecao_destino_audit
             WHERE excecao_id = $excecaoId
             ORDER BY ocorrido_em, id`,
            { excecaoId },
        )) as EventoRow[];
        return rows.map((r) => ({
            id: r.id,
            excecaoId: r.excecao_id,
            evento: r.evento,
            ator: r.ator,
            ocorridoEm: new Date(r.ocorrido_em).toISOString(),
            ...(r.depois ? { detalhe: r.depois } : {}),
        }));
    };

    /** Contagem por estado (painel). Sem nenhum valor de destino. */
    public contarPorEstado = async (): Promise<Record<ExcecaoEstado, number>> => {
        const rows = (await this.databaseClient.selectMany(
            `SELECT estado, count(*)::int AS n FROM excecao_destino GROUP BY estado`,
        )) as Array<{ estado: ExcecaoEstado; n: number }>;
        const base: Record<ExcecaoEstado, number> = {
            PENDENTE: 0,
            APROVADA: 0,
            REJEITADA: 0,
            SUBSTITUIDA: 0,
            REVOGADA: 0,
        };
        for (const r of rows) base[r.estado] = Number(r.n);
        return base;
    };

    /** Quantas `PENDENTE` esperam há mais de `dias` dias (painel). */
    public contarPendentesAntigas = async (dias: number): Promise<number> => {
        const row = await this.databaseClient.selectFirst<{ n: number }>(
            `SELECT count(*)::int AS n FROM excecao_destino
             WHERE estado = 'PENDENTE' AND cadastrado_em < now() - make_interval(days => $dias)`,
            { dias },
        );
        return Number(row?.n ?? 0);
    };

    /** Liga o item à exceção usada quando o destino congela no import (I10f). */
    public marcarUso = async (params: {
        excecaoId: string;
        ator: string;
        loteId: string;
    }): Promise<void> => {
        await this.appendAudit({
            excecaoId: params.excecaoId,
            evento: EXCECAO_EVENTO.USO,
            ator: params.ator,
            depois: { loteId: params.loteId },
        });
    };

    private db = (tx?: TransactionClient): QueryRunner => tx ?? this.databaseClient;

    /**
     * SQL da transição. Aprovação preenche `aprovado_*`; rejeição/revogação, `decidido_*` e o
     * motivo; substituição, `substituida_em`. Tudo com a trava `WHERE estado = $de`.
     */
    private sqlTransicao = (t: TransicaoExcecao): string => {
        const extra =
            t.para === EXCECAO_ESTADO.APROVADA
                ? ', aprovado_por = $ator, aprovado_em = now()'
                : t.para === EXCECAO_ESTADO.SUBSTITUIDA
                  ? ', substituida_em = now()'
                  : ', decidido_por = $ator, decidido_em = now(), motivo_decisao = $motivo';
        return `UPDATE excecao_destino
                SET estado = $para, versao = versao + 1${extra}
                WHERE id = $id AND estado = $de`;
    };

    private colunasDoDestino = (d: DestinoManual): Record<string, unknown> => ({
        tipo: d.tipo,
        bancoCod: d.tipo === DESTINO_MANUAL_TIPO.CONTA ? d.bancoCod : null,
        agencia: d.tipo === DESTINO_MANUAL_TIPO.CONTA ? d.agencia : null,
        agenciaDv: d.tipo === DESTINO_MANUAL_TIPO.CONTA ? (d.agenciaDv ?? null) : null,
        conta: d.tipo === DESTINO_MANUAL_TIPO.CONTA ? d.conta : null,
        contaDv: d.tipo === DESTINO_MANUAL_TIPO.CONTA ? d.contaDv : null,
        chavePixTipo: d.tipo === DESTINO_MANUAL_TIPO.CHAVE_PIX ? d.chavePixTipo : null,
        chavePix: d.tipo === DESTINO_MANUAL_TIPO.CHAVE_PIX ? d.chavePix : null,
        titular: d.titularDocumento,
    });

    private mapAll = (rows: ExcecaoRow[]): ExcecaoDestino[] =>
        rows.flatMap((r) => {
            const e = this.map(r);
            return e ? [e] : [];
        });

    /**
     * Linha → entidade, validando o destino por Zod. Linha cujo destino não passa é IGNORADA (o
     * aviso diz QUAL exceção, nunca o conteúdo — I10h): falha fechada, nada resolve a partir dela.
     */
    private map = (r: ExcecaoRow): ExcecaoDestino | null => {
        const bruto =
            r.tipo === DESTINO_MANUAL_TIPO.CONTA
                ? {
                      tipo: r.tipo,
                      bancoCod: r.banco_cod,
                      agencia: r.agencia,
                      ...(r.agencia_dv != null ? { agenciaDv: r.agencia_dv } : {}),
                      conta: r.conta,
                      contaDv: r.conta_dv,
                      titularDocumento: r.titular_documento,
                  }
                : {
                      tipo: r.tipo,
                      chavePixTipo: r.chave_pix_tipo ?? CHAVE_PIX_TIPO.CPF_CNPJ,
                      chavePix: r.chave_pix,
                      titularDocumento: r.titular_documento,
                  };
        const parsed = destinoManualSchema.safeParse(bruto);
        if (!parsed.success) {
            Logger.warn(
                `[SISPAG] excecao_destino ${r.id} com destino inválido — tratada como inexistente`,
            );
            return null;
        }
        return {
            id: r.id,
            pesCod: r.pes_cod,
            filCod: Number(r.fil_cod),
            destino: parsed.data,
            estado: r.estado,
            origem: r.origem,
            ...(r.carga_id != null ? { cargaId: r.carga_id } : {}),
            justificativa: r.justificativa,
            cadastradoPor: r.cadastrado_por,
            cadastradoEm: new Date(r.cadastrado_em).toISOString(),
            ...(r.aprovado_por != null ? { aprovadoPor: r.aprovado_por } : {}),
            ...(r.aprovado_em != null ? { aprovadoEm: iso(r.aprovado_em) } : {}),
            ...(r.decidido_por != null ? { decididoPor: r.decidido_por } : {}),
            ...(r.decidido_em != null ? { decididoEm: iso(r.decidido_em) } : {}),
            ...(r.motivo_decisao != null ? { motivoDecisao: r.motivo_decisao } : {}),
            ...(r.substituida_em != null ? { substituidaEm: iso(r.substituida_em) } : {}),
            ...(r.divergiu === true ? { divergiu: true } : {}),
            versao: r.versao,
        };
    };
}
