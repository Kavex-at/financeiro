import 'reflect-metadata';
import { inject, injectable } from 'tsyringe';
import EnvironmentProvider from '../../libs/environment/EnvironmentProvider.js';
import type {
    Processo,
    SolicitacaoNumerarioDryRun,
} from '../../interface/recebimentos/GerDocProcesso.js';
import LogService from '../LogService.js';
import EncomendaValorCalculator from './EncomendaValorCalculator.js';
import SnPayloadBuilder from './SnPayloadBuilder.js';

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
 * SolicitacaoNumerarioService — "Processar" um processo → CONSTRÓI o payload da **Solicitação de
 * Numerário (encomenda)** (com299 `gerDocProcesso`) em DRY-RUN.
 *
 * `gerar()` monta o `GerDocProcessoSelectionDTOCab` exato (via `SnPayloadBuilder` — a MESMA fonte que o
 * orquestrador REAL `RecebimentoNumerarioService` usa) e o DEVOLVE com `dryRun: true`, SEM nenhuma
 * chamada ao Conexos. O envio real vive no orquestrador (gated por `conexosWriteEnabled`/`conexosDryRun`);
 * esta rota preserva o preview. Ver `ontology/actions/recebimentos/gerar-solicitacao-numerario.md` e
 * `ontology/integrations/conexos-com299-gerdoc.md`.
 */
@injectable()
export default class SolicitacaoNumerarioService {
    constructor(
        @inject(LogService)
        private logService: LogService,
        @inject(EnvironmentProvider)
        private environmentProvider: EnvironmentProvider,
        @inject(EncomendaValorCalculator)
        private encomendaValorCalculator: EncomendaValorCalculator,
        @inject(SnPayloadBuilder)
        private snPayloadBuilder: SnPayloadBuilder,
    ) {}

    /**
     * Constrói e devolve o payload da SN (dry-run). NUNCA envia ao ERP.
     *
     * O `valor` da SN = valor CRU da transação (a regra de % da encomenda é não-resolvida — ver o
     * TODO no input). O `items[]` (rateio) carrega uma única parcela com o total; os códigos de rateio
     * (prj/ctp/tpc/cfo) ficam 0 (placeholder) até o HAR confirmar a origem — o preview deixa explícito.
     */
    public gerar = async (
        input: GerarSolicitacaoNumerarioInput,
    ): Promise<SolicitacaoNumerarioDryRun> => {
        const { processo, valorTransacao, dataReferencia, ator } = input;
        // Regra de % da encomenda isolada no calculator (não-resolvida hoje → valor cru).
        const { valorSn } = this.encomendaValorCalculator.calcular({ valorTransacao });

        // `gcdCod` vem do ambiente (`SN_GCD_COD`) — sentinela 0 = "não confirmado".
        const env = await this.environmentProvider.getEnvironmentVars();
        const gcdCod = env.solicitacaoNumerarioGcdCod;

        const docConfig = this.snPayloadBuilder.docConfig(gcdCod);
        const payload = this.snPayloadBuilder.build({ processo, valorSn, dataReferencia, gcdCod });

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
}
