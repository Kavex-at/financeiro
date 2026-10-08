import { inject, injectable } from 'tsyringe';
import ConexosBaseClient from '../../client/ConexosBaseClient.js';
import ConexosSispagClient from '../../client/ConexosSispagClient.js';
import ConexosSispagRetornoClient from '../../client/ConexosSispagRetornoClient.js';
import ConexosSispagWriteClient from '../../client/ConexosSispagWriteClient.js';
import BoundedConcurrency from '../../libs/concurrency/BoundedConcurrency.js';
import { LOG_TYPE } from '../../interface/log/LogInterface.js';
import type { ArquivoRetorno } from '../../interface/sispag/Fin052Retorno.js';
import type { LinhasDigitaveisDoLote } from '../../interface/sispag/Fin015Write.js';
import {
    type ItemLote,
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
import DestinoPagamentoResolver, {
    type CacheCadastroDestino,
    DESTINO_CADASTRO_TIPO,
    DESTINO_ORIGEM,
    type DestinoOrigem,
    type DestinoResolvido,
    type FlagsDestino,
} from './DestinoPagamentoResolver.js';

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

/** O destino que a oferta mostra para uma modalidade: origem + máscara, nunca o valor (I10h). */
export interface DestinoOfertado {
    origem: DestinoOrigem;
    destinoMascarado?: string;
    /**
     * Só no PIX (ADR-0054 D12): o destino é uma chave CPF/CNPJ do cadastro que é o próprio
     * documento do favorecido. A tela lista PIX antes de TED. Ausente = sem preferência.
     */
    chaveCpfCnpjDoFavorecido?: true;
}

/** Uma linha da oferta de formas de pagamento de um item do lote. */
export interface OfertaModalidadesItem {
    docCod: string;
    titCod: string;
    modalidades: Modalidade[];
    /** Só com TED/PIX oferecidos (ADR-0054, ADR-0065 I14k). Sem eles o campo não existe. */
    destinos?: Partial<Record<'TED' | 'PIX', DestinoOfertado>>;
}

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
        @inject(ConexosSispagWriteClient) private readonly fin015: ConexosSispagWriteClient,
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
        @inject(DestinoPagamentoResolver) private readonly resolver: DestinoPagamentoResolver,
    ) {}

    public montarPainel = async (): Promise<SispagPainelResponse> => {
        const filiais = await this.base.getFiliais();
        const filCods = filiais
            .map((f) => f.filCod)
            .filter((n): n is number => typeof n === 'number');

        const now = Date.now();

        // TÍTULOS: vêm da carteira PERSISTIDA (ingestão), não mais ao vivo do Conexos.
        const [titulosRaw, ultimaRun, emRascunho, comprometidos] = await Promise.all([
            this.tituloRepo.listAtivos(),
            this.runRepo.findLatestSuccessFinishedAt(),
            this.loteRepo.listTitulosEmRascunho(),
            this.loteRepo.listTitulosEmLotesComprometidos(),
        ]);
        // Marca os títulos já num lote RASCUNHO — o painel bloqueia a seleção (I3, anti-reatache)
        // e a linha mostra/linka o lote (ADR-0050). Mapa por chave natural: O(n) sobre a carteira.
        const chaveDe = (t: { filCod: number; docCod: string; titCod: string }): string =>
            `${t.filCod}:${t.docCod}:${t.titCod}`;
        const loteDe = new Map(
            emRascunho.map((t) => [chaveDe(t), { id: t.loteId, automatico: t.automatico }]),
        );
        // ADR-0064: título em lote FINALIZADO/REMESSA_GERADA não se move — a linha diz onde está.
        // A query ordena do mais antigo ao mais recente: o último a entrar no mapa vence.
        const comprometidoDe = new Map(
            comprometidos.map((t) => [chaveDe(t), { id: t.id, status: t.status }]),
        );
        for (const t of titulosRaw) {
            const lote = loteDe.get(chaveDe(t));
            t.emLote = lote !== undefined;
            if (lote) t.loteRascunho = lote;
            const comprometido = comprometidoDe.get(chaveDe(t));
            if (comprometido) t.loteComprometido = comprometido;
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
     * Linhas digitáveis dos boletos do lote — o que a analista cola no banco para conferir.
     *
     * Só existe depois da remessa gerada: o ERP anexa `itsNumCodbar` ao item durante o
     * `importarTitulos(associarDda)`, que roda dentro da geração (ADR-0040). Em RASCUNHO a
     * resposta é vazia SEM ida ao ERP — não é falha, é o estágio.
     *
     * Nunca lança. Isto alimenta um botão de copiar; derrubar o card do lote inteiro porque o
     * Conexos oscilou seria trocar uma conveniência por uma indisponibilidade. Falha vira
     * `BUSINESS_WARN` e lista vazia — a UI simplesmente não oferece o botão.
     */
    public linhasDigitaveisDoLote = async (loteId: string): Promise<LinhasDigitaveisDoLote> => {
        const vazio: LinhasDigitaveisDoLote = { itens: [], total: 0, dropped: 0 };
        const lote = await this.loteRepo.getLoteComItens(loteId);
        if (!lote) return vazio;
        const { nativeFilCod, nativeBncCod, nativeFlpCod } = lote;
        if (nativeFilCod == null || nativeBncCod == null || nativeFlpCod == null) return vazio;
        try {
            const resultado = await this.fin015.listarLinhasDigitaveisDoLote({
                filCod: nativeFilCod,
                bncCod: nativeBncCod,
                flpCod: nativeFlpCod,
            });
            if (resultado.dropped > 0) {
                // Código de barras recusado é sinal de corrupção no caminho ERP→item, não
                // ruído de UI: sem este log, a única testemunha seria a analista reparando
                // num botão que faltou. Sem a linha em si (identifica beneficiário e valor).
                await this.logService.warn({
                    type: LOG_TYPE.BUSINESS_WARN,
                    message: 'linhasDigitaveisDoLote: linha digitável recusada no boundary',
                    data: {
                        loteId,
                        flpCod: nativeFlpCod,
                        total: resultado.total,
                        dropped: resultado.dropped,
                    },
                });
            }
            return resultado;
        } catch (err) {
            // Sem a linha digitável em si no log — ela identifica beneficiário e valor.
            await this.logService.warn({
                type: LOG_TYPE.BUSINESS_WARN,
                message: 'linhasDigitaveisDoLote: leitura do fin015 falhou',
                data: {
                    loteId,
                    flpCod: nativeFlpCod,
                    motivo: err instanceof Error ? err.message : 'desconhecido',
                },
            });
            return vazio;
        }
    };

    /**
     * A2 opção B — formas de pagamento DISPONÍVEIS por título do lote, lidas AO VIVO do
     * Conexos. Evita o analista escolher uma forma sem cadastro (→ `.REM` rejeitado).
     * Fan-out limitado, tolerante a falha (título sem leitura → lista vazia, o front trata).
     *
     * Fontes, porque o ERP guarda cada coisa num lugar:
     *   BOLETO  → de `titulo_a_pagar.tem_boleto`, que a ingestão preencheu a partir do flag
     *             `titVldReflexoDdaAssoc` do grid de pendentes do `fin015` (o `fin064` não sabe)
     *   TED/PIX → do CADASTRO do favorecido (`cmn025`), pelo MESMO `DestinoPagamentoResolver` do
     *             envio (I10b) — e SÓ com a guarda do favorecido autorizado ligada e a flag da
     *             modalidade ligada (ADR-0065 I14k). Sem isso TED/PIX não são oferecidos.
     *   demais  → o que o `fin064` traz do título, sem TED/PIX.
     */
    public modalidadesDisponiveisDoLote = async (
        loteId: string,
    ): Promise<OfertaModalidadesItem[]> => {
        const lote = await this.loteRepo.getLoteComItens(loteId);
        if (!lote) return [];
        const envVars = await this.env.getEnvironmentVars();
        const guarda = envVars.sispagFavorecidoAutorizadoEnabled === true;
        const flags: FlagsDestino = {
            ted: guarda && envVars.sispagTedEnabled === true,
            pix: guarda && envVars.sispagPixEnabled === true,
        };
        const titulosSettled = await this.bounded.run(
            lote.itens,
            (it) => this.sispag.getTituloAPagar(it.filCod, it.docCod, it.titCod),
            CONEXOS_FANOUT_LIMIT,
        );
        const titulos = titulosSettled.map((s) => (s.status === 'fulfilled' ? s.value : null));

        // BOLETO: lido do BANCO, não do ERP. A ingestão já resolveu o flag de DDA na última
        // rodada; servir dado de ≤ 24 h aqui é seguro (só decide o que o dropdown OFERECE — o
        // envio relê ao vivo, `BoletoSemCodigoBarrasError`). I4: uma filial por lote.
        const filiaisDoLote = [...new Set(lote.itens.map((it) => it.filCod))];
        const comBoleto = new Set<string>();
        for (const filCod of filiaisDoLote) {
            for (const chave of await this.tituloRepo.listChavesComBoleto(filCod)) {
                comBoleto.add(chave);
            }
        }

        const base = (it: ItemLote, i: number): Modalidade[] => {
            const modalidades = (titulos[i]?.modalidadesDisponiveis ?? []).filter(
                (m) => m !== MODALIDADE.TED && m !== MODALIDADE.PIX,
            );
            if (comBoleto.has(`${it.filCod}:${it.docCod}:${it.titCod}`)) {
                modalidades.push(MODALIDADE.BOLETO);
            }
            return modalidades;
        };

        if (!flags.ted && !flags.pix) {
            return lote.itens.map((it, i) => ({
                docCod: it.docCod,
                titCod: it.titCod,
                modalidades: base(it, i),
            }));
        }
        return this.ofertaComResolver(lote.itens, titulos, base, flags);
    };

    /**
     * Oferta com TED e/ou PIX habilitados (ADR-0054; I10b; ADR-0065). A modalidade habilitada é
     * SEMPRE oferecida e vem com a origem (CADASTRO | NENHUM) e a máscara do destino, calculadas
     * pelo `DestinoPagamentoResolver` — o MESMO que o envio chama. Quem decide se o item pode ir é a
     * verificação do favorecido autorizado (selo no item ao escolher, retirada no finalizar).
     *
     * Leitura que falha = origem NENHUM (a verificação fica PENDENTE e barra o finalizar — falha
     * fechada, I13b).
     */
    private ofertaComResolver = async (
        itens: ItemLote[],
        titulos: Array<TituloAPagar | null>,
        base: (it: ItemLote, i: number) => Modalidade[],
        flags: FlagsDestino,
    ): Promise<OfertaModalidadesItem[]> => {
        const cache: CacheCadastroDestino = this.resolver.novoCache();
        const modalidadesNovas = [
            ...(flags.ted ? [MODALIDADE.TED] : []),
            ...(flags.pix ? [MODALIDADE.PIX] : []),
        ] as const;
        const settled = await this.bounded.run(
            itens.map((it, i) => ({ it, pesCod: titulos[i]?.pesCod })),
            async ({ it, pesCod }) => {
                const out: Partial<Record<'TED' | 'PIX', DestinoResolvido>> = {};
                for (const modalidade of modalidadesNovas) {
                    out[modalidade] = await this.resolver
                        .resolve(
                            { modalidade },
                            { flags, filCod: it.filCod, cache, ...(pesCod ? { pesCod } : {}) },
                        )
                        .catch((): DestinoResolvido => ({ origem: DESTINO_ORIGEM.NENHUM }));
                }
                return out;
            },
            CONEXOS_FANOUT_LIMIT,
        );

        return itens.map((it, i) => {
            const resolvidos = settled[i]?.status === 'fulfilled' ? settled[i].value : {};
            const modalidades = base(it, i);
            const destinos: Partial<Record<'TED' | 'PIX', DestinoOfertado>> = {};
            for (const modalidade of modalidadesNovas) {
                const r = resolvidos[modalidade] ?? { origem: DESTINO_ORIGEM.NENHUM };
                modalidades.push(modalidade);
                const mascara = this.resolver.mascarar(r);
                destinos[modalidade] = {
                    origem: r.origem,
                    ...(mascara !== undefined ? { destinoMascarado: mascara } : {}),
                    ...(this.chaveCpfCnpjDoFavorecido(r) ? { chaveCpfCnpjDoFavorecido: true } : {}),
                };
            }
            return { docCod: it.docCod, titCod: it.titCod, modalidades, destinos };
        });
    };

    /** D12: PIX resolvido por chave CPF/CNPJ do cadastro que é o documento do favorecido. */
    private chaveCpfCnpjDoFavorecido = (r: DestinoResolvido): boolean =>
        r.origem === DESTINO_ORIGEM.CADASTRO &&
        r.tipo === DESTINO_CADASTRO_TIPO.CHAVE_PIX &&
        r.chaveDoDocumentoDoFavorecido === true;

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
