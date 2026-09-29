import 'reflect-metadata';
import type {
    EntradaItemDecisao,
    EventoRetornoItem,
} from '../../interface/sispag/SincronizacaoLote.js';
import type {
    ItemLote,
    LeituraBaixas,
    LeituraTitulo,
    LotePagamentoStatus,
} from '../../interface/sispag/SispagInterface.js';
import DecisaoStatusLote from './DecisaoStatusLote.js';

/**
 * Tabela de verdade de I11 (ADR-0055) — a função PURA que L9/L10/L11 compartilham.
 * Canônico da regra `sincronizacao-status-lote-sispag`.
 */

const AGORA = new Date('2026-09-29T14:35:00.000Z');
const ANTES = '2026-09-28T14:35:00.000Z';

const item = (over: Partial<ItemLote> = {}): ItemLote => ({
    loteId: 'L1',
    filCod: 2,
    docCod: '38682',
    titCod: '1',
    incluidoPor: 'u1',
    divergencia: false,
    ...over,
});

const pago: LeituraTitulo = { legivel: true, vldPago: true, aberto: 0, valorPagoTitulo: 275 };
const aberto: LeituraTitulo = { legivel: true, vldPago: false, aberto: 275 };
const pagoComSaldo: LeituraTitulo = { legivel: true, vldPago: true, aberto: 10 };
const ilegivel: LeituraTitulo = { legivel: false, motivo: 'timeout' };

const bd: EventoRetornoItem = {
    eventoCod: 'BD',
    descricao: 'PAGAMENTO AGENDADO',
    rejeitado: false,
};
const efetuado: EventoRetornoItem = {
    eventoCod: '00',
    descricao: 'PAGAMENTO EFETUADO',
    rejeitado: false,
};
const rejeicao: EventoRetornoItem = {
    eventoCod: 'AE',
    descricao: 'DATA INVALIDA',
    rejeitado: true,
};
const outro: EventoRetornoItem = { eventoCod: 'ZZ', descricao: 'OUTRO', rejeitado: false };

const baixas22320: LeituraBaixas = {
    legivel: true,
    baixas: [
        {
            borCod: 22320,
            bxaCodSeq: 1,
            data: '2026-09-24T15:00:00.000Z',
            usuario: 'ERICA_VIANA',
            valor: 275,
        },
    ],
};
const baixas403: LeituraBaixas = { legivel: false, motivo: 'forbidden', status: 403 };

const entrada = (over: Partial<EntradaItemDecisao> = {}): EntradaItemDecisao => ({
    atual: item(),
    titulo: aberto,
    eventos: [],
    ...over,
});

const decidir = (itens: EntradaItemDecisao[], status: LotePagamentoStatus = 'REMESSA_GERADA') =>
    new DecisaoStatusLote().decidir({ loteId: 'L1', status, itens, agora: AGORA });

describe('DecisaoStatusLote — situação do item (I11d)', () => {
    it('REJEITADO vence PAGO: rejeição lida com título pago continua REJEITADO', () => {
        const r = decidir([entrada({ titulo: pago, eventos: [rejeicao] })]);
        expect(r.itens[0]?.situacao).toBe('REJEITADO');
    });

    it('PAGO exige vldPago=1 E aberto=0 — pago com saldo em aberto não é PAGO', () => {
        expect(decidir([entrada({ titulo: pago })]).itens[0]?.situacao).toBe('PAGO');
        expect(decidir([entrada({ titulo: pagoComSaldo })]).itens[0]?.situacao).toBe('SEM_RETORNO');
        expect(decidir([entrada({ titulo: pagoComSaldo, eventos: [bd] })]).itens[0]?.situacao).toBe(
            'AGENDADO',
        );
    });

    it('BD ou 00 sem baixa no título → AGENDADO (00 não é PAGO)', () => {
        expect(decidir([entrada({ eventos: [bd] })]).itens[0]?.situacao).toBe('AGENDADO');
        expect(decidir([entrada({ eventos: [efetuado] })]).itens[0]?.situacao).toBe('AGENDADO');
    });

    it('nada lido → SEM_RETORNO; evento "outro" também', () => {
        expect(decidir([entrada()]).itens[0]?.situacao).toBe('SEM_RETORNO');
        expect(decidir([entrada({ eventos: [outro] })]).itens[0]?.situacao).toBe('SEM_RETORNO');
    });

    it.each([
        ['rejeição por último', [bd, efetuado, rejeicao]],
        ['rejeição primeiro', [rejeicao, efetuado, bd]],
    ])('precedência REJEITADO > 00 > BD independe da ordem de leitura (%s)', (_n, eventos) => {
        const [i] = decidir([entrada({ eventos })]).itens;
        expect(i?.retornoEvento).toBe('AE');
        expect(i?.rejeitado).toBe(true);
        expect(i?.situacao).toBe('REJEITADO');
    });

    it.each([
        ['00 depois de BD', [bd, efetuado]],
        ['00 antes de BD', [efetuado, bd]],
    ])('sem rejeição, 00 vence BD (%s)', (_n, eventos) => {
        const [i] = decidir([entrada({ eventos })]).itens;
        expect(i?.retornoEvento).toBe('00');
        expect(i?.rejeitado).toBe(false);
    });

    it('rejeição já registrada numa passada anterior não some quando o fin052 não é relido', () => {
        const atual = item({ situacao: 'REJEITADO', rejeitado: true, retornoEvento: 'AE' });
        const [i] = decidir([entrada({ atual, eventos: [] })]).itens;
        expect(i?.situacao).toBe('REJEITADO');
        expect(i?.rejeitado).toBe(true);
    });
});

describe('DecisaoStatusLote — fechamento do lote (I11e)', () => {
    it('algum REJEITADO → RETORNADO + alerta sispag-lote-retornado (T5)', () => {
        const r = decidir([
            entrada({ eventos: [rejeicao] }),
            entrada({ atual: item({ docCod: '4030', titCod: '7' }), titulo: pago }),
        ]);
        expect(r.destino).toBe('RETORNADO');
        expect(r.alertas).toEqual([
            expect.objectContaining({ tipo: 'sispag-lote-retornado', alvo: 'L1' }),
        ]);
    });

    it('todos PAGO → BAIXADO', () => {
        const r = decidir([
            entrada({ titulo: pago }),
            entrada({ atual: item({ docCod: '4030', titCod: '7' }), titulo: pago }),
        ]);
        expect(r.destino).toBe('BAIXADO');
        expect(r.alertas).toEqual([]);
    });

    it('qualquer outra combinação → permanece', () => {
        const r = decidir([
            entrada({ titulo: pago }),
            entrada({ atual: item({ docCod: '4030', titCod: '7' }), eventos: [bd] }),
        ]);
        expect(r.destino).toBeUndefined();
    });

    it('lote já RETORNADO com rejeição → permanece (sem novo alerta)', () => {
        const atual = item({ situacao: 'REJEITADO', rejeitado: true, retornoEvento: 'AE' });
        const r = decidir([entrada({ atual, eventos: [rejeicao] })], 'RETORNADO');
        expect(r.destino).toBeUndefined();
        expect(r.alertas).toEqual([]);
    });

    it('lote vazio não transiciona', () => {
        expect(decidir([]).destino).toBeUndefined();
    });
});

describe('DecisaoStatusLote — falha de leitura não decide (I11c)', () => {
    it('fin064 ilegível: item mantém a situação anterior e o lote não transiciona', () => {
        const r = decidir([
            entrada({
                atual: item({ situacao: 'AGENDADO', retornoEvento: 'BD' }),
                titulo: ilegivel,
            }),
            entrada({ atual: item({ docCod: '4030', titCod: '7' }), titulo: pago }),
        ]);
        expect(r.itens[0]?.situacao).toBe('AGENDADO');
        expect(r.itens[0]?.tituloLido).toBe(false);
        expect(r.leituraCompleta).toBe(false);
        expect(r.destino).toBeUndefined();
    });

    it('fin064 ilegível não vira "pago" nem "não pago" (nunca sincronizado fica sem situação)', () => {
        const [i] = decidir([entrada({ titulo: ilegivel })]).itens;
        expect(i?.situacao).toBeUndefined();
        expect(i?.pagoObservadoEm).toBeUndefined();
        expect(i?.sincronizadoEm).toBeUndefined();
    });

    it('rejeição lida com outro fin064 ilegível → o lote não transiciona nesta passada', () => {
        const r = decidir([
            entrada({ eventos: [rejeicao] }),
            entrada({ atual: item({ docCod: '4030', titCod: '7' }), titulo: ilegivel }),
        ]);
        expect(r.itens[0]?.situacao).toBe('REJEITADO');
        expect(r.destino).toBeUndefined();
    });

    it('evento não lido nunca produz REJEITADO', () => {
        const [i] = decidir([entrada({ eventos: [] })]).itens;
        expect(i?.rejeitado).toBe(false);
        expect(i?.situacao).not.toBe('REJEITADO');
    });
});

describe('DecisaoStatusLote — baixa de qualquer origem basta (I11b)', () => {
    it('T1: PAGO no fin064 sem nenhum evento do fin052 → BAIXADO', () => {
        const r = decidir([entrada({ titulo: pago, eventos: [], baixas: baixas22320 })]);
        expect(r.destino).toBe('BAIXADO');
    });

    it('T2: vldPago=0 + BD → AGENDADO e lote permanece REMESSA_GERADA, nunca RETORNADO', () => {
        const r = decidir([
            entrada({ atual: item({ filCod: 1, docCod: '4030', titCod: '7' }), eventos: [bd] }),
        ]);
        expect(r.itens[0]?.situacao).toBe('AGENDADO');
        expect(r.destino).toBeUndefined();
    });

    it('T2 gêmeo: vldPago=1 + BD → BAIXADO', () => {
        const r = decidir([
            entrada({
                atual: item({ filCod: 1, docCod: '4030', titCod: '7' }),
                titulo: pago,
                eventos: [bd],
            }),
        ]);
        expect(r.destino).toBe('BAIXADO');
    });
});

describe('DecisaoStatusLote — divergências (I11f)', () => {
    it('T8: lote BAIXADO com título voltando a aberto → sem transição, divergência + alerta', () => {
        const atual = item({ situacao: 'PAGO', pagoObservadoEm: ANTES, sincronizadoEm: ANTES });
        const r = decidir([entrada({ atual, titulo: aberto })], 'BAIXADO');
        expect(r.destino).toBeUndefined();
        expect(r.itens[0]?.divergencia).toBe(true);
        expect(r.itens[0]?.divergenciaDetalhe).toMatch(/voltou a aberto/);
        expect(r.itens[0]?.situacao).toBe('PAGO');
        expect(r.alertas).toEqual([
            expect.objectContaining({ tipo: 'sispag-baixa-divergente', alvo: 'L1' }),
        ]);
        expect(r.mudou).toBe(true);
    });

    it('REJEITADO com título pago → continua REJEITADO, lote RETORNADO, divergência + alerta', () => {
        const r = decidir([entrada({ titulo: pago, eventos: [rejeicao], baixas: baixas22320 })]);
        expect(r.itens[0]?.situacao).toBe('REJEITADO');
        expect(r.destino).toBe('RETORNADO');
        expect(r.itens[0]?.divergencia).toBe(true);
        expect(r.alertas.map((a) => a.tipo).sort()).toEqual([
            'sispag-baixa-divergente',
            'sispag-lote-retornado',
        ]);
    });

    it('divergência já marcada não gera alerta de novo (humano resolve)', () => {
        const atual = item({
            situacao: 'REJEITADO',
            rejeitado: true,
            retornoEvento: 'AE',
            divergencia: true,
            divergenciaDetalhe:
                'item rejeitado no retorno com o título pago no fin064 (pago fora da remessa?)',
        });
        const r = decidir([entrada({ atual, titulo: pago, eventos: [rejeicao] })], 'RETORNADO');
        expect(r.itens[0]?.divergencia).toBe(true);
        expect(r.alertas).toEqual([]);
    });
});

describe('DecisaoStatusLote — idempotência (I11h)', () => {
    it('T4: entrada idêntica ao estado atual → mudou=false, sem transição, sem alerta', () => {
        const atual = item({
            situacao: 'AGENDADO',
            retornoEvento: 'BD',
            retornoDescricao: 'PAGAMENTO AGENDADO',
            rejeitado: false,
            sincronizadoEm: ANTES,
        });
        const r = decidir([entrada({ atual, titulo: aberto, eventos: [bd] })]);
        expect(r.mudou).toBe(false);
        expect(r.itens[0]?.mudou).toBe(false);
        expect(r.destino).toBeUndefined();
        expect(r.alertas).toEqual([]);
        // só o carimbo de leitura anda
        expect(r.itens[0]?.sincronizadoEm).toBe(AGORA.toISOString());
    });

    it('primeira observação de pagamento carimba pagoObservadoEm; a seguinte não o move', () => {
        const [primeira] = decidir([entrada({ titulo: pago, baixas: baixas22320 })]).itens;
        expect(primeira?.pagoObservadoEm).toBe(AGORA.toISOString());
        const [segunda] = decidir([
            entrada({
                atual: item({
                    situacao: 'PAGO',
                    pagoObservadoEm: ANTES,
                    borCod: 22320,
                    bxaCodSeq: 1,
                    baixaFonte: 'TITULO',
                    origemBaixa: 'FORA_DO_RETORNO',
                    pagoEm: '2026-09-24T15:00:00.000Z',
                    valorPago: 275,
                    sincronizadoEm: ANTES,
                }),
                titulo: pago,
                baixas: baixas22320,
            }),
        ]).itens;
        expect(segunda?.pagoObservadoEm).toBe(ANTES);
        expect(segunda?.mudou).toBe(false);
    });
});

describe('DecisaoStatusLote — origem da baixa e enriquecimento', () => {
    it('PAGO ligado a evento de retorno do lote (linha com borderô/baixa) → REMESSA, fonte RETORNO', () => {
        const comBaixa: EventoRetornoItem = { ...efetuado, borCod: 22400, bxaCodSeq: 3 };
        const [i] = decidir([
            entrada({
                titulo: pago,
                eventos: [comBaixa],
                baixas: {
                    legivel: true,
                    baixas: [
                        {
                            borCod: 22400,
                            bxaCodSeq: 3,
                            data: '2026-09-24T15:00:00.000Z',
                            valor: 275,
                        },
                    ],
                },
            }),
        ]).itens;
        expect(i?.origemBaixa).toBe('REMESSA');
        expect(i?.baixaFonte).toBe('RETORNO');
        expect(i?.borCod).toBe(22400);
        expect(i?.bxaCodSeq).toBe(3);
        expect(i?.pagoEm).toBe('2026-09-24T15:00:00.000Z');
        expect(i?.valorPago).toBe(275);
    });

    it('PAGO sem vínculo com o retorno (T1: borderô manual 22320) → FORA_DO_RETORNO, fonte TITULO', () => {
        const [i] = decidir([entrada({ titulo: pago, eventos: [bd], baixas: baixas22320 })]).itens;
        expect(i?.origemBaixa).toBe('FORA_DO_RETORNO');
        expect(i?.baixaFonte).toBe('TITULO');
        expect(i?.borCod).toBe(22320);
        expect(i?.valorPago).toBe(275);
    });

    it('PAGO com PSQ_018 ilegível (403) → NAO_IDENTIFICADA, enriquecimento nulo, e ainda fecha', () => {
        const r = decidir([entrada({ titulo: pago, eventos: [bd], baixas: baixas403 })]);
        const [i] = r.itens;
        expect(i?.origemBaixa).toBe('NAO_IDENTIFICADA');
        expect(i?.borCod).toBeUndefined();
        expect(i?.baixaFonte).toBeUndefined();
        expect(i?.pagoEm).toBeUndefined();
        expect(r.destino).toBe('BAIXADO');
    });

    it('PSQ_018 ilegível hoje não apaga o enriquecimento lido numa passada anterior', () => {
        const atual = item({
            situacao: 'PAGO',
            pagoObservadoEm: ANTES,
            borCod: 22320,
            baixaFonte: 'TITULO',
            origemBaixa: 'FORA_DO_RETORNO',
            valorPago: 275,
        });
        const [i] = decidir([entrada({ atual, titulo: pago, baixas: baixas403 })]).itens;
        expect(i?.borCod).toBe(22320);
        expect(i?.origemBaixa).toBe('FORA_DO_RETORNO');
    });
});
