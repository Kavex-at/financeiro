import type { EtapaAprovacao, FinTituloBloqRow } from './EtapaAprovacao.js';
import type {
    AprovacaoIngestaoRun,
    DocPagarRow,
    TituloAprovacao,
    TituloAprovacaoComTrilha,
} from './TituloAprovacao.js';

/**
 * Frente V — os SEAMS entre os módulos, no padrão que a Frente IV estabeleceu
 * (`domain/interface/recebimentos/ports.ts`).
 *
 * Nenhum módulo importa a *implementação* de outro — só esta interface e os DTOs. Trocar um stub
 * pela classe real é trocar o binding do token no container, e nada mais muda.
 *
 * Interfaces TypeScript não podem ser tokens do tsyringe → cada port tem um `Symbol`.
 */

// ───────────────────────────────────────────────────────── Gateway de leitura do ERP

/**
 * Leitura da trilha de aprovação no Conexos.
 *
 * ⚠️ **Este port NÃO expõe nenhum método de escrita, e isso é deliberado** (ADR-0038 D2). A Frente V
 * é read-only no ERP; fazer a superfície do contrato tornar a escrita *inexpressável* é mais seguro
 * do que confiar em disciplina de quem implementa. Os endpoints de escrita existem
 * (`trocaBloqueio`, `regerarBloqueios`, `aplicarComando`) e liberam pagamento — não podem estar a
 * uma chamada de distância.
 *
 * Implementação atual: `psq014/list` + `fin026/infoTitulo/list` (1 chamada por título).
 * Quando **PV-07** (acesso à tela `fin103`) for resolvida, entra uma implementação nova que varre
 * `fin103/list` paginado — sem tocar no job nem no serviço.
 */
export interface TrilhaAprovacaoGatewayInterface {
    /**
     * Uma página do universo de títulos a pagar. Ordenação estável por `docCod` é **requisito**:
     * sem ela a retomada do backfill pularia ou repetiria títulos.
     */
    listUniverso: (params: {
        filCod: number;
        /** Piso da janela de emissão, epoch ms. O ERP recusa string ISO. */
        emissaoDesde?: number;
        pageNumber: number;
        pageSize: number;
    }) => Promise<{ count: number; rows: DocPagarRow[] }>;

    /**
     * A trilha de UM título. O `filCod` tem de vir do registro do título, nunca de um default:
     * consultar com a filial errada devolve `count: 0` **sem erro** (invariante I5).
     */
    listTrilha: (params: {
        filCod: number;
        docTip: number;
        docCod: number;
        titCod: number;
    }) => Promise<FinTituloBloqRow[]>;
}

export const TRILHA_APROVACAO_GATEWAY_TOKEN = Symbol('TrilhaAprovacaoGateway');

// ───────────────────────────────────────────────────────── Repositories

export interface TituloAprovacaoRepositoryInterface {
    /** UPSERT por `(fil_cod, doc_cod, tit_cod)`. Idempotente (I2). */
    upsert: (titulo: TituloAprovacao) => Promise<void>;
    findById: (
        filCod: number,
        docCod: number,
        titCod: number,
    ) => Promise<TituloAprovacaoComTrilha | null>;
    list: (filtro: ListaAprovacoesFiltro) => Promise<{ items: TituloAprovacao[]; total: number }>;
    /**
     * Instante da observação mais recente **das filiais consultadas** — alimenta o `snapshotEm`
     * da UI (invariante I7).
     *
     * O escopo por filial não é detalhe: um `MAX` global mentiria. Se a filial 1 foi ingerida hoje
     * e a analista está olhando a filial 2, ingerida semana passada, o painel afirmaria um frescor
     * que aquele dado não tem — exatamente a "afirmação falsamente redonda" que a frente existe
     * para evitar.
     */
    ultimoSnapshot: (filCods: number[]) => Promise<Date | null>;
}

export const TITULO_APROVACAO_REPOSITORY_TOKEN = Symbol('TituloAprovacaoRepository');

export interface EtapaAprovacaoRepositoryInterface {
    /**
     * Substitui a trilha de UM título: UPSERT das etapas recebidas e `ativo = false` nas que
     * sumiram **daquele título**.
     *
     * O escopo por título é essencial: o anti-fantasma global da Frente II
     * (`marcarInativosForaDaRun`) seria destrutivo aqui, porque o backfill é parcial por natureza e
     * marcaria como fantasma todo o histórico que simplesmente não foi revisitado nesta passada.
     */
    sincronizarTrilha: (
        chave: { filCod: number; docCod: number; titCod: number },
        etapas: EtapaAprovacao[],
    ) => Promise<void>;
    listByTitulo: (filCod: number, docCod: number, titCod: number) => Promise<EtapaAprovacao[]>;

    /**
     * Trilhas de VÁRIOS títulos numa única consulta, agrupadas pela chave `filCod:docCod:titCod`.
     *
     * Existe para o grid. A alternativa — um `listByTitulo` por linha da página dentro de um
     * `Promise.all` — dispara até `pageSize` consultas concorrentes a cada carregamento e, com
     * poucos analistas simultâneos, esgota o pool de conexões do Postgres. O custo de uma página
     * não deve crescer com o número de linhas dela.
     */
    listByTitulos: (
        chaves: Array<{ filCod: number; docCod: number; titCod: number }>,
    ) => Promise<Map<string, EtapaAprovacao[]>>;
}

/** Chave de agrupamento das trilhas devolvidas por `listByTitulos`. */
export const chaveTitulo = (filCod: number, docCod: number, titCod: number): string =>
    `${filCod}:${docCod}:${titCod}`;

export const ETAPA_APROVACAO_REPOSITORY_TOKEN = Symbol('EtapaAprovacaoRepository');

export interface AprovacaoIngestaoRunRepositoryInterface {
    iniciar: (run: AprovacaoIngestaoRun) => Promise<void>;
    /** Grava o cursor DEPOIS de o título ser persistido — retomada segura. */
    salvarCursor: (
        id: string,
        cursor: { filCod: number; pagina: number; docCod: number },
        totais: { titulos: number; etapas: number },
    ) => Promise<void>;
    finalizar: (id: string, status: 'success' | 'error', errorMessage?: string) => Promise<void>;
    /** Última run interrompida, para retomar de onde parou. */
    ultimaRunRetomavel: () => Promise<AprovacaoIngestaoRun | null>;
}

export const APROVACAO_INGESTAO_RUN_REPOSITORY_TOKEN = Symbol('AprovacaoIngestaoRunRepository');

// ───────────────────────────────────────────────────────── Tipos de consulta

export interface ListaAprovacoesFiltro {
    page: number;
    pageSize: number;
    filCods: number[];
    status?: string;
    fornecedorCod?: number;
    responsavel?: string;
    emissaoDe?: Date;
    emissaoAte?: Date;
    busca?: string;
}
