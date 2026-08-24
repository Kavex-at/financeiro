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
    RemessaGerada,
    TituloPendente,
} from '../interface/sispag/Fin015Write.js';
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
    public constructor(@inject(ConexosBaseClient) private readonly base: ConexosBaseClient) {}

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
    private toConexosError = (endpoint: string, cause: unknown): ConexosError =>
        new ConexosError({ endpoint, cause, message: this.describeConexosValidation(cause) });

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
     * Ferramenta 2 — lista os títulos PENDENTES elegíveis a importar num lote
     * (`POST finItemSispag/titulosPendentes/list/{fil}/{bnc}/{flp}`). Leitura →
     * `runWithRetry`. `filtro` repassa filtros do Conexos (ex. `{ 'docCod#EQ': 520 }`).
     */
    public listarTitulosPendentes = async (params: {
        filCod: number;
        bncCod: number;
        flpCod: number;
        filtro?: Record<string, unknown>;
        pageSize?: number;
    }): Promise<TituloPendente[]> => {
        const { filCod, bncCod, flpCod, filtro = {}, pageSize = 500 } = params;
        const path = `fin015/finItemSispag/titulosPendentes/list/${filCod}/${bncCod}/${flpCod}`;
        try {
            const page = await this.base.runWithRetry(async () => {
                await this.base.ensureSid();
                return this.base.listGenericPaginated<Record<string, unknown>>(
                    path,
                    {
                        fieldList: [],
                        filterList: filtro,
                        serviceName: 'fin015',
                        pageNumber: 1,
                        pageSize,
                    },
                    { filCod },
                );
            });
            return (page.rows ?? []).map((r) => ({
                filCod: Number(r.filCod ?? filCod),
                docCod: String(r.docCod ?? ''),
                titCod: String(r.titCod ?? '1'),
                ...(r.itsVldModalidade != null
                    ? { itsVldModalidade: Number(r.itsVldModalidade) }
                    : {}),
                ...(r.itsMnyValor != null ? { valor: Number(r.itsMnyValor) } : {}),
                ...(r.titDtaVencimento != null ? { vencimento: Number(r.titDtaVencimento) } : {}),
                ...(r.itsEspNomeFav != null ? { favorecido: String(r.itsEspNomeFav) } : {}),
                raw: r,
            }));
        } catch (cause) {
            throw this.toConexosError(path, cause);
        }
    };

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
     *   `titVldReflexoDdaAssoc`     — reflexo DDA associar (0)
     *   `titVldReflexoDdaDesassoc`  — reflexo DDA desassociar (0)
     *
     * ⚠️ IDENTIDADE: cada item leva a chave VERBATIM do `titulosPendentes/list`. `filCod`
     * é a filial do TÍTULO e `filCodLote` a do LOTE — o grid cruza filiais, e forçar as
     * duas iguais devolve `Not Found: FinTituloPag`.
     *
     * ⚠️ O ERP pode responder `{ type: 'QUESTION', answerList: [YES, ABORT] }` (ex.:
     * favorecido sem conta ativa no banco do lote, `FIN_041.PESSOA_FAVORECIDA_SEM_CONTA_
     * ATIVA_NO_BANCO_MODALIDADE_ALTERADA_TITULO_PROPRIO`). É uma confirmação interativa e
     * hoje vira erro — tratar no serviço de orquestração antes de ligar a escrita.
     */
    public importarTitulos = async (params: ImportarTitulosParams): Promise<void> => {
        const { filCod, bncCod, itens, op = 1 } = params;
        const path = 'fin015/finItemSispag/titulosPendentes/importar';
        const selecao = {
            op,
            bncCodFin015: bncCod,
            titVldReflexoDdaAssoc: 0,
            titVldReflexoDdaDesassoc: 0,
        };
        try {
            await this.base.ensureSid();
            await this.base.postGenericOnce<unknown>(
                path,
                { items: itens.map((item) => ({ ...item, ...selecao })), ...selecao },
                { filCod },
            );
        } catch (cause) {
            throw this.toConexosError(path, cause);
        }
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
            | { type?: string; questions?: Array<{ key?: string; parameterValueList?: Record<string, unknown> }> }
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
                throw new Error(`initialValues sem numeração utilizável: ${JSON.stringify(raw).slice(0, 200)}`);
            }
            return { numRemessa, nomeArquivo };
        } catch (cause) {
            const pergunta = this.perguntaDoErp(cause);
            if (pergunta) {
                throw new ErpPerguntaError({ ...pergunta, contexto: 'importarTitulos' });
            }
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
