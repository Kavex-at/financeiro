import { inject, injectable } from 'tsyringe';
import ConexosSispagClient from '../../client/ConexosSispagClient.js';
import PostgreeDatabaseClient, {
    type TransactionClient,
} from '../../client/database/PostgreeDatabaseClient.js';
import GroupedBoletoCrossBranchError from '../../errors/GroupedBoletoCrossBranchError.js';
import GroupedBoletoDueWindowError from '../../errors/GroupedBoletoDueWindowError.js';
import GroupedBoletoNotConfirmableError from '../../errors/GroupedBoletoNotConfirmableError.js';
import GroupedBoletoNotFoundError from '../../errors/GroupedBoletoNotFoundError.js';
import GroupedBoletoStateConflictError from '../../errors/GroupedBoletoStateConflictError.js';
import GroupedBoletoSumMismatchError from '../../errors/GroupedBoletoSumMismatchError.js';
import GroupedBoletoTitleIneligibleError from '../../errors/GroupedBoletoTitleIneligibleError.js';
import InvalidDecisionActorError from '../../errors/InvalidDecisionActorError.js';
import IssuerConfirmationReasonRequiredError from '../../errors/IssuerConfirmationReasonRequiredError.js';
import WarningAcknowledgementRequiredError from '../../errors/WarningAcknowledgementRequiredError.js';
import type { BoletoDda } from '../../interface/sispag/BoletoDda.js';
import {
    DECISAO_SUGESTAO_BOLETO,
    EVENTO_SUGESTAO_BOLETO,
} from '../../interface/sispag/ConfirmacaoEmissorBoleto.js';
import {
    type AvaliacaoGrupo,
    type AvisoGrupo,
    type BoletoGrupoEntrada,
    type ChaveTituloGrupo,
    type EntradaConfirmarGrupo,
    type EstadoVivoGrupo,
    GRUPO_BOLETO_ESTADO,
    GRUPO_BOLETO_ORIGEM,
    GRUPO_BOLETO_TIPO_ANULACAO,
    type GrupoBoleto,
    type GrupoBoletoListado,
    type GrupoBoletoTipoAnulacao,
    MOTIVO_GRUPO_INELEGIVEL,
    type MotivoGrupoInelegivel,
    RESULTADO_TRANSICAO_GRUPO,
    type ResultadoAnulacaoGrupo,
    type ResultadoConfirmacaoGrupo,
    type SugestaoGrupoBoleto,
    type TituloGrupoEntrada,
} from '../../interface/sispag/GrupoBoletoInterface.js';
import { LOG_TYPE } from '../../interface/log/LogInterface.js';
import {
    type LotePagamento,
    type LotePagamentoStatus,
    SISPAG_SYSTEM_ACTOR,
    type TituloAPagar,
} from '../../interface/sispag/SispagInterface.js';
import CodigoBarrasBoleto from '../../libs/boleto/CodigoBarrasBoleto.js';
import SituacaoGrupoBoleto from '../../libs/boleto/SituacaoGrupoBoleto.js';
import type { ValoresAbertoTitulo } from '../../libs/boleto/ValorAbertoLiquido.js';
import BankingCalendar from '../../libs/calendar/BankingCalendar.js';
import BloqueioDuplicidadeRepository from '../../repository/sispag/BloqueioDuplicidadeRepository.js';
import BoletoDdaRepository from '../../repository/sispag/BoletoDdaRepository.js';
import GrupoBoletoExecucaoRepository from '../../repository/sispag/GrupoBoletoExecucaoRepository.js';
import GrupoBoletoRepository from '../../repository/sispag/GrupoBoletoRepository.js';
import LotePagamentoRepository, {
    RESULTADO_OPERACAO_GRUPO,
} from '../../repository/sispag/LotePagamentoRepository.js';
import SugestaoBoletoRepository from '../../repository/sispag/SugestaoBoletoRepository.js';
import TituloAPagarRepository from '../../repository/sispag/TituloAPagarRepository.js';
import LogService from '../LogService.js';
import type { EntradaMotorGrupo } from './MotorGrupoBoleto.js';
import MotorGrupoBoleto from './MotorGrupoBoleto.js';
import RegraGrupoBoleto from './RegraGrupoBoleto.js';
import SugestaoBoletoCache from './SugestaoBoletoCache.js';

const M = MOTIVO_GRUPO_INELEGIVEL;

/** Atores que nunca confirmam nem anulam por conta própria (I19i): só a cascata usa `sistema`. */
const ATORES_RECUSADOS = new Set([SISPAG_SYSTEM_ACTOR, 'unknown', '']);

/** Motivo da anulação (10–500, CHECK da 0090). */
const MOTIVO_MINIMO = 10;
const MOTIVO_MAXIMO = 500;

/** Motivo fixo da cascata da revogação do par (I15l(2), I19t). */
const MOTIVO_CASCATA_PAR =
    'par (credor, emissor) revogado: grupo anulado em cascata pela revogação';

const MENSAGEM_LOTE_COMPROMETIDO =
    'O grupo estava num lote já finalizado: a próxima geração de remessa retira os títulos dele ' +
    'antes de finalizar (ou recusa, se o lote do Conexos já foi finalizado).';

/** Motivos de título que viram `GroupedBoletoDueWindowError` (e não "título inelegível"). */
const MOTIVO_JANELA: ReadonlySet<MotivoGrupoInelegivel> = new Set([M.FORA_DA_JANELA]);

/** Motivos do grupo tratados por um erro próprio (filial, soma) — os demais são "não confirmável". */
const MOTIVOS_GRUPO_COM_ERRO_PROPRIO: ReadonlySet<MotivoGrupoInelegivel> = new Set([
    M.CRUZA_FILIAL,
    M.SOMA_DIFERENTE,
    M.VALOR_ABERTO_INDISPONIVEL,
]);

const chaveTitulo = (t: ChaveTituloGrupo): string => `${t.filCod}:${t.docCod}:${t.titCod}`;
const chaveBoleto = (b: { ddcCod: number; ditCod: number }): string => `${b.ddcCod}:${b.ditCod}`;

const mesmoConjunto = (a: readonly ChaveTituloGrupo[], b: readonly ChaveTituloGrupo[]): boolean => {
    const sa = new Set(a.map(chaveTitulo));
    const sb = new Set(b.map(chaveTitulo));
    return sa.size === sb.size && [...sb].every((k) => sa.has(k));
};

/** O que a confirmação relê sob o lock, para a regra e para gravar o grupo. */
interface ContextoConfirmacao {
    boleto: BoletoDda | null;
    titulos: Map<string, TituloAPagar>;
    entradas: TituloGrupoEntrada[];
    boletoComDecisao: boolean;
    pesCod?: string;
    emissor?: ReturnType<CodigoBarrasBoleto['emissor']>;
    parVigenteId?: string;
}

/**
 * GrupoBoletoService — sugerir, confirmar, anular e listar grupos de boleto (I19e–i, I19t, I19u;
 * ADR-0076; ações `sugerirGruposBoleto`, `confirmarGrupoBoleto`, `anularGrupoBoleto`).
 *
 * - **Sugerir** é só leitura local (pool, carteira, grupos, decisões, marcas): zero Conexos, nada
 *   persistido (I-DDA1). O líquido da sugestão é o `valor` local (G1).
 * - **Confirmar** (G1): o `fin064` dos N títulos é lido AO VIVO antes da transação (leitura do
 *   ERP nunca dentro de transação); dentro dela, sob advisory lock por boleto e por título (as
 *   MESMAS chaves do `BoletoSuggestionService.confirmar`, exclusividade I15q), tudo o mais é
 *   relido e a regra é reavaliada — nunca o cache da sugestão (anti-TOCTOU). O snapshot gravado é
 *   o líquido ao vivo. Idempotente (I19i).
 * - **Anular** (I19t): motivo 10–500; em lote `RASCUNHO` retira os N itens na MESMA transação
 *   (PI-6); em lote comprometido só avisa (a remessa retira). Encerra as marcas `GRUPO_BOLETO`.
 * - **Ator**: o usuário do JWT, recebido da rota; nunca `sistema` (só a cascata do par o usa).
 * - **Logs** em português, só a máscara 5+4 do código (I17j).
 */
@injectable()
export default class GrupoBoletoService {
    public constructor(
        @inject(GrupoBoletoRepository) private readonly grupos: GrupoBoletoRepository,
        @inject(GrupoBoletoExecucaoRepository)
        private readonly execucoes: GrupoBoletoExecucaoRepository,
        @inject(TituloAPagarRepository) private readonly titulos: TituloAPagarRepository,
        @inject(BoletoDdaRepository) private readonly boletos: BoletoDdaRepository,
        @inject(SugestaoBoletoRepository) private readonly sugestoes: SugestaoBoletoRepository,
        @inject(BloqueioDuplicidadeRepository)
        private readonly bloqueios: BloqueioDuplicidadeRepository,
        @inject(LotePagamentoRepository) private readonly lotes: LotePagamentoRepository,
        @inject(ConexosSispagClient) private readonly sispag: ConexosSispagClient,
        @inject(MotorGrupoBoleto) private readonly motor: MotorGrupoBoleto,
        @inject(RegraGrupoBoleto) private readonly regra: RegraGrupoBoleto,
        @inject(CodigoBarrasBoleto) private readonly codigoBarras: CodigoBarrasBoleto,
        @inject(BankingCalendar) private readonly calendar: BankingCalendar,
        @inject(PostgreeDatabaseClient) private readonly db: PostgreeDatabaseClient,
        @inject(LogService) private readonly logService: LogService,
        @inject(SugestaoBoletoCache) private readonly cache: SugestaoBoletoCache,
    ) {}

    // ── Sugerir ────────────────────────────────────────────────────────────────────────────────

    /** Grupos fechados no mesmo vencimento (I19e/f), calculados agora; leitura que falha sobe. */
    public sugerir = async (filtro: { filCod?: number } = {}): Promise<SugestaoGrupoBoleto[]> => {
        const sugestoes = this.motor.sugerir(await this.carregarCenario());
        return sugestoes.filter((s) => filtro.filCod === undefined || s.filCod === filtro.filCod);
    };

    // ── Confirmar ──────────────────────────────────────────────────────────────────────────────

    public confirmar = async (input: EntradaConfirmarGrupo): Promise<ResultadoConfirmacaoGrupo> => {
        this.exigirAtor(input.ator);
        const titulos = this.semRepetidos(input.titulos);

        // Idempotência já decidida (I19i): sem ler o Conexos nem abrir transação.
        const existente = await this.grupos.buscarConfirmadoPorBoleto(input.ddcCod, input.ditCod);
        if (existente && mesmoConjunto(existente.titulos, titulos)) {
            return { criado: false, grupo: existente };
        }

        // G1: o líquido da I17b, ao vivo no fin064, ANTES da transação (só leitura).
        const abertos = await this.lerAbertos(titulos);
        // Origem SUGERIDO: o motor recalculado AGORA (nunca o cache da tela), fora da transação —
        // tudo o que decide a elegibilidade é relido de novo sob o lock.
        const sugestao =
            input.origem === GRUPO_BOLETO_ORIGEM.SUGERIDO
                ? await this.sugestaoAtual(input)
                : undefined;

        const resultado = await this.db.withTransaction((tx) =>
            this.confirmarSobLock(input, titulos, abertos, sugestao, tx),
        );

        this.cache.invalidar();
        if (resultado.criado) {
            await this.logService.info({
                type: LOG_TYPE.BUSINESS_INFO,
                message: 'grupo de boleto confirmado',
                data: {
                    grupoId: resultado.grupo.id,
                    origem: resultado.grupo.origem,
                    filCod: resultado.grupo.filCod,
                    pesCod: resultado.grupo.pesCod,
                    titulos: resultado.grupo.titulos.length,
                    valorBoletoCentavos: resultado.grupo.valorBoletoCentavos,
                    codbarMascarado: resultado.grupo.codbarMascarado,
                    intercambiavel: resultado.grupo.intercambiavel,
                    ator: input.ator,
                },
            });
        }
        return resultado;
    };

    // ── Anular ─────────────────────────────────────────────────────────────────────────────────

    public anular = async (input: {
        grupoId: string;
        motivo: string;
        ator: string;
    }): Promise<ResultadoAnulacaoGrupo> => {
        this.exigirAtor(input.ator);
        const motivo = input.motivo.trim();
        if (motivo.length < MOTIVO_MINIMO || motivo.length > MOTIVO_MAXIMO) {
            throw new IssuerConfirmationReasonRequiredError({
                acao: 'anular o grupo de boleto (entre 10 e 500 caracteres)',
            });
        }
        const r = await this.db.withTransaction((tx) =>
            this.anularNaTransacao(
                {
                    grupoId: input.grupoId,
                    motivo,
                    tipoAnulacao: GRUPO_BOLETO_TIPO_ANULACAO.MANUAL,
                    ator: input.ator,
                },
                tx,
            ),
        );
        this.cache.invalidar();
        if (r.anulado) {
            await this.logService.info({
                type: LOG_TYPE.BUSINESS_INFO,
                message: 'grupo de boleto anulado',
                data: {
                    grupoId: r.grupo.id,
                    filCod: r.grupo.filCod,
                    codbarMascarado: r.grupo.codbarMascarado,
                    ator: input.ator,
                    ...(r.retiradoDoLoteId ? { retiradoDoLoteId: r.retiradoDoLoteId } : {}),
                    ...(r.avisoLoteComprometido
                        ? { loteComprometidoId: r.avisoLoteComprometido.loteId }
                        : {}),
                },
            });
        }
        return r;
    };

    /**
     * Cascata da revogação do par (I15l(2), I19t): anula, NA TRANSAÇÃO DO CHAMADOR
     * (`BoletoSuggestionService.revogarPar`), todos os grupos `CONFIRMADO` do par, com ator
     * `sistema`, tipo `PAR_REVOGADO` e motivo fixo. Rollback da revogação desfaz as anulações.
     * Não loga (o chamador loga depois do commit).
     */
    public anularPorRevogacaoDoPar = async (
        parId: string,
        tx: TransactionClient,
    ): Promise<ResultadoAnulacaoGrupo[]> => {
        const resultados: ResultadoAnulacaoGrupo[] = [];
        for (const grupo of await this.grupos.listarConfirmadosDoPar(parId, tx)) {
            const r = await this.anularNaTransacao(
                {
                    grupoId: grupo.id,
                    motivo: MOTIVO_CASCATA_PAR,
                    tipoAnulacao: GRUPO_BOLETO_TIPO_ANULACAO.PAR_REVOGADO,
                    ator: SISPAG_SYSTEM_ACTOR,
                },
                tx,
            );
            if (r.anulado) resultados.push(r);
        }
        return resultados;
    };

    // ── Listar ─────────────────────────────────────────────────────────────────────────────────

    /**
     * Grupos `CONFIRMADO` com a situação derivada e o órfão (I19u) recalculados agora — nunca some
     * grupo em silêncio. Só leitura local.
     */
    public listar = async (filtro: { filCod?: number } = {}): Promise<GrupoBoletoListado[]> => {
        const [grupos, carteira, pool, marcas, emLotes] = await Promise.all([
            this.grupos.listarConfirmados(
                filtro.filCod !== undefined ? { filCod: filtro.filCod } : {},
            ),
            this.titulos.listAtivos(),
            this.boletos.listBoletos({}),
            this.bloqueios.listAtivos(),
            this.lotes.listTitulosEmLotesAbertos(),
        ]);
        const porTitulo = new Map(carteira.map((t) => [chaveTitulo(t), t]));
        const porBoleto = new Map(pool.map((b) => [chaveBoleto(b), b]));
        const marcados = new Set(marcas.map(chaveTitulo));
        // A query ordena pelo lote mais recente: o primeiro visto é o que vale.
        const loteDoTitulo = new Map<string, { loteId: string; status: string }>();
        for (const l of emLotes) {
            const k = chaveTitulo(l);
            if (!loteDoTitulo.has(k)) loteDoTitulo.set(k, { loteId: l.loteId, status: l.status });
        }
        const lotesLidos = new Map<string, Promise<LotePagamento | null>>();
        const lerLote = (id: string): Promise<LotePagamento | null> => {
            const lido = lotesLidos.get(id) ?? this.lotes.getLoteComItens(id);
            lotesLidos.set(id, lido);
            return lido;
        };

        const listados: GrupoBoletoListado[] = [];
        for (const grupo of grupos) {
            const orfao = this.regra.orfao(grupo, this.estadoVivo(grupo, porBoleto, porTitulo));
            const lote = grupo.titulos
                .map((t) => loteDoTitulo.get(chaveTitulo(t)))
                .find((l) => l !== undefined);
            const itensDoLote = lote ? ((await lerLote(lote.loteId))?.itens ?? []) : [];
            const execucoes = await this.execucoes.listarPorGrupo(grupo.id);
            const situacao = SituacaoGrupoBoleto.derivar({
                estado: grupo.estado,
                orfao: orfao.orfao,
                marcaRetencaoAtiva: grupo.titulos.some((t) => marcados.has(chaveTitulo(t))),
                divergente: itensDoLote.some((i) => i.grupoBoletoId === grupo.id && i.divergencia),
                ...(lote ? { loteStatus: lote.status as LotePagamentoStatus } : {}),
                execucoes: execucoes.map((x) => ({
                    iniciadaEm: (x.escritaIniciadaEm ?? x.criadoEm).getTime(),
                    etapa: x.etapa,
                    ...(x.jRejeitadoEm ? { jRejeitadoEm: x.jRejeitadoEm.getTime() } : {}),
                })),
            });
            listados.push({
                ...grupo,
                situacao,
                orfao,
                ...(lote ? { loteId: lote.loteId, loteStatus: lote.status } : {}),
            });
        }
        return listados;
    };

    // ── Internos ───────────────────────────────────────────────────────────────────────────────

    /** O que se lê agora do pool e da carteira para a I19u (título ausente = saiu da carteira). */
    private estadoVivo = (
        grupo: GrupoBoleto,
        porBoleto: ReadonlyMap<string, BoletoDda>,
        porTitulo: ReadonlyMap<string, TituloAPagar>,
    ): EstadoVivoGrupo => {
        const boleto = porBoleto.get(chaveBoleto(grupo));
        const titulos = grupo.titulos.flatMap((t) => {
            const c = porTitulo.get(chaveTitulo(t));
            if (!c) return [];
            return [
                {
                    filCod: t.filCod,
                    docCod: t.docCod,
                    titCod: t.titCod,
                    pago: c.pago,
                    ativo: c.ativo !== false,
                    ...(c.temBoleto !== undefined ? { temBoleto: c.temBoleto } : {}),
                },
            ];
        });
        if (!boleto) return { titulos };
        return {
            boleto: {
                ...(boleto.filCod != null ? { filCod: boleto.filCod } : {}),
                ...(boleto.docCod ? { docCod: boleto.docCod } : {}),
                ...(boleto.titCod ? { titCod: boleto.titCod } : {}),
            },
            titulos,
        };
    };

    private exigirAtor = (ator: string): void => {
        if (ATORES_RECUSADOS.has(ator.trim().toLowerCase())) {
            throw new InvalidDecisionActorError();
        }
    };

    private semRepetidos = (titulos: readonly ChaveTituloGrupo[]): ChaveTituloGrupo[] => {
        const vistos = new Set<string>();
        const unicos: ChaveTituloGrupo[] = [];
        for (const t of titulos) {
            const c = { filCod: t.filCod, docCod: t.docCod, titCod: t.titCod };
            if (vistos.has(chaveTitulo(c))) continue;
            vistos.add(chaveTitulo(c));
            unicos.push(c);
        }
        return unicos;
    };

    private vencimentoCivil = (t?: TituloAPagar): string =>
        t?.vencimento != null ? this.calendar.fromErpEpoch(Number(t.vencimento)) : '';

    /** Corpo transacional do `confirmar`: lock, releitura, regra, par e gravação (I19i). */
    private confirmarSobLock = async (
        input: EntradaConfirmarGrupo,
        titulos: readonly ChaveTituloGrupo[],
        abertos: ReadonlyMap<string, ValoresAbertoTitulo>,
        sugestao: SugestaoGrupoBoleto | undefined,
        tx: TransactionClient,
    ): Promise<ResultadoConfirmacaoGrupo> => {
        await this.grupos.travar(tx, [
            GrupoBoletoRepository.chaveLockBoleto(input.ddcCod, input.ditCod),
            ...titulos.map(GrupoBoletoRepository.chaveLockTitulo),
        ]);
        // Corrida (I19i): quem chegou antes já confirmou este mesmo conjunto ⇒ o existente.
        const vencedor = await this.grupos.buscarConfirmadoPorBoleto(
            input.ddcCod,
            input.ditCod,
            tx,
        );
        if (vencedor && mesmoConjunto(vencedor.titulos, titulos)) {
            return { criado: false, grupo: vencedor };
        }
        const ctx = await this.relerSobLock(input, titulos, abertos, tx);
        const avaliacao = this.regra.avaliar({
            origem: input.origem,
            boleto: this.entradaBoleto(input, ctx.boleto),
            titulos: ctx.entradas,
            parVigente: ctx.parVigenteId !== undefined,
            parConfirmavelNoAto: ctx.emissor !== undefined,
        });
        const intercambiavel =
            input.origem === GRUPO_BOLETO_ORIGEM.SUGERIDO
                ? this.conferirSugestao(input, titulos, avaliacao, sugestao)
                : false;
        this.exigirConfirmavel(input, avaliacao, ctx);
        const avisos = this.exigirAvisos(input, avaliacao, ctx);
        const { emissor, pesCod } = ctx;
        const { codigoMascarado, valorBoletoCentavos, vencimentoBoleto } = avaliacao;
        if (
            !emissor ||
            !pesCod ||
            codigoMascarado === undefined ||
            valorBoletoCentavos === undefined ||
            vencimentoBoleto === undefined
        ) {
            // A regra já recusaria; guarda de tipo para não gravar um grupo incompleto.
            throw new GroupedBoletoNotConfirmableError({
                ddcCod: input.ddcCod,
                ditCod: input.ditCod,
                motivos: [M.BOLETO_INDISPONIVEL],
            });
        }
        const parId = await this.garantirPar(input, ctx, emissor, pesCod, tx);
        const credor = [...ctx.titulos.values()].find((t) => t.credor)?.credor;
        return this.grupos.inserirConfirmado(
            {
                filCod: titulos[0]?.filCod ?? 0,
                pesCod,
                ...(credor ? { credor } : {}),
                emissorChave: emissor.chave,
                ddcCod: input.ddcCod,
                ditCod: input.ditCod,
                ...(ctx.boleto?.numero ? { numeroBoleto: ctx.boleto.numero } : {}),
                codbarMascarado: codigoMascarado,
                valorBoletoCentavos,
                vencimentoBoleto,
                titulos: avaliacao.titulos.map((t) => ({
                    filCod: t.filCod,
                    docCod: t.docCod,
                    titCod: t.titCod,
                    valorLiquidoCentavos: t.valorLiquidoCentavos ?? 0,
                    vencimento: this.vencimentoCivil(ctx.titulos.get(chaveTitulo(t))),
                })),
                origem: input.origem,
                intercambiavel,
                avisosReconhecidos: avisos,
                confirmacaoEmissorId: parId,
                confirmadoPor: input.ator,
            },
            tx,
        );
    };

    /** O boleto relido como entrada da regra (o código só em memória; a regra o mascara). */
    private entradaBoleto = (
        input: EntradaConfirmarGrupo,
        b: BoletoDda | null,
    ): BoletoGrupoEntrada => {
        if (!b) return { ddcCod: input.ddcCod, ditCod: input.ditCod };
        return {
            ddcCod: input.ddcCod,
            ditCod: input.ditCod,
            ...(b.codbar ? { codigo: b.codbar } : {}),
            poolValor: b.valor,
            ...(b.vencimento ? { poolVencimento: b.vencimento } : {}),
            ...(b.filCod != null ? { filCod: b.filCod } : {}),
            ...(b.docCod ? { docCod: b.docCod } : {}),
            ...(b.titCod ? { titCod: b.titCod } : {}),
        };
    };

    /** `fin064` ao vivo (só leitura, com retry no client); ilegível ⇒ ausente (fail-closed). */
    private lerAbertos = async (
        titulos: readonly ChaveTituloGrupo[],
    ): Promise<Map<string, ValoresAbertoTitulo>> => {
        const abertos = new Map<string, ValoresAbertoTitulo>();
        for (const t of titulos) {
            const r = await this.sispag.lerValoresAberto(t.filCod, t.docCod, t.titCod);
            if (r.legivel) abertos.set(chaveTitulo(t), r.valores);
        }
        return abertos;
    };

    /**
     * Releitura SOB O LOCK e na transação (anti-TOCTOU): boleto, títulos, decisões 1:1, marcas,
     * lote comprometido, outro grupo e o par. Todo escritor concorrente (grupo ou decisão 1:1)
     * toma o mesmo advisory lock antes de gravar, então o que ele commitou já é visível aqui.
     */
    private relerSobLock = async (
        input: EntradaConfirmarGrupo,
        titulos: readonly ChaveTituloGrupo[],
        abertos: ReadonlyMap<string, ValoresAbertoTitulo>,
        tx: TransactionClient,
    ): Promise<ContextoConfirmacao> => {
        const boleto = await this.boletos.buscarPorChave(
            { ddcCod: input.ddcCod, ditCod: input.ditCod },
            tx,
        );
        const decisoesDoBoleto = await this.sugestoes.listarDecisoes(
            {
                decisao: DECISAO_SUGESTAO_BOLETO.CONFIRMADA,
                ddcCod: input.ddcCod,
                ditCod: input.ditCod,
            },
            tx,
        );
        const carteira = new Map<string, TituloAPagar>();
        const entradas: TituloGrupoEntrada[] = [];
        for (const c of titulos) {
            const t = await this.titulos.buscarPorChave(c, tx);
            if (t) carteira.set(chaveTitulo(c), t);
            entradas.push(await this.entradaTitulo(c, t, abertos.get(chaveTitulo(c)), tx));
        }
        const pesCods = new Set(entradas.map((e) => e.pesCod));
        const [pesCod] = pesCods.size === 1 ? [...pesCods] : [undefined];
        const emissor = this.codigoBarras.emissor(boleto?.codbar);
        const parVigente =
            emissor && pesCod
                ? await this.sugestoes.buscarParVigente(pesCod, emissor.chave, tx, true)
                : null;
        return {
            boleto,
            titulos: carteira,
            entradas,
            boletoComDecisao: decisoesDoBoleto.length > 0,
            ...(pesCod ? { pesCod } : {}),
            ...(emissor ? { emissor } : {}),
            ...(parVigente ? { parVigenteId: parVigente.id } : {}),
        };
    };

    /** Um título relido sob o lock, como entrada da I19c (ausente da carteira = inativo). */
    private entradaTitulo = async (
        c: ChaveTituloGrupo,
        t: TituloAPagar | null,
        aberto: ValoresAbertoTitulo | undefined,
        tx: TransactionClient,
    ): Promise<TituloGrupoEntrada> => {
        const decisoes = await this.sugestoes.listarDecisoes(
            { decisao: DECISAO_SUGESTAO_BOLETO.CONFIRMADA, ...c },
            tx,
        );
        const marca = await this.bloqueios.findAtivo(c, tx);
        const comprometido = await this.lotes.loteComprometidoComTitulo(c, tx);
        const outroGrupo = await this.grupos.buscarConfirmadoPorTitulo(c, tx);
        const base = {
            ...c,
            decisaoConfirmada: decisoes.length > 0,
            marcaRetencaoAtiva: marca != null,
            emLoteComprometido: comprometido != null,
            ...(outroGrupo ? { grupoConfirmadoId: outroGrupo.id } : {}),
            ...(aberto ? { aberto } : {}),
        };
        if (!t) return { ...base, liberado: false, pago: false, ativo: false };
        const vencimento = this.vencimentoCivil(t);
        return {
            ...base,
            ...(t.pesCod ? { pesCod: t.pesCod } : {}),
            ...(vencimento ? { vencimento } : {}),
            liberado: t.liberado === true,
            pago: t.pago === true,
            ativo: t.ativo !== false,
            ...(t.formaPagamentoConexos !== undefined
                ? { formaPagamentoConexos: t.formaPagamentoConexos }
                : {}),
            ...(t.temBoleto !== undefined ? { temBoleto: t.temBoleto } : {}),
        };
    };

    /**
     * Origem `SUGERIDO`: o motor recalculado agora (o mesmo cenário da tela, sem cache) tem de
     * sugerir EXATAMENTE este conjunto para este boleto. Devolve `intercambiavel`.
     */
    private sugestaoAtual = async (
        input: EntradaConfirmarGrupo,
    ): Promise<SugestaoGrupoBoleto | undefined> =>
        this.motor
            .sugerir(await this.carregarCenario())
            .find((s) => s.ddcCod === input.ddcCod && s.ditCod === input.ditCod);

    private conferirSugestao = (
        input: EntradaConfirmarGrupo,
        titulos: readonly ChaveTituloGrupo[],
        avaliacao: AvaliacaoGrupo,
        sugestao: SugestaoGrupoBoleto | undefined,
    ): boolean => {
        if (!sugestao || !mesmoConjunto(sugestao.titulos, titulos)) {
            throw new GroupedBoletoNotConfirmableError({
                ddcCod: input.ddcCod,
                ditCod: input.ditCod,
                ...(avaliacao.codigoMascarado !== undefined
                    ? { codigoMascarado: avaliacao.codigoMascarado }
                    : {}),
                sugestaoMudou: true,
            });
        }
        return sugestao.intercambiavel;
    };

    /**
     * Avaliação recalculada → erro nomeado (precedência: filial, grupo, janela, título, soma). O
     * boleto já confirmado 1:1 (I15q) entra como motivo do grupo.
     */
    private exigirConfirmavel = (
        input: EntradaConfirmarGrupo,
        a: AvaliacaoGrupo,
        ctx: ContextoConfirmacao,
    ): void => {
        const boleto = {
            ddcCod: input.ddcCod,
            ditCod: input.ditCod,
            ...(a.codigoMascarado !== undefined ? { codigoMascarado: a.codigoMascarado } : {}),
        };
        if (a.motivosGrupo.includes(M.CRUZA_FILIAL)) {
            throw new GroupedBoletoCrossBranchError({
                filiais: input.titulos.map((t) => t.filCod),
                ddcCod: input.ddcCod,
                ditCod: input.ditCod,
            });
        }
        const doGrupo = a.motivosGrupo.filter((m) => !MOTIVOS_GRUPO_COM_ERRO_PROPRIO.has(m));
        if (ctx.boletoComDecisao) doGrupo.push(M.BOLETO_EM_DECISAO_1_1);
        if (doGrupo.length > 0) {
            throw new GroupedBoletoNotConfirmableError({ ...boleto, motivos: doGrupo });
        }
        const foraDaJanela = a.titulos.filter((t) => t.motivos.some((m) => MOTIVO_JANELA.has(m)));
        if (foraDaJanela.length > 0 && a.vencimentoBoleto !== undefined) {
            throw new GroupedBoletoDueWindowError({
                vencimentoBoleto: a.vencimentoBoleto,
                titulos: foraDaJanela.map((t) => ({
                    filCod: t.filCod,
                    docCod: t.docCod,
                    titCod: t.titCod,
                    vencimento: this.vencimentoCivil(ctx.titulos.get(chaveTitulo(t))),
                    deltaDias: t.deltaDias ?? 0,
                })),
            });
        }
        const inelegiveis = a.titulos.flatMap((t) => {
            const motivo = t.motivos.find((m) => !MOTIVO_JANELA.has(m));
            return motivo ? [{ filCod: t.filCod, docCod: t.docCod, titCod: t.titCod, motivo }] : [];
        });
        if (inelegiveis.length > 0) {
            throw new GroupedBoletoTitleIneligibleError({ titulos: inelegiveis });
        }
        if (
            a.motivosGrupo.includes(M.SOMA_DIFERENTE) &&
            a.valorBoletoCentavos !== undefined &&
            a.somaTitulosCentavos !== undefined
        ) {
            throw new GroupedBoletoSumMismatchError({
                filCod: input.titulos[0]?.filCod ?? 0,
                ...boleto,
                valorBoletoCentavos: a.valorBoletoCentavos,
                somaTitulosCentavos: a.somaTitulosCentavos,
            });
        }
        if (!a.confirmavel) {
            throw new GroupedBoletoNotConfirmableError({ ...boleto, motivos: a.motivos });
        }
    };

    /** I19g/PI-2: aviso exigido pela avaliação RECALCULADA e não reconhecido ⇒ 422. */
    private exigirAvisos = (
        input: EntradaConfirmarGrupo,
        a: AvaliacaoGrupo,
        ctx: ContextoConfirmacao,
    ): AvisoGrupo[] => {
        const faltantes = this.regra.avisosFaltantes(a, input.reconheceAvisos ?? []);
        if (faltantes.length === 0) return a.avisos;
        const titulo = a.titulos.find((t) => (t.deltaDias ?? 0) > 0) ?? a.titulos[0];
        const vencimentoBoleto = a.vencimentoBoleto ?? '';
        throw new WarningAcknowledgementRequiredError({
            filCod: titulo?.filCod ?? 0,
            docCod: titulo?.docCod ?? '',
            titCod: titulo?.titCod ?? '',
            ddcCod: input.ddcCod,
            ditCod: input.ditCod,
            avisos: faltantes,
            vencimentoTitulo: titulo
                ? this.vencimentoCivil(ctx.titulos.get(chaveTitulo(titulo)))
                : '',
            vencimentoBoleto,
            dataDebito: vencimentoBoleto,
        });
    };

    /** Par (`pesCod`, `emissorChave`) `VIGENTE` reutilizado, ou criado no mesmo ato (I19a, P1-3). */
    private garantirPar = async (
        input: EntradaConfirmarGrupo,
        ctx: ContextoConfirmacao,
        emissor: NonNullable<ContextoConfirmacao['emissor']>,
        pesCod: string,
        tx: TransactionClient,
    ): Promise<string> => {
        if (ctx.parVigenteId !== undefined) return ctx.parVigenteId;
        const credor = [...ctx.titulos.values()].find((t) => t.credor)?.credor;
        const { par, criado } = await this.sugestoes.inserirPar(
            {
                pesCod,
                ...(credor ? { credor } : {}),
                emissorChave: emissor.chave,
                layoutEmissor: emissor.layout,
                bancoEmissor: emissor.banco,
                emissorMascarado: emissor.mascarado,
                evidencia: {
                    origem: 'GRUPO_BOLETO',
                    origemGrupo: input.origem,
                    boleto: { ddcCod: input.ddcCod, ditCod: input.ditCod },
                    titulos: input.titulos.map((t) => `${t.filCod}:${t.docCod}/${t.titCod}`),
                    confirmadoPor: input.ator,
                },
                confirmadoPor: input.ator,
            },
            tx,
        );
        if (criado) {
            await this.sugestoes.inserirEvento(
                {
                    tipo: EVENTO_SUGESTAO_BOLETO.PAR_CONFIRMADO,
                    ator: input.ator,
                    pesCod,
                    emissorChave: emissor.chave,
                    detalhe: {
                        layoutEmissor: emissor.layout,
                        emissorMascarado: emissor.mascarado,
                        origem: 'GRUPO_BOLETO',
                    },
                },
                tx,
            );
        }
        return par.id;
    };

    /**
     * Anula na transação dada (I19t): estado do grupo e dos títulos (repositório), retirada dos N
     * itens do lote `RASCUNHO` (PI-6), aviso do lote comprometido e encerramento das marcas
     * `GRUPO_BOLETO`. Ordem de locks: linha do grupo (`FOR UPDATE`) e depois o lote.
     */
    private anularNaTransacao = async (
        input: {
            grupoId: string;
            motivo: string;
            tipoAnulacao: GrupoBoletoTipoAnulacao;
            ator: string;
        },
        tx: TransactionClient,
    ): Promise<ResultadoAnulacaoGrupo> => {
        const r = await this.grupos.anular(input, tx);
        if (r.resultado === RESULTADO_TRANSICAO_GRUPO.NAO_ENCONTRADO || !r.grupo) {
            throw new GroupedBoletoNotFoundError({ grupoId: input.grupoId });
        }
        if (r.resultado === RESULTADO_TRANSICAO_GRUPO.JA_APLICADO) {
            return { anulado: false, grupo: r.grupo };
        }
        if (r.resultado === RESULTADO_TRANSICAO_GRUPO.RECUSADO) {
            throw new GroupedBoletoStateConflictError({
                grupoId: input.grupoId,
                estado: r.grupo.estado,
                acao: 'anular',
            });
        }
        const grupo = r.grupo;
        let retiradoDoLoteId: string | undefined;
        let avisoLoteComprometido: ResultadoAnulacaoGrupo['avisoLoteComprometido'];
        for (const t of grupo.titulos) {
            const rascunho = await this.lotes.loteRascunhoComTitulo(t, tx);
            if (rascunho) {
                const op = await this.lotes.removerGrupo(
                    { loteId: rascunho, grupoId: grupo.id },
                    tx,
                );
                if (op === RESULTADO_OPERACAO_GRUPO.APLICADO) retiradoDoLoteId = rascunho;
                break;
            }
            const comprometido = await this.lotes.loteComprometidoComTitulo(t, tx);
            if (comprometido) {
                avisoLoteComprometido = {
                    loteId: comprometido.loteId,
                    status: comprometido.status,
                    mensagem: MENSAGEM_LOTE_COMPROMETIDO,
                };
                break;
            }
        }
        await this.bloqueios.encerrarDoGrupo(
            { grupoId: grupo.id, motivo: 'grupo de boleto anulado', ator: input.ator },
            tx,
        );
        return {
            anulado: true,
            grupo: { ...grupo, estado: GRUPO_BOLETO_ESTADO.ANULADO },
            ...(retiradoDoLoteId ? { retiradoDoLoteId } : {}),
            ...(avisoLoteComprometido ? { avisoLoteComprometido } : {}),
        };
    };

    /** Cenário local da sugestão (o mesmo da tela e da conferência do `SUGERIDO`). */
    private carregarCenario = async (): Promise<EntradaMotorGrupo> => {
        const [titulos, boletos, pares, decisoes, grupos, marcas, comprometidos] =
            await Promise.all([
                this.titulos.listAtivos(),
                this.boletos.listBoletos({}),
                this.sugestoes.listarParesVigentes(),
                this.sugestoes.listarChaveadas(DECISAO_SUGESTAO_BOLETO.CONFIRMADA),
                this.grupos.listarConfirmados(),
                this.bloqueios.listAtivos(),
                this.lotes.listTitulosEmLotesComprometidos(),
            ]);
        const loteComprometido = new Map(
            comprometidos.map((c) => [chaveTitulo(c), { id: c.id, status: c.status }] as const),
        );
        return {
            titulos: titulos.map((t) => {
                const lote = loteComprometido.get(chaveTitulo(t));
                return lote ? { ...t, loteComprometido: lote } : t;
            }),
            boletos,
            paresVigentes: pares.map((p) => ({ pesCod: p.pesCod, emissorChave: p.emissorChave })),
            decisoesConfirmadas: decisoes,
            gruposConfirmados: grupos.map((g) => ({
                id: g.id,
                ddcCod: g.ddcCod,
                ditCod: g.ditCod,
                titulos: g.titulos,
            })),
            marcasAtivas: marcas.map((m) => ({
                filCod: m.filCod,
                docCod: m.docCod,
                titCod: m.titCod,
            })),
        };
    };
}
