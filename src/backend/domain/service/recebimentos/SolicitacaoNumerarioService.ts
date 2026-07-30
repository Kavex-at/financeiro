import 'reflect-metadata';
import { inject, injectable } from 'tsyringe';
import NotImplementedError from '../../errors/NotImplementedError.js';
import {
    SOLICITACAO_NUMERARIO_DOC_CONFIG,
    SOLICITACAO_NUMERARIO_DOC_TIP,
    SOLICITACAO_NUMERARIO_DOC_VLD_TIPO,
    SOLICITACAO_NUMERARIO_MOE_COD,
} from '../../interface/recebimentos/constants.js';
import type {
    GerDocProcessoSelectionDTOCab,
    Processo,
    SolicitacaoNumerarioDryRun,
} from '../../interface/recebimentos/GerDocProcesso.js';
import LogService from '../LogService.js';

/** Input do `gerar` — o processo escolhido + o valor da transação (base da SN) + o ator. */
export interface GerarSolicitacaoNumerarioInput {
    processo: Processo;
    /**
     * Valor da SN. TODO(encomenda-percentuais): a regra de % da encomenda (0,1% / 0,9%) é NÃO
     * RESOLVIDA (base de cálculo, significado, contas, arredondamento) — ver
     * `ontology/_inbox/frente-iv-recebimentos-nde-plan.md §7 Q4`. Enquanto isso, usa-se o valor CRU
     * da transação como o montante da SN.
     */
    valorTransacao: number;
    /** Data de referência (emissão/vencimento) — default `now` na rota. */
    dataReferencia: Date;
    ator: string;
}

/**
 * SolicitacaoNumerarioService — "Processar" um processo → gerar uma **Solicitação de Numerário
 * (encomenda)** via com299 `gerDocProcesso`.
 *
 * **DRY-RUN-ONLY.** `gerar()` CONSTRÓI o payload `GerDocProcessoSelectionDTOCab` exato (config `gcd`
 * "Solicitação de Numerário - Encomenda", `filCod`/`priCod`/`valor` mapeados) e o DEVOLVE com
 * `dryRun: true` — SEM nenhuma chamada ao Conexos. O envio real vive só no seam `enviarAoErp`, que
 * lança `NotImplementedError`: não há caminho de escrita no ERP alcançável nesta iteração. Ver
 * `ontology/actions/gerar-solicitacao-numerario.md` e
 * `ontology/integrations/conexos-com299-gerdoc.md`.
 */
@injectable()
export default class SolicitacaoNumerarioService {
    constructor(
        @inject(LogService)
        private logService: LogService,
    ) {}

    /**
     * Constrói e devolve o payload da SN (dry-run). NUNCA envia ao ERP.
     *
     * O `valor` da SN = valor CRU da transação (a regra de % da encomenda é não-resolvida — ver o
     * TODO no input). O `items[]` (rateio) carrega uma única parcela com o total, espelhando o
     * `TmpCom068DTOItem` do swagger; os códigos de rateio (prj/ctp/tpc/cfo) ficam 0 (placeholder) até
     * o HAR confirmar a origem — o preview deixa isso explícito.
     */
    public gerar = (input: GerarSolicitacaoNumerarioInput): SolicitacaoNumerarioDryRun => {
        const { processo, valorTransacao, dataReferencia, ator } = input;
        // TODO(encomenda-percentuais): regra não-resolvida — usa o valor cru da transação como o
        // montante da SN. Ver ontology/_inbox/frente-iv-recebimentos-nde-plan.md §7 Q4.
        const valorSn = valorTransacao;
        const dataIso = dataReferencia.toISOString();

        const docConfig = {
            gcdCod: SOLICITACAO_NUMERARIO_DOC_CONFIG.gcdCod,
            gcdDesNome: SOLICITACAO_NUMERARIO_DOC_CONFIG.gcdDesNome,
        };

        const payload: GerDocProcessoSelectionDTOCab = {
            filCod: processo.filCod,
            docTip: SOLICITACAO_NUMERARIO_DOC_TIP,
            docVldTipo: SOLICITACAO_NUMERARIO_DOC_VLD_TIPO,
            priCod: processo.priCod,
            // `priEspRefcliente` é opcional no imp021 — aqui a semântica é
            // "campo vazio no ERP", não "não sei".
            priEspRefcliente: processo.priEspRefcliente ?? '',
            pesCod: processo.pesCod,
            dpeNomPessoa: processo.dpeNomPessoa,
            gcdCod: docConfig.gcdCod,
            gcdDesNome: docConfig.gcdDesNome,
            docDtaEmissao: dataIso,
            dtaVencimento: dataIso,
            valor: valorSn,
            moeCod: processo.moeCod || SOLICITACAO_NUMERARIO_MOE_COD,
            items: [
                {
                    prjCod: 0,
                    ctpCod: 0,
                    tmpMnyValor: valorSn,
                    ctpDesNome: docConfig.gcdDesNome,
                    tpcCod: 0,
                    cfoEspCod: 0,
                    total: valorSn,
                },
            ],
        };

        void this.logService.info({
            type: 'BUSINESS_INFO',
            message: 'gerarSolicitacaoNumerario (dry-run) — nenhuma chamada ao ERP',
            data: {
                dryRun: true,
                priCod: processo.priCod,
                filCod: processo.filCod,
                gcdDesNome: docConfig.gcdDesNome,
                ator,
            },
        });

        return { dryRun: true, docConfig, payload };
    };

    /**
     * SEAM do envio REAL ao Conexos (`POST /api/com299/gerDocProcesso`). **NÃO IMPLEMENTADO** de
     * propósito — lança `NotImplementedError` para garantir que NÃO há caminho de escrita no ERP
     * alcançável nesta iteração. Será cabeado quando HML/HAR confirmarem o `gcdCod` e o shape exatos.
     */
    public enviarAoErp = async (_payload: GerDocProcessoSelectionDTOCab): Promise<never> => {
        throw new NotImplementedError(
            'com299/gerDocProcesso live POST is disabled — dry-run only until HML/HAR confirm gcdCod + payload',
        );
    };
}
