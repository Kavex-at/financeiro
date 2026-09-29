import { inject, injectable } from 'tsyringe';
import {
    DESTINO_APROVACAO,
    type DestinoManualResumo,
    type ItemLote,
    type LotePagamento,
} from '../../interface/sispag/SispagInterface.js';
import DestinoAprovacaoRule from '../../libs/sispag/DestinoAprovacaoRule.js';
import MaskDestino from '../../libs/sispag/MaskDestino.js';

/** Item do lote como sai na API: sem o destino completo, só a máscara (I10h). */
export type ItemLoteApi = Omit<
    ItemLote,
    | 'destinoManual'
    | 'destinoManualAuditId'
    | 'destinoManualInformadoPor'
    | 'destinoManualInformadoEm'
    | 'destinoManualAprovadoPor'
    | 'destinoManualAprovadoEm'
> & {
    destinoManualResumo?: DestinoManualResumo;
};

export type LotePagamentoApi = Omit<LotePagamento, 'itens'> & { itens: ItemLoteApi[] };

/**
 * LotePagamentoApiView — a ÚNICA saída de lote para a API (ADR-0054 I10h).
 *
 * O repositório devolve o destino digitado COMPLETO porque o envio precisa dele. Nenhuma rota
 * devolve esse objeto cru: toda resposta com lote passa por aqui, que troca `destinoManual` por
 * `destinoManualResumo` (tipo + máscara + quem informou + estado da aprovação, D10) e descarta o
 * id da trilha. O CPF/CNPJ do titular sai MASCARADO: é o que o aprovador confere na tela.
 */
@injectable()
export default class LotePagamentoApiView {
    public constructor(
        @inject(MaskDestino) private readonly mask: MaskDestino,
        @inject(DestinoAprovacaoRule) private readonly aprovacao: DestinoAprovacaoRule,
    ) {}

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
            destinoManualAprovadoPor,
            destinoManualAprovadoEm,
            ...resto
        } = item;
        if (!destinoManual) return resto;
        const aprovacao = this.aprovacao.estado(item) ?? DESTINO_APROVACAO.NAO_EXIGIDA;
        return {
            ...resto,
            destinoManualResumo: {
                tipo: destinoManual.tipo,
                destinoMascarado: this.mask.destinoManual(destinoManual),
                titularDocumentoMascarado: this.mask.documento(destinoManual.titularDocumento),
                ...(destinoManualInformadoPor ? { informadoPor: destinoManualInformadoPor } : {}),
                ...(destinoManualInformadoEm ? { informadoEm: destinoManualInformadoEm } : {}),
                aprovacao,
                ...(aprovacao === DESTINO_APROVACAO.APROVADO && destinoManualAprovadoPor
                    ? { aprovadoPor: destinoManualAprovadoPor }
                    : {}),
                ...(aprovacao === DESTINO_APROVACAO.APROVADO && destinoManualAprovadoEm
                    ? { aprovadoEm: destinoManualAprovadoEm }
                    : {}),
            },
        };
    };
}
