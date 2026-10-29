import { inject, injectable } from 'tsyringe';
import type { BoletoDda } from '../../interface/sispag/BoletoDda.js';
import {
    type ChaveTituloGrupo,
    GRUPO_BOLETO_ORIGEM,
    type SugestaoGrupoBoleto,
    type TituloGrupoEntrada,
} from '../../interface/sispag/GrupoBoletoInterface.js';
import type { TituloAPagar } from '../../interface/sispag/SispagInterface.js';
import type { DecisaoChaveada, ParVigenteChave } from '../../interface/sispag/SugestaoBoleto.js';
import CodigoBarrasBoleto from '../../libs/boleto/CodigoBarrasBoleto.js';
import ValorAbertoLiquido from '../../libs/boleto/ValorAbertoLiquido.js';
import BankingCalendar from '../../libs/calendar/BankingCalendar.js';
import RegraGrupoBoleto, { MINIMO_TITULOS_GRUPO } from './RegraGrupoBoleto.js';

export interface EntradaMotorGrupo {
    /** Carteira persistida (`titulo_a_pagar`). */
    titulos: TituloAPagar[];
    /** Pool `fin124` inteiro (livres e vinculados). */
    boletos: BoletoDda[];
    /** Pares (credor, emissor) `VIGENTE`. */
    paresVigentes: ParVigenteChave[];
    /** `DecisaoSugestaoBoleto CONFIRMADA` ativas (título e boleto). */
    decisoesConfirmadas: DecisaoChaveada[];
    /** Grupos `CONFIRMADO`: o boleto e os títulos deles saem do jogo. */
    gruposConfirmados: Array<{
        id: string;
        ddcCod: number;
        ditCod: number;
        titulos: ChaveTituloGrupo[];
    }>;
    /** Títulos com `BloqueioDuplicidade ATIVO` (qualquer origem, inclusive `GRUPO_BOLETO`). */
    marcasAtivas: ChaveTituloGrupo[];
}

/** Título em aberto, com o vencimento civil já resolvido. */
interface TituloAberto {
    titulo: TituloAPagar;
    vencimento: string;
    centavos: number;
}

/** Conjunto fechado: todos os títulos em aberto de um (filial, pesCod, vencimento). */
interface Conjunto {
    filCod: number;
    pesCod: string;
    vencimento: string;
    titulos: TituloAberto[];
    somaCentavos: number;
    /** Valor comum quando todos os títulos têm o mesmo valor (candidato a I21f). */
    valorUniforme?: number;
}

/** Boleto livre candidato, decodificado uma vez. */
interface BoletoCandidato {
    boleto: BoletoDda;
    chave: string;
    vencimento: string;
    centavos: number;
    emissorChave?: string;
}

/** Uma associação possível entre um conjunto e um ou mais boletos. */
interface Associacao {
    conjunto: Conjunto;
    boletos: BoletoCandidato[];
    intercambiavel: boolean;
}

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
/** Títulos por (vencimento, `docCod`, `titCod`) — a ordem da partição da I21f. */
const ordemTitulo = (x: TituloAberto, y: TituloAberto): number =>
    x.vencimento.localeCompare(y.vencimento) ||
    comparaDoc(x.titulo.docCod, y.titulo.docCod) ||
    comparaDoc(x.titulo.titCod, y.titulo.titCod);
/** Boletos por (`ddcCod`, `ditCod`). */
const ordemBoleto = (x: BoletoCandidato, y: BoletoCandidato): number =>
    x.boleto.ddcCod - y.boleto.ddcCod || x.boleto.ditCod - y.boleto.ditCod;

/**
 * Motor da sugestão de grupos (I21e, I21f, PI-7; ADR-0077). PURO: sem I/O, sem relógio, sem mutar
 * a entrada; zero chamada ao Conexos (G1: usa o `valor` local da carteira — a confirmação relê o
 * `fin064` ao vivo e a remessa de novo).
 *
 * ## Algoritmo
 *
 *  1. Conjuntos fechados: TODOS os títulos em aberto (não pagos, ativos, com `pesCod` e
 *     vencimento) de cada (filial, `pesCod`, vencimento civil), fora os que já estão num grupo
 *     `CONFIRMADO`. Título que falha a I21c (alçada, retenção, decisão 1:1, lote comprometido…)
 *     FICA no conjunto e torna a sugestão não confirmável, com o motivo (PI-7) — nunca é
 *     descartado para fechar um subconjunto (M1: subset-sum = 922/2369 falsos).
 *     Conjunto de um título só é do caminho 1:1 (I21a, PI-1) e não participa.
 *  2. Boletos candidatos: livres (sem vínculo do ERP), com vencimento e código decodificável, fora
 *     de grupo `CONFIRMADO` e de `DecisaoSugestaoBoleto CONFIRMADA`. Valor = o decodificado por
 *     nós (I21b).
 *  3. Associações, no mesmo vencimento:
 *     (a) simples — um boleto com valor == Σ do conjunto;
 *     (b) intercambiável (I21f) — K ≥ 2 boletos do mesmo (emissor, valor v), conjunto de N
 *         títulos todos de valor w, v = m × w (m ≥ 2 inteiro) e N = K × m.
 *  4. Unicidade nos dois sentidos: só vira sugestão a associação que é a ÚNICA do conjunto e a
 *     única de cada boleto dela. Qualquer ambiguidade (dois boletos iguais para um conjunto, dois
 *     credores com a mesma soma para um boleto, K ≥ 2 sem a forma da I21f) ⇒ nenhuma sugestão
 *     (a analista compõe à mão, I21g). G6 decidido pelo maintainer em 2026-10-21: empate ⇒
 *     nenhuma sugestão (`_inbox/sispag-boleto-agrupado-tasks.md`).
 *  5. Partição da I21f: boletos por (`ddcCod`, `ditCod`), títulos por (vencimento, `docCod`,
 *     `titCod`); o k-ésimo boleto leva o k-ésimo bloco de m títulos. Cada grupo é avaliado pela
 *     `RegraGrupoBoleto` (origem `SUGERIDO`) e confirmado um a um pela analista.
 *
 * Complexidade: O(T + B) para montar conjuntos e índices (hash por (vencimento, valor)); a busca
 * da I21f percorre só as classes (emissor, valor) do MESMO vencimento de um conjunto uniforme:
 * O(T + B + U·C_d), U = conjuntos uniformes, C_d = classes de boleto no dia (pequeno na prática).
 *
 * Nunca expõe barras nem linha digitável: só a máscara 5+4 vinda da regra.
 */
@injectable()
export default class MotorGrupoBoleto {
    public constructor(
        @inject(CodigoBarrasBoleto) private readonly codigoBarras: CodigoBarrasBoleto,
        @inject(BankingCalendar) private readonly calendar: BankingCalendar,
        @inject(RegraGrupoBoleto) private readonly regra: RegraGrupoBoleto,
    ) {}

    public sugerir = (entrada: EntradaMotorGrupo): SugestaoGrupoBoleto[] => {
        const conjuntos = this.conjuntos(entrada);
        const boletos = this.candidatos(entrada);
        const associacoes = this.unicas(this.associacoes(conjuntos, boletos));
        const contexto = this.contexto(entrada);
        return associacoes
            .flatMap((a) => this.particionar(a))
            .map(({ conjunto, boleto, titulos, intercambiavel }) =>
                this.montar(conjunto, boleto, titulos, intercambiavel, contexto),
            )
            .sort(
                (x, y) =>
                    x.vencimentoBoleto.localeCompare(y.vencimentoBoleto) ||
                    x.filCod - y.filCod ||
                    comparaDoc(x.pesCod, y.pesCod) ||
                    x.ddcCod - y.ddcCod ||
                    x.ditCod - y.ditCod,
            );
    };

    // ── 1. Conjuntos fechados ──────────────────────────────────────────────────────────────────

    private conjuntos = (entrada: EntradaMotorGrupo): Conjunto[] => {
        const emGrupo = new Set(
            entrada.gruposConfirmados.flatMap((g) => g.titulos.map((t) => chaveTitulo(t))),
        );
        const porChave = new Map<string, TituloAberto[]>();
        for (const t of entrada.titulos) {
            if (t.pago || t.ativo === false || t.vencimento == null || !t.pesCod) continue;
            if (emGrupo.has(chaveTitulo(t))) continue;
            const vencimento = this.calendar.fromErpEpoch(Number(t.vencimento));
            const chave = `${t.filCod}|${t.pesCod}|${vencimento}`;
            const lista = porChave.get(chave) ?? [];
            lista.push({ titulo: t, vencimento, centavos: centavos(t.valor) });
            porChave.set(chave, lista);
        }
        const conjuntos: Conjunto[] = [];
        for (const lista of porChave.values()) {
            if (lista.length < MINIMO_TITULOS_GRUPO) continue;
            const [primeiro] = lista;
            if (!primeiro?.titulo.pesCod) continue;
            const titulos = [...lista].sort(ordemTitulo);
            const uniforme = titulos.every((t) => t.centavos === primeiro.centavos);
            conjuntos.push({
                filCod: primeiro.titulo.filCod,
                pesCod: primeiro.titulo.pesCod,
                vencimento: primeiro.vencimento,
                titulos,
                somaCentavos: titulos.reduce((acc, t) => acc + t.centavos, 0),
                ...(uniforme ? { valorUniforme: primeiro.centavos } : {}),
            });
        }
        return conjuntos;
    };

    // ── 2. Boletos candidatos ──────────────────────────────────────────────────────────────────

    private candidatos = (entrada: EntradaMotorGrupo): BoletoCandidato[] => {
        const ocupados = new Set([
            ...entrada.gruposConfirmados.map((g) => chaveBoleto(g)),
            ...entrada.decisoesConfirmadas.map((d) => chaveBoleto(d)),
        ]);
        const candidatos: BoletoCandidato[] = [];
        for (const b of entrada.boletos) {
            if (b.filCod != null && b.docCod && b.titCod) continue;
            if (!b.vencimento || ocupados.has(chaveBoleto(b))) continue;
            const decodificado = this.codigoBarras.decodificar(b.codbar, b.vencimento);
            if (!decodificado) continue;
            const emissor = this.codigoBarras.emissor(decodificado.barras);
            candidatos.push({
                boleto: b,
                chave: chaveBoleto(b),
                vencimento: b.vencimento,
                centavos: decodificado.valorCentavos,
                ...(emissor ? { emissorChave: emissor.chave } : {}),
            });
        }
        return candidatos.sort(ordemBoleto);
    };

    // ── 3. Associações possíveis ───────────────────────────────────────────────────────────────

    private associacoes = (conjuntos: Conjunto[], boletos: BoletoCandidato[]): Associacao[] => {
        const { porValor, classesDoDia } = this.indexar(boletos);
        const associacoes: Associacao[] = [];
        for (const conjunto of conjuntos) {
            for (const b of porValor.get(`${conjunto.vencimento}|${conjunto.somaCentavos}`) ?? []) {
                associacoes.push({ conjunto, boletos: [b], intercambiavel: false });
            }
            const classes = classesDoDia.get(conjunto.vencimento)?.values() ?? [];
            for (const classe of classes) {
                if (this.intercambiaveis(conjunto, classe)) {
                    associacoes.push({ conjunto, boletos: classe, intercambiavel: true });
                }
            }
        }
        return associacoes;
    };

    /** Índices por (vencimento, valor) e, por dia, por classe (emissor, valor). */
    private indexar = (boletos: BoletoCandidato[]) => {
        const porValor = new Map<string, BoletoCandidato[]>();
        const classesDoDia = new Map<string, Map<string, BoletoCandidato[]>>();
        for (const b of boletos) {
            const k = `${b.vencimento}|${b.centavos}`;
            porValor.set(k, [...(porValor.get(k) ?? []), b]);
            const classes = classesDoDia.get(b.vencimento) ?? new Map<string, BoletoCandidato[]>();
            // Sem emissor decodificável o boleto é uma classe só dele: nunca intercambiável.
            const classe = `${b.emissorChave ?? `?${b.chave}`}|${b.centavos}`;
            classes.set(classe, [...(classes.get(classe) ?? []), b]);
            classesDoDia.set(b.vencimento, classes);
        }
        return { porValor, classesDoDia };
    };

    /** I21f: K ≥ 2 boletos iguais, títulos todos de valor w, v = m × w (m ≥ 2) e N = K × m. */
    private intercambiaveis = (conjunto: Conjunto, classe: BoletoCandidato[]): boolean => {
        const w = conjunto.valorUniforme;
        const [primeiro] = classe;
        if (w === undefined || w <= 0 || !primeiro || classe.length < 2) return false;
        if (primeiro.centavos % w !== 0) return false;
        const m = primeiro.centavos / w;
        return m >= MINIMO_TITULOS_GRUPO && classe.length * m === conjunto.titulos.length;
    };

    // ── 4. Unicidade nos dois sentidos ─────────────────────────────────────────────────────────

    private unicas = (associacoes: Associacao[]): Associacao[] => {
        const porConjunto = new Map<Conjunto, number>();
        const porBoleto = new Map<string, number>();
        for (const a of associacoes) {
            porConjunto.set(a.conjunto, (porConjunto.get(a.conjunto) ?? 0) + 1);
            for (const b of a.boletos) porBoleto.set(b.chave, (porBoleto.get(b.chave) ?? 0) + 1);
        }
        return associacoes.filter(
            (a) =>
                porConjunto.get(a.conjunto) === 1 &&
                a.boletos.every((b) => porBoleto.get(b.chave) === 1),
        );
    };

    // ── 5. Partição e avaliação ────────────────────────────────────────────────────────────────

    private particionar = (
        a: Associacao,
    ): Array<{
        conjunto: Conjunto;
        boleto: BoletoCandidato;
        titulos: TituloAberto[];
        intercambiavel: boolean;
    }> => {
        const m = a.conjunto.titulos.length / a.boletos.length;
        return [...a.boletos].sort(ordemBoleto).map((boleto, k) => ({
            conjunto: a.conjunto,
            boleto,
            titulos: a.conjunto.titulos.slice(k * m, (k + 1) * m),
            intercambiavel: a.intercambiavel,
        }));
    };

    private contexto = (entrada: EntradaMotorGrupo) => ({
        pares: new Set(entrada.paresVigentes.map((p) => `${p.pesCod}|${p.emissorChave}`)),
        comDecisao: new Set(entrada.decisoesConfirmadas.map((d) => chaveTitulo(d))),
        marcados: new Set(entrada.marcasAtivas.map((m) => chaveTitulo(m))),
    });

    private montar = (
        conjunto: Conjunto,
        candidato: BoletoCandidato,
        titulos: TituloAberto[],
        intercambiavel: boolean,
        contexto: ReturnType<MotorGrupoBoleto['contexto']>,
    ): SugestaoGrupoBoleto => {
        const { boleto } = candidato;
        const parVigente =
            candidato.emissorChave !== undefined &&
            contexto.pares.has(`${conjunto.pesCod}|${candidato.emissorChave}`);
        const avaliacao = this.regra.avaliar({
            origem: GRUPO_BOLETO_ORIGEM.SUGERIDO,
            boleto: {
                ddcCod: boleto.ddcCod,
                ditCod: boleto.ditCod,
                ...(boleto.codbar ? { codigo: boleto.codbar } : {}),
                poolValor: boleto.valor,
                poolVencimento: candidato.vencimento,
            },
            titulos: titulos.map((t) => this.paraEntrada(t, contexto)),
            parVigente,
            parConfirmavelNoAto: candidato.emissorChave !== undefined,
        });
        const credor = titulos.find((t) => t.titulo.credor)?.titulo.credor;
        return {
            filCod: conjunto.filCod,
            pesCod: conjunto.pesCod,
            ...(credor ? { credor } : {}),
            ddcCod: boleto.ddcCod,
            ditCod: boleto.ditCod,
            ...(boleto.numero ? { numeroBoleto: boleto.numero } : {}),
            ...(avaliacao.codigoMascarado ? { codbarMascarado: avaliacao.codigoMascarado } : {}),
            ...(candidato.emissorChave ? { emissorChave: candidato.emissorChave } : {}),
            valorBoletoCentavos: candidato.centavos,
            vencimentoBoleto: candidato.vencimento,
            ...(avaliacao.somaTitulosCentavos !== undefined
                ? { somaTitulosCentavos: avaliacao.somaTitulosCentavos }
                : {}),
            titulos: avaliacao.titulos.map((t, i) => ({
                ...t,
                valorCentavos: titulos[i]?.centavos ?? 0,
                vencimento: titulos[i]?.vencimento ?? '',
            })),
            intercambiavel,
            parVigente,
            confirmavel: avaliacao.confirmavel,
            ...(avaliacao.motivo ? { motivo: avaliacao.motivo } : {}),
            motivos: avaliacao.motivos,
            avisos: avaliacao.avisos,
        };
    };

    /** Título da carteira → entrada da regra. Líquido = `valor` local, sem acréscimos (G1). */
    private paraEntrada = (
        { titulo: t, vencimento }: TituloAberto,
        contexto: ReturnType<MotorGrupoBoleto['contexto']>,
    ): TituloGrupoEntrada => {
        const chave = chaveTitulo(t);
        const aberto = ValorAbertoLiquido.semAcrescimos(t.valor);
        return {
            filCod: t.filCod,
            docCod: t.docCod,
            titCod: t.titCod,
            ...(t.pesCod ? { pesCod: t.pesCod } : {}),
            vencimento,
            liberado: t.liberado,
            pago: t.pago,
            ativo: t.ativo !== false,
            ...(t.formaPagamentoConexos !== undefined
                ? { formaPagamentoConexos: t.formaPagamentoConexos }
                : {}),
            ...(t.temBoleto !== undefined ? { temBoleto: t.temBoleto } : {}),
            ...(aberto ? { aberto } : {}),
            decisaoConfirmada: contexto.comDecisao.has(chave),
            marcaRetencaoAtiva: contexto.marcados.has(chave),
            emLoteComprometido: t.loteComprometido != null,
        };
    };
}
