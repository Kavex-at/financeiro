import 'dotenv/config';
import 'reflect-metadata';
import { mkdirSync, writeFileSync } from 'node:fs';
import { container } from 'tsyringe';
import ConexosBaseClient, {
    LEGACY_CONEXOS_TOKEN,
    type PagedResponse,
} from '../domain/client/ConexosBaseClient.js';
import ConexosExtratoClient, { EXI_VLD_TIPO } from '../domain/client/ConexosExtratoClient.js';
import ConexosPagamentosRealizadosClient from '../domain/client/ConexosPagamentosRealizadosClient.js';
import ConexosSessionResolver from '../domain/client/ConexosSessionResolver.js';
import ConexosSispagClient from '../domain/client/ConexosSispagClient.js';
import { buildLegacyConexosAdapter } from '../domain/client/legacyConexosAdapter.js';
import {
    CHANNEL_CONFIDENCE,
    type ChannelPayment,
    type DuplicateCandidate,
    ITEM_ALERT_TYPE,
    type StatementDebit,
} from '../domain/interface/sispag/SispagInterface.js';
import EnvironmentProvider from '../domain/libs/environment/EnvironmentProvider.js';
import { redactErrorMessage } from '../domain/libs/redact/redactErrorMessage.js';
import ChannelProfileCalculator from '../domain/service/sispag/ChannelProfileCalculator.js';
import DuplicateDetector from '../domain/service/sispag/DuplicateDetector.js';

/**
 * VALIDAÇÃO GROUND-TRUTH v1 — sispag-verificacoes-ted-pix (ADR-0063, Task 13). SOMENTE LEITURA.
 *
 * Compara a NOSSA lógica com as probes que sustentaram a ADR, sobre os MESMOS dados ao vivo:
 *
 *   A. Duplicidade (I13c–e). Lê o fin064 de TODAS as filiais (vencimento ≥ desde, sem filtro de
 *      vldPago, paginando de verdade) UMA vez, cru. Sobre essas linhas:
 *        - "nosso": o mapeamento de produção (`ConexosSispagClient`, alimentado por um replay das
 *          páginas lidas — sem segunda leitura) + `DuplicateDetector`;
 *        - "probe": o sinal S1 da `probe-duplicidade-titulos.ts` (favorecido `pesCodFor || pesCod`
 *          + NF normalizada, documentos distintos), restrito a pares da MESMA filial (gap Q2).
 *      Critério: (a) o caso canônico fil 4, docs 6173 × 6702 aparece como FORTE; (b) o conjunto de
 *      pares FORTE bate 100% com o da probe. Qualquer diferença = DIVERGENTE (P0). O relatório lista
 *      cada par divergente e o favorecido de cada lado (a precedência pesCod × pesCodFor difere
 *      entre spec e probe — se divergir, é por aí que se começa).
 *
 *   B. Canal (I13i). Lê borderôs/baixas (fin010) e débitos do extrato (fin095) na janela do
 *      tenant e roda o `ChannelProfileCalculator` duas vezes: chaveado por `pesCod` (produção) e
 *      por NOME do favorecido (como a probe agrupou). Critério: participação do valor pago em
 *      favorecidos ALTA ≈ referência da probe (default 0,89; ±2 p.p.) e — com `PROBE_REF_ALTA_COUNT`
 *      informado — a mesma contagem de favorecidos ALTA na chave por nome.
 *
 * SEGURANÇA:
 *   - Só `/list` (leituras). Nenhuma escrita no Conexos nem no Postgres. NÃO usa
 *     `bootstrapAppContainer()` (compartilhado por ~58 jobs).
 *   - Um login no Conexos: pode derrubar a sessão menos usada do usuário do `.env`
 *     (`LOGIN_ERROR_MAX_SESSIONS`). Combine a janela com o time antes de rodar em PRD.
 *   - Rode com `databaseConnectionString=""`: com o banco de produção no `.env`, a sessão do robô
 *     pode ser gravada com o usuário errado em `columbia-default`.
 *   - Recusa base que não seja HML sem `PROBE_PRD=1`.
 *
 * Run (NÃO executado na entrega — decisão do usuário):
 *   cd src/backend && PROBE_PRD=1 databaseConnectionString="" \
 *     npx tsx jobs/validate-sispag-verificacoes-ted-pix-v1.ts
 * Env: PROBE_OUT (default /tmp/validate-sispag-verificacoes-ted-pix) · PROBE_FILIAIS (CSV) ·
 *      PROBE_SO_DUPLICIDADE=1 · PROBE_REF_ALTA_SHARE (default 0.89) · PROBE_REF_ALTA_COUNT
 */
const BASE = process.env.CONEXOS_BASE_URL ?? '';
if (!BASE.includes('-hml') && process.env.PROBE_PRD !== '1') {
    console.error(`RECUSADO: base não é HML (${BASE}). Para PRD passe PROBE_PRD=1.`);
    process.exit(1);
}
const OUT = process.env.PROBE_OUT ?? '/tmp/validate-sispag-verificacoes-ted-pix';
const REF_ALTA_SHARE = Number(process.env.PROBE_REF_ALTA_SHARE ?? 0.89);
const REF_ALTA_COUNT =
    process.env.PROBE_REF_ALTA_COUNT !== undefined
        ? Number(process.env.PROBE_REF_ALTA_COUNT)
        : null;
const TOLERANCIA_PP = 0.02;
const PAGE = 1000;
const DIA = 86_400_000;

type Row = Record<string, unknown>;

const s = (v: unknown): string => (v === null || v === undefined ? '' : String(v).trim());
const norm = (v: string): string => v.replace(/\D/g, '').replace(/^0+/, '');
const log = (m: string): void => console.log(m);

class Validacao {
    private readonly detector = new DuplicateDetector();
    private readonly calculator = new ChannelProfileCalculator();

    public constructor(private readonly base: ConexosBaseClient) {}

    /** fin064 cru de UMA filial, paginado até esgotar o `count` (mesmo filtro da produção). */
    public lerFin064 = async (filCod: number, desde: number): Promise<PagedResponse<Row>[]> => {
        const paginas: PagedResponse<Row>[] = [];
        let lidas = 0;
        for (let pagina = 1; pagina <= 50; pagina++) {
            const res = await this.base.runWithRetry(() =>
                this.base.listGenericPaginated<Row>(
                    'fin064/list',
                    {
                        fieldList: [],
                        filterList: { 'docVldPrevisao#EQ': 0, 'titDtaVencimento#GE': desde },
                        serviceName: 'fin064',
                        pageNumber: pagina,
                        pageSize: PAGE,
                    },
                    { filCod },
                ),
            );
            paginas.push(res);
            lidas += res.rows.length;
            if (res.rows.length < PAGE || lidas >= Number(res.count)) break;
        }
        return paginas;
    };

    /** Pares FORTE pelo mapeamento + detector de PRODUÇÃO (replay das páginas lidas). */
    public paresNossos = async (
        filCod: number,
        paginas: PagedResponse<Row>[],
        desde: number,
        janelaFracaDias: number,
    ): Promise<{ pares: Set<string>; titulos: DuplicateCandidate[] }> => {
        let i = 0;
        const replay = {
            runWithRetry: <T>(fn: () => Promise<T>) => fn(),
            listGenericPaginated: async () => paginas[i++] ?? { count: 0, rows: [] },
        } as unknown as ConexosBaseClient;
        const titulos = await new ConexosSispagClient(replay).listTitulosParaDuplicidade(
            filCod,
            desde,
        );
        const pares = new Set<string>();
        for (const t of titulos) {
            for (const a of this.detector.detectar(t, titulos, { janelaFracaDias })) {
                if (a.tipo !== ITEM_ALERT_TYPE.DUPLICIDADE_FORTE) continue;
                pares.add(this.par(filCod, t.docCod, a.contraparteDocCod));
            }
        }
        return { pares, titulos };
    };

    /** Pares do sinal S1 da probe (favorecido pesCodFor || pesCod), só dentro da filial. */
    public paresProbe = (filCod: number, paginas: PagedResponse<Row>[]): Set<string> => {
        const grupos = new Map<string, Set<string>>();
        for (const r of paginas.flatMap((p) => p.rows)) {
            const favorecido = s(r.pesCodFor) || s(r.pesCod);
            const numero = norm(s(r.docEspNumero));
            if (!favorecido || !numero || !s(r.docCod)) continue;
            const k = `${favorecido}|${numero}`;
            const docs = grupos.get(k) ?? new Set<string>();
            docs.add(s(r.docCod));
            grupos.set(k, docs);
        }
        const pares = new Set<string>();
        for (const docs of grupos.values()) {
            const lista = [...docs];
            for (let a = 0; a < lista.length; a++) {
                for (let b = a + 1; b < lista.length; b++) {
                    pares.add(this.par(filCod, lista[a] ?? '', lista[b] ?? ''));
                }
            }
        }
        return pares;
    };

    public canal = async (filiais: number[], meses: number) => {
        const extrato = new ConexosExtratoClient(this.base);
        const realizados = new ConexosPagamentosRealizadosClient(this.base);
        const fim = Date.now();
        const inicio = fim - meses * 30 * DIA;
        const contas = new Map<number, number>();
        for (const filCod of filiais) {
            for (const c of await extrato.listContas(filCod)) {
                if (!contas.has(c.gerNum) && (c.qtdeBanco ?? 1) > 0) contas.set(c.gerNum, filCod);
            }
        }
        const debitos: StatementDebit[] = [];
        for (const [gerNum, filCod] of contas) {
            for (let ini = inicio; ini < fim; ini += 30 * DIA + 1) {
                const lancs = await extrato.listLancamentos({
                    filCod,
                    gerNum,
                    de: new Date(ini),
                    ate: new Date(Math.min(ini + 30 * DIA, fim)),
                    exiVldTipo: EXI_VLD_TIPO.DEBITO,
                });
                for (const l of lancs) {
                    debitos.push({
                        valor: l.valor,
                        data: l.dataLancamento.getTime(),
                        ...(l.historico ? { historico: l.historico } : {}),
                    });
                }
            }
        }
        const baixas: ChannelPayment[] = [];
        for (const filCod of filiais) {
            for (const b of await realizados.listBorderosPagamento(filCod, inicio)) {
                baixas.push(...(await realizados.listBaixasPagamento(filCod, b)));
            }
        }
        log(`canal: ${contas.size} contas, ${debitos.length} débitos, ${baixas.length} baixas`);
        const limiares = { minPagamentos: 5, minMeses: 3, minParticipacao: 0.95 };
        const janela = { inicio, fim };
        const porPesCod = this.resumoCanal(baixas, debitos, limiares, janela, (b) => b.pesCod);
        const porNome = this.resumoCanal(baixas, debitos, limiares, janela, (b) =>
            b.credor ? `nome:${b.credor.toUpperCase().replace(/\s+/g, ' ')}` : undefined,
        );
        return { porPesCod, porNome, janela: { inicio, fim } };
    };

    private resumoCanal = (
        baixas: ChannelPayment[],
        debitos: StatementDebit[],
        limiares: { minPagamentos: number; minMeses: number; minParticipacao: number },
        janela: { inicio: number; fim: number },
        chave: (b: ChannelPayment) => string | undefined,
    ) => {
        const chaveadas = baixas.map((b) => {
            const k = chave(b);
            return { valor: b.valor, data: b.data, ...(k ? { pesCod: k } : {}) };
        });
        const r = this.calculator.calcular({ baixas: chaveadas, debitos, limiares, janela });
        const alta = new Set(
            r.perfis.filter((p) => p.confianca === CHANNEL_CONFIDENCE.ALTA).map((p) => p.pesCod),
        );
        let total = 0;
        let emAlta = 0;
        for (const b of chaveadas) {
            if (!b.pesCod) continue;
            total += b.valor;
            if (alta.has(b.pesCod)) emAlta += b.valor;
        }
        return {
            perfis: r.perfis.length,
            alta: alta.size,
            ambiguos: r.ambiguos,
            semDebito: r.semDebito,
            semFavorecido: r.semFavorecido,
            participacaoValorAlta: total > 0 ? Number((emAlta / total).toFixed(4)) : 0,
        };
    };

    private par = (filCod: number, a: string, b: string): string =>
        [a, b]
            .sort((x, y) => x.localeCompare(y, 'en'))
            .reduce((acc, d) => `${acc}|${d}`, `${filCod}`);
}

async function conectar(): Promise<ConexosBaseClient> {
    await container.resolve(EnvironmentProvider).getEnvironmentVars();
    const resolver = container.resolve(ConexosSessionResolver);
    container.register(LEGACY_CONEXOS_TOKEN, {
        useValue: buildLegacyConexosAdapter(() => resolver.resolve()),
    });
    const base = container.resolve(ConexosBaseClient);
    await base.ensureSid();
    return base;
}

async function main(): Promise<number> {
    mkdirSync(OUT, { recursive: true });
    const env = await container.resolve(EnvironmentProvider).getEnvironmentVars();
    const config = env.sispagVerificacao;
    const base = await conectar();
    const v = new Validacao(base);
    const filiais = process.env.PROBE_FILIAIS
        ? process.env.PROBE_FILIAIS.split(',').map(Number)
        : (await base.getFiliais()).map((f) => Number(f.filCod));

    // ── A. Duplicidade ────────────────────────────────────────────────────────────────────────
    const nossos = new Set<string>();
    const probe = new Set<string>();
    const favorecidoPorDoc = new Map<string, string>();
    for (const filCod of filiais) {
        const paginas = await v.lerFin064(filCod, config.duplicidadeDesde);
        const r = await v.paresNossos(
            filCod,
            paginas,
            config.duplicidadeDesde,
            config.duplicidadeJanelaDias,
        );
        for (const p of r.pares) nossos.add(p);
        for (const p of v.paresProbe(filCod, paginas)) probe.add(p);
        for (const t of r.titulos)
            favorecidoPorDoc.set(`${filCod}|${t.docCod}`, t.favorecido ?? '');
        log(`fin064 fil=${filCod}: ${r.titulos.length} títulos, ${r.pares.size} pares FORTE`);
    }
    const soNossos = [...nossos].filter((p) => !probe.has(p));
    const soProbe = [...probe].filter((p) => !nossos.has(p));
    const canonico = nossos.has('4|6173|6702');
    const detalhe = (p: string) => {
        const [fil, a, b] = p.split('|');
        return {
            par: p,
            favorecidoA: favorecidoPorDoc.get(`${fil}|${a}`),
            favorecidoB: favorecidoPorDoc.get(`${fil}|${b}`),
        };
    };
    const duplicidade = {
        paresNossos: nossos.size,
        paresProbe: probe.size,
        canonicoFil4_6173_6702: canonico,
        soNossos: soNossos.map(detalhe),
        soProbe: soProbe.map(detalhe),
        veredito:
            canonico && soNossos.length === 0 && soProbe.length === 0 ? 'EXATO' : 'DIVERGENTE',
    };

    // ── B. Canal ─────────────────────────────────────────────────────────────────────────────
    let canal: Record<string, unknown> = { veredito: 'NAO_EXECUTADO' };
    if (process.env.PROBE_SO_DUPLICIDADE !== '1') {
        const c = await v.canal(filiais, config.perfilJanelaMeses);
        const difShare = Math.abs(c.porNome.participacaoValorAlta - REF_ALTA_SHARE);
        const contagemOk = REF_ALTA_COUNT === null || c.porNome.alta === REF_ALTA_COUNT;
        canal = {
            ...c,
            referencia: { participacaoValorAlta: REF_ALTA_SHARE, altaCount: REF_ALTA_COUNT },
            diferencaParticipacaoPp: Number((difShare * 100).toFixed(2)),
            veredito: difShare <= TOLERANCIA_PP && contagemOk ? 'OK_TOLERANCIA' : 'DIVERGENTE',
        };
    }

    const relatorio = {
        geradoEm: new Date().toISOString(),
        filiais,
        config,
        duplicidade,
        canal,
        veredito:
            duplicidade.veredito === 'EXATO' && canal.veredito !== 'DIVERGENTE'
                ? 'PASS'
                : 'DIVERGENTE',
    };
    writeFileSync(`${OUT}/relatorio.json`, JSON.stringify(relatorio, null, 2));
    log(
        JSON.stringify(
            {
                ...relatorio,
                duplicidade: { ...duplicidade, soNossos: soNossos.length, soProbe: soProbe.length },
            },
            null,
            2,
        ),
    );
    log(`relatório completo em ${OUT}/relatorio.json`);
    return relatorio.veredito === 'PASS' ? 0 : 2;
}

main().then(
    (code) => process.exit(code),
    (err) => {
        console.error(
            'validação falhou:',
            redactErrorMessage(err instanceof Error ? err.message : String(err)),
        );
        process.exit(1);
    },
);
