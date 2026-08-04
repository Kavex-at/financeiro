import { injectable } from 'tsyringe';
import {
    NDE_GERACAO_DEFAULTS,
    NDE_GLOBAL_DOC_VLD_TIPO,
    SOLICITACAO_NUMERARIO_DOC_CONFIG,
    SOLICITACAO_NUMERARIO_DOC_TIP,
    SOLICITACAO_NUMERARIO_DOC_VLD_TIPO,
    SOLICITACAO_NUMERARIO_DOC_VLD_TIPO_ADTO,
} from '../../interface/recebimentos/constants.js';
import type {
    DocConfig,
    GerDocProcessoSelectionDTOCab,
    Processo,
} from '../../interface/recebimentos/GerDocProcesso.js';
import {
    GLOBAL_DOC_VLD_TIPO_SN,
    type ContaProjetoRow,
    type GerDocProcessoItem,
    type GerDocProcessoPayload,
    type ValidaConfigDocResult,
} from '../../interface/permutas/SolicitacaoNumerario.js';

/** endCodFis default do payload de geração (permutas usa 1). */
const END_COD_FIS_DEFAULT = 1;

/**
 * `gcdDesNome` do payload REAL da SN Encomenda — UPPERCASE (HAR doc 18339: "SOLICITAÇÃO DE NUMERÁRIO -
 * ENCOMENDA"). NÃO usar o rótulo mixed-case do preview (`SOLICITACAO_NUMERARIO_DOC_CONFIG.gcdDesNome`):
 * o wire real do com299 grava o nome em caixa alta.
 */
const GCD_DES_NOME_SN_ENCOMENDA = 'SOLICITAÇÃO DE NUMERÁRIO - ENCOMENDA';

/** Arredonda para 2 casas — obrigatório em todo valor monetário do ERP (CnxValidatorMny). */
const round2 = (n: number): number => Math.round(n * 100) / 100;

/** epoch-ms da meia-noite UTC do dia da data (guia Tela 1: "Data emissão"/"Data entrada"). */
const utcMidnightEpochMs = (d: Date): number =>
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());

/** Número do documento na SN = "data do dia" DDMMYYYY (guia Tela 1). */
const ddmmyyyy = (d: Date): string => {
    const day = String(d.getUTCDate()).padStart(2, '0');
    const month = String(d.getUTCMonth() + 1).padStart(2, '0');
    const year = String(d.getUTCFullYear());
    return `${day}${month}${year}`;
};

/** Input do builder — o processo, o valor da SN (já resolvido), a data e o gcdCod do ambiente. */
export interface SnPayloadInput {
    processo: Processo;
    valorSn: number;
    dataReferencia: Date;
    gcdCod: number;
}

/**
 * SnPayloadBuilder — a fonte ÚNICA do payload `GerDocProcessoSelectionDTOCab` (com299 SN Encomenda).
 * Extraído do `SolicitacaoNumerarioService.gerar()` para que o preview (dry-run) da rota e o
 * orquestrador REAL (`RecebimentoNumerarioService`) montem EXATAMENTE o mesmo cabeçalho — um só lugar
 * decide `docTip=1`/`docVldTipo=9`/`docVldTipoAdto=1`/`moeCod=null` (HAR-confirmado, doc 18202). Puro
 * (sem I/O), `@injectable()` para composição via DI. Ver `ontology/integrations/conexos-com299-gerdoc.md`.
 */
@injectable()
export default class SnPayloadBuilder {
    /** A config de documento (`gcd`) devolvida no preview — o rótulo humano + o gcdCod do ambiente. */
    public docConfig = (gcdCod: number): DocConfig => ({
        gcdCod,
        gcdDesNome: SOLICITACAO_NUMERARIO_DOC_CONFIG.gcdDesNome,
    });

    /** Monta o cabeçalho `GerDocProcessoSelectionDTOCab` exato (preview e envio real compartilham este). */
    public build = (input: SnPayloadInput): GerDocProcessoSelectionDTOCab => {
        const { processo, valorSn, dataReferencia, gcdCod } = input;
        const dataIso = dataReferencia.toISOString();
        const docConfig = this.docConfig(gcdCod);
        return {
            filCod: processo.filCod,
            docTip: SOLICITACAO_NUMERARIO_DOC_TIP,
            docVldTipo: SOLICITACAO_NUMERARIO_DOC_VLD_TIPO,
            docVldTipoAdto: SOLICITACAO_NUMERARIO_DOC_VLD_TIPO_ADTO,
            priCod: processo.priCod,
            // `priEspRefcliente` é opcional no imp021 — aqui a semântica é "campo vazio no ERP".
            priEspRefcliente: processo.priEspRefcliente ?? '',
            pesCod: processo.pesCod,
            dpeNomPessoa: processo.dpeNomPessoa,
            gcdCod: docConfig.gcdCod,
            gcdDesNome: docConfig.gcdDesNome,
            docDtaEmissao: dataIso,
            dtaVencimento: dataIso,
            valor: valorSn,
            // `null` de propósito: a SN Encomenda não carrega moeda (BRL implícito) — HAR-confirmado.
            moeCod: null,
            items: [
                {
                    prjCod: 0,
                    ctpCod: 0,
                    tmpMnyValor: valorSn,
                    ctpDesNome: docConfig.gcdDesNome,
                    tpcCod: 0,
                    cfoEspCod: 0,
                    total: valorSn,
                },
            ],
        };
    };

    /**
     * Wire real do `POST {tela}/gerDocProcesso` (`GerDocProcessoPayload`, shape permutas) da SN com299.
     * O `GerDocProcessoSelectionDTOCab` acima é o PREVIEW (dry-run/UI); este é o corpo que o client
     * POSTa. Uma só origem (`SnPayloadBuilder`) para os dois — o preview e o envio real não divergem.
     */
    public toSnGerDocPayload = (input: SnPayloadInput): GerDocProcessoPayload => {
        const { processo, valorSn, gcdCod } = input;
        const docConfig = this.docConfig(gcdCod);
        return {
            docTip: SOLICITACAO_NUMERARIO_DOC_TIP,
            globalDocVldTipo: GLOBAL_DOC_VLD_TIPO_SN,
            frontModelName: 'gerDocProcesso',
            priCod: processo.priCod,
            ...(processo.priEspRefcliente !== undefined
                ? { priEspRefcliente: processo.priEspRefcliente }
                : {}),
            endCodFis: END_COD_FIS_DEFAULT,
            pesCod: processo.pesCod,
            dpeNomPessoa: processo.dpeNomPessoa,
            gcdCod: docConfig.gcdCod,
            gcdDesNome: docConfig.gcdDesNome,
            valor: valorSn,
            items: [],
        };
    };

    /** Wire real do `POST com297/gerDocProcesso` da nota de débito — deriva da SN + produto/número. */
    public toNotaDebitoGerDocPayload = (
        input: SnPayloadInput & { prdCod: number; docEspNumero: string },
    ): GerDocProcessoPayload => ({
        ...this.toSnGerDocPayload(input),
        prdCod: input.prdCod,
        docEspNumero: input.docEspNumero,
        items: [],
    });

    /**
     * Itens de rateio REAIS a partir das linhas servidas pelo ERP (`contasProj/list`) e do valor da SN.
     * Espelha `GerarSolicitacaoNumerarioService.buildItems`: `tmpMnyValor = round2(valor × total/100)`,
     * resíduo de arredondamento absorvido na última linha para bater o `valor` cravado.
     */
    public buildItems = (rateio: ContaProjetoRow[], valorSn: number): GerDocProcessoItem[] => {
        if (rateio.length === 0) return [];
        const items = rateio.map((r) => ({
            prjCod: r.prjCod,
            ctpCod: r.ctpCod,
            tmpMnyValor: round2((valorSn * r.total) / 100),
            ...(r.ctpDesNome !== undefined ? { ctpDesNome: r.ctpDesNome } : {}),
            tpcCod: r.tpcCod,
            ...(r.tpcDesNome !== undefined ? { tpcDesNome: r.tpcDesNome } : {}),
            cfoEspCod: r.cfoEspCod,
            total: r.total,
        }));
        const soma = round2(items.reduce((acc, it) => acc + it.tmpMnyValor, 0));
        const residuo = round2(valorSn - soma);
        if (residuo !== 0 && items.length > 0) {
            const last = items[items.length - 1];
            last.tmpMnyValor = round2(last.tmpMnyValor + residuo);
        }
        return items;
    };

    /**
     * Wire REAL do `POST com299/gerDocProcesso` da SN — HEADER ONLY (SEM `items`, HAR doc 18339: o
     * `comDocProdutos/list` pós-geração devolveu count:0, logo o rateio NÃO alimenta a geração). Carrega:
     * config resolvida do ERP (`validaConfigDoc`: `gcdVldTela`/`gcdVldPropria`/`gcdVldFormaRateio`/
     * `fisEspSerie`), `gcdDesNome` UPPERCASE, datas (epoch-ms meia-noite UTC) e `docEspNumero` (DDMMYYYY).
     *
     * `tpcCod`/`cfoEspCod`/`tpcDesNome` são `null` para a SN Encomenda (HAR). `endCodFis` e `pdcDocFederal`
     * são inputs OBRIGATÓRIOS threaded pelo caller (fonte: `validaProcessoPessoa`, HAR doc 18339) — o
     * servidor os exige (`endCodFis REQUIRED`), então NÃO os omitimos mais. Corrige o payload que enviava
     * `items` de rateio e causava o SELECTION_ERROR na SN real.
     */
    public buildSnRealPayload = (
        input: SnPayloadInput,
        config: ValidaConfigDocResult,
        pessoa: { endCodFis: number; pdcDocFederal: string },
        resolved?: { gcdCod?: number; gcdDesNome?: string },
    ): GerDocProcessoPayload => {
        const { processo, valorSn, gcdCod, dataReferencia } = input;
        const docDta = utcMidnightEpochMs(dataReferencia);
        // gcd por-processo: o resolvido (`validaConfigDocPessoa`) manda; o `input.gcdCod` (env/fallback)
        // só vale se o resolver não trouxe nada. gcdDesNome idem — é o valor validado como `gcdDesNomeProc`.
        const gcdCodFinal = resolved?.gcdCod ?? gcdCod;
        const gcdDesNomeFinal = resolved?.gcdDesNome ?? GCD_DES_NOME_SN_ENCOMENDA;
        return {
            docTip: SOLICITACAO_NUMERARIO_DOC_TIP,
            globalDocVldTipo: GLOBAL_DOC_VLD_TIPO_SN,
            frontModelName: 'gerDocProcesso',
            priCod: processo.priCod,
            ...(processo.priEspRefcliente !== undefined
                ? { priEspRefcliente: processo.priEspRefcliente }
                : {}),
            // endCodFis + pdcDocFederal: threaded do validaProcessoPessoa (HAR doc 18339). Obrigatórios —
            // o servidor exige (`endCodFis REQUIRED`); o caller já falha-fechado se a fonte não os trouxe.
            endCodFis: pessoa.endCodFis,
            pdcDocFederal: pessoa.pdcDocFederal,
            pesCod: processo.pesCod,
            dpeNomPessoa: processo.dpeNomPessoa,
            gcdCod: gcdCodFinal,
            gcdDesNome: gcdDesNomeFinal,
            ...(config.gcdVldTela !== undefined ? { gcdVldTela: config.gcdVldTela } : {}),
            ...(config.gcdVldPropria !== undefined ? { gcdVldPropria: config.gcdVldPropria } : {}),
            ...(config.gcdVldFormaRateio !== undefined
                ? { gcdVldFormaRateio: config.gcdVldFormaRateio }
                : {}),
            ...(config.fisEspSerie !== undefined ? { fisEspSerie: config.fisEspSerie } : {}),
            // tpcCod/cfoEspCod/tpcDesNome são null na SN Encomenda (HAR doc 18339) — NÃO herdar da config.
            tpcCod: null,
            tpcDesNome: null,
            cfoEspCod: null,
            valor: valorSn,
            docDtaEmissao: docDta,
            docDtaMovimento: docDta,
            docEspNumero: ddmmyyyy(dataReferencia),
        };
    };

    /**
     * Wire REAL do `POST com297/gerDocProcesso` da nota de débito — cabeçalho + o gcd DO com297
     * (NÃO o gcdCod=150 da SN) + config resolvida do com297 + produto (41978) + `docEspNumero`. `items:[]`
     * é intencional: a linha de produto é adicionada depois via `comDocProdutos`. Espelha
     * `GerarSolicitacaoNumerarioService.buildNotaDebitoPayload`.
     */
    public buildNotaDebitoRealPayload = (
        input: SnPayloadInput,
        gcdCod: number,
        gcdDesNome: string,
        config: ValidaConfigDocResult,
        produtoCod: number,
        docEspNumero: string | number,
        pessoa: { endCodFis: number; pdcDocFederal?: string },
    ): GerDocProcessoPayload => {
        const { processo, valorSn, dataReferencia } = input;
        const docDta = utcMidnightEpochMs(dataReferencia);
        return {
            docTip: SOLICITACAO_NUMERARIO_DOC_TIP,
            // NDe usa globalDocVldTipo=0 (NÃO o 9 do SN) — foi o 9 que fazia o processo rejeitar a config
            // (`gcdDesNomeProc NOT_VALID`). HAR 2026-08-02 23-27 (doc 18347 SUCESSO).
            globalDocVldTipo: NDE_GLOBAL_DOC_VLD_TIPO,
            frontModelName: 'gerDocProcesso',
            priCod: processo.priCod,
            ...(processo.priEspRefcliente !== undefined
                ? { priEspRefcliente: processo.priEspRefcliente }
                : {}),
            // endCodFis + pdcDocFederal REAIS (validaProcessoPessoa) — o com297 os exige igual ao com299
            // (live 2026-08-03: sem pdcDocFederal → 400 "pdcDocFederalFilter;"). Não usar o default 1.
            endCodFis: pessoa.endCodFis,
            ...(pessoa.pdcDocFederal !== undefined ? { pdcDocFederal: pessoa.pdcDocFederal } : {}),
            pesCod: processo.pesCod,
            dpeNomPessoa: processo.dpeNomPessoa,
            gcdCod,
            gcdDesNome,
            ...(config.gcdVldTela !== undefined ? { gcdVldTela: config.gcdVldTela } : {}),
            ...(config.gcdVldPropria !== undefined ? { gcdVldPropria: config.gcdVldPropria } : {}),
            ...(config.gcdVldFormaRateio !== undefined
                ? { gcdVldFormaRateio: config.gcdVldFormaRateio }
                : {}),
            // Série NFE1 (default da NDe) quando a config não devolve uma própria.
            fisEspSerie: config.fisEspSerie ?? NDE_GERACAO_DEFAULTS.serie,
            ...(config.tpcCod !== undefined ? { tpcCod: config.tpcCod } : {}),
            ...(config.tpcDesNome !== undefined ? { tpcDesNome: config.tpcDesNome } : {}),
            ...(config.cfoEspCod !== undefined ? { cfoEspCod: config.cfoEspCod } : {}),
            prdCod: produtoCod,
            prdDesNome: NDE_GERACAO_DEFAULTS.produtoNome,
            docEspNumero,
            valor: valorSn,
            docDtaEmissao: docDta,
            docDtaMovimento: docDta,
        };
    };
}
