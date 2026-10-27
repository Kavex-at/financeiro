import { randomUUID } from 'node:crypto';
import { inject, injectable } from 'tsyringe';
import PostgreeDatabaseClient, {
    type TransactionClient,
} from '../../client/database/PostgreeDatabaseClient.js';
import SuggestionListingTruncatedError from '../../errors/SuggestionListingTruncatedError.js';
import {
    type ConfirmacaoEmissor,
    confirmacaoEmissorRowSchema,
    type DecisaoSugestao,
    type DecisaoSugestaoBoletoTipo,
    decisaoSugestaoRowSchema,
    type EstadoConfirmacaoEmissor,
    type EventoSugestaoBoleto,
    type EventoSugestaoRegistro,
    eventoSugestaoRowSchema,
    type ReconhecimentoDecisao,
} from '../../interface/sispag/ConfirmacaoEmissorBoleto.js';
import type {
    DecisaoConfirmadaChaveada,
    LayoutEmissor,
    ParVigenteChave,
    SinalSugestao,
    TierSugestao,
} from '../../interface/sispag/SugestaoBoleto.js';

const COLUNAS_PAR = `id, pes_cod, credor, emissor_chave, layout_emissor, banco_emissor,
    emissor_mascarado, estado, evidencia, confirmado_por, confirmado_em, revogado_por, revogado_em,
    motivo_revogacao, versao`;

const COLUNAS_DECISAO = `id, fil_cod, doc_cod, tit_cod, pes_cod, credor, ddc_cod, dit_cod,
    numero_boleto, codbar_mascarado, valor_titulo, to_char(vencimento_titulo, 'YYYY-MM-DD')
    AS vencimento_titulo, valor_boleto, to_char(vencimento_boleto, 'YYYY-MM-DD') AS vencimento_boleto,
    delta_valor, delta_percentual, delta_dias, sinais, tier, emissor_chave, decisao, decidido_por,
    decidido_em, motivo, confirmacao_emissor_id, versao, anulada_por, anulada_em, motivo_anulacao,
    tipo_anulacao, origem_decisao_id, transferida_por, reconhecimento_tipo, reconhecimento_motivo,
    reconhecimento_delta_dias_visto, reconhecimento_valor_boleto_visto_centavos, reconhecido_por,
    reconhecido_em`;

const COLUNAS_EVENTO = `id, tipo, ator, ocorrido_em, pes_cod, emissor_chave, fil_cod, doc_cod,
    tit_cod, ddc_cod, dit_cod, motivo, detalhe, lote_id, decisao_id`;

/** Teto defensivo das listagens (a tabela é de decisões humanas: ordem de milhares). */
const LIMITE_LISTAGEM = 10000;

export interface NovoPar {
    pesCod: string;
    credor?: string;
    emissorChave: string;
    layoutEmissor: LayoutEmissor;
    bancoEmissor: string;
    emissorMascarado: string;
    /** Snapshot: tier, deltas, sinais, quem. NUNCA barras nem linha digitável. */
    evidencia: Record<string, unknown>;
    confirmadoPor: string;
}

export interface NovaDecisao {
    filCod: number;
    docCod: string;
    titCod: string;
    pesCod: string;
    credor?: string;
    ddcCod: number;
    ditCod: number;
    numeroBoleto?: string;
    /** Só a forma mascarada: o repositório nunca grava as barras completas (I15k). */
    codbarMascarado: string;
    valorTitulo: number;
    vencimentoTitulo: string;
    valorBoleto: number;
    vencimentoBoleto: string;
    deltaValor: number;
    deltaPercentual: number;
    deltaDias: number;
    sinais: SinalSugestao[];
    tier?: TierSugestao;
    emissorChave: string;
    decisao: DecisaoSugestaoBoletoTipo;
    decididoPor: string;
    motivo?: string;
    confirmacaoEmissorId?: string;
    /**
     * Reconhecimento tipado (I15r, ADR-0078), gravado na MESMA linha e na mesma transação da
     * confirmação. `reconhecidoPor` vem do JWT; `reconhecido_em` é a hora do servidor.
     */
    reconhecimento?: Omit<ReconhecimentoDecisao, 'reconhecidoEm'>;
}

export interface NovoEventoSugestao {
    tipo: EventoSugestaoBoleto;
    ator: string;
    pesCod?: string;
    emissorChave?: string;
    filCod?: number;
    docCod?: string;
    titCod?: string;
    ddcCod?: number;
    ditCod?: number;
    motivo?: string;
    /** Só máscaras, estados e motivos. */
    detalhe?: Record<string, unknown>;
    /** Lote local — eventos `VINCULO_*` (0086). */
    loteId?: string;
    /** Decisão que autorizou o vínculo — eventos `VINCULO_*` (0086). */
    decisaoId?: string;
}

export interface FiltroDecisoes {
    decisao?: DecisaoSugestaoBoletoTipo;
    filCod?: number;
    docCod?: string;
    titCod?: string;
    ddcCod?: number;
    ditCod?: number;
    pesCod?: string;
    confirmacaoEmissorId?: string;
}

export interface FiltroEventos {
    tipo?: EventoSugestaoBoleto;
    filCod?: number;
    docCod?: string;
    titCod?: string;
    pesCod?: string;
    limite?: number;
}

/**
 * SugestaoBoletoRepository — `sispag_confirmacao_emissor_boleto`, `sispag_decisao_sugestao_boleto`
 * e a trilha só-inclusão `sispag_sugestao_boleto_evento` (ADR-0068, migration 0084). SQL 100%
 * parametrizado. Nenhuma coluna guarda as barras completas nem a linha digitável (I15k).
 *
 * As inserções que podem perder uma corrida usam `ON CONFLICT DO NOTHING ... RETURNING`: dentro de
 * uma transação, um `23505` abortaria o `BEGIN` inteiro e a perdedora não conseguiria reler. Sem
 * linha devolvida = outra transação venceu; o repositório relê e devolve a vencedora (I15j).
 */
@injectable()
export default class SugestaoBoletoRepository {
    public constructor(
        @inject(PostgreeDatabaseClient) private readonly db: PostgreeDatabaseClient,
    ) {}

    private conn = (tx?: TransactionClient): PostgreeDatabaseClient | TransactionClient =>
        tx ?? this.db;

    // ── Par (credor, emissor) ──────────────────────────────────────────────────────────────────

    /** Os pares VIGENTES; com `pesCods`, só os desses credores. */
    public listarParesVigentes = async (
        pesCods?: readonly string[],
        tx?: TransactionClient,
    ): Promise<ConfirmacaoEmissor[]> => {
        const rows = await this.conn(tx).selectMany(
            `SELECT ${COLUNAS_PAR} FROM sispag_confirmacao_emissor_boleto
              WHERE estado = 'VIGENTE'
                AND ($pesCods::text[] IS NULL OR pes_cod = ANY($pesCods::text[]))
              ORDER BY confirmado_em DESC, id
              LIMIT ${LIMITE_LISTAGEM}`,
            { pesCods: pesCods ? [...new Set(pesCods)] : null },
        );
        this.exigirNaoTruncada('pares_vigentes', rows.length);
        return rows.map((r) => confirmacaoEmissorRowSchema.parse(r));
    };

    /** Lista para a tela (qualquer estado), mais recentes primeiro. */
    public listarPares = async (
        filtro: { estado?: EstadoConfirmacaoEmissor; pesCod?: string } = {},
    ): Promise<ConfirmacaoEmissor[]> => {
        const rows = await this.db.selectMany(
            `SELECT ${COLUNAS_PAR} FROM sispag_confirmacao_emissor_boleto
              WHERE ($estado::text IS NULL OR estado = $estado::text)
                AND ($pesCod::text IS NULL OR pes_cod = $pesCod::text)
              ORDER BY confirmado_em DESC, id
              LIMIT ${LIMITE_LISTAGEM}`,
            { estado: filtro.estado ?? null, pesCod: filtro.pesCod ?? null },
        );
        this.exigirNaoTruncada('pares', rows.length);
        return rows.map((r) => confirmacaoEmissorRowSchema.parse(r));
    };

    /**
     * Com `travar` (e dentro de uma transação), `FOR SHARE`: uma revogação do par espera esta
     * transação terminar e, ao prosseguir, ainda enxerga a decisão que ela gravou — a cascata a
     * anula (I15l). Se a revogação chegou primeiro, o `WHERE estado = 'VIGENTE'` é reavaliado e a
     * linha some: o chamador cria um par novo, nunca grava sob um par REVOGADA.
     */
    public buscarParVigente = async (
        pesCod: string,
        emissorChave: string,
        tx?: TransactionClient,
        travar = false,
    ): Promise<ConfirmacaoEmissor | null> => {
        const row = await this.conn(tx).selectFirst<Record<string, unknown>>(
            `SELECT ${COLUNAS_PAR} FROM sispag_confirmacao_emissor_boleto
              WHERE pes_cod = $pesCod AND emissor_chave = $emissorChave AND estado = 'VIGENTE'
              LIMIT 1${travar && tx ? ' FOR SHARE' : ''}`,
            { pesCod, emissorChave },
        );
        return row ? confirmacaoEmissorRowSchema.parse(row) : null;
    };

    public buscarParPorId = async (
        id: string,
        tx?: TransactionClient,
    ): Promise<ConfirmacaoEmissor | null> => {
        const row = await this.conn(tx).selectFirst<Record<string, unknown>>(
            `SELECT ${COLUNAS_PAR} FROM sispag_confirmacao_emissor_boleto WHERE id = $id`,
            { id },
        );
        return row ? confirmacaoEmissorRowSchema.parse(row) : null;
    };

    /**
     * Insere o par VIGENTE. Se já existe um para (credor, emissor) — corrida de duas confirmações —
     * não duplica: devolve o vencedor com `criado = false` (I15j).
     */
    public inserirPar = async (
        input: NovoPar,
        tx?: TransactionClient,
    ): Promise<{ criado: boolean; par: ConfirmacaoEmissor }> => {
        const id = randomUUID();
        const inserida = await this.conn(tx).selectFirst<{ id: string }>(
            `INSERT INTO sispag_confirmacao_emissor_boleto
                (id, pes_cod, credor, emissor_chave, layout_emissor, banco_emissor,
                 emissor_mascarado, estado, evidencia, confirmado_por, confirmado_em)
             VALUES ($id, $pesCod, $credor, $emissorChave, $layoutEmissor, $bancoEmissor,
                     $emissorMascarado, 'VIGENTE', $evidencia::jsonb, $confirmadoPor, now())
             ON CONFLICT (pes_cod, emissor_chave) WHERE estado = 'VIGENTE' DO NOTHING
             RETURNING id`,
            {
                id,
                pesCod: input.pesCod,
                credor: input.credor ?? null,
                emissorChave: input.emissorChave,
                layoutEmissor: input.layoutEmissor,
                bancoEmissor: input.bancoEmissor,
                emissorMascarado: input.emissorMascarado,
                evidencia: JSON.stringify(input.evidencia),
                confirmadoPor: input.confirmadoPor,
            },
        );
        const par = inserida
            ? await this.buscarParPorId(inserida.id, tx)
            : await this.buscarParVigente(input.pesCod, input.emissorChave, tx, true);
        if (!par) throw new Error('par de emissor não encontrado após a inserção');
        return { criado: inserida != null, par };
    };

    /**
     * VIGENTE → REVOGADA com lock otimista por `versao` (e só se ainda VIGENTE). Devolve as linhas
     * afetadas: 0 = alguém mudou antes; o serviço relê para decidir (no-op ou conflito).
     */
    public revogarPar = async (
        input: { id: string; versaoEsperada: number; ator: string; motivo: string },
        tx?: TransactionClient,
    ): Promise<number> =>
        this.conn(tx).update(
            `UPDATE sispag_confirmacao_emissor_boleto
                SET estado = 'REVOGADA', revogado_por = $ator, revogado_em = now(),
                    motivo_revogacao = $motivo, versao = versao + 1
              WHERE id = $id AND versao = $versao AND estado = 'VIGENTE'`,
            { id: input.id, versao: input.versaoEsperada, ator: input.ator, motivo: input.motivo },
        );

    // ── Decisão por título ─────────────────────────────────────────────────────────────────────

    /**
     * Grava a decisão. Se um índice único parcial recusa (corrida, ou título/boleto já decidido),
     * não lança: relê e devolve a linha que já existe com `criada = false`. A vencedora pode ser do
     * mesmo par (idempotência) ou de outro (o serviço compara e nomeia o conflito).
     */
    public inserirDecisao = async (
        input: NovaDecisao,
        tx?: TransactionClient,
    ): Promise<{ criada: boolean; decisao: DecisaoSugestao }> => {
        const id = randomUUID();
        const inserida = await this.conn(tx).selectFirst<{ id: string }>(
            `INSERT INTO sispag_decisao_sugestao_boleto
                (id, fil_cod, doc_cod, tit_cod, pes_cod, credor, ddc_cod, dit_cod, numero_boleto,
                 codbar_mascarado, valor_titulo, vencimento_titulo, valor_boleto, vencimento_boleto,
                 delta_valor, delta_percentual, delta_dias, sinais, tier, emissor_chave, decisao,
                 decidido_por, decidido_em, motivo, confirmacao_emissor_id,
                 reconhecimento_tipo, reconhecimento_motivo, reconhecimento_delta_dias_visto,
                 reconhecimento_valor_boleto_visto_centavos, reconhecido_por, reconhecido_em)
             VALUES ($id, $filCod, $docCod, $titCod, $pesCod, $credor, $ddcCod, $ditCod,
                     $numeroBoleto, $codbarMascarado, $valorTitulo, $vencimentoTitulo::date,
                     $valorBoleto, $vencimentoBoleto::date, $deltaValor, $deltaPercentual,
                     $deltaDias, $sinais::jsonb, $tier, $emissorChave, $decisao, $decididoPor,
                     now(), $motivo, $confirmacaoEmissorId::uuid,
                     $reconhecimentoTipo, $reconhecimentoMotivo, $reconhecimentoDeltaDiasVisto,
                     $reconhecimentoValorBoletoVisto, $reconhecidoPor,
                     CASE WHEN $reconhecimentoTipo::text IS NULL THEN NULL ELSE now() END)
             ON CONFLICT DO NOTHING
             RETURNING id`,
            {
                id,
                filCod: input.filCod,
                docCod: input.docCod,
                titCod: input.titCod,
                pesCod: input.pesCod,
                credor: input.credor ?? null,
                ddcCod: input.ddcCod,
                ditCod: input.ditCod,
                numeroBoleto: input.numeroBoleto ?? null,
                codbarMascarado: input.codbarMascarado,
                valorTitulo: input.valorTitulo,
                vencimentoTitulo: input.vencimentoTitulo,
                valorBoleto: input.valorBoleto,
                vencimentoBoleto: input.vencimentoBoleto,
                deltaValor: input.deltaValor,
                deltaPercentual: input.deltaPercentual,
                deltaDias: input.deltaDias,
                sinais: JSON.stringify(input.sinais),
                tier: input.tier ?? null,
                emissorChave: input.emissorChave,
                decisao: input.decisao,
                decididoPor: input.decididoPor,
                motivo: input.motivo ?? null,
                confirmacaoEmissorId: input.confirmacaoEmissorId ?? null,
                reconhecimentoTipo: input.reconhecimento?.tipo ?? null,
                reconhecimentoMotivo: input.reconhecimento?.motivo ?? null,
                reconhecimentoDeltaDiasVisto: input.reconhecimento?.deltaDiasVisto ?? null,
                reconhecimentoValorBoletoVisto: input.reconhecimento?.valorBoletoVisto ?? null,
                reconhecidoPor: input.reconhecimento?.reconhecidoPor ?? null,
            },
        );
        const alvo = inserida ? { id: inserida.id } : null;
        const row = alvo
            ? await this.conn(tx).selectFirst<Record<string, unknown>>(
                  `SELECT ${COLUNAS_DECISAO} FROM sispag_decisao_sugestao_boleto WHERE id = $id`,
                  { id: alvo.id },
              )
            : await this.reler(input, tx);
        if (!row) throw new Error('decisão de sugestão não encontrada após a inserção');
        return { criada: inserida != null, decisao: decisaoSugestaoRowSchema.parse(row) };
    };

    /** A linha que impediu a inserção: mesmo título OU mesmo boleto (CONFIRMADA); (título, boleto) (REJEITADA). */
    private reler = (
        input: NovaDecisao,
        tx?: TransactionClient,
    ): Promise<Record<string, unknown> | null> => {
        const params = {
            decisao: input.decisao,
            filCod: input.filCod,
            docCod: input.docCod,
            titCod: input.titCod,
            ddcCod: input.ddcCod,
            ditCod: input.ditCod,
        };
        if (input.decisao === 'REJEITADA') {
            return this.conn(tx).selectFirst<Record<string, unknown>>(
                `SELECT ${COLUNAS_DECISAO} FROM sispag_decisao_sugestao_boleto
                  WHERE decisao = $decisao
                    AND fil_cod = $filCod AND doc_cod = $docCod AND tit_cod = $titCod
                    AND ddc_cod = $ddcCod AND dit_cod = $ditCod
                  LIMIT 1`,
                params,
            );
        }
        return this.conn(tx).selectFirst<Record<string, unknown>>(
            `SELECT ${COLUNAS_DECISAO} FROM sispag_decisao_sugestao_boleto
              WHERE decisao = $decisao
                AND ((fil_cod = $filCod AND doc_cod = $docCod AND tit_cod = $titCod)
                     OR (ddc_cod = $ddcCod AND dit_cod = $ditCod))
              ORDER BY decidido_em, id
              LIMIT 1`,
            params,
        );
    };

    public listarDecisoes = async (
        filtro: FiltroDecisoes = {},
        tx?: TransactionClient,
    ): Promise<DecisaoSugestao[]> => {
        const rows = await this.conn(tx).selectMany(
            `SELECT ${COLUNAS_DECISAO} FROM sispag_decisao_sugestao_boleto
              WHERE ($decisao::text IS NULL OR decisao = $decisao::text)
                AND ($filCod::int IS NULL OR fil_cod = $filCod::int)
                AND ($docCod::text IS NULL OR doc_cod = $docCod::text)
                AND ($titCod::text IS NULL OR tit_cod = $titCod::text)
                AND ($ddcCod::int IS NULL OR ddc_cod = $ddcCod::int)
                AND ($ditCod::int IS NULL OR dit_cod = $ditCod::int)
                AND ($pesCod::text IS NULL OR pes_cod = $pesCod::text)
                AND ($confirmacaoEmissorId::uuid IS NULL
                     OR confirmacao_emissor_id = $confirmacaoEmissorId::uuid)
              ORDER BY decidido_em DESC, id
              LIMIT ${LIMITE_LISTAGEM}`,
            {
                decisao: filtro.decisao ?? null,
                filCod: filtro.filCod ?? null,
                docCod: filtro.docCod ?? null,
                titCod: filtro.titCod ?? null,
                ddcCod: filtro.ddcCod ?? null,
                ditCod: filtro.ditCod ?? null,
                pesCod: filtro.pesCod ?? null,
                confirmacaoEmissorId: filtro.confirmacaoEmissorId ?? null,
            },
        );
        this.exigirNaoTruncada('decisoes', rows.length);
        return rows.map((r) => decisaoSugestaoRowSchema.parse(r));
    };

    /**
     * As decisões `CONFIRMADA` de um par, TRAVADAS (`FOR UPDATE`) na transação da revogação: a
     * cascata (I15l) anula exatamente o que travou.
     */
    public listarConfirmadasDoPar = async (
        confirmacaoEmissorId: string,
        tx: TransactionClient,
    ): Promise<DecisaoSugestao[]> => {
        const rows = await tx.selectMany(
            `SELECT ${COLUNAS_DECISAO} FROM sispag_decisao_sugestao_boleto
              WHERE confirmacao_emissor_id = $id::uuid AND decisao = 'CONFIRMADA'
              ORDER BY decidido_em, id
              FOR UPDATE`,
            { id: confirmacaoEmissorId },
        );
        return rows.map((r) => decisaoSugestaoRowSchema.parse(r));
    };

    public buscarDecisaoPorId = async (
        id: string,
        tx?: TransactionClient,
    ): Promise<DecisaoSugestao | null> => {
        const row = await this.conn(tx).selectFirst<Record<string, unknown>>(
            `SELECT ${COLUNAS_DECISAO} FROM sispag_decisao_sugestao_boleto WHERE id = $id::uuid`,
            { id },
        );
        return row ? decisaoSugestaoRowSchema.parse(row) : null;
    };

    /**
     * CONFIRMADA → ANULADA com lock otimista por `versao` (e só se ainda CONFIRMADA). Devolve as
     * linhas afetadas: 0 = alguém mudou antes; o serviço relê para decidir (no-op ou conflito).
     * Libera o título e o boleto: os índices únicos valem só para `decisao = 'CONFIRMADA'`.
     */
    public anularDecisao = async (
        input: { id: string; versaoEsperada: number; ator: string; motivo: string },
        tx?: TransactionClient,
    ): Promise<number> =>
        this.conn(tx).update(
            `UPDATE sispag_decisao_sugestao_boleto
                SET decisao = 'ANULADA', anulada_por = $ator, anulada_em = now(),
                    motivo_anulacao = $motivo, versao = versao + 1
              WHERE id = $id::uuid AND versao = $versao AND decisao = 'CONFIRMADA'`,
            { id: input.id, versao: input.versaoEsperada, ator: input.ator, motivo: input.motivo },
        );

    /**
     * Transferência AUDITADA da confirmação humana ao título renegociado (I18j(1)–(3), M1), na
     * transação do rechaveamento. ANULA ANTES DE INSERIR (os índices únicos de CONFIRMADA por
     * título e por boleto valem só para a vigente, I15l):
     *   1. a decisão antiga (travada `FOR UPDATE`, só se ainda CONFIRMADA) vai a `ANULADA` com
     *      `tipo_anulacao = TITULO_RENEGOCIADO`, `anulada_por = sistema`;
     *   2. nasce a `CONFIRMADA` no título novo herdando `decidido_por`/`decidido_em` (transferir
     *      não é confirmar, I15g), com `origem_decisao_id` e `transferida_por = sistema`;
     *   3. eventos `TITULO_RENEGOCIADO` e `DECISAO_TRANSFERIDA` na trilha.
     * Decisão já não CONFIRMADA (a analista anulou) ⇒ `{ transferida: false }` e nada muda.
     */
    public transferirDecisao = async (
        input: {
            decisaoId: string;
            titCodNovo: string;
            frnCod: number;
            ator: string;
        },
        tx: TransactionClient,
    ): Promise<{ transferida: boolean; novaDecisaoId?: string }> => {
        const atual = await tx.selectFirst<Record<string, unknown>>(
            `SELECT ${COLUNAS_DECISAO} FROM sispag_decisao_sugestao_boleto
              WHERE id = $id::uuid FOR UPDATE`,
            { id: input.decisaoId },
        );
        if (!atual) return { transferida: false };
        const antiga = decisaoSugestaoRowSchema.parse(atual);
        if (antiga.decisao !== 'CONFIRMADA') return { transferida: false };
        const motivo = `título renegociado ${antiga.docCod}/${antiga.titCod} → ${antiga.docCod}/${input.titCodNovo}, frnCod ${input.frnCod}`;
        await tx.update(
            `UPDATE sispag_decisao_sugestao_boleto
                SET decisao = 'ANULADA', anulada_por = $ator, anulada_em = now(),
                    motivo_anulacao = $motivo, tipo_anulacao = 'TITULO_RENEGOCIADO',
                    versao = versao + 1
              WHERE id = $id::uuid AND decisao = 'CONFIRMADA'`,
            { id: antiga.id, ator: input.ator, motivo },
        );
        const novaId = randomUUID();
        await tx.insert(
            `INSERT INTO sispag_decisao_sugestao_boleto
                (id, fil_cod, doc_cod, tit_cod, pes_cod, credor, ddc_cod, dit_cod, numero_boleto,
                 codbar_mascarado, valor_titulo, vencimento_titulo, valor_boleto, vencimento_boleto,
                 delta_valor, delta_percentual, delta_dias, sinais, tier, emissor_chave, decisao,
                 decidido_por, decidido_em, motivo, confirmacao_emissor_id, origem_decisao_id,
                 transferida_por, reconhecimento_tipo, reconhecimento_motivo,
                 reconhecimento_delta_dias_visto, reconhecimento_valor_boleto_visto_centavos,
                 reconhecido_por, reconhecido_em)
             SELECT $novaId::uuid, fil_cod, doc_cod, $titCodNovo, pes_cod, credor, ddc_cod, dit_cod,
                    numero_boleto, codbar_mascarado, valor_titulo, vencimento_titulo, valor_boleto,
                    vencimento_boleto, delta_valor, delta_percentual, delta_dias, sinais, tier,
                    emissor_chave, 'CONFIRMADA', decidido_por, decidido_em, motivo,
                    confirmacao_emissor_id, id, $ator, reconhecimento_tipo, reconhecimento_motivo,
                    reconhecimento_delta_dias_visto, reconhecimento_valor_boleto_visto_centavos,
                    reconhecido_por, reconhecido_em
               FROM sispag_decisao_sugestao_boleto WHERE id = $id::uuid`,
            { novaId, titCodNovo: input.titCodNovo, ator: input.ator, id: antiga.id },
        );
        const base = {
            ator: input.ator,
            pesCod: antiga.pesCod,
            emissorChave: antiga.emissorChave,
            filCod: antiga.filCod,
            docCod: antiga.docCod,
            ddcCod: antiga.ddcCod,
            ditCod: antiga.ditCod,
        };
        await this.inserirEventoAjuste(
            {
                ...base,
                tipo: 'TITULO_RENEGOCIADO',
                titCod: antiga.titCod,
                decisaoId: antiga.id,
                motivo,
                detalhe: {
                    titCodNovo: input.titCodNovo,
                    frnCod: input.frnCod,
                    codbarMascarado: antiga.codbarMascarado,
                },
            },
            tx,
        );
        await this.inserirEventoAjuste(
            {
                ...base,
                tipo: 'DECISAO_TRANSFERIDA',
                titCod: input.titCodNovo,
                decisaoId: novaId,
                motivo: 'decisão transferida ao título renegociado',
                detalhe: {
                    origemDecisaoId: antiga.id,
                    titCodAntigo: antiga.titCod,
                    decididoPor: antiga.decididoPor,
                },
            },
            tx,
        );
        return { transferida: true, novaDecisaoId: novaId };
    };

    /**
     * Evento do ajuste de centavos (ADR-0074) com `decisao_id`. `ON CONFLICT DO NOTHING`: o
     * `AJUSTE_SIMULADO` é único por (título, decisão, motivo) — a varredura `shadow` não inunda a
     * trilha. Recusa dígitos longos no detalhe (I15k).
     */
    public inserirEventoAjuste = async (
        input: NovoEventoSugestao,
        tx?: TransactionClient,
    ): Promise<{ inserido: boolean }> => {
        const detalhe = input.detalhe ? JSON.stringify(input.detalhe) : null;
        // UUIDs (decisão de origem) podem ter 10+ dígitos seguidos e não são código de barras.
        const semUuid = detalhe?.replace(
            /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
            '',
        );
        if (semUuid !== undefined && /\d{10,}/.test(semUuid)) {
            throw new Error('detalhe do evento do ajuste não pode carregar dígitos longos');
        }
        const n = await this.conn(tx).update(
            `INSERT INTO sispag_sugestao_boleto_evento
                (id, tipo, ator, ocorrido_em, pes_cod, emissor_chave, fil_cod, doc_cod, tit_cod,
                 ddc_cod, dit_cod, motivo, detalhe, decisao_id)
             VALUES ($id, $tipo, $ator, now(), $pesCod, $emissorChave, $filCod, $docCod, $titCod,
                     $ddcCod, $ditCod, $motivo, $detalhe::jsonb, $decisaoId::uuid)
             ON CONFLICT DO NOTHING`,
            {
                id: randomUUID(),
                tipo: input.tipo,
                ator: input.ator,
                pesCod: input.pesCod ?? null,
                emissorChave: input.emissorChave ?? null,
                filCod: input.filCod ?? null,
                docCod: input.docCod ?? null,
                titCod: input.titCod ?? null,
                ddcCod: input.ddcCod ?? null,
                ditCod: input.ditCod ?? null,
                motivo: input.motivo ?? null,
                detalhe,
                decisaoId: input.decisaoId ?? null,
            },
        );
        return { inserido: n > 0 };
    };

    /** Lista no teto = possivelmente truncada: falha alto, nunca devolve decisão "ausente". */
    private exigirNaoTruncada = (listagem: string, linhas: number): void => {
        if (linhas >= LIMITE_LISTAGEM) {
            throw new SuggestionListingTruncatedError({ listagem, limite: LIMITE_LISTAGEM });
        }
    };

    /** Decisões de um tipo no formato que o motor consome (chave do título + chave do boleto). */
    public listarChaveadas = async (
        decisao: DecisaoSugestaoBoletoTipo,
    ): Promise<DecisaoConfirmadaChaveada[]> =>
        (await this.listarDecisoes({ decisao })).map((d) => ({
            filCod: d.filCod,
            docCod: d.docCod,
            titCod: d.titCod,
            ddcCod: d.ddcCod,
            ditCod: d.ditCod,
            ...(d.numeroBoleto ? { numeroBoleto: d.numeroBoleto } : {}),
            valorTitulo: d.valorTitulo,
            vencimentoTitulo: d.vencimentoTitulo,
            valorBoleto: d.valorBoleto,
            vencimentoBoleto: d.vencimentoBoleto,
            deltaValor: d.deltaValor,
            deltaPercentual: d.deltaPercentual,
            deltaDias: d.deltaDias,
            sinais: d.sinais,
            ...(d.tier ? { tier: d.tier } : {}),
            decididoPor: d.decididoPor,
            ...(d.transferidaPor ? { transferidaPor: d.transferidaPor } : {}),
            ...(d.reconhecimento
                ? {
                      reconhecimento: {
                          deltaDiasVisto: d.reconhecimento.deltaDiasVisto,
                          valorBoletoVisto: d.reconhecimento.valorBoletoVisto,
                      },
                  }
                : {}),
        }));

    /** Pares (credor, emissor) VIGENTES no formato que o motor consome. */
    public listarParesChave = async (): Promise<ParVigenteChave[]> =>
        (await this.listarParesVigentes()).map((p) => ({
            pesCod: p.pesCod,
            emissorChave: p.emissorChave,
        }));

    // ── Trilha só-inclusão ─────────────────────────────────────────────────────────────────────

    public inserirEvento = async (
        input: NovoEventoSugestao,
        tx?: TransactionClient,
    ): Promise<string> => {
        const id = randomUUID();
        await this.conn(tx).insert(
            `INSERT INTO sispag_sugestao_boleto_evento
                (id, tipo, ator, ocorrido_em, pes_cod, emissor_chave, fil_cod, doc_cod, tit_cod,
                 ddc_cod, dit_cod, motivo, detalhe)
             VALUES ($id, $tipo, $ator, now(), $pesCod, $emissorChave, $filCod, $docCod, $titCod,
                     $ddcCod, $ditCod, $motivo, $detalhe::jsonb)`,
            {
                id,
                tipo: input.tipo,
                ator: input.ator,
                pesCod: input.pesCod ?? null,
                emissorChave: input.emissorChave ?? null,
                filCod: input.filCod ?? null,
                docCod: input.docCod ?? null,
                titCod: input.titCod ?? null,
                ddcCod: input.ddcCod ?? null,
                ditCod: input.ditCod ?? null,
                motivo: input.motivo ?? null,
                detalhe: input.detalhe ? JSON.stringify(input.detalhe) : null,
            },
        );
        return id;
    };

    /**
     * Evento de VÍNCULO (`VINCULO_APLICADO`/`VINCULO_SIMULADO`/`VINCULO_FALHOU`, ADR-0071) com a
     * chave de idempotência da 0086: `ON CONFLICT DO NOTHING` — sob concorrência, ou numa retomada,
     * o segundo `VINCULO_APLICADO` do mesmo (lote, título, decisão) não entra (e a transação do
     * chamador não aborta). `inserido = false` ⇒ o fato já estava registrado.
     * Só máscara e motivo: nunca o código (I17j).
     */
    public registrarEventoVinculo = async (
        input: NovoEventoSugestao & { loteId: string },
        tx?: TransactionClient,
    ): Promise<{ inserido: boolean }> => {
        const detalhe = input.detalhe ? JSON.stringify(input.detalhe) : null;
        if (detalhe !== null && /\d{10,}/.test(detalhe)) {
            throw new Error('detalhe do evento de vínculo não pode carregar dígitos longos');
        }
        const n = await this.conn(tx).update(
            `INSERT INTO sispag_sugestao_boleto_evento
                (id, tipo, ator, ocorrido_em, pes_cod, emissor_chave, fil_cod, doc_cod, tit_cod,
                 ddc_cod, dit_cod, motivo, detalhe, lote_id, decisao_id)
             VALUES ($id, $tipo, $ator, now(), $pesCod, $emissorChave, $filCod, $docCod, $titCod,
                     $ddcCod, $ditCod, $motivo, $detalhe::jsonb, $loteId::uuid, $decisaoId::uuid)
             ON CONFLICT DO NOTHING`,
            {
                id: randomUUID(),
                tipo: input.tipo,
                ator: input.ator,
                pesCod: input.pesCod ?? null,
                emissorChave: input.emissorChave ?? null,
                filCod: input.filCod ?? null,
                docCod: input.docCod ?? null,
                titCod: input.titCod ?? null,
                ddcCod: input.ddcCod ?? null,
                ditCod: input.ditCod ?? null,
                motivo: input.motivo ?? null,
                detalhe,
                loteId: input.loteId,
                decisaoId: input.decisaoId ?? null,
            },
        );
        return { inserido: n > 0 };
    };

    /** Já existe `VINCULO_APLICADO` para (lote, título, decisão)? (I17f — idempotência). */
    public existeVinculoAplicado = async (
        input: {
            loteId: string;
            filCod: number;
            docCod: string;
            titCod: string;
            decisaoId: string;
        },
        tx?: TransactionClient,
    ): Promise<boolean> => {
        const row = await this.conn(tx).selectFirst<{ n: number }>(
            `SELECT 1 AS n FROM sispag_sugestao_boleto_evento
              WHERE tipo = 'VINCULO_APLICADO' AND lote_id = $loteId::uuid
                AND fil_cod = $filCod AND doc_cod = $docCod AND tit_cod = $titCod
                AND decisao_id = $decisaoId::uuid
              LIMIT 1`,
            input,
        );
        return row != null;
    };

    public listarEventos = async (
        filtro: FiltroEventos = {},
    ): Promise<EventoSugestaoRegistro[]> => {
        const rows = await this.db.selectMany(
            `SELECT ${COLUNAS_EVENTO} FROM sispag_sugestao_boleto_evento
              WHERE ($tipo::text IS NULL OR tipo = $tipo::text)
                AND ($filCod::int IS NULL OR fil_cod = $filCod::int)
                AND ($docCod::text IS NULL OR doc_cod = $docCod::text)
                AND ($titCod::text IS NULL OR tit_cod = $titCod::text)
                AND ($pesCod::text IS NULL OR pes_cod = $pesCod::text)
              ORDER BY ocorrido_em, id
              LIMIT $limite::int`,
            {
                tipo: filtro.tipo ?? null,
                filCod: filtro.filCod ?? null,
                docCod: filtro.docCod ?? null,
                titCod: filtro.titCod ?? null,
                pesCod: filtro.pesCod ?? null,
                limite: Math.min(filtro.limite ?? 1000, LIMITE_LISTAGEM),
            },
        );
        return rows.map((r) => eventoSugestaoRowSchema.parse(r));
    };
}
