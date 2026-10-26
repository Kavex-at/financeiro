import 'reflect-metadata';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { RESULTADO_SUGESTAO } from '../../interface/sispag/SugestaoBoleto.js';
import RegraSugestaoBoleto from '../../service/sispag/RegraSugestaoBoleto.js';
import CodigoBarrasBoleto from './CodigoBarrasBoleto.js';
import CodigoBarrasSintetico from './CodigoBarrasSintetico.js';
import ElegibilidadeVinculoCodigoBarras, {
    type EntradaElegibilidadeItemDeBordero,
    type EntradaElegibilidadeVinculo,
    MOTIVO_INELEGIVEL_VINCULO,
} from './ElegibilidadeVinculoCodigoBarras.js';
import ValorAbertoLiquido from './ValorAbertoLiquido.js';

const regra = new ElegibilidadeVinculoCodigoBarras(new CodigoBarrasBoleto());

const VENC_TITULO = '2026-10-20';
const DATA_DEBITO = '2026-10-20';

const base = (
    sobrescreve: Partial<EntradaElegibilidadeVinculo> = {},
    boleto: { valor?: number; vencimento?: string; serie?: number } = {},
): EntradaElegibilidadeVinculo => ({
    modalidade: 'BOLETO',
    temBoletoDda: false,
    noRascunho: true,
    decisao: { id: 'dec-1', decisao: 'CONFIRMADA', orfa: false, parVigente: true },
    codigo: CodigoBarrasSintetico.linhaDigitavel({
        valor: boleto.valor ?? 1028.8,
        vencimento: boleto.vencimento ?? VENC_TITULO,
        serie: boleto.serie ?? 1,
    }),
    tier: RESULTADO_SUGESTAO.CONHECIDO,
    aberto: ValorAbertoLiquido.semAcrescimos(1028.8),
    vencimentoTitulo: VENC_TITULO,
    dataDebito: DATA_DEBITO,
    ...sobrescreve,
});

const dia = (base: string, delta: number): string =>
    new Date(Date.parse(`${base}T00:00:00Z`) + delta * 86_400_000).toISOString().slice(0, 10);

describe('ElegibilidadeVinculoCodigoBarras (I17a–d, só locais)', () => {
    it('valor igual e mesmo dia: elegível, com a máscara 5+4 e sem o código', () => {
        const r = regra.avaliar(base());
        expect(r.elegivel).toBe(true);
        expect(r.deltaCentavos).toBe(0);
        expect(r.deltaDias).toBe(0);
        expect(r.decisaoId).toBe('dec-1');
        expect(r.codigoMascarado).toMatch(/^\d{5}…\d{4}$/);
        const json = JSON.stringify(r);
        expect(json).not.toMatch(/\d{20,}/);
    });

    describe('I17b — valor em centavos contra o aberto AO VIVO', () => {
        it.each([
            [0.01, 'acima'],
            [-0.01, 'abaixo'],
        ])('diferença de %s centavo(s) (%s) é inelegível, com delta com sinal', (d) => {
            const r = regra.avaliar(base({}, { valor: 1028.8 + d }));
            expect(r.elegivel).toBe(false);
            expect(r.motivo).toBe(MOTIVO_INELEGIVEL_VINCULO.VALOR_DIFERENTE);
            expect(r.deltaCentavos).toBe(Math.round(d * 100));
        });

        it('compara com o `totalAberto` recebido, nunca com o snapshot do item', () => {
            // O aberto ao vivo mudou (pagamento parcial): o boleto de 1028,80 deixa de bater.
            const r = regra.avaliar(base({ aberto: ValorAbertoLiquido.semAcrescimos(1000) }));
            expect(r.elegivel).toBe(false);
            expect(r.motivo).toBe(MOTIVO_INELEGIVEL_VINCULO.VALOR_DIFERENTE);
            expect(r.deltaCentavos).toBe(2880);
        });

        it('o snapshot do item (`valorItem`) não muda o resultado', () => {
            const a = regra.avaliar(base({ valorItem: 5 }));
            const b = regra.avaliar(base({ valorItem: 999_999 }));
            expect(a).toEqual(b);
            expect(a.elegivel).toBe(true);
        });

        it('sem `totalAberto` ao vivo não há comparação: inelegível (fail-closed)', () => {
            const { aberto: _t, ...semAberto } = base();
            const r = regra.avaliar(semAberto);
            expect(r.elegivel).toBe(false);
            expect(r.motivo).toBe(MOTIVO_INELEGIVEL_VINCULO.VALOR_ABERTO_INDISPONIVEL);
        });
    });

    describe('I17b emendada (ADR-0074) — régua LÍQUIDA', () => {
        // HML 536/2: base 53,53 + juros 0,01 (renegociação fin070, frnVldTpop 1) ⇒ líquido 53,54.
        const hml5362 = {
            totalLiquido: 53.54,
            totalPago: 0,
            totalAberto: 53.53,
            titMnyJuros: 0.01,
            titMnyDesconto: 0,
        };

        it('barra 53,54 × líquido 53,54 ⇒ elegível', () => {
            const r = regra.avaliar(base({ aberto: hml5362 }, { valor: 53.54 }));
            expect(r.elegivel).toBe(true);
            expect(r.deltaCentavos).toBe(0);
        });

        it('barra 53,53 × líquido 53,54 ⇒ VALOR_DIFERENTE com Δ −1', () => {
            const r = regra.avaliar(base({ aberto: hml5362 }, { valor: 53.53 }));
            expect(r.elegivel).toBe(false);
            expect(r.motivo).toBe(MOTIVO_INELEGIVEL_VINCULO.VALOR_DIFERENTE);
            expect(r.deltaCentavos).toBe(-1);
        });

        it('as duas fórmulas divergem ⇒ VALOR_ABERTO_INDISPONIVEL (fail-closed)', () => {
            const r = regra.avaliar(
                base({ aberto: { ...hml5362, titMnyJuros: 0 } }, { valor: 53.54 }),
            );
            expect(r.elegivel).toBe(false);
            expect(r.motivo).toBe(MOTIVO_INELEGIVEL_VINCULO.VALOR_ABERTO_INDISPONIVEL);
        });

        it('totalPago ausente não entra na régua (o líquido do fin064 já desconta o pago)', () => {
            const { totalPago: _p, ...sem } = hml5362;
            expect(regra.avaliar(base({ aberto: sem }, { valor: 53.54 })).elegivel).toBe(true);
        });

        it.each([
            'totalLiquido',
            'titMnyJuros',
            'titMnyDesconto',
        ] as const)('campo %s ausente ⇒ VALOR_ABERTO_INDISPONIVEL', (campo) => {
            const { [campo]: _x, ...sem } = hml5362;
            const r = regra.avaliar(base({ aberto: sem }, { valor: 53.54 }));
            expect(r.motivo).toBe(MOTIVO_INELEGIVEL_VINCULO.VALOR_ABERTO_INDISPONIVEL);
        });

        it('a elegibilidade calcula o Δ pela MESMA função da régua (ValorAbertoLiquido)', () => {
            const spy = jest.spyOn(ValorAbertoLiquido, 'calcularCentavos');
            regra.avaliar(base({ aberto: hml5362 }, { valor: 53.54 }));
            expect(spy).toHaveBeenCalledWith(hml5362);
            spy.mockRestore();
        });
    });

    describe('I17c — data', () => {
        it.each([
            [-1, false, MOTIVO_INELEGIVEL_VINCULO.DATA_ANTES_DO_TITULO],
            [0, true, undefined],
            [5, true, undefined],
            [6, false, MOTIVO_INELEGIVEL_VINCULO.DATA_FORA_DA_JANELA],
        ])('Δdias = %i ⇒ elegível=%s', (delta, elegivel, motivo) => {
            const r = regra.avaliar(
                base(
                    // O tier é recalculado por fora; aqui um tier "bom" não pode resgatar a data.
                    { dataDebito: dia(VENC_TITULO, -10) },
                    { vencimento: dia(VENC_TITULO, delta) },
                ),
            );
            expect(r.elegivel).toBe(elegivel);
            expect(r.motivo).toBe(motivo);
            expect(r.deltaDias).toBe(delta);
        });

        it('barra = data de débito é elegível; um dia antes é inelegível', () => {
            const igual = regra.avaliar(
                base({ dataDebito: dia(VENC_TITULO, 2) }, { vencimento: dia(VENC_TITULO, 2) }),
            );
            expect(igual.elegivel).toBe(true);
            const antes = regra.avaliar(
                base({ dataDebito: dia(VENC_TITULO, 3) }, { vencimento: dia(VENC_TITULO, 2) }),
            );
            expect(antes.elegivel).toBe(false);
            expect(antes.motivo).toBe(MOTIVO_INELEGIVEL_VINCULO.BARRA_VENCIDA);
        });

        it('data civil: o título em UTC meia-noite não desloca o dia (São Paulo)', () => {
            // Quem converte `epoch → civil` entrega a string `YYYY-MM-DD`; o fator do boleto é
            // civil. Um dia de diferença aqui seria Δ = 1 fabricado.
            const r = regra.avaliar(base({ vencimentoTitulo: '2026-10-20' }));
            expect(r.deltaDias).toBe(0);
        });
    });

    describe('I17a — decisão', () => {
        it.each([
            ['ausente', undefined, MOTIVO_INELEGIVEL_VINCULO.SEM_DECISAO],
            [
                'REJEITADA',
                { id: 'd', decisao: 'REJEITADA', orfa: false, parVigente: true },
                MOTIVO_INELEGIVEL_VINCULO.DECISAO_NAO_CONFIRMADA,
            ],
            [
                'ANULADA',
                { id: 'd', decisao: 'ANULADA', orfa: false, parVigente: true },
                MOTIVO_INELEGIVEL_VINCULO.DECISAO_NAO_CONFIRMADA,
            ],
            [
                'órfã',
                { id: 'd', decisao: 'CONFIRMADA', orfa: true, parVigente: true },
                MOTIVO_INELEGIVEL_VINCULO.DECISAO_ORFA,
            ],
            [
                'par revogado',
                { id: 'd', decisao: 'CONFIRMADA', orfa: false, parVigente: false },
                MOTIVO_INELEGIVEL_VINCULO.PAR_NAO_VIGENTE,
            ],
        ] as const)('%s ⇒ inelegível com motivo próprio', (_n, decisao, motivo) => {
            const r = regra.avaliar(base({ decisao: decisao as never }));
            expect(r.elegivel).toBe(false);
            expect(r.motivo).toBe(motivo);
        });
    });

    describe('I15d — tier recalculado agora', () => {
        it.each([
            RESULTADO_SUGESTAO.CONHECIDO,
            RESULTADO_SUGESTAO.FORTE,
        ])('%s é elegível', (tier) => {
            expect(regra.avaliar(base({ tier })).elegivel).toBe(true);
        });
        it.each([
            RESULTADO_SUGESTAO.ATENCAO,
            RESULTADO_SUGESTAO.VENCIDO_INFORMATIVO,
            RESULTADO_SUGESTAO.SEM_RELACAO,
        ])('%s nunca vincula', (tier) => {
            const r = regra.avaliar(base({ tier }));
            expect(r.elegivel).toBe(false);
            expect(r.motivo).toBe(MOTIVO_INELEGIVEL_VINCULO.TIER_INSUFICIENTE);
        });
    });

    describe('I17d(1,2) — o código', () => {
        it('aceita 44 dígitos e 47 dígitos', () => {
            const barras = CodigoBarrasSintetico.barras({
                valor: 1028.8,
                vencimento: VENC_TITULO,
                serie: 2,
            });
            expect(regra.avaliar(base({ codigo: barras })).elegivel).toBe(true);
        });

        it('DV geral corrompido é inelegível', () => {
            const ruim = CodigoBarrasSintetico.corrompido(
                CodigoBarrasSintetico.barras({ valor: 1028.8, vencimento: VENC_TITULO }),
            );
            const r = regra.avaliar(base({ codigo: ruim }));
            expect(r.elegivel).toBe(false);
            expect(r.motivo).toBe(MOTIVO_INELEGIVEL_VINCULO.CODIGO_INVALIDO);
        });

        it('DV de campo da linha digitável corrompido é inelegível', () => {
            const linha = CodigoBarrasSintetico.linhaDigitavel({
                valor: 1028.8,
                vencimento: VENC_TITULO,
            });
            const ruim = `${linha.slice(0, 9)}${(Number(linha[9]) + 1) % 10}${linha.slice(10)}`;
            const r = regra.avaliar(base({ codigo: ruim }));
            expect(r.elegivel).toBe(false);
            expect(r.motivo).toBe(MOTIVO_INELEGIVEL_VINCULO.CODIGO_INVALIDO);
        });

        it('arrecadação (inicia por 8) é inelegível', () => {
            const r = regra.avaliar(
                base({ codigo: '84670000001435900240200240500024384221010811' }),
            );
            expect(r.elegivel).toBe(false);
            expect(r.motivo).toBe(MOTIVO_INELEGIVEL_VINCULO.CODIGO_ARRECADACAO);
        });

        it('comprimento errado e ausência são inelegíveis', () => {
            expect(regra.avaliar(base({ codigo: '123' })).motivo).toBe(
                MOTIVO_INELEGIVEL_VINCULO.CODIGO_INVALIDO,
            );
            const { codigo: _c, ...sem } = base();
            expect(regra.avaliar(sem).motivo).toBe(MOTIVO_INELEGIVEL_VINCULO.BOLETO_INDISPONIVEL);
        });

        it('valor/vencimento do pool que contradizem o código tornam o boleto inconsistente', () => {
            const r = regra.avaliar(base({ poolValor: 1.0, poolVencimento: VENC_TITULO }));
            expect(r.elegivel).toBe(false);
            expect(r.motivo).toBe(MOTIVO_INELEGIVEL_VINCULO.BOLETO_INCONSISTENTE);
        });
    });

    describe('I17d(7) — fator de vencimento × data do DDA (ADR-0078)', () => {
        it('fator que decodifica para data diferente do DDA é inelegível, também na janela padrão', () => {
            // Barra com fator de VENC_TITULO; o DDA diz 3 dias depois: o par é contraditório.
            const r = regra.avaliar(base({ poolVencimento: dia(VENC_TITULO, 3) }));
            expect(r.elegivel).toBe(false);
            expect(r.motivo).toBe(MOTIVO_INELEGIVEL_VINCULO.FATOR_VENCIMENTO_DIVERGE);
            expect(r.codigoMascarado).toMatch(/^\d{5}…\d{4}$/);
            expect(JSON.stringify(r)).not.toMatch(/\d{20,}/);
        });

        it('fator igual à data do DDA segue elegível', () => {
            const r = regra.avaliar(base({ poolVencimento: VENC_TITULO }));
            expect(r.elegivel).toBe(true);
        });

        it('a referência do ciclo é a data do DDA, não a do título', () => {
            // Título com data muito distante da barra: o ciclo vem do DDA e o par bate.
            const barra = dia(VENC_TITULO, 3);
            const r = regra.avaliar(base({ poolVencimento: barra }, { vencimento: barra }));
            expect(r.elegivel).toBe(true);
            expect(r.deltaDias).toBe(3);
        });

        it('fator 0000: a janela padrão não muda (DATA_INDISPONIVEL como hoje)', () => {
            const semFator = CodigoBarrasSintetico.linhaDigitavel({
                valor: 1028.8,
                vencimento: VENC_TITULO,
                serie: 1,
                fator: 0,
            });
            const r = regra.avaliar(base({ codigo: semFator, poolVencimento: VENC_TITULO }));
            expect(r.elegivel).toBe(false);
            expect(r.motivo).toBe(MOTIVO_INELEGIVEL_VINCULO.DATA_INDISPONIVEL);
        });
    });

    describe('escopo do item', () => {
        it('item que o ERP associou ao DDA fica no caminho DDA', () => {
            const r = regra.avaliar(base({ temBoletoDda: true }));
            expect(r.elegivel).toBe(false);
            expect(r.motivo).toBe(MOTIVO_INELEGIVEL_VINCULO.DDA_ASSOCIADO_PELO_ERP);
        });

        it('modalidade diferente de BOLETO não entra', () => {
            const r = regra.avaliar(base({ modalidade: 'TED' }));
            expect(r.elegivel).toBe(false);
            expect(r.motivo).toBe(MOTIVO_INELEGIVEL_VINCULO.MODALIDADE_NAO_BOLETO);
        });

        it('fora do rascunho não entra (I17i)', () => {
            const r = regra.avaliar(base({ noRascunho: false }));
            expect(r.elegivel).toBe(false);
            expect(r.motivo).toBe(MOTIVO_INELEGIVEL_VINCULO.FORA_DO_RASCUNHO);
        });
    });

    it('a saída nunca carrega 44 dígitos nem a linha de 47, nem inelegível', () => {
        const casos = [
            regra.avaliar(base()),
            regra.avaliar(base({}, { valor: 1 })),
            regra.avaliar(base({}, { vencimento: dia(VENC_TITULO, 9) })),
        ];
        for (const r of casos) {
            expect(JSON.stringify(r)).not.toMatch(/\d{20,}/);
        }
    });
});

/**
 * NÃO-REGRESSÃO do passo 2 (ADR-0072, I17a/I17c): a mudança de exibição da sugestão não pode mexer
 * em QUEM é vinculável. Golden gravado do commit base (`6bc4e89`, regra antes do aviso
 * `VENCE_ANTES_DO_TITULO`): 600 combinações de Δvalor × Δdias × data de débito × par vigente.
 */
describe('não-regressão do passo 2 (ADR-0072)', () => {
    const DELTAS_VALOR = [-12, -10, -0.06, -0.05, 0, 0.05, 0.06, 5, 10, 10.01];
    const DELTAS_DIAS = [-11, -10, -8, -1, 0, 1, 5, 6, 10, 11];
    const OFFSETS_DEBITO = [-3, 0, 2];
    const PARES = [false, true];
    const LETRA: Record<string, string> = {
        CONHECIDO: 'C',
        FORTE: 'F',
        ATENCAO: 'A',
        VENCIDO_INFORMATIVO: 'V',
        SEM_RELACAO: 'S',
    };
    const GOLDEN_TIERS = [
        'SSSSSSVVVVVVVVVVVVAAVVVVAAAAVVAAAAVVAAAAAAAAAAAAAAAAAASSSSSSSSSSSSVVVVVVVVVVVVAAVVVVAAAAVVAAAAVVAAAA',
        'AAAAAAAAAAAAAASSSSSSSSSSSSVVVVVVVVVVVVAAVVVVAAAAVVAAAAVVAAAAAAAAAAAAAAAAAASSSSSSSSSSSSVVVVVVVVVVVVAA',
        'VVVVFCFCVVAAAAVVAAAAAAAAAAAAAAAAAASSSSSSSSSSSSVVVVVVVVVVVVAAVVVVFCFCVVFCFCVVFCFCFCAAAAAAAAAAAASSSSSS',
        'SSSSSSVVVVVVVVVVVVAAVVVVFCFCVVAAAAVVAAAAAAAAAAAAAAAAAASSSSSSSSSSSSVVVVVVVVVVVVAAVVVVAAAAVVAAAAVVAAAA',
        'AAAAAAAAAAAAAASSSSSSSSSSSSVVVVVVVVVVVVAAVVVVAAAAVVAAAAVVAAAAAAAAAAAAAAAAAASSSSSSSSSSSSVVVVVVVVVVVVAA',
        'VVVVAAAAVVAAAAVVAAAAAAAAAAAAAAAAAASSSSSSSSSSSSVVVVVVVVVVVVAAVVVVAAAAVVAAAAVVAAAAAAAAAAAAAAAAAASSSSSS',
    ].join('');
    const GOLDEN_VINCULAVEIS = [
        'NNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNN',
        'NNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNN',
        'NNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNEEEENNEEEENNEEEEEENNNNNNNNNNNNNNNNNN',
        'NNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNN',
        'NNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNN',
        'NNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNN',
    ].join('');

    const VALOR = 1028.8;
    const regraSugestao = new RegraSugestaoBoleto();

    const combinacoes = DELTAS_VALOR.flatMap((dv) =>
        DELTAS_DIAS.flatMap((dd) =>
            OFFSETS_DEBITO.flatMap((off) => PARES.map((par) => ({ dv, dd, off, par }))),
        ),
    );

    const grade = () => {
        const linhas = combinacoes.map(({ dv, dd, off, par }) => {
            const valorBoleto = Math.round((VALOR + dv) * 100) / 100;
            const vencBoleto = dia(VENC_TITULO, dd);
            const dataDebito = dia(VENC_TITULO, off);
            const tier = regraSugestao.avaliar({
                titulo: { valor: VALOR, vencimento: VENC_TITULO },
                boleto: { valor: valorBoleto, vencimento: vencBoleto },
                dataDebito,
                parConfirmado: par,
            }).resultado;
            const r = regra.avaliar(
                base(
                    { tier, aberto: ValorAbertoLiquido.semAcrescimos(VALOR), dataDebito },
                    { valor: valorBoleto, vencimento: vencBoleto },
                ),
            );
            return { letra: LETRA[tier] ?? '?', vinculavel: r.elegivel ? 'E' : 'N' };
        });
        return {
            tiers: linhas.map((l) => l.letra).join(''),
            vinculaveis: linhas.map((l) => l.vinculavel).join(''),
        };
    };

    it('o tier e o conjunto vinculável são idênticos ao do commit base', () => {
        const { tiers, vinculaveis } = grade();
        expect(tiers).toHaveLength(600);
        expect(tiers).toBe(GOLDEN_TIERS);
        expect(vinculaveis).toBe(GOLDEN_VINCULAVEIS);
        expect(vinculaveis.split('E').length - 1).toBe(14);
    });

    it('Δdias < 0 segue INELEGIVEL com o motivo DATA_ANTES_DO_TITULO (o código do motivo não muda)', () => {
        const r = regra.avaliar(base({}, { vencimento: dia(VENC_TITULO, -1) }));
        expect(r.elegivel).toBe(false);
        expect(r.motivo).toBe('DATA_ANTES_DO_TITULO');
        expect(MOTIVO_INELEGIVEL_VINCULO.DATA_ANTES_DO_TITULO).toBe('DATA_ANTES_DO_TITULO');
    });

    it('situação, âncora e reconhecimento NÃO entram: o resultado é o mesmo com ou sem eles', () => {
        const sem = regra.avaliar(base());
        const com = regra.avaliar({
            ...base(),
            situacao: 'SO_FRACA',
            ancorado: false,
            sinais: ['VENCE_ANTES_DO_TITULO', 'RECONHECEU_VENCE_ANTES'],
            reconheceAvisos: ['VENCE_ANTES_DO_TITULO'],
        } as unknown as EntradaElegibilidadeVinculo);
        expect(com).toEqual(sem);
    });

    it('o fonte da elegibilidade não lê situação, âncora, sinais de aviso nem o motor', () => {
        const fonte = readFileSync(
            path.join(__dirname, 'ElegibilidadeVinculoCodigoBarras.ts'),
            'utf8',
        )
            .replace(/\/\*[\s\S]*?\*\//g, '')
            .split('\n')
            .map((l) => l.replace(/(^|\s)\/\/.*$/, ''))
            .join('\n');
        expect(fonte).not.toMatch(
            /SITUACAO_SUGESTAO|situacao|ancorad|VENCE_ANTES|RECONHECEU|MotorSugestaoBoleto|reconheceAvisos/,
        );
    });
});

describe('ElegibilidadeVinculoCodigoBarras.avaliarItemDeBordero (I21o, I17o)', () => {
    const VENC_BOLETO = '2026-10-21';
    const DEBITO = '2026-10-21';
    const itemBase = (
        sobrescreve: Partial<EntradaElegibilidadeItemDeBordero> = {},
        boleto: { valor?: number; vencimento?: string; serie?: number } = {},
    ): EntradaElegibilidadeItemDeBordero => ({
        noRascunho: true,
        grupo: {
            estado: 'CONFIRMADO',
            orfao: false,
            parVigente: true,
            valorBoletoCentavos: 157_500,
            vencimentoBoleto: VENC_BOLETO,
        },
        codigo: CodigoBarrasSintetico.linhaDigitavel({
            valor: boleto.valor ?? 1575,
            vencimento: boleto.vencimento ?? VENC_BOLETO,
            serie: boleto.serie ?? 1,
        }),
        itsMnyValorCentavos: 157_500,
        dataDebito: DEBITO,
        ...sobrescreve,
    });

    it('grupo confirmado, boleto do pool, valor da barra == boleto == item do borderô: elegível, sem tier e sem decisão por título', () => {
        const r = regra.avaliarItemDeBordero(itemBase());
        expect(r.elegivel).toBe(true);
        expect(r.deltaCentavos).toBe(0);
        expect(r.codigoMascarado).toMatch(/^\d{5}…\d{4}$/);
        expect(r.banco).toMatch(/^\d{3}$/);
        expect(JSON.stringify(r)).not.toMatch(/\d{20,}/);
    });

    it.each([
        [
            'grupo anulado',
            { grupo: { estado: 'ANULADO' } },
            MOTIVO_INELEGIVEL_VINCULO.GRUPO_NAO_CONFIRMADO,
        ],
        ['grupo órfão', { grupo: { orfao: true } }, MOTIVO_INELEGIVEL_VINCULO.GRUPO_ORFAO],
        [
            'par do emissor não vigente',
            { grupo: { parVigente: false } },
            MOTIVO_INELEGIVEL_VINCULO.PAR_NAO_VIGENTE,
        ],
        [
            'item fora do rascunho',
            { noRascunho: false },
            MOTIVO_INELEGIVEL_VINCULO.FORA_DO_RASCUNHO,
        ],
    ])('%s ⇒ inelegível', (_nome, over, motivo) => {
        const base = itemBase();
        const entrada = {
            ...base,
            ...over,
            grupo: { ...base.grupo, ...('grupo' in over ? over.grupo : {}) },
        } as EntradaElegibilidadeItemDeBordero;
        const r = regra.avaliarItemDeBordero(entrada);
        expect(r.elegivel).toBe(false);
        expect(r.motivo).toBe(motivo);
    });

    it('código ausente, inválido ou de arrecadação ⇒ motivo próprio', () => {
        expect(regra.avaliarItemDeBordero(itemBase({ codigo: undefined })).motivo).toBe(
            MOTIVO_INELEGIVEL_VINCULO.BOLETO_INDISPONIVEL,
        );
        expect(regra.avaliarItemDeBordero(itemBase({ codigo: '123' })).motivo).toBe(
            MOTIVO_INELEGIVEL_VINCULO.CODIGO_INVALIDO,
        );
        expect(regra.avaliarItemDeBordero(itemBase({ codigo: `8${'0'.repeat(46)}` })).motivo).toBe(
            MOTIVO_INELEGIVEL_VINCULO.CODIGO_ARRECADACAO,
        );
    });

    it('I21b: valor da barra ≠ valor do boleto do grupo (±1 centavo) ⇒ VALOR_DIFERENTE com delta', () => {
        const r = regra.avaliarItemDeBordero(itemBase({}, { valor: 1575.01 }));
        expect(r.elegivel).toBe(false);
        expect(r.motivo).toBe(MOTIVO_INELEGIVEL_VINCULO.VALOR_DIFERENTE);
        expect(r.deltaCentavos).toBe(1);
    });

    it('valor da barra ≠ itsMnyValor do item do borderô (vem do borderô, H6) ⇒ VALOR_DIFERENTE', () => {
        const r = regra.avaliarItemDeBordero(itemBase({ itsMnyValorCentavos: 157_400 }));
        expect(r.elegivel).toBe(false);
        expect(r.motivo).toBe(MOTIVO_INELEGIVEL_VINCULO.VALOR_DIFERENTE);
        expect(r.deltaCentavos).toBe(100);
    });

    it('item do borderô sem valor legível ⇒ fail-closed (VALOR_ABERTO_INDISPONIVEL), nunca "elegível"', () => {
        const r = regra.avaliarItemDeBordero(itemBase({ itsMnyValorCentavos: undefined }));
        expect(r.elegivel).toBe(false);
        expect(r.motivo).toBe(MOTIVO_INELEGIVEL_VINCULO.VALOR_ABERTO_INDISPONIVEL);
    });

    it('I21h: barra que vence antes da data de débito ⇒ BARRA_VENCIDA', () => {
        const r = regra.avaliarItemDeBordero(
            itemBase({
                dataDebito: '2026-10-22',
            }),
        );
        expect(r.elegivel).toBe(false);
        expect(r.motivo).toBe(MOTIVO_INELEGIVEL_VINCULO.BARRA_VENCIDA);
    });

    it('barra com vencimento diferente do boleto do grupo ⇒ BOLETO_INCONSISTENTE', () => {
        const r = regra.avaliarItemDeBordero(itemBase({}, { vencimento: '2026-10-23' }));
        expect(r.elegivel).toBe(false);
        expect(r.motivo).toBe(MOTIVO_INELEGIVEL_VINCULO.BOLETO_INCONSISTENTE);
    });

    it('valor ou data do pool divergindo do que a barra decodifica ⇒ BOLETO_INCONSISTENTE', () => {
        expect(regra.avaliarItemDeBordero(itemBase({ poolValor: 1500 })).motivo).toBe(
            MOTIVO_INELEGIVEL_VINCULO.BOLETO_INCONSISTENTE,
        );
        expect(regra.avaliarItemDeBordero(itemBase({ poolVencimento: '2026-10-30' })).motivo).toBe(
            MOTIVO_INELEGIVEL_VINCULO.BOLETO_INCONSISTENTE,
        );
    });

    it('a I17n não se aplica: a entrada não aceita nem lê o líquido do título (titMnyLiquido)', () => {
        const fonte = readFileSync(
            path.join(__dirname, 'ElegibilidadeVinculoCodigoBarras.ts'),
            'utf8',
        );
        const trecho = fonte.slice(fonte.indexOf('avaliarItemDeBordero'));
        expect(trecho).not.toMatch(/titMnyLiquido|ValorAbertoLiquido|aberto\b/);
    });
});
