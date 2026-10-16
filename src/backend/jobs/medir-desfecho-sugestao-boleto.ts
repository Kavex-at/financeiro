import 'reflect-metadata';
import 'dotenv/config';
import pg from 'pg';
import { container } from 'tsyringe';
import PostgreeDatabaseClient from '../domain/client/database/PostgreeDatabaseClient.js';
import { redactErrorMessage } from '../domain/libs/redact/redactErrorMessage.js';
import MedirDesfechoSugestaoBoletoJob, { ALVO_MEDICAO } from './MedirDesfechoSugestaoBoletoJob.js';

/**
 * MEDIÇÃO SOMENTE LEITURA — desfecho da sugestão de boleto por título (ADR-0072, Tasks 1 e 16).
 *
 * Só `SELECT` pelos repositórios existentes + o motor puro. NÃO chama o Conexos, NÃO usa
 * `bootstrapAppContainer` (ele roda migrations) e NÃO grava nada: a sessão abre com
 * `default_transaction_read_only = on` (travada a cada conexão) e o job confere com `SHOW` antes de ler.
 * A saída tem só contagens e chaves de título — nunca barras nem linha digitável.
 *
 * Uso (de `src/backend`): `npx tsx jobs/medir-desfecho-sugestao-boleto.ts --alvo=prd|local [--detalhe]`
 */
const argumento = (nome: string): string | undefined =>
    process.argv.find((a) => a.startsWith(`${nome}=`))?.split('=')[1];

/**
 * Todo `pg.Client` aberto neste processo roda `SET default_transaction_read_only = on` ao conectar.
 * O pooler ignora `PGOPTIONS`, então a sessão é travada aqui, depois do connect (e conferida com
 * `SHOW` antes de qualquer leitura).
 */
const travarSessoesEmSomenteLeitura = (): void => {
    const proto = pg.Client.prototype as unknown as {
        connect: (cb?: (err?: Error) => void) => unknown;
        query: (sql: string) => Promise<unknown>;
    };
    const conectar = proto.connect;
    proto.connect = function (this: typeof proto, cb?: (err?: Error) => void) {
        if (!cb) {
            return (conectar.call(this) as Promise<void>).then(() =>
                this.query('SET default_transaction_read_only = on'),
            );
        }
        return conectar.call(this, (err?: Error) => {
            if (err) return cb(err);
            this.query('SET default_transaction_read_only = on').then(
                () => cb(),
                (e: Error) => cb(e),
            );
        });
    };
};

const main = async (): Promise<number> => {
    const alvo = argumento('--alvo');
    if (alvo !== ALVO_MEDICAO.PRD && alvo !== ALVO_MEDICAO.LOCAL) {
        console.error('RECUSADO: informe --alvo=prd ou --alvo=local.');
        return 1;
    }
    const conexao = process.env.databaseConnectionString ?? '';
    if (conexao === '') {
        console.error('RECUSADO: databaseConnectionString ausente.');
        return 1;
    }
    const real = MedirDesfechoSugestaoBoletoJob.classificarAlvo(conexao);
    if (real !== alvo) {
        console.error(`RECUSADO: --alvo=${alvo}, mas a conexão aponta para um banco ${real}.`);
        return 1;
    }
    travarSessoesEmSomenteLeitura();
    const db = container.resolve(PostgreeDatabaseClient);
    await db.init();
    const ro = await db.selectFirst<{ default_transaction_read_only: string }>(
        'SHOW default_transaction_read_only',
    );
    if (ro?.default_transaction_read_only !== 'on') {
        console.error('RECUSADO: a sessão não está em modo somente leitura.');
        return 1;
    }
    const resultado = await container.resolve(MedirDesfechoSugestaoBoletoJob).executar();
    const { chavesSemLinha, chavesSemDesfecho, ...resumo } = resultado;
    console.log(JSON.stringify({ alvo, ...resumo }, null, 2));
    if (process.argv.includes('--detalhe')) {
        console.log(`sem linha (${chavesSemLinha.length}):\n${chavesSemLinha.join('\n')}`);
        console.log(`sem desfecho (${chavesSemDesfecho.length}):\n${chavesSemDesfecho.join('\n')}`);
    }
    return 0;
};

main()
    .then((code) => process.exit(code))
    .catch((e) => {
        console.error(
            '[medir-desfecho-sugestao-boleto] FATAL:',
            redactErrorMessage(e instanceof Error ? e.message : String(e)),
        );
        process.exit(1);
    });
