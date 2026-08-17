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
    /**
     * TERMINAL operacional (ADR-0033): a alocação foi executada até o fim — SN + baixa fin014, com
     * NDe (`concluido`) ou sem ela (`quitado-sem-nde`). As duas contam como processada: a diferença
     * entre elas é FISCAL, não operacional, e o analista não tem mais nada a fazer em nenhuma.
     *
     * Escrito pelo settle do ledger. Antes da ADR-0033 NADA tirava uma transação de `importada` — a
     * máquina de estados existia e nunca era acionada, e a carteira mostrava centenas de `importada`
     * com alocações já executadas por trás.
     */
    PROCESSADA: 'processada',
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
 * Completar o adiantamento SN até finalizável (HAR 2026-08-02 17-31, doc 18342). A geração cria um SHELL
 * (docMnyValor:0); para virar adiantamento BAIXÁVEL faltam a condição de pagamento do cadastro e a linha de
 * item com o valor.
 * - `SN_TPD_COD = 3` — tipo de documento "SOLICITAÇÃO DE NUMERÁRIO" (`tpdCod`), usado no filtro do rateio.
 * - `SN_ADIANTAMENTO_PRJ_COD = 1` — projeto usado na linha de item (default do fluxo SN Encomenda).
 * - `SN_CONTA_ADIANTAMENTO_ENCOMENDA` — NOME da conta de projeto (`ctpDesNome`) da SN Encomenda; o `ctpCod`
 *   numérico é resolvido em runtime pelo `lov/ContasProjetoCtb` (varia por processo/tenant).
 */
export const SN_TPD_COD = 3;
export const SN_ADIANTAMENTO_PRJ_COD = 1;
/**
 * Conta de projeto (rateio) da linha de item — PREFIXO + a VARIANTE da SN do processo. A config de SN varia
 * por processo (Encomenda/Terceiros/…) e a conta acompanha: "ADIANTAMENTO DE CLIENTE ENCOMENDA",
 * "ADIANTAMENTO DE CLIENTE TERCEIROS", etc. Resolvida em runtime no `lov/ContasProjetoCtb` pelo nome derivado.
 */
export const SN_CONTA_ADIANTAMENTO_PREFIXO = 'ADIANTAMENTO DE CLIENTE';
export const SN_CONTA_ADIANTAMENTO_ENCOMENDA = 'ADIANTAMENTO DE CLIENTE ENCOMENDA';

/**
 * MODALIDADE do processo de importação — campo "Tipo" da `imp021` (`priVldTipo`). O mapa é o mesmo
 * já documentado no `ConexosCadastroClient` (Addendum 2026-06-08 #2 do ADR-0021).
 *
 * Nunca comparar os literais `1`/`2`/`3` fora daqui.
 */
export const PRI_VLD_TIPO = {
    PROPRIA: 1,
    CONTA_E_ORDEM_TERCEIROS: 2,
    POR_ENCOMENDA: 3,
} as const;

export type PriVldTipo = (typeof PRI_VLD_TIPO)[keyof typeof PRI_VLD_TIPO];

/** Rótulo de exibição da modalidade — o mesmo texto no painel, no motivo e no log. */
export const PRI_VLD_TIPO_ROTULO: Record<number, string> = {
    [PRI_VLD_TIPO.PROPRIA]: 'PRÓPRIA',
    [PRI_VLD_TIPO.CONTA_E_ORDEM_TERCEIROS]: 'CONTA E ORDEM',
    [PRI_VLD_TIPO.POR_ENCOMENDA]: 'POR ENCOMENDA',
};

/**
 * A NDe é devida em UMA única modalidade: **POR ENCOMENDA** (ADR-0033).
 *
 * Regra em um lugar só — quem decide emitir um documento fiscal irreversível não pode espalhar
 * comparações de código pelo stack.
 *
 * - `POR_ENCOMENDA` (3): a Columbia importa para um encomendante e cobra dele → **emite**.
 * - `CONTA_E_ORDEM_TERCEIROS` (2): a documentação do repasse sai em nome do terceiro (ADR-0031) →
 *   não emite.
 * - `PROPRIA` (1): a Columbia importa para si. Medido na carteira real: 43 processos, 31 deles da
 *   própria `COLUMBIA TRADING S/A` — não há terceiro a quem debitar, e emitir aqui seria uma nota
 *   contra si mesma. Passou a NÃO emitir na ADR-0033 (antes emitia, por omissão da ADR-0031).
 *
 * ⚠️ Código DESCONHECIDO (fora do mapa) **não** cai aqui como "dispensada": o chamador bloqueia
 * fail-closed. Tratar o desconhecido como dispensa quitaria em silêncio um caso que talvez devesse
 * nota — e o princípio da ADR-0031 é parar quando não se sabe, nunca adivinhar.
 */
export const ndeEDevida = (priVldTipo: number): boolean =>
    priVldTipo === PRI_VLD_TIPO.POR_ENCOMENDA;

/** O código veio do ERP dentro do domínio conhecido? Fora dele, a alocação é BLOQUEADA. */
export const isPriVldTipoConhecido = (priVldTipo: number): boolean =>
    Object.values(PRI_VLD_TIPO).some((v) => v === priVldTipo);

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

/** Teto da aba NDe. Menor que o da carteira: uma NDe existe só por alocação executada. */
export const PAINEL_NDES_CAP = 200;

/**
 * Página do GRID do com297 na hidratação da aba NDe (`POST com297/list`).
 *
 * A autorização do SEFAZ é assíncrona: número e `vldAutorizado` chegam depois da homologação, e sem
 * reler o ERP a aba mostraria para sempre o retrato do instante da emissão. A leitura é **1 POST por
 * filial** (não 1 GET por linha, como na primeira versão): o grid devolve `vldAutorizado` e
 * `docEspNumero` de todas as NDes da família de uma vez.
 */
export const PAINEL_NDE_ERP_PAGE_SIZE = 200;

/**
 * Teto de páginas do grid por filial. Existe para o pior caso patológico (o ERP ignorar a paginação e
 * devolver sempre a mesma página) não virar loop infinito num request de tela. Em produção hoje a
 * família inteira cabe em UMA página (10 linhas na filial 2), então o teto nunca é atingido.
 */
export const PAINEL_NDE_ERP_MAX_PAGINAS = 10;

/**
 * Prazo de UMA leitura do grid (`POST com297/list`, uma filial).
 *
 * Não é redundante com o timeout do axios: a leitura roda sob `runWithRetry`, e 40s por tentativa ×
 * 3 tentativas = ~2min por chamada. Num GET de tela isso é inaceitável. Alinhado ao
 * `ERP_WRITE_TIMEOUT_MS` — a doutrina de prazo do módulo.
 */
export const PAINEL_NDE_HIDRATACAO_TIMEOUT_MS = 8_000;

/**
 * Orçamento da FASE inteira de hidratação (todas as filiais). Sem um teto global, um ERP
 * uniformemente lento multiplicaria o prazo individual pelo número de filiais. Vencido o orçamento, as
 * filiais restantes voltam com o estado do banco e o próximo load retoma.
 */
export const PAINEL_NDE_HIDRATACAO_BUDGET_MS = 12_000;

/** Moeda da NDe. Toda a operação é BRL; existe como constante para nunca virar string solta. */
export const NDE_MOEDA_PADRAO = 'BRL';

/** Janela default da ingestão de extratos, em dias. */
export const RECEBIMENTO_INGEST_DIAS_PADRAO = 90;

/**
 * Minutos em `reconciling` a partir dos quais uma execução é considerada INTERROMPIDA (ADR-0034).
 *
 * O write-ahead abre a linha como `reconciling` antes do primeiro POST no ERP e a fecha em
 * `settled`/`error`. Uma linha que ficou nesse estado além da janela significa que o processo morreu
 * no meio da sequência — pode haver documento órfão no Conexos sem nada observando. A janela é folgada
 * o bastante para não rotular uma execução ainda em voo (a sequência completa leva segundos, não
 * minutos), e curta o bastante para o analista ver no mesmo turno de trabalho.
 */
export const EXECUCAO_INTERROMPIDA_MINUTOS = 15;

/**
 * PISO da janela de ingestão do extrato (`YYYY-MM-DD`). Nenhum caminho de
 * sincronização — cron horário, `DIAS=` ou `POST /recebimentos/ingestao { dias }` —
 * lê lançamento anterior a esta data (ADR-0028).
 *
 * É o marco de go-live da Frente IV em produção: crédito anterior a ele pertence
 * ao processo manual antigo e entraria na carteira do analista como pendência
 * falsa. Sobrescrevível por `CONEXOS_EXTRATO_SYNC_START_DATE`.
 */
export const RECEBIMENTO_INGEST_START_DATE_PADRAO = '2026-08-03';

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
 * Whitelist de `vldTpNf` NORMAIS conhecidos (→ `homologaNfe`). Invertemos o predicado fail-open do UI
 * (que roteia QUALQUER valor não-{11,12} p/ normal): aqui um `vldTpNf` fora de {contingência ∪
 * normais-conhecidos} é RECUSADO (fail-loud), não assumido normal.
 * SEED `"10"` — HAR-confirmado (doc 18337, filial 2, produção, 2026-08-01): NDe normal emite com
 * `vldTpNf="10"` e roteia p/ `homologaNfe`. Ver `_inbox/recebimentos-numerario-real-fiscal-spec.md`.
 * Novos tipos observados devem ser adicionados aqui (fail-loud força a decisão explícita).
 */
export const NDE_NORMAL_TP_NF_CONHECIDOS: readonly string[] = ['10'];

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
 * `docVldComvalidacoes` no retorno da homologação — **HTTP 200 ≠ sucesso** (branch obrigatório):
 *   - `1` → sucesso limpo (emitida, sem validações pendentes).
 *   - `2` → homologada COM validações pendentes (aviso com194) — emitida, marca revisão humana.
 *   - `0` → homologada COM validações pendentes NÃO bloqueantes (ex.: cond. pagamento, tipo de frete, GTIN
 *          do produto). Confirmado pelo Yuri (2026-08-03): na plataforma essas validações NÃO bloqueiam a
 *          homologação — ela ACONTECE (igual ao HAR). Tratado como `2`: emitida + revisão humana (com194).
 *   - default → falha (com194 + erro) — RECUSA (nunca marcar um 200 desconhecido como sucesso).
 *
 * ⚠️ **Este campo é ADVISORY, não o veredito.** Produção 2026-08-11: a NDe 18771 voltou `0` e NÃO foi
 * homologada (`docVldNfehom: 0`); a 18779, mesmo fluxo e as MESMAS três validações de aviso, foi. Ou
 * seja: `0` não separa homologada de recusada, e nenhum valor deste enum separa — quem separa é o
 * estado gravado no documento (`NDE_DOC_VLD_NFEHOM`), lido de volta depois do POST. Mantemos o branch
 * permissivo (o client não tem como saber) e a verificação autoritativa vive no serviço. Ver ADR-0036.
 */
export const NDE_DOC_VLD_COM_VALIDACOES = {
    SUCESSO: 1,
    AVISO_VALIDACOES_PENDENTES: 2,
    HOMOLOGADA_VALIDACOES_NAO_BLOQUEANTES: 0,
} as const;

/**
 * Constantes da GERAÇÃO do documento com297 (HAR-confirmadas 2026-08-02 23-27, doc 18347 → SUCESSO):
 * produto SEMPRE `41978` ("PAGAMENTO ANTECIPADO"), número SEMPRE `0`, série `NFE1`. A Configuração é a
 * "NOTA DE DEBITO PAGAMENTO ANTECIPADO" (gcd 248 neste tenant, resolvida por nome).
 */
export const NDE_GERACAO_DEFAULTS = {
    produtoCod: 41978,
    produtoNome: 'PAGAMENTO ANTECIPADO',
    numero: 0,
    serie: 'NFE1',
    tipoNotaDebito: 'Pagamento antecipado',
} as const;

/**
 * `globalDocVldTipo` do com297 (NDe) = **0** — DIFERENTE do com299/SN (que é 9). Foi o `9` no com297 que
 * fazia o processo rejeitar a config 248 (`gcdDesNomeProc NOT_VALID`, live 2026-08-03) e o ConfigDocProcesso
 * não surfaçar nenhuma config de débito. Com `0`, o processo 3254 aceita a gcd 248 (HAR 23-27).
 */
export const NDE_GLOBAL_DOC_VLD_TIPO = 0;
export const NDE_CONFIG_NOME = 'NOTA DE DEBITO PAGAMENTO ANTECIPADO';

/**
 * Identidade da família NDe no GRID do com297 (`POST com297/list`) — probe read-only em PRD,
 * 2026-08-17, `jobs/probe-com297-list.ts`.
 *
 * `NDE_TPD_COD = 167` é o **código** do tipo de documento cujo nome de cadastro é
 * `"NOTA DE DEBITO ELETRÔNICA"`. Filtramos por ele, e NÃO por `tpdDesNome#LIKE`, por três razões
 * medidas:
 *
 *  1. **Equivalência provada:** `tpdCod#EQ:167` devolve o MESMO conjunto que o filtro por nome
 *     (10 linhas na filial 2, 1 na filial 4) e nenhum outro `tpdDesNome` entra — o código não é mais
 *     largo que o rótulo.
 *  2. **Nome de cadastro é editável.** Este módulo já pagou por isso: o `NDE_CONFIG_NOME` acima
 *     obrigou a criar a env `COM297_GCD_NOTA_DEBITO` como escape quando o nome não bate, e existe ADR
 *     dedicado a tirar o `gcd` da SN do nome e levá-lo para o histórico do processo.
 *  3. **`#LIKE` sobre string acentuada falha silenciosamente.** Uma diferença de normalização Unicode
 *     no `Ô` devolveria ZERO linhas sem erro — indistinguível de "não há NDe", que é exatamente o bug
 *     que esta feature veio consertar.
 *
 * `NDE_DOC_VLD_TIPO = 7` é o `docVldTipo` do DOCUMENTO com297 — NÃO confundir com o
 * `NDE_GLOBAL_DOC_VLD_TIPO = 0` acima, que é o `globalDocVldTipo` do ConfigDocProcesso. São campos
 * diferentes, de chamadas diferentes; trocar um pelo outro fez o ERP rejeitar a config 248 em produção.
 */
export const NDE_TPD_COD = 167;
export const NDE_DOC_VLD_TIPO = 7;
export const NDE_DOC_VLD_TIPO_ADTO = 0;

/**
 * com300 `fisVldTipoNfDebito` — tipo de nota de débito FISCAL (inteiro, NÃO string). `6` = PAGAMENTO
 * ANTECIPADO (HAR-confirmado, doc 18337, 2026-08-01). Setado no read-modify-write do com300; sucesso
 * do PUT ⟺ o eco devolve `fisVldTipoNfDebito === 6`. `fisVldTipoNfCredito` é intocado.
 * Ver `_inbox/recebimentos-numerario-real-fiscal-spec.md` §(a).
 */
export const NDE_FISCAL_TIPO_NF_DEBITO_PAGAMENTO_ANTECIPADO = 6;

/**
 * Marcador da observação SINIEF que o com131 `geraObs` grava em `fisEspObs`. Guard de idempotência:
 * se `fisEspObs` já o contém, NÃO re-chamar `geraObs` (o texto termina em ` /` e pode ACRESCENTAR).
 * Torna a etapa de observações retomável. Ver spec §(b).
 */
export const NDE_OBS_SINIEF_MARKER = 'AJUSTE SINIEF';

/**
 * `docVldNfehom` do com297 — o documento FOI homologado? É o **estado gravado**, e por isso o único
 * discriminador confiável da homologação: `docVldComvalidacoes` é o que o POST *diz*, `docVldNfehom` é
 * o que *ficou*. Medido em produção (2026-08-11): a NDe 18771 (DYNAMIS) voltou HTTP 200 com
 * `docVldComvalidacoes: 0` — que o client tratava como "homologada com validações não bloqueantes" —
 * e o documento continuou em `docVldNfehom: 0` / `vldStatus: 1`, ou seja, NÃO homologado. Ver ADR-0036.
 */
export const NDE_DOC_VLD_NFEHOM = {
    NAO_HOMOLOGADO: 0,
    HOMOLOGADO: 1,
} as const;

/**
 * `vldStatus` do com297 — a máquina de estado do documento fiscal, medida na população real da
 * `gcd 248` (filial 2, produção, 2026-08-11):
 *   - `1` ABERTO      — gerado, não homologado (`docVldNfehom: 0`).
 *   - `2` HOMOLOGADO  — `docVldNfehom: 1`, mas SEM NF-e: `vldAutorizado: 0`, `docEspNumero: "0"`,
 *                       `vldNfeGerado: 0` (com300). Estado em que TODAS as NDes da automação pararam.
 *   - `3` AUTORIZADO  — `vldAutorizado: 1`, `docEspNumero` real (ex.: 180739), `vldNfeGerado: 1`.
 * Homologar NÃO transmite a NF-e: entre `2` e `3` existe um passo que a automação ainda não faz
 * (open-gap `com297-transmissao-nfe`). Ver ADR-0036.
 */
export const NDE_COM297_VLD_STATUS = {
    ABERTO: 1,
    HOMOLOGADO: 2,
    AUTORIZADO: 3,
} as const;

/**
 * `fdvVldErr` da com194 — severidade da validação. **Medido em produção (2026-08-11, doc 18771)**,
 * casando as linhas do modal "VALIDAÇÃO - COM_194" com a resposta da API:
 *   - `1` = ERRO (❌) — bloqueia. Ex.: "A DATA DE EMISSÃO DA NOTA FISCAL EXCEDEU A TOLERÂNCIA DE 15
 *           MINUTOS".
 *   - `2` = AVISO (⚠️) — não bloqueia a homologação. Ex.: condição de pagamento divergente do cadastro,
 *           tipo de frete sem transportadora, produto sem GTIN.
 * A doutrina anterior (`VALIDACAO_BLOQUEANTE = 2`, "1 = aviso") era exatamente o INVERSO. O único
 * consumidor casava `2` — o valor certo para o aviso de condição de pagamento —, então o comportamento
 * estava certo pelo motivo errado; aqui o nome passa a dizer a verdade.
 */
export const COM194_FDV_VLD_ERR = {
    ERRO: 1,
    AVISO: 2,
} as const;

/**
 * `fdvVldTperr` — CLASSE da validação, e filtro **obrigatório** do `com194/documento/list` (sem ele o
 * ERP devolve `Generic.REQUIRED_FILTER_ERROR`, HTTP 400). Consultávamos só a classe `1` e perdíamos a
 * `2` de vista: o doc 18737 (autorizado) carrega a sua única validação em `fdvVldTperr: 2`. Como o
 * filtro não aceita lista, varremos as duas classes e unimos.
 */
export const COM194_TIPOS_ERRO: readonly number[] = [1, 2];
