import 'reflect-metadata';
import type ConexosBaixaClient from '../../client/ConexosBaixaClient.js';
import type ConexosIdentityProvider from '../../client/ConexosIdentityProvider.js';
import type ConexosSispagClient from '../../client/ConexosSispagClient.js';
import type ConexosSispagWriteClient from '../../client/ConexosSispagWriteClient.js';
import ConexosError from '../../errors/ConexosError.js';
import GroupBorderoIncompleteError from '../../errors/GroupBorderoIncompleteError.js';
import GroupedBoletoNotEligibleAtRemittanceError from '../../errors/GroupedBoletoNotEligibleAtRemittanceError.js';
import {
    DESFECHO_LIMPEZA,
    DESFECHO_PREPARACAO,
    MARGEM_RELOGIO_BORDERO_MS,
} from '../../interface/sispag/BorderoGrupoBoletoInterface.js';
import {
    GRUPO_BOLETO_ESTADO,
    GRUPO_BOLETO_EVENTO,
    GRUPO_BOLETO_ORIGEM,
    type GrupoBoleto,
    MOTIVO_GRUPO_INELEGIVEL,
} from '../../interface/sispag/GrupoBoletoInterface.js';
import { ALERTA_TIPO } from '../../interface/operacao/Alerta.js';
import {
    type LotePagamento,
    SYSTEM_REMOVAL_REASON,
} from '../../interface/sispag/SispagInterface.js';
import BankingCalendar from '../../libs/calendar/BankingCalendar.js';
import CodigoBarrasSintetico from '../../libs/boleto/CodigoBarrasSintetico.js';
import EtapaBorderoGrupo, {
    ETAPA_BORDERO_GRUPO,
    type EtapaBordero,
} from '../../libs/boleto/EtapaBorderoGrupo.js';
import type EnvironmentProvider from '../../libs/environment/EnvironmentProvider.js';
import SituacaoBorderoFin010 from '../../libs/sispag/SituacaoBorderoFin010.js';
import type BoletoDdaRepository from '../../repository/sispag/BoletoDdaRepository.js';
import type GrupoBoletoExecucaoRepository from '../../repository/sispag/GrupoBoletoExecucaoRepository.js';
import type {
    BaixaDoGrupo,
    GrupoBoletoExecucao,
    NovaExecucaoGrupo,
} from '../../repository/sispag/GrupoBoletoExecucaoRepository.js';
import type GrupoBoletoRepository from '../../repository/sispag/GrupoBoletoRepository.js';
import type SugestaoBoletoRepository from '../../repository/sispag/SugestaoBoletoRepository.js';
import type LogService from '../LogService.js';
import type NotificacaoService from '../operacao/NotificacaoService.js';
import BorderoGrupoBoletoService from './BorderoGrupoBoletoService.js';

/**
 * Especificação do `BorderoGrupoBoletoService` (ADR-0077: I21l–q, I21s; tabela de reconhecimento
 * da emenda de `retomada-remessa-sispag.md`; emenda 2026-10-21: identidade
 * `filCod + borCod + borTimCad`, busca por janela, ausência pela lista, guarda = lote nativo).
 * Escrita como RED na Task 13 (41 casos por `itRed`); verde desde a Task 14, sem mudar asserção.
 * Os casos do borderô antigo cancelado/estornado/indeterminado (achados HML T9) são da Task 14.
 *
 * O ERP é um fake em memória (`erpFake`) com as regras medidas no HML: `borCod` reusado depois
 * de excluir (max+1), `borTimCad` ao segundo, `FIN_014.FIN_HAS_REMESSA_PGTO` ao excluir baixa ou
 * borderô com o item no lote (V3), `borderosPendentes` só com o `gerNum` da conta do lote (H2),
 * situação do borderô pelo `borVldFinalizado` × `borCodNovo` (T9).
 */

// ── Fixtures ──────────────────────────────────────────────────────────────────────────────

const FIL = 2;
const BNC = 341;
const FLP = 51;
const GER_NUM = 4321;
const DEBITO = '2026-10-21';
const DEBITO_EPOCH = Date.UTC(2026, 9, 21);
const ROBO_USN = 77;
/** Relógio do servidor no momento da preparação (e da retomada). */
const AGORA = Date.UTC(2026, 9, 20, 13, 0, 0);
const MASCARA = '34191…7500';
const DOCS = ['38883', '38884', '38885'] as const;
const LIQUIDO = 525;

const grupoPedroni = (over: Partial<GrupoBoleto> = {}): GrupoBoleto => ({
    id: 'G1',
    filCod: FIL,
    pesCod: '9001',
    credor: 'PEDRONI',
    emissorChave: '341:1234',
    ddcCod: 900,
    ditCod: 1,
    numeroBoleto: '332841',
    codbarMascarado: MASCARA,
    valorBoletoCentavos: 157_500,
    vencimentoBoleto: DEBITO,
    titulos: DOCS.map((docCod) => ({
        filCod: FIL,
        docCod,
        titCod: '1',
        valorLiquidoCentavos: 52_500,
        vencimento: DEBITO,
    })),
    somaTitulosCentavos: 157_500,
    origem: GRUPO_BOLETO_ORIGEM.SUGERIDO,
    intercambiavel: false,
    avisosReconhecidos: [],
    confirmacaoEmissorId: 'PAR1',
    estado: GRUPO_BOLETO_ESTADO.CONFIRMADO,
    confirmadoPor: 'analista@columbia',
    confirmadoEm: new Date(AGORA - 86_400_000),
    versao: 1,
    ...over,
});

const lotePedroni = (over: Partial<LotePagamento> = {}): LotePagamento => ({
    id: 'L1',
    filCod: FIL,
    status: 'FINALIZADO',
    criadoPor: 'analista@columbia',
    versao: 3,
    conta: '55795-4',
    nativeFilCod: FIL,
    nativeBncCod: BNC,
    nativeFlpCod: FLP,
    gerNum: GER_NUM,
    dataDebito: DEBITO,
    itens: DOCS.map((docCod) => ({
        loteId: 'L1',
        filCod: FIL,
        docCod,
        titCod: '1',
        valor: LIQUIDO,
        modalidade: 'BOLETO',
        incluidoPor: 'analista@columbia',
        grupoBoletoId: 'G1',
        divergencia: false,
    })),
    ...over,
});

const recusa = (key: string) =>
    Object.assign(new Error('Request failed with status code 400'), {
        response: { status: 400, data: { type: 'VALIDATION', messages: [{ message: key }] } },
    });
const erroDeterministico = (endpoint: string, key: string) =>
    new ConexosError({ endpoint, cause: recusa(key) });
const erroTransitorio = (endpoint: string) =>
    new ConexosError({ endpoint, code: 'CONEXOS_UPSTREAM_TIMEOUT' });

// ── ERP fake ──────────────────────────────────────────────────────────────────────────────

interface BaixaErp {
    docCod: number;
    titCod: number;
    bxaCodSeq: number;
    valor: number;
}
interface BorderoErp {
    filCod: number;
    borCod: number;
    borTimCad: number;
    usnCodCad: number;
    gerNum: number;
    borDtaMvto: number;
    borVldFinalizado: number;
    /** Borderô que substituiu este num estorno (`borVldFinalizado = 3`, achados T9). */
    borCodNovo?: number;
    baixas: BaixaErp[];
}
interface ItemErp {
    borCod: number;
    itsCodSeq: number;
    itsMnyValor: number;
}
interface TituloErp {
    pago: boolean;
    liberado: boolean;
    liquido?: number;
}

const erpFake = (trilha: string[]) => {
    const estado = {
        borderos: [] as BorderoErp[],
        itens: [] as ItemErp[],
        titulos: new Map<string, TituloErp>(
            DOCS.map((d) => [d, { pago: false, liberado: true, liquido: LIQUIDO }]),
        ),
        /** Carimbo que o ERP grava no próximo `POST fin010` (ms, ao segundo). */
        proximoTimCad: AGORA + 2_000,
        proximoItsCodSeq: 7,
        loteNativoStatus: 0 as number | 'ilegivel',
        arquivosRemessa: [] as Array<{ gabCod: number }>,
        /** `borCod`s que o grid de pendentes não traz (H2/V7: gerNum errado, fora dos pendentes). */
        foraDosPendentes: new Set<number>(),
        /** `importar` responde SUCESSO mas o item não aparece (H4). */
        importarSemItem: false,
        /** `POST fin010` cria o borderô e a resposta se perde (timeout). */
        perderRespostaDoPost: false,
        recusarBaixaDe: undefined as string | undefined,
        timeoutBaixaDe: undefined as string | undefined,
        timeoutExcluirBordero: false,
    };
    const totalLiquido = (b: BorderoErp) =>
        Math.round(b.baixas.reduce((s, x) => s + x.valor * 100, 0)) / 100;
    const identidade = (b: BorderoErp) => ({
        filCod: b.filCod,
        borCod: b.borCod,
        borTimCad: b.borTimCad,
        usnCodCad: b.usnCodCad,
        gerNum: b.gerNum,
        borDtaMvto: b.borDtaMvto,
        borVldFinalizado: b.borVldFinalizado,
        vlrTotalLiquido: totalLiquido(b),
        vldHasRemessaPgto: estado.itens.some((i) => i.borCod === b.borCod) ? 1 : 0,
        // O client deriva a situação do cabeçalho lido (mesma função, achados T9).
        situacao: SituacaoBorderoFin010.classificar(b),
    });
    const doBorCod = (borCod: number) => estado.borderos.find((b) => b.borCod === borCod);
    const itemNoLote = (borCod: number) => estado.itens.some((i) => i.borCod === borCod);
    const novoBordero = (p: Partial<BorderoErp> = {}): BorderoErp => {
        const maior = Math.max(250, ...estado.borderos.map((b) => b.borCod));
        const b: BorderoErp = {
            filCod: FIL,
            borCod: maior + 1,
            borTimCad: estado.proximoTimCad,
            usnCodCad: ROBO_USN,
            gerNum: GER_NUM,
            borDtaMvto: DEBITO_EPOCH,
            borVldFinalizado: 0,
            baixas: [],
            ...p,
        };
        estado.borderos.push(b);
        return b;
    };

    const baixa = {
        criarBorderoDoGrupo: jest.fn(
            async (p: { filCod: number; dataMovto: number; gerNum: number }) => {
                trilha.push('erp.criarBordero');
                const b = novoBordero({
                    filCod: p.filCod,
                    gerNum: p.gerNum,
                    borDtaMvto: p.dataMovto,
                });
                if (estado.perderRespostaDoPost) throw erroTransitorio('fin010');
                return {
                    filCod: b.filCod,
                    borCod: b.borCod,
                    borTimCad: b.borTimCad,
                    usnCodCad: b.usnCodCad,
                };
            },
        ),
        validarTituloBaixa: jest.fn(
            async (p: {
                filCod: number;
                borCod: number;
                invoiceDocCod: number;
                titCod: number;
            }) => {
                trilha.push(`erp.validar ${p.invoiceDocCod}`);
                const t = estado.titulos.get(String(p.invoiceDocCod));
                return {
                    messages: [],
                    responseData: { bxaMnyValor: t?.liquido ?? 0, filCod: p.filCod },
                };
            },
        ),
        gravarBaixaSimples: jest.fn(
            async (p: {
                filCod: number;
                borCod: number;
                gerNum: number;
                docCod: number;
                titCod: number;
                validacao: Record<string, unknown>;
            }) => {
                trilha.push(`erp.baixa ${p.docCod}`);
                if (estado.recusarBaixaDe === String(p.docCod)) {
                    throw erroDeterministico('fin010/baixas', 'FIN_010.TITULO_JA_BAIXADO');
                }
                if (estado.timeoutBaixaDe === String(p.docCod))
                    throw erroTransitorio('fin010/baixas');
                const b = doBorCod(p.borCod);
                if (!b) throw erroDeterministico('fin010/baixas', 'FIN_010.BORDERO_INEXISTENTE');
                const bxaCodSeq = b.baixas.length + 1;
                const valor = Number(p.validacao.bxaMnyValor);
                b.baixas.push({ docCod: p.docCod, titCod: p.titCod, bxaCodSeq, valor });
                return {
                    bxaCodSeq,
                    borCod: p.borCod,
                    docCod: p.docCod,
                    bxaDocCod: p.docCod,
                    bxaMnyValor: valor,
                    bxaMnyJuros: 0,
                    bxaMnyLiquido: valor,
                };
            },
        ),
        buscarBorderosNaJanela: jest.fn(
            async (p: {
                filCod: number;
                usnCodCad: number;
                gerNum: number;
                borDtaMvto: number;
                t0: number;
                t1?: number;
                agora: number;
                margemMs: number;
            }) => {
                trilha.push('erp.janela');
                const de = p.t0 - p.margemMs;
                const ate = (p.t1 ?? p.agora) + p.margemMs;
                return estado.borderos
                    .filter(
                        (b) =>
                            b.filCod === p.filCod &&
                            b.usnCodCad === p.usnCodCad &&
                            b.gerNum === p.gerNum &&
                            b.borDtaMvto === p.borDtaMvto &&
                            b.borVldFinalizado === 0 &&
                            b.borTimCad >= de &&
                            b.borTimCad <= ate,
                    )
                    .map(identidade);
            },
        ),
        buscarBorderoPorIdentidade: jest.fn(
            async (p: { filCod: number; borCod: number; borTimCad: number }) => {
                trilha.push(`erp.identidade ${p.borCod}`);
                const b = doBorCod(p.borCod);
                if (!b) return { situacao: 'AUSENTE' as const };
                if (b.borTimCad !== p.borTimCad) {
                    return { situacao: 'ALHEIO' as const, bordero: identidade(b) };
                }
                return { situacao: 'PRESENTE' as const, bordero: identidade(b) };
            },
        ),
        listBaixas: jest.fn(async (p: { filCod: number; borCod: number }) => {
            trilha.push(`erp.listBaixas ${p.borCod}`);
            return (doBorCod(p.borCod)?.baixas ?? []).map((x) => ({
                filCod: FIL,
                docTip: 2,
                docCod: x.docCod,
                titCod: x.titCod,
                bxaCodSeq: x.bxaCodSeq,
            }));
        }),
        excluirBaixa: jest.fn(
            async (p: {
                filCod: number;
                borCod: number;
                invoiceDocCod: number;
                titCod: number;
                bxaCodSeq: number;
            }) => {
                trilha.push(`erp.excluirBaixa ${p.invoiceDocCod}`);
                if (itemNoLote(p.borCod)) {
                    throw erroDeterministico('fin010/baixas', 'FIN_014.FIN_HAS_REMESSA_PGTO');
                }
                const b = doBorCod(p.borCod);
                if (b) b.baixas = b.baixas.filter((x) => x.bxaCodSeq !== p.bxaCodSeq);
            },
        ),
        excluirBordero: jest.fn(async (p: { filCod: number; borCod: number }) => {
            trilha.push(`erp.excluirBordero ${p.borCod}`);
            if (estado.timeoutExcluirBordero) throw erroTransitorio(`fin010/${p.borCod}`);
            if (itemNoLote(p.borCod)) {
                throw erroDeterministico(`fin010/${p.borCod}`, 'FIN_014.FIN_HAS_REMESSA_PGTO');
            }
            if ((doBorCod(p.borCod)?.baixas.length ?? 0) > 0) {
                throw erroDeterministico(`fin010/${p.borCod}`, 'FIN_010.BORDERO_COM_BAIXAS');
            }
            estado.borderos = estado.borderos.filter((b) => b.borCod !== p.borCod);
        }),
        finalizarBordero: jest.fn(async () => {
            throw new Error('I21m: nunca finalizamos borderô de grupo');
        }),
        cancelarBordero: jest.fn(async () => {
            throw new Error('I21m: nunca cancelamos borderô de grupo');
        }),
        estornarBordero: jest.fn(async () => {
            throw new Error('I21m: nunca estornamos borderô de grupo');
        }),
        getBordero: jest.fn(async () => {
            throw new Error('ausência se decide pela lista (GET responde 500 RECORDNOTFOUND)');
        }),
    };

    const write = {
        listarBorderosPendentes: jest.fn(
            async (_p: { filCod: number; bncCod: number; flpCod: number }) => {
                trilha.push('erp.pendentes');
                return estado.borderos
                    .filter(
                        (b) =>
                            b.borVldFinalizado === 0 &&
                            b.gerNum === GER_NUM &&
                            !itemNoLote(b.borCod) &&
                            !estado.foraDosPendentes.has(b.borCod),
                    )
                    .map((b) => ({
                        filCod: b.filCod,
                        borCod: b.borCod,
                        vlrTotal: totalLiquido(b),
                        row: { filCod: b.filCod, borCod: b.borCod, itemy: 0 },
                    }));
            },
        ),
        importarBorderoPendente: jest.fn(
            async (p: {
                linha: { borCod: number };
                filCodLote: number;
                bncCod: number;
                flpCod: number;
                bncCodFin015: number;
            }) => {
                trilha.push(`erp.importar ${p.linha.borCod}`);
                if (estado.importarSemItem) return;
                const b = doBorCod(p.linha.borCod);
                estado.itens.push({
                    borCod: p.linha.borCod,
                    itsCodSeq: estado.proximoItsCodSeq++,
                    itsMnyValor: b ? totalLiquido(b) : 0,
                });
            },
        ),
        lerItemDeBordero: jest.fn(
            async (p: { filCod: number; bncCod: number; flpCod: number; borCod: number }) => {
                trilha.push(`erp.lerItem ${p.borCod}`);
                const i = estado.itens.find((x) => x.borCod === p.borCod);
                return i
                    ? {
                          filCod: FIL,
                          borCod: i.borCod,
                          itsCodSeq: i.itsCodSeq,
                          itsMnyValor: i.itsMnyValor,
                          row: {},
                      }
                    : undefined;
            },
        ),
        removerItemDoRascunho: jest.fn(
            async (p: {
                filCod: number;
                bncCod: number;
                flpCod: number;
                itsCodSeq: number;
                filCodItem: number;
            }) => {
                trilha.push(`erp.removerItem ${p.itsCodSeq}`);
                estado.itens = estado.itens.filter((x) => x.itsCodSeq !== p.itsCodSeq);
            },
        ),
        getLoteNativo: jest.fn(async (p: { filCod: number; bncCod: number; flpCod: number }) => {
            trilha.push('erp.loteNativo');
            if (estado.loteNativoStatus === 'ilegivel') throw erroTransitorio('fin015');
            return {
                filCod: p.filCod,
                bncCod: p.bncCod,
                flpCod: p.flpCod,
                status: estado.loteNativoStatus,
                titulosCount: 1,
                soma: 1575,
            };
        }),
        listarArquivosRemessa: jest.fn(async () => {
            trilha.push('erp.arquivosRemessa');
            return estado.arquivosRemessa;
        }),
        importarTitulos: jest.fn(async () => {
            throw new Error('I21k: título de grupo nunca vai em importarTitulos');
        }),
    };

    const sispag = {
        getTituloAPagar: jest.fn(async (filCod: number, docCod: string, titCod: string) => {
            const t = estado.titulos.get(docCod);
            if (!t) return null;
            return { filCod, docCod, titCod, valor: LIQUIDO, liberado: t.liberado, pago: t.pago };
        }),
        lerValoresAberto: jest.fn(async (_f: number, docCod: string) => {
            const t = estado.titulos.get(docCod);
            if (t?.liquido === undefined) return { legivel: false as const, motivo: 'sem linha' };
            return {
                legivel: true as const,
                valores: {
                    totalLiquido: t.liquido,
                    totalAberto: t.liquido,
                    titMnyJuros: 0,
                    titMnyDesconto: 0,
                },
            };
        }),
    };

    return { estado, baixa, write, sispag, novoBordero };
};

// ── Ledger fake (mesma máquina de etapas do repositório real) ──────────────────────────────

const ledgerFake = (trilha: string[]) => {
    const execs = new Map<string, GrupoBoletoExecucao>();
    let seq = 0;
    const nova = (p: NovaExecucaoGrupo & Partial<GrupoBoletoExecucao>): GrupoBoletoExecucao => {
        seq += 1;
        const e: GrupoBoletoExecucao = {
            id: p.id ?? `E${seq}`,
            baixas: [],
            etapa: ETAPA_BORDERO_GRUPO.INTENCAO_GRAVADA,
            tentativas: 1,
            criadoEm: new Date(AGORA - 1_000_000 + seq),
            atualizadoEm: new Date(AGORA - 1_000_000 + seq),
            ...p,
        } as GrupoBoletoExecucao;
        execs.set(e.id, e);
        return e;
    };
    const naoTerminal = (grupoId: string) =>
        [...execs.values()].find(
            (e) => e.grupoId === grupoId && !EtapaBorderoGrupo.ehTerminal(e.etapa),
        );
    const repo = {
        abrir: jest.fn(async (input: NovaExecucaoGrupo) => {
            trilha.push('ledger.abrir');
            const existente = naoTerminal(input.grupoId);
            if (existente) return { criado: false, execucao: { ...existente } };
            const e = nova({
                ...input,
                etapa: input.etapa ?? ETAPA_BORDERO_GRUPO.INTENCAO_GRAVADA,
            });
            return { criado: true, execucao: { ...e } };
        }),
        registrarInicioEscrita: jest.fn(async (id: string, t0: Date) => {
            trilha.push('ledger.inicioEscrita');
            const e = execs.get(id);
            if (e && e.borCod === undefined) {
                e.escritaIniciadaEm = t0;
                e.escritaConcluidaEm = undefined;
            }
        }),
        registrarBordero: jest.fn(
            async (
                id: string,
                b: {
                    borCod: number;
                    borTimCad: number;
                    usnCodCad?: number;
                    escritaConcluidaEm?: Date;
                },
            ) => {
                trilha.push('ledger.registrarBordero');
                const e = execs.get(id);
                if (!e) return false;
                if (
                    e.borCod !== undefined &&
                    (e.borCod !== b.borCod || e.borTimCad !== b.borTimCad)
                )
                    return false;
                e.borCod = b.borCod;
                e.borTimCad = b.borTimCad;
                if (b.usnCodCad !== undefined) e.usnCodCad = b.usnCodCad;
                if (b.escritaConcluidaEm) e.escritaConcluidaEm = b.escritaConcluidaEm;
                return true;
            },
        ),
        registrarBaixa: jest.fn(async (id: string, baixa: BaixaDoGrupo) => {
            trilha.push(`ledger.baixa ${baixa.docCod}`);
            const e = execs.get(id);
            if (!e) return;
            e.baixas = [
                ...e.baixas.filter(
                    (x) => !(x.docCod === baixa.docCod && x.titCod === baixa.titCod),
                ),
                baixa,
            ];
        }),
        registrarEtapa: jest.fn(
            async (
                id: string,
                de: EtapaBordero,
                para: EtapaBordero,
                campos: { motivo?: string; itsCodSeq?: number } = {},
            ) => {
                EtapaBorderoGrupo.transicionar(de, para);
                trilha.push(`ledger.etapa ${para}`);
                const e = execs.get(id);
                if (!e || e.etapa !== de) return false;
                e.etapa = para;
                if (campos.motivo !== undefined) e.motivo = campos.motivo;
                if (campos.itsCodSeq !== undefined) e.itsCodSeq = campos.itsCodSeq;
                return true;
            },
        ),
        registrarTentativa: jest.fn(async (id: string) => {
            const e = execs.get(id);
            if (e) e.tentativas += 1;
        }),
        buscarPorId: jest.fn(async (id: string) => {
            const e = execs.get(id);
            return e ? { ...e } : null;
        }),
        listarPorGrupo: jest.fn(async (grupoId: string) =>
            [...execs.values()].filter((e) => e.grupoId === grupoId).map((e) => ({ ...e })),
        ),
        ultimaPorGrupo: jest.fn(async (grupoId: string) => {
            const l = [...execs.values()].filter((e) => e.grupoId === grupoId);
            return l.length > 0 ? { ...(l[l.length - 1] as GrupoBoletoExecucao) } : null;
        }),
        ultimaRejeitadaPorGrupo: jest.fn(async (grupoId: string) => {
            const l = [...execs.values()].filter((e) => e.grupoId === grupoId && e.jRejeitadoEm);
            return l.length > 0 ? { ...(l[l.length - 1] as GrupoBoletoExecucao) } : null;
        }),
        listarPorLote: jest.fn(async (loteId: string) =>
            [...execs.values()].filter((e) => e.loteId === loteId).map((e) => ({ ...e })),
        ),
    };
    return { repo, execs, nova };
};

// ── Montagem ──────────────────────────────────────────────────────────────────────────────

interface Opcoes {
    env?: Record<string, unknown>;
    parEstado?: 'VIGENTE' | 'REVOGADA';
    boletoNoPool?: boolean;
    boletoVinculadoErp?: boolean;
}

const montar = (o: Opcoes = {}) => {
    const trilha: string[] = [];
    const erp = erpFake(trilha);
    const ledger = ledgerFake(trilha);
    const eventos: Array<{
        tipo: string;
        grupoId: string;
        borCod?: number;
        codigoMascarado?: string;
        dados?: Record<string, unknown>;
    }> = [];
    const grupos = {
        registrarEvento: jest.fn(async (e: (typeof eventos)[number]) => {
            trilha.push(`evento ${e.tipo}`);
            eventos.push(e);
            return `EV${eventos.length}`;
        }),
    };
    const boletos = {
        buscarPorChave: jest.fn(async (c: { ddcCod: number; ditCod: number }) =>
            o.boletoNoPool === false
                ? null
                : {
                      ddcCod: c.ddcCod,
                      ditCod: c.ditCod,
                      numero: '332841',
                      valor: 1575,
                      vencimento: DEBITO,
                      // Código SINTÉTICO (I17j): só em memória; nenhuma saída pode carregá-lo.
                      codbar: CodigoBarrasSintetico.barras({ valor: 1575, vencimento: DEBITO }),
                      ...(o.boletoVinculadoErp ? { filCod: FIL, docCod: '999', titCod: '1' } : {}),
                  },
        ),
    };
    const sugestoes = {
        buscarParPorId: jest.fn(async (id: string) => ({
            id,
            pesCod: '9001',
            emissorChave: '341:1234',
            estado: o.parEstado ?? 'VIGENTE',
        })),
    };
    const alertas: Array<{ tipo: string; alvo: string; detalhe: Record<string, unknown> }> = [];
    const notificacao = {
        emitir: jest.fn(async (a: (typeof alertas)[number]) => {
            trilha.push(`alerta ${a.tipo}`);
            alertas.push(a);
            return null;
        }),
    };
    const env = {
        conexosWriteEnabled: true,
        sispagLiveWriteEnabled: true,
        conexosDryRun: false,
        ...o.env,
    };
    const log = {
        info: jest.fn().mockResolvedValue(undefined),
        warn: jest.fn().mockResolvedValue(undefined),
        error: jest.fn().mockResolvedValue(undefined),
    };
    const identidade = {
        current: () => ({ conexosUsername: 'clonex', viaRobo: true, usnCod: String(ROBO_USN) }),
        currentParams: () => ({ conexosUsername: 'clonex', conexosUsnCod: String(ROBO_USN) }),
    };
    const service = new BorderoGrupoBoletoService(
        erp.baixa as unknown as ConexosBaixaClient,
        erp.write as unknown as ConexosSispagWriteClient,
        erp.sispag as unknown as ConexosSispagClient,
        ledger.repo as unknown as GrupoBoletoExecucaoRepository,
        grupos as unknown as GrupoBoletoRepository,
        boletos as unknown as BoletoDdaRepository,
        sugestoes as unknown as SugestaoBoletoRepository,
        notificacao as unknown as NotificacaoService,
        identidade as unknown as ConexosIdentityProvider,
        BankingCalendar.withClock(() => new Date(AGORA)),
        { getEnvironmentVars: async () => env } as unknown as EnvironmentProvider,
        log as unknown as LogService,
    );
    const pedido = (over: Record<string, unknown> = {}) => ({
        lote: lotePedroni(),
        remessaExecucaoId: 10,
        bncCod: BNC,
        flpCod: FLP,
        gerNum: GER_NUM,
        dataDebito: DEBITO,
        grupo: grupoPedroni(),
        ...over,
    });
    /** Execução nova (padrão desta remessa) já gravada no ledger. */
    const execucao = (over: Partial<GrupoBoletoExecucao> = {}) =>
        ledger.nova({
            grupoId: 'G1',
            loteId: 'L1',
            filCod: FIL,
            remessaExecucaoId: 10,
            bncCod: BNC,
            flpCod: FLP,
            gerNum: GER_NUM,
            borDtaMvto: DEBITO,
            escritaIniciadaEm: new Date(AGORA - 60_000),
            conexosUsername: 'clonex',
            conexosUsnCod: String(ROBO_USN),
            ...over,
        });
    /** Borderô completo (3 baixas) no ERP. */
    const borderoCompleto = (p: Partial<BorderoErp> = {}) =>
        erp.novoBordero({
            baixas: DOCS.map((d, i) => ({
                docCod: Number(d),
                titCod: 1,
                bxaCodSeq: i + 1,
                valor: LIQUIDO,
            })),
            ...p,
        });
    return {
        service,
        erp,
        ledger,
        trilha,
        eventos,
        alertas,
        pedido,
        execucao,
        borderoCompleto,
        log,
    };
};

type Montado = ReturnType<typeof montar>;

const ESCRITAS = (m: Montado) => [
    m.erp.baixa.criarBorderoDoGrupo,
    m.erp.baixa.gravarBaixaSimples,
    m.erp.baixa.excluirBaixa,
    m.erp.baixa.excluirBordero,
    m.erp.write.importarBorderoPendente,
    m.erp.write.removerItemDoRascunho,
];
const semEscrita = (m: Montado): void => {
    for (const fn of ESCRITAS(m)) expect(fn).not.toHaveBeenCalled();
};
const semExclusao = (m: Montado): void => {
    expect(m.erp.baixa.excluirBaixa).not.toHaveBeenCalled();
    expect(m.erp.baixa.excluirBordero).not.toHaveBeenCalled();
};
/** Cada rótulo aparece na trilha DEPOIS do anterior. */
const emOrdem = (trilha: string[], rotulos: string[]): void => {
    let desde = 0;
    for (const r of rotulos) {
        const i = trilha.indexOf(r, desde);
        if (i < 0) throw new Error(`fora de ordem ou ausente: "${r}" em [${trilha.join(' | ')}]`);
        desde = i + 1;
    }
};
const etapaDe = (m: Montado, id: string): EtapaBordero | undefined => m.ledger.execs.get(id)?.etapa;
const unicaExecucao = (m: Montado): GrupoBoletoExecucao => {
    const todas = [...m.ledger.execs.values()];
    expect(todas).toHaveLength(1);
    return todas[0] as GrupoBoletoExecucao;
};

let montados: Montado[] = [];
const novo = (o?: Opcoes): Montado => {
    const m = montar(o);
    montados.push(m);
    return m;
};
afterEach(() => {
    // I21m: nenhum caminho do grupo finaliza, cancela ou estorna borderô; nada de importarTitulos (I21k).
    for (const m of montados) {
        expect(m.erp.baixa.finalizarBordero).not.toHaveBeenCalled();
        expect(m.erp.baixa.cancelarBordero).not.toHaveBeenCalled();
        expect(m.erp.baixa.estornarBordero).not.toHaveBeenCalled();
        expect(m.erp.write.importarTitulos).not.toHaveBeenCalled();
        // Nenhum código completo em evento, alerta ou log (I17j).
        const saidas = JSON.stringify([
            m.eventos,
            m.alertas,
            m.log.info.mock.calls,
            m.log.warn.mock.calls,
            m.log.error.mock.calls,
        ]);
        expect(saidas).not.toMatch(/\d{44}|\d{47}/);
    }
    montados = [];
});

// ── Casos ─────────────────────────────────────────────────────────────────────────────────

describe('BorderoGrupoBoletoService — preparar (I21l, I21n): canônico PEDRONI', () => {
    it('sequência exata: intenção com t0 → POST fin010 → t1/borCod/borTimCad → 3 baixas → releitura → pendentes → importar (itemy 1) → item observado', async () => {
        const m = novo();
        const r = await m.service.preparar(m.pedido());

        expect(r).toMatchObject({
            desfecho: DESFECHO_PREPARACAO.PRONTO,
            reaproveitado: false,
            borCod: 251,
            itsCodSeq: 7,
        });
        const e = unicaExecucao(m);
        expect(r.execucaoId).toBe(e.id);
        // write-ahead: a intenção (com t0 do relógio do servidor) vem ANTES do POST.
        const abertura = m.ledger.repo.abrir.mock.calls[0]?.[0] as NovaExecucaoGrupo;
        expect(abertura).toMatchObject({
            grupoId: 'G1',
            loteId: 'L1',
            filCod: FIL,
            bncCod: BNC,
            flpCod: FLP,
            gerNum: GER_NUM,
            borDtaMvto: DEBITO,
            remessaExecucaoId: 10,
        });
        expect(abertura.escritaIniciadaEm?.getTime()).toBe(AGORA);
        expect(abertura.conexosUsnCod).toBe(String(ROBO_USN));
        // POST: filial do lote, data de débito, gerNum — e NADA além (sem marcador em borEspNrbanco).
        expect(m.erp.baixa.criarBorderoDoGrupo).toHaveBeenCalledTimes(1);
        expect(m.erp.baixa.criarBorderoDoGrupo).toHaveBeenCalledWith({
            filCod: FIL,
            dataMovto: DEBITO_EPOCH,
            gerNum: GER_NUM,
        });
        expect(m.ledger.repo.registrarBordero).toHaveBeenCalledWith(
            e.id,
            expect.objectContaining({
                borCod: 251,
                borTimCad: AGORA + 2_000,
                escritaConcluidaEm: expect.any(Date),
            }),
        );
        for (const doc of DOCS) {
            expect(m.erp.baixa.validarTituloBaixa).toHaveBeenCalledWith({
                filCod: FIL,
                borCod: 251,
                invoiceDocCod: Number(doc),
                titCod: 1,
            });
            expect(m.erp.baixa.gravarBaixaSimples).toHaveBeenCalledWith(
                expect.objectContaining({
                    filCod: FIL,
                    borCod: 251,
                    gerNum: GER_NUM,
                    docCod: Number(doc),
                    titCod: 1,
                }),
            );
        }
        expect(m.erp.baixa.gravarBaixaSimples).toHaveBeenCalledTimes(3);
        expect(m.erp.write.importarBorderoPendente).toHaveBeenCalledWith(
            expect.objectContaining({
                linha: expect.objectContaining({ borCod: 251 }),
                filCodLote: FIL,
                bncCod: BNC,
                flpCod: FLP,
                bncCodFin015: BNC,
            }),
        );
        emOrdem(m.trilha, [
            'ledger.abrir',
            'erp.criarBordero',
            'ledger.registrarBordero',
            'erp.validar 38883',
            'erp.baixa 38883',
            'ledger.baixa 38883',
            'erp.baixa 38884',
            'erp.baixa 38885',
            'erp.identidade 251',
            'erp.listBaixas 251',
            'ledger.etapa bordero_conferido',
            'erp.pendentes',
            'erp.importar 251',
            'erp.lerItem 251',
            'ledger.etapa importado',
        ]);
        expect(e.etapa).toBe(ETAPA_BORDERO_GRUPO.IMPORTADO);
        expect(e.itsCodSeq).toBe(7);
        expect(e.baixas.map((b) => b.docCod).sort()).toEqual([...DOCS]);
        expect(e.baixas.every((b) => b.valorCentavos === 52_500)).toBe(true);
        expect(m.eventos).toEqual([
            expect.objectContaining({
                tipo: GRUPO_BOLETO_EVENTO.BORDERO_PREPARADO,
                grupoId: 'G1',
                borCod: 251,
                codigoMascarado: MASCARA,
            }),
        ]);
        semExclusao(m);
    });

    it('gerNum ausente ⇒ falha ANTES do POST fin010 (nada escrito no ERP)', async () => {
        const m = novo();
        await expect(m.service.preparar(m.pedido({ gerNum: undefined }))).rejects.toThrow(/gerNum/);
        semEscrita(m);
    });

    it('releitura com vlrTotalLiquido ≠ valor do boleto ⇒ retirar (GRUPO_BOLETO_FALHOU), nada importado', async () => {
        const m = novo();
        m.erp.estado.titulos.set('38885', { pago: false, liberado: true, liquido: 524.99 });
        const r = await m.service.preparar(m.pedido());
        expect(r).toMatchObject({
            desfecho: DESFECHO_PREPARACAO.RETIRAR,
            motivo: SYSTEM_REMOVAL_REASON.GRUPO_BOLETO_FALHOU,
        });
        expect(m.erp.write.importarBorderoPendente).not.toHaveBeenCalled();
        expect(etapaDe(m, r.execucaoId ?? '')).toBe(ETAPA_BORDERO_GRUPO.RETIRADO);
        semExclusao(m);
    });

    it('BORDERO_NAO_PENDENTE (gerNum que o grid não aceita, H2) ⇒ retirar determinístico, sem importar', async () => {
        const m = novo();
        m.erp.estado.foraDosPendentes.add(251);
        const r = await m.service.preparar(m.pedido());
        expect(r).toMatchObject({
            desfecho: DESFECHO_PREPARACAO.RETIRAR,
            motivo: SYSTEM_REMOVAL_REASON.GRUPO_BOLETO_FALHOU,
            borCod: 251,
        });
        expect(m.erp.write.importarBorderoPendente).not.toHaveBeenCalled();
        expect(etapaDe(m, r.execucaoId ?? '')).toBe(ETAPA_BORDERO_GRUPO.RETIRADO);
        semExclusao(m);
    });

    it('importar responde SUCESSO sem o item na releitura (H4) ⇒ GroupBorderoIncompleteError (ambígua), execução failed, nunca sucesso', async () => {
        const m = novo();
        m.erp.estado.importarSemItem = true;
        await expect(m.service.preparar(m.pedido())).rejects.toBeInstanceOf(
            GroupBorderoIncompleteError,
        );
        expect(unicaExecucao(m).etapa).toBe(ETAPA_BORDERO_GRUPO.FAILED);
        semExclusao(m);
    });

    it('I21p(2): timeout numa baixa depois do borderô ⇒ GroupBorderoIncompleteError, failed, borderô preservado, nenhuma limpeza', async () => {
        const m = novo();
        m.erp.estado.timeoutBaixaDe = '38884';
        await expect(m.service.preparar(m.pedido())).rejects.toBeInstanceOf(
            GroupBorderoIncompleteError,
        );
        const e = unicaExecucao(m);
        expect(e.etapa).toBe(ETAPA_BORDERO_GRUPO.FAILED);
        expect(e.borCod).toBe(251);
        expect(m.erp.estado.borderos.map((b) => b.borCod)).toEqual([251]);
        semExclusao(m);
        expect(m.erp.write.removerItemDoRascunho).not.toHaveBeenCalled();
    });

    it('I21p(3): baixa recusada (4xx) ⇒ retirar com GRUPO_BOLETO_FALHOU; a limpeza é do chamador (preparar não exclui nada)', async () => {
        const m = novo();
        m.erp.estado.recusarBaixaDe = '38884';
        const r = await m.service.preparar(m.pedido());
        expect(r).toMatchObject({
            desfecho: DESFECHO_PREPARACAO.RETIRAR,
            motivo: SYSTEM_REMOVAL_REASON.GRUPO_BOLETO_FALHOU,
            borCod: 251,
        });
        expect(etapaDe(m, r.execucaoId ?? '')).toBe(ETAPA_BORDERO_GRUPO.RETIRADO);
        semExclusao(m);
        expect(m.erp.write.importarBorderoPendente).not.toHaveBeenCalled();
    });

    it('dry-run (sispagLiveWriteEnabled=false ou conexosDryRun=true): monta e loga, zero escrita, execução simulado', async () => {
        for (const env of [
            { sispagLiveWriteEnabled: false },
            { conexosDryRun: true },
            { conexosWriteEnabled: false },
        ]) {
            const m = novo({ env });
            const r = await m.service.preparar(m.pedido());
            expect(r.desfecho).toBe(DESFECHO_PREPARACAO.SIMULADO);
            semEscrita(m);
            expect(unicaExecucao(m).etapa).toBe(ETAPA_BORDERO_GRUPO.SIMULADO);
            expect(m.log.info).toHaveBeenCalled();
        }
    });
});

describe('BorderoGrupoBoletoService — retomada: tabela de reconhecimento (I21s, emenda 2026-10-21)', () => {
    it('intenção com t0 e sem borCod, nenhum borderô na janela ⇒ cria (um POST)', async () => {
        const m = novo();
        const e = m.execucao({ etapa: ETAPA_BORDERO_GRUPO.FAILED });
        const r = await m.service.preparar(m.pedido());
        expect(r.desfecho).toBe(DESFECHO_PREPARACAO.PRONTO);
        expect(m.erp.baixa.buscarBorderosNaJanela).toHaveBeenCalledTimes(1);
        expect(m.erp.baixa.criarBorderoDoGrupo).toHaveBeenCalledTimes(1);
        expect(m.ledger.execs.get(e.id)?.borCod).toBe(251);
        expect(m.ledger.execs.size).toBe(1);
    });

    it('resposta perdida: janela [t0 − margem, t1 + margem] com usnCodCad do robô, gerNum, borDtaMvto (epoch ms); exatamente um ⇒ adota, sem POST', async () => {
        const m = novo();
        const t0 = AGORA - 60_000;
        const t1 = AGORA - 55_000;
        const e = m.execucao({
            etapa: ETAPA_BORDERO_GRUPO.FAILED,
            escritaIniciadaEm: new Date(t0),
            escritaConcluidaEm: new Date(t1),
        });
        m.erp.estado.proximoTimCad = t0 + 1_000;
        m.erp.novoBordero();
        const r = await m.service.preparar(m.pedido());
        expect(m.erp.baixa.buscarBorderosNaJanela).toHaveBeenCalledWith({
            filCod: FIL,
            usnCodCad: ROBO_USN,
            gerNum: GER_NUM,
            borDtaMvto: DEBITO_EPOCH,
            t0,
            t1,
            agora: AGORA,
            margemMs: MARGEM_RELOGIO_BORDERO_MS,
        });
        expect(m.erp.baixa.criarBorderoDoGrupo).not.toHaveBeenCalled();
        expect(m.ledger.repo.registrarBordero).toHaveBeenCalledWith(
            e.id,
            expect.objectContaining({ borCod: 251, borTimCad: t0 + 1_000 }),
        );
        expect(m.erp.baixa.gravarBaixaSimples).toHaveBeenCalledTimes(3);
        expect(r).toMatchObject({ desfecho: DESFECHO_PREPARACAO.PRONTO, borCod: 251 });
    });

    it('t1 ausente (processo morreu antes de gravá-lo) ⇒ a janela vai até agora + margem (t1 não enviado)', async () => {
        const m = novo();
        const t0 = AGORA - 60_000;
        m.execucao({
            etapa: ETAPA_BORDERO_GRUPO.INTENCAO_GRAVADA,
            escritaIniciadaEm: new Date(t0),
        });
        m.erp.estado.proximoTimCad = AGORA - 1_000;
        m.erp.novoBordero();
        await m.service.preparar(m.pedido());
        const janela = m.erp.baixa.buscarBorderosNaJanela.mock.calls[0]?.[0] as Record<
            string,
            unknown
        >;
        expect(janela).toMatchObject({ t0, agora: AGORA, margemMs: MARGEM_RELOGIO_BORDERO_MS });
        expect(janela.t1).toBeUndefined();
        expect(m.erp.baixa.criarBorderoDoGrupo).not.toHaveBeenCalled();
    });

    it('dois ou mais borderôs na janela (ex.: Permutas com o mesmo usuário) ⇒ indeterminado + Alerta, nada escrito', async () => {
        const m = novo();
        const e = m.execucao({ etapa: ETAPA_BORDERO_GRUPO.FAILED });
        m.erp.estado.proximoTimCad = AGORA - 50_000;
        m.erp.novoBordero();
        m.erp.estado.proximoTimCad = AGORA - 49_000;
        m.erp.novoBordero();
        const r = await m.service.preparar(m.pedido());
        expect(r.desfecho).toBe(DESFECHO_PREPARACAO.INDETERMINADO);
        expect(etapaDe(m, e.id)).toBe(ETAPA_BORDERO_GRUPO.INDETERMINADO);
        semEscrita(m);
        expect(m.alertas).toEqual([
            expect.objectContaining({ tipo: ALERTA_TIPO.SISPAG_BORDERO_GRUPO_PENDENTE }),
        ]);
    });

    it('nosso borCod no write-ahead e o fin010/list traz outro borTimCad (ERP reusou o número) ⇒ indeterminado, borderô alheio intocado', async () => {
        const m = novo();
        const e = m.execucao({
            etapa: ETAPA_BORDERO_GRUPO.FAILED,
            borCod: 251,
            borTimCad: AGORA - 58_000,
        });
        m.borderoCompleto({ borCod: 251, borTimCad: AGORA - 10_000, usnCodCad: 12 });
        const r = await m.service.preparar(m.pedido());
        expect(r.desfecho).toBe(DESFECHO_PREPARACAO.INDETERMINADO);
        expect(etapaDe(m, e.id)).toBe(ETAPA_BORDERO_GRUPO.INDETERMINADO);
        semEscrita(m);
        expect(m.erp.estado.borderos[0]?.baixas).toHaveLength(3);
        expect(m.alertas).toHaveLength(1);
    });

    it('borderô nosso com parte das baixas ⇒ completa só as faltantes', async () => {
        const m = novo();
        const tim = AGORA - 58_000;
        m.execucao({ etapa: ETAPA_BORDERO_GRUPO.FAILED, borCod: 251, borTimCad: tim });
        m.erp.novoBordero({
            borCod: 251,
            borTimCad: tim,
            baixas: [{ docCod: 38883, titCod: 1, bxaCodSeq: 1, valor: LIQUIDO }],
        });
        const r = await m.service.preparar(m.pedido());
        expect(r.desfecho).toBe(DESFECHO_PREPARACAO.PRONTO);
        expect(m.erp.baixa.criarBorderoDoGrupo).not.toHaveBeenCalled();
        expect(m.erp.baixa.gravarBaixaSimples.mock.calls.map((c) => c[0].docCod).sort()).toEqual([
            38884, 38885,
        ]);
    });

    it('baixa de título que não é do grupo no nosso borderô ⇒ indeterminado (terceiro), nada escrito', async () => {
        const m = novo();
        const tim = AGORA - 58_000;
        m.execucao({ etapa: ETAPA_BORDERO_GRUPO.FAILED, borCod: 251, borTimCad: tim });
        m.erp.novoBordero({
            borCod: 251,
            borTimCad: tim,
            baixas: [{ docCod: 77777, titCod: 1, bxaCodSeq: 1, valor: 10 }],
        });
        const r = await m.service.preparar(m.pedido());
        expect(r.desfecho).toBe(DESFECHO_PREPARACAO.INDETERMINADO);
        semEscrita(m);
    });

    it('borderô completo e não importado ⇒ só importar (sem POST, sem baixa)', async () => {
        const m = novo();
        const tim = AGORA - 58_000;
        m.execucao({ etapa: ETAPA_BORDERO_GRUPO.BORDERO_CONFERIDO, borCod: 251, borTimCad: tim });
        m.borderoCompleto({ borCod: 251, borTimCad: tim });
        const r = await m.service.preparar(m.pedido());
        expect(r).toMatchObject({ desfecho: DESFECHO_PREPARACAO.PRONTO, borCod: 251 });
        expect(m.erp.baixa.criarBorderoDoGrupo).not.toHaveBeenCalled();
        expect(m.erp.baixa.gravarBaixaSimples).not.toHaveBeenCalled();
        expect(m.erp.write.importarBorderoPendente).toHaveBeenCalledTimes(1);
    });

    it('item com o borCod já no rascunho ⇒ pula o importar', async () => {
        const m = novo();
        const tim = AGORA - 58_000;
        m.execucao({ etapa: ETAPA_BORDERO_GRUPO.FAILED, borCod: 251, borTimCad: tim });
        m.borderoCompleto({ borCod: 251, borTimCad: tim });
        m.erp.estado.itens.push({ borCod: 251, itsCodSeq: 3, itsMnyValor: 1575 });
        const r = await m.service.preparar(m.pedido());
        expect(r).toMatchObject({ desfecho: DESFECHO_PREPARACAO.PRONTO, itsCodSeq: 3 });
        semEscrita(m);
    });

    it('borderô finalizado antes da remessa (alguém baixou por fora) ⇒ indeterminado + Alerta', async () => {
        const m = novo();
        const tim = AGORA - 58_000;
        m.execucao({ etapa: ETAPA_BORDERO_GRUPO.FAILED, borCod: 251, borTimCad: tim });
        m.borderoCompleto({ borCod: 251, borTimCad: tim, borVldFinalizado: 1 });
        const r = await m.service.preparar(m.pedido());
        expect(r.desfecho).toBe(DESFECHO_PREPARACAO.INDETERMINADO);
        semEscrita(m);
        expect(m.alertas).toEqual([
            expect.objectContaining({ tipo: ALERTA_TIPO.SISPAG_BORDERO_GRUPO_PENDENTE }),
        ]);
    });
});

describe('BorderoGrupoBoletoService — depois de J rejeitado (PI-9, I21r, I21s)', () => {
    const TIM_ANTIGO = AGORA - 7 * 86_400_000;
    const antiga = (m: Montado) =>
        m.execucao({
            id: 'E_ANTIGA',
            loteId: 'L0',
            flpCod: 48,
            remessaExecucaoId: 9,
            etapa: ETAPA_BORDERO_GRUPO.CONCLUIDO,
            borCod: 252,
            borTimCad: TIM_ANTIGO,
            jRejeitadoEm: new Date(AGORA - 5 * 86_400_000),
        });

    it('borderô antigo ausente no fin010 (sem linha) ⇒ cria um novo', async () => {
        const m = novo();
        antiga(m);
        const r = await m.service.preparar(m.pedido());
        expect(r).toMatchObject({ desfecho: DESFECHO_PREPARACAO.PRONTO, reaproveitado: false });
        expect(m.erp.baixa.buscarBorderoPorIdentidade).toHaveBeenCalledWith({
            filCod: FIL,
            borCod: 252,
            borTimCad: TIM_ANTIGO,
        });
        expect(m.erp.baixa.criarBorderoDoGrupo).toHaveBeenCalledTimes(1);
    });

    it('borCod antigo reusado pelo ERP com outro borTimCad (leitura (c)) ⇒ o antigo conta como ausente: cria outro sem tocar no alheio', async () => {
        const m = novo();
        antiga(m);
        m.borderoCompleto({ borCod: 252, borTimCad: AGORA - 3_600_000, usnCodCad: 12 });
        const r = await m.service.preparar(m.pedido());
        expect(r).toMatchObject({ desfecho: DESFECHO_PREPARACAO.PRONTO, reaproveitado: false });
        expect(m.erp.baixa.criarBorderoDoGrupo).toHaveBeenCalledTimes(1);
        expect(m.erp.baixa.gravarBaixaSimples.mock.calls.every((c) => c[0].borCod !== 252)).toBe(
            true,
        );
        expect(m.erp.estado.borderos.find((b) => b.borCod === 252)?.baixas).toHaveLength(3);
        semExclusao(m);
    });

    it('borderô antigo CANCELADO no fin010 (borVldFinalizado 2, achados T9) ⇒ cria um novo sem tocar no antigo', async () => {
        const m = novo();
        antiga(m);
        m.borderoCompleto({ borCod: 252, borTimCad: TIM_ANTIGO, borVldFinalizado: 2 });
        const r = await m.service.preparar(m.pedido());
        expect(r).toMatchObject({
            desfecho: DESFECHO_PREPARACAO.PRONTO,
            reaproveitado: false,
            borCod: 253,
        });
        expect(m.erp.baixa.criarBorderoDoGrupo).toHaveBeenCalledTimes(1);
        expect(m.erp.baixa.gravarBaixaSimples.mock.calls.every((c) => c[0].borCod !== 252)).toBe(
            true,
        );
        expect(m.erp.estado.borderos.find((b) => b.borCod === 252)?.baixas).toHaveLength(3);
        semExclusao(m);
    });

    it('borderô antigo ESTORNADO (borVldFinalizado 3 + borCodNovo: as baixas foram para o novo) ⇒ retirar sem escrever, nunca cria outro', async () => {
        const m = novo();
        antiga(m);
        m.borderoCompleto({
            borCod: 252,
            borTimCad: TIM_ANTIGO,
            borVldFinalizado: 3,
            borCodNovo: 260,
        });
        const r = await m.service.preparar(m.pedido());
        expect(r).toMatchObject({
            desfecho: DESFECHO_PREPARACAO.RETIRAR,
            motivo: SYSTEM_REMOVAL_REASON.BORDERO_ANTERIOR_NAO_RESOLVIDO,
        });
        semEscrita(m);
        expect(m.alertas).toEqual([
            expect.objectContaining({ tipo: ALERTA_TIPO.SISPAG_BORDERO_GRUPO_PENDENTE }),
        ]);
    });

    it('borderô antigo FINALIZADO ⇒ retirar BORDERO_ANTERIOR_NAO_RESOLVIDO sem escrever', async () => {
        const m = novo();
        antiga(m);
        m.borderoCompleto({ borCod: 252, borTimCad: TIM_ANTIGO, borVldFinalizado: 1 });
        const r = await m.service.preparar(m.pedido());
        expect(r).toMatchObject({
            desfecho: DESFECHO_PREPARACAO.RETIRAR,
            motivo: SYSTEM_REMOVAL_REASON.BORDERO_ANTERIOR_NAO_RESOLVIDO,
        });
        semEscrita(m);
    });

    it('situação do borderô antigo que o sistema não reconhece (fail-closed) ⇒ indeterminado + Alerta, nada escrito', async () => {
        const m = novo();
        antiga(m);
        m.borderoCompleto({ borCod: 252, borTimCad: TIM_ANTIGO, borVldFinalizado: 7 });
        const r = await m.service.preparar(m.pedido());
        expect(r.desfecho).toBe(DESFECHO_PREPARACAO.INDETERMINADO);
        expect(etapaDe(m, r.execucaoId ?? '')).toBe(ETAPA_BORDERO_GRUPO.INDETERMINADO);
        semEscrita(m);
        expect(m.alertas).toEqual([
            expect.objectContaining({ tipo: ALERTA_TIPO.SISPAG_BORDERO_GRUPO_PENDENTE }),
        ]);
    });

    it('borderô antigo em borderosPendentes do lote novo (V7) ⇒ reaproveita: sem segundo POST fin010, BORDERO_REAPROVEITADO', async () => {
        const m = novo();
        antiga(m);
        m.borderoCompleto({ borCod: 252, borTimCad: TIM_ANTIGO });
        const r = await m.service.preparar(m.pedido());
        expect(r).toMatchObject({
            desfecho: DESFECHO_PREPARACAO.PRONTO,
            reaproveitado: true,
            borCod: 252,
            borTimCad: TIM_ANTIGO,
        });
        expect(m.erp.baixa.criarBorderoDoGrupo).not.toHaveBeenCalled();
        expect(m.erp.baixa.gravarBaixaSimples).not.toHaveBeenCalled();
        const nova = [...m.ledger.execs.values()].find((e) => e.id !== 'E_ANTIGA');
        expect(nova).toMatchObject({
            borCod: 252,
            borTimCad: TIM_ANTIGO,
            borCodReaproveitadoDe: 'E_ANTIGA',
        });
        expect(m.erp.write.importarBorderoPendente).toHaveBeenCalledWith(
            expect.objectContaining({ linha: expect.objectContaining({ borCod: 252 }) }),
        );
        expect(m.eventos.map((e) => e.tipo)).toContain(GRUPO_BOLETO_EVENTO.BORDERO_REAPROVEITADO);
    });

    it('borderô antigo em cadastro fora dos pendentes ⇒ retirar BORDERO_ANTERIOR_NAO_RESOLVIDO sem tocar no antigo', async () => {
        const m = novo();
        antiga(m);
        m.borderoCompleto({ borCod: 252, borTimCad: TIM_ANTIGO });
        m.erp.estado.foraDosPendentes.add(252);
        const r = await m.service.preparar(m.pedido());
        expect(r).toMatchObject({
            desfecho: DESFECHO_PREPARACAO.RETIRAR,
            motivo: SYSTEM_REMOVAL_REASON.BORDERO_ANTERIOR_NAO_RESOLVIDO,
        });
        semEscrita(m);
        expect(m.alertas).toEqual([
            expect.objectContaining({ tipo: ALERTA_TIPO.SISPAG_BORDERO_GRUPO_PENDENTE }),
        ]);
    });

    it('borderô antigo com baixas divergentes ⇒ retirar BORDERO_ANTERIOR_NAO_RESOLVIDO sem tocar no antigo', async () => {
        const m = novo();
        antiga(m);
        m.erp.novoBordero({
            borCod: 252,
            borTimCad: TIM_ANTIGO,
            baixas: [
                { docCod: 38883, titCod: 1, bxaCodSeq: 1, valor: LIQUIDO },
                { docCod: 38884, titCod: 1, bxaCodSeq: 2, valor: LIQUIDO },
            ],
        });
        const r = await m.service.preparar(m.pedido());
        expect(r).toMatchObject({
            desfecho: DESFECHO_PREPARACAO.RETIRAR,
            motivo: SYSTEM_REMOVAL_REASON.BORDERO_ANTERIOR_NAO_RESOLVIDO,
        });
        semEscrita(m);
    });
});

describe('BorderoGrupoBoletoService — nunca dois borderôs vivos para o grupo (I21l)', () => {
    const TIM_ANTERIOR = AGORA - 2 * 86_400_000;
    const anterior = (m: Montado) =>
        m.execucao({
            id: 'E_ANTERIOR',
            loteId: 'L0',
            flpCod: 49,
            remessaExecucaoId: 8,
            etapa: ETAPA_BORDERO_GRUPO.LIMPEZA_PENDENTE,
            borCod: 252,
            borTimCad: TIM_ANTERIOR,
        });

    it('limpeza de uma remessa anterior entregue à analista e o borderô segue em cadastro ⇒ retirar sem criar outro', async () => {
        const m = novo();
        anterior(m);
        m.borderoCompleto({ borCod: 252, borTimCad: TIM_ANTERIOR });
        const r = await m.service.preparar(m.pedido());
        expect(r).toMatchObject({
            desfecho: DESFECHO_PREPARACAO.RETIRAR,
            motivo: SYSTEM_REMOVAL_REASON.BORDERO_ANTERIOR_NAO_RESOLVIDO,
        });
        expect(r.borCod).toBeUndefined();
        semEscrita(m);
        expect(m.alertas).toHaveLength(1);
    });

    it('o mesmo borderô já cancelado ou ausente no Conexos ⇒ cria normalmente', async () => {
        const cancelado = novo();
        anterior(cancelado);
        cancelado.borderoCompleto({ borCod: 252, borTimCad: TIM_ANTERIOR, borVldFinalizado: 2 });
        expect((await cancelado.service.preparar(cancelado.pedido())).desfecho).toBe(
            DESFECHO_PREPARACAO.PRONTO,
        );
        const ausente = novo();
        anterior(ausente);
        expect((await ausente.service.preparar(ausente.pedido())).desfecho).toBe(
            DESFECHO_PREPARACAO.PRONTO,
        );
        expect(ausente.erp.baixa.criarBorderoDoGrupo).toHaveBeenCalledTimes(1);
    });
});

describe('BorderoGrupoBoletoService — conferirAntesDaEscrita (I21p(1), PI-5)', () => {
    const conferir = (m: Montado) =>
        m.service.conferirAntesDaEscrita({ lote: lotePedroni(), grupos: [grupoPedroni()] });
    const motivoDe = async (m: Montado): Promise<string | undefined> => {
        const err = await conferir(m).catch((e: unknown) => e);
        expect(err).toBeInstanceOf(GroupedBoletoNotEligibleAtRemittanceError);
        return (err as GroupedBoletoNotEligibleAtRemittanceError).details.grupos[0]?.motivo;
    };

    it('grupo elegível ao vivo ⇒ passa, só leitura', async () => {
        const m = novo();
        await expect(conferir(m)).resolves.toBeUndefined();
        expect(m.erp.sispag.lerValoresAberto).toHaveBeenCalledTimes(3);
        semEscrita(m);
        expect(m.ledger.repo.abrir).not.toHaveBeenCalled();
    });

    it('título pago ao vivo ⇒ GroupedBoletoNotEligibleAtRemittanceError (PAGO), zero escrita', async () => {
        const m = novo();
        m.erp.estado.titulos.set('38884', { pago: true, liberado: true, liquido: LIQUIDO });
        expect(await motivoDe(m)).toBe(MOTIVO_GRUPO_INELEGIVEL.PAGO);
        semEscrita(m);
    });

    it('título não liberado ao vivo ⇒ NAO_LIBERADO, zero escrita', async () => {
        const m = novo();
        m.erp.estado.titulos.set('38883', { pago: false, liberado: false, liquido: LIQUIDO });
        expect(await motivoDe(m)).toBe(MOTIVO_GRUPO_INELEGIVEL.NAO_LIBERADO);
        semEscrita(m);
    });

    it('soma pela régua líquida ao vivo ≠ boleto (±R$ 0,01) ⇒ SOMA_DIFERENTE', async () => {
        const m = novo();
        m.erp.estado.titulos.set('38885', { pago: false, liberado: true, liquido: 525.01 });
        expect(await motivoDe(m)).toBe(MOTIVO_GRUPO_INELEGIVEL.SOMA_DIFERENTE);
    });

    it('líquido ilegível no fin064 ⇒ VALOR_ABERTO_INDISPONIVEL (fail-closed)', async () => {
        const m = novo();
        m.erp.estado.titulos.set('38885', { pago: false, liberado: true });
        expect(await motivoDe(m)).toBe(MOTIVO_GRUPO_INELEGIVEL.VALOR_ABERTO_INDISPONIVEL);
    });

    it('boleto fora do pool ⇒ BOLETO_INDISPONIVEL; boleto com vínculo do ERP ⇒ BOLETO_VINCULADO_ERP', async () => {
        expect(await motivoDe(novo({ boletoNoPool: false }))).toBe(
            MOTIVO_GRUPO_INELEGIVEL.BOLETO_INDISPONIVEL,
        );
        expect(await motivoDe(novo({ boletoVinculadoErp: true }))).toBe(
            MOTIVO_GRUPO_INELEGIVEL.BOLETO_VINCULADO_ERP,
        );
    });

    it('par revogado ⇒ PAR_NAO_VIGENTE', async () => {
        expect(await motivoDe(novo({ parEstado: 'REVOGADA' }))).toBe(
            MOTIVO_GRUPO_INELEGIVEL.PAR_NAO_VIGENTE,
        );
    });
});

describe('BorderoGrupoBoletoService — limpar (I21q, emenda 2026-10-21)', () => {
    const TIM = AGORA - 58_000;
    const importada = (m: Montado, over: Partial<GrupoBoletoExecucao> = {}) => {
        m.borderoCompleto({ borCod: 251, borTimCad: TIM });
        m.erp.estado.itens.push({ borCod: 251, itsCodSeq: 7, itsMnyValor: 1575 });
        return m.execucao({
            etapa: ETAPA_BORDERO_GRUPO.RETIRADO,
            borCod: 251,
            borTimCad: TIM,
            itsCodSeq: 7,
            baixas: DOCS.map((d, i) => ({
                docCod: d,
                titCod: '1',
                bxaCodSeq: i + 1,
                valorCentavos: 52_500,
            })),
            ...over,
        });
    };

    it('ordem imposta pelo ERP (V3): DELETE do item → releitura → excluirBaixa × N → excluirBordero → releitura; sucesso = ausência observada', async () => {
        const m = novo();
        const e = importada(m);
        const r = await m.service.limpar({ execucao: e, motivo: 'GRUPO_BOLETO_FALHOU' });
        expect(r).toEqual({ desfecho: DESFECHO_LIMPEZA.LIMPO, execucaoId: e.id });
        emOrdem(m.trilha, [
            'erp.loteNativo',
            'erp.removerItem 7',
            'erp.lerItem 251',
            'erp.excluirBaixa 38883',
            'erp.excluirBaixa 38884',
            'erp.excluirBaixa 38885',
            'erp.excluirBordero 251',
            'erp.identidade 251',
            'ledger.etapa limpo',
        ]);
        expect(m.erp.estado.borderos).toHaveLength(0);
        expect(m.erp.estado.itens).toHaveLength(0);
        expect(m.eventos.map((x) => x.tipo)).toEqual([GRUPO_BOLETO_EVENTO.BORDERO_LIMPO]);
        expect(m.alertas).toHaveLength(0);
    });

    it('vldHasRemessaPgto = 1 com o lote nativo aberto não impede a limpeza (não é guarda, decisão 1)', async () => {
        const m = novo();
        const e = importada(m);
        const r = await m.service.limpar({ execucao: e, motivo: 'GRUPO_BOLETO_FALHOU' });
        expect(r.desfecho).toBe(DESFECHO_LIMPEZA.LIMPO);
        expect(m.erp.baixa.getBordero).not.toHaveBeenCalled();
    });

    it('lote nativo finalizado ⇒ nada excluído, limpeza_pendente + Alerta sispag-bordero-grupo-pendente', async () => {
        const m = novo();
        m.erp.estado.loteNativoStatus = 1;
        const e = importada(m);
        const r = await m.service.limpar({ execucao: e, motivo: 'GRUPO_BOLETO_FALHOU' });
        expect(r.desfecho).toBe(DESFECHO_LIMPEZA.PENDENTE);
        semEscrita(m);
        expect(etapaDe(m, e.id)).toBe(ETAPA_BORDERO_GRUPO.LIMPEZA_PENDENTE);
        expect(m.alertas).toEqual([
            expect.objectContaining({ tipo: ALERTA_TIPO.SISPAG_BORDERO_GRUPO_PENDENTE }),
        ]);
    });

    it('lote nativo com .REM gerado ⇒ nada excluído + Alerta', async () => {
        const m = novo();
        m.erp.estado.arquivosRemessa = [{ gabCod: 7 }];
        const e = importada(m);
        const r = await m.service.limpar({ execucao: e, motivo: 'GRUPO_BOLETO_FALHOU' });
        expect(r.desfecho).toBe(DESFECHO_LIMPEZA.PENDENTE);
        semEscrita(m);
        expect(m.alertas).toHaveLength(1);
    });

    it('estado do lote nativo ilegível ⇒ fail-closed: nada excluído + Alerta', async () => {
        const m = novo();
        m.erp.estado.loteNativoStatus = 'ilegivel';
        const e = importada(m);
        const r = await m.service.limpar({ execucao: e, motivo: 'GRUPO_BOLETO_FALHOU' });
        expect(r.desfecho).toBe(DESFECHO_LIMPEZA.PENDENTE);
        semEscrita(m);
        expect(m.alertas).toHaveLength(1);
    });

    it('borderô reaproveitado (I21s) ⇒ só o item nativo do lote novo sai; o borderô fica, com o Alerta', async () => {
        const m = novo();
        const e = importada(m, { borCodReaproveitadoDe: 'E_ANTIGA' });
        const r = await m.service.limpar({ execucao: e, motivo: 'GRUPO_BOLETO_FALHOU' });
        expect(r.desfecho).toBe(DESFECHO_LIMPEZA.PENDENTE);
        expect(m.erp.write.removerItemDoRascunho).toHaveBeenCalledTimes(1);
        semExclusao(m);
        expect(m.erp.estado.borderos.map((b) => b.borCod)).toEqual([251]);
        expect(m.alertas).toHaveLength(1);
    });

    it('releitura com o mesmo borCod e outro borTimCad (leitura (b)) ⇒ ausência observada: nada tocado, limpo', async () => {
        const m = novo();
        m.borderoCompleto({ borCod: 251, borTimCad: AGORA - 5_000, usnCodCad: 12 });
        const e = m.execucao({
            etapa: ETAPA_BORDERO_GRUPO.RETIRADO,
            borCod: 251,
            borTimCad: TIM,
        });
        const r = await m.service.limpar({ execucao: e, motivo: 'GRUPO_BOLETO_FALHOU' });
        expect(r.desfecho).toBe(DESFECHO_LIMPEZA.LIMPO);
        semEscrita(m);
        expect(m.erp.estado.borderos[0]?.baixas).toHaveLength(3);
    });

    it('nosso borderô cancelado por alguém no Conexos (achados T9) ⇒ nada excluído, pendente + Alerta', async () => {
        const m = novo();
        m.borderoCompleto({ borCod: 251, borTimCad: TIM, borVldFinalizado: 2 });
        const e = m.execucao({ etapa: ETAPA_BORDERO_GRUPO.RETIRADO, borCod: 251, borTimCad: TIM });
        const r = await m.service.limpar({ execucao: e, motivo: 'GRUPO_BOLETO_FALHOU' });
        expect(r.desfecho).toBe(DESFECHO_LIMPEZA.PENDENTE);
        semEscrita(m);
        expect(m.alertas).toHaveLength(1);
    });

    it('borderô já ausente ⇒ idempotente: limpo sem nova chamada de exclusão', async () => {
        const m = novo();
        const e = m.execucao({ etapa: ETAPA_BORDERO_GRUPO.RETIRADO, borCod: 251, borTimCad: TIM });
        const r = await m.service.limpar({ execucao: e, motivo: 'GRUPO_BOLETO_FALHOU' });
        expect(r.desfecho).toBe(DESFECHO_LIMPEZA.LIMPO);
        semEscrita(m);
    });

    it('falha transitória no excluirBordero ⇒ fecha (GroupBorderoIncompleteError), sem BORDERO_LIMPO; a retomada termina', async () => {
        const m = novo();
        m.erp.estado.timeoutExcluirBordero = true;
        const e = importada(m);
        await expect(
            m.service.limpar({ execucao: e, motivo: 'GRUPO_BOLETO_FALHOU' }),
        ).rejects.toBeInstanceOf(GroupBorderoIncompleteError);
        expect(etapaDe(m, e.id)).toBe(ETAPA_BORDERO_GRUPO.RETIRADO);
        expect(m.eventos).toHaveLength(0);
    });

    it('execução sem borderô nosso (simulado / indeterminado / já limpa) ⇒ nada a limpar, zero chamada ao ERP', async () => {
        for (const etapa of [
            ETAPA_BORDERO_GRUPO.SIMULADO,
            ETAPA_BORDERO_GRUPO.INDETERMINADO,
            ETAPA_BORDERO_GRUPO.LIMPO,
        ]) {
            const m = novo();
            const e = m.execucao({ etapa, borCod: 251, borTimCad: TIM });
            const r = await m.service.limpar({ execucao: e, motivo: 'LOTE_CANCELADO' });
            expect(r.desfecho).toBe(DESFECHO_LIMPEZA.NADA_A_LIMPAR);
            semEscrita(m);
            expect(m.erp.write.getLoteNativo).not.toHaveBeenCalled();
        }
    });

    it('kill-switch desligado (sispagLiveWriteEnabled=false) ⇒ nada excluído + Alerta (o borderô fica para a analista)', async () => {
        const m = novo({ env: { sispagLiveWriteEnabled: false } });
        const e = importada(m);
        const r = await m.service.limpar({ execucao: e, motivo: 'LOTE_CANCELADO' });
        expect(r.desfecho).toBe(DESFECHO_LIMPEZA.PENDENTE);
        semEscrita(m);
        expect(m.alertas).toHaveLength(1);
    });
});

describe('BorderoGrupoBoletoService — chavesNativasConfirmadas (I21s, Task 15)', () => {
    const TIM = AGORA - 58_000;
    const chaves = (m: Montado) =>
        m.service.chavesNativasConfirmadas({ lote: lotePedroni(), grupos: [grupoPedroni()] });

    it('execução deste lote com borCod + borTimCad e o borderô presente com o mesmo borTimCad ⇒ chave nativa `fil:bor:borCod`', async () => {
        const m = novo();
        m.borderoCompleto({ borCod: 251, borTimCad: TIM });
        m.execucao({ etapa: ETAPA_BORDERO_GRUPO.IMPORTADO, borCod: 251, borTimCad: TIM });
        expect(await chaves(m)).toEqual(new Map([['G1', `${FIL}:bor:251`]]));
        semEscrita(m);
    });

    it('execução que falhou depois do import (failed) também é reconhecida: o item pode estar no rascunho', async () => {
        const m = novo();
        m.borderoCompleto({ borCod: 251, borTimCad: TIM });
        m.execucao({ etapa: ETAPA_BORDERO_GRUPO.FAILED, borCod: 251, borTimCad: TIM });
        expect((await chaves(m)).get('G1')).toBe(`${FIL}:bor:251`);
    });

    it('o ERP reusou o borCod (outro borTimCad) ⇒ o borderô é alheio: nenhuma chave', async () => {
        const m = novo();
        m.borderoCompleto({ borCod: 251, borTimCad: TIM + 5_000 });
        m.execucao({ etapa: ETAPA_BORDERO_GRUPO.IMPORTADO, borCod: 251, borTimCad: TIM });
        expect((await chaves(m)).size).toBe(0);
    });

    it('borderô ausente no ERP ⇒ nenhuma chave', async () => {
        const m = novo();
        m.execucao({ etapa: ETAPA_BORDERO_GRUPO.IMPORTADO, borCod: 251, borTimCad: TIM });
        expect((await chaves(m)).size).toBe(0);
    });

    it('execução de OUTRO lote não vale para este (o item de borderô de lote antigo é estranho)', async () => {
        const m = novo();
        m.borderoCompleto({ borCod: 251, borTimCad: TIM });
        m.execucao({
            loteId: 'L0',
            etapa: ETAPA_BORDERO_GRUPO.IMPORTADO,
            borCod: 251,
            borTimCad: TIM,
        });
        expect((await chaves(m)).size).toBe(0);
    });

    it('execução limpa ou simulada não tem borderô nosso: nenhuma chave e nenhuma leitura ao ERP', async () => {
        const limpa = novo();
        limpa.execucao({ etapa: ETAPA_BORDERO_GRUPO.LIMPO, borCod: 251, borTimCad: TIM });
        expect((await chaves(limpa)).size).toBe(0);
        const simulada = novo();
        simulada.execucao({ etapa: ETAPA_BORDERO_GRUPO.SIMULADO });
        expect((await chaves(simulada)).size).toBe(0);
        expect(limpa.erp.baixa.buscarBorderoPorIdentidade).not.toHaveBeenCalled();
    });

    it('grupo sem execução ⇒ nenhuma chave', async () => {
        const m = novo();
        expect((await chaves(m)).size).toBe(0);
    });
});
