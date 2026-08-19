import { inject, injectable } from 'tsyringe';
import AprovacaoIdInvalidoError from '../../errors/AprovacaoIdInvalidoError.js';
import { ETAPA_STATUS } from '../../interface/aprovacoes/constants.js';
import type { EtapaStatus, StatusWorkflow } from '../../interface/aprovacoes/constants.js';
import type { EtapaAprovacao } from '../../interface/aprovacoes/EtapaAprovacao.js';
import type {
    EtapaAprovacaoRepositoryInterface,
    ListaAprovacoesFiltro,
    TituloAprovacaoRepositoryInterface,
} from '../../interface/aprovacoes/ports.js';
import {
    chaveTitulo,
    ETAPA_APROVACAO_REPOSITORY_TOKEN,
    TITULO_APROVACAO_REPOSITORY_TOKEN,
} from '../../interface/aprovacoes/ports.js';
import type { TituloAprovacao } from '../../interface/aprovacoes/TituloAprovacao.js';
import DuracaoCalculator from './DuracaoCalculator.js';

/** Chave natural de um título, já validada. */
export interface ChaveTitulo {
    filCod: number;
    docCod: number;
    titCod: number;
}

/** A etapa que a fila está esperando agora — critério de escolha em `escolherEtapaAtual`. */
export interface EtapaAtualResumo {
    nome?: string;
    alcada?: string;
    responsavelNome?: string;
    recebidoEm?: string;
    /** **Não é duração**: espera em curso, cresce a cada leitura. Ver `duracao-etapa-aprovacao.md`. */
    paradaHaSegundos?: number;
}

/** Uma linha do grid do painel. Datas em ISO 8601 — o transporte é JSON. */
export interface AprovacaoListItem {
    id: string;
    filCod: number;
    documentoNumero?: string;
    tituloNumero?: string;
    fornecedorCod?: number;
    fornecedorNome?: string;
    valor?: number;
    moeda?: string;
    dataEmissao?: string;
    dataVencimento?: string;
    /**
     * Ausente enquanto `docDtaFinalizacao` não vier na projeção acessível (**PV-04** e **PV-07**).
     * Deliberadamente **não** cai para `dataEmissao`: o cliente definiu o aceite em cima de
     * "o documento foi finalizado às 10:00", e substituir esse marco por outro campo produziria um
     * número que parece o combinado sem ser. A ausência vem acompanhada da lacuna
     * `SEM_DATA_FINALIZACAO`.
     */
    dataFinalizacao?: string;
    statusWorkflow: StatusWorkflow;
    etapasConcluidas: number;
    etapasTotais: number;
    /** Quantas etapas seguem `PENDENTE`. Deixa a UI dizer "CONTROLLER +2" em vez de fingir uma só. */
    etapasAbertas: number;
    etapaAtual?: EtapaAtualResumo;
    tempoTotalSegundos?: number;
    lacunas: string[];
}

export interface AprovacoesListResponse {
    items: AprovacaoListItem[];
    page: number;
    pageSize: number;
    total: number;
    /** Idade do dado — invariante I7: a UI é obrigada a exibir. */
    snapshotEm?: string;
}

/** Uma etapa da trilha, como o drawer de timeline a consome. */
export interface EtapaTrilha {
    fblCod: number;
    ftbCod: number;
    nome?: string;
    alcada?: string;
    /** `LIBERAR` ou `APROVAR` — diferença de negócio em aberto (**PV-02**). */
    acao?: string;
    responsavelNome?: string;
    /** Hoje sempre ausente: `usnCodCmd` não vem na projeção acessível (**PV-10**). */
    responsavelCod?: number;
    status: EtapaStatus;
    /** `ftbVldStatus` bruto, preservado inclusive quando ilegível (**PV-01**). */
    statusErp?: number;
    recebidoEm?: string;
    agidoEm?: string;
    /** Ausente enquanto a etapa está pendente — nunca estimada (invariante I3). */
    duracaoSegundos?: number;
    /** Só em etapa pendente. */
    paradaHaSegundos?: number;
    observacao?: string;
}

export interface TrilhaResponse {
    cabecalho: AprovacaoListItem;
    etapas: EtapaTrilha[];
    lacunas: string[];
    snapshotEm?: string;
}

/** Partes do `id` do contrato — `${filCod}:${docCod}:${titCod}`. */
const PARTES_DO_ID = 3;

/**
 * AprovacoesPainelService — o que o painel da Frente V mostra.
 *
 * **Todo campo derivado nasce aqui.** O frontend recebe números prontos e não recalcula nada: um
 * relógio que corre no browser produziria "parada há" diferente do que o backend afirma, e um
 * painel financeiro auditável não pode ter duas versões do mesmo número. O que a UI escolhe é
 * formato (`4h 32m` vs `16320s`), nunca valor.
 *
 * Leitura pura: nenhuma escrita, nem no banco nem no ERP.
 */
@injectable()
export default class AprovacoesPainelService {
    public constructor(
        @inject(TITULO_APROVACAO_REPOSITORY_TOKEN)
        private tituloRepository: TituloAprovacaoRepositoryInterface,
        @inject(ETAPA_APROVACAO_REPOSITORY_TOKEN)
        private etapaRepository: EtapaAprovacaoRepositoryInterface,
        @inject(DuracaoCalculator)
        private duracaoCalculator: DuracaoCalculator,
    ) {}

    /**
     * Página do grid. Filtros e paginação são resolvidos em SQL pelo repository — filtrar em
     * memória *depois* de paginar devolveria páginas com buracos.
     *
     * `agora` é parâmetro (e não `new Date()` embutido) porque "parada há" e "tempo total" de um
     * título em aberto dependem do instante da leitura: sem injetá-lo, esses números não seriam
     * testáveis de forma determinística.
     */
    public listar = async (
        filtro: ListaAprovacoesFiltro,
        agora: Date = new Date(),
    ): Promise<AprovacoesListResponse> => {
        const { items, total } = await this.tituloRepository.list(filtro);

        // UMA consulta para as trilhas de toda a página. A forma óbvia — um `listByTitulo` por
        // linha dentro de um `Promise.all` — dispararia até `pageSize` consultas concorrentes por
        // carregamento e esgotaria o pool de conexões com poucos analistas simultâneos. O custo de
        // uma página não deve crescer com o número de linhas dela.
        const trilhas = await this.etapaRepository.listByTitulos(
            items.map((t) => ({ filCod: t.filCod, docCod: t.docCod, titCod: t.titCod })),
        );

        const linhas = items.map((titulo) =>
            this.montarItem(
                titulo,
                trilhas.get(chaveTitulo(titulo.filCod, titulo.docCod, titulo.titCod)) ?? [],
                agora,
            ),
        );

        const snapshot = await this.tituloRepository.ultimoSnapshot();

        return {
            items: linhas,
            page: filtro.page,
            pageSize: filtro.pageSize,
            total,
            snapshotEm: snapshot?.toISOString(),
        };
    };

    /**
     * Trilha completa de um título.
     *
     * Devolve `null` tanto para "não existe" quanto para "existe em filial fora da allow-list":
     * responder 403 no segundo caso confirmaria a existência do título a quem não pode vê-lo.
     */
    public detalhar = async (
        id: string,
        opts: { filCodsPermitidos?: number[]; agora?: Date } = {},
    ): Promise<TrilhaResponse | null> => {
        const agora = opts.agora ?? new Date();
        const chave = this.parseId(id);

        if (opts.filCodsPermitidos && !opts.filCodsPermitidos.includes(chave.filCod)) return null;

        const titulo = await this.tituloRepository.findById(
            chave.filCod,
            chave.docCod,
            chave.titCod,
        );
        if (!titulo) return null;

        const etapas = this.ordenarCronologicamente(titulo.etapas.filter((e) => e.ativo));

        return {
            cabecalho: this.montarItem(titulo, etapas, agora),
            etapas: etapas.map((etapa) => this.montarEtapa(etapa, agora)),
            lacunas: [...titulo.lacunas],
            // O `observado_em` DESTE título, não o `MAX` da tabela: aqui sabemos exatamente quando
            // este dado foi lido, e essa é a idade que o analista precisa ver na tela de detalhe.
            snapshotEm: titulo.observadoEm.toISOString(),
        };
    };

    /**
     * `${filCod}:${docCod}:${titCod}` → chave natural.
     *
     * Valida as três partes como inteiros positivos e rejeita qualquer outra coisa. Nada de
     * `Number()` silencioso: `Number('')` é `0` e `Number('x')` é `NaN` — ambos viram, sem erro
     * nenhum, uma consulta que não casa com linha alguma e devolve "não encontrado".
     */
    public parseId = (id: string): ChaveTitulo => {
        const partes = id.split(':');
        if (partes.length !== PARTES_DO_ID) throw new AprovacaoIdInvalidoError(id);

        const [filCod, docCod, titCod] = partes.map((parte) => this.parseParteDoId(parte, id));
        if (filCod === undefined || docCod === undefined || titCod === undefined) {
            throw new AprovacaoIdInvalidoError(id);
        }
        return { filCod, docCod, titCod };
    };

    /** Só dígitos: `+1`, ` 1 `, `1.0` e `1e3` são recusados, não normalizados. */
    private parseParteDoId = (parte: string, id: string): number => {
        if (!/^\d+$/.test(parte)) throw new AprovacaoIdInvalidoError(id);
        const valor = Number(parte);
        if (!Number.isSafeInteger(valor) || valor <= 0) throw new AprovacaoIdInvalidoError(id);
        return valor;
    };

    public montarId = (chave: ChaveTitulo): string =>
        `${chave.filCod}:${chave.docCod}:${chave.titCod}`;

    /**
     * Cabeçalho do título com os derivados do instante da leitura.
     *
     * `tempoTotalSegundos` é **recalculado** aqui em vez de reaproveitado do banco: o valor
     * persistido congelou no momento da ingestão, e para um título ainda `AGUARDANDO` o relógio
     * não parou. Exibir o número velho faria o painel envelhecer em silêncio.
     */
    private montarItem = (
        titulo: TituloAprovacao,
        etapas: EtapaAprovacao[],
        agora: Date,
    ): AprovacaoListItem => {
        const ativas = etapas.filter((e) => e.ativo);
        const pendentes = ativas.filter((e) => e.status === ETAPA_STATUS.PENDENTE);
        const etapaAtual = this.escolherEtapaAtual(pendentes);

        return {
            id: this.montarId(titulo),
            filCod: titulo.filCod,
            documentoNumero: titulo.documentoNumero,
            tituloNumero: titulo.tituloNumero,
            fornecedorCod: titulo.fornecedorCod,
            fornecedorNome: titulo.fornecedorNome,
            valor: titulo.valor,
            moeda: titulo.moeda,
            dataEmissao: titulo.dataEmissao?.toISOString(),
            dataVencimento: titulo.dataVencimento?.toISOString(),
            dataFinalizacao: titulo.dataFinalizacao?.toISOString(),
            statusWorkflow: titulo.statusWorkflow,
            etapasConcluidas: titulo.etapasConcluidas,
            etapasTotais: titulo.etapasTotais,
            etapasAbertas: pendentes.length,
            etapaAtual: etapaAtual ? this.montarEtapaAtual(etapaAtual, agora) : undefined,
            tempoTotalSegundos: this.duracaoCalculator.calcularTempoTotalSegundos({
                dataFinalizacao: titulo.dataFinalizacao,
                primeiraEtapaEm: titulo.primeiraEtapaEm,
                ultimaAcaoEm: titulo.ultimaAcaoEm,
                temPendente: pendentes.length > 0,
                agora,
            }),
            lacunas: [...titulo.lacunas],
        };
    };

    /**
     * A etapa que a fila está esperando: a `PENDENTE` mais antiga por `recebidoEm`; empate
     * resolvido pelo menor `fblCod` e, ainda empatado, pelo menor `ftbCod`.
     *
     * O desempate não é detalhe. Títulos com várias etapas abertas ao mesmo tempo são comuns (o
     * probe viu 177 etapas em 148 títulos), e sem critério total a mesma consulta devolveria
     * aprovadores diferentes entre execuções — o analista veria a fila trocar sozinha e perderia a
     * confiança no painel. Etapa sem `recebidoEm` vai para o fim: não dá para afirmar que ela
     * espera há mais tempo que uma datada.
     */
    private escolherEtapaAtual = (pendentes: EtapaAprovacao[]): EtapaAprovacao | undefined => {
        const [primeira] = [...pendentes].sort(this.compararPorEspera);
        return primeira;
    };

    /** Ordem cronológica da timeline — mesmo critério total do `escolherEtapaAtual`. */
    private ordenarCronologicamente = (etapas: EtapaAprovacao[]): EtapaAprovacao[] =>
        [...etapas].sort(this.compararPorEspera);

    private compararPorEspera = (a: EtapaAprovacao, b: EtapaAprovacao): number => {
        const ta = a.recebidoEm?.getTime() ?? Number.POSITIVE_INFINITY;
        const tb = b.recebidoEm?.getTime() ?? Number.POSITIVE_INFINITY;
        if (ta !== tb) return ta - tb;
        if (a.fblCod !== b.fblCod) return a.fblCod - b.fblCod;
        return a.ftbCod - b.ftbCod;
    };

    private montarEtapaAtual = (etapa: EtapaAprovacao, agora: Date): EtapaAtualResumo => ({
        nome: etapa.nome,
        alcada: etapa.alcada,
        responsavelNome: etapa.responsavelNome,
        recebidoEm: etapa.recebidoEm?.toISOString(),
        paradaHaSegundos: this.duracaoCalculator.calcularParadaHaSegundos({
            recebidoEm: etapa.recebidoEm,
            status: etapa.status,
            agora,
        }),
    });

    /**
     * `duracaoSegundos` vem do que a ingestão gravou (é um fato fechado: `agidoEm − recebidoEm`),
     * enquanto `paradaHaSegundos` é sempre recalculado — só ele depende de agora.
     */
    private montarEtapa = (etapa: EtapaAprovacao, agora: Date): EtapaTrilha => ({
        fblCod: etapa.fblCod,
        ftbCod: etapa.ftbCod,
        nome: etapa.nome,
        alcada: etapa.alcada,
        acao: etapa.acao,
        responsavelNome: etapa.responsavelNome,
        responsavelCod: etapa.responsavelCod,
        status: etapa.status,
        statusErp: etapa.statusErp,
        recebidoEm: etapa.recebidoEm?.toISOString(),
        agidoEm: etapa.agidoEm?.toISOString(),
        duracaoSegundos: etapa.duracaoSegundos,
        paradaHaSegundos: this.duracaoCalculator.calcularParadaHaSegundos({
            recebidoEm: etapa.recebidoEm,
            status: etapa.status,
            agora,
        }),
        observacao: etapa.observacao,
    });
}
