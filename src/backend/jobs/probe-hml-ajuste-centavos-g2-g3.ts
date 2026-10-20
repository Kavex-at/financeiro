import 'reflect-metadata';
import 'dotenv/config';
import './hmlEnvFile.js';
import { mkdirSync, writeFileSync } from 'node:fs';
import { container } from 'tsyringe';
import { bootstrapAppContainer } from '../domain/appContainer.js';
import ConexosBaseClient from '../domain/client/ConexosBaseClient.js';
import ConexosRenegociacaoClient from '../domain/client/ConexosRenegociacaoClient.js';
import ConexosSessionRegistry from '../domain/client/ConexosSessionRegistry.js';
import ConexosSispagClient from '../domain/client/ConexosSispagClient.js';
import ConexosSispagWriteClient from '../domain/client/ConexosSispagWriteClient.js';
import type PostgreeDatabaseClient from '../domain/client/database/PostgreeDatabaseClient.js';
import type {
    AjusteCentavosExecucao,
    RechaveamentoInput,
} from '../domain/interface/sispag/AjusteCentavos.js';
import type { SessaoConexos } from '../domain/interface/sispag/RenegociacaoInterface.js';
import CodigoBarrasBoleto from '../domain/libs/boleto/CodigoBarrasBoleto.js';
import CodigoBarrasSintetico from '../domain/libs/boleto/CodigoBarrasSintetico.js';
import ElegibilidadeAjusteCentavos from '../domain/libs/boleto/ElegibilidadeAjusteCentavos.js';
import EtapaAjusteCentavos, {
    type EtapaAjuste,
} from '../domain/libs/boleto/EtapaAjusteCentavos.js';
import BankingCalendar from '../domain/libs/calendar/BankingCalendar.js';
import RemessaCnabValidator from '../domain/libs/cnab/RemessaCnabValidator.js';
import type EnvironmentProvider from '../domain/libs/environment/EnvironmentProvider.js';
import ServerProcessMarker from '../domain/libs/runtime/ServerProcessMarker.js';
import type AjusteCentavosExecucaoRepository from '../domain/repository/sispag/AjusteCentavosExecucaoRepository.js';
import type BoletoDdaRepository from '../domain/repository/sispag/BoletoDdaRepository.js';
import type LotePagamentoRepository from '../domain/repository/sispag/LotePagamentoRepository.js';
import type SugestaoBoletoRepository from '../domain/repository/sispag/SugestaoBoletoRepository.js';
import type TituloAPagarRepository from '../domain/repository/sispag/TituloAPagarRepository.js';
import type LogService from '../domain/service/LogService.js';
import type NotificacaoService from '../domain/service/operacao/NotificacaoService.js';
import AjusteCentavosTituloService from '../domain/service/sispag/AjusteCentavosTituloService.js';

/**
 * HML (ESCREVE) — portões G2 e G3 do ajuste de centavos (ADR-0073, Task 15). Autorizado pelo
 * maintainer em 2026-10-19. Fases (`FASE`), uma sessão por execução, sequenciais:
 *
 *   descobrir  (padrão, só leitura) títulos frescos nos pendentes do SISPAG (filial/banco) + fin064
 *   g3         título `DOC` (doc/tit): renegociação com composição no vencimento ORIGINAL (passado,
 *              G2-passado), NÃO finaliza; prova a rota de cancelamento (`PUT fin070/cancelar`,
 *              senão `DELETE`), relê, confere o título intacto. Depois: `POST fin070` com resposta
 *              DESCARTADA, retomada pelo marcador da obs (`buscarRenegociacaoPorMarcador`) e cancela.
 *   preparar   título `DOC`: renegociação `frnVldTpop 0` com composição vencendo HOJE (BRT,
 *              G2-hoje), finaliza, libera no fin103 o bloqueio da regra (APROVAR) — gera um título
 *              fresco a vencer hoje para o ponta a ponta.
 *   e2e        título `DOC` (a vencer hoje) + `DELTA` (centavos, ±): roda o AjusteCentavosTituloService
 *              DE PRODUÇÃO (client fin070 real, sessão real) com repositórios em memória; depois
 *              vincula um boleto sintético de valor = líquido novo, finaliza o lote, gera o `.REM`,
 *              decodifica o J e passa o RemessaCnabValidator (guarda I17m).
 *
 * Travas: só HML (`-hml`), credenciais de `HML_ENV_FILE`, `databaseConnectionString=""`, barras
 * só SINTÉTICAS (máscara 5+4 na saída), nunca toca as renegociações 3 e 4 nem títulos já usados.
 *
 *   cd src/backend
 *   HML_ENV_FILE=/home/inteli/.claude-tech/hml-conexos.env \
 *   CONEXOS_BASE_URL=https://columbiatrading-hml.conexos.cloud/api CONEXOS_WRITE_ENABLED=true \
 *   databaseConnectionString="" FASE=descobrir npx tsx jobs/probe-hml-ajuste-centavos-g2-g3.ts
 */
const BASE = process.env.CONEXOS_BASE_URL ?? '';
if (!/^https:\/\/[a-z0-9-]+-hml\.conexos\.cloud\//.test(BASE) || !process.env.HML_ENV_FILE) {
    console.error(`RECUSADO: só HML, com HML_ENV_FILE. Base atual: ${BASE}`);
    process.exit(1);
}
if (process.env.databaseConnectionString !== '') {
    console.error('RECUSADO: rode com databaseConnectionString="".');
    process.exit(1);
}
const FASE = process.env.FASE ?? 'descobrir';
const FIL = Number(process.env.FIL ?? 2);
const BNC = Number(process.env.BNC ?? 4);
const DOC = process.env.DOC ?? '';
const DELTA = Number(process.env.DELTA ?? 1);
const SEQ = Number(process.env.SEQ ?? 80);
const OUT = process.env.PROBE_OUT ?? '/tmp/hml-centavos-g2g3';
/** Títulos/documentos já consumidos em HML (14/10 e 19/10) — nunca reutilizar. */
const JA_USADOS = new Set([
    '536',
    '540',
    '753',
    '748',
    '607',
    '15',
    '640',
    '642',
    '637',
    ...(process.env.JA_USADOS ?? '').split(',').filter(Boolean),
]);
/** Renegociações de 19/10 que não se tocam (P1-5). */
const INTOCAVEIS = new Set([3, 4]);
const MODALIDADE = 6;
type Row = Record<string, unknown>;

const log = (s: string): void => console.log(`[hml-g2g3] ${s}`);
const sanea = (v: unknown): string => JSON.stringify(v ?? null).replace(/\d{20,}/g, '…');
const mask = (s: unknown): string => {
    const t = String(s ?? '').replace(/\D/g, '');
    return t.length >= 44 ? `${t.slice(0, 5)}…${t.slice(-4)}` : t === '' ? '' : '(curto)';
};
const erro = (e: unknown): Row => {
    const err = e as {
        name?: string;
        message?: string;
        code?: string;
        response?: { status?: unknown; data?: unknown };
        cause?: { response?: { status?: unknown; data?: unknown } };
    };
    const resp = err.response ?? err.cause?.response;
    return {
        nome: err.name,
        code: err.code,
        chaveErp: ConexosRenegociacaoClient.codigoErp(err.cause ?? e),
        message: String(err.message ?? e).slice(0, 300),
        status: resp?.status,
        data: JSON.parse(sanea(resp?.data ?? null)),
    };
};
const tenta = async <T>(
    fn: () => Promise<T>,
): Promise<{ ok: true; v: T } | { ok: false; e: Row }> => {
    try {
        return { ok: true, v: await fn() };
    } catch (e) {
        return { ok: false, e: erro(e) };
    }
};
const salvar = (nome: string, dados: unknown): void => {
    writeFileSync(`${OUT}/${nome}-${Date.now()}.json`, JSON.stringify(dados, null, 2));
};
const civil = (v: unknown): string =>
    typeof v === 'number' ? new Date(v).toISOString().slice(0, 10) : String(v);
const resumoTitulo = (t: Row | undefined): Row | string =>
    t === undefined
        ? 'ausente'
        : {
              titCod: t.titCod,
              docTip: t.docTip,
              pesCodFor: t.pesCodFor,
              titEspNumero: t.titEspNumero,
              docEspNumero: t.docEspNumero,
              titMnyValor: t.titMnyValor,
              titMnyJuros: t.titMnyJuros,
              titMnyDesconto: t.titMnyDesconto,
              totalLiquido: t.totalLiquido,
              totalPago: t.totalPago,
              totalAberto: t.totalAberto,
              vldLib: t.vldLib,
              vldPago: t.vldPago,
              venc: civil(t.titDtaVencimento),
              emItemSispag: ConexosRenegociacaoClient.emItemSispag(t),
          };

/** Segmento J (≠ J-52) do CNAB 240 Itaú: o que o banco recebe. */
const decodificarJ = (conteudo: string): Row[] =>
    conteudo
        .split(/\r?\n/)
        .filter((l) => l.length >= 167 && l[7] === '3' && l[13] === 'J' && l.slice(17, 19) !== '52')
        .map((l) => {
            const dd = (s: string): string => `${s.slice(4, 8)}-${s.slice(2, 4)}-${s.slice(0, 2)}`;
            const n = (s: string): number => Number(s) / 100;
            return {
                codigoBarras: mask(l.slice(17, 61)),
                valorNaBarra: n(l.slice(26, 36)),
                vencimento: dd(l.slice(91, 99)),
                valorTitulo: n(l.slice(99, 114)),
                descontoAbatimento: n(l.slice(114, 129)),
                moraMulta: n(l.slice(129, 144)),
                dataPagamento: dd(l.slice(144, 152)),
                valorPagamento: n(l.slice(152, 167)),
            };
        });

/** Ledger em memória com a semântica do repositório (máquina de etapas + lock otimista). */
const ledgerEmMemoria = () => {
    const linhas = new Map<string, AjusteCentavosExecucao>();
    const rechaveamentos: RechaveamentoInput[] = [];
    let seq = 0;
    const copia = (l: AjusteCentavosExecucao | undefined) => (l ? { ...l } : null);
    return {
        linhas,
        rechaveamentos,
        abrir: async (i: Row) => {
            seq += 1;
            const id = `hml-exec-${seq}`;
            const nova = {
                ...i,
                id,
                marcador: `AJC-HML-${Date.now().toString(36).toUpperCase()}`,
                etapa: 'pendente',
                tentativas: 1,
                criadoEm: new Date().toISOString(),
                atualizadoEm: new Date().toISOString(),
            } as unknown as AjusteCentavosExecucao;
            linhas.set(id, nova);
            return { criado: true, execucao: { ...nova } };
        },
        registrarIntencao: async (id: string, intencao: string) => {
            const l = linhas.get(id);
            if (l) l.intencao = intencao;
        },
        registrarTentativa: async () => undefined,
        registrarResultado: async (
            id: string,
            de: EtapaAjuste,
            para: EtapaAjuste,
            campos: Row = {},
        ) => {
            EtapaAjusteCentavos.transicionar(de, para);
            const l = linhas.get(id);
            if (!l || l.etapa !== de) return false;
            Object.assign(l, { etapa: para, intencao: undefined });
            for (const [k, v] of Object.entries(campos)) {
                if (v !== undefined) (l as unknown as Row)[k] = v;
            }
            log(`   ledger: ${de} → ${para} ${sanea(campos)}`);
            return true;
        },
        buscarPorId: async (id: string) => copia(linhas.get(id)),
        listarNaoTerminais: async () =>
            [...linhas.values()].filter((l) => !EtapaAjusteCentavos.ehTerminal(l.etapa)),
        buscarNaoTerminalPorOrigem: async (k: { docCod: string; titCod: string }) =>
            copia(
                [...linhas.values()].find(
                    (x) =>
                        x.docCod === k.docCod &&
                        x.titCodOrigem === k.titCod &&
                        !EtapaAjusteCentavos.ehTerminal(x.etapa),
                ),
            ),
        buscarConcluidoPorTitCodNovo: async () => null,
        ultimoPorTitulo: async () => null,
        listarUltimosDaFilial: async () => [...linhas.values()],
        rechavear: async (input: RechaveamentoInput) => {
            rechaveamentos.push(input);
            const l = linhas.get(input.execucaoId);
            if (l) {
                EtapaAjusteCentavos.transicionar(l.etapa, 'rechaveada');
                Object.assign(l, {
                    etapa: 'rechaveada',
                    titCodNovo: input.titCodNovo,
                    ...(input.motivo ? { motivo: input.motivo } : {}),
                });
            }
            return { decisaoTransferida: true, novaDecisaoId: 'hml-dec-2', lotesTocados: [] };
        },
    };
};

async function main(): Promise<void> {
    mkdirSync(OUT, { recursive: true });
    await bootstrapAppContainer();
    const base = container.resolve(ConexosBaseClient);
    const reneg = container.resolve(ConexosRenegociacaoClient);
    const registry = container.resolve(ConexosSessionRegistry);
    const write = container.resolve(ConexosSispagWriteClient);
    const sispag = container.resolve(ConexosSispagClient);
    const calendar = container.resolve(BankingCalendar);
    const conv = new CodigoBarrasBoleto();
    const sessao: SessaoConexos = registry.robot();
    await base.ensureSid();
    const hoje = calendar.todayBrt();
    const hojeEpoch = calendar.toErpEpoch(hoje);
    log(`BASE ${BASE} (HML) · fil=${FIL} bnc=${BNC} · fase ${FASE} · hoje BRT ${hoje}`);

    const [docCod, titCod] = DOC.split('/');
    const doDoc = async (doc: string): Promise<Row[]> =>
        (await reneg.listarTitulosDoDocumento(sessao, { filCod: FIL, docCod: doc })).map(
            (t) => t.raw,
        );
    const tituloAtual = async (): Promise<Row | undefined> =>
        (await doDoc(docCod ?? '')).find((t) => String(t.titCod ?? '1') === titCod);
    const cabecalho = async (frnCod: number): Promise<Row | Row[]> => {
        const r = await tenta(() => base.getGeneric<Row>(`fin070/${frnCod}`, { filCod: FIL }));
        if (!r.ok) return r.e;
        const c = r.v;
        return {
            frnCod: c.frnCod,
            frnVldFin: c.frnVldFin,
            frnVldCan: c.frnVldCan,
            frnVldTpop: c.frnVldTpop,
            frnMnyValor: c.frnMnyValor,
            frnEspObs: c.frnEspObs,
        };
    };
    const exigeDoc = (): void => {
        if (!docCod || !titCod || JA_USADOS.has(docCod)) {
            throw new Error(`DOC inválido ou já usado: ${DOC}`);
        }
    };

    /** Gera o `.REM` do lote finalizado, decodifica o J e passa a guarda I17m de produção. */
    const gerarEValidarRemessa = async (flpCod: number): Promise<Row> => {
        const res: Row = {};
        const agora = new Date();
        const nome = `PG${String(agora.getUTCDate()).padStart(2, '0')}${String(agora.getUTCMonth() + 1).padStart(2, '0')}${String(SEQ).padStart(2, '0')}.REM`;
        res.gerar = await tenta(() =>
            write.gerarRemessa({
                filCod: FIL,
                bncCod: BNC,
                flpCod,
                grbCodSeq: 1,
                seqNum: SEQ,
                gabEspNomeArquivo: nome,
            }),
        );
        const arqs = await write.listarArquivosRemessa({ filCod: FIL, bncCod: BNC, flpCod });
        const arq = arqs.find((x) => x.nomeArquivo === nome) ?? arqs.find((x) => x.conteudo);
        res.remessa = arq?.nomeArquivo;
        if (arq?.conteudo) {
            res.segmentosJ = decodificarJ(arq.conteudo);
            const val = new RemessaCnabValidator().validar(arq.conteudo);
            res.guardaI17m = {
                passa: val.divergenciasValor.length === 0,
                divergencias: val.divergenciasValor,
                segmentosJ: val.segmentosJ,
                invalidos: val.invalidos.length,
            };
        }
        log(
            `.REM ${String(res.remessa)}: J ${sanea(res.segmentosJ)} · I17m ${sanea(res.guardaI17m)} · gerar ${sanea(res.gerar)}`,
        );
        return res;
    };

    if (FASE === 'remessa') {
        // Só o `.REM` de um lote de teste já FINALIZADO (`FLP`) — ex.: número de remessa recusado.
        const flpCod = Number(process.env.FLP ?? 0);
        if (!flpCod) throw new Error('Informe FLP');
        salvar('remessa', { flpCod, ...(await gerarEValidarRemessa(flpCod)) });
        return;
    }

    if (FASE === 'descobrir') {
        const lotes = await write.listarLotesNativos({ filCod: FIL, bncCod: BNC });
        const ctx = lotes.find((l) => l.status === 0) ?? lotes[lotes.length - 1];
        if (!ctx) return log('nenhum lote nativo de contexto.');
        const pend = await write.listarTitulosPendentes({
            filCod: FIL,
            bncCod: BNC,
            flpCod: ctx.flpCod,
        });
        const cands = pend
            .filter((p) => !p.temBoletoDda && !JA_USADOS.has(String(p.docCod)))
            .map((p) => ({ p, valor: Number(p.raw.titMnyValor ?? 0) }))
            .filter((x) => x.valor >= 1 && x.valor <= 5000)
            .slice(0, 25);
        log(`pendentes ${pend.length} · candidatos ${cands.length}`);
        const saida: Row[] = [];
        for (const x of cands) {
            const linhas = await doDoc(String(x.p.docCod));
            const t = linhas.find((l) => String(l.titCod) === String(x.p.titCod));
            const r = {
                doc: `${x.p.docCod}/${x.p.titCod}`,
                titulosNoDoc: linhas.length,
                fin064: resumoTitulo(t),
            };
            saida.push(r);
            log(`   ${sanea(r)}`);
        }
        const regs = await tenta(() =>
            reneg.buscarRenegociacaoPorMarcador(sessao, { filCod: FIL, marcador: 'KAVEX' }),
        );
        log(`renegociações com "KAVEX" na obs: ${sanea(regs)}`);
        salvar('descobrir', saida);
        return;
    }

    if (FASE === 'g3') {
        exigeDoc();
        const res: Row = { doc: DOC };
        const antes = await tituloAtual();
        if (!antes) throw new Error('título não encontrado no fin064');
        res.antes = resumoTitulo(antes);
        log(`antes: ${sanea(res.antes)}`);
        const marcador = `G3HML${Date.now().toString(36).toUpperCase()}`;
        const pesCod = Number(antes.pesCodFor ?? antes.pesCod);
        const criado = await tenta(() =>
            reneg.criarRenegociacao(sessao, {
                filCod: FIL,
                pesCod,
                dataRenegEpoch: hojeEpoch,
                obs: `TESTE HML KAVEX G3 ${marcador} (NAO USAR)`,
            }),
        );
        res.criar = criado;
        log(`criar: ${sanea(criado)}`);
        if (!criado.ok) return salvar('g3', res);
        const frnCod = criado.v.frnCod;
        if (INTOCAVEIS.has(frnCod)) throw new Error('frnCod intocável');
        const ident = {
            filCod: FIL,
            frnCod,
            docTip: Number(antes.docTip),
            docCod: docCod as string,
            titCod: titCod as string,
        };
        res.incluir = await tenta(() => reneg.incluirTitulo(sessao, ident));
        log(`incluir: ${sanea(res.incluir)}`);
        const liquido =
            Number(antes.totalLiquido ?? antes.titMnyValor) - Number(antes.totalPago ?? 0);
        const vencOriginal = Number(antes.titDtaVencimento);
        res.g2Passado = {
            vencimento: civil(vencOriginal),
            valor: liquido,
            resultado: await tenta(() =>
                reneg.gravarComposicao(sessao, {
                    ...ident,
                    valor: liquido,
                    vencimentoEpoch: vencOriginal,
                    ...(antes.titEspNumero ? { frgEspNumero: String(antes.titEspNumero) } : {}),
                    ...(antes.pgtCod != null ? { pgtCod: Number(antes.pgtCod) } : {}),
                    ...(antes.dupEspOrdem ? { dupEspOrdem: String(antes.dupEspOrdem) } : {}),
                }),
            ),
        };
        log(`G2 composição vencimento PASSADO ${civil(vencOriginal)}: ${sanea(res.g2Passado)}`);
        res.lidaAntesDoCancelar = await tenta(() =>
            reneg.lerRenegociacao(sessao, { filCod: FIL, frnCod }),
        );
        res.cabecalhoAntes = await cabecalho(frnCod);
        log(`renegociação ${frnCod} antes do cancelar: ${sanea(res.lidaAntesDoCancelar)}`);

        // ── G3: rota de cancelamento ───────────────────────────────────────
        const rotas: Row[] = [];
        const put = await tenta(() =>
            base.putGenericOnce<Row>(`fin070/cancelar/${frnCod}`, {}, { filCod: FIL }),
        );
        const depoisPut = await cabecalho(frnCod);
        rotas.push({
            rota: `PUT fin070/cancelar/${frnCod}`,
            resultado: put,
            cabecalhoDepois: depoisPut,
        });
        log(`PUT fin070/cancelar/${frnCod}: ${sanea(put)} · cabeçalho ${sanea(depoisPut)}`);
        const canceladoPeloPut =
            put.ok && !Array.isArray(depoisPut) && (depoisPut as Row).frnVldCan === 1;
        if (!canceladoPeloPut) {
            const del = await tenta(() =>
                base.deleteGeneric<unknown>(`fin070/${frnCod}`, { filCod: FIL }),
            );
            const depoisDel = await cabecalho(frnCod);
            rotas.push({
                rota: `DELETE fin070/${frnCod}`,
                resultado: del,
                cabecalhoDepois: depoisDel,
            });
            log(`DELETE fin070/${frnCod}: ${sanea(del)} · cabeçalho ${sanea(depoisDel)}`);
        }
        res.rotas = rotas;
        res.lidaDepois = await tenta(() => reneg.lerRenegociacao(sessao, { filCod: FIL, frnCod }));
        const depois = await tituloAtual();
        res.depois = resumoTitulo(depois);
        res.tituloIntacto =
            depois !== undefined &&
            depois.totalAberto === antes.totalAberto &&
            depois.vldLib === antes.vldLib &&
            depois.titMnyValor === antes.titMnyValor;
        res.documentoDepois = (await doDoc(docCod as string)).map(resumoTitulo);
        log(`depois: ${sanea(res.depois)} · intacto=${String(res.tituloIntacto)}`);

        // ── I18i: POST fin070 com resposta descartada, reconhecida pelo marcador ─────
        const marcador2 = `G3MRK${Date.now().toString(36).toUpperCase()}`;
        await tenta(async () => {
            await reneg.criarRenegociacao(sessao, {
                filCod: FIL,
                pesCod,
                dataRenegEpoch: hojeEpoch,
                obs: `TESTE HML KAVEX MARCADOR ${marcador2} (NAO USAR)`,
            });
            return 'resposta descartada de propósito';
        });
        const achadas = await tenta(() =>
            reneg.buscarRenegociacaoPorMarcador(sessao, { filCod: FIL, marcador: marcador2 }),
        );
        res.marcador = { marcador: marcador2, achadas };
        log(`retomada pelo marcador ${marcador2}: ${sanea(achadas)}`);
        if (achadas.ok && achadas.v.length === 1) {
            const frn2 = achadas.v[0] as number;
            if (INTOCAVEIS.has(frn2)) throw new Error('frnCod intocável');
            const c2 = await tenta(() =>
                reneg.cancelarRenegociacao(sessao, { filCod: FIL, frnCod: frn2 }),
            );
            const lido2 = await tenta(() =>
                reneg.lerRenegociacao(sessao, { filCod: FIL, frnCod: frn2 }),
            );
            res.marcadorCancelamento = {
                frnCod: frn2,
                cancelar: c2,
                lido: lido2,
                cabecalho: await cabecalho(frn2),
            };
            log(`cancelar a renegociação do marcador ${frn2}: ${sanea(res.marcadorCancelamento)}`);
        }
        salvar('g3', res);
        return;
    }

    if (FASE === 'desfazer') {
        // G3, 2ª rodada: o `PUT fin070/cancelar` exige renegociação FINALIZADA e o `DELETE fin070`
        // recusa enquanto houver título. Desfaz de baixo para cima: (título direto; se recusar,
        // composição antes) → cabeçalho. `FRN` = frnCod NÃO finalizado criado por este probe.
        const frnCod = Number(process.env.FRN ?? 0);
        if (!frnCod || INTOCAVEIS.has(frnCod)) throw new Error('FRN inválido ou intocável');
        const res: Row = { frnCod, cabecalhoAntes: await cabecalho(frnCod) };
        const passos: Row[] = [];
        const titulosDaReneg = await base.listGenericPaginated<Row>(
            `fin070/titulos/list/${frnCod}`,
            { fieldList: [], filterList: {}, pageNumber: 1, pageSize: 50, serviceName: 'fin070' },
            { filCod: FIL },
        );
        const antesDoc: Record<string, Row | string> = {};
        for (const t of titulosDaReneg.rows) {
            const chaveT = `${String(t.docTip)}/${String(t.docCod)}/${String(t.titCod)}`;
            const docT = String(t.docCod);
            antesDoc[docT] = resumoTitulo(
                (await doDoc(docT)).find((x) => String(x.titCod) === String(t.titCod)),
            );
            const delTit = await tenta(() =>
                base.deleteGeneric<unknown>(`fin070/titulos/${frnCod}/${chaveT}`, { filCod: FIL }),
            );
            passos.push({ rota: `DELETE fin070/titulos/${frnCod}/${chaveT}`, resultado: delTit });
            log(`DELETE título ${chaveT}: ${sanea(delTit)}`);
            if (delTit.ok) continue;
            const comps = await base.listGenericPaginated<Row>(
                `fin070/titulos/composicao/list/${frnCod}/${chaveT}`,
                {
                    fieldList: [],
                    filterList: {},
                    pageNumber: 1,
                    pageSize: 50,
                    serviceName: 'fin070',
                },
                { filCod: FIL },
            );
            for (const c of comps.rows) {
                const rota = `fin070/titulos/composicao/${frnCod}/${chaveT}/${String(c.frgCodSeq)}`;
                const delC = await tenta(() => base.deleteGeneric<unknown>(rota, { filCod: FIL }));
                passos.push({ rota: `DELETE ${rota}`, resultado: delC });
                log(`DELETE ${rota}: ${sanea(delC)}`);
            }
            const delTit2 = await tenta(() =>
                base.deleteGeneric<unknown>(`fin070/titulos/${frnCod}/${chaveT}`, { filCod: FIL }),
            );
            passos.push({
                rota: `DELETE fin070/titulos/${frnCod}/${chaveT} (2ª)`,
                resultado: delTit2,
            });
            log(`DELETE título ${chaveT} (2ª): ${sanea(delTit2)}`);
        }
        const delCab = await tenta(() =>
            base.deleteGeneric<unknown>(`fin070/${frnCod}`, { filCod: FIL }),
        );
        passos.push({ rota: `DELETE fin070/${frnCod}`, resultado: delCab });
        log(`DELETE fin070/${frnCod}: ${sanea(delCab)}`);
        res.passos = passos;
        res.cabecalhoDepois = await cabecalho(frnCod);
        res.lidaDepois = await tenta(() => reneg.lerRenegociacao(sessao, { filCod: FIL, frnCod }));
        res.noList = await tenta(async () =>
            (
                await base.listGenericPaginated<Row>(
                    'fin070/list',
                    {
                        fieldList: [],
                        filterList: {},
                        pageNumber: 1,
                        pageSize: 200,
                        serviceName: 'fin070',
                    },
                    { filCod: FIL },
                )
            ).rows.some((r) => Number(r.frnCod) === frnCod),
        );
        const depoisDoc: Record<string, Row | string> = {};
        for (const t of titulosDaReneg.rows) {
            depoisDoc[String(t.docCod)] = resumoTitulo(
                (await doDoc(String(t.docCod))).find((x) => String(x.titCod) === String(t.titCod)),
            );
        }
        res.titulos = { antes: antesDoc, depois: depoisDoc };
        log(
            `depois: cabeçalho ${sanea(res.cabecalhoDepois)} · no list ${sanea(res.noList)} · títulos ${sanea(res.titulos)}`,
        );
        salvar('desfazer', res);
        return;
    }

    if (FASE === 'preparar') {
        exigeDoc();
        const res: Row = { doc: DOC };
        const antes = await tituloAtual();
        if (!antes) throw new Error('título não encontrado no fin064');
        res.antes = resumoTitulo(antes);
        const titCodsAntes = (await doDoc(docCod as string)).map((t) => String(t.titCod));
        const pesCod = Number(antes.pesCodFor ?? antes.pesCod);
        const criado = await reneg.criarRenegociacao(sessao, {
            filCod: FIL,
            pesCod,
            dataRenegEpoch: hojeEpoch,
            obs: `TESTE HML KAVEX G2 VENCIMENTO HOJE ${docCod}/${titCod} (NAO USAR)`,
        });
        const frnCod = criado.frnCod;
        if (INTOCAVEIS.has(frnCod)) throw new Error('frnCod intocável');
        res.frnCod = frnCod;
        const ident = {
            filCod: FIL,
            frnCod,
            docTip: Number(antes.docTip),
            docCod: docCod as string,
            titCod: titCod as string,
        };
        await reneg.incluirTitulo(sessao, ident);
        const liquido =
            Number(antes.totalLiquido ?? antes.titMnyValor) - Number(antes.totalPago ?? 0);
        res.g2Hoje = {
            vencimento: hoje,
            valor: liquido,
            resultado: await tenta(() =>
                reneg.gravarComposicao(sessao, {
                    ...ident,
                    valor: liquido,
                    vencimentoEpoch: hojeEpoch,
                    ...(antes.titEspNumero ? { frgEspNumero: String(antes.titEspNumero) } : {}),
                    ...(antes.pgtCod != null ? { pgtCod: Number(antes.pgtCod) } : {}),
                    ...(antes.dupEspOrdem ? { dupEspOrdem: String(antes.dupEspOrdem) } : {}),
                }),
            ),
        };
        log(`G2 composição vencendo HOJE ${hoje}: ${sanea(res.g2Hoje)}`);
        if (!(res.g2Hoje as { resultado: { ok: boolean } }).resultado.ok) {
            res.cancelar = await tenta(() =>
                reneg.cancelarRenegociacao(sessao, { filCod: FIL, frnCod }),
            );
            return salvar('preparar', res);
        }
        res.lida = await reneg.lerRenegociacao(sessao, { filCod: FIL, frnCod });
        res.finalizar = await tenta(() =>
            reneg.finalizarRenegociacao(sessao, { filCod: FIL, frnCod }),
        );
        log(`finalizar ${frnCod}: ${sanea(res.finalizar)}`);
        const doc = await doDoc(docCod as string);
        const novo = doc.find((t) => !titCodsAntes.includes(String(t.titCod)));
        res.novo = resumoTitulo(novo);
        log(`título novo: ${sanea(res.novo)}`);
        if (novo) {
            const bloqueios = (
                await reneg.listarBloqueios(sessao, { filCod: FIL, docCod: docCod as string })
            ).filter((b) => b.titCod === String(novo.titCod));
            res.bloqueios = bloqueios.map((b) => ({
                fblCod: b.fblCod,
                ftbVldStatus: b.ftbVldStatus,
                titMnyTotal: b.titMnyTotal,
            }));
            for (const b of bloqueios.filter((x) => x.ftbVldStatus !== 2)) {
                const cmds = await reneg.listarComandosDoBloqueio(sessao, {
                    filCod: FIL,
                    fblCod: b.fblCod,
                });
                const aprovar = cmds.filter((c) => c.ativo && c.nome.toUpperCase() === 'APROVAR');
                if (aprovar.length !== 1) {
                    res.liberacao = { erro: 'APROVAR ausente/ambíguo', cmds };
                    continue;
                }
                const alvo = {
                    filCod: FIL,
                    linha: b.row,
                    fbaCod: (aprovar[0] as { fbaCod: number }).fbaCod,
                };
                res.liberacao = await tenta(async () => {
                    await reneg.validarSelecionado(sessao, alvo);
                    await reneg.aplicarComando(sessao, alvo);
                    return 'ok';
                });
            }
            const final = (await doDoc(docCod as string)).find((t) => t.titCod === novo.titCod);
            res.novoDepoisDeLiberar = resumoTitulo(final);
            log(`título novo depois de liberar: ${sanea(res.novoDepoisDeLiberar)}`);
        }
        salvar('preparar', res);
        return;
    }

    if (FASE === 'e2e') {
        exigeDoc();
        const res: Row = { doc: DOC, deltaCentavos: DELTA };
        const antes = await tituloAtual();
        if (!antes) throw new Error('título não encontrado no fin064');
        res.antes = resumoTitulo(antes);
        log(`antes: ${sanea(res.antes)}`);
        const liquidoCentavos = Math.round(
            (Number(antes.totalLiquido) - Number(antes.totalPago ?? 0)) * 100,
        );
        const valorBoleto = (liquidoCentavos + DELTA) / 100;
        const vencTitulo = civil(antes.titDtaVencimento);
        const numero = String(antes.docEspNumero ?? antes.titEspNumero ?? '');
        const barras = CodigoBarrasSintetico.barras({
            valor: valorBoleto,
            vencimento: vencTitulo,
            banco: '341',
            serie: 700 + Math.abs(DELTA) * 10 + (DELTA > 0 ? 1 : 2),
        });
        const linha = conv.paraLinhaDigitavel(barras) as string;
        res.boleto = { codigo: mask(barras), valor: valorBoleto, vencimento: vencTitulo, numero };

        // ── Fakes (só o que é LOCAL; tudo do ERP é real) ─────────────────────
        const ledger = ledgerEmMemoria();
        const eventos: Row[] = [];
        const decisao = {
            id: 'hml-dec-1',
            filCod: FIL,
            docCod,
            titCod,
            ddcCod: 1,
            ditCod: 1,
            decisao: 'CONFIRMADA',
            confirmacaoEmissorId: 'hml-par-1',
            decididoPor: 'hml',
        };
        const sugestoes = {
            buscarDecisaoPorId: async () => decisao,
            listarDecisoes: async () => [decisao],
            buscarParPorId: async () => ({ id: 'hml-par-1', estado: 'VIGENTE' }),
            inserirEventoAjuste: async (e: Row) => {
                eventos.push(e);
                return { inserido: true };
            },
        };
        const boletos = {
            buscarPorChave: async () => ({
                ddcCod: 1,
                ditCod: 1,
                valor: valorBoleto,
                numero,
                vencimento: vencTitulo,
                codbar: linha,
            }),
        };
        const titulos = {
            buscarPorChave: async () => ({
                filCod: FIL,
                docCod,
                titCod,
                valor: Number(antes.titMnyValor),
                vencimento: Number(antes.titDtaVencimento),
                liberado: true,
                pago: false,
                temBoleto: false,
                numeroDocumento: numero,
                ativo: true,
            }),
        };
        const marcadorProcesso = new ServerProcessMarker();
        marcadorProcesso.ligar(); // simula o processo do servidor (I18f) — o probe É a execução
        const login = process.env.CONEXOS_USERNAME ?? '';
        const env = {
            getEnvironmentVars: async () => ({
                conexosLogin: login,
                sispagLiveWriteEnabled: true,
                conexosWriteEnabled: true,
                conexosDryRun: false,
            }),
        };
        const logs: Row[] = [];
        const logService = {
            info: async (x: Row) => void logs.push({ nivel: 'info', ...x }),
            warn: async (x: Row) => void logs.push({ nivel: 'warn', ...x }),
            error: async (x: Row) => void logs.push({ nivel: 'error', ...x }),
        };
        const db = { withAdvisoryLock: async (_k: number, ok: () => Promise<unknown>) => ok() };
        const servico = new AjusteCentavosTituloService(
            reneg,
            registry,
            ledger as unknown as AjusteCentavosExecucaoRepository,
            sugestoes as unknown as SugestaoBoletoRepository,
            boletos as unknown as BoletoDdaRepository,
            titulos as unknown as TituloAPagarRepository,
            { tituloEmLoteFechado: async () => false } as unknown as LotePagamentoRepository,
            new ElegibilidadeAjusteCentavos(conv),
            marcadorProcesso,
            calendar,
            env as unknown as EnvironmentProvider,
            logService as unknown as LogService,
            db as unknown as PostgreeDatabaseClient,
            // Probe HML: o alerta do painel vira linha no relatório, nunca escrita no banco.
            {
                emitir: async (a: Row) => {
                    logs.push({ nivel: 'alerta', ...a });
                    return null;
                },
            } as unknown as NotificacaoService,
        );
        const r = await tenta(() =>
            servico.ajustar({
                filCod: FIL,
                docCod: docCod as string,
                titCod: titCod as string,
                decisaoId: decisao.id,
                gatilho: 'tentar_de_novo',
            }),
        );
        const exec = [...ledger.linhas.values()][0];
        res.servico = {
            resultado: r,
            ledger: exec,
            rechaveamentos: ledger.rechaveamentos,
            eventos: eventos.map((e) => ({ tipo: e.tipo, motivo: e.motivo })),
        };
        res.logs = logs.map((l) => ({ nivel: l.nivel, message: l.message }));
        log(`serviço: ${sanea(r)} · ledger ${sanea(exec)}`);
        const novoCod = exec?.titCodNovo;
        const doc = await doDoc(docCod as string);
        res.documentoDepois = doc.map(resumoTitulo);
        const novo = doc.find((t) => String(t.titCod) === novoCod);
        if (!novo || novo.vldLib !== 1) {
            log(`sem título novo liberado (${String(novoCod)}): para antes do vínculo.`);
            return salvar('e2e', res);
        }

        // ── Vínculo + finalizar + .REM (mesmos passos do probe-hml-vinculo-centavos) ──
        const lotes = await write.listarLotesNativos({ filCod: FIL, bncCod: BNC });
        const ctx = lotes.find((l) => l.status === 0) ?? lotes[lotes.length - 1];
        const pend = ctx
            ? await write.listarTitulosPendentes({ filCod: FIL, bncCod: BNC, flpCod: ctx.flpCod })
            : [];
        const p = pend.find(
            (x) => String(x.docCod) === docCod && String(x.titCod) === String(novoCod),
        );
        res.noGridPendentes = p
            ? {
                  titMnyValor: p.raw.titMnyValor,
                  titMnyJuros: p.raw.titMnyJuros,
                  titMnyDesconto: p.raw.titMnyDesconto,
                  titMnyLiquido: p.raw.titMnyLiquido,
              }
            : 'AUSENTE';
        log(`título novo nos pendentes: ${sanea(res.noGridPendentes)}`);
        if (!p) return salvar('e2e', res);
        const contas = await sispag.listContasCorrentes(FIL);
        const conta = contas.find((c) => c.bncCod === BNC) ?? contas[0];
        if (!conta) throw new Error('sem conta pagadora');
        const debito = hojeEpoch;
        const lote = await write.criarLote({
            filCod: FIL,
            conta: {
                bncCod: conta.bncCod,
                bncNumCodbanco: 341,
                ccoCod: conta.ccoCod,
                ccoNumConta: conta.numeroConta ?? 0,
                ccoEspDvconta: conta.dvConta ?? '',
                ccoEspAgcod: conta.agencia ?? '',
                conta: `${conta.numeroConta}-${conta.dvConta}`,
                layoutConta: `AG:${conta.agencia}/CT:${conta.numeroConta}-${conta.dvConta}`,
            },
            dataDebito: debito,
        });
        const flpCod = lote.flpCod;
        res.flpCod = flpCod;
        log(`lote de teste flp ${flpCod} (débito ${hoje})`);
        const liquidoNovo = Number(p.raw.titMnyLiquido ?? valorBoleto);
        const selecao = {
            op: 1,
            bncCodFin015: BNC,
            titVldReflexoDdaAssoc: 0,
            titVldReflexoDdaDesassoc: 0,
        };
        const item: Row = {
            ...p.raw,
            filCodLote: FIL,
            bncCod: BNC,
            flpCod,
            itsVldModalidade: MODALIDADE,
            itsEspNomeFav: p.raw.dpeNomPessoa,
            itsMnyValor: liquidoNovo,
            itsMnyVlrPgto: liquidoNovo,
            titMnyLiquido: liquidoNovo,
            itsDtaPgto: debito,
            vldOk: 1,
            vldImporta: 1,
            avisos: '[]',
        };
        const corpo: Row = { items: [{ ...item, ...selecao }], ...selecao };
        const path = 'fin015/finItemSispag/titulosPendentes/importar';
        const imp = await tenta(async () => {
            try {
                await base.postGenericOnce<unknown>(path, corpo, { filCod: FIL });
            } catch (e) {
                const data = (e as { response?: { data?: Row } }).response?.data;
                const perguntas = (data?.questions ?? []) as Array<{ id?: string | number }>;
                if (data?.type !== 'QUESTION' || perguntas.length === 0) throw e;
                const answers: Record<string, string> = {};
                for (const q of perguntas) if (q.id !== undefined) answers[String(q.id)] = 'YES';
                await base.postGenericOnce<unknown>(path, { ...corpo, answers }, { filCod: FIL });
            }
            return 'ok';
        });
        res.importar = imp;
        const lerItem = async (): Promise<Row | undefined> =>
            (await write.lerItensDoRascunho({ filCod: FIL, bncCod: BNC, flpCod })).itens
                .map((i) => i.row)
                .find((i) => String(i.docCod) === docCod);
        const row = await lerItem();
        if (!imp.ok || !row) {
            log(`import falhou: ${sanea(imp)}`);
            return salvar('e2e', res);
        }
        res.itemImportado = {
            itsMnyValor: row.itsMnyValor,
            itsMnyVlrPgto: row.itsMnyVlrPgto,
            titMnyLiquido: row.titMnyLiquido,
            titMnyJuros: row.titMnyJuros,
            titMnyDesconto: row.titMnyDesconto,
        };
        const pv = {
            filCod: FIL,
            bncCod: BNC,
            codigo: linha,
            valorLiquido: liquidoNovo,
            vencimento: Number(novo.titDtaVencimento),
            modalidade: MODALIDADE,
        };
        const v = await write.validarCodigoBarras(pv);
        const c = await write.confirmarCodigoBarras({ ...pv, validacao: v });
        res.confirma = {
            itsMnyVlrPgtoResult: c.itsMnyVlrPgtoResult,
            itsDtaPgtoResult: civil(c.itsDtaPgtoResult),
        };
        res.put = await tenta(() =>
            write.editarItemDoRascunho({
                filCod: FIL,
                bncCod: BNC,
                flpCod,
                item: row,
                alteracoes: {
                    itsNumCodbar: linha,
                    itsNumBanco: c.itsBncNumCodbancoResult,
                    bncDesNome: c.itsBncDesNomeResult,
                    itsMnyVlrPgto: c.itsMnyVlrPgtoResult,
                    itsDtaPgto: c.itsDtaPgtoResult,
                },
            }),
        );
        const fin = await tenta(() => write.finalizarLote({ filCod: FIL, bncCod: BNC, flpCod }));
        res.finalizar = fin;
        log(`finalizar flp ${flpCod}: ${sanea(fin)}`);
        if (fin.ok) Object.assign(res, await gerarEValidarRemessa(flpCod));
        salvar('e2e', res);
        return;
    }
    log(`fase desconhecida: ${FASE}`);
}

main()
    .then(() => process.exit(0))
    .catch((e) => {
        console.error('[hml-g2g3] FALHOU:', e instanceof Error ? e.message : String(e));
        process.exit(1);
    });
