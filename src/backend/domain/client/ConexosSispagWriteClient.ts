import { inject, injectable, singleton } from 'tsyringe';
import { z } from 'zod';
import ConexosError from '../errors/ConexosError.js';
import ErpPerguntaError from '../errors/ErpPerguntaError.js';
import type {
    ArquivoRemessa,
    CriarLoteParams,
    GerarRemessaParams,
    ImportarTitulosParams,
    LoteNativoCriado,
    LoteNativoEstado,
    RemessaGerada,
    TituloPendente,
} from '../interface/sispag/Fin015Write.js';
import { LOG_TYPE } from '../interface/log/LogInterface.js';
import LogService from '../service/LogService.js';
import ConexosBaseClient from './ConexosBaseClient.js';

/**
 * Zod no boundary da criação de lote (`POST /fin015`): o crítico é o `flpCod`
 * atribuído pelo ERP. O Conexos às vezes embrulha o registro em `.data` — o
 * preprocess desembrulha antes de exigir o id.
 */
const LOTE_CRIADO_SCHEMA = z
    .preprocess(
        (raw) => {
            const o = (raw ?? {}) as Record<string, unknown>;
            const inner = (o.data ?? o) as Record<string, unknown>;
            return inner;
        },
        z.object({ flpCod: z.coerce.number().int().positive() }),
    )
    .transform((o) => o.flpCod);

/** Resposta de sucesso genérica do Conexos (`{ valid:'SUCESSO', message }`). */
const SUCESSO_SCHEMA = z.object({
    valid: z.string().optional(),
    message: z.string().optional(),
});

/**
 * A ÚNICA pergunta do ERP que respondemos sozinhos.
 *
 * `FIN_041.EXISTE_CODIGO_BARRAS_ASSOCIADO_TITULO` é o ERP dizendo "achei o boleto DDA deste
 * título — uso?". Responder `YES` só anexa o código de barras que o próprio ERP casou; não
 * move dinheiro, não escolhe favorecido, não altera valor. Medido em HML (2026-08-27): o POST
 * que devolve a pergunta **não importa nada** — a pergunta é um pré-commit, não escrita parcial.
 *
 * Tudo o mais continua humano por doutrina (`ErpPerguntaError`). Em especial
 * `PESSOA_FAVORECIDA_SEM_CONTA_ATIVA_NO_BANCO_MODALIDADE_ALTERADA_TITULO_PROPRIO`, que ALTERA
 * A FORMA DE PAGAMENTO do título — decisão de quem opera. É allowlist por chave exata, e não
 * um `includes`, justamente para que uma pergunta nova nunca entre de carona.
 */
const PERGUNTA_AUTO_RESPONDIVEL = 'FIN_041.EXISTE_CODIGO_BARRAS_ASSOCIADO_TITULO';

/**
 * Boundary do grid de pendentes. Existe por um motivo específico: `titVldReflexoDdaAssoc` é o
 * ÚNICO sinal de "este pagamento tem boleto", e uma coerção tolerante (`?? 0`) o degradaria em
 * silêncio para `false` se o Conexos renomeasse o campo — reintroduzindo, num lugar novo, a
 * mesma classe de defeito que o ADR-0040 corrigiu (o `titEspCodbar` null em 100% que a
 * auto-detecção antiga lia sem nunca disparar).
 *
 * Por isso o campo é `z.union([literal(0), literal(1)])` e NÃO tem default: ausente ou com
 * outro valor, o `safeParse` falha e o chamador decide (hoje: conta como "não sei" e avisa),
 * em vez de a carteira inteira virar "sem boleto" como estado normal.
 *
 * O resto da linha vai `passthrough` — a identidade tem que seguir VERBATIM para o `importar`.
 */
const PENDENTE_DDA_SCHEMA = z
    .object({ titVldReflexoDdaAssoc: z.union([z.literal(0), z.literal(1)]) })
    .passthrough();

/**
 * Envelope de PERGUNTA do Conexos. O `id` é o que importa: a resposta vai num
 * `answers: Map<String,String>` chaveado por ELE (não pelo `key`) — descoberto em HML porque
 * mandar um array devolveu `Cannot deserialize LinkedHashMap<String,String> from Array value`.
 */
const QUESTION_SCHEMA = z.object({
    type: z.literal('QUESTION'),
    questions: z
        .array(
            z.object({
                // `id` é OBRIGATÓRIO: é a chave do map `answers`. Um envelope sem ele não é
                // auto-respondível, e é melhor o Zod recusar (→ pergunta humana) do que o
                // código construir `{ undefined: 'YES' }` e mandar isso ao ERP.
                // Fixture do wire real: `__fixtures__/2026-08-27-fin015-question-barcode.json`.
                id: z.string().min(1),
                key: z.string().optional(),
            }),
        )
        .min(1),
});

/**
 * ConexosSispagWriteClient — família de ESCRITA do `fin015` (Geração de Lotes
 * SISPAG / remessa `.REM`). É a 1ª superfície de escrita do SISPAG no Conexos e
 * QUEBRA a invariante I1 (read-only); espelha a doutrina de escrita irreversível
 * de `ConexosBaixaClient` (fin010):
 *   - escritas NÃO-idempotentes (`criarLote`, `importarTitulos`, `gerarRemessa`)
 *     usam `postGenericOnce` (sem 401-retry silencioso) e SEM RetryExecutor — um
 *     retry pós-timeout duplicaria lote/remessa. Tentativa ÚNICA.
 *   - leituras (`listarTitulosPendentes`, `listarArquivosRemessa`) usam
 *     `runWithRetry` (paridade com os reads).
 *   - toda falha vira `ConexosError`; o `userMessage` extrai a validação do ERP
 *     (`VALIDATION_LIST` → `messages[].vars.msg`; `VALIDATION` → item/constraint),
 *     p/ surfacar R1/R2 (data de débito) e "seqNum obrigatório".
 *
 * ⚠️ FERRAMENTA, não fluxo: este client NÃO é gated internamente (como o
 * `ConexosBaixaClient`). O gating de produção (`conexosWriteEnabled`/`conexosDryRun`),
 * a idempotência (ledger write-ahead) e a auditoria persistida são responsabilidade
 * do SERVIÇO de orquestração — que será modelado com o analista (fluxo real +
 * exceções Santander/internacional). Hoje o único caller é o harness HML guardado.
 */
@singleton()
@injectable()
export default class ConexosSispagWriteClient {
    public constructor(
        @inject(ConexosBaseClient) private readonly base: ConexosBaseClient,
        @inject(LogService) private readonly logService: LogService,
    ) {}

    /**
     * Extrai a mensagem de validação do corpo de erro do Conexos (2 formatos, ambos 400):
     *   - `VALIDATION_LIST`: `{ messages: [{ vars: { msg } }] }` (regra de negócio, ex. R1/R2).
     *   - `VALIDATION`: `{ itemMessages: [{ item, messages: [{ constraint }] }] }` (campo faltante).
     * Retorna `undefined` se não reconhecer o shape (o ConexosError usa a msg default).
     */
    private describeConexosValidation = (cause: unknown): string | undefined => {
        const data = (cause as { response?: { data?: unknown } })?.response?.data;
        if (!data || typeof data !== 'object') return undefined;
        const body = data as {
            type?: string;
            messages?: Array<{ vars?: { msg?: string }; message?: string }>;
            itemMessages?: Array<{ item?: string; messages?: Array<{ constraint?: string }> }>;
        };
        if (Array.isArray(body.messages) && body.messages.length > 0) {
            const msgs = body.messages
                .map((m) => m.vars?.msg ?? m.message)
                .filter((s): s is string => typeof s === 'string' && s.length > 0);
            if (msgs.length > 0) return msgs.join(' · ');
        }
        if (Array.isArray(body.itemMessages) && body.itemMessages.length > 0) {
            const fields = body.itemMessages
                .map((im) => {
                    const constraint = im.messages?.[0]?.constraint;
                    return im.item
                        ? `${im.item}${constraint ? ` (${constraint})` : ''}`
                        : undefined;
                })
                .filter((s): s is string => typeof s === 'string');
            if (fields.length > 0) return `Campos inválidos: ${fields.join(', ')}`;
        }
        return undefined;
    };

    /** Embrulha a falha em ConexosError com a validação do ERP no `message`, quando houver. */
    /**
     * Converte a falha do ERP no erro certo — e `QUESTION` NÃO é falha.
     *
     * O Conexos responde `{type:'QUESTION', questions:[{key, answerList:[YES, ABORT]}]}` quando
     * precisa de uma confirmação interativa. O caso mais provável em produção é
     * `FIN_041.PESSOA_FAVORECIDA_SEM_CONTA_ATIVA_NO_BANCO_...` — favorecido sem conta ativa no
     * banco do lote.
     *
     * Antes só o `sugerirRemessa` reconhecia isso; as 4 escritas embrulhavam em `ConexosError`
     * genérico, o ledger ia para `error`, e a retomada refazia o mesmo caminho até falhar de
     * novo. Do lado de quem opera, "o ERP quer uma confirmação" virava "o sistema quebrou".
     *
     * Detectar AQUI cobre todas as chamadas de uma vez, porque todo `catch` deste cliente
     * passa por este método.
     */
    private toConexosError = (endpoint: string, cause: unknown): Error => {
        const pergunta = this.perguntaDoErp(cause);
        if (pergunta) return new ErpPerguntaError({ ...pergunta, contexto: endpoint });
        return new ConexosError({
            endpoint,
            cause,
            message: this.describeConexosValidation(cause),
        });
    };

    /**
     * Ferramenta 1 — cria o lote nativo fin015 (`POST /fin015`) da conta pagadora.
     * Escrita NÃO-idempotente (criar 2× = 2 lotes) → `postGenericOnce`, tentativa única.
     * Provado ao vivo em HML (criou o flp 18). Retorna o `flpCod` atribuído pelo ERP.
     */
    public criarLote = async (params: CriarLoteParams): Promise<LoteNativoCriado> => {
        const { filCod, conta, dataDebito } = params;
        try {
            await this.base.ensureSid();
            const raw = await this.base.postGenericOnce<unknown>(
                'fin015',
                {
                    filCod,
                    bncCod: conta.bncCod,
                    bncNumCodbanco: conta.bncNumCodbanco,
                    ccoCod: conta.ccoCod,
                    ccoNumConta: conta.ccoNumConta,
                    ccoEspDvconta: conta.ccoEspDvconta,
                    ccoEspAgcod: conta.ccoEspAgcod,
                    ccoEspDvage: null,
                    conta: conta.conta,
                    agencia: '-',
                    layoutConta: conta.layoutConta,
                    flpDtaCredito: dataDebito,
                    flpVldStatus: 0,
                    flpVldConfEnvio: 0,
                    flpVldRet: 0,
                },
                { filCod },
            );
            const flpCod = LOTE_CRIADO_SCHEMA.parse(raw);
            return { flpCod, filCod, bncCod: conta.bncCod };
        } catch (cause) {
            throw this.toConexosError('fin015', cause);
        }
    };

    /**
     * Lotes de `(filCod, bncCod)` — usado para dois fins:
     *   1. marca d'água ANTES do `criarLote` (o maior `flpCod` que existia);
     *   2. busca dos candidatos a órfão DEPOIS de uma queda sem `flpCod` registrado.
     *
     * Sem isto, a janela entre o ERP responder e o ledger gravar é a única falha
     * genuinamente irrecuperável — e ela não precisa ser.
     */
    public listarLotesNativos = async (params: {
        filCod: number;
        bncCod: number;
    }): Promise<LoteNativoEstado[]> => {
        const { filCod, bncCod } = params;
        const path = 'fin015/list';
        try {
            const page = await this.base.runWithRetry(async () => {
                await this.base.ensureSid();
                return this.base.listGenericPaginated<Record<string, unknown>>(
                    path,
                    {
                        fieldList: [],
                        // `filCod#EQ` É OBRIGATÓRIO. O `filCod` de `opts` é o CONTEXTO da
                        // sessão, não um filtro: sem isto o `fin015/list` devolve lotes de
                        // TODAS as filiais (medido: 74 linhas das filiais 1, 2 e 7).
                        //
                        // Foi essa ausência que me fez concluir, erradamente, que
                        // `(filCod, bncCod, flpCod)` não era única — os "gêmeos" eram lotes
                        // de filiais diferentes. Com o filtro: 0 repetições. A chave é única.
                        //
                        // O dano real era na marca d'água: o conjunto de "lotes conhecidos"
                        // vinha contaminado com flpCod de outras filiais, e um órfão cujo
                        // número já existisse em outra filial ficava invisível — o retry
                        // criava um segundo lote, que é exatamente o que o mecanismo evita.
                        filterList: { 'bncCod#EQ': bncCod, 'filCod#EQ': filCod },
                        serviceName: 'fin015',
                        pageNumber: 1,
                        pageSize: 500,
                    },
                    { filCod },
                );
            });
            return (page.rows ?? [])
                .filter((r) => r.flpCod != null)
                .map((r) => ({
                    filCod: Number(r.filCod ?? filCod),
                    bncCod: Number(r.bncCod ?? bncCod),
                    flpCod: Number(r.flpCod),
                    status: Number(r.flpVldStatus ?? 0),
                    titulosCount: Number(r.titulosCount ?? 0),
                    soma: Number(r.soma ?? 0),
                    ...(r.ccoCod != null ? { ccoCod: Number(r.ccoCod) } : {}),
                    ...(r.flpDtaCredito != null ? { dataDebito: Number(r.flpDtaCredito) } : {}),
                    ...(r.flpTimFinaliza != null ? { finalizadoEm: Number(r.flpTimFinaliza) } : {}),
                }));
        } catch (cause) {
            throw this.toConexosError(path, cause);
        }
    };

    /**
     * Estado do lote nativo no ERP. É o que permite RETOMAR uma sequência interrompida em
     * vez de só travar: em vez de acreditar no nosso ledger sobre uma escrita que não
     * confirmou, vamos perguntar ao ERP o que de fato aconteceu.
     *
     * Encoding de `flpVldStatus` MEDIDO em produção (2026-08-25, 22 lotes nas filiais
     * 1/2/4/6) — não inferido:
     *   0 → aberto (rascunho). `titulosCount` diz se o import chegou a entrar.
     *   1 → finalizado. Sempre com `titulosCount >= 1` e `flpTimFinaliza` preenchido.
     *   2 → cancelado. Os itens são removidos (`titulosCount` volta a 0).
     *   3 → outro estado terminal, também com os itens removidos.
     *
     * Devolve `undefined` quando o lote não existe — o que também é resposta: significa
     * que o `criarLote` não chegou a valer.
     */
    public getLoteNativo = async (params: {
        filCod: number;
        bncCod: number;
        flpCod: number;
    }): Promise<LoteNativoEstado | undefined> => {
        const { filCod, bncCod, flpCod } = params;
        const path = `fin015/${filCod}/${bncCod}/${flpCod}`;
        try {
            const bruto = await this.base.runWithRetry(async () => {
                await this.base.ensureSid();
                return this.base.getGeneric<Record<string, unknown>>(path, { filCod });
            });
            const row = ((bruto?.data as Record<string, unknown>) ?? bruto) as Record<
                string,
                unknown
            >;
            if (row?.flpCod == null) return undefined;
            return {
                filCod: Number(row.filCod ?? filCod),
                bncCod: Number(row.bncCod ?? bncCod),
                flpCod: Number(row.flpCod),
                status: Number(row.flpVldStatus ?? 0),
                titulosCount: Number(row.titulosCount ?? 0),
                soma: Number(row.soma ?? 0),
                finalizadoEm: row.flpTimFinaliza != null ? Number(row.flpTimFinaliza) : undefined,
            };
        } catch (cause) {
            // 404 é resposta, não falha: o lote não existe.
            if (cause instanceof Error && /404|not found/i.test(cause.message)) return undefined;
            throw this.toConexosError(path, cause);
        }
    };

    /**
     * Chaves `docCod:titCod` dos títulos que JÁ estão dentro do lote nativo.
     *
     * É o que transforma um import parcial de beco sem saída em retomada: em vez de
     * re-enviar tudo (duplicando o que entrou) ou travar (exigindo conserto na mão), a
     * diferença entre o que o lote local tem e o que o ERP já recebeu é computável.
     *
     * Devolve `undefined` quando a leitura falha — que NÃO é "lote vazio". Um `Set` vazio
     * diria "nada foi importado" e mandaria reimportar tudo; a distinção importa.
     */
    public listarChavesDoLote = async (params: {
        filCod: number;
        bncCod: number;
        flpCod: number;
    }): Promise<Set<string> | undefined> => {
        const { filCod, bncCod, flpCod } = params;
        const path = `fin015/finItemSispag/list/${filCod}/${bncCod}/${flpCod}`;
        try {
            const page = await this.base.runWithRetry(async () => {
                await this.base.ensureSid();
                return this.base.listGenericPaginated<Record<string, unknown>>(
                    path,
                    {
                        fieldList: [],
                        filterList: {},
                        serviceName: 'fin015',
                        pageNumber: 1,
                        pageSize: 500,
                    },
                    { filCod },
                );
            });
            return new Set(
                (page.rows ?? []).map(
                    (r) =>
                        `${Number(r.filCod ?? filCod)}:${String(r.docCod ?? '')}:${String(r.titCod ?? '1')}`,
                ),
            );
        } catch {
            return undefined;
        }
    };

    /**
     * Ferramenta 2 — lista os títulos PENDENTES elegíveis a importar num lote
     * (`POST finItemSispag/titulosPendentes/list/{fil}/{bnc}/{flp}`). Leitura →
     * `runWithRetry`. `filtro` repassa filtros do Conexos (ex. `{ 'docCod#EQ': 520 }`).
     *
     * PAGINA DE VERDADE. A versão anterior pedia `pageSize: 500` e fixava `pageNumber: 1`,
     * o que parecia suficiente até alguém medir: a filial 2 tem ~2020 pendentes, então o
     * chamador enxergava 24,7% do grid. Um título fora da primeira página produzia
     * "não está mais elegível" — uma frase FALSA, e cara, porque o lote nativo já tinha
     * sido criado e ficava órfão.
     *
     * `chavesDesejadas` permite sair assim que as chaves `docCod:titCod` procuradas
     * apareceram, sem varrer o grid inteiro: o caso normal (lote de ≤ 25 itens com
     * vencimento próximo, que o ERP ordena primeiro) resolve na primeira página.
     *
     * `maxPaginas` é guarda contra loop infinito, não limite de trabalho. Se ele for
     * atingido antes de esgotar o grid, o método AVISA em vez de devolver um resultado
     * parcial calado — foi o silêncio, não o corte, que criou o bug original.
     */
    public listarTitulosPendentes = async (params: {
        filCod: number;
        bncCod: number;
        flpCod: number;
        filtro?: Record<string, unknown>;
        pageSize?: number;
        chavesDesejadas?: ReadonlySet<string>;
        maxPaginas?: number;
    }): Promise<TituloPendente[]> => {
        const {
            filCod,
            bncCod,
            flpCod,
            filtro = {},
            pageSize = 500,
            chavesDesejadas,
            maxPaginas = 40,
        } = params;
        const path = `fin015/finItemSispag/titulosPendentes/list/${filCod}/${bncCod}/${flpCod}`;
        const acumulado: TituloPendente[] = [];
        const vistas = new Set<string>();
        let total = Number.POSITIVE_INFINITY;
        let pagina = 0;

        try {
            while (pagina < maxPaginas) {
                pagina += 1;
                const pageNumber = pagina;
                const resposta = await this.base.runWithRetry(async () => {
                    await this.base.ensureSid();
                    return this.base.listGenericPaginated<Record<string, unknown>>(
                        path,
                        {
                            fieldList: [],
                            filterList: filtro,
                            serviceName: 'fin015',
                            pageNumber,
                            pageSize,
                        },
                        { filCod },
                    );
                });

                const linhas = resposta.rows ?? [];
                if (Number.isFinite(Number(resposta.count))) total = Number(resposta.count);
                for (const r of linhas) {
                    const pendente = this.paraTituloPendente(r, filCod);
                    acumulado.push(pendente);
                    // Com a FILIAL: o grid cruza filiais e `docCod` se repete entre elas.
                    vistas.add(`${pendente.filCod}:${pendente.docCod}:${pendente.titCod}`);
                }

                // Parada 1 — já achei tudo que me pediram.
                if (chavesDesejadas && [...chavesDesejadas].every((k) => vistas.has(k))) break;
                // Parada 2 — o grid acabou (página curta ou `count` alcançado).
                if (linhas.length < pageSize || acumulado.length >= total) break;
            }

            if (pagina >= maxPaginas && acumulado.length < total) {
                // Silêncio aqui reintroduz o bug: quem chama precisa saber que viu um pedaço.
                console.warn(
                    `[fin015] titulosPendentes truncado em ${maxPaginas} páginas: ${acumulado.length} de ${total} ` +
                        `(fil=${filCod} bnc=${bncCod} flp=${flpCod}). Aumente maxPaginas ou filtre server-side.`,
                );
            }

            return acumulado;
        } catch (cause) {
            throw this.toConexosError(path, cause);
        }
    };

    /**
     * Conjunto `filCod:docCod:titCod` dos títulos da filial que o ERP casou com um boleto DDA.
     *
     * É a fonte de "este pagamento tem boleto" — o código de barras não está no título (0% em
     * `fin064`, `titulosPendentes` e `com308`), só o FLAG `titVldReflexoDdaAssoc` está, e só no
     * grid de pendentes. Ver `ontology/_inbox/sispag-boleto-dda-sondagem.md`.
     *
     * ⚠️ O grid exige um `flpCod`, mas **o resultado não depende do banco**: o grid lista os
     * pendentes da FILIAL inteira, e o lote serve só como CONTEXTO DE LEITURA (não é modificado;
     * lê igual em lote finalizado). Medido em PRD: filial 1 devolve 38 títulos com o flag tanto
     * pelo banco 4 quanto pelo 10; filial 2 devolve 266 pelos dois.
     *
     * Por isso `bncCods` é uma LISTA de candidatos, tentados em ordem até um ter lote. Escolher
     * "o primeiro banco da filial" não funciona: em PRD `contas[0]` é o banco 38 na filial 1 e o
     * 11 na filial 2 — nenhum dos dois tem lote nativo, e o resultado vinha VAZIO, marcando toda
     * a carteira dessas duas filiais como "sem boleto". É a mesma armadilha que a migration 0049
     * descreve para o `ccoCod`: o código do banco não é comparável entre filiais.
     *
     * Filial sem lote em banco nenhum devolve conjunto vazio — quem chama degrada em vez de
     * quebrar, mas perde o sinal (ver o WARN em `IngestaoPagamentosService`).
     */
    public listarTitulosComBoletoDda = async (params: {
        filCod: number;
        bncCods: readonly number[];
        maxPaginas?: number;
    }): Promise<Set<string>> => {
        const { filCod, bncCods, maxPaginas } = params;
        let contexto: { bncCod: number; flpCod: number } | undefined;
        for (const bncCod of bncCods) {
            const lotes = await this.listarLotesNativos({ filCod, bncCod });
            const maior = lotes.reduce<number | undefined>(
                (acc, l) => (acc === undefined || l.flpCod > acc ? l.flpCod : acc),
                undefined,
            );
            if (maior !== undefined) {
                contexto = { bncCod, flpCod: maior };
                break;
            }
        }
        if (contexto === undefined) return new Set();
        const pendentes = await this.listarTitulosPendentes({
            filCod,
            bncCod: contexto.bncCod,
            flpCod: contexto.flpCod,
            ...(maxPaginas !== undefined ? { maxPaginas } : {}),
        });
        // Se NENHUMA linha do grid tiver o campo legível, o wire mudou — devolver um Set
        // vazio aqui seria indistinguível de "esta filial não tem boleto nenhum", que é
        // exatamente o modo de falha silencioso que o ADR-0040 existe para não repetir.
        const ilegiveis = pendentes.filter((p) => !p.ddaLegivel).length;
        if (pendentes.length > 0 && ilegiveis === pendentes.length) {
            throw new ConexosError({
                endpoint: `fin015/finItemSispag/titulosPendentes/list/${filCod}/${contexto.bncCod}/${contexto.flpCod}`,
                message:
                    `titVldReflexoDdaAssoc ausente ou fora de {0,1} em TODAS as ${pendentes.length} ` +
                    'linhas do grid de pendentes — o contrato do Conexos mudou. A carteira NÃO ' +
                    'deve ser marcada como "sem boleto" por causa disto.',
            });
        }
        return new Set(
            pendentes
                .filter((p) => p.temBoletoDda)
                .map((p) => `${p.filCod}:${p.docCod}:${p.titCod}`),
        );
    };

    /** Projeção da linha crua do grid — a identidade vai VERBATIM em `raw`. */
    private paraTituloPendente = (
        r: Record<string, unknown>,
        filCodPadrao: number,
    ): TituloPendente => ({
        filCod: Number(r.filCod ?? filCodPadrao),
        docCod: String(r.docCod ?? ''),
        titCod: String(r.titCod ?? '1'),
        // O grid de pendentes NÃO traz `itsVldModalidade` — medido em produção
        // (`__fixtures__/contrato.test.ts`). A leitura fica por precaução, mas não construa
        // nada em cima dela: a modalidade que vale vem do NOSSO item de lote.
        ...(r.itsVldModalidade != null ? { itsVldModalidade: Number(r.itsVldModalidade) } : {}),
        ...(r.itsMnyValor != null ? { valor: Number(r.itsMnyValor) } : {}),
        ...(r.titDtaVencimento != null ? { vencimento: Number(r.titDtaVencimento) } : {}),
        ...(r.itsEspNomeFav != null ? { favorecido: String(r.itsEspNomeFav) } : {}),
        // Único sinal de "este pagamento tem boleto" que existe no ERP antes do import.
        // Medido em PRD: 54/173 (fil 1), 136/500 (fil 2), 24/500 (fil 4), 152/500 (fil 6).
        // Validado (não coagido) — ver PENDENTE_DDA_SCHEMA.
        temBoletoDda: PENDENTE_DDA_SCHEMA.safeParse(r).data?.titVldReflexoDdaAssoc === 1,
        ddaLegivel: PENDENTE_DDA_SCHEMA.safeParse(r).success,
        raw: r,
    });

    /**
     * Ferramenta 3 — importa os títulos selecionados no lote
     * (`POST finItemSispag/titulosPendentes/importar`). Escrita → `postGenericOnce`.
     *
     * SHAPE PROVADO AO VIVO EM HML (2026-08-20, lote flp 26). O endpoint NÃO recebe um
     * `FinItemSispag` inteiro: ele projeta um DTO de SELEÇÃO. Quatro campos precisam ir
     * ao MESMO TEMPO no nível da requisição E dentro de cada item — presentes em só um
     * dos dois lados, o ERP responde `SELECTION_ERROR` listando-os como vazios:
     *   `op`                        — operação da seleção (1)
     *   `bncCodFin015`              — banco do LOTE (≠ `bncCod` do item)
     *   `titVldReflexoDdaAssoc`     — reflexo DDA associar (ver `associarDda`)
     *   `titVldReflexoDdaDesassoc`  — reflexo DDA desassociar (0)
     *
     * ⚠️ IDENTIDADE: cada item leva a chave VERBATIM do `titulosPendentes/list`. `filCod`
     * é a filial do TÍTULO e `filCodLote` a do LOTE — o grid cruza filiais, e forçar as
     * duas iguais devolve `Not Found: FinTituloPag`.
     *
     * ⚠️ O ERP pode responder `{ type: 'QUESTION', … }` em vez de erro. Uma única chave é
     * auto-respondida (`PERGUNTA_AUTO_RESPONDIVEL`, o boleto DDA); todas as outras — em
     * especial `FIN_041.PESSOA_FAVORECIDA_SEM_CONTA_ATIVA_NO_BANCO_MODALIDADE_ALTERADA_
     * TITULO_PROPRIO`, que altera a forma de pagamento — sobem como `ErpPerguntaError` para
     * decisão humana.
     *
     * Protocolo da resposta (não documentado pelo Conexos, descoberto em HML 2026-08-27):
     * re-POST do MESMO body com `answers: { "<question.id>": "YES" }` — um MAP chaveado pelo
     * `id`, não pelo `key` e não um array.
     */
    public importarTitulos = async (params: ImportarTitulosParams): Promise<void> => {
        const { filCod, bncCod, flpCod, itens, op = 1, associarDda = false } = params;
        const path = 'fin015/finItemSispag/titulosPendentes/importar';
        const selecao = {
            op,
            bncCodFin015: bncCod,
            // 1 = "associe o boleto DDA deste título". Era `0` fixo, e era por isso que todo
            // boleto saía na remessa sem código de barras: o barcode não está no título, só
            // chega por esta associação. Ver `sispag-boleto-dda-sondagem.md`.
            titVldReflexoDdaAssoc: associarDda ? 1 : 0,
            titVldReflexoDdaDesassoc: 0,
        };

        // UM ITEM POR CHAMADA. Medido em HML (2026-08-25): dois itens no mesmo `items[]`
        // devolvem `400 SELECTION_ERROR` com um `Generic.MODEL_INCONSISTENCY` POR ITEM;
        // os mesmos dois itens, um por chamada, entram sem erro e ambos ficam no lote.
        //
        // O nome do campo (`items`, plural) e a nossa leitura do shape sugeriam lote — e a
        // validação original passou porque foi feita com UM título só. Qualquer lote com 2+
        // títulos, que é o caso normal, quebrava.
        //
        // NÃO é atômico: uma falha no meio deixa parte importada. É exatamente o cenário de
        // import parcial que a retomada trata (ver `retomada-remessa-sispag.md`).
        if (itens.length > 1) {
            for (const item of itens) {
                await this.importarTitulos({
                    filCod,
                    bncCod,
                    flpCod,
                    itens: [item],
                    op,
                    associarDda,
                });
            }
            return;
        }
        const body = { items: itens.map((item) => ({ ...item, ...selecao })), ...selecao };
        try {
            await this.base.ensureSid();
            await this.base.postGenericOnce<unknown>(path, body, { filCod });
        } catch (cause) {
            const idPergunta = this.perguntaAutoRespondivel(cause);
            if (idPergunta === undefined) throw this.toConexosError(path, cause);
            // Toda auto-resposta ao ERP num fluxo de pagamento é registrada. Sem isto, não há
            // como provar depois o que a ferramenta respondeu — e isto é uma decisão
            // automatizada numa escrita que move dinheiro.
            await this.logService.info({
                type: LOG_TYPE.BUSINESS_INFO,
                message: 'fin015 import: pergunta do ERP auto-respondida YES (boleto DDA)',
                data: {
                    pergunta: PERGUNTA_AUTO_RESPONDIVEL,
                    questionId: idPergunta,
                    filCod,
                    bncCod,
                    flpCod,
                    itens: itens.map((i) => `${i.filCod}:${i.docCod}:${i.titCod}`),
                },
            });
            // Re-POST do MESMO body com a resposta. UMA vez só: se o ERP perguntar de novo,
            // a segunda falha sobe como pergunta humana em vez de virar laço de escrita.
            try {
                await this.base.postGenericOnce<unknown>(
                    path,
                    { ...body, answers: { [idPergunta]: 'YES' } },
                    { filCod },
                );
            } catch (causeAposResposta) {
                throw this.toConexosError(path, causeAposResposta);
            }
        }
    };

    /**
     * `id` da pergunta quando o ERP interrompeu com a ÚNICA pergunta que respondemos sozinhos;
     * `undefined` em qualquer outro caso (inclusive envelope com 2+ perguntas, mesmo que uma
     * delas seja a allowlistada — aí a decisão volta a ser humana).
     */
    private perguntaAutoRespondivel = (cause: unknown): string | undefined => {
        const data = (cause as { response?: { data?: unknown } })?.response?.data;
        const parsed = QUESTION_SCHEMA.safeParse(data);
        if (!parsed.success || parsed.data.questions.length !== 1) return undefined;
        const q = parsed.data.questions[0];
        if (q.key !== PERGUNTA_AUTO_RESPONDIVEL) return undefined;
        // A resposta é chaveada pelo `id` — o schema já garante que ele existe.
        return q.id;
    };

    /**
     * O Conexos às vezes interrompe com uma PERGUNTA em vez de um erro:
     * `{ type:'QUESTION', questions:[{ key, parameterValueList, answerList:[YES, ABORT] }] }`.
     * Devolve a pergunta quando reconhece o shape; senão `undefined`.
     */
    private perguntaDoErp = (
        cause: unknown,
    ): { chave: string; parametros?: Record<string, unknown> } | undefined => {
        const data = (cause as { response?: { data?: unknown } })?.response?.data as
            | {
                  type?: string;
                  questions?: Array<{ key?: string; parameterValueList?: Record<string, unknown> }>;
              }
            | undefined;
        if (data?.type !== 'QUESTION') return undefined;
        const q = data.questions?.[0];
        if (!q?.key) return undefined;
        return {
            chave: String(q.key),
            ...(q.parameterValueList ? { parametros: q.parameterValueList } : {}),
        };
    };

    /**
     * Numeração e nome do próximo arquivo de remessa, SUGERIDOS PELO ERP
     * (`GET gerArquivosBancos/initialValues/{fil}/{bnc}/{cco}` → `{gabNumRemessa, gabEspNomeArquivo}`).
     *
     * Não inventar esses valores: o nº de remessa é controle bancário e a sequência é por
     * conta. Um número fora da faixa (ex.: 97 quando a conta está em 11) confunde o banco.
     */
    public sugerirRemessa = async (params: {
        filCod: number;
        bncCod: number;
        ccoCod: number;
    }): Promise<{ numRemessa: number; nomeArquivo: string }> => {
        const { filCod, bncCod, ccoCod } = params;
        const path = `fin015/gerArquivosBancos/initialValues/${filCod}/${bncCod}/${ccoCod}`;
        try {
            const raw = await this.base.runWithRetry(async () => {
                await this.base.ensureSid();
                return this.base.getGeneric<Record<string, unknown>>(path, { filCod });
            });
            const inner = ((raw?.fin080 as Record<string, unknown>)?.GerArquivosBancos ??
                raw) as Record<string, unknown>;
            const numRemessa = Number(inner?.gabNumRemessa);
            const nomeArquivo = String(inner?.gabEspNomeArquivo ?? '');
            if (!Number.isFinite(numRemessa) || numRemessa <= 0 || !nomeArquivo) {
                throw new Error(
                    `initialValues sem numeração utilizável: ${JSON.stringify(raw).slice(0, 200)}`,
                );
            }
            return { numRemessa, nomeArquivo };
        } catch (cause) {
            // `toConexosError` já distingue `QUESTION` de falha — ver o JSDoc dele.
            throw this.toConexosError(path, cause);
        }
    };

    /**
     * Ferramenta 4 — FINALIZA o lote (`GET finalizarLote/{fil}/{bnc}/{flp}`). É um GET
     * sem body. Valida R1 (data débito ≥ hoje) e R2 (≤ menor vencimento) no ERP — se
     * falhar, vem `400 VALIDATION_LIST` e o `ConexosError.message` traz o motivo. Escrita
     * de transição de estado → tentativa única (sem retry cego).
     */
    public finalizarLote = async (params: {
        filCod: number;
        bncCod: number;
        flpCod: number;
    }): Promise<void> => {
        const { filCod, bncCod, flpCod } = params;
        const path = `fin015/finalizarLote/${filCod}/${bncCod}/${flpCod}`;
        try {
            await this.base.ensureSid();
            await this.base.getGeneric<unknown>(path, { filCod });
        } catch (cause) {
            throw this.toConexosError(path, cause);
        }
    };

    /**
     * Ferramenta 5 — GERA a remessa `.REM` (`POST gerArquivosBancos/gerarRemessa`). O ERP
     * produz o CNAB 240 NATIVAMENTE. Escrita NÃO-idempotente (gera novo `.REM` a cada
     * chamada) → `postGenericOnce`, tentativa única. Provado ao vivo em HML (200 SUCESSO).
     * `seqNum` e `gabEspNomeArquivo` são obrigatórios (o ERP recusa sem eles).
     */
    public gerarRemessa = async (params: GerarRemessaParams): Promise<RemessaGerada> => {
        const { filCod, bncCod, flpCod, grbCodSeq, seqNum, gabEspNomeArquivo } = params;
        const path = 'fin015/gerArquivosBancos/gerarRemessa';
        try {
            await this.base.ensureSid();
            const raw = await this.base.postGenericOnce<unknown>(
                path,
                { filCodLote: filCod, bncCod, flpCod, grbCodSeq, seqNum, gabEspNomeArquivo },
                { filCod },
            );
            // O ERP sinaliza falha de negócio com 400 (`VALIDATION_LIST`), que vira
            // `ConexosError` no catch — logo, chegar aqui É o sinal de sucesso. NÃO dá
            // para derivar de `valid === 'SUCESSO'`: na geração provada em HML
            // (2026-08-20, flp 26 → PG200893.REM, gabCod 46, 1210 chars) o corpo veio
            // SEM esse campo e a remessa foi gerada mesmo assim — o parse antigo
            // reportava `sucesso: false` num caso de sucesso.
            // Defesa em profundidade: o orquestrador confirma via `listarArquivosRemessa`.
            const parsed = SUCESSO_SCHEMA.parse(raw ?? {});
            return {
                sucesso: true,
                ...(parsed.message ? { mensagem: parsed.message } : {}),
            };
        } catch (cause) {
            throw this.toConexosError(path, cause);
        }
    };

    /**
     * Ferramenta 6 — lista os arquivos de remessa gerados de um lote
     * (`POST gerArquivosBancos/list/{fil}`). Traz o `.REM` inteiro em `gabLngDados`
     * (é assim que a sonda salvou o arquivo). Leitura → `runWithRetry`.
     */
    public listarArquivosRemessa = async (params: {
        filCod: number;
        bncCod: number;
        flpCod: number;
    }): Promise<ArquivoRemessa[]> => {
        const { filCod, bncCod, flpCod } = params;
        const path = `fin015/gerArquivosBancos/list/${filCod}`;
        try {
            const page = await this.base.runWithRetry(async () => {
                await this.base.ensureSid();
                return this.base.listGenericPaginated<Record<string, unknown>>(
                    path,
                    {
                        fieldList: [],
                        filterList: { bncCod, flpCod },
                        serviceName: 'fin015',
                        pageNumber: 1,
                        pageSize: 20,
                    },
                    { filCod },
                );
            });
            return (page.rows ?? [])
                .map((r) => ({
                    gabCod: Number(r.gabCod),
                    ...(r.gabEspNomeArquivo != null
                        ? { nomeArquivo: String(r.gabEspNomeArquivo) }
                        : {}),
                    ...(r.gabNumRemessa != null ? { numRemessa: String(r.gabNumRemessa) } : {}),
                    ...(r.gabLngDados != null ? { conteudo: String(r.gabLngDados) } : {}),
                }))
                .filter((a) => Number.isFinite(a.gabCod));
        } catch (cause) {
            throw this.toConexosError(path, cause);
        }
    };

    /**
     * Ferramenta 7 — baixa o `.REM` por `gabCod` (`GET gerArquivosBancos/download/{gabCod}`,
     * octet-stream). Alternativa ao `gabLngDados`; retorna o conteúdo como string.
     */
    public baixarRemessa = async (params: { filCod: number; gabCod: number }): Promise<string> => {
        const { filCod, gabCod } = params;
        const path = `fin015/gerArquivosBancos/download/${gabCod}`;
        try {
            const raw = await this.base.runWithRetry(async () => {
                await this.base.ensureSid();
                return this.base.getGeneric<unknown>(path, { filCod });
            });
            return typeof raw === 'string' ? raw : String(raw ?? '');
        } catch (cause) {
            throw this.toConexosError(path, cause);
        }
    };
}
