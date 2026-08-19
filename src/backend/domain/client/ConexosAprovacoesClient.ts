import { inject, injectable, singleton } from 'tsyringe';
import { z } from 'zod';
import type { FinTituloBloqRow } from '../interface/aprovacoes/EtapaAprovacao.js';
import type { DocPagarRow } from '../interface/aprovacoes/TituloAprovacao.js';
import type { TrilhaAprovacaoGatewayInterface } from '../interface/aprovacoes/ports.js';
import ConexosBaseClient from './ConexosBaseClient.js';

/**
 * Envelope paginado cru do Conexos. `count` é o total no ERP; `rows` é a página.
 */
interface PagedRaw<Row> {
    count?: number;
    rows?: Row[];
}

/**
 * Boundary Zod da resposta do ERP.
 *
 * O CLAUDE.md manda validar entrada externa com Zod no boundary, e este client era o único dos
 * nove clients Conexos sem nenhuma validação — a revisão de arquitetura mediu isso.
 *
 * O desenho é **tolerante de propósito**: `passthrough` preserva campos que ainda não modelamos, e
 * `catch` degrada campo a campo em vez de derrubar a página inteira. Numa varredura de 23 mil
 * títulos, um registro com um campo torto não pode invalidar os outros 499 da página — mas também
 * não pode entrar como `NaN` silencioso, que é o que `Number(undefined)` produziria.
 *
 * `coerce` existe porque o Conexos alterna número e string no mesmo campo entre telas.
 */
const numeroOpcional = z.coerce.number().finite().optional().catch(undefined);
const textoOpcional = z.coerce.string().optional().catch(undefined);

const DOC_PAGAR_SCHEMA = z
    .object({
        filCod: numeroOpcional,
        docTip: numeroOpcional,
        docCod: numeroOpcional,
        titCod: numeroOpcional,
        docEspNumero: textoOpcional,
        titEspNumero: textoOpcional,
        pesCod: numeroOpcional,
        dpeNomPessoa: textoOpcional,
        titMnyValor: numeroOpcional,
        docDtaEmissao: numeroOpcional,
        titDtaVencimento: numeroOpcional,
    })
    .passthrough();

const FIN_TITULO_BLOQ_SCHEMA = z
    .object({
        filCod: numeroOpcional,
        docTip: numeroOpcional,
        docCod: numeroOpcional,
        titCod: numeroOpcional,
        fblCod: numeroOpcional,
        ftbCod: numeroOpcional,
        fblDesNome: textoOpcional,
        fbaDesNome: textoOpcional,
        aprovador: textoOpcional,
        usnDesNomeCmd: textoOpcional,
        usnCodCmd: numeroOpcional,
        ftbVldStatus: numeroOpcional,
        ftbTimBloq: numeroOpcional,
        ftbTimCmd: numeroOpcional,
        ftbEspObsCmd: textoOpcional,
        ftbEspInfo: textoOpcional,
    })
    .passthrough();

/** Aplica o schema linha a linha, descartando o que não for objeto. */
const validarLinhas = <T>(rows: unknown[] | undefined, schema: z.ZodType<T>): T[] => {
    if (!rows) return [];
    const validas: T[] = [];
    for (const row of rows) {
        const parsed = schema.safeParse(row);
        if (parsed.success) validas.push(parsed.data);
    }
    return validas;
};

/**
 * Universo dos títulos: a tela de **PESQUISA**, não a de carteira.
 *
 * `fin026/list` projeta a carteira CORRENTE e some com títulos já liberados — foi o erro de método
 * que fez a primeira sondagem concluir que existiam 3 títulos com workflow em toda a produção. O
 * doc 4156 é a prova: existe no `psq014` e não aparece no `fin026`. Como o valor da Frente V está
 * no histórico, o universo certo é o da pesquisa.
 */
const ENDPOINT_UNIVERSO = 'psq014/list';
const SERVICE_UNIVERSO = 'psq014';

/** Trilha de um título. `com308/financeiroAPagar/infoTitulo/list/...` devolve exatamente o mesmo. */
const SERVICE_TRILHA = 'fin026';

/**
 * ConexosAprovacoesClient — leitura da trilha de aprovação (Frente V, F1).
 *
 * ⚠️ **Este client não tem, e não pode ganhar, nenhum método de escrita** (ADR-0038 D2). O ERP
 * expõe `trocaBloqueio`, `regerarBloqueios` e `aplicarComando` nas mesmas telas — e essas ações
 * liberam pagamento. Só `postGeneric` (leitura, com retry) é usado; as variantes `*Once`, que
 * existem para escrita irreversível, não aparecem aqui de propósito.
 *
 * Duas armadilhas confirmadas em produção, ambas encapsuladas aqui:
 *
 * 1. **Filial errada = falso negativo mudo (invariante I5).** Consultar a trilha com o `filCod`
 *    errado devolve `count: 0` SEM erro. Por isso `listTrilha` exige `filCod` explícito e o
 *    chamador o tira do próprio registro do título — nunca de um default.
 * 2. **Datas são epoch em milissegundos.** `#GE`/`#LE` funcionam com número; string ISO é recusada
 *    com `ECnxDataType can't be converted to Date`, e `#BETWEEN` não existe.
 */
@singleton()
@injectable()
export default class ConexosAprovacoesClient implements TrilhaAprovacaoGatewayInterface {
    constructor(
        @inject(ConexosBaseClient)
        private base: ConexosBaseClient,
    ) {}

    /**
     * Uma página do universo de títulos a pagar de uma filial.
     *
     * A **ordenação estável por `docCod`** não é cosmética: o backfill retoma por número de página,
     * e uma ordenação instável faria a retomada pular ou repetir títulos silenciosamente.
     */
    public listUniverso = async (params: {
        filCod: number;
        emissaoDesde?: number;
        pageNumber: number;
        pageSize: number;
    }): Promise<{ count: number; rows: DocPagarRow[] }> => {
        const filterList: Record<string, unknown> = {
            'filCod#EQ': params.filCod,
            // 1 = SAÍDA A RECEBER, 2 = ENTRADA A PAGAR. A Fase 1 cobre só a pagar (ADR-0038 D1).
            'docTip#EQ': 2,
        };
        // Janela de emissão em epoch ms — o ERP recusa string ISO.
        if (params.emissaoDesde !== undefined) {
            filterList['docDtaEmissao#GE'] = params.emissaoDesde;
        }

        const resposta = await this.base.runWithRetry(() =>
            this.base.postGeneric<PagedRaw<unknown>>(
                ENDPOINT_UNIVERSO,
                {
                    filterList,
                    pageNumber: params.pageNumber,
                    pageSize: params.pageSize,
                    serviceName: SERVICE_UNIVERSO,
                    orderList: { orderList: [{ propertyName: 'docCod', order: 'asc' }] },
                },
                { filCod: params.filCod },
            ),
        );

        return {
            count: resposta.count ?? 0,
            rows: validarLinhas(resposta.rows, DOC_PAGAR_SCHEMA) as DocPagarRow[],
        };
    };

    /**
     * A trilha de UM título — hoje, uma chamada por título.
     *
     * Uma chamada por título é **estrutural**, não temporária: a `fin103` é a fila pessoal do usuário
     * logado e nunca serviria para varredura (ver PV-07). Se aparecer outra projeção em massa,
     * trocar a fonte é trocar o binding do `TRILHA_APROVACAO_GATEWAY_TOKEN` — nada acima muda.
     */
    public listTrilha = async (params: {
        filCod: number;
        docTip: number;
        docCod: number;
        titCod: number;
    }): Promise<FinTituloBloqRow[]> => {
        const { filCod, docTip, docCod, titCod } = params;
        const resposta = await this.base.runWithRetry(() =>
            this.base.postGeneric<PagedRaw<unknown>>(
                `${SERVICE_TRILHA}/infoTitulo/list/${filCod}/${docTip}/${docCod}/${titCod}`,
                {
                    filterList: {},
                    pageNumber: 1,
                    pageSize: 200,
                    serviceName: SERVICE_TRILHA,
                },
                { filCod },
            ),
        );

        return validarLinhas(resposta.rows, FIN_TITULO_BLOQ_SCHEMA) as FinTituloBloqRow[];
    };
}
