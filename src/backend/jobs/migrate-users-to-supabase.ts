import 'reflect-metadata';
import { container } from 'tsyringe';
import { bootstrapAppContainer } from '../domain/appContainer.js';
import SupabaseAdminClient, {
    SupabaseEmailAlreadyExistsError,
} from '../domain/client/SupabaseAdminClient.js';
import UserRepository from '../domain/repository/auth/UserRepository.js';

/** Resultado agregado de uma execução (dry-run ou real). */
export interface MigrationReport {
    dryRun: boolean;
    pendentes: number;
    migrados: number;
    falhos: number;
    /** `username` (nunca hash, nunca senha) das linhas que falharam. */
    usernamesComFalha: string[];
}

/**
 * `migrarUsuarioParaSupabase` — job one-shot da Fase 1 do cutover (ADR-0030 §6).
 *
 * > **Ação transitória: nasce com data de morte.** Some na Fase 4, junto de `password_hash` e
 * > do HS256. Vigência 2026-08-06 → Fase 4.
 *
 * ## A regra: a senha atual continua valendo
 *
 * O usuário é criado no GoTrue **reaproveitando o hash bcrypt existente** (o GoTrue também
 * usa bcrypt). **É isto que evita o lockout geral no cutover** — ninguém precisa trocar de
 * senha para continuar trabalhando.
 *
 * ⚠️ **Modo de falha mais provável: o hash é ACEITO mas não confere**, e ninguém descobre até
 * o primeiro login. Daí a regra operacional: **validar numa conta de teste antes de rodar em
 * todo mundo**. A rede de segurança é o reset por e-mail.
 *
 * ## Idempotência POR CONSTRUÇÃO
 *
 * O filtro **é** a condição de idempotência: `auth_user_id IS NULL`. Uma linha já migrada não
 * é selecionada. Re-rodar é seguro **por desenho**, não por verificação adicional — rodar
 * duas vezes com `--execute` migra zero na segunda.
 *
 * ## O job só preenche o ponteiro
 *
 * **Nunca** desativa, **nunca** muda `role`, **nunca** toca `username`, **nunca** cria linha.
 * `username` é imutável (I-Usuario-2) e é o ator da trilha (I-Usuario-1) — um job que o
 * "normalizasse" partiria a auditoria de três frentes. E como faz UPDATE (não INSERT), não é
 * afetado pelo default `'admin'` da migration `0007`.
 *
 * ## Dry-run é o DEFAULT
 *
 * Escreve apenas com `--execute` explícito.
 *
 * Uso: `npm run job:migrate-users` (dry-run) · `npm run job:migrate-users -- --execute`
 */
export const migrateUsersToSupabase = async (options: {
    execute: boolean;
}): Promise<MigrationReport> => {
    const repository = container.resolve(UserRepository);
    const supabaseAdmin = container.resolve(SupabaseAdminClient);

    const pendentes = await repository.listPendingMigration();
    const report: MigrationReport = {
        dryRun: !options.execute,
        pendentes: pendentes.length,
        migrados: 0,
        falhos: 0,
        usernamesComFalha: [],
    };

    console.log(
        `[migrate-users] ${pendentes.length} user(s) pending migration ` +
            `(auth_user_id IS NULL) — mode: ${options.execute ? 'EXECUTE' : 'DRY-RUN'}`,
    );

    for (const user of pendentes) {
        if (!options.execute) {
            // Nem o hash nem qualquer fragmento dele aparece no log — só o `username`.
            console.log(`[migrate-users] would migrate: ${user.username}`);
            continue;
        }
        try {
            if (!user.passwordHash) {
                throw new Error(
                    'no local password_hash to import — this user cannot keep the current ' +
                        'password; invite or register them explicitly instead',
                );
            }
            const goTrueUser = await supabaseAdmin.createUserWithPasswordHash({
                email: user.username,
                passwordHash: user.passwordHash,
            });
            // A ÚNICA escrita local do job.
            await repository.linkAuthUser(user.id, goTrueUser.id);
            report.migrados += 1;
            console.log(`[migrate-users] migrated: ${user.username}`);
        } catch (error) {
            report.falhos += 1;
            report.usernamesComFalha.push(user.username);
            console.error(
                `[migrate-users] FAILED: ${user.username} — ` +
                    `${error instanceof Error ? error.message : String(error)}`,
                error instanceof SupabaseEmailAlreadyExistsError
                    ? '(already exists in the provider: link auth_user_id manually)'
                    : '',
            );
        }
    }

    const restantes = report.pendentes - report.migrados;
    console.log(
        `[migrate-users] done — pending: ${report.pendentes}, migrated: ${report.migrados}, ` +
            `failed: ${report.falhos}${
                report.usernamesComFalha.length > 0
                    ? ` [${report.usernamesComFalha.join(', ')}]`
                    : ''
            }`,
    );

    // GATE DA FASE 3, não relatório (ADR-0030 §6 / I13): desligar
    // AUTH_LEGACY_LOGIN_ENABLED enquanto esta lista não estiver vazia deixa esses usuários
    // SEM NENHUM caminho de login — o legado desligado e eles inexistentes no provedor.
    if (restantes > 0) {
        console.warn(
            `[migrate-users] GATE: ${restantes} user(s) still have auth_user_id IS NULL. ` +
                'AUTH_LEGACY_LOGIN_ENABLED=false (rollout Phase 3) MUST NOT be applied until ' +
                'this count reaches zero — those users would be left with no login path at all.',
        );
    } else {
        console.log(
            '[migrate-users] GATE OPEN: no user pending migration — rollout Phase 3 ' +
                '(AUTH_LEGACY_LOGIN_ENABLED=false) is now safe.',
        );
    }

    return report;
};

const main = async (): Promise<void> => {
    const execute = process.argv.includes('--execute');
    await bootstrapAppContainer();
    const report = await migrateUsersToSupabase({ execute });
    if (report.falhos > 0) {
        throw new Error(
            `${report.falhos} user(s) failed to migrate: ${report.usernamesComFalha.join(', ')}`,
        );
    }
};

// Só roda como CLI — importar o módulo (nos testes) não dispara nada.
if (process.argv[1]?.includes('migrate-users-to-supabase')) {
    main()
        .then(() => process.exit(0))
        .catch((error) => {
            console.error(
                '[migrate-users] migration FAILED:',
                error instanceof Error ? error.message : String(error),
            );
            process.exit(1);
        });
}
