import bcrypt from 'bcryptjs';
import { SignJWT } from 'jose';
import { inject, injectable } from 'tsyringe';
import EnvironmentProvider from '../../libs/environment/EnvironmentProvider.js';
import UserRepository from '../../repository/auth/UserRepository.js';

/** Credenciais recebidas no `POST /auth/login`. */
export interface LoginInput {
    username: string;
    password: string;
}

/** Resultado de um login bem-sucedido. */
export interface LoginResult {
    token: string;
    username: string;
    role: string;
}

/** Audiência exigida pelo middleware de auth (espelha o legado Supabase). */
const AUTHENTICATED_AUDIENCE = 'authenticated';

/** Validade do token de login. */
const TOKEN_EXPIRATION = '12h';

/**
 * AuthService — login simples por usuário/senha.
 *
 * Valida a senha (bcrypt) contra `app_user` e, em caso de sucesso, assina um
 * JWT HS256 PRÓPRIO (`sub`=username, `aud`='authenticated') com o
 * `AUTH_JWT_SECRET`. O mesmo segredo é usado pelo middleware (`http/auth.ts`)
 * para validar o token — sem alterar o middleware.
 */
@injectable()
export default class AuthService {
    constructor(
        @inject(UserRepository)
        private userRepository: UserRepository,
        @inject(EnvironmentProvider)
        private environmentProvider: EnvironmentProvider,
    ) {}

    /**
     * Autentica e devolve `{ token, username, role }`, ou `null` quando o
     * usuário não existe / a senha não confere. Lança erro claro se o
     * `AUTH_JWT_SECRET` não estiver configurado (não há como assinar o token).
     */
    public login = async ({ username, password }: LoginInput): Promise<LoginResult | null> => {
        const user = await this.userRepository.findByUsername(username);
        if (!user) return null;
        // Usuário desativado pela gestão (soft-disable): recusa o login como se a
        // credencial fosse inválida (não revela que a conta existe).
        if (!user.ativo) return null;
        // Sem hash local (usuário nascido no GoTrue — ADR-0030 §7): este caminho legado não
        // tem o que comparar. Recusa como credencial inválida; a resposta é indistinguível de
        // "senha errada", e o titular entra pelo caminho do provedor.
        if (!user.passwordHash) return null;

        const passwordMatches = await bcrypt.compare(password, user.passwordHash);
        if (!passwordMatches) return null;

        const token = await this.signToken(user.username, user.role);
        return { token, username: user.username, role: user.role };
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
