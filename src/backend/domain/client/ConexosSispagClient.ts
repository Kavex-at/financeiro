import { inject, injectable, singleton } from 'tsyringe';
import { z } from 'zod';
import {
    type BorderoAPagar,
    type LoteSispag,
    MODALIDADE,
    type Modalidade,
    type TituloAPagar,
    type ContaCorrentePagadora,
    type ContaFavorecido,
} from '../interface/sispag/SispagInterface.js';
import Logger from '../libs/logger/Logger.js';
import ConexosBaseClient from './ConexosBaseClient.js';

/**
 * ConexosSispagClient — leitura da superfície de PAGAMENTOS do Conexos (Escopo II).
 *
 * READ-ONLY por contrato: só usa `listGenericPaginated` (protocolo de query do
 * Conexos). Nenhuma escrita (`gerarRemessa`/`finalizarLote`/`baixas` ficam FORA
 * deste client — são Fatia 3, gated). Espelha o padrão dos demais Conexos*Client
 * (composição de `ConexosBaseClient`, Zod no boundary).
 *
 * Fontes (confirmadas em produção via probe read-only):
 *   - `fin064/list` → carteira de títulos a pagar
 *   - `fin015/list` → lotes SISPAG nativos
 *   - `fin010/list` (borVldTipo=2) → borderôs a-pagar (baixa)
 */

const PAGE_SIZE = 200;

/** Coerção tolerante de número (aceita string numérica; senão undefined). */
const numOpt = z.coerce.number().optional().catch(undefined);
const strOpt = z
    .union([z.string(), z.number()])
    .transform((v) => String(v))
    .optional()
    .catch(undefined);
const boolFromFlag = z
    .union([z.number(), z.string(), z.boolean()])
    .transform((v) => v === 1 || v === '1' || v === true)
    .optional()
    .catch(false);

const tituloRowSchema = z
    .object({
        docCod: z.union([z.string(), z.number()]).transform(String),
        titCod: z.union([z.string(), z.number()]).transform(String).optional().catch('1'),
        dpeNomPessoa: strOpt,
        dpeNomPessoaFor: strOpt,
        titMnyValor: numOpt,
        moeEspSigla: strOpt,
        titDtaVencimento: numOpt,
        vldLib: boolFromFlag,
        vldPago: boolFromFlag,
        bncDesNome: strOpt,
        titNumRemessa: strOpt,
        pesCod: strOpt,
        tpdCod: strOpt,
        // sinais de "pronto para remessa" (informativo) — o que o fin064 já traz.
        itsVldModalidade: numOpt,
        pctNumBanco: strOpt,
        pctEspNumContaBanc: strOpt,
        titEspCodbar: strOpt,
        itsDesChavePix: strOpt,
    })
    .passthrough();

type TituloRow = z.infer<typeof tituloRowSchema>;

const loteRowSchema = z
    .object({
        flpCod: z.coerce.number(),
        bncDesNome: strOpt,
        conta: strOpt,
        layoutConta: strOpt,
        flpVldStatus: numOpt,
        flpVldConfEnvio: boolFromFlag,
        flpVldRet: boolFromFlag,
        titulosCount: numOpt,
        soma: numOpt,
        itensRetorno: numOpt,
        usnDesNomeFin: strOpt,
        flpDtaCredito: numOpt,
    })
    .passthrough();

const borderoRowSchema = z
    .object({
        borCod: z.coerce.number(),
        gerDes: strOpt,
        vlrTotalLiquido: numOpt,
        borDtaMvto: numOpt,
        borVldFinalizado: numOpt,
        vldHasRemessaPgto: boolFromFlag,
        vldHasBaixa: boolFromFlag,
    })
    .passthrough();

@singleton()
@injectable()
export default class ConexosSispagClient {
    public constructor(@inject(ConexosBaseClient) private readonly base: ConexosBaseClient) {}

    /**
     * `true` só quando o Conexos RECUSA o filtro de query (HTTP 400) — o único
     * caso em que a leitura sem filtro é um fallback legítimo. `authenticatedPost`
     * re-lança o erro axios cru, então `response.status` chega aqui intacto. Erros
     * transitórios (5xx/timeout/rede → sem 400) NÃO são fallback: devem propagar.
     */
    private isFilterRejected = (err: unknown): boolean =>
        typeof err === 'object' &&
        err !== null &&
        (err as { response?: { status?: number } }).response?.status === 400;

    /** Body de query padrão do Conexos (`/list`). */
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

    /** Mapeia uma linha do `fin064` para `TituloAPagar` (compartilhado por list/get). */
    private mapTitulo = (r: TituloRow, filCod: number): TituloAPagar => {
        // Formas de pagamento DISPONÍVEIS (A2 opção B).
        //
        // ⚠️ `pctNumBanco`/`pctEspNumContaBanc` NÃO servem para isto. Sondagem read-only
        // (2026-08-20) mediu 0% de preenchimento em 561 títulos de HML e 2000 de PRD: no
        // `fin064` os campos `pct*`/`its*` são um LEFT JOIN no ITEM SISPAG e só populam
        // depois que o título entra num lote. A conta do favorecido mora em
        // `CmnPessoasCtcorr` (`cmn025/ctcorr/list`) — ver `listContasFavorecido`.
        // Consequência: derivar TED/CRÉDITO daqui devolvia SEMPRE lista vazia.
        //
        // Boleto/PIX seguem vindo do título; a disponibilidade de conta é resolvida por
        // quem tem orçamento para a chamada extra (`modalidadesDisponiveisDoLote`).
        const temBoleto = Boolean(r.titEspCodbar);
        const temPix = Boolean(r.itsDesChavePix);
        const temContaBanco = false;
        const modalidadesDisponiveis: Modalidade[] = [];
        if (temBoleto) modalidadesDisponiveis.push(MODALIDADE.BOLETO);
        if (temPix) modalidadesDisponiveis.push(MODALIDADE.PIX);
        if (temContaBanco) {
            modalidadesDisponiveis.push(MODALIDADE.TED, MODALIDADE.CREDITO_CONTA);
        }
        const temModalidade = r.itsVldModalidade !== undefined;
        return {
            docCod: r.docCod,
            titCod: r.titCod ?? '1',
            filCod,
            credor: r.dpeNomPessoa ?? r.dpeNomPessoaFor,
            valor: r.titMnyValor ?? 0,
            moeda: r.moeEspSigla,
            vencimento: r.titDtaVencimento,
            liberado: r.vldLib ?? false,
            pago: r.vldPago ?? false,
            banco: r.bncDesNome,
            numRemessa: r.titNumRemessa,
            pesCod: r.pesCod,
            tpdCod: r.tpdCod,
            prontoParaRemessa: temBoleto || temPix || temContaBanco || temModalidade,
            // A2: código de barras presente = candidato a BOLETO (auto-detecção na revisão).
            temBoleto,
            modalidadesDisponiveis,
        };
    };

    /**
     * Títulos a pagar de uma filial (`fin064/list`). Filtra server-side por
     * NÃO-pago + vencimento numa janela (default: dos últimos 30 dias em diante),
     * para o painel focar no que é relevante (a vencer + vencidos recentes) — sem
     * o filtro, o `fin064` devolve stragglers de anos atrás. Se o Conexos recusar
     * o filtro (400), cai para busca sem filtro (o serviço filtra em memória).
     * Erro transitório (5xx/timeout/rede) NÃO cai no fallback — propaga (não
     * mascarar uma falha do ERP com uma leitura ampla de milhares de linhas).
     */
    public listTitulosAPagar = async (
        filCod: number,
        opts: { minVencimento?: number; maxVencimento?: number } = {},
    ): Promise<TituloAPagar[]> => {
        const filtered: Record<string, unknown> = { 'vldPago#EQ': 0 };
        if (opts.minVencimento !== undefined) {
            filtered['titDtaVencimento#GE'] = opts.minVencimento;
        }
        if (opts.maxVencimento !== undefined) {
            filtered['titDtaVencimento#LE'] = opts.maxVencimento;
        }
        let rows: Record<string, unknown>[];
        try {
            const res = await this.base.runWithRetry(() =>
                this.base.listGenericPaginated<Record<string, unknown>>(
                    'fin064/list',
                    this.listBody('fin064', filtered, 1000),
                    { filCod },
                ),
            );
            rows = res.rows;
        } catch (err) {
            if (!this.isFilterRejected(err)) throw err;
            // Fallback NÃO-silencioso: se o Conexos passar a recusar o filtro de forma
            // sistemática (drift de schema no fin064), a leitura ampla vira sinal, não
            // um degrade oculto (o modo de falha que este fix fecha em 1º lugar).
            Logger.warn(
                `[SISPAG] fin064/list recusou o filtro (400) na filial ${filCod} — fallback para leitura sem filtro de vencimento`,
            );
            const res = await this.base.runWithRetry(() =>
                this.base.listGenericPaginated<Record<string, unknown>>(
                    'fin064/list',
                    this.listBody('fin064'),
                    { filCod },
                ),
            );
            rows = res.rows;
        }
        return rows.flatMap((row) => {
            const parsed = tituloRowSchema.safeParse(row);
            if (!parsed.success) return [];
            return [this.mapTitulo(parsed.data, filCod)];
        });
    };

    /**
     * Leitura pontual e AUTORITATIVA de um título a pagar (`fin064/list` filtrado
     * por `docCod`). Usada na inclusão em lote para validar elegibilidade (I2) e
     * capturar o snapshot de valor/venc/credor no instante — espelha a anti-drift
     * de Permutas. Retorna `null` se o título não existir na leitura.
     */
    public getTituloAPagar = async (
        filCod: number,
        docCod: string,
        titCod: string,
    ): Promise<TituloAPagar | null> => {
        const { rows } = await this.base.runWithRetry(() =>
            this.base.listGenericPaginated<Record<string, unknown>>(
                'fin064/list',
                this.listBody('fin064', { 'docCod#EQ': docCod }, 200),
                { filCod },
            ),
        );
        for (const row of rows) {
            const parsed = tituloRowSchema.safeParse(row);
            if (!parsed.success) continue;
            const r = parsed.data;
            if (r.docCod !== docCod || (r.titCod ?? '1') !== titCod) continue;
            return this.mapTitulo(r, filCod);
        }
        return null;
    };

    /**
     * Contas correntes PAGADORAS de uma filial (`fin005/list`). É a origem do dinheiro e a
     * fonte da conta financeira (`gerNum`) que a conciliação contábil usa. Nunca fixar o
     * `ccoCod`: ele é relativo à filial (ver `ContaCorrentePagadora`).
     */
    public listContasCorrentes = async (filCod: number): Promise<ContaCorrentePagadora[]> => {
        const { rows } = await this.base.runWithRetry(() =>
            this.base.listGenericPaginated<Record<string, unknown>>(
                'fin005/list',
                this.listBody('fin005', {}, 100),
                { filCod },
            ),
        );
        return rows
            .map((r) => ({
                ccoCod: Number(r.ccoCod),
                bncCod: Number(r.bncCod),
                ...(r.ccoEspAgcod != null ? { agencia: String(r.ccoEspAgcod) } : {}),
                ...(r.ccoNumConta != null ? { numeroConta: Number(r.ccoNumConta) } : {}),
                ...(r.ccoEspDvconta != null ? { dvConta: String(r.ccoEspDvconta) } : {}),
                ...(r.gerNum != null ? { gerNum: Number(r.gerNum) } : {}),
                ...(r.gerDes != null ? { gerDes: String(r.gerDes) } : {}),
            }))
            .filter((c) => Number.isFinite(c.ccoCod));
    };

    /**
     * Contas correntes cadastradas de um favorecido (`cmn025/ctcorr/list`, schema
     * `CmnPessoasCtcorr`). É a fonte AUTORITATIVA do destino de pagamento — o `fin064`
     * não carrega isso (ver `mapTitulo`). O `pctCodSeq` devolvido aqui é o campo que o
     * `FinItemSispag` referencia no import do lote fin015.
     *
     * Devolve só contas ATIVAS (`pctVldStatus === 1`), com a conta DEFAULT
     * (`pctVldDefault === 1`) à frente — é a que a tela do ERP usa.
     */
    public listContasFavorecido = async (
        pesCod: string | number,
        filCod: number,
    ): Promise<ContaFavorecido[]> => {
        const { rows } = await this.base.runWithRetry(() =>
            this.base.listGenericPaginated<Record<string, unknown>>(
                'cmn025/ctcorr/list',
                this.listBody('cmn025', { 'pesCod#EQ': pesCod }, 50),
                { filCod },
            ),
        );
        return rows
            .filter((c) => Number(c.pctVldStatus) === 1)
            .map((c) => ({
                pctCodSeq: Number(c.pctCodSeq),
                banco: Number(c.pctNumBanco),
                bancoNome: c.bncDesNome != null ? String(c.bncDesNome) : undefined,
                agencia: c.pctEspNumAgencia != null ? String(c.pctEspNumAgencia) : undefined,
                conta: c.pctEspNumContaBanc != null ? String(c.pctEspNumContaBanc) : undefined,
                dvConta: c.pctEspDvconta != null ? String(c.pctEspDvconta) : undefined,
                padrao: Number(c.pctVldDefault) === 1,
            }))
            .sort((a, b) => Number(b.padrao) - Number(a.padrao));
    };

    /**
     * Conjunto de `docCod` do EXTERIOR (`com298`, `ufEspSigla='EX'`) de uma filial — usado
     * pela ingestão para EXCLUIR títulos internacionais da carteira SISPAG (câmbio está
     * fora do escopo; é feito manualmente pela tesouraria, ver ADR-0021). O `fin064` não
     * traz `ufEspSigla`, por isso a leitura em massa no `com298`.
     */
    public listExteriorDocCods = async (filCod: number): Promise<Set<string>> => {
        const { rows } = await this.base.runWithRetry(() =>
            this.base.listGenericPaginated<Record<string, unknown>>(
                'com298/list',
                {
                    fieldList: ['docCod', 'ufEspSigla'],
                    filterList: { 'vldStatus#IN': ['1', '3'], 'ufEspSigla#LIKE': 'EX' },
                    serviceName: 'com298',
                    pageNumber: 1,
                    pageSize: 5000,
                },
                { filCod },
            ),
        );
        const set = new Set<string>();
        for (const r of rows) {
            if (r.docCod !== null && r.docCod !== undefined) set.add(String(r.docCod));
        }
        return set;
    };

    /** Lotes SISPAG nativos de uma filial (`fin015/list`). */
    public listLotes = async (filCod: number): Promise<LoteSispag[]> => {
        const { rows } = await this.base.runWithRetry(() =>
            this.base.listGenericPaginated<Record<string, unknown>>(
                'fin015/list',
                this.listBody('fin015', {}, 100),
                { filCod },
            ),
        );
        return rows.flatMap((row) => {
            const parsed = loteRowSchema.safeParse(row);
            if (!parsed.success) return [];
            const r = parsed.data;
            return [
                {
                    filCod,
                    flpCod: r.flpCod,
                    banco: r.bncDesNome,
                    conta: r.conta,
                    layoutConta: r.layoutConta,
                    status: r.flpVldStatus ?? 0,
                    envioConfirmado: r.flpVldConfEnvio ?? false,
                    retornoProcessado: r.flpVldRet ?? false,
                    titulosCount: r.titulosCount ?? 0,
                    soma: r.soma ?? 0,
                    itensRetorno: r.itensRetorno ?? 0,
                    finalizadoPor: r.usnDesNomeFin,
                    dataCredito: r.flpDtaCredito,
                } satisfies LoteSispag,
            ];
        });
    };

    /** Borderôs a-pagar (baixa) de uma filial (`fin010/list`, borVldTipo=2). */
    public listBorderosAPagar = async (filCod: number): Promise<BorderoAPagar[]> => {
        const { rows } = await this.base.runWithRetry(() =>
            this.base.listGenericPaginated<Record<string, unknown>>(
                'fin010/list',
                this.listBody('fin010', { 'borVldTipo#EQ': 2 }, 100),
                { filCod },
            ),
        );
        return rows.flatMap((row) => {
            const parsed = borderoRowSchema.safeParse(row);
            if (!parsed.success) return [];
            const r = parsed.data;
            return [
                {
                    borCod: r.borCod,
                    filCod,
                    descricao: r.gerDes,
                    valor: r.vlrTotalLiquido ?? 0,
                    data: r.borDtaMvto,
                    finalizado: r.borVldFinalizado ?? 0,
                    temRemessa: r.vldHasRemessaPgto ?? false,
                    temBaixa: r.vldHasBaixa ?? false,
                } satisfies BorderoAPagar,
            ];
        });
    };
}
