import { inject, injectable, singleton } from 'tsyringe';
import { z } from 'zod';
import {
    type BorderoAPagar,
    CHAVE_PIX_TIPO_POR_CIX_VLD_TIPO,
    type ChavePixFavorecido,
    type DuplicateCandidate,
    type LeituraTitulo,
    type LoteSispag,
    MODALIDADE,
    type Modalidade,
    type TituloAPagar,
    type ContaCorrentePagadora,
    type ContaFavorecido,
} from '../interface/sispag/SispagInterface.js';
import Logger from '../libs/logger/Logger.js';
import ConexosBaseClient from './ConexosBaseClient.js';

/**
 * ConexosSispagClient — leitura da superfície de PAGAMENTOS do Conexos (Escopo II).
 *
 * READ-ONLY por contrato: só usa `listGenericPaginated` (protocolo de query do
 * Conexos). Nenhuma escrita (`gerarRemessa`/`finalizarLote`/`baixas` ficam FORA
 * deste client — são Fatia 3, gated). Espelha o padrão dos demais Conexos*Client
 * (composição de `ConexosBaseClient`, Zod no boundary).
 *
 * Fontes (confirmadas em produção via probe read-only):
 *   - `fin064/list` → carteira de títulos a pagar
 *   - `fin015/list` → lotes SISPAG nativos
 *   - `fin010/list` (borVldTipo=2) → borderôs a-pagar (baixa)
 */

const PAGE_SIZE = 200;

/**
 * Coerção tolerante de número (aceita string numérica; senão `undefined`).
 *
 * O `preprocess` é OBRIGATÓRIO e não cosmético: `z.coerce.number()` faz `Number(null) === 0`,
 * e o `fin064` manda `null` — não ausente — nos campos que vêm do LEFT JOIN do item SISPAG.
 * Sem ele, `null` vira um número VÁLIDO e dois defeitos nascem calados:
 *
 *   - `itsVldModalidade: null` → `0`, que passa em `!== undefined` → `temModalidade` sempre
 *     true → `prontoParaRemessa` sempre true. O aviso "falta cadastro?" da tela NUNCA chegou
 *     a aparecer em produção. Diagnóstico em `sispag-remessa-ground-truth-followups.md`.
 *   - `titDtaVencimento: null` → `0` = epoch. Pior que feio: ordena no TOPO da carteira (e come
 *     o cap de 5000 títulos), vira "vencido 20700d" na tela, infla o KPI de vencidos e — se a
 *     analista incluir o título num lote à mão — sai como `itsDtaPgto: 0` na remessa, violando
 *     a regra R2 do ERP (data de débito ≤ menor vencimento) com `MODEL_INCONSISTENCY`.
 *
 * É o mesmo `preprocess`, pela mesma razão medida, do `ConexosExtratoClient` (`fin095`).
 */
const numOpt = z.preprocess(
    (v) => (v === null || v === '' ? undefined : v),
    z.coerce.number().optional().catch(undefined),
);
const strOpt = z
    .union([z.string(), z.number()])
    .transform((v) => String(v))
    .optional()
    .catch(undefined);
const boolFromFlag = z
    .union([z.number(), z.string(), z.boolean()])
    .transform((v) => v === 1 || v === '1' || v === true)
    .optional()
    .catch(false);

const tituloRowSchema = z
    .object({
        docCod: z.union([z.string(), z.number()]).transform(String),
        titCod: z.union([z.string(), z.number()]).transform(String).optional().catch('1'),
        dpeNomPessoa: strOpt,
        dpeNomPessoaFor: strOpt,
        titMnyValor: numOpt,
        moeEspSigla: strOpt,
        titDtaVencimento: numOpt,
        vldLib: boolFromFlag,
        vldPago: boolFromFlag,
        bncDesNome: strOpt,
        titNumRemessa: strOpt,
        pesCod: strOpt,
        // O `fin064` devolve `pesCod` VAZIO e o favorecido em `pesCodFor` (fixtures reais de
        // 2026-08-24/25). Sem o fallback, oferta de TED/PIX e titularidade não acham ninguém.
        pesCodFor: strOpt,
        tpdCod: strOpt,
        // sinais de "pronto para remessa" (informativo) — o que o fin064 já traz.
        itsVldModalidade: numOpt,
        pctNumBanco: strOpt,
        pctEspNumContaBanc: strOpt,
        titEspCodbar: strOpt,
        itsDesChavePix: strOpt,
    })
    .passthrough();

type TituloRow = z.infer<typeof tituloRowSchema>;

/**
 * `vldPago` ESTRITO para a sincronização do lote (I11c, ADR-0055). O `boolFromFlag` da carteira
 * faz `.catch(false)` — campo ilegível vira "não pago" —, o que lá é inofensivo (o título some da
 * carteira de qualquer jeito) e aqui seria errado: "não sei" viraria "não pago" e decidiria o
 * lote. Aqui só 1/'1'/true e 0/'0'/false são reconhecidos; o resto é ilegível.
 */
const vldPagoEstrito = z.union([
    z.literal(1).transform(() => true),
    z.literal('1').transform(() => true),
    z.literal(true),
    z.literal(0).transform(() => false),
    z.literal('0').transform(() => false),
    z.literal(false),
]);

/** Página da leitura de duplicidade (ADR-0063): grande, porque a janela começa em 2026-01-01. */
const DUPLICIDADE_PAGE_SIZE = 1000;
/** Teto de páginas por filial — 50 mil títulos; acima disso algo está errado no filtro. */
const DUPLICIDADE_MAX_PAGINAS = 50;

/**
 * Linha do fin064 lida pela verificação de duplicidade (I13c–e). `docCod` é obrigatório (sem ele
 * não há o que comparar); o resto é tolerante — campo ilegível vira ausente, não derruba a linha.
 */
const duplicidadeRowSchema = z
    .object({
        docCod: z.union([z.string(), z.number()]).transform(String),
        titCod: z.union([z.string(), z.number()]).transform(String).optional().catch('1'),
        pesCod: strOpt,
        pesCodFor: strOpt,
        docEspNumero: strOpt,
        dpeNomPessoa: strOpt,
        dpeNomPessoaFor: strOpt,
        titMnyValor: numOpt,
        titDtaVencimento: numOpt,
        vldPago: boolFromFlag,
        docTip: strOpt,
        docVldTipo: strOpt,
        tpdCod: strOpt,
    })
    .passthrough();

/** Linha do fin064 lida pela sincronização: só o que prova (ou não) o pagamento. */
const situacaoTituloSchema = z
    .object({
        docCod: z.union([z.string(), z.number()]).transform(String),
        titCod: z.union([z.string(), z.number()]).transform(String).optional().catch('1'),
        vldPago: z.unknown(),
        // "Valor em Aberto"/"Valor Pago" por linha. Nos fixtures reais de 2026-08-24/25 os
        // `titMny*` vêm NULL e os `total*` vêm preenchidos — daí a ordem de preferência.
        totalAberto: numOpt,
        titMnyAberto: numOpt,
        totalPago: numOpt,
        titMnyTotPago: numOpt,
    })
    .passthrough();

const loteRowSchema = z
    .object({
        flpCod: z.coerce.number(),
        bncDesNome: strOpt,
        conta: strOpt,
        layoutConta: strOpt,
        flpVldStatus: numOpt,
        flpVldConfEnvio: boolFromFlag,
        flpVldRet: boolFromFlag,
        titulosCount: numOpt,
        soma: numOpt,
        itensRetorno: numOpt,
        usnDesNomeFin: strOpt,
        flpDtaCredito: numOpt,
    })
    .passthrough();

const borderoRowSchema = z
    .object({
        borCod: z.coerce.number(),
        gerDes: strOpt,
        vlrTotalLiquido: numOpt,
        borDtaMvto: numOpt,
        borVldFinalizado: numOpt,
        vldHasRemessaPgto: boolFromFlag,
        vldHasBaixa: boolFromFlag,
    })
    .passthrough();

/**
 * Chave PIX do cadastro da pessoa (`cmn025/cmnPessoasPix`). Linha sem `cixCod` numérico ou
 * sem chave é descartada: um destino de pagamento sem identidade não é um destino.
 */
const chavePixRowSchema = z
    .object({
        cixCod: z.coerce.number().int(),
        cixDesChave: z.string().trim().min(1),
        cixVldTipo: numOpt,
        cixVldSituacao: numOpt,
        cixVldDefault: numOpt,
        pesCod: z.union([z.string(), z.number()]).transform(String).optional(),
    })
    .passthrough();

/**
 * Nome do campo do CPF/CNPJ na linha da pessoa do `cmn025/list`.
 *
 * `pdcDocFederal` ("Doc. Federal") é o campo do schema `CmnPessoas` (`docs/conexos-api/020-cmn0.json`)
 * e o mesmo que `FinTitulo` e `CmnPessoasCtcorr` usam para o documento da pessoa. O palpite
 * anterior (`pesNumCpfCnpj`) não existe no schema. Falta ver o valor vivo no teste
 * supervisionado (checklist, passo 7). Campo ausente devolve `undefined` e a titularidade
 * (I10i) falha FECHADA.
 */
export const CAMPO_DOCUMENTO_FAVORECIDO = 'pdcDocFederal';

/** CPF (11) ou CNPJ (14) só dígitos. Qualquer outra coisa não é documento. */
const documentoSchema = z.preprocess(
    (v) => (typeof v === 'string' || typeof v === 'number' ? String(v).replace(/\D/g, '') : v),
    z.string().regex(/^(\d{11}|\d{14})$/),
);

@singleton()
@injectable()
export default class ConexosSispagClient {
    public constructor(@inject(ConexosBaseClient) private readonly base: ConexosBaseClient) {}

    /**
     * Marcadores MEDIDOS de recusa de FILTRO pelo Conexos. O ERP não tem um código próprio
     * para "não entendi esse filtro"; o que ele tem, e está medido, é nomear o filtro em
     * português no corpo do 400:
     *   - `Generic.REQUIRED_FILTER_ERROR` (fin052, fin134, fin095, NdeFiscal);
     *   - `"O filtro 'bncCod' é requerido"` / `"O filtro 'fbeEspCod' não foi encontrado,
     *     ou seu tipo de filtro não é o especificado"` (probe fin052, 2026-07-11).
     */
    private static readonly MARCADORES_DE_FILTRO: readonly string[] = [
        'required_filter_error',
        'filtro',
    ];

    /** Texto do corpo do erro em minúsculas — `undefined` se não houver corpo legível. */
    private static corpoDoErro = (data: unknown): string | undefined => {
        if (data === null || data === undefined) return undefined;
        try {
            const texto = typeof data === 'string' ? data : JSON.stringify(data);
            return texto !== undefined && texto.length > 0 ? texto.toLowerCase() : undefined;
        } catch {
            return undefined;
        }
    };

    /**
     * `true` só quando o corpo do 400 diz que o problema foi o FILTRO — o único caso em que
     * reler sem filtro é um fallback legítimo. `authenticatedPost` re-lança o erro axios cru,
     * então `response.status` e `response.data` chegam aqui intactos.
     *
     * ⚠️ Antes bastava `status === 400`, e isso era largo demais em cima de uma premissa que
     * NUNCA foi observada. O que está medido sobre filtros no Conexos é:
     *   - filtro DESCONHECIDO é silenciosamente IGNORADO (comportamento Hibernate) — não dá 400;
     *   - coluna NÃO-FILTRÁVEL (`mnyTitAberto#GT`, `pago#NE`) responde **HTTP 500**, não 400;
     *   - o único 400 de filtro medido é o filtro OBRIGATÓRIO ausente, e ele SE NOMEIA no corpo.
     * Ou seja: a maioria dos 400 que chegavam aqui eram outra coisa (body malformado, drift de
     * schema, sessão), e cada um deles virava uma releitura AMPLA — milhares de linhas sem o
     * recorte de vencimento — apresentada como se fosse a carteira normal. Fail-closed: 400 sem
     * corpo, ou com corpo que não fala de filtro, PROPAGA. Fecha o card `rh-1`.
     *
     * `camposFiltrados` são os campos que ESTA chamada mandou (sem o `#OP`): se o ERP nomear um
     * deles, é recusa de filtro mesmo que a frase mude de forma numa versão futura.
     */
    private isFilterRejected = (err: unknown, camposFiltrados: readonly string[]): boolean => {
        if (typeof err !== 'object' || err === null) return false;
        const response = (err as { response?: { status?: number; data?: unknown } }).response;
        if (response?.status !== 400) return false;
        const corpo = ConexosSispagClient.corpoDoErro(response.data);
        // 400 sem corpo legível não AFIRMA que o filtro foi recusado — e o fallback só se
        // justifica por uma afirmação. Na dúvida, propaga.
        if (corpo === undefined) return false;
        return (
            ConexosSispagClient.MARCADORES_DE_FILTRO.some((m) => corpo.includes(m)) ||
            camposFiltrados.some((campo) => corpo.includes(campo.toLowerCase()))
        );
    };

    /** Body de query padrão do Conexos (`/list`). */
    private listBody = (
        serviceName: string,
        filterList: Record<string, unknown> = {},
        pageSize = PAGE_SIZE,
    ): Record<string, unknown> => ({
        fieldList: [],
        filterList,
        serviceName,
        pageNumber: 1,
        pageSize,
    });

    /** Mapeia uma linha do `fin064` para `TituloAPagar` (compartilhado por list/get). */
    private mapTitulo = (r: TituloRow, filCod: number): TituloAPagar => {
        // Formas de pagamento DISPONÍVEIS (A2 opção B).
        //
        // ⚠️ `pctNumBanco`/`pctEspNumContaBanc` NÃO servem para isto. Sondagem read-only
        // (2026-08-20) mediu 0% de preenchimento em 561 títulos de HML e 2000 de PRD: no
        // `fin064` os campos `pct*`/`its*` são um LEFT JOIN no ITEM SISPAG e só populam
        // depois que o título entra num lote. A conta do favorecido mora em
        // `CmnPessoasCtcorr` (`cmn025/ctcorr/list`) — ver `listContasFavorecido`.
        // Consequência: derivar TED/CRÉDITO daqui devolvia SEMPRE lista vazia.
        //
        // ⚠️ `titEspCodbar` NÃO serve para detectar boleto. Sondagem read-only de 2026-08-27
        // mediu 0% de preenchimento em PRD — no `fin064` (2000 títulos), no grid de pendentes
        // do `fin015` (2173) e no `com308` (50). O código de barras não está no título em
        // momento algum: ele chega ao item pela associação do boleto DDA (`fin124`), e o único
        // sinal prévio é o flag `titVldReflexoDdaAssoc` do grid de pendentes — lido pela
        // ingestão (`ConexosSispagWriteClient.listarTitulosComBoletoDda`) e persistido em
        // `titulo_a_pagar.tem_boleto`. Ver `ontology/_inbox/sispag-boleto-dda-sondagem.md`.
        //
        // Aqui `temBoleto` nasce `false` de propósito: este mapper lê o `fin064` e o `fin064`
        // não sabe de boleto. Quem sabe sobrescreve depois.
        const temBoleto = false;
        const temPix = Boolean(r.itsDesChavePix);
        const temContaBanco = false;
        const modalidadesDisponiveis: Modalidade[] = [];
        if (temBoleto) modalidadesDisponiveis.push(MODALIDADE.BOLETO);
        if (temPix) modalidadesDisponiveis.push(MODALIDADE.PIX);
        if (temContaBanco) {
            // CRÉDITO EM CONTA fora da oferta (2026-09-28) — ver `modalidadesDisponiveisDoLote`.
            modalidadesDisponiveis.push(MODALIDADE.TED);
        }
        const temModalidade = r.itsVldModalidade !== undefined;
        // `prontoParaRemessa` é TRI-ESTADO, e o terceiro estado é o que o `fin064` quase sempre
        // tem a dizer: NÃO SEI. Desconhecido não é `false`.
        //
        // Com o `numOpt` consertado, os três termos de destino que este mapper enxerga são
        // `temBoleto` (false fixo — ADR-0040), `temContaBanco` (false fixo — a conta mora em
        // `cmn025/ctcorr`) e `temPix`/`temModalidade`, ambos do LEFT JOIN `its*`, medido em 0%
        // de preenchimento no `fin064` (561 títulos HML, 2000 PRD). Ou seja: a expressão que
        // antes era sempre `true` passaria a ser sempre `false` — e carimbar "falta cadastro?"
        // em 100% da carteira de pagamentos é a mesma mentira com o sinal trocado, agora com
        // fadiga de alarme numa tela onde o alarme deveria significar algo.
        //
        // Então: `true` quando este read de fato viu um destino; `undefined` quando não viu —
        // e aí a tela fica calada (o badge dispara em `=== false`). Quem PODE afirmar é a
        // leitura ao vivo do cadastro do favorecido (`modalidadesDisponiveisDoLote`) e a
        // validação do envio, que é autoritativa.
        const prontoParaRemessa =
            temBoleto || temPix || temContaBanco || temModalidade ? true : undefined;
        return {
            docCod: r.docCod,
            titCod: r.titCod ?? '1',
            filCod,
            credor: r.dpeNomPessoa ?? r.dpeNomPessoaFor,
            valor: r.titMnyValor ?? 0,
            moeda: r.moeEspSigla,
            vencimento: r.titDtaVencimento,
            liberado: r.vldLib ?? false,
            pago: r.vldPago ?? false,
            banco: r.bncDesNome,
            numRemessa: r.titNumRemessa,
            pesCod: r.pesCod ?? r.pesCodFor,
            tpdCod: r.tpdCod,
            prontoParaRemessa,
            temBoleto,
            modalidadesDisponiveis,
        };
    };

    /**
     * Títulos a pagar de uma filial (`fin064/list`). Filtra server-side por
     * NÃO-pago + vencimento numa janela (default: dos últimos 30 dias em diante),
     * para o painel focar no que é relevante (a vencer + vencidos recentes) — sem
     * o filtro, o `fin064` devolve stragglers de anos atrás. Se o Conexos recusar
     * o filtro — 400 cujo CORPO nomeia o filtro —, cai para busca sem filtro (o
     * serviço filtra em memória). Qualquer outro erro, 400 genérico incluído,
     * propaga: não mascarar uma falha do ERP com uma leitura ampla de milhares
     * de linhas que parece a carteira normal. Ver `isFilterRejected`.
     */
    public listTitulosAPagar = async (
        filCod: number,
        opts: { minVencimento?: number; maxVencimento?: number } = {},
    ): Promise<TituloAPagar[]> => {
        // `docVldPrevisao#EQ: 0` exclui documentos de PREVISÃO. Sem isso a carteira mostra
        // títulos que o `fin015` NUNCA aceita num lote (previsão não se paga) — a analista
        // monta o lote, define modalidade, finaliza, e só descobre na geração da remessa.
        // Foi o que aconteceu em HML: a carteira inteira era previsão (docVldPrevisao=1,
        // docVldTipo=9), e o erro só aparecia depois de o lote nativo já ter sido criado.
        const filtered: Record<string, unknown> = { 'vldPago#EQ': 0, 'docVldPrevisao#EQ': 0 };
        if (opts.minVencimento !== undefined) {
            filtered['titDtaVencimento#GE'] = opts.minVencimento;
        }
        if (opts.maxVencimento !== undefined) {
            filtered['titDtaVencimento#LE'] = opts.maxVencimento;
        }
        let rows: Record<string, unknown>[];
        try {
            const res = await this.base.runWithRetry(() =>
                this.base.listGenericPaginated<Record<string, unknown>>(
                    'fin064/list',
                    this.listBody('fin064', filtered, 1000),
                    { filCod },
                ),
            );
            rows = res.rows;
        } catch (err) {
            // Os campos que mandamos, sem o `#OP` — é assim que o ERP os nomeia quando reclama.
            const camposFiltrados = Object.keys(filtered).map((k) => k.split('#')[0] ?? k);
            if (!this.isFilterRejected(err, camposFiltrados)) throw err;
            // Fallback NÃO-silencioso: se o Conexos passar a recusar o filtro de forma
            // sistemática (drift de schema no fin064), a leitura ampla vira sinal, não
            // um degrade oculto (o modo de falha que este fix fecha em 1º lugar).
            Logger.warn(
                `[SISPAG] fin064/list recusou o filtro (400) na filial ${filCod} — fallback para leitura sem filtro de vencimento`,
            );
            const res = await this.base.runWithRetry(() =>
                this.base.listGenericPaginated<Record<string, unknown>>(
                    'fin064/list',
                    this.listBody('fin064'),
                    { filCod },
                ),
            );
            rows = res.rows;
        }
        return rows.flatMap((row) => {
            const parsed = tituloRowSchema.safeParse(row);
            if (!parsed.success) return [];
            return [this.mapTitulo(parsed.data, filCod)];
        });
    };

    /**
     * Leitura pontual e AUTORITATIVA de um título a pagar (`fin064/list` filtrado
     * por `docCod`). Usada na inclusão em lote para validar elegibilidade (I2) e
     * capturar o snapshot de valor/venc/credor no instante — espelha a anti-drift
     * de Permutas. Retorna `null` se o título não existir na leitura.
     */
    public getTituloAPagar = async (
        filCod: number,
        docCod: string,
        titCod: string,
    ): Promise<TituloAPagar | null> => {
        const { rows } = await this.base.runWithRetry(() =>
            this.base.listGenericPaginated<Record<string, unknown>>(
                'fin064/list',
                this.listBody('fin064', { 'docCod#EQ': docCod }, 200),
                { filCod },
            ),
        );
        for (const row of rows) {
            const parsed = tituloRowSchema.safeParse(row);
            if (!parsed.success) continue;
            const r = parsed.data;
            if (r.docCod !== docCod || (r.titCod ?? '1') !== titCod) continue;
            return this.mapTitulo(r, filCod);
        }
        return null;
    };

    /**
     * Situação de pagamento de UM título para a sincronização do lote (L11, ADR-0055) — a prova
     * de nível 1: `vldPago = 1 ∧ aberto = 0`, de qualquer origem.
     *
     * Difere de `getTituloAPagar` em duas coisas, ambas de propósito:
     *   - **tri-estado**: campo ausente/ilegível, título que não veio, falha HTTP (rede, 4xx, 5xx)
     *     ou schema inválido devolvem `{ legivel: false }` — nunca "não pago" (I11c);
     *   - **não lança**: uma falha num título não derruba a sincronização do lote inteiro.
     *
     * Lê por `docCod` SEM o `vldPago#EQ: 0` da carteira — senão o título pago sumiria da resposta
     * justamente quando importa.
     */
    public lerSituacaoTitulo = async (
        filCod: number,
        docCod: string,
        titCod: string,
    ): Promise<LeituraTitulo> => {
        let rows: Record<string, unknown>[];
        try {
            const res = await this.base.runWithRetry(() =>
                this.base.listGenericPaginated<Record<string, unknown>>(
                    'fin064/list',
                    this.listBody('fin064', { 'docCod#EQ': docCod }, 200),
                    { filCod },
                ),
            );
            rows = res.rows ?? [];
        } catch (err) {
            return { legivel: false, motivo: this.motivoDeFalha(err) };
        }
        const linha = rows
            .map((row) => situacaoTituloSchema.safeParse(row))
            .find(
                (p) => p.success && p.data.docCod === docCod && (p.data.titCod ?? '1') === titCod,
            );
        if (linha?.success) return this.situacaoDaLinha(linha.data);
        return { legivel: false, motivo: `título ${docCod}/${titCod} não encontrado no fin064` };
    };

    /**
     * Títulos de UMA filial para a verificação de duplicidade (ADR-0063, I13c–e): `fin064` com
     * vencimento ≥ `desde`, **sem** filtro de `vldPago` (a FORTE compara inclusive contra título já
     * pago) e sem documento de previsão. Pagina de verdade: o `listGenericPaginated` devolve UMA
     * página, então lê até esgotar o `count` (ou a página vir menor que o tamanho pedido).
     *
     * Linha que não passa no Zod é descartada (não derruba a lista). Falha de rede/HTTP propaga:
     * quem chama trata como verificação PENDENTE (I13b, falha fechada) — nunca como "sem duplicata".
     *
     * Gap Q3: o filtro por favorecido NO SERVIDOR não foi medido (o `fin064` ignora em silêncio
     * filtro desconhecido e responde 500 a coluna não-filtrável; sondar PRD foi vedado nesta
     * entrega). Por isso a leitura é por filial e o recorte por favorecido é em memória
     * (`listTitulosFavorecidoParaDuplicidade`). A `validate-sispag-verificacoes-ted-pix-v1.ts`
     * mede o volume; trocar por filtro no servidor só com sonda que prove o filtro.
     */
    public listTitulosParaDuplicidade = async (
        filCod: number,
        desde: number,
    ): Promise<DuplicateCandidate[]> => {
        const filtro = { 'docVldPrevisao#EQ': 0, 'titDtaVencimento#GE': desde };
        const linhas: Record<string, unknown>[] = [];
        for (let pagina = 1; pagina <= DUPLICIDADE_MAX_PAGINAS; pagina += 1) {
            const page = await this.base.runWithRetry(() =>
                this.base.listGenericPaginated<Record<string, unknown>>(
                    'fin064/list',
                    {
                        ...this.listBody('fin064', filtro, DUPLICIDADE_PAGE_SIZE),
                        pageNumber: pagina,
                    },
                    { filCod },
                ),
            );
            const rows = page.rows ?? [];
            linhas.push(...rows);
            const total = Number(page.count);
            if (rows.length < DUPLICIDADE_PAGE_SIZE) break;
            if (Number.isFinite(total) && linhas.length >= total) break;
        }
        return linhas.flatMap((row) => {
            const parsed = duplicidadeRowSchema.safeParse(row);
            if (!parsed.success) return [];
            const candidato = this.candidatoDuplicidade(parsed.data, filCod);
            // Recorte também em memória: um filtro de data ignorado pelo ERP não alarga a janela.
            if (candidato.vencimento !== undefined && candidato.vencimento < desde) return [];
            return [candidato];
        });
    };

    /** O recorte por favorecido de `listTitulosParaDuplicidade` (em memória — ver gap Q3 lá). */
    public listTitulosFavorecidoParaDuplicidade = async (
        filCod: number,
        pesCod: string,
        desde: number,
    ): Promise<DuplicateCandidate[]> => {
        const alvo = pesCod.trim();
        return (await this.listTitulosParaDuplicidade(filCod, desde)).filter(
            (t) => t.favorecido === alvo,
        );
    };

    private candidatoDuplicidade = (
        r: z.infer<typeof duplicidadeRowSchema>,
        filCod: number,
    ): DuplicateCandidate => {
        // I13c: `pesCod`, e `pesCodFor` quando o `pesCod` vem vazio (o fin064 costuma mandar vazio).
        const favorecido = r.pesCod?.trim() || r.pesCodFor?.trim() || undefined;
        const credor = r.dpeNomPessoaFor ?? r.dpeNomPessoa;
        const docTipo = [r.docTip, r.docVldTipo, r.tpdCod].some((v) => v !== undefined)
            ? `${r.docTip ?? ''}/${r.docVldTipo ?? ''}/${r.tpdCod ?? ''}`
            : undefined;
        return {
            filCod,
            docCod: r.docCod,
            titCod: r.titCod ?? '1',
            ...(favorecido ? { favorecido } : {}),
            ...(credor ? { credor } : {}),
            numeroNota: (r.docEspNumero ?? '').replace(/\D/g, '').replace(/^0+/, ''),
            valorCentavos: Math.round((r.titMnyValor ?? 0) * 100),
            ...(r.titDtaVencimento !== undefined ? { vencimento: r.titDtaVencimento } : {}),
            pago: r.vldPago ?? false,
            ...(docTipo ? { docTipo } : {}),
        };
    };

    /** Tri-estado de UMA linha: campo ilegível ou ausente é "não sei", nunca "não pago". */
    private situacaoDaLinha = (r: z.infer<typeof situacaoTituloSchema>): LeituraTitulo => {
        const vldPago = vldPagoEstrito.safeParse(r.vldPago);
        if (!vldPago.success) return { legivel: false, motivo: 'vldPago ilegível no fin064' };
        const aberto = r.totalAberto ?? r.titMnyAberto;
        if (aberto === undefined) {
            return { legivel: false, motivo: 'valor em aberto ausente no fin064' };
        }
        const valorPagoTitulo = r.totalPago ?? r.titMnyTotPago;
        return {
            legivel: true,
            vldPago: vldPago.data,
            aberto,
            ...(valorPagoTitulo !== undefined ? { valorPagoTitulo } : {}),
        };
    };

    /** Motivo legível de uma falha de leitura — só status e mensagem, nunca o erro cru. */
    private motivoDeFalha = (err: unknown): string => {
        const status = (err as { response?: { status?: number } })?.response?.status;
        const mensagem = err instanceof Error ? err.message : undefined;
        if (status !== undefined) return `HTTP ${status}${mensagem ? ` — ${mensagem}` : ''}`;
        return mensagem ?? 'falha de leitura';
    };

    /**
     * Contas correntes PAGADORAS de uma filial (`fin005/list`). É a origem do dinheiro e a
     * fonte da conta financeira (`gerNum`) que a conciliação contábil usa. Nunca fixar o
     * `ccoCod`: ele é relativo à filial (ver `ContaCorrentePagadora`).
     */
    public listContasCorrentes = async (filCod: number): Promise<ContaCorrentePagadora[]> => {
        const { rows } = await this.base.runWithRetry(() =>
            this.base.listGenericPaginated<Record<string, unknown>>(
                'fin005/list',
                this.listBody('fin005', {}, 100),
                { filCod },
            ),
        );
        return rows
            .map((r) => ({
                ccoCod: Number(r.ccoCod),
                bncCod: Number(r.bncCod),
                ...(r.ccoEspAgcod != null ? { agencia: String(r.ccoEspAgcod) } : {}),
                ...(r.ccoNumConta != null ? { numeroConta: Number(r.ccoNumConta) } : {}),
                ...(r.ccoEspDvconta != null ? { dvConta: String(r.ccoEspDvconta) } : {}),
                ...(r.gerNum != null ? { gerNum: Number(r.gerNum) } : {}),
                ...(r.gerDes != null ? { gerDes: String(r.gerDes) } : {}),
            }))
            .filter((c) => Number.isFinite(c.ccoCod));
    };

    /**
     * Contas correntes cadastradas de um favorecido (`cmn025/ctcorr/list`, schema
     * `CmnPessoasCtcorr`). É a fonte AUTORITATIVA do destino de pagamento — o `fin064`
     * não carrega isso (ver `mapTitulo`). O `pctCodSeq` devolvido aqui é o campo que o
     * `FinItemSispag` referencia no import do lote fin015.
     *
     * Devolve só contas ATIVAS (`pctVldStatus === 1`), com a conta DEFAULT
     * (`pctVldDefault === 1`) à frente — é a que a tela do ERP usa.
     */
    public listContasFavorecido = async (
        pesCod: string | number,
        filCod: number,
    ): Promise<ContaFavorecido[]> => {
        const { rows } = await this.base.runWithRetry(() =>
            this.base.listGenericPaginated<Record<string, unknown>>(
                'cmn025/ctcorr/list',
                this.listBody('cmn025', { 'pesCod#EQ': pesCod }, 50),
                { filCod },
            ),
        );
        return rows
            .filter((c) => Number(c.pctVldStatus) === 1)
            .map((c) => ({
                pctCodSeq: Number(c.pctCodSeq),
                banco: Number(c.pctNumBanco),
                bancoNome: c.bncDesNome != null ? String(c.bncDesNome) : undefined,
                agencia: c.pctEspNumAgencia != null ? String(c.pctEspNumAgencia) : undefined,
                conta: c.pctEspNumContaBanc != null ? String(c.pctEspNumContaBanc) : undefined,
                dvConta: c.pctEspDvconta != null ? String(c.pctEspDvconta) : undefined,
                padrao: Number(c.pctVldDefault) === 1,
            }))
            .sort((a, b) => Number(b.padrao) - Number(a.padrao));
    };

    /**
     * Chaves PIX ATIVAS do favorecido (`cmn025/cmnPessoasPix/list`, por `pesCod`), a DEFAULT
     * primeiro (ADR-0054 D4). É a fonte do PIX do cadastro — o `itsDesChavePix` do `fin064`
     * é LEFT JOIN no item SISPAG e vem vazio (0% medido).
     *
     * I10h: a chave é dado sensível. Linha descartada no boundary é CONTADA no log, nunca
     * ecoada.
     */
    public listChavesPixFavorecido = async (
        pesCod: string | number,
        filCod: number,
    ): Promise<ChavePixFavorecido[]> => {
        const { rows } = await this.base.runWithRetry(() =>
            this.base.listGenericPaginated<Record<string, unknown>>(
                'cmn025/cmnPessoasPix/list',
                this.listBody('cmn025', { 'pesCod#EQ': pesCod }, 50),
                { filCod },
            ),
        );
        let descartadas = 0;
        const chaves: ChavePixFavorecido[] = [];
        for (const row of rows) {
            const parsed = chavePixRowSchema.safeParse(row);
            if (!parsed.success) {
                descartadas += 1;
                continue;
            }
            const r = parsed.data;
            if (r.cixVldSituacao !== 1) continue;
            chaves.push({
                cixCod: r.cixCod,
                chave: r.cixDesChave,
                ...(r.cixVldTipo !== undefined &&
                CHAVE_PIX_TIPO_POR_CIX_VLD_TIPO[r.cixVldTipo] !== undefined
                    ? { tipo: CHAVE_PIX_TIPO_POR_CIX_VLD_TIPO[r.cixVldTipo] }
                    : {}),
                padrao: r.cixVldDefault === 1,
                pesCod: r.pesCod ?? String(pesCod),
            });
        }
        if (descartadas > 0) {
            Logger.warn(
                `[SISPAG] cmn025/cmnPessoasPix: ${descartadas} linha(s) fora do schema descartada(s) na filial ${filCod}`,
            );
        }
        return chaves.sort((a, b) => Number(b.padrao) - Number(a.padrao));
    };

    /**
     * CPF/CNPJ do favorecido (só dígitos), lido AO VIVO do cadastro da pessoa (`cmn025/list`,
     * por `pesCod`) para a titularidade do destino digitado (I10i). O `TituloAPagar` não o guarda.
     *
     * Nunca lança por dado: linha ausente, campo ausente ou valor que não é CPF/CNPJ devolve
     * `undefined` — e quem chama FALHA FECHADO (`DocumentoFavorecidoIndisponivelError`). Falha
     * de rede sobe normalmente.
     */
    public getDocumentoFavorecido = async (
        pesCod: string | number,
        filCod: number,
    ): Promise<string | undefined> => {
        const { rows } = await this.base.runWithRetry(() =>
            this.base.listGenericPaginated<Record<string, unknown>>(
                'cmn025/list',
                this.listBody('cmn025', { 'pesCod#EQ': pesCod }, 5),
                { filCod },
            ),
        );
        const pessoa = rows.find((r) => String(r.pesCod ?? '') === String(pesCod));
        if (!pessoa) return undefined;
        const parsed = documentoSchema.safeParse(pessoa[CAMPO_DOCUMENTO_FAVORECIDO]);
        return parsed.success ? parsed.data : undefined;
    };

    /**
     * Conjunto de `docCod` do EXTERIOR (`com298`, `ufEspSigla='EX'`) de uma filial — usado
     * pela ingestão para EXCLUIR títulos internacionais da carteira SISPAG (câmbio está
     * fora do escopo; é feito manualmente pela tesouraria, ver ADR-0021). O `fin064` não
     * traz `ufEspSigla`, por isso a leitura em massa no `com298`.
     */
    public listExteriorDocCods = async (filCod: number): Promise<Set<string>> => {
        const { rows } = await this.base.runWithRetry(() =>
            this.base.listGenericPaginated<Record<string, unknown>>(
                'com298/list',
                {
                    fieldList: ['docCod', 'ufEspSigla'],
                    filterList: { 'vldStatus#IN': ['1', '3'], 'ufEspSigla#LIKE': 'EX' },
                    serviceName: 'com298',
                    pageNumber: 1,
                    pageSize: 5000,
                },
                { filCod },
            ),
        );
        const set = new Set<string>();
        for (const r of rows) {
            if (r.docCod !== null && r.docCod !== undefined) set.add(String(r.docCod));
        }
        return set;
    };

    /**
     * Lotes SISPAG nativos de uma filial (`fin015/list`).
     *
     * `filCod#EQ` é OBRIGATÓRIO: o `filCod` de `opts` é o contexto da sessão, não um filtro.
     * Sem ele o ERP devolve lotes de TODAS as filiais — e como este método carimbava o
     * `filCod` do PARÂMETRO na linha de saída, um lote da filial 1 saía rotulado como da
     * filial que fez a consulta. No painel, que faz fan-out por filial, isso multiplicava
     * lotes alheios com o rótulo errado.
     *
     * O `flpCod` se repete entre filiais (é sequência por filial+banco), então rótulo errado
     * aqui não é cosmético: `findByChaveNativa` casa o retorno por `(fil, bnc, flp)`.
     */
    public listLotes = async (filCod: number): Promise<LoteSispag[]> => {
        const { rows } = await this.base.runWithRetry(() =>
            this.base.listGenericPaginated<Record<string, unknown>>(
                'fin015/list',
                this.listBody('fin015', { 'filCod#EQ': filCod }, 100),
                { filCod },
            ),
        );
        return rows.flatMap((row) => {
            const parsed = loteRowSchema.safeParse(row);
            if (!parsed.success) return [];
            const r = parsed.data;
            return [
                {
                    // Da LINHA, com o parâmetro só como rede: rotular errado aqui
                    // corromperia o casamento do retorno.
                    filCod: Number(row.filCod ?? filCod),
                    flpCod: r.flpCod,
                    banco: r.bncDesNome,
                    conta: r.conta,
                    layoutConta: r.layoutConta,
                    status: r.flpVldStatus ?? 0,
                    envioConfirmado: r.flpVldConfEnvio ?? false,
                    retornoProcessado: r.flpVldRet ?? false,
                    titulosCount: r.titulosCount ?? 0,
                    soma: r.soma ?? 0,
                    itensRetorno: r.itensRetorno ?? 0,
                    finalizadoPor: r.usnDesNomeFin,
                    dataCredito: r.flpDtaCredito,
                } satisfies LoteSispag,
            ];
        });
    };

    /** Borderôs a-pagar (baixa) de uma filial (`fin010/list`, borVldTipo=2). */
    public listBorderosAPagar = async (filCod: number): Promise<BorderoAPagar[]> => {
        const { rows } = await this.base.runWithRetry(() =>
            this.base.listGenericPaginated<Record<string, unknown>>(
                'fin010/list',
                this.listBody('fin010', { 'borVldTipo#EQ': 2 }, 100),
                { filCod },
            ),
        );
        return rows.flatMap((row) => {
            const parsed = borderoRowSchema.safeParse(row);
            if (!parsed.success) return [];
            const r = parsed.data;
            return [
                {
                    borCod: r.borCod,
                    filCod,
                    descricao: r.gerDes,
                    valor: r.vlrTotalLiquido ?? 0,
                    data: r.borDtaMvto,
                    finalizado: r.borVldFinalizado ?? 0,
                    temRemessa: r.vldHasRemessaPgto ?? false,
                    temBaixa: r.vldHasBaixa ?? false,
                } satisfies BorderoAPagar,
            ];
        });
    };
}
