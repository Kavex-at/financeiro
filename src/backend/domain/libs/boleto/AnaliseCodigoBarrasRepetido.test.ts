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
