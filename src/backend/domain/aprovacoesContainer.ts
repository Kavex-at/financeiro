import { container } from 'tsyringe';
import ConexosAprovacoesClient from './client/ConexosAprovacoesClient.js';
import {
    APROVACAO_INGESTAO_RUN_REPOSITORY_TOKEN,
    ETAPA_APROVACAO_REPOSITORY_TOKEN,
    TITULO_APROVACAO_REPOSITORY_TOKEN,
    TRILHA_APROVACAO_GATEWAY_TOKEN,
} from './interface/aprovacoes/ports.js';
import AprovacaoIngestaoRunRepository from './repository/aprovacoes/AprovacaoIngestaoRunRepository.js';
import EtapaAprovacaoRepository from './repository/aprovacoes/EtapaAprovacaoRepository.js';
import TituloAprovacaoRepository from './repository/aprovacoes/TituloAprovacaoRepository.js';

/**
 * Liga cada port da Frente V à sua implementação (espelha `recebimentosContainer.ts`).
 *
 * Idempotente por consulta ao próprio container: re-registra depois de um `container.reset()` nos
 * testes, mas é no-op em bootstraps repetidos.
 *
 * O binding que mais importa é o do `TRILHA_APROVACAO_GATEWAY_TOKEN`. Hoje ele aponta para o
 * `ConexosAprovacoesClient`, que lê título a título (`psq014/list` + `fin026/infoTitulo/list`).
 * Quando **PV-07** liberar o acesso à tela `fin103`, a varredura em massa entra **trocando esta
 * linha** — o job, o serviço e os repositories não sabem de onde o dado vem.
 */
export const registerAprovacoesPorts = (): void => {
    if (container.isRegistered(TRILHA_APROVACAO_GATEWAY_TOKEN)) return;

    container.register(TRILHA_APROVACAO_GATEWAY_TOKEN, { useClass: ConexosAprovacoesClient });
    container.register(TITULO_APROVACAO_REPOSITORY_TOKEN, { useClass: TituloAprovacaoRepository });
    container.register(ETAPA_APROVACAO_REPOSITORY_TOKEN, { useClass: EtapaAprovacaoRepository });
    container.register(APROVACAO_INGESTAO_RUN_REPOSITORY_TOKEN, {
        useClass: AprovacaoIngestaoRunRepository,
    });
};
