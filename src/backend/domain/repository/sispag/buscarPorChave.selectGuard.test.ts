import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * Guarda estrutural das duas releituras pontuais da sugestão de boleto (ADR-0068, TEST-1):
 * `TituloAPagarRepository.buscarPorChave` e `BoletoDdaRepository.buscarPorChave`.
 *
 * Os testes de repositório com `selectFirst` mockado devolvem a linha que o próprio teste escreveu,
 * então um SELECT que esquece uma coluna que o mapper lê (ou uma coluna nova no schema da linha que
 * ninguém selecionou) passa verde e o campo some em silêncio em produção. Aqui o SELECT é lido do
 * FONTE e comparado, sem banco, com (a) as chaves do tipo de linha e (b) o que o mapper acessa.
 * O comportamento contra o Postgres de verdade está nos `*.integration.test.ts` (`test:sql`).
 */

const ler = (arquivo: string): string => readFileSync(path.join(__dirname, arquivo), 'utf8');

/** Divide por vírgulas de nível 0 (ignora as de dentro de parênteses, como `to_char(x, 'fmt')`). */
const dividirColunas = (lista: string): string[] => {
    const partes: string[] = [];
    let profundidade = 0;
    let atual = '';
    for (const ch of lista) {
        if (ch === '(') profundidade += 1;
        if (ch === ')') profundidade -= 1;
        if (ch === ',' && profundidade === 0) {
            partes.push(atual);
            atual = '';
        } else {
            atual += ch;
        }
    }
    partes.push(atual);
    return partes.map((p) => p.replace(/\s+/g, ' ').trim()).filter((p) => p !== '');
};

/** Nome que a coluna tem na linha devolvida: o alias de `AS`, ou o nome sem prefixo de tabela. */
const nomeNaLinha = (coluna: string): string => {
    const alias = coluna.match(/\sAS\s+(\w+)$/i);
    if (alias?.[1]) return alias[1];
    return coluna.replace(/^\w+\./, '');
};

const selectDe = (fonte: string, metodo: string, de: RegExp): string[] => {
    const inicio = fonte.indexOf(`public ${metodo} = async`);
    expect(inicio).toBeGreaterThan(-1);
    const corpo = fonte.slice(inicio);
    const m = corpo.match(new RegExp(`SELECT\\s+([\\s\\S]*?)\\s+FROM\\s+${de.source}`, 'i'));
    expect(m).not.toBeNull();
    return dividirColunas(m?.[1] ?? '').map(nomeNaLinha);
};

const chavesDaInterface = (fonte: string, nome: string): string[] => {
    const m = fonte.match(new RegExp(`interface ${nome} \\{([\\s\\S]*?)\\n\\}`));
    expect(m).not.toBeNull();
    return [...(m?.[1] ?? '').matchAll(/^\s+(\w+)\??:/gm)].map((x) => x[1] as string);
};

/** Campos da linha que o mapper (`r.<campo>`) lê. */
const camposLidosPeloMapper = (fonte: string, assinatura: RegExp): string[] => {
    const m = assinatura.exec(fonte);
    expect(m).not.toBeNull();
    const corpo = fonte.slice(m?.index ?? 0);
    const fim = corpo.search(/\n {4}\}\)?;/);
    const trecho = corpo.slice(0, fim === -1 ? undefined : fim);
    return [...new Set([...trecho.matchAll(/\br\.(\w+)/g)].map((x) => x[1] as string))];
};

const ordenado = (xs: string[]): string[] => [...xs].sort();

describe('TituloAPagarRepository.buscarPorChave — SELECT × linha × mapper', () => {
    const fonte = ler('TituloAPagarRepository.ts');
    const select = selectDe(fonte, 'buscarPorChave', /titulo_a_pagar/);

    it('seleciona exatamente as colunas do tipo da linha (mais `ativo`)', () => {
        expect(ordenado(select)).toEqual(
            ordenado([...chavesDaInterface(fonte, 'TituloRow'), 'ativo']),
        );
    });

    it('toda coluna que o mapper lê está no SELECT, inclusive as três da sugestão', () => {
        const lidas = camposLidosPeloMapper(fonte, /private map = \(r: TituloRow\)/);
        expect(lidas.length).toBeGreaterThan(10);
        for (const campo of lidas) expect(select).toContain(campo);
        for (const campo of ['doc_esp_numero', 'forma_pagamento_conexos', 'tem_boleto', 'ativo']) {
            expect(select).toContain(campo);
        }
    });

    it('a guarda enxerga uma coluna esquecida (o próprio parser, sobre um SELECT sem doc_esp_numero)', () => {
        const sem = select.filter((c) => c !== 'doc_esp_numero');
        expect(ordenado(sem)).not.toEqual(
            ordenado([...chavesDaInterface(fonte, 'TituloRow'), 'ativo']),
        );
    });
});

describe('BoletoDdaRepository.buscarPorChave — SELECT × linha × mapper', () => {
    const fonte = ler('BoletoDdaRepository.ts');
    const select = selectDe(fonte, 'buscarPorChave', /boleto_dda\s+b/);
    const selectLista = selectDe(fonte, 'listBoletos', /boleto_dda\s+b/);

    it('seleciona exatamente as colunas do tipo da linha', () => {
        expect(ordenado(select)).toEqual(ordenado(chavesDaInterface(fonte, 'BoletoRow')));
    });

    it('toda coluna que o mapper lê está no SELECT', () => {
        const lidas = camposLidosPeloMapper(fonte, /private map = \(r: BoletoRow\)/);
        expect(lidas.length).toBeGreaterThan(8);
        for (const campo of lidas) expect(select).toContain(campo);
    });

    it('a releitura pontual e a listagem selecionam as mesmas colunas', () => {
        expect(ordenado(select)).toEqual(ordenado(selectLista));
    });
});
