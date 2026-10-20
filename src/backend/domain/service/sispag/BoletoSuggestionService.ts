import { inject, injectable } from 'tsyringe';
import PostgreeDatabaseClient, {
    type TransactionClient,
} from '../../client/database/PostgreeDatabaseClient.js';
import BoletoAlreadySuggestedToOtherTitleError from '../../errors/BoletoAlreadySuggestedToOtherTitleError.js';
import BoletoSuggestionNotAvailableError from '../../errors/BoletoSuggestionNotAvailableError.js';
import DecisionNotConfirmedError from '../../errors/DecisionNotConfirmedError.js';
import InvalidDecisionActorError from '../../errors/InvalidDecisionActorError.js';
import IssuerConfirmationNotFoundError from '../../errors/IssuerConfirmationNotFoundError.js';
import IssuerConfirmationReasonRequiredError from '../../errors/IssuerConfirmationReasonRequiredError.js';
import IssuerConfirmationVersionConflictError from '../../errors/IssuerConfirmationVersionConflictError.js';
import LineCopyAuditFailedError from '../../errors/LineCopyAuditFailedError.js';
import OverdueBoletoNotConfirmableError from '../../errors/OverdueBoletoNotConfirmableError.js';
import TitleSuggestionNotFoundError from '../../errors/TitleSuggestionNotFoundError.js';
import WarningAcknowledgementRequiredError from '../../errors/WarningAcknowledgementRequiredError.js';
import type { BoletoDda } from '../../interface/sispag/BoletoDda.js';
import {
    type ConfirmacaoEmissor,
    type ConfirmacaoEmissorView,
    DECISAO_SUGESTAO_BOLETO,
    type DecisaoSugestao,
    ESTADO_CONFIRMACAO_EMISSOR,
    EVENTO_SUGESTAO_BOLETO,
    type EstadoConfirmacaoEmissor,
} from '../../interface/sispag/ConfirmacaoEmissorBoleto.js';
import type { TituloAPagar } from '../../interface/sispag/SispagInterface.js';
import {
    AVISO_VENCE_ANTES,
    type AvaliacaoSugestao,
    type AvisoVenceAntes,
    type CandidatoTitulo,
    DDA_DEFASADO_HORAS,
    type DesfechoTitulo,
    type DpsConhecido,
    type DesfechoTituloView,
    ESTADO_SUGESTAO,
    type FiltroSugestoes,
    LAYOUT_EMISSOR,
    type ListagemSugestoes,
    RESULTADO_SUGESTAO,
    type ResultadoSugestao,
    SINAL_SUGESTAO,
    SITUACAO_SUGESTAO_TITULO,
    type SinalSugestao,
    type SituacaoSugestaoTitulo,
    SUGESTAO_TAMANHO_MAXIMO,
    SUGESTAO_TAMANHO_PADRAO,
    type SugestaoBoletoTitulo,
    type SugestaoBoletoView,
    TIER_SUGESTAO,
    type TierSugestao,
} from '../../interface/sispag/SugestaoBoleto.js';
import { LOG_TYPE } from '../../interface/log/LogInterface.js';
import CodigoBarrasBoleto from '../../libs/boleto/CodigoBarrasBoleto.js';
import BankingCalendar from '../../libs/calendar/BankingCalendar.js';
import BoletoDdaRepository from '../../repository/sispag/BoletoDdaRepository.js';
import LotePagamentoRepository from '../../repository/sispag/LotePagamentoRepository.js';
import SugestaoBoletoRepository from '../../repository/sispag/SugestaoBoletoRepository.js';
import TituloAPagarRepository from '../../repository/sispag/TituloAPagarRepository.js';
import TituloDpsRepository from '../../repository/sispag/TituloDpsRepository.js';
import LogService from '../LogService.js';
import MotorSugestaoBoleto from './MotorSugestaoBoleto.js';
import RegraSugestaoBoleto from './RegraSugestaoBoleto.js';
import SugestaoBoletoCache from './SugestaoBoletoCache.js';

export interface ChaveSugestao {
    filCod: number;
    docCod: string;
    titCod: string;
    ddcCod: number;
    ditCod: number;
}

export interface ResultadoAnulacao {
    /** `false` = a decisão já estava ANULADA (idempotência): nada novo foi gravado. */
    anulada: boolean;
    decisao: DecisaoSugestao;
}

/** Motivo mínimo de uma anulação (a decisão desfeita era evidência de uma pessoa). */
const MOTIVO_ANULACAO_MINIMO = 10;

export interface ResultadoDecisao {
    /** `false` = a decisão já existia (idempotência, I15j): nada novo foi gravado. */
    criada: boolean;
    decisao: DecisaoSugestao;
}

/** O que a listagem guarda em cache: o motor + os pares + o frescor do DDA (`ultimaSincronizacao`). */
interface CenarioSugestoes {
    sugestoes: SugestaoBoletoTitulo[];
    /** Desfecho por título elegível (I15m): uma linha por título. */
    desfechos: DesfechoTitulo[];
    pares: ConfirmacaoEmissor[];
    datasDebito: Map<string, string>;
    sincronizadoEm: number | undefined;
}

const HORA_MS = 60 * 60 * 1000;
const ATORES_RECUSADOS = new Set(['sistema', 'unknown', '']);
const EMISSOR_DESCONHECIDO = 'SEM_EMISSOR';
const CODBAR_DESCONHECIDO = '(sem código de barras)';

const chaveTitulo = (c: { filCod: number; docCod: string; titCod: string }): string =>
    `${c.filCod}:${c.docCod}:${c.titCod}`;

const mesmoTitulo = (
    a: { filCod: number; docCod: string; titCod: string },
    b: { filCod: number; docCod: string; titCod: string },
): boolean => chaveTitulo(a) === chaveTitulo(b);

const TIERS: ReadonlySet<string> = new Set(Object.values(TIER_SUGESTAO));

/**
 * BoletoSuggestionService — sugerir, confirmar, rejeitar, anular, revogar e copiar a linha digitável
 * (ADR-0068, I15; ontologia `sugestao-boleto-dda-sispag.md`). PASSO 1: EVIDÊNCIA, não autoridade.
 *
 * - **Zero escrita e zero leitura no Conexos**: este serviço só conhece Postgres (carteira e pool
 *   `fin124` persistidos). Nenhum client do ERP é injetado; `temBoleto`, lote e título ficam
 *   intactos (I15a/I15b). A validação ao vivo da remessa (ADR-0040) segue sendo a autoridade.
 * - **Ator**: sempre o usuário autenticado, recebido da rota; nunca `sistema` (I15g).
 * - **Anti-TOCTOU**: `confirmar` relê título e boleto do banco e reavalia a regra e a disputa com o
 *   pool de agora; o que a tela mostrou ontem não vale.
 * - **Linha digitável**: nunca na listagem; só em `copiarLinha`, que grava `LINHA_COPIADA` ANTES de
 *   devolvê-la e falha fechada se a trilha não grava (I15k).
 * - **Cache** (`SugestaoBoletoCache`): SÓ a listagem usa o cenário em cache (single-flight, TTL
 *   curto). `confirmar`, `rejeitar` e `anularDecisao` releem o banco ao vivo e NUNCA confiam nele;
 *   toda decisão e revogação invalida o cache do processo.
 * - **Logs**: português, sem barras nem linha digitável (só a forma mascarada).
 */
@injectable()
export default class BoletoSuggestionService {
    public constructor(
        @inject(SugestaoBoletoRepository) private readonly repo: SugestaoBoletoRepository,
        @inject(TituloAPagarRepository) private readonly tituloRepo: TituloAPagarRepository,
        @inject(BoletoDdaRepository) private readonly boletoRepo: BoletoDdaRepository,
        @inject(LotePagamentoRepository) private readonly loteRepo: LotePagamentoRepository,
        @inject(MotorSugestaoBoleto) private readonly motor: MotorSugestaoBoleto,
        @inject(RegraSugestaoBoleto) private readonly regra: RegraSugestaoBoleto,
        @inject(CodigoBarrasBoleto) private readonly codigoBarras: CodigoBarrasBoleto,
        @inject(BankingCalendar) private readonly calendar: BankingCalendar,
        @inject(PostgreeDatabaseClient) private readonly db: PostgreeDatabaseClient,
        @inject(LogService) private readonly logService: LogService,
        @inject(SugestaoBoletoCache) private readonly cache: SugestaoBoletoCache,
        @inject(TituloDpsRepository) private readonly dpsRepo: TituloDpsRepository,
    ) {}

    // ── Leitura ────────────────────────────────────────────────────────────────────────────────

    /**
     * Sugestões por título, com o emissor mascarado e SEM barras nem linha digitável. `titulos` traz
     * UMA linha por título elegível (I15m); `sugestoes` mantém o contrato anterior.
     */
    public listarSugestoes = async (filtro: FiltroSugestoes): Promise<ListagemSugestoes> => {
        const { valor: cenario } = await this.cache.obter(this.calcularCenario);
        const { sincronizadoEm } = cenario;
        const parPorChave = new Map(
            cenario.pares.map((p) => [`${p.pesCod}|${p.emissorChave}`, p.id] as const),
        );
        const daBase = (x: { filCod: number; pesCod?: string }): boolean =>
            (filtro.filCod === undefined || x.filCod === filtro.filCod) &&
            (filtro.pesCod === undefined || x.pesCod === filtro.pesCod);
        const base = cenario.sugestoes.filter(daBase);
        const baseTitulos = cenario.desfechos.filter(daBase);
        const contagem = Object.fromEntries(
            Object.values(RESULTADO_SUGESTAO).map((r) => [r, 0]),
        ) as Record<ResultadoSugestao, number>;
        for (const s of base) contagem[s.avaliacao.resultado] += 1;
        const contagemSituacao = Object.fromEntries(
            Object.values(SITUACAO_SUGESTAO_TITULO).map((r) => [r, 0]),
        ) as Record<SituacaoSugestaoTitulo, number>;
        for (const d of baseTitulos) contagemSituacao[d.situacao] += 1;

        const titulosFiltrados = baseTitulos.filter(
            (d) => filtro.situacao === undefined || d.situacao === filtro.situacao,
        );
        const chavesDaSituacao =
            filtro.situacao === undefined ? undefined : new Set(titulosFiltrados.map(chaveTitulo));
        const filtradas = base
            .filter((s) => filtro.tier === undefined || s.avaliacao.resultado === filtro.tier)
            .filter((s) => chavesDaSituacao === undefined || chavesDaSituacao.has(chaveTitulo(s)));
        const tamanho = Math.min(
            Math.max(filtro.tamanho ?? SUGESTAO_TAMANHO_PADRAO, 1),
            SUGESTAO_TAMANHO_MAXIMO,
        );
        const pagina = Math.max(filtro.pagina ?? 1, 1);
        const recorte = filtradas.slice((pagina - 1) * tamanho, pagina * tamanho);
        const recorteTitulos = titulosFiltrados.slice((pagina - 1) * tamanho, pagina * tamanho);
        const defasado = this.horasDefasado(sincronizadoEm);
        return {
            sugestoes: recorte.map((s) => this.paraView(s, parPorChave)),
            titulos: recorteTitulos.map((d) => this.paraViewDesfecho(d, parPorChave)),
            totalTitulos: titulosFiltrados.length,
            total: filtradas.length,
            pagina,
            tamanho,
            contagem,
            contagemSituacao,
            ...(sincronizadoEm != null ? { sincronizadoEm } : {}),
            ...(defasado != null ? { ddaDefasadoHoras: defasado } : {}),
        };
    };

    /** Candidatos de UM título (até `SUGESTAO_TOP_CANDIDATOS`), sob demanda; nunca barras (I15k). */
    public detalharTitulo = async (chave: {
        filCod: number;
        docCod: string;
        titCod: string;
    }): Promise<DesfechoTituloView> => {
        const { valor: cenario } = await this.cache.obter(this.calcularCenario);
        const desfecho = cenario.desfechos.find((d) => mesmoTitulo(d, chave));
        if (!desfecho) throw new TitleSuggestionNotFoundError(chave);
        const parPorChave = new Map(
            cenario.pares.map((p) => [`${p.pesCod}|${p.emissorChave}`, p.id] as const),
        );
        return this.paraViewDesfecho(desfecho, parPorChave);
    };

    /** Pares (credor, emissor), só com a máscara do emissor. */
    public listarConfirmacoes = async (
        filtro: { estado?: EstadoConfirmacaoEmissor; pesCod?: string } = {},
    ): Promise<ConfirmacaoEmissorView[]> =>
        (await this.repo.listarPares(filtro)).map(this.paraViewPar);

    // ── Confirmar ──────────────────────────────────────────────────────────────────────────────

    public confirmar = async (
        input: ChaveSugestao & { ator: string; reconheceAvisos?: SinalSugestao[] },
    ): Promise<ResultadoDecisao> => {
        this.exigirAtor(input.ator);
        const chave = this.chave(input);

        // Idempotência e unicidade já decididas (I15j): sem tocar em transação.
        const doBoleto = await this.repo.listarDecisoes({
            decisao: DECISAO_SUGESTAO_BOLETO.CONFIRMADA,
            ddcCod: chave.ddcCod,
            ditCod: chave.ditCod,
        });
        const donoDoBoleto = doBoleto[0];
        if (donoDoBoleto) {
            if (mesmoTitulo(donoDoBoleto, chave)) return { criada: false, decisao: donoDoBoleto };
            throw new BoletoAlreadySuggestedToOtherTitleError(chave);
        }
        const doTitulo = await this.repo.listarDecisoes({
            decisao: DECISAO_SUGESTAO_BOLETO.CONFIRMADA,
            filCod: chave.filCod,
            docCod: chave.docCod,
            titCod: chave.titCod,
        });
        if (doTitulo[0]) {
            throw new BoletoSuggestionNotAvailableError({
                ...chave,
                motivo: 'Este título já tem um boleto confirmado.',
            });
        }

        // Releitura (anti-TOCTOU): o que vale é o banco de agora.
        const { titulo, boleto } = await this.reler(chave);
        const emissor = this.codigoBarras.emissor(boleto.codbar);
        if (!titulo.pesCod) {
            throw new BoletoSuggestionNotAvailableError({
                ...chave,
                motivo: 'O título não tem credor identificado.',
            });
        }
        if (!emissor) {
            throw new BoletoSuggestionNotAvailableError({
                ...chave,
                motivo: 'O boleto não tem código de barras válido para identificar o emissor.',
            });
        }

        const cenario = await this.sugerirAgora();
        const pesCod = titulo.pesCod;
        const parVigente = cenario.pares.some(
            (p) => p.pesCod === pesCod && p.emissorChave === emissor.chave,
        );
        const avaliacaoDireta = this.avaliar(titulo, boleto, cenario.datasDebito, parVigente);
        if (avaliacaoDireta.resultado === RESULTADO_SUGESTAO.VENCIDO_INFORMATIVO) {
            throw new OverdueBoletoNotConfirmableError(chave);
        }
        if (!avaliacaoDireta.confirmavel) throw new BoletoSuggestionNotAvailableError(chave);

        // Só o candidato ESCOLHIDO pelo motor é confirmável (I15m): fraco, ambíguo e disputado são
        // exibidos, mas o servidor os recusa com o motivo — independente da regra pura.
        const sugestao = this.sugestaoConfirmavel(cenario.desfechos, chave);
        const tier = sugestao.avaliacao.resultado;
        if (!TIERS.has(tier)) throw new OverdueBoletoNotConfirmableError(chave);
        // Aviso (I15o): conferido contra a avaliação RECALCULADA acima, nunca contra o cache.
        const sinais = this.exigirReconhecimento(sugestao, input.reconheceAvisos ?? [], chave);
        const reconhecimento = sinais.includes(SINAL_SUGESTAO.RECONHECEU_VENCE_ANTES)
            ? { reconheceu: [SINAL_SUGESTAO.VENCE_ANTES_DO_TITULO] }
            : {};

        const resultado = await this.db.withTransaction(async (tx) => {
            const existente = await this.repo.buscarParVigente(pesCod, emissor.chave, tx, true);
            let par: ConfirmacaoEmissor;
            let parCriado = false;
            if (existente) {
                par = existente;
            } else {
                const inserido = await this.repo.inserirPar(
                    {
                        pesCod,
                        ...(titulo.credor ? { credor: titulo.credor } : {}),
                        emissorChave: emissor.chave,
                        layoutEmissor: emissor.layout,
                        bancoEmissor: emissor.banco,
                        emissorMascarado: emissor.mascarado,
                        evidencia: this.evidencia(sugestao, input.ator, sinais),
                        confirmadoPor: input.ator,
                    },
                    tx,
                );
                par = inserido.par;
                parCriado = inserido.criado;
            }

            const gravada = await this.repo.inserirDecisao(
                {
                    filCod: sugestao.filCod,
                    docCod: sugestao.docCod,
                    titCod: sugestao.titCod,
                    pesCod,
                    ...(titulo.credor ? { credor: titulo.credor } : {}),
                    ddcCod: sugestao.ddcCod,
                    ditCod: sugestao.ditCod,
                    ...(sugestao.numeroBoleto ? { numeroBoleto: sugestao.numeroBoleto } : {}),
                    codbarMascarado:
                        this.codigoBarras.mascarar(boleto.codbar) ?? CODBAR_DESCONHECIDO,
                    valorTitulo: sugestao.valorTitulo,
                    vencimentoTitulo: sugestao.vencimentoTitulo,
                    valorBoleto: sugestao.valorBoleto,
                    vencimentoBoleto: sugestao.vencimentoBoleto,
                    deltaValor: sugestao.avaliacao.deltaValor,
                    deltaPercentual: sugestao.avaliacao.deltaPercentual,
                    deltaDias: sugestao.avaliacao.deltaDias,
                    sinais,
                    tier: tier as TierSugestao,
                    emissorChave: emissor.chave,
                    decisao: DECISAO_SUGESTAO_BOLETO.CONFIRMADA,
                    decididoPor: input.ator,
                    confirmacaoEmissorId: par.id,
                },
                tx,
            );
            if (!gravada.criada) {
                // Perdeu a corrida (I15j): idempotente se a vencedora é este mesmo par; senão, nomeia.
                const v = gravada.decisao;
                if (
                    mesmoTitulo(v, chave) &&
                    v.ddcCod === chave.ddcCod &&
                    v.ditCod === chave.ditCod
                ) {
                    return { criada: false, decisao: v };
                }
                if (v.ddcCod === chave.ddcCod && v.ditCod === chave.ditCod) {
                    throw new BoletoAlreadySuggestedToOtherTitleError(chave);
                }
                throw new BoletoSuggestionNotAvailableError({
                    ...chave,
                    motivo: 'Este título já tem um boleto confirmado.',
                });
            }

            if (parCriado) {
                await this.repo.inserirEvento(
                    {
                        tipo: EVENTO_SUGESTAO_BOLETO.PAR_CONFIRMADO,
                        ator: input.ator,
                        pesCod,
                        emissorChave: emissor.chave,
                        detalhe: {
                            layoutEmissor: emissor.layout,
                            emissorMascarado: emissor.mascarado,
                        },
                    },
                    tx,
                );
            }
            await this.repo.inserirEvento(
                {
                    tipo: EVENTO_SUGESTAO_BOLETO.DECISAO_CONFIRMADA,
                    ator: input.ator,
                    pesCod,
                    emissorChave: emissor.chave,
                    ...this.camposChave(chave),
                    detalhe: {
                        tier,
                        deltaValor: sugestao.avaliacao.deltaValor,
                        deltaDias: sugestao.avaliacao.deltaDias,
                        sinais,
                        ...reconhecimento,
                    },
                },
                tx,
            );
            return { criada: true, decisao: gravada.decisao };
        });

        this.cache.invalidar();
        if (resultado.criada) {
            await this.logService.info({
                type: LOG_TYPE.BUSINESS_INFO,
                message: 'sugestao_boleto.decisao',
                data: {
                    decisao: DECISAO_SUGESTAO_BOLETO.CONFIRMADA,
                    tier,
                    layoutEmissor: emissor.layout,
                    pesCod,
                    ator: input.ator,
                },
            });
        }
        return resultado;
    };

    // ── Rejeitar ───────────────────────────────────────────────────────────────────────────────

    public rejeitar = async (
        input: ChaveSugestao & { motivo: string; ator: string },
    ): Promise<ResultadoDecisao> => {
        this.exigirAtor(input.ator);
        const motivo = input.motivo.trim();
        if (motivo === '') {
            throw new IssuerConfirmationReasonRequiredError({ acao: 'rejeitar a sugestão' });
        }
        const chave = this.chave(input);
        const confirmadas = await this.repo.listarDecisoes({
            decisao: DECISAO_SUGESTAO_BOLETO.CONFIRMADA,
            ddcCod: chave.ddcCod,
            ditCod: chave.ditCod,
        });
        if (confirmadas.some((d) => mesmoTitulo(d, chave))) {
            throw new BoletoSuggestionNotAvailableError({
                ...chave,
                motivo: 'Esta sugestão já foi confirmada; revogue o par para desfazer.',
            });
        }
        const { titulo, boleto } = await this.reler(chave);
        const emissor = this.codigoBarras.emissor(boleto.codbar);
        if (!titulo.pesCod) {
            throw new BoletoSuggestionNotAvailableError({
                ...chave,
                motivo: 'O título não tem credor identificado.',
            });
        }
        if (titulo.vencimento == null || !boleto.vencimento) {
            throw new BoletoSuggestionNotAvailableError({
                ...chave,
                motivo: 'O título ou o boleto não tem vencimento informado.',
            });
        }
        const pesCod = titulo.pesCod;
        const vencimentoBoleto = boleto.vencimento;
        const [pares, emLotes] = await Promise.all([
            this.repo.listarParesVigentes([pesCod]),
            this.loteRepo.listTitulosEmLotesAbertos(),
        ]);
        const avaliacao = this.avaliar(
            titulo,
            boleto,
            this.mapaDatasDebito(emLotes),
            emissor != null && pares.some((p) => p.emissorChave === emissor.chave),
        );
        // Q2: rejeitar o que está exibido e não é confirmável ajuda a limpar ruído; o vencido na
        // data de débito (I15h) é só informativo — não há o que rejeitar.
        if (avaliacao.resultado === RESULTADO_SUGESTAO.VENCIDO_INFORMATIVO) {
            throw new BoletoSuggestionNotAvailableError({
                ...chave,
                motivo: 'Boleto vencido na data de débito: é só informativo e não pode ser rejeitado.',
            });
        }
        const tier = TIERS.has(avaliacao.resultado) ? (avaliacao.resultado as TierSugestao) : null;
        const vencimento = this.vencimentoCivil(titulo);

        const resultado = await this.db.withTransaction(async (tx) => {
            const gravada = await this.repo.inserirDecisao(
                {
                    ...this.camposChave(chave),
                    pesCod,
                    ...(titulo.credor ? { credor: titulo.credor } : {}),
                    ...(boleto.numero ? { numeroBoleto: boleto.numero } : {}),
                    codbarMascarado:
                        this.codigoBarras.mascarar(boleto.codbar) ?? CODBAR_DESCONHECIDO,
                    valorTitulo: titulo.valor,
                    vencimentoTitulo: vencimento,
                    valorBoleto: boleto.valor,
                    vencimentoBoleto,
                    deltaValor: avaliacao.deltaValor,
                    deltaPercentual: avaliacao.deltaPercentual,
                    deltaDias: avaliacao.deltaDias,
                    sinais: avaliacao.sinais,
                    ...(tier ? { tier } : {}),
                    emissorChave: emissor?.chave ?? EMISSOR_DESCONHECIDO,
                    decisao: DECISAO_SUGESTAO_BOLETO.REJEITADA,
                    decididoPor: input.ator,
                    motivo,
                },
                tx,
            );
            if (gravada.criada) {
                await this.repo.inserirEvento(
                    {
                        tipo: EVENTO_SUGESTAO_BOLETO.DECISAO_REJEITADA,
                        ator: input.ator,
                        ...(pesCod ? { pesCod } : {}),
                        ...(emissor ? { emissorChave: emissor.chave } : {}),
                        ...this.camposChave(chave),
                        motivo,
                        detalhe: { tier, deltaValor: avaliacao.deltaValor },
                    },
                    tx,
                );
            }
            return gravada;
        });
        this.cache.invalidar();
        if (resultado.criada) {
            await this.logService.info({
                type: LOG_TYPE.BUSINESS_INFO,
                message: 'sugestao_boleto.decisao',
                data: {
                    decisao: DECISAO_SUGESTAO_BOLETO.REJEITADA,
                    tier,
                    layoutEmissor: emissor?.layout ?? LAYOUT_EMISSOR.GENERICO,
                    pesCod,
                    ator: input.ator,
                },
            });
        }
        return resultado;
    };

    // ── Revogar ────────────────────────────────────────────────────────────────────────────────

    /** Qualquer pessoa com `sispag:executar` revoga, com motivo (I15g, Q-A). No-op se já revogado. */
    public revogarPar = async (input: {
        id: string;
        motivo: string;
        ator: string;
    }): Promise<ConfirmacaoEmissorView> => {
        this.exigirAtor(input.ator);
        const motivo = input.motivo.trim();
        if (motivo === '') {
            throw new IssuerConfirmationReasonRequiredError({ acao: 'revogar a confirmação' });
        }
        const par = await this.repo.buscarParPorId(input.id);
        if (!par) throw new IssuerConfirmationNotFoundError({ id: input.id });
        if (par.estado === ESTADO_CONFIRMACAO_EMISSOR.REVOGADA) return this.paraViewPar(par);

        const revogado = await this.db.withTransaction(async (tx) => {
            const n = await this.repo.revogarPar(
                { id: par.id, versaoEsperada: par.versao, ator: input.ator, motivo },
                tx,
            );
            const atual = await this.repo.buscarParPorId(par.id, tx);
            if (!atual) throw new IssuerConfirmationNotFoundError({ id: par.id });
            if (n === 0) {
                if (atual.estado === ESTADO_CONFIRMACAO_EMISSOR.REVOGADA) return null;
                throw new IssuerConfirmationVersionConflictError({ id: par.id });
            }
            // Cascata (I15l, Q-E): as decisões CONFIRMADAS deste par não valem mais.
            const motivoCascata = `par revogado: ${motivo}`;
            const decisoes = await this.repo.listarConfirmadasDoPar(par.id, tx);
            for (const d of decisoes) {
                await this.anularNaTransacao(
                    d,
                    { ator: input.ator, motivo: motivoCascata, origem: 'PAR_REVOGADO' },
                    tx,
                );
            }
            await this.repo.inserirEvento(
                {
                    tipo: EVENTO_SUGESTAO_BOLETO.PAR_REVOGADO,
                    ator: input.ator,
                    pesCod: par.pesCod,
                    emissorChave: par.emissorChave,
                    motivo,
                    detalhe: {
                        layoutEmissor: par.layoutEmissor,
                        emissorMascarado: par.emissorMascarado,
                        decisoesAnuladas: decisoes.length,
                    },
                },
                tx,
            );
            return atual;
        });
        this.cache.invalidar();
        if (!revogado) {
            const atual = await this.repo.buscarParPorId(par.id);
            return this.paraViewPar(atual ?? par);
        }
        await this.logService.info({
            type: LOG_TYPE.BUSINESS_INFO,
            message: 'confirmação de emissor revogada',
            data: {
                id: par.id,
                pesCod: par.pesCod,
                layoutEmissor: par.layoutEmissor,
                ator: input.ator,
            },
        });
        return this.paraViewPar(revogado);
    };

    // ── Anular ─────────────────────────────────────────────────────────────────────────────────

    /**
     * CONFIRMADA → ANULADA (I15l): desfaz a confirmação de UM título, com motivo, e libera o título e
     * o boleto. Vale mesmo para confirmação órfã (boleto fora do pool, título pago ou sinalizado).
     * Idempotente: já ANULADA devolve a decisão com `anulada = false`. Não mexe no par.
     */
    public anularDecisao = async (input: {
        filCod: number;
        docCod: string;
        titCod: string;
        motivo: string;
        ator: string;
    }): Promise<ResultadoAnulacao> => {
        this.exigirAtor(input.ator);
        const motivo = input.motivo.trim();
        if (motivo.length < MOTIVO_ANULACAO_MINIMO) {
            throw new IssuerConfirmationReasonRequiredError({ acao: 'anular a confirmação' });
        }
        const chaveTit = { filCod: input.filCod, docCod: input.docCod, titCod: input.titCod };
        const doTitulo = await this.repo.listarDecisoes(chaveTit);
        const confirmada = doTitulo.find((d) => d.decisao === DECISAO_SUGESTAO_BOLETO.CONFIRMADA);
        if (!confirmada) {
            const anulada = doTitulo
                .filter((d) => d.decisao === DECISAO_SUGESTAO_BOLETO.ANULADA)
                .sort((a, b) => (b.anuladaEm ?? '').localeCompare(a.anuladaEm ?? ''))[0];
            if (anulada) return { anulada: false, decisao: anulada };
            throw new DecisionNotConfirmedError(chaveTit);
        }

        const resultado = await this.db.withTransaction(async (tx): Promise<ResultadoAnulacao> => {
            const n = await this.anularNaTransacao(
                confirmada,
                { ator: input.ator, motivo, origem: 'ANULACAO' },
                tx,
                true,
            );
            const atual = await this.repo.buscarDecisaoPorId(confirmada.id, tx);
            if (!atual) throw new DecisionNotConfirmedError(chaveTit);
            return { anulada: n > 0, decisao: atual };
        });
        this.cache.invalidar();
        if (resultado.anulada) {
            await this.logService.info({
                type: LOG_TYPE.BUSINESS_INFO,
                message: 'sugestao_boleto.decisao_anulada',
                data: {
                    ...chaveTit,
                    ddcCod: confirmada.ddcCod,
                    ditCod: confirmada.ditCod,
                    ator: input.ator,
                },
            });
        }
        return resultado;
    };

    /**
     * Anula uma decisão com lock por `versao` e grava `DECISAO_ANULADA`, na transação do chamador.
     * Perdeu a corrida: com `tolerarJaAnulada`, se alguém já a anulou devolve 0 (no-op); senão é
     * conflito nomeado. Devolve as linhas afetadas.
     */
    private anularNaTransacao = async (
        d: DecisaoSugestao,
        ctx: { ator: string; motivo: string; origem: 'ANULACAO' | 'PAR_REVOGADO' },
        tx: TransactionClient,
        tolerarJaAnulada = false,
    ): Promise<number> => {
        const n = await this.repo.anularDecisao(
            { id: d.id, versaoEsperada: d.versao, ator: ctx.ator, motivo: ctx.motivo },
            tx,
        );
        if (n === 0) {
            const atual = await this.repo.buscarDecisaoPorId(d.id, tx);
            if (tolerarJaAnulada && atual?.decisao === DECISAO_SUGESTAO_BOLETO.ANULADA) return 0;
            throw new IssuerConfirmationVersionConflictError({ id: d.id });
        }
        await this.repo.inserirEvento(
            {
                tipo: EVENTO_SUGESTAO_BOLETO.DECISAO_ANULADA,
                ator: ctx.ator,
                pesCod: d.pesCod,
                emissorChave: d.emissorChave,
                filCod: d.filCod,
                docCod: d.docCod,
                titCod: d.titCod,
                ddcCod: d.ddcCod,
                ditCod: d.ditCod,
                motivo: ctx.motivo,
                detalhe: {
                    origem: ctx.origem,
                    ...(d.tier ? { tier: d.tier } : {}),
                    ...(d.confirmacaoEmissorId
                        ? { confirmacaoEmissorId: d.confirmacaoEmissorId }
                        : {}),
                },
            },
            tx,
        );
        return n;
    };

    // ── Copiar linha digitável ─────────────────────────────────────────────────────────────────

    /**
     * Devolve a linha digitável SÓ depois de gravar `LINHA_COPIADA` (quem, quando, título,
     * boleto). Se a trilha não grava, a linha não sai (fail-closed, I15k).
     */
    public copiarLinha = async (
        input: ChaveSugestao & { ator: string },
    ): Promise<{ linhaDigitavel: string }> => {
        this.exigirAtor(input.ator);
        const chave = this.chave(input);
        const { titulo, boleto } = await this.reler(chave);
        const linhaDigitavel = this.codigoBarras.paraLinhaDigitavel(boleto.codbar);
        if (!linhaDigitavel) {
            throw new BoletoSuggestionNotAvailableError({
                ...chave,
                motivo: 'O boleto não tem código de barras válido.',
            });
        }
        try {
            await this.repo.inserirEvento({
                tipo: EVENTO_SUGESTAO_BOLETO.LINHA_COPIADA,
                ator: input.ator,
                ...(titulo.pesCod ? { pesCod: titulo.pesCod } : {}),
                ...this.camposChave(chave),
                detalhe: {
                    codbarMascarado:
                        this.codigoBarras.mascarar(boleto.codbar) ?? CODBAR_DESCONHECIDO,
                },
            });
        } catch (erro) {
            await this.logService.warn({
                type: LOG_TYPE.BUSINESS_INFO,
                message: 'cópia da linha digitável recusada: a trilha não gravou',
                data: {
                    ...this.camposChave(chave),
                    ator: input.ator,
                    ...(erro instanceof Error ? { erro: erro.message } : {}),
                    ...this.codigoDoErro(erro),
                },
            });
            throw new LineCopyAuditFailedError(chave);
        }
        await this.logService.info({
            type: LOG_TYPE.BUSINESS_INFO,
            message: 'linha digitável copiada (auditada)',
            data: { ...this.camposChave(chave), ator: input.ator },
        });
        return { linhaDigitavel };
    };

    // ── Internos ───────────────────────────────────────────────────────────────────────────────

    /** Só o `code` textual do driver/domínio: o objeto do erro carrega `detail` com valores. */
    private codigoDoErro = (erro: unknown): { codigoErro?: string } => {
        const code = (erro as { code?: unknown } | null)?.code;
        return typeof code === 'string' ? { codigoErro: code } : {};
    };

    private exigirAtor = (ator: string): void => {
        if (ATORES_RECUSADOS.has(ator.trim().toLowerCase())) {
            throw new InvalidDecisionActorError();
        }
    };

    private chave = (c: ChaveSugestao): ChaveSugestao => ({
        filCod: c.filCod,
        docCod: c.docCod,
        titCod: c.titCod,
        ddcCod: c.ddcCod,
        ditCod: c.ditCod,
    });

    private camposChave = (c: ChaveSugestao) => ({
        filCod: c.filCod,
        docCod: c.docCod,
        titCod: c.titCod,
        ddcCod: c.ddcCod,
        ditCod: c.ditCod,
    });

    /** Relê título e boleto do banco e recusa o que deixou de ser elegível (I15a/I15e). */
    private reler = async (
        chave: ChaveSugestao,
    ): Promise<{ titulo: TituloAPagar; boleto: BoletoDda }> => {
        const [titulo, boleto] = await Promise.all([
            this.tituloRepo.buscarPorChave(chave),
            this.boletoRepo.buscarPorChave(chave),
        ]);
        const indisponivel = (motivo: string) =>
            new BoletoSuggestionNotAvailableError({ ...chave, motivo });
        if (!titulo || titulo.ativo === false) {
            throw indisponivel('O título não está mais na carteira ativa.');
        }
        if (titulo.pago) throw indisponivel('O título já foi pago.');
        if (titulo.temBoleto === true) {
            throw indisponivel('O Conexos já sinalizou boleto DDA para este título.');
        }
        if (!boleto) throw indisponivel('O boleto não está mais no pool DDA.');
        if (boleto.filCod != null && boleto.docCod && boleto.titCod) {
            throw indisponivel('O Conexos já vinculou este boleto a um título.');
        }
        return { titulo, boleto };
    };

    private vencimentoCivil = (t: TituloAPagar): string =>
        t.vencimento != null ? this.calendar.fromErpEpoch(Number(t.vencimento)) : '';

    private avaliar = (
        titulo: TituloAPagar,
        boleto: BoletoDda,
        datasDebito: ReadonlyMap<string, string>,
        parConfirmado: boolean,
    ): AvaliacaoSugestao => {
        const vencimento = this.vencimentoCivil(titulo);
        return this.regra.avaliar({
            titulo: {
                valor: titulo.valor,
                vencimento,
                ...(titulo.numeroDocumento ? { numeroDocumento: titulo.numeroDocumento } : {}),
            },
            boleto: {
                valor: boleto.valor,
                vencimento: boleto.vencimento ?? '',
                ...(boleto.numero ? { numero: boleto.numero } : {}),
            },
            dataDebito: datasDebito.get(chaveTitulo(titulo)) ?? vencimento,
            parConfirmado,
        });
    };

    /** O primeiro visto é o lote mais recente (a query ordena por `criado_em DESC`). */
    private mapaDatasDebito = (
        emLotes: Array<{ filCod: number; docCod: string; titCod: string; dataDebito?: string }>,
    ): Map<string, string> => {
        const datasDebito = new Map<string, string>();
        const vistos = new Set<string>();
        for (const item of emLotes) {
            const k = chaveTitulo(item);
            if (vistos.has(k)) continue;
            vistos.add(k);
            if (item.dataDebito) datasDebito.set(k, item.dataDebito);
        }
        return datasDebito;
    };

    /**
     * Desfecho por título calculado agora, sem cache — para o leitor de DPS (ADR-0073) escolher
     * quem ainda não tem desempate. Mesma entrada do cenário da tela.
     */
    public desfechosAgora = async (): Promise<DesfechoTitulo[]> =>
        (await this.sugerirAgora()).desfechos;

    /**
     * DPS lidos (I15p) — sinal auxiliar: falha na leitura não pode derrubar a lista de sugestões nem
     * a confirmação. Sem eles o motor volta ao comportamento de antes do ADR-0073 (sem âncora DPS).
     */
    private dpsLidosOuNenhum = async (): Promise<DpsConhecido[]> => {
        try {
            return await this.dpsRepo.listarLidos();
        } catch (err: unknown) {
            await this.logService.warn({
                type: LOG_TYPE.BUSINESS_WARN,
                message: 'falha ao ler os DPS — sugestão calculada sem a âncora DPS',
                data: { erro: err instanceof Error ? err.message : String(err) },
            });
            return [];
        }
    };

    /** Lê o pool e a carteira persistidos e roda o motor com o estado de decisões de agora. */
    private sugerirAgora = async (): Promise<{
        sugestoes: SugestaoBoletoTitulo[];
        desfechos: DesfechoTitulo[];
        pares: ConfirmacaoEmissor[];
        datasDebito: Map<string, string>;
        titulos: number;
        boletos: number;
    }> => {
        const [titulos, boletos, pares, rejeitadas, confirmadas, emLotes, dps] = await Promise.all([
            this.tituloRepo.listAtivos(),
            this.boletoRepo.listBoletos({}),
            this.repo.listarParesVigentes(),
            this.repo.listarChaveadas(DECISAO_SUGESTAO_BOLETO.REJEITADA),
            this.repo.listarChaveadas(DECISAO_SUGESTAO_BOLETO.CONFIRMADA),
            this.loteRepo.listTitulosEmLotesAbertos(),
            this.dpsLidosOuNenhum(),
        ]);
        const datasDebito = this.mapaDatasDebito(emLotes);
        const { sugestoes, desfechos } = this.motor.analisar({
            titulos,
            boletos,
            paresVigentes: pares.map((p) => ({ pesCod: p.pesCod, emissorChave: p.emissorChave })),
            rejeitadas,
            confirmadas,
            datasDebito,
            dps,
        });
        return {
            sugestoes,
            desfechos,
            pares,
            datasDebito,
            titulos: titulos.length,
            boletos: boletos.length,
        };
    };

    /**
     * O cenário que a listagem cacheia: o motor sobre a carteira inteira + o frescor do DDA. Só
     * roda na falta de cache (single-flight); registra a duração e as contagens, nunca barras.
     */
    private calcularCenario = async (): Promise<CenarioSugestoes> => {
        const inicio = Date.now();
        const [cenario, sincronizadoEm] = await Promise.all([
            this.sugerirAgora(),
            this.boletoRepo.ultimaSincronizacao(),
        ]);
        await this.logService.info({
            type: LOG_TYPE.BUSINESS_INFO,
            message: 'sugestao_boleto.cenario_calculado',
            data: {
                duracaoMs: Date.now() - inicio,
                titulos: cenario.titulos,
                boletos: cenario.boletos,
                sugestoes: cenario.sugestoes.length,
                orfas: cenario.sugestoes.filter((s) => s.orfa === true).length,
                desfechos: cenario.desfechos.length,
                situacoes: this.contarSituacoes(cenario.desfechos),
            },
        });
        return { ...cenario, sincronizadoEm };
    };

    private paraView = (
        s: SugestaoBoletoTitulo,
        parPorChave: ReadonlyMap<string, string>,
    ): SugestaoBoletoView => {
        const { emissor, ...resto } = s;
        const parId =
            emissor && s.pesCod ? parPorChave.get(`${s.pesCod}|${emissor.chave}`) : undefined;
        return {
            ...resto,
            ...(emissor
                ? {
                      emissor: {
                          banco: emissor.banco,
                          layout: emissor.layout,
                          mascarado: emissor.mascarado,
                      },
                  }
                : {}),
            confirmavel: s.avaliacao.confirmavel && s.estado === ESTADO_SUGESTAO.SUGERIDA,
            ...(parId ? { confirmacaoEmissorId: parId } : {}),
        };
    };

    private contarSituacoes = (
        desfechos: DesfechoTitulo[],
    ): Partial<Record<SituacaoSugestaoTitulo, number>> => {
        const contagem: Partial<Record<SituacaoSugestaoTitulo, number>> = {};
        for (const d of desfechos) contagem[d.situacao] = (contagem[d.situacao] ?? 0) + 1;
        return contagem;
    };

    /**
     * O candidato escolhido (`confirmavel`) do boleto pedido, como sugestão. Qualquer outra coisa é
     * 409 com o motivo da situação: ambíguo, fraco e disputado nunca se confirmam (I15m).
     */
    private sugestaoConfirmavel = (
        desfechos: DesfechoTitulo[],
        chave: ChaveSugestao,
    ): SugestaoBoletoTitulo => {
        const mesmoBoleto = (c: CandidatoTitulo): boolean =>
            c.ddcCod === chave.ddcCod && c.ditCod === chave.ditCod;
        const desfecho = desfechos.find((d) => mesmoTitulo(d, chave));
        const candidato = desfecho?.candidatos.find(mesmoBoleto);
        if (desfecho && candidato?.confirmavel) return this.paraSugestao(desfecho, candidato);
        const rival = desfechos.find(
            (d) =>
                !mesmoTitulo(d, chave) && d.candidatos.some((c) => c.confirmavel && mesmoBoleto(c)),
        );
        if (rival) throw new BoletoAlreadySuggestedToOtherTitleError(chave);
        throw new BoletoSuggestionNotAvailableError({
            ...chave,
            motivo:
                candidato?.motivo ??
                desfecho?.motivo ??
                'Este boleto não é mais a sugestão única para o título (empate ou mudança no pool).',
        });
    };

    private paraSugestao = (d: DesfechoTitulo, c: CandidatoTitulo): SugestaoBoletoTitulo => ({
        filCod: d.filCod,
        docCod: d.docCod,
        titCod: d.titCod,
        ...(d.pesCod ? { pesCod: d.pesCod } : {}),
        ...(d.credor ? { credor: d.credor } : {}),
        valorTitulo: d.valorTitulo,
        vencimentoTitulo: d.vencimentoTitulo,
        dataDebito: d.dataDebito,
        ddcCod: c.ddcCod,
        ditCod: c.ditCod,
        ...(c.numeroBoleto ? { numeroBoleto: c.numeroBoleto } : {}),
        valorBoleto: c.valorBoleto,
        vencimentoBoleto: c.vencimentoBoleto,
        ...(c.emissor ? { emissor: c.emissor } : {}),
        avaliacao: c.avaliacao,
        estado: ESTADO_SUGESTAO.SUGERIDA,
    });

    /**
     * I15o: `VENCE_ANTES_DO_TITULO` só se confirma com o reconhecimento do analista, conferido
     * contra a avaliação recalculada. Reconhecer algo que o servidor não vê é inócuo (nada a
     * reconhecer, nada gravado).
     */
    private exigirReconhecimento = (
        s: SugestaoBoletoTitulo,
        reconhecidos: SinalSugestao[],
        chave: ChaveSugestao,
    ): SinalSugestao[] => {
        const { sinais } = s.avaliacao;
        if (!sinais.includes(SINAL_SUGESTAO.VENCE_ANTES_DO_TITULO)) return sinais;
        if (!reconhecidos.includes(SINAL_SUGESTAO.VENCE_ANTES_DO_TITULO)) {
            throw new WarningAcknowledgementRequiredError({
                ...chave,
                avisos: [SINAL_SUGESTAO.VENCE_ANTES_DO_TITULO],
                vencimentoTitulo: s.vencimentoTitulo,
                vencimentoBoleto: s.vencimentoBoleto,
                dataDebito: s.dataDebito,
            });
        }
        return [...sinais, SINAL_SUGESTAO.RECONHECEU_VENCE_ANTES];
    };

    /**
     * Aviso do MELHOR candidato. Decisão legada sem o sinal gravado deriva o aviso de `deltaDias < 0`
     * (Q6): sem backfill.
     */
    private avisoDe = (a: AvaliacaoSugestao | undefined): AvisoVenceAntes => {
        if (!a || a.resultado === RESULTADO_SUGESTAO.SEM_RELACAO) return AVISO_VENCE_ANTES.NENHUM;
        const tem = a.sinais.includes(SINAL_SUGESTAO.VENCE_ANTES_DO_TITULO) || a.deltaDias < 0;
        if (!tem) return AVISO_VENCE_ANTES.NENHUM;
        return a.diasVencidoNoDebito > 0 || a.resultado === RESULTADO_SUGESTAO.VENCIDO_INFORMATIVO
            ? AVISO_VENCE_ANTES.CRITICO
            : AVISO_VENCE_ANTES.ATENCAO;
    };

    private paraViewDesfecho = (
        d: DesfechoTitulo,
        parPorChave: ReadonlyMap<string, string>,
    ): DesfechoTituloView => {
        const melhor = d.candidatos[0]?.avaliacao;
        return {
            ...d,
            candidatos: d.candidatos.map(({ emissor, ...resto }) => {
                const parId =
                    emissor && d.pesCod
                        ? parPorChave.get(`${d.pesCod}|${emissor.chave}`)
                        : undefined;
                return {
                    ...resto,
                    ...(emissor
                        ? {
                              emissor: {
                                  banco: emissor.banco,
                                  layout: emissor.layout,
                                  mascarado: emissor.mascarado,
                              },
                          }
                        : {}),
                    ...(parId ? { confirmacaoEmissorId: parId } : {}),
                };
            }),
            avisoVenceAntes: this.avisoDe(melhor),
            diasVencidoNoDebito: melhor?.diasVencidoNoDebito ?? 0,
        };
    };

    private paraViewPar = (p: ConfirmacaoEmissor): ConfirmacaoEmissorView => {
        const { emissorChave: _chave, ...resto } = p;
        return { ...resto, elegivelAutomatico: p.layoutEmissor !== LAYOUT_EMISSOR.GENERICO };
    };

    private evidencia = (
        s: SugestaoBoletoTitulo,
        ator: string,
        sinais: SinalSugestao[],
    ): Record<string, unknown> => ({
        tier: s.avaliacao.resultado,
        sinais,
        deltaValor: s.avaliacao.deltaValor,
        deltaPercentual: s.avaliacao.deltaPercentual,
        deltaDias: s.avaliacao.deltaDias,
        titulo: { filCod: s.filCod, docCod: s.docCod, titCod: s.titCod },
        boleto: { ddcCod: s.ddcCod, ditCod: s.ditCod },
        confirmadoPor: ator,
    });

    /** Horas de defasagem do DDA quando > 8 h em dia útil (ADR-0067); fim de semana não conta. */
    private horasDefasado = (sincronizadoEm?: number): number | undefined => {
        if (sincronizadoEm == null) return undefined;
        if (!this.calendar.isBusinessDay(this.calendar.todayBrt())) return undefined;
        const horas = Math.floor((this.calendar.now().getTime() - sincronizadoEm) / HORA_MS);
        return horas > DDA_DEFASADO_HORAS ? horas : undefined;
    };
}
