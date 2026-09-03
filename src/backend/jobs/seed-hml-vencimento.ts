import 'reflect-metadata';
// Carrega o .env ANTES dos imports que constroem o `conexosService` singleton.
import 'dotenv/config';
import { mkdirSync, writeFileSync } from 'node:fs';
import { container } from 'tsyringe';
import { bootstrapAppContainer } from '../domain/appContainer.js';
import ConexosBaseClient from '../domain/client/ConexosBaseClient.js';

/**
 * SEED DE HML — empurra o VENCIMENTO de um título a pagar para o futuro, para
 * destravar o teste ponta-a-ponta do lote SISPAG (fin015).
 *
 * PORQUÊ: `finalizarLote` valida R1 (data de débito ≥ hoje) E R2 (data de débito ≤ menor
 * vencimento do lote). Juntas, elas impedem que um título JÁ VENCIDO entre num lote — e
 * HML só tem título vencido (0 de 324 pendentes com vencimento ≥ hoje). Sem um título a
 * vencer, `finalizarLote`/`gerarRemessa` nunca rodam e o `.REM` não sai.
 *
 * COMO: `fin026` é a tela "Gerenciamento de Títulos a Pagar" e expõe
 * `PUT /api/fin026/alteraDataVencimento`. O body NÃO está no OpenAPI — este job lê o
 * registro (`GET /api/fin026/{docTip}/{docCod}/{titCod}`), monta o payload e tenta as
 * variantes plausíveis até uma passar, registrando qual funcionou.
 *
 * ⚠️ ESCRITA EM DADO DE TERCEIRO: altera um registro do ERP de homologação que não é
 * nosso. Reversível — o vencimento ORIGINAL é gravado em disco ANTES de qualquer PUT, e
 * `REVERTER=1` desfaz. Ainda assim, use com intenção.
 *
 * SEGURANÇA:
 *   - RECUSA rodar fora de HML. Alterar vencimento em produção é adulterar dado real.
 *   - Escrita só com `SEED_WRITE=1` (sem a flag: só lê e mostra o que faria).
 *
 * Run (leitura):  cd src/backend
 *   CONEXOS_BASE_URL=https://columbiatrading-hml.conexos.cloud/api \
 *   DOC=820 TIT=1 TIPO=2 FIL=2 tsx jobs/seed-hml-vencimento.ts
 *
 * Run (escrita):  ... SEED_WRITE=1 DIAS=30 tsx jobs/seed-hml-vencimento.ts
 * Reverter:       ... SEED_WRITE=1 REVERTER=1 tsx jobs/seed-hml-vencimento.ts
 */
const BASE = process.env.CONEXOS_BASE_URL ?? '';
if (!BASE.includes('-hml')) {
    console.error(`RECUSADO: base não é HML (${BASE}). Alterar vencimento só em HML.`);
    process.exit(1);
}

const OUT = process.env.PROBE_OUT ?? '/tmp/seed-hml-vencimento';
const DOC = process.env.DOC ?? '820';
const TIT = process.env.TIT ?? '1';
const TIPO = process.env.TIPO ?? '2';
const FIL = Number(process.env.FIL ?? 2);
const DIAS = Number(process.env.DIAS ?? 30);
const WRITE = process.env.SEED_WRITE === '1';
const REVERTER = process.env.REVERTER === '1';

type Row = Record<string, unknown>;

const log = (s: string, v?: unknown): void =>
    console.log(`[seed-venc] ${s}`, v !== undefined ? JSON.stringify(v).slice(0, 500) : '');

const erroDe = (e: unknown): string => (e instanceof Error ? e.message : String(e));

const save = (name: string, data: unknown): void => {
    writeFileSync(`${OUT}/${name}`, JSON.stringify(data, null, 2));
    console.log(`[seed-venc]   ↳ ${OUT}/${name}`);
};

const comoData = (v: unknown): string =>
    typeof v === 'number' ? new Date(v).toISOString().slice(0, 10) : String(v);

/** Meia-noite UTC de hoje + `dias`. */
const emDias = (dias: number): number => {
    const d = new Date();
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) + dias * 86_400_000;
};

const BACKUP = `00-BACKUP-vencimento-original-${DOC}-${TIT}.json`;

async function main(): Promise<void> {
    mkdirSync(OUT, { recursive: true });
    await bootstrapAppContainer();
    const base = container.resolve(ConexosBaseClient);

    console.log('='.repeat(78));
    console.log(`BASE: ${BASE} (HML)`);
    console.log(`ALVO: docTip=${TIPO} docCod=${DOC} titCod=${TIT} filCod=${FIL}`);
    console.log(
        `MODO: ${!WRITE ? 'LEITURA (nada será alterado)' : REVERTER ? 'REVERTER ao vencimento original' : `ESCRITA — novo vencimento = hoje + ${DIAS}d`}`,
    );
    console.log('='.repeat(78));

    await base.ensureSid();
    log('login OK');

    // ── 1) ler o título ──────────────────────────────────────────────────────
    let titulo: Row | undefined;
    for (const path of [
        `fin026/${TIPO}/${DOC}/${TIT}`,
        `fin026/infoTitulo/${FIL}/${TIPO}/${DOC}/${TIT}`,
    ]) {
        try {
            const r = await base.getGeneric<Row>(path, { filCod: FIL });
            const rec = ((r as Row)?.data as Row) ?? (r as Row);
            if (rec && typeof rec === 'object') {
                titulo = rec;
                log(`1) GET ${path} OK`);
                save(`10-titulo-${DOC}-${TIT}.json`, rec);
                break;
            }
        } catch (e) {
            log(`1) GET ${path} ERRO:`, erroDe(e));
        }
    }

    if (!titulo) {
        log('não consegui ler o título — abortando.');
        return;
    }

    const vencAtual = titulo.titDtaVencimento;
    console.log('\n  >>> TÍTULO (campos preenchidos) <<<');
    for (const [k, v] of Object.entries(titulo).sort()) {
        if (v !== null && v !== undefined && v !== '') {
            console.log(`  ${k.padEnd(28)} = ${JSON.stringify(v).slice(0, 80)}`);
        }
    }
    log(`\nvencimento ATUAL = ${comoData(vencAtual)}`);

    // Alvo: novo vencimento futuro, ou o original guardado (reversão).
    let novoVenc = emDias(DIAS);
    if (REVERTER) {
        try {
            const bkp = JSON.parse(
                (await import('node:fs')).readFileSync(`${OUT}/${BACKUP}`, 'utf8'),
            ) as Row;
            novoVenc = Number(bkp.titDtaVencimentoOriginal);
            log(`reversão: restaurando o vencimento original ${comoData(novoVenc)}`);
        } catch (e) {
            log(`REVERTER pedido mas o backup não foi lido (${OUT}/${BACKUP}):`, erroDe(e));
            return;
        }
    }
    log(`vencimento NOVO  = ${comoData(novoVenc)}`);

    if (!WRITE) {
        log('LEITURA — nada alterado. Rode com SEED_WRITE=1 para aplicar.');
        return;
    }

    // Guarda o original ANTES de qualquer escrita (não sobrescreve um backup existente,
    // senão uma segunda rodada gravaria a data já alterada como se fosse a original).
    if (!REVERTER) {
        const fs = await import('node:fs');
        if (fs.existsSync(`${OUT}/${BACKUP}`)) {
            log(`backup já existe (${BACKUP}) — preservando o original.`);
        } else {
            save(BACKUP, {
                docTip: TIPO,
                docCod: DOC,
                titCod: TIT,
                filCod: FIL,
                titDtaVencimentoOriginal: vencAtual,
                capturadoEm: new Date().toISOString(),
            });
        }
    }

    // ── 2) alterar o vencimento — body não documentado, testa variantes ──────
    const chave = {
        filCod: FIL,
        docTip: Number(TIPO),
        docCod: Number(DOC),
        titCod: Number(TIT),
    };
    const variantes: Array<{ nome: string; body: Row }> = [
        {
            nome: 'A — registro inteiro com o novo vencimento',
            body: { ...titulo, titDtaVencimento: novoVenc },
        },
        {
            nome: 'B — registro inteiro em items[]',
            body: { items: [{ ...titulo, titDtaVencimento: novoVenc }] },
        },
        {
            nome: 'C — só a chave + o novo vencimento',
            body: { ...chave, titDtaVencimento: novoVenc },
        },
        {
            nome: 'D — chave + novo vencimento em items[]',
            body: { items: [{ ...chave, titDtaVencimento: novoVenc }] },
        },
        {
            nome: 'E — registro inteiro em items[] + chave no nível da requisição',
            body: { items: [{ ...titulo, titDtaVencimento: novoVenc }], ...chave },
        },
    ];

    let ok = false;
    for (const v of variantes) {
        try {
            await base.ensureSid();
            await base.putGenericOnce<unknown>('fin026/alteraDataVencimento', v.body, {
                filCod: FIL,
            });
            log(`2) alteraDataVencimento ✅ OK — variante ${v.nome}`);
            save('20-body-que-funcionou.json', v.body);
            ok = true;
            break;
        } catch (e) {
            log(`2) variante ${v.nome} ❌:`, erroDe(e));
        }
    }
    if (!ok) {
        log('2) todas as variantes falharam — o vencimento NÃO foi alterado.');
        return;
    }

    // ── 3) confirmar relendo o registro ──────────────────────────────────────
    try {
        const r = await base.getGeneric<Row>(`fin026/${TIPO}/${DOC}/${TIT}`, { filCod: FIL });
        const rec = ((r as Row)?.data as Row) ?? (r as Row);
        log(`3) confirmação: vencimento agora = ${comoData(rec?.titDtaVencimento)}`);
        save(`30-titulo-apos-${DOC}-${TIT}.json`, rec);
    } catch (e) {
        log('3) confirmação ERRO:', erroDe(e));
    }

    console.log(`\nartefatos em ${OUT} (inclui ${BACKUP} para reverter)`);
}

main()
    .then(() => process.exit(0))
    .catch((e) => {
        console.error('[seed-venc] FATAL:', erroDe(e));
        process.exit(1);
    });
