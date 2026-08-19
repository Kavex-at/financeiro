import 'reflect-metadata';
import 'dotenv/config';
import { mkdirSync, writeFileSync } from 'node:fs';
import { container } from 'tsyringe';
import { bootstrapAppContainer } from '../domain/appContainer.js';
import ConexosBaseClient from '../domain/client/ConexosBaseClient.js';

/**
 * Sonda READ-ONLY nº 2 — **a trilha histórica existe?** (Frente V, Onda 0.5b)
 *
 * ## Por que existe
 *
 * A 1ª sonda (`probe-aprovacoes-fin026.ts`) concluiu que só havia 3 títulos com workflow em toda a
 * produção — todos PENDENTES (`vldIsBloqueado = 1`) — e daí inferiu que o ERP descarta a trilha
 * quando o bloqueio se resolve, o que obrigaria a Frente V a construir histórico do zero, sem backfill.
 *
 * **Essa inferência tem um furo.** Ela mediu só o que está bloqueado AGORA. O Yuri observou, na tela
 * `PSQ_027` de uma nota antiga (doc 4156, filial 2), uma linha de "Bloqueios e Liberações" com a
 * trilha COMPLETA e RESOLVIDA:
 *
 *     CONTROLLER · COMPRAS · Respondido · LIBERAR · DANILO_LARA
 *
 * Ou seja: etapa, alçada/setor, status final, ação tomada e **a pessoa que tomou** — num título que
 * já saiu da fila. Se isso for legível por API, então o histórico **é retido pelo ERP**, existe
 * backfill, e a proposta de valor da Frente V muda para melhor.
 *
 * ## O que responde
 *
 *  1. O título do doc 4156 (filial 2) devolve linhas de bloqueio por API? Por qual endpoint?
 *  2. Quais campos vêm preenchidos numa etapa RESOLVIDA — em especial `usnDesNomeCmd` (a pessoa),
 *     `fbaDesNome`/`fbaVldAcao` (a ação "LIBERAR") e `ftbVldStatus` (o "Respondido")?
 *  3. Qual a proporção de títulos da filial 2 que têm trilha? (amostra limitada, ver `AMOSTRA`)
 *
 * `psq027` NÃO está nos specs OpenAPI deste repo — testamos por analogia com `psq014`, que expõe
 * `infoTitulo/list/{filCod}/{docTip}/{docCod}/{titCod}` devolvendo `FinTituloBloq`.
 *
 * ## Segurança
 *
 * SOMENTE leitura. Só `POST .../list` (POST por causa do corpo de filtro) e GETs. Nenhum PUT,
 * nenhum `aplicarComando`, `trocaBloqueio` ou `regerarBloqueios`.
 *
 * Run:
 *   PROBE_ALLOW_PRD=1 CONEXOS_BASE_URL=https://columbiatrading.conexos.cloud/api \
 *     DOC=4156 FIL=2 npx tsx jobs/probe-aprovacoes-trilha.ts
 *   ... AMOSTRA=200 para estimar a proporção de títulos com trilha.
 */

const BASE = process.env.CONEXOS_BASE_URL ?? '';
const IS_HML = BASE.includes('-hml');

if (!IS_HML && process.env.PROBE_ALLOW_PRD !== '1') {
    console.error(`RECUSADO: base é PRODUÇÃO (${BASE}) e PROBE_ALLOW_PRD não está setado.`);
    process.exit(1);
}

const OUT_DIR = process.env.OUT_DIR ?? 'C:/tmp/probe-trilha';
const FIL = Number(process.env.FIL ?? 2);
const DOC = process.env.DOC ?? '4156';
const DOC_TIP = 2;
/** Quantos títulos detalhar na estimativa de proporção. 0 = pula a amostragem. */
const AMOSTRA = Number(process.env.AMOSTRA ?? 0);

interface PagedRaw {
    count?: number;
    rows?: Array<Record<string, unknown>>;
}

const achados: Array<{ pergunta: string; resultado: unknown }> = [];
const registrar = (pergunta: string, resultado: unknown): void => {
    achados.push({ pergunta, resultado });
    console.log(`\n### ${pergunta}`);
    console.log(JSON.stringify(resultado, null, 2).slice(0, 3500));
};

const descreverErro = (e: unknown): unknown => {
    const resp = (e as { response?: { status?: number; data?: unknown } }).response;
    return { status: resp?.status, corpo: resp?.data ?? String(e) };
};

const corpo = (
    filterList: Record<string, unknown>,
    serviceName: string,
    pageSize = 50,
): Record<string, unknown> => ({ filterList, pageNumber: 1, pageSize, serviceName });

const salvar = (nome: string, dados: unknown): void =>
    writeFileSync(`${OUT_DIR}/${nome}`, JSON.stringify(dados, null, 2), 'utf8');

const naoNulos = (r: Record<string, unknown>): Record<string, unknown> =>
    Object.fromEntries(Object.entries(r).filter(([, v]) => v !== null && v !== undefined));

/** Converte epoch-ms do Conexos para ISO em BRT, preservando a hora (que sabemos existir). */
const brt = (v: unknown): string | null => {
    if (typeof v !== 'number') return null;
    return new Date(v - 3 * 3600 * 1000).toISOString().replace('T', ' ').slice(0, 19);
};

const main = async (): Promise<void> => {
    mkdirSync(OUT_DIR, { recursive: true });
    await bootstrapAppContainer();
    const base = container.resolve(ConexosBaseClient);
    await base.ensureSid();
    console.log(`\nBASE=${BASE} FIL=${FIL} DOC=${DOC} AMOSTRA=${AMOSTRA} OUT=${OUT_DIR}`);

    // ── 1. Localizar o título do documento indicado ──────────────────────────────────────────
    // "4156" pode ser docCod (chave interna) ou docEspNumero (número do documento). Testamos os dois.
    // `fin026/list` não achou o documento antigo: essa tela projeta a carteira CORRENTE. `psq*` é a
    // família de PESQUISA — foi onde o Yuri viu a trilha (PSQ_027) — e `psq014/list` devolve
    // `DocsPagarReceberDTO`, cobrindo a pagar E a receber, sem recorte de janela.
    let alvo: Record<string, unknown> | undefined;
    const buscas: Array<{
        rotulo: string;
        path: string;
        service: string;
        filtro: Record<string, unknown>;
    }> = [];
    for (const campo of ['docCod', 'docEspNumero', 'titEspNumero'] as const) {
        buscas.push({
            rotulo: `fin026 ${campo} (docTip=2)`,
            path: 'fin026/list',
            service: 'fin026',
            filtro: { 'docTip#EQ': DOC_TIP, [`${campo}#EQ`]: DOC },
        });
        buscas.push({
            rotulo: `fin026 ${campo} (sem docTip)`,
            path: 'fin026/list',
            service: 'fin026',
            filtro: { [`${campo}#EQ`]: DOC },
        });
        buscas.push({
            rotulo: `psq014 ${campo}`,
            path: 'psq014/list',
            service: 'psq014',
            filtro: { [`${campo}#EQ`]: DOC },
        });
    }
    for (const b of buscas) {
        if (alvo) break;
        try {
            const r = await base.postGeneric<PagedRaw>(b.path, corpo(b.filtro, b.service), {
                filCod: FIL,
            });
            const rows = r.rows ?? [];
            registrar(`1. busca ${b.rotulo} = ${DOC}`, {
                count: r.count,
                linhas: rows.length,
                amostra: rows.slice(0, 2).map(naoNulos),
            });
            if (rows.length > 0) alvo = rows[0];
        } catch (e) {
            registrar(`1. busca ${b.rotulo} — recusado`, descreverErro(e));
        }
    }

    if (!alvo) {
        registrar('1. RESULTADO', 'documento não encontrado por nenhuma das chaves testadas');
        salvar('achados.json', achados);
        return;
    }

    const docCod = alvo.docCod;
    const titCod = alvo.titCod ?? 1;
    // A filial do documento vem do PRÓPRIO registro encontrado, não do env: o doc 4156 mora na
    // filial 1, e consultar a trilha com filCod=2 devolve 0 linhas sem erro — um falso negativo
    // silencioso, que foi exatamente o que aconteceu na rodada anterior.
    const filDoc = Number(alvo.filCod ?? FIL);
    const docTipDoc = Number(alvo.docTip ?? DOC_TIP);
    registrar('2. título alvo', {
        ...naoNulos(alvo),
        _filialUsadaNaTrilha: filDoc,
        _docTipUsado: docTipDoc,
    });

    // ── 3. A trilha, por todos os endpoints plausíveis ───────────────────────────────────────
    // `psq027` não está nos specs. Na rodada anterior o path `psq027/infoTitulo/list/...` devolveu
    // **405 Method Not Supported** (não 404), o que prova que o namespace `psq027` EXISTE no ERP —
    // só não aceita POST nesse formato. Testamos variações de path e verbo.
    const rotas = [
        {
            rotulo: 'fin026',
            path: `fin026/infoTitulo/list/${filDoc}/${docTipDoc}/${docCod}/${titCod}`,
            filtro: {},
        },
        {
            rotulo: 'psq014',
            path: `psq014/infoTitulo/list/${filDoc}/${docTipDoc}/${docCod}/${titCod}`,
            // O ERP recusou com "O filtro 'fExibirPrevisao' é requerido".
            filtro: { 'fExibirPrevisao#EQ': 0 },
        },
        {
            rotulo: 'psq014-comPrevisao',
            path: `psq014/infoTitulo/list/${filDoc}/${docTipDoc}/${docCod}/${titCod}`,
            filtro: { 'fExibirPrevisao#EQ': 1 },
        },
        {
            rotulo: 'com308',
            path: `com308/financeiroAPagar/infoTitulo/list/${docCod}/${titCod}`,
            filtro: {},
        },
        { rotulo: 'psq027-list', path: 'psq027/list', filtro: { 'docCod#EQ': docCod } },
        {
            rotulo: 'psq027-infoTitulo',
            path: `psq027/infoTitulo/list/${filDoc}/${docTipDoc}/${docCod}/${titCod}`,
            filtro: { 'fExibirPrevisao#EQ': 0 },
        },
    ];
    for (const rota of rotas) {
        try {
            const r = await base.postGeneric<PagedRaw>(
                rota.path,
                corpo(rota.filtro, rota.rotulo.split('-')[0]),
                { filCod: filDoc },
            );
            const rows = r.rows ?? [];
            registrar(`3. trilha via ${rota.rotulo} (${rows.length} etapa(s))`, {
                count: r.count,
                etapas: rows.map((x) => ({
                    ...naoNulos(x),
                    _ftbTimBloqBRT: brt(x.ftbTimBloq),
                    _ftbTimCmdBRT: brt(x.ftbTimCmd),
                })),
            });
            salvar(`trilha-${rota.rotulo}-${docCod}-${titCod}.json`, r);
        } catch (e) {
            registrar(`3. trilha via ${rota.rotulo} — recusado`, descreverErro(e));
        }
    }

    // ── 4. Proporção de títulos com trilha (amostra limitada) ────────────────────────────────
    // Universo: `psq014/list` (tela de PESQUISA) e não `fin026/list` (carteira CORRENTE). O doc
    // 4156 provou a diferença: ele existe no psq014 e NÃO aparece no fin026. Como o valor da
    // Frente V está no histórico, o universo certo é o da pesquisa.
    if (AMOSTRA > 0) {
        const filtroUniverso: Record<string, unknown> = {
            'filCod#EQ': FIL,
            'docTip#EQ': DOC_TIP,
        };
        if (process.env.DESDE) {
            // Janela por data de emissão, em epoch ms (o ERP recusa string ISO).
            filtroUniverso['docDtaEmissao#GE'] = Number(process.env.DESDE);
        }
        const lista = await base.postGeneric<PagedRaw>(
            'psq014/list',
            corpo(filtroUniverso, 'psq014', AMOSTRA),
            { filCod: FIL },
        );
        const titulos = lista.rows ?? [];
        registrar('4a. universo amostrado', {
            fonte: 'psq014/list',
            filtro: filtroUniverso,
            countTotalNoErp: lista.count,
            linhasTrazidas: titulos.length,
        });
        let comTrilha = 0;
        const etapasPorNome: Record<string, number> = {};
        const acoes: Record<string, number> = {};
        const status: Record<string, number> = {};
        const pessoas: Record<string, number> = {};
        const aprovadores: Record<string, number> = {};
        const exemplos: unknown[] = [];
        /** Durações resolvidas, em horas: ftbTimCmd − ftbTimBloq. É a métrica-produto da frente. */
        const duracoesH: number[] = [];
        /** Etapas ainda pendentes (ftbTimCmd == ftbTimBloq → ninguém agiu). */
        let pendentes = 0;

        for (const t of titulos) {
            try {
                const r = await base.postGeneric<PagedRaw>(
                    `fin026/infoTitulo/list/${FIL}/${DOC_TIP}/${t.docCod}/${t.titCod ?? 1}`,
                    corpo({}, 'fin026'),
                    { filCod: FIL },
                );
                const rows = r.rows ?? [];
                if (rows.length === 0) continue;
                comTrilha++;
                for (const e of rows) {
                    const inc = (m: Record<string, number>, k: unknown): void => {
                        const s = String(k ?? '∅');
                        m[s] = (m[s] ?? 0) + 1;
                    };
                    inc(etapasPorNome, e.fblDesNome);
                    inc(acoes, e.fbaDesNome ?? e.fbaVldAcao);
                    inc(status, e.ftbVldStatus);
                    inc(pessoas, e.usnDesNomeCmd);
                    inc(aprovadores, e.aprovador);
                    const t0 = e.ftbTimBloq;
                    const t1 = e.ftbTimCmd;
                    if (typeof t0 === 'number' && typeof t1 === 'number') {
                        if (t1 > t0) duracoesH.push((t1 - t0) / 3_600_000);
                        else pendentes++;
                    }
                }
                if (exemplos.length < 5) {
                    exemplos.push({
                        docCod: t.docCod,
                        titCod: t.titCod,
                        vldIsBloqueado: t.vldIsBloqueado,
                        etapas: rows.map((x) => ({
                            ...naoNulos(x),
                            _ftbTimBloqBRT: brt(x.ftbTimBloq),
                            _ftbTimCmdBRT: brt(x.ftbTimCmd),
                        })),
                    });
                }
            } catch {
                // título sem trilha ou sem permissão — não polui o resumo
            }
        }

        const ord = [...duracoesH].sort((a, b) => a - b);
        const pct = (p: number): number | null =>
            ord.length ? Number(ord[Math.floor((ord.length - 1) * p)].toFixed(1)) : null;

        registrar(`4. proporção com trilha (amostra de ${titulos.length} títulos, filial ${FIL})`, {
            amostrados: titulos.length,
            comTrilha,
            percentual: titulos.length
                ? `${((comTrilha / titulos.length) * 100).toFixed(1)}%`
                : '—',
            etapasPorNome,
            acoes,
            status,
            pessoas,
            aprovadores,
            duracaoEtapaHoras: {
                etapasResolvidas: duracoesH.length,
                etapasPendentes: pendentes,
                media: duracoesH.length
                    ? Number((duracoesH.reduce((a, b) => a + b, 0) / duracoesH.length).toFixed(1))
                    : null,
                p50: pct(0.5),
                p90: pct(0.9),
                min: ord.length ? Number(ord[0].toFixed(1)) : null,
                max: ord.length ? Number(ord[ord.length - 1].toFixed(1)) : null,
            },
        });
        salvar('amostra-exemplos.json', exemplos);
    }

    salvar('achados.json', achados);
    console.log(`\nOK — ${achados.length} achados em ${OUT_DIR}\n`);
};

main().catch((e) => {
    console.error('probe-aprovacoes-trilha FALHOU:', e);
    process.exit(1);
});
