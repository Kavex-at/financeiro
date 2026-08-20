import { inject, injectable } from 'tsyringe';
import ConexosBaseClient from '../../client/ConexosBaseClient.js';
import ConexosSispagClient from '../../client/ConexosSispagClient.js';
import ConexosSispagRetornoClient from '../../client/ConexosSispagRetornoClient.js';
import BoundedConcurrency from '../../libs/concurrency/BoundedConcurrency.js';
import { LOG_TYPE } from '../../interface/log/LogInterface.js';
import type { ArquivoRetorno } from '../../interface/sispag/Fin052Retorno.js';
import {
    type LoteSispag,
    MODALIDADE,
    type Modalidade,
    type SispagKpis,
    type SispagPainelResponse,
    type TituloAPagar,
} from '../../interface/sispag/SispagInterface.js';
import EnvironmentProvider from '../../libs/environment/EnvironmentProvider.js';
import LotePagamentoRepository from '../../repository/sispag/LotePagamentoRepository.js';
import PagamentoIngestaoRunRepository from '../../repository/sispag/PagamentoIngestaoRunRepository.js';
import TituloAPagarRepository from '../../repository/sispag/TituloAPagarRepository.js';
import LogService from '../LogService.js';

const DAY_MS = 24 * 60 * 60 * 1000;
/** Nº máx. de títulos devolvidos ao painel (evita payload gigante). */
const TITULOS_CAP = 400;
/**
 * Teto de chamadas Conexos SIMULTÂNEAS no fan-out do painel (lotes nativos).
 * Evita o burst que pressiona o pool de sessões do Conexos (`LOGIN_ERROR_MAX_SESSIONS`).
 */
const CONEXOS_FANOUT_LIMIT = 4;

/**
 * SispagPainelService — monta o painel READ-ONLY do Escopo II (spike / Fatia 1).
 *
 * Agrega leituras do Conexos (títulos a pagar, lotes SISPAG nativos, borderôs),
 * deriva aging e KPIs, e devolve tudo para a tela. NENHUMA escrita/execução —
 * o "montar/finalizar/enviar" é simulado 100% no front. Ver
 * `ontology/_inbox/sispag-native-vs-nexxera.md` e `sispag-context-map.md`.
 */
@injectable()
export default class SispagPainelService {
    public constructor(
        @inject(ConexosSispagClient) private readonly sispag: ConexosSispagClient,
        @inject(ConexosSispagRetornoClient)
        private readonly retorno: ConexosSispagRetornoClient,
        @inject(ConexosBaseClient) private readonly base: ConexosBaseClient,
        @inject(BoundedConcurrency) private readonly bounded: BoundedConcurrency,
        @inject(TituloAPagarRepository) private readonly tituloRepo: TituloAPagarRepository,
        @inject(PagamentoIngestaoRunRepository)
        private readonly runRepo: PagamentoIngestaoRunRepository,
        @inject(LotePagamentoRepository) private readonly loteRepo: LotePagamentoRepository,
        @inject(EnvironmentProvider) private readonly env: EnvironmentProvider,
        @inject(LogService) private readonly logService: LogService,
    ) {}

    public montarPainel = async (): Promise<SispagPainelResponse> => {
        const filiais = await this.base.getFiliais();
        const filCods = filiais
            .map((f) => f.filCod)
            .filter((n): n is number => typeof n === 'number');

        const now = Date.now();

        // TÍTULOS: vêm da carteira PERSISTIDA (ingestão), não mais ao vivo do Conexos.
        const [titulosRaw, ultimaRun, emRascunho] = await Promise.all([
            this.tituloRepo.listAtivos(),
            this.runRepo.findLatestSuccessFinishedAt(),
            this.loteRepo.listTitulosEmRascunho(),
        ]);
        // Marca os títulos já num lote RASCUNHO — o painel bloqueia a seleção (I3, anti-reatache).
        const emLote = new Set(emRascunho.map((t) => `${t.filCod}:${t.docCod}:${t.titCod}`));
        for (const t of titulosRaw) {
            t.emLote = emLote.has(`${t.filCod}:${t.docCod}:${t.titCod}`);
        }

        // Contexto AO VIVO (lotes SISPAG nativos): fan-out LIMITADO (1 leitura/filial),
        // tolerante a falha per-leitura.
        const settled = await this.bounded.run(
            filCods,
            (filCod) => this.sispag.listLotes(filCod),
            CONEXOS_FANOUT_LIMIT,
        );

        const lotesRaw: LoteSispag[] = [];
        for (let i = 0; i < settled.length; i += 1) {
            const result = settled[i];
            if (result.status === 'rejected') {
                await this.logService.warn({
                    type: LOG_TYPE.BUSINESS_WARN,
                    message: 'SISPAG: leitura de lotes nativos falhou (ignorada no painel)',
                    data: {
                        filCod: filCods[i],
                        reason:
                            result.reason instanceof Error
                                ? result.reason.message
                                : String(result.reason),
                    },
                });
                continue;
            }
            lotesRaw.push(...result.value);
        }

        // Carteira completa (KPIs calculam sobre ela); a resposta corta em CAP.
        const titulosPreparados = this.prepararTitulos(titulosRaw, now);
        const kpis = this.calcularKpis(titulosPreparados, lotesRaw);
        const titulos = titulosPreparados.slice(0, TITULOS_CAP);
        const envVars = await this.env.getEnvironmentVars();

        await this.logService.info({
            type: LOG_TYPE.BUSINESS_INFO,
            message: 'SISPAG painel (read-only) montado',
            data: {
                filiais: filCods.length,
                titulos: titulos.length,
                lotes: lotesRaw.length,
            },
        });

        return {
            geradoEm: new Date(now).toISOString(),
            modo: {
                somenteLeitura: true,
                conexosWriteEnabled: envVars.conexosWriteEnabled,
                conexosDryRun: envVars.conexosDryRun,
            },
            ingestao: {
                ultimaRunEm: ultimaRun ? ultimaRun.toISOString() : undefined,
            },
            kpis,
            titulos,
            lotes: this.ordenarLotes(lotesRaw),
        };
    };

    /**
     * Arquivos de RETORNO (`.RET`) do Conexos (fin052) — READ-ONLY. Espelha a aba
     * de lotes nativos: lê ao vivo, por filial × config de retorno (ger015). Tolerante
     * a falha per-leitura. O upload/processar do `.RET` é fase futura (dormente).
     */
    public listRetornos = async (): Promise<ArquivoRetorno[]> => {
        const filiais = await this.base.getFiliais();
        const filCods = filiais
            .map((f) => f.filCod)
            .filter((n): n is number => typeof n === 'number');

        // 1) por filial: descobre os pares (bncCod, gtbCodSeq) válidos (ger015).
        const configsSettled = await this.bounded.run(
            filCods,
            (filCod) =>
                this.retorno
                    .listConfigsRetorno({ filCod })
                    .then((cfgs) =>
                        cfgs.map((c) => ({ filCod, bncCod: c.bncCod, gtbCodSeq: c.gtbCodSeq })),
                    ),
            CONEXOS_FANOUT_LIMIT,
        );
        const alvos: Array<{ filCod: number; bncCod: number; gtbCodSeq: number }> = [];
        for (const s of configsSettled) {
            if (s.status === 'fulfilled') alvos.push(...s.value);
        }

        // 2) por (filial, banco, config): lista os arquivos de retorno (`arquivosRetorno/list`).
        const arquivosSettled = await this.bounded.run(
            alvos,
            (alvo) =>
                this.retorno.listArquivosRetorno({
                    filCod: alvo.filCod,
                    bncCod: alvo.bncCod,
                    gtbCodSeq: alvo.gtbCodSeq,
                }),
            CONEXOS_FANOUT_LIMIT,
        );
        const arquivos: ArquivoRetorno[] = [];
        for (let i = 0; i < arquivosSettled.length; i += 1) {
            const s = arquivosSettled[i];
            if (s.status === 'fulfilled') {
                arquivos.push(...s.value);
            } else {
                await this.logService.warn({
                    type: LOG_TYPE.BUSINESS_WARN,
                    message: 'SISPAG: fin052 return-file read failed (ignored)',
                    data: {
                        alvo: alvos[i],
                        reason: s.reason instanceof Error ? s.reason.message : String(s.reason),
                    },
                });
            }
        }
        // Mais recentes primeiro (por sequencial do arquivo).
        return arquivos.sort((a, b) => b.garCodSeq - a.garCodSeq);
    };

    /**
     * A2 opção B — formas de pagamento DISPONÍVEIS por título do lote, lidas AO VIVO do
     * Conexos (fin064: barras→boleto, chave PIX→pix, banco+conta→ted/crédito). Evita o
     * analista escolher uma forma sem cadastro (→ `.REM` rejeitado). Fan-out limitado,
     * tolerante a falha (título sem leitura → lista vazia, o front trata).
     */
    public modalidadesDisponiveisDoLote = async (
        loteId: string,
    ): Promise<Array<{ docCod: string; titCod: string; modalidades: Modalidade[] }>> => {
        const lote = await this.loteRepo.getLoteComItens(loteId);
        if (!lote) return [];
        // Duas fontes, porque o ERP as guarda em lugares diferentes:
        //   boleto/PIX  → do TÍTULO (`fin064`, via `getTituloAPagar`)
        //   TED/crédito → da CONTA DO FAVORECIDO (`cmn025/ctcorr`)
        // O `fin064` NÃO carrega a conta (0% em 561 títulos de HML e 2000 de PRD — os
        // campos `pct*` de lá são join no item SISPAG e só populam depois do import).
        // Antes desta correção a rota devolvia lista vazia para todo item.
        const settled = await this.bounded.run(
            lote.itens,
            async (it) => {
                const titulo = await this.sispag.getTituloAPagar(it.filCod, it.docCod, it.titCod);
                const modalidades = [...(titulo?.modalidadesDisponiveis ?? [])];
                if (titulo?.pesCod) {
                    const contas = await this.sispag.listContasFavorecido(
                        titulo.pesCod,
                        it.filCod,
                    );
                    if (contas.length > 0) {
                        modalidades.push(MODALIDADE.TED, MODALIDADE.CREDITO_CONTA);
                    }
                }
                return modalidades;
            },
            CONEXOS_FANOUT_LIMIT,
        );
        return lote.itens.map((it, i) => {
            const s = settled[i];
            const modalidades = s.status === 'fulfilled' ? (s.value ?? []) : [];
            return { docCod: it.docCod, titCod: it.titCod, modalidades };
        });
    };

    /** Filtra não-pagos, deriva aging e ordena por vencimento (mais urgente 1º). */
    private prepararTitulos = (titulos: TituloAPagar[], now: number): TituloAPagar[] =>
        titulos
            .filter((t) => !t.pago)
            .map((t) => ({
                ...t,
                diasAteVencimento:
                    t.vencimento !== undefined
                        ? Math.round((t.vencimento - now) / DAY_MS)
                        : undefined,
            }))
            .sort((a, b) => (a.vencimento ?? Infinity) - (b.vencimento ?? Infinity));

    private ordenarLotes = (lotes: LoteSispag[]): LoteSispag[] =>
        [...lotes].sort((a, b) => (b.dataCredito ?? 0) - (a.dataCredito ?? 0));

    private calcularKpis = (titulos: TituloAPagar[], lotes: LoteSispag[]): SispagKpis => {
        const aprovado = (t: TituloAPagar): boolean => t.liberado && !t.pago;
        const dias = (t: TituloAPagar): number => t.diasAteVencimento ?? Infinity;
        const aVencer7d = titulos.filter((t) => aprovado(t) && dias(t) >= 0 && dias(t) <= 7);
        const aVencer30d = titulos.filter((t) => aprovado(t) && dias(t) >= 0 && dias(t) <= 30);
        const vencidos = titulos.filter((t) => aprovado(t) && dias(t) < 0);
        return {
            titulosAVencer7d: aVencer7d.length,
            titulosAVencer30d: aVencer30d.length,
            titulosVencidos: vencidos.length,
            valorAVencer30d: aVencer30d.reduce((acc, t) => acc + t.valor, 0),
            lotesAbertos: lotes.filter((l) => !l.envioConfirmado).length,
            lotesEnviados: lotes.filter((l) => l.envioConfirmado).length,
        };
    };
}
