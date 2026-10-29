import 'reflect-metadata';
import type { BoletoDda } from '../../interface/sispag/BoletoDda.js';
import type { TituloAPagar } from '../../interface/sispag/SispagInterface.js';
import { SITUACAO_SUGESTAO_TITULO } from '../../interface/sispag/SugestaoBoleto.js';
import CodigoBarrasBoleto from '../../libs/boleto/CodigoBarrasBoleto.js';
import BankingCalendar from '../../libs/calendar/BankingCalendar.js';
import F from './__fixtures__/grupoBoleto.js';
import AncoraOrdemDps from './AncoraOrdemDps.js';
import MotorSugestaoBoleto, {
    type EntradaMotorSugestao,
    type GrupoSugeridoChaveado,
} from './MotorSugestaoBoleto.js';
import RegraSugestaoBoleto from './RegraSugestaoBoleto.js';

/**
 * Sugestão de grupo vista pelo motor 1:1 (I21v, I21w; ADR-0077, emenda 2026-10-29). Caso de PRD de
 * 2026-10-29: RHENUS (pesCod 1550), filial 1, vencimento 29/10 — títulos 5541/1 (R$ 434,38) e
 * 5566/1 (R$ 25.935,47) e o boleto DDA 129818 (ddc 165 / dit 24398) de R$ 26.369,85, a soma exata.
 */

const motor = new MotorSugestaoBoleto(
    new CodigoBarrasBoleto(),
    BankingCalendar.withClock(() => new Date('2026-10-29T15:00:00Z')),
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
const bradesco = (n: number): string =>
    barras('237', `${'2656'}09${String(n).padStart(11, '0')}${'0092740'}0`);

const DIA = '2026-10-29';

const titulo = (docCod: string, valor: number, over: Partial<TituloAPagar> = {}): TituloAPagar => ({
    filCod: 1,
    docCod,
    titCod: '1',
    pesCod: '1550',
    credor: 'RHENUS',
    valor,
    vencimento: utc(DIA),
    liberado: true,
    pago: false,
    temBoleto: false,
    formaPagamentoConexos: 6,
    ativo: true,
    ...over,
});

const T_5541 = titulo('5541', 434.38, { numeroDocumento: '163014' });
const T_5566 = titulo('5566', 25935.47, { numeroDocumento: '129818' });

const B_GRUPO: BoletoDda = {
    ddcCod: 165,
    ditCod: 24398,
    numero: '129818',
    valor: 26369.85,
    vencimento: DIA,
    codbar: bradesco(24398),
};

const GRUPO: GrupoSugeridoChaveado = {
    ddcCod: 165,
    ditCod: 24398,
    numeroBoleto: '129818',
    nTitulos: 2,
    valorBoletoCentavos: 2636985,
    confirmavel: true,
    titulos: [
        { filCod: 1, docCod: '5541', titCod: '1' },
        { filCod: 1, docCod: '5566', titCod: '1' },
    ],
};

const entrada = (over: Partial<EntradaMotorSugestao> = {}): EntradaMotorSugestao => ({
    titulos: [T_5541, T_5566],
    boletos: [B_GRUPO],
    paresVigentes: [],
    rejeitadas: [],
    confirmadas: [],
    ...over,
});

const desfechoDe = (e: EntradaMotorSugestao, docCod: string) =>
    motor.desfechos(e).find((d) => d.docCod === docCod);

describe('MotorSugestaoBoleto — sugestão de grupo na carteira (I21v, I21w)', () => {
    it('SEM a sugestão de grupo, o boleto do grupo é oferecido 1:1 e confirmável a 5566 (o defeito do PRD)', () => {
        const d = desfechoDe(entrada(), '5566');
        const c = d?.candidatos.find((x) => x.ditCod === 24398);
        expect(c?.confirmavel).toBe(true);
        expect(d?.situacao).not.toBe(SITUACAO_SUGESTAO_TITULO.GRUPO_SUGERIDO);
    });

    it('o boleto de uma sugestão de grupo não é candidato (confirmável ou não) de nenhum título', () => {
        const e = entrada({ gruposSugeridos: [GRUPO] });
        for (const d of motor.desfechos(e)) {
            expect(d.candidatos.some((c) => c.ditCod === 24398)).toBe(false);
        }
        expect(motor.sugerir(e).some((s) => s.ditCod === 24398)).toBe(false);
    });

    it('5566 (SO_ATENCAO) e 5541 (SO_FRACA) viram GRUPO_SUGERIDO com o ponteiro do grupo', () => {
        const e = entrada({ gruposSugeridos: [GRUPO] });
        for (const doc of ['5541', '5566']) {
            const d = desfechoDe(e, doc);
            expect(d?.situacao).toBe(SITUACAO_SUGESTAO_TITULO.GRUPO_SUGERIDO);
            expect(d?.grupoSugerido).toEqual({
                ddcCod: 165,
                ditCod: 24398,
                numeroBoleto: '129818',
                nTitulos: 2,
                valorBoletoCentavos: 2636985,
                confirmavel: true,
            });
            expect(d?.candidatos.every((c) => !c.confirmavel)).toBe(true);
        }
    });

    it('sugestão de grupo NÃO confirmável também marca os títulos, com o motivo', () => {
        const e = entrada({
            gruposSugeridos: [{ ...GRUPO, confirmavel: false, motivo: 'NAO_LIBERADO' }],
        });
        const d = desfechoDe(e, '5566');
        expect(d?.situacao).toBe(SITUACAO_SUGESTAO_TITULO.GRUPO_SUGERIDO);
        expect(d?.grupoSugerido).toMatchObject({ confirmavel: false, motivo: 'NAO_LIBERADO' });
    });

    it('título com 1:1 forte (UNICA_SEGURA) mantém o desfecho e ganha só o ponteiro', () => {
        const forte = titulo('7001', 100, { pesCod: '1550' });
        const bForte: BoletoDda = {
            ddcCod: 170,
            ditCod: 1,
            valor: 100,
            vencimento: DIA,
            codbar: bradesco(1),
        };
        const e = entrada({
            titulos: [forte, T_5541, T_5566],
            boletos: [B_GRUPO, bForte],
            gruposSugeridos: [
                {
                    ...GRUPO,
                    titulos: [
                        { filCod: 1, docCod: '7001', titCod: '1' },
                        { filCod: 1, docCod: '5566', titCod: '1' },
                    ],
                },
            ],
        });
        const d = desfechoDe(e, '7001');
        expect(d?.situacao).toBe(SITUACAO_SUGESTAO_TITULO.UNICA_SEGURA);
        expect(d?.candidatos.find((c) => c.ditCod === 1)?.confirmavel).toBe(true);
        expect(d?.grupoSugerido?.ditCod).toBe(24398);
    });

    it('decisão 1:1 já CONFIRMADA continua valendo (I15g) e o título só ganha o ponteiro', () => {
        const e = entrada({
            confirmadas: [{ filCod: 1, docCod: '5566', titCod: '1', ddcCod: 165, ditCod: 24398 }],
            gruposSugeridos: [GRUPO],
        });
        const d = desfechoDe(e, '5566');
        expect(d?.situacao).toBe(SITUACAO_SUGESTAO_TITULO.CONFIRMADA);
        expect(d?.grupoSugerido?.ditCod).toBe(24398);
    });

    it('título fora de qualquer sugestão de grupo não muda', () => {
        const outro = titulo('9000', 50, { pesCod: '2222' });
        const e = entrada({ titulos: [T_5541, T_5566, outro], gruposSugeridos: [GRUPO] });
        const d = desfechoDe(e, '9000');
        expect(d?.situacao).toBe(SITUACAO_SUGESTAO_TITULO.SEM_CANDIDATO);
        expect(d?.grupoSugerido).toBeUndefined();
    });

    it('não muta a entrada', () => {
        const e = entrada({ gruposSugeridos: [GRUPO] });
        const copia = JSON.stringify(e);
        motor.desfechos(e);
        expect(JSON.stringify(e)).toBe(copia);
    });

    describe('o título do grupo não segura boleto de outro (reserva só em situação mantida)', () => {
        const emissorDe = (b: BoletoDda): string =>
            new CodigoBarrasBoleto().emissor(b.codbar)?.chave ?? '';
        const X = F.boleto({ ddcCod: 300, ditCod: 1, valor: 100, vencimento: DIA });
        const parX = { pesCod: '1550', emissorChave: emissorDe(X) };
        // A e B contestam X como ATENCAO ancorada pelo par (valor ±R$ 5 e ±R$ 4); A ganharia por docCod.
        const A = titulo('A1', 105);
        const B = titulo('B1', 96);
        const C = titulo('C1', 5);
        const doGrupoDeA: GrupoSugeridoChaveado = {
            ...GRUPO,
            ddcCod: 777,
            ditCod: 1,
            nTitulos: 2,
            titulos: [
                { filCod: 1, docCod: 'A1', titCod: '1' },
                { filCod: 1, docCod: 'C1', titCod: '1' },
            ],
        };
        const base = (gruposSugeridos: GrupoSugeridoChaveado[]) =>
            entrada({
                titulos: [A, B, C],
                boletos: [X],
                paresVigentes: [parX],
                gruposSugeridos,
            });

        it('baseline: sem a sugestão de grupo, A leva X (SO_ATENCAO) e B fica DISPUTADA', () => {
            expect(desfechoDe(base([]), 'A1')?.situacao).toBe(SITUACAO_SUGESTAO_TITULO.SO_ATENCAO);
            expect(desfechoDe(base([]), 'B1')?.situacao).toBe(SITUACAO_SUGESTAO_TITULO.DISPUTADA);
        });

        it('A (do grupo) vira GRUPO_SUGERIDO e NÃO reserva X: B leva X com a situação normal', () => {
            const e = base([doGrupoDeA]);
            expect(desfechoDe(e, 'A1')?.situacao).toBe(SITUACAO_SUGESTAO_TITULO.GRUPO_SUGERIDO);
            const b = desfechoDe(e, 'B1');
            expect(b?.situacao).toBe(SITUACAO_SUGESTAO_TITULO.SO_ATENCAO);
            expect(b?.candidatos[0]).toMatchObject({ ditCod: 1, confirmavel: true });
        });

        it('contrato legado: B recebe X e A não recebe sugestão 1:1', () => {
            const sugestoes = motor.sugerir(base([doGrupoDeA]));
            expect(sugestoes.find((s) => s.docCod === 'B1')).toMatchObject({ ditCod: 1 });
            expect(sugestoes.some((s) => s.docCod === 'A1')).toBe(false);
        });
    });

    describe('grupo disputado por 1:1 de título de fora do grupo (não se perde boleto em silêncio)', () => {
        const G = F.boleto({ ddcCod: 165, ditCod: 24398, valor: 200, vencimento: DIA });
        const E1 = titulo('E1', 100);
        const E2 = titulo('E2', 100);
        // D é de OUTRO credor, valor igual ao do boleto e mesmo dia: 1:1 seguro (FORTE) em G.
        const D = titulo('D1', 200, { pesCod: '2222', credor: 'OUTRO' });
        const grupoEmG: GrupoSugeridoChaveado = {
            ...GRUPO,
            valorBoletoCentavos: 20000,
            titulos: [
                { filCod: 1, docCod: 'E1', titCod: '1' },
                { filCod: 1, docCod: 'E2', titCod: '1' },
            ],
        };

        it('D mantém o 1:1 seguro em G: a sugestão de grupo não tira o boleto dele', () => {
            const e = entrada({ titulos: [E1, E2, D], boletos: [G], gruposSugeridos: [grupoEmG] });
            const d = desfechoDe(e, 'D1');
            expect(d?.situacao).toBe(SITUACAO_SUGESTAO_TITULO.UNICA_SEGURA);
            expect(d?.candidatos[0]).toMatchObject({ ditCod: 24398, confirmavel: true });
        });

        it('e então a sugestão fica sem efeito nos títulos do grupo (nada de selo contraditório)', () => {
            const e = entrada({ titulos: [E1, E2, D], boletos: [G], gruposSugeridos: [grupoEmG] });
            for (const doc of ['E1', 'E2']) {
                const d = desfechoDe(e, doc);
                expect(d?.situacao).not.toBe(SITUACAO_SUGESTAO_TITULO.GRUPO_SUGERIDO);
                expect(d?.grupoSugerido).toBeUndefined();
            }
        });
    });
});
