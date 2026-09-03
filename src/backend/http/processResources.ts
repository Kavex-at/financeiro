import { container } from 'tsyringe';
import PostgreeDatabaseClient from '../domain/client/database/PostgreeDatabaseClient.js';
import { closeConexosSessionStorePool } from '../services/conexosSessionStore.js';
import { closeAll, type NamedCloseable } from './lifecycle.js';

/**
 * Todo recurso de processo que precisa ser liberado no shutdown, num lugar só.
 *
 * Alguém tem de nomear as classes concretas — isso é o composition root, e não
 * tem como fugir. O que dá para escolher é ONDE: enquanto a lista vivia no meio
 * do wiring do `index.ts`, ela era invisível, e foi assim que o segundo pool
 * Postgres (o do `conexosSessionStore`) ficou de fora do SIGTERM até o
 * Regis-Review achá-lo — cada deploy deixando até 2 sessões penduradas no pooler.
 *
 * Um arquivo com este nome é o lugar onde alguém procura antes de acrescentar um
 * client que segura recurso. Ver `http/lifecycle.ts` para a semântica de fechar.
 */
export const processResources = (): NamedCloseable[] => [
    {
        // Pool primário (max 5).
        nome: 'postgres-pool',
        recurso: container.resolve(PostgreeDatabaseClient),
    },
    {
        // Pool do session store (max 2), criado no load do módulo.
        nome: 'conexos-session-store-pool',
        recurso: { close: closeConexosSessionStorePool },
    },
    // NÃO entra aqui: a SESSÃO do Conexos (card `integrability-3`).
    //
    // A pergunta é natural — se fechamos os pools, por que não deslogar do ERP? Porque o `sid` é
    // COMPARTILHADO entre todos os processos (web + os 6 crons), guardado na tabela
    // `conexos_sessions` justamente para que eles não briguem pelos ~3 slots de MAX_SESSIONS da
    // conta. Deslogar no SIGTERM do web derrubaria a sessão que um cron está usando no mesmo
    // instante, e o próximo login dispararia o kill-oldest em cascata — exatamente o problema que
    // o session store foi criado para resolver.
    //
    // A sessão expira sozinha e é renovada por quem precisar. Deixá-la viva é a escolha certa,
    // não um esquecimento.
];

/**
 * Libera todos. Nunca rejeita: um recurso quebrado não pode travar a saída e
 * transformar um shutdown limpo em SIGKILL. Os erros são logados aqui, com o nome
 * do recurso — durante um incidente, "algo não fechou" não ajuda ninguém.
 */
export const closeProcessResources = async (): Promise<void> => {
    const { errors } = await closeAll(processResources());
    for (const { nome, erro } of errors) {
        console.error(`[shutdown] recurso "${nome}" falhou ao fechar:`, erro);
    }
};
