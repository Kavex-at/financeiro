import 'reflect-metadata';
import { inject, injectable } from 'tsyringe';
import ConexosFin014Client from '../../client/ConexosFin014Client.js';
import ConexosGerDocProcessoClient from '../../client/ConexosGerDocProcessoClient.js';
import ConexosNdeClient from '../../client/ConexosNdeClient.js';
import ConexosNdeFiscalClient from '../../client/ConexosNdeFiscalClient.js';
import NumerarioGapError from '../../errors/NumerarioGapError.js';
import { LOG_TYPE } from '../../interface/log/LogInterface.js';
import {
    NDE_FISCAL_TIPO_NF_DEBITO_PAGAMENTO_ANTECIPADO,
    NDE_GERACAO_DEFAULTS,
    NDE_GLOBAL_DOC_VLD_TIPO,
    NDE_OBS_SINIEF_MARKER,
    NDE_STATUS_EMISSAO,
    SN_ADIANTAMENTO_PRJ_COD,
    SN_CONTA_ADIANTAMENTO_ENCOMENDA,
    SN_CONTA_ADIANTAMENTO_PREFIXO,
    SN_TPD_COD,
    SOLICITACAO_NUMERARIO_DOC_TIP,
} from '../../interface/recebimentos/constants.js';
import { randomUUID } from 'node:crypto';
import type { Processo } from '../../interface/recebimentos/GerDocProcesso.js';
import type { DocFiscal } from '../../interface/recebimentos/NdeFiscal.js';
import {
    NDE_REPOSITORY_TOKEN,
    type NdeRepositoryInterface,
    SOLICITACAO_NUMERARIO_EXECUCAO_REPOSITORY_TOKEN,
    type SolicitacaoNumerarioEtapa,
    type SolicitacaoNumerarioExecucaoRepositoryInterface,
    type SolicitacaoNumerarioExecucaoRow,
} from '../../interface/recebimentos/ports.js';
import EnvironmentProvider from '../../libs/environment/EnvironmentProvider.js';
import ErpErrorInterpreter from '../permutas/ErpErrorInterpreter.js';
import type { ErpMessage } from '../permutas/ErpErrorInterpreter.js';
import type { GerDocProcessoMessage } from '../../client/ConexosGerDocProcessoClient.js';
import ContingenciaDecider from './ContingenciaDecider.js';
import LogService from '../LogService.js';
import SnPayloadBuilder from './SnPayloadBuilder.js';
import type { SnPayloadInput } from './SnPayloadBuilder.js';
import {
    GLOBAL_DOC_VLD_TIPO_SN,
    type GerDocProcessoPayload,
} from '../../interface/permutas/SolicitacaoNumerario.js';

/** fisCod default do com300 GET — HAR (doc 18337) usa fisCod=1 em todos os exemplos. */
const FIS_COD_DEFAULT = 1;

/** endCodFis default do validaConfigDoc/rateio/payload (permutas usa 1). */
const END_COD_FIS_DEFAULT = 1;

/** Moeda da NDe (registro local) — o fluxo de numerário assume BRL (mesmo default do processo). */
const NDE_MOEDA_PADRAO = 'BRL';

/** `fdvVldErr` da com194 que BLOQUEIA o documento (1 = aviso, não bloqueia). */
const VALIDACAO_BLOQUEANTE = 2;

/**
 * Reconhece a pendência de condição de pagamento na mensagem da com194 — "CONDIÇÃO DE PAGAMENTO ...
 * DIFERENTE DA SUGERIDA NO CADASTRO DE PESSOA" (medida em produção no doc 18342, pessoa 194). Casada
 * sem acentos, porque o ERP varia a acentuação entre telas.
 */
const CONDICAO_PAGAMENTO_REGEX = /CONDICAO DE PAGAMENTO/;

/** Arredonda para 2 casas — obrigatório em todo valor monetário do ERP (CnxValidatorMny). */
const round2 = (n: number): number => Math.round(n * 100) / 100;

/**
 * Reconhece qualquer config "SOLICITAÇÃO DE NUMERÁRIO - *" na lista do `ConfigDocProcesso` (acento e
 * variação de grafia tolerados). Usado no gate 3 para achar a variante ENCOMENDA do processo — e para
 * detectar quando o processo só tem OUTRAS variantes (ex. TERCEIROS), que não auto-geramos ainda.
 */
const SN_CONFIG_NOME_RE = /SOLICITA[ÇC][ÃA]O\s+DE\s+NUMER[ÁA]RIO/i;

/** A transação bancária (pagamento) que originou a alocação — carrega a conta financeira (gerNum). */
export interface RecebimentoNumerarioTransacao {
    /** Conta financeira do PAGAMENTO (fin014 baixa cai NELA — não é uma env fixa). */
    gerNum: number;
    filCod: number;
    valor: number;
}

/** Campos do processo escolhido (imp021) — subconjunto do `Processo` da rota. */
export interface RecebimentoNumerarioProcessoFields {
    filCod: number;
    priEspRefcliente?: string;
    pesCod: number;
    dpeNomPessoa: string;
    moeCod: number;
    /**
     * CNPJ da pessoa (`pdcDocFederal`) do payload com299 — OPCIONAL (GAP de fonte: o imp021 não o expõe).
     * Omitido no payload quando ausente. TODO(frente-iv): sourcing por detalhe da pessoa quando cabeado.
     */
    pdcDocFederal?: string;
    /** Endereço fiscal (`endCodFis`) — OPCIONAL pelo mesmo gap; o HAR usou 2, permutas defaultava 1. */
    endCodFis?: number;
}

/** Entry do orquestrador — UMA alocação (pagamento × processo). */
export interface ProcessarAlocacaoInput {
    /** Handle da transação bancária (pagamento). */
    txnId: string;
    transacao: RecebimentoNumerarioTransacao;
    /** Nº do processo de importação (imp021). */
    priCod: number;
    /** Valor alocado a ESTE processo (a SN é montada com ele). */
    valor: number;
    processoFields: RecebimentoNumerarioProcessoFields;
    ator: string;
    /** Força dry-run mesmo com a escrita ligada (preview sob demanda). */
    dryRunOverride?: boolean;
}

/**
 * Classificação READ-ONLY do pré-flight — decide se a alocação PODE gerar a SN, ANTES de qualquer escrita.
 * Roda apenas o encadeamento de validadores idempotentes (`validaProcessoPessoa` + `validaConfigDocPessoa`).
 * - `READY`: cadastro completo + config SN resolvida → pode gerar.
 * - `BLOCKED_CADASTRO`: `pdcDocFederal`/`endCodFis` ausentes/inválidos (cadastro da pessoa incompleto).
 * - `BLOCKED_ELEGIBILIDADE`: `validaConfigDocPessoa` não devolve `gcdCod` (processo sem config SN válida).
 * - `UNKNOWN`: um validador falhou num formato não reconhecido (não classificável).
 */
export const PREFLIGHT_CLASSIFICACAO = {
    READY: 'READY',
    BLOCKED_CADASTRO: 'BLOCKED_CADASTRO',
    BLOCKED_ELEGIBILIDADE: 'BLOCKED_ELEGIBILIDADE',
    // Falha de TRANSPORTE do validador (405/404/401/403) — bug de integração (rota/permissão), NÃO um
    // veredito de domínio. Separado de UNKNOWN de propósito: um 405 mascarado de "inelegível" foi
    // exatamente o que escondeu o bug do resolver. Gate 0 = HALT, não classifica como (in)elegível.
    TRANSPORT_ERROR: 'TRANSPORT_ERROR',
    // Timeout/5xx/payload inesperado — não classificável AGORA, porém retryable (não é bug de rota).
    UNKNOWN: 'UNKNOWN',
} as const;

export type PreflightClassificacao =
    (typeof PREFLIGHT_CLASSIFICACAO)[keyof typeof PREFLIGHT_CLASSIFICACAO];

/** Resultado tipado do pré-flight — a classificação + os campos resolvidos (para reuso na geração). */
export interface PreflightResult {
    classificacao: PreflightClassificacao;
    /** gcd ALVO resolvido (o da SN-Encomenda, ex. 150) quando READY. */
    gcdCod?: number;
    gcdDesNome?: string;
    /** gcd que o `validaConfigDocPessoa` sugere como default da pessoa (gate 2 — NOTA, não conclui). */
    gcdCodDefault?: number;
    /** Resultado do gate 3 (`validaConfigDoc(gcd alvo)`): true = sem ERRO; false = ERRO (inelegível). */
    gcdAlvoOk?: boolean;
    endCodFis?: number;
    pdcDocFederal?: string;
    motivo?: string;
}

/** Resultado do orquestrador — status + handles + flags fiscais (o contrato da rota deriva daqui). */
export interface ProcessarAlocacaoResult {
    status: 'settled' | 'skipped' | 'error' | 'dry-run' | 'blocked';
    etapa?: SolicitacaoNumerarioEtapa;
    snDocCod?: number;
    borCod?: number;
    ndDocCod?: number;
    revisaoHumana?: boolean;
    ndeAutorizado?: boolean;
    docVldComvalidacoes?: number;
    vldAutorizado?: number;
    erro?: string;
    /** Classificação do pré-flight quando a alocação NÃO seguiu para geração (blocked/error). */
    classificacao?: PreflightClassificacao;
    /** Motivo legível do bloqueio/erro (frontend mostra ao analista) — nunca um 400 cru do ERP. */
    motivo?: string;
    dryRun: boolean;
}

/**
 * RecebimentoNumerarioService — orquestra o fluxo REAL payment-driven da Frente IV, POR ALOCAÇÃO
 * (pagamento × processo). Espelha o writer permutas `GerarSolicitacaoNumerarioService`, mas a conta
 * financeira do recebimento fin014 é a `gerNum` DO PAGAMENTO (a transação já carrega a conta onde caiu),
 * NÃO uma env fixa; e o fluxo carrega a leg FISCAL até `concluido`:
 *
 *   SN (com299) → fin014 (borderô/validar/baixa/finalizar, gerNum = transacao.gerNum) →
 *   NDe (com297 + produto 41978) → fiscal (com300 RMW fisVldTipoNfDebito=6) → observações (com131,
 *   guard SINIEF) → homologar (ContingenciaDecider → ConexosNdeClient) → poll SEFAZ (vldAutorizado).
 *
 * Guard-rails: só escreve com `conexosWriteEnabled=true` E `conexosDryRun=false` (default dry-run:
 * monta/loga os payloads sem POST). Write-ahead + idempotência POR ALOCAÇÃO
 * (`sn-real:{txnId}:{priCod}:{valor}`) com RETOMADA anti-duplicação (cada etapa consulta o ledger e
 * pula o que já concluiu). 401/403 ou qualquer erro de etapa → fail-closed (`markError` + status error).
 * Ver `_inbox/recebimentos-numerario-real-fiscal-spec.md`.
 */
@injectable()
export default class RecebimentoNumerarioService {
    constructor(
        @inject(ConexosGerDocProcessoClient)
        private gerDocClient: ConexosGerDocProcessoClient,
        @inject(ConexosFin014Client) private fin014Client: ConexosFin014Client,
        @inject(ConexosNdeFiscalClient) private fiscalClient: ConexosNdeFiscalClient,
        @inject(ConexosNdeClient) private ndeClient: ConexosNdeClient,
        @inject(ContingenciaDecider) private contingenciaDecider: ContingenciaDecider,
        @inject(EnvironmentProvider) private environmentProvider: EnvironmentProvider,
        @inject(SnPayloadBuilder) private snPayloadBuilder: SnPayloadBuilder,
        @inject(SOLICITACAO_NUMERARIO_EXECUCAO_REPOSITORY_TOKEN)
        private execucaoRepository: SolicitacaoNumerarioExecucaoRepositoryInterface,
        @inject(NDE_REPOSITORY_TOKEN) private ndeRepository: NdeRepositoryInterface,
        @inject(LogService) private logService: LogService,
        @inject(ErpErrorInterpreter) private erpErrorInterpreter: ErpErrorInterpreter,
    ) {}

    public processarAlocacao = async (
        input: ProcessarAlocacaoInput,
    ): Promise<ProcessarAlocacaoResult> => {
        const { txnId, transacao, priCod, processoFields, ator } = input;
        const valor = round2(input.valor);
        if (!(valor > 0)) throw new Error(`invalid allocation value (${input.valor})`);

        const env = await this.environmentProvider.getEnvironmentVars();
        const dryRun =
            !env.conexosWriteEnabled || env.conexosDryRun || input.dryRunOverride === true;

        const processo: Processo = {
            priCod,
            ...(processoFields.priEspRefcliente !== undefined
                ? { priEspRefcliente: processoFields.priEspRefcliente }
                : {}),
            filCod: processoFields.filCod,
            pesCod: processoFields.pesCod,
            dpeNomPessoa: processoFields.dpeNomPessoa,
            moeCod: processoFields.moeCod,
            ...(processoFields.pdcDocFederal !== undefined
                ? { pdcDocFederal: processoFields.pdcDocFederal }
                : {}),
            ...(processoFields.endCodFis !== undefined
                ? { endCodFis: processoFields.endCodFis }
                : {}),
        };
        // pdcDocFederal/endCodFis NÃO vêm mais do imp021: `montarSnPayload` os resolve via
        // `validaProcessoPessoa` (HAR doc 18339) e falha-fechado se ausentes. Os campos de `processoFields`
        // (quando o front os manda) ficam no `processo` só para diagnóstico/compat — não alimentam o payload.
        const snPayloadInput: SnPayloadInput = {
            processo,
            valorSn: valor,
            dataReferencia: new Date(),
            gcdCod: env.solicitacaoNumerarioGcdCod,
        };

        const key = `sn-real:${txnId}:${priCod}:${valor}`;

        if (dryRun) {
            // Pré-flight READ-ONLY também no preview: o analista já vê READY/BLOCKED antes de disparar
            // a execução real. Best-effort — o classificador engole erros do validador (→ UNKNOWN).
            const preflight = await this.classificarAlocacao({
                processo,
                filCod: processoFields.filCod,
                gcdCodFallback: env.solicitacaoNumerarioGcdCod,
            });
            await this.logService.info({
                type: LOG_TYPE.BUSINESS_INFO,
                message: 'processarAlocacao DRY-RUN (payloads montados, nenhum POST no ERP)',
                data: {
                    txnId,
                    priCod,
                    valor,
                    gerNum: transacao.gerNum,
                    classificacao: preflight.classificacao,
                    snPayloadPreview: this.snPayloadBuilder.build(snPayloadInput),
                    snGerDocPayload: this.snPayloadBuilder.toSnGerDocPayload(snPayloadInput),
                    produtoNotaDebito: NDE_GERACAO_DEFAULTS.produtoCod,
                },
            });
            return {
                status: 'dry-run',
                classificacao: preflight.classificacao,
                ...(preflight.motivo !== undefined ? { motivo: preflight.motivo } : {}),
                dryRun: true,
            };
        }

        const ctx: EscritaCtx = {
            key,
            txnId,
            transacao,
            filCod: processoFields.filCod,
            priCod,
            valor,
            snPayloadInput,
            ator,
        };

        const bloqueio = await this.checarBloqueio(ctx);
        if (bloqueio) return bloqueio;

        // Pré-flight READ-ONLY antes de qualquer escrita: classifica a alocação com o encadeamento de
        // validadores idempotentes. Só READY segue para a geração; o resto vira `blocked` (motivo claro,
        // NÃO um 400 cru do ERP). Threada gcdCod/gcdDesNome/endCodFis/pdcDocFederal resolvidos para a etapaSn.
        const preflight = await this.classificarAlocacao({
            processo,
            filCod: processoFields.filCod,
            gcdCodFallback: env.solicitacaoNumerarioGcdCod,
        });
        if (preflight.classificacao !== PREFLIGHT_CLASSIFICACAO.READY) {
            await this.logService.warn({
                type: LOG_TYPE.BUSINESS_WARN,
                message:
                    'processarAlocacao BLOQUEADA no pré-flight (não gerou — cadastro/elegibilidade)',
                data: {
                    txnId,
                    priCod,
                    valor,
                    classificacao: preflight.classificacao,
                    motivo: preflight.motivo,
                },
            });
            return {
                status: 'blocked',
                etapa: 'sn',
                classificacao: preflight.classificacao,
                ...(preflight.motivo !== undefined ? { motivo: preflight.motivo } : {}),
                dryRun: false,
            };
        }
        ctx.preflight = preflight;

        const begin = await this.execucaoRepository.beginExecution({
            idempotencyKey: key,
            filCod: processoFields.filCod,
            priCod,
            txnId,
            valor,
            dryRun: false,
            executadoPor: ator,
        });
        if (begin.alreadySettled) {
            const existente = await this.execucaoRepository.findByIdempotencyKey(key);
            return this.settledResult(existente);
        }
        return this.rodarEtapas(ctx);
    };

    /** SN → fin014 → NDe → fiscal → obs → homologar → poll. Fail-closed com etapa registrada. */
    private rodarEtapas = async (ctx: EscritaCtx): Promise<ProcessarAlocacaoResult> => {
        const { key } = ctx;
        const existente = await this.execucaoRepository.findByIdempotencyKey(key);
        let etapa: SolicitacaoNumerarioEtapa = existente?.etapa ?? 'sn';
        let snDocCod = existente?.docCod;
        let borCod = existente?.fin014BorCod;
        let ndDocCod = existente?.ndDocCod;
        let revisaoHumana = existente?.revisaoHumana ?? false;
        let ndeAutorizado = existente?.ndeAutorizado ?? false;
        let docVldComvalidacoes: number | undefined;
        let vldAutorizado: number | undefined;
        try {
            snDocCod = await this.etapaSn(ctx, existente, snDocCod);
            ctx.snDocCod = snDocCod;
            etapa = 'fin014';
            borCod = await this.etapaFin014(ctx, existente, snDocCod, borCod);
            etapa = 'fin014-done';
            ndDocCod = await this.etapaNotaDebito(ctx, existente, ndDocCod);
            etapa = 'nota-debito';
            await this.etapaFiscal(ctx, existente, ndDocCod);
            etapa = 'fiscal-done';
            await this.etapaObservacoes(ctx, existente, ndDocCod);
            etapa = 'obs-done';
            const homolog = await this.etapaHomologar(ctx, existente, ndDocCod);
            docVldComvalidacoes = homolog.docVldComvalidacoes;
            revisaoHumana = homolog.revisaoHumana;
            etapa = 'homologado';
            // O trabalho do numerário está FEITO após homologar (SN + baixa + NDe emitida). Marca settled
            // AQUI — a autorização SEFAZ (assíncrona) é um flag à parte (`nde_autorizado`), não gate do settle.
            await this.execucaoRepository.markSettled(key, {
                ...(snDocCod !== undefined ? { docCod: snDocCod } : {}),
                ...(ndDocCod !== undefined ? { ndDocCod } : {}),
                ...(homolog.erpResponse !== undefined ? { erpResponse: homolog.erpResponse } : {}),
            });
            const poll = await this.etapaPoll(ctx, ndDocCod);
            vldAutorizado = poll.vldAutorizado;
            ndeAutorizado = poll.autorizado;
            if (poll.autorizado) etapa = 'concluido';

            return {
                status: 'settled',
                etapa,
                ...(snDocCod !== undefined ? { snDocCod } : {}),
                ...(borCod !== undefined ? { borCod } : {}),
                ...(ndDocCod !== undefined ? { ndDocCod } : {}),
                revisaoHumana,
                ndeAutorizado,
                ...(docVldComvalidacoes !== undefined ? { docVldComvalidacoes } : {}),
                ...(vldAutorizado !== undefined ? { vldAutorizado } : {}),
                dryRun: false,
            };
        } catch (err) {
            return this.registrarFalha({ ctx, etapa, snDocCod, borCod, ndDocCod, err });
        }
    };

    /** Etapa 1 (com299): gera a SN + finaliza. Retoma se `doc_cod` já gravado (não recria). */
    private etapaSn = async (
        ctx: EscritaCtx,
        existente: SolicitacaoNumerarioExecucaoRow | null,
        snDocCodIn?: number,
    ): Promise<number> => {
        const { key, filCod, snPayloadInput, preflight } = ctx;
        const snPayload = await this.montarSnPayload(snPayloadInput, filCod, preflight);
        // gcd por-processo resolvido no pré-flight (`validaConfigDocPessoa`); env/hardcoded 150 é só fallback.
        const gcdCodParaValida = preflight?.gcdCod ?? snPayloadInput.gcdCod;
        let snDocCod = snDocCodIn;
        if (snDocCod === undefined) {
            await this.execucaoRepository.setRequestPayload(key, snPayload);
            const validaMsgs = await this.gerDocClient.validarGeracao({
                tela: 'com299',
                filCod,
                gcdCod: gcdCodParaValida,
            });
            this.assertNoErpError(validaMsgs, 'validaGeracao');
            const gen = await this.gerDocClient.gerarDocProcesso({
                tela: 'com299',
                filCod,
                payload: snPayload,
            });
            this.assertNoErpError(gen.messages, 'gerDocProcesso');
            snDocCod = gen.docCod;
            await this.execucaoRepository.setDocCod(key, snDocCod);
            // O doc nasceu SHELL (docMnyValor:0). Completa o adiantamento (condição de pagamento do cadastro
            // + linha de item com o valor) ANTES de finalizar — senão a com194 trava a finalização.
            await this.completarSnAdiantamento(ctx, snDocCod);
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

    /**
     * Completa o adiantamento SN recém-gerado até ficar FINALIZÁVEL:
     *   (1) linha de item (`comDocProdutos`) com o valor alocado — PRESERVA o título que o ERP criou na
     *       geração e materializa o `mnyBruto`;
     *   (2) condição de pagamento — SÓ quando a com194 acusa validação BLOQUEANTE de condição, porque o
     *       PUT que troca o `pgtCod` DESTRÓI as parcelas do documento.
     *
     * A ordem e a condicionalidade vêm de medição no ERP de homologação (2026-08-03,
     * `docs/e2e/gap-titulos-diagnostico.md`): o título nasce na GERAÇÃO com o valor do header; a linha de
     * item o preserva; o PUT da condição o zera e NÃO o regenera (nem reaplicando a mesma condição). Sem o
     * PUT a cadeia fecha — docs 736/737 finalizaram (`docVldFinalizado:1`) com o título visível no
     * `lov/TituloBorderoReceber`, que é o que a `etapaFin014` consulta.
     *
     * O passo (2) não pôde ser removido de vez: a exigência da condição "sugestiva" é POR-PESSOA (a pessoa
     * 194 em produção a exige; o SKYJACK no HML não tem nenhuma e a com194 devolve `count:0`). Quem decide
     * é o ERP, não uma premissa nossa — e o efeito é VERIFICADO logo depois.
     */
    private completarSnAdiantamento = async (ctx: EscritaCtx, snDocCod: number): Promise<void> => {
        await this.addLineItem(ctx, snDocCod);
        await this.applyPaymentConditionIfRequired(ctx, snDocCod);
    };

    /**
     * (2) Condição de pagamento do PRÓPRIO cliente — aplicada apenas sob pendência da com194, e sempre
     * verificada. Fail-closed em dois pontos: sem condição do cliente não grava a de terceiro (gravar a de
     * outra pessoa é adulterar dado financeiro de um documento real), e se o PUT destruir as parcelas a
     * etapa falha em vez de mandar finalizar um documento que o ERP vai recusar.
     */
    private applyPaymentConditionIfRequired = async (
        ctx: EscritaCtx,
        snDocCod: number,
    ): Promise<void> => {
        const { filCod, snPayloadInput } = ctx;
        const { processo } = snPayloadInput;

        if (!(await this.requiresRegisteredPaymentCondition(ctx, snDocCod))) return;

        const condicoes = await this.gerDocClient.listCondPgtoPessoa({
            filCod,
            pesCod: processo.pesCod,
        });
        const cond = this.escolherCondicaoPagamento(condicoes, processo.dpeNomPessoa);
        if (cond === undefined) {
            throw new Error(
                `Condição de pagamento do cliente "${processo.dpeNomPessoa}" (pesCod ${processo.pesCod}) não ` +
                    `encontrada no cadastro (lov/CondPgtoPessoa devolveu ${condicoes.length} condições, nenhuma ` +
                    `do cliente) — a SN ${snDocCod} NÃO foi completada. Cadastre a condição ` +
                    `"<CLIENTE> - DUPLICATA" desta pessoa no Conexos e reprocesse a alocação.`,
            );
        }
        const doc = await this.gerDocClient.getDocumento({
            tela: 'com299',
            filCod,
            docCod: snDocCod,
        });
        await this.gerDocClient.atualizarDocumento({
            tela: 'com299',
            filCod,
            payload: {
                ...doc,
                pgtCod: cond.pgtCod,
                pgtDesNome: cond.pgtDesNome,
                vldRwCondpgt: 1,
            },
        });

        // Discriminador do passo: o documento tem que continuar coerente (título == valor). Se o PUT
        // destruiu as parcelas, a finalização seria recusada com "O TOTAL DOS TÍTULOS ... NÃO CONFERE"
        // — melhor parar aqui, com a causa nomeada, do que na etapa seguinte.
        const depois = await this.gerDocClient.getDocumento({
            tela: 'com299',
            filCod,
            docCod: snDocCod,
        });
        const titulo = round2(Number(depois.mnyTitValor ?? 0));
        const valorDoc = round2(Number(depois.docMnyValor ?? 0));
        if (!(titulo > 0) || titulo !== valorDoc) {
            throw new Error(
                `A condição de pagamento "${cond.pgtDesNome}" (pgtCod ${cond.pgtCod}) foi gravada na SN ` +
                    `${snDocCod}, mas o ERP DESTRUIU os títulos do documento: mnyTitValor=${titulo} ` +
                    `contra docMnyValor=${valorDoc}. Sem título a finalização é recusada e o fin014 não ` +
                    'acha o que baixar. Gere as parcelas na tela Financeiro (com032) do documento e ' +
                    'reprocesse a alocação.',
            );
        }
    };

    /**
     * A com194 acusa pendência BLOQUEANTE de condição de pagamento neste documento? Leitura best-effort:
     * se o validador não responder, seguimos SEM o PUT — a hipótese conservadora é não mexer no que está
     * íntegro, e a finalização (`docVldFinalizado===1`) continua sendo o discriminador seguinte.
     */
    private requiresRegisteredPaymentCondition = async (
        ctx: EscritaCtx,
        snDocCod: number,
    ): Promise<boolean> => {
        try {
            const validacoes = await this.fiscalClient.listValidacoes({
                filCod: ctx.filCod,
                docTip: SOLICITACAO_NUMERARIO_DOC_TIP,
                docCod: snDocCod,
            });
            return validacoes.some(
                (v) =>
                    v.fdvVldErr === VALIDACAO_BLOQUEANTE &&
                    CONDICAO_PAGAMENTO_REGEX.test(
                        this.stripAccents(`${v.fdvEspErr ?? ''} ${v.fdvEspObs ?? ''}`),
                    ),
            );
        } catch (cause) {
            await this.logService.warn({
                type: LOG_TYPE.BUSINESS_WARN,
                message:
                    'com194 unavailable while checking the SN payment condition — proceeding WITHOUT ' +
                    'touching it (never disturb an intact document); finalization is the next discriminator',
                data: {
                    txnId: ctx.txnId,
                    docCod: snDocCod,
                    erro: cause instanceof Error ? cause.message : String(cause),
                },
            });
            return false;
        }
    };

    /** UPPERCASE sem acentos — as mensagens do ERP variam em acentuação entre telas. */
    private stripAccents = (texto: string): string =>
        texto
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .toUpperCase();

    /**
     * (1) Linha de item — é ela que materializa o `mnyBruto` do documento, e ela PRESERVA o título criado
     * na geração (medido no HML: doc 735). A conta de rateio ACOMPANHA a variante da SN do processo
     * (Encomenda/Terceiros/…): deriva a conta-alvo do NOME da config resolvida no pré-flight; fail-closed
     * se não achar (não chuta conta contábil num doc financeiro real).
     */
    private addLineItem = async (ctx: EscritaCtx, snDocCod: number): Promise<void> => {
        const { filCod, valor, snPayloadInput } = ctx;
        const { processo } = snPayloadInput;
        const configNome = ctx.preflight?.gcdDesNome ?? SN_CONTA_ADIANTAMENTO_ENCOMENDA;
        const variante = this.extrairVarianteSn(configNome);
        const contaAlvo = `${SN_CONTA_ADIANTAMENTO_PREFIXO} ${variante}`;
        const contas = await this.gerDocClient.listContasProjetoCtb({
            filCod,
            prjCod: SN_ADIANTAMENTO_PRJ_COD,
            priCod: processo.priCod,
            tpdCod: SN_TPD_COD,
        });
        const conta =
            contas.find((c) => c.ctpDesNome.trim().toUpperCase() === contaAlvo) ??
            contas.find((c) => {
                const n = c.ctpDesNome.toUpperCase();
                return n.includes('ADIANTAMENTO') && n.includes(variante);
            });
        if (conta === undefined) {
            throw new Error(
                `Conta de projeto "${contaAlvo}" (variante ${variante}) não encontrada p/ o processo ` +
                    `${processo.priCod} (lov/ContasProjetoCtb) — sem ela não dá para montar a linha de item da SN.`,
            );
        }
        const docParaItem = await this.gerDocClient.getDocumento({
            tela: 'com299',
            filCod,
            docCod: snDocCod,
        });
        const template = await this.gerDocClient.comDocProdutosInitialValues({
            tela: 'com299',
            filCod,
            doc: docParaItem,
        });
        await this.gerDocClient.adicionarComDocProduto({
            tela: 'com299',
            filCod,
            payload: {
                ...template,
                filCod,
                docCod: snDocCod,
                priCod: processo.priCod,
                dprQtdQuantidade: 1,
                dprPreValorun: valor,
                prjCod: SN_ADIANTAMENTO_PRJ_COD,
                ctpCod: conta.ctpCod,
                ctpDesNome: conta.ctpDesNome,
            },
        });
    };

    /**
     * Extrai a VARIANTE da config de SN a partir do nome ("SOLICITAÇÃO DE NUMERÁRIO - TERCEIROS" → "TERCEIROS";
     * "... - ENCOMENDA" → "ENCOMENDA") — o segmento após o último " - ", UPPERCASE. Usada p/ derivar a conta
     * de rateio da variante. Fallback "ENCOMENDA" se o nome não tiver o separador.
     */
    private extrairVarianteSn = (configNome: string): string => {
        const partes = configNome.split(' - ');
        const ultima = partes[partes.length - 1]?.trim().toUpperCase();
        return ultima !== undefined && ultima.length > 0 ? ultima : 'ENCOMENDA';
    };

    /**
     * Regra de seleção da condição de pagamento: a do cadastro da pessoa é a "&lt;CLIENTE&gt; - DUPLICATA"
     * (a com194 exige a "SUGESTIVA"). NUNCA "A VISTA"/"NÃO FINANCEIRO" — e NUNCA a de OUTRO cliente.
     *
     * Antes bastava a primeira `pgtDesNome` que contivesse "DUPLICATA". Isso ERROU em execução real
     * (HML 2026-08-03, SN com299 nº 731): o `lov/CondPgtoPessoa` IGNORA o filtro `pesCod` e devolve a lista
     * GLOBAL ordenada por nome, então o documento do SKYJACK (pesCod 232) foi gravado com
     * `pgtCod 103 "BONDUELLE - DUPLICATA"` — condição de terceiro num documento financeiro real, e provável
     * causa da finalização não efetivada ("CONDIÇÃO DE PAGAMENTO DIFERENTE DA SUGERIDA" na com194).
     *
     * Agora casa o nome da condição contra o nome do cliente DO DOCUMENTO (`dpeNomPessoa`), em dois passes:
     *   1. ESTRITO — a parte da condição ANTES do token "DUPLICATA" é prefixo do nome do cliente em fronteira
     *      de token, ou vice-versa ("SKYJACK BRASIL" ⊑ "SKYJACK BRASIL IMPORTACAO E COMERCI"). Empate resolve
     *      pela mais específica (prefixo mais longo).
     *   2. TRUNCADO — só se o pass 1 não achou nada: o ERP corta o `dpeNomPessoa` no meio da palavra
     *      ("... E COMERCI"), então aceita-se o último token do CLIENTE como prefixo parcial do token
     *      correspondente da condição. Aceito APENAS quando UMA única condição casa assim — ambiguidade aqui
     *      é chute, e chutar condição de pagamento foi exatamente o bug.
     * `undefined` = não existe condição DESTE cliente; o caller falha-fechado (não grava a de ninguém).
     */
    private escolherCondicaoPagamento = (
        condicoes: Array<{ pgtCod: number; pgtDesNome: string }>,
        nomeCliente: string,
    ): { pgtCod: number; pgtDesNome: string } | undefined => {
        const cliente = this.normalizarNomePessoa(nomeCliente);
        if (cliente === '') return undefined;
        const candidatas: Array<{ cond: { pgtCod: number; pgtDesNome: string }; pessoa: string }> =
            [];
        for (const cond of condicoes) {
            const pessoa = this.pessoaDaCondicaoDuplicata(cond.pgtDesNome);
            if (pessoa !== undefined) candidatas.push({ cond, pessoa });
        }
        const estritas = candidatas.filter(
            (c) =>
                this.prefixoDeTokens(cliente, c.pessoa) || this.prefixoDeTokens(c.pessoa, cliente),
        );
        if (estritas.length > 0) {
            return estritas.reduce((a, b) => (b.pessoa.length > a.pessoa.length ? b : a)).cond;
        }
        const truncadas = candidatas.filter((c) => this.prefixoTruncado(c.pessoa, cliente));
        return truncadas.length === 1 ? truncadas[0]?.cond : undefined;
    };

    /**
     * Nome do cliente embutido numa condição "&lt;CLIENTE&gt; - DUPLICATA", normalizado
     * ("SKYJACK BRASIL - DUPLICATA" → "SKYJACK BRASIL"). `undefined` se a condição não é DUPLICATA ou se é
     * uma "DUPLICATA" genérica sem cliente — que não prova titularidade de ninguém.
     */
    private pessoaDaCondicaoDuplicata = (pgtDesNome: string): string | undefined => {
        const nome = this.normalizarNomePessoa(pgtDesNome);
        const marcador = /(?:^| )DUPLICATA(?: |$)/.exec(nome);
        if (marcador === null) return undefined;
        const pessoa = nome.slice(0, marcador.index).trim();
        return pessoa === '' ? undefined : pessoa;
    };

    /** UPPERCASE, sem acentos, pontuação → espaço, espaços colapsados. Comparação de nomes do ERP. */
    private normalizarNomePessoa = (nome: string): string =>
        nome
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .toUpperCase()
            .replace(/[^A-Z0-9]+/g, ' ')
            .trim();

    /**
     * `true` se `prefixo` inicia `nome` em fronteira de TOKEN ("SKYJACK BRASIL" ⊑ "SKYJACK BRASIL IMPORTACAO",
     * mas "SKY" ⋢ "SKYJACK"). Evita casar cliente errado por coincidência de radical.
     */
    private prefixoDeTokens = (nome: string, prefixo: string): boolean =>
        nome === prefixo || (nome.startsWith(prefixo) && nome.charAt(prefixo.length) === ' ');

    /**
     * Como `prefixoDeTokens`, mas tolera o ÚLTIMO token de `prefixo` cortado no meio — o `dpeNomPessoa` vem
     * truncado do ERP ("SKYJACK BRASIL IMPORTACAO E COMERCI", doc 731 do HML). Todos os tokens anteriores
     * têm que bater EXATAMENTE; o último precisa de ao menos 3 caracteres para não casar por acidente.
     */
    private prefixoTruncado = (nome: string, prefixo: string): boolean => {
        const tokensNome = nome.split(' ');
        const tokensPrefixo = prefixo.split(' ');
        if (tokensPrefixo.length > tokensNome.length) return false;
        const ultimo = tokensPrefixo.length - 1;
        for (let i = 0; i < ultimo; i++) {
            if (tokensPrefixo[i] !== tokensNome[i]) return false;
        }
        const cauda = tokensPrefixo[ultimo] ?? '';
        const alvo = tokensNome[ultimo] ?? '';
        return cauda.length >= 3 && alvo.startsWith(cauda);
    };

    /**
     * Monta o payload REAL do com299. PRIMEIRO chama `validaProcessoPessoa` (HAR doc 18339): a fonte de
     * `endCodFis` + `pdcDocFederal` (o `imp021` não os expõe). Com o `endCodFis` real, `validaConfigDoc`
     * devolve o `gcdVldTela:7`/`gcdVldFormaRateio:1` corretos (limpa `CONFIG_DOC_NAO_POSSUI_ITENS`); ambos
     * entram no HEADER (limpa `endCodFis REQUIRED`). Fail-closed se o lookup não trouxer os dois — agora
     * sabemos que são obrigatórios, não omitir em silêncio. O rateio (`listContasProjeto`) segue DROPADO
     * (HAR: header only, `comDocProdutos/list` pós-geração devolveu count:0).
     */
    private montarSnPayload = async (
        snPayloadInput: SnPayloadInput,
        filCod: number,
        preflight?: PreflightResult,
    ): Promise<GerDocProcessoPayload> => {
        const { processo, gcdCod } = snPayloadInput;
        // Reusa o que o pré-flight já resolveu (`validaProcessoPessoa` + `validaConfigDocPessoa`) quando
        // presente; senão resolve aqui (paridade defensiva se a etapa for chamada sem pré-flight).
        const resolved =
            preflight ??
            (await this.classificarAlocacao({ processo, filCod, gcdCodFallback: gcdCod }));
        const endCodFis = resolved.endCodFis;
        const pdcDocFederal = resolved.pdcDocFederal;
        if (endCodFis === undefined || pdcDocFederal === undefined) {
            throw new Error(
                `validaProcessoPessoa did not return endCodFis/pdcDocFederal for processo ${processo.priCod} ` +
                    `(endCodFis=${String(endCodFis)}, pdcDocFederal=${String(pdcDocFederal)}) — ` +
                    'both are REQUIRED by com299 gerDocProcesso; refusing to generate the SN without them',
            );
        }
        // gcd por-processo resolvido (`validaConfigDocPessoa`); env/hardcoded 150 é só último recurso.
        const gcdCodResolvido = resolved.gcdCod ?? gcdCod;
        const config = await this.gerDocClient.validaConfigDoc({
            tela: 'com299',
            filCod,
            docTip: SOLICITACAO_NUMERARIO_DOC_TIP,
            globalDocVldTipo: GLOBAL_DOC_VLD_TIPO_SN,
            priCod: processo.priCod,
            pesCod: processo.pesCod,
            pdcDocFederal,
            endCodFis,
            gcdCod: gcdCodResolvido,
        });
        return this.snPayloadBuilder.buildSnRealPayload(
            snPayloadInput,
            config,
            { endCodFis, pdcDocFederal },
            {
                ...(resolved.gcdCod !== undefined ? { gcdCod: resolved.gcdCod } : {}),
                ...(resolved.gcdDesNome !== undefined ? { gcdDesNome: resolved.gcdDesNome } : {}),
            },
        );
    };

    /**
     * Extrai o status HTTP de um erro do Conexos para o gate 0 (transporte × domínio). O `ConexosError`
     * embrulha a causa axios em `.cause` e fixa `statusCode:504` (semântica de gateway) — por isso NÃO se
     * lê `.statusCode` aqui: caminha a cadeia de `cause` atrás do `response.status` real (405/404/401…) e,
     * como fallback, faz regex nas mensagens ("...status code 405").
     */
    private extractHttpStatus = (err: unknown): number | undefined => {
        let cur: unknown = err;
        const msgs: string[] = [];
        for (let i = 0; i < 6 && cur !== null && typeof cur === 'object'; i++) {
            const rec = cur as {
                response?: { status?: unknown };
                message?: unknown;
                cause?: unknown;
            };
            const status = rec.response?.status;
            if (typeof status === 'number' && status >= 400 && status < 600) return status;
            if (typeof rec.message === 'string') msgs.push(rec.message);
            cur = rec.cause;
        }
        const m = /status code (\d{3})/i.exec(msgs.join(' | '));
        return m ? Number(m[1]) : undefined;
    };

    /**
     * Gate 0: separa falha de TRANSPORTE (405/404/401/403 — rota/permissão errada, bug de integração →
     * `TRANSPORT_ERROR`, HALT) de indisponibilidade retryable (timeout/5xx/inesperado → `UNKNOWN`). NUNCA
     * deixa um erro de transporte se disfarçar de "(in)elegibilidade" — foi assim que o 405 escondeu o bug.
     */
    private classifyValidatorError = (
        err: unknown,
        endpoint: string,
        extra?: Partial<PreflightResult>,
    ): PreflightResult => {
        const status = this.extractHttpStatus(err);
        if (status === 405 || status === 404 || status === 401 || status === 403) {
            return {
                classificacao: PREFLIGHT_CLASSIFICACAO.TRANSPORT_ERROR,
                ...extra,
                motivo:
                    `Falha de INTEGRAÇÃO no pré-flight (${endpoint} → HTTP ${status}): rota ou permissão ` +
                    'incorreta — NÃO é (in)elegibilidade do processo. Corrigir a integração antes de confiar na classificação.',
            };
        }
        return {
            classificacao: PREFLIGHT_CLASSIFICACAO.UNKNOWN,
            ...extra,
            motivo: `Pré-flight não classificável (${endpoint}): ${this.erpErrorInterpreter.interpret(err).friendly}`,
        };
    };

    /**
     * Pré-flight READ-ONLY (NUNCA gera nada). Quatro gates, do mais barato ao decisor:
     *   gate 0  transporte    405/404/401/403 em qualquer validador → `TRANSPORT_ERROR` (HALT; bug de rota)
     *   gate 1  cadastro      `validaProcessoPessoa` → `endCodFis>0` && `pdcDocFederal` → senão BLOCKED_CADASTRO
     *   gate 2  config default `validaConfigDocPessoa` → gcd default da pessoa (NOTA; não conclui — devolve null
     *                          para todos hoje, então é só diagnóstico)
     *   gate 3  config alvo   `validaConfigDoc(gcd alvo=SN_GCD_COD)` — DECISOR: `messages[].valid==='ERRO'`
     *                          (ex. CFOP incompatível) → BLOCKED_ELEGIBILIDADE; sem ERRO → READY
     * `validaConfigDocPessoa` (que devolvia null p/ TODO processo, inclusive o comprovadamente gerável 3254)
     * NÃO decide mais elegibilidade — virou nota. Ver `_inbox/recebimentos-numerario-real-fiscal-spec.md`.
     */
    public classificarAlocacao = async (params: {
        processo: Processo;
        filCod: number;
        gcdCodFallback?: number;
    }): Promise<PreflightResult> => {
        const { processo, filCod } = params;
        const gcdAlvo = params.gcdCodFallback;

        // ── gate 1: cadastro ──
        let endCodFis: number | undefined;
        let pdcDocFederal: string | undefined;
        try {
            const pessoa = await this.gerDocClient.validaProcessoPessoa({
                tela: 'com299',
                filCod,
                docTip: SOLICITACAO_NUMERARIO_DOC_TIP,
                globalDocVldTipo: GLOBAL_DOC_VLD_TIPO_SN,
                priCod: processo.priCod,
                ...(processo.priEspRefcliente !== undefined
                    ? { priEspRefcliente: processo.priEspRefcliente }
                    : {}),
            });
            endCodFis = pessoa.endCodFis;
            pdcDocFederal = pessoa.pdcDocFederal;
        } catch (err) {
            return this.classifyValidatorError(err, 'validaProcessoPessoa');
        }
        if (
            endCodFis === undefined ||
            endCodFis <= 0 ||
            pdcDocFederal === undefined ||
            pdcDocFederal.trim() === ''
        ) {
            return {
                classificacao: PREFLIGHT_CLASSIFICACAO.BLOCKED_CADASTRO,
                ...(endCodFis !== undefined ? { endCodFis } : {}),
                ...(pdcDocFederal !== undefined ? { pdcDocFederal } : {}),
                motivo:
                    'Cadastro da pessoa incompleto: ' +
                    (pdcDocFederal === undefined || pdcDocFederal.trim() === ''
                        ? 'CNPJ/CPF (pdcDocFederal) ausente'
                        : 'endereço fiscal (endCodFis) ausente ou inválido') +
                    ` — regularizar no Conexos antes de gerar a SN para o processo ${processo.priCod}.`,
            };
        }
        // endCodFis: number, pdcDocFederal: string (narrowed pelo early-return acima).

        // ── gate 2: config default (NOTA, não conclui) ──
        let gcdCodDefault: number | undefined;
        try {
            const cfg = await this.gerDocClient.validaConfigDocPessoa({
                tela: 'com299',
                filCod,
                pesCod: processo.pesCod,
                globalDocVldTipo: GLOBAL_DOC_VLD_TIPO_SN,
                docTip: SOLICITACAO_NUMERARIO_DOC_TIP,
                priCod: processo.priCod,
            });
            gcdCodDefault = cfg.gcdCod;
        } catch (err) {
            return this.classifyValidatorError(err, 'validaConfigDocPessoa', {
                endCodFis,
                pdcDocFederal,
            });
        }
        const notaDefault = gcdCodDefault !== undefined ? { gcdCodDefault } : {};

        // ── gate 3: ELEGIBILIDADE AUTORITATIVA + resolução do gcd POR-PROCESSO ──
        // `lov/ConfigDocProcesso` é a lista REAL de configs que o processo aceita (popula o dropdown da
        // tela). A config de SN VARIA por processo/filial: 3254 → "... - ENCOMENDA" (150); 3478 →
        // "... - TERCEIROS" (151), SEM Encomenda. NUNCA hardcodar 150: resolve a Encomenda DAQUI (preferir o
        // gcd env como desempate, senão casar por NOME "ENCOMENDA"). Se o processo só tem uma VARIANTE de SN
        // (ex. Terceiros), NÃO auto-gera (conta/rateio próprios, ainda não mapeados) — surfaca p/ o analista.
        let configs: Array<{ gcdCod: number; gcdDesNome: string }>;
        try {
            configs = await this.gerDocClient.listConfigDocProcesso({
                tela: 'com299',
                filCod,
                priCod: processo.priCod,
                pesCod: processo.pesCod,
                endCodFis,
            });
        } catch (err) {
            return this.classifyValidatorError(err, 'ConfigDocProcesso', {
                endCodFis,
                pdcDocFederal,
                ...notaDefault,
            });
        }
        const snConfigs = configs.filter((c) => SN_CONFIG_NOME_RE.test(c.gcdDesNome));
        // Resolve a config de SN do processo: preferir a Encomenda (gcd env como desempate, senão por NOME),
        // mas aceitar QUALQUER variante ("- TERCEIROS", etc.) — decisão do Yuri: tratar automaticamente. A
        // conta de rateio da variante é derivada do nome na etapa de completar (fail-closed se não achar).
        const snConfig =
            (gcdAlvo !== undefined && gcdAlvo > 0
                ? snConfigs.find((c) => c.gcdCod === gcdAlvo)
                : undefined) ??
            snConfigs.find((c) => /ENCOMENDA/i.test(c.gcdDesNome)) ??
            snConfigs[0];
        if (snConfig !== undefined) {
            return {
                classificacao: PREFLIGHT_CLASSIFICACAO.READY,
                gcdCod: snConfig.gcdCod,
                gcdDesNome: snConfig.gcdDesNome,
                endCodFis,
                pdcDocFederal,
                gcdAlvoOk: true,
                ...notaDefault,
                ...(/ENCOMENDA/i.test(snConfig.gcdDesNome)
                    ? {}
                    : {
                          motivo:
                              `Processo sem "SN - Encomenda"; usando a variante do próprio processo: ` +
                              `"${snConfig.gcdDesNome}" (gcd ${snConfig.gcdCod}).`,
                      }),
            };
        }
        return {
            classificacao: PREFLIGHT_CLASSIFICACAO.BLOCKED_ELEGIBILIDADE,
            endCodFis,
            pdcDocFederal,
            gcdAlvoOk: false,
            ...notaDefault,
            motivo:
                `Processo ${processo.priCod} NÃO aceita nenhuma "Solicitação de Numerário" ` +
                `(0 de ${configs.length} configurações válidas do processo no Conexos) — inelegível. Escolha outro processo.`,
        };
    };

    /** Etapa 2 (fin014): borderô → validar título (SN docCod) → baixa (gerNum do pagamento) → finalizar. */
    private etapaFin014 = async (
        ctx: EscritaCtx,
        existente: SolicitacaoNumerarioExecucaoRow | null,
        snDocCod: number,
        borCodIn?: number,
    ): Promise<number> => {
        if (existente?.fin014BorCod !== undefined) return existente.fin014BorCod; // já recebido
        if (borCodIn !== undefined) return borCodIn;
        const { key, filCod, valor, transacao } = ctx;
        const gerNum = transacao.gerNum; // conta financeira = a do PAGAMENTO (não uma env fixa)
        await this.execucaoRepository.setEtapa(key, 'fin014');
        // Data do borderô = HOJE (meia-noite UTC). `0` (epoch 1970) cai em período contábil FECHADO →
        // `FIN_010.DATA_BLOQUEADA_PELA_CONTABILIDADE` (live 2026-08-02). Hoje está em período aberto.
        const hoje = new Date();
        const dataMovto = Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth(), hoje.getUTCDate());
        const bordero = await this.fin014Client.criarBordero({
            filCod,
            dataMovto,
            gerNum,
        });
        // O título a-receber REAL da SN vem do LOV (o `titCod` NÃO é 1 fixo; live 2026-08-02). Só aparece
        // porque a SN foi FINALIZADA com valor (etapaSn → completarSnAdiantamento). Fail-closed se sumiu.
        const titulos = await this.fin014Client.listTitulosBorderoReceber({
            filCod,
            docCod: snDocCod,
        });
        const titulo = titulos[0];
        if (titulo === undefined) {
            throw new Error(
                `SN ${snDocCod} não gerou título a receber (lov/TituloBorderoReceber vazio) — ` +
                    'a SN não ficou finalizável (valor/condição de pagamento). Não há o que baixar no fin014.',
            );
        }
        const val = await this.fin014Client.validarTituloBaixa({
            filCod,
            borCod: bordero.borCod,
            docCod: titulo.docCod,
            titCod: titulo.titCod,
            titEspNumero: titulo.titEspNumero,
        });
        this.assertNoErpError(val.messages ?? [], 'fin014 tituloBaixa');
        const bxaMnyValor = round2(val.responseData?.bxaMnyValor ?? valor);
        // bxaVldCcorrente vem da validação (HAR 15-55: 1 = conta corrente); default 1 se ausente.
        const bxaVldCcorrente = val.responseData?.bxaVldCcorrente ?? 1;
        await this.fin014Client.gravarBaixa({
            filCod,
            payload: {
                filCod,
                borCod: bordero.borCod,
                // borVldTipo=1 (a receber) — o mesmo campo obrigatório do borderô/validação da baixa fin014.
                borVldTipo: 1,
                borVldFinalizado: 0,
                bxaVldSistema: 0,
                bxaVldAdto: 0,
                bxaVldCcorrente,
                bxaVldCorrenteDc: 1,
                docTip: SOLICITACAO_NUMERARIO_DOC_TIP,
                docCod: titulo.docCod,
                titCod: titulo.titCod,
                titEspNumero: titulo.titEspNumero,
                gerNum,
                ...(bordero.gerDes !== undefined ? { gerDes: bordero.gerDes } : {}),
                bxaMnyValor,
                bxaMnyJuros: 0,
                bxaMnyMulta: 0,
                bxaMnyDesconto: 0,
                bxaMnyLiquido: bxaMnyValor,
            },
        });
        await this.fin014Client.finalizarBordero({ filCod, borCod: bordero.borCod });
        await this.execucaoRepository.setFin014BorCod(key, bordero.borCod);
        return bordero.borCod;
    };

    /** Etapa 3 (com297): gera a nota de débito + produto 41978. Retoma se já gerada. */
    private etapaNotaDebito = async (
        ctx: EscritaCtx,
        existente: SolicitacaoNumerarioExecucaoRow | null,
        ndDocCodIn?: number,
    ): Promise<number> => {
        if (existente?.ndDocCod !== undefined) return existente.ndDocCod; // já gerada
        if (ndDocCodIn !== undefined) return ndDocCodIn;
        const { key, filCod, snPayloadInput } = ctx;
        const { processo } = snPayloadInput;
        const env = await this.environmentProvider.getEnvironmentVars();
        // gcd do com297 = env override ?? resolve pelo NOME (nunca o gcdCod=150 da SN). Fail-closed se ausente.
        const ndGcdCod =
            env.com297GcdNotaDebito ??
            (await this.gerDocClient.resolveGcdCodByName({
                tela: 'com297',
                filCod,
                gcdDesNome: env.com297GcdNotaDebitoNome,
            }));
        if (ndGcdCod === undefined) {
            throw new NumerarioGapError({
                etapa: 'nota-debito',
                message: `com297 Configuracao "${env.com297GcdNotaDebitoNome}" not found — set COM297_GCD_NOTA_DEBITO`,
            });
        }
        // endCodFis + pdcDocFederal REAIS do pré-flight (validaProcessoPessoa) — o com297 os exige igual ao
        // com299 (sem pdcDocFederal → 400 "pdcDocFederalFilter;", live 2026-08-03). Fallback ao default 1.
        const endCodFis = ctx.preflight?.endCodFis ?? END_COD_FIS_DEFAULT;
        const pdcDocFederal = ctx.preflight?.pdcDocFederal;
        const ndConfig = await this.gerDocClient.validaConfigDoc({
            tela: 'com297',
            filCod,
            docTip: SOLICITACAO_NUMERARIO_DOC_TIP,
            // NDe = globalDocVldTipo 0 (não o 9 do SN) — HAR 23-27. Com 9 o processo rejeita a config 248.
            globalDocVldTipo: NDE_GLOBAL_DOC_VLD_TIPO,
            priCod: processo.priCod,
            pesCod: processo.pesCod,
            ...(pdcDocFederal !== undefined ? { pdcDocFederal } : {}),
            endCodFis,
            gcdCod: ndGcdCod,
        });
        const ndPayload: GerDocProcessoPayload = this.snPayloadBuilder.buildNotaDebitoRealPayload(
            snPayloadInput,
            ndGcdCod,
            env.com297GcdNotaDebitoNome,
            ndConfig,
            NDE_GERACAO_DEFAULTS.produtoCod,
            NDE_GERACAO_DEFAULTS.numero,
            { endCodFis, ...(pdcDocFederal !== undefined ? { pdcDocFederal } : {}) },
        );
        const gen = await this.gerDocClient.gerarDocProcesso({
            tela: 'com297',
            filCod,
            payload: ndPayload,
        });
        this.assertNoErpError(gen.messages, 'com297 gerDocProcesso');
        const ndDocCod = gen.docCod;
        await this.execucaoRepository.setNdDocCod(key, ndDocCod);
        // NÃO adicionar produto via com297/comDocProdutos: o produto (41978) já vai no HEADER do
        // gerDocProcesso (HAR 23-27 NÃO faz esse POST — falhava `docVldTipo required`). Segue p/ o fiscal.
        return ndDocCod;
    };

    /** Etapa 4 (com300 fiscal, RMW): GET o finDocFiscal INTEIRO → set fisVldTipoNfDebito=6 → PUT. */
    private etapaFiscal = async (
        ctx: EscritaCtx,
        existente: SolicitacaoNumerarioExecucaoRow | null,
        ndDocCod: number,
    ): Promise<void> => {
        if (this.etapaAtingida(existente, 'fiscal-done')) return; // já fiscalizado (retomada)
        const { key, filCod } = ctx;
        const atual = await this.fiscalClient.lerDocFiscal({
            filCod,
            docTip: SOLICITACAO_NUMERARIO_DOC_TIP,
            docCod: ndDocCod,
            fisCod: FIS_COD_DEFAULT,
        });
        const modificado: DocFiscal = {
            ...atual,
            fisVldTipoNfDebito: NDE_FISCAL_TIPO_NF_DEBITO_PAGAMENTO_ANTECIPADO,
        };
        await this.fiscalClient.gravarDocFiscal({ filCod, finDocFiscal: modificado });
        await this.execucaoRepository.setEtapa(key, 'fiscal-done');
    };

    /** Etapa 5 (com131 obs): lê; pula geraObs se `fisEspObs` já tem o marcador SINIEF (idempotência). */
    private etapaObservacoes = async (
        ctx: EscritaCtx,
        existente: SolicitacaoNumerarioExecucaoRow | null,
        ndDocCod: number,
    ): Promise<void> => {
        if (this.etapaAtingida(existente, 'obs-done')) return; // já observado (retomada)
        const { key, filCod } = ctx;
        const atual = await this.fiscalClient.lerObservacoes({
            filCod,
            docTip: SOLICITACAO_NUMERARIO_DOC_TIP,
            docCod: ndDocCod,
        });
        const jaTemSinief = (atual.fisEspObs ?? '').includes(NDE_OBS_SINIEF_MARKER);
        if (!jaTemSinief) {
            await this.fiscalClient.gerarObservacoes({
                filCod,
                docTip: SOLICITACAO_NUMERARIO_DOC_TIP,
                docCod: ndDocCod,
            });
        }
        await this.execucaoRepository.setEtapa(key, 'obs-done');
    };

    /**
     * Etapa 6 (homologar): pré-condição (docVldConferencia/vldEnviarConferencia) → ContingenciaDecider
     * (por vldTpNf) → ConexosNdeClient.homologar. Em `docVldComvalidacoes===2` → listValidacoes + revisão.
     */
    private etapaHomologar = async (
        ctx: EscritaCtx,
        existente: SolicitacaoNumerarioExecucaoRow | null,
        ndDocCod: number,
    ): Promise<{ docVldComvalidacoes?: number; revisaoHumana: boolean; erpResponse?: unknown }> => {
        if (this.etapaAtingida(existente, 'homologado')) {
            return { revisaoHumana: existente?.revisaoHumana ?? false };
        }
        const { key, filCod } = ctx;
        const status = await this.fiscalClient.lerDocParaPolling({ filCod, docCod: ndDocCod });
        // Pré-condição (ng-disabled do UI): checar conferência antes de disparar a homologação.
        if (status.docVldConferencia === 1 || status.vldEnviarConferencia === 1) {
            throw new NumerarioGapError({
                etapa: 'homologado',
                message:
                    'com297 homologação bloqueada: documento pendente de conferência ' +
                    '(docVldConferencia/vldEnviarConferencia) — resolver no Conexos antes de homologar.',
            });
        }
        const rota = this.contingenciaDecider.decidir(status.vldTpNf);
        const homolog = await this.ndeClient.homologar({
            docCod: String(ndDocCod),
            filCod,
            rota,
            correlationId: key,
        });

        // Após homologa: lê docMnyValor; 0 é aceitável (log, não bloqueia).
        const posHomolog = await this.fiscalClient.lerDocParaPolling({ filCod, docCod: ndDocCod });
        if (posHomolog.docMnyValor === 0) {
            await this.logService.warn({
                type: LOG_TYPE.BUSINESS_WARN,
                message: 'NDe homologada com docMnyValor=0 (aceitável por decisão — não bloqueia)',
                data: { txnId: ctx.txnId, ndDocCod, priCod: ctx.priCod },
            });
        }

        let revisaoHumana = false;
        if (homolog.avisoValidacoesPendentes) {
            revisaoHumana = true;
            const validacoes = await this.fiscalClient.listValidacoes({
                filCod,
                docTip: SOLICITACAO_NUMERARIO_DOC_TIP,
                docCod: ndDocCod,
            });
            await this.logService.warn({
                type: LOG_TYPE.BUSINESS_WARN,
                message: 'NDe homologada COM validações pendentes (com194) — revisão humana',
                data: {
                    txnId: ctx.txnId,
                    ndDocCod,
                    docVldComvalidacoes: homolog.docVldComvalidacoes,
                    validacoes,
                },
            });
            await this.execucaoRepository.setRevisaoHumana(key, true);
        }
        await this.execucaoRepository.setEtapa(key, 'homologado');

        // Registra a NDe como ENTIDADE de 1ª classe (auditoria + aba NDe do painel): a emissão vira um
        // `nota_debito_eletronica` (idempotente por `idempotency_key`). O docCod Conexos vai no erp_response
        // (a tabela não tem coluna própria); o numero_nde é o número SEFAZ. `emitida` mesmo com revisão humana.
        await this.ndeRepository.save({
            id: randomUUID(),
            recebimentoId: ctx.txnId,
            filCod,
            correlationId: key,
            ...(homolog.numeroNde !== undefined ? { numeroNde: homolog.numeroNde } : {}),
            valor: ctx.valor,
            moeda: NDE_MOEDA_PADRAO,
            statusEmissao: NDE_STATUS_EMISSAO.EMITIDA,
            idempotencyKey: key,
            erpResponse: homolog.erpResponse,
            emitidaEm: new Date(),
            emitidaPor: ctx.ator,
        });

        return {
            docVldComvalidacoes: homolog.docVldComvalidacoes,
            revisaoHumana,
            erpResponse: homolog.erpResponse,
        };
    };

    /**
     * Etapa 7 (autorização SEFAZ): a autorização da NF-e é ASSÍNCRONA (o SEFAZ leva de segundos a horas) —
     * NÃO pode bloquear o "Processar". Faz UMA leitura best-effort de `vldAutorizado`: se já autorizou,
     * settle+concluído; senão devolve `homologado` (o status geral já é `settled`, `ndeAutorizado:false`) e a
     * autorização é reconciliada depois (uma re-alocação/refresh retoma a leitura a partir de `homologado`).
     * Antes: loop de até 5 min segurando o request HTTP → "Processar" girava eternamente.
     */
    private etapaPoll = async (
        ctx: EscritaCtx,
        ndDocCod: number,
    ): Promise<{ autorizado: boolean; vldAutorizado?: number }> => {
        const { key, filCod } = ctx;
        const status = await this.fiscalClient.lerDocParaPolling({ filCod, docCod: ndDocCod });
        const vldAutorizado = status.vldAutorizado;
        // `markSettled` NÃO acontece mais aqui — o `rodarEtapas` marca settled logo após homologar (o
        // trabalho do numerário está feito). Aqui só registramos SE o SEFAZ já autorizou (flag separado).
        if (vldAutorizado !== undefined && vldAutorizado !== 0) {
            await this.execucaoRepository.setNdeAutorizado(key, true);
            return { autorizado: true, vldAutorizado };
        }
        await this.logService.warn({
            type: LOG_TYPE.BUSINESS_WARN,
            message:
                'NDe homologada; SEFAZ ainda não autorizou (assíncrono) — não bloqueia o Processar; ' +
                'reconcilia depois (retoma a leitura a partir de homologado)',
            data: { txnId: ctx.txnId, ndDocCod, priCod: ctx.priCod },
        });
        return { autorizado: false, ...(vldAutorizado !== undefined ? { vldAutorizado } : {}) };
    };

    /** `true` se a etapa já foi atingida (ordem monotônica das etapas fiscais). */
    private etapaAtingida = (
        existente: SolicitacaoNumerarioExecucaoRow | null,
        alvo: SolicitacaoNumerarioEtapa,
    ): boolean => {
        if (!existente?.etapa) return false;
        return this.etapaOrdem(existente.etapa) >= this.etapaOrdem(alvo);
    };

    private etapaOrdem = (etapa: SolicitacaoNumerarioEtapa): number => {
        const ordem: Record<SolicitacaoNumerarioEtapa, number> = {
            sn: 0,
            'sn-finalizar': 1,
            fin014: 2,
            'fin014-done': 3,
            'nota-debito': 4,
            'fiscal-done': 5,
            'obs-done': 6,
            homologado: 7,
            concluido: 8,
            error: -1,
        };
        return ordem[etapa] ?? -1;
    };

    private settledResult = (
        existente: SolicitacaoNumerarioExecucaoRow | null,
    ): ProcessarAlocacaoResult => ({
        status: 'skipped',
        ...(existente?.etapa !== undefined ? { etapa: existente.etapa } : {}),
        ...(existente?.docCod !== undefined ? { snDocCod: existente.docCod } : {}),
        ...(existente?.fin014BorCod !== undefined ? { borCod: existente.fin014BorCod } : {}),
        ...(existente?.ndDocCod !== undefined ? { ndDocCod: existente.ndDocCod } : {}),
        revisaoHumana: existente?.revisaoHumana ?? false,
        ndeAutorizado: existente?.ndeAutorizado ?? false,
        dryRun: false,
    });

    private registrarFalha = async (p: {
        ctx: EscritaCtx;
        etapa: SolicitacaoNumerarioEtapa;
        snDocCod?: number;
        borCod?: number;
        ndDocCod?: number;
        err: unknown;
    }): Promise<ProcessarAlocacaoResult> => {
        const { ctx, snDocCod, borCod, ndDocCod, err } = p;
        const isGap = err instanceof NumerarioGapError;
        const etapa: SolicitacaoNumerarioEtapa = isGap
            ? (err.etapa as SolicitacaoNumerarioEtapa)
            : p.etapa;
        const mensagem = isGap ? err.message : this.erpErrorInterpreter.interpret(err).friendly;
        await this.execucaoRepository.markError(ctx.key, {
            etapa,
            erroMensagem: mensagem,
            erpResponse: this.extractErpData(err),
        });
        await this.logService.error({
            type: LOG_TYPE.BUSINESS_WARN,
            message: isGap
                ? 'processarAlocacao stopped at GAP step (fail-closed)'
                : 'processarAlocacao FAILED',
            data: { txnId: ctx.txnId, priCod: ctx.priCod, valor: ctx.valor, etapa, mensagem },
        });
        return {
            status: 'error',
            etapa,
            ...(snDocCod !== undefined ? { snDocCod } : {}),
            ...(borCod !== undefined ? { borCod } : {}),
            ...(ndDocCod !== undefined ? { ndDocCod } : {}),
            erro: mensagem,
            dryRun: false,
        };
    };

    /** Idempotência: fluxo já `settled` → skipped; `reconciling` órfão SEM SN → FAIL-CLOSED. */
    private checarBloqueio = async (ctx: EscritaCtx): Promise<ProcessarAlocacaoResult | null> => {
        const existente = await this.execucaoRepository.findByIdempotencyKey(ctx.key);
        if (existente?.status === 'settled') {
            return this.settledResult(existente);
        }
        if (
            existente &&
            !existente.dryRun &&
            existente.status === 'reconciling' &&
            existente.docCod === undefined
        ) {
            const msg =
                `SN generation interrupted mid-flight (state indeterminate) — verify whether the SN for ` +
                `processo ${ctx.priCod} (txn ${ctx.txnId}) was already created in Conexos BEFORE retrying.`;
            await this.logService.error({
                type: LOG_TYPE.BUSINESS_WARN,
                message: 'processarAlocacao IN-DOUBT (orphan reconciling) — NOT re-POSTed',
                data: { txnId: ctx.txnId, priCod: ctx.priCod, valor: ctx.valor },
            });
            return { status: 'error', etapa: 'sn', erro: msg, dryRun: false };
        }
        return null;
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
    txnId: string;
    transacao: RecebimentoNumerarioTransacao;
    filCod: number;
    priCod: number;
    valor: number;
    snPayloadInput: SnPayloadInput;
    ator: string;
    /** Preenchido no fluxo (para o markSettled do poll). */
    snDocCod?: number;
    /** Classificação READ-ONLY resolvida antes da escrita (gcd/endCodFis/pdcDocFederal por-processo). */
    preflight?: PreflightResult;
}
