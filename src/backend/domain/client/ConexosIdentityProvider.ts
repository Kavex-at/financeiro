import { injectable, singleton } from 'tsyringe';
import { conexosRequestContext } from '../libs/requestContext/ConexosRequestContext.js';

/** Identidade do ERP que executou uma escrita — o que os ledgers persistem (I-2, ADR-0041). */
export interface ConexosExecutionIdentity {
    /** Login Conexos usado (do usuário vinculado, ou o do robô). */
    conexosUsername: string;
    /** `true` quando quem executou foi o robô. */
    viaRobo: boolean;
    /** `usnCod` do `/login`, quando a sessão já logou. */
    usnCod?: string;
}

/**
 * ConexosIdentityProvider — expõe, para os repositórios de execução, QUAL identidade do
 * Conexos está assinando as escritas desta request (ADR-0041).
 *
 * A identidade é ambiente, como a própria sessão: o `ConexosSessionResolver` a publica no
 * `AsyncLocalStorage` ao resolver, e os ledgers a leem na hora de gravar. Um provider
 * injetável (em vez de os repositórios tocarem o store direto) mantém a dependência
 * declarada e mockável nos testes.
 *
 * O `usnCod` é resolvido **na leitura**, não na publicação: no `beginExecution` (write-ahead)
 * a sessão pode ainda não ter feito login, mas no `markSettled` já fez. Por isso ele sai de
 * `state.resolved`, que é a instância viva da sessão.
 *
 * Fora de request (jobs, crons, scripts) devolve `undefined` — o ledger grava NULL, que
 * significa "identidade não capturada", nunca "robô".
 */
@singleton()
@injectable()
export default class ConexosIdentityProvider {
    /**
     * Os dois parâmetros prontos para o SQL dos ledgers — sempre as duas chaves, `null`
     * quando não há identidade (fora de request). Evita que cada repositório repita o
     * mesmo `?? null`.
     */
    public currentParams = (): { conexosUsername: string | null; conexosUsnCod: string | null } => {
        const identity = this.current();
        return {
            conexosUsername: identity?.conexosUsername ?? null,
            conexosUsnCod: identity?.usnCod ?? null,
        };
    };

    public current = (): ConexosExecutionIdentity | undefined => {
        const state = conexosRequestContext.getStore();
        if (!state?.identity) return undefined;
        const usnCod = state.resolved?.getCapturedUsnCod() ?? undefined;
        return {
            conexosUsername: state.identity.conexosUsername,
            viaRobo: state.identity.viaRobo,
            ...(usnCod ? { usnCod } : {}),
        };
    };
}
