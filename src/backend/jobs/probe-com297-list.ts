import 'reflect-metadata';
// Carrega o .env ANTES dos imports que constroem o `conexosService` singleton
// (services/conexos.ts lê process.env.CONEXOS_USERNAME na construção, no import).
import 'dotenv/config';
import { mkdirSync, writeFileSync } from 'node:fs';
import { container } from 'tsyringe';
import { bootstrapAppContainer } from '../domain/appContainer.js';
import ConexosBaseClient from '../domain/client/ConexosBaseClient.js';

/** Envelope do grid: `{count, pageNumber, rows}`. */
interface PagedRaw {
    count?: number;
    rows?: Array<Record<string, unknown>>;
}

/**
 * Sonda READ-ONLY do GRID do com297 (`POST /api/com297/list`) — Frente IV, aba NDe.
 *
 * ## Por que existe
 *
 * O HAR de produção (Yuri, 2026-08-17) provou que o grid existe e devolve as NDes, mas filtrando por
 * `tpdDesNome#LIKE:"NOTA DE DEBITO ELETRÔNICA"` — o **nome** do tipo de documento. Filtrar por nome de
 * cadastro é o padrão que ESTE módulo já pagou caro duas vezes: o `NDE_CONFIG_NOME` obrigou a criar a
 * env `COM297_GCD_NOTA_DEBITO` como escape, e o ADR "o gcd da SN sai do nome e passa a vir do
 * histórico do processo" existe por isso. Pior: com `#LIKE` sobre uma string acentuada (`Ô`), uma
 * diferença de normalização Unicode devolve **zero linhas sem erro** — indistinguível de "não há NDe".
 *
 * Esta sonda descobre o CÓDIGO equivalente, para o filtro virar `tpdCod#EQ` (como o irmão
 * `listSNsByProcesso` já faz com `docVldTipo#EQ`/`docVldTipoAdto#EQ`, cujo comentário diz
 * "nunca hardcodar 9/1").
 *
 * ## O que responde
 *
 *  1. o `fieldList` aceita `tpdCod` / `docVldTipo` / `docVldTipoAdto` / `vldAutorizado` / `docVldNfehom`?
 *  2. qual `tpdCod` (e `docVldTipo`/`docVldTipoAdto`) identifica a família NDe?
 *  3. filtrar por CÓDIGO devolve o MESMO `count` que filtrar por nome? (prova de equivalência)
 *  4. que valores de `vldStatus` existem de fato (sem o filtro `IN`)?
 *  5. a lista traz `vldAutorizado` — ou seja, dá para substituir os N `GET com297/{docCod}` da
 *     hidratação por 1 POST?
 *
 * ## Segurança
 *
 * SOMENTE `POST com297/list` — o grid paginado (é POST por causa do corpo de filtro, não por
 * escrever). Nenhum gerar/finalizar/homologar/PUT.
 *
 * ⚠️ O path é LITERAL e NÃO passa por `listGenericPaginated`: aquele helper posta em `/{serviceName}`,
 * que no com297 é a rota de CRIAÇÃO de documento. Uma primeira versão desta sonda usou o helper e
 * bateu 9× no endpoint de criação (todas rejeitadas com `400 VALIDATION`, nada foi criado). No com297
 * a diferença entre ler e escrever é o sufixo `/list` — nunca use o helper genérico aqui.
 *
 * Exige opt-in explícito em produção, igual aos probes irmãos (`probe-fin134`, `probe-fin052-hml`).
 *
 * Run (PRD — não há ambiente HML neste tenant):
 *   PROBE_ALLOW_PRD=1 tsx jobs/probe-com297-list.ts
 *   PROBE_ALLOW_PRD=1 FILS=1,2,3 tsx jobs/probe-com297-list.ts
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

const OUT_DIR = process.env.OUT_DIR ?? '/tmp/probe-com297-list';
const FILIAIS = (process.env.FILS ?? '2').split(',').map(Number);

/** Rótulo do HAR — a string que queremos DEIXAR de usar como filtro. */
const NDE_TPD_DES_NOME = 'NOTA DE DEBITO ELETRÔNICA';

/** Campos do HAR (contrato conhecido-bom). */
const FIELDS_HAR = [
    'docCod',
    'priCod',
    'priEspRefcliente',
    'docDtaEmissao',
    'docEspNumero',
    'docVldTipoAdto',
    'tpdDesNome',
    'pesCod',
    'dpeNomPessoa',
    'ufEspSigla',
    'mnyBruto',
    'docMnyValor',
    'vldStatus',
    'pdcDocFederal',
    'filCod',
    'docTip',
] as const;

/** Campos que queremos DESCOBRIR se o grid projeta — um por vez, para isolar o que quebra. */
const FIELDS_CANDIDATOS = [
    'tpdCod',
    'docVldTipo',
    'vldAutorizado',
    'docVldNfehom',
    'vldTpNf',
    'gcdCod',
    'gcdDesNome',
] as const;

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

/** Corpo de list no formato do HAR. `serviceName` vai no corpo E o path é `{serviceName}/list`. */
const corpo = (o: {
    fieldList: readonly string[];
    filterList: Record<string, unknown>;
    pageSize?: number;
}): Record<string, unknown> => ({
    fieldList: [...o.fieldList],
    filterList: o.filterList,
    pageNumber: 1,
    pageSize: o.pageSize ?? 20,
    serviceName: 'com297',
    orderList: { orderList: [{ propertyName: 'docCod', order: 'desc' }] },
});

const main = async (): Promise<void> => {
    mkdirSync(OUT_DIR, { recursive: true });
    await bootstrapAppContainer();
    const base = container.resolve(ConexosBaseClient);
    await base.ensureSid();

    for (const filCod of FILIAIS) {
        console.log(`\n${'='.repeat(78)}\nFILIAL ${filCod}\n${'='.repeat(78)}`);

        // ── 1. Baseline: reproduzir o HAR EXATO. Se isto falhar, nada abaixo é interpretável.
        const baseline = await base
            .postGeneric<PagedRaw>(
                'com297/list',
                corpo({
                    fieldList: FIELDS_HAR,
                    filterList: {
                        'tpdDesNome#LIKE': NDE_TPD_DES_NOME,
                        'vldStatus#IN': ['1', '2', '3', '7'],
                    },
                }),
                { filCod },
            )
            .catch((e: unknown) => ({ erro: String(e) }) as never);
        registrar(`[${filCod}] 1. baseline do HAR (filtro por NOME)`, {
            count: (baseline as { count?: number }).count,
            rows: (baseline as { rows?: unknown[] }).rows?.length,
            primeiraLinha: (baseline as { rows?: unknown[] }).rows?.[0],
        });

        // ── 2. O grid projeta os campos candidatos? Um por vez isola qual (se algum) é rejeitado.
        const camposAceitos: string[] = [];
        for (const campo of FIELDS_CANDIDATOS) {
            const r = await base
                .postGeneric<PagedRaw>(
                    'com297/list',
                    corpo({
                        fieldList: [...FIELDS_HAR, campo],
                        filterList: {
                            'tpdDesNome#LIKE': NDE_TPD_DES_NOME,
                            'vldStatus#IN': ['1', '2', '3', '7'],
                        },
                        pageSize: 3,
                    }),
                    { filCod },
                )
                .catch((e: unknown) => ({ erro: String(e) }) as never);
            const linha = (r as { rows?: Array<Record<string, unknown>> }).rows?.[0];
            const presente = linha !== undefined && campo in linha;
            if (presente) camposAceitos.push(campo);
            registrar(`[${filCod}] 2.${campo} — projetado?`, {
                erro: (r as { erro?: string }).erro,
                presenteNaLinha: presente,
                valor: linha?.[campo],
            });
        }

        // ── 3. Distribuição REAL de tpdCod/docVldTipo/vldStatus/vldAutorizado nas linhas de NDe.
        const comExtras = await base
            .postGeneric<PagedRaw>(
                'com297/list',
                corpo({
                    fieldList: [...FIELDS_HAR, ...camposAceitos],
                    filterList: { 'tpdDesNome#LIKE': NDE_TPD_DES_NOME },
                    pageSize: 100,
                }),
                { filCod },
            )
            .catch((e: unknown) => ({ erro: String(e) }) as never);
        const rows = (comExtras as { rows?: Array<Record<string, unknown>> }).rows ?? [];
        const distinct = (campo: string): unknown[] => [
            ...new Set(rows.map((r) => r[campo]).filter((v) => v !== undefined)),
        ];
        registrar(`[${filCod}] 3. distribuição sem filtro de status (${rows.length} linhas)`, {
            count: (comExtras as { count?: number }).count,
            camposAceitos,
            tpdCod: distinct('tpdCod'),
            docVldTipo: distinct('docVldTipo'),
            docVldTipoAdto: distinct('docVldTipoAdto'),
            vldStatus: distinct('vldStatus'),
            vldAutorizado: distinct('vldAutorizado'),
            docVldNfehom: distinct('docVldNfehom'),
            vldTpNf: distinct('vldTpNf'),
            numeroVazioOuZero: rows.filter(
                (r) => r.docEspNumero == null || Number(String(r.docEspNumero)) === 0,
            ).length,
        });

        // ── 4. PROVA DE EQUIVALÊNCIA: filtrar por CÓDIGO devolve o mesmo universo que por NOME?
        //     É o teste que autoriza (ou proíbe) a troca do filtro na implementação.
        const tpdCods = distinct('tpdCod');
        if (tpdCods.length === 1) {
            const porCodigo = await base
                .postGeneric<PagedRaw>(
                    'com297/list',
                    corpo({
                        fieldList: [...FIELDS_HAR, ...camposAceitos],
                        filterList: { 'tpdCod#EQ': tpdCods[0] },
                        pageSize: 100,
                    }),
                    { filCod },
                )
                .catch((e: unknown) => ({ erro: String(e) }) as never);
            const rowsCod = (porCodigo as { rows?: Array<Record<string, unknown>> }).rows ?? [];
            const nomesEncontrados = [...new Set(rowsCod.map((r) => r.tpdDesNome))];
            registrar(`[${filCod}] 4. EQUIVALÊNCIA tpdCod#EQ:${String(tpdCods[0])} × nome`, {
                erro: (porCodigo as { erro?: string }).erro,
                countPorCodigo: (porCodigo as { count?: number }).count,
                countPorNome: (comExtras as { count?: number }).count,
                equivalente:
                    (porCodigo as { count?: number }).count ===
                    (comExtras as { count?: number }).count,
                // Se o código pegar MAIS tipos que a NDe, o filtro por código sozinho é largo demais.
                tpdDesNomeDistintos: nomesEncontrados,
            });
        } else {
            registrar(`[${filCod}] 4. EQUIVALÊNCIA — PULADA`, {
                motivo: 'tpdCod não veio, ou veio com mais de um valor',
                tpdCods,
            });
        }
    }

    const destino = `${OUT_DIR}/achados.json`;
    writeFileSync(destino, JSON.stringify(achados, null, 2));
    console.log(`\n\nAchados completos em ${destino}`);
};

void main().then(
    () => process.exit(0),
    (e: unknown) => {
        console.error('PROBE FALHOU:', e);
        process.exit(1);
    },
);
