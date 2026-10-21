import { inject, injectable } from 'tsyringe';
import ConexosBaixaClient from '../../client/ConexosBaixaClient.js';
import ConexosIdentityProvider from '../../client/ConexosIdentityProvider.js';
import ConexosSispagClient from '../../client/ConexosSispagClient.js';
import ConexosSispagWriteClient from '../../client/ConexosSispagWriteClient.js';
import NotImplementedError from '../../errors/NotImplementedError.js';
import type {
    LimpezaBorderoGrupoInterface,
    PedidoConferenciaGrupos,
    PedidoLimpezaBordero,
    PedidoPreparacaoBordero,
    ResultadoLimpezaBordero,
    ResultadoPreparacaoBordero,
} from '../../interface/sispag/BorderoGrupoBoletoInterface.js';
import BankingCalendar from '../../libs/calendar/BankingCalendar.js';
import EnvironmentProvider from '../../libs/environment/EnvironmentProvider.js';
import BoletoDdaRepository from '../../repository/sispag/BoletoDdaRepository.js';
import GrupoBoletoExecucaoRepository from '../../repository/sispag/GrupoBoletoExecucaoRepository.js';
import GrupoBoletoRepository from '../../repository/sispag/GrupoBoletoRepository.js';
import SugestaoBoletoRepository from '../../repository/sispag/SugestaoBoletoRepository.js';
import LogService from '../LogService.js';
import NotificacaoService from '../operacao/NotificacaoService.js';

/**
 * BorderoGrupoBoletoService — borderô `fin010` do grupo de boleto numa remessa (ADR-0077):
 * conferência antes de qualquer escrita (I21p(1)), preparação com write-ahead e retomada
 * (I21l, I21n, I21s) e limpeza do que o sistema criou (I21q). Nunca finaliza, cancela nem
 * estorna borderô de grupo (I21m).
 *
 * **Task 13 (RED):** só o contrato. Os métodos lançam `NotImplementedError`; a implementação é a
 * Task 14, que torna verde `BorderoGrupoBoletoService.test.ts`.
 */
@injectable()
export default class BorderoGrupoBoletoService implements LimpezaBorderoGrupoInterface {
    public constructor(
        @inject(ConexosBaixaClient) private readonly baixa: ConexosBaixaClient,
        @inject(ConexosSispagWriteClient) private readonly write: ConexosSispagWriteClient,
        @inject(ConexosSispagClient) private readonly sispag: ConexosSispagClient,
        @inject(GrupoBoletoExecucaoRepository)
        private readonly ledger: GrupoBoletoExecucaoRepository,
        @inject(GrupoBoletoRepository) private readonly grupos: GrupoBoletoRepository,
        @inject(BoletoDdaRepository) private readonly boletos: BoletoDdaRepository,
        @inject(SugestaoBoletoRepository) private readonly sugestoes: SugestaoBoletoRepository,
        @inject(NotificacaoService) private readonly notificacao: NotificacaoService,
        @inject(ConexosIdentityProvider) private readonly identidade: ConexosIdentityProvider,
        @inject(BankingCalendar) private readonly calendar: BankingCalendar,
        @inject(EnvironmentProvider) private readonly environmentProvider: EnvironmentProvider,
        @inject(LogService) private readonly logService: LogService,
    ) {}

    /** I21p(1): só leitura; grupo inelegível ao vivo ⇒ `GroupedBoletoNotEligibleAtRemittanceError`. */
    public conferirAntesDaEscrita = async (_pedido: PedidoConferenciaGrupos): Promise<void> => {
        throw this.naoImplementado();
    };

    /** I21l/I21n/I21s: write-ahead, criação ou reconhecimento do borderô, baixas, import. */
    public preparar = async (
        _pedido: PedidoPreparacaoBordero,
    ): Promise<ResultadoPreparacaoBordero> => {
        throw this.naoImplementado();
    };

    /** I21q: só o borderô nosso, só com o lote nativo aberto e sem `.REM`, lidos ao vivo. */
    public limpar = async (_pedido: PedidoLimpezaBordero): Promise<ResultadoLimpezaBordero> => {
        throw this.naoImplementado();
    };

    private naoImplementado = (): NotImplementedError => {
        void [
            this.baixa,
            this.write,
            this.sispag,
            this.ledger,
            this.grupos,
            this.boletos,
            this.sugestoes,
            this.notificacao,
            this.identidade,
            this.calendar,
            this.environmentProvider,
            this.logService,
        ];
        return new NotImplementedError('BorderoGrupoBoletoService: Task 14');
    };
}
