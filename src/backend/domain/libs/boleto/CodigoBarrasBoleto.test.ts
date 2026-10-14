import 'reflect-metadata';
import CodigoBarrasBoleto from './CodigoBarrasBoleto.js';

const cb = new CodigoBarrasBoleto();

describe('CodigoBarrasBoleto', () => {
    it('converte o exemplo publicado pela FEBRABAN (Banco do Brasil)', () => {
        expect(cb.paraLinhaDigitavel('00193373700000001000500940144816060680935031')).toBe(
            '00190500954014481606906809350314337370000000100',
        );
    });

    it('preserva fator de vencimento e valor no campo 5 (boleto real do fin124, ADP)', () => {
        const linha = cb.paraLinhaDigitavel('34193158000004815331090113433700004286589000');
        expect(linha).toHaveLength(47);
        expect(linha?.slice(0, 3)).toBe('341');
        // campo 4 = DV geral (5º dígito das barras); campo 5 = fator 1580 + R$ 4.815,33
        expect(linha?.slice(32, 33)).toBe('3');
        expect(linha?.slice(33)).toBe('15800000481533');
    });

    it('extrai o banco emissor', () => {
        expect(cb.bancoEmissor('42292157900001412007137000087483170003296912')).toBe('422');
    });

    it.each([
        ['vazio', undefined],
        ['curto', '3419315800000481533'],
        ['com letra', '3419315800000481533109011343370000428658900X'],
        ['arrecadação (começa com 8)', '84670000001435900240200240500024384221010811'],
    ])('recusa código inválido: %s', (_caso, codbar) => {
        expect(cb.paraLinhaDigitavel(codbar)).toBeUndefined();
        expect(cb.bancoEmissor(codbar)).toBeUndefined();
    });
});

/**
 * Barras SINTÉTICAS no formato real (44 dígitos, fator de vencimento e DV geral módulo 11
 * válidos), montadas pelo layout do campo livre — nenhum código de barras real mora aqui.
 */
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

const barras = (banco: string, livre: string, fator = '1580', valorCentavos = 481533): string => {
    expect(livre).toHaveLength(25);
    const valor = String(valorCentavos).padStart(10, '0');
    const semDv = `${banco}9${fator}${valor}${livre}`;
    return `${banco}9${dvGeral(semDv)}${fator}${valor}${livre}`;
};

/** Itaú: carteira(3) nosso(8) DAC(1) agência(4) conta(5) DAC(1) '000'. */
const itau = (agencia: string, conta: string, nosso = '00477290'): string =>
    barras('341', `109${nosso}9${agencia}${conta}0000`);

/** Bradesco: agência(4) carteira(2) nosso(11) conta(7) '0'. */
const bradesco = (agencia: string, conta: string, nosso = '00000007128'): string =>
    barras('237', `${agencia}09${nosso}${conta}0`);

describe('CodigoBarrasBoleto.emissor', () => {
    it('Bradesco 237: agência(4) + conta(7) do campo livre, com a máscara I14l', () => {
        expect(cb.emissor(bradesco('2656', '0092740'))).toEqual({
            banco: '237',
            layout: 'BRADESCO_237',
            chave: '237:2656:0092740',
            mascarado: '237 / 2656 / ***2740',
        });
    });

    it('237: outra conta do mesmo credor gera chave DIFERENTE (MULTILOG BRASIL x S/A)', () => {
        const a = cb.emissor(bradesco('2656', '0092740'));
        const b = cb.emissor(bradesco('2656', '0006500'));
        expect(a?.chave).toBe('237:2656:0092740');
        expect(b?.chave).toBe('237:2656:0006500');
    });

    it('Itaú 341: agência(4) + conta(5), ignorando carteira, nosso número e DACs', () => {
        expect(cb.emissor(itau('9260', '40834'))).toEqual({
            banco: '341',
            layout: 'ITAU_341',
            chave: '341:9260:40834',
            mascarado: '341 / 9260 / ***0834',
        });
    });

    it('o nosso número não entra na chave: boletos da mesma conta têm a mesma chave', () => {
        expect(cb.emissor(bradesco('2656', '0092740', '00000007316'))?.chave).toBe(
            cb.emissor(bradesco('2656', '0092740', '00060176257'))?.chave,
        );
        expect(cb.emissor(itau('9260', '40834', '00477291'))?.chave).toBe(
            cb.emissor(itau('9260', '40834', '00477292'))?.chave,
        );
    });

    it.each([
        ['104'],
        ['329'],
        ['422'],
        ['033'],
    ])('banco %s: chave genérica, nunca com selo de layout verificado', (banco) => {
        const e = cb.emissor(barras(banco, '1234567890123456789012345'));
        expect(e?.layout).toBe('GENERICO');
        expect(e?.chave).toBe(`${banco}:12345678`);
        expect(e?.banco).toBe(banco);
        expect(e?.mascarado).toBe(`${banco} / 1234 / ****`);
    });

    it.each([
        ['vazio', undefined],
        ['string vazia', ''],
        ['curto', '3419315800000481533'],
        ['longo', `${itau('9260', '40834')}0`],
        ['não numérico', `${itau('9260', '40834').slice(0, 43)}X`],
        ['arrecadação (começa com 8)', '84670000001435900240200240500024384221010811'],
    ])('devolve undefined sem lançar: %s', (_caso, codbar) => {
        expect(() => cb.emissor(codbar)).not.toThrow();
        expect(cb.emissor(codbar)).toBeUndefined();
    });

    it('nenhuma saída contém as 44 dígitos nem a linha digitável (I15k)', () => {
        for (const codbar of [bradesco('2656', '0092740'), itau('9260', '40834')]) {
            const saida = JSON.stringify(cb.emissor(codbar));
            expect(saida).not.toContain(codbar);
            expect(saida).not.toContain(cb.paraLinhaDigitavel(codbar) ?? 'x');
            expect(saida).not.toMatch(/\d{20,}/);
        }
    });

    it('as barras de teste têm 44 dígitos e DV geral válido (fixture no formato real)', () => {
        const codbar = bradesco('2656', '0092740');
        expect(codbar).toHaveLength(44);
        expect(codbar[4]).toBe(dvGeral(codbar.slice(0, 4) + codbar.slice(5)));
        expect(cb.paraLinhaDigitavel(codbar)).toHaveLength(47);
    });
});

describe('CodigoBarrasBoleto.mascarar', () => {
    it('só banco e os 4 últimos dígitos; nunca as barras', () => {
        const codbar = bradesco('2656', '0092740');
        const m = cb.mascarar(codbar);
        expect(m).toBe(`237…${codbar.slice(-4)}`);
        expect(m).not.toMatch(/\d{20,}/);
    });

    it('código inválido ou de arrecadação → undefined', () => {
        expect(cb.mascarar('123')).toBeUndefined();
        expect(cb.mascarar(undefined)).toBeUndefined();
        expect(cb.mascarar(`8${'1'.repeat(43)}`)).toBeUndefined();
    });
});

describe('CodigoBarrasBoleto.paraBarras', () => {
    it('ida e volta 44 → 47 → 44 é idêntica', () => {
        for (const codbar of [bradesco('2656', '0092740'), itau('9260', '40834')]) {
            const linha = cb.paraLinhaDigitavel(codbar);
            expect(cb.paraBarras(linha)).toBe(codbar);
        }
    });

    it('44 válido passa; DV geral errado => undefined', () => {
        const codbar = itau('9260', '40834');
        expect(cb.paraBarras(codbar)).toBe(codbar);
        const ruim = `${codbar.slice(0, 4)}${(Number(codbar[4]) % 9) + 1}${codbar.slice(5)}`;
        expect(cb.paraBarras(ruim)).toBeUndefined();
    });

    it('DV de campo errado => undefined', () => {
        const linha = cb.paraLinhaDigitavel(itau('9260', '40834')) as string;
        const ruim = `${linha.slice(0, 9)}${(Number(linha[9]) + 1) % 10}${linha.slice(10)}`;
        expect(cb.paraBarras(ruim)).toBeUndefined();
    });

    it.each([
        ['prefixo 8 (47)', `8${'1'.repeat(46)}`],
        ['prefixo 8 (44)', `8${'1'.repeat(43)}`],
        ['tamanho errado', '123'],
        ['letras', `${'1'.repeat(46)}X`],
        ['vazio', ''],
    ])('inválido: %s', (_caso, codigo) => {
        expect(cb.paraBarras(codigo)).toBeUndefined();
    });
});
