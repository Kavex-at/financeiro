import 'reflect-metadata';
// Carrega o .env ANTES dos imports que constroem o `conexosService` singleton.
import 'dotenv/config';
import { container } from 'tsyringe';
import { bootstrapAppContainer } from '../domain/appContainer.js';
import ConexosBaseClient from '../domain/client/ConexosBaseClient.js';

/**
 * SONDA READ-ONLY — o que é a tabela `fin055` (`FinBancosTpcontrib`)?
 *
 * O item SISPAG (`FinItemSispag`) carrega `fbtCod`/`fbtDesDescr`/`fbtEspCodbanco`. A hipótese H7
 * do tweak `sispag-ted-pix` é que isso seja a FINALIDADE do TED por banco. Esta sonda lista a
 * tabela para ver as descrições e os códigos de banco — só `/list`, nenhuma escrita.
 *
 * Run (HML por padrão):
 *   cd src/backend && CONEXOS_BASE_URL=https://columbiatrading-hml.conexos.cloud/api \
 *     databaseConnectionString="" npx tsx jobs/probe-fin055-tpcontrib.ts
 * Para PRD: PROBE_PRD=1.
 */
const BASE = process.env.CONEXOS_BASE_URL ?? '';
if (!BASE.includes('-hml') && process.env.PROBE_PRD !== '1') {
    console.error(`RECUSADO: base não é HML (${BASE}). Para PRD passe PROBE_PRD=1.`);
    process.exit(1);
}
const FILCOD = Number(process.env.PROBE_FILCOD ?? 1);

class ProbeFin055 {
    private base = container.resolve(ConexosBaseClient);

    public run = async (): Promise<void> => {
        await this.base.ensureSid();
        const { rows } = await this.base.listGenericPaginated<Record<string, unknown>>(
            'fin055/list',
            { fieldList: [], filterList: {}, serviceName: 'fin055', pageNumber: 1, pageSize: 500 },
            { filCod: FILCOD },
        );
        console.log(`fin055: ${rows.length} linha(s)`);
        console.table(
            rows.map((r) => ({
                bncCod: r.bncCod,
                banco: r.bncDesNome,
                febraban: r.bncNumCodbanco,
                fbtCod: r.fbtCod,
                descricao: r.fbtDesDescr,
                codBanco: r.fbtEspCodbanco,
            })),
        );
    };
}

const main = async (): Promise<void> => {
    await bootstrapAppContainer();
    await new ProbeFin055().run();
};
// Só a mensagem: o erro do axios carrega o `config` inteiro, e o body do `/login` tem a senha.
main().catch((e) => {
    console.error((e as Error).message);
    process.exit(1);
});
