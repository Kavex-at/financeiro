import 'reflect-metadata';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

/**
 * CONTRACT TEST — o ERP ainda devolve os campos de que dependemos? (card `integrability-1`)
 *
 * Os testes do SISPAG usam shapes digitados à mão pelo autor do código. Isso verifica que a
 * NOSSA lógica é coerente consigo mesma, e nada mais: se o Conexos renomear `titMnyValor` ou
 * parar de mandar `pesCod`, todo mock continua verde e a quebra aparece no botão da analista.
 *
 * Estes fixtures foram capturados AO VIVO da produção (`jobs/capture-fixtures-sispag.ts`,
 * read-only) e têm os valores redigidos por tipo — as CHAVES são as que o ERP devolveu de
 * verdade. O teste afirma que os campos que o código lê continuam presentes.
 *
 * QUANDO ESTE TESTE FICAR VERMELHO: não "conserte" o fixture. Recapture, compare o diff e
 * decida o que o código precisa mudar. O fixture é a evidência, não a expectativa.
 *
 * Limite honesto: a redação preserva chaves e tipos, não valores. Um campo que passe a vir
 * sempre nulo com o mesmo tipo NÃO é detectado aqui — `null` é preservado justamente por
 * isso, mas um nullable intermitente escapa. Para semântica, o gate é a validação ao vivo.
 */
const DIR = __dirname;

const carregar = (sufixo: string): Record<string, unknown> => {
    const arquivo = readdirSync(DIR).find((f) => f.endsWith(`${sufixo}.json`));
    if (!arquivo) throw new Error(`fixture ausente: *${sufixo}.json — rode o capture job`);
    const bruto = JSON.parse(readFileSync(path.join(DIR, arquivo), 'utf-8'));
    return bruto.linha as Record<string, unknown>;
};

/** Fixtures que NÃO são linha de grid — envelopes de protocolo, com shape próprio. */
const carregarEnvelope = (sufixo: string): Record<string, unknown> => {
    const arquivo = readdirSync(DIR).find((f) => f.endsWith(`${sufixo}.json`));
    if (!arquivo) throw new Error(`fixture ausente: *${sufixo}.json`);
    return JSON.parse(readFileSync(path.join(DIR, arquivo), 'utf-8'));
};

/** Envelopes de protocolo cobertos (não entram em CONTRATOS — não têm `linha`). */
const ENVELOPES = ['fin015-question-barcode'];

/** Campos que o código LÊ. Cada entrada aqui é uma dependência real, não documentação. */
const CONTRATOS: Array<{
    fixture: string;
    consumidor: string;
    campos: string[];
    /** Campos que o código tenta ler e que o ERP comprovadamente NÃO manda neste grid. */
    ausentesConhecidos?: string[];
}> = [
    {
        fixture: 'fin015-titulo-pendente',
        consumidor: 'RemessaService.montarItensImport + ConexosSispagWriteClient',
        // A identidade vai VERBATIM para o `importar`: errar qualquer um destes
        // devolve `Not Found: FinTituloPag`.
        campos: [
            'filCod',
            'docCod',
            'titCod',
            'titMnyValor',
            'titDtaVencimento',
            'pesCod',
            'titVldReflexoDdaAssoc',
            'titVldReflexoDdaDesassoc',
        ],
        // Achado por este teste na primeira execução: o cliente lê `itsVldModalidade`
        // da linha de pendentes, mas o grid não traz esse campo — a leitura é morta e o
        // valor real vem do NOSSO item de lote (`MODALIDADE_NATIVA[item.modalidade]`).
        // Fica registrado aqui: se o ERP algum dia PASSAR a mandar, o teste avisa, e aí
        // vale decidir se a modalidade do ERP deve prevalecer sobre a nossa.
        ausentesConhecidos: ['itsVldModalidade'],
    },
    {
        fixture: 'fin015-lote',
        consumidor: 'ConexosSispagClient.listLotes + validate-fin015-remessa',
        // `flpDtaCredito` é o que a regra R2 compara com o vencimento dos itens.
        campos: ['filCod', 'bncCod', 'flpCod', 'flpDtaCredito', 'flpVldStatus'],
    },
    {
        fixture: 'fin005-conta-pagadora',
        consumidor: 'ConexosSispagClient.listContasCorrentes (conta que paga)',
        campos: ['bncCod', 'ccoCod', 'ccoNumConta', 'ccoEspDvconta', 'ccoEspAgcod'],
    },
    {
        fixture: 'fin050-evento-bancario',
        consumidor: 'ConexosSispagRetornoClient.listEventosBancarios',
        // `fbeVldTpret` é o que separa pagamento (1) de rejeição (2). Perder este
        // campo faria toda rejeição virar pagamento na conciliação.
        campos: ['fbeEspCod', 'fbeEspDescricao', 'fbeVldTpret'],
    },
    {
        fixture: 'ger015-config-retorno',
        consumidor: 'ConexosSispagRetornoClient.listConfigsRetorno',
        // Sem o par (bncCod, gtbCodSeq) o `arquivosRetorno/list` responde 400.
        campos: ['bncCod', 'gtbCodSeq'],
    },
    {
        fixture: 'fin015-item-lote',
        consumidor:
            'ConexosSispagWriteClient.listarChavesDoLote (retomada de import parcial) + ' +
            'listarLinhasDigitaveisDoLote (linha digitável do boleto no painel)',
        // A chave do item decide o que ainda falta importar. `filCod` entra nela porque
        // `docCod` NÃO é único entre filiais — foi o bug corrigido no commit 9c73d1a.
        //
        // `itsNumCodbar` é a LINHA DIGITÁVEL que o ERP anexa ao item no import com DDA
        // (ADR-0040) — 47 dígitos, o que a analista cola no banco. Sem esta entrada, um
        // rename do Conexos faria o `LINHA_DIGITAVEL_SCHEMA` reprovar toda linha, o cliente
        // devolver `[]`, e o botão de copiar sumir da tela SEM nada acusar. Asserimos a
        // presença da CHAVE: na fixture ela vem `null`, porque o título capturado não tinha
        // boleto — o valor varia, a existência do campo não pode.
        campos: ['filCod', 'docCod', 'titCod', 'itsCodSeq', 'flpCod', 'itsNumCodbar'],
    },
    {
        fixture: 'fin052-arquivo-retorno',
        consumidor: 'ConexosSispagRetornoClient.getArquivoRetorno (retomada da conciliação)',
        // `garTimProc` é o carimbo que responde "o processar já rodou?". Sem ele a retomada
        // da conciliação não tem como distinguir "já processei" de "não sei" — e repetir o
        // `processar` grava baixa em cima de baixa no fin010.
        campos: ['filCod', 'bncCod', 'gtbCodSeq', 'garCodSeq', 'garTimProc', 'garVldProcStatus'],
    },
    {
        fixture: 'fin052-detalhe-retorno',
        consumidor: 'ConexosSispagRetornoClient.listDetalhe (conciliação item a item)',
        // `fbeVldTipo` + o código do evento separam PAGO de REJEITADO. Perder isso faria
        // toda rejeição virar pagamento silenciosamente.
        campos: [
            'filCod',
            'bncCod',
            'gtbCodSeq',
            'garCodSeq',
            'flpCod',
            'itsCodSeq',
            'docCod',
            'titCod',
            'fbeEspCod',
            'fbeVldTipo',
            'borCod',
            'bxaCodSeq',
            'gerNum',
        ],
    },
    {
        fixture: 'cmn025-conta-favorecido',
        consumidor: 'ConexosSispagClient.listContasFavorecido (destino do pagamento)',
        // `pctVldStatus` decide se a conta é utilizável — é o filtro que determina se um
        // título é sequer importável. `pctCodSeq` é o que o FinItemSispag referencia.
        campos: [
            'pesCod',
            'pctCodSeq',
            'pctNumBanco',
            'pctEspNumAgencia',
            'pctEspNumContaBanc',
            'pctVldStatus',
            'pctVldDefault',
        ],
    },
    {
        fixture: 'fin064-titulo-a-pagar',
        consumidor: 'ConexosSispagClient.listTitulosAPagar (carteira do painel)',
        campos: ['filCod', 'docCod', 'titCod', 'titDtaVencimento', 'titMnyValor'],
    },
];

describe('contrato com o Conexos (fixtures reais, redigidas)', () => {
    for (const { fixture, consumidor, campos, ausentesConhecidos } of CONTRATOS) {
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

            it('a fixture está redigida — nenhum valor de string real vazou', () => {
                // Guarda contra alguém recapturar sem redação e commitar CNPJ e conta
                // bancária de fornecedor no repositório.
                const linha = carregar(fixture);
                const stringsCruas = Object.entries(linha).filter(
                    ([, v]) => typeof v === 'string' && !v.startsWith('<'),
                );
                expect(stringsCruas).toEqual([]);
            });
        });
    }

    describe('fin015-question-barcode (envelope de PERGUNTA do ERP)', () => {
        // Este envelope não veio de documentação: foi descoberto por engenharia reversa
        // (7 encodings testados até o erro de deserialização do Java vazar o tipo).
        // Sem esta fixture, os testes do cliente afirmam contra um shape que eles mesmos
        // inventam — e um rename no Conexos passa verde até o banco recusar a remessa.
        it('mantém o shape que a auto-resposta depende', () => {
            const f = carregarEnvelope('fin015-question-barcode');
            const env = f.envelope as {
                type?: string;
                questions?: Array<{ id?: string; key?: string; answerList?: unknown[] }>;
            };
            expect(env.type).toBe('QUESTION');
            expect(Array.isArray(env.questions)).toBe(true);
            const q = env.questions?.[0];
            // `id` é a CHAVE do map de resposta. Sem ele não há como responder — o cliente
            // recusa a auto-resposta e sobe como pergunta humana.
            expect(typeof q?.id).toBe('string');
            expect(q?.key).toBe('FIN_041.EXISTE_CODIGO_BARRAS_ASSOCIADO_TITULO');
            expect(Array.isArray(q?.answerList)).toBe(true);
        });

        it('o answerList continua oferecendo YES', () => {
            const f = carregarEnvelope('fin015-question-barcode');
            const q = (f.envelope as { questions: Array<{ answerList: Array<{ id?: string }> }> })
                .questions[0];
            expect(q.answerList.map((a) => a.id)).toContain('YES');
        });

        it('a resposta é um MAP chaveado pelo id — não array, não pelo key', () => {
            // Regressão do achado central: `answers` é `Map<String,String>` no DTO Java.
            // Mandar array devolve `Cannot deserialize LinkedHashMap<String,String>`.
            const f = carregarEnvelope('fin015-question-barcode');
            const resp = f._resposta as { answers: Record<string, string> };
            expect(Array.isArray(resp.answers)).toBe(false);
            const q = (f.envelope as { questions: Array<{ id: string; key: string }> })
                .questions[0];
            expect(resp.answers[q.id]).toBe('YES');
            // chaveado pelo `id`, NÃO pelo `key`
            expect(resp.answers[q.key]).toBeUndefined();
        });
    });

    it('todo fixture no diretório está coberto por um contrato', () => {
        // Um fixture capturado e esquecido não vale nada. Se alguém adicionar um JSON
        // sem entrada em CONTRATOS, este teste avisa em vez de deixar passar.
        const arquivos = readdirSync(DIR)
            .filter((f) => f.endsWith('.json'))
            .map((f) => f.replace(/^\d{4}-\d{2}-\d{2}-/, '').replace(/\.json$/, ''));
        const cobertos = new Set([...CONTRATOS.map((c) => c.fixture), ...ENVELOPES]);
        expect(arquivos.filter((a) => !cobertos.has(a))).toEqual([]);
    });
});
