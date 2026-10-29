import 'reflect-metadata';
import type { BoletoDda } from '../../interface/sispag/BoletoDda.js';
import type { TituloAPagar } from '../../interface/sispag/SispagInterface.js';
import {
    AVISO_CONJUNTO,
    type IrmaoConjunto,
} from '../../interface/sispag/ConfirmacaoEmConjunto.js';
import {
    type AvaliacaoSugestao,
    EXIGE_RECONHECIMENTO,
    SINAL_SUGESTAO,
} from '../../interface/sispag/SugestaoBoleto.js';
import CodigoBarrasBoleto from '../../libs/boleto/CodigoBarrasBoleto.js';
import BankingCalendar from '../../libs/calendar/BankingCalendar.js';
import AncoraOrdemDps from './AncoraOrdemDps.js';
import MotorSugestaoBoleto, { type EntradaMotorSugestao } from './MotorSugestaoBoleto.js';
import RegraIrmaosConjunto from './RegraIrmaosConjunto.js';
import RegraSugestaoBoleto from './RegraSugestaoBoleto.js';

// I15t (ADR-0080): elegibilidade e avisos da confirmação em conjunto, sobre o motor real.
const calendar = BankingCalendar.withClock(() => new Date('2026-10-26T15:00:00Z'));
const motor = new MotorSugestaoBoleto(
    new CodigoBarrasBoleto(),
    calendar,
    new RegraSugestaoBoleto(),
    new AncoraOrdemDps(),
);

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
const barras = (banco: string, livre: string): string => {
    const semDv = `${banco}91580${'0000481533'}${livre}`;
    return `${banco}9${dvGeral(semDv)}1580${'0000481533'}${livre}`;
};
const bradesco = (agencia: string, conta: string, n: number): string =>
    barras('237', `${agencia}09${String(n).padStart(11, '0')}${conta}0`);

const EMISSOR_A = { agencia: '2656', conta: '0092740' };
const EMISSOR_B = { agencia: '2656', conta: '0099999' };

const DIA = '2026-10-27';

const titulo = (docCod: string, over: Partial<TituloAPagar> = {}): TituloAPagar => ({
    filCod: 2,
    docCod,
    titCod: '1',
    pesCod: '387',
    credor: 'NELSON HEUSI',
    valor: 647.56,
    vencimento: utc(DIA),
    liberado: true,
    pago: false,
    temBoleto: false,
    formaPagamentoConexos: 6,
    ativo: true,
    numeroDocumento: docCod,
    ...over,
});

let ditSeq = 0;
const boleto = (
    numero: string | undefined,
    over: Partial<BoletoDda> & { emissor?: { agencia: string; conta: string } } = {},
): BoletoDda => {
    ditSeq += 1;
    const { emissor = EMISSOR_A, ...resto } = over;
    return {
        ddcCod: 900,
        ditCod: ditSeq,
        ...(numero ? { numero } : {}),
        valor: 647.57,
        vencimento: DIA,
        codbar: bradesco(emissor.agencia, emissor.conta, ditSeq),
        ...resto,
    };
};

const entrada = (over: Partial<EntradaMotorSugestao>): EntradaMotorSugestao => ({
    titulos: [],
    boletos: [],
    paresVigentes: [],
    rejeitadas: [],
    confirmadas: [],
    ...over,
});

const regraConjunto = new RegraIrmaosConjunto(new CodigoBarrasBoleto());
const ORIGEM = { filCod: 2, docCod: '25037', titCod: '1', pesCod: '387' };

const listar = (
    e: EntradaMotorSugestao,
    over: { emLoteFinalizado?: Set<string>; origem?: typeof ORIGEM } = {},
): IrmaoConjunto[] =>
    regraConjunto.irmaos({
        origem: over.origem ?? ORIGEM,
        desfechos: motor.desfechos(e),
        emLoteFinalizado: over.emLoteFinalizado ?? new Set(),
        pool: e.boletos,
    });

const docs = (l: IrmaoConjunto[]): string[] => l.map((x) => x.docCod);

describe('RegraIrmaosConjunto — irmãos elegíveis (I15t(1))', () => {
    it('caso NELSON HEUSI: lista os irmãos ancorados, a origem primeiro, cada um com o seu boleto', () => {
        const ts = ['25041', '25037', '25052'].map((n) => titulo(n));
        const bs = ['25037', '25041', '25052'].map((n) => boleto(n));
        const l = listar(entrada({ titulos: ts, boletos: bs }));
        expect(docs(l)).toEqual(['25037', '25041', '25052']);
        expect(l[0]?.origem).toBe(true);
        expect(l.slice(1).every((x) => !x.origem)).toBe(true);
        expect(l.map((x) => x.numeroBoleto)).toEqual(['25037', '25041', '25052']);
        expect(l.map((x) => x.numeroDocumento)).toEqual(['25037', '25041', '25052']);
    });

    it('outro credor ou outra filial não entram', () => {
        const ts = [
            titulo('25037'),
            titulo('25041', { pesCod: '999' }),
            titulo('25052', { filCod: 3 }),
        ];
        const bs = ['25037', '25041', '25052'].map((n) => boleto(n));
        expect(docs(listar(entrada({ titulos: ts, boletos: bs })))).toEqual(['25037']);
    });

    it('sem âncora de número (boleto sem número) não entra', () => {
        const ts = [titulo('25037'), titulo('25041')];
        const bs = [boleto('25037'), boleto(undefined, { valor: 647.56 })];
        const l = listar(entrada({ titulos: ts, boletos: bs }));
        expect(docs(l)).toEqual(['25037']);
    });

    it('título em lote local finalizado não entra', () => {
        const ts = [titulo('25037'), titulo('25041')];
        const bs = [boleto('25037'), boleto('25041')];
        const l = listar(entrada({ titulos: ts, boletos: bs }), {
            emLoteFinalizado: new Set(['2:25041:1']),
        });
        expect(docs(l)).toEqual(['25037']);
    });

    it('título já confirmado não entra', () => {
        const ts = [titulo('25037'), titulo('25041')];
        const b41 = boleto('25041');
        const bs = [boleto('25037'), b41];
        const l = listar(
            entrada({
                titulos: ts,
                boletos: bs,
                confirmadas: [
                    {
                        filCod: 2,
                        docCod: '25041',
                        titCod: '1',
                        ddcCod: b41.ddcCod,
                        ditCod: b41.ditCod,
                    } as never,
                ],
            }),
        );
        expect(docs(l)).toEqual(['25037']);
    });

    it('origem inelegível: lista só os irmãos, sem linha de origem', () => {
        const ts = [titulo('25037'), titulo('25041')];
        const bs = [boleto(undefined, { valor: 647.56 }), boleto('25041')];
        const l = listar(entrada({ titulos: ts, boletos: bs }));
        expect(docs(l)).toEqual(['25041']);
        expect(l[0]?.origem).toBe(false);
    });
});

describe('RegraIrmaosConjunto — avisos (I15t(5))', () => {
    it('boletos idênticos do mesmo emissor: ESCOLHIDO_SO_PELO_NUMERO', () => {
        const ts = [titulo('25037'), titulo('25041')];
        const bs = [boleto('25037'), boleto('25041')];
        const l = listar(entrada({ titulos: ts, boletos: bs }));
        expect(l.every((x) => x.avisos.includes(AVISO_CONJUNTO.ESCOLHIDO_SO_PELO_NUMERO))).toBe(
            true,
        );
    });

    it('o mesmo boleto em dois arquivos DDA não conta como idêntico', () => {
        const b = boleto('25037');
        const l = listar(
            entrada({ titulos: [titulo('25037')], boletos: [b, { ...b, ddcCod: 901, ditCod: 7 }] }),
        );
        expect(l[0]?.avisos).not.toContain(AVISO_CONJUNTO.ESCOLHIDO_SO_PELO_NUMERO);
    });

    it('boleto idêntico de OUTRO emissor não conta', () => {
        const l = listar(
            entrada({
                titulos: [titulo('25037')],
                boletos: [boleto('25037'), boleto('99999', { emissor: EMISSOR_B })],
            }),
        );
        expect(l[0]?.avisos).not.toContain(AVISO_CONJUNTO.ESCOLHIDO_SO_PELO_NUMERO);
    });

    it('centavos no mesmo dia: ajuste automático, sem aviso de faixa', () => {
        const l = listar(entrada({ titulos: [titulo('25037')], boletos: [boleto('25037')] }));
        expect(l[0]?.deltaValor).toBeCloseTo(0.01);
        expect(l[0]?.deltaDias).toBe(0);
        expect(l[0]?.ajusteAutomatico).toBe(true);
        expect(l[0]?.avisos).not.toContain(AVISO_CONJUNTO.FAIXA_AJUSTE_MANUAL);
    });

    it('centavos e +1 dia (faixa): FAIXA_AJUSTE_MANUAL e sem ajuste automático', () => {
        const l = listar(
            entrada({
                titulos: [titulo('25037')],
                boletos: [boleto('25037', { vencimento: '2026-10-28' })],
            }),
        );
        expect(l[0]?.deltaDias).toBe(1);
        expect(l[0]?.avisos).toContain(AVISO_CONJUNTO.FAIXA_AJUSTE_MANUAL);
        expect(l[0]?.ajusteAutomatico).toBe(false);
    });

    it('valor igual e +3 dias: nem faixa nem ajuste', () => {
        const l = listar(
            entrada({
                titulos: [titulo('25037')],
                boletos: [boleto('25037', { vencimento: '2026-10-30', valor: 647.56 })],
            }),
        );
        expect(l[0]?.avisos).toEqual([]);
        expect(l[0]?.ajusteAutomatico).toBe(false);
    });
});

describe('RegraIrmaosConjunto.motivoInelegivel (conferência ao vivo)', () => {
    const avaliacao: AvaliacaoSugestao = {
        resultado: 'FORTE',
        deltaValor: 0.01,
        deltaPercentual: 0,
        deltaDias: 0,
        sinais: [SINAL_SUGESTAO.NUMERO_IGUAL, SINAL_SUGESTAO.NUMERO_CONFIAVEL],
        confirmavel: true,
        diasVencidoNoDebito: 0,
        exigeReconhecimento: EXIGE_RECONHECIMENTO.NENHUM,
    };
    const titulo1 = { filCod: 2, docCod: '25041', titCod: '1', pesCod: '387' };
    const motivo = (over: Partial<AvaliacaoSugestao>, t = titulo1) =>
        regraConjunto.motivoInelegivel({
            origem: ORIGEM,
            titulo: t,
            avaliacao: { ...avaliacao, ...over },
        });

    it('elegível: sem motivo', () => {
        expect(motivo({})).toBeUndefined();
    });
    it('sem NUMERO_CONFIAVEL', () => {
        expect(motivo({ sinais: [SINAL_SUGESTAO.NUMERO_IGUAL] })).toMatch(/número do documento/);
    });
    it('exige reconhecimento tipado', () => {
        expect(motivo({ exigeReconhecimento: EXIGE_RECONHECIMENTO.DATA_DIVERGENTE })).toMatch(
            /reconhecimento/,
        );
    });
    it('aviso VENCE_ANTES_DO_TITULO', () => {
        expect(
            motivo({
                sinais: [SINAL_SUGESTAO.NUMERO_CONFIAVEL, SINAL_SUGESTAO.VENCE_ANTES_DO_TITULO],
            }),
        ).toMatch(/reconhecimento/);
    });
    it('outro credor e outra filial', () => {
        expect(motivo({}, { ...titulo1, pesCod: '1' })).toMatch(/outro credor/);
        expect(motivo({}, { ...titulo1, filCod: 3 })).toMatch(/outra filial/);
    });
    it('não confirmável', () => {
        expect(motivo({ confirmavel: false })).toMatch(/não é confirmável/);
    });
});
