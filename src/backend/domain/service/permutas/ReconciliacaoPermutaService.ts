import { inject, injectable } from 'tsyringe';
import ConexosBaixaClient from '../../client/ConexosBaixaClient.js';
import ConexosTitulosClient from '../../client/ConexosTitulosClient.js';
import { LOG_TYPE } from '../../interface/log/LogInterface.js';
import EnvironmentProvider from '../../libs/environment/EnvironmentProvider.js';
import PermutaAlocacaoRepository, {
    type AlocacaoRow,
} from '../../repository/permutas/PermutaAlocacaoRepository.js';
import PermutaExecucaoRepository, {
    type ExecucaoStatus,
} from '../../repository/permutas/PermutaExecucaoRepository.js';
import PermutaRelationalRepository from '../../repository/permutas/PermutaRelationalRepository.js';
import AlocacaoPermutasService from './AlocacaoPermutasService.js';
import ErpErrorInterpreter, { type ErpMessage } from './ErpErrorInterpreter.js';
import LogService from '../LogService.js';

/** Conta gerencial do juros = VARIAÇÃO CAMBIAL PASSIVA REALIZADA (HAR + ontologia). */
const CONTA_GER_JUROS = 131;
const GER_DES_JUROS = 'VARIAÇÃO CAMBIAL PASSIVA REALIZADA';
/**
 * Conta gerencial do DESCONTO = VARIAÇÃO CAMBIAL ATIVA REALIZADA (ontologia: 130 = ATIVA = DESCONTO,
 * taxa caiu). OBRIGATÓRIA quando a baixa tem desconto: sem ela o ERP grava a baixa mas RECUSA a
 * FINALIZAÇÃO do borderô com "CONTA DE DESCONTO NÃO INFORMADA" (sonda HAR 2026-06-25, borderô 14918).
 */
const CONTA_GER_DESCONTO = 130;
const GER_DES_DESCONTO = 'VARIAÇÃO CAMBIAL ATIVA REALIZADA';

/**
 * Arredonda para 2 casas decimais. OBRIGATÓRIO em todo valor monetário enviado ao `fin010`
 * (sonda real 2026-06-23): o ERP rejeita money com >2 decimais (`CnxValidatorMny`,
 * `precision_not_supported`). A variação cambial chega com ruído de ponto flutuante.
 */
const round2 = (n: number): number => Math.round(n * 100) / 100;

/**
 * A alocação virou baixa REAL no borderô? Só `settled` conta — é o único estado com confirmação
 * (`bxaCodSeq`) do ERP. `error`/`skipped`/`dry-run` NÃO põem item no borderô (`skipped` sequer chega
 * ao handshake; a baixa dele vive em OUTRO borderô, anterior). Gate da limpeza do órfão (I-Write-7).
 */
const isBaixaConfirmada = (r: ResultadoAlocacao): boolean => r.status === 'settled';

export interface ReconciliarInput {
    adiantamentoDocCod: string;
    executadoPor: string;
    /** Data de movimento do borderô em epoch-ms (default: meia-noite UTC de hoje — via params). */
    dataMovto: number;
    /** Força dry-run mesmo com escrita habilitada (preview sem POST). */
    dryRunOverride?: boolean;
}

export interface ResultadoAlocacao {
    invoiceDocCod: string;
    status: ExecucaoStatus | 'dry-run' | 'skipped';
    dryRun: boolean;
    borCod?: number;
    bxaCodSeq?: number;
    valorBaixado?: number;
    erro?: string;
    payload?: Record<string, unknown>;
}

export interface ReconciliarResult {
    adiantamentoDocCod: string;
    dryRun: boolean;
    writeEnabled: boolean;
    borCod?: number;
    resultados: ResultadoAlocacao[];
}

/**
 * ReconciliacaoPermutaService — executa a BAIXA/PERMUTA no ERP `fin010` a partir das
 * alocações (Fase 3, risco arquitetural #1). Escreve ADTO A ADTO (um borderô, N pares
 * adto→invoice), espelhando o fluxo manual. Ver `business-rules/fin010-write-contract.md`.
 *
 * Guard-rails (config): só escreve com `CONEXOS_WRITE_ENABLED=true` E `CONEXOS_DRY_RUN=false`.
 * Default = dry-run (monta/loga o payload sem POST). Write-ahead: a intenção é gravada
 * (`reconciling`) ANTES do POST; vira `settled` só com a confirmação (`bxaCodSeq`) do ERP;
 * em falha vira `error` com a resposta crua (reconciliação manual). Idempotência por par
 * adto↔invoice (`idempotency_key`): par já `settled` é pulado.
 */
@injectable()
export default class ReconciliacaoPermutaService {
    constructor(
        @inject(ConexosBaixaClient) private conexosBaixaClient: ConexosBaixaClient,
        @inject(ConexosTitulosClient) private conexosTitulosClient: ConexosTitulosClient,
        @inject(EnvironmentProvider) private environmentProvider: EnvironmentProvider,
        @inject(PermutaAlocacaoRepository)
        private alocacaoRepository: PermutaAlocacaoRepository,
        @inject(PermutaExecucaoRepository)
        private execucaoRepository: PermutaExecucaoRepository,
        @inject(PermutaRelationalRepository)
        private relationalRepository: PermutaRelationalRepository,
        @inject(AlocacaoPermutasService)
        private alocacaoService: AlocacaoPermutasService,
        @inject(LogService) private logService: LogService,
        @inject(ErpErrorInterpreter) private erpErrorInterpreter: ErpErrorInterpreter,
    ) {}

    public reconciliar = async (input: ReconciliarInput): Promise<ReconciliarResult> => {
        const { adiantamentoDocCod, executadoPor, dataMovto } = input;

        const adto = await this.relationalRepository.findAdiantamento(adiantamentoDocCod);
        if (!adto) throw new Error(`adiantamento ${adiantamentoDocCod} not found`);
        if (adto.filCod === undefined) {
            throw new Error(`adiantamento ${adiantamentoDocCod} without filial`);
        }
        const filCod = adto.filCod;

        // Saldo A PERMUTAR do adiantamento em moeda negociada — gate da âncora I-Write-6 (ver
        // `saldoNegDoAdto` e `ancorarVariacaoNoAdto`). `undefined` (adto sem saldo/taxa) ⇒ sem âncora.
        const saldoAdtoNeg = this.saldoNegDoAdto(adto.valorPermutar, adto.taxa);

        let alocacoes = (await this.alocacaoRepository.listAtivas()).filter(
            (a) => a.adiantamentoDocCod === adiantamentoDocCod,
        );
        // AUTO-ALOCAÇÃO no Baixar (regra 2026-06-24): múltipla AUTOMÁTICA (adto cobre todas as
        // invoices do processo) sem rascunho → o backend cria as alocações sozinho (adto → cada
        // invoice) e segue. Cria RASCUNHO (não toca o ERP); a baixa real continua gated.
        if (alocacoes.length === 0) {
            // Múltipla automática (adto cobre as invoices do processo) OU simples/casamento
            // (elegível) → o backend cria as alocações sozinho (rascunho), pra o "Processar"/Baixar
            // da aba Automáticas virar baixa real (borderô) como nos manuais.
            (await this.alocacaoService.autoAlocarSeElegivel(adiantamentoDocCod, executadoPor)) ||
                (await this.alocacaoService.autoAlocarDeCasamento(
                    adiantamentoDocCod,
                    executadoPor,
                ));
            alocacoes = (await this.alocacaoRepository.listAtivas()).filter(
                (a) => a.adiantamentoDocCod === adiantamentoDocCod,
            );
        }
        if (alocacoes.length === 0) {
            throw new Error(`adiantamento ${adiantamentoDocCod} has no alocacoes to reconcile`);
        }

        // Guard-rails de escrita via EnvironmentProvider (Rule #8 — nunca process.env no serviço).
        const env = await this.environmentProvider.getEnvironmentVars();
        const writeEnabled = env.conexosWriteEnabled;
        // Dry-run vence: sem escrita habilitada OU flag dryRun OU override explícito.
        const dryRun = !writeEnabled || env.conexosDryRun || input.dryRunOverride === true;

        const resultados: ResultadoAlocacao[] = [];
        let borCod: number | undefined;
        // O borderô nasce NESTA chamada? Só então a limpeza do órfão (I-Write-7, abaixo) pode agir —
        // nunca apagamos um borderô que já existia antes de entrarmos aqui.
        let borderoCriadoAqui = false;

        for (const aloc of alocacoes) {
            // DRY-RUN: preview puro, SEM efeito no banco (I-Recon-4) — não cria linha de execução.
            if (dryRun) {
                const preview = this.buildPreviewPayload(aloc, filCod);
                await this.logService.info({
                    type: LOG_TYPE.BUSINESS_INFO,
                    message: 'permuta reconciliacao DRY-RUN (payload montado, sem POST)',
                    data: { adiantamentoDocCod, invoiceDocCod: aloc.invoiceDocCod, preview },
                });
                resultados.push({
                    invoiceDocCod: aloc.invoiceDocCod,
                    status: 'dry-run',
                    dryRun: true,
                    payload: preview,
                });
                continue;
            }

            // Idempotência POR ESTADO DA ALOCAÇÃO: a chave inclui o `atualizado_em` da alocação.
            // - Mesma alocação JÁ executada (sem re-alocar) → mesma chave → BLOQUEADA (skipped).
            // - Re-alocar (mesmo par) muda o `atualizado_em` → chave nova → lançável de novo.
            // - Adicionar nova alocação (outro par) → chave nova → lançável.
            const key = `permuta:${adiantamentoDocCod}:${aloc.invoiceDocCod}:${aloc.atualizadoEm.getTime()}`;

            // Idempotência VIVA: se já há baixa settled MAS o borderô dela foi CANCELADO/ESTORNADO/
            // REMOVIDO no ERP, a baixa é nula → libera o relançamento (remove a linha stale). Só
            // bloqueia se o borderô ainda é válido (em cadastro ou finalizado).
            const existente = await this.execucaoRepository.findByIdempotencyKey(key);
            if (existente?.status === 'settled') {
                const baixaAindaValida = await this.borderoAindaValido(filCod, existente.borCod);
                if (baixaAindaValida) {
                    resultados.push({
                        invoiceDocCod: aloc.invoiceDocCod,
                        status: 'skipped',
                        dryRun,
                    });
                    continue;
                }
                // Borderô nulo (cancelado/estornado/removido): libera a re-baixa SEM apagar a linha
                // antiga — renomeia a chave pra preservar o borderô cancelado no histórico da lista.
                await this.execucaoRepository.renameKey(
                    key,
                    `${key}:sup:${existente.borCod ?? 'x'}`,
                );
            }

            // IDEMPOTÊNCIA VIVA do estado RECONCILING (R-4 / F-fault-tolerance-1): se a execução anterior
            // ficou em `reconciling` COM bor_cod (e não dry-run), o processo MORREU no meio do handshake —
            // entre o POST irreversível (gravarBaixaPermuta) e o markSettled (se qualquer passo tivesse
            // lançado, o catch teria gravado `error`; se o markSettled caísse por DB-down, o markError
            // também cairia → a linha fica `reconciling`). Logo: a baixa PODE já estar no ERP. Re-POSTar =
            // SUPER-PAGAMENTO. FAIL-CLOSED: aborta o par para conciliação manual, NUNCA re-POSTa.
            if (
                existente &&
                !existente.dryRun &&
                existente.status === 'reconciling' &&
                existente.borCod !== undefined
            ) {
                const msg =
                    `execução interrompida no meio da baixa (estado indeterminado) — confira se a ` +
                    `invoice ${aloc.invoiceDocCod} já foi baixada no borderô ${existente.borCod} no ` +
                    `Conexos ANTES de re-tentar. Se a baixa existe, finalize/exclua-a lá; se não, limpe ` +
                    `a execução e re-rode.`;
                await this.logService.error({
                    type: LOG_TYPE.BUSINESS_WARN,
                    message: 'permuta reconciliacao IN-DOUBT (reconciling órfão) — NÃO re-POSTado',
                    data: {
                        adiantamentoDocCod,
                        invoiceDocCod: aloc.invoiceDocCod,
                        borCod: existente.borCod,
                    },
                });
                resultados.push({
                    invoiceDocCod: aloc.invoiceDocCod,
                    status: 'error',
                    borCod: existente.borCod,
                    dryRun: false,
                    erro: msg,
                });
                continue;
            }

            const begin = await this.execucaoRepository.beginExecution({
                idempotencyKey: key,
                adiantamentoDocCod,
                invoiceDocCod: aloc.invoiceDocCod,
                filCod,
                dryRun: false,
                executadoPor,
            });
            if (begin.alreadySettled) {
                resultados.push({ invoiceDocCod: aloc.invoiceDocCod, status: 'skipped', dryRun });
                continue;
            }

            // ── Escrita real: handshake de 5 chamadas (borderô criado uma vez) ──
            try {
                if (borCod === undefined) {
                    // Data do borderô = a data ESCOLHIDA pelo analista no modal (`dataMovto`). O front
                    // sugere a data da D.I/DUIMP como default, mas o analista ajusta quando o período
                    // contábil da D.I está fechado (ERP: FIN_010.DATA_BLOQUEADA_PELA_CONTABILIDADE).
                    const bordero = await this.conexosBaixaClient.criarBordero({
                        filCod,
                        dataMovto,
                    });
                    borCod = bordero.borCod;
                    borderoCriadoAqui = true;
                }
                const resultado = await this.executarBaixa({
                    key,
                    borCod,
                    filCod,
                    aloc,
                    ...(saldoAdtoNeg !== undefined ? { saldoAdtoNeg } : {}),
                });
                resultados.push(resultado);
            } catch (err) {
                const mensagem = this.friendlyErpMessage(err);
                await this.execucaoRepository.markError(key, {
                    erroMensagem: mensagem,
                    erpResponse: this.extractErpData(err),
                    ...(borCod !== undefined ? { borCod } : {}),
                });
                await this.logService.error({
                    type: LOG_TYPE.BUSINESS_WARN,
                    message: 'permuta reconciliacao FALHOU (registrada como error)',
                    data: { adiantamentoDocCod, invoiceDocCod: aloc.invoiceDocCod, mensagem },
                });
                resultados.push({
                    invoiceDocCod: aloc.invoiceDocCod,
                    status: 'error',
                    dryRun: false,
                    ...(borCod !== undefined ? { borCod } : {}),
                    erro: mensagem,
                });
            }
        }

        // I-Write-7 (anti-órfão): o borderô é criado ANTES da 1ª baixa (passo 1 do handshake). Se
        // TODAS as baixas falharam, ele fica no ERP sem item nenhum — um casco que aparece no painel
        // e cujo "Aprovar" o ERP recusa com "NÃO POSSUI ITENS" (borderô 18538, 2026-08-06). A limpeza
        // roda no FIM do loop, não na 1ª falha: o `borCod` é compartilhado por todas as alocações
        // (I-Write-3), então falha-depois-sucesso deixa o borderô COM item — e aí ele não é órfão.
        if (borderoCriadoAqui && borCod !== undefined && !resultados.some(isBaixaConfirmada)) {
            await this.removerBorderoOrfao({ filCod, borCod, adiantamentoDocCod });
        }

        return {
            adiantamentoDocCod,
            dryRun,
            writeEnabled,
            ...(borCod !== undefined ? { borCod } : {}),
            resultados,
        };
    };

    /**
     * Apaga o borderô que ficou SEM baixa nenhuma (I-Write-7). **Best-effort e fail-safe**: a fonte da
     * verdade é o ERP (`listBaixas`), não a nossa contagem — se o ERP disser que há item (ex.: uma
     * baixa parcial entrou antes do erro), NÃO apaga. Qualquer falha daqui vira WARN e segue: a
     * limpeza é higiene, jamais pode mascarar o erro real da baixa que o analista precisa ver.
     */
    private removerBorderoOrfao = async (params: {
        filCod: number;
        borCod: number;
        adiantamentoDocCod: string;
    }): Promise<void> => {
        const { filCod, borCod, adiantamentoDocCod } = params;
        try {
            const baixas = await this.conexosBaixaClient.listBaixas({ filCod, borCod });
            if (baixas.length > 0) {
                await this.logService.warn({
                    type: LOG_TYPE.BUSINESS_WARN,
                    message: 'borderô sem baixa confirmada MAS com item no ERP — não removido',
                    data: { adiantamentoDocCod, borCod, itensNoErp: baixas.length },
                });
                return;
            }
            await this.conexosBaixaClient.excluirBordero({ filCod, borCod });
            await this.execucaoRepository.deleteBorderoCache(filCod, borCod);
            await this.logService.info({
                type: LOG_TYPE.BUSINESS_INFO,
                message: 'borderô órfão (vazio) removido após falha de todas as baixas',
                data: { adiantamentoDocCod, borCod },
            });
        } catch (err) {
            await this.logService.warn({
                type: LOG_TYPE.BUSINESS_WARN,
                message: 'falha ao remover o borderô órfão (best-effort) — remover pelo painel',
                data: {
                    adiantamentoDocCod,
                    borCod,
                    erro: err instanceof Error ? err.message : String(err),
                },
            });
        }
    };

    /**
     * Executa a baixa de UM par adto→invoice e marca settled. A invoice pode ter N TÍTULOS (parcelas) —
     * TODOS permutáveis (decisão Yuri 2026-06-26): baixamos CADA título como uma baixa própria NO MESMO
     * borderô ("fazer uma e outra"), distribuindo o valor alocado entre eles (FIFO por titCod). Invoice
     * de título único (a maioria) = loop de 1 → comportamento idêntico ao anterior. Fallback p/ título 1
     * (valor cheio) se o ERP não devolver os títulos.
     */
    private executarBaixa = async (params: {
        key: string;
        borCod: number;
        filCod: number;
        aloc: AlocacaoRow;
        /** Saldo a permutar do adto (moeda negociada) — gate da âncora I-Write-6. */
        saldoAdtoNeg?: number;
    }): Promise<ResultadoAlocacao> => {
        const { key, borCod, filCod, aloc } = params;
        const invoiceDocCod = Number(aloc.invoiceDocCod);
        const adiantamentoDocCod = Number(aloc.adiantamentoDocCod);

        // Persiste o borCod ANTES dos POSTs do handshake (Regis F-availability-1/3): se o
        // processo morrer no meio, a trilha aponta o borderô a conciliar (não fica órfão sem rastro).
        await this.execucaoRepository.setBorCod(key, borCod);

        if (aloc.taxaInvoice === undefined || !(aloc.taxaInvoice > 0)) {
            throw new Error(
                `alocação ${adiantamentoDocCod}→${invoiceDocCod} sem taxa da invoice — não dá para calcular o valor da baixa`,
            );
        }

        // Títulos (parcelas) da invoice — cada um com valor/taxa em moeda negociada. Ordena por titCod.
        // Fallback: ERP indisponível/sem dados → título 1 com o valor cheio (compat de título único).
        let titulos: Array<{ titCod: number; usd: number; taxa: number }> = [];
        try {
            const raw = await this.conexosTitulosClient.listTitulosAPagar({
                docCod: String(invoiceDocCod),
                filCod,
            });
            titulos = raw
                .map((t) => ({ titCod: Number(t.titCod), usd: t.valorNegociado, taxa: t.taxa }))
                .filter(
                    (t): t is { titCod: number; usd: number; taxa: number } =>
                        Number.isFinite(t.titCod) &&
                        t.usd !== undefined &&
                        t.usd > 0 &&
                        t.taxa !== undefined &&
                        t.taxa > 0,
                )
                .sort((a, b) => a.titCod - b.titCod);
        } catch {
            // segue no fallback
        }
        if (titulos.length === 0) {
            titulos = [{ titCod: 1, usd: aloc.valorAlocado, taxa: aloc.taxaInvoice }];
        }

        // ÂNCORA NO ADIANTAMENTO (I-Write-6): só quando ESTA baixa consome o adto por inteiro (o alocado
        // cobre o saldo a permutar do adto) E a invoice é de título único. Nesse caso o líquido fecha no
        // valor REAL do adto no ERP (`bxaMnyValorPermuta`) — evita o resíduo de centavos "à permutar" que
        // sobra quando a variação é reconstruída por taxa arredondada a 3 casas. Perna parcial (N:M) segue
        // rateando por taxa (o saldo remanescente é legítimo). Multi-título full-consume → follow-up.
        const fullConsumeAdto =
            params.saldoAdtoNeg !== undefined &&
            aloc.valorAlocado >= params.saldoAdtoNeg - Math.max(0.01, params.saldoAdtoNeg * 0.0001);
        const ancorarNoAdto = titulos.length === 1 && fullConsumeAdto;

        // Distribui o valor alocado (moeda negociada) entre os títulos, na ordem (FIFO por titCod).
        let restanteUsd = aloc.valorAlocado;
        let totalBaixadoBrl = 0;
        let jurosTotal = 0;
        let descontoTotal = 0;
        const bxaCodSeqs: number[] = [];

        for (const t of titulos) {
            if (restanteUsd <= 0.005) break;
            const usdTitulo = Math.min(restanteUsd, t.usd);
            const r = await this.baixarTitulo({
                key,
                borCod,
                filCod,
                invoiceDocCod,
                adiantamentoDocCod,
                aloc,
                titCod: t.titCod,
                usdTitulo,
                taxaTitulo: t.taxa,
                ancorarNoAdto,
            });
            bxaCodSeqs.push(r.bxaCodSeq);
            totalBaixadoBrl = round2(totalBaixadoBrl + r.bxaMnyValor);
            jurosTotal = round2(jurosTotal + r.juros);
            descontoTotal = round2(descontoTotal + r.desconto);
            restanteUsd = round2(restanteUsd - usdTitulo);
        }

        await this.execucaoRepository.markSettled(key, {
            borCod,
            bxaCodSeq: bxaCodSeqs[0],
            valorBaixado: totalBaixadoBrl,
            juros: jurosTotal,
            contaJuros: descontoTotal > 0 ? CONTA_GER_DESCONTO : CONTA_GER_JUROS,
            erpResponse: { bxaCodSeqs, totalBaixadoBrl, titulos: bxaCodSeqs.length },
        });
        await this.logService.info({
            type: LOG_TYPE.BUSINESS_INFO,
            message: 'permuta reconciliacao SETTLED',
            data: {
                adiantamentoDocCod,
                invoiceDocCod,
                borCod,
                titulos: bxaCodSeqs.length,
                bxaCodSeqs,
                totalBaixado: totalBaixadoBrl,
            },
        });

        return {
            invoiceDocCod: aloc.invoiceDocCod,
            status: 'settled',
            dryRun: false,
            borCod,
            bxaCodSeq: bxaCodSeqs[0],
            valorBaixado: totalBaixadoBrl,
        };
    };

    /**
     * Baixa UM título (parcela) da invoice no borderô — handshake passos 2→5. NÃO marca settled (o
     * caller agrega os títulos). A variação cambial é RATEADA pela fração do título no valor alocado
     * (`variacaoResultado × usdTitulo/valorAlocado`) → preserva o total e o caso de título único.
     */
    private baixarTitulo = async (p: {
        key: string;
        borCod: number;
        filCod: number;
        invoiceDocCod: number;
        adiantamentoDocCod: number;
        aloc: AlocacaoRow;
        titCod: number;
        usdTitulo: number;
        taxaTitulo: number;
        /** Fecha o líquido no valor real do adto do ERP (I-Write-6) — ver `executarBaixa`. */
        ancorarNoAdto: boolean;
    }): Promise<{ bxaCodSeq: number; bxaMnyValor: number; juros: number; desconto: number }> => {
        const { key, borCod, filCod, invoiceDocCod, adiantamentoDocCod, aloc, titCod, usdTitulo } =
            p;

        // Passo 2 — valida ESTE título; o ERP devolve o em-aberto vivo da parcela.
        const val2 = await this.conexosBaixaClient.validarTituloBaixa({
            filCod,
            borCod,
            invoiceDocCod,
            titCod,
        });
        this.assertNoErpError(val2, 'tituloBaixa');
        const emAbertoErp = val2.responseData?.bxaMnyValor;
        if (emAbertoErp === undefined || !(emAbertoErp > 0)) {
            throw new Error(
                `título ${invoiceDocCod}/${titCod} sem valor em aberto no ERP (bxaMnyValor=${String(emAbertoErp)})`,
            );
        }

        // I-Write-1 (anti-over-pay): a baixa do título NUNCA pode exceder o em-aberto vivo dele.
        const valorBaixaDesejado = round2(usdTitulo * p.taxaTitulo);
        const tolerancia = Math.max(0.01, emAbertoErp * 0.005);
        if (valorBaixaDesejado > emAbertoErp + tolerancia) {
            throw new Error(
                `anti-drift: baixa ${valorBaixaDesejado.toFixed(2)} (BRL) > em-aberto do ERP ${emAbertoErp} ` +
                    `(título ${titCod}: ${usdTitulo} × taxa ${p.taxaTitulo}) — alocação maior que o saldo vivo do título; conferir manualmente`,
            );
        }
        const bxaMnyValor = Math.min(valorBaixaDesejado, emAbertoErp);

        // Variação cambial RATEADA: a fração deste título no valor alocado. round2 (CnxValidatorMny).
        const isDesconto = aloc.variacaoClassificacao === 'DESCONTO';
        const valorVariacao =
            aloc.valorAlocado > 0
                ? round2((aloc.variacaoResultado ?? 0) * (usdTitulo / aloc.valorAlocado))
                : round2(aloc.variacaoResultado ?? 0);
        let juros = isDesconto ? 0 : valorVariacao;
        let desconto = isDesconto ? valorVariacao : 0;

        // Passo 3 — valida a permuta (adiantamento); o ERP devolve os dados da permuta (estado atual).
        const val3 = await this.conexosBaixaClient.validarTituloPermuta({
            filCod,
            borCod,
            adiantamentoDocCod,
            bxaTitCod: 1,
        });
        this.assertNoErpError(val3, 'tituloPermuta');
        const perm = val3.responseData;
        if (!perm)
            throw new Error(`adiantamento ${adiantamentoDocCod} sem dados de permuta no ERP`);

        // ÂNCORA NO VALOR REAL DO ADIANTAMENTO (I-Write-6) — quando esta baixa consome o adto por
        // inteiro, fecha o líquido no `bxaMnyValorPermuta` do ERP (absorve o resíduo de arredondamento
        // de taxa na conta de variação). Ver `ancorarVariacaoNoAdto`. Sem efeito quando não aplicável.
        const ancorada = await this.ancorarVariacaoNoAdto({
            ancorarNoAdto: p.ancorarNoAdto,
            ...(perm.bxaMnyValorPermuta !== undefined
                ? { bxaMnyValorPermuta: perm.bxaMnyValorPermuta }
                : {}),
            bxaMnyValor,
            juros,
            desconto,
            isDesconto,
            adiantamentoDocCod,
            invoiceDocCod,
            titCod,
        });
        juros = ancorada.juros;
        desconto = ancorada.desconto;

        // Passo 4 — recalcula o líquido com o juros/desconto informado.
        const val4 = await this.conexosBaixaClient.atualizarValorLiquido({
            filCod,
            borCod,
            invoiceDocCod,
            titCod,
            valor: bxaMnyValor,
            juros,
            desconto,
        });
        this.assertNoErpError(val4, 'atualizaValorLiquido');
        const bxaMnyLiquido = round2(
            val4.responseData?.bxaMnyLiquido ?? bxaMnyValor + juros - desconto,
        );

        // Passo 5 — payload consolidado (com ESTE titCod) e gravação. O comentário usa a variação
        // EFETIVAMENTE lançada (já ancorada, se foi o caso) para bater com o payload.
        const variacaoLancada = isDesconto ? desconto : juros;
        const comentario = this.buildComentario(aloc, bxaMnyValor, variacaoLancada);
        const payload = this.buildFinalPayload({
            filCod,
            borCod,
            invoiceDocCod,
            adiantamentoDocCod,
            titCod,
            bxaMnyValor,
            juros,
            desconto,
            bxaMnyLiquido,
            perm,
            comentario,
        });
        await this.execucaoRepository.setRequestPayload(key, payload);
        const baixa = await this.conexosBaixaClient.gravarBaixaPermuta({ filCod, payload });
        return { bxaCodSeq: baixa.bxaCodSeq, bxaMnyValor, juros, desconto };
    };

    /**
     * Saldo A PERMUTAR do adiantamento em moeda negociada (BRL saldo / taxa do adto). Gate da âncora
     * I-Write-6: se o alocado cobre este saldo, a baixa consome o adto por inteiro. `undefined` quando
     * o adto não tem saldo/taxa conhecidos (sem âncora → mantém o rateio por taxa).
     */
    private saldoNegDoAdto = (valorPermutar?: number, taxa?: number): number | undefined =>
        valorPermutar !== undefined && taxa !== undefined && taxa > 0
            ? valorPermutar / taxa
            : undefined;

    /**
     * ÂNCORA NO VALOR REAL DO ADIANTAMENTO (I-Write-6). Quando a baixa consome o adto por inteiro
     * (`ancorarNoAdto`), o líquido deve fechar no valor REAL do adto no ERP (`bxaMnyValorPermuta`), e
     * não no reconstruído por `USD × taxa` (taxa arredondada a 3 casas) — senão sobra o resíduo de
     * centavos "à permutar" no adto. A diferença é absorvida na conta de variação cambial JÁ em uso
     * (131 juros / 130 desconto). Guarda de sanidade: só absorve resíduo dentro do teto ABSOLUTO de
     * R$1,00 (ver `limiteResiduo`); divergência maior indica outro problema → NÃO ancora, apenas avisa.
     * Retorna o juros/desconto (ajustado ou original).
     */
    private ancorarVariacaoNoAdto = async (p: {
        ancorarNoAdto: boolean;
        bxaMnyValorPermuta?: number;
        bxaMnyValor: number;
        juros: number;
        desconto: number;
        isDesconto: boolean;
        adiantamentoDocCod: number;
        invoiceDocCod: number;
        titCod: number;
    }): Promise<{ juros: number; desconto: number }> => {
        const { juros, desconto } = p;
        if (!p.ancorarNoAdto || p.bxaMnyValorPermuta === undefined || !(p.bxaMnyValorPermuta > 0)) {
            return { juros, desconto };
        }
        const residuo = round2(p.bxaMnyValorPermuta - round2(p.bxaMnyValor + juros - desconto));
        if (residuo === 0) return { juros, desconto };

        // Teto ABSOLUTO (não escala com o valor). O resíduo legítimo de arredondamento da taxa a 3
        // casas é `USD × |taxaReal − taxaExibida|` — que escala com o USD e, num adto grande, fica
        // NUMERICAMENTE indistinguível de um saldo deliberado pequeno. Um teto proporcional (ex.:
        // USD × 0,001) reabriria essa brecha (absorveria um saldo real como variação fictícia). Com
        // teto fixo, só resíduo de centavos é absorvido; resíduo maior (arredondamento grande raro OU
        // saldo real) NÃO é ancorado — vira BUSINESS_WARN para conferência manual. Ver ADR-0020.
        const limiteResiduo = 1;
        const ctx = {
            adiantamentoDocCod: p.adiantamentoDocCod,
            invoiceDocCod: p.invoiceDocCod,
            titCod: p.titCod,
            residuo,
            bxaMnyValorPermuta: p.bxaMnyValorPermuta,
        };
        if (Math.abs(residuo) > limiteResiduo) {
            await this.logService.warn({
                type: LOG_TYPE.BUSINESS_WARN,
                message:
                    'resíduo do adto acima da tolerância de arredondamento — NÃO ancorado (conferir)',
                data: { ...ctx, limiteResiduo },
            });
            return { juros, desconto };
        }

        const jurosAncora = p.isDesconto ? juros : round2(juros + residuo);
        const descontoAncora = p.isDesconto ? round2(desconto - residuo) : desconto;
        // Não deixar a conta ficar negativa (resíduo perverso com variação ~0).
        if (jurosAncora < 0 || descontoAncora < 0) return { juros, desconto };

        await this.logService.info({
            type: LOG_TYPE.BUSINESS_INFO,
            message: 'permuta baixa ANCORADA no valor real do adto (resíduo absorvido na variação)',
            data: ctx,
        });
        return { juros: jurosAncora, desconto: descontoAncora };
    };

    /** Payload do passo 5 — une o lado invoice + o lado permuta (dados do ERP no passo 3). */
    private buildFinalPayload = (p: {
        filCod: number;
        borCod: number;
        invoiceDocCod: number;
        adiantamentoDocCod: number;
        /** Parcela (título) da invoice sendo baixada — invoices multi-título baixam 1 por título. */
        titCod: number;
        bxaMnyValor: number;
        juros: number;
        desconto: number;
        bxaMnyLiquido: number;
        perm: {
            gerNumPermuta: number;
            gerDesPermuta?: string;
            gerDes?: string;
            gerNum?: number;
            pesCod?: number;
            dpeNomPessoa?: string;
            bxaMnyValorPermuta?: number;
        };
        comentario?: string;
    }): Record<string, unknown> => ({
        bxaVldSistema: 0,
        docTip: 2,
        bxaVldCcorrente: 0,
        bxaVldCorrenteDc: 1,
        borVldFinalizado: 0,
        filCod: p.filCod,
        borCod: p.borCod,
        borVldTipo: 2,
        gerNum: p.perm.gerNum ?? p.perm.gerNumPermuta,
        gerDes: p.perm.gerDes ?? p.perm.gerDesPermuta ?? null,
        bxaVldAdto: 1,
        frontModelName: 'baixa',
        docCod: p.invoiceDocCod,
        titCod: p.titCod,
        bxaMnyDesconto: p.desconto,
        // Conta da variação cambial: setar a conta SÓ do lado ativo (a outra fica null), espelhando o
        // padrão validado da baixa de juros. DESCONTO sem `bxaCodGerDesconto` faz o ERP recusar a
        // FINALIZAÇÃO ("CONTA DE DESCONTO NÃO INFORMADA"). Conta 130 = VAR. CAMBIAL ATIVA = DESCONTO.
        bxaCodGerDesconto: p.desconto > 0 ? CONTA_GER_DESCONTO : null,
        gerDesDesconto: p.desconto > 0 ? GER_DES_DESCONTO : null,
        bxaMnyValor: p.bxaMnyValor,
        bxaMnyMulta: 0,
        bxaMnyJuros: p.juros,
        bxaCodGerJuros: p.juros > 0 ? CONTA_GER_JUROS : null,
        gerDesJuros: p.juros > 0 ? GER_DES_JUROS : null,
        bxaMnyLiquido: p.bxaMnyLiquido,
        // Comentário do borderô (spec do analista) — conta da variação cambial.
        bxaEspComplemento: p.comentario ?? null,
        bxaDocTip: 2,
        bxaDocCod: p.adiantamentoDocCod,
        bxaTitCod: 1,
        gerDesPermuta: p.perm.gerDesPermuta ?? null,
        dpeNomPessoa: p.perm.dpeNomPessoa ?? null,
        gerNumPermuta: p.perm.gerNumPermuta,
        bxaMnyLiquidoPermuta: null,
        pesCod: p.perm.pesCod ?? null,
        bxaMnyValorPermuta: p.perm.bxaMnyValorPermuta ?? null,
    });

    /**
     * Monta o comentário do borderô (spec do analista): a conta da variação cambial com as
     * taxas das duas pontas + a conta de juros. `valorBaixaBrl` é o valor parcial baixado.
     */
    private buildComentario = (
        aloc: AlocacaoRow,
        valorBaixaBrl: number,
        valorVariacao: number,
    ): string => {
        const isDesconto = aloc.variacaoClassificacao === 'DESCONTO';
        const tipo = isDesconto ? 'Desconto' : 'Juros';
        const conta = isDesconto
            ? `conta ${CONTA_GER_DESCONTO} (${GER_DES_DESCONTO})`
            : `conta ${CONTA_GER_JUROS} (${GER_DES_JUROS})`;
        const moeda = aloc.moeda ?? 'USD';
        const partes: string[] = [
            `Permuta adto ${aloc.adiantamentoDocCod} x invoice ${aloc.invoiceDocCod}.`,
            `Baixa ${valorBaixaBrl.toFixed(2)} BRL (alocado ${aloc.valorAlocado} ${moeda}).`,
        ];
        if (aloc.taxaAdiantamento !== undefined && aloc.taxaInvoice !== undefined) {
            partes.push(
                `Variacao cambial (${tipo}): ${aloc.valorAlocado} ${moeda} x (taxa adto ${aloc.taxaAdiantamento} - taxa invoice ${aloc.taxaInvoice}) = ${valorVariacao.toFixed(2)} BRL.`,
            );
        } else {
            partes.push(`Variacao cambial (${tipo}): ${valorVariacao.toFixed(2)} BRL.`);
        }
        partes.push(`Lancado em ${conta}.`);
        // O ERP exige descrição em MAIÚSCULAS (CnxValidatorDescr / not_in_uppercase, sonda 2026-06-23).
        return partes.join(' ').toUpperCase();
    };

    /** Preview (dry-run) montado SÓ com dados locais — sem chamar o ERP. */
    private buildPreviewPayload = (aloc: AlocacaoRow, filCod: number): Record<string, unknown> => {
        const isDesconto = aloc.variacaoClassificacao === 'DESCONTO';
        const valorVariacao = round2(aloc.variacaoResultado ?? 0);
        return {
            _nota: 'DRY-RUN — valores do título/permuta viriam do ERP no handshake real',
            filCod,
            docCod: Number(aloc.invoiceDocCod),
            bxaDocCod: Number(aloc.adiantamentoDocCod),
            titCod: 1,
            bxaTitCod: 1,
            valorAlocadoNegociado: aloc.valorAlocado,
            moeda: aloc.moeda ?? null,
            classificacao: aloc.variacaoClassificacao ?? null,
            bxaMnyJuros: isDesconto ? 0 : valorVariacao,
            bxaMnyDesconto: isDesconto ? valorVariacao : 0,
            bxaCodGerJuros: isDesconto ? null : CONTA_GER_JUROS,
            bxaCodGerDesconto: isDesconto ? CONTA_GER_DESCONTO : null,
            taxaAdiantamento: aloc.taxaAdiantamento ?? null,
            taxaInvoice: aloc.taxaInvoice ?? null,
            bxaEspComplemento: this.buildComentario(
                aloc,
                aloc.taxaInvoice ? round2(aloc.valorAlocado * aloc.taxaInvoice) : aloc.valorAlocado,
                valorVariacao,
            ),
        };
    };

    /**
     * Lê o envelope `{ messages }` das validações do fin010 (Regis F-integrability-3): um
     * `valid='ERRO'` chega com HTTP 200 e passaria despercebido. AVISO (ex.:
     * PESSOA_POSSUI_ADIANTAMENTO) é informativo e segue; ERRO aborta o handshake.
     */
    private assertNoErpError = (resp: { messages?: ErpMessage[] }, passo: string): void => {
        const erro = Array.isArray(resp.messages)
            ? resp.messages.find((m) => m?.valid === 'ERRO')
            : undefined;
        if (erro) {
            // Usa o interpretador → surface a razão real (`vars.msg`) do Generic.ERROR_MESSAGE.
            const detalhe = this.erpErrorInterpreter.describeMessage(erro);
            throw new Error(`fin010 ${passo} retornou ERRO: ${detalhe}`);
        }
    };

    /**
     * O borderô de uma baixa settled ainda é VÁLIDO no ERP? (em cadastro ou finalizado).
     * CANCELADO (borVldFinalizado=2) / ESTORNADO (borCodEstornado) / REMOVIDO (404) ⇒ inválido →
     * libera relançamento. Em ERRO de leitura: conservador = válido (não arrisca dupla baixa).
     */
    private borderoAindaValido = async (filCod: number, borCod?: number): Promise<boolean> => {
        if (borCod === undefined) return false; // settled sem borderô registrado → libera
        try {
            const det = await this.conexosBaixaClient.getBordero({ filCod, borCod });
            if (!det) return false; // removido
            if (det.borCodEstornado != null) return false; // estornado
            if (det.borVldFinalizado === 2) return false; // cancelado
            return true; // em cadastro (0) ou finalizado (1)
        } catch {
            return true; // incerto → conservador (bloqueia re-baixa)
        }
    };

    private extractErpData = (err: unknown): unknown => {
        const ax = err as {
            response?: { data?: unknown };
            cause?: { response?: { data?: unknown } };
        };
        return ax?.response?.data ?? ax?.cause?.response?.data ?? null;
    };

    /**
     * Mensagem amigável (PT) a partir do erro do ERP. Delega ao `ErpErrorInterpreter` (fonte única):
     * surface a razão real (`vars.msg`) do `Generic.ERROR_MESSAGE` em vez da string genérica/key.
     */
    private friendlyErpMessage = (err: unknown): string =>
        this.erpErrorInterpreter.interpret(err).friendly;
}
