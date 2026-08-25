import 'reflect-metadata';
// Carrega o .env ANTES dos imports que constroem o `conexosService` singleton.
import 'dotenv/config';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { container } from 'tsyringe';
import { bootstrapAppContainer } from '../domain/appContainer.js';
import ConexosBaseClient from '../domain/client/ConexosBaseClient.js';

/**
 * SEED DE HML — liga/desliga um PARÂMETRO POR FILIAL (`ger008`).
 *
 * PORQUÊ: o borderô gerado pela baixa de retorno SISPAG nasce sem conta financeira
 * (`gerNum` nulo) em HML. A comparação HML × PRD dos parâmetros da filial 2 achou a
 * divergência: **`filVldSugContabaixa`** ("sugerir conta de baixa") está **0 em HML** e
 * **1 em produção**. A hipótese é que ligar isso faça o borderô nascer com a conta.
 *
 * ⚠️ PARÂMETRO ESTRUTURAL DE FILIAL: afeta o comportamento de TODAS as baixas daquela
 * filial, não só o nosso teste. Reversível — o registro inteiro é salvo antes do PUT, e
 * `REVERTER=1` restaura o valor original do campo.
 *
 * SEGURANÇA: recusa rodar fora de HML. Escrita só com `PARAM_WRITE=1`.
 *
 * Run (leitura):  cd src/backend
 *   CONEXOS_BASE_URL=https://columbiatrading-hml.conexos.cloud/api \
 *   FIL=2 CAMPO=filVldSugContabaixa npx tsx jobs/seed-hml-param-filial.ts
 * Run (escrita):  ... VALOR=1 PARAM_WRITE=1 npx tsx jobs/seed-hml-param-filial.ts
 * Reverter:       ... REVERTER=1 PARAM_WRITE=1 npx tsx jobs/seed-hml-param-filial.ts
 */
const BASE = process.env.CONEXOS_BASE_URL ?? '';
if (!BASE.includes('-hml')) {
    console.error(`RECUSADO: base não é HML (${BASE}). Parâmetro de filial só em HML.`);
    process.exit(1);
}

const OUT = process.env.PROBE_OUT ?? '/tmp/seed-param-filial';
const FIL = Number(process.env.FIL ?? 2);
const CAMPO = process.env.CAMPO ?? 'filVldSugContabaixa';
const VALOR = Number(process.env.VALOR ?? 1);
const WRITE = process.env.PARAM_WRITE === '1';
const REVERTER = process.env.REVERTER === '1';

type Row = Record<string, unknown>;
const log = (s: string): void => console.log(`[param-fil] ${s}`);
const corpo = (e: unknown): string =>
    JSON.stringify(
        (e as { response?: { data?: unknown } })?.response?.data ??
            (e instanceof Error ? e.message : String(e)),
    ).slice(0, 300);

const BACKUP = `${OUT}/00-BACKUP-ger008-fil${FIL}.json`;

async function main(): Promise<void> {
    mkdirSync(OUT, { recursive: true });
    await bootstrapAppContainer();
    const base = container.resolve(ConexosBaseClient);

    console.log('='.repeat(78));
    console.log(`BASE: ${BASE} (HML) · filial ${FIL}`);
    console.log(`CAMPO: ${CAMPO} → ${REVERTER ? 'valor ORIGINAL (backup)' : VALOR}`);
    console.log(`MODO: ${WRITE ? 'ESCRITA' : 'leitura'}`);
    console.log('='.repeat(78));
    await base.ensureSid();

    const r = await base.getGeneric<Row>(`ger008/${FIL}`, { filCod: FIL });
    const rec = ((r as Row)?.data as Row) ?? (r as Row);
    if (!rec || typeof rec !== 'object') {
        log('não consegui ler o ger008 da filial.');
        return;
    }
    log(
        `ger008 lido: ${Object.keys(rec).length} campos · ${CAMPO} = ${JSON.stringify(rec[CAMPO])}`,
    );

    // Backup do registro INTEIRO antes de qualquer escrita (não sobrescreve).
    if (WRITE && !REVERTER && !existsSync(BACKUP)) {
        writeFileSync(BACKUP, JSON.stringify(rec, null, 2));
        log(`backup do registro original → ${BACKUP}`);
    }

    let alvo: unknown = VALOR;
    if (REVERTER) {
        if (!existsSync(BACKUP)) {
            log(`REVERTER pedido mas não há backup em ${BACKUP}.`);
            return;
        }
        alvo = (JSON.parse(readFileSync(BACKUP, 'utf8')) as Row)[CAMPO];
        log(`reversão: restaurando ${CAMPO} = ${JSON.stringify(alvo)}`);
    }

    if (!WRITE) {
        log('leitura apenas — rode com PARAM_WRITE=1 para aplicar.');
        return;
    }
    if (JSON.stringify(rec[CAMPO]) === JSON.stringify(alvo)) {
        log('valor já é o desejado — nada a fazer.');
        return;
    }

    // `PUT /api/ger008` — mesmo padrão dos outros writes do ERP: registro em items[].
    const atualizado = { ...rec, [CAMPO]: alvo };
    const variantes: Array<{ nome: string; body: Row }> = [
        { nome: 'A — registro inteiro em items[]', body: { items: [atualizado] } },
        { nome: 'B — registro inteiro', body: atualizado },
        { nome: 'C — items[] + filCod fora', body: { items: [atualizado], filCod: FIL } },
    ];
    let ok = false;
    for (const v of variantes) {
        try {
            await base.ensureSid();
            await base.putGenericOnce<unknown>('ger008', v.body, { filCod: FIL });
            log(`✅ PUT ger008 OK — variante ${v.nome}`);
            ok = true;
            break;
        } catch (e) {
            log(`❌ ${v.nome}: ${corpo(e)}`);
        }
    }
    if (!ok) {
        log('todas as variantes falharam — parâmetro NÃO alterado.');
        return;
    }

    const dep = await base.getGeneric<Row>(`ger008/${FIL}`, { filCod: FIL });
    const rec2 = ((dep as Row)?.data as Row) ?? (dep as Row);
    log(`confirmação: ${CAMPO} = ${JSON.stringify(rec2?.[CAMPO])}`);
}

main()
    .then(() => process.exit(0))
    .catch((e) => {
        console.error('[param-fil] FATAL:', e instanceof Error ? e.message : String(e));
        process.exit(1);
    });
