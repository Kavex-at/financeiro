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
import type { TransacaoBancaria } from '../../interface/recebimentos/TransacaoBancaria.js';
import {
    PROCESSO_PROVIDER_TOKEN,
    SOLICITACAO_NUMERARIO_EXECUCAO_REPOSITORY_TOKEN,
} from '../../interface/recebimentos/ports.js';
import type {
    ProcessoProviderInterface,
    SolicitacaoNumerarioExecucaoRepositoryInterface,
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
        conciliadas: number;
        parciais: number;
        filaManual: number;
        erro: number;
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
}

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
        };

        const [transacoes, porStatus, valorPorStatus, ultimaIngestao] = await Promise.all([
            this.transacaoRepo.listParaPainel({ ...filtroBase, limit }),
            this.transacaoRepo.contarKpis(filtroBase),
            this.transacaoRepo.somarValorPorStatus(filtroBase),
            this.runRepo.findLatestSuccessFinishedAt(),
        ]);

        const n = (s: string): number => porStatus[s] ?? 0;
        const transacoesComModalidade = await this.enriquecerComModalidade(transacoes, filCods);

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
                // "A distribuir" = o que entrou e ainda não foi conciliado.
                valorNaoAlocado:
                    (valorPorStatus[TRANSACAO_BANCARIA_STATUS.IMPORTADA] ?? 0) +
                    (valorPorStatus[TRANSACAO_BANCARIA_STATUS.PARCIAL] ?? 0),
                // Módulo 5 não existe — nenhuma NDe é emitida ainda.
                ndePendentes: 0,
            },
            ...(ultimaIngestao !== undefined ? { ultimaIngestao } : {}),
            truncado: transacoesComModalidade.length >= limit,
            categoriasOcultas: categoriasExcluidas,
        };
    };

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
