import { inject, injectable } from 'tsyringe';
import ConexosBaseClient from '../../client/ConexosBaseClient.js';
import {
    CATEGORIAS_TESOURARIA,
    PAINEL_TRANSACOES_CAP,
    PRI_VLD_TIPO_ROTULO,
    ndeEDevida,
    TRANSACAO_BANCARIA_STATUS,
    TRANSACAO_TIPO,
} from '../../interface/recebimentos/constants.js';
import type { TransacaoBancariaStatus } from '../../interface/recebimentos/constants.js';
import type { TransacaoBancaria } from '../../interface/recebimentos/TransacaoBancaria.js';
import {
    PROCESSO_PROVIDER_TOKEN,
    SOLICITACAO_NUMERARIO_EXECUCAO_REPOSITORY_TOKEN,
} from '../../interface/recebimentos/ports.js';
import type {
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
    /** Vazios nesta fatia — Módulos 2 e 5 ainda não existem. */
    recebimentos: [];
    ndes: [];
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

        const [transacoes, porStatus, valorPorStatus, ultimaIngestao] = await Promise.all([
            // ⚠️ `statuses` entra SÓ aqui. `contarKpis` e `somarValorPorStatus` compartilham o mesmo
            // `buildFiltro`, e deixá-lo escorregar para eles faria os KPIs contarem apenas a aba
            // aberta — as contagens dos cards mudariam conforme o analista navega, que é exatamente
            // o erro que a decisão nº 1 deste serviço existe para prevenir.
            this.transacaoRepo.listParaPainel({
                ...filtroBase,
                ...(statuses !== undefined ? { statuses } : {}),
                limit,
            }),
            this.transacaoRepo.contarKpis(filtroBase),
            this.transacaoRepo.somarValorPorStatus(filtroBase),
            this.runRepo.findLatestSuccessFinishedAt(),
        ]);

        const n = (s: string): number => porStatus[s] ?? 0;
        const transacoesComModalidade = await this.enriquecerComFalhas(
            await this.enriquecerComModalidade(transacoes, filCods),
            input.status,
        );

        return {
            geradoEm: new Date().toISOString(),
            fonte: 'banco',
            transacoes: transacoesComModalidade,
            recebimentos: [],
            ndes: [],
            kpis: {
                importadas: n(TRANSACAO_BANCARIA_STATUS.IMPORTADA),
                conciliadas: n(TRANSACAO_BANCARIA_STATUS.CONCILIADA),
                parciais: n(TRANSACAO_BANCARIA_STATUS.PARCIAL),
                filaManual: n(TRANSACAO_BANCARIA_STATUS.MANUAL),
                erro: n(TRANSACAO_BANCARIA_STATUS.ERRO),
                processadas: n(TRANSACAO_BANCARIA_STATUS.PROCESSADA),
                valorNaoAlocado: this.somarValorEmAberto(valorPorStatus),
                // Módulo 5 não existe — nenhuma NDe é emitida ainda.
                ndePendentes: 0,
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
