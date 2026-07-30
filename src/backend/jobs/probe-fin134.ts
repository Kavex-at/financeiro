import 'reflect-metadata';
// Carrega o .env ANTES dos imports que constroem o `conexosService` singleton
// (services/conexos.ts lê process.env.CONEXOS_USERNAME na construção, no import).
import 'dotenv/config';
import { writeFileSync } from 'node:fs';
import { mkdirSync } from 'node:fs';
import { container } from 'tsyringe';
import ConexosBaseClient from '../domain/client/ConexosBaseClient.js';
import { bootstrapAppContainer } from '../domain/appContainer.js';

/**
 * Sonda READ-ONLY da família de EXTRATOS do Conexos (Frente IV, Módulo 1).
 *
 * Objetivo: descobrir qual tela devolve LANÇAMENTOS de extrato (candidatos a
 * `TransacaoBancaria`) e qual devolve apenas LOTES/ARQUIVOS importados —
 * `fin134` (Importação de Extratos Bancários) é o alvo declarado pelo cliente,
 * mas os vizinhos `fin091`/`fin095`/`fin143` podem ser a fonte real dos
 * lançamentos. Nenhum contrato está documentado em `docs/conexos-api/screens/`.
 *
 * SEGURANÇA: chama SOMENTE endpoints de listagem (leitura). Nenhum POST de escrita,
 * nenhum finalizar/gerar/homologar. Ainda assim exige opt-in explícito quando a
 * base é produção, porque os probes irmãos (`probe-fin052-hml`) recusam PRD por
 * padrão e não quero que este rode por acidente.
 *
 * Run (PRD, autorizado por Yuri 2026-07-30 — não há ambiente HML):
 *   PROBE_ALLOW_PRD=1 npx tsx jobs/probe-fin134.ts
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

const OUT_DIR = process.env.OUT_DIR ?? '/tmp/probe-fin134';
const FILIAIS = (process.env.FILS ?? '1,2,3').split(',').map(Number);

/** Telas da família Tesouraria/Extratos (docs/conexos-api/navigation-menu.md:141-146). */
const TELAS: Array<{ id: string; rotulo: string }> = [
    { id: 'fin134', rotulo: 'Importação de Extratos Bancários (ALVO)' },
    { id: 'fin091', rotulo: 'Extrato Sistema' },
    { id: 'fin095', rotulo: 'Extrato Banco' },
    { id: 'fin143', rotulo: 'Importação Nexxera' },
    { id: 'fin133', rotulo: 'Conciliação Bancária' },
    { id: 'fin135', rotulo: 'Conciliações Geradas' },
];

const log = (s: string, v?: unknown) =>
    console.log(`[extratos] ${s}`, v !== undefined ? JSON.stringify(v).slice(0, 600) : '');

const salvar = (nome: string, payload: unknown): void => {
    writeFileSync(`${OUT_DIR}/${nome}.json`, JSON.stringify(payload, null, 2));
};

/**
 * Resume o shape de um conjunto de linhas sem despejar o conteúdo inteiro:
 * nomes de coluna + um exemplo por coluna. É o que interessa para escrever
 * o mapeamento campo-Conexos → `TransacaoBancaria`.
 */
const resumirShape = (rows: Array<Record<string, unknown>>): Record<string, unknown> => {
    const chaves = new Set<string>();
    for (const r of rows.slice(0, 50)) for (const k of Object.keys(r)) chaves.add(k);
    const exemplo: Record<string, unknown> = {};
    for (const k of chaves) {
        const achado = rows.find((r) => r[k] !== null && r[k] !== undefined && r[k] !== '');
        exemplo[k] = achado ? achado[k] : null;
    }
    return { totalColunas: chaves.size, colunas: [...chaves].sort(), exemploPorColuna: exemplo };
};

async function sondarTela(
    base: ConexosBaseClient,
    tela: { id: string; rotulo: string },
    filCod: number,
): Promise<void> {
    // `postGeneric` recebe o PATH da URL (o `serviceName` é campo do body, não da
    // URL — ver ConexosBaseClient.paginate:265-270). O sufixo `/list` é a convenção
    // de pesquisa das telas Conexos (`imp021/list`, `com298/list`, …).
    const endpoint = `${tela.id}/list`;
    const body = {
        fieldList: [],
        filterList: {},
        serviceName: tela.id,
        pageNumber: 1,
        pageSize: 20,
    };

    try {
        const resp = await base.postGeneric<unknown>(endpoint, body, { filCod });

        // Envelope de pesquisa do Conexos: `{ count, pageNumber, rows: [...] }`.
        // (`list` aparece em alguns sub-endpoints; aceita os dois.)
        const env = resp as {
            rows?: Array<Record<string, unknown>>;
            list?: Array<Record<string, unknown>>;
            count?: number;
        };
        const lista: Array<Record<string, unknown>> = Array.isArray(resp)
            ? (resp as Array<Record<string, unknown>>)
            : (env?.rows ?? env?.list ?? []);

        log(`fil ${filCod} · ${tela.id} (${tela.rotulo}) → ${lista.length} linhas`);

        if (lista.length > 0) {
            const shape = resumirShape(lista);
            salvar(`${tela.id}-fil${filCod}-shape`, shape);
            salvar(`${tela.id}-fil${filCod}-amostra`, lista.slice(0, 5));
            log(`   colunas (${shape.totalColunas}):`, shape.colunas);
        } else {
            // Envelope inesperado (ou grid vazio) — guarda cru para inspeção.
            salvar(`${tela.id}-fil${filCod}-envelope`, resp);
        }
    } catch (e) {
        // O corpo do 400 do Conexos é a informação útil: ele nomeia o filtro
        // obrigatório que falta (padrão descoberto no probe do fin052 —
        // "O filtro 'bncCod' é requerido"). Cava a causa até achar o response.
        const msg = e instanceof Error ? e.message : String(e);
        let corpo: unknown;
        let atual: unknown = e;
        for (let i = 0; i < 5 && atual; i++) {
            const r = (atual as { response?: { data?: unknown } })?.response?.data;
            if (r !== undefined) {
                corpo = r;
                break;
            }
            atual = (atual as { cause?: unknown })?.cause;
        }
        log(`fil ${filCod} · ${tela.id} ERRO: ${msg}`, corpo);
        salvar(`${tela.id}-fil${filCod}-erro`, { endpoint, erro: msg, corpo });
    }
}

async function main(): Promise<void> {
    mkdirSync(OUT_DIR, { recursive: true });
    await bootstrapAppContainer();
    const base = container.resolve(ConexosBaseClient);
    await base.ensureSid();
    log(`login OK · base=${BASE} · ambiente=${IS_HML ? 'HML' : 'PRODUÇÃO'} · out=${OUT_DIR}`);

    for (const filCod of FILIAIS) {
        for (const tela of TELAS) {
            await sondarTela(base, tela, filCod);
        }
    }

    log('fim — leia os *-shape.json para o mapeamento de colunas.');
}

main().catch((e) => {
    console.error('[extratos] FALHOU:', e);
    process.exit(1);
});
