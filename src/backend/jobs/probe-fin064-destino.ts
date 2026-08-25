import 'reflect-metadata';
// Carrega o .env ANTES dos imports que constroem o `conexosService` singleton.
import 'dotenv/config';
import { mkdirSync, writeFileSync } from 'node:fs';
import { container } from 'tsyringe';
import { bootstrapAppContainer } from '../domain/appContainer.js';
import ConexosBaseClient from '../domain/client/ConexosBaseClient.js';

/**
 * SONDA READ-ONLY — o DESTINO de pagamento existe no `fin064`?
 *
 * PERGUNTA: o item importado no lote fin015 (`FinItemSispag`) exige destino
 * (`itsNumBanco`, `agencia`, `conta`, `pctCodSeq`) ou barras/PIX. O grid de pendentes
 * (`titulosPendentes/list`) NÃO tem nada disso. A hipótese é que o destino venha do
 * `fin064`, que já lemos para o painel (`pctNumBanco`, `pctEspNumContaBanc`,
 * `pctEspNumAgencia`, `pctCodSeq`, `titEspCodbar`, `itsDesChavePix`).
 *
 * ACHADO EM HML (2026-08-19): 561 títulos nas 4 filiais, **0%** com qualquer destino.
 * As colunas existem e estão todas nulas — nenhum favorecido de teste tem conta
 * cadastrada. Por isso esta sonda: medir o mesmo em PRODUÇÃO. Se PRD também vier
 * vazio, o destino NÃO vem do fin064 e o desenho do import muda.
 *
 * SEGURANÇA: exclusivamente `list` (leitura). Nenhum POST de escrita, PUT ou DELETE.
 * É a mesma leitura que o painel SISPAG já faz a cada carregamento.
 *
 * Run:
 *   cd src/backend
 *   CONEXOS_BASE_URL=https://columbiatrading.conexos.cloud/api npx tsx jobs/probe-fin064-destino.ts
 */
const BASE = process.env.CONEXOS_BASE_URL ?? '';
const OUT = process.env.PROBE_OUT ?? '/tmp/fin064-destino';
const FILIAIS = (process.env.PROBE_FILIAIS ?? '1,2,4,6')
    .split(',')
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n));
const PAGE = Number(process.env.PAGE_SIZE ?? 500);

type Row = Record<string, unknown>;

const preenchido = (v: unknown): boolean => v !== null && v !== undefined && v !== '';

async function main(): Promise<void> {
    mkdirSync(OUT, { recursive: true });
    await bootstrapAppContainer();
    const base = container.resolve(ConexosBaseClient);

    console.log('='.repeat(78));
    console.log(`BASE: ${BASE}  ${BASE.includes('-hml') ? '(HML)' : '(PRODUÇÃO — READ-ONLY)'}`);
    console.log('='.repeat(78));

    await base.ensureSid();
    console.log('login OK\n');

    const resumo: Row[] = [];
    let exemploSalvo = false;

    for (const filCod of FILIAIS) {
        try {
            const { rows, count } = await base.listGenericPaginated<Row>(
                'fin064/list',
                {
                    fieldList: [],
                    filterList: {},
                    serviceName: 'fin064',
                    pageNumber: 1,
                    pageSize: PAGE,
                },
                { filCod },
            );

            const comConta = rows.filter(
                (r) => preenchido(r.pctNumBanco) && preenchido(r.pctEspNumContaBanc),
            );
            const comBarras = rows.filter((r) => preenchido(r.titEspCodbar));
            const comPix = rows.filter((r) => preenchido(r.itsDesChavePix));
            const comPct = rows.filter((r) => preenchido(r.pctCodSeq));
            const comMod = rows.filter((r) => preenchido(r.itsVldModalidade));
            const pagavel = rows.filter(
                (r) =>
                    (preenchido(r.pctNumBanco) && preenchido(r.pctEspNumContaBanc)) ||
                    preenchido(r.titEspCodbar) ||
                    preenchido(r.itsDesChavePix),
            );

            const linha = {
                filCod,
                totalNoErp: count,
                amostra: rows.length,
                comContaBancaria: comConta.length,
                comCodigoBarras: comBarras.length,
                comChavePix: comPix.length,
                comPctCodSeq: comPct.length,
                comModalidade: comMod.length,
                comAlgumDestino: pagavel.length,
                pctComDestino: rows.length ? Math.round((pagavel.length / rows.length) * 100) : 0,
            };
            resumo.push(linha);

            console.log(
                `fil=${filCod}  total=${count}  amostra=${rows.length}  →  destino: ${pagavel.length} (${linha.pctComDestino}%)`,
            );
            console.log(
                `        conta=${comConta.length}  barras=${comBarras.length}  pix=${comPix.length}  pctCodSeq=${comPct.length}  modalidade=${comMod.length}`,
            );

            const ex = comConta[0] ?? comBarras[0] ?? comPix[0];
            if (ex) {
                console.log(
                    `        ex: doc=${ex.docCod} tit=${ex.titCod} fav=${String(ex.dpeNomPessoa ?? '').slice(0, 32)}`,
                );
                console.log(
                    `            banco=${ex.pctNumBanco} ag=${ex.pctEspNumAgencia} cc=${ex.pctEspNumContaBanc} dv=${ex.pctEspDvconta} pctCodSeq=${ex.pctCodSeq}`,
                );
                console.log(
                    `            barras=${preenchido(ex.titEspCodbar) ? 'SIM' : 'não'} pix=${ex.itsDesChavePix ?? '—'} modalidade=${ex.itsVldModalidade ?? '—'}`,
                );
                if (!exemploSalvo) {
                    writeFileSync(
                        `${OUT}/exemplo-com-destino-fil${filCod}.json`,
                        JSON.stringify(ex, null, 2),
                    );
                    console.log(
                        `        ↳ exemplo salvo em ${OUT}/exemplo-com-destino-fil${filCod}.json`,
                    );
                    exemploSalvo = true;
                }
            }
            console.log('');
        } catch (e) {
            console.log(`fil=${filCod} ERRO: ${e instanceof Error ? e.message : String(e)}\n`);
        }
    }

    // ── FASE 2 — se o fin064 não tem destino, ele mora no cadastro do favorecido ──
    // `CmnPessoasCtcorr` (cmn025) guarda as contas correntes da pessoa:
    // pctCodSeq, pctNumBanco, pctEspNumAgencia, pctEspNumContaBanc, pctVldDefault.
    // É o `pctCodSeq` que o FinItemSispag referencia. Leitura pura.
    console.log('─'.repeat(78));
    console.log('FASE 2 — contas correntes do favorecido (cmn025/ctcorr/list)');
    console.log('─'.repeat(78));

    for (const filCod of FILIAIS.slice(0, 2)) {
        const { rows } = await base.listGenericPaginated<Row>(
            'fin064/list',
            {
                fieldList: [],
                filterList: {},
                serviceName: 'fin064',
                pageNumber: 1,
                pageSize: 50,
            },
            { filCod },
        );
        // Diagnóstico: o que de fato vem preenchido numa linha do fin064?
        if (rows[0]) {
            writeFileSync(`${OUT}/raw-fin064-fil${filCod}.json`, JSON.stringify(rows[0], null, 2));
            const preenchidos = Object.entries(rows[0])
                .filter(([, v]) => preenchido(v))
                .map(([k]) => k);
            console.log(
                `   [raw] campos preenchidos (${preenchidos.length}): ${preenchidos.join(', ')}`,
            );
        }

        // `pesCod` é o favorecido; no a-pagar o ERP às vezes usa `pesCodFor`.
        const pesCods = [
            ...new Set(
                rows.flatMap((r) => [r.pesCod, r.pesCodFor, r.pes2CodSacado]).filter(preenchido),
            ),
        ].slice(0, 5);
        console.log(
            `fil=${filCod} — testando ${pesCods.length} favorecido(s): ${pesCods.join(', ')}`,
        );

        for (const pesCod of pesCods) {
            try {
                const contas = await base.listGenericPaginated<Row>(
                    'cmn025/ctcorr/list',
                    {
                        fieldList: [],
                        filterList: { 'pesCod#EQ': pesCod },
                        serviceName: 'cmn025',
                        pageNumber: 1,
                        pageSize: 50,
                    },
                    { filCod },
                );
                const c = contas.rows;
                console.log(`   pesCod=${pesCod} → ${c.length} conta(s)`);
                for (const conta of c.slice(0, 3)) {
                    console.log(
                        `      pctCodSeq=${conta.pctCodSeq} banco=${conta.pctNumBanco} ag=${conta.pctEspNumAgencia}${conta.pctEspDvage ? `-${conta.pctEspDvage}` : ''} cc=${conta.pctEspNumContaBanc}${conta.pctEspDvconta ? `-${conta.pctEspDvconta}` : ''} default=${conta.pctVldDefault} status=${conta.pctVldStatus}`,
                    );
                }
                if (c.length > 0) {
                    writeFileSync(`${OUT}/contas-pes${pesCod}.json`, JSON.stringify(c, null, 2));
                }
            } catch (e) {
                console.log(
                    `   pesCod=${pesCod} ERRO: ${e instanceof Error ? e.message : String(e)}`,
                );
            }
        }
        console.log('');
    }

    writeFileSync(`${OUT}/resumo.json`, JSON.stringify(resumo, null, 2));
    const totalAmostra = resumo.reduce((a, r) => a + Number(r.amostra), 0);
    const totalDestino = resumo.reduce((a, r) => a + Number(r.comAlgumDestino), 0);
    console.log('='.repeat(78));
    console.log(
        `VEREDITO: ${totalDestino}/${totalAmostra} títulos com destino de pagamento (${totalAmostra ? Math.round((totalDestino / totalAmostra) * 100) : 0}%)`,
    );
    console.log(
        totalDestino > 0
            ? 'O fin064 CARREGA o destino → a montagem do item de import fecha por aqui.'
            : 'O fin064 NÃO carrega destino → o destino vem de outra fonte (cadastro do favorecido ou o próprio validacao/modalidadeX).',
    );
    console.log('='.repeat(78));
    console.log(`artefatos em ${OUT}`);
}

main()
    .then(() => process.exit(0))
    .catch((e) => {
        console.error('[fin064-destino] FATAL:', e instanceof Error ? e.message : String(e));
        process.exit(1);
    });
