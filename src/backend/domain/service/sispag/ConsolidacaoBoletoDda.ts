import { inject, injectable } from 'tsyringe';
import {
    BOLETO_DDA_SITUACAO,
    type BoletoDda,
    type BoletoDdaConsolidado,
    type BoletoDdaLoteRef,
    type BoletoDdaSituacao,
    type BoletoDdaTitulo,
} from '../../interface/sispag/BoletoDda.js';
import {
    JANELA_CARTEIRA_DIAS_ADIANTE,
    JANELA_CARTEIRA_DIAS_ATRAS,
} from '../../libs/calendar/JanelaCarteira.js';
import type { TituloAPagar } from '../../interface/sispag/SispagInterface.js';
import { RESULTADO_SUGESTAO } from '../../interface/sispag/SugestaoBoleto.js';
import CodigoBarrasBoleto from '../../libs/boleto/CodigoBarrasBoleto.js';
import BankingCalendar from '../../libs/calendar/BankingCalendar.js';
import RegraSugestaoBoleto, {
    faixaDeCandidatos,
    LIMITE_VALOR_MESMO_DIA,
} from './RegraSugestaoBoleto.js';

/** Quantos títulos "só informativos" (vencido / ATENCAO) cada boleto carrega, no máximo. */
const MAX_INFORMATIVOS = 5;

const chave = (t: { filCod: number; docCod: string; titCod: string }): string =>
    `${t.filCod}:${t.docCod}:${t.titCod}`;

/** Título que saiu da carteira "casa" com o boleto dentro de R$ 0,05 e de 10 dias (em qualquer sentido). */
const LIMITE_VALOR_SAIDO_CENTAVOS = 5;
export const LIMITE_DIAS_SAIDO = 10;

const centavos = (valor: number): number => Math.round(valor * 100);

export interface ConsolidacaoEntrada {
    boletos: BoletoDda[];
    /** Carteira ativa (`titulo_a_pagar`). Pagos são ignorados como candidatos. */
    titulos: TituloAPagar[];
    /**
     * Títulos INATIVOS recentes (`ativo = false`): saíram do fin064 — em regra quitados, mas
     * também cancelados, previsão ou renegociados. Só alimentam `TITULO_SAIU_CARTEIRA`.
     */
    titulosSaidos?: TituloAPagar[];
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
        const janela = {
            de: this.calendar.addDays(hoje, -JANELA_CARTEIRA_DIAS_ATRAS),
            ate: this.calendar.addDays(hoje, JANELA_CARTEIRA_DIAS_ADIANTE),
        };
        const { boletos, copiasDe } = this.colapsarCopias(entrada.boletos);
        const saidos = this.indexarSaidos(entrada.titulosSaidos ?? []);
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
            boletos
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

        return boletos.map((b): BoletoDdaConsolidado => {
            const base = this.linhaBase(b, hoje, copiasDe.get(b) ?? []);
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
            return {
                ...base,
                ...this.situacaoDoLivre(b, { abertos, saidos, janela, loteDe, debitoDe }),
            };
        });
    };

    /** Situação e evidências de um boleto livre (sem vínculo do Conexos). */
    private situacaoDoLivre = (
        b: BoletoDda,
        ctx: {
            abertos: TituloAberto[];
            saidos: TituloAberto[];
            janela: { de: string; ate: string };
            loteDe: Map<string, BoletoDdaLoteRef>;
            debitoDe: Map<string, string>;
        },
    ): Pick<BoletoDdaConsolidado, 'situacao' | 'candidatos' | 'informativos' | 'titulosSaidos'> => {
        const { candidatos, informativos } = this.avaliar(b, ctx.abertos, ctx.loteDe, ctx.debitoDe);
        const foraJanela =
            b.vencimento != null && (b.vencimento < ctx.janela.de || b.vencimento > ctx.janela.ate);
        const titulosSaidos =
            candidatos.length === 0 && !foraJanela ? this.saiuDaCarteira(b, ctx.saidos) : [];
        return {
            situacao: this.situacaoLivre(candidatos.length, foraJanela, titulosSaidos.length),
            candidatos,
            ...(informativos.length > 0 ? { informativos } : {}),
            ...(titulosSaidos.length > 0 ? { titulosSaidos } : {}),
        };
    };

    /**
     * Uma linha por `codbar`: o mesmo boleto aparece em vários arquivos do fin124. Fica a cópia que
     * o Conexos vinculou; sem vínculo, a do arquivo mais recente (maior `ddcCod`, depois `ditCod`).
     * Sem `codbar` nunca colapsa. Preserva a ordem de entrada pela posição do representante.
     */
    private colapsarCopias = (
        entrada: BoletoDda[],
    ): { boletos: BoletoDda[]; copiasDe: Map<BoletoDda, BoletoDda[]> } => {
        const vinculado = (b: BoletoDda): boolean => b.filCod != null && !!b.docCod && !!b.titCod;
        const melhor = (a: BoletoDda, b: BoletoDda): BoletoDda => {
            if (vinculado(a) !== vinculado(b)) return vinculado(a) ? a : b;
            return (a.ddcCod - b.ddcCod || a.ditCod - b.ditCod) > 0 ? a : b;
        };
        const grupos = new Map<string, BoletoDda[]>();
        const unicos: Array<BoletoDda | string> = [];
        for (const b of entrada) {
            if (!b.codbar) {
                unicos.push(b);
                continue;
            }
            const g = grupos.get(b.codbar);
            if (g) g.push(b);
            else {
                grupos.set(b.codbar, [b]);
                unicos.push(b.codbar);
            }
        }
        const copiasDe = new Map<BoletoDda, BoletoDda[]>();
        const boletos = unicos.map((u) => {
            if (typeof u !== 'string') return u;
            const todas = grupos.get(u) ?? [];
            const rep = todas.reduce(melhor);
            copiasDe.set(
                rep,
                todas.filter((c) => c !== rep),
            );
            return rep;
        });
        return { boletos, copiasDe };
    };

    /** Inativos ordenados por centavos — a mesma busca por faixa dos abertos. */
    private indexarSaidos = (titulos: TituloAPagar[]): TituloAberto[] =>
        titulos
            .filter((t) => t.vencimento != null)
            .map((t) => ({
                titulo: t,
                centavos: centavos(t.valor),
                vencimento: this.calendar.fromErpEpoch(Number(t.vencimento)),
            }))
            .sort((x, y) => x.centavos - y.centavos);

    private saiuDaCarteira = (b: BoletoDda, saidos: TituloAberto[]): BoletoDdaTitulo[] => {
        if (!b.vencimento) return [];
        const vencimento = b.vencimento;
        const valor = centavos(b.valor);
        const achados: TituloAberto[] = [];
        for (
            let i = this.primeiroNaFaixa(saidos, valor - LIMITE_VALOR_SAIDO_CENTAVOS);
            i < saidos.length;
            i += 1
        ) {
            const s = saidos[i];
            if (!s || s.centavos > valor + LIMITE_VALOR_SAIDO_CENTAVOS) break;
            if (Math.abs(this.diasEntre(s.vencimento, vencimento)) <= LIMITE_DIAS_SAIDO) {
                achados.push(s);
            }
        }
        return achados
            .map((s) => ({
                filCod: s.titulo.filCod,
                docCod: s.titulo.docCod,
                titCod: s.titulo.titCod,
                ...(s.titulo.credor ? { credor: s.titulo.credor } : {}),
                valor: s.titulo.valor,
                vencimento: s.vencimento,
                diferencaDias: this.diasEntre(s.vencimento, vencimento),
                deltaValor: (valor - s.centavos) / 100,
            }))
            .sort(
                (x, y) =>
                    Math.abs(x.diferencaDias) - Math.abs(y.diferencaDias) ||
                    x.docCod.localeCompare(y.docCod),
            )
            .slice(0, MAX_INFORMATIVOS);
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
        const [minimo, maximo] = faixaDeCandidatos(valor);
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
        outras: BoletoDda[],
    ): Omit<
        BoletoDdaConsolidado,
        'situacao' | 'candidatos' | 'vinculo' | 'informativos' | 'titulosSaidos'
    > => ({
        arquivos: new Set([b.ddcCod, ...outras.map((c) => c.ddcCod)]).size,
        ...(outras.length > 0
            ? {
                  copias: outras.map((c) => ({
                      ddcCod: c.ddcCod,
                      ditCod: c.ditCod,
                      ...(c.arquivo ? { arquivo: c.arquivo } : {}),
                      ...(c.importadoEm != null ? { importadoEm: c.importadoEm } : {}),
                  })),
              }
            : {}),
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

    /** Precedência: CANDIDATO/AMBIGUO > FORA_JANELA > TITULO_SAIU_CARTEIRA > SEM_TITULO. */
    private situacaoLivre = (
        quantos: number,
        foraJanela: boolean,
        saidos: number,
    ): BoletoDdaSituacao => {
        if (quantos > 0) {
            return quantos === 1 ? BOLETO_DDA_SITUACAO.CANDIDATO : BOLETO_DDA_SITUACAO.AMBIGUO;
        }
        if (foraJanela) return BOLETO_DDA_SITUACAO.FORA_JANELA;
        return saidos > 0
            ? BOLETO_DDA_SITUACAO.TITULO_SAIU_CARTEIRA
            : BOLETO_DDA_SITUACAO.SEM_TITULO;
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
