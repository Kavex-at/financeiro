import { inject, injectable } from 'tsyringe';
import ConexosSispagRetornoClient from '../../client/ConexosSispagRetornoClient.js';
import { LOG_TYPE } from '../../interface/log/LogInterface.js';
import type { ArquivoRetornoDetalhe } from '../../interface/sispag/Fin052Retorno.js';
import type { EventoRetornoItem } from '../../interface/sispag/SincronizacaoLote.js';
import EnvironmentProvider from '../../libs/environment/EnvironmentProvider.js';
import LotePagamentoRepository from '../../repository/sispag/LotePagamentoRepository.js';
import ConciliacaoEmDuvidaError from '../../errors/ConciliacaoEmDuvidaError.js';
import BoundedConcurrency from '../../libs/concurrency/BoundedConcurrency.js';
import ConciliacaoExecucaoRepository from '../../repository/sispag/ConciliacaoExecucaoRepository.js';
import LogService from '../LogService.js';
import SincronizacaoLoteService from './SincronizacaoLoteService.js';

export interface ConciliarInput {
    filCod: number;
    bncCod: number;
    gtbCodSeq: number;
    garCodSeq: number;
    ator: string;
    /** Processa o arquivo no ERP antes de conciliar (gera as baixas no fin010). */
    processar?: boolean;
    dryRunOverride?: boolean;
    /** Chave de idempotência. Ausente → derivada do arquivo (fil+bnc+gtb+gar). */
    idempotencyKey?: string;
    correlationId?: string;
}

export interface ItemConciliado {
    loteId?: string;
    docCod?: string;
    titCod?: string;
    flpCod?: number;
    itsCodSeq?: number;
    evento?: string;
    descricao?: string;
    rejeitado: boolean;
    borCod?: number;
    bxaCodSeq?: number;
    contaFinanceira?: number;
    valorPago?: number;
    /** `false` quando a linha não casou com nenhum lote nosso (retorno de lote montado fora). */
    reconhecido: boolean;
}

/**
 * Concorrência do fan-out por código de evento. Mesmo valor do painel — o gargalo real
 * não é CPU, é o pool de sessões do Conexos (`LOGIN_ERROR_MAX_SESSIONS` acima disso).
 */
const CONEXOS_FANOUT_LIMIT = 4;

export interface ConciliarResult {
    dryRun: boolean;
    writeEnabled: boolean;
    processado: boolean;
    totalLinhas: number;
    pagos: number;
    rejeitados: number;
    naoReconhecidos: number;
    lotesAfetados: string[];
    itens: ItemConciliado[];
    /**
     * `true` quando algum código de evento não pôde ser lido. A conciliação é PARCIAL: pode
     * haver rejeição que não apareceu. Desde a ADR-0055 isso não impede `BAIXADO` de título
     * PAGO no fin064 (I11b) — a prova é o título —, mas o ledger não fecha (`fail`) para que
     * uma segunda passada releia o arquivo.
     */
    varreduraIncompleta: boolean;
    /** Códigos que falharam, com o motivo — para o operador saber o que refazer. */
    eventosNaoLidos: Array<{ evento: string; motivo: string }>;
    /** `true` quando o ledger curto-circuitou: este arquivo já tinha sido conciliado. */
    jaConciliado?: boolean;
}

/**
 * ConciliacaoRetornoService — lê o retorno `.RET` processado no fin052 e traz o resultado para
 * dentro do nosso `lote_pagamento`.
 *
 * ── POR QUE ISTO PRECISA EXISTIR ────────────────────────────────────────────────────────
 * O ERP NÃO guarda a rastreabilidade lote → borderô em lugar consultável. Medido em produção:
 * nos lotes com retorno processado, todos os itens têm `borCod` nulo no `finItemSispag`, e o
 * `vldHasRemessaPgto` do borderô vem 0 mesmo para baixa vinda de remessa. O único lugar onde
 * o elo existe é a linha de detalhe do retorno — e ela só é legível informando o código EXATO
 * do evento bancário. Se ninguém copiar esse vínculo, ele se perde.
 *
 * ── COMO A LINHA CASA COM O NOSSO LOTE ──────────────────────────────────────────────────
 * Sem heurística: o ERP grava a chave `filCod+bncCod+flpCod+itsCodSeq` no campo "uso da
 * empresa" do segmento A da remessa (pos. 74-93) e a lê de volta do `.RET`. A linha de
 * detalhe devolve `flpCod` e `itsCodSeq` prontos — é só achar o lote local pela chave nativa.
 */
@injectable()
export default class ConciliacaoRetornoService {
    public constructor(
        @inject(ConexosSispagRetornoClient) private readonly retorno: ConexosSispagRetornoClient,
        @inject(LotePagamentoRepository) private readonly loteRepo: LotePagamentoRepository,
        @inject(EnvironmentProvider) private readonly environmentProvider: EnvironmentProvider,
        @inject(LogService) private readonly logService: LogService,
        @inject(BoundedConcurrency) private readonly bounded: BoundedConcurrency,
        @inject(ConciliacaoExecucaoRepository)
        private readonly ledger: ConciliacaoExecucaoRepository,
        @inject(SincronizacaoLoteService) private readonly sincronizacao: SincronizacaoLoteService,
    ) {}

    public conciliar = async (input: ConciliarInput): Promise<ConciliarResult> => {
        const env = await this.environmentProvider.getEnvironmentVars();
        const writeEnabled = env.conexosWriteEnabled;
        // `sispagLiveWriteEnabled` é o kill-switch DESTA frente: conter um bug do SISPAG
        // pelo `conexosDryRun` global desligaria Permutas e Recebimentos junto.
        const dryRun =
            !writeEnabled ||
            !env.sispagLiveWriteEnabled ||
            env.conexosDryRun ||
            input.dryRunOverride === true;

        // ── 0) ledger write-ahead ───────────────────────────────────────────
        // `arquivosRetorno/processar` gera as baixas no fin010 e NÃO é idempotente. Sem
        // trilha, dois cliques ou um restart do Render entre o PUT e a resposta HTTP gravam
        // baixa em cima de baixa. A identidade é o ARQUIVO, não a sessão de quem clicou.
        const key =
            input.idempotencyKey ??
            `conciliacao:${input.filCod}:${input.bncCod}:${input.gtbCodSeq}:${input.garCodSeq}`;
        const anterior = await this.ledger.findByIdempotencyKey(key);

        if (anterior?.status === 'settled' && !anterior.dryRun && !dryRun) {
            await this.logService.info({
                type: LOG_TYPE.BUSINESS_INFO,
                message: 'conciliação já processada — curto-circuito idempotente',
                data: { ...this.chave(input), key, processouAntes: anterior.processou },
            });
            return {
                dryRun,
                writeEnabled,
                processado: anterior.processou,
                totalLinhas: anterior.totalLinhas ?? 0,
                pagos: anterior.pagos ?? 0,
                rejeitados: anterior.rejeitados ?? 0,
                naoReconhecidos: 0,
                lotesAfetados: [],
                itens: [],
                varreduraIncompleta: anterior.varreduraIncompleta,
                eventosNaoLidos: [],
                jaConciliado: true,
            };
        }

        // O ERP CARIMBA o arquivo com `processadoEm` quando o `processar` roda. Perguntar
        // isso é barato e vale SEMPRE — não só na retomada.
        //
        // Antes esta checagem morava só dentro do ramo de órfão, e o gate ao vivo mostrou o
        // buraco: uma conciliação NOVA (ledger limpo) sobre um arquivo já processado chamava
        // `processar` de novo. O ERP recusou com "O VALOR BAIXADO NÃO PODE SER ZERO" — ou
        // seja, quem nos protegeu foi ele, não nós. Depender da recusa do outro sistema é
        // exatamente a postura que este serviço existe para abandonar.
        let jaProcessadoNoErp = false;
        if (input.processar && !dryRun) {
            const estadoArquivo = await this.retorno.getArquivoRetorno(this.chave(input));
            if (estadoArquivo?.processadoEm) {
                jaProcessadoNoErp = true;
                await this.logService.info({
                    type: LOG_TYPE.BUSINESS_INFO,
                    message: 'arquivo já processado no ERP — `processar` não será chamado',
                    data: { ...this.chave(input), processadoEm: estadoArquivo.processadoEm },
                });
            }
        }

        // `processar` anterior em voo que nunca confirmou.
        if (anterior && !anterior.dryRun && anterior.status === 'reconciling') {
            const estado = jaProcessadoNoErp
                ? { processadoEm: 1 }
                : await this.retorno.getArquivoRetorno(this.chave(input));
            if (estado?.processadoEm) {
                jaProcessadoNoErp = true;
                await this.logService.warn({
                    type: LOG_TYPE.BUSINESS_WARN,
                    message: 'conciliação órfã: o ERP já processou o arquivo — seguindo da leitura',
                    data: { ...this.chave(input), key },
                });
            } else if (estado) {
                // O arquivo existe e NÃO foi processado: o PUT não chegou a valer. Refazer
                // é seguro — não há baixa no fin010 para duplicar.
                await this.logService.warn({
                    type: LOG_TYPE.BUSINESS_WARN,
                    message: 'conciliação órfã: o ERP não processou o arquivo — refazendo',
                    data: { ...this.chave(input), key },
                });
            } else {
                // Não consegui ler o estado do arquivo. Sem essa resposta, repetir o
                // `processar` poderia gravar baixa em cima de baixa.
                await this.logService.error({
                    type: LOG_TYPE.BUSINESS_WARN,
                    message: 'conciliação EM DÚVIDA (estado do arquivo indeterminado)',
                    data: { ...this.chave(input), key },
                });
                throw new ConciliacaoEmDuvidaError({
                    idempotencyKey: key,
                    filCod: input.filCod,
                    bncCod: input.bncCod,
                    garCodSeq: input.garCodSeq,
                    ...(anterior.criadoEm !== undefined ? { criadoEm: anterior.criadoEm } : {}),
                });
            }
        }

        await this.ledger.beginExecution({
            idempotencyKey: key,
            ...(input.correlationId !== undefined ? { correlationId: input.correlationId } : {}),
            filCod: input.filCod,
            bncCod: input.bncCod,
            gtbCodSeq: input.gtbCodSeq,
            garCodSeq: input.garCodSeq,
            dryRun,
            executadoPor: input.ator,
        });

        // ── 1) processar no ERP (opcional) — é o passo que gera as BAIXAS ────
        let processado = false;
        if (input.processar) {
            if (dryRun) {
                await this.logService.info({
                    type: LOG_TYPE.BUSINESS_INFO,
                    message: 'retorno DRY-RUN — `processar` não chamado',
                    data: { ...this.chave(input) },
                });
            } else if (jaProcessadoNoErp) {
                // Já rodou lá. Repetir geraria baixa em cima de baixa.
                processado = true;
            } else {
                // Marcado ANTES do PUT: se o processo morrer aqui, a próxima tentativa
                // pergunta ao ERP em vez de supor.
                await this.ledger.marcarProcessado(key);
                await this.retorno.processarArquivoRetorno(this.chave(input));
                processado = true;
                await this.logService.info({
                    type: LOG_TYPE.BUSINESS_INFO,
                    message: 'retorno processado no ERP (baixas geradas no fin010)',
                    data: { ...this.chave(input), ator: input.ator },
                });
            }
        }

        // ── 2) ler o detalhe, código a código ───────────────────────────────
        // O ERP exige `fbeEspCod` EXATO como filtro — não aceita `#IN` nem `#LIKE`. Então a
        // varredura é por código configurado do banco. Arquivo só CARREGADO não tem detalhe.
        const eventos = await this.retorno.listEventosBancarios({
            filCod: input.filCod,
            bncCod: input.bncCod,
        });
        const linhas: ArquivoRetornoDetalhe[] = [];
        // Falhas de leitura por código. NÃO é a mesma coisa que "código ausente": um código
        // que não está no arquivo devolve `rows: []`, sem exceção. O `catch` anterior dizia
        // "código não presente neste arquivo — segue" e engolia timeout, 5xx e 401 junto —
        // uma varredura pela metade saía como conciliação bem-sucedida. O caso caro é a
        // linha de REJEIÇÃO perdida. Desde a ADR-0055 quem fecha o lote é o título (fin064),
        // não a ausência de rejeição; ainda assim a falha fica registrada e o ledger não fecha.
        const eventosNaoLidos: Array<{ evento: string; motivo: string }> = [];
        // Em série isso custava ~92 s p50 no Bradesco (153 códigos × runWithRetry) — acima do
        // timeout do proxy do Render. O pool é o mesmo já usado no painel; o limite é baixo
        // de propósito, porque o burst de sessões é o que produz LOGIN_ERROR_MAX_SESSIONS.
        const detalhes = await this.bounded.run(
            eventos,
            (ev) =>
                this.retorno.listDetalhe({
                    ...this.chave(input),
                    eventoCod: ev.cod,
                    eventoTipo: ev.tipo,
                    pageSize: 200,
                }),
            CONEXOS_FANOUT_LIMIT,
        );
        for (const [i, resultado] of detalhes.entries()) {
            const ev = eventos[i];
            if (ev === undefined) continue;
            if (resultado.status === 'fulfilled') {
                for (const d of resultado.value) {
                    linhas.push({ ...d, eventoDescricao: d.eventoDescricao ?? ev.descricao });
                }
                continue;
            }
            const motivo =
                resultado.reason instanceof Error
                    ? resultado.reason.message
                    : String(resultado.reason);
            eventosNaoLidos.push({ evento: ev.cod, motivo });
            await this.logService.error({
                type: LOG_TYPE.CONEXOS_ERROR,
                message: 'falha ao ler detalhe de evento do retorno — varredura incompleta',
                data: { ...this.chave(input), evento: ev.cod, descricao: ev.descricao, motivo },
            });
        }
        const varreduraIncompleta = eventosNaoLidos.length > 0;

        // `fbeVldTpret = 2` marca rejeição; `1` é pagamento efetuado.
        const rejeicaoPorCodigo = new Map(eventos.map((e) => [e.cod, e.tipoRetorno === 2]));

        // ── 3) casar cada linha com o lote local ───────────────────────────
        // A chave nativa é composta, e a FILIAL é a da LINHA, não a do arquivo: um mesmo `.RET`
        // mistura filiais (gar 9 do PG230901.REM: fil 1/flp 8 e fil 2/flp 24 — ADR-0055).
        const itens: ItemConciliado[] = [];
        const eventosPorLote = new Map<string, Map<string, EventoRetornoItem[]>>();
        for (const l of linhas) {
            const rejeitado = rejeicaoPorCodigo.get(l.eventoCod ?? '') ?? false;
            const base = this.itemConciliado(l, rejeitado);
            if (l.flpCod === undefined || l.docCod === undefined) {
                itens.push(base);
                continue;
            }
            const loteId = await this.loteRepo.findByChaveNativa({
                nativeFilCod: l.filCod,
                nativeBncCod: l.bncCod,
                nativeFlpCod: l.flpCod,
            });
            if (!loteId) {
                // Retorno de um lote montado direto no ERP, fora da nossa aplicação. Não é
                // erro — é informação: mostramos, mas não temos onde gravar.
                itens.push(base);
                continue;
            }
            const doLote = eventosPorLote.get(loteId) ?? new Map<string, EventoRetornoItem[]>();
            const chave = `${l.docCod}:${l.titCod ?? '1'}`;
            doLote.set(chave, [...(doLote.get(chave) ?? []), this.eventoDaLinha(l, rejeitado)]);
            eventosPorLote.set(loteId, doLote);
            itens.push({ ...base, loteId, reconhecido: true });
        }

        // ── 4) fechar os lotes pelo MESMO fechamento de L11 (I11) ───────────
        // Todas as linhas do item entram, e a precedência `REJEITADO > 00 > BD` decide — não a
        // última lida. A prova de pagamento é o título (fin064), então uma varredura incompleta
        // não impede `BAIXADO` de título pago (I11b), e o que não foi lido não vira rejeição
        // (I11c). Itens + transição vão numa transação por lote, sob optimistic lock.
        //
        // Gravar o que se OBSERVOU não é escrever no ERP (I11g): os kill-switches de escrita não
        // bloqueiam este passo. Só a simulação explícita (`dryRunOverride`) deixa de gravar.
        const lotesAfetados = new Set(eventosPorLote.keys());
        if (input.dryRunOverride !== true) {
            for (const [loteId, eventos] of eventosPorLote) {
                await this.sincronizacao.aplicarEventosRetorno(loteId, eventos);
            }
        }

        const pagos = itens.filter((i) => !i.rejeitado && i.reconhecido).length;
        const rejeitados = itens.filter((i) => i.rejeitado).length;
        const naoReconhecidos = itens.filter((i) => !i.reconhecido).length;

        await this.logService.info({
            type: LOG_TYPE.BUSINESS_INFO,
            message: 'retorno conciliado',
            data: {
                ...this.chave(input),
                dryRun,
                processado,
                total: itens.length,
                pagos,
                rejeitados,
                naoReconhecidos,
                varreduraIncompleta,
                eventosNaoLidos: eventosNaoLidos.length,
            },
        });

        // Fecha o ledger. Varredura incompleta NÃO fecha: o arquivo precisa ser reconciliado
        // de novo, e `settled` bloquearia a segunda passada — que aqui é justamente o certo.
        if (varreduraIncompleta) {
            await this.ledger.fail(
                key,
                `varredura incompleta: ${eventosNaoLidos.map((e) => e.evento).join(', ')}`,
            );
        } else {
            await this.ledger.settle(key, {
                processou: processado,
                totalLinhas: itens.length,
                pagos,
                rejeitados,
                varreduraIncompleta,
            });
        }

        return {
            dryRun,
            writeEnabled,
            processado,
            totalLinhas: itens.length,
            pagos,
            rejeitados,
            naoReconhecidos,
            lotesAfetados: [...lotesAfetados],
            itens,
            varreduraIncompleta,
            eventosNaoLidos,
        };
    };

    /** A linha do detalhe como ela sai na resposta (inclusive a não reconhecida). */
    private itemConciliado = (l: ArquivoRetornoDetalhe, rejeitado: boolean): ItemConciliado => ({
        ...(l.flpCod !== undefined ? { flpCod: l.flpCod } : {}),
        ...(l.itsCodSeq !== undefined ? { itsCodSeq: l.itsCodSeq } : {}),
        ...(l.docCod !== undefined ? { docCod: l.docCod } : {}),
        ...(l.titCod !== undefined ? { titCod: l.titCod } : {}),
        ...(l.eventoCod !== undefined ? { evento: l.eventoCod } : {}),
        ...(l.eventoDescricao !== undefined ? { descricao: l.eventoDescricao } : {}),
        rejeitado,
        ...(l.borCod !== undefined ? { borCod: l.borCod } : {}),
        ...(l.bxaCodSeq !== undefined ? { bxaCodSeq: l.bxaCodSeq } : {}),
        ...(l.gerNum !== undefined ? { contaFinanceira: l.gerNum } : {}),
        ...(l.valorPago !== undefined ? { valorPago: l.valorPago } : {}),
        reconhecido: false,
    });

    private eventoDaLinha = (l: ArquivoRetornoDetalhe, rejeitado: boolean): EventoRetornoItem => ({
        eventoCod: l.eventoCod ?? '',
        ...(l.eventoDescricao !== undefined ? { descricao: l.eventoDescricao } : {}),
        rejeitado,
        ...(l.borCod !== undefined ? { borCod: l.borCod } : {}),
        ...(l.bxaCodSeq !== undefined ? { bxaCodSeq: l.bxaCodSeq } : {}),
    });

    private chave = (
        i: ConciliarInput,
    ): {
        filCod: number;
        bncCod: number;
        gtbCodSeq: number;
        garCodSeq: number;
    } => ({
        filCod: i.filCod,
        bncCod: i.bncCod,
        gtbCodSeq: i.gtbCodSeq,
        garCodSeq: i.garCodSeq,
    });
}
