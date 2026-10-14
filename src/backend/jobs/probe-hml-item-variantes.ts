import 'reflect-metadata';
import 'dotenv/config';
import './hmlEnvFile.js';
import { mkdirSync, writeFileSync } from 'node:fs';
import { container } from 'tsyringe';
import { bootstrapAppContainer } from '../domain/appContainer.js';
import ConexosBaseClient from '../domain/client/ConexosBaseClient.js';
import ConexosSispagWriteClient from '../domain/client/ConexosSispagWriteClient.js';

/**
 * HML (escreve) — qual campo do ITEM faz o `finalizar` aceitar um pagamento (R$ 0,01) acima do
 * valor em aberto do título? Para o item `DOC/TIT` do lote `FLP` (já com barra, `itsMnyVlrPgto`
 * acima do título), aplica variantes e tenta `finalizarLote` depois de cada uma. Um finalizar que
 * falha não tem efeito; ao passar, o lote de TESTE fica finalizado (cancelável) e a remessa é
 * gerada e decodificada (segmento J). Recusa base não-HML.
 *
 *   FLP=36 DOC=636 TIT=1 EXECUTAR=1
 */
const BASE = process.env.CONEXOS_BASE_URL ?? '';
if (!BASE.includes('-hml')) {
    console.error(`RECUSADO: só roda em HML. Base atual: ${BASE}`);
    process.exit(1);
}
const FIL = Number(process.env.FIL ?? 2);
const BNC = Number(process.env.BNC ?? 4);
const FLP = Number(process.env.FLP ?? 0);
const DOC = Number(process.env.DOC ?? 636);
const TIT = String(process.env.TIT ?? '1');
const SEQ = Number(process.env.SEQ ?? 92);
const EXECUTAR = process.env.EXECUTAR === '1';
const OUT = process.env.PROBE_OUT ?? '/tmp/hml-item-variantes';
type Row = Record<string, unknown>;
const log = (s: string): void => console.log(`[variantes] ${s}`);
const erroSeguro = (e: unknown): Row => {
    const err = e as { message?: string; response?: { status?: unknown; data?: unknown } };
    return {
        message: String(err.message ?? e).slice(0, 300),
        status: err.response?.status,
        data: err.response?.data,
    };
};
const mask = (s: unknown): string => {
    const t = String(s ?? '');
    return t.length > 12 ? `${t.slice(0, 5)}…${t.slice(-4)} (${t.length})` : t;
};
const dd = (s: string): string => `${s.slice(4, 8)}-${s.slice(2, 4)}-${s.slice(0, 2)}`;

async function main(): Promise<void> {
    mkdirSync(OUT, { recursive: true });
    if (!FLP) {
        console.error('Informe FLP.');
        process.exit(1);
    }
    await bootstrapAppContainer();
    const base = container.resolve(ConexosBaseClient);
    const write = container.resolve(ConexosSispagWriteClient);
    await base.ensureSid();
    log(`login OK · lote ${FLP} · item ${DOC}/${TIT} · ${EXECUTAR ? 'EXECUTAR' : 'leitura'}`);

    const itens = async (): Promise<Row[]> =>
        (
            await base.listGenericPaginated<Row>(
                `fin015/finItemSispag/list/${FIL}/${BNC}/${FLP}`,
                {
                    fieldList: [],
                    filterList: {},
                    serviceName: 'fin015',
                    pageNumber: 1,
                    pageSize: 500,
                },
                { filCod: FIL },
            )
        ).rows ?? [];
    const atual = async (): Promise<Row | undefined> =>
        (await itens()).find((i) => Number(i.docCod) === DOC && String(i.titCod) === TIT);

    const antes = await atual();
    if (!antes) return log('item não encontrado.');
    const campos = [
        'itsMnyValor',
        'itsMnyOutros',
        'itsMnyAtm',
        'itsMnyVlrPgto',
        'titMnyValor',
        'titMnyJuros',
        'titMnyDesconto',
        'titMnyLiquido',
    ];
    const foto = (r: Row): Row => Object.fromEntries(campos.map((k) => [k, r[k]]));
    log(`item antes: ${JSON.stringify(foto(antes))} barra=${mask(antes.itsNumCodbar)}`);
    writeFileSync(`${OUT}/BACKUP-item-${DOC}-${TIT}.json`, JSON.stringify(antes, null, 2));
    if (!EXECUTAR) return;

    const pgto = Number(antes.itsMnyVlrPgto);
    const valor = Number(antes.itsMnyValor);
    const dif = Math.round((pgto - valor) * 100) / 100;
    log(`pagamento ${pgto} − valor do item ${valor} = ${dif}`);
    const variantes: Array<{ nome: string; campos: Row }> = [
        { nome: 'V1 itsMnyOutros = diferença', campos: { itsMnyOutros: dif } },
        {
            nome: 'V2 itsMnyValor e titMnyLiquido = pagamento',
            campos: { itsMnyValor: pgto, titMnyLiquido: pgto },
        },
        {
            nome: 'V3 itsMnyValor, titMnyValor e titMnyLiquido = pagamento',
            campos: { itsMnyValor: pgto, titMnyValor: pgto, titMnyLiquido: pgto },
        },
        {
            nome: 'V4 titMnyJuros = diferença + titMnyLiquido = valor',
            campos: { titMnyJuros: dif },
        },
    ];
    let passou = false;
    for (const v of variantes) {
        const row = (await atual()) ?? antes;
        try {
            await base.putGenericOnce<unknown>(
                'fin015/finItemSispag',
                { ...row, ...v.campos },
                { filCod: FIL },
            );
        } catch (e) {
            log(`${v.nome}: PUT ❌ ${JSON.stringify(erroSeguro(e)).slice(0, 300)}`);
            continue;
        }
        const depois = await atual();
        log(`${v.nome}: PUT ok → ${JSON.stringify(foto(depois ?? {}))}`);
        try {
            await write.finalizarLote({ filCod: FIL, bncCod: BNC, flpCod: FLP });
            log(`${v.nome}: finalizarLote ✅ PASSOU`);
            passou = true;
            break;
        } catch (e) {
            log(`${v.nome}: finalizar ❌ ${JSON.stringify(erroSeguro(e)).slice(0, 300)}`);
        }
        // volta ao estado anterior antes da próxima variante
        const volta = Object.fromEntries(Object.keys(v.campos).map((k) => [k, antes[k] ?? 0]));
        try {
            await base.putGenericOnce<unknown>(
                'fin015/finItemSispag',
                { ...(await atual()), ...volta },
                { filCod: FIL },
            );
        } catch (e) {
            log(`   restauração falhou: ${JSON.stringify(erroSeguro(e)).slice(0, 200)}`);
        }
    }
    if (!passou) return log('nenhuma variante passou no finalizar.');

    const hoje = new Date();
    const nome = `PG${String(hoje.getUTCDate()).padStart(2, '0')}${String(hoje.getUTCMonth() + 1).padStart(2, '0')}${String(SEQ).padStart(2, '0')}.REM`;
    try {
        const rem = await write.gerarRemessa({
            filCod: FIL,
            bncCod: BNC,
            flpCod: FLP,
            grbCodSeq: 1,
            seqNum: SEQ,
            gabEspNomeArquivo: nome,
        });
        log(`gerarRemessa ${JSON.stringify(rem)}`);
        const arq = (
            await write.listarArquivosRemessa({ filCod: FIL, bncCod: BNC, flpCod: FLP })
        ).find((a) => a.conteudo);
        if (arq?.conteudo) {
            writeFileSync(`${OUT}/${arq.nomeArquivo ?? nome}`, arq.conteudo);
            const segs = arq.conteudo
                .split(/\r?\n/)
                .filter(
                    (l) =>
                        l.length >= 167 &&
                        l[7] === '3' &&
                        l[13] === 'J' &&
                        l.slice(17, 19) !== '52',
                )
                .map((l) => ({
                    barra: mask(l.slice(17, 61)),
                    vencimento: dd(l.slice(91, 99)),
                    valorTitulo: Number(l.slice(99, 114)) / 100,
                    desconto: Number(l.slice(114, 129)) / 100,
                    acrescimos: Number(l.slice(129, 144)) / 100,
                    dataPagamento: dd(l.slice(144, 152)),
                    valorPagamento: Number(l.slice(152, 167)) / 100,
                }));
            log(`segmentos J (o que o banco recebe): ${JSON.stringify(segs)}`);
        }
    } catch (e) {
        log(`gerarRemessa ❌ ${JSON.stringify(erroSeguro(e)).slice(0, 400)}`);
    }
}

main()
    .then(() => process.exit(0))
    .catch((e) => {
        console.error('[variantes] FALHOU:', e instanceof Error ? e.message : String(e));
        process.exit(1);
    });
