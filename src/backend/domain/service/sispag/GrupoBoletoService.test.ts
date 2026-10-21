import 'reflect-metadata';
import GroupedBoletoCrossBranchError from '../../errors/GroupedBoletoCrossBranchError.js';
import GroupedBoletoDueWindowError from '../../errors/GroupedBoletoDueWindowError.js';
import GroupedBoletoNotConfirmableError from '../../errors/GroupedBoletoNotConfirmableError.js';
import GroupedBoletoNotFoundError from '../../errors/GroupedBoletoNotFoundError.js';
import GroupedBoletoStateConflictError from '../../errors/GroupedBoletoStateConflictError.js';
import GroupedBoletoSumMismatchError from '../../errors/GroupedBoletoSumMismatchError.js';
import GroupedBoletoTitleIneligibleError from '../../errors/GroupedBoletoTitleIneligibleError.js';
import InvalidDecisionActorError from '../../errors/InvalidDecisionActorError.js';
import IssuerConfirmationReasonRequiredError from '../../errors/IssuerConfirmationReasonRequiredError.js';
import WarningAcknowledgementRequiredError from '../../errors/WarningAcknowledgementRequiredError.js';
import type { BoletoDda } from '../../interface/sispag/BoletoDda.js';
import type {
    ConfirmacaoEmissor,
    DecisaoSugestao,
} from '../../interface/sispag/ConfirmacaoEmissorBoleto.js';
import {
    type ChaveTituloGrupo,
    GRUPO_BOLETO_ESTADO,
    type GrupoBoleto,
    MOTIVO_GRUPO_INELEGIVEL as M,
    type NovoGrupoBoleto,
} from '../../interface/sispag/GrupoBoletoInterface.js';
import type { TituloAPagar } from '../../interface/sispag/SispagInterface.js';
import { ETAPA_BORDERO_GRUPO } from '../../libs/boleto/EtapaBorderoGrupo.js';
import ValorAbertoLiquido, {
    type ValoresAbertoTitulo,
} from '../../libs/boleto/ValorAbertoLiquido.js';
import CodigoBarrasBoleto from '../../libs/boleto/CodigoBarrasBoleto.js';
import BankingCalendar from '../../libs/calendar/BankingCalendar.js';
import F from './__fixtures__/grupoBoleto.js';
import GrupoBoletoService from './GrupoBoletoService.js';
import MotorGrupoBoleto from './MotorGrupoBoleto.js';
import RegraGrupoBoleto from './RegraGrupoBoleto.js';

const HOJE = new Date('2026-10-20T15:00:00Z');
const calendar = BankingCalendar.withClock(() => HOJE);
const codigoBarras = new CodigoBarrasBoleto();
const regra = new RegraGrupoBoleto(codigoBarras);
const motor = new MotorGrupoBoleto(codigoBarras, calendar, regra);

const chave = (t: { filCod: number; docCod: string; titCod: string }): string =>
    `${t.filCod}:${t.docCod}:${t.titCod}`;
const chaves = (ts: Array<{ filCod: number; docCod: string; titCod: string }>) =>
    ts.map((t) => ({ filCod: t.filCod, docCod: t.docCod, titCod: t.titCod }));

const emissorDe = (b: BoletoDda): string => codigoBarras.emissor(b.codbar)?.chave ?? '';

const par = (b: BoletoDda, pesCod: string, id = 'par-1'): ConfirmacaoEmissor => ({
    id,
    pesCod,
    emissorChave: emissorDe(b),
    layoutEmissor: 'GENERICO',
    bancoEmissor: '341',
    emissorMascarado: '341 / *** / ***1',
    estado: 'VIGENTE',
    evidencia: {},
    confirmadoPor: 'ana',
    confirmadoEm: '2026-10-19T10:00:00.000Z',
    versao: 1,
});

const decisao = (
    over: Partial<DecisaoSugestao> & { filCod: number; docCod: string; titCod: string },
): DecisaoSugestao =>
    ({
        id: `dec-${over.docCod}`,
        pesCod: '9001',
        ddcCod: 1,
        ditCod: 1,
        codbarMascarado: '34191…0001',
        valorTitulo: 525,
        vencimentoTitulo: '2026-10-21',
        valorBoleto: 525,
        vencimentoBoleto: '2026-10-21',
        deltaValor: 0,
        deltaPercentual: 0,
        deltaDias: 0,
        sinais: [],
        tier: 'FORTE',
        emissorChave: 'x',
        decisao: 'CONFIRMADA',
        decididoPor: 'ana',
        decididoEm: '2026-10-19T10:00:00.000Z',
        versao: 1,
        ...over,
    }) as DecisaoSugestao;

interface LoteFake {
    id: string;
    status: string;
    itens: Array<ChaveTituloGrupo & { grupoBoletoId?: string; divergencia: boolean }>;
}

interface Cenario {
    titulos: TituloAPagar[];
    boletos: BoletoDda[];
    pares: ConfirmacaoEmissor[];
    decisoes: DecisaoSugestao[];
    grupos: GrupoBoleto[];
    marcas: ChaveTituloGrupo[];
    lotes: LoteFake[];
    /** Valores do `fin064` por chave; ausente = `semAcrescimos(valor)`; `null` = ilegível. */
    fin064: Map<string, ValoresAbertoTitulo | null>;
    execucoes: Map<string, Array<{ etapa: string; criadoEm: Date; jRejeitadoEm?: Date }>>;
}

const montar = (over: Partial<Cenario> = {}) => {
    const cen: Cenario = {
        titulos: [],
        boletos: [],
        pares: [],
        decisoes: [],
        grupos: [],
        marcas: [],
        lotes: [],
        fin064: new Map(),
        execucoes: new Map(),
        ...over,
    };
    /** Ordem das chamadas que importam para o anti-TOCTOU. */
    const ordem: string[] = [];
    const tx = { nome: 'tx' };
    const eventosSugestao: Array<Record<string, unknown>> = [];
    let seq = 0;

    const grupoPorTitulo = (c: ChaveTituloGrupo) =>
        cen.grupos.find(
            (g) =>
                g.estado === GRUPO_BOLETO_ESTADO.CONFIRMADO &&
                g.titulos.some((t) => chave(t) === chave(c)),
        ) ?? null;

    const grupos = {
        travar: jest.fn(async (_t: unknown, ks: readonly string[]) => {
            ordem.push(`travar:${[...ks].sort().join(',')}`);
        }),
        buscarConfirmadoPorBoleto: jest.fn(
            async (ddcCod: number, ditCod: number) =>
                cen.grupos.find(
                    (g) =>
                        g.estado === GRUPO_BOLETO_ESTADO.CONFIRMADO &&
                        g.ddcCod === ddcCod &&
                        g.ditCod === ditCod,
                ) ?? null,
        ),
        buscarConfirmadoPorTitulo: jest.fn(async (c: ChaveTituloGrupo) => grupoPorTitulo(c)),
        buscarPorId: jest.fn(async (id: string) => cen.grupos.find((g) => g.id === id) ?? null),
        listarConfirmados: jest.fn(async (f: { filCod?: number } = {}) =>
            cen.grupos.filter(
                (g) =>
                    g.estado === GRUPO_BOLETO_ESTADO.CONFIRMADO &&
                    (f.filCod === undefined || g.filCod === f.filCod),
            ),
        ),
        listarConfirmadosDoPar: jest.fn(async (parId: string) =>
            cen.grupos.filter(
                (g) =>
                    g.estado === GRUPO_BOLETO_ESTADO.CONFIRMADO && g.confirmacaoEmissorId === parId,
            ),
        ),
        inserirConfirmado: jest.fn(async (n: NovoGrupoBoleto, _t?: unknown) => {
            ordem.push('inserir');
            const existente = cen.grupos.find(
                (g) =>
                    g.estado === GRUPO_BOLETO_ESTADO.CONFIRMADO &&
                    g.ddcCod === n.ddcCod &&
                    g.ditCod === n.ditCod,
            );
            if (existente) return { criado: false, grupo: existente };
            seq += 1;
            const grupo: GrupoBoleto = {
                ...n,
                id: `grupo-${seq}`,
                somaTitulosCentavos: n.titulos.reduce((s, t) => s + t.valorLiquidoCentavos, 0),
                estado: GRUPO_BOLETO_ESTADO.CONFIRMADO,
                confirmadoEm: HOJE,
                versao: 1,
            };
            cen.grupos.push(grupo);
            return { criado: true, grupo };
        }),
        anular: jest.fn(
            async (
                i: { grupoId: string; motivo: string; tipoAnulacao: string; ator: string },
                _t?: unknown,
            ) => {
                ordem.push(`anular:${i.grupoId}`);
                const g = cen.grupos.find((x) => x.id === i.grupoId);
                if (!g) return { resultado: 'NAO_ENCONTRADO' };
                if (g.estado === GRUPO_BOLETO_ESTADO.ANULADO) {
                    return { resultado: 'JA_APLICADO', grupo: g };
                }
                if (g.estado !== GRUPO_BOLETO_ESTADO.CONFIRMADO) {
                    return { resultado: 'RECUSADO', grupo: g };
                }
                Object.assign(g, {
                    estado: GRUPO_BOLETO_ESTADO.ANULADO,
                    anuladoPor: i.ator,
                    motivoAnulacao: i.motivo,
                    tipoAnulacao: i.tipoAnulacao,
                });
                return { resultado: 'APLICADO', grupo: g };
            },
        ),
    };
    const execucoes = {
        listarPorGrupo: jest.fn(async (id: string) => cen.execucoes.get(id) ?? []),
    };
    const titulos = {
        listAtivos: jest.fn(async () => cen.titulos.filter((t) => t.ativo !== false)),
        buscarPorChave: jest.fn(async (c: ChaveTituloGrupo) => {
            ordem.push(`titulo:${c.docCod}`);
            return cen.titulos.find((t) => chave(t) === chave(c)) ?? null;
        }),
    };
    const boletos = {
        listBoletos: jest.fn(async () => cen.boletos),
        buscarPorChave: jest.fn(async (c: { ddcCod: number; ditCod: number }) => {
            ordem.push('boleto');
            return cen.boletos.find((b) => b.ddcCod === c.ddcCod && b.ditCod === c.ditCod) ?? null;
        }),
    };
    const sugestoes = {
        listarParesVigentes: jest.fn(async () => cen.pares.filter((p) => p.estado === 'VIGENTE')),
        listarChaveadas: jest.fn(async (d: string) => cen.decisoes.filter((x) => x.decisao === d)),
        listarDecisoes: jest.fn(
            async (f: {
                decisao?: string;
                filCod?: number;
                docCod?: string;
                titCod?: string;
                ddcCod?: number;
                ditCod?: number;
            }) =>
                cen.decisoes.filter(
                    (d) =>
                        (f.decisao === undefined || d.decisao === f.decisao) &&
                        (f.filCod === undefined || d.filCod === f.filCod) &&
                        (f.docCod === undefined || d.docCod === f.docCod) &&
                        (f.titCod === undefined || d.titCod === f.titCod) &&
                        (f.ddcCod === undefined || d.ddcCod === f.ddcCod) &&
                        (f.ditCod === undefined || d.ditCod === f.ditCod),
                ),
        ),
        buscarParVigente: jest.fn(
            async (pesCod: string, emissorChave: string, _t?: unknown, _travar?: boolean) =>
                cen.pares.find(
                    (p) =>
                        p.pesCod === pesCod &&
                        p.emissorChave === emissorChave &&
                        p.estado === 'VIGENTE',
                ) ?? null,
        ),
        inserirPar: jest.fn(async (n: { pesCod: string; emissorChave: string }) => {
            const p = { ...par(F.boleto(), n.pesCod, 'par-novo'), emissorChave: n.emissorChave };
            cen.pares.push(p);
            return { criado: true, par: p };
        }),
        inserirEvento: jest.fn(async (e: Record<string, unknown>) => {
            eventosSugestao.push(e);
            return 'ev';
        }),
    };
    const bloqueios = {
        listAtivos: jest.fn(async () =>
            cen.marcas.map((m, i) => ({ id: `b${i}`, ...m, estado: 'ATIVO' })),
        ),
        findAtivo: jest.fn(async (c: ChaveTituloGrupo) =>
            cen.marcas.some((m) => chave(m) === chave(c)) ? { id: 'b', ...c } : null,
        ),
        encerrarDoGrupo: jest.fn(async () => 0),
    };
    const loteDoTitulo = (c: ChaveTituloGrupo, status: string[]) =>
        cen.lotes.find(
            (l) => status.includes(l.status) && l.itens.some((i) => chave(i) === chave(c)),
        );
    const lotes = {
        listTitulosEmLotesComprometidos: jest.fn(async () =>
            cen.lotes
                .filter((l) => ['FINALIZADO', 'REMESSA_GERADA'].includes(l.status))
                .flatMap((l) =>
                    l.itens.map((i) => ({ ...chaves([i])[0], id: l.id, status: l.status })),
                ),
        ),
        listTitulosEmLotesAbertos: jest.fn(async () =>
            cen.lotes
                .filter((l) => l.status !== 'CANCELADO')
                .flatMap((l) =>
                    l.itens.map((i) => ({ ...chaves([i])[0], loteId: l.id, status: l.status })),
                ),
        ),
        loteComprometidoComTitulo: jest.fn(async (c: ChaveTituloGrupo) => {
            const l = loteDoTitulo(c, ['FINALIZADO', 'REMESSA_GERADA']);
            return l ? { loteId: l.id, status: l.status } : null;
        }),
        loteRascunhoComTitulo: jest.fn(
            async (c: ChaveTituloGrupo) => loteDoTitulo(c, ['RASCUNHO'])?.id ?? null,
        ),
        removerGrupo: jest.fn(async (i: { loteId: string; grupoId: string }) => {
            ordem.push(`removerGrupo:${i.loteId}`);
            const l = cen.lotes.find((x) => x.id === i.loteId);
            if (!l) return 'AUSENTE';
            const antes = l.itens.length;
            l.itens = l.itens.filter((x) => x.grupoBoletoId !== i.grupoId);
            return l.itens.length < antes ? 'APLICADO' : 'AUSENTE';
        }),
        getLoteComItens: jest.fn(async (id: string) => {
            const l = cen.lotes.find((x) => x.id === id);
            return l ? { id: l.id, status: l.status, itens: l.itens } : null;
        }),
    };
    const sispag = {
        lerValoresAberto: jest.fn(async (filCod: number, docCod: string, titCod: string) => {
            ordem.push(`fin064:${docCod}`);
            const k = chave({ filCod, docCod, titCod });
            const forcado = cen.fin064.get(k);
            if (forcado === null) return { legivel: false, motivo: 'falha' };
            const t = cen.titulos.find((x) => chave(x) === k);
            const valores = forcado ?? ValorAbertoLiquido.semAcrescimos(t?.valor);
            return valores ? { legivel: true, valores } : { legivel: false, motivo: 'ausente' };
        }),
    };
    const db = {
        withTransaction: jest.fn(async (fn: (t: unknown) => unknown) => {
            ordem.push('tx');
            return fn(tx);
        }),
    };
    const logService = {
        info: jest.fn().mockResolvedValue(undefined),
        warn: jest.fn().mockResolvedValue(undefined),
    };
    const cache = { invalidar: jest.fn() };
    const service = new GrupoBoletoService(
        grupos as never,
        execucoes as never,
        titulos as never,
        boletos as never,
        sugestoes as never,
        bloqueios as never,
        lotes as never,
        sispag as never,
        motor,
        regra,
        codigoBarras,
        calendar,
        db as never,
        logService as never,
        cache as never,
    );
    return {
        service,
        cen,
        ordem,
        tx,
        grupos,
        titulos,
        boletos,
        sugestoes,
        bloqueios,
        lotes,
        sispag,
        db,
        logService,
        cache,
        eventosSugestao,
    };
};

const pedroni = (over: Partial<Cenario> = {}) => {
    const p = F.pedroni();
    return montar({ titulos: p.titulos, boletos: p.boletos, ...over });
};

const confirmarPedroni = (h: ReturnType<typeof montar>, over: Record<string, unknown> = {}) =>
    h.service.confirmar({
        origem: 'SUGERIDO',
        ddcCod: 900,
        ditCod: 332841,
        titulos: chaves(h.cen.titulos.slice(0, 3)),
        ator: 'ana',
        ...over,
    });

/** Nenhuma linha completa (44/47 dígitos) em nada que o serviço logou. */
const semCodigoNosLogs = (h: ReturnType<typeof montar>): void => {
    const tudo = JSON.stringify([h.logService.info.mock.calls, h.logService.warn.mock.calls]);
    expect(tudo).not.toMatch(/\d{44}/);
    for (const b of h.cen.boletos) expect(tudo).not.toContain(b.codbar);
};

const grupoConfirmado = (over: Partial<GrupoBoleto> = {}): GrupoBoleto => ({
    id: 'g1',
    filCod: 2,
    pesCod: '9001',
    credor: 'PEDRONI',
    emissorChave: 'x',
    ddcCod: 900,
    ditCod: 332841,
    codbarMascarado: '34191…0001',
    valorBoletoCentavos: 157500,
    vencimentoBoleto: '2026-10-21',
    titulos: ['38883', '38884', '38885'].map((docCod) => ({
        filCod: 2,
        docCod,
        titCod: '1',
        valorLiquidoCentavos: 52500,
        vencimento: '2026-10-21',
    })),
    somaTitulosCentavos: 157500,
    origem: 'SUGERIDO',
    intercambiavel: false,
    avisosReconhecidos: [],
    confirmacaoEmissorId: 'par-1',
    estado: GRUPO_BOLETO_ESTADO.CONFIRMADO,
    confirmadoPor: 'ana',
    confirmadoEm: HOJE,
    versao: 1,
    ...over,
});

// ── sugerir ────────────────────────────────────────────────────────────────────────────────────

describe('GrupoBoletoService.sugerir (I21e/f, PI-7)', () => {
    it('PEDRONI: uma sugestão confirmável, só leitura local (zero Conexos, nada persistido)', async () => {
        const h = pedroni();
        const r = await h.service.sugerir({});
        expect(r).toHaveLength(1);
        expect(r[0]).toMatchObject({
            ditCod: 332841,
            confirmavel: true,
            valorBoletoCentavos: 157500,
        });
        expect(r[0]?.titulos.map((t) => t.docCod)).toEqual(['38883', '38884', '38885']);
        expect(h.sispag.lerValoresAberto).not.toHaveBeenCalled();
        expect(h.db.withTransaction).not.toHaveBeenCalled();
        expect(h.grupos.inserirConfirmado).not.toHaveBeenCalled();
        expect(JSON.stringify(r)).not.toMatch(/\d{44}/);
    });

    it('filtra por filial', async () => {
        const h = pedroni();
        expect(await h.service.sugerir({ filCod: 1 })).toEqual([]);
        expect(await h.service.sugerir({ filCod: 2 })).toHaveLength(1);
    });

    it('leitura que falha não vira "sem grupo": o erro sobe', async () => {
        const h = pedroni();
        h.titulos.listAtivos.mockRejectedValueOnce(new Error('banco fora'));
        await expect(h.service.sugerir({})).rejects.toThrow('banco fora');
    });

    it('título em alçada: sugestão exibida, não confirmável, motivo NAO_LIBERADO', async () => {
        const p = F.pedroni();
        const titulos = p.titulos.map((t, i) => (i === 1 ? { ...t, liberado: false } : t));
        const h = montar({ titulos, boletos: p.boletos });
        const [s] = await h.service.sugerir({});
        expect(s).toMatchObject({ confirmavel: false, motivo: M.NAO_LIBERADO });
    });

    it('título em lote comprometido entra no conjunto e barra a confirmação (EM_LOTE_COMPROMETIDO)', async () => {
        const h = pedroni({
            lotes: [
                {
                    id: 'L-fin',
                    status: 'FINALIZADO',
                    itens: [{ filCod: 2, docCod: '38884', titCod: '1', divergencia: false }],
                },
            ],
        });
        const [s] = await h.service.sugerir({});
        expect(s?.confirmavel).toBe(false);
        expect(s?.motivos).toContain(M.EM_LOTE_COMPROMETIDO);
    });

    it('título com marca ativa ⇒ MARCA_RETENCAO_ATIVA; boleto de grupo confirmado não é candidato', async () => {
        const h = pedroni({ marcas: [{ filCod: 2, docCod: '38883', titCod: '1' }] });
        const [s] = await h.service.sugerir({});
        expect(s?.motivos).toContain(M.MARCA_RETENCAO_ATIVA);
        const h2 = pedroni({ grupos: [grupoConfirmado({ titulos: [] })] });
        expect(await h2.service.sugerir({})).toEqual([]);
    });
});

// ── confirmar ──────────────────────────────────────────────────────────────────────────────────

describe('GrupoBoletoService.confirmar (I21a–d/g/h/i, anti-TOCTOU, G1)', () => {
    it('PEDRONI sugerido → confirmado: fin064 antes da transação, travas antes da releitura, snapshot líquido, par criado VIGENTE', async () => {
        const h = pedroni();
        const r = await confirmarPedroni(h);
        expect(r.criado).toBe(true);
        expect(r.grupo).toMatchObject({
            filCod: 2,
            pesCod: '9001',
            ddcCod: 900,
            ditCod: 332841,
            valorBoletoCentavos: 157500,
            vencimentoBoleto: '2026-10-21',
            origem: 'SUGERIDO',
            intercambiavel: false,
            confirmadoPor: 'ana',
            confirmacaoEmissorId: 'par-novo',
        });
        expect(r.grupo.titulos.map((t) => t.valorLiquidoCentavos)).toEqual([52500, 52500, 52500]);
        expect(r.grupo.codbarMascarado).toMatch(/^\d{5}…\d{4}$/);

        // G1: os 3 fin064 ANTES de abrir a transação; travas ANTES de reler boleto e títulos.
        const iTx = h.ordem.indexOf('tx');
        const fin064 = h.ordem.filter((o) => o.startsWith('fin064:'));
        expect(fin064).toHaveLength(3);
        for (const f of fin064) expect(h.ordem.indexOf(f)).toBeLessThan(iTx);
        const iTravar = h.ordem.findIndex((o) => o.startsWith('travar:'));
        expect(iTravar).toBeGreaterThan(iTx);
        expect(h.ordem.indexOf('boleto')).toBeGreaterThan(iTravar);
        expect(h.ordem.indexOf('titulo:38883')).toBeGreaterThan(iTravar);
        expect(h.ordem.indexOf('inserir')).toBeGreaterThan(iTravar);
        expect(h.ordem[iTravar]).toBe(
            'travar:sispag:boleto:900:332841,sispag:titulo:2:38883:1,sispag:titulo:2:38884:1,sispag:titulo:2:38885:1',
        );

        // Par criado no mesmo ato, com evento PAR_CONFIRMADO, na mesma transação.
        expect(h.sugestoes.inserirPar).toHaveBeenCalledWith(
            expect.objectContaining({ pesCod: '9001', confirmadoPor: 'ana' }),
            h.tx,
        );
        expect(h.eventosSugestao).toEqual([
            expect.objectContaining({ tipo: 'PAR_CONFIRMADO', ator: 'ana', pesCod: '9001' }),
        ]);
        expect(h.grupos.inserirConfirmado).toHaveBeenCalledWith(expect.anything(), h.tx);
        expect(h.cache.invalidar).toHaveBeenCalled();
        expect(h.logService.info).toHaveBeenCalledWith(
            expect.objectContaining({ message: 'grupo de boleto confirmado' }),
        );
        semCodigoNosLogs(h);
    });

    it('par VIGENTE existente é reutilizado (no-op no par)', async () => {
        const p = F.pedroni();
        const b = p.boletos[0] as BoletoDda;
        const h = montar({ titulos: p.titulos, boletos: p.boletos, pares: [par(b, '9001')] });
        const r = await confirmarPedroni(h);
        expect(r.grupo.confirmacaoEmissorId).toBe('par-1');
        expect(h.sugestoes.inserirPar).not.toHaveBeenCalled();
        expect(h.sugestoes.buscarParVigente).toHaveBeenCalledWith('9001', emissorDe(b), h.tx, true);
    });

    it.each(['sistema', 'SISTEMA', '', 'unknown'])('ator "%s" é recusado (I21i)', async (ator) => {
        const h = pedroni();
        await expect(confirmarPedroni(h, { ator })).rejects.toBeInstanceOf(
            InvalidDecisionActorError,
        );
        expect(h.grupos.inserirConfirmado).not.toHaveBeenCalled();
    });

    it('idempotência: confirmar de novo o mesmo conjunto devolve o existente, sem ler o Conexos', async () => {
        const h = pedroni();
        const a = await confirmarPedroni(h);
        h.sispag.lerValoresAberto.mockClear();
        const b = await confirmarPedroni(h);
        expect(b).toEqual({ criado: false, grupo: a.grupo });
        expect(h.sispag.lerValoresAberto).not.toHaveBeenCalled();
        expect(h.cen.grupos).toHaveLength(1);
    });

    it('corrida: o grupo aparece entre a pré-checagem e o lock ⇒ devolve o vencedor sob o lock, sem gravar', async () => {
        const h = pedroni();
        const vencedor = grupoConfirmado({ id: 'g-vencedor' });
        h.grupos.buscarConfirmadoPorBoleto
            .mockResolvedValueOnce(null)
            .mockResolvedValueOnce(vencedor);
        const r = await confirmarPedroni(h);
        expect(r).toEqual({ criado: false, grupo: vencedor });
        expect(h.grupos.buscarConfirmadoPorBoleto).toHaveBeenLastCalledWith(900, 332841, h.tx);
        expect(h.grupos.inserirConfirmado).not.toHaveBeenCalled();
        expect(h.sugestoes.inserirPar).not.toHaveBeenCalled();
    });

    it.each([
        ['+R$ 0,01', 525.01, -1],
        ['−R$ 0,01', 524.99, 1],
    ])('líquido ao vivo %s num título ⇒ GroupedBoletoSumMismatchError (Δ %d centavo)', async (_r, liquido, delta) => {
        const h = pedroni({
            fin064: new Map([
                [
                    '2:38884:1',
                    {
                        totalLiquido: liquido,
                        totalPago: 0,
                        totalAberto: liquido,
                        titMnyJuros: 0,
                        titMnyDesconto: 0,
                    },
                ],
            ]),
        });
        const erro = await confirmarPedroni(h).catch((e: unknown) => e);
        expect(erro).toBeInstanceOf(GroupedBoletoSumMismatchError);
        expect((erro as GroupedBoletoSumMismatchError).details.deltaCentavos).toBe(delta);
        expect(h.grupos.inserirConfirmado).not.toHaveBeenCalled();
    });

    it('fin064 ilegível num título ⇒ VALOR_ABERTO_INDISPONIVEL (fail-closed)', async () => {
        const h = pedroni({ fin064: new Map([['2:38885:1', null]]) });
        const erro = await confirmarPedroni(h).catch((e: unknown) => e);
        expect(erro).toBeInstanceOf(GroupedBoletoTitleIneligibleError);
        expect((erro as GroupedBoletoTitleIneligibleError).details.titulos).toEqual([
            { filCod: 2, docCod: '38885', titCod: '1', motivo: M.VALOR_ABERTO_INDISPONIVEL },
        ]);
    });

    it('dois credores (manual) ⇒ GroupedBoletoNotConfirmableError CREDORES_DIFERENTES', async () => {
        const p = F.pedroni();
        const titulos = p.titulos.map((t, i) => (i === 2 ? { ...t, pesCod: '9999' } : t));
        const h = montar({ titulos, boletos: p.boletos });
        const erro = await confirmarPedroni(h, { origem: 'MANUAL' }).catch((e: unknown) => e);
        expect(erro).toBeInstanceOf(GroupedBoletoNotConfirmableError);
        expect((erro as GroupedBoletoNotConfirmableError).details.motivos).toContain(
            M.CREDORES_DIFERENTES,
        );
    });

    it('títulos de outra filial ⇒ GroupedBoletoCrossBranchError', async () => {
        const p = F.pedroni();
        const titulos = p.titulos.map((t, i) => (i === 2 ? { ...t, filCod: 3 } : t));
        const h = montar({ titulos, boletos: p.boletos });
        await expect(confirmarPedroni(h, { origem: 'MANUAL' })).rejects.toBeInstanceOf(
            GroupedBoletoCrossBranchError,
        );
    });

    it('título em alçada (sugerido exibido, não confirmável) ⇒ GroupedBoletoTitleIneligibleError NAO_LIBERADO', async () => {
        const p = F.pedroni();
        const titulos = p.titulos.map((t, i) => (i === 0 ? { ...t, liberado: false } : t));
        const h = montar({ titulos, boletos: p.boletos });
        const erro = await confirmarPedroni(h).catch((e: unknown) => e);
        expect(erro).toBeInstanceOf(GroupedBoletoTitleIneligibleError);
        expect((erro as GroupedBoletoTitleIneligibleError).details.titulos).toEqual([
            { filCod: 2, docCod: '38883', titCod: '1', motivo: M.NAO_LIBERADO },
        ]);
    });

    it('título em outro grupo confirmado (manual) ⇒ EM_OUTRO_GRUPO', async () => {
        const outro = grupoConfirmado({
            id: 'g-outro',
            ditCod: 1,
            titulos: [
                {
                    filCod: 2,
                    docCod: '38883',
                    titCod: '1',
                    valorLiquidoCentavos: 52500,
                    vencimento: '2026-10-21',
                },
            ],
        });
        const h = pedroni({ grupos: [outro] });
        const erro = await confirmarPedroni(h, { origem: 'MANUAL' }).catch((e: unknown) => e);
        expect(erro).toBeInstanceOf(GroupedBoletoTitleIneligibleError);
        expect((erro as GroupedBoletoTitleIneligibleError).details.titulos).toEqual([
            { filCod: 2, docCod: '38883', titCod: '1', motivo: M.EM_OUTRO_GRUPO },
        ]);
    });

    it('título com decisão 1:1 confirmada ⇒ DECISAO_1_1_CONFIRMADA (exclusividade I15q)', async () => {
        const h = pedroni({ decisoes: [decisao({ filCod: 2, docCod: '38884', titCod: '1' })] });
        const erro = await confirmarPedroni(h, { origem: 'MANUAL' }).catch((e: unknown) => e);
        expect(erro).toBeInstanceOf(GroupedBoletoTitleIneligibleError);
        expect((erro as GroupedBoletoTitleIneligibleError).details.titulos).toEqual([
            { filCod: 2, docCod: '38884', titCod: '1', motivo: M.DECISAO_1_1_CONFIRMADA },
        ]);
    });

    it('boleto com decisão 1:1 confirmada para outro título ⇒ BOLETO_EM_DECISAO_1_1', async () => {
        const h = pedroni({
            decisoes: [
                decisao({ filCod: 2, docCod: '777', titCod: '1', ddcCod: 900, ditCod: 332841 }),
            ],
        });
        const erro = await confirmarPedroni(h, { origem: 'MANUAL' }).catch((e: unknown) => e);
        expect(erro).toBeInstanceOf(GroupedBoletoNotConfirmableError);
        expect((erro as GroupedBoletoNotConfirmableError).details.motivos).toEqual([
            M.BOLETO_EM_DECISAO_1_1,
        ]);
    });

    it('anti-TOCTOU: título pago depois da sugestão ⇒ recusado na releitura (nunca do cache)', async () => {
        const h = pedroni();
        expect(await h.service.sugerir({})).toHaveLength(1);
        const t = h.cen.titulos[1] as TituloAPagar;
        t.pago = true;
        const erro = await confirmarPedroni(h, { origem: 'MANUAL' }).catch((e: unknown) => e);
        expect(erro).toBeInstanceOf(GroupedBoletoTitleIneligibleError);
        expect((erro as GroupedBoletoTitleIneligibleError).details.titulos[0]?.motivo).toBe(M.PAGO);
    });

    it('boleto que saiu do pool ⇒ GroupedBoletoNotConfirmableError BOLETO_INDISPONIVEL', async () => {
        const h = pedroni();
        h.cen.boletos = [];
        const erro = await confirmarPedroni(h, { origem: 'MANUAL' }).catch((e: unknown) => e);
        expect(erro).toBeInstanceOf(GroupedBoletoNotConfirmableError);
        expect((erro as GroupedBoletoNotConfirmableError).details.motivos).toContain(
            M.BOLETO_INDISPONIVEL,
        );
    });

    describe('333111 (títulos 25/10, boleto 26/10)', () => {
        const caso = () => {
            const c = F.caso333111();
            return montar({ titulos: c.titulos, boletos: c.boletos });
        };
        const confirmar333 = (h: ReturnType<typeof montar>, over: Record<string, unknown>) =>
            h.service.confirmar({
                origem: 'MANUAL',
                ddcCod: 900,
                ditCod: 333111,
                titulos: chaves(h.cen.titulos),
                ator: 'ana',
                ...over,
            });

        it('sugerido ⇒ recusado: não é a sugestão do sistema', async () => {
            const h = caso();
            const erro = await confirmar333(h, { origem: 'SUGERIDO' }).catch((e: unknown) => e);
            expect(erro).toBeInstanceOf(GroupedBoletoNotConfirmableError);
            expect((erro as GroupedBoletoNotConfirmableError).details.sugestaoMudou).toBe(true);
        });

        it('manual sem reconhecer o aviso ⇒ WarningAcknowledgementRequiredError', async () => {
            const h = caso();
            const erro = await confirmar333(h, {}).catch((e: unknown) => e);
            expect(erro).toBeInstanceOf(WarningAcknowledgementRequiredError);
            expect((erro as WarningAcknowledgementRequiredError).userMessage).toMatch(
                /vence em 25\/10\/2026, antes do boleto \(26\/10\/2026\)/,
            );
            expect(h.grupos.inserirConfirmado).not.toHaveBeenCalled();
        });

        it('manual com o aviso reconhecido ⇒ confirmado, aviso gravado', async () => {
            const h = caso();
            const r = await confirmar333(h, { reconheceAvisos: ['TITULO_VENCE_ANTES_DO_BOLETO'] });
            expect(r.criado).toBe(true);
            expect(r.grupo).toMatchObject({
                origem: 'MANUAL',
                avisosReconhecidos: ['TITULO_VENCE_ANTES_DO_BOLETO'],
                vencimentoBoleto: '2026-10-26',
            });
        });
    });

    it('manual fora da janela (título 11 dias antes do boleto) ⇒ GroupedBoletoDueWindowError', async () => {
        const c = F.caso333111();
        const titulos = c.titulos.map((t, i) =>
            i === 0 ? { ...t, vencimento: F.utc('2026-10-15') } : t,
        );
        const h = montar({ titulos, boletos: c.boletos });
        const erro = await h.service
            .confirmar({
                origem: 'MANUAL',
                ddcCod: 900,
                ditCod: 333111,
                titulos: chaves(titulos),
                reconheceAvisos: ['TITULO_VENCE_ANTES_DO_BOLETO'],
                ator: 'ana',
            })
            .catch((e: unknown) => e);
        expect(erro).toBeInstanceOf(GroupedBoletoDueWindowError);
        expect((erro as GroupedBoletoDueWindowError).details.titulos).toEqual([
            expect.objectContaining({ docCod: '501', deltaDias: 11, vencimento: '2026-10-15' }),
        ]);
    });

    it('sugerido com conjunto diferente do recalculado (2 de 3) ⇒ sugestão mudou', async () => {
        const h = pedroni();
        const erro = await h.service
            .confirmar({
                origem: 'SUGERIDO',
                ddcCod: 900,
                ditCod: 332841,
                titulos: chaves(h.cen.titulos.slice(0, 2)),
                ator: 'ana',
            })
            .catch((e: unknown) => e);
        expect(erro).toBeInstanceOf(GroupedBoletoNotConfirmableError);
        expect((erro as GroupedBoletoNotConfirmableError).details.sugestaoMudou).toBe(true);
    });

    it('PEDRONI intercambiável: cada grupo confirmado à parte, marcado intercambiavel', async () => {
        const p = F.pedroniIntercambiavel();
        const h = montar({ titulos: p.titulos, boletos: p.boletos });
        const [primeira] = await h.service.sugerir({});
        expect(primeira?.intercambiavel).toBe(true);
        const r = await h.service.confirmar({
            origem: 'SUGERIDO',
            ddcCod: primeira?.ddcCod ?? 0,
            ditCod: primeira?.ditCod ?? 0,
            titulos: chaves(primeira?.titulos ?? []),
            ator: 'ana',
        });
        expect(r.grupo.intercambiavel).toBe(true);
    });
});

// ── anular ─────────────────────────────────────────────────────────────────────────────────────

describe('GrupoBoletoService.anular (I21t, PI-6)', () => {
    const MOTIVO = 'boleto pago à mão pelo financeiro';

    it.each([
        'curto',
        'x'.repeat(501),
        '         ',
    ])('motivo fora de 10–500 ⇒ recusado (%#)', async (motivo) => {
        const h = montar({ grupos: [grupoConfirmado()] });
        await expect(
            h.service.anular({ grupoId: 'g1', motivo, ator: 'ana' }),
        ).rejects.toBeInstanceOf(IssuerConfirmationReasonRequiredError);
        expect(h.grupos.anular).not.toHaveBeenCalled();
    });

    it('ator sistema ⇒ InvalidDecisionActorError', async () => {
        const h = montar({ grupos: [grupoConfirmado()] });
        await expect(
            h.service.anular({ grupoId: 'g1', motivo: MOTIVO, ator: 'sistema' }),
        ).rejects.toBeInstanceOf(InvalidDecisionActorError);
    });

    it('grupo inexistente ⇒ GroupedBoletoNotFoundError', async () => {
        const h = montar();
        await expect(
            h.service.anular({ grupoId: 'nao-existe', motivo: MOTIVO, ator: 'ana' }),
        ).rejects.toBeInstanceOf(GroupedBoletoNotFoundError);
    });

    it('grupo PAGO não se anula ⇒ GroupedBoletoStateConflictError', async () => {
        const h = montar({ grupos: [grupoConfirmado({ estado: GRUPO_BOLETO_ESTADO.PAGO })] });
        await expect(
            h.service.anular({ grupoId: 'g1', motivo: MOTIVO, ator: 'ana' }),
        ).rejects.toBeInstanceOf(GroupedBoletoStateConflictError);
    });

    it('idempotente sobre ANULADO: nada gravado, nada retirado', async () => {
        const h = montar({ grupos: [grupoConfirmado({ estado: GRUPO_BOLETO_ESTADO.ANULADO })] });
        const r = await h.service.anular({ grupoId: 'g1', motivo: MOTIVO, ator: 'ana' });
        expect(r.anulado).toBe(false);
        expect(h.lotes.removerGrupo).not.toHaveBeenCalled();
        expect(h.bloqueios.encerrarDoGrupo).not.toHaveBeenCalled();
    });

    it('em lote RASCUNHO: anula, retira os N itens e encerra as marcas NA MESMA transação', async () => {
        const g = grupoConfirmado();
        const h = montar({
            grupos: [g],
            lotes: [
                {
                    id: 'L1',
                    status: 'RASCUNHO',
                    itens: [
                        ...g.titulos.map((t) => ({
                            ...chaves([t])[0],
                            grupoBoletoId: 'g1',
                            divergencia: false,
                        })),
                        { filCod: 2, docCod: '999', titCod: '1', divergencia: false },
                    ] as LoteFake['itens'],
                },
            ],
        });
        const r = await h.service.anular({ grupoId: 'g1', motivo: MOTIVO, ator: 'ana' });
        expect(r).toMatchObject({ anulado: true, retiradoDoLoteId: 'L1' });
        expect(r.grupo.estado).toBe(GRUPO_BOLETO_ESTADO.ANULADO);
        expect(h.db.withTransaction).toHaveBeenCalledTimes(1);
        expect(h.grupos.anular).toHaveBeenCalledWith(
            { grupoId: 'g1', motivo: MOTIVO, tipoAnulacao: 'MANUAL', ator: 'ana' },
            h.tx,
        );
        expect(h.lotes.removerGrupo).toHaveBeenCalledWith({ loteId: 'L1', grupoId: 'g1' }, h.tx);
        expect(h.bloqueios.encerrarDoGrupo).toHaveBeenCalledWith(
            expect.objectContaining({ grupoId: 'g1', ator: 'ana' }),
            h.tx,
        );
        expect(h.cen.lotes[0]?.itens.map((i) => i.docCod)).toEqual(['999']);
        expect(h.cache.invalidar).toHaveBeenCalled();
        expect(h.logService.info).toHaveBeenCalledWith(
            expect.objectContaining({ message: 'grupo de boleto anulado' }),
        );
    });

    it('em lote comprometido: anula, NÃO mexe no lote e devolve o aviso', async () => {
        const g = grupoConfirmado();
        const h = montar({
            grupos: [g],
            lotes: [
                {
                    id: 'L2',
                    status: 'FINALIZADO',
                    itens: g.titulos.map((t) => ({
                        ...chaves([t])[0],
                        grupoBoletoId: 'g1',
                        divergencia: false,
                    })) as LoteFake['itens'],
                },
            ],
        });
        const r = await h.service.anular({ grupoId: 'g1', motivo: MOTIVO, ator: 'ana' });
        expect(r.anulado).toBe(true);
        expect(r.retiradoDoLoteId).toBeUndefined();
        expect(r.avisoLoteComprometido).toMatchObject({ loteId: 'L2', status: 'FINALIZADO' });
        expect(r.avisoLoteComprometido?.mensagem).toMatch(/remessa/);
        expect(h.lotes.removerGrupo).not.toHaveBeenCalled();
    });
});

describe('GrupoBoletoService.anularPorRevogacaoDoPar (cascata I15l(2))', () => {
    it('anula os grupos CONFIRMADO do par com ator sistema e tipo PAR_REVOGADO, na transação dada', async () => {
        const a = grupoConfirmado({ id: 'ga' });
        const b = grupoConfirmado({ id: 'gb', ditCod: 2 });
        const c = grupoConfirmado({ id: 'gc', ditCod: 3, confirmacaoEmissorId: 'outro-par' });
        const h = montar({ grupos: [a, b, c] });
        const txExterna = { nome: 'revogacao' };
        const r = await h.service.anularPorRevogacaoDoPar('par-1', txExterna as never);
        expect(r.map((x) => x.grupo.id)).toEqual(['ga', 'gb']);
        expect(h.db.withTransaction).not.toHaveBeenCalled();
        expect(h.grupos.listarConfirmadosDoPar).toHaveBeenCalledWith('par-1', txExterna);
        for (const id of ['ga', 'gb']) {
            expect(h.grupos.anular).toHaveBeenCalledWith(
                expect.objectContaining({
                    grupoId: id,
                    tipoAnulacao: 'PAR_REVOGADO',
                    ator: 'sistema',
                }),
                txExterna,
            );
        }
        expect(c.estado).toBe(GRUPO_BOLETO_ESTADO.CONFIRMADO);
        const motivo = (h.grupos.anular.mock.calls[0]?.[0] as { motivo: string }).motivo;
        expect(motivo.length).toBeGreaterThanOrEqual(10);
    });
});

// ── listar ─────────────────────────────────────────────────────────────────────────────────────

describe('GrupoBoletoService.listar (situação derivada, I21u)', () => {
    it('nunca some grupo: órfão (boleto fora do pool), em lote, retido e rejeitado aparecem com a situação', async () => {
        const p = F.pedroni();
        const b = p.boletos[0] as BoletoDda;
        const tituloDoc = (doc: string) => F.titulo({ docCod: doc, credor: 'PEDRONI' });
        const tit = (doc: string) => ({
            filCod: 2,
            docCod: doc,
            titCod: '1',
            valorLiquidoCentavos: 52500,
            vencimento: '2026-10-21',
        });
        const orfao = grupoConfirmado({ id: 'g-orfao', ditCod: 1, titulos: [tit('1'), tit('2')] });
        const emLote = grupoConfirmado({
            id: 'g-lote',
            ddcCod: b.ddcCod,
            ditCod: b.ditCod,
            titulos: [tit('3'), tit('4')],
        });
        const retido = grupoConfirmado({
            id: 'g-retido',
            ddcCod: b.ddcCod,
            ditCod: b.ditCod,
            titulos: [tit('5'), tit('6')],
        });
        const rejeitado = grupoConfirmado({
            id: 'g-rej',
            ddcCod: b.ddcCod,
            ditCod: b.ditCod,
            titulos: [tit('7'), tit('8')],
        });
        const h = montar({
            titulos: ['1', '2', '3', '4', '5', '6', '7', '8'].map(tituloDoc),
            boletos: [b],
            grupos: [orfao, emLote, retido, rejeitado],
            marcas: [{ filCod: 2, docCod: '5', titCod: '1' }],
            lotes: [
                {
                    id: 'L1',
                    status: 'RASCUNHO',
                    itens: [tit('3'), tit('4')].map((t) => ({
                        ...chaves([t])[0],
                        grupoBoletoId: 'g-lote',
                        divergencia: false,
                    })) as LoteFake['itens'],
                },
            ],
            execucoes: new Map([
                [
                    'g-rej',
                    [
                        {
                            etapa: ETAPA_BORDERO_GRUPO.CONCLUIDO,
                            criadoEm: new Date('2026-10-18T10:00:00Z'),
                            jRejeitadoEm: new Date('2026-10-19T10:00:00Z'),
                        },
                    ],
                ],
            ]),
        });
        const r = await h.service.listar({});
        const por = new Map(r.map((g) => [g.id, g]));
        expect(r).toHaveLength(4);
        expect(por.get('g-orfao')).toMatchObject({
            situacao: 'ORFAO',
            orfao: { orfao: true, motivo: 'BOLETO_FORA_DO_POOL' },
        });
        expect(por.get('g-lote')).toMatchObject({
            situacao: 'EM_LOTE',
            loteId: 'L1',
            loteStatus: 'RASCUNHO',
        });
        expect(por.get('g-retido')?.situacao).toBe('RETIDO');
        expect(por.get('g-rej')?.situacao).toBe('REJEITADO');
        expect(h.sispag.lerValoresAberto).not.toHaveBeenCalled();
    });

    it('título que saiu da carteira ⇒ órfão TITULO_INATIVO', async () => {
        const p = F.pedroni();
        const b = p.boletos[0] as BoletoDda;
        const g = grupoConfirmado({ ddcCod: b.ddcCod, ditCod: b.ditCod });
        const titulos = p.titulos.map((t, i) => (i === 0 ? { ...t, ativo: false } : t));
        const h = montar({ titulos, boletos: [b], grupos: [g] });
        const [x] = await h.service.listar({ filCod: 2 });
        expect(x?.orfao).toMatchObject({ orfao: true, motivo: 'TITULO_INATIVO' });
    });
});
