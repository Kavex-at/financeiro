import { inject, injectable } from 'tsyringe';
import type { ArquivoRetornoDetalhe } from '../../interface/sispag/Fin052Retorno.js';
import type { ChaveItemLote } from '../../interface/sispag/SincronizacaoLote.js';
import GrupoBoletoExecucaoRepository from '../../repository/sispag/GrupoBoletoExecucaoRepository.js';
import GrupoBoletoRepository from '../../repository/sispag/GrupoBoletoRepository.js';

/** O grupo de boleto a que uma linha de retorno do item de borderô pertence. */
export interface GrupoCasado {
    grupoId: string;
    execucaoId: string;
    /** Os N títulos do grupo, da fonte local (a linha do retorno não os traz). */
    titulos: ChaveItemLote[];
}

/**
 * CasamentoRetornoGrupo — casa a linha de retorno do ITEM DE BORDERÊ com o grupo de boleto
 * (ADR-0077, I21r, I11i).
 *
 * Medido em HML (G4, 2026-10-20, gar 7): o `fin052` traz UMA linha (o J) por item de borderô, com
 * `filCod/bncCod/flpCod/itsCodSeq` + `borCod`, sem `docCod/titCod`, sem valor pago e sem
 * `borTimCad`. Como o ERP reutiliza `borCod`, o número sozinho não identifica o borderô: a linha
 * só casa quando o `borCod` (e o `itsCodSeq`, quando a execução o gravou) é o da execução do
 * grupo NESTE lote. Os N títulos vêm do grupo local; o pagamento de cada um é provado no
 * `fin064`, nunca pela linha.
 */
@injectable()
export default class CasamentoRetornoGrupo {
    public constructor(
        @inject(GrupoBoletoExecucaoRepository)
        private readonly execucoes: GrupoBoletoExecucaoRepository,
        @inject(GrupoBoletoRepository) private readonly grupos: GrupoBoletoRepository,
    ) {}

    public casar = async (p: {
        loteId: string;
        linha: ArquivoRetornoDetalhe;
    }): Promise<GrupoCasado | undefined> => {
        const { linha } = p;
        // Linha de título (com docCod) ou sem borderô nunca é de grupo.
        if (linha.docCod !== undefined || linha.borCod === undefined) return undefined;
        const execucoes = await this.execucoes.listarPorLote(p.loteId);
        const exec = execucoes.find(
            (e) =>
                e.borCod === linha.borCod &&
                (e.itsCodSeq === undefined ||
                    linha.itsCodSeq === undefined ||
                    e.itsCodSeq === linha.itsCodSeq),
        );
        if (!exec) return undefined;
        const grupo = await this.grupos.buscarPorId(exec.grupoId);
        if (!grupo || grupo.titulos.length === 0) return undefined;
        return {
            grupoId: exec.grupoId,
            execucaoId: exec.id,
            titulos: grupo.titulos.map((t) => ({
                filCod: t.filCod,
                docCod: t.docCod,
                titCod: t.titCod,
            })),
        };
    };
}
