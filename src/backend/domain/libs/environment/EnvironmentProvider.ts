import path from 'node:path';
import { GetParameterCommand, SSMClient } from '@aws-sdk/client-ssm';
import dotenv from 'dotenv';
import { injectable, singleton } from 'tsyringe';
import {
    RECEBIMENTO_INGEST_DIAS_PADRAO,
    RECEBIMENTO_INGEST_START_DATE_PADRAO,
} from '../../interface/recebimentos/constants.js';
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
     * Resolve a flag da Frente IV (Recebimentos). **NÃO é fail-safe como o SISPAG:**
     * a frente está LIBERADA em produção (ADR-0028), então ausência da env significa
     * HABILITADO. `RECEBIMENTOS_ENABLED=false` é o kill-switch de emergência —
     * único caminho para desligar, e não depende de redeploy (o `sync:false` do
     * `render.yaml` deixa o dashboard como fonte da verdade).
     *
     * ⚠️ Não "restaure" o `environment !== 'production'` daqui: era exatamente o que
     * mantinha a frente invisível em prod.
     */
    private resolveRecebimentosEnabled = (): boolean =>
        this.readEnv('RECEBIMENTOS_ENABLED') !== 'false';

    /**
     * Resolve a flag da Frente V (Workflow de Aprovação). **Fail-safe como o SISPAG, e não como a
     * Frente IV.**
     *
     * A tentação é copiar `resolveRecebimentosEnabled` (default HABILITADO), mas aquele default
     * existe porque o ADR-0028 **liberou** a Frente IV em produção. A Frente V não foi liberada:
     * tem dez validações de negócio em aberto (`frente-v-pendencias-validacao.md`) e, até a primeira
     * ingestão rodar, o painel em produção mostraria uma tela vazia para o cliente — pior que
     * mostrar nada.
     *
     * O fato de a frente ser read-only no ERP protege contra estrago, não contra estrear cedo.
     * Fora de produção liga sozinha (dev e homologação seguem sem fricção); em produção exige um
     * `APROVACOES_ENABLED=true` explícito, que é a decisão de estreia — e continua reversível pelo
     * dashboard, sem redeploy.
     */
    private resolveAprovacoesEnabled = (environment: string): boolean => {
        const flag = this.readEnv('APROVACOES_ENABLED');
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
     * Piso da janela de ingestão do extrato (`CONEXOS_EXTRATO_SYNC_START_DATE`,
     * `YYYY-MM-DD`). Nenhuma sincronização — cron, backfill por `DIAS=` ou
     * `POST /recebimentos/ingestao { dias }` — lê lançamento anterior a esta data.
     *
     * Parseado como MEIA-NOITE UTC: o `fin095` filtra `exiDtaLcto#GE` em epoch-ms e
     * o ERP grava o dia-calendário BR em UTC 00:00 (o `parseDate` do
     * `ConexosBaseClient` é que soma o shift de meio-dia na LEITURA). Um piso em
     * UTC 00:00 portanto inclui o dia inteiro no fuso BR.
     *
     * Valor ausente/inválido cai no padrão — nunca `Invalid Date`, que envenenaria
     * a comparação da janela e faria a ingestão trazer nada em silêncio.
     */
    private resolveIngestStartDate = (): Date => {
        const raw = this.readEnv('CONEXOS_EXTRATO_SYNC_START_DATE').trim();
        const candidato = /^\d{4}-\d{2}-\d{2}$/.test(raw)
            ? raw
            : RECEBIMENTO_INGEST_START_DATE_PADRAO;
        const data = new Date(`${candidato}T00:00:00.000Z`);
        return Number.isNaN(data.getTime())
            ? new Date(`${RECEBIMENTO_INGEST_START_DATE_PADRAO}T00:00:00.000Z`)
            : data;
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
    /**
     * Parser do FALLBACK filial → `gcdCod` da SN (`SN_GCD_COD_BY_FIL`, formato `"1:150,4:185"`).
     * Pares malformados são DESCARTADOS em silêncio (o gate 3 tem outros fallbacks e ainda valida o
     * `gcdCod` contra o `lov/ConfigDocProcesso` — um env torto nunca vira geração de documento errado).
     */
    private resolveSnGcdCodPorFilial = (): Record<number, number> => {
        const mapa: Record<number, number> = {};
        for (const par of this.readEnv('SN_GCD_COD_BY_FIL', '').split(',')) {
            const [filRaw, gcdRaw] = par.split(':');
            if (filRaw === undefined || gcdRaw === undefined) continue;
            const filCod = Number(filRaw.trim());
            const gcdCod = Number(gcdRaw.trim());
            if (!Number.isInteger(filCod) || filCod <= 0) continue;
            if (!Number.isInteger(gcdCod) || gcdCod <= 0) continue;
            mapa[filCod] = gcdCod;
        }
        return mapa;
    };

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
            solicitacaoNumerarioGcdCodPorFilial: this.resolveSnGcdCodPorFilial(),
            conexosCredEncKey: this.readEnv('CONEXOS_CRED_ENC_KEY') || undefined,
            sispagEnabled: this.resolveSispagEnabled(this.readEnv('environment', 'local')),
            recebimentosEnabled: this.resolveRecebimentosEnabled(),
            aprovacoesEnabled: this.resolveAprovacoesEnabled(this.readEnv('environment', 'local')),
            recebimentoIngestDias: this.resolveIngestDias(),
            recebimentoIngestStartDate: this.resolveIngestStartDate(),
            recebimentoIngestFilCods: this.resolveIngestFilCods(),
            recebimentoTitularesInternos: this.resolveTitularesInternos(),
            fin014ContaFinanceira: this.readEnv('FIN014_CONTA_FINANCEIRA')
                ? Number(this.readEnv('FIN014_CONTA_FINANCEIRA'))
                : undefined,
            com297GcdNotaDebitoNome: this.readEnv(
                'COM297_GCD_NOTA_DEBITO_NOME',
                // Config REAL da NDe (HAR 2026-08-02 23-27, doc 18347 SUCESSO): "NOTA DE DEBITO PAGAMENTO
                // ANTECIPADO" (gcd 248). O bug era o `globalDocVldTipo` (o com297 usa 0, não o 9 do SN) — com
                // 0 o processo aceita a 248. Ver `NDE_GLOBAL_DOC_VLD_TIPO`.
                'NOTA DE DEBITO PAGAMENTO ANTECIPADO',
            ),
            com297GcdNotaDebito: this.readEnv('COM297_GCD_NOTA_DEBITO')
                ? Number(this.readEnv('COM297_GCD_NOTA_DEBITO'))
                : undefined,
            ndePollTimeoutMs: this.resolvePositiveInt('NDE_POLL_TIMEOUT_MS', 300_000),
            ndePollIntervalMs: this.resolvePositiveInt('NDE_POLL_INTERVAL_MS', 5_000),
            ndeAclPreflight: this.readEnv('NDE_ACL_PREFLIGHT') !== 'false',
            snCondPgtoAutoajuste: this.readEnv('SN_COND_PGTO_AUTOAJUSTE') !== 'false',
            ndeDescricaoItemFallback: this.readEnv('NDE_DESCRICAO_ITEM_FALLBACK') || undefined,
            ndeDescricaoItemEnabled: this.readEnv('NDE_DESCRICAO_ITEM_ENABLED') !== 'false',
        });
    };

    /**
     * Titulares internos (`RECEBIMENTO_TITULARES_INTERNOS`, CSV) — os nomes que, no
     * remetente de um crédito, provam que o dinheiro veio de outra conta da própria
     * casa.
     *
     * **Default VAZIO = detecção desligada.** Não há razão social no código (Regra
     * Inviolável #2): um literal de tenant aqui viraria, no segundo cliente, um filtro
     * que esconde crédito alheio usando o nome do primeiro. Quem quer a detecção
     * declara quem é a própria casa — e ausência de configuração nunca esconde
     * dinheiro de ninguém.
     */
    private resolveTitularesInternos = (): string[] => {
        const bruto = process.env.RECEBIMENTO_TITULARES_INTERNOS;
        if (bruto === undefined) return [];
        return bruto
            .split(',')
            .map((s) => s.trim())
            .filter((s) => s !== '');
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
            solicitacaoNumerarioGcdCodPorFilial: this.resolveSnGcdCodPorFilial(),
            conexosCredEncKey:
                this.readCred(conexos, 'credEncKey') ||
                this.readEnv('CONEXOS_CRED_ENC_KEY') ||
                undefined,
            sispagEnabled: this.resolveSispagEnabled(this.readEnv('environment')),
            recebimentosEnabled: this.resolveRecebimentosEnabled(),
            aprovacoesEnabled: this.resolveAprovacoesEnabled(this.readEnv('environment')),
            recebimentoIngestDias: this.resolveIngestDias(),
            recebimentoIngestStartDate: this.resolveIngestStartDate(),
            recebimentoIngestFilCods: this.resolveIngestFilCods(),
            recebimentoTitularesInternos: this.resolveTitularesInternos(),
            fin014ContaFinanceira: this.readEnv('FIN014_CONTA_FINANCEIRA')
                ? Number(this.readEnv('FIN014_CONTA_FINANCEIRA'))
                : undefined,
            com297GcdNotaDebitoNome: this.readEnv(
                'COM297_GCD_NOTA_DEBITO_NOME',
                // Config REAL da NDe (HAR 2026-08-02 23-27, doc 18347 SUCESSO): "NOTA DE DEBITO PAGAMENTO
                // ANTECIPADO" (gcd 248). O bug era o `globalDocVldTipo` (o com297 usa 0, não o 9 do SN) — com
                // 0 o processo aceita a 248. Ver `NDE_GLOBAL_DOC_VLD_TIPO`.
                'NOTA DE DEBITO PAGAMENTO ANTECIPADO',
            ),
            com297GcdNotaDebito: this.readEnv('COM297_GCD_NOTA_DEBITO')
                ? Number(this.readEnv('COM297_GCD_NOTA_DEBITO'))
                : undefined,
            ndePollTimeoutMs: this.resolvePositiveInt('NDE_POLL_TIMEOUT_MS', 300_000),
            ndePollIntervalMs: this.resolvePositiveInt('NDE_POLL_INTERVAL_MS', 5_000),
            ndeAclPreflight: this.readEnv('NDE_ACL_PREFLIGHT') !== 'false',
            snCondPgtoAutoajuste: this.readEnv('SN_COND_PGTO_AUTOAJUSTE') !== 'false',
            ndeDescricaoItemFallback: this.readEnv('NDE_DESCRICAO_ITEM_FALLBACK') || undefined,
            ndeDescricaoItemEnabled: this.readEnv('NDE_DESCRICAO_ITEM_ENABLED') !== 'false',
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
