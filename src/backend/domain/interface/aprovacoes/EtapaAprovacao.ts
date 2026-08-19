import type { EtapaStatus } from './constants.js';

/**
 * Frente V — uma etapa da trilha de aprovação de um título (um bloqueio no Conexos).
 *
 * Chave natural: `filCod` + `docCod` + `titCod` + `fblCod` + `ftbCod`.
 * Ver `ontology/entities/etapa-aprovacao.md`.
 */
export interface EtapaAprovacao {
    filCod: number;
    docCod: number;
    titCod: number;
    /** Tipo de bloqueio (`fblCod`) — ex.: 6 = CONTROLLER. */
    fblCod: number;
    /** Instância do bloqueio neste título (`ftbCod`). */
    ftbCod: number;

    /** `fblDesNome` — ex.: `CONTROLLER`, `TI`, `FISCAL`, `DIRETORIA II`. */
    nome?: string;
    /**
     * `aprovador` — **rótulo de alçada, NÃO identidade**. Observado misturando setor (`COMPRAS`) e
     * pessoa (`RICARDO DO PRADO`). A identidade de quem agiu é `responsavelNome`. Ver PV-10.
     */
    alcada?: string;
    /** `fbaDesNome` — `LIBERAR` ou `APROVAR`. Diferença de negócio em aberto (PV-02). */
    acao?: string;

    /** `usnDesNomeCmd` — a pessoa que aplicou a ação. Chave do analítico da Fase 2. */
    responsavelNome?: string;
    /**
     * `usnCodCmd` — código estável da pessoa. **Hoje sempre indefinido**: não vem na projeção
     * acessível. O campo existe para receber o dado quando PV-07 (acesso ao `fin103`) for resolvida.
     */
    responsavelCod?: number;

    /**
     * `ftbVldStatus` bruto, preservado mesmo quando desconhecido. Guardar o número permite
     * reclassificar por migration quando PV-01 fechar, sem reingerir ~23 mil títulos.
     */
    statusErp?: number;
    /** Status de domínio, derivado de `statusErp` + ordem dos timestamps. */
    status: EtapaStatus;

    /** `ftbTimBloq` — quando a etapa passou a existir. Campo `Tim*`: preserva hora (PV-03). */
    recebidoEm?: Date;
    /** `ftbTimCmd` — quando a ação foi aplicada. Indefinido enquanto pendente. */
    agidoEm?: Date;
    /**
     * `agidoEm − recebidoEm` em segundos corridos. **Indefinido quando pendente** — nunca estimado
     * (invariante I3). Ver `ontology/business-rules/duracao-etapa-aprovacao.md`.
     */
    duracaoSegundos?: number;

    observacao?: string;

    /** Anti-fantasma: etapa que sumiu do ERP vira inativa, nunca é apagada (I6, PV-06). */
    ativo: boolean;
    ingestaoRunId?: string;
    observadoEm: Date;
}

/** Linha crua de `FinTituloBloq` como o Conexos devolve — antes de qualquer interpretação. */
export interface FinTituloBloqRow {
    filCod?: number;
    docTip?: number;
    docCod?: number;
    titCod?: number;
    fblCod?: number;
    ftbCod?: number;
    fblDesNome?: string | null;
    fbaDesNome?: string | null;
    aprovador?: string | null;
    usnDesNomeCmd?: string | null;
    usnCodCmd?: number | null;
    ftbVldStatus?: number | null;
    /** epoch em milissegundos. */
    ftbTimBloq?: number | null;
    /** epoch em milissegundos. */
    ftbTimCmd?: number | null;
    ftbEspObsCmd?: string | null;
    ftbEspInfo?: string | null;
}
