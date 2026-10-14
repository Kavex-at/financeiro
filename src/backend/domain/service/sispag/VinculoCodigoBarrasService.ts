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
import { LOG_TYPE } from '../../interface/log/LogInterface.js';
import {
    DECISAO_SUGESTAO_BOLETO,
    type DecisaoSugestao,
    EVENTO_SUGESTAO_BOLETO,
} from '../../interface/sispag/ConfirmacaoEmissorBoleto.js';
import type { ItemDoRascunho } from '../../interface/sispag/Fin015Write.js';
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
import ModoVinculoCodigoBarras, {
    MODO_VINCULO,
    type ModoVinculo,
} from '../../libs/boleto/ModoVinculoCodigoBarras.js';
import BankingCalendar from '../../libs/calendar/BankingCalendar.js';
import EnvironmentProvider from '../../libs/environment/EnvironmentProvider.js';
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
    /** `on`: `fin064.totalAberto` lido ao vivo (I17b). */
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
     * `registrar` grava `VINCULO_SIMULADO` (só no caminho vivo do `shadow`; o endpoint e o dry-run
     * não gravam nada durável).
     */
    public prever = async (
        lote: LotePagamento,
        opcoes: { registrar?: boolean } = {},
    ): Promise<PrevisaoVinculo[]> => {
        const ctx = await this.carregarContexto();
        const previsoes: PrevisaoVinculo[] = [];
        for (const item of this.boletos_(lote)) {
            const local = await this.titulos.buscarPorChave(item);
            if (local?.temBoleto === true) continue; // caminho DDA do ERP: nada a prever.
            const avaliado = await this.avaliar({
                lote,
                item,
                ctx,
                temBoletoDda: false,
                aberto: local && local.ativo !== false ? local.valor : undefined,
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
    }): Promise<ResultadoExecucaoVinculo> => {
        const { lote, bncCod, flpCod } = input;
        const ctx = await this.carregarContexto();
        const preferidos = await this.chavesComDecisaoHumana(lote);
        const candidatos: Candidato[] = this.boletos_(lote).map((item) => ({
            item,
            chave: chaveDe(item),
        }));
        const vinculados: VinculoAplicado[] = [];
        const retirar: FalhaDeterministicaVinculo[] = [];
        const resto = [...candidatos];
        const naFila = (): TituloDoVinculo[] =>
            resto.map((c) => ({ docCod: c.item.docCod, titCod: c.item.titCod }));
        const feitos = (): TituloDoVinculo[] =>
            vinculados.map((v) => ({ docCod: v.titulo.docCod, titCod: v.titulo.titCod }));

        while (resto.length > 0) {
            const alvo = resto[0] as Candidato;
            const r = await this.vincularItem({ lote, bncCod, flpCod, ctx, alvo }, (causa, m) => {
                throw new VinculoCodigoBarrasIncompletoError({
                    flpCod,
                    vinculados: feitos(),
                    pendentes: naFila(),
                    causa,
                    ...(m ? { codigoMascarado: m } : {}),
                });
            });
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

    // ── Um item ─────────────────────────────────────────────────────────────

    private vincularItem = async (
        p: {
            lote: LotePagamento;
            bncCod: number;
            flpCod: number;
            ctx: ContextoLocal;
            alvo: Candidato;
        },
        abortar: (causa: string, mascarado?: string) => never,
    ): Promise<
        | { tipo: 'ignorado' }
        | { tipo: 'vinculado'; vinculo: VinculoAplicado }
        | { tipo: 'retirar'; falha: FalhaDeterministicaVinculo }
    > => {
        const { lote, bncCod, flpCod, ctx, alvo } = p;
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
            if (!decisao) return { tipo: 'ignorado' }; // digitado à mão no ERP: não é nosso.
            return this.reconhecerItemComCodigo({ lote, flpCod, ctx, alvo, nativo, decisao });
        }

        // 3. O aberto AO VIVO. Sem ele não há comparação: fail-closed, sem fallback.
        const aberto = await this.lerAberto(item);
        if (aberto === undefined) return abortar('VALOR_ABERTO_INDISPONIVEL');

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
        const modalidade = Number(nativo.row.itsVldModalidade) || 6;
        const base = {
            filCod: lote.filCod,
            bncCod,
            codigo: linha,
            valorLiquido: aberto,
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
        if (centavos(validacao.barraVlrPgto) !== centavos(aberto)) {
            return this.falhar(lote, flpCod, item, nativo.itsCodSeq, {
                campo: CAMPO_DIVERGENTE_VINCULO.VALOR,
                avaliado,
                esperadoCentavos: centavos(aberto),
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

        // 8. PUT de tentativa ÚNICA. A falha NÃO decide: a releitura é quem diz.
        const esperado = {
            itsNumBanco: confirma.itsBncNumCodbancoResult,
            bncDesNome: confirma.itsBncDesNomeResult,
            itsMnyVlrPgto: confirma.itsMnyVlrPgtoResult,
            itsDtaPgto: confirma.itsDtaPgtoResult,
        };
        let putRecusado = false;
        try {
            await this.write.editarItemDoRascunho({
                filCod: lote.filCod,
                bncCod,
                flpCod,
                item: nativo.row,
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
        const observado = depois !== undefined && this.bate(depois.row, barras, esperado);
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

    /** `fin064.totalAberto` ao vivo; `undefined` = indisponível (fail-closed). */
    private lerAberto = async (item: ItemLote): Promise<number | undefined> => {
        const r = await this.sispag.lerTotalAberto(item.filCod, item.docCod, item.titCod);
        return r.legivel ? r.totalAberto : undefined;
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
        aberto?: number;
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
            ...(p.aberto !== undefined ? { totalAberto: p.aberto } : {}),
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
        const tier =
            boleto && p.aberto !== undefined
                ? this.regra.avaliar({
                      titulo: { valor: p.aberto, vencimento: p.vencimentoTitulo },
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
            ? this.codigoBarras.decodificar(boleto.codbar, p.vencimentoTitulo)
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
        },
    ): boolean =>
        this.codigoBarras.paraBarras(soDigitos(row.itsNumCodbar)) === barras &&
        String(row.itsNumBanco ?? '') === String(esperado.itsNumBanco) &&
        String(row.bncDesNome ?? '').trim() !== '' &&
        centavos(row.itsMnyVlrPgto) === centavos(esperado.itsMnyVlrPgto) &&
        Number(row.itsDtaPgto) === Number(esperado.itsDtaPgto);

    private ehRecusaDeNegocio = (err: unknown): boolean =>
        err instanceof ErpPerguntaError ||
        (err instanceof ConexosError && err.code === 'CONEXOS_UPSTREAM_REJECTED');

    /** Falha determinística: registra `VINCULO_FALHOU` e devolve o item para a retirada (I17g(3)). */
    private falhar = async (
        lote: LotePagamento,
        flpCod: number,
        item: ItemLote,
        itsCodSeq: number | undefined,
        o: {
            campo: CampoDivergenteVinculo;
            motivo?: string;
            avaliado: Avaliado;
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
            ...(o.avaliado.decisao ? { decisaoId: o.avaliado.decisao.id } : {}),
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
