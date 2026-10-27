import 'reflect-metadata';
import type { BoletoDda } from '../../interface/sispag/BoletoDda.js';
import type { TituloAPagar } from '../../interface/sispag/SispagInterface.js';
import {
    type DesfechoTitulo,
    SINAL_SUGESTAO,
    SITUACAO_SUGESTAO_TITULO,
} from '../../interface/sispag/SugestaoBoleto.js';
import CodigoBarrasBoleto from '../../libs/boleto/CodigoBarrasBoleto.js';
import BankingCalendar from '../../libs/calendar/BankingCalendar.js';
import AncoraOrdemDps from './AncoraOrdemDps.js';
import MotorSugestaoBoleto, { type EntradaMotorSugestao } from './MotorSugestaoBoleto.js';
import RegraSugestaoBoleto from './RegraSugestaoBoleto.js';

// I15s (ADR-0079): âncora de número ("NUMERO_CONFIAVEL").
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

const desfecho = (e: EntradaMotorSugestao, t: TituloAPagar): DesfechoTitulo | undefined =>
    motor
        .desfechos(e)
        .find((d) => d.docCod === t.docCod && d.titCod === t.titCod && d.filCod === t.filCod);

const escolha = (d: DesfechoTitulo | undefined) => d?.candidatos.find((c) => c.confirmavel);

describe('MotorSugestaoBoleto — âncora de número (I15s, NUMERO_CONFIAVEL)', () => {
    describe('caso real: título 25037 × boletos 25037 e 25041 (mesmo valor, dia e emissor)', () => {
        const t = titulo('25037');
        const irmao = titulo('25041', { titCod: '1', docCod: '25041' });
        const b37 = boleto('25037');
        const b41 = boleto('25041');

        it('escolhe o boleto de número igual, confirmável, com o sinal', () => {
            const d = desfecho(entrada({ titulos: [t], boletos: [b37, b41] }), t);
            expect(d?.situacao).toBe(SITUACAO_SUGESTAO_TITULO.UNICA_SEGURA);
            expect(escolha(d)?.numeroBoleto).toBe('25037');
            expect(escolha(d)?.avaliacao.sinais).toContain(SINAL_SUGESTAO.NUMERO_CONFIAVEL);
            expect(escolha(d)?.avaliacao.sinais).toContain(SINAL_SUGESTAO.NUMERO_IGUAL);
        });

        it('contrato legado: sugere o 25037', () => {
            const r = motor.sugerir(entrada({ titulos: [t], boletos: [b37, b41] }));
            expect(r.find((s) => s.docCod === '25037')?.numeroBoleto).toBe('25037');
        });

        it('reserva o boleto: o título irmão fica com o 25041 e não o vê como compartilhado', () => {
            const e = entrada({ titulos: [t, irmao], boletos: [b37, b41] });
            const d37 = desfecho(e, t);
            const d41 = desfecho(e, irmao);
            expect(escolha(d37)?.numeroBoleto).toBe('25037');
            expect(escolha(d41)?.numeroBoleto).toBe('25041');
            const vistoPeloIrmao = d41?.candidatos.find((c) => c.numeroBoleto === '25037');
            expect(vistoPeloIrmao?.compartilhado).toBeUndefined();
            expect(vistoPeloIrmao?.confirmavel).toBe(false);
        });
    });

    describe('âncora desligada (leitura de números indisponível)', () => {
        it('numeroAncoraDesligada: nenhum candidato recebe NUMERO_CONFIAVEL, mesmo no caso real', () => {
            const t = titulo('25037');
            const d = desfecho(
                entrada({
                    titulos: [t],
                    boletos: [boleto('25037'), boleto('25041')],
                    numeroAncoraDesligada: true,
                }),
                t,
            );
            expect(d?.situacao).toBe(SITUACAO_SUGESTAO_TITULO.AMBIGUA);
            expect(
                d?.candidatos.some((c) =>
                    c.avaliacao.sinais.includes(SINAL_SUGESTAO.NUMERO_CONFIAVEL),
                ),
            ).toBe(false);
        });
    });

    describe('desqualificadores', () => {
        it('número com 3 dígitos não ancora', () => {
            const t = titulo('250');
            const d = desfecho(
                entrada({ titulos: [t], boletos: [boleto('250'), boleto('251')] }),
                t,
            );
            expect(d?.situacao).toBe(SITUACAO_SUGESTAO_TITULO.AMBIGUA);
        });

        it('zeros à esquerda não contam como dígitos significativos', () => {
            const t = titulo('0250');
            const d = desfecho(
                entrada({ titulos: [t], boletos: [boleto('0250'), boleto('0251')] }),
                t,
            );
            expect(d?.situacao).toBe(SITUACAO_SUGESTAO_TITULO.AMBIGUA);
        });

        it('boleto duplicado no pool com o mesmo emissor desqualifica (mesmo vinculado, outra data)', () => {
            const t = titulo('25037');
            const ligado = boleto('25037', {
                vencimento: '2026-03-01',
                filCod: 2,
                docCod: '999',
                titCod: '1',
            });
            const d = desfecho(
                entrada({ titulos: [t], boletos: [boleto('25037'), boleto('25041'), ligado] }),
                t,
            );
            expect(d?.situacao).toBe(SITUACAO_SUGESTAO_TITULO.AMBIGUA);
        });

        it('boleto de mesmo número em OUTRO emissor não desqualifica', () => {
            const t = titulo('25037');
            const outro = boleto('25037', { emissor: EMISSOR_B, vencimento: '2026-03-01' });
            const d = desfecho(
                entrada({ titulos: [t], boletos: [boleto('25037'), boleto('25041'), outro] }),
                t,
            );
            expect(escolha(d)?.numeroBoleto).toBe('25037');
        });

        it('outro título do mesmo credor com o mesmo número (lista sem filtro ativo) desqualifica', () => {
            const t = titulo('25037');
            const d = desfecho(
                entrada({
                    titulos: [t],
                    boletos: [boleto('25037'), boleto('25041')],
                    titulosDoCredor: [
                        {
                            filCod: 2,
                            docCod: '25037',
                            titCod: '1',
                            pesCod: '387',
                            numeroDocumento: '25037',
                        },
                        {
                            filCod: 2,
                            docCod: '777',
                            titCod: '1',
                            pesCod: '387',
                            numeroDocumento: '025037',
                        },
                    ],
                }),
                t,
            );
            expect(d?.situacao).toBe(SITUACAO_SUGESTAO_TITULO.AMBIGUA);
        });

        it('mesmo número em outro credor não desqualifica', () => {
            const t = titulo('25037');
            const d = desfecho(
                entrada({
                    titulos: [t],
                    boletos: [boleto('25037'), boleto('25041')],
                    titulosDoCredor: [
                        {
                            filCod: 2,
                            docCod: '777',
                            titCod: '1',
                            pesCod: '555',
                            numeroDocumento: '25037',
                        },
                    ],
                }),
                t,
            );
            expect(escolha(d)?.numeroBoleto).toBe('25037');
        });

        it('outra parcela do MESMO documento não desqualifica', () => {
            const t = titulo('25037', { titCod: '1' });
            const parcela2 = titulo('25037', { titCod: '2', valor: 900 });
            const d = desfecho(
                entrada({
                    titulos: [t, parcela2],
                    boletos: [boleto('25037'), boleto('25041')],
                    titulosDoCredor: [
                        {
                            filCod: 2,
                            docCod: '25037',
                            titCod: '1',
                            pesCod: '387',
                            numeroDocumento: '25037',
                        },
                        {
                            filCod: 2,
                            docCod: '25037',
                            titCod: '2',
                            pesCod: '387',
                            numeroDocumento: '25037',
                        },
                    ],
                }),
                t,
            );
            expect(escolha(d)?.numeroBoleto).toBe('25037');
        });

        it('dois candidatos do título com o mesmo número desqualificam', () => {
            const t = titulo('25037');
            const e = entrada({
                titulos: [t],
                boletos: [
                    boleto('25037'),
                    boleto('25037', { emissor: EMISSOR_B }),
                    boleto('25041'),
                ],
            });
            expect(desfecho(e, t)?.situacao).toBe(SITUACAO_SUGESTAO_TITULO.AMBIGUA);
            expect(
                desfecho(e, t)?.candidatos.some((c) =>
                    c.avaliacao.sinais.includes(SINAL_SUGESTAO.NUMERO_CONFIAVEL),
                ),
            ).toBe(false);
        });

        it('boleto sem emissor (barras ilegíveis) não ancora', () => {
            const t = titulo('25037');
            const d = desfecho(
                entrada({
                    titulos: [t],
                    boletos: [
                        boleto('25037', { codbar: undefined }),
                        boleto('25041', { codbar: undefined }),
                    ],
                }),
                t,
            );
            expect(d?.situacao).toBe(SITUACAO_SUGESTAO_TITULO.AMBIGUA);
        });

        it('fora do envelope FORTE (ATENCAO) não ancora: segue a regra de antes', () => {
            const t = titulo('25037');
            const d = desfecho(
                entrada({ titulos: [t], boletos: [boleto('25037', { valor: 647.9 })] }),
                t,
            );
            expect(
                d?.candidatos.every(
                    (c) => !c.avaliacao.sinais.includes(SINAL_SUGESTAO.NUMERO_CONFIAVEL),
                ),
            ).toBe(true);
        });
    });

    describe('precedência', () => {
        it('vence um candidato CONHECIDO (par vigente do emissor) de outro boleto', () => {
            const t = titulo('25037');
            const b37 = boleto('25037', { emissor: EMISSOR_A });
            const conhecido = boleto('25041', { emissor: EMISSOR_B });
            const e = entrada({
                titulos: [t],
                boletos: [b37, conhecido],
                paresVigentes: [{ pesCod: '387', emissorChave: '237:2656:0099999' }],
            });
            const d = desfecho(e, t);
            expect(escolha(d)?.numeroBoleto).toBe('25037');
            expect(d?.situacao).toBe(SITUACAO_SUGESTAO_TITULO.UNICA_SEGURA);
        });

        it('DPS e número em boletos DIFERENTES do mesmo título: AMBIGUA, sem escolha', () => {
            const t = titulo('25037');
            const bNumero = boleto('25037');
            const bDps = boleto('776132000');
            const e = entrada({
                titulos: [t],
                boletos: [bNumero, bDps],
                dps: [{ filCod: 2, docCod: '25037', titCod: '1', pesCod: '387', dps: '776132' }],
            });
            const d = desfecho(e, t);
            expect(d?.situacao).toBe(SITUACAO_SUGESTAO_TITULO.AMBIGUA);
            expect(escolha(d)).toBeUndefined();
            expect(motor.sugerir(e).find((s) => s.docCod === '25037')).toBeUndefined();
        });

        it('DPS e número apontando para o MESMO boleto: escolhido', () => {
            const t = titulo('25037000');
            const b = boleto('25037000');
            const outro = boleto('25041');
            const e = entrada({
                titulos: [t],
                boletos: [b, outro],
                dps: [{ filCod: 2, docCod: '25037000', titCod: '1', pesCod: '387', dps: '25037' }],
            });
            const d = desfecho(e, t);
            expect(d?.situacao).toBe(SITUACAO_SUGESTAO_TITULO.UNICA_SEGURA);
            expect(escolha(d)?.numeroBoleto).toBe('25037000');
            expect(escolha(d)?.avaliacao.sinais).toEqual(
                expect.arrayContaining([SINAL_SUGESTAO.DPS_IGUAL, SINAL_SUGESTAO.NUMERO_CONFIAVEL]),
            );
        });

        it('dois títulos reivindicando o mesmo boleto por número: nenhum reserva', () => {
            // Mesmo número em dois títulos de credores diferentes, boleto único do emissor A.
            const t1 = titulo('25037', { pesCod: '387', vencimento: utc(DIA) });
            const t2 = titulo('25037', { pesCod: '388', docCod: '25037', filCod: 3 });
            const b = boleto('25037');
            const e = entrada({ titulos: [t1, t2], boletos: [b] });
            const d1 = desfecho(e, t1);
            // sem reserva por âncora, a disputa comum (menor vencimento/doc/filial) decide
            expect(d1?.candidatos[0]?.avaliacao.sinais).toContain(SINAL_SUGESTAO.NUMERO_CONFIAVEL);
            const escolhas = [d1, desfecho(e, t2)].filter((d) => escolha(d));
            expect(escolhas).toHaveLength(1);
        });
    });
});
