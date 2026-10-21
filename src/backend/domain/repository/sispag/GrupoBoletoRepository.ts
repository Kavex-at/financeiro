import { randomUUID } from 'node:crypto';
import { inject, injectable } from 'tsyringe';
import PostgreeDatabaseClient, {
    type TransactionClient,
} from '../../client/database/PostgreeDatabaseClient.js';
import GroupedBoletoAlreadyGroupedError from '../../errors/GroupedBoletoAlreadyGroupedError.js';
import GroupedBoletoTitleIneligibleError from '../../errors/GroupedBoletoTitleIneligibleError.js';
import {
    type AvisoGrupo,
    type ChaveTituloGrupo,
    GRUPO_BOLETO_ESTADO,
    GRUPO_BOLETO_EVENTO,
    type GrupoBoleto,
    type GrupoBoletoEstado,
    type GrupoBoletoEvento,
    type GrupoBoletoEventoRegistro,
    type GrupoBoletoOrigem,
    type GrupoBoletoTipoAnulacao,
    type GrupoBoletoTitulo,
    MOTIVO_GRUPO_INELEGIVEL,
    type NovoGrupoBoleto,
    RESULTADO_TRANSICAO_GRUPO,
    type ResultadoTransicaoGrupo,
} from '../../interface/sispag/GrupoBoletoInterface.js';
import { isCodigoMascarado, SISPAG_SYSTEM_ACTOR } from '../../interface/sispag/SispagInterface.js';

type QueryRunner = Pick<PostgreeDatabaseClient, 'selectMany' | 'selectFirst' | 'insert' | 'update'>;

interface GrupoRow {
    id: string;
    fil_cod: number;
    pes_cod: string;
    credor: string | null;
    emissor_chave: string;
    ddc_cod: number;
    dit_cod: number;
    numero_boleto: string | null;
    codbar_mascarado: string;
    valor_boleto_centavos: string | number;
    vencimento_boleto: string;
    soma_titulos_centavos: string | number;
    origem: string;
    intercambiavel: boolean;
    avisos_reconhecidos: unknown;
    confirmacao_emissor_id: string;
    estado: string;
    confirmado_por: string;
    confirmado_em: Date;
    anulado_por: string | null;
    anulado_em: Date | null;
    motivo_anulacao: string | null;
    tipo_anulacao: string | null;
    pago_observado_em: Date | null;
    versao: number;
}

interface TituloRow {
    grupo_id: string;
    fil_cod: number;
    doc_cod: string;
    tit_cod: string;
    valor_liquido_centavos: string | number;
    vencimento: string;
}

interface EventoRow {
    id: string;
    grupo_id: string;
    tipo: string;
    ator: string;
    ocorrido_em: Date;
    fil_cod: number | null;
    lote_id: string | null;
    execucao_id: string | null;
    bor_cod: number | null;
    ddc_cod: number | null;
    dit_cod: number | null;
    codigo_mascarado: string | null;
    dados: Record<string, unknown> | null;
}

/** Projeção do grupo. Datas civis por `to_char` (o node-pg leria o DATE em hora local). */
const COLUNAS_GRUPO = `id, fil_cod, pes_cod, credor, emissor_chave, ddc_cod, dit_cod, numero_boleto,
    codbar_mascarado, valor_boleto_centavos, to_char(vencimento_boleto, 'YYYY-MM-DD') AS
    vencimento_boleto, soma_titulos_centavos, origem, intercambiavel, avisos_reconhecidos,
    confirmacao_emissor_id, estado, confirmado_por, confirmado_em, anulado_por, anulado_em,
    motivo_anulacao, tipo_anulacao, pago_observado_em, versao`;

const COLUNAS_EVENTO = `id, grupo_id, tipo, ator, ocorrido_em, fil_cod, lote_id, execucao_id,
    bor_cod, ddc_cod, dit_cod, codigo_mascarado, dados`;

/** Nenhum código de barras (44/47 dígitos) entra na trilha (I17j). */
const DIGITOS_LONGOS = /\d{20,}/;

/** Entrada de `registrarEvento`. */
export interface NovoEventoGrupo {
    grupoId: string;
    tipo: GrupoBoletoEvento;
    ator: string;
    filCod?: number;
    loteId?: string;
    execucaoId?: string;
    borCod?: number;
    ddcCod?: number;
    ditCod?: number;
    codigoMascarado?: string;
    dados?: Record<string, unknown>;
}

/**
 * GrupoBoletoRepository — `sispag_grupo_boleto`, `sispag_grupo_boleto_titulo` e a trilha
 * `sispag_grupo_boleto_evento` (ADR-0077, I21i; migration 0090). SQL 100% parametrizado.
 *
 * Grupo e títulos andam JUNTOS: a migration confere no COMMIT (constraint trigger) que os N
 * títulos têm o estado e a filial do grupo, N ≥ 2 e a soma bate — por isso toda escrita aqui roda
 * numa transação (a do chamador, ou uma própria).
 *
 * Exclusividade com a decisão 1:1 (I15q/I21c): cruza tabelas, nenhum índice a garante. Vale pelo
 * advisory lock TRANSACIONAL por boleto e por título (`chaveLockBoleto`/`chaveLockTitulo` +
 * `travar`), tomado aqui e pelo `BoletoSuggestionService.confirmar` (Task 10) com as MESMAS chaves.
 */
@injectable()
export default class GrupoBoletoRepository {
    public constructor(
        @inject(PostgreeDatabaseClient) private readonly databaseClient: PostgreeDatabaseClient,
    ) {}

    /** Chave do advisory lock de um boleto DDA (compartilhada com a sugestão 1:1, Task 10). */
    public static chaveLockBoleto = (ddcCod: number, ditCod: number): string =>
        `sispag:boleto:${ddcCod}:${ditCod}`;

    /** Chave do advisory lock de um título (compartilhada com a sugestão 1:1, Task 10). */
    public static chaveLockTitulo = (c: ChaveTituloGrupo): string =>
        `sispag:titulo:${c.filCod}:${c.docCod}:${c.titCod}`;

    /**
     * Advisory locks TRANSACIONAIS (`pg_advisory_xact_lock`, soltos no COMMIT/ROLLBACK), em ordem
     * lexicográfica para que dois confirmadores concorrentes nunca travem um ao outro.
     */
    public travar = async (tx: TransactionClient, chaves: readonly string[]): Promise<void> => {
        for (const chave of [...new Set(chaves)].sort()) {
            await tx.selectFirst(`SELECT pg_advisory_xact_lock(hashtextextended($chave, 0))`, {
                chave,
            });
        }
    };

    private naTransacao = <T>(
        tx: TransactionClient | undefined,
        fn: (t: TransactionClient) => Promise<T>,
    ): Promise<T> => (tx ? fn(tx) : this.databaseClient.withTransaction(fn));

    private db = (tx?: TransactionClient): QueryRunner => tx ?? this.databaseClient;

    private mapTitulo = (r: TituloRow): GrupoBoletoTitulo => ({
        filCod: Number(r.fil_cod),
        docCod: r.doc_cod,
        titCod: r.tit_cod,
        valorLiquidoCentavos: Number(r.valor_liquido_centavos),
        vencimento: r.vencimento,
    });

    private mapGrupo = (r: GrupoRow, titulos: GrupoBoletoTitulo[]): GrupoBoleto => ({
        id: r.id,
        filCod: Number(r.fil_cod),
        pesCod: r.pes_cod,
        ...(r.credor != null ? { credor: r.credor } : {}),
        emissorChave: r.emissor_chave,
        ddcCod: Number(r.ddc_cod),
        ditCod: Number(r.dit_cod),
        ...(r.numero_boleto != null ? { numeroBoleto: r.numero_boleto } : {}),
        codbarMascarado: r.codbar_mascarado,
        valorBoletoCentavos: Number(r.valor_boleto_centavos),
        vencimentoBoleto: r.vencimento_boleto,
        titulos,
        somaTitulosCentavos: Number(r.soma_titulos_centavos),
        origem: r.origem as GrupoBoletoOrigem,
        intercambiavel: r.intercambiavel === true,
        avisosReconhecidos: (Array.isArray(r.avisos_reconhecidos)
            ? r.avisos_reconhecidos
            : []) as AvisoGrupo[],
        confirmacaoEmissorId: r.confirmacao_emissor_id,
        estado: r.estado as GrupoBoletoEstado,
        confirmadoPor: r.confirmado_por,
        confirmadoEm: new Date(r.confirmado_em),
        ...(r.anulado_por != null ? { anuladoPor: r.anulado_por } : {}),
        ...(r.anulado_em != null ? { anuladoEm: new Date(r.anulado_em) } : {}),
        ...(r.motivo_anulacao != null ? { motivoAnulacao: r.motivo_anulacao } : {}),
        ...(r.tipo_anulacao != null
            ? { tipoAnulacao: r.tipo_anulacao as GrupoBoletoTipoAnulacao }
            : {}),
        ...(r.pago_observado_em != null ? { pagoObservadoEm: new Date(r.pago_observado_em) } : {}),
        versao: Number(r.versao),
    });

    private mapEvento = (r: EventoRow): GrupoBoletoEventoRegistro => ({
        id: r.id,
        grupoId: r.grupo_id,
        tipo: r.tipo as GrupoBoletoEvento,
        ator: r.ator,
        ocorridoEm: new Date(r.ocorrido_em),
        ...(r.fil_cod != null ? { filCod: Number(r.fil_cod) } : {}),
        ...(r.lote_id != null ? { loteId: r.lote_id } : {}),
        ...(r.execucao_id != null ? { execucaoId: r.execucao_id } : {}),
        ...(r.bor_cod != null ? { borCod: Number(r.bor_cod) } : {}),
        ...(r.ddc_cod != null ? { ddcCod: Number(r.ddc_cod) } : {}),
        ...(r.dit_cod != null ? { ditCod: Number(r.dit_cod) } : {}),
        ...(r.codigo_mascarado != null ? { codigoMascarado: r.codigo_mascarado } : {}),
        ...(r.dados != null ? { dados: r.dados } : {}),
    });

    /** Grupos com os títulos, numa ida por tabela (ordem de entrada preservada). */
    private comTitulos = async (
        rows: GrupoRow[],
        tx?: TransactionClient,
    ): Promise<GrupoBoleto[]> => {
        if (rows.length === 0) return [];
        const params: Record<string, unknown> = {};
        const ids = rows.map((r, i) => {
            params[`g${i}`] = r.id;
            return `$g${i}::uuid`;
        });
        const titulos = (await this.db(tx).selectMany(
            `SELECT grupo_id, fil_cod, doc_cod, tit_cod, valor_liquido_centavos,
                    to_char(vencimento, 'YYYY-MM-DD') AS vencimento
               FROM sispag_grupo_boleto_titulo
              WHERE grupo_id IN (${ids.join(', ')})
              ORDER BY vencimento, doc_cod, tit_cod`,
            params,
        )) as TituloRow[];
        const porGrupo = new Map<string, GrupoBoletoTitulo[]>();
        for (const t of titulos) {
            const lista = porGrupo.get(t.grupo_id) ?? [];
            lista.push(this.mapTitulo(t));
            porGrupo.set(t.grupo_id, lista);
        }
        return rows.map((r) => this.mapGrupo(r, porGrupo.get(r.id) ?? []));
    };

    private mesmoConjunto = (grupo: GrupoBoleto, titulos: readonly ChaveTituloGrupo[]): boolean => {
        const chave = (t: ChaveTituloGrupo) => `${t.filCod}:${t.docCod}:${t.titCod}`;
        const a = new Set(grupo.titulos.map(chave));
        const b = new Set(titulos.map(chave));
        return a.size === b.size && [...b].every((k) => a.has(k));
    };

    /**
     * Confirma 1 boleto ↔ N títulos (I21i): grupo + N títulos + evento `GRUPO_CONFIRMADO` numa
     * transação, sob advisory lock por boleto e por título. Idempotente: o boleto já num grupo
     * `CONFIRMADO` com os MESMOS títulos ⇒ devolve o existente (`criado: false`, sem evento novo);
     * com outros títulos ⇒ `GroupedBoletoAlreadyGroupedError`; algum título em outro grupo
     * `CONFIRMADO` ⇒ `GroupedBoletoTitleIneligibleError` (`EM_OUTRO_GRUPO`).
     */
    public inserirConfirmado = async (
        input: NovoGrupoBoleto,
        tx?: TransactionClient,
    ): Promise<{ criado: boolean; grupo: GrupoBoleto }> => {
        if (!isCodigoMascarado(input.codbarMascarado)) {
            throw new Error('grupo de boleto aceita só o código mascarado 5+4');
        }
        return this.naTransacao(tx, async (t) => {
            await this.travar(t, [
                GrupoBoletoRepository.chaveLockBoleto(input.ddcCod, input.ditCod),
                ...input.titulos.map(GrupoBoletoRepository.chaveLockTitulo),
            ]);
            const existente = await this.buscarConfirmadoPorBoleto(input.ddcCod, input.ditCod, t);
            if (existente) {
                if (this.mesmoConjunto(existente, input.titulos)) {
                    return { criado: false, grupo: existente };
                }
                throw new GroupedBoletoAlreadyGroupedError({
                    grupoExistenteId: existente.id,
                    ddcCod: input.ddcCod,
                    ditCod: input.ditCod,
                    codbarMascarado: input.codbarMascarado,
                });
            }
            const emOutro = await this.titulosEmGrupoConfirmado(input.titulos, t);
            if (emOutro.length > 0) {
                throw new GroupedBoletoTitleIneligibleError({
                    titulos: emOutro.map((c) => ({
                        ...c,
                        motivo: MOTIVO_GRUPO_INELEGIVEL.EM_OUTRO_GRUPO,
                    })),
                });
            }
            const id = randomUUID();
            const soma = input.titulos.reduce((s, x) => s + x.valorLiquidoCentavos, 0);
            await t.insert(
                `INSERT INTO sispag_grupo_boleto
                    (id, fil_cod, pes_cod, credor, emissor_chave, ddc_cod, dit_cod, numero_boleto,
                     codbar_mascarado, valor_boleto_centavos, vencimento_boleto,
                     soma_titulos_centavos, origem, intercambiavel, avisos_reconhecidos,
                     confirmacao_emissor_id, estado, confirmado_por)
                 VALUES ($id::uuid, $filCod, $pesCod, $credor, $emissorChave, $ddcCod, $ditCod,
                         $numeroBoleto, $codbarMascarado, $valorBoletoCentavos,
                         $vencimentoBoleto::date, $soma, $origem, $intercambiavel,
                         $avisos::jsonb, $confirmacaoEmissorId::uuid, $confirmado, $confirmadoPor)`,
                {
                    id,
                    filCod: input.filCod,
                    pesCod: input.pesCod,
                    credor: input.credor ?? null,
                    emissorChave: input.emissorChave,
                    ddcCod: input.ddcCod,
                    ditCod: input.ditCod,
                    numeroBoleto: input.numeroBoleto ?? null,
                    codbarMascarado: input.codbarMascarado,
                    valorBoletoCentavos: input.valorBoletoCentavos,
                    vencimentoBoleto: input.vencimentoBoleto,
                    soma,
                    origem: input.origem,
                    intercambiavel: input.intercambiavel,
                    avisos: JSON.stringify(input.avisosReconhecidos),
                    confirmacaoEmissorId: input.confirmacaoEmissorId,
                    confirmado: GRUPO_BOLETO_ESTADO.CONFIRMADO,
                    confirmadoPor: input.confirmadoPor,
                },
            );
            await this.inserirTitulos(id, input.titulos, t);
            await this.registrarEvento(
                {
                    grupoId: id,
                    tipo: GRUPO_BOLETO_EVENTO.GRUPO_CONFIRMADO,
                    ator: input.confirmadoPor,
                    filCod: input.filCod,
                    ddcCod: input.ddcCod,
                    ditCod: input.ditCod,
                    codigoMascarado: input.codbarMascarado,
                    dados: {
                        origem: input.origem,
                        titulos: input.titulos.map((x) => `${x.docCod}/${x.titCod}`),
                        valorBoletoCentavos: input.valorBoletoCentavos,
                        avisosReconhecidos: input.avisosReconhecidos,
                    },
                },
                t,
            );
            const grupo = await this.buscarPorId(id, t);
            if (!grupo) throw new Error('grupo de boleto não persistiu');
            return { criado: true, grupo };
        });
    };

    private inserirTitulos = async (
        grupoId: string,
        titulos: readonly GrupoBoletoTitulo[],
        tx: TransactionClient,
    ): Promise<void> => {
        const params: Record<string, unknown> = {
            grupoId,
            confirmado: GRUPO_BOLETO_ESTADO.CONFIRMADO,
        };
        const tuplas = titulos.map((t, i) => {
            params[`f${i}`] = t.filCod;
            params[`d${i}`] = t.docCod;
            params[`t${i}`] = t.titCod;
            params[`v${i}`] = t.valorLiquidoCentavos;
            params[`ve${i}`] = t.vencimento;
            return `($grupoId::uuid, $f${i}, $d${i}, $t${i}, $v${i}, $ve${i}::date, $confirmado)`;
        });
        await tx.insert(
            `INSERT INTO sispag_grupo_boleto_titulo
                (grupo_id, fil_cod, doc_cod, tit_cod, valor_liquido_centavos, vencimento, estado)
             VALUES ${tuplas.join(', ')}`,
            params,
        );
    };

    /** Os títulos (da lista) que já estão num grupo `CONFIRMADO`. */
    private titulosEmGrupoConfirmado = async (
        titulos: readonly ChaveTituloGrupo[],
        tx?: TransactionClient,
    ): Promise<ChaveTituloGrupo[]> => {
        if (titulos.length === 0) return [];
        const params: Record<string, unknown> = { confirmado: GRUPO_BOLETO_ESTADO.CONFIRMADO };
        const filtro = titulos
            .map((t, i) => {
                params[`f${i}`] = t.filCod;
                params[`d${i}`] = t.docCod;
                params[`t${i}`] = t.titCod;
                return `(fil_cod = $f${i} AND doc_cod = $d${i} AND tit_cod = $t${i})`;
            })
            .join(' OR ');
        const rows = (await this.db(tx).selectMany(
            `SELECT fil_cod, doc_cod, tit_cod FROM sispag_grupo_boleto_titulo
              WHERE estado = $confirmado AND (${filtro})
              ORDER BY fil_cod, doc_cod, tit_cod`,
            params,
        )) as Array<{ fil_cod: number; doc_cod: string; tit_cod: string }>;
        return rows.map((r) => ({
            filCod: Number(r.fil_cod),
            docCod: r.doc_cod,
            titCod: r.tit_cod,
        }));
    };

    /**
     * Anula o grupo (I21t): estado no grupo E nos títulos, `versao + 1`, evento `GRUPO_ANULADO`,
     * numa transação. Idempotente sobre `ANULADO` (`JA_APLICADO`, nada gravado); `PAGO` não se
     * anula (`RECUSADO`). Motivo 10–500 conferido antes de tocar o banco.
     */
    public anular = async (
        input: {
            grupoId: string;
            motivo: string;
            tipoAnulacao: GrupoBoletoTipoAnulacao;
            ator: string;
        },
        tx?: TransactionClient,
    ): Promise<{ resultado: ResultadoTransicaoGrupo; grupo?: GrupoBoleto }> => {
        const motivo = input.motivo.trim();
        if (motivo.length < 10 || motivo.length > 500) {
            throw new Error('motivo da anulação precisa ter entre 10 e 500 caracteres');
        }
        return this.naTransacao(tx, async (t) => {
            const atual = await this.estadoParaAtualizar(input.grupoId, t);
            if (!atual) return { resultado: RESULTADO_TRANSICAO_GRUPO.NAO_ENCONTRADO };
            if (atual.estado !== GRUPO_BOLETO_ESTADO.CONFIRMADO) {
                const grupo = (await this.buscarPorId(input.grupoId, t)) ?? undefined;
                return {
                    resultado:
                        atual.estado === GRUPO_BOLETO_ESTADO.ANULADO
                            ? RESULTADO_TRANSICAO_GRUPO.JA_APLICADO
                            : RESULTADO_TRANSICAO_GRUPO.RECUSADO,
                    ...(grupo ? { grupo } : {}),
                };
            }
            await t.update(
                `UPDATE sispag_grupo_boleto
                    SET estado = $anulado, anulado_por = $ator, anulado_em = now(),
                        motivo_anulacao = $motivo, tipo_anulacao = $tipo, versao = versao + 1,
                        atualizado_em = now()
                  WHERE id = $grupoId::uuid`,
                {
                    grupoId: input.grupoId,
                    anulado: GRUPO_BOLETO_ESTADO.ANULADO,
                    ator: input.ator,
                    motivo,
                    tipo: input.tipoAnulacao,
                },
            );
            await this.propagarEstado(input.grupoId, GRUPO_BOLETO_ESTADO.ANULADO, t);
            await this.registrarEvento(
                {
                    grupoId: input.grupoId,
                    tipo: GRUPO_BOLETO_EVENTO.GRUPO_ANULADO,
                    ator: input.ator,
                    filCod: atual.fil_cod,
                    codigoMascarado: atual.codbar_mascarado,
                    dados: { motivo, tipoAnulacao: input.tipoAnulacao },
                },
                t,
            );
            const grupo = (await this.buscarPorId(input.grupoId, t)) ?? undefined;
            return { resultado: RESULTADO_TRANSICAO_GRUPO.APLICADO, ...(grupo ? { grupo } : {}) };
        });
    };

    /**
     * Fecha o grupo como `PAGO` (I21r: os N títulos pagos no `fin064`): estado no grupo e nos
     * títulos, `pago_observado_em`, evento `GRUPO_PAGO` (ator `sistema`). Idempotente sobre `PAGO`;
     * `ANULADO` não vira `PAGO` (`RECUSADO`).
     */
    public marcarPago = async (
        input: { grupoId: string; observadoEm: Date; loteId?: string; borCod?: number },
        tx?: TransactionClient,
    ): Promise<{ resultado: ResultadoTransicaoGrupo }> =>
        this.naTransacao(tx, async (t) => {
            const atual = await this.estadoParaAtualizar(input.grupoId, t);
            if (!atual) return { resultado: RESULTADO_TRANSICAO_GRUPO.NAO_ENCONTRADO };
            if (atual.estado === GRUPO_BOLETO_ESTADO.PAGO) {
                return { resultado: RESULTADO_TRANSICAO_GRUPO.JA_APLICADO };
            }
            if (atual.estado !== GRUPO_BOLETO_ESTADO.CONFIRMADO) {
                return { resultado: RESULTADO_TRANSICAO_GRUPO.RECUSADO };
            }
            await t.update(
                `UPDATE sispag_grupo_boleto
                    SET estado = $pago, pago_observado_em = $observadoEm, versao = versao + 1,
                        atualizado_em = now()
                  WHERE id = $grupoId::uuid`,
                {
                    grupoId: input.grupoId,
                    pago: GRUPO_BOLETO_ESTADO.PAGO,
                    observadoEm: input.observadoEm,
                },
            );
            await this.propagarEstado(input.grupoId, GRUPO_BOLETO_ESTADO.PAGO, t);
            await this.registrarEvento(
                {
                    grupoId: input.grupoId,
                    tipo: GRUPO_BOLETO_EVENTO.GRUPO_PAGO,
                    ator: SISPAG_SYSTEM_ACTOR,
                    filCod: atual.fil_cod,
                    codigoMascarado: atual.codbar_mascarado,
                    ...(input.loteId !== undefined ? { loteId: input.loteId } : {}),
                    ...(input.borCod !== undefined ? { borCod: input.borCod } : {}),
                },
                t,
            );
            return { resultado: RESULTADO_TRANSICAO_GRUPO.APLICADO };
        });

    /** Linha do grupo travada (`FOR UPDATE`) para a transição. */
    private estadoParaAtualizar = async (
        grupoId: string,
        tx: TransactionClient,
    ): Promise<{ estado: string; fil_cod: number; codbar_mascarado: string } | null> =>
        tx.selectFirst(
            `SELECT estado, fil_cod, codbar_mascarado FROM sispag_grupo_boleto
              WHERE id = $grupoId::uuid FOR UPDATE`,
            { grupoId },
        );

    /** Estado denormalizado dos títulos = o do grupo (conferido no COMMIT pela 0090). */
    private propagarEstado = async (
        grupoId: string,
        estado: GrupoBoletoEstado,
        tx: TransactionClient,
    ): Promise<void> => {
        await tx.update(
            `UPDATE sispag_grupo_boleto_titulo SET estado = $estado WHERE grupo_id = $grupoId::uuid`,
            { grupoId, estado },
        );
    };

    /** Evento na trilha só-inclusão. Só a máscara 5+4; nenhum dígito longo em `dados`. */
    public registrarEvento = async (
        input: NovoEventoGrupo,
        tx?: TransactionClient,
    ): Promise<string> => {
        if (input.codigoMascarado !== undefined && !isCodigoMascarado(input.codigoMascarado)) {
            throw new Error('trilha do grupo aceita só o código mascarado 5+4');
        }
        const dados = input.dados !== undefined ? JSON.stringify(input.dados) : null;
        if (dados !== null && DIGITOS_LONGOS.test(dados)) {
            throw new Error('trilha do grupo não aceita sequência longa de dígitos em dados');
        }
        const id = randomUUID();
        await this.db(tx).insert(
            `INSERT INTO sispag_grupo_boleto_evento
                (id, grupo_id, tipo, ator, fil_cod, lote_id, execucao_id, bor_cod, ddc_cod,
                 dit_cod, codigo_mascarado, dados)
             VALUES ($id::uuid, $grupoId::uuid, $tipo, $ator, $filCod, $loteId::uuid,
                     $execucaoId::uuid, $borCod, $ddcCod, $ditCod, $codigoMascarado,
                     $dados::jsonb)`,
            {
                id,
                grupoId: input.grupoId,
                tipo: input.tipo,
                ator: input.ator,
                filCod: input.filCod ?? null,
                loteId: input.loteId ?? null,
                execucaoId: input.execucaoId ?? null,
                borCod: input.borCod ?? null,
                ddcCod: input.ddcCod ?? null,
                ditCod: input.ditCod ?? null,
                codigoMascarado: input.codigoMascarado ?? null,
                dados,
            },
        );
        return id;
    };

    public buscarPorId = async (
        id: string,
        tx?: TransactionClient,
    ): Promise<GrupoBoleto | null> => {
        const row = await this.db(tx).selectFirst<GrupoRow>(
            `SELECT ${COLUNAS_GRUPO} FROM sispag_grupo_boleto WHERE id = $id::uuid`,
            { id },
        );
        if (!row) return null;
        return (await this.comTitulos([row], tx))[0] ?? null;
    };

    /** Grupos `CONFIRMADO` (opcionalmente de uma filial), mais antigos primeiro. */
    public listarConfirmados = async (
        filtro: { filCod?: number } = {},
        tx?: TransactionClient,
    ): Promise<GrupoBoleto[]> => {
        const rows = (await this.db(tx).selectMany(
            `SELECT ${COLUNAS_GRUPO} FROM sispag_grupo_boleto
              WHERE estado = $confirmado
                AND ($filCod::int IS NULL OR fil_cod = $filCod::int)
              ORDER BY confirmado_em, id
              LIMIT 2000`,
            { confirmado: GRUPO_BOLETO_ESTADO.CONFIRMADO, filCod: filtro.filCod ?? null },
        )) as GrupoRow[];
        return this.comTitulos(rows, tx);
    };

    /**
     * Os grupos `CONFIRMADO` confirmados sob um par (`confirmacao_emissor_id`), TRAVADOS
     * (`FOR UPDATE`) na transação da revogação do par: a cascata (I15l(2), I21t) anula exatamente
     * o que travou. Um grupo confirmado enquanto a revogação espera vê o par `REVOGADA` (o
     * `confirmar` trava o par `FOR SHARE`) e nasce sob um par novo, nunca sob o revogado.
     */
    public listarConfirmadosDoPar = async (
        confirmacaoEmissorId: string,
        tx: TransactionClient,
    ): Promise<GrupoBoleto[]> => {
        const rows = (await tx.selectMany(
            `SELECT ${COLUNAS_GRUPO} FROM sispag_grupo_boleto
              WHERE confirmacao_emissor_id = $parId::uuid AND estado = $confirmado
              ORDER BY confirmado_em, id
              FOR UPDATE`,
            { parId: confirmacaoEmissorId, confirmado: GRUPO_BOLETO_ESTADO.CONFIRMADO },
        )) as GrupoRow[];
        return this.comTitulos(rows, tx);
    };

    /** O grupo `CONFIRMADO` do boleto, se houver (no máximo um, índice parcial I21i). */
    public buscarConfirmadoPorBoleto = async (
        ddcCod: number,
        ditCod: number,
        tx?: TransactionClient,
    ): Promise<GrupoBoleto | null> => {
        const row = await this.db(tx).selectFirst<GrupoRow>(
            `SELECT ${COLUNAS_GRUPO} FROM sispag_grupo_boleto
              WHERE ddc_cod = $ddcCod AND dit_cod = $ditCod AND estado = $confirmado`,
            { ddcCod, ditCod, confirmado: GRUPO_BOLETO_ESTADO.CONFIRMADO },
        );
        if (!row) return null;
        return (await this.comTitulos([row], tx))[0] ?? null;
    };

    /** O grupo `CONFIRMADO` que contém o título, se houver (no máximo um, índice parcial I21i). */
    public buscarConfirmadoPorTitulo = async (
        chave: ChaveTituloGrupo,
        tx?: TransactionClient,
    ): Promise<GrupoBoleto | null> => {
        const row = await this.db(tx).selectFirst<GrupoRow>(
            `SELECT ${COLUNAS_GRUPO} FROM sispag_grupo_boleto g
              WHERE g.estado = $confirmado
                AND EXISTS (
                    SELECT 1 FROM sispag_grupo_boleto_titulo t
                     WHERE t.grupo_id = g.id AND t.estado = $confirmado
                       AND t.fil_cod = $filCod AND t.doc_cod = $docCod AND t.tit_cod = $titCod)`,
            { ...chave, confirmado: GRUPO_BOLETO_ESTADO.CONFIRMADO },
        );
        if (!row) return null;
        return (await this.comTitulos([row], tx))[0] ?? null;
    };

    /** Trilha do grupo, em ordem cronológica. */
    public listarEventos = async (
        grupoId: string,
        tx?: TransactionClient,
    ): Promise<GrupoBoletoEventoRegistro[]> => {
        const rows = (await this.db(tx).selectMany(
            `SELECT ${COLUNAS_EVENTO} FROM sispag_grupo_boleto_evento
              WHERE grupo_id = $grupoId::uuid
              ORDER BY ocorrido_em, id`,
            { grupoId },
        )) as EventoRow[];
        return rows.map(this.mapEvento);
    };
}
