import 'reflect-metadata';
import 'dotenv/config';
import { container } from 'tsyringe';
import { bootstrapAppContainer } from '../domain/appContainer.js';
import PostgreeDatabaseClient from '../domain/client/database/PostgreeDatabaseClient.js';
import { APROVACOES_INGEST_LOCK_KEY } from '../domain/interface/aprovacoes/constants.js';
import IngestaoAprovacoesService from '../domain/service/aprovacoes/IngestaoAprovacoesService.js';

/**
 * Job de ingestão da trilha de aprovação — Frente V (ADR-0038).
 *
 * ## Custo, e por que ele é retomável
 *
 * Sem acesso à tela `fin103` (**PV-07**), a trilha custa **uma chamada ao ERP por título**. Só a
 * filial 2 tem 23.632 títulos a pagar em 12 meses. Um backfill assim leva horas e vai cair no meio
 * — de rede, de sessão, de deploy. Por isso o serviço grava um cursor a cada título e `--retomar`
 * continua de onde parou, em vez de recomeçar.
 *
 * ## Exclusão mútua
 *
 * Roda inteiro dentro de um advisory lock: duas execuções simultâneas não se atropelam. A segunda
 * falha rápido em vez de duplicar trabalho e queimar quota do ERP.
 *
 * ## Read-only no ERP
 *
 * Nenhuma escrita no Conexos, em nenhum caminho (D2). A única mutação é no Postgres local.
 *
 * Uso:
 *   npm run job:ingest-aprovacoes
 *   FILS=1,2,3 APROVACOES_BACKFILL_DESDE=1754006400000 npm run job:ingest-aprovacoes
 *   RETOMAR=1 npm run job:ingest-aprovacoes
 */

/** Janela padrão do backfill: 12 meses. Configurável — ver **PV-08**. */
const DOZE_MESES_MS = 365 * 24 * 60 * 60 * 1000;

const resolverFilCods = (): number[] => {
    const bruto = process.env.FILS ?? process.env.APROVACOES_INGEST_FIL_CODS ?? '';
    const lista = bruto
        .split(',')
        .map((s) => Number(s.trim()))
        .filter((n) => Number.isInteger(n) && n > 0);
    return lista;
};

const resolverEmissaoDesde = (): number => {
    const bruto = process.env.APROVACOES_BACKFILL_DESDE?.trim();
    if (bruto) {
        const n = Number(bruto);
        if (Number.isFinite(n) && n > 0) return n;
    }
    return Date.now() - DOZE_MESES_MS;
};

const main = async (): Promise<void> => {
    await bootstrapAppContainer();

    const filCods = resolverFilCods();
    if (filCods.length === 0) {
        // Falhar alto em vez de varrer "todas": uma varredura acidental de todas as filiais é
        // custosa no ERP e demorada. O escopo é decisão explícita (PV-09).
        console.error(
            'ingest-aprovacoes: defina as filiais em FILS (ex.: FILS=1,2,3) ou APROVACOES_INGEST_FIL_CODS.',
        );
        process.exit(1);
    }

    const emissaoDesde = resolverEmissaoDesde();
    const retomar = process.env.RETOMAR === '1';
    const service = container.resolve(IngestaoAprovacoesService);
    const db = container.resolve(PostgreeDatabaseClient);

    console.log(
        `[ingest-aprovacoes] filiais=${filCods.join(',')} desde=${new Date(emissaoDesde).toISOString()} retomar=${retomar}`,
    );

    const resultado = await db.withAdvisoryLock(
        APROVACOES_INGEST_LOCK_KEY,
        async () =>
            service.executar({
                filCods,
                emissaoDesde,
                triggeredBy: process.env.TRIGGERED_BY ?? 'cron',
                retomar,
            }),
        async () => {
            // Outra execução já está varrendo. Sair sem escrever é o comportamento certo: duas
            // varreduras concorrentes dobrariam a carga no ERP para produzir o mesmo resultado.
            console.warn('[ingest-aprovacoes] já existe uma ingestão em andamento — encerrando.');
            return null;
        },
    );

    if (resultado === null) return;

    console.log(
        `[ingest-aprovacoes] run=${resultado.runId} titulos=${resultado.titulos} etapas=${resultado.etapas}`,
    );
};

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error('[ingest-aprovacoes] FALHOU:', error);
        process.exit(1);
    });
