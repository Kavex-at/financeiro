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
import BankingCalendar from '../../libs/calendar/BankingCalendar.js';
import EnvironmentProvider from '../../libs/environment/EnvironmentProvider.js';
import AjusteCentavosExecucaoRepository from '../../repository/sispag/AjusteCentavosExecucaoRepository.js';
import BloqueioDuplicidadeRepository from '../../repository/sispag/BloqueioDuplicidadeRepository.js';
import TituloAPagarRepository from '../../repository/sispag/TituloAPagarRepository.js';
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

/** Desfecho da avaliação na inclusão (I19s): só `AVALIADA` traz uma situação. */
export const AVALIACAO_INCLUSAO = {
    AVALIADA: 'AVALIADA',
    FORA_DA_CARTEIRA: 'FORA_DA_CARTEIRA',
    LEITURA_FALHOU: 'LEITURA_FALHOU',
} as const;

export type AvaliacaoInclusao =
    | {
          resultado: typeof AVALIACAO_INCLUSAO.AVALIADA;
          situacao: SituacaoPagamento;
          fontesIndisponiveis: FonteSituacao[];
      }
    | {
          resultado:
              | typeof AVALIACAO_INCLUSAO.FORA_DA_CARTEIRA
              | typeof AVALIACAO_INCLUSAO.LEITURA_FALHOU;
      };

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
        @inject(TituloAPagarRepository) private readonly tituloRepo: TituloAPagarRepository,
        @inject(BankingCalendar) private readonly calendar: BankingCalendar,
    ) {}

    /** Aging por dia civil quando o título ainda não o tem (a carteira do painel já vem com ele). */
    private comAging = (t: TituloAPagar): TituloAPagar =>
        t.diasAteVencimento !== undefined || t.vencimento === undefined
            ? t
            : { ...t, diasAteVencimento: this.calendar.diasAteVencimento(t.vencimento) };

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
        // Título em lote FINALIZADO/REMESSA_GERADA já está comprometido (ADR-0064): não é "pronto
        // para pagar" nem "precisa de ação", e a tabela o esconde por padrão. Fora das contagens,
        // senão os cards mostrariam mais prontos do que a tela deixa selecionar.
        const disponiveis = titulos.filter((t) => t.loteComprometido === undefined);
        return { ...this.resolver.resumir(disponiveis), fontesIndisponiveis };
    };

    /** Avalia vários de uma vez (formação automática, criação por filial), com UM contexto. */
    public avaliarVarios = async (
        titulos: TituloAPagar[],
    ): Promise<Map<string, SituacaoPagamento>> => {
        const { contexto } = await this.carregarContexto();
        return new Map(
            titulos.map((t) => [chaveDe(t), this.resolver.avaliar(this.comAging(t), contexto)]),
        );
    };

    /**
     * Situação de um título na INCLUSÃO no lote (manual ou por filial): a carteira persistida dá
     * tipo, forma e boleto; a leitura ao vivo do `fin064` (`vivo`) dá o que muda a cada minuto —
     * aprovação, pagamento e vencimento.
     *
     * I19s: a inclusão é fail-closed. Sem a linha persistida (título criado ou alterado no Conexos
     * depois da última ingestão) ou com a leitura dela falhando, não há tipo nem forma para avaliar,
     * e o resultado diz isso em vez de deixar o título passar sem a regra. As fontes de contexto que
     * falharem vêm em `fontesIndisponiveis`; quem inclui decide recusar.
     */
    public avaliarVivo = async (
        chave: { filCod: number; docCod: string; titCod: string },
        vivo: Pick<TituloAPagar, 'liberado' | 'pago' | 'vencimento'>,
    ): Promise<AvaliacaoInclusao> => {
        const [avaliacao] = await this.avaliarVivos([{ chave, vivo }]);
        return avaliacao ?? { resultado: AVALIACAO_INCLUSAO.LEITURA_FALHOU };
    };

    /**
     * `avaliarVivo` para vários títulos com UMA leitura da carteira e UM contexto (a guarda da
     * finalização, ADR-0076 I20d). Devolve na ordem da entrada.
     */
    public avaliarVivos = async (
        entradas: ReadonlyArray<{
            chave: { filCod: number; docCod: string; titCod: string };
            vivo: Pick<TituloAPagar, 'liberado' | 'pago' | 'vencimento'>;
        }>,
    ): Promise<AvaliacaoInclusao[]> => {
        if (entradas.length === 0) return [];
        let persistidos: Map<string, TituloAPagar>;
        try {
            const lidos = await this.tituloRepo.buscarPorChaves(entradas.map((e) => e.chave));
            persistidos = new Map(lidos.map((t) => [chaveDe(t), t] as const));
        } catch (error) {
            await this.logService.warn({
                type: LOG_TYPE.BUSINESS_WARN,
                message: 'situação de pagamento: leitura do título falhou, inclusão recusada',
                data: {
                    chaves: entradas.map((e) => chaveDe(e.chave)),
                    erro: error instanceof Error ? error.message : String(error),
                },
            });
            return entradas.map(() => ({ resultado: AVALIACAO_INCLUSAO.LEITURA_FALHOU }));
        }
        const { contexto, fontesIndisponiveis } = await this.carregarContexto();
        return entradas.map(({ chave, vivo }): AvaliacaoInclusao => {
            const persistido = persistidos.get(chaveDe(chave));
            if (!persistido) return { resultado: AVALIACAO_INCLUSAO.FORA_DA_CARTEIRA };
            // O vencimento ao vivo vence o persistido, e o aging é SEMPRE recalculado dele.
            const vencimento = vivo.vencimento ?? persistido.vencimento;
            const titulo: TituloAPagar = {
                ...persistido,
                liberado: vivo.liberado,
                pago: vivo.pago,
                ...(vencimento !== undefined
                    ? {
                          vencimento,
                          diasAteVencimento: this.calendar.diasAteVencimento(vencimento),
                      }
                    : {}),
            };
            return {
                resultado: AVALIACAO_INCLUSAO.AVALIADA,
                situacao: this.resolver.avaliar(titulo, contexto),
                fontesIndisponiveis,
            };
        });
    };

    /**
     * Prontidão dos lotes (ADR-0076 I20a): a situação pela carteira GRAVADA, sem Conexos, para os
     * itens de vários lotes de uma vez. Chave fora do mapa = título fora da carteira.
     */
    public avaliarGravados = async (
        chaves: ReadonlyArray<{ filCod: number; docCod: string; titCod: string }>,
    ): Promise<{
        situacoes: Map<string, SituacaoPagamento>;
        fontesIndisponiveis: FonteSituacao[];
    }> => {
        const titulos = await this.tituloRepo.buscarPorChaves(chaves);
        const { contexto, fontesIndisponiveis } = await this.carregarContexto();
        return {
            situacoes: new Map(
                titulos.map((t) => [chaveDe(t), this.resolver.avaliar(this.comAging(t), contexto)]),
            ),
            fontesIndisponiveis,
        };
    };
}
