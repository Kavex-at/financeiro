import 'reflect-metadata';
import RemessaCnabValidator, {
    GUARDA_VALOR_J,
    MODO_GUARDA_VALOR_J,
    MOTIVO_J_INVALIDO,
} from './RemessaCnabValidator.js';

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

    describe('barras repetidas entre segmentos J (ADR-0069, I16b)', () => {
        const OUTRA = '34191100000005720681234567890123456789012399';
        const comDvOk = (b: string): string => {
            // Recalcula o DV geral para a barra sintética ficar válida.
            const semDv = b.slice(0, 4) + b.slice(5);
            let soma = 0;
            let peso = 2;
            for (let i = semDv.length - 1; i >= 0; i -= 1) {
                soma += Number(semDv[i]) * peso;
                peso = peso === 9 ? 2 : peso + 1;
            }
            const dv = 11 - (soma % 11);
            return `${b.slice(0, 4)}${dv === 0 || dv === 10 || dv === 11 ? 1 : dv}${b.slice(5)}`;
        };
        const BARRAS_B = comDvOk(OUTRA);

        it('dois J com as mesmas barras → 1 grupo com as linhas e a barra mascarada', () => {
            const conteudo = [
                header,
                linha('J', BARRAS_OK),
                linha('J', BARRAS_B),
                linha('J', BARRAS_OK),
            ].join('\n');
            const r = make().validar(conteudo);
            expect(r.invalidos).toEqual([]);
            expect(r.repetidos).toEqual([
                {
                    barrasMascarada: `${BARRAS_OK.slice(0, 5)}…${BARRAS_OK.slice(-4)}`,
                    linhas: [2, 4],
                },
            ]);
        });

        it('J-52 que repete a identificação NÃO conta', () => {
            const conteudo = [
                linha('J', BARRAS_OK),
                linha('J', '', '52'),
                linha('J', BARRAS_B),
                linha('J', '', '52'),
            ].join('\n');
            expect(make().validar(conteudo).repetidos).toEqual([]);
        });

        it('segmentos A/B/O iguais não contam', () => {
            const conteudo = [
                linha('A', BARRAS_OK),
                linha('A', BARRAS_OK),
                linha('O', BARRAS_OK),
            ].join('\n');
            expect(make().validar(conteudo).repetidos).toEqual([]);
        });

        it('J com barras inválidas fica em invalidos, não vira repetido', () => {
            const conteudo = [linha('J', BARRAS_DV_ERRADO), linha('J', BARRAS_DV_ERRADO)].join(
                '\n',
            );
            const r = make().validar(conteudo);
            expect(r.invalidos).toHaveLength(2);
            expect(r.repetidos).toEqual([]);
        });

        it('repetidos é sempre um array e nada carrega as barras completas', () => {
            expect(make().validar(linha('J', BARRAS_OK)).repetidos).toEqual([]);
            const r = make().validar([linha('J', BARRAS_OK), linha('J', BARRAS_OK)].join('\n'));
            expect(JSON.stringify(r.repetidos)).not.toContain(BARRAS_OK);
            expect(JSON.stringify(r)).not.toContain(BARRAS_OK);
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

/**
 * Segmento J no layout dos `.REM` HML PG191074/PG191075 (FEBRABAN/Itaú SISPAG 240): barras 18–61,
 * vencimento 92–99, valor do título 100–114, desconto 115–129, mora 130–144, data de pagamento
 * 145–152, valor do pagamento 153–167. Valores em centavos, 15 dígitos.
 */
const segmentoJ = (p: {
    barras: string;
    tituloCentavos: number;
    descontoCentavos?: number;
    moraCentavos?: number;
    pagamentoCentavos?: number | 'branco';
}): string => {
    const buf = linha('J', p.barras).split('');
    const poe = (ini: number, valor: string) => {
        valor.split('').forEach((c, i) => {
            buf[ini - 1 + i] = c;
        });
    };
    const n15 = (v: number) => String(v).padStart(15, '0');
    poe(62, 'FAVORECIDO SINTETICO'.padEnd(30, ' '));
    poe(92, '30102026');
    poe(100, n15(p.tituloCentavos));
    poe(115, n15(p.descontoCentavos ?? 0));
    poe(130, n15(p.moraCentavos ?? 0));
    poe(145, '30102026');
    if (p.pagamentoCentavos !== 'branco') {
        poe(153, n15(p.pagamentoCentavos ?? p.tituloCentavos));
    }
    return buf.join('');
};

/** Barra sintética com valor `centavos` e DV geral válido. */
const barrasComValor = (centavos: number): string => {
    const b = `3419${'1'}0000${String(centavos).padStart(10, '0')}1234567890123456789012345`;
    const semDv = b.slice(0, 4) + b.slice(5);
    let soma = 0;
    let peso = 2;
    for (let i = semDv.length - 1; i >= 0; i -= 1) {
        soma += Number(semDv[i]) * peso;
        peso = peso === 9 ? 2 : peso + 1;
    }
    const dv = 11 - (soma % 11);
    return `${b.slice(0, 4)}${dv === 0 || dv === 10 || dv === 11 ? 1 : dv}${b.slice(5)}`;
};

describe('I17m — barra == pagamento do J (ADR-0073)', () => {
    const B46250 = barrasComValor(46250);

    it('a guarda nasce BLOQUEIA (fail-closed, M8)', () => {
        expect(GUARDA_VALOR_J.BLOQUEIA).toBe('BLOQUEIA');
        expect(GUARDA_VALOR_J.AVISA).toBe('AVISA');
        expect(MODO_GUARDA_VALOR_J).toBe(GUARDA_VALOR_J.BLOQUEIA);
    });

    it('HML PG191074: barra 53,54 · título 53,53 · mora 0,01 · pagamento 53,54 ⇒ ok', () => {
        const b = barrasComValor(5354);
        const r = make().validar(
            segmentoJ({
                barras: b,
                tituloCentavos: 5353,
                moraCentavos: 1,
                pagamentoCentavos: 5354,
            }),
        );
        expect(r.invalidos).toEqual([]);
        expect(r.divergenciasValor).toEqual([]);
    });

    it('HML PG191075: barra 178,77 · título 178,78 · desconto 0,01 · pagamento 178,77 ⇒ ok', () => {
        const b = barrasComValor(17877);
        const r = make().validar(
            segmentoJ({
                barras: b,
                tituloCentavos: 17878,
                descontoCentavos: 1,
                pagamentoCentavos: 17877,
            }),
        );
        expect(r.divergenciasValor).toEqual([]);
    });

    it('barra 462,50 e pagamento 462,50 ⇒ ok; pagamento 462,49 ⇒ divergência mascarada', () => {
        expect(
            make().validar(segmentoJ({ barras: B46250, tituloCentavos: 46250 })).divergenciasValor,
        ).toEqual([]);
        const r = make().validar(
            [header, segmentoJ({ barras: B46250, tituloCentavos: 46249 })].join('\n'),
        );
        expect(r.divergenciasValor).toEqual([
            {
                linha: 2,
                barrasMascarada: `${B46250.slice(0, 5)}…${B46250.slice(-4)}`,
                valorBarraCentavos: 46250,
                pagamentoCentavos: 46249,
            },
        ]);
        expect(JSON.stringify(r)).not.toMatch(/\d{44}/);
    });

    it('barra com valor zerado (boleto de valor aberto) fica FORA da guarda', () => {
        const r = make().validar(
            segmentoJ({
                barras: BARRAS_VALOR_ZERO,
                tituloCentavos: 10000,
                pagamentoCentavos: 10000,
            }),
        );
        expect(r.divergenciasValor).toEqual([]);
    });

    it('pagamento ilegível (em branco) num J com barra > 0 ⇒ divergência (fail-closed)', () => {
        const r = make().validar(
            segmentoJ({ barras: B46250, tituloCentavos: 46250, pagamentoCentavos: 'branco' }),
        );
        expect(r.divergenciasValor).toHaveLength(1);
        expect(r.divergenciasValor[0]?.pagamentoCentavos).toBeUndefined();
    });

    it('J-52 e J inválido não entram na guarda de valor', () => {
        const r = make().validar([linha('J', '', '52'), linha('J', BARRAS_DV_ERRADO)].join('\n'));
        expect(r.divergenciasValor).toEqual([]);
    });
});
