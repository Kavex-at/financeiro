import { inject, injectable } from 'tsyringe';
import SupabaseAuthClient from '../../client/SupabaseAuthClient.js';
import SupabaseAuthNotConfiguredError from '../../errors/SupabaseAuthNotConfiguredError.js';
import type { SupabaseAdminUser } from '../../interface/auth/SupabaseAuth.js';
import EnvironmentProvider from '../../libs/environment/EnvironmentProvider.js';
import UserRepository from '../../repository/auth/UserRepository.js';

/** O que o seed fez no Supabase Auth. */
export type ResultadoSeed =
    | { supabase: 'criado' | 'atualizado'; authUserId: string }
    | { supabase: 'nao-configurado'; aviso: string };

/**
 * AdminSeeder — a lógica testável do `jobs/seed-admin.ts` (ADR-0054, Task 10).
 *
 * 1. Upsert local do admin (como sempre: `username = email`, papel Administrador, ativo).
 * 2. Com a API admin configurada: acha o usuário no Supabase Auth pelo vínculo ou pelo e-mail;
 *    cria (mesmo hash, e-mail confirmado) ou atualiza senha + e-mail + desbane; grava o vínculo.
 *    O seed TEM a senha em claro, então o update usa `password` (o update ignora `password_hash`,
 *    T-1). Rodar de novo não duplica.
 * 3. Sem a API admin: `AUTH_PROVIDER=local` segue só local com aviso; `AUTH_PROVIDER=supabase`
 *    falha ANTES de gravar, nomeando as variáveis.
 *
 * Falha do GoTrue sobe: a linha local fica (o seed é reexecutável). O `SupabaseAuthClient` é
 * resolvido sob demanda por quem monta este serviço — nada entra no `bootstrapAppContainer`.
 */
@injectable()
export default class AdminSeeder {
    constructor(
        @inject(UserRepository)
        private userRepository: UserRepository,
        @inject(SupabaseAuthClient)
        private supabaseAuthClient: SupabaseAuthClient,
        @inject(EnvironmentProvider)
        private environmentProvider: EnvironmentProvider,
    ) {}

    public semear = async (
        email: string,
        password: string,
        passwordHash: string,
    ): Promise<ResultadoSeed> => {
        const espelhar = await this.supabaseAuthClient.isAdminConfigured();
        if (!espelhar) {
            const env = await this.environmentProvider.getEnvironmentVars();
            if (env.authProvider === 'supabase') {
                throw new SupabaseAuthNotConfiguredError('seed-admin com AUTH_PROVIDER=supabase');
            }
        }

        await this.userRepository.upsertAdmin(email, passwordHash);
        if (!espelhar) {
            return {
                supabase: 'nao-configurado',
                aviso: 'Supabase não configurado: admin criado só no banco',
            };
        }

        const admin = await this.userRepository.findByUsername(email);
        if (!admin)
            throw new Error(`seed-admin: o admin "${email}" não foi encontrado após o upsert`);

        const existente = await this.acharNoSupabase(admin.authUserId, email);
        if (existente) {
            await this.supabaseAuthClient.adminUpdateUser(existente.id, {
                email,
                password,
                banned: false,
            });
            if (admin.authUserId !== existente.id) {
                await this.userRepository.linkAuthUser(admin.id, existente.id);
            }
            return { supabase: 'atualizado', authUserId: existente.id };
        }

        const criado = await this.supabaseAuthClient.adminCreateUser({ email, passwordHash });
        await this.userRepository.linkAuthUser(admin.id, criado.id);
        return { supabase: 'criado', authUserId: criado.id };
    };

    /** Pelo vínculo, se ele ainda aponta para alguém; senão pelo e-mail. */
    private acharNoSupabase = async (
        authUserId: string | undefined,
        email: string,
    ): Promise<SupabaseAdminUser | null> => {
        if (authUserId) {
            const peloVinculo = await this.supabaseAuthClient.adminGetUser(authUserId);
            if (peloVinculo) return peloVinculo;
        }
        return this.supabaseAuthClient.adminFindUserByEmail(email);
    };
}
