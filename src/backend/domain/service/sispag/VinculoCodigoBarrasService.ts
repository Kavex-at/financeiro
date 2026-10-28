import { inject, injectable } from 'tsyringe';
import ConexosSispagClient from '../../client/ConexosSispagClient.js';
import ConexosSispagWriteClient from '../../client/ConexosSispagWriteClient.js';
import PostgreeDatabaseClient from '../../client/database/PostgreeDatabaseClient.js';
import ConexosError from '../../errors/ConexosError.js';
import ErpPerguntaError from '../../errors/ErpPerguntaError.js';
import ItemEditadoPorTerceiroError, {
    CAMPO_EDITADO_POR_TERCEIRO,
} from '../../errors/ItemEditadoPorTerceiroError.js';
import VinculoCodigoBarrasDivergenteError, {
    CAMPO_DIVERGENTE_VINCULO,
    type CampoDivergenteVinculo,
} from '../../errors/VinculoCodigoBarrasDivergenteError.js';
import VinculoCodigoBarrasIncompletoError, {
    type TituloDoVinculo,
} from '../../errors/VinculoCodigoBarrasIncompletoError.js';
import GroupBorderoIncompleteError from '../../errors/GroupBorderoIncompleteError.js';
import { LOG_TYPE } from '../../interface/log/LogInterface.js';
import {
    DECISAO_SUGESTAO_BOLETO,
    type DecisaoSugestao,
    EVENTO_SUGESTAO_BOLETO,
} from '../../interface/sispag/ConfirmacaoEmissorBoleto.js';
import type { ItemDeBordero, ItemDoRascunho } from '../../interface/sispag/Fin015Write.js';
import type { GrupoBoleto } from '../../interface/sispag/GrupoBoletoInterface.js';
import { ESTADO_CONFIRMACAO_EMISSOR } from '../../interface/sispag/ConfirmacaoEmissorBoleto.js';
import {
    type ChaveTitulo,
    type ItemLote,
    type LotePagamento,
    MODALIDADE,
    VINCULO_ORIGEM,
} from '../../interface/sispag/SispagInterface.js';
import AnaliseCodigoBarrasRepetido from '../../libs/boleto/AnaliseCodigoBarrasRepetido.js';
import CodigoBarrasBoleto from '../../libs/boleto/CodigoBarrasBoleto.js';
import ElegibilidadeVinculoCodigoBarras, {
    MOTIVO_INELEGIVEL_VINCULO,
    type MotivoInelegivelVinculo,
    type ResultadoElegibilidadeVinculo,
} from '../../libs/boleto/ElegibilidadeVinculoCodigoBarras.js';
import ValorAbertoLiquido, {
    type ValoresAbertoTitulo,
} from '../../libs/boleto/ValorAbertoLiquido.js';
import ModoVinculoCodigoBarras, {
    MODO_VINCULO,
    type ModoVinculo,
} from '../../libs/boleto/ModoVinculoCodigoBarras.js';
import BankingCalendar from '../../libs/calendar/BankingCalendar.js';
import EnvironmentProvider from '../../libs/environment/EnvironmentProvider.js';
import AjusteCentavosExecucaoRepository from '../../repository/sispag/AjusteCentavosExecucaoRepository.js';
import BoletoDdaRepository from '../../repository/sispag/BoletoDdaRepository.js';
import LotePagamentoRepository from '../../repository/sispag/LotePagamentoRepository.js';
import SugestaoBoletoRepository from '../../repository/sispag/SugestaoBoletoRepository.js';
import TituloAPagarRepository from '../../repository/sispag/TituloAPagarRepository.js';
import LogService from '../LogService.js';
import RegraSugestaoBoleto from './RegraSugestaoBoleto.js';

/** Fonte do valor em aberto usada na avaliação. */
export const FONTE_VALOR_ABERTO = {
    /** `shadow`/endpoint: carteira persistida (zero chamada ao ERP). */
    CARTEIRA_LOCAL: 'CARTEIRA_LOCAL',
    /** `on`: régua líquida do `fin064` lida ao vivo (I17b emendada, ADR-0074). */
    ERP_AO_VIVO: 'ERP_AO_VIVO',
} as const;
export type FonteValorAberto = (typeof FONTE_VALOR_ABERTO)[keyof typeof FONTE_VALOR_ABERTO];

/** Previsão por item: só campos mascarados (nunca o código). */
export interface PrevisaoVinculo extends ResultadoElegibilidadeVinculo {
    titulo: ChaveTitulo;
    valorAbertoFonte: FonteValorAberto;
}

export interface VinculoAplicado {
    titulo: ChaveTitulo;
    codigoMascarado: string;
    decisaoId: string;
    /** `true` = o item já trazia o código (idempotência, I17f): nenhuma chamada nova. */
    jaVinculado: boolean;
}

/** Falha DETERMINÍSTICA pós-import: o item sai do lote pela maquinaria da I16d (I17g(3)). */
export interface FalhaDeterministicaVinculo {
    titulo: ChaveTitulo;
    campo: CampoDivergenteVinculo;
    motivo?: MotivoInelegivelVinculo | string;
    codigoMascarado?: string;
    /** Sequencial nativo, quando conhecido (o `DELETE` usa o da leitura mais recente). */
    itsCodSeq?: number;
    /** Mensagem pt-BR ao operador. */
    aviso: string;
}

/**
 * Modalidade nativa do item (HML V4, 2026-10-14): `6` = boleto do MESMO banco do lote; `7` = boleto
 * de OUTRO banco. Com a barra de outro banco e o item em `6`, o ERP recusa a validação
 * (`FIN_015.TITULO_NAO_PERTENCE_AO_BANCO_EM_USO`) e o `finalizar` ("a modalidade do título é
 * própria e o banco favorecido não é o mesmo da remessa").
 */
export const MODALIDADE_ITEM = { MESMO_BANCO: 6, OUTRO_BANCO: 7 } as const;

/** Tamanho de página medido em HML; lote com mais itens aborta o vínculo (Q9). */
export const LIMITE_ITENS_DO_LOTE = 500;

/** Desfecho do vínculo da barra no item de borderô de UM grupo (ADR-0077, I21o). */
export type ResultadoVinculoBordero =
    | {
          tipo: 'vinculado';
          codigoMascarado: string;
          /** `true` = o item já trazia o código esperado (I17f): nenhuma chamada nova. */
          jaVinculado: boolean;
      }
    | {
          /** Falha DETERMINÍSTICA: o chamador retira o grupo inteiro (I21p(3), Task 17). */
          tipo: 'retirar';
          grupoId: string;
          campo: CampoDivergenteVinculo;
          motivo: string;
          codigoMascarado?: string;
          itsCodSeq?: number;
          /** Mensagem pt-BR ao operador, sem o código completo. */
          aviso: string;
      };

export interface ResultadoExecucaoVinculo {
    vinculados: VinculoAplicado[];
    retirar: FalhaDeterministicaVinculo[];
    /** Chaves (`filCod:docCod:titCod`) com decisão humana vigente — desempate da I16d.1. */
    preferidos: ReadonlySet<string>;
}

type Row = Record<string, unknown>;

interface ContextoLocal {
    decisoes: Map<string, DecisaoSugestao>;
    paresVigentes: ReadonlySet<string>;
}

interface Candidato {
    item: ItemLote;
    chave: string;
}

interface Avaliado {
    elegibilidade: ResultadoElegibilidadeVinculo;
    /** Barras (44) do pool — só em memória. */
    barras?: string;
    /** Valor da barra, em centavos, quando decodificável. */
    valorBarraCentavos?: number;
    /** Vencimento civil da barra. */
    vencimentoBarra?: string;
    decisao?: DecisaoSugestao;
}

const chaveDe = (t: { filCod: number; docCod: string; titCod: string }): string =>
    `${t.filCod}:${t.docCod}:${t.titCod}`;

const paraTitulo = (t: { filCod: number; docCod: string; titCod: string }): ChaveTitulo => ({
    filCod: t.filCod,
    docCod: t.docCod,
    titCod: t.titCod,
});

const soDigitos = (v: unknown): string => String(v ?? '').replace(/\D/g, '');

const centavos = (v: unknown): number => Math.round(Number(v) * 100);

/**
 * VinculoCodigoBarrasService — vínculo do código de barras CONFIRMADO ao item do rascunho nativo
 * (ADR-0071, I17; passo 2 da ADR-0068, escopo "valor igual").
 *
 * Quando o ERP não associou o boleto DDA ao título, o código que uma pessoa confirmou (I15) é
 * gravado no item DEPOIS do `importar`, pela sequência por item
 * `ler → validacao → confirma → PUT → releitura` (I17e). Quatro pilares:
 *
 *  1. **As verificações são nossas** (I17d). O ERP só decodifica: não valida DV nem compara com o
 *     título (HML #3). Elegibilidade pura (`ElegibilidadeVinculoCodigoBarras`) + checagens
 *     pós-confirma (banco, valor, data, juros/desconto).
 *  2. **Sucesso = observação** (I17e). Vale a releitura, não o status do `PUT`: `200` sem o código
 *     na releitura não é sucesso; `PUT` que falhou com o código lá é.
 *  3. **Falha: o que aborta e o que retira** (I17g). Transitória/ambígua ⇒ `Incompleto` (nunca
 *     retira, rascunho preservado, retomada idempotente); determinística ⇒ devolve `retirar`.
 *  4. **Privacidade** (I17j). A linha completa vive só em memória (pool → `validacao` → `confirma`
 *     → `PUT`); log, evento e erro recebem a máscara 5+4.
 */
@injectable()
export default class VinculoCodigoBarrasService {
    public constructor(
        @inject(ConexosSispagWriteClient) private readonly write: ConexosSispagWriteClient,
        @inject(ConexosSispagClient) private readonly sispag: ConexosSispagClient,
        @inject(LotePagamentoRepository) private readonly loteRepo: LotePagamentoRepository,
        @inject(SugestaoBoletoRepository) private readonly sugestoes: SugestaoBoletoRepository,
        @inject(BoletoDdaRepository) private readonly boletos: BoletoDdaRepository,
        @inject(TituloAPagarRepository) private readonly titulos: TituloAPagarRepository,
        @inject(ElegibilidadeVinculoCodigoBarras)
        private readonly elegibilidade: ElegibilidadeVinculoCodigoBarras,
        @inject(RegraSugestaoBoleto) private readonly regra: RegraSugestaoBoleto,
        @inject(CodigoBarrasBoleto) private readonly codigoBarras: CodigoBarrasBoleto,
        @inject(BankingCalendar) private readonly calendar: BankingCalendar,
        @inject(EnvironmentProvider) private readonly environmentProvider: EnvironmentProvider,
        @inject(LogService) private readonly logService: LogService,
        @inject(PostgreeDatabaseClient) private readonly db: PostgreeDatabaseClient,
        @inject(AjusteCentavosExecucaoRepository)
        private readonly ajustes: AjusteCentavosExecucaoRepository,
    ) {}

    // ── Modo ────────────────────────────────────────────────────────────────

    /** Modo efetivo da filial: flag por filial + kill-switch global (I17k). Fail-closed. */
    public resolverModo = async (filCod: number): Promise<ModoVinculo> => {
        const env = await this.environmentProvider.getEnvironmentVars();
        return ModoVinculoCodigoBarras.resolverModo(
            filCod,
            ModoVinculoCodigoBarras.parse(env.sispagBindCodbarFiliais),
            env.sispagLiveWriteEnabled === true,
        );
    };

    // ── Previsão local (shadow, endpoint, dry-run) ──────────────────────────

    /**
     * Elegibilidade de cada BOLETO do lote usando SÓ o que é local (banco/pool): zero chamada ao
     * ERP. O valor em aberto é o da carteira persistida (`CARTEIRA_LOCAL`), não o `fin064` ao vivo.
     * Título renegociado pelo ajuste de centavos usa o líquido do ledger (I18j(5)): a carteira
     * guarda o `titMnyValor` base, um centavo abaixo do boleto, e a previsão acusaria
     * `VALOR_DIFERENTE` num título que, ao vivo, bate com o boleto.
     * `registrar` grava `VINCULO_SIMULADO` (só no caminho vivo do `shadow`; o endpoint e o dry-run
     * não gravam nada durável).
     */
    public prever = async (
        lote: LotePagamento,
        opcoes: { registrar?: boolean } = {},
    ): Promise<PrevisaoVinculo[]> => {
        const ctx = await this.carregarContexto();
        const boletos = this.boletos_(lote);
        const liquidos = await this.ajustes.liquidosDeTitulosRenegociados(boletos.map(paraTitulo));
        const previsoes: PrevisaoVinculo[] = [];
        for (const item of boletos) {
            const local = await this.titulos.buscarPorChave(item);
            if (local?.temBoleto === true) continue; // caminho DDA do ERP: nada a prever.
            const liquidoLedger = liquidos.get(chaveDe(item));
            const valorLocal = liquidoLedger !== undefined ? liquidoLedger / 100 : local?.valor;
            const avaliado = await this.avaliar({
                lote,
                item,
                ctx,
                temBoletoDda: false,
                // Carteira persistida: indicativa por construção (sem juros/desconto/pago).
                aberto: ValorAbertoLiquido.semAcrescimos(
                    local && local.ativo !== false ? valorLocal : undefined,
                ),
                vencimentoTitulo: this.vencimentoCivil(local?.vencimento ?? item.vencimento),
                titulo: local,
            });
            const previsao: PrevisaoVinculo = {
                titulo: paraTitulo(item),
                ...avaliado.elegibilidade,
                valorAbertoFonte: FONTE_VALOR_ABERTO.CARTEIRA_LOCAL,
            };
            previsoes.push(previsao);
            if (opcoes.registrar === true) await this.registrarSimulado(lote, item, previsao);
        }
        return previsoes;
    };

    /**
     * Avaliação PRÉ-import por chave do título. `off` ⇒ vazio. `shadow` ⇒ previsão local
     * registrada (zero chamada nova ao ERP; o chamador não a usa para decidir). `on` ⇒ lê o
     * `totalAberto` AO VIVO (só leitura) e devolve a elegibilidade que libera o import sem DDA.
     */
    public avaliarParaImport = async (
        lote: LotePagamento,
        modo: ModoVinculo,
    ): Promise<ReadonlyMap<string, ResultadoElegibilidadeVinculo>> => {
        const mapa = new Map<string, ResultadoElegibilidadeVinculo>();
        if (modo === MODO_VINCULO.OFF) return mapa;
        if (modo === MODO_VINCULO.SHADOW) {
            for (const p of await this.prever(lote, { registrar: true })) {
                const { titulo, valorAbertoFonte: _f, ...elegibilidade } = p;
                mapa.set(chaveDe(titulo), elegibilidade);
            }
            return mapa;
        }
        const ctx = await this.carregarContexto();
        for (const item of this.boletos_(lote)) {
            const local = await this.titulos.buscarPorChave(item);
            const aberto = await this.lerAberto(item);
            const avaliado = await this.avaliar({
                lote,
                item,
                ctx,
                temBoletoDda: false,
                aberto,
                vencimentoTitulo: this.vencimentoCivil(local?.vencimento ?? item.vencimento),
                titulo: local,
            });
            mapa.set(chaveDe(item), avaliado.elegibilidade);
        }
        return mapa;
    };

    /** Chaves dos itens com decisão humana VIGENTE (I17a): o desempate da I16d.1 prefere-os. */
    public chavesComDecisaoHumana = async (lote: LotePagamento): Promise<ReadonlySet<string>> => {
        const ctx = await this.carregarContexto();
        const chaves = new Set<string>();
        for (const item of this.boletos_(lote)) {
            const d = ctx.decisoes.get(chaveDe(item));
            if (!d) continue;
            if (d.confirmacaoEmissorId && ctx.paresVigentes.has(d.confirmacaoEmissorId)) {
                chaves.add(chaveDe(item));
            }
        }
        return chaves;
    };

    /**
     * A retomada precisa do vínculo? (LOCAL, sem ERP.) Há BOLETO com decisão humana vigente que
     * ainda não carrega `vinculoCodigoBarras` no lote local. Over-approximation segura: o executor
     * é idempotente e lê o rascunho para saber o que de fato falta (I17f).
     */
    public existemVinculaveis = async (lote: LotePagamento): Promise<boolean> => {
        const vigentes = await this.chavesComDecisaoHumana(lote);
        const ctx = await this.carregarContexto();
        return this.boletos_(lote).some(
            (i) =>
                (vigentes.has(chaveDe(i)) && i.vinculoCodigoBarras === undefined) ||
                this.vinculoOrfao(i, ctx),
        );
    };

    /**
     * Itens com código gravado por NÓS cuja decisão deixou de ser `CONFIRMADA` (F-ft-1). LOCAL,
     * sem ERP. A remessa entrega estes à guarda I16d (`retiradosPeloVinculo`) mesmo quando o
     * vínculo não roda (retomada em `gerar_remessa`, modo `off`): em rascunho ABERTO são
     * retirados; com o lote nativo FINALIZADO a guarda aborta com o erro nomeado.
     */
    public vinculosOrfaos = async (
        lote: LotePagamento,
    ): Promise<Array<{ titulo: ChaveTitulo; codigoMascarado?: string }>> => {
        const alvos = this.boletos_(lote).filter(
            (i) => i.vinculoCodigoBarras?.origem === VINCULO_ORIGEM.DECISAO_HUMANA,
        );
        if (alvos.length === 0) return [];
        const ctx = await this.carregarContexto();
        return alvos
            .filter((i) => this.vinculoOrfao(i, ctx))
            .map((i) => ({
                titulo: paraTitulo(i),
                ...(i.vinculoCodigoBarras?.codigoMascarado
                    ? { codigoMascarado: i.vinculoCodigoBarras.codigoMascarado }
                    : {}),
            }));
    };

    // ── Execução (modo `on`) ────────────────────────────────────────────────

    /**
     * Executa a sequência I17e, EM SÉRIE, sobre os itens do rascunho que ainda não têm código.
     * Falha transitória/ambígua lança `VinculoCodigoBarrasIncompletoError` (o que já foi vinculado
     * fica, a retomada é idempotente); terceiro lança `ItemEditadoPorTerceiroError`; falha
     * determinística volta em `retirar`. Nunca retira por conta própria.
     */
    public executar = async (input: {
        lote: LotePagamento;
        bncCod: number;
        flpCod: number;
        /** Código FEBRABAN do banco da conta pagadora (ex.: 341). Ausente = modalidade da linha. */
        bancoLote?: number;
    }): Promise<ResultadoExecucaoVinculo> => {
        const { lote, bncCod, flpCod, bancoLote } = input;
        const ctx = await this.carregarContexto();
        const preferidos = await this.chavesComDecisaoHumana(lote);
        const candidatos: Candidato[] = this.boletos_(lote).map((item) => ({
            item,
            chave: chaveDe(item),
        }));
        // Nenhum BOLETO do lote tem decisão humana confirmada: não há vínculo a fazer e o client novo
        // nem é tocado (o item sem código cai na guarda I16c, como sempre).
        if (!candidatos.some((c) => ctx.decisoes.has(c.chave) || this.vinculoOrfao(c.item, ctx))) {
            return { vinculados: [], retirar: [], preferidos };
        }
        // Q9: só 500 itens/página foi exercitado em HML. Lote maior: o vínculo ABORTA (retomável,
        // nunca retira) em vez de apostar numa leitura paginada não medida.
        if (lote.itens.length > LIMITE_ITENS_DO_LOTE) {
            throw new VinculoCodigoBarrasIncompletoError({
                flpCod,
                vinculados: [],
                pendentes: candidatos.map((c) => ({
                    docCod: c.item.docCod,
                    titCod: c.item.titCod,
                })),
                causa: 'LOTE_ACIMA_DE_500_ITENS',
            });
        }
        const vinculados: VinculoAplicado[] = [];
        const retirar: FalhaDeterministicaVinculo[] = [];
        const resto = [...candidatos];
        const naFila = (): TituloDoVinculo[] =>
            resto.map((c) => ({ docCod: c.item.docCod, titCod: c.item.titCod }));
        const feitos = (): TituloDoVinculo[] =>
            vinculados.map((v) => ({ docCod: v.titulo.docCod, titCod: v.titulo.titCod }));

        while (resto.length > 0) {
            const alvo = resto[0] as Candidato;
            const r = await this.vincularItem(
                { lote, bncCod, flpCod, bancoLote, ctx, alvo },
                (causa, m) => {
                    throw new VinculoCodigoBarrasIncompletoError({
                        flpCod,
                        vinculados: feitos(),
                        pendentes: naFila(),
                        causa,
                        ...(m ? { codigoMascarado: m } : {}),
                    });
                },
            );
            resto.shift();
            if (r.tipo === 'vinculado') vinculados.push(r.vinculo);
            if (r.tipo === 'retirar') retirar.push(r.falha);
        }

        await this.logService.warn({
            type: LOG_TYPE.BUSINESS_WARN,
            message: 'vínculo do código de barras: resumo da execução',
            data: {
                loteId: lote.id,
                flpCod,
                elegiveis: candidatos.length,
                vinculados: vinculados.length,
                retirados: retirar.length,
                abortados: 0,
            },
        });
        return { vinculados, retirar, preferidos };
    };

    // ── Item de borderô do grupo de boleto (ADR-0077, I21o) ─────────────────────────────────

    /**
     * Vincula a barra do boleto ao item de borderô de UM grupo, pela mesma sequência da I17e
     * (`ler → validacao → confirma → releitura → PUT → releitura`), sem decisão por título: vale o
     * grupo `CONFIRMADO`, o par `VIGENTE` e o boleto relido do pool. O valor é o do item do
     * borderô (H6); a I17n não se aplica. Independe do modo I17k: quem decide rodar é o chamador
     * (kill-switch). Transitória/ambígua ⇒ `GroupBorderoIncompleteError` (nunca retira);
     * determinística ⇒ `retirar`.
     */
    public vincularItemDeBordero = async (input: {
        lote: LotePagamento;
        grupo: GrupoBoleto;
        borCod: number;
        bncCod: number;
        flpCod: number;
        bancoLote?: number;
    }): Promise<ResultadoVinculoBordero> => {
        const { lote, grupo, borCod, bncCod, flpCod, bancoLote } = input;
        const ctxNativo = { filCod: grupo.filCod, bncCod, flpCod, borCod };
        const abortar = async (causa: string, mascarado?: string): Promise<never> => {
            await this.logService.warn({
                type: LOG_TYPE.BUSINESS_WARN,
                message: 'barra do boleto agrupado: execução interrompida (retomável)',
                data: { grupoId: grupo.id, borCod, flpCod, causa, codigo: mascarado },
            });
            throw new GroupBorderoIncompleteError({
                grupoId: grupo.id,
                filCod: grupo.filCod,
                borCod,
                flpCod,
                etapa: 'vincular_codbar',
            });
        };
        const lerItem = async (mascarado?: string): Promise<ItemDeBordero> => {
            let item: ItemDeBordero | undefined;
            try {
                item = await this.write.lerItemDeBordero(ctxNativo);
            } catch {
                return abortar('LEITURA_FALHOU', mascarado);
            }
            return item ?? abortar('ITEM_AUSENTE_NO_RASCUNHO', mascarado);
        };
        const retirar = async (
            campo: CampoDivergenteVinculo,
            motivo: string,
            item: ItemDeBordero,
            codigoMascarado?: string,
        ): Promise<ResultadoVinculoBordero> => {
            const aviso =
                `O código do boleto agrupado${codigoMascarado ? ` ${codigoMascarado}` : ''} não ` +
                `pôde ser vinculado ao borderô ${borCod} (${motivo}). O grupo sai da remessa.`;
            await this.logService.warn({
                type: LOG_TYPE.BUSINESS_WARN,
                message: 'barra do boleto agrupado recusada: o grupo será retirado',
                data: { grupoId: grupo.id, borCod, flpCod, campo, motivo, codigo: codigoMascarado },
            });
            return {
                tipo: 'retirar',
                grupoId: grupo.id,
                campo,
                motivo,
                ...(codigoMascarado ? { codigoMascarado } : {}),
                itsCodSeq: item.itsCodSeq,
                aviso,
            };
        };

        // 1. O item de borderô vivo e o boleto/par ATUAIS (nunca cache).
        const item = await lerItem();
        const boleto = await this.boletos.buscarPorChave({
            ddcCod: grupo.ddcCod,
            ditCod: grupo.ditCod,
        });
        const par = grupo.confirmacaoEmissorId
            ? await this.sugestoes.buscarParPorId(grupo.confirmacaoEmissorId)
            : null;

        // 2. Item que já traz código: idempotência (I17f) ou edição de terceiro.
        const codigoNoItem = soDigitos(item.row.itsNumCodbar);
        if (codigoNoItem !== '') {
            return this.reconhecerBorderoComCodigo({ grupo, borCod, flpCod, item, boleto });
        }

        // 3. Elegibilidade (I21o) recalculada AGORA.
        const itsValor = Number(item.itsMnyValor);
        const elegibilidade = this.elegibilidade.avaliarItemDeBordero({
            noRascunho: true,
            grupo: {
                estado: grupo.estado,
                orfao: boleto?.docCod !== undefined && boleto.docCod !== null,
                parVigente: par?.estado === ESTADO_CONFIRMACAO_EMISSOR.VIGENTE,
                valorBoletoCentavos: grupo.valorBoletoCentavos,
                vencimentoBoleto: grupo.vencimentoBoleto,
            },
            ...(boleto?.codbar ? { codigo: boleto.codbar } : {}),
            ...(boleto?.valor !== undefined ? { poolValor: boleto.valor } : {}),
            ...(boleto?.vencimento !== undefined ? { poolVencimento: boleto.vencimento } : {}),
            ...(Number.isFinite(itsValor) ? { itsMnyValorCentavos: centavos(itsValor) } : {}),
            dataDebito: lote.dataDebito ?? grupo.vencimentoBoleto,
        });
        if (!elegibilidade.elegivel || !boleto?.codbar) {
            return retirar(
                CAMPO_DIVERGENTE_VINCULO.ELEGIBILIDADE,
                elegibilidade.motivo ?? MOTIVO_INELEGIVEL_VINCULO.BOLETO_INDISPONIVEL,
                item,
                elegibilidade.codigoMascarado,
            );
        }
        const decodificado = this.codigoBarras.decodificar(
            boleto.codbar.replace(/[\s.]/g, ''),
            grupo.vencimentoBoleto,
        );
        const mascarado = elegibilidade.codigoMascarado as string;
        if (!decodificado) {
            return retirar(
                CAMPO_DIVERGENTE_VINCULO.ELEGIBILIDADE,
                MOTIVO_INELEGIVEL_VINCULO.CODIGO_INVALIDO,
                item,
                mascarado,
            );
        }
        const barras = decodificado.barras;
        const valorCentavos = decodificado.valorCentavos;

        // 4. validacao → confirma. O ERP só decodifica; julgamos nós.
        const linha = this.codigoBarras.paraLinhaDigitavel(barras) as string;
        const vencimentoEpoch = this.calendar.toErpEpoch(grupo.vencimentoBoleto);
        const modalidade =
            bancoLote === undefined
                ? Number(item.itsVldModalidade) || MODALIDADE_ITEM.MESMO_BANCO
                : Number(decodificado.banco) === bancoLote
                  ? MODALIDADE_ITEM.MESMO_BANCO
                  : MODALIDADE_ITEM.OUTRO_BANCO;
        const base = {
            filCod: grupo.filCod,
            bncCod,
            codigo: linha,
            valorLiquido: valorCentavos / 100,
            vencimento: vencimentoEpoch,
            modalidade,
        };
        let validacao: Awaited<ReturnType<ConexosSispagWriteClient['validarCodigoBarras']>>;
        try {
            validacao = await this.write.validarCodigoBarras(base);
        } catch (err) {
            if (this.ehRecusaDeNegocio(err)) {
                return retirar(
                    CAMPO_DIVERGENTE_VINCULO.ELEGIBILIDADE,
                    'ERP_RECUSOU_VALIDACAO',
                    item,
                    mascarado,
                );
            }
            return abortar('VALIDACAO_TRANSITORIA', mascarado);
        }
        if (centavos(validacao.barraVlrPgto) !== valorCentavos) {
            return retirar(CAMPO_DIVERGENTE_VINCULO.VALOR, 'VALOR_DA_VALIDACAO', item, mascarado);
        }
        let confirma: Awaited<ReturnType<ConexosSispagWriteClient['confirmarCodigoBarras']>>;
        try {
            confirma = await this.write.confirmarCodigoBarras({ ...base, validacao });
        } catch (err) {
            if (this.ehRecusaDeNegocio(err)) {
                return retirar(
                    CAMPO_DIVERGENTE_VINCULO.ELEGIBILIDADE,
                    'ERP_RECUSOU_CONFIRMACAO',
                    item,
                    mascarado,
                );
            }
            return abortar('CONFIRMACAO_TRANSITORIA', mascarado);
        }
        const divergencia = this.divergenciaPosConfirma({
            confirma,
            banco: decodificado.banco,
            valorBarraCentavos: valorCentavos,
            vencimentoEpoch,
        });
        if (divergencia) return retirar(divergencia.campo, divergencia.campo, item, mascarado);

        // 5. Releitura IMEDIATAMENTE antes do PUT (sem lock otimista no ERP, V3).
        const fresco = await lerItem(mascarado);
        if (fresco.itsCodSeq !== item.itsCodSeq)
            return abortar('ITEM_MUDOU_ANTES_DO_PUT', mascarado);
        if (soDigitos(fresco.row.itsNumCodbar) !== '') {
            throw this.terceiroNoBordero(borCod, flpCod, CAMPO_EDITADO_POR_TERCEIRO.CODIGO);
        }

        // 6. PUT de tentativa ÚNICA; a falha NÃO decide, a releitura decide.
        const trocaModalidade = Number(fresco.row.itsVldModalidade) !== modalidade;
        const esperado = {
            itsNumBanco: confirma.itsBncNumCodbancoResult,
            bncDesNome: confirma.itsBncDesNomeResult,
            itsMnyVlrPgto: confirma.itsMnyVlrPgtoResult,
            itsDtaPgto: confirma.itsDtaPgtoResult,
            ...(trocaModalidade ? { itsVldModalidade: modalidade } : {}),
        };
        let putRecusado = false;
        try {
            await this.write.editarItemDoRascunho({
                filCod: grupo.filCod,
                bncCod,
                flpCod,
                item: fresco.row,
                alteracoes: { itsNumCodbar: linha, ...esperado },
            });
        } catch (err) {
            putRecusado = this.ehRecusaDeNegocio(err);
            await this.logService.warn({
                type: LOG_TYPE.BUSINESS_WARN,
                message: 'barra do boleto agrupado: PUT do item falhou — a releitura decide',
                data: { grupoId: grupo.id, borCod, flpCod, recusaDeNegocio: putRecusado },
            });
        }

        // 7. Sucesso = o que se OBSERVA (código, banco, valor, data e modalidade).
        const depois = await lerItem(mascarado);
        const observado =
            this.bate(depois.row, barras, esperado) &&
            centavos(depois.row.itsMnyVlrPgto) === valorCentavos;
        if (!observado) {
            if (soDigitos(depois.row.itsNumCodbar) !== '') {
                throw this.terceiroNoBordero(borCod, flpCod, CAMPO_EDITADO_POR_TERCEIRO.CODIGO);
            }
            if (putRecusado) {
                return retirar(
                    CAMPO_DIVERGENTE_VINCULO.ELEGIBILIDADE,
                    'ERP_RECUSOU_PUT',
                    item,
                    mascarado,
                );
            }
            return abortar('PUT_NAO_OBSERVADO', mascarado);
        }
        return { tipo: 'vinculado', codigoMascarado: mascarado, jaVinculado: false };
    };

    /** Item de borderô que já traz código: igual ao esperado ⇒ idempotente; diferente ⇒ terceiro. */
    private reconhecerBorderoComCodigo = (p: {
        grupo: GrupoBoleto;
        borCod: number;
        flpCod: number;
        item: ItemDeBordero;
        boleto: { codbar?: string } | null;
    }): ResultadoVinculoBordero => {
        const { grupo, borCod, flpCod, item, boleto } = p;
        const terceiro = (campo: keyof typeof CAMPO_EDITADO_POR_TERCEIRO): never => {
            throw this.terceiroNoBordero(borCod, flpCod, CAMPO_EDITADO_POR_TERCEIRO[campo]);
        };
        if (!boleto?.codbar) return terceiro('CODIGO');
        const dec = this.codigoBarras.decodificar(
            boleto.codbar.replace(/[\s.]/g, ''),
            grupo.vencimentoBoleto,
        );
        if (!dec) return terceiro('CODIGO');
        const noItem = this.codigoBarras.paraBarras(soDigitos(item.row.itsNumCodbar));
        if (noItem !== dec.barras) return terceiro('CODIGO');
        if (centavos(item.row.itsMnyVlrPgto) !== dec.valorCentavos) return terceiro('VALOR');
        const dataEsperada = dec.vencimento ? this.calendar.toErpEpoch(dec.vencimento) : undefined;
        if (dataEsperada !== undefined && Number(item.row.itsDtaPgto) !== dataEsperada) {
            return terceiro('DATA');
        }
        return {
            tipo: 'vinculado',
            codigoMascarado: AnaliseCodigoBarrasRepetido.mascarar(dec.barras),
            jaVinculado: true,
        };
    };

    /** O item de borderô não tem `docCod/titCod`: o erro de terceiro o identifica pelo `borCod`. */
    private terceiroNoBordero = (
        borCod: number,
        flpCod: number,
        campo: (typeof CAMPO_EDITADO_POR_TERCEIRO)[keyof typeof CAMPO_EDITADO_POR_TERCEIRO],
    ): ItemEditadoPorTerceiroError =>
        new ItemEditadoPorTerceiroError({
            docCod: `borderô ${borCod}`,
            titCod: '-',
            campo,
            flpCod,
        });

    /**
     * Item com código vinculado POR NÓS (`DECISAO_HUMANA`) cuja decisão deixou de ser `CONFIRMADA`
     * (anulada, rejeitada, órfã, revogada): o boleto que a analista desfez não pode chegar ao
     * `finalizar` (F-ft-1). Vínculo do ERP (`ERP_DDA`) nunca é nosso para retirar.
     */
    private vinculoOrfao = (item: ItemLote, ctx: ContextoLocal): boolean =>
        item.vinculoCodigoBarras?.origem === VINCULO_ORIGEM.DECISAO_HUMANA &&
        !ctx.decisoes.has(chaveDe(item));

    // ── Um item ─────────────────────────────────────────────────────────────

    private vincularItem = async (
        p: {
            lote: LotePagamento;
            bncCod: number;
            flpCod: number;
            bancoLote: number | undefined;
            ctx: ContextoLocal;
            alvo: Candidato;
        },
        abortar: (causa: string, mascarado?: string) => never,
    ): Promise<
        | { tipo: 'ignorado' }
        | { tipo: 'vinculado'; vinculo: VinculoAplicado }
        | { tipo: 'retirar'; falha: FalhaDeterministicaVinculo }
    > => {
        const { lote, bncCod, flpCod, bancoLote, ctx, alvo } = p;
        const { item } = alvo;
        const ctxNativo = { filCod: lote.filCod, bncCod, flpCod };

        // 1. Leitura FRESCA do rascunho (itsCodSeq vivo). Falha/truncada ⇒ aborta, nunca retira.
        const lida = await this.lerRascunho(ctxNativo, abortar);
        const nativo = lida.find((n) => chaveDe(n) === alvo.chave);
        if (!nativo) return abortar('ITEM_AUSENTE_NO_RASCUNHO');
        if (nativo.itsCodSeq === undefined) return abortar('ITEM_SEM_IDENTIDADE');
        // O ERP associou o DDA: o código é dele, não é nosso (I17a). Nada a fazer.
        if (Number(nativo.row.vldVinculoDda) === 1) return { tipo: 'ignorado' };

        const codigoNoItem = soDigitos(nativo.row.itsNumCodbar);
        const decisao = ctx.decisoes.get(alvo.chave);

        // 2. Item que já traz código: idempotência (I17f) ou edição de terceiro.
        if (codigoNoItem !== '') {
            if (!decisao) {
                // Código que NÓS gravamos e cuja decisão caiu: fail-closed, retira (F-ft-1).
                if (this.vinculoOrfao(item, ctx)) {
                    return this.falharSemDecisao(lote, flpCod, item, nativo.itsCodSeq);
                }
                return { tipo: 'ignorado' }; // digitado à mão no ERP: não é nosso.
            }
            return this.reconhecerItemComCodigo({ lote, flpCod, ctx, alvo, nativo, decisao });
        }

        // 3. O LÍQUIDO aberto AO VIVO (I17b, ADR-0074). Sem ele não há comparação: fail-closed.
        const aberto = await this.lerAberto(item);
        const liquidoCentavos = ValorAbertoLiquido.calcularCentavos(aberto);
        if (aberto === undefined || liquidoCentavos === undefined) {
            return abortar('VALOR_ABERTO_INDISPONIVEL');
        }

        // 4. Elegibilidade (I17a–d) recalculada AGORA, do banco/pool, nunca do cache.
        const venc = this.vencimentoCivil(
            nativo.row.titDtaVencimento ?? item.vencimento,
            item.vencimento,
        );
        const avaliado = await this.avaliar({
            lote,
            item,
            ctx,
            temBoletoDda: false,
            aberto,
            vencimentoTitulo: venc,
        });
        const e = avaliado.elegibilidade;
        if (!e.elegivel || !avaliado.barras || !avaliado.decisao) {
            return this.falhar(lote, flpCod, item, nativo.itsCodSeq, {
                campo: CAMPO_DIVERGENTE_VINCULO.ELEGIBILIDADE,
                motivo: e.motivo ?? MOTIVO_INELEGIVEL_VINCULO.BOLETO_INDISPONIVEL,
                avaliado,
            });
        }
        const barras = avaliado.barras;
        const mascarado = e.codigoMascarado as string;

        // 5. O mesmo código em OUTRO item do rascunho (I17h): não vincula; retira.
        const repetido = lida.some(
            (n) =>
                chaveDe(n) !== alvo.chave &&
                this.codigoBarras.paraBarras(soDigitos(n.row.itsNumCodbar)) === barras,
        );
        if (repetido) {
            return this.falhar(lote, flpCod, item, nativo.itsCodSeq, {
                campo: CAMPO_DIVERGENTE_VINCULO.CODIGO_REPETIDO,
                avaliado,
            });
        }

        // 6. validacao → confirma. O ERP só decodifica; julgamos nós.
        const linha = this.codigoBarras.paraLinhaDigitavel(barras) as string;
        const vencimentoEpoch = this.calendar.toErpEpoch(avaliado.vencimentoBarra as string);
        // HML V4: banco do código ≠ banco do lote ⇒ modalidade 7 (validação, confirma E item).
        const modalidade =
            bancoLote === undefined
                ? Number(nativo.row.itsVldModalidade) || MODALIDADE_ITEM.MESMO_BANCO
                : Number(e.banco) === bancoLote
                  ? MODALIDADE_ITEM.MESMO_BANCO
                  : MODALIDADE_ITEM.OUTRO_BANCO;
        const base = {
            filCod: lote.filCod,
            bncCod,
            codigo: linha,
            valorLiquido: liquidoCentavos / 100,
            vencimento: this.calendar.toErpEpoch(venc),
            modalidade,
        };
        let validacao: Awaited<ReturnType<ConexosSispagWriteClient['validarCodigoBarras']>>;
        try {
            validacao = await this.write.validarCodigoBarras(base);
        } catch (err) {
            if (this.ehRecusaDeNegocio(err)) {
                return this.falhar(lote, flpCod, item, nativo.itsCodSeq, {
                    campo: CAMPO_DIVERGENTE_VINCULO.ELEGIBILIDADE,
                    motivo: 'ERP_RECUSOU_VALIDACAO',
                    avaliado,
                });
            }
            return abortar('VALIDACAO_TRANSITORIA', mascarado);
        }
        // Conferência pré-PUT: a MESMA régua líquida da elegibilidade (I17b, três pontos).
        if (!ValorAbertoLiquido.bate(aberto, centavos(validacao.barraVlrPgto))) {
            return this.falhar(lote, flpCod, item, nativo.itsCodSeq, {
                campo: CAMPO_DIVERGENTE_VINCULO.VALOR,
                avaliado,
                esperadoCentavos: liquidoCentavos,
                obtidoCentavos: centavos(validacao.barraVlrPgto),
            });
        }
        let confirma: Awaited<ReturnType<ConexosSispagWriteClient['confirmarCodigoBarras']>>;
        try {
            confirma = await this.write.confirmarCodigoBarras({ ...base, validacao });
        } catch (err) {
            if (this.ehRecusaDeNegocio(err)) {
                return this.falhar(lote, flpCod, item, nativo.itsCodSeq, {
                    campo: CAMPO_DIVERGENTE_VINCULO.ELEGIBILIDADE,
                    motivo: 'ERP_RECUSOU_CONFIRMACAO',
                    avaliado,
                });
            }
            return abortar('CONFIRMACAO_TRANSITORIA', mascarado);
        }

        // 7. Verificações NOSSAS pós-confirma (I17d 3–6): divergência ⇒ nenhum PUT.
        const divergencia = this.divergenciaPosConfirma({
            confirma,
            banco: e.banco as string,
            valorBarraCentavos: avaliado.valorBarraCentavos as number,
            vencimentoEpoch,
        });
        if (divergencia) {
            return this.falhar(lote, flpCod, item, nativo.itsCodSeq, {
                campo: divergencia.campo,
                avaliado,
                ...(divergencia.esperadoCentavos !== undefined
                    ? { esperadoCentavos: divergencia.esperadoCentavos }
                    : {}),
                ...(divergencia.obtidoCentavos !== undefined
                    ? { obtidoCentavos: divergencia.obtidoCentavos }
                    : {}),
            });
        }

        // 8. Releitura IMEDIATAMENTE antes do PUT (HML V3: o ERP não tem lock otimista e o PUT
        // leva o item inteiro — usar a row velha pisaria numa edição de terceiro). A row do PUT é
        // a de agora; código presente ou item trocado aborta/segue como I17f.
        const fresca = await this.lerRascunho(ctxNativo, abortar, mascarado);
        const agora = fresca.find((n) => chaveDe(n) === alvo.chave);
        if (!agora || agora.itsCodSeq !== nativo.itsCodSeq) {
            return abortar('ITEM_MUDOU_ANTES_DO_PUT', mascarado);
        }
        if (soDigitos(agora.row.itsNumCodbar) !== '') {
            throw new ItemEditadoPorTerceiroError({
                docCod: item.docCod,
                titCod: item.titCod,
                campo: CAMPO_EDITADO_POR_TERCEIRO.CODIGO,
                flpCod,
            });
        }

        // Revalidação barata da decisão (1 SELECT por PK): anulada/rejeitada desde o início da
        // execução ⇒ o PUT não acontece (F-ft-1).
        const vigente = await this.sugestoes.buscarDecisaoPorId(avaliado.decisao.id);
        if (vigente?.decisao !== DECISAO_SUGESTAO_BOLETO.CONFIRMADA) {
            return this.falhar(lote, flpCod, item, nativo.itsCodSeq, {
                campo: CAMPO_DIVERGENTE_VINCULO.ELEGIBILIDADE,
                motivo: MOTIVO_INELEGIVEL_VINCULO.DECISAO_NAO_CONFIRMADA,
                avaliado,
            });
        }

        // PUT de tentativa ÚNICA. A falha NÃO decide: a releitura é quem diz.
        const trocaModalidade = Number(agora.row.itsVldModalidade) !== modalidade;
        const esperado = {
            itsNumBanco: confirma.itsBncNumCodbancoResult,
            bncDesNome: confirma.itsBncDesNomeResult,
            itsMnyVlrPgto: confirma.itsMnyVlrPgtoResult,
            itsDtaPgto: confirma.itsDtaPgtoResult,
            ...(trocaModalidade ? { itsVldModalidade: modalidade } : {}),
        };
        let putRecusado = false;
        try {
            await this.write.editarItemDoRascunho({
                filCod: lote.filCod,
                bncCod,
                flpCod,
                item: agora.row,
                alteracoes: { itsNumCodbar: linha, ...esperado },
            });
        } catch (err) {
            putRecusado = this.ehRecusaDeNegocio(err);
            await this.logService.warn({
                type: LOG_TYPE.BUSINESS_WARN,
                message: 'vínculo do código de barras: PUT do item falhou — a releitura decide',
                data: {
                    flpCod,
                    item: `${item.docCod}/${item.titCod}`,
                    recusaDeNegocio: putRecusado,
                },
            });
        }

        // 9. Releitura: o sucesso é o que se OBSERVA (código, banco, valor e data).
        const aposPut = await this.lerRascunho(ctxNativo, abortar, mascarado);
        const depois = aposPut.find((n) => chaveDe(n) === alvo.chave);
        // Conferência pós-releitura: o pagamento observado bate com a MESMA régua líquida (I17b).
        const observado =
            depois !== undefined &&
            this.bate(depois.row, barras, esperado) &&
            ValorAbertoLiquido.bate(aberto, centavos(depois.row.itsMnyVlrPgto));
        if (!observado) {
            if (depois !== undefined && soDigitos(depois.row.itsNumCodbar) !== '') {
                // O item mudou para um código que não é o nosso entre a leitura e a releitura.
                throw new ItemEditadoPorTerceiroError({
                    docCod: item.docCod,
                    titCod: item.titCod,
                    campo: CAMPO_EDITADO_POR_TERCEIRO.CODIGO,
                    flpCod,
                });
            }
            if (putRecusado) {
                return this.falhar(lote, flpCod, item, nativo.itsCodSeq, {
                    campo: CAMPO_DIVERGENTE_VINCULO.ELEGIBILIDADE,
                    motivo: 'ERP_RECUSOU_PUT',
                    avaliado,
                });
            }
            return abortar('PUT_NAO_OBSERVADO', mascarado);
        }

        // 10. Persistência só DEPOIS da releitura (transação: coluna + evento).
        await this.persistir({ lote, flpCod, item, decisaoId: avaliado.decisao.id, mascarado });
        return {
            tipo: 'vinculado',
            vinculo: {
                titulo: paraTitulo(item),
                codigoMascarado: mascarado,
                decisaoId: avaliado.decisao.id,
                jaVinculado: false,
            },
        };
    };

    /** Item que já traz código: igual ao esperado ⇒ idempotente; diferente ⇒ terceiro (I17f). */
    private reconhecerItemComCodigo = async (p: {
        lote: LotePagamento;
        flpCod: number;
        ctx: ContextoLocal;
        alvo: Candidato;
        nativo: ItemDoRascunho;
        decisao: DecisaoSugestao;
    }): Promise<{ tipo: 'ignorado' } | { tipo: 'vinculado'; vinculo: VinculoAplicado }> => {
        const { lote, flpCod, alvo, nativo, decisao } = p;
        const { item } = alvo;
        const boleto = await this.boletos.buscarPorChave({
            ddcCod: decisao.ddcCod,
            ditCod: decisao.ditCod,
        });
        if (!boleto?.codbar) return { tipo: 'ignorado' };
        const venc = this.vencimentoCivil(nativo.row.titDtaVencimento ?? item.vencimento);
        const dec = this.codigoBarras.decodificar(boleto.codbar, venc);
        if (!dec) return { tipo: 'ignorado' };
        const naoPodeTerceiro = (campo: keyof typeof CAMPO_EDITADO_POR_TERCEIRO): never => {
            throw new ItemEditadoPorTerceiroError({
                docCod: item.docCod,
                titCod: item.titCod,
                campo: CAMPO_EDITADO_POR_TERCEIRO[campo],
                flpCod,
            });
        };
        const noItem = this.codigoBarras.paraBarras(soDigitos(nativo.row.itsNumCodbar));
        if (noItem !== dec.barras) return naoPodeTerceiro('CODIGO');
        if (centavos(nativo.row.itsMnyVlrPgto) !== dec.valorCentavos)
            return naoPodeTerceiro('VALOR');
        const dataEsperada = dec.vencimento ? this.calendar.toErpEpoch(dec.vencimento) : undefined;
        if (dataEsperada !== undefined && Number(nativo.row.itsDtaPgto) !== dataEsperada) {
            return naoPodeTerceiro('DATA');
        }
        const mascarado = AnaliseCodigoBarrasRepetido.mascarar(dec.barras);
        if (item.vinculoCodigoBarras?.decisaoId !== decisao.id) {
            await this.persistir({ lote, flpCod, item, decisaoId: decisao.id, mascarado });
        }
        return {
            tipo: 'vinculado',
            vinculo: {
                titulo: paraTitulo(item),
                codigoMascarado: mascarado,
                decisaoId: decisao.id,
                jaVinculado: true,
            },
        };
    };

    // ── Peças ───────────────────────────────────────────────────────────────

    private lerRascunho = async (
        ctx: { filCod: number; bncCod: number; flpCod: number },
        abortar: (causa: string, mascarado?: string) => never,
        mascarado?: string,
    ): Promise<ItemDoRascunho[]> => {
        try {
            const r = await this.write.lerItensDoRascunho(ctx);
            if (!r.completa) return abortar('LEITURA_INCOMPLETA', mascarado);
            return r.itens;
        } catch (err) {
            if (err instanceof VinculoCodigoBarrasIncompletoError) throw err;
            return abortar('LEITURA_FALHOU', mascarado);
        }
    };

    /** Valores da régua líquida, ao vivo no `fin064`; `undefined` = ilegível (fail-closed). */
    private lerAberto = async (item: ItemLote): Promise<ValoresAbertoTitulo | undefined> => {
        const r = await this.sispag.lerValoresAberto(item.filCod, item.docCod, item.titCod);
        return r.legivel ? r.valores : undefined;
    };

    private boletos_ = (lote: LotePagamento): ItemLote[] =>
        lote.itens.filter((i) => i.modalidade === MODALIDADE.BOLETO);

    private carregarContexto = async (): Promise<ContextoLocal> => {
        const [confirmadas, pares] = await Promise.all([
            this.sugestoes.listarDecisoes({ decisao: DECISAO_SUGESTAO_BOLETO.CONFIRMADA }),
            this.sugestoes.listarParesVigentes(),
        ]);
        const decisoes = new Map<string, DecisaoSugestao>();
        for (const d of confirmadas) {
            if (d.decisao === DECISAO_SUGESTAO_BOLETO.CONFIRMADA) decisoes.set(chaveDe(d), d);
        }
        return { decisoes, paresVigentes: new Set(pares.map((x) => x.id)) };
    };

    /**
     * Junta o que é lido AGORA (decisão, par, boleto do pool, carteira) e chama a regra pura.
     * `aberto` ausente ⇒ `VALOR_ABERTO_INDISPONIVEL`. O código completo nunca sai daqui: o
     * resultado carrega a máscara; as barras ficam em `barras` só para o executor.
     */
    private avaliar = async (p: {
        lote: LotePagamento;
        item: ItemLote;
        ctx: ContextoLocal;
        temBoletoDda: boolean;
        aberto?: ValoresAbertoTitulo;
        vencimentoTitulo: string;
        titulo?: Awaited<ReturnType<TituloAPagarRepository['buscarPorChave']>>;
    }): Promise<Avaliado> => {
        const { lote, item, ctx } = p;
        const decisao = ctx.decisoes.get(chaveDe(item));
        const dataDebito = lote.dataDebito ?? p.vencimentoTitulo;
        const base = {
            modalidade: item.modalidade,
            temBoletoDda: p.temBoletoDda,
            noRascunho: true,
            vencimentoTitulo: p.vencimentoTitulo,
            dataDebito,
            ...(p.aberto !== undefined ? { aberto: p.aberto } : {}),
        };
        if (!decisao) {
            return { elegibilidade: this.elegibilidade.avaliar({ ...base }) };
        }
        const [boleto, titulo] = await Promise.all([
            this.boletos.buscarPorChave({ ddcCod: decisao.ddcCod, ditCod: decisao.ditCod }),
            p.titulo !== undefined ? Promise.resolve(p.titulo) : this.titulos.buscarPorChave(item),
        ]);
        const parVigente =
            decisao.confirmacaoEmissorId !== undefined &&
            ctx.paresVigentes.has(decisao.confirmacaoEmissorId);
        const boletoLigadoPeloErp =
            boleto != null &&
            boleto.filCod != null &&
            boleto.docCod != null &&
            boleto.titCod != null;
        const orfa = boleto == null || boletoLigadoPeloErp || titulo?.temBoleto === true;
        const liquidoCentavos = ValorAbertoLiquido.calcularCentavos(p.aberto);
        const tier =
            boleto && liquidoCentavos !== undefined
                ? this.regra.avaliar({
                      titulo: { valor: liquidoCentavos / 100, vencimento: p.vencimentoTitulo },
                      boleto: {
                          valor: boleto.valor,
                          vencimento: boleto.vencimento ?? '',
                          ...(boleto.numero ? { numero: boleto.numero } : {}),
                      },
                      dataDebito,
                      parConfirmado: parVigente,
                  }).resultado
                : undefined;
        const elegibilidade = this.elegibilidade.avaliar({
            ...base,
            decisao: { id: decisao.id, decisao: decisao.decisao, orfa, parVigente },
            ...(boleto?.codbar ? { codigo: boleto.codbar } : {}),
            ...(boleto ? { poolValor: boleto.valor } : {}),
            ...(boleto?.vencimento ? { poolVencimento: boleto.vencimento } : {}),
            ...(tier !== undefined ? { tier } : {}),
            ...(item.valor !== undefined ? { valorItem: item.valor } : {}),
        });
        const dec = boleto?.codbar
            ? this.codigoBarras.decodificar(boleto.codbar, boleto.vencimento ?? p.vencimentoTitulo)
            : undefined;
        return {
            elegibilidade,
            decisao,
            ...(dec
                ? {
                      barras: dec.barras,
                      valorBarraCentavos: dec.valorCentavos,
                      ...(dec.vencimento ? { vencimentoBarra: dec.vencimento } : {}),
                  }
                : {}),
        };
    };

    private divergenciaPosConfirma = (p: {
        confirma: Awaited<ReturnType<ConexosSispagWriteClient['confirmarCodigoBarras']>>;
        banco: string;
        valorBarraCentavos: number;
        vencimentoEpoch: number;
    }):
        | { campo: CampoDivergenteVinculo; esperadoCentavos?: number; obtidoCentavos?: number }
        | undefined => {
        const { confirma } = p;
        if (Number(confirma.itsBncNumCodbancoResult) !== Number(p.banco)) {
            return { campo: CAMPO_DIVERGENTE_VINCULO.BANCO };
        }
        if (Number(confirma.itsDtaPgtoResult) !== p.vencimentoEpoch) {
            return { campo: CAMPO_DIVERGENTE_VINCULO.DATA };
        }
        // O ERP SOMA juros ao valor da barra (HML #4): qualquer diferença aborta o item (I17d(6)).
        const obtido = centavos(confirma.itsMnyVlrPgtoResult);
        if (obtido !== p.valorBarraCentavos) {
            return {
                campo: CAMPO_DIVERGENTE_VINCULO.JUROS_DESCONTO,
                esperadoCentavos: p.valorBarraCentavos,
                obtidoCentavos: obtido,
            };
        }
        return undefined;
    };

    /** A releitura mostra o que gravaríamos? (código, banco/nome, valor e data) */
    private bate = (
        row: Row,
        barras: string,
        esperado: {
            itsNumBanco: string | number;
            bncDesNome: string;
            itsMnyVlrPgto: number;
            itsDtaPgto: number;
            itsVldModalidade?: number;
        },
    ): boolean =>
        this.codigoBarras.paraBarras(soDigitos(row.itsNumCodbar)) === barras &&
        (esperado.itsVldModalidade === undefined ||
            Number(row.itsVldModalidade) === esperado.itsVldModalidade) &&
        String(row.itsNumBanco ?? '') === String(esperado.itsNumBanco) &&
        String(row.bncDesNome ?? '').trim() !== '' &&
        centavos(row.itsMnyVlrPgto) === centavos(esperado.itsMnyVlrPgto) &&
        Number(row.itsDtaPgto) === Number(esperado.itsDtaPgto);

    private ehRecusaDeNegocio = (err: unknown): boolean =>
        err instanceof ErpPerguntaError ||
        (err instanceof ConexosError && err.code === 'CONEXOS_UPSTREAM_REJECTED');

    /** Falha determinística: registra `VINCULO_FALHOU` e devolve o item para a retirada (I17g(3)). */
    /** Falha por decisão que deixou de ser `CONFIRMADA` (item com código nosso, F-ft-1). */
    private falharSemDecisao = (
        lote: LotePagamento,
        flpCod: number,
        item: ItemLote,
        itsCodSeq: number | undefined,
    ): Promise<{ tipo: 'retirar'; falha: FalhaDeterministicaVinculo }> => {
        const v = item.vinculoCodigoBarras;
        return this.falhar(lote, flpCod, item, itsCodSeq, {
            campo: CAMPO_DIVERGENTE_VINCULO.ELEGIBILIDADE,
            motivo: MOTIVO_INELEGIVEL_VINCULO.DECISAO_NAO_CONFIRMADA,
            avaliado: {
                elegibilidade: {
                    elegivel: false,
                    motivo: MOTIVO_INELEGIVEL_VINCULO.DECISAO_NAO_CONFIRMADA,
                    ...(v?.codigoMascarado ? { codigoMascarado: v.codigoMascarado } : {}),
                } as ResultadoElegibilidadeVinculo,
            },
            ...(v?.decisaoId ? { decisaoId: v.decisaoId } : {}),
        });
    };

    private falhar = async (
        lote: LotePagamento,
        flpCod: number,
        item: ItemLote,
        itsCodSeq: number | undefined,
        o: {
            campo: CampoDivergenteVinculo;
            motivo?: string;
            avaliado: Avaliado;
            decisaoId?: string;
            esperadoCentavos?: number;
            obtidoCentavos?: number;
        },
    ): Promise<{ tipo: 'retirar'; falha: FalhaDeterministicaVinculo }> => {
        const e = o.avaliado.elegibilidade;
        const erro = new VinculoCodigoBarrasDivergenteError({
            docCod: item.docCod,
            titCod: item.titCod,
            campo: o.campo,
            ...(o.esperadoCentavos !== undefined ? { esperadoCentavos: o.esperadoCentavos } : {}),
            ...(o.obtidoCentavos !== undefined ? { obtidoCentavos: o.obtidoCentavos } : {}),
            ...(e.deltaDias !== undefined ? { deltaDias: e.deltaDias } : {}),
            ...(e.codigoMascarado ? { codigoMascarado: e.codigoMascarado } : {}),
            ...(o.motivo ? { motivo: o.motivo } : {}),
        });
        const motivo = o.motivo ?? o.campo;
        await this.sugestoes.registrarEventoVinculo({
            tipo: EVENTO_SUGESTAO_BOLETO.VINCULO_FALHOU,
            ator: 'sistema',
            loteId: lote.id,
            filCod: item.filCod,
            docCod: item.docCod,
            titCod: item.titCod,
            ...(o.avaliado.decisao
                ? { decisaoId: o.avaliado.decisao.id }
                : o.decisaoId
                  ? { decisaoId: o.decisaoId }
                  : {}),
            motivo,
            detalhe: {
                campo: o.campo,
                flpCod,
                ...(e.codigoMascarado ? { codigoMascarado: e.codigoMascarado } : {}),
            },
        });
        return {
            tipo: 'retirar',
            falha: {
                titulo: paraTitulo(item),
                campo: o.campo,
                motivo,
                ...(e.codigoMascarado ? { codigoMascarado: e.codigoMascarado } : {}),
                ...(itsCodSeq !== undefined ? { itsCodSeq } : {}),
                aviso: erro.userMessage,
            },
        };
    };

    /** Coluna do item + `VINCULO_APLICADO` na MESMA transação (I17e). */
    private persistir = async (p: {
        lote: LotePagamento;
        flpCod: number;
        item: ItemLote;
        decisaoId: string;
        mascarado: string;
    }): Promise<void> => {
        const { lote, flpCod, item, decisaoId, mascarado } = p;
        await this.db.withTransaction(async (tx) => {
            const gravou = await this.loteRepo.gravarVinculoCodigoBarras(
                {
                    loteId: lote.id,
                    filCod: item.filCod,
                    docCod: item.docCod,
                    titCod: item.titCod,
                    origem: VINCULO_ORIGEM.DECISAO_HUMANA,
                    decisaoId,
                    codigoMascarado: mascarado,
                    flpCod,
                },
                tx,
            );
            if (!gravou) {
                throw new VinculoCodigoBarrasIncompletoError({
                    flpCod,
                    vinculados: [],
                    pendentes: [{ docCod: item.docCod, titCod: item.titCod }],
                    causa: 'ITEM_FORA_DO_LOTE_LOCAL',
                    codigoMascarado: mascarado,
                });
            }
            await this.sugestoes.registrarEventoVinculo(
                {
                    tipo: EVENTO_SUGESTAO_BOLETO.VINCULO_APLICADO,
                    ator: 'sistema',
                    loteId: lote.id,
                    filCod: item.filCod,
                    docCod: item.docCod,
                    titCod: item.titCod,
                    decisaoId,
                    detalhe: { codigoMascarado: mascarado, flpCod },
                },
                tx,
            );
        });
    };

    private registrarSimulado = async (
        lote: LotePagamento,
        item: ItemLote,
        p: PrevisaoVinculo,
    ): Promise<void> => {
        await this.sugestoes.registrarEventoVinculo({
            tipo: EVENTO_SUGESTAO_BOLETO.VINCULO_SIMULADO,
            ator: 'sistema',
            loteId: lote.id,
            filCod: item.filCod,
            docCod: item.docCod,
            titCod: item.titCod,
            ...(p.decisaoId ? { decisaoId: p.decisaoId } : {}),
            motivo: p.elegivel ? 'ELEGIVEL' : (p.motivo ?? 'INELEGIVEL'),
            detalhe: {
                elegivel: p.elegivel,
                valorAbertoFonte: p.valorAbertoFonte,
                ...(p.deltaDias !== undefined ? { deltaDias: p.deltaDias } : {}),
                ...(p.deltaCentavos !== undefined ? { deltaCentavos: p.deltaCentavos } : {}),
                ...(p.codigoMascarado ? { codigoMascarado: p.codigoMascarado } : {}),
            },
        });
    };

    /** Data civil (`YYYY-MM-DD`) de um epoch do ERP; `fallback` quando o primeiro não vale. */
    private vencimentoCivil = (epoch: unknown, fallback?: unknown): string => {
        const n = Number(epoch);
        if (Number.isFinite(n) && n > 0) return this.calendar.fromErpEpoch(n);
        const f = Number(fallback);
        return Number.isFinite(f) && f > 0 ? this.calendar.fromErpEpoch(f) : '';
    };
}
