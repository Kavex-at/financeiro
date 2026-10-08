import { inject, injectable } from 'tsyringe';
import ConexosSispagClient from '../../client/ConexosSispagClient.js';
import PostgreeDatabaseClient, {
    type TransactionClient,
} from '../../client/database/PostgreeDatabaseClient.js';
import { LOG_TYPE } from '../../interface/log/LogInterface.js';
import {
    type AuthorizedPayeeModality,
    PAYEE_CHECK_RESULT,
    type PayeeItemWarning,
} from '../../interface/sispag/AuthorizedPayeeInterface.js';
import {
    type ChaveTitulo,
    type DuplicateCandidate,
    type DuplicateMatch,
    ITEM_ALERT_STATE,
    type ItemLote,
    LOTE_STATUS,
    MODALIDADE,
    PAYMENT_CHECK_STATE,
    SISPAG_SYSTEM_ACTOR,
    type SystemRemovalReason,
} from '../../interface/sispag/SispagInterface.js';
import EnvironmentProvider from '../../libs/environment/EnvironmentProvider.js';
import type { SispagVerificacaoConfig } from '../../libs/environment/model/EnvironmentVars.js';
import AlertaItemLoteRepository from '../../repository/sispag/AlertaItemLoteRepository.js';
import LotePagamentoRepository from '../../repository/sispag/LotePagamentoRepository.js';
import LogService from '../LogService.js';
import AuthorizedPayeeService, {
    chaveDoPar,
    type PayeeCheckOutcome,
} from './AuthorizedPayeeService.js';
import DestinoPagamentoResolver from './DestinoPagamentoResolver.js';
import DuplicateDetector from './DuplicateDetector.js';

/** Um item citado no resultado — o título, o credor e a forma de pagamento (nunca o destino). */
export interface ItemVerificado {
    filCod: number;
    docCod: string;
    titCod: string;
    credor?: string;
    modalidade?: string;
}

/** Item retirado do lote pelo sistema no finalizar, com o motivo (I13j). */
export interface ItemRetirado extends ItemVerificado {
    motivo: SystemRemovalReason;
}

/** Item que ficou no lote com selo de aviso (modo AVISO, I14e-1). */
export interface ItemComAviso extends ItemVerificado {
    aviso: PayeeItemWarning;
}

export interface ResultadoVerificacao {
    /** Itens TED/PIX verificados (estado OK), com ou sem aviso. */
    verificados: ItemVerificado[];
    /** Itens que ficaram PENDENTE (leitura do Conexos falhou — I13b, I14f). */
    pendentes: ItemVerificado[];
    /** Itens retirados do lote pelo sistema (só no modo RETIRAR). */
    retirados: ItemRetirado[];
    /** Itens que ficaram no lote com resultado ≠ OK (só no modo AVISO). */
    avisos: ItemComAviso[];
}

/**
 * Onde a verificação roda (ADR-0065 I14e): ao definir TED/PIX num item só AVISA (nunca retira); no
 * `finalizarLote` é autoritativa e RETIRA o item cujo favorecido não está autorizado.
 */
export const VERIFICATION_MODE = { AVISO: 'AVISO', RETIRAR: 'RETIRAR' } as const;

export type VerificationMode = (typeof VERIFICATION_MODE)[keyof typeof VERIFICATION_MODE];

export interface OpcoesVerificacao {
    /** Só estes itens (edição de modalidade); ausente = todos os TED/PIX do lote (finalizar). */
    itens?: ChaveTitulo[];
    modo: VerificationMode;
}

/** Leitura do fin064 da filial nesta rodada: os candidatos, ou a falha (→ PENDENTE). */
type LeituraFilial = { ok: true; titulos: DuplicateCandidate[] } | { ok: false };

const MODALIDADES_VERIFICADAS: ReadonlySet<string> = new Set([MODALIDADE.TED, MODALIDADE.PIX]);

/** Chave de estabilidade da alerta (I13h): tipo + contraparte (filial, documento). */
const chaveAlerta = (tipo: string, filCod?: number, docCod?: string): string =>
    `${tipo}|${filCod ?? ''}|${docCod ?? ''}`;

/** Um item do lote já com o favorecido do fin064 resolvido. */
interface ItemComFavorecido {
    item: ItemLote;
    proprio: DuplicateCandidate;
    pesCod: string;
    titulos: DuplicateCandidate[];
}

/**
 * VerificacaoTedPixService — `verificarItensTedPix` (ADR-0063 I13, reescrito pela ADR-0065). Só
 * itens TED/PIX; BOLETO, "a definir" e CRÉDITO EM CONTA legado nunca. NADA é escrito no Conexos:
 * lê o `fin064` (duplicidade e favorecido do título) e, pela `AuthorizedPayeeService`, o `cmn025`
 * (a mesma função única `verificarDestinoAutorizado`, I14d). Grava só no Postgres.
 *
 * Por item:
 *   1. favorecido autorizado (I14) — resultado ≠ OK: no modo AVISO o item fica com o selo; no
 *      modo RETIRAR o item SAI do lote (ator `sistema`, motivo na trilha) e não segue.
 *   2. duplicidade (I13c–e, I13h) — `DuplicateDetector` sobre o fin064 da filial.
 *
 * FALHA FECHADA (I13b, I14f): leitura do Conexos que falha deixa o item `PENDENTE` e não cria, não
 * fecha e não retira nada.
 */
@injectable()
export default class VerificacaoTedPixService {
    public constructor(
        @inject(LotePagamentoRepository) private readonly loteRepo: LotePagamentoRepository,
        @inject(AlertaItemLoteRepository) private readonly alertaRepo: AlertaItemLoteRepository,
        @inject(ConexosSispagClient) private readonly sispag: ConexosSispagClient,
        @inject(DestinoPagamentoResolver) private readonly resolver: DestinoPagamentoResolver,
        @inject(AuthorizedPayeeService) private readonly payees: AuthorizedPayeeService,
        @inject(DuplicateDetector) private readonly detector: DuplicateDetector,
        @inject(EnvironmentProvider) private readonly environmentProvider: EnvironmentProvider,
        @inject(PostgreeDatabaseClient) private readonly db: PostgreeDatabaseClient,
        @inject(LogService) private readonly logService: LogService,
    ) {}

    /** `true` quando o item é alvo da verificação (TED ou PIX). */
    public ehVerificavel = (item: Pick<ItemLote, 'modalidade'>): boolean =>
        item.modalidade !== undefined && MODALIDADES_VERIFICADAS.has(item.modalidade);

    public verificarItens = async (
        loteId: string,
        opcoes: OpcoesVerificacao,
    ): Promise<ResultadoVerificacao> => {
        const resultado: ResultadoVerificacao = {
            verificados: [],
            pendentes: [],
            retirados: [],
            avisos: [],
        };
        const lote = await this.loteRepo.getLoteComItens(loteId);
        if (!lote || lote.status !== LOTE_STATUS.RASCUNHO) return resultado;
        const filtro = opcoes.itens?.map((c) => `${c.filCod}:${c.docCod}:${c.titCod}`);
        const alvo = lote.itens.filter(
            (i) =>
                this.ehVerificavel(i) &&
                (!filtro || filtro.includes(`${i.filCod}:${i.docCod}:${i.titCod}`)),
        );
        if (alvo.length === 0) return resultado;

        const config = (await this.environmentProvider.getEnvironmentVars()).sispagVerificacao;
        const leituras = new Map<number, LeituraFilial>();
        const comFavorecido: ItemComFavorecido[] = [];
        for (const item of alvo) {
            const leitura = await this.lerFilial(leituras, item.filCod, config, loteId);
            const achado = this.favorecidoDoTitulo(item, leitura);
            if ('motivo' in achado) {
                resultado.pendentes.push(await this.pendente(loteId, item, achado.motivo));
            } else {
                comFavorecido.push(achado);
            }
        }

        const verificacao = await this.payees.verificarDestinoAutorizado(
            comFavorecido.map((c) => ({
                pesCod: c.pesCod,
                modalidade: c.item.modalidade as AuthorizedPayeeModality,
                filCod: c.item.filCod,
            })),
            { cache: this.resolver.novoCache() },
        );
        for (const c of comFavorecido) {
            const outcome = verificacao.get(
                chaveDoPar(c.pesCod, c.item.modalidade as AuthorizedPayeeModality),
            ) ?? { resultado: PAYEE_CHECK_RESULT.FALHA_LEITURA };
            await this.aplicar(loteId, c, outcome, opcoes.modo, config, resultado);
        }

        await this.registrarResultado(loteId, lote.filCod, alvo.length, resultado);
        return resultado;
    };

    /**
     * I13a — o item deixou de ser TED/PIX (BOLETO ou "a definir"): as alertas vivas dele são
     * DESCARTADAS (evento na trilha) e o estado da verificação some.
     */
    public descartarVerificacao = async (
        loteId: string,
        chave: ChaveTitulo,
        ator: string,
    ): Promise<number> =>
        this.db.withTransaction(async (tx) => {
            const n = await this.alertaRepo.descartarDoItem(loteId, chave, ator, tx);
            await this.loteRepo.limparVerificacaoItem({ loteId, ...chave }, tx);
            return n;
        });

    // ------------------------------------------------------------------ internals

    private ref = (item: ItemLote): ItemVerificado => ({
        filCod: item.filCod,
        docCod: item.docCod,
        titCod: item.titCod,
        ...(item.credor ? { credor: item.credor } : {}),
        ...(item.modalidade ? { modalidade: item.modalidade } : {}),
    });

    /** fin064 da filial, uma vez por rodada. Falha vira `{ ok: false }` (→ PENDENTE), nunca "vazio". */
    private lerFilial = async (
        leituras: Map<number, LeituraFilial>,
        filCod: number,
        config: SispagVerificacaoConfig,
        loteId: string,
    ): Promise<LeituraFilial> => {
        const existente = leituras.get(filCod);
        if (existente) return existente;
        let leitura: LeituraFilial;
        try {
            leitura = {
                ok: true,
                titulos: await this.sispag.listTitulosParaDuplicidade(
                    filCod,
                    config.duplicidadeDesde,
                ),
            };
        } catch (error) {
            await this.logService.warn({
                type: LOG_TYPE.BUSINESS_WARN,
                message: 'verificação TED/PIX: leitura do fin064 falhou — itens ficam pendentes',
                data: { loteId, filCod, erro: this.motivo(error) },
            });
            leitura = { ok: false };
        }
        leituras.set(filCod, leitura);
        return leitura;
    };

    /** O título no fin064 e o favorecido dele; sem eles o item não é verificável agora. */
    private favorecidoDoTitulo = (
        item: ItemLote,
        leitura: LeituraFilial,
    ): ItemComFavorecido | { motivo: string } => {
        if (!leitura.ok) return { motivo: 'fin064 indisponível' };
        const proprio = leitura.titulos.find(
            (t) => t.docCod === item.docCod && t.titCod === item.titCod,
        );
        if (!proprio) return { motivo: 'título não encontrado no fin064' };
        if (!proprio.favorecido) return { motivo: 'favorecido ausente no fin064' };
        return { item, proprio, pesCod: proprio.favorecido, titulos: leitura.titulos };
    };

    /** Aplica o resultado da guarda I14 a um item e, se ele fica no lote, a duplicidade. */
    private aplicar = async (
        loteId: string,
        c: ItemComFavorecido,
        outcome: PayeeCheckOutcome,
        modo: VerificationMode,
        config: SispagVerificacaoConfig,
        resultado: ResultadoVerificacao,
    ): Promise<void> => {
        const { item } = c;
        if (outcome.resultado === PAYEE_CHECK_RESULT.FALHA_LEITURA) {
            resultado.pendentes.push(await this.pendente(loteId, item, 'cadastro indisponível'));
            return;
        }
        const aviso: PayeeItemWarning = outcome.resultado;
        if (aviso !== PAYEE_CHECK_RESULT.OK && modo === VERIFICATION_MODE.RETIRAR) {
            if (await this.retirar(loteId, item, aviso)) {
                resultado.retirados.push({ ...this.ref(item), motivo: aviso });
            }
            return;
        }
        const chave: ChaveTitulo = {
            filCod: item.filCod,
            docCod: item.docCod,
            titCod: item.titCod,
        };
        const achados = this.detector.detectar(c.proprio, c.titulos, {
            janelaFracaDias: config.duplicidadeJanelaDias,
        });
        await this.db.withTransaction(async (tx) => {
            await this.reconciliarAlertas(loteId, chave, achados, tx);
            await this.loteRepo.marcarVerificacaoItem(
                {
                    loteId,
                    ...chave,
                    estado: PAYMENT_CHECK_STATE.OK,
                    autorizacaoAviso: aviso,
                    ...(outcome.destinoMascarado
                        ? { destinoMascarado: outcome.destinoMascarado }
                        : {}),
                },
                tx,
            );
        });
        resultado.verificados.push(this.ref(item));
        if (aviso !== PAYEE_CHECK_RESULT.OK) resultado.avisos.push({ ...this.ref(item), aviso });
    };

    /** I13b — item PENDENTE: nada mais muda (sem alerta nova, sem fechar, sem retirar). */
    private pendente = async (
        loteId: string,
        item: ItemLote,
        motivo: string,
    ): Promise<ItemVerificado> => {
        const chave = { filCod: item.filCod, docCod: item.docCod, titCod: item.titCod };
        await this.loteRepo.marcarVerificacaoItem({
            loteId,
            ...chave,
            estado: PAYMENT_CHECK_STATE.PENDENTE,
        });
        await this.logService.warn({
            type: LOG_TYPE.BUSINESS_WARN,
            message: 'verificação TED/PIX pendente: item não verificável agora',
            data: { loteId, ...chave, motivo },
        });
        return this.ref(item);
    };

    /**
     * I13j (ADR-0065) — no finalizar, item cujo favorecido não está autorizado SAI do lote (ator
     * `sistema`, motivo na trilha) e as alertas dele são descartadas, numa transação. `false` = o
     * item já não estava no lote RASCUNHO.
     */
    private retirar = async (
        loteId: string,
        item: ItemLote,
        motivo: SystemRemovalReason,
    ): Promise<boolean> => {
        const chave = { filCod: item.filCod, docCod: item.docCod, titCod: item.titCod };
        const removido = await this.db.withTransaction(async (tx) => {
            await this.alertaRepo.descartarDoItem(loteId, chave, SISPAG_SYSTEM_ACTOR, tx);
            return this.loteRepo.removerItemPeloSistema({ loteId, ...chave, motivo }, tx);
        });
        await this.logService.warn({
            type: LOG_TYPE.BUSINESS_WARN,
            message: 'verificação TED/PIX retirou item do lote: favorecido sem autorização válida',
            data: { loteId, ...chave, modalidade: item.modalidade, motivo },
        });
        return removido;
    };

    private registrarResultado = async (
        loteId: string,
        filCod: number,
        itens: number,
        resultado: ResultadoVerificacao,
    ): Promise<void> => {
        const atencao =
            resultado.pendentes.length > 0 ||
            resultado.retirados.length > 0 ||
            resultado.avisos.length > 0;
        await (atencao ? this.logService.warn : this.logService.info)({
            type: atencao ? LOG_TYPE.BUSINESS_WARN : LOG_TYPE.BUSINESS_INFO,
            message: 'verificação TED/PIX concluída',
            data: {
                loteId,
                filCod,
                itens,
                verificados: resultado.verificados.length,
                pendentes: resultado.pendentes.length,
                retirados: resultado.retirados.length,
                avisos: resultado.avisos.length,
            },
        });
    };

    /**
     * I13h — compara os achados com as alertas vivas do item NESTE lote:
     *   mesma contraparte + mesmo tipo → mantém (e a resolução dela);
     *   contraparte nova → alerta nova ABERTA;
     *   viva que não casou mais → OBSOLETA.
     */
    private reconciliarAlertas = async (
        loteId: string,
        chave: ChaveTitulo,
        achados: DuplicateMatch[],
        tx: TransactionClient,
    ): Promise<void> => {
        const vivas = await this.alertaRepo.listVivasDoItem(loteId, chave, tx);
        const porChave = new Map(
            vivas.map((a) => [chaveAlerta(a.tipo, a.contraparteFilCod, a.contraparteDocCod), a]),
        );
        const vistas = new Set<string>();

        for (const achado of achados) {
            const k = chaveAlerta(achado.tipo, achado.contraparteFilCod, achado.contraparteDocCod);
            vistas.add(k);
            const existente = porChave.get(k);
            if (existente) {
                await this.alertaRepo.confirmar(
                    existente.id,
                    { contraparteTitulos: achado.contraparteTitulos, evidencia: achado.evidencia },
                    tx,
                );
            } else {
                await this.alertaRepo.criar(
                    {
                        loteId,
                        chave,
                        tipo: achado.tipo,
                        contraparteFilCod: achado.contraparteFilCod,
                        contraparteDocCod: achado.contraparteDocCod,
                        contraparteTitulos: achado.contraparteTitulos,
                        evidencia: achado.evidencia,
                    },
                    SISPAG_SYSTEM_ACTOR,
                    tx,
                );
            }
        }

        for (const [k, viva] of porChave) {
            if (vistas.has(k)) continue;
            await this.alertaRepo.fechar(viva, ITEM_ALERT_STATE.OBSOLETA, SISPAG_SYSTEM_ACTOR, tx);
        }
    };

    /**
     * Motivo de uma falha de leitura para o log: só o status HTTP ou o tipo do erro. A MENSAGEM não
     * entra — uma falha do cmn025 pode citar a conta/chave do favorecido (I10h).
     */
    private motivo = (error: unknown): string => {
        const status = (error as { response?: { status?: number } } | undefined)?.response?.status;
        if (status !== undefined) return `HTTP ${status}`;
        return error instanceof Error ? error.name : 'erro desconhecido';
    };
}
