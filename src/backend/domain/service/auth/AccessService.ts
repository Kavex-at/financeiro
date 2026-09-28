import { inject, injectable, singleton } from 'tsyringe';
import type { Permission, RoleRef } from '../../interface/auth/Permission.js';
import { LOG_TYPE } from '../../interface/log/LogInterface.js';
import Clock from '../../libs/clock/Clock.js';
import AccessRepository from '../../repository/auth/AccessRepository.js';
import LogService from '../LogService.js';
import EffectivePermissionCalculator from './EffectivePermissionCalculator.js';

/** O acesso de quem faz a requisição, já calculado. */
export interface ResolvedAccess {
    userId: number;
    username: string;
    ativo: boolean;
    papel: RoleRef;
    permissoes: ReadonlySet<Permission>;
}

interface CacheEntry {
    value: ResolvedAccess;
    expiresAt: number;
}

/**
 * AccessService — resolve, a cada requisição, QUEM é o dono do token e o que ele pode (ADR-0053).
 *
 * O token só identifica (`sub = username`); a permissão vem do banco (I1), calculada pelo
 * `EffectivePermissionCalculator`. Para não pagar uma consulta por requisição, guarda o resultado
 * em memória por **30 s** (R7), e toda escrita de acesso feita pela tela chama `invalidar(userId)`
 * no próprio processo. O TTL é a rede de segurança para o que não passa pela tela (SQL manual) e
 * para a sobreposição de instâncias no deploy. Hoje há UMA instância web (`plan: starter`); se
 * `numInstances` subir, a invalidação não alcança as outras e o pior caso vira os 30 s.
 *
 * `@singleton()` porque o cache TEM de ser único no processo. Não entra no
 * `bootstrapAppContainer` (gotcha dos ~58 jobs): é resolvido sob demanda pelo middleware.
 *
 * Erro do repositório PROPAGA e não é cacheado: quem decide o 503 (fail-closed) é o middleware.
 */
@singleton()
@injectable()
export default class AccessService {
    /** Validade de uma entrada do cache. Pior caso de um acesso retirado fora da tela. */
    public static readonly CACHE_TTL_MS = 30_000;

    private readonly cache = new Map<string, CacheEntry>();

    constructor(
        @inject(AccessRepository)
        private accessRepository: AccessRepository,
        @inject(EffectivePermissionCalculator)
        private calculator: EffectivePermissionCalculator,
        @inject(LogService)
        private logService: LogService,
        @inject(Clock)
        private clock: Clock,
    ) {}

    /**
     * Acesso do dono do `sub` (casado sem distinção de caixa). `null` = não existe (não cacheado,
     * para um usuário recém-criado não ficar 30 s sem entrar). Inativo é devolvido e cacheado; quem
     * responde 401 é o middleware.
     */
    public resolver = async (sub: string): Promise<ResolvedAccess | null> => {
        const key = sub.toLowerCase();
        const now = this.clock.now();
        const hit = this.cache.get(key);
        if (hit && hit.expiresAt > now) return hit.value;

        const access = await this.accessRepository.findAccessBySub(sub);
        if (!access) {
            this.cache.delete(key);
            return null;
        }

        const { permissoes, ignoradas } = this.calculator.calcular(access.pacote, access.excecoes);
        if (ignoradas.length > 0) {
            await this.logService.warn({
                type: LOG_TYPE.BUSINESS_WARN,
                message: 'permissões fora do catálogo ignoradas no cálculo de acesso',
                data: { usuario: access.username, ignoradas },
            });
        }

        const value: ResolvedAccess = {
            userId: access.userId,
            username: access.username,
            ativo: access.ativo,
            papel: access.papel,
            permissoes,
        };
        this.cache.set(key, { value, expiresAt: now + AccessService.CACHE_TTL_MS });
        return value;
    };

    /** Esquece o acesso cacheado de um usuário: a próxima requisição dele relê o banco. */
    public invalidar = (userId: number): void => {
        for (const [key, entry] of this.cache) {
            if (entry.value.userId === userId) this.cache.delete(key);
        }
    };
}
