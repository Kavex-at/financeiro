import 'reflect-metadata';
import 'dotenv/config';
import { container } from 'tsyringe';
import { bootstrapAppContainer } from '../domain/appContainer.js';
import { PIPELINE } from '../domain/interface/operacao/JobRun.js';
import JobExecucaoRepository from '../domain/repository/operacao/JobExecucaoRepository.js';
import RecebimentosPainelService from '../domain/service/recebimentos/RecebimentosPainelService.js';

/**
 * Job de reconciliação da NDe com o SEFAZ (ADR-0042, fecha os follow-ups F1 e F3).
 *
 * Antes, a gravação do número do SEFAZ e do flag `ndeAutorizado` no ledger só acontecia em
 * `GET /recebimentos/painel/enriquecimento` — **que só o navegador chama**. Quem lesse
 * `ndeAutorizado` direto do Postgres (um relatório, uma integração) via um dado defasado até alguém
 * abrir a aba. A divergência se autocurava, mas a janela não tinha dono.
 *
 * Chama `reconciliarNdesComSefaz`, que reusa o MESMO `hidratarNdes` do caminho da tela: a
 * equivalência é por construção, não por uma segunda cópia da regra.
 *
 * Este job nasce COM trilha de execução (`job_execucao`, migration 0053), ao contrário do
 * `reaper-sispag` — que nasceu sem e por isso é o único job que o painel não consegue vigiar.
 */
/** Mesma constante que o read-model usa — o nome do pipeline é contrato entre os dois. */
const PIPELINE_NOME = PIPELINE.RECEBIMENTOS_NDE_SEFAZ;

const main = async (): Promise<void> => {
    await bootstrapAppContainer();
    const runRepo = container.resolve(JobExecucaoRepository);
    const runId = await runRepo.createRun({
        pipeline: PIPELINE_NOME,
        triggeredBy: process.env.TRIGGERED_BY ?? 'cron',
    });

    try {
        const service = container.resolve(RecebimentosPainelService);
        const r = await service.reconciliarNdesComSefaz();

        console.log(
            `[reconciliar-nde-sefaz] ${r.ndesLidas} NDe(s) lidas · ` +
                `${r.reconciliadas} reconciliada(s) · ${r.externasPendentes} externa(s) pendente(s) · ` +
                `filiais ${r.filiaisOk}/${r.filiaisTentadas}`,
        );

        // `externasPendentes` NÃO é falha: são NDes emitidas fora da ferramenta que a SEFAZ ainda
        // não autorizou. Marcar `partial` por causa delas transformaria operação normal em alarme.
        //
        // Cobertura de filial, sim, decide o status. `hidratarNdes` degrada em silêncio quando o
        // ERP não responde — devolve `reconciliadas: 0` sem lançar, exatamente igual a "não havia
        // nada a reconciliar". Fechar `success` sobre isso esconderia uma divergência crescente
        // entre o ledger e o SEFAZ atrás de uma tela verde, que é a cegueira do
        // `pagamento_ingestao_run` que este job nasceu para não herdar.
        const cobertura = r.filiaisOk < r.filiaisTentadas;
        const status = cobertura ? 'partial' : 'success';
        if (cobertura) {
            console.warn(
                `[reconciliar-nde-sefaz] PARCIAL — ${r.filiaisTentadas - r.filiaisOk} filial(is) ` +
                    'não puderam ser lidas no ERP; a reconciliação delas fica para a próxima rodada.',
            );
        }

        await runRepo.finishRun({
            runId,
            status,
            metricas: {
                ndesLidas: r.ndesLidas,
                reconciliadas: r.reconciliadas,
                externasPendentes: r.externasPendentes,
                filiaisTentadas: r.filiaisTentadas,
                filiaisOk: r.filiaisOk,
            },
        });
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        await runRepo.finishRun({ runId, status: 'error', errorMessage });
        throw error;
    }
};

main()
    .then(() => process.exit(0))
    .catch((error: unknown) => {
        console.error('[reconciliar-nde-sefaz] falhou:', error);
        process.exit(1);
    });
