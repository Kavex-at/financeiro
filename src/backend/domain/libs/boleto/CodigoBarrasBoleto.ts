import { injectable } from 'tsyringe';

const SO_DIGITOS = /^\d+$/;

/**
 * Código de barras de boleto BANCÁRIO (44 dígitos, layout FEBRABAN):
 *
 *     BBB M D FFFF VVVVVVVVVV LLLLLLLLLLLLLLLLLLLLLLLLL
 *     banco(3) moeda(1) DV geral(1) fator venc.(4) valor(10) campo livre(25)
 *
 * O `fin124` guarda as barras (44). Quem paga à mão cola a LINHA DIGITÁVEL (47), então a aba de
 * boletos mostra as duas. A conversão é determinística: os campos 1–3 são pedaços das barras com
 * um DV módulo 10 cada, o campo 4 é o DV geral e o campo 5 é fator + valor.
 *
 * Arrecadação/concessionária (barras começando com 8) tem outro layout e não entra no DDA — cai
 * fora (`undefined`), em vez de devolver uma linha errada.
 */
@injectable()
export default class CodigoBarrasBoleto {
    /** 44 → 47 dígitos. `undefined` se não for um código de boleto bancário válido. */
    public paraLinhaDigitavel = (codbar?: string): string | undefined => {
        const barras = this.normalizar(codbar);
        if (!barras) return undefined;
        const livre = barras.slice(19, 44);
        const campo1 = barras.slice(0, 4) + livre.slice(0, 5);
        const campo2 = livre.slice(5, 15);
        const campo3 = livre.slice(15, 25);
        return (
            campo1 +
            this.modulo10(campo1) +
            campo2 +
            this.modulo10(campo2) +
            campo3 +
            this.modulo10(campo3) +
            barras.slice(4, 5) +
            barras.slice(5, 19)
        );
    };

    /** Código FEBRABAN do banco emissor (ex.: `341` Itaú). */
    public bancoEmissor = (codbar?: string): string | undefined =>
        this.normalizar(codbar)?.slice(0, 3);

    private normalizar = (codbar?: string): string | undefined => {
        const barras = (codbar ?? '').trim();
        if (barras.length !== 44 || !SO_DIGITOS.test(barras) || barras.startsWith('8')) {
            return undefined;
        }
        return barras;
    };

    /** DV módulo 10: pesos 2,1,2,1… da direita para a esquerda, somando os dígitos do produto. */
    private modulo10 = (campo: string): string => {
        let soma = 0;
        let peso = 2;
        for (let i = campo.length - 1; i >= 0; i -= 1) {
            const produto = Number(campo[i]) * peso;
            soma += produto > 9 ? produto - 9 : produto;
            peso = peso === 2 ? 1 : 2;
        }
        return String((10 - (soma % 10)) % 10);
    };
}
