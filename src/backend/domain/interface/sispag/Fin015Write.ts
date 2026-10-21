/**
 * SISPAG fin015 — DTOs da ESCRITA (Fatia 3, geração de remessa `.REM`).
 *
 * Estes tipos descrevem as FERRAMENTAS de integração com a tela "Geração de Lotes
 * SISPAG" (fin015), não o fluxo de orquestração (que é decidido com o analista).
 * Cada campo espelha os payloads PROVADOS ao vivo em HML (sondas `probe-fin015-hml.ts`
 * / `probe-fin015-fluxo.ts`, 2026-07-09). É a 1ª superfície de ESCRITA do SISPAG no
 * Conexos — quebra a invariante I1 (read-only); ver a doutrina em `ConexosBaixaClient`.
 */

/**
 * Conta pagadora (a conta da Columbia de onde sai o dinheiro). O lote nativo fin015
 * é POR conta. Default empírico = Itaú `AG:0641/CT:55795-4` (8/8 lotes do HAR PRD);
 * Santander é exceção rara (roteamento a definir com o analista). Campos = os do DTO
 * `FinLoteSispag` provado no `POST /fin015`.
 */
export interface ContaPagadora {
    /** Código interno do banco no Conexos (Itaú=4). */
    bncCod: number;
    /** Número do banco na FEBRABAN (Itaú=341). */
    bncNumCodbanco: number;
    /** Código interno da conta corrente no Conexos. */
    ccoCod: number;
    /** Número da conta (sem dígito). */
    ccoNumConta: number;
    /** Dígito verificador da conta. */
    ccoEspDvconta: string;
    /** Código da agência (com zeros à esquerda, ex. '0641'). */
    ccoEspAgcod: string;
    /** Conta formatada (ex. '55795-4'). */
    conta: string;
    /** Layout exibido (ex. 'AG:0641/CT:55795-4'). */
    layoutConta: string;
}

/** Parâmetros para criar um lote nativo fin015 (`POST /fin015`). */
export interface CriarLoteParams {
    filCod: number;
    conta: ContaPagadora;
    /** Data de débito (epoch-ms). Regras R1 (≥ hoje) e R2 (≤ menor vencimento) validadas no finalizar. */
    dataDebito: number;
}

/** Lote nativo recém-criado — o crítico é o `flpCod` atribuído pelo ERP. */
export interface LoteNativoCriado {
    flpCod: number;
    filCod: number;
    bncCod: number;
}

/** O que a ingestão aproveita de cada linha do grid de pendentes (ver `listarSinaisDosPendentes`). */
export interface SinalPendente {
    /** `titVldReflexoDdaAssoc === 1` — o ERP casou um boleto DDA com o título. */
    temBoletoDda: boolean;
    /** `titVldPagopor` legível (ver `PAGO_POR_CONEXOS`); ausente = não sei. */
    pagoPor?: number;
}

/** Um título pendente elegível a importar num lote (linha de `titulosPendentes/list`). */
export interface TituloPendente {
    filCod: number;
    docCod: string;
    titCod: string;
    /**
     * Forma de pagamento. Encoding MEDIDO em produção (2026-08-27, 36 itens boleto reais):
     * `1` = crédito em conta / TED, `6` = **boleto do MESMO banco** do lote (Itaú 341),
     * `7` = **boleto de OUTRO banco** (medidos: 748 Sicredi, 237 Bradesco). O ERP escolhe o
     * segmento CNAB por ela — e, quando o boleto vem por associação DDA, ele mesmo a deriva
     * do banco emissor do código de barras, ignorando o que mandamos.
     */
    itsVldModalidade?: number;
    valor?: number;
    vencimento?: number;
    favorecido?: string;
    /**
     * O ERP tem um boleto DDA (`fin124`) casado com este título — flag `titVldReflexoDdaAssoc`
     * do grid de pendentes.
     *
     * É o ÚNICO vínculo pagamento↔boleto que existe: o código de barras não está no título
     * (medido 0% em `fin064`, `titulosPendentes` e `com308`) e o item do `fin124` não guarda
     * documento/título até ser consumido por um lote. Ver
     * `ontology/_inbox/sispag-boleto-dda-sondagem.md`.
     */
    temBoletoDda: boolean;
    /**
     * O campo `titVldReflexoDdaAssoc` veio legível (presente e ∈ {0,1}) nesta linha.
     * `false` significa "não sei", não "não tem" — quem consome decide o que fazer com a
     * diferença. Ver `PENDENTE_DDA_SCHEMA` em `ConexosSispagWriteClient`.
     */
    ddaLegivel: boolean;
    /**
     * Forma de pagamento do título no Conexos (`titVldPagopor`, ver `PAGO_POR_CONEXOS`).
     * Ausente quando o campo não veio ou não é inteiro positivo. Código fora do domínio documentado
     * (1..10) vem, de propósito: é código novo do ERP (migration 0082).
     */
    pagoPor?: number;
    /** Linha crua do ERP — repassada no `importar` (o ERP exige o registro completo do item). */
    raw: Record<string, unknown>;
}

/**
 * Parâmetros para importar títulos selecionados num lote (`titulosPendentes/importar`).
 *
 * `itens` são as linhas do `titulosPendentes/list` VERBATIM (a identidade tem que bater:
 * `filCod` é a filial do TÍTULO, não a do lote), enriquecidas com a modalidade e o
 * destino do favorecido (`pctCodSeq` de `cmn025/ctcorr`). Os campos de SELEÇÃO
 * (`op`, `bncCodFin015`, `titVldReflexoDda*`) são montados pelo client nos dois níveis
 * que o ERP exige — ver `ConexosSispagWriteClient.importarTitulos`.
 */
export interface ImportarTitulosParams {
    filCod: number;
    bncCod: number;
    flpCod: number;
    /** Itens de seleção (linhas cruas do `titulosPendentes/list` dos títulos escolhidos). */
    itens: Array<Record<string, unknown>>;
    /** Operação da seleção. Default 1 (o valor provado em HML). */
    op?: number;
    /**
     * Pedir ao ERP que associe o boleto DDA deste título (`titVldReflexoDdaAssoc: 1`).
     *
     * Com isto o ERP anexa o código de barras ao item (`itsNumCodbar`), marca
     * `vldVinculoDda = 1` e deriva a modalidade correta do banco emissor — provado ao vivo em
     * HML (2026-08-27). O caminho passa por uma PERGUNTA do ERP, que `importarTitulos`
     * responde sozinho **só** para a chave allowlistada. Default `false` = comportamento
     * histórico (manda `0`, nenhum boleto é associado).
     */
    associarDda?: boolean;
}

/** Parâmetros para gerar a remessa `.REM` de um lote FINALIZADO (`gerArquivosBancos/gerarRemessa`). */
export interface GerarRemessaParams {
    filCod: number;
    bncCod: number;
    flpCod: number;
    /** Config de remessa: 1 = "REMESSA SISPAG - ITAÚ" (confirmado). */
    grbCodSeq: number;
    /** Nº da remessa (auto na tela; obrigatório no POST). */
    seqNum: number;
    /** Nome do arquivo (padrão `PG{DDMM}{seq}.REM`; obrigatório no POST). */
    gabEspNomeArquivo: string;
}

/** Confirmação da geração de remessa (o ERP responde `valid:'SUCESSO'`). */
export interface RemessaGerada {
    sucesso: boolean;
    mensagem?: string;
}

/** Um arquivo de remessa gerado (linha de `gerArquivosBancos/list`) — traz o `.REM` inteiro. */
export interface ArquivoRemessa {
    gabCod: number;
    /** Nome do arquivo (ex. `PG171101.REM`). */
    nomeArquivo?: string;
    /** Nº da remessa. */
    numRemessa?: string;
    /** Conteúdo do `.REM` (CNAB 240 gerado nativamente) — `gabLngDados`. */
    conteudo?: string;
}

/**
 * Estado observado do lote nativo no fin015 — a fonte da verdade para retomar uma
 * sequência interrompida. Ver `ConexosSispagWriteClient.getLoteNativo` para o encoding
 * de `status`, que foi medido em produção e não inferido.
 */
export interface LoteNativoEstado {
    filCod: number;
    bncCod: number;
    flpCod: number;
    /** 0 aberto · 1 finalizado · 2 cancelado · 3 outro terminal. */
    status: number;
    titulosCount: number;
    soma: number;
    /** Conta pagadora do lote — parte da impressão digital na busca por órfão. */
    ccoCod?: number;
    /** `flpDtaCredito` — a data de débito pedida. Também compõe a impressão digital. */
    dataDebito?: number;
    finalizadoEm?: number;
}

/** Uma linha digitável de boleto já anexada a um item do lote nativo. */
export interface ItemLinhaDigitavel {
    docCod: string;
    titCod: string;
    /** 47 dígitos, com os 4 verificadores conferidos no boundary. */
    linhaDigitavel: string;
    /** Filial do item no rascunho nativo (fallback: a do lote). */
    filCod: number;
    /** Sequencial nativo do item. Ausente = identidade incompleta (nunca chute). */
    itsCodSeq?: number;
}

/**
 * Resultado de `listarLinhasDigitaveisDoLote`.
 *
 * `total` conta os itens do lote que AFIRMAM ter boleto (`itsNumCodbar` presente); `dropped`,
 * quantos desses foram recusados por não passar nos dígitos verificadores. Item sem o campo
 * não entra em nenhum dos dois — não tem boleto, e isso é o estágio normal, não uma perda.
 *
 * A contagem existe porque a recusa precisa ser VISÍVEL: sem ela, um código corrompido vira
 * um botão de copiar a menos, indistinguível de "este título não é boleto".
 * Invariante: `itens.length + dropped === total`.
 */
export interface LinhasDigitaveisDoLote {
    itens: ItemLinhaDigitavel[];
    total: number;
    dropped: number;
    /**
     * Identidade (nunca o código) dos itens recusados — `docCod: ''` quando a linha nem a tinha.
     * Presente só quando há recusados; ausente equivale a `[]`. Invariante:
     * `itens.length + (invalidos?.length ?? 0) === total` e `dropped === invalidos.length`.
     * Uso interno do backend (guarda de código repetido, I16c); não é exposto na API do painel.
     */
    invalidos?: Array<{ docCod: string; titCod: string; filCod: number; itsCodSeq?: number }>;
    /**
     * `true` = a lista foi lida até o fim (página curta ou `count` alcançado). `false` = truncada
     * por `maxPaginas`: quem decide retirada ABORTA, nunca assume "o resto não tem repetido".
     */
    completa: boolean;
    /**
     * Identidade (nunca código) dos itens do rascunho que AINDA NÃO têm código de barras, só os
     * que trazem `itsCodSeq` (sem ele não há como apagar). Ausente equivale a `[]`. Serve à
     * retirada por vínculo falho (ADR-0071, I17g(3)): o item sem código precisa de identidade
     * nativa para o `DELETE` e para a confirmação de ausência. Não entra em `total`/`dropped`.
     */
    semCodigo?: Array<{ docCod: string; titCod: string; filCod: number; itsCodSeq: number }>;
}

/** Resultado de `validacao/codigoBarras`: o ERP só DECODIFICA (não valida DV, HML #3). */
export interface ValidacaoCodigoBarras {
    /** Quebra do código devolvida pelo ERP; reenviada VERBATIM ao `confirmaCodigoBarras`. */
    splitCodBar: unknown;
    /** Valor decodificado da barra (reais). */
    barraVlrPgto: number;
    /** Vencimento decodificado da barra (epoch ms, UTC meia-noite). */
    barraDtaVencimento: number;
}

/** Resultado de `confirmaCodigoBarras` — o que o item precisa para ficar "completo" (HML #6). */
export interface ConfirmacaoCodigoBarras {
    /** valor da barra + juros − desconto (reais). */
    itsMnyVlrPgtoResult: number;
    /** vencimento da barra (epoch ms). A data que o ERP usa para pagar é esta (HML #5). */
    itsDtaPgtoResult: number;
    itsBncNumCodbancoResult: string | number;
    itsBncDesNomeResult: string;
}

/** Linha do `finItemSispag/list`, com a identidade validada e a row CRUA em `row`. */
export interface ItemDoRascunho {
    filCod: number;
    docCod: string;
    titCod: string;
    /** Ausente = identidade incompleta (nunca chute). */
    itsCodSeq?: number;
    /**
     * Item de BORDERÔ (boleto agrupado, ADR-0077): a linha não tem `docCod/titCod`, tem `borCod`.
     * Presente só nesse caso; `docCod` fica `''`.
     */
    borCod?: number;
    row: Record<string, unknown>;
}

/** Linha de `borderosPendentes/list` (I21n): identidade validada + a row crua para o `importar`. */
export interface LinhaBorderoPendente {
    filCod: number;
    borCod: number;
    /** Total do borderô segundo o grid (conferência; a prova é a releitura do item). */
    vlrTotal?: number;
    /** Row verbatim do ERP (vai inteira no `importar`). Não traz `borTimCad`. */
    row: Record<string, unknown>;
}

/** Item de borderô no rascunho nativo (I21n/I21o): sem `docCod/titCod`. */
export interface ItemDeBordero {
    filCod: number;
    borCod: number;
    itsCodSeq: number;
    itsMnyValor: number;
    itsVldModalidade?: number;
    row: Record<string, unknown>;
}

/** Os cinco campos que o vínculo altera no item (I17e). Nenhum outro. */
export interface AlteracaoItemCodigoBarras {
    itsNumCodbar: string;
    itsNumBanco: string | number;
    bncDesNome: string;
    itsMnyVlrPgto: number;
    itsDtaPgto: number;
    /**
     * Só quando o banco do código ≠ banco do lote (HML V4, 2026-10-14): o item precisa estar em
     * modalidade `7` ("boleto de outro banco"); com `6` o `finalizar` recusa ("A MODALIDADE DO
     * TÍTULO É PRÓPRIA E O BANCO FAVORECIDO NÃO É O MESMO DA REMESSA"). Ausente = não muda.
     */
    itsVldModalidade?: number;
}
