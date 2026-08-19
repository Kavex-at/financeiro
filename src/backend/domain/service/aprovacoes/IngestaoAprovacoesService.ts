import { randomUUID } from 'node:crypto';
import { inject, injectable } from 'tsyringe';
import { DOC_TIP, ETAPA_STATUS, LACUNA } from '../../interface/aprovacoes/constants.js';
import type { EtapaStatus, Lacuna } from '../../interface/aprovacoes/constants.js';
import type {
    EtapaAprovacao,
    FinTituloBloqRow,
} from '../../interface/aprovacoes/EtapaAprovacao.js';
import {
    APROVACAO_INGESTAO_RUN_REPOSITORY_TOKEN,
    type AprovacaoIngestaoRunRepositoryInterface,
    ETAPA_APROVACAO_REPOSITORY_TOKEN,
    type EtapaAprovacaoRepositoryInterface,
    TITULO_APROVACAO_REPOSITORY_TOKEN,
    type TituloAprovacaoRepositoryInterface,
    TRILHA_APROVACAO_GATEWAY_TOKEN,
    type TrilhaAprovacaoGatewayInterface,
} from '../../interface/aprovacoes/ports.js';
import type { DocPagarRow, TituloAprovacao } from '../../interface/aprovacoes/TituloAprovacao.js';
import DuracaoCalculator from './DuracaoCalculator.js';
import EtapaStatusResolver from './EtapaStatusResolver.js';
import StatusWorkflowResolver from './StatusWorkflowResolver.js';

/** Página do universo. 500 espelha o `PAGE_SIZE` do `ConexosBaseClient`. */
const PAGE_SIZE = 500;

/** Teto de páginas por filial — mesma doutrina do `MAX_PAGES` do client base. */
const MAX_PAGINAS = 200;

export interface IngestaoParams {
    filCods: number[];
    /** Piso da janela de emissão (epoch ms). Configurável — ver PV-08. */
    emissaoDesde?: number;
    triggeredBy: string;
    /** Retoma a última run interrompida em vez de começar do zero. */
    retomar?: boolean;
}

export interface IngestaoResultado {
    runId: string;
    titulos: number;
    etapas: number;
    interrompida: boolean;
}

/**
 * IngestaoAprovacoesService — varre o universo de títulos a pagar e materializa a trilha.
 *
 * ## Forma do trabalho
 *
 * Para cada filial: pagina o universo (`psq014/list`) e, para cada título da página, lê a trilha
 * (`fin026/infoTitulo/list`) — **uma chamada ao ERP por título**. É caro por construção enquanto
 * **PV-07** não liberar a varredura em massa do `fin103`; por isso o job é retomável.
 *
 * ## Read-only
 *
 * O gateway injetado não expõe escrita (ADR-0038 D2). Toda mutação acontece no Postgres local.
 */
@injectable()
export default class IngestaoAprovacoesService {
    public constructor(
        @inject(TRILHA_APROVACAO_GATEWAY_TOKEN)
        private gateway: TrilhaAprovacaoGatewayInterface,
        @inject(TITULO_APROVACAO_REPOSITORY_TOKEN)
        private tituloRepository: TituloAprovacaoRepositoryInterface,
        @inject(ETAPA_APROVACAO_REPOSITORY_TOKEN)
        private etapaRepository: EtapaAprovacaoRepositoryInterface,
        @inject(APROVACAO_INGESTAO_RUN_REPOSITORY_TOKEN)
        private runRepository: AprovacaoIngestaoRunRepositoryInterface,
        @inject(EtapaStatusResolver) private etapaStatusResolver: EtapaStatusResolver,
        @inject(StatusWorkflowResolver) private statusWorkflowResolver: StatusWorkflowResolver,
        @inject(DuracaoCalculator) private duracaoCalculator: DuracaoCalculator,
    ) {}

    public executar = async (params: IngestaoParams): Promise<IngestaoResultado> => {
        const retomada = params.retomar ? await this.runRepository.ultimaRunRetomavel() : null;

        const runId = retomada?.id ?? randomUUID();
        let titulos = retomada?.totalTitulos ?? 0;
        let etapas = retomada?.totalEtapas ?? 0;

        if (!retomada) {
            await this.runRepository.iniciar({
                id: runId,
                triggeredBy: params.triggeredBy,
                status: 'running',
                filCods: params.filCods,
                emissaoDesde: params.emissaoDesde ? new Date(params.emissaoDesde) : undefined,
                totalTitulos: 0,
                totalEtapas: 0,
                startedAt: new Date(),
            });
        }

        try {
            for (const filCod of params.filCods) {
                // Numa retomada, pula as filiais já concluídas e recomeça na página onde parou.
                if (retomada?.cursorFilCod !== undefined && filCod < retomada.cursorFilCod)
                    continue;
                const paginaInicial =
                    retomada?.cursorFilCod === filCod ? (retomada.cursorPagina ?? 1) : 1;

                for (let pagina = paginaInicial; pagina <= MAX_PAGINAS; pagina++) {
                    const { rows } = await this.gateway.listUniverso({
                        filCod,
                        emissaoDesde: params.emissaoDesde,
                        pageNumber: pagina,
                        pageSize: PAGE_SIZE,
                    });

                    if (rows.length === 0) break;

                    for (const row of rows) {
                        const persistidas = await this.processarTitulo(row, filCod, runId);
                        if (persistidas === null) continue;

                        titulos += 1;
                        etapas += persistidas;

                        // Cursor DEPOIS da persistência: uma queda repete no máximo um título,
                        // e o UPSERT torna a repetição inofensiva.
                        await this.runRepository.salvarCursor(
                            runId,
                            { filCod, pagina, docCod: Number(row.docCod ?? 0) },
                            { titulos, etapas },
                        );
                    }

                    if (rows.length < PAGE_SIZE) break;
                }
            }

            await this.runRepository.finalizar(runId, 'success');
            return { runId, titulos, etapas, interrompida: false };
        } catch (error) {
            const mensagem = error instanceof Error ? error.message : String(error);
            await this.runRepository.finalizar(runId, 'error', mensagem);
            throw error;
        }
    };

    /**
     * Lê a trilha de um título e persiste título + etapas.
     *
     * Devolve o número de etapas persistidas, ou `null` se a linha do universo veio sem chave
     * utilizável — caso em que ignorar é melhor que gravar um título órfão.
     */
    private processarTitulo = async (
        row: DocPagarRow,
        filCodDaVarredura: number,
        runId: string,
    ): Promise<number | null> => {
        const docCod = row.docCod;
        const titCod = row.titCod;
        if (docCod === undefined || titCod === undefined) return null;

        // Invariante I5: a filial vem do REGISTRO, não da varredura. Consultar a trilha com a
        // filial errada devolve lista vazia SEM erro — o título apareceria como "sem workflow".
        const filCod = row.filCod ?? filCodDaVarredura;
        const docTip = row.docTip ?? DOC_TIP.A_PAGAR;

        const linhas = await this.gateway.listTrilha({ filCod, docTip, docCod, titCod });
        const observadoEm = new Date();
        const agora = observadoEm;

        const lacunas = new Set<Lacuna>();
        const etapas = linhas.map((linha) =>
            this.mapearEtapa(linha, { filCod, docCod, titCod }, runId, observadoEm, lacunas),
        );

        await this.etapaRepository.sincronizarTrilha({ filCod, docCod, titCod }, etapas);

        const statusDasEtapas: EtapaStatus[] = etapas.map((e) => e.status);
        const statusWorkflow = this.statusWorkflowResolver.resolver(statusDasEtapas);

        const recebimentos = etapas
            .map((e) => e.recebidoEm)
            .filter((d): d is Date => d instanceof Date);
        const acoes = etapas.map((e) => e.agidoEm).filter((d): d is Date => d instanceof Date);
        const primeiraEtapaEm = recebimentos.length
            ? new Date(Math.min(...recebimentos.map((d) => d.getTime())))
            : undefined;
        const ultimaAcaoEm = acoes.length
            ? new Date(Math.max(...acoes.map((d) => d.getTime())))
            : undefined;

        // `docDtaFinalizacao` não vem na projeção acessível (PV-04): o relógio do título começa na
        // primeira etapa, e a lacuna registra por quê.
        if (etapas.length > 0) lacunas.add(LACUNA.SEM_DATA_FINALIZACAO);

        const titulo: TituloAprovacao = {
            filCod,
            docCod,
            titCod,
            documentoNumero: row.docEspNumero ?? undefined,
            tituloNumero: row.titEspNumero ?? undefined,
            fornecedorCod: row.pesCod ?? undefined,
            fornecedorNome: row.dpeNomPessoa ?? undefined,
            valor: row.titMnyValor ?? undefined,
            dataEmissao: this.paraData(row.docDtaEmissao),
            dataVencimento: this.paraData(row.titDtaVencimento),
            dataFinalizacao: undefined,
            statusWorkflow,
            etapasConcluidas: etapas.filter((e) => e.status === ETAPA_STATUS.CONCLUIDA).length,
            etapasTotais: etapas.length,
            primeiraEtapaEm,
            ultimaAcaoEm,
            tempoTotalSegundos: this.duracaoCalculator.calcularTempoTotalSegundos({
                primeiraEtapaEm,
                ultimaAcaoEm,
                temPendente: statusDasEtapas.includes(ETAPA_STATUS.PENDENTE),
                agora,
            }),
            lacunas: [...lacunas],
            ativo: true,
            ingestaoRunId: runId,
            observadoEm,
        };

        await this.tituloRepository.upsert(titulo);
        return etapas.length;
    };

    private mapearEtapa = (
        linha: FinTituloBloqRow,
        chave: { filCod: number; docCod: number; titCod: number },
        runId: string,
        observadoEm: Date,
        lacunas: Set<Lacuna>,
    ): EtapaAprovacao => {
        const { status, lacunas: lacunasEtapa } = this.etapaStatusResolver.resolver(linha);
        for (const l of lacunasEtapa) lacunas.add(l);

        const recebidoEm = this.paraData(linha.ftbTimBloq);
        const agidoEm = this.paraData(linha.ftbTimCmd);

        return {
            filCod: chave.filCod,
            docCod: chave.docCod,
            titCod: chave.titCod,
            fblCod: linha.fblCod ?? 0,
            ftbCod: linha.ftbCod ?? 0,
            nome: linha.fblDesNome ?? undefined,
            alcada: linha.aprovador ?? undefined,
            acao: linha.fbaDesNome ?? undefined,
            responsavelNome: linha.usnDesNomeCmd ?? undefined,
            responsavelCod: linha.usnCodCmd ?? undefined,
            statusErp: linha.ftbVldStatus ?? undefined,
            status,
            recebidoEm,
            agidoEm,
            duracaoSegundos: this.duracaoCalculator.calcularDuracaoSegundos({
                recebidoEm,
                agidoEm,
                status,
            }),
            observacao: linha.ftbEspObsCmd ?? linha.ftbEspInfo ?? undefined,
            ativo: true,
            ingestaoRunId: runId,
            observadoEm,
        };
    };

    /** Datas do Conexos trafegam como epoch em milissegundos — nunca string ISO. */
    private paraData = (epochMs?: number | null): Date | undefined =>
        typeof epochMs === 'number' && Number.isFinite(epochMs) ? new Date(epochMs) : undefined;
}
