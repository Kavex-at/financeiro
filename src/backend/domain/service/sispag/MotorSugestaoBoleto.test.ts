import 'reflect-metadata';
import type { BoletoDda } from '../../interface/sispag/BoletoDda.js';
import type { TituloAPagar } from '../../interface/sispag/SispagInterface.js';
import type { SugestaoBoletoTitulo } from '../../interface/sispag/SugestaoBoleto.js';
import CodigoBarrasBoleto from '../../libs/boleto/CodigoBarrasBoleto.js';
import BankingCalendar from '../../libs/calendar/BankingCalendar.js';
import AncoraOrdemDps from './AncoraOrdemDps.js';
import MotorSugestaoBoleto, { type EntradaMotorSugestao } from './MotorSugestaoBoleto.js';
import RegraSugestaoBoleto from './RegraSugestaoBoleto.js';

const calendar = BankingCalendar.withClock(() => new Date('2026-10-14T15:00:00Z'));
const motor = new MotorSugestaoBoleto(
    new CodigoBarrasBoleto(),
    calendar,
    new RegraSugestaoBoleto(),
    new AncoraOrdemDps(),
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

describe('MotorSugestaoBoleto — desfecho por título (I15m, I15n, ADR-0072)', () => {
    const desfecho = (e: EntradaMotorSugestao, t: TituloAPagar) =>
        motor.desfechos(e).find((d) => d.docCod === t.docCod && d.filCod === t.filCod);
    const PAR = { pesCod: '7001', emissorChave: '237:2656:0092740' };

    it('todo título elegível produz exatamente um desfecho (0, 1 e N candidatos); nunca inventa boleto', () => {
        const semCand = titulo({ docCod: 'S0', valor: 7000 });
        const umCand = titulo({ docCod: 'S1', valor: 200 });
        const nCand = titulo({ docCod: 'SN', valor: 300 });
        const inelegivel = titulo({ docCod: 'PAGO', pago: true });
        const e = entrada({
            titulos: [semCand, umCand, nCand, inelegivel],
            boletos: [
                boleto({ ditCod: 1, valor: 200 }),
                boleto({ ditCod: 2, valor: 300 }),
                boleto({ ditCod: 3, valor: 300 }),
                boleto({ ditCod: 4, valor: 301 }),
            ],
        });
        const d = motor.desfechos(e);
        expect(d.map((x) => x.docCod).sort()).toEqual(['S0', 'S1', 'SN']);
        expect(desfecho(e, semCand)).toMatchObject({
            situacao: 'SEM_CANDIDATO',
            candidatos: [],
            totalCandidatos: 0,
        });
        expect(desfecho(e, umCand)?.candidatos).toHaveLength(1);
        const boletosReais = new Set(e.boletos.map((b) => `${b.ddcCod}:${b.ditCod}`));
        for (const x of d) {
            for (const c of x.candidatos)
                expect(boletosReais.has(`${c.ddcCod}:${c.ditCod}`)).toBe(true);
        }
    });

    it('UNICA_SEGURA e SO_ATENCAO reproduzem a sugestão atual (mesmo boleto, mesmo tier)', () => {
        const a = titulo({ docCod: 'A' });
        const b = titulo({ docCod: 'B', valor: 500, numeroDocumento: '4242' });
        const e = entrada({
            titulos: [a, b],
            boletos: [boleto({ ditCod: 1 }), boleto({ ditCod: 2, valor: 505, numero: '4242' })],
        });
        const legado = motor.sugerir(e);
        const dA = desfecho(e, a);
        const dB = desfecho(e, b);
        expect(dA).toMatchObject({ situacao: 'UNICA_SEGURA', totalCandidatos: 1 });
        expect(dB).toMatchObject({ situacao: 'SO_ATENCAO', totalCandidatos: 1 });
        for (const [d, t] of [
            [dA, a],
            [dB, b],
        ] as const) {
            const s = doTitulo(legado, t);
            expect(d?.candidatos[0]).toMatchObject({
                ddcCod: s?.ddcCod,
                ditCod: s?.ditCod,
                confirmavel: true,
                avaliacao: { resultado: s?.avaliacao.resultado },
            });
        }
    });

    it('CONFIRMADA e ORFA viram desfecho, com o candidato da decisão', () => {
        const viva = titulo({ docCod: 'VIVA' });
        const orfa = titulo({ docCod: 'ORFA', valor: 250 });
        const e = entrada({
            titulos: [viva, orfa],
            boletos: [boleto({ ditCod: 1 })],
            confirmadas: [
                { filCod: 1, docCod: 'VIVA', titCod: '1', ddcCod: 500, ditCod: 1 },
                { filCod: 1, docCod: 'ORFA', titCod: '1', ddcCod: 500, ditCod: 99 },
            ],
        });
        expect(desfecho(e, viva)).toMatchObject({ situacao: 'CONFIRMADA', totalCandidatos: 1 });
        expect(desfecho(e, orfa)).toMatchObject({ situacao: 'ORFA' });
        expect(desfecho(e, viva)?.candidatos[0]?.confirmavel).toBe(false);
    });

    describe('SO_FRACA: exibida, nunca confirmável', () => {
        it.each([
            ['acima +R$ 3', { valor: 103 }, 3, 0],
            ['abaixo −R$ 9,49', { valor: 90.51 }, -9.49, 0],
            ['valor igual, +8 dias', { vencimento: '2026-10-28' }, 0, 8],
        ])('%s', (_n, over, deltaValor, deltaDias) => {
            const t = titulo({ docCod: 'F' });
            const e = entrada({ titulos: [t], boletos: [boleto({ ditCod: 7, ...over })] });
            const d = desfecho(e, t);
            expect(d?.situacao).toBe('SO_FRACA');
            expect(d?.candidatos[0]).toMatchObject({
                confirmavel: false,
                ancorado: false,
                avaliacao: { resultado: 'ATENCAO', deltaValor, deltaDias },
            });
            expect(d?.candidatos[0]?.motivo).toEqual(expect.any(String));
            expect(motor.sugerir(e)).toEqual([]); // contrato antigo intacto
        });

        it('ATENCAO sem âncora tem confirmavel=false mesmo que a regra pura diga true', () => {
            const t = titulo({ docCod: 'F2' });
            const e = entrada({ titulos: [t], boletos: [boleto({ ditCod: 8, valor: 104 })] });
            const regraDiz = new RegraSugestaoBoleto().avaliar({
                titulo: { valor: 100, vencimento: '2026-10-20' },
                boleto: { valor: 104, vencimento: '2026-10-20' },
                dataDebito: '2026-10-20',
                parConfirmado: false,
            });
            expect(regraDiz.confirmavel).toBe(true);
            expect(desfecho(e, t)?.candidatos[0]?.confirmavel).toBe(false);
        });
    });

    describe('AMBIGUA', () => {
        it('2+ seguros de mesma força: listados ranqueados, nenhum confirmável', () => {
            const t = titulo({ docCod: 'AMB' });
            const e = entrada({
                titulos: [t],
                boletos: [boleto({ ditCod: 70 }), boleto({ ditCod: 71 }), boleto({ ditCod: 72 })],
            });
            const d = desfecho(e, t);
            expect(d?.situacao).toBe('AMBIGUA');
            expect(d?.totalCandidatos).toBe(3);
            expect(d?.candidatos.map((c) => c.ditCod)).toEqual([70, 71, 72]);
            expect(d?.candidatos.every((c) => !c.confirmavel)).toBe(true);
        });

        it('rejeitar um dos ambíguos deixa o outro UNICA_SEGURA e confirmável', () => {
            const t = titulo({ docCod: 'AMB2' });
            const e = entrada({
                titulos: [t],
                boletos: [boleto({ ditCod: 73 }), boleto({ ditCod: 74 })],
                rejeitadas: [{ filCod: 1, docCod: 'AMB2', titCod: '1', ddcCod: 500, ditCod: 73 }],
            });
            const d = desfecho(e, t);
            expect(d?.situacao).toBe('UNICA_SEGURA');
            expect(d?.candidatos).toHaveLength(1);
            expect(d?.candidatos[0]).toMatchObject({ ditCod: 74, confirmavel: true });
        });

        it('CONHECIDO ainda vence FORTE: não é ambíguo', () => {
            const t = titulo({ docCod: 'CONH' });
            const e = entrada({
                titulos: [t],
                boletos: [
                    boleto({ ditCod: 75, codbar: bradesco('2656', '0092740', 75) }),
                    boleto({ ditCod: 76, codbar: bradesco('2656', '0006500', 76) }),
                ],
                paresVigentes: [PAR],
            });
            const d = desfecho(e, t);
            expect(d?.situacao).toBe('UNICA_SEGURA');
            expect(d?.candidatos[0]).toMatchObject({
                ditCod: 75,
                confirmavel: true,
                avaliacao: { resultado: 'CONHECIDO' },
            });
        });
    });

    describe('DISPUTADA (I15n) e reserva', () => {
        it('o perdedor vê o boleto reservado ao vencedor — nunca SEM_CANDIDATO', () => {
            const cedo = titulo({ docCod: '1', vencimentoCivil: '2026-10-19' });
            const tarde = titulo({ docCod: '2', vencimentoCivil: '2026-10-20' });
            const b = boleto({ ditCod: 50, vencimento: '2026-10-20' });
            const e = entrada({ titulos: [tarde, cedo], boletos: [b] });
            expect(desfecho(e, cedo)?.situacao).toBe('UNICA_SEGURA');
            const d = desfecho(e, tarde);
            expect(d?.situacao).toBe('DISPUTADA');
            expect(d?.candidatos[0]).toMatchObject({
                ditCod: 50,
                confirmavel: false,
                reservadoParaTitulo: { filCod: 1, docCod: '1', titCod: '1' },
            });
        });

        it('perdedor com candidato ATENCAO ancorado livre fica SO_ATENCAO (comportamento atual)', () => {
            const cedo = titulo({ docCod: '1', vencimentoCivil: '2026-10-19' });
            const tarde = titulo({
                docCod: '2',
                vencimentoCivil: '2026-10-21',
                numeroDocumento: '77',
            });
            const e = entrada({
                titulos: [tarde, cedo],
                boletos: [
                    boleto({ ditCod: 60, vencimento: '2026-10-21' }),
                    boleto({ ditCod: 61, vencimento: '2026-10-21', valor: 105, numero: '77' }),
                ],
            });
            const d = desfecho(e, tarde);
            expect(d?.situacao).toBe('SO_ATENCAO');
            expect(d?.candidatos[0]).toMatchObject({ ditCod: 61, confirmavel: true });
        });

        it('fraco não rouba o boleto de seguro de outro título', () => {
            const fraco = titulo({ docCod: '1', vencimentoCivil: '2026-10-10', valor: 103 });
            const seguro = titulo({ docCod: '2', vencimentoCivil: '2026-10-20', valor: 100 });
            const e = entrada({
                titulos: [fraco, seguro],
                boletos: [boleto({ ditCod: 9, valor: 100, vencimento: '2026-10-20' })],
            });
            expect(desfecho(e, seguro)?.situacao).toBe('UNICA_SEGURA');
            expect(desfecho(e, fraco)?.candidatos[0]).toMatchObject({
                ditCod: 9,
                confirmavel: false,
                reservadoParaTitulo: { docCod: '2' },
            });
        });

        it('vencido e fraco não reservam: o mesmo boleto aparece em dois títulos como compartilhado', () => {
            const t1 = titulo({ docCod: '1' });
            const t2 = titulo({ docCod: '2' });
            const e = entrada({
                titulos: [t1, t2],
                boletos: [boleto({ ditCod: 11, vencimento: '2026-10-19' })],
            });
            for (const t of [t1, t2]) {
                const d = desfecho(e, t);
                expect(d?.situacao).toBe('SO_VENCIDA');
                expect(d?.candidatos[0]).toMatchObject({
                    ditCod: 11,
                    confirmavel: false,
                    compartilhado: true,
                });
            }
        });
    });

    describe('SO_VENCIDA (Q4) e SEM_CANDIDATO (I15f)', () => {
        it('mostra todo vencido dentro do envelope, sempre não confirmável', () => {
            const t = titulo({ docCod: 'V' });
            const e = entrada({
                titulos: [t],
                boletos: [boleto({ ditCod: 12, vencimento: '2026-10-18', valor: 107 })],
            });
            const d = desfecho(e, t);
            expect(d?.situacao).toBe('SO_VENCIDA');
            expect(d?.candidatos[0]).toMatchObject({
                confirmavel: false,
                avaliacao: { resultado: 'VENCIDO_INFORMATIVO', diasVencidoNoDebito: 2 },
            });
        });

        it('fora do envelope não aparece; número igual não resgata', () => {
            const t = titulo({ docCod: 'N', numeroDocumento: '9' });
            const e = entrada({
                titulos: [t],
                boletos: [
                    boleto({ ditCod: 13, valor: 150, numero: '9' }),
                    boleto({ ditCod: 14, vencimento: '2026-11-30' }),
                ],
            });
            expect(desfecho(e, t)).toMatchObject({
                situacao: 'SEM_CANDIDATO',
                candidatos: [],
                totalCandidatos: 0,
            });
        });
    });

    describe('top-N e determinismo', () => {
        it('retém 3 por título, ordenados por força → |Δvalor| → |Δdias| → chave', () => {
            const t = titulo({ docCod: 'TOP' });
            const valores = [108, 102, 106, 101, 104];
            const e = entrada({
                titulos: [t],
                boletos: valores.map((v, i) => boleto({ ditCod: 20 + i, valor: v })),
            });
            const d = desfecho(e, t);
            expect(d?.totalCandidatos).toBe(5);
            expect(d?.candidatos.map((c) => c.avaliacao.deltaValor)).toEqual([1, 2, 4]);
        });

        it('permutar títulos e boletos não muda o resultado', () => {
            const ts = [
                titulo({ docCod: '1', vencimentoCivil: '2026-10-19' }),
                titulo({ docCod: '2' }),
                titulo({ docCod: '3', valor: 103 }),
                titulo({ docCod: '4', valor: 500 }),
            ];
            const bs = [
                boleto({ ditCod: 31 }),
                boleto({ ditCod: 32 }),
                boleto({ ditCod: 33, valor: 104 }),
                boleto({ ditCod: 34, valor: 101, vencimento: '2026-10-18' }),
            ];
            const base = JSON.stringify(motor.desfechos(entrada({ titulos: ts, boletos: bs })));
            const outras = [
                [[...ts].reverse(), [...bs].reverse()],
                [
                    [ts[2], ts[0], ts[3], ts[1]],
                    [bs[1], bs[3], bs[0], bs[2]],
                ],
            ] as Array<[TituloAPagar[], BoletoDda[]]>;
            for (const [tt, bb] of outras) {
                expect(JSON.stringify(motor.desfechos(entrada({ titulos: tt, boletos: bb })))).toBe(
                    base,
                );
            }
        });

        it('não muta a entrada e a saída não carrega barras nem linha digitável', () => {
            const b = boleto({ ditCod: 40 });
            const e = entrada({ titulos: [titulo()], boletos: [b] });
            const copia = JSON.stringify(e);
            const saida = JSON.stringify(motor.desfechos(e));
            expect(JSON.stringify(e)).toBe(copia);
            expect(saida).not.toContain(String(b.codbar));
            expect(saida).not.toMatch(/\d{20,}/);
        });
    });

    it('desempenho: ~1,1 mil títulos × ~8,8 mil boletos dentro do orçamento', () => {
        const titulos = Array.from({ length: 1100 }, (_, i) =>
            titulo({
                docCod: String(10_000 + i),
                valor: 100 + (i % 400) * 3.17,
                vencimentoCivil: `2026-10-${String(10 + (i % 15)).padStart(2, '0')}`,
            }),
        );
        const boletos = Array.from({ length: 8800 }, (_, i) =>
            boleto({
                ddcCod: 600 + (i % 20),
                ditCod: i + 1,
                valor: 100 + (i % 400) * 3.17,
                vencimento: `2026-10-${String(10 + (i % 17)).padStart(2, '0')}`,
            }),
        );
        const inicio = Date.now();
        const d = motor.desfechos(entrada({ titulos, boletos }));
        const ms = Date.now() - inicio;
        expect(d).toHaveLength(1100);
        expect(ms).toBeLessThan(8000); // ~0,6 s fora do jest; folga para a carga paralela do CI
        const reservados = d
            .filter((x) => x.situacao === 'UNICA_SEGURA' || x.situacao === 'SO_ATENCAO')
            .map((x) => `${x.candidatos[0]?.ddcCod}:${x.candidatos[0]?.ditCod}`);
        expect(new Set(reservados).size).toBe(reservados.length);
    });
});

describe('MotorSugestaoBoleto — boleto agrupado (I15e(4), I15m EM_GRUPO, I15q; ADR-0076)', () => {
    it('título em grupo CONFIRMADO ⇒ desfecho EM_GRUPO, não confirmável, com o id do grupo e sem sugestão 1:1', () => {
        const t = titulo({ docCod: 'G1' });
        const livre = boleto({ ditCod: 9001 });
        const r = motor.analisar(
            entrada({
                titulos: [t],
                boletos: [livre],
                gruposConfirmados: [
                    {
                        id: 'grupo-1',
                        ddcCod: 700,
                        ditCod: 1,
                        titulos: [{ filCod: t.filCod, docCod: t.docCod, titCod: t.titCod }],
                    },
                ],
            }),
        );
        expect(doTitulo(r.sugestoes, t)).toBeUndefined();
        const d = r.desfechos.find((x) => x.docCod === 'G1');
        expect(d).toMatchObject({
            situacao: 'EM_GRUPO',
            grupoBoletoId: 'grupo-1',
            candidatos: [],
            totalCandidatos: 0,
        });
        expect(d?.motivo).toMatch(/grupo/);
        expect(d?.candidatos.some((c) => c.confirmavel)).toBe(false);
    });

    it('boleto de grupo CONFIRMADO não é candidato de nenhum título (exclusão (4))', () => {
        const t = titulo({ docCod: 'X1' });
        const b = boleto({ ditCod: 9002 });
        const r = motor.analisar(
            entrada({
                titulos: [t],
                boletos: [b],
                gruposConfirmados: [{ id: 'g', ddcCod: b.ddcCod, ditCod: b.ditCod, titulos: [] }],
            }),
        );
        expect(r.sugestoes).toEqual([]);
        expect(r.desfechos.find((x) => x.docCod === 'X1')).toMatchObject({
            situacao: 'SEM_CANDIDATO',
            candidatos: [],
        });
    });

    it('sem grupos: comportamento idêntico ao de antes (lista vazia ≡ campo ausente)', () => {
        const t = titulo({ docCod: 'S1' });
        const b = boleto({ ditCod: 9003 });
        const sem = motor.analisar(entrada({ titulos: [t], boletos: [b] }));
        const vazio = motor.analisar(
            entrada({ titulos: [t], boletos: [b], gruposConfirmados: [] }),
        );
        expect(vazio).toEqual(sem);
    });
});
