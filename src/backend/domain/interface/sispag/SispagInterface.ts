import type { PayeeItemWarning } from './AuthorizedPayeeInterface.js';
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
    /**
     * Forma de pagamento do título NO CONEXOS (`titVldPagopor`, ver `PAGO_POR_CONEXOS`).
     * Independente de `temBoleto` (vínculo DDA). Indefinido = nunca lido no grid de pendentes.
     */
    formaPagamentoConexos?: number;
    /** Formas de pagamento disponíveis no cadastro do favorecido (A2 opção B) — leitura ao vivo. */
    modalidadesDisponiveis?: Modalidade[];
    /** Já está num lote RASCUNHO — não pode ser atachado a outro (I3). Bloqueia a seleção. */
    emLote?: boolean;
    /** O lote RASCUNHO em que o título está (ADR-0050) — a linha mostra e linka o lote. */
    loteRascunho?: LoteRascunhoRef;
    /** Lote FINALIZADO / com remessa gerada que já tem o título (ADR-0064) — não se move. */
    loteComprometido?: LoteComprometidoRef;
    // ---- campos da carteira PERSISTIDA (ingestão) ----
    pesCod?: string;
    tpdCod?: string;
    /** Heurística informativa da ingestão: tem modalidade + destino (banco/conta, barras ou PIX)?
     *  A validação autoritativa é no envio (Fatia 3), ao vivo. */
    prontoParaRemessa?: boolean;
    /** false quando o título sumiu da ingestão mais recente (anti-fantasma). */
    ativo?: boolean;
}

/** Referência ao lote RASCUNHO que contém um título (projeção de `ItemLote` no painel). */
export interface LoteRascunhoRef {
    id: string;
    automatico: boolean;
}

/** Chave natural de um título a pagar. */
export interface ChaveTitulo {
    filCod: number;
    docCod: string;
    titCod: string;
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
 * Tipos de chave PIX (ADR-0054 D4). O tipo NUNCA é inferido: 11 dígitos são CPF ou celular.
 * Na chave digitada quem escolhe é a analista; na do cadastro vem de `cixVldTipo`.
 */
export const CHAVE_PIX_TIPO = {
    TELEFONE: 'TELEFONE',
    EMAIL: 'EMAIL',
    CPF_CNPJ: 'CPF_CNPJ',
    ALEATORIA: 'ALEATORIA',
} as const;

export type ChavePixTipo = (typeof CHAVE_PIX_TIPO)[keyof typeof CHAVE_PIX_TIPO];

/**
 * `cixVldTipo` do `cmn025/cmnPessoasPix` → tipo da chave. Encoding medido no schema do ERP
 * (plano §2: 1 telefone, 2 e-mail, 3 CPF/CNPJ, 4 aleatória). Código fora do mapa = tipo
 * desconhecido (`undefined`), nunca um palpite.
 */
export const CHAVE_PIX_TIPO_POR_CIX_VLD_TIPO: Readonly<Record<number, ChavePixTipo>> = {
    1: CHAVE_PIX_TIPO.TELEFONE,
    2: CHAVE_PIX_TIPO.EMAIL,
    3: CHAVE_PIX_TIPO.CPF_CNPJ,
    4: CHAVE_PIX_TIPO.ALEATORIA,
};

/**
 * Uma chave PIX ATIVA do favorecido (`cmn025/cmnPessoasPix`, por `pesCod`). É a chave do
 * FORNECEDOR — a do `fin005/cmnPessoasPix` é da própria Columbia e não serve de destino.
 * `chave` é dado sensível (I10h): nunca em log, ledger ou mensagem de erro.
 */
export interface ChavePixFavorecido {
    cixCod: number;
    chave: string;
    tipo?: ChavePixTipo;
    /** `cixVldDefault === 1`. */
    padrao: boolean;
    pesCod: string;
}

/**
 * Uma pessoa do cadastro do Conexos (`cmn025/list`), achada pela busca do pedido de autorização.
 * `documento` (só dígitos) é dado do cadastro: sai do backend só mascarado.
 */
export interface PessoaCadastro {
    pesCod: string;
    nome: string;
    nomeFantasia?: string;
    documento?: string;
    /** `pesVldStatus`: 1 ATIVO, 2 INATIVO, 3 EM CADASTRO, 4 BLOQUEADO, 5 NÃO VENDER. */
    situacao?: number;
}

/** Resultado da busca: `truncado` quando o ERP tem mais linhas do que a página devolveu. */
export interface BuscaPessoasResultado {
    pessoas: PessoaCadastro[];
    truncado: boolean;
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
    /** Filiais cuja leitura falhou nesta run (leitura parcial). Ausente/vazio = todas lidas. */
    filiaisComFalha?: number[];
    /** Filiais cujo flag de boleto DDA não pôde ser lido: o valor anterior foi preservado. */
    filiaisSemFlagBoleto?: number[];
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
    /** Execuções de escrita presas — ver `ExecucoesParadas`. */
    execucoesParadas: ExecucoesParadas;
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
    /** Rejeição LIDA no fin052 (`fbeVldTpret = 2`) em algum item — exige olho humano (ADR-0055). */
    RETORNADO: 'RETORNADO',
    /** Todo título do lote pago no fin064, de qualquer origem (ADR-0055). Terminal. */
    BAIXADO: 'BAIXADO',
} as const;

export type LotePagamentoStatus = (typeof LOTE_STATUS)[keyof typeof LOTE_STATUS];

/**
 * Situação DERIVADA de um item do lote pela sincronização (I11d, ADR-0055). Não é estado do lote:
 * o lote espera em `REMESSA_GERADA` enquanto os itens caminham. Precedência de cima para baixo.
 */
export const ITEM_SITUACAO = {
    /** Rejeição lida no fin052 (`fbeVldTpret = 2`). Vence tudo, inclusive o título pago (I11f). */
    REJEITADO: 'REJEITADO',
    /** Título pago no fin064 (`vldPago = 1 ∧ aberto = 0`), de qualquer origem (I11b). */
    PAGO: 'PAGO',
    /** Evento `BD` (agendado) ou `00` (efetuado) no fin052, título ainda não baixado no ERP. */
    AGENDADO: 'AGENDADO',
    /** Nada lido ainda. */
    SEM_RETORNO: 'SEM_RETORNO',
} as const;

export type ItemSituacao = (typeof ITEM_SITUACAO)[keyof typeof ITEM_SITUACAO];

/**
 * Origem da baixa de um item pago. Manual × nativo NÃO é distinguido: não é observável com
 * segurança (ADR-0055, alternativas).
 */
export const ORIGEM_BAIXA = {
    /** A baixa está ligada a um retorno deste lote (linha do fin052 com borderô/baixa). */
    REMESSA: 'REMESSA',
    /** Baixa no título sem vínculo com o retorno: fin010 manual ou processamento nativo. */
    FORA_DO_RETORNO: 'FORA_DO_RETORNO',
    /** Pago no fin064, mas as baixas do título (PSQ_018) não puderam ser lidas. */
    NAO_IDENTIFICADA: 'NAO_IDENTIFICADA',
} as const;

export type OrigemBaixa = (typeof ORIGEM_BAIXA)[keyof typeof ORIGEM_BAIXA];

/** De onde vieram `borCod`/`bxaCodSeq` do item. Enriquecimento, nunca prova de pagamento. */
export const BAIXA_FONTE = {
    /** Linha de detalhe do retorno (`fin052/arquivosRetornoDetalhe`). */
    RETORNO: 'RETORNO',
    /** Baixas do título (`com308/financeiroAPagar/baixas`, PSQ_018). */
    TITULO: 'TITULO',
} as const;

export type BaixaFonte = (typeof BAIXA_FONTE)[keyof typeof BAIXA_FONTE];

/**
 * Leitura do título no fin064 para a sincronização (I11c): TRI-ESTADO. `legivel: false` não é
 * "não pago" — é "não sei", e a sincronização não decide nada com isso.
 */
export type LeituraTitulo =
    | {
          legivel: true;
          /** `vldPago` lido e reconhecido (1/'1'/true → true; 0/'0'/false → false). */
          vldPago: boolean;
          /** Valor em aberto (`totalAberto`, com `titMnyAberto` como reserva). */
          aberto: number;
          /** Valor pago segundo o fin064 (`totalPago`/`titMnyTotPago`), quando presente. */
          valorPagoTitulo?: number;
      }
    | { legivel: false; motivo: string };

/** Uma baixa do título lida no PSQ_018 (com308). Enriquecimento. */
export interface BaixaDoTitulo {
    borCod: number;
    bxaCodSeq?: number;
    /** ISO-8601 da data de movimento do borderô. */
    data?: string;
    usuario?: string;
    valor?: number;
}

/** Leitura das baixas do título (PSQ_018). 403 do robô = ilegível, não "sem baixa" (I11c). */
export type LeituraBaixas =
    | { legivel: true; baixas: BaixaDoTitulo[] }
    | { legivel: false; motivo: string; status?: number };

/**
 * Banco padrão da conta pagadora (A3): tudo sai pelo Itaú; o analista troca na revisão só na
 * exceção rara (fornecedor que não aceita boleto via Itaú). `bncCod` é o código INTERNO do
 * Conexos (≠ FEBRABAN 341). O lote nativo fin015 é por conta pagadora.
 */
export const ITAU_BNCCOD = 4;

/**
 * Conta Itaú PREFERIDA — só desempata quando a filial tem mais de uma conta Itaú no `fin005`.
 * NUNCA é gravada às cegas num lote: quem decide a conta é o `ContaPagadoraResolver`, a partir
 * das contas que a filial realmente tem (G-13). Antes, todo lote automático nascia com esta
 * conta, exista ela ou não na filial, e a remessa compensava caindo na primeira conta do `fin005`
 * (ordem arbitrária, às vezes de outro banco).
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
    /**
     * Autorização do favorecido vigente quando o destino do item congelou no import do `fin015`
     * (ADR-0065 I10f): só rastreio, nunca o valor.
     */
    favorecidoAutorizadoId?: string;
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
    // ── sincronização pelo título (0069, ADR-0055, I11) ──
    /** Situação derivada (I11d). Ausente = nunca sincronizado. */
    situacao?: ItemSituacao;
    /** Data (ISO) da baixa, do PSQ_018 quando legível. */
    pagoEm?: string;
    /** Primeira sincronização (ISO) que viu o título pago no fin064. */
    pagoObservadoEm?: string;
    /** Valor da baixa, do PSQ_018 quando legível. */
    valorPago?: number;
    origemBaixa?: OrigemBaixa;
    baixaFonte?: BaixaFonte;
    /** Contradição que a máquina não resolve (estorno, rejeitado com título pago) — I11f. */
    divergencia: boolean;
    divergenciaDetalhe?: string;
    /** Última leitura bem-sucedida do título (ISO). Não mexe em `versao` (I11h). */
    sincronizadoEm?: string;
    // ── 0076: verificação TED/PIX (ADR-0063) ──
    /** I13b. Ausente = nunca verificado (boleto, "a definir"). `PENDENTE` barra o finalizar. */
    verificacaoEstado?: PaymentCheckState;
    verificadoEm?: string;
    /** O que a verificação viu do destino: só a MÁSCARA (I10h, I14l). */
    destinoMascarado?: string;
    /**
     * Selo do item TED/PIX (ADR-0065 I14e): o último resultado da verificação do favorecido
     * autorizado. Ausente = nunca verificado (boleto, "a definir") ou leitura que falhou (PENDENTE).
     */
    autorizacaoAviso?: PayeeItemWarning;
    /** Alertas vivas do item neste lote (ABERTA | RESOLVIDA), com a justificativa. */
    alertas?: AlertaItemLote[];
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
    /**
     * Data de débito da remessa (`'YYYY-MM-DD'`, data civil) — I8, ADR-0049. Gravada ANTES do
     * `criarLote` do fin015 e congelada a partir dele. Ausente = remessa ainda não pedida, ou
     * lote legado (anterior à 0061).
     */
    dataDebito?: string;
    itens: ItemLote[];
}

/** O título cujo vencimento define o limite superior da janela de débito (I8a). */
export interface TituloLimitante {
    /** `filCod:docCod:titCod`. */
    itemId: string;
    credor?: string;
    /** `docCod/titCod`. */
    documento: string;
    /** `'YYYY-MM-DD'`; ausente quando o item não tem vencimento. */
    vencimento?: string;
}

/**
 * Janela permitida para a data de débito de um lote FINALIZADO (I8, ADR-0049). Calculada no
 * backend — o frontend só exibe, não reimplementa o calendário. Datas civis `'YYYY-MM-DD'`.
 */
export interface JanelaDataDebito {
    /** Hoje em `America/Sao_Paulo`. */
    hoje: string;
    /** Default da tela = `min`. */
    sugerida?: string;
    /** Próximo dia útil depois de hoje, quando cabe na janela. */
    amanha?: string;
    min?: string;
    max?: string;
    limitante?: TituloLimitante;
    /** Dias não úteis dentro de `[min, max]` (o input nativo não sabe desabilitá-los). */
    naoUteis: string[];
    /** Presente quando não existe data possível. */
    vazia?: { motivo: 'titulo_vencido' | 'sem_dia_util' | 'titulo_sem_vencimento' };
    /** Presente quando o lote nativo já nasceu com uma data (I8b). */
    congelada?: {
        data: string;
        nativeFlpCod: number;
        /** `no_passado` = a data congelada já passou; o ERP a recusará se ainda não finalizou. */
        motivo: 'lote_nativo_criado' | 'no_passado';
    };
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
    /**
     * ADR-0064 — o título pode estar em OUTRO lote RASCUNHO: sai de lá e entra neste na mesma
     * transação. Sem a flag, I3 barra (`TituloEmOutroLoteError`). Lote comprometido nunca move.
     */
    mover?: boolean;
}

/** Status de lote que COMPROMETEM o título (ADR-0064): não entra em outro lote nem se move. */
export const LOTE_STATUS_COMPROMETIDO = ['FINALIZADO', 'REMESSA_GERADA'] as const;

/** Lote comprometido que contém um título (projeção no painel e checagem no incluir). */
export interface LoteComprometidoRef {
    id: string;
    status: (typeof LOTE_STATUS_COMPROMETIDO)[number];
}

/** Filtros de listagem de lotes. */
export interface ListarLotesFiltro {
    status?: LotePagamentoStatus;
    filCod?: number;
}

/**
 * Resumo das execuções presas em `reconciling`, para a tela avisar quem pode agir.
 *
 * Existe porque o fail-closed é silencioso: ele impede o segundo pagamento, mas só se
 * manifesta se alguém tentar de novo. Sem este aviso, um lote nativo órfão no Conexos
 * pode ficar semanas sem ninguém saber.
 */
export interface ExecucoesParadas {
    remessa: number;
    conciliacao: number;
    /** Idade mínima considerada (minutos). */
    desdeMinutos: number;
    /** `flpCod` dos lotes nativos conhecidos — o número que se leva ao fin015. */
    lotesNativos: number[];
}

// ============================================================ ADR-0063/0065 — verificação TED/PIX
// Duplicidade e favorecido autorizado (I13, I14). Ver ontology/business-rules/
// verificacao-ted-pix-sispag.md e favorecido-autorizado-sispag.md. Nada aqui escreve no Conexos.

/** Ator das ações que o SISTEMA executa (retirada do item no finalizar, reaprovação). */
export const SISPAG_SYSTEM_ACTOR = 'sistema';

/** Tipo da `AlertaItemLote` (I13c, I13d). O alerta de canal habitual saiu na ADR-0065. */
export const ITEM_ALERT_TYPE = {
    DUPLICIDADE_FORTE: 'DUPLICIDADE_FORTE',
    DUPLICIDADE_FRACA: 'DUPLICIDADE_FRACA',
} as const;

export type ItemAlertType = (typeof ITEM_ALERT_TYPE)[keyof typeof ITEM_ALERT_TYPE];

/** As duas de duplicidade — só elas bloqueiam o finalizar (I13f). */
export const DUPLICATE_ALERT_TYPES: readonly ItemAlertType[] = [
    ITEM_ALERT_TYPE.DUPLICIDADE_FORTE,
    ITEM_ALERT_TYPE.DUPLICIDADE_FRACA,
];

/** Estado da `AlertaItemLote`. `OBSOLETA`/`DESCARTADA` só aparecem na trilha (gap Q12). */
export const ITEM_ALERT_STATE = {
    ABERTA: 'ABERTA',
    RESOLVIDA: 'RESOLVIDA',
    OBSOLETA: 'OBSOLETA',
    DESCARTADA: 'DESCARTADA',
} as const;

export type ItemAlertState = (typeof ITEM_ALERT_STATE)[keyof typeof ITEM_ALERT_STATE];

/** Resolução da alerta de duplicidade pela analista (I13f). */
export const ITEM_ALERT_RESOLUTION = {
    JUSTIFICADA: 'JUSTIFICADA',
    RETIRADA: 'RETIRADA',
} as const;

export type ItemAlertResolution =
    (typeof ITEM_ALERT_RESOLUTION)[keyof typeof ITEM_ALERT_RESOLUTION];

/** A ação pedida pela analista na rota (JUSTIFICAR mantém o item; RETIRAR o tira e bloqueia). */
export const DUPLICATE_ACTION = { JUSTIFICAR: 'JUSTIFICAR', RETIRAR: 'RETIRAR' } as const;

export type DuplicateAction = (typeof DUPLICATE_ACTION)[keyof typeof DUPLICATE_ACTION];

/** Estado da verificação de UM item TED/PIX (I13b). Ausente = nunca verificado (boleto, a definir). */
export const PAYMENT_CHECK_STATE = { PENDENTE: 'PENDENTE', OK: 'OK' } as const;

export type PaymentCheckState = (typeof PAYMENT_CHECK_STATE)[keyof typeof PAYMENT_CHECK_STATE];

/** Estado do `BloqueioDuplicidade` (I13g). */
export const DUPLICATE_HOLD_STATE = {
    ATIVO: 'ATIVO',
    ENCERRADO: 'ENCERRADO',
    DESFEITO: 'DESFEITO',
} as const;

export type DuplicateHoldState = (typeof DUPLICATE_HOLD_STATE)[keyof typeof DUPLICATE_HOLD_STATE];

/**
 * Motivo da remoção de item pelo sistema no `finalizarLote` (ADR-0065 I13j): o resultado da
 * verificação do favorecido autorizado que não é OK nem falha de leitura.
 */
export const SYSTEM_REMOVAL_REASON = {
    SEM_DADO_PAGAMENTO: 'SEM_DADO_PAGAMENTO',
    FAVORECIDO_NAO_AUTORIZADO: 'FAVORECIDO_NAO_AUTORIZADO',
    DESTINO_ALTERADO: 'DESTINO_ALTERADO',
} as const;

export type SystemRemovalReason =
    (typeof SYSTEM_REMOVAL_REASON)[keyof typeof SYSTEM_REMOVAL_REASON];

/** Grupo de canal de pagamento (perfil de canal; desde a ADR-0065 só alimenta o relatório). */
export const CHANNEL_GROUP = {
    BOLETO: 'BOLETO',
    TED_PIX: 'TED_PIX',
    OUTROS: 'OUTROS',
} as const;

export type ChannelGroup = (typeof CHANNEL_GROUP)[keyof typeof CHANNEL_GROUP];

/** Confiança do perfil de canal (relatório de candidatos à autorização). */
export const CHANNEL_CONFIDENCE = { ALTA: 'ALTA', MEDIA: 'MEDIA', BAIXA: 'BAIXA' } as const;

export type ChannelConfidence = (typeof CHANNEL_CONFIDENCE)[keyof typeof CHANNEL_CONFIDENCE];

/**
 * Evento da trilha só-inclusão da verificação TED/PIX (I13m). Paridade com o CHECK da 0078.
 * `PENDENCIA_*`, `LOTE_CONFERIDO`, `LOTE_DEVOLVIDO` e `CONFERENCIA_LIMPA` só existem nas linhas
 * históricas: a ADR-0065 parou de emiti-los (o CHECK os mantém).
 */
export const VERIFICATION_EVENT = {
    ALERTA_CRIADA: 'ALERTA_CRIADA',
    ALERTA_JUSTIFICADA: 'ALERTA_JUSTIFICADA',
    ALERTA_RETIRADA: 'ALERTA_RETIRADA',
    ALERTA_OBSOLETA: 'ALERTA_OBSOLETA',
    ALERTA_DESCARTADA: 'ALERTA_DESCARTADA',
    BLOQUEIO_CRIADO: 'BLOQUEIO_CRIADO',
    BLOQUEIO_ENCERRADO: 'BLOQUEIO_ENCERRADO',
    BLOQUEIO_DESFEITO: 'BLOQUEIO_DESFEITO',
    PENDENCIA_ABERTA: 'PENDENCIA_ABERTA',
    PENDENCIA_ORIGEM_ACRESCENTADA: 'PENDENCIA_ORIGEM_ACRESCENTADA',
    PENDENCIA_RESOLVIDA: 'PENDENCIA_RESOLVIDA',
    ITEM_REMOVIDO_SISTEMA: 'ITEM_REMOVIDO_SISTEMA',
    LOTE_CONFERIDO: 'LOTE_CONFERIDO',
    LOTE_DEVOLVIDO: 'LOTE_DEVOLVIDO',
    CONFERENCIA_LIMPA: 'CONFERENCIA_LIMPA',
} as const;

export type VerificationEvent = (typeof VERIFICATION_EVENT)[keyof typeof VERIFICATION_EVENT];

/**
 * Um título do `fin064` visto pela verificação de duplicidade (I13c–e), já normalizado. Inclui
 * títulos PAGOS (a leitura não filtra `vldPago`).
 */
export interface DuplicateCandidate {
    filCod: number;
    docCod: string;
    titCod: string;
    /** `pesCod`, ou `pesCodFor` quando o `pesCod` vem vazio. Ausente = não casa com nada. */
    favorecido?: string;
    credor?: string;
    /** `docEspNumero` só com dígitos, sem zeros à esquerda; `''` quando não há número. */
    numeroNota: string;
    /** Valor do título em centavos (inteiro) — a FRACA compara centavo a centavo. */
    valorCentavos: number;
    /** Vencimento (epoch-ms). */
    vencimento?: number;
    pago: boolean;
    /** Tipo do documento (informativo: a FORTE casa qualquer tipo). */
    docTipo?: string;
}

/** Título da contraparte guardado na alerta (snapshot para a tela). */
export interface CounterpartTitle {
    titCod: string;
    valor: number;
    vencimento?: number;
    pago: boolean;
}

/** Um achado de duplicidade: o outro DOCUMENTO e seus títulos que casaram. */
export interface DuplicateMatch {
    tipo: typeof ITEM_ALERT_TYPE.DUPLICIDADE_FORTE | typeof ITEM_ALERT_TYPE.DUPLICIDADE_FRACA;
    contraparteFilCod: number;
    contraparteDocCod: string;
    contraparteTitulos: CounterpartTitle[];
    evidencia: Record<string, unknown>;
}

/** Baixa a pagar (`fin010`) usada no perfil de canal. Valor positivo, data epoch-ms. */
export interface ChannelPayment {
    pesCod?: string;
    credor?: string;
    valor: number;
    data: number;
}

/** Débito do extrato (`fin095`) usado no perfil de canal. */
export interface StatementDebit {
    valor: number;
    data: number;
    historico?: string;
}

/** Limiares da confiança ALTA (configuração do tenant, não ontologia). */
export interface ChannelThresholds {
    minPagamentos: number;
    minMeses: number;
    minParticipacao: number;
}

/** `PerfilCanalFornecedor` — read model persistido, um por `pesCod` (gap Q4). */
export interface ChannelProfile {
    pesCod: string;
    credor?: string;
    contagens: Record<ChannelGroup, number>;
    pagamentosUnicos: number;
    mesesDistintos: number;
    grupoDominante: ChannelGroup;
    participacao: number;
    confianca: ChannelConfidence;
    janelaInicio: number;
    janelaFim: number;
    calculadoEm?: string;
    jobRunId?: string;
}

/** `AlertaItemLote` (code-facing `PaymentItemAlert`). */
export interface AlertaItemLote {
    id: string;
    loteId: string;
    filCod: number;
    docCod: string;
    titCod: string;
    tipo: ItemAlertType;
    contraparteFilCod?: number;
    contraparteDocCod?: string;
    contraparteTitulos?: CounterpartTitle[];
    evidencia: Record<string, unknown>;
    estado: ItemAlertState;
    resolucao?: ItemAlertResolution;
    justificativa?: string;
    resolvidoPor?: string;
    resolvidoEm?: string;
    criadoEm: string;
    verificadoEm: string;
}

/** `BloqueioDuplicidade` (code-facing `DuplicateHold`). */
export interface BloqueioDuplicidade {
    id: string;
    filCod: number;
    docCod: string;
    titCod: string;
    pesCod?: string;
    alertaId?: string;
    loteIdOrigem?: string;
    motivo: string;
    estado: DuplicateHoldState;
    marcadoPor: string;
    marcadoEm: string;
    encerradoEm?: string;
    desfeitoPor?: string;
    desfeitoEm?: string;
    motivoDesfazer?: string;
}
