import { inject, injectable, singleton } from 'tsyringe';
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
            this.base.postGeneric<PagedRaw<DocPagarRow>>(
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

        return { count: resposta.count ?? 0, rows: resposta.rows ?? [] };
    };

    /**
     * A trilha de UM título — hoje, uma chamada por título.
     *
     * É o custo que **PV-07** (acesso do usuário de API à tela `fin103`) derruba em duas ordens de
     * grandeza: com ele, isto vira uma varredura paginada. Enquanto a pendência não fecha, o job
     * compensa sendo retomável. Trocar a fonte é trocar o binding do
     * `TRILHA_APROVACAO_GATEWAY_TOKEN` — nada acima deste client muda.
     */
    public listTrilha = async (params: {
        filCod: number;
        docTip: number;
        docCod: number;
        titCod: number;
    }): Promise<FinTituloBloqRow[]> => {
        const { filCod, docTip, docCod, titCod } = params;
        const resposta = await this.base.runWithRetry(() =>
            this.base.postGeneric<PagedRaw<FinTituloBloqRow>>(
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

        return resposta.rows ?? [];
    };
}
