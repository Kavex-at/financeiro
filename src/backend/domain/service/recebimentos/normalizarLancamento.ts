import { createHash } from 'node:crypto';
import type { LancamentoExtrato } from '../../client/ConexosExtratoClient.js';
import {
    EXTRATO_MOEDA_PADRAO,
    TRANSACAO_BANCARIA_STATUS,
    TRANSACAO_TIPO,
} from '../../interface/recebimentos/constants.js';
import type { TransacaoBancaria } from '../../interface/recebimentos/TransacaoBancaria.js';

/**
 * Normalização PURA de um lançamento do `fin095` para `TransacaoBancaria`.
 *
 * Sem DI, sem I/O — de propósito. É a lógica com mais ramos do Módulo 1 e o floor
 * de cobertura de `domain/service/` se paga muito mais barato com funções puras
 * do que com um serviço cheio de mocks.
 */

/**
 * Chave natural de deduplicação. O par (`extCod`, `exiCodSeq`) identifica o
 * lançamento dentro do extrato; `filCod`+`gerNum` dão o escopo da conta.
 *
 * ⚠️ NUNCA inclua campos mutáveis (`vldConciliado`, `dtaConc`, valor): o ERP
 * atualiza esses ao conciliar, e a mesma linha reingeriria como transação nova,
 * duplicando a carteira do analista.
 */
export const buildNaturalKey = (l: LancamentoExtrato): string =>
    `fin095:${l.filCod}:${l.gerNum}:${l.extCod}:${l.exiCodSeq}`;

/**
 * Id determinístico derivado da chave natural.
 *
 * O `save` original gera um id novo a cada chamada, mas o `ON CONFLICT` não
 * atualiza a coluna `id` — na segunda ingestão o objeto em memória carregaria um
 * id que NÃO existe na tabela. Derivar da chave natural faz insert e update
 * convergirem. Formatado como UUID porque o id vira path param no frontend e
 * `:`/`/` da chave natural não sobrevivem à URL.
 */
export const buildTransacaoId = (naturalKey: string): string => {
    const h = createHash('sha256').update(naturalKey).digest('hex');
    return [h.slice(0, 8), h.slice(8, 12), h.slice(12, 16), h.slice(16, 20), h.slice(20, 32)].join(
        '-',
    );
};

/**
 * Correlation id determinístico e POR TRANSAÇÃO (não por run).
 *
 * O correlationId rastreia UM crédito de ponta a ponta (extrato → conciliação →
 * baixa → NDe). Se todas as transações de uma run compartilhassem o id da run, o
 * rastro perderia a função — e o índice `idx_transacao_bancaria_correlation`
 * (0032) já sinaliza que a granularidade pretendida é por transação. O id da run
 * vive em `recebimento_ingestao_run.correlation_id`.
 */
export const buildCorrelationId = (naturalKey: string): string =>
    buildTransacaoId(`correlation:${naturalKey}`);

/**
 * Prefixos de canal bancário que antecedem o nome da contraparte no histórico.
 *
 * Descobertos medindo 1.759 créditos reais da filial 1 em 90 dias. Os dois
 * formatos que carregam nome de cliente:
 *   `SISPAG  INOX-TECH`                      → SISPAG + nome
 *   `TED 745.0001.BROWN-FORMA`               → TED + banco.agência. + nome
 *   `TED-CRÉDITO - 2016003 - 341 641 ...`    → TED-CRÉDITO + doc + conta
 */
const PREFIXOS_CANAL = [
    'SISPAG',
    'TED-CRÉDITO',
    'TED-CREDITO',
    'TED CR MESM TIT',
    'TED-CRED CONTA',
    'TED RECEBIDA',
    'TED',
    'PIX TRANSF',
    'PIX',
    'DOC',
    'CRED',
];

/** `TED 745.0001.NOME` / `TED 001.1914.SK` → captura o que vem depois do banco.agência. */
const BANCO_AGENCIA = /^\d{3}\.\d{4}\.?/;

/**
 * Extrai uma dica de contraparte do histórico do extrato.
 *
 * ⚠️ É DICA DE EXIBIÇÃO, não chave. O banco trunca o histórico em ~24 caracteres
 * (`"TED 745.0001.BROWN-FORMA"` — o nome real é BROWN-FORMAN), não há CNPJ nem
 * `pesCod`, e o próprio ERP classifica boa parte como "CRÉDITO DESCONHECIDO".
 * Serve para o painel mostrar algo útil na coluna e para PRÉ-SELECIONAR o cliente
 * no modal — jamais para casar automaticamente crédito com processo.
 *
 * O histórico bruto é preservado em `normalized.historicoBruto`.
 */
export const extrairContraparte = (historico?: string): string | undefined => {
    if (!historico) return undefined;
    let texto = historico.replace(/\s+/g, ' ').trim();
    if (texto === '') return undefined;

    for (const prefixo of PREFIXOS_CANAL) {
        if (texto.toUpperCase().startsWith(prefixo)) {
            texto = texto.slice(prefixo.length).trim();
            break;
        }
    }
    // `- 2016003 - ` e `.` residuais dos formatos TED.
    texto = texto.replace(/^[-.\s]+/, '').trim();
    texto = texto.replace(BANCO_AGENCIA, '').trim();

    return texto === '' ? undefined : texto;
};

/**
 * Mapeia o tipo do lançamento.
 *
 * Só CRÉDITO e DÉBITO. NÃO inferir `TARIFA`/`JUROS`/`ESTORNO` a partir de
 * `exiEspCategoria` ou do texto do histórico: seria heurística sobre texto livre
 * num campo que alimenta o matching, e um erro aqui envenena a conciliação. A
 * categoria crua é persistida e a classificação fina é da Fase 4.
 */
const mapTipo = (l: LancamentoExtrato) =>
    l.tipo === 'CREDITO' ? TRANSACAO_TIPO.CREDITO : TRANSACAO_TIPO.DEBITO;

/**
 * Converte um lançamento do extrato numa `TransacaoBancaria` pronta para o upsert.
 *
 * `status` é SEMPRE `importada`. É tentador mapear o `vldConciliado` do `fin095`
 * para `conciliada`, mas são conciliações diferentes: a do ERP é banco × extrato
 * de sistema; a nossa é crédito × processo do cliente. Confundir as duas faria o
 * painel declarar resolvido o que ninguém alocou. O sinal do ERP vai para
 * `normalized.conciliadoNoErp` — como informação, não como estado.
 */
export const normalizarLancamento = (
    l: LancamentoExtrato,
    ctx: { runId: string; importadoEm: Date },
): TransacaoBancaria => {
    const naturalKey = buildNaturalKey(l);
    const contraparte = extrairContraparte(l.historico);

    return {
        id: buildTransacaoId(naturalKey),
        correlationId: buildCorrelationId(naturalKey),
        filCod: l.filCod,
        dataMovimento: l.dataLancamento,
        tipo: mapTipo(l),
        valor: l.valor,
        moeda: EXTRATO_MOEDA_PADRAO,
        ...(contraparte !== undefined ? { contraparte } : {}),
        ...(l.numeroDocumento !== undefined ? { referenciaBancaria: l.numeroDocumento } : {}),
        naturalKey,
        rawPayload: l.raw,
        normalized: {
            fonte: 'conexos/fin095',
            gerNum: l.gerNum,
            extCod: l.extCod,
            exiCodSeq: l.exiCodSeq,
            historicoBruto: l.historico ?? null,
            linhaBruta: l.linhaBruta ?? null,
            categoria: l.categoria ?? null,
            categoriaDesc: l.categoriaDesc ?? null,
            conciliadoNoErp: l.conciliadoNoErp,
            statusConciliacaoErp: l.statusConciliacaoErp ?? null,
        },
        status: TRANSACAO_BANCARIA_STATUS.IMPORTADA,
        importRunId: ctx.runId,
        importadoEm: ctx.importadoEm,
        gerNum: l.gerNum,
        ...(l.categoria !== undefined ? { categoria: l.categoria } : {}),
        ...(l.categoriaDesc !== undefined ? { categoriaDesc: l.categoriaDesc } : {}),
    };
};
