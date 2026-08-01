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
 * Configuração de Documento (`gcd`) do com299 da **Solicitação de Numerário — Encomenda**.
 *
 * O `gcdCod` NÃO vive mais aqui — é lido de `EnvironmentProvider.solicitacaoNumerarioGcdCod`
 * (`SN_GCD_COD`), com sentinela 0 = "não confirmado" que trava a escrita real. Valor HAR-confirmado
 * (prod, filial 2) = **150** (`SOLICITAÇÃO DE NUMERÁRIO - ENCOMENDA`). Aqui fica só o rótulo humano.
 */
export const SOLICITACAO_NUMERARIO_DOC_CONFIG = {
    gcdDesNome: 'Solicitação de Numerário - Encomenda',
} as const;

/**
 * Guard da FONTE dos códigos de rateio (`prjCod/ctpCod/tpcCod/cfoEspCod/ccuCod`) da linha
 * `comDocProdutos`. **`false` de propósito** (assertion, não assumption — espelha
 * `NDE_NORMAL_TP_NF_CONHECIDOS`).
 *
 * O HAR (prod, doc 18202) provou que NÃO há regra de % client-side: o `valor` da SN é o valor CRU da
 * transação e o **servidor** totaliza o líquido do rateio (`GET com299/calculaValorLiquidoDocumento`).
 * O gap real não é o cálculo — é a ORIGEM dos códigos de rateio, que são PROCESSO-derivados (variam por
 * doc) e provavelmente vêm de `POST com299/comDocProdutos/initialValues` (gap G1). Enquanto essa fonte
 * não for confirmada por HAR, hardcodar os códigos da amostra 18202 num payload financeiro seria escrever
 * dado errado no ERP — então uma ESCRITA REAL deve LANÇAR. Ver `EncomendaValorCalculator` e
 * `ontology/integrations/conexos-com299-gerdoc.md` (gaps G1/G2).
 */
export const ENCOMENDA_PERCENTUAIS_RESOLVED = false;

/**
 * Tipo/validação do documento com299 — **numéricos, HAR-confirmados** (prod filial 2, doc 18202; a
 * suposição `"SN"`/`"SN"` era errada). `docVldTipoAdto = 1` marca o doc como adiantamento.
 */
export const SOLICITACAO_NUMERARIO_DOC_TIP = 1;
export const SOLICITACAO_NUMERARIO_DOC_VLD_TIPO = 9;
export const SOLICITACAO_NUMERARIO_DOC_VLD_TIPO_ADTO = 1;

/**
 * Moeda ASSUMIDA do PROCESSO (BRL/790) — concern SEPARADO do `moeCod` do doc SN (que é `null`). O
 * `imp021` não expõe a moeda do processo (só `moeCodConv`/`moeCodSeg`); o `ProcessoProviderConexos`
 * assume BRL e marca `moeCodAssumido: true` p/ a UI avisar. Named constant (não o `SOLICITACAO_*`
 * removido) para deixar claro que é a moeda do PROCESSO, não do documento.
 */
export const PROCESSO_MOEDA_ASSUMIDA_BRL = 790;

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
// ─────────────────────────────────────────────────────────── NDe fiscal (com297) — homologação

/**
 * Nota de Débito Eletrônica (NDe) — leg FISCAL. A NDe *eletrônica* é um documento fiscal de SAÍDA
 * gerado no `com297` (Fiscais de Saída) e HOMOLOGADO (autorização SEFAZ). Este módulo modela apenas
 * o passo TERMINAL — a **homologação** (contrato completo). A GERAÇÃO do documento com297
 * (produto/número/tipo-de-débito/observações) é uma leg anterior ainda NÃO contratada (só passos de
 * UI no docx — info-gap em `_inbox/recebimentos-nde-com297-gap.md`). NÃO confundir com o com299
 * (`SOLICITACAO_NUMERARIO_*` acima), que é a leg FINANCEIRA (Solicitação de Numerário).
 * Ver `ontology/integrations/conexos-com297-homologacao.md`.
 */

/** Os dois verbos de homologação do com297. Path = `com297/{verbo}/{docCod}`, body `{}`. */
export const NDE_HOMOLOGACAO_VERB = {
    NORMAL: 'homologaNfe',
    CONTINGENCIA: 'homologaNfeContingencia',
} as const;

export type NdeHomologacaoVerb = (typeof NDE_HOMOLOGACAO_VERB)[keyof typeof NDE_HOMOLOGACAO_VERB];

/**
 * Whitelist de `vldTpNf` que roteiam p/ CONTINGÊNCIA (`homologaNfeContingencia`). Fonte: o predicado
 * client-side `finDocIsContingenciaHomologacao` = `["11","12"].indexOf(o.finDoc.vldTpNf) !== -1`.
 * Comparação ESTRITA por string — um `11` numérico vindo de payload REST NÃO casa; normalize no
 * boundary (`normalizeVldTpNf`). `"11"` → aviso DPEC (legado EPEC); `"12"` → aviso SCAN (legado SVC).
 */
export const NDE_CONTINGENCIA_TP_NF = ['11', '12'] as const;

/** Texto de aviso do dialog por `vldTpNf` de contingência (só afeta a mensagem, NÃO a rota). */
export const NDE_CONTINGENCIA_AVISO: Readonly<Record<string, 'DPEC' | 'SCAN'>> = {
    '11': 'DPEC',
    '12': 'SCAN',
};

/**
 * Whitelist de `vldTpNf` NORMAIS conhecidos (→ `homologaNfe`). **VAZIO de propósito (assertion, não
 * assumption).** Invertemos o predicado fail-open do UI (que roteia QUALQUER valor não-{11,12} p/
 * normal): aqui um `vldTpNf` fora de {contingência ∪ normais-conhecidos} é RECUSADO (fail-loud), não
 * assumido normal. Precisa ser SEED a partir da distribuição real de `vldTpNf` nos documentos NDe da
 * Columbia ANTES de ligar a escrita — P0 gate-before-live em `_inbox/recebimentos-nde-com297-gap.md`.
 * Enquanto vazio, a homologação (gated OFF por default) recusa docs normais — intencional.
 */
export const NDE_NORMAL_TP_NF_CONHECIDOS: readonly string[] = [];

/**
 * Ações ACL (`checkActions view=com297`) exigidas p/ homologar — a conta de serviço da automação
 * precisa da ação correspondente à rota; a contingência exige uma ação SEPARADA. Se o servidor
 * re-checa, sem a ação vem 403; se não re-checa, estaríamos furando um controle do UI — conceda
 * propriamente. Ver `integrations/conexos-com297-homologacao.md`.
 */
export const NDE_HOMOLOGACAO_ACTION = {
    NORMAL: 'HOMOLOGAR DOCUMENTO',
    CONTINGENCIA: 'HOMOLOGAR DOCUMENTO CONTINGENCIA',
} as const;

/**
 * `docVldComvalidacoes` no retorno da homologação — **HTTP 200 ≠ sucesso**. Branch OBRIGATÓRIO
 * (`customizedSuccess: true` no UI suprime o toast default justamente p/ isto):
 *   - `1` → sucesso limpo (emitida)
 *   - `2` → homologada, mas com validações pendentes (aviso com194 — emitida COM aviso, NÃO sucesso)
 *   - default → falha (com194 + erro) — RECUSA (nunca marcar um 200 como sucesso).
 */
export const NDE_DOC_VLD_COM_VALIDACOES = {
    SUCESSO: 1,
    AVISO_VALIDACOES_PENDENTES: 2,
} as const;

/**
 * Constantes da GERAÇÃO do documento com297 (leg ANTERIOR, fora do escopo desta fatia — só a
 * homologação é contratada). PLACEHOLDERS documentados do docx p/ quando a leg de geração for cabeada:
 * produto SEMPRE `41978`, número SEMPRE `"0"`, tipo de nota de débito = `"Pagamento antecipado"`.
 * Confirmar via HAR/HML — `_inbox/recebimentos-nde-com297-gap.md`.
 */
export const NDE_GERACAO_DEFAULTS = {
    produtoCod: 41978,
    numero: '0',
    tipoNotaDebito: 'Pagamento antecipado',
} as const;
