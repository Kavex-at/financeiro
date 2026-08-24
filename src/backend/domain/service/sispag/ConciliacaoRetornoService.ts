import { inject, injectable } from 'tsyringe';
import ConexosSispagRetornoClient from '../../client/ConexosSispagRetornoClient.js';
import { LOG_TYPE } from '../../interface/log/LogInterface.js';
import type { ArquivoRetornoDetalhe } from '../../interface/sispag/Fin052Retorno.js';
import { LOTE_STATUS } from '../../interface/sispag/SispagInterface.js';
import EnvironmentProvider from '../../libs/environment/EnvironmentProvider.js';
import LotePagamentoRepository from '../../repository/sispag/LotePagamentoRepository.js';
import LogService from '../LogService.js';

export interface ConciliarInput {
    filCod: number;
    bncCod: number;
    gtbCodSeq: number;
    garCodSeq: number;
    ator: string;
    /** Processa o arquivo no ERP antes de conciliar (gera as baixas no fin010). */
    processar?: boolean;
    dryRunOverride?: boolean;
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
     * `true` quando algum código de evento não pôde ser lido. A conciliação é PARCIAL:
     * pode haver rejeição ou pagamento que não apareceu. Nenhum lote fecha em BAIXADO
     * nessa condição.
     */
    varreduraIncompleta: boolean;
    /** Códigos que falharam, com o motivo — para o operador saber o que refazer. */
    eventosNaoLidos: Array<{ evento: string; motivo: string }>;
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
    ) {}

    public conciliar = async (input: ConciliarInput): Promise<ConciliarResult> => {
        const env = await this.environmentProvider.getEnvironmentVars();
        const writeEnabled = env.conexosWriteEnabled;
        const dryRun = !writeEnabled || env.conexosDryRun || input.dryRunOverride === true;

        // ── 1) processar no ERP (opcional) — é o passo que gera as BAIXAS ────
        let processado = false;
        if (input.processar) {
            if (dryRun) {
                await this.logService.info({
                    type: LOG_TYPE.BUSINESS_INFO,
                    message: 'retorno DRY-RUN — `processar` não chamado',
                    data: { ...this.chave(input) },
                });
            } else {
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
        // linha de REJEIÇÃO perdida: sem ela, `transicionarLote` não vê rejeição nenhuma e
        // marca o lote como BAIXADO. Dinheiro que o banco recusou, reportado como pago.
        const eventosNaoLidos: Array<{ evento: string; motivo: string }> = [];
        for (const ev of eventos) {
            try {
                const det = await this.retorno.listDetalhe({
                    ...this.chave(input),
                    eventoCod: ev.cod,
                    eventoTipo: ev.tipo,
                    pageSize: 200,
                });
                for (const d of det) {
                    linhas.push({ ...d, eventoDescricao: d.eventoDescricao ?? ev.descricao });
                }
            } catch (cause) {
                const motivo = cause instanceof Error ? cause.message : String(cause);
                eventosNaoLidos.push({ evento: ev.cod, motivo });
                await this.logService.error({
                    type: LOG_TYPE.CONEXOS_ERROR,
                    message: 'falha ao ler detalhe de evento do retorno — varredura incompleta',
                    data: { ...this.chave(input), evento: ev.cod, descricao: ev.descricao, motivo },
                });
            }
        }
        const varreduraIncompleta = eventosNaoLidos.length > 0;

        // `fbeVldTpret = 2` marca rejeição; `1` é pagamento efetuado.
        const rejeicaoPorCodigo = new Map(eventos.map((e) => [e.cod, e.tipoRetorno === 2]));

        // ── 3) casar cada linha com o lote local e gravar ───────────────────
        const itens: ItemConciliado[] = [];
        const lotesAfetados = new Set<string>();

        for (const l of linhas) {
            const rejeitado = rejeicaoPorCodigo.get(l.eventoCod ?? '') ?? false;
            const base: ItemConciliado = {
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
            };

            if (l.flpCod === undefined || l.docCod === undefined) {
                itens.push(base);
                continue;
            }
            const loteId = await this.loteRepo.findByChaveNativa({
                nativeFilCod: input.filCod,
                nativeBncCod: input.bncCod,
                nativeFlpCod: l.flpCod,
            });
            if (!loteId) {
                // Retorno de um lote montado direto no ERP, fora da nossa aplicação. Não é
                // erro — é informação: mostramos, mas não temos onde gravar.
                itens.push(base);
                continue;
            }

            if (!dryRun) {
                await this.loteRepo.registrarConciliacaoItem({
                    loteId,
                    filCod: l.filCod,
                    docCod: l.docCod,
                    titCod: l.titCod ?? '1',
                    evento: l.eventoCod ?? '',
                    ...(l.eventoDescricao !== undefined ? { descricao: l.eventoDescricao } : {}),
                    rejeitado,
                    ...(l.borCod !== undefined ? { borCod: l.borCod } : {}),
                    ...(l.bxaCodSeq !== undefined ? { bxaCodSeq: l.bxaCodSeq } : {}),
                });
            }
            lotesAfetados.add(loteId);
            itens.push({ ...base, loteId, reconhecido: true });
        }

        // ── 4) transicionar os lotes ────────────────────────────────────────
        // Varredura incompleta NÃO fecha lote: o teto vira RETORNADO (exige olho humano).
        if (!dryRun) {
            for (const loteId of lotesAfetados) {
                await this.transicionarLote(loteId, varreduraIncompleta);
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

    /**
     * BAIXADO quando todo item não-rejeitado tem baixa (`bxa_cod_seq`); senão RETORNADO.
     * Um lote com rejeição fica em RETORNADO de propósito: exige tratamento humano
     * (sanear cadastro e reenviar), e não é uma conciliação concluída.
     */
    private transicionarLote = async (
        loteId: string,
        varreduraIncompleta = false,
    ): Promise<void> => {
        const lote = await this.loteRepo.getLoteComItens(loteId);
        if (!lote) return;
        const conciliaveis = lote.itens.filter((i) => !i.rejeitado);
        const todosBaixados =
            conciliaveis.length > 0 && conciliaveis.every((i) => i.bxaCodSeq !== undefined);
        const houveRejeicao = lote.itens.some((i) => i.rejeitado);
        // Se algum código não pôde ser lido, "não vi rejeição" não é "não houve rejeição".
        const destino =
            todosBaixados && !houveRejeicao && !varreduraIncompleta
                ? LOTE_STATUS.BAIXADO
                : LOTE_STATUS.RETORNADO;

        const afetadas = await this.loteRepo.transicionarStatus({
            id: lote.id,
            de: [LOTE_STATUS.REMESSA_GERADA, LOTE_STATUS.RETORNADO],
            para: destino,
            versaoEsperada: lote.versao,
        });
        if (afetadas === 0) {
            await this.logService.warn({
                type: LOG_TYPE.BUSINESS_WARN,
                message: 'conciliação não transicionou o lote (estado ou versão inesperados)',
                data: { loteId, statusAtual: lote.status, destino },
            });
        }
    };

    private chave = (i: ConciliarInput): {
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
