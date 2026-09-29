import 'reflect-metadata';
import RemessaCnabValidator, { MOTIVO_J_INVALIDO } from './RemessaCnabValidator.js';

/**
 * Códigos de barras SINTÉTICOS, com DV calculado. Nenhum dado de fornecedor real entra aqui —
 * um barcode identifica beneficiário, valor e vencimento (ver card `security-2`).
 * Layout: banco(3) moeda(1) DV(1) fator(4) valor(10) campo-livre(25) = 44.
 */
const BARRAS_OK = '34199100000005720681234567890123456789012345'; // R$ 5.720,68
const BARRAS_VALOR_ZERO = '34194100000000000001234567890123456789012345';
/** Mesmo número, DV trocado de 9 para 8 — é o defeito achado num `.REM` real de produção. */
const BARRAS_DV_ERRADO = '34198100000005720681234567890123456789012345';

/** Monta um registro de detalhe CNAB 240 com o segmento e o conteúdo nas posições certas. */
const linha = (segmento: string, barras = '', subtipo = ''): string => {
    const buf = ' '.repeat(240).split('');
    '3410001300001'.split('').forEach((c, i) => {
        buf[i] = c;
    });
    buf[13] = segmento; // pos 14
    const corpo = subtipo !== '' ? subtipo + barras : barras;
    corpo.split('').forEach((c, i) => {
        buf[17 + i] = c; // pos 18+
    });
    return buf.join('');
};

const header = `${'3'.repeat(70)}${' '.repeat(170)}`;
const make = (): RemessaCnabValidator => new RemessaCnabValidator();

describe('RemessaCnabValidator', () => {
    describe('dígito verificador do código de barras (módulo 11)', () => {
        it('aceita um código íntegro', () => {
            expect(make().dvBarrasValido(BARRAS_OK)).toBe(true);
        });

        it('recusa o mesmo código com o DV trocado', () => {
            expect(make().dvBarrasValido(BARRAS_DV_ERRADO)).toBe(false);
        });

        it('recusa qualquer coisa que não sejam 44 dígitos', () => {
            const v = make();
            expect(v.dvBarrasValido('')).toBe(false);
            expect(v.dvBarrasValido('341991000000057206812345678901234567890123')).toBe(false); // 42
            expect(v.dvBarrasValido(`3419910000000572068123456789012345678901234X`)).toBe(false);
        });
    });

    describe('varredura do arquivo', () => {
        it('arquivo íntegro: nenhum inválido', () => {
            const conteudo = [header, linha('J', BARRAS_OK), linha('J', '', '52')].join('\n');
            const r = make().validar(conteudo);
            expect(r.segmentosJ).toBe(1);
            expect(r.segmentosJ52).toBe(1);
            expect(r.invalidos).toEqual([]);
        });

        it('o J-52 NÃO é contado como segmento J sem barras', () => {
            // Foi exatamente este o falso positivo da primeira medição: cada boleto emite dois
            // registros com 'J' na pos 14, e contar os dois fez 50% do arquivo parecer vazio.
            const conteudo = [linha('J', BARRAS_OK), linha('J', '', '52')].join('\n');
            const r = make().validar(conteudo);
            expect(r.segmentosJ).toBe(1);
            expect(r.segmentosJ52).toBe(1);
            expect(r.invalidos).toHaveLength(0);
        });

        it('barras EM BRANCO → BARRAS_AUSENTE (o bug que a ADR-0040 corrigiu)', () => {
            const r = make().validar(linha('J', ' '.repeat(44)));
            expect(r.invalidos).toHaveLength(1);
            expect(r.invalidos[0].motivo).toBe(MOTIVO_J_INVALIDO.BARRAS_AUSENTE);
        });

        it('barras ZERADA → BARRAS_AUSENTE', () => {
            const r = make().validar(linha('J', '0'.repeat(44)));
            expect(r.invalidos[0].motivo).toBe(MOTIVO_J_INVALIDO.BARRAS_AUSENTE);
        });

        it('barras truncada ou com letra → BARRAS_MALFORMADA', () => {
            const curta = make().validar(linha('J', `${'1'.repeat(40)}    `));
            expect(curta.invalidos[0].motivo).toBe(MOTIVO_J_INVALIDO.BARRAS_MALFORMADA);
            const comLetra = make().validar(linha('J', `${BARRAS_OK.slice(0, 43)}X`));
            expect(comLetra.invalidos[0].motivo).toBe(MOTIVO_J_INVALIDO.BARRAS_MALFORMADA);
        });

        it('44 dígitos com DV que não fecha → DV_INVALIDO', () => {
            const r = make().validar(linha('J', BARRAS_DV_ERRADO));
            expect(r.invalidos).toHaveLength(1);
            expect(r.invalidos[0].motivo).toBe(MOTIVO_J_INVALIDO.DV_INVALIDO);
        });

        it('reporta a LINHA do arquivo, que é o que o operador procura no .REM', () => {
            const conteudo = [header, header, linha('J', BARRAS_DV_ERRADO)].join('\n');
            expect(make().validar(conteudo).invalidos[0].linha).toBe(3);
        });

        it('nunca devolve o código de barras completo — só mascarado', () => {
            const r = make().validar(linha('J', BARRAS_DV_ERRADO));
            const mascara = r.invalidos[0].barrasMascarada;
            expect(mascara).not.toBe(BARRAS_DV_ERRADO);
            expect(mascara).toContain('x');
            expect(mascara.startsWith('3419')).toBe(true);
        });

        it('valor zerado nas barras AVISA mas não bloqueia (boleto aberto é legítimo)', () => {
            const r = make().validar(linha('J', BARRAS_VALOR_ZERO));
            expect(r.invalidos).toEqual([]);
            expect(r.avisos).toHaveLength(1);
            expect(r.avisos[0]).toContain('valor zerado');
        });

        it('segmento A (crédito/TED) é contado e ignorado — não tem barras', () => {
            const r = make().validar(linha('A'));
            expect(r.segmentosA).toBe(1);
            expect(r.invalidos).toEqual([]);
        });

        it('segmento O (tributo) é contado e NÃO validado — regra de DV é outra', () => {
            // Arrecadação usa 48 posições e outra regra; validar com a do boleto daria falso
            // positivo. Gap consciente, documentado no validador.
            const r = make().validar(linha('O', '8'.repeat(44)));
            expect(r.segmentosO).toBe(1);
            expect(r.invalidos).toEqual([]);
        });

        it('lote só de TED passa (0 segmentos J não é erro)', () => {
            const r = make().validar([linha('A'), linha('A')].join('\n'));
            expect(r.segmentosJ).toBe(0);
            expect(r.invalidos).toEqual([]);
        });

        it('acha múltiplos inválidos no mesmo arquivo', () => {
            const conteudo = [
                linha('J', BARRAS_OK),
                linha('J', BARRAS_DV_ERRADO),
                linha('J', ' '.repeat(44)),
            ].join('\n');
            const r = make().validar(conteudo);
            expect(r.segmentosJ).toBe(3);
            expect(r.invalidos.map((i) => i.motivo)).toEqual([
                MOTIVO_J_INVALIDO.DV_INVALIDO,
                MOTIVO_J_INVALIDO.BARRAS_AUSENTE,
            ]);
        });
    });

    it('decodifica o valor embutido no código de barras', () => {
        expect(make().valorDasBarras(BARRAS_OK)).toBe(5720.68);
    });
});

describe('RemessaCnabValidator — segmento B e forma de lançamento (ADR-0054, só AVISO)', () => {
    /** Header de lote CNAB 240: registro '1' na pos 8, forma de lançamento nas pos 12–13. */
    const headerLote = (forma: string, lote = '0001'): string => {
        const buf = ' '.repeat(240).split('');
        `341${lote}1C20${forma}040`.split('').forEach((c, i) => {
            buf[i] = c;
        });
        return buf.join('');
    };
    /** Registro de detalhe de um lote específico (o `linha` global é sempre do lote 0001). */
    const detalhe = (segmento: string, lote = '0001'): string => {
        const buf = linha(segmento).split('');
        lote.split('').forEach((c, i) => {
            buf[3 + i] = c;
        });
        return buf.join('');
    };

    it('conta segmentos B por lote e lê a forma de lançamento do header', () => {
        const conteudo = [
            headerLote('41', '0001'),
            detalhe('A', '0001'),
            detalhe('B', '0001'),
            headerLote('01', '0002'),
            detalhe('A', '0002'),
            detalhe('B', '0002'),
            detalhe('A', '0002'),
            detalhe('B', '0002'),
        ].join('\n');
        const r = make().validar(conteudo);
        expect(r.segmentosB).toBe(3);
        expect(r.lotes).toEqual([
            { lote: '0001', formaLancamento: '41', segmentosA: 1, segmentosB: 1 },
            { lote: '0002', formaLancamento: '01', segmentosA: 2, segmentosB: 2 },
        ]);
        expect(r.invalidos).toEqual([]);
    });

    it('códigos hipotéticos de TED/PIX (41/43/45) viram AVISO, nunca erro', () => {
        for (const forma of ['41', '43', '45']) {
            const r = make().validar([headerLote(forma), detalhe('A'), detalhe('B')].join('\n'));
            expect(r.invalidos).toEqual([]);
            expect(r.avisos.some((a) => a.startsWith('FORMA_A_CONFIRMAR'))).toBe(true);
        }
    });

    it('segmento A de TED/PIX sem segmento B → aviso', () => {
        const r = make().validar([headerLote('45'), detalhe('A')].join('\n'));
        expect(r.invalidos).toEqual([]);
        expect(r.avisos.some((a) => a.startsWith('SEGMENTO_B_AUSENTE'))).toBe(true);
    });

    it('caso 8: PIX esperado sem nenhum lote de forma PIX → FORMA_DIVERGENTE_A_CONFIRMAR (aviso)', () => {
        // Um PIX que saísse como crédito em conta (forma 01). Vira RemessaCorrompidaError só
        // depois do teste supervisionado confirmar o código real (checklist, passo 12).
        const r = make().validar([headerLote('01'), detalhe('A'), detalhe('B')].join('\n'), {
            pix: 1,
            ted: 0,
        });
        expect(r.invalidos).toEqual([]);
        expect(r.avisos.some((a) => a.startsWith('FORMA_DIVERGENTE_A_CONFIRMAR'))).toBe(true);
    });

    it('TED esperado sem lote de forma TED → mesmo aviso; com lote 41, nada divergente', () => {
        const sem = make().validar([headerLote('01'), detalhe('A'), detalhe('B')].join('\n'), {
            pix: 0,
            ted: 1,
        });
        expect(sem.avisos.some((a) => a.startsWith('FORMA_DIVERGENTE_A_CONFIRMAR'))).toBe(true);
        const com = make().validar([headerLote('41'), detalhe('A'), detalhe('B')].join('\n'), {
            pix: 0,
            ted: 1,
        });
        expect(com.avisos.some((a) => a.startsWith('FORMA_DIVERGENTE_A_CONFIRMAR'))).toBe(false);
    });

    it('fixture de boleto/crédito de antes: sem avisos novos', () => {
        const r = make().validar(
            [headerLote('01'), detalhe('A'), detalhe('B'), headerLote('31', '0002')].join('\n'),
        );
        expect(r.avisos).toEqual([]);
        expect(make().validar(linha('J', BARRAS_OK)).avisos).toEqual([]);
    });

    it('relatório só com códigos e contagens — nada do conteúdo do registro', () => {
        const comDado = detalhe('B').split('');
        '12345678909'.split('').forEach((c, i) => {
            comDado[20 + i] = c;
        });
        const r = make().validar([headerLote('45'), detalhe('A'), comDado.join('')].join('\n'));
        expect(JSON.stringify(r)).not.toContain('12345678909');
    });
});
