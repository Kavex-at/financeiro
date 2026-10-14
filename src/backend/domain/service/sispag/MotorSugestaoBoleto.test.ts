import 'reflect-metadata';
import type { BoletoDda } from '../../interface/sispag/BoletoDda.js';
import type { TituloAPagar } from '../../interface/sispag/SispagInterface.js';
import type { SugestaoBoletoTitulo } from '../../interface/sispag/SugestaoBoleto.js';
import CodigoBarrasBoleto from '../../libs/boleto/CodigoBarrasBoleto.js';
import BankingCalendar from '../../libs/calendar/BankingCalendar.js';
import MotorSugestaoBoleto, { type EntradaMotorSugestao } from './MotorSugestaoBoleto.js';
import RegraSugestaoBoleto from './RegraSugestaoBoleto.js';

const calendar = BankingCalendar.withClock(() => new Date('2026-10-14T15:00:00Z'));
const motor = new MotorSugestaoBoleto(
    new CodigoBarrasBoleto(),
    calendar,
    new RegraSugestaoBoleto(),
);

const utc = (civil: string): number => Date.parse(`${civil}T00:00:00Z`);

/** Barras sintéticas no formato real (44 dígitos), campo livre montado pelo layout do banco. */
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
const bradesco = (agencia: string, conta: string, n = 7128): string =>
    barras('237', `${agencia}09${String(n).padStart(11, '0')}${conta}0`);

let seq = 0;

const titulo = (over: Partial<TituloAPagar> & { vencimentoCivil?: string } = {}): TituloAPagar => {
    const { vencimentoCivil, ...resto } = over;
    seq += 1;
    return {
        filCod: 1,
        docCod: String(1000 + seq),
        titCod: '1',
        pesCod: '7001',
        credor: 'CREDOR TESTE',
        valor: 100,
        vencimento: utc(vencimentoCivil ?? '2026-10-20'),
        liberado: true,
        pago: false,
        temBoleto: false,
        formaPagamentoConexos: 6,
        ativo: true,
        ...resto,
    };
};

const boleto = (over: Partial<BoletoDda> = {}): BoletoDda => {
    seq += 1;
    return {
        ddcCod: 500,
        ditCod: seq,
        valor: 100,
        vencimento: '2026-10-20',
        codbar: bradesco('2656', '0092740', seq),
        ...over,
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

const doTitulo = (r: SugestaoBoletoTitulo[], t: TituloAPagar): SugestaoBoletoTitulo | undefined =>
    r.find((s) => s.docCod === t.docCod && s.filCod === t.filCod);

describe('MotorSugestaoBoleto', () => {
    it('sugere o boleto livre de mesmo valor e dia como FORTE, sem mutar a entrada', () => {
        const t = titulo({ docCod: 'A' });
        const b = boleto({ ditCod: 1 });
        const e = entrada({ titulos: [t], boletos: [b] });
        const copia = JSON.stringify(e);

        const r = motor.sugerir(e);

        expect(JSON.stringify(e)).toBe(copia);
        expect(r).toHaveLength(1);
        expect(r[0]).toMatchObject({
            docCod: 'A',
            ddcCod: 500,
            ditCod: 1,
            estado: 'SUGERIDA',
            avaliacao: { resultado: 'FORTE', confirmavel: true },
            emissor: { chave: '237:2656:0092740', mascarado: '237 / 2656 / ***2740' },
        });
    });

    it('a saída nunca carrega as barras nem a linha digitável (I15k)', () => {
        const b = boleto({ ditCod: 2 });
        const r = motor.sugerir(entrada({ titulos: [titulo()], boletos: [b] }));
        const saida = JSON.stringify(r);
        expect(saida).not.toContain(String(b.codbar));
        expect(saida).not.toContain(new CodigoBarrasBoleto().paraLinhaDigitavel(b.codbar) ?? 'x');
        expect(saida).not.toMatch(/\d{20,}/);
    });

    describe('exclusões (I15e)', () => {
        it('boleto vinculado pelo ERP a qualquer título não é candidato', () => {
            const r = motor.sugerir(
                entrada({
                    titulos: [titulo()],
                    boletos: [boleto({ filCod: 1, docCod: '9', titCod: '1' })],
                }),
            );
            expect(r).toEqual([]);
        });

        it('boleto reservado por título que o ERP já sinalizou (mesmo valor e dia) sai do jogo', () => {
            const sinalizado = titulo({ temBoleto: true });
            const livre = titulo({ docCod: 'LIVRE' });
            const so = boleto({ ditCod: 10 });
            expect(motor.sugerir(entrada({ titulos: [sinalizado, livre], boletos: [so] }))).toEqual(
                [],
            );
            // com um segundo boleto idêntico, sobra um para o título livre
            const r = motor.sugerir(
                entrada({ titulos: [sinalizado, livre], boletos: [so, boleto({ ditCod: 11 })] }),
            );
            expect(r).toHaveLength(1);
            expect(r[0]?.ditCod).toBe(11);
        });

        it('título pago, inativo, de outra forma de pagamento ou já sinalizado não recebe sugestão', () => {
            const b = boleto();
            const r = motor.sugerir(
                entrada({
                    titulos: [
                        titulo({ pago: true }),
                        titulo({ ativo: false }),
                        titulo({ formaPagamentoConexos: 8 }),
                        titulo({ temBoleto: true }),
                    ],
                    boletos: [b],
                }),
            );
            expect(r).toEqual([]);
        });

        it('boleto REJEITADO para aquele título: outro candidato reaparece', () => {
            const t = titulo({ docCod: 'R' });
            const ruim = boleto({ ditCod: 20 });
            const bom = boleto({ ditCod: 21, vencimento: '2026-10-21' });
            const sem = motor.sugerir(entrada({ titulos: [t], boletos: [ruim] }));
            expect(sem[0]?.ditCod).toBe(20);

            const r = motor.sugerir(
                entrada({
                    titulos: [t],
                    boletos: [ruim, bom],
                    rejeitadas: [{ filCod: 1, docCod: 'R', titCod: '1', ddcCod: 500, ditCod: 20 }],
                }),
            );
            expect(r).toHaveLength(1);
            expect(r[0]?.ditCod).toBe(21);
        });

        it('rejeitar para um título não esconde o boleto dos outros', () => {
            const a = titulo({ docCod: 'A' });
            const b2 = boleto({ ditCod: 30 });
            const r = motor.sugerir(
                entrada({
                    titulos: [a],
                    boletos: [b2],
                    rejeitadas: [
                        { filCod: 1, docCod: 'OUTRO', titCod: '1', ddcCod: 500, ditCod: 30 },
                    ],
                }),
            );
            expect(r[0]?.ditCod).toBe(30);
        });

        it('boleto já CONFIRMADO para outro título não é oferecido (e o título dono vem CONFIRMADA)', () => {
            const dono = titulo({ docCod: 'DONO' });
            const outro = titulo({ docCod: 'OUTRO' });
            const b = boleto({ ditCod: 40 });
            const r = motor.sugerir(
                entrada({
                    titulos: [dono, outro],
                    boletos: [b],
                    confirmadas: [
                        { filCod: 1, docCod: 'DONO', titCod: '1', ddcCod: 500, ditCod: 40 },
                    ],
                }),
            );
            expect(r).toHaveLength(1);
            expect(r[0]).toMatchObject({ docCod: 'DONO', estado: 'CONFIRMADA', ditCod: 40 });
            expect(doTitulo(r, outro)).toBeUndefined();
        });
    });

    describe('disputa e unicidade nos dois sentidos (I15e)', () => {
        it('dois títulos contestando um boleto: fica com o de menor vencimento; o outro sem boleto', () => {
            const cedo = titulo({ docCod: '900', vencimentoCivil: '2026-10-19' });
            const tarde = titulo({ docCod: '100', vencimentoCivil: '2026-10-20' });
            const b = boleto({ ditCod: 50, vencimento: '2026-10-20' });
            const r = motor.sugerir(entrada({ titulos: [tarde, cedo], boletos: [b] }));
            expect(doTitulo(r, cedo)?.ditCod).toBe(50);
            expect(doTitulo(r, tarde)).toBeUndefined();
        });

        it('empate de vencimento: menor docCod; a ordem da entrada não muda o resultado', () => {
            const a = titulo({ docCod: '10' });
            const b = titulo({ docCod: '9' });
            const c = titulo({ docCod: '20' });
            const bol = boleto({ ditCod: 51 });
            const base = [a, b, c];
            const permutacoes = [
                [a, b, c],
                [c, b, a],
                [b, c, a],
            ];
            const resultados = permutacoes.map((ts) =>
                JSON.stringify(motor.sugerir(entrada({ titulos: ts, boletos: [bol] }))),
            );
            expect(new Set(resultados).size).toBe(1);
            const r = motor.sugerir(entrada({ titulos: base, boletos: [bol] }));
            expect(r.map((s) => s.docCod)).toEqual(['9']);
        });

        it('o perdedor é reavaliado sem o boleto e leva o outro candidato (ATENCAO ancorado)', () => {
            const cedo = titulo({ docCod: '1', vencimentoCivil: '2026-10-19', valor: 100 });
            const tarde = titulo({
                docCod: '2',
                vencimentoCivil: '2026-10-21',
                valor: 100,
                numeroDocumento: '77',
            });
            const disputado = boleto({ ditCod: 60, vencimento: '2026-10-21' });
            const alternativo = boleto({
                ditCod: 61,
                vencimento: '2026-10-21',
                valor: 105,
                numero: '77',
            });
            const r = motor.sugerir(
                entrada({ titulos: [tarde, cedo], boletos: [alternativo, disputado] }),
            );
            expect(doTitulo(r, cedo)).toMatchObject({
                ditCod: 60,
                avaliacao: { resultado: 'FORTE' },
            });
            expect(doTitulo(r, tarde)).toMatchObject({
                ditCod: 61,
                avaliacao: { resultado: 'ATENCAO' },
            });
        });

        it('título com 2+ boletos seguros empatados NÃO recebe FORTE: fica sem sugestão', () => {
            const t = titulo({ docCod: 'AMB' });
            const r = motor.sugerir(
                entrada({
                    titulos: [t],
                    boletos: [boleto({ ditCod: 70 }), boleto({ ditCod: 71 })],
                }),
            );
            expect(r).toEqual([]);
        });

        it('MULTILOG: 77 títulos de mesmo valor e UM boleto geram uma única sugestão', () => {
            const titulos = Array.from({ length: 77 }, (_, i) =>
                titulo({
                    docCod: String(2000 + i),
                    vencimentoCivil: `2026-10-${String(15 + (i % 6)).padStart(2, '0')}`,
                }),
            );
            const unico = boleto({ ditCod: 80, vencimento: '2026-10-20' });
            const r = motor.sugerir(entrada({ titulos, boletos: [unico] }));
            expect(r.filter((s) => s.ditCod === 80).length).toBeLessThanOrEqual(1);
            const boletosUsados = r.map((s) => `${s.ddcCod}:${s.ditCod}`);
            expect(new Set(boletosUsados).size).toBe(boletosUsados.length);
        });
    });

    describe('par confirmado (I15g/I15d)', () => {
        it('par vigente do emissor promove FORTE → CONHECIDO', () => {
            const t = titulo();
            const b = boleto({ ditCod: 90 });
            const r = motor.sugerir(
                entrada({
                    titulos: [t],
                    boletos: [b],
                    paresVigentes: [{ pesCod: '7001', emissorChave: '237:2656:0092740' }],
                }),
            );
            expect(r[0]?.avaliacao.resultado).toBe('CONHECIDO');
        });

        it('par de outro emissor do mesmo credor NÃO promove (MULTILOG BRASIL 0092740 × S/A 0006500)', () => {
            const t = titulo();
            const b = boleto({ ditCod: 91, codbar: bradesco('2656', '0006500', 91) });
            const r = motor.sugerir(
                entrada({
                    titulos: [t],
                    boletos: [b],
                    paresVigentes: [{ pesCod: '7001', emissorChave: '237:2656:0092740' }],
                }),
            );
            expect(r[0]?.avaliacao.resultado).toBe('FORTE');
        });

        it('par de outro credor não promove', () => {
            const r = motor.sugerir(
                entrada({
                    titulos: [titulo()],
                    boletos: [boleto({ ditCod: 92 })],
                    paresVigentes: [{ pesCod: '9999', emissorChave: '237:2656:0092740' }],
                }),
            );
            expect(r[0]?.avaliacao.resultado).toBe('FORTE');
        });

        it('par vigente + diferença de R$ 10 → ATENCAO (nunca CONHECIDO)', () => {
            const t = titulo({ valor: 500 });
            const b = boleto({ ditCod: 93, valor: 510 });
            const r = motor.sugerir(
                entrada({
                    titulos: [t],
                    boletos: [b],
                    paresVigentes: [{ pesCod: '7001', emissorChave: '237:2656:0092740' }],
                }),
            );
            expect(r[0]?.avaliacao).toMatchObject({ resultado: 'ATENCAO', deltaValor: 10 });
        });
    });

    describe('ATENCAO e vencido', () => {
        it('ATENCAO sem âncora (par ou número igual) não vira sugestão', () => {
            const r = motor.sugerir(
                entrada({
                    titulos: [titulo({ valor: 500 })],
                    boletos: [boleto({ ditCod: 100, valor: 510 })],
                }),
            );
            expect(r).toEqual([]);
        });

        it('ATENCAO com número do documento igual aparece, com a diferença com sinal', () => {
            const r = motor.sugerir(
                entrada({
                    titulos: [titulo({ valor: 1000, numeroDocumento: '5046' })],
                    boletos: [boleto({ ditCod: 101, valor: 1016, numero: '5046' })],
                }),
            );
            expect(r[0]?.avaliacao).toMatchObject({
                resultado: 'ATENCAO',
                deltaValor: 16,
                deltaPercentual: 1.6,
            });
            expect(r[0]?.avaliacao.sinais).toContain('COLISAO_NUMERO');
        });

        it('boleto vencendo antes da data de débito: informativo, não confirmável, com motivo', () => {
            const t = titulo({ vencimentoCivil: '2026-10-20' });
            const b = boleto({ ditCod: 102, vencimento: '2026-10-19' });
            const r = motor.sugerir(entrada({ titulos: [t], boletos: [b] }));
            expect(r[0]).toMatchObject({
                avaliacao: { resultado: 'VENCIDO_INFORMATIVO', confirmavel: false, deltaDias: -1 },
                motivo: expect.stringContaining('vence antes da data de débito'),
            });
        });

        it('data de débito do lote (I8) define o que é vencido', () => {
            const t = titulo({ docCod: 'LOTE', vencimentoCivil: '2026-10-20' });
            const b = boleto({ ditCod: 103, vencimento: '2026-10-21' });
            const datasDebito = new Map([['1:LOTE:1', '2026-10-22']]);
            const r = motor.sugerir(entrada({ titulos: [t], boletos: [b], datasDebito }));
            expect(r[0]?.avaliacao.resultado).toBe('VENCIDO_INFORMATIVO');
            expect(r[0]?.dataDebito).toBe('2026-10-22');
        });

        it('vencido informativo não rouba o boleto de quem o tem como seguro', () => {
            const seguro = titulo({ docCod: '2', vencimentoCivil: '2026-10-20' });
            const vencido = titulo({ docCod: '1', vencimentoCivil: '2026-10-21' });
            const b = boleto({ ditCod: 104, vencimento: '2026-10-20' });
            const r = motor.sugerir(entrada({ titulos: [seguro, vencido], boletos: [b] }));
            expect(doTitulo(r, seguro)?.avaliacao.resultado).toBe('FORTE');
            expect(doTitulo(r, vencido)).toBeUndefined();
        });
    });

    describe('desempenho', () => {
        it('~1100 títulos × ~1500 boletos em menos de 1 s', () => {
            const titulos = Array.from({ length: 1100 }, (_, i) =>
                titulo({
                    docCod: String(10_000 + i),
                    valor: 100 + (i % 400) * 3.17,
                    vencimentoCivil: `2026-10-${String(10 + (i % 15)).padStart(2, '0')}`,
                }),
            );
            const boletos = Array.from({ length: 1500 }, (_, i) =>
                boleto({
                    ddcCod: 600 + (i % 20),
                    ditCod: i + 1,
                    valor: 100 + (i % 400) * 3.17,
                    vencimento: `2026-10-${String(10 + (i % 17)).padStart(2, '0')}`,
                }),
            );
            const inicio = Date.now();
            const r = motor.sugerir(entrada({ titulos, boletos }));
            const ms = Date.now() - inicio;
            expect(r.length).toBeGreaterThan(0);
            expect(ms).toBeLessThan(1000);
            const usados = r
                .filter((s) => s.estado === 'SUGERIDA')
                .map((s) => `${s.ddcCod}:${s.ditCod}`);
            // seguros e ATENCAO reservam; o informativo pode repetir — conferir só os confirmáveis
            const confirmaveis = r
                .filter((s) => s.avaliacao.confirmavel)
                .map((s) => `${s.ddcCod}:${s.ditCod}`);
            expect(new Set(confirmaveis).size).toBe(confirmaveis.length);
            expect(usados.length).toBe(r.length);
        });
    });
});

describe('MotorSugestaoBoleto — confirmação órfã (I15l)', () => {
    const snapshot = {
        valorTitulo: 100,
        vencimentoTitulo: '2026-10-20',
        valorBoleto: 100,
        vencimentoBoleto: '2026-10-20',
        deltaValor: 0,
        deltaPercentual: 0,
        deltaDias: 0,
        sinais: ['VALOR_IGUAL' as const, 'MESMO_DIA' as const],
        tier: 'FORTE' as const,
        numeroBoleto: 'NF-7',
    };

    it('boleto fora do pool: a CONFIRMADA volta como órfã, não confirmável, com o snapshot', () => {
        const dono = titulo({ docCod: 'DONO' });
        const r = motor.sugerir(
            entrada({
                titulos: [dono],
                boletos: [],
                confirmadas: [
                    {
                        filCod: 1,
                        docCod: 'DONO',
                        titCod: '1',
                        ddcCod: 500,
                        ditCod: 40,
                        ...snapshot,
                    },
                ],
            }),
        );
        expect(r).toHaveLength(1);
        expect(r[0]).toMatchObject({
            docCod: 'DONO',
            estado: 'CONFIRMADA',
            orfa: true,
            ddcCod: 500,
            ditCod: 40,
            numeroBoleto: 'NF-7',
            valorBoleto: 100,
            vencimentoBoleto: '2026-10-20',
            avaliacao: { resultado: 'FORTE', confirmavel: false },
        });
        expect(r[0]?.motivoOrfa).toMatch(/saiu do pool DDA/);
    });

    it('boleto vinculado pelo ERP a um título: motivo próprio', () => {
        const dono = titulo({ docCod: 'DONO' });
        const b = boleto({ ditCod: 40, filCod: 1, docCod: 'X', titCod: '1' });
        const r = motor.sugerir(
            entrada({
                titulos: [dono],
                boletos: [b],
                confirmadas: [{ filCod: 1, docCod: 'DONO', titCod: '1', ddcCod: 500, ditCod: 40 }],
            }),
        );
        expect(r[0]).toMatchObject({ orfa: true });
        expect(r[0]?.motivoOrfa).toMatch(/vinculou o boleto/);
    });

    it('título sinalizado pelo ERP: órfã com o motivo do ERP', () => {
        const dono = titulo({ docCod: 'DONO', temBoleto: true });
        const r = motor.sugerir(
            entrada({
                titulos: [dono],
                boletos: [],
                confirmadas: [{ filCod: 1, docCod: 'DONO', titCod: '1', ddcCod: 500, ditCod: 40 }],
            }),
        );
        expect(r[0]).toMatchObject({ orfa: true, estado: 'CONFIRMADA' });
        expect(r[0]?.motivoOrfa).toMatch(/sinalizou boleto DDA/);
    });

    it('título pago ou inativo: nada na lista, e o boleto fica livre para outro título', () => {
        const pago = titulo({ docCod: 'PAGO', pago: true });
        const inativo = titulo({ docCod: 'INATIVO', ativo: false });
        const outro = titulo({ docCod: 'OUTRO' });
        const b = boleto({ ditCod: 40 });
        const r = motor.sugerir(
            entrada({
                titulos: [pago, inativo, outro],
                boletos: [b],
                confirmadas: [
                    { filCod: 1, docCod: 'PAGO', titCod: '1', ddcCod: 500, ditCod: 40 },
                    { filCod: 1, docCod: 'INATIVO', titCod: '1', ddcCod: 500, ditCod: 40 },
                ],
            }),
        );
        expect(r.map((s) => s.docCod)).toEqual(['OUTRO']);
        expect(r[0]).toMatchObject({ estado: 'SUGERIDA', ditCod: 40 });
        expect(r[0]?.orfa).toBeUndefined();
    });

    it('a órfã não recebe outra sugestão no lugar (a decisão ainda ocupa o título)', () => {
        const dono = titulo({ docCod: 'DONO' });
        const alt = boleto({ ditCod: 41 });
        const r = motor.sugerir(
            entrada({
                titulos: [dono],
                boletos: [alt],
                confirmadas: [{ filCod: 1, docCod: 'DONO', titCod: '1', ddcCod: 500, ditCod: 40 }],
            }),
        );
        expect(r).toHaveLength(1);
        expect(r[0]).toMatchObject({ orfa: true, ditCod: 40 });
    });
});
