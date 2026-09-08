import 'reflect-metadata';
import 'dotenv/config';
import { mkdirSync, writeFileSync } from 'node:fs';
import { container } from 'tsyringe';
import { bootstrapAppContainer } from '../domain/appContainer.js';
import ConexosBaseClient from '../domain/client/ConexosBaseClient.js';
import ConexosSispagWriteClient from '../domain/client/ConexosSispagWriteClient.js';

/**
 * TESTE DE ESCRITA — **SOMENTE HML** — `titVldReflexoDdaAssoc: 1` faz o ERP anexar o boleto?
 *
 * PERGUNTA (P0-2 de `ontology/_inbox/sispag-boleto-dda-sondagem.md`):
 * o barcode nunca está no título (0% em fin064/pendentes/com308). Ele só aparece como
 * `FinItemSispag.itsNumCodbar`, DEPOIS do import. O `TituloPendenteDTO` traz
 * `titVldReflexoDdaAssoc`, e o `importarTitulos` manda **0 fixo**. A hipótese é que
 * mandar **1** faça o ERP associar o boleto DDA e gravar `itsNumCodbar` sozinho.
 *
 * MÉTODO: num lote de teste em HML, importar o MESMO título duas vezes não dá — então
 * importa-se um título com `assoc: 1` e lê-se o item de volta. Se `itsNumCodbar` vier
 * preenchido e `vldVinculoDda = 1`, a hipótese está provada e o conserto é uma flag.
 *
 * ⚠️ ESCREVE em HML: cria um lote `fin015` e importa 1 título. Recusa qualquer base que
 * não seja `-hml`. Ao final CANCELA o lote de teste (a menos de MANTER_LOTE=1).
 *
 * Run:
 *   cd src/backend
 *   CONEXOS_BASE_URL=https://columbiatrading-hml.conexos.cloud/api tsx jobs/probe-dda-assoc-write-hml.ts          # levantamento
 *   CONEXOS_BASE_URL=https://columbiatrading-hml.conexos.cloud/api EXECUTAR=1 tsx jobs/probe-dda-assoc-write-hml.ts  # escreve
 */
const BASE = process.env.CONEXOS_BASE_URL ?? '';
if (!BASE.includes('-hml')) {
    console.error(`RECUSADO: este teste ESCREVE e só roda em HML. Base atual: ${BASE}`);
    process.exit(1);
}
const EXECUTAR = process.env.EXECUTAR === '1';
const FIL = Number(process.env.FIL ?? 2);
const OUT = '/tmp/dda-assoc-write-hml';
type Row = Record<string, unknown>;
const cheio = (v: unknown): boolean => v !== null && v !== undefined && v !== '';
const log = (s: string): void => console.log(`[dda-write] ${s}`);
const save = (n: string, d: unknown): void => {
    writeFileSync(`${OUT}/${n}`, JSON.stringify(d, null, 2));
    log(`  ↳ salvo ${OUT}/${n}`);
};

async function main(): Promise<void> {
    mkdirSync(OUT, { recursive: true });
    await bootstrapAppContainer();
    const base = container.resolve(ConexosBaseClient);
    const write = container.resolve(ConexosSispagWriteClient);
    await base.ensureSid();
    console.log('='.repeat(78));
    console.log(`BASE: ${BASE} (HML)  modo: ${EXECUTAR ? 'ESCRITA' : 'levantamento (dry)'}`);
    console.log('='.repeat(78));

    // ── 1. lote aberto existente, ou cria um ────────────────────────────────
    const lotes = await write.listarLotesNativos({ filCod: FIL, bncCod: 4 });
    log(
        `lotes fil=${FIL} bnc=4: ${lotes.length}; abertos(status=0): ${
            lotes
                .filter((l) => l.status === 0)
                .map((l) => l.flpCod)
                .join(',') || '—'
        }`,
    );
    let flpCod = lotes.find((l) => l.status === 0)?.flpCod;
    let loteCriado = false;

    // ── 2. pendentes com o flag de DDA ──────────────────────────────────────
    if (!flpCod) {
        if (!EXECUTAR) {
            log(
                'nenhum lote aberto — precisaria CRIAR um (só com EXECUTAR=1). Abortando levantamento.',
            );
            return;
        }
        const contas = await container
            .resolve((await import('../domain/client/ConexosSispagClient.js')).default)
            .listContasCorrentes(FIL);
        const itau = contas.find((c) => c.bncCod === 4) ?? contas[0];
        if (!itau) throw new Error('nenhuma conta pagadora em HML');
        log(`criando lote de teste na conta ccoCod=${itau.ccoCod} bnc=${itau.bncCod}…`);
        const hoje = new Date();
        const criado = await write.criarLote({
            filCod: FIL,
            conta: {
                bncCod: itau.bncCod,
                bncNumCodbanco: 341,
                ccoCod: itau.ccoCod,
                ccoNumConta: itau.numeroConta ?? 0,
                ccoEspDvconta: itau.dvConta ?? '',
                ccoEspAgcod: itau.agencia ?? '',
                conta: `${itau.numeroConta}-${itau.dvConta}`,
                layoutConta: `AG:${itau.agencia}/CT:${itau.numeroConta}-${itau.dvConta}`,
            },
            dataDebito: Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth(), hoje.getUTCDate()),
        });
        flpCod = criado.flpCod;
        loteCriado = true;
        log(`lote de teste criado: flp=${flpCod}`);
    }

    const page = await base.listGenericPaginated<Row>(
        `fin015/finItemSispag/titulosPendentes/list/${FIL}/4/${flpCod}`,
        { fieldList: [], filterList: {}, serviceName: 'fin015', pageNumber: 1, pageSize: 500 },
        { filCod: FIL },
    );
    const pendentes = page.rows ?? [];
    const comFlag = pendentes.filter((r) => Number(r.titVldReflexoDdaAssoc ?? 0) === 1);
    log(`pendentes: ${pendentes.length} lidos; com titVldReflexoDdaAssoc=1: ${comFlag.length}`);
    save('pendentes-com-flag.json', comFlag.slice(0, 20));

    const alvo = comFlag[0] ?? pendentes[0];
    if (!alvo) {
        log('nenhum pendente — nada a testar.');
        return;
    }
    log(
        `alvo: doc=${alvo.docCod}/${alvo.titCod} valor=${alvo.titMnyValor} venc=${alvo.titDtaVencimento} flagDda=${alvo.titVldReflexoDdaAssoc}`,
    );

    if (!EXECUTAR) {
        log('\nLEVANTAMENTO apenas. Para escrever: EXECUTAR=1');
        return;
    }

    // ── 3. import COM a flag de associação DDA ──────────────────────────────
    const valor = Number(alvo.titMnyValor ?? 0);
    const item = {
        ...alvo,
        filCodLote: FIL,
        bncCod: 4,
        flpCod,
        itsVldModalidade: 6, // boleto mesmo banco (medido: 6 = Itaú, 7 = outro banco)
        itsEspNomeFav: alvo.dpeNomPessoa,
        itsMnyValor: valor,
        itsMnyVlrPgto: valor,
        titMnyLiquido: valor,
        itsDtaPgto: Number(alvo.titDtaVencimento ?? 0),
        vldOk: 1,
        vldImporta: 1,
        avisos: '[]',
    };
    const selecao = {
        op: 1,
        bncCodFin015: 4,
        titVldReflexoDdaAssoc: 1,
        titVldReflexoDdaDesassoc: 0,
    };
    log('POST titulosPendentes/importar com titVldReflexoDdaAssoc=1 …');
    try {
        await base.postGenericOnce(
            'fin015/finItemSispag/titulosPendentes/importar',
            { items: [{ ...item, ...selecao }], ...selecao },
            { filCod: FIL },
        );
        log('import OK');
    } catch (err) {
        const data = (err as { response?: { data?: unknown } })?.response?.data;
        log(`import FALHOU: ${JSON.stringify(data ?? (err as Error).message).slice(0, 600)}`);
        save('erro-import.json', data ?? String(err));
    }

    // ── 4. lê o item de volta — o ERP anexou o barcode? ─────────────────────
    const itensPage = await base.listGenericPaginated<Row>(
        `fin015/finItemSispag/list/${FIL}/4/${flpCod}`,
        { fieldList: [], filterList: {}, serviceName: 'fin015', pageNumber: 1, pageSize: 200 },
        { filCod: FIL },
    );
    const itens = itensPage.rows ?? [];
    save('itens-apos-import.json', itens);
    console.log('='.repeat(78));
    console.table(
        itens.map((i) => ({
            docCod: i.docCod,
            titCod: i.titCod,
            modalidade: i.itsVldModalidade,
            itsNumCodbar: cheio(i.itsNumCodbar) ? String(i.itsNumCodbar) : '— VAZIO —',
            vldVinculoDda: i.vldVinculoDda,
        })),
    );
    const alvoImportado = itens.find((i) => String(i.docCod) === String(alvo.docCod));
    console.log(
        alvoImportado && cheio(alvoImportado.itsNumCodbar)
            ? '\n✅ HIPÓTESE CONFIRMADA: o ERP anexou o barcode sozinho.'
            : '\n❌ HIPÓTESE REFUTADA: o item entrou SEM barcode — a flag não basta.',
    );
    console.log('='.repeat(78));

    if (loteCriado && process.env.MANTER_LOTE !== '1') {
        log(`limpando: cancelando lote de teste flp=${flpCod}…`);
        try {
            await base.putGenericOnce(`fin015/cancelar/${FIL}/4/${flpCod}`, {}, { filCod: FIL });
            log('lote cancelado');
        } catch (err) {
            log(
                `⚠️ NÃO consegui cancelar o lote ${flpCod} — cancelar à mão em HML. ${(err as Error).message}`,
            );
        }
    }
}
main().catch((e) => {
    console.error(e);
    process.exit(1);
});
