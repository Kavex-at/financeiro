import path from 'node:path';
import { GetParameterCommand, SSMClient } from '@aws-sdk/client-ssm';
import dotenv from 'dotenv';
import { injectable, singleton } from 'tsyringe';
import { RECEBIMENTO_INGEST_DIAS_PADRAO } from '../../interface/recebimentos/constants.js';
import EnvironmentVars from './model/EnvironmentVars.js';

@singleton()
@injectable()
export default class EnvironmentProvider {
    private environmentVars?: EnvironmentVars;

    public getEnvironmentVars = async (): Promise<EnvironmentVars> => {
        if (!this.environmentVars) {
            this.environmentVars = await this.generateEnvironmentVars();
        }

        return this.environmentVars as EnvironmentVars;
    };

    private generateEnvironmentVars = async (): Promise<EnvironmentVars> => {
        if (!process.env.client_name || process.env.client_name === 'local') {
            return this.GetLocalEnvironmentVars();
        }

        return await this.GetLambdaEnvironmentVars();
    };

    private readEnv = (key: string, fallback = ''): string => process.env[key] || fallback;

    /**
     * Resolve a flag do SISPAG: `SISPAG_ENABLED=true|false` força; sem a env, fica
     * habilitado FORA de produção e bloqueado EM produção (fail-safe — esquecer de
     * setar em prod NÃO expõe o SISPAG).
     */
    private resolveSispagEnabled = (environment: string): boolean => {
        const flag = this.readEnv('SISPAG_ENABLED');
        if (flag === 'true') return true;
        if (flag === 'false') return false;
        return environment !== 'production';
    };

    /**
     * Resolve a flag da Frente IV (Recebimentos): `RECEBIMENTOS_ENABLED=true|false`
     * força; sem a env, fica habilitado FORA de produção e bloqueado EM produção
     * (fail-safe — espelha o SISPAG).
     */
    private resolveRecebimentosEnabled = (environment: string): boolean => {
        const flag = this.readEnv('RECEBIMENTOS_ENABLED');
        if (flag === 'true') return true;
        if (flag === 'false') return false;
        return environment !== 'production';
    };

    /**
     * Janela default da ingestão de extratos (`RECEBIMENTO_INGEST_DIAS`).
     * Valor inválido ou ausente cai no padrão — nunca zero (uma janela de zero
     * dias faria a ingestão rodar e não trazer nada, silenciosamente).
     */
    private resolveIngestDias = (): number => {
        const n = Number(this.readEnv('RECEBIMENTO_INGEST_DIAS'));
        return Number.isInteger(n) && n > 0 ? n : RECEBIMENTO_INGEST_DIAS_PADRAO;
    };

    /**
     * Lê um inteiro positivo de env (poll SEFAZ da NDe) com default. Valor inválido/ausente cai no
     * default — nunca zero (um teto de zero faria o poll não rodar; um intervalo de zero seria busy-loop).
     */
    private resolvePositiveInt = (key: string, fallback: number): number => {
        const n = Number(this.readEnv(key));
        return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
    };

    /** Filiais da ingestão (`RECEBIMENTO_INGEST_FIL_CODS`, CSV). Vazio = todas. */
    private resolveIngestFilCods = (): number[] =>
        this.readEnv('RECEBIMENTO_INGEST_FIL_CODS', '')
            .split(',')
            .map((s) => Number(s.trim()))
            .filter((n) => Number.isInteger(n) && n > 0);

    private parseSSMCredentials = async (
        envVar: string | undefined,
    ): Promise<Record<string, any>> => {
        const raw = await this.GetOptionalSSMParameter(envVar, '{}');

        if (raw === 'placeholder') {
            return {};
        }

        return JSON.parse(raw);
    };

    private readCred = (obj: Record<string, any>, key: string): string => obj[key] || '';

    private GetLocalEnvironmentVars = (): EnvironmentVars => {
        const envPath = path.resolve(process.cwd(), '.env');
        dotenv.config({ path: envPath });

        return new EnvironmentVars({
            databaseConnectionString: this.readEnv('databaseConnectionString'),
            conexosLogin: this.readEnv('CONEXOS_USERNAME'),
            conexosPassword: this.readEnv('CONEXOS_PASSWORD'),
            conexosApiUrl: this.readEnv(
                'CONEXOS_BASE_URL',
                'https://columbiatrading.conexos.cloud/api',
            ),
            // ADR-0009: no hardcoded `2` fallback. Empty env → NaN sentinel
            // that callers (ConexosService.defaultHeaders) must guard.
            conexosFilCod: this.readEnv('CONEXOS_FIL_COD')
                ? Number(this.readEnv('CONEXOS_FIL_COD'))
                : Number.NaN,
            conexosUsnCod: this.readEnv('CONEXOS_USN_COD', '31'),
            supabaseUrl: this.readEnv('SUPABASE_URL') || undefined,
            supabaseServiceRoleKey: this.readEnv('SUPABASE_SERVICE_ROLE_KEY') || undefined,
            authJwtSecret: this.readEnv('AUTH_JWT_SECRET') || undefined,
            environment: this.readEnv('environment', 'local'),
            clientName: this.readEnv('client_name', 'local'),
            awsRegion: this.readEnv('aws_region', this.readEnv('AWS_REGION', 'us-east-1')),
            // Fase 3 (ADR-0013): escrita fin010 desligada por padrão; dry-run ligado por padrão.
            conexosWriteEnabled: this.readEnv('CONEXOS_WRITE_ENABLED') === 'true',
            conexosDryRun: this.readEnv('CONEXOS_DRY_RUN') !== 'false',
            // SN (com299) — gates de go-live: default OFF / gcdCod sentinela 0 (ver EnvironmentVars).
            snLiveWriteEnabled: this.readEnv('SN_LIVE_WRITE_ENABLED') === 'true',
            solicitacaoNumerarioGcdCod: this.readEnv('SN_GCD_COD')
                ? Number(this.readEnv('SN_GCD_COD'))
                : 0,
            conexosCredEncKey: this.readEnv('CONEXOS_CRED_ENC_KEY') || undefined,
            sispagEnabled: this.resolveSispagEnabled(this.readEnv('environment', 'local')),
            recebimentosEnabled: this.resolveRecebimentosEnabled(
                this.readEnv('environment', 'local'),
            ),
            recebimentoIngestDias: this.resolveIngestDias(),
            recebimentoIngestFilCods: this.resolveIngestFilCods(),
            fin014ContaFinanceira: this.readEnv('FIN014_CONTA_FINANCEIRA')
                ? Number(this.readEnv('FIN014_CONTA_FINANCEIRA'))
                : undefined,
            com297GcdNotaDebitoNome: this.readEnv(
                'COM297_GCD_NOTA_DEBITO_NOME',
                'NOTA DE DÉBITO ELETRÔNICA',
            ),
            com297GcdNotaDebito: this.readEnv('COM297_GCD_NOTA_DEBITO')
                ? Number(this.readEnv('COM297_GCD_NOTA_DEBITO'))
                : undefined,
            ndePollTimeoutMs: this.resolvePositiveInt('NDE_POLL_TIMEOUT_MS', 300_000),
            ndePollIntervalMs: this.resolvePositiveInt('NDE_POLL_INTERVAL_MS', 5_000),
            ndeAclPreflight: this.readEnv('NDE_ACL_PREFLIGHT') !== 'false',
        });
    };

    private GetLambdaEnvironmentVars = async (): Promise<EnvironmentVars> => {
        const db = await this.GetSSMParameter(process.env.ssm_database_connection_string || '');
        const conexos = await this.parseSSMCredentials(process.env.ssm_conexos_credentials);
        const supabase = await this.parseSSMCredentials(process.env.ssm_supabase_credentials);

        return new EnvironmentVars({
            databaseConnectionString: db,
            conexosLogin: this.readCred(conexos, 'login'),
            conexosPassword: this.readCred(conexos, 'pass'),
            conexosApiUrl: this.readCred(conexos, 'ApiUrl'),
            // ADR-0009: no hardcoded `2` fallback in Lambda either.
            conexosFilCod: this.readEnv('conexos_fil_cod')
                ? Number(this.readEnv('conexos_fil_cod'))
                : Number.NaN,
            conexosUsnCod: this.readEnv('conexos_usn_cod', '31'),
            supabaseUrl: this.readCred(supabase, 'url') || undefined,
            supabaseServiceRoleKey: this.readCred(supabase, 'serviceRoleKey') || undefined,
            authJwtSecret: this.readEnv('AUTH_JWT_SECRET') || undefined,
            environment: this.readEnv('environment'),
            clientName: this.readEnv('client_name'),
            awsRegion: this.readEnv('aws_region', this.readEnv('AWS_REGION', 'us-east-1')),
            // Fase 3 (ADR-0013): toggles de deploy (env), não segredos por-tenant.
            conexosWriteEnabled: this.readEnv('CONEXOS_WRITE_ENABLED') === 'true',
            conexosDryRun: this.readEnv('CONEXOS_DRY_RUN') !== 'false',
            // SN (com299) — gates de go-live: default OFF / gcdCod sentinela 0 (ver EnvironmentVars).
            snLiveWriteEnabled: this.readEnv('SN_LIVE_WRITE_ENABLED') === 'true',
            solicitacaoNumerarioGcdCod: this.readEnv('SN_GCD_COD')
                ? Number(this.readEnv('SN_GCD_COD'))
                : 0,
            conexosCredEncKey:
                this.readCred(conexos, 'credEncKey') ||
                this.readEnv('CONEXOS_CRED_ENC_KEY') ||
                undefined,
            sispagEnabled: this.resolveSispagEnabled(this.readEnv('environment')),
            recebimentosEnabled: this.resolveRecebimentosEnabled(this.readEnv('environment')),
            recebimentoIngestDias: this.resolveIngestDias(),
            recebimentoIngestFilCods: this.resolveIngestFilCods(),
            fin014ContaFinanceira: this.readEnv('FIN014_CONTA_FINANCEIRA')
                ? Number(this.readEnv('FIN014_CONTA_FINANCEIRA'))
                : undefined,
            com297GcdNotaDebitoNome: this.readEnv(
                'COM297_GCD_NOTA_DEBITO_NOME',
                'NOTA DE DÉBITO ELETRÔNICA',
            ),
            com297GcdNotaDebito: this.readEnv('COM297_GCD_NOTA_DEBITO')
                ? Number(this.readEnv('COM297_GCD_NOTA_DEBITO'))
                : undefined,
            ndePollTimeoutMs: this.resolvePositiveInt('NDE_POLL_TIMEOUT_MS', 300_000),
            ndePollIntervalMs: this.resolvePositiveInt('NDE_POLL_INTERVAL_MS', 5_000),
            ndeAclPreflight: this.readEnv('NDE_ACL_PREFLIGHT') !== 'false',
        });
    };

    private GetOptionalSSMParameter = async (
        envVar: string | undefined,
        fallback: string,
    ): Promise<string> => {
        if (!envVar) return fallback;
        return this.GetSSMParameter(envVar);
    };

    private GetSSMParameter = async (parameter: string): Promise<string> => {
        const ssm = new SSMClient();

        const param = await ssm.send(
            new GetParameterCommand({
                Name: parameter,
                WithDecryption: true,
            }),
        );

        return param.Parameter?.Value || '';
    };
}
