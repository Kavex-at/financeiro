import { inject, injectable } from 'tsyringe';
import ConexosSispagWriteClient from '../../client/ConexosSispagWriteClient.js';
import PostgreeDatabaseClient from '../../client/database/PostgreeDatabaseClient.js';
import BoletoCodigoBarrasRetiradaIncompletaError, {
    type ItemRetiradaPendente,
} from '../../errors/BoletoCodigoBarrasRetiradaIncompletaError.js';
import BoletoLoteEsvaziadoPorCodigoError from '../../errors/BoletoLoteEsvaziadoPorCodigoError.js';
import { LOG_TYPE } from '../../interface/log/LogInterface.js';
import type { LinhasDigitaveisDoLote } from '../../interface/sispag/Fin015Write.js';
import type {
    MotivoRetiradaCodigoBarras,
    RetiradoPorCodigoBarras,
} from '../../interface/sispag/RetiradaCodigoBarras.js';
import {
    type ChaveTitulo,
    DUPLICATE_HOLD_ORIGIN,
    type ItemLote,
    type LotePagamento,
    MODALIDADE,
    SYSTEM_REMOVAL_REASON,
} from '../../interface/sispag/SispagInterface.js';
import AnaliseCodigoBarrasRepetido, {
    type DecisaoRetirada,
    MOTIVO_RETIRADA,
} from '../../libs/boleto/AnaliseCodigoBarrasRepetido.js';
import RetryExecutor from '../../libs/executor/RetryExecutor.js';
import BloqueioDuplicidadeRepository from '../../repository/sispag/BloqueioDuplicidadeRepository.js';
import LotePagamentoRepository from '../../repository/sispag/LotePagamentoRepository.js';
import VerificacaoEventoRepository from '../../repository/sispag/VerificacaoEventoRepository.js';
import LogService from '../LogService.js';

export interface GarantirSemCodigoRepetidoInput {
    lote: LotePagamento;
    bncCod: number;
    flpCod: number;
    /**
     * `false` = o lote nativo já está FINALIZADO no ERP (retomada em `gerar_remessa`): o ERP não
     * deixa retirar item de lote finalizado, então nada local é mexido — só se aborta.
     */
    rascunhoAberto: boolean;
    /** A retomada já viu resíduos no rascunho: lê a lista mesmo sem boleto local. */
    forcarLeitura?: boolean;
}

export interface GarantirSemCodigoRepetidoResult {
    /** O lote local DEPOIS das retiradas (versão e itens atuais). Igual ao de entrada se nada saiu. */
    lote: LotePagamento;
    retirados: RetiradoPorCodigoBarras[];
    avisos: string[];
}

/** Resíduo reconhecido pelo par marca + evento (I16h(c)). */
export interface ResiduoReconhecido {
    motivo: MotivoRetiradaCodigoBarras;
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
}

interface AlvoRetirada {
    chave: string;
    filCod: number;
    docCod: string;
    titCod: string;
    motivo: MotivoRetiradaCodigoBarras;
    mascarado?: string;
    mantida?: string;
    /** `true` = item que NÃO está mais no lote local (resíduo): só o `DELETE` nativo. */
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

const MOTIVOS = [
    SYSTEM_REMOVAL_REASON.CODIGO_BARRAS_REPETIDO,
    SYSTEM_REMOVAL_REASON.CODIGO_BARRAS_ILEGIVEL,
];

const ORIGENS = [
    DUPLICATE_HOLD_ORIGIN.CODIGO_BARRAS_REPETIDO,
    DUPLICATE_HOLD_ORIGIN.CODIGO_BARRAS_ILEGIVEL,
];

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
        const estranhos: string[] = [];
        for (const k of intrusos) {
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

    public garantir = async (
        input: GarantirSemCodigoRepetidoInput,
    ): Promise<GarantirSemCodigoRepetidoResult> => {
        const { lote, bncCod, flpCod } = input;
        const inalterado: GarantirSemCodigoRepetidoResult = { lote, retirados: [], avisos: [] };
        const boletos = lote.itens.filter((i) => i.modalidade === MODALIDADE.BOLETO);
        if (boletos.length === 0 && input.forcarLeitura !== true) return inalterado;

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
        this.exigirLeituraCompleta(leitura, estado, boletos, flpCod);

        // ── 2. Decisão ──
        const locais = new Map(lote.itens.map((i) => [chaveDe(i), i]));
        const intrusos = estado.filter((e) => !locais.has(e.chave)).map((e) => e.chave);
        const { residuos } = await this.classificarIntrusos(lote.id, intrusos);
        const alvos = [
            ...this.alvosDaDecisao(this.decidir(estado, locais)),
            ...[...residuos].map(([chave, r]) => this.alvoDeResiduo(chave, r)),
        ];
        if (alvos.length === 0) return inalterado;

        if (!input.rascunhoAberto) {
            throw new BoletoCodigoBarrasRetiradaIncompletaError({
                modo: 'finalizado',
                flpCod,
                pendentes: alvos.map((a) => ({ docCod: a.docCod, titCod: a.titCod })),
            });
        }

        // ── 3. Retirada: local primeiro, ERP depois, ausência observada ──
        const feito = await this.retirarAlvos(ctx, lote, alvos, estado, locais);
        const { retirados, pendentes } = feito;
        estado = feito.estado;

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

        const atual = await this.posLimpeza(lote, estado, retirados, flpCod);
        return { lote: atual, retirados, avisos: this.avisos(retirados) };
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
        const locais = new Map(atual.itens.map((i) => [chaveDe(i), i]));
        const decisao = this.decidir(estado, locais);
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
        flpCod: number,
    ): void => {
        if (leitura.completa !== true) throw this.erroLeitura('LISTA_TRUNCADA', flpCod, boletos);
        const semIdentidade = estado.filter((e) => e.itsCodSeq === undefined);
        if (semIdentidade.length > 0) {
            throw this.erroLeitura('ITEM_SEM_IDENTIDADE', flpCod, semIdentidade);
        }
        const lidas = new Set(estado.map((e) => e.chave));
        const semLeitura = boletos.filter((b) => !lidas.has(chaveDe(b)));
        if (semLeitura.length > 0) throw this.erroLeitura('CODIGO_AUSENTE', flpCod, semLeitura);
    };

    // ── Decisão ─────────────────────────────────────────────────────────────

    /** I16d.1/I16d.2 sobre os itens do rascunho que ainda são do lote local. */
    private decidir = (
        estado: ItemNativo[],
        locais: Map<string, { vencimento?: number }>,
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
        const decisao = this.analise.decidirRetirada(legiveis);
        const invalidos = estado
            .filter((e) => e.invalido && locais.has(e.chave))
            .map((e) => ({ chave: e.chave, motivo: MOTIVO_RETIRADA.CODIGO_BARRAS_ILEGIVEL }));
        return { retirar: decisao.retirar, ilegiveis: [...decisao.ilegiveis, ...invalidos] };
    };

    private alvosDaDecisao = (decisao: DecisaoRetirada): AlvoRetirada[] => [
        ...decisao.retirar.map((r) => ({
            chave: r.chave,
            ...paraChaveTitulo(r.chave),
            motivo: r.motivo as MotivoRetiradaCodigoBarras,
            mascarado: r.mascarado,
            mantida: r.mantida,
            residuo: false,
        })),
        ...decisao.ilegiveis.map((i) => ({
            chave: i.chave,
            ...paraChaveTitulo(i.chave),
            motivo: i.motivo as MotivoRetiradaCodigoBarras,
            residuo: false,
        })),
    ];

    private alvoDeResiduo = (chave: string, r: ResiduoReconhecido): AlvoRetirada => ({
        chave,
        ...paraChaveTitulo(chave),
        motivo: r.motivo,
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
    private avisos = (retirados: RetiradoPorCodigoBarras[]): string[] => {
        const avisos: string[] = [];
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
        return avisos;
    };
}
