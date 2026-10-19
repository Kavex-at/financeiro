import 'reflect-metadata';
import type { BoletoDda } from '../../interface/sispag/BoletoDda.js';
import type { TituloAPagar } from '../../interface/sispag/SispagInterface.js';
import type {
    DesfechoTitulo,
    DpsConhecido,
    SugestaoBoletoTitulo,
} from '../../interface/sispag/SugestaoBoleto.js';
import CodigoBarrasBoleto from '../../libs/boleto/CodigoBarrasBoleto.js';
import BankingCalendar from '../../libs/calendar/BankingCalendar.js';
import AncoraOrdemDps from './AncoraOrdemDps.js';
import MotorSugestaoBoleto, { type EntradaMotorSugestao } from './MotorSugestaoBoleto.js';
import RegraSugestaoBoleto from './RegraSugestaoBoleto.js';

const motor = new MotorSugestaoBoleto(
    new CodigoBarrasBoleto(),
    BankingCalendar.withClock(() => new Date('2026-10-14T15:00:00Z')),
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
/** Barras Bradesco da MULTILOG: agência 2656, carteira 09, conta 0022101. */
const multilogBarras = (nossoNumero: number): string => {
    const livre = `265609${String(nossoNumero).padStart(11, '0')}00221010`;
    const semDv = `2379${'1580'}${'0000014799'}${livre}`;
    return `2379${dvGeral(semDv)}1580${'0000014799'}${livre}`;
};

const titulo = (docCod: string, nfse: string, over: Partial<TituloAPagar> = {}): TituloAPagar => ({
    filCod: 2,
    docCod,
    titCod: '1',
    pesCod: '386',
    credor: 'MULTILOG BRASIL S.A.',
    valor: 147.99,
    vencimento: utc('2026-10-16'),
    liberado: true,
    pago: false,
    temBoleto: false,
    formaPagamentoConexos: 6,
    ativo: true,
    numeroDocumento: nfse,
    ...over,
});

const boleto = (ditCod: number, numero: string, over: Partial<BoletoDda> = {}): BoletoDda => ({
    ddcCod: 174,
    ditCod,
    numero,
    valor: 147.99,
    vencimento: '2026-10-24',
    codbar: multilogBarras(1250320 + ditCod),
    ...over,
});

// Caso real (fin124 #174, 14/10/2026): 41155/1 (NFS-e 86666) e 41156/1 (NFS-e 86672).
const t41155 = titulo('41155', '86666');
const t41156 = titulo('41156', '86672');
const b132 = boleto(1, '776132000');
const b138 = boleto(2, '776138000');
const DPS_41155: DpsConhecido = {
    filCod: 2,
    docCod: '41155',
    titCod: '1',
    pesCod: '386',
    nfse: '86666',
    dps: '776132',
};

const entrada = (over: Partial<EntradaMotorSugestao>): EntradaMotorSugestao => ({
    titulos: [t41155, t41156],
    boletos: [b132, b138],
    paresVigentes: [],
    rejeitadas: [],
    confirmadas: [],
    ...over,
});

const desfecho = (r: DesfechoTitulo[], t: TituloAPagar): DesfechoTitulo | undefined =>
    r.find((d) => d.docCod === t.docCod);
const escolhido = (d?: DesfechoTitulo) => d?.candidatos.find((c) => c.confirmavel);
const sugestao = (r: SugestaoBoletoTitulo[], t: TituloAPagar) =>
    r.find((s) => s.docCod === t.docCod);

describe('MotorSugestaoBoleto — âncora DPS (I15p, ADR-0073)', () => {
    it('sem DPS lido: os dois títulos ficam só informativos (o problema medido em 19/10)', () => {
        const r = motor.desfechos(entrada({}));
        expect(desfecho(r, t41155)?.situacao).toBe('SO_FRACA');
        expect(desfecho(r, t41156)?.situacao).toBe('SO_FRACA');
        expect(escolhido(desfecho(r, t41155))).toBeUndefined();
    });

    it('DPS lido do 41155 ancora o boleto dele (DPS_IGUAL) e resolve o 41156 pela ordem', () => {
        const r = motor.desfechos(entrada({ dps: [DPS_41155] }));
        const d155 = desfecho(r, t41155);
        const d156 = desfecho(r, t41156);
        expect(d155?.situacao).toBe('SO_ATENCAO');
        expect(escolhido(d155)?.numeroBoleto).toBe('776132000');
        expect(escolhido(d155)?.avaliacao.sinais).toContain('DPS_IGUAL');
        expect(escolhido(d155)?.ancorado).toBe(true);
        expect(d156?.situacao).toBe('SO_ATENCAO');
        expect(escolhido(d156)?.numeroBoleto).toBe('776138000');
        expect(escolhido(d156)?.avaliacao.sinais).toContain('ORDEM_DPS');
    });

    it('contrato legado: cada título recebe o boleto do seu DPS', () => {
        const r = motor.sugerir(entrada({ dps: [DPS_41155] }));
        expect(sugestao(r, t41155)?.numeroBoleto).toBe('776132000');
        expect(sugestao(r, t41156)?.numeroBoleto).toBe('776138000');
    });

    it('a ordem não depende da ordem de entrada', () => {
        const a = motor.desfechos(entrada({ dps: [DPS_41155] }));
        const b = motor.desfechos(
            entrada({ dps: [DPS_41155], titulos: [t41156, t41155], boletos: [b138, b132] }),
        );
        expect(escolhido(desfecho(b, t41156))?.numeroBoleto).toBe(
            escolhido(desfecho(a, t41156))?.numeroBoleto,
        );
    });

    it('AMBIGUA desempata pela ordem quando a prova vem de um título fora da carteira', () => {
        // 2 títulos × 2 boletos de mesmo valor e dia (FORTE empatado). A prova é o 41155, já pago:
        // o boleto dele está no pool vinculado pelo ERP.
        const tA = titulo('41162', '86740', { valor: 168.65, vencimento: utc('2026-10-24') });
        const tB = titulo('41159', '86834', { valor: 168.65, vencimento: utc('2026-10-24') });
        const bA = boleto(11, '776206000', { valor: 168.65 });
        const bB = boleto(12, '776300000', { valor: 168.65 });
        const provaPaga = boleto(1, '776132000', { filCod: 2, docCod: '41155', titCod: '1' });
        const e = entrada({
            titulos: [tA, tB],
            boletos: [bB, bA, provaPaga],
            dps: [DPS_41155],
        });
        const r = motor.desfechos(e);
        expect(desfecho(r, tA)?.situacao).toBe('UNICA_SEGURA');
        expect(escolhido(desfecho(r, tA))?.numeroBoleto).toBe('776206000');
        expect(desfecho(r, tB)?.situacao).toBe('UNICA_SEGURA');
        expect(escolhido(desfecho(r, tB))?.numeroBoleto).toBe('776300000');
        expect(escolhido(desfecho(r, tB))?.avaliacao.sinais).toContain('ORDEM_DPS');
    });

    it('sem prova no pool, o mesmo empate segue AMBIGUA (nunca chuta)', () => {
        const tA = titulo('41162', '86740', { valor: 168.65, vencimento: utc('2026-10-24') });
        const tB = titulo('41159', '86834', { valor: 168.65, vencimento: utc('2026-10-24') });
        const bA = boleto(11, '776206000', { valor: 168.65 });
        const bB = boleto(12, '776300000', { valor: 168.65 });
        const r = motor.desfechos(
            entrada({ titulos: [tA, tB], boletos: [bA, bB], dps: [DPS_41155] }),
        );
        expect(desfecho(r, tA)?.situacao).toBe('AMBIGUA');
        expect(desfecho(r, tB)?.situacao).toBe('AMBIGUA');
    });

    it('âncora DPS tem precedência: o título de menor vencimento não leva o boleto do DPS alheio', () => {
        // Par vigente ancora os DOIS boletos para os DOIS títulos (mesmo emissor); o 41156 vence
        // antes e, sem a precedência, levaria o 776132000 (primeiro pela chave do boleto).
        const t156cedo = titulo('41156', '86672', { vencimento: utc('2026-10-15') });
        const e = entrada({
            titulos: [t41155, t156cedo],
            paresVigentes: [{ pesCod: '386', emissorChave: '237:2656:0022101' }],
            dps: [DPS_41155],
        });
        const r = motor.desfechos(e);
        expect(escolhido(desfecho(r, t41155))?.numeroBoleto).toBe('776132000');
        expect(escolhido(desfecho(r, t156cedo))?.numeroBoleto).toBe('776138000');
        const legado = motor.sugerir(e);
        expect(sugestao(legado, t41155)?.numeroBoleto).toBe('776132000');
        expect(sugestao(legado, t156cedo)?.numeroBoleto).toBe('776138000');
    });
});
