import {
    MOTIVO_GRUPO_INELEGIVEL_TEXTO,
    type MotivoGrupoInelegivel,
} from '../interface/sispag/GrupoBoletoInterface.js';

/**
 * Formatação compartilhada pelos erros do boleto agrupado (I19, ADR-0076): valores em reais, datas
 * civis, listas de títulos e a máscara 5+4 defensiva (I16e/I17j) — só a máscara sai, mesmo que
 * alguém passe o código inteiro.
 */
export default class GroupedBoletoErrorFormat {
    public static reais = (centavos: number): string =>
        `R$ ${(centavos / 100).toLocaleString('pt-BR', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
        })}`;

    public static mascarar = (v: string): string => {
        const d = v.replace(/\D/g, '');
        return d.length >= 10 ? `${d.slice(0, 5)}…${d.slice(-4)}` : v;
    };

    /** `YYYY-MM-DD` → `DD/MM/YYYY`; qualquer outra coisa passa como veio. */
    public static data = (civil: string): string => {
        const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(civil);
        return m ? `${m[3]}/${m[2]}/${m[1]}` : civil;
    };

    /** `a`, `a e b`, `a, b e c`. */
    public static lista = (itens: readonly string[]): string =>
        itens.length <= 1
            ? (itens[0] ?? '')
            : `${itens.slice(0, -1).join(', ')} e ${itens[itens.length - 1]}`;

    public static titulo = (t: { docCod: string; titCod: string }): string =>
        `${t.docCod}/${t.titCod}`;

    public static motivo = (m: MotivoGrupoInelegivel | string): string =>
        MOTIVO_GRUPO_INELEGIVEL_TEXTO[m as MotivoGrupoInelegivel] ?? m;
}
