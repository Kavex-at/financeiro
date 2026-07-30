import { inject, injectable } from 'tsyringe';
import ConexosNdeClient from '../../client/ConexosNdeClient.js';
import { NDE_STATUS_EMISSAO } from '../../interface/recebimentos/constants.js';
import type { NotaDebitoEletronica } from '../../interface/recebimentos/NotaDebitoEletronica.js';
import type {
    ExternalCallOptions,
    NdeEmitterInterface,
} from '../../interface/recebimentos/ports.js';
import type { Recebimento } from '../../interface/recebimentos/Recebimento.js';
import EnvironmentProvider from '../../libs/environment/EnvironmentProvider.js';
import ContingenciaDecider from './ContingenciaDecider.js';
import LogService from '../LogService.js';

/**
 * ConexosNdeEmitter — adaptador REAL do port `NdeEmitterInterface` (Módulo 5) sobre a homologação
 * com297. Live-capable, mas o caminho vivo é gated (`conexosWriteEnabled && !conexosDryRun`) e só
 * dispara quando o `Recebimento` já carrega `emissaoNde` (o `docCod` com297 + `vldTpNf`, produzidos
 * pela leg de GERAÇÃO — fora do escopo desta fatia).
 *
 * Posturas (em ordem):
 *   1. sem `emissaoNde` → **fallback `pendente`** idêntico ao `NdeEmitterStub` (a leg de geração ainda
 *      não mintou o `docCod`; o pipeline nunca quebra). É por isso que este emitter NÃO é o binding
 *      default do `NDE_EMITTER_TOKEN` ainda — o swap é o passo de go-live (ver `recebimentosContainer`).
 *   2. `emissaoNde` presente → decide a rota (`ContingenciaDecider`, fail-loud em ausente/desconhecido).
 *   3. dry-run (escrita desligada) → `pendente` (rota decidida, mas NADA é enviado).
 *   4. escrita ligada → `ConexosNdeClient.homologar` (POST real) → `emitida` (com/sem aviso).
 *
 * Idempotência (uma NDe por `Recebimento`): `idempotencyKey = nde:{recebimentoId}` — igual ao stub;
 * o "não emitir 2×" é aplicado pelo ledger write-ahead do pipeline. Ver
 * `ontology/entities/nota-debito-eletronica.md` e `business-rules/idempotencia-quitacao-nde.md`.
 */
@injectable()
export default class ConexosNdeEmitter implements NdeEmitterInterface {
    public constructor(
        @inject(EnvironmentProvider) private readonly environmentProvider: EnvironmentProvider,
        @inject(ContingenciaDecider) private readonly contingenciaDecider: ContingenciaDecider,
        @inject(ConexosNdeClient) private readonly ndeClient: ConexosNdeClient,
        @inject(LogService) private readonly logService: LogService,
    ) {}

    public emitir = async (
        recebimento: Recebimento,
        opts?: ExternalCallOptions,
    ): Promise<NotaDebitoEletronica> => {
        const base = {
            id: `nde-${recebimento.id}`,
            recebimentoId: recebimento.id,
            filCod: recebimento.filCod,
            correlationId: recebimento.correlationId,
            valor: recebimento.valorRecebido,
            moeda: 'BRL',
            idempotencyKey: `nde:${recebimento.id}`,
        };

        // Postura 1 — sem carrier: a leg de geração com297 ainda não produziu o docCod → pendente.
        if (!recebimento.emissaoNde) {
            return { ...base, statusEmissao: NDE_STATUS_EMISSAO.PENDENTE };
        }

        // Postura 2 — decide a rota AGORA (fail-loud em vldTpNf ausente/desconhecido).
        const rota = this.contingenciaDecider.decidir(recebimento.emissaoNde.vldTpNf);

        // Postura 3 — dry-run: rota decidida, mas nada sai do processo.
        const env = await this.environmentProvider.getEnvironmentVars();
        const dryRun = !env.conexosWriteEnabled || env.conexosDryRun;
        if (dryRun) {
            return {
                ...base,
                statusEmissao: NDE_STATUS_EMISSAO.PENDENTE,
                erpResponse: {
                    dryRun: true,
                    verbo: rota.verbo,
                    contingencia: rota.contingencia,
                    com297DocCod: recebimento.emissaoNde.com297DocCod,
                },
            };
        }

        // Postura 4 — escrita ligada: homologação REAL (o client fail-close no upstream/validação).
        const result = await this.ndeClient.homologar({
            docCod: recebimento.emissaoNde.com297DocCod,
            filCod: recebimento.filCod,
            rota,
            correlationId: recebimento.correlationId,
        });
        if (result.avisoValidacoesPendentes) {
            void this.logService.warn({
                type: 'BUSINESS_WARN',
                message: `NDe ${recebimento.id} homologada COM aviso (validações pendentes — com194)`,
                data: { recebimentoId: recebimento.id, correlationId: recebimento.correlationId },
            });
        }
        void opts;
        return {
            ...base,
            statusEmissao: NDE_STATUS_EMISSAO.EMITIDA,
            numeroNde: result.numeroNde,
            erpResponse: result.erpResponse,
            emitidaEm: new Date(),
            emitidaPor: recebimento.aprovadoPor ?? recebimento.criadoPor,
        };
    };
}
