import 'reflect-metadata';
import 'dotenv/config';
import { mkdirSync, writeFileSync } from 'node:fs';
import pg from 'pg';
import ConexosBaseClient, { type LegacyConexosShape } from '../domain/client/ConexosBaseClient.js';
import ConexosSispagWriteClient from '../domain/client/ConexosSispagWriteClient.js';
import { buildLegacyConexosAdapter } from '../domain/client/legacyConexosAdapter.js';
import ValorAbertoLiquido, {
    type ValoresAbertoTitulo,
} from '../domain/libs/boleto/ValorAbertoLiquido.js';
import RemessaCnabValidator from '../domain/libs/cnab/RemessaCnabValidator.js';
import { redactErrorMessage } from '../domain/libs/redact/redactErrorMessage.js';
import ValorItemImport from '../domain/libs/sispag/ValorItemImport.js';
import LogService from '../domain/service/LogService.js';
import { ConexosService } from '../services/conexos.js';
import { ConexosSessionStore } from '../services/conexosSessionStore.js';

/**
 * VALIDAÇÃO GROUND-TRUTH EM PRODUÇÃO — SOMENTE LEITURA — ajuste de centavos (ADR-0073),
 * Tasks 13 (GT1–GT4, G4/M8) e 14 (G1) num ÚNICO login no Conexos de PRD.
 *
 * ── O QUE MEDE ───────────────────────────────────────────────────────────────────────────
 *   GT1/GT2 (G4, I17b) — para a carteira ativa não paga (`titulo_a_pagar`, todas as filiais) lê
 *     o `fin064` paginado por filial e conta: as duas fórmulas da régua líquida divergentes
 *     (`totalLiquido − totalPago` × `totalAberto + juros − desconto`), títulos com `totalPago > 0`
 *     e se o `totalLiquido` deles já desconta o pago, e quantos a régua NOVA
 *     (`ValorAbertoLiquido`, Task 1) deixaria inelegíveis contra a régua de hoje (`totalAberto`).
 *   GT3 (M8, I17m) — todo `.REM` de PRD dos lotes finalizados nos últimos 30 dias (todas as
 *     filiais e bancos do `fin015/list`), cada J (não J-52) com barra > 0: barra × pagamento,
 *     pelo `RemessaCnabValidator` da Task 3. Decide `BLOQUEIA` × `AVISA`.
 *   GT4 (I17n) — grid de pendentes do `fin015` por filial (a mesma leitura da remessa): linhas
 *     com `titMnyLiquido ≠ titMnyValor`, juros/desconto ≠ 0, e o que o `ValorItemImport`
 *     (Task 2) faria com cada uma.
 *   G1 (Task 14) — matriz de permissão só leitura do login `CONEXOS_USERNAME` (credencial do
 *     SERVIDOR, nunca o CLONEX): grupos (`ger004/grupos/list`), telas FIN_070/FIN_103/FIN_106/
 *     FIN_064 → `cpoCod` (`ger016/list`), CRUD (`GET ger014/componentes/{cpo}/{grp}`; HTTP 500
 *     RECORDNOTFOUND = o grupo não tem linha) e ações (`ger014/compAcao/list/{cpo}/{grp}`).
 *     Alternativa PREFERIDA a sondar: pedir à Columbia/Conexos a matriz desse login.
 *
 * ── POR QUE NÃO ESCREVE ──────────────────────────────────────────────────────────────────
 *   1. Conexos: o adapter legado é embrulhado por `GuardaSomenteLeituraConexos`. Todo método de
 *      escrita (`postGeneric`, `postGenericOnce`, `putGenericOnce`, `postMultipartOnce`,
 *      `deleteGeneric`) LANÇA sem chegar à rede; `POST` só passa para caminho com segmento
 *      `list`; `GET` só para a lista fechada (`download` do `.REM` e `ger014/componentes`).
 *      O teste ao lado prova zero chamada de escrita rodando o job inteiro contra um ERP falso.
 *   2. Banco: só `SELECT`, sessão travada com `default_transaction_read_only = on` em TODO
 *      `pg.Client` do processo (padrão do `medir-desfecho-sugestao-boleto.ts`) e conferida com
 *      `SHOW` antes de ler. Não usa `bootstrapAppContainer` (ele roda migrations).
 *
 * ── SESSÃO CONEXOS: ESCOLHA DOCUMENTADA ──────────────────────────────────────────────────
 *   O `databaseConnectionString` aponta para o banco de PRD (só para o SELECT da carteira), então
 *   o store compartilhado (`conexos_sessions`, chave `columbia-default`) estaria LIGADO para o
 *   singleton `conexosService` — e um login local publicaria a sessão no slot do robô (memória
 *   "sessão do robô contaminável por dev local"). Este job NUNCA usa o singleton: constrói o
 *   próprio `ConexosService` com `new ConexosSessionStore({ db: null })` — store DESLIGADO, nem
 *   adota nem persiste sessão. Redundância: a trava de somente leitura do pg vale também para o
 *   Pool do store, então um `persist` acidental falharia no banco.
 *
 * ── ⚠️ EFEITO COLATERAL: UM LOGIN EM PRD ─────────────────────────────────────────────────
 *   O login pode DERRUBAR uma sessão viva do mesmo usuário no cap de sessões (o client mata a mais
 *   antiga em `LOGIN_ERROR_MAX_SESSIONS`; memória "probe local derruba sessão Conexos"). Por isso:
 *   UM login só (`SessaoUnicaConexos` recusa um segundo, inclusive o re-login de um 401 — o job
 *   aborta a seção em vez de derrubar outra sessão), flag explícita, go do maintainer, fora do
 *   horário de remessa. O `listGenericPaginated` é UMA página: toda leitura aqui confere `count`
 *   e pagina; leitura truncada é reportada (`completa: false`).
 *
 * ── SAÍDA ────────────────────────────────────────────────────────────────────────────────
 *   Só contagens, chaves de título/lote e valores. Código de barras SEMPRE mascarado 5+4. Datas
 *   do Conexos são UTC meia-noite (comparadas em UTC). JSON em `$PROBE_OUT/resultado.json`.
 *
 * Uso (de `src/backend`, pelo maintainer, com o go explícito):
 *   ALVO=prd SOMENTE_LEITURA=1 PROBE_OUT=/tmp/validate-sispag-ajuste-centavos-v1 \
 *     npx tsx jobs/validate-sispag-ajuste-centavos-v1.ts --eu-entendo-que-derruba-uma-sessao-viva
 */
export const FLAG_SESSAO = '--eu-entendo-que-derruba-uma-sessao-viva';
/**
 * Filial do cabeçalho `cnx-filcod` nas leituras de permissão (`ger*`): a permissão é do usuário,
 * não da filial, mas o client exige a filial em toda chamada (ADR-0009). PRD 2026-10-20: sem ela
 * a G1 falhou com `MISSING_FIL_COD`.
 */
const FIL_PERMISSOES = 1;
/** `SECOES=G1` (ou lista `G1,GT3`) roda só as seções pedidas — p.ex. refazer a G1 com 1 login. */
const SECOES = new Set(
    (process.env.SECOES ?? '')
        .split(',')
        .map((x) => x.trim())
        .filter(Boolean),
);
const pedida = (nome: string): boolean => SECOES.size === 0 || SECOES.has(nome);
const OUT = process.env.PROBE_OUT ?? '/tmp/validate-sispag-ajuste-centavos-v1';
const JANELA_DIAS = 30;
const DIA_MS = 24 * 60 * 60 * 1000;
const TELAS_G1 = ['FIN_070', 'FIN_103', 'FIN_106', 'FIN_064'] as const;
const MAX_AMOSTRA = 200;
const HOSTS_LOCAIS = new Set(['localhost', '127.0.0.1', '::1', '[::1]', 'host.docker.internal']);

type Linha = Record<string, unknown>;

export interface TituloCarteira {
    filCod: number;
    docCod: string;
    titCod: string;
    /** Vencimento civil `YYYY-MM-DD` (UTC). */
    venc: string | null;
    /** `forma_pagamento_conexos = 6` (BOLETO) ou `tem_boleto`. */
    boleto: boolean;
}

export interface LeituraPaginada {
    rows: Linha[];
    count: number;
    completa: boolean;
}

/** Recusa de escrita pela guarda. Nunca chega à rede. */
export class ReadOnlyViolationError extends Error {
    public constructor(metodo: string, path: string) {
        super(`somente leitura: ${metodo} ${path} recusado pela guarda`);
        this.name = 'ReadOnlyViolationError';
    }
}

/**
 * Embrulha o adapter legado do Conexos para que só LEITURA passe. Registra cada chamada
 * (método + caminho) para o teste e para o JSON de saída.
 */
export class GuardaSomenteLeituraConexos {
    /** `POST` de leitura do Conexos: caminho com um segmento `list` (`fin064/list`, `…/list/1`). */
    public static readonly POST_LEITURA = /(^|\/)list(\/|$)/;
    /** `GET` permitidos: download do `.REM` e o CRUD do grupo × tela. */
    public static readonly GET_LEITURA: readonly RegExp[] = [
        /^fin015\/gerArquivosBancos\/download\/\d+$/,
        /^ger014\/componentes\/\d+\/\d+$/,
    ];

    public static envolver = (
        inner: LegacyConexosShape,
        registro: Array<{ metodo: string; path: string }> = [],
    ): LegacyConexosShape => {
        const recusar = (metodo: string, path: string): never => {
            registro.push({ metodo: `RECUSADO:${metodo}`, path });
            throw new ReadOnlyViolationError(metodo, path);
        };
        const exigirList = (metodo: string, path: string): void => {
            if (!GuardaSomenteLeituraConexos.POST_LEITURA.test(path)) recusar(metodo, path);
            registro.push({ metodo, path });
        };
        return {
            ensureSid: () => inner.ensureSid(),
            getFiliais: () => inner.getFiliais(),
            getFilCodDefault: () => inner.getFilCodDefault(),
            listGeneric: async <T>(path: string, body: Linha, opts?: { filCod?: number }) => {
                exigirList('listGeneric', path);
                return inner.listGeneric<T>(path, body, opts);
            },
            listGenericPaginated: async <Row>(
                path: string,
                body: Linha,
                opts?: { filCod?: number },
            ) => {
                exigirList('listGenericPaginated', path);
                return inner.listGenericPaginated<Row>(path, body, opts);
            },
            getGeneric: async <T>(path: string, opts?: { filCod?: number }) => {
                if (!GuardaSomenteLeituraConexos.GET_LEITURA.some((r) => r.test(path))) {
                    recusar('getGeneric', path);
                }
                registro.push({ metodo: 'getGeneric', path });
                return inner.getGeneric<T>(path, opts);
            },
            postGeneric: async (path: string) => recusar('postGeneric', path),
            postGenericOnce: async (path: string) => recusar('postGenericOnce', path),
            putGenericOnce: async (path: string) => recusar('putGenericOnce', path),
            postMultipartOnce: async (path: string) => recusar('postMultipartOnce', path),
            deleteGeneric: async (path: string) => recusar('deleteGeneric', path),
        };
    };
}

/**
 * UM login por execução. O primeiro `login()` passa (com o retry interno por `sessionToKill`, que
 * é parte do mesmo fluxo); qualquer login novo depois dele — 401 no meio, sessão expirada — lança
 * em vez de derrubar outra sessão viva.
 */
export class SessaoUnicaConexos {
    public static limitarAUmLogin = (svc: ConexosService): { logins: () => number } => {
        let logins = 0;
        const original = svc.login.bind(svc);
        svc.login = async (sessionToKill?: string): Promise<void> => {
            if (!sessionToKill) {
                logins += 1;
                if (logins > 1) {
                    throw new Error('segundo login no Conexos recusado: o job faz UM login só');
                }
            }
            return original(sessionToKill);
        };
        return { logins: () => logins };
    };
}

const centavos = (v: number): number => Math.round(v * 100);
const reais = (c: number): number => c / 100;
const num = (v: unknown): number | undefined => {
    if (v === null || v === undefined || v === '') return undefined;
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
};
const erroDe = (e: unknown): string =>
    redactErrorMessage(e instanceof Error ? e.message : String(e));

/** Avaliação de UMA linha do `fin064` pelas duas réguas (centavos). */
export interface AvaliacaoRegua {
    completo: boolean;
    diverge: boolean;
    /** Régua NOVA (Task 1). `undefined` = inelegível `VALOR_ABERTO_INDISPONIVEL`. */
    nova?: number;
    /** Régua de HOJE (`lerTotalAberto`): `totalAberto` finito e ≥ 0. */
    antiga?: number;
    pagoCentavos: number;
    temJurosOuDesconto: boolean;
    /** Só com `totalPago > 0`: `totalLiquido == aberto + juros − desconto` (líquido já líquido). */
    liquidoJaDescontaPago?: boolean;
    /** Só com `totalPago > 0`: `totalLiquido − totalPago == aberto + juros − desconto`. */
    liquidoBrutoDoPago?: boolean;
    motivoRegressao?: 'INCOMPLETO' | 'DIVERGENTE' | 'NEGATIVO';
}

/** GT1/GT2: as duas réguas sobre a linha crua do `fin064`. Pura. */
export class AnaliseReguaLiquida {
    private static base = (v: ValoresAbertoTitulo): AvaliacaoRegua => {
        const nova = ValorAbertoLiquido.calcularCentavos(v);
        const antiga =
            v.totalAberto !== undefined && v.totalAberto >= 0 ? centavos(v.totalAberto) : undefined;
        const juros = v.titMnyJuros !== undefined ? centavos(v.titMnyJuros) : 0;
        const desconto = v.titMnyDesconto !== undefined ? centavos(v.titMnyDesconto) : 0;
        return {
            completo: false,
            diverge: false,
            ...(nova !== undefined ? { nova } : {}),
            ...(antiga !== undefined ? { antiga } : {}),
            pagoCentavos: v.totalPago !== undefined ? centavos(v.totalPago) : 0,
            temJurosOuDesconto: juros !== 0 || desconto !== 0,
        };
    };

    public static avaliar = (row: Linha): AvaliacaoRegua => {
        const v = ValorAbertoLiquido.daLinhaFin064(row);
        const base = AnaliseReguaLiquida.base(v);
        const regride = base.antiga !== undefined && base.nova === undefined;
        const { totalLiquido, totalPago, totalAberto, titMnyJuros, titMnyDesconto } = v;
        if (
            totalLiquido === undefined ||
            totalPago === undefined ||
            totalAberto === undefined ||
            titMnyJuros === undefined ||
            titMnyDesconto === undefined
        ) {
            return regride ? { ...base, motivoRegressao: 'INCOMPLETO' } : base;
        }
        const liquido = centavos(totalLiquido);
        const peloAberto = centavos(totalAberto) + centavos(titMnyJuros) - centavos(titMnyDesconto);
        // Régua vigente (PRD 2026-10-20): o `totalLiquido` já desconta o pago.
        const diverge = liquido !== peloAberto;
        return {
            ...base,
            completo: true,
            diverge,
            ...(base.pagoCentavos > 0
                ? {
                      liquidoJaDescontaPago: !diverge,
                      liquidoBrutoDoPago: liquido - base.pagoCentavos === peloAberto,
                  }
                : {}),
            ...(regride ? { motivoRegressao: diverge ? 'DIVERGENTE' : 'NEGATIVO' } : {}),
        };
    };
}

/** Acumulador de GT1/GT2 para um universo (todo o `fin064` lido, carteira, carteira boleto). */
export class AgregadoRegua {
    public total = 0;
    public incompletos = 0;
    public divergentes = 0;
    public comJurosOuDesconto = 0;
    public comPagoParcial = 0;
    public pagoLiquidoJaDescontaPago = 0;
    public pagoLiquidoBrutoDoPago = 0;
    public pagoNenhumaDasDuas = 0;
    public inelegivelHoje = 0;
    public inelegivelNova = 0;
    /** Legível hoje e inelegível pela régua nova (regressão fail-closed). */
    public regressoes = { total: 0, INCOMPLETO: 0, DIVERGENTE: 0, NEGATIVO: 0 };
    /** Legível nas duas, valor diferente (a comparação com a barra muda de resultado). */
    public valorMuda = 0;
    public amostras: Linha[] = [];

    public adicionar = (chave: string, a: AvaliacaoRegua, row: Linha): void => {
        this.total += 1;
        if (!a.completo) this.incompletos += 1;
        if (a.diverge) this.divergentes += 1;
        if (a.temJurosOuDesconto) this.comJurosOuDesconto += 1;
        if (a.antiga === undefined) this.inelegivelHoje += 1;
        if (a.nova === undefined) this.inelegivelNova += 1;
        this.contarPago(a);
        if (a.motivoRegressao) {
            this.regressoes.total += 1;
            this.regressoes[a.motivoRegressao] += 1;
        }
        const muda = a.nova !== undefined && a.antiga !== undefined && a.nova !== a.antiga;
        if (muda) this.valorMuda += 1;
        const notavel = a.diverge || !!a.motivoRegressao || a.pagoCentavos > 0 || muda;
        if (notavel) this.amostrar(chave, a, row);
    };

    private amostrar = (chave: string, a: AvaliacaoRegua, row: Linha): void => {
        if (this.amostras.length >= MAX_AMOSTRA) return;
        this.amostras.push({
            chave,
            motivoRegressao: a.motivoRegressao ?? null,
            diverge: a.diverge,
            totalLiquido: num(row.totalLiquido) ?? null,
            totalPago: num(row.totalPago) ?? null,
            totalAberto: num(row.totalAberto) ?? null,
            titMnyJuros: num(row.titMnyJuros) ?? null,
            titMnyDesconto: num(row.titMnyDesconto) ?? null,
            titMnyValor: num(row.titMnyValor) ?? null,
        });
    };

    private contarPago = (a: AvaliacaoRegua): void => {
        if (a.pagoCentavos <= 0) return;
        this.comPagoParcial += 1;
        if (a.liquidoJaDescontaPago) this.pagoLiquidoJaDescontaPago += 1;
        if (a.liquidoBrutoDoPago) this.pagoLiquidoBrutoDoPago += 1;
        if (a.completo && !a.liquidoJaDescontaPago && !a.liquidoBrutoDoPago) {
            this.pagoNenhumaDasDuas += 1;
        }
    };
}

/** Uma divergência I17m achada num `.REM` real. */
export interface DivergenciaRem {
    filCod: number;
    bncCod: number;
    flpCod: number;
    arquivo: string;
    linha: number;
    codigoMascarado: string;
    valorBarra: number;
    pagamento: number | null;
    valorTitulo: number | null;
    desconto: number | null;
    mora: number | null;
}

/** Segmento J (FEBRABAN 240, 1-indexed): 100–114 título, 115–129 desconto, 130–144 mora. */
const J_POS = {
    TITULO: [99, 114],
    DESCONTO: [114, 129],
    MORA: [129, 144],
} as const;

const campoValor = (linha: string, [ini, fim]: readonly [number, number]): number | null => {
    const s = linha.slice(ini, fim);
    return /^\d{15}$/.test(s) ? reais(Number(s)) : null;
};

export interface DependenciasValidacao {
    base: ConexosBaseClient;
    write: ConexosSispagWriteClient;
    carteira: TituloCarteira[];
    identidade: () => Promise<{ login: string; usnCod: string }>;
    agoraMs: number;
}

interface LoteLido {
    filCod: number;
    bncCod: number;
    flpCod: number;
    status: number | null;
    finalizadoEm: number | null;
    dataDebito: number | null;
}

/**
 * As quatro medições e a sonda G1 sobre UMA sessão Conexos já protegida pela guarda. Cada seção
 * captura o próprio erro e segue: uma falha não custa um segundo login.
 */
export class ValidacaoAjusteCentavosV1 {
    private readonly validador = new RemessaCnabValidator();

    public constructor(private readonly deps: DependenciasValidacao) {}

    /** Página até esgotar (`count`), com teto. `listGenericPaginated` é UMA página. */
    public paginar = async (params: {
        path: string;
        serviceName: string;
        filterList: Linha;
        filCod?: number;
        pageSize?: number;
        maxPaginas?: number;
    }): Promise<LeituraPaginada> => {
        const { path, serviceName, filterList, filCod, pageSize = 500, maxPaginas = 60 } = params;
        const rows: Linha[] = [];
        let count = Number.POSITIVE_INFINITY;
        for (let pageNumber = 1; pageNumber <= maxPaginas; pageNumber += 1) {
            const page = await this.deps.base.runWithRetry(async () => {
                await this.deps.base.ensureSid();
                return this.deps.base.listGenericPaginated<Linha>(
                    path,
                    { fieldList: [], filterList, serviceName, pageNumber, pageSize },
                    filCod !== undefined ? { filCod } : undefined,
                );
            });
            const lidas = page.rows ?? [];
            rows.push(...lidas);
            if (Number.isFinite(Number(page.count))) count = Number(page.count);
            if (lidas.length < pageSize || rows.length >= count) {
                return {
                    rows,
                    count: Number.isFinite(count) ? count : rows.length,
                    completa: true,
                };
            }
        }
        return { rows, count: Number.isFinite(count) ? count : rows.length, completa: false };
    };

    private filiais = async (): Promise<number[]> => {
        const set = new Set<number>(this.deps.carteira.map((t) => t.filCod));
        try {
            for (const f of await this.deps.base.getFiliais()) {
                if (Number.isFinite(Number(f.filCod))) set.add(Number(f.filCod));
            }
        } catch {
            // Sem filiais do login, ficam as da carteira.
        }
        return [...set].sort((a, b) => a - b);
    };

    // ── GT1/GT2 ──────────────────────────────────────────────────────────────────────────
    public medirReguaLiquida = async (): Promise<Linha> => {
        const universo = new AgregadoRegua();
        const carteira = new AgregadoRegua();
        const carteiraBoleto = new AgregadoRegua();
        const leituras: Linha[] = [];
        const porChave = new Map<string, Linha>();
        const porFilial = new Map<number, TituloCarteira[]>();
        for (const t of this.deps.carteira) {
            porFilial.set(t.filCod, [...(porFilial.get(t.filCod) ?? []), t]);
        }
        for (const [filCod, titulos] of porFilial) {
            leituras.push(await this.lerFin064DaFilial(filCod, titulos, porChave, universo));
        }
        let naoEncontrados = 0;
        for (const t of this.deps.carteira) {
            const chave = `${t.filCod}/${t.docCod}/${t.titCod}`;
            const row = porChave.get(chave);
            if (!row) {
                naoEncontrados += 1;
                continue;
            }
            const a = AnaliseReguaLiquida.avaliar(row);
            carteira.adicionar(chave, a, row);
            if (t.boleto) carteiraBoleto.adicionar(chave, a, row);
        }
        return {
            leituras,
            carteiraNoBanco: this.deps.carteira.length,
            carteiraNaoEncontradaNoFin064: naoEncontrados,
            universoFin064: universo,
            carteira,
            carteiraBoleto,
        };
    };

    private lerFin064DaFilial = async (
        filCod: number,
        titulos: TituloCarteira[],
        porChave: Map<string, Linha>,
        universo: AgregadoRegua,
    ): Promise<Linha> => {
        const vencs = titulos.map((t) => t.venc).filter((v): v is string => !!v);
        const minVenc = vencs.sort()[0];
        const filterList: Linha = { 'vldPago#EQ': 0, 'docVldPrevisao#EQ': 0 };
        // Data civil do Conexos = UTC meia-noite.
        if (minVenc) filterList['titDtaVencimento#GE'] = Date.parse(`${minVenc}T00:00:00Z`);
        try {
            const lido = await this.paginar({
                path: 'fin064/list',
                serviceName: 'fin064',
                filterList,
                filCod,
                pageSize: 1000,
            });
            for (const row of lido.rows) {
                const chave = `${filCod}/${String(row.docCod ?? '')}/${String(row.titCod ?? '1')}`;
                porChave.set(chave, row);
                universo.adicionar(chave, AnaliseReguaLiquida.avaliar(row), row);
            }
            return { filCod, linhas: lido.rows.length, count: lido.count, completa: lido.completa };
        } catch (e) {
            return { filCod, erro: erroDe(e) };
        }
    };

    // ── lotes nativos (GT3 e contexto do GT4) ────────────────────────────────────────────
    private lerLotes = async (filCod: number): Promise<{ lotes: LoteLido[]; leitura: Linha }> => {
        const lido = await this.paginar({
            path: 'fin015/list',
            serviceName: 'fin015',
            filterList: { 'filCod#EQ': filCod },
            filCod,
        });
        const vistos = new Set<string>();
        const lotes: LoteLido[] = [];
        for (const r of lido.rows) {
            const flpCod = num(r.flpCod);
            const bncCod = num(r.bncCod);
            if (flpCod === undefined || bncCod === undefined) continue;
            const k = `${bncCod}/${flpCod}`;
            if (vistos.has(k)) continue;
            vistos.add(k);
            lotes.push({
                filCod: num(r.filCod) ?? filCod,
                bncCod,
                flpCod,
                status: num(r.flpVldStatus) ?? null,
                finalizadoEm: num(r.flpTimFinaliza) ?? null,
                dataDebito: num(r.flpDtaCredito) ?? null,
            });
        }
        return {
            lotes,
            leitura: {
                filCod,
                linhas: lido.rows.length,
                count: lido.count,
                completa: lido.completa,
            },
        };
    };

    private naJanela = (l: LoteLido): boolean => {
        const corte = this.deps.agoraMs - JANELA_DIAS * DIA_MS;
        if (l.finalizadoEm !== null) return l.finalizadoEm >= corte;
        return l.dataDebito !== null && l.dataDebito >= corte;
    };

    // ── GT3 ──────────────────────────────────────────────────────────────────────────────
    private conteudoDoArquivo = async (
        filCod: number,
        arq: { gabCod: number; conteudo?: string },
    ): Promise<string> => {
        if (arq.conteudo) return arq.conteudo;
        return this.deps.write.baixarRemessa({ filCod, gabCod: arq.gabCod });
    };

    /** J (não J-52) com barra de 44 dígitos, DV válido e valor > 0 — o universo da I17m. */
    private contarJComBarraPositiva = (conteudo: string): number =>
        conteudo.split(/\r?\n/).filter((l) => {
            if (l.length < 62 || l[13] !== 'J' || l.slice(17, 19) === '52') return false;
            const barras = l.slice(17, 61);
            return (
                this.validador.dvBarrasValido(barras) && this.validador.valorDasBarras(barras) > 0
            );
        }).length;

    private analisarArquivo = (
        lote: LoteLido,
        arquivo: string,
        conteudo: string,
    ): { jTotal: number; jComBarra: number; divergencias: DivergenciaRem[]; invalidos: number } => {
        const r = this.validador.validar(conteudo);
        const linhas = conteudo.split(/\r?\n/);
        const divergencias = r.divergenciasValor.map((d): DivergenciaRem => {
            const linha = linhas[d.linha - 1] ?? '';
            return {
                filCod: lote.filCod,
                bncCod: lote.bncCod,
                flpCod: lote.flpCod,
                arquivo,
                linha: d.linha,
                codigoMascarado: d.barrasMascarada,
                valorBarra: reais(d.valorBarraCentavos),
                pagamento: d.pagamentoCentavos !== undefined ? reais(d.pagamentoCentavos) : null,
                valorTitulo: campoValor(linha, J_POS.TITULO),
                desconto: campoValor(linha, J_POS.DESCONTO),
                mora: campoValor(linha, J_POS.MORA),
            };
        });
        return {
            jTotal: r.segmentosJ,
            jComBarra: this.contarJComBarraPositiva(conteudo),
            divergencias,
            invalidos: r.invalidos.length,
        };
    };

    public medirRemessas = async (lotesPorFilial: Map<number, LoteLido[]>): Promise<Linha> => {
        const vistos = new Set<string>();
        const divergencias: DivergenciaRem[] = [];
        const arquivos: Linha[] = [];
        const erros: Linha[] = [];
        let lotesNaJanela = 0;
        let jTotal = 0;
        let jComBarra = 0;
        let jInvalidos = 0;
        for (const lotes of lotesPorFilial.values()) {
            for (const lote of lotes.filter(this.naJanela)) {
                lotesNaJanela += 1;
                try {
                    const lista = await this.deps.write.listarArquivosRemessa(lote);
                    for (const arq of lista) {
                        const k = `${lote.filCod}/${arq.gabCod}`;
                        if (vistos.has(k)) continue;
                        vistos.add(k);
                        const nome = arq.nomeArquivo ?? `gab${arq.gabCod}`;
                        const conteudo = await this.conteudoDoArquivo(lote.filCod, arq);
                        const a = this.analisarArquivo(lote, nome, conteudo);
                        jTotal += a.jTotal;
                        jComBarra += a.jComBarra;
                        jInvalidos += a.invalidos;
                        divergencias.push(...a.divergencias);
                        arquivos.push({
                            filCod: lote.filCod,
                            bncCod: lote.bncCod,
                            flpCod: lote.flpCod,
                            arquivo: nome,
                            jTotal: a.jTotal,
                            jComBarraPositiva: a.jComBarra,
                            divergencias: a.divergencias.length,
                        });
                    }
                } catch (e) {
                    erros.push({ filCod: lote.filCod, flpCod: lote.flpCod, erro: erroDe(e) });
                }
            }
        }
        return {
            janelaDias: JANELA_DIAS,
            lotesNaJanela,
            arquivos: arquivos.length,
            segmentosJ: jTotal,
            jComBarraPositiva: jComBarra,
            jBarraInvalida: jInvalidos,
            divergentes: divergencias.length,
            veredito: divergencias.length === 0 ? 'BLOQUEIA (zero divergência)' : 'ANALISAR',
            divergencias,
            porArquivo: arquivos,
            erros,
        };
    };

    // ── GT4 ──────────────────────────────────────────────────────────────────────────────
    public medirPendentes = async (lotesPorFilial: Map<number, LoteLido[]>): Promise<Linha> => {
        const vistas = new Set<string>();
        const leituras: Linha[] = [];
        const amostras: Linha[] = [];
        const c = {
            linhas: 0,
            semLiquido: 0,
            liquidoDiferenteDoValor: 0,
            jurosNaoZero: 0,
            descontoNaoZero: 0,
            importIndisponivel: 0,
            importMudaValor: 0,
            somaAbsDeltaCentavos: 0,
        };
        for (const [filCod, lotes] of lotesPorFilial) {
            const contexto = [...lotes].sort((a, b) => b.flpCod - a.flpCod)[0];
            if (!contexto) {
                leituras.push({ filCod, erro: 'filial sem lote nativo (sem contexto de leitura)' });
                continue;
            }
            const { bncCod, flpCod } = contexto;
            try {
                const lido = await this.paginar({
                    path: `fin015/finItemSispag/titulosPendentes/list/${filCod}/${bncCod}/${flpCod}`,
                    serviceName: 'fin015',
                    filterList: {},
                    filCod,
                });
                leituras.push({
                    filCod,
                    bncCod,
                    flpCod,
                    linhas: lido.rows.length,
                    count: lido.count,
                    completa: lido.completa,
                });
                for (const r of lido.rows) {
                    const chave = `${String(r.filCod ?? filCod)}/${String(r.docCod ?? '')}/${String(r.titCod ?? '1')}`;
                    if (vistas.has(chave)) continue;
                    vistas.add(chave);
                    this.contarPendente(chave, r, c, amostras);
                }
            } catch (e) {
                leituras.push({ filCod, bncCod, flpCod, erro: erroDe(e) });
            }
        }
        return { leituras, ...c, amostras };
    };

    private contarPendente = (
        chave: string,
        r: Linha,
        c: Record<string, number>,
        amostras: Linha[],
    ): void => {
        c.linhas += 1;
        const valor = num(r.titMnyValor);
        const liquido = num(r.titMnyLiquido);
        const juros = num(r.titMnyJuros) ?? 0;
        const desconto = num(r.titMnyDesconto) ?? 0;
        if (liquido === undefined) c.semLiquido += 1;
        const difere =
            liquido !== undefined && valor !== undefined && centavos(liquido) !== centavos(valor);
        if (difere) c.liquidoDiferenteDoValor += 1;
        if (centavos(juros) !== 0) c.jurosNaoZero += 1;
        if (centavos(desconto) !== 0) c.descontoNaoZero += 1;
        const { valorImport, delta } = this.contarImport(r, valor, c);
        const notavel =
            difere || delta !== 0 || valorImport === undefined || juros !== 0 || desconto !== 0;
        if (notavel && amostras.length < MAX_AMOSTRA) {
            amostras.push({
                chave,
                titMnyValor: valor ?? null,
                titMnyLiquido: liquido ?? null,
                titMnyJuros: juros,
                titMnyDesconto: desconto,
                valorImport: valorImport ?? null,
            });
        }
    };

    /** I17n: o que o `ValorItemImport` (Task 2) levaria ao `importar` × o `titMnyValor` de hoje. */
    private contarImport = (
        r: Linha,
        valor: number | undefined,
        c: Record<string, number>,
    ): { valorImport?: number; delta: number } => {
        const imp = ValorItemImport.valorDoItem(r);
        if (!imp.disponivel) {
            c.importIndisponivel += 1;
            return { delta: 0 };
        }
        const delta = valor !== undefined ? centavos(imp.valor) - centavos(valor) : 0;
        if (delta !== 0) {
            c.importMudaValor += 1;
            c.somaAbsDeltaCentavos += Math.abs(delta);
        }
        return { valorImport: imp.valor, delta };
    };

    // ── G1 (Task 14) ─────────────────────────────────────────────────────────────────────
    private crudDoGrupo = async (cpoCod: number, grpCod: number): Promise<Linha> => {
        try {
            const r = await this.deps.base.getGeneric<Linha>(
                `ger014/componentes/${cpoCod}/${grpCod}`,
                { filCod: FIL_PERMISSOES },
            );
            const dado = (r?.data as Linha | undefined) ?? r ?? {};
            const crud: Linha = {};
            for (const [k, v] of Object.entries(dado)) {
                if (/select|insert|update|delete|report/i.test(k)) crud[k] = v;
            }
            return { temLinha: true, crud };
        } catch (e) {
            const resp = (e as { response?: { status?: number; data?: { type?: string } } })
                ?.response;
            if (resp?.status === 500) {
                return { temLinha: false, motivo: resp.data?.type ?? 'HTTP 500 (sem linha)' };
            }
            return { erro: erroDe(e) };
        }
    };

    private acoesDoGrupo = async (cpoCod: number, grpCod: number): Promise<Linha> => {
        try {
            const lido = await this.paginar({
                path: `ger014/compAcao/list/${cpoCod}/${grpCod}`,
                serviceName: 'ger014',
                filCod: FIL_PERMISSOES,
                filterList: {},
            });
            const acoes = lido.rows.map((row) => {
                const p: Linha = {};
                for (const [k, v] of Object.entries(row)) {
                    if (v === null || typeof v !== 'object') p[k] = v;
                }
                return p;
            });
            return { acoes, completa: lido.completa };
        } catch (e) {
            return { erro: erroDe(e) };
        }
    };

    private nomeDaAcao = (a: Linha): string =>
        Object.entries(a)
            .filter(([k, v]) => /des|nome/i.test(k) && typeof v === 'string')
            .map(([, v]) => String(v))
            .join(' | ');

    public sondarPermissoes = async (): Promise<Linha> => {
        const { login, usnCod } = await this.deps.identidade();
        const grupos = await this.paginar({
            path: `ger004/grupos/list/${usnCod}`,
            serviceName: 'ger004',
            filCod: FIL_PERMISSOES,
            filterList: {},
        });
        const grpCods = [...new Set(grupos.rows.map((g) => num(g.grpCod)))].filter(
            (g): g is number => g !== undefined,
        );
        const componentes = await this.paginar({
            path: 'ger016/list',
            serviceName: 'ger016',
            filCod: FIL_PERMISSOES,
            filterList: {},
            pageSize: 1000,
        });
        const normal = (s: unknown): string =>
            String(s ?? '')
                .toUpperCase()
                .replace(/[^A-Z0-9]/g, '');
        const alvo = new Set(TELAS_G1.map(normal));
        const telas = componentes.rows
            .filter((c) => alvo.has(normal(c.cpoDesArquivo)))
            .map((c) => ({
                cpoCod: Number(c.cpoCod),
                arquivo: String(c.cpoDesArquivo),
                nome: String(c.cpoDesNome ?? ''),
            }));
        const matriz: Linha[] = [];
        for (const tela of telas) {
            for (const grpCod of grpCods) {
                const crud = await this.crudDoGrupo(tela.cpoCod, grpCod);
                const acoes = crud.temLinha ? await this.acoesDoGrupo(tela.cpoCod, grpCod) : {};
                const nomes = ((acoes.acoes as Linha[] | undefined) ?? []).map(this.nomeDaAcao);
                matriz.push({ ...tela, grpCod, ...crud, ...acoes, nomesAcoes: nomes });
            }
        }
        const nomesDaTela = (arquivo: string): string =>
            matriz
                .filter((m) => normal(m.arquivo) === normal(arquivo))
                .flatMap((m) => m.nomesAcoes as string[])
                .join(' ; ')
                .toUpperCase();
        let concessoesAvulsas: Linha;
        try {
            const c = await this.paginar({
                path: 'ger061/list',
                serviceName: 'ger061',
                filCod: FIL_PERMISSOES,
                filterList: { 'usnCod#EQ': Number(usnCod) },
            });
            concessoesAvulsas = { linhas: c.rows.length, completa: c.completa };
        } catch (e) {
            concessoesAvulsas = { erro: erroDe(e) };
        }
        return {
            login,
            usnCod,
            grupos: grupos.rows.map((g) => ({
                grpCod: g.grpCod,
                nome: g.grpDesNome ?? g.grpDesGrupo ?? null,
            })),
            telasEncontradas: telas,
            telasNaoEncontradas: TELAS_G1.filter(
                (t) => !telas.some((x) => normal(x.arquivo) === normal(t)),
            ),
            componentesLidos: {
                linhas: componentes.rows.length,
                count: componentes.count,
                completa: componentes.completa,
            },
            matriz,
            destaques: {
                fin070Finalizar: /FINALIZ/.test(nomesDaTela('FIN_070')),
                fin070Cancelar: /CANCEL/.test(nomesDaTela('FIN_070')),
                fin103Liberar: /LIBER|APROV/.test(nomesDaTela('FIN_103')),
            },
            concessoesAvulsas,
        };
    };

    // ── orquestração ─────────────────────────────────────────────────────────────────────
    private secao = async (nome: string, fn: () => Promise<Linha>): Promise<Linha> => {
        try {
            return await fn();
        } catch (e) {
            return { secao: nome, erro: erroDe(e) };
        }
    };

    public executar = async (): Promise<Linha> => {
        await this.deps.base.ensureSid();
        const g1 = pedida('G1') ? await this.secao('G1', this.sondarPermissoes) : undefined;
        if (!pedida('GT1') && !pedida('GT3') && !pedida('GT4')) return { g1 };
        const gt12 = await this.secao('GT1/GT2', this.medirReguaLiquida);
        const lotesPorFilial = new Map<number, LoteLido[]>();
        const leiturasLotes: Linha[] = [];
        for (const filCod of await this.filiais()) {
            try {
                const { lotes, leitura } = await this.lerLotes(filCod);
                lotesPorFilial.set(filCod, lotes);
                leiturasLotes.push({
                    ...leitura,
                    lotes: lotes.length,
                    naJanela: lotes.filter(this.naJanela).length,
                });
            } catch (e) {
                leiturasLotes.push({ filCod, erro: erroDe(e) });
            }
        }
        const gt3 = await this.secao('GT3', () => this.medirRemessas(lotesPorFilial));
        const gt4 = await this.secao('GT4', () => this.medirPendentes(lotesPorFilial));
        return {
            executadoEm: new Date(this.deps.agoraMs).toISOString(),
            g1,
            gt1gt2: gt12,
            lotesNativos: leiturasLotes,
            gt3,
            gt4,
        };
    };
}

/**
 * Todo `pg.Client` do processo roda `SET default_transaction_read_only = on` ao conectar (o
 * pooler ignora `PGOPTIONS`). Cópia do padrão do `medir-desfecho-sugestao-boleto.ts`.
 */
export class TravaSomenteLeituraPg {
    public static aplicar = (): void => {
        const proto = pg.Client.prototype as unknown as {
            connect: (cb?: (err?: Error) => void) => unknown;
            query: (sql: string) => Promise<unknown>;
        };
        const conectar = proto.connect;
        proto.connect = function (this: typeof proto, cb?: (err?: Error) => void) {
            if (!cb) {
                return (conectar.call(this) as Promise<void>).then(() =>
                    this.query('SET default_transaction_read_only = on'),
                );
            }
            return conectar.call(this, (err?: Error) => {
                if (err) return cb(err);
                this.query('SET default_transaction_read_only = on').then(
                    () => cb(),
                    (e: Error) => cb(e),
                );
            });
        };
    };
}

const recusar = (motivo: string): number => {
    console.error(`RECUSADO: ${motivo}`);
    return 1;
};

const conferirGuardas = (): string | undefined => {
    if (process.env.ALVO !== 'prd') return 'exige ALVO=prd.';
    if (process.env.SOMENTE_LEITURA !== '1') return 'exige SOMENTE_LEITURA=1.';
    if (!process.argv.includes(FLAG_SESSAO)) {
        return `o login pode derrubar uma sessão viva em PRD. Rode com ${FLAG_SESSAO}.`;
    }
    const base = (process.env.CONEXOS_BASE_URL ?? '').toLowerCase();
    if (base.includes('hml')) return `CONEXOS_BASE_URL é HML (${base}); este job é só PRD.`;
    const usuario = process.env.CONEXOS_USERNAME ?? '';
    if (usuario === '' || !process.env.CONEXOS_PASSWORD)
        return 'CONEXOS_USERNAME/PASSWORD ausentes.';
    if (usuario.toUpperCase() === 'CLONEX') {
        return 'CONEXOS_USERNAME é o CLONEX; a G1 é do login do SERVIDOR.';
    }
    const conexao = process.env.databaseConnectionString ?? '';
    if (conexao === '') return 'databaseConnectionString ausente (banco de PRD, só SELECT).';
    try {
        const host = new URL(conexao).hostname.toLowerCase();
        if (HOSTS_LOCAIS.has(host)) return 'databaseConnectionString aponta para banco local.';
    } catch {
        return 'databaseConnectionString ilegível.';
    }
    return undefined;
};

const lerCarteira = async (): Promise<TituloCarteira[] | string> => {
    TravaSomenteLeituraPg.aplicar();
    const db = new pg.Client({
        connectionString: process.env.databaseConnectionString,
        ssl: { rejectUnauthorized: false },
    });
    await db.connect();
    try {
        const ro = await db.query('SHOW default_transaction_read_only');
        if (ro.rows[0]?.default_transaction_read_only !== 'on') {
            return 'a sessão do banco não está em modo somente leitura.';
        }
        const { rows } = await db.query(
            `SELECT fil_cod, doc_cod, tit_cod,
                    to_char(vencimento AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS venc,
                    (forma_pagamento_conexos = 6 OR tem_boleto IS TRUE) AS boleto
               FROM titulo_a_pagar WHERE ativo AND NOT pago`,
        );
        return rows.map((r) => ({
            filCod: Number(r.fil_cod),
            docCod: String(r.doc_cod),
            titCod: String(r.tit_cod ?? '1'),
            venc: r.venc ?? null,
            boleto: r.boleto === true,
        }));
    } finally {
        await db.end();
    }
};

const resumir = (r: Linha): void => {
    const g1 = r.g1 as Linha;
    const gt12 = r.gt1gt2 as Linha;
    const gt3 = r.gt3 as Linha;
    const gt4 = r.gt4 as Linha;
    const agg = (a: unknown): Linha => {
        const x = (a ?? {}) as Linha;
        return {
            total: x.total,
            incompletos: x.incompletos,
            divergentes: x.divergentes,
            comPagoParcial: x.comPagoParcial,
            pagoLiquidoJaDescontaPago: x.pagoLiquidoJaDescontaPago,
            pagoLiquidoBrutoDoPago: x.pagoLiquidoBrutoDoPago,
            pagoNenhumaDasDuas: x.pagoNenhumaDasDuas,
            regressoes: x.regressoes,
            valorMuda: x.valorMuda,
        };
    };
    console.log('='.repeat(78));
    console.log(
        '[G1] permissão',
        JSON.stringify({
            login: g1.login,
            usnCod: g1.usnCod,
            destaques: g1.destaques,
            telasNaoEncontradas: g1.telasNaoEncontradas,
            erro: g1.erro,
        }),
    );
    for (const m of (g1.matriz as Linha[] | undefined) ?? []) {
        console.log(
            `   ${m.arquivo} cpo=${m.cpoCod} grp=${m.grpCod} linha=${m.temLinha ?? '?'} crud=${JSON.stringify(m.crud ?? m.motivo ?? m.erro)} ações=${JSON.stringify(m.nomesAcoes)}`,
        );
    }
    // `SECOES=G1`: as demais seções não rodaram; nada a imprimir.
    if (!gt12) return;
    console.log(
        '[GT1/GT2] carteira',
        JSON.stringify({
            noBanco: gt12.carteiraNoBanco,
            naoEncontrada: gt12.carteiraNaoEncontradaNoFin064,
            erro: gt12.erro,
        }),
    );
    console.log('   universo fin064 ', JSON.stringify(agg(gt12.universoFin064)));
    console.log('   carteira        ', JSON.stringify(agg(gt12.carteira)));
    console.log('   carteira boleto ', JSON.stringify(agg(gt12.carteiraBoleto)));
    console.log(
        '[GT3] .REM 30 dias',
        JSON.stringify({
            lotes: gt3.lotesNaJanela,
            arquivos: gt3.arquivos,
            J: gt3.segmentosJ,
            jComBarra: gt3.jComBarraPositiva,
            divergentes: gt3.divergentes,
            veredito: gt3.veredito,
            erros: (gt3.erros as unknown[] | undefined)?.length,
            erro: gt3.erro,
        }),
    );
    for (const d of (gt3.divergencias as DivergenciaRem[] | undefined) ?? []) {
        console.log(
            `   fil=${d.filCod} flp=${d.flpCod} ${d.arquivo}:${d.linha} ${d.codigoMascarado} barra=${d.valorBarra} pgto=${d.pagamento} título=${d.valorTitulo} desc=${d.desconto} mora=${d.mora}`,
        );
    }
    console.log(
        '[GT4] pendentes',
        JSON.stringify({
            linhas: gt4.linhas,
            semLiquido: gt4.semLiquido,
            liquidoDiferenteDoValor: gt4.liquidoDiferenteDoValor,
            jurosNaoZero: gt4.jurosNaoZero,
            descontoNaoZero: gt4.descontoNaoZero,
            importIndisponivel: gt4.importIndisponivel,
            importMudaValor: gt4.importMudaValor,
            somaAbsDeltaCentavos: gt4.somaAbsDeltaCentavos,
            erro: gt4.erro,
        }),
    );
    console.log('='.repeat(78));
};

const main = async (): Promise<number> => {
    const recusa = conferirGuardas();
    if (recusa) return recusar(recusa);
    mkdirSync(OUT, { recursive: true });

    // Banco ANTES do login: uma falha aqui não gasta o único login.
    const carteira = await lerCarteira();
    if (typeof carteira === 'string') return recusar(carteira);

    const svc = new ConexosService({ sessionStore: new ConexosSessionStore({ db: null }) });
    const sessao = SessaoUnicaConexos.limitarAUmLogin(svc);
    const chamadas: Array<{ metodo: string; path: string }> = [];
    const legacy = GuardaSomenteLeituraConexos.envolver(
        buildLegacyConexosAdapter(async () => svc),
        chamadas,
    );
    const base = new ConexosBaseClient(legacy);
    const write = new ConexosSispagWriteClient(base, new LogService());
    const job = new ValidacaoAjusteCentavosV1({
        base,
        write,
        carteira,
        identidade: async () => ({
            login: process.env.CONEXOS_USERNAME ?? '',
            usnCod: (await svc.getSid()).usnCod,
        }),
        agoraMs: Date.now(),
    });
    const resultado = await job.executar();
    const recusadas = chamadas.filter((c) => c.metodo.startsWith('RECUSADO:'));
    const saida = { ...resultado, logins: sessao.logins(), chamadas: chamadas.length, recusadas };
    writeFileSync(`${OUT}/resultado.json`, JSON.stringify(saida, null, 2));
    resumir(saida);
    console.log(
        `logins=${sessao.logins()} chamadas=${chamadas.length} recusadas=${recusadas.length}`,
    );
    console.log(`JSON: ${OUT}/resultado.json`);
    return recusadas.length === 0 ? 0 : 1;
};

if (process.argv[1]?.endsWith('validate-sispag-ajuste-centavos-v1.ts')) {
    main()
        .then((code) => process.exit(code))
        .catch((e) => {
            console.error('[validate-sispag-ajuste-centavos-v1] FATAL:', erroDe(e));
            process.exit(1);
        });
}
