import { inject, injectable } from 'tsyringe';
import ConexosBaseClient from '../../client/ConexosBaseClient.js';
import ConexosDdaClient from '../../client/ConexosDdaClient.js';
import PostgreeDatabaseClient from '../../client/database/PostgreeDatabaseClient.js';
import IngestLockBusyError from '../../errors/IngestLockBusyError.js';
import {
    BOLETO_DDA_ESCOPO,
    type ArquivoDda,
    type BoletoDdaConsolidado,
    type BoletoDdaEscopo,
    type BoletoDdaGrupo,
    type BoletosDdaResposta,
    type SincronizacaoDdaResultado,
} from '../../interface/sispag/BoletoDda.js';
import { LOG_TYPE } from '../../interface/log/LogInterface.js';
import BankingCalendar from '../../libs/calendar/BankingCalendar.js';
import BoundedConcurrency from '../../libs/concurrency/BoundedConcurrency.js';
import BoletoDdaRepository from '../../repository/sispag/BoletoDdaRepository.js';
import LotePagamentoRepository from '../../repository/sispag/LotePagamentoRepository.js';
import TituloAPagarRepository from '../../repository/sispag/TituloAPagarRepository.js';
import LogService from '../LogService.js';
import BoletoSuggestionService from './BoletoSuggestionService.js';
import ConsolidacaoBoletoDda from './ConsolidacaoBoletoDda.js';
import { REGRA_CANDIDATO_TEXTO } from './RegraSugestaoBoleto.js';
import SugestaoBoletoCache from './SugestaoBoletoCache.js';
import PaginacaoBoletoDda, {
    BOLETO_DDA_TAMANHO_PADRAO,
    type FiltroPaginaBoletoDda,
} from './PaginacaoBoletoDda.js';

/** Chave de advisory lock EXCLUSIVA da sincronização DDA (≠ das ingestões de permutas/pagamentos). */
export const BOLETO_DDA_SYNC_LOCK_KEY = 726354820;
/** Teto de leituras Conexos simultâneas — o mesmo da ingestão de pagamentos. */
const FANOUT_LIMIT = 3;
/**
 * Arquivos importados nos últimos N dias são RELIDOS a cada sincronização: é neles que o
 * Conexos ainda grava vínculo (boletos a vencer). Arquivo mais antigo é lido uma vez só.
 */
export const RELEITURA_DIAS = 60;

/**
 * BoletoDdaService — aba "Boletos DDA" do SISPAG.
 *
 * `sincronizar`: copia o pool `fin124` para o Postgres (incremental). READ-ONLY no ERP.
 * `listar`: lê o snapshot e consolida contra a carteira (`ConsolidacaoBoletoDda`).
 * Ao fim de toda sincronização invalida o cache das sugestões de boleto (ADR-0068).
 */
@injectable()
export default class BoletoDdaService {
    public constructor(
        @inject(ConexosDdaClient) private readonly dda: ConexosDdaClient,
        @inject(ConexosBaseClient) private readonly base: ConexosBaseClient,
        @inject(BoletoDdaRepository) private readonly repo: BoletoDdaRepository,
        @inject(TituloAPagarRepository) private readonly tituloRepo: TituloAPagarRepository,
        @inject(LotePagamentoRepository) private readonly loteRepo: LotePagamentoRepository,
        @inject(ConsolidacaoBoletoDda) private readonly consolidacao: ConsolidacaoBoletoDda,
        @inject(PaginacaoBoletoDda) private readonly paginacao: PaginacaoBoletoDda,
        @inject(BankingCalendar) private readonly calendar: BankingCalendar,
        @inject(BoundedConcurrency) private readonly bounded: BoundedConcurrency,
        @inject(PostgreeDatabaseClient) private readonly db: PostgreeDatabaseClient,
        @inject(LogService) private readonly logService: LogService,
        @inject(SugestaoBoletoCache) private readonly sugestoesCache: SugestaoBoletoCache,
        // I21v: o grupo (sugerido ou confirmado) de cada boleto, do cenário em cache das sugestões.
        @inject(BoletoSuggestionService) private readonly sugestoes: BoletoSuggestionService,
    ) {}

    /**
     * Uma página da aba. A consolidação roda sobre o escopo inteiro (a situação é derivada, não
     * dá para filtrá-la em SQL), mas só a página filtrada sai para o navegador.
     */
    public listar = async (
        input: { escopo: BoletoDdaEscopo } & Partial<FiltroPaginaBoletoDda>,
    ): Promise<BoletosDdaResposta> => {
        const vencimentoDesde =
            input.escopo === BOLETO_DDA_ESCOPO.A_VENCER ? this.calendar.todayBrt() : undefined;
        const [boletos, titulos, titulosEmLote, sincronizadoEm] = await Promise.all([
            this.repo.listBoletos(vencimentoDesde ? { vencimentoDesde } : {}),
            this.tituloRepo.listAtivos(),
            this.loteRepo.listTitulosEmLotesAbertos(),
            this.repo.ultimaSincronizacao(),
        ]);
        const consolidados = this.comGrupo(
            this.consolidacao.consolidar({ boletos, titulos, titulosEmLote }),
            await this.gruposOuNenhum(),
        );
        const pagina = this.paginacao.paginar(consolidados, {
            pagina: input.pagina ?? 1,
            tamanho: input.tamanho ?? BOLETO_DDA_TAMANHO_PADRAO,
            ...(input.situacao ? { situacao: input.situacao } : {}),
            ...(input.busca ? { busca: input.busca } : {}),
            ...(input.filCod !== undefined ? { filCod: input.filCod } : {}),
            ...(input.emGrupo ? { emGrupo: true } : {}),
            ...(input.vencimentoDe ? { vencimentoDe: input.vencimentoDe } : {}),
            ...(input.vencimentoAte ? { vencimentoAte: input.vencimentoAte } : {}),
        });
        return {
            ...pagina,
            ...(sincronizadoEm != null ? { sincronizadoEm } : {}),
            regraCandidato: REGRA_CANDIDATO_TEXTO,
        };
    };

    /** Falha ao ler os grupos desliga SÓ o resumo de grupo na aba (nunca derruba a lista). */
    private gruposOuNenhum = async (): Promise<ReadonlyMap<string, BoletoDdaGrupo>> => {
        try {
            return await this.sugestoes.gruposPorBoleto();
        } catch (err: unknown) {
            const code = (err as { code?: unknown } | null)?.code;
            await this.logService.warn({
                type: LOG_TYPE.BUSINESS_WARN,
                message: 'falha ao ler os grupos de boleto; a aba segue sem o resumo de grupo',
                data: {
                    erro: err instanceof Error ? err.message : String(err),
                    ...(typeof code === 'string' ? { codigoErro: code } : {}),
                },
            });
            return new Map();
        }
    };

    private comGrupo = (
        linhas: BoletoDdaConsolidado[],
        grupos: ReadonlyMap<string, BoletoDdaGrupo>,
    ): BoletoDdaConsolidado[] =>
        grupos.size === 0
            ? linhas
            : linhas.map((b) => {
                  const grupo = grupos.get(`${b.ddcCod}:${b.ditCod}`);
                  return grupo ? { ...b, grupo } : b;
              });

    public sincronizar = async (input: {
        triggeredBy: string;
        /**
         * Orçamento de tempo desta passada (ms). Passado o prazo, os arquivos que ainda não
         * começaram ficam para a próxima (`arquivosAdiados`); o que já está em voo termina.
         * Ausente = sem prazo (botão manual e job avulso).
         */
        prazoMs?: number;
        /** Janela de releitura em dias (default `RELEITURA_DIAS`). */
        releituraDias?: number;
    }): Promise<SincronizacaoDdaResultado> =>
        this.db.withAdvisoryLock(
            BOLETO_DDA_SYNC_LOCK_KEY,
            async () => {
                try {
                    return await this.executarSincronizacao(input);
                } finally {
                    // O pool mudou (ou mudou em parte, se falhou no meio): o cenário em cache das
                    // sugestões não vale mais. Vale para o botão, o job e a ingestão.
                    this.sugestoesCache.invalidar();
                }
            },
            async () => {
                throw new IngestLockBusyError(
                    'boleto DDA sync advisory lock busy — another sync is running',
                );
            },
        );

    private executarSincronizacao = async (input: {
        triggeredBy: string;
        prazoMs?: number;
        releituraDias?: number;
    }): Promise<SincronizacaoDdaResultado> => {
        const limite = input.prazoMs !== undefined ? Date.now() + input.prazoMs : undefined;
        // O pool não é por filial; a filial só satisfaz a sessão do Conexos.
        const filCod = (await this.base.getFilCodDefault()) ?? 1;
        const [arquivos, conhecidos] = await Promise.all([
            this.dda.listarArquivos({ filCod }),
            this.repo.listArquivosSincronizados(),
        ]);
        const corte = Date.parse(
            `${this.calendar.addDays(
                this.calendar.todayBrt(),
                -(input.releituraDias ?? RELEITURA_DIAS),
            )}T00:00:00Z`,
        );
        const novos = arquivos.filter((a) => !conhecidos.has(a.ddcCod));
        const relidos = arquivos.filter(
            (a) => conhecidos.has(a.ddcCod) && (a.importadoEm ?? 0) >= corte,
        );
        const alvo: ArquivoDda[] = [...novos, ...relidos];

        const resultados = await this.bounded.run(
            alvo,
            async (arquivo) => {
                // Prazo estourado: não começa arquivo novo. `null` ≠ falha — fica para a próxima.
                if (limite !== undefined && Date.now() > limite) return null;
                const itens = await this.dda.listarItens({ filCod, ddcCod: arquivo.ddcCod });
                await this.repo.salvarArquivo(arquivo, itens);
                return itens.length;
            },
            FANOUT_LIMIT,
        );
        let boletos = 0;
        let falhas = 0;
        let arquivosAdiados = 0;
        for (const [i, r] of resultados.entries()) {
            if (r.status === 'fulfilled') {
                if (r.value === null) arquivosAdiados += 1;
                else boletos += r.value;
                continue;
            }
            falhas += 1;
            await this.logService.warn({
                type: LOG_TYPE.BUSINESS_INFO,
                message: 'sincronização DDA: falha ao ler arquivo do fin124',
                data: {
                    ddcCod: alvo[i]?.ddcCod,
                    erro: r.reason instanceof Error ? r.reason.message : String(r.reason),
                },
            });
        }

        const resultado: SincronizacaoDdaResultado = {
            arquivosNovos: novos.length,
            arquivosRelidos: relidos.length,
            boletos,
            falhas,
            arquivosAdiados,
        };
        await this.logService.info({
            type: LOG_TYPE.BUSINESS_INFO,
            message: 'sincronização de boletos DDA concluída',
            data: { triggeredBy: input.triggeredBy, ...resultado },
        });
        return resultado;
    };
}
