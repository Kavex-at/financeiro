import 'reflect-metadata';
import { PAGO_POR_CONEXOS } from '../../interface/sispag/PagoPorConexos.js';
import {
    DUPLICATE_HOLD_ORIGIN,
    type TituloAPagar,
} from '../../interface/sispag/SispagInterface.js';
import {
    ACAO_PAGAMENTO,
    DONO_PAGAMENTO,
    ESTADO_PAGAMENTO,
    MOTIVO_PAGAMENTO,
    MOTIVOS_PAGAMENTO_ORDEM,
    SUGESTAO_BOLETO_SEM_DDA,
} from '../../interface/sispag/SituacaoPagamento.js';
import { SITUACAO_SUGESTAO_TITULO } from '../../interface/sispag/SugestaoBoleto.js';
import { ETAPA_AJUSTE } from '../../libs/boleto/EtapaAjusteCentavos.js';
import { MODO_VINCULO, type ModoVinculo } from '../../libs/boleto/ModoVinculoCodigoBarras.js';
import SituacaoPagamentoResolver, {
    type ContextoSituacaoPagamento,
    FORMAS_NAO_SISPAG,
} from './SituacaoPagamentoResolver.js';

const titulo = (over: Partial<TituloAPagar> = {}): TituloAPagar => ({
    docCod: '100',
    titCod: '1',
    filCod: 2,
    valor: 1000,
    liberado: true,
    pago: false,
    diasAteVencimento: 5,
    ...over,
});

const CHAVE = '2:100:1';

const ctx = (over: Partial<ContextoSituacaoPagamento> = {}): ContextoSituacaoPagamento => ({
    bloqueios: new Map(),
    ajustes: new Map(),
    desfechos: new Map(),
    modoVinculo: () => MODO_VINCULO.OFF as ModoVinculo,
    ...over,
});

const resolver = new SituacaoPagamentoResolver();

describe('SituacaoPagamentoResolver', () => {
    describe('PRONTO', () => {
        it('título liberado, em dia e sem nenhuma pendência conhecida', () => {
            expect(resolver.avaliar(titulo(), ctx())).toEqual({
                estado: ESTADO_PAGAMENTO.PRONTO,
                motivos: [],
            });
        });

        it('vence hoje NÃO é vencido (ADR-0070)', () => {
            const s = resolver.avaliar(titulo({ diasAteVencimento: 0 }), ctx());
            expect(s.estado).toBe(ESTADO_PAGAMENTO.PRONTO);
        });

        it('TED/PIX contam como pronto até existir verificação no carregamento (D10)', () => {
            const s = resolver.avaliar(
                titulo({ formaPagamentoConexos: PAGO_POR_CONEXOS.TRANSACAO }),
                ctx(),
            );
            expect(s.estado).toBe(ESTADO_PAGAMENTO.PRONTO);
        });

        it('forma ausente (título fora do grid de pendentes) não bloqueia', () => {
            expect(resolver.avaliar(titulo(), ctx()).estado).toBe(ESTADO_PAGAMENTO.PRONTO);
        });

        it('tipo desconhecido nunca bloqueia', () => {
            expect(
                resolver.avaliar(titulo({ tpdCod: undefined, tpdDesNome: undefined }), ctx())
                    .estado,
            ).toBe(ESTADO_PAGAMENTO.PRONTO);
        });
    });

    describe('cada motivo isolado: estado, principal, dono, ação e detalhe', () => {
        const casos: Array<{
            nome: string;
            t: Partial<TituloAPagar>;
            c?: Partial<ContextoSituacaoPagamento>;
            motivo: (typeof MOTIVO_PAGAMENTO)[keyof typeof MOTIVO_PAGAMENTO];
            dono: (typeof DONO_PAGAMENTO)[keyof typeof DONO_PAGAMENTO];
            acao: (typeof ACAO_PAGAMENTO)[keyof typeof ACAO_PAGAMENTO];
            detalhe?: RegExp;
        }> = [
            {
                nome: 'não liberado pela alçada',
                t: { liberado: false },
                motivo: MOTIVO_PAGAMENTO.ALCADA,
                dono: DONO_PAGAMENTO.APROVADOR,
                acao: ACAO_PAGAMENTO.ABRIR_NO_CONEXOS,
            },
            {
                nome: 'tipo com "(PERMUTA)" no nome',
                t: { tpdCod: '157', tpdDesNome: 'RECIBO/BOLETO/FATURA - (PERMUTA)' },
                motivo: MOTIVO_PAGAMENTO.TIPO_PERMUTA,
                dono: DONO_PAGAMENTO.PERMUTAS,
                acao: ACAO_PAGAMENTO.ABRIR_EM_PERMUTAS,
                detalhe: /pode já ter permuta parcial/,
            },
            {
                nome: 'vencido há 4 dias',
                t: { diasAteVencimento: -4 },
                motivo: MOTIVO_PAGAMENTO.VENCIDO,
                dono: DONO_PAGAMENTO.CONTAS_A_PAGAR,
                acao: ACAO_PAGAMENTO.RENEGOCIAR_NO_CONEXOS,
                detalhe: /venceu há 4 dias/,
            },
            {
                nome: 'vencido ontem',
                t: { diasAteVencimento: -1 },
                motivo: MOTIVO_PAGAMENTO.VENCIDO,
                dono: DONO_PAGAMENTO.CONTAS_A_PAGAR,
                acao: ACAO_PAGAMENTO.RENEGOCIAR_NO_CONEXOS,
                detalhe: /venceu ontem/,
            },
            {
                nome: 'forma cheque',
                t: { formaPagamentoConexos: PAGO_POR_CONEXOS.CHEQUE },
                motivo: MOTIVO_PAGAMENTO.FORMA_NAO_SISPAG,
                dono: DONO_PAGAMENTO.VOCE,
                acao: ACAO_PAGAMENTO.CORRIGIR_FORMA_NO_CONEXOS,
                detalhe: /CHEQUE/,
            },
            {
                nome: 'bloqueio por duplicidade ativo',
                t: {},
                c: {
                    bloqueios: new Map([
                        [CHAVE, { origem: DUPLICATE_HOLD_ORIGIN.DUPLICIDADE_TITULO }],
                    ]),
                },
                motivo: MOTIVO_PAGAMENTO.DUPLICIDADE,
                dono: DONO_PAGAMENTO.VOCE,
                acao: ACAO_PAGAMENTO.TRATAR_DUPLICIDADE,
            },
            {
                nome: 'retido por código de barras repetido',
                t: {},
                c: {
                    bloqueios: new Map([
                        [CHAVE, { origem: DUPLICATE_HOLD_ORIGIN.CODIGO_BARRAS_REPETIDO }],
                    ]),
                },
                motivo: MOTIVO_PAGAMENTO.RETIDO_CODBAR,
                dono: DONO_PAGAMENTO.VOCE,
                acao: ACAO_PAGAMENTO.DESFAZER_RETENCAO,
            },
            {
                nome: 'retido porque o vínculo do código falhou',
                t: {},
                c: {
                    bloqueios: new Map([
                        [CHAVE, { origem: DUPLICATE_HOLD_ORIGIN.VINCULO_CODIGO_BARRAS_FALHOU }],
                    ]),
                },
                motivo: MOTIVO_PAGAMENTO.RETIDO_CODBAR,
                dono: DONO_PAGAMENTO.VOCE,
                acao: ACAO_PAGAMENTO.DESFAZER_RETENCAO,
            },
            {
                nome: 'ajuste de centavos indeterminado',
                t: {},
                c: { ajustes: new Map([[CHAVE, ETAPA_AJUSTE.INDETERMINADO]]) },
                motivo: MOTIVO_PAGAMENTO.AJUSTE_CENTAVOS_PENDENTE,
                dono: DONO_PAGAMENTO.VOCE,
                acao: ACAO_PAGAMENTO.TENTAR_AJUSTE,
            },
            {
                nome: 'ajuste de centavos aguardando aprovação manual',
                t: {},
                c: { ajustes: new Map([[CHAVE, ETAPA_AJUSTE.AGUARDANDO_APROVACAO_MANUAL]]) },
                motivo: MOTIVO_PAGAMENTO.AJUSTE_CENTAVOS_PENDENTE,
                dono: DONO_PAGAMENTO.VOCE,
                acao: ACAO_PAGAMENTO.TENTAR_AJUSTE,
                detalhe: /aprovação no Conexos/,
            },
            {
                nome: 'ajuste de centavos no meio do caminho (etapa não terminal)',
                t: {},
                c: { ajustes: new Map([[CHAVE, ETAPA_AJUSTE.FINALIZADA]]) },
                motivo: MOTIVO_PAGAMENTO.AJUSTE_CENTAVOS_PENDENTE,
                dono: DONO_PAGAMENTO.VOCE,
                acao: ACAO_PAGAMENTO.TENTAR_AJUSTE,
            },
            {
                nome: 'confirmação de boleto órfã',
                t: {},
                c: { desfechos: new Map([[CHAVE, SITUACAO_SUGESTAO_TITULO.ORFA]]) },
                motivo: MOTIVO_PAGAMENTO.CONFIRMACAO_A_REVISAR,
                dono: DONO_PAGAMENTO.VOCE,
                acao: ACAO_PAGAMENTO.VER_BOLETO,
            },
            {
                nome: 'boleto sem DDA e sem candidato (a analista verifica, D16)',
                t: { formaPagamentoConexos: PAGO_POR_CONEXOS.BOLETO, temBoleto: false },
                c: { desfechos: new Map([[CHAVE, SITUACAO_SUGESTAO_TITULO.SEM_CANDIDATO]]) },
                motivo: MOTIVO_PAGAMENTO.BOLETO_SEM_DDA,
                dono: DONO_PAGAMENTO.VOCE,
                acao: ACAO_PAGAMENTO.VER_BOLETO,
                detalhe: /nenhum boleto no pool/,
            },
            {
                nome: 'boleto sem DDA com sugestão única',
                t: { formaPagamentoConexos: PAGO_POR_CONEXOS.BOLETO, temBoleto: false },
                c: { desfechos: new Map([[CHAVE, SITUACAO_SUGESTAO_TITULO.UNICA_SEGURA]]) },
                motivo: MOTIVO_PAGAMENTO.BOLETO_SEM_DDA,
                dono: DONO_PAGAMENTO.VOCE,
                acao: ACAO_PAGAMENTO.VER_BOLETO,
                detalhe: /boleto sugerido para confirmar/,
            },
        ];

        it.each(casos)('$nome', ({ t, c, motivo, dono, acao, detalhe }) => {
            const s = resolver.avaliar(titulo(t), ctx(c));
            expect(s.estado).toBe(ESTADO_PAGAMENTO.BLOQUEADO);
            expect(s.principal).toBe(motivo);
            expect(s.motivos).toEqual([motivo]);
            expect(s.dono).toBe(dono);
            expect(s.acao?.codigo).toBe(acao);
            expect(s.rotulo).toBeTruthy();
            expect(s.acao?.rotulo).toBeTruthy();
            if (detalhe) expect(s.detalhe).toMatch(detalhe);
        });
    });

    describe('formas de pagamento do Conexos', () => {
        it('bloqueia cheque, extra-caixa, cartão de crédito e caixa (D14)', () => {
            expect([...FORMAS_NAO_SISPAG].sort()).toEqual([
                PAGO_POR_CONEXOS.CHEQUE,
                PAGO_POR_CONEXOS.EXTRA_CAIXA,
                PAGO_POR_CONEXOS.CARTAO_DE_CREDITO,
                PAGO_POR_CONEXOS.CAIXA,
            ]);
        });

        it.each([
            PAGO_POR_CONEXOS.TEF,
            PAGO_POR_CONEXOS.CARTEIRA,
            PAGO_POR_CONEXOS.BOLETO,
            PAGO_POR_CONEXOS.TRANSACAO,
            PAGO_POR_CONEXOS.DOCUMENTO,
            PAGO_POR_CONEXOS.TRANSACAO_AUTOMATICA,
        ])('forma %i não bloqueia por si só', (forma) => {
            const s = resolver.avaliar(
                titulo({ formaPagamentoConexos: forma, temBoleto: true }),
                ctx(),
            );
            expect(s.estado).toBe(ESTADO_PAGAMENTO.PRONTO);
        });

        it('código que o ERP mandou e a tabela não conhece não bloqueia', () => {
            expect(resolver.avaliar(titulo({ formaPagamentoConexos: 99 }), ctx()).estado).toBe(
                ESTADO_PAGAMENTO.PRONTO,
            );
        });
    });

    describe('tipo "(PERMUTA)"', () => {
        it.each([
            'NOTA FISCAL (PERMUTA)',
            'nota fiscal (permuta)',
            'RECIBO/BOLETO/FATURA - (PERMUTA)',
        ])('reconhece "%s" sem depender de caixa', (nome) => {
            expect(resolver.avaliar(titulo({ tpdDesNome: nome }), ctx()).principal).toBe(
                MOTIVO_PAGAMENTO.TIPO_PERMUTA,
            );
        });

        it('adiantamento sem "permuta" no nome NÃO é bloqueado nesta fatia', () => {
            expect(
                resolver.avaliar(titulo({ tpdDesNome: 'ADIANTAMENTO A FORNECEDOR' }), ctx()).estado,
            ).toBe(ESTADO_PAGAMENTO.PRONTO);
        });
    });

    describe('boleto sem DDA × confirmação (ADR-0071)', () => {
        const boleto = { formaPagamentoConexos: PAGO_POR_CONEXOS.BOLETO, temBoleto: false };
        const confirmada = new Map([[CHAVE, SITUACAO_SUGESTAO_TITULO.CONFIRMADA]]);

        it('confirmado com o vínculo LIGADO na filial é PRONTO (o código sai ligado na remessa)', () => {
            const s = resolver.avaliar(
                titulo(boleto),
                ctx({ desfechos: confirmada, modoVinculo: () => MODO_VINCULO.ON }),
            );
            expect(s.estado).toBe(ESTADO_PAGAMENTO.PRONTO);
        });

        it.each([
            MODO_VINCULO.OFF,
            MODO_VINCULO.SHADOW,
        ])('confirmado com o vínculo %s continua BLOQUEADO, dizendo que aguarda o vínculo', (modo) => {
            const s = resolver.avaliar(
                titulo(boleto),
                ctx({ desfechos: confirmada, modoVinculo: () => modo }),
            );
            expect(s.principal).toBe(MOTIVO_PAGAMENTO.BOLETO_SEM_DDA);
            expect(s.detalhe).toMatch(/aguardando o vínculo/);
        });

        it('o modo é o da FILIAL do título', () => {
            const modoVinculo = jest.fn((fil: number) =>
                fil === 7 ? MODO_VINCULO.ON : MODO_VINCULO.OFF,
            );
            const naFilial7 = resolver.avaliar(
                titulo({ ...boleto, filCod: 7 }),
                ctx({
                    desfechos: new Map([['7:100:1', SITUACAO_SUGESTAO_TITULO.CONFIRMADA]]),
                    modoVinculo,
                }),
            );
            expect(naFilial7.estado).toBe(ESTADO_PAGAMENTO.PRONTO);
            expect(modoVinculo).toHaveBeenCalledWith(7);
        });

        it('boleto com DDA já associado no Conexos é PRONTO', () => {
            const s = resolver.avaliar(
                titulo({ ...boleto, temBoleto: true }),
                ctx({ desfechos: new Map([[CHAVE, SITUACAO_SUGESTAO_TITULO.SEM_CANDIDATO]]) }),
            );
            expect(s.estado).toBe(ESTADO_PAGAMENTO.PRONTO);
        });

        it('forma que não é boleto nunca recebe "boleto sem DDA"', () => {
            const s = resolver.avaliar(
                titulo({ formaPagamentoConexos: PAGO_POR_CONEXOS.TRANSACAO, temBoleto: false }),
                ctx({ desfechos: new Map([[CHAVE, SITUACAO_SUGESTAO_TITULO.SEM_CANDIDATO]]) }),
            );
            expect(s.estado).toBe(ESTADO_PAGAMENTO.PRONTO);
        });
    });

    describe('boleto sem DDA subdividido pela sugestão (I19r)', () => {
        const boleto = { formaPagamentoConexos: PAGO_POR_CONEXOS.BOLETO, temBoleto: false };
        const S = SITUACAO_SUGESTAO_TITULO;
        const G = SUGESTAO_BOLETO_SEM_DDA;

        it.each([
            [S.UNICA_SEGURA, G.PARA_CONFIRMAR, 'Confirmar boleto sugerido'],
            [S.SO_ATENCAO, G.PARA_CONFIRMAR, 'Confirmar boleto sugerido'],
            [S.AMBIGUA, G.A_ESCOLHER, 'Escolher o boleto'],
            [S.DISPUTADA, G.A_ESCOLHER, 'Escolher o boleto'],
            [S.SO_FRACA, G.CANDIDATO_FRACO, 'Ver candidatos'],
            [S.SO_VENCIDA, G.CANDIDATO_FRACO, 'Ver candidatos'],
            [S.SEM_CANDIDATO, G.SEM_CANDIDATO, 'Ver boleto'],
        ])('desfecho %s → %s, botão "%s"', (desfecho, grupo, botao) => {
            const s = resolver.avaliar(
                titulo(boleto),
                ctx({ desfechos: new Map([[CHAVE, desfecho]]) }),
            );
            expect(s.principal).toBe(MOTIVO_PAGAMENTO.BOLETO_SEM_DDA);
            expect(s.sugestaoBoleto).toBe(grupo);
            expect(s.acao).toEqual({ codigo: ACAO_PAGAMENTO.VER_BOLETO, rotulo: botao });
        });

        it('título sem desfecho conhecido conta como sem candidato', () => {
            const s = resolver.avaliar(titulo(boleto), ctx());
            expect(s.sugestaoBoleto).toBe(G.SEM_CANDIDATO);
        });

        it('confirmado com o vínculo desligado fica em "aguardando vínculo"', () => {
            const s = resolver.avaliar(
                titulo(boleto),
                ctx({ desfechos: new Map([[CHAVE, S.CONFIRMADA]]) }),
            );
            expect(s.sugestaoBoleto).toBe(G.AGUARDANDO_VINCULO);
        });

        it('só aparece quando boleto sem DDA é o motivo principal', () => {
            const s = resolver.avaliar(
                titulo({ ...boleto, diasAteVencimento: -2 }),
                ctx({ desfechos: new Map([[CHAVE, S.UNICA_SEGURA]]) }),
            );
            expect(s.principal).toBe(MOTIVO_PAGAMENTO.VENCIDO);
            expect(s.motivos).toContain(MOTIVO_PAGAMENTO.BOLETO_SEM_DDA);
            expect(s.sugestaoBoleto).toBeUndefined();
            expect(s.acao?.rotulo).toBe('Renegociar no Conexos');
        });

        it('outros motivos não carregam sugestão', () => {
            const s = resolver.avaliar(titulo({ liberado: false }), ctx());
            expect(s).not.toHaveProperty('sugestaoBoleto');
        });
    });

    describe('prioridade e vários motivos', () => {
        it('lista todos os motivos na ordem de prioridade; o principal é o primeiro', () => {
            const s = resolver.avaliar(
                titulo({
                    liberado: false,
                    diasAteVencimento: -2,
                    tpdDesNome: 'NOTA FISCAL (PERMUTA)',
                    formaPagamentoConexos: PAGO_POR_CONEXOS.CHEQUE,
                }),
                ctx(),
            );
            expect(s.motivos).toEqual([
                MOTIVO_PAGAMENTO.ALCADA,
                MOTIVO_PAGAMENTO.TIPO_PERMUTA,
                MOTIVO_PAGAMENTO.VENCIDO,
                MOTIVO_PAGAMENTO.FORMA_NAO_SISPAG,
            ]);
            expect(s.principal).toBe(MOTIVO_PAGAMENTO.ALCADA);
            expect(s.dono).toBe(DONO_PAGAMENTO.APROVADOR);
        });

        it('a ordem dos motivos é a do contrato', () => {
            const todos = resolver.avaliar(
                titulo({
                    liberado: false,
                    diasAteVencimento: -2,
                    tpdDesNome: 'X (PERMUTA)',
                    formaPagamentoConexos: PAGO_POR_CONEXOS.BOLETO,
                    temBoleto: false,
                }),
                ctx({
                    bloqueios: new Map([
                        [CHAVE, { origem: DUPLICATE_HOLD_ORIGIN.DUPLICIDADE_TITULO }],
                    ]),
                    ajustes: new Map([[CHAVE, ETAPA_AJUSTE.INDETERMINADO]]),
                    desfechos: new Map([[CHAVE, SITUACAO_SUGESTAO_TITULO.ORFA]]),
                }),
            );
            const esperados = MOTIVOS_PAGAMENTO_ORDEM.filter((m) => todos.motivos.includes(m));
            expect(todos.motivos).toEqual(esperados);
            expect(todos.motivos).toHaveLength(MOTIVOS_PAGAMENTO_ORDEM.length - 2);
        });

        it('vencido + boleto sem DDA: o principal é o vencido (quem resolve primeiro)', () => {
            const s = resolver.avaliar(
                titulo({
                    diasAteVencimento: -1,
                    formaPagamentoConexos: PAGO_POR_CONEXOS.BOLETO,
                    temBoleto: false,
                }),
                ctx({ desfechos: new Map([[CHAVE, SITUACAO_SUGESTAO_TITULO.SEM_CANDIDATO]]) }),
            );
            expect(s.principal).toBe(MOTIVO_PAGAMENTO.VENCIDO);
            expect(s.motivos).toContain(MOTIVO_PAGAMENTO.BOLETO_SEM_DDA);
        });
    });

    describe('etapas do ajuste de centavos', () => {
        it.each([
            ETAPA_AJUSTE.CONCLUIDO,
            ETAPA_AJUSTE.CONCLUIDO_SEM_DECISAO,
            ETAPA_AJUSTE.CANCELADO,
            ETAPA_AJUSTE.RECUSADO,
            ETAPA_AJUSTE.SIMULADO,
        ])('etapa %s não pede ação', (etapa) => {
            const s = resolver.avaliar(titulo(), ctx({ ajustes: new Map([[CHAVE, etapa]]) }));
            expect(s.estado).toBe(ESTADO_PAGAMENTO.PRONTO);
        });

        it.each([
            ETAPA_AJUSTE.PENDENTE,
            ETAPA_AJUSTE.RENEGOCIACAO_CRIADA,
            ETAPA_AJUSTE.TITULO_INCLUIDO,
            ETAPA_AJUSTE.COMPOSICAO_GRAVADA,
            ETAPA_AJUSTE.AJUSTE_APLICADO,
            ETAPA_AJUSTE.FINALIZADA,
            ETAPA_AJUSTE.LIBERADA,
            ETAPA_AJUSTE.SEM_BLOQUEIO,
            ETAPA_AJUSTE.RECHAVEADA,
            ETAPA_AJUSTE.AGUARDANDO_APROVACAO_MANUAL,
            ETAPA_AJUSTE.INDETERMINADO,
        ])('etapa %s bloqueia', (etapa) => {
            const s = resolver.avaliar(titulo(), ctx({ ajustes: new Map([[CHAVE, etapa]]) }));
            expect(s.principal).toBe(MOTIVO_PAGAMENTO.AJUSTE_CENTAVOS_PENDENTE);
        });
    });

    describe('fonte de contexto indisponível (undefined) não aplica os motivos dela', () => {
        it('sem desfechos: nem "boleto sem DDA" nem "confirmação a revisar"', () => {
            const s = resolver.avaliar(
                titulo({ formaPagamentoConexos: PAGO_POR_CONEXOS.BOLETO, temBoleto: false }),
                ctx({ desfechos: undefined }),
            );
            expect(s.estado).toBe(ESTADO_PAGAMENTO.PRONTO);
        });

        it('sem bloqueios ou sem ajustes: os demais motivos continuam valendo', () => {
            const s = resolver.avaliar(
                titulo({ liberado: false }),
                ctx({ bloqueios: undefined, ajustes: undefined }),
            );
            expect(s.principal).toBe(MOTIVO_PAGAMENTO.ALCADA);
        });
    });

    describe('perfil de cada motivo', () => {
        it('todo motivo do contrato tem rótulo, dono e ação (nenhum botão morto)', () => {
            for (const motivo of MOTIVOS_PAGAMENTO_ORDEM) {
                expect(resolver.rotuloDo(motivo)).toBeTruthy();
            }
        });
    });

    describe('resumir', () => {
        it('conta por estado, motivo principal e dono, com os valores', () => {
            const titulos = [
                { valor: 100, situacaoPagamento: resolver.avaliar(titulo(), ctx()) },
                { valor: 200, situacaoPagamento: resolver.avaliar(titulo(), ctx()) },
                {
                    valor: 300,
                    situacaoPagamento: resolver.avaliar(titulo({ liberado: false }), ctx()),
                },
                {
                    valor: 400,
                    situacaoPagamento: resolver.avaliar(
                        titulo({ liberado: false, diasAteVencimento: -3 }),
                        ctx(),
                    ),
                },
                {
                    valor: 50,
                    situacaoPagamento: resolver.avaliar(titulo({ diasAteVencimento: -3 }), ctx()),
                },
                { valor: 999 },
            ];
            const r = resolver.resumir(titulos);
            expect(r.porEstado).toEqual({
                PRONTO: { qtd: 2, valor: 300 },
                BLOQUEADO: { qtd: 3, valor: 750 },
            });
            expect(r.porMotivo).toEqual({
                ALCADA: { qtd: 2, valor: 700 },
                VENCIDO: { qtd: 1, valor: 50 },
            });
            expect(r.porDono).toEqual({
                APROVADOR: { qtd: 2, valor: 700 },
                CONTAS_A_PAGAR: { qtd: 1, valor: 50 },
            });
        });

        it('a soma dos motivos principais é igual aos bloqueados', () => {
            const titulos = [
                {
                    valor: 1,
                    situacaoPagamento: resolver.avaliar(titulo({ liberado: false }), ctx()),
                },
                {
                    valor: 1,
                    situacaoPagamento: resolver.avaliar(
                        titulo({ tpdDesNome: 'X (PERMUTA)' }),
                        ctx(),
                    ),
                },
            ];
            const r = resolver.resumir(titulos);
            const somaMotivos = Object.values(r.porMotivo).reduce((n, t) => n + (t?.qtd ?? 0), 0);
            expect(somaMotivos).toBe(r.porEstado.BLOQUEADO.qtd);
        });

        it('carteira vazia zera tudo', () => {
            expect(resolver.resumir([])).toEqual({
                porEstado: { PRONTO: { qtd: 0, valor: 0 }, BLOQUEADO: { qtd: 0, valor: 0 } },
                porMotivo: {},
                porDono: {},
            });
        });
    });
});
