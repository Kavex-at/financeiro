import { inject, injectable, singleton } from 'tsyringe';
import { z } from 'zod';
import type { ChannelPayment } from '../interface/sispag/SispagInterface.js';
import ConexosBaseClient from './ConexosBaseClient.js';

/** Borderôs por página, do mais recente para o mais antigo (a leitura para ao sair da janela). */
const BORDERO_PAGE_SIZE = 400;
const BORDERO_MAX_PAGINAS = 100;
/** Baixas por página dentro de um borderô. */
const BAIXA_PAGE_SIZE = 500;
const BAIXA_MAX_PAGINAS = 20;

/** `borVldTipo = 2`: borderô de PAGAMENTO (a pagar). */
const BORDERO_TIPO_PAGAR = 2;

const numOpt = z.preprocess(
    (v) => (v === null || v === '' ? undefined : v),
    z.coerce.number().optional().catch(undefined),
);
const strOpt = z
    .union([z.string(), z.number()])
    .transform((v) => String(v).trim())
    .optional()
    .catch(undefined);

const borderoSchema = z
    .object({
        borCod: z.coerce.number().int().positive(),
        borDtaMvto: numOpt,
    })
    .passthrough();

const baixaSchema = z
    .object({
        pesCod: strOpt,
        dpeNomPessoa: strOpt,
        dpeNomPessoaDocumento: strOpt,
        bxaMnyLiquido: numOpt,
        bxaMnyValor: numOpt,
        lcbDtaCompensado: numOpt,
        borDtaMvto: numOpt,
        vldPermuta: numOpt,
        gerNumPermuta: strOpt,
    })
    .passthrough();

export interface BorderoPagamento {
    borCod: number;
    borDtaMvto?: number;
}

/**
 * ConexosPagamentosRealizadosClient — o que JÁ FOI PAGO, para o perfil de canal (ADR-0063, I13i).
 *
 * READ-ONLY por contrato: só `listGenericPaginated` em `fin010/list` (borderôs de pagamento
 * finalizados) e `fin010/baixas/list/{borCod}` (as baixas de cada um). Extraído da
 * `probe-canal-por-fornecedor.ts`. O casamento baixa × débito do extrato NÃO mora aqui: é do
 * `ChannelProfileCalculator` (puro).
 *
 * Paginação real: o `listGenericPaginated` devolve UMA página; os laços comparam `count` × linhas.
 */
@singleton()
@injectable()
export default class ConexosPagamentosRealizadosClient {
    public constructor(@inject(ConexosBaseClient) private readonly base: ConexosBaseClient) {}

    /**
     * Borderôs de pagamento FINALIZADOS da filial com movimento ≥ `desde`. Pede do mais recente
     * para o mais antigo e para quando a página já passou da janela.
     */
    public listBorderosPagamento = async (
        filCod: number,
        desde: number,
    ): Promise<BorderoPagamento[]> => {
        const out: BorderoPagamento[] = [];
        for (let pagina = 1; pagina <= BORDERO_MAX_PAGINAS; pagina += 1) {
            const page = await this.base.runWithRetry(() =>
                this.base.listGenericPaginated<Record<string, unknown>>(
                    'fin010/list',
                    {
                        fieldList: [],
                        filterList: {
                            'borVldTipo#EQ': BORDERO_TIPO_PAGAR,
                            'borVldFinalizado#EQ': 1,
                        },
                        serviceName: 'fin010',
                        pageNumber: pagina,
                        pageSize: BORDERO_PAGE_SIZE,
                        orderList: { orderList: [{ propertyName: 'borDtaMvto', order: 'desc' }] },
                    },
                    { filCod },
                ),
            );
            const rows = page.rows ?? [];
            const borderos = rows.flatMap((row) => {
                const parsed = borderoSchema.safeParse(row);
                return parsed.success ? [parsed.data] : [];
            });
            out.push(
                ...borderos
                    .filter((b) => (b.borDtaMvto ?? 0) >= desde)
                    .map((b) => ({
                        borCod: b.borCod,
                        ...(b.borDtaMvto !== undefined ? { borDtaMvto: b.borDtaMvto } : {}),
                    })),
            );
            const ultimo = borderos[borderos.length - 1];
            if (rows.length < BORDERO_PAGE_SIZE) break;
            if (!ultimo || (ultimo.borDtaMvto ?? 0) < desde) break;
            const total = Number(page.count);
            if (Number.isFinite(total) && pagina * BORDERO_PAGE_SIZE >= total) break;
        }
        return out;
    };

    /**
     * Baixas a pagar de um borderô, sem permuta (permuta não é dinheiro saindo do banco). A data é
     * a da compensação quando o ERP a traz; senão a do movimento do borderô.
     */
    public listBaixasPagamento = async (
        filCod: number,
        bordero: BorderoPagamento,
    ): Promise<ChannelPayment[]> => {
        const endpoint = `fin010/baixas/list/${bordero.borCod}`;
        const linhas: Record<string, unknown>[] = [];
        for (let pagina = 1; pagina <= BAIXA_MAX_PAGINAS; pagina += 1) {
            const page = await this.base.runWithRetry(() =>
                this.base.listGenericPaginated<Record<string, unknown>>(
                    endpoint,
                    {
                        fieldList: [],
                        filterList: {},
                        pageNumber: pagina,
                        pageSize: BAIXA_PAGE_SIZE,
                    },
                    { filCod },
                ),
            );
            const rows = page.rows ?? [];
            linhas.push(...rows);
            const total = Number(page.count);
            if (rows.length < BAIXA_PAGE_SIZE) break;
            if (Number.isFinite(total) && linhas.length >= total) break;
        }
        return linhas.flatMap((row) => {
            const parsed = baixaSchema.safeParse(row);
            if (!parsed.success) return [];
            const r = parsed.data;
            if (r.vldPermuta === 1 || r.gerNumPermuta) return [];
            const valor = Math.abs(r.bxaMnyLiquido ?? r.bxaMnyValor ?? 0);
            const data = r.lcbDtaCompensado ?? r.borDtaMvto ?? bordero.borDtaMvto;
            if (!(valor > 0) || data === undefined) return [];
            const credor = r.dpeNomPessoa || r.dpeNomPessoaDocumento;
            return [
                {
                    ...(r.pesCod ? { pesCod: r.pesCod } : {}),
                    ...(credor ? { credor } : {}),
                    valor,
                    data,
                },
            ];
        });
    };
}
