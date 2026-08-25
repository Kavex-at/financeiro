import 'reflect-metadata';
// Carrega o .env ANTES dos imports que constroem o `conexosService` singleton.
import 'dotenv/config';
import { mkdirSync, writeFileSync } from 'node:fs';
import { container } from 'tsyringe';
import { bootstrapAppContainer } from '../domain/appContainer.js';
import ConexosBaseClient from '../domain/client/ConexosBaseClient.js';

/**
 * PROCESSA um arquivo de retorno já carregado no `fin052`
 * (`PUT /api/fin052/arquivosRetorno/processar`).
 *
 * O body NÃO está no OpenAPI (headers-only). Este job descobre o shape testando
 * variantes, no mesmo método que resolveu `titulosPendentes/importar` e
 * `fin026/alteraDataVencimento`: o ERP nomeia o que falta no corpo do erro.
 *
 * PISTA DO PL/SQL (`ger015.gtbLngSql` do layout Itaú): o script usa os binds `:BNC_COD`,
 * `:GTB_COD_SEQ`, `:GAR_COD_SEQ` e **`:TIPO`** — e `IF (:TIPO = 1)` é o que dispara as
 * escritas em `FIN_ITEM_SISPAG` (rejeição), `FIN_ITEM_SISPAG_RET` (vínculo do código de
 * retorno) e `FIN_LOTE_SISPAG.FLP_VLD_CONF_ENVIO`. Logo `tipo` provavelmente é campo do body.
 *
 * ⚠️ ESCRITA COM EFEITO FINANCEIRO: o processamento popula `FIN_TITULO_RETBANCO`, que é a
 * fila que alimenta a BAIXA no fin010. Só HML.
 *
 * Run:
 *   cd src/backend
 *   CONEXOS_BASE_URL=https://columbiatrading-hml.conexos.cloud/api \
 *   GAR=2 PROC_WRITE=1 npx tsx jobs/processar-ret-fin052.ts
 */
const BASE = process.env.CONEXOS_BASE_URL ?? '';
if (!BASE.includes('-hml')) {
    console.error(`RECUSADO: base não é HML (${BASE}). Processar retorno é escrita financeira.`);
    process.exit(1);
}

const OUT = process.env.PROBE_OUT ?? '/tmp/ret-processar';
const FIL = Number(process.env.FIL ?? 1);
const BNC = Number(process.env.BNC ?? 4);
const GTB = Number(process.env.GTB ?? 1);
const GAR = Number(process.env.GAR ?? 2);
const TIPO = Number(process.env.TIPO ?? 1);
const WRITE = process.env.PROC_WRITE === '1';

type Row = Record<string, unknown>;

const log = (s: string, v?: unknown): void =>
    console.log(`[ret-proc] ${s}`, v !== undefined ? JSON.stringify(v).slice(0, 400) : '');
const corpo = (e: unknown): unknown =>
    (e as { response?: { data?: unknown } })?.response?.data ??
    (e instanceof Error ? e.message : String(e));

async function main(): Promise<void> {
    mkdirSync(OUT, { recursive: true });
    await bootstrapAppContainer();
    const base = container.resolve(ConexosBaseClient);

    console.log('='.repeat(78));
    console.log(`BASE: ${BASE} (HML)`);
    console.log(`ARQUIVO: fil=${FIL} bnc=${BNC} gtb=${GTB} gar=${GAR} · tipo=${TIPO}`);
    console.log(`MODO: ${WRITE ? 'ESCRITA' : 'leitura (só mostra o estado)'}`);
    console.log('='.repeat(78));
    await base.ensureSid();

    // Header do arquivo — serve de base para as variantes "registro inteiro".
    let header: Row = {};
    try {
        const r = await base.getGeneric<Row>(`fin052/arquivosRetorno/${BNC}/${GTB}/${GAR}`, {
            filCod: FIL,
        });
        header = ((r as Row)?.data as Row) ?? (r as Row) ?? {};
        log(
            `header: ${header.garEspArquivo} · status=${header.garVldStatus}/${header.garVldProcStatus}`,
        );
    } catch (e) {
        log('não consegui ler o header:', corpo(e));
    }

    if (!WRITE) {
        log('leitura apenas — rode com PROC_WRITE=1 para processar.');
        return;
    }

    const chave = { filCod: FIL, bncCod: BNC, gtbCodSeq: GTB, garCodSeq: GAR };
    const variantes: Array<{ nome: string; body: Row }> = [
        { nome: 'A — chave + tipo', body: { ...chave, tipo: TIPO } },
        { nome: 'B — chave + tipo em items[]', body: { items: [{ ...chave, tipo: TIPO }] } },
        { nome: 'C — header inteiro em items[] + tipo', body: { items: [header], tipo: TIPO } },
        { nome: 'D — header inteiro em items[]', body: { items: [header] } },
        { nome: 'E — só a chave', body: chave },
        {
            nome: 'F — chave + tipoProcessamentoRetornoArquivo',
            body: { ...chave, tipoProcessamentoRetornoArquivo: TIPO },
        },
        {
            nome: 'G — header + chave no nível da requisição',
            body: { items: [header], ...chave, tipo: TIPO },
        },
    ];

    let ok = false;
    for (const v of variantes) {
        try {
            await base.ensureSid();
            const r = await base.putGenericOnce<unknown>(
                'fin052/arquivosRetorno/processar',
                v.body,
                { filCod: FIL },
            );
            log(`✅ processar OK — variante ${v.nome}`, r);
            writeFileSync(`${OUT}/body-que-funcionou.json`, JSON.stringify(v.body, null, 2));
            ok = true;
            break;
        } catch (e) {
            log(`❌ ${v.nome}:`, corpo(e));
        }
    }
    if (!ok) {
        log('todas as variantes falharam — o arquivo NÃO foi processado.');
        return;
    }

    // Confirmação: o status do arquivo e o vínculo do retorno com o item do lote.
    try {
        const r = await base.getGeneric<Row>(`fin052/arquivosRetorno/${BNC}/${GTB}/${GAR}`, {
            filCod: FIL,
        });
        const h = ((r as Row)?.data as Row) ?? (r as Row);
        log(
            `confirmação: status=${h?.garVldStatus}/${h?.garVldProcStatus} · erros=${h?.erro} · rejeitados=${h?.titulosRejeitados}`,
        );
        writeFileSync(`${OUT}/header-apos.json`, JSON.stringify(h, null, 2));
    } catch (e) {
        log('confirmação ❌:', corpo(e));
    }
}

main()
    .then(() => process.exit(0))
    .catch((e) => {
        console.error('[ret-proc] FATAL:', e instanceof Error ? e.message : String(e));
        process.exit(1);
    });
