import 'reflect-metadata';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { container } from 'tsyringe';
import BoletoAlreadySuggestedToOtherTitleError from '../../errors/BoletoAlreadySuggestedToOtherTitleError.js';
import BoletoSuggestionNotAvailableError from '../../errors/BoletoSuggestionNotAvailableError.js';
import DecisionNotConfirmedError from '../../errors/DecisionNotConfirmedError.js';
import IssuerConfirmationNotFoundError from '../../errors/IssuerConfirmationNotFoundError.js';
import IssuerConfirmationReasonRequiredError from '../../errors/IssuerConfirmationReasonRequiredError.js';
import IssuerConfirmationVersionConflictError from '../../errors/IssuerConfirmationVersionConflictError.js';
import InvalidDecisionActorError from '../../errors/InvalidDecisionActorError.js';
import LineCopyAuditFailedError from '../../errors/LineCopyAuditFailedError.js';
import OverdueBoletoNotConfirmableError from '../../errors/OverdueBoletoNotConfirmableError.js';
import TitleSuggestionNotFoundError from '../../errors/TitleSuggestionNotFoundError.js';
import WarningAcknowledgementRequiredError from '../../errors/WarningAcknowledgementRequiredError.js';
import type { BoletoDda } from '../../interface/sispag/BoletoDda.js';
import type {
    ConfirmacaoEmissor,
    DecisaoSugestao,
} from '../../interface/sispag/ConfirmacaoEmissorBoleto.js';
import type { TituloAPagar } from '../../interface/sispag/SispagInterface.js';
import type { DpsConhecido } from '../../interface/sispag/SugestaoBoleto.js';
import CodigoBarrasBoleto from '../../libs/boleto/CodigoBarrasBoleto.js';
import BankingCalendar from '../../libs/calendar/BankingCalendar.js';
import BoletoSuggestionService from './BoletoSuggestionService.js';
import AncoraOrdemDps from './AncoraOrdemDps.js';
import MotorSugestaoBoleto from './MotorSugestaoBoleto.js';
import RegraSugestaoBoleto from './RegraSugestaoBoleto.js';
import SugestaoBoletoCache from './SugestaoBoletoCache.js';

const HOJE = new Date('2026-10-14T15:00:00Z'); // quarta-feira
const calendar = BankingCalendar.withClock(() => HOJE);
const codigoBarras = new CodigoBarrasBoleto();
const regra = new RegraSugestaoBoleto();
const motor = new MotorSugestaoBoleto(codigoBarras, calendar, regra, new AncoraOrdemDps());

/** Relógio do cache nos testes: avança só quando o teste manda (TTL determinístico). */
const relogio = { agora: HOJE.getTime() };
afterEach(() => {
    relogio.agora = HOJE.getTime();
});

const utc = (civil: string): number => Date.parse(`${civil}T00:00:00Z`);

const dvGeral = (semDv: string): string => {
    let soma = 0;
    let peso = 2;
    for (let i = semDv.length - 1; i >= 0; i -= 1) {
        soma += Number(semDv[i]) * peso;
        peso = peso === 9 ? 2 : peso + 1;
    }
    const dv = 11 - (soma % 11);
    return String(dv === 0 || dv === 10 || dv === 11 ? 1 : dv);
};
const bradesco = (agencia: string, conta: string, n = 7128): string => {
    const livre = `${agencia}09${String(n).padStart(11, '0')}${conta}0`;
    const semDv = `2379${'1580'}${'0000481533'}${livre}`;
    return `2379${dvGeral(semDv)}1580${'0000481533'}${livre}`;
};

const CODBAR = bradesco('2656', '0092740');
const LINHA = new CodigoBarrasBoleto().paraLinhaDigitavel(CODBAR) ?? '';

const TITULO: TituloAPagar = {
    filCod: 1,
    docCod: '9001',
    titCod: '1',
    pesCod: '7001',
    credor: 'ACME',
    valor: 100,
    vencimento: utc('2026-10-20'),
    liberado: true,
    pago: false,
    temBoleto: false,
    formaPagamentoConexos: 6,
    ativo: true,
};

const BOLETO: BoletoDda = {
    ddcCod: 500,
    ditCod: 1,
    valor: 100,
    vencimento: '2026-10-20',
    codbar: CODBAR,
};

const CHAVE = { filCod: 1, docCod: '9001', titCod: '1', ddcCod: 500, ditCod: 1 };

const PAR: ConfirmacaoEmissor = {
    id: 'par-1',
    pesCod: '7001',
    emissorChave: '237:2656:0092740',
    layoutEmissor: 'BRADESCO_237',
    bancoEmissor: '237',
    emissorMascarado: '237 / 2656 / ***2740',
    estado: 'VIGENTE',
    evidencia: {},
    confirmadoPor: 'ana',
    confirmadoEm: '2026-10-14T10:00:00.000Z',
    versao: 1,
};

const DECISAO: DecisaoSugestao = {
    id: 'dec-1',
    filCod: 1,
    docCod: '9001',
    titCod: '1',
    pesCod: '7001',
    ddcCod: 500,
    ditCod: 1,
    codbarMascarado: '237…1533',
    valorTitulo: 100,
    vencimentoTitulo: '2026-10-20',
    valorBoleto: 100,
    vencimentoBoleto: '2026-10-20',
    deltaValor: 0,
    deltaPercentual: 0,
    deltaDias: 0,
    sinais: ['VALOR_IGUAL', 'MESMO_DIA'],
    tier: 'FORTE',
    emissorChave: '237:2656:0092740',
    decisao: 'CONFIRMADA',
    decididoPor: 'ana',
    decididoEm: '2026-10-14T10:00:00.000Z',
    confirmacaoEmissorId: 'par-1',
    versao: 1,
};

interface Cenario {
    titulos: TituloAPagar[];
    boletos: BoletoDda[];
    pares: ConfirmacaoEmissor[];
    decisoes: DecisaoSugestao[];
    dps: DpsConhecido[];
}

const montar = (over: Partial<Cenario> = {}) => {
    const cen: Cenario = {
        titulos: [TITULO],
        boletos: [BOLETO],
        pares: [],
        decisoes: [],
        dps: [],
        ...over,
    };
    const eventos: Array<Record<string, unknown>> = [];
    const repo = {
        listarParesVigentes: jest.fn(async () => cen.pares.filter((p) => p.estado === 'VIGENTE')),
        listarPares: jest.fn(async () => cen.pares),
        buscarParVigente: jest.fn(
            async (pesCod: string, chave: string) =>
                cen.pares.find(
                    (p) =>
                        p.pesCod === pesCod && p.emissorChave === chave && p.estado === 'VIGENTE',
                ) ?? null,
        ),
        buscarParPorId: jest.fn(async (id: string) => cen.pares.find((p) => p.id === id) ?? null),
        inserirPar: jest.fn(async (n: { pesCod: string; emissorChave: string }) => {
            const existente = cen.pares.find(
                (p) => p.pesCod === n.pesCod && p.emissorChave === n.emissorChave,
            );
            if (existente) return { criado: false, par: existente };
            const par = { ...PAR, id: 'par-novo', pesCod: n.pesCod, emissorChave: n.emissorChave };
            cen.pares.push(par);
            return { criado: true, par };
        }),
        revogarPar: jest.fn(async () => 1),
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
                        (f.docCod === undefined || d.docCod === f.docCod) &&
                        (f.titCod === undefined || d.titCod === f.titCod) &&
                        (f.ddcCod === undefined || d.ddcCod === f.ddcCod) &&
                        (f.ditCod === undefined || d.ditCod === f.ditCod),
                ),
        ),
        listarChaveadas: jest.fn(async (decisao: string) =>
            cen.decisoes.filter((d) => d.decisao === decisao),
        ),
        listarConfirmadasDoPar: jest.fn(async (parId: string) =>
            cen.decisoes.filter(
                (d) => d.confirmacaoEmissorId === parId && d.decisao === 'CONFIRMADA',
            ),
        ),
        buscarDecisaoPorId: jest.fn(
            async (id: string) => cen.decisoes.find((d) => d.id === id) ?? null,
        ),
        anularDecisao: jest.fn(
            async (i: { id: string; versaoEsperada: number; ator: string; motivo: string }) => {
                const d = cen.decisoes.find(
                    (x) =>
                        x.id === i.id &&
                        x.decisao === 'CONFIRMADA' &&
                        x.versao === i.versaoEsperada,
                );
                if (!d) return 0;
                Object.assign(d, {
                    decisao: 'ANULADA',
                    anuladaPor: i.ator,
                    anuladaEm: '2026-10-14T12:00:00.000Z',
                    motivoAnulacao: i.motivo,
                    versao: d.versao + 1,
                });
                return 1;
            },
        ),
        inserirDecisao: jest.fn(async (n: Record<string, unknown>) => {
            const decisao = {
                ...DECISAO,
                ...n,
                id: 'dec-novo',
                decididoEm: '2026-10-14T11:00:00.000Z',
            } as unknown as DecisaoSugestao;
            cen.decisoes.push(decisao);
            return { criada: true, decisao };
        }),
        inserirEvento: jest.fn(async (e: Record<string, unknown>) => {
            eventos.push(e);
            return 'ev';
        }),
    };
    const tituloRepo = {
        listAtivos: jest.fn(async () => cen.titulos),
        buscarPorChave: jest.fn(
            async (c: { filCod: number; docCod: string; titCod: string }) =>
                cen.titulos.find((t) => t.docCod === c.docCod && t.titCod === c.titCod) ?? null,
        ),
    };
    const boletoRepo = {
        listBoletos: jest.fn(async () => cen.boletos),
        buscarPorChave: jest.fn(
            async (c: { ddcCod: number; ditCod: number }) =>
                cen.boletos.find((b) => b.ddcCod === c.ddcCod && b.ditCod === c.ditCod) ?? null,
        ),
        ultimaSincronizacao: jest.fn(async () => HOJE.getTime() - 2 * 3_600_000),
    };
    const loteRepo = { listTitulosEmLotesAbertos: jest.fn(async () => []) };
    const dpsRepo = { listarLidos: jest.fn(async () => cen.dps) };
    const tx = {};
    const db = { withTransaction: jest.fn(async (fn: (t: unknown) => unknown) => fn(tx)) };
    const logService = {
        info: jest.fn().mockResolvedValue(undefined),
        warn: jest.fn().mockResolvedValue(undefined),
    };
    const cache = SugestaoBoletoCache.withClock(() => relogio.agora);
    const ajuste = { agendarAposConfirmar: jest.fn() };
    const service = new BoletoSuggestionService(
        repo as never,
        tituloRepo as never,
        boletoRepo as never,
        loteRepo as never,
        motor,
        regra,
        codigoBarras,
        calendar,
        db as never,
        logService as never,
        cache,
        dpsRepo as never,
        ajuste as never,
    );
    return {
        service,
        repo,
        tituloRepo,
        boletoRepo,
        loteRepo,
        dpsRepo,
        db,
        logService,
        eventos,
        cen,
        cache,
        ajuste,
    };
};

describe('BoletoSuggestionService — DPS lidos entram no motor (I15p, ADR-0073)', () => {
    it('o cenário lê os DPS de `titulo_dps` e os entrega ao motor', async () => {
        const dps: DpsConhecido = {
            filCod: 1,
            docCod: '9001',
            titCod: '1',
            pesCod: '7001',
            nfse: '86666',
            dps: '776132',
        };
        const espiao = jest.spyOn(motor, 'analisar');
        try {
            const { service, dpsRepo } = montar({ dps: [dps] });
            await service.listarSugestoes({});
            expect(dpsRepo.listarLidos).toHaveBeenCalledTimes(1);
            expect(espiao.mock.calls[0]?.[0].dps).toEqual([dps]);
        } finally {
            espiao.mockRestore();
        }
    });

    it('falha ao ler `titulo_dps` não derruba a sugestão: segue sem DPS e avisa no log', async () => {
        const espiao = jest.spyOn(motor, 'analisar');
        try {
            const { service, dpsRepo, logService } = montar();
            dpsRepo.listarLidos.mockRejectedValueOnce(
                new Error('relation "titulo_dps" does not exist'),
            );
            const r = await service.listarSugestoes({});
            expect(r.total).toBe(1);
            expect(espiao.mock.calls[0]?.[0].dps).toEqual([]);
            expect(logService.warn).toHaveBeenCalledWith(
                expect.objectContaining({
                    message: 'falha ao ler os DPS — sugestão calculada sem a âncora DPS',
                }),
            );
        } finally {
            espiao.mockRestore();
        }
    });
});

describe('BoletoSuggestionService.listarSugestoes (I15c, I15k)', () => {
    it('devolve o emissor MASCARADO e nenhuma barra/linha digitável; nem a chave do emissor', async () => {
        const { service } = montar();
        const r = await service.listarSugestoes({});
        expect(r.total).toBe(1);
        const s = r.sugestoes[0];
        expect(s).toMatchObject({ docCod: '9001', ddcCod: 500, ditCod: 1, confirmavel: true });
        expect(s?.avaliacao.resultado).toBe('FORTE');
        expect(s?.emissor).toEqual({
            banco: '237',
            layout: 'BRADESCO_237',
            mascarado: '237 / 2656 / ***2740',
        });
        const json = JSON.stringify(r);
        expect(json).not.toContain(CODBAR);
        expect(json).not.toContain(LINHA);
        expect(json).not.toContain('0092740');
        expect(json).not.toMatch(/\d{30,}/);
    });

    it('com par vigente do emissor, o tier sobe a CONHECIDO e traz o id do par', async () => {
        const { service } = montar({ pares: [PAR] });
        const r = await service.listarSugestoes({});
        expect(r.sugestoes[0]?.avaliacao.resultado).toBe('CONHECIDO');
        expect(r.sugestoes[0]?.confirmacaoEmissorId).toBe('par-1');
    });

    it('filtra por tier/credor, pagina e conta por resultado', async () => {
        const { service } = montar();
        expect((await service.listarSugestoes({ tier: 'ATENCAO' })).total).toBe(0);
        expect((await service.listarSugestoes({ pesCod: '9999' })).total).toBe(0);
        const r = await service.listarSugestoes({ tier: 'FORTE', pagina: 1, tamanho: 10 });
        expect(r.total).toBe(1);
        expect(r.contagem.FORTE).toBe(1);
    });

    it('avisa DDA defasado (> 8 h em dia útil) com as horas; em dia, sem aviso', async () => {
        const velho = montar();
        velho.boletoRepo.ultimaSincronizacao.mockResolvedValue(HOJE.getTime() - 20 * 3_600_000);
        const a = await velho.service.listarSugestoes({});
        expect(a.ddaDefasadoHoras).toBe(20);
        expect(a.sincronizadoEm).toBe(HOJE.getTime() - 20 * 3_600_000);
        const novo = montar();
        expect((await novo.service.listarSugestoes({})).ddaDefasadoHoras).toBeUndefined();
    });
});

describe('cache do cenário (PERF-1)', () => {
    it('a segunda listagem sai do cache: o motor e as leituras rodam uma vez só', async () => {
        const { service, tituloRepo, boletoRepo } = montar();
        const motorAnalisar = jest.spyOn(motor, 'analisar');
        try {
            await service.listarSugestoes({});
            await service.listarSugestoes({ tier: 'FORTE', pagina: 1, tamanho: 10 });
            await service.listarSugestoes({ pesCod: '7001' });
            expect(motorAnalisar).toHaveBeenCalledTimes(1);
            expect(tituloRepo.listAtivos).toHaveBeenCalledTimes(1);
            expect(boletoRepo.listBoletos).toHaveBeenCalledTimes(1);
        } finally {
            motorAnalisar.mockRestore();
        }
    });

    it('filtro e paginação valem sobre o cenário em cache, sem recalcular', async () => {
        const outro: TituloAPagar = { ...TITULO, docCod: '9100', pesCod: '7002', valor: 250 };
        const { service, tituloRepo } = montar({
            titulos: [TITULO, outro],
            boletos: [BOLETO, { ...BOLETO, ditCod: 2, valor: 250 }],
        });
        const a = await service.listarSugestoes({ pesCod: '7002' });
        const b = await service.listarSugestoes({ pagina: 2, tamanho: 1 });
        expect(a.sugestoes.map((s) => s.docCod)).toEqual(['9100']);
        expect(b.total).toBe(2);
        expect(b.sugestoes).toHaveLength(1);
        expect(tituloRepo.listAtivos).toHaveBeenCalledTimes(1);
    });

    it('single-flight: duas listagens concorrentes rodam o motor exatamente uma vez', async () => {
        const { service, tituloRepo } = montar();
        const motorAnalisar = jest.spyOn(motor, 'analisar');
        let liberar: () => void = () => undefined;
        const portao = new Promise<void>((r) => {
            liberar = r;
        });
        tituloRepo.listAtivos.mockImplementationOnce(async () => {
            await portao;
            return [TITULO];
        });
        try {
            const a = service.listarSugestoes({});
            const b = service.listarSugestoes({});
            await new Promise((r) => setImmediate(r));
            liberar();
            const [ra, rb] = await Promise.all([a, b]);
            expect(ra.total).toBe(1);
            expect(rb.total).toBe(1);
            expect(motorAnalisar).toHaveBeenCalledTimes(1);
            expect(tituloRepo.listAtivos).toHaveBeenCalledTimes(1);
        } finally {
            motorAnalisar.mockRestore();
        }
    });

    it('TTL: passado o tempo, a listagem recalcula', async () => {
        const { service, tituloRepo } = montar();
        await service.listarSugestoes({});
        relogio.agora += 29_000;
        await service.listarSugestoes({});
        expect(tituloRepo.listAtivos).toHaveBeenCalledTimes(1);
        relogio.agora += 2_000;
        await service.listarSugestoes({});
        expect(tituloRepo.listAtivos).toHaveBeenCalledTimes(2);
    });

    it.each([
        [
            'confirmar',
            (s: ReturnType<typeof montar>['service']) => s.confirmar({ ...CHAVE, ator: 'ana' }),
            {},
        ],
        [
            'rejeitar',
            (s: ReturnType<typeof montar>['service']) =>
                s.rejeitar({ ...CHAVE, motivo: 'outro credor', ator: 'ana' }),
            {},
        ],
        [
            'anular',
            (s: ReturnType<typeof montar>['service']) =>
                s.anularDecisao({
                    filCod: 1,
                    docCod: '9001',
                    titCod: '1',
                    motivo: 'confirmação errada',
                    ator: 'ana',
                }),
            { decisoes: [{ ...DECISAO }] },
        ],
    ] as Array<
        [string, (s: ReturnType<typeof montar>['service']) => Promise<unknown>, Partial<Cenario>]
    >)('invalida o cache depois de %s: a listagem seguinte recalcula', async (_nome, acao, over) => {
        const { service, tituloRepo } = montar({ pares: [PAR], ...over });
        await service.listarSugestoes({});
        expect(tituloRepo.listAtivos).toHaveBeenCalledTimes(1);
        await acao(service);
        const antes = tituloRepo.listAtivos.mock.calls.length;
        await service.listarSugestoes({});
        expect(tituloRepo.listAtivos.mock.calls.length).toBe(antes + 1);
    });

    it('revogar o par invalida o cache', async () => {
        const { service, repo, tituloRepo, cen } = montar({ pares: [PAR] });
        repo.revogarPar.mockImplementationOnce(async () => {
            cen.pares[0] = { ...PAR, estado: 'REVOGADA', versao: 2 };
            return 1;
        });
        await service.listarSugestoes({});
        await service.revogarPar({ id: 'par-1', motivo: 'conta trocada', ator: 'cid' });
        await service.listarSugestoes({});
        expect(tituloRepo.listAtivos).toHaveBeenCalledTimes(2);
    });

    it('confirmar, rejeitar e anular NUNCA consultam o cache para decidir', async () => {
        const { service, cache } = montar({ pares: [PAR] });
        const obter = jest.spyOn(cache, 'obter');
        await service.confirmar({ ...CHAVE, ator: 'ana' });
        await service
            .rejeitar({ ...CHAVE, ditCod: 2, motivo: 'outro', ator: 'ana' })
            .catch(() => undefined);
        await service
            .anularDecisao({
                filCod: 1,
                docCod: '9001',
                titCod: '1',
                motivo: 'confirmação errada',
                ator: 'ana',
            })
            .catch(() => undefined);
        expect(obter).not.toHaveBeenCalled();
    });

    it('confirmar relê o banco ao vivo mesmo com o cache quente e já velho', async () => {
        const { service, tituloRepo, cen } = montar({ pares: [PAR] });
        await service.listarSugestoes({}); // aquece: o título está livre
        cen.titulos = [{ ...TITULO, pago: true }]; // mudou no banco; o cache ainda não sabe
        await expect(service.confirmar({ ...CHAVE, ator: 'ana' })).rejects.toBeInstanceOf(
            BoletoSuggestionNotAvailableError,
        );
        expect(tituloRepo.buscarPorChave).toHaveBeenCalled();
    });

    it('registra a duração e as contagens só na falta de cache, sem barras', async () => {
        const { service, logService } = montar();
        await service.listarSugestoes({});
        await service.listarSugestoes({});
        const calculos = logService.info.mock.calls
            .map((c) => c[0] as { message: string; data?: Record<string, unknown> })
            .filter((p) => p.message === 'sugestao_boleto.cenario_calculado');
        expect(calculos).toHaveLength(1);
        expect(calculos[0]?.data).toMatchObject({ titulos: 1, boletos: 1, sugestoes: 1, orfas: 0 });
        expect(typeof calculos[0]?.data?.duracaoMs).toBe('number');
        expect(JSON.stringify(calculos)).not.toContain(CODBAR);
        expect(JSON.stringify(calculos)).not.toMatch(/\d{30,}/);
    });

    it('falha do cálculo não fica em cache: a chamada seguinte tenta de novo', async () => {
        const { service, tituloRepo } = montar();
        tituloRepo.listAtivos.mockRejectedValueOnce(new Error('banco fora'));
        await expect(service.listarSugestoes({})).rejects.toThrow('banco fora');
        const r = await service.listarSugestoes({});
        expect(r.total).toBe(1);
    });
});

describe('BoletoSuggestionService.confirmar — ajuste de centavos pós-commit (I18g, ADR-0074)', () => {
    it('agenda o ajuste DEPOIS do commit, fora da transação, sem esperar', async () => {
        const { service, db, ajuste } = montar();
        let dentroDaTransacao = false;
        db.withTransaction.mockImplementationOnce(async (fn: (t: unknown) => unknown) => {
            dentroDaTransacao = true;
            const r = await fn({});
            expect(ajuste.agendarAposConfirmar).not.toHaveBeenCalled();
            dentroDaTransacao = false;
            return r;
        });
        ajuste.agendarAposConfirmar.mockImplementation(() => {
            expect(dentroDaTransacao).toBe(false);
        });
        const r = await service.confirmar({ ...CHAVE, ator: 'ana' });
        expect(r.criada).toBe(true);
        expect(ajuste.agendarAposConfirmar).toHaveBeenCalledWith({
            filCod: r.decisao.filCod,
            docCod: r.decisao.docCod,
            titCod: r.decisao.titCod,
            decisaoId: r.decisao.id,
        });
    });

    it('rollback do confirmar ⇒ nenhum ajuste disparado', async () => {
        const { service, db, ajuste } = montar();
        db.withTransaction.mockRejectedValueOnce(new Error('rollback'));
        await expect(service.confirmar({ ...CHAVE, ator: 'ana' })).rejects.toThrow('rollback');
        expect(ajuste.agendarAposConfirmar).not.toHaveBeenCalled();
    });

    it('confirmação idempotente (já existia) não dispara de novo', async () => {
        const { service, ajuste } = montar();
        await service.confirmar({ ...CHAVE, ator: 'ana' });
        ajuste.agendarAposConfirmar.mockClear();
        await service.confirmar({ ...CHAVE, ator: 'ana' });
        expect(ajuste.agendarAposConfirmar).not.toHaveBeenCalled();
    });
});

describe('BoletoSuggestionService.confirmar (I15a, I15d, I15i, I15j)', () => {
    it('cria o par e a decisão com evidência, numa transação, com os dois eventos', async () => {
        const { service, repo, db, eventos } = montar();
        const r = await service.confirmar({ ...CHAVE, ator: 'ana' });
        expect(db.withTransaction).toHaveBeenCalledTimes(1);
        expect(r.criada).toBe(true);
        expect(repo.inserirPar).toHaveBeenCalledTimes(1);
        const par = repo.inserirPar.mock.calls[0]?.[0] as Record<string, unknown>;
        expect(par).toMatchObject({
            pesCod: '7001',
            emissorChave: '237:2656:0092740',
            layoutEmissor: 'BRADESCO_237',
            confirmadoPor: 'ana',
        });
        const dec = repo.inserirDecisao.mock.calls[0]?.[0] as Record<string, unknown>;
        expect(dec).toMatchObject({
            docCod: '9001',
            ddcCod: 500,
            decisao: 'CONFIRMADA',
            tier: 'FORTE',
            deltaValor: 0,
            deltaDias: 0,
            decididoPor: 'ana',
            confirmacaoEmissorId: 'par-novo',
        });
        expect(dec.sinais).toEqual(expect.arrayContaining(['VALOR_IGUAL', 'MESMO_DIA']));
        expect(dec.codbarMascarado).toBe(codigoBarras.mascarar(CODBAR));
        expect(eventos.map((e) => e.tipo)).toEqual(['PAR_CONFIRMADO', 'DECISAO_CONFIRMADA']);
        expect(JSON.stringify([par, dec, eventos])).not.toContain(CODBAR);
        expect(JSON.stringify([par, dec, eventos])).not.toContain(LINHA);
    });

    it('par já vigente: grava só a decisão (sem PAR_CONFIRMADO)', async () => {
        const { service, eventos } = montar({ pares: [PAR] });
        await service.confirmar({ ...CHAVE, ator: 'ana' });
        expect(eventos.map((e) => e.tipo)).toEqual(['DECISAO_CONFIRMADA']);
    });

    it('idempotente: reconfirmar o mesmo (título, boleto) devolve a decisão existente sem evento', async () => {
        const { service, repo, eventos } = montar({ pares: [PAR], decisoes: [DECISAO] });
        const r = await service.confirmar({ ...CHAVE, ator: 'bia' });
        expect(r.criada).toBe(false);
        expect(r.decisao.id).toBe('dec-1');
        expect(repo.inserirDecisao).not.toHaveBeenCalled();
        expect(eventos).toHaveLength(0);
    });

    it('corrida: o índice recusou e a vencedora é do mesmo par → devolve a existente, sem evento', async () => {
        const { service, repo, eventos } = montar({ pares: [PAR] });
        repo.inserirDecisao.mockResolvedValueOnce({ criada: false, decisao: DECISAO });
        const r = await service.confirmar({ ...CHAVE, ator: 'bia' });
        expect(r.criada).toBe(false);
        expect(r.decisao.id).toBe('dec-1');
        expect(eventos).toHaveLength(0);
    });

    it('corrida: a vencedora é de OUTRO título → BoletoAlreadySuggestedToOtherTitle (rollback)', async () => {
        const { service, repo } = montar({ pares: [PAR] });
        repo.inserirDecisao.mockResolvedValueOnce({
            criada: false,
            decisao: { ...DECISAO, docCod: '7777' },
        });
        await expect(service.confirmar({ ...CHAVE, ator: 'bia' })).rejects.toBeInstanceOf(
            BoletoAlreadySuggestedToOtherTitleError,
        );
    });

    it('boleto já CONFIRMADO a outro título → 409 BoletoAlreadySuggestedToOtherTitle', async () => {
        const { service, db } = montar({
            decisoes: [{ ...DECISAO, docCod: '7777' }],
        });
        await expect(service.confirmar({ ...CHAVE, ator: 'ana' })).rejects.toBeInstanceOf(
            BoletoAlreadySuggestedToOtherTitleError,
        );
        expect(db.withTransaction).not.toHaveBeenCalled();
    });

    it('título já tem OUTRO boleto confirmado → BoletoSuggestionNotAvailable', async () => {
        const { service } = montar({ decisoes: [{ ...DECISAO, ditCod: 99 }] });
        await expect(service.confirmar({ ...CHAVE, ator: 'ana' })).rejects.toBeInstanceOf(
            BoletoSuggestionNotAvailableError,
        );
    });

    it.each([
        ['título pago', { titulos: [{ ...TITULO, pago: true }] }],
        ['título já sinalizado pelo ERP', { titulos: [{ ...TITULO, temBoleto: true }] }],
        ['título inativo', { titulos: [{ ...TITULO, ativo: false }] }],
        ['título sem credor', { titulos: [{ ...TITULO, pesCod: undefined }] }],
        ['título sumiu', { titulos: [] }],
        [
            'boleto vinculado pelo ERP',
            { boletos: [{ ...BOLETO, filCod: 1, docCod: '1', titCod: '1' }] },
        ],
        ['boleto sumiu do pool', { boletos: [] }],
    ] as Array<
        [string, Partial<Cenario>]
    >)('releitura (anti-TOCTOU): %s → 409 BoletoSuggestionNotAvailable, nada gravado', async (_nome, over) => {
        const { service, repo, eventos } = montar(over);
        await expect(service.confirmar({ ...CHAVE, ator: 'ana' })).rejects.toBeInstanceOf(
            BoletoSuggestionNotAvailableError,
        );
        expect(repo.inserirPar).not.toHaveBeenCalled();
        expect(repo.inserirDecisao).not.toHaveBeenCalled();
        expect(eventos).toHaveLength(0);
    });

    it('outro título agora detém a reserva do boleto → 409 BoletoAlreadySuggestedToOtherTitle', async () => {
        const rival: TituloAPagar = { ...TITULO, docCod: '1000', vencimento: utc('2026-10-19') };
        // O rival vence antes e o boleto é do mesmo valor, mas vence 1 dia depois → FORTE para o rival.
        const boleto = { ...BOLETO, vencimento: '2026-10-20' };
        const { service } = montar({
            titulos: [TITULO, rival],
            boletos: [boleto],
        });
        await expect(service.confirmar({ ...CHAVE, ator: 'ana' })).rejects.toBeInstanceOf(
            BoletoAlreadySuggestedToOtherTitleError,
        );
    });

    it('boleto vencido (antes da data de débito) → 422 OverdueBoletoNotConfirmable', async () => {
        const { service, repo } = montar({
            boletos: [{ ...BOLETO, vencimento: '2026-10-18' }],
        });
        await expect(service.confirmar({ ...CHAVE, ator: 'ana' })).rejects.toBeInstanceOf(
            OverdueBoletoNotConfirmableError,
        );
        expect(repo.inserirDecisao).not.toHaveBeenCalled();
    });

    it('ATENCAO é confirmável, mas o par não alarga o limite: reavaliar continua ATENCAO', async () => {
        const boleto = { ...BOLETO, valor: 106 };
        const base = montar({ boletos: [boleto], pares: [PAR] });
        const antes = await base.service.listarSugestoes({});
        expect(antes.sugestoes[0]?.avaliacao.resultado).toBe('ATENCAO');
        const r = await base.service.confirmar({ ...CHAVE, ator: 'ana' });
        expect(r.decisao.tier).toBe('ATENCAO');
        // Após confirmar, a decisão fica ativa e a sugestão segue ATENCAO (não vira CONHECIDO/FORTE).
        const depois = await base.service.listarSugestoes({});
        expect(depois.sugestoes[0]?.avaliacao.resultado).toBe('ATENCAO');
        expect(depois.sugestoes[0]?.estado).toBe('CONFIRMADA');
        expect(depois.sugestoes[0]?.confirmavel).toBe(false);
    });

    it('emissor de layout GENERICO é gravado como GENERICO e não é elegível a automático', async () => {
        const generico = `001${CODBAR.slice(3)}`;
        const { service, repo } = montar({ boletos: [{ ...BOLETO, codbar: generico }] });
        await service.confirmar({ ...CHAVE, ator: 'ana' });
        expect(repo.inserirPar.mock.calls[0]?.[0]).toMatchObject({ layoutEmissor: 'GENERICO' });
        const views = await service.listarConfirmacoes({});
        expect(views.every((v) => v.layoutEmissor !== 'GENERICO' || !v.elegivelAutomatico)).toBe(
            true,
        );
    });

    it.each(['sistema', 'SISTEMA', 'unknown', '  '])('recusa o ator %p', async (ator) => {
        const { service } = montar();
        await expect(service.confirmar({ ...CHAVE, ator })).rejects.toBeInstanceOf(
            InvalidDecisionActorError,
        );
    });
});

describe('BoletoSuggestionService.rejeitar', () => {
    it('motivo obrigatório → 422', async () => {
        const { service } = montar();
        await expect(
            service.rejeitar({ ...CHAVE, motivo: '   ', ator: 'ana' }),
        ).rejects.toBeInstanceOf(IssuerConfirmationReasonRequiredError);
    });

    it('grava REJEITADA com o motivo e o evento; não toca o par', async () => {
        const { service, repo, eventos } = montar();
        const r = await service.rejeitar({ ...CHAVE, motivo: 'outro credor', ator: 'ana' });
        expect(r.criada).toBe(true);
        expect(repo.inserirDecisao.mock.calls[0]?.[0]).toMatchObject({
            decisao: 'REJEITADA',
            motivo: 'outro credor',
            decididoPor: 'ana',
        });
        expect(repo.inserirPar).not.toHaveBeenCalled();
        expect(repo.revogarPar).not.toHaveBeenCalled();
        expect(eventos.map((e) => e.tipo)).toEqual(['DECISAO_REJEITADA']);
    });

    it('rejeitar já rejeitado é no-op (sem evento)', async () => {
        const { service, repo, eventos } = montar();
        repo.inserirDecisao.mockResolvedValueOnce({
            criada: false,
            decisao: { ...DECISAO, decisao: 'REJEITADA', motivo: 'x' },
        });
        const r = await service.rejeitar({ ...CHAVE, motivo: 'outro credor', ator: 'ana' });
        expect(r.criada).toBe(false);
        expect(eventos).toHaveLength(0);
    });
});

describe('BoletoSuggestionService.revogarPar (I15g, Q-A)', () => {
    it('motivo obrigatório → 422', async () => {
        const { service } = montar({ pares: [PAR] });
        await expect(
            service.revogarPar({ id: 'par-1', motivo: '', ator: 'bia' }),
        ).rejects.toBeInstanceOf(IssuerConfirmationReasonRequiredError);
    });

    it('par inexistente → 404', async () => {
        const { service } = montar();
        await expect(
            service.revogarPar({ id: 'nada', motivo: 'conta trocada', ator: 'bia' }),
        ).rejects.toBeInstanceOf(IssuerConfirmationNotFoundError);
    });

    it('qualquer ator revoga: lock por versão e evento PAR_REVOGADO na mesma transação', async () => {
        const { service, repo, db, eventos, cen } = montar({ pares: [PAR] });
        repo.revogarPar.mockImplementationOnce(async () => {
            cen.pares[0] = { ...PAR, estado: 'REVOGADA', revogadoPor: 'cid', versao: 2 };
            return 1;
        });
        const r = await service.revogarPar({ id: 'par-1', motivo: 'conta trocada', ator: 'cid' });
        expect(repo.revogarPar).toHaveBeenCalledWith(
            { id: 'par-1', versaoEsperada: 1, ator: 'cid', motivo: 'conta trocada' },
            expect.anything(),
        );
        expect(db.withTransaction).toHaveBeenCalled();
        expect(eventos.map((e) => e.tipo)).toEqual(['PAR_REVOGADO']);
        expect(r.estado).toBe('REVOGADA');
        expect(r).not.toHaveProperty('emissorChave');
    });

    it('par já REVOGADA é no-op (sem escrita, sem evento)', async () => {
        const { service, repo, eventos } = montar({
            pares: [{ ...PAR, estado: 'REVOGADA', motivoRevogacao: 'x', revogadoPor: 'a' }],
        });
        const r = await service.revogarPar({ id: 'par-1', motivo: 'de novo', ator: 'bia' });
        expect(r.estado).toBe('REVOGADA');
        expect(repo.revogarPar).not.toHaveBeenCalled();
        expect(eventos).toHaveLength(0);
    });
});

const TIT = { filCod: 1, docCod: '9001', titCod: '1' };

describe('BoletoSuggestionService.anularDecisao (I15l)', () => {
    it('CONFIRMADA → ANULADA com lock por versão e evento DECISAO_ANULADA, numa transação', async () => {
        const { service, repo, db, eventos } = montar({ pares: [PAR], decisoes: [{ ...DECISAO }] });
        const r = await service.anularDecisao({
            ...TIT,
            motivo: 'boleto de outro credor',
            ator: 'cid',
        });
        expect(r.anulada).toBe(true);
        expect(r.decisao).toMatchObject({
            decisao: 'ANULADA',
            anuladaPor: 'cid',
            motivoAnulacao: 'boleto de outro credor',
        });
        expect(repo.anularDecisao).toHaveBeenCalledWith(
            { id: 'dec-1', versaoEsperada: 1, ator: 'cid', motivo: 'boleto de outro credor' },
            expect.anything(),
        );
        expect(db.withTransaction).toHaveBeenCalledTimes(1);
        expect(eventos).toHaveLength(1);
        expect(eventos[0]).toMatchObject({
            tipo: 'DECISAO_ANULADA',
            ator: 'cid',
            docCod: '9001',
            ddcCod: 500,
            ditCod: 1,
            motivo: 'boleto de outro credor',
        });
        expect(JSON.stringify(eventos)).not.toContain(CODBAR);
    });

    it('idempotente: já ANULADA devolve a decisão, sem escrita nem evento', async () => {
        const anulada = {
            ...DECISAO,
            decisao: 'ANULADA',
            anuladaPor: 'cid',
            anuladaEm: '2026-10-14T12:00:00.000Z',
            motivoAnulacao: 'confirmação errada',
            versao: 2,
        } as DecisaoSugestao;
        const { service, repo, db, eventos } = montar({ decisoes: [anulada] });
        const r = await service.anularDecisao({
            ...TIT,
            motivo: 'de novo, por favor',
            ator: 'bia',
        });
        expect(r.anulada).toBe(false);
        expect(r.decisao.id).toBe('dec-1');
        expect(repo.anularDecisao).not.toHaveBeenCalled();
        expect(db.withTransaction).not.toHaveBeenCalled();
        expect(eventos).toHaveLength(0);
    });

    it('título sem decisão CONFIRMADA (nada ou só REJEITADA) → DecisionNotConfirmedError 409', async () => {
        const vazio = montar();
        await expect(
            vazio.service.anularDecisao({ ...TIT, motivo: 'confirmação errada', ator: 'ana' }),
        ).rejects.toBeInstanceOf(DecisionNotConfirmedError);
        const rejeitada = montar({
            decisoes: [{ ...DECISAO, decisao: 'REJEITADA', motivo: 'não é' } as DecisaoSugestao],
        });
        await expect(
            rejeitada.service.anularDecisao({ ...TIT, motivo: 'confirmação errada', ator: 'ana' }),
        ).rejects.toBeInstanceOf(DecisionNotConfirmedError);
        expect(new DecisionNotConfirmedError(TIT).statusCode).toBe(409);
    });

    it('motivo curto (< 10) ou em branco → 422 nomeado, nada lido nem gravado', async () => {
        const { service, repo, db } = montar({ decisoes: [{ ...DECISAO }] });
        for (const motivo of ['', '   ', 'curto']) {
            await expect(
                service.anularDecisao({ ...TIT, motivo, ator: 'ana' }),
            ).rejects.toBeInstanceOf(IssuerConfirmationReasonRequiredError);
        }
        expect(repo.listarDecisoes).not.toHaveBeenCalled();
        expect(db.withTransaction).not.toHaveBeenCalled();
    });

    it('perdeu a corrida (versão mudou e ainda CONFIRMADA) → conflito de versão, sem evento', async () => {
        const { service, repo, eventos } = montar({ decisoes: [{ ...DECISAO }] });
        repo.anularDecisao.mockResolvedValueOnce(0);
        await expect(
            service.anularDecisao({ ...TIT, motivo: 'confirmação errada', ator: 'ana' }),
        ).rejects.toBeInstanceOf(IssuerConfirmationVersionConflictError);
        expect(eventos).toHaveLength(0);
    });

    it('perdeu a corrida para outra anulação → no-op (anulada = false), sem evento', async () => {
        const { service, repo, eventos, cen } = montar({ decisoes: [{ ...DECISAO }] });
        repo.anularDecisao.mockImplementationOnce(async () => {
            const d = cen.decisoes[0] as DecisaoSugestao;
            cen.decisoes[0] = { ...d, decisao: 'ANULADA', versao: 2 };
            return 0;
        });
        const r = await service.anularDecisao({
            ...TIT,
            motivo: 'confirmação errada',
            ator: 'ana',
        });
        expect(r.anulada).toBe(false);
        expect(eventos).toHaveLength(0);
    });

    it('anular libera título e boleto: a sugestão volta a ser confirmável', async () => {
        const { service } = montar({ pares: [PAR], decisoes: [{ ...DECISAO }] });
        const antes = await service.listarSugestoes({});
        expect(antes.sugestoes[0]).toMatchObject({ estado: 'CONFIRMADA', confirmavel: false });
        await service.anularDecisao({ ...TIT, motivo: 'confirmação errada', ator: 'ana' });
        const depois = await service.listarSugestoes({});
        expect(depois.sugestoes[0]).toMatchObject({ estado: 'SUGERIDA', confirmavel: true });
    });
});

describe('revogarPar em cascata (I15l, Q-E)', () => {
    it('anula toda decisão CONFIRMADA do par, com motivo composto, um evento cada, na mesma transação', async () => {
        const outra: DecisaoSugestao = {
            ...DECISAO,
            id: 'dec-2',
            docCod: '9002',
            ddcCod: 501,
        };
        const { service, repo, db, eventos, cen } = montar({
            pares: [PAR],
            decisoes: [{ ...DECISAO }, outra],
        });
        repo.revogarPar.mockImplementationOnce(async () => {
            cen.pares[0] = { ...PAR, estado: 'REVOGADA', revogadoPor: 'cid', versao: 2 };
            return 1;
        });
        await service.revogarPar({ id: 'par-1', motivo: 'conta trocada', ator: 'cid' });
        expect(db.withTransaction).toHaveBeenCalledTimes(1);
        expect(cen.decisoes.map((d) => d.decisao)).toEqual(['ANULADA', 'ANULADA']);
        expect(cen.decisoes[0]).toMatchObject({
            motivoAnulacao: 'par revogado: conta trocada',
            anuladaPor: 'cid',
        });
        expect(eventos.map((e) => e.tipo)).toEqual([
            'DECISAO_ANULADA',
            'DECISAO_ANULADA',
            'PAR_REVOGADO',
        ]);
        expect(eventos[2]?.detalhe).toMatchObject({ decisoesAnuladas: 2 });
    });

    it('par sem decisões: só PAR_REVOGADO', async () => {
        const { service, repo, eventos, cen } = montar({ pares: [PAR] });
        repo.revogarPar.mockImplementationOnce(async () => {
            cen.pares[0] = { ...PAR, estado: 'REVOGADA', versao: 2 };
            return 1;
        });
        await service.revogarPar({ id: 'par-1', motivo: 'conta trocada', ator: 'cid' });
        expect(eventos.map((e) => e.tipo)).toEqual(['PAR_REVOGADO']);
    });

    it('decisão REJEITADA do mesmo par não é tocada', async () => {
        const rej = {
            ...DECISAO,
            id: 'dec-r',
            decisao: 'REJEITADA',
            motivo: 'não é',
        } as DecisaoSugestao;
        const { service, repo, cen } = montar({ pares: [PAR], decisoes: [rej] });
        repo.revogarPar.mockImplementationOnce(async () => {
            cen.pares[0] = { ...PAR, estado: 'REVOGADA', versao: 2 };
            return 1;
        });
        await service.revogarPar({ id: 'par-1', motivo: 'conta trocada', ator: 'cid' });
        expect(repo.anularDecisao).not.toHaveBeenCalled();
    });
});

describe('confirmação órfã na listagem (I15l)', () => {
    it('boleto saiu do pool: devolve CONFIRMADA órfã, não confirmável, com motivo em português', async () => {
        const { service } = montar({ pares: [PAR], boletos: [], decisoes: [{ ...DECISAO }] });
        const r = await service.listarSugestoes({});
        expect(r.total).toBe(1);
        expect(r.sugestoes[0]).toMatchObject({
            docCod: '9001',
            estado: 'CONFIRMADA',
            orfa: true,
            confirmavel: false,
            ddcCod: 500,
            ditCod: 1,
        });
        expect(r.sugestoes[0]?.motivoOrfa).toMatch(/saiu do pool DDA/);
    });

    it('título sinalizado pelo ERP depois da confirmação: órfã com o motivo do ERP', async () => {
        const { service } = montar({
            pares: [PAR],
            titulos: [{ ...TITULO, temBoleto: true }],
            decisoes: [{ ...DECISAO }],
        });
        const r = await service.listarSugestoes({});
        expect(r.sugestoes[0]).toMatchObject({ orfa: true, estado: 'CONFIRMADA' });
        expect(r.sugestoes[0]?.motivoOrfa).toMatch(/sinalizou boleto DDA/);
    });

    it('título pago/inativo não aparece, e o boleto dele não fica ocupado', async () => {
        const outro: TituloAPagar = { ...TITULO, docCod: '9100', titCod: '1' };
        const { service } = montar({
            titulos: [{ ...TITULO, pago: true }, outro],
            decisoes: [{ ...DECISAO }],
        });
        const r = await service.listarSugestoes({});
        expect(r.sugestoes.map((s) => s.docCod)).toEqual(['9100']);
        expect(r.sugestoes[0]).toMatchObject({ estado: 'SUGERIDA', ddcCod: 500, ditCod: 1 });
    });
});

describe('BoletoSuggestionService.copiarLinha (I15k, fail-closed)', () => {
    it('grava LINHA_COPIADA ANTES de devolver a linha digitável', async () => {
        const { service, repo, eventos } = montar();
        const ordem: string[] = [];
        repo.inserirEvento.mockImplementationOnce(async (e: Record<string, unknown>) => {
            ordem.push('evento');
            eventos.push(e);
            return 'ev';
        });
        const r = await service.copiarLinha({ ...CHAVE, ator: 'ana' });
        ordem.push('retorno');
        expect(ordem).toEqual(['evento', 'retorno']);
        expect(r.linhaDigitavel).toBe(LINHA);
        expect(eventos[0]).toMatchObject({
            tipo: 'LINHA_COPIADA',
            ator: 'ana',
            filCod: 1,
            docCod: '9001',
            titCod: '1',
            ddcCod: 500,
            ditCod: 1,
        });
        const gravado = JSON.stringify(eventos);
        expect(gravado).not.toContain(LINHA);
        expect(gravado).not.toContain(CODBAR);
    });

    it('se a trilha falhar, a linha NÃO é devolvida (LineCopyAuditFailedError)', async () => {
        const { service, repo } = montar();
        repo.inserirEvento.mockRejectedValueOnce(new Error('db fora'));
        await expect(service.copiarLinha({ ...CHAVE, ator: 'ana' })).rejects.toBeInstanceOf(
            LineCopyAuditFailedError,
        );
    });

    it('boleto sem código de barras válido → indisponível, sem evento', async () => {
        const { service, eventos } = montar({ boletos: [{ ...BOLETO, codbar: undefined }] });
        await expect(service.copiarLinha({ ...CHAVE, ator: 'ana' })).rejects.toBeInstanceOf(
            BoletoSuggestionNotAvailableError,
        );
        expect(eventos).toHaveLength(0);
    });
});

describe('zero escrita e zero chamada ao Conexos (I15a/I15b)', () => {
    it('o serviço não importa nenhum client do Conexos', () => {
        const fonte = readFileSync(path.join(__dirname, 'BoletoSuggestionService.ts'), 'utf8');
        expect(fonte).not.toMatch(/Conexos(Base|Dda|Sispag)?Client/);
        expect(fonte).not.toMatch(/postGenericOnce|\.post\(|\.put\(/);
    });

    it('resolvido pelo container, nenhum client do Conexos é tocado em nenhum caminho', async () => {
        const tocado: string[] = [];
        const espiao = (nome: string) =>
            new Proxy(
                {},
                {
                    get: (_t, prop) => {
                        tocado.push(`${nome}.${String(prop)}`);
                        return () => {
                            throw new Error('Conexos tocado');
                        };
                    },
                },
            );
        const ConexosBaseClient = (await import('../../client/ConexosBaseClient.js')).default;
        const ConexosDdaClient = (await import('../../client/ConexosDdaClient.js')).default;
        container.registerInstance(ConexosBaseClient, espiao('base') as never);
        container.registerInstance(ConexosDdaClient, espiao('dda') as never);
        try {
            const { service } = montar({ pares: [PAR] });
            await service.listarSugestoes({});
            await service.rejeitar({ ...CHAVE, motivo: 'x', ator: 'ana' });
            await montar({ pares: [PAR] }).service.confirmar({ ...CHAVE, ator: 'ana' });
            await service.copiarLinha({ ...CHAVE, ator: 'ana' });
            await service.revogarPar({ id: 'par-1', motivo: 'm', ator: 'ana' });
            expect(tocado).toEqual([]);
        } finally {
            container.clearInstances();
        }
    });
});

describe('logs (português, sem barras nem linha digitável)', () => {
    it('confirmar emite sugestao_boleto.decisao estruturado e nenhum log carrega barras/linha', async () => {
        const { service, logService } = montar();
        await service.confirmar({ ...CHAVE, ator: 'ana' });
        await service.copiarLinha({ ...CHAVE, ator: 'ana' });
        const chamadas = [...logService.info.mock.calls, ...logService.warn.mock.calls];
        const mensagens = chamadas.map((c) => String((c[0] as { message: string }).message));
        expect(mensagens).toContain('sugestao_boleto.decisao');
        const tudo = JSON.stringify(chamadas);
        expect(tudo).not.toContain(CODBAR);
        expect(tudo).not.toContain(LINHA);
        expect(tudo).not.toMatch(/\d{30,}/);
        const decisao = chamadas
            .map((c) => c[0] as { message: string; data?: Record<string, unknown> })
            .find((p) => p.message === 'sugestao_boleto.decisao');
        expect(decisao?.data).toMatchObject({ decisao: 'CONFIRMADA', tier: 'FORTE' });
    });
});

describe('erros nomeados e entradas ruins (PatternGuardian)', () => {
    it.each([
        'sistema',
        'unknown',
        '  ',
    ])('ator %p é InvalidDecisionActorError (403) em todas as ações', async (ator) => {
        const { service } = montar({ pares: [PAR] });
        const chamadas = [
            () => service.confirmar({ ...CHAVE, ator }),
            () => service.rejeitar({ ...CHAVE, motivo: 'x', ator }),
            () => service.revogarPar({ id: 'par-1', motivo: 'x', ator }),
            () =>
                service.anularDecisao({
                    filCod: 1,
                    docCod: '9001',
                    titCod: '1',
                    motivo: 'confirmação errada',
                    ator,
                }),
            () => service.copiarLinha({ ...CHAVE, ator }),
        ];
        for (const chamar of chamadas) {
            await expect(chamar()).rejects.toBeInstanceOf(InvalidDecisionActorError);
        }
    });

    it('revogar com conflito de versão e par ainda VIGENTE → IssuerConfirmationVersionConflictError', async () => {
        const { service, repo, eventos } = montar({ pares: [PAR] });
        repo.revogarPar.mockResolvedValueOnce(0);
        await expect(
            service.revogarPar({ id: 'par-1', motivo: 'conta trocada', ator: 'bia' }),
        ).rejects.toBeInstanceOf(IssuerConfirmationVersionConflictError);
        expect(eventos).toHaveLength(0);
    });

    it('rejeitar: título sem vencimento → indisponível, antes da transação', async () => {
        const { service, db, repo } = montar({
            titulos: [{ ...TITULO, vencimento: undefined as never }],
        });
        await expect(
            service.rejeitar({ ...CHAVE, motivo: 'x', ator: 'ana' }),
        ).rejects.toBeInstanceOf(BoletoSuggestionNotAvailableError);
        expect(db.withTransaction).not.toHaveBeenCalled();
        expect(repo.inserirDecisao).not.toHaveBeenCalled();
    });

    it('rejeitar: boleto sem vencimento → indisponível, antes da transação', async () => {
        const { service, db } = montar({
            boletos: [{ ...BOLETO, vencimento: undefined as never }],
        });
        await expect(
            service.rejeitar({ ...CHAVE, motivo: 'x', ator: 'ana' }),
        ).rejects.toBeInstanceOf(BoletoSuggestionNotAvailableError);
        expect(db.withTransaction).not.toHaveBeenCalled();
    });

    it('rejeitar: título sem credor (pesCod) → indisponível, nunca grava pes_cod vazio', async () => {
        const { service, db, repo } = montar({
            titulos: [{ ...TITULO, pesCod: undefined as never }],
        });
        await expect(
            service.rejeitar({ ...CHAVE, motivo: 'x', ator: 'ana' }),
        ).rejects.toBeInstanceOf(BoletoSuggestionNotAvailableError);
        expect(db.withTransaction).not.toHaveBeenCalled();
        expect(repo.inserirDecisao).not.toHaveBeenCalled();
    });

    it('log de falha da trilha leva só message e code, nunca o objeto do erro', async () => {
        const { service, repo, logService } = montar();
        repo.inserirEvento.mockRejectedValueOnce(
            Object.assign(new Error('insert falhou'), {
                code: '23505',
                detail: 'Key (codbar)=(23791...) already exists',
            }),
        );
        await expect(service.copiarLinha({ ...CHAVE, ator: 'ana' })).rejects.toBeInstanceOf(
            LineCopyAuditFailedError,
        );
        const payload = logService.warn.mock.calls[0]?.[0] as Record<string, unknown>;
        expect(payload.error).toBeUndefined();
        expect(payload.data).toMatchObject({ erro: 'insert falhou', codigoErro: '23505' });
        expect(JSON.stringify(payload)).not.toContain('detail');
        expect(JSON.stringify(payload)).not.toContain('already exists');
    });
});

describe('BoletoSuggestionService — desfecho por título e aviso (I15m–I15o, ADR-0072)', () => {
    const LOTE_DEBITO_15 = [
        {
            filCod: 1,
            docCod: '9001',
            titCod: '1',
            loteId: 'l1',
            status: 'RASCUNHO',
            dataDebito: '2026-10-15',
        },
    ];
    // título vence 20/10, boleto 18/10, débito antecipado 15/10 → Δ −2, o boleto ainda vale (caso B)
    const BOLETO_ANTES = { ...BOLETO, vencimento: '2026-10-18' };
    const comLote = (m: ReturnType<typeof montar>) =>
        m.loteRepo.listTitulosEmLotesAbertos.mockResolvedValue(LOTE_DEBITO_15 as never);

    describe('listagem por título', () => {
        it('uma linha por título elegível, com situação, total e aviso; contagem soma os títulos', async () => {
            const semCandidato: TituloAPagar = { ...TITULO, docCod: '9100', valor: 5000 };
            const fraco: TituloAPagar = { ...TITULO, docCod: '9200', valor: 300 };
            const m = montar({
                titulos: [TITULO, semCandidato, fraco],
                boletos: [BOLETO, { ...BOLETO, ditCod: 2, valor: 304 }],
            });
            const r = await m.service.listarSugestoes({});
            expect(r.titulos).toHaveLength(3);
            const por = (doc: string) => r.titulos.find((t) => t.docCod === doc);
            expect(por('9001')).toMatchObject({
                situacao: 'UNICA_SEGURA',
                totalCandidatos: 1,
                avisoVenceAntes: 'NENHUM',
                diasVencidoNoDebito: 0,
            });
            expect(por('9100')).toMatchObject({ situacao: 'SEM_CANDIDATO', totalCandidatos: 0 });
            expect(por('9200')?.situacao).toBe('SO_FRACA');
            expect(r.totalTitulos).toBe(3);
            const soma = Object.values(r.contagemSituacao).reduce((a, b) => a + b, 0);
            expect(soma).toBe(3);
            expect(r.contagemSituacao).toMatchObject({
                UNICA_SEGURA: 1,
                SEM_CANDIDATO: 1,
                SO_FRACA: 1,
            });
            expect(r.sincronizadoEm).toBe(HOJE.getTime() - 2 * 3_600_000);
            expect(r.sugestoes).toHaveLength(1); // contrato antigo preservado
        });

        it('avisoVenceAntes: ATENCAO no caso B e CRITICO no caso A, com os dias de atraso', async () => {
            const b = montar({ boletos: [BOLETO_ANTES], pares: [PAR] });
            comLote(b);
            const rb = await b.service.listarSugestoes({});
            expect(rb.titulos[0]).toMatchObject({
                situacao: 'SO_ATENCAO',
                avisoVenceAntes: 'ATENCAO',
                diasVencidoNoDebito: 0,
            });
            const a = montar({ boletos: [{ ...BOLETO, vencimento: '2026-10-17' }] });
            const ra = await a.service.listarSugestoes({});
            expect(ra.titulos[0]).toMatchObject({
                situacao: 'SO_VENCIDA',
                avisoVenceAntes: 'CRITICO',
                diasVencidoNoDebito: 3,
            });
        });

        it('o candidato traz o id do par vigente do emissor (para revogar pela tela), sem a chave', async () => {
            const { service } = montar({ pares: [PAR] });
            const r = await service.listarSugestoes({});
            expect(r.titulos[0]?.candidatos[0]).toMatchObject({
                confirmacaoEmissorId: 'par-1',
                emissor: { mascarado: '237 / 2656 / ***2740' },
            });
            expect(JSON.stringify(r.titulos)).not.toContain('237:2656:0092740');
        });

        it('1,1 mil títulos produzem 1,1 mil linhas (abaixo do teto de 2000)', async () => {
            const titulos = Array.from({ length: 1100 }, (_, i) => ({
                ...TITULO,
                docCod: String(20_000 + i),
                valor: 5000 + i * 100,
            }));
            const { service } = montar({ titulos, boletos: [] });
            const r = await service.listarSugestoes({ tamanho: 2000 });
            expect(r.titulos).toHaveLength(1100);
            expect(r.totalTitulos).toBe(1100);
        });

        it('filtra por situação e conta antes desse filtro; sem barras nem linha digitável', async () => {
            const fraco: TituloAPagar = { ...TITULO, docCod: '9200', valor: 300 };
            const { service } = montar({
                titulos: [TITULO, fraco],
                boletos: [BOLETO, { ...BOLETO, ditCod: 2, valor: 304 }],
            });
            const r = await service.listarSugestoes({ situacao: 'SO_FRACA' });
            expect(r.titulos.map((t) => t.docCod)).toEqual(['9200']);
            expect(r.contagemSituacao.UNICA_SEGURA).toBe(1);
            const json = JSON.stringify(r);
            expect(json).not.toContain(CODBAR);
            expect(json).not.toContain(LINHA);
            expect(json).not.toMatch(/\d{30,}/);
        });

        it('o log do cenário traz a contagem por situação, sem barras', async () => {
            const { service, logService } = montar();
            await service.listarSugestoes({});
            const calculo = logService.info.mock.calls
                .map((c) => c[0] as { message: string; data?: Record<string, unknown> })
                .find((p) => p.message === 'sugestao_boleto.cenario_calculado');
            expect(calculo?.data?.situacoes).toMatchObject({ UNICA_SEGURA: 1 });
            expect(JSON.stringify(calculo)).not.toContain(CODBAR);
        });
    });

    describe('detalhe por título', () => {
        it('devolve até 3 candidatos com Δ com sinal, emissor mascarado e sem barras', async () => {
            const boletos = [104, 102, 106, 108].map((v, i) => ({
                ...BOLETO,
                ditCod: 10 + i,
                valor: v,
            }));
            const { service } = montar({ boletos });
            const d = await service.detalharTitulo(TIT_CHAVE);
            expect(d.situacao).toBe('SO_FRACA');
            expect(d.totalCandidatos).toBe(4);
            expect(d.candidatos).toHaveLength(3);
            expect(d.candidatos.map((c) => c.avaliacao.deltaValor)).toEqual([2, 4, 6]);
            expect(d.candidatos[0]?.emissor).toEqual({
                banco: '237',
                layout: 'BRADESCO_237',
                mascarado: '237 / 2656 / ***2740',
            });
            const json = JSON.stringify(d);
            expect(json).not.toContain(CODBAR);
            expect(json).not.toContain(LINHA);
            expect(json).not.toContain('0092740');
            expect(json).not.toMatch(/\d{30,}/);
        });

        it('título inelegível ou inexistente → 404 nomeado', async () => {
            const { service } = montar({ titulos: [{ ...TITULO, pago: true }] });
            await expect(service.detalharTitulo(TIT_CHAVE)).rejects.toBeInstanceOf(
                TitleSuggestionNotFoundError,
            );
            await expect(
                service.detalharTitulo({ ...TIT_CHAVE, docCod: '0000' }),
            ).rejects.toBeInstanceOf(TitleSuggestionNotFoundError);
        });
    });

    describe('confirmar: exibir ≠ confirmar (409)', () => {
        const nada = (m: ReturnType<typeof montar>) => {
            expect(m.repo.inserirPar).not.toHaveBeenCalled();
            expect(m.repo.inserirDecisao).not.toHaveBeenCalled();
            expect(m.eventos).toHaveLength(0);
        };

        it('SO_FRACA (ATENCAO sem âncora) → 409 com o motivo, nada gravado', async () => {
            const m = montar({ boletos: [{ ...BOLETO, valor: 104 }] });
            const antes = await m.service.listarSugestoes({});
            expect(antes.titulos[0]?.situacao).toBe('SO_FRACA');
            await expect(m.service.confirmar({ ...CHAVE, ator: 'ana' })).rejects.toMatchObject({
                statusCode: 409,
                code: 'SUGESTAO_BOLETO_INDISPONIVEL',
                userMessage: expect.stringContaining('Sem confirmação'),
            });
            nada(m);
        });

        it('AMBIGUA → 409; depois de rejeitar o outro, confirma', async () => {
            const m = montar({ boletos: [BOLETO, { ...BOLETO, ditCod: 2 }] });
            await expect(m.service.confirmar({ ...CHAVE, ator: 'ana' })).rejects.toBeInstanceOf(
                BoletoSuggestionNotAvailableError,
            );
            nada(m);
            await m.service.rejeitar({ ...CHAVE, ditCod: 2, motivo: 'outro título', ator: 'ana' });
            const r = await m.service.confirmar({ ...CHAVE, ator: 'ana' });
            expect(r.criada).toBe(true);
        });

        it('DISPUTADA (boleto reservado a outro título) → 409, nada gravado', async () => {
            const rival: TituloAPagar = {
                ...TITULO,
                docCod: '1000',
                vencimento: utc('2026-10-19'),
            };
            const m = montar({
                titulos: [TITULO, rival],
                boletos: [{ ...BOLETO, vencimento: '2026-10-20' }],
            });
            const lista = await m.service.listarSugestoes({});
            expect(lista.titulos.find((t) => t.docCod === '9001')?.situacao).toBe('DISPUTADA');
            await expect(m.service.confirmar({ ...CHAVE, ator: 'ana' })).rejects.toMatchObject({
                statusCode: 409,
            });
            nada(m);
        });

        it('mesmo com a regra pura dizendo confirmável, o serviço recusa o fraco (trava no serviço)', async () => {
            const m = montar({ boletos: [{ ...BOLETO, valor: 104 }] });
            const direta = regra.avaliar({
                titulo: { valor: 100, vencimento: '2026-10-20' },
                boleto: { valor: 104, vencimento: '2026-10-20' },
                dataDebito: '2026-10-20',
                parConfirmado: false,
            });
            expect(direta.confirmavel).toBe(true);
            await expect(m.service.confirmar({ ...CHAVE, ator: 'ana' })).rejects.toBeInstanceOf(
                BoletoSuggestionNotAvailableError,
            );
            nada(m);
        });
    });

    describe('confirmar: aviso VENCE_ANTES_DO_TITULO exige reconhecimento (422)', () => {
        const caminhoB = () => {
            const m = montar({ boletos: [BOLETO_ANTES], pares: [PAR] });
            comLote(m);
            return m;
        };

        it('sem reconheceAvisos → 422 WarningAcknowledgementRequiredError, nada gravado', async () => {
            const m = caminhoB();
            await expect(m.service.confirmar({ ...CHAVE, ator: 'ana' })).rejects.toBeInstanceOf(
                WarningAcknowledgementRequiredError,
            );
            expect(m.repo.inserirDecisao).not.toHaveBeenCalled();
            expect(m.repo.inserirPar).not.toHaveBeenCalled();
            expect(m.db.withTransaction).not.toHaveBeenCalled();
        });

        it('com o reconhecimento → grava os dois sinais e registra no evento', async () => {
            const m = caminhoB();
            const r = await m.service.confirmar({
                ...CHAVE,
                ator: 'ana',
                reconheceAvisos: ['VENCE_ANTES_DO_TITULO'],
            });
            expect(r.criada).toBe(true);
            const dec = m.repo.inserirDecisao.mock.calls[0]?.[0] as Record<string, unknown>;
            expect(dec.sinais).toEqual(
                expect.arrayContaining(['VENCE_ANTES_DO_TITULO', 'RECONHECEU_VENCE_ANTES']),
            );
            expect(dec).toMatchObject({ tier: 'ATENCAO', deltaDias: -2 });
            const confirmado = m.eventos.find((e) => e.tipo === 'DECISAO_CONFIRMADA');
            expect(confirmado?.detalhe).toMatchObject({
                reconheceu: ['VENCE_ANTES_DO_TITULO'],
            });
        });

        it('ack é conferido contra a avaliação recalculada, nunca contra o cache', async () => {
            const m = montar({ boletos: [BOLETO_ANTES], pares: [PAR] });
            // cache quente SEM lote: débito = vencimento do título; o boleto aparece vencido (caso A)
            await m.service.listarSugestoes({});
            // o lote antecipa o débito DEPOIS: agora é o caso B e a releitura vê o sinal
            comLote(m);
            await expect(m.service.confirmar({ ...CHAVE, ator: 'ana' })).rejects.toBeInstanceOf(
                WarningAcknowledgementRequiredError,
            );
        });

        it('ack enviado sem aviso no servidor é aceito mas NÃO grava RECONHECEU_VENCE_ANTES', async () => {
            const m = montar();
            await m.service.confirmar({
                ...CHAVE,
                ator: 'ana',
                reconheceAvisos: ['VENCE_ANTES_DO_TITULO'],
            });
            const dec = m.repo.inserirDecisao.mock.calls[0]?.[0] as { sinais: string[] };
            expect(dec.sinais).not.toContain('RECONHECEU_VENCE_ANTES');
            expect(dec.sinais).not.toContain('VENCE_ANTES_DO_TITULO');
        });

        it('caso A (boleto antes do débito) segue 422 OverdueBoletoNotConfirmable, mesmo com ack', async () => {
            const m = montar({ boletos: [{ ...BOLETO, vencimento: '2026-10-17' }] });
            await expect(
                m.service.confirmar({
                    ...CHAVE,
                    ator: 'ana',
                    reconheceAvisos: ['VENCE_ANTES_DO_TITULO'],
                }),
            ).rejects.toBeInstanceOf(OverdueBoletoNotConfirmableError);
            expect(m.repo.inserirDecisao).not.toHaveBeenCalled();
        });

        it('idempotência: reconfirmar decisão existente devolve criada:false sem exigir ack', async () => {
            const m = montar({
                boletos: [BOLETO_ANTES],
                pares: [PAR],
                decisoes: [{ ...DECISAO, vencimentoBoleto: '2026-10-18', deltaDias: -2 }],
            });
            comLote(m);
            const r = await m.service.confirmar({ ...CHAVE, ator: 'bia' });
            expect(r.criada).toBe(false);
            expect(m.repo.inserirDecisao).not.toHaveBeenCalled();
        });
    });

    describe('rejeitar candidato exibido (Q2)', () => {
        it('permite rejeitar o fraco e esconde o par, com motivo', async () => {
            const m = montar({ boletos: [{ ...BOLETO, valor: 104 }] });
            const r = await m.service.rejeitar({ ...CHAVE, motivo: 'não é este', ator: 'ana' });
            expect(r.criada).toBe(true);
            expect(m.repo.inserirDecisao.mock.calls[0]?.[0]).toMatchObject({
                decisao: 'REJEITADA',
            });
        });

        it('recusa rejeitar o vencido na data de débito (só informativo)', async () => {
            const m = montar({ boletos: [{ ...BOLETO, vencimento: '2026-10-17' }] });
            await expect(
                m.service.rejeitar({ ...CHAVE, motivo: 'não é este', ator: 'ana' }),
            ).rejects.toBeInstanceOf(BoletoSuggestionNotAvailableError);
            expect(m.repo.inserirDecisao).not.toHaveBeenCalled();
        });
    });

    it('anular e copiar linha seguem inalterados', async () => {
        const m = montar({ pares: [PAR], decisoes: [{ ...DECISAO }] });
        const r = await m.service.anularDecisao({
            ...TIT_CHAVE,
            motivo: 'confirmação errada',
            ator: 'cid',
        });
        expect(r.anulada).toBe(true);
        const c = await m.service.copiarLinha({ ...CHAVE, ator: 'ana' });
        expect(c.linhaDigitavel).toBe(LINHA);
    });
});

const TIT_CHAVE = { filCod: 1, docCod: '9001', titCod: '1' };
