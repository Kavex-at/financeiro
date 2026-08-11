import { inject, injectable } from 'tsyringe';
import { z } from 'zod';
import SupabaseAdminClient, {
    SupabaseEmailAlreadyExistsError,
} from '../../client/SupabaseAdminClient.js';
import SecretCipher from '../../libs/crypto/SecretCipher.js';
import UserRepository, {
    type AppUserPublic,
    UsernameAlreadyExistsError,
} from '../../repository/auth/UserRepository.js';
import AppUserContextCache from './AppUserContextCache.js';

/** Papéis válidos na plataforma. `admin` gere usuários; `operador` só opera. */
export const USER_ROLES = ['admin', 'operador'] as const;
export type UserRole = (typeof USER_ROLES)[number];

/** Least privilege (ADR-0030 §9): promover a `admin` é ato explícito e separado. */
const DEFAULT_ROLE: UserRole = 'operador';

/**
 * Vínculo Conexos no boundary: login + senha em CLARO (o service cifra). Ambos
 * juntos, ou nenhum. `conexosPassword` vazio no PATCH = manter a senha atual.
 */
export const vinculoConexosSchema = z.object({
    conexosUsername: z.string().trim().min(1),
    conexosPassword: z.string().min(1),
});

/** Zod no boundary — **U1**, convite (o caminho padrão). Sem senha: o titular define a dele. */
export const inviteUserSchema = z.object({
    username: z.string().trim().toLowerCase().email('email inválido'),
    role: z.enum(USER_ROLES).default(DEFAULT_ROLE),
});
export type InviteUserInput = z.infer<typeof inviteUserSchema>;

/** Zod no boundary — **U3**, fallback com senha (não depende de SMTP). */
export const createUserSchema = z.object({
    username: z.string().trim().toLowerCase().email('email inválido'),
    password: z.string().min(8, 'a senha deve ter ao menos 8 caracteres'),
    role: z.enum(USER_ROLES).default(DEFAULT_ROLE),
    conexosUsername: z.string().trim().min(1).optional(),
    conexosPassword: z.string().min(1).optional(),
});
export type CreateUserInput = z.infer<typeof createUserSchema>;

/** Zod no boundary — solicitação PÚBLICA de redefinição de senha (anti-enumeração no route). */
export const forgotPasswordSchema = z.object({
    username: z.string().trim().toLowerCase().email('email inválido'),
});

/**
 * I-Usuario-6 — um admin não pode desativar a si mesmo. Guarda mínima e barata contra a
 * perda de acesso à gestão de usuários; o route traduz para **403 com mensagem explícita**.
 * Desativar **outro** admin continua permitido.
 */
export class SelfDeactivationError extends Error {
    constructor(username: string) {
        super(`FORBIDDEN: user ${username} cannot deactivate themselves`);
        this.name = 'SelfDeactivationError';
    }
}

/** Resultado de `setAtivo` — carrega a DEGRADAÇÃO, quando houver (I-Usuario-8). */
export interface SetAtivoResult {
    id: number;
    ativo: boolean;
    /**
     * `'ok'` — as duas barreiras aplicadas. `'falhou'` — a local valeu, o ban no provedor
     * não: o acesso ESTÁ revogado (≤ TTL), mas a sessão viva ainda pode ser renovada.
     * `'nao-aplicavel'` — usuário ainda não migrado (`auth_user_id IS NULL`).
     */
    banGoTrue: 'ok' | 'falhou' | 'nao-aplicavel';
}

/**
 * Resposta CONSTANTE de `solicitarRedefinicaoSenha`. O objeto é o mesmo exista ou não o
 * usuário, esteja ele ativo ou não, funcione o SMTP ou não.
 */
const FORGOT_PASSWORD_RESPONSE = Object.freeze({
    enviado: true,
    mensagem: 'Se este e-mail estiver cadastrado, você receberá um link para redefinir a senha.',
});
export type ForgotPasswordResult = typeof FORGOT_PASSWORD_RESPONSE;

/**
 * `UserAdminService` — gestão de usuários da plataforma.
 *
 * Depois da ADR-0030 este service **orquestra dois sistemas**: o GoTrue (custódia da
 * credencial) e o `app_user` (autorização). A regra que atravessa tudo aqui é a
 * **atomicidade entre sistemas**: as duas pontas nascem juntas ou nenhuma nasce.
 *
 * A AUTORIZAÇÃO (só admin) continua sendo feita no route (`requireRole('admin')`); este
 * service assume que o chamador já foi autorizado — exceto por I-Usuario-6, que é regra de
 * DOMÍNIO (quem é o alvo em relação ao ator) e por isso vive aqui.
 *
 * **`bcryptjs` saiu deste arquivo.** A custódia da senha é do provedor; o único consumidor
 * que resta é o login legado (`AuthService`), que apenas COMPARA, enquanto o rollout durar.
 */
@injectable()
export default class UserAdminService {
    constructor(
        @inject(UserRepository)
        private userRepository: UserRepository,
        @inject(SecretCipher)
        private secretCipher: SecretCipher,
        @inject(SupabaseAdminClient)
        private supabaseAdmin: SupabaseAdminClient,
        @inject(AppUserContextCache)
        private contextCache: AppUserContextCache,
    ) {}

    /** Lista todos os usuários (sem hash de senha). */
    public list = async (): Promise<AppUserPublic[]> => this.userRepository.listAll();

    /**
     * **U1 — `convidarUsuario`.** Caminho PADRÃO de entrada. O titular define a própria
     * senha, e nenhum humano além dele a conhece — é o que sustenta atribuir uma baixa
     * `fin010` a uma pessoa. **Depende de SMTP.**
     *
     * Nasce `ativo = false` + `convite_pendente = true` (estado `convidado`). A ativação
     * acontece em `appUserContext`, e **só contra confirmação no provedor** (U2).
     */
    public convidarUsuario = async (
        input: InviteUserInput | { username: string; role?: UserRole },
        criadoPor?: string,
    ): Promise<AppUserPublic> => {
        const username = input.username;
        await this.assertUsernameIsFree(username);
        const goTrueUser = await this.supabaseAdmin.inviteByEmail(username);
        return this.createLocalRowOrCompensate(goTrueUser.id, {
            username,
            role: input.role ?? DEFAULT_ROLE,
            ativo: false,
            convitePendente: true,
            ...(criadoPor !== undefined ? { createdBy: criadoPor } : {}),
        });
    };

    /**
     * **U3 — `cadastrarUsuarioComSenha`.** FALLBACK para quando o convite não chega (SMTP
     * ausente, e-mail em quarentena, domínio corporativo bloqueando o remetente). O usuário
     * **nasce `ativo`**: não há aceite a esperar, a credencial já existe.
     *
     * Custo aceito e reconhecido: aqui **um humano além do titular conhece a senha inicial**.
     * É o preço do fallback, e a razão de ele ser o caminho secundário.
     */
    public cadastrarUsuarioComSenha = async (
        input: CreateUserInput,
        criadoPor?: string,
    ): Promise<AppUserPublic> => {
        await this.assertUsernameIsFree(input.username);
        const goTrueUser = await this.supabaseAdmin.createUser({
            email: input.username,
            password: input.password,
        });
        const created = await this.createLocalRowOrCompensate(goTrueUser.id, {
            username: input.username,
            role: input.role ?? DEFAULT_ROLE,
            ativo: true,
            convitePendente: false,
            ...(criadoPor !== undefined ? { createdBy: criadoPor } : {}),
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
     * **U4 / U5 — `desativarUsuario` / `ativarUsuario`.** A ORDEM é a regra, não um detalhe:
     *
     * | # | Passo | O que impede | Latência |
     * |---|---|---|---|
     * | 1 | `ativo = false` local + invalidação do cache | qualquer request, **inclusive leitura** | ≤ 30 s |
     * | 2 | ban no GoTrue | **renovar** o refresh token / abrir sessão nova | imediata |
     *
     * - **Falha no passo 1 ⇒ aborta tudo.** Não existe desativação que só bane no provedor:
     *   é o passo 1 que o fail-closed enforça a cada request.
     * - **Falha no passo 2 ⇒ sucesso PARCIAL auditado**, não erro duro. O `ativo = false`
     *   local **já revoga**; retornar erro levaria o admin a crer que não desativou ninguém
     *   quando na prática desativou — e ele agiria por fora.
     *
     * Idempotente nas duas direções. Reativar **preserva o vínculo Conexos** (I-Usuario-5):
     * as colunas nunca são limpas, porque `getVinculoConexos` já filtra `AND ativo = true` —
     * o vínculo fica **inerte, não perdido**, e reativar não exige redigitar a senha do ERP.
     */
    public setAtivo = async (
        id: number,
        ativo: boolean,
        ator?: string,
    ): Promise<SetAtivoResult> => {
        const target = await this.userRepository.findById(id);
        if (!target) throw new Error(`NOT_FOUND: user ${id} not found`);

        // I-Usuario-6 — ANTES de qualquer escrita. Só DESATIVAR é destrutivo; reativar a si
        // mesmo não perde acesso a nada.
        if (!ativo && ator !== undefined && target.username === ator) {
            throw new SelfDeactivationError(ator);
        }

        // ── Passo 1: a barreira que vale a cada request ──────────────────────────────────
        const ok = await this.userRepository.setAtivo(id, ativo);
        if (!ok) throw new Error(`NOT_FOUND: user ${id} not found`);
        if (ativo && target.convitePendente) {
            // Ativar por ato administrativo encerra o convite: sem isso a linha ficaria
            // `ativo = true` E `convite_pendente = true`, estado que a state-machine não tem.
            await this.userRepository.setConvitePendente(id, false);
        }
        // SÍNCRONO e antes de responder — é isto que faz o "≤30 s" ser um teto real.
        //
        // **As DUAS identidades da mesma pessoa.** Durante as fases 2–3 do rollout ela pode
        // estar com um token do provedor (entrada chaveada pelo `auth_user_id`) OU com um
        // token legado ainda válido (entrada chaveada pelo username). Invalidar só a
        // primeira deixaria a sessão legada operando até o TTL cheio — e a UI teria dito ao
        // admin que o acesso foi revogado. Some na Fase 4, com o esquema legado.
        if (target.authUserId) {
            this.contextCache.invalidate(target.authUserId);
        }
        this.contextCache.invalidate(this.contextCache.legacyKeyFor(target.username));

        // ── Passo 2: impede RENOVAR a sessão. Degradável. ────────────────────────────────
        if (!target.authUserId) {
            return { id, ativo, banGoTrue: 'nao-aplicavel' };
        }
        try {
            await this.supabaseAdmin.setBanned(target.authUserId, !ativo);
            return { id, ativo, banGoTrue: 'ok' };
        } catch (error) {
            console.warn(
                `[UserAdminService] partial success on setAtivo(${id}, ${ativo}): local flag ` +
                    'applied and context cache invalidated, but the GoTrue ban/unban failed — ' +
                    'access IS revoked locally; what is lost is the guarantee against session ' +
                    `renewal. cause: ${error instanceof Error ? error.message : String(error)}`,
            );
            return { id, ativo, banGoTrue: 'falhou' };
        }
    };

    /**
     * `redefinirSenhaDeTerceiro` — **mudou de natureza, não só de implementação.** Antes o
     * admin GRAVAVA um hash e passava a senha por fora (WhatsApp, presencialmente). Agora ele
     * **dispara um link**; a senha nova nasce e morre entre o titular e o provedor.
     *
     * É o que permite atribuir uma baixa `fin010` a uma pessoa **e sustentar a atribuição**:
     * nenhum humano além do titular conhece a senha de outro. Sem isso, "foi a Marilyn que
     * baixou" é uma afirmação que qualquer admin pode contestar — com razão.
     *
     * **Depende de SMTP, e aqui não há fallback:** voltar a gravar hash reintroduziria
     * exatamente o problema que a mudança resolve.
     */
    public redefinirSenhaDeTerceiro = async (id: number): Promise<void> => {
        const target = await this.userRepository.findById(id);
        if (!target) throw new Error(`NOT_FOUND: user ${id} not found`);
        await this.supabaseAdmin.sendRecoveryLink(target.username);
    };

    /**
     * `solicitarRedefinicaoSenha` — self-service, rota **PÚBLICA**.
     *
     * **A resposta é IDÊNTICA existindo ou não o usuário.** Um endpoint público que
     * diferencia *"e-mail não cadastrado"* de *"enviamos o link"* entrega a lista de
     * funcionários da Columbia a qualquer pessoa na internet, um e-mail por vez — é a
     * primeira coisa que um scanner tenta contra um formulário de recuperação.
     *
     * **Usuário inativo não recebe link**: reset não pode ser porta dos fundos para
     * reativação. A diferença é invisível de fora, por causa da regra anterior.
     *
     * Falha do provedor também não vaza: ela vira warning no log, nunca resposta diferente.
     */
    public solicitarRedefinicaoSenha = async (username: string): Promise<ForgotPasswordResult> => {
        try {
            const user = await this.userRepository.findByUsername(username);
            if (user?.ativo) {
                await this.supabaseAdmin.sendRecoveryLink(user.username);
            }
        } catch (error) {
            console.warn(
                '[UserAdminService] password recovery request failed internally; the response ' +
                    'is intentionally unchanged (anti-enumeration). cause: ' +
                    `${error instanceof Error ? error.message : String(error)}`,
            );
        }
        return FORGOT_PASSWORD_RESPONSE;
    };

    /**
     * Define (ou limpa, com `vinculo=null`) o vínculo Conexos de um usuário. A senha é
     * CIFRADA (AES-GCM) antes de persistir — nunca em claro. Lança se a chave de cripto não
     * estiver configurada (`MissingEncryptionKeyError`) ou o id não existir.
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
     * Pré-checagem local do e-mail. Poupar a chamada ao provedor quando já sabemos do 409
     * evita criar um usuário no GoTrue que teríamos de compensar em seguida — o caminho de
     * compensação existe para o imprevisto, não para o previsível.
     */
    private assertUsernameIsFree = async (username: string): Promise<void> => {
        const existing = await this.userRepository.findByUsername(username);
        if (existing) throw new UsernameAlreadyExistsError(username);
    };

    /**
     * Grava a linha local e, se falhar, **compensa** removendo o usuário recém-criado no
     * provedor (I-Usuario-3: é a ÚNICA situação em que `deleteUser` é permitido).
     *
     * Se a compensação **também** falhar, o erro carrega o e-mail e o `auth_user_id` órfão —
     * é a única pista de que aquele e-mail ficou **queimado** (`auth.users.email` é único), e
     * sem ela o problema aparece semanas depois como "não consigo cadastrar essa pessoa".
     */
    private createLocalRowOrCompensate = async (
        authUserId: string,
        row: {
            username: string;
            role: UserRole;
            ativo: boolean;
            convitePendente: boolean;
            createdBy?: string;
        },
    ): Promise<AppUserPublic> => {
        try {
            return await this.userRepository.create({ ...row, authUserId });
        } catch (localError) {
            try {
                await this.supabaseAdmin.deleteUser(authUserId);
            } catch (compensationError) {
                throw new Error(
                    'ORPHANED_GOTRUE_USER: the local app_user row could not be created AND the ' +
                        `GoTrue compensation failed. E-mail "${row.username}" is now BURNED for ` +
                        `future signups (auth.users.email is unique); orphan auth_user_id=${authUserId}. ` +
                        `local cause: ${localError instanceof Error ? localError.message : String(localError)}; ` +
                        `compensation cause: ${
                            compensationError instanceof Error
                                ? compensationError.message
                                : String(compensationError)
                        }`,
                );
            }
            throw localError;
        }
    };
}

export { SupabaseEmailAlreadyExistsError };
