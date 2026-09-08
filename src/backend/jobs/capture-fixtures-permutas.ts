import 'reflect-metadata';
import 'dotenv/config';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { container } from 'tsyringe';
import { bootstrapAppContainer } from '../domain/appContainer.js';
import ConexosBaseClient from '../domain/client/ConexosBaseClient.js';

/**
 * Captura fixtures REAIS do Conexos para contract testing de PERMUTAS (card `testability-1`
 * do Regis-Review 2026-08-28-1608). Porta para a Frente I o padrão que o SISPAG já tem
 * (`capture-fixtures-sispag.ts`, 16 fixtures) e que Permutas não tinha — 0 fixtures, 269
 * mocks digitados à mão.
 *
 * ## Por que existe (o incidente que o motivou)
 *
 * A aba "Invoices em aberto" exibiu invoices já liquidadas por 62 dias. A causa: o código
 * derivava `pago` da row do `com298/list`, e essa row devolve `mnyTitAberto: null` em
 * 1146/1146 INVOICEs. Havia teste de regressão para a MESMA classe de defeito no lado
 * adiantamento desde 2026-06-18 — e ele não pegou o lado invoice, porque todo mock desenhava
 * a row com os campos PREENCHIDOS. O mock concordava com o autor, não com o ERP.
 *
 * Um fixture do payload que o ERP devolveu de verdade transforma isso em `npm test` vermelho.
 *
 * ESTRITAMENTE READ-ONLY: `POST .../list` (grid paginado — é POST por causa do corpo de
 * filtro) e `GET com298/{docCod}` (detalhe). Nenhum POST de criação, PUT, baixa ou borderô.
 *
 * ── REDAÇÃO (não é opcional) ────────────────────────────────────────────────────────────
 * Estes payloads carregam nome de exportador/importador, CNPJ e valores da Columbia. O
 * contract test não precisa dos VALORES, precisa do FORMATO: quais chaves existem e de que
 * tipo. Cada valor vira um marcador do seu tipo; as chaves ficam intactas.
 *
 * **`null` é preservado de propósito** — e nesta frente isso é a evidência central, não um
 * detalhe: "o ERP manda `mnyTitAberto: null` neste grid" É o contrato, e é exatamente o fato
 * que teria evitado o bug.
 *
 * Run:
 *   cd src/backend && PROBE_ALLOW_PRD=1 tsx jobs/capture-fixtures-permutas.ts
 *   cd src/backend && PROBE_ALLOW_PRD=1 FIX_FIL=2 tsx jobs/capture-fixtures-permutas.ts
 */
const BASE = process.env.CONEXOS_BASE_URL ?? '';
if (!BASE.includes('-hml') && process.env.PROBE_ALLOW_PRD !== '1') {
    console.error(`RECUSADO: base é PRODUÇÃO (${BASE}); rode com PROBE_ALLOW_PRD=1.`);
    process.exit(1);
}

const DESTINO = path.resolve(process.cwd(), 'domain/interface/permutas/__fixtures__');
const HOJE = new Date().toISOString().slice(0, 10);
const TPD_PROFORMA = 99;
const TPD_INVOICE = 128;

type Row = Record<string, unknown>;

/**
 * Substitui valores por marcadores de tipo, preservando chaves e aninhamento.
 * `null` sobrevive intacto — ver a nota de redação no cabeçalho.
 */
const redigir = (valor: unknown): unknown => {
    if (valor === null) return null;
    if (Array.isArray(valor)) return valor.slice(0, 1).map(redigir);
    if (typeof valor === 'object') {
        const saida: Row = {};
        for (const [k, v] of Object.entries(valor as Row)) saida[k] = redigir(v);
        return saida;
    }
    if (typeof valor === 'number') return 0;
    if (typeof valor === 'boolean') return false;
    return `<${typeof valor}>`;
};

const salvar = (nome: string, amostra: Row | undefined, contexto: string): void => {
    if (!amostra) {
        console.warn(`[fixtures] ${nome}: SEM AMOSTRA — nada capturado (${contexto})`);
        return;
    }
    const arquivo = path.join(DESTINO, `${HOJE}-${nome}.json`);
    writeFileSync(
        arquivo,
        `${JSON.stringify(
            {
                _fonte: contexto,
                _capturadoEm: HOJE,
                _nota: 'Valores redigidos por tipo; as CHAVES e os `null` são os que o ERP devolveu.',
                linha: redigir(amostra),
            },
            null,
            4,
        )}\n`,
    );
    console.log(`[fixtures] ${nome}: ${Object.keys(amostra).length} chaves → ${arquivo}`);
};

const main = async (): Promise<void> => {
    mkdirSync(DESTINO, { recursive: true });
    await bootstrapAppContainer();
    const base = container.resolve(ConexosBaseClient);
    await base.ensureSid();

    const FIL = Number(process.env.FIX_FIL ?? 2);
    // Um endpoint que recusa NÃO pode derrubar a captura dos outros.
    const lista = async (caminho: string, serviceName: string, filterList: Row = {}) => {
        try {
            const page = await base.listGenericPaginated<Row>(
                caminho,
                { fieldList: [], filterList, serviceName, pageNumber: 1, pageSize: 5 },
                { filCod: FIL },
            );
            return page.rows ?? [];
        } catch (e) {
            console.warn(
                `[fixtures] ${caminho} FALHOU: ${e instanceof Error ? e.message : String(e)}`,
            );
            return [];
        }
    };

    // 1) INVOICE do com298/list — o grid que alimenta a aba "Invoices em aberto".
    //    É AQUI que `mnyTitAberto`/`mnyTitPago` vêm null e o campo `pago` nem existe.
    const invoices = await lista('com298/list', 'com298', {
        'tpdCod#EQ': TPD_INVOICE,
        'vldStatus#IN': ['3'],
    });
    salvar(
        'com298-invoice',
        invoices[0],
        `com298/list tpdCod=${TPD_INVOICE} FINALIZADO fil=${FIL}`,
    );

    // 2) PROFORMA (adiantamento) do mesmo grid — o lado-débito, mesma armadilha.
    const proformas = await lista('com298/list', 'com298', {
        'tpdCod#EQ': TPD_PROFORMA,
        'vldStatus#IN': ['3'],
    });
    salvar(
        'com298-proforma',
        proformas[0],
        `com298/list tpdCod=${TPD_PROFORMA} FINALIZADO fil=${FIL}`,
    );

    const docInvoice = invoices[0]?.docCod;
    if (docInvoice !== undefined) {
        // 3) TÍTULO do com308 — a fonte do `pago` desde 2026-08-28 (`titMnyTotPago`).
        //    Se este campo sumir do grid, é aqui que o contract test fica vermelho.
        const titulos = await lista(
            `com308/financeiroAPagar/list/${docInvoice}`,
            'com308.finTituloFin',
            { 'titVldStatus#EQ': '1' },
        );
        salvar(
            'com308-titulo-invoice',
            titulos[0],
            `com308/financeiroAPagar/list/{docCod} titVldStatus=1 fil=${FIL}`,
        );

        // 4) DETALHE do documento — onde os agregados do RESUMO DOS TÍTULOS existem de
        //    verdade (`mnyTitAberto`, `mnyTitPermutar`), em contraste com o grid.
        try {
            const detalhe = await base.getGeneric<Row>(`com298/${docInvoice}`, { filCod: FIL });
            salvar('com298-detalhe-invoice', detalhe, `GET com298/{docCod} fil=${FIL}`);
        } catch (e) {
            console.warn(
                `[fixtures] com298/{docCod} FALHOU: ${e instanceof Error ? e.message : String(e)}`,
            );
        }
    } else {
        console.warn('[fixtures] sem INVOICE nesta filial — pulei título e detalhe');
    }

    // 5) PROCESSO (imp021) — de onde sai o importador/cliente hidratado em toda invoice.
    const processos = await lista('imp021/list', 'imp021');
    salvar('imp021-processo', processos[0], `imp021/list fil=${FIL}`);
};

main()
    .then(() => process.exit(0))
    .catch((e) => {
        console.error('[fixtures] FALHOU:', e instanceof Error ? e.message : String(e));
        process.exit(1);
    });
