import 'reflect-metadata';
import bcrypt from 'bcryptjs';
import { container } from 'tsyringe';
import { bootstrapAppContainer } from '../domain/appContainer.js';
import AdminSeeder from '../domain/service/auth/AdminSeeder.js';
import SeedAdminConfig from './SeedAdminConfig.js';

/**
 * Seed do usuário admin. Espelha `jobs/ingest-permutas.ts`:
 *   reflect-metadata → valida o env → bootstrapAppContainer() → resolve AdminSeeder → exit 0/1.
 *
 * O admin nasce (ou é atualizado) com o papel `Administrador` (`role_id`, ADR-0053). Sem o papel —
 * a migration 0066 não aplicada —, sai com 1 e manda rodar as migrations.
 *
 * Com a API admin do Supabase configurada (`SUPABASE_URL` + `SUPABASE_SECRET_KEY`, ADR-0056), o
 * admin também é criado/atualizado no Supabase Auth, com a mesma senha, e vinculado. Sem ela, em
 * `AUTH_PROVIDER=local`, fica só no banco (com aviso); em `AUTH_PROVIDER=supabase`, sai com 1.
 * O `SupabaseAuthClient` é resolvido sob demanda aqui — o `bootstrapAppContainer` continua só o do
 * banco (gotcha dos ~58 jobs).
 *
 * Credenciais via env, OBRIGATÓRIAS e sem default no código (R12, ADR-0051):
 *   ADMIN_EMAIL (vira username = email do admin) / ADMIN_PASSWORD (mínimo 8 caracteres).
 *
 * Idempotente: re-rodar atualiza a senha e reativa a conta, nos dois lados. Roda sob demanda
 * (`npm run seed:admin`); NÃO roda dentro do app nem no pre-deploy.
 */
const BCRYPT_ROUNDS = 12;

const config = new SeedAdminConfig();

const main = async (): Promise<void> => {
    // Valida ANTES de conectar no banco: env incompleto não deve nem abrir conexão.
    const { email, password } = config.parse(process.env);
    await bootstrapAppContainer();
    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

    const resultado = await container.resolve(AdminSeeder).semear(email, password, passwordHash);

    console.log(
        `[seed-admin] admin pronto: usuário e e-mail "${email}", papel "Administrador", ativo.`,
    );
    if (resultado.supabase === 'nao-configurado') {
        console.warn(`[seed-admin] ${resultado.aviso}.`);
    } else {
        console.log(
            `[seed-admin] Supabase Auth: ${resultado.supabase} e vinculado (${resultado.authUserId}).`,
        );
    }
};

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error('[seed-admin] seed FALHOU:', config.mensagemDeFalha(error));
        process.exit(1);
    });
