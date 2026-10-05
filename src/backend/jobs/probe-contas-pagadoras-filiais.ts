import 'reflect-metadata';
import 'dotenv/config';
import { container } from 'tsyringe';
import { bootstrapAppContainer } from '../domain/appContainer.js';
import ConexosBaseClient from '../domain/client/ConexosBaseClient.js';
import ConexosSispagClient from '../domain/client/ConexosSispagClient.js';
import { CONTA_PAGADORA_DEFAULT } from '../domain/interface/sispag/SispagInterface.js';
import ContaPagadoraResolver, {
    formatarContaPagadora,
} from '../domain/service/sispag/ContaPagadoraResolver.js';

/**
 * Probe READ-ONLY (G-13): contas pagadoras (`fin005/list`) de cada filial e a conta que o
 * `ContaPagadoraResolver` escolheria. Rode ANTES de subir o G-13: a remessa deixou de cair na
 * "primeira conta da filial" quando a conta do lote não existe, então toda filial cuja conta
 * Itaú não seja a esperada precisa ser conhecida antes — senão o lote recusa na remessa.
 *
 * Só lê (`fin005/list`, `ger…/filiais`). Não escreve no Conexos nem no Postgres.
 *
 * Run (credencial de ANALISTA ou do robô, com a janela combinada; um login local em PRD ocupa
 * um dos ~3 slots de sessão e, com `databaseConnectionString` preenchido, grava a sessão no slot
 * do robô — por isso o banco vai vazio):
 *   cd src/backend
 *   databaseConnectionString= CONEXOS_BASE_URL=... CONEXOS_USERNAME=... CONEXOS_PASSWORD=... \
 *     tsx jobs/probe-contas-pagadoras-filiais.ts
 */
const main = async (): Promise<void> => {
    await bootstrapAppContainer();
    const base = container.resolve(ConexosBaseClient);
    const sispag = container.resolve(ConexosSispagClient);
    const resolver = container.resolve(ContaPagadoraResolver);

    const filiais = (await base.getFiliais())
        .map((f) => f.filCod)
        .filter((n): n is number => typeof n === 'number')
        .sort((a, b) => a - b);

    console.log(`conta preferida (desempate): ${CONTA_PAGADORA_DEFAULT.conta}`);
    for (const filCod of filiais) {
        const contas = await sispag.listContasCorrentes(filCod);
        const escolhida = await resolver.resolverPadrao(filCod);
        console.log(`\nfilial ${filCod} — ${contas.length} conta(s) no fin005`);
        for (const c of contas) {
            console.log(
                `  bncCod ${c.bncCod} · ag ${c.agencia ?? '—'} · ${formatarContaPagadora(c)} · ccoCod ${c.ccoCod}`,
            );
        }
        console.log(
            escolhida
                ? `  → resolver escolhe: ${escolhida.banco} ${escolhida.conta}`
                : '  → resolver NÃO escolhe (lote nasceria sem conta; a analista escolhe)',
        );
    }
};

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(
            '[probe-contas-pagadoras] FALHOU:',
            error instanceof Error ? error.message : error,
        );
        process.exit(1);
    });
