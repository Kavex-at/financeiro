import 'reflect-metadata';
import { type NextFunction, type Request, type Response, Router } from 'express';
import { decodeProtectedHeader } from 'jose';
import { container } from 'tsyringe';
import { z } from 'zod';
import { bootstrapAppContainer } from '../domain/appContainer.js';
import ConexosSessionResolver from '../domain/client/ConexosSessionResolver.js';
import CurrentPasswordInvalidError from '../domain/errors/CurrentPasswordInvalidError.js';
import PasswordPolicyError from '../domain/errors/PasswordPolicyError.js';
import SupabaseAuthUnavailableError from '../domain/errors/SupabaseAuthUnavailableError.js';
import { PERMISSION } from '../domain/interface/auth/Permission.js';
import type { AlvoPerfil } from '../domain/interface/perfil/AtividadeUsuarioInterface.js';
import {
    atividadeQuerySchema,
    historicoQuerySchema,
    perfilQuerySchema,
} from '../domain/interface/perfil/PerfilQuerySchemas.js';
import OwnPasswordService from '../domain/service/auth/OwnPasswordService.js';
import PasswordPolicy from '../domain/service/auth/PasswordPolicy.js';
import PerfilService from '../domain/service/perfil/PerfilService.js';
import { somenteAutenticado } from '../http/acesso.js';
import { asyncHandler } from '../http/asyncHandler.js';
import { extractBearerToken } from '../http/auth.js';
import {
    MENSAGEM_MUITAS_TENTATIVAS,
    type SessionLimiterOptions,
    buildOwnPasswordLimiter,
} from '../http/rateLimit.js';
import respondHandlerError from '../http/respondHandlerError.js';
import { validateInput } from '../http/validate.js';

/**
 * Zod no boundary — corpo do `POST /me/senha` (ADR-0059). `.strict()`: campo extra é 400. Sem
 * `trim`: espaço faz parte da senha.
 */
const ownPasswordBodySchema = z
    .object({
        senhaAtual: z.string().min(1),
        novaSenha: z.string().min(1),
    })
    .strict();

/** `error` em português; o front lê só `codigo`. */
const RESPOSTA_SENHA = {
    POLITICA: 'A senha nova não atende à política de senha.',
    SENHA_ATUAL_INVALIDA: 'A senha atual não confere.',
    AUTH_INDISPONIVEL: 'Serviço de autenticação indisponível; nada foi alterado.',
} as const;

export interface MeRouterOptions {
    /** Só no teste: `skip: () => false` e `store` isolado ligam o limitador sob o Jest. */
    limiters?: SessionLimiterOptions;
}

/** `alg` do cabeçalho do Bearer (o `auth` já verificou o token; aqui só se lê o cabeçalho). */
const algDoBearer = (token?: string): string | undefined => {
    if (token === undefined) return undefined;
    try {
        return decodeProtectedHeader(token).alg;
    } catch {
        return undefined;
    }
};

/** Mapeia os erros da troca de senha; `false` = não é deste contrato (sobe como 500). */
const responderErroDeSenha = (res: Response, error: unknown): boolean => {
    if (error instanceof PasswordPolicyError) {
        res.status(400).json({
            codigo: 'POLITICA',
            regras: error.regras,
            error: RESPOSTA_SENHA.POLITICA,
        });
        return true;
    }
    if (error instanceof CurrentPasswordInvalidError) {
        // Nunca 401: para o front, 401 é "sessão expirada" e abre o modal de re-login.
        res.status(422).json({
            codigo: 'SENHA_ATUAL_INVALIDA',
            error: RESPOSTA_SENHA.SENHA_ATUAL_INVALIDA,
        });
        return true;
    }
    if (error instanceof SupabaseAuthUnavailableError) {
        if (error.rateLimited) {
            res.status(429).json({
                codigo: 'MUITAS_TENTATIVAS',
                error: MENSAGEM_MUITAS_TENTATIVAS,
            });
            return true;
        }
        res.status(503).json({
            codigo: 'AUTH_INDISPONIVEL',
            error: RESPOSTA_SENHA.AUTH_INDISPONIVEL,
        });
        return true;
    }
    return false;
};

// ─── Perfil pessoal (ADR-0058) ───────────────────────────────────────────────────────────────────
//
// Três leituras do PRÓPRIO usuário. O alvo vem EXCLUSIVAMENTE da identidade autenticada
// (`req.acesso.userId` + `req.user.sub`); nenhuma query escolhe o alvo, e parâmetro desconhecido
// (`userId`, `username`, …) é recusado com 400 pelo Zod `.strict()` (I1). Só leitura, sem ERP.
// `PerfilService` é resolvido sob demanda aqui — nada novo no `bootstrapAppContainer` (Gotchas).

/** O alvo da leitura. Sem `req.acesso` a cadeia de acesso não rodou: erro interno explícito. */
const alvoDaSessao = (req: Request, rota: string): AlvoPerfil => {
    const acesso = req.acesso;
    const username = req.user?.sub;
    if (!acesso || !username) {
        throw new Error(`GET ${rota} sem req.acesso: resolverAcesso não rodou`);
    }
    return { userId: acesso.userId, username };
};

/** 400 no formato de `routes/metricas.ts` (`{ error, details }`). */
const recusar = (res: Response, error: string, details: unknown): void => {
    res.status(400).json({ error, details });
};

/**
 * Responde a leitura com `no-store` (o perfil muda sem o token mudar). Erro de domínio declarado
 * (`PerfilQueryInvalidError`: período longo demais, cursor adulterado) responde com o PRÓPRIO
 * status (400) via `respondHandlerError` — o `errorMiddleware` central achataria em 500 e ainda
 * registraria um erro de servidor por um erro do cliente. O resto segue ao middleware central.
 */
const responderLeitura = async (
    req: Request,
    res: Response,
    ler: () => Promise<unknown>,
): Promise<void> => {
    try {
        const corpo = await ler();
        res.setHeader('Cache-Control', 'no-store');
        res.json(corpo);
    } catch (err) {
        if (!respondHandlerError(req, res, err)) throw err;
    }
};

/**
 * Rotas do PRÓPRIO usuário autenticado. Montado após o auth e o `resolverAcesso`; todas exigem só
 * usuário existente e ativo (JC-6), com o guard explícito `somenteAutenticado()`.
 */
export const buildMeRouter = ({ limiters = {} }: MeRouterOptions = {}): Router => {
    const router = Router();

    // GET /me/conexos-status — { status: 'ok' | 'falha' | 'ausente' }.
    //   ok      = a credencial Conexos do usuário logou (execuções saem no nome dele);
    //   falha   = tem vínculo, mas a credencial não logou → opera via robô (avisar!);
    //   ausente = sem vínculo → opera via robô (normal, sem alarde).
    router.get(
        '/conexos-status',
        somenteAutenticado(),
        asyncHandler(async (req, res) => {
            await bootstrapAppContainer();
            const resolver = container.resolve(ConexosSessionResolver);
            const username = req.user?.sub;
            const status = username ? await resolver.testarVinculo(username) : 'ausente';
            res.json({ status });
        }),
    );

    // GET /me/permissoes — o que ESTE usuário pode, calculado no servidor (ADR-0053). É a fonte
    // única do front (`usePermissoes`): nav, cards, páginas e botões se escondem por aqui. Esconder
    // é ergonomia; o gate real continua sendo o guard de cada rota (I2).
    //
    // `operacao` é compatibilidade com o front da v0.43 na janela de deploy (R10): deriva de
    // `operacao:ver` e sai num tweak posterior. `no-store` porque a permissão muda sem o token mudar.
    router.get(
        '/permissoes',
        somenteAutenticado(),
        asyncHandler(async (req, res) => {
            const acesso = req.acesso;
            if (!acesso) {
                throw new Error('GET /me/permissoes sem req.acesso: resolverAcesso não rodou');
            }
            const permissoes = [...acesso.permissoes].sort();
            res.setHeader('Cache-Control', 'no-store');
            res.json({
                permissoes,
                papel: acesso.papel,
                operacao: acesso.permissoes.has(PERMISSION.OPERACAO_VER),
            });
        }),
    );

    // GET /me/senha/politica — a política da troca da própria senha (ADR-0059).
    router.get('/senha/politica', somenteAutenticado(), (_req: Request, res: Response) => {
        res.json(container.resolve(PasswordPolicy).descrever());
    });

    // POST /me/senha — troca a PRÓPRIA senha provando a atual (ADR-0059). Identidade = `req.user.sub`
    // (username do banco, I2). 204 | 400 POLITICA | 422 SENHA_ATUAL_INVALIDA | 429 | 503; nunca 401.
    router.post(
        '/senha',
        somenteAutenticado(),
        // Validação ANTES do limitador: corpo malformado não gasta o balde do usuário.
        (req: Request, res: Response, next: NextFunction) => {
            const parsed = validateInput(ownPasswordBodySchema, req.body);
            if (!parsed.success) {
                res.status(parsed.status).json(parsed.body);
                return;
            }
            res.locals.senha = parsed.data;
            next();
        },
        buildOwnPasswordLimiter(limiters),
        asyncHandler(async (req, res) => {
            const corpo = ownPasswordBodySchema.parse(res.locals.senha);
            const username = req.user?.sub;
            if (!username) throw new Error('POST /me/senha sem req.user: auth não rodou');
            const token = extractBearerToken(req.headers.authorization);
            await bootstrapAppContainer();
            try {
                await container.resolve(OwnPasswordService).alterar({
                    username,
                    senhaAtual: corpo.senhaAtual,
                    novaSenha: corpo.novaSenha,
                    ...(token !== undefined ? { tokenDoChamador: token } : {}),
                    algDoToken: algDoBearer(token),
                });
                res.status(204).end();
            } catch (error) {
                if (!responderErroDeSenha(res, error)) throw error;
            }
        }),
    );

    // GET /me — identidade, papel, vínculo Conexos e permissões com a origem de cada uma.
    router.get(
        '/',
        somenteAutenticado(),
        asyncHandler(async (req, res) => {
            const parsed = perfilQuerySchema.safeParse(req.query);
            if (!parsed.success) {
                recusar(res, 'GET /me não aceita parâmetros', parsed.error.flatten());
                return;
            }
            const alvo = alvoDaSessao(req, '/me');
            await bootstrapAppContainer();
            await responderLeitura(req, res, () => container.resolve(PerfilService).perfil(alvo));
        }),
    );

    // GET /me/atividade?periodo=hoje|semana|mes|personalizado&inicio&fim — KPIs por frente, com o
    // período anterior para a comparação. Default: semana (a grade sexta 18:00 de /metricas).
    router.get(
        '/atividade',
        somenteAutenticado(),
        asyncHandler(async (req, res) => {
            const parsed = atividadeQuerySchema.safeParse(req.query);
            if (!parsed.success) {
                recusar(
                    res,
                    'periodo deve ser hoje, semana, mes ou personalizado (com inicio e fim AAAA-MM-DD); nenhum outro parâmetro é aceito',
                    parsed.error.flatten(),
                );
                return;
            }
            const alvo = alvoDaSessao(req, '/me/atividade');
            const { periodo, inicio, fim } = parsed.data;
            await bootstrapAppContainer();
            await responderLeitura(req, res, () =>
                container.resolve(PerfilService).atividade({
                    alvo,
                    periodo: {
                        tipo: periodo,
                        ...(inicio !== undefined ? { inicio } : {}),
                        ...(fim !== undefined ? { fim } : {}),
                    },
                }),
            );
        }),
    );

    // GET /me/historico?cursor&frente&tipo&status&inicio&fim — keyset, 25 por página, default 30 dias.
    router.get(
        '/historico',
        somenteAutenticado(),
        asyncHandler(async (req, res) => {
            const parsed = historicoQuerySchema.safeParse(req.query);
            if (!parsed.success) {
                recusar(
                    res,
                    'filtros do histórico inválidos (frente, tipo, status, inicio/fim AAAA-MM-DD, cursor); nenhum outro parâmetro é aceito',
                    parsed.error.flatten(),
                );
                return;
            }
            const alvo = alvoDaSessao(req, '/me/historico');
            const { cursor, ...filtros } = parsed.data;
            await bootstrapAppContainer();
            await responderLeitura(req, res, () =>
                container.resolve(PerfilService).historico({
                    alvo,
                    filtros,
                    ...(cursor !== undefined ? { cursor } : {}),
                }),
            );
        }),
    );

    return router;
};

export default buildMeRouter();
