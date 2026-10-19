import 'reflect-metadata';
import 'dotenv/config';
import { writeFileSync } from 'node:fs';
import { container } from 'tsyringe';
import { bootstrapAppContainer } from '../domain/appContainer.js';
import ConexosGedClient from '../domain/client/ConexosGedClient.js';
import { DOC_TIP_PAGAR } from '../domain/interface/sispag/GedArquivo.js';
import ExtratorTextoPdf from '../domain/libs/pdf/ExtratorTextoPdf.js';
import type { TituloAPagar } from '../domain/interface/sispag/SispagInterface.js';
import LeitorDpsService from '../domain/service/sispag/LeitorDpsService.js';

/**
 * VALIDAÇÃO AO VIVO, SOMENTE LEITURA (ADR-0073, D2) — roda o leitor de DPS de verdade (com298 →
 * arq020 → PDF → DANFSe) em títulos com DPS conhecido ou previsto e compara. NÃO grava nada:
 * usa `LeitorDpsService.lerTitulo`. Uma execução = um login no Conexos.
 *
 * Run (de src/backend), sem tocar o slot de sessão do robô:
 *   databaseConnectionString="" PROBE_PRD=1 npx tsx jobs/validate-sispag-leitura-dps-v1.ts
 * Com `VALIDATE_OUT=<pasta>`, o PDF e os trechos de texto posicionados de cada título NÃO lido são
 * salvos lá (`<docCod>.pdf`, `<docCod>.itens.json`) para calibrar o leitor do DANFSe.
 */
if (process.env.PROBE_PRD !== '1' || process.env.databaseConnectionString !== '') {
    console.error('RECUSADO: rode com PROBE_PRD=1 e databaseConnectionString="".');
    process.exit(1);
}

/** DPS visto no PDF (41155) e previstos pela ordem/offset (2026-10-19). */
const CASOS: Array<{
    filCod: number;
    docCod: string;
    nfse: string;
    esperado: string;
    fonte: string;
}> = [
    { filCod: 2, docCod: '41155', nfse: '86666', esperado: '776132', fonte: 'PDF (print)' },
    { filCod: 2, docCod: '41156', nfse: '86672', esperado: '776138', fonte: 'ordem' },
    { filCod: 2, docCod: '41087', nfse: '86065', esperado: '775530', fonte: 'ordem' },
    { filCod: 2, docCod: '37186', nfse: '186038', esperado: '164646', fonte: 'offset' },
    { filCod: 4, docCod: '10463', nfse: '18998', esperado: '25459', fonte: 'offset' },
];

async function main(): Promise<void> {
    await bootstrapAppContainer();
    const leitor = container.resolve(LeitorDpsService);
    let confere = 0;
    for (const c of CASOS) {
        const titulo = {
            filCod: c.filCod,
            docCod: c.docCod,
            titCod: '1',
            pesCod: '386',
            numeroDocumento: c.nfse,
        } as unknown as TituloAPagar;
        const r = await leitor.lerTitulo(titulo);
        if (r.status !== 'LIDO' && r.arquivo && process.env.VALIDATE_OUT) {
            await salvarParaCalibrar(titulo, r.arquivo, process.env.VALIDATE_OUT);
        }
        const ok = r.dps === c.esperado;
        if (ok) confere += 1;
        console.log(
            `${c.filCod}:${c.docCod} NFS-e ${c.nfse} → ${r.status} dps=${r.dps ?? '-'} ` +
                `esperado=${c.esperado} (${c.fonte}) ${ok ? 'CONFERE' : 'DIVERGE'}` +
                `${r.arquivo ? ` arquivo=${r.arquivo}` : ''}${r.motivo ? ` motivo="${r.motivo}"` : ''}`,
        );
    }
    console.log(`\n${confere}/${CASOS.length} conferem`);
}

/** Refaz o caminho do GED só para guardar o PDF e o texto que o leitor não entendeu. */
const salvarParaCalibrar = async (t: TituloAPagar, arquivo: string, pasta: string) => {
    const ged = container.resolve(ConexosGedClient);
    const doc = { filCod: t.filCod, docCod: t.docCod, docTip: DOC_TIP_PAGAR };
    const priCod = await ged.priCodDoDocumento(doc);
    if (priCod === undefined) return;
    for (const p of await ged.pastasDoDocumento({ ...doc, priCod })) {
        const a = (await ged.arquivosDaPasta(p.dcmCod, doc)).find((x) => x.nome === arquivo);
        if (!a) continue;
        const bytes = await ged.baixarArquivo({ ...a, filCod: t.filCod });
        writeFileSync(`${pasta}/${t.docCod}.pdf`, bytes);
        const itens = await container.resolve(ExtratorTextoPdf).extrair(bytes);
        writeFileSync(`${pasta}/${t.docCod}.itens.json`, JSON.stringify(itens, null, 1));
        console.log(`   salvo para calibrar: ${pasta}/${t.docCod}.{pdf,itens.json}`);
        return;
    }
};

main().then(
    () => process.exit(0),
    (e) => {
        console.error('validação FALHOU:', e instanceof Error ? e.message : String(e));
        process.exit(1);
    },
);
