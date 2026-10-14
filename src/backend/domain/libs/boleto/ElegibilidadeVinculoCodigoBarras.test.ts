import 'reflect-metadata';
import { RESULTADO_SUGESTAO } from '../../interface/sispag/SugestaoBoleto.js';
import CodigoBarrasBoleto from './CodigoBarrasBoleto.js';
import CodigoBarrasSintetico from './CodigoBarrasSintetico.js';
import ElegibilidadeVinculoCodigoBarras, {
    type EntradaElegibilidadeVinculo,
    MOTIVO_INELEGIVEL_VINCULO,
} from './ElegibilidadeVinculoCodigoBarras.js';

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
    totalAberto: 1028.8,
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
            const r = regra.avaliar(base({ totalAberto: 1000 }));
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
            const { totalAberto: _t, ...semAberto } = base();
            const r = regra.avaliar(semAberto);
            expect(r.elegivel).toBe(false);
            expect(r.motivo).toBe(MOTIVO_INELEGIVEL_VINCULO.VALOR_ABERTO_INDISPONIVEL);
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
