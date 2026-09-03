import 'reflect-metadata';
import 'dotenv/config';
import { container } from 'tsyringe';
import { bootstrapAppContainer } from '../domain/appContainer.js';
import ConexosExtratoClient from '../domain/client/ConexosExtratoClient.js';

/**
 * Validação READ-ONLY do `ConexosExtratoClient` contra o Conexos real.
 *
 * Prova que `listContas` + `listLancamentos` mapeiam corretamente antes de a
 * ingestão ser construída em cima — mesmo papel de `validate-fin015-tools.ts`.
 * Nenhuma escrita.
 *
 * Run: PROBE_ALLOW_PRD=1 FIL=1 tsx jobs/validate-extrato-client.ts
 */
const BASE = process.env.CONEXOS_BASE_URL ?? '';
if (!BASE.includes('-hml') && process.env.PROBE_ALLOW_PRD !== '1') {
    console.error(`RECUSADO: base é PRODUÇÃO (${BASE}). Use PROBE_ALLOW_PRD=1.`);
    process.exit(1);
}

const FIL_COD = Number(process.env.FIL ?? 1);
const DIAS = Number(process.env.DIAS ?? 90);

async function main(): Promise<void> {
    await bootstrapAppContainer();
    const client = container.resolve(ConexosExtratoClient);

    const contas = await client.listContas(FIL_COD);
    const comMovimento = contas.filter((c) => (c.qtdeBanco ?? 0) > 0 || (c.qtdeSistema ?? 0) > 0);
    console.log(
        `[validate] filial ${FIL_COD}: ${contas.length} contas, ${comMovimento.length} com movimento`,
    );
    for (const c of comMovimento) {
        console.log(
            `  gerNum ${c.gerNum} · ${c.gerDes} · banco ${c.qtdeBanco}/sist ${c.qtdeSistema}`,
        );
    }

    const ate = new Date();
    const de = new Date(ate.getTime() - DIAS * 24 * 60 * 60 * 1000);
    let totalCreditos = 0;
    let conciliados = 0;
    const porCategoria = new Map<string, number>();
    const porPrefixo = new Map<string, number>();

    for (const c of comMovimento) {
        const lancamentos = await client.listLancamentos({
            filCod: FIL_COD,
            gerNum: c.gerNum,
            de,
            ate,
        });
        totalCreditos += lancamentos.length;
        console.log(`\n[validate] conta ${c.gerNum}: ${lancamentos.length} créditos em ${DIAS}d`);
        for (const l of lancamentos) {
            const cat = `${l.categoria ?? '—'} · ${l.categoriaDesc ?? '—'}`;
            porCategoria.set(cat, (porCategoria.get(cat) ?? 0) + 1);
            // Agrupa o histórico pelo prefixo (as primeiras 2 palavras) — é o que
            // distingue "MOV TIT COB" de "TED-CRÉDITO" de "SISPAG <cliente>".
            const prefixo = (l.historico ?? '—').trim().split(/\s+/).slice(0, 2).join(' ');
            porPrefixo.set(prefixo, (porPrefixo.get(prefixo) ?? 0) + 1);
            if (l.conciliadoNoErp) conciliados += 1;
        }
    }

    const top = (m: Map<string, number>, n: number) =>
        [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);

    console.log(
        `\n[validate] TOTAL de créditos em ${DIAS}d na filial ${FIL_COD}: ${totalCreditos}`,
    );
    console.log(`[validate] já conciliados no ERP: ${conciliados}`);
    console.log('\n[validate] por CATEGORIA:');
    for (const [k, v] of top(porCategoria, 20)) console.log(`   ${String(v).padStart(5)} · ${k}`);
    console.log('\n[validate] por PREFIXO de histórico:');
    for (const [k, v] of top(porPrefixo, 25)) console.log(`   ${String(v).padStart(5)} · ${k}`);
}

main().catch((e) => {
    console.error('[validate] FALHOU:', e);
    process.exit(1);
});
