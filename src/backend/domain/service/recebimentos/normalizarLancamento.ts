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
 * lançamento dentro do extrato; `gerNum` dá o escopo da conta.
 *
 * ⚠️ NUNCA inclua campos mutáveis (`vldConciliado`, `dtaConc`, valor): o ERP
 * atualiza esses ao conciliar, e a mesma linha reingeriria como transação nova,
 * duplicando a carteira do analista.
 *
 * ⚠️ NUNCA inclua `filCod` (ADR-0032). O `fin095` filtra por `gerNum` + janela e
 * IGNORA a filial — ela viaja só como header de sessão. Com o `filCod` na chave,
 * o fan-out por filial gravava o MESMO lançamento uma vez por filial: 728 linhas
 * para 104 lançamentos reais em produção, e o KPI "a distribuir" 7× inflado.
 * A filial de um crédito nasce na ALOCAÇÃO (`recebimento.fil_cod`), não aqui.
 */
export const buildNaturalKey = (l: LancamentoExtrato): string =>
    `fin095:${l.gerNum}:${l.extCod}:${l.exiCodSeq}`;

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
 * Resíduos que sobram após o corte do prefixo de canal e que NÃO são nome de
 * contraparte — são o status/modalidade do próprio lançamento.
 *
 * Medido em produção (`fin095`, contas 212/213, ago/2026): `"PIX RECEBIDO"` perdia
 * o `PIX` e virava a contraparte **"RECEBIDO"** na tela do analista, e
 * `"TED-CRED CONTA"` virava `"CONTA"` quando o prefixo casava só o `TED`. Exibir
 * isso é pior que exibir nada: o analista lê "RECEBIDO" como se fosse o pagador.
 */
const RUIDO_STATUS = new Set([
    'RECEBIDO',
    'RECEBIDA',
    'ENVIADO',
    'ENVIADA',
    'CONTA',
    'CRED CONTA',
    'DEB CONTA',
    'CREDITO',
    'DEBITO',
    'CRED',
    'DEB',
    'TRANSF',
    'TRANSFERENCIA',
    'MESM TIT',
    'CR MESM TIT',
]);

/** Sem acento, espaços colapsados, caixa alta — forma canônica de comparação. */
const canonizar = (texto: string): string =>
    texto
        .normalize('NFD')
        .replace(/\p{Diacritic}/gu, '')
        .replace(/\s+/g, ' ')
        .trim()
        .toUpperCase();

/**
 * `REM:` dentro do `exiEspNrdocto` — o campo mistura número de documento e remetente
 * (`"1224537REM: COLUMBIA TRADING S/A  07/0"`). A cauda `07/0` é fragmento de data
 * truncado pelo banco, não parte do nome.
 */
const REMETENTE_NRDOC = /REM\s*:\s*(.+)$/i;
const CAUDA_DATA = /[\s,]*\d{1,2}\/\d{0,2}\s*$/;

/**
 * Extrai o REMETENTE do `exiEspNrdocto` do `fin095`.
 *
 * Diferente do `historico` (truncado em ~24 chars e sem identificação), este campo
 * carrega o nome de quem enviou o PIX/TED quando o banco o informa — é a MELHOR
 * dica de contraparte disponível no canal automático, e é o que revela que um
 * "crédito" é, na verdade, transferência entre contas da própria casa.
 *
 * Continua sendo DICA DE EXIBIÇÃO: não há CNPJ nem `pesCod`, e o banco trunca. Nunca
 * usar como chave de junção com cliente ou processo.
 */
export const extrairRemetente = (numeroDocumento?: string): string | undefined => {
    if (!numeroDocumento) return undefined;
    const m = numeroDocumento.match(REMETENTE_NRDOC);
    if (!m?.[1]) return undefined;
    const nome = m[1].replace(CAUDA_DATA, '').replace(/\s+/g, ' ').trim();
    return nome === '' ? undefined : nome;
};

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

    if (texto === '') return undefined;
    // O que sobrou é o status do lançamento, não um pagador — melhor não exibir nada.
    if (RUIDO_STATUS.has(canonizar(texto))) return undefined;

    return texto;
};

/**
 * Categoria do `fin095` para TED/DOC/PIX entre bancos (`exiEspCategoria = '209'`).
 *
 * NÃO é ruído por si só: recebimento de cliente por PIX/TED cai aqui (medidos na
 * conta 212, ago/2026: PIX de 20k/50k/30k). Só vira ruído quando o REMETENTE é a
 * própria casa — ver `ehTransferenciaInterna`.
 */
export const CATEGORIA_TRANSFERENCIA_INTERBANCARIA = '209';

/**
 * Piso de caracteres para um titular interno valer como filtro.
 *
 * Um token curto na env (`S/A`, ou `COLUMBIA` sem o `TRADING`) casaria com razão
 * social de cliente e sumiria com recebível de verdade em bloco. Abaixo deste piso o
 * titular é IGNORADO — configuração frouxa não deve custar dinheiro invisível.
 */
const TITULAR_MIN_CHARS = 6;

/** Metacaracteres de regex no nome do titular (o `.` de `S.A.`, por exemplo). */
const escaparRegex = (texto: string): string => texto.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Casa o titular como PALAVRA INTEIRA dentro do remetente, não como substring.
 *
 * `includes` puro fazia `COLUMBIA` casar com `COLUMBIANA S/A` — empresa real e
 * distinta, cujo crédito sumiria da carteira sem deixar rastro para o analista.
 */
const casaTitular = (alvo: string, titular: string): boolean => {
    if (titular.length < TITULAR_MIN_CHARS) return false;
    return new RegExp(`(^|[^A-Z0-9])${escaparRegex(titular)}([^A-Z0-9]|$)`).test(alvo);
};

/**
 * Decide se um crédito é TRANSFERÊNCIA ENTRE CONTAS DA PRÓPRIA CASA.
 *
 * Regra (decidida com o analista, 2026-08-10): categoria `209` **e** remetente
 * identificado como um dos titulares internos. O dinheiro sai de uma conta e entra
 * em outra; o `fin095` só é ingerido no lado CRÉDITO, então a perna de débito nunca
 * aparece para fechar o par e o analista lê como "recebi" algo que ele pagou.
 *
 * ⚠️ Sem remetente identificável, devolve `false` DE PROPÓSITO. `TED-CRED CONTA` não
 * diz quem enviou, e esconder um crédito é esconder um recebível: o custo de errar
 * para o lado de ocultar é maior que o de deixar ruído na fila do analista.
 */
export const ehTransferenciaInterna = (
    categoria: string | undefined,
    remetente: string | undefined,
    titularesInternos: readonly string[],
): boolean => {
    if (categoria !== CATEGORIA_TRANSFERENCIA_INTERBANCARIA) return false;
    if (!remetente) return false;
    const alvo = canonizar(remetente);
    return titularesInternos.some((t) => casaTitular(alvo, canonizar(t)));
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
 * NÃO carrega `filCod`: a transação do canal automático nasce CORPORATIVA
 * (ADR-0032). A conta do `fin133` é vista de qualquer filial e o `fin095` devolve
 * os mesmos lançamentos para todas — não há filial a atribuir aqui sem inventá-la.
 *
 * `status` é SEMPRE `importada`. É tentador mapear o `vldConciliado` do `fin095`
 * para `conciliada`, mas são conciliações diferentes: a do ERP é banco × extrato
 * de sistema; a nossa é crédito × processo do cliente. Confundir as duas faria o
 * painel declarar resolvido o que ninguém alocou. O sinal do ERP vai para
 * `normalized.conciliadoNoErp` — como informação, não como estado.
 */
export const normalizarLancamento = (
    l: LancamentoExtrato,
    ctx: {
        runId: string;
        importadoEm: Date;
        /** Nomes que identificam a própria casa — ver `ehTransferenciaInterna`. */
        titularesInternos?: readonly string[];
        /** `gerDes` do `fin133` (`"BANCO BRASIL - AG. 1913 CONTA 105773-1"`). */
        contaDescricao?: string;
    },
): TransacaoBancaria => {
    const naturalKey = buildNaturalKey(l);
    // O remetente do `nrdocto` identifica de verdade; o histórico é só um resto de
    // texto truncado. Quando os dois existem, o remetente ganha.
    const remetente = extrairRemetente(l.numeroDocumento);
    const contraparte = remetente ?? extrairContraparte(l.historico);
    const transferenciaInterna = ehTransferenciaInterna(
        l.categoria,
        remetente,
        ctx.titularesInternos ?? [],
    );

    return {
        id: buildTransacaoId(naturalKey),
        correlationId: buildCorrelationId(naturalKey),
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
            remetente: remetente ?? null,
            contaDescricao: ctx.contaDescricao ?? null,
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
        ...(ctx.contaDescricao !== undefined ? { contaDescricao: ctx.contaDescricao } : {}),
        ...(l.categoria !== undefined ? { categoria: l.categoria } : {}),
        ...(l.categoriaDesc !== undefined ? { categoriaDesc: l.categoriaDesc } : {}),
        transferenciaInterna,
    };
};
