import 'reflect-metadata';
import 'dotenv/config';
import './hmlEnvFile.js';
import { container } from 'tsyringe';
import { bootstrapAppContainer } from '../domain/appContainer.js';
import ConexosBaseClient from '../domain/client/ConexosBaseClient.js';

/**
 * LEITURA em HML: compara os campos preenchidos de um item de boleto COMPLETO (de um lote que
 * já gerou remessa) com os do item que editamos, para descobrir o que o `finalizar` chama de
 * "dados incompletos". Só `list`. Recusa base não-HML.
 *
 *   FLP_OK=<lote com item de boleto completo> FLP=<lote de teste>
 */
const BASE = process.env.CONEXOS_BASE_URL ?? '';
if (!BASE.includes('-hml')) {
    console.error(`RECUSADO: só roda em HML. Base atual: ${BASE}`);
    process.exit(1);
}
const FIL = Number(process.env.FIL ?? 2);
const BNC = Number(process.env.BNC ?? 4);
type Row = Record<string, unknown>;
const cheio = (v: unknown): boolean => v !== null && v !== undefined && v !== '' && v !== '[]';

async function main(): Promise<void> {
    await bootstrapAppContainer();
    const base = container.resolve(ConexosBaseClient);
    await base.ensureSid();
    const itens = async (flp: number): Promise<Row[]> =>
        (
            await base.listGenericPaginated<Row>(
                `fin015/finItemSispag/list/${FIL}/${BNC}/${flp}`,
                {
                    fieldList: [],
                    filterList: {},
                    serviceName: 'fin015',
                    pageNumber: 1,
                    pageSize: 500,
                },
                { filCod: FIL },
            )
        ).rows ?? [];
    const ok = await itens(Number(process.env.FLP_OK ?? 26));
    const meu = await itens(Number(process.env.FLP ?? 36));
    console.log(`lote completo: ${ok.length} itens · lote de teste: ${meu.length} itens`);
    const modelo =
        ok.find((i) => Number(i.itsVldModalidade) >= 6 && cheio(i.itsNumCodbar)) ?? ok[0];
    if (!modelo) return console.log('nenhum item de referência.');
    console.log(
        `referência: doc=${String(modelo.docCod)}/${String(modelo.titCod)} modalidade=${String(modelo.itsVldModalidade)} vldVinculoDda=${String(modelo.vldVinculoDda)}`,
    );
    for (const it of meu) {
        const faltando = Object.keys(modelo).filter((k) => cheio(modelo[k]) && !cheio(it[k]));
        const diferentes = Object.keys(modelo)
            .filter((k) => cheio(modelo[k]) && cheio(it[k]) && String(modelo[k]) !== String(it[k]))
            .filter(
                (k) =>
                    !/^(doc|tit|fil|flp|its(Cod|Dta|Mny|Esp(Nome|Num))|dpe|pes|usn|tim|dta|vld(Ok|Importa))/i.test(
                        k,
                    ),
            )
            .slice(0, 12);
        console.log(
            `\nitem ${String(it.docCod)}/${String(it.titCod)} (modalidade ${String(it.itsVldModalidade)})`,
        );
        console.log('  preenchidos no completo e VAZIOS aqui:', JSON.stringify(faltando));
        console.log(
            '  diferentes (amostra):',
            JSON.stringify(
                Object.fromEntries(diferentes.map((k) => [k, [modelo[k], it[k]]])),
            ).slice(0, 700),
        );
    }
}

main()
    .then(() => process.exit(0))
    .catch((e) => {
        console.error('FALHOU:', e instanceof Error ? e.message : String(e));
        process.exit(1);
    });
