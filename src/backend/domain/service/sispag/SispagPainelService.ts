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
    type ExecucoesParadas,
    type SispagPainelResponse,
    type TituloAPagar,
} from '../../interface/sispag/SispagInterface.js';
import EnvironmentProvider from '../../libs/environment/EnvironmentProvider.js';
import ConciliacaoExecucaoRepository from '../../repository/sispag/ConciliacaoExecucaoRepository.js';
import LotePagamentoRepository from '../../repository/sispag/LotePagamentoRepository.js';
import RemessaExecucaoRepository from '../../repository/sispag/RemessaExecucaoRepository.js';
import PagamentoIngestaoRunRepository from '../../repository/sispag/PagamentoIngestaoRunRepository.js';
import TituloAPagarRepository from '../../repository/sispag/TituloAPagarRepository.js';
import LogService from '../LogService.js';

const DAY_MS = 24 * 60 * 60 * 1000;
/** Nº máx. de títulos devolvidos ao painel (evita payload gigante). */
/**
 * Teto do payload de títulos. É GUARDA-RAIL, não limite de trabalho.
 *
 * Era 400 — e 400 é menos que a carteira (1511 títulos hoje), então a tela mostrava
 * "Todos (400)" ao lado de um KPI dizendo "1.225 a vencer em 30 dias". Pior que a
 * contradição: os títulos além do 400º eram INALCANÇÁVEIS para quem monta lote, sem
 * nenhum sinal de que existiam. Medido: a carteira inteira serializa ~410 KB (278 B por
 * título), o que não justifica cortar alcançabilidade.
 *
 * A resposta agora carrega `titulosTotal` para que a UI possa dizer que cortou. Corte
 * sem aviso é o que transformou um limite de payload num bug de negócio.
 */
const TITULOS_CAP = 5000;

/** Idade a partir da qual uma execução `reconciling` deixa de ser "em voo" e vira órfã. */
const MINUTOS_ORFAO = 15;
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
        @inject(RemessaExecucaoRepository)
        private readonly remessaLedger: RemessaExecucaoRepository,
        @inject(ConciliacaoExecucaoRepository)
        private readonly conciliacaoLedger: ConciliacaoExecucaoRepository,
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
        const titulosTotal = titulosPreparados.length;

        // Execuções presas — a MESMA consulta do reaper, mas entregue a quem pode agir.
        // Um WARN no log do Render é lido por quem abre o log, ou seja: ninguém, por
        // hábito. O órfão continuaria invisível. Aqui ele aparece na tela em que a pessoa
        // gera remessa, que é onde a decisão de repetir ou não vai ser tomada.
        const execucoesParadas = await this.contarExecucoesParadas();
        const envVars = await this.env.getEnvironmentVars();

        await this.logService.info({
            type: LOG_TYPE.BUSINESS_INFO,
            message: 'SISPAG painel (read-only) montado',
            data: {
                filiais: filCods.length,
                titulos: titulos.length,
                titulosTotal,
                truncado: titulosTotal > titulos.length,
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
            titulosTotal,
            execucoesParadas,
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
        //
        // Em DUAS FASES porque a conta é do FAVORECIDO, não do título, e um lote repete
        // favorecido (várias parcelas do mesmo fornecedor). Consultar por título faria N
        // chamadas idênticas ao mesmo `pesCod`; a fase 2 faz uma por par DISTINTO.
        const titulosSettled = await this.bounded.run(
            lote.itens,
            (it) => this.sispag.getTituloAPagar(it.filCod, it.docCod, it.titCod),
            CONEXOS_FANOUT_LIMIT,
        );
        const titulos = titulosSettled.map((s) => (s.status === 'fulfilled' ? s.value : null));

        // `filCod` entra na chave porque a chamada ao Conexos é por filial — o mesmo
        // favorecido em duas filiais são duas consultas, não uma.
        const chaveFavorecido = (filCod: number, pesCod: string): string => `${filCod}:${pesCod}`;
        const favorecidos = new Map<string, { pesCod: string; filCod: number }>();
        titulos.forEach((titulo, i) => {
            if (!titulo?.pesCod) return;
            const { filCod } = lote.itens[i];
            favorecidos.set(chaveFavorecido(filCod, titulo.pesCod), {
                pesCod: titulo.pesCod,
                filCod,
            });
        });

        const distintos = [...favorecidos.values()];
        const contasSettled = await this.bounded.run(
            distintos,
            (f) => this.sispag.listContasFavorecido(f.pesCod, f.filCod),
            CONEXOS_FANOUT_LIMIT,
        );
        // Consulta que FALHOU ≠ favorecido sem conta: na dúvida não oferece TED/crédito,
        // porque prometer um destino inexistente só estoura mais tarde, no envio.
        const temConta = new Map<string, boolean>();
        distintos.forEach((f, i) => {
            const s = contasSettled[i];
            temConta.set(
                chaveFavorecido(f.filCod, f.pesCod),
                s.status === 'fulfilled' && s.value.length > 0,
            );
        });

        return lote.itens.map((it, i) => {
            const titulo = titulos[i];
            const modalidades = [...(titulo?.modalidadesDisponiveis ?? [])];
            if (titulo?.pesCod && temConta.get(chaveFavorecido(it.filCod, titulo.pesCod))) {
                modalidades.push(MODALIDADE.TED, MODALIDADE.CREDITO_CONTA);
            }
            return { docCod: it.docCod, titCod: it.titCod, modalidades };
        });
    };

    /** Filtra não-pagos, deriva aging e ordena por vencimento (mais urgente 1º). */
    /**
     * Execuções `reconciling` paradas há mais de `MINUTOS_ORFAO`. Duas leituras locais em
     * coluna indexada — barato o bastante para o caminho quente do painel.
     *
     * Falha aqui NÃO derruba o painel: não saber quantos órfãos existem é ruim, mas ficar
     * sem a tela de pagamentos inteira por causa disso seria pior.
     */
    private contarExecucoesParadas = async (): Promise<ExecucoesParadas> => {
        try {
            const [remessa, conciliacao] = await Promise.all([
                this.remessaLedger.listReconcilingParadas(MINUTOS_ORFAO, 50),
                this.conciliacaoLedger.listReconcilingParadas(MINUTOS_ORFAO, 50),
            ]);
            return {
                remessa: remessa.length,
                conciliacao: conciliacao.length,
                desdeMinutos: MINUTOS_ORFAO,
                // O `flpCod` é o que o operador leva para o fin015. Quando é `undefined`,
                // a queda foi antes de registrarmos o número — e isso também é informação.
                lotesNativos: remessa
                    .map((r) => r.nativeFlpCod)
                    .filter((n): n is number => n != null),
            };
        } catch (e) {
            void this.logService.warn({
                type: LOG_TYPE.BUSINESS_WARN,
                message: 'não foi possível contar execuções paradas — painel segue sem o aviso',
                data: { erro: e instanceof Error ? e.message : String(e) },
            });
            return { remessa: 0, conciliacao: 0, desdeMinutos: MINUTOS_ORFAO, lotesNativos: [] };
        }
    };

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
