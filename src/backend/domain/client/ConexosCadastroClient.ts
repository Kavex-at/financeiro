import { inject, injectable, singleton } from 'tsyringe';
import ConexosError from '../errors/ConexosError.js';
import type { VarianteDeclaracao } from '../interface/permutas/DeclaracaoImportacao.js';
import ConexosBaseClient, { type Filial, chunked } from './ConexosBaseClient.js';
import { ENDPOINT_DI_LIST, ENDPOINT_DUIMP_LIST } from './permutas/conexosPermutasConstants.js';
import { declaracaoRowSchema } from './permutas/conexosPermutasSchemas.js';

/**
 * Existência de declaração aduaneira por processo (`imp019`/`imp223`),
 * escopo restrito ao Gate 4 (XOR) + data-base. `dataBase` é ⏸ GATED-P0-4 —
 * só popula quando o probe capturar o campo wire (não chutar).
 */
export interface DeclaracaoEntry {
    variante: VarianteDeclaracao;
    priCod: string;
    dataBase?: Date;
}

export interface ProcessoListItem {
    priCod: string;
    /**
     * Conexos `pesCod` — internal identifier of the importador (cliente).
     * Mapped explicitly in the imp021 fieldList for v0.5; canonical key used by
     * `nf-saida-mesmo-pescod-do-processo` to validate that any NF Saída
     * issued by the process belongs to the same cliente.
     */
    pesCod: string;
    /**
     * Conexos `priEspRefcliente` — external "Ref. Externa" of the process
     * (per-importador human reference). Optional defensively because legacy
     * processes may have no value. Surfaces in the canonical 8-column
     * Fechamento Mensal table as the "Ref. Externa" column. No alias —
     * keep the wire field name across the stack (ADR-0011).
     */
    priEspRefcliente?: string;
    importador?: string;
    exportador?: string;
    /**
     * Conexos `imp021.priVldTipo` — código da Unidade de Negócio do processo.
     * Mapeado para o rótulo da coluna "Und. Negócio" do relatório de Variação
     * Cambial (`1 → PRÓPRIA`, `2 → CONTA E ORDEM`, `3 → POR ENCOMENDA`;
     * Addendum 2026-06-08 #2 do ADR-0021). Adicionado explicitamente ao
     * fieldList do imp021. Optional defensivamente (processos legados podem
     * omitir); coerção `Number(...)` no mapper.
     */
    priVldTipo?: number;
}

/**
 * Conexos ERP cadastro/processo family (`imp*`): filiais, default filCod,
 * process listing (`imp021`) and customs-declaration existence
 * (`imp019`/`imp223`). Shares auth + pagination via `ConexosBaseClient`.
 *
 * Behaviour is IDENTICAL to the former `ConexosClient` methods of the same
 * name — only the owning class changed (CC-2 split by endpoint family).
 */
@singleton()
@injectable()
export default class ConexosCadastroClient {
    private base: ConexosBaseClient;

    constructor(@inject(ConexosBaseClient) base: ConexosBaseClient) {
        this.base = base;
    }

    /**
     * Returns the filiais captured from the last successful Conexos login.
     * Used by the multi-filial toggle in the report modal — when the user
     * checks "Todas filiais", the frontend asks for this list and the
     * report aggregates across every entry returned here.
     */
    public listFiliais = async (): Promise<Filial[]> => {
        try {
            return await this.base.runWithRetry(async () => {
                await this.base.ensureSid();
                return this.base.getFiliais();
            });
        } catch (cause) {
            throw new ConexosError({ endpoint: 'getFiliais', cause });
        }
    };

    /** Default filCod captured from the Conexos `/login` response. */
    public getFilCodDefault = async (): Promise<number | null> => {
        try {
            return await this.base.runWithRetry(async () => {
                await this.base.ensureSid();
                return this.base.getFilCodDefault();
            });
        } catch (cause) {
            throw new ConexosError({ endpoint: 'getFilCodDefault', cause });
        }
    };

    public listProcessos = async (params: {
        filCod: number;
        priCods?: string[];
        /**
         * Filtra pelos processos de um ou mais CLIENTES (`pesCod`). É como a
         * Frente IV lista "os processos atrelados a este crédito" depois que o
         * analista escolhe o cliente. Confirmado em produção: `pesCod#IN`
         * funciona (filial 1 tem 237 processos abertos; `pesCod=696` tem 66).
         */
        pesCods?: string[];
    }): Promise<ProcessoListItem[]> => {
        const { filCod, priCods, pesCods } = params;

        // Conexos returns `priCod` as a number; downstream methods (and the
        // financial-doc list endpoints) treat it as string. We normalise here
        // so equality comparisons against `i.priCod === proc.priCod` work
        // across the pipeline (without this, every linha gets filtered out
        // because "1153" !== 1153).
        // imp021 rows: the cliente importador name lives under the canonical
        // Conexos `dpeNomPessoa` column (same convention used by com298 and
        // com299). A literal `importador` field does not exist in the
        // imp021 response shape, so the previous mapping resolved to
        // undefined for every row. Fallback to dpeNomPessoa keeps the
        // explicit-importador path for any future fielded variant.
        const normalise = (rows: Array<Record<string, unknown>>): ProcessoListItem[] =>
            rows.map((row) => ({
                ...row,
                priCod: String(row.priCod ?? ''),
                pesCod: String(row.pesCod ?? ''),
                priEspRefcliente:
                    row.priEspRefcliente !== undefined && row.priEspRefcliente !== null
                        ? String(row.priEspRefcliente)
                        : undefined,
                importador: row.importador
                    ? String(row.importador)
                    : row.dpeNomPessoa
                      ? String(row.dpeNomPessoa)
                      : undefined,
                exportador: row.exportador ? String(row.exportador) : undefined,
                priVldTipo:
                    row.priVldTipo !== undefined && row.priVldTipo !== null
                        ? Number(row.priVldTipo)
                        : undefined,
            })) as ProcessoListItem[];

        // v0.5: explicit fieldList ensures `pesCod` and `priEspRefcliente`
        // come back from imp021 (default `[]` returns a Conexos-defined set
        // that may omit `priEspRefcliente`). Canonical fields:
        //   - priCod, pesCod (FK to importador/cliente),
        //   - priEspRefcliente (external client reference),
        //   - dpeNomPessoa (cliente name fallback),
        //   - priDtaAbertura (process opening date),
        //   - filCod (branch).
        const FIELD_LIST = [
            'priCod',
            'pesCod',
            'priEspRefcliente',
            'priVldTipo',
            'dpeNomPessoa',
            'priDtaAbertura',
            'filCod',
        ];

        // Filtro por CLIENTE: caminho da Frente IV (processos de um cliente
        // escolhido pelo analista). Mesmo chunking do caminho por `priCods`.
        if (pesCods && pesCods.length > 0) {
            const chunksPes = chunked(pesCods);
            const resultsPes = await Promise.all(
                chunksPes.map((batch) =>
                    this.base.paginate<Record<string, unknown>>({
                        endpoint: 'imp021/list',
                        bodyBase: {
                            fieldList: FIELD_LIST,
                            filterList: { 'pesCod#IN': batch, 'priVldStatus#IN': ['1'] },
                            serviceName: 'imp021',
                            orderList: {
                                orderList: [{ propertyName: 'priCod', order: 'asc' }],
                            },
                        },
                        opts: { filCod },
                    }),
                ),
            );
            return normalise(resultsPes.flat());
        }

        if (!priCods || priCods.length === 0) {
            const rows = await this.base.paginate<Record<string, unknown>>({
                endpoint: 'imp021/list',
                bodyBase: {
                    fieldList: FIELD_LIST,
                    filterList: { 'priVldStatus#IN': ['1'] },
                    serviceName: 'imp021',
                    orderList: {
                        orderList: [{ propertyName: 'priCod', order: 'asc' }],
                    },
                },
                opts: { filCod },
            });
            return normalise(rows);
        }

        const chunks = chunked(priCods);
        const results = await Promise.all(
            chunks.map((batch) =>
                this.base.paginate<Record<string, unknown>>({
                    endpoint: 'imp021/list',
                    bodyBase: {
                        fieldList: FIELD_LIST,
                        filterList: { 'priCod#IN': batch },
                        serviceName: 'imp021',
                    },
                    priCodsBatch: batch,
                    opts: { filCod },
                }),
            ),
        );
        return normalise(results.flat());
    };

    /**
     * Re-introduz o lado-leitura de declaração aduaneira podado no ADR-0003
     * (migration-debt O3), escopo restrito a EXISTÊNCIA (XOR) + data-base
     * (Gate 4 + aging). Lê `imp019/list` (D.I) e `imp223/list` (DUIMP) por
     * `priCod`, retornando uma entrada por declaração encontrada (o XOR é
     * decidido no service `ElegibilidadeService`).
     *
     * ⏸ GATED-P0-4: `dataBase` é extraída pelo mapper plugável
     * `mapDeclaracaoDataBase`. Enquanto o probe não capturar o NOME do campo
     * wire (`imp019`/`imp223`), o mapper devolve `undefined` — a existência/XOR
     * funciona hoje sem o probe.
     */
    public listDeclaracaoByProcesso = async (params: {
        priCods: string[];
        filCod: number;
    }): Promise<DeclaracaoEntry[]> => {
        const { priCods, filCod } = params;
        if (priCods.length === 0) return [];
        const chunks = chunked(priCods);

        const readVariante = async (
            endpoint: string,
            variante: VarianteDeclaracao,
        ): Promise<DeclaracaoEntry[]> => {
            const rows = (
                await Promise.all(
                    chunks.map((batch) =>
                        this.base.paginate<Record<string, unknown>>({
                            endpoint,
                            bodyBase: {
                                fieldList: [],
                                filterList: { 'priCod#IN': batch },
                                serviceName: endpoint.split('/')[0],
                            },
                            priCodsBatch: batch,
                            opts: { filCod },
                        }),
                    ),
                )
            ).flat();

            return rows.map<DeclaracaoEntry>((row) => {
                const validated = declaracaoRowSchema.parse(row);
                const dataBase = this.mapDeclaracaoDataBase(row, variante);
                return {
                    variante,
                    priCod: validated.priCod,
                    ...(dataBase !== undefined ? { dataBase } : {}),
                };
            });
        };

        const [di, duimp] = await Promise.all([
            readVariante(ENDPOINT_DI_LIST, 'DI'),
            readVariante(ENDPOINT_DUIMP_LIST, 'DUIMP'),
        ]);
        return [...di, ...duimp];
    };

    /**
     * Mapper ISOLADO da extração da data-base wire (P0-4 RESOLVIDO).
     *
     * Campos confirmados empiricamente no dev tenant Columbia (probe 2026-06-18):
     *   - D.I (`imp019`)   → `cdiDtaCi` (data "CI"; cf. PDF "DI = CI"). Acompanha
     *     `cdiEspNumci` (nº da CI). Sample: `1768521600000`.
     *   - DUIMP (`imp223`) → `dioDtaDesembaraco` (data de desembaraço).
     *     Sample: `1769040000000`.
     * Ambos epoch-ms; `parseDate` aplica o shift BR-noon. Ausência → `undefined`
     * (a coluna aging fica nula para aquela declaração, sem quebrar a cadeia).
     */
    private mapDeclaracaoDataBase = (
        row: Record<string, unknown>,
        variante: VarianteDeclaracao,
    ): Date | undefined => {
        const raw = variante === 'DI' ? row.cdiDtaCi : row.dioDtaDesembaraco;
        const ms = this.base.parseOptionalNumber(raw);
        return ms !== undefined ? this.base.parseDate(ms) : undefined;
    };
}
