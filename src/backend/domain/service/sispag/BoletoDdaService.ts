import { inject, injectable } from 'tsyringe';
import ConexosBaseClient from '../../client/ConexosBaseClient.js';
import ConexosDdaClient from '../../client/ConexosDdaClient.js';
import PostgreeDatabaseClient from '../../client/database/PostgreeDatabaseClient.js';
import EmptyDdaFileError from '../../errors/EmptyDdaFileError.js';
import IngestLockBusyError from '../../errors/IngestLockBusyError.js';
import {
    BOLETO_DDA_ESCOPO,
    CONFERENCIA_DDA_ESTADO,
    type ArquivoDda,
    type ArquivoDdaEstado,
    type ConferenciaDda,
    type BoletoDdaConsolidado,
    type BoletoDdaEscopo,
    type BoletoDdaGrupo,
    type BoletosDdaResposta,
    type SincronizacaoDdaResultado,
} from '../../interface/sispag/BoletoDda.js';
import {
    JANELA_CARTEIRA_DIAS_ADIANTE,
    JANELA_CARTEIRA_DIAS_ATRAS,
} from '../../libs/calendar/JanelaCarteira.js';
import type { TituloAPagar } from '../../interface/sispag/SispagInterface.js';
import { LOG_TYPE } from '../../interface/log/LogInterface.js';
import BankingCalendar from '../../libs/calendar/BankingCalendar.js';
import BoundedConcurrency from '../../libs/concurrency/BoundedConcurrency.js';
import BoletoDdaRepository from '../../repository/sispag/BoletoDdaRepository.js';
import LotePagamentoRepository from '../../repository/sispag/LotePagamentoRepository.js';
import PagamentoIngestaoRunRepository from '../../repository/sispag/PagamentoIngestaoRunRepository.js';
import TituloAPagarRepository from '../../repository/sispag/TituloAPagarRepository.js';
import LogService from '../LogService.js';
import AprendizadoFornecedorBoletoService from './AprendizadoFornecedorBoletoService.js';
import BoletoSuggestionService from './BoletoSuggestionService.js';
import ConsolidacaoBoletoDda, { LIMITE_DIAS_SAIDO } from './ConsolidacaoBoletoDda.js';
import ConsolidacaoBoletoDdaCache from './ConsolidacaoBoletoDdaCache.js';
import FornecedorBoletoDda from './FornecedorBoletoDda.js';
import { REGRA_CANDIDATO_TEXTO } from './RegraSugestaoBoleto.js';
import SugestaoBoletoCache from './SugestaoBoletoCache.js';
import PaginacaoBoletoDda, {
    BOLETO_DDA_TAMANHO_PADRAO,
    type FiltroPaginaBoletoDda,
} from './PaginacaoBoletoDda.js';

/** Chave de advisory lock EXCLUSIVA da sincronização DDA (≠ das ingestões de permutas/pagamentos). */
export const BOLETO_DDA_SYNC_LOCK_KEY = 726354820;
/** Teto de leituras Conexos simultâneas — o mesmo da ingestão de pagamentos. */
const FANOUT_LIMIT = 3;
/**
 * Arquivos importados nos últimos N dias são RELIDOS a cada sincronização: é neles que o
 * Conexos ainda grava vínculo (boletos a vencer). Arquivo mais antigo é lido uma vez só.
 */
export const RELEITURA_DIAS = 60;
/**
 * Prazo de uma passada disparada por requisição (ingestão e botão "Atualizar DDA"; emenda
 * 2026-10-30 da ADR-0067). O que está em voo termina; o resto fica para a próxima passada.
 */
export const BOLETO_DDA_PRAZO_MS = 60_000;

/**
 * BoletoDdaService — aba "Boletos DDA" do SISPAG.
 *
 * `sincronizar`: copia o pool `fin124` para o Postgres (incremental). READ-ONLY no ERP.
 * `listar`: lê o snapshot e consolida contra a carteira (`ConsolidacaoBoletoDda`).
 * Ao fim de toda sincronização invalida o cache das sugestões de boleto (ADR-0068).
 */
@injectable()
export default class BoletoDdaService {
    public constructor(
        @inject(ConexosDdaClient) private readonly dda: ConexosDdaClient,
        @inject(ConexosBaseClient) private readonly base: ConexosBaseClient,
        @inject(BoletoDdaRepository) private readonly repo: BoletoDdaRepository,
        @inject(TituloAPagarRepository) private readonly tituloRepo: TituloAPagarRepository,
        @inject(LotePagamentoRepository) private readonly loteRepo: LotePagamentoRepository,
        @inject(ConsolidacaoBoletoDda) private readonly consolidacao: ConsolidacaoBoletoDda,
        @inject(PaginacaoBoletoDda) private readonly paginacao: PaginacaoBoletoDda,
        @inject(BankingCalendar) private readonly calendar: BankingCalendar,
        @inject(BoundedConcurrency) private readonly bounded: BoundedConcurrency,
        @inject(PostgreeDatabaseClient) private readonly db: PostgreeDatabaseClient,
        @inject(LogService) private readonly logService: LogService,
        @inject(SugestaoBoletoCache) private readonly sugestoesCache: SugestaoBoletoCache,
        // I21v: o grupo (sugerido ou confirmado) de cada boleto, do cenário em cache das sugestões.
        @inject(BoletoSuggestionService) private readonly sugestoes: BoletoSuggestionService,
        @inject(ConsolidacaoBoletoDdaCache)
        private readonly consolidadoCache: ConsolidacaoBoletoDdaCache,
        @inject(PagamentoIngestaoRunRepository)
        private readonly runRepo: PagamentoIngestaoRunRepository,
        // ADR-0081: fornecedor da conta do beneficiário (enriquecimento da lista + aprendizado).
        @inject(FornecedorBoletoDda) private readonly fornecedores: FornecedorBoletoDda,
        @inject(AprendizadoFornecedorBoletoService)
        private readonly aprendizado: AprendizadoFornecedorBoletoService,
    ) {}

    /**
     * Uma página da aba. A consolidação roda sobre o escopo inteiro (a situação é derivada, não
     * dá para filtrá-la em SQL), mas só a página filtrada sai para o navegador.
     */
    public listar = async (
        input: { escopo: BoletoDdaEscopo } & Partial<FiltroPaginaBoletoDda>,
    ): Promise<BoletosDdaResposta> => {
        const hoje = this.calendar.todayBrt();
        const [sincronizadoEm, conferenciaEm, carteiraEm, lotes] = await Promise.all([
            this.repo.ultimaSincronizacao(),
            this.repo.ultimaConferencia(),
            this.runRepo.findLatestSuccessFinishedAt(),
            this.loteRepo.assinaturaTitulosEmLotesAbertos(),
        ]);
        // F4: a consolidação é a parte cara; filtro, ordem e página rodam sobre ela em cache.
        const chave = [
            input.escopo,
            hoje,
            sincronizadoEm ?? '-',
            carteiraEm?.getTime() ?? '-',
            lotes,
            this.sugestoesCache.versao(),
        ].join('|');
        const consolidadosSemFornecedor = await this.consolidadoCache.obter(chave, () =>
            this.consolidarEscopo(input.escopo, hoje),
        );
        // ADR-0081: o fornecedor vem da chave de conta das barras (igual em toda cópia do codbar),
        // então roda sobre a linha final, depois do cache e do `comGrupo`; não entra na chave do
        // cache porque o aprendizado muda o mapa sem mudar a consolidação.
        const consolidados = await this.comFornecedorOuNenhum(consolidadosSemFornecedor);
        const { escopo: _escopo, ...filtro } = input;
        // I-DDA7: a conversa bem-sucedida mais recente com o fin124 (gravar arquivo também é uma).
        const marcas = [conferenciaEm, sincronizadoEm].filter((m): m is number => m != null);
        const conferidoEm = marcas.length > 0 ? Math.max(...marcas) : undefined;
        const pagina = this.paginacao.paginar(consolidados, {
            ...filtro,
            hoje,
            pagina: input.pagina ?? 1,
            tamanho: input.tamanho ?? BOLETO_DDA_TAMANHO_PADRAO,
        });
        return {
            ...pagina,
            ...(sincronizadoEm != null ? { sincronizadoEm } : {}),
            ...(conferidoEm !== undefined ? { conferidoEm } : {}),
            regraCandidato: REGRA_CANDIDATO_TEXTO,
        };
    };

    /** O escopo inteiro consolidado contra a carteira, com o grupo de cada boleto. */
    private consolidarEscopo = async (
        escopo: BoletoDdaEscopo,
        hoje: string,
    ): Promise<BoletoDdaConsolidado[]> => {
        const vencimentoDesde = escopo === BOLETO_DDA_ESCOPO.A_VENCER ? hoje : undefined;
        const [boletos, titulos, titulosSaidos, titulosEmLote] = await Promise.all([
            this.repo.listBoletos(vencimentoDesde ? { vencimentoDesde } : {}),
            this.tituloRepo.listAtivos(),
            this.inativosOuNenhum(hoje),
            this.loteRepo.listTitulosEmLotesAbertos(),
        ]);
        return this.comGrupo(
            this.consolidacao.consolidar({ boletos, titulos, titulosSaidos, titulosEmLote }),
            await this.gruposOuNenhum(),
        );
    };

    /**
     * Títulos que saíram da carteira, só para a situação TITULO_SAIU_CARTEIRA. Recorte: do que o
     * casamento (±10 dias) alcança a partir da janela da carteira. Falha desliga SÓ essa situação
     * (os boletos ficam FORA_JANELA/SEM_TITULO como antes); nunca derruba a lista.
     */
    private inativosOuNenhum = async (hoje: string): Promise<TituloAPagar[]> => {
        try {
            return await this.tituloRepo.listInativosRecentes({
                de: this.calendar.addDays(hoje, -(JANELA_CARTEIRA_DIAS_ATRAS + LIMITE_DIAS_SAIDO)),
                ate: this.calendar.addDays(hoje, JANELA_CARTEIRA_DIAS_ADIANTE + LIMITE_DIAS_SAIDO),
            });
        } catch (err: unknown) {
            const code = (err as { code?: unknown } | null)?.code;
            await this.logService.warn({
                type: LOG_TYPE.BUSINESS_WARN,
                message:
                    'falha ao ler os títulos que saíram da carteira; a aba segue sem a situação "saiu da carteira"',
                data: {
                    erro: err instanceof Error ? err.message : String(err),
                    ...(typeof code === 'string' ? { codigoErro: code } : {}),
                },
            });
            return [];
        }
    };

    /** Falha ao ler os grupos desliga SÓ o resumo de grupo na aba (nunca derruba a lista). */
    private gruposOuNenhum = async (): Promise<ReadonlyMap<string, BoletoDdaGrupo>> => {
        try {
            return await this.sugestoes.gruposPorBoleto();
        } catch (err: unknown) {
            const code = (err as { code?: unknown } | null)?.code;
            await this.logService.warn({
                type: LOG_TYPE.BUSINESS_WARN,
                message: 'falha ao ler os grupos de boleto; a aba segue sem o resumo de grupo',
                data: {
                    erro: err instanceof Error ? err.message : String(err),
                    ...(typeof code === 'string' ? { codigoErro: code } : {}),
                },
            });
            return new Map();
        }
    };

    /** Falha ao ler o fornecedor tira SÓ a coluna "Fornecedor" (nunca derruba a lista). */
    private comFornecedorOuNenhum = async (
        linhas: BoletoDdaConsolidado[],
    ): Promise<BoletoDdaConsolidado[]> => {
        try {
            return await this.fornecedores.enriquecer(linhas);
        } catch (err: unknown) {
            await this.logService.warn({
                type: LOG_TYPE.BUSINESS_WARN,
                message: 'falha ao ler o fornecedor dos boletos; a aba segue sem a coluna',
                data: { erro: err instanceof Error ? err.message : String(err) },
            });
            return linhas;
        }
    };

    /**
     * Grupo e decisão são chaveados por item (`ddcCod:ditCod`), e a linha colapsada é UMA cópia do
     * `codbar`. Tenta a representante e depois as outras; o grupo CONFIRMADO vence o sugerido. Se o
     * achado está noutra cópia, a linha passa a apontar para ela — é nela que as ações agem.
     */
    private comGrupo = (
        linhas: BoletoDdaConsolidado[],
        grupos: ReadonlyMap<string, BoletoDdaGrupo>,
    ): BoletoDdaConsolidado[] =>
        grupos.size === 0
            ? linhas
            : linhas.map((b) => {
                  const itens = [b, ...(b.copias ?? [])];
                  const achados = itens
                      .map((c) => ({ c, grupo: grupos.get(`${c.ddcCod}:${c.ditCod}`) }))
                      .filter(
                          (x): x is { c: (typeof itens)[number]; grupo: BoletoDdaGrupo } =>
                              x.grupo !== undefined,
                      );
                  const escolhido =
                      achados.find((x) => x.grupo.estado === 'CONFIRMADO') ?? achados[0];
                  if (!escolhido) return b;
                  if (escolhido.c === b) return { ...b, grupo: escolhido.grupo };
                  const {
                      copias: _copias,
                      arquivo: _arquivo,
                      importadoEm: _importadoEm,
                      ...resto
                  } = b;
                  // A representante vira cópia: a contagem e as chaves da linha seguem coerentes.
                  const irmas = [
                      {
                          ddcCod: b.ddcCod,
                          ditCod: b.ditCod,
                          ...(b.arquivo ? { arquivo: b.arquivo } : {}),
                          ...(b.importadoEm != null ? { importadoEm: b.importadoEm } : {}),
                      },
                      ...(b.copias ?? []).filter((c) => c !== escolhido.c),
                  ];
                  return {
                      ...resto,
                      copias: irmas,
                      ddcCod: escolhido.c.ddcCod,
                      ditCod: escolhido.c.ditCod,
                      ...(escolhido.c.arquivo ? { arquivo: escolhido.c.arquivo } : {}),
                      ...(escolhido.c.importadoEm != null
                          ? { importadoEm: escolhido.c.importadoEm }
                          : {}),
                      grupo: escolhido.grupo,
                  };
              });

    public sincronizar = async (input: {
        triggeredBy: string;
        /**
         * Orçamento de tempo desta passada (ms). Passado o prazo, os arquivos que ainda não
         * começaram ficam para a próxima (`arquivosAdiados`); o que já está em voo termina.
         * Ausente = sem prazo (botão manual e job avulso).
         */
        prazoMs?: number;
        /** Janela de releitura em dias (default `RELEITURA_DIAS`). */
        releituraDias?: number;
    }): Promise<SincronizacaoDdaResultado> =>
        this.db.withAdvisoryLock(
            BOLETO_DDA_SYNC_LOCK_KEY,
            async () => {
                try {
                    const resultado = await this.executarSincronizacao(input);
                    await this.aprenderFornecedores();
                    return resultado;
                } finally {
                    // O pool mudou (ou mudou em parte, se falhou no meio): o cenário em cache das
                    // sugestões não vale mais, nem a lista consolidada da aba. Vale para o botão,
                    // o job e a ingestão.
                    this.sugestoesCache.invalidar();
                    this.consolidadoCache.invalidar();
                }
            },
            async () => {
                throw new IngestLockBusyError(
                    'boleto DDA sync advisory lock busy — another sync is running',
                );
            },
        );

    /**
     * Reaprende conta → fornecedor com o pool recém-copiado (ADR-0081). Acessório: falhar aqui
     * mantém o mapeamento anterior e NUNCA derruba a sincronização.
     */
    private aprenderFornecedores = async (): Promise<void> => {
        try {
            const r = await this.aprendizado.aprender();
            await this.logService.info({
                type: LOG_TYPE.BUSINESS_INFO,
                message: 'fornecedor dos boletos DDA reaprendido pela conta do beneficiário',
                data: { ...r },
            });
        } catch (err: unknown) {
            await this.logService.warn({
                type: LOG_TYPE.BUSINESS_WARN,
                message: 'falha ao aprender o fornecedor dos boletos; mapeamento anterior mantido',
                data: { erro: err instanceof Error ? err.message : String(err) },
            });
        }
    };

    private executarSincronizacao = async (input: {
        triggeredBy: string;
        prazoMs?: number;
        releituraDias?: number;
    }): Promise<SincronizacaoDdaResultado> => {
        const limite = input.prazoMs !== undefined ? Date.now() + input.prazoMs : undefined;
        // O pool não é por filial; a filial só satisfaz a sessão do Conexos.
        const filCod = (await this.base.getFilCodDefault()) ?? 1;
        const [arquivos, conhecidos] = await Promise.all([
            this.dda.listarArquivos({ filCod }),
            this.repo.listArquivosSincronizados(),
        ]);
        const corte = Date.parse(
            `${this.calendar.addDays(
                this.calendar.todayBrt(),
                -(input.releituraDias ?? RELEITURA_DIAS),
            )}T00:00:00Z`,
        );
        const novos = arquivos.filter((a) => !conhecidos.has(a.ddcCod));
        const relidos = arquivos.filter(
            (a) => conhecidos.has(a.ddcCod) && (a.importadoEm ?? 0) >= corte,
        );
        const alvo: ArquivoDda[] = [...novos, ...relidos];
        const { boletos, falhas, arquivosAdiados, arquivosVazios } = await this.lerArquivos(
            alvo,
            filCod,
            limite,
        );
        // I-DDA7: a listagem deu certo — é uma conferência, mesmo que nenhum arquivo tenha sido gravado.
        await this.repo.registrarConferencia({
            origem: input.triggeredBy,
            arquivosLidos: alvo.length - falhas - arquivosAdiados,
            arquivosCabecalho: 0,
        });

        const resultado: SincronizacaoDdaResultado = {
            arquivosNovos: novos.length,
            arquivosRelidos: relidos.length,
            arquivosLidos: alvo.length - falhas - arquivosAdiados,
            boletos,
            falhas,
            arquivosAdiados,
            arquivosVazios,
        };
        await this.logService.info({
            type: LOG_TYPE.BUSINESS_INFO,
            message: 'sincronização de boletos DDA concluída',
            data: { triggeredBy: input.triggeredBy, ...resultado },
        });
        return resultado;
    };

    /**
     * I-DDA6 — conferência rápida (abertura da tela com carteira recente): UMA listagem do `fin124`
     * comparada com o snapshot. Novo → lê e grava os itens; cancelado/status/nome trocado → só o
     * cabeçalho; sumido → aviso (nunca apaga); nada mudou → só registra a conferência. Mesmo lock,
     * prazo e teto da passada completa. Nunca lança: o resultado diz o que houve.
     */
    public conferir = async (input: {
        triggeredBy: string;
        prazoMs?: number;
    }): Promise<ConferenciaDda> =>
        this.db.withAdvisoryLock(
            BOLETO_DDA_SYNC_LOCK_KEY,
            () => this.executarConferencia(input),
            async () => ({ estado: CONFERENCIA_DDA_ESTADO.OCUPADA }),
        );

    /** Confere só se a última conferência tem mais de `intervaloMs` (I-DDA6). */
    public conferirSeVelho = async (input: {
        triggeredBy: string;
        intervaloMs: number;
        agora?: number;
    }): Promise<ConferenciaDda | undefined> => {
        const agora = input.agora ?? Date.now();
        const ultima = await this.repo.ultimaConferencia();
        if (ultima !== undefined && agora - ultima < input.intervaloMs) return undefined;
        return this.conferir({ triggeredBy: input.triggeredBy, prazoMs: BOLETO_DDA_PRAZO_MS });
    };

    private executarConferencia = async (input: {
        triggeredBy: string;
        prazoMs?: number;
    }): Promise<ConferenciaDda> => {
        const limite = Date.now() + (input.prazoMs ?? BOLETO_DDA_PRAZO_MS);
        let arquivos: ArquivoDda[];
        let filCod: number;
        let conhecidos: Map<number, ArquivoDdaEstado>;
        try {
            filCod = (await this.base.getFilCodDefault()) ?? 1;
            [arquivos, conhecidos] = await Promise.all([
                this.dda.listarArquivos({ filCod }),
                this.repo.listArquivosEstado(),
            ]);
        } catch (err: unknown) {
            const erro = err instanceof Error ? err.message : String(err);
            await this.logService.warn({
                type: LOG_TYPE.BUSINESS_WARN,
                message: 'conferência rápida do DDA: não foi possível listar o fin124',
                data: { triggeredBy: input.triggeredBy, erro: erro.slice(0, 300) },
            });
            return { estado: CONFERENCIA_DDA_ESTADO.FALHOU, erro: erro.slice(0, 300) };
        }

        const novos = arquivos.filter((a) => !conhecidos.has(a.ddcCod));
        const mudados = arquivos.filter((a) => {
            const atual = conhecidos.get(a.ddcCod);
            return atual !== undefined && cabecalhoMudou(atual, a);
        });
        const listados = new Set(arquivos.map((a) => a.ddcCod));
        const sumidos = [...conhecidos.keys()].filter((ddc) => !listados.has(ddc));

        const leitura = await this.lerArquivos(novos, filCod, limite);
        for (const a of mudados) await this.repo.atualizarCabecalho(a);
        if (sumidos.length > 0) {
            await this.logService.warn({
                type: LOG_TYPE.BUSINESS_WARN,
                message:
                    'conferência rápida do DDA: arquivos sumiram da listagem do fin124; nada apagado',
                data: { ddcCods: sumidos.slice(0, 50), total: sumidos.length },
            });
        }
        const lidos = novos.length - leitura.falhas - leitura.arquivosAdiados;
        await this.repo.registrarConferencia({
            origem: input.triggeredBy,
            arquivosLidos: lidos,
            arquivosCabecalho: mudados.length,
        });
        if (lidos > 0 || mudados.length > 0) {
            this.sugestoesCache.invalidar();
            this.consolidadoCache.invalidar();
        }
        const resultado: ConferenciaDda = {
            estado:
                leitura.falhas > 0 || leitura.arquivosAdiados > 0
                    ? CONFERENCIA_DDA_ESTADO.PARCIAL
                    : CONFERENCIA_DDA_ESTADO.CONFERIDO,
            arquivosNovos: novos.length,
            arquivosCabecalho: mudados.length,
            arquivosSumidos: sumidos.length,
            boletos: leitura.boletos,
            falhas: leitura.falhas,
            arquivosAdiados: leitura.arquivosAdiados,
            ...(leitura.arquivosVazios > 0 ? { arquivosVazios: leitura.arquivosVazios } : {}),
        };
        await this.logService.info({
            type: LOG_TYPE.BUSINESS_INFO,
            message: 'conferência rápida do DDA concluída',
            data: { triggeredBy: input.triggeredBy, ...resultado },
        });
        return resultado;
    };

    /**
     * Lê e grava os itens de `alvo` (teto de 3 leituras, prazo). Falha de um arquivo não derruba os
     * outros; lista vazia sobre arquivo cheio (`EmptyDdaFileError`) é contada e logada à parte.
     */
    private lerArquivos = async (
        alvo: ArquivoDda[],
        filCod: number,
        limite: number | undefined,
    ): Promise<{
        boletos: number;
        falhas: number;
        arquivosAdiados: number;
        arquivosVazios: number;
    }> => {
        const resultados = await this.bounded.run(
            alvo,
            async (arquivo) => {
                // Prazo estourado: não começa arquivo novo. `null` ≠ falha — fica para a próxima.
                if (limite !== undefined && Date.now() > limite) return null;
                const itens = await this.dda.listarItens({ filCod, ddcCod: arquivo.ddcCod });
                await this.repo.salvarArquivo(arquivo, itens);
                return itens.length;
            },
            FANOUT_LIMIT,
        );
        let boletos = 0;
        let falhas = 0;
        let arquivosAdiados = 0;
        let arquivosVazios = 0;
        for (const [i, r] of resultados.entries()) {
            if (r.status === 'fulfilled') {
                if (r.value === null) arquivosAdiados += 1;
                else boletos += r.value;
                continue;
            }
            falhas += 1;
            if (r.reason instanceof EmptyDdaFileError) {
                arquivosVazios += 1;
                await this.logService.warn({
                    type: LOG_TYPE.BUSINESS_WARN,
                    message:
                        'sincronização DDA: fin124 devolveu arquivo vazio que tinha itens; snapshot mantido',
                    data: {
                        ddcCod: r.reason.ddcCod,
                        codigoErro: r.reason.code,
                        itensNoSnapshot: r.reason.itensNoSnapshot,
                    },
                });
                continue;
            }
            await this.logService.warn({
                type: LOG_TYPE.BUSINESS_INFO,
                message: 'sincronização DDA: falha ao ler arquivo do fin124',
                data: {
                    ddcCod: alvo[i]?.ddcCod,
                    erro: r.reason instanceof Error ? r.reason.message : String(r.reason),
                },
            });
        }
        return { boletos, falhas, arquivosAdiados, arquivosVazios };
    };
}

/** Cabeçalho do arquivo mudou no ERP (cancelado, status, nome, data de importação)? */
const cabecalhoMudou = (atual: ArquivoDdaEstado, novo: ArquivoDda): boolean =>
    (atual.canceladoEm ?? null) !== (novo.canceladoEm ?? null) ||
    (atual.status ?? null) !== (novo.status ?? null) ||
    (atual.nome ?? null) !== (novo.nome ?? null) ||
    (novo.importadoEm !== undefined && (atual.importadoEm ?? null) !== novo.importadoEm);
