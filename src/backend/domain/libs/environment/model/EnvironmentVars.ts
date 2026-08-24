export default class EnvironmentVars {
    public databaseConnectionString: string;
    public conexosLogin: string;
    public conexosPassword: string;
    public conexosApiUrl: string;
    public conexosFilCod: number;
    /**
     * Legacy single-tenant fallback for `cnx-usncod`. The canonical value
     * is captured at runtime from the Conexos `/login` response (PR #19);
     * this field is only consumed when no live session is available.
     */
    public conexosUsnCod: string;

    public supabaseUrl?: string;
    public supabaseServiceRoleKey?: string;

    /**
     * HS256 secret used to SIGN the app's own login JWTs (read from
     * `AUTH_JWT_SECRET`). The auth middleware validates these tokens with the
     * same secret (`SUPABASE_JWT_SECRET`/`AUTH_JWT_SECRET`). Optional so local
     * dev (DEV_AUTH_BYPASS) can boot before it is provisioned.
     */
    public authJwtSecret?: string;

    public environment: string;
    public clientName: string;
    public awsRegion: string;

    /**
     * Chave-mestra (base64, 32 bytes) para cifrar/decifrar a senha Conexos de
     * cada usuário (AES-256-GCM) — vínculo por-usuário (Fatia B). É um segredo
     * REVERSÍVEL (a senha precisa ser reusada no login do ERP), então não é hash.
     * Opcional: ausente ⇒ o cadastro de credencial Conexos fica indisponível e
     * todos operam via robô (o vínculo por-usuário exige a chave).
     */
    public conexosCredEncKey?: string;

    /**
     * Feature flag do SISPAG (Frente II). Quando `false`, as rotas `/sispag/*`
     * respondem 403 (bloqueio via URL). `SISPAG_ENABLED=true|false` força; sem a
     * env, fica habilitado FORA de produção e bloqueado EM produção (fail-safe —
     * um deploy que esqueça de setar não expõe o SISPAG).
     */
    public sispagEnabled: boolean;

    /**
     * KILL-SWITCH da Frente IV (Recebimentos / Gestão de Adiantamentos). Quando
     * `false`, as rotas `/recebimentos/*` respondem 403. Ao contrário do SISPAG,
     * NÃO é fail-safe: a frente está liberada em produção (ADR-0028), então só
     * `RECEBIMENTOS_ENABLED=false` desliga — ausência da env significa habilitado.
     */
    public recebimentosEnabled: boolean;

    /**
     * Janela default (em dias) da ingestão de extratos da Frente IV.
     * `RECEBIMENTO_INGEST_DIAS`; default 90. Sempre recortada pelo
     * `recebimentoIngestStartDate` — a janela efetiva é a INTERSEÇÃO das duas.
     */
    public recebimentoIngestDias: number;

    /**
     * PISO absoluto da janela de ingestão do extrato
     * (`CONEXOS_EXTRATO_SYNC_START_DATE`, `YYYY-MM-DD`; default `2026-08-03`).
     * Nenhum caminho de sincronização lê lançamento anterior a esta data, nem o
     * backfill manual (ADR-0028).
     */
    public recebimentoIngestStartDate: Date;

    /**
     * Filiais a ingerir (`RECEBIMENTO_INGEST_FIL_CODS`, CSV). Vazio = todas as
     * filiais que o ERP devolver.
     */
    public recebimentoIngestFilCods: number[];

    /**
     * Nomes que identificam a PRÓPRIA CASA no remetente de um crédito
     * (`RECEBIMENTO_TITULARES_INTERNOS`, CSV). Um TED/PIX de categoria 209 cujo
     * `REM:` casa com um destes é transferência entre contas do grupo, não
     * recebimento de cliente — sai da carteira do analista.
     *
     * Vazio desliga a detecção (nada é escondido).
     */
    public recebimentoTitularesInternos: string[];

    /**
     * Fase 3 (ADR-0013) — guard-rails da ESCRITA no `fin010`. `conexosWriteEnabled`
     * liga o caminho de escrita (default false); `conexosDryRun` (default true) faz o
     * serviço montar/logar o payload SEM POST. Escrita real exige write=true E dry=false.
     * Toggles de deploy (não segredos por-tenant) — lidos de process.env em ambos os modos.
     */
    public conexosWriteEnabled: boolean;
    public conexosDryRun: boolean;

    /**
     * SN (Solicitação de Numerário, com299) — gates de go-live da escrita, INDEPENDENTES do
     * global `conexosWriteEnabled`. `snLiveWriteEnabled` (`SN_LIVE_WRITE_ENABLED`, default false)
     * é o kill-switch dedicado da SN. `solicitacaoNumerarioGcdCod` (`SN_GCD_COD`) é a Configuração
     * de Documento (`gcd`) da "SOLICITAÇÃO DE NUMERÁRIO - ENCOMENDA" (HAR-confirmada = 150); o
     * default 0 é sentinela "não confirmado" que TRAVA a escrita real.
     */
    public snLiveWriteEnabled: boolean;

    /**
     * SISPAG (Frente II) — kill-switch DEDICADO da escrita, independente do global.
     *
     * `conexosDryRun` é global: contê-lo por causa de um bug só do SISPAG desligaria
     * junto Permutas e Recebimentos, que não têm nada com o incidente. Este flag
     * (`SISPAG_LIVE_WRITE_ENABLED`, default **false**) reduz o raio de contenção a uma
     * frente. Mesmo padrão do `snLiveWriteEnabled`.
     *
     * Default false porque é gate de go-live: enquanto a Columbia não validar a remessa
     * ponta a ponta, um deploy que esqueça de setar NÃO escreve no ERP. Não confundir com
     * `sispagEnabled`, que decide se a tela existe — este decide se ela escreve.
     */
    public sispagLiveWriteEnabled: boolean;
    public solicitacaoNumerarioGcdCod: number;

    /**
     * FALLBACK filial → `gcdCod` da SN (`SN_GCD_COD_BY_FIL`, formato `"1:150,4:185"`). O nome da
     * Configuração de Documento NÃO é uniforme entre filiais — a 1 usa "SOLICITAÇÃO DE NUMERÁRIO -
     * ENCOMENDA" (150) e a 4 usa "ADIANTAMENTO DE CLIENTES" (185, medido em produção no processo
     * 699) — então o global `solicitacaoNumerarioGcdCod` é filial-1-cêntrico por construção.
     * Consultado pelo gate 3 SÓ quando o processo não tem histórico de SN, e o valor ainda é
     * validado contra o `lov/ConfigDocProcesso` antes de virar decisão. Vazio = sem fallback.
     */
    public solicitacaoNumerarioGcdCodPorFilial: Readonly<Record<number, number>>;

    /**
     * Numerário (fluxo de 3 telas do guia "telas Conexos"): conta financeira do recebimento fin014
     * (`gerNum`, a MESMA da FIN_134) e a Configuração da nota de débito com297. `fin014ContaFinanceira`
     * é fail-closed se ausente (não adivinhamos conta). O gcd da nota de débito é resolvido em runtime
     * pelo NOME (`com297GcdNotaDebitoNome`); o numérico é um override opcional.
     */
    public fin014ContaFinanceira?: number;
    public com297GcdNotaDebitoNome: string;
    public com297GcdNotaDebito?: number;

    /**
     * Poll de autorização SEFAZ pós-homologação da NDe (`NDE_POLL_TIMEOUT_MS`/`NDE_POLL_INTERVAL_MS`).
     * `vldAutorizado` continua `0` logo após homologar (SEFAZ é assíncrono) — o orquestrador faz
     * polling até mudar, com teto de tempo. TIMEOUT não é erro: a etapa fica em `homologado` e retomar
     * a alocação retoma o poll. Defaults conservadores (5 min de teto, 5 s de intervalo).
     */
    public ndePollTimeoutMs: number;
    public ndePollIntervalMs: number;

    /**
     * Liga o pré-flight de ACL da conta de serviço antes de qualquer escrita do numerário REAL
     * (`GET /api/permissoes/new/com297`: com300 UPDATE, com131 GERAR OBS, com297 HOMOLOGAR/CONTINGENCIA,
     * com194 SELECT). `NDE_ACL_PREFLIGHT=false` desliga (default TRUE — fail-safe). O pré-flight é
     * fail-closed: 401/403 na consulta → 403 na rota.
     */
    public ndeAclPreflight: boolean;

    /**
     * Liga o ajuste automático da condição de pagamento da SN quando a com194 acusa validação
     * BLOQUEANTE de condição (`SN_COND_PGTO_AUTOAJUSTE=false` desliga; default TRUE).
     *
     * Existe porque esse ramo NÃO é exercitável em homologação — o cliente de teste do HML não tem
     * condição sugerida no cadastro, então o ERP nunca acusa a pendência lá (ver
     * `docs/e2e/gap-titulos-diagnostico.md`). Em produção ele dispara para clientes cujo cadastro a
     * exige. Desligar mantém o fluxo conservador: sem o PUT, a finalização é recusada pelo próprio ERP
     * com a mensagem dele, e o analista resolve na tela — nunca um documento com o título destruído.
     */
    public snCondPgtoAutoajuste: boolean;

    /**
     * Texto FIXO para a "Descrição para Impressão" (`dprLngDescrNf`) do item da NDe
     * (`NDE_DESCRICAO_ITEM_FALLBACK`). Só entra em jogo quando o ERP deixou o campo VAZIO — ou seja,
     * para os clientes cujo cadastro manda derivar a descrição da DI (`cmn025.dpeVld1DescrNfe = 4`) e o
     * produto de encargo da NDe não tem adição de DI.
     *
     * **Normalmente NÃO se seta.** Sem ele a automação usa a descrição CADASTRADA do próprio produto
     * (`prdDesNome`, "PAGAMENTO ANTECIPADO"), que é exatamente o texto que o ERP produziria com o
     * cadastro em "1 - Descrição Produto" — o workaround manual, sem tocar no cadastro. Setar só faz
     * sentido se o fiscal quiser OUTRO texto na nota. Ver `business-rules/descricao-item-nde.md`.
     */
    public ndeDescricaoItemFallback?: string;

    /**
     * Interruptor da etapa que garante a descrição de impressão do item da NDe
     * (`NDE_DESCRICAO_ITEM_ENABLED`, **default `true`** — só `'false'` desliga).
     *
     * Existe porque a alternativa era desligar a Frente IV inteira com `CONEXOS_DRY_RUN`: se a rota
     * `com297/comDocProdutos` mudar numa manutenção do ERP, ou se a correção passar a fazer mal, isto
     * apaga só ela, por env, sem redeploy. Desligar é seguro por construção — a etapa roda ANTES de
     * `com300`/`com131`/homologar, então pulá-la devolve exatamente o comportamento anterior à feature.
     * Mesmo padrão da ADR-0028 (`snCondPgtoAutoajuste`).
     */
    public ndeDescricaoItemEnabled: boolean;

    constructor({
        databaseConnectionString,
        conexosLogin,
        conexosPassword,
        conexosApiUrl,
        conexosFilCod,
        conexosUsnCod,
        supabaseUrl,
        supabaseServiceRoleKey,
        authJwtSecret,
        environment,
        clientName,
        awsRegion,
        conexosWriteEnabled,
        conexosDryRun,
        snLiveWriteEnabled,
        sispagLiveWriteEnabled,
        solicitacaoNumerarioGcdCod,
        solicitacaoNumerarioGcdCodPorFilial,
        conexosCredEncKey,
        sispagEnabled,
        recebimentosEnabled,
        recebimentoIngestDias,
        recebimentoIngestStartDate,
        recebimentoIngestFilCods,
        recebimentoTitularesInternos,
        fin014ContaFinanceira,
        com297GcdNotaDebitoNome,
        com297GcdNotaDebito,
        ndePollTimeoutMs,
        ndePollIntervalMs,
        ndeAclPreflight,
        snCondPgtoAutoajuste,
        ndeDescricaoItemFallback,
        ndeDescricaoItemEnabled,
    }: {
        databaseConnectionString: string;
        conexosLogin: string;
        conexosPassword: string;
        conexosApiUrl: string;
        conexosFilCod: number;
        conexosUsnCod: string;
        supabaseUrl?: string;
        supabaseServiceRoleKey?: string;
        authJwtSecret?: string;
        environment: string;
        clientName: string;
        awsRegion: string;
        conexosWriteEnabled: boolean;
        conexosDryRun: boolean;
        snLiveWriteEnabled: boolean;
        sispagLiveWriteEnabled: boolean;
        solicitacaoNumerarioGcdCod: number;
        solicitacaoNumerarioGcdCodPorFilial?: Readonly<Record<number, number>>;
        conexosCredEncKey?: string;
        sispagEnabled: boolean;
        recebimentosEnabled: boolean;
        recebimentoIngestDias: number;
        recebimentoIngestStartDate: Date;
        recebimentoIngestFilCods: number[];
        recebimentoTitularesInternos: string[];
        fin014ContaFinanceira?: number;
        com297GcdNotaDebitoNome: string;
        com297GcdNotaDebito?: number;
        ndePollTimeoutMs: number;
        ndePollIntervalMs: number;
        ndeAclPreflight: boolean;
        snCondPgtoAutoajuste: boolean;
        ndeDescricaoItemFallback?: string;
        ndeDescricaoItemEnabled: boolean;
    }) {
        this.databaseConnectionString = databaseConnectionString;
        this.conexosLogin = conexosLogin;
        this.conexosPassword = conexosPassword;
        this.conexosApiUrl = conexosApiUrl;
        this.conexosFilCod = conexosFilCod;
        this.conexosUsnCod = conexosUsnCod;
        this.supabaseUrl = supabaseUrl;
        this.supabaseServiceRoleKey = supabaseServiceRoleKey;
        this.authJwtSecret = authJwtSecret;
        this.environment = environment;
        this.clientName = clientName;
        this.awsRegion = awsRegion;
        this.conexosWriteEnabled = conexosWriteEnabled;
        this.conexosDryRun = conexosDryRun;
        this.snLiveWriteEnabled = snLiveWriteEnabled;
        this.sispagLiveWriteEnabled = sispagLiveWriteEnabled;
        this.solicitacaoNumerarioGcdCod = solicitacaoNumerarioGcdCod;
        this.solicitacaoNumerarioGcdCodPorFilial = solicitacaoNumerarioGcdCodPorFilial ?? {};
        this.conexosCredEncKey = conexosCredEncKey;
        this.sispagEnabled = sispagEnabled;
        this.recebimentosEnabled = recebimentosEnabled;
        this.recebimentoIngestDias = recebimentoIngestDias;
        this.recebimentoIngestStartDate = recebimentoIngestStartDate;
        this.recebimentoIngestFilCods = recebimentoIngestFilCods;
        this.recebimentoTitularesInternos = recebimentoTitularesInternos;
        this.fin014ContaFinanceira = fin014ContaFinanceira;
        this.com297GcdNotaDebitoNome = com297GcdNotaDebitoNome;
        this.com297GcdNotaDebito = com297GcdNotaDebito;
        this.ndePollTimeoutMs = ndePollTimeoutMs;
        this.ndePollIntervalMs = ndePollIntervalMs;
        this.ndeAclPreflight = ndeAclPreflight;
        this.snCondPgtoAutoajuste = snCondPgtoAutoajuste;
        this.ndeDescricaoItemFallback = ndeDescricaoItemFallback;
        this.ndeDescricaoItemEnabled = ndeDescricaoItemEnabled;
    }
}
