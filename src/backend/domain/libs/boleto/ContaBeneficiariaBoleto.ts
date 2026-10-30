import { injectable } from 'tsyringe';

const BARRAS_BANCARIAS = /^\d{44}$/;

/** Extrai a chave da conta do beneficiário das barras (44 dígitos, `substr` 1-based → `slice`). */
type LayoutConta = (barras: string) => string | undefined;

/** `slice` 1-based inclusivo: `trecho(c, 20, 4)` = `substr(c, 20, 4)` do SQL. */
const trecho = (barras: string, inicio: number, tamanho: number): string =>
    barras.slice(inicio - 1, inicio - 1 + tamanho);

/**
 * Um layout por banco emissor (3 primeiros dígitos). Acrescentar um banco é acrescentar uma linha
 * aqui + o teste com barras reais; nada mais no sistema muda. Só entra layout VALIDADO contra
 * pares boleto × título reais — banco fora da tabela não tem chave (e a aba não adivinha).
 */
const LAYOUTS: Readonly<Record<string, LayoutConta>> = {
    // Bradesco: agência(4) em 20–23, conta(7) em 37–43.
    '237': (c) => `237:${trecho(c, 20, 4)}/${trecho(c, 37, 7)}`,
    // Itaú: agência(4) em 32–35, conta(5) em 36–40.
    '341': (c) => `341:${trecho(c, 32, 4)}/${trecho(c, 36, 5)}`,
    // Santander: código do beneficiário(7) em 21–27.
    '033': (c) => `033:${trecho(c, 21, 7)}`,
    // Banco do Brasil: convênio de 6 dígitos em 20–25; com 6 zeros ali, o convênio de 7 vem em 26–32.
    '001': (c) =>
        trecho(c, 20, 6) === '000000' ? `001:${trecho(c, 26, 7)}` : `001:${trecho(c, 20, 6)}`,
    // Sicredi: cooperativa(4) + posto(2) + beneficiário(5) em 31–41.
    '748': (c) => `748:${trecho(c, 31, 11)}`,
    // Safra: agência(5) + conta(9) em 21–34, depois do dígito de sistema (7) em 20.
    '422': (c) => `422:${trecho(c, 21, 14)}`,
    // Citibank: conta cosmos(9) em 24–32.
    '745': (c) => `745:${trecho(c, 24, 9)}`,
    // Caixa (SIGCB): código do beneficiário(6) em 20–25.
    '104': (c) => `104:${trecho(c, 20, 6)}`,
    // Ailos: convênio(6) + conta(8) em 20–33.
    '085': (c) => `085:${trecho(c, 20, 14)}`,
    // Sicoob: agência(4) em 21–24, código do cliente(7) em 27–33.
    '756': (c) => `756:${trecho(c, 21, 4)}/${trecho(c, 27, 7)}`,
};

/**
 * Conta do beneficiário (quem RECEBE) codificada no campo livre das barras do boleto bancário.
 *
 * O `fin124` não diz de quem é o boleto; a conta de destino, para os bancos grandes, está nas
 * barras e identifica o fornecedor de forma estável (ADR-0081). A chave é só um agrupador: o nome
 * vem do aprendizado (`ConsolidacaoFornecedorConta`), nunca daqui. Pura; nunca lança.
 *
 * Distinta de `CodigoBarrasBoleto.emissor` (ADR-0068), que serve à confirmação por par
 * credor × emissor e cai numa chave genérica; aqui banco sem layout validado devolve `undefined`.
 */
@injectable()
export default class ContaBeneficiariaBoleto {
    /** Chave `<banco>:<agência>/<conta>` (ou código do beneficiário/convênio); `undefined` se não houver layout. */
    public chave = (codbar?: string): string | undefined => {
        const barras = (codbar ?? '').trim();
        if (!BARRAS_BANCARIAS.test(barras) || barras.startsWith('8')) return undefined;
        return LAYOUTS[barras.slice(0, 3)]?.(barras);
    };
}
