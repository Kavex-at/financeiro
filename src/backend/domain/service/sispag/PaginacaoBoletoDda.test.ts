import 'reflect-metadata';
import type { BoletoDdaConsolidado, BoletoDdaTitulo } from '../../interface/sispag/BoletoDda.js';
import PaginacaoBoletoDda, { BOLETO_DDA_TAMANHO_MAX } from './PaginacaoBoletoDda.js';

const paginacao = new PaginacaoBoletoDda();

const titulo = (over: Partial<BoletoDdaTitulo>): BoletoDdaTitulo => ({
    filCod: 1,
    docCod: '1',
    titCod: '1',
    ...over,
});

const linha = (over: Partial<BoletoDdaConsolidado>): BoletoDdaConsolidado => ({
    ddcCod: 1,
    ditCod: 1,
    valor: 100,
    vencido: false,
    arquivos: 1,
    situacao: 'SEM_TITULO',
    candidatos: [],
    ...over,
});

const ADP = linha({
    ditCod: 1,
    numero: '001532761',
    valor: 4815.33,
    situacao: 'CANDIDATO',
    candidatos: [titulo({ filCod: 1, docCod: '5046', credor: 'ADP BRASIL LTDA' })],
});
const PEDRONI = linha({
    ditCod: 2,
    numero: '329691',
    valor: 1412,
    situacao: 'AMBIGUO',
    candidatos: [
        titulo({ filCod: 2, docCod: '34685', credor: 'PEDRONI LOGISTICA LTDA' }),
        titulo({ filCod: 2, docCod: '34872', credor: 'PEDRONI LOGISTICA LTDA' }),
    ],
});
const VINCULADO = linha({
    ditCod: 3,
    numero: '998524434',
    valor: 611.86,
    situacao: 'VINCULADO',
    vinculo: titulo({ filCod: 4, docCod: '9823' }),
});
const LIVRE = linha({ ditCod: 4, numero: '7386000', valor: 4838.32 });
const TODAS = [ADP, PEDRONI, VINCULADO, LIVRE];

describe('PaginacaoBoletoDda', () => {
    it('conta por situação antes do filtro de situação, e filtra depois', () => {
        const r = paginacao.paginar(TODAS, { situacao: 'AMBIGUO', pagina: 1, tamanho: 20 });
        expect(r.contagem).toEqual({
            todas: 4,
            VINCULADO: 1,
            CANDIDATO: 1,
            AMBIGUO: 1,
            FORA_JANELA: 0,
            TITULO_SAIU_CARTEIRA: 0,
            SEM_TITULO: 1,
            emGrupo: 0,
        });
        expect(r.total).toBe(1);
        expect(r.boletos.map((b) => b.numero)).toEqual(['329691']);
    });

    it.each([
        ['valor sem máscara', '4815', '001532761'],
        ['valor com máscara brasileira', '4.815,33', '001532761'],
        ['credor, sem diferenciar maiúsculas', 'pedroni', '329691'],
        ['documento do título', '9823/1', '998524434'],
        ['número do boleto', '7386', '7386000'],
    ])('busca por %s', (_caso, busca, esperado) => {
        const r = paginacao.paginar(TODAS, { busca, pagina: 1, tamanho: 20 });
        expect(r.boletos.map((b) => b.numero)).toEqual([esperado]);
        expect(r.contagem.todas).toBe(1);
    });

    it('filCod (legado, gaveta do título): filtra pela filial de exibição; sem filial passa', () => {
        const r = paginacao.paginar(TODAS, { filCod: 1, pagina: 1, tamanho: 20 });
        // ADP (fil 1) + LIVRE (sem filial). PEDRONI é ambíguo, mas os 2 candidatos são da fil 2
        // (I-DDA5: filial comum a todos os candidatos); VINCULADO é da fil 4.
        expect(r.boletos.map((b) => b.ditCod)).toEqual([1, 4]);
        expect(r.filiais).toEqual([1, 2, 4]);
    });

    it('pagina e limita a página pedida à última existente', () => {
        const muitas = Array.from({ length: 45 }, (_, i) => linha({ ditCod: i + 1 }));
        const p3 = paginacao.paginar(muitas, { pagina: 3, tamanho: 20 });
        expect(p3.boletos.map((b) => b.ditCod)).toEqual([41, 42, 43, 44, 45]);

        const alem = paginacao.paginar(muitas, { pagina: 99, tamanho: 20 });
        expect(alem.pagina).toBe(3);
        expect(alem.total).toBe(45);
    });

    it('nunca devolve mais que o teto por página', () => {
        const muitas = Array.from({ length: 500 }, (_, i) => linha({ ditCod: i + 1 }));
        const r = paginacao.paginar(muitas, { pagina: 1, tamanho: 10_000 });
        expect(r.boletos).toHaveLength(BOLETO_DDA_TAMANHO_MAX);
        expect(r.tamanho).toBe(BOLETO_DDA_TAMANHO_MAX);
    });

    it('intervalo de vencimento: inclusivo, antes da contagem; sem vencimento sai', () => {
        const comVenc = [
            linha({ ditCod: 1, vencimento: '2026-10-01', situacao: 'CANDIDATO' }),
            linha({ ditCod: 2, vencimento: '2026-10-15' }),
            linha({ ditCod: 3, vencimento: '2026-10-31' }),
            linha({ ditCod: 4 }),
        ];
        const r = paginacao.paginar(comVenc, {
            vencimentoDe: '2026-10-01',
            vencimentoAte: '2026-10-15',
            pagina: 1,
            tamanho: 20,
        });
        expect(r.boletos.map((b) => b.ditCod)).toEqual([1, 2]);
        expect(r.contagem).toMatchObject({ todas: 2, CANDIDATO: 1, SEM_TITULO: 1 });

        const soAte = paginacao.paginar(comVenc, {
            vencimentoAte: '2026-10-01',
            pagina: 1,
            tamanho: 20,
        });
        expect(soAte.boletos.map((b) => b.ditCod)).toEqual([1]);

        const semIntervalo = paginacao.paginar(comVenc, { pagina: 1, tamanho: 20 });
        expect(semIntervalo.total).toBe(4);
    });

    it('lista vazia devolve página 1 sem linhas', () => {
        const r = paginacao.paginar([], { pagina: 5, tamanho: 20 });
        expect(r).toMatchObject({ boletos: [], total: 0, pagina: 1, filiais: [] });
    });

    describe('boleto de grupo (I21v): chip "Em grupo" ortogonal à situação', () => {
        const GRUPO_SUG = {
            estado: 'SUGERIDO' as const,
            filCod: 1,
            nTitulos: 2,
            confirmavel: true,
        };
        const GRUPO_CONF = {
            estado: 'CONFIRMADO' as const,
            id: 'g-1',
            filCod: 1,
            nTitulos: 3,
            confirmavel: true,
        };
        const comGrupo = [
            { ...ADP, grupo: GRUPO_SUG },
            { ...PEDRONI, grupo: GRUPO_CONF },
            VINCULADO,
            LIVRE,
        ];

        it('conta emGrupo (sugerido + confirmado) sem depender da situação', () => {
            const r = paginacao.paginar(comGrupo, { pagina: 1, tamanho: 20 });
            expect(r.contagem.emGrupo).toBe(2);
            expect(r.contagem.todas).toBe(4);
        });

        it('filtro emGrupo devolve só os boletos de grupo e compõe com a situação', () => {
            const r = paginacao.paginar(comGrupo, { emGrupo: true, pagina: 1, tamanho: 20 });
            expect(r.boletos.map((b) => b.ditCod)).toEqual([1, 2]);
            expect(r.total).toBe(2);
            const so = paginacao.paginar(comGrupo, {
                emGrupo: true,
                situacao: 'AMBIGUO',
                pagina: 1,
                tamanho: 20,
            });
            expect(so.boletos.map((b) => b.numero)).toEqual(['329691']);
        });

        it('a contagem de emGrupo respeita filial e busca, e não muda com o filtro emGrupo', () => {
            const r = paginacao.paginar(comGrupo, {
                emGrupo: true,
                busca: 'pedroni',
                pagina: 1,
                tamanho: 20,
            });
            expect(r.contagem.emGrupo).toBe(1);
        });
    });

    describe('paridade com Títulos a pagar (sispag-dda-paridade)', () => {
        const HOJE = '2026-10-30';
        const base = { pagina: 1, tamanho: 20, hoje: HOJE };
        const MISTO = linha({
            ditCod: 5,
            numero: '555',
            valor: 10,
            situacao: 'AMBIGUO',
            candidatos: [titulo({ filCod: 1, credor: 'A' }), titulo({ filCod: 3, credor: 'B' })],
        });
        const COM = [...TODAS, MISTO];

        describe('I-DDA5: filtro de filial não deixa passar boleto sem filial', () => {
            it('filiais=[1] mostra e conta só a filial 1', () => {
                const r = paginacao.paginar(COM, { ...base, filiais: [1] });
                expect(r.boletos.map((b) => b.ditCod)).toEqual([1]);
                expect(r.contagem.todas).toBe(1);
                expect(r.totais.todas.qtd).toBe(1);
            });

            it('"sem" é opção própria: LIVRE e o ambíguo de filiais diferentes', () => {
                const r = paginacao.paginar(COM, { ...base, filiais: ['sem'] });
                expect(r.boletos.map((b) => b.ditCod)).toEqual([4, 5]);
            });

            it('várias filiais somam; a linha da página leva a filial de exibição', () => {
                const r = paginacao.paginar(COM, { ...base, filiais: [2, 4] });
                expect(r.boletos.map((b) => [b.ditCod, b.filial])).toEqual([
                    [2, 2],
                    [3, 4],
                ]);
            });

            it('facetas sobre o escopo inteiro, com total por filial e sem filial', () => {
                const r = paginacao.paginar(COM, { ...base, filiais: [1] });
                expect(r.facetas.filiais).toEqual([
                    { valor: 1, qtd: 1 },
                    { valor: 2, qtd: 1 },
                    { valor: 4, qtd: 1 },
                ]);
                expect(r.facetas.semFilial).toBe(2);
            });
        });

        describe('totais com R$', () => {
            it('soma o valor do boleto por situação, antes do filtro de situação', () => {
                const r = paginacao.paginar(TODAS, { ...base, situacoes: ['AMBIGUO'] });
                expect(r.totais.CANDIDATO).toEqual({ qtd: 1, valor: 4815.33 });
                expect(r.totais.AMBIGUO).toEqual({ qtd: 1, valor: 1412 });
                expect(r.totais.VINCULADO).toEqual({ qtd: 1, valor: 611.86 });
                expect(r.totais.todas).toEqual({ qtd: 4, valor: 11677.51 });
                expect(r.total).toBe(1);
            });

            it('grupo conta uma vez e divide sugerido/confirmado', () => {
                const g = (estado: 'SUGERIDO' | 'CONFIRMADO') => ({
                    estado,
                    filCod: 1,
                    nTitulos: 2,
                    confirmavel: true,
                });
                const r = paginacao.paginar(
                    [
                        { ...ADP, grupo: g('SUGERIDO') },
                        { ...PEDRONI, grupo: g('CONFIRMADO') },
                    ],
                    base,
                );
                expect(r.totais.emGrupo).toEqual({ qtd: 2, valor: 6227.33 });
                expect(r.totais.grupoSugerido.qtd).toBe(1);
                expect(r.totais.grupoConfirmado.qtd).toBe(1);
            });
        });

        describe('vencimento: faixas e urgentes (dia civil BRT, VINCULADO fora)', () => {
            const V = [
                linha({ ditCod: 1, vencimento: '2026-10-29', situacao: 'CANDIDATO' }),
                linha({ ditCod: 2, vencimento: HOJE, situacao: 'CANDIDATO', valor: 5 }),
                linha({ ditCod: 3, vencimento: HOJE, situacao: 'VINCULADO' }),
                linha({ ditCod: 4, vencimento: '2026-11-01', situacao: 'SEM_TITULO', valor: 7 }),
                linha({ ditCod: 5, vencimento: '2026-11-05' }),
                linha({ ditCod: 6, vencimento: '2026-11-30' }),
                linha({ ditCod: 7 }),
            ];

            it('faixas filtram como em Títulos; sem vencimento sai', () => {
                const r = (faixas: Parameters<typeof paginacao.paginar>[1]['faixas']) =>
                    paginacao.paginar(V, { ...base, faixas }).boletos.map((b) => b.ditCod);
                expect(r(['VENCIDO'])).toEqual([1]);
                expect(r(['HOJE'])).toEqual([2, 3]);
                expect(r(['1-2'])).toEqual([4]);
                expect(r(['3-7'])).toEqual([5]);
                expect(r(['8+'])).toEqual([6]);
                expect(r(['HOJE', '1-2'])).toEqual([2, 3, 4]);
            });

            it('urgentes e hoje excluem VINCULADO e dividem para conferir / sem título', () => {
                const r = paginacao.paginar(V, base);
                expect(r.totais.urgentes).toEqual({ qtd: 2, valor: 12 });
                expect(r.totais.urgentesParaConferir.qtd).toBe(1);
                expect(r.totais.urgentesSemTitulo.qtd).toBe(1);
                expect(r.totais.hoje).toEqual({ qtd: 1, valor: 5 });
                expect(r.amostraHoje.map((b) => b.ditCod)).toEqual([2]);
            });

            it('amostraHoje tem no máximo 4 linhas', () => {
                const muitas = Array.from({ length: 6 }, (_, i) =>
                    linha({ ditCod: i + 1, vencimento: HOJE, situacao: 'CANDIDATO' }),
                );
                const r = paginacao.paginar(muitas, base);
                expect(r.amostraHoje).toHaveLength(4);
                expect(r.totais.hoje.qtd).toBe(6);
            });

            it('sem `hoje` não há faixa nem urgente', () => {
                const r = paginacao.paginar(V, { pagina: 1, tamanho: 20, faixas: ['HOJE'] });
                expect(r.total).toBe(7);
                expect(r.totais.urgentes.qtd).toBe(0);
            });
        });

        describe('filtros de coluna', () => {
            it('situações múltiplas', () => {
                const r = paginacao.paginar(TODAS, {
                    ...base,
                    situacoes: ['CANDIDATO', 'AMBIGUO'],
                });
                expect(r.boletos.map((b) => b.ditCod)).toEqual([1, 2]);
            });

            it('valor mínimo e máximo, inclusivos', () => {
                const r = paginacao.paginar(TODAS, { ...base, valorMin: 611.86, valorMax: 1412 });
                expect(r.boletos.map((b) => b.ditCod)).toEqual([2, 3]);
                expect(r.totais.todas.qtd).toBe(2);
            });

            it('número do boleto e título (credor ou doc/tit)', () => {
                expect(
                    paginacao
                        .paginar(TODAS, { ...base, numero: '1532' })
                        .boletos.map((b) => b.ditCod),
                ).toEqual([1]);
                expect(
                    paginacao
                        .paginar(TODAS, { ...base, titulo: 'adp' })
                        .boletos.map((b) => b.ditCod),
                ).toEqual([1]);
                expect(
                    paginacao
                        .paginar(TODAS, { ...base, titulo: '9823/1' })
                        .boletos.map((b) => b.ditCod),
                ).toEqual([3]);
            });

            it('banco emissor, com faceta', () => {
                const B = [
                    linha({ ditCod: 1, bancoEmissor: '341' }),
                    linha({ ditCod: 2, bancoEmissor: '237' }),
                    linha({ ditCod: 3, bancoEmissor: '341' }),
                    linha({ ditCod: 4 }),
                ];
                const r = paginacao.paginar(B, { ...base, bancos: ['341'] });
                expect(r.boletos.map((b) => b.ditCod)).toEqual([1, 3]);
                expect(r.facetas.bancos).toEqual([
                    { valor: '237', qtd: 1 },
                    { valor: '341', qtd: 2 },
                ]);
            });
        });

        describe('ordenação no servidor', () => {
            const O = [
                linha({ ditCod: 1, valor: 30, vencimento: '2026-11-02', numero: 'b' }),
                linha({ ditCod: 2, valor: 10, numero: 'c' }),
                linha({ ditCod: 3, valor: 20, vencimento: '2026-11-01', numero: 'a' }),
                linha({ ditCod: 4, valor: 10, vencimento: '2026-11-03' }),
            ];
            const ordem = (coluna: 'valor' | 'vencimento' | 'numero', direcao: 1 | -1) =>
                paginacao
                    .paginar(O, { ...base, ordem: { coluna, direcao } })
                    .boletos.map((b) => b.ditCod);

            it('sem ordem, mantém a ordem de entrada (a do repositório)', () => {
                expect(paginacao.paginar(O, base).boletos.map((b) => b.ditCod)).toEqual([
                    1, 2, 3, 4,
                ]);
            });

            it('valor asc/desc é estável no empate', () => {
                expect(ordem('valor', 1)).toEqual([2, 4, 3, 1]);
                expect(ordem('valor', -1)).toEqual([1, 3, 2, 4]);
            });

            it('vazio vai para o fim nas duas direções', () => {
                expect(ordem('vencimento', 1)).toEqual([3, 1, 4, 2]);
                expect(ordem('vencimento', -1)).toEqual([4, 1, 3, 2]);
                expect(ordem('numero', 1)).toEqual([3, 1, 2, 4]);
            });

            it('situação na ordem vinculado, candidato, ambíguo, sem título', () => {
                const r = paginacao.paginar(TODAS, {
                    ...base,
                    ordem: { coluna: 'situacao', direcao: 1 },
                });
                expect(r.boletos.map((b) => b.situacao)).toEqual([
                    'VINCULADO',
                    'CANDIDATO',
                    'AMBIGUO',
                    'SEM_TITULO',
                ]);
            });
        });
    });
});

describe('PaginacaoBoletoDda — situações do pool limpo', () => {
    const SAIU = linha({ ditCod: 10, situacao: 'TITULO_SAIU_CARTEIRA' });
    const FORA = linha({ ditCod: 11, situacao: 'FORA_JANELA' });
    const POOL = [ADP, LIVRE, FORA, SAIU];

    it('"Todas" esconde TITULO_SAIU_CARTEIRA, mas a contagem dele aparece', () => {
        const r = paginacao.paginar(POOL, { pagina: 1, tamanho: 20 });
        expect(r.total).toBe(3);
        expect(r.boletos.map((b) => b.ditCod)).toEqual([1, 4, 11]);
        expect(r.contagem).toMatchObject({
            todas: 3,
            FORA_JANELA: 1,
            TITULO_SAIU_CARTEIRA: 1,
            SEM_TITULO: 1,
        });
    });

    it('o filtro próprio devolve os que saíram da carteira', () => {
        const r = paginacao.paginar(POOL, {
            situacao: 'TITULO_SAIU_CARTEIRA',
            pagina: 1,
            tamanho: 20,
        });
        expect(r.boletos.map((b) => b.ditCod)).toEqual([10]);
        expect(r.total).toBe(1);
    });
});

describe('PaginacaoBoletoDda — totais do pool limpo', () => {
    it('os que saíram da carteira têm total próprio e ficam fora de todas/urgentes', () => {
        const r = paginacao.paginar(
            [
                linha({ ditCod: 1, valor: 10, situacao: 'FORA_JANELA' }),
                linha({ ditCod: 2, valor: 20, situacao: 'TITULO_SAIU_CARTEIRA' }),
            ],
            { pagina: 1, tamanho: 20 },
        );
        expect(r.totais.todas).toMatchObject({ qtd: 1, valor: 10 });
        expect(r.totais.FORA_JANELA).toMatchObject({ qtd: 1, valor: 10 });
        expect(r.totais.TITULO_SAIU_CARTEIRA).toMatchObject({ qtd: 1, valor: 20 });
    });

    it('situacoes[] com TITULO_SAIU_CARTEIRA também a mostra', () => {
        const r = paginacao.paginar([linha({ ditCod: 2, situacao: 'TITULO_SAIU_CARTEIRA' })], {
            situacoes: ['TITULO_SAIU_CARTEIRA'],
            pagina: 1,
            tamanho: 20,
        });
        expect(r.total).toBe(1);
    });
});
