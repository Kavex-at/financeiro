import { container } from 'tsyringe';
import {
    CREDITO_CLIENTE_REPOSITORY_TOKEN,
    ERP_RECEIVABLES_GATEWAY_TOKEN,
    INGESTAO_TRANSACOES_TOKEN,
    MATCHING_ENGINE_TOKEN,
    METRICS_PORT_TOKEN,
    NDE_EMITTER_TOKEN,
    NDE_REPOSITORY_TOKEN,
    NEXXERA_GATEWAY_TOKEN,
    RATEIO_ENGINE_TOKEN,
    RECEBIMENTO_EXECUCAO_REPOSITORY_TOKEN,
    RECEBIMENTO_REPOSITORY_TOKEN,
    REGRA_RECEBIMENTO_REPOSITORY_TOKEN,
    REGRAS_ENGINE_TOKEN,
    TRANSACAO_REPOSITORY_TOKEN,
} from './interface/recebimentos/ports.js';
import CreditoClienteRepository from './repository/recebimentos/CreditoClienteRepository.js';
import NdeRepository from './repository/recebimentos/NdeRepository.js';
import RecebimentoExecucaoRepository from './repository/recebimentos/RecebimentoExecucaoRepository.js';
import RecebimentoRepository from './repository/recebimentos/RecebimentoRepository.js';
import RegraRecebimentoRepository from './repository/recebimentos/RegraRecebimentoRepository.js';
import TransacaoRepository from './repository/recebimentos/TransacaoRepository.js';
import ErpReceivablesGatewayStub from './service/recebimentos/stubs/ErpReceivablesGatewayStub.js';
import IngestaoTransacoesStub from './service/recebimentos/stubs/IngestaoTransacoesStub.js';
import MatchingEngineStub from './service/recebimentos/stubs/MatchingEngineStub.js';
import MetricsPortStub from './service/recebimentos/stubs/MetricsPortStub.js';
import NdeEmitterStub from './service/recebimentos/stubs/NdeEmitterStub.js';
import NexxeraGatewayStub from './service/recebimentos/stubs/NexxeraGatewayStub.js';
import RateioEngineStub from './service/recebimentos/stubs/RateioEngineStub.js';
import RegrasEngineStub from './service/recebimentos/stubs/RegrasEngineStub.js';

/**
 * Binds every Frente IV port TOKEN to its implementation (§6 step 3 — teammates swap one token to go
 * real). Engines/gateways → SKELETON stubs; the spine + ledger + added-entity repositories → the
 * real-but-thin `@injectable()` classes. Idempotent (register-once): the guard consults the container
 * itself, so it re-registers after a `container.reset()` (tests) but is a no-op on repeated bootstrap.
 * No raw `process.env` — repos read env only via `EnvironmentProvider` downstream.
 */
export const registerRecebimentosPorts = (): void => {
    if (container.isRegistered(NEXXERA_GATEWAY_TOKEN)) return;

    // Engines + gateways + metrics → stubs (swap to real per Módulo).
    container.register(NEXXERA_GATEWAY_TOKEN, { useClass: NexxeraGatewayStub });
    container.register(INGESTAO_TRANSACOES_TOKEN, { useClass: IngestaoTransacoesStub });
    container.register(MATCHING_ENGINE_TOKEN, { useClass: MatchingEngineStub });
    container.register(RATEIO_ENGINE_TOKEN, { useClass: RateioEngineStub });
    container.register(REGRAS_ENGINE_TOKEN, { useClass: RegrasEngineStub });
    container.register(ERP_RECEIVABLES_GATEWAY_TOKEN, { useClass: ErpReceivablesGatewayStub });
    container.register(NDE_EMITTER_TOKEN, { useClass: NdeEmitterStub });
    container.register(METRICS_PORT_TOKEN, { useClass: MetricsPortStub });

    // Repositories → real-but-thin classes (the spine must persist for the coordinator to be runnable).
    container.register(TRANSACAO_REPOSITORY_TOKEN, { useClass: TransacaoRepository });
    container.register(RECEBIMENTO_REPOSITORY_TOKEN, { useClass: RecebimentoRepository });
    container.register(RECEBIMENTO_EXECUCAO_REPOSITORY_TOKEN, {
        useClass: RecebimentoExecucaoRepository,
    });
    container.register(CREDITO_CLIENTE_REPOSITORY_TOKEN, { useClass: CreditoClienteRepository });
    container.register(REGRA_RECEBIMENTO_REPOSITORY_TOKEN, {
        useClass: RegraRecebimentoRepository,
    });
    container.register(NDE_REPOSITORY_TOKEN, { useClass: NdeRepository });
};
