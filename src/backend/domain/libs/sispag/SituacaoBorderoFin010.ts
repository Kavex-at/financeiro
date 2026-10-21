import { SITUACAO_BORDERO, type SituacaoBordero } from '../../interface/permutas/Fin010Baixa.js';

/**
 * Situação de um borderô do `fin010` a partir do cabeçalho lido (ADR-0076; achados HML T9,
 * 2026-10-21). Medido em 269 borderôs das filiais 1 e 2 do HML:
 *
 * | `borVldFinalizado` | `borCodNovo` | situação |
 * |---|---|---|
 * | 0 | nulo | em cadastro (pode ter `borCodEstornado`: nasceu do estorno de outro) |
 * | 1 | nulo | finalizado |
 * | 2 | nulo | cancelado (com `borDtaStatus`, `usnCodSta` e lote contábil de estorno) |
 * | 3 | preenchido | estornado: as baixas foram para o borderô `borCodNovo` |
 *
 * Qualquer outra combinação (valor ausente, desconhecido, `borCodNovo` fora do 3) é
 * `INDETERMINADO`: quem decide não age sobre ela (fail-closed). O estornado **não** é "resolvido":
 * as baixas do grupo seguem vivas no borderô novo, e criar outro pagaria duas vezes.
 */
export default class SituacaoBorderoFin010 {
    public static classificar = (cabecalho: {
        borVldFinalizado?: number | null;
        borCodNovo?: number | null;
    }): SituacaoBordero => {
        const novo = cabecalho.borCodNovo !== undefined && cabecalho.borCodNovo !== null;
        switch (cabecalho.borVldFinalizado) {
            case 0:
                return novo ? SITUACAO_BORDERO.INDETERMINADO : SITUACAO_BORDERO.EM_CADASTRO;
            case 1:
                return novo ? SITUACAO_BORDERO.INDETERMINADO : SITUACAO_BORDERO.FINALIZADO;
            case 2:
                return novo ? SITUACAO_BORDERO.INDETERMINADO : SITUACAO_BORDERO.CANCELADO;
            case 3:
                return novo ? SITUACAO_BORDERO.ESTORNADO : SITUACAO_BORDERO.INDETERMINADO;
            default:
                return SITUACAO_BORDERO.INDETERMINADO;
        }
    };
}
