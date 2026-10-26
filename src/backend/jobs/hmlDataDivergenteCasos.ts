import type BankingCalendar from '../domain/libs/calendar/BankingCalendar.js';

/**
 * Montagem PURA dos casos dos probes de HML do vínculo com data divergente (ADR-0078, T0.1/T0.2).
 * Sem rede, sem relógio próprio (a data vem do `BankingCalendar`) e sem ler o ERP: o que cada
 * probe ESCREVE é decidido aqui e pode ser listado com `--dry`.
 */

export interface CasoV10 {
    id: string;
    /** boleto − título, em dias. */
    delta: number;
    tituloVenc: string;
    barraVenc: string;
}

export interface ItemPlanejado {
    id: string;
    barraVenc: string;
    nota: string;
}

export interface LotePlanejado {
    id: string;
    debito: string;
    itens: ItemPlanejado[];
    /** Só o lote da medição do J gera `.REM` no ERP de HML; os demais param no `finalizar`. */
    gerarRemessa: boolean;
    pergunta: string;
}

export type FonteDaData = 'titulo' | 'barra' | 'item' | 'debito' | 'outra';

export default class HmlDataDivergenteCasos {
    public static readonly DELTAS_V10 = [-5, -2, -1, 0, 6, 10];

    /** Sábado estritamente depois de `civil` (o dia que testa a rolagem de fim de semana). */
    private static readonly proximoSabado = (calendar: BankingCalendar, civil: string): string => {
        let dia = calendar.addDays(civil, 1);
        while (new Date(`${dia}T00:00:00Z`).getUTCDay() !== 6) dia = calendar.addDays(dia, 1);
        return dia;
    };

    /** V10: uma barra sintética por Δ, contra um vencimento de título FICTÍCIO (nada é lido do ERP). */
    public static readonly casosV10 = (calendar: BankingCalendar, hoje: string): CasoV10[] => {
        const tituloVenc = calendar.addDays(hoje, 20);
        return HmlDataDivergenteCasos.DELTAS_V10.map((delta) => ({
            id: `V10${delta < 0 ? 'm' : 'p'}${Math.abs(delta)}`,
            delta,
            tituloVenc,
            barraVenc: calendar.addDays(tituloVenc, delta),
        }));
    };

    /** V11 + V12: três lotes de rascunho, cada um respondendo a UMA pergunta sobre o ERP. */
    public static readonly lotes = (calendar: BankingCalendar, hoje: string): LotePlanejado[] => {
        const util = (civil: string): string =>
            calendar.isBusinessDay(civil) ? civil : calendar.nextBusinessDay(civil);
        const debitoJ = util(calendar.addDays(hoje, 1));
        const barraJ1 = util(calendar.addDays(debitoJ, 2));
        const barraJ2 = util(calendar.addDays(debitoJ, 7));
        const debitoR2 = util(calendar.addDays(hoje, 5));
        const barraR2 = util(calendar.addDays(hoje, 2));
        const sabado = HmlDataDivergenteCasos.proximoSabado(calendar, calendar.addDays(hoje, 3));
        const segunda = calendar.nextBusinessDay(sabado);
        return [
            {
                id: 'L-J',
                debito: debitoJ,
                gerarRemessa: true,
                pergunta:
                    'V12: o segmento J do .REM leva a data do TÍTULO (vencido há meses em HML) ou a da BARRA?',
                itens: [
                    { id: 'J1', barraVenc: barraJ1, nota: 'barra = débito + 2 dias' },
                    { id: 'J2', barraVenc: barraJ2, nota: 'barra = débito + 7 dias' },
                ],
            },
            {
                id: 'L-R2',
                debito: debitoR2,
                gerarRemessa: false,
                pergunta:
                    'V11/R2: o finalizar recusa quando dataDebito > itsDtaPgto (barra antes do débito)?',
                itens: [{ id: 'R2', barraVenc: barraR2, nota: 'barra < débito' }],
            },
            {
                id: 'L-ROLAGEM',
                debito: segunda,
                gerarRemessa: false,
                pergunta:
                    'V11/R8: barra de sábado com débito na segunda: o ERP compara rolada (aceita) ou não (recusa)?',
                itens: [{ id: 'SAB', barraVenc: sabado, nota: 'barra em sábado' }],
            },
        ];
    };

    /** De onde veio uma data observada: compara com cada referência, na ordem de precedência. */
    public static readonly fonteDaData = (
        observada: string,
        ref: { titulo: string; barra: string; item?: string; debito?: string },
    ): FonteDaData => {
        if (observada === ref.barra) return 'barra';
        if (observada === ref.titulo) return 'titulo';
        if (ref.item !== undefined && observada === ref.item) return 'item';
        if (ref.debito !== undefined && observada === ref.debito) return 'debito';
        return 'outra';
    };

    /** Códigos de barras só saem mascarados (5 primeiros + 4 últimos dígitos). */
    public static readonly mascarar = (valor: unknown): string => {
        const t = String(valor ?? '').replace(/\D/g, '');
        return t.length >= 44 ? `${t.slice(0, 5)}…${t.slice(-4)}` : t === '' ? '' : '(curto)';
    };
}
