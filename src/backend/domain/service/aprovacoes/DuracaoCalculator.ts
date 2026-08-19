import { injectable } from 'tsyringe';
import { ETAPA_STATUS } from '../../interface/aprovacoes/constants.js';
import type { EtapaStatus } from '../../interface/aprovacoes/constants.js';

const MS_POR_SEGUNDO = 1000;

/**
 * DuracaoCalculator — a métrica-produto da Frente V.
 *
 * Regra em `ontology/business-rules/duracao-etapa-aprovacao.md`. Duas ideias sustentam tudo:
 *
 * 1. **Relógio corrido, em segundos.** Dias úteis exigiriam calendário de feriados por filial, que
 *    não temos; e o corrido é o *fato*, enquanto "3 dias úteis" é uma *interpretação*. A formatação
 *    é decisão de apresentação.
 * 2. **Nunca estimar.** Quando o dado não permite afirmar a duração, o resultado é `undefined` e a
 *    lacuna aparece na UI. Um painel financeiro que preenche silenciosamente um tempo faltante
 *    produz uma média que ninguém consegue auditar.
 */
@injectable()
export default class DuracaoCalculator {
    /**
     * Duração fechada de uma etapa: `agidoEm − recebidoEm`, em segundos corridos.
     *
     * Devolve `undefined` — nunca zero, nunca um chute — quando:
     * faltam timestamps; a etapa não terminou; `agidoEm == recebidoEm` (o ERP carimba o mesmo
     * instante enquanto o bloqueio não é resolvido); ou `agidoEm < recebidoEm` (dado inconsistente).
     *
     * **Não clampar o negativo para zero:** zero é um valor plausível e mentiroso — leria como
     * "aprovou instantaneamente" e puxaria a média para baixo sem deixar rastro.
     */
    public calcularDuracaoSegundos = (params: {
        recebidoEm?: Date;
        agidoEm?: Date;
        status: EtapaStatus;
    }): number | undefined => {
        const { recebidoEm, agidoEm, status } = params;
        const terminou = status === ETAPA_STATUS.CONCLUIDA || status === ETAPA_STATUS.REJEITADA;
        if (!terminou) return undefined;
        if (!recebidoEm || !agidoEm) return undefined;

        const delta = agidoEm.getTime() - recebidoEm.getTime();
        if (delta <= 0) return undefined;
        return Math.round(delta / MS_POR_SEGUNDO);
    };

    /**
     * "Parada há X" — espera **em curso** de uma etapa pendente.
     *
     * Métrica deliberadamente separada de `calcularDuracaoSegundos`: esta é aberta e cresce a cada
     * leitura. Somá-la a durações fechadas enviesaria o tempo médio para baixo, porque etapas ainda
     * abertas entrariam com o tempo parcial.
     */
    public calcularParadaHaSegundos = (params: {
        recebidoEm?: Date;
        status: EtapaStatus;
        agora: Date;
    }): number | undefined => {
        const { recebidoEm, status, agora } = params;
        if (status !== ETAPA_STATUS.PENDENTE) return undefined;
        if (!recebidoEm) return undefined;

        const delta = agora.getTime() - recebidoEm.getTime();
        if (delta < 0) return undefined;
        return Math.round(delta / MS_POR_SEGUNDO);
    };

    /**
     * Tempo total do título: da primeira etapa até a última ação — ou até agora, se ainda houver
     * etapa pendente (o relógio do título não parou).
     *
     * O marco zero **deveria** ser a finalização do documento ("finalizado às 10:00", no exemplo do
     * cliente). `docDtaFinalizacao` não vem na projeção acessível hoje, então o relógio começa na
     * primeira etapa e o título carrega a lacuna `SEM_DATA_FINALIZACAO`. Ver **PV-04** e **PV-07**:
     * quando o campo existir, basta passar `dataFinalizacao` aqui.
     */
    public calcularTempoTotalSegundos = (params: {
        dataFinalizacao?: Date;
        primeiraEtapaEm?: Date;
        ultimaAcaoEm?: Date;
        temPendente: boolean;
        agora: Date;
    }): number | undefined => {
        const inicio = params.dataFinalizacao ?? params.primeiraEtapaEm;
        if (!inicio) return undefined;

        const fim = params.temPendente ? params.agora : params.ultimaAcaoEm;
        if (!fim) return undefined;

        const delta = fim.getTime() - inicio.getTime();
        if (delta < 0) return undefined;
        return Math.round(delta / MS_POR_SEGUNDO);
    };
}
