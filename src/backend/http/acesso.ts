import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { container } from 'tsyringe';
import { bootstrapAppContainer } from '../domain/appContainer.js';
import {
    ADMIN_ROLE_NAME,
    PERMISSION,
    PERMISSION_CATALOG,
    type Permission,
    type RoleRef,
} from '../domain/interface/auth/Permission.js';
import { LOG_TYPE } from '../domain/interface/log/LogInterface.js';
import LogService from '../domain/service/LogService.js';
import AccessService, {
    type ChaveAcesso,
    type ResolvedAccess,
} from '../domain/service/auth/AccessService.js';
import { z } from 'zod';

/**
 * Autorização por permissão lida do banco (ADR-0053). Três peças, nesta ordem no `buildApp`:
 *
 *     buildAuthMiddleware  → token válido de um dos emissores (`req.user.sub` + `emissor`)
 *     resolverAcesso       → existe, está ativo, e o que pode (`req.acesso`); REESCREVE
 *                            `req.user` para `{ sub: username, authUserId?, filiais? }` (I2)
 *     conexosIdentity      → com que sessão fala com o ERP
 *
 * e, em cada rota, UM guard: `exigirPermissao(p)` ou `somenteAutenticado()`. O token nunca carrega
 * permissão (I1); nenhum guard lê `req.user.role`.
 */

/** O acesso da requisição, preenchido pelo `resolverAcesso`. */
export interface AcessoRequisicao {
    userId: number;
    papel: RoleRef;
    permissoes: ReadonlySet<Permission>;
}

declare global {
    namespace Express {
        interface Request {
            acesso?: AcessoRequisicao;
        }
    }
}

/** Marca do guard "basta estar autenticado e ativo" (JC-6). */
export const GUARD_AUTENTICADO = 'autenticado';
export type GuardMark = Permission | typeof GUARD_AUTENTICADO;

/** Símbolo com que cada guard é marcado — o teste de cobertura por rota lê esta marca. */
const GUARD_MARK = Symbol.for('financeiro.acesso.guard');

type MarkedHandler = RequestHandler & { [GUARD_MARK]?: GuardMark };

/** A marca de um middleware, ou `undefined` se ele não é um guard de acesso. */
export const guardDe = (handler: unknown): GuardMark | undefined =>
    typeof handler === 'function' ? (handler as MarkedHandler)[GUARD_MARK] : undefined;

const marcar = (handler: RequestHandler, mark: GuardMark): RequestHandler => {
    (handler as MarkedHandler)[GUARD_MARK] = mark;
    return handler;
};

/** `sub` do usuário fictício do `DEV_AUTH_BYPASS` (D1). Só existe em local/dev. */
export const DEV_BYPASS_SUB = 'dev-bypass';

/**
 * D1: com `DEV_AUTH_BYPASS` (só possível em local/dev — o `loadAuthEnv` derruba o boot fora
 * disso), toda requisição é deste usuário constante, com as nove permissões, sem tocar o banco.
 * Escritas feitas sob bypass gravam o ator `dev-bypass`.
 */
const ACESSO_DEV_BYPASS: AcessoRequisicao = {
    userId: 0,
    papel: { id: 0, nome: ADMIN_ROLE_NAME },
    permissoes: new Set<Permission>(PERMISSION_CATALOG),
};

const MENSAGEM = {
    NAO_AUTENTICADO: 'Não autenticado.',
    SESSAO_ENCERRADA: 'Sessão encerrada: seu acesso foi desativado ou não existe mais.',
    INDISPONIVEL: 'Não foi possível verificar suas permissões agora. Tente novamente em instantes.',
    SEM_PERMISSAO: 'Você não tem permissão para esta ação.',
} as const;

/** O que o middleware precisa do `AccessService` — permite injetar um falso no teste. */
interface AccessResolver {
    resolver: (chave: ChaveAcesso) => Promise<ResolvedAccess | null>;
}

interface ErrorLogger {
    error: LogService['error'];
}

/** O `sub` de um token do Supabase é o UUID do `auth.users` (Zod antes de qualquer consulta). */
const uuidSchema = z.string().uuid();

export interface ResolverAcessoOptions {
    devBypass: boolean;
    /** Default: `bootstrapAppContainer()` + `container.resolve(AccessService)`, sob demanda. */
    obterServico?: () => Promise<AccessResolver>;
    /** Default: o `LogService` do container. */
    obterLog?: () => ErrorLogger;
}

/**
 * Resolve `sub → app_user → permissões efetivas` a cada requisição (com o cache de 30 s do
 * `AccessService`) e põe o resultado em `req.acesso`.
 *
 * - sem `req.user` → 401 (com bypass, usa o usuário fictício do D1);
 * - usuário inexistente ou inativo → 401 (o front trata 401 como sessão encerrada; R3/I3);
 * - falha ao ler o banco → **503, fail-closed** (R7): nunca "libera por não saber".
 *
 * O `AccessService` é resolvido aqui, sob demanda, e não no `bootstrapAppContainer` — que é
 * compartilhado por ~58 jobs.
 */
export const resolverAcesso = (options: ResolverAcessoOptions): RequestHandler => {
    const obterServico =
        options.obterServico ??
        (async (): Promise<AccessResolver> => {
            await bootstrapAppContainer();
            return container.resolve(AccessService);
        });
    const obterLog = options.obterLog ?? ((): ErrorLogger => container.resolve(LogService));

    return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        if (options.devBypass) {
            req.user = { sub: DEV_BYPASS_SUB };
            req.acesso = ACESSO_DEV_BYPASS;
            next();
            return;
        }

        const user = req.user;
        const sub = user?.sub;
        if (!user || !sub) {
            res.status(401).json({ error: MENSAGEM.NAO_AUTENTICADO });
            return;
        }

        // Emissor `supabase`: o `sub` é o UUID do GoTrue e o dono é achado pelo vínculo
        // `auth_user_id`. Emissor `app` (ou ausente): o `sub` é o username, como sempre.
        const porVinculo = user.emissor === 'supabase';
        if (porVinculo && !uuidSchema.safeParse(sub).success) {
            res.status(401).json({ error: MENSAGEM.SESSAO_ENCERRADA });
            return;
        }
        const chave: ChaveAcesso = porVinculo
            ? { tipo: 'authUserId', valor: sub }
            : { tipo: 'username', valor: sub };

        let acesso: ResolvedAccess | null;
        try {
            acesso = await (await obterServico()).resolver(chave);
        } catch (err: unknown) {
            try {
                await obterLog().error({
                    type: LOG_TYPE.FLOW_ERROR,
                    message: 'falha ao verificar permissões do usuário; requisição recusada (503)',
                    data: {
                        requestId: req.requestId,
                        usuario: sub,
                        rota: `${req.method} ${req.originalUrl}`,
                        erro: err instanceof Error ? err.message : String(err),
                    },
                });
            } catch {
                // logar é best-effort; a resposta fail-closed sai de qualquer jeito.
            }
            res.status(503).json({ error: MENSAGEM.INDISPONIVEL });
            return;
        }

        if (!acesso && porVinculo) {
            // I3: token válido do Supabase sem `app_user` vinculado. Nunca "cria na hora": recusa e
            // avisa quem opera, porque o reparo é o job de sync.
            try {
                await obterLog().error({
                    type: LOG_TYPE.AUTH_DIVERGENCIA,
                    message:
                        'divergência de vínculo: token do Supabase sem app_user correspondente; ' +
                        'rode o sync-supabase-auth',
                    data: { requestId: req.requestId, authUserId: sub },
                });
            } catch {
                // best-effort, como acima.
            }
        }

        if (!acesso?.ativo) {
            res.status(401).json({ error: MENSAGEM.SESSAO_ENCERRADA });
            return;
        }

        // I2: daqui em diante a identidade é o `username` do banco, nunca o UUID nem o e-mail do
        // token. `email`/`role` do token não passam; `filiais` (claim de topo) é preservado.
        req.user = {
            sub: acesso.username,
            ...(acesso.authUserId !== undefined ? { authUserId: acesso.authUserId } : {}),
            ...(user.filiais !== undefined ? { filiais: user.filiais } : {}),
        };
        req.acesso = { userId: acesso.userId, papel: acesso.papel, permissoes: acesso.permissoes };
        next();
    };
};

/** Middleware fora de ordem é defeito de montagem: vira 500, nunca passa adiante. */
const semAcesso = (req: Request): Error =>
    new Error(
        `guard de acesso sem req.acesso em ${req.method} ${req.originalUrl}: ` +
            'resolverAcesso não rodou antes',
    );

/**
 * Guard de rota: passa se `p` está nas efetivas; senão 403 com o código da permissão (Q9).
 * `operacao:ver` responde 404 sem corpo explicativo, como o allow-list antigo (ADR-0042): para
 * quem não opera, o painel simplesmente não existe.
 */
export const exigirPermissao = (permissao: Permission): RequestHandler =>
    marcar((req: Request, res: Response, next: NextFunction): void => {
        if (!req.acesso) {
            next(semAcesso(req));
            return;
        }
        if (req.acesso.permissoes.has(permissao)) {
            next();
            return;
        }
        console.warn(
            `[acesso] negado: usuário '${req.user?.sub ?? 'desconhecido'}' em ${req.method} ` +
                `${req.originalUrl} sem a permissão ${permissao}`,
        );
        if (permissao === PERMISSION.OPERACAO_VER) {
            res.status(404).json({ error: 'Not found' });
            return;
        }
        res.status(403).json({ error: MENSAGEM.SEM_PERMISSAO, permissao });
    }, permissao);

/**
 * Guard explícito das rotas que só exigem usuário existente e ativo (JC-6: `/me/*`,
 * `/conexos/filiais`). Não checa permissão; existe para que "sem guard" nunca seja o default.
 */
export const somenteAutenticado = (): RequestHandler =>
    marcar((req: Request, _res: Response, next: NextFunction): void => {
        if (!req.acesso) {
            next(semAcesso(req));
            return;
        }
        next();
    }, GUARD_AUTENTICADO);
