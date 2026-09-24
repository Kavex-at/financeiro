import { inject, injectable, singleton } from 'tsyringe';
import { z } from 'zod';
import ConexosError from '../errors/ConexosError.js';
import type { ArquivoDda, ItemDda } from '../interface/sispag/BoletoDda.js';
import ConexosBaseClient from './ConexosBaseClient.js';

const PAGE_SIZE = 1000;
/** 60 páginas × 1000 = 60 mil linhas: muito acima de qualquer arquivo ou do pool inteiro hoje. */
const MAX_PAGINAS = 60;

const numOpt = z.coerce.number().nullish();
/** Número obrigatório. `z.coerce.number()` sozinho transforma `null` em 0 — aqui ausente é ausente. */
const numReq = z.preprocess((v) => (v === null || v === '' ? undefined : v), z.coerce.number());
const strOpt = z
    .union([z.string(), z.number()])
    .nullish()
    .transform((v) => (v == null ? undefined : String(v).trim() || undefined));

/** Boundary de `fin124/list`. Sem `ddcCod` a linha não identifica nada — é descartada. */
const ARQUIVO_SCHEMA = z.object({
    ddcCod: z.coerce.number().int().positive(),
    ddcEspFilename: strOpt,
    ddcTimCad: numOpt,
    ddcTimCanc: numOpt,
    ddcVldStatus: numOpt,
});

/**
 * Boundary de `fin124/itens/list/{ddcCod}`. `ditMnyValor` é obrigatório: um boleto sem valor não
 * pode ser consolidado e, se aparecer, é contrato quebrado — melhor descartar a linha que inventar 0.
 */
const ITEM_SCHEMA = z.object({
    ditCod: numReq.pipe(z.number().int()),
    ditEspNumero: strOpt,
    ditMnyValor: numReq,
    ditDtaVencimento: numOpt,
    ditEspCodbar: strOpt,
    filCod: numOpt,
    docCod: strOpt,
    titCod: strOpt,
    flpCod: numOpt,
    bncCod: numOpt,
});

/** epoch ms (meia-noite UTC, como o Conexos manda datas) → `YYYY-MM-DD`. */
const dataCivil = (ms?: number | null): string | undefined =>
    ms == null ? undefined : new Date(ms).toISOString().slice(0, 10);

/**
 * Conexos `fin124` — Importação de Arquivo DDA. SÓ LEITURA: `list` e `itens/list`.
 * `fin124/importar` e `fin124/cancelar` existem e NÃO são tocados aqui.
 *
 * O pool é global (da conta pagadora): o header `Cnx-filCod` não escopa o resultado (medido em
 * PRD, contagens idênticas nas 5 filiais). A filial vai só porque o Conexos exige uma na sessão.
 * Ver `ontology/_inbox/sispag-boleto-dda-sondagem.md` §2.
 */
@singleton()
@injectable()
export default class ConexosDdaClient {
    public constructor(@inject(ConexosBaseClient) private readonly base: ConexosBaseClient) {}

    public listarArquivos = async (params: { filCod: number }): Promise<ArquivoDda[]> => {
        const rows = await this.listarTudo('fin124/list', params.filCod);
        const arquivos: ArquivoDda[] = [];
        for (const row of rows) {
            const parsed = ARQUIVO_SCHEMA.safeParse(row);
            if (!parsed.success) continue;
            const a = parsed.data;
            arquivos.push({
                ddcCod: a.ddcCod,
                ...(a.ddcEspFilename ? { nome: a.ddcEspFilename } : {}),
                ...(a.ddcTimCad != null ? { importadoEm: a.ddcTimCad } : {}),
                ...(a.ddcTimCanc != null ? { canceladoEm: a.ddcTimCanc } : {}),
                ...(a.ddcVldStatus != null ? { status: a.ddcVldStatus } : {}),
            });
        }
        return arquivos;
    };

    public listarItens = async (params: { filCod: number; ddcCod: number }): Promise<ItemDda[]> => {
        const rows = await this.listarTudo(`fin124/itens/list/${params.ddcCod}`, params.filCod);
        const itens: ItemDda[] = [];
        for (const row of rows) {
            const parsed = ITEM_SCHEMA.safeParse(row);
            if (parsed.success) itens.push(this.paraItem(params.ddcCod, parsed.data));
        }
        return itens;
    };

    private paraItem = (ddcCod: number, i: z.infer<typeof ITEM_SCHEMA>): ItemDda => {
        const vencimento = dataCivil(i.ditDtaVencimento);
        return {
            ddcCod,
            ditCod: i.ditCod,
            valor: i.ditMnyValor,
            ...(i.ditEspNumero ? { numero: i.ditEspNumero } : {}),
            ...(vencimento ? { vencimento } : {}),
            ...(i.ditEspCodbar ? { codbar: i.ditEspCodbar } : {}),
            ...this.vinculo(i),
        };
    };

    /** Campos de vínculo que o Conexos grava na associação do fin015 — só os presentes. */
    private vinculo = (i: z.infer<typeof ITEM_SCHEMA>): Partial<ItemDda> => ({
        ...(i.filCod != null ? { filCod: Number(i.filCod) } : {}),
        ...(i.docCod ? { docCod: i.docCod } : {}),
        ...(i.titCod ? { titCod: i.titCod } : {}),
        ...(i.flpCod != null ? { flpCod: Number(i.flpCod) } : {}),
        ...(i.bncCod != null ? { bncCod: Number(i.bncCod) } : {}),
    });

    private listarTudo = async (
        path: string,
        filCod: number,
    ): Promise<Array<Record<string, unknown>>> => {
        const acumulado: Array<Record<string, unknown>> = [];
        try {
            for (let pageNumber = 1; pageNumber <= MAX_PAGINAS; pageNumber += 1) {
                const page = await this.base.runWithRetry(async () => {
                    await this.base.ensureSid();
                    return this.base.listGenericPaginated<Record<string, unknown>>(
                        path,
                        {
                            fieldList: [],
                            filterList: {},
                            serviceName: 'fin124',
                            pageNumber,
                            pageSize: PAGE_SIZE,
                        },
                        { filCod },
                    );
                });
                const linhas = page.rows ?? [];
                acumulado.push(...linhas);
                const total = Number(page.count);
                if (linhas.length < PAGE_SIZE) break;
                if (Number.isFinite(total) && acumulado.length >= total) break;
            }
            return acumulado;
        } catch (cause) {
            throw new ConexosError({ endpoint: path, cause });
        }
    };
}
