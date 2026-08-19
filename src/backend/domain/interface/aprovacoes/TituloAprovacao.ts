import type { Lacuna, StatusWorkflow } from './constants.js';
import type { EtapaAprovacao } from './EtapaAprovacao.js';

/**
 * Frente V — cabeçalho observado de um título de contas a pagar, sob a ótica do workflow de
 * aprovação. A trilha em si vive em `EtapaAprovacao`.
 *
 * Chave natural: `filCod` + `docCod` + `titCod`.
 * Ver `ontology/entities/titulo-aprovacao.md`.
 */
export interface TituloAprovacao {
    filCod: number;
    docCod: number;
    titCod: number;

    documentoNumero?: string;
    tituloNumero?: string;
    /** Dimensão do analítico da Fase 2. */
    fornecedorCod?: number;
    fornecedorNome?: string;
    valor?: number;
    moeda?: string;

    /** `docDtaEmissao` — campo `Dta*`: **data pura**, sem hora. */
    dataEmissao?: Date;
    dataVencimento?: Date;
    /**
     * `docDtaFinalizacao` — o marco zero que o cliente descreveu ("documento finalizado às 10:00").
     * **Hoje sempre indefinido**: não vem na projeção acessível (PV-04/PV-07). Enquanto isso, o
     * relógio da timeline começa em `primeiraEtapaEm`, e a lacuna é registrada.
     */
    dataFinalizacao?: Date;

    /** Derivado das etapas — ver `ontology/state-machines/aprovacao-titulo.md`. */
    statusWorkflow: StatusWorkflow;
    etapasConcluidas: number;
    /**
     * Etapas **conhecidas**, não "quantas o fluxo exige". O ERP não expõe o total planejado de um
     * workflow — só as instâncias criadas.
     */
    etapasTotais: number;

    primeiraEtapaEm?: Date;
    ultimaAcaoEm?: Date;
    /** De `primeiraEtapaEm` até `ultimaAcaoEm` (ou até agora, se ainda houver pendência). */
    tempoTotalSegundos?: number;

    /** O que não conseguimos afirmar sobre este título — exibido na UI (I3/I4). */
    lacunas: Lacuna[];

    ativo: boolean;
    ingestaoRunId?: string;
    /** Idade do snapshot. **Obrigatoriamente exposto na UI** (invariante I7). */
    observadoEm: Date;
}

/** Título com a trilha resolvida — o que o endpoint de detalhe devolve. */
export interface TituloAprovacaoComTrilha extends TituloAprovacao {
    etapas: EtapaAprovacao[];
}

/** Linha crua de `DocsPagarReceberDTO` (`psq014/list`) — o universo da varredura. */
export interface DocPagarRow {
    filCod?: number;
    docTip?: number;
    docCod?: number;
    titCod?: number;
    docEspNumero?: string | null;
    titEspNumero?: string | null;
    pesCod?: number | null;
    dpeNomPessoa?: string | null;
    titMnyValor?: number | null;
    /** epoch em milissegundos. */
    docDtaEmissao?: number | null;
    /** epoch em milissegundos. */
    titDtaVencimento?: number | null;
    docVldFinalizado?: number | null;
    usnDesNomeFimDoc?: string | null;
}

/** Auditoria de uma execução da ingestão. */
export interface AprovacaoIngestaoRun {
    id: string;
    triggeredBy: string;
    status: 'running' | 'success' | 'error';
    filCods: number[];
    /** Piso da janela de emissão varrida (epoch ms). */
    emissaoDesde?: Date;
    totalTitulos: number;
    totalEtapas: number;
    /** Cursor de retomada — ver `ontology/business-rules/idempotencia-ingestao-aprovacao.md`. */
    cursorFilCod?: number;
    cursorPagina?: number;
    cursorDocCod?: number;
    errorMessage?: string;
    startedAt: Date;
    finishedAt?: Date;
}
