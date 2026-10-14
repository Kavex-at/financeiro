import 'reflect-metadata';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { container } from 'tsyringe';
import BoletoAlreadySuggestedToOtherTitleError from '../../errors/BoletoAlreadySuggestedToOtherTitleError.js';
import BoletoSuggestionNotAvailableError from '../../errors/BoletoSuggestionNotAvailableError.js';
import IssuerConfirmationNotFoundError from '../../errors/IssuerConfirmationNotFoundError.js';
import IssuerConfirmationReasonRequiredError from '../../errors/IssuerConfirmationReasonRequiredError.js';
import LineCopyAuditFailedError from '../../errors/LineCopyAuditFailedError.js';
import OverdueBoletoNotConfirmableError from '../../errors/OverdueBoletoNotConfirmableError.js';
import type { BoletoDda } from '../../interface/sispag/BoletoDda.js';
import type {
    ConfirmacaoEmissor,
    DecisaoSugestao,
} from '../../interface/sispag/ConfirmacaoEmissorBoleto.js';
import type { TituloAPagar } from '../../interface/sispag/SispagInterface.js';
import CodigoBarrasBoleto from '../../libs/boleto/CodigoBarrasBoleto.js';
import BankingCalendar from '../../libs/calendar/BankingCalendar.js';
import BoletoSuggestionService from './BoletoSuggestionService.js';
import MotorSugestaoBoleto from './MotorSugestaoBoleto.js';
import RegraSugestaoBoleto from './RegraSugestaoBoleto.js';

const HOJE = new Date('2026-10-14T15:00:00Z'); // quarta-feira
const calendar = BankingCalendar.withClock(() => HOJE);
const codigoBarras = new CodigoBarrasBoleto();
const regra = new RegraSugestaoBoleto();
const motor = new MotorSugestaoBoleto(codigoBarras, calendar, regra);

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
};

interface Cenario {
    titulos: TituloAPagar[];
    boletos: BoletoDda[];
    pares: ConfirmacaoEmissor[];
    decisoes: DecisaoSugestao[];
}

const montar = (over: Partial<Cenario> = {}) => {
    const cen: Cenario = {
        titulos: [TITULO],
        boletos: [BOLETO],
        pares: [],
        decisoes: [],
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
    const tx = {};
    const db = { withTransaction: jest.fn(async (fn: (t: unknown) => unknown) => fn(tx)) };
    const logService = {
        info: jest.fn().mockResolvedValue(undefined),
        warn: jest.fn().mockResolvedValue(undefined),
    };
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
    );
    return { service, repo, tituloRepo, boletoRepo, loteRepo, db, logService, eventos, cen };
};

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
        await expect(service.confirmar({ ...CHAVE, ator })).rejects.toThrow(/ator/i);
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
