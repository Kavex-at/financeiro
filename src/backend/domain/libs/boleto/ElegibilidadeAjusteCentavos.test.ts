import 'reflect-metadata';
import { LIMITE_VALOR_MESMO_DIA } from '../../service/sispag/RegraSugestaoBoleto.js';
import CodigoBarrasBoleto from './CodigoBarrasBoleto.js';
import CodigoBarrasSintetico from './CodigoBarrasSintetico.js';
import ElegibilidadeAjusteCentavos, {
    type EntradaElegibilidadeAjuste,
    FRN_VLD_TPOP,
    MOTIVO_INELEGIVEL_AJUSTE,
} from './ElegibilidadeAjusteCentavos.js';
import { MODO_AJUSTE } from './ModoAjusteCentavos.js';
import ValorAbertoLiquido from './ValorAbertoLiquido.js';

const regra = new ElegibilidadeAjusteCentavos(new CodigoBarrasBoleto());

const VENC = '2026-10-30';

/** NELSON (caso canônico 1): título 462,49 × boleto 462,50, mesmo vencimento, nº igual. */
const base = (
    sobrescreve: Partial<EntradaElegibilidadeAjuste> = {},
    boleto: { valor?: number; vencimento?: string } = {},
): EntradaElegibilidadeAjuste => ({
    modo: MODO_AJUSTE.ON,
    decisao: { id: 'dec-1', decisao: 'CONFIRMADA', orfa: false, parVigente: true },
    numeroTitulo: '12294',
    numeroBoleto: '12294',
    codigo: CodigoBarrasSintetico.linhaDigitavel({
        valor: boleto.valor ?? 462.5,
        vencimento: boleto.vencimento ?? VENC,
        serie: 1,
    }),
    vencimentoTitulo: VENC,
    aberto: ValorAbertoLiquido.semAcrescimos(462.49),
    aprovadoNoErp: true,
    aprovadoNaCarteira: true,
    pago: false,
    jaAjustadoNaLinhagem: false,
    emLoteFinalizado: false,
    emRascunhoNativo: false,
    ...sobrescreve,
});

describe('ElegibilidadeAjusteCentavos (I18a/I18b/I18m, ADR-0073)', () => {
    it('caso canônico 1: Δ +0,01 ⇒ elegível, frnVldTpop 1 (acréscimo), 0,01', () => {
        const r = regra.avaliar(base());
        expect(r.elegivel).toBe(true);
        expect(r.candidato).toBe(true);
        expect(r.deltaCentavos).toBe(1);
        expect(r.valorBoletoCentavos).toBe(46250);
        expect(r.abertoLiquidoCentavos).toBe(46249);
        expect(r.ajuste).toEqual({ frnVldTpop: FRN_VLD_TPOP.ACRESCIMO, frnMnyValor: 0.01 });
        expect(r.decisaoId).toBe('dec-1');
    });

    it('caso canônico 2: 178,78 × 178,77 ⇒ frnVldTpop 2 (desconto), 0,01', () => {
        const r = regra.avaliar(
            base({ aberto: ValorAbertoLiquido.semAcrescimos(178.78) }, { valor: 178.77 }),
        );
        expect(r.elegivel).toBe(true);
        expect(r.deltaCentavos).toBe(-1);
        expect(r.ajuste).toEqual({ frnVldTpop: FRN_VLD_TPOP.DESCONTO, frnMnyValor: 0.01 });
    });

    it('frnVldTpop 0 nunca leva valor: Δ = 0 não produz ajuste', () => {
        const r = regra.avaliar(base({}, { valor: 462.49 }));
        expect(r.elegivel).toBe(false);
        expect(r.motivo).toBe(MOTIVO_INELEGIVEL_AJUSTE.DELTA_ZERO);
        expect(r.ajuste).toBeUndefined();
        expect(FRN_VLD_TPOP.SEM_AJUSTE).toBe(0);
    });

    describe('limite: a MESMA constante da I15c (LIMITE_VALOR_MESMO_DIA)', () => {
        const limiteCentavos = Math.round(LIMITE_VALOR_MESMO_DIA * 100);

        it('usa R$ 0,05 (constante importada; nenhuma paralela)', () => {
            expect(limiteCentavos).toBe(5);
            expect(Object.keys(MOTIVO_INELEGIVEL_AJUSTE)).not.toContain('LIMITE');
        });

        it.each([limiteCentavos, -limiteCentavos])('Δ = %i centavos ⇒ elegível', (d) => {
            const r = regra.avaliar(base({}, { valor: (46249 + d) / 100 }));
            expect(r.elegivel).toBe(true);
            expect(r.deltaCentavos).toBe(d);
        });

        it.each([
            limiteCentavos + 1,
            -(limiteCentavos + 1),
        ])('caso canônico 3: Δ = %i centavos ⇒ DELTA_ACIMA_LIMITE, sem ajuste', (d) => {
            const r = regra.avaliar(base({}, { valor: (46249 + d) / 100 }));
            expect(r.elegivel).toBe(false);
            expect(r.candidato).toBe(false);
            expect(r.motivo).toBe(MOTIVO_INELEGIVEL_AJUSTE.DELTA_ACIMA_LIMITE);
            expect(r.ajuste).toBeUndefined();
        });
    });

    describe('I18a: cada condição falsa tem o seu motivo', () => {
        it.each<[string, Partial<EntradaElegibilidadeAjuste>, string]>([
            ['sem decisão', { decisao: undefined }, 'SEM_DECISAO_CONFIRMADA'],
            [
                'decisão rejeitada',
                { decisao: { id: 'd', decisao: 'REJEITADA', orfa: false, parVigente: true } },
                'SEM_DECISAO_CONFIRMADA',
            ],
            [
                'decisão órfã',
                { decisao: { id: 'd', decisao: 'CONFIRMADA', orfa: true, parVigente: true } },
                'SEM_DECISAO_CONFIRMADA',
            ],
            [
                'par não vigente',
                { decisao: { id: 'd', decisao: 'CONFIRMADA', orfa: false, parVigente: false } },
                'PAR_NAO_VIGENTE',
            ],
            ['número diferente', { numeroBoleto: '12295' }, 'NUMERO_DIFERENTE'],
            ['número ausente', { numeroTitulo: undefined }, 'NUMERO_DIFERENTE'],
            ['título não aprovado no ERP', { aprovadoNoErp: false }, 'TITULO_NAO_APROVADO'],
            [
                'título não aprovado na carteira',
                { aprovadoNaCarteira: false },
                'TITULO_NAO_APROVADO',
            ],
            ['título pago', { pago: true }, 'TITULO_PAGO_OU_PARCIAL'],
            [
                'caso canônico 13: pagamento parcial',
                {
                    aberto: {
                        totalLiquido: 500,
                        totalPago: 37.51,
                        totalAberto: 462.49,
                        titMnyJuros: 0,
                        titMnyDesconto: 0,
                    },
                },
                'TITULO_PAGO_OU_PARCIAL',
            ],
            [
                'juros prévio',
                {
                    aberto: {
                        totalLiquido: 462.49,
                        totalPago: 0,
                        totalAberto: 462.48,
                        titMnyJuros: 0.01,
                        titMnyDesconto: 0,
                    },
                },
                'JUROS_OU_DESCONTO_PREVIO',
            ],
            ['já ajustado na linhagem', { jaAjustadoNaLinhagem: true }, 'JA_AJUSTADO_NA_LINHAGEM'],
            ['lote finalizado', { emLoteFinalizado: true }, 'TITULO_EM_LOTE_FINALIZADO'],
            ['rascunho nativo', { emRascunhoNativo: true }, 'TITULO_EM_RASCUNHO_NATIVO'],
            ['modo shadow', { modo: MODO_AJUSTE.SHADOW }, 'MODO_NAO_ON'],
            ['modo off', { modo: MODO_AJUSTE.OFF }, 'MODO_NAO_ON'],
            ['aberto ilegível', { aberto: undefined }, 'VALOR_ABERTO_INDISPONIVEL'],
            ['código ausente', { codigo: undefined }, 'BOLETO_INDISPONIVEL'],
        ])('%s ⇒ %s', (_nome, sobrescreve, motivo) => {
            const r = regra.avaliar(base(sobrescreve));
            expect(r.elegivel).toBe(false);
            expect(r.motivo).toBe(motivo);
            expect(r.ajuste).toBeUndefined();
        });

        it('os motivos são todos distintos', () => {
            const valores = Object.values(MOTIVO_INELEGIVEL_AJUSTE);
            expect(new Set(valores).size).toBe(valores.length);
        });

        it('modo shadow: candidato (tudo menos o modo), mas não elegível', () => {
            const r = regra.avaliar(base({ modo: MODO_AJUSTE.SHADOW }));
            expect(r.candidato).toBe(true);
            expect(r.elegivel).toBe(false);
            expect(r.ajuste).toEqual({ frnVldTpop: 1, frnMnyValor: 0.01 });
        });
    });

    describe('número do documento: dígitos estritos (I15f)', () => {
        it('"012294" × "12294" é número igual pela regra existente', () => {
            const r = regra.avaliar(base({ numeroTitulo: '012294', numeroBoleto: '12294' }));
            expect(r.elegivel).toBe(true);
        });

        it('caso canônico 4: MSC nº 12294 com número igual e par NÃO vigente ⇒ inelegível', () => {
            const r = regra.avaliar(
                base({
                    decisao: { id: 'd', decisao: 'CONFIRMADA', orfa: false, parVigente: false },
                }),
            );
            expect(r.elegivel).toBe(false);
            expect(r.motivo).toBe(MOTIVO_INELEGIVEL_AJUSTE.PAR_NAO_VIGENTE);
        });
    });

    describe('vencimento (data civil, UTC meia-noite)', () => {
        it('boleto um dia depois ⇒ VENCIMENTO_DIFERENTE', () => {
            const r = regra.avaliar(base({}, { vencimento: '2026-10-31' }));
            expect(r.motivo).toBe(MOTIVO_INELEGIVEL_AJUSTE.VENCIMENTO_DIFERENTE);
        });

        it('vencimento do título com offset São Paulo não desloca o dia', () => {
            // Quem chama passa a data civil; um ISO com hora/offset é reduzido ao dia UTC.
            const r = regra.avaliar(base({ vencimentoTitulo: '2026-10-30T00:00:00.000Z' }));
            expect(r.elegivel).toBe(true);
            const r2 = regra.avaliar(base({ vencimentoTitulo: '2026-10-30T15:00:00-03:00' }));
            expect(r2.elegivel).toBe(true);
        });
    });

    it('valorBoleto é o da NOSSA decodificação da barra; o valor do DDA é ignorado', () => {
        const comDda = regra.avaliar({ ...base(), poolValor: 999 } as EntradaElegibilidadeAjuste);
        expect(comDda.valorBoletoCentavos).toBe(46250);
        expect(comDda.elegivel).toBe(true);
    });

    it('a régua líquida é a da I17b (mesma função, não cópia)', () => {
        const spy = jest.spyOn(ValorAbertoLiquido, 'calcularCentavos');
        const entrada = base();
        regra.avaliar(entrada);
        expect(spy).toHaveBeenCalledWith(entrada.aberto);
        spy.mockRestore();
    });

    it('saída sem linha completa (nem 44 nem 47 dígitos); só máscara 5+4', () => {
        const r = regra.avaliar(base());
        expect(r.codigoMascarado).toMatch(/^\d{5}…\d{4}$/);
        expect(JSON.stringify(r)).not.toMatch(/\d{20,}/);
    });
});
