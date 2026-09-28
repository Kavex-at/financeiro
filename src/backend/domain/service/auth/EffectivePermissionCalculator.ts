import { injectable } from 'tsyringe';
import {
    EXCEPTION_EFFECT,
    PERMISSION_IMPLIES,
    type Permission,
    type PermissionException,
    isPermission,
} from '../../interface/auth/Permission.js';

/** Resultado do cálculo: as efetivas e o que foi descartado por estar fora do catálogo. */
export interface EffectivePermissions {
    permissoes: Set<Permission>;
    /**
     * Valores fora do catálogo vindos do banco (R4). Exceção com efeito desconhecido aparece como
     * `permissao:efeito`. O chamador loga aviso; o cálculo nunca lança por isso.
     */
    ignoradas: string[];
}

/**
 * EffectivePermissionCalculator — o ÚNICO lugar que sabe calcular permissões efetivas (I7).
 *
 *     efetivas = fecho(pacote(papel) ∪ concedidas) − revogadas
 *
 * `fecho` acrescenta `X:ver` para todo `X:executar`. Revogar `X:ver` tira também `X:executar`.
 * Revogar vence conceder. Puro e síncrono: sem banco, sem relógio, sem env. O middleware de acesso,
 * a guarda do último gestor e a tela de usuários chamam esta classe; nenhum deles reimplementa a
 * regra.
 */
@injectable()
export default class EffectivePermissionCalculator {
    public calcular = (
        pacote: readonly string[],
        excecoes: readonly PermissionException[],
    ): EffectivePermissions => {
        const ignoradas: string[] = [];
        const base = new Set<Permission>();
        const revogadas = new Set<Permission>();

        for (const valor of pacote) {
            if (isPermission(valor)) base.add(valor);
            else ignoradas.push(valor);
        }

        for (const excecao of excecoes) {
            if (!isPermission(excecao.permissao)) {
                ignoradas.push(excecao.permissao);
                continue;
            }
            if (excecao.efeito === EXCEPTION_EFFECT.CONCEDER) base.add(excecao.permissao);
            else if (excecao.efeito === EXCEPTION_EFFECT.REVOGAR) revogadas.add(excecao.permissao);
            else ignoradas.push(`${excecao.permissao}:${excecao.efeito}`);
        }

        const permissoes = this.fecho(base);
        for (const revogada of this.fechoDaRevogacao(revogadas)) permissoes.delete(revogada);

        return { permissoes, ignoradas };
    };

    /** Consulta sobre um conjunto já calculado. */
    public tem = (permissoes: ReadonlySet<Permission>, permissao: Permission): boolean =>
        permissoes.has(permissao);

    /** Acrescenta o `ver` de todo `executar`. */
    private fecho = (base: ReadonlySet<Permission>): Set<Permission> => {
        const out = new Set<Permission>(base);
        for (const permissao of base) {
            const implicada = PERMISSION_IMPLIES[permissao];
            if (implicada !== undefined) out.add(implicada);
        }
        return out;
    };

    /** Revogar `X:ver` revoga também `X:executar` (quem não vê não executa). */
    private fechoDaRevogacao = (revogadas: ReadonlySet<Permission>): Set<Permission> => {
        const out = new Set<Permission>(revogadas);
        for (const [maior, implicada] of Object.entries(PERMISSION_IMPLIES)) {
            if (implicada !== undefined && revogadas.has(implicada) && isPermission(maior)) {
                out.add(maior);
            }
        }
        return out;
    };
}
