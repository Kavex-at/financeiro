import 'reflect-metadata';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

/**
 * CONTRACT TEST — o ERP ainda devolve os campos de que Permutas depende?
 * (card `testability-1` do Regis-Review 2026-08-28-1608)
 *
 * ## O incidente que motivou este arquivo
 *
 * A aba "Invoices em aberto" exibiu invoices já liquidadas por 62 dias (introduzido em
 * `634eef0`, 2026-06-24; relatado pela analista em 2026-08-25). O código derivava `pago` da
 * row do `com298/list`, que devolve `mnyTitAberto: null` em 1146/1146 INVOICEs.
 *
 * Existia teste de regressão para a MESMA classe de defeito no lado adiantamento desde
 * 2026-06-18 — e ele não pegou o lado invoice, porque todos os 269 mocks de Permutas eram
 * digitados à mão e desenhavam a row com os campos PREENCHIDOS. O mock concordava com o
 * autor do código, não com o ERP. Nenhum teste podia falhar.
 *
 * Estes fixtures foram capturados AO VIVO da produção (`jobs/capture-fixtures-permutas.ts`,
 * read-only) com os valores redigidos por tipo — as CHAVES e os `null` são os que o ERP
 * devolveu de verdade.
 *
 * QUANDO ESTE TESTE FICAR VERMELHO: não "conserte" o fixture. Recapture, compare o diff e
 * decida o que o código precisa mudar. O fixture é a evidência, não a expectativa.
 *
 * Limite honesto: a redação preserva chaves, tipos e nulidade — não valores. Semântica
 * (ex.: "o que significa `pago: 2` no com308?") continua sendo trabalho do validador ao
 * vivo (`jobs/validate-invoice-pago-detalhe-v1.ts`).
 */
const DIR = __dirname;

const carregar = (sufixo: string): Record<string, unknown> => {
    const arquivo = readdirSync(DIR).find((f) => f.endsWith(`${sufixo}.json`));
    if (!arquivo) throw new Error(`fixture ausente: *${sufixo}.json — rode o capture job`);
    const bruto = JSON.parse(readFileSync(path.join(DIR, arquivo), 'utf-8'));
    return bruto.linha as Record<string, unknown>;
};

/** Campos que o código LÊ. Cada entrada aqui é uma dependência real, não documentação. */
const CONTRATOS: Array<{
    fixture: string;
    consumidor: string;
    campos: string[];
    /** Campos que o código poderia tentar ler e que o ERP comprovadamente NÃO manda aqui. */
    ausentesConhecidos?: string[];
    /**
     * Campos que o ERP MANDA mas sempre como `null` neste grid — o código NÃO pode confiar
     * neles. Se algum dia forem populados, este teste fica vermelho de propósito: aí vale
     * decidir se dá para simplificar o caminho que hoje existe só para contornar o null.
     */
    nulosConhecidos?: string[];
}> = [
    {
        fixture: 'com298-invoice',
        consumidor: 'ConexosFinanceiroClient.listInvoicesFinalizadas → EleicaoPermutasService',
        campos: [
            'docCod',
            'priCod',
            'filCod',
            'vldStatus',
            'docDtaEmissao',
            'docMnyValor',
            'docEspNumero',
            'priEspRefcliente',
            'dpeNomPessoa',
            'tpdCod',
        ],
        // ESTE É O BUG, CONGELADO. O grid não traz saldo nenhum: `isPago(row)` devolvia
        // `false` para as 1146 INVOICEs da filial 2, o filtro `WHERE NOT pago` da aba virava
        // no-op e invoices liquidadas apareciam. Desde 2026-08-28 o `pago` vem do com308.
        nulosConhecidos: ['mnyTitAberto', 'mnyTitPago', 'mnyTitValor', 'mnyTitPermutar'],
        // `pago` sequer é chave da row — `isPago` cai no `return false` final.
        ausentesConhecidos: ['pago'],
    },
    {
        fixture: 'com298-proforma',
        consumidor: 'ConexosFinanceiroClient.listAdiantamentosProforma (lado-débito)',
        campos: ['docCod', 'priCod', 'filCod', 'vldStatus', 'docDtaEmissao', 'docMnyValor'],
        // Mesma armadilha do lado adiantamento — foi aqui que ela foi medida primeiro
        // (probe 2026-06-18, 411 PROFORMAs) e corrigida via `getDetalheTitulos` (01b99bf).
        nulosConhecidos: ['mnyTitAberto', 'mnyTitPago', 'mnyTitValor', 'mnyTitPermutar'],
        ausentesConhecidos: ['pago'],
    },
    {
        fixture: 'com308-titulo-invoice',
        consumidor: 'ConexosTitulosClient.listTitulosAPagar → derivarPagoDosTitulos',
        // `titMnyValor` + `titMnyTotPago` são a fonte do `pago` da invoice desde 2026-08-28
        // (`Σ face − Σ pago === 0`). Se o ERP deixar de mandar `titMnyTotPago`, é AQUI que
        // ficamos sabendo — em vez de a analista descobrir pela aba, dois meses depois.
        // `titFltTaxaMneg`/`titMnyValorMneg` alimentam a variação cambial no MESMO payload:
        // é a razão de o fix custar zero chamadas novas.
        campos: [
            'titCod',
            'titMnyValor',
            'titMnyTotPago',
            'titFltTaxaMneg',
            'titMnyValorMneg',
            'moeCodMneg',
            'moeEspNome',
            'titVldStatus',
        ],
    },
    {
        fixture: 'com298-detalhe-invoice',
        consumidor: 'ConexosTitulosClient.getDetalheTitulos (Gate 3 + ground truth)',
        // O contraste que define a arquitetura desta frente: os MESMOS campos que vêm null
        // no grid existem, populados, no detalhe. É o ground truth do validador ao vivo.
        campos: ['mnyTitValor', 'mnyTitAberto', 'mnyTitPago', 'mnyTitPermutar', 'mnyTitPermuta'],
    },
    {
        fixture: 'imp021-processo',
        consumidor: 'ConexosCadastroClient.listProcessos (importador/cliente da invoice)',
        campos: ['priCod', 'pesCod'],
    },
];

describe('contrato com o Conexos — Permutas (fixtures reais, redigidas)', () => {
    for (const { fixture, consumidor, campos, ausentesConhecidos, nulosConhecidos } of CONTRATOS) {
        describe(fixture, () => {
            it(`ainda devolve os campos lidos por ${consumidor}`, () => {
                const linha = carregar(fixture);
                const ausentes = campos.filter((c) => !(c in linha));
                expect(ausentes).toEqual([]);
            });

            it('os campos conhecidamente ausentes continuam ausentes', () => {
                const linha = carregar(fixture);
                const apareceram = (ausentesConhecidos ?? []).filter((c) => c in linha);
                expect(apareceram).toEqual([]);
            });

            it('os campos conhecidamente NULOS continuam nulos (não passe a confiar neles)', () => {
                // Vermelho aqui é NOTÍCIA BOA: o ERP passou a popular o campo. Antes de
                // simplificar o código que existe para contornar o null, confirme com uma
                // amostra grande (o `probe-invoice-pago` mede a filial inteira) — um único
                // documento populado não prova que os 1146 estão.
                const linha = carregar(fixture);
                const populados = (nulosConhecidos ?? []).filter(
                    (c) => c in linha && linha[c] !== null,
                );
                expect(populados).toEqual([]);
            });

            it('a fixture está redigida — nenhum valor de string real vazou', () => {
                // Guarda contra alguém recapturar sem redação e commitar nome de exportador,
                // importador e CNPJ da Columbia no repositório.
                const linha = carregar(fixture);
                const stringsCruas = Object.entries(linha).filter(
                    ([, v]) => typeof v === 'string' && !v.startsWith('<'),
                );
                expect(stringsCruas).toEqual([]);
            });
        });
    }

    it('todo fixture no diretório está coberto por um contrato', () => {
        // Um fixture capturado e esquecido não vale nada.
        const arquivos = readdirSync(DIR)
            .filter((f) => f.endsWith('.json'))
            .map((f) => f.replace(/^\d{4}-\d{2}-\d{2}-/, '').replace(/\.json$/, ''));
        const cobertos = new Set(CONTRATOS.map((c) => c.fixture));
        expect(arquivos.filter((a) => !cobertos.has(a))).toEqual([]);
    });
});
