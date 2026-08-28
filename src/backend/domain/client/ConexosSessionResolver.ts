import { inject, injectable, singleton } from 'tsyringe';
import type { ConexosService } from '../../services/conexos.js';
import { LOG_TYPE } from '../interface/log/LogInterface.js';
import SecretCipher from '../libs/crypto/SecretCipher.js';
import EnvironmentProvider from '../libs/environment/EnvironmentProvider.js';
import {
    type ConexosRequestState,
    conexosRequestContext,
} from '../libs/requestContext/ConexosRequestContext.js';
import UserRepository from '../repository/auth/UserRepository.js';
import LogService from '../service/LogService.js';
import ConexosSessionRegistry from './ConexosSessionRegistry.js';

/** Resultado do teste explícito de credencial (usado no aviso do login). */
export type VinculoStatus = 'ok' | 'falha' | 'ausente';

/** Por que uma credencial de vínculo presente não pôde ser usada (I-1, ADR-0041). */
type MotivoDegradacao = 'decrypt' | 'login';

/**
 * ConexosSessionResolver — decide, POR REQUEST, qual sessão Conexos usar (Fatia B).
 *
 * Regra: se a request é de um usuário logado COM vínculo Conexos válido, usa a
 * sessão dele (a baixa sai no nome dele); senão, cai no ROBÔ. Casos de fallback:
 *   - sem request (job/cron) ou sem usuário no contexto → robô;
 *   - usuário sem vínculo → robô;
 *   - senha não decifra (chave trocada/corrompida) → robô;
 *   - login Conexos do usuário falha (credencial inválida/expirada) → robô.
 * O aviso ao usuário de que ele está operando via robô é dado no LOGIN
 * (`testarVinculo`), não a cada chamada — em runtime o fallback não interrompe ninguém.
 *
 * **ADR-0041.** "Não interromper o usuário" deixou de significar "não contar a ninguém".
 * Os dois últimos casos — vínculo PRESENTE que não pôde ser usado — emitem `warn`
 * estruturado: são defeito operacional, não caminho normal. Os dois primeiros seguem
 * mudos (job e usuário sem vínculo são o esperado; logar viraria ruído).
 *
 * O resolver também PUBLICA a identidade escolhida no contexto da request, para os
 * ledgers de execução registrarem quem, no ERP, assinou a escrita (I-2). Ver
 * `ConexosIdentityProvider`.
 *
 * A sessão resolvida é cacheada no contexto da request (`resolved`) para não
 * repetir lookup+login a cada chamada ao ERP dentro da mesma request.
 */
@singleton()
@injectable()
export default class ConexosSessionResolver {
    constructor(
        @inject(UserRepository) private userRepository: UserRepository,
        @inject(SecretCipher) private secretCipher: SecretCipher,
        @inject(ConexosSessionRegistry) private registry: ConexosSessionRegistry,
        @inject(EnvironmentProvider) private environmentProvider: EnvironmentProvider,
        @inject(LogService) private logService: LogService,
    ) {}

    /** Resolve a sessão Conexos ativa para a request corrente (robô fora de request). */
    public resolve = async (): Promise<ConexosService> => {
        const state = conexosRequestContext.getStore();
        // Fora de request (job/cron/script) não há onde publicar identidade: o ledger
        // grava NULL, que significa "não capturada" — nunca "robô".
        if (!state) return this.registry.robot();
        if (state.resolved) return state.resolved;

        const service = state.platformUsername
            ? await this.resolveForUser(state.platformUsername, state)
            : await this.degradarParaRobo(state);
        state.resolved = service;
        return service;
    };

    /**
     * Testa EXPLICITAMENTE a credencial Conexos de um usuário (usado no login p/
     * o aviso). `ausente` = sem vínculo; `ok`/`falha` = login de teste no ERP.
     * Nunca lança — qualquer erro vira `falha`. NÃO loga: é um teste pedido pela UI,
     * não uma degradação silenciosa de uma execução real.
     */
    public testarVinculo = async (platformUsername: string): Promise<VinculoStatus> => {
        const vinculo = await this.userRepository.getVinculoConexos(platformUsername);
        if (!vinculo) return 'ausente';
        try {
            const password = await this.secretCipher.decrypt(vinculo.conexosPasswordEnc);
            const service = this.registry.forUser(vinculo.conexosUsername, password);
            await service.ensureSid();
            return 'ok';
        } catch {
            return 'falha';
        }
    };

    /** Resolve a sessão do usuário; qualquer falha degrada para o robô. */
    private resolveForUser = async (
        platformUsername: string,
        state: ConexosRequestState,
    ): Promise<ConexosService> => {
        const vinculo = await this.userRepository.getVinculoConexos(platformUsername);
        // Sem vínculo é o caminho normal da maioria dos usuários — robô, sem log.
        if (!vinculo) return this.degradarParaRobo(state);

        let password: string;
        try {
            password = await this.secretCipher.decrypt(vinculo.conexosPasswordEnc);
        } catch (error) {
            await this.avisarDegradacao(
                platformUsername,
                vinculo.conexosUsername,
                'decrypt',
                error,
            );
            return this.degradarParaRobo(state);
        }

        const service = this.registry.forUser(vinculo.conexosUsername, password);
        try {
            await service.ensureSid();
            state.identity = { conexosUsername: vinculo.conexosUsername, viaRobo: false };
            return service;
        } catch (error) {
            await this.avisarDegradacao(platformUsername, vinculo.conexosUsername, 'login', error);
            return this.degradarParaRobo(state);
        }
    };

    /** Cai no robô publicando a identidade dele — o fallback fica registrado, não implícito. */
    private degradarParaRobo = async (state: ConexosRequestState): Promise<ConexosService> => {
        const env = await this.environmentProvider.getEnvironmentVars();
        state.identity = { conexosUsername: env.conexosLogin, viaRobo: true };
        return this.registry.robot();
    };

    /**
     * I-1 — um vínculo PRESENTE que não pôde ser usado é evento operacional. Nunca lança
     * (o log não pode derrubar a execução) e nunca inclui a senha, cifrada ou em claro.
     */
    private avisarDegradacao = async (
        platformUsername: string,
        conexosUsername: string,
        motivo: MotivoDegradacao,
        error: unknown,
    ): Promise<void> => {
        await this.logService.warn({
            type: LOG_TYPE.BUSINESS_WARN,
            message:
                'vínculo Conexos presente mas inutilizável — a execução seguirá pelo robô, ' +
                'e NÃO sairá no nome do usuário',
            data: {
                platformUsername,
                conexosUsername,
                motivo,
                erro: error instanceof Error ? error.message : String(error),
            },
        });
    };
}
