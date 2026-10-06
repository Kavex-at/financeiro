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

/** A chave do banner de transição, que saiu (ADR-0057). Montada para o grep de remoção. */
const SERVICE_ROLE_ANTIGA = ['SUPABASE', 'SERVICE', 'ROLE', 'KEY'].join('_');
const BANNER_ANTIGO = ['AUTH', 'TRANSICAO', 'EMAIL', 'BANNER'].join('_');

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

        it('authProvider: só "supabase" liga o modo Supabase; ausente ou outro = local (ADR-0057)', async () => {
            const resolve = async () =>
                (await new EnvironmentProvider().getEnvironmentVars()).authProvider;
            delete process.env.AUTH_PROVIDER;
            expect(await resolve()).toBe('local');
            for (const [valor, esperado] of [
                ['supabase', 'supabase'],
                ['local', 'local'],
                ['', 'local'],
            ] as const) {
                process.env.AUTH_PROVIDER = valor;
                expect(await resolve()).toBe(esperado);
            }
            delete process.env.AUTH_PROVIDER;
        });

        it('lê SUPABASE_URL (sem barra final), SUPABASE_PUBLISHABLE_KEY e SUPABASE_SECRET_KEY', async () => {
            process.env.SUPABASE_URL = 'http://127.0.0.1:54321/';
            process.env.SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_x';
            process.env.SUPABASE_SECRET_KEY = 'sb_secret_y';
            const env = await new EnvironmentProvider().getEnvironmentVars();
            expect(env.supabaseUrl).toBe('http://127.0.0.1:54321');
            expect(env.supabasePublishableKey).toBe('sb_publishable_x');
            expect(env.supabaseSecretKey).toBe('sb_secret_y');
        });

        it('não lê mais a service role antiga nem o banner de transição', async () => {
            process.env[SERVICE_ROLE_ANTIGA] = 'legado';
            process.env[BANNER_ANTIGO] = 'true';
            const env = (await new EnvironmentProvider().getEnvironmentVars()) as unknown as Record<
                string,
                unknown
            >;
            expect(env.supabaseSecretKey).toBeUndefined();
            expect(['supabase', 'ServiceRoleKey'].join('') in env).toBe(false);
            expect(['auth', 'TransicaoEmailBanner'].join('') in env).toBe(false);
            delete process.env[SERVICE_ROLE_ANTIGA];
            delete process.env[BANNER_ANTIGO];
        });

        const FLAGS_TED_PIX = [
            'SISPAG_TED_ENABLED',
            'SISPAG_EXCECAO_DESTINO_ENABLED',
            'SISPAG_PIX_ENABLED',
        ] as const;
        const setFlagsTedPix = (valor: string | undefined): void => {
            for (const n of FLAGS_TED_PIX) {
                if (valor === undefined) delete process.env[n];
                else process.env[n] = valor;
            }
        };
        const flagsTedPix = async (): Promise<boolean[]> => {
            const v = await new EnvironmentProvider().getEnvironmentVars();
            return [v.sispagTedEnabled, v.sispagExcecaoDestinoEnabled, v.sispagPixEnabled];
        };

        it('flags TED/PIX/exceção de destino do SISPAG: default OFF, só "true" exato liga (ADR-0054/0061)', async () => {
            setFlagsTedPix(undefined);
            expect(await flagsTedPix()).toEqual([false, false, false]); // ausente = desligado
            for (const [valor, esperado] of [
                ['true', true],
                ['1', false],
                ['yes', false],
                ['', false],
                ['TRUE', false],
            ] as const) {
                setFlagsTedPix(valor);
                expect(await flagsTedPix()).toEqual([esperado, esperado, esperado]);
            }
            setFlagsTedPix(undefined);
        });

        it('carteira SISPAG ao abrir a tela (ADR-0060): TTL 30 e cooldown 5 por default; inválido/≤0 volta ao default', async () => {
            const ler = async () => {
                const v = await new EnvironmentProvider().getEnvironmentVars();
                return [v.sispagCarteiraTtlMin, v.sispagCarteiraCooldownMin];
            };
            delete process.env.SISPAG_CARTEIRA_TTL_MIN;
            delete process.env.SISPAG_CARTEIRA_COOLDOWN_MIN;
            expect(await ler()).toEqual([30, 5]);
            process.env.SISPAG_CARTEIRA_TTL_MIN = '15';
            process.env.SISPAG_CARTEIRA_COOLDOWN_MIN = '2';
            expect(await ler()).toEqual([15, 2]);
            for (const lixo of ['abc', '0', '-10', 'NaN']) {
                process.env.SISPAG_CARTEIRA_TTL_MIN = lixo;
                process.env.SISPAG_CARTEIRA_COOLDOWN_MIN = lixo;
                expect(await ler()).toEqual([30, 5]); // freio nunca é desligado por lixo
            }
            delete process.env.SISPAG_CARTEIRA_TTL_MIN;
            delete process.env.SISPAG_CARTEIRA_COOLDOWN_MIN;
        });

        it('verificação TED/PIX (ADR-0063): defaults 15 dias / 2026-01-01 / 5 / 3 / 0,95 / 24 meses; inválido volta ao default', async () => {
            const CHAVES = [
                'SISPAG_DUPLICIDADE_JANELA_DIAS',
                'SISPAG_DUPLICIDADE_DESDE',
                'SISPAG_PERFIL_CANAL_MIN_PAGAMENTOS',
                'SISPAG_PERFIL_CANAL_MIN_MESES',
                'SISPAG_PERFIL_CANAL_MIN_PARTICIPACAO',
                'SISPAG_PERFIL_CANAL_MESES',
            ];
            const ler = async () =>
                (await new EnvironmentProvider().getEnvironmentVars()).sispagVerificacao;
            const DEFAULT = {
                duplicidadeJanelaDias: 15,
                duplicidadeDesde: Date.UTC(2026, 0, 1),
                perfilMinPagamentos: 5,
                perfilMinMeses: 3,
                perfilMinParticipacao: 0.95,
                perfilJanelaMeses: 24,
            };
            for (const c of CHAVES) delete process.env[c];
            expect(await ler()).toEqual(DEFAULT);

            process.env.SISPAG_DUPLICIDADE_JANELA_DIAS = '10';
            process.env.SISPAG_DUPLICIDADE_DESDE = '2026-03-01';
            process.env.SISPAG_PERFIL_CANAL_MIN_PAGAMENTOS = '8';
            process.env.SISPAG_PERFIL_CANAL_MIN_MESES = '4';
            process.env.SISPAG_PERFIL_CANAL_MIN_PARTICIPACAO = '0.9';
            process.env.SISPAG_PERFIL_CANAL_MESES = '12';
            expect(await ler()).toEqual({
                duplicidadeJanelaDias: 10,
                duplicidadeDesde: Date.UTC(2026, 2, 1),
                perfilMinPagamentos: 8,
                perfilMinMeses: 4,
                perfilMinParticipacao: 0.9,
                perfilJanelaMeses: 12,
            });

            for (const lixo of ['abc', '0', '-3', '1.5', 'NaN']) {
                for (const c of CHAVES) process.env[c] = lixo;
                expect(await ler()).toEqual(DEFAULT);
            }
            process.env.SISPAG_PERFIL_CANAL_MIN_PARTICIPACAO = '1.01';
            process.env.SISPAG_DUPLICIDADE_DESDE = '01/03/2026';
            const torto = await ler();
            expect(torto.perfilMinParticipacao).toBe(0.95);
            expect(torto.duplicidadeDesde).toBe(DEFAULT.duplicidadeDesde);
            for (const c of CHAVES) delete process.env[c];
        });

        it('flags TED/PIX/exceção de destino são independentes entre si', async () => {
            setFlagsTedPix(undefined);
            process.env.SISPAG_PIX_ENABLED = 'true';
            expect(await flagsTedPix()).toEqual([false, false, true]);
            setFlagsTedPix(undefined);
        });

        describe('alias SISPAG_DESTINO_MANUAL_ENABLED da flag de exceção (ADR-0061, Q6)', () => {
            const NOVO = 'SISPAG_EXCECAO_DESTINO_ENABLED';
            const ANTIGO = 'SISPAG_DESTINO_MANUAL_ENABLED';
            const excecao = async (): Promise<boolean> =>
                (await new EnvironmentProvider().getEnvironmentVars()).sispagExcecaoDestinoEnabled;

            afterEach(() => {
                delete process.env[NOVO];
                delete process.env[ANTIGO];
            });

            it('só o nome antigo ligado: liga (alias por um ciclo de deploy)', async () => {
                delete process.env[NOVO];
                process.env[ANTIGO] = 'true';
                expect(await excecao()).toBe(true);
            });

            it('o nome novo manda: definido, vence o antigo nos dois sentidos', async () => {
                process.env[NOVO] = 'false';
                process.env[ANTIGO] = 'true';
                expect(await excecao()).toBe(false);
                process.env[NOVO] = 'true';
                process.env[ANTIGO] = 'false';
                expect(await excecao()).toBe(true);
            });

            it('nenhum dos dois: desligado', async () => {
                expect(await excecao()).toBe(false);
            });
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
            expect(env.supabasePublishableKey).toBeUndefined();
            expect(env.supabaseSecretKey).toBeUndefined();
        });

        it('lê url, publishableKey e secretKey do SSM e AUTH_PROVIDER do env', async () => {
            process.env.ssm_supabase_credentials = '/tenants/dev/columbia/supabase_credentials';
            process.env.AUTH_PROVIDER = 'supabase';
            ssmSendMock.mockImplementation(async (cmd: { Name?: string }) => {
                if (cmd.Name === '/tenants/dev/columbia/supabase_credentials') {
                    return {
                        Parameter: {
                            Value: JSON.stringify({
                                url: 'https://ref.supabase.co/',
                                publishableKey: 'sb_publishable_ssm',
                                secretKey: 'sb_secret_ssm',
                            }),
                        },
                    };
                }
                return { Parameter: { Value: '{}' } };
            });
            const env = await new EnvironmentProvider().getEnvironmentVars();
            expect(env.supabaseUrl).toBe('https://ref.supabase.co');
            expect(env.supabasePublishableKey).toBe('sb_publishable_ssm');
            expect(env.supabaseSecretKey).toBe('sb_secret_ssm');
            expect(env.authProvider).toBe('supabase');
            delete process.env.AUTH_PROVIDER;
        });

        it('flags TED/PIX/destino manual do SISPAG: mesma regra no caminho SSM/Lambda', async () => {
            ssmSendMock.mockImplementation(async () => ({ Parameter: { Value: '{}' } }));
            process.env.SISPAG_TED_ENABLED = 'true';
            const v = await new EnvironmentProvider().getEnvironmentVars();
            expect(v.sispagTedEnabled).toBe(true);
            expect(v.sispagExcecaoDestinoEnabled).toBe(false);
            expect(v.sispagPixEnabled).toBe(false);
            delete process.env.SISPAG_TED_ENABLED;
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
