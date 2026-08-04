import { injectable } from 'tsyringe';
import {
    decidirRotaHomologacao,
    NDE_TP_NF_SETS_DEFAULT,
} from '../../interface/recebimentos/HomologacaoNde.js';
import type { RotaHomologacao, TpNfSets } from '../../interface/recebimentos/HomologacaoNde.js';

/**
 * ContingenciaDecider — decide a rota de homologação de uma NDe com297 (contingência × normal) a
 * partir do `vldTpNf` do documento, no MOMENTO da emissão.
 *
 * Encapsula a decisão PURA `decidirRotaHomologacao` sobre os conjuntos default do módulo
 * (`NDE_TP_NF_SETS_DEFAULT`). É um `@injectable()` (não um `NotImplementedError` seam): a regra é
 * CONHECIDA — `["11","12"].indexOf(vldTpNf) !== -1` invertido p/ fail-loud. O único resíduo é o SEED
 * da allowlist normal (`NDE_NORMAL_TP_NF_CONHECIDOS`, hoje vazia) — uma questão de DADO, não de regra.
 * Ver `ontology/business-rules/homologacao-nde-com297.md`.
 */
@injectable()
export default class ContingenciaDecider {
    private readonly sets: TpNfSets = NDE_TP_NF_SETS_DEFAULT;

    /**
     * Decide a rota a partir do `vldTpNf` cru. Lança `VldTpNfAusenteError` (ausente) ou
     * `VldTpNfDesconhecidoError` (fora de {contingência ∪ normais-conhecidos}) — fail-loud.
     */
    public decidir = (vldTpNf: unknown): RotaHomologacao =>
        decidirRotaHomologacao(vldTpNf, this.sets);
}
