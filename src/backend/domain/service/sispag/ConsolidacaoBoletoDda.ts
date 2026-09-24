import { inject, injectable } from 'tsyringe';
import {
    BOLETO_DDA_SITUACAO,
    type BoletoDda,
    type BoletoDdaConsolidado,
    type BoletoDdaLoteRef,
    type BoletoDdaSituacao,
    type BoletoDdaTitulo,
} from '../../interface/sispag/BoletoDda.js';
import type { TituloAPagar } from '../../interface/sispag/SispagInterface.js';
import CodigoBarrasBoleto from '../../libs/boleto/CodigoBarrasBoleto.js';
import BankingCalendar from '../../libs/calendar/BankingCalendar.js';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Janela (dias, para mais ou para menos) entre o vencimento do boleto e o do título para o
 * título virar candidato. Os dois casos medidos em 2026-09-23 (PEDRONI 34697/1, ADP 5046/1)
 * tinham o boleto vencendo 1 dia DEPOIS do título — e o Conexos não casou nenhum dos dois.
 */
export const JANELA_CANDIDATO_DIAS = 3;

const chave = (t: { filCod: number; docCod: string; titCod: string }): string =>
    `${t.filCod}:${t.docCod}:${t.titCod}`;

const centavos = (valor: number): number => Math.round(valor * 100);

const diasEntre = (de: string, ate: string): number =>
    Math.round((Date.parse(`${ate}T00:00:00Z`) - Date.parse(`${de}T00:00:00Z`)) / DAY_MS);

export interface ConsolidacaoEntrada {
    boletos: BoletoDda[];
    /** Carteira ativa (`titulo_a_pagar`). Pagos são ignorados como candidatos. */
    titulos: TituloAPagar[];
    /** Títulos em lotes não cancelados, lote mais recente primeiro. */
    titulosEmLote: Array<{ filCod: number; docCod: string; titCod: string } & BoletoDdaLoteRef>;
}

/**
 * Consolida o pool `fin124` contra a carteira. PURA: nenhum I/O, nenhuma escrita.
 *
 * O candidato é SUGESTÃO para a analista, nunca vínculo: casar por valor não é confiável
 * (a PEDRONI tem ~18 boletos de R$ 1.412,00 no pool). Por isso a regra é estreita (valor exato
 * + vencimento na janela) e a ambiguidade é exposta como situação própria, não resolvida.
 */
@injectable()
export default class ConsolidacaoBoletoDda {
    public constructor(
        @inject(CodigoBarrasBoleto) private readonly codigoBarras: CodigoBarrasBoleto,
        @inject(BankingCalendar) private readonly calendar: BankingCalendar,
    ) {}

    public consolidar = (
        entrada: ConsolidacaoEntrada,
        janelaDias = JANELA_CANDIDATO_DIAS,
    ): BoletoDdaConsolidado[] => {
        const hoje = this.calendar.todayBrt();
        const porChave = new Map(entrada.titulos.map((t) => [chave(t), t]));
        const loteDe = new Map<string, BoletoDdaLoteRef>();
        for (const item of entrada.titulosEmLote) {
            // O primeiro visto é o mais recente (a query ordena por `criado_em DESC`).
            if (!loteDe.has(chave(item))) {
                loteDe.set(chave(item), { loteId: item.loteId, status: item.status });
            }
        }

        // Título que o Conexos já ligou a um boleto não é candidato de nenhum outro.
        const vinculados = new Set(
            entrada.boletos
                .filter((b) => b.filCod != null && b.docCod && b.titCod)
                .map((b) =>
                    chave({
                        filCod: Number(b.filCod),
                        docCod: String(b.docCod),
                        titCod: String(b.titCod),
                    }),
                ),
        );
        const abertosPorValor = new Map<number, TituloAPagar[]>();
        for (const t of entrada.titulos) {
            if (t.pago || vinculados.has(chave(t))) continue;
            const lista = abertosPorValor.get(centavos(t.valor)) ?? [];
            lista.push(t);
            abertosPorValor.set(centavos(t.valor), lista);
        }

        return entrada.boletos.map((b): BoletoDdaConsolidado => {
            const base = this.linhaBase(b, hoje);
            if (b.filCod != null && b.docCod && b.titCod) {
                const ref = { filCod: b.filCod, docCod: b.docCod, titCod: b.titCod };
                return {
                    ...base,
                    situacao: BOLETO_DDA_SITUACAO.VINCULADO,
                    vinculo: {
                        ...this.titulo(ref, b.vencimento, porChave.get(chave(ref)), loteDe),
                        ...(b.flpCod != null ? { flpCod: b.flpCod } : {}),
                    },
                    candidatos: [],
                };
            }
            const abertos = abertosPorValor.get(centavos(b.valor)) ?? [];
            const candidatos = this.candidatos(b.vencimento, abertos, loteDe, janelaDias);
            return { ...base, situacao: this.situacaoLivre(candidatos.length), candidatos };
        });
    };

    private linhaBase = (
        b: BoletoDda,
        hoje: string,
    ): Omit<BoletoDdaConsolidado, 'situacao' | 'candidatos' | 'vinculo'> => ({
        ddcCod: b.ddcCod,
        ditCod: b.ditCod,
        valor: b.valor,
        vencido: b.vencimento != null && b.vencimento < hoje,
        ...(b.arquivo ? { arquivo: b.arquivo } : {}),
        ...(b.importadoEm != null ? { importadoEm: b.importadoEm } : {}),
        ...(b.numero ? { numero: b.numero } : {}),
        ...(b.vencimento ? { vencimento: b.vencimento } : {}),
        ...(b.codbar ? { codbar: b.codbar } : {}),
        ...this.derivadosDoCodigo(b.codbar),
    });

    /** Títulos abertos de mesmo valor com vencimento na janela, do mais próximo ao mais distante. */
    private candidatos = (
        vencimentoBoleto: string | undefined,
        abertos: TituloAPagar[],
        loteDe: Map<string, BoletoDdaLoteRef>,
        janelaDias: number,
    ): BoletoDdaTitulo[] => {
        if (!vencimentoBoleto) return [];
        const distancia = (c: BoletoDdaTitulo): number => Math.abs(c.diferencaDias ?? Infinity);
        return abertos
            .map((t) => this.titulo(t, vencimentoBoleto, t, loteDe))
            .filter((c) => distancia(c) <= janelaDias)
            .sort((x, y) => distancia(x) - distancia(y));
    };

    private situacaoLivre = (quantos: number): BoletoDdaSituacao => {
        if (quantos === 0) return BOLETO_DDA_SITUACAO.SEM_TITULO;
        return quantos === 1 ? BOLETO_DDA_SITUACAO.CANDIDATO : BOLETO_DDA_SITUACAO.AMBIGUO;
    };

    private titulo = (
        ref: { filCod: number; docCod: string; titCod: string },
        vencimentoBoleto: string | undefined,
        carteira: TituloAPagar | undefined,
        loteDe: Map<string, BoletoDdaLoteRef>,
    ): BoletoDdaTitulo => {
        const vencimento =
            carteira?.vencimento != null
                ? this.calendar.fromErpEpoch(carteira.vencimento)
                : undefined;
        const lote = loteDe.get(chave(ref));
        return {
            filCod: ref.filCod,
            docCod: ref.docCod,
            titCod: ref.titCod,
            ...(carteira?.credor ? { credor: carteira.credor } : {}),
            ...(carteira
                ? { valor: carteira.valor, temBoletoDda: carteira.temBoleto === true }
                : {}),
            ...(vencimento ? { vencimento } : {}),
            ...(vencimento && vencimentoBoleto
                ? { diferencaDias: diasEntre(vencimento, vencimentoBoleto) }
                : {}),
            ...(lote ? { lote } : {}),
        };
    };

    private derivadosDoCodigo = (
        codbar?: string,
    ): { linhaDigitavel?: string; bancoEmissor?: string } => {
        const linhaDigitavel = this.codigoBarras.paraLinhaDigitavel(codbar);
        const bancoEmissor = this.codigoBarras.bancoEmissor(codbar);
        return {
            ...(linhaDigitavel ? { linhaDigitavel } : {}),
            ...(bancoEmissor ? { bancoEmissor } : {}),
        };
    };
}
