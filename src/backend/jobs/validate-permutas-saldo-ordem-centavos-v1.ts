import 'reflect-metadata';
import 'dotenv/config';
import { container } from 'tsyringe';
import ConexosBaixaClient from '../domain/client/ConexosBaixaClient.js';
import ConexosBaseClient, { LEGACY_CONEXOS_TOKEN } from '../domain/client/ConexosBaseClient.js';
import ConexosCadastroClient, {
    type DeclaracaoEntry,
} from '../domain/client/ConexosCadastroClient.js';
import ConexosSessionResolver from '../domain/client/ConexosSessionResolver.js';
import ConexosTitulosClient from '../domain/client/ConexosTitulosClient.js';
import PostgreeDatabaseClient from '../domain/client/database/PostgreeDatabaseClient.js';
import { buildLegacyConexosAdapter } from '../domain/client/legacyConexosAdapter.js';
import type Adiantamento from '../domain/interface/permutas/Adiantamento.js';
import {
    ESTADO_ELEGIBILIDADE,
    MOTIVO_BLOQUEIO,
} from '../domain/interface/permutas/EstadoElegibilidade.js';
import ToleranciaResiduo from '../domain/interface/permutas/ToleranciaResiduo.js';
import type { AlocacaoRow } from '../domain/repository/permutas/PermutaAlocacaoRepository.js';
import type { ConsumoExecucaoRow } from '../domain/repository/permutas/PermutaExecucaoRepository.js';
import ElegibilidadeService from '../domain/service/permutas/ElegibilidadeService.js';
import SaldoAlocacaoAdiantamentoService from '../domain/service/permutas/SaldoAlocacaoAdiantamentoService.js';

/**
 * Ground-Truth Validation — `permutas-saldo-ordem-centavos` (v1). ADR-0046.
 *
 * Compara o que a NOSSA lógica de produção produz — `ToleranciaResiduo` (D1),
 * `ElegibilidadeService.avaliarElegibilidade` (D2) e `SaldoAlocacaoAdiantamentoService`
 * (D3) — contra o ground truth nativo do ERP, AO VIVO:
 *   - `GET com298/{docCod}` (RESUMO DOS TÍTULOS): `mnyTitPermutar`, `mnyTitPermuta`, `mnyTitAberto`;
 *   - `fin010/list` com `borCod#IN`: `borVldFinalizado`, `borCodEstornado`;
 *   - `listDeclaracaoByProcesso` (D.I/DUIMP).
 * Importa as funções de produção em vez de reimplementar a regra: um validador que reescreve a
 * fórmula valida a si mesmo. (A única linha replicada é o roteamento de cliente-filtro, privado
 * do `EleicaoPermutasService`, e mesmo ela usa os predicados de produção.)
 *
 * V1 (saldo, D3): consumo montado do status VIVO do borderô (sem a guarda de frescor, que é
 *   propriedade do snapshot e tem teste unitário). `nosso = mnyTitPermutar/taxa − Σ naoConsumido`.
 *   GT da classificação: `consumidoErp = valorMoedaNegociada − mnyTitPermutar/taxa` deve bater com
 *   `consumidoNosso = Σ (alocado − naoConsumido)` das alocações da trilha.
 *     |Δ| ≤ 0,01 → EXATO/OK_CENTAVO · Δ > 0 (ERP abateu MAIS: conservador) → EXPLICADO, com a
 *     razão · Δ < 0 (contamos como consumido o que o ERP NÃO abateu: sentido perigoso) → DIVERGENTE.
 * V2 (motivo, D1+D2): hidratação e avaliação de produção sobre detalhe + declarações vivos.
 * V3 (fronteira R$1,00/1,01): SEM_GROUND_TRUTH — não há documento real; coberto por teste unitário.
 *
 * READ-ONLY, sessão única, chamadas sequenciais:
 *   - ERP: só `GET com298/{docCod}`, `POST fin010/list`, `POST imp0xx/list` (listagens).
 *   - Banco: só `SELECT`, todos dentro de UMA transação `SET TRANSACTION READ ONLY` (verificada
 *     com `SHOW transaction_read_only` antes da primeira leitura). O pooler do Supabase ignora o
 *     `PGOPTIONS`, então a garantia fica no próprio script.
 *   - NÃO usa `bootstrapAppContainer`: ele roda o `MigrationRunner`. O wiring abaixo é o mesmo,
 *     sem migrations.
 *
 * Run:
 *   cd src/backend && CONEXOS_WRITE_ENABLED=false CONEXOS_DRY_RUN=true PROBE_ALLOW_PRD=1 \
 *     npx tsx jobs/validate-permutas-saldo-ordem-centavos-v1.ts
 */
const BASE = process.env.CONEXOS_BASE_URL ?? '';
if (!BASE.includes('-hml') && process.env.PROBE_ALLOW_PRD !== '1') {
    console.error(`RECUSADO: base é PRODUÇÃO (${BASE}); rode com PROBE_ALLOW_PRD=1.`);
    process.exit(1);
}

const TOL = 0.01;
const DOCS_RESIDUO_INOX = [
    '10208',
    '10571',
    '10865',
    '11286',
    '11296',
    '12884',
    '17081',
    '17286',
    '17292',
    '17872',
    '17873',
    '17890',
    '17901',
    '17927',
    '17930',
    '20434',
    '21145',
    '21147',
    '23111',
    '24162',
    '24164',
    '25783',
    '25895',
    '7639',
    '7646',
    '9879',
];
const DOCS_NAO_PAGO_REAL = ['3754', '20418', '5885', '21841', '4576'];
const DOC_8721 = '8721';
const DOCS_V1_CANONICOS = ['12860', '9328', '9335', '9869', '9870', '10307'];

type Veredito = 'EXATO' | 'OK_CENTAVO' | 'EXPLICADO' | 'DIVERGENTE' | 'SEM_GROUND_TRUTH';

interface Linha {
    grupo: string;
    docCod: string;
    esperado: string;
    observado: string;
    veredito: Veredito;
    razao?: string;
}

interface AdtoDb {
    docCod: string;
    priCod: string;
    filCod: number;
    taxa?: number;
    valorMoedaNegociada?: number;
    pesCod?: string;
    estado: string;
    motivo?: string;
    pagoDb: boolean;
    valorPermutarDb?: number;
}

interface ExecucaoDb {
    adiantamentoDocCod: string;
    invoiceDocCod: string;
    filCod: number;
    borCod?: number;
    status: 'settled' | 'parcial';
    valorResidualUsd?: number;
    criadoEm: Date;
}

interface Detalhe {
    valorPermutar?: number;
    pago?: boolean;
    valorPermutado?: number;
    valorAberto?: number;
}

const num = (v: unknown): number | undefined =>
    v === null || v === undefined || !Number.isFinite(Number(v)) ? undefined : Number(v);
const fmt = (v: number | undefined): string => (v === undefined ? '—' : v.toFixed(2));
const vereditoNumerico = (delta: number): Veredito =>
    Math.abs(delta) < 0.0005 ? 'EXATO' : Math.abs(delta) <= TOL ? 'OK_CENTAVO' : 'DIVERGENTE';

const main = async (): Promise<void> => {
    // Wiring do bootstrap SEM migrations (ver docblock).
    const resolver = container.resolve(ConexosSessionResolver);
    container.register(LEGACY_CONEXOS_TOKEN, {
        useValue: buildLegacyConexosAdapter(() => resolver.resolve()),
    });
    container.resolve(ConexosBaseClient);
    const database = container.resolve(PostgreeDatabaseClient);

    const titulos = container.resolve(ConexosTitulosClient);
    const baixa = container.resolve(ConexosBaixaClient);
    const cadastro = container.resolve(ConexosCadastroClient);
    const elegibilidade = container.resolve(ElegibilidadeService);
    const saldo = container.resolve(SaldoAlocacaoAdiantamentoService);

    // ───────────────────────── Banco (SELECT, transação READ ONLY) ─────────────────────────
    const dados = await database.withTransaction(async (db) => {
        await db.selectMany('SET TRANSACTION READ ONLY');
        const ro = await db.selectFirst<{ transaction_read_only: string }>(
            'SHOW transaction_read_only',
        );
        if (ro?.transaction_read_only !== 'on') {
            throw new Error('transação do banco NÃO está read-only — abortando antes de ler');
        }
        const adtoRows = await db.selectMany(
            `SELECT doc_cod, pri_cod, fil_cod, taxa, valor_moeda_negociada, pes_cod,
                    estado_elegibilidade, motivo_bloqueio, pago, valor_permutar
             FROM permuta_adiantamento`,
        );
        const adtos = new Map<string, AdtoDb>();
        for (const r of adtoRows) {
            adtos.set(String(r.doc_cod), {
                docCod: String(r.doc_cod),
                priCod: String(r.pri_cod),
                filCod: Number(r.fil_cod ?? 0),
                ...(num(r.taxa) !== undefined ? { taxa: num(r.taxa) } : {}),
                ...(num(r.valor_moeda_negociada) !== undefined
                    ? { valorMoedaNegociada: num(r.valor_moeda_negociada) }
                    : {}),
                ...(r.pes_cod != null ? { pesCod: String(r.pes_cod) } : {}),
                estado: String(r.estado_elegibilidade),
                ...(r.motivo_bloqueio != null ? { motivo: String(r.motivo_bloqueio) } : {}),
                pagoDb: r.pago === true,
                ...(num(r.valor_permutar) !== undefined
                    ? { valorPermutarDb: num(r.valor_permutar) }
                    : {}),
            });
        }
        const execRows = await db.selectMany(
            `SELECT adiantamento_doc_cod, invoice_doc_cod, fil_cod, bor_cod, status,
                    valor_residual_usd, criado_em
             FROM permuta_alocacao_execucao
             WHERE dry_run = false AND status IN ('settled', 'parcial')`,
        );
        const execucoes: ExecucaoDb[] = execRows.map((r) => ({
            adiantamentoDocCod: String(r.adiantamento_doc_cod),
            invoiceDocCod: String(r.invoice_doc_cod),
            filCod: Number(r.fil_cod),
            ...(num(r.bor_cod) !== undefined ? { borCod: num(r.bor_cod) } : {}),
            status: r.status === 'parcial' ? 'parcial' : 'settled',
            ...(num(r.valor_residual_usd) !== undefined
                ? { valorResidualUsd: num(r.valor_residual_usd) }
                : {}),
            criadoEm: new Date(r.criado_em),
        }));
        const alocRows = await db.selectMany(
            `SELECT adiantamento_doc_cod, invoice_doc_cod, valor_alocado, criado_em, atualizado_em
             FROM permuta_alocacao`,
        );
        const alocacoesPorAdto = new Map<string, AlocacaoRow[]>();
        for (const r of alocRows) {
            const al: AlocacaoRow = {
                adiantamentoDocCod: String(r.adiantamento_doc_cod),
                invoiceDocCod: String(r.invoice_doc_cod),
                valorAlocado: Number(r.valor_alocado),
                criadoEm: new Date(r.criado_em),
                atualizadoEm: new Date(r.atualizado_em ?? r.criado_em),
            };
            const lista = alocacoesPorAdto.get(al.adiantamentoDocCod) ?? [];
            lista.push(al);
            alocacoesPorAdto.set(al.adiantamentoDocCod, lista);
        }
        const cacheRows = await db.selectMany(
            `SELECT fil_cod, bor_cod, bor_vld_finalizado, bor_cod_estornado, atualizado_em
             FROM permuta_bordero`,
        );
        const cache = new Map<string, Record<string, unknown>>(
            cacheRows.map((r) => [`${r.fil_cod}:${r.bor_cod}`, r]),
        );
        const filtroRows = await db.selectMany(
            'SELECT pes_cod FROM cliente_filtro WHERE ativo = true',
        );
        const filtroPesCods = new Set(filtroRows.map((r) => String(r.pes_cod)));
        const runRows = await db.selectMany(
            `SELECT a.doc_cod, r.started_at
             FROM permuta_adiantamento a JOIN permuta_eleicao_run r ON r.id = a.last_ingest_run_id`,
        );
        const ingestaoPorAdto = new Map<string, Date>(
            runRows.map((r) => [String(r.doc_cod), new Date(r.started_at)]),
        );
        return { adtos, execucoes, alocacoesPorAdto, cache, filtroPesCods, ingestaoPorAdto };
    });
    const { adtos, execucoes, alocacoesPorAdto, cache, filtroPesCods, ingestaoPorAdto } = dados;

    // ───────────────────────── ERP (leituras, cache por chave) ─────────────────────────
    const detalhes = new Map<string, Detalhe | null>();
    const detalheDe = async (a: AdtoDb): Promise<Detalhe | null> => {
        const cached = detalhes.get(a.docCod);
        if (cached !== undefined) return cached;
        const d = await titulos
            .getDetalheTitulos({ docCod: a.docCod, filCod: a.filCod })
            .catch((e: unknown) => {
                console.warn(`detalhe ${a.docCod} indisponível: ${String(e)}`);
                return null;
            });
        detalhes.set(a.docCod, d);
        return d;
    };

    const borderosVivos = new Map<string, { fin?: number; estornado: boolean }>();
    const borCodsPorFilial = new Map<number, Set<number>>();
    for (const e of execucoes) {
        if (e.borCod === undefined) continue;
        const s = borCodsPorFilial.get(e.filCod) ?? new Set<number>();
        s.add(e.borCod);
        borCodsPorFilial.set(e.filCod, s);
    }
    for (const [filCod, set] of borCodsPorFilial) {
        const lista = [...set];
        for (let i = 0; i < lista.length; i += 100) {
            const lote = lista.slice(i, i + 100);
            const itens = await baixa.listBorderos({ filCod, borCods: lote });
            for (const b of itens) {
                if (!lote.includes(b.borCod)) continue;
                borderosVivos.set(`${filCod}:${b.borCod}`, {
                    ...(b.borVldFinalizado !== undefined ? { fin: b.borVldFinalizado } : {}),
                    estornado: b.borCodEstornado != null,
                });
            }
        }
    }

    const declaracoesPorProcesso = new Map<string, DeclaracaoEntry[]>();
    const carregarDeclaracoes = async (lista: AdtoDb[]): Promise<void> => {
        const porFilial = new Map<number, Set<string>>();
        for (const a of lista) {
            const chave = `${a.filCod}:${a.priCod}`;
            if (declaracoesPorProcesso.has(chave)) continue;
            const s = porFilial.get(a.filCod) ?? new Set<string>();
            s.add(a.priCod);
            porFilial.set(a.filCod, s);
        }
        for (const [filCod, priCods] of porFilial) {
            const entradas = await cadastro.listDeclaracaoByProcesso({
                priCods: [...priCods],
                filCod,
            });
            for (const p of priCods) declaracoesPorProcesso.set(`${filCod}:${p}`, []);
            for (const d of entradas) {
                declaracoesPorProcesso.get(`${filCod}:${d.priCod}`)?.push(d);
            }
        }
    };

    const linhas: Linha[] = [];

    // ───────────────────────── V1 — saldo restante (D3) ─────────────────────────
    const adtosComExecucao = new Set(execucoes.map((e) => e.adiantamentoDocCod));
    for (const d of DOCS_V1_CANONICOS) adtosComExecucao.add(d);
    const esperadoCanonico: Record<string, number> = { '12860': 30364.73, '9328': 39652.47 };

    for (const docCod of [...adtosComExecucao].sort((x, y) => Number(x) - Number(y))) {
        const a = adtos.get(docCod);
        if (!a) {
            linhas.push({
                grupo: 'V1',
                docCod,
                esperado: 'adto no banco',
                observado: 'ausente de permuta_adiantamento',
                veredito: 'SEM_GROUND_TRUTH',
            });
            continue;
        }
        const det = await detalheDe(a);
        if (!det || det.valorPermutar === undefined || !a.taxa || a.taxa <= 0) {
            linhas.push({
                grupo: 'V1',
                docCod,
                esperado: 'detalhe + taxa',
                observado: `detalhe=${det ? 'ok' : 'falhou'} taxa=${a.taxa ?? '—'}`,
                veredito: 'SEM_GROUND_TRUTH',
            });
            continue;
        }
        const execsDoAdto = execucoes.filter((e) => e.adiantamentoDocCod === docCod);
        const consumosVivos: ConsumoExecucaoRow[] = execsDoAdto
            .filter((e) => {
                if (e.borCod === undefined) return false;
                const b = borderosVivos.get(`${e.filCod}:${e.borCod}`);
                return b !== undefined && b.fin === 1 && !b.estornado;
            })
            .map((e) => ({
                adiantamentoDocCod: e.adiantamentoDocCod,
                invoiceDocCod: e.invoiceDocCod,
                status: e.status,
                ...(e.valorResidualUsd !== undefined
                    ? { valorResidualUsd: e.valorResidualUsd }
                    : {}),
                criadoEm: e.criadoEm,
            }));
        const alocacoes = alocacoesPorAdto.get(docCod) ?? [];
        const saldoErpNeg = det.valorPermutar / a.taxa;
        const naoConsumido = saldo.somaNaoConsumida(alocacoes, consumosVivos);
        const nosso = saldoErpNeg - naoConsumido;
        const consumidoNosso = alocacoes.reduce((s, al) => s + al.valorAlocado, 0) - naoConsumido;
        const hoje = saldoErpNeg - alocacoes.reduce((s, al) => s + al.valorAlocado, 0);

        const situacoes = execsDoAdto
            .map((e) => {
                const b =
                    e.borCod !== undefined
                        ? borderosVivos.get(`${e.filCod}:${e.borCod}`)
                        : undefined;
                const c = e.borCod !== undefined ? cache.get(`${e.filCod}:${e.borCod}`) : undefined;
                const vivo = b
                    ? `fin=${b.fin ?? '?'}${b.estornado ? ',estornado' : ''}`
                    : 'ausente-ERP';
                const noCache = c ? `cache fin=${c.bor_vld_finalizado ?? '?'}` : 'fora-cache';
                return `bor ${e.borCod ?? '—'} ${e.status} [${vivo}; ${noCache}]`;
            })
            .join(' | ');

        if (esperadoCanonico[docCod] !== undefined) {
            const esperado = esperadoCanonico[docCod];
            const v = vereditoNumerico(nosso - esperado);
            linhas.push({
                grupo: 'V1-canônico',
                docCod,
                esperado: `saldo ${fmt(esperado)} (ERP/taxa ${fmt(saldoErpNeg)})`,
                observado: `nosso ${fmt(nosso)} (antes ${fmt(hoje)}) ${situacoes}`,
                veredito:
                    v === 'DIVERGENTE' &&
                    Math.abs(nosso - saldoErpNeg + naoConsumido) <= TOL &&
                    Math.abs(saldoErpNeg - esperado) > TOL
                        ? 'EXPLICADO'
                        : v,
                ...(Math.abs(saldoErpNeg - esperado) > TOL
                    ? { razao: `ERP mudou desde a entrevista (ERP/taxa ${fmt(saldoErpNeg)})` }
                    : {}),
            });
        }

        if (a.valorMoedaNegociada === undefined) {
            linhas.push({
                grupo: 'V1-classificação',
                docCod,
                esperado: 'consumidoErp = vmn − ERP/taxa',
                observado: `sem valor_moeda_negociada; nosso saldo ${fmt(nosso)} ${situacoes}`,
                veredito: 'SEM_GROUND_TRUTH',
            });
            continue;
        }
        const consumidoErp = a.valorMoedaNegociada - saldoErpNeg;
        const delta = consumidoErp - consumidoNosso;
        const base: Omit<Linha, 'veredito'> = {
            grupo: 'V1-classificação',
            docCod,
            esperado: `consumidoErp ${fmt(consumidoErp)}`,
            observado: `consumidoNosso ${fmt(consumidoNosso)} Δ=${fmt(delta)} saldo nosso ${fmt(nosso)} (antes ${fmt(hoje)}) ${situacoes}`,
        };
        if (Math.abs(delta) <= TOL) {
            linhas.push({ ...base, veredito: vereditoNumerico(delta) });
        } else if (delta > TOL) {
            // O ERP abateu MAIS do que as alocações que contamos como consumidas: permuta feita
            // fora da trilha atual (no ERP à mão, ou versão anterior re-alocada) — já refletida no
            // valorPermutar vivo, que é a base do nosso saldo. Sentido conservador.
            linhas.push({
                ...base,
                veredito: 'EXPLICADO',
                razao: 'ERP abateu além da trilha atual (conservador: já está no valorPermutar vivo)',
            });
        } else {
            // Sentido NÃO conservador: contamos como consumido algo que o ERP não abateu. Antes de
            // declarar P0, pergunta ao ERP (leitura) se a baixa do par EXISTE no borderô vivo — o ERP
            // reaproveita códigos de borderô excluído (I-Write-7), então a trilha pode apontar para
            // um borderô finalizado que hoje é de outro documento.
            const diagnosticos: string[] = [];
            let algumaBaixaDoParExiste = false;
            for (const c of consumosVivos) {
                const e = execsDoAdto.find(
                    (x) => x.invoiceDocCod === c.invoiceDocCod && x.criadoEm === c.criadoEm,
                );
                if (e?.borCod === undefined) continue;
                const [detBor, baixasBor] = await Promise.all([
                    baixa.getBordero({ filCod: e.filCod, borCod: e.borCod }),
                    baixa.listBaixas({ filCod: e.filCod, borCod: e.borCod }),
                ]);
                const docsNoBordero = [...new Set(baixasBor.map((b) => String(b.docCod)))];
                const temPar =
                    docsNoBordero.includes(e.invoiceDocCod) || docsNoBordero.includes(docCod);
                if (temPar) algumaBaixaDoParExiste = true;
                diagnosticos.push(
                    `bor ${e.borCod}/fil ${e.filCod}: execução ${e.criadoEm.toISOString()} inv ${e.invoiceDocCod}; ` +
                        `ERP cad=${detBor?.usnDesNomeCad ?? '?'} mvto=${detBor?.borDtaMvto ? new Date(detBor.borDtaMvto).toISOString().slice(0, 10) : '?'} ` +
                        `docs no borderô=[${docsNoBordero.slice(0, 8).join(',')}${docsNoBordero.length > 8 ? ',…' : ''}] contémPar=${temPar}`,
                );
            }
            linhas.push({
                ...base,
                observado: `${base.observado} · diag: ${diagnosticos.join(' || ')}`,
                veredito: algumaBaixaDoParExiste ? 'DIVERGENTE' : 'EXPLICADO',
                razao: algumaBaixaDoParExiste
                    ? 'baixa do par EXISTE em borderô finalizado e o ERP não abateu (sentido não conservador)'
                    : 'o borderô vivo NÃO contém a baixa do par (código reaproveitado ou baixa excluída no ERP): o ERP não abateu porque não há baixa; nosso saldo = saldo do ERP. Trilha inconsistente → follow-up',
            });
        }
    }

    // ───────────────────────── V2 — motivo e tolerância (D1 + D2) ─────────────────────────
    const avaliar = async (a: AdtoDb) => {
        const det = await detalheDe(a);
        if (!det) return undefined;
        const declaracoes = declaracoesPorProcesso.get(`${a.filCod}:${a.priCod}`) ?? [];
        const adiantamento: Adiantamento = {
            docCod: a.docCod,
            priCod: a.priCod,
            filCod: a.filCod,
            dataEmissao: new Date(0),
            valor: 0,
            moeda: 'BRL',
            ...(det.valorPermutar !== undefined ? { valorPermutar: det.valorPermutar } : {}),
            ...(det.valorPermutado !== undefined ? { valorPermutado: det.valorPermutado } : {}),
            ...(det.valorAberto !== undefined ? { valorAberto: det.valorAberto } : {}),
            pago: ToleranciaResiduo.adiantamentoTotalmentePago(det),
        };
        const r = elegibilidade.avaliarElegibilidade({ adiantamento, declaracoes, invoices: [] });
        const ehFiltro = a.pesCod !== undefined && filtroPesCods.has(a.pesCod);
        const roteia =
            ehFiltro &&
            r.estadoElegibilidade === ESTADO_ELEGIBILIDADE.BLOQUEADA &&
            adiantamento.pago &&
            !ToleranciaResiduo.semSaldoPermutar(adiantamento.valorPermutar);
        return {
            det,
            declaracoes: declaracoes.length,
            estado: roteia ? ESTADO_ELEGIBILIDADE.PERMUTA_MANUAL : r.estadoElegibilidade,
            motivo: roteia ? MOTIVO_BLOQUEIO.CLIENTE_FILTRO : r.motivoBloqueio,
            pago: adiantamento.pago,
        };
    };
    const descr = (o: Awaited<ReturnType<typeof avaliar>>): string =>
        o === undefined
            ? 'detalhe indisponível'
            : `${o.estado}/${o.motivo ?? '—'} (permutar R$${fmt(o.det.valorPermutar)} aberto R$${fmt(o.det.valorAberto)} permutado R$${fmt(o.det.valorPermutado)} decl=${o.declaracoes})`;

    const grupoV2 = async (
        grupo: string,
        lista: AdtoDb[],
        esperado: string,
        confere: (o: NonNullable<Awaited<ReturnType<typeof avaliar>>>) => boolean,
        explicacao?: (o: NonNullable<Awaited<ReturnType<typeof avaliar>>>) => string | undefined,
    ): Promise<void> => {
        await carregarDeclaracoes(lista);
        for (const a of lista) {
            const o = await avaliar(a);
            if (o === undefined) {
                linhas.push({
                    grupo,
                    docCod: a.docCod,
                    esperado,
                    observado: 'detalhe indisponível',
                    veredito: 'SEM_GROUND_TRUTH',
                });
                continue;
            }
            if (confere(o)) {
                linhas.push({
                    grupo,
                    docCod: a.docCod,
                    esperado,
                    observado: descr(o),
                    veredito: 'EXATO',
                });
                continue;
            }
            const razao = explicacao?.(o);
            linhas.push({
                grupo,
                docCod: a.docCod,
                esperado,
                observado: descr(o),
                veredito: razao !== undefined ? 'EXPLICADO' : 'DIVERGENTE',
                ...(razao !== undefined ? { razao } : {}),
            });
        }
    };
    const pick = (docs: string[]): AdtoDb[] =>
        docs.map((d) => adtos.get(d)).filter((a): a is AdtoDb => a !== undefined);
    const faltando = (docs: string[], grupo: string): void => {
        for (const d of docs) {
            if (!adtos.has(d)) {
                linhas.push({
                    grupo,
                    docCod: d,
                    esperado: 'adto no banco',
                    observado: 'ausente de permuta_adiantamento',
                    veredito: 'SEM_GROUND_TRUTH',
                });
            }
        }
    };
    const valorVivoMudou = (
        o: NonNullable<Awaited<ReturnType<typeof avaliar>>>,
    ): string | undefined =>
        !ToleranciaResiduo.semSaldoPermutar(o.det.valorPermutar) ||
        !ToleranciaResiduo.adiantamentoTotalmentePago(o.det)
            ? 'valor vivo mudou desde a entrevista (regra avaliada sobre o vivo)'
            : undefined;

    // 43 executados pelo painel hoje em data-base-indisponivel.
    const executadosSemDi = [...adtos.values()].filter(
        (a) =>
            a.motivo === MOTIVO_BLOQUEIO.DATA_BASE_INDISPONIVEL &&
            execucoes.some((e) => e.adiantamentoDocCod === a.docCod && e.status === 'settled'),
    );
    await grupoV2(
        'V2-executados-sem-DI',
        executadosSemDi,
        'ja-permutado/ja-permutado',
        (o) => o.estado === ESTADO_ELEGIBILIDADE.JA_PERMUTADO,
        (o) =>
            !o.pago
                ? undefined
                : !ToleranciaResiduo.semSaldoPermutar(o.det.valorPermutar)
                  ? 'ainda há saldo > R$1 no ERP (execução parcial do saldo): sai de sem-D.I pela regra'
                  : (o.det.valorPermutado ?? 0) <= 0
                    ? 'ERP sem valorPermutado: sem-saldo-permutar'
                    : undefined,
    );

    // 28 resíduos INOX (lista da entrevista + query: permuta-manual com saldo ≤ R$1 no banco).
    const residuosQuery = [...adtos.values()]
        .filter(
            (a) =>
                a.estado === 'permuta-manual' &&
                a.valorPermutarDb !== undefined &&
                ToleranciaResiduo.semSaldoPermutar(a.valorPermutarDb),
        )
        .map((a) => a.docCod);
    const residuos = [...new Set([...DOCS_RESIDUO_INOX, ...residuosQuery])];
    faltando(residuos, 'V2-residuo-INOX');
    await grupoV2(
        'V2-residuo-INOX',
        pick(residuos),
        'ja-permutado (não roteado)',
        (o) => o.estado === ESTADO_ELEGIBILIDADE.JA_PERMUTADO,
        valorVivoMudou,
    );

    faltando([DOC_8721], 'V2-8721');
    await grupoV2(
        'V2-8721',
        pick([DOC_8721]),
        'pago=true, motivo ≠ nao-pago',
        (o) => o.pago && o.motivo !== MOTIVO_BLOQUEIO.NAO_PAGO,
        valorVivoMudou,
    );

    faltando(DOCS_NAO_PAGO_REAL, 'V2-residuo-real');
    await grupoV2(
        'V2-residuo-real',
        pick(DOCS_NAO_PAGO_REAL),
        'bloqueada/nao-pago',
        (o) => o.motivo === MOTIVO_BLOQUEIO.NAO_PAGO && !o.pago,
        (o) =>
            ToleranciaResiduo.adiantamentoTotalmentePago(o.det)
                ? 'resíduo saneado no ERP (em aberto vivo ≤ R$1)'
                : undefined,
    );

    const naoPagosSemDi = [...adtos.values()]
        .filter((a) => a.motivo === MOTIVO_BLOQUEIO.DATA_BASE_INDISPONIVEL && !a.pagoDb)
        .slice(0, 15);
    await grupoV2(
        'V2-nao-pago-sem-DI',
        naoPagosSemDi,
        'bloqueada/nao-pago',
        (o) => o.motivo === MOTIVO_BLOQUEIO.NAO_PAGO,
        (o) =>
            ToleranciaResiduo.adiantamentoTotalmentePago(o.det)
                ? 'pago no ERP desde a ingestão (ou resíduo ≤ R$1): regra avaliada sobre o vivo'
                : undefined,
    );

    const pagosComSaldoSemDi = [...adtos.values()].filter(
        (a) =>
            a.pagoDb &&
            a.valorPermutarDb !== undefined &&
            !ToleranciaResiduo.semSaldoPermutar(a.valorPermutarDb) &&
            (a.motivo === MOTIVO_BLOQUEIO.DATA_BASE_INDISPONIVEL || a.estado === 'permuta-manual'),
    );
    const amostraFiltro = pagosComSaldoSemDi
        .filter((a) => a.pesCod !== undefined && filtroPesCods.has(a.pesCod))
        .slice(0, 5);
    const amostraNaoFiltro = pagosComSaldoSemDi
        .filter((a) => !(a.pesCod !== undefined && filtroPesCods.has(a.pesCod)))
        .slice(0, 5);
    await grupoV2(
        'V2-pago-saldo-sem-DI (filtro)',
        amostraFiltro,
        'permuta-manual/cliente-filtro (se sem D.I)',
        (o) =>
            o.declaracoes === 0
                ? o.estado === ESTADO_ELEGIBILIDADE.PERMUTA_MANUAL
                : o.estado !== ESTADO_ELEGIBILIDADE.JA_PERMUTADO,
        valorVivoMudou,
    );
    await grupoV2(
        'V2-pago-saldo-sem-DI (não filtro)',
        amostraNaoFiltro,
        'bloqueada/data-base-indisponivel',
        (o) => o.motivo === MOTIVO_BLOQUEIO.DATA_BASE_INDISPONIVEL,
        (o) =>
            o.declaracoes > 0 ? 'D.I/DUIMP apareceu no ERP desde a ingestão' : valorVivoMudou(o),
    );

    linhas.push({
        grupo: 'V3-fronteira',
        docCod: '—',
        esperado: 'R$1,00 ⇒ sem saldo/pago; R$1,01 ⇒ com saldo/não pago',
        observado: 'sem documento real na fronteira; coberto por ToleranciaResiduo.test.ts',
        veredito: 'SEM_GROUND_TRUTH',
    });

    // ───────────────────────── Guarda de frescor (informativo) ─────────────────────────
    let foraDaJanela = 0;
    for (const e of execucoes) {
        if (e.borCod === undefined) continue;
        const c = cache.get(`${e.filCod}:${e.borCod}`);
        const started = ingestaoPorAdto.get(e.adiantamentoDocCod);
        if (
            c &&
            started &&
            Number(c.bor_vld_finalizado) === 1 &&
            new Date(String(c.atualizado_em)) >= started
        ) {
            foraDaJanela++;
        }
    }

    // ───────────────────────── Relatório ─────────────────────────
    console.log('\n=== GROUND TRUTH — permutas-saldo-ordem-centavos v1 (ADR-0046) ===');
    console.log(
        `BASE ${BASE} · execuções reais terminais=${execucoes.length} · adtos V1=${adtosComExecucao.size}`,
    );
    console.log(
        `guarda de frescor: ${foraDaJanela} execução(ões) com borderô finalizado no cache DEPOIS do start da última ingestão do adto (contam como NÃO consumidas no snapshot até a próxima ingestão)`,
    );
    const grupos = [...new Set(linhas.map((l) => l.grupo))];
    for (const g of grupos) {
        const doGrupo = linhas.filter((l) => l.grupo === g);
        const cont = (v: Veredito) => doGrupo.filter((l) => l.veredito === v).length;
        console.log(
            `\n## ${g}: n=${doGrupo.length} EXATO=${cont('EXATO')} OK_CENTAVO=${cont('OK_CENTAVO')} EXPLICADO=${cont('EXPLICADO')} DIVERGENTE=${cont('DIVERGENTE')} SEM_GT=${cont('SEM_GROUND_TRUTH')}`,
        );
        for (const l of doGrupo) {
            if (
                l.veredito === 'EXATO' &&
                g === 'V1-classificação' &&
                !DOCS_V1_CANONICOS.includes(l.docCod)
            ) {
                continue;
            }
            console.log(
                `  [${l.veredito}] ${l.docCod}: esperado ${l.esperado} · observado ${l.observado}${l.razao ? ` · razão: ${l.razao}` : ''}`,
            );
        }
    }
    const divergentes = linhas.filter((l) => l.veredito === 'DIVERGENTE');
    console.log(`\nTOTAL linhas=${linhas.length} DIVERGENTE=${divergentes.length}`);
    if (divergentes.length > 0) {
        console.error('\nDIVERGENTE — gate P0 até explicar cada linha acima.');
        process.exit(1);
    }
    console.log('\nCONFORME — nenhuma divergência não explicada contra o ground truth do Conexos.');
};

main()
    .then(() => process.exit(0))
    .catch((e) => {
        console.error('FALHOU:', e instanceof Error ? e.message : String(e));
        process.exit(1);
    });
