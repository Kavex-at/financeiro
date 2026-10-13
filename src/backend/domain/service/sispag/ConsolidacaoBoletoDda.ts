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
import { RESULTADO_SUGESTAO } from '../../interface/sispag/SugestaoBoleto.js';
import CodigoBarrasBoleto from '../../libs/boleto/CodigoBarrasBoleto.js';
import BankingCalendar from '../../libs/calendar/BankingCalendar.js';
import RegraSugestaoBoleto, {
    ENVELOPE_VALOR_ABSOLUTO,
    ENVELOPE_VALOR_PERCENTUAL,
    LIMITE_VALOR_MESMO_DIA,
} from './RegraSugestaoBoleto.js';

/** Quantos títulos "só informativos" (vencido / ATENCAO) cada boleto carrega, no máximo. */
const MAX_INFORMATIVOS = 5;

const chave = (t: { filCod: number; docCod: string; titCod: string }): string =>
    `${t.filCod}:${t.docCod}:${t.titCod}`;

const centavos = (valor: number): number => Math.round(valor * 100);

export interface ConsolidacaoEntrada {
    boletos: BoletoDda[];
    /** Carteira ativa (`titulo_a_pagar`). Pagos são ignorados como candidatos. */
    titulos: TituloAPagar[];
    /**
     * Títulos em lotes não cancelados, lote mais recente primeiro. `dataDebito` (data civil) é a do
     * lote quando conhecida (I8); sem ela, a data de débito é o vencimento do título (Q-C).
     */
    titulosEmLote: Array<
        { filCod: number; docCod: string; titCod: string; dataDebito?: string } & BoletoDdaLoteRef
    >;
}

/** Título aberto da carteira com o que a regra precisa, pré-computado uma vez por consolidação. */
interface TituloAberto {
    titulo: TituloAPagar;
    centavos: number;
    vencimento: string;
}

/**
 * Consolida o pool `fin124` contra a carteira. PURA: nenhum I/O, nenhuma escrita.
 *
 * O candidato é SUGESTÃO para a analista, nunca vínculo: casar por valor não é confiável
 * (a PEDRONI tem ~18 boletos de R$ 1.412,00 no pool). A regra de candidato é a **regra em camadas**
 * (`RegraSugestaoBoleto`, ADR-0068/I15c), que SUBSTITUI a antiga "valor exato + ±3 dias":
 *
 *  - candidato (`candidatos`) = dentro dos limites seguros: |Δvalor| ≤ R$ 0,05 no mesmo dia, ou
 *    valor igual com o boleto vencendo de 1 a 5 dias DEPOIS e não antes da data de débito;
 *  - boleto que vence ANTES do título (data de débito) deixou de ser "seguro": vira só informativo
 *    (`informativos`), com `diferencaDias` negativo à vista, e não conta para a situação.
 *
 * A ambiguidade (2+ títulos concorrendo pelo mesmo boleto) é exposta como situação própria; a
 * disputa I15e (menor vencimento ganha) só existe no motor de sugestão por título.
 */
@injectable()
export default class ConsolidacaoBoletoDda {
    public constructor(
        @inject(CodigoBarrasBoleto) private readonly codigoBarras: CodigoBarrasBoleto,
        @inject(BankingCalendar) private readonly calendar: BankingCalendar,
        @inject(RegraSugestaoBoleto) private readonly regra: RegraSugestaoBoleto,
    ) {}

    public consolidar = (entrada: ConsolidacaoEntrada): BoletoDdaConsolidado[] => {
        const hoje = this.calendar.todayBrt();
        const porChave = new Map(entrada.titulos.map((t) => [chave(t), t]));
        const loteDe = new Map<string, BoletoDdaLoteRef>();
        const debitoDe = new Map<string, string>();
        for (const item of entrada.titulosEmLote) {
            // O primeiro visto é o mais recente (a query ordena por `criado_em DESC`).
            if (!loteDe.has(chave(item))) {
                loteDe.set(chave(item), { loteId: item.loteId, status: item.status });
                if (item.dataDebito) debitoDe.set(chave(item), item.dataDebito);
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
        const abertos = this.indexarAbertos(entrada.titulos, vinculados);

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
            const { candidatos, informativos } = this.avaliar(b, abertos, loteDe, debitoDe);
            return {
                ...base,
                situacao: this.situacaoLivre(candidatos.length),
                candidatos,
                ...(informativos.length > 0 ? { informativos } : {}),
            };
        });
    };

    /** Abertos ordenados por valor em centavos — a busca por faixa evita O(boletos × títulos). */
    private indexarAbertos = (titulos: TituloAPagar[], vinculados: Set<string>): TituloAberto[] =>
        titulos
            .filter((t) => !t.pago && !vinculados.has(chave(t)) && t.vencimento != null)
            .map((t) => ({
                titulo: t,
                centavos: centavos(t.valor),
                vencimento: this.calendar.fromErpEpoch(Number(t.vencimento)),
            }))
            .sort((x, y) => x.centavos - y.centavos);

    /** Faixa de valor em que a regra pode devolver algo; a regra decide o resto. */
    private faixa = (valorCentavos: number): [number, number] => {
        const absoluto = centavos(ENVELOPE_VALOR_ABSOLUTO);
        const pct = ENVELOPE_VALOR_PERCENTUAL / 100;
        return [
            Math.floor(Math.min(valorCentavos - absoluto, valorCentavos / (1 + pct))),
            Math.ceil(Math.max(valorCentavos + absoluto, valorCentavos / (1 - pct))),
        ];
    };

    private primeiroNaFaixa = (abertos: TituloAberto[], minimo: number): number => {
        let lo = 0;
        let hi = abertos.length;
        while (lo < hi) {
            const meio = (lo + hi) >>> 1;
            if ((abertos[meio]?.centavos ?? 0) < minimo) lo = meio + 1;
            else hi = meio;
        }
        return lo;
    };

    private avaliar = (
        b: BoletoDda,
        abertos: TituloAberto[],
        loteDe: Map<string, BoletoDdaLoteRef>,
        debitoDe: Map<string, string>,
    ): { candidatos: BoletoDdaTitulo[]; informativos: BoletoDdaTitulo[] } => {
        const candidatos: BoletoDdaTitulo[] = [];
        const informativos: BoletoDdaTitulo[] = [];
        if (!b.vencimento) return { candidatos, informativos };
        const valor = centavos(b.valor);
        const [minimo, maximo] = this.faixa(valor);
        for (let i = this.primeiroNaFaixa(abertos, minimo); i < abertos.length; i += 1) {
            const aberto = abertos[i];
            if (!aberto || aberto.centavos > maximo) break;
            const { titulo } = aberto;
            const avaliacao = this.regra.avaliar({
                titulo: {
                    valor: titulo.valor,
                    vencimento: aberto.vencimento,
                    ...(titulo.numeroDocumento ? { numeroDocumento: titulo.numeroDocumento } : {}),
                },
                boleto: {
                    valor: b.valor,
                    vencimento: b.vencimento,
                    ...(b.numero ? { numero: b.numero } : {}),
                },
                dataDebito: debitoDe.get(chave(titulo)) ?? aberto.vencimento,
                parConfirmado: false,
            });
            const linha: BoletoDdaTitulo = {
                ...this.titulo(titulo, b.vencimento, titulo, loteDe),
                tier: this.tierDe(avaliacao.resultado),
                deltaValor: avaliacao.deltaValor,
            };
            if (avaliacao.resultado === RESULTADO_SUGESTAO.FORTE) candidatos.push(linha);
            else if (this.informativo(avaliacao.resultado, avaliacao.deltaValor)) {
                informativos.push(linha);
            }
        }
        const distancia = (c: BoletoDdaTitulo): number => Math.abs(c.diferencaDias ?? Infinity);
        const porProximidade = (x: BoletoDdaTitulo, y: BoletoDdaTitulo): number =>
            distancia(x) - distancia(y) || x.docCod.localeCompare(y.docCod);
        return {
            candidatos: candidatos.sort(porProximidade),
            informativos: informativos.sort(porProximidade).slice(0, MAX_INFORMATIVOS),
        };
    };

    /**
     * Mostra só o que tem valor praticamente igual (|Δ| ≤ R$ 0,05) mas data fora do limite seguro —
     * é o caso que o analista confundiria com candidato. ATENCAO com valor longe fica para o motor.
     */
    private informativo = (resultado: string, deltaValor: number): boolean =>
        (resultado === RESULTADO_SUGESTAO.VENCIDO_INFORMATIVO ||
            resultado === RESULTADO_SUGESTAO.ATENCAO) &&
        Math.abs(deltaValor) <= LIMITE_VALOR_MESMO_DIA;

    private tierDe = (resultado: string): BoletoDdaTitulo['tier'] => {
        if (resultado === RESULTADO_SUGESTAO.VENCIDO_INFORMATIVO) return resultado;
        if (resultado === RESULTADO_SUGESTAO.FORTE || resultado === RESULTADO_SUGESTAO.ATENCAO) {
            return resultado;
        }
        return undefined;
    };

    private linhaBase = (
        b: BoletoDda,
        hoje: string,
    ): Omit<BoletoDdaConsolidado, 'situacao' | 'candidatos' | 'vinculo' | 'informativos'> => ({
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
                ? { diferencaDias: this.diasEntre(vencimento, vencimentoBoleto) }
                : {}),
            ...(lote ? { lote } : {}),
        };
    };

    private diasEntre = (de: string, ate: string): number =>
        Math.round((Date.parse(`${ate}T00:00:00Z`) - Date.parse(`${de}T00:00:00Z`)) / 86_400_000);

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
