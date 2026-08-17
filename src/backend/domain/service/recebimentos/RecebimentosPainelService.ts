import { inject, injectable } from 'tsyringe';
import ConexosBaseClient from '../../client/ConexosBaseClient.js';
import ConexosNdeFiscalClient from '../../client/ConexosNdeFiscalClient.js';
import { LOG_TYPE } from '../../interface/log/LogInterface.js';
import LogService from '../LogService.js';
import {
    CATEGORIAS_TESOURARIA,
    FANOUT_LIMIT_RECEBIMENTOS,
    NDE_MOEDA_PADRAO,
    NDE_STATUS_EMISSAO,
    PAINEL_NDE_HIDRATACAO_BUDGET_MS,
    PAINEL_NDE_HIDRATACAO_TIMEOUT_MS,
    PAINEL_NDES_CAP,
    PAINEL_TRANSACOES_CAP,
    PRI_VLD_TIPO_ROTULO,
    ndeEDevida,
    TRANSACAO_BANCARIA_STATUS,
    TRANSACAO_TIPO,
} from '../../interface/recebimentos/constants.js';
import type { TransacaoBancariaStatus } from '../../interface/recebimentos/constants.js';
import type { NdeErpListItem } from '../../interface/recebimentos/NdeFiscal.js';
import type { TransacaoBancaria } from '../../interface/recebimentos/TransacaoBancaria.js';
import {
    NDE_REPOSITORY_TOKEN,
    PROCESSO_PROVIDER_TOKEN,
    SOLICITACAO_NUMERARIO_EXECUCAO_REPOSITORY_TOKEN,
} from '../../interface/recebimentos/ports.js';
import type {
    NdePainelRow,
    NdeRepositoryInterface,
    ProcessoProviderInterface,
    SolicitacaoNumerarioExecucaoRepositoryInterface,
    UltimaFalhaExecucao,
} from '../../interface/recebimentos/ports.js';
import RecebimentoIngestaoRunRepository from '../../repository/recebimentos/RecebimentoIngestaoRunRepository.js';
import TransacaoRepository from '../../repository/recebimentos/TransacaoRepository.js';
import { IndiceModalidadePorCliente } from './preverModalidade.js';

/**
 * Modalidade como o painel a mostra.
 *
 * `previsao: false` = FATO, lido do ledger da alocação executada. `previsao: true` = palpite pelos
 * processos abertos do cliente. A tela PRECISA distinguir os dois: a modalidade decide se sai uma
 * Nota de Débito irreversível, e um palpite pintado como fato convida o analista a confiar nele.
 */
export interface ModalidadeNaTela {
    priVldTipo: number;
    rotulo: string;
    previsao: boolean;
    /** `true` quando a NDe NÃO é devida nessa modalidade (só POR ENCOMENDA emite — ADR-0033). */
    ndeDispensada: boolean;
}

/** Transação do painel: a entidade + o que só a tela precisa. */
export interface TransacaoPainel extends TransacaoBancaria {
    modalidade?: ModalidadeNaTela;
    /** Só preenchida na aba de falhas (ADR-0034) — ver `enriquecerComFalhas`. */
    ultimaFalha?: UltimaFalhaExecucao;
}

/** Resposta do painel de recebimentos. */
export interface RecebimentosPainel {
    geradoEm: string;
    /** `'banco'` sempre — o painel não tem mais caminho de demonstração. */
    fonte: 'banco';
    transacoes: TransacaoPainel[];
    /** Vazio nesta fatia — o Módulo 2 ainda não existe. */
    recebimentos: [];
    /** Aba NDe: as notas emitidas + as que o ERP começou e não terminou. */
    ndes: NdePainelRow[];
    kpis: {
        importadas: number;
        /** Sem writer até o Módulo 2 (motor de matching) — sempre 0 hoje, e fora da tela (ADR-0034). */
        conciliadas: number;
        parciais: number;
        /** Sem writer até o Módulo 2 — sempre 0 hoje, e fora da tela (ADR-0034). */
        filaManual: number;
        erro: number;
        processadas: number;
        valorNaoAlocado: number;
        ndePendentes: number;
    };
    /** Fim da última ingestão BEM-SUCEDIDA (`undefined` se nunca houve). */
    ultimaIngestao?: string;
    /** `true` quando a lista bateu no teto — a UI avisa que há mais. */
    truncado: boolean;
    /** Categorias escondidas por serem movimento de tesouraria, não de cliente. */
    categoriasOcultas: string[];
}

export interface MontarPainelInput {
    /** Filiais que o usuário pode ver; `undefined` = todas as do ERP. */
    filCodsPermitidas?: number[];
    limit?: number;
    /** `true` inclui o ruído de tesouraria (resgates, aplicações, transferências internas). */
    incluirTesouraria?: boolean;
    /**
     * `true` = a aba de REVISÃO das arquivadas (ADR-0033). Ausente/`false` = carteira ativa.
     *
     * Não é "incluir também": arquivar existe para tirar da frente, então misturar as duas devolveria
     * o ruído que o analista acabou de esconder. Ver as duas listas exige duas leituras.
     */
    arquivadas?: boolean;
    /**
     * Filtro de status da LISTA (ADR-0034). `'pendentes'` = tudo que não é `processada` (o default
     * da tela); `'todas'`/ausente não filtra.
     *
     * Server-side de propósito: o filtro client-side rodava sobre a página já capada em 500 linhas,
     * então uma falha antiga simplesmente não aparecia na aba de falhas. De quebra, a fila de
     * trabalho para de gastar o teto com histórico já processado.
     */
    status?: PainelStatusFiltro;
}

/** Valores aceitos no filtro de status do painel — os 6 do enum + os dois agregados da tela. */
export type PainelStatusFiltro = 'todas' | 'pendentes' | TransacaoBancariaStatus;

/**
 * RecebimentosPainelService — monta o painel a partir do BANCO (não do ERP).
 *
 * Espelha o `SispagPainelService`. Três decisões que importam:
 *
 * 1. **KPIs vêm de `COUNT(*) GROUP BY status`, não da lista.** Com o teto de
 *    `PAINEL_TRANSACOES_CAP`, KPIs derivados da página contariam 500 de 1.759 e
 *    mentiriam para o analista.
 * 2. **Ruído de tesouraria é escondido, não apagado.** Em produção, ~15% dos
 *    créditos são RESGATE DE APLICAÇÃO / AÇÕES / TRANSFERÊNCIA ENTRE CONTAS —
 *    movimento da própria Columbia. O filtro é de apresentação e reversível.
 * 3. **`ultimaIngestao` só conta run `success`.** Uma run `partial` deixou a
 *    carteira incompleta; anunciar "carteira de HH:mm" nesse caso seria mentira.
 */
@injectable()
export default class RecebimentosPainelService {
    public constructor(
        @inject(TransacaoRepository) private readonly transacaoRepo: TransacaoRepository,
        @inject(RecebimentoIngestaoRunRepository)
        private readonly runRepo: RecebimentoIngestaoRunRepository,
        @inject(ConexosBaseClient) private readonly base: ConexosBaseClient,
        @inject(PROCESSO_PROVIDER_TOKEN)
        private readonly processoProvider: ProcessoProviderInterface,
        @inject(SOLICITACAO_NUMERARIO_EXECUCAO_REPOSITORY_TOKEN)
        private readonly execucaoRepo: SolicitacaoNumerarioExecucaoRepositoryInterface,
        @inject(NDE_REPOSITORY_TOKEN) private readonly ndeRepo: NdeRepositoryInterface,
        @inject(ConexosNdeFiscalClient) private readonly fiscalClient: ConexosNdeFiscalClient,
        @inject(LogService) private readonly logService: LogService,
    ) {}

    public montarPainel = async (input: MontarPainelInput = {}): Promise<RecebimentosPainel> => {
        const filCods = await this.resolverFilCods(input.filCodsPermitidas);
        const limit = Math.min(input.limit ?? PAINEL_TRANSACOES_CAP, PAINEL_TRANSACOES_CAP);
        const categoriasExcluidas = input.incluirTesouraria ? [] : [...CATEGORIAS_TESOURARIA];

        const filtroBase = {
            filCods,
            tipos: [TRANSACAO_TIPO.CREDITO],
            categoriasExcluidas,
            // Vai para list E para os KPIs — os dois têm que concordar sobre o que existe.
            ...(input.arquivadas === true ? { arquivadas: true } : {}),
            // Transferência entre contas da casa segue o MESMO botão do ruído de
            // tesouraria: é a mesma natureza de movimento, só que discriminada pelo
            // remetente e não pela categoria.
            incluirTransferenciasInternas: input.incluirTesouraria === true,
        };

        const statuses = this.resolverStatuses(input.status);

        const [transacoes, porStatus, valorPorStatus, ultimaIngestao, ndesDoBanco, ndePendentes] =
            await Promise.all([
                // ⚠️ `statuses` entra SÓ aqui. `contarKpis` e `somarValorPorStatus` compartilham o
                // mesmo `buildFiltro`, e deixá-lo escorregar para eles faria os KPIs contarem apenas
                // a aba aberta — as contagens dos cards mudariam conforme o analista navega, que é
                // exatamente o erro que a decisão nº 1 deste serviço existe para prevenir.
                this.transacaoRepo.listParaPainel({
                    ...filtroBase,
                    ...(statuses !== undefined ? { statuses } : {}),
                    limit,
                }),
                this.transacaoRepo.contarKpis(filtroBase),
                this.transacaoRepo.somarValorPorStatus(filtroBase),
                this.runRepo.findLatestSuccessFinishedAt(),
                // A aba NDe tem teto próprio e NÃO herda o filtro de status da carteira: os dois
                // recortes são de entidades diferentes (crédito x documento fiscal).
                this.ndeRepo.listParaPainel({ filCods, limit: PAINEL_NDES_CAP }),
                this.ndeRepo.contarPendentes({ filCods }),
            ]);

        const n = (s: string): number => porStatus[s] ?? 0;
        const transacoesComModalidade = await this.enriquecerComFalhas(
            await this.enriquecerComModalidade(transacoes, filCods),
            input.status,
        );
        const ndes = await this.hidratarNdes(ndesDoBanco, filCods);

        return {
            geradoEm: new Date().toISOString(),
            fonte: 'banco',
            transacoes: transacoesComModalidade,
            recebimentos: [],
            ndes: ndes.linhas,
            kpis: {
                importadas: n(TRANSACAO_BANCARIA_STATUS.IMPORTADA),
                conciliadas: n(TRANSACAO_BANCARIA_STATUS.CONCILIADA),
                parciais: n(TRANSACAO_BANCARIA_STATUS.PARCIAL),
                filaManual: n(TRANSACAO_BANCARIA_STATUS.MANUAL),
                erro: n(TRANSACAO_BANCARIA_STATUS.ERRO),
                processadas: n(TRANSACAO_BANCARIA_STATUS.PROCESSADA),
                valorNaoAlocado: this.somarValorEmAberto(valorPorStatus),
                // COUNT do banco (doutrina 1) menos o que ESTE request acabou de reconciliar: o
                // COUNT foi tirado antes da hidratação, então sem o desconto o card contaria como
                // pendente uma NDe que a própria tela já mostra autorizada.
                // COUNT do banco (doutrina 1) menos o que ESTE request reconciliou, MAIS as NDes
                // que só existem no ERP e ainda não foram autorizadas. As externas não podem sair do
                // banco (não há linha nossa), e o grid não é uma página — é a família inteira da
                // filial —, então contá-las em memória é exato, não uma estimativa.
                ndePendentes:
                    Math.max(0, ndePendentes - ndes.reconciliadas) + ndes.externasPendentes,
            },
            ...(ultimaIngestao !== undefined ? { ultimaIngestao } : {}),
            truncado: transacoesComModalidade.length >= limit,
            categoriasOcultas: categoriasExcluidas,
        };
    };

    /**
     * Traduz o filtro da tela para a lista de status do repositório.
     *
     * `'pendentes'` é o default da carteira (ADR-0033 D6): a tabela é uma FILA DE TRABALHO, não um
     * histórico — o que o analista abre para ver é o que falta fazer. Enumerar "tudo menos
     * `processada`" em vez de negar no SQL mantém o `buildFiltro` com uma única forma de filtrar.
     */
    private resolverStatuses = (
        filtro?: PainelStatusFiltro,
    ): TransacaoBancariaStatus[] | undefined => {
        if (filtro === undefined || filtro === 'todas') return undefined;
        if (filtro === 'pendentes') {
            return Object.values(TRANSACAO_BANCARIA_STATUS).filter(
                (s) => s !== TRANSACAO_BANCARIA_STATUS.PROCESSADA,
            );
        }
        return [filtro];
    };

    /**
     * Anexa a última falha de cada crédito — SÓ na aba de falhas (ADR-0034).
     *
     * Condicionado ao filtro de propósito: o painel normal não deve pagar uma query a mais por uma
     * coluna que ele não mostra. Degrada como o enriquecimento de modalidade: um ledger indisponível
     * tira a coluna, nunca a carteira.
     */
    private enriquecerComFalhas = async (
        transacoes: TransacaoPainel[],
        filtro?: PainelStatusFiltro,
    ): Promise<TransacaoPainel[]> => {
        if (filtro !== TRANSACAO_BANCARIA_STATUS.ERRO || transacoes.length === 0) return transacoes;

        const falhas = await this.execucaoRepo
            .listUltimaFalhaPorTxnIds(transacoes.map((t) => t.id))
            .catch(() => new Map<string, UltimaFalhaExecucao>());

        return transacoes.map((t) => {
            const falha = falhas.get(t.id);
            return falha === undefined ? t : { ...t, ultimaFalha: falha };
        });
    };

    /**
     * "A distribuir" = Σ (valor de face − já alocado) de tudo que NÃO chegou ao terminal (ADR-0034).
     *
     * Duas escolhas que valem explicação:
     *
     *  - **Subtrai o alocado.** Antes somava o valor de face de `importada` + `parcial`. Como nada
     *    saía de `importada`, todo crédito já baixado no Conexos continuava contando integralmente
     *    como "a distribuir". Com a máquina de estados viva a distorção mudaria de lugar mas não
     *    sumiria: um crédito rotulado `parcial` na tabela apareceria no KPI pelo valor cheio, com o
     *    painel se contradizendo na mesma tela.
     *  - **Todo status menos `processada`, e não uma lista fixa.** Um crédito em `erro` ou `manual`
     *    tem dinheiro esperando alocação tanto quanto um `importada` — enumerar status faria o número
     *    cair silenciosamente assim que uma linha transicionasse.
     *
     * O corte em zero é feito POR CRÉDITO, no SQL (`GREATEST(valor - alocado, 0)`), e não aqui sobre
     * os totais do grupo: um crédito sobre-alocado geraria saldo negativo que cancelaria o saldo
     * aberto de outro crédito do mesmo status, escondendo dinheiro que ainda precisa ser distribuído.
     */
    private somarValorEmAberto = (
        valorPorStatus: Record<string, { total: number; alocado: number; emAberto: number }>,
    ): number =>
        Object.entries(valorPorStatus)
            .filter(([status]) => status !== TRANSACAO_BANCARIA_STATUS.PROCESSADA)
            .reduce((soma, [, v]) => soma + v.emAberto, 0);

    /**
     * Preenche a coluna de modalidade (ADR-0033), com DUAS fontes de qualidade diferente:
     *
     *  1. **Fato** — para crédito já alocado, a modalidade gravada no ledger daquela execução.
     *  2. **Previsão** — para o resto, o palpite pelos processos abertos do cliente que aparenta ter
     *     pago. Só quando o cliente tem UMA modalidade; ambíguo vira ausência.
     *
     * O fato SEMPRE vence a previsão. Nunca inventa: sem casamento, a linha volta sem `modalidade` e
     * a tela mostra "—".
     *
     * NÃO derruba o painel. A previsão depende do `imp021`; um ERP fora do ar não pode apagar a
     * carteira do analista, então a falha degrada para "sem coluna" e o resto da tela segue de pé.
     */
    private enriquecerComModalidade = async (
        transacoes: TransacaoBancaria[],
        filCods: number[],
    ): Promise<TransacaoPainel[]> => {
        if (transacoes.length === 0) return [];

        const reais = await this.execucaoRepo
            .listModalidadePorTxnIds(transacoes.map((t) => t.id))
            .catch(() => new Map<string, { priVldTipo?: number; ndeDispensada?: boolean }>());

        const indice = await this.construirIndicePrevisao(filCods);

        return transacoes.map((t) => {
            const real = reais.get(t.id);
            if (real?.priVldTipo !== undefined) {
                return {
                    ...t,
                    modalidade: {
                        priVldTipo: real.priVldTipo,
                        rotulo: PRI_VLD_TIPO_ROTULO[real.priVldTipo] ?? `Tipo ${real.priVldTipo}`,
                        previsao: false,
                        ndeDispensada: real.ndeDispensada ?? false,
                    },
                };
            }
            const prevista = indice?.prever(t.contraparte);
            if (prevista === undefined) return t;
            return {
                ...t,
                modalidade: {
                    priVldTipo: prevista.priVldTipo,
                    rotulo: prevista.rotulo,
                    previsao: true,
                    // Derivada da regra atual, e não do histórico: para um crédito que AINDA não foi
                    // processado, o que vale é o que aconteceria se ele fosse processado hoje.
                    ndeDispensada: !ndeEDevida(prevista.priVldTipo),
                },
            };
        });
    };

    /**
     * Hidrata a aba NDe com o estado ATUAL do ERP, lendo o GRID do com297 (`POST com297/list`).
     *
     * Por que existe: a autorização do SEFAZ é ASSÍNCRONA. Na hora da homologação o `vldAutorizado`
     * ainda é `0` e o número da NF-e normalmente nem veio — o banco guarda o retrato daquele
     * instante. Sem reler, a aba mostraria "aguardando SEFAZ" para sempre.
     *
     * **1 POST por filial, não 1 GET por linha.** O grid devolve `vldAutorizado` e `docEspNumero` de
     * toda a família NDe de uma vez (`tpdCod#EQ` — código, nunca nome; ver `constants.ts`). Isso
     * elimina o custo que a primeira versão tinha (até 20 GETs por carga) e, de brinde, faz aparecer
     * o que o banco local NÃO conhece: as NDes emitidas **fora** da ferramenta.
     *
     * Três limites deliberados:
     *  1. **Fan-out limitado** a `FANOUT_LIMIT_RECEBIMENTOS` filiais em paralelo — o mesmo teto da
     *     ingestão (mitigação do incidente `LOGIN_ERROR_MAX_SESSIONS`).
     *  2. **Prazo por leitura + orçamento da fase.** A leitura roda sob `runWithRetry` com axios a 40s
     *     POR TENTATIVA; sem prazo, uma filial pendurada seguraria o painel por minutos.
     *  3. **Best-effort** — mesma doutrina de `enriquecerComModalidade`: ERP fora do ar degrada para
     *     "o que o banco sabe" e nunca derruba a carteira. Mas nunca em silêncio: `logService.warn`.
     *
     * Também RECONCILIA: quando o SEFAZ autorizou, grava o número na NDe e SÓ ENTÃO o flag no ledger.
     */
    private hidratarNdes = async (
        ndes: NdePainelRow[],
        filCods: number[],
    ): Promise<{ linhas: NdePainelRow[]; reconciliadas: number; externasPendentes: number }> => {
        const doErp = await this.lerNdesDoErp(filCods);
        if (doErp === undefined) {
            return { linhas: ndes, reconciliadas: 0, externasPendentes: 0 };
        }

        const porDocCod = new Map<number, NdeErpListItem>(doErp.map((n) => [n.docCod, n]));
        const linhas: NdePainelRow[] = [];
        let reconciliadas = 0;

        for (const nde of ndes) {
            const erp = nde.ndDocCod !== undefined ? porDocCod.get(nde.ndDocCod) : undefined;
            if (erp === undefined) {
                linhas.push(nde);
                continue;
            }
            porDocCod.delete(erp.docCod); // consumida: não é "externa"
            // `vldAutorizado === 0` é "SEFAZ ainda não respondeu", não falha.
            const autorizado = erp.vldAutorizado !== undefined && erp.vldAutorizado !== 0;
            const numeroNde = erp.docEspNumero ?? nde.numeroNde;
            linhas.push({
                ...nde,
                ...(numeroNde !== undefined ? { numeroNde } : {}),
                ...(erp.priCod !== undefined ? { priCod: erp.priCod } : {}),
                ...(erp.processoRef !== undefined ? { processoRef: erp.processoRef } : {}),
                ...(erp.cliente !== undefined ? { cliente: erp.cliente } : {}),
                ndeAutorizado: autorizado,
            });
            // Só reconcilia o que MUDOU — sem isso, cada carga de painel reescreveria o ledger inteiro.
            if (autorizado && nde.ndeAutorizado !== true) {
                await this.reconciliar(nde, numeroNde);
                reconciliadas += 1;
            }
        }

        // O que sobrou no mapa existe no ERP e NÃO tem execução nossa: emitida fora da ferramenta.
        const externas = [...porDocCod.values()].map((erp) => this.linhaDoErp(erp));
        return {
            linhas: [...linhas, ...externas],
            reconciliadas,
            externasPendentes: externas.filter((n) => n.ndeAutorizado !== true).length,
        };
    };

    /**
     * Lê o grid de todas as filiais permitidas. `undefined` = não deu para ler NADA (ERP fora do ar):
     * o caller devolve a aba com o estado do banco, sem inventar "não há NDe externa".
     *
     * Uma filial que falha isoladamente NÃO zera as outras — a aba parcial vale mais que a aba vazia,
     * desde que a falha apareça no log.
     */
    private lerNdesDoErp = async (filCods: number[]): Promise<NdeErpListItem[] | undefined> => {
        const prazoFinal = Date.now() + PAINEL_NDE_HIDRATACAO_BUDGET_MS;
        const acumulado: NdeErpListItem[] = [];
        let algumaOk = false;

        for (let i = 0; i < filCods.length; i += FANOUT_LIMIT_RECEBIMENTOS) {
            if (Date.now() >= prazoFinal) {
                await this.logService.warn({
                    type: LOG_TYPE.BUSINESS_WARN,
                    message:
                        'Hidratação da aba NDe interrompida pelo orçamento de tempo — as filiais ' +
                        'restantes voltam com o estado do banco (o próximo load retoma)',
                    data: {
                        filiais: filCods.length,
                        lidas: i,
                        budgetMs: PAINEL_NDE_HIDRATACAO_BUDGET_MS,
                    },
                });
                break;
            }
            const lote = filCods.slice(i, i + FANOUT_LIMIT_RECEBIMENTOS);
            const resultados = await Promise.all(
                lote.map((filCod) => this.lerFilialComPrazo(filCod)),
            );
            for (const r of resultados) {
                if (r === undefined) continue;
                algumaOk = true;
                acumulado.push(...r);
            }
        }
        return algumaOk ? acumulado : undefined;
    };

    /**
     * Grid de UMA filial com prazo. O `Promise.race` NÃO cancela o HTTP em curso (o axios segue até o
     * próprio timeout dele) — o que ele garante é que o painel não fica preso esperando. O `.catch` no
     * promise original evita unhandled rejection quando o prazo vence primeiro.
     */
    private lerFilialComPrazo = async (filCod: number): Promise<NdeErpListItem[] | undefined> => {
        const leitura = this.fiscalClient.listNdes({ filCod }).catch((cause: unknown) => {
            void this.logService.warn({
                type: LOG_TYPE.BUSINESS_WARN,
                message: 'Hidratação da aba NDe: falha ao ler o grid do com297',
                data: { filCod, cause: String(cause) },
            });
            return undefined;
        });
        const prazo = new Promise<undefined>((resolve) => {
            const t = setTimeout(() => resolve(undefined), PAINEL_NDE_HIDRATACAO_TIMEOUT_MS);
            // `unref` para o timer não segurar o event loop se a resposta vier antes.
            if (typeof t.unref === 'function') t.unref();
        });
        return Promise.race([leitura, prazo]);
    };

    /**
     * Projeta uma NDe que existe SÓ no ERP — ninguém a emitiu pela ferramenta.
     *
     * Ela não tem `correlationId`, `idempotencyKey`, `etapa` nem transação bancária, e a tela precisa
     * dizer isso em vez de fingir rastro: a identidade dela é cliente + processo. `statusEmissao` é
     * `emitida` porque o documento existe no com297 — o que falta é o nosso registro, não a nota.
     */
    private linhaDoErp = (erp: NdeErpListItem): NdePainelRow => ({
        id: `erp:${erp.filCod}:${erp.docCod}`,
        origem: 'erp',
        filCod: erp.filCod,
        valor: erp.valor ?? 0,
        moeda: NDE_MOEDA_PADRAO,
        statusEmissao: NDE_STATUS_EMISSAO.EMITIDA,
        ndDocCod: erp.docCod,
        ndeAutorizado: erp.vldAutorizado !== undefined && erp.vldAutorizado !== 0,
        ...(erp.docEspNumero !== undefined ? { numeroNde: erp.docEspNumero } : {}),
        ...(erp.emitidaEm !== undefined ? { emitidaEm: erp.emitidaEm } : {}),
        ...(erp.priCod !== undefined ? { priCod: erp.priCod } : {}),
        ...(erp.processoRef !== undefined ? { processoRef: erp.processoRef } : {}),
        ...(erp.cliente !== undefined ? { cliente: erp.cliente } : {}),
    });

    /**
     * Escrita LOCAL de reconciliação (nada vai para o ERP): o painel é o poll que a homologação não
     * pôde esperar.
     *
     * A ORDEM é a garantia: grava o número PRIMEIRO e o flag DEPOIS. O flag é o ponto de commit —
     * enquanto ele não está gravado, a linha continua candidata à hidratação. Na ordem inversa, uma
     * falha ao gravar o número deixaria a linha autorizada e sem número PARA SEMPRE, porque ela já
     * teria saído do filtro de candidatas.
     */
    private reconciliar = async (nde: NdePainelRow, numeroNde?: string): Promise<void> => {
        const idempotencyKey = nde.idempotencyKey;
        // Sem chave nossa não há o que reconciliar: é uma NDe emitida fora da ferramenta, e o ERP já
        // é a fonte da verdade dela. O caller nunca chega aqui nesse caso; o guard é a prova disso.
        if (idempotencyKey === undefined) return;
        if (numeroNde !== undefined && numeroNde !== nde.numeroNde) {
            try {
                await this.ndeRepo.updateNumeroNde(idempotencyKey, numeroNde);
            } catch (cause) {
                await this.logService.warn({
                    type: LOG_TYPE.BUSINESS_WARN,
                    message:
                        'Hidratação da aba NDe: falha ao gravar o número da NDe — o flag de ' +
                        'autorização NÃO será gravado, para a linha seguir candidata no próximo load',
                    data: { idempotencyKey, numeroNde, cause: String(cause) },
                });
                return;
            }
        }
        try {
            await this.execucaoRepo.setNdeAutorizado(idempotencyKey, true);
        } catch (cause) {
            await this.logService.warn({
                type: LOG_TYPE.BUSINESS_WARN,
                message: 'Hidratação da aba NDe: falha ao gravar o flag de autorização no ledger',
                data: { idempotencyKey, cause: String(cause) },
            });
        }
    };

    /** Índice de previsão sobre os processos abertos das filiais permitidas (tudo do cache). */
    private construirIndicePrevisao = async (
        filCods: number[],
    ): Promise<IndiceModalidadePorCliente | undefined> => {
        try {
            const porFilial = await Promise.all(
                filCods.map((f) => this.processoProvider.listProcessosDaFilial(f)),
            );
            return new IndiceModalidadePorCliente(porFilial.flat());
        } catch {
            return undefined;
        }
    };

    /** Filiais permitidas, ou todas as do ERP quando o usuário não tem allow-list. */
    private resolverFilCods = async (permitidas?: number[]): Promise<number[]> => {
        if (permitidas && permitidas.length > 0) return permitidas;
        const filiais = await this.base.getFiliais();
        return filiais.map((f) => Number(f.filCod)).filter((n) => Number.isInteger(n) && n > 0);
    };
}
