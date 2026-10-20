import 'reflect-metadata';
import {
    AVISO_GRUPO,
    type EntradaAvaliacaoGrupo,
    type GrupoBoleto,
    GRUPO_BOLETO_ESTADO,
    GRUPO_BOLETO_ORIGEM,
    MOTIVO_GRUPO_INELEGIVEL as M,
    MOTIVO_GRUPO_ORFAO,
    type TituloGrupoEntrada,
} from '../../interface/sispag/GrupoBoletoInterface.js';
import CodigoBarrasBoleto from '../../libs/boleto/CodigoBarrasBoleto.js';
import CodigoBarrasSintetico from '../../libs/boleto/CodigoBarrasSintetico.js';
import ValorAbertoLiquido from '../../libs/boleto/ValorAbertoLiquido.js';
import RegraGrupoBoleto, { JANELA_MANUAL_DIAS_MAX } from './RegraGrupoBoleto.js';

const regra = new RegraGrupoBoleto(new CodigoBarrasBoleto());

const titulo = (
    over: Partial<TituloGrupoEntrada> & { valor?: number } = {},
): TituloGrupoEntrada => {
    const { valor = 525, ...resto } = over;
    return {
        filCod: 2,
        docCod: '38883',
        titCod: '1',
        pesCod: '9001',
        vencimento: '2026-10-21',
        liberado: true,
        pago: false,
        ativo: true,
        formaPagamentoConexos: 6,
        temBoleto: false,
        aberto: ValorAbertoLiquido.semAcrescimos(valor),
        decisaoConfirmada: false,
        marcaRetencaoAtiva: false,
        emLoteComprometido: false,
        ...resto,
    };
};

/** PEDRONI fil 2: 38883/38884/38885 (3 × R$ 525,00, venc. 21/10) → boleto 332841 R$ 1.575,00. */
const pedroni = (over: Partial<EntradaAvaliacaoGrupo> = {}): EntradaAvaliacaoGrupo => ({
    origem: GRUPO_BOLETO_ORIGEM.SUGERIDO,
    boleto: {
        ddcCod: 900,
        ditCod: 332841,
        codigo: CodigoBarrasSintetico.barras({ valor: 1575, vencimento: '2026-10-21' }),
        poolValor: 1575,
        poolVencimento: '2026-10-21',
    },
    titulos: [
        titulo({ docCod: '38883' }),
        titulo({ docCod: '38884' }),
        titulo({ docCod: '38885' }),
    ],
    parVigente: true,
    parConfirmavelNoAto: true,
    ...over,
});

const comBoleto = (valor: number, vencimento: string) => ({
    ddcCod: 900,
    ditCod: 333111,
    codigo: CodigoBarrasSintetico.barras({ valor, vencimento }),
    poolValor: valor,
    poolVencimento: vencimento,
});

describe('RegraGrupoBoleto — I19a–d, I19g, I19h (ADR-0076)', () => {
    it('PEDRONI: 3 × R$ 525,00 = R$ 1.575,00 no mesmo vencimento ⇒ confirmável, sem aviso', () => {
        const a = regra.avaliar(pedroni());
        expect(a.confirmavel).toBe(true);
        expect(a.motivos).toEqual([]);
        expect(a.avisos).toEqual([]);
        expect(a.valorBoletoCentavos).toBe(157500);
        expect(a.somaTitulosCentavos).toBe(157500);
        expect(a.deltaCentavos).toBe(0);
        expect(a.vencimentoBoleto).toBe('2026-10-21');
        expect(a.titulos.map((t) => t.valorLiquidoCentavos)).toEqual([52500, 52500, 52500]);
        expect(a.emissorChave).toMatch(/^341:/);
    });

    describe('I19a — forma do grupo', () => {
        it('N = 1 ⇒ MENOS_DE_DOIS_TITULOS (caminho 1:1, PI-1)', () => {
            const a = regra.avaliar(
                pedroni({
                    boleto: comBoleto(525, '2026-10-21'),
                    titulos: [titulo()],
                }),
            );
            expect(a.confirmavel).toBe(false);
            expect(a.motivosGrupo).toContain(M.MENOS_DE_DOIS_TITULOS);
        });

        it('pesCod diferentes ⇒ CREDORES_DIFERENTES (dois credores)', () => {
            const a = regra.avaliar(
                pedroni({
                    titulos: [
                        titulo({ docCod: '1' }),
                        titulo({ docCod: '2' }),
                        titulo({ docCod: '3', pesCod: '9002' }),
                    ],
                }),
            );
            expect(a.confirmavel).toBe(false);
            expect(a.motivo).toBe(M.CREDORES_DIFERENTES);
        });

        it('título sem pesCod não prova o mesmo credor ⇒ CREDORES_DIFERENTES', () => {
            const sem = titulo({ docCod: '3' });
            delete sem.pesCod;
            const a = regra.avaliar(
                pedroni({ titulos: [titulo({ docCod: '1' }), titulo({ docCod: '2' }), sem] }),
            );
            expect(a.motivosGrupo).toContain(M.CREDORES_DIFERENTES);
        });

        it('boleto com docCod/titCod do ERP ⇒ BOLETO_VINCULADO_ERP', () => {
            const base = pedroni();
            const a = regra.avaliar({
                ...base,
                boleto: { ...base.boleto, filCod: 2, docCod: '777', titCod: '1' },
            });
            expect(a.confirmavel).toBe(false);
            expect(a.motivosGrupo).toContain(M.BOLETO_VINCULADO_ERP);
        });

        it('par não VIGENTE e não confirmável no ato ⇒ PAR_NAO_VIGENTE', () => {
            const a = regra.avaliar(pedroni({ parVigente: false, parConfirmavelNoAto: false }));
            expect(a.confirmavel).toBe(false);
            expect(a.motivosGrupo).toEqual([M.PAR_NAO_VIGENTE]);
        });

        it('par confirmável no mesmo ato (ainda não VIGENTE) ⇒ confirmável', () => {
            const a = regra.avaliar(pedroni({ parVigente: false, parConfirmavelNoAto: true }));
            expect(a.confirmavel).toBe(true);
        });
    });

    describe('I19b — soma exata ao centavo pela régua líquida', () => {
        it.each([
            ['+R$ 0,01', 1575.01, -1],
            ['−R$ 0,01', 1574.99, 1],
        ])('boleto %s da soma ⇒ SOMA_DIFERENTE com Δ', (_rotulo, valorBoleto, delta) => {
            const a = regra.avaliar(pedroni({ boleto: comBoleto(valorBoleto, '2026-10-21') }));
            expect(a.confirmavel).toBe(false);
            expect(a.motivosGrupo).toEqual([M.SOMA_DIFERENTE]);
            expect(a.deltaCentavos).toBe(-delta);
        });

        it('título com líquido indisponível ⇒ VALOR_ABERTO_INDISPONIVEL (fail-closed)', () => {
            const sem = titulo({ docCod: '38885' });
            delete sem.aberto;
            const a = regra.avaliar(
                pedroni({
                    titulos: [titulo({ docCod: '38883' }), titulo({ docCod: '38884' }), sem],
                }),
            );
            expect(a.confirmavel).toBe(false);
            expect(a.motivosGrupo).toContain(M.VALOR_ABERTO_INDISPONIVEL);
            expect(a.motivosGrupo).not.toContain(M.SOMA_DIFERENTE);
            expect(a.titulos[2]?.motivos).toEqual([M.VALOR_ABERTO_INDISPONIVEL]);
            expect(a.somaTitulosCentavos).toBeUndefined();
        });

        it('fórmulas do fin064 divergentes ⇒ VALOR_ABERTO_INDISPONIVEL (régua I17b importada)', () => {
            const divergente = titulo({
                docCod: '38885',
                aberto: {
                    totalLiquido: 525,
                    totalPago: 0,
                    totalAberto: 520,
                    titMnyJuros: 0,
                    titMnyDesconto: 0,
                },
            });
            const a = regra.avaliar(
                pedroni({
                    titulos: [titulo({ docCod: '38883' }), titulo({ docCod: '38884' }), divergente],
                }),
            );
            expect(a.motivosGrupo).toContain(M.VALOR_ABERTO_INDISPONIVEL);
        });

        it('a soma usa o LÍQUIDO (com juros/desconto), não um valor base', () => {
            const comJuros = titulo({
                docCod: '38885',
                aberto: {
                    totalLiquido: 525.5,
                    totalPago: 0,
                    totalAberto: 525,
                    titMnyJuros: 0.5,
                    titMnyDesconto: 0,
                },
            });
            const a = regra.avaliar(
                pedroni({
                    boleto: comBoleto(1575.5, '2026-10-21'),
                    titulos: [titulo({ docCod: '38883' }), titulo({ docCod: '38884' }), comJuros],
                }),
            );
            expect(a.confirmavel).toBe(true);
            expect(a.somaTitulosCentavos).toBe(157550);
        });

        it('valorBoleto vem da decodificação nossa: campo do DDA diferente ⇒ BOLETO_INCONSISTENTE', () => {
            const base = pedroni();
            const a = regra.avaliar({ ...base, boleto: { ...base.boleto, poolValor: 1500 } });
            expect(a.confirmavel).toBe(false);
            expect(a.motivosGrupo).toContain(M.BOLETO_INCONSISTENTE);
        });

        it('código ausente ⇒ BOLETO_INDISPONIVEL; código com DV errado ⇒ CODIGO_INVALIDO', () => {
            const base = pedroni();
            const semCodigo = { ...base.boleto };
            delete semCodigo.codigo;
            expect(regra.avaliar({ ...base, boleto: semCodigo }).motivosGrupo).toContain(
                M.BOLETO_INDISPONIVEL,
            );
            const corrompido = CodigoBarrasSintetico.corrompido(base.boleto.codigo ?? '');
            expect(
                regra.avaliar({ ...base, boleto: { ...base.boleto, codigo: corrompido } })
                    .motivosGrupo,
            ).toContain(M.CODIGO_INVALIDO);
        });
    });

    describe('I19c — cada título elegível, motivo próprio por causa', () => {
        it.each([
            [M.NAO_LIBERADO, { liberado: false }],
            [M.PAGO, { pago: true }],
            [M.INATIVO, { ativo: false }],
            [M.FORMA_NAO_BOLETO, { formaPagamentoConexos: 1 }],
            [M.TEM_BOLETO_ERP, { temBoleto: true }],
            [M.DECISAO_1_1_CONFIRMADA, { decisaoConfirmada: true }],
            [M.MARCA_RETENCAO_ATIVA, { marcaRetencaoAtiva: true }],
            [M.EM_LOTE_COMPROMETIDO, { emLoteComprometido: true }],
            [M.EM_OUTRO_GRUPO, { grupoConfirmadoId: 'g-outro' }],
        ] as const)('%s', (motivo, over) => {
            const a = regra.avaliar(
                pedroni({
                    titulos: [
                        titulo({ docCod: '38883' }),
                        titulo({ docCod: '38884', ...over }),
                        titulo({ docCod: '38885' }),
                    ],
                }),
            );
            expect(a.confirmavel).toBe(false);
            expect(a.motivo).toBe(motivo);
            expect(a.titulos[1]?.motivos).toEqual([motivo]);
            expect(a.titulos[0]?.motivos).toEqual([]);
        });

        it('forma de pagamento desconhecida (nunca lida) ⇒ FORMA_NAO_BOLETO', () => {
            const sem = titulo({ docCod: '38885' });
            delete sem.formaPagamentoConexos;
            const a = regra.avaliar(
                pedroni({
                    titulos: [titulo({ docCod: '38883' }), titulo({ docCod: '38884' }), sem],
                }),
            );
            expect(a.titulos[2]?.motivos).toEqual([M.FORMA_NAO_BOLETO]);
        });

        it('o próprio grupo reavaliado não conta como "outro grupo"', () => {
            const a = regra.avaliar(
                pedroni({
                    grupoId: 'g-1',
                    titulos: [
                        titulo({ docCod: '38883', grupoConfirmadoId: 'g-1' }),
                        titulo({ docCod: '38884', grupoConfirmadoId: 'g-1' }),
                        titulo({ docCod: '38885', grupoConfirmadoId: 'g-1' }),
                    ],
                }),
            );
            expect(a.confirmavel).toBe(true);
        });

        it('todos os motivos do título aparecem, sem repetição', () => {
            const a = regra.avaliar(
                pedroni({
                    titulos: [
                        titulo({ docCod: '38883', liberado: false, marcaRetencaoAtiva: true }),
                        titulo({ docCod: '38884', liberado: false }),
                        titulo({ docCod: '38885' }),
                    ],
                }),
            );
            expect(a.titulos[0]?.motivos).toEqual([M.NAO_LIBERADO, M.MARCA_RETENCAO_ATIVA]);
            expect(a.motivos).toEqual([M.NAO_LIBERADO, M.MARCA_RETENCAO_ATIVA]);
        });
    });

    describe('I19d — uma filial', () => {
        it('filiais diferentes ⇒ CRUZA_FILIAL, não confirmável', () => {
            const a = regra.avaliar(
                pedroni({
                    origem: GRUPO_BOLETO_ORIGEM.MANUAL,
                    titulos: [
                        titulo({ docCod: '38883' }),
                        titulo({ docCod: '38884' }),
                        titulo({ docCod: '38885', filCod: 4 }),
                    ],
                }),
            );
            expect(a.confirmavel).toBe(false);
            expect(a.motivo).toBe(M.CRUZA_FILIAL);
        });
    });

    describe('I19g — janela da composição manual (dia civil)', () => {
        const manual = (vencimentos: string[], vencBoleto: string) =>
            regra.avaliar({
                origem: GRUPO_BOLETO_ORIGEM.MANUAL,
                boleto: comBoleto(525 * vencimentos.length, vencBoleto),
                titulos: vencimentos.map((v, i) =>
                    titulo({ docCod: String(1000 + i), vencimento: v }),
                ),
                parVigente: true,
                parConfirmavelNoAto: true,
            });

        it('caso 333111 (títulos 25/10, boleto 26/10) ⇒ aceito com aviso exigido', () => {
            const a = manual(['2026-10-25', '2026-10-25'], '2026-10-26');
            expect(a.confirmavel).toBe(true);
            expect(a.avisos).toEqual([AVISO_GRUPO.TITULO_VENCE_ANTES_DO_BOLETO]);
            expect(a.titulos.map((t) => t.deltaDias)).toEqual([1, 1]);
        });

        it('Δ = 0 em todos ⇒ sem aviso', () => {
            expect(manual(['2026-10-26', '2026-10-26'], '2026-10-26').avisos).toEqual([]);
        });

        it(`Δ = ${JANELA_MANUAL_DIAS_MAX} (limite) ⇒ aceito com aviso`, () => {
            const a = manual(['2026-10-16', '2026-10-26'], '2026-10-26');
            expect(a.confirmavel).toBe(true);
            expect(a.avisos).toEqual([AVISO_GRUPO.TITULO_VENCE_ANTES_DO_BOLETO]);
        });

        it('Δ = 11 ⇒ FORA_DA_JANELA', () => {
            const a = manual(['2026-10-15', '2026-10-26'], '2026-10-26');
            expect(a.confirmavel).toBe(false);
            expect(a.titulos[0]?.motivos).toEqual([M.FORA_DA_JANELA]);
            expect(a.titulos[0]?.deltaDias).toBe(11);
        });

        it('Δ = −1 (título vence depois do boleto) ⇒ FORA_DA_JANELA', () => {
            const a = manual(['2026-10-27', '2026-10-26'], '2026-10-26');
            expect(a.confirmavel).toBe(false);
            expect(a.titulos[0]?.motivos).toEqual([M.FORA_DA_JANELA]);
        });

        it('sugestão aceita só o mesmo vencimento: Δ = 1 ⇒ FORA_DA_JANELA, sem aviso', () => {
            const a = regra.avaliar({
                ...pedroni(),
                boleto: comBoleto(1575, '2026-10-22'),
            });
            expect(a.confirmavel).toBe(false);
            expect(a.titulos.every((t) => t.motivos.includes(M.FORA_DA_JANELA))).toBe(true);
            expect(a.avisos).toEqual([]);
        });

        it('vencimento de título ausente ⇒ DATA_INDISPONIVEL', () => {
            const sem = titulo({ docCod: '38885' });
            delete sem.vencimento;
            const a = regra.avaliar(
                pedroni({
                    titulos: [titulo({ docCod: '38883' }), titulo({ docCod: '38884' }), sem],
                }),
            );
            expect(a.titulos[2]?.motivos).toEqual([M.DATA_INDISPONIVEL]);
        });

        it('janela() no dia civil: datas puras, sem fuso (ADR-0070)', () => {
            expect(regra.janela('2026-10-25', '2026-10-26', GRUPO_BOLETO_ORIGEM.MANUAL)).toEqual({
                deltaDias: 1,
                dentro: true,
                aviso: true,
            });
            // Atravessando o fim do horário de verão/virada de mês: continua 1 dia civil.
            expect(
                regra.janela('2026-10-31', '2026-11-01', GRUPO_BOLETO_ORIGEM.MANUAL).deltaDias,
            ).toBe(1);
        });
    });

    describe('I19h — datas', () => {
        it('vencimentoBoleto < dataDebito ⇒ BOLETO_VENCIDO', () => {
            const a = regra.avaliar(pedroni({ dataDebito: '2026-10-22' }));
            expect(a.confirmavel).toBe(false);
            expect(a.motivosGrupo).toEqual([M.BOLETO_VENCIDO]);
        });

        it('vencimentoBoleto == dataDebito ⇒ ok', () => {
            expect(regra.avaliar(pedroni({ dataDebito: '2026-10-21' })).confirmavel).toBe(true);
        });

        it('sem lote, a referência é o próprio vencimentoBoleto (nunca vencido)', () => {
            expect(regra.avaliar(pedroni()).motivosGrupo).not.toContain(M.BOLETO_VENCIDO);
        });
    });

    describe('reconhecimento do aviso (validado no servidor)', () => {
        it('avisosFaltantes devolve o que a avaliação recalculada exige e o pedido não reconheceu', () => {
            const a = regra.avaliar({
                origem: GRUPO_BOLETO_ORIGEM.MANUAL,
                boleto: comBoleto(1050, '2026-10-26'),
                titulos: [
                    titulo({ docCod: '1', vencimento: '2026-10-25' }),
                    titulo({ docCod: '2', vencimento: '2026-10-26' }),
                ],
                parVigente: true,
                parConfirmavelNoAto: true,
            });
            expect(regra.avisosFaltantes(a, [])).toEqual([
                AVISO_GRUPO.TITULO_VENCE_ANTES_DO_BOLETO,
            ]);
            expect(regra.avisosFaltantes(a, [AVISO_GRUPO.TITULO_VENCE_ANTES_DO_BOLETO])).toEqual(
                [],
            );
        });
    });

    describe('privacidade (I17j)', () => {
        it('a saída carrega só a máscara 5+4, nunca 44/47 dígitos', () => {
            const linha = CodigoBarrasSintetico.linhaDigitavel({
                valor: 1575,
                vencimento: '2026-10-21',
            });
            const base = pedroni();
            for (const codigo of [base.boleto.codigo, linha]) {
                const a = regra.avaliar({ ...base, boleto: { ...base.boleto, codigo } });
                const json = JSON.stringify(a);
                expect(json).not.toMatch(/\d{44}/);
                expect(json).not.toMatch(/\d{20,}/);
                expect(a.codigoMascarado).toMatch(/^\d{5}…\d{4}$/);
            }
        });
    });
});

describe('RegraGrupoBoleto.orfao — I19u', () => {
    const grupo = (over: Partial<GrupoBoleto> = {}): GrupoBoleto => ({
        id: 'g-1',
        filCod: 2,
        pesCod: '9001',
        emissorChave: '341:3456:78901',
        ddcCod: 900,
        ditCod: 332841,
        codbarMascarado: '34191…0123',
        valorBoletoCentavos: 105000,
        vencimentoBoleto: '2026-10-21',
        titulos: [
            {
                filCod: 2,
                docCod: '1',
                titCod: '1',
                valorLiquidoCentavos: 52500,
                vencimento: '2026-10-21',
            },
            {
                filCod: 2,
                docCod: '2',
                titCod: '1',
                valorLiquidoCentavos: 52500,
                vencimento: '2026-10-21',
            },
        ],
        somaTitulosCentavos: 105000,
        origem: GRUPO_BOLETO_ORIGEM.SUGERIDO,
        intercambiavel: false,
        avisosReconhecidos: [],
        estado: GRUPO_BOLETO_ESTADO.CONFIRMADO,
        confirmadoPor: 'ana',
        confirmadoEm: new Date('2026-10-20T12:00:00Z'),
        versao: 1,
        ...over,
    });
    const vivo = (
        over: Partial<{
            pago: boolean;
            ativo: boolean;
            temBoleto: boolean;
            liquidoCentavos: number;
        }> = {},
    ) => ({
        boleto: {},
        titulos: [
            {
                filCod: 2,
                docCod: '1',
                titCod: '1',
                pago: false,
                ativo: true,
                liquidoCentavos: 52500,
            },
            {
                filCod: 2,
                docCod: '2',
                titCod: '1',
                pago: false,
                ativo: true,
                liquidoCentavos: 52500,
                ...over,
            },
        ],
    });

    it('tudo como na confirmação ⇒ não órfão', () => {
        expect(regra.orfao(grupo(), vivo())).toEqual({ orfao: false });
    });

    it('boleto fora do pool ⇒ BOLETO_FORA_DO_POOL', () => {
        const v = vivo();
        expect(regra.orfao(grupo(), { titulos: v.titulos })).toEqual({
            orfao: true,
            motivo: MOTIVO_GRUPO_ORFAO.BOLETO_FORA_DO_POOL,
        });
    });

    it('boleto com vínculo do ERP ⇒ BOLETO_VINCULADO_ERP', () => {
        const v = { ...vivo(), boleto: { filCod: 2, docCod: '9', titCod: '1' } };
        expect(regra.orfao(grupo(), v).motivo).toBe(MOTIVO_GRUPO_ORFAO.BOLETO_VINCULADO_ERP);
    });

    it.each([
        [MOTIVO_GRUPO_ORFAO.TITULO_PAGO, { pago: true }],
        [MOTIVO_GRUPO_ORFAO.TITULO_INATIVO, { ativo: false }],
        [MOTIVO_GRUPO_ORFAO.TITULO_COM_DDA_ERP, { temBoleto: true }],
        [MOTIVO_GRUPO_ORFAO.VALOR_LIQUIDO_DIVERGENTE, { liquidoCentavos: 52501 }],
    ] as const)('%s, com o título apontado', (motivo, over) => {
        expect(regra.orfao(grupo(), vivo(over))).toEqual({
            orfao: true,
            motivo,
            titulo: { filCod: 2, docCod: '2', titCod: '1' },
        });
    });

    it('título que sumiu da carteira ⇒ TITULO_INATIVO', () => {
        const v = vivo();
        expect(regra.orfao(grupo(), { boleto: {}, titulos: [v.titulos[0] as never] })).toEqual({
            orfao: true,
            motivo: MOTIVO_GRUPO_ORFAO.TITULO_INATIVO,
            titulo: { filCod: 2, docCod: '2', titCod: '1' },
        });
    });

    it('líquido não lido não acusa órfão', () => {
        const v = vivo();
        const semLiquido = { ...v.titulos[1] } as Record<string, unknown>;
        delete semLiquido.liquidoCentavos;
        expect(
            regra.orfao(grupo(), {
                boleto: {},
                titulos: [v.titulos[0] as never, semLiquido as never],
            }).orfao,
        ).toBe(false);
    });

    it.each([
        GRUPO_BOLETO_ESTADO.ANULADO,
        GRUPO_BOLETO_ESTADO.PAGO,
    ])('grupo %s nunca é órfão', (estado) => {
        expect(regra.orfao(grupo({ estado }), { titulos: [] }).orfao).toBe(false);
    });
});
