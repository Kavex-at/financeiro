import { inject, injectable } from 'tsyringe';
import ConexosBaseClient from '../../client/ConexosBaseClient.js';
import ConexosSispagClient from '../../client/ConexosSispagClient.js';
import ConexosSispagWriteClient from '../../client/ConexosSispagWriteClient.js';
import PostgreeDatabaseClient from '../../client/database/PostgreeDatabaseClient.js';
import IngestLockBusyError from '../../errors/IngestLockBusyError.js';
import BoundedConcurrency from '../../libs/concurrency/BoundedConcurrency.js';
import { LOG_TYPE } from '../../interface/log/LogInterface.js';
import type { SinalPendente } from '../../interface/sispag/Fin015Write.js';
import { PagoPorConexosRotulo } from '../../interface/sispag/PagoPorConexos.js';
import {
    DDA_NA_INGESTAO,
    type DdaNaIngestao,
    type IngestaoPagamentosResult,
    type TituloAPagar,
} from '../../interface/sispag/SispagInterface.js';
import PagamentoIngestaoRunRepository from '../../repository/sispag/PagamentoIngestaoRunRepository.js';
import TituloAPagarRepository from '../../repository/sispag/TituloAPagarRepository.js';
import BloqueioDuplicidadeRepository from '../../repository/sispag/BloqueioDuplicidadeRepository.js';
import LogService from '../LogService.js';
import BoletoDdaService, { BOLETO_DDA_PRAZO_MS } from './BoletoDdaService.js';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Tipo do documento lido do `com298/list` (ADR-0075). */
type TipoDoDocumento = { tpdCod?: string; tpdDesNome?: string };

/**
 * Orçamento da sincronização DDA dentro da ingestão. A ingestão leva ~10 s medidos no cron; a
 * leitura do fin124 (arquivos novos + releitura) não pode multiplicar isso. O que não couber fica
 * para a próxima rodada (novos primeiro). O botão da aba usa o mesmo prazo (emenda 2026-10-30 da
 * ADR-0067); só o job avulso não tem prazo.
 */
export const DDA_PRAZO_NA_INGESTAO_MS = BOLETO_DDA_PRAZO_MS;
/** Chave de advisory lock EXCLUSIVA da ingestão de pagamentos (≠ da de permutas). */
export const PAGAMENTO_INGEST_LOCK_KEY = 726354819;
/** Teto de leituras Conexos simultâneas no fan-out da ingestão. */
const FANOUT_LIMIT = 4;

/**
 * IngestaoPagamentosService — cadência da carteira de pagamentos (cron ou manual).
 * Lê os títulos a pagar do Conexos (janela de vencimento), persiste os DADOS
 * BÁSICOS em `titulo_a_pagar` e grava um run de auditoria. Exclusão cross-processo
 * via advisory lock (`IngestLockBusyError` → 409). Espelha `IngestaoPermutasService`.
 * READ-ONLY no ERP; a única escrita é o Postgres próprio.
 */
@injectable()
export default class IngestaoPagamentosService {
    public constructor(
        @inject(TituloAPagarRepository) private readonly tituloRepo: TituloAPagarRepository,
        @inject(PagamentoIngestaoRunRepository)
        private readonly runRepo: PagamentoIngestaoRunRepository,
        @inject(ConexosSispagClient) private readonly sispag: ConexosSispagClient,
        @inject(ConexosSispagWriteClient) private readonly fin015: ConexosSispagWriteClient,
        @inject(ConexosBaseClient) private readonly base: ConexosBaseClient,
        @inject(BoundedConcurrency) private readonly bounded: BoundedConcurrency,
        @inject(PostgreeDatabaseClient) private readonly db: PostgreeDatabaseClient,
        @inject(LogService) private readonly logService: LogService,
        @inject(BloqueioDuplicidadeRepository)
        private readonly bloqueioRepo: BloqueioDuplicidadeRepository,
        @inject(BoletoDdaService) private readonly boletoDda: BoletoDdaService,
    ) {}

    public executar = async (input: {
        triggeredBy: string;
        idempotencyKey?: string;
    }): Promise<IngestaoPagamentosResult> => {
        if (input.idempotencyKey) {
            const existing = await this.runRepo.findRunIdByIdempotencyKey(input.idempotencyKey);
            if (existing) {
                return { runId: existing, status: 'success', totalTitulos: 0, totalInativados: 0 };
            }
        }
        return this.db.withAdvisoryLock(
            PAGAMENTO_INGEST_LOCK_KEY,
            () => this.runIngestion(input),
            async () => {
                throw new IngestLockBusyError(
                    'pagamento ingest advisory lock busy — another ingestion is running',
                );
            },
        );
    };

    /**
     * Títulos da filial que o ERP casou com um boleto DDA (`titVldReflexoDdaAssoc`).
     *
     * Best-effort por desenho: a carteira é o produto principal da ingestão, e o flag de boleto
     * é enriquecimento. Uma filial sem lote nativo (nada a usar como contexto de leitura do
     * grid), ou uma falha nessa leitura, devolve conjunto vazio com WARN — os títulos entram
     * com `temBoleto = false` em vez de a rodada inteira cair.
     */
    /**
     * Bancos distintos com conta pagadora na filial. Lista, não "o primeiro": o grid de
     * pendentes é da FILIAL e o banco só serve para achar um lote que sirva de contexto de
     * leitura. Medido em PRD (2026-08-31): `contas[0]` é o banco 38 na filial 1 e o 11 na
     * filial 2 — nenhum dos dois tem lote nativo, e a carteira INTEIRA dessas duas filiais
     * vinha marcada como "sem boleto". Pelo banco 4 a mesma leitura devolve 38 e 266 títulos.
     */
    private bancosDaFilial = async (filCod: number): Promise<number[]> => {
        const contas = await this.sispag.listContasCorrentes(filCod);
        return [...new Set(contas.map((c) => c.bncCod))];
    };

    /**
     * Sinais do grid de pendentes da filial: flag de boleto DDA (`titVldReflexoDdaAssoc`) e
     * forma de pagamento do título no Conexos (`titVldPagopor`), por chave.
     *
     * Best-effort por desenho: a carteira é o produto principal da ingestão, e os sinais são
     * enriquecimento. Falha de leitura devolve `undefined` ("não sei") com WARN: os títulos
     * entram com `temBoleto`/`formaPagamentoConexos` indefinidos e a carteira PRESERVA o valor
     * já gravado. Devolver um mapa vazio aqui apagava o flag de toda a filial — o cron do robô
     * (403 em `titulosPendentes`) zerava, todo dia, o que a ingestão manual da analista tinha
     * acertado.
     */
    private sinaisDosPendentes = async (
        filCod: number,
    ): Promise<Map<string, SinalPendente> | undefined> => {
        try {
            const bncCods = await this.bancosDaFilial(filCod);
            if (bncCods.length === 0) {
                await this.avisar('filial sem conta pagadora — sem flag de boleto', { filCod });
                return undefined;
            }
            const sinais = await this.fin015.listarSinaisDosPendentes({ filCod, bncCods });
            const comBoletoDda = [...sinais.values()].filter((s) => s.temBoletoDda).length;
            // Taxa por filial, registrada TODA rodada. É o sinal barato de quebra de contrato:
            // uma filial que historicamente traz dezenas de boletos e passa a trazer 0 aparece
            // aqui na rodada seguinte, em vez de aparecer no banco recusando a remessa.
            await this.logService.info({
                type: LOG_TYPE.BUSINESS_INFO,
                message: 'ingestão pagamentos: taxa de boleto DDA por filial',
                data: { filCod, bncCodsTentados: bncCods.length, comBoletoDda },
            });
            // Zero pode ser verdade (filial sem boleto) ou "nenhum banco tinha lote para servir
            // de contexto". A diferença importa: no segundo caso a coluna do painel mente.
            if (comBoletoDda === 0) {
                await this.avisar('nenhum título com boleto DDA nesta filial', {
                    filCod,
                    bncCodsTentados: bncCods.length,
                });
            }
            // Sem nenhum `titVldPagopor` legível o COALESCE do UPSERT congelaria a coluna em
            // silêncio — o aviso é o que denuncia a mudança de contrato do grid.
            if (sinais.size > 0 && [...sinais.values()].every((s) => s.pagoPor === undefined)) {
                await this.avisar('forma de pagamento (titVldPagopor) ilegível em todo o grid', {
                    filCod,
                    linhas: sinais.size,
                });
            }
            // Aviso é acessório: se o próprio log falhar, os sinais lidos não podem ir junto
            // (o catch abaixo devolveria `undefined` e descartaria a leitura boa).
            await this.avisarFormasDesconhecidas(filCod, sinais).catch(() => undefined);
            return sinais;
        } catch (error) {
            await this.avisar('leitura do flag de boleto DDA falhou — flag anterior preservado', {
                filCod,
                reason: error instanceof Error ? error.message : String(error),
            });
            return undefined;
        }
    };

    /**
     * Código de `titVldPagopor` que o Conexos mandou e a tabela não conhece (fora de
     * `PAGO_POR_CONEXOS_ROTULO`): é gravado (migration 0082) e a tela mostra "código N", mas alguém
     * precisa abrir um título de exemplo no psq014, ler o rótulo e cadastrá-lo. Um WARN por código
     * por filial, com a contagem e um título para conferir.
     */
    private avisarFormasDesconhecidas = async (
        filCod: number,
        sinais: Map<string, SinalPendente>,
    ): Promise<void> => {
        const porCodigo = new Map<number, { titulos: number; exemplo: string }>();
        for (const [chave, sinal] of sinais) {
            if (sinal.pagoPor === undefined || PagoPorConexosRotulo.de(sinal.pagoPor)) continue;
            const atual = porCodigo.get(sinal.pagoPor);
            if (atual) atual.titulos += 1;
            else porCodigo.set(sinal.pagoPor, { titulos: 1, exemplo: chave });
        }
        for (const [codigo, { titulos, exemplo }] of porCodigo) {
            await this.avisar(
                'forma de pagamento desconhecida (titVldPagopor) — cadastrar rótulo',
                {
                    filCod,
                    codigo,
                    titulos,
                    exemplo,
                },
            );
        }
    };

    /**
     * Sincroniza o pool DDA ANTES de ler os títulos: o flag e o casamento de boleto da carteira
     * leem `boleto_dda`, e uma carteira nova sobre um pool de 5 dias dá "boleto sem DDA" falso.
     *
     * Enriquecimento, como o flag de boleto: NUNCA derruba a ingestão. Falha vira WARN + `falhou`
     * no resultado (e na run); lock ocupado vira `ocupada` (a sincronização que já roda cobre);
     * prazo estourado vira `parcial`. Sequencial com a leitura de títulos — não paralelo — por
     * causa do cap de sessões do robô (ADR-0066 §3).
     */
    private sincronizarDda = async (triggeredBy: string): Promise<DdaNaIngestao> => {
        try {
            const r = await this.boletoDda.sincronizar({
                triggeredBy: `ingestao:${triggeredBy}`,
                prazoMs: DDA_PRAZO_NA_INGESTAO_MS,
            });
            const parcial = r.falhas > 0 || r.arquivosAdiados > 0;
            if (parcial) {
                await this.avisar('sincronização DDA parcial', { ...r });
            }
            return {
                estado: parcial ? DDA_NA_INGESTAO.PARCIAL : DDA_NA_INGESTAO.SINCRONIZADO,
                arquivosNovos: r.arquivosNovos,
                arquivosRelidos: r.arquivosRelidos,
                boletos: r.boletos,
                falhas: r.falhas,
                arquivosAdiados: r.arquivosAdiados,
                ...(r.arquivosVazios > 0 ? { arquivosVazios: r.arquivosVazios } : {}),
            };
        } catch (error) {
            if (error instanceof IngestLockBusyError) return { estado: DDA_NA_INGESTAO.OCUPADA };
            const erro = error instanceof Error ? error.message : String(error);
            await this.avisar('sincronização DDA falhou — pool anterior mantido', { erro });
            return { estado: DDA_NA_INGESTAO.FALHOU, erro: erro.slice(0, 300) };
        }
    };

    /**
     * Tipo do documento (`tpdCod`/`tpdDesNome`, `com298/list`) dos títulos da filial que entram na
     * carteira — insumo do motivo TIPO_PERMUTA (ADR-0075). O `fin064` não traz o tipo.
     *
     * Best-effort, como os sinais do grid: falha de leitura devolve `undefined` ("não sei") com
     * WARN, os títulos entram sem tipo e o UPSERT PRESERVA o que já estava gravado. A cobertura
     * (documentos com tipo / documentos lidos) vai ao log TODA rodada: é o sinal barato de que o
     * `com298` deixou de devolver o tipo, em vez de a permuta voltar a passar sem bloqueio.
     */
    private tiposDosDocumentos = async (
        filCod: number,
        titulos: TituloAPagar[],
        exterior: Set<string>,
    ): Promise<Map<string, TipoDoDocumento> | undefined> => {
        const docCods = [
            ...new Set(
                titulos.filter((t) => !t.pago && !exterior.has(t.docCod)).map((t) => t.docCod),
            ),
        ];
        try {
            const tipos = await this.sispag.listTiposDosDocumentos(filCod, docCods);
            await this.logService.info({
                type: LOG_TYPE.BUSINESS_INFO,
                message: 'ingestão pagamentos: cobertura do tipo do documento por filial',
                data: { filCod, documentos: docCods.length, comTipo: tipos.size },
            });
            if (docCods.length > 0 && tipos.size === 0) {
                await this.avisar('com298/list não devolveu o tipo de nenhum documento', {
                    filCod,
                    documentos: docCods.length,
                });
            }
            return tipos;
        } catch (error) {
            await this.avisar('leitura do tipo do documento falhou — tipo anterior preservado', {
                filCod,
                reason: error instanceof Error ? error.message : String(error),
            });
            return undefined;
        }
    };

    /** WARN da ingestão, com o prefixo padrão da frente. */
    private avisar = async (mensagem: string, data: Record<string, unknown>): Promise<void> => {
        await this.logService.warn({
            type: LOG_TYPE.BUSINESS_WARN,
            message: `ingestão pagamentos: ${mensagem}`,
            data,
        });
    };

    /**
     * Títulos de UMA filial que entram na carteira, já com o flag de boleto resolvido.
     * Extraído de `runIngestion` para manter o laço de acumulação legível.
     */
    private titulosDaFilial = (lido: {
        titulos: TituloAPagar[];
        exterior: Set<string>;
        /** `undefined` = a leitura do grid falhou: `temBoleto` fica indefinido (não vira `false`). */
        sinais: Map<string, SinalPendente> | undefined;
        /** `undefined` = a leitura do tipo falhou: o tipo fica indefinido e o UPSERT preserva. */
        tipos: Map<string, TipoDoDocumento> | undefined;
    }): TituloAPagar[] =>
        lido.titulos
            // Pago sai; internacional (exterior/câmbio) também — é câmbio manual da tesouraria,
            // fora do escopo SISPAG (ADR-0021).
            .filter((t) => !t.pago && !lido.exterior.has(t.docCod))
            // "Tem boleto?" vem do flag de DDA do grid de pendentes — nunca do título
            // (o `titEspCodbar` é null em 100% da carteira medida em produção). A forma de
            // pagamento no Conexos vem da mesma linha; fora do grid fica indefinida (preserva).
            .map((t) => {
                const sinal = lido.sinais?.get(`${t.filCod}:${t.docCod}:${t.titCod}`);
                const tipo = lido.tipos?.get(t.docCod);
                return {
                    ...t,
                    ...(tipo?.tpdCod !== undefined ? { tpdCod: tipo.tpdCod } : {}),
                    ...(tipo?.tpdDesNome !== undefined ? { tpdDesNome: tipo.tpdDesNome } : {}),
                    temBoleto: lido.sinais ? sinal?.temBoletoDda === true : undefined,
                    ...(sinal?.pagoPor !== undefined
                        ? { formaPagamentoConexos: sinal.pagoPor }
                        : {}),
                };
            });

    /** `filial 4: conexos 504; filial 7: …` — curto o bastante para a coluna `error_message`. */
    private resumoFalhas = (falhas: Array<{ filCod: number; motivo: string }>): string =>
        falhas
            .map((f) => `filial ${f.filCod}: ${f.motivo.slice(0, 120)}`)
            .join('; ')
            .slice(0, 500);

    /**
     * Texto que acompanha uma run `success` incompleta (coluna `error_message`); `undefined` =
     * nada a avisar. DDA `ocupada` não é aviso: a sincronização que já rodava cobre esta rodada.
     */
    private avisoDaRun = (input: {
        falhas: Array<{ filCod: number; motivo: string }>;
        filiaisSemFlagBoleto: number[];
        dda: DdaNaIngestao;
    }): string | undefined => {
        const { falhas, filiaisSemFlagBoleto, dda } = input;
        const ddaComAviso =
            dda.estado === DDA_NA_INGESTAO.FALHOU || dda.estado === DDA_NA_INGESTAO.PARCIAL;
        const partes = [
            falhas.length > 0 ? `filiais não lidas: ${this.resumoFalhas(falhas)}` : undefined,
            filiaisSemFlagBoleto.length > 0
                ? `flag de boleto DDA não lido (anterior preservado): filiais ${filiaisSemFlagBoleto.join(', ')}`
                : undefined,
            ddaComAviso
                ? `pool DDA ${dda.estado}${dda.erro ? ` (${dda.erro.slice(0, 120)})` : ''}`
                : undefined,
            // fault-tolerance-1: lista vazia do fin124 não é falha de leitura comum; o código
            // separa o caso (snapshot mantido) na trilha da run.
            dda.arquivosVazios
                ? `${dda.arquivosVazios} arquivo(s) vazio(s) no fin124 (DDA_FILE_EMPTY)`
                : undefined,
        ].filter(Boolean);
        return partes.length > 0 ? partes.join('; ') : undefined;
    };

    private runIngestion = async (input: {
        triggeredBy: string;
        idempotencyKey?: string;
    }): Promise<IngestaoPagamentosResult> => {
        const runId = await this.runRepo.createRun({ triggeredBy: input.triggeredBy });
        try {
            // Pool DDA primeiro: o que vem a seguir (flag + casamento) lê `boleto_dda`.
            const dda = await this.sincronizarDda(input.triggeredBy);
            const filiais = await this.base.getFiliais();
            const filCods = filiais
                .map((f) => f.filCod)
                .filter((n): n is number => typeof n === 'number');

            const now = Date.now();
            const minVencimento = now - 15 * DAY_MS;
            const maxVencimento = now + 45 * DAY_MS;

            // Por filial: títulos (fin064) + conjunto de docs a EXCLUIR (exterior/câmbio,
            // com298 ufEspSigla=EX). Internacional está FORA do escopo SISPAG (é câmbio manual
            // da tesouraria, Itaú→BB) — nem entra na carteira. Ver ADR-0021.
            const settled = await this.bounded.run(
                filCods,
                async (filCod) => {
                    const [titulos, exterior, sinais] = await Promise.all([
                        this.sispag.listTitulosAPagar(filCod, { minVencimento, maxVencimento }),
                        this.sispag.listExteriorDocCods(filCod),
                        this.sinaisDosPendentes(filCod),
                    ]);
                    // Depois da leitura dos títulos: precisa dos docCods. Mesma sessão do robô,
                    // sequencial dentro da filial (teto de sessões, ADR-0066 §3).
                    const tipos = await this.tiposDosDocumentos(filCod, titulos, exterior);
                    return { titulos, exterior, sinais, tipos };
                },
                FANOUT_LIMIT,
            );

            const titulos: TituloAPagar[] = [];
            // Só as filiais LIDAS com sucesso participam da inativação anti-fantasma —
            // uma filial que falhou não perde seus títulos por engano (fault-tolerance).
            const filiaisLidas: number[] = [];
            const falhas: Array<{ filCod: number; motivo: string }> = [];
            const filiaisSemFlagBoleto: number[] = [];
            for (let i = 0; i < settled.length; i += 1) {
                const s = settled[i];
                if (s.status !== 'fulfilled') {
                    const motivo = s.reason instanceof Error ? s.reason.message : String(s.reason);
                    await this.avisar('leitura de filial falhou (ignorada)', {
                        filCod: filCods[i],
                        reason: motivo,
                    });
                    falhas.push({ filCod: filCods[i], motivo });
                    continue;
                }
                filiaisLidas.push(filCods[i]);
                if (s.value.sinais === undefined) filiaisSemFlagBoleto.push(filCods[i]);
                titulos.push(...this.titulosDaFilial(s.value));
            }

            // Zero filiais lidas NÃO é "carteira vazia": é a ingestão cega (senha do Conexos
            // vencida, ERP fora). Gravar `success` com 0 títulos congelou a carteira por dias sem
            // alarme (secrets dos crons, 20–30/09). Vira `error` ANTES de tocar a carteira — o
            // catch fecha a run, o job sai com 1 e o alerta do workflow dispara.
            if (filiaisLidas.length === 0) {
                throw new Error(
                    filCods.length === 0
                        ? 'ingestão sem leitura: o Conexos não devolveu nenhuma filial'
                        : `ingestão sem leitura: nenhuma das ${filCods.length} filiais foi lida (${this.resumoFalhas(falhas)})`,
                );
            }

            await this.tituloRepo.upsertMany(titulos, runId);
            const inativados = await this.tituloRepo.marcarInativosForaDaRun(runId, filiaisLidas);
            // Leitura parcial segue `success` (as filiais lidas valem), mas não em silêncio: a run
            // guarda o que ficou de fora e o resultado o devolve.
            const avisoDaRun = this.avisoDaRun({ falhas, filiaisSemFlagBoleto, dda });
            await this.runRepo.finishRun({
                runId,
                status: 'success',
                totalTitulos: titulos.length,
                totalInativados: inativados,
                ...(avisoDaRun ? { errorMessage: avisoDaRun } : {}),
            });
            // ADR-0063 I13g — título que sumiu do fin064 (inativo agora) encerra o bloqueio por
            // duplicidade: o cancelamento no Conexos aconteceu (ou o título foi pago/baixado). É
            // efeito pós-sucesso: falhar aqui não regride a run; a próxima ingestão encerra.
            let bloqueiosEncerrados = 0;
            try {
                bloqueiosEncerrados = await this.bloqueioRepo.encerrarDeTitulosInativos();
                // ADR-0069 emenda 1 (I16g): marcas por código de barras também encerram pelos
                // sinais baratos (item mantido pago/inativo; lote de origem cancelado sem remessa).
                bloqueiosEncerrados += await this.bloqueioRepo.encerrarPorSinaisDeCodigoDeBarras();
            } catch (error) {
                await this.logService.warn({
                    type: LOG_TYPE.BUSINESS_WARN,
                    message:
                        'ingestão: falha ao encerrar bloqueios por duplicidade de títulos inativos',
                    data: { runId, erro: error instanceof Error ? error.name : 'erro' },
                });
            }
            // Best-effort pós-sucesso: a run JÁ está 'success' e os títulos persistidos —
            // uma falha aqui (blip de banco no idempotency, log) NÃO deve remarcar como error.
            try {
                if (input.idempotencyKey) {
                    await this.runRepo.recordIdempotencyKey(input.idempotencyKey, runId);
                }
                await this.logService.info({
                    type: LOG_TYPE.BUSINESS_INFO,
                    message: 'ingestão de pagamentos concluída',
                    data: {
                        runId,
                        triggeredBy: input.triggeredBy,
                        totalTitulos: titulos.length,
                        inativados,
                        bloqueiosEncerrados,
                    },
                });
            } catch {
                // best-effort — não regride o status da run.
            }
            return {
                runId,
                status: 'success',
                totalTitulos: titulos.length,
                totalInativados: inativados,
                filiaisComFalha: falhas.map((f) => f.filCod),
                filiaisSemFlagBoleto,
                dda,
            };
        } catch (error) {
            await this.runRepo.finishRun({
                runId,
                status: 'error',
                totalTitulos: 0,
                totalInativados: 0,
                errorMessage: error instanceof Error ? error.message : String(error),
            });
            throw error;
        }
    };
}
