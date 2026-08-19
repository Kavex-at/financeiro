/**
 * Declaração ambiente para `embedded-postgres`.
 *
 * O pacote publica `dist/index.d.ts`, mas seu `exports` é a string `"./dist/index.js"` — sem entrada
 * `types`. Com `moduleResolution: "bundler"`, o TypeScript segue o `exports` e não encontra as
 * declarações, embora o runtime resolva normalmente.
 *
 * Declaramos aqui apenas a superfície que o teste de integração usa, em vez de afrouxar o
 * `moduleResolution` do projeto inteiro por causa de uma devDependency.
 */
declare module 'embedded-postgres' {
    import type { Client } from 'pg';

    interface EmbeddedPostgresOptions {
        databaseDir: string;
        user: string;
        password: string;
        port: number;
        /** `false` apaga o cluster ao parar — o que queremos num teste. */
        persistent?: boolean;
    }

    export default class EmbeddedPostgres {
        constructor(options: EmbeddedPostgresOptions);
        initialise(): Promise<void>;
        start(): Promise<void>;
        stop(): Promise<void>;
        createDatabase(name: string): Promise<void>;
        getPgClient(): Client;
    }
}
