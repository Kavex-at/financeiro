import { inject, injectable } from 'tsyringe';
import type { BoletoDda } from '../../interface/sispag/BoletoDda.js';
import { PAGO_POR_CONEXOS } from '../../interface/sispag/PagoPorConexos.js';
import type { TituloAPagar } from '../../interface/sispag/SispagInterface.js';
import {
    type AvaliacaoSugestao,
    type DecisaoChaveada,
    ESTADO_SUGESTAO,
    type EmissorBoleto,
    type ParVigenteChave,
    RESULTADO_SUGESTAO,
    SINAL_SUGESTAO,
    type SugestaoBoletoTitulo,
} from '../../interface/sispag/SugestaoBoleto.js';
import CodigoBarrasBoleto from '../../libs/boleto/CodigoBarrasBoleto.js';
import BankingCalendar from '../../libs/calendar/BankingCalendar.js';
import RegraSugestaoBoleto, { faixaDeCandidatos } from './RegraSugestaoBoleto.js';

export interface EntradaMotorSugestao {
    /** Carteira ativa (`titulo_a_pagar`), inclusive os que o ERP já sinalizou (`temBoleto`). */
    titulos: TituloAPagar[];
    /** Pool `fin124` inteiro (livres e vinculados). */
    boletos: BoletoDda[];
    /** Pares (credor, emissor) `VIGENTE`. */
    paresVigentes: ParVigenteChave[];
    /** Decisões `REJEITADA`: esconde aquele boleto para aquele título. */
    rejeitadas: DecisaoChaveada[];
    /** Decisões `CONFIRMADA` ativas. */
    confirmadas: DecisaoChaveada[];
    /** Data de débito (civil) do lote do título, por `filCod:docCod:titCod`. Sem lote: vencimento. */
    datasDebito?: ReadonlyMap<string, string>;
}

/** Boleto livre do pool, pré-computado uma vez por execução. */
interface BoletoLivre {
    ddcCod: number;
    ditCod: number;
    chave: string;
    centavos: number;
    valor: number;
    vencimento: string;
    numero?: string;
    emissor?: EmissorBoleto;
}

interface TituloElegivel {
    titulo: TituloAPagar;
    chave: string;
    vencimento: string;
    dataDebito: string;
}

interface Pendente {
    alvo: TituloElegivel;
    candidatos: Candidato[];
}

interface Candidato {
    boleto: BoletoLivre;
    avaliacao: AvaliacaoSugestao;
}

/** Posição de cada resultado na ordem de força (menor = mais forte). */
const FORCA: Readonly<Record<string, number>> = {
    [RESULTADO_SUGESTAO.CONHECIDO]: 0,
    [RESULTADO_SUGESTAO.FORTE]: 1,
    [RESULTADO_SUGESTAO.ATENCAO]: 2,
    [RESULTADO_SUGESTAO.VENCIDO_INFORMATIVO]: 3,
};

const chaveTitulo = (t: { filCod: number; docCod: string; titCod: string }): string =>
    `${t.filCod}:${t.docCod}:${t.titCod}`;

const chaveBoleto = (b: { ddcCod: number; ditCod: number }): string => `${b.ddcCod}:${b.ditCod}`;

const centavos = (valor: number): number => Math.round(valor * 100);

const comparaDoc = (a: string, b: string): number => {
    const na = Number(a);
    const nb = Number(b);
    if (Number.isFinite(na) && Number.isFinite(nb) && na !== nb) return na - nb;
    return a.localeCompare(b);
};

const MOTIVO_VENCIDO =
    'Boleto vence antes da data de débito: só informativo, não pode ser confirmado.';

/**
 * Motor de sugestão por título (I15c–I15h). PURO: sem I/O, sem relógio, sem mutar a entrada.
 *
 * ## Algoritmo (complexidade O((T + B) log B + T·k), k = boletos na faixa de valor do título)
 *
 *  1. Boletos livres (sem `docCod/titCod` do ERP, com vencimento), indexados por valor em centavos.
 *     Boletos que o ERP "reservou" para um título já sinalizado (`temBoleto`, mesmo valor e dia) e
 *     boletos já CONFIRMADOS para um título saem do jogo (I15e).
 *  2. Por título elegível (pago/inativo/forma ≠ BOLETO/já sinalizado ficam de fora), os candidatos
 *     são os boletos da faixa de valor avaliados pela `RegraSugestaoBoleto`; REJEITADA esconde o
 *     par (título, boleto).
 *  3. Unicidade nos dois sentidos:
 *     - título → boleto: 2+ candidatos seguros (CONHECIDO/FORTE) de mesma força = ambíguo. DECISÃO
 *       DOCUMENTADA: o título fica SEM sugestão (a analista os vê na aba DDA); nenhum `ATENCAO`
 *       "ambíguo" é inventado;
 *     - boleto → título: disputa (I15e/Q-D) — o boleto fica com o título de menor vencimento,
 *       empate pelo menor `docCod`, depois `filCod`, depois `titCod`. O perdedor é reavaliado sem
 *       o boleto. Determinístico: a ordem de entrada não muda o resultado.
 *  4. Camadas, em ordem: seguros (CONHECIDO/FORTE) → ATENCAO (só com âncora: par vigente do emissor
 *     OU número do documento igual; sem âncora o pool inteiro viraria sugestão) → VENCIDO_INFORMATIVO
 *     (informativo, nunca confirmável, não reserva o boleto).
 *
 * Nunca lê nem grava o Conexos; nunca expõe barras ou linha digitável (só `EmissorBoleto`).
 */
@injectable()
export default class MotorSugestaoBoleto {
    public constructor(
        @inject(CodigoBarrasBoleto) private readonly codigoBarras: CodigoBarrasBoleto,
        @inject(BankingCalendar) private readonly calendar: BankingCalendar,
        @inject(RegraSugestaoBoleto) private readonly regra: RegraSugestaoBoleto,
    ) {}

    public sugerir = (entrada: EntradaMotorSugestao): SugestaoBoletoTitulo[] => {
        const livres = this.livres(entrada);
        const porChave = new Map(livres.map((b) => [b.chave, b]));
        const pares = new Set(entrada.paresVigentes.map((p) => `${p.pesCod}|${p.emissorChave}`));
        const rejeitadas = new Set(
            entrada.rejeitadas.map((d) => `${chaveTitulo(d)}|${chaveBoleto(d)}`),
        );
        const confirmadaDoTitulo = new Map(entrada.confirmadas.map((d) => [chaveTitulo(d), d]));
        const ocupados = new Set(entrada.confirmadas.map((d) => chaveBoleto(d)));

        const elegiveis = this.elegiveis(entrada.titulos, entrada.datasDebito);
        const resultado: SugestaoBoletoTitulo[] = [];
        const pendentes: Pendente[] = [];

        for (const alvo of elegiveis) {
            const confirmada = confirmadaDoTitulo.get(alvo.chave);
            if (confirmada) {
                const boleto = porChave.get(chaveBoleto(confirmada));
                if (boleto)
                    resultado.push(
                        this.montar(
                            alvo,
                            this.avaliar(alvo, boleto, pares),
                            boleto,
                            ESTADO_SUGESTAO.CONFIRMADA,
                        ),
                    );
                continue;
            }
            pendentes.push({
                alvo,
                candidatos: this.candidatos(alvo, livres, ocupados, rejeitadas, pares),
            });
        }

        pendentes.sort((x, y) => this.prioridade(x.alvo, y.alvo));
        resultado.push(...this.alocar(pendentes, ocupados));
        return resultado.sort((x, y) => this.prioridadeChave(x, y));
    };

    // ── 1. Entrada → estruturas ────────────────────────────────────────────────────────────────

    private livres = (entrada: EntradaMotorSugestao): BoletoLivre[] => {
        const reservados = this.reservadosPeloErp(entrada);
        return entrada.boletos
            .filter((b) => !(b.filCod != null && b.docCod && b.titCod) && b.vencimento)
            .filter((b) => !reservados.has(chaveBoleto(b)))
            .map((b): BoletoLivre => {
                const emissor = this.codigoBarras.emissor(b.codbar);
                return {
                    ddcCod: b.ddcCod,
                    ditCod: b.ditCod,
                    chave: chaveBoleto(b),
                    centavos: centavos(b.valor),
                    valor: b.valor,
                    vencimento: String(b.vencimento),
                    ...(b.numero ? { numero: b.numero } : {}),
                    ...(emissor ? { emissor } : {}),
                };
            })
            .sort((x, y) => x.centavos - y.centavos || x.ddcCod - y.ddcCod || x.ditCod - y.ditCod);
    };

    /**
     * Cada título que o ERP já sinalizou reserva UM boleto livre de mesmo valor e mesmo dia (I15e):
     * o ERP o associou por valor + dia exatos. Qual dos idênticos foi usado é indiferente para o
     * valor e o dia; reserva-se por ordem (ddc, dit) para ser determinístico.
     */
    private reservadosPeloErp = (entrada: EntradaMotorSugestao): Set<string> => {
        const sinalizados = new Map<string, number>();
        for (const t of entrada.titulos) {
            if (t.pago || t.temBoleto !== true || t.vencimento == null) continue;
            const k = `${centavos(t.valor)}|${this.calendar.fromErpEpoch(Number(t.vencimento))}`;
            sinalizados.set(k, (sinalizados.get(k) ?? 0) + 1);
        }
        const livres = entrada.boletos
            .filter((b) => !(b.filCod != null && b.docCod && b.titCod) && b.vencimento)
            .sort((x, y) => x.ddcCod - y.ddcCod || x.ditCod - y.ditCod);
        const reservados = new Set<string>();
        for (const b of livres) {
            const k = `${centavos(b.valor)}|${b.vencimento}`;
            const restante = sinalizados.get(k) ?? 0;
            if (restante > 0) {
                reservados.add(chaveBoleto(b));
                sinalizados.set(k, restante - 1);
            }
        }
        return reservados;
    };

    private elegiveis = (
        titulos: TituloAPagar[],
        datasDebito?: ReadonlyMap<string, string>,
    ): TituloElegivel[] =>
        titulos
            .filter(
                (t) =>
                    !t.pago &&
                    t.ativo !== false &&
                    t.temBoleto !== true &&
                    t.formaPagamentoConexos === PAGO_POR_CONEXOS.BOLETO &&
                    t.vencimento != null,
            )
            .map((t) => {
                const vencimento = this.calendar.fromErpEpoch(Number(t.vencimento));
                const chave = chaveTitulo(t);
                return {
                    titulo: t,
                    chave,
                    vencimento,
                    dataDebito: datasDebito?.get(chave) ?? vencimento,
                };
            });

    // ── 2. Candidatos de um título ─────────────────────────────────────────────────────────────

    private candidatos = (
        alvo: TituloElegivel,
        livres: BoletoLivre[],
        ocupados: Set<string>,
        rejeitadas: Set<string>,
        pares: Set<string>,
    ): Candidato[] => {
        const [minimo, maximo] = faixaDeCandidatos(centavos(alvo.titulo.valor));
        const achados: Candidato[] = [];
        for (let i = this.primeiro(livres, minimo); i < livres.length; i += 1) {
            const boleto = livres[i];
            if (!boleto || boleto.centavos > maximo) break;
            if (ocupados.has(boleto.chave) || rejeitadas.has(`${alvo.chave}|${boleto.chave}`)) {
                continue;
            }
            const avaliacao = this.avaliar(alvo, boleto, pares);
            if (this.aceita(avaliacao)) achados.push({ boleto, avaliacao });
        }
        return achados.sort((x, y) => this.melhor(x, y));
    };

    private avaliar = (
        alvo: TituloElegivel,
        boleto: BoletoLivre,
        pares: Set<string>,
    ): AvaliacaoSugestao =>
        this.regra.avaliar({
            titulo: {
                valor: alvo.titulo.valor,
                vencimento: alvo.vencimento,
                ...(alvo.titulo.numeroDocumento
                    ? { numeroDocumento: alvo.titulo.numeroDocumento }
                    : {}),
            },
            boleto: {
                valor: boleto.valor,
                vencimento: boleto.vencimento,
                ...(boleto.numero ? { numero: boleto.numero } : {}),
            },
            dataDebito: alvo.dataDebito,
            parConfirmado:
                alvo.titulo.pesCod != null &&
                boleto.emissor != null &&
                pares.has(`${alvo.titulo.pesCod}|${boleto.emissor.chave}`),
        });

    /** Seguros entram; ATENCAO exige âncora; vencido entra só como informação com valor ≈ igual. */
    private aceita = (a: AvaliacaoSugestao): boolean => {
        if (a.resultado === RESULTADO_SUGESTAO.SEM_RELACAO) return false;
        if (a.resultado === RESULTADO_SUGESTAO.CONHECIDO) return true;
        if (a.resultado === RESULTADO_SUGESTAO.FORTE) return true;
        const ancora =
            a.sinais.includes(SINAL_SUGESTAO.EMISSOR_CONFIRMADO) ||
            a.sinais.includes(SINAL_SUGESTAO.NUMERO_IGUAL);
        if (a.resultado === RESULTADO_SUGESTAO.ATENCAO) return ancora;
        return ancora || Math.abs(a.deltaValor) <= 0.05;
    };

    private melhor = (x: Candidato, y: Candidato): number =>
        (FORCA[x.avaliacao.resultado] ?? 9) - (FORCA[y.avaliacao.resultado] ?? 9) ||
        Math.abs(x.avaliacao.deltaValor) - Math.abs(y.avaliacao.deltaValor) ||
        Math.abs(x.avaliacao.deltaDias) - Math.abs(y.avaliacao.deltaDias) ||
        x.boleto.ddcCod - y.boleto.ddcCod ||
        x.boleto.ditCod - y.boleto.ditCod;

    private primeiro = (livres: BoletoLivre[], minimo: number): number => {
        let lo = 0;
        let hi = livres.length;
        while (lo < hi) {
            const meio = (lo + hi) >>> 1;
            if ((livres[meio]?.centavos ?? 0) < minimo) lo = meio + 1;
            else hi = meio;
        }
        return lo;
    };

    // ── 3. Unicidade e disputa ─────────────────────────────────────────────────────────────────

    /**
     * Camadas em ordem de prioridade do TÍTULO (menor vencimento ganha o boleto): primeiro os
     * seguros, depois ATENCAO, depois o informativo. Cada camada só vê o que as anteriores
     * deixaram livre — ATENCAO nunca rouba boleto de um candidato seguro de outro título.
     */
    private alocar = (pendentes: Pendente[], ocupados: Set<string>): SugestaoBoletoTitulo[] => {
        const ocupadosAgora = new Set(ocupados);
        const resolvidos = new Set<string>();
        return [
            ...this.camadaSegura(pendentes, ocupadosAgora, resolvidos),
            // ATENCAO reserva o boleto; o vencido informativo não.
            ...this.camadaFraca(2, true, pendentes, ocupadosAgora, resolvidos),
            ...this.camadaFraca(3, false, pendentes, ocupadosAgora, resolvidos),
        ];
    };

    /** Camada 1. Ambíguo (2+ da mesma força) = sem sugestão, e o título sai do jogo. */
    private camadaSegura = (
        pendentes: Pendente[],
        ocupados: Set<string>,
        resolvidos: Set<string>,
    ): SugestaoBoletoTitulo[] => {
        const resultado: SugestaoBoletoTitulo[] = [];
        for (const { alvo, candidatos } of pendentes) {
            const seguros = candidatos.filter((c) => (FORCA[c.avaliacao.resultado] ?? 9) <= 1);
            const topo = seguros[0];
            if (!topo) continue;
            const empatados = seguros.filter(
                (c) => c.avaliacao.resultado === topo.avaliacao.resultado,
            );
            if (empatados.length > 1) {
                resolvidos.add(alvo.chave);
                continue;
            }
            if (ocupados.has(topo.boleto.chave)) continue; // perdeu a disputa: reavalia
            ocupados.add(topo.boleto.chave);
            resolvidos.add(alvo.chave);
            resultado.push(this.montar(alvo, topo.avaliacao, topo.boleto));
        }
        return resultado;
    };

    private camadaFraca = (
        forca: number,
        reserva: boolean,
        pendentes: Pendente[],
        ocupados: Set<string>,
        resolvidos: Set<string>,
    ): SugestaoBoletoTitulo[] => {
        const resultado: SugestaoBoletoTitulo[] = [];
        for (const { alvo, candidatos } of pendentes) {
            if (resolvidos.has(alvo.chave)) continue;
            const escolhido = candidatos.find(
                (c) =>
                    (FORCA[c.avaliacao.resultado] ?? 9) === forca && !ocupados.has(c.boleto.chave),
            );
            if (!escolhido) continue;
            resolvidos.add(alvo.chave);
            if (reserva) ocupados.add(escolhido.boleto.chave);
            resultado.push(this.montar(alvo, escolhido.avaliacao, escolhido.boleto));
        }
        return resultado;
    };

    private montar = (
        alvo: TituloElegivel,
        avaliacao: AvaliacaoSugestao,
        boleto: BoletoLivre,
        estado: SugestaoBoletoTitulo['estado'] = ESTADO_SUGESTAO.SUGERIDA,
    ): SugestaoBoletoTitulo => ({
        filCod: alvo.titulo.filCod,
        docCod: alvo.titulo.docCod,
        titCod: alvo.titulo.titCod,
        ...(alvo.titulo.pesCod ? { pesCod: alvo.titulo.pesCod } : {}),
        ...(alvo.titulo.credor ? { credor: alvo.titulo.credor } : {}),
        valorTitulo: alvo.titulo.valor,
        vencimentoTitulo: alvo.vencimento,
        dataDebito: alvo.dataDebito,
        ddcCod: boleto.ddcCod,
        ditCod: boleto.ditCod,
        ...(boleto.numero ? { numeroBoleto: boleto.numero } : {}),
        valorBoleto: boleto.valor,
        vencimentoBoleto: boleto.vencimento,
        ...(boleto.emissor ? { emissor: boleto.emissor } : {}),
        avaliacao,
        estado,
        ...(avaliacao.resultado === RESULTADO_SUGESTAO.VENCIDO_INFORMATIVO
            ? { motivo: MOTIVO_VENCIDO }
            : {}),
    });

    /** Prioridade na disputa (I15e/Q-D): menor vencimento; empate: docCod, filCod, titCod. */
    private prioridade = (x: TituloElegivel, y: TituloElegivel): number =>
        x.vencimento.localeCompare(y.vencimento) ||
        comparaDoc(x.titulo.docCod, y.titulo.docCod) ||
        x.titulo.filCod - y.titulo.filCod ||
        comparaDoc(x.titulo.titCod, y.titulo.titCod);

    private prioridadeChave = (x: SugestaoBoletoTitulo, y: SugestaoBoletoTitulo): number =>
        x.vencimentoTitulo.localeCompare(y.vencimentoTitulo) ||
        comparaDoc(x.docCod, y.docCod) ||
        x.filCod - y.filCod ||
        comparaDoc(x.titCod, y.titCod);
}
