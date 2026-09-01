/**
 * Manifesto de configuração (ADR-0042) — o que cada frente EXIGE vs. o que ela apenas usa.
 *
 * Existe porque duas vars não configuradas já produziram defeito visível em produção, e as duas
 * falharam no instante de tocar dinheiro em vez de no deploy.
 */

/** A que frente a var pertence — agrupa a tela. */
export const FRENTE = {
    NUCLEO: 'núcleo',
    PERMUTAS: 'permutas',
    SISPAG: 'sispag',
    RECEBIMENTOS: 'recebimentos',
} as const;

export type Frente = (typeof FRENTE)[keyof typeof FRENTE];

/**
 * Criticidade — e a categoria do meio é a razão de este arquivo existir.
 *
 * `obrigatoria` o deploy já denuncia sozinho: sem ela o processo não sobe em produção.
 * `opcional` é escolha legítima e não merece ruído.
 *
 * `degrada-silenciosamente` é a perigosa: o sistema sobe, a tela renderiza, e **uma regra de
 * negócio fica inerte sem avisar ninguém**. Foi exatamente o que aconteceu com
 * `RECEBIMENTO_TITULARES_INTERNOS`.
 */
export const CRITICIDADE = {
    OBRIGATORIA: 'obrigatoria',
    DEGRADA_SILENCIOSAMENTE: 'degrada-silenciosamente',
    OPCIONAL: 'opcional',
} as const;

export type Criticidade = (typeof CRITICIDADE)[keyof typeof CRITICIDADE];

export interface VarManifesto {
    nome: string;
    frente: Frente;
    criticidade: Criticidade;
    /** O que acontece quando ela falta. Vai para a tela — é o texto que evita a próxima surpresa. */
    consequenciaSeAusente: string;
    /**
     * `true` ⇒ o valor NUNCA é lido nem exibido, só a presença (I3). Marcado por var, não
     * inferido do nome: `CONEXOS_PASSWORD` não contém "secret" e `SN_GCD_COD` contém "COD" —
     * heurística de nome erraria nos dois sentidos.
     */
    segredo: boolean;
    /** Default aplicado pelo provider quando ausente, para a tela distinguir de "sem valor". */
    default?: string;
}

export const CONFIG_MANIFESTO: readonly VarManifesto[] = [
    // --- Núcleo ---
    {
        nome: 'databaseConnectionString',
        frente: FRENTE.NUCLEO,
        criticidade: CRITICIDADE.OBRIGATORIA,
        consequenciaSeAusente: 'Sem Postgres não há painel, ledger nem migrations.',
        segredo: true,
    },
    {
        nome: 'CONEXOS_USERNAME',
        frente: FRENTE.NUCLEO,
        criticidade: CRITICIDADE.OBRIGATORIA,
        consequenciaSeAusente: 'Nenhuma leitura nem escrita no ERP.',
        segredo: false,
    },
    {
        nome: 'CONEXOS_PASSWORD',
        frente: FRENTE.NUCLEO,
        criticidade: CRITICIDADE.OBRIGATORIA,
        consequenciaSeAusente: 'Nenhuma leitura nem escrita no ERP.',
        segredo: true,
    },
    {
        nome: 'CONEXOS_BASE_URL',
        frente: FRENTE.NUCLEO,
        criticidade: CRITICIDADE.OBRIGATORIA,
        consequenciaSeAusente:
            'Sem endereço do Conexos não há login nem chamada: as três frentes ficam inertes.',
        segredo: false,
    },
    {
        nome: 'AUTH_JWT_SECRET',
        frente: FRENTE.NUCLEO,
        criticidade: CRITICIDADE.DEGRADA_SILENCIOSAMENTE,
        consequenciaSeAusente:
            'Login próprio indisponível; só o caminho Supabase/bypass de dev funciona.',
        segredo: true,
    },
    {
        nome: 'CONEXOS_CRED_ENC_KEY',
        frente: FRENTE.NUCLEO,
        criticidade: CRITICIDADE.DEGRADA_SILENCIOSAMENTE,
        consequenciaSeAusente:
            'Vínculo Conexos por usuário fica indisponível: TODOS operam pelo robô, e a trilha ' +
            'de auditoria deixa de distinguir quem executou.',
        segredo: true,
    },

    // --- Recebimentos (Frente IV) ---
    {
        nome: 'RECEBIMENTO_TITULARES_INTERNOS',
        frente: FRENTE.RECEBIMENTOS,
        criticidade: CRITICIDADE.DEGRADA_SILENCIOSAMENTE,
        consequenciaSeAusente:
            'A detecção de transferência interna NUNCA dispara: movimentação de tesouraria entra ' +
            'na carteira do analista como se fosse recebível, e o KPI "valor não alocado" fica ' +
            'contaminado. Medido em 2026-08: transferencia_interna=0 em 338 linhas.',
        segredo: false,
    },
    {
        nome: 'COM297_GCD_NOTA_DEBITO_NOME',
        frente: FRENTE.RECEBIMENTOS,
        criticidade: CRITICIDADE.OBRIGATORIA,
        consequenciaSeAusente:
            'A emissão da NDe falha ao resolver a Configuração de Documento no com297.',
        segredo: false,
        default: 'NOTA DE DEBITO PAGAMENTO ANTECIPADO',
    },
    {
        nome: 'COM297_GCD_NOTA_DEBITO',
        frente: FRENTE.RECEBIMENTOS,
        criticidade: CRITICIDADE.DEGRADA_SILENCIOSAMENTE,
        consequenciaSeAusente:
            'Override numérico do gcd ausente: a resolução cai no NOME. Quando o nome não bate no ' +
            'cadastro, a execução falha no meio — foi a única falha real de valor da frente ' +
            '(R$ 477.741,70 em 2026-08).',
        segredo: false,
    },
    {
        nome: 'FIN014_CONTA_FINANCEIRA',
        frente: FRENTE.RECEBIMENTOS,
        criticidade: CRITICIDADE.OBRIGATORIA,
        consequenciaSeAusente: 'Fail-closed: sem conta financeira o recebimento não baixa.',
        segredo: false,
    },
    {
        nome: 'RECEBIMENTOS_ENABLED',
        frente: FRENTE.RECEBIMENTOS,
        criticidade: CRITICIDADE.OPCIONAL,
        consequenciaSeAusente: 'Ausente = habilitado (ADR-0028). Só `false` desliga a frente.',
        segredo: false,
        default: 'true',
    },
    {
        nome: 'RECEBIMENTO_INGEST_FIL_CODS',
        frente: FRENTE.RECEBIMENTOS,
        criticidade: CRITICIDADE.OPCIONAL,
        consequenciaSeAusente: 'Vazio = todas as filiais que o ERP devolver.',
        segredo: false,
    },
    {
        nome: 'CONEXOS_EXTRATO_SYNC_START_DATE',
        frente: FRENTE.RECEBIMENTOS,
        criticidade: CRITICIDADE.OPCIONAL,
        consequenciaSeAusente: 'Piso absoluto da janela de ingestão cai no default.',
        segredo: false,
        default: '2026-08-03',
    },
    {
        nome: 'SN_LIVE_WRITE_ENABLED',
        frente: FRENTE.RECEBIMENTOS,
        criticidade: CRITICIDADE.OPCIONAL,
        consequenciaSeAusente: 'Ausente = escrita da SN DESLIGADA (gate de go-live).',
        segredo: false,
        default: 'false',
    },
    {
        nome: 'SN_GCD_COD',
        frente: FRENTE.RECEBIMENTOS,
        criticidade: CRITICIDADE.DEGRADA_SILENCIOSAMENTE,
        consequenciaSeAusente:
            'Default 0 é sentinela "não confirmado" e TRAVA a escrita real da SN — a frente parece ' +
            'ligada e não escreve.',
        segredo: false,
        default: '0',
    },

    // --- SISPAG (Frente II) ---
    {
        nome: 'SISPAG_ENABLED',
        frente: FRENTE.SISPAG,
        criticidade: CRITICIDADE.OPCIONAL,
        consequenciaSeAusente:
            'Fail-safe: ausente = habilitado FORA de produção, bloqueado EM produção.',
        segredo: false,
    },
    {
        nome: 'SISPAG_LIVE_WRITE_ENABLED',
        frente: FRENTE.SISPAG,
        criticidade: CRITICIDADE.OPCIONAL,
        consequenciaSeAusente: 'Ausente = escrita do SISPAG DESLIGADA (gate de go-live).',
        segredo: false,
        default: 'false',
    },

    // --- Permutas (Frente I) ---
    {
        nome: 'CONEXOS_WRITE_ENABLED',
        frente: FRENTE.PERMUTAS,
        criticidade: CRITICIDADE.OPCIONAL,
        consequenciaSeAusente: 'Ausente = escrita global desligada; a baixa no fin010 não ocorre.',
        segredo: false,
        default: 'false',
    },
    {
        nome: 'CONEXOS_DRY_RUN',
        frente: FRENTE.PERMUTAS,
        criticidade: CRITICIDADE.OPCIONAL,
        consequenciaSeAusente:
            'Ausente = dry-run LIGADO: o payload é montado e logado, sem POST no ERP.',
        segredo: false,
        default: 'true',
    },
] as const;
