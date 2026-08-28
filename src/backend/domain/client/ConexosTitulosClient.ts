import { inject, injectable, singleton } from 'tsyringe';
import ConexosError from '../errors/ConexosError.js';
import ConexosBaseClient from './ConexosBaseClient.js';

export interface TituloAPagar {
    titCod: string;
    /**
     * Valor da INVOICE em moeda estrangeira (`titMnyValorMneg` no wire).
     * Source: Conexos `com308/financeiroAPagar/list/{docCod}`. Entrada do
     * cálculo de Variação Cambial — `ValorTotal = valorNegociado × taxa`.
     * Optional defensively; in v0.5 the variacao-cambial path requires this
     * for the SOURCE TRUTH, and `VariacaoCambialService` throws
     * `TaxaAusenteError` if `taxa` is null but `valorNegociado` exists.
     * Added by `variacao-cambial` (2026-05-28, ADR-0020).
     */
    valorNegociado?: number;
    /**
     * Taxa de câmbio travada na contratação (`titFltTaxaMneg` no wire).
     * Source: Conexos `com308/financeiroAPagar/list/{docCod}`. NÃO vem de
     * `ContratoCambio` (ADR-0020 D1). Sample (interview docCod=24107):
     * `5.0211`. Added by `variacao-cambial` (2026-05-28).
     */
    taxa?: number;
    /**
     * Código numérico da moeda (`moeCodMneg` no wire). Sample: 220 = USD,
     * 1 = BRL. v0.5 só suporta 220 (USD). Added by `variacao-cambial`.
     */
    moedaCod?: number;
    /**
     * Nome amigável da moeda (`moeEspNome` no wire). Sample: "DOLAR DOS EUA".
     * Exibido na coluna "Moeda" do XLSX de Variação Cambial.
     */
    moedaNome?: string;
    /**
     * Valor de face do título em BRL (`titMnyValor` no wire). Usado pela
     * linha Real/null do relatório de Variação Cambial (moeCodMneg=790 ou
     * null), onde `valorNegociado = valorTotal = valorAtual = titMnyValor` e
     * `variacao = 0` (ADR-0020 Addendum #12 / `vc-moedas-cmn156`,
     * 2026-06-07). Documentos em moeda estrangeira usam `valorNegociado`
     * (`titMnyValorMneg`) — este campo é o face doméstico.
     */
    valorBrl?: number;
    /**
     * Valor JÁ PAGO do título em BRL (`titMnyTotPago` no wire). Com `valorBrl`
     * (face) forma a identidade que decide se o documento está quitado:
     * `pago ⟺ Σ valorBrl − Σ valorPago === 0` (estrita, sem epsilon — decisão
     * Yuri 2026-06-18, `residual-pago-centavos`).
     *
     * Existe porque o `com298/list` **não** popula `mnyTitAberto`/`mnyTitPago`
     * (null em 1146/1146 INVOICEs da filial 2 — sonda `probe-invoice-pago`,
     * 2026-08-28), o que fazia `isPago` devolver `false` para TODAS e a aba
     * "Invoices em aberto" exibir invoices já liquidadas. Derivar daqui custa
     * ZERO chamadas extras: este list já é feito para toda invoice na ingestão.
     * Validado contra `getDetalheTitulos` (ground truth): 30/30 concordam.
     *
     * `undefined` (não `0`) quando o wire não traz o campo — "não sei" é
     * distinto de "nada pago", e o caller cai no fallback conservador.
     */
    valorPago?: number;
}

/**
 * Mapa `moeCodMneg` → sigla limpa exibida na UI. `220` é o dólar dos EUA
 * (sample da entrevista 2026-05-28); `1` é o Real. Estendido sob demanda —
 * códigos fora da tabela caem no fallback `moedaNome ?? 'BRL'`.
 */
const MOEDA_COD_SIGLA: Record<number, string> = {
    1: 'BRL',
    220: 'USD',
};

/**
 * Deriva a sigla da moeda NEGOCIADA do título (`com308`). Prioriza o código
 * estável `moedaCod` (220=USD, 1=BRL); na ausência, usa o `moedaNome` literal
 * ("DOLAR DOS EUA"); por fim, default conservador 'BRL'. Distinta da moeda do
 * DOCUMENTO (`moeEspSigla` null → 'BRL'), que rotulava errado o valor em moeda
 * estrangeira na coluna "Valor Moeda Negociada" da tela Gestão.
 */
export const siglaMoedaNegociada = (titulo?: {
    moedaCod?: number;
    moedaNome?: string;
}): string | undefined => {
    if (!titulo) return undefined;
    if (titulo.moedaCod !== undefined && MOEDA_COD_SIGLA[titulo.moedaCod] !== undefined) {
        return MOEDA_COD_SIGLA[titulo.moedaCod];
    }
    if (titulo.moedaNome !== undefined && titulo.moedaNome !== '') {
        return titulo.moedaNome;
    }
    return 'BRL';
};

export interface BaixaTitulo {
    borDtaMvto: Date;
    valor: number;
    /**
     * Principal liquidado da baixa em BRL ao câmbio de CONTRATO
     * (`bxaMnyValor` no wire) — mesma base de `face × taxa` do título. NÃO
     * inclui juros/multa/desconto (esses entram em `bxaMnyLiquido`, que é
     * `bxaMnyValor + juros + multa − desconto`). É o insumo correto do saldo
     * residual sobre o principal do relatório de Variação Cambial
     * (`pagoBRL = Σ bxaMnyValor das baixas ≤ dataBase`,
     * `residualMneg = face − pagoBRL / taxa`) — ADR-0021 Addendum 2026-06-08 #1 /
     * `vc-multi-titulo`. Distinto de `valor` (coalesce que prioriza o líquido).
     * Defensivo: `Number(r.bxaMnyValor ?? 0)` — uma baixa com `bxaMnyValor`
     * null/ausente (permuta exótica) NUNCA soma `null` em `pagoBRL` (default 0;
     * watchlist: principal-pago=0, título permanece no relatório — mais seguro
     * p/ exposição cambial).
     */
    bxaMnyValor: number;
    /**
     * Plano financeiro da baixa (`gerNum` no wire). Identifica o tipo da baixa:
     * banco vs. permuta vs. conta transitória. Capturado para que a regra
     * `valor-permutar-ponto-no-tempo` possa filtrar permutas (`gerNum=21`
     * "FORNECEDORES EXTERIOR - POR ENCOMENDA" no lado a-pagar) das baixas
     * bancárias normais. Defaulta para 0 quando ausente.
     */
    gerNum: number;
}

/**
 * Conexos ERP títulos / variação-cambial family (`com308` + the per-document
 * `com298/{docCod}` detail): título aggregate detail, títulos a-pagar and
 * título baixas. Owns the `mapDetalheTitulos` mapper and the moeda-negociada
 * helpers. Shares auth + pagination via `ConexosBaseClient`.
 *
 * Behaviour is IDENTICAL to the former `ConexosClient` methods of the same
 * name — only the owning class changed (CC-2 split by endpoint family).
 */
@singleton()
@injectable()
export default class ConexosTitulosClient {
    private base: ConexosBaseClient;

    constructor(@inject(ConexosBaseClient) base: ConexosBaseClient) {
        this.base = base;
    }

    /**
     * Fetches the per-document aggregate for a single PROFORMA via
     * `GET /com298/{docCod}` (detail endpoint). Returns BOTH the literal
     * `mnyTitPermutar` ("saldo a permutar disponível" mirrored from the
     * Conexos UI — NOT the residual FIFO of FM/JVE; see regra
     * `valor-permutar-ponto-no-tempo`) AND the derived paid status.
     *
     * **Why fan-out (Addendum #8 ADR-0020, 2026-06-01):** the list endpoint
     * `com298/list` returns `mnyTitPermutar: null` in production (validated
     * via curl real 2026-06-01 vs `GET /com298/21841` which returns 44917.24).
     * The SAME gap applies to the paid-status fields: `mnyTitAberto`/
     * `mnyTitPago` come back NULL on `com298/list` but are populated on the
     * detail (probe real 2026-06-18, filCod=2: doc 26471 `mnyTitAberto`=
     * 384119.95 ⇒ não pago; doc 24166 `mnyTitAberto`=0 ⇒ totalmente pago).
     * So Gate 3 (TOTALMENTE PAGO) must read `pago` from HERE, not the list row.
     *
     * **Paid rule (unchanged ontology):** TOTALMENTE PAGO ⟺ `mnyTitAberto === 0`
     * — same predicate `isPago` already checks first. When `mnyTitAberto` is a
     * finite number → `pago = (mnyTitAberto === 0)`; when the field is absent/
     * null/non-numeric → `pago = undefined` (conservative: caller's Gate 3
     * reprova; NEVER inferred as paid).
     *
     * **Consumers:** `EleicaoPermutasService` (Gate 2 `valorPermutar > 0` +
     * Gate 3 `pago`). One call per PROFORMA candidate. Caller is expected to
     * cache by `docCod` per execution to avoid redundant calls.
     *
     * @returns `{ valorPermutar?, pago?, valorPermutado? }` — fields independently
     *          optional (a finite number / boolean when derivable; `undefined`
     *          otherwise). `valorPermutado` (mnyTitPermuta — "Valor Permutado")
     *          lets the caller distinguish a paid title with no permuta balance
     *          BECAUSE it was already permuted (valorPermutado > 0) from one that
     *          simply never had a balance (valorPermutado 0/undefined).
     */
    public getDetalheTitulos = async (params: {
        docCod: string;
        filCod: number;
    }): Promise<{
        valorPermutar?: number;
        pago?: boolean;
        valorPermutado?: number;
        valorTotal?: number;
        valorAberto?: number;
    }> => {
        const { docCod, filCod } = params;
        try {
            // P0-3 — wrapped in the same RetryExecutor as every other Conexos
            // call (7/8→8/8 endpoints retried). A transient 5xx/network blip on
            // the detail fetch no longer silently drops the candidate.
            return await this.base.runWithRetry(async () => {
                let detail: Record<string, unknown> | undefined;
                try {
                    detail = await this.base.getGeneric<Record<string, unknown>>(
                        `com298/${docCod}`,
                        { filCod },
                    );
                } catch (err) {
                    // Conexos quirk (observed 2026-06-01 on docCod=10649): the
                    // detail endpoint can answer HTTP 400 `type=VALIDATION`
                    // while still returning the document inside
                    // `error.response.data.responseData`. That is a LEGITIMATE
                    // response (not a blip) — extract the aggregate and succeed
                    // WITHOUT retrying. Any other error propagates to the
                    // RetryExecutor (retry → ConexosError if exhausted).
                    const ax = err as {
                        response?: {
                            status?: number;
                            data?: { responseData?: Record<string, unknown> };
                        };
                    };
                    const responseData = ax.response?.data?.responseData;
                    if (
                        ax.response?.status === 400 &&
                        responseData &&
                        typeof responseData === 'object'
                    ) {
                        return this.mapDetalheTitulos(responseData);
                    }
                    throw err;
                }
                if (!detail || typeof detail !== 'object') return {};
                return this.mapDetalheTitulos(detail);
            });
        } catch (cause) {
            // Retries exhausted on a transient failure — surface a TYPED error
            // (NÃO `return {}` silencioso). The caller (EleicaoPermutas) maps
            // this to `MOTIVO_BLOQUEIO.DETAIL_INDISPONIVEL`, distinto de uma
            // reprovação de gate legítima (`falha-gate`).
            throw new ConexosError({ endpoint: `com298/${docCod}`, priCod: docCod, cause });
        }
    };

    public listTitulosAPagar = async (params: {
        docCod: string;
        filCod: number;
    }): Promise<TituloAPagar[]> => {
        const { docCod, filCod } = params;
        const rows = await this.base.callList<Array<Record<string, unknown>>>(
            `com308/financeiroAPagar/list/${docCod}`,
            {
                // v0.5 (variacao-cambial, 2026-05-28 — bug-fix 2026-05-29):
                // Conexos `com308/financeiroAPagar/list/<docCod>` requires the
                // full boilerplate body — `serviceName: "com308.finTituloFin"`
                // (NOT plain `"com308"` → 400 VALIDATION), `pageNumber`,
                // `pageSize`, `orderList`. Same shape as the working com311
                // call above. Confirmed against Yuri's curl fixture (interview
                // 2026-05-28, docCod=24107).
                fieldList: [
                    'titCod',
                    'titFltTaxaMneg',
                    'titMnyValorMneg',
                    'titMnyValor',
                    // `titMnyTotPago` — valor já pago do título. Aceito no
                    // fieldList explícito (sonda 2026-08-28); é a fonte do
                    // `pago` da invoice, já que o com298/list não traz saldo.
                    'titMnyTotPago',
                    'moeCodMneg',
                    'moeEspNome',
                ],
                filterList: { 'titVldStatus#EQ': '1' },
                serviceName: 'com308.finTituloFin',
                pageNumber: 1,
                pageSize: 100,
                orderList: {
                    orderList: [{ propertyName: 'titCod', order: 'asc' }],
                },
            },
            `com308/financeiroAPagar/list/${docCod}`,
            undefined,
            { filCod },
        );
        return rows.map<TituloAPagar>((r) => {
            const valorNegociado = this.base.parseOptionalNumber(r.titMnyValorMneg);
            const taxa = this.base.parseOptionalNumber(r.titFltTaxaMneg);
            const moedaCod = this.base.parseOptionalNumber(r.moeCodMneg);
            const moedaNome = r.moeEspNome != null ? String(r.moeEspNome) : undefined;
            const valorBrl = this.base.parseOptionalNumber(r.titMnyValor);
            const valorPago = this.base.parseOptionalNumber(r.titMnyTotPago);
            return {
                titCod: String(r.titCod),
                ...(valorNegociado !== undefined ? { valorNegociado } : {}),
                ...(taxa !== undefined ? { taxa } : {}),
                ...(moedaCod !== undefined ? { moedaCod } : {}),
                ...(moedaNome !== undefined ? { moedaNome } : {}),
                ...(valorBrl !== undefined ? { valorBrl } : {}),
                ...(valorPago !== undefined ? { valorPago } : {}),
            };
        });
    };

    /**
     * Lists baixas (discharge events) of an Invoice/Proforma título via
     * `POST com308/financeiroAPagar/baixas/list/<docCod>/<titCod>/<vldCheck>`
     * with the canonical Conexos filter body. Empty bodies trigger HTTP 400
     * `NotNull` (Hibernate validation); the request must always include the
     * `borVldFinalizado` filter and an `orderList`. Mirrors the contract of
     * the sibling com311 endpoint discovered on 2026-05-08.
     */
    public listBaixasTitulo = async (params: {
        docCod: string;
        titCod: string;
        vldCheck?: number;
        filCod: number;
    }): Promise<BaixaTitulo[]> => {
        const { docCod, titCod, vldCheck = 0, filCod } = params;
        const rows = await this.base.paginate<Record<string, unknown>>({
            endpoint: `com308/financeiroAPagar/baixas/list/${docCod}/${titCod}/${vldCheck}`,
            bodyBase: {
                fieldList: [],
                filterList: {
                    'borVldFinalizado#IN': [1],
                },
                orderList: {
                    orderList: [{ propertyName: 'borCod', order: 'asc' }],
                },
            },
            opts: { filCod },
        });
        return rows.map<BaixaTitulo>((r) => ({
            borDtaMvto: this.base.parseDate(r.borDtaMvto),
            valor: Number(r.valor ?? r.borVlrMvto ?? r.bxaMnyLiquido ?? r.bxaMnyValor ?? 0),
            // Principal puro (BRL @ câmbio de contrato) como campo dedicado,
            // independente do coalesce de `valor` (que prioriza o líquido).
            // Insumo do saldo residual sobre o principal (Addendum 2026-06-08 #1).
            // Default defensivo 0 — nunca soma null em pagoBRL.
            bxaMnyValor: Number(r.bxaMnyValor ?? 0),
            gerNum: Number(r.gerNum ?? 0),
        }));
    };

    /**
     * Maps a com298 detail payload (or the 400-quirk `responseData`) into the
     * aggregate `{ valorPermutar?, pago?, valorPermutado? }`. `pago` is derived
     * from `mnyTitAberto` per the paid rule (=== 0 ⇒ true; > 0 ⇒ false; absent/
     * non-numeric ⇒ undefined — conservative, never inferred as paid).
     * `valorPermutado` is the literal `mnyTitPermuta` ("Valor Permutado" in the
     * RESUMO DOS TÍTULOS — probe real 2026-06-18 doc 8266: pago 100% permutado).
     */
    private mapDetalheTitulos = (
        detail: Record<string, unknown>,
    ): {
        valorPermutar?: number;
        pago?: boolean;
        valorPermutado?: number;
        valorTotal?: number;
        valorAberto?: number;
    } => {
        const valorPermutar = this.base.parseOptionalNumber(detail.mnyTitPermutar);
        const valorPermutado = this.base.parseOptionalNumber(detail.mnyTitPermuta);
        // `mnyTitValor` (face) e `mnyTitAberto` (saldo em aberto) — identidade
        // mnyTitValor = mnyTitPago + mnyTitAberto. Alimentam o "progresso de
        // pagamento" dos bloqueados por `nao-pago` (% pago + quanto falta).
        const valorTotal = this.base.parseOptionalNumber(detail.mnyTitValor);
        const valorAberto = this.base.parseOptionalNumber(detail.mnyTitAberto);
        const pago = valorAberto === undefined ? undefined : valorAberto === 0;
        return {
            ...(valorPermutar !== undefined ? { valorPermutar } : {}),
            ...(pago !== undefined ? { pago } : {}),
            ...(valorPermutado !== undefined ? { valorPermutado } : {}),
            ...(valorTotal !== undefined ? { valorTotal } : {}),
            ...(valorAberto !== undefined ? { valorAberto } : {}),
        };
    };
}
