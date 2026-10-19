import { inject, injectable } from 'tsyringe';
import ConexosRenegociacaoClient from '../../client/ConexosRenegociacaoClient.js';
import ConexosSessionRegistry from '../../client/ConexosSessionRegistry.js';
import PostgreeDatabaseClient from '../../client/database/PostgreeDatabaseClient.js';
import type {
    AjusteCentavosExecucao,
    GatilhoAjuste,
} from '../../interface/sispag/AjusteCentavos.js';
import ElegibilidadeAjusteCentavos from '../../libs/boleto/ElegibilidadeAjusteCentavos.js';
import type { EtapaAjuste } from '../../libs/boleto/EtapaAjusteCentavos.js';
import type { ModoAjuste } from '../../libs/boleto/ModoAjusteCentavos.js';
import BankingCalendar from '../../libs/calendar/BankingCalendar.js';
import EnvironmentProvider from '../../libs/environment/EnvironmentProvider.js';
import ServerProcessMarker from '../../libs/runtime/ServerProcessMarker.js';
import AjusteCentavosExecucaoRepository from '../../repository/sispag/AjusteCentavosExecucaoRepository.js';
import BoletoDdaRepository from '../../repository/sispag/BoletoDdaRepository.js';
import LotePagamentoRepository from '../../repository/sispag/LotePagamentoRepository.js';
import SugestaoBoletoRepository from '../../repository/sispag/SugestaoBoletoRepository.js';
import TituloAPagarRepository from '../../repository/sispag/TituloAPagarRepository.js';
import LogService from '../LogService.js';

export const RESULTADO_AJUSTE = {
    DESLIGADO: 'desligado',
    SIMULADO: 'simulado',
    NAO_CANDIDATO: 'nao_candidato',
    RECUSADO: 'recusado',
    EM_ANDAMENTO: 'em_andamento',
    EXECUTADO: 'executado',
} as const;
export type ResultadoAjusteTipo = (typeof RESULTADO_AJUSTE)[keyof typeof RESULTADO_AJUSTE];

export interface ResultadoAjuste {
    resultado: ResultadoAjusteTipo;
    modo: ModoAjuste;
    etapa?: EtapaAjuste;
    motivo?: string;
    execucaoId?: string;
}

export interface PedidoAjuste {
    filCod: number;
    docCod: string;
    titCod: string;
    decisaoId: string;
    gatilho: GatilhoAjuste;
}

/** Contrato (Task 10): implementado na Task 11. */
@injectable()
export default class AjusteCentavosTituloService {
    public constructor(
        @inject(ConexosRenegociacaoClient) private readonly renegociacao: ConexosRenegociacaoClient,
        @inject(ConexosSessionRegistry) private readonly registry: ConexosSessionRegistry,
        @inject(AjusteCentavosExecucaoRepository)
        private readonly ledger: AjusteCentavosExecucaoRepository,
        @inject(SugestaoBoletoRepository) private readonly sugestoes: SugestaoBoletoRepository,
        @inject(BoletoDdaRepository) private readonly boletos: BoletoDdaRepository,
        @inject(TituloAPagarRepository) private readonly titulos: TituloAPagarRepository,
        @inject(LotePagamentoRepository) private readonly lotes: LotePagamentoRepository,
        @inject(ElegibilidadeAjusteCentavos)
        private readonly elegibilidade: ElegibilidadeAjusteCentavos,
        @inject(ServerProcessMarker) private readonly marcador: ServerProcessMarker,
        @inject(BankingCalendar) private readonly calendar: BankingCalendar,
        @inject(EnvironmentProvider) private readonly environmentProvider: EnvironmentProvider,
        @inject(LogService) private readonly logService: LogService,
        @inject(PostgreeDatabaseClient) private readonly db: PostgreeDatabaseClient,
    ) {}

    public ajustar = async (_p: PedidoAjuste): Promise<ResultadoAjuste> => {
        throw new Error('não implementado');
    };

    public tentarDeNovo = async (_p: {
        filCod: number;
        docCod: string;
        titCod: string;
    }): Promise<ResultadoAjuste> => {
        throw new Error('não implementado');
    };

    public retomarPendentes = async (_p: {
        filCod?: number;
    }): Promise<{ retomados: number; ignorados: number; falhas: number }> => {
        throw new Error('não implementado');
    };

    public listarCandidatos = async (_p: {
        filCod: number;
    }): Promise<{ modo: ModoAjuste; avisos: string[]; ajustes: AjusteCentavosExecucao[] }> => {
        throw new Error('não implementado');
    };

    public agendarAposConfirmar = (_p: Omit<PedidoAjuste, 'gatilho'>): void => {
        void [
            this.renegociacao,
            this.registry,
            this.ledger,
            this.sugestoes,
            this.boletos,
            this.titulos,
            this.lotes,
            this.elegibilidade,
            this.marcador,
            this.calendar,
            this.environmentProvider,
            this.logService,
            this.db,
        ];
        throw new Error('não implementado');
    };
}
