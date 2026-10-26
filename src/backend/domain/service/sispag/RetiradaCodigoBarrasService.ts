import { inject, injectable } from 'tsyringe';
import ConexosSispagWriteClient from '../../client/ConexosSispagWriteClient.js';
import PostgreeDatabaseClient from '../../client/database/PostgreeDatabaseClient.js';
import BoletoCodigoBarrasRetiradaIncompletaError, {
    type ItemRetiradaPendente,
} from '../../errors/BoletoCodigoBarrasRetiradaIncompletaError.js';
import BoletoLoteEsvaziadoPorCodigoError from '../../errors/BoletoLoteEsvaziadoPorCodigoError.js';
import { LOG_TYPE } from '../../interface/log/LogInterface.js';
import { GRUPO_BOLETO_EVENTO } from '../../interface/sispag/GrupoBoletoInterface.js';
import type { LinhasDigitaveisDoLote } from '../../interface/sispag/Fin015Write.js';
import type {
    MotivoRetiradaCodigoBarras,
    RetiradoPorCodigoBarras,
} from '../../interface/sispag/RetiradaCodigoBarras.js';
import {
    type ChaveTitulo,
    type ItemLote,
    type LotePagamento,
    MODALIDADE,
    MOTIVOS_RETIRADA_CODIGO_BARRAS,
    ORIGENS_RETENCAO_CODIGO_BARRAS,
    SISPAG_SYSTEM_ACTOR,
    SYSTEM_REMOVAL_REASON,
} from '../../interface/sispag/SispagInterface.js';
import AnaliseCodigoBarrasRepetido, {
    type DecisaoRetirada,
    MOTIVO_RETIRADA,
} from '../../libs/boleto/AnaliseCodigoBarrasRepetido.js';
import RetryExecutor from '../../libs/executor/RetryExecutor.js';
import BloqueioDuplicidadeRepository from '../../repository/sispag/BloqueioDuplicidadeRepository.js';
import GrupoBoletoExecucaoRepository from '../../repository/sispag/GrupoBoletoExecucaoRepository.js';
import GrupoBoletoRepository from '../../repository/sispag/GrupoBoletoRepository.js';
import LotePagamentoRepository from '../../repository/sispag/LotePagamentoRepository.js';
import VerificacaoEventoRepository from '../../repository/sispag/VerificacaoEventoRepository.js';
import LogService from '../LogService.js';
import BorderoGrupoBoletoService from './BorderoGrupoBoletoService.js';

/** Motivos pelos quais o boleto agrupado inteiro sai do lote (ADR-0077, I21p(3), I21s). */
export type MotivoRetiradaDoGrupo = 'GRUPO_BOLETO_FALHOU' | 'BORDERO_ANTERIOR_NAO_RESOLVIDO';

/**
 * Boleto agrupado no lote (ADR-0077). Vira UM item nativo (`borCod`) na leitura da guarda: os N
 * itens locais do grupo nunca são lidos como "código ausente". Com `retirar`, o grupo sai inteiro
 * (local primeiro, depois a limpeza do borderô); sem `borCod`, nunca houve borderô nosso para
 * limpar.
 */
export interface GrupoNaGuarda {
    grupoId: string;
    /** O borderô nosso no rascunho; ausente = nenhum borderô criado/importado nesta remessa. */
    borCod?: number;
    titulos: ChaveTitulo[];
    /** Máscara 5+4 do boleto do grupo. */
    codigoMascarado?: string;
    retirar?: { motivo: MotivoRetiradaDoGrupo };
}

/** Desfecho da limpeza do borderô de um grupo retirado. */
export type LimpezaDoGrupo = 'limpo' | 'pendente' | 'nada_a_limpar' | 'sem_bordero';

export interface GrupoRetirado {
    grupoId: string;
    borCod?: number;
    titulos: ChaveTitulo[];
    motivo: MotivoRetiradaDoGrupo;
    codigoMascarado?: string;
    limpeza: LimpezaDoGrupo;
}

export interface GarantirSemCodigoRepetidoInput {
    lote: LotePagamento;
    /** Boletos agrupados do lote (ADR-0077): um item nativo cada; ver {@link GrupoNaGuarda}. */
    grupos?: GrupoNaGuarda[];
    bncCod: number;
    flpCod: number;
    /**
     * `false` = o lote nativo já está FINALIZADO no ERP (retomada em `gerar_remessa`): o ERP não
     * deixa retirar item de lote finalizado, então nada local é mexido — só se aborta.
     */
    rascunhoAberto: boolean;
    /** A retomada já viu resíduos no rascunho: lê a lista mesmo sem boleto local. */
    forcarLeitura?: boolean;
    /**
     * Chaves (`filCod:docCod:titCod`) com decisão humana vigente (ADR-0071, I17h): no desempate da
     * I16d.1, quando EXATAMENTE uma do grupo está aqui, é a que fica. A análise segue pura.
     */
    preferidos?: ReadonlySet<string>;
    /**
     * Itens cujo vínculo do código falhou de forma DETERMINÍSTICA pós-import (ADR-0071, I17g(3)):
     * saem pela MESMA maquinaria (local primeiro, `DELETE` com `itsCodSeq` relido, ausência
     * observada), com motivo `VINCULO_CODIGO_BARRAS_FALHOU`. Só a máscara 5+4.
     */
    retiradosPeloVinculo?: Array<{
        titulo: ChaveTitulo;
        codigoMascarado?: string;
    }>;
}

export interface GarantirSemCodigoRepetidoResult {
    /** O lote local DEPOIS das retiradas (versão e itens atuais). Igual ao de entrada se nada saiu. */
    lote: LotePagamento;
    retirados: RetiradoPorCodigoBarras[];
    /** Boletos agrupados que saíram inteiros (cada título também consta em `retirados`). */
    gruposRetirados?: GrupoRetirado[];
    avisos: string[];
}

/** Resíduo reconhecido pelo par marca + evento (I16h(c)). */
export interface ResiduoReconhecido {
    motivo: MotivoRetiradaCodigoBarras;
    /** Item de borderô de um grupo já retirado localmente: sai pela limpeza do borderô (I16h). */
    grupo?: { grupoId: string; borCod: number; titulos: ChaveTitulo[] };
    codigoMascarado?: string;
    tituloMantido?: ChaveTitulo;
}

interface ItemNativo {
    chave: string;
    filCod: number;
    docCod: string;
    titCod: string;
    itsCodSeq?: number;
    /** Linha digitável de 47 (só dos itens que passaram no boundary). Nunca sai deste serviço. */
    codigo?: string;
    /** `true` = veio em `invalidos` (código presente mas recusado). */
    invalido: boolean;
    /** `true` = o item do rascunho ainda NÃO tem código (só a identidade nativa, ADR-0071). */
    semCodigo?: boolean;
    /** Item de borderô do boleto agrupado (`docCod 'bor'`, `titCod` = `borCod`). */
    borCod?: number;
}

interface AlvoRetirada {
    chave: string;
    filCod: number;
    docCod: string;
    titCod: string;
    motivo: MotivoTituloRetirado;
    mascarado?: string;
    mantida?: string;
    /** `true` = item que NÃO está mais no lote local (resíduo): só o `DELETE` nativo. */
    residuo: boolean;
}

/** Retirada por título: os motivos do grupo têm caminho próprio (`retirarGrupo`). */
type MotivoTituloRetirado = Exclude<MotivoRetiradaCodigoBarras, MotivoRetiradaDoGrupo>;

/** Grupo a retirar nesta passada: declarado, decidido pela análise ou resíduo (I16h). */
interface AlvoGrupo {
    grupo: GrupoNaGuarda;
    motivo: MotivoRetiradaDoGrupo;
    /** `true` = os itens locais já saíram numa tentativa anterior; só a limpeza do borderô. */
    residuo: boolean;
}

interface ContextoNativo {
    filCod: number;
    bncCod: number;
    flpCod: number;
}

const chaveDe = (t: { filCod: number; docCod: string; titCod: string }): string =>
    `${t.filCod}:${t.docCod}:${t.titCod}`;

const paraChaveTitulo = (chave: string): ChaveTitulo => {
    const [fil, doc, ...resto] = chave.split(':');
    return { filCod: Number(fil), docCod: String(doc), titCod: resto.join(':') };
};

const idCurto = (t: { docCod: string; titCod: string }): string => `${t.docCod}/${t.titCod}`;

const MOTIVOS = [...MOTIVOS_RETIRADA_CODIGO_BARRAS];

/** Chave do item de borderô na leitura nativa: `{fil}:bor:{borCod}`. */
const chaveDeBordero = (filCod: number, borCod: number): string => `${filCod}:bor:${borCod}`;

const borCodDaChave = (chave: string): number | undefined => {
    const m = chave.match(/^\d+:bor:(\d+)$/);
    return m?.[1] !== undefined ? Number(m[1]) : undefined;
};

const ORIGENS = [...ORIGENS_RETENCAO_CODIGO_BARRAS];

/**
 * Guarda de código de barras que RETIRA (ADR-0069 emenda 1, I16c, I16d, I16h) — substitui a
 * guarda que só abortava. Roda entre o import e o `finalizarLote`, sobre o rascunho nativo:
 *
 *  1. lê a lista nativa; leitura incompleta ⇒ ABORTA sem retirar nada (I16c);
 *  2. decide quem fica (I16d.1) e quem sai por ilegível (I16d.2);
 *  3. por item, LOCAL PRIMEIRO (uma transação: remove + marca + trilha), depois `DELETE` nativo
 *     com o `itsCodSeq` da leitura mais recente, depois releitura e CONFIRMAÇÃO DE AUSÊNCIA — o
 *     sucesso é a ausência observada, não o status do `DELETE` (I16d.3);
 *  4. reaplica I16a sobre a última leitura (I16d.7); só então o chamador finaliza.
 *
 * Resíduos de uma tentativa anterior (item já retirado localmente, ainda no rascunho) são
 * reconhecidos pelo PAR marca ATIVA de origem `CODIGO_BARRAS_*` + evento do sistema neste lote
 * (I16h(c)) e saem só pelo `DELETE`. Nunca se apaga o que não se reconhece.
 *
 * Privacidade (I16e): o código completo vive só nas variáveis locais desta classe. Log, erro,
 * trilha e marca recebem a máscara 5+4.
 */
@injectable()
export default class RetiradaCodigoBarrasService {
    /** Só a RELEITURA é retentável. O `DELETE` é tentativa única (nunca retry cego). */
    private readonly releitura = new RetryExecutor({ retries: 2, delayMs: 150, shouldLog: false });

    public constructor(
        @inject(ConexosSispagWriteClient) private readonly write: ConexosSispagWriteClient,
        @inject(LotePagamentoRepository) private readonly loteRepo: LotePagamentoRepository,
        @inject(PostgreeDatabaseClient) private readonly db: PostgreeDatabaseClient,
        @inject(AnaliseCodigoBarrasRepetido)
        private readonly analise: AnaliseCodigoBarrasRepetido,
        @inject(LogService) private readonly logService: LogService,
        @inject(BloqueioDuplicidadeRepository)
        private readonly bloqueios: BloqueioDuplicidadeRepository,
        @inject(VerificacaoEventoRepository) private readonly eventos: VerificacaoEventoRepository,
        @inject(GrupoBoletoRepository) private readonly grupoRepo: GrupoBoletoRepository,
        @inject(GrupoBoletoExecucaoRepository)
        private readonly execucoes: GrupoBoletoExecucaoRepository,
        @inject(BorderoGrupoBoletoService) private readonly borderoGrupo: BorderoGrupoBoletoService,
    ) {}

    /**
     * I16h: separa os `intrusos` (no rascunho, fora do lote local) em RESÍDUOS — retirados por
     * esta guarda neste lote (marca ATIVA de origem de código de barras + evento do sistema) — e
     * ESTRANHOS (qualquer outra coisa, inclusive retirada por duplicidade de título ou I13j).
     */
    public classificarIntrusos = async (
        loteId: string,
        intrusos: string[],
    ): Promise<{ residuos: Map<string, ResiduoReconhecido>; estranhos: string[] }> => {
        const residuos = new Map<string, ResiduoReconhecido>();
        if (intrusos.length === 0) return { residuos, estranhos: [] };
        const [marcas, retirados] = await Promise.all([
            this.bloqueios.listAtivosPorOrigem([...ORIGENS]),
            this.eventos.listarChavesRetiradasPeloSistema(loteId, [...MOTIVOS]),
        ]);
        const marcaPorChave = new Map(marcas.map((m) => [chaveDe(m), m]));
        const execucoesDoLote = intrusos.some((k) => borCodDaChave(k) !== undefined)
            ? await this.execucoes.listarPorLote(loteId)
            : [];
        const estranhos: string[] = [];
        for (const k of intrusos) {
            const borCod = borCodDaChave(k);
            if (borCod !== undefined) {
                // Item de borderô (ADR-0077, I16h): resíduo só se o grupo dessa execução tem as
                // marcas `GRUPO_BOLETO` E o evento do sistema neste lote, em TODOS os títulos.
                const residuo = await this.residuoDeGrupo(
                    borCod,
                    execucoesDoLote,
                    marcaPorChave,
                    retirados,
                );
                if (residuo) residuos.set(k, residuo);
                else estranhos.push(k);
                continue;
            }
            const marca = marcaPorChave.get(k);
            if (marca && retirados.has(k)) {
                residuos.set(k, {
                    motivo: marca.origem as MotivoRetiradaCodigoBarras,
                    ...(marca.codigoMascarado !== undefined
                        ? { codigoMascarado: marca.codigoMascarado }
                        : {}),
                    ...(marca.tituloMantido ? { tituloMantido: marca.tituloMantido } : {}),
                });
            } else {
                estranhos.push(k);
            }
        }
        return { residuos, estranhos };
    };

    private residuoDeGrupo = async (
        borCod: number,
        execucoesDoLote: ReadonlyArray<{ borCod?: number; grupoId: string }>,
        marcaPorChave: ReadonlyMap<string, { codigoMascarado?: string }>,
        retirados: ReadonlySet<string>,
    ): Promise<ResiduoReconhecido | undefined> => {
        const exec = execucoesDoLote.find((e) => e.borCod === borCod);
        if (!exec) return undefined;
        const grupo = await this.grupoRepo.buscarPorId(exec.grupoId);
        if (!grupo || grupo.titulos.length === 0) return undefined;
        const titulos = grupo.titulos.map((t) => ({
            filCod: t.filCod,
            docCod: t.docCod,
            titCod: t.titCod,
        }));
        const todosMarcadosERetirados = titulos.every(
            (t) => marcaPorChave.has(chaveDe(t)) && retirados.has(chaveDe(t)),
        );
        if (!todosMarcadosERetirados) return undefined;
        const mascara = marcaPorChave.get(chaveDe(titulos[0] as ChaveTitulo))?.codigoMascarado;
        return {
            motivo: SYSTEM_REMOVAL_REASON.GRUPO_BOLETO_FALHOU,
            ...(mascara !== undefined ? { codigoMascarado: mascara } : {}),
            grupo: { grupoId: exec.grupoId, borCod, titulos },
        };
    };

    public garantir = async (
        input: GarantirSemCodigoRepetidoInput,
    ): Promise<GarantirSemCodigoRepetidoResult> => {
        const { lote, bncCod, flpCod } = input;
        const inalterado: GarantirSemCodigoRepetidoResult = { lote, retirados: [], avisos: [] };
        const doVinculo = new Map(
            (input.retiradosPeloVinculo ?? []).map((v) => [chaveDe(v.titulo), v]),
        );
        const grupos = input.grupos ?? [];
        // Grupo sadio = UM item nativo (`borCod`); grupo a retirar não exige barra (como o vínculo
        // falho, I16c): é o alvo da retirada.
        const gruposLidos = grupos.filter((g) => g.retirar === undefined && g.borCod !== undefined);
        // Item que o vínculo falhou NÃO tem código no rascunho: não é "código ausente" (I16c), é o
        // alvo da retirada. Itens de grupo nunca são lidos por título.
        const boletos = lote.itens.filter(
            (i) =>
                i.modalidade === MODALIDADE.BOLETO &&
                i.grupoBoletoId === undefined &&
                !doVinculo.has(chaveDe(i)),
        );
        if (
            boletos.length === 0 &&
            doVinculo.size === 0 &&
            grupos.length === 0 &&
            input.forcarLeitura !== true
        ) {
            return inalterado;
        }

        const ctx: ContextoNativo = { filCod: lote.filCod, bncCod, flpCod };

        // ── 1. Leitura: incompleta ⇒ aborta sem retirar nada (I16c) ──
        let leitura: LinhasDigitaveisDoLote;
        try {
            leitura = await this.write.listarLinhasDigitaveisDoLote(ctx);
        } catch {
            // Falha de LEITURA não decide: nunca é "limpo". Nada foi retirado.
            throw this.erroLeitura('LISTA_ILEGIVEL', flpCod, boletos);
        }
        let estado = this.paraEstado(leitura);
        this.exigirLeituraCompleta(leitura, estado, boletos, gruposLidos, lote.filCod, flpCod);

        // ── 2. Decisão ──
        const locais = new Map(lote.itens.map((i) => [chaveDe(i), i]));
        const decisaoLocais = this.locaisDaDecisao(locais, gruposLidos, lote.filCod);
        const borDosGrupos = new Set(
            grupos.flatMap((g) =>
                g.borCod !== undefined ? [chaveDeBordero(lote.filCod, g.borCod)] : [],
            ),
        );
        const intrusos = estado
            .filter((e) => !locais.has(e.chave) && !borDosGrupos.has(e.chave))
            .map((e) => e.chave);
        const { residuos } = await this.classificarIntrusos(lote.id, intrusos);
        const preferidos = this.comItensDeGrupo(input.preferidos, gruposLidos, lote.filCod);
        const decisao = this.separarGrupos(
            this.alvosDaDecisao(this.decidir(estado, decisaoLocais, preferidos)),
            gruposLidos,
            lote.filCod,
        );
        const alvos = [
            ...decisao.alvos,
            ...[...doVinculo].map(([chave, v]) => this.alvoDoVinculo(chave, v)),
            ...[...residuos]
                .filter(([, r]) => r.grupo === undefined)
                .map(([chave, r]) => this.alvoDeResiduo(chave, r)),
        ];
        const alvosGrupo = this.alvosDeGrupo(grupos, decisao.grupos, residuos);
        if (alvos.length === 0 && alvosGrupo.length === 0) return inalterado;

        if (!input.rascunhoAberto) {
            throw new BoletoCodigoBarrasRetiradaIncompletaError({
                modo: 'finalizado',
                flpCod,
                pendentes: [
                    ...alvos.map((a) => ({ docCod: a.docCod, titCod: a.titCod })),
                    ...alvosGrupo.flatMap((a) =>
                        a.grupo.titulos.map((t) => ({ docCod: t.docCod, titCod: t.titCod })),
                    ),
                ],
            });
        }

        // ── 3. Retirada: local primeiro, ERP depois, ausência observada ──
        const feito = await this.retirarAlvos(ctx, lote, alvos, estado, locais);
        const { retirados, pendentes } = feito;
        estado = feito.estado;
        let gruposRetirados: GrupoRetirado[] = [];
        if (pendentes.length === 0 && alvosGrupo.length > 0) {
            const g = await this.retirarGrupos(ctx, lote, alvosGrupo, estado, locais);
            retirados.push(...g.retirados);
            pendentes.push(...g.pendentes);
            gruposRetirados = g.gruposRetirados;
            estado = g.estado;
        }

        await this.logarRetiradas(lote, flpCod, retirados, pendentes.length);
        if (pendentes.length > 0) {
            throw new BoletoCodigoBarrasRetiradaIncompletaError({
                modo: 'limpeza',
                flpCod,
                retirados: retirados.length,
                pendentes,
                restantesNoRascunho: estado.length,
            });
        }

        const atual = await this.posLimpeza(
            lote,
            estado,
            retirados,
            flpCod,
            preferidos,
            gruposLidos,
        );
        return {
            lote: atual,
            retirados,
            ...(gruposRetirados.length > 0 ? { gruposRetirados } : {}),
            avisos: this.avisos(retirados, gruposRetirados),
        };
    };

    // ── Boleto agrupado (ADR-0077) ─────────────────────────────────────────────────────────

    /** Os locais da DECISÃO: os itens do lote + um item por grupo sadio (o borderô). */
    private locaisDaDecisao = (
        locais: Map<string, ItemLote>,
        gruposLidos: GrupoNaGuarda[],
        filCod: number,
    ): Map<string, { vencimento?: number }> => {
        const todos = new Map<string, { vencimento?: number }>(locais);
        for (const g of gruposLidos) {
            if (g.borCod !== undefined) todos.set(chaveDeBordero(filCod, g.borCod), {});
        }
        return todos;
    };

    /** I16d.1: o item de borderô de grupo confirmado conta como "com decisão humana vigente". */
    private comItensDeGrupo = (
        preferidos: ReadonlySet<string> | undefined,
        gruposLidos: GrupoNaGuarda[],
        filCod: number,
    ): ReadonlySet<string> | undefined => {
        if (gruposLidos.length === 0) return preferidos;
        return new Set([
            ...(preferidos ?? []),
            ...gruposLidos.flatMap((g) =>
                g.borCod !== undefined ? [chaveDeBordero(filCod, g.borCod)] : [],
            ),
        ]);
    };

    /** Alvo da análise que é o item de borderô de um grupo sadio sai como GRUPO inteiro. */
    private separarGrupos = (
        alvos: AlvoRetirada[],
        gruposLidos: GrupoNaGuarda[],
        filCod: number,
    ): { alvos: AlvoRetirada[]; grupos: GrupoNaGuarda[] } => {
        const porChave = new Map(
            gruposLidos.flatMap((g) =>
                g.borCod !== undefined ? [[chaveDeBordero(filCod, g.borCod), g] as const] : [],
            ),
        );
        const grupos: GrupoNaGuarda[] = [];
        const restantes: AlvoRetirada[] = [];
        for (const a of alvos) {
            const g = porChave.get(a.chave);
            if (g) grupos.push(g);
            else restantes.push(a);
        }
        return { alvos: restantes, grupos };
    };

    /** Declarados (preparar/vínculo falhou), decididos pela análise e resíduos de retomada. */
    private alvosDeGrupo = (
        declarados: GrupoNaGuarda[],
        daDecisao: GrupoNaGuarda[],
        residuos: ReadonlyMap<string, ResiduoReconhecido>,
    ): AlvoGrupo[] => [
        ...declarados.flatMap((g) =>
            g.retirar ? [{ grupo: g, motivo: g.retirar.motivo, residuo: false }] : [],
        ),
        ...daDecisao.map((g) => ({
            grupo: g,
            motivo: SYSTEM_REMOVAL_REASON.GRUPO_BOLETO_FALHOU as MotivoRetiradaDoGrupo,
            residuo: false,
        })),
        ...[...residuos.values()].flatMap((r) =>
            r.grupo
                ? [
                      {
                          grupo: {
                              grupoId: r.grupo.grupoId,
                              borCod: r.grupo.borCod,
                              titulos: r.grupo.titulos,
                              ...(r.codigoMascarado !== undefined
                                  ? { codigoMascarado: r.codigoMascarado }
                                  : {}),
                          },
                          motivo: SYSTEM_REMOVAL_REASON.GRUPO_BOLETO_FALHOU as MotivoRetiradaDoGrupo,
                          residuo: true,
                      },
                  ]
                : [],
        ),
    ];

    /**
     * Um grupo por vez: transação local (N itens + N marcas + N eventos + `GRUPO_RETIRADO`) →
     * limpeza do borderô (ela apaga o item nativo na ordem imposta pelo ERP, I21q) → releitura e
     * confirmação de ausência do item. Falha parcial ⇒ pendente: a guarda FECHA, a retomada
     * termina a limpeza (resíduo, I16h).
     */
    private retirarGrupos = async (
        ctx: ContextoNativo,
        lote: LotePagamento,
        alvos: AlvoGrupo[],
        estadoInicial: ItemNativo[],
        locais: Map<string, ItemLote>,
    ): Promise<{
        retirados: RetiradoPorCodigoBarras[];
        pendentes: ItemRetiradaPendente[];
        gruposRetirados: GrupoRetirado[];
        estado: ItemNativo[];
    }> => {
        const retirados: RetiradoPorCodigoBarras[] = [];
        const pendentes: ItemRetiradaPendente[] = [];
        const gruposRetirados: GrupoRetirado[] = [];
        let estado = estadoInicial;
        const pendenteDe = (a: AlvoGrupo): ItemRetiradaPendente[] =>
            a.grupo.titulos.map((t) => ({ docCod: t.docCod, titCod: t.titCod }));
        for (let i = 0; i < alvos.length; i += 1) {
            const alvo = alvos[i] as AlvoGrupo;
            const { grupo } = alvo;
            if (!alvo.residuo && !(await this.retirarGrupoLocal(lote, alvo))) {
                // Fail-closed: o local não saiu ⇒ nenhuma limpeza no ERP; este e os que faltam
                // ficam pendentes.
                for (const resto of alvos.slice(i)) pendentes.push(...pendenteDe(resto));
                break;
            }
            const limpeza = await this.limparBordero(grupo, alvo.motivo);
            let ausente = true;
            if (grupo.borCod !== undefined) {
                const relida = await this.reler(ctx);
                if (relida === undefined) {
                    for (const resto of alvos.slice(i)) pendentes.push(...pendenteDe(resto));
                    break;
                }
                estado = relida;
                ausente = !estado.some(
                    (e) => e.chave === chaveDeBordero(ctx.filCod, grupo.borCod as number),
                );
            }
            if (limpeza === 'pendente' || !ausente) {
                pendentes.push(...pendenteDe(alvo));
                continue;
            }
            for (const t of grupo.titulos) {
                const local = locais.get(chaveDe(t));
                retirados.push({
                    titulo: { filCod: t.filCod, docCod: t.docCod, titCod: t.titCod },
                    ...(local?.valor !== undefined ? { valor: local.valor } : {}),
                    ...(local?.vencimento !== undefined
                        ? { vencimento: new Date(local.vencimento).toISOString().slice(0, 10) }
                        : {}),
                    ...(local?.credor ? { credor: local.credor } : {}),
                    ...(grupo.codigoMascarado !== undefined
                        ? { codigoMascarado: grupo.codigoMascarado }
                        : {}),
                    motivo: alvo.motivo,
                });
            }
            gruposRetirados.push({
                grupoId: grupo.grupoId,
                ...(grupo.borCod !== undefined ? { borCod: grupo.borCod } : {}),
                titulos: grupo.titulos,
                motivo: alvo.motivo,
                ...(grupo.codigoMascarado !== undefined
                    ? { codigoMascarado: grupo.codigoMascarado }
                    : {}),
                limpeza,
            });
        }
        return { retirados, pendentes, gruposRetirados, estado };
    };

    /** N itens + N marcas + N eventos + `GRUPO_RETIRADO`, numa transação. `false` = nada saiu. */
    private retirarGrupoLocal = async (lote: LotePagamento, alvo: AlvoGrupo): Promise<boolean> => {
        const { grupo, motivo } = alvo;
        try {
            return await this.db.withTransaction(async (tx) => {
                const r = await this.loteRepo.retirarGrupoPeloSistema(
                    {
                        loteId: lote.id,
                        grupoId: grupo.grupoId,
                        motivo,
                        titulos: grupo.titulos,
                        ...(grupo.codigoMascarado !== undefined
                            ? { codigoMascarado: grupo.codigoMascarado }
                            : {}),
                    },
                    tx,
                );
                if (r.removidos === 0) return false;
                await this.grupoRepo.registrarEvento(
                    {
                        grupoId: grupo.grupoId,
                        tipo: GRUPO_BOLETO_EVENTO.GRUPO_RETIRADO,
                        ator: SISPAG_SYSTEM_ACTOR,
                        filCod: lote.filCod,
                        loteId: lote.id,
                        ...(grupo.borCod !== undefined ? { borCod: grupo.borCod } : {}),
                        ...(grupo.codigoMascarado !== undefined
                            ? { codigoMascarado: grupo.codigoMascarado }
                            : {}),
                        dados: { motivo, titulos: r.removidos },
                    },
                    tx,
                );
                return true;
            });
        } catch {
            await this.logService.warn({
                type: LOG_TYPE.BUSINESS_WARN,
                message:
                    'remessa: retirada local do boleto agrupado falhou — limpeza não executada',
                data: { loteId: lote.id, grupoId: grupo.grupoId },
            });
            return false;
        }
    };

    /**
     * Limpeza do borderô que NÓS criamos (I21q): quem decide o que apagar é o serviço do borderô
     * (lote nativo lido ao vivo, identidade `borCod + borTimCad`, nunca o antigo de J rejeitado).
     * Sem `borCod` não houve borderô nosso nesta remessa.
     */
    private limparBordero = async (
        grupo: GrupoNaGuarda,
        motivo: MotivoRetiradaDoGrupo,
    ): Promise<LimpezaDoGrupo> => {
        if (grupo.borCod === undefined) return 'sem_bordero';
        try {
            const execucao = await this.execucoes.ultimaPorGrupo(grupo.grupoId);
            if (!execucao) return 'nada_a_limpar';
            const r = await this.borderoGrupo.limpar({ execucao, motivo });
            return r.desfecho;
        } catch {
            await this.logService.warn({
                type: LOG_TYPE.BUSINESS_WARN,
                message: 'remessa: limpeza do borderô do grupo não concluiu — fica pendente',
                data: { grupoId: grupo.grupoId, borCod: grupo.borCod },
            });
            return 'pendente';
        }
    };

    /**
     * Um alvo por vez, em sequência (uma sessão Conexos): transação local → `DELETE` com o
     * `itsCodSeq` da leitura mais recente → releitura → confirmação de ausência. A releitura de um
     * passo é a leitura "na hora" do próximo.
     */
    private retirarAlvos = async (
        ctx: ContextoNativo,
        lote: LotePagamento,
        alvos: AlvoRetirada[],
        estadoInicial: ItemNativo[],
        locais: Map<string, ItemLote>,
    ): Promise<{
        retirados: RetiradoPorCodigoBarras[];
        pendentes: ItemRetiradaPendente[];
        estado: ItemNativo[];
    }> => {
        const retirados: RetiradoPorCodigoBarras[] = [];
        const pendentes: ItemRetiradaPendente[] = [];
        let estado = estadoInicial;
        for (let i = 0; i < alvos.length; i += 1) {
            const alvo = alvos[i] as AlvoRetirada;
            if (!alvo.residuo && !(await this.retirarLocal(lote.id, alvo))) {
                // Fail-closed: o local não saiu (sem efeito ou transação falhou) ⇒ nenhum DELETE
                // nativo, nada contado como retirado. Este e os que faltam ficam pendentes.
                for (const resto of alvos.slice(i)) {
                    pendentes.push({ docCod: resto.docCod, titCod: resto.titCod });
                }
                break;
            }

            const nativo = estado.find((e) => e.chave === alvo.chave);
            let ausente = nativo === undefined;
            if (nativo?.itsCodSeq !== undefined) {
                await this.apagarNoRascunho(ctx, nativo.itsCodSeq, alvo);
            }
            if (nativo !== undefined) {
                const relida = await this.reler(ctx);
                if (relida === undefined) {
                    // Sem releitura utilizável não há como confirmar ausência — nem o `itsCodSeq`
                    // dos próximos. Este e os que faltam ficam pendentes (os locais já saíram).
                    for (const resto of alvos.slice(i)) {
                        pendentes.push({ docCod: resto.docCod, titCod: resto.titCod });
                    }
                    break;
                }
                estado = relida;
                ausente = !estado.some((e) => e.chave === alvo.chave);
            }
            if (ausente) retirados.push(this.paraRetirado(alvo, locais));
            else pendentes.push({ docCod: alvo.docCod, titCod: alvo.titCod });
        }
        return { retirados, pendentes, estado };
    };

    // ── Pós-limpeza (I16d.7) ────────────────────────────────────────────────

    private posLimpeza = async (
        lote: LotePagamento,
        estado: ItemNativo[],
        retirados: RetiradoPorCodigoBarras[],
        flpCod: number,
        preferidos?: ReadonlySet<string>,
        gruposLidos: GrupoNaGuarda[] = [],
    ): Promise<LotePagamento> => {
        const atual = await this.loteRepo.getLoteComItens(lote.id);
        if (!atual || atual.itens.length === 0) {
            throw new BoletoLoteEsvaziadoPorCodigoError({
                loteId: lote.id,
                flpCod,
                itens: retirados.map((r) => ({
                    docCod: r.titulo.docCod,
                    titCod: r.titulo.titCod,
                    motivo: r.motivo,
                })),
            });
        }
        // I16a de novo sobre a ÚLTIMA leitura: zero repetido, zero ilegível.
        const locais = this.locaisDaDecisao(
            new Map(atual.itens.map((i) => [chaveDe(i), i])),
            gruposLidos,
            lote.filCod,
        );
        const decisao = this.decidir(estado, locais, preferidos);
        const aindaRuins = [...decisao.retirar, ...decisao.ilegiveis].map((r) =>
            paraChaveTitulo(r.chave),
        );
        if (aindaRuins.length > 0) {
            throw new BoletoCodigoBarrasRetiradaIncompletaError({
                modo: 'limpeza',
                flpCod,
                retirados: retirados.length,
                pendentes: aindaRuins.map((t) => ({ docCod: t.docCod, titCod: t.titCod })),
                restantesNoRascunho: estado.length,
            });
        }
        return atual;
    };

    // ── Leitura ─────────────────────────────────────────────────────────────

    /** Releitura depois de um `DELETE`: com retry; `undefined` = inutilizável (falha ou truncada). */
    private reler = async (ctx: ContextoNativo): Promise<ItemNativo[] | undefined> => {
        try {
            const leitura = await this.releitura.execute(() =>
                this.write.listarLinhasDigitaveisDoLote(ctx),
            );
            const estado = this.paraEstado(leitura);
            const utilizavel =
                leitura.completa === true && estado.every((e) => e.itsCodSeq !== undefined);
            return utilizavel ? estado : undefined;
        } catch {
            return undefined;
        }
    };

    private paraEstado = (leitura: LinhasDigitaveisDoLote): ItemNativo[] => [
        ...leitura.itens.map((i) => ({
            chave: chaveDe(i),
            filCod: i.filCod,
            docCod: i.docCod,
            titCod: i.titCod,
            ...(i.itsCodSeq !== undefined ? { itsCodSeq: i.itsCodSeq } : {}),
            codigo: i.linhaDigitavel,
            invalido: false,
        })),
        ...(leitura.invalidos ?? []).map((i) => ({
            chave: chaveDe(i),
            filCod: i.filCod,
            docCod: i.docCod,
            titCod: i.titCod,
            ...(i.itsCodSeq !== undefined ? { itsCodSeq: i.itsCodSeq } : {}),
            invalido: true,
        })),
        // Itens de borderô do boleto agrupado (ADR-0077): `docCod 'bor'`, `titCod` = `borCod`.
        ...(leitura.itensDeBordero ?? []).map((b) => ({
            chave: chaveDeBordero(b.filCod, b.borCod),
            filCod: b.filCod,
            docCod: 'bor',
            titCod: String(b.borCod),
            borCod: b.borCod,
            ...(b.itsCodSeq !== undefined ? { itsCodSeq: b.itsCodSeq } : {}),
            ...(b.linhaDigitavel !== undefined ? { codigo: b.linhaDigitavel } : {}),
            invalido: b.invalido === true,
            ...(b.linhaDigitavel === undefined && b.invalido !== true
                ? { semCodigo: true as const }
                : {}),
        })),
        // Itens ainda sem código (ADR-0071): só identidade. Não contam como "boleto lido" (I16c),
        // mas dão ao `DELETE` o `itsCodSeq` e à releitura a confirmação de ausência.
        ...(leitura.semCodigo ?? []).map((i) => ({
            chave: chaveDe(i),
            filCod: i.filCod,
            docCod: i.docCod,
            titCod: i.titCod,
            itsCodSeq: i.itsCodSeq,
            invalido: false,
            semCodigo: true,
        })),
    ];

    private erroLeitura = (
        causa: 'LISTA_TRUNCADA' | 'LISTA_ILEGIVEL' | 'ITEM_SEM_IDENTIDADE' | 'CODIGO_AUSENTE',
        flpCod: number,
        itens: Array<{ docCod: string; titCod: string }>,
    ): BoletoCodigoBarrasRetiradaIncompletaError =>
        new BoletoCodigoBarrasRetiradaIncompletaError({
            modo: 'leitura',
            flpCod,
            causa,
            pendentes: itens.map((i) => ({ docCod: i.docCod, titCod: i.titCod })),
        });

    /** I16c: lista truncada, item sem `itsCodSeq` ou boleto local sem leitura ⇒ aborta. */
    private exigirLeituraCompleta = (
        leitura: LinhasDigitaveisDoLote,
        estado: ItemNativo[],
        boletos: ItemLote[],
        gruposLidos: GrupoNaGuarda[],
        filCod: number,
        flpCod: number,
    ): void => {
        if (leitura.completa !== true) throw this.erroLeitura('LISTA_TRUNCADA', flpCod, boletos);
        const semIdentidade = estado.filter((e) => e.itsCodSeq === undefined);
        if (semIdentidade.length > 0) {
            throw this.erroLeitura('ITEM_SEM_IDENTIDADE', flpCod, semIdentidade);
        }
        // Só o item COM código (legível ou recusado) conta como lido (I16c): o sem código não.
        const lidas = new Set(estado.filter((e) => e.semCodigo !== true).map((e) => e.chave));
        const semLeitura = boletos.filter((b) => !lidas.has(chaveDe(b)));
        // O boleto agrupado conta como UM item nativo: sem barra no item de borderô antes do
        // `finalizar` aborta como hoje (ADR-0040); a pendência lista os títulos do grupo.
        const gruposSemLeitura = gruposLidos.filter(
            (g) => g.borCod !== undefined && !lidas.has(chaveDeBordero(filCod, g.borCod)),
        );
        if (semLeitura.length > 0 || gruposSemLeitura.length > 0) {
            throw this.erroLeitura('CODIGO_AUSENTE', flpCod, [
                ...semLeitura,
                ...gruposSemLeitura.flatMap((g) => g.titulos),
            ]);
        }
    };

    // ── Decisão ─────────────────────────────────────────────────────────────

    /** I16d.1/I16d.2 sobre os itens do rascunho que ainda são do lote local. */
    private decidir = (
        estado: ItemNativo[],
        locais: Map<string, { vencimento?: number }>,
        preferidos?: ReadonlySet<string>,
    ): DecisaoRetirada => {
        const legiveis = estado
            .filter((e) => !e.invalido && e.codigo !== undefined && locais.has(e.chave))
            .map((e) => {
                const vencimento = locais.get(e.chave)?.vencimento;
                return {
                    chave: e.chave,
                    codigo: e.codigo as string,
                    filCod: e.filCod,
                    docCod: e.docCod,
                    titCod: e.titCod,
                    ...(vencimento !== undefined ? { vencimento } : {}),
                };
            });
        const decisao = this.analise.decidirRetirada(legiveis, preferidos);
        const invalidos = estado
            .filter((e) => e.invalido && locais.has(e.chave))
            .map((e) => ({ chave: e.chave, motivo: MOTIVO_RETIRADA.CODIGO_BARRAS_ILEGIVEL }));
        return { retirar: decisao.retirar, ilegiveis: [...decisao.ilegiveis, ...invalidos] };
    };

    private alvosDaDecisao = (decisao: DecisaoRetirada): AlvoRetirada[] => [
        ...decisao.retirar.map((r) => ({
            chave: r.chave,
            ...paraChaveTitulo(r.chave),
            motivo: r.motivo as MotivoTituloRetirado,
            mascarado: r.mascarado,
            mantida: r.mantida,
            residuo: false,
        })),
        ...decisao.ilegiveis.map((i) => ({
            chave: i.chave,
            ...paraChaveTitulo(i.chave),
            motivo: i.motivo as MotivoTituloRetirado,
            residuo: false,
        })),
    ];

    private alvoDoVinculo = (
        chave: string,
        v: { titulo: ChaveTitulo; codigoMascarado?: string },
    ): AlvoRetirada => ({
        chave,
        ...paraChaveTitulo(chave),
        motivo: SYSTEM_REMOVAL_REASON.VINCULO_CODIGO_BARRAS_FALHOU,
        ...(v.codigoMascarado !== undefined ? { mascarado: v.codigoMascarado } : {}),
        residuo: false,
    });

    private alvoDeResiduo = (chave: string, r: ResiduoReconhecido): AlvoRetirada => ({
        chave,
        ...paraChaveTitulo(chave),
        motivo: r.motivo as MotivoTituloRetirado,
        ...(r.codigoMascarado !== undefined ? { mascarado: r.codigoMascarado } : {}),
        ...(r.tituloMantido ? { mantida: chaveDe(r.tituloMantido) } : {}),
        residuo: true,
    });

    // ── Efeitos ─────────────────────────────────────────────────────────────

    /** `true` só quando a transação local confirmou a retirada; falha ou `removido:false` ⇒ `false`. */
    private retirarLocal = async (loteId: string, alvo: AlvoRetirada): Promise<boolean> => {
        try {
            const r = await this.db.withTransaction((tx) =>
                this.loteRepo.retirarItemPorCodigoDeBarras(
                    {
                        loteId,
                        filCod: alvo.filCod,
                        docCod: alvo.docCod,
                        titCod: alvo.titCod,
                        motivo: alvo.motivo,
                        ...(alvo.mascarado !== undefined
                            ? { codigoMascarado: alvo.mascarado }
                            : {}),
                        ...(alvo.mantida !== undefined
                            ? { tituloMantido: paraChaveTitulo(alvo.mantida) }
                            : {}),
                    },
                    tx,
                ),
            );
            if (r?.removido === true) return true;
            await this.logService.warn({
                type: LOG_TYPE.BUSINESS_WARN,
                message: 'remessa: retirada local sem efeito — DELETE nativo não executado',
                data: { loteId, item: idCurto(alvo) },
            });
            return false;
        } catch {
            await this.logService.warn({
                type: LOG_TYPE.BUSINESS_WARN,
                message: 'remessa: retirada local falhou — DELETE nativo não executado',
                data: { loteId, item: idCurto(alvo) },
            });
            return false;
        }
    };

    /** `DELETE` de tentativa única. A falha NÃO decide: a releitura é quem diz se saiu. */
    private apagarNoRascunho = async (
        ctx: ContextoNativo,
        itsCodSeq: number,
        alvo: AlvoRetirada,
    ): Promise<void> => {
        try {
            await this.write.removerItemDoRascunho({
                filCod: ctx.filCod,
                bncCod: ctx.bncCod,
                flpCod: ctx.flpCod,
                itsCodSeq,
                filCodItem: alvo.filCod,
            });
        } catch (e) {
            await this.logService.warn({
                type: LOG_TYPE.BUSINESS_WARN,
                message: 'remessa: DELETE do item no rascunho falhou — a releitura decide',
                data: {
                    flpCod: ctx.flpCod,
                    item: idCurto(alvo),
                    erro: e instanceof Error ? e.message.replace(/\d{10,}/g, '…') : 'desconhecido',
                },
            });
        }
    };

    private paraRetirado = (
        alvo: AlvoRetirada,
        locais: Map<string, ItemLote>,
    ): RetiradoPorCodigoBarras => {
        const local = locais.get(alvo.chave);
        return {
            titulo: { filCod: alvo.filCod, docCod: alvo.docCod, titCod: alvo.titCod },
            ...(local?.valor !== undefined ? { valor: local.valor } : {}),
            ...(local?.vencimento !== undefined
                ? { vencimento: new Date(local.vencimento).toISOString().slice(0, 10) }
                : {}),
            ...(local?.credor ? { credor: local.credor } : {}),
            ...(alvo.mascarado !== undefined ? { codigoMascarado: alvo.mascarado } : {}),
            ...(alvo.mantida !== undefined ? { tituloMantido: paraChaveTitulo(alvo.mantida) } : {}),
            motivo: alvo.motivo,
        };
    };

    // ── Saída ───────────────────────────────────────────────────────────────

    private logarRetiradas = async (
        lote: LotePagamento,
        flpCod: number,
        retirados: RetiradoPorCodigoBarras[],
        pendentes: number,
    ): Promise<void> => {
        await this.logService.warn({
            type: LOG_TYPE.BUSINESS_WARN,
            message: 'remessa: itens retirados do lote por código de barras repetido ou ilegível',
            data: {
                loteId: lote.id,
                flpCod,
                retirados: retirados.length,
                pendentes,
                motivos: [...new Set(retirados.map((r) => r.motivo))],
                mascarados: [
                    ...new Set(
                        retirados
                            .map((r) => r.codigoMascarado)
                            .filter((m): m is string => m !== undefined),
                    ),
                ],
            },
        });
    };

    /** I16f: o resultado da geração carrega `avisos` não vazio quando algo saiu do lote. */
    private avisos = (
        retirados: RetiradoPorCodigoBarras[],
        gruposRetirados: GrupoRetirado[] = [],
    ): string[] => {
        const avisos: string[] = [];
        // I16e: o aviso do grupo cita o borderô, os títulos e o código MASCARADO.
        for (const g of gruposRetirados) {
            const bordero = g.borCod !== undefined ? ` (borderô ${g.borCod})` : '';
            const codigo = g.codigoMascarado !== undefined ? `, código ${g.codigoMascarado}` : '';
            avisos.push(
                `Boleto agrupado retirado do lote${bordero}: ${g.titulos.map(idCurto).join(', ')}` +
                    `${codigo}. Os títulos ficam retidos até a analista desfazer a retenção; ` +
                    (g.motivo === SYSTEM_REMOVAL_REASON.BORDERO_ANTERIOR_NAO_RESOLVIDO
                        ? 'resolva o borderô anterior no Conexos antes de pôr o grupo num lote novo.'
                        : 'confira o boleto e o borderô no Conexos.'),
            );
        }
        const repetidos = retirados.filter((r) => r.motivo === 'CODIGO_BARRAS_REPETIDO');
        const ilegiveis = retirados.filter((r) => r.motivo === 'CODIGO_BARRAS_ILEGIVEL');
        if (repetidos.length > 0) {
            const lista = repetidos.map((r) => {
                const ficou = r.tituloMantido ? ` (ficou ${idCurto(r.tituloMantido)})` : '';
                return `${idCurto(r.titulo)}${ficou}`;
            });
            avisos.push(
                `${repetidos.length} título(s) retirado(s) do lote por boleto repetido: ` +
                    `${lista.join(', ')}. Eles ficam retidos até a analista desfazer a retenção.`,
            );
        }
        if (ilegiveis.length > 0) {
            avisos.push(
                `${ilegiveis.length} título(s) retirado(s) do lote por código de barras ilegível: ` +
                    `${ilegiveis.map((r) => idCurto(r.titulo)).join(', ')}. Revise o boleto no Conexos.`,
            );
        }
        const vinculos = retirados.filter((r) => r.motivo === 'VINCULO_CODIGO_BARRAS_FALHOU');
        if (vinculos.length > 0) {
            avisos.push(
                `${vinculos.length} título(s) retirado(s) do lote porque o vínculo do código de ` +
                    `barras confirmado falhou: ${vinculos.map((r) => idCurto(r.titulo)).join(', ')}. ` +
                    'Eles ficam retidos até a analista desfazer a retenção; confira o boleto.',
            );
        }
        return avisos;
    };
}
