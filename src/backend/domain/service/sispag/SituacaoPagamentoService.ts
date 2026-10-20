import { inject, injectable } from 'tsyringe';
import { LOG_TYPE } from '../../interface/log/LogInterface.js';
import type { DuplicateHoldOrigin, TituloAPagar } from '../../interface/sispag/SispagInterface.js';
import {
    FONTE_SITUACAO,
    type FonteSituacao,
    type ResumoSituacao,
    type SituacaoPagamento,
} from '../../interface/sispag/SituacaoPagamento.js';
import type { SituacaoSugestaoTitulo } from '../../interface/sispag/SugestaoBoleto.js';
import type { EtapaAjuste } from '../../libs/boleto/EtapaAjusteCentavos.js';
import ModoVinculoCodigoBarras, {
    type ModoVinculo,
} from '../../libs/boleto/ModoVinculoCodigoBarras.js';
import EnvironmentProvider from '../../libs/environment/EnvironmentProvider.js';
import AjusteCentavosExecucaoRepository from '../../repository/sispag/AjusteCentavosExecucaoRepository.js';
import BloqueioDuplicidadeRepository from '../../repository/sispag/BloqueioDuplicidadeRepository.js';
import LogService from '../LogService.js';
import BoletoSuggestionService from './BoletoSuggestionService.js';
import SituacaoPagamentoResolver, {
    type ContextoSituacaoPagamento,
} from './SituacaoPagamentoResolver.js';

const chaveDe = (t: { filCod: number; docCod: string; titCod: string }): string =>
    `${t.filCod}:${t.docCod}:${t.titCod}`;

/**
 * Fontes de contexto da situação de pagamento. Cada uma pode falhar sozinha: a falha vira
 * `undefined` (a fonte não aplica os motivos dela) e entra em `fontesIndisponiveis` — a tela avisa
 * "situação incompleta". Nunca silencia: era assim que o badge "falta cadastro?" morreu.
 */
interface ContextoCarregado {
    contexto: ContextoSituacaoPagamento;
    fontesIndisponiveis: FonteSituacao[];
}

/**
 * SituacaoPagamentoService (ADR-0075): lê o contexto (bloqueios, ajuste de centavos, desfecho de
 * boleto, modo do vínculo) e aplica o `SituacaoPagamentoResolver`. É o único ponto que o painel, a
 * inclusão manual no lote e a formação automática usam para saber se um título é pagável.
 */
@injectable()
export default class SituacaoPagamentoService {
    public constructor(
        @inject(SituacaoPagamentoResolver) private readonly resolver: SituacaoPagamentoResolver,
        @inject(BloqueioDuplicidadeRepository)
        private readonly bloqueioRepo: BloqueioDuplicidadeRepository,
        @inject(AjusteCentavosExecucaoRepository)
        private readonly ajusteRepo: AjusteCentavosExecucaoRepository,
        @inject(BoletoSuggestionService) private readonly boleto: BoletoSuggestionService,
        @inject(EnvironmentProvider) private readonly env: EnvironmentProvider,
        @inject(LogService) private readonly logService: LogService,
    ) {}

    /** Lê uma fonte; falha vira `undefined` + registro da fonte indisponível. */
    private ler = async <T>(
        fonte: FonteSituacao,
        indisponiveis: FonteSituacao[],
        leitura: () => Promise<T>,
    ): Promise<T | undefined> => {
        try {
            return await leitura();
        } catch (error) {
            indisponiveis.push(fonte);
            await this.logService.warn({
                type: LOG_TYPE.BUSINESS_WARN,
                message: 'situação de pagamento: fonte indisponível, motivos dela não aplicados',
                data: { fonte, erro: error instanceof Error ? error.message : String(error) },
            });
            return undefined;
        }
    };

    private carregarContexto = async (): Promise<ContextoCarregado> => {
        const fontesIndisponiveis: FonteSituacao[] = [];
        const [bloqueios, ajustes, desfechos, env] = await Promise.all([
            this.ler(FONTE_SITUACAO.DUPLICIDADE, fontesIndisponiveis, async () => {
                const lista = await this.bloqueioRepo.listAtivos();
                return new Map<string, { origem: DuplicateHoldOrigin }>(
                    lista.map((b) => [chaveDe(b), { origem: b.origem }] as const),
                );
            }),
            this.ler(FONTE_SITUACAO.AJUSTE_CENTAVOS, fontesIndisponiveis, () =>
                this.ajusteRepo.listarUltimaEtapaPorTitulo(),
            ),
            this.ler(FONTE_SITUACAO.BOLETO, fontesIndisponiveis, () =>
                this.boleto.situacaoPorTitulo(),
            ),
            // O modo do vínculo só é lido para decidir "boleto confirmado"; falhou ⇒ `off`
            // (fail-closed): a confirmação não destrava nada.
            this.env.getEnvironmentVars().catch(() => undefined),
        ]);
        const mapa = ModoVinculoCodigoBarras.parse(env?.sispagBindCodbarFiliais);
        const live = env?.sispagLiveWriteEnabled === true;
        const modoVinculo = (filCod: number): ModoVinculo =>
            ModoVinculoCodigoBarras.resolverModo(filCod, mapa, live);
        return {
            contexto: {
                ...(bloqueios ? { bloqueios } : {}),
                ...(ajustes ? { ajustes: ajustes as ReadonlyMap<string, EtapaAjuste> } : {}),
                ...(desfechos
                    ? { desfechos: desfechos as ReadonlyMap<string, SituacaoSugestaoTitulo> }
                    : {}),
                modoVinculo,
            },
            fontesIndisponiveis,
        };
    };

    /**
     * Preenche `situacaoPagamento` em cada título (a carteira inteira, antes do corte de payload) e
     * devolve o resumo por estado, motivo e dono.
     */
    public avaliarCarteira = async (titulos: TituloAPagar[]): Promise<ResumoSituacao> => {
        const { contexto, fontesIndisponiveis } = await this.carregarContexto();
        for (const t of titulos) t.situacaoPagamento = this.resolver.avaliar(t, contexto);
        return { ...this.resolver.resumir(titulos), fontesIndisponiveis };
    };

    /**
     * Situação de UM título (inclusão manual no lote). O contexto é o mesmo da carteira: bloqueios e
     * ajustes são consultas pequenas e o desfecho vem do cache da listagem.
     */
    public avaliarUm = async (t: TituloAPagar): Promise<SituacaoPagamento> => {
        const { contexto } = await this.carregarContexto();
        return this.resolver.avaliar(t, contexto);
    };

    /** Avalia vários de uma vez (formação automática, criação por filial), com UM contexto. */
    public avaliarVarios = async (
        titulos: TituloAPagar[],
    ): Promise<Map<string, SituacaoPagamento>> => {
        const { contexto } = await this.carregarContexto();
        return new Map(titulos.map((t) => [chaveDe(t), this.resolver.avaliar(t, contexto)]));
    };
}
