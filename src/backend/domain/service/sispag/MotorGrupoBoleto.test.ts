import 'reflect-metadata';
import type { BoletoDda } from '../../interface/sispag/BoletoDda.js';
import { MOTIVO_GRUPO_INELEGIVEL as M } from '../../interface/sispag/GrupoBoletoInterface.js';
import type { TituloAPagar } from '../../interface/sispag/SispagInterface.js';
import CodigoBarrasBoleto from '../../libs/boleto/CodigoBarrasBoleto.js';
import BankingCalendar from '../../libs/calendar/BankingCalendar.js';
import F from './__fixtures__/grupoBoleto.js';
import MotorGrupoBoleto, { type EntradaMotorGrupo } from './MotorGrupoBoleto.js';
import RegraGrupoBoleto from './RegraGrupoBoleto.js';

const codigoBarras = new CodigoBarrasBoleto();
const motor = new MotorGrupoBoleto(
    codigoBarras,
    BankingCalendar.withClock(() => new Date('2026-10-20T15:00:00Z')),
    new RegraGrupoBoleto(codigoBarras),
);

const entrada = (over: Partial<EntradaMotorGrupo>): EntradaMotorGrupo => ({
    titulos: [],
    boletos: [],
    paresVigentes: [],
    decisoesConfirmadas: [],
    gruposConfirmados: [],
    marcasAtivas: [],
    ...over,
});

const docs = (s: { titulos: Array<{ docCod: string }> }): string[] =>
    s.titulos.map((t) => t.docCod);

describe('MotorGrupoBoleto — sugestão de grupo fechado no mesmo vencimento (I21e, I21f, PI-7)', () => {
    it('PEDRONI: 3 × R$ 525,00 = boleto 332841 de R$ 1.575,00 ⇒ uma sugestão confirmável', () => {
        const [s, ...resto] = motor.sugerir(entrada(F.pedroni()));
        expect(resto).toEqual([]);
        expect(s).toMatchObject({
            filCod: 2,
            pesCod: '9001',
            credor: 'PEDRONI',
            ditCod: 332841,
            numeroBoleto: '332841',
            valorBoletoCentavos: 157500,
            somaTitulosCentavos: 157500,
            vencimentoBoleto: '2026-10-21',
            intercambiavel: false,
            confirmavel: true,
            motivos: [],
        });
        expect(s && docs(s)).toEqual(['38883', '38884', '38885']);
        expect(s?.titulos.map((t) => t.valorCentavos)).toEqual([52500, 52500, 52500]);
    });

    it('S2: a sugestão carrega os avisos da regra (sugerido do mesmo dia não tem aviso)', () => {
        const p = F.pedroni();
        const [s] = motor.sugerir(entrada({ titulos: p.titulos, boletos: p.boletos }));
        expect(s?.avisos).toEqual([]);
    });

    it('HML AR SOLUÇÕES: 552/1 + 558/1 = R$ 2.346,94 ⇒ sugerido', () => {
        const sugestoes = motor.sugerir(entrada(F.arSolucoes()));
        expect(sugestoes).toHaveLength(1);
        expect(sugestoes[0] && docs(sugestoes[0])).toEqual(['552', '558']);
        expect(sugestoes[0]?.valorBoletoCentavos).toBe(234694);
    });

    it('par VIGENTE do emissor aparece como evidência (parVigente)', () => {
        const pedroni = F.pedroni();
        const emissor = codigoBarras.emissor(pedroni.boletos[0]?.codbar);
        const [s] = motor.sugerir(
            entrada({
                ...pedroni,
                paresVigentes: [{ pesCod: '9001', emissorChave: emissor?.chave ?? '' }],
            }),
        );
        expect(s?.parVigente).toBe(true);
        expect(s?.emissorChave).toBe(emissor?.chave);
    });

    describe('nunca subconjunto (I21e, M1)', () => {
        it('4 títulos em que 3 somariam o boleto ⇒ zero sugestão', () => {
            const pedroni = F.pedroni();
            const quarto = F.titulo({ docCod: '38886', valor: 100 });
            expect(
                motor.sugerir(entrada({ ...pedroni, titulos: [...pedroni.titulos, quarto] })),
            ).toEqual([]);
        });

        it('PI-7: título em alçada no conjunto fechado ⇒ sugestão presente, não confirmável', () => {
            const pedroni = F.pedroni();
            const titulos = pedroni.titulos.map((t) =>
                t.docCod === '38884' ? { ...t, liberado: false } : t,
            );
            const sugestoes = motor.sugerir(entrada({ ...pedroni, titulos }));
            expect(sugestoes).toHaveLength(1);
            const [s] = sugestoes;
            expect(s?.confirmavel).toBe(false);
            expect(s?.motivo).toBe(M.NAO_LIBERADO);
            // O título nunca é descartado para sugerir os demais.
            expect(s && docs(s)).toEqual(['38883', '38884', '38885']);
            expect(s?.titulos[1]?.motivos).toEqual([M.NAO_LIBERADO]);
        });

        it('PI-7: título com marca de retenção ativa ⇒ exibido com MARCA_RETENCAO_ATIVA', () => {
            const pedroni = F.pedroni();
            const [s] = motor.sugerir(
                entrada({
                    ...pedroni,
                    marcasAtivas: [{ filCod: 2, docCod: '38885', titCod: '1' }],
                }),
            );
            expect(s?.confirmavel).toBe(false);
            expect(s?.titulos[2]?.motivos).toEqual([M.MARCA_RETENCAO_ATIVA]);
        });

        it('PI-7: título com decisão 1:1 confirmada ⇒ exibido com DECISAO_1_1_CONFIRMADA', () => {
            const pedroni = F.pedroni();
            const [s] = motor.sugerir(
                entrada({
                    ...pedroni,
                    decisoesConfirmadas: [
                        { filCod: 2, docCod: '38883', titCod: '1', ddcCod: 1, ditCod: 9 },
                    ],
                }),
            );
            expect(s?.confirmavel).toBe(false);
            expect(s?.motivo).toBe(M.DECISAO_1_1_CONFIRMADA);
        });

        it('título em lote comprometido ⇒ exibido com EM_LOTE_COMPROMETIDO', () => {
            const pedroni = F.pedroni();
            const titulos = pedroni.titulos.map((t, i) =>
                i === 0
                    ? { ...t, loteComprometido: { id: 'L1', status: 'FINALIZADO' } as never }
                    : t,
            );
            const [s] = motor.sugerir(entrada({ ...pedroni, titulos }));
            expect(s?.motivo).toBe(M.EM_LOTE_COMPROMETIDO);
        });

        it('título pago ou inativo não está "em aberto": sai do conjunto', () => {
            const pedroni = F.pedroni();
            const extras = [
                F.titulo({ docCod: '1', valor: 300, pago: true }),
                F.titulo({ docCod: '2', valor: 300, ativo: false }),
            ];
            const sugestoes = motor.sugerir(
                entrada({ ...pedroni, titulos: [...pedroni.titulos, ...extras] }),
            );
            expect(sugestoes).toHaveLength(1);
            expect(sugestoes[0] && docs(sugestoes[0])).toEqual(['38883', '38884', '38885']);
        });
    });

    describe('a chave é pesCod × filial × vencimento', () => {
        it('mesmo credor em duas filiais: o conjunto que cruza filial nunca é formado', () => {
            const titulos = [
                F.titulo({ docCod: '1', filCod: 2, valor: 1000 }),
                F.titulo({ docCod: '2', filCod: 4, valor: 575 }),
            ];
            expect(motor.sugerir(entrada({ titulos, boletos: F.pedroni().boletos }))).toEqual([]);
        });

        it('só a filial cuja soma fecha é sugerida; a outra filial não entra', () => {
            const pedroni = F.pedroni();
            const outraFilial = F.titulo({ docCod: '9', filCod: 4, valor: 50 });
            const sugestoes = motor.sugerir(
                entrada({ ...pedroni, titulos: [...pedroni.titulos, outraFilial] }),
            );
            expect(sugestoes).toHaveLength(1);
            expect(sugestoes[0]?.filCod).toBe(2);
        });

        it('canônico 333111 (títulos 25/10, boleto 26/10) ⇒ não sugerido', () => {
            expect(motor.sugerir(entrada(F.caso333111()))).toEqual([]);
        });

        it('um título só (N = 1) segue o caminho 1:1: nunca vira grupo', () => {
            const titulos = [F.titulo({ docCod: '1', valor: 1575 })];
            expect(motor.sugerir(entrada({ titulos, boletos: F.pedroni().boletos }))).toEqual([]);
        });

        it('dois credores com a mesma soma no mesmo dia para um boleto ⇒ ambíguo, sem sugestão', () => {
            const pedroni = F.pedroni();
            const outro = ['1', '2', '3'].map((docCod) => F.titulo({ docCod, pesCod: '9002' }));
            expect(
                motor.sugerir(entrada({ ...pedroni, titulos: [...pedroni.titulos, ...outro] })),
            ).toEqual([]);
        });

        it('dois boletos iguais para um conjunto que soma um só ⇒ ambíguo, sem sugestão', () => {
            const pedroni = F.pedroni();
            const outro = F.boleto({ ditCod: 332899 });
            expect(
                motor.sugerir(entrada({ ...pedroni, boletos: [...pedroni.boletos, outro] })),
            ).toEqual([]);
        });
    });

    describe('I21f — intercambiáveis (PEDRONI)', () => {
        it('K = 3 boletos de R$ 1.575,00 × 9 títulos de R$ 525,00 ⇒ 3 grupos, partição determinística', () => {
            const sugestoes = motor.sugerir(entrada(F.pedroniIntercambiavel()));
            expect(sugestoes).toHaveLength(3);
            expect(sugestoes.map((s) => s.ditCod)).toEqual([332841, 332842, 332843]);
            expect(sugestoes.map(docs)).toEqual([
                ['38883', '38884', '38885'],
                ['38886', '38887', '38888'],
                ['38889', '38890', '38891'],
            ]);
            expect(sugestoes.every((s) => s.intercambiavel && s.confirmavel)).toBe(true);
            expect(sugestoes.every((s) => s.valorBoletoCentavos === 157500)).toBe(true);
        });

        it('a ordem da entrada não muda a partição', () => {
            const base = F.pedroniIntercambiavel();
            const embaralhada = entrada({
                titulos: [...base.titulos].reverse(),
                boletos: [...base.boletos].reverse(),
            });
            expect(motor.sugerir(embaralhada)).toEqual(motor.sugerir(entrada(base)));
        });

        it('títulos de valores diferentes com K ≥ 2 ⇒ nenhuma sugestão', () => {
            const base = F.pedroniIntercambiavel();
            const titulos = base.titulos.map((t, i) =>
                i === 0 ? { ...t, valor: 524 } : i === 1 ? { ...t, valor: 526 } : t,
            );
            expect(motor.sugerir(entrada({ ...base, titulos }))).toEqual([]);
        });

        it('K boletos de emissores diferentes não são intercambiáveis', () => {
            const base = F.pedroniIntercambiavel();
            const boletos = base.boletos.map((b, i) =>
                i === 0 ? F.boleto({ ditCod: b.ditCod, banco: '237' }) : b,
            );
            expect(motor.sugerir(entrada({ ...base, boletos }))).toEqual([]);
        });
    });

    describe('o que já está confirmado não entra', () => {
        it('boleto de grupo CONFIRMADO não é candidato', () => {
            const pedroni = F.pedroni();
            expect(
                motor.sugerir(
                    entrada({
                        ...pedroni,
                        gruposConfirmados: [
                            { id: 'g-1', ddcCod: 900, ditCod: 332841, titulos: [] },
                        ],
                    }),
                ),
            ).toEqual([]);
        });

        it('boleto com DecisaoSugestaoBoleto CONFIRMADA não é candidato', () => {
            const pedroni = F.pedroni();
            expect(
                motor.sugerir(
                    entrada({
                        ...pedroni,
                        decisoesConfirmadas: [
                            { filCod: 2, docCod: '777', titCod: '1', ddcCod: 900, ditCod: 332841 },
                        ],
                    }),
                ),
            ).toEqual([]);
        });

        it('título em grupo CONFIRMADO não entra no conjunto de outro boleto', () => {
            const pedroni = F.pedroni();
            const doOutroGrupo = F.titulo({ docCod: '40000', valor: 300 });
            const sugestoes = motor.sugerir(
                entrada({
                    ...pedroni,
                    titulos: [...pedroni.titulos, doOutroGrupo],
                    gruposConfirmados: [
                        {
                            id: 'g-9',
                            ddcCod: 1,
                            ditCod: 1,
                            titulos: [{ filCod: 2, docCod: '40000', titCod: '1' }],
                        },
                    ],
                }),
            );
            expect(sugestoes).toHaveLength(1);
            expect(sugestoes[0] && docs(sugestoes[0])).toEqual(['38883', '38884', '38885']);
        });

        it('boleto vinculado pelo ERP ou sem vencimento não é candidato', () => {
            const pedroni = F.pedroni();
            const [b] = pedroni.boletos as [BoletoDda];
            expect(
                motor.sugerir(
                    entrada({
                        ...pedroni,
                        boletos: [{ ...b, filCod: 2, docCod: '5', titCod: '1' }],
                    }),
                ),
            ).toEqual([]);
            const semVencimento = { ...b };
            delete semVencimento.vencimento;
            expect(motor.sugerir(entrada({ ...pedroni, boletos: [semVencimento] }))).toEqual([]);
        });
    });

    describe('pureza e privacidade', () => {
        it('determinístico: mesma entrada ⇒ mesma saída; entrada não é mutada', () => {
            const e = entrada({
                titulos: [...F.pedroni().titulos, ...F.arSolucoes().titulos],
                boletos: [...F.arSolucoes().boletos, ...F.pedroni().boletos],
            });
            const antes = JSON.stringify(e);
            const a = motor.sugerir(e);
            expect(motor.sugerir(e)).toEqual(a);
            expect(JSON.stringify(e)).toBe(antes);
            expect(a.map((s) => s.ditCod)).toEqual([332841, 252]);
        });

        it('a sugestão usa o valor local (G1) e nunca carrega o código completo', () => {
            const s = motor.sugerir(entrada(F.pedroni()));
            const json = JSON.stringify(s);
            expect(json).not.toMatch(/\d{44}/);
            expect(json).not.toMatch(/\d{20,}/);
            expect(s[0]?.codbarMascarado).toMatch(/^\d{5}…\d{4}$/);
        });

        it('título sem pesCod ou sem vencimento não forma conjunto', () => {
            const titulos: TituloAPagar[] = F.pedroni().titulos.map((t) => {
                const c = { ...t };
                delete c.pesCod;
                return c;
            });
            expect(motor.sugerir(entrada({ titulos, boletos: F.pedroni().boletos }))).toEqual([]);
        });
    });
});
