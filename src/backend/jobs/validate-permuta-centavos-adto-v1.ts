import 'reflect-metadata';
import 'dotenv/config';
import pg from 'pg';
import ReconciliacaoPermutaService from '../domain/service/permutas/ReconciliacaoPermutaService.js';

/**
 * Ground-Truth Validation — `permuta-centavos-adto` (v1). ADR-0062, I-Write-10.
 *
 * Ground truth: o `request_payload` de cada execução REAL em `permuta_alocacao_execucao` — o que foi
 * enviado ao `fin010`, com o `bxaMnyValorPermuta` que o PRÓPRIO ERP devolveu no passo 3 (o
 * disponível vivo do adto naquele borderô). Reaplica a função de PRODUÇÃO
 * (`limitarAoDisponivelDoAdto`, instanciada com stubs — um validador que reescreve a fórmula
 * valida a si mesmo) e classifica:
 *   - IDENTICO     — sem excesso: a saída tem de ser byte-idêntica à entrada;
 *   - FECHADO      — excesso em (0; R$1,00]: o líquido tem de fechar EXATAMENTE no disponível;
 *   - FORA_TETO    — excesso > R$1,00: nada pode mudar (não é arredondamento);
 *   - DIVERGENTE   — qualquer violação acima → gate falhando (P0).
 *
 * READ-ONLY: só `SELECT`, numa transação `READ ONLY` verificada antes da leitura. Zero chamadas ao
 * Conexos (o dado do ERP já está no payload gravado).
 *
 * Run:
 *   cd src/backend && npx tsx jobs/validate-permuta-centavos-adto-v1.ts
 */
type Ajuste = { juros: number; desconto: number };
type Limitar = (p: {
    bxaMnyValorPermuta?: number;
    bxaMnyValor: number;
    juros: number;
    desconto: number;
    isDesconto: boolean;
    adiantamentoDocCod: number;
    invoiceDocCod: number;
    titCod: number;
}) => Promise<Ajuste>;

const round2 = (n: number): number => Math.round(n * 100) / 100;

const main = async (): Promise<void> => {
    const silent = { info: async () => {}, warn: async () => {}, error: async () => {} };
    const stub = {} as never;
    const service = new ReconciliacaoPermutaService(
        stub,
        stub,
        stub,
        stub,
        stub,
        stub,
        stub,
        silent as never,
        stub,
        stub,
    );
    const limitar = (service as unknown as { limitarAoDisponivelDoAdto: Limitar })
        .limitarAoDisponivelDoAdto;

    const client = new pg.Client({
        connectionString: process.env.databaseConnectionString,
        ssl: { rejectUnauthorized: false },
    });
    await client.connect();
    await client.query('BEGIN TRANSACTION READ ONLY');
    const ro = await client.query('SHOW transaction_read_only');
    if (ro.rows[0]?.transaction_read_only !== 'on') throw new Error('transação não é read-only');

    const { rows } = await client.query(
        `SELECT bor_cod, adiantamento_doc_cod, invoice_doc_cod, request_payload
           FROM permuta_alocacao_execucao
          WHERE dry_run = false AND request_payload ? 'bxaMnyValorPermuta'
          ORDER BY id`,
    );
    await client.query('ROLLBACK');
    await client.end();

    const contagem: Record<string, number> = {
        IDENTICO: 0,
        FECHADO: 0,
        FORA_TETO: 0,
        DIVERGENTE: 0,
    };
    for (const r of rows) {
        const p = r.request_payload as Record<string, number | null>;
        const disp = p.bxaMnyValorPermuta;
        if (disp === null || disp === undefined) continue;
        const bxaMnyValor = Number(p.bxaMnyValor);
        const juros = Number(p.bxaMnyJuros ?? 0);
        const desconto = Number(p.bxaMnyDesconto ?? 0);
        const isDesconto = p.bxaCodGerDesconto !== null && p.bxaCodGerDesconto !== undefined;
        const out = await limitar({
            bxaMnyValorPermuta: Number(disp),
            bxaMnyValor,
            juros,
            desconto,
            isDesconto,
            adiantamentoDocCod: Number(r.adiantamento_doc_cod),
            invoiceDocCod: Number(r.invoice_doc_cod),
            titCod: Number(p.titCod),
        });
        const excesso = round2(round2(bxaMnyValor + juros - desconto) - Number(disp));
        const liqDepois = round2(bxaMnyValor + out.juros - out.desconto);
        const intocado = out.juros === juros && out.desconto === desconto;

        let veredito: string;
        if (excesso <= 0) veredito = intocado ? 'IDENTICO' : 'DIVERGENTE';
        else if (excesso <= 1) veredito = liqDepois === Number(disp) ? 'FECHADO' : 'DIVERGENTE';
        else veredito = intocado ? 'FORA_TETO' : 'DIVERGENTE';
        contagem[veredito] = (contagem[veredito] ?? 0) + 1;

        if (veredito !== 'IDENTICO') {
            console.log(
                `${veredito.padEnd(10)} borderô ${r.bor_cod} adto ${r.adiantamento_doc_cod} × inv ${r.invoice_doc_cod}` +
                    ` tit ${p.titCod}: disponível ${disp} · líquido ${round2(bxaMnyValor + juros - desconto)} → ${liqDepois}` +
                    ` · juros ${juros} → ${out.juros} · desconto ${desconto} → ${out.desconto}`,
            );
        }
    }
    console.log(`\n${rows.length} execuções reais com payload:`, contagem);
    if (contagem.DIVERGENTE > 0) process.exit(1);
};

main().catch((e: unknown) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
});
