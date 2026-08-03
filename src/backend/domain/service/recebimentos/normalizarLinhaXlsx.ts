import {
    EXTRATO_MOEDA_PADRAO,
    TRANSACAO_BANCARIA_STATUS,
    TRANSACAO_TIPO,
} from '../../interface/recebimentos/constants.js';
import type { LinhaExtratoArquivo } from '../../interface/recebimentos/ExtratoArquivoParser.js';
import type { TransacaoBancaria } from '../../interface/recebimentos/TransacaoBancaria.js';
import {
    buildCorrelationId,
    buildTransacaoId,
    extrairContraparte,
} from './normalizarLancamento.js';

/** Canal de origem gravado em `transacao_bancaria.canal` — distingue upload manual do fin095. */
export const CANAL_XLSX_BRADESCO = 'xlsx_bradesco';

/** Contexto de conta do arquivo (o `.xlsx` não carrega `filCod`; ele vem da filial escolhida no upload). */
export interface ContextoArquivo {
    filCod: number;
    agencia?: string;
    conta?: string;
    arquivoNome: string;
    runId: string;
    importadoEm: Date;
}

const norm = (value?: string): string =>
    (value ?? '')
        .normalize('NFD')
        .replace(/\p{Diacritic}/gu, '')
        .replace(/\s+/g, ' ')
        .trim()
        .toUpperCase();

const digitos = (value?: string): string => (value ?? '').replace(/\D/g, '');

const dataISO = (data: Date): string => data.toISOString().slice(0, 10);

/** Inteiro em centavos — evita o drift de ponto flutuante na chave natural. */
const valorCentavos = (valor: number): number => Math.round(valor * 100);

/** Campos de conteúdo que formam a tupla de dedup (SEM a ocorrência). */
export interface CamposChaveXlsx {
    filCod: number;
    agencia?: string;
    conta?: string;
    data: Date;
    valor: number;
    descricao: string;
    contraparteDoc?: string;
    contraparteNome?: string;
}

/**
 * Prefixo da chave natural SEM a ocorrência — agrupa linhas idênticas dentro de um arquivo para
 * atribuir o ordinal de ocorrência. Duas linhas com o mesmo `groupKeyXlsx` são candidatas a serem a
 * mesma transação repetida (ou duplicatas legítimas, desambiguadas pela ocorrência).
 */
export const groupKeyXlsx = (p: CamposChaveXlsx): string =>
    [
        'xlsx-bradesco',
        p.filCod,
        digitos(p.agencia),
        digitos(p.conta),
        dataISO(p.data),
        valorCentavos(p.valor),
        norm(p.descricao),
        digitos(p.contraparteDoc),
        norm(p.contraparteNome),
    ].join(':');

/**
 * Chave natural de deduplicação do canal MANUAL (upload .xlsx).
 *
 * Namespaced com `xlsx-bradesco:` para NUNCA colidir com as chaves `fin095:` do canal automático — os
 * dois canais convivem e um mesmo crédito visto pelos dois gera duas linhas (dedup é POR CANAL; a
 * conciliação cross-channel é follow-up P2).
 *
 * O extrato do arquivo não tem ID por transação, então a chave é a tupla de conteúdo + `ocorrencia`
 * (ordinal da mesma tupla dentro do arquivo). Isso preserva dois créditos legitimamente idênticos no
 * mesmo dia (ocorrências 1 e 2 → chaves distintas) e torna o re-upload de período sobreposto
 * idempotente (as mesmas linhas regeneram as mesmas ocorrências → `ON CONFLICT` deduplica).
 */
export const buildNaturalKeyXlsx = (p: CamposChaveXlsx & { ocorrencia: number }): string =>
    `${groupKeyXlsx(p)}:${p.ocorrencia}`;

/**
 * Normaliza UMA linha de crédito do arquivo para `TransacaoBancaria`, pronta para o mesmo
 * `upsertMany` do canal automático. `status` é SEMPRE `importada`; `id`/`correlationId` derivam da
 * chave natural (reuso de `buildTransacaoId`/`buildCorrelationId`), fazendo insert e re-upload
 * convergirem para a mesma linha.
 *
 * Assume `linha.valor > 0` (o serviço já filtrou créditos). O `valor` guardado é positivo.
 */
export const normalizarLinhaXlsx = (
    linha: LinhaExtratoArquivo,
    ctx: ContextoArquivo,
    ocorrencia: number,
): TransacaoBancaria => {
    const naturalKey = buildNaturalKeyXlsx({
        filCod: ctx.filCod,
        agencia: ctx.agencia,
        conta: ctx.conta,
        data: linha.data,
        valor: linha.valor,
        descricao: linha.descricao,
        contraparteDoc: linha.contraparteDoc,
        contraparteNome: linha.contraparteNome,
        ocorrencia,
    });

    // Razão social é a melhor dica; sem ela, cai para a extração do histórico (mesma do fin095).
    const contraparte = linha.contraparteNome?.trim() || extrairContraparte(linha.descricao);

    return {
        id: buildTransacaoId(naturalKey),
        correlationId: buildCorrelationId(naturalKey),
        filCod: ctx.filCod,
        dataMovimento: linha.data,
        tipo: TRANSACAO_TIPO.CREDITO,
        valor: linha.valor,
        moeda: EXTRATO_MOEDA_PADRAO,
        ...(contraparte ? { contraparte } : {}),
        ...(linha.contraparteDoc ? { referenciaBancaria: linha.contraparteDoc } : {}),
        naturalKey,
        rawPayload: linha.raw,
        normalized: {
            fonte: 'upload/xlsx-bradesco',
            canal: CANAL_XLSX_BRADESCO,
            arquivoNome: ctx.arquivoNome,
            agencia: ctx.agencia ?? null,
            conta: ctx.conta ?? null,
            descricao: linha.descricao,
            contraparteNome: linha.contraparteNome ?? null,
            contraparteDoc: linha.contraparteDoc ?? null,
            linhaIndice: linha.linhaIndice,
            ocorrencia,
        },
        status: TRANSACAO_BANCARIA_STATUS.IMPORTADA,
        importRunId: ctx.runId,
        importadoEm: ctx.importadoEm,
        canal: CANAL_XLSX_BRADESCO,
    };
};
