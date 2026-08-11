import 'reflect-metadata';
import { container } from 'tsyringe';
import { bootstrapAppContainer } from '../domain/appContainer.js';
import SupabaseAdminClient, {
    SupabaseEmailAlreadyExistsError,
} from '../domain/client/SupabaseAdminClient.js';
import UserRepository from '../domain/repository/auth/UserRepository.js';

/**
 * Seed do usuário admin. Espelha `jobs/ingest-permutas.ts`:
 *   reflect-metadata → bootstrapAppContainer() → resolve → upsert → exit 0/1.
 *
 * Credenciais **exclusivamente** via env: `ADMIN_USERNAME` (default `'admin'`) e
 * `ADMIN_PASSWORD` — **sem default**. O default hardcoded que existia aqui foi REMOVIDO
 * (ADR-0030 §9): uma senha de administrador em código-fonte, num repositório, é uma senha
 * pública — e repeti-la nesta doc-comment a manteria pública, então ela não é citada. Sem
 * `ADMIN_PASSWORD` no ambiente o job **falha e sai com 1**, em vez de semear silenciosamente
 * uma credencial que qualquer pessoa com acesso ao repo conhece.
 *
 * A conta é criada **no GoTrue** (custódia da credencial) e o `auth_user_id` é gravado na
 * linha local — senão o admin semeado não passaria pelo fail-closed de `appUserContext`.
 * Idempotente: re-rodar reaproveita o registro existente no provedor.
 *
 * ⚠️ Este job é o **escape hatch** contra a perda de acesso à gestão de usuários — e a
 * remoção do default o **encarece de propósito**. A guarda barata contra o lockout continua
 * sendo I-Usuario-6 (um admin não pode desativar a si mesmo).
 *
 * Rodar como pre-deploy (após `npm run migrate`) ou sob demanda. NÃO roda dentro do app.
 */
const main = async (): Promise<void> => {
    const username = process.env.ADMIN_USERNAME ?? 'admin';
    const password = process.env.ADMIN_PASSWORD;
    if (!password) {
        throw new Error(
            'ADMIN_PASSWORD is required — the hardcoded default was removed on purpose ' +
                '(a password in source control is a public password). Set ADMIN_PASSWORD in ' +
                'the environment and re-run.',
        );
    }

    await bootstrapAppContainer();
    const supabaseAdmin = container.resolve(SupabaseAdminClient);
    const repository = container.resolve(UserRepository);

    // 1) Provedor de identidade — idempotente: um seed repetido reaproveita a conta.
    let authUserId: string;
    try {
        authUserId = (await supabaseAdmin.createUser({ email: username, password })).id;
        console.log(`[seed-admin] created GoTrue user for "${username}"`);
    } catch (error) {
        if (!(error instanceof SupabaseEmailAlreadyExistsError)) throw error;
        const existing = await repository.findByUsername(username);
        const linked = existing ? (await repository.findById(existing.id))?.authUserId : undefined;
        if (!linked) {
            throw new Error(
                `ADMIN_ALREADY_IN_GOTRUE: "${username}" exists in the identity provider but the ` +
                    'local app_user row has no auth_user_id to link it to. Resolve manually — ' +
                    'guessing which provider account to point at would be worse than failing.',
            );
        }
        authUserId = linked;
        console.log(`[seed-admin] GoTrue user for "${username}" already exists — reusing`);
    }

    // 2) Linha local — a fonte da AUTORIZAÇÃO (I-Usuario-9).
    await repository.upsertAdmin(username, authUserId);

    console.log(`[seed-admin] admin user ready: username="${username}" role="admin"`);
};

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(
            '[seed-admin] seed FAILED:',
            error instanceof Error ? error.message : String(error),
        );
        process.exit(1);
    });
