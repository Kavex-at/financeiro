import 'reflect-metadata';
import 'dotenv/config';
import PostgreeDatabaseClient from '../domain/client/database/PostgreeDatabaseClient.js';
import type { DesfechoTitulo, DpsConhecido } from '../domain/interface/sispag/SugestaoBoleto.js';
import CodigoBarrasBoleto from '../domain/libs/boleto/CodigoBarrasBoleto.js';
import BankingCalendar from '../domain/libs/calendar/BankingCalendar.js';
import type EnvironmentProvider from '../domain/libs/environment/EnvironmentProvider.js';
import BoletoDdaRepository from '../domain/repository/sispag/BoletoDdaRepository.js';
import TituloAPagarRepository from '../domain/repository/sispag/TituloAPagarRepository.js';
import AncoraOrdemDps from '../domain/service/sispag/AncoraOrdemDps.js';
import MotorSugestaoBoleto from '../domain/service/sispag/MotorSugestaoBoleto.js';
import RegraSugestaoBoleto from '../domain/service/sispag/RegraSugestaoBoleto.js';

/**
 * VALIDAÇÃO SOMENTE LEITURA (ADR-0073, I15p) — roda o motor de sugestão sobre a carteira e o pool DDA
 * persistidos, SEM e COM um DPS conhecido (o do PDF do título 41155/1, NFS-e 86666, DPS 776132), e
 * mostra o que a âncora DPS muda para a MULTILOG. Nada é gravado: o DPS entra só em memória.
 *
 * Não usa `bootstrapAppContainer` (que roda migrations no banco apontado). Não fala com o Conexos.
 * Run: cd src/backend && databaseConnectionString=<url> npx tsx jobs/validate-sispag-ancora-dps-v1.ts
 */
const MULTILOG = '386';
const DPS_PDF: DpsConhecido = {
    filCod: 2,
    docCod: '41155',
    titCod: '1',
    pesCod: MULTILOG,
    nfse: '86666',
    dps: '776132',
};
/** Previsões feitas pela ordem antes de ver o PDF (2026-10-19). */
const PREVISOES: Array<{ chave: string; boleto: string }> = [
    { chave: '2:41156:1', boleto: '776138000' },
    { chave: '2:37186:1', boleto: '164646000' },
    { chave: '4:10463:1', boleto: '25459000' },
];

const chave = (d: { filCod: number; docCod: string; titCod: string }): string =>
    `${d.filCod}:${d.docCod}:${d.titCod}`;

const escolhido = (d: DesfechoTitulo) => d.candidatos.find((c) => c.confirmavel);

async function main(): Promise<void> {
    const url = process.env.databaseConnectionString ?? '';
    if (!url) throw new Error('databaseConnectionString vazio');
    const env = { getEnvironmentVars: async () => ({ databaseConnectionString: url }) };
    const db = new PostgreeDatabaseClient(env as unknown as EnvironmentProvider);
    await db.init();
    try {
        const [titulos, boletos] = await Promise.all([
            new TituloAPagarRepository(db).listAtivos(),
            new BoletoDdaRepository(db).listBoletos({}),
        ]);
        const motor = new MotorSugestaoBoleto(
            new CodigoBarrasBoleto(),
            BankingCalendar.withClock(() => new Date()),
            new RegraSugestaoBoleto(),
            new AncoraOrdemDps(),
        );
        const base = { titulos, boletos, paresVigentes: [], rejeitadas: [], confirmadas: [] };
        const antes = motor.desfechos(base);
        const depois = motor.desfechos({ ...base, dps: [DPS_PDF] });
        const antesPorChave = new Map(antes.map((d) => [chave(d), d]));

        const multilog = depois.filter((d) => d.pesCod === MULTILOG);
        console.log(`carteira ${titulos.length} títulos, pool ${boletos.length} boletos`);
        console.log(`MULTILOG elegíveis: ${multilog.length}`);
        const contar = (ds: DesfechoTitulo[]) =>
            ds.reduce<Record<string, number>>((acc, d) => {
                acc[d.situacao] = (acc[d.situacao] ?? 0) + 1;
                return acc;
            }, {});
        console.log('situação ANTES :', contar(antes.filter((d) => d.pesCod === MULTILOG)));
        console.log('situação DEPOIS:', contar(multilog));

        const mudaram = multilog.filter((d) => {
            const a = antesPorChave.get(chave(d));
            return (
                a?.situacao !== d.situacao ||
                escolhido(a)?.numeroBoleto !== escolhido(d)?.numeroBoleto
            );
        });
        console.log(`\nMULTILOG com desfecho alterado pela âncora DPS: ${mudaram.length}`);
        for (const d of mudaram) {
            const a = antesPorChave.get(chave(d));
            const c = escolhido(d);
            const sinais = (c?.avaliacao.sinais ?? []).filter((s) => s.includes('DPS'));
            console.log(
                `  ${chave(d)} R$ ${d.valorTitulo} venc ${d.vencimentoTitulo}: ` +
                    `${a?.situacao} → ${d.situacao} ${c?.numeroBoleto ?? '-'} [${sinais.join(',')}]`,
            );
        }

        console.log('\nPrevisões:');
        for (const p of PREVISOES) {
            const d = depois.find((x) => chave(x) === p.chave);
            const c = d ? escolhido(d) : undefined;
            const dps = (c?.avaliacao.sinais ?? []).filter((s) => s.includes('DPS'));
            const veredito = !d
                ? 'título fora da carteira elegível'
                : c?.numeroBoleto === p.boleto
                  ? `escolhido = previsto (${d.situacao}, âncora DPS: ${dps.join(',') || 'nenhuma'})`
                  : `DIVERGE (situação ${d.situacao}, escolhido ${c?.numeroBoleto ?? '-'})`;
            console.log(`  ${p.chave} → ${p.boleto}: ${veredito}`);
        }

        // Nenhum título fora da MULTILOG pode mudar: a prova é só do escopo (386, emissor do 776132000).
        const outros = depois.filter((d) => {
            if (d.pesCod === MULTILOG) return false;
            const a = antesPorChave.get(chave(d));
            return (
                a?.situacao !== d.situacao ||
                escolhido(a)?.numeroBoleto !== escolhido(d)?.numeroBoleto
            );
        });
        console.log(`\nOutros credores alterados (esperado 0): ${outros.length}`);
    } finally {
        await db.close();
    }
}

main().then(
    () => process.exit(0),
    (e) => {
        console.error(e);
        process.exit(1);
    },
);
