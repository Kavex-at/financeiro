import 'reflect-metadata';
import bcrypt from 'bcryptjs';
import { container } from 'tsyringe';
import { bootstrapAppContainer } from '../domain/appContainer.js';
import UserRepository from '../domain/repository/auth/UserRepository.js';
import SeedAdminConfig from './SeedAdminConfig.js';

/**
 * Seed do usuário admin do login simples. Espelha `jobs/ingest-permutas.ts`:
 *   reflect-metadata → valida o env → bootstrapAppContainer() → resolve UserRepository →
 *   upsertAdmin() → exit 0/1.
 *
 * O admin nasce (ou é atualizado) com o papel `Administrador` (`role_id`, ADR-0053). Sem o papel —
 * a migration 0066 não aplicada —, sai com 1 e manda rodar as migrations.
 *
 * Credenciais via env, OBRIGATÓRIAS e sem default no código (R12, ADR-0051):
 *   ADMIN_EMAIL (vira username = email do admin) / ADMIN_PASSWORD (mínimo 8 caracteres).
 *
 * Idempotente (UPSERT por username): re-rodar atualiza a senha e reativa a conta. Roda sob
 * demanda (`npm run seed:admin`); NÃO roda dentro do app nem no pre-deploy.
 */
const BCRYPT_ROUNDS = 12;

const config = new SeedAdminConfig();

const main = async (): Promise<void> => {
    // Valida ANTES de conectar no banco: env incompleto não deve nem abrir conexão.
    const { email, password } = config.parse(process.env);
    await bootstrapAppContainer();
    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

    const repository = container.resolve(UserRepository);
    await repository.upsertAdmin(email, passwordHash);

    console.log(
        `[seed-admin] admin pronto: usuário e e-mail "${email}", papel "Administrador", ativo.`,
    );
};

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error('[seed-admin] seed FALHOU:', config.mensagemDeFalha(error));
        process.exit(1);
    });
