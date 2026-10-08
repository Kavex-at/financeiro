import { randomUUID } from 'node:crypto';
import { inject, injectable } from 'tsyringe';
import PostgreeDatabaseClient, {
    type TransactionClient,
} from '../../client/database/PostgreeDatabaseClient.js';
import AuthorizedPayeeActiveExistsError from '../../errors/AuthorizedPayeeActiveExistsError.js';
import {
    AUTHORIZED_PAYEE_ACTIVE_STATES,
    type AuthorizedPayee,
    type AuthorizedPayeeEvent,
    type AuthorizedPayeeEventRecord,
    type AuthorizedPayeeModality,
    type AuthorizedPayeeState,
    authorizedPayeeEventRowSchema,
    authorizedPayeeRowSchema,
    type PayeeRecheckResult,
    type PayeeRequestOrigin,
    type PayeeWarning,
} from '../../interface/sispag/AuthorizedPayeeInterface.js';

const UNIQUE_VIOLATION = '23505';

const COLUNAS = `id, pes_cod, credor, modalidade, estado, fingerprint, fingerprint_chave_id,
    destino_mascarado, avisos, fingerprint_observado, destino_observado_mascarado,
    origem_solicitacao, fil_cod_leitura, solicitado_por, solicitado_em, decidido_por, decidido_em,
    motivo_decisao, ultima_conferencia_em, ultima_conferencia_resultado, criado_em, versao`;

/** Pedido novo (F1). Nunca nasce AUTORIZADO: o estado é fixo no SQL. */
export interface NovaAutorizacaoInput {
    pesCod: string;
    credor?: string;
    modalidade: AuthorizedPayeeModality;
    origemSolicitacao: PayeeRequestOrigin;
    filCodLeitura: number;
    solicitadoPor: string;
}

/**
 * Patch de uma transição. Campo ausente = não muda; `null` = limpa. Só as colunas que as transições
 * F2–F7 e a reconferência mexem — `pes_cod`/`modalidade`/`origem` nunca mudam depois de criadas.
 */
export interface AutorizacaoPatch {
    estado?: AuthorizedPayeeState;
    fingerprint?: string | null;
    fingerprintChaveId?: string | null;
    destinoMascarado?: string | null;
    avisos?: PayeeWarning[];
    fingerprintObservado?: string | null;
    destinoObservadoMascarado?: string | null;
    solicitadoPor?: string | null;
    solicitadoEm?: Date | null;
    decididoPor?: string | null;
    decididoEm?: Date | null;
    motivoDecisao?: string | null;
    ultimaConferenciaEm?: Date | null;
    ultimaConferenciaResultado?: PayeeRecheckResult | null;
    credor?: string | null;
}

/** Coluna de cada campo do patch — a lista FECHADA do que um UPDATE pode tocar. */
const COLUNA_DO_PATCH: Readonly<Record<keyof AutorizacaoPatch, string>> = {
    estado: 'estado',
    fingerprint: 'fingerprint',
    fingerprintChaveId: 'fingerprint_chave_id',
    destinoMascarado: 'destino_mascarado',
    avisos: 'avisos',
    fingerprintObservado: 'fingerprint_observado',
    destinoObservadoMascarado: 'destino_observado_mascarado',
    solicitadoPor: 'solicitado_por',
    solicitadoEm: 'solicitado_em',
    decididoPor: 'decidido_por',
    decididoEm: 'decidido_em',
    motivoDecisao: 'motivo_decisao',
    ultimaConferenciaEm: 'ultima_conferencia_em',
    ultimaConferenciaResultado: 'ultima_conferencia_resultado',
    credor: 'credor',
};

export interface AutorizacaoEventoInput {
    autorizacaoId: string;
    evento: AuthorizedPayeeEvent;
    ator: string;
    /** Só estados, máscaras e motivos. NUNCA conta ou chave completas (I14j). */
    dados?: Record<string, unknown>;
}

export interface FiltroAutorizacoes {
    estado?: AuthorizedPayeeState;
    pesCod?: string;
}

/**
 * AuthorizedPayeeRepository — `sispag_favorecido_autorizado` e a trilha só-inclusão
 * `sispag_favorecido_autorizado_evento` (ADR-0065, migration 0080). SQL 100% parametrizado; nenhuma
 * coluna guarda o destino completo. A violação do índice de vigência (corrida de dois pedidos) vira
 * erro de domínio 409.
 */
@injectable()
export default class AuthorizedPayeeRepository {
    public constructor(
        @inject(PostgreeDatabaseClient) private readonly db: PostgreeDatabaseClient,
    ) {}

    /** O registro vigente (PENDENTE | AUTORIZADO | REAPROVACAO_PENDENTE) do par, se houver. */
    public buscarVigente = async (
        pesCod: string,
        modalidade: AuthorizedPayeeModality,
        tx?: TransactionClient,
    ): Promise<AuthorizedPayee | null> => {
        const row = await (tx ?? this.db).selectFirst<Record<string, unknown>>(
            `SELECT ${COLUNAS} FROM sispag_favorecido_autorizado
              WHERE pes_cod = $pesCod AND modalidade = $modalidade
                AND estado = ANY($ativos::text[])
              LIMIT 1`,
            { pesCod, modalidade, ativos: [...AUTHORIZED_PAYEE_ACTIVE_STATES] },
        );
        return row ? authorizedPayeeRowSchema.parse(row) : null;
    };

    public buscarPorId = async (
        id: string,
        tx?: TransactionClient,
    ): Promise<AuthorizedPayee | null> => {
        const row = await (tx ?? this.db).selectFirst<Record<string, unknown>>(
            `SELECT ${COLUNAS} FROM sispag_favorecido_autorizado WHERE id = $id`,
            { id },
        );
        return row ? authorizedPayeeRowSchema.parse(row) : null;
    };

    /** Lista para a tela, mais recentes primeiro. Filtros opcionais por estado e favorecido. */
    public listar = async (filtro: FiltroAutorizacoes = {}): Promise<AuthorizedPayee[]> => {
        const rows = await this.db.selectMany(
            `SELECT ${COLUNAS} FROM sispag_favorecido_autorizado
              WHERE ($estado::text IS NULL OR estado = $estado::text)
                AND ($pesCod::text IS NULL OR pes_cod = $pesCod::text)
              ORDER BY solicitado_em DESC NULLS LAST, criado_em DESC
              LIMIT 1000`,
            { estado: filtro.estado ?? null, pesCod: filtro.pesCod ?? null },
        );
        return rows.map((r) => authorizedPayeeRowSchema.parse(r));
    };

    /** As vigentes de vários favorecidos numa consulta só (verificação em lote e relatório). */
    public listarVigentesPorPesCods = async (
        pesCods: readonly string[],
        tx?: TransactionClient,
    ): Promise<AuthorizedPayee[]> => {
        if (pesCods.length === 0) return [];
        const rows = await (tx ?? this.db).selectMany(
            `SELECT ${COLUNAS} FROM sispag_favorecido_autorizado
              WHERE pes_cod = ANY($pesCods::text[]) AND estado = ANY($ativos::text[])`,
            { pesCods: [...new Set(pesCods)], ativos: [...AUTHORIZED_PAYEE_ACTIVE_STATES] },
        );
        return rows.map((r) => authorizedPayeeRowSchema.parse(r));
    };

    /** F1 — sempre PENDENTE. Corrida no índice de vigência → `AuthorizedPayeeActiveExistsError`. */
    public inserir = async (
        input: NovaAutorizacaoInput,
        tx?: TransactionClient,
    ): Promise<string> => {
        const id = randomUUID();
        try {
            await (tx ?? this.db).insert(
                `INSERT INTO sispag_favorecido_autorizado
                    (id, pes_cod, credor, modalidade, estado, origem_solicitacao, fil_cod_leitura,
                     solicitado_por, solicitado_em)
                 VALUES ($id, $pesCod, $credor, $modalidade, 'PENDENTE', $origem, $filCod,
                         $solicitadoPor, now())`,
                {
                    id,
                    pesCod: input.pesCod,
                    credor: input.credor ?? null,
                    modalidade: input.modalidade,
                    origem: input.origemSolicitacao,
                    filCod: input.filCodLeitura,
                    solicitadoPor: input.solicitadoPor,
                },
            );
        } catch (error) {
            if ((error as { code?: string } | undefined)?.code === UNIQUE_VIOLATION) {
                throw new AuthorizedPayeeActiveExistsError({
                    pesCod: input.pesCod,
                    modalidade: input.modalidade,
                });
            }
            throw error;
        }
        return id;
    };

    /**
     * Aplica o patch SÓ se a versão bate (lock otimista) e incrementa `versao`. Devolve as linhas
     * afetadas: 0 = alguém mudou antes (o serviço decide se é conflito ou estado inválido).
     */
    public atualizarComVersao = async (
        id: string,
        versaoEsperada: number,
        patch: AutorizacaoPatch,
        tx?: TransactionClient,
    ): Promise<number> => {
        const sets: string[] = [];
        const params: Record<string, unknown> = { id, versao: versaoEsperada };
        for (const [campo, coluna] of Object.entries(COLUNA_DO_PATCH) as Array<
            [keyof AutorizacaoPatch, string]
        >) {
            if (!(campo in patch)) continue;
            const valor = patch[campo];
            const nome = `p_${campo}`;
            if (campo === 'avisos') {
                sets.push(`${coluna} = $${nome}::jsonb`);
                params[nome] = JSON.stringify(valor ?? []);
            } else {
                sets.push(`${coluna} = $${nome}`);
                params[nome] = valor ?? null;
            }
        }
        sets.push('versao = versao + 1');
        try {
            return await (tx ?? this.db).update(
                `UPDATE sispag_favorecido_autorizado SET ${sets.join(', ')}
                  WHERE id = $id AND versao = $versao`,
                params,
            );
        } catch (error) {
            if ((error as { code?: string } | undefined)?.code === UNIQUE_VIOLATION) {
                throw new AuthorizedPayeeActiveExistsError({ pesCod: '?', modalidade: '?' });
            }
            throw error;
        }
    };

    /** Trilha só-inclusão (o trigger da 0080 recusa UPDATE/DELETE/TRUNCATE). */
    public registrarEvento = async (
        input: AutorizacaoEventoInput,
        tx?: TransactionClient,
    ): Promise<string> => {
        const id = randomUUID();
        await (tx ?? this.db).insert(
            `INSERT INTO sispag_favorecido_autorizado_evento (id, autorizacao_id, evento, ator, dados)
             VALUES ($id, $autorizacaoId, $evento, $ator, $dados::jsonb)`,
            {
                id,
                autorizacaoId: input.autorizacaoId,
                evento: input.evento,
                ator: input.ator,
                dados: input.dados ? JSON.stringify(input.dados) : null,
            },
        );
        return id;
    };

    public listarEventos = async (autorizacaoId: string): Promise<AuthorizedPayeeEventRecord[]> => {
        const rows = await this.db.selectMany(
            `SELECT id, autorizacao_id, evento, ator, ocorrido_em, dados
               FROM sispag_favorecido_autorizado_evento
              WHERE autorizacao_id = $autorizacaoId
              ORDER BY ocorrido_em, id`,
            { autorizacaoId },
        );
        return rows.map((r) => authorizedPayeeEventRowSchema.parse(r));
    };
}
