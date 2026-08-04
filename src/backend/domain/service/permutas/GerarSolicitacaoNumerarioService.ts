import { inject, injectable } from 'tsyringe';
import ConexosFin014Client from '../../client/ConexosFin014Client.js';
import ConexosGerDocProcessoClient, {
    type GerDocProcessoMessage,
} from '../../client/ConexosGerDocProcessoClient.js';
import NumerarioGapError from '../../errors/NumerarioGapError.js';
import { LOG_TYPE } from '../../interface/log/LogInterface.js';
import {
    DOC_TIP_SN,
    GCD_ENCOMENDA,
    GLOBAL_DOC_VLD_TIPO_SN,
    NUMERO_NOTA_DEBITO,
    PRODUTO_NOTA_DEBITO,
    type ContaProjetoRow,
    type Fin014RecebimentoPayload,
    type GerDocProcessoItem,
    type GerDocProcessoPayload,
    type GerarNumerarioInput,
    type GerarNumerarioResult,
    type NumerarioEtapa,
    type ValidaConfigDocResult,
} from '../../interface/permutas/SolicitacaoNumerario.js';
import EnvironmentProvider from '../../libs/environment/EnvironmentProvider.js';
import type { AdiantamentoAtivo } from '../../repository/permutas/PermutaRelationalRepository.js';
import NumerarioExecucaoRepository, {
    type NumerarioExecucaoRow,
} from '../../repository/permutas/NumerarioExecucaoRepository.js';
import PermutaRelationalRepository from '../../repository/permutas/PermutaRelationalRepository.js';
import ErpErrorInterpreter, { type ErpMessage } from './ErpErrorInterpreter.js';
import LogService from '../LogService.js';

/** Arredonda para 2 casas — obrigatório em todo valor monetário do ERP (CnxValidatorMny). */
const round2 = (n: number): number => Math.round(n * 100) / 100;

const GCD_DES_NOME_ENCOMENDA = 'SOLICITAÇÃO DE NUMERÁRIO - ENCOMENDA';
/** Endereço fiscal default. GAP (Open item #1): fonte real de endCodFis/pdcDocFederal não confirmada. */
const END_COD_FIS_DEFAULT = 1;

/**
 * GerarSolicitacaoNumerarioService — orquestra o fluxo de 3 TELAS do guia "telas Conexos", por
 * adiantamento, substituindo a baixa fin010 no "Processar" (decisão 2026-07-31):
 *   Tela 1 (com299): gera a SN (gerDocProcesso) + finaliza.                       [CONFIRMADO]
 *   Tela 2 (fin014): recebimento do crédito (borderô+baixa+finaliza) vinculado à SN.[REAL, bundle-derived]
 *   Tela 3 (com297): nota de débito — gera + produto 41978. Fiscal/observações/homologar = GAP.
 *
 * Guard-rails: só escreve com `CONEXOS_WRITE_ENABLED=true` E `CONEXOS_DRY_RUN=false` (default dry-run:
 * monta/loga os payloads das 3 telas sem POST). Write-ahead + idempotência POR ADIANTAMENTO
 * (`numerario:{adto}:{valor}`) com RETOMADA anti-duplicação (SN/fin014/com297 já criados não recriam).
 * Etapas ainda não confirmadas por HAR (com297 fiscal/observações; conta financeira ausente) FALHAM
 * FECHADO (`NumerarioGapError`). Espelha `ReconciliacaoPermutaService`.
 */
@injectable()
export default class GerarSolicitacaoNumerarioService {
    constructor(
        @inject(ConexosGerDocProcessoClient)
        private gerDocClient: ConexosGerDocProcessoClient,
        @inject(ConexosFin014Client) private fin014Client: ConexosFin014Client,
        @inject(EnvironmentProvider) private environmentProvider: EnvironmentProvider,
        @inject(PermutaRelationalRepository)
        private relationalRepository: PermutaRelationalRepository,
        @inject(NumerarioExecucaoRepository)
        private execucaoRepository: NumerarioExecucaoRepository,
        @inject(LogService) private logService: LogService,
        @inject(ErpErrorInterpreter) private erpErrorInterpreter: ErpErrorInterpreter,
    ) {}

    public gerarNumerario = async (input: GerarNumerarioInput): Promise<GerarNumerarioResult> => {
        const { adiantamentoDocCod, executadoPor } = input;
        const valor = round2(input.valor);
        if (!(valor > 0)) throw new Error(`invalid value for SN (${input.valor})`);

        const adto = await this.relationalRepository.findAdiantamento(adiantamentoDocCod);
        if (!adto) throw new Error(`adiantamento ${adiantamentoDocCod} not found`);
        if (adto.filCod === undefined) {
            throw new Error(`adiantamento ${adiantamentoDocCod} without filial`);
        }
        const filCod = adto.filCod;
        const priCod = Number(adto.priCod);
        const pesCod = adto.pesCod !== undefined ? Number(adto.pesCod) : Number.NaN;
        if (!Number.isFinite(priCod) || !Number.isFinite(pesCod)) {
            throw new Error(
                `adiantamento ${adiantamentoDocCod} lacks numeric priCod/pesCod (SN requires both)`,
            );
        }

        const config = await this.gerDocClient.validaConfigDoc({
            tela: 'com299',
            filCod,
            docTip: DOC_TIP_SN,
            globalDocVldTipo: GLOBAL_DOC_VLD_TIPO_SN,
            priCod,
            pesCod,
            endCodFis: END_COD_FIS_DEFAULT,
            gcdCod: GCD_ENCOMENDA,
        });
        const rateio = await this.gerDocClient.listContasProjeto({
            tela: 'com299',
            filCod,
            gcdCod: GCD_ENCOMENDA,
            pesCod,
            endCodFis: END_COD_FIS_DEFAULT,
        });
        const items = this.buildItems(rateio, valor);
        const snPayload = this.buildSnPayload({
            adto,
            priCod,
            pesCod,
            valor,
            config,
            items,
            input,
        });

        const env = await this.environmentProvider.getEnvironmentVars();
        const writeEnabled = env.conexosWriteEnabled;
        const dryRun = !writeEnabled || env.conexosDryRun || input.dryRunOverride === true;
        const key = `numerario:${adiantamentoDocCod}:${valor}`;
        const dataRecebimento = input.dataEmissao ?? 0;

        if (dryRun) {
            const fin014Payload = this.buildFin014Preview({
                filCod,
                valor,
                dataRecebimento,
                conta: env.fin014ContaFinanceira,
            });
            const notaDebitoPayload = this.buildNotaDebitoPayload({
                adto,
                priCod,
                pesCod,
                valor,
                input,
            });
            await this.logService.info({
                type: LOG_TYPE.BUSINESS_INFO,
                message: 'generate SN DRY-RUN (3-tela payloads assembled, no POST)',
                data: { adiantamentoDocCod, valor, snPayload, fin014Payload, notaDebitoPayload },
            });
            return {
                adiantamentoDocCod,
                dryRun: true,
                writeEnabled,
                status: 'dry-run',
                valor,
                payload: snPayload,
                payloadFin014: fin014Payload,
                payloadNotaDebito: notaDebitoPayload,
            };
        }

        return this.executarEscrita({
            key,
            filCod,
            adiantamentoDocCod,
            valor,
            snPayload,
            writeEnabled,
            executadoPor,
            gcdCod: GCD_ENCOMENDA,
            priCod: adto.priCod,
            dataRecebimento,
            adto,
            pesCodNum: pesCod,
            priCodNum: priCod,
            input,
            env,
            ...(adto.pesCod !== undefined ? { pesCod: adto.pesCod } : {}),
        });
    };

    private executarEscrita = async (p: EscritaCtx): Promise<GerarNumerarioResult> => {
        const { key, adiantamentoDocCod, valor, writeEnabled } = p;
        const bloqueio = await this.checarBloqueio(p);
        if (bloqueio) return bloqueio;

        const begin = await this.execucaoRepository.beginExecution({
            idempotencyKey: key,
            adiantamentoDocCod,
            filCod: p.filCod,
            priCod: p.priCod,
            ...(p.pesCod !== undefined ? { pesCod: p.pesCod } : {}),
            gcdCod: p.gcdCod,
            valor,
            dryRun: false,
            executadoPor: p.executadoPor,
        });
        if (begin.alreadySettled) {
            return { adiantamentoDocCod, dryRun: false, writeEnabled, status: 'skipped', valor };
        }
        return this.rodarTelas(p);
    };

    /** Tela 1 (com299) → Tela 2 (fin014) → Tela 3 (com297). GAPs → fail-closed com etapa registrada. */
    private rodarTelas = async (p: EscritaCtx): Promise<GerarNumerarioResult> => {
        const { key, adiantamentoDocCod, valor, writeEnabled } = p;
        const existente = await this.execucaoRepository.findByIdempotencyKey(key);
        let etapa: NumerarioEtapa = existente?.etapa ?? 'sn';
        let snDocCod = existente?.docCod;
        let ndDocCod = existente?.ndDocCod;
        try {
            snDocCod = await this.telaUmSn(p, existente, snDocCod);
            etapa = 'fin014';
            await this.telaDoisFin014(p, existente, snDocCod);
            etapa = 'nota-debito';
            ndDocCod = await this.telaTresNotaDebito(p, existente, ndDocCod);
            // Tela 3 termina num GAP (fiscal/observações/homologar) — nunca chega a 'concluido' ainda.
            throw new NumerarioGapError({
                etapa: 'nota-debito-fiscal',
                message:
                    'com297 fiscal ("Pagamento antecipado") + gerar observacoes + homologar — endpoints not confirmed (capture HAR)',
            });
        } catch (err) {
            return this.registrarFalha({
                key,
                adiantamentoDocCod,
                valor,
                writeEnabled,
                etapa,
                snDocCod,
                ndDocCod,
                err,
            });
        }
    };

    /** Tela 1: gera a SN + finaliza. Retoma se `doc_cod` já gravado (não recria). */
    private telaUmSn = async (
        p: EscritaCtx,
        existente: NumerarioExecucaoRow | null,
        snDocCodIn?: number,
    ): Promise<number> => {
        const { key, filCod, snPayload } = p;
        let snDocCod = snDocCodIn;
        if (snDocCod === undefined) {
            await this.execucaoRepository.setRequestPayload(key, snPayload);
            const validaMsgs = await this.gerDocClient.validarGeracao({
                tela: 'com299',
                filCod,
                gcdCod: GCD_ENCOMENDA,
            });
            this.assertNoErpError(validaMsgs, 'validaGeracao');
            const gen = await this.gerDocClient.gerarDocProcesso({
                tela: 'com299',
                filCod,
                payload: snPayload,
            });
            this.assertNoErpError(gen.messages, 'gerDocProcesso');
            snDocCod = gen.docCod;
            await this.execucaoRepository.setSnDocCod(key, snDocCod);
        }
        if (existente?.etapa === undefined || existente.etapa === 'sn') {
            const finMsgs = await this.gerDocClient.finalizarDocumento({
                tela: 'com299',
                filCod,
                docCod: snDocCod,
            });
            this.assertNoErpError(finMsgs, 'finalizaDocumento');
            await this.execucaoRepository.setEtapa(key, 'sn-finalizar');
        }
        return snDocCod;
    };

    /** Tela 2: recebimento fin014 (borderô → validar título → gravar baixa → finalizar). */
    private telaDoisFin014 = async (
        p: EscritaCtx,
        existente: NumerarioExecucaoRow | null,
        snDocCod: number,
    ): Promise<void> => {
        if (existente?.fin014BorCod !== undefined) return; // já recebido (retomada)
        const { key, filCod, valor, dataRecebimento, env } = p;
        const conta = env.fin014ContaFinanceira;
        if (conta === undefined) {
            throw new NumerarioGapError({
                etapa: 'fin014',
                message:
                    'fin014 conta financeira missing — set FIN014_CONTA_FINANCEIRA (the same as FIN_134)',
            });
        }
        await this.execucaoRepository.setEtapa(key, 'fin014');
        const bordero = await this.fin014Client.criarBordero({
            filCod,
            dataMovto: dataRecebimento,
            gerNum: conta,
        });
        const titCod = 1;
        // Fluxo permutas DRY-RUN-only (não dispara live). `titEspNumero:''` só satisfaz o contrato do client;
        // o fluxo REAL (RecebimentoNumerarioService) resolve o número real via lov/TituloBorderoReceber.
        const val = await this.fin014Client.validarTituloBaixa({
            filCod,
            borCod: bordero.borCod,
            docCod: snDocCod,
            titCod,
            titEspNumero: '',
        });
        this.assertNoErpError(val.messages ?? [], 'fin014 tituloBaixa');
        const bxaMnyValor = round2(val.responseData?.bxaMnyValor ?? valor);
        await this.fin014Client.gravarBaixa({
            filCod,
            payload: {
                filCod,
                borCod: bordero.borCod,
                docTip: 1,
                docCod: snDocCod,
                titCod,
                gerNum: conta,
                bxaMnyValor,
                bxaMnyJuros: 0,
                bxaMnyMulta: 0,
                bxaMnyDesconto: 0,
                bxaMnyLiquido: bxaMnyValor,
                bxaVldCcorrente: 0,
                bxaVldCorrenteDc: 1,
                bxaVldAdto: 0,
                frontModelName: 'baixa',
            },
        });
        await this.fin014Client.finalizarBordero({ filCod, borCod: bordero.borCod });
        await this.execucaoRepository.setFin014BorCod(key, bordero.borCod);
    };

    /** Tela 3: nota de débito com297 — resolve gcd, gera, adiciona produto 41978. Retoma se já gerada. */
    private telaTresNotaDebito = async (
        p: EscritaCtx,
        existente: NumerarioExecucaoRow | null,
        ndDocCodIn?: number,
    ): Promise<number> => {
        if (ndDocCodIn !== undefined) return ndDocCodIn; // já gerada (retomada)
        const { key, filCod, valor, env } = p;
        const gcd =
            env.com297GcdNotaDebito ??
            (await this.gerDocClient.resolveGcdCodByName({
                tela: 'com297',
                filCod,
                gcdDesNome: env.com297GcdNotaDebitoNome,
            }));
        if (gcd === undefined) {
            throw new NumerarioGapError({
                etapa: 'nota-debito',
                message: `com297 Configuracao "${env.com297GcdNotaDebitoNome}" not found — set COM297_GCD_NOTA_DEBITO`,
            });
        }
        await this.execucaoRepository.setEtapa(key, 'nota-debito');
        const config = await this.gerDocClient.validaConfigDoc({
            tela: 'com297',
            filCod,
            docTip: DOC_TIP_SN,
            globalDocVldTipo: GLOBAL_DOC_VLD_TIPO_SN,
            priCod: p.priCodNum,
            pesCod: p.pesCodNum,
            endCodFis: END_COD_FIS_DEFAULT,
            gcdCod: gcd,
        });
        const ndPayload = this.buildNotaDebitoPayload({
            adto: p.adto,
            priCod: p.priCodNum,
            pesCod: p.pesCodNum,
            valor,
            input: p.input,
            gcdCod: gcd,
            config,
        });
        const gen = await this.gerDocClient.gerarDocProcesso({
            tela: 'com297',
            filCod,
            payload: ndPayload,
        });
        this.assertNoErpError(gen.messages, 'com297 gerDocProcesso');
        const ndDocCod = gen.docCod;
        await this.execucaoRepository.setNdDocCod(key, ndDocCod);
        const prodMsgs = await this.gerDocClient.adicionarProduto({
            tela: 'com297',
            filCod,
            payload: {
                docCod: ndDocCod,
                docTip: DOC_TIP_SN,
                fisCod: 1,
                prdCod: PRODUTO_NOTA_DEBITO,
                valor,
            },
        });
        this.assertNoErpError(prodMsgs, 'com297 comDocProdutos');
        return ndDocCod;
    };

    private registrarFalha = async (p: {
        key: string;
        adiantamentoDocCod: string;
        valor: number;
        writeEnabled: boolean;
        etapa: NumerarioEtapa;
        snDocCod?: number;
        ndDocCod?: number;
        err: unknown;
    }): Promise<GerarNumerarioResult> => {
        const { key, adiantamentoDocCod, valor, writeEnabled, snDocCod, ndDocCod, err } = p;
        const isGap = err instanceof NumerarioGapError;
        const etapa: NumerarioEtapa = isGap ? (err.etapa as NumerarioEtapa) : p.etapa;
        const mensagem = isGap ? err.message : this.erpErrorInterpreter.interpret(err).friendly;
        await this.execucaoRepository.markError(key, {
            etapa,
            erroMensagem: mensagem,
            erpResponse: this.extractErpData(err),
        });
        await this.logService.error({
            type: LOG_TYPE.BUSINESS_WARN,
            message: isGap ? 'generate SN stopped at GAP step (fail-closed)' : 'generate SN FAILED',
            data: { adiantamentoDocCod, valor, etapa, mensagem, snDocCod, ndDocCod },
        });
        return {
            adiantamentoDocCod,
            dryRun: false,
            writeEnabled,
            status: 'error',
            valor,
            etapa,
            erro: mensagem,
            ...(snDocCod !== undefined ? { docCod: snDocCod } : {}),
            ...(ndDocCod !== undefined ? { notaDebitoDocCod: ndDocCod } : {}),
        };
    };

    /** Idempotência: fluxo já `settled` → skipped; `reconciling` órfão SEM SN → FAIL-CLOSED. */
    private checarBloqueio = async (p: {
        key: string;
        adiantamentoDocCod: string;
        valor: number;
        writeEnabled: boolean;
    }): Promise<GerarNumerarioResult | null> => {
        const { key, adiantamentoDocCod, valor, writeEnabled } = p;
        const existente = await this.execucaoRepository.findByIdempotencyKey(key);
        if (existente?.status === 'settled') {
            return {
                adiantamentoDocCod,
                dryRun: false,
                writeEnabled,
                status: 'skipped',
                valor,
                ...(existente.docCod !== undefined ? { docCod: existente.docCod } : {}),
                ...(existente.ndDocCod !== undefined
                    ? { notaDebitoDocCod: existente.ndDocCod }
                    : {}),
            };
        }
        if (
            existente &&
            !existente.dryRun &&
            existente.status === 'reconciling' &&
            existente.docCod === undefined
        ) {
            const msg =
                `SN generation interrupted mid-flight (state indeterminate) — verify whether the SN for ` +
                `adiantamento ${adiantamentoDocCod} was already created in Conexos BEFORE retrying.`;
            await this.logService.error({
                type: LOG_TYPE.BUSINESS_WARN,
                message: 'generate SN IN-DOUBT (orphan reconciling) — NOT re-POSTed',
                data: { adiantamentoDocCod, valor },
            });
            return {
                adiantamentoDocCod,
                dryRun: false,
                writeEnabled,
                status: 'error',
                etapa: 'sn',
                valor,
                erro: msg,
            };
        }
        return null;
    };

    private buildItems = (rateio: ContaProjetoRow[], valor: number): GerDocProcessoItem[] => {
        if (rateio.length === 0) return [];
        const items = rateio.map((r) => ({
            prjCod: r.prjCod,
            ctpCod: r.ctpCod,
            tmpMnyValor: round2((valor * r.total) / 100),
            ...(r.ctpDesNome !== undefined ? { ctpDesNome: r.ctpDesNome } : {}),
            tpcCod: r.tpcCod,
            ...(r.tpcDesNome !== undefined ? { tpcDesNome: r.tpcDesNome } : {}),
            cfoEspCod: r.cfoEspCod,
            total: r.total,
        }));
        const soma = round2(items.reduce((acc, it) => acc + it.tmpMnyValor, 0));
        const residuo = round2(valor - soma);
        if (residuo !== 0 && items.length > 0) {
            const last = items[items.length - 1];
            last.tmpMnyValor = round2(last.tmpMnyValor + residuo);
        }
        return items;
    };

    private buildSnPayload = (p: {
        adto: AdiantamentoAtivo;
        priCod: number;
        pesCod: number;
        valor: number;
        config: ValidaConfigDocResult;
        items: GerDocProcessoItem[];
        input: GerarNumerarioInput;
    }): GerDocProcessoPayload => {
        const { adto, priCod, pesCod, valor, config, items, input } = p;
        const dpeNomPessoa = adto.importador ?? adto.exportador;
        return {
            docTip: DOC_TIP_SN,
            globalDocVldTipo: GLOBAL_DOC_VLD_TIPO_SN,
            frontModelName: 'gerDocProcesso',
            priCod,
            ...(adto.referenciaExterna !== undefined
                ? { priEspRefcliente: adto.referenciaExterna }
                : {}),
            endCodFis: END_COD_FIS_DEFAULT,
            pesCod,
            ...(dpeNomPessoa !== undefined ? { dpeNomPessoa } : {}),
            gcdCod: GCD_ENCOMENDA,
            gcdDesNome: GCD_DES_NOME_ENCOMENDA,
            ...(config.gcdVldTela !== undefined ? { gcdVldTela: config.gcdVldTela } : {}),
            ...(config.gcdVldPropria !== undefined ? { gcdVldPropria: config.gcdVldPropria } : {}),
            ...(config.gcdVldFormaRateio !== undefined
                ? { gcdVldFormaRateio: config.gcdVldFormaRateio }
                : {}),
            ...(config.fisEspSerie !== undefined ? { fisEspSerie: config.fisEspSerie } : {}),
            ...(config.tpcCod !== undefined ? { tpcCod: config.tpcCod } : {}),
            ...(config.cfoEspCod !== undefined ? { cfoEspCod: config.cfoEspCod } : {}),
            valor,
            ...(input.dataEmissao !== undefined
                ? { docDtaEmissao: input.dataEmissao, docDtaMovimento: input.dataEmissao }
                : {}),
            ...(input.numeroDocumento !== undefined ? { docEspNumero: input.numeroDocumento } : {}),
            items,
        };
    };

    /** Preview (dry-run) do payload fin014 (Tela 2). */
    private buildFin014Preview = (p: {
        filCod: number;
        valor: number;
        dataRecebimento: number;
        conta?: number;
    }): Fin014RecebimentoPayload => ({
        filCod: p.filCod,
        docCod: 0, // vinculado à SN da Tela 1 no rodarTelas
        dataRecebimento: p.dataRecebimento,
        ...(p.conta !== undefined ? { contaFinanceira: p.conta } : {}),
    });

    /** Payload da nota de débito (Tela 3, com297) — Produto 41978, Número '0'. */
    private buildNotaDebitoPayload = (p: {
        adto: AdiantamentoAtivo;
        priCod: number;
        pesCod: number;
        valor: number;
        input: GerarNumerarioInput;
        gcdCod?: number;
        config?: ValidaConfigDocResult;
    }): GerDocProcessoPayload => {
        const { adto, priCod, pesCod, valor, input, config } = p;
        const dpeNomPessoa = adto.importador ?? adto.exportador;
        return {
            docTip: DOC_TIP_SN,
            globalDocVldTipo: GLOBAL_DOC_VLD_TIPO_SN,
            frontModelName: 'gerDocProcesso',
            priCod,
            endCodFis: END_COD_FIS_DEFAULT,
            pesCod,
            ...(dpeNomPessoa !== undefined ? { dpeNomPessoa } : {}),
            gcdCod: p.gcdCod ?? 0,
            gcdDesNome: 'NOTA DE DÉBITO ELETRÔNICA',
            ...(config?.gcdVldTela !== undefined ? { gcdVldTela: config.gcdVldTela } : {}),
            ...(config?.gcdVldFormaRateio !== undefined
                ? { gcdVldFormaRateio: config.gcdVldFormaRateio }
                : {}),
            ...(config?.tpcCod !== undefined ? { tpcCod: config.tpcCod } : {}),
            ...(config?.cfoEspCod !== undefined ? { cfoEspCod: config.cfoEspCod } : {}),
            prdCod: PRODUTO_NOTA_DEBITO,
            docEspNumero: NUMERO_NOTA_DEBITO,
            ...(input.dataEmissao !== undefined
                ? { docDtaEmissao: input.dataEmissao, docDtaMovimento: input.dataEmissao }
                : {}),
            valor,
            items: [],
        };
    };

    private assertNoErpError = (messages: GerDocProcessoMessage[], passo: string): void => {
        const erro = messages.find((m) => m?.valid === 'ERRO');
        if (erro) {
            const detalhe = this.erpErrorInterpreter.describeMessage(erro as ErpMessage);
            throw new Error(`gerDocProcesso ${passo} returned ERRO: ${detalhe}`);
        }
    };

    private extractErpData = (err: unknown): unknown => {
        const ax = err as {
            response?: { data?: unknown };
            cause?: { response?: { data?: unknown } };
        };
        return ax?.response?.data ?? ax?.cause?.response?.data ?? null;
    };
}

/** Contexto de escrita passado entre as etapas (evita listas de parâmetros gigantes). */
interface EscritaCtx {
    key: string;
    filCod: number;
    adiantamentoDocCod: string;
    valor: number;
    snPayload: GerDocProcessoPayload;
    writeEnabled: boolean;
    executadoPor: string;
    gcdCod: number;
    priCod: string;
    pesCod?: string;
    dataRecebimento: number;
    adto: AdiantamentoAtivo;
    priCodNum: number;
    pesCodNum: number;
    input: GerarNumerarioInput;
    env: {
        fin014ContaFinanceira?: number;
        com297GcdNotaDebitoNome: string;
        com297GcdNotaDebito?: number;
    };
}
