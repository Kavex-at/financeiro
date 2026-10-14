import 'reflect-metadata';
import 'dotenv/config';
import './hmlEnvFile.js';
import { mkdirSync, writeFileSync } from 'node:fs';
import { container } from 'tsyringe';
import { bootstrapAppContainer } from '../domain/appContainer.js';
import ConexosBaseClient from '../domain/client/ConexosBaseClient.js';

/**
 * HML — LEITURA (e, com `ESCREVER=1`, escrita reversível) do título de teste no `fin026`/`fin064`,
 * para descobrir QUAL campo do título cobre um boleto acima do valor em aberto (a trava do
 * `finalizar` do fin015: "valor de pagamento maior que o valor em aberto do título").
 *
 * Modo leitura: imprime os campos do título relacionados a valor/juros/desconto/aberto no
 * `fin026` e no `fin064`. Modo escrita: grava backup em disco, faz `PUT fin026` com a variante
 * pedida em `CAMPO` (`titMnyValor` | `titMnyJuros`) e relê; `REVERTER=1` restaura do backup.
 * Recusa base não-HML.
 *
 *   DOC=636 TIT=1 TIPO=2 FIL=2 [ESCREVER=1 CAMPO=titMnyValor NOVO=1028.81] [REVERTER=1 ESCREVER=1]
 */
const BASE = process.env.CONEXOS_BASE_URL ?? '';
if (!BASE.includes('-hml')) {
    console.error(`RECUSADO: só roda em HML. Base atual: ${BASE}`);
    process.exit(1);
}
const DOC = process.env.DOC ?? '636';
const TIT = process.env.TIT ?? '1';
const TIPO = process.env.TIPO ?? '2';
const FIL = Number(process.env.FIL ?? 2);
const ESCREVER = process.env.ESCREVER === '1';
const REVERTER = process.env.REVERTER === '1';
const CAMPO = process.env.CAMPO ?? 'titMnyValor';
const OUT = process.env.PROBE_OUT ?? '/tmp/hml-fin026-titulo';
type Row = Record<string, unknown>;
const log = (s: string): void => console.log(`[fin026] ${s}`);
const interessa = (k: string): boolean =>
    /Valor|Juros|Desconto|Aberto|Liquido|Multa|Total|Saldo|Pago|Dta(Vencimento|Prev)/i.test(k);
const erroSeguro = (e: unknown): Row => {
    const err = e as { message?: string; response?: { status?: unknown; data?: unknown } };
    return {
        message: String(err.message ?? e).slice(0, 300),
        status: err.response?.status,
        data: err.response?.data,
    };
};

async function main(): Promise<void> {
    mkdirSync(OUT, { recursive: true });
    await bootstrapAppContainer();
    const base = container.resolve(ConexosBaseClient);
    console.log('='.repeat(78));
    console.log(
        `BASE ${BASE} (HML) · título ${DOC}/${TIT} tipo=${TIPO} fil=${FIL} · ${ESCREVER ? (REVERTER ? 'REVERTER' : `ESCREVER ${CAMPO}`) : 'leitura'}`,
    );
    console.log('='.repeat(78));
    await base.ensureSid();
    log('login OK');

    const ler026 = async (): Promise<Row> => {
        const r = await base.getGeneric<Row>(`fin026/${TIPO}/${DOC}/${TIT}`, { filCod: FIL });
        return ((r as Row)?.data as Row) ?? (r as Row);
    };
    const ler064 = async (): Promise<Row | undefined> => {
        const page = await base.listGenericPaginated<Row>(
            'fin064/list',
            {
                fieldList: [],
                filterList: { 'docCod#EQ': Number(DOC), 'titCod#EQ': Number(TIT) },
                serviceName: 'fin064',
                pageNumber: 1,
                pageSize: 5,
            },
            { filCod: FIL },
        );
        return (page.rows ?? [])[0];
    };
    const mostra = (nome: string, r: Row | undefined): void => {
        if (!r) {
            log(`${nome}: sem registro`);
            return;
        }
        const campos = Object.entries(r).filter(
            ([k, v]) => interessa(k) && v !== null && v !== undefined && v !== '',
        );
        log(`${nome}: ${JSON.stringify(Object.fromEntries(campos))}`);
    };

    const t026 = await ler026();
    const t064 = await ler064();
    mostra('fin026 (antes)', t026);
    mostra('fin064 (antes)', t064);
    writeFileSync(`${OUT}/fin026-antes.json`, JSON.stringify(t026, null, 2));
    log(
        `todos os campos preenchidos do fin026: ${JSON.stringify(Object.keys(t026).filter((k) => t026[k] !== null && t026[k] !== ''))}`,
    );
    if (!ESCREVER) return log('leitura: nada alterado.');

    const arq = `${OUT}/BACKUP-${DOC}-${TIT}.json`;
    const fs = await import('node:fs');
    let alvoValor: number;
    if (REVERTER) {
        const b = JSON.parse(fs.readFileSync(arq, 'utf8')) as Row;
        alvoValor = Number(b[CAMPO]);
        log(`reversão: ${CAMPO} ← ${alvoValor}`);
    } else {
        if (!fs.existsSync(arq))
            writeFileSync(
                arq,
                JSON.stringify(
                    { [CAMPO]: t026[CAMPO] ?? null, capturadoEm: new Date().toISOString() },
                    null,
                    2,
                ),
            );
        alvoValor = Number(process.env.NOVO);
        log(`${CAMPO}: ${String(t026[CAMPO])} → ${alvoValor}`);
    }
    if (!Number.isFinite(alvoValor)) return log('valor novo inválido.');

    const variantes: Array<{ nome: string; body: Row }> = [
        { nome: 'A — registro inteiro', body: { ...t026, [CAMPO]: alvoValor } },
        {
            nome: 'B — registro inteiro em items[]',
            body: { items: [{ ...t026, [CAMPO]: alvoValor }] },
        },
    ];
    let ok = false;
    for (const v of variantes) {
        try {
            await base.ensureSid();
            await base.putGenericOnce<unknown>('fin026', v.body, { filCod: FIL });
            log(`PUT fin026 ✅ ${v.nome}`);
            ok = true;
            break;
        } catch (e) {
            log(`PUT fin026 ❌ ${v.nome}: ${JSON.stringify(erroSeguro(e)).slice(0, 500)}`);
        }
    }
    if (!ok) return log('nenhuma variante aceita; título não alterado.');
    mostra('fin026 (depois)', await ler026());
    mostra('fin064 (depois)', await ler064());
}

main()
    .then(() => process.exit(0))
    .catch((e) => {
        console.error('[fin026] FALHOU:', e instanceof Error ? e.message : String(e));
        process.exit(1);
    });
