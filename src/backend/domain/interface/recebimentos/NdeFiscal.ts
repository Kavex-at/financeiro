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
