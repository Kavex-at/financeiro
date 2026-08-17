import { inject, injectable, singleton } from 'tsyringe';
import { z } from 'zod';
import ConexosError from '../errors/ConexosError.js';
import {
    COM194_TIPOS_ERRO,
    NDE_FISCAL_TIPO_NF_DEBITO_PAGAMENTO_ANTECIPADO,
    NDE_TPD_COD,
    PAINEL_NDE_ERP_MAX_PAGINAS,
    PAINEL_NDE_ERP_PAGE_SIZE,
} from '../interface/recebimentos/constants.js';
import type {
    DocFiscal,
    DocStatusFiscal,
    ItemNde,
    ItemNdeResumo,
    NdeErpListItem,
    ObservacoesFiscais,
    ValidacaoDocumento,
} from '../interface/recebimentos/NdeFiscal.js';
import ConexosBaseClient from './ConexosBaseClient.js';

/**
 * Colunas pedidas ao grid do com297. Todas confirmadas como projetáveis pelo probe de PRD
 * (`jobs/probe-com297-list.ts`, 2026-08-17) — o grid devolve o que se pede no `fieldList`.
 *
 * `vldAutorizado` é a razão de ser desta lista: é ele que substitui N `GET com297/{docCod}` por 1 POST.
 * Os campos de cliente/processo dão identidade às NDes emitidas fora da ferramenta, que não têm
 * `correlationId` nosso.
 */
const NDE_LIST_FIELDS = [
    'docCod',
    'docTip',
    'filCod',
    'docEspNumero',
    'vldAutorizado',
    'vldStatus',
    'docMnyValor',
    'docDtaEmissao',
    'priCod',
    'priEspRefcliente',
    'dpeNomPessoa',
    'pdcDocFederal',
] as const;

/**
 * Boundary Zod da linha do grid. Só os identificadores são exigidos — todo o resto é opcional porque
 * o ERP omite coluna vazia em vez de mandar `null`, e uma NDe recém-gerada legitimamente não tem
 * número nem autorização. `.passthrough()` preserva o resto para auditoria.
 */
const NDE_LIST_ROW_SCHEMA = z
    .object({
        filCod: z.coerce.number().int(),
        docTip: z.coerce.number().int(),
        docCod: z.coerce.number().int(),
        docEspNumero: z.union([z.string(), z.number()]).nullish(),
        vldAutorizado: z.coerce.number().int().nullish(),
        vldStatus: z.coerce.number().int().nullish(),
        docMnyValor: z.coerce.number().nullish(),
        docDtaEmissao: z.coerce.number().int().nullish(),
        priCod: z.coerce.number().int().nullish(),
        priEspRefcliente: z.union([z.string(), z.number()]).nullish(),
        dpeNomPessoa: z.string().nullish(),
        pdcDocFederal: z.union([z.string(), z.number()]).nullish(),
    })
    .passthrough();

/**
 * Boundary Zod do com300 (fiscal). `.passthrough()` preserva os ~73 campos p/ o read-modify-write —
 * só EXIGIMOS os identificadores + `fisVldTipoNfDebito` (o alvo/discriminador). `fisVldTipoNfCredito`
 * é preservado mas intocado.
 */
const DOC_FISCAL_SCHEMA = z
    .object({
        filCod: z.coerce.number().int(),
        docTip: z.coerce.number().int(),
        docCod: z.coerce.number().int(),
        fisCod: z.coerce.number().int(),
        fisVldTipoNfDebito: z.coerce.number().int(),
    })
    .passthrough();

/** Boundary do com131 — `fisEspObs` é o discriminador (preenchido ⟺ observação gerada). */
const OBSERVACOES_SCHEMA = z
    .object({
        fisEspObs: z.string().nullish(),
        docMemObs: z.string().nullish(),
        fisEspInfadfisco: z.string().nullish(),
    })
    .passthrough();

/** Boundary do poll com297 — todos opcionais/coeridos (só lemos status). */
const DOC_STATUS_SCHEMA = z
    .object({
        vldAutorizado: z.coerce.number().int().optional(),
        docVldNfehom: z.coerce.number().int().optional(),
        vldStatus: z.coerce.number().int().optional(),
        vldTpNf: z.union([z.string(), z.number()]).optional(),
        docVldConferencia: z.coerce.number().int().optional(),
        vldEnviarConferencia: z.coerce.number().int().optional(),
        docMnyValor: z.coerce.number().optional(),
        docEspNumero: z.union([z.string(), z.number()]).optional(),
    })
    .passthrough();

const VALIDACAO_ROW_SCHEMA = z
    .object({
        fdvCodSeq: z.coerce.number().int().optional(),
        fdvEspErr: z.string().nullish(),
        fdvEspObs: z.string().nullish(),
        fdvVldErr: z.coerce.number().int().optional(),
        fdvVldTperr: z.coerce.number().int().optional(),
    })
    .passthrough();

/**
 * Boundary do item do com297 (`comDocProdutos`). A chave é COMPOSTA (`docCod`+`fisCod`+`prdCod`+
 * `dprCodSeq`) — os quatro são exigidos; `dprLngDescrNf` (descrição de impressão) e `prdDesNome`
 * (descrição cadastrada do produto) são `nullish` porque o ERP devolve `null` nos dois. `.passthrough()`
 * preserva os ~105 campos para o read-modify-write.
 */
const ITEM_NDE_SCHEMA = z
    .object({
        docCod: z.coerce.number().int(),
        fisCod: z.coerce.number().int(),
        prdCod: z.coerce.number().int(),
        dprCodSeq: z.coerce.number().int(),
        prdDesNome: z.string().nullish(),
        dprLngDescrNf: z.string().nullish(),
    })
    .passthrough();

/**
 * Limite de `dprLngDescrNf` no tenant — truncamos ANTES de enviar, nunca depois. A unidade é **BYTE**,
 * não caractere: a coluna é `VARCHAR2(4000 BYTE)` no Oracle do ERP.
 */
export const DESCRICAO_IMPRESSAO_MAX_BYTES = 4000;

/**
 * Trunca por **bytes UTF-8**, não por code units UTF-16.
 *
 * `String.prototype.slice` conta code units; a coluna conta bytes. Em português cada acento custa 2
 * bytes, então uma string de 4000 caracteres acentuados vira ~8000 bytes e o ERP responde `ORA-12899`
 * — com a mensagem do banco, não da automação, o que manda o plantonista para o lugar errado. O vetor
 * concreto é a env `NDE_DESCRICAO_ITEM_FALLBACK`, que é texto livre fixado pelo fiscal.
 *
 * O corte é por **code point** (o iterador de string percorre code points, não code units), de modo a
 * nunca partir um surrogate pair ao meio — meio par produziria UTF-8 inválido, que é pior do que o
 * texto longo.
 */
const truncarPorBytesUtf8 = (texto: string, maxBytes: number): string => {
    if (Buffer.byteLength(texto, 'utf8') <= maxBytes) return texto;
    let bytes = 0;
    let recorte = '';
    for (const ponto of texto) {
        const custo = Buffer.byteLength(ponto, 'utf8');
        if (bytes + custo > maxBytes) break;
        bytes += custo;
        recorte += ponto;
    }
    return recorte;
};

/** Texto não-vazio (após trim) ou `undefined` — o teste que separa "tem descrição" de "não tem". */
const textoOuIndefinido = (valor: unknown): string | undefined => {
    if (typeof valor !== 'string') return undefined;
    const limpo = valor.trim();
    return limpo === '' ? undefined : limpo;
};

/**
 * ConexosNdeFiscalClient — a leg FISCAL da Nota de Débito Eletrônica, capturada por HAR real (doc
 * 18337). Fecha o GAP `nota-debito-fiscal` que o writer permutas deixava fail-closed. CINCO contratos
 * DISTINTOS, cada um com seu Zod e seu discriminador de sucesso — a spec proíbe reusar UM helper:
 *   (a) com300 — fiscal, read-modify-write: GET o objeto INTEIRO → seta `fisVldTipoNfDebito=6` → PUT
 *       o objeto inteiro. Sucesso ⟺ eco `fisVldTipoNfDebito === 6`. `putGenericOnce` (RMW não-retryable).
 *   (b) com131 — observações: `POST geraObs {docTip,docCod}`. Sucesso ⟺ `fisEspObs` preenchido.
 *   (c) com194 — validações (leitura): o que travou/avisou no documento, varrendo as duas classes de
 *       `fdvVldTperr`. É o corpo da mensagem quando a homologação não confirma.
 *   (d) com297 `comDocProdutos` — ITENS da nota: listar/ler/`preDescrProdutoNf` + o RMW que grava a
 *       `dprLngDescrNf` (o `xProd` da NF-e). Sucesso do PUT ⟺ eco com `dprLngDescrNf` NÃO-vazia.
 *   (poll) com297 — `GET com297/{docCod}` p/ pré-condição + `vldAutorizado` (SEFAZ é assíncrono).
 * A HOMOLOGAÇÃO em si vive no `ConexosNdeClient` (discriminador `docVldComvalidacoes`). `filCod` SEMPRE
 * no header (`Cnx-filCod`), nunca na URL. Ver `_inbox/recebimentos-numerario-real-fiscal-spec.md`.
 */
@singleton()
@injectable()
export default class ConexosNdeFiscalClient {
    public constructor(@inject(ConexosBaseClient) private readonly base: ConexosBaseClient) {}

    /** (a) leitura do RMW — devolve o `finDocFiscal` INTEIRO. `GET com300/{docTip}/{docCod}/{fisCod}`. */
    public lerDocFiscal = async (params: {
        filCod: number;
        docTip: number;
        docCod: number;
        fisCod: number;
    }): Promise<DocFiscal> => {
        const { filCod, docTip, docCod, fisCod } = params;
        const path = `com300/${docTip}/${docCod}/${fisCod}`;
        try {
            return await this.base.runWithRetry(async () => {
                await this.base.ensureSid();
                const raw = await this.base.getGeneric<unknown>(path, { filCod });
                return DOC_FISCAL_SCHEMA.parse(raw) as DocFiscal;
            });
        } catch (cause) {
            throw new ConexosError({ endpoint: path, cause });
        }
    };

    /**
     * (a) escrita do RMW — `PUT com300` com o objeto INTEIRO (`fisVldTipoNfDebito=6` já setado pelo
     * caller). Sem id na URL. Tentativa ÚNICA (`putGenericOnce`). **Sucesso ⟺ `fisVldTipoNfDebito===6`.**
     */
    public gravarDocFiscal = async (params: {
        filCod: number;
        finDocFiscal: DocFiscal;
    }): Promise<DocFiscal> => {
        const { filCod, finDocFiscal } = params;
        try {
            await this.base.ensureSid();
            const raw = await this.base.putGenericOnce<unknown>(
                'com300',
                finDocFiscal as Record<string, unknown>,
                { filCod },
            );
            const eco = DOC_FISCAL_SCHEMA.parse(raw) as DocFiscal;
            if (eco.fisVldTipoNfDebito !== NDE_FISCAL_TIPO_NF_DEBITO_PAGAMENTO_ANTECIPADO) {
                throw new ConexosError({
                    endpoint: 'com300',
                    cause: new Error(
                        `PUT com300 nao gravou fisVldTipoNfDebito=${NDE_FISCAL_TIPO_NF_DEBITO_PAGAMENTO_ANTECIPADO} (eco=${eco.fisVldTipoNfDebito})`,
                    ),
                });
            }
            return eco;
        } catch (cause) {
            if (cause instanceof ConexosError) throw cause;
            throw new ConexosError({ endpoint: 'com300', cause });
        }
    };

    /** (b) leitura das observações — guard de idempotência do `geraObs`. `GET com131/{docTip}/{docCod}`. */
    public lerObservacoes = async (params: {
        filCod: number;
        docTip: number;
        docCod: number;
    }): Promise<ObservacoesFiscais> => {
        const { filCod, docTip, docCod } = params;
        const path = `com131/${docTip}/${docCod}`;
        try {
            return await this.base.runWithRetry(async () => {
                await this.base.ensureSid();
                const raw = await this.base.getGeneric<unknown>(path, { filCod });
                const o = OBSERVACOES_SCHEMA.parse(raw);
                return {
                    ...(o.fisEspObs != null ? { fisEspObs: o.fisEspObs } : {}),
                    ...(o.docMemObs != null ? { docMemObs: o.docMemObs } : {}),
                    ...(o.fisEspInfadfisco != null ? { fisEspInfadfisco: o.fisEspInfadfisco } : {}),
                };
            });
        } catch (cause) {
            throw new ConexosError({ endpoint: path, cause });
        }
    };

    /**
     * (b) gera as observações SINIEF a partir do tipo de nota de débito. `POST com131/geraObs`
     * `{docTip,docCod}` (2 campos; `filCod` no header). **Sucesso ⟺ `fisEspObs` preenchido.**
     */
    public gerarObservacoes = async (params: {
        filCod: number;
        docTip: number;
        docCod: number;
    }): Promise<ObservacoesFiscais> => {
        const { filCod, docTip, docCod } = params;
        try {
            await this.base.ensureSid();
            const raw = await this.base.postGenericOnce<unknown>(
                'com131/geraObs',
                { docTip, docCod },
                { filCod },
            );
            const o = OBSERVACOES_SCHEMA.parse(raw);
            if (o.fisEspObs == null || o.fisEspObs.trim() === '') {
                throw new ConexosError({
                    endpoint: 'com131/geraObs',
                    cause: new Error('geraObs nao retornou fisEspObs'),
                });
            }
            return {
                fisEspObs: o.fisEspObs,
                ...(o.docMemObs != null ? { docMemObs: o.docMemObs } : {}),
                ...(o.fisEspInfadfisco != null ? { fisEspInfadfisco: o.fisEspInfadfisco } : {}),
            };
        } catch (cause) {
            if (cause instanceof ConexosError) throw cause;
            throw new ConexosError({ endpoint: 'com131/geraObs', cause });
        }
    };

    /**
     * (c) validações do com194 — o que o modal "VALIDAÇÃO - COM_194" mostra ao analista.
     *
     * `fdvVldTperr` é filtro OBRIGATÓRIO (sem ele: `Generic.REQUIRED_FILTER_ERROR`, HTTP 400) e não
     * aceita lista, então varremos as classes de `COM194_TIPOS_ERRO` e unimos. Consultar só a classe `1`
     * — o que fazíamos — escondia a `2`, onde o doc 18737 (autorizado) guarda a sua única validação.
     * Uma classe indisponível NÃO derruba a leitura inteira: a mensagem de falha da homologação vale
     * mais parcial do que ausente, e o analista tem 15 minutos de tolerância da NF-e para agir.
     */
    /**
     * GRID da família NDe de UMA filial — `POST com297/list`, paginado.
     *
     * ⚠️ **O sufixo `/list` é o que separa ler de escrever neste serviço.** `POST /com297` (sem
     * `/list`) é a rota de CRIAÇÃO de documento — ela responde `400 VALIDATION` a um corpo de grid,
     * mas é escrita. Por isso o path é literal aqui e NÃO passa pelo helper `listGenericPaginated`
     * (que monta `/{serviceName}`).
     *
     * Filtra por `tpdCod#EQ: NDE_TPD_COD` — o CÓDIGO do tipo de documento, nunca o nome. Ver o
     * racional medido em `constants.ts`: o filtro por `tpdDesNome#LIKE` sobre string acentuada
     * devolveria zero linhas sem erro se a normalização Unicode divergir, e nome de cadastro é
     * editável. A equivalência código ⟷ nome foi provada em PRD (mesmo `count`, nenhum outro tipo).
     *
     * NÃO filtra por `vldStatus`: a aba quer a família inteira, e o mapa de status do ERP ainda não
     * está confirmado (só `3` observado) — filtrar por um valor não entendido esconderia NDe real.
     *
     * Leitura idempotente → `runWithRetry` + `ensureSid`, igual aos métodos irmãos. Zod no boundary.
     */
    public listNdes = async (params: { filCod: number }): Promise<NdeErpListItem[]> => {
        const { filCod } = params;
        const path = 'com297/list';
        try {
            return await this.base.runWithRetry(async () => {
                await this.base.ensureSid();
                const acumulado: NdeErpListItem[] = [];
                for (let pagina = 1; pagina <= PAINEL_NDE_ERP_MAX_PAGINAS; pagina += 1) {
                    const raw = await this.base.postGeneric<{ count?: number; rows?: unknown[] }>(
                        path,
                        {
                            fieldList: [...NDE_LIST_FIELDS],
                            filterList: { 'tpdCod#EQ': NDE_TPD_COD },
                            pageNumber: pagina,
                            pageSize: PAINEL_NDE_ERP_PAGE_SIZE,
                            serviceName: 'com297',
                            orderList: {
                                orderList: [{ propertyName: 'docCod', order: 'desc' }],
                            },
                        },
                        { filCod },
                    );
                    const rows = raw?.rows ?? [];
                    acumulado.push(...rows.map((r) => this.mapNdeErpRow(r)));
                    // Página incompleta = última. `count` do ERP é o total do filtro, não da página.
                    if (rows.length < PAINEL_NDE_ERP_PAGE_SIZE) break;
                    if (acumulado.length >= (raw?.count ?? acumulado.length)) break;
                }
                return acumulado;
            });
        } catch (cause) {
            throw new ConexosError({ endpoint: path, cause });
        }
    };

    /** Projeta a linha do grid. Epoch ms → `Date`; `0`/vazio em número vira AUSENTE. */
    private mapNdeErpRow = (raw: unknown): NdeErpListItem => {
        const r = NDE_LIST_ROW_SCHEMA.parse(raw);
        const numero = r.docEspNumero != null ? String(r.docEspNumero).trim() : '';
        return {
            filCod: r.filCod,
            docTip: r.docTip,
            docCod: r.docCod,
            ...(numero !== '' && Number(numero) !== 0 ? { docEspNumero: numero } : {}),
            ...(r.vldAutorizado != null ? { vldAutorizado: r.vldAutorizado } : {}),
            ...(r.vldStatus != null ? { vldStatus: r.vldStatus } : {}),
            ...(r.docMnyValor != null ? { valor: r.docMnyValor } : {}),
            ...(r.docDtaEmissao != null ? { emitidaEm: new Date(r.docDtaEmissao) } : {}),
            ...(r.priCod != null ? { priCod: r.priCod } : {}),
            ...(r.priEspRefcliente != null ? { processoRef: String(r.priEspRefcliente) } : {}),
            ...(r.dpeNomPessoa != null ? { cliente: String(r.dpeNomPessoa) } : {}),
            ...(r.pdcDocFederal != null ? { clienteDoc: String(r.pdcDocFederal) } : {}),
        };
    };

    public listValidacoes = async (params: {
        filCod: number;
        docTip: number;
        docCod: number;
    }): Promise<ValidacaoDocumento[]> => {
        const { filCod, docTip, docCod } = params;
        const consultarClasse = async (fdvVldTperr: number): Promise<ValidacaoDocumento[]> =>
            this.base.runWithRetry(async () => {
                await this.base.ensureSid();
                const raw = await this.base.postGeneric<{ rows?: unknown[] } | unknown[]>(
                    'com194/documento/list',
                    {
                        fieldList: [],
                        filterList: { docTip, docCod, fdvVldTperr },
                        pageNumber: 1,
                        pageSize: 50,
                        orderList: { orderList: [{ propertyName: 'docCod', order: 'asc' }] },
                    },
                    { filCod },
                );
                const rows = Array.isArray(raw) ? raw : (raw?.rows ?? []);
                return rows.map((r) => VALIDACAO_ROW_SCHEMA.parse(r) as ValidacaoDocumento);
            });

        const porClasse = await Promise.allSettled(COM194_TIPOS_ERRO.map(consultarClasse));
        if (porClasse.every((r) => r.status === 'rejected')) {
            throw new ConexosError({
                endpoint: 'com194/documento/list',
                cause: porClasse[0]?.status === 'rejected' ? porClasse[0].reason : undefined,
            });
        }
        return porClasse.flatMap((r) => (r.status === 'fulfilled' ? r.value : []));
    };

    /**
     * (d) ITENS da nota — `POST com297/comDocProdutos/list/{docCod}/{fisCod}`. A linha da NDe não é criada
     * pela automação: o ERP a materializa a partir do `prdCod` do HEADER do `gerDocProcesso`. Esta leitura
     * é como descobrimos a chave composta do item e se a `dprLngDescrNf` saiu preenchida. Idempotente →
     * `runWithRetry`.
     */
    public listItensNde = async (params: {
        filCod: number;
        docCod: number;
        fisCod: number;
    }): Promise<ItemNdeResumo[]> => {
        const { filCod, docCod, fisCod } = params;
        const path = `com297/comDocProdutos/list/${docCod}/${fisCod}`;
        try {
            return await this.base.runWithRetry(async () => {
                await this.base.ensureSid();
                const raw = await this.base.postGeneric<{ rows?: unknown[] } | unknown[]>(
                    path,
                    {
                        fieldList: [],
                        filterList: {},
                        pageNumber: 1,
                        pageSize: 200,
                        orderList: { orderList: [{ propertyName: 'dprCodSeq', order: 'asc' }] },
                    },
                    { filCod },
                );
                const rows = Array.isArray(raw) ? raw : (raw?.rows ?? []);
                return rows.map((r) => {
                    const item = ITEM_NDE_SCHEMA.parse(r);
                    const prdDesNome = textoOuIndefinido(item.prdDesNome);
                    const dprLngDescrNf = textoOuIndefinido(item.dprLngDescrNf);
                    return {
                        docCod: item.docCod,
                        fisCod: item.fisCod,
                        prdCod: item.prdCod,
                        dprCodSeq: item.dprCodSeq,
                        ...(prdDesNome !== undefined ? { prdDesNome } : {}),
                        ...(dprLngDescrNf !== undefined ? { dprLngDescrNf } : {}),
                    };
                });
            });
        } catch (cause) {
            throw new ConexosError({ endpoint: path, cause });
        }
    };

    /**
     * (d) leitura do RMW do item — `GET com297/comDocProdutos/{docCod}/{fisCod}/{prdCod}/{dprCodSeq}`
     * devolve a linha INTEIRA (~105 campos), que é o que o PUT precisa reenviar. Idempotente.
     */
    public lerItemNde = async (params: {
        filCod: number;
        docCod: number;
        fisCod: number;
        prdCod: number;
        dprCodSeq: number;
    }): Promise<ItemNde> => {
        const { filCod, docCod, fisCod, prdCod, dprCodSeq } = params;
        const path = `com297/comDocProdutos/${docCod}/${fisCod}/${prdCod}/${dprCodSeq}`;
        try {
            return await this.base.runWithRetry(async () => {
                await this.base.ensureSid();
                const raw = await this.base.getGeneric<unknown>(path, { filCod });
                return ITEM_NDE_SCHEMA.parse(raw) as ItemNde;
            });
        } catch (cause) {
            throw new ConexosError({ endpoint: path, cause });
        }
    };

    /**
     * (d) o que o ERP CALCULARIA para a descrição deste item — `GET com297/comDocProdutos/
     * preDescrProdutoNf/{docCod}/{fisCod}/{prdCod}/{dprCodSeq}`. É a rota que o UI usa para PRÉ-PREENCHER
     * o campo quando o analista edita o item, ou seja: ela aplica a regra do cadastro do cliente
     * (`dpeVld1DescrNfe`) e o valor GRAVADO é que vale.
     *
     * **Best-effort de propósito — NUNCA lança.** É uma sugestão: se o ERP recusar a rota, devolver um
     * shape inesperado ou (o caso que nos trouxe aqui) uma string vazia, o caller cai no próximo
     * fallback. Falhar aqui derrubaria uma emissão por causa de um enfeite.
     */
    public preDescricaoProdutoNf = async (params: {
        filCod: number;
        docCod: number;
        fisCod: number;
        prdCod: number;
        dprCodSeq: number;
    }): Promise<string | undefined> => {
        const { filCod, docCod, fisCod, prdCod, dprCodSeq } = params;
        const path = `com297/comDocProdutos/preDescrProdutoNf/${docCod}/${fisCod}/${prdCod}/${dprCodSeq}`;
        try {
            await this.base.ensureSid();
            const raw = await this.base.getGeneric<unknown>(path, { filCod });
            return this.extrairDescricaoSugerida(raw);
        } catch {
            return undefined;
        }
    };

    /**
     * O swagger do tenant não declara o corpo do `preDescrProdutoNf` (`content: {}`), então aceitamos as
     * três formas plausíveis — string crua, `{responseData: …}` ou um objeto com a descrição em
     * `dprLngDescrNf`/`descricao`/`descr` — e desistimos em qualquer outra. Nunca lança.
     */
    private extrairDescricaoSugerida = (raw: unknown): string | undefined => {
        const direto = textoOuIndefinido(raw);
        if (direto !== undefined) return direto;
        if (typeof raw !== 'object' || raw === null) return undefined;
        const o = raw as Record<string, unknown>;
        const interno = textoOuIndefinido(o.responseData);
        if (interno !== undefined) return interno;
        const alvo =
            o.responseData !== null && typeof o.responseData === 'object'
                ? (o.responseData as Record<string, unknown>)
                : o;
        return (
            textoOuIndefinido(alvo.dprLngDescrNf) ??
            textoOuIndefinido(alvo.descricao) ??
            textoOuIndefinido(alvo.descr)
        );
    };

    /**
     * (d) escrita do RMW do item — `PUT com297/comDocProdutos` com a linha INTEIRA e a `dprLngDescrNf`
     * já substituída. Sem id na URL, igual ao com300; campo omitido vira `null`, então NUNCA montar
     * parcial (o caller passa o objeto vindo do `lerItemNde`). Tentativa ÚNICA (`putGenericOnce`).
     *
     * **Sucesso ⟺ o eco traz `dprLngDescrNf` NÃO-vazia.** Não exigimos igualdade exata com o que
     * mandamos: o ERP pode normalizar/truncar o texto, e o invariante que estamos protegendo é "a NF-e
     * tem descrição de produto", não "a NF-e tem exatamente esta string". Divergência é problema do
     * caller (que loga); vazio é falha desta etapa.
     */
    public gravarDescricaoItemNde = async (params: {
        filCod: number;
        item: ItemNde;
        descricao: string;
    }): Promise<ItemNde> => {
        const { filCod, item } = params;
        const descricao = truncarPorBytesUtf8(
            params.descricao.trim(),
            DESCRICAO_IMPRESSAO_MAX_BYTES,
        ).trimEnd();
        if (descricao === '') {
            // Enviar vazio seria gravar o próprio bug — recusa antes de sair da máquina.
            throw new ConexosError({
                endpoint: 'com297/comDocProdutos',
                cause: new Error('descricao vazia — recusando gravar dprLngDescrNf em branco'),
            });
        }
        try {
            await this.base.ensureSid();
            const raw = await this.base.putGenericOnce<unknown>(
                'com297/comDocProdutos',
                { ...item, dprLngDescrNf: descricao },
                { filCod },
            );
            const eco = ITEM_NDE_SCHEMA.parse(raw) as ItemNde;
            if (textoOuIndefinido(eco.dprLngDescrNf) === undefined) {
                throw new ConexosError({
                    endpoint: 'com297/comDocProdutos',
                    cause: new Error(
                        `PUT com297/comDocProdutos nao gravou dprLngDescrNf (eco vazio) no item ` +
                            `${item.docCod}/${item.fisCod}/${item.prdCod}/${item.dprCodSeq}`,
                    ),
                });
            }
            return eco;
        } catch (cause) {
            if (cause instanceof ConexosError) throw cause;
            throw new ConexosError({ endpoint: 'com297/comDocProdutos', cause });
        }
    };

    /**
     * (poll) status do documento com297 — pré-condição de homologação (`docVldConferencia`/
     * `vldEnviarConferencia`), roteamento (`vldTpNf`) e poll de autorização SEFAZ (`vldAutorizado`).
     * `GET com297/{docCod}`. Leitura; `runWithRetry` re-`ensureSid` a cada tentativa (cookie expira).
     */
    public lerDocParaPolling = async (params: {
        filCod: number;
        docCod: number;
    }): Promise<DocStatusFiscal> => {
        const { filCod, docCod } = params;
        const path = `com297/${docCod}`;
        try {
            return await this.base.runWithRetry(async () => {
                await this.base.ensureSid();
                const raw = await this.base.getGeneric<unknown>(path, { filCod });
                const o = DOC_STATUS_SCHEMA.parse(raw);
                return {
                    ...(o.vldAutorizado != null ? { vldAutorizado: o.vldAutorizado } : {}),
                    ...(o.docVldNfehom != null ? { docVldNfehom: o.docVldNfehom } : {}),
                    ...(o.vldStatus != null ? { vldStatus: o.vldStatus } : {}),
                    ...(o.vldTpNf != null ? { vldTpNf: String(o.vldTpNf) } : {}),
                    ...(o.docVldConferencia != null
                        ? { docVldConferencia: o.docVldConferencia }
                        : {}),
                    ...(o.vldEnviarConferencia != null
                        ? { vldEnviarConferencia: o.vldEnviarConferencia }
                        : {}),
                    ...(o.docMnyValor != null ? { docMnyValor: o.docMnyValor } : {}),
                    ...(o.docEspNumero != null ? { docEspNumero: String(o.docEspNumero) } : {}),
                };
            });
        } catch (cause) {
            throw new ConexosError({ endpoint: path, cause });
        }
    };
}
