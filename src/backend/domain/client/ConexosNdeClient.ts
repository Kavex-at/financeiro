import { inject, injectable, singleton } from 'tsyringe';
import { z } from 'zod';
import HomologacaoRejeitadaError from '../errors/HomologacaoRejeitadaError.js';
import { NDE_DOC_VLD_COM_VALIDACOES } from '../interface/recebimentos/constants.js';
import type {
    HomologacaoNdeResult,
    HomologarNdeInput,
} from '../interface/recebimentos/HomologacaoNde.js';
import ConexosBaseClient from './ConexosBaseClient.js';

/**
 * Boundary (Zod) da resposta da homologação. O Conexos às vezes embrulha o registro em `.data`
 * (como no `fin015`); o preprocess desembrulha antes de exigir `docVldComvalidacoes`. `passthrough`
 * preserva o resto p/ auditoria. `docEspNumero` é a melhor aposta p/ o número da NF-e homologada —
 * o campo EXATO não foi confirmado por HAR (info-gap), então é opcional/best-effort.
 */
const HOMOLOGACAO_RESP_SCHEMA = z.preprocess(
    (raw) => {
        const o = (raw ?? {}) as Record<string, unknown>;
        return (o.data ?? o) as Record<string, unknown>;
    },
    z
        .object({
            docVldComvalidacoes: z.coerce.number().int(),
            docEspNumero: z.union([z.string(), z.number()]).optional(),
        })
        .passthrough(),
);

/**
 * ConexosNdeClient — leg FISCAL da NDe: HOMOLOGA o documento com297 (autorização SEFAZ). É o passo
 * TERMINAL da geração da Nota de Débito Eletrônica.
 *
 * `homologar` faz `POST com297/{verbo}/{docCod}` com body `{}` (o `docCod` vai no PATH; o verbo é
 * decidido a montante pelo `ContingenciaDecider`). Espelha a doutrina de escrita IRREVERSÍVEL do
 * `ConexosBaixaClient`/`ConexosSispagWriteClient`:
 *   - `postGenericOnce` (SEM 401-retry silencioso e SEM RetryExecutor) — um re-POST poderia
 *     homologar 2×; tentativa ÚNICA, fail-closed.
 *   - **HTTP 200 ≠ sucesso**: ramifica OBRIGATORIAMENTE em `docVldComvalidacoes` (1 sucesso / 2
 *     emitida-com-aviso / default → `HomologacaoRejeitadaError`). Nunca marca um 200 como sucesso.
 *   - toda falha de upstream vira `HomologacaoRejeitadaError` NÃO-retryable (`upstream`) — o resultado
 *     é ambíguo (o POST pode ter chegado), então não auto-retenta; reconcilia pelo ledger.
 *
 * Live-capable: o POST é REAL. O gating de produção (`conexosWriteEnabled`/`conexosDryRun`), a
 * idempotência (ledger write-ahead "já emitida") e a permissão ACL (`HOMOLOGAR DOCUMENTO
 * [CONTINGENCIA]` em `com297`) são responsabilidade do orquestrador (`ConexosNdeEmitter` / pipeline).
 * Ver `ontology/integrations/conexos-com297-homologacao.md`.
 */
@singleton()
@injectable()
export default class ConexosNdeClient {
    public constructor(@inject(ConexosBaseClient) private readonly base: ConexosBaseClient) {}

    public homologar = async (input: HomologarNdeInput): Promise<HomologacaoNdeResult> => {
        const { docCod, filCod, rota } = input;
        const path = `com297/${rota.verbo}/${docCod}`;

        let raw: unknown;
        try {
            await this.base.ensureSid();
            raw = await this.base.postGenericOnce<unknown>(path, {}, { filCod });
        } catch (cause) {
            // Falha ambígua (o POST pode ter chegado) → NÃO-retryable, fail-closed.
            throw new HomologacaoRejeitadaError({ docCod, motivo: 'upstream', cause });
        }

        const body = HOMOLOGACAO_RESP_SCHEMA.parse(raw);
        const numeroNde = body.docEspNumero != null ? String(body.docEspNumero) : undefined;

        if (body.docVldComvalidacoes === NDE_DOC_VLD_COM_VALIDACOES.SUCESSO) {
            return {
                docVldComvalidacoes: body.docVldComvalidacoes,
                avisoValidacoesPendentes: false,
                numeroNde,
                erpResponse: raw,
            };
        }
        // `2` (validações pendentes) e `0` (validações não-bloqueantes: cond. pagamento/frete/GTIN) ambos
        // = HOMOLOGADA com aviso. O Yuri confirmou (2026-08-03) que na plataforma essas validações NÃO
        // bloqueiam — a homologação acontece; marcamos revisão humana + coletamos com194.
        if (
            body.docVldComvalidacoes === NDE_DOC_VLD_COM_VALIDACOES.AVISO_VALIDACOES_PENDENTES ||
            body.docVldComvalidacoes ===
                NDE_DOC_VLD_COM_VALIDACOES.HOMOLOGADA_VALIDACOES_NAO_BLOQUEANTES
        ) {
            return {
                docVldComvalidacoes: body.docVldComvalidacoes,
                avisoValidacoesPendentes: true,
                numeroNde,
                erpResponse: raw,
            };
        }
        // default: com194 + popError no UI — homologação NÃO confirmada.
        throw new HomologacaoRejeitadaError({
            docCod,
            motivo: 'validacao',
            docVldComvalidacoes: body.docVldComvalidacoes,
        });
    };
}
