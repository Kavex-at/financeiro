import 'reflect-metadata';
import 'dotenv/config';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { container } from 'tsyringe';
import { bootstrapAppContainer } from '../domain/appContainer.js';
import ConexosBaseClient from '../domain/client/ConexosBaseClient.js';

/**
 * Captura fixtures REAIS do Conexos para contract testing (card `integrability-1`).
 *
 * O problema que resolve: os testes do SISPAG usam shapes digitados à mão pelo autor. Quando
 * o ERP renomear um campo — e ele renomeia, sem changelog —, o teste continua verde e a
 * quebra aparece no botão da analista. Um fixture do payload que o ERP DEVOLVEU de verdade
 * transforma isso em `npm test` vermelho.
 *
 * ESTRITAMENTE READ-ONLY: só `list`. Nenhum POST de escrita, PUT ou DELETE.
 *
 * ── REDAÇÃO (não é opcional) ────────────────────────────────────────────────────────────
 * Estes payloads carregam nome de fornecedor, CNPJ, agência e conta bancária da Columbia e
 * dos favorecidos. Commitar isso cru no git seria publicar a carteira de fornecedores num
 * repositório — o mesmo defeito que o `security-1` corrigiu na rota do CNAB, só que
 * permanente e versionado.
 *
 * O contract test não precisa dos VALORES, precisa do FORMATO: quais chaves existem e de que
 * tipo. Então cada valor vira um marcador do seu tipo, e as chaves ficam intactas. Um campo
 * renomeado no ERP continua quebrando o teste; um CNPJ real nunca entra no repo.
 *
 * Run:
 *   cd src/backend && tsx jobs/capture-fixtures-sispag.ts
 */
const DESTINO = path.resolve(process.cwd(), 'domain/interface/sispag/__fixtures__');
const HOJE = new Date().toISOString().slice(0, 10);

type Row = Record<string, unknown>;

/**
 * Substitui valores por marcadores de tipo, preservando as chaves e o aninhamento.
 * `null` é preservado como está: "o ERP manda null aqui" é informação de contrato — foi
 * exatamente um nullable inesperado que gerou um dos P0 do PR #111.
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
                _nota: 'Valores redigidos por tipo; as CHAVES são as que o ERP devolveu.',
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
    // Um endpoint que recusa NÃO pode derrubar a captura dos outros: metade dos fixtures
    // ainda é melhor do que nenhum, e o aviso diz exatamente qual faltou.
    const lista = async (path: string, serviceName: string, filterList: Row = {}) => {
        try {
            const page = await base.listGenericPaginated<Row>(
                path,
                { fieldList: [], filterList, serviceName, pageNumber: 1, pageSize: 5 },
                { filCod: FIL },
            );
            return page.rows ?? [];
        } catch (e) {
            console.warn(
                `[fixtures] ${path} FALHOU: ${e instanceof Error ? e.message : String(e)}`,
            );
            return [];
        }
    };

    // 1) lotes SISPAG nativos — para achar um flpCod real e usar no grid de pendentes.
    const lotes = await lista('fin015/list', 'fin015');
    salvar('fin015-lote', lotes[0], `fin015/list fil=${FIL}`);

    // 2) grid de pendentes — o shape que `montarItensImport` consome VERBATIM.
    const flp = lotes[0]?.flpCod;
    const bnc = lotes[0]?.bncCod;
    if (flp !== undefined && bnc !== undefined) {
        const pendentes = await lista(
            `fin015/finItemSispag/titulosPendentes/list/${FIL}/${bnc}/${flp}`,
            'fin015',
        );
        salvar('fin015-titulo-pendente', pendentes[0], `titulosPendentes fil=${FIL} flp=${flp}`);

        const itens = await lista(`fin015/finItemSispag/list/${FIL}/${bnc}/${flp}`, 'fin015');
        salvar('fin015-item-lote', itens[0], `finItemSispag fil=${FIL} flp=${flp}`);
    } else {
        console.warn('[fixtures] sem lote nativo nesta filial — pulei pendentes e itens');
    }

    // 3) contas correntes da empresa (fin005) — origem do pagamento.
    const contas = await lista('fin005/list', 'fin005');
    salvar('fin005-conta-pagadora', contas[0], `fin005/list fil=${FIL}`);

    // 4) retorno: o `arquivosRetorno/list` RECUSA sem `bncCod` E `gtbCodSeq` (400
    // "O filtro X é requerido"). Os pares válidos vêm do ger015 — a mesma descoberta que
    // o cliente já carrega em JSDoc; aqui ela vira código.
    const configs = await lista('ger015/list', 'ger015');
    salvar('ger015-config-retorno', configs[0], `ger015/list fil=${FIL}`);

    const cfg = configs[0];
    if (cfg?.bncCod !== undefined && cfg?.gtbCodSeq !== undefined) {
        const arquivos = await lista('fin052/arquivosRetorno/list', 'fin052', {
            'bncCod#EQ': cfg.bncCod,
            'gtbCodSeq#EQ': cfg.gtbCodSeq,
        });
        salvar(
            'fin052-arquivo-retorno',
            arquivos[0],
            `arquivosRetorno fil=${FIL} bnc=${cfg.bncCod} gtb=${cfg.gtbCodSeq}`,
        );

        const arq = arquivos[0];
        if (arq?.garCodSeq !== undefined) {
            // O detalhe exige `fbeEspCod` EXATO — sem código não há linha. `00` é
            // "pagamento efetuado" em todos os bancos que a Columbia usa.
            const detalhe = await lista('fin052/arquivosRetornoDetalhe/list', 'fin052', {
                'bncCod#EQ': cfg.bncCod,
                'gtbCodSeq#EQ': cfg.gtbCodSeq,
                'garCodSeq#EQ': arq.garCodSeq,
                'fbeEspCod#EQ': '00',
                'fbeVldTipo#EQ': 2,
            });
            salvar(
                'fin052-detalhe-retorno',
                detalhe[0],
                `arquivosRetornoDetalhe gar=${arq.garCodSeq} evento=00`,
            );
        }
    }

    // 4b) itens JÁ dentro de um lote — a shape que `listarChavesDoLote` consome e que
    // decide, na retomada de import parcial, o que ainda falta importar.
    const loteComItens = configs.length
        ? (await lista('fin015/list', 'fin015', { 'filCod#EQ': FIL })).find(
              (l) => Number(l.titulosCount) > 0,
          )
        : undefined;
    if (loteComItens) {
        const itens = await lista(
            `fin015/finItemSispag/list/${FIL}/${loteComItens.bncCod}/${loteComItens.flpCod}`,
            'fin015',
        );
        salvar('fin015-item-lote', itens[0], `finItemSispag flp=${loteComItens.flpCod}`);
    } else {
        console.warn('[fixtures] fin015-item-lote: nenhum lote com itens nesta filial');
    }

    const eventos = await lista('fin050/list', 'fin050');
    salvar('fin050-evento-bancario', eventos[0], `fin050/list fil=${FIL}`);

    // 4c) contas do favorecido (cmn025) — `pctVldStatus` é o filtro que decide se um título
    // é sequer importável. Estava sem contrato e sem teste.
    const tits = await lista('fin064/list', 'fin064');
    const pesCod = tits.find((t) => t.pesCod != null)?.pesCod;
    if (pesCod != null) {
        const contasFav = await lista('cmn025/ctcorr/list', 'cmn025', { 'pesCod#EQ': pesCod });
        salvar('cmn025-conta-favorecido', contasFav[0], `cmn025/ctcorr pesCod=${pesCod}`);
    }

    // 5) títulos a pagar (fin064) — a carteira do painel.
    const titulos = await lista('fin064/list', 'fin064');
    salvar('fin064-titulo-a-pagar', titulos[0], `fin064/list fil=${FIL}`);

    console.log(`[fixtures] destino: ${DESTINO}`);
};

main()
    .then(() => process.exit(0))
    .catch((e) => {
        console.error('[fixtures] FATAL:', e instanceof Error ? e.message : String(e));
        process.exit(1);
    });
