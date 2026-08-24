import 'reflect-metadata';

const ssmSendMock = jest.fn();

jest.mock('@aws-sdk/client-ssm', () => ({
    SSMClient: jest.fn().mockImplementation(() => ({
        send: ssmSendMock,
    })),
    GetParameterCommand: jest.fn().mockImplementation((input) => input),
}));

// SANDBOX (testability-1): neutraliza o dotenv. Em produção o `GetLocalEnvironmentVars`
// chama `dotenv.config()` que recarrega o `.env` do dev — isso re-populava
// `process.env` e contaminava o teste (CONEXOS_FIL_COD do .env local sobrescrevia o
// cenário "ausente"). Com o config() no-op, o teste controla 100% o process.env.
jest.mock('dotenv', () => ({
    __esModule: true,
    default: { config: jest.fn() },
    config: jest.fn(),
}));

import EnvironmentProvider from './EnvironmentProvider.js';

describe('EnvironmentProvider', () => {
    const originalEnv = { ...process.env };

    beforeEach(() => {
        ssmSendMock.mockReset();
        // Reset env to a known baseline
        for (const key of Object.keys(process.env)) {
            if (
                key.startsWith('CONEXOS_') ||
                key.startsWith('SUPABASE_') ||
                key.startsWith('ssm_') ||
                key === 'client_name' ||
                key === 'environment' ||
                key === 'aws_region' ||
                key === 'databaseConnectionString'
            ) {
                delete process.env[key];
            }
        }
    });

    afterAll(() => {
        process.env = originalEnv;
    });

    describe('local mode', () => {
        beforeEach(() => {
            process.env.CONEXOS_USERNAME = 'local-user';
            process.env.CONEXOS_PASSWORD = 'local-pass';
            process.env.CONEXOS_BASE_URL = 'https://example.test/api';
            process.env.databaseConnectionString = 'postgres://localhost:5432/test';
        });

        it('reads from process.env when client_name is undefined', async () => {
            const provider = new EnvironmentProvider();
            const env = await provider.getEnvironmentVars();

            expect(env.conexosLogin).toBe('local-user');
            expect(env.conexosPassword).toBe('local-pass');
            expect(env.conexosApiUrl).toBe('https://example.test/api');
            expect(env.databaseConnectionString).toBe('postgres://localhost:5432/test');
            expect(env.clientName).toBe('local');
            expect(env.awsRegion).toBe('us-east-1');
            // ADR-0009: no hardcoded fallback for filCod; absent env → NaN.
            expect(Number.isNaN(env.conexosFilCod)).toBe(true);
        });

        it('parses CONEXOS_FIL_COD when explicitly set (no hardcoded default)', async () => {
            process.env.CONEXOS_FIL_COD = '7';
            const provider = new EnvironmentProvider();
            const env = await provider.getEnvironmentVars();

            expect(env.conexosFilCod).toBe(7);
        });

        it('reads from process.env when client_name is "local"', async () => {
            process.env.client_name = 'local';
            const provider = new EnvironmentProvider();
            const env = await provider.getEnvironmentVars();

            expect(env.clientName).toBe('local');
            expect(env.conexosLogin).toBe('local-user');
            expect(ssmSendMock).not.toHaveBeenCalled();
        });

        it('sispagEnabled: SISPAG_ENABLED força; sem env, bloqueia só em produção (fail-safe)', async () => {
            const resolve = async () => {
                const p = new EnvironmentProvider();
                return (await p.getEnvironmentVars()).sispagEnabled;
            };
            // força explícita
            process.env.SISPAG_ENABLED = 'false';
            expect(await resolve()).toBe(false);
            // sem env + ambiente de produção → bloqueado
            process.env.SISPAG_ENABLED = '';
            process.env.environment = 'production';
            expect(await resolve()).toBe(false);
            // sem env + fora de produção → habilitado
            process.env.environment = 'local';
            expect(await resolve()).toBe(true);
            // força true mesmo em produção
            process.env.SISPAG_ENABLED = 'true';
            process.env.environment = 'production';
            expect(await resolve()).toBe(true);
            delete process.env.SISPAG_ENABLED;
        });

        it('recebimentosEnabled: liberado em produção; só RECEBIMENTOS_ENABLED=false desliga', async () => {
            // ADR-0028. Ao contrário do SISPAG acima, NÃO é fail-safe: a Frente IV
            // está em produção, então ausência da env significa HABILITADO. Se este
            // teste voltar a exigir `false` em produção sem env, o gate foi
            // reintroduzido e a frente sumiu do ar.
            const resolve = async () => {
                const p = new EnvironmentProvider();
                return (await p.getEnvironmentVars()).recebimentosEnabled;
            };
            // sem env + produção → HABILITADO (o oposto do SISPAG)
            delete process.env.RECEBIMENTOS_ENABLED;
            process.env.environment = 'production';
            expect(await resolve()).toBe(true);
            // kill-switch: só `false` desliga
            process.env.RECEBIMENTOS_ENABLED = 'false';
            expect(await resolve()).toBe(false);
            // qualquer outro valor mantém ligado
            process.env.RECEBIMENTOS_ENABLED = 'true';
            expect(await resolve()).toBe(true);
            delete process.env.RECEBIMENTOS_ENABLED;
        });

        it('recebimentoIngestStartDate: default 2026-08-03, override e valor inválido', async () => {
            const resolve = async () => {
                const p = new EnvironmentProvider();
                return (await p.getEnvironmentVars()).recebimentoIngestStartDate;
            };
            // default do go-live (ADR-0028)
            expect((await resolve()).toISOString()).toBe('2026-08-03T00:00:00.000Z');
            // override válido
            process.env.CONEXOS_EXTRATO_SYNC_START_DATE = '2026-09-15';
            expect((await resolve()).toISOString()).toBe('2026-09-15T00:00:00.000Z');
            // lixo cai no default em vez de virar Invalid Date — que envenenaria a
            // comparação da janela e faria a ingestão trazer nada, em silêncio.
            process.env.CONEXOS_EXTRATO_SYNC_START_DATE = 'ontem';
            const fallback = await resolve();
            expect(Number.isNaN(fallback.getTime())).toBe(false);
            expect(fallback.toISOString()).toBe('2026-08-03T00:00:00.000Z');
            delete process.env.CONEXOS_EXTRATO_SYNC_START_DATE;
        });

        it('does not call SSM in local mode', async () => {
            const provider = new EnvironmentProvider();
            await provider.getEnvironmentVars();

            expect(ssmSendMock).not.toHaveBeenCalled();
        });

        it('caches env vars after first call', async () => {
            const provider = new EnvironmentProvider();

            const first = await provider.getEnvironmentVars();
            const second = await provider.getEnvironmentVars();

            expect(first).toBe(second);
        });
    });

    describe('Lambda mode', () => {
        beforeEach(() => {
            process.env.client_name = 'columbia';
            process.env.environment = 'dev';
            process.env.ssm_database_connection_string =
                '/tenants/dev/columbia/database_connection_string';
            process.env.ssm_conexos_credentials = '/tenants/dev/columbia/conexos_credentials';
        });

        it('reads database connection string from SSM as a plain string', async () => {
            ssmSendMock.mockImplementation(async (cmd: any) => {
                if (cmd.Name === '/tenants/dev/columbia/database_connection_string') {
                    return { Parameter: { Value: 'postgres://prod-host:5432/db' } };
                }
                if (cmd.Name === '/tenants/dev/columbia/conexos_credentials') {
                    return {
                        Parameter: {
                            Value: JSON.stringify({
                                login: 'ssm-user',
                                pass: 'ssm-pass',
                                ApiUrl: 'https://prod.api/api',
                            }),
                        },
                    };
                }
                return { Parameter: { Value: '' } };
            });

            const provider = new EnvironmentProvider();
            const env = await provider.getEnvironmentVars();

            expect(env.databaseConnectionString).toBe('postgres://prod-host:5432/db');
            expect(env.conexosLogin).toBe('ssm-user');
            expect(env.conexosPassword).toBe('ssm-pass');
            expect(env.conexosApiUrl).toBe('https://prod.api/api');
            expect(env.clientName).toBe('columbia');
            expect(env.environment).toBe('dev');
        });

        it('returns empty supabase fields when ssm_supabase_credentials is unset', async () => {
            ssmSendMock.mockImplementation(async () => ({ Parameter: { Value: '{}' } }));

            const provider = new EnvironmentProvider();
            const env = await provider.getEnvironmentVars();

            expect(env.supabaseUrl).toBeUndefined();
            expect(env.supabaseServiceRoleKey).toBeUndefined();
        });
    });
    describe('CONEXOS_WRITE_ENABLED em máquina local', () => {
        const PRD = 'https://columbiatrading.conexos.cloud/api';
        const HML = 'https://columbiatrading-hml.conexos.cloud/api';

        beforeEach(() => {
            process.env.CONEXOS_USERNAME = 'u';
            process.env.CONEXOS_PASSWORD = 'p';
            process.env.databaseConnectionString = 'postgres://localhost:5432/test';
            process.env.CONEXOS_WRITE_ENABLED = 'true';
            jest.spyOn(console, 'warn').mockImplementation(() => undefined);
        });

        it('IGNORA write=true quando environment=local aponta para a Conexos de PRODUÇÃO', async () => {
            // Ler PRD de uma máquina de dev é legítimo (é de lá que vêm os títulos reais).
            // ESCREVER não é: viraria lote de pagamento no ERP da Columbia sem deploy.
            process.env.environment = 'local';
            process.env.CONEXOS_BASE_URL = PRD;

            const env = await new EnvironmentProvider().getEnvironmentVars();

            expect(env.conexosWriteEnabled).toBe(false);
        });

        it('mantém write=true em local contra HML — é o fluxo sancionado de validação', async () => {
            process.env.environment = 'local';
            process.env.CONEXOS_BASE_URL = HML;

            const env = await new EnvironmentProvider().getEnvironmentVars();

            expect(env.conexosWriteEnabled).toBe(true);
        });

        it('mantém write=true quando o ambiente NÃO é local (Render)', async () => {
            process.env.environment = 'production';
            process.env.CONEXOS_BASE_URL = PRD;

            const env = await new EnvironmentProvider().getEnvironmentVars();

            expect(env.conexosWriteEnabled).toBe(true);
        });

        it('permite o override deliberado PERMITIR_ESCRITA_PRD_LOCAL=1 (go-live assistido)', async () => {
            process.env.environment = 'local';
            process.env.CONEXOS_BASE_URL = PRD;
            process.env.PERMITIR_ESCRITA_PRD_LOCAL = '1';

            const env = await new EnvironmentProvider().getEnvironmentVars();

            expect(env.conexosWriteEnabled).toBe(true);
        });

        it('NÃO bloqueia um mock local — servidor de teste não é produção', async () => {
            // Os e2e de Recebimentos sobem um ERP falso em 127.0.0.1 e ligam a escrita.
            // Bloquear por "não tem -hml no host" recusaria isso: ruído, não segurança.
            process.env.environment = 'local';
            process.env.CONEXOS_BASE_URL = 'http://127.0.0.1:41234/api';

            const env = await new EnvironmentProvider().getEnvironmentVars();

            expect(env.conexosWriteEnabled).toBe(true);
        });

        it('write=false continua false — o guard não liga escrita que ninguém pediu', async () => {
            process.env.environment = 'production';
            process.env.CONEXOS_BASE_URL = PRD;
            process.env.CONEXOS_WRITE_ENABLED = 'false';

            const env = await new EnvironmentProvider().getEnvironmentVars();

            expect(env.conexosWriteEnabled).toBe(false);
        });
    });

    describe('hermetismo sob Jest (testability-3)', () => {
        it('NÃO carrega o .env quando roda sob Jest', async () => {
            // Se o dotenv rodasse aqui, o `.env` da máquina (que tem CONEXOS_USERNAME
            // preenchido) vazaria para dentro do cenário e o teste passaria a depender
            // de quem clonou o repo. `JEST_WORKER_ID` está setada por definição neste
            // ponto — é o próprio Jest que injeta.
            expect(process.env.JEST_WORKER_ID).toBeDefined();

            const provider = new EnvironmentProvider();
            const env = await provider.getEnvironmentVars();

            // O beforeEach limpou o process.env; sem dotenv, continua limpo.
            expect(env.conexosLogin).toBe('');
            expect(env.conexosPassword).toBe('');
        });
    });

});
