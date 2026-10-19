import 'reflect-metadata';
// Carrega o .env ANTES dos imports que constroem o `conexosService` singleton (ver ingest-pagamentos).
import 'dotenv/config';
import { container } from 'tsyringe';
import { bootstrapAppContainer } from '../domain/appContainer.js';
import LeitorDpsService from '../domain/service/sispag/LeitorDpsService.js';

/** Títulos lidos por execução: o cron roda 3×/dia; a fila de ambíguos é de dezenas. */
const LIMITE_PADRAO = 40;

/**
 * Leitura do DPS no GED (ADR-0073, D2): para os títulos cuja sugestão de boleto DDA a ordem de DPS
 * não desempatou, baixa o PDF da NFS-e do GED do Conexos e grava o "NÚMERO DA DPS" em
 * `titulo_dps`. SÓ LEITURA no Conexos. Roda no cron do SISPAG, depois da ingestão (carteira e
 * pool DDA frescos). Uso: `npm run job:ler-dps-nfse [-- <limite>]`.
 *
 * Falha de um título vira `ERRO` gravado e não derruba o job. Exit 1 só quando NADA foi lido e
 * tudo falhou: é sinal de problema geral (ex.: robô sem permissão no `arq020`), e o passo de
 * alerta do workflow precisa ver.
 */
const main = async (): Promise<void> => {
    const limite = Number(process.argv[2] ?? LIMITE_PADRAO);
    await bootstrapAppContainer();
    const r = await container
        .resolve(LeitorDpsService)
        .executar({ limite: Number.isInteger(limite) && limite > 0 ? limite : LIMITE_PADRAO });
    console.log(
        `[ler-dps-nfse] alvos=${r.alvos} lidos=${r.lidos} semPdf=${r.semPdf} ` +
            `semDps=${r.semDps} erros=${r.erros}`,
    );
    if (r.alvos > 0 && r.lidos === 0 && r.erros === r.alvos) process.exitCode = 1;
};

main()
    .then(() => process.exit(process.exitCode ?? 0))
    .catch((error) => {
        console.error(
            '[ler-dps-nfse] leitura FALHOU:',
            error instanceof Error ? error.message : String(error),
        );
        process.exit(1);
    });
