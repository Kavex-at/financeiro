import { inject, injectable } from 'tsyringe';
import IngestLockBusyError from '../../errors/IngestLockBusyError.js';
import { CONFERENCIA_DDA_ESTADO, type ConferenciaDda } from '../../interface/sispag/BoletoDda.js';
import EnvironmentProvider from '../../libs/environment/EnvironmentProvider.js';
import type { IngestaoPagamentosResult } from '../../interface/sispag/SispagInterface.js';
import PagamentoIngestaoRunRepository from '../../repository/sispag/PagamentoIngestaoRunRepository.js';
import BoletoDdaService from './BoletoDdaService.js';
import IngestaoPagamentosService from './IngestaoPagamentosService.js';

const MIN_MS = 60_000;
/**
 * Uma run `running` mais velha que isto é run MORTA (processo derrubado entre o `createRun` e o
 * `finishRun`): não bloqueia um refresh novo. A ingestão leva ~10 s medidos no cron.
 */
const RUN_PRESA_MS = 10 * MIN_MS;

export const ESTADO_CARTEIRA = {
    /** Carteira recente (< TTL): nada foi feito. */
    FRESCA: 'fresca',
    /** Estava defasada e uma ingestão nova rodou agora. */
    ATUALIZADA: 'atualizada',
    /** Já há uma ingestão rodando (outra pessoa, ou o cron). */
    EM_ANDAMENTO: 'em_andamento',
    /** A última ingestão falhou há pouco: não repete até o cooldown passar. */
    FALHA_RECENTE: 'falha_recente',
} as const;
export type EstadoCarteira = (typeof ESTADO_CARTEIRA)[keyof typeof ESTADO_CARTEIRA];

export interface CarteiraAtualizacao {
    estado: EstadoCarteira;
    /** ISO do fim da última ingestão bem-sucedida, quando existe. */
    ultimaIngestaoEm?: string;
    /** Idade dessa ingestão, em minutos inteiros. */
    idadeMin?: number;
    /** Resultado da ingestão que rodou (só em `atualizada`). */
    run?: IngestaoPagamentosResult;
    /** Mensagem da última falha (só em `falha_recente`). */
    motivo?: string;
    /** I-DDA6: conferência rápida do DDA feita nesta abertura (só em `fresca`, quando rodou). */
    dda?: ConferenciaDda;
}

/**
 * Atualização da carteira SISPAG ao abrir a tela (ADR-0060): stale-while-revalidate sobre a
 * ingestão que o cron e o botão manual já usam.
 *
 * A tela mostra o que está gravado e pede o refresh; aqui se decide se ele roda. Três freios
 * protegem o Conexos (sessões limitadas por usuário) de uma ingestão por abertura de tela:
 * o TTL (carteira recente não roda), o lock da ingestão (uma por vez) e o cooldown depois de
 * falha (um 403 do robô não vira uma tentativa a cada abertura).
 *
 * NÃO forma lotes: formar lote sob os pés de quem está editando muda a tela dela. A formação
 * continua só no cron e no botão explícito.
 */
@injectable()
export default class CarteiraAtualizacaoService {
    public constructor(
        @inject(IngestaoPagamentosService) private readonly ingestao: IngestaoPagamentosService,
        @inject(PagamentoIngestaoRunRepository)
        private readonly runRepo: PagamentoIngestaoRunRepository,
        @inject(EnvironmentProvider) private readonly environmentProvider: EnvironmentProvider,
        @inject(BoletoDdaService) private readonly boletoDda: BoletoDdaService,
    ) {}

    public atualizarSeDefasada = async (input: {
        triggeredBy: string;
        /** Relógio injetável (ms epoch) — só para teste. */
        agora?: number;
    }): Promise<CarteiraAtualizacao> => {
        const agora = input.agora ?? Date.now();
        const env = await this.environmentProvider.getEnvironmentVars();
        const ttlMs = env.sispagCarteiraTtlMin * MIN_MS;
        const cooldownMs = env.sispagCarteiraCooldownMin * MIN_MS;

        const ultimoSucesso = await this.runRepo.findLatestSuccessFinishedAt();
        const referencia = ultimoSucesso
            ? {
                  ultimaIngestaoEm: ultimoSucesso.toISOString(),
                  idadeMin: Math.max(0, Math.floor((agora - ultimoSucesso.getTime()) / MIN_MS)),
              }
            : {};

        if (ultimoSucesso && agora - ultimoSucesso.getTime() < ttlMs) {
            // I-DDA6: carteira recente não ingere (e não sincroniza o DDA). A conferência rápida
            // pega o arquivo DDA novo do dia sem esperar o TTL; na mesma requisição, então segue
            // sequencial com a sincronização dos lotes (ADR-0066 §3).
            const dda = await this.conferirDda(
                input.triggeredBy,
                agora,
                env.sispagDdaConferenciaMin,
            );
            return { estado: ESTADO_CARTEIRA.FRESCA, ...referencia, ...(dda ? { dda } : {}) };
        }

        const [ultima] = await this.runRepo.listRecentRuns(1);
        if (ultima?.status === 'running' && agora - Date.parse(ultima.startedAt) < RUN_PRESA_MS) {
            return { estado: ESTADO_CARTEIRA.EM_ANDAMENTO, ...referencia };
        }
        if (
            ultima?.status === 'error' &&
            ultima.finishedAt !== undefined &&
            agora - Date.parse(ultima.finishedAt) < cooldownMs
        ) {
            return {
                estado: ESTADO_CARTEIRA.FALHA_RECENTE,
                ...referencia,
                ...(ultima.errorMessage ? { motivo: ultima.errorMessage } : {}),
            };
        }

        try {
            const run = await this.ingestao.executar({ triggeredBy: input.triggeredBy });
            return {
                estado: ESTADO_CARTEIRA.ATUALIZADA,
                ultimaIngestaoEm: new Date(agora).toISOString(),
                idadeMin: 0,
                run,
            };
        } catch (error) {
            // Outra ingestão ganhou a corrida pelo lock: é contenção, não falha.
            if (error instanceof IngestLockBusyError) {
                return { estado: ESTADO_CARTEIRA.EM_ANDAMENTO, ...referencia };
            }
            throw error;
        }
    };

    /** Falha da conferência nunca muda o estado da carteira: vira `dda.estado = falhou`. */
    private conferirDda = async (
        triggeredBy: string,
        agora: number,
        intervaloMin: number,
    ): Promise<ConferenciaDda | undefined> => {
        try {
            return await this.boletoDda.conferirSeVelho({
                triggeredBy,
                intervaloMs: intervaloMin * MIN_MS,
                agora,
            });
        } catch (err: unknown) {
            const erro = err instanceof Error ? err.message : String(err);
            return { estado: CONFERENCIA_DDA_ESTADO.FALHOU, erro: erro.slice(0, 300) };
        }
    };
}
