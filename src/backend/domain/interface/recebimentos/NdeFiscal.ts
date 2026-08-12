/**
 * Tipos da leg FISCAL da NDe (com300 fiscal + com131 observações + com194 validações + poll com297).
 * Fecha o GAP `nota-debito-fiscal` do writer permutas. Cada chamada tem seu PRÓPRIO discriminador de
 * sucesso — ver `ConexosNdeFiscalClient` e `_inbox/recebimentos-numerario-real-fiscal-spec.md`.
 */

/**
 * O objeto `finDocFiscal` do com300 (~73 campos). Read-modify-write OBRIGATÓRIO: o handler do front
 * grava o objeto INTEIRO, então qualquer campo omitido vira `null` no banco. Só tipamos os campos que
 * a automação lê/escreve; o resto viaja em `[k: string]: unknown` (o Zod usa `.passthrough()`).
 */
export interface DocFiscal {
    filCod: number;
    docTip: number;
    docCod: number;
    fisCod: number;
    /** Alvo do RMW — `6` = PAGAMENTO ANTECIPADO. Inteiro. */
    fisVldTipoNfDebito: number;
    /** NÃO tocar (observado `0`). */
    fisVldTipoNfCredito?: number;
    [key: string]: unknown;
}

/** Resposta do com131 (observações). `fisEspObs` preenchido ⟺ observação SINIEF gerada. */
export interface ObservacoesFiscais {
    fisEspObs?: string;
    docMemObs?: string;
    fisEspInfadfisco?: string;
}

/** Linha de validação do com194 (mostrada no modal "VALIDAÇÃO - COM_194"). Logada quando homologa=2. */
export interface ValidacaoDocumento {
    fdvCodSeq?: number;
    fdvEspErr?: string;
    fdvEspObs?: string;
    fdvVldErr?: number;
}

/**
 * Resumo de uma linha de produto do com297 (`comDocProdutos/list`) — o suficiente para LOCALIZAR o item
 * (chave composta `docCod`+`fisCod`+`prdCod`+`dprCodSeq`) e decidir se a descrição de impressão precisa
 * de conserto.
 *
 * `dprLngDescrNf` ("Descrição para Impressão", `maxLength 4000`) é o campo que vira o `xProd` da NF-e.
 * Quem o preenche na GERAÇÃO é o ERP, aplicando a regra do cadastro do CLIENTE (`cmn025` →
 * `CmnDadosPessoas.dpeVld1DescrNfe`: `1` = Descrição Produto, `4` = Descrição DI, …). Com a regra em
 * "Descrição DI" e um produto de encargo (41978 PAGAMENTO ANTECIPADO, que não tem adição de DI) o campo
 * sai VAZIO e a homologação é recusada — ver `business-rules/descricao-item-nde.md`.
 *
 * **Projeção NORMALIZADA, não o eco cru do ERP** — daí os dois opcionais serem `?: string` e não
 * `?: string | null` como no `ItemNde`. O ERP usa `null` e string em branco indistintamente para "sem
 * descrição"; o `listItensNde` colapsa os dois em AUSENTE antes de projetar aqui. É esse colapso que
 * deixa o caller decidir com um único teste (`=== undefined`) em vez de repetir `null || '' ||
 * undefined` em cada uso. A linha CRUA, com os `null` preservados para o read-modify-write, é o `ItemNde`.
 */
export interface ItemNdeResumo {
    docCod: number;
    fisCod: number;
    prdCod: number;
    dprCodSeq: number;
    /** Descrição CADASTRADA do produto (join do cadastro de produtos). Fonte do fallback. */
    prdDesNome?: string;
    /** Descrição para Impressão — o `xProd` da NF-e. Ausente ⟹ a NF-e não homologa. */
    dprLngDescrNf?: string;
}

/**
 * A linha de produto INTEIRA do com297 (~105 campos). Mesma doutrina read-modify-write do `DocFiscal`:
 * o `PUT com297/comDocProdutos` reenvia o objeto completo, então campo omitido vira `null`. Só tipamos
 * a chave composta + o alvo da escrita; o resto viaja em `[k: string]: unknown` (Zod `.passthrough()`).
 */
export interface ItemNde {
    docCod: number;
    fisCod: number;
    prdCod: number;
    dprCodSeq: number;
    /** `null` é o que o ERP devolve para "sem descrição" — preservado no RMW, não normalizado. */
    dprLngDescrNf?: string | null;
    [key: string]: unknown;
}

/**
 * Campos de status do documento com297 lidos no `GET com297/{docCod}` — pré-condição de homologação
 * (`docVldConferencia`/`vldEnviarConferencia`), roteamento (`vldTpNf`) e poll de autorização SEFAZ
 * (`vldAutorizado`, assíncrono: continua `0` logo após homologar).
 */
export interface DocStatusFiscal {
    vldAutorizado?: number;
    docVldNfehom?: number;
    vldStatus?: number;
    vldTpNf?: string;
    docVldConferencia?: number;
    vldEnviarConferencia?: number;
    docMnyValor?: number;
    docEspNumero?: string;
}
