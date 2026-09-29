import { inject, injectable } from 'tsyringe';
import type {
    DestinoManualResumo,
    ItemLote,
    LotePagamento,
} from '../../interface/sispag/SispagInterface.js';
import MaskDestino from '../../libs/sispag/MaskDestino.js';

/** Item do lote como sai na API: sem o destino completo, só a máscara (I10h). */
export type ItemLoteApi = Omit<ItemLote, 'destinoManual' | 'destinoManualAuditId'> & {
    destinoManualResumo?: DestinoManualResumo;
};

export type LotePagamentoApi = Omit<LotePagamento, 'itens'> & { itens: ItemLoteApi[] };

/**
 * LotePagamentoApiView — a ÚNICA saída de lote para a API (ADR-0054 I10h).
 *
 * O repositório devolve o destino digitado COMPLETO porque o envio precisa dele. Nenhuma rota
 * devolve esse objeto cru: toda resposta com lote passa por aqui, que troca `destinoManual` por
 * `destinoManualResumo` (tipo + máscara + quem informou) e descarta o id da trilha.
 */
@injectable()
export default class LotePagamentoApiView {
    public constructor(@inject(MaskDestino) private readonly mask: MaskDestino) {}

    public lote = (lote: LotePagamento): LotePagamentoApi => ({
        ...lote,
        itens: lote.itens.map(this.item),
    });

    public lotes = (lotes: LotePagamento[]): LotePagamentoApi[] => lotes.map(this.lote);

    private item = (item: ItemLote): ItemLoteApi => {
        const {
            destinoManual,
            destinoManualAuditId: _auditId,
            destinoManualInformadoPor,
            destinoManualInformadoEm,
            ...resto
        } = item;
        if (!destinoManual) return resto;
        return {
            ...resto,
            destinoManualResumo: {
                tipo: destinoManual.tipo,
                destinoMascarado: this.mask.destinoManual(destinoManual),
                ...(destinoManualInformadoPor ? { informadoPor: destinoManualInformadoPor } : {}),
                ...(destinoManualInformadoEm ? { informadoEm: destinoManualInformadoEm } : {}),
            },
        };
    };
}
