/**
 * SISPAG (Escopo II) — interfaces do painel READ-ONLY (spike / semente da Fatia 1).
 *
 * DTOs mapeados a partir dos reads confirmados em produção (Conexos PRD, probe
 * read-only `jobs/probe-sispag.ts`): fin064 (carteira a pagar), fin015 (lote
 * SISPAG nativo), fin010 (borderô a-pagar). NENHUMA escrita — o painel só lê,
 * exibe e SIMULA o fluxo (montar → finalizar → enviar → retorno → baixa).
 */

/** Um título a pagar (parcela) — fonte `fin064/list` (Gestão de Pagamentos). */
export interface TituloAPagar {
    docCod: string;
    titCod: string;
    filCod: number;
    /** Nome do credor/favorecido (`dpeNomPessoa`); pode faltar no list. */
    credor?: string;
    valor: number;
    moeda?: string;
    /** Vencimento (epoch-ms) — `titDtaVencimento`. */
    vencimento?: number;
    /** Dias até o vencimento (negativo = vencido). Derivado. */
    diasAteVencimento?: number;
    /** Liberado para pagamento (alçada) — `vldLib`. */
    liberado: boolean;
    /** Já pago — `vldPago`. */
    pago: boolean;
    banco?: string;
    /** Nº da remessa se já entrou num lote — `titNumRemessa`. */
    numRemessa?: string;
    /** Tem código de barras (`titEspCodbar`) = candidato a BOLETO (A2, auto-detecção). */
    temBoleto?: boolean;
    /** Formas de pagamento disponíveis no cadastro do favorecido (A2 opção B) — leitura ao vivo. */
    modalidadesDisponiveis?: Modalidade[];
    /** Já está num lote RASCUNHO — não pode ser atachado a outro (I3). Bloqueia a seleção. */
    emLote?: boolean;
    // ---- campos da carteira PERSISTIDA (ingestão) ----
    pesCod?: string;
    tpdCod?: string;
    /** Heurística informativa da ingestão: tem modalidade + destino (banco/conta, barras ou PIX)?
     *  A validação autoritativa é no envio (Fatia 3), ao vivo. */
    prontoParaRemessa?: boolean;
    /** false quando o título sumiu da ingestão mais recente (anti-fantasma). */
    ativo?: boolean;
}

/**
 * Uma conta corrente cadastrada do favorecido (`CmnPessoasCtcorr` / `cmn025/ctcorr`).
 * Fonte AUTORITATIVA do destino de pagamento — o `fin064` não carrega essa informação.
 * `pctCodSeq` é a chave que o item do lote fin015 (`FinItemSispag`) referencia.
 */
export interface ContaFavorecido {
    pctCodSeq: number;
    /** Código FEBRABAN do banco (ex.: 341 = Itaú, 1 = Banco do Brasil). */
    banco: number;
    bancoNome?: string;
    agencia?: string;
    conta?: string;
    dvConta?: string;
    /** Conta default do favorecido (`pctVldDefault`) — a que a tela do ERP usa. */
    padrao: boolean;
}

/**
 * Conta corrente PAGADORA da Columbia (`fin005`) — de onde o dinheiro sai.
 *
 * ⚠️ `ccoCod` NÃO é global: o mesmo código aponta para contas DIFERENTES em cada filial.
 * Na filial 1 o `ccoCod=1` é o Itaú ag 0641; na filial 2 é uma conta Banestes. Fixar o
 * código gerou um `.REM` com header do banco errado. Sempre resolver pela filial.
 */
export interface ContaCorrentePagadora {
    ccoCod: number;
    /** Código INTERNO do banco no Conexos (≠ FEBRABAN). */
    bncCod: number;
    agencia?: string;
    numeroConta?: number;
    dvConta?: string;
    /** Conta financeira (plano gerencial, fin004) vinculada — usada na conciliação contábil. */
    gerNum?: number;
    gerDes?: string;
}

/** Run de auditoria da ingestão de pagamentos (cron ou manual). */
export interface PagamentoIngestaoRun {
    id: string;
    triggeredBy: string;
    status: 'running' | 'success' | 'error';
    totalTitulos: number;
    totalInativados: number;
    startedAt: string;
    finishedAt?: string;
    errorMessage?: string;
}

/** Resultado de uma execução de ingestão. */
export interface IngestaoPagamentosResult {
    runId: string;
    status: 'success' | 'error';
    totalTitulos: number;
    totalInativados: number;
}

/** Um lote SISPAG nativo — fonte `fin015/list`. */
export interface LoteSispag {
    filCod: number;
    flpCod: number;
    banco?: string;
    conta?: string;
    layoutConta?: string;
    /** flpVldStatus: 0=rascunho, 1=finalizado, 2=cancelado (heurística). */
    status: number;
    /** flpVldConfEnvio — envio ao banco confirmado. */
    envioConfirmado: boolean;
    /** flpVldRet — retorno processado. */
    retornoProcessado: boolean;
    titulosCount: number;
    soma: number;
    itensRetorno: number;
    finalizadoPor?: string;
    dataCredito?: number;
}

/** Um borderô a-pagar (baixa) — fonte `fin010/list` (borVldTipo=2). */
export interface BorderoAPagar {
    borCod: number;
    filCod: number;
    descricao?: string;
    valor: number;
    data?: number;
    /** borVldFinalizado. */
    finalizado: number;
    /** vldHasRemessaPgto — a baixa passou por remessa SISPAG? (quase sempre 0). */
    temRemessa: boolean;
    temBaixa: boolean;
}

/** KPIs agregados do painel. */
export interface SispagKpis {
    titulosAVencer7d: number;
    titulosAVencer30d: number;
    titulosVencidos: number;
    valorAVencer30d: number;
    lotesAbertos: number;
    lotesEnviados: number;
}

/** Resposta do painel SISPAG (read-only). */
export interface SispagPainelResponse {
    geradoEm: string;
    /** Guard-rails do ambiente (para o banner de segurança na UI). */
    modo: {
        somenteLeitura: true;
        conexosWriteEnabled: boolean;
        conexosDryRun: boolean;
    };
    /** Proveniência da carteira: quando foi a última ingestão bem-sucedida. */
    ingestao: {
        ultimaRunEm?: string;
    };
    kpis: SispagKpis;
    titulos: TituloAPagar[];
    /**
     * Tamanho da carteira ANTES do corte de payload. Quando for maior que
     * `titulos.length`, a UI está mostrando um pedaço e precisa dizer isso.
     */
    titulosTotal: number;
    lotes: LoteSispag[];
}

// ============================================================ Fatia 2 — LotePagamento
// Lote candidato LOCAL montado pela analista (ADR-0015). NENHUMA escrita no ERP.
// Ver ontology/state-machines/lote-pagamento.md e entities/lote-pagamento.md.

/** Estados do lote candidato — constantes tipadas (nunca strings cruas). */
export const LOTE_STATUS = {
    RASCUNHO: 'RASCUNHO',
    FINALIZADO: 'FINALIZADO',
    CANCELADO: 'CANCELADO',
    /**
     * Remessa `.REM` gerada no Conexos (fin015). NÃO é "enviado": o ERP não transmite
     * remessa de pagamento — o transporte ao banco é externo e manual.
     */
    REMESSA_GERADA: 'REMESSA_GERADA',
    /** Retorno do banco (`.RET`) processado no fin052. */
    RETORNADO: 'RETORNADO',
    /** Baixa confirmada no fin010 para todos os itens não rejeitados. */
    BAIXADO: 'BAIXADO',
} as const;

export type LotePagamentoStatus = (typeof LOTE_STATUS)[keyof typeof LOTE_STATUS];

/**
 * Conta pagadora DEFAULT do lote (A3): tudo sai pelo Itaú; o analista troca na
 * revisão só na exceção rara (fornecedor que não aceita boleto via Itaú). O lote
 * nativo fin015 é por conta pagadora (a conta da Columbia de onde sai o dinheiro).
 */
export const CONTA_PAGADORA_DEFAULT = { banco: 'ITAÚ', conta: '55795-4' } as const;

/**
 * Formas de pagamento (modalidade) de um item do lote (A2). Mapeiam a modalidade
 * nativa do fin015 (boleto=segmento J, crédito conta/TED=segmento A, PIX). `null`
 * no item = "a definir" (o analista precisa escolher antes de finalizar).
 */
export const MODALIDADE = {
    BOLETO: 'BOLETO',
    TED: 'TED',
    PIX: 'PIX',
    CREDITO_CONTA: 'CREDITO_CONTA',
} as const;

export type Modalidade = (typeof MODALIDADE)[keyof typeof MODALIDADE];

/** Um título incluído num lote — snapshot de valor/venc/credor no momento da inclusão. */
export interface ItemLote {
    loteId: string;
    filCod: number;
    docCod: string;
    titCod: string;
    credor?: string;
    valor?: number;
    vencimento?: number;
    /** Forma de pagamento (A2). `undefined` = "a definir" — bloqueia a finalização. */
    modalidade?: Modalidade;
    incluidoPor: string;
    incluidoEm?: string;
    /** Sequencial do item no lote NATIVO — 4ª parte da chave que viaja no `.REM`/`.RET`. */
    nativeItsCodSeq?: number;
    // ── resultado da conciliação do retorno (fin052/arquivosRetornoDetalhe) ──
    /** Código do evento bancário. Itaú: `00` = PAGAMENTO EFETUADO. */
    retornoEvento?: string;
    retornoDescricao?: string;
    /** `true` quando o evento é de rejeição (`fbeVldTpret = 2`). */
    rejeitado?: boolean;
    /** Borderô e baixa gravados no fin010 — o elo que o ERP não guarda consultável. */
    borCod?: number;
    bxaCodSeq?: number;
    conciliadoEm?: string;
}

/** Lote candidato (raiz do agregado). */
export interface LotePagamento {
    id: string;
    filCod: number;
    banco?: string;
    conta?: string;
    status: LotePagamentoStatus;
    criadoPor: string;
    finalizadoPor?: string;
    finalizadoEm?: string;
    versao: number;
    criadoEm?: string;
    /** Formado pelo cron de formação automática (vs. montado manualmente pelo analista). */
    automatico?: boolean;
    // ── 0049: ponte com o lote NATIVO do Conexos (fin015) ──
    // A chave é COMPOSTA: o ERP recicla `flpCod`, então o número sozinho não identifica nada.
    nativeFilCod?: number;
    nativeBncCod?: number;
    nativeFlpCod?: number;
    nativeGabCod?: number;
    remessaArquivo?: string;
    remessaNum?: number;
    remessaGeradaEm?: string;
    /** Conta corrente pagadora (fin005) e sua conta financeira (fin004). */
    ccoCod?: number;
    gerNum?: number;
    itens: ItemLote[];
}

/** Resultado de um run de formação automática de lotes. */
export interface FormacaoLotesResult {
    lotesFormados: number;
    titulosLotados: number;
    lotesDesfeitos: number;
}

/** Entrada — criar lote. */
export interface CriarLoteInput {
    filCod: number;
    banco?: string;
    conta?: string;
    ator: string;
}

/** Entrada — incluir título no lote (identidade; valores autoritativos vêm do ERP no serviço). */
export interface IncluirTituloInput {
    loteId: string;
    filCod: number;
    docCod: string;
    titCod: string;
    ator: string;
}

/** Filtros de listagem de lotes. */
export interface ListarLotesFiltro {
    status?: LotePagamentoStatus;
    filCod?: number;
}
