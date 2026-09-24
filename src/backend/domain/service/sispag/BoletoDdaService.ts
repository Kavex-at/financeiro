import { inject, injectable } from 'tsyringe';
import ConexosBaseClient from '../../client/ConexosBaseClient.js';
import ConexosDdaClient from '../../client/ConexosDdaClient.js';
import PostgreeDatabaseClient from '../../client/database/PostgreeDatabaseClient.js';
import IngestLockBusyError from '../../errors/IngestLockBusyError.js';
import {
    BOLETO_DDA_ESCOPO,
    type ArquivoDda,
    type BoletoDdaEscopo,
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
import ConsolidacaoBoletoDda, { JANELA_CANDIDATO_DIAS } from './ConsolidacaoBoletoDda.js';

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
        @inject(BankingCalendar) private readonly calendar: BankingCalendar,
        @inject(BoundedConcurrency) private readonly bounded: BoundedConcurrency,
        @inject(PostgreeDatabaseClient) private readonly db: PostgreeDatabaseClient,
        @inject(LogService) private readonly logService: LogService,
    ) {}

    public listar = async (input: { escopo: BoletoDdaEscopo }): Promise<BoletosDdaResposta> => {
        const vencimentoDesde =
            input.escopo === BOLETO_DDA_ESCOPO.A_VENCER ? this.calendar.todayBrt() : undefined;
        const [boletos, titulos, titulosEmLote, sincronizadoEm] = await Promise.all([
            this.repo.listBoletos(vencimentoDesde ? { vencimentoDesde } : {}),
            this.tituloRepo.listAtivos(),
            this.loteRepo.listTitulosEmLotesAbertos(),
            this.repo.ultimaSincronizacao(),
        ]);
        return {
            boletos: this.consolidacao.consolidar({ boletos, titulos, titulosEmLote }),
            ...(sincronizadoEm != null ? { sincronizadoEm } : {}),
            janelaDias: JANELA_CANDIDATO_DIAS,
        };
    };

    public sincronizar = async (input: {
        triggeredBy: string;
    }): Promise<SincronizacaoDdaResultado> =>
        this.db.withAdvisoryLock(
            BOLETO_DDA_SYNC_LOCK_KEY,
            () => this.executarSincronizacao(input),
            async () => {
                throw new IngestLockBusyError(
                    'boleto DDA sync advisory lock busy — another sync is running',
                );
            },
        );

    private executarSincronizacao = async (input: {
        triggeredBy: string;
    }): Promise<SincronizacaoDdaResultado> => {
        // O pool não é por filial; a filial só satisfaz a sessão do Conexos.
        const filCod = (await this.base.getFilCodDefault()) ?? 1;
        const [arquivos, conhecidos] = await Promise.all([
            this.dda.listarArquivos({ filCod }),
            this.repo.listArquivosSincronizados(),
        ]);
        const corte = Date.parse(
            `${this.calendar.addDays(this.calendar.todayBrt(), -RELEITURA_DIAS)}T00:00:00Z`,
        );
        const novos = arquivos.filter((a) => !conhecidos.has(a.ddcCod));
        const relidos = arquivos.filter(
            (a) => conhecidos.has(a.ddcCod) && (a.importadoEm ?? 0) >= corte,
        );
        const alvo: ArquivoDda[] = [...novos, ...relidos];

        const resultados = await this.bounded.run(
            alvo,
            async (arquivo) => {
                const itens = await this.dda.listarItens({ filCod, ddcCod: arquivo.ddcCod });
                await this.repo.salvarArquivo(arquivo, itens);
                return itens.length;
            },
            FANOUT_LIMIT,
        );
        let boletos = 0;
        let falhas = 0;
        for (const [i, r] of resultados.entries()) {
            if (r.status === 'fulfilled') {
                boletos += r.value;
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
        };
        await this.logService.info({
            type: LOG_TYPE.BUSINESS_INFO,
            message: 'sincronização de boletos DDA concluída',
            data: { triggeredBy: input.triggeredBy, ...resultado },
        });
        return resultado;
    };
}
