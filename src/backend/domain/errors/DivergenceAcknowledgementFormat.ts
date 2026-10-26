/** Formatação das mensagens ao operador dos erros de reconhecimento de divergência. */
export default class DivergenceAcknowledgementFormat {
    /** `YYYY-MM-DD` → `DD/MM/YYYY`; qualquer outra coisa passa como veio. */
    public static formatarData = (civil: string): string => {
        const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(civil);
        return m ? `${m[3]}/${m[2]}/${m[1]}` : civil;
    };

    /** Centavos → `R$ 1.028,80`. */
    public static formatarCentavos = (centavos: number): string => {
        const reais = Math.trunc(Math.abs(centavos) / 100);
        const cents = String(Math.abs(centavos) % 100).padStart(2, '0');
        const milhar = String(reais).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
        return `${centavos < 0 ? '-' : ''}R$ ${milhar},${cents}`;
    };

    /** Δ com sinal: `+7 dias`, `-1 dia`. */
    public static formatarDelta = (dias: number): string => {
        const abs = Math.abs(dias);
        return `${dias > 0 ? '+' : dias < 0 ? '-' : ''}${abs} ${abs === 1 ? 'dia' : 'dias'}`;
    };
}
