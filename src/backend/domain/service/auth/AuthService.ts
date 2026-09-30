import bcrypt from 'bcryptjs';
import { SignJWT } from 'jose';
import { inject, injectable } from 'tsyringe';
import EnvironmentProvider from '../../libs/environment/EnvironmentProvider.js';
import UserRepository from '../../repository/auth/UserRepository.js';
import LogService from '../LogService.js';

/**
 * Credenciais recebidas no `POST /auth/login`. `username` é o IDENTIFICADOR digitado: e-mail ou
 * usuário legado, já normalizado pela rota. O nome do campo não muda (ADR-0051): front e back sobem
 * em momentos diferentes, e renomear quebraria o login na janela entre os dois deploys.
 */
export interface LoginInput {
    username: string;
    password: string;
}

/**
 * Resultado de um login bem-sucedido (D10). Modo `local`: `{ token, username, role, email? }`, o
 * formato de hoje. Modo `supabase` (e `/auth/refresh`): também `refreshToken` e `expiresAt`.
 */
export interface LoginResult {
    token: string;
    /** Só no modo `supabase`: o front o usa para renovar a sessão. */
    refreshToken?: string;
    /** Só no modo `supabase`: expiração do `token`, em segundos desde a época. */
    expiresAt?: number;
    /** `username` CANÔNICO do banco (o `sub`), nunca o identificador digitado. */
    username: string;
    role: string;
    /** E-mail cadastrado, para exibição. Nunca vai para o token (ADR-0051, Q1). */
    email?: string;
}

/** Audiência exigida pelo middleware de auth (espelha o legado Supabase). */
const AUTHENTICATED_AUDIENCE = 'authenticated';

/** Validade do token de login. */
const TOKEN_EXPIRATION = '12h';

/**
 * AuthService — login simples por e-mail ou usuário + senha.
 *
 * O identificador casa, sem distinção de caixa, com o `email` OU o `username` de um usuário.
 * Valida a senha (bcrypt) e, em caso de sucesso, assina um JWT HS256 PRÓPRIO (`sub`=username
 * canônico, `aud`='authenticated') com o `AUTH_JWT_SECRET`. O mesmo segredo é usado pelo
 * middleware (`http/auth.ts`) para validar o token — sem alterar o middleware.
 *
 * `sub` continua sendo o `username` até o passo 3 do plano de auth (ADR-0051): é a identidade de
 * auditoria gravada nos ledgers, a chave do vínculo Conexos e do allow-list do Painel.
 */
@injectable()
export default class AuthService {
    constructor(
        @inject(UserRepository)
        private userRepository: UserRepository,
        @inject(EnvironmentProvider)
        private environmentProvider: EnvironmentProvider,
        @inject(LogService)
        private logService: LogService,
    ) {}

    /**
     * Autentica e devolve `{ token, username, role, email? }`, ou `null` quando nenhum usuário
     * casa, o usuário está inativo ou a senha não confere — os três com a mesma resposta, para não
     * revelar se a conta existe (I2). Lança erro claro se o `AUTH_JWT_SECRET` não estiver
     * configurado (não há como assinar o token).
     */
    public login = async ({ username, password }: LoginInput): Promise<LoginResult | null> => {
        const candidates = await this.userRepository.findByLoginIdentifier(username);
        if (candidates.length > 1) {
            // Duas linhas para um identificador violam I3 (a escrita deveria ter recusado). O
            // sistema nunca escolhe uma: recusa, e avisa quem opera.
            await this.logService.error({
                type: 'BUSINESS_ERROR',
                message:
                    `login recusado: o identificador casa com ${candidates.length} usuários ` +
                    '(o e-mail de um, o usuário de outro). Corrija o cadastro em /usuarios.',
                statusCode: 401,
                data: { ids: candidates.map((c) => c.id) },
            });
            return null;
        }
        const [user] = candidates;
        if (!user) return null;
        // Usuário desativado pela gestão (soft-disable): recusa o login como se a
        // credencial fosse inválida (não revela que a conta existe).
        if (!user.ativo) return null;

        const passwordMatches = await bcrypt.compare(password, user.passwordHash);
        if (!passwordMatches) return null;

        const token = await this.signToken(user.username, user.role);
        return {
            token,
            username: user.username,
            role: user.role,
            ...(user.email !== undefined ? { email: user.email } : {}),
        };
    };

    private signToken = async (username: string, role: string): Promise<string> => {
        const env = await this.environmentProvider.getEnvironmentVars();
        if (!env.authJwtSecret) {
            throw new Error(
                'AUTH_JWT_SECRET is not configured — cannot sign login tokens. ' +
                    'Set AUTH_JWT_SECRET in the backend environment.',
            );
        }
        const secret = new TextEncoder().encode(env.authJwtSecret);
        return new SignJWT({ role })
            .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
            .setSubject(username)
            .setAudience(AUTHENTICATED_AUDIENCE)
            .setIssuedAt()
            .setExpirationTime(TOKEN_EXPIRATION)
            .sign(secret);
    };
}
