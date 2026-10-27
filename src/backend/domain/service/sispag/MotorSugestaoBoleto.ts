import { inject, injectable } from 'tsyringe';
import type { BoletoDda } from '../../interface/sispag/BoletoDda.js';
import { PAGO_POR_CONEXOS } from '../../interface/sispag/PagoPorConexos.js';
import type { TituloAPagar } from '../../interface/sispag/SispagInterface.js';
import {
    type AvaliacaoSugestao,
    type CandidatoTitulo,
    type ChaveTitulo,
    type DecisaoChaveada,
    type DecisaoConfirmadaChaveada,
    type DesfechoTitulo,
    type DpsConhecido,
    EXIGE_RECONHECIMENTO,
    ESTADO_SUGESTAO,
    type EmissorBoleto,
    MOTIVO_ORFA_RECONHECIMENTO_INVALIDADO,
    type ParVigenteChave,
    RESULTADO_SUGESTAO,
    SINAL_SUGESTAO,
    SITUACAO_SUGESTAO_TITULO,
    type SituacaoSugestaoTitulo,
    SUGESTAO_TOP_CANDIDATOS,
    type SugestaoBoletoTitulo,
    type TituloNumeroDocumento,
} from '../../interface/sispag/SugestaoBoleto.js';
import CodigoBarrasBoleto from '../../libs/boleto/CodigoBarrasBoleto.js';
import BankingCalendar from '../../libs/calendar/BankingCalendar.js';
import ReconhecimentoDivergencia from '../../libs/boleto/ReconhecimentoDivergencia.js';
import AncoraOrdemDps from './AncoraOrdemDps.js';
import RegraSugestaoBoleto, {
    faixaDeCandidatos,
    NUMERO_CONFIAVEL_MIN_DIGITOS,
} from './RegraSugestaoBoleto.js';

export interface EntradaMotorSugestao {
    /** Carteira ativa (`titulo_a_pagar`), inclusive os que o ERP já sinalizou (`temBoleto`). */
    titulos: TituloAPagar[];
    /** Pool `fin124` inteiro (livres e vinculados). */
    boletos: BoletoDda[];
    /** Pares (credor, emissor) `VIGENTE`. */
    paresVigentes: ParVigenteChave[];
    /** Decisões `REJEITADA`: esconde aquele boleto para aquele título. */
    rejeitadas: DecisaoChaveada[];
    /** Decisões `CONFIRMADA` ativas (com o snapshot, para mostrar as órfãs). */
    confirmadas: DecisaoConfirmadaChaveada[];
    /** Data de débito (civil) do lote do título, por `filCod:docCod:titCod`. Sem lote: vencimento. */
    datasDebito?: ReadonlyMap<string, string>;
    /** DPS lidos dos PDFs (`titulo_dps`, I15p), inclusive de títulos que já saíram da carteira. */
    dps?: DpsConhecido[];
    /**
     * Grupos de boleto `CONFIRMADO` (I15q, ADR-0077): o título vira `EM_GRUPO` e o boleto sai do
     * jogo (exclusão (4) da I15e). Ausente ≡ lista vazia.
     */
    gruposConfirmados?: GrupoConfirmadoChaveado[];
    /**
     * Números de documento de TODOS os títulos (ativos ou não, `titulo_a_pagar` sem filtro `ativo`),
     * para a guarda de duplicata da âncora de número (I15s). Sem ela vale só `titulos`.
     */
    titulosDoCredor?: TituloNumeroDocumento[];
    /**
     * Fail-closed da âncora de número (I15s): a leitura de `titulosDoCredor` falhou, então a guarda
     * de duplicata não pode ser avaliada e NENHUM candidato recebe `NUMERO_CONFIAVEL`. Ausente
     * `titulosDoCredor` sem este sinal continua valendo só `titulos` (entrada legada).
     */
    numeroAncoraDesligada?: boolean;
}

/** Grupo `CONFIRMADO` no formato que o motor consome: o boleto e as chaves dos títulos. */
export interface GrupoConfirmadoChaveado {
    id: string;
    ddcCod: number;
    ditCod: number;
    titulos: Array<{ filCod: number; docCod: string; titCod: string }>;
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
    codbar?: string;
    emissor?: EmissorBoleto;
}

interface TituloElegivel {
    titulo: TituloAPagar;
    chave: string;
    vencimento: string;
    dataDebito: string;
    /** DPS lido do PDF da NFS-e (I15p(1)). */
    dps?: string;
}

interface Pendente {
    alvo: TituloElegivel;
    candidatos: Candidato[];
}

interface Candidato {
    boleto: BoletoLivre;
    avaliacao: AvaliacaoSugestao;
}

/** Candidato do desfecho: todo par dentro do envelope, com a força refinada pela âncora. */
interface CandidatoCompleto extends Candidato {
    ancorado: boolean;
    /** 0 CONHECIDO · 1 FORTE · 2 ATENCAO ancorada · 3 ATENCAO sem âncora · 4 VENCIDO. */
    forca: number;
    /**
     * Âncora forte (DPS, I15p, ou número confiável, I15s); calculada uma vez, o comparador é o
     * caminho quente do motor.
     */
    ancoraForte: boolean;
}

/** Índices da guarda de duplicata da âncora de número (I15s). */
interface IndiceNumeros {
    /** (número|emissor) → códigos de barras DISTINTOS: o mesmo boleto em dois arquivos DDA é um só. */
    boletos: Map<string, Set<string>>;
    documentos: Map<string, Set<string>>;
}

interface PendenteCompleto {
    alvo: TituloElegivel;
    candidatos: CandidatoCompleto[];
}

interface Preparo {
    livres: BoletoLivre[];
    porChave: Map<string, BoletoLivre>;
    /** Título → id do `GrupoBoleto CONFIRMADO` que o contém (I15q). */
    grupoDoTitulo: Map<string, string>;
    pares: Set<string>;
    rejeitadas: Set<string>;
    elegiveis: TituloElegivel[];
    confirmadaDoTitulo: Map<string, DecisaoConfirmadaChaveada>;
    ocupados: Set<string>;
    orfas: Array<{
        titulo: TituloAPagar;
        decisao: DecisaoConfirmadaChaveada;
        dataDebito: string | undefined;
        motivo: string;
    }>;
    resolvidosPorDecisao: Set<string>;
}

const FORCA_ATENCAO_ANCORADA = 2;
const FORCA_ATENCAO_FRACA = 3;
const FORCA_VENCIDO = 4;

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

/** Âncora (ADR-0072 + I15p): par vigente do emissor, número igual, DPS igual ou ordem de DPS. */
const SINAIS_ANCORA: ReadonlySet<string> = new Set([
    SINAL_SUGESTAO.EMISSOR_CONFIRMADO,
    SINAL_SUGESTAO.NUMERO_IGUAL,
    SINAL_SUGESTAO.DPS_IGUAL,
    SINAL_SUGESTAO.ORDEM_DPS,
    SINAL_SUGESTAO.NUMERO_CONFIAVEL,
]);
const ancoradoPor = (sinais: readonly string[]): boolean =>
    sinais.some((x) => SINAIS_ANCORA.has(x));
const ancoradoPorDps = (sinais: readonly string[]): boolean =>
    sinais.includes(SINAL_SUGESTAO.DPS_IGUAL) || sinais.includes(SINAL_SUGESTAO.ORDEM_DPS);
const ancoradoPorNumero = (sinais: readonly string[]): boolean =>
    sinais.includes(SINAL_SUGESTAO.NUMERO_CONFIAVEL);
/** Âncora de identidade (camada 0): DPS (I15p) ou número confiável (I15s). */
const ancoraForte = (sinais: readonly string[]): boolean =>
    ancoradoPorDps(sinais) || ancoradoPorNumero(sinais);

const comparaDoc = (a: string, b: string): number => {
    const na = Number(a);
    const nb = Number(b);
    if (Number.isFinite(na) && Number.isFinite(nb) && na !== nb) return na - nb;
    return a.localeCompare(b);
};

const MOTIVO_VENCIDO =
    'Boleto vence antes da data de débito: só informativo, não pode ser confirmado.';
const MOTIVO_FRACO =
    'Sem confirmação do emissor nem do número do documento: só informativo, não pode ser confirmado.';
const MOTIVO_AMBIGUO =
    'Mais de um boleto igualmente provável para este título: rejeite os que não são deste título para liberar a confirmação.';
const MOTIVO_CONFLITO_ANCORAS =
    'O DPS da NFS-e e o número do documento apontam para boletos diferentes: rejeite o que não é deste título para liberar a confirmação.';
const MOTIVO_MAIS_FORTE = 'Há um candidato mais forte para este título.';
const MOTIVO_SEM_CANDIDATO =
    'Nenhum boleto livre no pool DDA dentro do envelope (±R$ 10,00 ou 2 %, ±10 dias).';
const MOTIVO_POR_SITUACAO: Readonly<Record<SituacaoSugestaoTitulo, string>> = {
    [SITUACAO_SUGESTAO_TITULO.UNICA_SEGURA]: 'Um único boleto provável: pode ser confirmado.',
    [SITUACAO_SUGESTAO_TITULO.SO_ATENCAO]:
        'Boleto com diferença, ancorado pelo emissor ou pelo número do documento: confira antes de confirmar.',
    [SITUACAO_SUGESTAO_TITULO.AMBIGUA]: MOTIVO_AMBIGUO,
    [SITUACAO_SUGESTAO_TITULO.SO_FRACA]: MOTIVO_FRACO,
    [SITUACAO_SUGESTAO_TITULO.SO_VENCIDA]: MOTIVO_VENCIDO,
    [SITUACAO_SUGESTAO_TITULO.DISPUTADA]:
        'O melhor boleto está reservado a outro título (vence antes, ou desempate pelo documento).',
    [SITUACAO_SUGESTAO_TITULO.SEM_CANDIDATO]: MOTIVO_SEM_CANDIDATO,
    [SITUACAO_SUGESTAO_TITULO.CONFIRMADA]: 'Confirmada pelo analista.',
    [SITUACAO_SUGESTAO_TITULO.ORFA]: 'Confirmação órfã: anule para liberar o título.',
    [SITUACAO_SUGESTAO_TITULO.EM_GRUPO]:
        'Título em grupo de boleto confirmado: um boleto paga este e outros títulos do credor. Anule o grupo para sugerir um boleto só para ele.',
};

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
        @inject(AncoraOrdemDps) private readonly ordemDps: AncoraOrdemDps,
    ) {}

    /**
     * Contrato legado: as sugestões que o motor sempre devolveu (seguras, ATENCAO ancorada, vencido
     * informativo, confirmadas e órfãs). Inalterado pelo ADR-0072 — o desfecho por título vem de
     * `desfechos`.
     */
    public sugerir = (entrada: EntradaMotorSugestao): SugestaoBoletoTitulo[] =>
        this.analisar(entrada).sugestoes;

    /**
     * Desfecho por título (I15m, I15n, ADR-0072): TODO título elegível produz exatamente um, com até
     * `SUGESTAO_TOP_CANDIDATOS` candidatos. Exibir ≠ confirmar: só o candidato escolhido
     * (`UNICA_SEGURA`/`SO_ATENCAO`) é confirmável; fraco, ambíguo, disputado e vencido são
     * informação.
     */
    public desfechos = (entrada: EntradaMotorSugestao): DesfechoTitulo[] =>
        this.analisar(entrada).desfechos;

    /**
     * Uma passada só: os pares do envelope são avaliados UMA vez e alimentam o contrato legado e o
     * desfecho (o custo dominante é a avaliação por par).
     */
    public analisar = (
        entrada: EntradaMotorSugestao,
    ): { sugestoes: SugestaoBoletoTitulo[]; desfechos: DesfechoTitulo[] } => {
        const p = this.preparar(entrada);
        const sugestoes: SugestaoBoletoTitulo[] = [];
        const desfechos: DesfechoTitulo[] = [];
        for (const o of p.orfas) {
            const orfa = this.orfa(o.titulo, o.decisao, o.dataDebito, o.motivo);
            sugestoes.push(orfa);
            desfechos.push(this.desfechoDeDecisao(orfa, SITUACAO_SUGESTAO_TITULO.ORFA));
        }

        const pendentes: PendenteCompleto[] = [];
        for (const alvo of p.elegiveis) {
            const grupoId = p.grupoDoTitulo.get(alvo.chave);
            if (grupoId !== undefined) {
                desfechos.push(this.desfechoEmGrupo(alvo, grupoId));
                continue;
            }
            const confirmada = p.confirmadaDoTitulo.get(alvo.chave);
            if (confirmada) {
                const boleto = p.porChave.get(chaveBoleto(confirmada));
                if (boleto) {
                    const viva = {
                        ...this.montar(
                            alvo,
                            this.avaliar(alvo, boleto, p.pares),
                            boleto,
                            ESTADO_SUGESTAO.CONFIRMADA,
                        ),
                        ...this.autoria(confirmada),
                    };
                    sugestoes.push(viva);
                    desfechos.push(
                        this.desfechoDeDecisao(viva, SITUACAO_SUGESTAO_TITULO.CONFIRMADA),
                    );
                }
                continue;
            }
            // Órfã: a decisão ainda ocupa o título (índice único); não se sugere outro boleto.
            if (p.resolvidosPorDecisao.has(alvo.chave)) continue;
            pendentes.push({
                alvo,
                candidatos: this.todosCandidatos(alvo, p.livres, p.ocupados, p.rejeitadas, p.pares),
            });
        }
        this.ancorarPorOrdem(pendentes, p, entrada);
        if (!entrada.numeroAncoraDesligada) this.ancorarPorNumero(pendentes, entrada);
        pendentes.sort((x, y) => this.prioridade(x.alvo, y.alvo));

        // O contrato legado só enxerga o que `aceita`; a ordem relativa da lista completa é a mesma.
        const legado: Pendente[] = pendentes.map(({ alvo, candidatos }) => ({
            alvo,
            candidatos: candidatos.filter((c) => this.aceita(c.avaliacao)),
        }));
        sugestoes.push(...this.alocar(legado, p.ocupados));
        desfechos.push(...this.alocarDesfechos(pendentes));
        return {
            sugestoes: sugestoes.sort((x, y) => this.prioridadeChave(x, y)),
            desfechos: desfechos.sort((x, y) => this.prioridadeDesfecho(x, y)),
        };
    };

    /** Estruturas compartilhadas pelo contrato legado e pelo desfecho. */
    private preparar = (entrada: EntradaMotorSugestao): Preparo => {
        const grupos = entrada.gruposConfirmados ?? [];
        const boletosDeGrupo = new Set(grupos.map((g) => chaveBoleto(g)));
        const grupoDoTitulo = new Map(
            grupos.flatMap((g) => g.titulos.map((t) => [chaveTitulo(t), g.id] as const)),
        );
        const livres = this.livres(entrada).filter((b) => !boletosDeGrupo.has(b.chave));
        const porChave = new Map(livres.map((b) => [b.chave, b]));
        const pares = new Set(entrada.paresVigentes.map((p) => `${p.pesCod}|${p.emissorChave}`));
        const rejeitadas = new Set(
            entrada.rejeitadas.map((d) => `${chaveTitulo(d)}|${chaveBoleto(d)}`),
        );
        const dpsPorTitulo = new Map((entrada.dps ?? []).map((d) => [chaveTitulo(d), d.dps]));
        const elegiveis = this.elegiveis(entrada.titulos, entrada.datasDebito, dpsPorTitulo);
        const elegivelPorChave = new Map(elegiveis.map((e) => [e.chave, e]));
        const tituloPorChave = new Map(entrada.titulos.map((t) => [chaveTitulo(t), t]));

        // Cada CONFIRMADA ativa cai em uma de três: viva (título e boleto no jogo), órfã (visível,
        // com aviso, I15l) ou invisível (título pago/inativo/fora da carteira: nada a fazer na tela;
        // a decisão ainda pode ser anulada pela rota). Só a viva reserva o boleto.
        const confirmadaDoTitulo = new Map<string, DecisaoConfirmadaChaveada>();
        const ocupados = new Set<string>();
        const orfas: Preparo['orfas'] = [];
        const resolvidosPorDecisao = new Set<string>();
        for (const d of entrada.confirmadas) {
            const chave = chaveTitulo(d);
            const titulo = tituloPorChave.get(chave);
            if (!titulo || titulo.pago || titulo.ativo === false) continue;
            resolvidosPorDecisao.add(chave);
            const alvo = elegivelPorChave.get(chave);
            if (alvo) {
                const vivo = porChave.get(chaveBoleto(d));
                if (vivo && this.reconhecimentoInvalido(d, alvo, vivo, pares)) {
                    // I15r: o Δ ou o valor mudaram desde o ack. A decisão segue CONFIRMADA (o
                    // sistema não a anula, I15g) e continua reservando título e boleto; a tela a
                    // mostra órfã até a analista anular e reconfirmar.
                    ocupados.add(chaveBoleto(d));
                    orfas.push({
                        titulo,
                        decisao: d,
                        dataDebito: alvo.dataDebito,
                        motivo: MOTIVO_ORFA_RECONHECIMENTO_INVALIDADO,
                    });
                } else if (vivo) {
                    confirmadaDoTitulo.set(chave, d);
                    ocupados.add(chaveBoleto(d));
                } else {
                    orfas.push({
                        titulo,
                        decisao: d,
                        dataDebito: alvo.dataDebito,
                        motivo: this.motivoBoletoSaiu(d, entrada),
                    });
                }
            } else {
                orfas.push({
                    titulo,
                    decisao: d,
                    dataDebito: undefined,
                    motivo: this.motivoTituloSaiu(titulo),
                });
            }
        }
        return {
            livres,
            porChave,
            grupoDoTitulo,
            pares,
            rejeitadas,
            elegiveis,
            confirmadaDoTitulo,
            ocupados,
            orfas,
            resolvidosPorDecisao,
        };
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
                    ...(b.codbar ? { codbar: b.codbar } : {}),
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
        datasDebito: ReadonlyMap<string, string> | undefined,
        dpsPorTitulo: ReadonlyMap<string, string>,
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
                const dps = dpsPorTitulo.get(chave);
                return {
                    titulo: t,
                    chave,
                    vencimento,
                    dataDebito: datasDebito?.get(chave) ?? vencimento,
                    ...(dps ? { dps } : {}),
                };
            });

    // ── 2. Candidatos de um título ─────────────────────────────────────────────────────────────

    private avaliar = (
        alvo: TituloElegivel,
        boleto: BoletoLivre,
        pares: Set<string>,
        ordemDps = false,
    ): AvaliacaoSugestao =>
        this.regra.avaliar({
            titulo: {
                valor: alvo.titulo.valor,
                vencimento: alvo.vencimento,
                ...(alvo.titulo.numeroDocumento
                    ? { numeroDocumento: alvo.titulo.numeroDocumento }
                    : {}),
                ...(alvo.dps ? { dps: alvo.dps } : {}),
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
            ...(ordemDps ? { ordemDps: true } : {}),
        });

    /** Seguros entram; ATENCAO exige âncora; vencido entra só como informação com valor ≈ igual. */
    private aceita = (a: AvaliacaoSugestao): boolean => {
        if (a.resultado === RESULTADO_SUGESTAO.SEM_RELACAO) return false;
        if (a.resultado === RESULTADO_SUGESTAO.CONHECIDO) return true;
        if (a.resultado === RESULTADO_SUGESTAO.FORTE) return true;
        const ancora = ancoradoPor(a.sinais);
        if (a.resultado === RESULTADO_SUGESTAO.ATENCAO) return ancora;
        return ancora || Math.abs(a.deltaValor) <= 0.05;
    };

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
        const { escolhas: porAncora, conflitos } = this.escolhasPorAncora(pendentes, ocupadosAgora);
        const camadaDps: SugestaoBoletoTitulo[] = [];
        for (const { alvo } of pendentes) {
            // Âncoras divergentes: sem sugestão (o desfecho mostra AMBIGUA).
            if (conflitos.has(alvo.chave)) resolvidos.add(alvo.chave);
            const c = porAncora.get(alvo.chave);
            if (!c) continue;
            ocupadosAgora.add(c.boleto.chave);
            resolvidos.add(alvo.chave);
            camadaDps.push(this.montar(alvo, c.avaliacao, c.boleto));
        }
        return [
            ...camadaDps,
            ...this.camadaSegura(pendentes, ocupadosAgora, resolvidos),
            // ATENCAO reserva o boleto; o vencido informativo não.
            ...this.camadaFraca(2, true, pendentes, ocupadosAgora, resolvidos),
            ...this.camadaFraca(3, false, pendentes, ocupadosAgora, resolvidos),
        ];
    };

    /**
     * Camada 0 (I15p, I15s): o par com âncora forte (DPS ou número confiável) reserva o boleto ANTES
     * das demais camadas — é a prova de identidade mais forte que o motor tem, e nenhum título de
     * menor vencimento ancorado só pelo emissor pode levá-lo. Vale só para o candidato ancorado ÚNICO
     * do título, num boleto que nenhum outro título reivindica por âncora forte, e nunca para vencido
     * no débito (I15h). DPS e número em boletos diferentes do mesmo título é conflito: o título não
     * escolhe nem reivindica nada (AMBIGUA).
     */
    private escolhasPorAncora = <C extends Candidato>(
        pendentes: ReadonlyArray<{ alvo: TituloElegivel; candidatos: C[] }>,
        ocupados: ReadonlySet<string>,
    ): { escolhas: Map<string, C>; conflitos: Set<string> } => {
        const fortesDoTitulo = new Map<string, C[]>();
        const reivindicacoes = new Map<string, number>();
        const conflitos = new Set<string>();
        for (const { alvo, candidatos } of pendentes) {
            const fortes = candidatos.filter(
                (c) =>
                    ancoraForte(c.avaliacao.sinais) &&
                    (FORCA[c.avaliacao.resultado] ?? 9) <= FORCA_ATENCAO_ANCORADA &&
                    !ocupados.has(c.boleto.chave),
            );
            const divergem =
                fortes.some((c) => ancoradoPorDps(c.avaliacao.sinais)) &&
                fortes.some((c) => ancoradoPorNumero(c.avaliacao.sinais)) &&
                new Set(fortes.map((c) => c.boleto.chave)).size > 1;
            if (divergem) {
                conflitos.add(alvo.chave);
                continue;
            }
            fortesDoTitulo.set(alvo.chave, fortes);
            for (const c of fortes) {
                reivindicacoes.set(c.boleto.chave, (reivindicacoes.get(c.boleto.chave) ?? 0) + 1);
            }
        }
        const escolhas = new Map<string, C>();
        for (const [titulo, fortes] of fortesDoTitulo) {
            const unico = fortes.length === 1 ? fortes[0] : undefined;
            if (unico && reivindicacoes.get(unico.boleto.chave) === 1) escolhas.set(titulo, unico);
        }
        return { escolhas, conflitos };
    };

    /** Camada 1. Ambíguo (2+ da mesma força) = sem sugestão, e o título sai do jogo. */
    private camadaSegura = (
        pendentes: Pendente[],
        ocupados: Set<string>,
        resolvidos: Set<string>,
    ): SugestaoBoletoTitulo[] => {
        const resultado: SugestaoBoletoTitulo[] = [];
        for (const { alvo, candidatos } of pendentes) {
            if (resolvidos.has(alvo.chave)) continue;
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

    /**
     * Confirmação órfã (I15l): mostra o que foi decidido (snapshot da decisão) e por que não vale
     * mais. `confirmavel: false`; a tela oferece "Anular confirmação".
     */
    private orfa = (
        titulo: TituloAPagar,
        d: DecisaoConfirmadaChaveada,
        dataDebito: string | undefined,
        motivoOrfa: string,
    ): SugestaoBoletoTitulo => {
        const vencimento =
            titulo.vencimento != null
                ? this.calendar.fromErpEpoch(Number(titulo.vencimento))
                : (d.vencimentoTitulo ?? '');
        return {
            filCod: titulo.filCod,
            docCod: titulo.docCod,
            titCod: titulo.titCod,
            ...(titulo.pesCod ? { pesCod: titulo.pesCod } : {}),
            ...(titulo.credor ? { credor: titulo.credor } : {}),
            valorTitulo: titulo.valor,
            vencimentoTitulo: vencimento,
            dataDebito: dataDebito ?? vencimento,
            ddcCod: d.ddcCod,
            ditCod: d.ditCod,
            ...(d.numeroBoleto ? { numeroBoleto: d.numeroBoleto } : {}),
            valorBoleto: d.valorBoleto ?? 0,
            vencimentoBoleto: d.vencimentoBoleto ?? '',
            avaliacao: {
                resultado: d.tier ?? RESULTADO_SUGESTAO.SEM_RELACAO,
                deltaValor: d.deltaValor ?? 0,
                deltaPercentual: d.deltaPercentual ?? 0,
                deltaDias: d.deltaDias ?? 0,
                sinais: d.sinais ?? [],
                confirmavel: false,
                diasVencidoNoDebito: 0,
                exigeReconhecimento: EXIGE_RECONHECIMENTO.NENHUM,
            },
            estado: ESTADO_SUGESTAO.CONFIRMADA,
            orfa: true,
            motivoOrfa,
        };
    };

    private motivoBoletoSaiu = (d: DecisaoChaveada, entrada: EntradaMotorSugestao): string => {
        const noPool = entrada.boletos.find((b) => chaveBoleto(b) === chaveBoleto(d));
        if (!noPool) {
            return 'O boleto confirmado saiu do pool DDA (arquivo cancelado ou removido). Anule a confirmação.';
        }
        if (noPool.filCod != null && noPool.docCod && noPool.titCod) {
            return 'O Conexos vinculou o boleto confirmado a um título. Anule a confirmação.';
        }
        return 'O boleto confirmado deixou de estar livre no pool DDA. Anule a confirmação.';
    };

    /** I15r: o reconhecimento gravado ainda bate com o Δdias e o valor de AGORA? Derivado, sem coluna. */
    private reconhecimentoInvalido = (
        d: DecisaoConfirmadaChaveada,
        alvo: TituloElegivel,
        boleto: BoletoLivre,
        pares: Set<string>,
    ): boolean =>
        d.reconhecimento !== undefined &&
        !ReconhecimentoDivergencia.valido(d.reconhecimento, {
            deltaDiasAtual: this.avaliar(alvo, boleto, pares).deltaDias,
            valorBoletoAtual: boleto.centavos,
        });

    private motivoTituloSaiu = (titulo: TituloAPagar): string => {
        if (titulo.temBoleto === true) {
            return 'O Conexos já sinalizou boleto DDA para este título. Anule a confirmação.';
        }
        if (titulo.formaPagamentoConexos !== PAGO_POR_CONEXOS.BOLETO) {
            return 'O título deixou de ser pago por boleto. Anule a confirmação.';
        }
        return 'O título não tem mais as condições da confirmação. Anule a confirmação.';
    };

    // ── 4. Desfecho por título (ADR-0072) ──────────────────────────────────────────────────────

    /**
     * Todo par dentro do envelope (nunca `SEM_RELACAO`), do melhor para o pior. Ao contrário de
     * `candidatos`, não descarta o fraco nem o vencido: eles precisam ser EXIBIDOS (I15m).
     */
    private todosCandidatos = (
        alvo: TituloElegivel,
        livres: BoletoLivre[],
        ocupados: Set<string>,
        rejeitadas: Set<string>,
        pares: Set<string>,
    ): CandidatoCompleto[] => {
        const [minimo, maximo] = faixaDeCandidatos(centavos(alvo.titulo.valor));
        const achados: CandidatoCompleto[] = [];
        for (let i = this.primeiro(livres, minimo); i < livres.length; i += 1) {
            const boleto = livres[i];
            if (!boleto || boleto.centavos > maximo) break;
            if (ocupados.has(boleto.chave) || rejeitadas.has(`${alvo.chave}|${boleto.chave}`)) {
                continue;
            }
            const candidato = this.candidatoCompleto(alvo, boleto, pares);
            if (candidato.avaliacao.resultado === RESULTADO_SUGESTAO.SEM_RELACAO) continue;
            achados.push(candidato);
        }
        return achados.sort((x, y) => this.melhorCompleto(x, y));
    };

    private candidatoCompleto = (
        alvo: TituloElegivel,
        boleto: BoletoLivre,
        pares: Set<string>,
        ordemDps = false,
    ): CandidatoCompleto => {
        const avaliacao = this.avaliar(alvo, boleto, pares, ordemDps);
        const ancorado = ancoradoPor(avaliacao.sinais);
        return {
            boleto,
            avaliacao,
            ancorado,
            forca: this.forcaCompleta(avaliacao, ancorado),
            ancoraForte: ancoraForte(avaliacao.sinais),
        };
    };

    /**
     * I15p(2): pareia por ordem de DPS dentro dos escopos provados e reavalia esses pares com o
     * sinal `ORDEM_DPS`. Muta só a lista de candidatos montada nesta execução.
     */
    private ancorarPorOrdem = (
        pendentes: PendenteCompleto[],
        p: Preparo,
        entrada: EntradaMotorSugestao,
    ): void => {
        if (!entrada.dps?.length) return;
        const provas = this.ordemDps.provas(
            entrada.dps,
            entrada.boletos.map((b) => {
                const emissor = this.codigoBarras.emissor(b.codbar);
                return {
                    ...(b.numero ? { numero: b.numero } : {}),
                    ...(emissor ? { emissorChave: emissor.chave } : {}),
                };
            }),
        );
        const pares = this.ordemDps.parear({
            titulos: pendentes.map(({ alvo }) => ({
                chave: alvo.chave,
                ...(alvo.titulo.pesCod ? { pesCod: alvo.titulo.pesCod } : {}),
                ...(alvo.titulo.numeroDocumento ? { nfse: alvo.titulo.numeroDocumento } : {}),
                ...(alvo.dps ? { dps: alvo.dps } : {}),
            })),
            boletos: p.livres.map((b) => ({
                chave: b.chave,
                ...(b.emissor ? { emissorChave: b.emissor.chave } : {}),
                ...(b.numero ? { numero: b.numero } : {}),
            })),
            candidatos: new Map(
                pendentes.map(({ alvo, candidatos }) => [
                    alvo.chave,
                    candidatos.map((c) => c.boleto.chave),
                ]),
            ),
            provas,
        });
        if (pares.size === 0) return;
        for (const pendente of pendentes) {
            const { alvo } = pendente;
            pendente.candidatos = pendente.candidatos
                .map((c) =>
                    pares.has(`${alvo.chave}|${c.boleto.chave}`)
                        ? this.candidatoCompleto(alvo, c.boleto, p.pares, true)
                        : c,
                )
                .sort((x, y) => this.melhorCompleto(x, y));
        }
    };

    /**
     * I15s: marca com `NUMERO_CONFIAVEL` o candidato cujo número é igual ao do documento do título
     * quando nada na carteira, no pool ou na lista de candidatos torna o número ambíguo. Muta só a
     * lista de candidatos montada nesta execução; os índices são calculados na primeira necessidade.
     */
    private ancorarPorNumero = (
        pendentes: PendenteCompleto[],
        entrada: EntradaMotorSugestao,
    ): void => {
        let indice: IndiceNumeros | undefined;
        for (const pendente of pendentes) {
            const { alvo } = pendente;
            const numero = RegraSugestaoBoleto.normalizarNumero(alvo.titulo.numeroDocumento);
            const pesCod = alvo.titulo.pesCod;
            if (numero.length < NUMERO_CONFIAVEL_MIN_DIGITOS || !pesCod) continue;
            const unico = this.candidatoUnicoPorNumero(pendente);
            const emissor = unico?.boleto.emissor;
            if (!unico || !emissor || unico.forca > 1) continue;
            indice ??= this.indiceNumeros(entrada);
            if (indice.boletos.get(`${numero}|${emissor.chave}`)?.size !== 1) continue;
            const docs = indice.documentos.get(`${pesCod}|${numero}`);
            const proprio = `${alvo.titulo.filCod}:${alvo.titulo.docCod}`;
            if (docs && [...docs].some((d) => d !== proprio)) continue;
            pendente.candidatos = pendente.candidatos
                .map((c) =>
                    c === unico
                        ? {
                              ...c,
                              avaliacao: {
                                  ...c.avaliacao,
                                  sinais: [...c.avaliacao.sinais, SINAL_SUGESTAO.NUMERO_CONFIAVEL],
                              },
                              ancorado: true,
                              ancoraForte: true,
                          }
                        : c,
                )
                .sort((x, y) => this.melhorCompleto(x, y));
        }
    };

    /** Único candidato de número igual ao do título; o mesmo codbar repetido conta como um só. */
    private candidatoUnicoPorNumero = (
        pendente: PendenteCompleto,
    ): CandidatoCompleto | undefined => {
        const iguais = pendente.candidatos.filter((c) =>
            RegraSugestaoBoleto.numerosIguais(
                pendente.alvo.titulo.numeroDocumento,
                c.boleto.numero,
            ),
        );
        const distintos = new Set(iguais.map((c) => c.boleto.codbar ?? c.boleto.chave));
        return distintos.size === 1 ? iguais[0] : undefined;
    };

    /**
     * Contagens da guarda de duplicata (I15s): boletos do pool COMPLETO por (número, emissor), de
     * qualquer data e vinculados inclusive; e os documentos (`fil:doc`) de cada (credor, número) na
     * carteira ativa e na lista sem filtro `ativo`. Parcelas do mesmo documento são o mesmo `fil:doc`.
     */
    private indiceNumeros = (entrada: EntradaMotorSugestao): IndiceNumeros => {
        const boletos = new Map<string, Set<string>>();
        for (const b of entrada.boletos) {
            const numero = RegraSugestaoBoleto.normalizarNumero(b.numero);
            const emissor = numero ? this.codigoBarras.emissor(b.codbar) : undefined;
            if (!emissor) continue;
            const k = `${numero}|${emissor.chave}`;
            const codbares = boletos.get(k) ?? new Set<string>();
            codbares.add(b.codbar ?? chaveBoleto(b));
            boletos.set(k, codbares);
        }
        const documentos = new Map<string, Set<string>>();
        for (const t of [...entrada.titulos, ...(entrada.titulosDoCredor ?? [])]) {
            const numero = RegraSugestaoBoleto.normalizarNumero(t.numeroDocumento);
            if (!numero || !t.pesCod) continue;
            const k = `${t.pesCod}|${numero}`;
            const docs = documentos.get(k) ?? new Set<string>();
            docs.add(`${t.filCod}:${t.docCod}`);
            documentos.set(k, docs);
        }
        return { boletos, documentos };
    };

    private forcaCompleta = (a: AvaliacaoSugestao, ancorado: boolean): number => {
        if (a.resultado === RESULTADO_SUGESTAO.CONHECIDO) return 0;
        if (a.resultado === RESULTADO_SUGESTAO.FORTE) return 1;
        if (a.resultado === RESULTADO_SUGESTAO.ATENCAO) {
            return ancorado ? FORCA_ATENCAO_ANCORADA : FORCA_ATENCAO_FRACA;
        }
        return FORCA_VENCIDO;
    };

    /** Força → |Δvalor| → |Δdias| → chave do boleto: ordem total, independe da entrada. */
    private melhorCompleto = (x: CandidatoCompleto, y: CandidatoCompleto): number =>
        x.forca - y.forca ||
        Number(y.ancoraForte) - Number(x.ancoraForte) ||
        Math.abs(x.avaliacao.deltaValor) - Math.abs(y.avaliacao.deltaValor) ||
        Math.abs(x.avaliacao.deltaDias) - Math.abs(y.avaliacao.deltaDias) ||
        x.boleto.ddcCod - y.boleto.ddcCod ||
        x.boleto.ditCod - y.boleto.ditCod;

    /** Camada 0 do desfecho (I15p, I15s): a âncora forte reserva o boleto antes de tudo. */
    private reservarPorAncora = (
        pendentes: PendenteCompleto[],
        estado: {
            reservadoPor: Map<string, ChaveTitulo>;
            escolhido: Map<string, CandidatoCompleto>;
            situacao: Map<string, SituacaoSugestaoTitulo>;
            conflitos: Set<string>;
        },
    ): void => {
        const alvoPorChave = new Map(pendentes.map(({ alvo }) => [alvo.chave, alvo]));
        const { escolhas, conflitos } = this.escolhasPorAncora(pendentes, new Set());
        for (const titulo of conflitos) {
            estado.conflitos.add(titulo);
            estado.situacao.set(titulo, SITUACAO_SUGESTAO_TITULO.AMBIGUA);
        }
        for (const [titulo, c] of escolhas) {
            const alvo = alvoPorChave.get(titulo);
            if (!alvo) continue;
            estado.reservadoPor.set(c.boleto.chave, this.chaveDe(alvo));
            estado.escolhido.set(titulo, c);
            estado.situacao.set(
                titulo,
                c.forca <= 1
                    ? SITUACAO_SUGESTAO_TITULO.UNICA_SEGURA
                    : SITUACAO_SUGESTAO_TITULO.SO_ATENCAO,
            );
        }
    };

    /**
     * Mesmas camadas do contrato legado (seguros → ATENCAO ancorada), com prioridade do TÍTULO de
     * menor vencimento; só seguro e ATENCAO ancorada RESERVAM o boleto. O que sobra sem escolha
     * vira desfecho informativo: `DISPUTADA` quando o melhor candidato está reservado a outro
     * título (nunca `SEM_CANDIDATO` por perder disputa, I15n), senão `SO_FRACA`/`SO_VENCIDA`.
     */
    private alocarDesfechos = (pendentes: PendenteCompleto[]): DesfechoTitulo[] => {
        const reservadoPor = new Map<string, ChaveTitulo>();
        const escolhido = new Map<string, CandidatoCompleto>();
        const situacao = new Map<string, SituacaoSugestaoTitulo>();
        const conflitos = new Set<string>();
        this.reservarPorAncora(pendentes, { reservadoPor, escolhido, situacao, conflitos });

        // Camada 1: seguros. 2+ da mesma força = ambíguo (sem reserva).
        for (const { alvo, candidatos } of pendentes) {
            if (situacao.has(alvo.chave)) continue;
            const seguros = candidatos.filter((c) => c.forca <= 1);
            const topo = seguros[0];
            if (!topo) continue;
            const empatados = seguros.filter(
                (c) => c.avaliacao.resultado === topo.avaliacao.resultado,
            );
            if (empatados.length > 1) {
                situacao.set(alvo.chave, SITUACAO_SUGESTAO_TITULO.AMBIGUA);
                continue;
            }
            if (reservadoPor.has(topo.boleto.chave)) continue; // perdeu a disputa
            reservadoPor.set(topo.boleto.chave, this.chaveDe(alvo));
            escolhido.set(alvo.chave, topo);
            situacao.set(alvo.chave, SITUACAO_SUGESTAO_TITULO.UNICA_SEGURA);
        }
        // Camada 2: ATENCAO com âncora (só vê o que a camada 1 e os anteriores deixaram livre).
        for (const { alvo, candidatos } of pendentes) {
            if (situacao.has(alvo.chave)) continue;
            const c = candidatos.find(
                (x) => x.forca === FORCA_ATENCAO_ANCORADA && !reservadoPor.has(x.boleto.chave),
            );
            if (!c) continue;
            reservadoPor.set(c.boleto.chave, this.chaveDe(alvo));
            escolhido.set(alvo.chave, c);
            situacao.set(alvo.chave, SITUACAO_SUGESTAO_TITULO.SO_ATENCAO);
        }

        // Vistas de cada boleto NÃO reservado, para marcar `compartilhado`.
        const exibicoes = new Map<string, number>();
        const exibidos = pendentes.map(({ alvo, candidatos }) => {
            const exibir = this.exibir(candidatos, escolhido.get(alvo.chave));
            for (const c of exibir) {
                exibicoes.set(c.boleto.chave, (exibicoes.get(c.boleto.chave) ?? 0) + 1);
            }
            return exibir;
        });

        return pendentes.map(({ alvo, candidatos }, i) => {
            const escolha = escolhido.get(alvo.chave);
            const sit =
                situacao.get(alvo.chave) ?? this.situacaoSemEscolha(candidatos, reservadoPor);
            return {
                ...this.chaveDe(alvo),
                ...(alvo.titulo.pesCod ? { pesCod: alvo.titulo.pesCod } : {}),
                ...(alvo.titulo.credor ? { credor: alvo.titulo.credor } : {}),
                valorTitulo: alvo.titulo.valor,
                vencimentoTitulo: alvo.vencimento,
                dataDebito: alvo.dataDebito,
                situacao: sit,
                candidatos: (exibidos[i] ?? []).map((c) =>
                    this.paraCandidato(c, {
                        confirmavel: c === escolha,
                        dono: reservadoPor.get(c.boleto.chave),
                        titulo: alvo.chave,
                        situacao: sit,
                        exibicoes: exibicoes.get(c.boleto.chave) ?? 0,
                    }),
                ),
                totalCandidatos: candidatos.length,
                motivo: conflitos.has(alvo.chave)
                    ? MOTIVO_CONFLITO_ANCORAS
                    : MOTIVO_POR_SITUACAO[sit],
            };
        });
    };

    private paraCandidato = (
        c: CandidatoCompleto,
        ctx: {
            confirmavel: boolean;
            dono: ChaveTitulo | undefined;
            titulo: string;
            situacao: SituacaoSugestaoTitulo;
            exibicoes: number;
        },
    ): CandidatoTitulo => {
        const { confirmavel, dono } = ctx;
        const reservadoParaOutro =
            dono != null && chaveTitulo(dono) !== ctx.titulo ? dono : undefined;
        const compartilhado = dono == null && ctx.exibicoes > 1;
        const motivo = confirmavel
            ? undefined
            : this.motivoCandidato(c, ctx.situacao, reservadoParaOutro);
        return {
            ddcCod: c.boleto.ddcCod,
            ditCod: c.boleto.ditCod,
            ...(c.boleto.numero ? { numeroBoleto: c.boleto.numero } : {}),
            valorBoleto: c.boleto.valor,
            vencimentoBoleto: c.boleto.vencimento,
            ...(c.boleto.emissor ? { emissor: c.boleto.emissor } : {}),
            avaliacao: { ...c.avaliacao, confirmavel },
            ancorado: c.ancorado,
            confirmavel,
            ...(compartilhado ? { compartilhado: true } : {}),
            ...(reservadoParaOutro ? { reservadoParaTitulo: reservadoParaOutro } : {}),
            ...(motivo ? { motivo } : {}),
        };
    };

    /** Escolhido primeiro, depois os demais na ordem de força; corta em `SUGESTAO_TOP_CANDIDATOS`. */
    private exibir = (
        candidatos: CandidatoCompleto[],
        escolhido: CandidatoCompleto | undefined,
    ): CandidatoCompleto[] => {
        const ordem = escolhido
            ? [escolhido, ...candidatos.filter((c) => c !== escolhido)]
            : candidatos;
        return ordem.slice(0, SUGESTAO_TOP_CANDIDATOS);
    };

    private situacaoSemEscolha = (
        candidatos: CandidatoCompleto[],
        reservadoPor: Map<string, ChaveTitulo>,
    ): SituacaoSugestaoTitulo => {
        const melhor = candidatos[0];
        if (!melhor) return SITUACAO_SUGESTAO_TITULO.SEM_CANDIDATO;
        if (reservadoPor.has(melhor.boleto.chave)) return SITUACAO_SUGESTAO_TITULO.DISPUTADA;
        return melhor.forca === FORCA_VENCIDO
            ? SITUACAO_SUGESTAO_TITULO.SO_VENCIDA
            : SITUACAO_SUGESTAO_TITULO.SO_FRACA;
    };

    private motivoCandidato = (
        c: CandidatoCompleto,
        situacao: SituacaoSugestaoTitulo,
        reservadoPara: ChaveTitulo | undefined,
    ): string => {
        if (reservadoPara) {
            return `Boleto reservado ao título ${reservadoPara.docCod} (${reservadoPara.filCod}/${reservadoPara.titCod}).`;
        }
        if (c.forca === FORCA_VENCIDO) return MOTIVO_VENCIDO;
        if (situacao === SITUACAO_SUGESTAO_TITULO.AMBIGUA && c.forca <= 1) return MOTIVO_AMBIGUO;
        if (c.forca === FORCA_ATENCAO_FRACA) return MOTIVO_FRACO;
        return MOTIVO_MAIS_FORTE;
    };

    /** CONFIRMADA viva ou ORFA: o desfecho carrega só o boleto da decisão. */
    /** ADR-0074 M1: quem decidiu (herdado na transferência) e a marca do sistema. */
    private autoria = (
        d: DecisaoConfirmadaChaveada,
    ): { decididoPor?: string; transferidaPor?: string } => ({
        ...(d.decididoPor ? { decididoPor: d.decididoPor } : {}),
        ...(d.transferidaPor ? { transferidaPor: d.transferidaPor } : {}),
    });

    /** I15q: título em grupo confirmado — sem candidatos, nunca confirmável no 1:1. */
    private desfechoEmGrupo = (alvo: TituloElegivel, grupoId: string): DesfechoTitulo => ({
        filCod: alvo.titulo.filCod,
        docCod: alvo.titulo.docCod,
        titCod: alvo.titulo.titCod,
        ...(alvo.titulo.pesCod ? { pesCod: alvo.titulo.pesCod } : {}),
        ...(alvo.titulo.credor ? { credor: alvo.titulo.credor } : {}),
        valorTitulo: alvo.titulo.valor,
        vencimentoTitulo: alvo.vencimento,
        dataDebito: alvo.dataDebito,
        situacao: SITUACAO_SUGESTAO_TITULO.EM_GRUPO,
        candidatos: [],
        totalCandidatos: 0,
        motivo: MOTIVO_POR_SITUACAO[SITUACAO_SUGESTAO_TITULO.EM_GRUPO],
        grupoBoletoId: grupoId,
    });

    private desfechoDeDecisao = (
        s: SugestaoBoletoTitulo,
        situacao: SituacaoSugestaoTitulo,
    ): DesfechoTitulo => ({
        filCod: s.filCod,
        docCod: s.docCod,
        titCod: s.titCod,
        ...(s.pesCod ? { pesCod: s.pesCod } : {}),
        ...(s.credor ? { credor: s.credor } : {}),
        valorTitulo: s.valorTitulo,
        vencimentoTitulo: s.vencimentoTitulo,
        dataDebito: s.dataDebito,
        situacao,
        candidatos: [
            {
                ddcCod: s.ddcCod,
                ditCod: s.ditCod,
                ...(s.numeroBoleto ? { numeroBoleto: s.numeroBoleto } : {}),
                valorBoleto: s.valorBoleto,
                vencimentoBoleto: s.vencimentoBoleto,
                ...(s.emissor ? { emissor: s.emissor } : {}),
                avaliacao: s.avaliacao,
                ancorado: ancoradoPor(s.avaliacao.sinais),
                confirmavel: false,
                ...(s.motivoOrfa ? { motivo: s.motivoOrfa } : {}),
                ...(s.decididoPor ? { decididoPor: s.decididoPor } : {}),
                ...(s.transferidaPor ? { transferidaPor: s.transferidaPor } : {}),
            },
        ],
        totalCandidatos: 1,
        motivo: s.motivoOrfa ?? MOTIVO_POR_SITUACAO[situacao],
        ...(s.motivoOrfa ? { motivoOrfa: s.motivoOrfa } : {}),
    });

    private chaveDe = (alvo: TituloElegivel): ChaveTitulo => ({
        filCod: alvo.titulo.filCod,
        docCod: alvo.titulo.docCod,
        titCod: alvo.titulo.titCod,
    });

    private prioridadeDesfecho = (x: DesfechoTitulo, y: DesfechoTitulo): number =>
        x.vencimentoTitulo.localeCompare(y.vencimentoTitulo) ||
        comparaDoc(x.docCod, y.docCod) ||
        x.filCod - y.filCod ||
        comparaDoc(x.titCod, y.titCod);

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
