import { inject, injectable, singleton } from 'tsyringe';
import ConexosError from '../errors/ConexosError.js';
import type {
    ArquivoRetorno,
    ArquivoRetornoDetalhe,
    ArquivoRetornoErro,
    CarregarRetornoParams,
    RetornoConfig,
} from '../interface/sispag/Fin052Retorno.js';
import ConexosBaseClient from './ConexosBaseClient.js';

const PAGE_SIZE = 200;

/**
 * ConexosSispagRetornoClient — perna de RETORNO do SISPAG (`fin052`, "Retorno de
 * Bancos Pagfor"). Ferramentas de integração com a tela: LEITURA (grid de arquivos
 * de retorno, detalhe com a ponte `bxaCodSeq`→fin010, erros de parse, configs de
 * layout `ger015`) + `carregar` (upload do `.RET`, multipart).
 *
 * Espelha a doutrina do `ConexosSispagWriteClient`/`ConexosBaixaClient`:
 *   - leituras via `runWithRetry` (paridade de retry);
 *   - `carregar` é escrita NÃO-idempotente → `postMultipartOnce` (tentativa única,
 *     sem 401-retry cego — re-upload criaria arquivo de retorno duplicado);
 *   - toda falha vira `ConexosError` com a validação do ERP no `message`.
 *
 * ⚠️ FERRAMENTA, não fluxo. `processar`/`liberar` (bodies não documentados no
 * OpenAPI) ficam para depois do HAR + `.RET` de exemplo (analista). O gating de
 * produção, idempotência e a baixa em si são do serviço de orquestração futuro.
 * READ-only em produção hoje (I1): só o harness HML guardado exercita o `carregar`.
 */
@singleton()
@injectable()
export default class ConexosSispagRetornoClient {
    public constructor(@inject(ConexosBaseClient) private readonly base: ConexosBaseClient) {}

    /** Body de query padrão do Conexos (`/list`). serviceName confirmado = 'fin052'/'ger015'. */
    private listBody = (
        serviceName: string,
        filterList: Record<string, unknown> = {},
        pageSize = PAGE_SIZE,
    ): Record<string, unknown> => ({
        fieldList: [],
        filterList,
        serviceName,
        pageNumber: 1,
        pageSize,
    });

    /**
     * Extrai a validação do corpo de erro do Conexos (VALIDATION_LIST → messages[].vars.msg;
     * VALIDATION → item/constraint). Igual ao `ConexosSispagWriteClient` (duplicado por ora).
     */
    private describeConexosValidation = (cause: unknown): string | undefined => {
        const data = (cause as { response?: { data?: unknown } })?.response?.data;
        if (!data || typeof data !== 'object') return undefined;
        const body = data as {
            messages?: Array<{ vars?: { msg?: string }; message?: string }>;
            itemMessages?: Array<{ item?: string; messages?: Array<{ constraint?: string }> }>;
        };
        if (Array.isArray(body.messages) && body.messages.length > 0) {
            const msgs = body.messages
                .map((m) => m.vars?.msg ?? m.message)
                .filter((s): s is string => typeof s === 'string' && s.length > 0);
            if (msgs.length > 0) return msgs.join(' · ');
        }
        if (Array.isArray(body.itemMessages) && body.itemMessages.length > 0) {
            const fields = body.itemMessages
                .map((im) => {
                    const constraint = im.messages?.[0]?.constraint;
                    return im.item
                        ? `${im.item}${constraint ? ` (${constraint})` : ''}`
                        : undefined;
                })
                .filter((s): s is string => typeof s === 'string');
            if (fields.length > 0) return `Campos inválidos: ${fields.join(', ')}`;
        }
        return undefined;
    };

    private toConexosError = (endpoint: string, cause: unknown): ConexosError =>
        new ConexosError({ endpoint, cause, message: this.describeConexosValidation(cause) });

    /**
     * Ferramenta 1 (leitura) — grid de arquivos de retorno (`arquivosRetorno/list`),
     * o mesmo da tela. Filtros opcionais por banco / config / status.
     */
    public listArquivosRetorno = async (params: {
        filCod: number;
        /** OBRIGATÓRIOS — o ERP recusa `arquivosRetorno/list` sem `bncCod` E `gtbCodSeq`
         * (400 "O filtro 'X' é requerido"), confirmado ao vivo em HML 2026-07-11. Os
         * pares válidos `(bncCod, gtbCodSeq)` vêm do `listConfigsRetorno` (ger015). */
        bncCod: number;
        gtbCodSeq: number;
        status?: number;
        pageSize?: number;
    }): Promise<ArquivoRetorno[]> => {
        const { filCod, bncCod, gtbCodSeq, status, pageSize } = params;
        const filterList: Record<string, unknown> = {
            'bncCod#EQ': bncCod,
            'gtbCodSeq#EQ': gtbCodSeq,
        };
        if (status !== undefined) filterList['garVldStatus#EQ'] = status;
        try {
            const page = await this.base.runWithRetry(() =>
                this.base.listGenericPaginated<Record<string, unknown>>(
                    'fin052/arquivosRetorno/list',
                    this.listBody('fin052', filterList, pageSize),
                    { filCod },
                ),
            );
            return (page.rows ?? [])
                .map((r) => this.mapArquivo(r))
                .filter((a) => Number.isFinite(a.garCodSeq));
        } catch (cause) {
            throw this.toConexosError('fin052/arquivosRetorno/list', cause);
        }
    };

    /** Mapeia uma linha de `GerArquivosRetorno` para `ArquivoRetorno`. */
    private mapArquivo = (r: Record<string, unknown>): ArquivoRetorno => ({
        filCod: Number(r.filCod),
        bncCod: Number(r.bncCod),
        gtbCodSeq: Number(r.gtbCodSeq),
        garCodSeq: Number(r.garCodSeq),
        arquivo: r.garEspArquivo != null ? String(r.garEspArquivo) : undefined,
        status: r.garVldStatus != null ? Number(r.garVldStatus) : undefined,
        statusProcessamento: r.garVldProcStatus != null ? Number(r.garVldProcStatus) : undefined,
        configNome: r.gtbDesNome != null ? String(r.gtbDesNome) : undefined,
        banco: r.bncDesNome != null ? String(r.bncDesNome) : undefined,
        erros: r.erro != null ? Number(r.erro) : undefined,
        titulosRejeitados: r.titulosRejeitados != null ? Number(r.titulosRejeitados) : undefined,
        cadastradoEm: r.garTimCadastro != null ? Number(r.garTimCadastro) : undefined,
        processadoEm: r.garTimProc != null ? Number(r.garTimProc) : undefined,
    });

    /**
     * Ferramenta 2 (leitura) — DETALHE do retorno (`arquivosRetornoDetalhe/list`).
     * É a ponte com o fin010: cada linha traz `bxaCodSeq`+`borCod`+`titCod`/`docCod`.
     */
    /**
     * PROCESSA um arquivo de retorno já carregado (`PUT arquivosRetorno/processar`). O ERP
     * parseia o `.RET`, vincula os códigos de retorno aos itens do lote e GRAVA AS BAIXAS no
     * fin010 — é a escrita mais consequente de toda a perna de retorno.
     *
     * Body descoberto ao vivo (ausente do OpenAPI): `{ items: [ chave + tipo ] }`. A chave
     * fora de `items[]` devolve `SELECTION_ERROR / NENHUM_REGISTRO_SELECIONADO`.
     *
     * `tipo` é o bind `:TIPO` do PL/SQL de parse: `1` dispara as atualizações no item, no
     * vínculo de retorno e na confirmação de envio do lote.
     *
     * NÃO é idempotente do ponto de vista de negócio (reprocessar gera novas baixas), mas o
     * ERP se defende: a transação é ATÔMICA — provado em HML, uma falha na etapa do borderô
     * não deixou nada gravado. Ainda assim: `postGenericOnce`, tentativa única.
     */
    public processarArquivoRetorno = async (params: {
        filCod: number;
        bncCod: number;
        gtbCodSeq: number;
        garCodSeq: number;
        tipo?: number;
    }): Promise<void> => {
        const { filCod, bncCod, gtbCodSeq, garCodSeq, tipo = 1 } = params;
        const path = 'fin052/arquivosRetorno/processar';
        try {
            await this.base.ensureSid();
            await this.base.putGenericOnce<unknown>(
                path,
                { items: [{ filCod, bncCod, gtbCodSeq, garCodSeq, tipo }] },
                { filCod },
            );
        } catch (cause) {
            throw this.toConexosError(path, cause);
        }
    };

    /**
     * Eventos bancários configurados de um banco (`fin050/list`, tabela `FIN_BANCOS_ERROS`).
     * Cada código de ocorrência que aparece no `.RET` precisa existir aqui, senão o ERP recusa
     * o arquivo inteiro. `fbeVldTpret`: 1 = pagamento efetuado · 2 = rejeição.
     *
     * Serve a dois propósitos: saber quais códigos consultar no detalhe (que exige o código
     * EXATO como filtro) e classificar pago × rejeitado na conciliação.
     */
    public listEventosBancarios = async (params: {
        filCod: number;
        bncCod: number;
    }): Promise<Array<{ cod: string; descricao?: string; tipo: number; tipoRetorno?: number }>> => {
        const { filCod, bncCod } = params;
        const path = 'fin050/list';
        try {
            const page = await this.base.runWithRetry(() =>
                this.base.listGenericPaginated<Record<string, unknown>>(
                    path,
                    this.listBody('fin050', { 'bncCod#EQ': bncCod }, 300),
                    { filCod },
                ),
            );
            return (page.rows ?? [])
                .filter((r) => r.fbeEspCod != null)
                .map((r) => ({
                    cod: String(r.fbeEspCod),
                    ...(r.fbeEspDescricao != null ? { descricao: String(r.fbeEspDescricao) } : {}),
                    tipo: Number(r.fbeVldTipo ?? 2),
                    ...(r.fbeVldTpret != null ? { tipoRetorno: Number(r.fbeVldTpret) } : {}),
                }));
        } catch (cause) {
            throw this.toConexosError(path, cause);
        }
    };

    /**
     * Detalhe do retorno — a linha que amarra TUDO: `flpCod` + `itsCodSeq` (o item do lote),
     * `borCod` + `bxaCodSeq` (a baixa no fin010), `gerNum` (a conta financeira) e o evento
     * bancário. É a única fonte dessa rastreabilidade: o ERP não a expõe em mais lugar nenhum.
     *
     * ⚠️ O ERP exige `fbeEspCod` como filtro, com o código EXATO — `#IN`, `#LIKE` e afins são
     * recusados. Por isso a conciliação consulta código a código. E arquivo apenas CARREGADO
     * (`garVldProcStatus=1`) não tem linha de detalhe: só depois de processado (`=2`).
     */
    public listDetalhe = async (params: {
        filCod: number;
        bncCod: number;
        gtbCodSeq: number;
        garCodSeq: number;
        /** Código do evento bancário. Obrigatório: sem ele o ERP devolve REQUIRED_FILTER_ERROR. */
        eventoCod: string;
        eventoTipo?: number;
        pageSize?: number;
    }): Promise<ArquivoRetornoDetalhe[]> => {
        const { filCod, bncCod, gtbCodSeq, garCodSeq, eventoCod, eventoTipo, pageSize } = params;
        const filterList = {
            'bncCod#EQ': bncCod,
            'gtbCodSeq#EQ': gtbCodSeq,
            'garCodSeq#EQ': garCodSeq,
            'fbeEspCod#EQ': eventoCod,
            'fbeVldTipo#EQ': eventoTipo ?? 2,
        };
        const path = 'fin052/arquivosRetornoDetalhe/list';
        try {
            const page = await this.base.runWithRetry(() =>
                this.base.listGenericPaginated<Record<string, unknown>>(
                    path,
                    this.listBody('fin052', filterList, pageSize),
                    { filCod },
                ),
            );
            return (page.rows ?? []).map((r) => ({
                filCod: Number(r.filCod ?? filCod),
                bncCod: Number(r.bncCod ?? bncCod),
                gtbCodSeq: Number(r.gtbCodSeq ?? gtbCodSeq),
                garCodSeq: Number(r.garCodSeq ?? garCodSeq),
                ardCodSeq: r.ardCodSeq != null ? Number(r.ardCodSeq) : undefined,
                flpCod: r.flpCod != null ? Number(r.flpCod) : undefined,
                itsCodSeq: r.itsCodSeq != null ? Number(r.itsCodSeq) : undefined,
                eventoCod: r.fbeEspCod != null ? String(r.fbeEspCod) : undefined,
                eventoDescricao: r.fbeEspDescricao != null ? String(r.fbeEspDescricao) : undefined,
                docTip: r.docTip != null ? Number(r.docTip) : undefined,
                docCod: r.docCod != null ? String(r.docCod) : undefined,
                titCod: r.titCod != null ? String(r.titCod) : undefined,
                borCod: r.borCod != null ? Number(r.borCod) : undefined,
                borVldTipo: r.borVldTipo != null ? Number(r.borVldTipo) : undefined,
                bxaCodSeq: r.bxaCodSeq != null ? Number(r.bxaCodSeq) : undefined,
                pesCod: r.pesCod != null ? String(r.pesCod) : undefined,
                favorecido: r.dpeNomPessoa != null ? String(r.dpeNomPessoa) : undefined,
                vencimento: r.titDtaVencimento != null ? Number(r.titDtaVencimento) : undefined,
                valorPago: r.itsMnyVlrPgto != null ? Number(r.itsMnyVlrPgto) : undefined,
                observacao: r.ardEspObs != null ? String(r.ardEspObs) : undefined,
                gerNum: r.gerNum != null ? Number(r.gerNum) : undefined,
                gerDes: r.gerDes != null ? String(r.gerDes) : undefined,
            }));
        } catch (cause) {
            throw this.toConexosError(path, cause);
        }
    };

    /**
     * Ferramenta 3 (leitura) — erros de parse de um arquivo (`arquivosRetorno/erro/list`).
     */
    public listErros = async (params: {
        filCod: number;
        bncCod: number;
        gtbCodSeq: number;
        garCodSeq: number;
    }): Promise<ArquivoRetornoErro[]> => {
        const { filCod, bncCod, gtbCodSeq, garCodSeq } = params;
        // `GerArquivosRetornoErro` NÃO tem `filCod` — só a chave (bnc/gtb/gar).
        const filterList = {
            'bncCod#EQ': bncCod,
            'gtbCodSeq#EQ': gtbCodSeq,
            'garCodSeq#EQ': garCodSeq,
        };
        const path = 'fin052/arquivosRetorno/erro/list';
        try {
            const page = await this.base.runWithRetry(() =>
                this.base.listGenericPaginated<Record<string, unknown>>(
                    path,
                    this.listBody('fin052', filterList),
                    { filCod },
                ),
            );
            return (page.rows ?? []).map((r) => ({
                bncCod: Number(r.bncCod ?? bncCod),
                gtbCodSeq: Number(r.gtbCodSeq ?? gtbCodSeq),
                garCodSeq: Number(r.garCodSeq ?? garCodSeq),
                areCodSeq: r.areCodSeq != null ? Number(r.areCodSeq) : undefined,
                linha: r.areCodLine != null ? Number(r.areCodLine) : undefined,
                mensagem: r.areEspErro != null ? String(r.areEspErro) : undefined,
            }));
        } catch (cause) {
            throw this.toConexosError(path, cause);
        }
    };

    /**
     * Ferramenta 4 (leitura) — configs de layout de retorno (`ger015/list`). Descobre
     * os `gtbCodSeq` válidos por banco (o parse do `.RET` mora no `gtbLngSql`).
     */
    public listConfigsRetorno = async (params: {
        filCod: number;
        bncCod?: number;
    }): Promise<RetornoConfig[]> => {
        const { filCod, bncCod } = params;
        const filterList: Record<string, unknown> = {};
        if (bncCod !== undefined) filterList['bncCod#EQ'] = bncCod;
        try {
            const page = await this.base.runWithRetry(() =>
                this.base.listGenericPaginated<Record<string, unknown>>(
                    'ger015/list',
                    this.listBody('ger015', filterList),
                    { filCod },
                ),
            );
            return (page.rows ?? [])
                .map((r) => ({
                    bncCod: Number(r.bncCod),
                    gtbCodSeq: Number(r.gtbCodSeq),
                    nome: r.gtbDesNome != null ? String(r.gtbDesNome) : undefined,
                    banco: r.bncDesNome != null ? String(r.bncDesNome) : undefined,
                    status: r.gtbVldStatus != null ? Number(r.gtbVldStatus) : undefined,
                    ident: r.grbEspIdent != null ? String(r.grbEspIdent) : undefined,
                }))
                .filter((c) => Number.isFinite(c.gtbCodSeq));
        } catch (cause) {
            throw this.toConexosError('ger015/list', cause);
        }
    };

    /**
     * Ferramenta 5 (escrita) — CARREGA o `.RET` (`arquivosRetorno/carregar/{bnc}/{gtb}`,
     * multipart `file` + query `fileName`). Escrita NÃO-idempotente → `postMultipartOnce`
     * (tentativa única). ⚠️ ainda NÃO validada em HML (precisa de um `.RET` real). Retorna
     * a linha do arquivo recém-criado (`garCodSeq` alocado).
     */
    public carregarArquivoRetorno = async (
        params: CarregarRetornoParams,
    ): Promise<ArquivoRetorno> => {
        const { filCod, bncCod, gtbCodSeq, fileName, conteudo } = params;
        const path = `fin052/arquivosRetorno/carregar/${bncCod}/${gtbCodSeq}?fileName=${encodeURIComponent(fileName)}`;
        const form = new FormData();
        form.append('file', new Blob([new Uint8Array(conteudo)]), fileName);
        try {
            const raw = await this.base.postMultipartOnce<Record<string, unknown>>(path, form, {
                filCod,
            });
            return this.mapArquivo(raw ?? {});
        } catch (cause) {
            throw this.toConexosError(path, cause);
        }
    };
}
