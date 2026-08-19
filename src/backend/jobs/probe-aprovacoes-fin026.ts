import 'reflect-metadata';
// Carrega o .env ANTES dos imports que constroem o `conexosService` singleton
// (services/conexos.ts lê process.env.CONEXOS_USERNAME na construção, no import).
import 'dotenv/config';
import { mkdirSync, writeFileSync } from 'node:fs';
import { container } from 'tsyringe';
import { bootstrapAppContainer } from '../domain/appContainer.js';
import ConexosBaseClient from '../domain/client/ConexosBaseClient.js';

/**
 * Sonda READ-ONLY do workflow de aprovação de títulos — **Frente V, Onda 0.5**.
 *
 * ## Por que existe
 *
 * O spike estático (`ontology/_inbox/frente-v-aprovacoes-conexos-spike.md`) mapeou onde vive o
 * workflow de aprovação: a escada de 3 liberações gravada no título (`fin026/list`) e a fila de
 * bloqueios por alçada (`fin103/list`). Mas três incógnitas NÃO são decidíveis pelo spec OpenAPI, e
 * todas as três mudam o desenho — ou até o escopo — da frente:
 *
 *  1. **A HORA sobrevive nos timestamps?** `ConexosBaseClient.ts` documenta que datas do Conexos
 *     chegam como meia-noite UTC do dia BR (`BR_NOON_SHIFT_MS`). Se `titTim1Libera`/`ftbTimBloq`
 *     forem assim, o produto pedido pelo cliente ("o Fulano recebeu o WF às 18:09") é IMPOSSÍVEL e o
 *     escopo cai para granularidade de dia. É a pergunta que mais vale responder cedo.
 *  2. **Quais são os códigos de `fbaVldAcao` e `ftbVldStatus`?** O spec traz a legenda `<ul><li>` de
 *     vários enums (`docTip`, `titVldStatus`, `titVldBloq`) mas NÃO desses dois — e sem eles não se
 *     distingue "aprovou" de "cancelou" de "encaminhou".
 *  3. **O que devolve `GET fin026/log`?** O spec tipa a resposta como `{}`. Se for a auditoria de
 *     alterações do ERP (usuário + data + campo), ela pode dispensar boa parte do diffing de
 *     snapshots que planejamos — e barateia a frente inteira.
 *
 * Responde ainda duas perguntas de dimensionamento: a grafia exata dos campos de liberação
 * (`titTim1Libera` vs `titTim1libera` — as duas aparecem em schemas diferentes) e quais operadores de
 * filtro o `filterList` aceita além de `#EQ`/`#IN`/`#LIKE` (define se a janela temporal da ingestão
 * é filtrada no ERP ou paginada e cortada do nosso lado).
 *
 * ## Segurança
 *
 * SOMENTE leitura: `POST fin026/list`, `POST fin103/list` (são POST por causa do corpo de filtro,
 * não por escreverem) e dois GETs. **Nenhuma** chamada de escrita — nada de `aplicarComando`,
 * `bloqueioManual`, `trocaBloqueio`, `regerarBloqueios`, PUT ou DELETE.
 *
 * O path é LITERAL (`fin026/list`), não passa por `listGenericPaginated` — aquele helper posta em
 * `/{serviceName}`, e `POST /api/fin026` não é a listagem. Mesma lição que o `probe-com297-list`
 * pagou caro: no Conexos a diferença entre ler e escrever costuma ser o sufixo `/list`.
 *
 * Exige opt-in explícito em produção, igual aos probes irmãos.
 *
 * Run (HML — este checkout aponta para `columbiatrading-hml` por padrão):
 *   npx tsx jobs/probe-aprovacoes-fin026.ts
 *   FILS=1,2,3 npx tsx jobs/probe-aprovacoes-fin026.ts
 *   PROBE_ALLOW_PRD=1 npx tsx jobs/probe-aprovacoes-fin026.ts   # leitura em PRD, intencional
 */

const BASE = process.env.CONEXOS_BASE_URL ?? '';
const IS_HML = BASE.includes('-hml');

if (!IS_HML && process.env.PROBE_ALLOW_PRD !== '1') {
    console.error(
        `RECUSADO: base é PRODUÇÃO (${BASE}) e PROBE_ALLOW_PRD não está setado.\n` +
            'Rode com PROBE_ALLOW_PRD=1 para confirmar que a leitura em PRD é intencional.',
    );
    process.exit(1);
}

const OUT_DIR = process.env.OUT_DIR ?? '/tmp/probe-aprovacoes-fin026';
const FILIAIS = (process.env.FILS ?? process.env.CONEXOS_FIL_COD ?? '2').split(',').map(Number);

/** `docTip` = 2 → ENTRADA A PAGAR. O escopo da Frente V, Fase 1. */
const DOC_TIP_A_PAGAR = 2;

interface PagedRaw {
    count?: number;
    pageNumber?: number;
    rows?: Array<Record<string, unknown>>;
}

interface Achado {
    pergunta: string;
    resultado: unknown;
}

const achados: Achado[] = [];
const registrar = (pergunta: string, resultado: unknown): void => {
    achados.push({ pergunta, resultado });
    console.log(`\n### ${pergunta}`);
    console.log(JSON.stringify(resultado, null, 2).slice(0, 4000));
};

const corpo = (o: {
    fieldList?: readonly string[];
    filterList: Record<string, unknown>;
    serviceName: string;
    pageSize?: number;
    orderBy?: { propertyName: string; order: 'asc' | 'desc' };
}): Record<string, unknown> => {
    const body: Record<string, unknown> = {
        filterList: o.filterList,
        pageNumber: 1,
        pageSize: o.pageSize ?? 20,
        serviceName: o.serviceName,
    };
    if (o.fieldList) body.fieldList = [...o.fieldList];
    if (o.orderBy) body.orderList = { orderList: [o.orderBy] };
    return body;
};

/**
 * O coração da sonda nº 1: um timestamp "com hora de verdade" tem componente de hora/minuto
 * diferente de zero em UTC. Meia-noite exata em TODAS as amostras é a assinatura do problema
 * descrito em `BR_NOON_SHIFT_MS` — o ERP guardou só o dia.
 */
const analisarTimestamp = (
    raw: unknown,
): { valor: unknown; iso?: string; horaUtc?: string; temHora?: boolean } => {
    if (raw === null || raw === undefined || raw === '') return { valor: raw };
    const d = new Date(String(raw));
    if (Number.isNaN(d.getTime())) return { valor: raw };
    const horaUtc = `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}:${String(d.getUTCSeconds()).padStart(2, '0')}`;
    return {
        valor: raw,
        iso: d.toISOString(),
        horaUtc,
        temHora: d.getUTCHours() !== 0 || d.getUTCMinutes() !== 0 || d.getUTCSeconds() !== 0,
    };
};

/** Resume um campo de data ao longo de N linhas: quantas têm hora, e exemplos. */
const resumirCampoData = (
    rows: Array<Record<string, unknown>>,
    campo: string,
): Record<string, unknown> => {
    const presentes = rows
        .map((r) => r[campo])
        .filter((v) => v !== null && v !== undefined && v !== '');
    const analisados = presentes.map(analisarTimestamp);
    const comHora = analisados.filter((a) => a.temHora).length;
    return {
        campo,
        linhasComValor: presentes.length,
        deTotal: rows.length,
        comHoraNaoZero: comHora,
        veredito:
            presentes.length === 0
                ? 'SEM AMOSTRA'
                : comHora > 0
                  ? 'PRESERVA HORA'
                  : 'SÓ DATA (meia-noite em todas as amostras)',
        exemplos: analisados.slice(0, 5),
    };
};

/** Distribuição de valores distintos de um campo — para descobrir enums sem legenda. */
const distribuicao = (
    rows: Array<Record<string, unknown>>,
    campo: string,
): Record<string, number> => {
    const out: Record<string, number> = {};
    for (const r of rows) {
        const k = String(r[campo] ?? '∅');
        out[k] = (out[k] ?? 0) + 1;
    }
    return out;
};

const salvar = (nome: string, dados: unknown): void => {
    writeFileSync(`${OUT_DIR}/${nome}`, JSON.stringify(dados, null, 2), 'utf8');
};

/**
 * O Conexos explica a recusa no CORPO da resposta (`{type, messages:[{message}]}`), não no status.
 * `String(err)` devolve só "AxiosError: status 500" e joga fora a única informação útil — foi o que
 * cegou a 1ª rodada desta sonda diante do 400 do `fin103/list`.
 */
const descreverErro = (e: unknown): unknown => {
    const resp = (e as { response?: { status?: number; data?: unknown } }).response;
    return {
        status: resp?.status,
        corpo: resp?.data ?? String(e),
    };
};

/**
 * A resposta do endpoint `log` traz, junto do `logList`, um `configList` que declara o
 * `formatType` de cada campo (DATE vs DATETIME) e, para os enums, um `optionList` com
 * `{description, value}`. É a legenda que falta no spec OpenAPI — responde R9 sem adivinhação.
 */
const extrairLegendas = (payload: unknown): Record<string, unknown> => {
    const cfg = (payload as { configList?: Array<Record<string, unknown>> })?.configList ?? [];
    const formatos: Record<string, unknown> = {};
    const enums: Record<string, unknown> = {};
    for (const c of cfg) {
        const nome = String(c.name);
        const fmt = (c.gridConfigMaskFormat as { formatType?: string } | null)?.formatType;
        if (fmt) formatos[nome] = fmt;
        if (c.optionList) enums[nome] = { className: c.className, opcoes: c.optionList };
    }
    return { formatos, enums };
};

const main = async (): Promise<void> => {
    mkdirSync(OUT_DIR, { recursive: true });
    await bootstrapAppContainer();
    const base = container.resolve(ConexosBaseClient);
    await base.ensureSid();

    console.log(`\nBASE=${BASE}  (HML=${IS_HML})  FILIAIS=${FILIAIS.join(',')}  OUT=${OUT_DIR}`);

    for (const filCod of FILIAIS) {
        console.log(`\n${'='.repeat(78)}\nFILIAL ${filCod}\n${'='.repeat(78)}`);

        // ── Q1. fin026/list — o grid com a escada de 3 liberações ────────────────────────────
        // Sem `fieldList`: queremos ver TODOS os campos que o grid projeta por padrão, inclusive a
        // grafia real dos campos de liberação (titTim1Libera vs titTim1libera).
        let rows026: Array<Record<string, unknown>> = [];
        try {
            const r = await base.postGeneric<PagedRaw>(
                'fin026/list',
                corpo({
                    filterList: { 'docTip#EQ': DOC_TIP_A_PAGAR },
                    serviceName: 'fin026',
                    pageSize: 50,
                }),
                { filCod },
            );
            rows026 = r.rows ?? [];
            registrar(`[fil ${filCod}] Q1 fin026/list — count e chaves da 1ª linha`, {
                count: r.count,
                linhas: rows026.length,
                chaves: rows026[0] ? Object.keys(rows026[0]) : [],
                primeiraLinha: rows026[0] ?? null,
            });
            salvar(`fil${filCod}-q1-fin026-list.json`, r);
        } catch (e) {
            registrar(`[fil ${filCod}] Q1 fin026/list — FALHOU`, descreverErro(e));
        }

        // ── Q1b. A HORA sobrevive? A pergunta que pode matar o escopo. ───────────────────────
        if (rows026.length > 0) {
            const camposData026 = Object.keys(rows026[0]).filter((k) => /Tim|Dta|Data/i.test(k));
            registrar(
                `[fil ${filCod}] Q1b HORA nos timestamps do fin026 (R8 — decide o escopo)`,
                camposData026.map((c) => resumirCampoData(rows026, c)),
            );
        }

        // ── Q1c. Existe título com a TRILHA preenchida? ──────────────────────────────────────
        // A 1ª rodada varreu 50 linhas e não achou UM `titTim1Libera` populado. Ou o HML não tem
        // histórico de aprovação replicado, ou o campo nunca é preenchido nesta instalação. A
        // diferença importa: a primeira hipótese exige provar em PRD; a segunda mata o escopo.
        // Aqui filtramos server-side pelos títulos JÁ liberados e varremos mais páginas.
        for (const grafia of ['titVld1Libera', 'titVld1libera'] as const) {
            try {
                const r = await base.postGeneric<PagedRaw>(
                    'fin026/list',
                    corpo({
                        filterList: { 'docTip#EQ': DOC_TIP_A_PAGAR, [`${grafia}#EQ`]: 1 },
                        serviceName: 'fin026',
                        pageSize: 200,
                    }),
                    { filCod },
                );
                const rows = r.rows ?? [];
                const comTim = rows.filter((x) => x.titTim1Libera ?? x.titTim1libera ?? null);
                registrar(`[fil ${filCod}] Q1c títulos com ${grafia}=1 (trilha preenchida?)`, {
                    count: r.count,
                    linhas: rows.length,
                    comTitTim1LiberaPopulado: comTim.length,
                    amostraComTrilha: comTim.slice(0, 3),
                    resumoTim1: resumirCampoData(rows, 'titTim1Libera'),
                    resumoUsn1: {
                        naoNulos: rows.filter((x) => x.usnDesNome1Lib).length,
                        exemplos: rows
                            .map((x) => x.usnDesNome1Lib)
                            .filter(Boolean)
                            .slice(0, 5),
                    },
                });
                salvar(`fil${filCod}-q1c-liberados-${grafia}.json`, r);
            } catch (e) {
                registrar(`[fil ${filCod}] Q1c ${grafia} — FALHOU`, descreverErro(e));
            }
        }

        // ── Q2. fin103/list — a fila de bloqueios por alçada ─────────────────────────────────
        // A 1ª rodada tomou 400 e o motivo ficou escondido. Agora tentamos variações e SEMPRE
        // registramos o corpo da recusa, que é onde o Conexos explica o que não gostou.
        let rows103: Array<Record<string, unknown>> = [];
        const tentativas103: Array<{ rotulo: string; body: Record<string, unknown> }> = [
            {
                rotulo: 'sem filtro',
                body: corpo({ filterList: {}, serviceName: 'fin103', pageSize: 50 }),
            },
            {
                rotulo: 'docTip#EQ',
                body: corpo({
                    filterList: { 'docTip#EQ': DOC_TIP_A_PAGAR },
                    serviceName: 'fin103',
                    pageSize: 50,
                }),
            },
            {
                rotulo: 'filCod#EQ',
                body: corpo({
                    filterList: { 'filCod#EQ': filCod },
                    serviceName: 'fin103',
                    pageSize: 50,
                }),
            },
            {
                rotulo: 'serviceName pontuado',
                body: corpo({
                    filterList: {},
                    serviceName: 'fin103.finTituloBloq',
                    pageSize: 50,
                }),
            },
        ];
        for (const t of tentativas103) {
            if (rows103.length > 0) break;
            try {
                const r = await base.postGeneric<PagedRaw>('fin103/list', t.body, { filCod });
                rows103 = r.rows ?? [];
                registrar(`[fil ${filCod}] Q2 fin103/list [${t.rotulo}] — OK`, {
                    count: r.count,
                    linhas: rows103.length,
                    chaves: rows103[0] ? Object.keys(rows103[0]) : [],
                    primeiraLinha: rows103[0] ?? null,
                });
                salvar(`fil${filCod}-q2-fin103-list.json`, r);
            } catch (e) {
                registrar(
                    `[fil ${filCod}] Q2 fin103/list [${t.rotulo}] — recusado`,
                    descreverErro(e),
                );
            }
        }

        // ── Q2d. Legendas dos enums via configList do endpoint de log (R9) ───────────────────
        // O `log` devolve `configList` com `optionList` {description, value} por campo — a legenda
        // que o spec OpenAPI não traz. Vale para fin103 (fbaVldAcao / ftbVldStatus).
        for (const tela of ['fin103', 'fin026'] as const) {
            try {
                const cfg = await base.getGeneric<unknown>(`${tela}/log/2/1/1`, { filCod });
                registrar(
                    `[fil ${filCod}] Q2d legendas de ${tela} (via configList)`,
                    extrairLegendas(cfg),
                );
                salvar(`fil${filCod}-q2d-config-${tela}.json`, cfg);
            } catch (e) {
                registrar(`[fil ${filCod}] Q2d legendas de ${tela} — FALHOU`, descreverErro(e));
            }
        }

        // ── Q2b. Enums sem legenda no spec (R9) ──────────────────────────────────────────────
        if (rows103.length > 0) {
            registrar(`[fil ${filCod}] Q2b distribuição dos enums do fin103 (R9)`, {
                fbaVldAcao: distribuicao(rows103, 'fbaVldAcao'),
                ftbVldStatus: distribuicao(rows103, 'ftbVldStatus'),
                fbaVldRespProcesso: distribuicao(rows103, 'fbaVldRespProcesso'),
                titVldBloq: distribuicao(rows103, 'titVldBloq'),
                fblDesNome: distribuicao(rows103, 'fblDesNome'),
                fbaDesNome: distribuicao(rows103, 'fbaDesNome'),
                aprovador: distribuicao(rows103, 'aprovador'),
                temWffUuid: rows103.filter((r) => r.wffUuid).length,
            });

            const camposData103 = Object.keys(rows103[0]).filter((k) => /Tim|Dta|Data/i.test(k));
            registrar(
                `[fil ${filCod}] Q2c HORA nos timestamps do fin103 (docDtaFinalizacao / ftbTimBloq / ftbTimCmd)`,
                camposData103.map((c) => resumirCampoData(rows103, c)),
            );
        }

        // ── Q3. Detalhe de um título que já passou por aprovação ─────────────────────────────
        // Alvo do detalhe: PREFERIR um título BLOQUEADO (`vldIsBloqueado=1`). É o único que tem
        // workflow ativo de verdade — um título não-bloqueado não tem etapa nenhuma para mostrar,
        // e foi por isso que a 1ª rodada só viu trilhas vazias. `TARGET_DOC`/`TARGET_TIT` permitem
        // apontar um caso específico à mão.
        const alvoManual = process.env.TARGET_DOC
            ? {
                  docCod: Number(process.env.TARGET_DOC),
                  titCod: Number(process.env.TARGET_TIT ?? 1),
              }
            : undefined;
        const alvo =
            alvoManual ??
            rows026.find((r) => r.vldIsBloqueado === 1) ??
            rows026.find((r) => r.titVld1Libera === 1) ??
            rows026[0];
        if (alvo) {
            const docCod = alvo.docCod;
            const titCod = alvo.titCod;
            try {
                const dto = await base.getGeneric<unknown>(
                    `fin026/infoTitulo/${filCod}/${DOC_TIP_A_PAGAR}/${docCod}/${titCod}`,
                    { filCod },
                );
                registrar(`[fil ${filCod}] Q3 infoTitulo doc=${docCod} tit=${titCod}`, dto);
                salvar(`fil${filCod}-q3-infotitulo-${docCod}-${titCod}.json`, dto);
            } catch (e) {
                registrar(`[fil ${filCod}] Q3 infoTitulo — FALHOU`, descreverErro(e));
            }

            // ── Q3b. Etapas de bloqueio DESTE título ─────────────────────────────────────────
            try {
                const r = await base.postGeneric<PagedRaw>(
                    `fin026/infoTitulo/list/${filCod}/${DOC_TIP_A_PAGAR}/${docCod}/${titCod}`,
                    corpo({ filterList: {}, serviceName: 'fin026', pageSize: 50 }),
                    { filCod },
                );
                registrar(`[fil ${filCod}] Q3b etapas do título doc=${docCod} tit=${titCod}`, r);
                salvar(`fil${filCod}-q3b-etapas-${docCod}-${titCod}.json`, r);
            } catch (e) {
                registrar(`[fil ${filCod}] Q3b etapas do título — FALHOU`, descreverErro(e));
            }

            // ── Q4. O LOG. A incógnita de maior valor (R10). ─────────────────────────────────
            try {
                const log = await base.getGeneric<unknown>(
                    `fin026/log/${DOC_TIP_A_PAGAR}/${docCod}/${titCod}`,
                    { filCod },
                );
                registrar(
                    `[fil ${filCod}] Q4 fin026/log doc=${docCod} tit=${titCod} (R10 — pode dispensar o diffing)`,
                    log,
                );
                salvar(`fil${filCod}-q4-log-${docCod}-${titCod}.json`, log);
            } catch (e) {
                registrar(`[fil ${filCod}] Q4 fin026/log — FALHOU`, descreverErro(e));
            }
        } else {
            registrar(`[fil ${filCod}] Q3/Q4 pulados`, 'fin026/list não devolveu nenhuma linha');
        }

        // ── Q6. Existe título BLOQUEADO? O teste que separa duas hipóteses opostas ───────────
        // `fin103/list` devolveu 0 linhas. Isso tem duas leituras incompatíveis:
        //   (a) a Columbia não usa a fila de bloqueio/alçada — não há workflow a rastrear;
        //   (b) nosso usuário de API não tem a TELA fin103 liberada — o spec do Conexos avisa que
        //       "o usuário deverá ser liberado para a empresa (filial) e a TELA onde a API está
        //       relacionada", e uma tela não liberada pode devolver vazio em vez de 403.
        // O `fin026/list` projeta `vldIsBloqueado`. Se existirem títulos com vldIsBloqueado=1
        // enquanto o fin103 vem vazio, a hipótese (b) fica provada e o achado muda de "não há
        // workflow" para "não temos acesso ao workflow" — que é um problema de provisionamento,
        // não de escopo de produto.
        for (const flag of [1, 0] as const) {
            try {
                const r = await base.postGeneric<PagedRaw>(
                    'fin026/list',
                    corpo({
                        filterList: { 'docTip#EQ': DOC_TIP_A_PAGAR, 'vldIsBloqueado#EQ': flag },
                        serviceName: 'fin026',
                        pageSize: 20,
                    }),
                    { filCod },
                );
                const rows = r.rows ?? [];
                registrar(`[fil ${filCod}] Q6 títulos com vldIsBloqueado=${flag}`, {
                    count: r.count,
                    amostra: rows.slice(0, 3).map((x) => ({
                        docCod: x.docCod,
                        titCod: x.titCod,
                        vldIsBloqueado: x.vldIsBloqueado,
                        titVld1Libera: x.titVld1Libera,
                        titVld2Libera: x.titVld2Libera,
                        titVld3Libera: x.titVld3Libera,
                        titTim1Libera: x.titTim1Libera,
                        usnDesNome1Lib: x.usnDesNome1Lib,
                    })),
                });
                salvar(`fil${filCod}-q6-bloqueado-${flag}.json`, r);
            } catch (e) {
                registrar(`[fil ${filCod}] Q6 vldIsBloqueado=${flag} — FALHOU`, descreverErro(e));
            }
        }

        // ── Q5. Operadores de filtro suportados (dimensiona a janela da ingestão) ────────────
        // Já respondido em HML (#GE/#GT/#LE/#LT com epoch millis; #BETWEEN não existe). É contrato
        // do framework de list do Conexos, não muda por ambiente — então `SKIP_Q5=1` evita repetir
        // ~8 chamadas contra a produção do cliente só para reconfirmar o que já sabemos.
        if (process.env.SKIP_Q5 === '1') {
            registrar(`[fil ${filCod}] Q5 — PULADO (SKIP_Q5=1; já respondido em HML)`, null);
            continue;
        }
        // A 1ª rodada mandou '2026-01-01' e tomou "Value '2026-01-01' of ENUM ECnxDataType can't be
        // converted to java.util.Date" — ou seja, o OPERADOR foi aceito e o que quebrou foi o
        // FORMATO. As datas voltam como epoch millis, então é nesse formato que devem ir.
        // (`#BETWEEN` foi recusado por outro motivo: "não está de acordo com as especificações de
        // filtro de ListRequest" — esse operador realmente não existe.)
        const INICIO_2026 = Date.UTC(2026, 0, 1);
        const FIM_2026 = Date.UTC(2026, 11, 31);
        const formatos: Array<{ rotulo: string; valor: (op: string) => unknown }> = [
            { rotulo: 'epoch-millis', valor: () => INICIO_2026 },
            { rotulo: 'dd/MM/yyyy', valor: () => '01/01/2026' },
            { rotulo: 'iso-datetime', valor: () => '2026-01-01T00:00:00' },
        ];
        const operadores = ['#GE', '#GT', '#LE', '#LT', '#BETWEEN', '#LIKE'] as const;
        const suporte: Record<string, unknown> = {};
        for (const op of operadores) {
            for (const f of formatos) {
                const chave = `${op} (${f.rotulo})`;
                const valor = op === '#BETWEEN' ? [INICIO_2026, FIM_2026] : f.valor(op);
                try {
                    const r = await base.postGeneric<PagedRaw>(
                        'fin026/list',
                        corpo({
                            filterList: {
                                'docTip#EQ': DOC_TIP_A_PAGAR,
                                [`docDtaEmissao${op}`]: valor,
                            },
                            serviceName: 'fin026',
                            pageSize: 1,
                        }),
                        { filCod },
                    );
                    suporte[chave] = { ok: true, count: r.count };
                    break; // formato aceito — não precisa testar os outros para este operador
                } catch (e) {
                    suporte[chave] = { ok: false, ...(descreverErro(e) as object) };
                }
            }
        }
        registrar(`[fil ${filCod}] Q5 operadores × formatos de data em docDtaEmissao`, suporte);
    }

    salvar('achados.json', achados);
    console.log(`\n${'='.repeat(78)}\nOK — ${achados.length} achados em ${OUT_DIR}\n`);
};

main().catch((e) => {
    console.error('probe-aprovacoes-fin026 FALHOU:', e);
    process.exit(1);
});
