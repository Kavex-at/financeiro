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
import BoundedConcurrency from '../../libs/concurrency/BoundedConcurrency.js';
import DuracaoCalculator from './DuracaoCalculator.js';
import EtapaStatusResolver from './EtapaStatusResolver.js';
import StatusWorkflowResolver from './StatusWorkflowResolver.js';

/** Página do universo. 500 espelha o `PAGE_SIZE` do `ConexosBaseClient`. */
const PAGE_SIZE = 500;

/** Teto de páginas por filial — mesma doutrina do `MAX_PAGES` do client base. */
const MAX_PAGINAS = 200;

/**
 * Títulos lidos em paralelo dentro de uma página.
 *
 * Não é "quanto mais melhor": o Conexos derruba sessão sob rajada
 * (`LOGIN_ERROR_MAX_SESSIONS`), que foi o motivo de o `BoundedConcurrency` existir no repo. 4 é o
 * mesmo patamar conservador que as frentes irmãs usam, e já corta a varredura de horas para uma
 * fração — o gargalo real continua sendo a chamada por título, que só a PV-07 elimina.
 */
const CONCORRENCIA_TITULOS = 4;

/** Quantas falhas guardar por extenso na mensagem da run — o resto vira contagem. */
const MAX_EXEMPLOS_DE_FALHA = 5;

/** Estado que atravessa filiais e páginas de uma mesma execução. */
interface Acumulado {
    titulos: number;
    etapas: number;
    falhas: number;
    exemplosDeFalha: string[];
}

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
    /** Títulos que falharam e foram pulados — a varredura não morre por causa de um registro. */
    falhas: number;
    interrompida: boolean;
}

/**
 * IngestaoAprovacoesService — varre o universo de títulos a pagar e materializa a trilha.
 *
 * ## Forma do trabalho
 *
 * Para cada filial: pagina o universo (`psq014/list`) e, para cada título da página, lê a trilha
 * (`fin026/infoTitulo/list`) — **uma chamada ao ERP por título**. É caro por construção enquanto
 * não houver projeção em massa (PV-07 — a `fin103` é fila pessoal, não serve); por isso o job é retomável.
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
        @inject(BoundedConcurrency) private boundedConcurrency: BoundedConcurrency,
    ) {}

    public executar = async (params: IngestaoParams): Promise<IngestaoResultado> => {
        const retomada = params.retomar ? await this.runRepository.ultimaRunRetomavel() : null;

        const runId = retomada?.id ?? randomUUID();
        const titulos = retomada?.totalTitulos ?? 0;
        const etapas = retomada?.totalEtapas ?? 0;

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

        const acumulado: Acumulado = { titulos, etapas, falhas: 0, exemplosDeFalha: [] };

        try {
            for (const filCod of params.filCods) {
                // Numa retomada, pula as filiais já concluídas e recomeça na página onde parou.
                if (retomada?.cursorFilCod !== undefined && filCod < retomada.cursorFilCod) {
                    continue;
                }
                const paginaInicial =
                    retomada?.cursorFilCod === filCod ? (retomada.cursorPagina ?? 1) : 1;

                await this.processarFilial(
                    { filCod, paginaInicial, emissaoDesde: params.emissaoDesde, runId },
                    acumulado,
                );
            }

            // Uma varredura com falhas NÃO é um sucesso limpo, e dizer que foi esconderia o buraco
            // no histórico. O status continua `success` (a run terminou), mas a mensagem carrega a
            // contagem — é o que o operador lê no runbook para decidir se reprocessa.
            const resumo =
                acumulado.falhas > 0
                    ? `${acumulado.falhas} título(s) falharam e foram pulados. Exemplos: ${acumulado.exemplosDeFalha.join('; ')}`
                    : undefined;
            await this.runRepository.finalizar(runId, 'success', resumo);

            return {
                runId,
                titulos: acumulado.titulos,
                etapas: acumulado.etapas,
                falhas: acumulado.falhas,
                interrompida: false,
            };
        } catch (error) {
            const mensagem = error instanceof Error ? error.message : String(error);
            await this.runRepository.finalizar(runId, 'error', mensagem);
            throw error;
        }
    };

    /** Varre uma filial, página a página, a partir de `paginaInicial`. */
    private processarFilial = async (
        ctx: { filCod: number; paginaInicial: number; emissaoDesde?: number; runId: string },
        acumulado: Acumulado,
    ): Promise<void> => {
        for (let pagina = ctx.paginaInicial; pagina <= MAX_PAGINAS; pagina++) {
            const { rows } = await this.gateway.listUniverso({
                filCod: ctx.filCod,
                emissaoDesde: ctx.emissaoDesde,
                pageNumber: pagina,
                pageSize: PAGE_SIZE,
            });

            if (rows.length === 0) break;

            await this.processarPagina({ ...ctx, pagina, rows }, acumulado);

            if (rows.length < PAGE_SIZE) break;
        }
    };

    /**
     * Processa uma página inteira e grava o cursor UMA vez, no fim.
     *
     * Duas decisões moram aqui, e as duas vieram de revisão:
     *
     * 1. **Um título que falha não derruba a varredura.** Antes, uma única exceção abortava a run
     *    inteira — e, como a retomada volta ao cursor (o título ANTERIOR ao problemático), a
     *    execução seguinte batia no mesmo registro e morria de novo: um backfill de 23 mil títulos
     *    que nunca termina por causa de um. Agora a falha é contada, registrada e a varredura segue.
     *
     * 2. **Cursor por PÁGINA, não por título.** Salvar a cada título custava 23.632 UPDATEs por
     *    filial. Por página são 48. O preço é a granularidade da retomada: no pior caso reprocessa
     *    uma página inteira — o que é inofensivo, porque o UPSERT é idempotente, e barato perto do
     *    que se economiza.
     *
     * A concorrência limitada dentro da página é o que torna (2) possível: com títulos terminando
     * fora de ordem, um cursor por título deixaria de significar "tudo antes daqui está pronto".
     */
    private processarPagina = async (
        ctx: { filCod: number; pagina: number; runId: string; rows: DocPagarRow[] },
        acumulado: Acumulado,
    ): Promise<void> => {
        const resultados = await this.boundedConcurrency.run(
            ctx.rows,
            async (row) => this.processarTitulo(row, ctx.filCod, ctx.runId),
            CONCORRENCIA_TITULOS,
        );

        resultados.forEach((resultado, indice) => {
            if (resultado.status === 'rejected') {
                acumulado.falhas += 1;
                const row = ctx.rows[indice];
                const chave = `fil ${ctx.filCod}/doc ${row?.docCod}/tit ${row?.titCod}`;
                if (acumulado.exemplosDeFalha.length < MAX_EXEMPLOS_DE_FALHA) {
                    const motivo =
                        resultado.reason instanceof Error
                            ? resultado.reason.message
                            : String(resultado.reason);
                    acumulado.exemplosDeFalha.push(`${chave}: ${motivo}`);
                }
                console.warn(`[ingest-aprovacoes] título ${chave} falhou e foi pulado.`);
                return;
            }
            if (resultado.value === null) return;

            acumulado.titulos += 1;
            acumulado.etapas += resultado.value;
        });

        const ultimo = ctx.rows[ctx.rows.length - 1];
        await this.runRepository.salvarCursor(
            ctx.runId,
            { filCod: ctx.filCod, pagina: ctx.pagina, docCod: Number(ultimo?.docCod ?? 0) },
            { titulos: acumulado.titulos, etapas: acumulado.etapas },
        );
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
