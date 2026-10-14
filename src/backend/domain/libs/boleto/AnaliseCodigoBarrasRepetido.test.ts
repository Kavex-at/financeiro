import 'reflect-metadata';
import AnaliseCodigoBarrasRepetido from './AnaliseCodigoBarrasRepetido.js';
import CodigoBarrasBoleto from './CodigoBarrasBoleto.js';

const cb = new CodigoBarrasBoleto();
const analise = new AnaliseCodigoBarrasRepetido(cb);

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

/** Barras SINTÉTICAS de 44 dígitos com DV geral válido; nunca um código real. */
const barras = (livre: string, valorCentavos = 141200, banco = '341'): string => {
    const valor = String(valorCentavos).padStart(10, '0');
    const semDv = `${banco}9${'1580'}${valor}${livre}`;
    return `${banco}9${dvGeral(semDv)}1580${valor}${livre}`;
};

const BARRAS_A = barras('1090047729099260408340000');
const BARRAS_B = barras('1090047730099260408340000');
const LINHA_A = cb.paraLinhaDigitavel(BARRAS_A) as string;
const LINHA_B = cb.paraLinhaDigitavel(BARRAS_B) as string;

describe('AnaliseCodigoBarrasRepetido', () => {
    it('as fixtures são válidas e distintas', () => {
        expect(BARRAS_A).toHaveLength(44);
        expect(LINHA_A).toHaveLength(47);
        expect(BARRAS_A).not.toBe(BARRAS_B);
    });

    it('caso PEDRONI: 10 itens, 2 códigos, 5+5 => 2 grupos de 5, ordem estável', () => {
        const itens = Array.from({ length: 10 }, (_, i) => ({
            chave: `${1000 + i}:1`,
            codigo: i % 2 === 0 ? LINHA_A : LINHA_B,
        }));
        const r = analise.analisar(itens);
        expect(r.ilegiveis).toEqual([]);
        expect(r.grupos).toHaveLength(2);
        expect(r.grupos[0].barras44).toBe(BARRAS_A);
        expect(r.grupos[0].chaves).toEqual(['1000:1', '1002:1', '1004:1', '1006:1', '1008:1']);
        expect(r.grupos[1].barras44).toBe(BARRAS_B);
        expect(r.grupos[1].chaves).toEqual(['1001:1', '1003:1', '1005:1', '1007:1', '1009:1']);
    });

    it('todos distintos => sem grupos', () => {
        const r = analise.analisar([
            { chave: '1:1', codigo: LINHA_A },
            { chave: '2:1', codigo: LINHA_B },
        ]);
        expect(r).toEqual({ grupos: [], ilegiveis: [] });
    });

    it('1 item => sem grupos', () => {
        expect(analise.analisar([{ chave: '1:1', codigo: LINHA_A }]).grupos).toEqual([]);
    });

    it('lista vazia => resultado vazio', () => {
        expect(analise.analisar([])).toEqual({ grupos: [], ilegiveis: [] });
    });

    it('normaliza espaços e pontos da linha digitável', () => {
        const formatada = `${LINHA_A.slice(0, 5)}.${LINHA_A.slice(5, 10)} ${LINHA_A.slice(10)}`;
        const r = analise.analisar([
            { chave: '1:1', codigo: formatada },
            { chave: '2:1', codigo: LINHA_A },
        ]);
        expect(r.grupos).toHaveLength(1);
        expect(r.grupos[0].chaves).toEqual(['1:1', '2:1']);
    });

    it('linha de 47 e barras de 44 do mesmo boleto agrupam', () => {
        const r = analise.analisar([
            { chave: '1:1', codigo: LINHA_A },
            { chave: '2:1', codigo: BARRAS_A },
        ]);
        expect(r.grupos).toHaveLength(1);
        expect(r.grupos[0].barras44).toBe(BARRAS_A);
    });

    it('código inválido vai para ilegiveis e não entra em grupo', () => {
        const dvCampoRuim = `${LINHA_A.slice(0, 9)}${(Number(LINHA_A[9]) + 1) % 10}${LINHA_A.slice(10)}`;
        const dvGeralRuim = `${BARRAS_A.slice(0, 4)}${(Number(BARRAS_A[4]) % 9) + 1}${BARRAS_A.slice(5)}`;
        const r = analise.analisar([
            { chave: 'a:1', codigo: dvCampoRuim },
            { chave: 'b:1', codigo: dvGeralRuim },
            { chave: 'c:1', codigo: LINHA_A.slice(0, 40) },
            { chave: 'd:1', codigo: `${LINHA_A.slice(0, 46)}X` },
            { chave: 'e:1', codigo: `8${'1'.repeat(43)}` },
            { chave: 'f:1', codigo: LINHA_A },
            { chave: 'g:1', codigo: LINHA_A },
        ]);
        expect(r.ilegiveis).toEqual(['a:1', 'b:1', 'c:1', 'd:1', 'e:1']);
        expect(r.grupos).toHaveLength(1);
        expect(r.grupos[0].chaves).toEqual(['f:1', 'g:1']);
    });

    it('mascara 5 primeiros + 4 últimos, sem janela de 10+ dígitos do original', () => {
        const m = analise.mascarar(BARRAS_A);
        expect(m).toBe(`${BARRAS_A.slice(0, 5)}…${BARRAS_A.slice(-4)}`);
        expect(m).not.toContain(BARRAS_A);
        for (let i = 0; i + 10 <= BARRAS_A.length; i += 1) {
            expect(m).not.toContain(BARRAS_A.slice(i, i + 10));
        }
        const r = analise.analisar([
            { chave: '1:1', codigo: LINHA_A },
            { chave: '2:1', codigo: LINHA_A },
        ]);
        expect(r.grupos[0].mascarado).toBe(m);
    });
});

describe('AnaliseCodigoBarrasRepetido.decidirRetirada (I16d.1, I16d.2)', () => {
    const DIA = 86_400_000;
    const BASE = Date.UTC(2026, 9, 20);
    const item = (
        docCod: string,
        o: { filCod?: number; titCod?: string; venc?: number | null; codigo?: string } = {},
    ) => ({
        chave: `${o.filCod ?? 1}:${docCod}:${o.titCod ?? '1'}`,
        codigo: o.codigo ?? LINHA_A,
        filCod: o.filCod ?? 1,
        docCod,
        titCod: o.titCod ?? '1',
        ...(o.venc === null ? {} : { vencimento: o.venc ?? BASE }),
    });

    it('3 itens, mesmo código, vencimentos distintos: fica o de menor vencimento', () => {
        const r = analise.decidirRetirada([
            item('100', { venc: BASE + 2 * DIA }),
            item('101', { venc: BASE }),
            item('102', { venc: BASE + DIA }),
        ]);
        expect(r.retirar.map((x) => x.chave).sort()).toEqual(['1:100:1', '1:102:1']);
        for (const x of r.retirar) {
            expect(x.mantida).toBe('1:101:1');
            expect(x.motivo).toBe('CODIGO_BARRAS_REPETIDO');
            expect(x.mascarado).toBe(`${BARRAS_A.slice(0, 5)}…${BARRAS_A.slice(-4)}`);
        }
    });

    it('vencimento igual: menor docCod NUMÉRICO (9 < 10), depois filCod, depois titCod', () => {
        const r1 = analise.decidirRetirada([item('10'), item('9')]);
        expect(r1.retirar).toHaveLength(1);
        expect(r1.retirar[0]?.chave).toBe('1:10:1');
        expect(r1.retirar[0]?.mantida).toBe('1:9:1');

        const r2 = analise.decidirRetirada([item('5', { filCod: 2 }), item('5', { filCod: 1 })]);
        expect(r2.retirar[0]?.chave).toBe('2:5:1');

        const r3 = analise.decidirRetirada([
            item('5', { titCod: '2' }),
            item('5', { titCod: '1' }),
        ]);
        expect(r3.retirar[0]?.chave).toBe('1:5:2');
    });

    it('vencimento ausente perde o desempate (Q6)', () => {
        const r = analise.decidirRetirada([item('1', { venc: null }), item('2', { venc: BASE })]);
        expect(r.retirar[0]?.chave).toBe('1:1:1');
        expect(r.retirar[0]?.mantida).toBe('1:2:1');
    });

    it('dois grupos independentes retiram 1 de cada; quem fica nunca aparece em retirar', () => {
        const r = analise.decidirRetirada([
            item('1', { codigo: LINHA_A }),
            item('2', { codigo: LINHA_A }),
            item('3', { codigo: LINHA_B }),
            item('4', { codigo: LINHA_B }),
            item('5', { codigo: LINHA_B }),
        ]);
        expect(r.retirar).toHaveLength(3);
        const mantidas = new Set(r.retirar.map((x) => x.mantida));
        for (const x of r.retirar) expect(mantidas.has(x.chave)).toBe(false);
        expect([...mantidas].sort()).toEqual(['1:1:1', '1:3:1']);
    });

    describe('desempate por decisão humana vigente (ADR-0071, I17h)', () => {
        it('exatamente UM título do grupo com decisão humana: ele fica, mesmo com vencimento maior', () => {
            const r = analise.decidirRetirada(
                [item('100', { venc: BASE + 3 * DIA }), item('101', { venc: BASE })],
                new Set(['1:100:1']),
            );
            expect(r.retirar).toHaveLength(1);
            expect(r.retirar[0]?.chave).toBe('1:101:1');
            expect(r.retirar[0]?.mantida).toBe('1:100:1');
        });

        it('dois preferidos no grupo: vale a ordem de hoje (vencimento → docCod → filCod → titCod)', () => {
            const r = analise.decidirRetirada(
                [
                    item('100', { venc: BASE + DIA }),
                    item('101', { venc: BASE }),
                    item('102', { venc: BASE + 2 * DIA }),
                ],
                new Set(['1:100:1', '1:102:1']),
            );
            expect(r.retirar.map((x) => x.chave).sort()).toEqual(['1:100:1', '1:102:1']);
            expect(r.retirar[0]?.mantida).toBe('1:101:1');
        });

        it('zero preferidos no grupo: ordem de hoje (a decisão de OUTRO grupo não interfere)', () => {
            const r = analise.decidirRetirada(
                [
                    item('1', { codigo: LINHA_A, venc: BASE + DIA }),
                    item('2', { codigo: LINHA_A, venc: BASE }),
                    item('3', { codigo: LINHA_B }),
                ],
                new Set(['1:3:1']),
            );
            expect(r.retirar).toHaveLength(1);
            expect(r.retirar[0]?.chave).toBe('1:1:1');
        });

        it('a análise continua pura e o conjunto vazio equivale a não passar nada', () => {
            const entrada = [item('100', { venc: BASE + 3 * DIA }), item('101', { venc: BASE })];
            expect(analise.decidirRetirada(entrada, new Set())).toEqual(
                analise.decidirRetirada(entrada),
            );
        });
    });

    it('ilegível (DV inválido) vai para ilegiveis sem "quem fica"', () => {
        const dvRuim = `${LINHA_A.slice(0, 9)}${(Number(LINHA_A[9]) + 1) % 10}${LINHA_A.slice(10)}`;
        const r = analise.decidirRetirada([item('1', { codigo: dvRuim }), item('2')]);
        expect(r.retirar).toEqual([]);
        expect(r.ilegiveis).toEqual([{ chave: '1:1:1', motivo: 'CODIGO_BARRAS_ILEGIVEL' }]);
    });

    it('a saída pública não carrega as 44 barras nem a linha de 47', () => {
        const r = analise.decidirRetirada([item('1'), item('2')]);
        const json = JSON.stringify(r);
        expect(json).not.toContain(BARRAS_A);
        expect(json).not.toContain(LINHA_A);
        expect(json).toContain('…');
    });

    it('sem repetição nem ilegível: nada a retirar', () => {
        const r = analise.decidirRetirada([
            item('1', { codigo: LINHA_A }),
            item('2', { codigo: LINHA_B }),
        ]);
        expect(r).toEqual({ retirar: [], ilegiveis: [] });
    });
});
