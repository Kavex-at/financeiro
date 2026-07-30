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
    PROCESSO_PROVIDER_TOKEN,
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
import IngestaoTransacoesService from './service/recebimentos/IngestaoTransacoesService.js';
import MatchingEngineStub from './service/recebimentos/stubs/MatchingEngineStub.js';
import MetricsPortStub from './service/recebimentos/stubs/MetricsPortStub.js';
import NdeEmitterStub from './service/recebimentos/stubs/NdeEmitterStub.js';
import NexxeraGatewayStub from './service/recebimentos/stubs/NexxeraGatewayStub.js';
import ProcessoProviderConexos from './service/recebimentos/ProcessoProviderConexos.js';
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
    // Módulo 1 REAL (Fase 1): lê o extrato do Conexos (fin133 → fin095), normaliza,
    // deduplica por chave natural e persiste. O stub segue no repo como referência
    // de contrato e continua coberto por teste próprio.
    container.register(INGESTAO_TRANSACOES_TOKEN, { useClass: IngestaoTransacoesService });
    container.register(MATCHING_ENGINE_TOKEN, { useClass: MatchingEngineStub });
    container.register(RATEIO_ENGINE_TOKEN, { useClass: RateioEngineStub });
    container.register(REGRAS_ENGINE_TOKEN, { useClass: RegrasEngineStub });
    container.register(ERP_RECEIVABLES_GATEWAY_TOKEN, { useClass: ErpReceivablesGatewayStub });
    // NDe (Módulo 5) → STUB por ora. O seam FISCAL live-capable existe e é testado
    // (`ConexosNdeEmitter` → `ConexosNdeClient.homologar` no com297); o swap
    // `{ useClass: ConexosNdeEmitter }` é o passo de GO-LIVE, gated por: (a) escrita ligada
    // (`conexosWriteEnabled && !conexosDryRun`), (b) `Recebimento.emissaoNde` fluindo da leg de
    // geração com297 (info-gap — mints o `docCod`), (c) allowlist `NDE_NORMAL_TP_NF_CONHECIDOS`
    // seedada, e (d) os testes do pipeline registrando `LEGACY_CONEXOS_TOKEN` (o emitter resolve
    // `ConexosBaseClient`). Ver `integrations/conexos-com297-homologacao.md`.
    container.register(NDE_EMITTER_TOKEN, { useClass: NdeEmitterStub });
    container.register(METRICS_PORT_TOKEN, { useClass: MetricsPortStub });
    // Provedor de processos candidatos ("Alocar") → STUB in-memory (Módulo 2/2b troca o token).
    // Fonte REAL dos processos/clientes (imp021), no lugar das 4 fixtures.
    container.register(PROCESSO_PROVIDER_TOKEN, { useClass: ProcessoProviderConexos });

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
