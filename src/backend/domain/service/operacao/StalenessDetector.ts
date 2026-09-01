import { inject, injectable } from 'tsyringe';
import {
    ALERTA_SEVERIDADE,
    ALERTA_TIPO,
    type Alerta,
    type AlertaNovo,
} from '../../interface/operacao/Alerta.js';
import {
    JOB_RUN_STATUS,
    type PipelineSaude,
    SITUACAO_PIPELINE,
} from '../../interface/operacao/JobRun.js';
import { redactErrorMessage } from '../../../http/redact.js';
import JobRunReadModel from './JobRunReadModel.js';
import NotificacaoService from './NotificacaoService.js';

export interface ResultadoDeteccao {
    verificadoEm: string;
    /** Alertas efetivamente criados (os suprimidos pela dedup não entram). */
    emitidos: Alerta[];
    /** Pipelines inspecionados, com a situação de cada um — a trilha do que foi olhado. */
    inspecionados: { pipeline: string; situacao: string }[];
}

/**
 * StalenessDetector — compara a idade da última run `success` de cada pipeline com o limite
 * DAQUELE pipeline (ADR-0042, `business-rules/staleness-por-pipeline.md`).
 *
 * **Onde roda, e o que isso NÃO cobre.** Um quinto workflow em GitHub Actions. Um detector
 * hospedado no próprio GH Actions não enxerga o cenário em que o GH Actions deixa de disparar — e
 * schedules do GitHub são best-effort, podendo atrasar ou ser descartados sob carga. A mitigação
 * parcial é o invariante I6: `JobRunReadModel` computa staleness NA LEITURA, então um humano que
 * abra o painel vê a verdade mesmo numa janela em que este detector nunca rodou. O cron alerta; o
 * painel sempre sabe. Cobertura completa exigiria um dead-man's switch externo — follow-up.
 */
@injectable()
export default class StalenessDetector {
    constructor(
        @inject(JobRunReadModel) private readonly readModel: JobRunReadModel,
        @inject(NotificacaoService) private readonly notificacaoService: NotificacaoService,
    ) {}

    public detectar = async (agora: Date = new Date()): Promise<ResultadoDeteccao> => {
        const saude = await this.readModel.exporSaude(agora);
        const emitidos: Alerta[] = [];

        for (const p of saude) {
            for (const alerta of this.alertasDe(p, agora)) {
                // Isolamento POR INCIDENTE. `NotificacaoService` já isola por SINK, mas
                // `criarSeNovo` ainda pode lançar por conta do banco (pool exausto, timeout,
                // violação de CHECK). Sem esta guarda, uma pipeline problemática aborta o laço e as
                // SEGUINTES deixam de ser inspecionadas na rodada — o detector ficaria cego para
                // extratos e SISPAG por causa de um defeito em permutas. Mesma doutrina do
                // `entregarSeguro`: falha isolada, nunca em silêncio.
                const emitido = await this.emitirIsolado(alerta, p.pipeline);
                if (emitido !== null) emitidos.push(emitido);
            }
        }

        return {
            verificadoEm: agora.toISOString(),
            emitidos,
            inspecionados: saude.map((p) => ({ pipeline: p.pipeline, situacao: p.situacao })),
        };
    };

    /** Emite um alerta sem deixar a falha contaminar os pipelines seguintes da mesma rodada. */
    private emitirIsolado = async (
        alerta: AlertaNovo,
        pipeline: string,
    ): Promise<Alerta | null> => {
        try {
            return await this.notificacaoService.emitir(alerta);
        } catch (error) {
            console.error(
                `[detect-staleness] falha ao emitir alerta de ${pipeline}:`,
                error instanceof Error ? error.message : String(error),
            );
            return null;
        }
    };

    /** Um pipeline pode gerar staleness E parcialidade — são incidentes distintos. */
    private alertasDe = (p: PipelineSaude, agora: Date): AlertaNovo[] => {
        const alertas: AlertaNovo[] = [];
        const parado = this.alertaParado(p, agora);
        if (parado !== undefined) alertas.push(parado);
        const ultima = this.alertaDaUltimaRun(p, agora);
        if (ultima !== undefined) alertas.push(ultima);
        return alertas;
    };

    /**
     * Staleness. Silencioso em dois casos, cada um por uma razão diferente:
     *
     * - `nunca-executou` — decisão do Yuri (2026-09-01): um pipeline recém-implantado não deve
     *   alertar para sempre. O silêncio é só do staleness: uma run que roda e FALHA continua
     *   alertando por `job-falhou`, e o painel mostra `nunca-executou` como estado próprio. O único
     *   caso que fica calado é o pipeline que nunca rodou de fato — e esse a tela denuncia.
     * - `sem-trilha` — não há fonte para ler (hoje o reaper). Alertar seria inventar um sinal.
     */
    private alertaParado = (p: PipelineSaude, agora: Date): AlertaNovo | undefined => {
        if (p.situacao !== SITUACAO_PIPELINE.PARADO) return undefined;
        return {
            tipo: ALERTA_TIPO.JOB_PARADO,
            alvo: p.pipeline,
            severidade: ALERTA_SEVERIDADE.ERRO,
            janelaInicio: this.janela(agora, p.limiteStalenessMs),
            detalhe: {
                rotulo: p.rotulo,
                cadencia: p.cadencia,
                idadeMs: p.idadeDesdeUltimoSucessoMs,
                limiteMs: p.limiteStalenessMs,
                ultimoSucessoEm: p.ultimoSucessoEm,
            },
        };
    };

    /** Falha e parcialidade da ÚLTIMA run — o que o `if: failure()` do CI não alcança sozinho. */
    private alertaDaUltimaRun = (p: PipelineSaude, agora: Date): AlertaNovo | undefined => {
        const run = p.ultimaRun;
        if (run === undefined) return undefined;

        // Run ABANDONADA: aberta, nunca fechada. Acontece quando o runner morre entre o
        // `createRun` e o `finishRun` — SIGKILL, `timeout-minutes` estourado, runner evaporado.
        // `running` não é `error`, então nada mais aqui reagiria a ela: a única detecção residual
        // seria o staleness do último SUCESSO, que para o SISPAG abriria uma janela cega de até
        // 30h. O teto é o limite do próprio pipeline — passou disso, a run não está lenta, está
        // morta.
        if (run.status === JOB_RUN_STATUS.RUNNING) {
            const abertaHaMs = agora.getTime() - Date.parse(run.startedAt);
            const teto = p.limiteStalenessMs;
            if (teto !== undefined && abertaHaMs > teto) {
                return {
                    tipo: ALERTA_TIPO.JOB_FALHOU,
                    alvo: p.pipeline,
                    severidade: ALERTA_SEVERIDADE.ERRO,
                    // Janela = a run. Uma run abandonada alerta uma vez, não a cada rodada.
                    janelaInicio: new Date(run.startedAt),
                    detalhe: {
                        rotulo: p.rotulo,
                        runId: run.runId,
                        motivo: 'run abandonada — aberta e nunca fechada',
                        abertaHaMs,
                        limiteMs: teto,
                    },
                };
            }
            return undefined;
        }

        if (run.status === JOB_RUN_STATUS.ERROR) {
            return {
                tipo: ALERTA_TIPO.JOB_FALHOU,
                alvo: p.pipeline,
                severidade: ALERTA_SEVERIDADE.ERRO,
                // Janela = a run. Uma falha nova gera alerta novo; a mesma run, não.
                janelaInicio: new Date(run.finishedAt ?? run.startedAt),
                // `detalhe` é persistido em JSONB e renderizado no painel — mesma exigência de
                // redação da coluna `error_message`.
                detalhe: {
                    rotulo: p.rotulo,
                    runId: run.runId,
                    ...(run.errorMessage !== undefined
                        ? { erro: redactErrorMessage(run.errorMessage) }
                        : {}),
                },
            };
        }

        if (run.status === JOB_RUN_STATUS.PARTIAL) {
            return {
                tipo: ALERTA_TIPO.JOB_PARCIAL,
                alvo: p.pipeline,
                severidade: ALERTA_SEVERIDADE.AVISO,
                janelaInicio: new Date(run.finishedAt ?? run.startedAt),
                detalhe: { rotulo: p.rotulo, runId: run.runId, metricas: run.metricas },
            };
        }

        return undefined;
    };

    /**
     * Janela de dedup do staleness = o bloco de tamanho `limiteMs` em que `agora` cai.
     *
     * Assim um pipeline parado gera UM alerta por limite decorrido, não um por rodada do detector.
     * Para os extratos (limite 3h, detector a cada 15min) a diferença é 1 alerta contra 12 — e 12
     * seria ruído suficiente para o time desligar o canal.
     */
    private janela = (agora: Date, limiteMs?: number): Date => {
        if (limiteMs === undefined || limiteMs <= 0) return agora;
        return new Date(Math.floor(agora.getTime() / limiteMs) * limiteMs);
    };
}
