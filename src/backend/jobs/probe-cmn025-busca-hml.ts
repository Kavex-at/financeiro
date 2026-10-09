import 'reflect-metadata';
import { container } from 'tsyringe';
import ConexosBaseClient from '../domain/client/ConexosBaseClient.js';
import { bootstrapAppContainer } from '../domain/appContainer.js';

/**
 * Sonda READ-ONLY do `cmn025/list` em HOMOLOGAÇÃO: como o filtro `#LIKE` se comporta em nome
 * (`dpeNomPessoa`, `dpeNomFantasia`) e documento (`pdcDocFederal`), para a busca de favorecido do
 * pedido de autorização. Perguntas: é "contém" ou "começa com"? Diferencia maiúscula? Acento?
 * Aceita `%`? Em que formato vem o documento? `count` > `rows` (página única)?
 *
 * SEGURANÇA: recusa base que não seja HML; um login só; nunca imprime documento (só o formato).
 * Run: CONEXOS_BASE_URL=https://columbiatrading-hml.conexos.cloud/api databaseConnectionString="" \
 *      tsx jobs/probe-cmn025-busca-hml.ts
 */
const BASE = process.env.CONEXOS_BASE_URL ?? '';
if (!BASE.includes('-hml')) {
    console.error(`RECUSADO: base não é HML (${BASE}). Aponte CONEXOS_BASE_URL p/ *-hml* antes.`);
    process.exit(1);
}

const CAMPOS = ['pesCod', 'dpeNomPessoa', 'dpeNomFantasia', 'pdcDocFederal', 'pesVldStatus'];
const FIL = Number(process.env.PROBE_FIL ?? 1);

const formato = (v: unknown): string => String(v ?? 'null').replace(/\d/g, '9');

async function main(): Promise<void> {
    await bootstrapAppContainer();
    const c = container.resolve(ConexosBaseClient);
    await c.ensureSid();
    console.log(`[hml] login OK · base=${BASE} · fil=${FIL}`);

    const consulta = async (rotulo: string, filterList: Record<string, unknown>) => {
        try {
            const r = await c.listGenericPaginated<Record<string, unknown>>(
                'cmn025/list',
                {
                    fieldList: CAMPOS,
                    filterList,
                    serviceName: 'cmn025',
                    pageNumber: 1,
                    pageSize: 10,
                },
                { filCod: FIL },
            );
            const nomes = r.rows
                .slice(0, 4)
                .map(
                    (x) =>
                        `${x.pesCod}:${x.dpeNomPessoa} [${x.dpeNomFantasia ?? '-'}] st${x.pesVldStatus} doc=${formato(x.pdcDocFederal)}`,
                );
            console.log(`${rotulo.padEnd(42)} count=${r.count} rows=${r.rows.length}`);
            for (const n of nomes) console.log(`      ${n}`);
            return r.rows;
        } catch (e) {
            console.log(`${rotulo.padEnd(42)} ERRO ${e instanceof Error ? e.message : String(e)}`);
            return [];
        }
    };

    // 1) Nome: contém × começa com × caixa × curinga.
    await consulta('nome LIKE "ITAU"', { 'dpeNomPessoa#LIKE': 'ITAU' });
    await consulta('nome LIKE "itau"', { 'dpeNomPessoa#LIKE': 'itau' });
    await consulta('nome LIKE "%ITAU%"', { 'dpeNomPessoa#LIKE': '%ITAU%' });
    await consulta('nome LIKE "UNIBANCO" (meio do nome)', { 'dpeNomPessoa#LIKE': 'UNIBANCO' });
    await consulta('nome LIKE "LTDA"', { 'dpeNomPessoa#LIKE': 'LTDA' });
    // 2) Acento.
    await consulta('nome LIKE "SAO PAULO"', { 'dpeNomPessoa#LIKE': 'SAO PAULO' });
    await consulta('nome LIKE "SÃO PAULO"', { 'dpeNomPessoa#LIKE': 'SÃO PAULO' });
    // 3) Fantasia.
    await consulta('fantasia LIKE "ITAU"', { 'dpeNomFantasia#LIKE': 'ITAU' });
    // 4) Status (só ativos).
    await consulta('nome LIKE "LTDA" + status 1', {
        'dpeNomPessoa#LIKE': 'LTDA',
        'pesVldStatus#EQ': 1,
    });
    // 5) Documento: pega um da amostra e testa EQ cru, EQ só dígitos, LIKE prefixo.
    const amostra = await consulta('amostra com documento', { 'dpeNomPessoa#LIKE': 'LTDA' });
    const doc = amostra
        .map((x) => x.pdcDocFederal)
        .find((d) => typeof d === 'string' && d.length > 0);
    if (typeof doc === 'string') {
        const digitos = doc.replace(/\D/g, '');
        await consulta('doc EQ (como veio)', { 'pdcDocFederal#EQ': doc });
        await consulta('doc EQ (só dígitos)', { 'pdcDocFederal#EQ': digitos });
        await consulta('doc LIKE (8 primeiros dígitos)', {
            'pdcDocFederal#LIKE': digitos.slice(0, 8),
        });
        await consulta('doc LIKE (miolo 3..10)', { 'pdcDocFederal#LIKE': digitos.slice(3, 10) });
    } else {
        console.log('sem documento na amostra');
    }
    // 6) Código.
    await consulta('pesCod EQ 1', { 'pesCod#EQ': 1 });
    console.log('[hml] READ-ONLY. Fim.');
}

main().catch((e) => {
    console.error('[hml] FATAL:', e instanceof Error ? e.message : String(e));
    process.exit(1);
});
