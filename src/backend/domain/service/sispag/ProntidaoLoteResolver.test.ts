import 'reflect-metadata';
import type {
    AlertaItemLote,
    ItemLote,
    LotePagamento,
} from '../../interface/sispag/SispagInterface.js';
import {
    DONO_PAGAMENTO,
    EFEITO_PENDENCIA,
    ESTADO_PRONTIDAO,
    FONTE_SITUACAO,
    MOTIVO_PAGAMENTO,
    PENDENCIA_LOTE,
    type SituacaoPagamento,
} from '../../interface/sispag/SituacaoPagamento.js';
import ProntidaoLoteResolver, { type ContextoProntidao } from './ProntidaoLoteResolver.js';

const PRONTO: SituacaoPagamento = { estado: 'PRONTO', motivos: [] };

const item = (titCod: string, over: Partial<ItemLote> = {}): ItemLote => ({
    loteId: 'L1',
    filCod: 2,
    docCod: '100',
    titCod,
    valor: 100,
    modalidade: 'BOLETO',
    incluidoPor: 'ana',
    divergencia: false,
    ...over,
});

const lote = (itens: ItemLote[], over: Partial<LotePagamento> = {}): LotePagamento => ({
    id: 'L1',
    filCod: 2,
    conta: '55795-4',
    status: 'RASCUNHO',
    criadoPor: 'ana',
    versao: 1,
    itens,
    ...over,
});

/** Contexto em que todo item listado está na carteira e PRONTO. */
const ctx = (itens: ItemLote[], over: Partial<ContextoProntidao> = {}): ContextoProntidao => ({
    situacoes: new Map(itens.map((i) => [`${i.filCod}:${i.docCod}:${i.titCod}`, PRONTO])),
    fontesIndisponiveis: [],
    emAjuste: new Set(),
    ...over,
});

const alerta = (estado: 'ABERTA' | 'RESOLVIDA'): AlertaItemLote => ({
    id: 'a1',
    loteId: 'L1',
    filCod: 2,
    docCod: '100',
    titCod: '1',
    tipo: 'DUPLICIDADE_FORTE',
    evidencia: {},
    estado,
    criadoEm: '2026-10-22T10:00:00Z',
    verificadoEm: '2026-10-22T10:00:00Z',
});

describe('ProntidaoLoteResolver (ADR-0076, regra prontidao-lote)', () => {
    const resolver = new ProntidaoLoteResolver();

    it('caso 1: sem pendência → PRONTO, todos os itens vão', () => {
        const itens = [item('1'), item('2'), item('3')];
        expect(resolver.avaliar(lote(itens), ctx(itens))).toEqual({
            estado: ESTADO_PRONTIDAO.PRONTO,
            itensQueVao: 3,
            barram: 0,
            saem: 0,
            pendencias: [],
            fontesIndisponiveis: [],
        });
    });

    it('caso 2: duplicidade ABERTA barra com "Tratar alerta"; RESOLVIDA não', () => {
        const aberta = [item('1', { alertas: [alerta('ABERTA')] })];
        const p = resolver.avaliar(lote(aberta), ctx(aberta));
        expect(p).toMatchObject({ estado: ESTADO_PRONTIDAO.COM_PENDENCIA, barram: 1, saem: 0 });
        expect(p.pendencias[0]).toMatchObject({
            efeito: EFEITO_PENDENCIA.BARRA,
            codigo: PENDENCIA_LOTE.DUPLICIDADE_ABERTA,
            dono: DONO_PAGAMENTO.VOCE,
            acao: { codigo: 'TRATAR_DUPLICIDADE', rotulo: 'Tratar alerta' },
            chave: { filCod: 2, docCod: '100', titCod: '1' },
        });
        const resolvida = [item('1', { alertas: [alerta('RESOLVIDA')] })];
        expect(resolver.avaliar(lote(resolvida), ctx(resolvida)).estado).toBe('PRONTO');
    });

    it('caso 3: TED com favorecido não autorizado SAI (dono aprovador), não barra', () => {
        const itens = [
            item('1', { modalidade: 'TED', autorizacaoAviso: 'FAVORECIDO_NAO_AUTORIZADO' }),
            item('2'),
        ];
        const p = resolver.avaliar(lote(itens), ctx(itens));
        expect(p).toMatchObject({ barram: 0, saem: 1, itensQueVao: 1 });
        expect(p.pendencias[0]).toMatchObject({
            efeito: EFEITO_PENDENCIA.SAI,
            dono: DONO_PAGAMENTO.APROVADOR,
            acao: { codigo: 'PEDIR_AUTORIZACAO' },
            detalhe: 'na última verificação',
        });
    });

    it('sem conta nem chave PIX no cadastro SAI com dono CADASTRO', () => {
        const itens = [item('1', { modalidade: 'PIX', autorizacaoAviso: 'SEM_DADO_PAGAMENTO' })];
        expect(resolver.avaliar(lote(itens), ctx(itens)).pendencias[0]).toMatchObject({
            efeito: EFEITO_PENDENCIA.SAI,
            codigo: PENDENCIA_LOTE.SEM_DADO_PAGAMENTO,
            dono: DONO_PAGAMENTO.CADASTRO,
            acao: { codigo: 'ABRIR_CADASTRO_NO_CONEXOS' },
        });
    });

    it('aviso de autorização de um item que deixou de ser TED/PIX não conta', () => {
        const itens = [item('1', { modalidade: 'BOLETO', autorizacaoAviso: 'DESTINO_ALTERADO' })];
        expect(resolver.avaliar(lote(itens), ctx(itens)).estado).toBe('PRONTO');
    });

    it('caso 4: título que ficou ALCADA barra com o rótulo, dono e ação da situação', () => {
        const itens = [item('1')];
        const situacoes = new Map([
            [
                '2:100:1',
                {
                    estado: 'BLOQUEADO',
                    motivos: [MOTIVO_PAGAMENTO.ALCADA],
                    principal: MOTIVO_PAGAMENTO.ALCADA,
                    rotulo: 'Aguardando aprovação',
                    dono: DONO_PAGAMENTO.APROVADOR,
                    acao: { codigo: 'ABRIR_NO_CONEXOS', rotulo: 'Abrir no Conexos' },
                } as SituacaoPagamento,
            ],
        ]);
        const p = resolver.avaliar(lote(itens), ctx(itens, { situacoes }));
        expect(p).toMatchObject({ barram: 1, itensQueVao: 1 });
        expect(p.pendencias[0]).toMatchObject({
            efeito: EFEITO_PENDENCIA.BARRA,
            codigo: PENDENCIA_LOTE.SITUACAO_BLOQUEADA,
            rotulo: 'Aguardando aprovação',
            dono: DONO_PAGAMENTO.APROVADOR,
            acao: { codigo: 'ABRIR_NO_CONEXOS' },
            motivo: MOTIVO_PAGAMENTO.ALCADA,
        });
    });

    it('caso 5: fonte caída → situação não conferida (BARRA), nomeando a consulta', () => {
        const itens = [item('1')];
        const p = resolver.avaliar(
            lote(itens),
            ctx(itens, { fontesIndisponiveis: [FONTE_SITUACAO.DUPLICIDADE] }),
        );
        expect(p.fontesIndisponiveis).toEqual(['DUPLICIDADE']);
        expect(p.pendencias[0]).toMatchObject({
            efeito: EFEITO_PENDENCIA.BARRA,
            codigo: PENDENCIA_LOTE.SITUACAO_NAO_CONFERIDA,
            detalhe: expect.stringContaining('duplicidade'),
        });
    });

    it('título fora da carteira → situação não conferida', () => {
        const itens = [item('1')];
        const p = resolver.avaliar(lote(itens), ctx(itens, { situacoes: new Map() }));
        expect(p.pendencias[0]).toMatchObject({
            codigo: PENDENCIA_LOTE.SITUACAO_NAO_CONFERIDA,
            detalhe: expect.stringContaining('carteira'),
        });
    });

    it('caso 6: lote sem conta e lote vazio são pendências do lote, sem chave, primeiro', () => {
        const itens = [item('1', { modalidade: undefined })];
        const p = resolver.avaliar(lote(itens, { conta: undefined }), ctx(itens));
        expect(p.pendencias.map((x) => x.codigo)).toEqual(['SEM_CONTA', 'SEM_FORMA']);
        expect(p.pendencias[0]?.chave).toBeUndefined();
        const vazio = resolver.avaliar(lote([]), ctx([]));
        expect(vazio).toMatchObject({ estado: 'COM_PENDENCIA', itensQueVao: 0 });
        expect(vazio.pendencias[0]?.codigo).toBe('LOTE_VAZIO');
    });

    it('ajuste em andamento barra; não repete quando a situação já diz ajuste pendente', () => {
        const itens = [item('1'), item('2')];
        const situacoes = new Map<string, SituacaoPagamento>([
            ['2:100:1', PRONTO],
            [
                '2:100:2',
                {
                    estado: 'BLOQUEADO',
                    motivos: [MOTIVO_PAGAMENTO.AJUSTE_CENTAVOS_PENDENTE],
                    principal: MOTIVO_PAGAMENTO.AJUSTE_CENTAVOS_PENDENTE,
                    rotulo: 'Ajuste de centavos pendente',
                    dono: 'VOCE',
                },
            ],
        ]);
        const p = resolver.avaliar(
            lote(itens),
            ctx(itens, { situacoes, emAjuste: new Set(['2:100:1', '2:100:2']) }),
        );
        expect(p.pendencias.map((x) => [x.chave?.titCod, x.codigo])).toEqual(
            expect.arrayContaining([
                ['1', 'AJUSTE_EM_ANDAMENTO'],
                ['2', 'SITUACAO_BLOQUEADA'],
            ]),
        );
        expect(p.pendencias).toHaveLength(2);
    });

    it('verificação PENDENTE barra e diz que a finalização tenta de novo (sem botão)', () => {
        const itens = [item('1', { modalidade: 'TED', verificacaoEstado: 'PENDENTE' })];
        const [p] = resolver.avaliar(lote(itens), ctx(itens)).pendencias;
        expect(p).toMatchObject({ codigo: 'VERIFICACAO_PENDENTE', efeito: 'BARRA' });
        expect(p?.acao).toBeUndefined();
    });

    it('item que barra E sai conta só em `barram`; BARRA vem antes de SAI, e pelo valor', () => {
        const itens = [
            item('1', { valor: 50, modalidade: 'TED', autorizacaoAviso: 'DESTINO_ALTERADO' }),
            item('2', {
                valor: 900,
                modalidade: 'TED',
                autorizacaoAviso: 'DESTINO_ALTERADO',
                alertas: [{ ...alerta('ABERTA'), titCod: '2' }],
            }),
            item('3', { valor: 300, modalidade: undefined }),
        ];
        const p = resolver.avaliar(lote(itens), ctx(itens));
        expect(p).toMatchObject({ barram: 2, saem: 1, itensQueVao: 2 });
        expect(p.pendencias.map((x) => [x.efeito, x.chave?.titCod])).toEqual([
            ['BARRA', '2'],
            ['BARRA', '3'],
            ['SAI', '2'],
            ['SAI', '1'],
        ]);
    });
});
