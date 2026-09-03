import { container } from 'tsyringe';
import PostgreeDatabaseClient from '../domain/client/database/PostgreeDatabaseClient.js';
import { closeConexosSessionStorePool } from '../services/conexosSessionStore.js';
import { type Closeable, closeAll } from './lifecycle.js';

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
const resources = (): Closeable[] => [
    // Pool primário (max 5) — `PostgreeDatabaseClient.close()`.
    container.resolve(PostgreeDatabaseClient),
    // Pool do session store (max 2), criado no load do módulo.
    { close: closeConexosSessionStorePool },
];

/**
 * Libera todos. Nunca rejeita: um recurso quebrado não pode travar a saída e
 * transformar um shutdown limpo em SIGKILL. Os erros são logados aqui.
 */
export const closeProcessResources = async (): Promise<void> => {
    const { errors } = await closeAll(resources());
    for (const error of errors) {
        console.error('[shutdown] recurso falhou ao fechar:', error);
    }
};
