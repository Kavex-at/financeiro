import { inject, injectable } from 'tsyringe';
import { MODALIDADE, type Modalidade } from '../../interface/sispag/SispagInterface.js';
import AjusteCentavosExecucaoRepository from '../../repository/sispag/AjusteCentavosExecucaoRepository.js';
import SugestaoBoletoRepository from '../../repository/sispag/SugestaoBoletoRepository.js';

/** Chave natural do título + o "tem DDA?" da carteira persistida. */
export interface TituloParaPreSelecao {
    filCod: number;
    docCod: string;
    titCod: string;
    temBoleto?: boolean;
}

/** O que o item herda ao entrar no lote. Campo ausente = o chamador usa o seu default. */
export interface PreSelecaoItem {
    modalidade?: Modalidade;
    /** Líquido do ledger do ajuste de centavos, em reais (I18j(5)). */
    valor?: number;
}

/**
 * PreSelecaoItemLote — a forma de pagamento e o valor com que um título ENTRA num lote, iguais na
 * inclusão manual (`LotePagamentoService`) e na formação automática (`FormacaoLotesService`).
 *
 * Modalidade (A2): BOLETO quando o ERP tem um DDA casado com o título OU quando a analista
 * confirmou o boleto no app (decisão `CONFIRMADA` com par `VIGENTE`, o critério do vínculo do
 * código de barras, I17a); senão "a definir". É só um default de tela: ela pode trocar, e quem
 * barra boleto sem código de barras é o envio (`BoletoSemCodigoBarrasError`).
 *
 * Valor (I18j(5)): título renegociado pelo ajuste de centavos entra com o líquido do ledger, o
 * mesmo que a troca em rascunho grava. O `titMnyValor` do título novo é o valor base, um centavo
 * abaixo do boleto.
 */
@injectable()
export default class PreSelecaoItemLote {
    public constructor(
        @inject(SugestaoBoletoRepository) private readonly sugestoes: SugestaoBoletoRepository,
        @inject(AjusteCentavosExecucaoRepository)
        private readonly ajustes: AjusteCentavosExecucaoRepository,
    ) {}

    public static modalidadeInicial = (p: {
        temBoletoDda: boolean;
        boletoConfirmado: boolean;
    }): Modalidade | undefined =>
        p.temBoletoDda || p.boletoConfirmado ? MODALIDADE.BOLETO : undefined;

    /** Uma consulta por fonte para todos os títulos. Chave `filCod:docCod:titCod`. */
    public resolver = async (
        titulos: readonly TituloParaPreSelecao[],
    ): Promise<Map<string, PreSelecaoItem>> => {
        const resultado = new Map<string, PreSelecaoItem>();
        if (titulos.length === 0) return resultado;
        const chaves = titulos.map(({ filCod, docCod, titCod }) => ({ filCod, docCod, titCod }));
        const [confirmados, liquidos] = await Promise.all([
            this.sugestoes.chavesComConfirmacaoVigente(chaves),
            this.ajustes.liquidosDeTitulosRenegociados(chaves),
        ]);
        for (const t of titulos) {
            const chave = `${t.filCod}:${t.docCod}:${t.titCod}`;
            const modalidade = PreSelecaoItemLote.modalidadeInicial({
                temBoletoDda: t.temBoleto === true,
                boletoConfirmado: confirmados.has(chave),
            });
            const centavos = liquidos.get(chave);
            resultado.set(chave, {
                ...(modalidade ? { modalidade } : {}),
                ...(centavos !== undefined ? { valor: centavos / 100 } : {}),
            });
        }
        return resultado;
    };
}
