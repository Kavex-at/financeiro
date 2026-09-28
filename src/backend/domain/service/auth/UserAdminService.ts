import bcrypt from 'bcryptjs';
import { inject, injectable } from 'tsyringe';
import { z } from 'zod';
import SecretCipher from '../../libs/crypto/SecretCipher.js';
import UserRepository, {
    type AppUserPublic,
    DEACTIVATE_RESULT,
    SET_EMAIL_RESULT,
} from '../../repository/auth/UserRepository.js';
import LogService from '../LogService.js';

/** Custo do bcrypt — espelha o `seed-admin` (BCRYPT_ROUNDS = 12). */
const BCRYPT_ROUNDS = 12;

/** Papéis válidos na plataforma. `admin` gere usuários; `operador` só opera. */
export const USER_ROLES = ['admin', 'operador'] as const;
export type UserRole = (typeof USER_ROLES)[number];

/** E-mail no boundary: aparado, minúsculo e válido (I4). */
const emailField = z.string().trim().toLowerCase().email('E-mail inválido.');

/**
 * Vínculo Conexos no boundary: login + senha em CLARO (o service cifra). Ambos
 * juntos, ou nenhum. `conexosPassword` vazio no PATCH = manter a senha atual.
 */
export const vinculoConexosSchema = z.object({
    conexosUsername: z.string().trim().min(1),
    conexosPassword: z.string().min(1),
});

/**
 * Zod no boundary — criação de usuário (e-mail + senha + papel + vínculo opcional).
 *
 * O usuário novo nasce com `username = email` (R6). `username` continua aceito como ALIAS de
 * `email`: o front antigo (Vercel) ainda o envia na janela entre os dois deploys. Os dois juntos
 * com valores diferentes são recusados — não há como saber qual o admin quis.
 */
export const createUserSchema = z
    .object({
        email: emailField.optional(),
        username: emailField.optional(),
        password: z.string().min(8, 'a senha deve ter ao menos 8 caracteres'),
        role: z.enum(USER_ROLES).default('operador'),
        conexosUsername: z.string().trim().min(1).optional(),
        conexosPassword: z.string().min(1).optional(),
    })
    .superRefine((input, ctx) => {
        if (input.email === undefined && input.username === undefined) {
            ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Informe o e-mail.' });
        }
        if (
            input.email !== undefined &&
            input.username !== undefined &&
            input.email !== input.username
        ) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: 'E-mail e usuário informados são diferentes.',
            });
        }
    })
    .transform(({ email, username, ...rest }) => ({
        ...rest,
        // O refine garante que ao menos um existe; `?? ''` só satisfaz o tipo.
        email: email ?? username ?? '',
    }));
export type CreateUserInput = z.infer<typeof createUserSchema>;

/**
 * Zod no boundary — edição do e-mail de login. Só `email`: campos extras (ex.: `username`) são
 * descartados, porque nenhuma rota edita `username` (I1).
 */
export const setEmailSchema = z.object({ email: emailField });

/** Zod no boundary — redefinição de senha. */
export const resetPasswordSchema = z.object({
    password: z.string().min(8, 'a senha deve ter ao menos 8 caracteres'),
});

/**
 * UserAdminService — gestão de usuários da plataforma (Fatia A).
 *
 * Encapsula as regras de cadastro: valida o input (Zod), gera o hash bcrypt da
 * senha (nunca guarda a senha em claro) e delega a persistência ao
 * `UserRepository`. A AUTORIZAÇÃO (só admin) é feita no route (guard de papel);
 * este service assume que o chamador já foi autorizado.
 */
@injectable()
export default class UserAdminService {
    constructor(
        @inject(UserRepository)
        private userRepository: UserRepository,
        @inject(SecretCipher)
        private secretCipher: SecretCipher,
        @inject(LogService)
        private logService: LogService,
    ) {}

    /** Lista todos os usuários (sem hash de senha). */
    public list = async (): Promise<AppUserPublic[]> => this.userRepository.listAll();

    /**
     * Cria um usuário com `username = email`. `createdBy` = username do admin (auditoria). Se o
     * input trouxer `conexosUsername` + `conexosPassword`, grava o vínculo Conexos já na criação
     * (senha cifrada). Ambos juntos, ou nenhum. Colisão com o e-mail ou o usuário de outro:
     * `EmailAlreadyInUseError`.
     */
    public create = async (input: CreateUserInput, createdBy?: string): Promise<AppUserPublic> => {
        const passwordHash = await bcrypt.hash(input.password, BCRYPT_ROUNDS);
        const created = await this.userRepository.create({
            email: input.email,
            passwordHash,
            role: input.role,
            ...(createdBy !== undefined ? { createdBy } : {}),
        });
        if (input.conexosUsername && input.conexosPassword) {
            await this.setVinculo(created.id, {
                conexosUsername: input.conexosUsername,
                conexosPassword: input.conexosPassword,
            });
            return { ...created, conexosUsername: input.conexosUsername };
        }
        return created;
    };

    /**
     * Grava o e-mail de login de um usuário, com o admin que editou (`updatedBy`) na trilha.
     * Gravar o mesmo valor é no-op. Lança NOT_FOUND para id inexistente e `EmailAlreadyInUseError`
     * quando o valor já identifica outro usuário.
     */
    public setEmail = async (id: number, email: string, updatedBy: string): Promise<void> => {
        const result = await this.userRepository.setEmail(id, email, updatedBy);
        if (result === SET_EMAIL_RESULT.NOT_FOUND) {
            throw new Error(`NOT_FOUND: user ${id} not found`);
        }
        if (result === SET_EMAIL_RESULT.UPDATED) {
            await this.logService.info({
                type: 'BUSINESS_INFO',
                message: 'e-mail de login do usuário atualizado',
                data: { id, ator: updatedBy },
            });
        }
    };

    /**
     * Define (ou limpa, com `vinculo=null`) o vínculo Conexos de um usuário. A
     * senha é CIFRADA (AES-GCM) antes de persistir — nunca em claro. Lança se a
     * chave de cripto não estiver configurada (`MissingEncryptionKeyError`) ou o
     * id não existir.
     */
    public setVinculo = async (
        id: number,
        vinculo: { conexosUsername: string; conexosPassword: string } | null,
    ): Promise<void> => {
        if (vinculo === null) {
            const ok = await this.userRepository.setVinculoConexos(id, null);
            if (!ok) throw new Error(`NOT_FOUND: user ${id} not found`);
            return;
        }
        const conexosPasswordEnc = await this.secretCipher.encrypt(vinculo.conexosPassword);
        const ok = await this.userRepository.setVinculoConexos(id, {
            conexosUsername: vinculo.conexosUsername,
            conexosPasswordEnc,
        });
        if (!ok) throw new Error(`NOT_FOUND: user ${id} not found`);
    };

    /** True quando a cripto está configurada (habilita o cadastro de vínculo na UI). */
    public vinculoDisponivel = async (): Promise<boolean> => this.secretCipher.isEnabled();

    /**
     * Ativa/desativa o acesso de um usuário. Desativar passa pela guarda da R11 (nem o próprio
     * acesso, nem o último admin ativo), com `actorUsername` = quem pede. Reativar não passa.
     * Lança NOT_FOUND se o id não existir.
     */
    public setAtivo = async (id: number, ativo: boolean, actorUsername: string): Promise<void> => {
        if (!ativo) {
            const result = await this.userRepository.deactivateGuarded(id, actorUsername);
            if (result === DEACTIVATE_RESULT.NOT_FOUND) {
                throw new Error(`NOT_FOUND: user ${id} not found`);
            }
            return;
        }
        const ok = await this.userRepository.setAtivo(id, true);
        if (!ok) throw new Error(`NOT_FOUND: user ${id} not found`);
    };

    /** Redefine a senha de um usuário. Lança se o id não existir. */
    public resetPassword = async (id: number, password: string): Promise<void> => {
        const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
        const ok = await this.userRepository.updatePassword(id, passwordHash);
        if (!ok) throw new Error(`NOT_FOUND: user ${id} not found`);
    };
}
