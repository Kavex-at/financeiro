import 'reflect-metadata';
import 'dotenv/config';
import './hmlEnvFile.js';
import { container } from 'tsyringe';
import { bootstrapAppContainer } from '../domain/appContainer.js';
import ConexosBaseClient from '../domain/client/ConexosBaseClient.js';
import ConexosSispagClient from '../domain/client/ConexosSispagClient.js';

/**
 * HML — solicitação de desconto em título a pagar (`fin062`) e sua liberação (`fin063`).
 *
 * Pergunta (2026-10-19): o desconto nativo reduz o `fin064.totalAberto` ANTES do pagamento, de modo
 * que um boleto 1 centavo ABAIXO do título possa ser vinculado com valor igual? E mexe na liberação
 * por alçada do título (`fin007`: `titVld1/2/3libera`)? O J do `.REM` paga o valor do TÍTULO, não
 * o do item (achado de HML do mesmo dia), então só o título ajustado resolve.
 *
 * Fases (`FASE`), cada uma relê tudo no fim:
 *   ler        (padrão) só leitura: linha do fin064, liberação fin007, conta de desconto sugerida,
 *              solicitações fin062 do título
 *   solicitar  POST fin062 com `VALOR` (padrão 0,01) — ESCREVE no título de HML
 *   aprovar    POST fin063/aprovarDesconto com `DFC` — ESCREVE no título de HML
 *
 * Travas: só HML, credenciais de `HML_ENV_FILE`, `databaseConnectionString=""`, 1 sessão.
 *
 *   cd src/backend
 *   HML_ENV_FILE=... CONEXOS_BASE_URL=https://columbiatrading-hml.conexos.cloud/api \
 *   databaseConnectionString="" DOC=640 TIT=1 FASE=ler npx tsx jobs/probe-hml-desconto-fin062.ts
 */
const BASE = process.env.CONEXOS_BASE_URL ?? '';
if (!BASE.includes('-hml') || !process.env.HML_ENV_FILE) {
    console.error('RECUSADO: só HML, com HML_ENV_FILE.');
    process.exit(1);
}
if (process.env.databaseConnectionString !== '') {
    console.error('RECUSADO: rode com databaseConnectionString="".');
    process.exit(1);
}
const FIL = Number(process.env.FIL ?? 2);
const DOC = process.env.DOC ?? '';
const TIT = process.env.TIT ?? '1';
const FASE = process.env.FASE ?? 'ler';
const VALOR = Number(process.env.VALOR ?? 0.01);
const DFC = process.env.DFC ?? '';
if (!DOC) {
    console.error('Informe DOC (e TIT).');
    process.exit(1);
}
type Row = Record<string, unknown>;
const log = (s: string): void => console.log(`[hml-fin062] ${s}`);
const sanea = (v: unknown): string => JSON.stringify(v ?? null).replace(/\d{20,}/g, '…');
const erro = (e: unknown): string => {
    const err = e as { message?: string; response?: { status?: unknown; data?: unknown } };
    return `${String(err.response?.status)} ${sanea(err.response?.data ?? err.message).slice(0, 600)}`;
};

/** Campos de interesse da linha do fin064 (dinheiro, liberação, status). */
const CAMPOS_FIN064 =
    /^(docTip|docCod|titCod|totalAberto|totalLiquido|titMny\w*|\w*[Ll]ib\w*|titVldStatus|titVldBloq|acoesMny\w*|vldPago)$/;
/** Campos de interesse da liberação fin007. */
const CAMPOS_FIN007 = /(libera|Libera|Status|status|Bloq|bloq|MnyValor|MnyLiquido|Aberto)/;

const filtrar = (row: Row | undefined, re: RegExp): Row =>
    row ? Object.fromEntries(Object.entries(row).filter(([k]) => re.test(k))) : {};

async function main(): Promise<void> {
    await bootstrapAppContainer();
    const base = container.resolve(ConexosBaseClient);
    const sispag = container.resolve(ConexosSispagClient);
    await base.ensureSid();
    log(`BASE ${BASE} (HML) · fil=${FIL} · título ${DOC}/${TIT} · fase ${FASE}`);

    const lerFin064 = async (): Promise<Row | undefined> => {
        const res = await base.listGenericPaginated<Row>(
            'fin064/list',
            {
                fieldList: [],
                filterList: { 'docCod#EQ': DOC },
                pageNumber: 1,
                pageSize: 50,
                serviceName: 'fin064',
            },
            { filCod: FIL },
        );
        return (res.rows ?? []).find((r) => String(r.titCod ?? '1') === TIT);
    };

    const estado = async (rotulo: string): Promise<Row | undefined> => {
        const linha = await lerFin064();
        log(`${rotulo} · fin064: ${sanea(filtrar(linha, CAMPOS_FIN064))}`);
        const aberto = await sispag.lerTotalAberto(FIL, DOC, TIT);
        log(`${rotulo} · lerTotalAberto: ${sanea(aberto)}`);
        const docTip = linha?.docTip;
        if (docTip !== undefined) {
            try {
                const lib = await base.getGeneric<Row>(`fin007/${docTip}/${DOC}/${TIT}`, {
                    filCod: FIL,
                });
                log(`${rotulo} · fin007: ${sanea(filtrar(lib, CAMPOS_FIN007))}`);
            } catch (e) {
                log(`${rotulo} · fin007 falhou: ${erro(e)}`);
            }
        }
        try {
            const res = await base.listGenericPaginated<Row>(
                'fin062/list',
                {
                    fieldList: [],
                    filterList: { 'docCod#EQ': DOC },
                    pageNumber: 1,
                    pageSize: 50,
                    serviceName: 'fin062',
                },
                { filCod: FIL },
            );
            const sol = (res.rows ?? []).map((r) => ({
                dfcCod: r.dfcCod,
                titCod: r.titCod,
                dfcVldStatus: r.dfcVldStatus,
                dfcMnyValor: r.dfcMnyValor,
                gerNum: r.gerNum,
                borCod: r.borCod,
                usnDesNomeCad: r.usnDesNomeCad,
                usnDesNomeSta: r.usnDesNomeSta,
            }));
            log(`${rotulo} · fin062 do título: ${sanea(sol)}`);
        } catch (e) {
            log(`${rotulo} · fin062/list falhou: ${erro(e)}`);
        }
        return linha;
    };

    if (FASE === 'contas') {
        // Só leitura: plano de contas financeiro, à procura da conta de desconto/juros.
        const res = await base.listGenericPaginated<Row>(
            'ger036/planoContasFin/list',
            {
                fieldList: [],
                filterList: {},
                pageNumber: 1,
                pageSize: 100,
                serviceName: process.env.SERVICE ?? 'fin062',
            },
            { filCod: FIL },
        );
        const rows = res.rows ?? [];
        log(
            `planoContasFin: ${res.count ?? rows.length} contas; chaves: ${Object.keys(rows[0] ?? {}).join(',')}`,
        );
        for (const r of rows) {
            const texto = Object.values(r).join(' ');
            if (/DESC|JURO/i.test(texto)) log(`   ${sanea(r).slice(0, 300)}`);
        }
        return;
    }

    if (FASE === 'doctip') {
        // Só leitura: a validação da conta de desconto responde diferente por `docTip`?
        for (const tip of [0, 1, 2, 3]) {
            try {
                const r = await base.getGeneric<unknown>(
                    `fin062/validacao/contaFinanceiraDesconto/${DOC}/${TIT}/${tip}`,
                    { filCod: FIL },
                );
                log(`docTip ${tip}: ${sanea(r)}`);
            } catch (e) {
                log(`docTip ${tip}: ${erro(e)}`);
            }
        }
        return;
    }

    const linha = await estado('antes');
    const docTip = linha?.docTip;
    if (docTip === undefined) return log('título não encontrado no fin064 (sem docTip).');

    let gerNum: unknown;
    try {
        const conta = await base.getGeneric<unknown>(
            `fin062/validacao/contaFinanceiraDesconto/${DOC}/${TIT}/${docTip}`,
            { filCod: FIL },
        );
        log(`conta de desconto sugerida: ${sanea(conta)}`);
        gerNum =
            typeof conta === 'object' && conta !== null
                ? ((conta as Row).gerNum ?? (conta as Row).value)
                : conta;
    } catch (e) {
        log(`contaFinanceiraDesconto falhou: ${erro(e)}`);
    }
    if (process.env.GER) gerNum = Number(process.env.GER);

    if (FASE === 'solicitar') {
        const corpo: Row = {
            filCod: FIL,
            docTip: Number(docTip),
            docCod: Number(DOC),
            titCod: Number(TIT),
            ...(gerNum !== undefined && gerNum !== null && gerNum !== ''
                ? { gerNum: Number(gerNum) }
                : {}),
            dfcMnyValor: VALOR,
            dfcEspObsSol: 'TESTE HML KAVEX: DIFERENCA DE CENTAVOS DO BOLETO (NAO USAR)',
        };
        log(`POST fin062 ${sanea(corpo)}`);
        try {
            const r = await base.postGenericOnce<Row>('fin062', corpo, { filCod: FIL });
            log(
                `fin062 criado: ${sanea({ dfcCod: r.dfcCod, dfcVldStatus: r.dfcVldStatus, dfcMnyValor: r.dfcMnyValor, gerNum: r.gerNum })}`,
            );
        } catch (e) {
            log(`POST fin062 falhou: ${erro(e)}`);
        }
        await estado('depois da solicitação');
    }

    if (FASE === 'aprovar') {
        if (!DFC) return log('Informe DFC (dfcCod da solicitação).');
        try {
            await base.postGenericOnce<unknown>(
                'fin063/aprovarDesconto',
                {
                    dfcCod: Number(DFC),
                    dfcEspObsResp: 'TESTE HML KAVEX: APROVADO PARA MEDIR O EFEITO NO ABERTO',
                },
                { filCod: FIL },
            );
            log(`fin063/aprovarDesconto ${DFC}: ok`);
        } catch (e) {
            log(`fin063/aprovarDesconto falhou: ${erro(e)}`);
        }
        await estado('depois da aprovação');
    }
}

main()
    .then(() => process.exit(0))
    .catch((e) => {
        console.error('[hml-fin062] FALHOU:', e instanceof Error ? e.message : String(e));
        process.exit(1);
    });
