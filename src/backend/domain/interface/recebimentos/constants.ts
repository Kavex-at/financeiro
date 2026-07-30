/**
 * Frente IV — Recebimentos: typed status/enum constants (ontology P3 — never raw strings).
 *
 * Values mirror `ontology/state-machines/{recebimento,transacao-bancaria}.md` and the entity
 * skeletons. Open enums (`TransacaoTipo`, `ParcelaFinalidade`, `RegraTipo`) are refined in later
 * phases; here they carry only the universal members from the skeletons.
 *
 * SKELETON (Fase 0) — shapes only; no business logic.
 */

/** Ciclo de vida do agregado `Recebimento` — `state-machines/recebimento.md`. */
export const RECEBIMENTO_STATUS = {
    RASCUNHO: 'rascunho',
    APROVADO: 'aprovado',
    EXECUTADO: 'executado',
    ESTORNADO: 'estornado',
} as const;

export type RecebimentoStatus = (typeof RECEBIMENTO_STATUS)[keyof typeof RECEBIMENTO_STATUS];

/** Ciclo de vida do movimento `TransacaoBancaria` — `state-machines/transacao-bancaria.md`. */
export const TRANSACAO_BANCARIA_STATUS = {
    IMPORTADA: 'importada',
    CONCILIADA: 'conciliada',
    PARCIAL: 'parcial',
    MANUAL: 'manual',
    ERRO: 'erro',
} as const;

export type TransacaoBancariaStatus =
    (typeof TRANSACAO_BANCARIA_STATUS)[keyof typeof TRANSACAO_BANCARIA_STATUS];

/** Tipo do movimento bancário (open enum — Fase 1 refina). */
export const TRANSACAO_TIPO = {
    CREDITO: 'CREDITO',
    DEBITO: 'DEBITO',
    ESTORNO: 'ESTORNO',
    TARIFA: 'TARIFA',
    JUROS: 'JUROS',
} as const;

export type TransacaoTipo = (typeof TRANSACAO_TIPO)[keyof typeof TRANSACAO_TIPO];

/** Classificação do match do `atribuirBaixa` — `entities/recebimento.md`. */
export const MATCH_CLASSIFICACAO = {
    UNICA: 'unica',
    MULTIPLAS: 'multiplas',
    PARCIAL: 'parcial',
    NENHUMA: 'nenhuma',
} as const;

export type MatchClassificacao = (typeof MATCH_CLASSIFICACAO)[keyof typeof MATCH_CLASSIFICACAO];

/** Componente/finalidade de uma parcela de rateio (open enum — Fase 4 refina). */
export const PARCELA_FINALIDADE = {
    PRINCIPAL: 'PRINCIPAL',
    MULTA: 'MULTA',
    JUROS: 'JUROS',
    ENCOMENDA: 'ENCOMENDA',
} as const;

export type ParcelaFinalidade = (typeof PARCELA_FINALIDADE)[keyof typeof PARCELA_FINALIDADE];

/** Status de emissão da NDe (write-ahead) — `entities/nota-debito-eletronica.md`. */
export const NDE_STATUS_EMISSAO = {
    PENDENTE: 'pendente',
    EMITIDA: 'emitida',
    ERRO: 'erro',
} as const;

export type NdeStatusEmissao = (typeof NDE_STATUS_EMISSAO)[keyof typeof NDE_STATUS_EMISSAO];

/** Ciclo do crédito de cliente (Fase 4 refina) — `entities/credito-cliente.md`. */
export const CREDITO_CLIENTE_STATUS = {
    DISPONIVEL: 'disponivel',
    PARCIAL: 'parcial',
    CONSUMIDO: 'consumido',
} as const;

export type CreditoClienteStatus =
    (typeof CREDITO_CLIENTE_STATUS)[keyof typeof CREDITO_CLIENTE_STATUS];

/** Tipo da regra de conciliação (open enum — Fase 4 refina) — `entities/regra-recebimento.md`. */
export const REGRA_TIPO = {
    ENCOMENDA: 'ENCOMENDA',
    ADIANTAMENTO_CLIENTE: 'ADIANTAMENTO_CLIENTE',
    MULTA_JUROS: 'MULTA_JUROS',
} as const;

export type RegraTipo = (typeof REGRA_TIPO)[keyof typeof REGRA_TIPO];

// ─────────────────────────────────────────────────────────── Execution policy constants

/**
 * Timeouts (ms) que os adapters reais DEVEM honrar por chamada externa (Regis availability-2 /
 * performance-2). Um `await` puro sob incidente Conexos/Nexxera pina o worker até o timeout global;
 * o coordinator envelopa cada chamada no `RetryExecutor` e o teto vira `timeoutMs x attempts`.
 */
export const NEXXERA_FETCH_TIMEOUT_MS = 15000;
export const ERP_WRITE_TIMEOUT_MS = 8000;
export const NDE_EMIT_TIMEOUT_MS = 8000;

/** Política central de retry das chamadas externas do `executarRecebimento` (Regis availability-3). */
export const RECEBIMENTO_RETRY_ATTEMPTS = 3;
export const RECEBIMENTO_RETRY_DELAY_MS = 1000;

/**
 * Teto de leituras Conexos simultâneas no fan-out multi-filial da ingestão (Regis performance-1).
 * Alinhado ao `FANOUT_LIMIT=4` do SISPAG (mitigação do incidente `LOGIN_ERROR_MAX_SESSIONS`).
 */
export const FANOUT_LIMIT_RECEBIMENTOS = 4;

/**
 * Chave de advisory lock EXCLUSIVA da ingestão de recebimentos — namespaced (≠ do
 * `PAGAMENTO_INGEST_LOCK_KEY` do SISPAG). Contrato de exclusão cross-processo para o Módulo 1.
 */
export const RECEBIMENTO_INGEST_LOCK_KEY = 726354820;

// ─────────────────────────────────────────────────────────── Solicitação de Numerário (com299)

/**
 * Configuração de Documento (`gcd`) do com299 usada ao processar um processo → gerar uma
 * **Solicitação de Numerário — Encomenda** (`gerDocProcesso`).
 *
 * `gcdCod` é o código da configuração no ERP. **PLACEHOLDER (dry-run):** o valor real precisa de
 * confirmação HML/HAR (ver `ontology/integrations/conexos-com299-gerdoc.md`). O `gcdDesNome` é o
 * rótulo humano ("Cód. Configuração de Documento"). Como a geração é **DRY-RUN-ONLY** nesta iteração,
 * nenhum POST usa esse código ainda — ele só entra no payload previsto.
 */
export const SOLICITACAO_NUMERARIO_DOC_CONFIG = {
    /** PLACEHOLDER — confirmar o `gcdCod` real via HML/HAR antes de qualquer envio ao ERP. */
    gcdCod: 0,
    gcdDesNome: 'Solicitação de Numerário - Encomenda',
} as const;

/** Tipo/validação do documento com299 (defaults do swagger — confirmar no build). */
export const SOLICITACAO_NUMERARIO_DOC_TIP = 'SN';
export const SOLICITACAO_NUMERARIO_DOC_VLD_TIPO = 'SN';
/** Moeda default da SN (BRL) — parametrizável quando a fonte real existir. */
export const SOLICITACAO_NUMERARIO_MOE_COD = 790;

// ─────────────────────────────────────────────────────────── Extrato bancário (fin095 / fin133)

/**
 * Moeda dos lançamentos de extrato. O `fin095` não traz campo de moeda — as contas
 * do `fin133` são todas bancos brasileiros. Constante nomeada em vez de literal
 * solto para que o dia em que houver conta em outra moeda seja um grep, não uma
 * caçada.
 */
export const EXTRATO_MOEDA_PADRAO = 'BRL';

/**
 * Categorias do extrato (`exiEspCategoria` do fin095) que NÃO são recebimento de
 * cliente — são movimento de tesouraria da própria Columbia.
 *
 * Medido em produção (filial 1, 90 dias, 1.759 créditos): 239 RESGATE DE
 * APLICAÇÃO, 18 AÇÕES, 14 TRANSFERÊNCIA ENTRE CONTAS. Jogar isso na fila do
 * analista afoga a tela sem nenhum ganho.
 *
 * ⚠️ É filtro de APRESENTAÇÃO. A ingestão persiste tudo — o extrato é fonte da
 * verdade e uma exclusão gravada no banco não teria volta. O painel esconde por
 * default e o analista pode pedir para ver.
 */
export const CATEGORIAS_TESOURARIA = [
    '206', // RESGATE DE APLICAÇÃO
    '210', // AÇÕES
    '213', // TRANSFERÊNCIA ENTRE CONTAS
    '207', // EMPRÉSTIMO / FINANCIAMENTO
] as const;

/** Teto de linhas devolvidas pelo painel (espelha o `TITULOS_CAP` do SISPAG). */
export const PAINEL_TRANSACOES_CAP = 500;

/** Janela default da ingestão de extratos, em dias. */
export const RECEBIMENTO_INGEST_DIAS_PADRAO = 90;

/**
 * Fatia máxima de dias por chamada ao `fin095`. Mantém cada `paginate` bem abaixo
 * do teto de páginas (`MAX_PAGES × PAGE_SIZE` = 25.000) mesmo numa conta de alto
 * volume, e dá granularidade de retomada quando uma fatia falha.
 */
export const RECEBIMENTO_INGEST_BLOCO_DIAS = 30;
